import { useState, type FormEvent } from "react";
import { collection, doc, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { ImageField, LinkField, SIZES, validLink } from "../lib/media";
import { can, useSession } from "../lib/session";
import {
  Badge,
  Button,
  Card,
  Check,
  Dialog,
  Empty,
  ErrorText,
  Field,
  Loading,
  Notice,
  PageHead,
  Select,
  useAction,
  useToast,
} from "../ui";

type Placement = "carousel" | "popup";
type Audience = "all" | "rider" | "driver";
type AdButton = { label: string; link: string };

const AUDIENCE_LABEL: Record<Audience, string> = {
  all: "Both apps",
  rider: "Rider app",
  driver: "Driver app",
};

/** Live now, waiting for its start, finished, or switched off. */
function state(
  ad: Row,
  now = Date.now(),
): { label: string; tone: "good" | "warn" | "neutral" | "bad" } {
  if (!ad.active) return { label: "Off", tone: "neutral" };
  if (ad.startsAtMs && now < ad.startsAtMs)
    return { label: "Scheduled", tone: "warn" };
  if (ad.endsAtMs && now >= ad.endsAtMs) return { label: "Ended", tone: "bad" };
  return { label: "Live", tone: "good" };
}

const pad = (n: number) => String(n).padStart(2, "0");
const num = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-NG") : "0");
/** ms → the value a datetime-local input wants, in the browser's time zone. */
function toLocal(ms: number | null | undefined) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);

export default function Ads() {
  const s = useSession();
  const ads = useLiveQuery(query(collection(db, "ads")), "ads");
  const [editing, setEditing] = useState<Row | Placement | null>(null);
  const allowed = can.message(s.role);
  const sorted = [...ads.data].sort(
    (a, b) =>
      String(a.placement).localeCompare(String(b.placement)) ||
      (a.order ?? 0) - (b.order ?? 0),
  );

  return (
    <>
      <PageHead kicker="Ads" title="Ads in the apps">
        {allowed ? (
          <div className="row">
            <Button onClick={() => setEditing("carousel")}>
              New carousel ad
            </Button>
            <Button kind="dark" onClick={() => setEditing("popup")}>
              New popup ad
            </Button>
          </div>
        ) : null}
      </PageHead>
      <Notice>
        <b>Carousel</b> ads slide by on the home screen at{" "}
        {SIZES.carousel.label}. <b>Popup</b> ads open once per phone at{" "}
        {SIZES.popup.label}. Uploaded pictures are cropped to these sizes. When
        no ad is live, the apps show nothing in its place.
      </Notice>
      <Card tight>
        {ads.loading ? (
          <Loading />
        ) : ads.error ? (
          <Empty>{ads.error}</Empty>
        ) : sorted.length === 0 ? (
          <Empty>No ads yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Where</th>
                  <th>Leads to</th>
                  <th className="num">Views · reach · taps</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((ad) => (
                  <AdRow
                    key={ad.id}
                    ad={ad}
                    canEdit={allowed}
                    onEdit={() => setEditing(ad)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing ? (
        <AdDialog
          ad={typeof editing === "string" ? null : editing}
          placement={typeof editing === "string" ? editing : editing.placement}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <BrandCard allowed={allowed} />
    </>
  );
}

function AdRow({
  ad,
  canEdit,
  onEdit,
}: {
  ad: Row;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const a = useAction();
  const toast = useToast();
  const st = state(ad);
  const buttons = (ad.buttons ?? []) as AdButton[];
  // Counted by the apps and checked by the backend (adstats.ts); details in Sponsors → Report.
  const stats = useLiveDoc(doc(db, `adStats/ad_${ad.id}`), `adstats-${ad.id}`);

  async function toggle() {
    const {
      id,
      placement,
      audience,
      title,
      body,
      imageUrl,
      link,
      order,
      startsAtMs,
      endsAtMs,
    } = ad;
    const r = await a.run(() =>
      call("staffUpsertAd", {
        id,
        placement,
        audience,
        title: title ?? "",
        body: body ?? "",
        imageUrl,
        link: link ?? "",
        buttons,
        active: !ad.active,
        startsAtMs: startsAtMs ?? null,
        endsAtMs: endsAtMs ?? null,
        order: order ?? 0,
        sponsorId: ad.sponsorId ?? "", // keep the sponsor, or their report loses this ad
      }),
    );
    if (r) toast(ad.active ? "Switched off." : "Switched on.");
  }
  async function remove() {
    if (!window.confirm("Delete this ad for good?")) return;
    const r = await a.run(() => call("staffDeleteAd", { id: ad.id }));
    if (r) toast("Deleted.");
  }

  return (
    <tr>
      <td>
        <div className="ad-row">
          <img
            className={`ad-thumb ad-thumb-${ad.placement}`}
            src={ad.imageUrl}
            alt=""
          />
          <div>
            <b>{ad.title || <span className="muted">No title</span>}</b>
            {ad.body ? (
              <div className="muted small">{String(ad.body).slice(0, 90)}</div>
            ) : null}
            <ErrorText>{a.error}</ErrorText>
          </div>
        </div>
      </td>
      <td>
        {ad.placement === "popup" ? "Popup" : "Carousel"}
        <div className="muted small">
          {AUDIENCE_LABEL[ad.audience as Audience] ?? ad.audience} · order{" "}
          {ad.order ?? 0}
        </div>
      </td>
      <td className="small">
        {ad.link ? <div className="mono">{ad.link}</div> : null}
        {buttons.map((b, i) => (
          <div key={i}>
            <b>{b.label}</b> → <span className="mono">{b.link}</span>
          </div>
        ))}
        {!ad.link && !buttons.length ? (
          <span className="muted">Nothing</span>
        ) : null}
      </td>
      <td className="num small mono">
        {num(stats.data?.views)} · {num(stats.data?.reach)} · {num(stats.data?.taps)}
      </td>
      <td>
        <Badge tone={st.tone}>{st.label}</Badge>
      </td>
      <td className="right nowrap">
        {canEdit ? (
          <>
            <Button small kind="ghost" busy={a.busy} onClick={toggle}>
              {ad.active ? "Switch off" : "Switch on"}
            </Button>{" "}
            <Button small kind="ghost" onClick={onEdit}>
              Edit
            </Button>{" "}
            <Button small kind="danger" onClick={remove} disabled={a.busy}>
              Delete
            </Button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function AdDialog({
  ad,
  placement: initialPlacement,
  onClose,
}: {
  ad: Row | null;
  placement: Placement;
  onClose: () => void;
}) {
  const toast = useToast();
  const a = useAction();
  const [placement, setPlacement] = useState<Placement>(initialPlacement);
  const [audience, setAudience] = useState<Audience>(ad?.audience ?? "all");
  const [title, setTitle] = useState<string>(ad?.title ?? "");
  const [body, setBody] = useState<string>(ad?.body ?? "");
  const [imageUrl, setImageUrl] = useState<string>(ad?.imageUrl ?? "");
  const [link, setLink] = useState<string>(ad?.link ?? "");
  const [buttons, setButtons] = useState<AdButton[]>(
    (ad?.buttons as AdButton[]) ?? [],
  );
  const [active, setActive] = useState<boolean>(ad?.active ?? true);
  const [starts, setStarts] = useState(toLocal(ad?.startsAtMs));
  const [ends, setEnds] = useState(toLocal(ad?.endsAtMs));
  const [order, setOrder] = useState(String(ad?.order ?? 0));
  const [sponsorId, setSponsorId] = useState<string>(ad?.sponsorId ?? "");
  const sponsors = useLiveQuery(query(collection(db, "sponsors"), orderBy("name")), "sponsors");

  const setButton = (i: number, b: Partial<AdButton>) =>
    setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, ...b } : x)));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!imageUrl) return a.setError("Add a picture.");
    if (!validLink(link) || buttons.some((b) => !b.link || !validLink(b.link)))
      return a.setError("Fix the links first.");
    if (buttons.some((b) => !b.label.trim()))
      return a.setError("Give every button a label.");
    const n = Number(order);
    if (!Number.isInteger(n) || n < 0 || n > 999)
      return a.setError("Order is a whole number from 0 to 999.");
    const r = await a.run(() =>
      call<{ id: string }>("staffUpsertAd", {
        ...(ad ? { id: ad.id } : {}),
        placement,
        audience,
        title: title.trim(),
        body: placement === "popup" ? body.trim() : "",
        imageUrl,
        link,
        buttons: buttons.map((b) => ({ label: b.label.trim(), link: b.link })),
        active,
        startsAtMs: fromLocal(starts),
        endsAtMs: fromLocal(ends),
        order: n,
        sponsorId,
      }),
    );
    if (r) {
      toast(ad ? "Ad saved." : "Ad created.");
      onClose();
    }
  }

  return (
    <Dialog
      title={
        ad
          ? "Edit ad"
          : placement === "popup"
            ? "New popup ad"
            : "New carousel ad"
      }
      onClose={onClose}
      wide="xl"
    >
      <div className="ad-editor">
        <form className="stack" onSubmit={save}>
          <div className="grid-2">
            <Select<Placement>
              label="Kind"
              value={placement}
              onChange={setPlacement}
              options={[
                {
                  value: "carousel",
                  label: `Carousel banner, ${SIZES.carousel.label}`,
                },
                { value: "popup", label: `Popup, ${SIZES.popup.label}` },
              ]}
            />
            <Select<Audience>
              label="Show in"
              value={audience}
              onChange={setAudience}
              options={[
                { value: "all", label: "Both apps" },
                { value: "rider", label: "Rider app only" },
                { value: "driver", label: "Driver app only" },
              ]}
            />
          </div>
          <Select
            label="Sponsor (their report counts this ad)"
            value={sponsorId}
            onChange={setSponsorId}
            options={[{ value: "", label: "None: a Konduct ad" }, ...sponsors.data.map((sp) => ({ value: sp.id, label: String(sp.name) }))]}
          />
          <ImageField
            key={placement}
            label="Picture"
            size={placement}
            value={imageUrl}
            onChange={setImageUrl}
          />
          <Field
            label="Title (optional)"
            value={title}
            onChange={setTitle}
            maxLength={80}
            hint={
              placement === "carousel"
                ? "Shown over the bottom of the banner. Leave empty if the picture has its own text."
                : undefined
            }
          />
          {placement === "popup" ? (
            <label className="field">
              <span className="field-label">Text (optional)</span>
              <textarea
                rows={3}
                maxLength={400}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          ) : null}
          <LinkField
            label="Tapping the picture opens (optional)"
            value={link}
            onChange={setLink}
          />
          <div className="stack">
            <span className="field-label">
              Buttons{" "}
              {placement === "carousel"
                ? "(the first one shows on the banner)"
                : "(up to two)"}
            </span>
            {buttons.map((b, i) => (
              <div key={i} className="grid-2 button-row">
                <Field
                  label={`Button ${i + 1} label`}
                  value={b.label}
                  onChange={(v) => setButton(i, { label: v })}
                  maxLength={24}
                  placeholder="Top up now"
                />
                <div className="row button-link">
                  <LinkField
                    label="Opens"
                    value={b.link}
                    onChange={(v) => setButton(i, { link: v })}
                    hint=" "
                  />
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setButtons((bs) => bs.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {buttons.length < 2 ? (
              <div>
                <Button
                  small
                  kind="ghost"
                  onClick={() =>
                    setButtons((bs) => [...bs, { label: "", link: "" }])
                  }
                >
                  Add a button
                </Button>
              </div>
            ) : null}
          </div>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Starts (optional)</span>
              <input
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Ends (optional)</span>
              <input
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </label>
          </div>
          <div className="grid-2">
            <Field
              label="Order (lower comes first)"
              value={order}
              onChange={setOrder}
              inputMode="numeric"
              mono
            />
            <Check label="Switched on" checked={active} onChange={setActive} />
          </div>
          <ErrorText>{a.error}</ErrorText>
          <div className="row">
            <Button type="submit" busy={a.busy}>
              {ad ? "Save ad" : "Create ad"}
            </Button>
          </div>
        </form>
        <AdPreview
          placement={placement}
          dark={audience === "driver"}
          imageUrl={imageUrl}
          title={title.trim()}
          body={body.trim()}
          buttons={buttons}
        />
      </div>
    </Dialog>
  );
}

/**
 * The ad as a phone shows it, redrawn on every keystroke. Mirrors AdCarousel/_Banner and _AdPopup in
 * the apps' messages_ui.dart; driver-only ads use the driver app's dark theme.
 */
function AdPreview({
  placement,
  dark,
  imageUrl,
  title,
  body,
  buttons,
}: {
  placement: Placement;
  dark: boolean;
  imageUrl: string;
  title: string;
  body: string;
  buttons: AdButton[];
}) {
  const picture = imageUrl ? (
    <img src={imageUrl} alt="" />
  ) : (
    <span className="ad-pv-empty">Add a picture to see it here</span>
  );
  const shown = buttons.filter((b) => b.label.trim());
  return (
    <aside className="ad-pv-wrap" aria-label="Preview">
      <span className="field-label">Preview{dark ? " · driver app" : ""}</span>
      <div className={`ad-pv-phone${dark ? " ad-pv-dark" : ""}`}>
        {placement === "carousel" ? (
          <>
            <div className="ad-pv-greeting">
              <span className="ad-pv-mark" />
              <div>
                <b>Hi, Ada</b>
                <small>Good morning. Where to?</small>
              </div>
            </div>
            <div className="ad-pv-banner">
              {picture}
              {title || shown.length ? (
                <div className="ad-pv-banner-text">
                  <b>{title}</b>
                  {shown.length ? (
                    <span className="ad-pv-pill">{shown[0].label}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="ad-pv-dots">
              <i className="on" />
              <i />
            </div>
            <div className="ad-pv-ghost" />
            <div className="ad-pv-ghost short" />
          </>
        ) : (
          <div className="ad-pv-scrim">
            <div className="ad-pv-popup">
              <div className="ad-pv-popup-img">
                {picture}
                <span className="ad-pv-tag">AD</span>
                <span className="ad-pv-close">×</span>
              </div>
              {title || body || shown.length ? (
                <div className="ad-pv-popup-text">
                  {title ? <b>{title}</b> : null}
                  {body ? <p>{body}</p> : null}
                  {shown.map((b, i) => (
                    <span key={i} className={`ad-pv-btn${i > 0 ? " alt" : ""}`}>
                      {b.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const BRAND_FIELDS = [
  { key: "instagram", label: "Instagram", hint: "@konduct" },
  { key: "x", label: "X (Twitter)", hint: "@konduct" },
  { key: "tiktok", label: "TikTok", hint: "@konduct" },
  { key: "facebook", label: "Facebook", hint: "@konduct" },
  { key: "hashtag", label: "Hashtag", hint: "#RideKonduct" },
  { key: "website", label: "Website", hint: "https://konduct.com.ng" },
] as const;

type BrandKey = (typeof BRAND_FIELDS)[number]["key"];

/**
 * After paying, and at the end of their monthly Wrapped, riders and drivers can share a picture
 * of it. The caption tags these handles and the hashtag.
 */
function BrandCard({ allowed }: { allowed: boolean }) {
  const toast = useToast();
  const brand = useLiveDoc(doc(db, "config/brand"), "brand");
  const [edit, setEdit] = useState<Record<BrandKey, string> | null>(null);
  const a = useAction();
  const value = (k: BrandKey) => (brand.data?.[k] as string | undefined) ?? "";

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const r = await a.run(() => call("staffSetBrand", edit));
    if (r) {
      toast("Saved. New shares use these handles straight away.");
      setEdit(null);
    }
  }

  const caption = [
    "Just paid my bus fare with Konduct. Tap, pay, ride.",
    [value("instagram"), value("x")].filter(Boolean).join(" "),
    value("hashtag"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      title="Social sharing"
      actions={
        allowed && !edit ? (
          <Button
            small
            kind="ghost"
            onClick={() =>
              setEdit(
                Object.fromEntries(
                  BRAND_FIELDS.map((f) => [f.key, value(f.key)]),
                ) as Record<BrandKey, string>,
              )
            }
          >
            Edit
          </Button>
        ) : null
      }
    >
      {edit ? (
        <form className="stack" onSubmit={save}>
          {BRAND_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={edit[f.key]}
              onChange={(v) => setEdit({ ...edit, [f.key]: v })}
              placeholder={f.hint}
              mono
            />
          ))}
          <ErrorText>{a.error}</ErrorText>
          <div className="row">
            <Button type="submit" busy={a.busy}>
              Save
            </Button>
            <Button kind="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <p className="small muted">
            After paying, and at the end of their monthly Wrapped, riders and
            drivers can share a picture to Instagram, WhatsApp, X and more. The
            caption tags these accounts so you see every post.
          </p>
          <dl className="facts">
            {BRAND_FIELDS.map((f) => (
              <div key={f.key} className="facts-row">
                <dt>{f.label}</dt>
                <dd className="mono">
                  {value(f.key) || <span className="muted">Not set</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="small">
            Caption preview: <span className="mono">{caption}</span>
          </p>
        </div>
      )}
    </Card>
  );
}
