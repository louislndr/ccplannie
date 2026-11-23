import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, UploadIcon, DownloadIcon, RotateCcwIcon, TriangleAlertIcon, CircleAlertIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { post } from "@/api";
import { Avatar, AvatarFallback, Button, Card } from "./ui/primitives";

// Upload the org chart that decides who can do what with Plannie.

type Person = { name: string; email: string; title: string; manager: string | null; roles: string[]; approveUpTo: number | null; backup: string | null; caps?: string[] };
export type Role = { label: string; summary: string; permissions: string[]; caps?: string[] };
export type Permission = { id: string; label: string; summary: string };
export type Org = { version?: number; source: string; updatedAt: string | null; currency: string; people: Person[]; roles: Record<string, Role>; permissions: Permission[]; demoWarning: string | null; roleDefinitionImport?: boolean };
type Issue = { row: number; message: string };
type Preview = { people: Person[]; errors: Issue[]; warnings: Issue[]; changes: { email: string; kind: string; text: string }[]; roleChanges?: { id: string; kind: string; text: string }[] };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

const Group = ({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) => (
  <section>
    <Card className="overflow-hidden">
      <h2 className="border-b border-border px-5 py-3.5 text-base font-medium">{title}</h2>
      {children}
      {footer ? <p className="border-t border-border bg-muted px-5 py-3 text-xs leading-relaxed text-muted-foreground">{footer}</p> : null}
    </Card>
  </section>
);

export function CompanyPage({ toast, onClose }: { toast: (t: string) => void; onClose?: () => void }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileRequest = useRef(0);

  const load = async () => setOrg(await (await fetch("/api/org")).json());
  useEffect(() => { load(); }, []);

  const readFile = async (f: File) => {
    if (f.size > 2_000_000) return toast("That file is too large for an org chart (max 2 MB).");
    const request = ++fileRequest.current;
    setCsv(null); setPreview(null); setFileName(f.name);
    try {
      const text = await f.text();
      const result = await post("/api/org/preview", { csv: text });
      if (request === fileRequest.current) { setCsv(text); setPreview(result); }
    } catch (e: any) {
      if (request === fileRequest.current) toast(e.message);
    }
  };
  const apply = async () => {
    if (!csv) return;
    setBusy(true);
    try { await post("/api/org/apply", { csv, fileName, expectedVersion: org?.version }); await load(); setCsv(null); setPreview(null); setFileName(""); toast("Company hierarchy updated. ccPlannie uses it from now on."); }
    catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true);
    try { await post("/api/org/reset", { expectedVersion: org?.version }); await load(); setCsv(null); setPreview(null); setFileName(""); toast("Restored the sample company."); }
    catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="company-page h-full overflow-y-auto text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-[var(--concept-gutter)] pb-16 pt-8">
        <header className="company-header flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-6">
          <h1 className="concept-heading min-w-0 basis-full text-4xl sm:flex-1 sm:basis-auto">Company hierarchy</h1>
          {onClose ? <Button variant="outline" className="[--concept-button-height:2.5rem]" onClick={onClose}>Back to demo</Button> : null}
        </header>

        {org?.demoWarning ? (
          <Card role="alert" className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <TriangleAlertIcon className="mt-px size-4 shrink-0 text-warn" />
            <span className="flex-1">{org.demoWarning}</span>
            <Button variant="outline" onClick={restore} disabled={busy}>Restore sample</Button>
          </Card>
        ) : null}

        {org ? <OrgTree org={org} /> : null}
        {org ? <Matrix org={org} /> : null}

        {org && org.source !== "sample" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            {org.updatedAt ? <span>Uploaded {new Date(org.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</span> : null}
            <Button variant="outline" onClick={restore} disabled={busy}><RotateCcwIcon />Restore sample company</Button>
          </div>
        ) : null}

        <Group title="Upload" footer={<>
          Use the downloaded CSV as a template. Separate multiple roles with semicolons. Set <code className="concept-mono">approval_limit</code> for each approver.
          {org?.roleDefinitionImport ? <> Keep the definition rows for roles you want to retain.</> : null}
        </>}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
            className={cn("flex flex-col items-center gap-3 px-6 py-8 text-center transition-colors", drag && "bg-accent")}
          >
            <UploadIcon className="size-7 text-[var(--company-teal)]" strokeWidth={1.4} />
            <div className="max-w-full text-sm wrap-anywhere">{fileName ? <>Selected <b className="font-semibold">{fileName}</b></> : "Drop your org chart CSV here"}</div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant={csv ? "outline" : "default"} onClick={() => input.current?.click()}>{csv ? "Choose another file…" : "Choose file…"}</Button>
              <Button variant="outline" nativeButton={false} render={<a href="/api/org/template.csv" />}>
                <DownloadIcon />Download current as CSV
              </Button>
            </div>
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
          </div>
        </Group>

        {preview ? <PreviewPanel preview={preview} busy={busy} onApply={apply} onCancel={() => { setCsv(null); setPreview(null); setFileName(""); }} /> : null}
      </div>
    </div>
  );
}

function PreviewPanel({ preview, busy, onApply, onCancel }: { preview: Preview; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const ok = preview.errors.length === 0;
  const roleChanges = preview.roleChanges ?? [];
  const totalChanges = preview.changes.length + roleChanges.length;
  return (
    <Group title="Review before applying">
      <div className="divide-y divide-border text-sm">
        {preview.errors.map((e, i) => (
          <div key={`e${i}`} className="flex gap-2.5 px-3.5 py-2.5"><CircleAlertIcon className="mt-px size-4 shrink-0 text-destructive" /><span>{e.row ? <span className="text-muted-foreground">Row {e.row}: </span> : null}{e.message}</span></div>
        ))}
        {preview.warnings.map((w, i) => (
          <div key={`w${i}`} className="flex gap-2.5 px-3.5 py-2.5"><TriangleAlertIcon className="mt-px size-4 shrink-0 text-warn" /><span>{w.row ? <span className="text-muted-foreground">Row {w.row}: </span> : null}{w.message}</span></div>
        ))}
        {ok ? (
          <div className="px-3.5 py-2.5">
            <div className="mb-1 font-medium">{preview.people.length} people · {totalChanges ? `${totalChanges} change${totalChanges > 1 ? "s" : ""}` : "no changes"}</div>
            <ul className="space-y-0.5 text-muted-foreground">
              {preview.changes.map((c) => <li key={c.email + c.kind}><span className={cn("mr-1.5 inline-block w-14 text-[11px] font-semibold uppercase", c.kind === "removed" ? "text-destructive" : c.kind === "added" ? "text-ok" : "text-warn")}>{c.kind}</span>{c.text}</li>)}
            </ul>
            {roleChanges.length ? (
              <ul aria-label="Role changes" className="mt-1 space-y-0.5 text-muted-foreground">
                {roleChanges.map((c) => <li key={c.id} className="wrap-anywhere"><span className={cn("mr-1.5 inline-block w-14 text-[11px] font-semibold uppercase", c.kind === "removed" ? "text-destructive" : c.kind === "added" ? "text-ok" : "text-warn")}>{c.kind === "changed" ? "role" : c.kind}</span>{c.text}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 bg-muted px-4 py-3">
          {!ok ? <span className="mr-auto basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-auto">Fix {preview.errors.length === 1 ? "this error" : `these ${preview.errors.length} errors`} in the file and choose it again.</span> : <span className="mr-auto basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-auto">Takes effect immediately, including for events in progress.</span>}
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ok || busy} onClick={onApply}>Apply</Button>
        </div>
      </div>
    </Group>
  );
}

export function OrgTree({ org, title }: { org: Org; title?: string }) {
  const byManager = useMemo(() => {
    const m = new Map<string | null, Person[]>();
    const emails = new Set(org.people.map((p) => p.email));
    for (const p of org.people) { const k = p.manager && emails.has(p.manager) ? p.manager : null; m.set(k, [...(m.get(k) || []), p]); }
    return m;
  }, [org]);
  const name = (e: string | null) => org.people.find((p) => p.email === e)?.name || e;
  const rows: { p: Person; depth: number }[] = [];
  const walk = (k: string | null, depth: number) => { for (const p of byManager.get(k) || []) { rows.push({ p, depth }); walk(p.email, depth + 1); } };
  walk(null, 0);
  return (
    <Group title={title ?? `People (${org.people.length})`}>
      <div className="divide-y divide-border">
        {rows.map(({ p, depth }) => (
          <div key={p.email} className="flex items-center gap-3 py-2.5 pr-3.5" style={{ paddingLeft: 14 + depth * 26 }}>
            {depth > 0 ? <ChevronRightIcon className="-ml-5 size-3 shrink-0 text-muted-foreground" /> : null}
            <Avatar><AvatarFallback className="bg-secondary text-xs font-medium text-[var(--company-teal)]">{initials(p.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.name} <span className="font-normal text-muted-foreground">· {p.title || "—"}</span></div>
              <div className="truncate text-xs text-muted-foreground">{p.email}{p.backup ? ` · backup: ${name(p.backup)}` : ""}</div>
            </div>
            <div className="max-w-[45%] shrink-0 text-right wrap-anywhere">
              <div className="text-xs font-medium">{p.roles.map((r) => org.roles[r]?.label || r).join(", ")}</div>
              {p.approveUpTo != null ? <div className="text-xs tabular-nums text-muted-foreground">approves up to {org.currency} {p.approveUpTo.toLocaleString("en-US")}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </Group>
  );
}

// What each role can do: roles as rows (a company can have many), the four permission groups as columns.
export function Matrix({ org }: { org: Org }) {
  const ids = Object.keys(org.roles);
  return (
    <Group title="What each role can do" footer="Everyone in the company can also suggest changes. Suggestions are never applied on their own.">
      <p id="role-permissions-scroll" className="border-b border-border px-5 py-2 text-xs text-muted-foreground sm:hidden">Scroll sideways to see all permissions.</p>
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" role="region" aria-label="Role permissions" aria-describedby="role-permissions-scroll" tabIndex={0}>
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th scope="col" className="px-5 py-3 text-left font-semibold">Role</th>
              {org.permissions.map((p) => <th key={p.id} scope="col" title={p.summary} className="w-[13%] px-2 py-3 text-center font-semibold text-balance">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id} className="border-t border-border">
                <th scope="row" className="px-5 py-2.5 text-left align-top font-normal leading-snug">
                  <div className="font-medium wrap-anywhere">{org.roles[id].label}</div>
                  {org.roles[id].summary ? <div className="whitespace-pre-line text-xs text-muted-foreground wrap-anywhere">{org.roles[id].summary}</div> : null}
                </th>
                {org.permissions.map((p) => (
                  <td key={p.id} className="px-2 text-center align-middle">
                    {org.roles[id].permissions.includes(p.id) ? (
                      <CheckIcon className="mx-auto size-4 text-[var(--company-teal)]" strokeWidth={2} role="img" aria-label="Allowed" />
                    ) : (
                      <><span className="sr-only">Not allowed</span><span aria-hidden="true" className="text-muted-foreground/70">–</span></>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted">
            <tr>
              <th scope="row" className="px-5 py-3 text-left font-medium">People with permission</th>
              {org.permissions.map(({ id }) => (
                <td key={id} className="px-2 py-3 text-center tabular-nums">
                  {org.people.filter((person) => person.roles.some((role) => org.roles[role]?.permissions.includes(id))).length}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Group>
  );
}
