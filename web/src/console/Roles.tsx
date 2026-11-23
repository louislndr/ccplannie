// The company's roles and what each one can do. Part of the People draft: nothing changes until the
// administrator reviews and saves, and a role's permissions apply to everyone who holds it.
import { useState } from "react";
import { BadgeCheckIcon, CalendarCheckIcon, CircleDotIcon, ListChecksIcon, MailPlusIcon, MessageSquareIcon, PlusIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import type { Permission, Person, Role } from "./api";
import { Field, FormGroup, Modal, Section, inputCls } from "./ui";

export type Roles = Record<string, Role>;
const PERM_ICON: Record<string, LucideIcon> = { request: MailPlusIcon, decide: ListChecksIcon, approve: BadgeCheckIcon, manage: CalendarCheckIcon, everyone: MessageSquareIcon };
const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function RolesEditor({ roles, permissions, people, onChange, errors }: { roles: Roles; permissions: Permission[]; people: Person[]; onChange: (r: Roles) => void; errors: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const ids = Object.keys(roles);
  const holders = (id: string) => people.filter((p) => p.roles.includes(id)).length;
  const set = (id: string, patch: Partial<Role>) => onChange({ ...roles, [id]: { ...roles[id], ...patch } });
  const toggle = (id: string, perm: string, on: boolean) => set(id, { permissions: permissions.map((p) => p.id).filter((p) => (p === perm ? on : roles[id].permissions.includes(p))) });
  const remove = (id: string) => { const { [id]: _, ...rest } = roles; onChange(rest); setEditing(null); };
  const nameTaken = (label: string, except?: string) => Object.entries(roles).some(([id, r]) => id !== except && r.label.trim().toLowerCase() === label.trim().toLowerCase());
  const add = () => {
    const label = newName.trim();
    if (!label || nameTaken(label)) return;
    let base = slug(label) || "role"; if (!/^[a-z]/.test(base)) base = `role_${base}`; base = base.slice(0, 36);
    let id = base; for (let n = 2; roles[id]; n++) id = `${base}_${n}`;
    onChange({ ...roles, [id]: { label, summary: "", permissions: [] } });
    setNewName(""); setEditing(id);
  };
  const open = editing && roles[editing] ? editing : null;
  const r = open ? roles[open] : null;
  const dupe = !!r && !!r.label.trim() && nameTaken(r.label, open!);
  const openHolders = open ? holders(open) : 0;
  return (
    <>
    <Section title={`Roles (${ids.length})`}>
      {/* Same framed panel as the org chart above. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto" role="region" aria-label="Roles and permissions" tabIndex={0}>
          <table className="w-full min-w-[44rem] text-[13px]">
            <thead className="bg-[var(--console-sidebar)] text-[12px] text-muted-foreground">
              <tr>
                <th scope="col" className="py-2.5 pl-4 pr-3 text-left font-medium">Role</th>
                {permissions.map((p) => <th key={p.id} scope="col" title={p.summary} className="w-[12%] px-2 py-2.5 text-center font-medium leading-tight">{p.label}</th>)}
                <th scope="col" className="w-[7%] px-2 py-2.5 text-right font-medium">People</th>
                <th scope="col" className="w-[1%] py-2.5 pl-2 pr-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {ids.map((id) => {
                const role = roles[id], n = holders(id);
                return (
                  <tr key={id} className="hover:bg-[var(--console-row-hover)]">
                    <td className="py-3 pl-4 pr-3 align-middle">
                      <div className="font-medium">{role.label || <span className="text-muted-foreground">Unnamed</span>}</div>
                      <div className="text-[12px] text-muted-foreground">{role.summary || (!role.permissions.length ? "Can only suggest changes." : null)}</div>
                    </td>
                    {permissions.map((p) => (
                      <td key={p.id} className="px-2 py-3 text-center align-middle">
                        <input type="checkbox" checked={role.permissions.includes(p.id)} onChange={(e) => toggle(id, p.id, e.target.checked)} aria-label={`${role.label || id}: ${p.label}`} />
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right align-middle tabular-nums text-muted-foreground">{n}</td>
                    <td className="py-2 pl-2 pr-4 text-right align-middle">
                      <Button size="sm" variant="outline" onClick={() => setEditing(id)} aria-label={`Edit role ${role.label || id}`}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--console-sidebar)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input aria-label="New role name" className={cn(inputCls, "w-64")} value={newName} maxLength={60} placeholder="New role, e.g. Office manager" onChange={(e) => setNewName(e.target.value)} />
          <Button size="sm" variant="outline" type="submit" disabled={!newName.trim() || nameTaken(newName)}><PlusIcon />Add role</Button>
          {newName.trim() && nameTaken(newName) ? <span className="text-[12px] text-destructive">A role with this name already exists.</span> : null}
        </form>
      </div>
      {errors.length ? <ul className="mt-2">{errors.map((e) => <li key={e} className="text-[12px] text-destructive">{e}</li>)}</ul> : null}

      {open && r ? (
        <Modal open onClose={() => setEditing(null)} title={r.label.trim() || "New role"} description={`${openHolders} ${openHolders === 1 ? "person holds" : "people hold"} this role. Edits are a draft until you review and save.`}
          footer={<>
            <Button size="sm" variant="destructive" disabled={openHolders > 0} title={openHolders > 0 ? "Move people to another role first" : undefined} onClick={() => remove(open)}>Delete role</Button>
            {openHolders > 0 ? <span className="text-[12px] text-muted-foreground">Move its people to another role before deleting it.</span> : null}
            <Button size="sm" className="ml-auto" onClick={() => setEditing(null)}>Done</Button>
          </>}>
          <div className="flex flex-col gap-6">
            <FormGroup title="Details">
              <div className="flex flex-col gap-3">
                <Field label="Name" htmlFor="role-name" error={!r.label.trim() ? "Give the role a name." : dupe ? "Another role already has this name." : null}>
                  <input id="role-name" className={inputCls} value={r.label} maxLength={60} autoFocus onChange={(e) => set(open, { label: e.target.value })} aria-invalid={!r.label.trim() || dupe} />
                </Field>
                <Field label="Description" htmlFor="role-summary" hint={`ID in CSV: ${open}`}>
                  <textarea id="role-summary" className={cn(inputCls, "h-auto min-h-[4rem] resize-y py-1.5")} value={r.summary} maxLength={400} placeholder="What this role is for (optional)" onChange={(e) => set(open, { summary: e.target.value })} />
                </Field>
              </div>
            </FormGroup>
            <FormGroup title="Permissions" aside={r.permissions.length ? `${r.permissions.length} selected` : "Suggest only"}>
              <fieldset>
                <legend className="sr-only">Permissions</legend>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {permissions.map((p) => {
                    const on = r.permissions.includes(p.id);
                    return (
                      <li key={p.id}>
                        <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5 text-[13px] transition-colors", on ? "bg-[var(--console-selected)]" : "hover:bg-[var(--console-row-hover)]")}>
                          <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => toggle(open, p.id, e.target.checked)} />
                          <span className="min-w-0"><span className="font-medium">{p.label}</span><span className="block text-[12px] leading-snug text-muted-foreground">{p.summary}</span></span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </FormGroup>
          </div>
        </Modal>
      ) : null}
    </Section>

      {/* The key to the table's columns, one tile per permission. */}
    <Section title="Permissions">
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[...permissions.map((p) => ({ id: p.id, label: p.label, summary: p.summary })), { id: "everyone", label: "Everyone", summary: "Can suggest changes. Suggestions are never applied on their own." }].map((p) => {
            const Icon = PERM_ICON[p.id] || CircleDotIcon;
            return (
              <div key={p.id} className={cn("flex flex-col gap-1.5 rounded-xl border p-3", p.id === "everyone" ? "border-dashed border-border bg-transparent" : "border-border bg-card")}>
                <dt className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--console-selected)]"><Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} /></span>
                  {p.label}
                </dt>
                <dd className="text-[12px] leading-snug text-muted-foreground">{p.summary}</dd>
              </div>
            );
          })}
        </dl>
    </Section>
    </>
  );
}
