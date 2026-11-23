// What is really connected, derived on the server. No secrets reach the browser, and nothing here
// can mark Planned as connected.
import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { aget, apost, ApiError, type Company } from "./api";
import { Page, useConsole } from "./ConsoleApp";
import { A, ErrorState, Field, Loading, Notice, PageHeader, Section, Status, inputCls, type Tone } from "./ui";

const tone = (state: string): Tone => (state === "configured" || state === "saved" || state === "connected" ? "ok" : state === "missing" ? "block" : state === "local" || state === "empty" ? "attn" : state === "sample" || state === "demo" ? "info" : "neutral");
const STATE: Record<string, string> = { local: "Not sending", configured: "Configured", connected: "Connected", missing: "Needs setup", not_connected: "Not connected" };
type Connection = { state: string; label: string; detail: string; inbound?: string; from?: string; fileName?: string | null; download?: string };
type ConnectionData = Record<"email" | "interpretation" | "people" | "rules" | "planned", Connection>;

export function Connections() {
  const { toast } = useConsole();
  const [c, setC] = useState<ConnectionData | null>(null);
  const [co, setCo] = useState<Company | null>(null);
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [x, y] = await Promise.all([aget("/api/admin/connections"), aget("/api/admin/company")]); setC(x); setCo(y); setRef(y.config.policy.plannedWorkspaceRef || ""); setError(null); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!c || !co) return <Page><PageHeader title="Connections" />{error ? <ErrorState error={error} retry={load} /> : <Loading />}</Page>;

  const saveRef = async () => {
    setBusy(true);
    try { await apost("/api/admin/policy/apply", { policy: { ...co.config.policy, plannedWorkspaceRef: ref }, expectedVersion: co.config.version }); toast("Reference saved. Planned is still not connected."); await load(); }
    catch (e: any) { toast(e instanceof ApiError && e.errors?.length ? e.errors[0].message : e.message, "error"); } finally { setBusy(false); }
  };
  const rows = [
    { label: "Email sending", connection: c.email },
    { label: "Email interpretation", connection: c.interpretation },
    { label: "Company people", connection: c.people, to: "/admin/people", link: "View people" },
    { label: "Company rules", connection: c.rules, to: "/admin/policy", link: "View rules" },
    { label: "Planned", connection: c.planned, to: "/admin/planned", link: "View venue exchanges" },
  ];
  const workspaceChanged = ref !== (co.config.policy.plannedWorkspaceRef || "");

  return (
    <Page>
      <PageHeader title="Connections" />
      {error ? <Notice tone="attn" role="alert">Couldn’t refresh connections. <button className="text-primary underline-offset-2 hover:underline" onClick={load}>Try again</button></Notice> : null}
      <div className="@container overflow-hidden rounded-xl border border-border bg-card">
        <div aria-hidden="true" className="hidden grid-cols-[11rem_1fr] gap-4 border-b border-border bg-[var(--console-sidebar)] px-4 py-2.5 text-[12px] font-medium text-muted-foreground @min-[34rem]:grid"><span>Service</span><span>Configuration</span></div>
        <ul className="divide-y divide-border">
          {rows.map(({ label, connection: x, to, link }) => x && (
            <li key={label} className="grid gap-1.5 px-4 py-3 @min-[34rem]:grid-cols-[11rem_minmax(0,1fr)] @min-[34rem]:gap-x-4 @min-[34rem]:py-2.5">
              <h2 className="text-[13px] font-medium leading-5">{label}</h2>
              <div className="flex min-w-0 flex-col items-start gap-1.5 @min-[34rem]:gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 leading-5">
                  <Status tone={tone(x.state)}>{label === "Planned" && x.state === "sample" ? "Sample data" : STATE[x.state] || x.label}</Status>
                  {STATE[x.state] && x.label !== STATE[x.state] ? <span className="wrap-anywhere text-[13px]">{x.label}</span> : null}
                  {x.fileName ? x.download
                    ? <a href={x.download} download className="min-w-0 wrap-anywhere text-[13px] font-medium underline-offset-2 hover:underline" aria-label={`Download ${x.fileName}`}>{x.fileName}</a>
                    : <span className="min-w-0 wrap-anywhere text-[13px] font-medium">{x.fileName}</span> : null}
                </div>
                {x.inbound ? <dl className="space-y-1 text-[12px] leading-5">
                  <div><dt className="inline text-muted-foreground">Request address</dt>{" "}<dd className="inline wrap-anywhere font-medium">{x.inbound}</dd></div>
                  {x.from && x.from !== x.inbound ? <div><dt className="inline text-muted-foreground">Replies from</dt>{" "}<dd className="inline wrap-anywhere font-medium">{x.from}</dd></div> : null}
                </dl> : null}
                <details className="group/details w-full text-[12px] leading-5 text-muted-foreground">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDownIcon aria-hidden="true" className="size-3.5 -rotate-90 group-open/details:rotate-0" strokeWidth={1.7} />Details<span className="sr-only"> for {label}</span>
                  </summary>
                  <p className="mt-1 max-w-[70ch] wrap-anywhere pl-[18px]">{x.detail}</p>
                </details>
                {to ? <A to={to} className="text-[12px]">{link}</A> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Section title="Planned workspace">
        <form className="rounded-xl border border-border bg-card px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (!busy && workspaceChanged) void saveRef(); }}>
          <Field label="Workspace reference" htmlFor="ref" hint="Optional. A live connection requires authorization from Planned.">
            <div className="flex max-w-lg flex-wrap items-center gap-2">
              <input id="ref" className={cn(inputCls, "h-9 min-w-44 flex-1")} value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} />
              <Button type="submit" size="sm" disabled={busy || !workspaceChanged}>{busy ? "Saving…" : "Save reference"}</Button>
            </div>
          </Field>
        </form>
      </Section>
    </Page>
  );
}
