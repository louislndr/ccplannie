// AgentMail mailbox adapter: inbox setup, normalization, identity, sending, polling, and reply threading through
// provider-assigned Message-IDs. No network: the AgentMail client is faked.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PLANNIE_INTERPRETER = "fixture";
const { openDb } = await import("../src/db.mjs");
const { createApp } = await import("../src/app.mjs");
const { PLANNIE, isPlannieAddress, eventIdFromAddress } = await import("../src/config.mjs");
const { ensureInbox, agentmailTransport, normalizeAgentmail, agentmailIdentity, startAgentmailPoller, AGENTMAIL_STATUS } = await import("../src/agentmail.mjs");
const { FIXTURE_INTERPRETATIONS } = await import("../src/demo.mjs");

// A fake AgentMail account: inboxes, a message store, and a record of sends.
function fakeAgentmail() {
  const inboxes = [], messages = [], sent = [];
  let n = 0;
  return {
    inboxes, messages, sent,
    deliver(m) { const id = `<am-${++n}@agentmail.to>`; messages.push({ labels: ["received"], timestamp: new Date(Date.now() + n), createdAt: new Date(Date.now() + n), messageId: id, ...m }); return id; },
    inboxes: Object.assign(inboxes, {
      async list() { return { count: inboxes.length, inboxes }; },
      async create({ username, displayName }) { const i = { inboxId: `${username}@agentmail.to`, email: `${username}@agentmail.to`, displayName }; inboxes.push(i); return i; },
      messages: {
        async list(_id, { after }) { return { count: 0, messages: messages.filter((m) => m.timestamp > after).sort((a, b) => a.timestamp - b.timestamp) }; },
        async get(_id, mid) { return messages.find((m) => m.messageId === mid); },
        async send(_id, req) { const messageId = `<sent-${sent.length + 1}@agentmail.to>`; sent.push({ ...req, messageId }); return { messageId, threadId: "t1" }; },
      },
    }),
  };
}

test("inbox: found or created, becomes Plannie's address, and plus-addressing is turned off", async () => {
  const fake = fakeAgentmail();
  const inbox = await ensureInbox(fake, { username: "plannie" });
  assert.equal(inbox.email, "plannie@agentmail.to");
  assert.equal(PLANNIE.intake, "plannie@agentmail.to");
  assert.equal(PLANNIE.plus, false);
  assert.ok(isPlannieAddress("Plannie@AgentMail.to"));
  assert.equal(eventIdFromAddress("plannie+e-1@agentmail.to"), null);
  await ensureInbox(fake, { username: "plannie" });
  assert.equal(fake.inboxes.length, 1, "existing inbox is reused, not duplicated");
});

test("normalization and identity: display names stripped, verified only with aligned DKIM or DMARC", () => {
  const n = normalizeAgentmail({ messageId: "abc@x", from: "Dana Ruiz <Dana@Acme.example>", to: ["Plannie <plannie@agentmail.to>"], cc: ["leo@acme.example"], subject: "Hi", text: "Body", inReplyTo: "p1@x", references: ["p0@x", "p1@x"], authenticationResults: { dkim: "pass", dkimDomain: "acme.example", dmarc: "pass", dmarcDomain: "acme.example" } });
  assert.equal(n.from, "dana@acme.example");
  assert.deepEqual(n.to, ["plannie@agentmail.to"]);
  assert.equal(n.messageId, "<abc@x>");
  assert.equal(n.inReplyTo, "<p1@x>");
  assert.deepEqual(n.references, ["<p0@x>", "<p1@x>"]);
  assert.equal(n.identity.verified, true);
  assert.equal(agentmailIdentity({ dkim: "pass", dkimDomain: "mailer.example", dmarc: "fail" }, "a@acme.example").verified, false);
  assert.equal(agentmailIdentity({ dkim: "fail", dmarc: "pass", dmarcDomain: "acme.example" }, "a@acme.example").verified, true);
  assert.equal(agentmailIdentity({}, "a@acme.example").verified, false);
  assert.equal(agentmailIdentity(undefined, "a@acme.example").verified, false);
});

test("sending: directory only, threading headers set, provider Message-ID returned", async () => {
  const fake = fakeAgentmail();
  await ensureInbox(fake);
  const t = agentmailTransport({ client: fake, inboxId: "plannie@agentmail.to", allowlist: ["dana@acme.example"] });
  const r = await t.send({ to: ["dana@acme.example"], cc: ["x@else.example"], subject: "Re: Offsite", body: "Hi", messageId: "<m-1@mail.local>", inReplyTo: "<am-1@agentmail.to>", references: ["<am-1@agentmail.to>"], eventId: "E-1", meta: {} });
  assert.equal(r.status, "sent");
  assert.equal(r.providerId, "<sent-1@agentmail.to>");
  assert.match(r.error, /Not sent to x@else.example/);
  assert.deepEqual(fake.sent[0].to, ["dana@acme.example"]);
  assert.equal(fake.sent[0].headers["In-Reply-To"], "<am-1@agentmail.to>");
  assert.deepEqual(fake.sent[0].replyTo, ["plannie@agentmail.to"], "no plus-address with AgentMail");
});

test("end to end: new request arrives, Plannie replies through AgentMail, and the reply to that reply joins the same request", async () => {
  const fake = fakeAgentmail();
  const inbox = await ensureInbox(fake);
  const store = openDb(":memory:");
  const transport = agentmailTransport({ client: fake, inboxId: inbox.inboxId, allowlist: () => ["sam@acme.example", "dana@acme.example", "alex@acme.example", "priya@acme.example", "leo@acme.example"] });
  const app = createApp({ store, transport, initialConfig: "sample" });
  store.setMeta("clock", null);
  const poller = startAgentmailPoller({ app, store, client: fake, inboxId: inbox.inboxId, intervalMs: 3600000, log: { error() {} } });
  try {
    await poller.tick();
    // Sam emails Plannie (the fixture stands in for the model's reading of it).
    const first = fake.deliver({ from: "Sam Lee <sam@acme.example>", to: ["plannie@agentmail.to"], cc: ["dana@acme.example"], subject: "Fall team offsite", text: "Please plan our offsite.", authenticationResults: { dkim: "pass", dkimDomain: "acme.example" } });
    const orig = app.sendMail;
    app.sendMail = (m) => orig({ ...m, meta: { fixtureKey: m.messageId === first ? "A2" : "A3" } });
    await poller.tick();
    const ev = store.listEvents()[0];
    assert.ok(ev, "a request was created");
    assert.equal(ev.address, "plannie@agentmail.to");
    await app.flush();
    const reply = fake.sent.find((s) => s.to.includes("sam@acme.example") || s.cc?.includes("sam@acme.example"));
    assert.ok(reply, "Plannie answered through AgentMail");
    // Dana answers Plannie's email; her client sets In-Reply-To to the ID AgentMail gave Plannie's message.
    fake.deliver({ from: "dana@acme.example", to: ["plannie@agentmail.to"], subject: "Re: Fall team offsite", text: "Thursday, September 16, 2027", inReplyTo: reply.messageId, references: [reply.messageId], authenticationResults: { dkim: "pass", dkimDomain: "acme.example" } });
    await poller.tick();
    assert.equal(store.listEvents().length, 1, "no second request");
    assert.equal(store.getEvent(ev.id).working.date, "2027-09-16");
    assert.equal(AGENTMAIL_STATUS.lastError, null);
    // Sent mail and Plannie's own messages are never re-ingested.
    fake.messages.push({ labels: ["sent"], timestamp: new Date(Date.now() + 999), messageId: "<s@x>", from: "plannie@agentmail.to", to: ["dana@acme.example"] });
    const before = store.listMessages("direction='human'").length;
    await poller.tick();
    assert.equal(store.listMessages("direction='human'").length, before);
  } finally { poller.stop(); }
});
