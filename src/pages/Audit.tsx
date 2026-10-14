import { useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";

import { db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery } from "../lib/live";
import { Card, Empty, Loading, PageHead } from "../ui";
import { Who } from "./Approvals";

const short = (v: unknown) => (v == null ? "" : JSON.stringify(v).replace(/[{}"]/g, "").replace(/,/g, ", ").slice(0, 160));

export default function Audit() {
  const [n, setN] = useState(200);
  const [filter, setFilter] = useState("");
  const logs = useLiveQuery(query(collection(db, "auditLogs"), orderBy("ts", "desc"), limit(n)), `audit-${n}`);
  const f = filter.trim().toLowerCase();
  const list = logs.data.filter((l) => !f || `${l.action} ${l.target} ${l.actor}`.toLowerCase().includes(f));

  return (
    <>
      <PageHead kicker="Audit log" title="Every change, and who made it" />
      <Card
        tight
        actions={
          <div className="search">
            <input placeholder="Filter by action, target or person" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter audit log" />
          </div>
        }
      >
        {logs.loading ? (
          <Loading />
        ) : logs.error ? (
          <Empty>{logs.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>Nothing matches.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id}>
                    <td className="muted nowrap">{when(l.ts)}</td>
                    <td>{String(l.actor).includes(":") ? <span className="mono">{l.actor}</span> : <Who uid={l.actor} />}</td>
                    <td className="mono">{l.action}</td>
                    <td className="mono muted">{l.target}</td>
                    <td className="muted small">
                      {l.before ? <div>before: {short(l.before)}</div> : null}
                      {l.after ? <div>after: {short(l.after)}</div> : null}
                      {l.ip ? <div>ip: {l.ip}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.data.length >= n ? (
          <p className="center">
            <button type="button" className="link" onClick={() => setN(n + 200)}>
              Show older
            </button>
          </p>
        ) : null}
      </Card>
    </>
  );
}
