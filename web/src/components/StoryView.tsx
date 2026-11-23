import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon, ArchiveXIcon, BadgeDollarSignIcon, ChevronLeftIcon, ChevronRightIcon, FileIcon, FlagIcon, InboxIcon,
  ListChecksIcon, MailIcon, SendIcon, ShieldCheckIcon, SparklesIcon, Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Snapshot, Msg, money, fmtDate, isPlannie, nameOf } from "@/api";
import { ROLES } from "../../../src/org.mjs";
import { MailBody } from "./MailBody";
import { ExchangeCard, groupExchanges, type ExchangeGroup } from "./PlannedExchange";
import { ListRow, Monogram, SectionLabel, SF, SidebarItem, Status, TrafficLights, mailFont, time } from "./mac";

// The demo mail panes adapt from a desktop split view to inbox and thread screens on phones.
// Several requests can run at once (demo #2), so the reading pane follows whichever request moved last,
// with tabs to look at the others.

type Item =
  | { kind: "mail"; at: string; m: Msg }
  | { kind: "note"; at: string; text: string; key: string }
  | { kind: "planned"; at: string; g: ExchangeGroup };

const preview = (b: string) => b.replace(/\*\*/g, "").replace(/\*\(([^)]+)\)\*/g, "($1)").replace(/\n*— ccPlannie ·.*$/s, "").replace(/\n+/g, " ").trim();
const stripSig = (b: string) => b.replace(/\n*— ccPlannie ·.*$/s, "");
const amountOf = (t: string) => t.match(/CAD [\d,]+/)?.[0] ?? "";

// Event history worth a line in the feed (mail and Planned exchanges speak for themselves).
function noteFor(s: Snapshot, h: any): string | null {
  const who = (a: string) => s.people[a]?.name ?? (a === "admin" ? "The administrator" : a);
  switch (h.action) {
    case "approval.blocked": return `Not sent for approval: ${h.summary.split("needs an eligible approver: ")[1]?.replace(/\s*R-\d+ needs.*$/, "") ?? h.summary}`;
    case "approval.reassigned": return `Admin dashboard: ${h.summary.replace(/^Administrator /, "the administrator ")}`;
    case "approval.refused": return h.summary;
    case "routing.changed": case "routing.reassigned": return `Admin dashboard: ${h.summary.replace(/^Administrator /, "the administrator ").split(";")[0]}`;
    case "contract.reviewed": return `${who(h.actor)} checked the fee rule in the contract`;
    case "flow.hold": return "Company rules paused the request for a check.";
    case "flow.loopin": case "decision.manual": case "resumed": return h.summary;
    case "paused.suppressed": return "ccPlannie recorded the email and stayed quiet while the request was paused.";
    case "review.flagged": return h.source?.timedOutRequestId ? h.summary : null;
    case "approval.granted": return null;
    default: return null;
  }
}

type Focus = { kind: "event"; id: string } | { kind: "context" };
// Same timestamp: activity notes, then Planned, then mail.
const rank = (i: Item) => (i.kind === "note" ? 0 : i.kind === "planned" ? 1 : 2);

export function StoryView({ s }: { s: Snapshot }) {
  const contacts = Object.entries(s.people).filter(([, person]) => !person.alias);
  // Earlier emails between participants can provide context for a request opened later.
  const contextOf = useMemo(() => {
    const byEvent = new Map<string | null, Msg[]>();
    const evs = [...s.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const m of s.messages.filter((x) => x.direction === "human" && !x.eventId && !x.seenByPlannie)) {
      const next = evs.find((e) => e.createdAt >= m.at)?.id ?? null;
      byEvent.set(next, [...(byEvent.get(next) || []), m]);
    }
    return byEvent;
  }, [s]);

  // Follow the request that moved most recently, or the preceding participant conversation.
  const latest = useMemo<Focus | null>(() => {
    let best: { at: string; f: Focus } | null = null;
    const bump = (at: string, f: Focus) => { if (!best || at >= best.at) best = { at, f }; };
    for (const ev of s.events) {
      for (const h of ev.history) bump(h.at, { kind: "event", id: ev.id });
    }
    for (const m of s.messages) {
      if (m.eventId) bump(m.at, { kind: "event", id: m.eventId });
      else if (m.direction === "human" && !m.seenByPlannie) bump(m.at, { kind: "context" });
    }
    for (const x of s.planned) if (x.eventId) bump(x.at, { kind: "event", id: x.eventId });
    return (best as { at: string; f: Focus } | null)?.f ?? null;
  }, [s]);
  const [picked, setPicked] = useState<Focus | null>(null);
  const step = s.demo.steps[s.demo.step - 1];
  const stepMail = s.messages.find((m) => m.id === s.demo.focusMessageId) ??
    (step?.kind === "email" ? s.messages.findLast((m) => m.direction === "human" && m.meta?.fixtureKey === step.key) : undefined);
  const focus = picked ?? (stepMail ? stepMail.eventId ? { kind: "event" as const, id: stepMail.eventId } : { kind: "context" as const } : latest);
  const ev = focus?.kind === "event" ? s.events.find((e) => e.id === focus.id) : null;

  const items: Item[] = useMemo(() => {
    if (focus?.kind === "context") return (contextOf.get(null) || []).map((m) => ({ kind: "mail" as const, at: m.at, m }));
    if (!ev) return [];
    const mails = [...(contextOf.get(ev.id) || []), ...s.messages.filter((m) => m.eventId === ev.id)];
    const notes = (ev.history || []).map((h: any) => ({ h, text: noteFor(s, h) })).filter((x: any) => x.text);
    const planned = groupExchanges(s.planned.filter((x) => x.eventId === ev.id));
    return [
      ...mails.map((m) => ({ kind: "mail" as const, at: m.at, m })),
      ...notes.map((n: any) => ({ kind: "note" as const, at: n.h.at, text: n.text as string, key: `n${n.h.seq}` })),
      ...planned.map((g) => ({ kind: "planned" as const, at: g.at, g })),
    ].sort((a, b) => a.at.localeCompare(b.at) || rank(a) - rank(b));
  }, [s, ev, focus?.kind, contextOf]);
  const mails = items.filter((i): i is Extract<Item, { kind: "mail" }> => i.kind === "mail").map((i) => i.m);
  const newest = mails.at(-1);

  const [opened, setOpened] = useState<{ id: string } | null>(null);
  const [phoneList, setPhoneList] = useState(false); // iOS: inbox list vs. open thread
  const scripted = !picked && mails.some((m) => m.id === stepMail?.id) ? stepMail : undefined;
  const selected = opened?.id ?? scripted?.id ?? newest?.id;
  const selectedMail = mails.find((m) => m.id === selected) ?? newest;
  const recipients = selectedMail && [...new Set([...selectedMail.to, ...selectedMail.cc])]
    .filter((address) => address !== s.plannie.from && !isPlannie(s, address))
    .map((address) => nameOf(s, address)).join(", ");
  const pane = useRef<HTMLDivElement>(null);
  const nearLatest = useRef(true);

  useEffect(() => { setOpened(null); setPhoneList(false); }, [newest?.id]);

  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) {
      nearLatest.current = true;
      return;
    }
    if (phoneList || opened || !nearLatest.current) return;
    const target = scripted && el.querySelector(`[data-msg="${CSS.escape(scripted.id)}"]`);
    el.scrollTop = target ? el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top : el.scrollHeight;
  }, [items.length, newest?.id, phoneList, opened, scripted?.id]);

  useEffect(() => {
    const el = pane.current;
    if (!el || phoneList || !opened) return;
    const target = el.querySelector(`[data-msg="${CSS.escape(opened.id)}"]`);
    if (!target) return;
    const top = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    el.scrollTo({ top, behavior: "smooth" });
  }, [opened, phoneList]);

  const open = (id: string) => {
    setOpened({ id });
    setPhoneList(false);
  };
  const tabs = s.events.map((e) => ({ f: { kind: "event" as const, id: e.id }, label: e.title, sub: e.id }));
  const same = (a: Focus | null, b: Focus) => !!a && a.kind === b.kind && (a.kind !== "event" || (b.kind === "event" && a.id === b.id));

  return (
    <div className="flex h-full overflow-hidden rounded-[var(--concept-panel-radius)] bg-m-window text-m-label md:shadow-[0_0_0_0.5px_var(--m-frame),0_20px_50px_rgba(0,0,0,0.28)]" style={mailFont}>
      {/* Sidebar */}
      <aside className="hidden w-[208px] shrink-0 flex-col overflow-y-auto bg-m-sidebar pb-3 lg:flex">
        <div className="flex h-[52px] shrink-0 items-center px-[18px]"><TrafficLights /></div>
        <section aria-label="Mailboxes">
          <SectionLabel className="pt-0">Mailboxes</SectionLabel>
          <SidebarItem icon={InboxIcon} label="Inbox" count={mails.length || undefined} selected />
          <SidebarItem icon={SendIcon} label="Sent" />
          <SidebarItem icon={FlagIcon} label="Flagged" />
          <SidebarItem icon={FileIcon} label="Drafts" />
          <SidebarItem icon={ArchiveXIcon} label="Junk" />
          <SidebarItem icon={Trash2Icon} label="Trash" />
          <SidebarItem icon={ArchiveIcon} label="Archive" />
        </section>
        <section aria-label="Contacts">
          <SectionLabel>Contacts</SectionLabel>
          <ul>
            {contacts.map(([addr, person]) => {
              const roles = person.roles?.map((key) => s.roleLabels?.[key] ?? ROLES[key as keyof typeof ROLES]?.label ?? key).join(" · ");
              return (
                <li key={addr} className="mx-[18px] flex min-h-9 items-center gap-[7px] py-1">
                  <Monogram s={s} addr={addr} size={18} />
                  <div className="min-w-0 flex-1 wrap-break-word leading-tight">
                    <div className="text-[13px]">{person.name}</div>
                    <div className="text-[11px] text-m-label2">{roles || person.title}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>

      {/* Message list */}
      <section role="region" aria-label="Inbox" className={cn("min-h-0 flex-col md:flex md:w-[330px] md:shrink-0 md:border-r md:border-m-sep", phoneList ? "flex flex-1" : "hidden")}>
        {/* macOS list header */}
        <div className="hidden h-[52px] shrink-0 items-center gap-1 pl-4 pr-2 md:flex">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-[18px]">Inbox</div>
            {recipients ? <div className="truncate text-[11px] text-m-label2" title={recipients}>{recipients}</div> : null}
          </div>
        </div>
        {/* iOS large title */}
        <div className="shrink-0 px-4 pb-2 pt-11 md:hidden">
          <h1 className="text-[34px] font-bold leading-[41px]">Inbox</h1>
          {recipients ? <p className="truncate text-sm text-m-label2" title={recipients}>{recipients}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto md:pt-1.5">
          {mails.length === 0 ? <div className="pt-24 text-center text-[13px] text-m-label2">No Messages</div> : [...mails].reverse().map((m) => (
            <div key={m.id}>
              <div className="hidden md:block">
                <ListRow
                  sender={nameOf(s, m.from)} date={time(m.at)} subject={m.subject} preview={preview(m.body)}
                  selected={m.id === selected} onClick={() => open(m.id)}
                  badge={m.direction === "plannie" ? <SparklesIcon aria-hidden="true" className={cn("size-3 shrink-0", m.id === selected ? "text-white" : "text-m-accent")} strokeWidth={SF} /> : null}
                />
              </div>
              <button type="button" onClick={() => open(m.id)} className="block w-full pl-4 text-left md:hidden">
                <div className="border-b border-m-sep py-2.5 pr-4">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{nameOf(s, m.from)}</span>
                    <span className="shrink-0 text-[15px] text-m-label2">{time(m.at)}</span>
                    <ChevronRightIcon className="size-4 shrink-0 self-center text-m-label3" strokeWidth={2.2} />
                  </div>
                  <div className="flex items-center gap-1.5 text-[15px]">
                    {m.direction === "plannie" && <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0 text-m-accent" strokeWidth={SF} />}
                    <span className="truncate">{m.subject}</span>
                  </div>
                  <div className="line-clamp-2 text-[15px] leading-[20px] text-m-label2">{preview(m.body)}</div>
                </div>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Reading pane */}
      <section className={cn("min-w-0 flex-1 flex-col bg-m-window", phoneList ? "hidden md:flex" : "flex")}>
        <div className="hidden h-[52px] shrink-0 items-center gap-4 border-b border-m-sep px-4 md:flex">
          <TrafficLights className="lg:hidden" />
          <span className="text-[13px] font-semibold">Conversation</span>
        </div>
        {/* iOS navigation bar */}
        <div className="flex h-11 shrink-0 items-center px-1 md:hidden">
          <button type="button" aria-label="Back to inbox" onClick={() => setPhoneList(true)} className="flex items-center text-[17px] text-m-select"><ChevronLeftIcon className="size-7" strokeWidth={2} />Inbox</button>
        </div>

        {tabs.length > 1 ? (
          <nav aria-label="Requests" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-m-sep px-4 py-2 md:px-6">
            {tabs.map((t) => (
              <button key={t.f.id} type="button" aria-pressed={same(focus, t.f)} onClick={() => setPicked(t.f)}
                className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] leading-[16px]", same(focus, t.f) ? "bg-m-select text-white" : "bg-m-fill text-m-label hover:bg-m-sidesel")}>
                <span className="max-w-[16rem] truncate">{t.label}</span>
                <span className={cn("tabular-nums", same(focus, t.f) ? "text-white" : "text-m-label2")}>{t.sub}</span>
              </button>
            ))}
          </nav>
        ) : null}
        {ev ? <EventBanner ev={ev} /> : null}
        {items.length === 0 ? <Intro s={s} /> : (
          <div
            ref={pane}
            role="region"
            aria-label="Message feed"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10"
            onScroll={({ currentTarget: el }) => {
              nearLatest.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 48;
            }}
          >
            {items.map((it) => it.kind === "note"
              ? <p key={it.key} className="flex items-start gap-3 border-b border-m-sep bg-m-banner px-4 py-2.5 text-[13px] leading-[18px] md:px-6">
                  <span className="flex w-6 shrink-0 justify-center md:w-10"><ListChecksIcon aria-hidden="true" className="size-4 text-m-icon" strokeWidth={SF} /></span>
                  <span><span className="sr-only">Event activity. </span>{it.text}</span>
                </p>
              : it.kind === "planned" ? <ExchangeCard key={it.g.key} g={it.g} />
              : <MailMessage key={it.m.id} s={s} m={it.m} ev={ev} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function MailMessage({ s, m, ev }: { s: Snapshot; m: Msg; ev: any }) {
  const names = (as: string[]) => as.map((a) => nameOf(s, a)).join(", ");
  const fromPlannie = m.direction === "plannie";
  const thread = ev?.threads?.find((t: any) => t.messages.includes(m.id));
  const privateTo = thread?.kind === "approval" ? [...m.to, m.from].map((a) => s.people[a]?.name).filter(Boolean)[0] : null;
  return (
    <article data-msg={m.id} className={cn(
      "border-b border-m-sep px-4 pb-5 pt-4 md:px-6",
      fromPlannie && "relative bg-m-accent/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-m-accent/70",
    )}>
      <header className="flex items-start gap-3">
        <Monogram s={s} addr={m.from} size={40} />
        <div className="min-w-0 flex-1 leading-[18px]">
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold md:text-[14px]">{nameOf(s, m.from)}</span>
            <span className="shrink-0 text-[13px] text-m-label2 md:text-[12px]">{time(m.at)}</span>
          </div>
          <div className="truncate text-[14px] md:text-[13px]">{m.subject}</div>
          <div className="truncate text-[13px] text-m-label2 md:text-[12px]">To: <span className="text-m-label">{names(m.to)}</span>{m.cc.length ? <>{"   "}Cc: <span className="text-m-label">{names(m.cc)}</span></> : null}</div>
          {privateTo ? <div className="mt-0.5 text-[12px] text-m-label2 md:text-[11px]">Private finance approval thread{m.identity?.verified === false ? <span className="text-[#c93400]"> · sender not verified</span> : null}</div> : m.identity?.verified === false ? <div className="mt-0.5 text-[12px] text-[#c93400] md:text-[11px]">Sender not verified</div> : null}
          {m.delivery === "failed" ? <div className="mt-0.5 text-[12px] text-[#c93400] md:text-[11px]">Delivery failed</div> : null}
        </div>
      </header>
      <div className="mt-3 text-[15px] md:ml-[52px] md:text-[13px]"><MailBody body={stripSig(m.body)} meta={m.meta} hideOptionsText /></div>
    </article>
  );
}

function EventBanner({ ev }: { ev: any }) {
  if (!ev) return null;
  const { working, committed: booked, drift } = ev.views;
  const code = ev.statusInfo.code;
  // Same colors as the console (lib/status.ts): green done, blue moving, orange waiting on a person.
  const status: [string, "green" | "orange" | "gray" | "blue"] = code === "confirmed" ? ["Booked", "green"] : code === "approval_needed" ? ["Waiting for finance", "orange"] : code === "paused" ? ["Paused", "gray"] : booked && drift.length ? ["Change in progress", "blue"] : ["Planning", "blue"];
  const details = [
    ["Expected attendance", working.headcount != null ? `${working.headcount} guests` : "—"],
    ["Planned date", fmtDate(working.date)],
    ["Booked date", fmtDate(booked?.date)],
    ["Venue", (booked?.supplier || working.supplier) ?? "—"],
    ["Cost", money(booked ? booked.amount : working.amount)],
  ];
  return (
    <section aria-label="Event summary" className="@container shrink-0 border-b border-m-sep bg-m-banner px-4 py-2.5 md:px-6">
      <div className="flex items-center gap-2.5">
        <CalendarTile date={working.date} />
        <h2 title={ev.title} className="min-w-0 flex-1 truncate text-[13px] leading-[17px] font-semibold">{ev.title}</h2>
        <Status tone={status[1]}>{status[0]}</Status>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-m-sep pt-2 text-[12px] leading-[16px] @xs:grid-cols-3 @xl:grid-cols-5">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[11px] text-m-label2">{label}</dt>
            <dd className="truncate font-medium text-m-label" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CalendarTile({ date }: { date?: string | null }) {
  const d = date ? new Date(date + "T12:00:00Z") : null;
  return (
    <span aria-hidden="true" className="flex size-[26px] shrink-0 flex-col overflow-hidden rounded-[6px] bg-white text-center shadow-[0_0_0_0.5px_rgba(0,0,0,0.15)]">
      <span className="bg-[#ff3b30] text-[6.5px] font-bold uppercase leading-[8px] text-white">{d?.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) ?? "Date"}</span>
      <span className="flex-1 text-[13px] font-medium leading-[17px] text-[#1d1d1f]">{d?.getUTCDate() ?? "–"}</span>
    </span>
  );
}

function Intro({ s }: { s: Snapshot }) {
  const rows = [
    { icon: MailIcon, title: "Nothing new to learn", description: "Everyone keeps using email. ccPlannie reads what it's cc'd on." },
    { icon: BadgeDollarSignIcon, title: "Costs before decisions", description: "Every change shows what it costs before anyone agrees." },
    { icon: ShieldCheckIcon, title: "Nothing booked early", description: "Finance approves exact terms before Planned books anything." },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-[clamp(0.5rem,4dvh,2rem)]">
      <section aria-labelledby="story-intro-title" className="w-full max-w-[400px]">
        <div aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-full bg-linear-to-b from-[var(--m-avatar1)] to-[var(--m-avatar2)] text-white">
          <SparklesIcon className="size-8" strokeWidth={SF} />
        </div>
        <h2 id="story-intro-title" className="mt-3.5 text-center text-[26px] font-bold leading-tight tracking-[-0.01em]">Plan an event by email.</h2>
        <p className="mt-1.5 text-center text-[13px] leading-[18px] text-m-label2">{s.demo.scenario ? `Demo #${s.demo.scenario.number} · ${s.demo.scenario.company.replace(/ \(fictional\)/, "")}. ` : ""}ccPlannie works with your event team and asks the right person before anything is booked.</p>
        <ul role="list" className="mt-5 space-y-3.5">
          {rows.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-3">
              <Icon aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-m-accent" strokeWidth={1.5} />
              <div className="text-[13px] leading-[18px]">
                <h3 className="font-semibold">{title}</h3>
                <p className="text-m-label2">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
