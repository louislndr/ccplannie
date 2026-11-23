// Postmark inbound adapter: normalization, plus-address routing, and identity rules for email approvals.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PLANNIE_INTERPRETER = "fixture";
const { openDb } = await import("../src/db.mjs");
const { createApp } = await import("../src/app.mjs");
const { localTransport, normalizePostmark } = await import("../src/transport.mjs");
const { FIXTURE_INTERPRETATIONS } = await import("../src/demo.mjs");

const N = { headcount: null, date: null, nights: null, roomPolicy: null, region: null, budget: null };
const approve = (ref, capTo) => ({ intents: [{ kind: "approve", fields: null, optionRef: null, approvalRef: ref, capTo, revisionNote: null, quote: `Approve ${ref}`, fromQuotedHistory: false }], unresolved: [] });
void N;

function payload({ from, mailboxHash, body, spam = "", inReplyTo, messageId }) {
  return {
    FromFull: { Email: from, Name: "" }, ToFull: [{ Email: `plannie+${mailboxHash}@plannie.example`, Name: "", MailboxHash: mailboxHash }], CcFull: [],
    Subject: "Re: Approval", MessageID: messageId, MailboxHash: mailboxHash, TextBody: body, StrippedTextReply: body,
    Headers: [{ Name: "X-Spam-Tests", Value: spam }, { Name: "Message-ID", Value: `<${messageId}@mail.example>` }, ...(inReplyTo ? [{ Name: "In-Reply-To", Value: inReplyTo }] : [])],
    Attachments: [],
  };
}

test("normalization rejects malformed payloads and maps MailboxHash to the event address", () => {
  assert.throws(() => normalizePostmark({}), /Malformed/);
  const n = normalizePostmark(payload({ from: "Priya@Acme.example", mailboxHash: "e-1", body: "hi", messageId: "a1" }));
  assert.equal(n.from, "priya@acme.example");
  assert.ok(n.to.includes("plannie+e-1@plannie.example"));
  assert.equal(n.identity.verified, false);
});

test("provider approvals need DKIM-aligned identity AND the one-time approval code", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.resetDemo();
  for (;;) { const r = await app.demoStep(); if (r.step === "A10") break; }
  const ev = () => store.listEvents()[0];
  const r1 = ev().approvals.find((a) => a.id === "R-1");
  const req = store.listMessages("direction='plannie'").find((m) => m.meta?.kind === "approval");
  const send = async (spam, body, key, id) => {
    FIXTURE_INTERPRETATIONS[key] = approve("R-1", 55000);
    const n = normalizePostmark(payload({ from: "priya@acme.example", mailboxHash: "e-1", body, spam, inReplyTo: req.messageId, messageId: id }));
    await app.sendMail({ ...n, meta: { fixtureKey: key } });
  };
  await send("SPF_PASS", "Approve R-1, cap 55000", "pm1", "m1");                         // no aligned DKIM → unverified
  assert.equal(ev().approvals.find((a) => a.id === "R-1").status, "pending");
  await send("DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS", "Approve R-1, cap 55000", "pm2", "m2"); // verified, no code
  assert.equal(ev().approvals.find((a) => a.id === "R-1").status, "pending");
  await send("DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS", `Approve R-1 ${r1.code}, cap 55000`, "pm3", "m3");
  assert.equal(ev().approved.approvalId, "R-1");
});
