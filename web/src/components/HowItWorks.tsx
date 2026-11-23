import type { ReactNode } from "react";
import { ArrowLeftIcon, ArrowLeftRightIcon, ArrowUpDownIcon, LockIcon, MailIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import plannedWordmark from "@/assets/planned-wordmark.png";
import { backLinkClick, linkClick, useLocation } from "@/lib/router";
import { PlannieMark } from "./PlannieMark";

const Section = ({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) => (
  <section className="border-t border-border pt-6">
    <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">{icon}{title}</h2>
    <div className="mt-3 text-[15px] leading-relaxed">{children}</div>
  </section>
);

const STEPS = [
  {
    title: "Open the event",
    description: "Once the event manager accepts the request, ccPlannie opens an event in Planned with the event details, requested budget, requester and event owner.",
  },
  {
    title: "Find a venue",
    description: "When the event manager asks for options, ccPlannie sends Planned the dates, location, headcount, nights and room needs. Planned returns available venues, prices and what’s included. ccPlannie emails those options to the people handling the request.",
  },
  {
    title: "Approve and book",
    description: "Once the team chooses a venue, finance approves the exact terms and the event manager authorizes the booking. ccPlannie sends those terms to Planned and marks the event as booked when Planned confirms it.",
  },
  {
    title: "Change a booking",
    description: "If the date or headcount changes, ccPlannie asks Planned for a new quote, including any change fee. Finance approves the revised terms and the event manager authorizes the change before it goes to Planned.",
  },
];

export function HowItWorks() {
  const { search } = useLocation();
  const fromConsole = new URLSearchParams(search).get("from") === "console";
  const backTo = fromConsole ? "/admin/planned" : "/";
  return (
    <main className="planned-concept h-full overflow-clip bg-background text-foreground">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-[var(--concept-gutter)] pb-20 pt-6 sm:pt-10">
          <a href={backTo} onClick={backLinkClick(backTo)} className="inline-flex items-center gap-1.5 text-sm underline-offset-2 hover:underline"><ArrowLeftIcon aria-hidden="true" className="size-4" strokeWidth={1.6} />{fromConsole ? "Back to Planned exchanges" : "Back to the demo"}</a>
          <h1 className="sr-only">Planned integration</h1>
          <p className="mt-6 text-[17px] leading-relaxed text-foreground">
            The demo starts when someone copies ccPlannie on an event email. ccPlannie coordinates the request and checks who can make decisions and approve spending. Planned handles venues, contracts and bookings in the proposed workflow.
          </p>

          <Flow />

          <div className="mt-10 flex flex-col gap-9">
            <Section title="From request to booking">
              <ol className="flex flex-col gap-4">
                {STEPS.map(({ title, description }) => (
                  <li key={title} className="ml-5 list-decimal pl-1">
                    <h3 className="font-medium">{title}</h3>
                    <p className="mt-0.5 text-sm leading-relaxed">{description}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-sm leading-relaxed">Planned is where the booking reference, contract, event status and committed spend live. ccPlannie logs each exchange under the request number so the team can trace who approved what.</p>
            </Section>

            <Section title="What stays private" icon={<LockIcon aria-hidden="true" className="size-4" strokeWidth={1.8} />}>
              <p>ccPlannie keeps internal email, permission checks and approval codes private. Venues receive the event brief and booking terms. Budget caps and finance discussions stay within the company.</p>
            </Section>

            <Section title="What the demo shows">
              <p>You can try ccPlannie’s email workflow, permission checks, approvals and activity log. Venue options, quotes and booking confirmations are sample data. The demo has no live connection to Planned.</p>
              <p className="mt-3">A live integration would need the company’s Planned administrator to authorize access and Planned to confirm which actions its connector supports. Planned advertises venue search, event status and spend through its MCP connector.</p>
              <p className="mt-3"><a href="https://planned.com/products/integrations" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--concept-blue)] underline-offset-2 hover:underline">Planned's integrations<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} /></a></p>
              {!fromConsole ? <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <a href="/" onClick={linkClick("/")} className="text-[var(--concept-blue)] underline-offset-2 hover:underline">Run a demo</a>
                <a href="/admin" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--concept-blue)] underline-offset-2 hover:underline">Open the admin dashboard<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} /></a>
              </p> : null}
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}

// People's email ⇄ ccPlannie ⇄ Planned. Stacks vertically on phones.
function Flow() {
  const node = "grid min-w-0 grid-rows-[2rem_auto] content-start justify-items-center gap-2.5 rounded-[var(--concept-card-radius)] border border-border bg-card px-4 py-5 text-center";
  const heading = "flex items-center justify-center gap-2 text-sm font-medium";
  const connector = (
    <div aria-hidden="true" className="grid place-items-center p-2 text-muted-foreground md:px-3">
      <ArrowUpDownIcon className="size-4 md:hidden" strokeWidth={1.7} />
      <ArrowLeftRightIcon className="hidden size-4 md:block" strokeWidth={1.7} />
    </div>
  );
  return (
    <figure aria-label="How information flows" className="concept-flow mt-8 grid grid-rows-[1fr_auto_1fr_auto_1fr] items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-rows-1">
      <div className={node}>
        <div className={heading}><MailIcon aria-hidden="true" className="size-5" strokeWidth={1.7} />Your email</div>
        <div className="text-sm text-muted-foreground">Copy ccPlannie on a request</div>
      </div>
      {connector}
      <div className={node}>
        <div className={heading}><PlannieMark /><span><span className="concept-cc">cc</span>Plannie</span></div>
        <div className="text-sm text-muted-foreground">Coordinates decisions and approvals</div>
      </div>
      {connector}
      <div className={node}>
        <div className={heading}>
          <img className="concept-wordmark" src={plannedWordmark} width="1081" height="168" alt="Planned" />
        </div>
        <div className="text-sm text-muted-foreground">Finds venues and manages bookings</div>
      </div>
    </figure>
  );
}
