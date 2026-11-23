import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveIcon, ChevronLeftIcon, ForwardIcon, InboxIcon, PaperclipIcon, ReplyAllIcon, ReplyIcon, SendIcon, SparklesIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Snapshot, Msg, post, nameOf, isPlannie, fmtTime } from "@/api";
import { ListRow, Monogram, PushButton, SearchField, SectionLabel, SF, SidebarItem, ToolIcon, mailFont } from "./mac";
import { MailBody } from "./MailBody";

type Conversation = { key: string; subject: string; messages: Msg[]; last: Msg; participants: string[] };

export function groupConversations(msgs: Msg[]): Conversation[] {
  const byKey = new Map<string, Msg[]>();
  const rootOf = (m: Msg) => m.references?.[0] || m.messageId;
  for (const m of msgs) { const k = rootOf(m); byKey.set(k, [...(byKey.get(k) || []), m]); }
  return [...byKey.entries()].map(([key, ms]) => {
    ms.sort((a, b) => a.at.localeCompare(b.at));
    return { key, subject: ms[0].subject.replace(/^(re|fwd?):\s*/i, ""), messages: ms, last: ms.at(-1)!, participants: [...new Set(ms.flatMap((m) => [m.from, ...m.to, ...m.cc]))] };
  }).sort((a, b) => b.last.at.localeCompare(a.last.at));
}

export function PersonAvatar({ s, addr, size = "md" }: { s: Snapshot; addr: string; size?: "sm" | "md" }) {
  return <Monogram s={s} addr={addr} size={size === "sm" ? 28 : 40} />;
}

// One message in a thread, laid out like Mail: monogram, sender, recipients, date; hairline below.
export function MessageCard({ s, m, viewer, compact, plain }: { s: Snapshot; m: Msg; viewer?: string; compact?: boolean; plain?: boolean }) {
  const names = (as: string[]) => as.map((a) => (a === viewer ? "me" : nameOf(s, a))).join(", ");
  return (
    <article className={cn("border-b border-m-sep text-m-label", compact ? "py-3" : "px-6 pb-5 pt-4")}>
      <header className="flex items-start gap-3 leading-[18px]">
        <Monogram s={s} addr={m.from} size={compact ? 32 : 40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{nameOf(s, m.from)}</span>
            <time className="shrink-0 text-[12px] tabular-nums text-m-label2">{fmtTime(m.at)}</time>
          </div>
          <div className="truncate text-[13px]">{m.subject}</div>
          <div className="truncate text-[12px] text-m-label2">To: <span className="text-m-label">{names(m.to)}</span>{m.cc.length ? <>{"   "}Cc: <span className="text-m-label">{names(m.cc)}</span></> : null}</div>
        </div>
      </header>
      <div className={cn("text-[13px]", compact ? "ml-11 mt-2" : "ml-[52px] mt-3")}>
        <MailBody body={plain ? m.body.replace(/\n*— ccPlannie ·.*$/, "") : m.body} meta={m.meta} hideOptionsText />
        {m.attachments?.length ? <div className="mt-3 flex flex-wrap gap-2">{m.attachments.map((a: any) => <span key={a.name} className="flex items-center gap-1.5 rounded-[6px] bg-m-fill px-2.5 py-1 text-[12px]"><PaperclipIcon className="size-3.5 text-m-icon" strokeWidth={SF} />{a.name}</span>)}</div> : null}
      </div>
    </article>
  );
}

export function MailApp({ s, viewer, setViewer, focus, refresh, toast }: { s: Snapshot; viewer: string; setViewer: (v: string) => void; focus: string | null; refresh: () => void; toast: (t: string) => void }) {
  const [box, setBox] = useState<"inbox" | "sent" | "plannie">("inbox");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const mine = useMemo(() => s.messages.filter((m) => m.direction !== "supplier" && (m.from === viewer || m.to.includes(viewer) || m.cc.includes(viewer))), [s, viewer]);
  const convs = useMemo(() => groupConversations(mine), [mine]);
  const shown = convs.filter((c) => (box === "sent" ? c.messages.some((m) => m.from === viewer) : box === "plannie" ? c.participants.some((a) => isPlannie(s, a)) : c.messages.some((m) => m.from !== viewer)))
    .filter((c) => !query || (c.subject + c.messages.map((m) => m.body).join(" ")).toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { if (focus) { const c = convs.find((c) => c.messages.some((m) => m.id === focus)); if (c) setSelected(c.key); } }, [focus, convs]);
  useEffect(() => { if (selected && !convs.some((c) => c.key === selected)) setSelected(null); }, [convs, selected]);
  const conv = convs.find((c) => c.key === selected) || null;
  const accounts = Object.entries(s.people).filter(([a, p]) => !p.alias && a !== "alex@acme.example");
  const inboxCount = convs.filter((c) => c.messages.some((m) => m.from !== viewer)).length;
  const title = box === "inbox" ? "Inbox" : box === "sent" ? "Sent" : "With ccPlannie";

  return (
    <div className="flex h-full min-h-0 text-m-label" style={mailFont}>
      {/* Sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto bg-m-sidebar pb-3 md:flex">
        <SectionLabel>Favorites</SectionLabel>
        {([["inbox", "Inbox", InboxIcon], ["plannie", "With ccPlannie", SparklesIcon], ["sent", "Sent", SendIcon]] as const).map(([id, label, Icon]) => (
          <SidebarItem key={id} icon={Icon} label={label} count={id === "inbox" ? inboxCount || undefined : undefined} selected={box === id} onClick={() => setBox(id)} />
        ))}
        <SectionLabel>Accounts</SectionLabel>
        {accounts.map(([addr, p]) => (
          <SidebarItem key={addr} selected={viewer === addr} onClick={() => { setViewer(addr); setSelected(null); }} lead={<Monogram s={s} addr={addr} size={20} />}
            label={<>{p.name} <span className="text-m-label2">· {p.title}</span></>} />
        ))}
        <p className="mt-auto px-[18px] pt-4 text-[11px] leading-[15px] text-m-label2">Requesters only use email. ccPlannie reads what it's cc'd on: {s.plannie.intake}</p>
      </aside>

      {/* Message list */}
      <section className={cn("flex min-h-0 w-full flex-col border-r border-m-sep bg-m-window md:w-[330px] md:shrink-0", conv && "max-md:hidden")}>
        <div className="flex h-[52px] shrink-0 items-center gap-1 pl-4 pr-2">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-[18px]">{title}</div>
            <div className="truncate text-[11px] text-m-label2">{nameOf(s, viewer)} · {shown.length} {shown.length === 1 ? "conversation" : "conversations"}</div>
          </div>
          <select aria-label="Account" className="rounded-[6px] bg-m-fill px-1.5 py-1 text-[12px] md:hidden" value={viewer} onChange={(e) => setViewer(e.target.value)}>{accounts.map(([a, p]) => <option key={a} value={a}>{p.name}</option>)}</select>
          <ToolIcon icon={SquarePenIcon} title="New message" onClick={() => setComposing(true)} />
        </div>
        <div className="shrink-0 border-b border-m-sep px-[10px] pb-2.5"><SearchField value={query} onChange={setQuery} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-1.5">
          {shown.length === 0 ? <div className="pt-24 text-center text-[13px] text-m-label2">No Messages</div> : shown.map((c) => {
            const sel = c.key === selected;
            const withPlannie = c.participants.some((a) => isPlannie(s, a));
            return (
              <ListRow key={c.key} selected={sel} onClick={() => setSelected(c.key)}
                sender={<>{nameOf(s, c.last.from)}{c.messages.length > 1 ? <span className={cn("ml-1.5 font-normal", sel ? "text-white/75" : "text-m-label2")}>{c.messages.length}</span> : null}</>}
                date={fmtTime(c.last.at)} subject={c.subject}
                badge={withPlannie ? <SparklesIcon className={cn("size-3 shrink-0", sel ? "text-white" : "text-m-accent")} strokeWidth={SF} /> : null}
                preview={c.last.body.replace(/\*\*/g, "").replace(/\n+/g, " ").slice(0, 160)} />
            );
          })}
        </div>
      </section>

      {/* Reading pane */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-m-window", !conv && "max-md:hidden")}>
        {conv ? <Reading key={conv.key} s={s} conv={conv} viewer={viewer} onBack={() => setSelected(null)} refresh={refresh} toast={toast} /> : (
          <div className="grid flex-1 place-items-center text-[20px] text-m-label3">No Message Selected</div>
        )}
      </section>
      {composing ? <Compose s={s} viewer={viewer} onClose={() => setComposing(false)} refresh={refresh} toast={toast} /> : null}
    </div>
  );
}

function Reading({ s, conv, viewer, onBack, refresh, toast }: { s: Snapshot; conv: Conversation; viewer: string; onBack: () => void; refresh: () => void; toast: (t: string) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const hidden = Math.max(0, conv.messages.length - 3);
  // Like Apple Mail: open at the newest message, keep following new arrivals.
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [conv.messages.length]);
  const last = [...conv.messages].reverse().find((m) => m.from !== viewer) || conv.last;
  const to = last.from === viewer ? last.to : [last.from];
  const cc = [...new Set([...last.to, ...last.cc].filter((a) => a !== viewer && !to.includes(a)))];
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await post("/api/mail/send", { from: viewer, to, cc, inReplyTo: last.id, body }); setBody(""); refresh(); }
    catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-0.5 border-b border-m-sep px-3">
        <button type="button" aria-label="Back" className="mr-1 flex items-center text-[15px] text-m-accent md:hidden" onClick={onBack}><ChevronLeftIcon className="size-6" strokeWidth={2} /></button>
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate text-[13px] font-semibold">{conv.subject}</h2>
          <p className="truncate text-[11px] text-m-label2">{conv.participants.map((a) => nameOf(s, a)).join(", ")}</p>
        </div>
        <ToolIcon icon={ArchiveIcon} title="Archive" className="max-lg:hidden" />
        <ToolIcon icon={Trash2Icon} title="Delete" className="max-lg:hidden" />
        <span className="w-2" />
        <ToolIcon icon={ReplyIcon} title="Reply" />
        <ToolIcon icon={ReplyAllIcon} title="Reply all" />
        <ToolIcon icon={ForwardIcon} title="Forward" />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {hidden > 0 && !expanded ? (
          <button type="button" onClick={() => setExpanded(true)} className="block w-full border-b border-m-sep py-2.5 text-center text-[12px] text-m-accent">{hidden} earlier {hidden === 1 ? "message" : "messages"}</button>
        ) : null}
        {(expanded ? conv.messages : conv.messages.slice(hidden)).map((m) => <MessageCard key={m.id} s={s} m={m} viewer={viewer} />)}
      </div>
      {/* Inline reply, like Mail's quick reply */}
      <div className="shrink-0 border-t border-m-sep">
        <div className="flex items-center gap-2 px-6 pt-2.5 text-[12px] text-m-label2"><ReplyAllIcon className="size-3.5" strokeWidth={SF} />To: <span className="text-m-label">{to.map((a) => nameOf(s, a)).join(", ")}</span>{cc.length ? <>{"  "}Cc: <span className="text-m-label">{cc.map((a) => nameOf(s, a)).join(", ")}</span></> : null}</div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} placeholder={`Reply as ${nameOf(s, viewer)}`}
          className="block max-h-40 min-h-[64px] w-full resize-none bg-transparent px-6 py-2 text-[13px] text-m-label outline-none placeholder:text-m-label3" />
        <div className="flex items-center justify-end gap-3 px-6 pb-3">
          <span className="text-[11px] text-m-label3">⌘↩</span>
          <PushButton primary disabled={!body.trim() || busy} onClick={send}>Send</PushButton>
        </div>
      </div>
    </>
  );
}

function Compose({ s, viewer, onClose, refresh, toast }: { s: Snapshot; viewer: string; onClose: () => void; refresh: () => void; toast: (t: string) => void }) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState(s.plannie.intake);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const split = (v: string) => v.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const send = async () => {
    try { await post("/api/mail/send", { from: viewer, to: split(to), cc: split(cc), subject, body }); onClose(); refresh(); }
    catch (e: any) { toast(e.message); }
  };
  const field = "min-w-0 flex-1 bg-transparent text-[13px] text-m-label outline-none";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/20 p-4" onClick={onClose}>
      <div className="flex w-full max-w-[600px] flex-col overflow-hidden rounded-[12px] bg-m-window text-m-label shadow-[0_0_0_0.5px_var(--m-frame),0_24px_60px_rgba(0,0,0,0.35)]" style={mailFont} onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[52px] items-center gap-3 border-b border-m-sep bg-m-sidebar px-4">
          <button type="button" aria-label="Close" onClick={onClose} className="size-3 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.18)]" />
          <span className="size-3 rounded-full bg-m-fill" /><span className="size-3 rounded-full bg-m-fill" />
          <span className="ml-2 text-[13px] font-semibold">{subject.trim() || "New Message"}</span>
          <button type="button" title="Send" aria-label="Send" disabled={!body.trim() || !to.trim()} onClick={send} className="ml-auto grid h-7 w-8 place-items-center rounded-[6px] text-m-accent hover:bg-m-fill disabled:text-m-label3"><SendIcon className="size-[17px]" strokeWidth={SF} /></button>
        </div>
        <div className="px-4 text-[13px]">
          <label className="flex h-[34px] items-center gap-2 border-b border-m-sep"><span className="w-[60px] text-right text-m-label2">To:</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="sam@acme.example" className={field} /></label>
          <label className="flex h-[34px] items-center gap-2 border-b border-m-sep"><span className="w-[60px] text-right text-m-label2">Cc:</span><input value={cc} onChange={(e) => setCc(e.target.value)} className={field} /></label>
          <label className="flex h-[34px] items-center gap-2 border-b border-m-sep"><span className="w-[60px] text-right text-m-label2">Subject:</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} /></label>
          <div className="flex h-[34px] items-center gap-2 border-b border-m-sep"><span className="w-[60px] text-right text-m-label2">From:</span><span className="truncate">{nameOf(s, viewer)} &lt;{viewer}&gt;</span></div>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-56 resize-none bg-transparent px-4 py-3 text-[13px] text-m-label outline-none" />
        <div className="border-t border-m-sep px-4 py-2 text-[11px] text-m-label2">ccPlannie to have the event team organize it.</div>
      </div>
    </div>
  );
}
