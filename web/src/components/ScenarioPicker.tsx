import { ArrowRightIcon, CheckIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoScenario } from "@/api";
import { Button } from "./ui/primitives";

const shortName = (company: string) => company.replace(/ \(fictional\)/, "");

export function ScenarioStart({ scenarios, current, busy, onPick, onStart }: { scenarios: DemoScenario[]; current: string; busy: boolean; onPick: (id: string) => void; onStart: () => void }) {
  const selected = scenarios.find((demo) => demo.id === current) ?? scenarios[0];
  return (
    <section aria-labelledby="choose-demo">
      <div className="concept-picker-content mx-auto flex max-w-6xl flex-col gap-6 py-2 sm:py-6">
        <div>
          <h2 id="choose-demo" className="text-[22px] font-semibold tracking-[-0.01em]">Choose a demo</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Choose a fictional company to follow its email story. Open the admin dashboard to see what ccPlannie records and where people make decisions.
          </p>
        </div>
        <fieldset className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">Demo company</legend>
          {scenarios.map((demo) => {
            const active = demo.id === current;
            return (
              <label key={demo.id} className={cn("concept-picker-card flex min-w-0 cursor-pointer flex-col gap-3 rounded-[var(--concept-card-radius)] border bg-card p-5 text-left transition-[border-color,box-shadow] focus-within:ring-2 focus-within:ring-ring sm:p-6",
                active ? "border-[var(--concept-blue)] shadow-[0_0_0_1px_var(--concept-blue)]" : "border-border hover:border-[color-mix(in_oklab,var(--concept-blue)_45%,var(--border))]")}>
                <input type="radio" name="scenario" className="sr-only" value={demo.id} checked={active} disabled={busy} onChange={() => onPick(demo.id)} aria-label={shortName(demo.company)} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">Demo #{demo.number}</span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1"><UsersIcon aria-hidden="true" className="size-3.5" strokeWidth={1.6} />{demo.people} people</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{demo.steps} steps</span>
                  {active ? <span className="flex items-center gap-1 text-[var(--concept-blue)]"><CheckIcon aria-hidden="true" className="size-3.5" />Selected</span> : null}
                </div>
                <div>
                  <h3 className="text-[19px] font-semibold leading-tight">{shortName(demo.company)}</h3>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{demo.tagline}</p>
                </div>
                <p className="text-[13px] leading-relaxed">{demo.summary}</p>
                <ol className="mt-auto space-y-1.5 border-t border-border pt-3 text-[13px] leading-snug">
                  {demo.parts.map((part, index) => (
                    <li key={part.id} className="flex gap-2.5">
                      <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                      <span><span className="font-medium">{part.title}.</span> <span className="text-muted-foreground">{part.summary}</span></span>
                    </li>
                  ))}
                </ol>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="concept-demo-action" onClick={onStart} disabled={busy}>Start demo #{selected.number}<ArrowRightIcon aria-hidden="true" strokeWidth={1.7} /></Button>
        </div>
      </div>
    </section>
  );
}
