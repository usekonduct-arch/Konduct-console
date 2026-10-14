import { useState, type FormEvent } from "react";
import { collection, limit, query, where } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery } from "../lib/live";
import { STAFF_ROLES, useSession, type StaffRole } from "../lib/session";
import { Badge, Button, Card, Copy, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";

const ROLE_HELP: Record<StaffRole, string> = {
  admin: "Everything, including switches, roles and approving balance changes",
  ops: "Routes, vehicles, approvals, refunds, deposits",
  agent: "Invite drivers at the park, print stickers, unlock accounts",
  marshal: "Park marshal (no console actions yet)",
  support: "Disputes, deposits, lock and unlock accounts",
  auditor: "Read-only, including the audit log",
};

export default function Staff() {
  const s = useSession();
  const staff = useLiveQuery(query(collection(db, "users"), where("role", "in", STAFF_ROLES), limit(200)), "staff");
  const [grant, setGrant] = useState<{ uid: string; role?: StaffRole } | null>(null);

  return (
    <>
      <PageHead kicker="Staff" title="Who can use the console">
        <Button onClick={() => setGrant({ uid: "" })}>Add staff</Button>
      </PageHead>
      <Notice>
        New staff first sign in to the console with their own email and set up their authenticator. The console then shows them their account ID; paste it here. Another admin has to
        approve every role change in Approvals.
      </Notice>
      <Card tight>
        {staff.loading ? (
          <Loading />
        ) : staff.error ? (
          <Empty>{staff.error}</Empty>
        ) : staff.data.length === 0 ? (
          <Empty>No staff yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {staff.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.email}</b>
                      {u.id === s.user?.uid ? <span className="muted"> (you)</span> : null}
                      <div className="muted mono">{u.id}</div>
                    </td>
                    <td>
                      <Badge tone="info">{u.role}</Badge>
                    </td>
                    <td>
                      <Badge tone={u.status === "active" ? "good" : "bad"}>{u.status}</Badge>
                    </td>
                    <td className="muted">{when(u.createdAt)}</td>
                    <td className="right">
                      {u.id !== s.user?.uid ? (
                        <Button small kind="ghost" onClick={() => setGrant({ uid: u.id, role: u.role })}>
                          Change
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="What each role can do">
        <dl className="facts">
          {STAFF_ROLES.map((r) => (
            <div key={r} className="facts-row">
              <dt>{r}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
        <p className="small muted">
          Your account ID: <Copy text={s.user?.uid ?? ""} />
        </p>
      </Card>
      {grant ? <GrantDialog uid={grant.uid} current={grant.role} onClose={() => setGrant(null)} /> : null}
    </>
  );
}

function GrantDialog({ uid: initial, current, onClose }: { uid: string; current?: StaffRole; onClose: () => void }) {
  const toast = useToast();
  const [uid, setUid] = useState(initial);
  const [role, setRole] = useState<StaffRole | "none">(current ?? "agent");
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffGrantRole", { uid: uid.trim(), role }));
    if (r) {
      toast("Requested. Another admin has to approve it in Approvals.");
      onClose();
    }
  }
  return (
    <Dialog title={current ? "Change staff role" : "Add staff"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {current ? <p className="mono small">{uid}</p> : <Field label="Their account ID" value={uid} onChange={setUid} mono required hint="Shown to them on the console's “No staff role yet” screen." />}
        <Select
          label="Role"
          value={role}
          onChange={setRole}
          options={[...STAFF_ROLES.map((r) => ({ value: r as StaffRole | "none", label: `${r}: ${ROLE_HELP[r]}` })), ...(current ? [{ value: "none" as const, label: "Remove from staff" }] : [])]}
        />
        <Notice>They're signed out when it's approved, and sign in again with the new role. Their email must be verified.</Notice>
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" kind={role === "none" ? "danger" : "primary"} busy={a.busy} disabled={!/^[A-Za-z0-9]{10,128}$/.test(uid.trim()) || role === current}>
          Request
        </Button>
      </form>
    </Dialog>
  );
}
