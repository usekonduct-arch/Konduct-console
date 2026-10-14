import { collection, limit, orderBy, query } from "firebase/firestore";

import { db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery } from "../lib/live";
import { Badge, Card, Empty, Loading, PageHead } from "../ui";

const ROLE: Record<string, string> = { student: "Student", driver: "Driver", park: "Park / union" };

export default function Waitlist() {
  const list = useLiveQuery(query(collection(db, "waitlist"), orderBy("createdAt", "desc"), limit(500)), "waitlist");
  const counts = list.data.reduce<Record<string, number>>((c, w) => ({ ...c, [w.role]: (c[w.role] ?? 0) + 1 }), {});

  function exportCsv() {
    const rows = [["name", "contact", "role", "joined"], ...list.data.map((w) => [w.name, w.contact, w.role, when(w.createdAt)])];
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "konduct-pilot-signups.csv";
    a.click();
  }

  return (
    <>
      <PageHead kicker="Pilot sign-ups" title="From the website">
        {list.data.length ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>
            <span>Download CSV</span>
          </button>
        ) : null}
      </PageHead>
      <div className="stats">
        {Object.entries(ROLE).map(([k, label]) => (
          <div key={k} className="stat">
            <span className="stat-value">{counts[k] ?? 0}</span>
            <span className="stat-label">{label}s</span>
          </div>
        ))}
      </div>
      <Card tight>
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <Empty>{list.error}</Empty>
        ) : list.data.length === 0 ? (
          <Empty>No sign-ups yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Is a</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <b>{w.name}</b>
                    </td>
                    <td className="mono">{w.contact}</td>
                    <td>
                      <Badge>{ROLE[w.role] ?? w.role}</Badge>
                    </td>
                    <td className="muted">{when(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
