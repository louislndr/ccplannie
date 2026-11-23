// The event model and every rule that touches money, permissions or commitments. Plain code, no AI.
//
// One canonical event document keeps four kinds of information apart:
//   suggestions          what people are considering (never applied on their own)
//   working              the authorized organizer's current intended plan
//   approved             versioned scope + spending finance actually approved (exact terms)
//   commitment           what a supplier actually confirmed (simulated backend)
// Every operation records provenance in ev.history.
import { createHash } from "node:crypto";
import { COMPANY, POLICY, CONFIG, can, person, displayName, firstName, defaultApprover, aliasOf, samePerson } from "./config.mjs";
import { SUPPLIERS } from "./supplier-sim.mjs";

export const FIELDS = ["headcount", "date", "nights", "roomPolicy", "region", "budget"];
const SCOPE_FIELDS = ["headcount", "date", "nights", "roomPolicy"]; // fields that make a quote stale
const REQUIRED_FOR_SOURCING = ["headcount", "date", "nights", "roomPolicy"];
export const LABEL = { headcount: "Headcount", date: "Date", nights: "Nights", roomPolicy: "Rooms", region: "Area", budget: "Requested budget" };

export const money = (n, cur = COMPANY.currency) => (n == null ? "unknown" : `${cur} ${Math.round(n).toLocaleString("en-US")}`);
export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
export function fmtField(f, v) {
  if (v == null) return "—";
  if (f === "budget") return money(v);
  if (f === "date") return fmtDate(v);
  if (f === "roomPolicy") return v === "one_per_attendee" ? "one room per attendee" : String(v);
  if (f === "nights") return `${v} night${v > 1 ? "s" : ""}`;
  if (f === "headcount") return `${v} people`;
  return String(v);
}
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());
export const termsHash = (t) => createHash("sha256").update(stable(t)).digest("hex").slice(0, 16);
const daysBetween = (fromIso, toDate) => Math.round((Date.parse(toDate + "T00:00:00Z") - Date.parse(fromIso.slice(0, 10) + "T00:00:00Z")) / 86400000);

// ---------------------------------------------------------------- creation

export function newEvent({ id, address, requestedBy, subject, at, participants }) {
  return {
    id, address, title: subject?.replace(/^(re|fwd?):\s*/gi, "") || "Offsite",
    createdAt: at, requestedBy, participants: [...new Set(participants)],
    owner: null, ownerAcceptedAt: null, paused: false,
    working: { headcount: null, date: null, nights: null, roomPolicy: null, region: null, budget: null },
    workingSource: {},
    suggestions: [], proposals: [], comparisons: [], selection: null, revisionRequests: [],
    approvals: [], approved: null, approvedHistory: [],
    supplierRequests: [], supplierFacts: {},
    commitment: null, commitmentHistory: [], contracts: {},
    reviewQueue: [], history: [],
  };
}

// ctx collects what should be said and sent as a result of one operation.
export function newCtx(store, now, actor) {
  return { store, now, actor, say: [], supplierOut: [], approvalOut: [], tasks: [] };
}
const sayTo = (ctx, audience, text, meta = {}) => ctx.say.push({ audience, text, meta });
function hist(ev, ctx, action, summary, source = {}, extra = {}) {
  ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: ctx.actor, action, summary, source, configVersion: CONFIG.version, ...(ctx.via ? { via: ctx.via } : {}), ...extra });
}

// ---------------------------------------------------------------- derived views

export function roomsFor(plan) {
  if (plan.roomPolicy === "one_per_attendee" && plan.headcount) return plan.headcount;
  return plan.rooms ?? null;
}

export function views(ev) {
  const w = ev.working;
  // The working amount is the selected offer's price only while that offer still matches the plan; otherwise it's unknown.
  const sel = ev.selection ? proposal(ev, ev.selection.proposalId) : null;
  const selValid = sel && !isStale(ev, sel);
  const working = { headcount: w.headcount, date: w.date, nights: w.nights, rooms: roomsFor(w), amount: selValid ? sel.amount : null, cap: null, supplier: sel ? supplierName(sel.supplierId) : null, budget: w.budget };
  const a = ev.approved;
  const approved = a ? { headcount: a.terms.headcount, date: a.terms.date, nights: a.terms.nights, rooms: a.terms.rooms, amount: a.terms.amount, cap: a.cap, supplier: supplierName(a.terms.supplierId), ref: a.approvalId } : null;
  const c = ev.commitment;
  const committed = c ? { headcount: c.terms.headcount, date: c.terms.date, nights: c.terms.nights, rooms: c.terms.rooms, amount: c.amount, supplier: supplierName(c.supplierId), ref: c.bookingRef } : null;
  const drift = [];
  for (const f of ["headcount", "date", "nights", "rooms", "amount"]) {
    const vals = [working[f], approved?.[f], committed?.[f]].filter((v) => v != null);
    if (new Set(vals).size > 1) drift.push(f);
  }
  return { working, approved, committed, drift };
}

export const proposal = (ev, id) => ev.proposals.find((p) => p.id === id) || null;
export const supplierName = (id) => SUPPLIERS[id]?.name || id || null;

export function isStale(ev, p) {
  if (!p) return true;
  const w = ev.working;
  return p.terms.headcount !== w.headcount || p.terms.date !== w.date || p.terms.nights !== w.nights || (roomsFor(w) != null && p.terms.rooms !== roomsFor(w));
}

export function status(ev) {
  if (ev.paused) return { code: "paused", label: "Paused" };
  if (!ev.owner) return { code: "received", label: "Request received" };
  const pendingBinding = ev.supplierRequests.find((r) => (r.type === "booking" || r.type === "amendment") && r.status === "sent");
  if (pendingBinding) return { code: "supplier_pending", label: "Waiting on Planned to confirm" };
  const v = views(ev);
  if (ev.commitment && v.drift.length === 0) return { code: "confirmed", label: "Confirmed" };
  if (ev.approvals.some((a) => a.status === "pending")) return { code: "approval_needed", label: "Approval needed" };
  if (ev.approved && ev.selection && ev.approved.terms.proposalId === ev.selection.proposalId && !isCommittedTo(ev, ev.selection.proposalId)) return ev.commitment ? { code: "approved_internal", label: "Change approved · not yet confirmed by venue" } : { code: "approved_internal", label: "Approved internally · not booked" };
  if (ev.commitment && v.drift.length) return { code: "change_in_progress", label: "Change in progress" };
  if (ev.supplierRequests.some((r) => r.status === "sent" || (r.type === "quote" && r.status === "queued"))) return { code: "sourcing", label: "Sourcing in progress" };
  if (ev.comparisons.length) return { code: "options", label: "Options shared" };
  return { code: "assigned", label: "Manager assigned" };
}
const isCommittedTo = (ev, pid) => {
  if (!ev.commitment) return false;
  const p = proposal(ev, pid);
  return !!p && ev.commitment.terms.date === p.terms.date && ev.commitment.terms.headcount === p.terms.headcount && ev.commitment.amount === p.amount;
};

// Consequences of the current working plan, each labeled with how much we actually know.
export function impacts(ev, now, plan = ev.working) {
  const out = [];
  const add = (kind, text, basis, severity = "warn") => out.push({ kind, text, basis, severity });
  const hc = plan.headcount;
  const relevant = (sid) => !ev.commitment || ev.commitment.supplierId === sid; // once booked, other venues are no longer in play
  for (const [sid, f] of Object.entries(ev.supplierFacts)) {
    if (relevant(sid) && hc && f.capacity && hc > f.capacity) add("capacity", `${supplierName(sid)} holds at most ${f.capacity}; it can't host ${hc}.`, "confirmed by supplier");
  }
  const live = ev.proposals.filter((p) => p.status === "current");
  const stale = live.filter((p) => relevant(p.supplierId) && !isCommittedTo(ev, p.id) && isStale({ ...ev, working: plan }, p));
  if (stale.length) add("stale", `${stale.length === 1 ? "The quote" : `${stale.length} quotes`} from ${stale.map((p) => supplierName(p.supplierId)).join(", ")} ${stale.length === 1 ? "was" : "were"} for ${[...new Set(stale.map((p) => p.terms.headcount))].join("/")} people on ${[...new Set(stale.map((p) => fmtDate(p.terms.date)))].join("/")}; ${stale.length === 1 ? "it needs" : "they need"} reconfirming.`, "fact");
  const sel = ev.selection && proposal(ev, ev.selection.proposalId);
  const cap = ev.approved?.cap ?? null;
  if (sel && sel.amount != null && !isStale({ ...ev, working: plan }, sel)) {
    if (cap != null && sel.amount > cap) add("over_cap", `${money(sel.amount)} is ${money(sel.amount - cap)} above the approved cap of ${money(cap)}.`, "confirmed offer");
    else if (cap == null && plan.budget != null && sel.amount > plan.budget) add("over_budget", `${money(sel.amount)} is ${money(sel.amount - plan.budget)} above the requested budget of ${money(plan.budget)} (nothing approved yet).`, "confirmed offer");
  }
  const c = ev.commitment;
  if (c) {
    if (plan.date && plan.date !== c.terms.date) {
      const contract = ev.contracts[c.contractId];
      const rule = contract?.rules.find((r) => r.type === "date_change_fee");
      if (!rule) add("fee_unknown", `Moving from ${fmtDate(c.terms.date)} may carry a fee, but no reviewed date-change rule is on file, so the cost is unknown (not zero).`, "unknown");
      else {
        const days = daysBetween(now, c.terms.date);
        const applies = days > rule.minDaysBeforeArrival;
        const label = rule.reviewed ? `reviewed by ${displayName(rule.reviewedBy)}` : "extracted automatically, NOT yet reviewed";
        add("fee", applies
          ? `Contract §${rule.ref} (${label}): a ${money(rule.amount)} date-change fee applies, because the change is ${days} days before arrival (more than ${rule.minDaysBeforeArrival}).`
          : `Contract §${rule.ref} (${label}): within ${rule.minDaysBeforeArrival} days of arrival a date change counts as a cancellation (clause 10) — cost not computed here.`, rule.reviewed ? "verified rule" : "unreviewed rule");
      }
      const offer = live.find((p) => p.supplierId === c.supplierId && p.terms.date === plan.date && !isStale({ ...ev, working: plan }, p));
      if (!offer) add("availability", `${supplierName(c.supplierId)} hasn't confirmed availability or pricing for ${fmtDate(plan.date)}.`, "unknown");
    }
    if (plan.headcount && plan.headcount !== c.terms.headcount) add("amend", `Changing headcount from the booked ${c.terms.headcount} needs a revised offer; the price for ${plan.headcount} is unknown until ${supplierName(c.supplierId)} quotes it.`, "unknown");
  }
  return out;
}

// ---------------------------------------------------------------- working plan, suggestions

function setWorking(ev, ctx, field, value, by, source, how) {
  const old = ev.working[field];
  ev.working[field] = value;
  ev.workingSource[field] = { by, at: ctx.now, msgId: source.msgId || null, quote: source.quote || null, how };
  hist(ev, ctx, "working.update", old == null ? `${LABEL[field]} set to ${fmtField(field, value)}` : `${LABEL[field]}: ${fmtField(field, old)} → ${fmtField(field, value)}`, source, { field, by });
}

// Fill in missing details. Never overwrites existing accepted values.
export function provideDetails(ev, ctx, sender, fields, source, { fromQuotedHistory = false } = {}) {
  const applied = [], conflicts = [];
  for (const [f, v] of Object.entries(fields)) {
    if (!FIELDS.includes(f) || v == null) continue;
    if (ev.working[f] == null) {
      if (!can(sender, "plan.provide_details") && !can(sender, "plan.change_scope")) { addSuggestion(ev, ctx, sender, { [f]: v }, source, "suggestion"); continue; }
      setWorking(ev, ctx, f, v, sender, source, fromQuotedHistory ? "from forwarded history" : "provided");
      applied.push(f);
    } else if (ev.working[f] !== v) {
      if (fromQuotedHistory) { conflicts.push(f); hist(ev, ctx, "history.ignored", `Older forwarded text says ${LABEL[f]} = ${fmtField(f, v)}; kept current ${fmtField(f, ev.working[f])}`, source); }
      else conflicts.push(f);
    }
  }
  return { applied, conflicts };
}

// An instruction to change scope. Applied only for people with plan.change_scope; otherwise a suggestion.
export function changeScope(ev, ctx, sender, fields, source) {
  if (!can(sender, "plan.change_scope")) return { suggestion: addSuggestion(ev, ctx, sender, fields, source, "suggestion") };
  const changed = [];
  for (const [f, v] of Object.entries(fields)) {
    if (!FIELDS.includes(f) || v == null || ev.working[f] === v) continue;
    setWorking(ev, ctx, f, v, sender, source, "changed");
    changed.push(f);
  }
  if (changed.length) afterWorkingChange(ev, ctx, changed, source);
  return { changed };
}

export function addSuggestion(ev, ctx, sender, fields, source, kind = "suggestion") {
  const s = { id: ctx.store.nextId("S"), kind, by: sender, fields, quote: source.quote || null, msgId: source.msgId || null, at: ctx.now, status: "open" };
  ev.suggestions.push(s);
  hist(ev, ctx, kind === "scenario" ? "scenario.asked" : "suggestion.recorded", `${displayName(sender)} ${kind === "scenario" ? "asked about" : "suggested"} ${Object.entries(fields).map(([f, v]) => `${LABEL[f]} ${fmtField(f, v)}`).join(", ")} (not applied)`, source);
  return s;
}

export function adoptSuggestion(ev, ctx, sender, suggestionId, source) {
  const s = ev.suggestions.find((x) => x.id === suggestionId);
  if (!s || s.status !== "open") return { error: "no-open-suggestion" };
  if (!can(sender, "plan.change_scope")) return { error: "not-authorized" };
  s.status = "adopted"; s.adoptedBy = sender; s.adoptedAt = ctx.now;
  hist(ev, ctx, "suggestion.adopted", `${displayName(sender)} confirmed ${s.id}`, source);
  const r = changeScope(ev, ctx, sender, s.fields, source);
  return { ...r, suggestion: s };
}

// After the working plan changes: mark stale quotes, reopen affected pending approvals, and
// (if Alex delegated it) request revised, NON-BINDING offers from suppliers that can host.
export function afterWorkingChange(ev, ctx, changed, source) {
  const material = changed.filter((f) => SCOPE_FIELDS.includes(f));
  if (!material.length) return;
  ctx.staled = ctx.staled || [];
  for (const p of ev.proposals.filter((p) => p.status === "current" && isStale(ev, p))) {
    p.status = "stale"; p.staleSince = ctx.now;
    if (!isCommittedTo(ev, p.id)) ctx.staled.push(p.id);
  }
  for (const a of ev.approvals.filter((a) => a.status === "pending")) {
    const p = proposal(ev, a.terms.proposalId);
    if (!p || isStale(ev, p)) { a.status = "superseded"; a.supersededAt = ctx.now; a.supersededReason = "working plan changed"; hist(ev, ctx, "approval.superseded", `${a.id} reopened: the plan it covered changed`, source); }
  }
  if (ev.selection && isStale(ev, proposal(ev, ev.selection.proposalId))) {
    hist(ev, ctx, "selection.stale", `Selected ${supplierName(proposal(ev, ev.selection.proposalId)?.supplierId)} quote no longer matches the plan`, source);
  }
  if (!ev.owner || ev.paused) return;
  if (!REQUIRED_FOR_SOURCING.every((f) => ev.working[f] != null)) return;
  if (!POLICY.delegatedInquiries) {
    ctx.notDelegated = true;
    hist(ev, ctx, "inquiry.not_delegated", `No automatic supplier inquiry: company policy (v${CONFIG.version}) has delegated inquiries off. ${displayName(ev.owner)} can request quotes manually.`, source);
    return;
  }
  if (!can(ev.owner, "supplier.inquire")) {
    ctx.notDelegated = true;
    hist(ev, ctx, "inquiry.not_delegated", `No automatic supplier inquiry: ${displayName(ev.owner)} no longer holds supplier-inquiry powers.`, source);
    return;
  }
  if (ev.commitment) {
    sendSupplierRequest(ev, ctx, ev.commitment.supplierId, "quote", { delegated: true, bookingRef: ev.commitment.bookingRef });
  } else {
    const asked = [...new Set(ev.supplierRequests.map((r) => r.supplierId))];
    const feasible = asked.filter((sid) => { const c = ev.supplierFacts[sid]?.capacity; return !(c && ev.working.headcount > c); });
    const round = ctx.store.nextId("RND");
    for (const sid of feasible) sendSupplierRequest(ev, ctx, sid, "quote", { delegated: true, round });
  }
}

// ---------------------------------------------------------------- manager actions

export const isOwner = (ev, actor) => !!ev.owner && samePerson(ev.owner, actor);
function requireOwner(ev, actor, what) {
  if (!ev.owner) throw new PrereqError(`Nobody has accepted this request yet; the routed manager must accept ownership before they can ${what}.`);
  if (!isOwner(ev, actor)) throw new AuthError(`Only ${displayName(ev.owner)}, who owns this request, can ${what}.`);
}

export function acceptOwnership(ev, ctx, actor) {
  if (!can(actor, "event.own")) throw new AuthError(`${displayName(actor)} can't own events`);
  if (ev.owner && isOwner(ev, actor)) return { already: true };
  if (ev.owner) throw new AuthError(`${displayName(ev.owner)} already owns this request. An administrator can reassign it.`);
  if (ev.routedTo && !samePerson(ev.routedTo, actor)) throw new AuthError(`This request is routed to ${displayName(ev.routedTo)}. An administrator can reroute it to ${displayName(actor)}.`);
  ev.owner = actor; ev.ownerAcceptedAt = ctx.now;
  hist(ev, ctx, "owner.accepted", `${displayName(actor)} accepted ownership`);
  sayTo(ctx, "thread", `${displayName(actor)} on the event team has taken this on and is managing sourcing with Planned. You can keep replying here.`);
  return {};
}

export function requestQuotes(ev, ctx, actor, supplierIds) {
  if (!can(actor, "supplier.inquire")) throw new AuthError(`${displayName(actor)} isn't allowed to contact suppliers`);
  requireOwner(ev, actor, "request quotes");
  if (ev.paused) throw new PrereqError("Event is paused");
  const missing = REQUIRED_FOR_SOURCING.filter((f) => ev.working[f] == null);
  if (missing.length) throw new PrereqError(`Missing before sourcing: ${missing.map((f) => LABEL[f]).join(", ")}`);
  const ids = [...new Set(supplierIds)].filter((sid) => SUPPLIERS[sid]);
  if (!ids.length) throw new PrereqError("Choose at least one supplier");
  if (ev.supplierRequests.some((r) => r.type === "quote" && ids.includes(r.supplierId) && (r.status === "sent" || r.status === "queued"))) throw new PrereqError("A quote request to that supplier is still waiting for a reply");
  if (ev.commitment) {
    // Booked: a manual inquiry asks the booked venue about the current plan. It changes nothing.
    if (!ids.includes(ev.commitment.supplierId)) throw new PrereqError(`After booking, inquiries go to ${supplierName(ev.commitment.supplierId)}`);
    sendSupplierRequest(ev, ctx, ev.commitment.supplierId, "quote", { delegated: false, bookingRef: ev.commitment.bookingRef });
  } else {
    const round = ctx.store.nextId("RND");
    for (const sid of ids) sendSupplierRequest(ev, ctx, sid, "quote", { round, delegated: false });
  }
  hist(ev, ctx, "sourcing.requested", `${displayName(actor)} requested ${ev.commitment ? "an availability and price inquiry" : "quotes"} from ${(ev.commitment ? [ev.commitment.supplierId] : ids).map(supplierName).join(", ")} (manual, non-binding)`);
  return {};
}

export function sendSupplierRequest(ev, ctx, supplierId, type, { round = null, delegated = false, bookingRef = null, amount = null, proposalId = null, approvalId = null } = {}) {
  const w = ev.working;
  const req = {
    id: ctx.store.nextId("Q"), type, supplierId, round, delegated, status: "queued", at: ctx.now,
    fields: { date: w.date, nights: w.nights, headcount: w.headcount, rooms: roomsFor(w), bookingRef, amount }, proposalId, approvalId,
    authorizedBy: type === "booking" || type === "amendment" ? ctx.actor : null, configVersion: CONFIG.version,
  };
  if (type === "booking" || type === "amendment") {
    const p = proposal(ev, proposalId);
    Object.assign(req.fields, { date: p.terms.date, nights: p.terms.nights, headcount: p.terms.headcount, rooms: p.terms.rooms, amount: p.amount });
  }
  ev.supplierRequests.push(req);
  ctx.supplierOut.push(req.id);
  hist(ev, ctx, `supplier.${type}`, `${type === "quote" ? (bookingRef ? "Asked for availability and a revised offer (no change accepted)" : "Requested a quote") : type === "booking" ? "Sent booking request" : "Sent amendment request"} to ${supplierName(supplierId)}${delegated ? " (delegated inquiry)" : ""}`, {}, { requestId: req.id });
  return req;
}

export function authorizeSupplierAction(ev, ctx, actor) {
  if (!can(actor, "supplier.authorize")) throw new AuthError(`${displayName(actor)} can't authorize supplier commitments`);
  requireOwner(ev, actor, "authorize supplier actions");
  if (ev.paused) throw new PrereqError("Event is paused");
  const sel = ev.selection && proposal(ev, ev.selection.proposalId);
  if (!sel) throw new PrereqError("No option selected");
  if (sel.status !== "current" || isStale(ev, sel)) throw new PrereqError("The selected offer doesn't match the current plan");
  if (sel.amount == null) throw new PrereqError("The selected offer has no confirmed price");
  const a = ev.approved;
  if (!a || a.terms.proposalId !== sel.id || a.hash !== termsHash(approvalTerms(ev, sel))) throw new PrereqError("Finance hasn't approved these exact terms");
  if (ev.supplierRequests.some((r) => (r.type === "booking" || r.type === "amendment") && r.status === "sent")) throw new PrereqError("A booking request is already waiting for the supplier");
  let type = "booking", bookingRef = null;
  if (ev.commitment) {
    if (ev.commitment.supplierId !== sel.supplierId) throw new PrereqError("Switching suppliers after booking isn't supported in this prototype");
    if (isCommittedTo(ev, sel.id)) throw new PrereqError("Already confirmed");
    type = "amendment"; bookingRef = ev.commitment.bookingRef;
  }
  const req = sendSupplierRequest(ev, ctx, sel.supplierId, type, { bookingRef, proposalId: sel.id, approvalId: a.approvalId });
  req.fields.bookingRef = bookingRef;
  return { request: req };
}

export function reviewClause(ev, ctx, actor, contractId, ruleRef, { accept = true, note = "" } = {}) {
  if (!can(actor, "clause.review")) throw new AuthError(`${displayName(actor)} isn't allowed to review contract rules`);
  requireOwner(ev, actor, "review contract clauses");
  const rule = ev.contracts[contractId]?.rules.find((r) => r.ref === ruleRef);
  if (!rule) throw new PrereqError("No such rule");
  rule.reviewed = accept; rule.reviewedBy = actor; rule.reviewedAt = ctx.now; rule.reviewNote = note;
  hist(ev, ctx, "contract.reviewed", `${displayName(actor)} ${accept ? "verified" : "rejected"} contract rule §${ruleRef} (${money(rule.amount)} date-change fee, > ${rule.minDaysBeforeArrival} days before arrival)`, { contractId, page: rule.page, quote: rule.excerpt });
  return {};
}

// An off-email decision (e.g. on a call), entered by the manager with explicit provenance.
export function manualDecision(ev, ctx, actor, { decidedBy, fields = {}, note, channel = "phone call" }) {
  if (!can(actor, "decision.manual")) throw new AuthError(`${displayName(actor)} isn't allowed to record decisions`);
  requireOwner(ev, actor, "record decisions");
  if (!person(decidedBy)) throw new PrereqError(`${decidedBy} isn't in the company`);
  const source = { manual: true, recordedBy: actor, decidedBy, channel, quote: note };
  hist(ev, ctx, "decision.manual", `${displayName(actor)} recorded a decision by ${displayName(decidedBy)} (${channel}): ${note}`, source);
  if (Object.keys(fields).length) {
    if (!can(decidedBy, "plan.change_scope")) { addSuggestion(ev, ctx, decidedBy, fields, source); return { suggestion: true }; }
    const saved = ctx.actor; ctx.actor = decidedBy;
    changeScope(ev, ctx, decidedBy, fields, source);
    ctx.actor = saved;
  }
  return {};
}

export function setPaused(ev, ctx, actor, paused) {
  if (!can(actor, "event.own")) throw new AuthError(`${displayName(actor)} isn't an event manager`);
  requireOwner(ev, actor, paused ? "pause ccPlannie" : "resume ccPlannie");
  if (ev.paused === paused) throw new PrereqError(paused ? "Already paused" : "Not paused");
  ev.paused = paused; ev.pausedBy = paused ? actor : null; ev.pausedAt = paused ? ctx.now : null;
  hist(ev, ctx, paused ? "paused" : "resumed", `${displayName(actor)} ${paused ? "paused" : "resumed"} ccPlannie on this event`);
}

export function renameEvent(ev, ctx, actor, title) {
  if (!can(actor, "event.own")) throw new AuthError("not allowed");
  requireOwner(ev, actor, "rename the request");
  hist(ev, ctx, "cosmetic", `Title: ${ev.title} → ${title}`);
  ev.title = title; // cosmetic: no approvals reopen
}

// Administrator routing. Routing never authorizes anything: the manager must accept ownership.
// Reassigning an owned request releases the current owner (kept in ev.ownerHistory); past decisions stay.
export function routeRequest(ev, ctx, admin, manager) {
  if (!can(manager, "event.own")) throw new PrereqError(`${displayName(manager)} isn't an event manager`);
  if (ev.owner && isOwner(ev, manager)) throw new PrereqError(`${displayName(manager)} already owns this request`);
  if (!ev.owner && ev.routedTo && samePerson(ev.routedTo, manager)) throw new PrereqError(`Already routed to ${displayName(manager)}`);
  const before = { routedTo: ev.routedTo || null, owner: ev.owner || null };
  ev.ownerHistory = ev.ownerHistory || [];
  if (ev.owner) ev.ownerHistory.push({ owner: ev.owner, acceptedAt: ev.ownerAcceptedAt, releasedAt: ctx.now, releasedBy: admin.id, reason: `reassigned to ${manager}` });
  ev.routedTo = manager; ev.owner = null; ev.ownerAcceptedAt = null;
  hist(ev, ctx, before.owner ? "routing.reassigned" : "routing.changed", before.owner
    ? `${admin.label} reassigned the request from ${displayName(before.owner)} to ${displayName(manager)} (not yet accepted). Earlier decisions stay on record.`
    : `${admin.label} routed the request to ${displayName(manager)}${before.routedTo ? ` (was ${displayName(before.routedTo)})` : ""}; not yet accepted`, { admin: admin.id });
  return { before, after: { routedTo: manager, owner: null } };
}

// ---------------------------------------------------------------- supplier replies

export function supplierReply(ev, ctx, supplierId, block, source) {
  const req = ev.supplierRequests.find((r) => r.id === block["request-ref"] && r.supplierId === supplierId);
  if (!req) { flag(ev, ctx, `${supplierName(supplierId)} replied without a request reference we recognize`, source); return; }
  if (req.status === "confirmed" || req.status === "responded") { hist(ev, ctx, "supplier.duplicate", `Ignored a repeat reply for ${req.id}`, source); return; }
  const type = block.type;
  if (block.capacity) ev.supplierFacts[supplierId] = { capacity: +block.capacity, source: source.msgId };

  if (type === "offer" || type === "amendment-offer" || type === "available-price-unknown") {
    req.status = "responded"; req.respondedAt = ctx.now;
    // New offer from this supplier replaces their older offers.
    for (const old of ev.proposals.filter((p) => p.supplierId === supplierId && p.status === "current")) old.status = "superseded";
    const p = {
      id: ctx.store.nextId("P"), supplierId, requestId: req.id, offerRef: block["offer-ref"] || null,
      terms: { headcount: +block.headcount || req.fields.headcount, date: block.date, nights: +block.nights || req.fields.nights, rooms: +block.rooms || req.fields.rooms },
      amount: type === "available-price-unknown" ? null : +block.amount, currency: block.currency || COMPANY.currency,
      includesFee: +block["includes-fee"] || 0, kind: type === "amendment-offer" ? "amendment" : "new", bookingRef: block["booking-ref"] || null,
      capacity: block.capacity ? +block.capacity : null, status: "current", basis: type === "available-price-unknown" ? "available, price unknown" : "confirmed offer (simulated supplier)",
      receivedAt: ctx.now, msgId: source.msgId,
    };
    ev.proposals.push(p);
    hist(ev, ctx, "offer.received", `${supplierName(supplierId)} offered ${p.terms.headcount} people on ${fmtDate(p.terms.date)}: ${money(p.amount)}${p.includesFee ? ` (incl. ${money(p.includesFee)} date-change fee)` : ""}`, source, { proposalId: p.id });
    maybeShareOffers(ev, ctx, req);
  } else if (type === "cannot-quote" || type === "unavailable") {
    req.status = "responded"; req.respondedAt = ctx.now; req.outcome = type;
    hist(ev, ctx, "offer.none", `${supplierName(supplierId)}: ${type === "unavailable" ? `not available on ${fmtDate(block.date)}` : `can't quote (${block.reason || "no reason given"})`}`, source);
    maybeShareOffers(ev, ctx, req);
  } else if (type === "booking-confirmed" || type === "amendment-confirmed") {
    if (req.type !== (type === "booking-confirmed" ? "booking" : "amendment") || req.status !== "sent") { flag(ev, ctx, `Unexpected confirmation from ${supplierName(supplierId)} for ${req.id}`, source); return; }
    const confirmed = { headcount: +block.headcount, date: block.date, nights: +block.nights, rooms: +block.rooms };
    const f = req.fields;
    if (confirmed.headcount !== f.headcount || confirmed.date !== f.date || confirmed.nights !== f.nights || +block.amount !== f.amount) {
      flag(ev, ctx, `${supplierName(supplierId)} confirmed terms that differ from what was authorized; commitment NOT updated`, source);
      return;
    }
    req.status = "confirmed"; req.respondedAt = ctx.now;
    if (ev.commitment) ev.commitmentHistory.push(ev.commitment);
    ev.commitment = { supplierId, bookingRef: block["booking-ref"], terms: confirmed, amount: +block.amount, includesFee: +block["includes-fee"] || 0, contractId: block.contract || ev.commitment?.contractId || null, confirmedAt: ctx.now, msgId: source.msgId, requestId: req.id, authorizedBy: req.authorizedBy, approvalId: req.approvalId };
    hist(ev, ctx, type === "booking-confirmed" ? "commitment.confirmed" : "commitment.amended", `${supplierName(supplierId)} confirmed ${block["booking-ref"]}: ${confirmed.headcount} people, ${fmtDate(confirmed.date)}, ${money(+block.amount)} (authorized by ${displayName(req.authorizedBy)}, approval ${req.approvalId})`, source);
    const v = views(ev);
    sayTo(ctx, "thread", type === "booking-confirmed"
      ? `**Booked through Planned: ${supplierName(supplierId)}** (booking ${block["booking-ref"]}): ${confirmed.headcount} people, ${fmtField("nights", confirmed.nights)} on ${fmtDate(confirmed.date)}, ${money(+block.amount)} all-in.`
      : `**Change confirmed through Planned:** ${supplierName(supplierId)}, booking ${block["booking-ref"]}, is now ${fmtDate(confirmed.date)}, ${confirmed.headcount} people, ${money(+block.amount)}${+block["includes-fee"] ? ` (incl. the ${money(+block["includes-fee"])} date-change fee)` : ""}.${v.drift.length ? "" : " Your plan, finance approval and booking now all match."}`, { kind: "confirmation" });
  } else if (type === "declined") {
    req.status = "declined"; req.respondedAt = ctx.now; req.outcome = block.reason || "declined";
    flag(ev, ctx, `${supplierName(supplierId)} declined ${req.id} (${block.reason || "no reason"}); nothing changed`, source);
  }
  if (req.respondedAt === ctx.now) {
    for (const item of ev.reviewQueue.filter((entry) => entry.open &&
      (entry.source?.timedOutRequestId === req.id || entry.text.startsWith(`${supplierName(supplierId)} hasn't answered ${req.id} (`)))) {
      item.open = false;
      item.resolvedAt = ctx.now;
      item.resolvedBy = ctx.actor;
      item.resolution = "Venue reply received";
    }
  }
}

export function attachContract(ev, ctx, contract, source) {
  ev.contracts[contract.id] = contract;
  for (const r of contract.rules) hist(ev, ctx, "contract.extracted", `Extracted §${r.ref}: ${money(r.amount)} date-change fee if moved > ${r.minDaysBeforeArrival} days before arrival — needs review`, { ...source, page: r.page, quote: r.excerpt });
  if (contract.unreadable?.length) flag(ev, ctx, `Couldn't read ${contract.unreadable.join(", ")}; related terms stay unresolved`, source);
}

function maybeShareOffers(ev, ctx, req) {
  const roundReqs = ev.supplierRequests.filter((r) => r.type === "quote" && (req.round ? r.round === req.round : r.id === req.id));
  if (roundReqs.some((r) => r.status === "sent" || r.status === "queued")) return;
  if (!POLICY.autoShareComparisons) { ctx.tasks.push("share-comparison"); return; }
  const ids = roundReqs.map((r) => ev.proposals.find((p) => p.requestId === r.id && p.status === "current")).filter(Boolean).map((p) => p.id);
  shareComparison(ev, ctx, ids, roundReqs);
}

export function shareComparison(ev, ctx, proposalIds, roundReqs = []) {
  const options = proposalIds.map((id) => proposal(ev, id));
  const cmp = { id: ctx.store.nextId("C"), options: proposalIds, at: ctx.now };
  ev.comparisons.push(cmp);
  const none = roundReqs.filter((r) => r.outcome).map((r) => `${supplierName(r.supplierId)} ${r.outcome === "unavailable" ? "isn't available" : "couldn't quote"}`);
  const cap = ev.approved?.cap, budget = ev.working.budget;
  const amendment = ev.commitment && options.some((o) => o.kind === "amendment");
  let intro;
  if (amendment) {
    const o = options[0];
    const delta = o.amount - ev.commitment.amount;
    intro = `${supplierName(o.supplierId)} can do ${fmtDate(o.terms.date)}: **${money(o.amount)} all-in**${o.includesFee ? ` (incl. the ${money(o.includesFee)} date-change fee)` : ""}. That's ${money(delta)} more than the current booking${cap != null && o.amount > cap ? ` and ${money(o.amount - cap)} over the approved ${money(cap)} cap` : ""}.\nNothing has changed with the venue yet: your booking is still ${fmtDate(ev.commitment.terms.date)}. ${sponsorOf(ev) ? firstName(sponsorOf(ev)) + ", reply" : "Reply"} if you want to go ahead at this price; finance approval comes after that.`;
  } else {
    const ref = cap ?? budget;
    intro = `Here ${options.length === 1 ? "is the offer" : `are ${options.length} offers`} for ${ev.working.headcount} people, ${fmtField("nights", ev.working.nights)} on ${fmtDate(ev.working.date)}${none.length ? ` (${none.join("; ")})` : ""}. Prices are the venues' quotes, not bookings.\n\n` +
      options.map((o, i) => `${i + 1}. **${supplierName(o.supplierId)}** (${SUPPLIERS[o.supplierId]?.city}) — ${money(o.amount)}, up to ${o.capacity ?? "?"} guests [${o.id}]${ref != null && o.amount > ref ? ` · ${money(o.amount - ref)} over the ${cap != null ? "approved cap" : "requested budget"}` : ""}`).join("\n");
  }
  hist(ev, ctx, "comparison.shared", `Shared ${cmp.id} with the requesters: ${options.map((o) => `${supplierName(o.supplierId)} ${money(o.amount)}`).join(", ")}`);
  sayTo(ctx, "thread", intro, { kind: "comparison", comparisonId: cmp.id, options: options.map((o, i) => ({ n: i + 1, id: o.id, supplier: supplierName(o.supplierId), city: SUPPLIERS[o.supplierId]?.city, amount: o.amount, capacity: o.capacity, date: o.terms.date, headcount: o.terms.headcount, overBudget: (cap ?? budget) != null && o.amount > (cap ?? budget), includesFee: o.includesFee })) , footer: amendment ? null : `Reply with the one you prefer (e.g. "the second one").${budget && !cap ? ` Budget so far is a request (${money(budget)}), not a finance approval.` : ""}` });
  return cmp;
}

function flag(ev, ctx, text, source) {
  ev.reviewQueue.push({ id: ctx.store.nextId("F"), at: ctx.now, text, source, open: true });
  hist(ev, ctx, "review.flagged", text, source);
}
export const flagForReview = flag;

// ---------------------------------------------------------------- selection and approvals

export function selectOption(ev, ctx, sender, proposalId, source) {
  const p = proposal(ev, proposalId);
  if (!can(sender, "option.select")) {
    hist(ev, ctx, "preference.recorded", `${displayName(sender)} prefers ${supplierName(p?.supplierId)} (not a selection: no authority)`, source);
    return { error: "not-authorized", proposal: p };
  }
  if (!p) return { error: "unknown-option" };
  if (p.status !== "current" || isStale(ev, p)) return { error: "stale", proposal: p };
  ev.selection = { proposalId: p.id, by: sender, at: ctx.now, msgId: source.msgId };
  hist(ev, ctx, "option.selected", `${displayName(sender)} chose ${supplierName(p.supplierId)} (${p.id}, ${money(p.amount)})`, source);
  const appr = ensureApproval(ev, ctx, source);
  return { proposal: p, approval: appr };
}

export function approvalTerms(ev, p) {
  return {
    eventId: ev.id, supplierId: p.supplierId, proposalId: p.id, offerRef: p.offerRef || "",
    date: p.terms.date, timezone: COMPANY.timezone, headcount: p.terms.headcount, rooms: p.terms.rooms, nights: p.terms.nights,
    currency: p.currency, amount: p.amount, conditions: p.includesFee ? `includes ${money(p.includesFee)} date-change fee` : "",
    action: ev.commitment ? `amend booking ${ev.commitment.bookingRef}` : "commit spending for a new booking",
  };
}
// The configured default finance approver. A real mailbox mapped onto that person (server-side alias, live
// email) is used for delivery; otherwise the directory address.
// An "escalate" step sends amounts above its threshold straight to its approver (highest matching threshold wins).
const assignedApprover = (amount = null) => {
  const tier = amount == null ? null : (POLICY.flow || []).filter((s) => s.kind === "escalate" && amount > s.over && person(s.who)).sort((a, b) => b.over - a.over)[0];
  const base = tier?.who || defaultApprover();
  return base ? aliasOf(base) || base : null;
};

// Why a pending approval can't currently be granted. Derived from live authority, never auto-resolved.
export function approvalBlocker(a) {
  if (a.status !== "pending") return null;
  if (!a.approver) return { code: "no_approver", text: `No finance approver is assigned to ${a.id}. An administrator must assign an eligible approver.` };
  const p = person(a.approver);
  if (!p) return { code: "approver_removed", text: `${a.id} is assigned to ${a.approver}, who is no longer in the company. An administrator must reassign it to an eligible approver.` };
  if (!p.caps.includes("spend.approve")) return { code: "approver_revoked", text: `${p.name} no longer has finance approval authority, so ${a.id} can't be approved by them. An administrator must reassign it.` };
  const limit = p.limits?.approveUpTo ?? 0;
  if (a.terms.amount > limit) return { code: "over_limit", text: `${money(a.terms.amount)} is above ${p.name}'s approval limit of ${money(limit)}. ${a.id} needs an approver whose limit covers it.` };
  return null;
}
export const approvalBlockers = (ev) => ev.approvals.map((a) => ({ approval: a, blocker: approvalBlocker(a) })).filter((x) => x.blocker);

// Administrator assigns a pending approval to an eligible approver. Explicit and recorded; never automatic.
export function reassignApproval(ev, ctx, admin, approvalId, approver) {
  const a = ev.approvals.find((x) => x.id === approvalId);
  if (!a || a.status !== "pending") throw new PrereqError(`${approvalId} isn't pending`);
  const p = person(approver);
  if (!p || !p.caps.includes("spend.approve")) throw new PrereqError(`${displayName(approver)} isn't a finance approver`);
  if ((p.limits?.approveUpTo ?? 0) < a.terms.amount) throw new PrereqError(`${money(a.terms.amount)} is above ${p.name}'s limit of ${money(p.limits?.approveUpTo ?? 0)}`);
  if (a.approver && samePerson(a.approver, approver)) throw new PrereqError(`${a.id} is already assigned to ${p.name}`);
  const before = a.approver;
  a.reassignments = [...(a.reassignments || []), { from: before, to: approver, at: ctx.now, by: admin.id }];
  a.approver = aliasOf(approver) || approver;
  a.code = newCode(ctx); // the earlier code was sent to the previous approver
  a.notified = true;
  ctx.approvalOut.push(a.id);
  for (const f of ev.reviewQueue.filter((x) => x.open && x.text.includes(`${a.id} `) && /approv/i.test(x.text))) { f.open = false; f.resolvedBy = admin.id; f.resolvedAt = ctx.now; f.resolution = `${a.id} reassigned to ${p.name}`; }
  sayTo(ctx, "thread", `${a.id} (${money(a.terms.amount)}) is now with ${p.name} for approval. Nothing is booked until it's approved.`);
  hist(ev, ctx, "approval.reassigned", `${admin.label} assigned ${a.id} (${money(a.terms.amount)}) to ${p.name}${before ? ` (was ${displayName(before)})` : ""}`, { admin: admin.id });
  return { before, after: a.approver };
}
const newCode = (ctx) => ctx.store.nextId("AC").replace("AC-", "ap") + Math.random().toString(36).slice(2, 6);
export const sponsorOf = (ev) => ev.participants.find((a) => can(a, "plan.change_scope")) || null;

function ensureApproval(ev, ctx, source) {
  const p = proposal(ev, ev.selection.proposalId);
  if (p.amount == null) return null;
  const terms = approvalTerms(ev, p);
  const hash = termsHash(terms);
  if (ev.approved && ev.approved.hash === hash) return { already: true };
  const existing = ev.approvals.find((a) => a.status === "pending" && a.hash === hash);
  if (existing) return existing;
  for (const a of ev.approvals.filter((a) => a.status === "pending")) { a.status = "superseded"; a.supersededAt = ctx.now; a.supersededReason = "a different option was selected"; }
  const cap = ev.approved?.cap ?? null;
  const a = {
    id: ctx.store.nextId("R"), kind: "spend.approve", approver: assignedApprover(p.amount), terms, hash, status: "pending", requestedAt: ctx.now, configVersion: CONFIG.version,
    capFrom: cap, budgetRequested: ev.working.budget, needsCapAtLeast: cap == null || p.amount > cap ? p.amount : null,
    previous: ev.approved ? { approvalId: ev.approved.approvalId, amount: ev.approved.terms.amount, date: ev.approved.terms.date } : null,
    code: newCode(ctx),
  };
  ev.approvals.push(a);
  const blocker = approvalBlocker(a);
  if (blocker) {
    // Don't send an approval request to someone who can't grant it (or to nobody). Visible blocker instead.
    a.notified = false;
    hist(ev, ctx, "approval.blocked", `${a.id} (${supplierName(p.supplierId)}, ${money(p.amount)}) needs an eligible approver: ${blocker.text}`, source);
    flag(ev, ctx, blocker.text, source);
  } else {
    a.notified = true;
    ctx.approvalOut.push(a.id);
    hist(ev, ctx, "approval.requested", `Asked ${displayName(a.approver)} to approve ${a.id}: ${supplierName(p.supplierId)}, ${p.terms.headcount} people, ${fmtDate(p.terms.date)}, ${money(p.amount)}`, source);
  }
  return a;
}

// Natural-language approval: valid only if target is unambiguous, sender is verified + authorized,
// policy permits email approval, and the terms are still current.
export function approveByEmail(ev, ctx, sender, identity, { ref, capTo, replyMeta, body }, source) {
  const pending = ev.approvals.filter((a) => a.status === "pending");
  let target = ref ? ev.approvals.find((a) => a.id.toLowerCase() === String(ref).toLowerCase()) : null;
  if (!ref && replyMeta?.approvalId) target = ev.approvals.find((a) => a.id === replyMeta.approvalId);
  const ask = (text) => { sayTo(ctx, `approver:${sender}`, text, { kind: "approval-question" }); return { asked: true }; };
  if (!target) {
    if (!pending.length) return ask("There's nothing waiting for your approval on this event right now.");
    return ask(`Which approval do you mean? Pending: ${pending.map((a) => `${a.id} (${money(a.terms.amount)}, ${fmtDate(a.terms.date)})`).join("; ")}. Reply "Approve ${pending[0].id}" to approve that exact one.`);
  }
  if (!can(sender, target.kind)) {
    hist(ev, ctx, "approval.refused", `${displayName(sender)} tried to approve ${target.id} but has no finance authority`, source);
    sayTo(ctx, "thread", `${firstName(sender)}, thanks — I've noted that you're happy with it, but spending approval has to come from ${target.approver ? displayName(target.approver) : "an assigned finance approver"}${target.status === "pending" && target.approver ? ` (${target.id} is with them)` : ""}.`);
    return { refused: "not-authorized" };
  }
  if (target.status === "pending" && !samePerson(sender, target.approver)) {
    hist(ev, ctx, "approval.refused", `${displayName(sender)} tried to approve ${target.id}, which is assigned to ${target.approver ? displayName(target.approver) : "nobody"}`, source);
    return ask(`${target.id} is assigned to ${target.approver ? displayName(target.approver) : "another approver"}, so I can't record your approval for it. An administrator can reassign it if needed.`);
  }
  if (!identity?.verified) { hist(ev, ctx, "approval.refused", `Approval for ${target.id} from unverified sender ignored`, source); return ask(`I can't accept an approval from an unverified message. Please reply from your company mailbox.`); }
  if (identity.method === "provider" && !(body || "").includes(target.code)) return ask(`For security, approvals by email need the approval code from the request. Reply "Approve ${target.id} ${target.code}".`);
  if (!POLICY.emailApprovals[target.kind]) return ask("Company policy requires this approval in the dashboard, not by email.");
  if (target.status === "approved") return ask(`${target.id} is already approved.${pending.length ? ` Still open: ${pending.map((a) => a.id).join(", ")}.` : ""}`);
  if (target.status !== "pending") {
    hist(ev, ctx, "approval.refused", `${displayName(sender)} replied to ${target.id}, which is ${target.status}; not applied to newer terms`, source);
    return ask(`${target.id} is out of date (${target.supersededReason || target.status}) and can't approve newer terms.${pending.length ? ` The current request is ${pending[0].id}: ${money(pending[0].terms.amount)} for ${pending[0].terms.headcount} people on ${fmtDate(pending[0].terms.date)}.` : ""}`);
  }
  const p = proposal(ev, target.terms.proposalId);
  if (!p || isStale(ev, p) || termsHash(approvalTerms(ev, p)) !== target.hash) {
    target.status = "superseded"; target.supersededReason = "terms changed before approval";
    return ask(`${target.id}'s terms no longer match the plan, so I can't apply it. I'll send updated terms.`);
  }
  const limit = person(sender).limits?.approveUpTo ?? 0;
  if (target.terms.amount > limit) return ask(`${money(target.terms.amount)} is above your approval limit of ${money(limit)}.`);
  const currentCap = ev.approved?.cap ?? null;
  let newCap = currentCap;
  if (capTo != null) {
    if (capTo < target.terms.amount) return ask(`A cap of ${money(capTo)} wouldn't cover ${money(target.terms.amount)}. Do you approve ${target.id} for ${money(target.terms.amount)} and a cap of at least that?`);
    if (capTo > limit) return ask(`A cap of ${money(capTo)} is above your approval limit.`);
    newCap = capTo;
  }
  if (newCap == null || target.terms.amount > newCap) {
    return ask(`Do you approve ${target.id} for ${money(target.terms.amount)} on ${fmtDate(target.terms.date)} and raise the cap from ${currentCap != null ? money(currentCap) : "none"} to at least ${money(target.terms.amount)}? Reply e.g. "Approve ${target.id}, cap ${COMPANY.currency} ${(Math.ceil(target.terms.amount / 5000) * 5000).toLocaleString("en-US")}".`);
  }
  target.status = "approved"; target.decidedConfigVersion = CONFIG.version; target.decidedBy = sender; target.decidedAt = ctx.now; target.decisionMsgId = source.msgId; target.capTo = newCap;
  if (ev.approved) ev.approvedHistory.push(ev.approved);
  ev.approved = { approvalId: target.id, terms: target.terms, hash: target.hash, cap: newCap, version: (ev.approvedHistory.length || 0) + 1, at: ctx.now, by: sender };
  hist(ev, ctx, "approval.granted", `${displayName(sender)} approved ${target.id}: ${money(target.terms.amount)}, ${target.terms.headcount} people, ${fmtDate(target.terms.date)}; cap ${currentCap != null ? `${money(currentCap)} → ` : ""}${money(newCap)}`, source);
  sayTo(ctx, `approver:${sender}`, `Recorded: ${target.id} approved (${money(target.terms.amount)}), cap ${money(newCap)}. Thank you.`, { kind: "approval-receipt" });
  sayTo(ctx, "thread", `${displayName(sender)} approved the spending (${target.id}: ${money(target.terms.amount)}; cap now ${money(newCap)}). This is an internal approval — ${ev.commitment ? `the booking stays on ${fmtDate(ev.commitment.terms.date)} until Planned confirms the change with ${supplierName(target.terms.supplierId)}` : "nothing is booked yet"}. ${ev.owner ? displayName(ev.owner) : "The event manager"} will send the approved ${ev.commitment ? "change" : "booking"} to Planned.`);
  return { approved: target };
}

export function declineByEmail(ev, ctx, sender, identity, { ref, replyMeta }, source) {
  const target = ref ? ev.approvals.find((a) => a.id.toLowerCase() === String(ref).toLowerCase()) : replyMeta?.approvalId ? ev.approvals.find((a) => a.id === replyMeta.approvalId) : null;
  if (!target || target.status !== "pending" || !can(sender, target.kind) || !samePerson(sender, target.approver) || !identity?.verified) return { ignored: true };
  target.status = "declined"; target.decidedBy = sender; target.decidedAt = ctx.now;
  hist(ev, ctx, "approval.declined", `${displayName(sender)} declined ${target.id}`, source);
  sayTo(ctx, "thread", `${displayName(sender)} declined ${target.id} (${money(target.terms.amount)}). Nothing was booked or changed.`);
  return { declined: target };
}

// ---------------------------------------------------------------- timeouts

export function sweepTimeouts(ev, ctx) {
  const hrs = POLICY.supplierTimeoutHours;
  for (const r of ev.supplierRequests.filter((r) => r.status === "sent")) {
    if ((Date.parse(ctx.now) - Date.parse(r.sentAt || r.at)) / 3600000 >= hrs) {
      r.status = "no-response";
      flag(ev, ctx, `${supplierName(r.supplierId)} hasn't answered ${r.id} (${r.type}) in ${hrs}h; ${r.type === "quote" ? "no offer recorded" : "commitment unchanged"}`, { timedOutRequestId: r.id });
    }
  }
}

export class AuthError extends Error { constructor(m) { super(m); this.status = 403; } }
export class PrereqError extends Error { constructor(m) { super(m); this.status = 422; } }
