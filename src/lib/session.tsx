import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { multiFactor, onIdTokenChanged, signOut, type User } from "firebase/auth";

import { auth } from "./firebase";

export type StaffRole = "admin" | "ops" | "agent" | "marshal" | "support" | "auditor";
export const STAFF_ROLES: StaffRole[] = ["admin", "ops", "agent", "marshal", "support", "auditor"];

/**
 * Where a signed-in person is on the way to using the console. Mirrors the backend's requireStaff
 * and the Firestore staffReader rule: verified email, an enrolled authenticator, a session that
 * actually used it, and a staff role.
 */
export type Stage = "loading" | "signedOut" | "verifyEmail" | "enrolMfa" | "reauthMfa" | "notStaff" | "ready";

export type Session = {
  stage: Stage;
  user: User | null;
  role: StaffRole | null;
  /** Can read operations data in Firestore (the rules' staffReader). */
  reader: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Session, "refresh" | "signOut">>({ stage: "loading", user: null, role: null, reader: false });

  async function evaluate(user: User | null) {
    if (!user) return setState({ stage: "signedOut", user: null, role: null, reader: false });
    const token = await user.getIdTokenResult();
    const claims = token.claims as { role?: string; staff?: boolean; firebase?: { sign_in_second_factor?: string } };
    const role = claims.staff && STAFF_ROLES.includes(claims.role as StaffRole) ? (claims.role as StaffRole) : null;
    const reader = role != null && ["admin", "ops", "support", "auditor"].includes(role);
    let stage: Stage;
    if (!user.emailVerified) stage = "verifyEmail";
    else if (multiFactor(user).enrolledFactors.length === 0) stage = "enrolMfa";
    else if (!token.signInSecondFactor && !claims.firebase?.sign_in_second_factor) stage = "reauthMfa";
    else if (!role) stage = "notStaff";
    else stage = "ready";
    setState({ stage, user, role, reader });
  }

  useEffect(() => onIdTokenChanged(auth, (u) => void evaluate(u)), []);

  const value: Session = {
    ...state,
    refresh: async () => {
      const u = auth.currentUser;
      if (!u) return;
      await u.reload();
      await u.getIdToken(true);
      await evaluate(auth.currentUser);
    },
    signOut: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** What each role may do, as the backend enforces it (konduct-backend/functions/src/index.ts). */
export const can = {
  inviteDrivers: (r: StaffRole | null) => r === "agent" || r === "ops" || r === "admin",
  issueStickers: (r: StaffRole | null) => r === "agent" || r === "ops" || r === "admin",
  setVehicleStatus: (r: StaffRole | null) => r === "ops" || r === "admin",
  editRoutes: (r: StaffRole | null) => r === "ops" || r === "admin",
  editParks: (r: StaffRole | null) => r === "ops" || r === "admin",
  countBuses: (r: StaffRole | null) => r === "agent" || r === "marshal" || r === "ops" || r === "admin",
  setBusSeats: (r: StaffRole | null) => r === "admin",
  editLandmarks: (r: StaffRole | null) => r === "admin",
  setVehicleRoute: (r: StaffRole | null) => r === "agent" || r === "marshal" || r === "ops" || r === "admin",
  setUserStatus: (r: StaffRole | null) => r === "support" || r === "agent" || r === "ops" || r === "admin",
  requestKyc: (r: StaffRole | null) => r === "ops" || r === "admin",
  requestAdjustment: (r: StaffRole | null) => r === "ops" || r === "admin",
  assignDeposits: (r: StaffRole | null) => r === "ops" || r === "admin" || r === "support",
  decideApprovals: (r: StaffRole | null) => r === "ops" || r === "admin",
  handleDisputes: (r: StaffRole | null) => r === "support" || r === "ops" || r === "admin",
  answerSupport: (r: StaffRole | null) => r === "support" || r === "ops" || r === "admin",
  setSwitches: (r: StaffRole | null) => r === "admin",
  grantRoles: (r: StaffRole | null) => r === "admin",
  readAudit: (r: StaffRole | null) => r === "admin" || r === "auditor",
  message: (r: StaffRole | null) => r === "ops" || r === "admin",
};
