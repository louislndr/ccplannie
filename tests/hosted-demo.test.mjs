import { test } from "node:test";
import assert from "node:assert/strict";
import { createHostedDemo } from "../src/hosted-demo.mjs";

process.env.PLANNIE_INTERPRETER = "fixture";
const origin = "https://demo.example";

test("the Vercel handler persists each browser's demo across instances", async () => {
  const states = new Map();
  async function command([op, ...args]) {
    if (op === "HMGET") return states.get(args[0]) || [null, null];
    assert.equal(op, "EVAL");
    const [, keys, key, current, state, expires] = args;
    assert.equal(keys, "1");
    assert.equal(expires, 7 * 86400);
    if (current !== (states.get(key)?.[0] || "0")) return 0;
    states.set(key, [String(Number(current) + 1), state]);
    return 1;
  }
  let handle = createHostedDemo({ command });
  const request = (path, cookie, data) => handle(new Request(origin + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { origin, "content-type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  }));
  const first = await request("/api/hosted-demo?__demoPath=state");
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.match(first.headers.get("set-cookie"), /HttpOnly.*Secure/);
  assert.equal((await first.json()).demo.step, 0);
  for (const id of ["acme", "northwind", "juniper"]) {
    assert.equal((await request("/api/hosted-demo?__demoPath=demo/scenario", cookie, { id })).status, 200);
    assert.equal((await request("/api/demo/run", cookie, {})).status, 200);
    handle = createHostedDemo({ command });
    const state = await (await request("/api/state", cookie)).json();
    assert.equal(state.demo.scenario.id, id);
    assert.equal(state.demo.step, state.demo.steps.length);
    const review = await request("/api/hosted-demo?__demoPath=demo/review&step=1", cookie);
    assert.equal((await review.json()).demo.step, 1);
    const session = await (await request("/api/admin/session", cookie)).json();
    assert.equal(session.demo.scenario.id, id);
    assert.equal(session.demo.step, state.demo.step);
  }
  const exportResponse = await request("/api/admin/requests/E-1/export", cookie);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition"), /attachment/);
  assert.match(await exportResponse.text(), /CW-88412/);
  const anotherBrowser = await (await request("/api/state")).json();
  assert.equal(anotherBrowser.demo.scenario.id, "acme");
  assert.equal(anotherBrowser.demo.step, 0);
  const tabs = await Promise.all([
    request("/api/demo/reset", cookie, {}),
    request("/api/demo/scenario", cookie, { id: "northwind" }),
  ]);
  assert.deepEqual(tabs.map((reply) => reply.status).sort(), [200, 409]);
});
