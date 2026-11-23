// Requests: the operational inbox. Real persisted requests; every status here is derived on the server.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigate, useLocation, linkClick } from "@/lib/router";
import { aget, apost, fmtDate, fmtWhen, money, type Inbox, type Summary } from "./api";
import { Page, useConsole } from "./ConsoleApp";
import { Button } from "@/components/ui/primitives";
import { stageTone } from "@/lib/status";
import { A, Empty, ErrorState, Loading, PageHeader, Section, Status, inputCls, type Tone } from "./ui";

const blocked = (s: Summary) => s.blockers.some((b) => /revoked|removed|over_limit|no_manager|no_approver|delivery_failed|flags/.test(b.code));
// The status dot says where the request is (see lib/status.ts); red overrides it when something is broken.
export const toneFor = (s: Summary): Tone => (blocked(s) ? "block" : stageTone(s.stage.code));
// Separately: does a person need to act? (A confirmed booking can still have a clause to verify.)
export const needsAttention = (s: Summary) => blocked(s) || s.filters.includes("needs_manager") || s.filters.includes("waiting_finance") || s.filters.includes("needs_review");

// Filters computed here on top of the server's: what needs a human, and what's still open.
const VIRTUAL: Record<string, (i: Summary) => boolean> = {
  attention: needsAttention,
  active: (i) => !i.filters.includes("confirmed"),
};

export function Requests() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const requestedFilter = params.get("filter") || "all";
  const [q, setQ] = useState(params.get("q") || "");
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const { toast, session } = useConsole();
  const filter = requestedFilter in VIRTUAL || data?.filters.some(([value]) => value === requestedFilter) ? requestedFilter : "all";

  const pendingLoad = useRef(0);
  const load = useCallback(async () => {
    const request = ++pendingLoad.current;
    try {
      const next = await aget("/api/admin/requests");
      if (request === pendingLoad.current) { setData(next); setError(null); }
    } catch (e: any) {
      if (request === pendingLoad.current) setError(e.message);
    }
  }, []);
  const demoStep = session.demo?.step;
  const demoScenario = session.demo?.scenario.id;
  useEffect(() => {
    load();
    const t = window.setInterval(load, 2500);
    return () => { window.clearInterval(t); pendingLoad.current++; };
  }, [load, demoStep, demoScenario]);
  useEffect(() => { setQ(new URLSearchParams(search).get("q") || ""); }, [search]);

  const setParam = (k: string, v: string, replace = false) => {
    const p = new URLSearchParams(location.search);
    if (v && (k !== "filter" || v !== "all")) p.set(k, v); else p.delete(k);
    navigate(`/admin/requests${p.toString() ? `?${p}` : ""}`, { replace });
  };

  const items = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.items.filter((i) => (filter === "all" || (VIRTUAL[filter] ? VIRTUAL[filter](i) : i.filters.includes(filter))) && (!needle || i.search.includes(needle) || i.requesterName.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  const reprocess = async (msgId: string) => {
    setProcessing(msgId);
    try {
      const r = await apost(`/api/admin/intake/${msgId}/reprocess`);
      toast(r.eventId ? "Request opened from held email." : "Email reviewed again. It hasn’t opened a request.");
      if (r.eventId) navigate(`/admin/requests/${encodeURIComponent(r.eventId)}`);
      else await load();
    }
    catch (e: any) { toast(e.message, "error"); }
    finally { setProcessing(null); }
  };

  const count = (f: (i: Summary) => boolean) => (data ? data.items.filter(f).length : 0);
  const tiles: { key: string; label: string; n: number; hint: string; tone: Tone; onClick: () => void }[] = data ? [
    { key: "attention", label: "Needs attention", n: count(VIRTUAL.attention), hint: "Blocked or waiting on a decision", tone: "attn", onClick: () => setParam("filter", "attention") },
    { key: "active", label: "In progress", n: count(VIRTUAL.active), hint: "Open and not yet booked", tone: "info", onClick: () => setParam("filter", "active") },
    { key: "confirmed", label: "Confirmed", n: data.counts.confirmed || 0, hint: "Booked through Planned", tone: "ok", onClick: () => setParam("filter", "confirmed") },
    { key: "held", label: "Held email", n: data.intake.length, hint: "Waiting for administrator review", tone: data.intake.length ? "attn" : "neutral", onClick: () => document.getElementById("held-mail")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
  ] : [];
  const tabs: [string, string][] = data ? [["all", "All"], ["attention", "Needs attention"], ["active", "In progress"], ...data.filters.filter(([k]) => k !== "all" && (data.counts[k] > 0 || k === filter)).map(([k, l]) => [k, k === "waiting_supplier" ? "Waiting on Planned" : l] as [string, string])] : [];
  const tabCount = (k: string) => (k === "all" ? data!.items.length : VIRTUAL[k] ? count(VIRTUAL[k]) : data!.counts[k] || 0);

  return (
    <Page>
      <PageHeader title="Requests" />
      {error && !data ? <ErrorState error={error} retry={load} /> : !data ? <Loading /> : (
        <>
          {/* Overview: each tile is also a filter. */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Overview">
            {tiles.map((t) => (
              <button key={t.key} onClick={t.onClick} aria-pressed={filter === t.key}
                className={cn("flex flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:border-[color-mix(in_oklab,var(--primary)_40%,var(--border))]", filter === t.key ? "border-[color-mix(in_oklab,var(--primary)_55%,var(--border))] bg-[var(--console-selected)]" : "border-border")}>
                <Status tone={t.n ? t.tone : "neutral"} className="text-[12px]">{t.label}</Status>
                <span className="tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">{t.n}</span>
                <span className="text-[12px] text-muted-foreground">{t.hint}</span>
              </button>
            ))}
          </div>

          <Section title="All requests" aside={items.length !== data.items.length ? `${items.length} of ${data.items.length} shown` : undefined}>
            {/* Filters and search on one row. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Filter requests" className="flex flex-wrap gap-1">
                {tabs.map(([k, label]) => (
                  <button key={k} aria-pressed={filter === k} onClick={() => setParam("filter", k)}
                    className={cn("shrink-0 rounded-full px-2.5 py-1 text-[13px]", filter === k ? "bg-[var(--console-selected)] font-medium" : "text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground")}>
                    {label} <span className="tabular text-muted-foreground">{tabCount(k)}</span>
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-72">
                <SearchIcon aria-hidden className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" strokeWidth={1.6} />
                <input type="search" aria-label="Search requests" placeholder="Search event, person or E-number" value={q}
                  onChange={(e) => { setQ(e.target.value); setParam("q", e.target.value, true); }} className={cn(inputCls, "pl-8 placeholder:text-muted-foreground")} />
              </div>
            </div>
            {error ? <p role="alert" className="mb-2 text-[12px] text-destructive">Couldn't refresh: {error}. Showing the last loaded list.</p> : null}

            {data.items.length === 0 ? (
              <Empty title="No requests yet">{session.identities.length ? <>Requests appear when someone with permission emails ccPlannie. <A to="/admin/connections">Check email setup</A></> : <>Add people and assign roles before the company starts sending requests. <A to="/admin/people">Set up people</A></>}</Empty>
            ) : items.length === 0 ? (
              <Empty title="No matching requests">{q ? <>Nothing matches “{q}”{filter !== "all" ? " in this filter" : ""}. </> : "No requests in this filter. "}<button className="text-primary hover:underline" onClick={() => { setQ(""); navigate("/admin/requests"); }}>Show all requests</button></Empty>
            ) : (
              <div className="@container overflow-hidden rounded-xl border border-border bg-card">
                  <table role="table" className="block w-full table-fixed text-[13px] leading-5 @min-[52rem]:table">
                    <thead role="rowgroup" className="sr-only bg-[var(--console-sidebar)] text-left text-[12px] text-muted-foreground @min-[52rem]:not-sr-only @min-[52rem]:table-header-group">
                      <tr>
                        <th scope="col" className="w-[23%] py-2.5 pl-4 pr-3 font-medium">Request</th>
                        <th scope="col" className="w-[14%] px-3 py-2.5 font-medium">Status</th>
                        <th scope="col" className="w-[14%] px-3 py-2.5 font-medium">Owner</th>
                        <th scope="col" className="w-[15%] px-3 py-2.5 text-right font-medium">Amount</th>
                        <th scope="col" className="py-2.5 pl-3 pr-4 font-medium">Next step</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup" className="block divide-y divide-border @min-[52rem]:table-row-group @min-[52rem]:border-t @min-[52rem]:border-border">
                      {items.map((i) => <RequestRow key={i.id} i={i} />)}
                    </tbody>
                  </table>
              </div>
            )}
          </Section>

          {data.intake.length ? (
            <Section id="held-mail" title={`Held email (${data.intake.length})`}>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {data.intake.map((m) => (
                  <li key={m.msgId} id={`held-${m.msgId}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]"><span className="font-medium">{m.subject || "(no subject)"}</span><span className="text-[12px] text-muted-foreground">{m.from} · {fmtWhen(m.at)}</span></div>
                      <Status tone={m.kind === "unknown_sender" ? "attn" : "neutral"}>{heldReason(m, session.identities)}</Status>
                      {m.preview ? <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">“{m.preview}”</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.canReprocess ? <Button size="sm" disabled={processing !== null} onClick={() => reprocess(m.msgId)}>{processing === m.msgId ? "Processing…" : "Open as request"}</Button>
                        : m.reprocessed ? <span className="text-[12px] text-muted-foreground">Reprocessed</span>
                        : m.kind === "unknown_sender" ? (() => {
                          const known = session.identities.some((p) => p.email === m.from);
                          const to = `/admin/people?${new URLSearchParams({ [known ? "edit" : "add"]: m.from, held: m.msgId, subject: m.subject || "" })}`;
                          return <Button size="sm" variant="outline" nativeButton={false} render={<a href={to} onClick={linkClick(to)} />}>{known ? "Change their role" : "Add to People"}</Button>;
                        })() : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </Page>
  );
}

// Why an email was held, in plain words. A person in the directory without request rights is not a stranger.
function heldReason(m: { kind: string; reason: string; from: string }, identities: { email: string; name: string }[]) {
  if (m.kind === "unknown_sender") {
    const who = identities.find((p) => p.email === m.from);
    return who ? `${who.name} is in the directory, but their role can't start requests` : "Not in the company directory: no authority, no reply";
  }
  if (m.kind === "ambiguous") return "Couldn't tell which request this belongs to; asked the sender";
  return m.reason;
}

function RequestRow({ i }: { i: Summary }) {
  const to = `/admin/requests/${i.id}`;
  const tone = toneFor(i);
  const m = i.money;
  const [amount, amountNote] = m.confirmed ? [money(m.confirmed.amount), "booked"] : m.approved ? [money(m.approved.amount), "approved"] : m.requested != null ? [money(m.requested), "requested"] : ["—", "no budget"];
  return (
    <tr role="row" className="grid cursor-pointer grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 align-top hover:bg-[var(--console-row-hover)] @min-[52rem]:table-row @min-[52rem]:p-0" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(to); }}>
      <td role="cell" className="col-span-2 min-w-0 wrap-anywhere @min-[52rem]:py-3 @min-[52rem]:pl-4 @min-[52rem]:pr-3">
        <a href={to} onClick={linkClick(to)} className="font-medium hover:underline">{i.title}</a> <span className="tabular whitespace-nowrap text-[12px] text-muted-foreground">{i.id}</span>
        <div className="text-[12px] text-muted-foreground">{[i.date ? fmtDate(i.date) : "Date not set", i.headcount ? `${i.headcount} people` : null].filter(Boolean).join(" · ")}</div>
        <div className="text-[12px] text-muted-foreground">From {i.requesterName}</div>
      </td>
      <td role="cell" className="col-span-2 @min-[52rem]:px-3 @min-[52rem]:py-3"><Status tone={tone} className="items-start text-[13px] text-foreground [&>span]:mt-1.5">{i.stage.label}</Status></td>
      <td role="cell" className="min-w-0 wrap-anywhere @min-[52rem]:px-3 @min-[52rem]:py-3"><span aria-hidden="true" className="block text-[12px] text-muted-foreground @min-[52rem]:hidden">Owner</span>{i.owner ? i.ownerName : i.routedTo ? <><span>{i.routedToName}</span><div className="text-[12px] text-muted-foreground">Not accepted yet</div></> : <span className="text-muted-foreground">No manager</span>}</td>
      <td role="cell" className="text-right @min-[52rem]:px-3 @min-[52rem]:py-3"><span aria-hidden="true" className="block text-[12px] text-muted-foreground @min-[52rem]:hidden">Amount</span><div className="tabular whitespace-nowrap">{amount}</div><div className="text-[12px] text-muted-foreground">{amountNote}</div></td>
      <td role="cell" className="col-span-2 min-w-0 wrap-anywhere @min-[52rem]:py-3 @min-[52rem]:pl-3 @min-[52rem]:pr-4">
        <span aria-hidden="true" className="block text-[12px] text-muted-foreground @min-[52rem]:hidden">Next step</span>
        {needsAttention(i)
          ? <div className="flex items-start gap-1.5 font-medium"><span aria-hidden className={cn("mt-[6px] size-[7px] shrink-0 rounded-full", tone === "block" ? "bg-[var(--console-block)]" : "bg-[var(--console-attn)]")} /><span><span className="sr-only">Needs attention: </span>{i.next.text}</span></div>
          : <div className="text-muted-foreground">{i.next.text}</div>}
        {i.blockers.length > 1 ? <div className={cn("text-[12px] text-muted-foreground", needsAttention(i) && "pl-[13px]")}>+{i.blockers.length - 1} more open item{i.blockers.length > 2 ? "s" : ""}</div> : null}
      </td>
    </tr>
  );
}

export function moneyLine(i: Summary) {
  const m = i.money;
  if (m.confirmed) return `Confirmed ${money(m.confirmed.amount)}`;
  if (m.approved) return `Approved ${money(m.approved.amount)} · not booked`;
  if (m.requested != null) return `Requested ${money(m.requested)} · not approved`;
  return "No budget given";
}
