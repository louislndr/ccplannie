// Every step of the current demo, grouped by storyline.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/api";
import { stepKind } from "./StepBadge";
import { Button } from "./ui/primitives";

export function StepsOutline({ s, current, onReview, onClose, trigger }: { s: Snapshot; current: number; onReview: (n: number) => void; onClose: () => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const [container] = useState(() => document.querySelector<HTMLElement>(".concept-story"));
  const scrollArea = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const list = scrollArea.current;
    const activeStep = list?.querySelector<HTMLElement>("[aria-current='step']");
    if (list && activeStep) {
      const row = activeStep.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      list.scrollTop += row.top - viewport.top - (list.clientHeight - row.height) / 2;
    }
  }, [current]);
  const { steps, scenario } = s.demo;
  const parts = scenario?.parts ?? [...new Set(steps.map((x) => x.part))].map((id) => ({ id, title: `Part ${id}`, summary: "" }));
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal container={container}>
      <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/20" />
      <Dialog.Popup aria-label="All steps" initialFocus={closeButton} finalFocus={trigger}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-[0_0_40px_rgb(0_0_0/0.18)]">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Demo #{scenario?.number} · {scenario?.company.replace(/ \(fictional\)/, "")}</h2>
            <p className="text-xs text-muted-foreground">{current} of {steps.length} steps played</p>
          </div>
          <Button ref={closeButton} type="button" variant="outline" onClick={onClose} aria-label="Close" className="concept-icon-button"><XIcon aria-hidden="true" className="size-4" strokeWidth={1.7} /></Button>
        </div>
        <div ref={scrollArea} role="region" aria-label="Demo steps" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 [scrollbar-gutter:stable]">
          {parts.map((p) => (
            <section key={p.id} className="pt-5">
              <h3 className="text-[13px] font-semibold">{p.title}</h3>
              {p.summary ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{p.summary}</p> : null}
              <ol className="mt-2 border-l border-border">
                {steps.map((st, i) => ({ st, n: i + 1 })).filter(({ st }) => st.part === p.id).map(({ st, n }) => {
                  const done = n <= current, now = n === current, k = stepKind(st), Icon = k.icon;
                  return (
                    <li key={st.key} aria-current={now ? "step" : undefined} className="-ml-px">
                      <button type="button" disabled={!done} onClick={() => { onReview(n); onClose(); }}
                        className={cn("flex w-full items-start gap-2.5 border-l-2 py-1.5 pl-3 text-left text-[13px] leading-snug", now ? "border-[var(--concept-blue)]" : "border-transparent", done && "hover:bg-muted/60")}>
                        <span className="w-5 shrink-0 pt-px text-right text-xs tabular-nums text-muted-foreground">{n}</span>
                        <span className={cn("min-w-0 flex-1", !done && "text-muted-foreground")}>
                          {st.title}
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Icon aria-hidden="true" className="size-3" strokeWidth={1.7} />{k.label}{st.planned?.direction === "to" ? " · to Planned" : ""}</span>
                        </span>
                        {done ? <CheckIcon aria-label="Played" className="mt-0.5 size-3.5 shrink-0 text-[var(--concept-blue)]" strokeWidth={2} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
