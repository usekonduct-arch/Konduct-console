import { useMemo, useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { useLiveQuery, type Row } from "../lib/live";
import { renderMarkdown, slugify } from "../lib/markdown";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";

const SITE = "https://konduct.com.ng";
type Employment = "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN" | "VOLUNTEER";
type Workplace = "onsite" | "hybrid" | "remote";
type Stage = "new" | "reviewing" | "interview" | "offer" | "hired" | "rejected";

const EMPLOYMENT: { value: Employment; label: string }[] = [
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "CONTRACTOR", label: "Contract" },
  { value: "INTERN", label: "Internship" },
  { value: "VOLUNTEER", label: "Volunteer" },
];
const WORKPLACE: { value: Workplace; label: string }[] = [
  { value: "onsite", label: "On site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote (Nigeria)" },
];
const STAGES: { value: Stage; label: string; tone: "info" | "warn" | "good" | "bad" | "neutral" }[] = [
  { value: "new", label: "New", tone: "info" },
  { value: "reviewing", label: "Reviewing", tone: "warn" },
  { value: "interview", label: "Interview", tone: "warn" },
  { value: "offer", label: "Offer", tone: "good" },
  { value: "hired", label: "Hired", tone: "good" },
  { value: "rejected", label: "Not this time", tone: "neutral" },
];
const stage = (s: unknown) => STAGES.find((x) => x.value === s) ?? STAGES[0];
const date = (ms: unknown) => (typeof ms === "number" && ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (r: Row) => (r.createdAt?.toMillis ? r.createdAt.toMillis() : 0);

/** Job openings on konduct.com.ng/careers, and the applications people send from there. */
export default function CareersPage() {
  const jobs = useLiveQuery(query(collection(db, "jobs")), "site-jobs");
  const apps = useLiveQuery(query(collection(db, "applications")), "site-applications");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [jobFilter, setJobFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<"active" | Stage | "all">("active");

  const order = { open: 0, draft: 1, closed: 2 } as Record<string, number>;
  const sortedJobs = [...jobs.data].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  const countFor = (id: string) => apps.data.filter((x) => x.jobId === id).length;
  const newFor = (id: string) => apps.data.filter((x) => x.jobId === id && x.status === "new").length;
  const shownApps = apps.data
    .filter((x) => jobFilter === "all" || x.jobId === jobFilter)
    .filter((x) => stageFilter === "all" || (stageFilter === "active" ? !["hired", "rejected"].includes(x.status) : x.status === stageFilter))
    .sort((a, b) => when(b) - when(a));

  return (
    <>
      <PageHead kicker="Website" title="Careers & applicants">
        <Button onClick={() => setEditing("new")}>New role</Button>
      </PageHead>
      <Notice>
        Open roles show at <a href={`${SITE}/careers`} target="_blank" rel="noreferrer">konduct.com.ng/careers</a> and in Google for Jobs after the site rebuilds (about two minutes). Close a role when it's filled: it leaves search but its applications stay here.
      </Notice>

      <Card title="Roles" tight>
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <Empty>{jobs.error}</Empty>
        ) : !sortedJobs.length ? (
          <Empty>No roles yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Closes</th>
                  <th className="num">Applicants</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((j) => (
                  <JobRow key={j.id} job={j} total={countFor(j.id)} fresh={newFor(j.id)} onEdit={() => setEditing(j)} onApplicants={() => setJobFilter(j.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Applications"
        tight
        actions={
          <div className="row">
            <Select
              label="Role"
              value={jobFilter}
              onChange={setJobFilter}
              options={[{ value: "all", label: "All roles" }, ...sortedJobs.map((j) => ({ value: j.id as string, label: j.title as string }))]}
            />
            <Select
              label="Stage"
              value={stageFilter}
              onChange={setStageFilter}
              options={[{ value: "active", label: "In progress" }, { value: "all", label: "Everyone" }, ...STAGES.map((s) => ({ value: s.value, label: s.label }))]}
            />
          </div>
        }
      >
        {apps.loading ? (
          <Loading />
        ) : apps.error ? (
          <Empty>{apps.error}</Empty>
        ) : !shownApps.length ? (
          <Empty>No applications here.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Role</th>
                  <th>Applied</th>
                  <th>Stage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownApps.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <b>{x.name}</b>
                      <div className="muted small">{x.email}</div>
                    </td>
                    <td className="small">{x.jobTitle}</td>
                    <td className="small">{date(when(x))}</td>
                    <td>
                      <Badge tone={stage(x.status).tone}>{stage(x.status).label}</Badge>
                    </td>
                    <td className="right">
                      <Button small kind="ghost" onClick={() => setViewing(x)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? <JobDialog job={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {viewing ? <ApplicationDialog app={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function JobRow({ job, total, fresh, onEdit, onApplicants }: { job: Row; total: number; fresh: number; onEdit: () => void; onApplicants: () => void }) {
  const a = useAction();
  const toast = useToast();
  async function remove() {
    if (!window.confirm(`Delete "${job.title}"?`)) return;
    if (await a.run(() => call("staffDeleteJob", { id: job.id }))) toast("Role deleted.");
  }
  const tone = job.status === "open" ? "good" : job.status === "draft" ? "neutral" : "bad";
  return (
    <tr>
      <td>
        <b>{job.title}</b>
        <div className="muted small">
          {job.team} · {job.location}
        </div>
        <ErrorText>{a.error}</ErrorText>
      </td>
      <td className="small">
        {EMPLOYMENT.find((e) => e.value === job.employment)?.label} · {WORKPLACE.find((w) => w.value === job.workplace)?.label}
      </td>
      <td className="small">{date(job.closesAtMs)}</td>
      <td className="num">
        <button type="button" className="link" onClick={onApplicants}>
          {total}
        </button>
        {fresh ? <Badge tone="info">{fresh} new</Badge> : null}
      </td>
      <td>
        <Badge tone={tone}>{job.status === "open" ? "Open" : job.status === "draft" ? "Draft" : "Closed"}</Badge>
      </td>
      <td className="right nowrap">
        {job.status !== "draft" ? (
          <a className="btn btn-ghost btn-sm" href={`${SITE}/careers/${job.slug}`} target="_blank" rel="noreferrer">
            View
          </a>
        ) : null}{" "}
        <Button small kind="ghost" onClick={onEdit}>
          Edit
        </Button>{" "}
        {total === 0 ? (
          <Button small kind="danger" onClick={remove} disabled={a.busy}>
            Delete
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

const JOB_STARTER = `## What you'll do

-
-

## What we're looking for

-
-

## What you get

-
`;

const toDate = (ms: unknown) => (typeof ms === "number" && ms ? new Date(ms).toISOString().slice(0, 10) : "");

function JobDialog({ job, onClose }: { job: Row | null; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const [title, setTitle] = useState<string>(job?.title ?? "");
  const [slug, setSlug] = useState<string>(job?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(job));
  const [team, setTeam] = useState<string>(job?.team ?? "");
  const [location, setLocation] = useState<string>(job?.location ?? "Osogbo");
  const [workplace, setWorkplace] = useState<Workplace>(job?.workplace ?? "onsite");
  const [employment, setEmployment] = useState<Employment>(job?.employment ?? "FULL_TIME");
  const [summary, setSummary] = useState<string>(job?.summary ?? "");
  const [body, setBody] = useState<string>(job?.body ?? JOB_STARTER);
  const [payMin, setPayMin] = useState<string>(job?.salaryMinNaira ? String(job.salaryMinNaira) : "");
  const [payMax, setPayMax] = useState<string>(job?.salaryMaxNaira ? String(job.salaryMaxNaira) : "");
  const [payUnit, setPayUnit] = useState<"MONTH" | "YEAR">(job?.salaryUnit ?? "MONTH");
  const [closes, setCloses] = useState<string>(toDate(job?.closesAtMs));
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => renderMarkdown(body, SITE).html, [body]);
  const effSlug = slugTouched ? slug : slugify(`${title} ${location}`.trim());

  const naira = (v: string) => {
    const n = Number(v.replace(/[,\s₦]/g, ""));
    return v.trim() && Number.isFinite(n) ? Math.round(n) : null;
  };

  async function save(status: "draft" | "open" | "closed", e?: FormEvent) {
    e?.preventDefault();
    const r = await a.run(() =>
      call("staffUpsertJob", {
        ...(job ? { id: job.id } : {}),
        slug: effSlug,
        title: title.trim(),
        team: team.trim(),
        location: location.trim(),
        workplace,
        employment,
        summary: summary.trim(),
        body,
        salaryMinNaira: naira(payMin),
        salaryMaxNaira: naira(payMax),
        salaryUnit: payUnit,
        // End of that day in Lagos.
        closesAtMs: closes ? new Date(`${closes}T23:59:59+01:00`).getTime() : null,
        status,
      }),
    );
    if (r) {
      toast(status === "open" ? "Role is live. The site rebuilds in about two minutes." : status === "closed" ? "Role closed." : "Draft saved.");
      onClose();
    }
  }

  return (
    <Dialog title={job ? "Edit role" : "New role"} onClose={onClose} wide="xl">
      <form className="post-editor" onSubmit={(e) => save("open", e)}>
        <div className="stack">
          <Field label="Job title" value={title} onChange={setTitle} maxLength={100} placeholder="Campus Ambassador" required />
          <label className="field">
            <span className="field-label">Web address</span>
            <div className="slug-row">
              <span className="mono muted">/careers/</span>
              <input
                className="mono"
                value={effSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
              />
            </div>
          </label>
          <div className="grid-2">
            <Field label="Team" value={team} onChange={setTeam} maxLength={60} placeholder="Operations" />
            <Field label="Location" value={location} onChange={setLocation} maxLength={80} placeholder="Osogbo" />
          </div>
          <div className="grid-2">
            <Select label="Type" value={employment} onChange={setEmployment} options={EMPLOYMENT} />
            <Select label="Where" value={workplace} onChange={setWorkplace} options={WORKPLACE} />
          </div>
          <label className="field">
            <span className="field-label">Summary</span>
            <textarea rows={3} value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} />
            <span className="field-hint">One or two sentences. Shows in the list of roles and in Google.</span>
          </label>
          <div className="grid-3">
            <Field label="Pay from (₦)" value={payMin} onChange={setPayMin} inputMode="numeric" placeholder="optional" />
            <Field label="Pay up to (₦)" value={payMax} onChange={setPayMax} inputMode="numeric" placeholder="optional" />
            <Select label="Per" value={payUnit} onChange={setPayUnit} options={[{ value: "MONTH", label: "Month" }, { value: "YEAR", label: "Year" }]} />
          </div>
          <p className="field-hint">Roles that show pay get more applicants, and Google for Jobs shows it.</p>
          <Field label="Applications close" value={closes} onChange={setCloses} type="date" hint="Optional. The role closes itself at the end of this day." />
        </div>
        <div className="stack">
          <div className="seg" role="tablist" aria-label="Editor view">
            <button type="button" role="tab" aria-selected={!preview} className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
              Write
            </button>
            <button type="button" role="tab" aria-selected={preview} className={preview ? "on" : ""} onClick={() => setPreview(true)}>
              Preview
            </button>
          </div>
          {preview ? (
            <article className="md-preview">
              <h1>{title || "Job title"}</h1>
              <p className="md-lead">{summary}</p>
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </article>
          ) : (
            <label className="field">
              <span className="field-label">Description (Markdown)</span>
              <textarea className="md-input mono" rows={22} value={body} maxLength={30_000} onChange={(e) => setBody(e.target.value)} />
            </label>
          )}
        </div>
        <div className="post-editor-actions">
          <ErrorText>{a.error}</ErrorText>
          <div className="row">
            <Button type="submit" busy={a.busy}>
              {job?.status === "open" ? "Update role" : "Publish role"}
            </Button>
            {job?.status === "open" ? (
              <Button kind="ghost" busy={a.busy} onClick={() => save("closed")}>
                Close role
              </Button>
            ) : (
              <Button kind="ghost" busy={a.busy} onClick={() => save("draft")}>
                Save draft
              </Button>
            )}
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function ApplicationDialog({ app, onClose }: { app: Row; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const [status, setStatus] = useState<Stage>(app.status ?? "new");
  const [note, setNote] = useState<string>(app.staffNote ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    if (await a.run(() => call("staffSetApplication", { id: app.id, status, staffNote: note.trim() }))) {
      toast("Saved.");
      onClose();
    }
  }

  return (
    <Dialog title={`${app.name} · ${app.jobTitle}`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <dl className="kv">
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${app.email}?subject=${encodeURIComponent(`Your application: ${app.jobTitle} at Konduct`)}`}>{app.email}</a>
          </dd>
          {app.phone ? (
            <>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${app.phone}`}>{app.phone}</a>
              </dd>
            </>
          ) : null}
          <dt>CV / profile</dt>
          <dd>
            <a href={app.link} target="_blank" rel="noreferrer noopener" className="mono small">
              {app.link}
            </a>
          </dd>
          <dt>Applied</dt>
          <dd>{date(when(app))}</dd>
        </dl>
        {app.note ? (
          <div>
            <span className="field-label">Why this role</span>
            <p className="pre-wrap">{app.note}</p>
          </div>
        ) : null}
        <Notice tone="warn">Links come from the applicant. Open them only if they look right, and never sign in through one.</Notice>
        <Select label="Stage" value={status} onChange={setStatus} options={STAGES.map((s) => ({ value: s.value, label: s.label }))} />
        <label className="field">
          <span className="field-label">Team note (only staff see this)</span>
          <textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            Save
          </Button>
          <Button kind="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
