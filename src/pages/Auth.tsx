import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  getMultiFactorResolver,
  multiFactor,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
} from "firebase/auth";

import { auth } from "../lib/firebase";
import { useSession } from "../lib/session";
import { Button, Copy, ErrorText, Field, Mark, Notice } from "../ui";

function authMessage(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don't match a staff account.";
    case "auth/invalid-verification-code":
    case "auth/invalid-totp-code":
      return "That code isn't right. Use the current 6-digit code from your authenticator app.";
    case "auth/too-many-requests":
      return "Too many tries. Wait a few minutes, then try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/operation-not-allowed":
      return "Two-step sign-in isn't switched on for this Firebase project yet. Ask the admin to enable TOTP multi-factor authentication.";
    case "auth/requires-recent-login":
      return "For your safety, sign out and sign in again, then set up the authenticator straight away.";
    case "auth/unverified-email":
      return "Verify your email first.";
    default:
      return "Something went wrong. Try again.";
  }
}

const codeOf = (e: unknown) => (e as { code?: string }).code ?? "";

function Shell({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Mark size={36} />
          <span>
            konduct <em>console</em>
          </span>
        </div>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
      <p className="auth-foot">Staff only. Every action is recorded with your name.</p>
    </main>
  );
}

/** Email + password, then the authenticator code when the account has one. */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (resolver) {
        const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!hint) throw Object.assign(new Error(), { code: "auth/operation-not-allowed" });
        await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.replace(/\s/g, "")));
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      if (codeOf(err) === "auth/multi-factor-auth-required") {
        setResolver(getMultiFactorResolver(auth, err as MultiFactorError));
      } else {
        setError(authMessage(codeOf(err)));
      }
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setError(null);
    if (!email.includes("@")) return setError("Type your staff email above first.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      // Same answer whether or not the account exists.
    }
    setInfo(`If ${email.trim()} has an account, a reset link is on its way.`);
  }

  if (resolver) {
    return (
      <Shell title="Enter your code" lead="Open your authenticator app and type the 6-digit code for Konduct Console.">
        <form className="stack" onSubmit={submit}>
          <Field label="Authenticator code" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" mono maxLength={7} autoFocus />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" busy={busy} disabled={code.replace(/\s/g, "").length !== 6}>
            Sign in
          </Button>
          <button type="button" className="link" onClick={() => setResolver(null)}>
            Use a different account
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Sign in" lead="Use the email and password of your Konduct staff account.">
      <form className="stack" onSubmit={submit}>
        <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="username" inputMode="email" required autoFocus />
        <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
        <ErrorText>{error}</ErrorText>
        {info ? <Notice>{info}</Notice> : null}
        <Button type="submit" busy={busy}>
          Continue
        </Button>
        <button type="button" className="link" onClick={forgot}>
          Forgot your password?
        </button>
      </form>
    </Shell>
  );
}

export function VerifyEmail() {
  const s = useSession();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendEmailVerification(s.user!);
      setSent(true);
    } catch (e) {
      setError(authMessage(codeOf(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Verify your email" lead={<>Staff accounts need a confirmed email. We'll send a link to <b>{s.user?.email}</b>.</>}>
      <div className="stack">
        {sent ? <Notice tone="good">Sent. Open the link in the email, then come back and press "I've verified it".</Notice> : null}
        <ErrorText>{error}</ErrorText>
        <Button onClick={send} busy={busy} kind={sent ? "ghost" : "primary"}>
          {sent ? "Send it again" : "Send verification link"}
        </Button>
        {sent ? <Button onClick={s.refresh}>I've verified it</Button> : null}
        <button type="button" className="link" onClick={s.signOut}>
          Sign out
        </button>
      </div>
    </Shell>
  );
}

/** First sign-in: link an authenticator app (TOTP) as the second step. */
export function EnrolMfa() {
  const s = useSession();
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const session = await multiFactor(s.user!).getSession();
      const sec = await TotpMultiFactorGenerator.generateSecret(session);
      setSecret(sec);
      setQr(await QRCode.toDataURL(sec.generateQrCodeUrl(s.user!.email ?? "staff", "Konduct Console"), { margin: 1, width: 220 }));
    } catch (e) {
      setError(authMessage(codeOf(e)));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      await multiFactor(s.user!).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.replace(/\s/g, "")), "Authenticator app");
      setDone(true);
    } catch (err) {
      setError(authMessage(codeOf(err)));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell title="Authenticator linked" lead="From now on you'll sign in with your password and a code from the app. Sign in once more to start.">
        <Button onClick={s.signOut}>Sign in again</Button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Set up two-step sign-in"
      lead="Konduct moves money, so staff sign in with a password and a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar)."
    >
      {!secret ? (
        <div className="stack">
          <ErrorText>{error}</ErrorText>
          <Button onClick={start} busy={busy}>
            Set up my authenticator
          </Button>
          <button type="button" className="link" onClick={s.signOut}>
            Sign out
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={confirm}>
          <ol className="steps">
            <li>In your authenticator app, add an account and scan this code.</li>
          </ol>
          {qr ? <img className="qr" src={qr} width={220} height={220} alt="QR code for your authenticator app" /> : null}
          <p className="small">
            Can't scan? Enter this key: <Copy text={secret.secretKey} />
          </p>
          <ol className="steps" start={2}>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <Field label="Code from the app" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" mono maxLength={7} />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" busy={busy} disabled={code.replace(/\s/g, "").length !== 6}>
            Link authenticator
          </Button>
        </form>
      )}
    </Shell>
  );
}

/** Signed in some other way (for example straight after enrolling): sign in again with the code. */
export function ReauthMfa() {
  const s = useSession();
  return (
    <Shell title="Sign in with your code" lead="This session didn't use your authenticator. Sign in again with your password and the 6-digit code.">
      <Button onClick={s.signOut}>Sign in again</Button>
    </Shell>
  );
}

export function NotStaff() {
  const s = useSession();
  const [checking, setChecking] = useState(false);
  useEffect(() => setChecking(false), [s.stage]);
  return (
    <Shell
      title="No staff role yet"
      lead="You're signed in, but this account hasn't been given a staff role. Send an admin your account ID below; once they grant a role and a second admin approves it, sign in again."
    >
      <div className="stack">
        <p className="small">
          Account: <b>{s.user?.email}</b>
        </p>
        <Copy text={s.user?.uid ?? ""} />
        <Button
          kind="ghost"
          busy={checking}
          onClick={() => {
            setChecking(true);
            void s.refresh().finally(() => setChecking(false));
          }}
        >
          Check again
        </Button>
        <button type="button" className="link" onClick={s.signOut}>
          Sign out
        </button>
      </div>
    </Shell>
  );
}
