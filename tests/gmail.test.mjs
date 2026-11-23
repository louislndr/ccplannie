// Gmail mailbox adapter: MIME parsing, identity from Google's Authentication-Results, plus-address routing,
// directory-only sending, and the inbox poller. No network: SMTP and IMAP are faked.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PLANNIE_INTERPRETER = "fixture";
const { openDb } = await import("../src/db.mjs");
const { createApp } = await import("../src/app.mjs");
const { localTransport } = await import("../src/transport.mjs");
const { normalizeEmail, gmailIdentity, gmailTransport, startGmailPoller, GMAIL_STATUS } = await import("../src/gmail.mjs");
const { FIXTURE_INTERPRETATIONS } = await import("../src/demo.mjs");

const google = (from, { dkim = "pass", dmarc = "pass" } = {}) => `Authentication-Results: mx.google.com;\r\n       dkim=${dkim} header.i=@${from.split("@")[1]} header.s=s1 header.b=abc;\r\n       spf=pass smtp.mailfrom=${from};\r\n       dmarc=${dmarc} (p=NONE) header.from=${from.split("@")[1]}\r\n`;
function raw({ from, to = "plannie@plannie.example", cc = "", subject = "Hello", body = "Hi Plannie", id = "x1@mail.example", inReplyTo = "", auth = google(from), extra = "", delivered = "" }) {
  return Buffer.from(
    (delivered ? `Delivered-To: ${delivered}\r\n` : "") + auth + extra +
    `From: Someone <${from}>\r\nTo: ${to}\r\n${cc ? `Cc: ${cc}\r\n` : ""}Subject: ${subject}\r\nMessage-ID: <${id}>\r\n${inReplyTo ? `In-Reply-To: ${inReplyTo}\r\nReferences: ${inReplyTo}\r\n` : ""}Date: Sun, 22 Nov 2026 10:00:00 -0500\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);
}

test("parses a real-looking message into the normalized shape, with verified identity", async () => {
  const n = await normalizeEmail(raw({ from: "Dana@Acme.example", cc: "Leo <leo@acme.example>, plannie@plannie.example", to: "sam@acme.example", body: "Offsite for 30 in October" }));
  assert.equal(n.from, "dana@acme.example");
  assert.deepEqual(n.to, ["sam@acme.example"]);
  assert.deepEqual(n.cc, ["leo@acme.example", "plannie@plannie.example"]);
  assert.equal(n.messageId, "<x1@mail.example>");
  assert.match(n.body, /Offsite for 30/);
  assert.equal(n.identity.verified, true);
});

test("identity: only Google's own topmost header counts, and DKIM must align with the From domain", () => {
  const lines = (t) => t.split(/\r\n(?=\S)/).filter(Boolean).map((l) => ({ key: l.slice(0, l.indexOf(":")).toLowerCase(), line: l }));
  assert.equal(gmailIdentity(lines(google("a@acme.example")), "a@acme.example").verified, true);
  assert.equal(gmailIdentity(lines(google("a@acme.example", { dkim: "fail", dmarc: "fail" })), "a@acme.example").verified, false);
  // DKIM passes, but for another domain (e.g. a mailing service), and DMARC fails → not verified.
  assert.equal(gmailIdentity(lines(google("a@other.example", { dmarc: "fail" })), "a@acme.example").verified, false);
  // A forged "pass" header below Google's real "fail" header is ignored.
  assert.equal(gmailIdentity(lines(google("a@acme.example", { dkim: "fail", dmarc: "fail" }) + google("a@acme.example")), "a@acme.example").verified, false);
  // A header from some other server is not Google's verdict.
  assert.equal(gmailIdentity(lines("Authentication-Results: evil.example; dkim=pass header.i=@acme.example\r\n"), "a@acme.example").verified, false);
  assert.equal(gmailIdentity([], "a@acme.example").verified, false);
});

test("a BCC'd or plus-addressed delivery still routes to Plannie via Delivered-To", async () => {
  const n = await normalizeEmail(raw({ from: "dana@acme.example", to: "sam@acme.example", delivered: "plannie+e-1@plannie.example" }));
  assert.ok(n.to.includes("plannie+e-1@plannie.example"));
});

test("sending: company directory only, simulated venues stay local, Plannie's Message-ID and reply address are kept", async () => {
  const sent = [];
  const t = gmailTransport({ user: "plannie@plannie.example", pass: "x", allowlist: ["dana@acme.example"], sendImpl: async (m) => { sent.push(m); return { messageId: m.messageId }; } });
  const msg = { to: ["dana@acme.example"], cc: ["stranger@else.example"], subject: "Re: Offsite", body: "**Hi**", messageId: "<m-1.ab@mail.local>", inReplyTo: "<x1@mail.example>", references: ["<x1@mail.example>"], eventId: "E-1", meta: {} };
  const r = await t.send(msg);
  assert.equal(r.status, "sent");
  assert.match(r.error, /Not sent to stranger@else.example/);
  assert.deepEqual(sent[0].to, ["dana@acme.example"]);
  assert.deepEqual(sent[0].cc, []);
  assert.equal(sent[0].messageId, "<m-1.ab@mail.local>");
  assert.equal(sent[0].replyTo, "plannie+e-1@plannie.example");
  assert.equal(sent[0].inReplyTo, "<x1@mail.example>");
  assert.equal((await t.send({ ...msg, to: ["nobody@else.example"], cc: [] })).status, "held-not-allowlisted");
  const failing = gmailTransport({ user: "p@x.co", pass: "x", allowlist: ["dana@acme.example"], sendImpl: async () => { throw Object.assign(new Error("Invalid login"), { responseCode: 535 }); } });
  assert.match((await failing.send(msg)).error, /Gmail SMTP: 535 Invalid login/);
});

// A fake IMAP server: an inbox of { uid, source, internalDate, seen }.
function fakeImap(inbox) {
  return () => ({
    async connect() {}, async logout() {}, close() {},
    async getMailboxLock() { return { release() {} }; },
    async search(q) { return inbox.filter((m) => !m.seen).map((m) => m.uid); },
    async fetchOne(uid) { return inbox.find((m) => String(m.uid) === uid); },
    async messageFlagsAdd(uid) { inbox.find((m) => String(m.uid) === uid).seen = true; },
  });
}

test("poller: new mail is ingested once and marked read; mail from before Plannie was connected is skipped", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport(), initialConfig: "sample" });
  store.setMeta("clock", null);
  const old = new Date(Date.now() - 86400000), now = new Date();
  const inbox = [
    { uid: 1, internalDate: old, source: raw({ from: "no-reply@accounts.google.com", id: "welcome@google" }) },
    { uid: 2, internalDate: now, source: raw({ from: "sam@acme.example", subject: "Team offsite", body: "Offsite please", id: "req1@acme" }) },
    { uid: 3, internalDate: now, source: Buffer.from("garbage without headers") },
  ];
  const p = startGmailPoller({ app, store, imapFactory: fakeImap(inbox), intervalMs: 3600000, log: { error() {} } });
  try {
    await p.tick(); // joins the check started on launch
    assert.ok(inbox.every((m) => m.seen), "everything marked read");
    const human = store.listMessages("direction='human'");
    assert.deepEqual(human.map((m) => m.messageId), ["<req1@acme>"]);
    assert.equal(human[0].identity.verified, true);
    // The same message again (e.g. marked unread by someone) is not processed twice.
    inbox[1].seen = false; await p.tick();
    assert.equal(store.listMessages("direction='human'").length, 1);
    assert.equal(GMAIL_STATUS.lastError, null);
  } finally { p.stop(); }
});

test("an approval arriving through Gmail still needs aligned DKIM and the one-time code", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.resetDemo();
  for (;;) { const r = await app.demoStep(); if (r.step === "A10") break; }
  const ev = () => store.listEvents()[0];
  const code = ev().approvals.find((a) => a.id === "R-1").code;
  const req = store.listMessages("direction='plannie'").find((m) => m.meta?.kind === "approval");
  const send = async (opts, key) => {
    FIXTURE_INTERPRETATIONS[key] = { intents: [{ kind: "approve", fields: null, optionRef: null, approvalRef: "R-1", capTo: 55000, revisionNote: null, quote: "Approve R-1", fromQuotedHistory: false }], unresolved: [] };
    const n = await normalizeEmail(raw({ from: "priya@acme.example", to: "plannie+e-1@plannie.example", inReplyTo: req.messageId, ...opts }));
    await app.sendMail({ ...n, meta: { fixtureKey: key } });
  };
  await send({ id: "g1@acme", body: `Approve R-1 ${code}, cap 55000`, auth: google("priya@acme.example", { dkim: "fail", dmarc: "fail" }) }, "gm1");
  assert.equal(ev().approvals.find((a) => a.id === "R-1").status, "pending", "unverified sender");
  await send({ id: "g2@acme", body: "Approve R-1, cap 55000" }, "gm2");
  assert.equal(ev().approvals.find((a) => a.id === "R-1").status, "pending", "no code");
  await send({ id: "g3@acme", body: `Approve R-1 ${code}, cap 55000` }, "gm3");
  assert.equal(ev().approved.approvalId, "R-1");
});
