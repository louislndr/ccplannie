// Outbound mail transports and the Postmark inbound adapter.
// Local (default): nothing leaves the machine; messages land in the local outbox / demo mailboxes.
// Postmark: real sending, but ONLY to addresses on PLANNIE_ALLOWLIST. Simulated supplier addresses never leave.
import { PLANNIE, PEOPLE, eventIdFromAddress } from "./config.mjs";
import { isSupplierAddress } from "./supplier-sim.mjs";

export function localTransport() {
  return { name: "local outbox", async send() { return { status: "delivered-local" } } };
}

// Who may receive real mail: PLANNIE_ALLOWLIST when set; otherwise exactly the people currently in the
// company directory (configured on the console's People page). Anyone else is held, never sent.
export const envAllowlist = () => (process.env.PLANNIE_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const directoryAllowlist = () => (envAllowlist().length ? envAllowlist() : Object.keys(PEOPLE));

// Split a message's recipients into who may get real mail and who is held. Simulated venues never leave.
// Returns { result } when nothing should be sent, else { to, cc, held }.
export function realRecipients(msg, allowlist = directoryAllowlist) {
  const all = [...msg.to, ...msg.cc];
  if (all.every(isSupplierAddress)) return { result: { status: "delivered-local" } };
  const allowed = typeof allowlist === "function" ? allowlist() : allowlist;
  const ok = (a) => allowed.includes(a.toLowerCase()) && !isSupplierAddress(a);
  const to = msg.to.filter(ok), cc = msg.cc.filter(ok);
  if (!to.length && !cc.length) return { result: { status: "held-not-allowlisted", error: `No allowlisted recipients among ${all.join(", ")}` } };
  return { to: to.length ? to : cc, cc: to.length ? cc : [], held: all.filter((x) => !ok(x) && !isSupplierAddress(x)) };
}
export const replyAddress = (eventId) => (eventId && PLANNIE.plus ? `${PLANNIE.local}+${eventId.toLowerCase()}@${PLANNIE.domain}` : PLANNIE.intake);

export function postmarkTransport({ token = process.env.POSTMARK_SERVER_TOKEN, allowlist = directoryAllowlist, stream = process.env.POSTMARK_MESSAGE_STREAM || "outbound", fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!token) throw new Error("POSTMARK_SERVER_TOKEN is not set");
  const list = () => (typeof allowlist === "function" ? allowlist() : allowlist);
  return {
    name: envAllowlist().length ? `postmark (allowlist: ${envAllowlist().length} addresses)` : "postmark (company directory only)",
    async send(msg) {
      const all = [...msg.to, ...msg.cc];
      if (all.every(isSupplierAddress)) return { status: "delivered-local" }; // simulated venues are local only
      const allowed = list();
      const ok = (a) => allowed.includes(a.toLowerCase()) && !isSupplierAddress(a);
      const to = msg.to.filter(ok), cc = msg.cc.filter(ok);
      if (!to.length && !cc.length) return { status: "held-not-allowlisted", error: `No allowlisted recipients among ${all.join(", ")}` };
      const eventId = msg.eventId;
      const res = await fetchImpl("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": token },
        body: JSON.stringify({
          From: `ccPlannie <${PLANNIE.from}>`,
          To: (to.length ? to : cc).join(","), Cc: to.length ? cc.join(",") : "",
          // Replies come back to the per-event address (Postmark MailboxHash), which is how threads map to events.
          ReplyTo: eventId ? `${PLANNIE.local}+${eventId.toLowerCase()}@${PLANNIE.domain}` : PLANNIE.intake,
          Subject: msg.subject, TextBody: msg.body, HtmlBody: toHtml(msg),
          Headers: [
            msg.inReplyTo && { Name: "In-Reply-To", Value: msg.inReplyTo },
            msg.references?.length && { Name: "References", Value: msg.references.join(" ") },
            { Name: "X-Plannie-Message-Id", Value: msg.messageId },
          ].filter(Boolean),
          MessageStream: stream, Tag: "plannie",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ErrorCode) return { status: "failed", error: `Postmark ${res.status}: ${j.Message || "error"}` };
      const held = all.filter((a) => !ok(a) && !isSupplierAddress(a));
      // Partial delivery is recorded, not hidden: the outbox keeps who was skipped.
      return { status: "sent", providerId: j.MessageID, error: held.length ? `Not sent to ${held.join(", ")} (not in the company directory)` : null };
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function toHtml(msg) {
  const body = esc(msg.body).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*\((.+?)\)\*/g, "<i>($1)</i>").replace(/\n/g, "<br>");
  const opts = msg.meta?.options;
  const table = opts?.length ? `<table style="border-collapse:collapse;margin:12px 0;font:14px -apple-system,Helvetica,sans-serif">${opts.map((o) => `<tr><td style="padding:8px 12px;border:1px solid #e5e5ea"><b>${o.n}. ${esc(o.supplier)}</b><br><span style="color:#6e6e73">${esc(o.city || "")} · up to ${o.capacity ?? "?"} guests</span></td><td style="padding:8px 12px;border:1px solid #e5e5ea;text-align:right">CAD ${o.amount?.toLocaleString("en-US") ?? "unknown"}${o.overBudget ? '<br><span style="color:#c93400">over budget</span>' : ""}</td></tr>`).join("")}</table>` : "";
  return `<div style="font:15px/1.5 -apple-system,Helvetica,sans-serif;color:#1d1d1f">${body}${table}${msg.meta?.footer ? `<p style="color:#6e6e73">${esc(msg.meta.footer)}</p>` : ""}</div>`;
}

// ---- Postmark inbound webhook → normalized message.
// Identity: Postmark exposes SpamAssassin results in X-Spam-Tests (e.g. DKIM_VALID_AU, SPF_PASS). We treat a message as
// provider-verified only when DKIM_VALID_AU (DKIM valid and aligned with the From domain) is present. Consequential
// approvals additionally require the one-time approval code from the request email. This relies on Postmark's documented
// spam headers; it has not been verified end-to-end in this repository.
export function normalizePostmark(p) {
  if (!p || typeof p !== "object" || !p.FromFull?.Email || !Array.isArray(p.ToFull)) throw Object.assign(new Error("Malformed Postmark payload"), { status: 400 });
  const headers = Object.fromEntries((p.Headers || []).map((h) => [h.Name, h.Value]));
  const hget = (n) => Object.entries(headers).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
  const spamTests = String(hget("X-Spam-Tests") || "");
  const verified = /\bDKIM_VALID_AU\b/.test(spamTests);
  const to = p.ToFull.map((x) => x.Email.toLowerCase());
  // Postmark puts the plus-address part in MailboxHash; rebuild the full event address so routing sees it.
  if (p.MailboxHash && !to.some(eventIdFromAddress)) to.push(`${PLANNIE.local}+${p.MailboxHash.toLowerCase()}@${PLANNIE.domain}`);
  const msgId = hget("Message-ID") || `<${p.MessageID}@postmark.inbound>`;
  return {
    messageId: msgId,
    from: p.FromFull.Email.toLowerCase(),
    to, cc: (p.CcFull || []).map((x) => x.Email.toLowerCase()),
    subject: p.Subject || "", body: p.TextBody || p.StrippedTextReply || "",
    inReplyTo: hget("In-Reply-To") || null, references: (hget("References") || "").split(/\s+/).filter(Boolean),
    headers, at: new Date().toISOString(),
    attachments: (p.Attachments || []).map((a) => ({ name: a.Name, contentType: a.ContentType, content: a.Content, size: a.ContentLength })),
    identity: { verified, method: verified ? "provider" : "provider-unverified", evidence: spamTests || "no X-Spam-Tests header" },
  };
}
