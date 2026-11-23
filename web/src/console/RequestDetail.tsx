// One request: original email, the three separate states (working / approved / supplier-confirmed),
// blockers, conversations, history, and the actions the chosen manager may take right now.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, DownloadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkClick, navigate, useLocation } from "@/lib/router";
import { Button } from "@/components/ui/primitives";
import { PlanTable, Conversations, History, ManualDecision } from "@/components/Workspace";
import { aget, apost, ApiError, fmtDate, fmtWhen, money, rid } from "./api";
import { Page, useConsole } from "./ConsoleApp";
import { A, ErrorState, FormGroup, KV, Loading, Modal, Notice, Section, Status, inputCls } from "./ui";
import { needsAttention, toneFor } from "./Requests";
import { describe, plannedState, type Exchange } from "./exchanges";
import { ExchangeList } from "./Planned";

const TABS = [["overview", "Overview"], ["conversations", "Emails"], ["history", "History"], ["details", "Details"]] as const;
const ACTOR_KEY = "ccplannie.console.actor";
const readActor = () => { try { return sessionStorage.getItem(ACTOR_KEY); } catch { return null; } };
const writeActor = (v: string) => { try { sessionStorage.setItem(ACTOR_KEY, v); } catch { /* per-tab convenience only */ } };

export function RequestDetail({ id, onActorChange }: { id: string; onActorChange?: (id: string, name: string | null) => void }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = TABS.find(([key]) => key === params.get("tab"))?.[0] || "overview";
  const focusMsg = params.get("msg");
  const { session, toast } = useConsole();
  const [chosen, setChosen] = useState<string | null>(readActor);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const pendingLoad = useRef(0);
  // The demo's step widget switches whose view the page acts as.
  useEffect(() => { const on = (e: Event) => setChosen((e as CustomEvent).detail); window.addEventListener("console:actor", on); return () => window.removeEventListener("console:actor", on); }, []);
  const [actionsOpen, setActionsOpen] = useState(false);

  const ev = d?.event;
  // The acting identity is explicit. Default: whoever the request is routed to or owned by.
  const managers = session.identities.filter((p) => p.caps.includes("event.own") || p.email === ev?.owner || p.email === ev?.routedTo);
  const defaultActor = managers.find((p) => p.email === ev?.owner)?.email || managers.find((p) => p.email === ev?.routedTo)?.email || managers[0]?.email || "";
  const actor = chosen && managers.some((p) => p.email === chosen) ? chosen : defaultActor;
  const actorName = d?.people[actor]?.name || managers.find((p) => p.email === actor)?.name || actor;
  const visibleActor = ev && error?.status !== 404 ? actorName : null;
  useEffect(() => {
    onActorChange?.(id, visibleActor);
  }, [id, onActorChange, visibleActor]);
  useEffect(() => () => onActorChange?.(id, null), [id, onActorChange]);

  const load = useCallback(async (as = actor) => {
    const request = ++pendingLoad.current;
    try {
      const next = await aget(`/api/admin/requests/${encodeURIComponent(id)}${as ? `?as=${encodeURIComponent(as)}` : ""}`);
      if (request !== pendingLoad.current) return;
      setD(next);
      setError(null);
    } catch (e: any) {
      if (request === pendingLoad.current) setError({ message: e.message, status: e.status });
    }
  }, [id, actor]);
  const demoStep = session.demo?.step;
  const demoScenario = session.demo?.scenario.id;
  useEffect(() => {
    load();
    const t = window.setInterval(() => load(), 2500);
    return () => { window.clearInterval(t); pendingLoad.current++; };
  }, [load, demoStep, demoScenario]);

  const tabUrl = (t: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...(t !== "overview" ? { tab: t } : {}), ...extra });
    return `/admin/requests/${encodeURIComponent(id)}${p.size ? `?${p}` : ""}`;
  };
  const openMessage = (msgId: string) => navigate(tabUrl("conversations", { msg: msgId }));

  // Every mutation carries the version the page loaded and a request id (a retried click is a no-op).
  const run = async (label: string, path: string, body: any, ok: string) => {
    setBusy(label); setConflict(null);
    try { await apost(path, { ...body, expectedVersion: ev.version, requestId: rid() }); toast(ok); await load(); return true; }
    catch (e: any) {
      if (e instanceof ApiError && e.status === 409) { setConflict(e.message); await load(); }
      else toast(e.message, "error");
      return false;
    } finally { setBusy(null); }
  };
  const act = (action: string, args: any = {}, ok = "Done.") => run(action, `/api/admin/requests/${id}/action`, { actor, action, args }, ok);

  if (error?.status === 404) return <Page><BackLink /><ErrorState error="This request is no longer available. Return to Requests to see the current list." /></Page>;
  if (error && !d) return <Page><BackLink /><ErrorState error={error.message} retry={() => load()} /></Page>;
  if (!d) return <Page><BackLink /><Loading /></Page>;

  // Venue traffic is an exchange with Planned, shown in its own section, never as email.
  const isVenueMail = (m: any) => m.direction === "supplier" || m.meta?.kind === "supplier-request";
  const s = { messages: d.messages.filter((m: any) => !isVenueMail(m)), people: d.people, suppliers: d.suppliers, plannie: d.plannie };
  const sum = d.summary;

  // The one thing to do now, offered right next to the "Next step" text when the acting person can do it.
  const PRIMARY_SKIP = new Set(["pause", "resume", "manualDecision", "requestQuotes", "none"]);
  const primary = d.actions.find((a: any) => a.allowed && !PRIMARY_SKIP.has(a.action)) || null;
  const nextTone = needsAttention(sum) ? (toneFor(sum) === "block" ? "block" : "attn") : toneFor(sum);
  const m = sum.money;
  const venue = ev.commitment ? supName(d, ev.commitment.supplierId) : ev.selection ? supName(d, ev.proposals.find((p: any) => p.id === ev.selection.proposalId)?.supplierId) : null;
  // Tiles show the current plan. When the booking differs (a change in progress), the small line says what's booked.
  const v = ev.views || {};
  const booked = v.committed;
  const planAmount = v.working?.amount ?? null;
  const facts: [string, string, string?][] = [
    ["Date", sum.date ? fmtDate(sum.date) : "Not set", booked && booked.date !== sum.date ? `Booked for ${fmtDate(booked.date)}` : ev.working?.nights ? `${ev.working.nights} night${ev.working.nights > 1 ? "s" : ""}` : undefined],
    ["People", sum.headcount ? String(sum.headcount) : "Not set", booked && booked.headcount !== sum.headcount ? `Booked for ${booked.headcount}` : undefined],
    ["Venue", venue || "Not chosen", ev.commitment ? "Booked" : venue ? "Chosen, not booked" : undefined],
    ["Amount", planAmount != null ? money(planAmount) : m.confirmed ? money(m.confirmed.amount) : m.approved ? money(m.approved.amount) : m.requested != null ? money(m.requested) : "No budget",
      booked && planAmount != null && booked.amount !== planAmount ? `Booked at ${money(booked.amount)}` : m.confirmed ? "Booked" : m.approved ? `Approved · ${m.approved.ref}` : planAmount != null ? "Quoted, not approved" : m.requested != null ? "Requested budget" : undefined],
    ["Owner", ev.owner ? d.people[ev.owner]?.name || ev.owner : ev.routedTo ? d.people[ev.routedTo]?.name || ev.routedTo : "Nobody", ev.owner ? "Event manager" : ev.routedTo ? "Not accepted yet" : "Needs routing"],
  ];

  return (
    <Page>
      <BackLink />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 className="break-words text-[26px] font-semibold leading-tight tracking-[-0.025em]">{ev.title}</h1><span className="tabular text-[13px] text-muted-foreground">{ev.id}</span></div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <Status tone={toneFor(sum)} className="text-foreground">{sum.stage.label}</Status>
            <span>Requested by {sum.requesterName} · {fmtWhen(sum.receivedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actor && session.mode !== "demo" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground" title="Actions on this page are taken as this person">Viewing as <span className="font-medium text-foreground">{actorName}</span></span> : null}
          <Button variant="outline" onClick={() => setActionsOpen(true)}>Actions</Button>
        </div>
      </header>

      {conflict ? <Notice tone="attn" role="alert">{conflict} <span className="text-muted-foreground">The page now shows the latest version; check it before trying again.</span></Notice> : null}
      {error ? <Notice tone="attn" role="alert">Couldn’t refresh this request. <button className="text-primary underline" onClick={() => load()}>Try again</button></Notice> : null}

      {/* Next step, with the action that does it. */}
      <div className={cn("flex min-h-[4.75rem] flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3.5", nextTone === "attn" ? "border-[color-mix(in_oklab,var(--console-attn)_40%,var(--border))]" : nextTone === "block" ? "border-[color-mix(in_oklab,var(--console-block)_40%,var(--border))]" : "border-border")}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Status tone={nextTone} className="text-[12px] leading-none">Next step</Status>
          <p className="text-[15px] font-medium leading-snug">{sum.next.text}</p>
        </div>
        {primary ? <Button disabled={!!busy} onClick={() => act(primary.action, primary.args || {}, "Done.")}>{primary.label}</Button> : null}
      </div>

      {/* Key facts at a glance. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map(([k, v, note]) => (
          <div key={k} id={k === "Owner" ? "request-owner" : undefined} className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className="tabular mt-0.5 text-[14px] font-medium leading-snug">{v}</dd>
            {note ? <dd className="text-[11px] text-muted-foreground">{note}</dd> : null}
          </div>
        ))}
      </dl>

      {/* A full-width tab bar: everything above is the summary, everything below is the chosen section. */}
      <nav aria-label="Request sections" className="mt-4 flex flex-wrap gap-1 border-b border-border pb-3">
        {TABS.map(([k, label]) => <a key={k} href={tabUrl(k)} onClick={linkClick(tabUrl(k))} aria-current={tab === k ? "page" : undefined}
          className={cn("rounded-full px-3 py-1.5 text-[13px] no-underline hover:no-underline", tab === k ? "bg-[var(--console-selected)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground")}>{label}</a>)}
      </nav>

      {tab === "conversations" ? <Conversations key={focusMsg ?? "emails"} s={s} ev={ev} focusMsg={focusMsg} />
        : tab === "history" ? <History s={s} ev={ev} openMessage={openMessage} />
        : (
          tab === "details" ? (
            <div className="flex flex-col gap-8">
              <Section title="Plan, approval and booking">
                <div className="overflow-hidden rounded-xl border border-border bg-card"><PlanTable ev={ev} flush /></div>
              </Section>
              {d.original ? (
                <Section title="Original email" aside={<button className="text-primary hover:underline" onClick={() => openMessage(d.original.id)}>Open in Emails</button>}>
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="text-[12px] text-muted-foreground">{d.people[d.original.from]?.name || d.original.from} · {fmtWhen(d.original.at)} · “{d.original.subject}”</div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{d.original.body}</p>
                  </div>
                </Section>
              ) : null}
              <a id="request-export" href={`/api/admin/requests/${ev.id}/export`} download className="inline-flex w-fit items-center gap-1.5 text-[13px] text-primary hover:underline"><DownloadIcon className="size-3.5" strokeWidth={1.6} aria-hidden />Download the full record (JSON)</a>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              <OpenItems d={d} s={s} openMessage={openMessage} busy={busy} actor={actor} act={act} retry={(o: string) => run("retry", `/api/admin/outbox/${o}/retry`, {}, "Delivery retried.")} />
              {!ev.commitment ? <Offers d={d} /> : null}
              <PlannedSection ex={d.planned || []} />
            </div>
          )
        )}

      <Modal open={actionsOpen} onClose={() => setActionsOpen(false)} title="Actions" description="Everything you can do on this request, recorded in its history.">
        <div className="flex flex-col gap-6">
          <FormGroup title="As the event manager">
            {managers.length ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="actor" className="text-[12px] text-muted-foreground">Acting as</label>
                <select id="actor" className={inputCls} value={actor} onChange={(e) => { setChosen(e.target.value); writeActor(e.target.value); load(e.target.value); }}>
                  {managers.map((p) => <option key={p.email} value={p.email}>{p.name}{p.caps.includes("event.own") ? " · event manager" : ""}</option>)}
                </select>
              </div>
            ) : <p className="text-[12px] text-muted-foreground"><A to="/admin/people">Set up an event manager</A> first.</p>}
            <Actions d={d} actorName={actorName} busy={busy} act={async (...x: [string, any?, string?]) => { const ok = await act(...x); if (ok) setActionsOpen(false); return ok; }} s={s} />
          </FormGroup>
          <FormGroup title="As the administrator"><Routing d={d} busy={busy} run={run} /></FormGroup>
        </div>
      </Modal>
    </Page>
  );
}

const supName = (d: any, id: string | null | undefined) => (id ? ((Object.values(d.suppliers) as any[]).find((x) => x.id === id)?.name || id) : null);

const BackLink = () => <A to="/admin/requests" className="-mb-2 inline-flex w-fit items-center gap-1 text-[13px] text-muted-foreground no-underline hover:text-foreground hover:no-underline"><ChevronLeftIcon className="size-3.5" aria-hidden />Requests</A>;

function OpenItems({ d, s, openMessage, busy, actor, act, retry }: any) {
  const ev = d.event;
  const pending = ev.approvals.filter((a: any) => a.status === "pending");
  const flags = ev.reviewQueue.filter((f: any) => f.open);
  const sugs = ev.suggestions.filter((x: any) => x.status === "open");
  const isOwner = ev.owner && (ev.owner === actor);
  const sentReqs = ev.supplierRequests.filter((r: any) => r.status === "sent" || r.status === "queued");
  const empty = !pending.length && !flags.length && !sugs.length && !d.staleQuotes.length && !d.unknowns.length && !d.deliveryFailures.length && !sentReqs.length && !ev.paused;
  const name = (e: string) => d.people[e]?.name || e;
  return (
    empty ? null : <Section id="open-items" title="Open items">
      {(
        <ul className="flex flex-col gap-2">
          {ev.paused ? <li><Notice>{ev.pausedBy === "rules" ? "Paused by a company rule" : `Paused${ev.pausedBy ? ` by ${name(ev.pausedBy)}` : ""}`}. ccPlannie sends nothing on this request until it's resumed.</Notice></li> : null}
          {pending.map((a: any) => (
            <li key={a.id}>
              <Notice tone={a.blocker ? "block" : "attn"}>
                <div><span className="font-medium">{a.id}</span> · {money(a.terms.amount)} · {a.terms.headcount} people · {fmtDate(a.terms.date)}</div>
                <div className="text-muted-foreground">Assigned to {a.approver ? name(a.approver) : "nobody"}{a.reassignments?.length ? ` (reassigned from ${name(a.reassignments.at(-1).from)})` : ""}. {a.blocker ? <span className="text-foreground">{a.blocker.text}</span> : `Waiting for ${name(a.approver).split(" ")[0]}'s approval.`}</div>
                {a.blocker ? <AssignApprover d={d} a={a} /> : null}
              </Notice>
            </li>
          ))}
          {d.deliveryFailures.map((f: any) => (
            <li key={f.outboxId}><Notice tone="block">
              <div>Not delivered to {f.to.join(", ")}: “{f.subject}”</div>
              <div className="text-muted-foreground">{f.status}{f.error ? `: ${f.error}` : ""} · {f.attempts} attempt{f.attempts === 1 ? "" : "s"}</div>
              <button className="mt-1 text-primary hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => retry(f.outboxId)}>Retry delivery</button>
            </Notice></li>
          ))}
          {flags.map((f: any) => (
            <li key={f.id}><Notice tone="block">
              <div>{f.text}</div>
              <div className="flex flex-wrap gap-3 text-[12px]">
                {f.source?.msgId ? <button className="text-primary hover:underline" onClick={() => openMessage(f.source.msgId)}>View source email</button> : null}
                {isOwner ? <button className="text-primary hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => act("resolveFlag", { flagId: f.id }, "Marked as reviewed.")}>Mark reviewed</button> : <span className="text-muted-foreground">Only the owner can mark this reviewed.</span>}
              </div>
            </Notice></li>
          ))}
          {sugs.map((x: any) => (
            <li key={x.id}><Notice>
              {x.kind === "scenario" ? "Question" : "Suggestion"} from {name(x.by)}: {Object.entries(x.fields).map(([k, v]: any) => `${k} ${k === "date" ? fmtDate(v) : v}`).join(", ")} <span className="text-muted-foreground">· not applied</span>
              {x.msgId ? <> · <button className="text-primary hover:underline" onClick={() => openMessage(x.msgId)}>source</button></> : null}
            </Notice></li>
          ))}
          {sentReqs.map((r: any) => (
            <li key={r.id}><Notice tone="info">
              {r.type === "quote" ? "Waiting for Planned's offer from" : "Waiting for Planned to confirm with"} {Object.values(d.suppliers).find((x: any) => x.id === r.supplierId)?.name as string} <span className="text-muted-foreground">({r.id}, {r.delegated ? "automatic follow-up" : r.type === "quote" ? "requested by the manager" : `${r.type} sent`}, {fmtWhen(r.sentAt || r.at)}; flagged after {d.policy.supplierTimeoutHours}h without an answer)</span>
            </Notice></li>
          ))}
          {d.staleQuotes.map((p: any) => (
            <li key={p.id}><Notice>Stale quote {p.id} from {p.supplier}: {money(p.amount)} for {p.headcount} people on {fmtDate(p.date)}. It no longer matches the plan and can't be selected or approved.</Notice></li>
          ))}
          {d.unknowns.map((u: any, i: number) => (
            <li key={i}><Notice tone="attn">{u.text} <span className="text-muted-foreground">({u.basis})</span></Notice></li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AssignApprover({ d, a }: any) {
  const { toast } = useConsole();
  const eligible = d.approvers.filter((x: any) => x.limit != null && x.limit >= a.terms.amount && x.email !== a.approver);
  const [to, setTo] = useState(eligible[0]?.email || "");
  const [busy, setBusy] = useState(false);
  if (!eligible.length) return <p className="mt-1 text-[12px] text-muted-foreground">No other finance approver has a limit that covers {money(a.terms.amount)}. <A to="/admin/people">Manage approvers and limits</A></p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`as-${a.id}`}>Assign {a.id} to</label>
      <select id={`as-${a.id}`} className={cn(inputCls, "w-auto")} value={to} onChange={(e) => setTo(e.target.value)}>
        {eligible.map((x: any) => <option key={x.email} value={x.email}>{x.name} (up to {money(x.limit)})</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={busy || !to} onClick={async () => {
        setBusy(true);
        try { await apost(`/api/admin/requests/${d.event.id}/approvals/${a.id}/assign`, { approver: to, expectedVersion: d.event.version, requestId: rid() }); toast(`${a.id} assigned. The approval request was emailed with a new code.`); }
        catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
      }}>Assign approver</Button>
      <span className="basis-full text-[12px] text-muted-foreground">Administrator action. Recorded in the request history and company activity.</span>
    </div>
  );
}

function Actions({ d, actorName, busy, act, s, skip }: any) {
  const ev = d.event;
  const allowed = d.actions.filter((a: any) => a.allowed && a.action !== skip);
  const blocked = d.actions.filter((a: any) => !a.allowed);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [manual, setManual] = useState(false);
  const quotes = d.actions.find((a: any) => a.action === "requestQuotes");
  const sup = useMemo(() => Object.values(d.suppliers) as any[], [d.suppliers]);
  // Default: venues not already known to be too small for the current headcount.
  const fits = (sid: string) => { const c = ev.supplierFacts?.[sid]?.capacity; return !(c && ev.working.headcount && ev.working.headcount > c); };
  const chosen = picked ?? (quotes?.suppliers || []).filter(fits);
  const firstRound = ev.supplierRequests.length === 0;
  return (
    <div>
      {allowed.length === 0 ? <p className="text-[13px] text-muted-foreground">{skip ? "Nothing else to do right now." : actorName ? `Nothing ${actorName.split(" ")[0]} can do here right now.` : "Assign an event manager before taking action."}</p> : (
        <div className="flex flex-col gap-2">
          {allowed.map((a: any) => a.action === "requestQuotes" ? (
            <div key={a.action} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
              {!ev.commitment ? <fieldset className="flex flex-col gap-1"><legend className="mb-1 text-[12px] font-medium">Ask Planned for non-binding offers from</legend>
                {sup.map((x) => <label key={x.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-[var(--console-row-hover)]"><input type="checkbox" className="mt-0.5" checked={chosen.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...chosen, x.id] : chosen.filter((p: string) => p !== x.id))} /><span className="min-w-0 leading-snug">{x.name}<span className={cn("block text-[11px]", fits(x.id) ? "text-muted-foreground" : "text-[var(--console-attn)]")}>{fits(x.id) ? x.city : `Holds at most ${ev.supplierFacts[x.id].capacity}`}</span></span></label>)}
              </fieldset> : null}
              <Button size="sm" className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left leading-snug" variant={firstRound || (d.staleQuotes.length && !ev.proposals.some((x: any) => x.status === "current")) ? "default" : "outline"} disabled={!!busy || !chosen.length} onClick={() => act("requestQuotes", { supplierIds: chosen }, "Sample quote request recorded.")}>{a.label}</Button>
            </div>
          ) : a.action === "manualDecision" ? (
            <div key={a.action}>
              <Button size="sm" variant="outline" className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left leading-snug" onClick={() => setManual(!manual)} aria-expanded={manual}>{a.label}</Button>
              {manual ? <div className="mt-2"><ManualDecision s={s} defaultDecider={ev.requestedBy} onSubmit={async (args: any) => { if (!busy && await act("manualDecision", args, "Decision recorded.")) setManual(false); }} /></div> : null}
            </div>
          ) : (
            <Button key={a.action + (a.args?.ruleRef || "")} size="sm" className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left leading-snug" variant={a.action === "authorize" || a.action === "accept" ? "default" : "outline"} disabled={!!busy} onClick={() => act(a.action, a.args || {}, a.action === "authorize" ? "Authorization recorded. Waiting for a sample confirmation." : a.action === "accept" ? "Ownership accepted." : "Done.")}>{a.label}</Button>
          ))}
        </div>
      )}
      {blocked.length ? (
        <details className="mt-3 border-t border-border pt-2 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Why some actions aren't available ({blocked.length})</summary>
          <ul className="mt-1.5 flex flex-col gap-1">{blocked.map((a: any, i: number) => <li key={i}><span className="text-foreground">{a.label}</span>: {a.reason}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function Routing({ d, busy, run }: any) {
  const ev = d.event;
  const current = ev.owner || ev.routedTo;
  const options = d.managers.filter((m: any) => m.email !== current);
  const [to, setTo] = useState<string>("");
  const target = options.some((m: any) => m.email === to) ? to : options[0]?.email || "";
  return (
    <div>
      <KV rows={[
        ["Routed to", ev.routedTo ? d.people[ev.routedTo]?.name || ev.routedTo : "—"],
        ["Owner", ev.owner ? `${d.people[ev.owner]?.name || ev.owner} · accepted ${fmtWhen(ev.ownerAcceptedAt)}` : "Not accepted"],
        ...(ev.ownerHistory?.length ? [["Earlier owners", ev.ownerHistory.map((h: any) => d.people[h.owner]?.name || h.owner).join(", ")] as [string, string]] : []),
      ]} />
      {options.length ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="route-to" className="text-[12px] font-medium">{ev.owner ? "Reassign to" : "Route to"}</label>
          <select id="route-to" className={inputCls} value={target} onChange={(e) => setTo(e.target.value)}>
            {options.map((m: any) => <option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!!busy || !target} onClick={() => run("route", `/api/admin/requests/${ev.id}/route`, { manager: target }, ev.owner ? "Reassigned. The new manager must accept ownership." : "Routed. The manager must accept ownership.")}>{ev.owner ? "Reassign request" : "Route request"}</Button>
          <p className="text-[12px] leading-snug text-muted-foreground">The new manager must accept before they can act.</p>
        </div>
      ) : <p className="mt-2 text-[12px] text-muted-foreground">No other event manager is available. <A to="/admin/people">Manage event managers</A></p>}
    </div>
  );
}

function Offers({ d }: any) {
  const ev = d.event;
  if (!ev.proposals.length) return null;
  const sup = (id: string) => (Object.values(d.suppliers) as any[]).find((x) => x.id === id)?.name || id;
  return (
    <Section title="Offers">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[30rem] text-[13px]">
          <thead className="bg-[var(--console-sidebar)]"><tr className="text-left text-[12px] text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium">Offer</th><th scope="col" className="px-3 py-2 font-medium">Venue</th><th scope="col" className="px-3 py-2 font-medium">For</th><th scope="col" className="px-3 py-2 text-right font-medium">Amount</th><th scope="col" className="px-3 py-2 font-medium">Status</th></tr></thead>
          <tbody>{[...ev.proposals].reverse().map((p: any) => (
            <tr key={p.id} className={cn("border-t border-border", p.status !== "current" && "text-muted-foreground")}>
              <td className="tabular px-3 py-2">{p.id}{ev.selection?.proposalId === p.id ? <span className="ml-1.5 text-[12px] text-muted-foreground">· chosen</span> : null}</td>
              <td className="px-3 py-2">{sup(p.supplierId)}</td>
              <td className="px-3 py-2">{p.terms.headcount} · {fmtDate(p.terms.date)}</td>
              <td className="tabular px-3 py-2 text-right">{p.amount == null ? "Price unknown" : money(p.amount)}{p.includesFee ? <div className="text-[11px] text-muted-foreground">incl. {money(p.includesFee)} fee</div> : null}</td>
              <td className="px-3 py-2">{p.status}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Section>
  );
}

function PlannedSection({ ex }: { ex: Exchange[] }) {
  return (
    <Section id="planned" title="With Planned" aside={plannedState(ex)}>
      {ex.length ? <ExchangeList lines={describe(ex)} compact /> : <p className="text-[13px] text-muted-foreground">Venue activity appears once the event manager requests options.</p>}
    </Section>
  );
}
