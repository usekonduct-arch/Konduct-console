import { useState, type FormEvent } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";
import { StickerDialog, type StickerData } from "./Sticker";

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  pending: { label: "Waiting for driver", tone: "warn" },
  claimed: { label: "Linked", tone: "good" },
  locked: { label: "Locked: too many wrong codes", tone: "bad" },
  revoked: { label: "Revoked", tone: "neutral" },
};

export default function Drivers() {
  const s = useSession();
  const [inviting, setInviting] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const invites = useLiveQuery(s.reader ? query(collection(db, "driverInvites"), orderBy("createdAt", "desc"), limit(200)) : null, `invites-${s.reader}`);

  return (
    <>
      <PageHead kicker="Drivers" title="Onboard drivers at the park">
        {can.inviteDrivers(s.role) ? <Button onClick={() => setInviting(true)}>Invite a driver</Button> : null}
      </PageHead>
      {s.reader ? (
        <Card tight>
          {invites.loading ? (
            <Loading />
          ) : invites.error ? (
            <Empty>{invites.error}</Empty>
          ) : invites.data.length === 0 ? (
            <Empty>No drivers invited yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Vehicle</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th>Invited</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invites.data.map((i) => {
                    const st = STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
                    return (
                      <tr key={i.id}>
                        <td>
                          <b>{i.fullName}</b>
                          <div className="muted">{i.email}</div>
                          {i.contactPhone ? <div className="muted mono">{i.contactPhone}</div> : null}
                        </td>
                        <td>
                          <span className="mono">{i.plate}</span>
                          <div className="muted">{i.vehicleType}</div>
                        </td>
                        <td className="muted">{i.routeName}</td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {i.status === "pending" && i.attempts ? <div className="muted">{i.attempts} wrong tries</div> : null}
                        </td>
                        <td className="muted">{when(i.createdAt)}</td>
                        <td className="right">
                          {can.inviteDrivers(s.role) && (i.status === "pending" || i.status === "locked") ? (
                            <Button small kind="ghost" onClick={() => setResetFor(i.email)}>
                              New code
                            </Button>
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
      ) : (
        <Card title="Lost or locked code">
          <p className="small">If a driver lost their code or typed it wrong too many times, issue a new one by their email.</p>
          <Button kind="ghost" onClick={() => setResetFor("")}>
            Issue a new code
          </Button>
        </Card>
      )}
      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
      {resetFor != null ? <ResetDialog email={resetFor} onClose={() => setResetFor(null)} /> : null}
    </>
  );
}

type Invited = { vehicleId: string; onboardingCode: string; plate: string; email: string; name: string };

function InviteDialog({ onClose }: { onClose: () => void }) {
  const routes = useLiveQuery(query(collection(db, "routes")), "invite-routes");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [type, setType] = useState<"shuttle" | "bike">("shuttle");
  const [routeId, setRouteId] = useState("");
  const [capacity, setCapacity] = useState("14");
  const [idSeen, setIdSeen] = useState(false);
  const [papers, setPapers] = useState(false);
  const [union, setUnion] = useState(false);
  const [done, setDone] = useState<Invited | null>(null);
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const a = useAction();
  const qr = useAction();

  const active = routes.data.filter((r) => r.active);
  const route = routeId || active[0]?.id || "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 30) return a.setError("Seats must be a number from 1 to 30.");
    if (!route) return a.setError("Create a route first.");
    const r = await a.run(() =>
      call<{ vehicleId: string; onboardingCode: string }>("staffInviteDriver", {
        email: email.trim(),
        fullName: name.trim(),
        ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
        plate: plate.trim(),
        type,
        routeId: route,
        capacity: type === "bike" ? 1 : cap,
        checks: { idSeen: true, vehiclePapersSeen: true, unionConfirmed: true },
      }),
    );
    if (r) setDone({ ...r, plate: plate.trim().toUpperCase(), email: email.trim(), name: name.trim() });
  }

  async function printSticker() {
    if (!done) return;
    const r = await qr.run(() => call<StickerData>("staffIssueVehicleQr", { vehicleId: done.vehicleId }));
    if (r) setSticker(r);
  }

  if (sticker && done) return <StickerDialog sticker={sticker} vehicleId={done.vehicleId} onClose={onClose} />;

  if (done) {
    return (
      <Dialog title="Driver invited" onClose={onClose}>
        <div className="stack">
          <p>
            Give <b>{done.name}</b> this code <b>in person</b>. It's shown only once.
          </p>
          <div className="big-code mono">{done.onboardingCode.replace(/(.{4})/, "$1 ")}</div>
          <ol className="steps">
            <li>
              The driver installs Konduct Driver and signs up with <b>{done.email}</b>.
            </li>
            <li>They enter this code to link their vehicle {done.plate}.</li>
          </ol>
          <ErrorText>{qr.error}</ErrorText>
          <Button onClick={printSticker} busy={qr.busy}>
            Print the vehicle sticker now
          </Button>
          <Button kind="ghost" onClick={onClose}>
            I'll print it later
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Invite a driver" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <Notice>Do this at the park, with the driver in front of you.</Notice>
        <div className="grid-2">
          <Field label="Full name" value={name} onChange={setName} placeholder="Tunde Adebayo" required />
          <Field label="Email they'll sign up with" value={email} onChange={setEmail} type="email" inputMode="email" required />
          <Field label="Phone (optional)" value={phone} onChange={setPhone} inputMode="tel" placeholder="0803 123 4567" />
          <Field label="Plate number" value={plate} onChange={setPlate} mono placeholder="OS 482 KJA" required />
          <Select
            label="Vehicle"
            value={type}
            onChange={setType}
            options={[
              { value: "shuttle", label: "Shuttle (korope / bus)" },
              { value: "bike", label: "Bike (okada)" },
            ]}
          />
          {type === "shuttle" ? <Field label="Passenger seats" value={capacity} onChange={setCapacity} inputMode="numeric" mono /> : <span />}
        </div>
        {routes.loading ? (
          <Loading />
        ) : active.length === 0 ? (
          <Notice tone="warn">
            There are no running routes. <a href="#/routes">Create a route</a> first.
          </Notice>
        ) : (
          <Select label="Route" value={route} onChange={setRouteId} options={active.map((r) => ({ value: r.id, label: r.name }))} />
        )}
        <fieldset className="checks">
          <legend>I have checked, in person</legend>
          <Check label="Their ID card, and it matches the name above" checked={idSeen} onChange={setIdSeen} />
          <Check label="The vehicle papers" checked={papers} onChange={setPapers} />
          <Check label="Their union membership" checked={union} onChange={setUnion} />
        </fieldset>
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!(idSeen && papers && union) || !name.trim() || !email.trim() || !plate.trim() || !route}>
          Create invite and code
        </Button>
      </form>
    </Dialog>
  );
}

function ResetDialog({ email: initial, onClose }: { email: string; onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState<string | null>(null);
  const a = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call<{ onboardingCode: string }>("staffResetDriverCode", { email: email.trim() }));
    if (r) {
      setCode(r.onboardingCode);
      toast("New code issued. The old one no longer works.");
    }
  }

  return (
    <Dialog title="New onboarding code" onClose={onClose}>
      {code ? (
        <div className="stack">
          <p>Give this code to the driver in person. The old code no longer works.</p>
          <div className="big-code mono">{code.replace(/(.{4})/, "$1 ")}</div>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Driver's email" value={email} onChange={setEmail} type="email" required />
          <ErrorText>{a.error}</ErrorText>
          <Button type="submit" busy={a.busy}>
            Issue new code
          </Button>
        </form>
      )}
    </Dialog>
  );
}

