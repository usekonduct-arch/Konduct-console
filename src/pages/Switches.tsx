import { useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";
import { Who } from "./Approvals";
import { AppVersionsCard, ReferralsCard } from "./AppSettings";

const FLAGS: Record<string, string> = {
  velocity: "Too many payments in 10 minutes",
  possible_duplicate: "Possible double charge",
  duplicate_student_id: "Student ID already used by another account",
  driver_code_lockout: "Driver typed the wrong code too often",
  pin_lockout: "Too many wrong PINs",
  topup_checkout_mismatch: "Top-up checkout didn't match",
  topup_reference_mismatch: "Top-up reference didn't match",
  topup_currency_mismatch: "Top-up in the wrong currency",
  topup_amount_differs: "Top-up paid a different amount",
  deposit_currency: "Deposit in the wrong currency",
  funding_over_limit: "Deposit took a wallet over its limit",
  chargeback: "Card payment charged back",
  payout_pullback_failed: "Couldn't pull back a failed payout",
};

type Key = "paymentsPaused" | "fundingPaused" | "payoutsPaused";
const SWITCHES: { key: Key; label: string; effect: string }[] = [
  { key: "paymentsPaused", label: "Fare payments", effect: "Riders are told to pay cash." },
  { key: "fundingPaused", label: "Wallet top-ups", effect: "Riders can't add money." },
  { key: "payoutsPaused", label: "Bank withdrawals", effect: "Students' and drivers' money waits in their Konduct balances." },
];

export default function Switches() {
  const s = useSession();
  const sw = useLiveDoc(doc(db, "config/switches"), "switches");
  const routes = useLiveQuery(query(collection(db, "routes")), "switch-routes");
  const flags = useLiveQuery(query(collection(db, "flags"), orderBy("createdAt", "desc"), limit(100)), "flags");
  const [change, setChange] = useState<{ patch: Record<string, unknown>; title: string } | null>(null);
  const [release, setRelease] = useState(false);
  const v: Partial<Row> = sw.data ?? {};
  const disabled: string[] = v.disabledRoutes ?? [];
  const admin = can.setSwitches(s.role);
  const open = flags.data.filter((f) => f.status === "open");

  return (
    <>
      <PageHead kicker="Switches & flags" title="Kill switches" />
      {v.payoutsHaltedByRecon ? (
        <Notice tone="bad">
          Automatic payouts are halted because the books didn't match the bank in last night's reconciliation. Investigate the report, then request a release.{" "}
          {admin ? (
            <button type="button" className="link" onClick={() => setRelease(true)}>
              Request release
            </button>
          ) : null}
        </Notice>
      ) : null}
      <Card title="Money flows">
        {sw.loading ? (
          <Loading />
        ) : (
          <ul className="switches">
            {SWITCHES.map((x) => {
              const paused = v[x.key] === true;
              return (
                <li key={x.key}>
                  <div>
                    <b>{x.label}</b>
                    <span className="muted">{paused ? x.effect : "Running normally."}</span>
                  </div>
                  <Badge tone={paused ? "bad" : "good"}>{paused ? "Paused" : "On"}</Badge>
                  {admin ? (
                    <Button small kind={paused ? "primary" : "danger"} onClick={() => setChange({ patch: { [x.key]: !paused }, title: `${paused ? "Resume" : "Pause"} ${x.label.toLowerCase()}` })}>
                      {paused ? "Resume" : "Pause"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {v.updatedAt ? <p className="small muted">Last changed {when(v.updatedAt)}.</p> : null}
        {!admin ? <p className="small muted">Only admins can flip switches.</p> : null}
      </Card>
      <Card title="Routes switched off">
        {routes.data.length === 0 ? (
          <Empty>No routes yet.</Empty>
        ) : (
          <ul className="switches">
            {routes.data.map((r) => {
              const off = disabled.includes(r.id);
              return (
                <li key={r.id}>
                  <div>
                    <b>{r.name}</b>
                    <span className="muted">{off ? "Konduct payments are off on this route." : "Payments allowed."}</span>
                  </div>
                  <Badge tone={off ? "bad" : "good"}>{off ? "Off" : "On"}</Badge>
                  {admin ? (
                    <Button
                      small
                      kind={off ? "primary" : "danger"}
                      onClick={() =>
                        setChange({ patch: { disabledRoutes: off ? disabled.filter((x) => x !== r.id) : [...disabled, r.id] }, title: `${off ? "Turn on" : "Turn off"} payments on ${r.name}` })
                      }
                    >
                      {off ? "Turn on" : "Turn off"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <AppVersionsCard />
      <ReferralsCard />
      <Card title={`Security flags (${open.length} open)`} tight>
        {flags.loading ? (
          <Loading />
        ) : flags.error ? (
          <Empty>{flags.error}</Empty>
        ) : flags.data.length === 0 ? (
          <Empty>No flags raised.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Who</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {flags.data.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{FLAGS[f.type] ?? f.type}</b>
                      {f.txId ? <div className="muted mono">{f.txId}</div> : null}
                      {f.studentId ? <div className="muted mono">{f.studentId}</div> : null}
                    </td>
                    <td>{f.uid ? <Who uid={f.uid} /> : <span className="muted">—</span>}</td>
                    <td className="muted">{when(f.createdAt)}</td>
                    <td>
                      <Badge tone={f.status === "open" ? "warn" : "neutral"}>{f.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {change ? <ChangeDialog {...change} onClose={() => setChange(null)} /> : null}
      {release ? <ReleaseDialog onClose={() => setRelease(false)} /> : null}
    </>
  );
}

function ChangeDialog({ patch, title, onClose }: { patch: Record<string, unknown>; title: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetSwitches", { ...patch, reason: reason.trim() }));
    if (r) {
      toast("Done. It applies to the next payment.");
      onClose();
    }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Why (kept in the audit log)" value={reason} onChange={setReason} required />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={reason.trim().length < 5}>
          Confirm
        </Button>
      </form>
    </Dialog>
  );
}

function ReleaseDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffRequestReconRelease", { note: note.trim() }));
    if (r) {
      toast("Release requested. Another admin has to approve it.");
      onClose();
    }
  }
  return (
    <Dialog title="Resume automatic payouts" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="What caused the difference, and how it was fixed" value={note} onChange={setNote} required />
        <Check label="I've checked the reconciliation report and the books match the bank again" checked={checked} onChange={setChecked} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!checked || note.trim().length < 10}>
          Request release
        </Button>
      </form>
    </Dialog>
  );
}
