import { useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query, where, type Query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { koboFromNaira, naira, when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Copy, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";

type By = "email" | "studentId" | "fundingCode" | "uid";

/** As the backend stores them (identity.ts): "uni/2023/04571" -> "UNI-2023-04571". */
const normalizeStudentId = (raw: string) =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[\s/\\._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

function buildQuery(by: By, term: string): Query | null {
  const t = term.trim();
  if (!t) return null;
  const users = collection(db, "users");
  if (by === "email") return query(users, where("email", "==", t.toLowerCase()), limit(5));
  if (by === "studentId") return query(users, where("studentId", "==", normalizeStudentId(t)), limit(5));
  if (by === "fundingCode") return query(users, where("fundingCode", "==", t.toUpperCase().replace(/\s/g, "")), limit(5));
  return null;
}

export default function People() {
  const s = useSession();
  const [by, setBy] = useState<By>(s.reader ? "email" : "uid");
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState<{ by: By; term: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const results = useLiveQuery(s.reader && submitted && submitted.by !== "uid" ? buildQuery(submitted.by, submitted.term) : null, `people-${submitted?.by}-${submitted?.term}`);

  function search(e: FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    if (by === "uid") {
      setPicked(term.trim());
      setSubmitted(null);
    } else {
      setPicked(null);
      setSubmitted({ by, term });
    }
  }

  return (
    <>
      <PageHead kicker="Riders & people" title="Find someone" />
      <Card>
        <form className="search-row" onSubmit={search}>
          <Select
            label="Search by"
            value={by}
            onChange={setBy}
            options={[
              ...(s.reader
                ? [
                    { value: "email" as By, label: "Email" },
                    { value: "studentId" as By, label: "Student ID" },
                    { value: "fundingCode" as By, label: "Funding code (KD…)" },
                  ]
                : []),
              { value: "uid" as By, label: "Account ID" },
            ]}
          />
          <Field label="Search" value={term} onChange={setTerm} mono={by !== "email"} />
          <Button type="submit">Search</Button>
        </form>
        {submitted && !picked ? (
          results.loading ? (
            <Loading />
          ) : results.error ? (
            <Empty>{results.error}</Empty>
          ) : results.data.length === 0 ? (
            <Empty>Nobody found.</Empty>
          ) : (
            <ul className="list">
              {results.data.map((u) => (
                <li key={u.id}>
                  <button type="button" className="list-btn" onClick={() => setPicked(u.id)}>
                    <b>{u.fullName ?? u.email}</b>
                    <span className="muted">
                      {u.role} · {u.email} {u.studentId ? `· ${u.studentId}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>
      {picked ? <Person uid={picked} /> : null}
    </>
  );
}

function Person({ uid }: { uid: string }) {
  const s = useSession();
  const user = useLiveDoc(s.reader ? doc(db, "users", uid) : null, `user-${uid}`);
  const u = user.data;
  const account = u?.role === "driver" ? `driver_${uid}` : `rider_${uid}`;
  const wallet = useLiveDoc(s.reader && u ? doc(db, "wallets", account) : null, `wallet-${account}-${!!u}`);
  const fares = useLiveQuery(
    s.reader && u?.role === "rider" ? query(collection(db, "transactions"), where("payerUid", "==", uid), orderBy("createdAtMs", "desc"), limit(15)) : null,
    `fares-${uid}-${u?.role}`,
  );
  const [dialog, setDialog] = useState<"status" | "kyc" | "adjust" | null>(null);

  if (!s.reader) {
    return (
      <Card title="Account">
        <p className="mono">{uid}</p>
        <Button onClick={() => setDialog("status")}>Lock or unlock this account</Button>
        {dialog === "status" ? <StatusDialog uid={uid} current={null} onClose={() => setDialog(null)} /> : null}
      </Card>
    );
  }
  if (user.loading) return <Loading />;
  if (!u) return <Empty>No account with that ID.</Empty>;

  return (
    <>
      <Card
        title={u.fullName ?? u.email ?? uid}
        actions={
          <div className="row">
            {can.setUserStatus(s.role) ? (
              <Button small kind={u.status === "active" ? "danger" : "primary"} onClick={() => setDialog("status")}>
                {u.status === "active" ? "Suspend" : "Unlock"}
              </Button>
            ) : null}
            {can.requestKyc(s.role) && u.role === "rider" ? (
              <Button small kind="ghost" onClick={() => setDialog("kyc")}>
                Change limits
              </Button>
            ) : null}
            {can.requestAdjustment(s.role) && (u.role === "rider" || u.role === "driver") ? (
              <Button small kind="ghost" onClick={() => setDialog("adjust")}>
                Adjust balance
              </Button>
            ) : null}
          </div>
        }
      >
        <dl className="facts">
          <dt>Role</dt>
          <dd>
            <Badge>{u.role}</Badge>
          </dd>
          <dt>Status</dt>
          <dd>
            <Badge tone={u.status === "active" ? "good" : "bad"}>{u.status}</Badge> {u.statusReason ? <span className="muted">{u.statusReason}</span> : null}
          </dd>
          <dt>Email</dt>
          <dd>{u.email}</dd>
          {u.studentId ? (
            <>
              <dt>Student ID</dt>
              <dd className="mono">{u.studentId}</dd>
            </>
          ) : null}
          {u.fundingCode ? (
            <>
              <dt>Funding code</dt>
              <dd className="mono">{u.fundingCode}</dd>
            </>
          ) : null}
          {u.kycTier ? (
            <>
              <dt>Limits</dt>
              <dd>Tier {u.kycTier}</dd>
            </>
          ) : null}
          <dt>Wallet</dt>
          <dd className="mono">{wallet.loading ? "…" : naira(wallet.data?.balanceKobo ?? 0)}</dd>
          <dt>Joined</dt>
          <dd>{when(u.createdAt)}</dd>
          <dt>Account ID</dt>
          <dd>
            <Copy text={uid} />
          </dd>
        </dl>
      </Card>
      {u.role === "rider" ? (
        <Card title="Recent payments" tight>
          {fares.loading ? (
            <Loading />
          ) : fares.data.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Reference</th>
                    <th>Vehicle</th>
                    <th>Riders</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fares.data.map((t: Row) => (
                    <tr key={t.id}>
                      <td className="muted">{when(t.createdAtMs)}</td>
                      <td className="mono">{t.reference}</td>
                      <td className="mono">{t.plate}</td>
                      <td>{t.passengers}</td>
                      <td className="num mono">{naira(t.totalKobo)}</td>
                      <td>
                        <Badge tone={t.status === "completed" ? "good" : "neutral"}>{t.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
      {dialog === "status" ? <StatusDialog uid={uid} current={u.status} onClose={() => setDialog(null)} /> : null}
      {dialog === "kyc" ? <KycDialog uid={uid} current={u.kycTier ?? 1} onClose={() => setDialog(null)} /> : null}
      {dialog === "adjust" ? <AdjustDialog account={account} name={u.fullName ?? u.email} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function StatusDialog({ uid, current, onClose }: { uid: string; current: string | null; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<"active" | "suspended">(current === "active" ? "suspended" : "active");
  const [reason, setReason] = useState("");
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetUserStatus", { uid, status, reason: reason.trim() }));
    if (r) {
      toast(status === "active" ? "Account unlocked." : "Account suspended. Their sessions were signed out.");
      onClose();
    }
  }
  return (
    <Dialog title={status === "active" ? "Unlock account" : "Suspend account"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {current == null ? (
          <Select
            label="Action"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Unlock (they proved who they are in person)" },
              { value: "suspended", label: "Suspend" },
            ]}
          />
        ) : null}
        {status === "active" ? <Notice>Only unlock after checking their ID in person, especially if they locked it themselves.</Notice> : <Notice tone="warn">They're signed out everywhere and can't pay or be paid until unlocked.</Notice>}
        <Field label="Reason (kept in the audit log)" value={reason} onChange={setReason} required />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" kind={status === "active" ? "primary" : "danger"} busy={a.busy} disabled={reason.trim().length < 3}>
          {status === "active" ? "Unlock" : "Suspend"}
        </Button>
      </form>
    </Dialog>
  );
}

function KycDialog({ uid, current, onClose }: { uid: string; current: number; onClose: () => void }) {
  const toast = useToast();
  const [tier, setTier] = useState<"1" | "2">(current === 2 ? "1" : "2");
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetKycTier", { uid, tier: Number(tier) }));
    if (r) {
      toast("Request sent. An admin has to approve it.");
      onClose();
    }
  }
  return (
    <Dialog title="Change limits" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Select
          label="Limit tier"
          value={tier}
          onChange={setTier}
          options={[
            { value: "1", label: "Tier 1: hold up to ₦50,000, spend ₦10,000 a day" },
            { value: "2", label: "Tier 2: hold up to ₦300,000, spend ₦50,000 a day" },
          ]}
        />
        <Notice>A second person (an admin) has to approve this in Approvals.</Notice>
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={Number(tier) === current}>
          Request change
        </Button>
      </form>
    </Dialog>
  );
}

function AdjustDialog({ account, name, onClose }: { account: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const [side, setSide] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const a = useAction();
  const kobo = koboFromNaira(amount);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!kobo) return a.setError("Enter a whole naira amount.");
    const r = await a.run(() => call("staffRequestAdjustment", { account, side, amountKobo: kobo, memo: memo.trim() }));
    if (r) {
      toast("Adjustment requested. An admin has to approve it.");
      onClose();
    }
  }
  return (
    <Dialog title={`Adjust ${name}'s balance`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Notice tone="warn">Only for correcting a mistake the ledger can't fix any other way (refunds go through Disputes). An admin must approve it.</Notice>
        <Select
          label="Direction"
          value={side}
          onChange={setSide}
          options={[
            { value: "credit", label: "Add money to their wallet" },
            { value: "debit", label: "Take money from their wallet" },
          ]}
        />
        <Field label="Amount (₦)" value={amount} onChange={setAmount} inputMode="numeric" mono hint={kobo ? naira(kobo) : undefined} />
        <Field label="Why (kept in the ledger and audit log)" value={memo} onChange={setMemo} required />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!kobo || memo.trim().length < 5}>
          Request adjustment
        </Button>
      </form>
    </Dialog>
  );
}
