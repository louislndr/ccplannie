// Company hierarchy: who is in the company, who reports to whom, which roles exist and which roles each
// person holds. Roles are company data (create, rename, delete, choose permissions) from the console or CSV.
// Authority never comes from titles or CC.
//
// CSV columns (header row required):
//   name,email,title,manager_email,roles,approval_limit,backup_email,role_id,role_label,role_description,role_permissions
//   roles: one or more role IDs (or role names) separated by ";"
//   approval_limit: required for anyone whose roles include "approve" (max amount, company currency)
//   backup_email: optional contact when this person is away (must have the same permissions). It is a contact only:
//                 Plannie never moves an approval or ownership to the backup automatically.
//   Role rows use only role_id, role_label, role_description and role_permissions (e.g. "request;decide").
//   If a file has role rows, they are the company's complete list of roles (a role left out is deleted).

// Permission groups: the only switches a company sets on a role. Each one grants a fixed bundle of the
// fine-grained capabilities that the rules in domain.mjs check. Groups are deliberately coarse; the
// separations that matter (choosing ≠ approving ≠ booking) are separate groups.
export const PERMISSIONS = [
  { id: "request", label: "Start requests", summary: "Open a request by CC'ing ccPlannie and fill in missing details.", caps: ["event.request", "plan.provide_details"] },
  { id: "decide", label: "Decide the plan", summary: "Change headcount, dates and budget request, and choose the venue. Not a spending approval.", caps: ["plan.change_scope", "option.select", "plan.provide_details"] },
  { id: "approve", label: "Approve spending", summary: "Approve exact spending terms, up to the person's own limit.", caps: ["spend.approve"] },
  { id: "manage", label: "Run events & book", summary: "Own requests, ask venues for quotes, authorize bookings, verify contract clauses, record decisions.", caps: ["event.own", "supplier.inquire", "supplier.authorize", "clause.review", "decision.manual", "plan.provide_details"] },
];
const PERM = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p]));
// Everyone in the company can suggest changes; suggestions are never applied on their own.
const BASE_CAPS = ["suggest"];

// The roles a new company starts with. A company can rename, change or delete them and add its own.
export const DEFAULT_ROLES = {
  sponsor: { label: "Sponsor", summary: "Owns the request and decides the plan", permissions: ["request", "decide"] },
  requester: { label: "Requester", summary: "Starts requests and fills in details (e.g. an assistant)", permissions: ["request"] },
  finance: { label: "Finance approver", summary: "Approves exact spending, up to their limit", permissions: ["approve"] },
  event_manager: { label: "Event manager", summary: "Runs sourcing and books venues", permissions: ["manage"] },
  stakeholder: { label: "Stakeholder", summary: "Can suggest changes, can't decide", permissions: [] },
};
export const cloneRoles = (roles) => Object.fromEntries(Object.entries(roles).map(([id, r]) => [id, { label: r.label, summary: r.summary, permissions: [...r.permissions] }]));

// The live role set (mutated in place by setRoles so every importer sees the current company's roles).
export const ROLES = cloneRoles(DEFAULT_ROLES);
export function setRoles(roles) {
  for (const k of Object.keys(ROLES)) delete ROLES[k];
  Object.assign(ROLES, cloneRoles(roles));
}

// Older saved configs only had label/summary overrides for the five fixed roles.
export function rolesFromDefinitions(defs = {}) {
  const out = cloneRoles(DEFAULT_ROLES);
  for (const [id, d] of Object.entries(defs || {})) if (out[id]) out[id] = { ...out[id], label: d?.label || out[id].label, summary: d?.summary || out[id].summary };
  return out;
}

export const MAX_ROLES = 50;
const ROLE_ID = /^[a-z][a-z0-9_]{0,39}$/;
export const slug = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const parsePerms = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[;,|/]+/)).map((x) => slug(x)).filter((x) => x && x !== "none");

// Validate a complete role set ({ id: { label, summary, permissions } }). Order is kept.
export function validateRoles(raw) {
  const roles = {}, errors = [];
  const err = (role, message, row = null) => errors.push({ row, index: null, email: null, field: "roles", role, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { roles, errors: [{ row: 0, index: null, email: null, field: "roles", message: "Send the full list of roles." }] };
  const entries = Object.entries(raw);
  if (!entries.length) err(null, "Define at least one role.");
  if (entries.length > MAX_ROLES) err(null, `Too many roles (${MAX_ROLES} max).`);
  const labels = new Map();
  for (const [id, r] of entries) {
    const row = r?.line ?? null;
    if (!ROLE_ID.test(id)) { err(id, `"${id}" isn't a valid role ID. Use lowercase letters, digits and underscores, starting with a letter.`, row); continue; }
    const label = String(r?.label ?? "").trim(), summary = String(r?.summary ?? "").trim();
    if (!label) err(id, `Role ${id} needs a name.`, row);
    else if (label.length > 60) err(id, `Role ${id}: keep the name under 60 characters.`, row);
    if (summary.length > 400) err(id, `Role ${id}: keep the description under 400 characters.`, row);
    const key = label.toLowerCase();
    if (label && labels.has(key)) err(id, `Two roles are called “${label}” (${labels.get(key)} and ${id}). Give each role its own name.`, row);
    else if (label) labels.set(key, id);
    const perms = parsePerms(r?.permissions);
    const unknown = perms.filter((p) => !PERM[p]);
    if (unknown.length) err(id, `Role ${id}: unknown permission ${unknown.map((u) => `"${u}"`).join(", ")}. Use: ${PERMISSIONS.map((p) => p.id).join(", ")}.`, row);
    roles[id] = { label, summary, permissions: PERMISSIONS.map((p) => p.id).filter((p) => perms.includes(p)) };
  }
  return { roles, errors };
}

export const capsOfRole = (role) => [...new Set([...BASE_CAPS, ...(role?.permissions || []).flatMap((p) => PERM[p]?.caps || [])])];
export const permsFor = (roleIds, roles = ROLES) => PERMISSIONS.map((p) => p.id).filter((p) => roleIds.some((r) => roles[r]?.permissions.includes(p)));
export const permLabel = (id) => PERM[id]?.label || id;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Minimal RFC-4180-style CSV parser (quotes, escaped quotes, commas/newlines inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const t = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

// Approval limits are parsed strictly. A minus sign, letters, exponents or stray characters are an error;
// nothing is stripped, so "-5,000" or "5k" can never turn into a different amount.
// Accepts: 75000 · 75,000 · 75000.50 · CAD 75,000 (currency must match the company currency).
export const MAX_LIMIT = 1_000_000_000;
export function parseLimit(raw, { currency = "CAD" } = {}) {
  if (raw == null || raw === "") return { value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { error: "Approval limit must be a finite number." };
    if (raw <= 0) return { error: "Approval limit must be greater than zero." };
    if (raw > MAX_LIMIT) return { error: `Approval limit is above the ${currency} ${MAX_LIMIT.toLocaleString("en-US")} maximum.` };
    return { value: raw };
  }
  if (typeof raw !== "string") return { error: "Approval limit must be a number." };
  const t = raw.trim();
  if (!t) return { value: null };
  const m = t.match(/^(?:([A-Za-z]{3})\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/);
  if (!m) return { error: `"${t}" isn't a valid approval limit. Use a positive amount like 75000 or 75,000.` };
  if (m[1] && m[1].toUpperCase() !== currency) return { error: `Approval limit must be in ${currency}, not ${m[1].toUpperCase()}.` };
  return parseLimit(Number(m[2].replace(/,/g, "") + (m[3] || "")), { currency });
}

const str = (v) => (v == null ? "" : String(v)).trim();
const emailOrNull = (v) => str(v).toLowerCase() || null;

// One person record from any source (CSV row or the web editor) in canonical form. Unknown fields
// (aliases, capabilities, anything else) are dropped: only the server-side people file can add an alias.
export function normalizePerson(raw, { currency = "CAD" } = {}) {
  const errors = [];
  const rolesIn = Array.isArray(raw?.roles) ? raw.roles : str(raw?.roles).split(/[;|/]+/);
  const roles = [...new Set(rolesIn.map((x) => str(x).toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean))];
  const lim = parseLimit(raw?.approveUpTo ?? raw?.approval_limit ?? null, { currency });
  if (lim.error) errors.push({ field: "approveUpTo", message: lim.error });
  const person = {
    name: str(raw?.name), email: str(raw?.email).toLowerCase(), title: str(raw?.title),
    manager: emailOrNull(raw?.manager ?? raw?.manager_email), roles,
    approveUpTo: lim.value ?? null, backup: emailOrNull(raw?.backup ?? raw?.backup_email),
  };
  return { person, errors, hadLimit: lim.value != null || !!lim.error };
}

// The single validation used by CSV imports and website edits. `people` are normalized records;
// `issues` are per-person parse errors from normalizePerson. Each error names the row (CSV) and email.
export function validatePeople(entries, { currency = "CAD", roles = ROLES } = {}) {
  const errors = [], warnings = [];
  // A person's roles may be given by ID or by name ("Finance approver" → finance).
  const byName = new Map(Object.entries(roles).flatMap(([id, r]) => [[id, id], [slug(r.label), id]]));
  for (const e of entries) e.person.roles = [...new Set(e.person.roles.map((r) => byName.get(r) || byName.get(slug(r)) || r))];
  const perms = (p) => permsFor(p.roles, roles);
  const roleNames = Object.entries(roles).map(([id, r]) => `${id} (${r.label})`).join(", ");
  const people = entries.map((e) => e.person);
  const at = (e, field, message) => ({ row: e.line ?? null, index: e.index ?? null, email: e.person.email || null, field, message });
  const seen = new Map();
  for (const e of entries) {
    const p = e.person;
    for (const x of e.errors || []) errors.push(at(e, x.field, x.message));
    if (!p.name) errors.push(at(e, "name", "Name is missing."));
    if (p.name.length > 120) errors.push(at(e, "name", "Name is too long (120 characters max)."));
    if (p.title.length > 120) errors.push(at(e, "title", "Title is too long (120 characters max)."));
    if (!EMAIL.test(p.email)) errors.push(at(e, "email", `"${p.email}" isn't a valid email.`));
    else if (seen.has(p.email)) errors.push(at(e, "email", `${p.email} is listed twice${seen.get(p.email) ? ` (also row ${seen.get(p.email)})` : ""}.`));
    else seen.set(p.email, e.line ?? 0);
    if (!p.roles.length) errors.push(at(e, "roles", "No role given. Give them a role without permissions if they should only suggest."));
    for (const role of p.roles) if (!Object.hasOwn(roles, role)) errors.push(at(e, "roles", `Unknown role "${role}". Use: ${roleNames}.`));
    if (perms(p).includes("approve")) {
      if (p.approveUpTo == null && !(e.errors || []).some((x) => x.field === "approveUpTo")) errors.push(at(e, "approveUpTo", `People who approve spending need an approval limit (${currency}).`));
    } else if (e.hadLimit) {
      warnings.push(at(e, "approveUpTo", "Approval limit ignored: none of their roles approve spending."));
      p.approveUpTo = null;
    }
  }
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const entryOf = new Map(entries.map((e) => [e.person.email, e]));
  for (const e of entries) {
    const p = e.person;
    if (p.manager && p.manager === p.email) errors.push(at(e, "manager", "Someone can't report to themselves."));
    else if (p.manager && !byEmail.has(p.manager)) errors.push(at(e, "manager", `Manager ${p.manager} isn't in the company.`));
    if (p.backup) {
      const b = byEmail.get(p.backup);
      if (p.backup === p.email) errors.push(at(e, "backup", "Someone can't be their own backup."));
      else if (!b) errors.push(at(e, "backup", `Backup ${p.backup} isn't in the company.`));
      else if (!perms(p).every((x) => perms(b).includes(x))) errors.push(at(e, "backup", `Backup ${p.backup} must have the same permissions (${perms(p).map(permLabel).join(", ")}).`));
      else if (perms(p).includes("approve") && b.approveUpTo != null && p.approveUpTo != null && b.approveUpTo < p.approveUpTo) warnings.push(at(e, "backup", `Backup ${p.backup} has a lower approval limit.`));
    }
  }
  // Reporting cycles (A → B → A).
  for (const p of people) {
    const path = [p.email];
    let m = p.manager;
    while (m && byEmail.has(m) && m !== p.email) {
      if (path.includes(m)) break; // a cycle that doesn't include p; reported from its members
      path.push(m); m = byEmail.get(m).manager;
    }
    if (m === p.email && path.length > 1) errors.push(at(entryOf.get(p.email), "manager", `Reporting loop: ${[...path, m].join(" → ")}.`));
  }
  if (!people.length) errors.push({ row: 0, index: null, email: null, field: null, message: "Include employee rows in the company CSV." });
  const has = (perm) => people.some((p) => perms(p).includes(perm));
  const g = (perm) => `“${permLabel(perm)}”`;
  if (people.length && !has("manage")) errors.push({ row: 0, index: null, email: null, field: "roles", message: `At least one event manager is needed: give someone a role with ${g("manage")} so requests have an owner who can book venues.` });
  if (people.length && !has("approve")) errors.push({ row: 0, index: null, email: null, field: "roles", message: `At least one finance approver is needed: give someone a role with ${g("approve")}; nothing can be booked without one.` });
  if (people.length && !has("request")) warnings.push({ row: 0, index: null, email: null, field: "roles", message: `Nobody has ${g("request")}, so ccPlannie will ignore every new request.` });
  if (people.length && !has("decide")) warnings.push({ row: 0, index: null, email: null, field: "roles", message: `Nobody has ${g("decide")}: no one will be able to change a plan or choose a venue by email.` });
  const uniq = (list) => [...new Map(list.map((x) => [`${x.row}|${x.email}|${x.message}`, x])).values()];
  return { people, errors: uniq(errors), warnings: uniq(warnings) };
}

// Web editor input: a list of person objects. Same validation as the CSV path.
export function readOrgPeople(list, { currency = "CAD", roles = ROLES } = {}) {
  if (!Array.isArray(list)) return { people: [], errors: [{ row: 0, index: null, email: null, field: null, message: "Send the full list of people." }], warnings: [] };
  if (list.length > 5000) return { people: [], errors: [{ row: 0, index: null, email: null, field: null, message: "Too many people for one save (5,000 max)." }], warnings: [] };
  const entries = list.map((raw, index) => ({ ...normalizePerson(raw, { currency }), index }));
  return validatePeople(entries, { currency, roles });
}

// Parse + validate. Never throws for bad content. `roles` is the company's current role set, used when the
// file has no role rows. Returns roles: the file's complete role set, or null if it has no role rows.
export function readOrgCsv(text, { currency = "CAD", roles: currentRoles = ROLES } = {}) {
  const errors = [];
  const rows = parseCsv(text);
  if (!rows.length) return { people: [], roles: null, errors: [{ row: 0, message: "The file is empty." }], warnings: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (n) => header.indexOf(n);
  for (const req of ["name", "email", "roles"]) if (col(req) < 0) errors.push({ row: 1, message: `Missing column "${req}".` });
  if (errors.length) return { people: [], roles: null, errors, warnings: [] };
  const hasPermCol = col("role_permissions") >= 0;

  const entries = [], roleRows = {};
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (n) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const rawId = get("role_id"), label = get("role_label"), summary = get("role_description"), permissions = get("role_permissions");
    if (rawId || label || summary || permissions) {
      const id = slug(rawId || label);
      const prev = currentRoles[id];
      if (["name", "email", "title", "manager_email", "roles", "approval_limit", "backup_email"].some((field) => get(field))) {
        errors.push({ row: line, message: "Put the role definition on its own row, apart from employee details." });
      } else if (!id) {
        errors.push({ row: line, message: "Role rows need a role_id (or at least a role_label)." });
      } else if (Object.hasOwn(roleRows, id)) {
        errors.push({ row: line, message: `Role ${id} is defined more than once.` });
      } else if (!hasPermCol && !prev) {
        errors.push({ row: line, message: `Role ${id} is new: add a role_permissions column (e.g. "request;decide", or "none" to only suggest).` });
      } else {
        // Files without a role_permissions column (older templates) keep each existing role's permissions.
        roleRows[id] = { label: label || prev?.label || rawId, summary: summary || (label ? "" : prev?.summary || ""), permissions: hasPermCol ? permissions : prev.permissions, line };
      }
      return;
    }
    const raw = { name: get("name"), email: get("email"), title: get("title"), manager: get("manager_email"), roles: get("roles"), approveUpTo: get("approval_limit"), backup: get("backup_email") };
    entries.push({ ...normalizePerson(raw, { currency }), line });
  });
  let roles = null;
  if (Object.keys(roleRows).length) {
    const v = validateRoles(roleRows);
    errors.push(...v.errors.map((e) => ({ row: e.row, message: e.message })));
    roles = v.roles;
  }
  const v = validatePeople(entries, { currency, roles: roles || currentRoles });
  const people = entries.map((e) => ({ ...e.person, line: e.line }));
  return { people, roles, errors: [...errors, ...v.errors], warnings: v.warnings };
}

// Every capability a set of roles grants (plus suggesting, which everyone in the company can do).
export function capsFor(roleIds, roles = ROLES) {
  const known = roleIds.filter((r) => roles[r]);
  return known.length ? [...new Set(known.flatMap((r) => capsOfRole(roles[r])))] : [];
}

export function toCsv(people, roles = ROLES) {
  const esc = (v) => (/[",\r\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  const rows = [["name", "email", "title", "manager_email", "roles", "approval_limit", "backup_email", "role_id", "role_label", "role_description", "role_permissions"]];
  for (const p of people) rows.push([p.name, p.email, p.title, p.manager, p.roles.join(";"), p.approveUpTo, p.backup, "", "", "", ""]);
  for (const [id, r] of Object.entries(roles)) rows.push(["", "", "", "", "", "", "", id, r.label, r.summary, r.permissions.join(";") || "none"]);
  return rows.map((row) => row.map(esc).join(",")).join("\n") + "\n";
}
