import { useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { estimate, mapLink, parsePin } from "../lib/geo";
import { when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export default function Landmarks() {
  const s = useSession();
  const landmarks = useLiveQuery(query(collection(db, "landmarks")), "landmarks");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const sorted = [...landmarks.data].sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)));

  return (
    <>
      <PageHead kicker="Landmarks" title="Places trips go between">
        {can.editLandmarks(s.role) ? <Button onClick={() => setEditing("new")}>New landmark</Button> : null}
      </PageHead>
      <Notice>
        Before each trip, drivers pick where they're going from and to on this list. Riders see the route and an estimated time, and can rate the driver once that time has
        passed. Estimates come from the map pins, so put each pin where buses actually stop.
      </Notice>
      <Card tight>
        {landmarks.loading ? (
          <Loading />
        ) : landmarks.error ? (
          <Empty>{landmarks.error}</Empty>
        ) : sorted.length === 0 ? (
          <Empty>No landmarks yet. Add the places buses go, for example "Shasha park", "Main gate" or "Senate building".</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Landmark</th>
                  <th>Map pin</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                      <div className="muted mono">{l.id}</div>
                    </td>
                    <td className="mono">
                      <a href={mapLink({ lat: l.lat, lng: l.lng })} target="_blank" rel="noreferrer">
                        {l.lat}, {l.lng}
                      </a>
                    </td>
                    <td>{l.active ? <Badge tone="good">Drivers can pick it</Badge> : <Badge>Hidden</Badge>}</td>
                    <td className="muted">{when(l.updatedAt ?? l.createdAt)}</td>
                    <td className="right">
                      {can.editLandmarks(s.role) ? (
                        <Button small kind="ghost" onClick={() => setEditing(l)}>
                          Edit
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
      {sorted.filter((l) => l.active).length >= 2 ? <Estimator landmarks={sorted.filter((l) => l.active)} /> : null}
      {editing ? <LandmarkDialog landmark={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** What riders will be told a trip takes, to check the pins make sense. */
function Estimator({ landmarks }: { landmarks: Row[] }) {
  const [from, setFrom] = useState<string>(landmarks[0].id);
  const [to, setTo] = useState<string>(landmarks[1].id);
  const a = landmarks.find((l) => l.id === from);
  const b = landmarks.find((l) => l.id === to);
  const e = a && b && a.id !== b.id ? estimate({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) : null;
  const options = landmarks.map((l) => ({ value: l.id as string, label: l.name as string }));
  return (
    <Card title="Estimated trip times">
      <div className="grid-2">
        <Select label="From" value={from} onChange={setFrom} options={options} />
        <Select label="To" value={to} onChange={setTo} options={options} />
      </div>
      <p>
        {e ? (
          <>
            About <b>{e.minutes} min</b> by bus ({e.km} km by road, stops included).
          </>
        ) : (
          "Pick two different places."
        )}
      </p>
    </Card>
  );
}

function LandmarkDialog({ landmark, onClose }: { landmark: Row | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState<string>(landmark?.name ?? "");
  const [landmarkId, setLandmarkId] = useState("");
  const [pin, setPin] = useState<string>(landmark ? `${landmark.lat}, ${landmark.lng}` : "");
  const [active, setActive] = useState<boolean>(landmark?.active ?? true);
  const a = useAction();
  const id = landmark ? landmark.id : landmarkId || slug(name);
  const where = parsePin(pin);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return a.setError("Give the landmark the name riders use.");
    if (!where) return a.setError("Add the map pin: 7.7712, 4.5567, or paste a Google Maps link.");
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return a.setError("The landmark ID needs 3 to 40 letters, numbers or dashes.");
    const r = await a.run(() => call<{ created: boolean }>("staffUpsertLandmark", { landmarkId: id, name: name.trim(), lat: where.lat, lng: where.lng, active }));
    if (r) {
      toast(`${name.trim()} ${r.created ? "added" : "saved"}.`);
      onClose();
    }
  }

  return (
    <Dialog title={landmark ? `Edit ${landmark.name}` : "New landmark"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Name riders and drivers know" value={name} onChange={setName} placeholder="Main gate" required />
        {landmark ? null : <Field label="Landmark ID" value={landmarkId || slug(name)} onChange={setLandmarkId} mono hint="Permanent. Lower-case letters, numbers and dashes." />}
        <Field
          label="Map pin"
          value={pin}
          onChange={setPin}
          mono
          placeholder="7.7712, 4.5567"
          required
          hint={
            where
              ? `Pin at ${where.lat}, ${where.lng}.`
              : where === null
                ? "Can't read that. Use 7.7712, 4.5567 or paste a Google Maps link."
                : "In Google Maps, press and hold the spot, then copy the numbers or the link."
          }
        />
        <Check label="Drivers can pick it for a trip" checked={active} onChange={setActive} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!name.trim()}>
          Save landmark
        </Button>
      </form>
    </Dialog>
  );
}
