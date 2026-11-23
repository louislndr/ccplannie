// AgentMail as Plannie's mailbox (agentmail.to): a real address like plannie@agentmail.to with no domain and no
// Google account. Plannie polls the inbox over AgentMail's API (no public URL needed) and sends through it.
//
// Threading: AgentMail has no plus-addressing, so replies are matched to requests by In-Reply-To / References
// only (Plannie never guesses from subjects). AgentMail assigns the Message-ID of what it sends; that ID is
// stored as the outbox provider_id and recognized in replies (Store.getByRef).
//
// Identity: AgentMail reports SPF/DKIM/DMARC per message. A sender counts as verified only when DKIM passes
// for a domain aligned with the From domain, or DMARC passes for it. Email approvals also need the one-time code.
import { AgentMailClient } from "agentmail";
import { isPlannieAddress, setPlannieAddress } from "./config.mjs";
import { directoryAllowlist, envAllowlist, realRecipients, replyAddress, toHtml } from "./transport.mjs";
import { aligned } from "./gmail.mjs";

export const agentmailConfigured = () => !!process.env.AGENTMAIL_API_KEY;
export const AGENTMAIL_STATUS = { inbox: null, polling: false, lastPollAt: null, lastOkAt: null, lastError: null, received: 0, sent: 0 };

export const makeClient = () => new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });

// Find (or create) Plannie's inbox and make its address Plannie's address. Run before any mail flows.
export async function ensureInbox(client, { username = process.env.AGENTMAIL_INBOX || "plannie", displayName = "ccPlannie" } = {}) {
  const want = username.toLowerCase();
  const list = await client.inboxes.list({ limit: 100 });
  let inbox = (list.inboxes || []).find((i) => i.email.toLowerCase() === want || i.email.toLowerCase().split("@")[0] === want);
  if (!inbox) inbox = await client.inboxes.create({ username: want.includes("@") ? want.split("@")[0] : want, displayName });
  setPlannieAddress(inbox.email, { plus: false });
  AGENTMAIL_STATUS.inbox = inbox.email;
  return inbox;
}

export function agentmailTransport({ client, inboxId, allowlist = directoryAllowlist } = {}) {
  return {
    name: envAllowlist().length ? `agentmail (allowlist: ${envAllowlist().length} addresses)` : "agentmail (company directory only)",
    async send(msg) {
      const r = realRecipients(msg, allowlist);
      if (r.result) return r.result;
      try {
        const headers = { "X-Plannie-Message-Id": msg.messageId };
        if (msg.inReplyTo) headers["In-Reply-To"] = msg.inReplyTo;
        if (msg.references?.length) headers.References = msg.references.join(" ");
        const res = await client.inboxes.messages.send(inboxId, {
          to: r.to, cc: r.cc.length ? r.cc : undefined, replyTo: [replyAddress(msg.eventId)],
          subject: msg.subject, text: msg.body, html: toHtml(msg), headers,
        });
        AGENTMAIL_STATUS.sent++;
        return { status: "sent", providerId: res.messageId, error: r.held.length ? `Not sent to ${r.held.join(", ")} (not in the company directory)` : null };
      } catch (e) {
        return { status: "failed", error: `AgentMail ${e.statusCode || ""}: ${e.body?.message || e.message}`.trim() };
      }
    },
  };
}

const addr = (v) => {
  const s = String(v || "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
};
const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(",") : []).map(addr).filter(Boolean);
const angle = (id) => (!id ? null : id.startsWith("<") ? id : `<${id}>`);

export function agentmailIdentity(auth, from) {
  const fd = from.split("@")[1] || "";
  const a = auth || {};
  const verified = (a.dkim === "pass" && aligned(String(a.dkimDomain || "").toLowerCase(), fd)) || (a.dmarc === "pass" && aligned(String(a.dmarcDomain || "").toLowerCase(), fd));
  const evidence = ["spf", "dkim", "dmarc"].map((k) => `${k}=${a[k] || "none"}${a[`${k}Domain`] ? ` (${a[`${k}Domain`]})` : ""}`).join(" ");
  return { verified, method: verified ? "provider" : "provider-unverified", evidence: `AgentMail: ${evidence}` };
}

// AgentMail message → the normalized shape every mail adapter produces.
export function normalizeAgentmail(m) {
  const from = addr(m.from);
  if (!from) throw Object.assign(new Error("Message has no From address"), { status: 400 });
  const refs = Array.isArray(m.references) ? m.references : String(m.references || "").split(/\s+/);
  return {
    messageId: angle(m.messageId),
    from, to: list(m.to), cc: list(m.cc),
    subject: m.subject || "", body: (m.text || m.extractedText || "").trim(),
    inReplyTo: angle(m.inReplyTo) || null, references: refs.filter(Boolean).map(angle),
    headers: { ...(m.headers || {}), "X-AgentMail-Labels": (m.labels || []).join(",") },
    at: new Date().toISOString(),
    attachments: (m.attachments || []).map((a) => ({ name: a.filename || "attachment", contentType: a.contentType, size: a.size, content: null, providerAttachmentId: a.attachmentId })),
    identity: agentmailIdentity(m.authenticationResults, from),
  };
}

// Poll for new received mail (oldest first) and hand each message to Plannie. Mail that arrived before Plannie
// was first connected is skipped. Messages are deduplicated by Message-ID, so a re-poll never double-processes.
export function startAgentmailPoller({ app, store, client, inboxId, intervalMs = Number(process.env.AGENTMAIL_POLL_SECONDS || 15) * 1000, log = console } = {}) {
  const KEY = "agentmail:cursor";
  if (!store.getMeta(KEY)) store.setMeta(KEY, new Date().toISOString());
  let current = null, timer = null;
  AGENTMAIL_STATUS.polling = true;
  const check = async () => {
    AGENTMAIL_STATUS.lastPollAt = new Date().toISOString();
    let handled = 0;
    try {
      let pageToken, cursor = store.getMeta(KEY);
      do {
        // Look back 2 s past the cursor so nothing at the boundary is missed; already-stored messages are skipped.
        const page = await client.inboxes.messages.list(inboxId, { after: new Date(new Date(cursor).getTime() - 2000), ascending: true, includeUnauthenticated: true, limit: 50, pageToken });
        for (const item of page.messages || []) {
          const labels = item.labels || [];
          const created = new Date(item.timestamp || item.createdAt).toISOString();
          if (labels.includes("received") && !isPlannieAddress(addr(item.from)) && !store.getByMessageId(angle(item.messageId))) {
            try {
              const full = await client.inboxes.messages.get(inboxId, item.messageId);
              const n = normalizeAgentmail(full);
              if ([...n.to, ...n.cc].some(isPlannieAddress)) { await app.sendMail({ ...n, direction: "human" }); handled++; AGENTMAIL_STATUS.received++; }
            } catch (e) { log.error(`agentmail: couldn't process ${item.messageId}: ${e.message}`); }
          }
          if (created > cursor) { cursor = created; store.setMeta(KEY, cursor); }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      AGENTMAIL_STATUS.lastOkAt = new Date().toISOString(); AGENTMAIL_STATUS.lastError = null;
    } catch (e) {
      AGENTMAIL_STATUS.lastError = e.statusCode === 401 || e.statusCode === 403 ? "AgentMail rejected the API key. Check AGENTMAIL_API_KEY." : e.message;
      log.error(`agentmail: ${AGENTMAIL_STATUS.lastError}`);
    }
    return { handled };
  };
  const tick = () => (current ||= check().finally(() => { current = null; }));
  tick();
  timer = setInterval(tick, intervalMs); timer.unref?.();
  return { tick, stop() { clearInterval(timer); AGENTMAIL_STATUS.polling = false; } };
}

