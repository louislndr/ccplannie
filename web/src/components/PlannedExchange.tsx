// Exchanges between ccPlannie and Planned, shown as compact cards in the story. In the product these travel
// over Planned's MCP connector; in the demo Planned's answers are sample data (labeled once, in the feed).
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, money, type PlannedExchange } from "@/api";
import { SF, time } from "./mac";

export type ExchangeGroup = { key: string; at: string; eventId: string | null; direction: "to" | "from"; title: string; lines: string[] };

const cls = (x: PlannedExchange) =>
  x.direction === "to" ? (x.type === "booking" ? "book" : x.type === "amendment" ? "amend" : x.fields.bookingRef ? "ask-change" : "ask")
    : ["booking-confirmed", "amendment-confirmed"].includes(x.type) ? "confirmed" : x.type === "declined" ? "declined" : "options";

const brief = (f: PlannedExchange["fields"]) => [f.headcount ? `${f.headcount} people` : null, f.nights ? `${f.nights} night${f.nights > 1 ? "s" : ""}` : null, f.date ? fmtDate(f.date) : null].filter(Boolean).join(" · ");

function line(x: PlannedExchange, asked: Map<string, PlannedExchange>): string {
  const f = x.fields;
  const req = f.requestRef ? asked.get(f.requestRef) : undefined;
  switch (x.type) {
    case "quote": case "availability": return x.venue;
    case "booking": return `${x.venue} — ${money(f.amount)} · ${brief(f)}`;
    case "amendment": return `${x.venue}, booking ${f.bookingRef} — ${money(f.amount)} · ${brief(f)}`;
    case "offer": return `${x.venue} — ${money(f.amount)} · ${brief(f)}`;
    case "amendment-offer": return `${x.venue} — ${money(f.amount)} for ${fmtDate(f.date)}${f.includesFee ? `, incl. ${money(f.includesFee)} change fee` : ""}`;
    case "cannot-quote": return `${x.venue} can't host ${req?.fields.headcount ?? "this group"}${f.capacity ? ` (max ${f.capacity})` : ""}`;
    case "unavailable": return `${x.venue} isn't available on ${fmtDate(f.date || req?.fields.date)}`;
    case "available-price-unknown": return `${x.venue} is available; price to follow`;
    case "booking-confirmed": return `${x.venue} · booking ${f.bookingRef} · ${money(f.amount)}${x.attachments?.length ? " · contract summary" : ""}`;
    case "amendment-confirmed": return `${x.venue} · booking ${f.bookingRef} now ${fmtDate(f.date)} · ${money(f.amount)}`;
    case "declined": return `${x.venue} declined${f.reason ? ` (${f.reason})` : ""}`;
    default: return x.venue;
  }
}

const TITLE: Record<string, (g: PlannedExchange[]) => string> = {
  ask: (g) => `Venue options requested · ${brief(g[0].fields)}`,
  "ask-change": (g) => `Availability and price asked for ${fmtDate(g[0].fields.date)}`,
  book: () => "Booking sent (finance-approved terms)",
  amend: () => "Change sent (finance-approved terms)",
  options: (g) => (g.some((x) => x.type === "amendment-offer") ? "Change quote" : g.length > 1 ? "Venue options" : "Venue answer"),
  confirmed: (g) => (g[0].type === "amendment-confirmed" ? "Change confirmed" : "Booking confirmed"),
  declined: () => "Declined",
};

// Consecutive exchanges of the same kind on the same request become one card.
export function groupExchanges(all: PlannedExchange[]): ExchangeGroup[] {
  const asked = new Map(all.filter((x) => x.direction === "to" && x.fields.requestRef).map((x) => [x.fields.requestRef!, x]));
  const sorted = [...all].sort((a, b) => a.at.localeCompare(b.at));
  const groups: { k: string; items: PlannedExchange[] }[] = [];
  for (const x of sorted) {
    const k = `${x.eventId}|${x.direction}|${cls(x)}`;
    const last = groups.at(-1);
    if (last && last.k === k) last.items.push(x); else groups.push({ k, items: [x] });
  }
  return groups.map(({ k, items }) => ({
    key: items[0].id, at: items[0].at, eventId: items[0].eventId, direction: items[0].direction,
    title: TITLE[cls(items[0])]?.(items) ?? "Exchange",
    lines: items.map((x) => line(x, asked)),
  }));
}

export function ExchangeCard({ g, className }: { g: ExchangeGroup; className?: string }) {
  const to = g.direction === "to";
  const Icon = to ? ArrowUpRightIcon : ArrowDownLeftIcon;
  const color = to ? "text-[var(--planned-out)]" : "text-[var(--planned-in)]";
  // Same row as the inbox's other non-email activity, with the To/From Planned arrow and label used everywhere else.
  return (
    <section aria-label={`${to ? "To" : "From"} Planned: ${g.title}`} className={cn("flex items-start gap-3 border-b border-m-sep bg-m-banner px-4 py-2.5 text-[13px] leading-[18px] md:px-6", className)}>
      <span className="flex w-6 shrink-0 justify-center md:w-10"><Icon aria-hidden="true" className={cn("size-4", color)} strokeWidth={SF} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={color}>{to ? "To Planned" : "From Planned"}</span>
          <span className="min-w-0 truncate text-m-label2">{g.title}</span>
          <span className="ml-auto shrink-0 text-[12px] text-m-label2">{time(g.at)}</span>
        </div>
        {g.lines.map((l, i) => <div key={i} className="wrap-break-word">{l}</div>)}
      </div>
    </section>
  );
}
