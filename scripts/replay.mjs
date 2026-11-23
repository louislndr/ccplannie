// Replays a demo headlessly through the normal pipeline and prints every email ccPlannie sends and every
// exchange with Planned (sample data in the demos).
// Usage: npm run replay [-- northwind]   (fixture mode unless PLANNIE_INTERPRETER=model)
import { openDb } from "../src/db.mjs";
import { createApp } from "../src/app.mjs";
import { localTransport } from "../src/transport.mjs";
import { views, status } from "../src/domain.mjs";

const id = process.argv[2] || "acme";
const store = openDb(":memory:");
const app = createApp({ store, transport: localTransport() });
app.loadScenario(id);
let seenMail = 0, seenPlanned = 0;
for (;;) {
  const r = await app.demoStep();
  if (r.done && !r.step) break;
  const snap = app.snapshot();
  const fresh = snap.messages.slice(seenMail); seenMail = snap.messages.length;
  const ex = snap.planned.slice(seenPlanned); seenPlanned = snap.planned.length;
  console.log(`\n=== ${r.step}`);
  for (const m of fresh) console.log(`  [${m.direction}] ${m.from} → ${[...m.to, ...m.cc].join(", ")} | ${m.subject}\n    ${m.body.replace(/\n/g, "\n    ").slice(0, 1400)}`);
  for (const x of ex) console.log(`  [${x.direction === "to" ? "→ Planned" : "← Planned"}] ${x.type} · ${x.venue} · ${JSON.stringify(Object.fromEntries(Object.entries(x.fields).filter(([, v]) => v != null && v !== 0)))}`);
  if (r.done) break;
}
for (const ev of store.listEvents()) {
  console.log(`\nFINAL ${ev.id} ${ev.title}:`, status(ev).label, JSON.stringify(views(ev)));
  if (ev.reviewQueue.some((f) => f.open)) console.log("  Open review items:", ev.reviewQueue.filter((f) => f.open).map((f) => f.text));
}
