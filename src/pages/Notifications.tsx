import { useState, type FormEvent } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
import { ImageField, LinkField, validLink } from "../lib/media";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Check, Empty, ErrorText, Field, Loading, Notice, PageHead, Select, useAction, useToast } from "../ui";
import { Who } from "./Approvals";

type Audience = "rider" | "driver" | "all" | "one";

const AUDIENCE_LABEL: Record<string, string> = { rider: "All riders", driver: "All drivers", all: "Everyone", one: "One person" };

export default function Notifications() {
  const s = useSession();
  const history = useLiveQuery(query(collection(db, "broadcasts"), orderBy("createdAtMs", "desc"), limit(60)), "broadcasts");
  const allowed = can.message(s.role);

  return (
    <>
      <PageHead kicker="Notifications" title="Message riders and drivers" />
      <Notice>
        Messages land in the app's inbox (the bell). Tick <b>Pop up</b> to open it over the app the next time it's in front, and <b>Push</b> to also send it to
        the phone's notification bar, even when the app is closed.
      </Notice>
      {allowed ? <Compose /> : <Notice tone="warn">Only admins and operations can send messages.</Notice>}
      <Card tight title="Sent">
        {history.loading ? (
          <Loading />
        ) : history.error ? (
          <Empty>{history.error}</Empty>
        ) : history.data.length === 0 ? (
          <Empty>Nothing sent yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>To</th>
                  <th>How</th>
                  <th>Sent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.data.map((b) => (
                  <SentRow key={b.id} b={b} canEdit={allowed} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function SentRow({ b, canEdit }: { b: Row; canEdit: boolean }) {
  const a = useAction();
  const toast = useToast();
  const group = b.audience !== "one";
  async function toggle() {
    const r = await a.run(() => call<{ active: boolean }>("staffSetBroadcast", { id: b.id, active: !b.active }));
    if (r) toast(r.active ? "Back in the apps." : "Taken out of the apps.");
  }
  return (
    <tr>
      <td>
        <b>{b.title}</b>
        <div className="muted">{String(b.body).slice(0, 120)}</div>
        <ErrorText>{a.error}</ErrorText>
      </td>
      <td>{group ? AUDIENCE_LABEL[b.audience] : <Who uid={b.targetUid} />}</td>
      <td className="nowrap">
        <span className="row">
          <Badge tone="info">Inbox</Badge>
          {b.popup ? <Badge tone="warn">Popup</Badge> : null}
          {b.push ? <Badge tone={b.pushed === false ? "bad" : "good"}>{b.pushed === false ? "Push failed" : "Push"}</Badge> : null}
        </span>
      </td>
      <td className="muted">
        {when(b.createdAtMs)}
        <div className="small">
          by <Who uid={b.sentBy} />
        </div>
      </td>
      <td className="right nowrap">
        {group && canEdit ? (
          <Button small kind="ghost" busy={a.busy} onClick={toggle}>
            {b.active ? "Retract" : "Restore"}
          </Button>
        ) : null}
        {group && !b.active ? <div className="small muted">Not in apps</div> : null}
      </td>
    </tr>
  );
}

function Compose() {
  const toast = useToast();
  const a = useAction();
  const [audience, setAudience] = useState<Audience>("rider");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [link, setLink] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [popup, setPopup] = useState(false);
  const [push, setPush] = useState(true);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2 || body.trim().length < 2) return a.setError("Write a title and a message.");
    if (!validLink(link)) return a.setError("Fix the link first.");
    if (link && !linkLabel.trim()) return a.setError("Give the button a label, for example \"Top up now\".");
    if (audience === "one" && !to.trim()) return a.setError("Enter the person's email or account ID.");
    const who = audience === "one" ? to.trim() : AUDIENCE_LABEL[audience].toLowerCase();
    if (audience !== "one" && !window.confirm(`Send "${title.trim()}" to ${who}?`)) return;
    const r = await a.run(() =>
      call<{ id: string; pushed?: boolean }>("staffSendNotice", {
        audience,
        ...(audience === "one" ? { to: to.trim() } : {}),
        title: title.trim(),
        body: body.trim(),
        ...(imageUrl ? { imageUrl } : {}),
        ...(link ? { link, linkLabel: linkLabel.trim() } : {}),
        popup,
        push,
      }),
    );
    if (r) {
      toast(push && r.pushed === false ? "In the apps' inboxes, but the push didn't go out." : `Sent to ${who}.`);
      setTitle("");
      setBody("");
      setImageUrl("");
      setLink("");
      setLinkLabel("");
      setPopup(false);
    }
  }

  return (
    <Card title="New message">
      <form className="stack" onSubmit={send}>
        <div className="grid-2">
          <Select<Audience>
            label="Send to"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "rider", label: "All riders" },
              { value: "driver", label: "All drivers" },
              { value: "all", label: "Everyone (riders and drivers)" },
              { value: "one", label: "One person" },
            ]}
          />
          {audience === "one" ? <Field label="Their email or account ID" value={to} onChange={setTo} placeholder="ada@uniosun.edu.ng" /> : <span />}
        </div>
        <Field label="Title" value={title} onChange={setTitle} maxLength={80} placeholder="Free rides this Friday" />
        <label className="field">
          <span className="field-label">Message</span>
          <textarea rows={4} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you want them to know?" />
          <span className="field-hint">{600 - body.length} characters left</span>
        </label>
        <ImageField label="Picture" size="notice" value={imageUrl} onChange={setImageUrl} optional />
        <div className="grid-2">
          <LinkField label="Button link (optional)" value={link} onChange={setLink} />
          <Field label="Button label" value={linkLabel} onChange={setLinkLabel} maxLength={24} placeholder="Top up now" />
        </div>
        <div className="row">
          <Check label="Pop up in the app" checked={popup} onChange={setPopup} />
          <Check label="Push to phones" checked={push} onChange={setPush} />
        </div>
        <ErrorText>{a.error}</ErrorText>
        <div className="row">
          <Button type="submit" busy={a.busy}>
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}
