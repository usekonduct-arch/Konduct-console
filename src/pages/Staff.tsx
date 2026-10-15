import { useState, type FormEvent } from "react";
import { collection, limit, query, where } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
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

const ROLE_NAMES: Record<StaffRole, string> = {
  admin: "Admin",
  ops: "Operations",
  agent: "Park agent",
  marshal: "Marshal",
  support: "Support",
  auditor: "Finance auditor",
};

const roleOptions = STAFF_ROLES.map((r) => ({ value: r, label: `${ROLE_NAMES[r]}: ${ROLE_HELP[r]}` }));

type Credentials = { email: string; role: StaffRole; password: string };

/** The message the admin sends: where to sign in, the email and the one-time password. */
function welcomeMessage(c: Credentials) {
  return [
    `Hi, you've been added to the Konduct staff console as ${ROLE_NAMES[c.role]}.`,
    "",
    `Sign in here: ${window.location.origin}`,
    `Email: ${c.email}`,
    `Temporary password: ${c.password}`,
    "",
    "When you first sign in you'll link an authenticator app (Google Authenticator or Microsoft Authenticator) and then choose your own password. Please don't share this password with anyone.",
  ].join("\n");
}

export default function Staff() {
  const s = useSession();
  const staff = useLiveQuery(query(collection(db, "users"), where("role", "in", STAFF_ROLES), limit(200)), "staff");
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<Row | null>(null);
  const [revoking, setRevoking] = useState<Row | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);
  const [sent, setSent] = useState<Credentials | null>(null);

  return (
    <>
      <PageHead kicker="Staff" title="Who can use the console">
        <Button onClick={() => setAdding(true)}>Add staff</Button>
      </PageHead>
      <Notice>Add someone with just their email. You'll get a message with a one-time password to copy and send them. Changes here take effect straight away.</Notice>
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
                      {u.mustChangePassword ? <div className="muted small">Hasn't signed in yet</div> : null}
                    </td>
                    <td>
                      <Badge tone="info">{ROLE_NAMES[u.role as StaffRole] ?? u.role}</Badge>
                    </td>
                    <td>
                      <Badge tone={u.status === "active" ? "good" : "bad"}>{u.status}</Badge>
                    </td>
                    <td className="muted">{when(u.createdAt)}</td>
                    <td className="right">
                      {u.id !== s.user?.uid ? (
                        <div className="row">
                          <Button small kind="ghost" onClick={() => setChanging(u)}>
                            Change role
                          </Button>
                          <Button small kind="ghost" onClick={() => setResetting(u)}>
                            New password
                          </Button>
                          <Button small kind="danger" onClick={() => setRevoking(u)}>
                            Revoke access
                          </Button>
                        </div>
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
              <dt>{ROLE_NAMES[r]}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {adding ? <AddDialog onClose={() => setAdding(false)} onAdded={(c) => (setAdding(false), setSent(c))} /> : null}
      {changing ? <RoleDialog person={changing} onClose={() => setChanging(null)} /> : null}
      {resetting ? <ResetDialog person={resetting} onClose={() => setResetting(null)} onReset={(c) => (setResetting(null), setSent(c))} /> : null}
      {revoking ? <RevokeDialog person={revoking} onClose={() => setRevoking(null)} /> : null}
      {sent ? <MessageDialog credentials={sent} onClose={() => setSent(null)} /> : null}
    </>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (c: Credentials) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call<Credentials>("staffAddStaff", { email: email.trim(), role }));
    if (r) onAdded(r);
  }
  return (
    <Dialog title="Add staff" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Their email" value={email} onChange={setEmail} type="email" inputMode="email" required autoFocus hint="Their own email, not a student or driver account." />
        <Select label="Role" value={role} onChange={setRole} options={roleOptions} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())}>
          Add and make a password
        </Button>
      </form>
    </Dialog>
  );
}

/** Shown once: the password isn't stored anywhere the console can read it again. */
function MessageDialog({ credentials, onClose }: { credentials: Credentials; onClose: () => void }) {
  const text = welcomeMessage(credentials);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Send them this message" onClose={onClose} wide>
      <div className="stack">
        <Notice tone="warn">Copy it now and send it to {credentials.email} (WhatsApp, SMS or email). The password isn't shown again; if it's lost, use "New password".</Notice>
        <pre className="message-box">{text}</pre>
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy message"}
        </Button>
        <p className="small muted">
          Password only: <Copy text={credentials.password} />
        </p>
        <Button kind="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

function RoleDialog({ person, onClose }: { person: Row; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<StaffRole>(person.role);
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetStaffRole", { uid: person.id, role }));
    if (r) {
      toast(`${person.email} is now ${ROLE_NAMES[role]}. They're signed out and sign in again with it.`);
      onClose();
    }
  }
  return (
    <Dialog title="Change role" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="small">{person.email}</p>
        <Select label="Role" value={role} onChange={setRole} options={roleOptions} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={role === person.role}>
          Change role
        </Button>
      </form>
    </Dialog>
  );
}

function ResetDialog({ person, onClose, onReset }: { person: Row; onClose: () => void; onReset: (c: Credentials) => void }) {
  const a = useAction();
  async function go() {
    const r = await a.run(() => call<Credentials>("staffResetStaffPassword", { uid: person.id }));
    if (r) onReset(r);
  }
  return (
    <Dialog title="New password" onClose={onClose}>
      <div className="stack">
        <p>
          Make a new one-time password for <b>{person.email}</b>? Their old password stops working and they're signed out. Their authenticator app stays linked.
        </p>
        <ErrorText>{a.error}</ErrorText>
        <Button onClick={go} busy={a.busy}>
          Make new password
        </Button>
      </div>
    </Dialog>
  );
}

function RevokeDialog({ person, onClose }: { person: Row; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  async function go() {
    const r = await a.run(() => call("staffRevokeStaff", { uid: person.id }));
    if (r) {
      toast(`${person.email} can no longer use the console.`);
      onClose();
    }
  }
  return (
    <Dialog title="Revoke access" onClose={onClose}>
      <div className="stack">
        <Notice tone="warn">
          <b>{person.email}</b> is signed out everywhere and can't sign in again. To bring them back later, add their email again.
        </Notice>
        <ErrorText>{a.error}</ErrorText>
        <Button kind="danger" onClick={go} busy={a.busy}>
          Revoke access
        </Button>
      </div>
    </Dialog>
  );
}
