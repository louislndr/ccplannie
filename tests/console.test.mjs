// Company console: shared validation, versioned configuration, audit, policy behavior, access control,
// exports. Deterministic (fixture interpreter, local transport, simulated suppliers). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.PLANNIE_INTERPRETER = "fixture";
const { openDb, ConflictError } = await import("../src/db.mjs");
const { createApp } = await import("../src/app.mjs");
const { createServer } = await import("../src/server-app.mjs");
const { localTransport } = await import("../src/transport.mjs");
const { readOrgCsv, readOrgPeople, parseLimit, toCsv } = await import("../src/org.mjs");
const { SAMPLE_ORG, SAMPLE_POLICY, POLICY, CONFIG, can, PEOPLE } = await import("../src/config.mjs");
const { saveCompany, currentDoc, ValidationError } = await import("../src/company.mjs");
const D = await import("../src/domain.mjs");

const HEAD = "name,email,title,manager_email,roles,approval_limit,backup_email\n";
const sampleCsv = () => toCsv(SAMPLE_ORG);
const withPerson = (email, patch) => SAMPLE_ORG.map((p) => (p.email === email ? { ...p, ...patch } : p));

const PASSWORD = "correct horse battery staple";
// A server on an ephemeral port over a store. The company server is signed in as the administrator.
// The tests reuse the fictional cast and story as a realistic company scenario (initialConfig "sample").
async function boot({ path = ":memory:", mode = "company", until = null, login = true, adminPassword = PASSWORD } = {}) {
  const store = openDb(path);
  const transport = localTransport();
  const app = createApp({ store, transport, initialConfig: "sample" });
  if (until !== false) { if (!store.listEvents().length && store.getMeta("demo:step") == null) app.resetDemo(); }
  if (until) for (;;) { const r = await app.demoStep(); if (r.step === until || r.done) break; }
  const server = createServer({ store, app, transport, mode, adminPassword });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let jar = "";
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, redirect: "manual", headers: { "content-type": "application/json", ...(jar ? { cookie: jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) jar = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = text; }
    return { status: r.status, body: j, headers: r.headers };
  };
  const get = (p, h) => call("GET", p, undefined, h), post = (p, b = {}, h) => call("POST", p, b, h);
  if (mode === "company" && login) assert.equal((await post("/api/admin/login", { password: adminPassword })).status, 200);
  const close = () => new Promise((ok) => server.close(ok));
  const version = async () => store.getConfig().version;
  const ev = (id = "E-1") => store.getEvent(id);
  // Inbound mail as the webhook would deliver it (verified sender), with a labeled fixture interpretation.
  const inbound = async ({ from, to, cc = [], subject, body, fixtureKey, inReplyTo = null }) => {
    const r = await app.sendMail({ from, to, cc, subject, body, inReplyTo: inReplyTo?.messageId || null, references: inReplyTo ? [inReplyTo.messageId] : [], meta: fixtureKey ? { fixtureKey } : {}, identity: { verified: true, method: "test-harness" } });
    return store.getMessage(r.message.id).eventId;
  };
  const mail = async (from, fixtureKey, { to, body = fixtureKey, subject = "Re: Fall team offsite", replyKind = "latest", eventId = "E-1" } = {}) => {
    const mine = store.listMessages("direction='plannie'").filter((m) => [...m.to, ...m.cc].includes(from) && m.eventId === eventId);
    const parent = replyKind === "none" ? null : replyKind === "comparison" ? mine.filter((m) => m.meta?.kind === "comparison").at(-1) : replyKind === "approval" ? mine.filter((m) => m.meta?.kind === "approval").at(-1) : mine.filter((m) => !m.threadId?.includes("approval")).at(-1);
    return inbound({ from, to: to || [store.getEvent(eventId)?.address], subject, body, fixtureKey, inReplyTo: parent });
  };
  return { store, app, server, base, get, post, close, version, ev, mail, inbound, cookie: () => jar };
}

// ------------------------------------------------------------------ validation (shared CSV + web)

test("approval limits are parsed strictly: negatives and malformed values are rejected, never rewritten", () => {
  assert.equal(parseLimit("75,000").value, 75000);
  assert.equal(parseLimit("CAD 75,000").value, 75000);
  assert.equal(parseLimit("1500.50").value, 1500.5);
  for (const bad of ["-5000", "-5,000", "5k", "1e6", "50 000", "12,34", "USD 5000", "0", "Infinity", "NaN", "$-1", "5000-"]) {
    assert.ok(parseLimit(bad).error, `${bad} must be rejected`);
    assert.equal(parseLimit(bad).value, undefined, `${bad} must not become a number`);
  }
  for (const bad of [-1, 0, Infinity, NaN, 2e9]) assert.ok(parseLimit(bad).error, `${bad} must be rejected`);
  // Same answer from both input paths.
  const csv = readOrgCsv(HEAD + "Pri,pri@x.co,,,finance,-5000,\nAl,al@x.co,,,event_manager,,\n");
  const web = readOrgPeople([{ name: "Pri", email: "pri@x.co", roles: ["finance"], approveUpTo: "-5000" }, { name: "Al", email: "al@x.co", roles: ["event_manager"] }]);
  assert.match(csv.errors.map((e) => e.message).join(), /valid approval limit/);
  assert.match(web.errors.map((e) => e.message).join(), /valid approval limit/);
  assert.equal(csv.people[0].approveUpTo, null);
});

test("CSV and website edits share one validator: emails, duplicates, roles, cycles, references", () => {
  const cases = [
    [[{ name: "A", email: "nope", roles: ["sponsor"] }], /valid email/],
    [[{ name: "A", email: "a@x.co", roles: ["sponsor"] }, { name: "B", email: "A@x.co", roles: ["sponsor"] }], /listed twice/],
    [[{ name: "A", email: "a@x.co", roles: ["boss"] }], /Unknown role "boss"/],
    [[{ name: "A", email: "a@x.co", roles: ["finance"], manager: "b@x.co", approveUpTo: 10 }, { name: "B", email: "b@x.co", roles: ["event_manager"], manager: "c@x.co" }, { name: "C", email: "c@x.co", roles: ["sponsor"], manager: "a@x.co" }], /Reporting loop/],
    [[{ name: "A", email: "a@x.co", roles: ["event_manager", "finance"], approveUpTo: 5, manager: "ghost@x.co" }], /Manager ghost@x.co isn't in the company/],
    [[{ name: "A", email: "a@x.co", roles: ["event_manager", "finance"], approveUpTo: 5, backup: "ghost@x.co" }], /Backup ghost@x.co isn't in the company/],
    [[{ name: "A", email: "a@x.co", roles: ["event_manager", "finance"], approveUpTo: 5, backup: "a@x.co" }], /own backup/],
    [[{ name: "A", email: "a@x.co", roles: ["sponsor"] }], /event manager is needed/],
  ];
  for (const [people, re] of cases) {
    const web = readOrgPeople(people).errors.map((e) => e.message).join(" | ");
    assert.match(web, re, `web: ${re}`);
    const csv = HEAD + people.map((p) => [p.name, p.email, "", p.manager || "", p.roles.join(";"), p.approveUpTo ?? "", p.backup || ""].join(",")).join("\n");
    assert.match(readOrgCsv(csv).errors.map((e) => e.message).join(" | "), re, `csv: ${re}`);
  }
  // A web form can't smuggle in an alias or capabilities.
  const r = readOrgPeople([...SAMPLE_ORG.map((p) => ({ ...p, alias: true, caps: ["spend.approve"] }))]);
  assert.deepEqual(r.errors, []);
  assert.ok(r.people.every((p) => !("alias" in p) && !("caps" in p)));
});

// ------------------------------------------------------------------ persistence, versions, atomicity, audit

test("config saves are versioned, audited in the same transaction, and stale versions are rejected", async () => {
  const s = await boot();
  try {
    const v1 = await s.version();
    const people = withPerson("leo@acme.example", { roles: ["sponsor"], title: "Account Director" });
    const ok = await s.post("/api/admin/people/apply", { people, expectedVersion: v1 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, v1 + 1);
    assert.ok(can("leo@acme.example", "plan.change_scope"));
    const audit = s.store.listAudit();
    assert.ok(audit.some((a) => a.action === "org.edited" && a.actor === "admin" && a.configVersion === v1 + 1));
    const roleRow = audit.find((a) => a.action === "person.roles_changed" && a.entity === "person:leo@acme.example");
    assert.deepEqual([roleRow.before.roles, roleRow.after.roles], [["stakeholder"], ["sponsor"]]);
    assert.ok(audit.some((a) => a.action === "person.changed" && /title/.test(a.details.text)));
    // Stale: a second editor still on v1.
    const n = s.store.listAudit().length;
    const stale = await s.post("/api/admin/people/apply", { people: SAMPLE_ORG, expectedVersion: v1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed/);
    assert.equal(s.store.listAudit().length, n, "no audit rows for a rejected save");
    assert.ok(can("leo@acme.example", "plan.change_scope"), "the stale save changed nothing");
    // Invalid: no audit, no version bump.
    const bad = await s.post("/api/admin/people/apply", { people: withPerson("priya@acme.example", { approveUpTo: "-100000" }), expectedVersion: v1 + 1 });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.errors.some((e) => e.email === "priya@acme.example" && e.field === "approveUpTo"));
    assert.equal(s.store.listAudit().length, n);
    assert.equal(await s.version(), v1 + 1);
    // The client can't choose the audit actor.
    await s.post("/api/admin/people/apply", { people: SAMPLE_ORG, expectedVersion: v1 + 1, actor: "priya@acme.example" });
    assert.ok(s.store.listAudit().every((a) => a.actor !== "priya@acme.example"));
  } finally { await s.close(); }
});

test("a failure inside the save transaction leaves configuration and audit untouched", async () => {
  const store = openDb(":memory:");
  createApp({ store, transport: localTransport() });
  const before = store.getConfig();
  const orig = store.insertAudit.bind(store);
  let calls = 0;
  store.insertAudit = (e) => { if (++calls === 2) throw new Error("disk full"); return orig(e); };
  assert.throws(() => saveCompany(store, { people: withPerson("leo@acme.example", { roles: ["sponsor"] }), roleDefinitions: {}, policy: SAMPLE_POLICY }, { expectedVersion: before.version, actor: "t", action: "org.edited", summary: "x" }), /disk full/);
  assert.equal(store.getConfig().version, before.version);
  assert.deepEqual(store.getConfig().doc, before.doc);
  assert.equal(store.listAudit().length, 0);
  assert.equal(can("leo@acme.example", "plan.change_scope"), false, "runtime unchanged");
});

test("company config and activity survive restart and demo reset; legacy uploads are migrated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plannie-cfg-"));
  const path = join(dir, "t.sqlite");
  try {
    // An older database with the org chart in meta.
    const old = openDb(path);
    old.setMeta("org", { people: withPerson("leo@acme.example", { roles: ["sponsor"] }), updatedAt: "2026-01-01T00:00:00.000Z", roleDefinitions: { sponsor: { label: "Office Lead", summary: "Decides" } } });
    old.close();
    let s = await boot({ path });
    assert.equal(CONFIG.source, "saved");
    assert.ok(can("leo@acme.example", "plan.change_scope"));
    assert.equal(s.store.getMeta("org"), null);
    assert.ok(s.store.listAudit().some((a) => a.action === "config.migrated"));
    const v = await s.version();
    const pol = await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, name: "Acme events policy", supplierTimeoutHours: 24, delegatedInquiries: false }, expectedVersion: v });
    assert.equal(pol.status, 200);
    s.app.resetDemo(); // a demo-style reset of request data never touches company configuration
    assert.equal(POLICY.supplierTimeoutHours, 24);
    await s.close(); s.store.close();
    // Restart: a fresh process view of the same file. Load happens before anything else.
    POLICY.supplierTimeoutHours = 999; POLICY.delegatedInquiries = true;
    s = await boot({ path });
    assert.equal(POLICY.name, "Acme events policy");
    assert.equal(POLICY.supplierTimeoutHours, 24);
    assert.equal(POLICY.delegatedInquiries, false);
    assert.ok(can("leo@acme.example", "plan.change_scope"));
    assert.equal(PEOPLE["dana@acme.example"].title.includes("Office Lead"), true);
    const act = (await s.get("/api/admin/activity")).body.entries;
    assert.ok(act.some((a) => a.action === "policy.changed" && a.entity === "policy:supplierTimeoutHours" && a.before.supplierTimeoutHours === 48 && a.after.supplierTimeoutHours === 24));
    assert.ok(act.every((a) => /^ACT-\d+$/.test(a.id)) && new Set(act.map((a) => a.id)).size === act.length);
    await s.close(); s.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("policy validation: routing references, bounded timeout, no credentials in the workspace note", async () => {
  const s = await boot();
  try {
    const v = await s.version();
    const bad = async (patch, re) => { const r = await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, ...patch }, expectedVersion: v }); assert.equal(r.status, 422, JSON.stringify(patch)); assert.match(r.body.errors.map((e) => e.message).join(), re); };
    await bad({ defaultManager: "dana@acme.example" }, /isn't an event manager/);
    await bad({ defaultManager: "ghost@acme.example" }, /isn't in the company/);
    await bad({ defaultFinanceApprover: "alex@acme.example" }, /isn't a finance approver/);
    await bad({ supplierTimeoutHours: 0 }, /whole number of hours/);
    await bad({ supplierTimeoutHours: 2.5 }, /whole number/);
    await bad({ supplierTimeoutHours: 10000 }, /whole number/);
    await bad({ delegatedInquiries: "yes" }, /on or off/);
    await bad({ plannedWorkspaceRef: "session=abc123; token" }, /Don't paste credentials/);
    await bad({ spendNeedsApproval: false }, /Unknown setting/);
    assert.equal(s.store.listAudit().length, 0);
    // Removing the default manager's role is blocked by the routing reference, and the last finance approver can't go.
    const r1 = await s.post("/api/admin/people/apply", { people: withPerson("alex@acme.example", { roles: ["stakeholder"] }), expectedVersion: v });
    assert.equal(r1.status, 422);
    assert.match(r1.body.errors.map((e) => e.message).join(), /event manager is needed|default request-routing manager/);
    const r2 = await s.post("/api/admin/people/apply", { people: SAMPLE_ORG.filter((p) => p.email !== "priya@acme.example"), expectedVersion: v });
    assert.match(r2.body.errors.map((e) => e.message).join(), /finance approver is needed/);
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ the end-to-end authority sequence

test("end to end: unauthorized change → grant sponsor → handled; looks-good ≠ approval; finance; manager; supplier", async () => {
  const s = await boot({ until: "A6" });
  try {
    // 1. The console shows real requests needing action.
    let inbox = (await s.get("/api/admin/requests")).body;
    assert.equal(inbox.items[0].id, "E-1");
    assert.ok(inbox.items[0].filters.includes("waiting_requester"));
    // 3. Leo (stakeholder) tries to change scope by email: a suggestion, plan unchanged.
    await s.mail("leo@acme.example", "CX-leo-45", { body: "Make it 45 — Ops is joining." });
    assert.equal(s.ev().working.headcount, 30);
    assert.equal(s.ev().suggestions.at(-1).status, "open");
    // 2/4. Give Leo the sponsor role; the review lists the affected request first.
    const v = await s.version();
    const people = withPerson("leo@acme.example", { roles: ["sponsor"] });
    const pv = (await s.post("/api/admin/people/preview", { people, expectedVersion: v })).body;
    assert.ok(pv.diff.roles.some((r) => /Leo Park/.test(r.text)));
    assert.ok(pv.diff.affected.some((a) => a.eventId === "E-1" && a.items.some((t) => /Leo Park will be able to change the plan/.test(t))));
    assert.equal((await s.post("/api/admin/people/apply", { people, expectedVersion: v })).status, 200);
    // The earlier suggestion stays a suggestion (no retroactive authority).
    assert.equal(s.ev().working.headcount, 30);
    // 5. A new equivalent email is applied with the newly assigned authority.
    await s.mail("leo@acme.example", "CX-leo-45-again", { body: "Let's make it 45 people." });
    assert.equal(s.ev().working.headcount, 45);
    assert.equal(s.ev().workingSource.headcount.by, "leo@acme.example");
    assert.ok(s.ev().history.some((h) => h.action === "working.update" && h.configVersion === v + 1));
    // Delegated inquiry (on by default) asked the one venue that fits.
    assert.ok(s.ev().supplierRequests.some((r) => r.delegated && r.supplierId === "mapleridge" && r.status === "sent"));
    await s.app.supplierTick();
    // 6. Dana's "looks good" is a selection, not a spending approval.
    await s.mail("dana@acme.example", "CX-dana-looks-good", { body: "Looks good, let's go with Maple Ridge." });
    assert.equal(s.ev().selection.by, "dana@acme.example");
    assert.equal(s.ev().approved, null);
    const r1 = s.ev().approvals.find((a) => a.status === "pending");
    assert.equal(r1.approver, "priya@acme.example");
    await s.mail("dana@acme.example", "CX-dana-approve", { body: "Approved, go ahead." });
    assert.equal(s.ev().approved, null, "a sponsor can't approve spending");
    inbox = (await s.get("/api/admin/requests")).body;
    assert.ok(inbox.items[0].filters.includes("waiting_finance"));
    assert.match(inbox.items[0].next.text, /Waiting for Priya's approval/);
    // Authorize isn't possible before finance approves.
    let d = (await s.get("/api/admin/requests/E-1?as=alex@acme.example")).body;
    assert.match(d.actions.find((a) => a.action === "authorize").reason, /Finance hasn't approved/);
    // 7. Priya approves the exact terms within her limit.
    await s.mail("priya@acme.example", "CX-priya-approve-R1", { replyKind: "approval", body: "Approve R-1. Cap CAD 55,000." });
    assert.equal(s.ev().approved.approvalId, r1.id);
    assert.equal(s.ev().commitment, null, "approval is not a booking");
    // 8. Alex authorizes (as an explicit identity, with the event version).
    d = (await s.get("/api/admin/requests/E-1?as=alex@acme.example")).body;
    const auth = await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "authorize", expectedVersion: d.event.version, requestId: "t-auth-1" });
    assert.equal(auth.status, 200);
    assert.equal(s.ev().commitment, null, "authorized ≠ booked");
    inbox = (await s.get("/api/admin/requests")).body;
    assert.ok(inbox.items[0].filters.includes("waiting_supplier"));
    assert.match(inbox.items[0].next.text, /Waiting on Planned to confirm/);
    // 9. Only the simulated supplier's confirmation creates the commitment.
    await s.app.supplierTick();
    assert.equal(s.ev().commitment.amount, 53000);
    assert.ok((await s.get("/api/admin/requests")).body.items[0].filters.includes("confirmed"));
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ policy that changes behavior

test("delegated inquiries off stops automatic follow-up; a manual authorized inquiry still works", async () => {
  const s = await boot({ until: "A7" });
  try {
    const v = await s.version();
    assert.equal((await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, delegatedInquiries: false }, expectedVersion: v })).status, 200);
    const sent = s.ev().supplierRequests.length;
    await s.app.demoStep(); // A8: Dana confirms 45
    assert.equal(s.ev().working.headcount, 45);
    assert.equal(s.ev().supplierRequests.length, sent, "no automatic inquiry");
    assert.ok(s.ev().history.some((h) => h.action === "inquiry.not_delegated" && h.configVersion === v + 1));
    const reply = s.store.listMessages("direction='plannie' AND event_id='E-1'").at(-1);
    assert.match(reply.body, /I haven't asked Planned for a new offer/);
    // Leo can't request quotes (not a manager), Dana can't either, Alex can.
    const ver = s.ev().version;
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "leo@acme.example", action: "requestQuotes", args: { supplierIds: ["mapleridge"] }, expectedVersion: ver })).status, 403);
    const ok = await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "requestQuotes", args: { supplierIds: ["mapleridge"] }, expectedVersion: ver, requestId: "manual-q" });
    assert.equal(ok.status, 200);
    const q = s.ev().supplierRequests.at(-1);
    assert.equal(q.delegated, false);
    assert.equal(q.fields.headcount, 45);
    // Idempotent retry of the same click: one request, one email.
    const again = await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "requestQuotes", args: { supplierIds: ["mapleridge"] }, expectedVersion: ver, requestId: "manual-q" });
    assert.equal(again.body.duplicate, true);
    assert.equal(s.ev().supplierRequests.filter((r) => r.id === q.id || r.status === "sent").length, 1);
  } finally { await s.close(); }
});

test("changing the default manager routes new requests only; existing owners stay until reassigned", async () => {
  const s = await boot({ until: "A4" });
  try {
    let v = await s.version();
    const people = [...SAMPLE_ORG, { name: "Jordan Lee", email: "jordan@acme.example", title: "Event Manager", manager: null, roles: ["event_manager"], approveUpTo: null, backup: null }];
    assert.equal((await s.post("/api/admin/people/apply", { people, expectedVersion: v })).status, 200);
    v = await s.version();
    assert.equal((await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, defaultManager: "jordan@acme.example" }, expectedVersion: v })).status, 200);
    assert.equal(s.ev().owner, "alex@acme.example", "existing request keeps its owner");
    // A new request from Sam goes to Jordan, not accepted.
    const e2 = s.store.getEvent(await s.inbound({ from: "sam@acme.example", to: ["plannie@plannie.example"], subject: "Q1 sales kickoff", body: "Can the event team set up our Q1 sales kickoff?", fixtureKey: "CX-kickoff" }));
    assert.equal(e2.routedTo, "jordan@acme.example");
    assert.equal(e2.owner, null);
    assert.equal(e2.configVersion, v + 1);
    // Routing alone authorizes nothing: Jordan can't request quotes until accepting; Alex can't accept it.
    assert.equal((await s.post(`/api/admin/requests/${e2.id}/action`, { actor: "jordan@acme.example", action: "requestQuotes", expectedVersion: e2.version })).status, 422);
    assert.equal((await s.post(`/api/admin/requests/${e2.id}/action`, { actor: "alex@acme.example", action: "accept", expectedVersion: e2.version })).status, 403);
    // Admin reassigns E-1 from Alex to Jordan: ownership released, history kept, Alex loses the ability to act.
    const before = s.ev();
    const n = s.store.listAudit().length;
    const rt = await s.post("/api/admin/requests/E-1/route", { manager: "jordan@acme.example", expectedVersion: before.version, requestId: "rt-1" });
    assert.equal(rt.status, 200);
    assert.equal(s.ev().owner, null);
    assert.equal(s.ev().routedTo, "jordan@acme.example");
    assert.equal(s.ev().ownerHistory[0].owner, "alex@acme.example");
    assert.ok(s.ev().history.length > before.history.length && s.ev().history.some((h) => h.action === "owner.accepted"), "earlier decisions stay");
    const audit = s.store.listAudit();
    assert.equal(audit.length, n + 1);
    assert.equal(audit[0].action, "request.reassigned");
    assert.deepEqual(audit[0].before, { routedTo: "alex@acme.example", owner: "alex@acme.example" });
    assert.equal(audit[0].eventId, "E-1");
    // Retrying the same route call doesn't log twice.
    await s.post("/api/admin/requests/E-1/route", { manager: "jordan@acme.example", expectedVersion: before.version, requestId: "rt-1" });
    assert.equal(s.store.listAudit().length, n + 1);
    const ver = s.ev().version;
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "requestQuotes", expectedVersion: ver })).status, 422);
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "jordan@acme.example", action: "accept", expectedVersion: ver })).status, 200);
    assert.equal(s.ev().owner, "jordan@acme.example");
    // The demo's manager steps now act as the actual owner, not a hardcoded Alex.
    await s.app.demoStep(); // A5 requestQuotes
    assert.ok(s.ev().history.some((h) => h.action === "sourcing.requested" && h.actor === "jordan@acme.example"));
    // Failed mutations don't log.
    const m = s.store.listAudit().length;
    assert.equal((await s.post("/api/admin/requests/E-1/route", { manager: "dana@acme.example", expectedVersion: s.ev().version })).status, 422);
    assert.equal((await s.post("/api/admin/requests/E-1/route", { manager: "alex@acme.example", expectedVersion: 1 })).status, 409);
    assert.equal(s.store.listAudit().length, m);
  } finally { await s.close(); }
});

test("revoking a manager's role blocks their next protected action; history and commitments remain", async () => {
  const s = await boot({ until: "A14" });
  try {
    const commitment = s.ev().commitment;
    const approved = s.ev().approved;
    const v = await s.version();
    // Add a second manager so Alex can lose the role, then make the second one the default.
    const jordan = { name: "Jordan Lee", email: "jordan@acme.example", title: "Event Manager", manager: null, roles: ["event_manager"], approveUpTo: null, backup: null };
    let r = await s.post("/api/admin/people/apply", { people: [...SAMPLE_ORG, jordan], expectedVersion: v });
    r = await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, defaultManager: "jordan@acme.example" }, expectedVersion: v + 1 });
    const pv = (await s.post("/api/admin/people/preview", { people: [...withPerson("alex@acme.example", { roles: ["stakeholder"] }), jordan], expectedVersion: v + 2 })).body;
    assert.ok(pv.diff.affected.some((a) => a.eventId === "E-1" && a.items.some((t) => /loses event-manager powers/.test(t))));
    r = await s.post("/api/admin/people/apply", { people: [...withPerson("alex@acme.example", { roles: ["stakeholder"] }), jordan], expectedVersion: v + 2 });
    assert.equal(r.status, 200);
    const ver = s.ev().version;
    const pause = await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "pause", expectedVersion: ver });
    assert.equal(pause.status, 403, "revoked powers stop the next protected action immediately");
    assert.equal(s.ev().paused, false);
    // Evidence stays exactly as it was.
    assert.deepEqual(s.ev().commitment, commitment);
    assert.deepEqual(s.ev().approved, approved);
    assert.ok(s.ev().history.some((h) => h.action === "owner.accepted" && h.actor === "alex@acme.example"));
    const sum = (await s.get("/api/admin/requests")).body.items[0];
    assert.ok(sum.blockers.some((b) => b.code === "owner_revoked"));
    assert.ok(sum.filters.includes("needs_manager"));
    assert.equal(sum.money.confirmed.amount, 53000);
  } finally { await s.close(); }
});

test("over-limit and removed approvers produce real blockers, no null-address mail, no silent transfer", async () => {
  const s = await boot({ until: "A9" });
  try {
    // Lower Priya's limit below the CAD 53,000 offer; add a second finance approver with a higher limit.
    const v = await s.version();
    const omar = { name: "Omar Haddad", email: "omar@acme.example", title: "Controller", manager: null, roles: ["finance"], approveUpTo: 250000, backup: null };
    assert.equal((await s.post("/api/admin/people/apply", { people: [...withPerson("priya@acme.example", { approveUpTo: 50000 }), omar], expectedVersion: v })).status, 200);
    const outBefore = s.store.outbox().length;
    await s.app.demoStep(); // A10: Dana selects Maple Ridge (CAD 53,000)
    const a = s.ev().approvals.at(-1);
    assert.equal(a.status, "pending");
    assert.equal(a.approver, "priya@acme.example", "assigned to the configured default, not silently someone else");
    assert.equal(a.notified, false);
    assert.equal(D.approvalBlocker(a).code, "over_limit");
    const mails = s.store.listMessages("direction='plannie'");
    assert.ok(mails.every((m) => [...m.to, ...m.cc].every(Boolean)), "no null addresses");
    assert.ok(!mails.some((m) => m.meta?.kind === "approval" && m.meta.approvalId === a.id), "no approval request to someone who can't grant it");
    assert.ok(s.store.outbox().length > outBefore, "the requesters are still told");
    const sum = (await s.get("/api/admin/requests")).body.items[0];
    assert.ok(sum.blockers.some((b) => b.code === "approval_over_limit"));
    assert.ok(sum.filters.includes("needs_review"));
    // Priya replying can't approve above her limit.
    await s.mail("priya@acme.example", "CX-priya-approve-R1", { replyKind: "none", body: "Approve R-1. Cap CAD 55,000." });
    assert.equal(s.ev().approved, null);
    assert.ok(s.store.listMessages("direction='plannie'").some((m) => m.to.includes("priya@acme.example") && /above your approval limit/.test(m.body)));
    // Admin explicitly assigns it to an eligible approver; ineligible choices are refused.
    const ver = s.ev().version;
    assert.equal((await s.post(`/api/admin/requests/E-1/approvals/${a.id}/assign`, { approver: "dana@acme.example", expectedVersion: ver })).status, 422);
    const ok = await s.post(`/api/admin/requests/E-1/approvals/${a.id}/assign`, { approver: "omar@acme.example", expectedVersion: ver, requestId: "as-1" });
    assert.equal(ok.status, 200);
    const re = s.ev().approvals.find((x) => x.id === a.id);
    assert.equal(re.approver, "omar@acme.example");
    assert.equal(re.reassignments[0].from, "priya@acme.example");
    assert.equal(D.approvalBlocker(re), null);
    assert.ok(s.store.listMessages("direction='plannie'").some((m) => m.meta?.kind === "approval" && m.to[0] === "omar@acme.example"));
    assert.equal(s.store.listAudit()[0].action, "approval.reassigned");
    // Now remove Omar entirely: the pending approval shows a blocker and isn't moved anywhere.
    const v2 = await s.version();
    assert.equal((await s.post("/api/admin/people/apply", { people: withPerson("priya@acme.example", { approveUpTo: 50000 }), expectedVersion: v2 })).status, 200);
    const after = s.ev().approvals.find((x) => x.id === a.id);
    assert.equal(after.approver, "omar@acme.example");
    assert.equal(D.approvalBlocker(after).code, "approver_removed");
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ access control

test("company server: every console API needs an admin session; demo endpoints don't exist; the webhook still works", async () => {
  process.env.POSTMARK_WEBHOOK_USER = "u"; process.env.POSTMARK_WEBHOOK_PASS = "p";
  const s = await boot({ login: false });
  try {
    const admin = [["GET", "/api/admin/session"], ["GET", "/api/admin/requests"], ["GET", "/api/admin/requests/E-1"], ["GET", "/api/admin/company"], ["POST", "/api/admin/people/apply"], ["POST", "/api/admin/policy/apply"],
      ["POST", "/api/admin/requests/E-1/route"], ["POST", "/api/admin/requests/E-1/action"], ["GET", "/api/admin/requests/E-1/export"], ["GET", "/api/admin/activity"], ["GET", "/api/admin/csv"], ["GET", "/api/admin/connections"]];
    for (const [m, p] of admin) assert.equal((await (m === "GET" ? s.get(p) : s.post(p, { actor: "alex@acme.example", expectedVersion: 1 }))).status, 401, `${m} ${p}`);
    // The standalone demo's endpoints aren't part of the company server at all.
    for (const [m, p] of [["GET", "/api/state"], ["POST", "/api/mail/send"], ["POST", "/api/manager/accept"], ["POST", "/api/demo/reset"], ["POST", "/api/suppliers/tick"], ["GET", "/api/org"], ["POST", "/api/org/apply"], ["POST", "/api/chat"]])
      assert.equal((await (m === "GET" ? s.get(p) : s.post(p, {}))).status, 404, `${m} ${p}`);
    // Wrong password, then right; a forged cookie is worthless; cross-site writes are refused.
    assert.equal((await s.post("/api/admin/login", { password: "nope" })).status, 401);
    assert.equal((await s.get("/api/admin/requests", { cookie: "plannie_admin=forged" })).status, 401);
    const ok = await s.post("/api/admin/login", { password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.equal(s.store.db.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 1);
    assert.ok(!s.store.db.prepare("SELECT token_hash FROM admin_sessions").get().token_hash.includes(s.cookie().split("=")[1]), "only a hash is stored");
    assert.equal((await s.get("/api/admin/requests")).status, 200);
    assert.equal((await s.post("/api/admin/policy/apply", { policy: {}, expectedVersion: 1 }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await s.post("/api/admin/logout")).status, 200);
    assert.equal((await s.get("/api/admin/requests")).status, 401, "logout ends the session");
    // Webhook: independent basic auth.
    assert.equal((await fetch(`${s.base}/api/inbound/postmark`, { method: "POST", body: "{}" })).status, 401);
    const withAuth = await fetch(`${s.base}/api/inbound/postmark`, { method: "POST", headers: { authorization: "Basic " + Buffer.from("u:p").toString("base64") }, body: JSON.stringify({ FromFull: { Email: "x@y.co" }, ToFull: [{ Email: "someone@else.co" }], Subject: "hi", TextBody: "hi", Headers: [] }) });
    assert.equal(withAuth.status, 200);
    // "/" belongs to the demo; the company server sends you to the console.
    const root = await fetch(`${s.base}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/admin");
  } finally { await s.close(); delete process.env.POSTMARK_WEBHOOK_USER; delete process.env.POSTMARK_WEBHOOK_PASS; }
});

test("company server without a configured password refuses sign-in; login attempts are rate limited", async () => {
  let s = await boot({ login: false, adminPassword: "" });
  try {
    const r = await s.post("/api/admin/login", { password: "" });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "not_configured");
    assert.equal((await s.get("/api/admin/requests")).status, 503);
  } finally { await s.close(); }
  s = await boot({ login: false });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await s.post("/api/admin/login", { password: `wrong${i}` })).status, 401);
    assert.equal((await s.post("/api/admin/login", { password: PASSWORD })).status, 429, "even the right password waits after 10 failures");
  } finally { await s.close(); }
});

test("the demo server opens its admin dashboard on the same data (no sign-in), has no webhook, and its org page uses the guarded save", async () => {
  process.env.POSTMARK_WEBHOOK_USER = "u"; process.env.POSTMARK_WEBHOOK_PASS = "p";
  const s = await boot({ mode: "demo", until: "A3" });
  try {
    const session = await s.get("/api/admin/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.mode, "demo");
    assert.ok(session.body.demo?.scenario?.id);
    assert.equal((await s.get("/api/admin/requests")).body.items[0].id, "E-1", "the dashboard sees the demo's requests");
    assert.equal((await s.post("/api/admin/login", { password: "anything" })).status, 200);
    assert.equal((await fetch(`${s.base}/api/inbound/postmark`, { method: "POST", headers: { authorization: "Basic " + Buffer.from("u:p").toString("base64") }, body: "{}" })).status, 404);
    const ver = s.ev().version;
    assert.equal((await s.post("/api/manager/accept", { eventId: "E-1", actor: "mallory@evil.example", expectedVersion: ver })).status, 403);
    assert.equal((await s.post("/api/manager/accept", { eventId: "E-1", expectedVersion: ver })).status, 403, "no default actor");
    const csv = toCsv(withPerson("leo@acme.example", { roles: ["sponsor"] }));
    assert.equal((await s.post("/api/org/apply", { csv })).status, 400, "no version → rejected");
    const v = await s.version();
    assert.equal((await s.post("/api/org/apply", { csv, expectedVersion: v - 1 })).status, 409);
    assert.equal((await s.post("/api/org/apply", { csv, expectedVersion: v })).status, 200);
    assert.ok(s.store.listAudit().some((a) => a.action === "person.roles_changed" && a.entity === "person:leo@acme.example"));
    assert.equal((await s.post("/api/org/reset", { expectedVersion: v + 1 })).status, 200);
    assert.equal(can("leo@acme.example", "plan.change_scope"), false);
    for (;;) { const r = await s.app.demoStep(); if (r.step === "A10" || r.done) break; }
    const snapApprovals = (await s.get("/api/state")).body.events.flatMap((e) => e.approvals);
    assert.ok(snapApprovals.length > 0 && snapApprovals.every((a) => !("code" in a)), "approval codes never reach the browser");
  } finally { await s.close(); delete process.env.POSTMARK_WEBHOOK_USER; delete process.env.POSTMARK_WEBHOOK_PASS; }
});

test("company console: manager actions need a directory identity, are version-checked, and record 'via admin console'", async () => {
  const s = await boot({ until: "A3" });
  try {
    const ver = s.ev().version;
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "mallory@evil.example", action: "accept", expectedVersion: ver })).status, 403);
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "dana@acme.example", action: "accept", expectedVersion: ver })).status, 403, "a sponsor can't accept ownership");
    const stale = await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "accept", expectedVersion: ver - 1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed .* since you loaded it/);
    assert.equal((await s.post("/api/admin/requests/E-1/action", { actor: "alex@acme.example", action: "accept", expectedVersion: ver })).status, 200);
    const h = s.ev().history.find((x) => x.action === "owner.accepted");
    assert.equal(h.actor, "alex@acme.example");
    assert.equal(h.via, "admin console");
    assert.ok(((await s.get("/api/admin/requests/E-1")).body.event.approvals || []).every((a) => !("code" in a)));
  } finally { await s.close(); }
});

test("a real company starts empty: unknown senders are held; the first people save sets the routing defaults", async () => {
  const store = openDb(":memory:");
  const transport = localTransport();
  const app = createApp({ store, transport, initialConfig: "empty" });
  const server = createServer({ store, app, transport, mode: "company", adminPassword: PASSWORD });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let jar = "";
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: jar }, body: b && JSON.stringify(b) }); const c = r.headers.get("set-cookie"); if (c) jar = c.split(";")[0]; return { status: r.status, body: await r.json() }; };
  try {
    await call("POST", "/api/admin/login", { password: PASSWORD });
    const c0 = (await call("GET", "/api/admin/company")).body;
    assert.equal(c0.config.source, "empty");
    assert.equal(c0.org.people.length, 0);
    assert.equal(POLICY.defaultManager, "", "no sample fallback");
    // Mail before anyone is configured: recorded, nothing created, nobody gets authority.
    await app.sendMail({ from: "dana@acme.example", to: ["plannie@plannie.example"], subject: "Offsite", body: "Please organize our offsite." });
    assert.equal(store.listEvents().length, 0);
    assert.match((await call("GET", "/api/admin/requests")).body.intake[0].reason, /not a configured company requester/);
    const people = [
      { name: "Alex Moreau", email: "alex@acme.example", title: "Events", roles: ["event_manager"] },
      { name: "Priya Shah", email: "priya@acme.example", title: "Finance", roles: ["finance"], approveUpTo: "100,000" },
      { name: "Dana Ruiz", email: "dana@acme.example", title: "VP Sales", roles: ["sponsor"] },
    ];
    const pv = (await call("POST", "/api/admin/people/preview", { people, expectedVersion: c0.config.version })).body;
    assert.deepEqual(pv.errors, []);
    assert.deepEqual(pv.diff.policy.map((x) => [x.key, x.after]).sort(), [["defaultFinanceApprover", "priya@acme.example"], ["defaultManager", "alex@acme.example"]]);
    const saved = await call("POST", "/api/admin/people/apply", { people, expectedVersion: c0.config.version });
    assert.equal(saved.status, 200);
    assert.equal(POLICY.defaultManager, "alex@acme.example");
    assert.equal(CONFIG.source, "saved");
    // The held email can now be reprocessed once, and the new request routes to Alex.
    const item = (await call("GET", "/api/admin/requests")).body.intake[0];
    assert.equal(item.canReprocess, true);
    const rp = await call("POST", `/api/admin/intake/${item.msgId}/reprocess`, {});
    assert.equal(store.getEvent(rp.body.eventId).routedTo, "alex@acme.example");
  } finally { await new Promise((ok) => server.close(ok)); }
});

test("Postmark sending: real API call shape, company-directory allowlist, simulated venues stay local", async () => {
  const { postmarkTransport } = await import("../src/transport.mjs");
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ErrorCode: 0, Message: "OK", MessageID: "pm-123" }) }; };
  const t = postmarkTransport({ token: "test-token", fetchImpl });
  const r = await t.send({ eventId: "E-7", to: ["dana@acme.example"], cc: ["stranger@else.example"], subject: "Re: Offsite", body: "Hello", messageId: "<m1@x>", inReplyTo: "<p@x>", references: ["<p@x>"], meta: {} });
  assert.equal(r.status, "sent");
  assert.equal(r.providerId, "pm-123");
  assert.match(r.error, /Not sent to stranger@else.example/);
  const c = calls[0];
  assert.equal(c.url, "https://api.postmarkapp.com/email");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers["X-Postmark-Server-Token"], "test-token");
  assert.equal(c.init.headers.Accept, "application/json");
  assert.equal(c.body.To, "dana@acme.example");
  assert.equal(c.body.Cc, "");
  assert.match(c.body.ReplyTo, /\+e-7@/);
  assert.equal(c.body.MessageStream, "outbound");
  assert.ok(c.body.TextBody && c.body.HtmlBody && c.body.From.startsWith("ccPlannie <"));
  assert.deepEqual(c.body.Headers.find((h) => h.Name === "In-Reply-To"), { Name: "In-Reply-To", Value: "<p@x>" });
  // Nobody in the directory → held, no API call. Simulated venue → local only, no API call.
  const n = calls.length;
  assert.equal((await t.send({ to: ["stranger@else.example"], cc: [], subject: "x", body: "x", meta: {} })).status, "held-not-allowlisted");
  assert.equal((await t.send({ to: ["sales@mapleridge.venues.sim"], cc: [], subject: "x", body: "x", meta: {} })).status, "delivered-local");
  assert.equal(calls.length, n);
  // Postmark errors are surfaced, not swallowed.
  const bad = postmarkTransport({ token: "t", fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ ErrorCode: 300, Message: "Invalid 'From' address" }) }) });
  assert.match((await bad.send({ to: ["dana@acme.example"], cc: [], subject: "x", body: "x", meta: {} })).error, /Invalid 'From'/);
});

// ------------------------------------------------------------------ inbox, isolation, intake, export, connections

test("multiple requests stay isolated; inbox filters and search are derived from each record", async () => {
  const s = await boot({ until: "A10" });
  try {
    await s.inbound({ from: "sam@acme.example", to: ["plannie@plannie.example"], subject: "Q1 sales kickoff", body: "kickoff", fixtureKey: "CX-kickoff" });
    await s.inbound({ from: "dana@acme.example", to: ["plannie@plannie.example"], subject: "Spring board dinner", body: "board", fixtureKey: "CX-board" });
    const e4 = s.store.getEvent(await s.inbound({ from: "dana@acme.example", to: ["plannie@plannie.example"], subject: "Leadership retreat", body: "retreat", fixtureKey: "CX-retreat" }));
    await s.post(`/api/admin/requests/${e4.id}/action`, { actor: "alex@acme.example", action: "accept", expectedVersion: e4.version });
    await s.post(`/api/admin/requests/${e4.id}/action`, { actor: "alex@acme.example", action: "pause", expectedVersion: s.store.getEvent(e4.id).version });
    // An unknown sender emails the intake address.
    await s.app.sendMail({ from: "ceo@partner.example", to: ["plannie@plannie.example"], subject: "Partner summit", body: "Please book us a summit." });
    const inbox = (await s.get("/api/admin/requests")).body;
    const by = Object.fromEntries(inbox.items.map((i) => [i.title, i]));
    assert.ok(by["Fall team offsite"].filters.includes("waiting_finance"));
    assert.ok(by["Q1 sales kickoff"].filters.includes("needs_manager"));
    assert.ok(by["Spring board dinner"].filters.includes("needs_manager") && by["Spring board dinner"].filters.includes("waiting_requester"), "several blockers at once");
    assert.ok(by["Leadership retreat"].filters.includes("paused"));
    assert.equal(by["Q1 sales kickoff"].money.requested, 140000);
    assert.equal(by["Q1 sales kickoff"].money.approved, null);
    assert.ok(by["Q1 sales kickoff"].search.includes("sam lee") && by["Q1 sales kickoff"].search.includes("sam@acme.example"));
    // Isolation: work on E-1 doesn't touch the others.
    assert.equal(s.store.getEvent(by["Q1 sales kickoff"].id).approvals.length, 0);
    assert.equal(s.ev().working.headcount, 45);
    // Intake review shows the real reason; reprocessing is refused until the sender is configured.
    const item = inbox.intake.find((i) => i.from === "ceo@partner.example");
    assert.match(item.reason, /not a configured company requester/);
    assert.equal(item.canReprocess, false);
    assert.equal((await s.post(`/api/admin/intake/${item.msgId}/reprocess`)).status, 422);
    const v = await s.version();
    await s.post("/api/admin/people/apply", { people: [...SAMPLE_ORG, { name: "Casey Ng", email: "ceo@partner.example", title: "Partner lead", roles: ["requester"] }], expectedVersion: v });
    const n = s.store.listEvents().length;
    const rp = await s.post(`/api/admin/intake/${item.msgId}/reprocess`);
    assert.equal(rp.status, 200);
    assert.equal(s.store.listEvents().length, n + 1);
    const again = await s.post(`/api/admin/intake/${item.msgId}/reprocess`);
    assert.equal(again.body.duplicate, true);
    assert.equal(s.store.listEvents().length, n + 1, "replay is idempotent");
  } finally { await s.close(); }
});

test("delivery failures are visible and retries resend the same message once", async () => {
  const store = openDb(":memory:");
  let fail = true;
  const transport = { name: "flaky", async send() { return fail ? { status: "failed", error: "network down" } : { status: "delivered-local" }; } };
  const app = createApp({ store, transport });
  app.resetDemo();
  for (;;) { const r = await app.demoStep(); if (r.step === "A2") break; }
  const C = await import("../src/console.mjs");
  const d = C.detail(store, app, "E-1", null);
  assert.ok(d.deliveryFailures.length >= 1);
  assert.ok(d.summary.blockers.some((b) => b.code === "delivery_failed"));
  fail = false;
  const o = d.deliveryFailures[0];
  const r = await app.retryDelivery(o.outboxId);
  assert.equal(r.status, "delivered-local");
  const r2 = await app.retryDelivery(o.outboxId);
  assert.equal(r2.unchanged, true);
  assert.equal(store.outbox().filter((x) => x.messageId === o.msgId).length, 1);
});

test("the handoff export is labeled local/simulated, has provenance, and contains no secrets or sync claims", async () => {
  const s = await boot({ until: "A14" });
  try {
    const r = await s.get("/api/admin/requests/E-1/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment; filename="ccplannie-handoff-E-1-v\d+-LOCAL\.json"/);
    const x = r.body;
    assert.equal(x.schema, "ccplannie.handoff/v1");
    assert.equal(x.request.eventVersion, s.ev().version);
    assert.equal(x.environment.planned, "not_connected");
    assert.deepEqual(x.environment.syncedTo, []);
    assert.match(x.notice, /NOT been sent or synced to Planned/);
    assert.equal(x.supplierCommitment.simulated, true);
    assert.match(x.supplierCommitment.note, /Sample data standing in for Planned/);
    assert.equal(x.approvedTerms.approvalId, "R-1");
    assert.ok(x.workingPlan.provenance.headcount.source.messageId);
    assert.ok(x.provenance.length > 10);
    const text = JSON.stringify(x);
    const codes = s.store.getEvent("E-1").approvals.map((a) => a.code);
    for (const c of codes) assert.ok(!text.includes(c), "no approval codes");
    assert.ok(!/"code"|token|password|cookie/i.test(text.replace(/notice.*?,/, "")), "no secrets");
    // Connections: Planned is not connected, and a saved workspace note doesn't change that.
    const v = await s.version();
    await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, plannedWorkspaceRef: "acme-events" }, expectedVersion: v });
    process.env.POSTMARK_WEBHOOK_USER = "hook-user-value"; process.env.POSTMARK_WEBHOOK_PASS = "hook-secret-value";
    const c = (await s.get("/api/admin/connections")).body;
    delete process.env.POSTMARK_WEBHOOK_USER; delete process.env.POSTMARK_WEBHOOK_PASS;
    assert.equal(c.planned.state, "not_connected");
    assert.equal(c.planned.workspaceRef, "acme-events");
    assert.equal(c.email.state, "local");
    assert.equal(c.company.state, "saved");
    const ctext = JSON.stringify(c);
    for (const secret of ["hook-user-value", "hook-secret-value", PASSWORD]) assert.ok(!ctext.includes(secret), "secret values never reach the browser");
    assert.equal(c.admin.state, "configured");
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ editable roles

test("console: editing a role's permissions changes everyone holding it, through one audited, reviewed save", async () => {
  const s = await boot({ until: "A6" });
  try {
    const co = (await s.get("/api/admin/company")).body;
    assert.deepEqual(co.org.permissions.map((p) => p.id), ["request", "decide", "approve", "manage"]);
    assert.deepEqual(co.org.roles.stakeholder.permissions, []);
    const v = await s.version();
    // Stakeholders may now decide the plan; a new custom role is added; an unused role is deleted.
    const { requester, ...rest } = co.org.roles;
    const roles = Object.fromEntries(Object.entries({ ...rest, stakeholder: { ...rest.stakeholder, label: "Team lead", permissions: ["decide"] }, travel_desk: { label: "Travel desk", summary: "Books on behalf of teams", permissions: ["request", "manage"] } }).map(([id, r]) => [id, { label: r.label, summary: r.summary, permissions: r.permissions }]));
    const people = SAMPLE_ORG.map((p) => (p.email === "sam@acme.example" ? { ...p, roles: ["travel_desk"] } : p));
    const pv = (await s.post("/api/admin/people/preview", { people, roles, expectedVersion: v })).body;
    assert.deepEqual(pv.errors, []);
    const texts = pv.diff.roleDefinitions.map((r) => r.text).join("\n");
    assert.match(texts, /Role “Team lead” \(1 person\): renamed “Stakeholder” → “Team lead”, gains Decide the plan/);
    assert.match(texts, /New role “Travel desk”: Start requests, Run events & book/);
    assert.match(texts, /Role “Requester” deleted/);
    assert.ok(pv.diff.affected.some((a) => a.items.some((t) => /Leo Park will be able to change the plan/.test(t))));
    // Deleting a role someone still holds is refused, by name.
    const bad = await s.post("/api/admin/people/preview", { people: SAMPLE_ORG, roles, expectedVersion: v });
    assert.ok(bad.body.errors.some((e) => /Unknown role "requester"/.test(e.message)));
    const r = await s.post("/api/admin/people/apply", { people, roles, expectedVersion: v });
    assert.equal(r.status, 200);
    assert.ok(can("leo@acme.example", "plan.change_scope"));
    assert.ok(can("sam@acme.example", "supplier.inquire"));
    const audit = s.store.listAudit().map((a) => a.action);
    for (const a of ["role.added", "role.changed", "role.removed", "person.roles_changed"]) assert.ok(audit.includes(a), a);
    // The CSV export carries the roles; re-importing it is a no-op.
    const csv = (await s.get("/api/admin/csv")).body;
    assert.match(csv, /travel_desk,Travel desk,Books on behalf of teams,request;manage/);
    const again = (await s.post("/api/admin/csv/preview", { csv })).body;
    assert.deepEqual(again.errors, []);
    assert.equal(again.diff.roleDefinitions.length + again.diff.people.length + again.diff.roles.length, 0);
    // Bad role payloads never reach storage.
    for (const [rs, re] of [[{ ...roles, "Bad Id": { label: "X", summary: "", permissions: [] } }, /isn't a valid role ID/], [{ ...roles, x1: { label: "Sponsor", summary: "", permissions: [] } }, /Two roles are called/], [{ ...roles, x2: { label: "Y", summary: "", permissions: ["root"] } }, /unknown permission "root"/], [{}, /at least one role/]]) {
      const b = await s.post("/api/admin/people/apply", { people, roles: rs, expectedVersion: v + 1 });
      assert.equal(b.status, 422); assert.match(b.body.errors.map((e) => e.message).join(), re);
    }
  } finally { await s.close(); }
});

test("a configuration saved before roles were editable loads with its renamed roles intact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plannie-roles-"));
  const path = join(dir, "t.sqlite");
  try {
    const old = openDb(path);
    old.saveConfig({ doc: { org: { people: SAMPLE_ORG, roleDefinitions: { sponsor: { label: "Office Lead", summary: "Decides" } } }, policy: SAMPLE_POLICY }, source: "saved", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" }, 0);
    old.close();
    const s = await boot({ path });
    try {
      const co = (await s.get("/api/admin/company")).body;
      assert.equal(co.org.roles.sponsor.label, "Office Lead");
      assert.deepEqual(co.org.roles.sponsor.permissions, ["request", "decide"]);
      assert.ok(can("dana@acme.example", "option.select"));
      const v = await s.version();
      assert.equal((await s.post("/api/admin/policy/apply", { policy: { ...SAMPLE_POLICY, name: "P2" }, expectedVersion: v })).status, 200);
      assert.equal(s.store.getConfig().doc.org.roles.sponsor.label, "Office Lead");
    } finally { await s.close(); s.store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
