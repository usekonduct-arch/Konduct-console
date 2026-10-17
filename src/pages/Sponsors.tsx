import { useMemo, useState, type FormEvent } from "react";
import { collection, doc, orderBy, query, where } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { koboFromNaira, naira, when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { ImageField } from "../lib/media";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";

/**
 * Sponsors and what they buy (konduct-backend domain/sponsors.ts): a budget funded from their bank
 * transfer, sponsored-ride offers, Wrapped sponsorships, ads, and the report that shows them what
 * they got. Numbers come from the ledger (rides) and from adstats.ts (views, taps, shares).
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (ms: number | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);
/** A Lagos calendar day, "2026-10-17", as the backend keys its daily counts. */
const lagosDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(ms));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const num = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-NG") : "0");

function offerState(c: Row, now = Date.now()): { label: string; tone: "good" | "warn" | "neutral" | "bad" } {
  if (!c.active) return { label: "Off", tone: "neutral" };
  if (now < c.startsAtMs) return { label: "Scheduled", tone: "warn" };
  if (now >= c.endsAtMs) return { label: "Ended", tone: "bad" };
  return { label: "Live", tone: "good" };
}

function Logo({ url, size = 36 }: { url?: string; size?: number }) {
  return <img className="sponsor-logo" src={url || undefined} alt="" style={{ width: size, height: size }} />;
}

export default function Sponsors() {
  const s = useSession();
  const allowed = can.message(s.role);
  const sponsors = useLiveQuery(query(collection(db, "sponsors"), orderBy("name")), "sponsors");
  const offers = useLiveQuery(query(collection(db, "rideCampaigns"), orderBy("startsAtMs", "desc")), "rideCampaigns");
  const wrapped = useLiveQuery(query(collection(db, "wrappedSponsors"), orderBy("month", "desc")), "wrappedSponsors");
  const [editSponsor, setEditSponsor] = useState<Row | "new" | null>(null);
  const [fund, setFund] = useState<Row | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const [editOffer, setEditOffer] = useState<Row | "new" | null>(null);
  const [editWrapped, setEditWrapped] = useState<Row | "new" | null>(null);

  return (
    <>
      <PageHead kicker="Sponsors" title="Sponsors, sponsored rides and Wrapped">
        {allowed ? <Button onClick={() => setEditSponsor("new")}>New sponsor</Button> : null}
      </PageHead>
      <Notice>
        <b>How sponsorship works.</b> The sponsor pays by bank transfer to Konduct's account. It shows up in <b>Deposits</b> as unmatched; use <b>Fund</b> here to turn it into their
        budget (an admin approves). A <b>sponsored ride offer</b> then pays each rider's own seat from that budget while it's live; drivers still get the full fare. Their logo shows
        on the rider's screen before paying and on the receipt. A <b>Wrapped sponsorship</b> puts their logo on that month's Wrapped and its share card. Pick the sponsor on an{" "}
        <b>ad</b> too, and everything lands in their <b>Report</b>.
      </Notice>

      <Card title="Sponsors" tight>
        {sponsors.loading ? (
          <Loading />
        ) : sponsors.error ? (
          <Empty>{sponsors.error}</Empty>
        ) : sponsors.data.length === 0 ? (
          <Empty>No sponsors yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sponsor</th>
                  <th className="num">Budget left</th>
                  <th className="num">Funded</th>
                  <th>Contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sponsors.data.map((sp) => (
                  <SponsorRow key={sp.id} sponsor={sp} canEdit={allowed} onEdit={() => setEditSponsor(sp)} onFund={() => setFund(sp)} onReport={() => setReport(sp)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Sponsored ride offers" actions={allowed && sponsors.data.length ? <Button small kind="ghost" onClick={() => setEditOffer("new")}>New offer</Button> : null} tight>
        {offers.loading ? (
          <Loading />
        ) : offers.data.length === 0 ? (
          <Empty>No sponsored ride offers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Offer</th>
                  <th>When</th>
                  <th>Limits</th>
                  <th className="num">Rides</th>
                  <th className="num">Riders</th>
                  <th className="num">Spent</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {offers.data.map((c) => {
                  const st = offerState(c);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="ad-row">
                          <Logo url={c.logoUrl} />
                          <div>
                            <b>{c.title}</b>
                            <div className="muted small">{c.sponsorName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="small">
                        {when(c.startsAtMs)} → {when(c.endsAtMs)}
                        <div className="muted">{c.routeIds?.length ? `${c.routeIds.length} route(s)` : "All routes"}</div>
                      </td>
                      <td className="small">
                        {c.perRiderPerDay}/rider/day · {c.perDriverPerDay}/driver/day
                        {c.maxSpendKobo ? <div className="muted">Cap {naira(c.maxSpendKobo)}</div> : null}
                      </td>
                      <td className="num mono">{num(c.rides)}</td>
                      <td className="num mono">{num(c.uniqueRiders)}</td>
                      <td className="num mono">{naira(c.spentKobo ?? 0)}</td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="right">
                        {allowed ? (
                          <Button small kind="ghost" onClick={() => setEditOffer(c)}>
                            Edit
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Wrapped sponsorships" actions={allowed && sponsors.data.length ? <Button small kind="ghost" onClick={() => setEditWrapped("new")}>Sponsor a month</Button> : null} tight>
        {wrapped.loading ? (
          <Loading />
        ) : wrapped.data.length === 0 ? (
          <Empty>No Wrapped sponsorships yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Sponsor</th>
                  <th>Shown in</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wrapped.data.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.month}</td>
                    <td>
                      <div className="ad-row">
                        <Logo url={w.logoUrl} size={28} />
                        <b>{w.sponsorName}</b>
                      </div>
                    </td>
                    <td>{w.audience === "all" ? "Both apps" : w.audience === "rider" ? "Rider app" : "Driver app"}</td>
                    <td>{w.active ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</td>
                    <td className="right">
                      {allowed ? (
                        <Button small kind="ghost" onClick={() => setEditWrapped(w)}>
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editSponsor ? <SponsorDialog sponsor={editSponsor === "new" ? null : editSponsor} onClose={() => setEditSponsor(null)} /> : null}
      {fund ? <FundDialog sponsor={fund} onClose={() => setFund(null)} /> : null}
      {report ? <ReportDialog sponsor={report} onClose={() => setReport(null)} /> : null}
      {editOffer ? <OfferDialog offer={editOffer === "new" ? null : editOffer} sponsors={sponsors.data} onClose={() => setEditOffer(null)} /> : null}
      {editWrapped ? <WrappedDialog item={editWrapped === "new" ? null : editWrapped} sponsors={sponsors.data} onClose={() => setEditWrapped(null)} /> : null}
    </>
  );
}

function SponsorRow({ sponsor, canEdit, onEdit, onFund, onReport }: { sponsor: Row; canEdit: boolean; onEdit: () => void; onFund: () => void; onReport: () => void }) {
  const wallet = useLiveDoc(doc(db, `wallets/sponsor_${sponsor.id}`), `wallet-${sponsor.id}`);
  return (
    <tr>
      <td>
        <div className="ad-row">
          <Logo url={sponsor.logoUrl} size={44} />
          <div>
            <b>{sponsor.name}</b>
            {!sponsor.active ? (
              <div>
                <Badge>Inactive</Badge>
              </div>
            ) : null}
            {sponsor.website ? <div className="muted small mono">{sponsor.website}</div> : null}
          </div>
        </div>
      </td>
      <td className="num mono">{wallet.loading ? "…" : naira(wallet.data?.balanceKobo ?? 0)}</td>
      <td className="num mono">{naira(sponsor.fundedKobo ?? 0)}</td>
      <td className="small">
        {sponsor.contactName || "—"}
        <div className="muted">{[sponsor.contactEmail, sponsor.contactPhone].filter(Boolean).join(" · ")}</div>
      </td>
      <td className="right nowrap">
        <Button small kind="ghost" onClick={onReport}>
          Report
        </Button>{" "}
        {canEdit ? (
          <>
            <Button small kind="ghost" onClick={onFund}>
              Fund
            </Button>{" "}
            <Button small kind="ghost" onClick={onEdit}>
              Edit
            </Button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function SponsorDialog({ sponsor, onClose }: { sponsor: Row | null; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const [name, setName] = useState<string>(sponsor?.name ?? "");
  const [logoUrl, setLogoUrl] = useState<string>(sponsor?.logoUrl ?? "");
  const [website, setWebsite] = useState<string>(sponsor?.website ?? "");
  const [contactName, setContactName] = useState<string>(sponsor?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState<string>(sponsor?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState<string>(sponsor?.contactPhone ?? "");
  const [notes, setNotes] = useState<string>(sponsor?.notes ?? "");
  const [active, setActive] = useState<boolean>(sponsor?.active ?? true);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!logoUrl) return a.setError("Upload the sponsor's logo: it shows in the apps.");
    const r = await a.run(() =>
      call("staffUpsertSponsor", { ...(sponsor ? { id: sponsor.id } : {}), name: name.trim(), logoUrl, website: website.trim(), contactName, contactEmail, contactPhone, notes, active }),
    );
    if (r) {
      toast(sponsor ? "Sponsor saved." : "Sponsor added.");
      onClose();
    }
  }

  return (
    <Dialog title={sponsor ? `Edit ${sponsor.name}` : "New sponsor"} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <Field label="Name" value={name} onChange={setName} maxLength={60} placeholder="MTN Nigeria" />
        <ImageField label="Logo" size="logo" value={logoUrl} onChange={setLogoUrl} />
        <Field label="Website (optional)" value={website} onChange={(v) => setWebsite(v.trim())} placeholder="https://…" mono />
        <div className="grid-2">
          <Field label="Contact person (optional)" value={contactName} onChange={setContactName} maxLength={80} />
          <Field label="Contact email (optional)" value={contactEmail} onChange={setContactEmail} maxLength={120} />
        </div>
        <div className="grid-2">
          <Field label="Contact phone (optional)" value={contactPhone} onChange={setContactPhone} maxLength={30} />
          <Check label="Active" checked={active} onChange={setActive} />
        </div>
        <label className="field">
          <span className="field-label">Notes (optional)</span>
          <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What they bought, invoice numbers…" />
        </label>
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            {sponsor ? "Save" : "Add sponsor"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FundDialog({ sponsor, onClose }: { sponsor: Row; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const deposits = useLiveQuery(query(collection(db, "deposits"), where("status", "==", "unmatched")), "deposits-unmatched");
  const [pick, setPick] = useState<string>("");

  async function send() {
    if (!pick) return a.setError("Pick the sponsor's transfer.");
    const r = await a.run(() => call("staffFundSponsor", { depositId: pick, sponsorId: sponsor.id }));
    if (r) {
      toast("Sent for approval. An admin approves it in Approvals.");
      onClose();
    }
  }

  return (
    <Dialog title={`Fund ${sponsor.name}`} onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">
          Pick the bank transfer the sponsor made. It becomes their budget once an admin approves it. Check the sender and amount against their payment receipt or invoice.
        </p>
        {deposits.loading ? (
          <Loading />
        ) : deposits.data.length === 0 ? (
          <Empty>No unmatched deposits. The sponsor's transfer shows up here once it lands in Konduct's account.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {deposits.data.map((d) => (
                  <tr key={d.id} className={pick === d.id ? "selected" : ""} onClick={() => setPick(d.id)} style={{ cursor: "pointer" }}>
                    <td>
                      <input type="radio" name="dep" checked={pick === d.id} onChange={() => setPick(d.id)} aria-label={`Deposit of ${naira(d.amountKobo)}`} />
                    </td>
                    <td>
                      <b>{d.senderName ?? "Unknown sender"}</b>
                      <div className="muted small">{d.narration || "—"}</div>
                    </td>
                    <td className="num mono">{naira(d.amountKobo)}</td>
                    <td className="muted small">{when(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button onClick={send} busy={a.busy} disabled={!pick}>
            Request funding
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function OfferDialog({ offer, sponsors, onClose }: { offer: Row | null; sponsors: Row[]; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const routes = useLiveQuery(query(collection(db, "routes")), "routes");
  const [sponsorId, setSponsorId] = useState<string>(offer?.sponsorId ?? sponsors[0]?.id ?? "");
  const [title, setTitle] = useState<string>(offer?.title ?? "Free rides to lectures");
  const [message, setMessage] = useState<string>(offer?.message ?? "");
  const [starts, setStarts] = useState(toLocal(offer?.startsAtMs ?? Date.now()));
  const [ends, setEnds] = useState(toLocal(offer?.endsAtMs ?? Date.now() + 7 * 86_400_000));
  const [routeIds, setRouteIds] = useState<string[]>(offer?.routeIds ?? []);
  const [perRider, setPerRider] = useState(String(offer?.perRiderPerDay ?? 2));
  const [perDriver, setPerDriver] = useState(String(offer?.perDriverPerDay ?? 60));
  const [cap, setCap] = useState(offer?.maxSpendKobo ? String(offer.maxSpendKobo / 100) : "");
  const [active, setActive] = useState<boolean>(offer?.active ?? true);

  async function save(e: FormEvent) {
    e.preventDefault();
    const startsAtMs = fromLocal(starts);
    const endsAtMs = fromLocal(ends);
    if (!startsAtMs || !endsAtMs || endsAtMs <= startsAtMs) return a.setError("Set a start and an end after it.");
    const r1 = Number(perRider);
    const r2 = Number(perDriver);
    if (!Number.isInteger(r1) || r1 < 1 || r1 > 4) return a.setError("Rides per rider per day: 1 to 4.");
    if (!Number.isInteger(r2) || r2 < 1 || r2 > 300) return a.setError("Rides per driver per day: 1 to 300.");
    const maxSpendKobo = cap.trim() ? koboFromNaira(cap) : 0;
    if (maxSpendKobo === null) return a.setError("The spend cap is whole naira, or leave it empty.");
    const r = await a.run(() =>
      call("staffUpsertRideCampaign", {
        ...(offer ? { id: offer.id } : {}),
        sponsorId,
        title: title.trim(),
        message: message.trim(),
        startsAtMs,
        endsAtMs,
        routeIds,
        perRiderPerDay: r1,
        perDriverPerDay: r2,
        maxSpendKobo,
        active,
      }),
    );
    if (r) {
      toast(offer ? "Offer saved." : "Offer created.");
      onClose();
    }
  }

  return (
    <Dialog title={offer ? "Edit sponsored ride offer" : "New sponsored ride offer"} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <Notice>
          While it's live, the sponsor pays the rider's own seat on every Konduct scan (friends on the same scan are still paid by the rider). The rider sees the sponsor's logo
          and “This ride is on …” before paying, and on the receipt. Rides stop being sponsored when the budget or the spend cap runs out.
        </Notice>
        {offer ? (
          <p className="small">
            Sponsor: <b>{offer.sponsorName}</b>
          </p>
        ) : (
          <Select label="Sponsor" value={sponsorId} onChange={setSponsorId} options={sponsors.map((sp) => ({ value: sp.id, label: sp.name }))} />
        )}
        <Field label="Title riders see" value={title} onChange={setTitle} maxLength={60} placeholder="Free rides to lectures" />
        <Field label="Line under it (optional)" value={message} onChange={setMessage} maxLength={160} placeholder="Courtesy of MTN, all exam week" />
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Starts</span>
            <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Ends</span>
            <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span className="field-label">Routes (none ticked = every route)</span>
          <div className="checks">
            {routes.data.map((r) => (
              <Check
                key={r.id}
                label={r.name}
                checked={routeIds.includes(r.id)}
                onChange={(on) => setRouteIds((ids) => (on ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
              />
            ))}
          </div>
        </div>
        <div className="grid-2">
          <Field label="Sponsored rides per rider per day" value={perRider} onChange={setPerRider} inputMode="numeric" mono hint="1 to 4. Stops one person using up the budget." />
          <Field label="Sponsored rides per driver per day" value={perDriver} onChange={setPerDriver} inputMode="numeric" mono hint="Stops a driver and friends draining it." />
        </div>
        <div className="grid-2">
          <Field label="Spend cap in naira (optional)" value={cap} onChange={setCap} inputMode="numeric" mono hint="Empty: until the sponsor's budget runs out." />
          <Check label="Switched on" checked={active} onChange={setActive} />
        </div>
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            {offer ? "Save offer" : "Create offer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function WrappedDialog({ item, sponsors, onClose }: { item: Row | null; sponsors: Row[]; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const now = new Date();
  const [month, setMonth] = useState<string>(item?.month ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [sponsorId, setSponsorId] = useState<string>(item?.sponsorId ?? sponsors[0]?.id ?? "");
  const [message, setMessage] = useState<string>(item?.message ?? "");
  const [link, setLink] = useState<string>(item?.link ?? "");
  const [audience, setAudience] = useState<"all" | "rider" | "driver">(item?.audience ?? "all");
  const [active, setActive] = useState<boolean>(item?.active ?? true);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (link && !/^https:\/\/\S+$/.test(link)) return a.setError("The link must start with https://");
    const r = await a.run(() => call("staffSetWrappedSponsor", { month, sponsorId, message: message.trim(), link, audience, active }));
    if (r) {
      toast("Saved. The month's Wrapped shows the logo straight away.");
      onClose();
    }
  }

  return (
    <Dialog title={item ? `Wrapped ${item.month}` : "Sponsor a month's Wrapped"} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <Notice>
          “Brought to you by” and the sponsor's logo on every page of that month's Wrapped, and on the picture people share to Instagram and WhatsApp. Views, shares and taps
          are counted for their report.
        </Notice>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Month</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={Boolean(item)} />
          </label>
          <Select label="Sponsor" value={sponsorId} onChange={setSponsorId} options={sponsors.map((sp) => ({ value: sp.id, label: sp.name }))} />
        </div>
        <Field label="Message (optional)" value={message} onChange={setMessage} maxLength={120} />
        <Field label="Tapping the logo opens (optional)" value={link} onChange={(v) => setLink(v.trim())} placeholder="https://…" mono />
        <div className="grid-2">
          <Select<"all" | "rider" | "driver">
            label="Show in"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "all", label: "Both apps" },
              { value: "rider", label: "Rider app only" },
              { value: "driver", label: "Driver app only" },
            ]}
          />
          <Check label="Switched on" checked={active} onChange={setActive} />
        </div>
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ report */

type Totals = { views: number; taps: number; shares: number; uniques: number };
const zero = (): Totals => ({ views: 0, taps: 0, shares: 0, uniques: 0 });

function ReportDialog({ sponsor, onClose }: { sponsor: Row; onClose: () => void }) {
  const [from, setFrom] = useState(lagosDay(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(lagosDay(Date.now()));
  const wallet = useLiveDoc(doc(db, `wallets/sponsor_${sponsor.id}`), `wallet-${sponsor.id}`);
  const rideDays = useLiveQuery(query(collection(db, "campaignDays"), where("sponsorId", "==", sponsor.id), where("day", ">=", from), where("day", "<=", to), orderBy("day")), `cd-${sponsor.id}-${from}-${to}`);
  const adDays = useLiveQuery(query(collection(db, "adStatsDays"), where("sponsorId", "==", sponsor.id), where("day", ">=", from), where("day", "<=", to), orderBy("day")), `ad-${sponsor.id}-${from}-${to}`);
  const lifetime = useLiveQuery(query(collection(db, "adStats"), where("sponsorId", "==", sponsor.id)), `adl-${sponsor.id}`);
  const offers = useLiveQuery(query(collection(db, "rideCampaigns"), where("sponsorId", "==", sponsor.id)), `rc-${sponsor.id}`);
  const ads = useLiveQuery(query(collection(db, "ads"), where("sponsorId", "==", sponsor.id)), `ads-${sponsor.id}`);

  const rides = useMemo(() => {
    const t = { rides: 0, spentKobo: 0, offers: 0, riderDays: 0 };
    for (const d of rideDays.data) {
      t.rides += d.rides ?? 0;
      t.spentKobo += d.spentKobo ?? 0;
      t.offers += d.offers ?? 0;
      t.riderDays += d.riders ?? 0;
    }
    return t;
  }, [rideDays.data]);
  const byTarget = useMemo(() => {
    const ad = zero();
    const wrapped = zero();
    for (const d of adDays.data) {
      const t = d.target === "wrapped" ? wrapped : ad;
      t.views += d.views ?? 0;
      t.taps += d.taps ?? 0;
      t.shares += d.shares ?? 0;
      t.uniques += d.uniques ?? 0;
    }
    return { ad, wrapped };
  }, [adDays.data]);
  const reach = useMemo(() => {
    let ad = 0;
    let wrapped = 0;
    for (const s of lifetime.data) (s.target === "wrapped" ? (wrapped += s.reach ?? 0) : (ad += s.reach ?? 0));
    return { ad, wrapped };
  }, [lifetime.data]);
  const uniqueRiders = offers.data.reduce((n, c) => n + (c.uniqueRiders ?? 0), 0);
  const adTitle = (id: string) => ads.data.find((x) => x.id === id)?.title || id;

  // Every day in the range, with rides and ad numbers side by side.
  const days = useMemo(() => {
    const map = new Map<string, { day: string; rides: number; spentKobo: number; views: number; taps: number; uniques: number; wrappedViews: number; shares: number }>();
    const get = (day: string) => map.get(day) ?? map.set(day, { day, rides: 0, spentKobo: 0, views: 0, taps: 0, uniques: 0, wrappedViews: 0, shares: 0 }).get(day)!;
    for (const d of rideDays.data) Object.assign(get(d.day), { rides: get(d.day).rides + (d.rides ?? 0), spentKobo: get(d.day).spentKobo + (d.spentKobo ?? 0) });
    for (const d of adDays.data) {
      const r = get(d.day);
      if (d.target === "wrapped") {
        r.wrappedViews += d.views ?? 0;
        r.shares += d.shares ?? 0;
      } else {
        r.views += d.views ?? 0;
        r.taps += d.taps ?? 0;
        r.uniques += d.uniques ?? 0;
      }
    }
    return [...map.values()].sort((x, y) => x.day.localeCompare(y.day));
  }, [rideDays.data, adDays.data]);

  function csv() {
    const head = ["day", "sponsored_rides", "spent_naira", "ad_views", "ad_people_that_day", "ad_taps", "wrapped_views", "wrapped_shares"];
    const rows = days.map((d) => [d.day, d.rides, (d.spentKobo / 100).toFixed(2), d.views, d.uniques, d.taps, d.wrappedViews, d.shares]);
    const perAd = adDays.data.filter((d) => d.target === "ad").map((d) => [d.day, d.id, `"${String(adTitle(d.id)).replace(/"/g, '""')}"`, d.views ?? 0, d.uniques ?? 0, d.taps ?? 0]);
    const text = [
      `# Konduct sponsor report: ${sponsor.name}, ${from} to ${to} (Lagos days)`,
      head.join(","),
      ...rows.map((r) => r.join(",")),
      "",
      "day,ad_id,ad_title,views,people_that_day,taps",
      ...perAd.map((r) => r.join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `konduct-${sponsor.name.replace(/[^A-Za-z0-9]+/g, "-")}-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const loading = rideDays.loading || adDays.loading;
  const error = rideDays.error || adDays.error;
  return (
    <Dialog title={`Report: ${sponsor.name}`} onClose={onClose} wide="xl">
      <div className="stack report" id="print-report">
        <div className="report-head">
          <Logo url={sponsor.logoUrl} size={56} />
          <div>
            <div className="field-label">Konduct sponsor report</div>
            <h3 style={{ margin: 0 }}>{sponsor.name}</h3>
            <div className="muted small">
              {from} to {to}, Lagos time
            </div>
          </div>
          <div className="row no-print" style={{ marginLeft: "auto" }}>
            <label className="field compact">
              <span className="field-label">From</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field compact">
              <span className="field-label">To</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
            <Button small kind="ghost" onClick={csv}>
              Download CSV
            </Button>
            <Button small kind="ghost" onClick={() => window.print()}>
              Print / PDF
            </Button>
          </div>
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="stat-grid">
              <Stat label="Sponsored rides" value={num(rides.rides)} sub={`${naira(rides.spentKobo)} spent`} />
              <Stat label="Riders helped (all time)" value={num(uniqueRiders)} sub={`${num(rides.offers)} times offered in range`} />
              <Stat label="Ad views" value={num(byTarget.ad.views)} sub={`${num(reach.ad)} people reached (all time)`} />
              <Stat label="Ad taps" value={num(byTarget.ad.taps)} sub={`${pct(byTarget.ad.taps, byTarget.ad.views)} of views`} />
              <Stat label="Wrapped views" value={num(byTarget.wrapped.views)} sub={`${num(reach.wrapped)} people reached (all time)`} />
              <Stat label="Wrapped shares" value={num(byTarget.wrapped.shares)} sub={`${num(byTarget.wrapped.taps)} logo taps`} />
              <Stat label="Budget left" value={naira(wallet.data?.balanceKobo ?? 0)} sub={`${naira(sponsor.fundedKobo ?? 0)} funded in total`} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="num">Rides</th>
                    <th className="num">Spent</th>
                    <th className="num">Ad views</th>
                    <th className="num">People</th>
                    <th className="num">Taps</th>
                    <th className="num">Wrapped views</th>
                    <th className="num">Shares</th>
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <Empty>Nothing counted in these dates yet.</Empty>
                      </td>
                    </tr>
                  ) : (
                    days.map((d) => (
                      <tr key={d.day}>
                        <td className="mono">{d.day}</td>
                        <td className="num mono">{num(d.rides)}</td>
                        <td className="num mono">{naira(d.spentKobo)}</td>
                        <td className="num mono">{num(d.views)}</td>
                        <td className="num mono">{num(d.uniques)}</td>
                        <td className="num mono">{num(d.taps)}</td>
                        <td className="num mono">{num(d.wrappedViews)}</td>
                        <td className="num mono">{num(d.shares)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <details className="how-counted" open>
              <summary>How these numbers are counted</summary>
              <ul className="small">
                <li>
                  <b>Sponsored rides and spend</b> come straight from Konduct's ledger: each one is a real payment where the sponsor's budget paid a rider's seat. They can't be
                  over- or under-counted.
                </li>
                <li>
                  <b>A view</b> is the ad (or the Wrapped badge) on a phone's screen, at least half of it visible, for at least one second, with the app open. A carousel slide that
                  scrolls away and comes back counts again; a popup counts once.
                </li>
                <li>
                  <b>People / reach</b> are different signed-in Konduct accounts, not phones or app opens. "People" in the daily table counts each person once per day.
                </li>
                <li>
                  <b>Limits that keep it honest:</b> only signed-in students and drivers count, only for ads they're allowed to see, only while the ad was scheduled. One person
                  counts at most 20 views, 10 taps and 5 shares per ad per day. Phones send counts in batches with an id, so a retry is never counted twice.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="field-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="muted small">{sub}</div> : null}
    </div>
  );
}
