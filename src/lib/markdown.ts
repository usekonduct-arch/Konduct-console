/**
 * A small Markdown renderer for blog posts and job descriptions. Everything is HTML-escaped first,
 * so a post can only ever produce the tags below. Links must be https://, mailto: or a site path.
 * A copy of konduct-landing/src/lib/markdown.ts, so the blog editor previews exactly what the site shows.
 * Change both together.
 *
 *   ## Heading / ### Subheading     paragraphs     **bold**  *italic*  `code`
 *   - list / 1. list    > quote    ---    [text](https://…)    ![alt](https://…)    ```code```
 */
export type Toc = { id: string; text: string; level: 2 | 3 }[];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";

const SAFE_URL = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|\/[^\s"'<>]*|#[a-z0-9-]+)$/i;

function inline(raw: string, site: string): string {
  const code: string[] = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = url.replace(/&amp;/g, "&");
    return SAFE_URL.test(u) && !u.startsWith("mailto:") ? `<img src="${esc(u)}" alt="${alt}" loading="lazy" decoding="async"/>` : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, "&");
    if (!SAFE_URL.test(u)) return m;
    const external = u.startsWith("https://") && !u.startsWith(site);
    return `<a href="${esc(u)}"${external ? ' rel="noopener" target="_blank"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[Number(i)]}</code>`);
}

export function renderMarkdown(md: string, site = "https://konduct.com.ng"): { html: string; toc: Toc; text: string } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const toc: Toc = [];
  const ids = new Set<string>();
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), site)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, site)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(" "), site)}</p></blockquote>`);
    quote = [];
  };
  const flush = () => (flushPara(), flushList(), flushQuote());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (h) {
      flush();
      // A post's title is its only h1, so # in the body becomes h2.
      const level = Math.min(Math.max(h[1].length, 2), 4) as 2 | 3 | 4;
      let id = slugify(h[2]);
      while (ids.has(id)) id += "-2";
      ids.add(id);
      if (level < 4) toc.push({ id, text: h[2].replace(/[*_`]/g, ""), level: level as 2 | 3 });
      out.push(`<h${level} id="${id}">${inline(h[2], site)}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr/>");
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flush();

  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { html: out.join("\n"), toc, text };
}
