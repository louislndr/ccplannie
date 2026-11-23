// Demo mode serves the story and its admin console on one origin.
// Company mode uses a separate process and database.
import "./src/env.mjs"; // must stay first: loads .env before config reads it
import http from "node:http";
import { openDb } from "./src/db.mjs";
import { createApp } from "./src/app.mjs";
import { createServer } from "./src/server-app.mjs";
import { localTransport, postmarkTransport } from "./src/transport.mjs";
import { PLANNIE, CONFIG } from "./src/config.mjs";
import { gmailConfigured, gmailTransport, startGmailPoller } from "./src/gmail.mjs";
import { agentmailConfigured, agentmailTransport, ensureInbox, makeClient, startAgentmailPoller } from "./src/agentmail.mjs";

const mode = process.env.PLANNIE_MODE === "company" ? "company" : "demo";
const company = mode === "company";
const store = openDb(process.env.PLANNIE_DB || (company ? "data/company.sqlite" : "data/ccplannie.sqlite"));
// The demo never sends real mail. The company console uses the first configured provider:
// Postmark (own domain) → AgentMail (plannie@agentmail.to) → Gmail → local outbox only.
const provider = !company ? "local" : process.env.POSTMARK_SERVER_TOKEN ? "postmark" : agentmailConfigured() ? "agentmail" : gmailConfigured() ? "gmail" : "local";
let agentmail = null;
if (provider === "agentmail") {
  // Plannie's address comes from the AgentMail inbox, so resolve it before any mail is processed.
  const client = makeClient();
  try { agentmail = { client, inbox: await ensureInbox(client) }; }
  catch (e) { console.error(`AgentMail: couldn't open Plannie's inbox: ${e.body?.message || e.message}`); process.exit(1); }
}
const transport = provider === "postmark" ? postmarkTransport() : provider === "agentmail" ? agentmailTransport({ client: agentmail.client, inboxId: agentmail.inbox.inboxId }) : provider === "gmail" ? gmailTransport() : localTransport();
// createApp loads the saved company configuration first (a new company starts empty, the demo with its
// fictional cast), so roles and policy are in force before any mail is processed or queued work is flushed.
const app = createApp({ store, transport, initialConfig: company ? "empty" : "sample" });
if (company) store.setMeta("clock", null); // real clock, always
else if (!store.getMeta("demo:scenario")) app.loadScenario("acme"); // a fresh demo starts on demo #1
await app.flush(); // resume outgoing work queued before a restart
if (!company) await app.backfillDemoReviews().catch((error) => console.error("demo review:", error.message));
// Company mode: simulated venues answer Plannie's supplier emails in the background (they're labeled as simulated).
// With Gmail, the server reads Plannie's inbox itself (no webhook or public URL needed).
if (provider === "gmail") startGmailPoller({ app, store });
if (provider === "agentmail") startAgentmailPoller({ app, store, client: agentmail.client, inboxId: agentmail.inbox.inboxId });
if (company) setInterval(() => app.supplierTick().catch((e) => console.error("supplier simulator:", e.message)), 15000).unref();

const log = () => console.log(`  db: ${store.path} · transport: ${transport.name} · interpreter: ${process.env.PLANNIE_INTERPRETER || "auto"} · company config v${CONFIG.version} (${CONFIG.source})${company ? ` · intake: ${PLANNIE.intake} · admin login: ${process.env.PLANNIE_ADMIN_PASSWORD ? "configured" : "NOT CONFIGURED (set PLANNIE_ADMIN_PASSWORD)"}` : ""}`);
if (company) {
  const port = Number(process.env.PORT || 3002);
  createServer({ store, app, transport, mode }).listen(port, () => { console.log(`ccPlannie company console on http://localhost:${port}/admin`); log(); });
} else {
  const port = Number(process.env.PORT || 3000);
  createServer({ store, app, transport, mode }).listen(port, () => {
    console.log(`ccPlannie demo on http://localhost:${port}/ · admin dashboard on http://localhost:${port}/admin`); log();
  });
  // Optional redirect for local bookmarks that still use the former second port.
  const legacyPort = Number(process.env.CONSOLE_PORT);
  if (legacyPort && legacyPort !== port) http.createServer((req, res) => {
    const path = new URL(req.url, "http://localhost");
    res.writeHead(307, { location: `http://localhost:${port}${path.pathname}${path.search}` }).end();
  }).listen(legacyPort, "localhost");
}
