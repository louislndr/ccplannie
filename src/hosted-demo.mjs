import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createApp } from "./app.mjs";
import { openDb } from "./db.mjs";
import { createRequestHandler } from "./server-app.mjs";
import { localTransport } from "./transport.mjs";

const COOKIE = "ccplannie_demo";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SAVE = `
  local version = redis.call('HGET', KEYS[1], 'version') or '0'
  if version ~= ARGV[1] then return 0 end
  redis.call('HSET', KEYS[1], 'version', tonumber(version) + 1, 'db', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return 1
`;

async function redis(command) {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!endpoint || !token) throw new Error("Demo storage credentials are missing.");
  const result = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await result.json();
  if (!result.ok || payload.error) throw new Error("Demo storage request failed.");
  return payload.result;
}

// App configuration was designed for one company per Node process. Hold the queue only
// while the app runs. Redis calls can overlap, and compare-and-set guards concurrent writes.
let previousRequest = Promise.resolve();
function runApp(task) {
  const request = previousRequest.then(task);
  previousRequest = request.catch(() => {});
  return request;
}

export function createHostedDemo({ command = redis } = {}) {
  return async (request) => {
    const url = new URL(request.url);
    const routedPath = url.searchParams.get("__demoPath");
    if (url.pathname === "/api/hosted-demo" && routedPath) url.pathname = `/api/${routedPath}`;
    url.searchParams.delete("__demoPath");
    if (!url.pathname.startsWith("/api/")) return Response.json({ error: "Route not found." }, { status: 404 });
    const writes = request.method !== "GET" && request.method !== "HEAD";
    const origin = request.headers.get("origin");
    if (writes && origin && origin !== url.origin) {
      return Response.json({ error: "Send requests from the demo site." }, { status: 403 });
    }
    const rawCookie = request.headers.get("cookie")?.match(/(?:^|;\s*)ccplannie_demo=([a-f0-9-]+)(?:;|$)/)?.[1];
    const existing = rawCookie?.length === 36 ? rawCookie : null;
    const id = existing || randomUUID();
    const key = `ccplannie:demo:${process.env.VERCEL_ENV || "local"}:${id}`;
    const cookie = `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${url.protocol === "https:" ? "; Secure" : ""}`;
    const text = writes ? await request.text().catch(() => null) : "";
    const directory = await mkdtemp(join(tmpdir(), "ccplannie-"));
    const path = join(directory, "state.sqlite");
    try {
      const [version, saved] = await command(["HMGET", key, "version", "db"]);
      if (saved) await writeFile(path, gunzipSync(Buffer.from(saved, "base64")));
      const result = await runApp(async () => {
        const store = openDb(path);
        try {
          const transport = localTransport();
          const app = createApp({ store, transport });
          if (!saved) app.loadScenario("acme");
          const headers = Object.fromEntries(request.headers);
          headers.host = url.host;
          const req = {
            url: url.pathname + url.search,
            method: request.method,
            headers,
            readJson() {
              try {
                if (text === null) throw new Error();
                return text ? JSON.parse(text) : {};
              } catch { throw Object.assign(new Error("Send valid JSON."), { status: 400 }); }
            },
          };
          const response = {
            status: 200,
            headers: {},
            body: undefined,
            writeHead(status, headers) { this.status = status; this.headers = headers; },
            end(body) { this.body = body; },
          };
          await createRequestHandler({ store, app, transport })(req, response);
          return response;
        } finally { store.close(); }
      });
      if (writes && result.status < 400) {
        const encoded = gzipSync(await readFile(path)).toString("base64");
        const savedVersion = await command(["EVAL", SAVE, "1", key, version || "0", encoded, SESSION_SECONDS]);
        if (!savedVersion) return Response.json({ error: "The demo changed in another tab. Refresh and try again." }, { status: 409, headers: { "cache-control": "no-store" } });
      }
      return new Response(result.body, {
        status: result.status,
        headers: { ...result.headers, "cache-control": "no-store", ...(!existing || (writes && result.status < 400) ? { "set-cookie": cookie } : {}) },
      });
    } catch (error) {
      console.error("Hosted demo:", error.message);
      return Response.json({ error: "Couldn’t open demo storage. Try again shortly." }, { status: 503, headers: { "cache-control": "no-store" } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
