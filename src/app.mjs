// Application service: the email world, Plannie's ingestion pipeline, replies, the durable outbox,
// manager operations, the supplier simulator loop and the demo runner. Email and dashboard actions
// go through the same domain operations.
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConflictError, openDb } from "./db.mjs";
import { COMPANY, PLANNIE, POLICY, CONFIG, PEOPLE, ORG, TRUSTED_LOCAL, person, can, displayName, firstName, eventAddress, eventIdFromAddress, isPlannieAddress, defaultManager, defaultApprover, setCompany, FLOW_POINTS, aliasOf, samePerson } from "./config.mjs";
import { loadCompany, saveCompany, currentDoc, applyRuntime } from "./company.mjs";
import { SCENARIOS, scenario } from "./scenarios/index.mjs";
import * as D from "./domain.mjs";
import { SUPPLIERS, supplierByEmail, isSupplierAddress, parseRequestBlock, parseOfferBlock, supplierRespond } from "./supplier-sim.mjs";
import { interpret, interpreterMode, extractContractRules } from "./interpret.mjs";
import { DEMO_START } from "./demo.mjs";
import { localTransport } from "./transport.mjs";

const rid = () => randomBytes(4).toString("hex");

// initialConfig: "sample" (standalone demo, fictional Acme cast) or "empty" (a real company's console).
export function createApp({ store, transport, initialConfig = "sample" }) {
  const app = {};
  // A demo database remembers which scenario it is running (its fictional company name, steps and clock).
  const demoScenario = () => scenario(store.getMeta("demo:scenario") || "acme");
  app.demoScenario = demoScenario;
  setCompany(initialConfig === "empty" ? { id: "company", name: "Company", domain: "", currency: "CAD", timezone: "America/Toronto" } : demoScenario().company);
  // Company configuration is loaded before anything else can process mail or flush queued work.
  loadCompany(store, { initial: initialConfig });
  // The venues the dashboard offers: the running demo's sample network, or every known venue otherwise.
  app.venueIds = () => (store.getMeta("demo:scenario") ? demoScenario().venues || Object.keys(SUPPLIERS) : Object.keys(SUPPLIERS));
  const now = () => store.getMeta("clock") || new Date().toISOString();
  const advance = (minutes) => { if (store.getMeta("clock")) store.setMeta("clock", new Date(Date.parse(now()) + minutes * 60000).toISOString()); };
  app.now = now;
  app.transportName = transport.name;
  app.advance = advance;

  // ------------------------------------------------------------ email world
  // Store a message and, if Plannie is a recipient, let Plannie ingest it.
  app.sendMail = async (m) => {
    if (m.messageId) {
      const dup = store.getByMessageId(m.messageId);
      if (dup) return { duplicate: true, message: dup };
    }
    const id = store.nextId("M");
    const msg = {
      id, messageId: m.messageId || `<${id.toLowerCase()}.${rid()}@mail.local>`, direction: m.direction || "human",
      from: m.from.toLowerCase(), to: (m.to || []).map((a) => a.toLowerCase()), cc: (m.cc || []).map((a) => a.toLowerCase()),
      subject: m.subject || "", body: m.body || "", html: m.html || null, inReplyTo: m.inReplyTo || null, references: m.references || [],
      at: m.at || now(), meta: { ...(m.meta || {}), headers: m.headers || {} }, attachments: m.attachments || [], identity: m.identity || null,
    };
    store.insertMessage(msg);
    advance(1);
    if ([...msg.to, ...msg.cc].some(isPlannieAddress)) await app.ingest(msg.id);
    return { message: store.getMessage(msg.id) };
  };

  const isAutoReply = (msg) => {
    const h = Object.fromEntries(Object.entries(msg.meta?.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
    return (h["auto-submitted"] && h["auto-submitted"] !== "no") || h["x-autoreply"] || h["x-autorespond"] || /^(bulk|junk|auto_reply|list)$/.test(h["precedence"] || "") || /^(auto(matic)?\s*reply|out of office|automatic reply)/i.test(msg.subject || "");
  };

  // ------------------------------------------------------------ ingestion
  app.ingest = async (msgId) => {
    const msg = store.getMessage(msgId);
    if (!msg || msg.seenByPlannie) return { skipped: true };
    const note = (n) => { store.updateMessage(msg.id, { seenByPlannie: true, notes: [...(msg.notes || []), n] }); return { ignored: n }; };
    if (isPlannieAddress(msg.from)) return note("ccPlannie's own message: ignored (loop prevention)");
    if (isAutoReply(msg)) return note("Automated reply: ignored, no response (loop prevention)");

    // Which event? Explicit event address or real reply headers only. Never subject similarity.
    const candidates = new Set();
    for (const a of [...msg.to, ...msg.cc]) { const e = eventIdFromAddress(a); if (e && store.getEvent(e)) candidates.add(e); }
    for (const ref of [msg.inReplyTo, ...(msg.references || [])].filter(Boolean)) { const m = store.getByRef(ref); if (m?.eventId) candidates.add(m.eventId); }
    if (candidates.size > 1) {
      store.tx(() => {
        queueOutbound({ dedupeKey: `ambiguous:${msg.id}`, from: PLANNIE.from, to: [msg.from], cc: [], subject: `Re: ${msg.subject}`, inReplyTo: msg.messageId, references: [msg.messageId],
          body: `This email seems to belong to more than one event (${[...candidates].join(", ")}). Which one should I apply it to? Reply from that event's thread, or include the event id.`, meta: { kind: "clarification" } });
        store.updateMessage(msg.id, { seenByPlannie: true, notes: ["Ambiguous event match: asked for clarification, nothing applied"] });
      });
      return app.flush();
    }
    let eventId = [...candidates][0] || null;
    const supplier = supplierByEmail(msg.from);
    if (supplier) {
      if (!eventId) return note("Supplier email with no matching request thread: held for manager review");
      return applySupplierMail(eventId, msg, supplier);
    }
    if (!eventId) {
      if (![...msg.to, ...msg.cc].includes(PLANNIE.intake)) return note("Not addressed to ccPlannie's intake address");
      if (!can(msg.from, "event.request")) return note(`Sender ${msg.from} is not a configured company requester: recorded, nothing created`);
    }
    const ev = eventId ? store.getEvent(eventId) : null;
    const replyTo = msg.inReplyTo ? store.getByRef(msg.inReplyTo) : null;
    const replyMeta = replyTo?.direction === "plannie" ? replyTo.meta : null;
    let interp, source;
    try {
      ({ interpretation: interp, source } = await interpret(msg, interpretationContext(ev, msg, replyMeta)));
    } catch (e) {
      interp = { intents: [{ kind: "unclear", fields: null, quote: "", fromQuotedHistory: false }], unresolved: [`Interpretation failed: ${e.message}`] };
      source = "error";
    }
    store.updateMessage(msg.id, { interpretation: interp, interpSource: source });
    const identity = msg.identity || { verified: TRUSTED_LOCAL.has(msg.from), method: "local-demo-trusted" };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        store.tx(() => {
          let e = eventId ? store.getEvent(eventId) : null;
          if (!e) e = createEvent(msg);
          eventId = e.id;
          const expected = e.version;
          const ctx = D.newCtx(store, now(), msg.from);
          // Stay in the thread being answered (e.g. a finance approval thread); otherwise the internal thread.
          const threadId = replyTo?.eventId === e.id && replyTo.threadId ? replyTo.threadId : internalThread(e).id;
          store.updateMessage(msg.id, { eventId: e.id, threadId, seenByPlannie: true });
          if (threadId === internalThread(e).id) for (const a of [msg.from, ...msg.to, ...msg.cc]) if (person(a) && !e.participants.includes(a)) e.participants.push(a);
          applyInternal(e, ctx, store.getMessage(msg.id), interp, replyMeta, identity);
          compose(e, ctx, store.getMessage(msg.id));
          store.saveEvent(e, expected);
        });
        break;
      } catch (err) {
        if (err instanceof ConflictError && attempt < 2) continue;
        throw err;
      }
    }
    return app.flush();
  };

  function createEvent(msg) {
    const id = store.nextId("E");
    const ev = D.newEvent({ id, address: eventAddress(id), requestedBy: msg.from, subject: msg.subject, at: now(), participants: [msg.from, ...msg.to, ...msg.cc].filter((a) => person(a)) });
    ev.owner = null;
    const mgr = defaultManager();
    ev.routedTo = mgr;
    ev.configVersion = CONFIG.version;
    ev.history.push({ seq: 1, at: now(), actor: msg.from, action: "request.received", summary: mgr ? `Request received from ${displayName(msg.from)}; routed to ${displayName(mgr)} by company policy v${CONFIG.version} (not yet accepted)` : `Request received from ${displayName(msg.from)}; no eligible event manager is configured, so it needs routing`, source: { msgId: msg.id }, configVersion: CONFIG.version });
    store.insertEvent(ev);
    store.upsertThread({ id: `T-${id}-internal`, eventId: id, kind: "internal", subject: ev.title });
    return store.getEvent(id);
  }
  const internalThread = (ev) => store.findThread(ev.id, "internal") || store.upsertThread({ id: `T-${ev.id}-internal`, eventId: ev.id, kind: "internal", subject: ev.title });

  function interpretationContext(ev, msg, replyMeta) {
    return {
      today: now().slice(0, 10), timezone: COMPANY.timezone, senderName: displayName(msg.from),
      event: ev ? {
        id: ev.id, working: ev.working,
        openSuggestions: ev.suggestions.filter((s) => s.status === "open").map((s) => ({ id: s.id, by: displayName(s.by), fields: s.fields })),
        currentOptions: ev.proposals.filter((p) => p.status === "current").map((p) => ({ id: p.id, venue: D.supplierName(p.supplierId), amount: p.amount, date: p.terms.date, headcount: p.terms.headcount })),
        pendingApprovals: ev.approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, amount: a.terms.amount, date: a.terms.date })),
        booked: ev.commitment ? { venue: D.supplierName(ev.commitment.supplierId), date: ev.commitment.terms.date, headcount: ev.commitment.terms.headcount } : null,
      } : null,
      replyTo: replyMeta ? { kind: replyMeta.kind, options: replyMeta.options?.map((o) => ({ n: o.n, id: o.id, venue: o.supplier })), suggestionIds: replyMeta.suggestionIds, approvalId: replyMeta.approvalId } : null,
    };
  }

  // ------------------------------------------------------------ applying an interpreted internal email
  function applyInternal(ev, ctx, msg, interp, replyMeta, identity) {
    const from = msg.from;
    const reply = ctx.reply = [];   // lines for the internal thread, composed with ctx.say
    const meta = ctx.replyMeta = {};
    const src = (it) => ({ msgId: msg.id, quote: it.quote, thread: msg.threadId, from });
    const clean = (f) => Object.fromEntries(Object.entries(f || {}).filter(([k, v]) => D.FIELDS.includes(k) && v != null));
    const sponsor = ev.participants.find((a) => can(a, "plan.change_scope")) || null;
    let changedScope = false;

    for (const it of interp.intents) {
      const fields = clean(it.fields);
      switch (it.kind) {
        case "new_request":
          ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: from, action: "request.text", summary: `${displayName(from)}: "${it.quote}"`, source: src(it) });
          break;
        case "details": {
          const r = D.provideDetails(ev, ctx, from, fields, src(it), { fromQuotedHistory: it.fromQuotedHistory });
          if (r.applied.length) { D.afterWorkingChange(ev, ctx, r.applied, src(it)); changedScope = true; }
          if (!it.fromQuotedHistory && r.conflicts.length) handleChange(Object.fromEntries(r.conflicts.map((f) => [f, fields[f]])), it);
          if (it.fromQuotedHistory && r.conflicts.length) reply.push(`I kept the current ${r.conflicts.map((f) => D.LABEL[f].toLowerCase()).join(", ")} (${r.conflicts.map((f) => D.fmtField(f, ev.working[f])).join(", ")}); the forwarded text is older.`);
          break;
        }
        case "change": handleChange(fields, it); break;
        case "suggestion": {
          const s = D.addSuggestion(ev, ctx, from, fields, src(it), "suggestion");
          explainProposal(s, "suggestion");
          break;
        }
        case "scenario": {
          const s = D.addSuggestion(ev, ctx, from, fields, src(it), "scenario");
          explainProposal(s, "scenario");
          break;
        }
        case "confirm": {
          const open = ev.suggestions.filter((s) => s.status === "open");
          let target = null;
          const fromReply = (replyMeta?.suggestionIds || []).map((id) => open.find((s) => s.id === id)).filter(Boolean);
          if (fromReply.length === 1) target = fromReply[0];
          else if (Object.keys(fields).length) target = open.find((s) => Object.entries(s.fields).every(([k, v]) => fields[k] === v)) || null;
          if (!target && Object.keys(fields).length) { handleChange(fields, it); break; }
          if (!target) { reply.push(`I'm not sure which change you're confirming. Could you say what it is (e.g. "yes, 45 people")?`); break; }
          if (!can(from, "plan.change_scope")) {
            reply.push(`Thanks ${firstName(from)} — noted. ${sponsor ? displayName(sponsor) : "The event sponsor"} decides scope changes, so ${target.id} is still a suggestion.`);
            break;
          }
          D.adoptSuggestion(ev, ctx, from, target.id, src(it));
          changedScope = true;
          explainScopeChange(Object.keys(target.fields), it);
          break;
        }
        case "select": {
          const pid = resolveOption(ev, it.optionRef, replyMeta);
          if (!pid.id) { reply.push(pid.question); break; }
          const r = D.selectOption(ev, ctx, from, pid.id, src(it));
          if (r.error === "not-authorized") reply.push(`Thanks ${firstName(from)} — noted your preference for ${D.supplierName(r.proposal?.supplierId)}. ${sponsor ? displayName(sponsor) : "The sponsor"} makes the choice.`);
          else if (r.error === "stale") reply.push(`That offer from ${D.supplierName(r.proposal.supplierId)} was for ${r.proposal.terms.headcount} people on ${D.fmtDate(r.proposal.terms.date)}, which no longer matches the plan, so I can't use it. A revised offer is needed first.`);
          else if (r.error) reply.push("I couldn't match that to an offer. Which venue do you mean?");
          else explainSelection(r);
          if (it.revisionNote) revision(pid.id, it);
          break;
        }
        case "revision_request": {
          const pid = resolveOption(ev, it.optionRef, replyMeta);
          revision(pid.id || null, it);
          break;
        }
        case "approve": D.approveByEmail(ev, ctx, from, identity, { ref: it.approvalRef, capTo: it.capTo, replyMeta, body: msg.body }, src(it)); break;
        case "decline": D.declineByEmail(ev, ctx, from, identity, { ref: it.approvalRef, replyMeta }, src(it)); break;
        case "status": reply.push(statusText(ev)); meta.kind = "status"; break;
        case "fyi": break;
        default:
          D.flagForReview(ev, ctx, `Couldn't interpret an email from ${displayName(from)}${interp.unresolved?.length ? ` (${interp.unresolved.join("; ")})` : ""}; please review`, src(it));
      }
    }

    // On a brand-new request: acknowledge, show what's captured, ask only what blocks sourcing.
    if (ev.history.filter((h) => h.action === "request.received").length === 1 && !ev._acked) {
      ev._acked = true;
      const missing = ["headcount", "date", "nights", "roomPolicy"].filter((f) => ev.working[f] == null);
      const have = D.FIELDS.filter((f) => ev.working[f] != null).map((f) => `${D.LABEL[f]}: ${D.fmtField(f, ev.working[f])}`);
      const asks = { date: "Which date should we aim for?" + ((interp.unresolved || []).some((u) => /sept|date/i.test(u)) ? " (I have \"mid-September\", but sourcing needs a specific date.)" : ""), headcount: "Roughly how many people?", nights: "How many nights?", roomPolicy: "Does everyone need their own room?" };
      reply.unshift(`Got it — I've opened request ${ev.id} and ${ev.routedTo ? `sent it to ${displayName(ev.routedTo)} on the event team` : "passed it to the event team (no manager is assigned yet)"}.` +
        (have.length ? `\n\nWhat I have so far: ${have.join(" · ")}.${ev.working.budget != null ? " The budget is your request; nothing is approved by finance yet." : ""}` : "") +
        (missing.length ? `\n\n${missing.length === 1 ? "One thing blocks sourcing" : "A few things block sourcing"}:\n${missing.map((m) => `- ${asks[m]}`).join("\n")}` : ""));
    }

    function handleChange(fields, it) {
      if (!Object.keys(fields).length) return;
      if (can(from, "plan.change_scope")) {
        D.changeScope(ev, ctx, from, fields, src(it));
        changedScope = true;
        explainScopeChange(Object.keys(fields), it);
      } else {
        const s = D.addSuggestion(ev, ctx, from, fields, src(it), "suggestion");
        explainProposal(s, "suggestion");
      }
    }

    function explainProposal(s, kind) {
      const plan = { ...ev.working, ...s.fields };
      const what = Object.entries(s.fields).map(([f, v]) => D.fmtField(f, v)).join(", ");
      const lines = [];
      lines.push(kind === "scenario"
        ? `If we changed to ${what} — nothing has changed, this is just a check:`
        : `${displayName(s.by)} suggested ${what}. I haven't changed the plan${can(s.by, "plan.change_scope") ? "" : ` — ${sponsor ? firstName(sponsor) : "the sponsor"} decides scope`}.`);
      const imp = D.impacts(ev, ctx.now, plan);
      const feasible = Object.entries(ev.supplierFacts).filter(([, f]) => !(plan.headcount && f.capacity && plan.headcount > f.capacity)).map(([sid, f]) => `${D.supplierName(sid)} (max ${f.capacity})`);
      if (s.fields.headcount && feasible.length && !ev.commitment) imp.push({ text: `${feasible.join(", ")} can host ${plan.headcount}, but any quote for a different headcount would need revising.`, basis: "confirmed by supplier" });
      // Approval consequence of a date change on a booked event: conditional, clearly labeled.
      if (ev.commitment && s.fields.date && s.fields.date !== ev.commitment.terms.date) {
        const fee = imp.find((i) => i.kind === "fee" && /applies/.test(i.text));
        const rule = ev.contracts[ev.commitment.contractId]?.rules.find((r) => r.type === "date_change_fee");
        if (fee && rule && ev.approved) {
          const est = ev.commitment.amount + rule.amount;
          imp.push({ text: `Approval: the current approval (${ev.approved.approvalId}) covers ${D.money(ev.approved.terms.amount)} with a ${D.money(ev.approved.cap)} cap. If the venue's rate stayed the same (not confirmed), the fee alone would make it ${D.money(est)}${est > ev.approved.cap ? `, ${D.money(est - ev.approved.cap)} over the cap, so ${defaultApprover() ? displayName(defaultApprover()) : "a finance approver"} would need to approve it` : ""}.`, basis: "conditional" });
        }
      }
      for (const i of imp) lines.push(`- ${i.text}${i.basis === "unknown" || i.basis === "conditional" || i.basis === "unreviewed rule" ? ` *(${i.basis})*` : ""}`);
      const decider = can(s.by, "plan.change_scope") ? s.by : sponsor;
      lines.push(decider ? `${firstName(decider)}, ${kind === "scenario" ? "do you want me to pursue this change?" : `should I change the plan to ${what}?`}` : "");
      reply.push(lines.filter(Boolean).join("\n"));
      meta.suggestionIds = [...(meta.suggestionIds || []), s.id];
    }

    function explainScopeChange(fields, it) {
      const lines = [];
      const changed = fields.map((f) => `${D.LABEL[f].toLowerCase()} ${D.fmtField(f, ev.working[f])}`).join(", ");
      if (ev.commitment) {
        lines.push(`Working plan updated: ${changed}. Your booking with ${D.supplierName(ev.commitment.supplierId)} is still ${D.fmtDate(ev.commitment.terms.date)}, ${ev.commitment.terms.headcount} people — nothing has changed with the venue.`);
      } else {
        lines.push(`Plan updated: ${changed}.${ev.approved ? "" : " Finance hasn't approved anything yet."}`);
      }
      const staled = (ctx.staled || []).map((id) => D.proposal(ev, id));
      if (staled.length) lines.push(`- ${staled.length === 1 ? "The earlier quote" : `The ${staled.length} earlier quotes`} (${staled.map((p) => D.supplierName(p.supplierId)).join(", ")}) ${staled.length === 1 ? "was" : "were"} for ${[...new Set(staled.map((p) => p.terms.headcount))].join("/")} people on ${[...new Set(staled.map((p) => D.fmtDate(p.terms.date)))].join("/")}, so ${staled.length === 1 ? "it's" : "they're"} out of date.`);
      const imp = D.impacts(ev, ctx.now).filter((i) => i.kind !== "fee" || !ev.commitment);
      for (const i of imp) lines.push(`- ${i.text}${["unknown", "conditional"].includes(i.basis) ? ` *(${i.basis})*` : ""}`);
      const asked = ctx.supplierOut.map((id) => ev.supplierRequests.find((r) => r.id === id)).filter((r) => r && r.delegated);
      if (ctx.notDelegated) lines.push(`I haven't asked Planned for a new offer: ${ev.owner ? displayName(ev.owner) : "the event manager"} decides whether to.`);
      if (asked.length) lines.push(ev.commitment
        ? `I've asked Planned whether ${asked.map((r) => D.supplierName(r.supplierId)).join(", ")} can do ${D.fmtDate(ev.working.date)} and what it would cost. That's a question, not a change — no amendment has been accepted.`
        : `I've asked Planned for a revised offer from ${asked.map((r) => D.supplierName(r.supplierId)).join(" and ")} (a quote request; nothing is booked).`);
      reply.push(lines.join("\n"));
    }

    function explainSelection(r) {
      const p = r.proposal, a = r.approval;
      const lines = [];
      if (ev.commitment) lines.push(`Recorded ${firstName(from)}'s go-ahead on the ${D.supplierName(p.supplierId)} change (${p.id}: ${D.money(p.amount)}, ${D.fmtDate(p.terms.date)}). That's a choice, not a spending approval.`);
      else lines.push(`Noted: ${firstName(from)} chose **${D.supplierName(p.supplierId)}** (${p.id}, ${D.money(p.amount)} for ${p.terms.headcount} people on ${D.fmtDate(p.terms.date)}).`);
      if (a && a.id) {
        const cap = ev.approved?.cap, budget = ev.working.budget;
        const over = cap != null ? (p.amount > cap ? `${D.money(p.amount - cap)} over the approved ${D.money(cap)} cap` : `within the approved ${D.money(cap)} cap`) : budget != null ? `${p.amount > budget ? `${D.money(p.amount - budget)} above` : "within"} the requested ${D.money(budget)} budget, which finance hasn't approved yet` : "";
        const blocked = a.notified === false ? D.approvalBlocker(a) : null;
        const after = ev.commitment ? `The booking stays on ${D.fmtDate(ev.commitment.terms.date)} until finance approves and Planned confirms the change.` : "Nothing is booked.";
        lines.push(blocked
          ? `Next, finance: it's ${over}. ${blocked.text} I haven't sent it to anyone who can't approve it; an administrator assigns the right approver. ${after}`
          : `Next, finance: it's ${over}, so I've asked ${displayName(a.approver)} to approve the exact terms (${a.id}). ${after}`);
      }
      reply.push(lines.join("\n"));
    }

    function revision(pid, it) {
      const rr = { id: store.nextId("V"), proposalId: pid, note: it.revisionNote || it.quote, by: from, at: ctx.now, status: "open" };
      ev.revisionRequests.push(rr);
      ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: from, action: "revision.requested", summary: `${displayName(from)} asked for a revised offer${pid ? ` on ${pid}` : ""}: "${rr.note}"`, source: src(it) });
      reply.push(`I've passed "${rr.note}" to ${ev.owner || ev.routedTo ? displayName(ev.owner || ev.routedTo) : "the event team"} as a request for a revised offer${pid ? ` from ${D.supplierName(D.proposal(ev, pid)?.supplierId)}` : ""}. It isn't an agreed discount until the venue sends a new quote.`);
    }

    if (reply.length) D_say(ctx, "thread", reply.join("\n\n"), meta);
    void changedScope;
  }
  const D_say = (ctx, audience, text, meta = {}) => ctx.say.push({ audience, text, meta });

  function resolveOption(ev, ref, replyMeta) {
    const r = String(ref || "").trim().toLowerCase();
    const cmp = replyMeta?.comparisonId ? ev.comparisons.find((c) => c.id === replyMeta.comparisonId) : null;
    const ord = { first: 1, "1": 1, one: 1, second: 2, "2": 2, two: 2, third: 3, "3": 3, three: 3, last: -1 };
    const ordKey = Object.keys(ord).find((k) => new RegExp(`\\b${k}\\b`).test(r) || r === `#${k}` || r === `option ${k}`);
    if (ordKey) {
      if (!cmp) return { question: `Which option do you mean? Please reply to the options email, or name the venue.` };
      const i = ord[ordKey] === -1 ? cmp.options.length - 1 : ord[ordKey] - 1;
      return cmp.options[i] ? { id: cmp.options[i] } : { question: `That list only had ${cmp.options.length} option${cmp.options.length > 1 ? "s" : ""}. Which venue do you mean?` };
    }
    const pool = cmp ? cmp.options.map((id) => D.proposal(ev, id)) : ev.proposals.filter((p) => p.status === "current");
    const byId = pool.find((p) => p.id.toLowerCase() === r);
    if (byId) return { id: byId.id };
    const byName = pool.filter((p) => D.supplierName(p.supplierId).toLowerCase().includes(r) || r.includes(D.supplierName(p.supplierId).toLowerCase().split(" ")[0]));
    if (byName.length === 1) return { id: byName[0].id };
    if (cmp && cmp.options.length === 1 && (!r || /looks good|that|it|this/.test(r))) return { id: cmp.options[0] };
    return { question: `Which option do you mean? ${pool.map((p) => `${D.supplierName(p.supplierId)} (${D.money(p.amount)})`).join(", ")}.` };
  }

  // ------------------------------------------------------------ supplier mail
  async function applySupplierMail(eventId, msg, supplier) {
    const block = parseOfferBlock(msg.body);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        store.tx(() => {
          const ev = store.getEvent(eventId); const expected = ev.version;
          const ctx = D.newCtx(store, now(), msg.from);
          const thread = store.findThread(ev.id, "supplier", supplier.id);
          store.updateMessage(msg.id, { eventId, threadId: thread?.id || null, seenByPlannie: true, interpSource: block ? "supplier system block (simulated)" : "none", interpretation: block });
          const source = { msgId: msg.id, thread: thread?.id, from: msg.from };
          if (!block) {
            // Free text from a supplier is untrusted evidence; it can't change authority, recipients or policy.
            D.flagForReview(ev, ctx, `Unstructured email from ${supplier.name}; not applied automatically`, { ...source, quote: msg.body.slice(0, 200) });
          } else {
            D.supplierReply(ev, ctx, supplier.id, block, source);
            for (const att of msg.attachments || []) {
              const text = att.text ?? (att.contentType === "text/plain" && att.content ? Buffer.from(att.content, "base64").toString("utf8") : null);
              if (!text) { D.flagForReview(ev, ctx, `Attachment ${att.name} couldn't be read; related terms stay unresolved`, source); continue; }
              const cid = block.contract || att.name.replace(/\.\w+$/, "");
              D.attachContract(ev, ctx, { ...extractContractRules(text, cid), title: text.split("\n")[0], sourceMsgId: msg.id, attachment: att.name }, source);
            }
          }
          compose(ev, ctx, null);
          store.saveEvent(ev, expected);
        });
        break;
      } catch (err) { if (err instanceof ConflictError && attempt < 2) continue; throw err; }
    }
    return app.flush();
  }

  // ------------------------------------------------------------ composing outbound mail (batched per audience)
  function compose(ev, ctx, inbound) {
    const groups = new Map();
    for (const s of ctx.say) {
      const g = groups.get(s.audience) || { texts: [], meta: {} };
      g.texts.push(s.text);
      for (const [k, v] of Object.entries(s.meta || {})) g.meta[k] = Array.isArray(v) && Array.isArray(g.meta[k]) ? [...g.meta[k], ...v] : v;
      groups.set(s.audience, g);
    }
    const st = D.status(ev);
    if (!ev.paused) {
      for (const [aud, g] of groups) {
        if (aud === "thread") {
          const t = internalThread(ev);
          const last = store.listMessages("thread_id=? AND event_id=?", t.id, ev.id).at(-1);
          const parent = inbound && inbound.threadId === t.id ? inbound : last;
          const others = ev.participants.filter((a) => a !== inbound?.from);
          const to = inbound && ev.participants.includes(inbound.from) ? [inbound.from] : ev.participants;
          const cc = inbound && ev.participants.includes(inbound.from) ? others : [];
          queueOutbound({
            dedupeKey: `thread:${inbound?.id || ctx.opKey || rid()}`, eventId: ev.id, threadId: t.id, from: ev.address, to, cc,
            subject: `Re: ${ev.title}`, inReplyTo: parent?.messageId || null, references: [...(parent?.references || []), parent?.messageId].filter(Boolean),
            body: `${g.texts.join("\n\n")}${g.meta.footer ? `\n\n${g.meta.footer}` : ""}\n\n— ccPlannie · ${ev.id} · ${st.label}`, meta: { ...g.meta, kind: g.meta.kind || "update", status: st.label },
          });
        } else if (aud.startsWith("approver:")) {
          const to = aud.slice(9);
          const t = store.upsertThread({ id: `T-${ev.id}-approval-${person(to)?.id}`, eventId: ev.id, kind: "approval", subject: "Approvals" });
          const last = store.listMessages("thread_id=?", t.id).at(-1);
          queueOutbound({ dedupeKey: `approver:${inbound?.id || ctx.opKey || rid()}:${to}`, eventId: ev.id, threadId: t.id, from: ev.address, to: [to], cc: [], subject: last ? `Re: ${last.subject.replace(/^Re:\s*/i, "")}` : `${ev.title}: approval`, inReplyTo: last?.messageId || null, references: last ? [last.messageId] : [], body: `${g.texts.join("\n\n")}\n\n— ccPlannie · ${ev.id}`, meta: g.meta });
        }
      }
    } else if (ctx.say.length) {
      ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: "plannie", action: "paused.suppressed", summary: `Paused: ${ctx.say.length} outgoing update(s) not sent`, source: {} });
    }
    // "Notify" steps: an FYI email when the request reaches the point the company chose. Sent once per step.
    if (!ev.paused) {
      ev.flowNotified ||= [];
      for (const step of (POLICY.flow || []).filter((x) => ["notify", "loopin", "hold"].includes(x.kind))) {
        const point = FLOW_POINTS.find((x) => x.id === step.after);
        const key = `${step.id}:${step.after}`;
        if (!point?.stages.includes(st.code) || ev.flowNotified.includes(key)) continue;
        if (step.kind === "hold") { // pause here until someone resumes it on the request page
          ev.flowNotified.push(key);
          ev.paused = true; ev.pausedBy = "rules";
          ev.pausedAt = ctx.now;
          ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: "plannie", action: "flow.hold", summary: `Held for a check after “${point.label}” (company rule). Resume it on the request page.`, source: {} });
          continue;
        }
        if (!person(step.who)) continue;
        ev.flowNotified.push(key);
        if (step.kind === "loopin") { // from here on they're copied on the request's email thread
          if (!ev.participants.includes(step.who)) ev.participants.push(step.who);
          ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: "plannie", action: "flow.loopin", summary: `Copied ${displayName(step.who)} on this request from “${point.label}” on (company rule)`, source: {} });
          continue;
        }
        const t = store.upsertThread({ id: `T-${ev.id}-notify-${person(step.who).id}`, eventId: ev.id, kind: "notify", subject: `FYI: ${ev.title}` });
        const last = store.listMessages("thread_id=?", t.id).at(-1);
        queueOutbound({ dedupeKey: `notify:${ev.id}:${key}`, eventId: ev.id, threadId: t.id, from: ev.address, to: [aliasOf(step.who) || step.who], cc: [],
          subject: last ? `Re: ${last.subject.replace(/^Re:\s*/i, "")}` : `FYI: ${ev.title}`, inReplyTo: last?.messageId || null, references: last ? [last.messageId] : [],
          body: `For your information: "${ev.title}" (${ev.id}) reached “${point.label}”. Status: ${st.label}.\n\nYou're copied because of ${COMPANY.name}'s rules. Nothing is needed from you.\n\n— ccPlannie · ${ev.id}`, meta: { kind: "notify" } });
        ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor: "plannie", action: "flow.notified", summary: `Told ${displayName(step.who)} the request reached “${point.label}”`, source: {} });
      }
    }
    for (const aid of ctx.approvalOut) {
      const a = ev.approvals.find((x) => x.id === aid);
      if (!a?.approver || !person(a.approver)) continue; // never address an approval to nobody
      const t = store.upsertThread({ id: `T-${ev.id}-approval-${person(a.approver)?.id}`, eventId: ev.id, kind: "approval", subject: `Approval ${a.id}` });
      const p = D.proposal(ev, a.terms.proposalId);
      const body = [
        `${displayName(ev.selection?.by)} chose an option for "${ev.title}" (${ev.id}). It needs your approval of these exact terms:`,
        "",
        `Approval ${a.id}`,
        `- Supplier: ${D.supplierName(a.terms.supplierId)} (offer ${a.terms.proposalId}${a.terms.offerRef ? `, ref ${a.terms.offerRef}` : ""})`,
        `- Date: ${D.fmtDate(a.terms.date)} (${a.terms.timezone}), ${D.fmtField("nights", a.terms.nights)}`,
        `- People: ${a.terms.headcount} · Rooms: ${a.terms.rooms}`,
        `- Amount: ${D.money(a.terms.amount)}${a.terms.conditions ? ` (${a.terms.conditions})` : ""}`,
        `- Action: ${a.terms.action}`,
        a.previous ? `- Replaces approved ${a.previous.approvalId} (${D.money(a.previous.amount)}, ${D.fmtDate(a.previous.date)}): +${D.money(a.terms.amount - a.previous.amount)}` : null,
        `- Cap: ${a.capFrom != null ? `approved cap is ${D.money(a.capFrom)}` : `no approved cap yet (requested budget ${D.money(a.budgetRequested)})`}${a.needsCapAtLeast ? `; this needs a cap of at least ${D.money(a.needsCapAtLeast)}` : ""}`,
        "",
        `To approve, reply "Approve ${a.id}"${a.needsCapAtLeast ? " and state the new cap" : ""}. A reply without the id, or approving a different id, won't approve this.`,
        `Approval code (only needed when replying from outside the demo): ${a.code}`,
        `Opening links never approves anything.`,
      ].filter((l) => l != null).join("\n");
      queueOutbound({ dedupeKey: `approval:${ev.id}:${a.id}${a.reassignments?.length ? `:${a.reassignments.length}` : ""}`, eventId: ev.id, threadId: t.id, from: ev.address, to: [a.approver], cc: [], subject: `Approval ${a.id}: ${D.supplierName(a.terms.supplierId)}, ${D.money(a.terms.amount)}`, body: `${body}\n\n— ccPlannie · ${ev.id}`, meta: { kind: "approval", approvalId: a.id, terms: a.terms, proposal: p && { id: p.id } } });
    }
    for (const qid of ctx.supplierOut) {
      const r = ev.supplierRequests.find((x) => x.id === qid);
      const s = SUPPLIERS[r.supplierId];
      const t = store.findThread(ev.id, "supplier", s.id) || store.upsertThread({ id: `T-${ev.id}-sup-${s.id}`, eventId: ev.id, kind: "supplier", supplierId: s.id, subject: `${COMPANY.name.replace(/ \(fictional\)/, "")} group request` });
      const last = store.listMessages("thread_id=?", t.id).at(-1);
      // Only these fields ever reach a supplier. No budget, cap, finance discussion or competing quotes.
      const f = r.fields;
      const fields = { "request-ref": r.id, type: r.type, "event-ref": ev.id, date: f.date, nights: f.nights, headcount: f.headcount, rooms: f.rooms };
      if (f.bookingRef) fields["booking-ref"] = f.bookingRef;
      if (r.type === "booking" || r.type === "amendment") fields.amount = f.amount;
      const lead = {
        quote: f.bookingRef ? `Could you tell us whether ${D.fmtDate(f.date)} is available for our existing booking ${f.bookingRef}, and what the all-in price would be? This is an inquiry only; please don't change the booking.` : `We're looking for a group venue and would appreciate a quote.`,
        booking: `Please book the following, per your offer.`,
        amendment: `Please amend booking ${f.bookingRef} as follows, per your offer.`,
      }[r.type];
      const body = `Hello ${s.contact.split(" ")[0]},\n\n${lead}\n\n- Date: ${D.fmtDate(f.date)}, ${D.fmtField("nights", f.nights)}\n- Guests: ${f.headcount}, rooms: ${f.rooms}${fields.amount ? `\n- Amount per your quote: ${D.money(fields.amount)}` : ""}\n\nThank you,\nPlannie, for ${ev.owner ? displayName(ev.owner) : "the event team"} (event team)\n\n--- Request details ---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---`;
      queueOutbound({ dedupeKey: `supplier:${ev.id}:${r.id}`, eventId: ev.id, threadId: t.id, from: ev.address, to: [s.email], cc: [], subject: last ? `Re: ${t.subject}` : t.subject, inReplyTo: last?.messageId || null, references: last ? [last.messageId] : [], body, meta: { kind: "supplier-request", requestId: r.id } });
    }
  }

  function queueOutbound({ dedupeKey, eventId = null, threadId = null, from, to, cc, subject, body, inReplyTo = null, references = [], meta = {} }) {
    if (store.outbox().some((o) => o.dedupeKey === dedupeKey)) return null;
    const id = store.nextId("M");
    const messageId = `<${id.toLowerCase()}.${rid()}@${PLANNIE.domain}>`;
    store.insertMessage({ id, messageId, direction: "plannie", eventId, threadId, from, to, cc, subject, body, inReplyTo, references, at: now(), meta, seenByPlannie: true });
    store.enqueue({ dedupeKey, messageId: id, at: now() });
    return id;
  }

  // ------------------------------------------------------------ outbox delivery
  app.flush = async () => {
    for (const o of store.outbox("queued")) {
      const msg = store.getMessage(o.messageId);
      let result;
      if (msg.meta?.kind === "approval" && store.getMeta("clock") && store.getMeta("demo:fail-approval-delivery", false)) {
        store.setMeta("demo:fail-approval-delivery", false);
        result = { status: "failed", error: "Simulated temporary delivery failure" };
      } else {
        try { result = await transport.send(msg); } catch (e) { result = { status: "failed", error: e.message }; }
      }
      store.tx(() => {
        store.markOutbox(o.id, { status: result.status, error: result.error || null, sentAt: result.status === "failed" ? null : now(), providerId: result.providerId || null });
        if (msg.meta?.requestId && msg.eventId) {
          const ev = store.getEvent(msg.eventId);
          const r = ev.supplierRequests.find((x) => x.id === msg.meta.requestId);
          if (r && ["queued", "failed"].includes(r.status)) { r.status = result.status === "failed" ? "failed" : "sent"; r.sentAt = now(); store.saveEvent(ev, ev.version); }
        }
      });
    }
    return { ok: true };
  };

  // ------------------------------------------------------------ supplier simulator loop
  app.supplierTick = async () => {
    const answered = new Set(store.getMeta("sim:answered", []));
    const bookings = store.getMeta("sim:bookings", {});
    const delivered = new Set(store.outbox().filter((o) => o.status !== "queued" && o.status !== "failed").map((o) => o.messageId));
    let count = 0;
    for (const m of store.listMessages("direction='plannie'")) {
      if (answered.has(m.id) || !delivered.has(m.id) || !m.to.some(isSupplierAddress)) continue;
      const s = supplierByEmail(m.to[0]);
      const req = parseRequestBlock(m.body); // the simulator sees only the email it received
      answered.add(m.id);
      if (!s || !req) continue;
      const out = supplierRespond(s, req, now(), bookings);
      store.setMeta("sim:answered", [...answered]); store.setMeta("sim:bookings", bookings);
      if (!out) continue;
      advance(18);
      await app.sendMail({ direction: "supplier", from: s.email, to: [m.from], cc: [], subject: `Re: ${m.subject.replace(/^Re:\s*/i, "")}`, body: out.text, inReplyTo: m.messageId, references: [...(m.references || []), m.messageId], attachments: out.attachments || [], identity: { verified: true, method: "local-simulator" } });
      count++;
    }
    store.setMeta("sim:answered", [...answered]);
    return { replies: count };
  };

  // ------------------------------------------------------------ manager operations (dashboard)
  const OPS = {
    accept: (ev, ctx, actor) => D.acceptOwnership(ev, ctx, actor),
    requestQuotes: (ev, ctx, actor, a) => D.requestQuotes(ev, ctx, actor, a.supplierIds || app.venueIds()),
    authorize: (ev, ctx, actor) => D.authorizeSupplierAction(ev, ctx, actor),
    reviewClause: (ev, ctx, actor, a) => D.reviewClause(ev, ctx, actor, a.contractId || ev.commitment?.contractId || Object.keys(ev.contracts)[0], a.ruleRef, a),
    manualDecision: (ev, ctx, actor, a) => D.manualDecision(ev, ctx, actor, a),
    pause: (ev, ctx, actor) => D.setPaused(ev, ctx, actor, true),
    resume: (ev, ctx, actor) => D.setPaused(ev, ctx, actor, false),
    rename: (ev, ctx, actor, a) => D.renameEvent(ev, ctx, actor, a.title),
    resolveFlag: (ev, ctx, actor, a) => {
      if (!D.isOwner(ev, actor)) throw new D.AuthError(`Only the owning event manager can mark review items as reviewed`);
      const f = ev.reviewQueue.find((x) => x.id === a.flagId && x.open);
      if (!f) throw new D.PrereqError("No open review item with that id");
      f.open = false; f.resolvedBy = actor; f.resolvedAt = ctx.now;
      ev.history.push({ seq: ev.history.length + 1, at: ctx.now, actor, action: "review.resolved", summary: `${displayName(actor)} marked “${f.text}” as reviewed`, source: f.source || {}, configVersion: CONFIG.version });
    },
    timeouts: (ev, ctx) => D.sweepTimeouts(ev, ctx),
  };
  // One event operation in one transaction: version check, domain rule, outgoing mail, optional company
  // audit row, idempotency record. A retry with the same requestId returns the first result.
  async function runEventOp(eventId, actor, fn, { expectedVersion = null, requestId = null, scope = "mgr", audit = null, via = null } = {}) {
    const key = requestId ? `${scope}:${requestId}` : null;
    if (key && store.seen(key)) return { duplicate: true, ...store.seen(key).result };
    let result;
    store.tx(() => {
      const ev = store.getEvent(eventId);
      if (!ev) throw Object.assign(new Error("no such event"), { status: 404 });
      if (expectedVersion != null && ev.version !== expectedVersion) throw new ConflictError(`This request changed (now v${ev.version}) since you loaded it (v${expectedVersion}). Reload to see the newer decisions before acting.`);
      const ctx = D.newCtx(store, now(), actor);
      ctx.opKey = requestId || `${scope}:${rid()}`;
      if (via) ctx.via = via; // e.g. "admin console": who actually clicked, recorded next to the manager it was done for
      const r = fn(ev, ctx) || {};
      compose(ev, ctx, null);
      store.saveEvent(ev, ev.version);
      if (audit) store.insertAudit({ at: new Date().toISOString(), configVersion: CONFIG.version, eventId: ev.id, eventCreatedAt: ev.createdAt, ...audit(ev, r) });
      result = { ok: true, version: ev.version, ...(r.request ? { requestId: r.request.id } : {}) };
      if (key) store.remember(key, result, now());
    });
    advance(5);
    await app.flush();
    return result;
  }
  app.manager = async (eventId, actor, action, args = {}, opts = {}) => {
    if (!OPS[action]) throw Object.assign(new Error("unknown action"), { status: 400 });
    if (!person(actor)) throw Object.assign(new Error(`${actor} isn't in the company`), { status: 403 });
    return runEventOp(eventId, actor, (ev, ctx) => OPS[action](ev, ctx, actor, args), { ...opts, scope: "mgr" });
  };

  // ------------------------------------------------------------ administrator operations on requests
  // `admin` is a server-derived context ({ id, label }), never a client-supplied string.
  app.routeRequest = (eventId, admin, manager, opts = {}) => runEventOp(eventId, admin.id, (ev, ctx) => D.routeRequest(ev, ctx, admin, String(manager || "").toLowerCase()), {
    ...opts, scope: "admin",
    audit: (ev, r) => ({ actor: admin.id, action: r.before.owner ? "request.reassigned" : "request.routed", entity: `request:${ev.id}`, before: r.before, after: r.after, details: { text: `${ev.title} (${ev.id}) ${r.before.owner ? `reassigned from ${displayName(r.before.owner)}` : "routed"} to ${displayName(r.after.routedTo)}; not yet accepted` } }),
  });
  app.reassignApproval = (eventId, admin, approvalId, approver, opts = {}) => runEventOp(eventId, admin.id, (ev, ctx) => D.reassignApproval(ev, ctx, admin, approvalId, String(approver || "").toLowerCase()), {
    ...opts, scope: "admin",
    audit: (ev, r) => ({ actor: admin.id, action: "approval.reassigned", entity: `approval:${ev.id}/${approvalId}`, before: { approver: r.before }, after: { approver: r.after }, details: { text: `${approvalId} on ${ev.title} (${ev.id}) assigned to ${displayName(r.after)}${r.before ? ` (was ${displayName(r.before)})` : ""}` } }),
  });

  // Retry a failed delivery. The same queued message is sent again (same Message-ID, same dedupe key).
  app.retryDelivery = async (outboxId) => {
    const o = store.outbox().find((x) => x.id === outboxId);
    if (!o) throw Object.assign(new Error("No such outgoing message"), { status: 404 });
    if (o.status !== "failed" && o.status !== "held-not-allowlisted") return { ok: true, unchanged: true, status: o.status };
    store.requeueOutbox(outboxId);
    await app.flush();
    return { ok: true, status: store.outbox().find((x) => x.id === outboxId).status };
  };

  // Intake review: inbound mail Plannie recorded but couldn't attach to a request.
  app.intakeReview = () => store.listMessages("direction!='plannie' AND event_id IS NULL AND seen_by_plannie=1").filter((m) => m.notes?.length).map((m) => {
    const reason = m.notes.at(-1);
    const unknownSender = /not a configured company requester/.test(reason);
    return {
      msgId: m.id, from: m.from, subject: m.subject, at: m.at, reason, preview: m.body.slice(0, 160),
      kind: unknownSender ? "unknown_sender" : /Supplier email/.test(reason) ? "unmatched_supplier" : /Ambiguous/.test(reason) ? "ambiguous" : /loop prevention/.test(reason) ? "ignored" : "other",
      canReprocess: unknownSender && can(m.from, "event.request") && !store.seen(`intake:${m.id}`),
      reprocessed: !!store.seen(`intake:${m.id}`),
    };
  }).filter((x) => x.kind !== "ignored");
  // Reprocess one held message after an administrator added its sender. Once only (idempotent), and the
  // sender gets exactly the powers the company configuration now gives them.
  app.reprocessIntake = async (msgId, admin) => {
    const key = `intake:${msgId}`;
    if (store.seen(key)) return { duplicate: true, ...store.seen(key).result };
    const m = store.getMessage(msgId);
    if (!m || m.eventId || m.direction === "plannie") throw Object.assign(new Error("Nothing to reprocess"), { status: 404 });
    if (!can(m.from, "event.request")) throw Object.assign(new Error(`${m.from} still isn't a configured requester. Add them on the People page first.`), { status: 422 });
    store.tx(() => {
      store.updateMessage(m.id, { seenByPlannie: false, notes: [...(m.notes || []), `Reprocessed by ${admin.label}`] });
      store.remember(key, { ok: true }, now());
      store.insertAudit({ at: new Date().toISOString(), actor: admin.id, action: "intake.reprocessed", entity: `message:${m.id}`, before: { reason: m.notes?.at(-1) || null }, after: null, details: { text: `Reprocessed a held email from ${m.from} (“${m.subject}”)` }, configVersion: CONFIG.version });
    });
    await app.ingest(m.id);
    const after = store.getMessage(m.id);
    if (after.eventId) store.tx(() => store.remember(key, { ok: true, eventId: after.eventId }, now()));
    return { ok: true, eventId: after.eventId || null };
  };

  // ------------------------------------------------------------ status (grounded in the record)
  function statusText(ev) {
    const v = D.views(ev), st = D.status(ev);
    const lines = [`**Status: ${st.label}.**`];
    const w = ev.working;
    lines.push(`- Plan: ${w.headcount ?? "?"} people, ${D.fmtDate(w.date)}, ${D.fmtField("nights", w.nights)}${w.roomPolicy ? ", one room each" : ""}.`);
    lines.push(`- Finance: ${v.approved ? `${v.approved.ref} approved ${D.money(v.approved.amount)} for ${D.fmtDate(v.approved.date)} (cap ${D.money(v.approved.cap)})` : "nothing approved yet"}${ev.approvals.some((a) => a.status === "pending") ? `; waiting on ${ev.approvals.filter((a) => a.status === "pending").map((a) => a.id).join(", ")}` : ""}.`);
    lines.push(`- Booking: ${v.committed ? `${v.committed.supplier} confirmed ${v.committed.ref} for ${D.fmtDate(v.committed.date)}, ${v.committed.headcount} people, ${D.money(v.committed.amount)}` : "nothing booked"}.`);
    const waiting = ev.supplierRequests.filter((r) => r.status === "sent").map((r) => `${D.supplierName(r.supplierId)} (${r.type})`);
    if (waiting.length) lines.push(`- Waiting on: ${waiting.join(", ")}.`);
    if (v.drift.length) lines.push(`- Not yet aligned: ${v.drift.join(", ")} differ between the plan, approval and booking.`);
    const lastIn = store.listMessages("event_id=? AND direction!='plannie'", ev.id).at(-1);
    lines.push(`\nLast update I received: ${lastIn ? new Date(lastIn.at).toLocaleString("en-US", { timeZone: COMPANY.timezone, dateStyle: "medium", timeStyle: "short" }) : "—"}. I only know about emails I'm copied on.`);
    return lines.join("\n");
  }
  app.statusText = (eventId) => statusText(store.getEvent(eventId));

  // ------------------------------------------------------------ demo runner
  // Reset only the requests and mail (company configuration untouched): the original demo reset.
  app.resetDemo = () => {
    const id = store.getMeta("demo:scenario");
    store.reset(); // demo state only; company configuration and its audit log live in their own tables
    if (id) store.setMeta("demo:scenario", id);
    store.setMeta("clock", demoScenario().start || DEMO_START);
    store.setMeta("demo:step", 0);
  };
  // Load a demo scenario from scratch: its company (people, roles, policy) through the normal audited save,
  // an empty request history, a fresh activity log, and the scenario's own clock.
  app.loadScenario = (id) => {
    const sc = SCENARIOS[id];
    if (!sc) throw Object.assign(new Error(`Unknown demo scenario "${id}"`), { status: 400 });
    store.reset();
    store.clearAudit();
    store.setMeta("clock", sc.start); // before anything is recorded, so the whole demo shares one clock
    setCompany(sc.company);
    saveCompany(store, { people: sc.org.people, roles: sc.org.roles, policy: sc.policy }, {
      expectedVersion: store.getConfig().version, actor: "demo setup", action: "config.sample_restored",
      summary: `Loaded the demo company ${sc.company.name}: ${sc.org.people.length} people, ${Object.keys(sc.org.roles).length} roles.`, source: "sample",
    });
    // One clear activity entry for the setup instead of a row per person and role.
    store.restartConfigVersion();
    applyRuntime(store.getConfig());
    store.clearAudit();
    store.insertAudit({ at: new Date().toISOString(), actor: "demo setup", action: "config.sample_restored", entity: "company", before: null, after: { people: sc.org.people.length, roles: Object.keys(sc.org.roles).length }, details: { text: `Loaded demo #${sc.number}: ${sc.company.name}, ${sc.org.people.length} people and ${Object.keys(sc.org.roles).length} roles.` }, configVersion: CONFIG.version });
    store.setMeta("demo:scenario", sc.id);
    store.setMeta("clock", sc.start);
    store.setMeta("demo:step", 0);
    return { ok: true, scenario: sc.id };
  };
  const DEMO_ADMIN = Object.freeze({ id: "admin", label: "Administrator" });
  // Whose eyes the step is seen through: the sender of an email, the event manager acting, the administrator,
  // or Planned. The console uses it to show (and act as) that person.
  const viewOf = (st) => {
    if (!st) return null;
    const ev = st.event != null ? eventAt(st.event) : eventAt(0);
    const who = st.kind === "email" ? st.from : st.kind === "manager" ? st.actor || ev?.owner || ev?.routedTo : st.kind === "admin" ? "admin" : "planned";
    const p = who && who.includes("@") ? person(who) : null;
    const role = p ? (ORG.people.find((x) => x.email === p.email || x.email === who)?.roles || []).map((r) => ORG.roles[r]?.label || r).join(", ") : null;
    return { who, name: who === "admin" ? "Administrator" : who === "planned" ? "Planned" : p?.name || who, role: who === "admin" ? "Company console" : who === "planned" ? "Venue partner" : role || null, eventId: ev?.id || null };
  };
  const demoDestination = (step, message, eventId) => {
    if (step.op === "editTimeout") return step.adminPath;
    if (eventId && step.simulateApprovalFailure) return `/admin/requests/${eventId}#open-items`;
    if (message?.eventId) return `/admin/requests/${message.eventId}?tab=conversations&msg=${message.id}`;
    if (message?.seenByPlannie && message.notes?.length) return `/admin/requests#held-${message.id}`;
    if (step.op === "people") return "/admin/people";
    if (!eventId || step.kind === "email" || step.op === "reprocess") return step.adminPath || "/admin/requests";
    const request = `/admin/requests/${eventId}`;
    if (step.op === "handoff") return `${request}?tab=details#request-export`;
    if (step.action === "timeouts" || (step.action === "accept" && store.getEvent(eventId)?.paused)) return `${request}#open-items`;
    if (step.op === "route" || step.action === "accept") return `${request}#request-owner`;
    if (step.op === "assignApproval") return `${request}#open-items`;
    if (step.kind === "supplier" || step.action === "requestQuotes" || step.action === "authorize") return `${request}#planned`;
    if (["reviewClause", "manualDecision", "resume"].includes(step.action)) return `${request}?tab=history`;
    return request;
  };
  app.demoInfo = () => {
    const sc = demoScenario(); const step = store.getMeta("demo:step", 0); const st = sc.steps[step - 1];
    const view = viewOf(st);
    const approvalMail = (st?.simulateApprovalFailure || st?.op === "retryApproval") && view?.eventId
      ? store.listMessages("direction='plannie' AND event_id=? AND json_extract(meta, '$.kind')='approval'", view.eventId).at(-1)
      : null;
    const message = st?.kind === "email"
      ? store.listMessages("direction='human' AND json_extract(meta, '$.fixtureKey')=?", st.fixture || st.key).at(-1)
      : st?.op === "reprocess"
        ? store.listMessages("direction='human' AND from_addr=? AND event_id IS NOT NULL", st.from).at(-1)
        : approvalMail;
    return { scenario: { id: sc.id, number: sc.number, title: sc.title, company: sc.company.name, tagline: sc.tagline }, step, steps: sc.steps.length,
      current: st ? { key: st.key, title: st.title, adminPath: demoDestination(st, message, view?.eventId), kind: st.kind, op: st.op || null, view,
        storyMessageId: (approvalMail || message)?.id || null,
        timeoutEdit: st.op === "editTimeout" ? store.getMeta(`demo:timeout:${st.key}`, null) : null,
        focusPerson: st.op === "people" ? st.patch.add?.[0]?.email || Object.keys(st.patch.update || {})[0] || null : null } : null,
      next: sc.steps[step]?.title || null };
  };

  const eventAt = (i = 0) => store.listEvents().sort((a, b) => +a.id.replace(/\D/g, "") - +b.id.replace(/\D/g, ""))[i] || null;
  // Apply a People-page style change (as the admin would in the console): roles merged, people updated,
  // added or removed. Same validation, review and audit as the console's save.
  function applyPeoplePatch(patch, summary) {
    const cur = currentDoc();
    const roles = { ...cur.org.roles };
    for (const [rid_, r] of Object.entries(patch.roles || {})) { if (r) roles[rid_] = r; else delete roles[rid_]; }
    let people = cur.org.people.map((p) => (patch.update?.[p.email] ? { ...p, ...patch.update[p.email] } : p));
    people = people.filter((p) => !(patch.remove || []).includes(p.email));
    const existing = new Set(people.map((p) => p.email));
    people.push(...(patch.add || []).filter((p) => !existing.has(p.email)));
    return saveCompany(store, { people, roles, policy: cur.policy }, { expectedVersion: CONFIG.version, actor: DEMO_ADMIN.id, action: "org.edited", summary, events: store.listEvents() });
  }
  // Undo scripted directory edits before replaying. Keep unrelated settings and values the user has edited
  // since the script ran. Older demos can use the scenario's original directory for these changes.
  function restoreDemoDirectory(sc, stepCount) {
    const cur = currentDoc();
    const org = structuredClone(cur.org);
    for (const step of sc.steps.slice(0, stepCount).reverse()) {
      if (step.op !== "people") continue;
      const { before, after } = store.getMeta(`demo:people:${step.key}`) || { before: sc.org };
      const patch = step.patch;
      const prior = new Map(before.people.map((p) => [p.email, p]));
      const applied = new Map(after?.people.map((p) => [p.email, p]));
      for (const p of org.people) {
        const previous = prior.get(p.email);
        if (!previous) continue;
        for (const [field, value] of Object.entries(patch.update?.[p.email] || {})) {
          if (isDeepStrictEqual(p[field], applied.get(p.email)?.[field] ?? value)) p[field] = previous[field];
        }
      }
      for (const added of patch.add || []) {
        if (prior.has(added.email)) continue;
        const person = org.people.find((p) => p.email === added.email);
        const expected = applied.get(added.email) || added;
        const referenced = [cur.policy.defaultManager, cur.policy.defaultFinanceApprover].includes(added.email) ||
          org.people.some((p) => p.manager === added.email || p.backup === added.email);
        const unchanged = after ? isDeepStrictEqual(person, expected) : person && Object.entries(expected).every(([field, value]) => isDeepStrictEqual(person[field], value));
        if (unchanged && !referenced) org.people = org.people.filter((p) => p.email !== added.email);
      }
      for (const [id, role] of Object.entries(patch.roles || {})) {
        if (!isDeepStrictEqual(org.roles[id] ?? null, after?.roles[id] ?? role)) continue;
        if (before.roles[id]) org.roles[id] = before.roles[id];
        else if (!org.people.some((p) => p.roles.includes(id))) delete org.roles[id];
      }
    }
    if (isDeepStrictEqual(org, cur.org)) return;
    const config = store.getConfig();
    store.saveConfig({ ...config, doc: { ...cur, org } }, config.version);
    applyRuntime(store.getConfig());
  }

  app.demoBack = async () => {
    const current = store.getMeta("demo:step", 0);
    if (!current) return { step: 0 };
    const target = current - 1;
    const earlier = Array.from({ length: Math.max(0, target - 1) }, (_, index) => [`demo:review:${index + 1}`, store.getMeta(`demo:review:${index + 1}`)]);
    const sc = demoScenario();
    restoreDemoDirectory(sc, current);
    for (const step of sc.steps.slice(0, current).reverse()) {
      if (step.op !== "editTimeout") continue;
      const edit = store.getMeta(`demo:timeout:${step.key}`);
      if (!edit || edit.before === edit.after) continue;
      const config = store.getConfig();
      if (config.doc.policy.supplierTimeoutHours === edit.after) {
        const doc = { ...config.doc, policy: { ...config.doc.policy, supplierTimeoutHours: edit.before } };
        store.saveConfig({ ...config, doc }, config.version);
        applyRuntime(store.getConfig());
      }
      store.clearDemoRuleAudit();
    }
    app.resetDemo();
    for (const [key, snapshot] of earlier) if (snapshot) store.setMeta(key, snapshot);
    store.clearRequestAudit();
    for (let k = 0; k < target; k++) await app.demoStep();
    return { step: target };
  };
  app.demoReview = (step) => {
    const live = store.getMeta("demo:step", 0);
    if (!Number.isInteger(step) || step < 1 || step > live) return null;
    return step === live ? app.snapshot() : store.getMeta(`demo:review:${step}`);
  };

  // Databases created before review snapshots existed can still review the scripted story.
  // Run before listening so the temporary company configuration is never visible to a request.
  app.backfillDemoReviews = async () => {
    const live = store.getMeta("demo:step", 0);
    const missing = Array.from({ length: Math.max(0, live - 1) }, (_, i) => i + 1)
      .filter((step) => !store.getMeta(`demo:review:${step}`));
    if (!missing.length) return;
    const selected = demoScenario();
    const archive = openDb(":memory:");
    try {
      const replay = createApp({ store: archive, transport: localTransport() });
      replay.loadScenario(selected.id);
      const needed = new Set(missing);
      for (let step = 1; step <= missing.at(-1); step++) {
        await replay.demoStep();
        if (needed.has(step)) store.setMeta(`demo:review:${step}`, archive.getMeta(`demo:review:${step}`));
      }
    } finally {
      archive.close();
      setCompany(selected.company);
      applyRuntime(store.getConfig());
    }
  };
  app.demoStep = async () => {
    const steps = demoScenario().steps;
    const i = store.getMeta("demo:step", 0);
    const step = steps[i];
    if (!step) return { done: true };
    // A "Hold for a check" rule pauses a request until someone resumes it. In the story, the administrator
    // does that check before the next step, on the record, so the script can carry on.
    const autoResume = !step.keepRuleHold && step.action !== "resume";
    for (const held of autoResume ? store.listEvents().filter((e) => e.paused && e.pausedBy === "rules") : []) {
      store.tx(() => {
        const e = store.getEvent(held.id);
        e.paused = false; e.pausedBy = null; e.pausedAt = null;
        e.history.push({ seq: e.history.length + 1, at: now(), actor: "admin", action: "flow.resumed", summary: "Checked by the administrator and resumed (company rule)", source: {} });
        store.saveEvent(e, e.version);
      });
    }
    const ev = step.event != null ? eventAt(step.event) : eventAt(0);
    if (step.kind === "email") {
      const to = (step.to || []).map((a) => (a === "$intake" ? PLANNIE.intake : a));
      let parent = null, toList = to, ccList = step.cc || [];
      if (step.replyTo) {
        parent = findReplyTarget(step.replyTo, step.from, step.event != null ? ev?.id : null);
        if (!parent) throw new Error(`Demo step ${step.key}: no message to reply to (${step.replyTo})`);
        toList = [parent.from]; ccList = [...parent.to, ...parent.cc].filter((a) => a !== step.from && a !== parent.from);
      }
      if (step.simulateApprovalFailure) store.setMeta("demo:fail-approval-delivery", true);
      try {
        await app.sendMail({ from: step.from, to: toList, cc: ccList, subject: step.subject, body: step.body, inReplyTo: parent?.messageId || null, references: parent ? [...(parent.references || []), parent.messageId] : [], meta: { fixtureKey: step.fixture || step.key }, ...(step.identity ? { identity: step.identity } : {}) });
      } finally {
        if (step.simulateApprovalFailure) store.setMeta("demo:fail-approval-delivery", false);
      }
    } else if (step.kind === "manager") {
      // The demo acts as whoever the request is actually routed to or owned by (not a hardcoded manager).
      if (step.waitForSupplierTimeout) advance(POLICY.supplierTimeoutHours * 60);
      if (step.action !== "resume" || ev.paused) {
        await app.manager(ev.id, step.actor || ev?.owner || ev?.routedTo || defaultManager(), step.action, step.args || {}, { requestId: `demo-${step.key}` });
      }
    } else if (step.kind === "supplier") {
      // With automatic follow-ups turned off on the Rules page, nobody has asked the venue again after a plan
      // change. The script expects an answer here, so the event manager asks by hand, as they would for real.
      for (const target of store.listEvents()) {
        const waiting = target.supplierRequests.some((r) => r.status === "sent" || r.status === "queued");
        // The venue that needs a new price: the chosen one if its quote went stale, else the latest stale quote
        // when no current one is left.
        const chosen = target.selection ? target.proposals.find((p) => p.id === target.selection.proposalId) : null;
        const stale = chosen ? (chosen.status === "stale" ? chosen : null) : target.proposals.some((p) => p.status === "current") ? null : [...target.proposals].reverse().find((p) => p.status === "stale");
        if (!target.owner || target.paused || waiting || !stale) continue;
        if (target.proposals.some((p) => p.status === "current" && p.supplierId === stale.supplierId)) continue;
        await app.manager(target.id, target.owner, "requestQuotes", { supplierIds: [stale.supplierId] }, { requestId: `demo-${step.key}-ask-${target.id}` });
      }
      await app.supplierTick();
    } else if (step.kind === "admin") {
      if (step.op === "assignApproval") {
        const a = step.approval ? ev.approvals.find((x) => x.id === step.approval) : ev.approvals.find((x) => x.status === "pending");
        if (!a) throw new Error(`Demo step ${step.key}: no pending approval`);
        // A company rule may already have sent it there (an "escalate" step on the Rules page): nothing to do.
        if (!samePerson(a.approver, step.to)) await app.reassignApproval(ev.id, DEMO_ADMIN, a.id, step.to, { requestId: `demo-${step.key}` });
      } else if (step.op === "route") {
        await app.routeRequest(ev.id, DEMO_ADMIN, step.to, { requestId: `demo-${step.key}` });
      } else if (step.op === "people") {
        const before = currentDoc().org;
        applyPeoplePatch(step.patch, step.title);
        store.setMeta(`demo:people:${step.key}`, { before, after: currentDoc().org });
      } else if (step.op === "reprocess") {
        const held = app.intakeReview().find((m) => m.from === step.from && m.canReprocess);
        if (held) await app.reprocessIntake(held.msgId, DEMO_ADMIN);
        else if (!store.listMessages("direction='human'").some((m) => m.from === step.from && m.eventId && m.meta?.fixtureKey)) {
          throw new Error(`Demo step ${step.key}: nothing held from ${step.from} that can be reprocessed`);
        }
      } else if (step.op === "retryApproval") {
        const failed = store.outbox("failed").find((o) => {
          const message = store.getMessage(o.messageId);
          return message.eventId === ev.id && message.meta?.kind === "approval";
        });
        if (failed) await app.retryDelivery(failed.id);
      } else if (step.op === "editTimeout") {
        const { org, policy } = currentDoc();
        const before = policy.supplierTimeoutHours;
        const after = Math.min(before, step.timeoutHours);
        saveCompany(store, { ...org, policy: { ...policy, supplierTimeoutHours: after } }, {
          expectedVersion: CONFIG.version, actor: "demo script", action: "policy.saved",
          summary: `Venue reply deadline changed from ${before} to ${after} hours.`, events: store.listEvents(),
        });
        store.setMeta(`demo:timeout:${step.key}`, { before, after });
      } else if (step.op !== "handoff") {
        throw new Error(`Demo step ${step.key}: unknown admin operation ${step.op}`);
      }
    }
    store.setMeta("demo:step", i + 1);
    advance(12);
    const reviewKey = `demo:review:${i + 1}`;
    if (!store.getMeta(reviewKey)) store.setMeta(reviewKey, app.snapshot());
    return { step: step.key, done: i + 1 >= steps.length };
  };
  function findReplyTarget(kind, from, eventId = null) {
    const mine = store.listMessages("direction='plannie'").filter((m) => [...m.to, ...m.cc].includes(from) && (!eventId || m.eventId === eventId));
    if (kind === "plannie-latest") return mine.filter((m) => m.meta?.kind !== "approval" && m.meta?.kind !== "approval-receipt" && !m.threadId?.includes("approval")).at(-1);
    if (kind === "plannie-comparison") return mine.filter((m) => m.meta?.kind === "comparison").at(-1);
    if (kind === "plannie-approval") return mine.filter((m) => m.meta?.kind === "approval").at(-1);
    return null;
  }

  // Exchanges with Planned, in the order they happened. In the product these travel over Planned's MCP
  // connector; in the demos the answers are sample data. Read from the requests ccPlannie sent and the
  // structured answers it received (venue mail is internal plumbing and never shown as email).
  app.plannedExchanges = (eventId = null) => {
    const out = [];
    for (const m of store.listMessages()) {
      if (eventId && m.eventId !== eventId) continue;
      if (m.direction === "plannie" && m.meta?.kind === "supplier-request") {
        const f = parseRequestBlock(m.body) || {};
        const s = supplierByEmail(m.to[0]);
        out.push({ id: m.id, at: m.at, eventId: m.eventId, direction: "to", type: f.type, venue: s?.name || m.to[0], venueId: s?.id || null, city: s?.city || null,
          fields: { date: f.date, nights: +f.nights || null, headcount: +f.headcount || null, rooms: +f.rooms || null, amount: f.amount ? +f.amount : null, bookingRef: f["booking-ref"] || null, requestRef: f["request-ref"] } });
      } else if (m.direction === "supplier") {
        const b = parseOfferBlock(m.body) || {};
        const s = supplierByEmail(m.from);
        out.push({ id: m.id, at: m.at, eventId: m.eventId, direction: "from", type: b.type || "unstructured", venue: s?.name || m.from, venueId: s?.id || null, city: s?.city || null,
          fields: { date: b.date || null, nights: b.nights ? +b.nights : null, headcount: b.headcount ? +b.headcount : null, amount: b.amount ? +b.amount : null, includesFee: +b["includes-fee"] || 0, capacity: b.capacity ? +b.capacity : null, offerRef: b["offer-ref"] || null, bookingRef: b["booking-ref"] || null, contract: b.contract || null, reason: b.reason || null, requestRef: b["request-ref"] },
          attachments: (m.attachments || []).map((a) => a.name) });
      }
    }
    return out;
  };
  const isVenueMail = (m) => m.direction === "supplier" || (m.direction === "plannie" && m.meta?.kind === "supplier-request");

  // ------------------------------------------------------------ read models for the UI
  app.snapshot = (viewer = null) => {
    const demo = app.demoInfo();
    const events = store.listEvents().map((ev) => ({
      // Approval security codes never go to the browser.
      ...ev, approvals: ev.approvals.map(({ code, ...a }) => ({ ...a, blocker: D.approvalBlocker(a) })), statusInfo: D.status(ev), views: D.views(ev), impacts: D.impacts(ev, now()),
      threads: store.listThreads(ev.id).map((t) => ({ ...t, messages: store.listMessages("thread_id=?", t.id).map((m) => m.id) })),
    }));
    const outbox = store.outbox();
    const delivery = Object.fromEntries(outbox.map((o) => [o.messageId, o.status]));
    // The demo mailbox shows participant mail. Private intake stays in the dashboard, including after reprocessing.
    const messages = store.listMessages().filter((m) => {
      if (isVenueMail(m) || ![...m.to, ...m.cc].some((a) => !isPlannieAddress(a))) return false;
      if (m.direction === "plannie") return delivery[m.id] && delivery[m.id] !== "queued";
      if (isPlannieAddress(m.from) || store.seen(`intake:${m.id}`)) return false;
      return m.eventId || !m.seenByPlannie || !m.notes?.length;
    }).map((m) => ({ ...m, delivery: delivery[m.id] || null }));
    const sc = demoScenario();
    return {
      now: now(), mode: { interpreter: interpreterMode(), transport: transport.name, demo: !!store.getMeta("clock") },
      demo: {
        step: demo.step,
        adminPath: demo.current?.adminPath || null,
        focusMessageId: demo.current?.storyMessageId || null,
        timeoutEdit: demo.current?.timeoutEdit || null,
        scenario: { id: sc.id, number: sc.number, title: sc.title, tagline: sc.tagline, summary: sc.summary, company: sc.company.name, parts: sc.parts, people: Object.values(PEOPLE).filter((p) => !p.alias).length },
        scenarios: Object.values(SCENARIOS).map((x) => ({ id: x.id, number: x.number, title: x.title, tagline: x.tagline, summary: x.summary, company: x.company.name, people: x.org.people.length, parts: x.parts, steps: x.steps.length })),
        steps: sc.steps.map(({ key, part, kind, title, note, explain, planned, adminPath, op }) => ({ key, part, kind, title, note, explain, planned: planned || null, adminPath: adminPath || null, op: op || null })),
      },
      planned: app.plannedExchanges(),
      people: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, { id: p.id, name: p.name, title: p.title, caps: p.caps, roles: p.roles || [], manager: p.manager || null, alias: !!p.alias }])),
      roleLabels: Object.fromEntries(Object.entries(ORG.roles).map(([id, role]) => [id, role.label])),
      suppliers: Object.fromEntries(app.venueIds().map((id) => SUPPLIERS[id]).map((s) => [s.email, { id: s.id, name: s.name, city: s.city }])),
      plannie: { intake: PLANNIE.intake, from: PLANNIE.from },
      events, messages: viewer ? messages.filter((m) => !isPlannieAddress(viewer) && (m.from === viewer || m.to.includes(viewer) || m.cc.includes(viewer))) : messages, outbox,
      policy: { ...POLICY, configVersion: CONFIG.version },
    };
  };

  return app;
}
