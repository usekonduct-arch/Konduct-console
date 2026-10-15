import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, documentId, limit, onSnapshot, orderBy, query, where, type Query } from "firebase/firestore";

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

const PAGE = 100;

/** Live balances for a set of wallet ids, 30 per listener (Firestore's "in" limit). */
function useBalances(accounts: string[]): Map<string, number> {
  const [balances, setBalances] = useState(new Map<string, number>());
  const key = accounts.join(",");
  useEffect(() => {
    const chunks: string[][] = [];
    for (let i = 0; i < accounts.length; i += 30) chunks.push(accounts.slice(i, i + 30));
    const unsubs = chunks.map((ids) =>
      onSnapshot(
        query(collection(db, "wallets"), where(documentId(), "in", ids)),
        (snap) =>
          setBalances((prev) => {
            const next = new Map(prev);
            for (const d of snap.docs) next.set(d.id, (d.get("balanceKobo") as number) ?? 0);
            return next;
          }),
        () => undefined,
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return balances;
}

const walletOf = (u: Row) => (u.role === "driver" ? `driver_${u.id}` : u.role === "rider" ? `rider_${u.id}` : null);

type RoleFilter = "members" | "rider" | "driver" | "staff" | "all";
type StatusFilter = "all" | "active" | "suspended";

/** Everyone, newest first, with their wallet balance. Filters work on the people loaded so far. */
function Everyone({ onPick }: { onPick: (uid: string) => void }) {
  const [size, setSize] = useState(PAGE);
  const [role, setRole] = useState<RoleFilter>("members");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [text, setText] = useState("");
  const users = useLiveQuery(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(size)), `everyone-${size}`);
  const accounts = useMemo(() => users.data.map(walletOf).filter((a): a is string => a != null), [users.data]);
  const balances = useBalances(accounts);

  const t = text.trim().toLowerCase();
  const shown = users.data.filter((u) => {
    const member = u.role === "rider" || u.role === "driver";
    if (role === "members" && !member) return false;
    if (role === "staff" && member) return false;
    if ((role === "rider" || role === "driver") && u.role !== role) return false;
    if (status === "active" && u.status !== "active") return false;
    if (status === "suspended" && u.status === "active") return false;
    return !t || [u.fullName, u.email, u.studentId, u.fundingCode, u.contactPhone].some((v) => typeof v === "string" && v.toLowerCase().includes(t));
  });
  const total = shown.reduce((sum, u) => sum + (balances.get(walletOf(u) ?? "") ?? 0), 0);

  return (
    <Card title="Everyone" tight>
      <div className="filter-row">
        <Field label="Filter by name, email, student ID or phone" value={text} onChange={setText} />
        <Select
          label="Who"
          value={role}
          onChange={setRole}
          options={[
            { value: "members", label: "Students & drivers" },
            { value: "rider", label: "Students" },
            { value: "driver", label: "Drivers" },
            { value: "staff", label: "Staff" },
            { value: "all", label: "Everyone" },
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Any status" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
      </div>
      {users.loading ? (
        <Loading />
      ) : users.error ? (
        <Empty>{users.error}</Empty>
      ) : shown.length === 0 ? (
        <Empty>Nobody matches.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Wallet</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const w = walletOf(u);
                return (
                  <tr key={u.id} className="clickable" onClick={() => onPick(u.id)}>
                    <td>
                      <b>{u.fullName ?? u.email ?? u.id}</b>
                      <div className="muted small">
                        {u.email}
                        {u.studentId ? ` · ${u.studentId}` : ""}
                      </div>
                    </td>
                    <td>
                      <Badge tone={u.role === "rider" || u.role === "driver" ? "neutral" : "info"}>{u.role === "rider" ? "student" : u.role}</Badge>
                    </td>
                    <td>
                      <Badge tone={u.status === "active" ? "good" : "bad"}>{u.status}</Badge>
                    </td>
                    <td className="num mono">{w ? (balances.has(w) ? naira(balances.get(w)) : "…") : ""}</td>
                    <td className="muted">{when(u.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
        <span className="small muted">
          {shown.length} shown · {naira(total)} in their wallets
        </span>
        {users.data.length === size ? (
          <Button small kind="ghost" onClick={() => setSize((n) => n + PAGE)}>
            Load {PAGE} more
          </Button>
        ) : null}
      </div>
    </Card>
  );
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

  if (picked) {
    return (
      <>
        <PageHead kicker="Riders & people" title="Person">
          <Button kind="ghost" onClick={() => setPicked(null)}>
            Back to everyone
          </Button>
        </PageHead>
        <Person uid={picked} />
      </>
    );
  }

  return (
    <>
      <PageHead kicker="Riders & people" title="Students, drivers and staff" />
      {s.reader ? <Everyone onPick={setPicked} /> : null}
      <Card title="Find someone">
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
        {submitted ? (
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
  const [dialog, setDialog] = useState<"status" | "kyc" | "adjust" | "edit" | null>(null);

  if (!s.reader) {
    return (
      <Card title="Account">
        <p className="mono">{uid}</p>
        <Button onClick={() => setDialog("status")}>Suspend or approve this account</Button>
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
                {u.status === "active" ? "Suspend" : "Approve / reactivate"}
              </Button>
            ) : null}
            {can.editPeople(s.role) && (u.role === "rider" || u.role === "driver") ? (
              <Button small kind="ghost" onClick={() => setDialog("edit")}>
                Edit details
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
            <Badge>{u.role === "rider" ? "student" : u.role}</Badge>
          </dd>
          <dt>Status</dt>
          <dd>
            <Badge tone={u.status === "active" ? "good" : "bad"}>{u.status}</Badge> {u.statusReason ? <span className="muted">{u.statusReason}</span> : null}
          </dd>
          <dt>Email</dt>
          <dd>{u.email}</dd>
          {u.role === "driver" ? (
            <>
              <dt>Phone</dt>
              <dd className="mono">{u.contactPhone ?? "None on file"}</dd>
            </>
          ) : null}
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
          {u.role === "rider" || u.role === "driver" ? (
            <>
              <dt>Wallet</dt>
              <dd className="mono">{wallet.loading ? "…" : naira(wallet.data?.balanceKobo ?? 0)}</dd>
            </>
          ) : null}
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
      {dialog === "edit" ? <EditDialog person={u} onClose={() => setDialog(null)} /> : null}
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
      toast(status === "active" ? "Account approved. They can use Konduct again." : "Account suspended. Their sessions were signed out.");
      onClose();
    }
  }
  return (
    <Dialog title={status === "active" ? "Approve account" : "Suspend account"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {current == null ? (
          <Select
            label="Action"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Approve / reactivate" },
              { value: "suspended", label: "Suspend" },
            ]}
          />
        ) : null}
        {status === "active" ? <Notice>If they locked it themselves, check it's really them first.</Notice> : <Notice tone="warn">They're signed out everywhere and can't pay or be paid until approved again.</Notice>}
        <Field label="Reason (kept in the audit log)" value={reason} onChange={setReason} required />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" kind={status === "active" ? "primary" : "danger"} busy={a.busy} disabled={reason.trim().length < 3}>
          {status === "active" ? "Approve" : "Suspend"}
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

/** Admin only: corrects a student's or driver's details. Only changed fields are sent. */
function EditDialog({ person, onClose }: { person: Row; onClose: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState<string>(person.fullName ?? "");
  const [email, setEmail] = useState<string>(person.email ?? "");
  const [studentId, setStudentId] = useState<string>(person.studentId ?? "");
  const [phone, setPhone] = useState<string>(person.contactPhone ?? "");
  const a = useAction();
  const rider = person.role === "rider";
  const emailChanged = email.trim().toLowerCase() !== (person.email ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = { uid: person.id };
    if (fullName.trim() !== (person.fullName ?? "")) patch.fullName = fullName.trim();
    if (emailChanged) patch.email = email.trim();
    if (rider && normalizeStudentId(studentId) !== (person.studentId ?? "")) patch.studentId = studentId.trim();
    if (!rider && phone.trim() !== (person.contactPhone ?? "")) patch.contactPhone = phone.trim() || null;
    if (Object.keys(patch).length === 1) return onClose();
    const r = await a.run(() => call<{ changed: string[] }>("staffUpdateUser", patch));
    if (r) {
      toast(r.changed.length ? "Details saved." : "Nothing changed.");
      onClose();
    }
  }

  return (
    <Dialog title="Edit details" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Full name" value={fullName} onChange={setFullName} required />
        <Field label="Email (they sign in with this)" value={email} onChange={setEmail} type="email" inputMode="email" required />
        {rider ? (
          <Field label="Student ID" value={studentId} onChange={setStudentId} mono required />
        ) : (
          <Field label="Phone" value={phone} onChange={setPhone} inputMode="tel" hint="Nigerian mobile number, or leave empty." />
        )}
        {emailChanged ? <Notice tone="warn">Their sign-in email changes too. Tell them to sign in with the new one; their password stays the same.</Notice> : null}
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}
