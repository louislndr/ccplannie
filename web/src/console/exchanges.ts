// Exchanges between ccPlannie and Planned, described in plain English. In the product these travel over
// Planned's MCP connector; in the demo, Planned isn't connected and its answers are sample data.
import { fmtDate, money } from "./api";

export type Exchange = {
  id: string; at: string; eventId: string; direction: "to" | "from"; type: string;
  venue: string; venueId: string | null; city: string | null;
  fields: { date?: string | null; nights?: number | null; headcount?: number | null; rooms?: number | null; amount?: number | null; includesFee?: number; capacity?: number | null; offerRef?: string | null; bookingRef?: string | null; contract?: string | null; reason?: string | null; requestRef?: string | null };
  attachments?: string[];
};
export type Line = { key: string; at: string; eventId: string; direction: "to" | "from"; text: string; tone?: "ok" | "muted" };

const short = (venue: string) => venue.replace(/\s+(Conference Hotel|Hotel|Lodge|Retreat|Resort)$/i, "");
const people = (n?: number | null) => (n ? `${n} people` : null);
const join = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

// One line per exchange, except quote requests sent together, which read as one line.
export function describe(exchanges: Exchange[]): Line[] {
  const sent = new Map(exchanges.filter((x) => x.direction === "to").map((x) => [x.fields.requestRef, x]));
  const out: Line[] = [];
  const asked = new Set<string>(); // requests that already had a first round of options
  for (const x of exchanges) {
    const f = x.fields;
    if (x.direction === "to") {
      if ((x.type === "quote" || x.type === "availability") && !f.bookingRef) {
        const prev = out.at(-1);
        if (prev && prev.key.startsWith("q:") && prev.at === x.at && prev.eventId === x.eventId) { prev.text = prev.text.replace(/^((?:Venue options|Revised offers) requested: .*?)( · .*)$/, `$1, ${short(x.venue)}$2`); continue; }
        out.push({ key: `q:${x.id}`, at: x.at, eventId: x.eventId, direction: "to", text: `${asked.has(x.eventId) ? "Revised offers requested" : "Venue options requested"}: ${short(x.venue)} · ${join(people(f.headcount), f.nights ? `${f.nights} night${f.nights > 1 ? "s" : ""}` : null, f.date ? fmtDate(f.date) : null)}` });
        asked.add(x.eventId);
      } else if (x.type === "quote" || x.type === "availability") {
        out.push({ key: x.id, at: x.at, eventId: x.eventId, direction: "to", text: `Asked whether ${x.venue} can move booking ${f.bookingRef} to ${fmtDate(f.date)}, and at what price (a question, not a change)` });
      } else if (x.type === "booking") {
        out.push({ key: x.id, at: x.at, eventId: x.eventId, direction: "to", text: `Booking sent with the exact approved terms: ${x.venue}, ${join(people(f.headcount), fmtDate(f.date))}, ${money(f.amount)}` });
      } else if (x.type === "amendment") {
        out.push({ key: x.id, at: x.at, eventId: x.eventId, direction: "to", text: `Change sent with the exact approved terms: booking ${f.bookingRef} to ${join(fmtDate(f.date), people(f.headcount))}, ${money(f.amount)}` });
      } else out.push({ key: x.id, at: x.at, eventId: x.eventId, direction: "to", text: `${x.type} sent to ${x.venue}` });
      continue;
    }
    const req = sent.get(f.requestRef);
    const fee = f.includesFee ? ` (incl. ${money(f.includesFee)} date-change fee)` : "";
    const text =
      x.type === "offer" ? `Offer from ${x.venue}: ${money(f.amount)} for ${join(people(f.headcount), fmtDate(f.date))}${fee}`
      : x.type === "amendment-offer" ? `Change quote from ${x.venue}: ${money(f.amount)} for ${join(fmtDate(f.date), people(f.headcount))}${fee}`
      : x.type === "available-price-unknown" ? `${x.venue} is available on ${fmtDate(f.date)}; price not quoted yet`
      : x.type === "cannot-quote" ? `${x.venue} can't host ${req?.fields.headcount ?? "this group"}${f.capacity ? ` (capacity ${f.capacity})` : ""}`
      : x.type === "unavailable" ? `${x.venue} isn't available on ${fmtDate(f.date)}`
      : x.type === "booking-confirmed" ? `Booking confirmed ${f.bookingRef}: ${x.venue}, ${join(people(f.headcount), fmtDate(f.date))}, ${money(f.amount)}${x.attachments?.length ? " · contract summary attached" : ""}`
      : x.type === "amendment-confirmed" ? `Change confirmed on ${f.bookingRef}: now ${join(fmtDate(f.date), people(f.headcount))}, ${money(f.amount)}${fee}`
      : x.type === "declined" ? `${x.venue} declined${f.reason ? ` (${f.reason.replace(/-/g, " ")})` : ""}; nothing changed`
      : `Unstructured answer about ${x.venue}; held for review, not applied`;
    out.push({ key: x.id, at: x.at, eventId: x.eventId, direction: "from", text, tone: /confirmed/.test(x.type) ? "ok" : /cannot|unavailable|declined|unstructured/.test(x.type) ? "muted" : undefined });
  }
  return out;
}

// Where a request stands with Planned, from the exchanges alone.
export function plannedState(exchanges: Exchange[]): string {
  const last = (t: string[]) => [...exchanges].reverse().find((x) => t.includes(x.type));
  const confirmed = last(["booking-confirmed", "amendment-confirmed"]);
  const pendingBooking = [...exchanges].reverse().find((x) => x.direction === "to" && (x.type === "booking" || x.type === "amendment"));
  if (pendingBooking && (!confirmed || confirmed.at < pendingBooking.at)) return confirmed ? `Booked ${confirmed.fields.bookingRef}; change sent, waiting for confirmation` : "Booking sent, waiting for confirmation";
  if (confirmed) return `Booked ${confirmed.fields.bookingRef} (${confirmed.venue})`;
  if (exchanges.some((x) => x.direction === "from")) return "Options received";
  if (exchanges.length) return "Options requested, waiting for Planned";
  return "Nothing sent to Planned yet";
}
