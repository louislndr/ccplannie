// Read models for the company console (/admin). Everything is DERIVED from the canonical event record,
// messages and outbox: there is no second status machine here. A request can have several blockers.
import * as D from "./domain.mjs";
import { COMPANY, PLANNIE, POLICY, CONFIG, PEOPLE, ORG, can, person, displayName, samePerson } from "./config.mjs";
import { PERMISSIONS, capsOfRole } from "./org.mjs";
import { SUPPLIERS } from "./supplier-sim.mjs";
import { interpreterMode } from "./interpret.mjs";
import { MODEL } from "./llm.mjs";
import { plannedAdapter } from "./planned.mjs";
import { gmailConfigured, GMAIL_STATUS } from "./gmail.mjs";
import { agentmailConfigured, AGENTMAIL_STATUS } from "./agentmail.mjs";

const REQUIRED = ["headcount", "date", "nights", "roomPolicy"];
export const FILTERS = [
  ["all", "All requests"], ["needs_manager", "Needs manager"], ["waiting_requester", "Waiting on requester"], ["waiting_finance", "Waiting on finance"],
  ["waiting_supplier", "Waiting on Planned"], ["confirmed", "Confirmed"], ["paused", "Paused"], ["needs_review", "Needs review"],
];

const first = (e) => (e ? displayName(e).split(" ")[0] : "");
const hoursSince = (iso, now) => (Date.parse(now) - Date.parse(iso)) / 3600000;

// Delivery problems for one event (failed or held outgoing mail).
function deliveryFailures(store, ev) {
  const byMsg = new Map(store.listMessages("event_id=? AND direction='plannie'", ev.id).map((m) => [m.id, m]));
  return store.outbox().filter((o) => byMsg.has(o.messageId) && (o.status === "failed" || o.status === "held-not-allowlisted")).map((o) => {
    const m = byMsg.get(o.messageId);
    return { outboxId: o.id, msgId: m.id, to: [...m.to, ...m.cc], subject: m.subject, status: o.status, error: o.error, attempts: o.attempts };
  });
}

// Everything the inbox needs about one request.
export function summarize(store, ev, now) {
  const v = D.views(ev);
  const st = D.status(ev);
  const pending = ev.approvals.filter((a) => a.status === "pending");
  const blocked = D.approvalBlockers(ev);
  const missing = REQUIRED.filter((f) => ev.working[f] == null);
  // A suggestion the plan already matches needs nobody's decision any more (it stays on record as-is).
  const openSugs = ev.suggestions.filter((s) => s.status === "open" && !Object.entries(s.fields).every(([f, v]) => ev.working[f] === v));
  const flags = ev.reviewQueue.filter((f) => f.open);
  const unreviewed = Object.values(ev.contracts).flatMap((c) => c.rules.filter((r) => !r.reviewed));
  const waitingSupplier = ev.supplierRequests.filter((r) => r.status === "sent" || r.status === "queued");
  const overdue = waitingSupplier.filter((r) => r.status === "sent" && hoursSince(r.sentAt || r.at, now) >= POLICY.supplierTimeoutHours);
  const failures = deliveryFailures(store, ev);
  const sel = ev.selection && D.proposal(ev, ev.selection.proposalId);
  const lastCmp = ev.comparisons.at(-1);
  const awaitingChoice = !!lastCmp && (!ev.selection || ev.selection.at < lastCmp.at) && !ev.commitment;
  const ownerLost = ev.owner && !can(ev.owner, "event.own");
  const routedLost = !ev.owner && ev.routedTo && !can(ev.routedTo, "event.own");
  const sponsor = D.sponsorOf(ev);
  const decider = sponsor || ev.requestedBy;
  const confirmed = !!ev.commitment && v.drift.length === 0;
  const pendingBinding = ev.supplierRequests.find((r) => (r.type === "booking" || r.type === "amendment") && (r.status === "sent" || r.status === "queued"));
  const staleQuotes = ev.proposals.filter((p) => p.status === "stale" && !(ev.commitment && ev.commitment.terms.date === p.terms.date && ev.commitment.terms.headcount === p.terms.headcount));
  const readyToAuthorize = sel && ev.approved && ev.approved.terms.proposalId === sel.id && sel.status === "current" && !D.isStale(ev, sel) && !pendingBinding && !confirmed;

  const blockers = [];
  const add = (code, filter, text) => blockers.push({ code, filter, text });
  if (ev.paused) add("paused", "paused", `Paused by ${ev.pausedBy ? displayName(ev.pausedBy) : "the event manager"}. ccPlannie sends nothing until it's resumed.`);
  if (!ev.owner && !ev.routedTo) add("no_manager", "needs_manager", "Manager needed. No eligible event manager is routed.");
  else if (routedLost) add("routed_revoked", "needs_manager", `Manager needed. ${displayName(ev.routedTo)} no longer has event-manager powers.`);
  else if (!ev.owner) add("not_accepted", "needs_manager", `Manager needed. Routed to ${displayName(ev.routedTo)}, not yet accepted.`);
  if (ownerLost) add("owner_revoked", "needs_manager", `${displayName(ev.owner)} owns this request but no longer has event-manager powers. Reassign it.`);
  for (const { approval: a, blocker } of blocked) add(`approval_${blocker.code}`, "needs_review", blocker.text);
  for (const a of pending.filter((a) => !D.approvalBlocker(a))) add("approval_pending", "waiting_finance", `Waiting for ${first(a.approver)}'s approval (${a.id}, ${D.money(a.terms.amount)}).`);
  if (missing.length && !ev.commitment) add("missing_details", "waiting_requester", `Waiting on ${first(decider)} for ${missing.map((f) => D.LABEL[f].toLowerCase()).join(", ")}.`);
  if (openSugs.length) add("open_suggestions", "waiting_requester", `${openSugs.length} suggestion${openSugs.length > 1 ? "s" : ""} waiting for ${sponsor ? first(sponsor) : "the sponsor"}'s decision.`);
  if (awaitingChoice) add("awaiting_choice", "waiting_requester", `Waiting for ${sponsor ? first(sponsor) : "the sponsor"} to choose an option.`);
  if (pendingBinding) add("supplier_unconfirmed", "waiting_supplier", `Planned hasn't confirmed ${D.supplierName(pendingBinding.supplierId)} yet. Nothing changes with the venue until it does.`);
  const quoteWaits = waitingSupplier.filter((r) => r.type === "quote");
  if (quoteWaits.length) add("quotes_out", "waiting_supplier", `Waiting on Planned for ${quoteWaits.length > 1 ? "offers" : "an offer"} from ${quoteWaits.map((r) => D.supplierName(r.supplierId)).join(", ")}.`);
  if (overdue.length) add("supplier_overdue", "needs_review", `No answer from Planned about ${overdue.map((r) => D.supplierName(r.supplierId)).join(", ")} within the ${POLICY.supplierTimeoutHours}h timeout.`);
  if (flags.length) add("flags", "needs_review", `${flags.length} item${flags.length > 1 ? "s" : ""} flagged for review.`);
  if (unreviewed.length) add("unreviewed_clause", "needs_review", `Contract §${unreviewed.map((r) => r.ref).join(", §")} not yet verified.`);
  if (failures.length) add("delivery_failed", "needs_review", `${failures.length} email${failures.length > 1 ? "s" : ""} not delivered.`);

  const filters = new Set(blockers.map((b) => b.filter));
  if (confirmed && !ev.paused) filters.add("confirmed");

  // One next action, in priority order. Blockers that stop everything come first.
  const mgr = ev.owner || ev.routedTo;
  let next;
  const firstOf = (...codes) => blockers.find((b) => codes.includes(b.code));
  const b0 = firstOf("paused", "no_manager", "routed_revoked", "owner_revoked") || firstOf("not_accepted") || blockers.find((b) => b.code.startsWith("approval_") && b.code !== "approval_pending");
  if (b0) next = { who: b0.code === "not_accepted" ? ev.routedTo : b0.code === "paused" ? ev.owner : "admin", text: b0.code === "not_accepted" ? `${first(ev.routedTo)} needs to accept ownership.` : b0.text };
  else if (failures.length) next = { who: "admin", text: `Retry or fix ${failures.length} undelivered email${failures.length > 1 ? "s" : ""}.` };
  else if (flags.length) next = { who: mgr, text: `${first(mgr)}: review ${flags.length} flagged item${flags.length > 1 ? "s" : ""}.` };
  else if (missing.length && !ev.commitment) next = { who: decider, text: `Waiting on ${first(decider)} for ${missing.map((f) => D.LABEL[f].toLowerCase()).join(", ")}.` };
  else if (pending.length) next = { who: pending[0].approver, text: `Waiting for ${first(pending[0].approver)}'s approval.` };
  else if (readyToAuthorize) next = { who: ev.owner, text: `${first(ev.owner)} can authorize the ${ev.commitment ? "amendment" : "booking"} (${D.money(sel.amount)}).` };
  else if (pendingBinding) next = { who: null, text: "Waiting on Planned to confirm." };
  else if (quoteWaits.length) next = { who: null, text: `Waiting on ${quoteWaits.length > 1 ? "suppliers" : D.supplierName(quoteWaits[0].supplierId)} for ${quoteWaits.length > 1 ? "quotes" : "a quote"}.` };
  else if (openSugs.length) next = { who: sponsor, text: `Waiting for ${sponsor ? first(sponsor) : "the sponsor"} to decide on a suggestion.` };
  else if (awaitingChoice) next = { who: sponsor, text: `Waiting for ${sponsor ? first(sponsor) : "the sponsor"} to choose an option.` };
  else if (staleQuotes.length && !waitingSupplier.length && !confirmed) next = { who: ev.owner, text: `Quotes are out of date. ${first(ev.owner)} can request a revised quote.` };
  else if (ev.owner && ev.supplierRequests.length === 0) next = { who: ev.owner, text: `${first(ev.owner)} can request quotes.` };
  else if (unreviewed.length) next = { who: ev.owner, text: `${first(ev.owner)}: verify contract §${unreviewed[0].ref}.` };
  else if (confirmed) next = { who: null, text: `Confirmed by ${D.supplierName(ev.commitment.supplierId)} (${ev.commitment.bookingRef}).` };
  else if (ev.commitment && v.drift.length) next = { who: ev.owner, text: "Change in progress: the plan differs from the booking." };
  else next = { who: ev.owner, text: st.label };

  const requester = ev.requestedBy;
  return {
    id: ev.id, version: ev.version, title: ev.title, requester, requesterName: displayName(requester), receivedAt: ev.createdAt,
    routedTo: ev.routedTo || null, owner: ev.owner || null, routedToName: ev.routedTo ? displayName(ev.routedTo) : null, ownerName: ev.owner ? displayName(ev.owner) : null, stage: st, paused: !!ev.paused,
    date: ev.working.date, headcount: ev.working.headcount,
    money: { requested: ev.working.budget ?? null, approved: ev.approved ? { amount: ev.approved.terms.amount, cap: ev.approved.cap, ref: ev.approved.approvalId } : null, confirmed: ev.commitment ? { amount: ev.commitment.amount, ref: ev.commitment.bookingRef, supplier: D.supplierName(ev.commitment.supplierId) } : null },
    blockers, filters: [...filters], next,
    search: [ev.title, ev.id, ev.address, ...ev.participants, ...ev.participants.map(displayName), ev.routedTo, ev.owner, ...ev.approvals.map((a) => a.id), ...ev.approvals.flatMap((a) => [a.approver, a.approver && displayName(a.approver)]), ...ev.proposals.map((p) => p.id), ev.commitment?.bookingRef].filter(Boolean).join(" ").toLowerCase(),
  };
}

export function inbox(store, app) {
  const now = app.now();
  const items = store.listEvents().map((ev) => summarize(store, ev, now)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? items.length : items.filter((i) => i.filters.includes(k)).length]));
  const intake = app.intakeReview();
  return { now, items, counts, filters: FILTERS, intake };
}

// What `actor` may do on this request right now. Mirrors the domain checks, which still run on execution.
export function permittedActions(ev, actor) {
  const out = [];
  const owner = ev.owner && samePerson(ev.owner, actor);
  const add = (action, label, allowed, reason = null, extra = {}) => out.push({ action, label, allowed, reason, ...extra });
  const who = person(actor);
  if (!who) return [{ action: "none", label: "No actions", allowed: false, reason: `${actor} isn't in the company.` }];
  const sel = ev.selection && D.proposal(ev, ev.selection.proposalId);
  const pendingBinding = ev.supplierRequests.find((r) => (r.type === "booking" || r.type === "amendment") && (r.status === "sent" || r.status === "queued"));
  const confirmed = ev.commitment && D.views(ev).drift.length === 0;
  const notOwner = !ev.owner ? "Accept ownership first." : !owner ? `Only ${displayName(ev.owner)}, the owner, can do this.` : null;
  if (!ev.owner) {
    const reason = !can(actor, "event.own") ? `${who.name} isn't an event manager.` : ev.routedTo && !samePerson(ev.routedTo, actor) ? `Routed to ${displayName(ev.routedTo)}. An administrator can reroute it.` : null;
    add("accept", "Accept ownership", !reason, reason);
  }
  const missing = REQUIRED.filter((f) => ev.working[f] == null);
  const quoteOut = ev.supplierRequests.some((r) => r.type === "quote" && (r.status === "sent" || r.status === "queued"));
  const qReason = !can(actor, "supplier.inquire") ? `${who.name} can't contact suppliers.` : notOwner || (ev.paused ? "Paused." : missing.length ? `Missing ${missing.map((f) => D.LABEL[f].toLowerCase()).join(", ")}.` : quoteOut ? "A quote request is still waiting for a reply." : null);
  add("requestQuotes", ev.commitment ? `Ask ${D.supplierName(ev.commitment.supplierId)} about the current plan` : ev.supplierRequests.length ? "Request revised quotes" : "Request quotes", !qReason, qReason, { suppliers: ev.commitment ? [ev.commitment.supplierId] : Object.keys(SUPPLIERS) });
  if (sel || ev.approved) {
    const aReason = !can(actor, "supplier.authorize") ? `${who.name} can't authorize supplier actions.` : notOwner || (ev.paused ? "Paused." : !sel ? "No option selected." : sel.status !== "current" || D.isStale(ev, sel) ? "The selected offer no longer matches the plan." : !ev.approved || ev.approved.terms.proposalId !== sel.id || ev.approved.hash !== D.termsHash(D.approvalTerms(ev, sel)) ? "Finance hasn't approved these exact terms." : pendingBinding ? "Already waiting for the supplier to confirm." : confirmed ? "Already confirmed." : null);
    add("authorize", ev.commitment ? `Authorize amendment${sel ? ` · ${D.money(sel.amount)}` : ""}` : `Authorize booking${sel ? ` · ${D.money(sel.amount)}` : ""}`, !aReason, aReason);
  }
  for (const c of Object.values(ev.contracts)) for (const r of c.rules.filter((r) => !r.reviewed)) {
    const reason = !can(actor, "clause.review") ? `${who.name} can't review contract clauses.` : notOwner;
    add("reviewClause", `Verify §${r.ref} against the contract`, !reason, reason, { args: { contractId: c.id, ruleRef: r.ref } });
  }
  const pReason = !can(actor, "event.own") ? `${who.name} isn't an event manager.` : notOwner;
  add(ev.paused ? "resume" : "pause", ev.paused ? "Resume ccPlannie" : "Pause ccPlannie on this request", !pReason, pReason);
  const mReason = !can(actor, "decision.manual") ? `${who.name} can't record decisions.` : notOwner;
  add("manualDecision", "Record an off-email decision", !mReason, mReason);
  return out;
}

export function detail(store, app, eventId, actor) {
  const ev = store.getEvent(eventId);
  if (!ev) return null;
  const now = app.now();
  const summary = summarize(store, ev, now);
  const messages = store.listMessages("event_id=?", ev.id);
  const delivery = Object.fromEntries(store.outbox().map((o) => [o.messageId, o.status]));
  const original = messages.find((m) => m.direction !== "plannie") || null;
  const imp = D.impacts(ev, now);
  return {
    event: { ...ev, approvals: ev.approvals.map(({ code, ...a }) => ({ ...a, blocker: D.approvalBlocker(a) })), statusInfo: D.status(ev), views: D.views(ev), impacts: imp, threads: store.listThreads(ev.id).map((t) => ({ ...t, messages: messages.filter((m) => m.threadId === t.id).map((m) => m.id) })) },
    summary,
    original: original && { id: original.id, from: original.from, subject: original.subject, body: original.body, at: original.at },
    messages: messages.map((m) => ({ ...m, delivery: delivery[m.id] || null })),
    staleQuotes: ev.proposals.filter((p) => p.status === "stale").map((p) => ({ id: p.id, supplier: D.supplierName(p.supplierId), headcount: p.terms.headcount, date: p.terms.date, amount: p.amount, staleSince: p.staleSince })),
    unknowns: imp.filter((i) => i.basis === "unknown" || i.basis === "unreviewed rule" || i.basis === "conditional"),
    deliveryFailures: deliveryFailures(store, ev),
    actor, actions: actor ? permittedActions(ev, actor) : [],
    // Directory shapes the shared mail components expect (names only; no aliases' powers are granted here).
    people: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, { id: p.id, name: p.name, title: p.title, caps: p.caps, roles: p.roles || [], alias: !!p.alias }])),
    suppliers: Object.fromEntries(app.venueIds().map((id) => SUPPLIERS[id]).map((s) => [s.email, { id: s.id, name: s.name, city: s.city }])),
    plannie: { intake: PLANNIE.intake, from: PLANNIE.from },
    policy: { delegatedInquiries: POLICY.delegatedInquiries, supplierTimeoutHours: POLICY.supplierTimeoutHours, configVersion: CONFIG.version },
    managers: Object.entries(PEOPLE).filter(([, p]) => !p.alias && p.caps.includes("event.own")).map(([e, p]) => ({ email: e, name: p.name })),
    approvers: Object.entries(PEOPLE).filter(([, p]) => !p.alias && p.caps.includes("spend.approve")).map(([e, p]) => ({ email: e, name: p.name, limit: p.limits?.approveUpTo ?? null })),
  };
}

// ------------------------------------------------------------------ handoff export (never a sync)

export function handoffExport(store, app, eventId, transportName, { demo = false } = {}) {
  const ev = store.getEvent(eventId);
  if (!ev) return null;
  const msgRef = (id) => { const m = id && store.getMessage(id); return m ? { messageId: m.messageId, localId: m.id, at: m.at, from: m.from } : null; };
  const v = D.views(ev);
  const a = ev.approved;
  const c = ev.commitment;
  const simulatedSupplier = (sid) => !!SUPPLIERS[sid];
  return {
    schema: "ccplannie.handoff/v1",
    exportedAt: new Date().toISOString(),
    notice: "Export from the ccPlannie prototype. It has NOT been sent or synced to Planned or any other system. Venue options, prices and confirmations below are sample data standing in for Planned's answers unless marked otherwise.",
    environment: { mode: store.getMeta("clock") ? "standalone demo (fixed demo clock)" : "company console", emailTransport: transportName, interpreter: interpreterMode(), planned: plannedAdapter.status("", { demo }).state, syncedTo: [] },
    company: { name: COMPANY.name, currency: COMPANY.currency, configVersion: CONFIG.version, configSource: CONFIG.source },
    request: { id: ev.id, eventVersion: ev.version, title: ev.title, requestedBy: ev.requestedBy, receivedAt: ev.createdAt, routedTo: ev.routedTo || null, owner: ev.owner || null, ownerAcceptedAt: ev.ownerAcceptedAt || null, ownerHistory: ev.ownerHistory || [], paused: !!ev.paused, routingConfigVersion: ev.configVersion ?? null },
    workingPlan: {
      fields: ev.working, rooms: v.working.rooms,
      provenance: Object.fromEntries(Object.entries(ev.workingSource).map(([f, s]) => [f, { by: s.by, at: s.at, how: s.how, quote: s.quote, source: msgRef(s.msgId) }])),
      selection: ev.selection ? { proposalId: ev.selection.proposalId, by: ev.selection.by, at: ev.selection.at, source: msgRef(ev.selection.msgId), note: "A selection is a choice, not a spending approval." } : null,
    },
    approvedTerms: a ? {
      approvalId: a.approvalId, approvedBy: a.by, approvedAt: a.at, termsHash: a.hash, cap: a.cap, terms: a.terms,
      configVersion: ev.approvals.find((x) => x.id === a.approvalId)?.decidedConfigVersion ?? null,
      source: msgRef(ev.approvals.find((x) => x.id === a.approvalId)?.decisionMsgId),
      note: "Internal finance approval of exact terms. Not a booking.",
    } : null,
    approvals: ev.approvals.map((x) => ({ id: x.id, status: x.status, approver: x.approver, amount: x.terms.amount, requestedAt: x.requestedAt, decidedBy: x.decidedBy || null, decidedAt: x.decidedAt || null, supersededReason: x.supersededReason || null, reassignments: x.reassignments || [] })),
    supplierCommitment: c ? {
      supplier: D.supplierName(c.supplierId), simulated: simulatedSupplier(c.supplierId), bookingRef: c.bookingRef, terms: c.terms, amount: c.amount, includesFee: c.includesFee,
      confirmedAt: c.confirmedAt, authorizedBy: c.authorizedBy, approvalId: c.approvalId, source: msgRef(c.msgId),
      note: simulatedSupplier(c.supplierId) ? "Sample data standing in for Planned's booking confirmation. No real venue was contacted." : "Confirmed by the venue.",
    } : null,
    contractRules: Object.values(ev.contracts).flatMap((k) => k.rules.map((r) => ({ contract: k.id, ref: r.ref, type: r.type, amount: r.amount, minDaysBeforeArrival: r.minDaysBeforeArrival, reviewed: !!r.reviewed, reviewedBy: r.reviewedBy || null, excerpt: r.excerpt, page: r.page }))),
    provenance: ev.history.map((h) => ({ seq: h.seq, at: h.at, actor: h.actor, action: h.action, summary: h.summary, configVersion: h.configVersion ?? null, source: msgRef(h.source?.msgId), manual: h.source?.manual ? { recordedBy: h.source.recordedBy, decidedBy: h.source.decidedBy, channel: h.source.channel } : undefined })),
  };
}

// ------------------------------------------------------------------ connections (server-derived, no secrets)

// "gemini-3.8-flash" → "Gemini 3.8 Flash"; other model ids are shown as they are.
const modelName = (id) => (/^gemini-/.test(id) ? id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : id);

export const DIRECTORY_CSV_FILE = "company-people.csv";

export function connections(store, { demo = false, demoPolicyFile = null } = {}) {
  const mailbox = (label, status) => ({
    state: status.lastError ? "missing" : "configured", label,
    detail: status.lastError ? "ccPlannie couldn’t check this mailbox. Review your email connection." : "ccPlannie checks this mailbox for new requests and sends replies from it.",
  });
  const hook = !!(process.env.POSTMARK_WEBHOOK_USER && process.env.POSTMARK_WEBHOOK_PASS);
  const email = demo
    ? { state: "demo", label: "Demo mailbox", detail: "Emails stay inside the demo mailbox." }
    : process.env.POSTMARK_SERVER_TOKEN
    ? { state: "configured", label: "Postmark", detail: hook ? "Postmark delivers outgoing emails and brings incoming requests into ccPlannie." : "Postmark is set up to send email. Incoming email still needs to be set up." }
    : agentmailConfigured()
    ? mailbox("AgentMail mailbox", AGENTMAIL_STATUS)
    : gmailConfigured()
    ? mailbox("Gmail mailbox", GMAIL_STATUS)
    : { state: "local", label: "Outbox only", detail: "Outgoing emails stay in the outbox until you set up a mail provider." };

  const lastSource = (...actions) => store.listAudit({ actions, limit: 1 })[0];
  const directorySource = lastSource("org.csv_imported", "config.sample_restored");
  const rulesSource = lastSource("policy.imported", "policy.sample_applied", "config.sample_restored");
  const directoryExport = { fileName: DIRECTORY_CSV_FILE, download: "/api/admin/csv" };
  const people = ORG.people.length === 0
    ? { state: "empty", label: "No directory file", detail: "Upload a CSV on the People page to bring in your team and their roles." }
    : directorySource?.action === "org.csv_imported"
    ? { state: "saved", label: "Imported from CSV", fileName: directorySource.details?.sourceFile, detail: "This CSV supplied the people and roles in the directory. You can export the current directory from the People page." }
    : demo
    ? { state: "sample", label: "Demo directory export", ...directoryExport, detail: "Download a CSV of the demo’s current directory, including people, roles, and reporting lines." }
    : { state: "saved", label: "Directory export", ...directoryExport, detail: "Download a CSV of your current directory. You can import a directory file from the People page." };
  const rules = rulesSource?.action === "policy.imported"
    ? { state: "saved", label: "Uploaded policy", fileName: rulesSource.details?.sourceFile, detail: "ccPlannie read this document to suggest rules. The saved settings are on the Rules page." }
    : demo
    ? { state: "sample", label: "Demo policy document", fileName: demoPolicyFile, detail: "This sample document is available on the Rules page. You can review the rules it suggests before saving them." }
    : { state: "saved", label: "Console settings", detail: "Upload a policy document on the Rules page to suggest routing, approval, and follow-up rules." };

  return {
    email: { ...email, inbound: PLANNIE.intake, from: PLANNIE.from, webhook: !demo && hook },
    interpretation: interpreterMode() === "model"
      ? { state: "configured", label: modelName(MODEL()), detail: "The model reads incoming emails for request details. Company rules still decide who can act and what needs approval." }
      : demo
      ? { state: "sample", label: "Scripted email readings", detail: "The demo uses prepared readings for its story emails." }
      : { state: "missing", label: "No model configured", detail: "Incoming emails are kept for a manager to review." },
    people,
    rules,
    company: { state: CONFIG.source, label: CONFIG.source === "saved" ? "Saved configuration" : CONFIG.source === "empty" ? "No people yet" : "Sample company", detail: "Manage the directory on the People page and approval settings on the Rules page." },
    planned: plannedAdapter.status(POLICY.plannedWorkspaceRef, { demo }),
  };
}

export function orgView() {
  return {
    currency: COMPANY.currency,
    people: ORG.people.map((p) => ({ ...p, caps: PEOPLE[p.email]?.caps || [] })),
    roles: Object.fromEntries(Object.entries(ORG.roles).map(([id, role]) => [id, { ...role, caps: capsOfRole(role) }])),
    permissions: PERMISSIONS,
  };
}
