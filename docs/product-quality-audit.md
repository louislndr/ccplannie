# Product-quality audit — ccPlannie

Scope: the demo website (story site + explainer + admin dashboard) and the backend code that produces what those pages show. Date: 2026-11-22.

## 1. What this product is

- **What:** an independent prototype of an email front door for Planned (planned.com). People email or CC ccPlannie; it turns threads into event requests, enforces company roles (request / decide / approve spending / run events), gets finance approval of exact terms, and hands the work to Planned.
- **Status:** a local demo/prototype. Not deployed, no customers. Planned is **not connected**: in the demos its answers (venue options, offers, booking confirmations) are sample data. A separate "company console" mode with real email (AgentMail/Gmail/Postmark adapters) exists in code but is not running and is not part of this audit's rendered review.
- **Audience:** Planned's team reviewing the demo; in the product, executive assistants, event managers, finance approvers and company admins.
- **Brand voice (intended, from CLAUDE.md "Apple bar"):** terse, plain, specific; system font, neutral grays with one blue accent, hairlines, 8-pt spacing, thin icons.
- **Stack:** Node ≥ 22.13 ESM backend (`server.mjs`, `src/*.mjs`, built-in `node:sqlite`); React 19 + Tailwind 4 + Vite web app (`web/src`), built to `web/dist`. One demo process serves the story on `PORT` (3000) and the dashboard on `PORT+1` (3001). Checks available: `npm test` (node:test), `npm run build:web` (Vite). No linter, formatter or TypeScript checker is installed — the Vite build does not type-check.
- **Git:** no commits; every file is untracked user work. A pre-audit snapshot of the source was taken for before/after comparison.

### Visual direction (established patterns to keep)

The story site is a "concept" surface: a soft teal-to-sand gradient backdrop, a glossy ccPlannie mark, an Apple-Mail-like window (sidebar, message list, reading pane) and a white floating control bar with dark pill buttons. The admin dashboard is a quieter work surface: a light sidebar, 13px system type, hairline dividers instead of boxes, status shown as a colored dot plus text, one blue accent for links and primary actions. The two surfaces are meant to differ (presentation vs. tool); consistency matters *within* each and in shared vocabulary.

## 2. Coverage inventory

| Area | Routes / states | Viewports | Status |
|---|---|---|---|
| Story site | `/` picker, Demo #1 all 23 steps, Demo #2 all 27 steps, Steps outline, Back/review, Reset, demo switch, Company page, mock mail compose | 320 / 375 / 768 / 1440 | see findings |
| Explainer | `/how-it-works` | 320 / 375 / 768 / 1440 | see findings |
| Dashboard | `/admin/requests` (filters, search, held emails), `/admin/requests/:id` (overview, conversations, history, actions, Planned, export), `/admin/people` (edit, roles, CSV, review/save), `/admin/policy`, `/admin/planned`, `/admin/connections`, `/admin/activity`, unknown `/admin/*` | 320 / 375 / 768 / 1440 | see findings |
| Not found | unknown story-site paths | desktop | see findings |
| Company console (real mode, password) | sign-in, locked states | — | **source only, not rendered** |
| Backend | demo runner, scenarios, wording in `src/domain.mjs` / `src/app.mjs`, read models `src/console.mjs`, HTTP `src/server-app.mjs` | — | source + tests |

(Updated after implementation — see §6.)

## 3. Findings

_Filled in from the initial critic audit and my own review._

## 4. Claims ledger

_Filled in below._

## 5. Unresolved business decisions

_Filled in below._

## 6. Verification

_Filled in after implementation._
