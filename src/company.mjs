// Company configuration: the org chart (who holds which roles) and the company policy, stored as ONE
// versioned document in SQLite with an application audit log. Every change goes through saveCompany():
// validate → (one transaction: versioned write + audit rows) → apply at runtime. A failed or stale save
// writes nothing and logs nothing. Demo reset never touches this (see Store.reset).
import { COMPANY, ORG, POLICY, CONFIG, SAMPLE_ORG, SAMPLE_POLICY, EMPTY_POLICY, FLOW_POINTS, applyOrg, applyPolicy, displayName } from "./config.mjs";
import { DEFAULT_ROLES, capsFor, cloneRoles, permLabel, readOrgPeople, rolesFromDefinitions, validateRoles } from "./org.mjs";
import { ConflictError } from "./db.mjs";

export class ValidationError extends Error {
  constructor(errors, warnings = []) { super(errors[0]?.message || "Invalid configuration"); this.status = 422; this.errors = errors; this.warnings = warnings; }
}

const POLICY_KEYS = Object.keys(SAMPLE_POLICY);
export const POLICY_LABELS = {
  name: "Policy name",
  defaultManager: "Default request-routing event manager",
  defaultFinanceApprover: "Default finance approver",
  delegatedInquiries: "Automatic non-binding follow-up inquiries",
  supplierTimeoutHours: "Supplier response timeout (hours)",
  plannedWorkspaceRef: "Planned workspace reference (note)",
  flow: "Extra steps",
};
export const TIMEOUT_RANGE = [1, 720];

const sampleDoc = () => ({ org: { people: SAMPLE_ORG.map((p) => ({ ...p })), roles: cloneRoles(DEFAULT_ROLES) }, policy: { ...SAMPLE_POLICY } });
const emptyDoc = () => ({ org: { people: [], roles: cloneRoles(DEFAULT_ROLES) }, policy: { ...EMPTY_POLICY } });

// Documents saved before roles were editable only stored label/summary overrides ("roleDefinitions").
export function normalizeDoc(doc) {
  if (doc?.org?.roles) return doc;
  const { roleDefinitions, ...org } = doc.org;
  return { ...doc, org: { ...org, roles: rolesFromDefinitions(roleDefinitions) } };
}

// Read the stored configuration (migrating the older meta "org" upload if present) and apply it.
// Must run before any message is processed or queued work is flushed.
// `initial`: "sample" for the standalone demo (the fictional Acme cast), "empty" for a real company.
export function loadCompany(store, { initial = "sample" } = {}) {
  let cfg = store.getConfig();
  if (!cfg) {
    const legacy = store.getMeta("org");
    store.tx(() => {
      if (legacy?.people?.length) {
        const doc = { org: { people: legacy.people.map(({ line, ...p }) => p), roles: rolesFromDefinitions(legacy.roleDefinitions) }, policy: { ...SAMPLE_POLICY } };
        const at = new Date().toISOString();
        const version = store.saveConfig({ doc, source: "saved", updatedAt: legacy.updatedAt || at, updatedBy: "system (migration)" }, 0);
        store.insertAudit({ at, actor: "system (migration)", action: "config.migrated", entity: "company", after: { people: doc.org.people.length }, details: { text: `Moved the uploaded org chart (${doc.org.people.length} people) into versioned company configuration v${version}.` }, configVersion: version });
      } else {
        store.saveConfig({ doc: initial === "empty" ? emptyDoc() : sampleDoc(), source: initial === "empty" ? "empty" : "sample", updatedAt: null, updatedBy: null }, 0);
      }
      store.setMeta("org", null);
    });
    cfg = store.getConfig();
  }
  applyRuntime(cfg);
  return cfg;
}

export function applyRuntime(cfg) {
  const doc = normalizeDoc(cfg.doc);
  applyOrg(doc.org.people, { source: cfg.source === "saved" ? "upload" : cfg.source, updatedAt: cfg.updatedAt, roles: doc.org.roles });
  applyPolicy(cfg.doc.policy, { version: cfg.version, source: cfg.source, updatedAt: cfg.updatedAt });
}

// ------------------------------------------------------------------ validation (shared by every path)

export function validatePolicy(raw, people, roles) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  const p = {};
  const known = new Set(POLICY_KEYS);
  for (const k of Object.keys(raw || {})) if (!known.has(k)) err(k, `Unknown setting "${k}".`);
  p.name = typeof raw?.name === "string" ? raw.name.trim() : "";
  if (!p.name) err("name", "Give the policy a name.");
  else if (p.name.length > 80) err("name", "Keep the policy name under 80 characters.");
  const byEmail = new Map(people.map((x) => [x.email, x]));
  p.defaultManager = typeof raw?.defaultManager === "string" ? raw.defaultManager.trim().toLowerCase() : "";
  const m = byEmail.get(p.defaultManager);
  if (!p.defaultManager) err("defaultManager", "Choose who receives new requests.");
  else if (!m) err("defaultManager", `${p.defaultManager} isn't in the company.`);
  else if (!capsFor(m.roles, roles).includes("event.own")) err("defaultManager", `${m.name} isn't an event manager (no role with “${permLabel("manage")}”), so they can't own requests.`);
  p.defaultFinanceApprover = typeof raw?.defaultFinanceApprover === "string" ? raw.defaultFinanceApprover.trim().toLowerCase() : "";
  const f = byEmail.get(p.defaultFinanceApprover);
  if (!p.defaultFinanceApprover) err("defaultFinanceApprover", "Choose who approves spending by default.");
  else if (!f) err("defaultFinanceApprover", `${p.defaultFinanceApprover} isn't in the company.`);
  else if (!capsFor(f.roles, roles).includes("spend.approve") || f.approveUpTo == null) err("defaultFinanceApprover", `${f.name} isn't a finance approver with a limit (needs a role with “${permLabel("approve")}”).`);
  if (typeof raw?.delegatedInquiries !== "boolean") err("delegatedInquiries", "Choose on or off.");
  p.delegatedInquiries = raw?.delegatedInquiries === true;
  const h = raw?.supplierTimeoutHours;
  const hn = typeof h === "string" && /^\d+$/.test(h.trim()) ? Number(h) : h;
  if (!Number.isInteger(hn) || hn < TIMEOUT_RANGE[0] || hn > TIMEOUT_RANGE[1]) err("supplierTimeoutHours", `Enter a whole number of hours from ${TIMEOUT_RANGE[0]} to ${TIMEOUT_RANGE[1]}.`);
  p.supplierTimeoutHours = Number.isInteger(hn) ? hn : null;
  p.plannedWorkspaceRef = typeof raw?.plannedWorkspaceRef === "string" ? raw.plannedWorkspaceRef.trim() : raw?.plannedWorkspaceRef == null ? "" : null;
  if (p.plannedWorkspaceRef == null) err("plannedWorkspaceRef", "The workspace reference must be text.");
  else if (p.plannedWorkspaceRef.length > 120) err("plannedWorkspaceRef", "Keep the reference under 120 characters.");
  else if (/cookie|session|bearer|token|sk-|password|secret/i.test(p.plannedWorkspaceRef)) err("plannedWorkspaceRef", "This is a plain label. Don't paste credentials, tokens or session cookies here.");
  p.flow = validateFlow(raw?.flow, byEmail, roles, err);
  return { policy: p, errors };
}

// Extra steps on the fixed path. Two kinds, both safe: "notify" emails someone an FYI when a request reaches
// a point (no authority), "escalate" sends approvals above an amount straight to an approver who can cover them.
function validateFlow(raw, byEmail, roles, err) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) { err("flow", "The extra steps must be a list."); return []; }
  if (raw.length > 20) err("flow", "Keep it to 20 extra steps or fewer.");
  const points = new Set(FLOW_POINTS.map((x) => x.id));
  const out = [];
  raw.slice(0, 20).forEach((s, i) => {
    const n = i + 1;
    const id = typeof s?.id === "string" && /^[a-z0-9-]{1,40}$/i.test(s.id) ? s.id : `step-${n}`;
    const who = typeof s?.who === "string" ? s.who.trim().toLowerCase() : "";
    const p = byEmail.get(who);
    if (s?.kind === "notify" || s?.kind === "loopin") {
      if (!points.has(s.after)) err("flow", `Extra step ${n}: choose where it goes.`);
      if (!p) err("flow", `Extra step ${n}: ${who || "the person"} isn't in the company.`);
      out.push({ id, kind: s.kind, after: s.after, who });
    } else if (s?.kind === "hold") {
      if (!points.has(s.after) || s.after === "confirmed") err("flow", `Extra step ${n}: a hold can't come after the booking is confirmed.`);
      else if (s.after === "sourcing") err("flow", `Extra step ${n}: a hold can't sit while Planned is answering. Put it before or after.`);
      out.push({ id, kind: "hold", after: s.after, who: "" });
    } else if (s?.kind === "escalate") {
      const amount = typeof s.over === "string" ? Number(s.over.replace(/[^\d.]/g, "")) : s.over;
      if (!Number.isFinite(amount) || amount <= 0) err("flow", `Extra step ${n}: enter a positive amount.`);
      if (!p) err("flow", `Extra step ${n}: ${who || "the approver"} isn't in the company.`);
      else if (!capsFor(p.roles, roles).includes("spend.approve") || p.approveUpTo == null) err("flow", `Extra step ${n}: ${p.name} can't approve spending.`);
      else if (Number.isFinite(amount) && p.approveUpTo < amount) err("flow", `Extra step ${n}: ${p.name}'s limit (${p.approveUpTo}) is below ${amount}, so they couldn't approve these.`);
      out.push({ id, kind: "escalate", after: "chosen", over: Number.isFinite(amount) ? amount : null, who });
    } else err("flow", `Extra step ${n}: unknown kind of step.`);
  });
  return out;
}

// Validate a complete next document. Returns the normalized document, errors and warnings.
// `roles` is the complete role set; callers that only have older label overrides may pass `roleDefinitions`.
export function validateDoc({ people: rawPeople, roles: rawRoles, roleDefinitions, policy: rawPolicy }) {
  const roles = validateRoles(rawRoles ?? rolesFromDefinitions(roleDefinitions));
  const org = readOrgPeople(rawPeople, { currency: COMPANY.currency, roles: roles.roles });
  const pol = validatePolicy(rawPolicy, org.people, roles.roles);
  // If a referenced person's own record is invalid (e.g. a malformed limit), report that, not a second policy error.
  const personErr = (email) => org.errors.some((e) => e.email === String(email || "").toLowerCase());
  pol.errors = pol.errors.filter((e) => !((e.field === "defaultFinanceApprover" && personErr(rawPolicy?.defaultFinanceApprover)) || (e.field === "defaultManager" && personErr(rawPolicy?.defaultManager))));
  const errors = [...org.errors, ...roles.errors, ...pol.errors.map((e) => ({ ...e, scope: "policy" }))];
  // Routing references from the policy point at people: say so on the person too, so the editor can show it.
  for (const e of pol.errors) {
    if (e.field === "defaultManager" && rawPolicy?.defaultManager) errors.push({ email: String(rawPolicy.defaultManager).toLowerCase(), field: "roles", message: `${rawPolicy.defaultManager} is the default request-routing manager. Choose another default on the Policy page first.` });
    if (e.field === "defaultFinanceApprover" && rawPolicy?.defaultFinanceApprover) errors.push({ email: String(rawPolicy.defaultFinanceApprover).toLowerCase(), field: "roles", message: `${rawPolicy.defaultFinanceApprover} is the default finance approver. Choose another default on the Policy page first.` });
  }
  return { doc: { org: { people: org.people, roles: roles.roles }, policy: pol.policy }, errors, warnings: org.warnings };
}

// ------------------------------------------------------------------ review of changes

const fmtMoney = (n) => (n == null ? "none" : `${COMPANY.currency} ${Math.round(n).toLocaleString("en-US")}`);
const roleNames = (ids, defs) => ids.map((r) => defs?.[r]?.label || r).join(", ") || "no role";
const permText = (perms) => perms.map(permLabel).join(", ") || "suggest only";

export function diffDoc(cur, next, events = []) {
  cur = normalizeDoc(cur); next = normalizeDoc(next);
  const curP = new Map(cur.org.people.map((p) => [p.email, p]));
  const nxtP = new Map(next.org.people.map((p) => [p.email, p]));
  const defs = { ...cur.org.roles, ...next.org.roles };
  const people = [], roles = [], limits = [], policy = [], roleDefinitions = [], identity = [];
  const renamedFrom = new Map((next.renames || []).map((r) => [r.to, r.from]));
  for (const [e, p] of nxtP) {
    const c = curP.get(e);
    if (!c) {
      const from = renamedFrom.get(e);
      if (from && curP.has(from)) identity.push({ from, to: e, name: p.name, text: `${p.name}'s identity changes from ${from} to ${e}. Mail from ${from} will no longer carry any ccPlannie powers.` });
      people.push({ kind: "added", email: e, text: `${p.name} (${e}) added as ${roleNames(p.roles, defs)}`, after: p });
      if (p.approveUpTo != null) limits.push({ email: e, text: `${p.name}: approval limit ${fmtMoney(p.approveUpTo)}`, before: null, after: p.approveUpTo });
      continue;
    }
    const d = [];
    if (c.name !== p.name) d.push(`name “${c.name}” → “${p.name}”`);
    if ((c.title || "") !== (p.title || "")) d.push(`title “${c.title || "—"}” → “${p.title || "—"}”`);
    if ((c.manager || "") !== (p.manager || "")) d.push(`reports to ${p.manager ? (nxtP.get(p.manager)?.name || p.manager) : "nobody"} (was ${c.manager ? (curP.get(c.manager)?.name || c.manager) : "nobody"})`);
    if ((c.backup || "") !== (p.backup || "")) d.push(`backup contact ${p.backup || "none"} (was ${c.backup || "none"})`);
    if ([...c.roles].sort().join() !== [...p.roles].sort().join()) roles.push({ email: e, text: `${p.name}: ${roleNames(c.roles, defs)} → ${roleNames(p.roles, defs)}`, before: c.roles, after: p.roles });
    if ((c.approveUpTo ?? null) !== (p.approveUpTo ?? null)) limits.push({ email: e, text: `${p.name}: approval limit ${fmtMoney(c.approveUpTo)} → ${fmtMoney(p.approveUpTo)}`, before: c.approveUpTo ?? null, after: p.approveUpTo ?? null });
    if (d.length) people.push({ kind: "changed", email: e, text: `${p.name}: ${d.join(", ")}`, before: c, after: p });
  }
  for (const [e, c] of curP) if (!nxtP.has(e)) people.push({ kind: "removed", email: e, text: `${c.name} (${e}) removed: loses all ccPlannie powers`, before: c });
  // Role changes. A role's permissions apply to everyone holding it, so say how many people that is.
  const holders = (id) => next.org.people.filter((p) => p.roles.includes(id)).length;
  const who = (id) => { const n = holders(id); return n ? ` (${n} ${n === 1 ? "person" : "people"})` : ""; };
  for (const [id, d] of Object.entries(next.org.roles)) {
    const c = cur.org.roles[id];
    if (!c) { roleDefinitions.push({ kind: "added", id, text: `New role “${d.label}”: ${permText(d.permissions)}`, before: null, after: d }); continue; }
    const t = [];
    if (c.label !== d.label) t.push(`renamed “${c.label}” → “${d.label}”`);
    if (c.summary !== d.summary) t.push("description changed");
    const gained = d.permissions.filter((x) => !c.permissions.includes(x)), lost = c.permissions.filter((x) => !d.permissions.includes(x));
    if (gained.length) t.push(`gains ${permText(gained)}`);
    if (lost.length) t.push(`loses ${permText(lost)}`);
    if (t.length) roleDefinitions.push({ kind: "changed", id, text: `Role “${d.label}”${gained.length || lost.length ? who(id) : ""}: ${t.join(", ")}`, before: c, after: d });
  }
  for (const [id, c] of Object.entries(cur.org.roles)) if (!next.org.roles[id]) roleDefinitions.push({ kind: "removed", id, text: `Role “${c.label}” deleted`, before: c, after: null });
  for (const k of POLICY_KEYS) if (JSON.stringify(cur.policy[k] ?? null) !== JSON.stringify(next.policy[k] ?? null)) policy.push({ key: k, label: POLICY_LABELS[k], before: cur.policy[k] ?? null, after: next.policy[k] ?? null });
  return { people, roles, limits, roleDefinitions, policy, identity, affected: affectedRequests(cur, next, events) };
}

// What a change means for requests in progress. Nothing here is automatic: it's what the admin should know.
export function affectedRequests(cur, next, events) {
  cur = normalizeDoc(cur); next = normalizeDoc(next);
  const caps = (doc) => new Map(doc.org.people.map((p) => [p.email, { caps: capsFor(p.roles, doc.org.roles), limit: p.approveUpTo, name: p.name }]));
  const a = caps(cur), b = caps(next);
  const has = (m, e, c) => !!m.get(e)?.caps.includes(c);
  const name = (e) => a.get(e)?.name || b.get(e)?.name || e;
  const out = [];
  for (const ev of events) {
    const items = [];
    const mgr = ev.owner || ev.routedTo;
    if (mgr && has(a, mgr, "event.own") && !has(b, mgr, "event.own")) items.push(`${name(mgr)} ${ev.owner ? "owns" : "is routed"} this request but loses event-manager powers. Protected actions stop until an administrator reassigns it.`);
    for (const ap of ev.approvals.filter((x) => x.status === "pending")) {
      const before = has(a, ap.approver, "spend.approve") && (a.get(ap.approver)?.limit ?? 0) >= ap.terms.amount;
      const after = has(b, ap.approver, "spend.approve") && (b.get(ap.approver)?.limit ?? 0) >= ap.terms.amount;
      if (before && !after) items.push(`${ap.id} (${fmtMoney(ap.terms.amount)}) is assigned to ${name(ap.approver)}, who could no longer approve it. It will show as blocked; it won't move to anyone else automatically.`);
      if (!before && after) items.push(`${ap.id} (${fmtMoney(ap.terms.amount)}) assigned to ${name(ap.approver)} becomes approvable.`);
    }
    for (const e of ev.participants) {
      for (const [cap, what] of [["plan.change_scope", "change the plan"], ["option.select", "choose an option"]]) {
        if (!has(a, e, cap) && has(b, e, cap)) items.push(`${name(e)} will be able to ${what} by email from now on (earlier suggestions stay suggestions).`);
        if (has(a, e, cap) && !has(b, e, cap)) items.push(`${name(e)} will no longer be able to ${what}; past decisions stay on record.`);
      }
    }
    if (cur.policy.delegatedInquiries && !next.policy.delegatedInquiries && ev.owner && !ev.commitment) items.push(`ccPlannie stops sending automatic follow-up inquiries here. ${name(ev.owner)} can still request quotes manually.`);
    if (items.length) out.push({ eventId: ev.id, title: ev.title, items });
  }
  if (cur.policy.defaultManager !== next.policy.defaultManager) out.push({ eventId: null, title: "New requests", items: [`New requests will be routed to ${name(next.policy.defaultManager)}. Existing requests stay with their current manager until an administrator reassigns them.`] });
  return out;
}

export const currentDoc = () => ({ org: { people: ORG.people.map((p) => ({ ...p })), roles: cloneRoles(ORG.roles) }, policy: Object.fromEntries(POLICY_KEYS.map((k) => [k, POLICY[k]])) });

// ------------------------------------------------------------------ the one write path

// Save a complete next configuration atomically. `audit` describes the operation (action + summary);
// per-entity before/after rows are derived from the diff. Throws ValidationError / ConflictError on failure,
// in which case nothing is written or applied and no audit row exists.
export function saveCompany(store, input, { expectedVersion, actor, action, summary, source = "saved", sourceFile, events = [] }) {
  if (!Number.isInteger(expectedVersion)) throw Object.assign(new Error("expectedVersion is required: reload the page and try again."), { status: 400 });
  if (!actor) throw Object.assign(new Error("No administrator context"), { status: 403 });
  const v = validateDoc(input);
  if (v.errors.length) throw new ValidationError(v.errors, v.warnings);
  const stored = store.getConfig();
  if (!stored || stored.version !== expectedVersion) throw new ConflictError(`Company configuration changed (now v${stored?.version}) since you loaded v${expectedVersion}. Reload to see the newer settings, then reapply your change.`);
  const diff = diffDoc(normalizeDoc(stored.doc), { ...v.doc, renames: input.renames || [] }, events);
  const total = diff.people.length + diff.roles.length + diff.limits.length + diff.roleDefinitions.length + diff.policy.length;
  // Nothing changed: no new version and no activity, whatever the stored source (sample, saved or empty).
  if (!total) return { version: stored.version, unchanged: true, diff, warnings: v.warnings };
  const at = new Date().toISOString();
  let version;
  store.tx(() => {
    version = store.saveConfig({ doc: v.doc, source, updatedAt: at, updatedBy: actor }, expectedVersion);
    const base = { at, actor, configVersion: version };
    store.insertAudit({ ...base, action, entity: "company", before: { version: expectedVersion }, after: { version }, details: { text: summary, ...(sourceFile ? { sourceFile } : {}), counts: { people: diff.people.length, roles: diff.roles.length, limits: diff.limits.length, policy: diff.policy.length, roleDefinitions: diff.roleDefinitions.length } } });
    for (const c of diff.identity) store.insertAudit({ ...base, action: "person.identity_changed", entity: `person:${c.from}`, before: { email: c.from }, after: { email: c.to }, details: { text: c.text } });
    for (const c of diff.people) store.insertAudit({ ...base, action: `person.${c.kind}`, entity: `person:${c.email}`, before: c.before || null, after: c.after || null, details: { text: c.text } });
    for (const c of diff.roles) store.insertAudit({ ...base, action: "person.roles_changed", entity: `person:${c.email}`, before: { roles: c.before }, after: { roles: c.after }, details: { text: c.text } });
    for (const c of diff.limits) store.insertAudit({ ...base, action: "person.limit_changed", entity: `person:${c.email}`, before: { approveUpTo: c.before }, after: { approveUpTo: c.after }, details: { text: c.text } });
    for (const c of diff.roleDefinitions) store.insertAudit({ ...base, action: `role.${c.kind}`, entity: `role:${c.id}`, before: c.before, after: c.after, details: { text: c.text } });
    for (const c of diff.policy) store.insertAudit({ ...base, action: "policy.changed", entity: `policy:${c.key}`, before: { [c.key]: c.before }, after: { [c.key]: c.after }, details: { text: `${c.label}: ${fmtPolicy(c.key, c.before)} → ${fmtPolicy(c.key, c.after)}` } });
  });
  applyRuntime(store.getConfig());
  return { version, diff, warnings: v.warnings };
}

export function fmtPolicy(key, v) {
  if (key === "delegatedInquiries") return v ? "on" : "off";
  if (key === "defaultManager" || key === "defaultFinanceApprover") return v ? `${displayName(v)} (${v})` : "none";
  if (key === "supplierTimeoutHours") return `${v} h`;
  if (key === "flow") return !v?.length ? "none" : v.map((s) => { const at = `after “${FLOW_POINTS.find((x) => x.id === s.after)?.label}”`; return s.kind === "escalate" ? `over ${s.over}: ${displayName(s.who)} approves` : s.kind === "loopin" ? `copy ${displayName(s.who)} ${at}` : s.kind === "hold" ? `hold for a check ${at}` : `tell ${displayName(s.who)} ${at}`; }).join("; ");
  return v === "" || v == null ? "—" : `“${v}”`;
}

// The configuration view the console reads.
export function configView(store) {
  const cfg = store.getConfig();
  return { version: cfg.version, source: cfg.source, updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy, currency: COMPANY.currency, policy: cfg.doc.policy, timeoutRange: TIMEOUT_RANGE, governing: { ...CONFIG } };
}

export { sampleDoc, emptyDoc };
