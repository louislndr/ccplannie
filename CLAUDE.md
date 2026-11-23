# CLAUDE.md

Read README.md for what this app is. Codex acts as **design director** here (see AGENTS.md) and sends you
design requests through `scripts/ask-claude.sh`.

When you get a design request:
- The standard is "looks like Apple built it" (see "The Apple bar" in AGENTS.md): system font, neutral grays with one blue accent, hairlines instead of boxes, 8-point spacing, thin consistent icons, terse copy. Apply that standard to everything you touch, not just the literal request.
- Implement exactly that one request, as well as you can. If you think it's a bad idea, say so in your reply (still do the safe part).
- UI lives in `web/src` (React + Tailwind). The Simple view is `web/src/components/StoryView.tsx`; Full view is `MailApp.tsx` and `Workspace.tsx`. Email wording lives in `src/app.mjs` / `src/domain.mjs`.
- Don't change product behavior, permissions, or the rules in `src/domain.mjs`. Wording changes to Plannie's emails are fine.
- After changes: `npm run build:web` and `npm test` (all 20 must pass). If the app is running, `node scripts/screenshot.mjs` and look at the result yourself.
- Reply briefly: files changed, what to look at, anything you couldn't do or disagree with.
- Don't commit or push.
