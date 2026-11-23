# Development

## Requirements

- **Node.js 22.13 or later.** The server uses `node:sqlite`, which needs 22.13+. I develop and deploy on
  Node 24 (`.nvmrc`).
- **npm 11.** Both lockfiles install cleanly with `npm ci` on npm 11.6 and 11.19.
- Google Chrome, only for `scripts/capture-media.mjs`.

## Install, build, run

```bash
npm ci            # server dependencies
npm run demo      # clean frontend install (npm ci in web/), Vite build, then the demo server
```

The demo runs at [localhost:3000](http://localhost:3000) with its console at
[localhost:3000/admin](http://localhost:3000/admin). It uses its own database (`data/ccplannie.sqlite`,
git-ignored), recorded interpretations, a local outbox and simulated venues. It needs no API keys and sends no
email.

`npm run build:web` runs the same frontend install and build as the Vercel build (`npm ci --prefix web
--include=dev` then `vite build`), so a local build can't hide a broken lockfile.

## Verify

```bash
npm test                          # 80+ tests: scenarios, authority and approvals, console, mail adapters, hosted sessions, properties
npm run replay -- acme            # replays a scenario in the terminal; also: northwind, juniper
node scripts/capture-media.mjs    # regenerates docs/media/ from the real Acme demo (needs a built frontend and Chrome)
```

## Runtime modes

| Mode | Command | Data | Email | Venues / Planned |
| --- | --- | --- | --- | --- |
| Demo | `npm run demo` | `data/ccplannie.sqlite`, fictional scenarios, demo clock | Local outbox only | Simulated (`src/supplier-sim.mjs`) |
| Hosted demo | Vercel (`vercel.json`, `api/hosted-demo.js`) | One session per browser in Upstash Redis, expires 7 days after the last change | Local outbox only | Simulated |
| Company console | `npm run console` → [localhost:3002/admin](http://localhost:3002/admin) | `data/company.sqlite`, starts empty | AgentMail, Gmail or Postmark if configured in `.env`, otherwise the local outbox | Still simulated |

The company console requires `PLANNIE_ADMIN_PASSWORD`. Copy [`.env.example`](../.env.example) to `.env` for
sign-in, mail and model settings. The mail adapters are covered by mocked tests; I haven't verified a live round
trip for each provider as part of this repository. Company mode is a working console for a real directory, not a
production deployment.

### Hosted demo on Vercel

Import the repository root with Node.js 24.x and connect Upstash Redis. The API reads `KV_REST_API_URL` and
`KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Set
`PLANNIE_INTERPRETER=fixture` so the hosted demo never calls a model.

### Model interpretation

Scripted demo emails always replay their recorded reading, with or without a model. For other email (company
mode, or ad-hoc email in the demo), `src/llm.mjs` uses whichever is configured: Gemini (Vertex or an AI Studio
key) or Claude (Vertex or API). Without a model, unscripted email is held for a person to review.
`PLANNIE_INTERPRETER=fixture` forces recorded readings only. The Rules page's "Upload a policy" uses the same
model; in the demo, "Try the sample policy" falls back to a recorded reading if no model answers within 90 s.

## Architecture

```
email ──► interpret.mjs ──► proposed intents ──► domain.mjs ──► event document ──► db.mjs (SQLite / hosted session)
          (model or recorded     (never authority)   (who may do what,                 │
           reading)                                   exact approvals,                  ├─► outbox ──► transport.mjs (outbox, AgentMail, Gmail, Postmark)
                                                      working / approved /              ├─► server-app.mjs ──► web/ (story site + console)
                                                      committed terms)                  └─► planned.mjs (unconnected boundary) ◄─► supplier-sim.mjs
```

- `src/interpret.mjs` turns an email into **proposed** intents. It never grants authority, picks recipients or
  books anything.
- `src/domain.mjs` is the one place that decides. It checks the sender's live permissions (`src/org.mjs`,
  `src/company.mjs`), keeps the working plan, the finance-approved terms and the supplier commitment as separate
  records, and binds each approval to a hash of exact terms.
- `src/app.mjs` orchestrates: intake, threading, composing replies, the supplier exchange, the demo steps.
- `src/company.mjs` validates and versions the company configuration (people, roles, rules) with an audit log.
- `src/console.mjs` derives the console's read models (inbox, request detail, connections).
- `src/planned.mjs` is the integration boundary. It is **not connected**: the workspace reference on the
  Connections page is a note, and the request's "Download the full record" is a JSON export, not a sync.

The demo scenarios live in `src/scenarios/` (Acme in `index.mjs`, which reuses the original story in
`src/demo.mjs`; Northwind; Juniper; sample policy documents in `policy-docs.mjs`).

## What a Planned integration would need

None of this exists in the repository, and I haven't invented endpoint or tool names:

- Planned's supported authentication and a workspace-scoped authorization granted by the company's Planned
  administrator.
- A mapping from ccPlannie's operations (open an event, request options, book exact approved terms, request a
  change) to Planned's supported actions, with Planned's identifiers stored next to ccPlannie's.
- Idempotency keys per operation, and periodic read-back to reconcile status and spend.
- A decision on whose approval rules win. Planned already runs approvals and budget thresholds; ccPlannie's
  local roles and limits would have to defer to, or sync with, Planned's controls rather than run in parallel.

## Maintainability notes

`src/app.mjs` (about 1,000 lines) and `src/domain.mjs` (about 660) are the largest files. They're long because
they hold one orchestrator and one domain model, not because of duplication, so I haven't split them.
