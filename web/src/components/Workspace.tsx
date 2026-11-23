import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, CalendarDaysIcon, CheckCircle2Icon, CircleDotIcon, ClockIcon, FileTextIcon, HistoryIcon, LayoutDashboardIcon, MessagesSquareIcon, PauseIcon, PlayIcon, ShieldCheckIcon, SparklesIcon, TriangleAlertIcon, UsersIcon, BuildingIcon, NotebookPenIcon } from "lucide-react";
import { Button, ScrollArea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Snapshot, post, money, fmtDate, fmtTime, nameOf } from "@/api";
import { MessageCard } from "./MailApp";
import { AskPlannie } from "./AskPlannie";

// The acting manager is always explicit (see `actor`); there is no hardcoded identity.

// Same meaning as everywhere else (lib/status.ts): green done, blue moving, orange waiting on a person, gray paused.
const STATUS_TONE: Record<string, string> = {
  received: "accent", assigned: "accent", sourcing: "accent", options: "accent", approved_internal: "accent", supplier_pending: "accent", change_in_progress: "accent",
  approval_needed: "warn", confirmed: "ok", paused: "",
};
// Apple shows state as a colored dot + secondary text, not as tinted pills.
const dotFor = (tone = "") => /ok/.test(tone) ? "bg-m-green" : /warn|destructive/.test(tone) ? "bg-m-orange" : /pending/.test(tone) ? "bg-m-purple" : /accent/.test(tone) ? "bg-m-accent" : "bg-m-label3";
export const Pill = ({ tone, children }: { tone?: string; children: any }) => <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-normal text-m-label2", tone?.match(/\b(ml-[\w.]+)/)?.[1])}><span className={cn("size-[7px] shrink-0 rounded-full", dotFor(tone))} />{children}</span>;
const Card = ({ title, icon: Icon, children, right, className }: any) => (
  <section className={cn("rounded-[10px] bg-m-banner text-[13px]", className)}>
    <header className="flex items-center gap-2 px-4 pb-1 pt-3"><Icon className="size-4 text-m-label2" strokeWidth={1.6} /><h3 className="text-[13px] font-semibold">{title}</h3><div className="ml-auto">{right}</div></header>
    <div className="p-4 pt-2">{children}</div>
  </section>
);

export function Workspace({ s, actor, focusTab, refresh, toast, openMessage }: { s: Snapshot; actor: string; focusTab?: string | null; refresh: () => void; toast: (t: string) => void; openMessage: (id: string) => void }) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "conversations" | "history">("overview");
  const ev = s.events.find((e) => e.id === eventId) || s.events[0] || null;
  const currentTab = (focusTab as any) || tab;
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[220px_1fr_340px]">
      <aside className="hidden min-h-0 flex-col gap-5 overflow-auto border-r bg-sidebar p-3 lg:flex">
        <div>
          <p className="px-2 pb-1.5 text-[11px] font-semibold text-muted-foreground">Event team</p>
          {([["overview", "Overview", LayoutDashboardIcon], ["conversations", "Conversations", MessagesSquareIcon], ["history", "History", HistoryIcon]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]", currentTab === id ? "bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] font-medium" : "hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]")}><Icon className="size-4 text-primary" />{label}</button>
          ))}
        </div>
        <div>
          <p className="px-2 pb-1.5 text-[11px] font-semibold text-muted-foreground">Events</p>
          {s.events.length === 0 ? <p className="px-2 text-xs text-muted-foreground">No events yet.</p> : s.events.map((e) => (
            <button key={e.id} onClick={() => setEventId(e.id)} className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left", ev?.id === e.id ? "bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)]" : "hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]")}>
              <span className="truncate text-[13px] font-medium">{e.title}</span>
              <span className="text-[11px] text-muted-foreground">{e.id} · {e.statusInfo.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto px-2 py-1.5"><div className="text-[13px] font-medium">{nameOf(s, actor)}</div><div className="text-[11px] text-muted-foreground">Acting as (local demo identity)</div></div>
      </aside>

      <main className="min-h-0 overflow-auto">
        {!ev ? <div className="grid h-full place-items-center p-10 text-sm text-muted-foreground">No event yet. A request starts when someone CCs ccPlannie.</div> : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
            <EventHeader s={s} ev={ev} />
            <div className="flex rounded-[7px] bg-m-fill p-[2px] lg:hidden">
              {(["overview", "conversations", "history"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn("h-6 flex-1 rounded-[5px] text-[13px] capitalize", currentTab === t && "bg-m-button shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.15)]")}>{t}</button>)}
            </div>
            {currentTab === "overview" ? <Overview s={s} ev={ev} actor={actor} refresh={refresh} toast={toast} openMessage={openMessage} /> : currentTab === "conversations" ? <Conversations s={s} ev={ev} /> : <History s={s} ev={ev} openMessage={openMessage} />}
          </div>
        )}
      </main>

      <aside className="hidden min-h-0 flex-col border-l bg-sidebar lg:flex">
        <div className="flex items-center gap-2 border-b px-4 py-3"><SparklesIcon className="size-4 text-m-accent" strokeWidth={1.6} /><span className="text-[13px] font-semibold">Ask ccPlannie</span><span className="ml-auto text-[11px] text-muted-foreground">read-only</span></div>
        <div className="min-h-0 flex-1"><AskPlannie key={ev?.id || "none"} eventId={ev?.id || null} /></div>
      </aside>
    </div>
  );
}

function EventHeader({ s, ev }: any) {
  const lastIn = [...s.messages].filter((m: any) => m.eventId === ev.id && m.direction !== "plannie").at(-1);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-[22px] font-bold">{ev.title}</h1><Pill tone={STATUS_TONE[ev.statusInfo.code]}>{ev.statusInfo.label}</Pill>{ev.paused ? <Pill>Paused</Pill> : null}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{ev.id} · requested by {nameOf(s, ev.requestedBy)} · owner {ev.owner ? nameOf(s, ev.owner) : <span className="text-warn">not yet accepted</span>} · reply address <span className="tabular-nums">{ev.address}</span></p>
        <p className="text-xs text-muted-foreground">Last update received {lastIn ? fmtTime(lastIn.at) : "—"} · ccPlannie only sees emails it's copied on.</p>
      </div>
    </div>
  );
}

function Overview({ s, ev, actor, refresh, toast, openMessage }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>(Object.values(s.suppliers).map((x: any) => x.id));
  const [manual, setManual] = useState(false);
  const act = async (action: string, args: any = {}) => {
    setBusy(action);
    try { await post(`/api/manager/${action}`, { eventId: ev.id, actor, args, expectedVersion: ev.version, requestId: `${action}-${ev.version}-${Math.random().toString(36).slice(2, 7)}` }); refresh(); }
    catch (e: any) { toast(e.message); refresh(); } finally { setBusy(null); }
  };
  const v = ev.views;
  const sel = ev.selection && ev.proposals.find((p: any) => p.id === ev.selection.proposalId);
  const pendingBinding = ev.supplierRequests.find((r: any) => (r.type === "booking" || r.type === "amendment") && r.status === "sent");
  const canAuthorize = sel && ev.approved && ev.approved.terms.proposalId === sel.id && sel.status === "current" && !pendingBinding && !(v.committed && v.drift.length === 0);
  const required = ["headcount", "date", "nights", "roomPolicy"].every((f) => ev.working[f] != null);
  const unreviewed = Object.values(ev.contracts).flatMap((c: any) => c.rules.filter((r: any) => !r.reviewed).map((r: any) => ({ ...r, contractId: c.id })));
  const openSugs = ev.suggestions.filter((x: any) => x.status === "open");
  const pendingApprovals = ev.approvals.filter((a: any) => a.status === "pending");
  const flags = ev.reviewQueue.filter((f: any) => f.open);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Plan · Approved · Booked" icon={CalendarDaysIcon} right={<DriftNote v={v} />}>
          <PlanTable ev={ev} />
        </Card>

        {(pendingApprovals.length || openSugs.length || flags.length || ev.revisionRequests.some((r: any) => r.status === "open") || ev.impacts.length) ? (
          <Card title="Needs attention" icon={TriangleAlertIcon}>
            <ul className="flex flex-col gap-2.5 text-[13px]">
              {pendingApprovals.map((a: any) => <li key={a.id} className="flex gap-2"><ClockIcon className="mt-0.5 size-4 shrink-0 text-pending" /><span><b>{a.id}</b> waiting on {nameOf(s, a.approver)}: {money(a.terms.amount)} · {a.terms.headcount} people · {fmtDate(a.terms.date)}{a.needsCapAtLeast ? ` · needs cap ≥ ${money(a.needsCapAtLeast)}` : ""}</span></li>)}
              {openSugs.map((x: any) => <li key={x.id} className="flex gap-2"><CircleDotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{x.kind === "scenario" ? "Question" : "Suggestion"} {x.id} from {nameOf(s, x.by)}: {Object.entries(x.fields).map(([k, val]: any) => `${k} → ${k === "date" ? fmtDate(val) : val}`).join(", ")} <span className="text-muted-foreground">(not applied)</span></span></li>)}
              {ev.revisionRequests.filter((r: any) => r.status === "open").map((r: any) => <li key={r.id} className="flex gap-2"><NotebookPenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>Revision request from {nameOf(s, r.by)}: "{r.note}" {r.proposalId ? `on ${r.proposalId}` : ""} — not an agreed change</span></li>)}
              {ev.impacts.map((i: any, k: number) => <li key={k} className="flex gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warn" /><span>{i.text} <Pill>{i.basis}</Pill></span></li>)}
              {flags.map((f: any) => <li key={f.id} className="flex items-start gap-2"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" /><span className="flex-1">{f.text}{f.source?.msgId ? <button className="ml-1 text-primary hover:underline" onClick={() => openMessage(f.source.msgId)}>view</button> : null}</span><Button variant="ghost" size="sm" onClick={() => act("resolveFlag", { flagId: f.id })}>Resolve</Button></li>)}
            </ul>
          </Card>
        ) : null}

        <Card title="Supplier offers" icon={BuildingIcon}>
          {ev.proposals.length === 0 ? <p className="text-[13px] text-muted-foreground">No offers yet.</p> : (
            <div className="-m-4 overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="px-4 py-2 font-medium">Offer</th><th className="px-4 py-2 font-medium">Venue</th><th className="px-4 py-2 font-medium">For</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
              <tbody>{[...ev.proposals].reverse().map((p: any) => (
                <tr key={p.id} className={cn("border-t", p.status !== "current" && "text-muted-foreground")}>
                  <td className="px-4 py-2 tabular-nums text-xs">{p.id}{ev.selection?.proposalId === p.id ? <Pill tone="ml-1.5 bg-accent text-accent-foreground">selected</Pill> : null}</td>
                  <td className="px-4 py-2">{s.suppliers[Object.keys(s.suppliers).find((k) => s.suppliers[k].id === p.supplierId)!]?.name}</td>
                  <td className="px-4 py-2">{p.terms.headcount} · {fmtDate(p.terms.date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(p.amount)}{p.includesFee ? <div className="text-[11px] text-muted-foreground">incl. {money(p.includesFee)} fee</div> : null}</td>
                  <td className="px-4 py-2"><Pill tone={p.status === "current" ? "bg-[color-mix(in_oklab,var(--ok)_15%,transparent)] text-ok" : undefined}>{p.status}</Pill></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Supplier requests" icon={MessagesSquareIcon}>
            {ev.supplierRequests.length === 0 ? <p className="text-[13px] text-muted-foreground">None sent.</p> : (
              <ul className="flex flex-col gap-1.5 text-[13px]">{ev.supplierRequests.map((r: any) => (
                <li key={r.id} className="flex items-center gap-2"><span className="tabular-nums text-xs text-muted-foreground">{r.id}</span><span className="flex-1 truncate">{r.type} · {s.suppliers[Object.keys(s.suppliers).find((k) => s.suppliers[k].id === r.supplierId)!]?.name}{r.delegated ? <span className="text-muted-foreground"> · delegated</span> : null}</span><Pill tone={r.status === "confirmed" ? "bg-[color-mix(in_oklab,var(--ok)_15%,transparent)] text-ok" : r.status === "sent" ? "bg-[color-mix(in_oklab,var(--warn)_15%,transparent)] text-warn" : undefined}>{r.status === "sent" ? (r.type === "quote" ? "awaiting reply" : "awaiting confirmation") : r.status}</Pill></li>
              ))}</ul>
            )}
          </Card>
          <Card title="Contract rules" icon={FileTextIcon}>
            {Object.values(ev.contracts).length === 0 ? <p className="text-[13px] text-muted-foreground">No contract yet.</p> : Object.values(ev.contracts).map((c: any) => (
              <div key={c.id} className="text-[13px]">
                <div className="mb-1.5 text-xs text-muted-foreground">{c.title}</div>
                {c.rules.map((r: any) => (
                  <div key={r.ref} className="rounded-lg bg-muted p-2.5">
                    <div className="flex items-center gap-2"><b>§{r.ref}</b> {money(r.amount)} date-change fee if moved &gt; {r.minDaysBeforeArrival} days before arrival {r.reviewed ? <Pill tone="bg-[color-mix(in_oklab,var(--ok)_15%,transparent)] text-ok"><ShieldCheckIcon className="size-3" />reviewed</Pill> : <Pill tone="bg-[color-mix(in_oklab,var(--warn)_15%,transparent)] text-warn">needs review</Pill>}</div>
                    <p className="mt-1 text-xs italic text-muted-foreground">p.{r.page}: "{r.excerpt}"</p>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Next actions" icon={CheckCircle2Icon}>
          <div className="flex flex-col gap-2">
            {!ev.owner ? <Button disabled={!!busy} onClick={() => act("accept")}>Accept ownership</Button> : null}
            {ev.owner && ev.supplierRequests.length === 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border p-2.5">
                <div className="text-xs font-medium">Request quotes from</div>
                {Object.values(s.suppliers).map((x: any) => <label key={x.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))} />{x.name}<span className="text-xs text-muted-foreground">{x.city}</span></label>)}
                <Button disabled={!!busy || !required || picked.length === 0} onClick={() => act("requestQuotes", { supplierIds: picked })}>{required ? "Request quotes" : "Waiting for a date"}</Button>
              </div>
            ) : null}
            {canAuthorize ? <Button disabled={!!busy} onClick={() => act("authorize")}>{v.committed ? "Authorize amendment" : "Authorize booking"} · {money(sel.amount)}</Button> : null}
            {pendingBinding ? <p className="text-xs text-muted-foreground">Waiting for {s.suppliers[Object.keys(s.suppliers).find((k) => s.suppliers[k].id === pendingBinding.supplierId)!]?.name} to confirm {pendingBinding.id}. The commitment changes only when they confirm.</p> : null}
            {unreviewed.map((r: any) => <Button key={r.ref} variant="outline" disabled={!!busy} onClick={() => act("reviewClause", { contractId: r.contractId, ruleRef: r.ref })}>Verify §{r.ref} against the contract</Button>)}
            <Button variant="outline" onClick={() => setManual(!manual)}><NotebookPenIcon className="size-4" />Record an off-email decision</Button>
            {manual ? <ManualDecision s={s} onSubmit={(a: any) => { setManual(false); act("manualDecision", a); }} /> : null}
            <Button variant="ghost" disabled={!!busy || !ev.owner} onClick={() => act(ev.paused ? "resume" : "pause")}>{ev.paused ? <><PlayIcon className="size-4" />Resume ccPlannie</> : <><PauseIcon className="size-4" />Pause ccPlannie on this event</>}</Button>
          </div>
        </Card>
        <Card title="People & authority" icon={UsersIcon}>
          <ul className="flex flex-col gap-2 text-[13px]">
            {Object.entries(s.people).filter(([, p]: any) => !p.alias).map(([a, p]: any) => (
              <li key={a}><div className="font-medium">{p.name} <span className="font-normal text-muted-foreground">· {p.title}</span></div><div className="text-[11px] text-muted-foreground">{p.caps.filter((c: string) => c !== "suggest").join(" · ") || "suggest only"}</div></li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">{s.policy.name}. Authority comes from this configuration, never from titles or CC.</p>
        </Card>
      </div>
    </div>
  );
}

export function DriftNote({ v }: { v: any }) {
  return v.drift.length ? <Pill tone="bg-[color-mix(in_oklab,var(--warn)_15%,transparent)] text-warn">{v.drift.length} difference{v.drift.length > 1 ? "s" : ""}</Pill> : v.committed ? <Pill tone="bg-[color-mix(in_oklab,var(--ok)_15%,transparent)] text-ok">All aligned</Pill> : null;
}

// Working plan, approved terms and supplier commitment side by side. Differences are highlighted;
// a missing column stays "—" (an internal approval never fills the supplier column).
export function PlanTable({ ev, flush }: { ev: any; flush?: boolean }) {
  const v = ev.views;
  const rows: [string, string, (x: any) => string][] = [
    ["Headcount", "headcount", (x) => x ?? "—"], ["Date", "date", fmtDate], ["Nights", "nights", (x) => x ?? "—"], ["Rooms", "rooms", (x) => x ?? "—"],
    ["Venue", "supplier", (x) => x ?? "—"], ["Amount", "amount", (x) => (x == null ? "Not quoted yet" : money(x))], ["Budget cap", "cap", money],
  ];
  return (
<div className={flush ? "overflow-x-auto" : "-m-4 overflow-x-auto"}>
      {/* Same table rules as the rest of the console: tinted header row, 12px headings, hairline rows. */}
      <table className="w-full min-w-[36rem] text-[13px]">
        <thead className="bg-[var(--console-sidebar,var(--muted))] text-left text-[12px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-[18%] py-2.5 pl-4 pr-3 font-medium"><span className="sr-only">Field</span></th>
            <th scope="col" className="px-3 py-2.5 font-medium">Working plan</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Approved{v.approved ? <span className="tabular-nums"> · {v.approved.ref}</span> : null}</th>
            <th scope="col" className="py-2.5 pl-3 pr-4 font-medium">Booked through Planned{v.committed ? <span className="tabular-nums"> · {v.committed.ref}</span> : null}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border border-t border-border">
          {rows.map(([label, key, f]) => {
            const diff = v.drift.includes(key);
            return (
              <tr key={key} className="hover:bg-[var(--console-row-hover,transparent)]">
                <th scope="row" className="py-2.5 pl-4 pr-3 text-left font-normal text-muted-foreground">{label}</th>
                {[v.working, v.approved, v.committed].map((col: any, i: number) => (
                  <td key={i} className={cn("py-2.5 tabular-nums", i === 2 ? "pl-3 pr-4" : "px-3", diff && col && col[key] != null && "font-medium text-[var(--console-attn,var(--warn))]")}>
                    {col ? (key === "cap" && i !== 1 ? (i === 0 && ev.working.budget != null ? <span className="text-muted-foreground">Requested {money(ev.working.budget)}</span> : <span className="text-muted-foreground">—</span>) : f(col[key]) === "—" ? <span className="text-muted-foreground">—</span> : f(col[key])) : <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ManualDecision({ s, onSubmit, defaultDecider }: any) {
  const [decidedBy, setDecidedBy] = useState(defaultDecider || Object.keys(s.people).find((a) => !s.people[a].alias) || "");
  const [note, setNote] = useState("");
  const [headcount, setHeadcount] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2.5 text-[13px]">
      <label className="flex flex-col gap-1">Decided by<select aria-label="Decided by" className="rounded-md border bg-background px-2 py-1" value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)}>{Object.entries(s.people).filter(([, p]: any) => !p.alias).map(([a, p]: any) => <option key={a} value={a}>{p.name}</option>)}</select></label>
      <label className="flex flex-col gap-1">What was decided<input className="rounded-md border bg-background px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="On a call: confirmed 50 people" /></label>
      <label className="flex flex-col gap-1">Headcount change (optional)<input className="rounded-md border bg-background px-2 py-1" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, ""))} /></label>
      <Button size="sm" disabled={!note.trim()} onClick={() => onSubmit({ decidedBy, note, channel: "phone call", fields: headcount ? { headcount: +headcount } : {} })}>Record with provenance</Button>
    </div>
  );
}

export function Conversations({ s, ev, focusMsg }: any) {
  const [active, setActive] = useState<string | null>(null);
  // Venue exchanges are shown as exchanges with Planned, not as email threads.
  const threads = ev.threads.filter((x: any) => x.kind !== "supplier");
  const focusThread = focusMsg ? threads.find((x: any) => x.messages.includes(focusMsg))?.id : null;
  const t = threads.find((x: any) => x.id === (active || focusThread)) || threads[0];
  const byId = useMemo(() => Object.fromEntries(s.messages.map((m: any) => [m.id, m])), [s.messages]);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const visibleFocus = focusMsg && byId[focusMsg] && t?.messages.includes(focusMsg) ? focusMsg : null;
  useLayoutEffect(() => { if (visibleFocus) focusRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); }, [visibleFocus]);
  // Approval threads are per approver; name whoever the thread's messages actually went to.
  const approverOf = (x: any) => { const m = x.messages.map((id: string) => byId[id]).find((m: any) => m && m.direction === "plannie"); return m ? m.to.map((a: string) => nameOf(s, a)).join(", ") : "finance"; };
  const label = (x: any) => x.kind === "internal" ? "Planning thread" : x.kind === "approval" ? `Finance approval · ${approverOf(x)}` : `Supplier: ${Object.values(s.suppliers).find((y: any) => y.id === x.supplierId)?.name}`;
  if (!threads.length) return <p className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">No emails yet.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      {/* Thread picker: same look as the console's side navigation. */}
      <nav aria-label="Email threads" className="flex flex-col gap-1">
        {threads.map((x: any) => (
          <button key={x.id} onClick={() => setActive(x.id)} aria-pressed={t?.id === x.id}
            className={cn("rounded-lg px-3 py-2 text-left text-[13px]", t?.id === x.id ? "bg-[var(--console-selected,var(--accent))] font-medium" : "text-muted-foreground hover:bg-[var(--console-row-hover,var(--muted))] hover:text-foreground")}>
            <div>{label(x)}</div><div className="text-[11px] font-normal text-muted-foreground">{x.messages.length} email{x.messages.length === 1 ? "" : "s"}</div>
          </button>
        ))}
      </nav>
      <div className="min-w-0 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {t.messages.map((id: string) => byId[id]).filter(Boolean).map((m: any) => (
          <div key={m.id} data-msg={m.id} ref={m.id === focusMsg ? focusRef : undefined} className={cn("px-4 [&>article]:border-b-0",
            // ccPlannie's own emails stand out the same way as in the story mailbox: a light blue wash and a blue bar.
            m.direction === "plannie" && "relative bg-m-accent/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-m-accent/70",
            m.id === focusMsg && "bg-[var(--console-selected,var(--accent))]")}>
            <MessageCard s={s} m={m} compact />
            {m.delivery && /failed|held/.test(m.delivery) ? <p className="pb-3 text-[12px] text-destructive">Not delivered ({m.delivery})</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// How each history entry is marked. Planned traffic uses the same arrows and colors as everywhere else
// (blue going to Planned, green coming back); people's decisions use the status colors; the rest is gray.
function historyMark(h: any): { kind: "to" | "from" | "dot"; color: string } {
  const a = h.action || "";
  if (/^(supplier\.|sourcing\.)/.test(a)) return { kind: "to", color: "var(--planned-out)" };
  if (/^(offer\.|commitment\.|contract\.)/.test(a)) return { kind: "from", color: "var(--planned-in)" };
  if (/^approval\.granted/.test(a)) return { kind: "dot", color: "var(--console-ok, var(--m-green))" };
  if (/^approval\.(refused|declined)/.test(a)) return { kind: "dot", color: "var(--console-block, var(--destructive))" };
  if (/^(approval\.blocked|review\.flagged)/.test(a)) return { kind: "dot", color: "var(--console-attn, var(--m-orange))" };
  return { kind: "dot", color: "var(--m-label3)" };
}

export function History({ s, ev, openMessage }: any) {
  if (!ev.history.length) return <p className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {[...ev.history].reverse().map((h: any) => {
        const mk = historyMark(h);
        const Icon = mk.kind === "to" ? ArrowUpRightIcon : ArrowDownLeftIcon;
        return (
          <li key={h.seq} className="flex gap-3 px-4 py-3">
            <span className="flex w-4 shrink-0 justify-center pt-[3px]" style={{ color: mk.color }}>
              {mk.kind === "dot" ? <span aria-hidden className="mt-[3px] size-[7px] rounded-full" style={{ background: mk.color }} /> : <Icon aria-label={mk.kind === "to" ? "To Planned" : "From Planned"} className="size-3.5" strokeWidth={1.7} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
                <span className="text-[13px] font-medium leading-snug">{h.summary}</span>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">{fmtTime(h.at)}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {h.actor === "plannie" ? "ccPlannie" : h.actor === "admin" ? "Administrator" : nameOf(s, h.actor)}{h.via ? ` · via ${h.via}` : ""}{h.source?.page ? ` · contract p.${h.source.page}` : ""}
                {h.source?.msgId ? <> · <button className="text-primary hover:underline" onClick={() => openMessage(h.source.msgId)}>View email</button></> : null}
              </div>
              {h.source?.quote ? <div className="mt-1.5 border-l-2 border-border pl-2.5 text-[12px] italic leading-snug text-muted-foreground">“{h.source.quote}”</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
