// What ccPlannie and Planned exchanged, request by request. In the product this travels over Planned's MCP
// connector; in the demo Planned isn't connected and its answers are sample data (said plainly on the page).
import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { linkClick } from "@/lib/router";
import { aget, fmtWhen } from "./api";
import { Page } from "./ConsoleApp";
import { A, Empty, ErrorState, Loading, Notice, PageHeader, Section, Status } from "./ui";
import { describe, plannedState, type Exchange, type Line } from "./exchanges";

export function PlannedPage() {
  const [data, setData] = useState<{ mode: string; exchanges: Exchange[]; events: { id: string; title: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => aget("/api/admin/planned").then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); const t = window.setInterval(load, 2500); return () => window.clearInterval(t); }, [load]);

  const groups = data ? data.events.map((e) => ({ ...e, ex: data.exchanges.filter((x) => x.eventId === e.id) })).filter((g) => g.ex.length) : [];

  return (
    <Page>
      <PageHeader title="Planned" right={<>
        {data?.mode === "sample" ? <Status tone="info">Sample data</Status> : null}
        <Button size="sm" variant="outline" nativeButton={false} render={<a href="/how-it-works?from=console" onClick={linkClick("/how-it-works?from=console", { returnTo: "/admin/planned" })} />}>How it connects</Button>
      </>} />

      {error && data ? <Notice tone="attn" role="alert">Couldn’t refresh venue exchanges. <button className="text-primary underline-offset-2 hover:underline" onClick={load}>Try again</button></Notice> : null}
      {error && !data ? <ErrorState error={error} retry={load} /> : !data ? <Loading /> : groups.length === 0 ? (
        <Empty title="No venue activity yet">Exchanges appear after an event manager requests venue options. <A to="/admin/requests">View requests</A></Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <Section key={g.id} id={`planned-${g.id}`} title={<A to={`/admin/requests/${g.id}`} className="wrap-anywhere">{g.title} <span className="tabular whitespace-nowrap font-normal text-muted-foreground">{g.id}</span></A>} aside={plannedState(g.ex)}>
              <ExchangeList lines={describe(g.ex)} />
            </Section>
          ))}
        </div>
      )}
    </Page>
  );
}

const exchangeColumns = "@min-[36rem]:grid-cols-[9rem_7.25rem_minmax(0,1fr)]";

export function ExchangeList({ lines, compact }: { lines: Line[]; compact?: boolean }) {
  return (
    <div className={cn("@container", compact ? "border-y border-border" : "overflow-hidden rounded-xl border border-border bg-card")}>
      {!compact ? <div aria-hidden="true" className={cn("hidden gap-3 border-b border-border bg-[var(--console-sidebar)] px-4 py-2.5 text-[12px] font-medium text-muted-foreground @min-[36rem]:grid", exchangeColumns)}>
        <span>Time</span><span>Direction</span><span>Exchange</span>
      </div> : null}
      <ol className="divide-y divide-border">
        {lines.map((l) => (
          <li key={l.key} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 leading-5", exchangeColumns, compact ? "py-2" : "px-4 py-3")}>
            <time dateTime={l.at} className="tabular col-start-2 row-start-1 text-right text-[12px] text-muted-foreground @min-[36rem]:col-start-1 @min-[36rem]:text-left">{fmtWhen(l.at)}</time>
            <span className={cn("col-start-1 row-start-1 flex items-center gap-1.5 text-[12px] @min-[36rem]:col-start-2", l.direction === "to" ? "text-[var(--planned-out)]" : "text-[var(--planned-in)]")}>
              {l.direction === "to" ? <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} /> : <ArrowDownLeftIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} />}
              {l.direction === "to" ? "To Planned" : "From Planned"}
            </span>
            <span className={cn("col-span-2 min-w-0 wrap-anywhere text-[13px] @min-[36rem]:col-span-1 @min-[36rem]:col-start-3 @min-[36rem]:row-start-1", l.tone === "muted" && "text-muted-foreground", l.tone === "ok" && "font-medium")}>{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
