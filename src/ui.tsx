import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "./lib/firebase";

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#ffc700" />
      <path d="M17 13h10v17l15-17h12L37 32l18 21H42L27 35v18H17z" fill="#0e1115" />
    </svg>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "dark" | "ghost" | "danger";
  type?: "button" | "submit";
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Spoken name and tooltip, for buttons that show only a symbol. */
  label?: string;
};

export function Button({ children, onClick, kind = "primary", type = "button", busy, disabled, small, label }: BtnProps) {
  return (
    <button type={type} className={`btn btn-${kind}${small ? " btn-sm" : ""}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy} aria-label={label} title={label}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  autoComplete?: string;
  mono?: boolean;
  required?: boolean;
  inputMode?: "numeric" | "email" | "text" | "tel";
  maxLength?: number;
  autoFocus?: boolean;
};

export function Field({ label, value, onChange, type = "text", placeholder, hint, autoComplete, mono, required, inputMode, maxLength, autoFocus }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className={mono ? "mono" : undefined}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Card({ title, children, actions, tight }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; tight?: boolean }) {
  return (
    <section className={`card${tight ? " card-tight" : ""}`}>
      {title || actions ? (
        <header className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHead({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h1>{title}</h1>
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading() {
  return (
    <p className="empty">
      <span className="spinner spinner-dark" aria-hidden="true" /> Loading…
    </p>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/** Modal dialog with a close button; Escape closes it. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? " dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

type Toast = { id: number; text: string; tone: "good" | "bad" };
const ToastCtx = createContext<(text: string, tone?: "good" | "bad") => void>(() => {});

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "good" | "bad" = "good") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/**
 * Runs a backend action with a busy flag and an error message. Returns the result, or undefined
 * when it failed (the message is in `error`).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message || "Something went wrong.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error-text" role="alert">
      {children}
    </p>
  ) : null;
}

/** Copy-to-clipboard text. */
export function Copy({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title="Copy"
    >
      <span className="mono">{label ?? text}</span>
      <span className="copy-hint">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}
