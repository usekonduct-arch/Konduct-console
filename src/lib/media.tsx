/**
 * Images for ads and notifications. The free Firebase plan has no Storage, so the console crops
 * and shrinks each picture to its standard size here, then the Render server keeps it in
 * Firestore and serves it at /media/<id> (konduct-backend/functions/src/domain/messaging.ts).
 */
import { useRef, useState } from "react";

import { call } from "./firebase";
import { ErrorText } from "../ui";

/** The sizes the apps lay ads out at. Uploads are cropped to exactly these. */
export const SIZES = {
  carousel: { width: 1200, height: 600, label: "1200 × 600 px (2:1)" },
  popup: { width: 1080, height: 1350, label: "1080 × 1350 px (4:5)" },
  notice: { width: 1200, height: 600, label: "1200 × 600 px (2:1)" },
} as const;
export type SizeName = keyof typeof SIZES;

const MAX_BYTES = 650 * 1024; // the server takes up to 700 KB

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture the browser can open."));
    };
    img.src = url;
  });
}

/** Crops the middle of the picture to fill the size, then saves a JPEG small enough to upload. */
export async function fitImage(file: File, size: SizeName): Promise<string> {
  const { width, height } = SIZES[size];
  const img = await load(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  for (const q of [0.8, 0.72, 0.64, 0.56, 0.5]) {
    const data = canvas.toDataURL("image/jpeg", q).split(",")[1];
    if ((data.length * 3) / 4 <= MAX_BYTES) return data;
  }
  throw new Error("That picture is too detailed to shrink under 700 KB. Try a simpler one.");
}

export async function uploadImage(file: File, size: SizeName): Promise<string> {
  const data = await fitImage(file, size);
  const r = await call<{ url: string }>("staffUploadMedia", { contentType: "image/jpeg", data });
  return r.url;
}

/** Upload a picture (cropped to the standard size) or paste an https:// address, with a preview. */
export function ImageField({ label, size, value, onChange, optional }: { label: string; size: SizeName; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = SIZES[size];

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(file, size));
    } catch (e) {
      setError((e as Error).message || "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="field">
      <span className="field-label">
        {label}
        {optional ? " (optional)" : ""}
      </span>
      <div className="image-field">
        <div className="image-preview" style={{ aspectRatio: `${s.width} / ${s.height}` }}>
          {value ? <img src={value} alt="" /> : <span className="muted small">{s.label}</span>}
        </div>
        <div className="stack image-actions">
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            <span>{value ? "Replace picture" : "Upload picture"}</span>
          </button>
          {value ? (
            <button type="button" className="link" onClick={() => onChange("")}>
              Remove
            </button>
          ) : null}
          <span className="field-hint">Cropped to {s.label} automatically.</span>
        </div>
      </div>
      <input className="mono" type="url" value={value} placeholder="…or paste an https:// image address" onChange={(e) => onChange(e.target.value.trim())} />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Where a message or ad leads: a web page, or a screen in the app. */
export const APP_LINKS: { value: string; label: string; app: "rider" | "driver" | "all" }[] = [
  { value: "app:topup", label: "Rider app: Top up", app: "rider" },
  { value: "app:scan", label: "Rider app: Scan to pay", app: "rider" },
  { value: "app:withdraw", label: "Rider app: Withdraw", app: "rider" },
  { value: "app:activity", label: "Rider app: Activity", app: "rider" },
  { value: "app:payout", label: "Driver app: Pay out now", app: "driver" },
  { value: "app:bank", label: "Driver app: Bank account", app: "driver" },
  { value: "app:account", label: "Either app: Account", app: "all" },
];

export const validLink = (v: string) => v === "" || /^https:\/\/\S+$/.test(v) || /^app:[a-z_]{2,30}$/.test(v);

/** A link box with the app shortcuts one click away. */
export function LinkField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const bad = !validLink(value);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="https://… or pick a screen" list="konduct-app-links" />
      <datalist id="konduct-app-links">
        {APP_LINKS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </datalist>
      <span className={bad ? "error-text" : "field-hint"}>{bad ? "Use an https:// address or an app: screen from the list." : (hint ?? "Web pages open inside the app.")}</span>
    </label>
  );
}
