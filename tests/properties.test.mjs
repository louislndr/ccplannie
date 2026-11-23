import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import fc from "fast-check";
import { createApp } from "../src/app.mjs";
import { openDb } from "../src/db.mjs";
import { MAX_LIMIT, parseLimit } from "../src/org.mjs";
import { SCENARIOS } from "../src/scenarios/index.mjs";
import { createServer } from "../src/server-app.mjs";
import { localTransport } from "../src/transport.mjs";

const scenarioIds = Object.keys(SCENARIOS);
const scenarioId = fc.constantFrom(...scenarioIds);
const api = {
  state: "/api/state",
  step: "/api/demo/step",
  reset: "/api/demo/reset",
  scenario: "/api/demo/scenario",
  session: "/api/admin/session",
  requests: "/api/admin/requests",
  company: "/api/admin/company",
  policy: "/api/admin/policy/apply",
  activity: "/api/admin/activity",
};

async function withDemo(id, check) {
  const store = openDb(":memory:");
  const transport = localTransport();
  const app = createApp({ store, transport });
  app.loadScenario(id);
  const [handler] = createServer({ store, app, transport, mode: "demo" }).listeners("request");

  async function request(url, body) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
      method: body === undefined ? "GET" : "POST",
      url,
      headers: { host: "fixture.example", "content-type": "application/json" },
      socket: { remoteAddress: "127.0.0.1" },
    });
    let status;
    let data;
    await handler(req, {
      writeHead(code) { status = code; },
      end(raw) { data = JSON.parse(raw); },
    });
    return { status, data };
  }

  try {
    await check(request);
  } finally {
    store.close();
  }
}

async function ok(request, path, body) {
  const result = await request(path, body);
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

test("approval limits keep their cents across accepted input formats", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: MAX_LIMIT * 100 }), (cents) => {
    const amount = cents / 100;
    const grouped = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const input of [amount, amount.toFixed(2), grouped, `CAD ${grouped}`]) {
      assert.deepEqual(parseLimit(input), { value: amount });
    }
  }), { numRuns: 200 });
});

test("the story and dashboard stay in sync across generated steps, resets, and scenario switches", async () => {
  const action = fc.oneof(
    fc.constant({ kind: "step" }),
    fc.constant({ kind: "reset" }),
    scenarioId.map((id) => ({ kind: "switch", id })),
  );
  await fc.assert(fc.asyncProperty(scenarioId, fc.array(action, { minLength: 1, maxLength: 20 }), async (selected, actions) => {
    await withDemo(selected, async (request) => {
      let expectedScenario = selected;
      let expectedStep = 0;
      for (const operation of actions) {
        if (operation.kind === "step") {
          await ok(request, api.step, {});
          expectedStep = Math.min(expectedStep + 1, SCENARIOS[expectedScenario].steps.length);
        } else {
          if (operation.kind === "switch") {
            await ok(request, api.scenario, { id: operation.id });
            expectedScenario = operation.id;
          } else {
            await ok(request, api.reset, {});
          }
          expectedStep = 0;
        }

        const story = await ok(request, api.state);
        const dashboard = (await ok(request, api.session)).demo;
        const inbox = await ok(request, api.requests);
        assert.deepEqual([story.demo.scenario.id, story.demo.step], [expectedScenario, expectedStep]);
        assert.deepEqual([dashboard.scenario.id, dashboard.step], [expectedScenario, expectedStep]);
        assert.deepEqual(inbox.items.map(({ id }) => id).sort(), story.events.map(({ id }) => id).sort());
        if (expectedStep === 0) assert.deepEqual(inbox.items, []);
      }
    });
  }), { numRuns: 60 });
});

test("valid policy changes reach the story, and rejected changes leave the policy and activity untouched", async () => {
  const timeout = fc.oneof(fc.integer({ min: 1, max: 720 }), fc.integer({ min: -25, max: 0 }), fc.integer({ min: 721, max: 800 }));
  await fc.assert(fc.asyncProperty(scenarioId, fc.array(timeout, { minLength: 1, maxLength: 12 }), async (selected, timeouts) => {
    await withDemo(selected, async (request) => {
      for (const hours of timeouts) {
        const { config } = await ok(request, api.company);
        const before = await ok(request, api.activity);
        const result = await request(api.policy, {
          expectedVersion: config.version,
          policy: { ...config.policy, supplierTimeoutHours: hours },
        });
        const accepted = hours >= 1 && hours <= 720;
        assert.equal(result.status, accepted ? 200 : 422);
        const next = (await ok(request, api.company)).config;
        const story = await ok(request, api.state);
        const activity = await ok(request, api.activity);
        assert.equal(story.policy.supplierTimeoutHours, next.policy.supplierTimeoutHours);
        assert.equal(story.policy.configVersion, next.version);
        if (!accepted || hours === config.policy.supplierTimeoutHours) {
          assert.deepEqual(next, config);
          assert.deepEqual(activity, before);
        } else {
          assert.equal(next.policy.supplierTimeoutHours, hours);
          assert.equal(next.version, config.version + 1);
          assert(activity.entries.some((entry) => entry.action === "policy.saved" && entry.configVersion === next.version));
        }
      }
    });
  }), { numRuns: 60 });
});

test("Northwind only notifies the approver when their exact limit covers the offer", async () => {
  const offerCents = 16800000;
  await fc.assert(fc.asyncProperty(fc.integer({ min: offerCents - 250, max: offerCents + 250 }), async (limitCents) => {
    await withDemo("northwind", async (request) => {
      const approver = "ava@northwind.example";
      const { config, org } = await ok(request, api.company);
      const people = org.people.map((person) => person.email === approver ? { ...person, approveUpTo: limitCents / 100 } : person);
      await ok(request, "/api/admin/people/apply", { people, expectedVersion: config.version });
      for (let step = 0; step < 6; step++) await ok(request, api.step, {});

      const { event } = await ok(request, "/api/admin/requests/E-1");
      const [approval] = event.approvals;
      const story = await ok(request, api.state);
      const coverage = limitCents >= offerCents;
      const hasApprovalEmail = story.messages.some((message) => message.meta?.kind === "approval" && message.to.includes(approver));
      assert.equal(approval.terms.amount, offerCents / 100);
      assert.equal(approval.approver, approver);
      assert.equal(approval.status, "pending");
      assert.equal(approval.notified, coverage);
      assert.equal(hasApprovalEmail, coverage);
      assert.equal(approval.blocker?.code ?? null, coverage ? null : "over_limit");
    });
  }), { numRuns: 60, examples: [[offerCents - 1], [offerCents], [offerCents + 1]] });
});
