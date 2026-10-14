import { collection, doc, limit, query, where } from "firebase/firestore";

import { db } from "../lib/firebase";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { useSession } from "../lib/session";
import { Badge, Card, Notice, PageHead } from "../ui";

function Stat({ label, value, href, tone, loading }: { label: string; value: number; href: string; tone?: "warn" | "bad"; loading: boolean }) {
  return (
    <a className={`stat${value > 0 && tone ? ` stat-${tone}` : ""}`} href={href}>
      <span className="stat-value">{loading ? "…" : value}</span>
      <span className="stat-label">{label}</span>
    </a>
  );
}

export default function Dashboard() {
  const s = useSession();
  const approvals = useLiveQuery(query(collection(db, "approvals"), where("status", "==", "pending"), limit(200)), "dash-approvals");
  const disputes = useLiveQuery(query(collection(db, "disputes"), where("state", "in", ["open", "under_review"]), limit(200)), "dash-disputes");
  const deposits = useLiveQuery(query(collection(db, "deposits"), where("status", "==", "unmatched"), limit(200)), "dash-deposits");
  const flags = useLiveQuery(query(collection(db, "flags"), where("status", "==", "open"), limit(200)), "dash-flags");
  const invites = useLiveQuery(query(collection(db, "driverInvites"), where("status", "==", "pending"), limit(200)), "dash-invites");
  const switches = useLiveDoc(doc(db, "config/switches"), "dash-switches");
  const parks = useLiveQuery(query(collection(db, "parks"), where("active", "==", true)), "dash-parks");
  const buses = parks.data.reduce((t, p) => t + (p.busCount ?? 0), 0);

  const sw: Partial<Row> = switches.data ?? {};
  const overdue = disputes.data.filter((d) => (d.slaDueAtMs ?? Infinity) < Date.now()).length;
  const paused = [sw.paymentsPaused && "payments", sw.fundingPaused && "top-ups", sw.payoutsPaused && "payouts", sw.payoutsHaltedByRecon && "payouts (reconciliation halt)"].filter(Boolean);

  return (
    <>
      <PageHead kicker="Overview" title={`Hello${s.user?.email ? `, ${s.user.email.split("@")[0]}` : ""}`} />
      {paused.length ? (
        <Notice tone="bad">
          Paused right now: <b>{paused.join(", ")}</b>. <a href="#/switches">Open switches</a>
        </Notice>
      ) : (
        <Notice tone="good">Payments, top-ups and payouts are all running.</Notice>
      )}
      <div className="stats">
        <Stat label="Approvals waiting for a second person" value={approvals.data.length} href="#/approvals" tone="warn" loading={approvals.loading} />
        <Stat label={`Open disputes${overdue ? ` · ${overdue} overdue` : ""}`} value={disputes.data.length} href="#/disputes" tone={overdue ? "bad" : "warn"} loading={disputes.loading} />
        <Stat label="Deposits nobody could match" value={deposits.data.length} href="#/deposits" tone="warn" loading={deposits.loading} />
        <Stat label="Open security flags" value={flags.data.length} href="#/switches" tone="bad" loading={flags.loading} />
        <Stat label="Drivers invited, not yet linked" value={invites.data.length} href="#/drivers" loading={invites.loading} />
        <Stat label={`Buses waiting at ${parks.data.length === 1 ? "1 park" : `${parks.data.length} parks`}`} value={buses} href="#/parks" loading={parks.loading} />
      </div>
      <Card title="Getting a vehicle on Konduct">
        <ol className="steps">
          <li>
            <a href="#/routes">Create the route</a> with its stops and fare.
          </li>
          <li>
            <a href="#/drivers">Invite the driver</a> at the park after checking their ID, papers and union card. Give them the 8-character code in person.
          </li>
          <li>
            <a href="#/vehicles">Print the sticker</a> for their vehicle and put it where riders can scan it.
          </li>
          <li>The driver signs up in the Konduct Driver app with the same email and enters the code.</li>
        </ol>
        <p className="small">
          Roles: <Badge>{s.role}</Badge> · Everything you change is in the audit log with your name.
        </p>
      </Card>
    </>
  );
}
