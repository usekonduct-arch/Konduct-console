import { useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { due, koboFromNaira, naira, when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";
import { Who } from "./Approvals";

const REASONS: Record<string, string> = {
  wrong_amount: "Charged the wrong amount",
  charged_twice: "Charged twice",
  driver_no_alert: "Driver didn't get the alert",
  wrong_vehicle: "Paid the wrong vehicle",
  other: "Something else",
};

export default function Disputes() {
  const s = useSession();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [open, setOpen] = useState<Row | null>(null);
  const all = useLiveQuery(query(collection(db, "disputes"), orderBy("createdAt", "desc"), limit(200)), "disputes");
  const active = all.data.filter((d) => d.state === "open" || d.state === "under_review").sort((a, b) => (a.slaDueAtMs ?? 0) - (b.slaDueAtMs ?? 0));
  const closed = all.data.filter((d) => d.state === "resolved");
  const list = tab === "open" ? active : closed;

  return (
    <>
      <PageHead kicker="Disputes" title="Riders who reported a payment">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "open"} onClick={() => setTab("open")}>
            Open ({active.length})
          </button>
          <button role="tab" aria-selected={tab === "closed"} onClick={() => setTab("closed")}>
            Resolved
          </button>
        </div>
      </PageHead>
      <Notice>Every dispute must be answered within 72 hours. Refunds over ₦5,000 also need a second person in Approvals.</Notice>
      <Card tight>
        {all.loading ? (
          <Loading />
        ) : all.error ? (
          <Empty>{all.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>{tab === "open" ? "No open disputes." : "Nothing resolved yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Reason</th>
                  <th className="num">Amount</th>
                  <th>{tab === "open" ? "Deadline" : "Outcome"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => {
                  const overdue = (d.slaDueAtMs ?? Infinity) < Date.now();
                  return (
                    <tr key={d.id}>
                      <td>
                        <b className="mono">{d.reference}</b>
                        <div className="muted">
                          <Who uid={d.payerUid} /> · {when(d.createdAt)}
                        </div>
                      </td>
                      <td>
                        {REASONS[d.reason] ?? d.reason}
                        {d.messages?.[0]?.text ? <div className="muted quote">"{d.messages[0].text}"</div> : null}
                      </td>
                      <td className="num mono">{naira(d.totalKobo)}</td>
                      <td>
                        {tab === "open" ? (
                          <>
                            <Badge tone={overdue ? "bad" : d.state === "under_review" ? "info" : "warn"}>{d.state === "under_review" ? "In review" : "New"}</Badge>
                            <div className={overdue ? "error-text" : "muted"}>{due(d.slaDueAtMs)}</div>
                          </>
                        ) : (
                          <Badge tone={d.resolution?.outcome === "refunded" ? "good" : "neutral"}>
                            {d.resolution?.outcome === "refunded" ? `Refunded ${naira(d.resolution.amountKobo)}` : "No refund"}
                          </Badge>
                        )}
                        {d.refundRequestedKobo && d.state !== "resolved" ? <div className="muted">Refund waiting for approval</div> : null}
                      </td>
                      <td className="right">
                        <Button small kind={tab === "open" && can.handleDisputes(s.role) ? "primary" : "ghost"} onClick={() => setOpen(d)}>
                          {tab === "open" && can.handleDisputes(s.role) ? "Handle" : "View"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open ? <DisputeDialog dispute={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function DisputeDialog({ dispute: initial, onClose }: { dispute: Row; onClose: () => void }) {
  const s = useSession();
  const toast = useToast();
  const live = useLiveDoc(doc(db, "disputes", initial.id), `dispute-${initial.id}`);
  const tx = useLiveDoc(doc(db, "transactions", initial.id), `dispute-tx-${initial.id}`);
  const d = live.data ?? initial;
  const t = tx.data;
  const [outcome, setOutcome] = useState<"refund" | "reject">("refund");
  const [amount, setAmount] = useState(String((d.totalKobo ?? 0) / 100));
  const [note, setNote] = useState("");
  const a = useAction();
  const kobo = koboFromNaira(amount);
  const mayAct = can.handleDisputes(s.role);

  async function take() {
    const r = await a.run(() => call("staffReviewDispute", { disputeId: d.id }));
    if (r) toast("You're reviewing this dispute.");
  }

  async function resolve(e: FormEvent) {
    e.preventDefault();
    if (outcome === "refund" && (!kobo || kobo > d.totalKobo)) return a.setError(`Refund a whole naira amount up to ${naira(d.totalKobo)}.`);
    const r = await a.run(() =>
      call<{ state?: string; status?: string }>("staffResolveDispute", { disputeId: d.id, outcome, note: note.trim(), ...(outcome === "refund" ? { amountKobo: kobo } : {}) }),
    );
    if (r) {
      toast(r.status === "pending" ? "Refund requested. A second person has to approve it in Approvals." : outcome === "refund" ? "Refunded. The rider was notified." : "Closed with no refund. The rider was notified.");
      onClose();
    }
  }

  return (
    <Dialog title={`Dispute on ${d.reference}`} onClose={onClose} wide>
      <div className="stack">
        <dl className="facts">
          <dt>Rider</dt>
          <dd>
            <Who uid={d.payerUid} />
          </dd>
          <dt>Reason</dt>
          <dd>{REASONS[d.reason] ?? d.reason}</dd>
          {(d.messages ?? []).map((m: { from: string; text: string; atMs: number }, i: number) =>
            m.text ? (
              <div key={i} className="facts-row">
                <dt>{m.from === "rider" ? "Rider said" : m.from}</dt>
                <dd className="quote">"{m.text}"</dd>
              </div>
            ) : null,
          )}
          <dt>Paid</dt>
          <dd className="mono">{naira(d.totalKobo)}</dd>
          {t ? (
            <>
              <dt>Vehicle</dt>
              <dd>
                <span className="mono">{t.plate}</span> · {t.routeName} · {t.passengers} rider{t.passengers === 1 ? "" : "s"}
              </dd>
              <dt>Driver</dt>
              <dd>
                <Who uid={t.driverUid} /> {t.driverConfirmedAt ? <Badge tone="good">confirmed the code</Badge> : <Badge>didn't confirm a code</Badge>}
              </dd>
              <dt>When</dt>
              <dd>{when(t.createdAtMs)}</dd>
              <dt>Payment status</dt>
              <dd>
                <Badge>{t.status}</Badge>
              </dd>
            </>
          ) : null}
          <dt>Deadline</dt>
          <dd>{due(d.slaDueAtMs)}</dd>
        </dl>

        {d.state === "resolved" ? (
          <Notice tone="good">
            Resolved: {d.resolution?.outcome === "refunded" ? `refunded ${naira(d.resolution.amountKobo)} (covered by ${d.resolution.coveredBy})` : "no refund"}. {d.resolution?.note}
          </Notice>
        ) : !mayAct ? (
          <Notice>Your role can view disputes but not resolve them.</Notice>
        ) : d.state === "open" ? (
          <>
            <ErrorText>{a.error}</ErrorText>
            <Button onClick={take} busy={a.busy}>
              Take it for review
            </Button>
          </>
        ) : d.refundRequestedKobo ? (
          <Notice>A refund of {naira(d.refundRequestedKobo)} is waiting for a second person in Approvals.</Notice>
        ) : (
          <form className="stack" onSubmit={resolve}>
            <Select
              label="Decision"
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: "refund", label: "Refund the rider" },
                { value: "reject", label: "No refund is due" },
              ]}
            />
            {outcome === "refund" ? <Field label="Refund (₦)" value={amount} onChange={setAmount} inputMode="numeric" mono hint={`Up to ${naira(d.totalKobo)}. Comes back from the driver, or from Konduct if they were already paid out.`} /> : null}
            <Field label="What you found (the rider sees a summary)" value={note} onChange={setNote} required />
            <ErrorText>{a.error}</ErrorText>
            <Button type="submit" busy={a.busy} kind={outcome === "refund" ? "primary" : "dark"} disabled={note.trim().length < 3}>
              {outcome === "refund" ? `Refund ${kobo ? naira(kobo) : ""}` : "Close with no refund"}
            </Button>
          </form>
        )}
      </div>
    </Dialog>
  );
}
