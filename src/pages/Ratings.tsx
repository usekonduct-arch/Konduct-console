import { useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";

import { db } from "../lib/firebase";
import { averageRating as average, stars, when } from "../lib/format";
import { useLiveQuery } from "../lib/live";
import { Card, Empty, Loading, Notice, PageHead } from "../ui";

export default function Ratings() {
  const [low, setLow] = useState(false);
  const ratings = useLiveQuery(query(collection(db, "ratings"), orderBy("createdAtMs", "desc"), limit(200)), "ratings");
  const drivers = useLiveQuery(query(collection(db, "users"), where("role", "==", "driver"), limit(500)), "ratings-drivers");
  const byUid = new Map(drivers.data.map((d) => [d.id, d]));
  const list = ratings.data.filter((r) => !low || r.stars <= 2);

  return (
    <>
      <PageHead kicker="Ratings" title="How riders rate their drivers" />
      <Notice>Riders rate a ride once its estimated time has passed. Drivers see only their average, never who rated them or what they wrote.</Notice>
      <Card
        tight
        actions={
          <label className="check">
            <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />
            <span>Only 1 and 2 stars</span>
          </label>
        }
      >
        {ratings.loading ? (
          <Loading />
        ) : ratings.error ? (
          <Empty>{ratings.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>{ratings.data.length ? "No low ratings. Good news." : "No ratings yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Driver</th>
                  <th>Trip</th>
                  <th>Comment</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const d = byUid.get(r.driverUid);
                  return (
                    <tr key={r.id}>
                      <td className={`nowrap ${r.stars <= 2 ? "seat-full" : ""}`} aria-label={`${r.stars} of 5 stars`}>
                        {stars(r.stars)}
                      </td>
                      <td>
                        <b>{d?.fullName ?? "Driver"}</b>
                        <div className="muted">
                          <span className="mono">{r.plate}</span>
                          {average(d) ? ` · ${average(d)}` : ""}
                        </div>
                      </td>
                      <td className="muted">{r.tripRoute ? `${r.tripRoute.from} → ${r.tripRoute.to}` : "—"}</td>
                      <td>{r.comment || <span className="muted">—</span>}</td>
                      <td className="muted nowrap">{when(r.createdAtMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
