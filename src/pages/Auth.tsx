import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  EmailAuthProvider,
  getMultiFactorResolver,
  multiFactor,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  TotpMultiFactorGenerator,
  updatePassword,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
} from "firebase/auth";

import { auth } from "../lib/firebase";
import { useSession } from "../lib/session";
import { Button, Copy, Dialog, ErrorText, Field, Mark, Notice, useToast } from "../ui";

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
    case "auth/invalid-email":
      return "That doesn't look like an email address.";
    case "auth/weak-password":
      return "Choose a stronger password.";
    case "auth/missing-password":
      return "Enter your current password.";
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
  const [resetting, setResetting] = useState(false);

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

  if (resetting) return <ResetPassword initialEmail={email} onBack={() => setResetting(false)} />;

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
        <Button type="submit" busy={busy}>
          Continue
        </Button>
        <button type="button" className="link" onClick={() => setResetting(true)}>
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

/** Sends Firebase's reset email. The link's "Continue" button comes back to this console. */
async function sendReset(email: string) {
  try {
    await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/` });
  } catch (e) {
    // This console's address isn't on Firebase's allowed list: send the plain link instead.
    if (codeOf(e) === "auth/unauthorized-continue-uri" || codeOf(e) === "auth/invalid-continue-uri") await sendPasswordResetEmail(auth, email);
    else throw e;
  }
}

/** "Forgot your password?": the same answer whether or not the account exists. */
function ResetPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail.trim());
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const to = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return setError("Enter your staff email.");
    setBusy(true);
    setError(null);
    try {
      await sendReset(to);
    } catch (err) {
      const code = codeOf(err);
      // An unknown email gets the same answer as a known one.
      if (code !== "auth/user-not-found") {
        setBusy(false);
        return setError(authMessage(code));
      }
    }
    setBusy(false);
    setSentTo(to);
    setWait(60);
  }

  if (sentTo) {
    return (
      <Shell title="Check your email" lead={<>If <b>{sentTo}</b> has a staff account, a reset link is on its way.</>}>
        <div className="stack">
          <ol className="steps">
            <li>Open the email from Konduct and click the link.</li>
            <li>Choose a new password (at least 10 characters).</li>
            <li>Come back here and sign in with it. Your authenticator app doesn't change.</li>
          </ol>
          <p className="small">Nothing after a few minutes? Check spam or junk, and make sure the address is right.</p>
          <ErrorText>{error}</ErrorText>
          <Button onClick={onBack}>Back to sign in</Button>
          <Button kind="ghost" onClick={() => send()} busy={busy} disabled={wait > 0}>
            {wait > 0 ? `Send again in ${wait}s` : "Send it again"}
          </Button>
          <button type="button" className="link" onClick={() => setSentTo(null)}>
            Use a different email
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Reset your password" lead="We'll email you a link to choose a new one.">
      <form className="stack" onSubmit={send}>
        <Field label="Staff email" value={email} onChange={setEmail} type="email" autoComplete="username" inputMode="email" required autoFocus />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy}>
          Send reset link
        </Button>
        <button type="button" className="link" onClick={onBack}>
          Back to sign in
        </button>
      </form>
    </Shell>
  );
}

/** Staff must type their current password and an authenticator code before setting a new one. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setError("Use at least 10 characters for a staff password.");
    if (next === current) return setError("Pick a password different from the current one.");
    if (next !== again) return setError("The two new passwords don't match.");
    const user = auth.currentUser;
    if (!user?.email) return setError("Sign in again first.");
    setBusy(true);
    setError(null);
    try {
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      } catch (err) {
        if (codeOf(err) !== "auth/multi-factor-auth-required") throw err;
        const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
        const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!hint) throw Object.assign(new Error(), { code: "auth/operation-not-allowed" });
        await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.replace(/\s/g, "")));
      }
      await updatePassword(auth.currentUser!, next);
      toast("Password changed. Use the new one next time you sign in.");
      onClose();
    } catch (err) {
      const c = codeOf(err);
      setError(c === "auth/invalid-credential" || c === "auth/wrong-password" ? "Your current password isn't right." : authMessage(c));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Change your password" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Current password" value={current} onChange={setCurrent} type="password" autoComplete="current-password" required />
        <Field label="Authenticator code" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" mono maxLength={7} hint="The 6-digit code for Konduct Console." />
        <Field label="New password" value={next} onChange={setNext} type="password" autoComplete="new-password" required hint="At least 10 characters." />
        <Field label="New password again" value={again} onChange={setAgain} type="password" autoComplete="new-password" required />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} disabled={!current || code.replace(/\s/g, "").length !== 6 || !next || !again}>
          Change password
        </Button>
      </form>
    </Dialog>
  );
}
