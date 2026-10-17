import { useEffect, useState, type ComponentType } from "react";

import { can, useSession, type StaffRole } from "./lib/session";
import { ChangePasswordDialog, ChoosePassword, EnrolMfa, NotStaff, ReauthMfa, SignIn, VerifyEmail } from "./pages/Auth";
import Ads from "./pages/Ads";
import Sponsors from "./pages/Sponsors";
import Approvals from "./pages/Approvals";
import Audit from "./pages/Audit";
import Dashboard from "./pages/Dashboard";
import Deposits from "./pages/Deposits";
import Disputes from "./pages/Disputes";
import Drivers from "./pages/Drivers";
import Landmarks from "./pages/Landmarks";
import Notifications from "./pages/Notifications";
import Parks from "./pages/Parks";
import Ratings from "./pages/Ratings";
import People from "./pages/People";
import RoutesPage from "./pages/Routes";
import Staff from "./pages/Staff";
import Support from "./pages/Support";
import Switches from "./pages/Switches";
import Vehicles from "./pages/Vehicles";
import Waitlist from "./pages/Waitlist";
import { Mark } from "./ui";

type Page = { path: string; label: string; icon: string; component: ComponentType; show: (r: StaffRole | null, reader: boolean) => boolean };

const PAGES: Page[] = [
  { path: "", label: "Overview", icon: "◎", component: Dashboard, show: (_r, reader) => reader },
  { path: "drivers", label: "Drivers & sign-up", icon: "☺", component: Drivers, show: (r, reader) => reader || can.inviteDrivers(r) },
  { path: "vehicles", label: "Vehicles & stickers", icon: "▣", component: Vehicles, show: (r, reader) => reader || can.issueStickers(r) || can.setVehicleRoute(r) },
  { path: "routes", label: "Routes & fares", icon: "↝", component: RoutesPage, show: () => true },
  { path: "parks", label: "Parks", icon: "⌂", component: Parks, show: () => true },
  { path: "landmarks", label: "Landmarks", icon: "⚲", component: Landmarks, show: () => true },
  { path: "ratings", label: "Driver ratings", icon: "☆", component: Ratings, show: (_r, reader) => reader },
  { path: "people", label: "Riders & people", icon: "⚇", component: People, show: (r, reader) => reader || can.setUserStatus(r) },
  { path: "approvals", label: "Approvals", icon: "✓", component: Approvals, show: (_r, reader) => reader },
  { path: "notifications", label: "Notifications", icon: "♪", component: Notifications, show: (r, reader) => reader || can.message(r) },
  { path: "ads", label: "Ads", icon: "▤", component: Ads, show: (r, reader) => reader || can.message(r) },
  { path: "sponsors", label: "Sponsors", icon: "✦", component: Sponsors, show: (r, reader) => reader || can.message(r) },
  { path: "support", label: "Support chats", icon: "✉", component: Support, show: (_r, reader) => reader },
  { path: "disputes", label: "Disputes", icon: "⚑", component: Disputes, show: (_r, reader) => reader },
  { path: "deposits", label: "Deposits", icon: "₦", component: Deposits, show: (_r, reader) => reader },
  { path: "switches", label: "Switches & flags", icon: "⏻", component: Switches, show: (_r, reader) => reader },
  { path: "staff", label: "Staff", icon: "★", component: Staff, show: (r) => can.grantRoles(r) },
  { path: "audit", label: "Audit log", icon: "≡", component: Audit, show: (r) => can.readAudit(r) },
  { path: "waitlist", label: "Pilot sign-ups", icon: "✎", component: Waitlist, show: (_r, reader) => reader },
];

function useHashPath(): string {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("?")[0];
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

const ROLE_NAMES: Record<StaffRole, string> = {
  admin: "Admin",
  ops: "Operations",
  agent: "Park agent",
  marshal: "Marshal",
  support: "Support",
  auditor: "Finance auditor",
};

export default function App() {
  const s = useSession();
  const path = useHashPath();
  const [menu, setMenu] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  useEffect(() => setMenu(false), [path]);

  switch (s.stage) {
    case "loading":
      return (
        <main className="auth">
          <span className="spinner spinner-dark" aria-label="Loading" />
        </main>
      );
    case "signedOut":
      return <SignIn />;
    case "verifyEmail":
      return <VerifyEmail />;
    case "enrolMfa":
      return <EnrolMfa />;
    case "reauthMfa":
      return <ReauthMfa />;
    case "notStaff":
      return <NotStaff />;
    case "choosePassword":
      return <ChoosePassword />;
  }

  const pages = PAGES.filter((p) => p.show(s.role, s.reader));
  const page = pages.find((p) => p.path === path) ?? pages[0];
  const Current = page?.component;

  return (
    <div className={`shell${menu ? " menu-open" : ""}`}>
      <aside className="side">
        <div className="side-top">
          <a className="brand" href="#/">
            <Mark size={30} />
            <span>
              konduct <em>console</em>
            </span>
          </a>
          <button className="menu-btn" type="button" aria-expanded={menu} aria-controls="side-nav" onClick={() => setMenu((m) => !m)}>
            {menu ? "Close" : "Menu"}
          </button>
        </div>
        <nav id="side-nav" className="side-nav" aria-label="Console">
          {pages.map((p) => (
            <a key={p.path} href={`#/${p.path}`} className={p === page ? "active" : undefined} aria-current={p === page ? "page" : undefined}>
              <span className="nav-icon" aria-hidden="true">
                {p.icon}
              </span>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me">
            <b>{s.user?.email}</b>
            <span>{s.role ? ROLE_NAMES[s.role] : ""}</span>
          </div>
          <button type="button" className="link link-light" onClick={() => setChangingPassword(true)}>
            Change password
          </button>
          <button type="button" className="link link-light" onClick={s.signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{Current ? <Current key={page.path} /> : <p className="empty">Your role ({s.role}) has nothing to do in the console yet.</p>}</main>
      {changingPassword ? <ChangePasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </div>
  );
}
