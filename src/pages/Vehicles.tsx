import { useEffect, useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { estimate } from "../lib/geo";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";
import { StickerDialog, type StickerData } from "./Sticker";

type VStatus = "active" | "suspended" | "retired";
const TONE: Record<string, "good" | "warn" | "neutral"> = { active: "good", suspended: "warn", retired: "neutral" };

/** Backend RULES.defaultBusSeats, until an admin sets config/fleet. */
const DEFAULT_BUS_SEATS = 7;

/** Seats paid by scan on the bus's current trip; a trip that has timed out counts as empty. */
const seatsTaken = (v: Row, now: number) => (v.load && now < v.load.expiresAtMs ? (v.load.taken as number) : 0);

/** Re-renders every [ms], for values that change with time rather than with data. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Vehicles() {
  const s = useSession();
  const vehicles = useLiveQuery(s.reader ? query(collection(db, "vehicles"), orderBy("createdAt", "desc"), limit(300)) : null, `vehicles-${s.reader}`);
  const routes = useLiveQuery(query(collection(db, "routes")), "vehicle-routes");
  const fleet = useLiveDoc(doc(db, "config/fleet"), "vehicle-fleet");
  const busSeats = (fleet.data?.busSeats as number | undefined) ?? DEFAULT_BUS_SEATS;
  const now = useNow(30_000);
  const [editSeats, setEditSeats] = useState(false);
  const [search, setSearch] = useState("");
  const [reissue, setReissue] = useState<{ id: string; plate: string } | null>(null);
  const [routeFor, setRouteFor] = useState<{ id: string; plate: string; currentRoute?: Row } | null>(null);
  const [statusFor, setStatusFor] = useState<Row | null>(null);
  const routeName = (id: string) => routes.data.find((r) => r.id === id)?.name ?? id;

  const q = search.trim().toUpperCase().replace(/\s+/g, " ");
  const list = vehicles.data.filter((v) => !q || String(v.plate).includes(q) || String(v.shortCode) === q.replace(/\s/g, "") || v.id === search.trim());

  return (
    <>
      <PageHead kicker="Vehicles & stickers" title="The fleet" />
      <Notice>Printing a new sticker cancels the old one at once. Use it when a sticker is damaged, lost, or you suspect someone copied it.</Notice>
      <Card
        title="Seats per bus"
        actions={
          can.setBusSeats(s.role) ? (
            <Button small kind="ghost" onClick={() => setEditSeats(true)}>
              Change
            </Button>
          ) : null
        }
      >
        <p>
          Every bus seats <b>{fleet.loading ? "…" : busSeats}</b>. Konduct refuses scans past that on one trip, and riders see an estimate of the seats left (cash riders
          aren't counted). A trip clears when the driver taps <b>New trip</b>, or on its own once nobody has scanned for 15 minutes.
        </p>
      </Card>
      {s.reader ? (
        <Card
          tight
          actions={
            <div className="search">
              <input placeholder="Search plate, sticker code or vehicle ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search vehicles" />
            </div>
          }
        >
          {vehicles.loading ? (
            <Loading />
          ) : vehicles.error ? (
            <Empty>{vehicles.error}</Empty>
          ) : list.length === 0 ? (
            <Empty>{vehicles.data.length ? "No vehicle matches." : "No vehicles yet. They're added when you invite a driver."}</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Plate</th>
                    <th>Route</th>
                    <th>Trip route</th>
                    <th>Seats paid now</th>
                    <th>Driver</th>
                    <th>Sticker</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <b className="mono">{v.plate}</b>
                        <div className="muted">
                          {v.type === "bike" ? "Bike" : `Bus · ${busSeats} seats`}
                        </div>
                      </td>
                      <td className="muted">{routeName(v.routeId)}</td>
                      <td>
                        {v.currentRoute ? (
                          <>
                            {v.currentRoute.fromName} → {v.currentRoute.toName}
                            <div className="muted">
                              ~{v.currentRoute.etaMin} min · {v.currentRoute.setByStaff ? "set by staff" : "set by driver"} {when(v.currentRoute.setAtMs)}
                            </div>
                          </>
                        ) : (
                          <span className="muted">Not set</span>
                        )}
                      </td>
                      <td className="mono">
                        {v.type === "bike" ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className={seatsTaken(v, now) >= busSeats ? "seat-full" : undefined}>
                            {seatsTaken(v, now)} / {busSeats}
                          </span>
                        )}
                      </td>
                      <td>{v.driverUid ? <Badge tone="good">Linked</Badge> : <Badge tone="warn">Waiting</Badge>}</td>
                      <td>
                        {v.tokenVersion ? (
                          <>
                            <span className="mono">{v.shortCode}</span>
                            <div className="muted">
                              v{v.tokenVersion} · {when(v.tokenIssuedAt)}
                            </div>
                          </>
                        ) : (
                          <Badge tone="warn">Not printed</Badge>
                        )}
                      </td>
                      <td>
                        <Badge tone={TONE[v.status] ?? "neutral"}>{v.status}</Badge>
                      </td>
                      <td className="right nowrap">
                        {can.issueStickers(s.role) && v.status !== "retired" ? (
                          <Button small kind="ghost" onClick={() => setReissue({ id: v.id, plate: v.plate })}>
                            {v.tokenVersion ? "New sticker" : "Print sticker"}
                          </Button>
                        ) : null}{" "}
                        {can.setVehicleRoute(s.role) && v.status === "active" ? (
                          <Button small kind="ghost" onClick={() => setRouteFor({ id: v.id, plate: v.plate, currentRoute: v.currentRoute })}>
                            Route
                          </Button>
                        ) : null}{" "}
                        {can.setVehicleStatus(s.role) ? (
                          <Button small kind="ghost" onClick={() => setStatusFor(v)}>
                            Status
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
      ) : can.issueStickers(s.role) || can.setVehicleRoute(s.role) ? (
        <ByIdCard
          onSticker={can.issueStickers(s.role) ? (id) => setReissue({ id, plate: "" }) : undefined}
          onRoute={can.setVehicleRoute(s.role) ? (id) => setRouteFor({ id, plate: "" }) : undefined}
        />
      ) : null}
      {routeFor ? <RouteDialog vehicle={routeFor} onClose={() => setRouteFor(null)} /> : null}
      {reissue ? <ReissueDialog vehicle={reissue} onClose={() => setReissue(null)} /> : null}
      {statusFor ? <StatusDialog vehicle={statusFor} onClose={() => setStatusFor(null)} /> : null}
      {editSeats ? <SeatsDialog seats={busSeats} onClose={() => setEditSeats(false)} /> : null}
    </>
  );
}

/** Agents can't list vehicles; the vehicle ID is printed small at the bottom of every sticker. */
function ByIdCard({ onSticker, onRoute }: { onSticker?: (id: string) => void; onRoute?: (id: string) => void }) {
  const [id, setId] = useState("");
  const v = id.trim();
  return (
    <Card title={onSticker ? "Replace a sticker or change a trip route" : "Change a bus's trip route"}>
      <div className="stack">
        <Field label="Vehicle ID" value={id} onChange={setId} mono hint="Printed small at the bottom of the sticker. Ask ops if it's unreadable." />
        {onRoute ? (
          <Button disabled={!v} onClick={() => onRoute(v)}>
            Change trip route
          </Button>
        ) : null}
        {onSticker ? (
          <Button kind={onRoute ? "ghost" : "primary"} disabled={!v} onClick={() => onSticker(v)}>
            Replace sticker
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Staff help a driver: where the bus is going on this trip. */
function RouteDialog({ vehicle, onClose }: { vehicle: { id: string; plate: string; currentRoute?: Row }; onClose: () => void }) {
  const toast = useToast();
  const landmarks = useLiveQuery(query(collection(db, "landmarks")), "route-landmarks");
  const places = landmarks.data.filter((l) => l.active).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const [from, setFrom] = useState<string>(vehicle.currentRoute?.fromId ?? "");
  const [to, setTo] = useState<string>(vehicle.currentRoute?.toId ?? "");
  const [newTrip, setNewTrip] = useState(false);
  const a = useAction();
  const fromId = from || places[0]?.id || "";
  const toId = to || places.find((l) => l.id !== fromId)?.id || "";
  const fa = places.find((l) => l.id === fromId);
  const tb = places.find((l) => l.id === toId);
  const e = fa && tb && fa.id !== tb.id ? estimate({ lat: fa.lat, lng: fa.lng }, { lat: tb.lat, lng: tb.lng }) : null;
  const options = places.map((l) => ({ value: l.id as string, label: l.name as string }));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!e) return a.setError("Pick two different places.");
    const r = await a.run(() => call<{ fromName: string; toName: string; etaMin: number }>("staffSetVehicleRoute", { vehicleId: vehicle.id, fromId, toId, newTrip }));
    if (r) {
      toast(`${vehicle.plate || "The bus"}: ${r.fromName} → ${r.toName}, about ${r.etaMin} min.`);
      onClose();
    }
  }

  return (
    <Dialog title={vehicle.plate ? `Trip route for ${vehicle.plate}` : "Trip route"} onClose={onClose}>
      {landmarks.loading ? (
        <Loading />
      ) : places.length < 2 ? (
        <Notice tone="warn">
          An admin needs to add at least two <a href="#/landmarks">landmarks</a> first.
        </Notice>
      ) : (
        <form className="stack" onSubmit={save}>
          <Select label="From" value={fromId} onChange={setFrom} options={options} />
          <Select label="To" value={toId} onChange={setTo} options={options} />
          <p className="small">{e ? `About ${e.minutes} min (${e.km} km). Riders can rate the driver after that.` : "Pick two different places."}</p>
          <Check label="The bus has emptied: start a new trip (clears seats paid by scan)" checked={newTrip} onChange={setNewTrip} />
          <ErrorText>{a.error}</ErrorText>
          <Button type="submit" busy={a.busy} disabled={!e}>
            Save route
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function ReissueDialog({ vehicle, onClose }: { vehicle: { id: string; plate: string }; onClose: () => void }) {
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const a = useAction();
  if (sticker) return <StickerDialog sticker={sticker} vehicleId={vehicle.id} onClose={onClose} />;
  return (
    <Dialog title={vehicle.plate ? `New sticker for ${vehicle.plate}` : "New sticker"} onClose={onClose}>
      <div className="stack">
        <p>The current sticker on this vehicle stops working as soon as you continue. Riders will need the new one.</p>
        <ErrorText>{a.error}</ErrorText>
        <Button
          busy={a.busy}
          onClick={async () => {
            const r = await a.run(() => call<StickerData>("staffIssueVehicleQr", { vehicleId: vehicle.id }));
            if (r) setSticker(r);
          }}
        >
          Cancel the old one and print new
        </Button>
        <Button kind="ghost" onClick={onClose}>
          Keep the current sticker
        </Button>
      </div>
    </Dialog>
  );
}

function StatusDialog({ vehicle, onClose }: { vehicle: Row; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<VStatus>(vehicle.status);
  const a = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetVehicleStatus", { vehicleId: vehicle.id, status }));
    if (r) {
      toast(`${vehicle.plate} is now ${status}.`);
      onClose();
    }
  }
  return (
    <Dialog title={`Status of ${vehicle.plate}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active: takes Konduct payments" },
            { value: "suspended", label: "Suspended: riders are told to pay cash" },
            { value: "retired", label: "Retired: off the fleet for good" },
          ]}
        />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={status === vehicle.status}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

function SeatsDialog({ seats, onClose }: { seats: number; onClose: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(String(seats));
  const a = useAction();
  const n = Number(value);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(n) || n < 1 || n > 30) return a.setError("Seats must be a whole number from 1 to 30.");
    const r = await a.run(() => call("staffSetFleet", { busSeats: n }));
    if (r) {
      toast(`Every bus now seats ${n}.`);
      onClose();
    }
  }
  return (
    <Dialog title="Seats per bus" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Passenger seats on every bus" value={value} onChange={setValue} inputMode="numeric" mono hint="Applies to the next scan on every bus. Bikes aren't counted." />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={n === seats}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}
