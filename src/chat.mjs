// "Ask Plannie" for the event manager (rendered with assistant-ui). Read-only: it answers from the event
// record and never takes actions. With credentials it uses Claude; otherwise a deterministic, labeled answerer.
import { generateText } from "./llm.mjs";
import * as D from "./domain.mjs";
import { displayName } from "./config.mjs";
import { interpreterMode } from "./interpret.mjs";

function record(store, ev) {
  const v = D.views(ev);
  return {
    id: ev.id, title: ev.title, status: D.status(ev).label, owner: ev.owner && displayName(ev.owner),
    working: ev.working, approved: v.approved, committed: v.committed, drift: v.drift,
    suggestions: ev.suggestions.map((s) => ({ id: s.id, by: displayName(s.by), fields: s.fields, status: s.status })),
    offers: ev.proposals.map((p) => ({ id: p.id, venue: D.supplierName(p.supplierId), amount: p.amount, date: p.terms.date, headcount: p.terms.headcount, status: p.status })),
    approvals: ev.approvals.map((a) => ({ id: a.id, status: a.status, amount: a.terms.amount, date: a.terms.date, approver: displayName(a.approver), decidedBy: a.decidedBy && displayName(a.decidedBy), cap: a.capTo })),
    supplierRequests: ev.supplierRequests.map((r) => ({ id: r.id, venue: D.supplierName(r.supplierId), type: r.type, status: r.status })),
    contractRules: Object.values(ev.contracts).flatMap((c) => c.rules.map((r) => ({ contract: c.id, ref: r.ref, amount: r.amount, minDaysBeforeArrival: r.minDaysBeforeArrival, reviewed: r.reviewed }))),
    impacts: D.impacts(ev, store.getMeta("clock") || new Date().toISOString()),
    history: ev.history.slice(-25).map((h) => `${h.at} ${displayName(h.actor)}: ${h.summary}`),
    openReviewItems: ev.reviewQueue.filter((f) => f.open).map((f) => f.text),
  };
}

export async function chat(store, app, { eventId, messages = [] }) {
  const ev = eventId ? store.getEvent(eventId) : store.listEvents()[0];
  if (!ev) return { text: "There's no event yet. CC ccPlannie on an email to start one.", source: "record" };
  const q = (messages.at(-1)?.content || "").toString();
  if (interpreterMode() === "model") {
    try {
      const res = await generateText({
        system: "You are ccPlannie, answering the company event manager's questions about ONE event. Answer only from the JSON record provided; if the record doesn't say, say you don't know. Keep the four states distinct: suggestions, working plan, approved plan, supplier commitment. You cannot take actions; point to the dashboard action instead. Be brief.",
        messages: [...messages.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) })), { role: "user", content: `Event record:\n${JSON.stringify(record(store, ev))}\n\nQuestion: ${q}` }],
      });
      return { text: res.text, source: `model (${res.model})` };
    } catch (e) { /* fall through to the deterministic answer */ }
  }
  const r = record(store, ev);
  const t = q.toLowerCase();
  let text;
  if (/approv|finance|cap|priya/.test(t)) text = r.approvals.length ? r.approvals.map((a) => `${a.id}: ${a.status} · ${D.money(a.amount)} for ${D.fmtDate(a.date)}${a.decidedBy ? ` · by ${a.decidedBy}` : ` · with ${a.approver}`}${a.cap ? ` · cap ${D.money(a.cap)}` : ""}`).join("\n") : "No approvals requested yet.";
  else if (/differ|drift|match|align/.test(t)) text = r.drift.length ? `These differ between plan, approval and booking: ${r.drift.join(", ")}.\nPlan: ${JSON.stringify(D.views(ev).working)}\nApproved: ${JSON.stringify(r.approved)}\nBooked: ${JSON.stringify(r.committed)}` : "Plan, approval and booking all match.";
  else if (/supplier|venue|quote|offer/.test(t)) text = r.offers.map((o) => `${o.id} ${o.venue}: ${D.money(o.amount)} · ${o.headcount} people · ${D.fmtDate(o.date)} · ${o.status}`).join("\n") || "No offers yet.";
  else if (/history|who|when|changed/.test(t)) text = r.history.slice(-10).join("\n");
  else if (/risk|impact|fee|contract/.test(t)) text = [...r.impacts.map((i) => `• ${i.text} (${i.basis})`), ...r.contractRules.map((c) => `• ${c.contract} §${c.ref}: ${D.money(c.amount)} if moved > ${c.minDaysBeforeArrival} days out · ${c.reviewed ? "reviewed" : "not reviewed"}`)].join("\n") || "Nothing flagged.";
  else text = app.statusText(ev.id).replace(/\*\*/g, "");
  return { text, source: "record (deterministic; no model configured)" };
}
