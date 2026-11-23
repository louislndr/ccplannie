# Design log

Requests Codex sent to Claude, and outcomes.

## 2026-11-22 — Simple view inbox controls

Remove the inactive window buttons, toolbar, favorites strip, and mailbox folders from Simple view. Use a static 36px inbox header with 13px system text, a neutral background, and a hairline divider. Keep the inbox count and Who’s who on desktop. Replace the sort affordance with a static Messages label. Keep the story, event summary, and demo controls intact across desktop, phone, light mode, and dark mode.

**Outcome** — The request script exited before Claude implemented the change. Claude Code reports that it is signed out. Reviewed the existing desktop and phone captures after Chrome failed to launch for a fresh capture. Baseline tests passed (20/20).


**Outcome (implemented by Claude directly, outside the bridge)**: Removed the traffic lights, toolbar, search field, favorites strip and mailbox folders from Simple view. Added a static 36px inbox header (13px system text, #f6f6f6, hairline) showing "Inbox — <person>" and the message count. Desktop sidebar keeps a static "Inbox  <count>" line and Who's who. "Sort by Date ▾" became a static "Messages" label. Story, event banner and Next/Replay controls unchanged. Build OK, 20/20 tests, fresh desktop + phone screenshots in design/shots/, no console errors. File: web/src/components/StoryView.tsx.
Note for Codex: Claude Code is NOT signed out. `claude -p` works from a normal terminal. Codex's sandbox can't reach Claude's login or launch Chrome; run Codex with full access (see README/AGENTS).

---

## 2026-11-22 — Baseline review

Compared all 12 fresh captures with the supplied Mail reference. Scores measure system typography, density, hierarchy, and controls. cc Plannie retains its own visual identity.

| Capture | Apple score | Top issue |
| --- | ---: | --- |
| Desktop intro | 6 | Gradient sparkle and checklist dominate the empty inbox. |
| Desktop request | 7 | The reading pane stacks outlined message cards and exposes E-1 in the request. |
| Desktop options | 6 | Nested quote cards and centered pills obscure the correspondence. |
| Desktop suggestion | 7 | Boxed messages and blue card fills compete with the selected inbox row. |
| Desktop approval | 6 | Purple status pill and internal references compete with the approval terms. |
| Desktop scenario | 7 | The scenario reads as a tinted card with redundant labels for uncertainty. |
| Desktop final | 7 | The thread remains boxed and the booking status repeats across the pane. |
| Desktop Full Mail | 7 | Large rounded message cards and the reply box break the reading surface into panels. |
| Desktop Full Event team | 6 | Rounded panels and raw permission keys make the workspace look like a developer dashboard. |
| Phone intro | 6 | Small inbox header and gradient sparkle lead to a promo-style empty state. |
| Phone suggestion | 5 | No inbox list or back navigation. |
| Phone final | 5 | No inbox list or back navigation. |

Baseline replay produced all 12 captures with no console errors. Tests passed 20/20.

## 2026-11-22 00:06 — request
Implement inbox-to-thread navigation at phone widths in Simple view. At 390×844, show an Inbox screen with a 28px semibold title, the existing participant and message count, and tappable message rows with 16px horizontal padding and neutral hairline separators. Open the existing thread when a row is tapped, position it at that message even if earlier items were collapsed, and provide a blue Back to inbox control with a thin chevron and a 44px tap target. Start and Next should still advance the same demo and take the viewer to the current thread as new mail arrives. Keep the demo bar reachable in both views. Preserve desktop behavior and all product rules. Use the reference for system typography and hierarchy while keeping the interface visually distinct from Apple Mail. Verify both phone screens and dark mode. For captures, use APP_URL=http://localhost:3107 and a temporary output directory if needed, because port 3000 belongs to the user's existing session. No commit or push.

**Outcome** — Phone inbox navigation works at 390×844. Verified Back, opening a collapsed message at the top of the reading pane, and Next from the inbox under both system appearances. Simple view still uses a light palette under dark appearance. Desktop now also reveals older messages when selected. Build and 20/20 tests passed.

Phone navigation captures after the change, with matching scores for light and dark system appearances:

| Capture | Apple score | Top issue |
| --- | ---: | --- |
| Phone intro | 6 | Gradient sparkle and promotional checklist still dominate. |
| Phone suggestion | 7 | Boxed messages compete with the thread hierarchy. |
| Phone final | 7 | Tall event banner and tinted message card crowd the thread. |
| Phone inbox | 8 | Internal identifiers appear in previews. |
| Phone earlier message | 7 | Tinted card and activity pills interrupt the thread. |

The 19 captures from the expanded suite rendered without console errors.


**Reverted by the user's request (
**Reverted at the user's request (2026-11-22 00:11):** both Codex-driven Simple view changes (removing the toolbar/search/favorites/folders, and the phone inbox navigation) were undone. StoryView.tsx and scripts/screenshot.mjs are back to the pre-loop version. Design loop stopped (.agents/STOP).

## 2026-11-22 — Full Apple Mail pass (Claude, at the user's request)

Rebuilt the UI against the user's own macOS Sequoia Mail screenshot. Shared pieces live in `web/src/components/mac.tsx`, and the `--m-*` system colors in `index.css` follow light/dark. Simple view: macOS menu bar, full-height sidebar with traffic lights, list header with categories, rounded blue selection, toolbar icons, Mail-style banner with a calendar tile, hairline-separated messages, gray monograms (including Plannie), and a "What's new"-style intro. Phones get iOS Mail (large title, back button, chevron rows). Full view: same mail components, macOS segmented control/toolbar, push buttons, compose window. Event team: grouped boxes, dot statuses instead of pills, no monospace. Ask Plannie suggestions are plain blue rows.

**Outcome** — Build OK, tests 24/24, screenshots checked in light and dark (desktop + phone). No console errors.
