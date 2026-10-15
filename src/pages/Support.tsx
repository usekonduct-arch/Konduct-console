import { useEffect, useRef, useState } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveDoc, useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Loading, Notice, PageHead, useAction } from "../ui";

/** Backend SUPPORT_CATEGORIES. */
const TOPIC: Record<string, string> = {
  complaint: "Complaint",
  payment: "Payment or wallet",
  account: "Account, password or PIN",
  app: "App problem",
  other: "Something else",
};

type Filter = "waiting" | "open" | "closed" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "waiting", label: "Needs a reply" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Solved" },
  { value: "all", label: "All" },
];

const waiting = (t: Row) => t.status === "open" && t.lastFrom === "member";

export default function Support() {
  const [filter, setFilter] = useState<Filter>("waiting");
  const [openId, setOpenId] = useState<string | null>(null);
  const threads = useLiveQuery(query(collection(db, "supportThreads"), orderBy("lastAtMs", "desc"), limit(300)), "support-threads");
  const list = threads.data.filter((t) => (filter === "all" ? true : filter === "waiting" ? waiting(t) : t.status === filter));
  const count = (f: Filter) => threads.data.filter((t) => (f === "all" ? true : f === "waiting" ? waiting(t) : t.status === f)).length;

  return (
    <>
      <PageHead kicker="Support" title="Chats with riders and drivers" />
      <Notice>
        Riders and drivers write from the help icon in their app. Your reply reaches them as a notification. Mark a chat solved when it's done; if they write again, it
        opens again.
      </Notice>
      <Card
        tight
        actions={
          <div className="tabs" role="tablist" aria-label="Filter chats">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label} {threads.loading ? "" : `(${count(f.value)})`}
              </button>
            ))}
          </div>
        }
      >
        {threads.loading ? (
          <Loading />
        ) : threads.error ? (
          <Empty>{threads.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>{filter === "waiting" ? "Nobody is waiting for a reply." : "No chats here."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Topic</th>
                  <th>Last message</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
                    <td>
                      <button type="button" className="link" onClick={() => setOpenId(t.id)}>
                        <b>{t.name || "Unnamed"}</b>
                      </button>
                      <div className="muted">{t.role === "driver" ? "Driver" : "Rider"}</div>
                    </td>
                    <td>{TOPIC[t.category] ?? t.category}</td>
                    <td className="muted">
                      {t.lastFrom === "staff" ? "Konduct: " : ""}
                      {t.lastText}
                    </td>
                    <td className="muted nowrap">{when(t.lastAtMs)}</td>
                    <td>{waiting(t) ? <Badge tone="warn">Needs a reply</Badge> : t.status === "open" ? <Badge tone="info">Open</Badge> : <Badge tone="good">Solved</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {openId ? <ThreadDialog threadId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function ThreadDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const s = useSession();
  const thread = useLiveDoc(doc(db, "supportThreads", threadId), `support-thread-${threadId}`);
  const messages = useLiveQuery(query(collection(db, "supportThreads", threadId, "messages"), orderBy("atMs")), `support-messages-${threadId}`);
  const [text, setText] = useState("");
  const a = useAction();
  const end = useRef<HTMLDivElement>(null);
  const t = thread.data;

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.data.length]);

  async function reply(close: boolean) {
    const r = await a.run(() => call("staffSupportReply", { threadId, text: text.trim(), close }));
    if (r) {
      setText("");
      if (close) onClose();
    }
  }

  const setStatus = (status: "open" | "closed") => a.run(() => call("staffSupportSetStatus", { threadId, status }));

  return (
    <Dialog title={t ? `${t.name || "Chat"} · ${TOPIC[t.category] ?? t.category}` : "Chat"} onClose={onClose} wide>
      {thread.loading ? (
        <Loading />
      ) : !t ? (
        <Empty>{thread.error ?? "This chat doesn't exist."}</Empty>
      ) : (
        <div className="stack">
          <p className="small muted">
            {t.role === "driver" ? "Driver" : "Rider"} · {t.email ?? "no email"} · started {when(t.createdAtMs)}
            {t.txId ? (
              <>
                {" "}
                · about payment <span className="mono">{t.txId}</span>
              </>
            ) : null}
          </p>
          <div className="chat" aria-live="polite">
            {messages.loading ? <Loading /> : null}
            {messages.data.map((m) => (
              <div key={m.id} className={`bubble ${m.from === "staff" ? "bubble-staff" : "bubble-member"}`}>
                {m.text}
                <span className="bubble-meta">
                  {m.from === "staff" ? `Konduct · ${m.authorName || "staff"}` : t.name || "Them"} · {when(m.atMs)}
                </span>
              </div>
            ))}
            <div ref={end} />
          </div>
          {can.answerSupport(s.role) ? (
            <>
              <label className="field">
                <span className="field-label">Your reply</span>
                <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="They'll get this as a notification." />
              </label>
              <ErrorText>{a.error}</ErrorText>
              <div className="row">
                <Button busy={a.busy} disabled={!text.trim()} onClick={() => reply(false)}>
                  Send reply
                </Button>
                <Button kind="ghost" busy={a.busy} disabled={!text.trim()} onClick={() => reply(true)}>
                  Send and mark solved
                </Button>
                {t.status === "open" ? (
                  <Button kind="ghost" busy={a.busy} onClick={() => setStatus("closed")}>
                    Mark solved
                  </Button>
                ) : (
                  <Button kind="ghost" busy={a.busy} onClick={() => setStatus("open")}>
                    Reopen
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Notice>Your role can read chats but not answer them.</Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}
