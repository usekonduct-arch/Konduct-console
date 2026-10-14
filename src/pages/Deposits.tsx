import { useState, type FormEvent } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";

import { call, db } from "../lib/firebase";
import { naira, when } from "../lib/format";
import { useLiveQuery, type Row } from "../lib/live";
import { can, useSession } from "../lib/session";
import { Badge, Button, Card, Dialog, Empty, ErrorText, Field, Loading, Notice, PageHead, useAction, useToast } from "../ui";
import { Who } from "./Approvals";

export default function Deposits() {
  const s = useSession();
  const [tab, setTab] = useState<"unmatched" | "all">("unmatched");
  const [assign, setAssign] = useState<Row | null>(null);
  const all = useLiveQuery(query(collection(db, "deposits"), orderBy("createdAt", "desc"), limit(200)), "deposits");
  const unmatched = all.data.filter((d) => d.status === "unmatched");
  const list = tab === "unmatched" ? unmatched : all.data;

  return (
    <>
      <PageHead kicker="Deposits" title="Bank transfers into Konduct">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "unmatched"} onClick={() => setTab("unmatched")}>
            Unmatched ({unmatched.length})
          </button>
          <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            All
          </button>
        </div>
      </PageHead>
      <Notice>
        Transfers are matched by the rider's funding code in the narration. When there's no code, the money waits here. Assign it only when you're sure whose it is (ask the rider for
        their bank receipt); a second person approves.
      </Notice>
      <Card tight>
        {all.loading ? (
          <Loading />
        ) : all.error ? (
          <Empty>{all.error}</Empty>
        ) : list.length === 0 ? (
          <Empty>{tab === "unmatched" ? "Every deposit is matched." : "No deposits yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Narration</th>
                  <th className="num">Amount</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <b>{d.senderName ?? "Unknown sender"}</b>
                      <div className="muted mono">
                        {d.senderBankCode ?? "—"} · ****{d.senderAccountLast4 ?? "????"}
                      </div>
                    </td>
                    <td className="muted">{d.narration || "—"}</td>
                    <td className="num mono">{naira(d.amountKobo)}</td>
                    <td className="muted">{when(d.createdAt)}</td>
                    <td>
                      {d.status === "credited" ? (
                        <>
                          <Badge tone="good">Credited</Badge>
                          <div className="muted">
                            <Who uid={d.uid} /> · {d.matchedBy}
                          </div>
                        </>
                      ) : (
                        <Badge tone="warn">Unmatched</Badge>
                      )}
                    </td>
                    <td className="right">
                      {d.status === "unmatched" && can.assignDeposits(s.role) ? (
                        <Button small onClick={() => setAssign(d)}>
                          Assign
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
      {assign ? <AssignDialog deposit={assign} onClose={() => setAssign(null)} /> : null}
    </>
  );
}

function AssignDialog({ deposit, onClose }: { deposit: Row; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [rider, setRider] = useState<Row | null>(null);
  const find = useAction();
  const a = useAction();

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setRider(null);
    await find.run(async () => {
      const c = code.trim().toUpperCase().replace(/\s/g, "");
      const snap = await getDocs(query(collection(db, "users"), where("fundingCode", "==", c), limit(1)));
      if (snap.empty) throw new Error("No rider has that funding code.");
      const d = snap.docs[0];
      setRider({ id: d.id, ...d.data() });
    });
  }

  async function assign() {
    if (!rider) return;
    const r = await a.run(() => call("staffAssignDeposit", { depositId: deposit.id, uid: rider.id }));
    if (r) {
      toast("Requested. A second person (ops or admin) has to approve it in Approvals.");
      onClose();
    }
  }

  return (
    <Dialog title={`Assign ${naira(deposit.amountKobo)}`} onClose={onClose}>
      <div className="stack">
        <p className="small">
          From <b>{deposit.senderName ?? "unknown sender"}</b> · {when(deposit.createdAt)}
          {deposit.narration ? (
            <>
              <br />
              Narration: "{deposit.narration}"
            </>
          ) : null}
        </p>
        <form className="search-row" onSubmit={lookup}>
          <Field label="Rider's funding code" value={code} onChange={setCode} mono placeholder="KD7Q4M2P" hint="It's on the Account page of their app." />
          <Button type="submit" kind="ghost" busy={find.busy}>
            Find
          </Button>
        </form>
        <ErrorText>{find.error}</ErrorText>
        {rider ? (
          <Notice tone={rider.role === "rider" ? "info" : "bad"}>
            {rider.role === "rider" ? (
              <>
                <b>{rider.fullName}</b> · {rider.studentId} · {rider.email}
              </>
            ) : (
              "That account isn't a rider. Deposits can only go to rider wallets."
            )}
          </Notice>
        ) : null}
        <ErrorText>{a.error}</ErrorText>
        <Button onClick={assign} busy={a.busy} disabled={!rider || rider.role !== "rider"}>
          Request assignment
        </Button>
      </div>
    </Dialog>
  );
}
