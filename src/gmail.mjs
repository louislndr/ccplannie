// Gmail as Plannie's mailbox: a dedicated Gmail account, read over IMAP and sent from over SMTP with an
// app password. Free, no domain, no public URL (the server polls the inbox). Per-request replies use
// Gmail plus-addressing (plannie.you+e-1@gmail.com lands in the same inbox).
//
// Identity: Gmail's receiving server adds "Authentication-Results: mx.google.com; dkim=… dmarc=…" as the
// topmost such header. A sender counts as verified only when that Google-added header shows DKIM passing
// for the From domain (aligned) or DMARC passing for it. Headers further down can be forged by the sender
// and are ignored. Email approvals additionally need the one-time approval code, as with Postmark.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { isPlannieAddress } from "./config.mjs";
import { directoryAllowlist, envAllowlist, realRecipients, replyAddress, toHtml } from "./transport.mjs";

export const gmailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
// Live status for the Connections page (no secrets).
export const GMAIL_STATUS = { polling: false, lastPollAt: null, lastOkAt: null, lastError: null, received: 0, sent: 0 };

export function gmailTransport({ user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD, allowlist = directoryAllowlist, sendImpl = null } = {}) {
  if (!user || !pass) throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must both be set");
  const mailer = sendImpl ? null : nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  const send = sendImpl || ((m) => mailer.sendMail(m));
  return {
    name: envAllowlist().length ? `gmail (allowlist: ${envAllowlist().length} addresses)` : "gmail (company directory only)",
    async send(msg) {
      const r = realRecipients(msg, allowlist);
      if (r.result) return r.result;
      try {
        const info = await send({
          from: { name: "ccPlannie", address: user },
          to: r.to, cc: r.cc,
          replyTo: replyAddress(msg.eventId),
          subject: msg.subject, text: msg.body, html: toHtml(msg),
          // Keep Plannie's own Message-ID so replies' In-Reply-To match the stored message (threading).
          messageId: msg.messageId, inReplyTo: msg.inReplyTo || undefined, references: msg.references?.length ? msg.references : undefined,
          headers: { "X-Plannie-Message-Id": msg.messageId, "Auto-Submitted": "auto-generated" },
        });
        GMAIL_STATUS.sent++;
        return { status: "sent", providerId: info?.messageId || null, error: r.held.length ? `Not sent to ${r.held.join(", ")} (not in the company directory)` : null };
      } catch (e) {
        return { status: "failed", error: `Gmail SMTP: ${e.responseCode ? `${e.responseCode} ` : ""}${e.message}` };
      }
    },
  };
}

const lower = (a) => String(a || "").toLowerCase();
const addrs = (v) => (v ? (Array.isArray(v) ? v : [v]).flatMap((x) => (x.value || []).flatMap((y) => (y.group ? y.group : [y]))).map((y) => lower(y.address)).filter(Boolean) : []);
const domainOf = (email) => lower(email).split("@")[1] || "";
// Relaxed DMARC-style alignment: same domain, or one is a subdomain of the other.
export const aligned = (a, b) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

// Read Google's Authentication-Results header (the topmost one, which Google adds on receipt).
export function gmailIdentity(headerLines, fromEmail) {
  const first = headerLines.find((h) => h.key === "authentication-results");
  const value = first ? first.line.replace(/^[^:]*:\s*/, "").replace(/\r?\n\s+/g, " ") : "";
  if (!/^mx\.google\.com\s*;/i.test(value)) return { verified: false, method: "provider-unverified", evidence: value ? "Authentication-Results not added by Gmail" : "no Authentication-Results header" };
  const fd = domainOf(fromEmail);
  const dkim = [...value.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=@?([a-z0-9.-]+)/gi)].map((m) => lower(m[1]));
  const dmarc = [...value.matchAll(/\bdmarc=pass\b[^;]*?\bheader\.from=([a-z0-9.-]+)/gi)].map((m) => lower(m[1]));
  const verified = dkim.some((d) => aligned(d, fd)) || dmarc.some((d) => d === fd);
  return { verified, method: verified ? "provider" : "provider-unverified", evidence: value.slice(0, 500) };
}

// Raw RFC 822 message (Buffer or string) → the same normalized shape as the Postmark adapter.
export async function normalizeEmail(raw) {
  const p = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
  const from = addrs(p.from)[0];
  if (!from) throw Object.assign(new Error("Message has no From address"), { status: 400 });
  const headers = {};
  for (const h of p.headerLines) {
    const name = h.line.slice(0, h.line.indexOf(":")).trim();
    if (!(name in headers)) headers[name] = h.line.slice(h.line.indexOf(":") + 1).replace(/\r?\n\s+/g, " ").trim();
  }
  const to = addrs(p.to), cc = addrs(p.cc);
  // Gmail records the exact address that received the mail (e.g. a plus-address when Plannie was BCC'd).
  const delivered = lower(p.headers.get("delivered-to")?.value?.[0]?.address || p.headers.get("delivered-to") || "");
  if (delivered && isPlannieAddress(delivered) && !to.includes(delivered) && !cc.includes(delivered)) to.push(delivered);
  const refs = p.references ? (Array.isArray(p.references) ? p.references : String(p.references).split(/\s+/)) : [];
  return {
    messageId: p.messageId ? (p.messageId.startsWith("<") ? p.messageId : `<${p.messageId}>`) : null,
    from, to, cc,
    subject: p.subject || "", body: (p.text || "").trim(),
    inReplyTo: p.inReplyTo || null, references: refs.filter(Boolean),
    headers, at: new Date().toISOString(),
    attachments: (p.attachments || []).filter((a) => !a.related).map((a) => ({ name: a.filename || "attachment", contentType: a.contentType, content: a.content.toString("base64"), size: a.size })),
    identity: gmailIdentity(p.headerLines, from),
  };
}

// Poll the inbox for unread mail, hand each message to Plannie, then mark it read. Mail that was already in
// the inbox before Plannie was first connected (e.g. Google's welcome emails) is marked read and skipped.
export function startGmailPoller({ app, store, user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD, intervalMs = Number(process.env.GMAIL_POLL_SECONDS || 20) * 1000, imapFactory = null, log = console } = {}) {
  if (!store.getMeta("gmail:since")) store.setMeta("gmail:since", new Date().toISOString());
  // One minute of grace: IMAP dates are second-precision and clocks differ slightly.
  const since = new Date(new Date(store.getMeta("gmail:since")).getTime() - 60_000);
  const connect = imapFactory || (() => new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false }));
  let current = null, timer = null;
  GMAIL_STATUS.polling = true;
  // One check at a time: a call during a check waits for that check instead of starting another.
  const tick = () => (current ||= check().finally(() => { current = null; }));
  const check = async () => {
    GMAIL_STATUS.lastPollAt = new Date().toISOString();
    const client = connect();
    let handled = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];
        for (const uid of uids) {
          try {
            const m = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
            if (m?.source && !(m.internalDate && new Date(m.internalDate) < since)) {
              const n = await normalizeEmail(m.source);
              if ([...n.to, ...n.cc].some(isPlannieAddress) && !isPlannieAddress(n.from)) { await app.sendMail({ ...n, direction: "human" }); handled++; GMAIL_STATUS.received++; }
            }
          } catch (e) { log.error(`gmail: couldn't process message ${uid}: ${e.message}`); }
          // Mark read either way, so one bad message can't block the inbox. Stored messages stay deduplicated by Message-ID.
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }
      } finally { lock.release(); }
      await client.logout();
      GMAIL_STATUS.lastOkAt = new Date().toISOString(); GMAIL_STATUS.lastError = null;
    } catch (e) {
      GMAIL_STATUS.lastError = e.authenticationFailed || /auth/i.test(e.message) ? "Gmail sign-in failed. Check GMAIL_USER and the app password (not your normal password)." : e.message;
      log.error(`gmail: ${GMAIL_STATUS.lastError}`);
      try { client.close(); } catch {}
    }
    return { handled };
  };
  tick();
  timer = setInterval(tick, intervalMs); timer.unref?.();
  return { tick, stop() { clearInterval(timer); GMAIL_STATUS.polling = false; } };
}

