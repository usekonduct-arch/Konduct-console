import { useState, type FormEvent } from "react";
import { doc } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { naira, when } from "../lib/format";
import { useLiveDoc, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, ErrorText, Field, Loading, useAction, useToast } from "../ui";

type AppKey = "rider" | "driver";
const APPS: { key: AppKey; label: string }[] = [
  { key: "rider", label: "Konduct (students)" },
  { key: "driver", label: "Konduct Driver" },
];

/**
 * Two cards for the Switches page: which app builds may still be used (config/app), and referral
 * rewards (config/referrals). Both are admin-only and audited.
 */
export function AppVersionsCard() {
  const s = useSession();
  const cfg = useLiveDoc(doc(db, "config/app"), "config-app");
  const [edit, setEdit] = useState<AppKey | null>(null);
  const admin = can.setSwitches(s.role);
  const v: Partial<Row> = cfg.data ?? {};
  return (
    <Card title="App versions">
      {cfg.loading ? (
        <Loading />
      ) : (
        <ul className="switches">
          {APPS.map((a) => {
            const e = v[a.key] as { minBuild: number; latestBuild: number; updateUrl: string } | undefined;
            return (
              <li key={a.key}>
                <div>
                  <b>{a.label}</b>
                  <span className="muted">
                    {e ? `Builds below ${e.minBuild} must update. ${e.latestBuild > e.minBuild ? `Builds below ${e.latestBuild} are asked to.` : ""}` : "Every build is allowed."}
                  </span>
                </div>
                <Badge tone={e && e.minBuild > 0 ? "warn" : "good"}>{e ? `min ${e.minBuild} · latest ${e.latestBuild}` : "No minimum"}</Badge>
                {admin ? (
                  <Button small kind="ghost" onClick={() => setEdit(a.key)}>
                    Change
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="small muted">
        The build number is the part after <span className="mono">+</span> in the app's version (pubspec.yaml). Raising the minimum shows everyone on an older build an
        "Update Konduct" screen with your link and nothing else, so raise it only after the new build is downloadable.
        {v.updatedAt ? ` Last changed ${when(v.updatedAt)}.` : ""}
      </p>
      {edit ? <VersionDialog app={edit} current={v[edit]} onClose={() => setEdit(null)} /> : null}
    </Card>
  );
}

function VersionDialog({ app, current, onClose }: { app: AppKey; current?: { minBuild: number; latestBuild: number; updateUrl: string }; onClose: () => void }) {
  const [min, setMin] = useState(String(current?.minBuild ?? 0));
  const [latest, setLatest] = useState(String(current?.latestBuild ?? 0));
  const [url, setUrl] = useState(current?.updateUrl ?? "https://konduct.com.ng/get");
  const [reason, setReason] = useState("");
  const a = useAction();
  const toast = useToast();
  const n = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const ok = !Number.isNaN(n(min)) && !Number.isNaN(n(latest)) && n(latest) >= n(min) && /^https:\/\/\S+$/.test(url.trim()) && reason.trim().length >= 5;

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetAppVersions", { [app]: { minBuild: n(min), latestBuild: n(latest), updateUrl: url.trim() }, reason: reason.trim() }));
    if (r) {
      toast("Saved. Apps check it each time they open.");
      onClose();
    }
  }
  return (
    <Dialog title={`${APPS.find((a) => a.key === app)!.label}: versions`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Oldest build that may still be used" value={min} onChange={setMin} inputMode="numeric" mono hint="Older builds can only update. 0 allows every build." />
        <Field label="Latest build" value={latest} onChange={setLatest} inputMode="numeric" mono hint="Older builds see a gentle 'Update available' note." />
        <Field label="Where to get the update (https)" value={url} onChange={setUrl} mono />
        <Field label="Why (kept in the audit log)" value={reason} onChange={setReason} required />
        {n(latest) < n(min) ? <ErrorText>The latest build can't be lower than the minimum.</ErrorText> : null}
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!ok}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

export function ReferralsCard() {
  const s = useSession();
  const cfg = useLiveDoc(doc(db, "config/referrals"), "config-referrals");
  const [edit, setEdit] = useState(false);
  const admin = can.setSwitches(s.role);
  const v: Partial<Row> = cfg.data ?? {};
  const on = v.enabled === true;
  return (
    <Card title="Referral rewards">
      {cfg.loading ? (
        <Loading />
      ) : (
        <ul className="switches">
          <li>
            <div>
              <b>Invite a friend</b>
              <span className="muted">
                {on
                  ? `After a new rider's first fare: ${naira(v.bonusKobo ?? 0)} to the friend who invited them, ${naira(v.welcomeKobo ?? 0)} to the new rider. At most ${v.maxPerReferrer ?? 20} rewarded friends per rider.`
                  : "Off. Riders still see their code but nobody is paid."}
              </span>
            </div>
            <Badge tone={on ? "good" : "neutral"}>{on ? "On" : "Off"}</Badge>
            {admin ? (
              <Button small kind="ghost" onClick={() => setEdit(true)}>
                Change
              </Button>
            ) : null}
          </li>
        </ul>
      )}
      <p className="small muted">Rewards are Konduct's money (ledger account platform_promotions) and land in riders' wallets straight away.{v.updatedAt ? ` Last changed ${when(v.updatedAt)}.` : ""}</p>
      {edit ? <ReferralDialog current={v} onClose={() => setEdit(false)} /> : null}
    </Card>
  );
}

function ReferralDialog({ current, onClose }: { current: Partial<Row>; onClose: () => void }) {
  const [enabled, setEnabled] = useState(current.enabled === true);
  const [bonus, setBonus] = useState(String((current.bonusKobo ?? 0) / 100));
  const [welcome, setWelcome] = useState(String((current.welcomeKobo ?? 0) / 100));
  const [max, setMax] = useState(String(current.maxPerReferrer ?? 20));
  const [reason, setReason] = useState("");
  const a = useAction();
  const toast = useToast();
  // Whole naira, up to ₦2,000 each side (backend RULES.maxReferralBonusKobo).
  const naira_ = (s: string) => (/^\d{1,4}$/.test(s.trim()) && Number(s) <= 2000 ? Number(s.trim()) * 100 : NaN);
  const count = (s: string) => (/^\d{1,3}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 500 ? Number(s.trim()) : NaN);
  const valid = [naira_(bonus), naira_(welcome), count(max)].every((x) => !Number.isNaN(x)) && reason.trim().length >= 5 && (!enabled || naira_(bonus) + naira_(welcome) > 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await a.run(() => call("staffSetReferrals", { enabled, bonusKobo: naira_(bonus), welcomeKobo: naira_(welcome), maxPerReferrer: count(max), reason: reason.trim() }));
    if (r) {
      toast(enabled ? "Saved. The next new rider's first fare pays out at these amounts." : "Referral rewards are off.");
      onClose();
    }
  }
  return (
    <Dialog title="Referral rewards" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Check label="Pay referral rewards" checked={enabled} onChange={setEnabled} />
        <Field label="Reward for the rider who invited (₦)" value={bonus} onChange={setBonus} inputMode="numeric" mono hint="Whole naira, up to ₦2,000." />
        <Field label="Welcome bonus for the new rider (₦)" value={welcome} onChange={setWelcome} inputMode="numeric" mono hint="Whole naira, up to ₦2,000." />
        <Field label="Most rewarded friends per rider" value={max} onChange={setMax} inputMode="numeric" mono />
        <Field label="Why (kept in the audit log)" value={reason} onChange={setReason} required />
        <ErrorText>{a.error}</ErrorText>
        <Button type="submit" busy={a.busy} disabled={!valid}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}
