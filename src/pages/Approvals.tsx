import { useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession, type StaffRole } from "../lib/session";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";

/** Mirrors CHECKERS in konduct-backend/functions/src/domain/approvals.ts. */
const KINDS: Record<string, { label: string; checkers: StaffRole[] }> = {
  payout_account: { label: "Driver payout bank account", checkers: ["admin", "ops"] },
  refund: { label: "Refund over ₦5,000", checkers: ["admin", "ops"] },
  deposit_assign: { label: "Assign a bank deposit", checkers: ["admin", "ops"] },
  ledger_adjustment: { label: "Balance adjustment", checkers: ["admin"] },
  kyc_tier: { label: "Change limits", checkers: ["admin"] },
  role_grant: { label: "Staff role", checkers: ["admin"] },
  recon_release: { label: "Resume payouts after reconciliation", checkers: ["admin"] },
};

const STATUS_TONE: Record<string, "warn" | "good" | "bad" | "neutral"> = { pending: "warn", approved: "good", rejected: "neutral", failed: "bad", executing: "warn" };

/** Shows a staff member's email instead of their account ID. */
export function Who({ uid }: { uid: string | null | undefined }) {
  const u = useLiveDoc(uid && /^[A-Za-z0-9]{10,128}$/.test(uid) ? doc(db, "users", uid) : null, `who-${uid}`);
  if (!uid) return <span className="muted">—</span>;
  return <span title={uid}>{u.data?.email ?? u.data?.fullName ?? `${uid.slice(0, 8)}…`}</span>;
}

export default function Approvals() {
  const s = useSession();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [deciding, setDeciding] = useState<Row | null>(null);
  const all = useLiveQuery(query(collection(db, "approvals"), orderBy("createdAt", "desc"), limit(150)), "approvals");
  const list = tab === "pending" ? all.data.filter((a) => a.status === "pending") : all.data;

  return (
    <>
      <PageHead kicker="Approvals" title="Needs a second person">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>
            Waiting ({all.data.filter((a) => a.status === "pending").length})
          </button>
          <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            History
          </button>
        </div>
      </PageHead>
      <Notice>
        Sensitive changes are requested by one person and only happen when someone with the right role approves them. Admins may approve their own requests;
        everyone else needs a second person.
      </Notice>
      <Card tight>
        {all.loading ? (
          <Loading />
        ) : all.error ? (
          <Empty>{all.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>{tab === "pending" ? "Nothing waiting. Good." : "No requests yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Asked by</th>
                  <th>When</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const kind = KINDS[a.kind] ?? { label: a.kind, checkers: [] };
                  const mine = a.makerUid === s.user?.uid;
                  // Admins may approve their own requests (backend: decide() in approvals.ts).
                  const allowed = can.decideApprovals(s.role) && kind.checkers.includes(s.role!) && (!mine || s.role === "admin");
                  return (
                    <tr key={a.id}>
                      <td>
                        <b>{kind.label}</b>
                        <div className="muted">{a.summary}</div>
                        {a.error ? <div className="error-text">{a.error}</div> : null}
                      </td>
                      <td>
                        <Who uid={a.makerUid} />
                        {a.checkerUid ? (
                          <div className="muted">
                            decided by <Who uid={a.checkerUid} />
                            {a.selfApproved ? " (own request)" : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{when(a.createdAt)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status}</Badge>
                      </td>
                      <td className="right">
                        {a.status === "pending" ? (
                          allowed ? (
                            <Button small onClick={() => setDeciding(a)}>
                              Review
                            </Button>
                          ) : (
                            <span className="muted small">{mine ? "Your request" : `Needs ${kind.checkers.join(" or ")}`}</span>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {deciding ? <DecideDialog approval={deciding} onClose={() => setDeciding(null)} /> : null}
    </>
  );
}

function DecideDialog({ approval, onClose }: { approval: Row; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const a = useAction();
  const kind = KINDS[approval.kind]?.label ?? approval.kind;

  async function decide(decision: "approve" | "reject", e?: FormEvent) {
    e?.preventDefault();
    const r = await a.run(() => call<{ status: string }>("staffDecideApproval", { approvalId: approval.id, decision, ...(note.trim() ? { note: note.trim() } : {}) }));
    if (r) {
      toast(r.status === "approved" ? "Approved and done." : "Rejected.");
      onClose();
    }
  }

  return (
    <Dialog title={kind} onClose={onClose}>
      <form className="stack" onSubmit={(e) => decide("approve", e)}>
        <p>
          <b>{approval.summary}</b>
        </p>
        <p className="small">
          Asked by <Who uid={approval.makerUid} /> · {when(approval.createdAt)}
          <br />
          Target: <span className="mono">{approval.target}</span>
        </p>
        <Notice tone="warn">Approving makes the change straight away. Check it against what the requester told you before you approve.</Notice>
        <Field label="Note (optional, kept in the audit log)" value={note} onChange={setNote} />
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            Approve
          </Button>
          <Button kind="ghost" onClick={() => decide("reject")} disabled={a.busy}>
            Reject
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
