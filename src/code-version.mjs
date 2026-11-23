// Detects a server running older code than what's on disk (e.g. the files changed but `npm run demo` wasn't
// restarted). The console shows a "restart the server" notice instead of failing on saves it doesn't understand.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
function stamp() {
  let latest = 0;
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith(".mjs")) latest = Math.max(latest, statSync(p).mtimeMs); } };
  try { walk(join(ROOT, "src")); latest = Math.max(latest, statSync(join(ROOT, "server.mjs")).mtimeMs); } catch { /* best effort */ }
  return latest;
}
const STARTED = stamp();
let last = { at: 0, stale: false };
// Cached for a few seconds so the session poll stays cheap.
export function serverIsStale() {
  if (Date.now() - last.at > 5000) last = { at: Date.now(), stale: stamp() > STARTED + 1 };
  return last.stale;
}
