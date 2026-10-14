import { useEffect, useState } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";

export type Row = { id: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Live<T> = { data: T; loading: boolean; error: string | null };

function explain(e: Error & { code?: string }): string {
  if (e.code === "permission-denied") return "Your role can't see this.";
  if (e.code === "failed-precondition") return "This list needs a database index that isn't ready yet.";
  return "Couldn't load this. Check your connection.";
}

/** A live Firestore query. Pass null to wait (for example until a search term is typed). */
export function useLiveQuery(q: Query | null, key: string): Live<Row[]> {
  const [s, set] = useState<Live<Row[]>>({ data: [], loading: q != null, error: null });
  useEffect(() => {
    if (!q) {
      set({ data: [], loading: false, error: null });
      return;
    }
    set((p) => ({ ...p, loading: true, error: null }));
    return onSnapshot(
      q,
      (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (e) => set({ data: [], loading: false, error: explain(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s;
}

/** A live single document; data is null when it doesn't exist. */
export function useLiveDoc(ref: DocumentReference | null, key: string): Live<Row | null> {
  const [s, set] = useState<Live<Row | null>>({ data: null, loading: ref != null, error: null });
  useEffect(() => {
    if (!ref) {
      set({ data: null, loading: false, error: null });
      return;
    }
    return onSnapshot(
      ref,
      (d) => set({ data: d.exists() ? { id: d.id, ...d.data() } : null, loading: false, error: null }),
      (e) => set({ data: null, loading: false, error: explain(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s;
}
