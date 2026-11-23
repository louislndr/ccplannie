# ccPlannie

**CC ccPlannie to organize an event with your event team. Keep deciding by email; ccPlannie turns the thread into a request, checks who may decide what, gets finance to approve exact terms, and hands the work to Planned.**

This is an **independent prototype** of a possible extension to Planned (planned.com). Planned connects to Slack, Teams and AI assistants (through its MCP connector) but not to email, where most event requests start. ccPlannie is that email front door. It has no access to Planned's systems: in the demos, Planned's answers are clearly labeled sample data.

## Run it

```bash
npm install
npm run demo              # build the web app, then start the demos
npm test                  # deterministic tests, no API key needed
```

The demo serves the story and its admin dashboard from one localhost origin.

| | URL | What it is |
|---|---|---|
| **The story** | http://localhost:3000/ | Pick a demo and play it step by step as emails. |
| **The admin dashboard** | http://localhost:3000/admin | The inside of the same demo, live: requests, people and roles, approvals, the Planned exchanges, the activity log. Open, no sign-in. |
| **How it connects** | http://localhost:3000/how-it-works | One page: what goes between ccPlannie and Planned, when, and who's in charge. |

### Host the demo on Vercel

1. Push the demo source to GitHub, including `api/` and `vercel.json`. Leave local `.env` files and `data/` out of Git.
2. Import the repo in Vercel. Use the repository root, keep the build settings from `vercel.json`, and select Node.js 24.x.
3. Connect an Upstash Redis database in Vercel’s Marketplace. Keep the REST URL and write token added by the integration (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, or the equivalent `UPSTASH_REDIS_REST_*` variables). Set `PLANNIE_INTERPRETER=fixture` for the demo.
4. Deploy. Open `/` to select a demo and `/admin` to see the matching dashboard in the same browser.

The hosted demo uses fictional data, local mail delivery, and a separate session per browser. Saved progress expires seven days after the last change. Keep the browser cookie to resume a session. The first hosted run starts with the sample company. The same source still runs locally with SQLite using `npm run demo`.

**Demos**

- **Demo #1 — Acme Robotics** (5 people). The core story: an assistant forwards a request, the plan takes shape over email, a stakeholder's suggestion is checked against who may decide, finance approves exact terms, the booking goes to Planned; then a date change shows the contract's fee.
- **Demo #2 — Northwind Labs** (23 people, custom roles), three storylines at once:
  - **C, escalating a big approval:** a 120-person kickoff is above the finance manager's limit, so it's never sent to her; the admin escalates to the controller; a spoofed approval is refused; the real one is bound to exact terms.
  - **D, org changes mid-request:** the events lead is away, so the admin reroutes to his backup; an engineer's suggestion changes nothing until she's promoted to a new "Team lead" role in the console, after which the same request counts.
  - **E, who may email ccPlannie:** an outside agency and an employee without request rights are held with no reply; a new hire is added in the console and their held email is processed.
- **Demo #3 — Juniper Works** (6 people). The Rules flowchart shows the venue reply deadline change from 24 to 8 hours. Follow that rule as it flags unanswered inquiries, see how a phone decision is recorded, and retry a failed approval email. Finance declines the first venue. The replacement gets a separate approval, a booking confirmation, and a downloadable record.

Switching demos or pressing **Reset** restarts that demo from scratch (its company, requests and activity). Scripted emails replay recorded readings so the story is identical every time; anything you type yourself is read by the configured model.

**Where Planned fits.** ccPlannie sends Planned the request once the event manager accepts it, asks for venue options, and sends only finance-approved, authorized terms to book. Planned sends back options, revised offers (with contract fees) and booking confirmations with a contract summary. Company roles and approvals are enforced in ccPlannie before anything is sent; nothing is ever booked from an email alone. Planned's connector tool names aren't public, so the connection itself is not built (see `src/planned.mjs`); in the demos the venue answers come from sample data (`src/supplier-sim.mjs`) and are listed on the dashboard's Planned page instead of as email.

**The real company console** (separate database, real email) runs with `npm run console` on http://localhost:3002/admin. Requires Node ≥ 22.13 (built-in `node:sqlite`).

### Setting up the company console

1. Set `PLANNIE_ADMIN_PASSWORD` (one shared administrator password; sign-in sessions last 12 hours). Without it the console stays locked.
2. Open http://localhost:3002/admin and sign in.
3. **People**: add at least one event manager and one finance approver (with a limit), then everyone who will email Plannie. Plannie recognizes people only by these exact addresses; mail from anyone else is held under *Intake review* with the reason and grants nothing. The first event manager and finance approver become the policy defaults (shown in the review); change them on **Policy**.
4. Real email (optional but needed to be useful), all on the console server. Put the values in a `.env` file (copy `.env.example`; it's git-ignored and loaded at start). Two providers:

**AgentMail (free, no domain, no Google; recommended).** Sign up at agentmail.to, create an API key, set `AGENTMAIL_API_KEY`. On start the console finds or creates the inbox `AGENTMAIL_INBOX` (default `plannie` → `plannie@agentmail.to`) and uses it as Plannie's address. It polls for new mail every `AGENTMAIL_POLL_SECONDS` (default 15; no public URL needed) and sends from the same inbox. AgentMail has no plus-addressing, so replies are matched to requests by their `In-Reply-To`/`References` headers (including the Message-IDs AgentMail assigns to Plannie's mail). Senders are verified from AgentMail's DKIM/DMARC results. Free plan: 3,000 emails/month, 100/day, with a small "Sent via AgentMail" footer. Provider order when several are set: Postmark → AgentMail → Gmail.

**Gmail (free, no domain, no public URL).** Create a dedicated Gmail account for Plannie, turn on 2-Step Verification, create an app password (Google Account → Security → App passwords), and set `GMAIL_USER` and `GMAIL_APP_PASSWORD`. The console checks the inbox over IMAP every `GMAIL_POLL_SECONDS` (default 20), sends over SMTP from the same account, and threads replies through plus-addresses (`plannie.you+e-1@gmail.com`). Plannie's address defaults to `GMAIL_USER`. Senders count as verified only when Gmail's own `Authentication-Results` header shows DKIM aligned with (or DMARC passing for) the From domain; email approvals also need the one-time code. Mail already in the inbox when Plannie is first connected is skipped. About 500 outgoing emails a day (Gmail's limit).

**Postmark (needs a domain you own):**

| Variable | Purpose |
|---|---|
| `PLANNIE_INBOUND_ADDRESS` | Plannie's address people email or CC, e.g. your Postmark inbound address `abc123@inbound.postmarkapp.com`. Per-request replies use plus-addressing (`abc123+e-1@…`, Postmark's MailboxHash). |
| `PLANNIE_FROM_ADDRESS` | The From address for Plannie's mail (needs a confirmed Postmark Sender Signature). |
| `POSTMARK_SERVER_TOKEN` | Enables sending through the Postmark Email API (`POST https://api.postmarkapp.com/email`). Without it, mail stays in the outbox and Connections says so. |
| `POSTMARK_WEBHOOK_USER` / `POSTMARK_WEBHOOK_PASS` | Basic-auth credentials for the inbound webhook `https://USER:PASS@<your-host>/api/inbound/postmark` (Postmark's recommended protection; it has no webhook signing). The webhook is disabled without them. |
| `PLANNIE_ALLOWLIST` | Optional. By default real mail goes **only to people in the company directory**; anyone else on a thread is skipped and the request shows it. Set this to restrict further. |
| `GOOGLE_CLOUD_PROJECT` (+ `GOOGLE_CLOUD_LOCATION`, default `global`) or `GEMINI_API_KEY` | Use **Gemini** to interpret email: through Vertex AI (billed to the project, auth `gcloud auth application-default login`) or a Google AI Studio key. Model: `PLANNIE_GEMINI_MODEL` (default `gemini-3.8-flash`). `PLANNIE_LLM` (`gemini-vertex` \| `gemini-key` \| `claude-vertex` \| `claude-api`) forces one provider; otherwise the first configured is used. All providers go through `src/llm.mjs`. |
| `ANTHROPIC_VERTEX_PROJECT_ID` (+ optional `CLOUD_ML_REGION`, default `global`) | Use Claude through Google Cloud Vertex AI instead of an API key (auth: `gcloud auth application-default login`; the project needs billing and Claude enabled in Model Garden). Takes precedence over `ANTHROPIC_API_KEY`. |
| `ANTHROPIC_API_KEY` | Lets Plannie interpret incoming emails. Without it, every email is recorded and flagged for a manager to review; nothing is applied automatically. |
| `PLANNIE_MODE`, `PLANNIE_DB`, `PORT` | Select the mode, SQLite file, and listening port. In demo mode, an optional `CONSOLE_PORT` redirects old local bookmarks to `PORT`. |

Expose the console server publicly for Postmark's webhook (e.g. `cloudflared tunnel --url http://localhost:3001`). Venues remain the labeled local simulator; the console answers their simulated replies in the background.

## What you see

**Concept for Planned** opens on an Apple Mail-style preview of a fictional Acme offsite.

- **Start demo** opens the first email. **Next step** advances the story through sourcing, approval, booking, and a date change. **Replay** resets the story after the last step.
- **Company** opens the demo company's org chart and role permissions (CSV upload, validation, restore). It belongs to the demo only.

## Demo script (23 steps)

**Part A: request to confirmed arrangement**
1. Dana emails Sam about a 30-person offsite, CAD 50,000. *Plannie isn't on it and never sees it.*
2. Sam forwards it to `plannie@plannie.example` (Cc Dana, Leo). Plannie opens **E-1**, routes it to Alex (not yet accepted), shows what it captured, labels the budget as a request rather than an approval, and asks the **one** blocking question: the date ("mid-September" isn't a date).
3. Dana replies "Thursday, September 16, 2027." It's applied quietly, with no reply.
4. *Alex (dashboard)* accepts ownership. 5. *Alex* requests quotes from three venues: **separate supplier threads**, no budget disclosed.
6. *Simulated venues* reply. Plannie emails the requesters a comparison with stable ids (P-1..P-3).
7. Leo: "Could we make it 45?" This is recorded as **suggestion S-1, not applied**. Plannie shows the consequences (two venues max out at 40/36, all quotes are for 30) and asks Dana.
8. Dana: "Yes — let's plan for 45." The working plan becomes 45 and the quotes go stale. Plannie (delegated inquiry) asks the one venue that fits for a **revised, non-binding** offer.
9. Maple Ridge returns a real fixture offer of **CAD 53,000 for 45** (not interpolated).
10. Dana: "Let's go with Maple Ridge." **Selection ≠ approval**: Priya gets **R-1** with the exact terms on a separate finance thread.
11. Priya: "Approve R-1. Raise the cap to CAD 55,000." Status becomes "approved internally, not booked".
12. *Alex* authorizes the booking request. Status: supplier confirmation pending.
13. *Maple Ridge* confirms booking MR-88412. **Only this creates the commitment.** A synthetic contract arrives, and §9.2 (CAD 3,500 date-change fee if moved more than 30 days before arrival) is extracted as *unreviewed*.
14. *Alex* verifies §9.2 against the source excerpt. 15. Sam: "Great, thank you!" Plannie sends no reply.

**Part B: a later change with consequences**
16. Sam: "Would September 19 work instead?" This is a **scenario only**: the verified CAD 3,500 fee applies, availability for the 19th is **unknown**, and a *conditional* note says that if the rate stayed the same the total would be CAD 56,500, over the cap.
17. Dana: "Yes, let's try to move it to the 19th." Working plan = Sep 19, while the approved plan and the booking stay on Sep 16. Plannie sends an availability inquiry that accepts no change.
18. Maple Ridge: Sep 19 available, **CAD 56,500 all-in incl. the fee** (+3,500 vs booking, 1,500 over the cap).
19. Dana: "Looks good." This is recorded as her choice and **does not count as an approval**; Priya gets **R-2**.
20. Priya: "Approved R-2. Revise the cap to CAD 60,000."
21. *Alex* authorizes the amendment. The booking stays on Sep 16 until the venue confirms.
22. *Maple Ridge* confirms. Working plan, approved terms and commitment now align, and the requesters are told.
23. Dana: "Where are we on the offsite?" She gets a grounded status that says what Plannie can't know.

History shows who requested, approved, executed and confirmed each material change.

## How it works

```
email ──► ingest (dedupe by Message-ID, ignore auto-replies/own mail, route by event address or reply headers only)
            │
            ├─ interpret: proposes intents only (Claude structured output, or labeled fixture replay)
            ├─ domain rules (plain code): authority, four state kinds, impacts, approvals, supplier rules
            └─ compose: batched replies per audience → durable outbox → local mailbox or Postmark
```

| File | Role |
|---|---|
| `src/config.mjs` | Fictional company, sample people and **sample policy** (not Planned's); the live runtime view of the saved configuration. |
| `src/company.mjs` | Versioned company configuration and audit log: load/migrate, shared validation, review diff with affected requests, the one atomic save path. |
| `src/console.mjs` | Console read models: inbox summaries and filters, request detail, permitted actions, handoff export, connection status. |
| `src/server-app.mjs` | HTTP API and access guard (also used by tests). `server.mjs` starts it. |
| `src/planned.mjs` | The Planned integration boundary. Not connected; fails closed. |
| `src/domain.mjs` | Event model and every rule involving money, permissions or commitments. No AI. |
| `src/interpret.mjs` | Claude interpretation with a zod schema (`claude-opus-5-5`), fixture mode, and contract-rule extraction (always unreviewed until verified). |
| `src/app.mjs` | Pipeline: routing, applying intents, replies, outbox, manager operations, supplier simulator loop, demo runner. |
| `src/db.mjs` | SQLite persistence: versioned event documents (optimistic concurrency), messages, threads, outbox, idempotency keys. |
| `src/transport.mjs` | Local outbox transport, Postmark outbound (allowlist only), Postmark inbound normalization. |
| `src/supplier-sim.mjs` | **Local supplier simulator**: fictional venues, explicit inventory/prices/terms, replies only by email. |
| `src/chat.mjs` | Ask Plannie: read-only answers from the event record. |
| `web/` | React and Tailwind UI: the email demo (`App.tsx`, `StoryView.tsx`) and the company console (`web/src/console/`). |

### Four kinds of information (one canonical event record)
- **Suggestions**: questions and ideas (S-n). Never applied on their own.
- **Working plan**: the authorized organizer's current intent, with per-field provenance.
- **Approved plan**: versioned, bound to an approval's exact terms hash (event, supplier, offer, date/timezone, headcount, rooms, nights, currency, amount, conditions, action) and the cap.
- **Supplier commitment**: only what a supplier confirmed (booking ref, terms, amount, contract).

Differences between them show up in the dashboard and in Plannie's emails ("working 45, approved 30, booked 30" is a legitimate state).

### Company console (`/admin`)

The console answers one question: *can an employee stay in email while the right company people get actionable work, with permissions and approvals enforced?* It runs on its own server and database (`PLANNIE_MODE=company`), receives mail through the Postmark webhook, and every action goes through the same domain rules (`src/domain.mjs`) as the email pipeline. Nothing in it is a frontend-only example, and none of the demo's data appears in it.

| Route | What it does |
|---|---|
| `/admin/requests` | **Operational inbox** (default). Every persisted request, including unaccepted and paused ones: requester, received time, routed manager or owner, stage, date and headcount, requested budget vs approved spending vs confirmed supplier amount, and one next action. Search (event, person, email, reference such as `E-2`, `R-1`, `MR-88412`) and filters (needs manager, waiting on requester / finance / supplier, confirmed, paused, needs review) are derived from the event record; a request can sit in several. **Intake review** lists inbound mail Plannie recorded but didn't attach (unknown sender, unmatched supplier, ambiguous thread) with the real reason. |
| `/admin/requests/:id` | Original request, working plan / approved terms / supplier commitment side by side, pending approvals and who they're assigned to, approval blockers, review flags, stale quotes, unknown pricing or availability, undelivered mail (with **Retry delivery**), conversations, history linked to source emails, and the actions the chosen manager may take now. **Acting for** names the manager the administrator is acting for; the server re-checks that person's live powers and the event version on every action, and history records it as done *via admin console*. Administrators can **route or reassign** the request and **assign a blocked approval** to an eligible approver. **Download local handoff (JSON)** exports the request. |
| `/admin/people` | Starts empty. CSV import (validate → review → apply) and in-browser editing: add, edit name/title, roles, reporting manager, finance limit, backup contact, remove. Each person shows their exact email and effective permissions in plain language. Changing an email is shown as an explicit identity change. A review lists added/removed people, role and limit changes, and affected active requests before anything is saved. Also: reporting lines, role definitions and the permissions matrix, CSV download. |
| `/admin/policy` | The company policy (below), each setting explained with a concrete example, reviewed before an explicit save. |
| `/admin/connections` | What is really configured, as reported by the server (no secret values): Postmark sending and webhook, Plannie's addresses, interpretation, console sign-in, company configuration, and Planned (**not connected**). |
| `/admin/activity` | Application activity/audit log for configuration and routing changes (see below). |

**Roles stay fixed in code** (`src/org.mjs`): `sponsor`, `requester`, `finance`, `event_manager`, `stakeholder`. Administrators decide who holds them; they can't invent new powers. The console states the distinctions that matter: choosing an option isn't approving spending; approving spending isn't authorizing a booking; a VP title, a reporting line or being CC'd grants nothing. A **backup contact** is a person to reach, not a delegate: Plannie never moves an approval or a request to a backup automatically.

**One validator** (`readOrgPeople` / `readOrgCsv` → `validatePeople`, plus `validatePolicy`) serves CSV imports and web edits. It rejects invalid or duplicate emails, unknown roles, reporting cycles, missing manager or backup references, removing the last event manager or finance approver, policy defaults that point at someone without the matching role, and approval limits that are negative, zero, malformed or non-finite. Limits are parsed strictly (`75000`, `75,000`, `CAD 75,000`); a value like `-5000` or `5k` is an error, never silently turned into another amount (the previous parser stripped the minus sign).

**Changes to people take effect immediately and never rewrite history.** Revoked powers stop the next protected action (e.g. a manager whose role is removed can't pause, authorize or request quotes). Past approvals, selections and supplier commitments stay as evidence. If a pending approval's assigned approver loses authority or is removed, or the amount is above their limit, the approval shows a **blocker** and no approval email goes out; an administrator must explicitly assign an eligible approver (a new approval code is issued). Approval by email must come from the assigned approver. Server-side mailbox aliases (`data/people.json`) still work and can't be created from the console.

### Company policy (`/admin/policy`)

Stored as one validated, versioned configuration in SQLite (`company_config`), applied before any mail is processed or queued work is flushed on start-up, and kept across restarts and demo resets. An older database with an uploaded org chart is migrated automatically.

| Setting | Behavior |
|---|---|
| Policy name | Label shown in the console and recorded with changes. |
| Default request-routing event manager | New requests are routed to this person as *not yet accepted*. Routing authorizes nothing: they must accept ownership before contacting suppliers or authorizing anything. Changing it affects **new** requests only; existing requests stay with their owner until an administrator reassigns them. |
| Default finance approver | New spending approvals are assigned here (their limit is shown). An amount above their limit becomes a visible blocker that needs an eligible approver; the limit is never raised and the approval never moves silently. |
| Automatic non-binding follow-up inquiries | On: after the plan changes on an owned request, Plannie asks the venues that fit for a revised, non-binding quote. Off: Plannie only marks quotes stale and says it hasn't contacted anyone; the owning manager can still **Request revised quotes** manually. |
| Supplier response timeout | 1–720 whole hours. Unanswered supplier requests older than this are shown as overdue; nothing else changes. |
| Planned workspace reference | Connections page. A note only; it never changes the Planned status. |

Fixed guardrails, not settings: finance approval of exact terms within the approver's limit; explicit authorization by the owning manager for bookings and amendments; nothing is booked until the supplier confirms. Every consequential history entry records the configuration version that governed it (`configVersion`), and so do routing, approvals and supplier requests.

### Company activity and access

`company_audit` records organization imports and edits, role changes, approval-limit changes, policy changes, request routing/reassignment, approval reassignment and intake reprocessing: unique id (`ACT-00001`…), timestamp, actor, action, affected entity, before/after values and the configuration version. Each row is written in the **same transaction** as the change; a rejected, invalid or stale change writes nothing. Request rows link to the request's own history (which stays separate). No secrets, approval codes or message bodies are logged. This is an application activity log, not a tamper-proof compliance record.

**Access.** The console requires an administrator session: one shared password (`PLANNIE_ADMIN_PASSWORD`), compared in constant time; a random session token in an `HttpOnly; SameSite=Strict` cookie (`Secure` behind HTTPS), stored server-side only as a SHA-256 hash, valid 12 hours; sign-in rate-limited (10 failures per 15 minutes); writes must be same-origin JSON. Every `/api/admin` route checks the session; there is no other way in. Admin actions are attributed to the session, never to a client-supplied actor. **Acting for** a manager is recorded as that manager *via admin console*; it is not that manager's own login (per-person sign-in isn't implemented). This is a single-administrator setup, not SSO. On the console server the demo's endpoints (`/api/state`, the demo mail client, demo controls, the demo's org page) don't exist; on the demo server there is no console API and no webhook.

### Planned integration (not connected)

There are no verified Planned API credentials, tools or endpoints in this project, so **nothing syncs to Planned** and the Connections page says so. The console never asks for browser cookies or private sessions, and saving a workspace reference doesn't change the status. Advertised MCP support isn't treated as proof that any particular tool exists. (Planned's Plannie is unrelated to the household organizer at plannie.io.)

What you can do today is **Download handoff (JSON)** on a request: schema `ccplannie.handoff/v1`, event version, working plan with per-field provenance, approved terms (with terms hash), the supplier commitment, approvals, contract rules and full history with RFC Message-IDs. It is labeled as an export, marks simulated suppliers, lists `syncedTo: []`, and excludes approval codes and secrets.

Future operations go through one small boundary, `src/planned.mjs`, which fails closed today. A real integration would need: the specific supported tools/endpoints; a company-authorized server-side credential; company/workspace scope confirmed by a read; a capability mapping in which **Planned's own authority and approval system wins** over this demo's local policy; idempotency keys per operation; stored external identifiers; and reconciliation that reads Planned's state back and flags differences for a person.

### CSV format
`name,email,title,manager_email,roles,approval_limit,backup_email` (roles separated by `;`), plus optional role-definition rows `role_id,role_label,role_description` to rename roles in your company's terms. The role ID always decides the permissions.

### Role policy (sample)
| Person | Can |
|---|---|
| Dana Ruiz, VP (sponsor) | request · provide details · **change scope** · **select options** |
| Sam Lee, EA | request · provide details · suggest |
| Alex Moreau, event manager | own events · supplier inquiries · **authorize bookings/amendments** · verify contract rules · record manual decisions |
| Priya Shah, finance | **approve exact spending terms** (≤ CAD 100,000) · revise the cap |
| Leo Park, stakeholder | suggest only |

Authority never comes from titles, signatures, model output or CC. Email approvals need the exact approval id (or a reply to that specific request), a verified sender, current terms, and a cap that covers the amount. "Yes" never approves everything.

## Interview demo script

1. **The story (demo, port 3000).** Click **Start** and step through. Sam only CC'd Plannie; Leo's "make it 45" stays a suggestion; Dana's choice isn't an approval; Priya approves exact terms; Alex authorizes; only the venue's confirmation books it.
2. **The real thing (console, port 3001).** Sign in. It's empty: show that an email to Plannie from someone not on the People page is held under *Intake review* and creates nothing.
3. **Set up the company.** On People, add an event manager, a finance approver with a limit, and a sponsor. The review shows the new routing defaults. Save, open **Activity** for the before/after entries, then **Reprocess** the held email: it becomes a request routed to the manager, *not accepted*.
4. **Ownership and actions.** Open the request, **Accept ownership** for the manager. History says "via admin console". Unavailable actions list their reason (e.g. "Finance hasn't approved these exact terms").
5. **Policy changes behavior.** Turn off automatic follow-up inquiries, or lower the finance approver's limit below an amount: the next scope change says "I haven't contacted any venue"; an over-limit approval shows a blocker and is never sent to someone who can't approve it.
6. **Honesty.** **Connections** shows exactly what's configured (Postmark, webhook, model, sign-in) and Planned as not connected; **Download handoff** produces a labeled export.

## Live email

Configured on the console server; see "Setting up the company console" above. The demo never sends mail.

**Identity with Postmark:** a sender counts as verified only when Postmark's `X-Spam-Tests` header includes `DKIM_VALID_AU` (DKIM valid and aligned with the From domain), and email approvals additionally need the one-time code from the approval request. This depends on Postmark's documented spam headers. **It's implemented and unit-tested with synthetic payloads, but not verified end to end against a live Postmark account.**

## Assumed Planned interface (unverified)
The prototype calls these operations on its own local implementation. A real integration would need Planned equivalents; none are known or claimed:
create draft event / route to manager · accept ownership · read & update working plan · request supplier quotes (non-binding) · receive offers · request/record finance approval of exact terms · authorize booking/amendment · receive supplier confirmations & contracts · append history with provenance.
Swapping a URL wouldn't make this a working Planned integration, and nothing here is an MCP connection.

## Simulated or out of scope
- Venues, prices, availability, contracts and confirmations come from the **local simulator** (fictional, labeled). No real payments, bookings or contract execution.
- Supplier emails are parsed from the simulator's structured block. Free-text emails from real suppliers aren't interpreted automatically; they're flagged for the manager.
- No Gmail/Outlook add-in, company-wide mailbox access, Slack integration or autonomous negotiation.
- Plannie only knows what it's copied on. Calls and off-thread decisions enter through "Record an off-email decision" (with provenance).

## Verification (as run)

Run `npm run test:properties` for the fast-check suite.
- `npm test`: **70/70 passing** (incl. editable roles and the Gmail adapter; earlier: 47): the original 27, plus 20 in `tests/console.test.mjs` (shared validation, strict limits, cycles, atomic and stale-safe saves, persistence and migration, routing defaults, revocation, historical evidence, over-limit and removed approvers, delegated vs manual inquiries, sign-in/session/rate-limit/origin checks, demo/console separation, an empty company's first setup, the Postmark request shape and directory allowlist with a mocked API, audit only on success, isolation, idempotent retries, honest exports).
- `npm run replay`: the full story completes with plan, approval and booking aligned (Sep 19, 45 people, CAD 56,500, cap CAD 60,000).
- Browser (Chrome via Playwright), both servers on separate databases: the demo's 23 steps through its own buttons; demo `/admin` shows where the console lives; console sign-in (wrong and right password), empty state, held email before setup, adding three people through the UI and saving, reprocessing, a request through the real webhook endpoint with basic auth, accepting it, Connections, sign-out. Earlier pass: search/filters, URLs/refresh/back-forward, error and empty states, phone and dark layouts. No console errors.
- **Not verified:** a live Postmark account (no token available here; the API call shape is unit-tested against Postmark's documented fields), and `npm run smoke:model` (no API key).
