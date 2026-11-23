// The org chart of the People draft, drawn with d3-org-chart (pan, zoom, expand and collapse). It follows the
// same unsaved draft the editor below writes. Reporting lines grant no powers; each card shows the person's role.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { OrgChart as D3OrgChart } from "d3-org-chart";
import { Button } from "@/components/ui/primitives";
import { money, type Permission, type Person } from "./api";
import type { Roles } from "./Roles";
import { Section, Status } from "./ui";

type P = Person & { _key: string };
type Row = { id: string; parentId: string | null; name: string; title: string; role: string; limit: string | null; initials: string; virtual?: boolean };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const initials = (p: P) => {
  const parts = (p.name || p.email || "?").trim().replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};
const key = (e: string | null | undefined) => (e || "").trim().toLowerCase();
const ROOT = "__company";
// 500000 → "CAD 500k", 1250000 → "CAD 1.25M": fits a narrow card; the People list below has exact amounts.
const short = (n: number, cur: string) => n >= 1e6 ? `${cur} ${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${cur} ${+(n / 1e3).toFixed(1)}k` : money(n, cur);

// One tree with one root. People whose manager is missing or whose chain loops hang off a company node.
function toRows(people: P[], roles: Roles, currency: string): { rows: Row[]; loops: number; orphans: number } {
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [key(p.email), p]));
  const parentOf = (p: P) => (p.manager ? byEmail.get(key(p.manager)) : undefined);
  const looped = new Set<string>();
  for (const p of people) {
    const seen = new Set([p._key]);
    for (let m = parentOf(p); m; m = parentOf(m)) { if (seen.has(m._key)) { looped.add(p._key); break; } seen.add(m._key); }
  }
  const parentKey = (p: P) => { const m = parentOf(p); return m && !looped.has(p._key) ? m._key : null; };
  const roots = people.filter((p) => !parentKey(p));
  const needRoot = roots.length !== 1;
  const rows: Row[] = people.map((p) => ({
    id: p._key, parentId: parentKey(p) ?? (needRoot ? ROOT : null),
    name: p.name || p.email || "New person", title: p.title, initials: initials(p),
    // Third line only when it adds something: not "Employee", and not a repeat of the job title.
    role: (() => { const l = p.roles.filter((r) => r !== "employee").map((r) => roles[r]?.label || r).join(", "); return !p.title ? l || "No role" : l && l.toLowerCase() !== p.title.toLowerCase() ? l : ""; })(),
    limit: p.roles.some((r) => roles[r]?.permissions.includes("approve")) ? (p.approveUpTo ? `Approves ≤ ${short(p.approveUpTo, currency)}` : "No approval limit") : null,
  }));
  if (needRoot) rows.unshift({ id: ROOT, parentId: null, name: "Company", title: "", role: "", limit: null, initials: "", virtual: true });
  return { rows, loops: looped.size, orphans: people.filter((p) => p.manager && !parentOf(p)).length };
}

const card = (r: Row, width: number, height: number, focused: boolean) => r.virtual
  ? `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;font:500 13px/1.2 var(--font-sans,system-ui);color:var(--muted-foreground)">Company</div>`
  : `<div class="oc-card${focused ? " oc-card--focused" : ""}" style="width:${width}px;height:${height}px">
      <div class="oc-av">${esc(r.initials)}</div>
      <div class="oc-text">
        <div class="oc-name">${esc(r.name)}</div>
        <div class="oc-sub">${esc(r.title || r.role)}</div>
        <div class="oc-role">${esc(r.limit || (r.title ? r.role : ""))}</div>
      </div>
    </div>`;

export function OrgChart({ people, roles, currency, focusEmail, onEdit }: { people: P[]; roles: Roles; perms: Permission[]; currency: string; focusEmail?: string | null; onEdit: (key: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<any>(null);
  const edit = useRef(onEdit);
  edit.current = onEdit;
  const { rows, loops, orphans } = useMemo(() => toRows(people, roles, currency), [people, roles, currency]);
  const sig = JSON.stringify(rows);
  const focusId = focusEmail ? people.find((p) => key(p.email) === key(focusEmail))?._key : undefined;
  const box = useRef<HTMLDivElement>(null);
  const refit = () => window.setTimeout(() => {
    chart.current?.fit();
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 450);

  // Size the box to the space left below it in the console (with the page scrolled to the top), so the page
  // title, the section heading and the bottom of the box are all visible without scrolling.
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const b = box.current, main = b?.closest("#console-main");
      if (!b || !main) return;
      const top = b.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      setHeight(Math.round(Math.min(640, Math.max(260, main.clientHeight - top - 24))) - 2);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!el.current || !height) return;
    if (!chart.current) chart.current = new D3OrgChart();
    const graph = chart.current;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const branch = new Set<string>();
    for (let row = focusId ? byId.get(focusId) : undefined; row; row = row.parentId ? byId.get(row.parentId) : undefined) branch.add(row.id);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    graph
      .container(el.current)
      .data(rows.map((r) => branch.has(r.id) ? { ...r, _expanded: true } : { ...r }))
      .nodeId((d: Row) => d.id)
      .parentNodeId((d: Row) => d.parentId)
      .layout("top")
      .compact(false)
      .duration(focusId ? 0 : 400)
      .svgHeight(height)
      .nodeWidth(() => 136)
      .nodeHeight(() => 112)
      .childrenMargin(() => 40)
      .siblingsMargin(() => 10)
      .neighbourMargin(() => 20)
      .compactMarginBetween(() => 14)
      .compactMarginPair(() => 18)
      // One level of people below the top, whether the top is a CEO or the "Company" node.
      .initialExpandLevel(rows.some((x) => x.virtual) ? 2 : 1)
      .nodeContent((d: any) => card(d.data, d.width, d.height, d.data.id === focusId))
      .buttonContent(({ node }: any) => `<div class="oc-btn">${node.children ? "−" : "+"} ${node.data._directSubordinates}</div>`)
      .linkUpdate(function (this: SVGPathElement) { this.setAttribute("stroke", "var(--border)"); this.setAttribute("stroke-width", "1"); })
      // Refit once the expand/collapse animation (400 ms) has finished, so the whole chart stays in view.
      .onExpandOrCollapse(() => refit())
      .onNodeClick((d: any) => { const id = d?.data?.id ?? d?.id ?? d; if (id && id !== ROOT) edit.current(id); })
      .render();

    const { root, svgWidth } = graph.getChartState();
    const focused = focusId ? root.descendants().find((node: { data: Row }) => node.data.id === focusId) : null;
    if (!focused) {
      graph.fit({ animate: false });
      return;
    }
    const nodes = focused.parent && svgWidth >= 600 && height >= 420 ? [focused.parent, focused] : [focused];
    box.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "instant" : "smooth" });
    let active = true;
    if (reduceMotion) graph.fit({ nodes, animate: false }).duration(400);
    else graph.fit({ animate: false, onCompleted: () => {
      if (active) graph.duration(550).fit({ nodes });
    } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, height, focusId]);

  const flags = [
    loops && `${loops} ${loops === 1 ? "person is" : "people are"} in a reporting loop.`,
    orphans && `${orphans} ${orphans === 1 ? "person reports" : "people report"} to someone who isn't in the directory.`,
  ].filter(Boolean) as string[];

  return (
    <Section title="Organization" aside="Click a person to edit">
      <style>{`
        .oc-card { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 8px; text-align: center; background: var(--card); border: 1px solid var(--border); border-radius: 10px; font-family: var(--font-sans, system-ui); cursor: pointer; transition: border-color .15s, box-shadow .15s; }
        .oc-card:hover { border-color: color-mix(in oklab, var(--primary) 45%, var(--border)); box-shadow: 0 2px 8px rgba(0,0,0,.06); }
        .oc-card--focused, .oc-card--focused:hover { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); }
        .oc-av { flex: none; width: 30px; height: 30px; border-radius: 999px; display: grid; place-items: center; background: var(--m-fill, #f2f2f2); color: var(--foreground); font-size: 11px; font-weight: 600; }
        .oc-card--focused .oc-av { background: var(--console-selected); }
        .oc-text { min-width: 0; width: 100%; line-height: 1.25; }
        .oc-name { font-size: 13px; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .oc-sub { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 11.5px; color: var(--muted-foreground); }
        .oc-role { margin-top: 2px; font-size: 11px; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .oc-role:empty { display: none; }
        .oc-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 20px; padding: 0 7px; margin: auto; border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--muted-foreground); font: 500 11px/1 var(--font-sans, system-ui); }
      `}</style>
      <div ref={box} className="relative scroll-mb-4 overflow-hidden rounded-xl border border-border bg-[var(--console-sidebar)]">
        {/* The box always fits the screen: viewport height minus the console header and the section title. */}
        <div ref={el} className="w-full" style={{ height: height || 420 }} />
        <div className="absolute right-2 top-2 flex gap-1">
          <Button size="sm" variant="outline" onClick={() => { chart.current?.expandAll(); refit(); }}>Expand all</Button>
          <Button size="sm" variant="outline" onClick={() => { chart.current?.collapseAll(); refit(); }}>Collapse</Button>
          <Button size="sm" variant="outline" onClick={() => chart.current?.fit()}>Fit</Button>
        </div>
      </div>
      {flags.length ? <div className="mt-2 flex flex-col gap-1">{flags.map((f) => <Status key={f} tone="attn">{f}</Status>)}</div> : null}
    </Section>
  );
}
