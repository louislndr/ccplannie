// The demo scenarios run end to end through the real pipeline, and the demo's admin dashboard reads the
// same live data. Fixture interpretations only stand in for the model's reading of each scripted email.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PLANNIE_INTERPRETER = "fixture";
const { openDb } = await import("../src/db.mjs");
const { createApp } = await import("../src/app.mjs");
const { createServer } = await import("../src/server-app.mjs");
const { localTransport } = await import("../src/transport.mjs");
const { saveCompany } = await import("../src/company.mjs");
const { COMPANY, PEOPLE, ORG, can } = await import("../src/config.mjs");
const { SCENARIOS } = await import("../src/scenarios/index.mjs");

const runAll = async (app) => { const seen = []; for (;;) { const r = await app.demoStep(); if (r.step) seen.push(r.step); if (r.done) return seen; } };
const n = (local) => `${local}@northwind.example`;

test("every scenario loads its own company and runs every step without errors", async () => {
  for (const sc of Object.values(SCENARIOS)) {
    const store = openDb(":memory:");
    const app = createApp({ store, transport: localTransport() });
    app.loadScenario(sc.id);
    assert.equal(COMPANY.name, sc.company.name);
    assert.equal(Object.values(PEOPLE).filter((p) => !p.alias).length, sc.org.people.length);
    assert.deepEqual(Object.keys(ORG.roles).sort(), Object.keys(sc.org.roles).sort());
    assert.equal(store.listAudit().length, 1, "one setup entry, not a row per person");
    assert.equal((await runAll(app)).length, sc.steps.length, sc.id);
  }
});

test("Northwind can go back across scripted directory changes and then continue", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("northwind");
  await runAll(app);
  // A demo started before directory checkpoints existed can still go back.
  store.setMeta("demo:people:D7", null);
  store.setMeta("demo:people:E4", null);

  await app.demoBack();
  assert.equal(app.demoInfo().current.key, "E4");
  assert.equal(app.demoInfo().current.focusPerson, n("nina"));
  assert.equal(ORG.people.filter((p) => p.email === n("nina")).length, 1);
  assert.ok(app.intakeReview().some((m) => m.from === n("nina") && m.canReprocess));
  await app.demoBack();
  assert.equal(app.demoInfo().current.key, "E3");
  assert.ok(!ORG.people.some((p) => p.email === n("nina")));
  assert.deepEqual(await runAll(app), ["E4", "E5"]);

  while (app.demoInfo().current.key !== "D6") await app.demoBack();
  assert.ok(!ORG.roles.team_lead);
  assert.ok(!ORG.people.find((p) => p.email === n("sofia")).roles.includes("team_lead"));
  assert.equal((await app.demoStep()).step, "D7");
  assert.equal(app.demoInfo().current.focusPerson, n("sofia"));
  assert.ok(ORG.people.find((p) => p.email === n("sofia")).roles.includes("team_lead"));
  store.close();
});

test("demo #2 — escalation: blocked above the limit, never sent to Ava, a spoof refused, the controller approves, booked", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("northwind");
  const upTo = async (key) => { for (;;) { const r = await app.demoStep(); if (r.step === key) return; if (r.done) throw new Error(`never reached ${key}`); } };
  await upTo("C6");
  let ev = store.listEvents()[0];
  const r1 = ev.approvals[0];
  assert.equal(r1.approver, n("ava"));
  assert.equal(r1.notified, false, "an approval Ava can't give is not sent to her");
  assert.ok(!store.listMessages("direction='plannie'").some((m) => m.to.includes(n("ava"))));
  const pick = store.listMessages("direction='plannie'").filter((m) => m.eventId === ev.id).at(-1);
  assert.match(pick.body, /above Ava Singh's approval limit/);
  assert.doesNotMatch(pick.body, /I've asked Ava/);
  assert.ok(ev.reviewQueue.some((f) => f.open && /R-1/.test(f.text)));
  await upTo("C7");
  ev = store.getEvent(ev.id);
  assert.equal(ev.approvals[0].approver, n("ben"));
  assert.ok(!ev.reviewQueue.some((f) => f.open && /R-1/.test(f.text)), "the blocker warning closes once resolved");
  assert.ok(store.listMessages("direction='plannie'").some((m) => m.to.includes(n("ben")) && m.meta?.kind === "approval"));
  assert.ok(store.listAudit().some((a) => a.action === "approval.reassigned"));
  await upTo("C8");
  ev = store.getEvent(ev.id);
  assert.equal(ev.approvals[0].status, "pending", "the spoofed approval did nothing");
  assert.ok(ev.history.some((h) => h.action === "approval.refused" && /unverified/.test(h.summary)));
  await upTo("C11");
  ev = store.getEvent(ev.id);
  assert.equal(ev.approved.approvalId, "R-1");
  assert.equal(ev.commitment.terms.headcount, 120);
  assert.equal(ev.commitment.amount, 168000);
  const ex = app.plannedExchanges(ev.id);
  assert.deepEqual(ex.map((x) => `${x.direction}:${x.type}`), ["to:quote", "to:quote", "to:quote", "from:offer", "from:offer", "from:cannot-quote", "to:booking", "from:booking-confirmed"]);
});

test("demo #2 — org changes: rerouted to the backup by an admin, a promotion turns a suggestion into authority", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("northwind");
  const upTo = async (key) => { for (;;) { const r = await app.demoStep(); if (r.step === key) return; if (r.done) throw new Error(`never reached ${key}`); } };
  await upTo("D2");
  let ev = store.listEvents()[1];
  assert.equal(ev.routedTo, n("claire"));
  await upTo("D6");
  ev = store.getEvent(ev.id);
  assert.equal(ev.working.nights, 1, "a suggestion changes nothing");
  assert.equal(can(n("sofia"), "plan.change_scope"), false);
  await upTo("D7");
  assert.equal(can(n("sofia"), "plan.change_scope"), true);
  assert.ok(ORG.roles.team_lead);
  assert.ok(store.listAudit().some((a) => a.action === "role.added" && a.entity === "role:team_lead"));
  assert.ok(store.listAudit().some((a) => a.action === "person.roles_changed" && a.entity === `person:${n("sofia")}`));
  await upTo("D8");
  ev = store.getEvent(ev.id);
  assert.equal(ev.working.nights, 2, "the same request now counts");
  assert.equal(ev.suggestions[0].status, "open", "the earlier suggestion isn't retroactively applied");
  await upTo("D11");
  ev = store.getEvent(ev.id);
  assert.equal(ev.approved.approvalId, "R-2");
  assert.equal(ev.approved.terms.amount, 58900);
  assert.equal(ev.approved.terms.nights, 2);
});

test("demo #2 — intake: strangers and people without request rights are held; a new hire is added and reprocessed", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("northwind");
  await runAll(app);
  const held = app.intakeReview();
  assert.ok(held.some((m) => m.from === "events@brightside-agency.example" && !m.canReprocess));
  assert.ok(held.some((m) => m.from === n("marcus") && !m.canReprocess));
  assert.ok(!held.some((m) => m.from === n("nina")), "once reprocessed, Nina's email belongs to a request");
  assert.ok(store.listAudit().some((x) => x.action === "intake.reprocessed"));
  assert.ok(!store.listMessages("direction='plannie'").some((m) => m.to.includes("events@brightside-agency.example")), "no reply to an unknown sender");
  const launch = store.listEvents().find((e) => /launch/i.test(e.title));
  assert.ok(launch && launch.requestedBy === n("nina"));
  assert.equal(store.listEvents().length, 3);
  const story = app.snapshot();
  assert.ok(!story.messages.some((m) => m.direction === "human" && ["nina", "marcus"].some((name) => m.from === n(name))));
  assert.ok(!story.messages.some((m) => m.from === "events@brightside-agency.example"));
  assert.ok(story.messages.some((m) => m.direction === "plannie" && m.eventId === launch.id && m.to.includes(n("nina"))));
  assert.ok(story.messages.some((m) => m.from === n("jonas") && m.cc.includes(n("sofia"))), "shared participant mail stays visible");
  assert.equal(app.snapshot(story.plannie.intake).messages.length, 0);
});

test("venue mail never shows as email; it's presented as exchanges with Planned", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("acme");
  await runAll(app);
  const snap = app.snapshot();
  assert.ok(!snap.messages.some((m) => m.direction === "supplier" || m.meta?.kind === "supplier-request"));
  assert.ok(snap.planned.length >= 8);
  assert.ok(snap.planned.some((x) => x.direction === "from" && x.type === "booking-confirmed" && x.attachments?.length));
  assert.equal(snap.demo.scenario.id, "acme");
  assert.deepEqual(snap.demo.scenarios.map(({ id }) => id), ["acme", "northwind", "juniper"]);
  assert.ok(snap.demo.steps.some((s) => s.planned?.direction === "from"));
});

test("the demo's two doors: switching scenarios through the API, and the admin port's home is the dashboard", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("acme");
  const story = createServer({ store, app, transport: localTransport(), mode: "demo" });
  const admin = createServer({ store, app, transport: localTransport(), mode: "demo", home: "/admin" });
  await Promise.all([new Promise((r) => story.listen(0, r)), new Promise((r) => admin.listen(0, r))]);
  const S = `http://127.0.0.1:${story.address().port}`, A = `http://127.0.0.1:${admin.address().port}`;
  const post = (base, p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  try {
    assert.equal((await post(S, "/api/demo/scenario", { id: "nope" })).status, 400);
    assert.equal((await post(S, "/api/demo/scenario", { id: "northwind" })).status, 200);
    assert.equal(COMPANY.name, "Northwind Labs (fictional)");
    const first = await (await post(S, "/api/demo/step?view=story", {})).json();
    assert.equal(first.snapshot.demo.step, 1);
    const second = await (await post(A, "/api/demo/step?view=admin", {})).json();
    const message = store.listMessages().find((m) => m.meta?.fixtureKey === "C2");
    assert.equal(second.session.demo.current.adminPath, `/admin/requests/E-1?tab=conversations&msg=${message.id}`);
    const stepOne = async () => (await fetch(`${S}/api/demo/review?step=1`)).json();
    assert.equal((await stepOne()).demo.step, 1);
    assert.equal((await fetch(`${S}/api/demo/review?step=3`)).status, 404);
    store.setMeta("demo:review:1", null);
    await app.backfillDemoReviews();
    assert.equal((await stepOne()).demo.step, 1);
    assert.equal(app.demoInfo().step, 2, "review and backfill preserve the live step");
    await post(S, "/api/demo/run", {});
    const inbox = await (await fetch(`${A}/api/admin/requests`)).json();
    assert.equal(inbox.items.length, 3, "the dashboard shows the story's requests");
    const detail = await (await fetch(`${A}/api/admin/requests/E-1`)).json();
    assert.ok(detail.planned.some((x) => x.type === "booking-confirmed"));
    const home = await fetch(`${A}/`, { redirect: "manual" });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/admin");
    const back = await (await post(A, "/api/demo/back?view=admin", {})).json();
    assert.equal(back.session.demo.current.adminPath, "/admin/people");
    assert.equal((await post(S, "/api/demo/reset", {})).status, 200);
    assert.equal(store.listEvents().length, 0);
    assert.equal(COMPANY.name, "Northwind Labs (fictional)", "reset keeps the chosen scenario");
  } finally { story.close(); admin.close(); }
});

test("in a demo, the activity log runs on the demo's clock, so the dashboard and the story agree", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("northwind");
  await runAll(app);
  assert.deepEqual([...new Set(store.listAudit().map((a) => a.at.slice(0, 7)))], ["2027-08"]);
});

test("Juniper runs the company rules and progresses from failed delivery to a confirmed replacement", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("juniper");
  const advanceTo = async (key) => {
    while (app.demoInfo().current?.key !== key) assert.ok((await app.demoStep()).step, `expected ${key}`);
    return store.getEvent("E-1");
  };
  const j = (name) => `${name}@juniper.example`;
  const out = () => store.listMessages("direction='plannie'");
  const notifications = () => out().filter((message) => message.meta?.kind === "notify");
  const approvals = () => out().filter((message) => message.meta?.kind === "approval");
  await advanceTo("F1");
  assert.deepEqual(notifications().map((message) => message.to), [[j("ravi")]]);
  await advanceTo("F2");
  assert.equal(app.demoInfo().current.adminPath, "/admin/policy#venue-reply-deadline");
  assert.deepEqual(app.demoInfo().current.timeoutEdit, { before: 24, after: 8 });
  assert.equal(store.getConfig().doc.policy.supplierTimeoutHours, 8);
  await app.demoBack();
  assert.equal(store.getConfig().doc.policy.supplierTimeoutHours, 24);
  assert.ok(!store.listAudit().some((entry) => entry.actor === "demo script"));
  await advanceTo("F2");
  assert.equal((await advanceTo("F3")).paused, true);
  const sentBeforeHold = out().length;
  assert.equal((await advanceTo("F4")).history.at(-1).action, "paused.suppressed");
  assert.equal(out().length, sentBeforeHold);
  assert.equal((await advanceTo("F5")).paused, false);
  const recorded = await advanceTo("F6");
  assert.equal(recorded.working.headcount, 44);
  assert.deepEqual(recorded.history.find((h) => h.action === "decision.manual").source,
    { manual: true, recordedBy: j("dev"), decidedBy: j("imani"), channel: "phone call", quote: "Imani confirmed 44 guests" });
  assert.ok((await advanceTo("G1")).participants.includes(j("nia")));
  const timedOut = await advanceTo("G2");
  assert.equal(timedOut.reviewQueue.filter((f) => f.open).length, 3);
  assert.ok(timedOut.reviewQueue.every((f) => f.text.includes("in 8h")));
  assert.ok(timedOut.supplierRequests.every((r) => r.status === "no-response"));
  assert.equal(timedOut.proposals.length, 0);
  const offers = await advanceTo("G3");
  assert.deepEqual(offers.proposals.map((p) => p.amount), [54000, 46000, null]);
  assert.ok(offers.reviewQueue.every((f) => !f.open && f.resolution === "Venue reply received"));
  assert.ok(out().some((m) => m.meta?.kind === "comparison" && [...m.to, ...m.cc].includes(j("nia"))));
  assert.equal((await advanceTo("G4")).approvals[0].approver, j("elena"));
  assert.deepEqual(approvals().map((message) => message.to), [[j("elena")]]);
  const failed = store.outbox("failed").find((row) => row.messageId === approvals()[0].id);
  assert.equal(failed.attempts, 1);
  assert.equal(app.demoInfo().current.adminPath, "/admin/requests/E-1#open-items");
  await advanceTo("H1");
  assert.deepEqual(approvals().map((m) => m.id), [failed.messageId]);
  assert.equal(store.outbox().find((row) => row.id === failed.id).attempts, 2);
  assert.equal(store.outbox("failed").length, 0);
  const failureStep = app.demoInfo().step - 1;
  assert.equal(app.demoReview(failureStep).messages.find((m) => m.id === failed.messageId).delivery, "failed");
  await app.demoBack();
  assert.equal(app.demoInfo().current.key, "G4");
  assert.equal(store.outbox("failed").length, 1);
  await advanceTo("H1");
  assert.equal(approvals().length, 1);
  const declined = await advanceTo("H2");
  assert.equal(declined.approvals[0].status, "declined");
  assert.ok(declined.supplierRequests.every((r) => r.type === "quote"));
  const approved = await advanceTo("H4");
  assert.equal(approved.approved.approvalId, "R-2");
  assert.equal(approved.approved.cap, 46000);
  assert.equal(approved.commitment, null);
  const pending = await advanceTo("H5");
  assert.equal(pending.supplierRequests.at(-1).status, "sent");
  assert.equal(pending.commitment, null);
  const completed = await advanceTo("H7");
  assert.equal(completed.commitment.amount, 46000);
  assert.equal(completed.commitment.terms.headcount, 44);
  assert.equal(completed.commitment.approvalId, "R-2");
  assert.deepEqual(notifications().map((m) => m.to), [[j("ravi")], [j("ravi")]]);
  assert.equal(app.demoInfo().current.adminPath, "/admin/requests/E-1?tab=details#request-export");
  store.close();
});

test("Juniper adapts to a shorter deadline with the hold rule removed, and resets to sample rules", async () => {
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.loadScenario("juniper");
  const current = store.getConfig();
  const { org, policy } = current.doc;
  saveCompany(store, { ...org, policy: { ...policy, supplierTimeoutHours: 6, flow: policy.flow.filter((step) => step.kind !== "hold") } }, {
    expectedVersion: current.version, actor: "admin", action: "policy.edited", summary: "Change demo rules",
  });
  await runAll(app);
  const ev = store.getEvent("E-1");
  assert.ok(!ev.history.some((h) => h.action === "flow.hold"));
  assert.ok(ev.history.some((h) => h.action === "review.flagged" && h.summary.includes("in 6h")));
  assert.equal(ev.commitment.amount, 46000);
  app.loadScenario("acme");
  assert.equal(store.listEvents().length, 0);
  assert.equal(app.demoReview(1), null);
  app.loadScenario("juniper");
  assert.equal(store.getConfig().doc.policy.supplierTimeoutHours, 24);
  assert.ok(store.getConfig().doc.policy.flow.some((step) => step.kind === "hold"));
  store.close();
});

test("a failed booking delivery stays unconfirmed until the same supplier message is retried", async () => {
  const store = openDb(":memory:");
  const transport = localTransport();
  const send = transport.send;
  let failBooking = true;
  transport.send = (message) => {
    if (failBooking && message.meta?.kind === "supplier-request" && /^type: booking$/m.test(message.body)) {
      failBooking = false;
      throw new Error("Simulated delivery interruption");
    }
    return send(message);
  };
  const app = createApp({ store, transport });
  app.loadScenario("juniper");
  while (app.demoInfo().current?.key !== "H5") assert.ok((await app.demoStep()).step);
  assert.equal(store.getEvent("E-1").supplierRequests.at(-1).status, "failed");
  assert.equal((await app.supplierTick()).replies, 0);
  assert.equal(store.getEvent("E-1").commitment, null);
  const [failed] = store.outbox("failed");
  assert.equal((await app.retryDelivery(failed.id)).status, "delivered-local");
  assert.equal(store.getEvent("E-1").supplierRequests.at(-1).status, "sent");
  assert.equal((await app.demoStep()).step, "H6");
  assert.equal(store.getEvent("E-1").commitment.amount, 46000);
  assert.equal(app.plannedExchanges().filter((exchange) => exchange.type === "booking").length, 1);
  store.close();
});
