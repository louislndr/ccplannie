// Company configuration for the FICTIONAL demo company. Authority comes only from here:
// never from titles, signatures, model output, or who happens to be on CC.
import { existsSync, readFileSync } from "node:fs";
import { ROLES, DEFAULT_ROLES, capsFor, setRoles, cloneRoles } from "./org.mjs";

export const COMPANY = {
  id: "acme",
  name: "Acme Robotics (fictional)",
  domain: "acme.example",
  currency: "CAD",
  timezone: "America/Toronto",
};
// Each demo scenario brings its own (fictional) company; switching scenarios updates this in place.
export function setCompany(c) { Object.assign(COMPANY, c); }

// Plannie's addresses. Locally: plannie@plannie.example and plannie+e-1001@plannie.example.
// With Postmark inbound, set PLANNIE_INBOUND_ADDRESS to your inbound address (e.g. abc123@inbound.postmarkapp.com);
// per-event reply addresses then use plus-addressing (abc123+e-1001@inbound.postmarkapp.com, Postmark's MailboxHash).
// With the Gmail transport, Plannie's address defaults to the Gmail account (plus-addresses route replies).
const inbound = (process.env.PLANNIE_INBOUND_ADDRESS || (process.env.PLANNIE_MODE === "company" && process.env.GMAIL_APP_PASSWORD && process.env.GMAIL_USER) || "plannie@plannie.example").toLowerCase();
const [inLocal, inDomain] = inbound.split("@");
export const PLANNIE = {
  name: "ccPlannie",
  intake: inbound,
  local: inLocal,
  domain: inDomain,
  // Outbound From address (Postmark needs a confirmed sender signature for it).
  from: (process.env.PLANNIE_FROM_ADDRESS || inbound).toLowerCase(),
  // Per-request reply addresses (plannie+e-1@…). Off for mail providers without sub-addressing (AgentMail):
  // replies are then matched to requests by their In-Reply-To / References headers only.
  plus: true,
};
// A mail provider that assigns Plannie's address at startup (e.g. AgentMail) sets it here, before any mail flows.
export function setPlannieAddress(address, { plus = PLANNIE.plus } = {}) {
  const a = String(address).toLowerCase();
  [PLANNIE.local, PLANNIE.domain] = a.split("@");
  PLANNIE.intake = a; PLANNIE.from = a; PLANNIE.plus = plus;
}
export const eventAddress = (eventId) => (PLANNIE.plus ? `${PLANNIE.local}+${eventId.toLowerCase()}@${PLANNIE.domain}` : PLANNIE.intake);
export function eventIdFromAddress(addr) {
  if (!PLANNIE.plus) return null;
  const m = (addr || "").toLowerCase().match(/^([^@+]+)\+(e-\d+)@(.+)$/);
  return m && m[1] === PLANNIE.local && m[3] === PLANNIE.domain ? m[2].toUpperCase() : null;
}
export const isPlannieAddress = (addr) => { const a = (addr || "").toLowerCase(); return a === PLANNIE.intake || a === PLANNIE.from || !!eventIdFromAddress(a); };

// Capabilities (separate powers):
//  event.request        open a new request by CC'ing Plannie
//  plan.provide_details fill in missing working-plan details
//  plan.change_scope    change the working plan's scope (headcount, date, nights, rooms, area, budget request)
//  option.select        choose among supplier options
//  suggest              contribute suggestions
//  spend.approve        approve exact spending terms (with limit) and revise the budget cap
//  supplier.inquire     send non-binding availability/quote requests to suppliers
//  supplier.authorize   authorize holds, bookings and amendments (binding, simulated)
//  event.own            accept ownership as the company event manager
//  clause.review        review extracted contract rules before they count as verified
//  decision.manual      record an off-email decision with provenance
// The sample company. The org chart can be replaced at runtime from the Company page (CSV upload);
// see src/org.mjs for roles and validation.
export const SAMPLE_ORG = [
  { name: "Dana Ruiz", email: "dana@acme.example", title: "VP Sales", manager: null, roles: ["sponsor"], approveUpTo: null, backup: null },
  { name: "Sam Lee", email: "sam@acme.example", title: "Executive Assistant", manager: "dana@acme.example", roles: ["requester"], approveUpTo: null, backup: null },
  { name: "Leo Park", email: "leo@acme.example", title: "Account Executive", manager: "dana@acme.example", roles: ["stakeholder"], approveUpTo: null, backup: null },
  { name: "Priya Shah", email: "priya@acme.example", title: "Finance Manager", manager: null, roles: ["finance"], approveUpTo: 100000, backup: null },
  { name: "Alex Moreau", email: "alex@acme.example", title: "Event Manager", manager: null, roles: ["event_manager"], approveUpTo: null, backup: null },
];
const SAMPLE_IDS = { "dana@acme.example": "dana", "sam@acme.example": "sam", "leo@acme.example": "leo", "priya@acme.example": "priya", "alex@acme.example": "alex" };

// Live, mutable views of the current org. Everything else reads these, so an upload takes effect immediately.
export const PEOPLE = {};
export const TRUSTED_LOCAL = new Set(); // identities the LOCAL demo mail client may send as (never used for real email)
export const ORG = { people: [], roles: cloneRoles(DEFAULT_ROLES), source: "sample", updatedAt: null };

export function applyOrg(people, { source = "upload", updatedAt = null, roles = DEFAULT_ROLES } = {}) {
  setRoles(roles);
  for (const k of Object.keys(PEOPLE)) delete PEOPLE[k];
  TRUSTED_LOCAL.clear();
  for (const p of people) {
    PEOPLE[p.email] = {
      id: SAMPLE_IDS[p.email] || p.email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
      name: p.name, title: [p.title, ...p.roles.map((r) => ROLES[r]?.label)].filter(Boolean).join(" · "),
      roles: p.roles, caps: capsFor(p.roles), manager: p.manager || null, backup: p.backup || null,
      ...(p.approveUpTo != null ? { limits: { approveUpTo: p.approveUpTo } } : {}),
    };
    TRUSTED_LOCAL.add(p.email);
  }
  // For live email, data/people.json maps real mailboxes onto people in the org, e.g. { "you@gmail.com": "dana" }.
  // The real address then carries exactly that person's capabilities (nothing more).
  const file = process.env.PLANNIE_PEOPLE_FILE || "data/people.json";
  if (existsSync(file)) {
    const map = JSON.parse(readFileSync(file, "utf8"));
    for (const [addr, id] of Object.entries(map)) {
      const base = Object.values(PEOPLE).find((x) => x.id === id && !x.alias);
      if (base) PEOPLE[addr.toLowerCase()] = { ...base, alias: true };
    }
  }
  ORG.people = people.map((p) => ({ ...p }));
  ORG.roles = cloneRoles(roles);
  ORG.source = source;
  ORG.updatedAt = updatedAt;
}
applyOrg(SAMPLE_ORG, { source: "sample" });

// The company policy. Editable from the console (/admin/policy); stored, versioned and audited in SQLite
// (src/company.mjs) and applied here at runtime. The sample values below are only the starting point.
// Guardrails that are NOT settings: spending needs finance approval of exact terms within the approver's
// limit, and binding supplier actions need explicit authorization by the owning event manager.
export const SAMPLE_POLICY = {
  name: "Sample offsite policy (fictional)",
  defaultManager: "alex@acme.example",          // new requests are routed here (not yet accepted)
  defaultFinanceApprover: "priya@acme.example", // new spending approvals are assigned here
  delegatedInquiries: true,                     // ccPlannie may send non-binding follow-up inquiries after ownership is accepted
  supplierTimeoutHours: 48,                     // no supplier reply after this → "no response", commitment untouched
  plannedWorkspaceRef: "",                      // a note only; it never connects anything
  flow: [],                                     // extra steps the company adds to the fixed path (see FLOW_POINTS)
};
// Where an extra step can sit: after each step of the fixed path a request always follows. Each point is
// reached when the request enters that stage (status codes from domain.status).
export const FLOW_POINTS = [
  { id: "received", label: "Someone emails ccPlannie", stages: ["received"] },
  { id: "assigned", label: "An event manager takes it", stages: ["assigned"] },
  { id: "sourcing", label: "ccPlannie asks Planned for venues", stages: ["sourcing"] },
  { id: "chosen", label: "The requester picks a venue", stages: ["approval_needed"] },
  { id: "approved", label: "Finance approves the exact amount", stages: ["approved_internal"] },
  { id: "booking", label: "The event manager books it with Planned", stages: ["supplier_pending"] },
  { id: "confirmed", label: "Planned confirms. It's booked.", stages: ["confirmed"] },
];
// A new company starts with no people and no routing defaults.
export const EMPTY_POLICY = { name: "Company event policy", defaultManager: "", defaultFinanceApprover: "", delegatedInquiries: true, supplierTimeoutHours: 48, plannedWorkspaceRef: "", flow: [] };
export const POLICY = {
  ...SAMPLE_POLICY,
  emailApprovals: { "spend.approve": true },    // fixed: email approvals need verified identity + exact reference
  autoShareComparisons: true,                   // fixed: there is no manual sharing action, so this isn't a setting
  spendNeedsApproval: true,                     // fixed guardrail, never configurable
};
// Which saved configuration is governing behavior right now (recorded on consequential actions).
export const CONFIG = { version: 0, source: "sample", updatedAt: null };

export function applyPolicy(policy, meta = {}) {
  // Never fall back to the sample cast for a real company: a missing default stays empty.
  for (const k of Object.keys(SAMPLE_POLICY)) POLICY[k] = policy[k] !== undefined ? policy[k] : EMPTY_POLICY[k];
  Object.assign(CONFIG, meta);
}

// The configured default manager, only while they still hold event-manager powers.
export const defaultManager = () => (POLICY.defaultManager && can(POLICY.defaultManager, "event.own") ? POLICY.defaultManager : null);
// The configured default finance approver as configured (may have lost authority; callers check).
export const defaultApprover = () => POLICY.defaultFinanceApprover || null;
// Two addresses are the same person when one is a server-side alias of the other.
export const samePerson = (a, b) => { const x = person(a), y = person(b); return !!x && !!y && x.id === y.id; };
// A server-side alias (data/people.json) of this person, if one exists; used for real delivery.
export const aliasOf = (email) => { const id = person(email)?.id; return id ? Object.entries(PEOPLE).find(([, p]) => p.alias && p.id === id)?.[0] || null : null; };

export const person = (email) => PEOPLE[(email || "").toLowerCase()] || null;
export const can = (email, cap) => !!person(email)?.caps.includes(cap);
export const isCompany = (email) => !!person(email);
export const displayName = (email) => person(email)?.name || email;
export const firstName = (email) => (person(email)?.name || email).split(" ")[0];
export const roleOf = (id) => Object.entries(PEOPLE).find(([, p]) => p.id === id && !p.alias)?.[0];
