/**
 * Firebase for the staff console. Reads come straight from Firestore, where the security rules
 * only let staff with a completed second sign-in step see operations data. Every change goes
 * through a backend callable on the Render server, which re-checks role, MFA and status.
 */
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions, httpsCallableFromURL, FunctionsError } from "firebase/functions";

const env = import.meta.env;

export const app = initializeApp({
  apiKey: (env.VITE_FIREBASE_API_KEY as string | undefined) || "AIzaSyBsD0Oh0_IkMFMLsu4jedXGUPp8TSX65Ms",
  authDomain: "konduct-10ffb.firebaseapp.com",
  projectId: "konduct-10ffb",
  storageBucket: "konduct-10ffb.firebasestorage.app",
  messagingSenderId: "1046053007846",
  appId: "1:1046053007846:web:7f62bf12cebb5af507a627",
});

export const auth = getAuth(app);
export const db = getFirestore(app);
const functions = getFunctions(app, "europe-west1");

/** The Render server (konduct-backend/functions/src/server.ts). */
export const BACKEND_URL = ((env.VITE_BACKEND_URL as string | undefined) || "https://konduct-backend.onrender.com").replace(/\/$/, "");

/** An error the backend explained. `reason` is its stable code, `message` is written for people. */
export class ApiError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export async function call<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  try {
    const res = await httpsCallableFromURL<Record<string, unknown>, T>(functions, `${BACKEND_URL}/${name}`, { timeout: 70_000 })(data);
    return res.data;
  } catch (e) {
    if (e instanceof FunctionsError) {
      const details = (e.details ?? {}) as { reason?: string };
      const generic = e.code === "functions/internal" || e.code === "functions/unavailable" || e.code === "functions/deadline-exceeded";
      const msg = details.reason ? e.message : generic ? "Couldn't reach the Konduct server. It may be waking up; try again in a minute." : e.message;
      throw new ApiError(details.reason ?? e.code.replace("functions/", ""), msg);
    }
    throw new ApiError("unknown", (e as Error).message || "Something went wrong.");
  }
}
