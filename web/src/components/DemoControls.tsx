import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Snapshot } from "@/api";
import { StepBadge } from "./StepBadge";
import { Button, Progress } from "./ui/primitives";

type Props = {
  busy: boolean;
  reviewing: boolean;
  canBack: boolean;
  canReset: boolean;
  onBack: () => void;
  onNext: () => void;
  onReset: () => void;
  onExitReview?: () => void;
};

export function DemoControls({ s, ...controls }: Props & { s: Snapshot }) {
  const { step, steps, timeoutEdit } = s.demo;
  const last = steps[step - 1];
  const description = !timeoutEdit ? last?.explain ?? last?.note : timeoutEdit.before === timeoutEdit.after
    ? `The workshop will use your current venue reply deadline of ${timeoutEdit.after} hours.`
    : `The venue reply deadline changed from ${timeoutEdit.before} to ${timeoutEdit.after} hours. The workshop will use the new deadline.`;
  return <DemoControlBar
    {...controls} step={step} total={steps.length} title={last?.title} description={description}
    detail={last ? <StepBadge step={last} link={false} className="border-l border-border pl-2" /> : null}
  />;
}

export function DemoControlBar({ step, total, title, detail, description, busy, reviewing, canBack, canReset, onBack, onNext, onReset, onExitReview }: Props & {
  step: number;
  total: number;
  title?: string;
  detail?: ReactNode;
  description?: string;
}) {
  const complete = step >= total;
  const setup = step === 0;

  return (
    <footer aria-label="Demo controls" className="concept-demo concept-controls grid min-h-36 max-h-[50dvh] shrink-0 grid-rows-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 bg-card px-4 py-3 text-foreground sm:min-h-[9.5rem] sm:px-5 lg:min-h-24 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-1">
      <div className="min-h-0 min-w-0 space-y-1 overflow-y-auto lg:self-center">
        {title ? <p className="wrap-anywhere text-base font-semibold leading-6 tracking-[-0.015em]" title={title}>{title}</p> : null}
        <div className="flex min-w-0 shrink-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
          <span aria-live="polite" className="shrink-0 whitespace-nowrap tabular-nums">
            {reviewing ? `Reviewing step ${step} of ${total}` : complete ? "Demo complete" : setup ? "Demo mailbox" : `Step ${step} of ${total}`}
          </span>
          {!setup ? <Progress value={step} max={total} aria-label="Demo progress" className="sr-only sm:not-sr-only sm:w-12 sm:shrink-0" /> : null}
          {detail}
        </div>
        {description ? <p className="wrap-anywhere text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2 lg:self-center">
        {onExitReview ? <Button variant="outline" onClick={onExitReview} disabled={busy}>Return to live</Button> : null}
        {canReset ? <Button variant={complete ? "default" : "outline"} className={complete ? "concept-demo-action" : undefined} onClick={onReset} disabled={busy}>{complete ? "Replay" : "Reset"}</Button> : null}
        {!setup ? <Button variant="outline" onClick={onBack} disabled={busy || !canBack} aria-label={reviewing ? "Back in review" : undefined}>Back</Button> : null}
        {!complete ? (
          <Button className="concept-demo-action" onClick={onNext} disabled={busy} aria-label={setup ? undefined : reviewing ? "Next in review" : "Next step"}>
            {setup ? "Start demo" : <span>Next<span className="max-[359px]:hidden">{reviewing ? " in review" : " step"}</span></span>}
            <ArrowRightIcon aria-hidden="true" className="hidden sm:block" strokeWidth={1.7} />
          </Button>
        ) : null}
      </div>
    </footer>
  );
}
