// Company policy: routing defaults and follow-up settings.
// Spending guardrails are not settings and can't be turned off.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { permsFor } from "../../../src/org.mjs";
import { aget, apost, ApiError, money, type Company, type Diff, type Inbox, type Issue, type Policy } from "./api";
import { Page, useConsole } from "./ConsoleApp";
import { ArrowDownLeftIcon, ArrowUpRightIcon, BadgeCheckIcon, BellIcon, PauseIcon, UsersIcon, ChevronUpIcon, FileTextIcon, PlusIcon, UploadIcon, XIcon, CalendarCheckIcon, CircleCheckIcon, SearchIcon, ChevronDownIcon, ListChecksIcon, LockIcon, MailPlusIcon, UserCheckIcon, type LucideIcon } from "lucide-react";
import { A, ErrorState, FormGroup, Loading, Modal, Notice, PageHeader, Section, inputCls } from "./ui";
import { DRAFTS_CLEARED, dropDraft, loadDraft, saveDraft } from "./drafts";

type PolicyFile = { documentSource?: "upload" | "sample" | null; fileName?: string | null };
type RulesDraft = { policy: Policy } & PolicyFile;

export function PolicyPage() {
  const { toast, session } = useConsole();
  const [co, setCo] = useState<Company | null>(null);
  const [form, setForm] = useState<Policy | null>(null);
  const [policyFile, setPolicyFile] = useState<PolicyFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ errors: Issue[]; diff: Diff | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [proposal, setProposal] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timeoutEdit = session.demo?.current?.timeoutEdit;
  const savedDeadline = timeoutEdit?.after;
  useEffect(() => {
    const get = () => aget("/api/admin/requests").then(setInbox).catch(() => {});
    get(); const t = window.setInterval(get, 3000); return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const c = await aget("/api/admin/company");
      const saved = loadDraft<RulesDraft | Policy>("policy", c);
      const draft: RulesDraft = saved && "policy" in saved ? saved : { policy: saved ?? c.config.policy };
      setCo(c); setForm(draft.policy); setPolicyFile(draft.documentSource ? { documentSource: draft.documentSource, fileName: draft.fileName } : null); setReview(null); setError(null); setConflict(null);
    }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, savedDeadline]);
  useEffect(() => { window.addEventListener(DRAFTS_CLEARED, load); return () => window.removeEventListener(DRAFTS_CLEARED, load); }, [load]);
  const dirty = useMemo(() => !!co && !!form && JSON.stringify(form) !== JSON.stringify(co.config.policy), [co, form]);
  // Keep unsaved edits in this browser until they're saved or discarded.
  useEffect(() => { if (!co || !form) return; if (dirty) saveDraft("policy", co, { policy: form, ...policyFile }); else dropDraft("policy"); }, [co, form, dirty, policyFile]);

  if (error && !co) return <Page><ErrorState error={error} retry={load} /></Page>;
  if (!co || !form) return <Page><Loading /></Page>;

  const people = co.org.people;
  const managers = people.filter((p) => permsFor(p.roles, co.org.roles).includes("manage"));
  const approvers = people.filter((p) => permsFor(p.roles, co.org.roles).includes("approve") && (p.approveUpTo ?? 0) > 0);
  const approver = people.find((p) => p.email === form.defaultFinanceApprover);
  const [lo, hi] = co.config.timeoutRange;
  const holders = (perm: string) => people.filter((p) => permsFor(p.roles, co.org.roles).includes(perm));
  const requesters = holders("request"), deciders = holders("decide");
  const mgrName = people.find((p) => p.email === form.defaultManager)?.name.split(" ")[0] || "the event manager";
  const higher = approvers.filter((p) => approver && (p.approveUpTo ?? 0) > (approver.approveUpTo ?? 0) && p.email !== approver.email);
  const count = (k: string) => inbox?.counts[k] ?? 0;
  const hoursOk = Number.isInteger(Number(form.supplierTimeoutHours)) && Number(form.supplierTimeoutHours) >= lo && Number(form.supplierTimeoutHours) <= hi && /^\d+$/.test(String(form.supplierTimeoutHours));
  const set = (patch: Partial<Policy>) => { setForm({ ...form, ...patch }); setReview(null); };
  const err = (f: string) => review?.errors.find((e) => e.field === f && e.scope === "policy")?.message || null;
  const payload = () => ({ ...form, supplierTimeoutHours: /^\d+$/.test(String(form.supplierTimeoutHours)) ? Number(form.supplierTimeoutHours) : form.supplierTimeoutHours });

  const startReview = async () => {
    setBusy(true); setConflict(null);
    try { const r = await apost("/api/admin/policy/preview", { policy: payload(), expectedVersion: co.config.version }); setReview(r); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { const r = await apost("/api/admin/policy/apply", { policy: payload(), ...policyFile, expectedVersion: co.config.version }); dropDraft("policy"); toast(r.unchanged ? "No changes to save." : "Rules saved."); await load(); }
    catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else if (e instanceof ApiError && e.errors) setReview({ errors: e.errors, diff: null });
      else toast(e.message, "error");
    } finally { setBusy(false); }
  };

  // ---- extra steps (edited in the draft, saved through the same review)
  const flow: FlowStep[] = (form.flow as FlowStep[]) || [];
  const setFlow = (f: FlowStep[]) => set({ flow: f } as any);
  const editStep = (id: string, patch: Partial<FlowStep>) => setFlow(flow.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const tiers = flow.filter((x) => x.kind === "escalate").sort((a, b) => (a.over ?? 0) - (b.over ?? 0));
  const moveStep = (id: string, dir: -1 | 1) => {
    const st = flow.find((x) => x.id === id)!;
    const here = flow.filter((x) => x.kind !== "escalate" && x.after === st.after);
    const i = here.findIndex((x) => x.id === id);
    const rest = flow.filter((x) => x.id !== id);
    if (here[i + dir]) { // swap within the same slot
      const other = here[i + dir]; const j = rest.findIndex((x) => x.id === other.id);
      rest.splice(dir < 0 ? j : j + 1, 0, st); setFlow(rest); return;
    }
    const k = POINTS.indexOf(st.after) + dir; // otherwise hop to the next slot
    if (k < 0 || k >= POINTS.length) return;
    const moved = { ...st, after: POINTS[k] };
    setFlow(dir < 0 ? [...rest, moved] : [moved, ...rest]);
  };
  const after = (point: string, last = false) => {
    const here = flow.filter((x) => x.kind !== "escalate" && x.after === point);
    return (
      <>
        {here.map((st) => (
          <Fragment key={st.id}>
            <Arrow />
            <ExtraStep step={st} people={people} onChange={(patch) => editStep(st.id, patch)} onRemove={() => setFlow(flow.filter((x) => x.id !== st.id))}
              onUp={POINTS.indexOf(st.after) === 0 && here[0].id === st.id ? undefined : () => moveStep(st.id, -1)}
              onDown={POINTS.indexOf(st.after) === POINTS.length - 1 && here.at(-1)!.id === st.id ? undefined : () => moveStep(st.id, 1)} />
          </Fragment>
        ))}
        <AddHere last={last} canHold={point !== "confirmed" && point !== "sourcing"} onAdd={(kind) => setFlow([...flow, { id: newId(), kind, after: point, who: kind === "hold" ? "" : people[0]?.email || "" }])} />
      </>
    );
  };

  // ---- reading a written policy into a proposal
  const readDoc = async (body: any, label: string) => {
    setReading(label);
    try { setProposal(await apost("/api/admin/policy/import", body)); }
    catch (e: any) { toast(e.message, "error"); } finally { setReading(null); }
  };
  const uploadFile = async (f: File) => {
    if (f.size > 15e6) { toast("That file is over 15 MB.", "error"); return; }
    const data = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(f); });
    readDoc({ fileName: f.name, mimeType: f.type || (f.name.endsWith(".pdf") ? "application/pdf" : "text/plain"), data }, f.name);
  };

  return (
    <Page>
      <PageHeader title="Rules" right={<>
        {session.mode === "demo" ? <Button size="sm" variant="outline" disabled={!!reading} onClick={() => readDoc({ sample: true }, "the sample policy")}><FileTextIcon />Try the sample policy</Button> : null}
        <Button size="sm" disabled={!!reading} onClick={() => fileRef.current?.click()}><UploadIcon />Upload a policy</Button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="hidden" aria-label="Policy document" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
      </>} />
      {reading ? <Notice tone="info" role="status">Reading {reading}… This can take up to a minute.</Notice> : null}
      {!managers.length || !approvers.length ? <Notice tone="attn">Add an event manager and a finance approver with a limit on the <A to="/admin/people">People page</A> first.</Notice> : null}
      {conflict ? <Notice tone="attn" role="alert">{conflict} <button className="text-primary hover:underline" onClick={() => { dropDraft("policy"); load(); }}>Reload</button></Notice> : null}

      {/* The path every request takes. Each setting sits on the step it controls; each step shows the live requests on it. */}
      <form onSubmit={(e) => { e.preventDefault(); startReview(); }} className="flex flex-col items-center overflow-x-auto rounded-xl border border-border bg-[var(--console-sidebar)] px-6 py-8">
        <Step n={1} icon={MailPlusIcon} title="Someone emails ccPlannie"
          body={requesters.length ? <>{requesters.length} {requesters.length === 1 ? "person" : "people"} can start a request: <People list={requesters} /></> : <span className="text-[var(--console-attn)]">Nobody can start requests yet.</span>}
          link={{ to: "/admin/people", label: "Change who can" }} />
        {after("received")}
        <Step n={2} icon={UserCheckIcon} title="An event manager takes it" count={count("needs_manager")} filter="needs_manager"
          body={<Inline label="New requests go to" htmlFor="p-mgr" error={err("defaultManager")}>
            <select id="p-mgr" className={cn(inputCls, "h-7 w-full text-[12px]")} value={form.defaultManager || ""} disabled={!managers.length} onChange={(e) => set({ defaultManager: e.target.value })}>
              <option value="" disabled>{managers.length ? "Choose someone" : "No event manager yet"}</option>
              {managers.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
            </select>
          </Inline>} />
        {after("assigned")}
        <Step n={3} icon={SearchIcon} tone="out" title="ccPlannie asks Planned for venues" count={count("waiting_supplier")} filter="waiting_supplier"
          body={<span className="text-muted-foreground">The event manager picks which venues to ask.</span>}
          branches={[
            <Branch key="t" id="venue-reply-deadline" title="A venue doesn't answer" changed={!!timeoutEdit && timeoutEdit.before !== savedDeadline && co.config.policy.supplierTimeoutHours === savedDeadline} error={!hoursOk ? `Enter ${lo} to ${hi} hours.` : err("supplierTimeoutHours")}>
              Remind {mgrName} after
              <input aria-label="Reminder after (hours)" className={cn(inputCls, "tabular mx-1.5 inline-block h-6 w-12 text-right text-[12px]")} inputMode="numeric" value={String(form.supplierTimeoutHours)} aria-invalid={!hoursOk} onChange={(e) => set({ supplierTimeoutHours: e.target.value as any })} />
              hours
              {timeoutEdit && timeoutEdit.before !== savedDeadline && co.config.policy.supplierTimeoutHours === savedDeadline ? (
                <p className="mt-2 w-full font-medium text-primary" role="status">Changed from {timeoutEdit.before} to {savedDeadline} hours</p>
              ) : null}
            </Branch>,
            <Branch key="d" title="The plan changes" error={err("delegatedInquiries")}>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={form.delegatedInquiries} onChange={(e) => set({ delegatedInquiries: e.target.checked })} />
                Ask the venues again automatically
              </label>
            </Branch>,
          ]} />
        {after("sourcing")}
        <Step n={4} icon={ListChecksIcon} title="The requester picks a venue" count={count("waiting_requester")} filter="waiting_requester"
          body={deciders.length ? <>{deciders.length} {deciders.length === 1 ? "person" : "people"} can choose: <People list={deciders} /></> : <span className="text-[var(--console-attn)]">Nobody can choose a venue yet.</span>}
          link={{ to: "/admin/people", label: "Change who can" }} />
        {after("chosen")}
        <Step n={5} icon={BadgeCheckIcon} title="Finance approves the exact amount" count={count("waiting_finance")} filter="waiting_finance"
          body={<Inline label="Approvals go to" htmlFor="p-fin" error={err("defaultFinanceApprover")}>
            <select id="p-fin" className={cn(inputCls, "h-7 w-full text-[12px]")} value={form.defaultFinanceApprover || ""} disabled={!approvers.length} onChange={(e) => set({ defaultFinanceApprover: e.target.value })}>
              <option value="" disabled>{approvers.length ? "Choose someone" : "No approver yet"}</option>
              {approvers.map((m) => <option key={m.email} value={m.email}>{m.name} · up to {money(m.approveUpTo, co.config.currency)}</option>)}
            </select>
          </Inline>}
          branches={approver ? [
            ...tiers.map((t) => (
              <Branch key={t.id} title={`It's over`} onRemove={() => setFlow(flow.filter((x) => x.id !== t.id))}>
                <input aria-label="Amount" className={cn(inputCls, "tabular mx-1 inline-block h-6 w-24 text-right text-[12px]")} inputMode="numeric" value={String(t.over ?? "")} onChange={(e) => editStep(t.id, { over: e.target.value.replace(/[^\d]/g, "") as any })} />
                <span className="mr-1">{co.config.currency}, it goes to</span>
                <select aria-label="Approver" className={cn(inputCls, "mt-1 h-6 w-full text-[12px]")} value={t.who} onChange={(e) => editStep(t.id, { who: e.target.value })}>
                  {approvers.map((m) => <option key={m.email} value={m.email}>{m.name} · up to {money(m.approveUpTo, co.config.currency)}</option>)}
                </select>
              </Branch>
            )),
            !tiers.length ? (
              <Branch key="o" title={`It's over ${money(approver.approveUpTo, co.config.currency)}`}>
                {higher.length ? <>An admin reassigns it on the request page.</> : <span className="text-[var(--console-attn)]">Nobody has a higher limit. <A to="/admin/people">Raise a limit</A></span>}
              </Branch>
            ) : null,
            higher.length ? <button key="add" type="button" onClick={() => setFlow([...flow, { id: newId(), kind: "escalate", after: "chosen", who: higher[0].email, over: approver.approveUpTo ?? 0 }])}
              className="inline-flex items-center gap-1 self-start rounded-full px-2 py-1 text-[11.5px] text-primary hover:bg-[var(--console-row-hover)]"><PlusIcon className="size-3" />Send big amounts to someone else</button> : null,
          ].filter(Boolean) as React.ReactNode[] : undefined} />
        {after("approved")}
        <Step n={6} icon={CalendarCheckIcon} tone="out" title="The event manager books it with Planned" locked
          body={<span className="text-muted-foreground">Only with the exact approved terms. Always on.</span>} />
        {after("booking")}
        <Step n={7} icon={CircleCheckIcon} tone="in" title="Planned confirms. It's booked." count={count("confirmed")} filter="confirmed" locked
          body={<span className="text-muted-foreground">Nothing counts as booked before this. Always on.</span>} />
        {after("confirmed", true)}
      </form>

      {dirty && !review ? (
        <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] backdrop-blur" role="region" aria-label="Unsaved changes">
          <span className="flex-1 text-[13px]">You have unsaved changes.</span>
          <Button size="sm" variant="ghost" onClick={() => { setForm(co.config.policy); setPolicyFile(null); setReview(null); }} disabled={busy}>Discard</Button>
          <Button size="sm" onClick={startReview} disabled={busy || !hoursOk}>Review changes</Button>
        </div>
      ) : null}

      {proposal ? (
        <Modal open wide onClose={() => setProposal(null)} title={`Rules from ${proposal.fileName || "your document"}`}
          description={proposal.source === "sample" ? (proposal.fallbackReason ? "The AI model was too busy, so this is a recorded reading of the sample document." : "No AI key is set, so this is a recorded reading of the sample document.") : `Read by ${proposal.model}. Check it before using it; nothing is saved yet.`}
          footer={<>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setProposal(null)}>Cancel</Button>
            <Button size="sm" disabled={!proposal.diff?.policy.length} onClick={() => { setForm(proposal.policy); setPolicyFile({ documentSource: proposal.documentSource ?? null, fileName: proposal.fileName }); setProposal(null); toast("Rules loaded into the chart. Review and save when ready."); }}>Use these rules</Button>
          </>}>
          <div className="flex flex-col gap-5 text-[13px]">
            {proposal.errors?.filter((e: Issue) => e.scope === "policy" || !e.field).map((e: Issue, i: number) => <Notice key={i} tone="block">{e.message}</Notice>)}
            <FormGroup title="What changes">
              {proposal.diff?.policy.length ? <ul className="flex flex-col gap-1.5">{proposal.diff.policy.map((c: any) => <li key={c.key}><span className="font-medium">{LABEL[c.key] || c.label}:</span> <span className="text-muted-foreground">{fmt(c.key, c.before, people)} → </span>{fmt(c.key, c.after, people)}</li>)}</ul> : <p className="text-muted-foreground">The document matches your current rules.</p>}
            </FormGroup>
            {proposal.notCovered?.length ? (
              <FormGroup title="Not turned into rules">
                <ul className="flex flex-col gap-1 text-muted-foreground">{proposal.notCovered.map((t: string) => <li key={t}>{t}</li>)}</ul>
              </FormGroup>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {review ? (
        <Modal open onClose={() => setReview(null)} title="Review changes" description="Applies to the next email or action, including requests in progress."
          footer={<>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setReview(null)}>Back</Button>
            <Button size="sm" onClick={save} disabled={busy || !review.diff || !review.diff.policy.length}>Save</Button>
          </>}>
          <div className="flex flex-col gap-3 text-[13px]">
            {review.errors.filter((e) => e.scope === "policy" || !e.field).map((e, i) => <Notice key={i} tone="block">{e.message}</Notice>)}
            {review.diff ? (review.diff.policy.length ? (
              <ul className="flex flex-col gap-1">{review.diff.policy.map((c) => <li key={c.key}><span className="font-medium">{LABEL[c.key] || c.label}:</span> <span className="text-muted-foreground">{fmt(c.key, c.before, people)} → </span>{fmt(c.key, c.after, people)}</li>)}</ul>
            ) : <p className="text-muted-foreground">No changes.</p>) : null}
            {review.diff?.affected.length ? <div><h3 className="mb-1 text-[12px] font-semibold">Requests affected</h3><ul className="flex flex-col gap-1 text-muted-foreground">{review.diff.affected.flatMap((a) => a.items.map((t) => <li key={a.title + t}>{a.eventId ? `${a.title} (${a.eventId}): ` : ""}{t}</li>))}</ul></div> : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

const LABEL: Record<string, string> = { flow: "Extra steps", defaultManager: "New requests go to", defaultFinanceApprover: "Spending approvals go to", delegatedInquiries: "Ask venues again when the plan changes", supplierTimeoutHours: "Remind the event manager after" };

// ---- flowchart pieces

// Same visual language as the People org chart: tinted canvas, white cards, round gray icon, thin gray links.
const Arrow = () => (
  <div aria-hidden className="grid w-full max-w-[44rem] grid-cols-1 lg:grid-cols-[26rem_2rem_16rem]">
    <span className="mx-auto h-6 w-px bg-border" />
  </div>
);

function Step({ n, icon: Icon, title, body, count, filter, link, branches, locked, tone }: {
  n: number; icon: LucideIcon; title: string; body: React.ReactNode; count?: number; filter?: string; link?: { to: string; label: string }; branches?: React.ReactNode[]; locked?: boolean; tone?: "in" | "out";
}) {
  const color = tone === "out" ? "var(--planned-out)" : tone === "in" ? "var(--planned-in)" : undefined;
  return (
    <div className="grid w-full max-w-[44rem] grid-cols-1 items-stretch gap-3 lg:grid-cols-[26rem_2rem_16rem] lg:gap-0">
      <div className="flex flex-col items-center">
      {/* The link keeps running past a step when its side boxes make the row taller. */}
      <span aria-hidden className="w-px flex-1 bg-border" />
      <section className="w-full rounded-[10px] border border-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--m-fill)] text-foreground"><Icon className="size-3.5" strokeWidth={1.8} /></span>
          <div className="min-w-0 flex-1 leading-[1.25]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold">{title}</h2>
              {locked ? <LockIcon aria-label="Always on" className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.8} /> : null}
            </div>
            {tone ? (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px]" style={{ color }}>
                {tone === "out" ? <ArrowUpRightIcon aria-hidden className="size-3" strokeWidth={1.7} /> : <ArrowDownLeftIcon aria-hidden className="size-3" strokeWidth={1.7} />}{tone === "out" ? "To Planned" : "From Planned"}
              </span>
            ) : null}
            <div className="mt-1 text-[11.5px] text-muted-foreground">{body}</div>
            {count || link ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                {count && filter ? <A to={`/admin/requests?filter=${filter}`} className="inline-flex items-center gap-1.5 font-medium"><span className="size-[6px] rounded-full bg-[var(--console-info)]" />{count} request{count === 1 ? "" : "s"} here now</A> : null}
                {link ? <A to={link.to}>{link.label}</A> : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <span aria-hidden className="w-px flex-1 bg-border" />
      </div>
      {branches?.length ? (
        <>
          <span aria-hidden className="hidden h-px w-full self-center bg-border lg:block" />
          <div className="flex flex-col gap-2 self-center">{branches}</div>
        </>
      ) : null}
    </div>
  );
}

const Branch = ({ id, title, error, children, changed, onRemove }: { id?: string; title: string; error?: string | null; children: React.ReactNode; changed?: boolean; onRemove?: () => void }) => (
  <div id={id} className={cn("rounded-[10px] border border-border bg-card px-3 py-2.5 text-[11.5px] leading-[1.3]", changed && "border-primary ring-1 ring-primary")}>
    <div className="mb-1 flex items-center justify-between gap-2 text-[12px] font-semibold">If {title.charAt(0).toLowerCase() + title.slice(1)}{onRemove ? <button type="button" aria-label="Remove" onClick={onRemove} className="text-muted-foreground hover:text-foreground"><XIcon className="size-3.5" /></button> : null}</div>
    <div className="flex flex-wrap items-center text-muted-foreground">{children}</div>
    {error ? <p className="mt-1 text-destructive" role="alert">{error}</p> : null}
  </div>
);

// ---- extra steps

type FlowStep = { id: string; kind: "notify" | "loopin" | "hold" | "escalate"; after: string; who: string; over?: number | null };
// What each added step does, in one line. All three are enforced by ccPlannie.
const KINDS = {
  notify: { title: "Email someone an update", hint: "One FYI email when a request gets here. No say over it.", icon: "bell" },
  loopin: { title: "Copy someone from here on", hint: "They're copied on every email about the request after this.", icon: "users" },
  hold: { title: "Hold for a check", hint: "ccPlannie pauses here until someone resumes it on the request page.", icon: "pause" },
} as const;
const POINTS = ["received", "assigned", "sourcing", "chosen", "approved", "booking", "confirmed"];
const POINT_LABEL: Record<string, string> = { received: "Someone emails ccPlannie", assigned: "An event manager takes it", sourcing: "ccPlannie asks Planned for venues", chosen: "The requester picks a venue", approved: "Finance approves the exact amount", booking: "The event manager books it with Planned", confirmed: "Planned confirms" };
const newId = () => `s-${Math.random().toString(36).slice(2, 8)}`;

// A step the company added: an FYI email to someone. Grants no powers; can move up and down the path.
function ExtraStep({ step, people, onChange, onRemove, onUp, onDown }: { step: FlowStep; people: { email: string; name: string }[]; onChange: (p: Partial<FlowStep>) => void; onRemove: () => void; onUp?: () => void; onDown?: () => void }) {
  const icon = "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground disabled:opacity-30";
  return (
    <div className="grid w-full max-w-[44rem] grid-cols-1 lg:grid-cols-[26rem_2rem_16rem]">
      <section className="w-full rounded-[10px] border border-dashed border-[var(--input)] bg-card px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--m-fill)]"><KindIcon kind={step.kind} /></span>
          <div className="min-w-0 flex-1 text-[12px]">
            <div className="text-[13px] font-semibold">{KINDS[step.kind as keyof typeof KINDS].title}</div>
            {step.kind !== "hold" ? (
              <select aria-label="Who" className={cn(inputCls, "mt-1 h-7 w-full text-[12px]")} value={step.who} onChange={(e) => onChange({ who: e.target.value })}>
                {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
              </select>
            ) : null}
            <p className="mt-1 text-[11.5px] text-muted-foreground">{KINDS[step.kind as keyof typeof KINDS].hint}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center">
            <button type="button" className={icon} aria-label="Move up" disabled={!onUp} onClick={onUp}><ChevronUpIcon className="size-3.5" /></button>
            <button type="button" className={icon} aria-label="Remove step" onClick={onRemove}><XIcon className="size-3.5" /></button>
            <button type="button" className={icon} aria-label="Move down" disabled={!onDown} onClick={onDown}><ChevronDownIcon className="size-3.5" /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

// The link between two steps, with a "+" that offers the steps you can add there.
function AddHere({ onAdd, last, canHold }: { onAdd: (kind: "notify" | "loopin" | "hold") => void; last?: boolean; canHold?: boolean }) {
  const [open, setOpen] = useState(false);
  const kinds = (Object.keys(KINDS) as (keyof typeof KINDS)[]).filter((k) => k !== "hold" || canHold);
  return (
    <div className="grid w-full max-w-[44rem] grid-cols-1 lg:grid-cols-[26rem_2rem_16rem]">
      <div className="relative flex flex-col items-center">
        <div className="group relative flex h-9 w-full justify-center">
          {!last || open ? <span aria-hidden className="h-full w-px bg-border" /> : null}
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Add a step here" title="Add a step here"
            className={cn("absolute grid size-5 place-items-center rounded-full border bg-card transition", open ? "border-[var(--primary)] text-foreground" : "border-border text-muted-foreground opacity-60 hover:border-[var(--primary)] hover:text-foreground hover:opacity-100 group-hover:opacity-100", last && !open ? "top-2" : "top-1/2 -translate-y-1/2")}>
            {open ? <XIcon className="size-3" strokeWidth={2} /> : <PlusIcon className="size-3" strokeWidth={2} />}
          </button>
        </div>
        {open ? (
          <div role="menu" className="mb-2 w-full overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            {kinds.map((k) => (
              <button key={k} role="menuitem" type="button" onClick={() => { onAdd(k); setOpen(false); }}
                className="flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--console-row-hover)]">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--m-fill)]"><KindIcon kind={k} small /></span>
                <span className="min-w-0"><span className="block text-[12.5px] font-medium">{KINDS[k].title}</span><span className="block text-[11.5px] text-muted-foreground">{KINDS[k].hint}</span></span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const KindIcon = ({ kind, small }: { kind: string; small?: boolean }) => {
  const I = kind === "loopin" ? UsersIcon : kind === "hold" ? PauseIcon : BellIcon;
  return <I className={small ? "size-3" : "size-3.5"} strokeWidth={1.8} />;
};

const Inline = ({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string | null; children: React.ReactNode }) => (
  <div className="mt-1 flex flex-col gap-1">
    <label htmlFor={htmlFor}>{label}</label>{children}
    {error ? <p className="basis-full text-[12px] text-destructive" role="alert">{error}</p> : null}
  </div>
);

const People = ({ list }: { list: { name: string }[] }) => {
  const shown = list.slice(0, 3).map((p) => p.name.split(" ")[0]);
  return <span className="text-foreground">{shown.join(", ")}{list.length > 3 ? ` and ${list.length - 3} more` : ""}</span>;
};

function fmt(key: string, v: any, people: { email: string; name: string }[]) {
  const nm = (e: string) => people.find((p) => p.email === e)?.name || e;
  if (key === "flow") return !v?.length ? "none" : v.map((x: FlowStep) => x.kind === "escalate" ? `over ${Number(x.over).toLocaleString("en-US")} → ${nm(x.who)}` : x.kind === "hold" ? `hold for a check after “${POINT_LABEL[x.after]}”` : x.kind === "loopin" ? `copy ${nm(x.who)} after “${POINT_LABEL[x.after]}”` : `email ${nm(x.who)} after “${POINT_LABEL[x.after]}”`).join("; ");
  if (key === "delegatedInquiries") return v ? "On" : "Off";
  if (key === "defaultManager" || key === "defaultFinanceApprover") return people.find((p) => p.email === v)?.name || v || "none";
  if (key === "supplierTimeoutHours") return `${v} hours`;
  return v ? `“${v}”` : "—";
}
