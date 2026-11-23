// Small shared pieces for the console. Restrained: hairlines, one accent, text over badges.
import { useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { linkClick } from "@/lib/router";

export const A = ({ to, className, children, ...p }: { to: string; className?: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a href={to} onClick={linkClick(to)} className={cn("text-primary underline-offset-2 hover:underline", className)} {...p}>{children}</a>
);

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </header>
  );
}

// A titled section separated by a hairline, not a card.
export function Section({ title, aside, children, className, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn("min-w-0", className)} aria-labelledby={id}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-sm font-semibold">{title}</h2>
        {aside ? <div className="text-[12px] text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export type Tone = "neutral" | "attn" | "ok" | "block" | "info";
const DOT: Record<Tone, string> = { neutral: "bg-[var(--m-label3)]", attn: "bg-[var(--console-attn)]", ok: "bg-[var(--console-ok)]", block: "bg-[var(--console-block)]", info: "bg-[var(--console-info)]" };
// Status as a dot + text (Apple style), never a pill.
export const Status = ({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-muted-foreground", className)}><span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[tone])} />{children}</span>
);

export function Notice({ tone = "neutral", children, className, role }: { tone?: Tone; children: ReactNode; className?: string; role?: string }) {
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-snug", tone === "block" ? "border-[color-mix(in_oklab,var(--console-block)_35%,var(--border))]" : tone === "attn" ? "border-[color-mix(in_oklab,var(--console-attn)_35%,var(--border))]" : tone === "ok" ? "border-[color-mix(in_oklab,var(--console-ok)_35%,var(--border))]" : "border-border", className)}>
      <span aria-hidden className={cn("mt-[6px] size-[7px] shrink-0 rounded-full", DOT[tone])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/25 px-5 py-9 text-center"><p className="text-[15px] font-medium">{title}</p>{children ? <div className="max-w-md text-[13px] leading-relaxed text-muted-foreground">{children}</div> : null}</div>
);

export const Loading = ({ label = "Loading…" }: { label?: string }) => <div role="status" aria-live="polite" className="py-14 text-center text-[13px] text-muted-foreground">{label}</div>;

export const ErrorState = ({ error, retry }: { error: string; retry?: () => void }) => (
  <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <p className="text-[15px] font-medium">Couldn't load this page</p>
    <p className="max-w-md text-[13px] text-muted-foreground">{error}</p>
    {retry ? <button onClick={retry} className="text-[13px] text-primary hover:underline">Try again</button> : null}
  </div>
);

export const Field = ({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={htmlFor} className="text-[12px] font-medium">{label}</label>
    {children}
    {error ? <p className="text-[12px] text-destructive" role="alert">{error}</p> : hint ? <p className="text-[12px] leading-snug text-muted-foreground">{hint}</p> : null}
  </div>
);

export const inputCls = "h-8 w-full min-w-0 rounded-md border border-input px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive";

// A two-column label/value list.
export const KV = ({ rows }: { rows: [ReactNode, ReactNode][] }) => (
  <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
    {rows.map(([k, v], i) => <div key={i} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
  </dl>
);

// A centered dialog for edits and reviews. It renders inside the console panel so it keeps the console's
// colors (light and dark), stays centered in the window, and scrolls inside itself when the content is tall.
export function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const [container] = useState(() => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".console")));
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <Dialog.Popup className={cn("flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.22)] outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-[.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[.98] data-[starting-style]:opacity-0", wide ? "max-w-3xl" : "max-w-2xl")}>
            <div className="shrink-0 border-b border-border px-5 pb-3 pt-4">
              <Dialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[12px] text-muted-foreground">{description}</Dialog.Description> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// A titled group inside a dialog: small heading, optional note on the right, then the fields.
export const FormGroup = ({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</h3>
      {aside ? <span className="text-[12px] text-muted-foreground">{aside}</span> : null}
    </div>
    {children}
  </section>
);

// A permission as a small quiet tag.
export const PermTag = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">{children}</span>
);
