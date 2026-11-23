// People and email-based authority. Edit in the browser or import a CSV; both go through the same
// server-side validation, the same review, and one versioned, audited save.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, PlusIcon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { RolesEditor, type Roles } from "./Roles";
import { OrgChart } from "./OrgChart";
import { navigate } from "@/lib/router";
import { DRAFTS_CLEARED, dropDraft, loadDraft, saveDraft } from "./drafts";
import { aget, apost, ApiError, money, type Company, type Diff, type Issue, type Permission, type Person } from "./api";
import { Page, useConsole } from "./ConsoleApp";
import { A, ErrorState, Field, FormGroup, Loading, Modal, Notice, PageHeader, PermTag, Section, inputCls } from "./ui";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const LIMIT = /^(?:[A-Za-z]{3}\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/;
type Draft = Person & { _key: string; _orig: string | null };
type Review = { kind: "edit" | "csv"; errors: Issue[]; warnings: Issue[]; diff: Diff | null; csv?: string; fileName?: string; version: number };

const toDraft = (p: Person, i: number): Draft => ({ ...p, title: p.title || "", manager: p.manager || null, backup: p.backup || null, approveUpTo: p.approveUpTo ?? null, _key: `${p.email}#${i}`, _orig: p.email });
const stripRoles = (r: Company["org"]["roles"]): Roles => Object.fromEntries(Object.entries(r).map(([id, x]) => [id, { label: x.label, summary: x.summary, permissions: [...x.permissions] }]));
const holdsPerm = (p: Person, roles: Roles, perm: string) => p.roles.some((r) => roles[r]?.permissions.includes(perm));
const strip = ({ _key, _orig, caps, ...p }: Draft) => ({ ...p, email: p.email.trim().toLowerCase(), approveUpTo: p.approveUpTo === null || (p.approveUpTo as any) === "" ? null : p.approveUpTo });

export function People() {
  const { toast, session } = useConsole();
  const [co, setCo] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [roleDraft, setRoleDraft] = useState<Roles | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  // Arriving from a held email (Requests → "Add to People" / "Change their role"): open the right dialog,
  // and after the save, retry that email so the request opens without another click.
  const [fromHeld] = useState(() => {
    const q = new URLSearchParams(location.search);
    return { add: q.get("add"), edit: q.get("edit"), held: q.get("held"), subject: q.get("subject") };
  });
  const consumed = useRef(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const c = await aget("/api/admin/company");
      // Unsaved edits from before a reload come back, as long as nothing has been saved since.
      const kept = loadDraft<{ people: Draft[]; roles: Roles }>("people", c);
      setCo(c); setDraft(kept?.people ?? c.org.people.map(toDraft)); setRoleDraft(kept?.roles ?? stripRoles(c.org.roles)); setError(null); setReview(null); setEditing(null);
    }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener(DRAFTS_CLEARED, load); return () => window.removeEventListener(DRAFTS_CLEARED, load); }, [load]);

  const dirty = useMemo(() => !!co && !!draft && !!roleDraft && (JSON.stringify(draft.map(strip)) !== JSON.stringify(co.org.people.map((p, i) => strip(toDraft(p, i)))) || JSON.stringify(roleDraft) !== JSON.stringify(stripRoles(co.org.roles))), [co, draft, roleDraft]);
  // Keep unsaved edits in this browser until they're saved or discarded.
  useEffect(() => { if (!co || !draft || !roleDraft) return; if (dirty) saveDraft("people", co, { people: draft, roles: roleDraft }); else dropDraft("people"); }, [co, draft, roleDraft, dirty]);
  const discard = () => { dropDraft("people"); load(); };
  // Leaving with unsaved edits asks first.
  useEffect(() => { const on = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", on); return () => window.removeEventListener("beforeunload", on); }, [dirty]);
  // In the demo, follow the story (e.g. a promotion or a new hire) — but never over an edit in progress.
  useEffect(() => {
    if (consumed.current || !co || !draft || !roleDraft) return;
    consumed.current = true;
    if (fromHeld.add || fromHeld.edit) history.replaceState(history.state, "", "/admin/people");
    const email = (fromHeld.add || fromHeld.edit || "").toLowerCase();
    if (!email) return;
    const existing = draft.find((p) => p.email.trim().toLowerCase() === email);
    if (existing) { setEditing(existing._key); return; }
    if (fromHeld.add) {
      const key = `new#${Date.now()}`;
      const guess = email.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      const requester = Object.keys(roleDraft).find((id) => roleDraft[id].permissions.length === 1 && roleDraft[id].permissions[0] === "request")
        || Object.keys(roleDraft).find((id) => roleDraft[id].permissions.includes("request") && !roleDraft[id].permissions.includes("manage") && !roleDraft[id].permissions.includes("approve"));
      setDraft((d) => [...d!, { name: guess, email, title: "", manager: null, roles: requester ? [requester] : [], approveUpTo: null, backup: null, _key: key, _orig: null }]);
      setEditing(key);
    }
  }, [co, draft, roleDraft, fromHeld]);
  const [heldPending, setHeldPending] = useState(() => fromHeld.held);

  const quiet = !dirty && !editing && !review && !busy;
  const version = co?.config.version;
  const demoStep = session.demo?.current?.key;
  useEffect(() => {
    if (session.mode !== "demo" || !quiet || version === undefined) return;
    let active = true;
    const refresh = async () => {
      try {
        const c = await aget("/api/admin/company");
        if (active && c.config.version !== version) { setCo(c); setDraft(c.org.people.map(toDraft)); setRoleDraft(stripRoles(c.org.roles)); }
      } catch { /* keep showing the last loaded version */ }
    };
    void refresh();
    const t = window.setInterval(refresh, 2500);
    return () => { active = false; window.clearInterval(t); };
  }, [session.mode, demoStep, quiet, version]);

  if (error && !co) return <Page><ErrorState error={error} retry={load} /></Page>;
  if (!co || !draft || !roleDraft) return <Page><Loading /></Page>;
  const roles = roleDraft;
  const perms = co.org.permissions;
  const policy = co.config.policy;

  const update = (key: string, patch: Partial<Draft>) => setDraft((d) => {
    const list = d!.map((p) => (p._key === key ? { ...p, ...patch } : p));
    // An email change is an identity change: keep reporting lines and backups pointing at the same person.
    const before = d!.find((p) => p._key === key)!;
    if (patch.email !== undefined && before.email !== patch.email) {
      const from = before.email, to = patch.email.trim().toLowerCase();
      return list.map((p) => ({ ...p, manager: p.manager === from ? to : p.manager, backup: p.backup === from ? to : p.backup }));
    }
    return list;
  });
  const add = () => {
    const key = `new#${Date.now()}`;
    setDraft((d) => [...d!, { name: "", email: "", title: "", manager: null, roles: roles.stakeholder ? ["stakeholder"] : Object.keys(roles).filter((r) => !roles[r].permissions.length).slice(0, 1), approveUpTo: null, backup: null, _key: key, _orig: null }]);
    setEditing(key); setReview(null);
  };
  const remove = (key: string) => { setDraft((d) => d!.filter((p) => p._key !== key)); setEditing(null); setReview(null); };

  const renames = draft.filter((p) => p._orig && p._orig !== p.email.trim().toLowerCase()).map((p) => ({ from: p._orig!, to: p.email.trim().toLowerCase() }));
  const startReview = async () => {
    setBusy(true); setConflict(null);
    // Fix the common slip before asking the server: anyone left without a role gets the company's
    // suggest-only role (the review shows it), instead of an error.
    const basic = Object.keys(roles).find((id) => !roles[id].permissions.length);
    const fixed = basic && draft.some((p) => !p.roles.length) ? draft.map((p) => (p.roles.length ? p : { ...p, roles: [basic] })) : draft;
    if (fixed !== draft) { setDraft(fixed); toast(`Gave “${roles[basic!].label}” to ${draft.filter((p) => !p.roles.length).length === 1 ? "the person" : "people"} without a role.`); }
    try { const r = await apost("/api/admin/people/preview", { people: fixed.map(strip), roles, renames, expectedVersion: co.config.version }); setReview({ kind: "edit", ...r }); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const readCsv = async (f: File) => {
    if (f.size > 2_000_000) return toast("That file is too large for an org chart (2 MB max).", "error");
    setBusy(true); setConflict(null);
    try { const csv = await f.text(); const r = await apost("/api/admin/csv/preview", { csv }); setReview({ kind: "csv", errors: r.errors, warnings: r.warnings, diff: r.diff, csv, fileName: f.name, version: co.config.version }); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const r = review.kind === "csv"
        ? await apost("/api/admin/csv/apply", { csv: review.csv, fileName: review.fileName, expectedVersion: co.config.version })
        : await apost("/api/admin/people/apply", { people: draft.map(strip), roles, renames, expectedVersion: co.config.version });
      dropDraft("people");
      if (heldPending && !r.unchanged) {
        // Retry the held email now that the directory changed.
        try {
          const x = await apost(`/api/admin/intake/${heldPending}/reprocess`);
          setHeldPending(null);
          if (x.eventId) { toast(`Saved. The held email opened request ${x.eventId}.`); navigate(`/admin/requests/${encodeURIComponent(x.eventId)}`); return; }
          toast("Saved. The email is still held: this person's roles can't start requests.", "error");
        } catch (e: any) { toast(`Saved, but the held email couldn't be retried: ${e.message}`, "error"); }
      } else toast(r.unchanged ? "No changes to save." : "Saved. ccPlannie uses it for the next email or action.");
      await load();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else if (e instanceof ApiError && e.errors) setReview({ ...review, errors: e.errors, diff: null });
      else toast(e.message, "error");
    } finally { setBusy(false); }
  };

  const errorsFor = (p: Draft) => (review?.kind === "edit" ? review.errors.filter((e) => e.email === p.email.trim().toLowerCase() || (e.index != null && draft[e.index]?._key === p._key)) : []);
  const people = draft;
  const editingPerson = editing ? people.find((p) => p._key === editing) || null : null;
  const editingIsDefault = !!editingPerson && (policy.defaultManager === editingPerson._orig || policy.defaultFinanceApprover === editingPerson._orig);

  return (
    <Page>
      <PageHeader title="People"
        right={<>
          <Button size="sm" variant="outline" nativeButton={false} render={<a href="/api/admin/csv" download />}><DownloadIcon />{co.org.people.length ? "Download CSV" : "Download CSV template"}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}><UploadIcon />Import CSV…</Button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) readCsv(f); e.target.value = ""; }} />
          <Button size="sm" onClick={add} disabled={busy}><PlusIcon />Add person</Button>
        </>} />

      {co.org.people.length === 0 && people.length === 0 ? (
        <Notice tone="info">Add people individually or import a CSV. Start with someone who can run events and someone who can approve spending with a limit. Then confirm the defaults on the <A to="/admin/policy">Rules page</A>.</Notice>
      ) : null}

      {heldPending ? (
        <Notice tone="info">
          {fromHeld.add ? "Adding" : "Updating"} <span className="font-medium">{fromHeld.add || fromHeld.edit}</span> from a held email{fromHeld.subject ? <> (“{fromHeld.subject}”)</> : null}. Give them a role that can start requests, then review and save: ccPlannie retries the email right after.{" "}
          <button className="text-primary hover:underline" onClick={() => setHeldPending(null)}>Don't retry</button>
        </Notice>
      ) : null}
      {conflict ? <Notice tone="attn" role="alert">{conflict} <button className="text-primary hover:underline" onClick={discard}>Reload the latest version</button> (your unsaved edits will be discarded).</Notice> : null}

      {review ? <ReviewPanel review={review} busy={busy} onApply={apply} onCancel={() => setReview(null)} /> : null}

      {people.length ? <OrgChart people={people} roles={roles} perms={perms} currency={co.config.currency} focusEmail={session.demo?.current?.focusPerson} onEdit={(k) => { setEditing(k); setReview(null); }} /> : null}

      <Section title={`People (${people.length})`}>
        <ul className="divide-y divide-border border-y border-border">
          {people.map((p) => (
            <li key={p._key}>
              <PersonRow p={p} all={people} roles={roles} perms={perms} currency={co.config.currency} policy={policy} errors={errorsFor(p)} onEdit={() => setEditing(p._key)} />
            </li>
          ))}
        </ul>
      </Section>

      {editingPerson ? (
        <Modal open onClose={() => setEditing(null)} title={editingPerson.name.trim() || "New person"} description="Edits are a draft until you review and save."
          footer={<>
            <Button size="sm" variant="destructive" onClick={() => remove(editingPerson._key)} disabled={editingIsDefault} title={editingIsDefault ? "Choose another default on the Rules page first" : undefined}>Remove person</Button>
            {editingIsDefault ? <span className="text-[12px] text-muted-foreground">Named on the Rules page; change it there first.</span> : null}
            <Button size="sm" className="ml-auto" onClick={() => setEditing(null)}>Done</Button>
          </>}>
          <Editor key={editingPerson._key} p={editingPerson} all={people} roles={roles} perms={perms} currency={co.config.currency} serverErrors={errorsFor(editingPerson)} onChange={(patch) => { update(editingPerson._key, patch); setReview(null); }} />
        </Modal>
      ) : null}

      <RolesEditor roles={roles} permissions={perms} people={draft} onChange={(r) => { setRoleDraft(r); setReview(null); }}
        errors={review?.kind === "edit" ? review.errors.filter((e) => !e.email && (e as any).role).map((e) => e.message) : []} />

      {dirty && !review ? (
        // Floats at the bottom of the window while you scroll, clear of the headings it would otherwise cover.
        <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] backdrop-blur" role="region" aria-label="Unsaved changes">
          <span className="flex-1 text-[13px]">You have unsaved changes. Nothing takes effect until you review and save.</span>
          <Button size="sm" variant="ghost" onClick={discard} disabled={busy}>Discard</Button>
          <Button size="sm" onClick={startReview} disabled={busy}>Review changes</Button>
        </div>
      ) : null}

    </Page>
  );
}

function effective(p: Person, roles: Roles, perms: Permission[], currency: string) {
  const held = perms.filter((x) => holdsPerm(p, roles, x.id));
  return held.length ? held.map((x) => (x.id === "approve" ? (p.approveUpTo == null ? `${x.label} (no limit set yet)` : `${x.label} up to ${money(p.approveUpTo, currency)}`) : x.label)) : ["Suggest changes only"];
}

function PersonRow({ p, all, roles, perms, currency, policy, errors, onEdit }: { p: Draft; all: Draft[]; roles: Roles; perms: Permission[]; currency: string; policy: any; errors: Issue[]; onEdit: () => void }) {
  const name = (e: string | null) => all.find((x) => x.email === e)?.name || e;
  const eff = effective(p, roles, perms, currency);
  const tags = [policy.defaultManager === p.email && "default request-routing manager", policy.defaultFinanceApprover === p.email && "default finance approver"].filter(Boolean);
  return (
    <div className="grid gap-x-6 gap-y-2 px-1 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{p.name || <span className="text-muted-foreground">Unnamed</span>} <span className="font-normal text-muted-foreground">{p.title ? `· ${p.title}` : ""}</span></div>
        <div className="break-all font-mono text-[12px]">{p.email || "no email"}</div>
        <div className="text-[12px] text-muted-foreground">{[p.manager ? `Reports to ${name(p.manager)}` : null, p.backup ? `Backup contact: ${name(p.backup)}` : null].filter(Boolean).join(" · ") || "No manager"}</div>
        {tags.length ? <div className="text-[12px] text-muted-foreground">Policy: {tags.join(", ")}</div> : null}
      </div>
      <div className="min-w-0 text-[12px]">
        <div className="font-medium">{p.roles.map((r) => roles[r]?.label || r).join(", ") || "No role"}</div>
        <ul className="mt-0.5 text-muted-foreground">{eff.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <div className="flex items-start justify-end"><Button size="sm" variant="outline" onClick={onEdit} aria-label={`Edit ${p.name || p.email}`}>Edit</Button></div>
      {errors.length ? <ul className="md:col-span-3">{errors.map((e, i) => <li key={i} className="text-[12px] text-destructive">{e.message}</li>)}</ul> : null}
    </div>
  );
}

function Editor({ p, all, roles, perms, currency, serverErrors, onChange }: { p: Draft; all: Draft[]; roles: Roles; perms: Permission[]; currency: string; serverErrors: Issue[]; onChange: (x: Partial<Draft>) => void }) {
  const [limitText, setLimitText] = useState(p.approveUpTo == null ? "" : String(p.approveUpTo));
  const id = p._key.replace(/[^a-z0-9]/gi, "");
  const email = p.email.trim().toLowerCase();
  const approves = holdsPerm(p, roles, "approve");
  const local = {
    name: !p.name.trim() ? "Enter a name." : null,
    email: !EMAIL.test(email) ? "Enter a valid email address." : all.some((x) => x._key !== p._key && x.email.trim().toLowerCase() === email) ? "Someone else already has this email." : null,
    roles: !p.roles.length ? "Choose at least one role (a role with no permissions can only suggest)." : null,
    limit: approves ? (!limitText.trim() ? "People who approve spending need an approval limit." : !LIMIT.test(limitText.trim()) || Number(limitText.replace(/[^\d.]/g, "")) <= 0 ? "Use a positive amount like 75000 or 75,000. Negative or malformed amounts are rejected." : null) : null,
  };
  const server = (f: string) => serverErrors.find((e) => e.field === f)?.message || null;
  const others = all.filter((x) => x._key !== p._key && x.email);
  const renamed = p._orig && p._orig !== email;
  const setLimit = (t: string) => {
    setLimitText(t);
    const ok = LIMIT.test(t.trim());
    onChange({ approveUpTo: t.trim() === "" ? null : ok ? (Number(t.trim().replace(/^[A-Za-z]{3}\s*/, "").replace(/,/g, "")) as any) : (t as any) });
  };
  return (
    <div className="flex flex-col gap-6" role="group" aria-label={`Editing ${p.name || "new person"}`}>
      <FormGroup title="Details">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Name" htmlFor={`n-${id}`} error={local.name || server("name")}><input id={`n-${id}`} className={inputCls} value={p.name} aria-invalid={!!(local.name || server("name"))} onChange={(e) => onChange({ name: e.target.value })} autoFocus /></Field>
          <Field label="Title" htmlFor={`t-${id}`} hint="Shown to people. Grants no powers." error={server("title")}><input id={`t-${id}`} className={inputCls} value={p.title} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="Email" htmlFor={`e-${id}`} error={local.email || server("email")} hint={renamed ? undefined : "ccPlannie only trusts mail from this exact address."}>
            <input id={`e-${id}`} className={inputCls} value={p.email} inputMode="email" autoComplete="off" spellCheck={false} aria-invalid={!!(local.email || server("email"))} onChange={(e) => onChange({ email: e.target.value })} />
          </Field>
          <Field label="Reports to" htmlFor={`m-${id}`} hint="For the org chart only. Grants no powers." error={server("manager")}>
            <select id={`m-${id}`} className={inputCls} value={p.manager || ""} onChange={(e) => onChange({ manager: e.target.value || null })}>
              <option value="">Nobody</option>{others.map((x) => <option key={x._key} value={x.email}>{x.name || x.email}</option>)}
            </select>
          </Field>
        </div>
        {renamed ? <Notice tone="attn" className="mt-3">Identity change: {p._orig} → {email || "…"}. Mail from {p._orig} will no longer carry any powers. Requests owned by, and approvals assigned to, the old address stay as recorded and show as blocked until an administrator reassigns them.</Notice> : null}
      </FormGroup>

      <FormGroup title="Roles" aside={`${p.roles.length} selected`}>
        <fieldset>
          <legend className="sr-only">Roles</legend>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {Object.keys(roles).map((r) => {
              const on = p.roles.includes(r);
              const held = perms.filter((x) => roles[r].permissions.includes(x.id));
              return (
                <li key={r}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] transition-colors", on ? "bg-[var(--console-selected)]" : "hover:bg-[var(--console-row-hover)]")}>
                    <input type="checkbox" checked={on} onChange={(e) => onChange({ roles: e.target.checked ? [...p.roles, r] : p.roles.filter((x) => x !== r) })} />
                    <span className="min-w-0 flex-1 font-medium">{roles[r].label}</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {held.length ? held.map((x) => <PermTag key={x.id}>{x.label}</PermTag>) : <span className="text-[12px] text-muted-foreground">Suggest only</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {local.roles || server("roles") ? <p className="mt-1.5 text-[12px] text-destructive" role="alert">{local.roles || server("roles")}</p> : null}
        </fieldset>
      </FormGroup>

      <FormGroup title="Spending and backup">
        <div className="grid items-start gap-x-4 gap-y-3 sm:grid-cols-2">
          {approves ? (
            <Field label={`Approval limit (${currency})`} htmlFor={`l-${id}`} error={local.limit || server("approveUpTo")} hint="The most they can approve on one request.">
              <input id={`l-${id}`} className={cn(inputCls, "tabular")} value={limitText} inputMode="decimal" aria-invalid={!!(local.limit || server("approveUpTo"))} onChange={(e) => setLimit(e.target.value)} placeholder="100,000" />
            </Field>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">Approval limit</span>
              <p className="flex h-8 items-center rounded-md bg-[var(--console-row-hover)] px-2.5 text-[12px] text-muted-foreground">Not needed: no role approves spending.</p>
            </div>
          )}
          <Field label="Backup contact" htmlFor={`b-${id}`} hint="Contacted when they're away. Needs the same permissions." error={server("backup")}>
            <select id={`b-${id}`} className={inputCls} value={p.backup || ""} onChange={(e) => onChange({ backup: e.target.value || null })}>
              <option value="">None</option>{others.map((x) => <option key={x._key} value={x.email}>{x.name || x.email}</option>)}
            </select>
          </Field>
        </div>
      </FormGroup>
    </div>
  );
}

function ReviewPanel({ review, busy, onApply, onCancel }: { review: Review; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const d = review.diff;
  const ok = review.errors.length === 0 && !!d;
  const count = d ? d.people.length + d.roles.length + d.limits.length + d.roleDefinitions.length + d.policy.length : 0;
  const general = review.errors.filter((e) => review.kind === "csv" || !e.email);
  const personal = review.kind === "edit" ? review.errors.filter((e) => e.email) : [];
  return (
    <Modal open wide onClose={onCancel} title={review.kind === "csv" ? `Review import: ${review.fileName}` : "Review changes"}
      description={ok ? "Takes effect immediately for the next email or action, including on requests in progress. Past approvals and bookings stay on record." : "Fix the problems, then review again."}
      footer={<>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onCancel}>{ok ? "Back to editing" : "Close"}</Button>
        <Button size="sm" onClick={onApply} disabled={!ok || busy || count === 0}>Save changes</Button>
      </>}>
    <div className="flex flex-col gap-3">
      {general.map((e, i) => <Notice key={`g${i}`} tone="block">{e.row ? <span className="text-muted-foreground">Row {e.row}: </span> : null}{e.message}</Notice>)}
      {personal.map((e, i) => <Notice key={`p${i}`} tone="block"><span className="font-medium">{e.email}</span>: {e.message}</Notice>)}
      {review.warnings.map((w, i) => <Notice key={`w${i}`} tone="attn">{w.row ? <span className="text-muted-foreground">Row {w.row}: </span> : null}{w.email && review.kind === "edit" ? `${w.email}: ` : ""}{w.message}</Notice>)}
      {d ? (
        count === 0 ? <p className="text-[13px] text-muted-foreground">No changes.</p> : (
          <div className="flex flex-col gap-4 text-[13px]">
            <List title="Identity changes" items={d.identity.map((x) => x.text)} />
            <List title="Added" items={d.people.filter((x) => x.kind === "added").map((x) => x.text)} />
            <List title="Removed" items={d.people.filter((x) => x.kind === "removed").map((x) => x.text)} />
            <List title="Role assignments" items={d.roles.map((x) => x.text)} />
            <List title="Approval limits" items={d.limits.map((x) => x.text)} />
            <List title="Other details" items={d.people.filter((x) => x.kind === "changed").map((x) => x.text)} />
            <List title="Roles and permissions" items={d.roleDefinitions.map((x) => x.text)} />
            <List title="Policy defaults" items={d.policy.map((x) => `${x.label}: ${x.before || "none"} → ${x.after || "none"}`)} />
          </div>
        )
      ) : null}
      {d?.affected.length ? (
        <div className="text-[13px]">
          <h3 className="mb-1 text-[12px] font-semibold">Affected requests</h3>
          <ul className="flex flex-col gap-1.5">{d.affected.map((a) => <li key={a.eventId || a.title}><span className="font-medium">{a.title}{a.eventId ? ` (${a.eventId})` : ""}</span><ul className="text-muted-foreground">{a.items.map((t) => <li key={t}>{t}</li>)}</ul></li>)}</ul>
        </div>
      ) : d && count ? <p className="text-[12px] text-muted-foreground">No requests in progress are affected.</p> : null}
    </div>
    </Modal>
  );
}

const List = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div><h3 className="mb-1 text-[12px] font-semibold">{title}</h3><ul className="flex flex-col gap-0.5 text-muted-foreground">{items.map((t) => <li key={t}>{t}</li>)}</ul></div> : null);
