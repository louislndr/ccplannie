// Company console API client. All authority decisions are made on the server; this is only transport.
export class ApiError extends Error {
  status: number; errors?: Issue[]; constructor(m: string, status: number, errors?: Issue[]) { super(m); this.status = status; this.errors = errors; }
}
export type Issue = { row?: number | null; index?: number | null; email?: string | null; field?: string | null; message: string; scope?: string };

async function handle(r: Response, notifySignedOut = true) {
  const j = await r.json().catch(() => ({}));
  // A session that expired mid-use sends the console back to the sign-in screen.
  if (notifySignedOut && r.status === 401 && j.code === "login_required") window.dispatchEvent(new Event("console:signed-out"));
  if (!r.ok) throw new ApiError(j.error || `Request failed (${r.status})`, r.status, j.errors);
  return j;
}
const offline = () => { throw new ApiError("The server isn't responding. Check that ccPlannie is running, then try again.", 0); };
export const aget = (p: string) => fetch(p, { headers: { accept: "application/json" } }).catch(offline).then((r) => handle(r, p !== "/api/admin/session"));
export const apost = (p: string, body: any = {}) => fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(offline).then(handle);
export const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export type Person = { name: string; email: string; title: string; manager: string | null; roles: string[]; approveUpTo: number | null; backup: string | null; caps?: string[] };
export type Role = { label: string; summary: string; permissions: string[]; caps?: string[] };
export type Permission = { id: string; label: string; summary: string };
export type Company = {
  config: { version: number; source: string; updatedAt: string | null; updatedBy: string | null; currency: string; policy: Policy; timeoutRange: [number, number] };
  org: { currency: string; people: Person[]; roles: Record<string, Role>; permissions: Permission[] };
  labels: Record<string, string>;
};
export type Policy = { name: string; defaultManager: string; defaultFinanceApprover: string; delegatedInquiries: boolean; supplierTimeoutHours: number; plannedWorkspaceRef: string };
export type Diff = {
  people: { kind: string; email: string; text: string }[]; roles: { email: string; text: string }[]; limits: { email: string; text: string }[];
  roleDefinitions: { id: string; kind: string; text: string }[]; policy: { key: string; label: string; before: any; after: any }[];
  identity: { from: string; to: string; text: string }[]; affected: { eventId: string | null; title: string; items: string[] }[];
};
export type Preview = { version: number; errors: Issue[]; warnings: Issue[]; diff: Diff | null };
export type Summary = {
  id: string; version: number; title: string; requester: string; requesterName: string; receivedAt: string; routedTo: string | null; owner: string | null; routedToName: string | null; ownerName: string | null;
  stage: { code: string; label: string }; paused: boolean; date: string | null; headcount: number | null;
  money: { requested: number | null; approved: { amount: number; cap: number; ref: string } | null; confirmed: { amount: number; ref: string; supplier: string } | null };
  blockers: { code: string; filter: string; text: string }[]; filters: string[]; next: { who: string | null; text: string }; search: string;
};
export type Inbox = { now: string; items: Summary[]; counts: Record<string, number>; filters: [string, string][]; intake: Intake[] };
export type Intake = { msgId: string; from: string; subject: string; at: string; reason: string; preview: string; kind: string; canReprocess: boolean; reprocessed: boolean };
export type DemoInfo = { scenario: { id: string; number: number; title: string; company: string; tagline: string }; step: number; steps: number; current: { key: string; title: string; adminPath: string | null; kind?: string; op?: string | null; focusPerson?: string | null; timeoutEdit?: { before: number; after: number } | null; view?: { who: string; name: string; role: string | null; eventId: string | null } | null } | null; next: string | null };
export type Session = { mode: string; stale?: boolean; demo?: DemoInfo | null; admin: { id: string; label: string }; plannie: { intake: string; from: string }; identities: { email: string; name: string; roles: string[]; caps: string[] }[] };

export const CAP_TEXT: Record<string, string> = {
  "event.request": "Start a request by CC'ing ccPlannie",
  "plan.provide_details": "Fill in missing details",
  "plan.change_scope": "Change the plan (headcount, date, nights, rooms)",
  "option.select": "Choose among supplier options (not a spending approval)",
  "suggest": "Suggest changes (never applied on their own)",
  "spend.approve": "Approve exact spending terms, up to their limit",
  "supplier.inquire": "Send non-binding quote and availability requests",
  "supplier.authorize": "Authorize bookings and amendments on requests they own",
  "event.own": "Accept ownership of routed requests",
  "clause.review": "Verify contract clauses",
  "decision.manual": "Record off-email decisions with provenance",
};
export const CAP_ORDER = ["event.request", "plan.provide_details", "plan.change_scope", "option.select", "spend.approve", "event.own", "supplier.inquire", "supplier.authorize", "clause.review", "decision.manual", "suggest"];
export const money = (n: number | null | undefined, cur = "CAD") => (n == null ? "—" : `${cur} ${Math.round(n).toLocaleString("en-US")}`);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
export const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
