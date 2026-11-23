// Turns a company's written event policy into ccPlannie rules. The model only PROPOSES settings from the
// fixed menu (routing, approvers, follow-ups, extra steps); the proposal is then validated and shown as a
// review like any other change, and nothing is saved until an administrator confirms it.
import { z } from "zod/v4";
import { generateJson, llmProvider } from "./llm.mjs";
import { FLOW_POINTS, COMPANY } from "./config.mjs";

const Schema = z.object({
  defaultManager: z.string().nullable().describe("Email of the person new event requests go to, or null if the document doesn't say"),
  defaultFinanceApprover: z.string().nullable().describe("Email of the default spending approver, or null"),
  delegatedInquiries: z.boolean().nullable().describe("Should ccPlannie re-ask venues automatically when the plan changes? null if not stated"),
  supplierTimeoutHours: z.number().int().nullable().describe("Hours to wait for a venue before reminding the event manager, or null"),
  flow: z.array(z.object({
    kind: z.enum(["notify", "loopin", "hold", "escalate"]),
    after: z.enum(FLOW_POINTS.map((p) => p.id)).describe("For notify: the point after which to tell them"),
    who: z.string().describe("Email of the person"),
    over: z.number().nullable().describe("For escalate: amounts above this go to this approver"),
  })),
  notCovered: z.array(z.string()).describe("Short sentences for rules in the document that can't be expressed with these settings"),
});

const SYSTEM = `You read a company's event or travel policy and map it onto a FIXED set of settings for ccPlannie, an email assistant that routes event requests.
Only use these settings. Never invent people: every email you return must come from the directory provided. If the document names a role ("the controller"), pick the directory person who holds it.
Settings:
- defaultManager: who new requests go to (must be an event manager in the directory).
- defaultFinanceApprover: who approves spending by default (must be a finance approver).
- delegatedInquiries: whether venues are re-asked automatically when the plan changes.
- supplierTimeoutHours: hours before reminding the event manager when a venue hasn't answered.
- flow: extra steps. "notify" = email someone a one-time FYI when a request passes a point; "loopin" = copy someone on all of the request's emails from that point on; "hold" = pause the request at that point until an administrator resumes it (use for "must be checked by X before ..."; never at "sourcing"). Points (${FLOW_POINTS.map((p) => `${p.id}: ${p.label}`).join("; ")}). "escalate" = approvals above an amount go to a specific approver.
These always apply and are not settings: finance approves exact amounts within their limit; only the owning event manager books; nothing is booked until Planned confirms.
Put anything else the document requires (budgets per head, vendor lists, travel classes...) in notCovered, one short sentence each.`;

const directory = (people, roles) => people.map((p) => `- ${p.name} <${p.email}>, ${p.title || "no title"}; roles: ${p.roles.map((r) => roles[r]?.label || r).join(", ")}${p.approveUpTo ? `; approves up to ${p.approveUpTo}` : ""}`).join("\n");

export async function readPolicyDocument({ fileName, mimeType, data, text }, { people, roles, current, sample = null }) {
  const usable = (r) => ({
    policy: {
      ...current,
      ...(r.defaultManager ? { defaultManager: r.defaultManager.toLowerCase() } : {}),
      ...(r.defaultFinanceApprover ? { defaultFinanceApprover: r.defaultFinanceApprover.toLowerCase() } : {}),
      ...(typeof r.delegatedInquiries === "boolean" ? { delegatedInquiries: r.delegatedInquiries } : {}),
      ...(Number.isInteger(r.supplierTimeoutHours) ? { supplierTimeoutHours: r.supplierTimeoutHours } : {}),
      flow: (r.flow || []).map((s, i) => ({ id: `doc-${i + 1}`, kind: s.kind, after: s.kind === "escalate" ? "chosen" : s.after, who: s.kind === "hold" ? "" : (s.who || "").toLowerCase(), ...(s.kind === "escalate" ? { over: s.over } : {}) })),
    },
    notCovered: r.notCovered || [],
  });
  if (!llmProvider()) {
    if (sample) return { ...usable(sample), source: "sample", model: null };
    throw Object.assign(new Error("No AI model is configured, so documents can't be read. Set GEMINI_API_KEY and try again."), { status: 503 });
  }
  const isText = text != null || /^text\//.test(mimeType || "") || /\.(md|txt)$/i.test(fileName || "");
  const body = text ?? (isText ? Buffer.from(data || "", "base64").toString("utf8") : null);
  if (!isText && mimeType !== "application/pdf") throw Object.assign(new Error("Upload a PDF, a .txt or a .md file."), { status: 415 });
  // A busy model can retry for minutes; give up after 90 s (the sample document falls back to its recorded reading).
  let timer;
  const limit = new Promise((_, bad) => { timer = setTimeout(() => bad(Object.assign(new Error("The AI model took too long to answer. Try again in a minute."), { status: 504 })), 90000); });
  let out;
  try { out = await Promise.race([read(), limit]); }
  catch (e) { if (sample) return { ...usable(sample), source: "sample", model: null, fallbackReason: e.message }; throw e; }
  finally { clearTimeout(timer); }
  return { ...usable(out.data), source: "model", model: out.model };
  function read() { return generateJson({
    system: SYSTEM, schema: Schema, maxTokens: 3000,
    files: isText ? [] : [{ mimeType, data }],
    user: `Company: ${COMPANY.name}. Currency: ${COMPANY.currency}.\nDirectory:\n${directory(people, roles)}\n\n${isText ? `Policy document (${fileName || "text"}):\n"""\n${String(body).slice(0, 60000)}\n"""` : `The policy document is attached (${fileName}).`}`,
  }); }
}
