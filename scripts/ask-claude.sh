#!/usr/bin/env bash
# Sends one design request to Claude Code and prints Claude's reply.
# Keeps ONE ongoing Claude session (id stored in .agents/claude-session) so Claude remembers earlier requests.
#
#   scripts/ask-claude.sh "Make the message list rows denser, like the reference"
#   scripts/ask-claude.sh --new "..."     # start a fresh Claude session
#
# Claude may edit files and run npm/node commands in this repo, nothing else.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .agents design
SESSION_FILE=.agents/claude-session
if [[ -f .agents/STOP ]]; then echo "Design loop is stopped by the user (.agents/STOP exists). Do not send requests or edit files. Stop the loop now." >&2; exit 3; fi

if [[ "${1:-}" == "--new" ]]; then rm -f "$SESSION_FILE"; shift; fi
REQUEST="${1:?usage: scripts/ask-claude.sh [--new] \"design request\"}"

RESUME=()
if [[ -s "$SESSION_FILE" ]]; then RESUME=(--resume "$(cat "$SESSION_FILE")"); fi

OUT=$(claude -p "$REQUEST" ${RESUME[@]+"${RESUME[@]}"} \
  --output-format json \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(npm test)" "Bash(npm run build:web)" "Bash(npm run replay)" "Bash(node scripts/screenshot.mjs*)" "Bash(cd web && npx vite build)" "Bash(git diff*)" "Bash(git status*)" \
  --append-system-prompt "You are receiving a design request from Codex, the design director for this repo. Follow CLAUDE.md. The standard is that every screen looks like Apple built it (see The Apple bar in AGENTS.md). Implement what is asked, keep behavior and tests intact, rebuild the web UI, and reply with: what you changed (files), what to look at in the screenshots, and anything you disagree with or could not do.")

echo "$OUT" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const j=JSON.parse(s);
  if (j.session_id) require("fs").writeFileSync(".agents/claude-session", j.session_id);
  console.log(j.result ?? s);
  if (j.is_error) process.exit(1);
});'

{ echo "## $(date '+%Y-%m-%d %H:%M') — request"; echo "$REQUEST"; echo; } >> design/log.md
