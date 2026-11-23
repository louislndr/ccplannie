// Company hierarchy: CSV validation, and that the uploaded org really controls who can act.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PLANNIE_INTERPRETER = "fixture";
const { readOrgCsv, toCsv, DEFAULT_ROLES, PERMISSIONS, capsFor, cloneRoles } = await import("../src/org.mjs");
const { applyOrg, SAMPLE_ORG, can, PEOPLE, POLICY } = await import("../src/config.mjs");

const HEAD = "name,email,title,manager_email,roles,approval_limit,backup_email\n";

test("valid CSV parses roles, managers, limits and quoted fields", () => {
  const r = readOrgCsv(HEAD + `"Ruiz, Dana",dana@x.co,VP,,sponsor,,\nSam,sam@x.co,EA,dana@x.co,requester;stakeholder,,\nPri,pri@x.co,Finance,,finance,"75,000",\nAl,al@x.co,Events,,event_manager,,\n`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.people[0].name, "Ruiz, Dana");
  assert.deepEqual(r.people[1].roles, ["requester", "stakeholder"]);
  assert.equal(r.people[1].manager, "dana@x.co");
  assert.equal(r.people[2].approveUpTo, 75000);
});

test("invalid CSVs are rejected with row-level reasons", () => {
  const msgs = (csv) => readOrgCsv(csv).errors.map((e) => e.message).join(" | ");
  assert.match(msgs("name,email\nA,a@x.co\n"), /Missing column "roles"/);
  assert.match(msgs(HEAD + "A,not-an-email,,,sponsor,,\n"), /valid email/);
  assert.match(msgs(HEAD + "A,a@x.co,,,boss,,\n"), /Unknown role "boss"/);
  assert.match(msgs(HEAD + "A,a@x.co,,,finance,,\nB,b@x.co,,,event_manager,,\n"), /approval limit/);
  assert.match(msgs(HEAD + "A,a@x.co,,b@x.co,finance,10,\nB,b@x.co,,a@x.co,event_manager,,\n"), /Reporting loop/);
  assert.match(msgs(HEAD + "A,a@x.co,,,sponsor,,\nA2,a@x.co,,,sponsor,,\n"), /listed twice/);
  assert.match(msgs(HEAD + "A,a@x.co,,,sponsor,,\n"), /event manager is needed/);
  assert.match(msgs(HEAD + "A,a@x.co,,nobody@x.co,event_manager;finance,5,\n"), /isn't in the company/);
});

test("roles round-trip through CSV: renamed, new and deleted roles with grouped permissions", () => {
  const roles = cloneRoles(DEFAULT_ROLES);
  roles.sponsor = { label: "Office Lead", summary: 'Owns the offsite, including "venue selection".\nCoordinates with Finance.', permissions: ["request", "decide"] };
  roles.controller = { label: "Controller", summary: "Approves and books", permissions: ["approve", "manage"] };
  delete roles.stakeholder;
  const people = SAMPLE_ORG.map((p) => (p.email === "leo@acme.example" ? { ...p, roles: ["controller"], approveUpTo: 5000 } : p));
  const r = readOrgCsv(toCsv(people, roles));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.roles, roles);
  assert.deepEqual(r.people.map(({ line, ...person }) => person), people);
  try {
    applyOrg(r.people, { roles: r.roles });
    assert.match(PEOPLE["dana@acme.example"].title, /Office Lead/);
    assert.equal(can("dana@acme.example", "option.select"), true);
    assert.equal(can("dana@acme.example", "spend.approve"), false);
    for (const cap of ["spend.approve", "event.own", "supplier.authorize", "suggest"]) assert.equal(can("leo@acme.example", cap), true, cap);
    assert.equal(can("leo@acme.example", "plan.change_scope"), false);
  } finally { applyOrg(SAMPLE_ORG, { source: "sample" }); }
});

test("the default roles grant exactly the capabilities the fixed roles used to", () => {
  const was = {
    sponsor: ["event.request", "plan.provide_details", "plan.change_scope", "option.select", "suggest"],
    requester: ["event.request", "plan.provide_details", "suggest"],
    finance: ["spend.approve", "suggest"],
    event_manager: ["event.own", "supplier.inquire", "supplier.authorize", "clause.review", "decision.manual", "plan.provide_details", "suggest"],
    stakeholder: ["suggest"],
  };
  for (const [id, caps] of Object.entries(was)) assert.deepEqual(capsFor([id], DEFAULT_ROLES).sort(), [...caps].sort(), id);
  assert.deepEqual(PERMISSIONS.map((p) => p.id), ["request", "decide", "approve", "manage"]);
});

test("CSV role rows are validated; files without role rows keep the current roles", () => {
  const csv = toCsv(SAMPLE_ORG);
  const header = csv.split("\n")[0];
  const dup = readOrgCsv(csv + ",,,,,,,finance,Second title,,approve\n");
  assert.match(dup.errors[0].message, /more than once/);
  const badPerm = readOrgCsv(csv + ",,,,,,,auditor,Auditor,,approve;teleport\n");
  assert.match(badPerm.errors[0].message, /unknown permission "teleport"/);
  const sameName = readOrgCsv(csv + ",,,,,,,boss,Sponsor,,decide\n");
  assert.match(sameName.errors[0].message, /Two roles are called “Sponsor”/);
  // An older template (no role_permissions column) can rename roles but can't invent new ones.
  const oldHead = "name,email,title,manager_email,roles,approval_limit,backup_email,role_id,role_label,role_description\n";
  const rows = SAMPLE_ORG.map((p) => [p.name, p.email, "", "", p.roles.join(";"), p.approveUpTo ?? "", ""].join(",")).join("\n");
  const legacy = readOrgCsv(oldHead + rows + "\n,,,,,,,sponsor,Office Lead,Decides\n,,,,,,,auditor,Auditor,Reads\n");
  assert.match(legacy.errors[0].message, /Role auditor is new: add a role_permissions column/);
  const noRoles = readOrgCsv(HEAD + rows);
  assert.deepEqual(noRoles.errors, []);
  assert.equal(noRoles.roles, null);
  const roleOnly = readOrgCsv(`${header}\n,,,,,,,sponsor,Office Lead,,request;decide\n`);
  assert.match(roleOnly.errors.at(-1).message, /Include employee rows/);
});

test("people can name roles by label, and deleting a role still in use is refused", () => {
  const r = readOrgCsv(HEAD + "Pri,pri@x.co,,,Finance approver,5000,\nAl,al@x.co,,,Event Manager,,\n");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.people.map((p) => p.roles), [["finance"], ["event_manager"]]);
  const roles = cloneRoles(DEFAULT_ROLES); delete roles.finance;
  const gone = readOrgCsv(toCsv(SAMPLE_ORG, roles));
  assert.ok(gone.errors.some((e) => /Unknown role "finance"/.test(e.message)));
  assert.ok(gone.errors.some((e) => /finance approver is needed/.test(e.message)));
});

test("approval limits and backups follow permissions, not role names", () => {
  const roles = { ...cloneRoles(DEFAULT_ROLES), treasurer: { label: "Treasurer", summary: "", permissions: ["approve"] } };
  const csv = toCsv([...SAMPLE_ORG.map((p) => (p.email === "priya@acme.example" ? { ...p, backup: "tom@acme.example" } : p)), { name: "Tom", email: "tom@acme.example", title: "", manager: null, roles: ["treasurer"], approveUpTo: null, backup: null }], roles);
  const r = readOrgCsv(csv);
  assert.ok(r.errors.some((e) => e.row && /approval limit/.test(e.message)), "treasurer needs a limit");
  const r2 = readOrgCsv(csv.replace("Tom,tom@acme.example,,,treasurer,,", "Tom,tom@acme.example,,,treasurer,500,"));
  assert.deepEqual(r2.errors, [], "same permissions → valid backup even though the role differs");
  assert.ok(r2.warnings.some((w) => /lower approval limit/.test(w.message)));
});

test("applying an org changes who can act, and the sample round-trips through CSV", () => {
  try {
    const r = readOrgCsv(toCsv(SAMPLE_ORG));
    assert.deepEqual(r.errors, []);
    assert.equal(r.people.length, SAMPLE_ORG.length);
    // Leo is promoted to finance; Priya is removed entirely.
    const people = SAMPLE_ORG.filter((p) => p.email !== "priya@acme.example").map((p) => (p.email === "leo@acme.example" ? { ...p, roles: ["finance"], approveUpTo: 20000 } : p));
    applyOrg(people);
    assert.equal(can("priya@acme.example", "spend.approve"), false);
    assert.equal(PEOPLE["priya@acme.example"], undefined);
    assert.equal(can("leo@acme.example", "spend.approve"), true);
    assert.equal(PEOPLE["leo@acme.example"].limits.approveUpTo, 20000);
    assert.equal(POLICY.defaultManager, "alex@acme.example");
  } finally { applyOrg(SAMPLE_ORG, { source: "sample" }); }
});

test("in the demo, a finance approver removed from the org can no longer approve", async () => {
  const { openDb } = await import("../src/db.mjs");
  const { createApp } = await import("../src/app.mjs");
  const { localTransport } = await import("../src/transport.mjs");
  const store = openDb(":memory:");
  const app = createApp({ store, transport: localTransport() });
  app.resetDemo();
  try {
    for (;;) { const r = await app.demoStep(); if (r.step === "A10") break; }
    applyOrg(SAMPLE_ORG.map((p) => (p.email === "priya@acme.example" ? { ...p, roles: ["stakeholder"], approveUpTo: null } : p)));
    await app.demoStep(); // A11: Priya's "Approve R-1"
    const ev = store.listEvents()[0];
    assert.equal(ev.approvals.find((a) => a.id === "R-1").status, "pending");
    assert.equal(ev.approved, null);
  } finally { applyOrg(SAMPLE_ORG, { source: "sample" }); }
});

test("restoring the sample clears the saved upload, so a restart doesn't bring it back", async () => {
  const { openDb } = await import("../src/db.mjs");
  const store = openDb(":memory:");
  store.setMeta("org", { people: [{ email: "x@y.co" }], updatedAt: "t" });
  store.setMeta("org", null);
  assert.equal(store.getMeta("org"), null);
  store.setMeta("clock", null); // live mode uses this too
  assert.equal(store.getMeta("clock"), null);
});
