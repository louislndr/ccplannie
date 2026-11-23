// What kind of step this is, in one short line: an email, an event-manager action, an exchange with Planned,
// or something the administrator does in the admin dashboard (with a link to see it there).
import { ArrowDownLeftIcon, ArrowUpRightIcon, LayoutDashboardIcon, MailIcon, MousePointerClickIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoStep } from "@/api";

export function stepKind(step: DemoStep) {
  if (step.kind === "supplier") return { icon: ArrowDownLeftIcon, label: "From Planned", tone: "planned" as const };
  if (step.kind === "admin") return { icon: LayoutDashboardIcon, label: "In the admin dashboard", tone: "admin" as const };
  if (step.kind === "manager") return { icon: MousePointerClickIcon, label: "Event manager action", tone: "plain" as const };
  return { icon: MailIcon, label: "Email", tone: "plain" as const };
}

export function StepBadge({ step, className, link = true }: { step: DemoStep; className?: string; link?: boolean }) {
  const k = stepKind(step);
  const Icon = k.icon;
  const exchange = step.planned;
  const ExchangeIcon = exchange?.direction === "to" ? ArrowUpRightIcon : ArrowDownLeftIcon;
  const exchangeLabel = exchange && `${exchange.direction === "to" ? "To" : "From"} Planned: ${lower(exchange.what)}`;
  return (
    <span className={cn("flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs leading-4", className)}>
      <span className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5", k.tone === "planned" ? "text-[var(--planned-in)]" : "text-muted-foreground")} title={k.label}>
        <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} /><span className="truncate">{k.label}</span>
      </span>
      {exchangeLabel && (exchange?.direction === "to" || step.kind !== "supplier") ? (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", exchange?.direction === "to" ? "text-[var(--planned-out)]" : "text-[var(--planned-in)]")} title={exchangeLabel}>
          <ExchangeIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} /><span className="truncate">{exchangeLabel}</span>
        </span>
      ) : null}
      {link && (step.kind === "admin" || step.adminPath) ? (
        <a href={step.adminPath || "/admin"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--concept-blue)] underline-offset-2 hover:underline">
          {step.kind === "admin" ? "See it there" : "See it in the admin dashboard"}<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3" strokeWidth={1.7} />
        </a>
      ) : null}
    </span>
  );
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
