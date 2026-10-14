import { useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { mapLink, parsePin } from "../lib/geo";
import { useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** A count older than this is flagged, so nobody trusts a number from this morning. */
const STALE_MS = 2 * 3_600_000;


export default function Parks() {
  const s = useSession();
  const parks = useLiveQuery(query(collection(db, "parks")), "parks");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [setting, setSetting] = useState<Row | null>(null);
  const sorted = [...parks.data].sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)));
  const total = parks.data.filter((p) => p.active).reduce((t, p) => t + (p.busCount ?? 0), 0);

  return (
    <>
      <PageHead kicker="Parks" title="Buses at the parks">
        {can.editParks(s.role) ? <Button onClick={() => setEditing("new")}>New park</Button> : null}
      </PageHead>
      <Notice>
        Riders and drivers see these counts in their apps, with the time they were last updated. Tap + when a bus arrives and − when one leaves.
      </Notice>
      <Card tight title={parks.loading || !parks.data.length ? undefined : `${total} ${total === 1 ? "bus" : "buses"} waiting across ${parks.data.filter((p) => p.active).length} parks`}>
        {parks.loading ? (
          <Loading />
        ) : parks.error ? (
          <Empty>{parks.error}</Empty>
        ) : sorted.length === 0 ? (
          <Empty>No parks yet. Add the first one, for example "Shasha park" or "Main Campus park".</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Park</th>
                  <th>Buses there</th>
                  <th>Updated</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <ParkRow key={p.id} park={p} onSet={() => setSetting(p)} onEdit={() => setEditing(p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing ? <ParkDialog park={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {setting ? <CountDialog park={setting} onClose={() => setSetting(null)} /> : null}
    </>
  );
}

function ParkRow({ park: p, onSet, onEdit }: { park: Row; onSet: () => void; onEdit: () => void }) {
  const s = useSession();
  const a = useAction();
  const count = (p.busCount as number) ?? 0;
  const stale = !p.busCountAtMs || Date.now() - p.busCountAtMs > STALE_MS;

  const change = (by: 1 | -1) => a.run(() => call("staffSetParkBuses", { parkId: p.id, change: by }));

  return (
    <tr>
      <td>
        <b>{p.name}</b>
        <div className="muted">
          {p.location}
          {p.lat != null ? (
            <>
              {" · "}
              <a href={mapLink({ lat: p.lat, lng: p.lng })} target="_blank" rel="noreferrer">
                Map
              </a>
            </>
          ) : null}
        </div>
      </td>
      <td className="nowrap">
        {can.countBuses(s.role) && p.active ? (
          <span className="counter">
            <Button small kind="ghost" label={`One bus left ${p.name}`} disabled={count === 0} busy={a.busy} onClick={() => change(-1)}>
              −
            </Button>
            <span className="counter-value" aria-live="polite">
              {count}
            </span>
            <Button small kind="ghost" label={`One bus arrived at ${p.name}`} busy={a.busy} onClick={() => change(1)}>
              +
            </Button>
          </span>
        ) : (
          <span className="counter-value">{count}</span>
        )}
        <ErrorText>{a.error}</ErrorText>
      </td>
      <td className={stale ? "muted" : undefined}>
        {p.busCountAtMs ? when(p.busCountAtMs) : "Never"}
        {stale && p.active ? <div className="small">May be out of date</div> : null}
      </td>
      <td>{p.active ? <Badge tone="good">Shown in apps</Badge> : <Badge>Hidden</Badge>}</td>
      <td className="right nowrap">
        {can.countBuses(s.role) && p.active ? (
          <Button small kind="ghost" onClick={onSet}>
            Set count
          </Button>
        ) : null}{" "}
        {can.editParks(s.role) ? (
          <Button small kind="ghost" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function CountDialog({ park, onClose }: { park: Row; onClose: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState(String(park.busCount ?? 0));
  const a = useAction();
  const n = Number(count);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(n) || n < 0 || n > 500) return a.setError("Enter a whole number from 0 to 500.");
    const r = await a.run(() => call<{ busCount: number }>("staffSetParkBuses", { parkId: park.id, count: n }));
    if (r) {
      toast(`${park.name}: ${r.busCount} ${r.busCount === 1 ? "bus" : "buses"}.`);
      onClose();
    }
  }
  return (
    <Dialog title={`Buses at ${park.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="How many buses are there right now?" value={count} onChange={setCount} inputMode="numeric" mono autoFocus />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy}>
          Save count
        </Button>
      </form>
    </Dialog>
  );
}

function ParkDialog({ park, onClose }: { park: Row | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState<string>(park?.name ?? "");
  const [parkId, setParkId] = useState<string>("");
  const [location, setLocation] = useState<string>(park?.location ?? "");
  const [pin, setPin] = useState<string>(park?.lat != null ? `${park.lat}, ${park.lng}` : "");
  const [active, setActive] = useState<boolean>(park?.active ?? true);
  const a = useAction();

  const id = park ? park.id : parkId || slug(name);
  const where = parsePin(pin);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return a.setError("Give the park a name riders know, at least 3 letters.");
    if (location.trim().length < 3) return a.setError("Say where the park is, for example the junction or landmark.");
    if (where === null) return a.setError("The map pin should look like 7.7712, 4.5567, or paste a Google Maps link.");
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return a.setError("The park ID needs 3 to 40 letters, numbers or dashes.");
    const r = await a.run(() =>
      call<{ created: boolean }>("staffUpsertPark", { parkId: id, name: name.trim(), location: location.trim(), lat: where?.lat ?? null, lng: where?.lng ?? null, active }),
    );
    if (r) {
      toast(`${name.trim()} ${r.created ? "added" : "saved"}.`);
      onClose();
    }
  }

  return (
    <Dialog title={park ? `Edit ${park.name}` : "New park"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Name riders see" value={name} onChange={setName} placeholder="Shasha park" required />
        {park ? null : <Field label="Park ID" value={parkId || slug(name)} onChange={setParkId} mono hint="Permanent. Lower-case letters, numbers and dashes." />}
        <Field label="Where it is" value={location} onChange={setLocation} placeholder="Shasha junction, beside the filling station" required />
        <Field
          label="Map pin (optional)"
          value={pin}
          onChange={setPin}
          mono
          placeholder="7.7712, 4.5567"
          hint={
            where
              ? `Pin at ${where.lat}, ${where.lng}. Riders can open it in Maps.`
              : where === null
                ? "Can't read that. Use 7.7712, 4.5567 or paste a Google Maps link."
                : "In Google Maps, press and hold the spot, then copy the numbers or the link."
          }
        />
        <Check label="Shown in the rider and driver apps" checked={active} onChange={setActive} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!name.trim()}>
          Save park
        </Button>
      </form>
    </Dialog>
  );
}
