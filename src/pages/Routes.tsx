import { useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { koboFromNaira, naira, when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export default function RoutesPage() {
  const s = useSession();
  const routes = useLiveQuery(query(collection(db, "routes")), "routes");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const sorted = [...routes.data].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return (
    <>
      <PageHead kicker="Routes & fares" title="Where Konduct runs">
        {can.editRoutes(s.role) ? <Button onClick={() => setEditing("new")}>New route</Button> : null}
      </PageHead>
      <Notice>Changing a fare takes effect at once. Riders holding an old price are asked to scan again, so nobody pays a price they didn't see.</Notice>
      <Card tight>
        {routes.loading ? (
          <Loading />
        ) : routes.error ? (
          <Empty>{routes.error}</Empty>
        ) : sorted.length === 0 ? (
          <Empty>No routes yet. Create the first one, for example "Main gate → Faculty of Science".</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Stops</th>
                  <th className="num">Fare</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      <div className="muted mono">{r.id}</div>
                    </td>
                    <td className="muted">{(r.stops ?? []).join(" → ")}</td>
                    <td className="num mono">
                      {naira(r.fareKobo)}
                      <div className="muted">v{r.fareVersion}</div>
                    </td>
                    <td>{r.active ? <Badge tone="good">Running</Badge> : <Badge>Off</Badge>}</td>
                    <td className="muted">{when(r.updatedAt ?? r.createdAt)}</td>
                    <td className="right">
                      {can.editRoutes(s.role) ? (
                        <Button small kind="ghost" onClick={() => setEditing(r)}>
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
      {editing ? <RouteDialog route={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RouteDialog({ route, onClose }: { route: Row | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState<string>(route?.name ?? "");
  const [routeId, setRouteId] = useState<string>(route?.id ?? "");
  const [stops, setStops] = useState<string>((route?.stops ?? []).join("\n"));
  const [fare, setFare] = useState<string>(route ? String(route.fareKobo / 100) : "200");
  const [active, setActive] = useState<boolean>(route?.active ?? true);
  const a = useAction();

  const id = route ? route.id : routeId || slug(name);
  const stopList = stops
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const fareKobo = koboFromNaira(fare);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!fareKobo || fareKobo < 5000 || fareKobo > 500000) return a.setError("Fares are whole naira between ₦50 and ₦5,000.");
    if (stopList.length < 2) return a.setError("Add at least two stops, one per line.");
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return a.setError("The route ID needs 3 to 40 letters, numbers or dashes.");
    const r = await a.run(() => call<{ fareVersion: number }>("staffUpsertRoute", { routeId: id, name: name.trim(), stops: stopList, fareKobo, active }));
    if (r) {
      toast(`${name.trim()} saved (fare version ${r.fareVersion}).`);
      onClose();
    }
  }

  return (
    <Dialog title={route ? `Edit ${route.name}` : "New route"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Name riders see" value={name} onChange={setName} placeholder="Main gate → Faculty of Science" required />
        {route ? null : (
          <Field label="Route ID" value={routeId || slug(name)} onChange={setRouteId} mono hint="Permanent. Lower-case letters, numbers and dashes." />
        )}
        <label className="field">
          <span className="field-label">Stops, one per line</span>
          <textarea rows={5} value={stops} onChange={(e) => setStops(e.target.value)} placeholder={"Main gate\nSenate building\nFaculty of Science"} />
        </label>
        <Field label="Fare per rider (₦)" value={fare} onChange={setFare} inputMode="numeric" mono hint={route && fareKobo !== route.fareKobo ? `Was ${naira(route.fareKobo)}. Saving makes a new fare version.` : undefined} />
        <Check label="Running (riders can pay on this route)" checked={active} onChange={setActive} />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!name.trim()}>
          Save route
        </Button>
      </form>
    </Dialog>
  );
}
