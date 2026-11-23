// Company activity: an application activity/audit log of configuration and routing changes.
// Separate from each request's own history; linked where useful. Not a tamper-proof compliance record.
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { aget, fmtWhen } from "./api";
import { Page } from "./ConsoleApp";
import { A, Empty, ErrorState, Loading, Notice, PageHeader } from "./ui";

type Entry = { id: string; at: string; actor: string; action: string; entity: string; before: any; after: any; details: any; configVersion: number | null; eventId: string | null; eventLinked: boolean };
const KINDS = [["all", "All activity"], ["people", "People and roles"], ["policy", "Policy"], ["requests", "Request routing"]] as const;
const kindOf = (a: string) => (a.startsWith("policy") ? "policy" : a.startsWith("request") || a.startsWith("approval") || a.startsWith("intake") ? "requests" : "people");
const ACTION_LABEL: Record<string, string> = {
  "org.edited": "People saved", "org.csv_imported": "CSV imported", "config.sample_restored": "Demo company loaded", "config.migrated": "Configuration migrated",
  "person.added": "Person added", "person.removed": "Person removed", "person.changed": "Person updated", "person.roles_changed": "Roles changed", "person.limit_changed": "Approval limit changed", "person.identity_changed": "Email changed",
  "role.added": "Role created", "role.changed": "Role changed", "role.removed": "Role deleted", "policy.changed": "Policy setting changed", "policy.saved": "Policy saved", "policy.imported": "Uploaded policy applied", "policy.sample_applied": "Demo policy applied",
  "request.routed": "Request routed", "request.reassigned": "Request reassigned", "approval.reassigned": "Approval reassigned", "intake.reprocessed": "Held email processed",
};
const actionLabel = (a: string) => ACTION_LABEL[a] || a;
const actorName = (a: string) => (a === "admin" ? "Administrator" : a === "demo-company-page" ? "Demo company page" : a === "demo setup" ? "Demo setup" : a);

export function Activity() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("all");
  const load = useCallback(() => aget("/api/admin/activity").then((r) => { setEntries(r.entries); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); const t = window.setInterval(load, 2500); return () => window.clearInterval(t); }, [load]);
  const shown = useMemo(() => (entries || []).filter((e) => kind === "all" || kindOf(e.action) === kind), [entries, kind]);

  return (
    <Page>
      <PageHeader title="Activity" />
      {error && !entries ? <ErrorState error={error} retry={load} /> : !entries ? <Loading /> : (
        <>
          {error ? <Notice tone="attn" role="alert">Couldn’t refresh activity. <button className="text-primary underline-offset-2 hover:underline" onClick={load}>Try again</button></Notice> : null}
          <div className="flex flex-col gap-2">
            <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                  className={cn("shrink-0 rounded-full px-2.5 py-1 text-[13px]", kind === k ? "bg-[var(--console-selected)] font-medium" : "text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
            {shown.length === 0 ? kind === "all" ? (
              <Empty title="No activity yet">Saved changes to people, policy and request routing will appear here. <A to="/admin/people">View people</A></Empty>
            ) : <Empty title="No activity in this category"><button className="text-primary underline-offset-2 hover:underline" onClick={() => setKind("all")}>Show all activity</button></Empty> : (
              <div className="@container overflow-hidden rounded-xl border border-border bg-card">
                <div aria-hidden="true" className="hidden justify-between border-b border-border bg-[var(--console-sidebar)] px-4 py-2.5 text-[12px] font-medium text-muted-foreground @min-[34rem]:flex"><span>Event</span><span>Time</span></div>
                <ol className="divide-y divide-border">
                  {shown.map((e) => (
                    <li key={e.id} className="grid gap-x-4 gap-y-1 px-4 py-3 leading-5 @min-[34rem]:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <p className="wrap-anywhere text-[13px] font-medium">{e.details?.text || actionLabel(e.action)}</p>
                        <ActivityMeta e={e} />
                      </div>
                      <time dateTime={e.at} className="tabular text-[12px] text-muted-foreground @min-[34rem]:text-right">{fmtWhen(e.at)}</time>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

// One quiet line under each entry; the field-level change opens on demand instead of a disclosure on every row.
function ActivityMeta({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const changes = diffRows(e.before, e.after);
  return (
    <>
      <div className="wrap-anywhere text-[12px] text-muted-foreground">
        <span title={`${e.action} · ${e.entity}${e.configVersion ? ` · configuration v${e.configVersion}` : ""}`}>{e.details?.text && e.details.text !== actionLabel(e.action) ? `${actionLabel(e.action)} · ` : ""}{actorName(e.actor)}</span>
        {e.eventId ? <> · {e.eventLinked ? <A to={`/admin/requests/${e.eventId}?tab=history`}>{e.eventId} history</A> : <span>{e.eventId} (no longer present)</span>}</> : null}
        {changes.length ? <> · <button className="text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button></> : null}
      </div>
      {open ? (
        <dl className="mt-2 max-w-[72ch] rounded-lg bg-[var(--console-sidebar)] px-3 py-2 text-[12px]">
          {changes.map(([k, b, a]) => (
            <div key={k} className="grid gap-x-4 gap-y-0.5 py-0.5 @min-[34rem]:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
              <dt className="wrap-anywhere text-muted-foreground">{k}</dt>
              <dd className="min-w-0 wrap-anywhere">{b != null ? <><span className="text-muted-foreground line-through decoration-muted-foreground/50">{b}</span> → </> : null}{a ?? <span className="text-muted-foreground">Removed</span>}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

const show = (v: any): string | null => (v == null || v === "" ? null : Array.isArray(v) ? v.map(show).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const human = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace("Approve Up To", "Approval limit");
// Only the fields that actually changed, as label / before / after.
function diffRows(before: any, after: any): [string, string | null, string | null][] {
  const obj = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : x == null ? {} : { value: x });
  const b = obj(before), a = obj(after);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => [human(k), show(b[k]), show(a[k])]);
}
