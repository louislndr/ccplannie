export type Msg = {
  id: string; messageId: string; direction: "human" | "plannie" | "supplier"; eventId: string | null; threadId: string | null;
  from: string; to: string[]; cc: string[]; subject: string; body: string; inReplyTo: string | null; references: string[];
  at: string; seenByPlannie: boolean; interpretation: any; interpSource: string | null; meta: any; attachments: any[]; notes: string[]; delivery: string | null;
  identity?: { verified: boolean; method?: string } | null;
};
export type DemoPart = { id: string; title: string; summary: string };
export type DemoStep = { key: string; part: string; kind: string; title: string; note?: string | null; explain?: string | null; planned?: { direction: "to" | "from"; what: string } | null; adminPath?: string | null; op?: string | null };
export type DemoScenario = { id: string; number: number; title: string; tagline: string; summary: string; company: string; people: number; parts: DemoPart[]; steps?: number };
export type PlannedExchange = {
  id: string; at: string; eventId: string | null; direction: "to" | "from"; type: string; venue: string; venueId: string | null; city: string | null;
  fields: { date?: string | null; nights?: number | null; headcount?: number | null; rooms?: number | null; amount?: number | null; includesFee?: number; capacity?: number | null; offerRef?: string | null; bookingRef?: string | null; contract?: string | null; reason?: string | null; requestRef?: string };
  attachments?: string[];
};
export type Snapshot = {
  now: string; mode: { interpreter: string; transport: string; demo: boolean };
  demo: { step: number; adminPath?: string | null; focusMessageId?: string | null; timeoutEdit?: { before: number; after: number } | null; steps: DemoStep[]; scenario: DemoScenario; scenarios: DemoScenario[] };
  planned: PlannedExchange[];
  people: Record<string, { id: string; name: string; title: string; caps: string[]; roles?: string[]; alias: boolean }>;
  roleLabels?: Record<string, string>;
  suppliers: Record<string, { id: string; name: string; city: string }>;
  plannie: { intake: string; from: string };
  events: any[]; messages: Msg[]; outbox: any[]; policy: any;
};

export async function getState(step?: number): Promise<Snapshot> {
  const r = await fetch(step === undefined ? "/api/state" : `/api/demo/review?step=${step}`);
  if (!r.ok) throw new Error(step === undefined ? "Couldn’t load the demo." : "Couldn’t open that step.");
  const snapshot = await r.json();
  if (!snapshot?.demo?.scenario) throw new Error("The demo returned an unexpected response.");
  return snapshot;
}
export async function post(path: string, body: any = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export const PLANNIE_COLOR = "from-[var(--m-avatar1)] to-[var(--m-avatar2)]"; // Mail-style monogram gray, not a brand gradient
export const money = (n: number | null | undefined) => (n == null ? "—" : `CAD ${Math.round(n).toLocaleString("en-US")}`);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function nameOf(s: Snapshot, addr: string) {
  if (!addr) return "";
  if (s.people[addr]) return s.people[addr].name;
  if (s.suppliers[addr]) return s.suppliers[addr].name;
  if (addr === s.plannie.intake || addr.startsWith(s.plannie.intake.split("@")[0] + "+")) return "ccPlannie";
  return addr;
}
export const isPlannie = (s: Snapshot, addr: string) => nameOf(s, addr) === "ccPlannie";

