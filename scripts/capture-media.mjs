// Captures the README images from the real demo (fictional data only): starts a throwaway demo server with its
// own database, jumps Acme to its key moment through the normal step API, and screenshots the story and the
// console. Needs Google Chrome and a built frontend (`npm run build:web`).
//   node scripts/capture-media.mjs            → docs/media/*.png
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.CAPTURE_PORT || 4600), OUT = "docs/media";
const dir = mkdtempSync(join(tmpdir(), "ccplannie-capture-"));
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ["--no-warnings", "server.mjs"], { env: { ...process.env, PLANNIE_MODE: "demo", PLANNIE_INTERPRETER: "fixture", PLANNIE_DB: join(dir, "demo.sqlite"), PORT: String(PORT) }, stdio: "ignore" });
const base = `http://localhost:${PORT}`, admin = base; // the console is served at /admin on the same port
const post = (p, body = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/state"); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  await post("/api/demo/scenario", { id: "acme" });
  for (let i = 0; i < 19; i++) await post("/api/demo/step?view=story"); // Acme's highlight: Dana says "Looks good" to the date change
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${base}/demo`); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/acme-date-change-email.png` });
  await page.goto(`${admin}/admin/requests/E-1?tab=details`); await page.waitForTimeout(1500);
  // The summary tiles plus the full plan / approval / booking table.
  await page.setViewportSize({ width: 1440, height: 1400 }); await page.waitForTimeout(500);
  const top = await page.locator("#console-main h1").first().boundingBox();
  const table = await page.locator("#console-main table").first().boundingBox();
  const main = await page.locator("#console-main").boundingBox();
  await page.screenshot({ path: `${OUT}/acme-date-change-console.png`, clip: { x: main.x, y: top.y - 12, width: main.width, height: table.y + table.height - top.y + 48 } });
  await browser.close();
  console.log(`Wrote ${OUT}/acme-date-change-email.png and ${OUT}/acme-date-change-console.png`);
} finally { server.kill(); rmSync(dir, { recursive: true, force: true }); }
