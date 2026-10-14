import type { Timestamp } from "firebase/firestore";

/** "₦1,250" or "₦1,250.50". Amounts are integer kobo everywhere. */
export function naira(kobo: number | null | undefined): string {
  if (kobo == null || Number.isNaN(kobo)) return "—";
  const neg = kobo < 0;
  const abs = Math.abs(kobo);
  const whole = Math.floor(abs / 100).toLocaleString("en-NG");
  const rest = abs % 100;
  return `${neg ? "-" : ""}₦${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

type TimeLike = Timestamp | Date | number | null | undefined;

export function toDate(t: TimeLike): Date | null {
  if (t == null) return null;
  if (typeof t === "number") return new Date(t);
  if (t instanceof Date) return t;
  return typeof t.toDate === "function" ? t.toDate() : null;
}

const fmt = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });

/** "14 Oct, 09:05" in Lagos time, or "4 min ago" when recent. */
export function when(t: TimeLike): string {
  const d = toDate(t);
  if (!d) return "—";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s >= 0 && s < 60) return "just now";
  if (s >= 0 && s < 3600) return `${Math.floor(s / 60)} min ago`;
  return fmt.format(d);
}

/** "in 5h" / "3h overdue", for dispute deadlines. */
export function due(ms: number | null | undefined): string {
  if (!ms) return "—";
  const h = Math.round((ms - Date.now()) / 3_600_000);
  if (h >= 0) return h < 1 ? "due within the hour" : `due in ${h}h`;
  return `${-h}h overdue`;
}

/** Whole naira typed in a form, to kobo. Null if not a positive whole number. */
export function koboFromNaira(input: string): number | null {
  const n = Number(input.replace(/[,\s₦]/g, ""));
  return Number.isInteger(n) && n > 0 ? n * 100 : null;
}
