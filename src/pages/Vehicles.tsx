import { useState, type FormEvent } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";
import { StickerDialog, type StickerData } from "./Sticker";

type VStatus = "active" | "suspended" | "retired";
const TONE: Record<string, "good" | "warn" | "neutral"> = { active: "good", suspended: "warn", retired: "neutral" };

export default function Vehicles() {
  const s = useSession();
  const vehicles = useLiveQuery(s.reader ? query(collection(db, "vehicles"), orderBy("createdAt", "desc"), limit(300)) : null, `vehicles-${s.reader}`);
  const routes = useLiveQuery(query(collection(db, "routes")), "vehicle-routes");
  const [search, setSearch] = useState("");
  const [reissue, setReissue] = useState<{ id: string; plate: string } | null>(null);
  const [statusFor, setStatusFor] = useState<Row | null>(null);
  const routeName = (id: string) => routes.data.find((r) => r.id === id)?.name ?? id;

  const q = search.trim().toUpperCase().replace(/\s+/g, " ");
  const list = vehicles.data.filter((v) => !q || String(v.plate).includes(q) || String(v.shortCode) === q.replace(/\s/g, "") || v.id === search.trim());

  return (
    <>
      <PageHead kicker="Vehicles & stickers" title="The fleet" />
      <Notice>Printing a new sticker cancels the old one at once. Use it when a sticker is damaged, lost, or you suspect someone copied it.</Notice>
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
                          {v.type === "bike" ? "Bike" : `Shuttle · ${v.capacity} seats`}
                        </div>
                      </td>
                      <td className="muted">{routeName(v.routeId)}</td>
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
      ) : can.issueStickers(s.role) ? (
        <ByIdCard onPick={(id) => setReissue({ id, plate: "" })} />
      ) : null}
      {reissue ? <ReissueDialog vehicle={reissue} onClose={() => setReissue(null)} /> : null}
      {statusFor ? <StatusDialog vehicle={statusFor} onClose={() => setStatusFor(null)} /> : null}
    </>
  );
}

/** Agents can't list vehicles; the vehicle ID is printed small at the bottom of every sticker. */
function ByIdCard({ onPick }: { onPick: (id: string) => void }) {
  const [id, setId] = useState("");
  return (
    <Card title="Replace a sticker">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) onPick(id.trim());
        }}
      >
        <Field label="Vehicle ID" value={id} onChange={setId} mono hint="Printed small at the bottom of the old sticker. Ask ops if it's unreadable." />
        <Button type="submit" disabled={!id.trim()}>
          Continue
        </Button>
      </form>
    </Card>
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
