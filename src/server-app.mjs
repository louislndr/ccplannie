// HTTP API + static web UI. server.mjs starts it in one of two modes; tests start it on an ephemeral port.
//
//   mode "demo"     The fictional demos (src/scenarios/), simulated venues, a demo clock and a local outbox.
//                   The story site and an open admin dashboard (/admin) share one database. Nothing leaves
//                   the machine. The hosted demo (src/hosted-demo.mjs) wraps this mode with one session per browser.
//   mode "company"  The company console for a real company: starts empty, people are added on the People
//                   page. Mail goes through AgentMail, Gmail or Postmark when configured (src/transport.mjs),
//                   otherwise it stays in the local outbox. Venue exchanges stay simulated. Every /api/admin
//                   route needs an administrator session (password from PLANNIE_ADMIN_PASSWORD). Demo
//                   endpoints don't exist here.
//
// A client-supplied actor is never an administrator. Admin actions are attributed to the session.
// Manager actions name a configured person; the domain re-checks that person's live powers on execution,
// and the history records that the action was taken through the admin console.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizePostmark } from "./transport.mjs";
import { PLANNIE, TRUSTED_LOCAL, isPlannieAddress, ORG, PEOPLE, COMPANY, CONFIG, person } from "./config.mjs";
import { readOrgCsv, toCsv, permsFor } from "./org.mjs";
import { chat } from "./chat.mjs";
import { readPolicyDocument } from "./policy-import.mjs";
import { serverIsStale } from "./code-version.mjs";
import { FIXTURE_INTERPRETATIONS } from "./demo.mjs";
import { saveCompany, validateDoc, diffDoc, currentDoc, configView, ValidationError, fmtPolicy, POLICY_LABELS } from "./company.mjs";
import * as C from "./console.mjs";
import { scenario } from "./scenarios/index.mjs";

const DIST = new URL("../web/dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const json = (res, code, data, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(data)); };
const readBody = (req) => req.readJson ? req.readJson() : new Promise((ok, bad) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 25e6) bad(Object.assign(new Error("too large"), { status: 413 })); }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(Object.assign(e, { status: 400 })); } }); });
const sha = (s) => createHash("sha256").update(String(s)).digest();
const uploadName = (name) => typeof name === "string" ? name.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) : null;
const eq = (a, b) => timingSafeEqual(sha(a), sha(b)); // constant-time, length-independent
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));

export const ADMIN = Object.freeze({ id: "admin", label: "Administrator" });
const SESSION_COOKIE = "plannie_admin";
const SESSION_HOURS = 12;

export function createServer(options) {
  return http.createServer(createRequestHandler(options));
}

export function createRequestHandler({ store, app, transport, mode = "demo", adminPassword = process.env.PLANNIE_ADMIN_PASSWORD || "", home = "/" }) {
  const company = mode === "company";
  const attempts = new Map(); // ip → recent failed login timestamps (in memory)

  // ---------------------------------------------------------------- admin session (company mode)
  const sessionOf = (req) => {
    const t = cookies(req)[SESSION_COOKIE];
    if (!t) return null;
    return store.getSession(sha(t).toString("hex"), new Date().toISOString()) ? ADMIN : null;
  };
  const secure = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  const cookie = (req, value, maxAge) => `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;
  // Writes must come from this site (SameSite cookie + Origin check + JSON-only bodies).
  const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

  const managerIdentity = (actor) => { const a = String(actor || "").toLowerCase(); const p = person(a); return p && !p.alias && TRUSTED_LOCAL.has(a) ? a : null; };
  function basicAuthOk(req) {
    const user = process.env.POSTMARK_WEBHOOK_USER, pass = process.env.POSTMARK_WEBHOOK_PASS;
    if (!user || !pass) return false; // webhook disabled unless credentials are configured
    const [u = "", p = ""] = Buffer.from((req.headers.authorization || "").replace(/^Basic\s+/i, ""), "base64").toString().split(":");
    return eq(u, user) && eq(p, pass);
  }

  async function serveStatic(res, path) {
    const rel = normalize(path === "/" ? "index.html" : path.slice(1));
    if (rel.startsWith("..")) return false;
    let file = join(DIST, rel);
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(DIST, "index.html"); } // SPA fallback: deep links
    try { res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(await readFile(file)); return true; }
    catch { return false; }
  }

  const events = () => store.listEvents();
  const sessionView = (admin) => ({ mode, admin, stale: serverIsStale(), demo: company ? null : app.demoInfo(), plannie: { intake: PLANNIE.intake, from: PLANNIE.from },
    identities: Object.entries(PEOPLE).filter(([, x]) => !x.alias).map(([email, x]) => ({ email, name: x.name, roles: x.roles, caps: x.caps })) });
  const companyView = () => ({ config: configView(store), org: C.orgView(), labels: POLICY_LABELS, mode });
  // A company's first people save also sets the routing defaults (shown in the review) if none exist yet.
  const withDefaults = (next) => {
    const pol = { ...next.policy };
    const roles = next.roles && typeof next.roles === "object" ? next.roles : ORG.roles;
    const firstWith = (perm) => String((Array.isArray(next.people) ? next.people : []).find((x) => { try { return permsFor(Array.isArray(x?.roles) ? x.roles : [], roles).includes(perm); } catch { return false; } })?.email || "").trim().toLowerCase();
    if (!pol.defaultManager) pol.defaultManager = firstWith("manage");
    if (!pol.defaultFinanceApprover) pol.defaultFinanceApprover = firstWith("approve");
    return { ...next, policy: pol };
  };
  const nextFromPeople = (b, cur) => withDefaults({ people: b.people, roles: b.roles ?? cur.org.roles, policy: cur.policy, renames: Array.isArray(b.renames) ? b.renames.filter((r) => r && typeof r.from === "string" && typeof r.to === "string").map((r) => ({ from: r.from.toLowerCase(), to: r.to.toLowerCase() })) : [] });
  const preview = (next) => {
    const cur = currentDoc();
    const v = validateDoc(next);
    return { version: CONFIG.version, errors: v.errors, warnings: v.warnings, diff: v.errors.length ? null : diffDoc(cur, { ...v.doc, renames: next.renames || [] }, events()) };
  };
  const save = (actor, next, b, action, summary, source = "saved") => {
    const sourceFile = action === "org.csv_imported" || action === "policy.imported" ? uploadName(b.fileName) : null;
    return { ...saveCompany(store, next, { expectedVersion: b.expectedVersion, actor, action, summary, source, sourceFile, events: events() }), ...companyView() };
  };
  const csvNext = (r) => withDefaults({ people: r.people.map(({ line, ...p }) => p), roles: r.roles ?? currentDoc().org.roles, policy: currentDoc().policy });
  const policySummary = (cur, next) => Object.keys(POLICY_LABELS).filter((k) => cur[k] !== next[k]).map((k) => `${POLICY_LABELS[k]}: ${fmtPolicy(k, cur[k])} → ${fmtPolicy(k, next[k])}`).join("; ");
  const csvPreview = (csv) => {
    const r = readOrgCsv(csv, { currency: COMPANY.currency, roles: ORG.roles });
    if (r.errors.length) return { ...r, version: CONFIG.version, changes: [], roleChanges: [], diff: null };
    const pv = preview(csvNext(r));
    return { ...r, ...pv, errors: [...r.errors, ...pv.errors], changes: pv.diff ? [...pv.diff.people, ...pv.diff.roles, ...pv.diff.limits] : [], roleChanges: pv.diff ? pv.diff.roleDefinitions.map((x) => ({ id: x.id, kind: x.kind, text: x.text, label: (x.after || x.before).label, summary: (x.after || x.before).summary })) : [] };
  };

  // ---------------------------------------------------------------- company console API
  async function adminApi(req, res, url, seg) {
    const M = req.method;
    if (M !== "GET" && !sameOrigin(req)) return json(res, 403, { error: "Cross-site request refused." });
    if (M !== "GET" && !/^application\/json\b/i.test(req.headers["content-type"] || "")) return json(res, 415, { error: "Send JSON." });

    // In the demo, the admin dashboard is part of the demo: open, acting as the demo's administrator.
    if (!company && (seg[0] === "login" || seg[0] === "logout")) return json(res, 200, { ok: true, demo: true });
    if (seg[0] === "login" && M === "POST") {
      if (!adminPassword) return json(res, 503, { error: "No administrator password is configured. Set PLANNIE_ADMIN_PASSWORD on the server and restart.", code: "not_configured" });
      const ip = req.socket.remoteAddress || "?", now = Date.now();
      const recent = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
      if (recent.length >= 10) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
      const b = await readBody(req);
      if (typeof b.password !== "string" || !eq(b.password, adminPassword)) { attempts.set(ip, [...recent, now]); return json(res, 401, { error: "That password isn't right.", code: "login_failed" }); }
      attempts.delete(ip);
      const token = randomBytes(32).toString("base64url");
      const at = new Date();
      store.purgeSessions(at.toISOString());
      store.createSession(sha(token).toString("hex"), at.toISOString(), new Date(at.getTime() + SESSION_HOURS * 3600000).toISOString());
      return json(res, 200, { ok: true }, { "set-cookie": cookie(req, token, SESSION_HOURS * 3600) });
    }
    if (seg[0] === "logout" && M === "POST") {
      const t = cookies(req)[SESSION_COOKIE];
      if (t) store.deleteSession(sha(t).toString("hex"));
      return json(res, 200, { ok: true }, { "set-cookie": cookie(req, "", 0) });
    }

    const admin = company ? sessionOf(req) : ADMIN;
    if (!admin) return json(res, adminPassword ? 401 : 503, adminPassword ? { error: "Sign in to use the company console.", code: "login_required" } : { error: "No administrator password is configured. Set PLANNIE_ADMIN_PASSWORD on the server and restart.", code: "not_configured" });

    if (M === "GET" && seg[0] === "session") return json(res, 200, sessionView(admin));
    if (M === "GET" && seg[0] === "requests" && seg.length === 1) return json(res, 200, C.inbox(store, app));
    if (M === "GET" && seg[0] === "planned") return json(res, 200, { mode: "sample", exchanges: app.plannedExchanges(), events: store.listEvents().map((e) => ({ id: e.id, title: e.title })) });
    if (seg[0] === "requests" && seg[1]) {
      const id = decodeURIComponent(seg[1]).toUpperCase();
      if (M === "GET" && seg.length === 2) {
        const as = url.searchParams.get("as");
        const d = C.detail(store, app, id, as ? managerIdentity(as) : null);
        return d ? json(res, 200, { ...d, planned: app.plannedExchanges(id) }) : json(res, 404, { error: `No request ${id}.` });
      }
      if (M === "GET" && seg[2] === "export") {
        const x = C.handoffExport(store, app, id, app.transportName, { demo: !company });
        if (!x) return json(res, 404, { error: `No request ${id}.` });
        res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename="ccplannie-handoff-${id}-v${x.request.eventVersion}-LOCAL.json"`, "cache-control": "no-store" });
        return res.end(JSON.stringify(x, null, 2));
      }
      if (M === "POST" && seg[2] === "route") {
        const b = await readBody(req);
        return json(res, 200, await app.routeRequest(id, admin, b.manager, { expectedVersion: b.expectedVersion ?? null, requestId: b.requestId || null }));
      }
      if (M === "POST" && seg[2] === "approvals" && seg[3] && seg[4] === "assign") {
        const b = await readBody(req);
        return json(res, 200, await app.reassignApproval(id, admin, decodeURIComponent(seg[3]).toUpperCase(), b.approver, { expectedVersion: b.expectedVersion ?? null, requestId: b.requestId || null }));
      }
      if (M === "POST" && seg[2] === "action") {
        const b = await readBody(req);
        const actor = managerIdentity(b.actor);
        if (!actor) return json(res, 403, { error: "Choose a person from the company directory to act for." });
        if (b.expectedVersion == null) return json(res, 400, { error: "expectedVersion is required." });
        return json(res, 200, await app.manager(id, actor, b.action, b.args || {}, { expectedVersion: b.expectedVersion, requestId: b.requestId || null, via: "admin console" }));
      }
    }
    if (M === "POST" && seg[0] === "outbox" && seg[2] === "retry") return json(res, 200, await app.retryDelivery(decodeURIComponent(seg[1])));
    if (M === "POST" && seg[0] === "intake" && seg[2] === "reprocess") return json(res, 200, await app.reprocessIntake(decodeURIComponent(seg[1]).toUpperCase(), admin));
    if (M === "GET" && seg[0] === "company") return json(res, 200, companyView());
    if (M === "POST" && seg[0] === "people" && seg[1] === "preview") { const b = await readBody(req); return json(res, 200, preview(nextFromPeople(b, currentDoc()))); }
    if (M === "POST" && seg[0] === "people" && seg[1] === "apply") { const b = await readBody(req); return json(res, 200, save(admin.id, nextFromPeople(b, currentDoc()), b, "org.edited", "Edited people in the console.")); }
    if (M === "GET" && seg[0] === "csv") { res.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename="${C.DIRECTORY_CSV_FILE}"`, "cache-control": "no-store" }); return res.end(toCsv(ORG.people, ORG.roles)); }
    if (M === "POST" && seg[0] === "csv" && seg[1] === "preview") return json(res, 200, csvPreview((await readBody(req)).csv));
    if (M === "POST" && seg[0] === "csv" && seg[1] === "apply") {
      const b = await readBody(req);
      const r = readOrgCsv(b.csv, { currency: COMPANY.currency, roles: ORG.roles });
      if (r.errors.length) return json(res, 422, { error: "Fix the errors before applying.", errors: r.errors, warnings: r.warnings });
      return json(res, 200, save(admin.id, csvNext(r), b, "org.csv_imported", `Imported people from CSV (${r.people.length} people).`));
    }
    if (M === "POST" && seg[0] === "policy" && (seg[1] === "preview" || seg[1] === "apply")) {
      const b = await readBody(req);
      const cur = currentDoc();
      const next = { people: cur.org.people, roles: cur.org.roles, policy: b.policy };
      if (seg[1] === "preview") return json(res, 200, preview(next));
      const v = validateDoc(next);
      const action = b.documentSource === "upload" ? "policy.imported" : !company && b.documentSource === "sample" ? "policy.sample_applied" : "policy.saved";
      return json(res, 200, save(admin.id, next, b, action, v.errors.length ? "Policy saved." : `Policy saved: ${policySummary(cur.policy, v.doc.policy) || "no changes"}.`));
    }
    // A written policy, read by the model into a proposal. Nothing is saved here: the console shows it as a review.
    if (M === "POST" && seg[0] === "policy" && seg[1] === "import") {
      const b = await readBody(req);
      const cur = currentDoc();
      const sc = !company ? app.demoScenario() : null;
      const sample = b.sample ? sc?.policyDocument : null;
      if (b.sample && !sample) return json(res, 404, { error: "This demo has no sample policy document." });
      const r = await readPolicyDocument(sample ? { fileName: sample.fileName, text: sample.text } : b, { people: cur.org.people, roles: cur.org.roles, current: cur.policy, sample: sample?.reading || null });
      const pv = preview({ people: cur.org.people, roles: cur.org.roles, policy: r.policy });
      return json(res, 200, { ...r, ...pv, fileName: sample?.fileName || b.fileName || null, documentSource: sample ? "sample" : "upload" });
    }
    if (M === "GET" && seg[0] === "sample-policy") {
      const sc = !company ? app.demoScenario() : null;
      return sc?.policyDocument ? json(res, 200, { fileName: sc.policyDocument.fileName, text: sc.policyDocument.text }) : json(res, 404, { error: "No sample policy." });
    }
    if (M === "GET" && seg[0] === "connections") return json(res, 200, { ...C.connections(store, { demo: !company, demoPolicyFile: !company ? app.demoScenario().policyDocument?.fileName : null }), admin: !company
      ? { state: "configured", label: "Open (demo)", detail: "In the demo, the admin dashboard is open to anyone with the link so the story can be followed live. The real company console requires the administrator password." }
      : { state: adminPassword ? "configured" : "missing", label: adminPassword ? "Password sign-in" : "No password set", detail: adminPassword ? `One shared administrator password (PLANNIE_ADMIN_PASSWORD); sessions last ${SESSION_HOURS} hours. Not single sign-on.` : "Set PLANNIE_ADMIN_PASSWORD to enable the console." } });
    if (M === "GET" && seg[0] === "activity") {
      const evs = new Map(store.listEvents().map((e) => [e.id, e.createdAt]));
      return json(res, 200, { entries: store.listAudit().map((e) => ({ ...e, eventLinked: !!e.eventId && evs.get(e.eventId) === e.eventCreatedAt })) });
    }
    return json(res, 404, { error: "not found" });
  }

  // ---------------------------------------------------------------- standalone demo API
  async function demoApi(req, res, url, p) {
    if (p === "/api/state") return json(res, 200, app.snapshot(url.searchParams.get("viewer")));
    if (req.method === "GET" && p === "/api/demo/review") {
      const snapshot = app.demoReview(Number(url.searchParams.get("step")));
      return snapshot ? json(res, 200, snapshot) : json(res, 404, { error: "This step is unavailable for review." });
    }
    // Local demo mail client. Seeded identities only; this is not identity verification.
    if (req.method === "POST" && p === "/api/mail/send") {
      const b = await readBody(req);
      if (!TRUSTED_LOCAL.has((b.from || "").toLowerCase()) || person(b.from)?.alias) return json(res, 400, { error: "The demo mail client can only send as people in the demo company." });
      if (!b.body?.trim() || !(b.to?.length)) return json(res, 400, { error: "Recipient and body are required." });
      if (b.fixtureKey != null && !Object.hasOwn(FIXTURE_INTERPRETATIONS, b.fixtureKey)) return json(res, 400, { error: "Unknown fixture." });
      const parent = b.inReplyTo ? store.getMessage(b.inReplyTo) : null;
      const r = await app.sendMail({ from: b.from, to: b.to, cc: b.cc || [], subject: b.subject || (parent ? `Re: ${parent.subject.replace(/^Re:\s*/i, "")}` : "(no subject)"), body: b.body,
        messageId: b.messageId || undefined, inReplyTo: parent?.messageId || null, references: parent ? [...(parent.references || []), parent.messageId] : [], identity: { verified: true, method: "local-demo-trusted" }, meta: b.fixtureKey ? { fixtureKey: b.fixtureKey } : {} });
      return json(res, 200, { ok: true, id: r.message.id, eventId: store.getMessage(r.message.id)?.eventId || null, duplicate: !!r.duplicate });
    }
    if (req.method === "POST" && p.startsWith("/api/manager/")) {
      const b = await readBody(req);
      const actor = managerIdentity(b.actor);
      if (!actor) return json(res, 403, { error: "Choose a manager identity from the demo company." });
      return json(res, 200, await app.manager(b.eventId, actor, p.split("/").pop(), b.args || {}, { expectedVersion: b.expectedVersion ?? null, requestId: b.requestId || null }));
    }
    if (req.method === "POST" && p === "/api/suppliers/tick") return json(res, 200, await app.supplierTick());
    // Reset restarts the current scenario from scratch (its company, requests and activity).
    if (req.method === "POST" && p === "/api/demo/reset") return json(res, 200, app.loadScenario(store.getMeta("demo:scenario") || "acme"));
    if (req.method === "POST" && p === "/api/demo/scenario") return json(res, 200, app.loadScenario(String((await readBody(req)).id || "")));
    if (req.method === "POST" && (p === "/api/demo/step" || p === "/api/demo/back")) {
      const result = p === "/api/demo/step" ? await app.demoStep() : await app.demoBack();
      const view = url.searchParams.get("view");
      if (view === "admin") return json(res, 200, { ...result, session: sessionView(ADMIN) });
      if (view === "story") return json(res, 200, { ...result, snapshot: app.snapshot() });
      return json(res, 200, result);
    }
    if (req.method === "POST" && p === "/api/demo/run") { let r; do { r = await app.demoStep(); } while (!r.done); return json(res, 200, r); }
    if (req.method === "GET" && p.startsWith("/api/approvals/")) {
      const id = p.split("/").pop();
      for (const ev of store.listEvents()) { const a = ev.approvals.find((x) => x.id === id); if (a) return json(res, 200, { eventId: ev.id, id: a.id, status: a.status, terms: a.terms, how: `Reply "Approve ${a.id}" from ${a.approver}` }); }
      return json(res, 404, { error: "not found" });
    }
    if (req.method === "POST" && p === "/api/chat") return json(res, 200, await chat(store, app, await readBody(req)));
    // The demo's own Company page (its fictional org chart), through the same versioned, audited save.
    if (req.method === "GET" && p === "/api/org") return json(res, 200, { ...C.orgView(), source: ORG.source, updatedAt: ORG.updatedAt, version: CONFIG.version, roleDefinitionImport: true, demoWarning: null });
    if (req.method === "GET" && p === "/api/org/template.csv") { res.writeHead(200, { "content-type": "text/csv", "content-disposition": 'attachment; filename="company-hierarchy.csv"', "cache-control": "no-store" }); return res.end(toCsv(ORG.people, ORG.roles)); }
    if (req.method === "POST" && p === "/api/org/preview") return json(res, 200, csvPreview((await readBody(req)).csv));
    if (req.method === "POST" && p === "/api/org/apply") {
      const b = await readBody(req);
      const r = readOrgCsv(b.csv, { currency: COMPANY.currency, roles: ORG.roles });
      if (r.errors.length) return json(res, 422, { error: "Fix the errors before applying.", errors: r.errors, warnings: r.warnings });
      return json(res, 200, save("demo-company-page", csvNext(r), b, "org.csv_imported", `Imported the demo org chart from CSV (${r.people.length} people).`));
    }
    if (req.method === "POST" && p === "/api/org/reset") {
      const b = await readBody(req);
      const sc = scenario(store.getMeta("demo:scenario") || "acme");
      return json(res, 200, save("demo-company-page", { people: sc.org.people, roles: sc.org.roles, policy: { ...sc.policy } }, b, "config.sample_restored", `Restored the demo company (${sc.company.name}).`, "sample"));
    }
    return json(res, 404, { error: "not found" });
  }

  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    try {
      if (company) {
        if (req.method === "POST" && p === "/api/inbound/postmark") {
          if (!basicAuthOk(req)) return json(res, 401, { error: "unauthorized" });
          const n = normalizePostmark(await readBody(req));
          if (![...n.to, ...n.cc].some(isPlannieAddress)) return json(res, 200, { ignored: "not addressed to ccPlannie" });
          const r = await app.sendMail({ ...n, direction: "human" });
          return json(res, 200, { ok: true, duplicate: !!r.duplicate });
        }
        if (p.startsWith("/api/admin/")) return await adminApi(req, res, url, p.split("/").slice(3));
        if (p.startsWith("/api/")) return json(res, 404, { error: "Not available on the company server.", code: "not_here" });
        if (req.method === "GET" && (p === "/" || p === "")) { res.writeHead(302, { location: "/admin" }); return res.end(); }
      } else {
        if (p.startsWith("/api/admin/")) return await adminApi(req, res, url, p.split("/").slice(3));
        if (p.startsWith("/api/")) return await demoApi(req, res, url, p);
        if (req.method === "GET" && (p === "/" || p === "") && home !== "/") { res.writeHead(302, { location: home }); return res.end(); }
      }
      if (req.method === "GET" && (await serveStatic(res, p))) return;
      json(res, 404, { error: "not found" });
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      json(res, e.status || 500, { error: e.message, ...(e instanceof ValidationError ? { errors: e.errors, warnings: e.warnings } : {}) });
    }
  };
}
