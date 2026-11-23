// Takes the screenshots the design reviewer looks at. Needs the app running (npm start) and Google Chrome installed.
// Usage: node scripts/screenshot.mjs [outDir]   (default: design/shots)
// Captures the Simple view at key demo steps (desktop + phone) and the Full view screens.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "design/shots";
const BASE = process.env.APP_URL || "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const shot = async (p, name) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(`${OUT}/${name}.png`); };

for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.request.post(`${BASE}/api/demo/reset`);
  await p.goto(BASE);
  await shot(p, `${tag}-00-intro`);
  const keep = tag === "desktop" ? { 2: "request", 6: "options", 7: "suggestion", 10: "approval", 16: "scenario", 23: "final" } : { 7: "suggestion", 23: "final" };
  for (let i = 1; i <= 23; i++) {
    await p.getByRole("button", { name: /^(Start|Next)$/ }).click();
    if (keep[i]) await shot(p, `${tag}-${String(i).padStart(2, "0")}-${keep[i]}`);
    else await p.waitForTimeout(250);
  }
  if (tag === "desktop") {
    await p.getByRole("button", { name: "Full view" }).click();
    await shot(p, "desktop-full-mail");
    await p.getByRole("button", { name: /Event team/ }).click();
    await shot(p, "desktop-full-team");
  }
  await ctx.close();
}
await fetch(`${BASE}/api/demo/reset`, { method: "POST" });
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "No console errors.");
await browser.close();
