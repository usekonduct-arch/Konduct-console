import { useMemo, useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { useLiveQuery, type Row } from "../lib/live";
import { renderMarkdown, slugify } from "../lib/markdown";
import { ImageField } from "../lib/media";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";

const SITE = "https://konduct.com.ng";
const date = (ms: unknown) => (typeof ms === "number" && ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** The website's blog (konduct-landing): write in Markdown, preview, publish. Publishing rebuilds the site. */
export default function BlogPage() {
  const posts = useLiveQuery(query(collection(db, "posts")), "site-posts");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const sorted = [...posts.data].sort((a, b) => (b.publishedAtMs ?? b.updatedAtMs ?? 0) - (a.publishedAtMs ?? a.updatedAtMs ?? 0));

  return (
    <>
      <PageHead kicker="Website" title="Blog">
        <Button onClick={() => setEditing("new")}>New post</Button>
      </PageHead>
      <Notice>
        Published posts appear at <a href={`${SITE}/blog`} target="_blank" rel="noreferrer">konduct.com.ng/blog</a> straight away, and in Google's index after the site rebuilds (about two minutes). Drafts are only visible here.
      </Notice>
      <Card tight>
        {posts.loading ? (
          <Loading />
        ) : posts.error ? (
          <Empty>{posts.error}</Empty>
        ) : !sorted.length ? (
          <Empty>No posts yet. Write the first one.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Author</th>
                  <th>Published</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <PostRow key={p.id} post={p} onEdit={() => setEditing(p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing ? <PostDialog post={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function PostRow({ post, onEdit }: { post: Row; onEdit: () => void }) {
  const a = useAction();
  const toast = useToast();
  const live = post.status === "published";
  async function remove() {
    if (!window.confirm(`Delete "${post.title}" for good?${live ? " It comes off the website too." : ""}`)) return;
    if (await a.run(() => call("staffDeletePost", { id: post.id }))) toast("Post deleted.");
  }
  return (
    <tr>
      <td>
        <div className="ad-row">
          {post.coverUrl ? <img className="ad-thumb ad-thumb-carousel" src={post.coverUrl} alt="" /> : null}
          <div>
            <b>{post.title}</b>
            <div className="muted small mono">/blog/{post.slug}</div>
            <ErrorText>{a.error}</ErrorText>
          </div>
        </div>
      </td>
      <td className="small">{post.authorName}</td>
      <td className="small">{date(post.publishedAtMs)}</td>
      <td>
        <Badge tone={live ? "good" : "neutral"}>{live ? "Published" : "Draft"}</Badge>
      </td>
      <td className="right nowrap">
        {live ? (
          <a className="btn btn-ghost btn-sm" href={`${SITE}/blog/${post.slug}`} target="_blank" rel="noreferrer">
            View
          </a>
        ) : null}{" "}
        <Button small kind="ghost" onClick={onEdit}>
          Edit
        </Button>{" "}
        <Button small kind="danger" onClick={remove} disabled={a.busy}>
          Delete
        </Button>
      </td>
    </tr>
  );
}

function Counter({ value, best, max }: { value: string; best: [number, number]; max: number }) {
  const n = value.length;
  const tone = n === 0 ? "muted" : n > max ? "bad-text" : n >= best[0] && n <= best[1] ? "good-text" : "warn-text";
  return (
    <span className={`small ${tone}`}>
      {n}/{max} {n && n >= best[0] && n <= best[1] ? "· good length" : ""}
    </span>
  );
}

const STARTER = `Open with one or two sentences that tell the reader what they'll get.

## A clear first heading

Short paragraphs read best on phones. Use **bold** for the key idea, and link to [related pages](/#how).

- Lists are great for steps
- Keep each point short

## Another heading

> A pull quote or a tip stands out like this.
`;

function PostDialog({ post, onClose }: { post: Row | null; onClose: () => void }) {
  const toast = useToast();
  const a = useAction();
  const [title, setTitle] = useState<string>(post?.title ?? "");
  const [slug, setSlug] = useState<string>(post?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(post));
  const [excerpt, setExcerpt] = useState<string>(post?.excerpt ?? "");
  const [body, setBody] = useState<string>(post?.body ?? STARTER);
  const [coverUrl, setCoverUrl] = useState<string>(post?.coverUrl ?? "");
  const [coverAlt, setCoverAlt] = useState<string>(post?.coverAlt ?? "");
  const [tags, setTags] = useState<string>(((post?.tags as string[]) ?? []).join(", "));
  const [authorName, setAuthorName] = useState<string>(post?.authorName ?? "");
  const [authorRole, setAuthorRole] = useState<string>(post?.authorRole ?? "");
  const [seoTitle, setSeoTitle] = useState<string>(post?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState<string>(post?.seoDescription ?? "");
  const [tab, setTab] = useState<"write" | "preview" | "search">("write");
  const rendered = useMemo(() => renderMarkdown(body, SITE), [body]);
  const words = rendered.text.split(" ").filter(Boolean).length;

  const effSlug = slugTouched ? slug : slugify(title);
  const searchTitle = `${seoTitle || title || "Post title"} · Konduct Blog`;
  const searchDesc = seoDescription || excerpt || "The summary shows here.";

  async function save(status: "draft" | "published", e?: FormEvent) {
    e?.preventDefault();
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagList.length > 6) return a.setError("Use at most 6 topics.");
    const r = await a.run(() =>
      call<{ slug: string }>("staffUpsertPost", {
        ...(post ? { id: post.id } : {}),
        slug: effSlug,
        title: title.trim(),
        excerpt: excerpt.trim(),
        body,
        coverUrl,
        coverAlt: coverAlt.trim(),
        tags: tagList,
        authorName: authorName.trim(),
        authorRole: authorRole.trim(),
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        status,
      }),
    );
    if (r) {
      toast(status === "published" ? "Published. The site rebuilds in about two minutes." : "Draft saved.");
      onClose();
    }
  }

  return (
    <Dialog title={post ? "Edit post" : "New post"} onClose={onClose} wide="xl">
      <form className="post-editor" onSubmit={(e) => save("published", e)}>
        <div className="stack">
          <Field label="Title" value={title} onChange={setTitle} maxLength={120} required />
          <label className="field">
            <span className="field-label">Web address</span>
            <div className="slug-row">
              <span className="mono muted">/blog/</span>
              <input
                className="mono"
                value={effSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
              />
            </div>
            <span className="field-hint">Words people would search, joined by dashes. Don't change it after publishing: old links would break.</span>
          </label>
          <label className="field">
            <span className="field-label">Summary</span>
            <textarea rows={3} value={excerpt} maxLength={300} onChange={(e) => setExcerpt(e.target.value)} />
            <span className="field-hint">
              Shows under the title on the blog, in link previews and in Google. <Counter value={excerpt} best={[120, 160]} max={300} />
            </span>
          </label>
          <ImageField label="Cover picture" size="cover" value={coverUrl} onChange={setCoverUrl} optional />
          {coverUrl ? <Field label="Describe the cover picture" value={coverAlt} onChange={setCoverAlt} maxLength={200} hint="For screen readers and Google Images, e.g. “Students boarding a blue Korope at Shasha park”." /> : null}
          <div className="grid-2">
            <Field label="Author" value={authorName} onChange={setAuthorName} maxLength={80} placeholder="Ada Obi" />
            <Field label="Author's role" value={authorRole} onChange={setAuthorRole} maxLength={80} placeholder="Community lead" />
          </div>
          <Field label="Topics" value={tags} onChange={setTags} placeholder="guides, riders" hint="Comma-separated, up to 6. Readers filter the blog by these." />
          <details className="seo-box">
            <summary>Search engine settings (optional)</summary>
            <Field label="Title in Google" value={seoTitle} onChange={setSeoTitle} maxLength={70} hint="Leave empty to use the post title." />
            <Counter value={seoTitle} best={[30, 60]} max={70} />
            <label className="field">
              <span className="field-label">Description in Google</span>
              <textarea rows={2} value={seoDescription} maxLength={160} onChange={(e) => setSeoDescription(e.target.value)} />
              <span className="field-hint">
                Leave empty to use the summary. <Counter value={seoDescription} best={[120, 160]} max={160} />
              </span>
            </label>
          </details>
        </div>

        <div className="stack">
          <div className="seg" role="tablist" aria-label="Editor view">
            {(["write", "preview", "search"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "write" ? "Write" : t === "preview" ? "Preview" : "Google preview"}
              </button>
            ))}
          </div>
          {tab === "write" ? (
            <label className="field">
              <span className="field-label">Post (Markdown)</span>
              <textarea className="md-input mono" rows={22} value={body} maxLength={50_000} onChange={(e) => setBody(e.target.value)} />
              <span className="field-hint">
                ## heading · **bold** · *italic* · - list · &gt; quote · [link](https://…) · ![picture](https://…) · {words} words, about {Math.max(1, Math.round(words / 220))} min read
              </span>
            </label>
          ) : tab === "preview" ? (
            <article className="md-preview">
              {coverUrl ? <img src={coverUrl} alt={coverAlt} className="md-cover" /> : null}
              <h1>{title || "Post title"}</h1>
              <p className="md-lead">{excerpt}</p>
              <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
            </article>
          ) : (
            <div className="serp">
              <div className="serp-url">
                <span className="serp-icon">K</span>
                <span>
                  <b>Konduct</b>
                  <span className="muted small">konduct.com.ng › blog › {effSlug || "…"}</span>
                </span>
              </div>
              <div className="serp-title">{searchTitle.length > 62 ? searchTitle.slice(0, 60) + "…" : searchTitle}</div>
              <div className="serp-desc">{searchDesc.length > 160 ? searchDesc.slice(0, 157) + "…" : searchDesc}</div>
              <p className="small muted">Roughly how this post looks in Google search. Google may pick its own text.</p>
              <ul className="small checklist">
                <li className={title.length >= 20 && title.length <= 70 ? "ok" : ""}>Title of 20–70 characters</li>
                <li className={excerpt.length >= 120 ? "ok" : ""}>Summary of 120+ characters</li>
                <li className={coverUrl && coverAlt ? "ok" : ""}>Cover picture with a description</li>
                <li className={rendered.toc.filter((t) => t.level === 2).length >= 2 ? "ok" : ""}>At least two ## headings</li>
                <li className={words >= 300 ? "ok" : ""}>300+ words ({words})</li>
                <li className={/\]\(\/[^)]*\)/.test(body) ? "ok" : ""}>A link to another Konduct page</li>
              </ul>
            </div>
          )}
        </div>

        <div className="post-editor-actions">
          <ErrorText>{a.error}</ErrorText>
          <div className="row">
            <Button type="submit" busy={a.busy}>
              {post?.status === "published" ? "Update post" : "Publish"}
            </Button>
            <Button kind="ghost" busy={a.busy} onClick={() => save("draft")}>
              {post?.status === "published" ? "Unpublish (back to draft)" : "Save draft"}
            </Button>
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
