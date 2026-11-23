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

const FEATURES: [string, string][] = [
  ["Email intake", "CC or forward ccPlannie. It opens a request, asks for anything missing, and keeps replies linked to it."],
  ["Who can decide", "Company roles decide who can start a request, change the plan, approve spending and book. A suggestion doesn’t change the plan on its own."],
  ["Finance approvals", "Finance approves the exact venue, date, headcount and price in a private email, within their limit, with escalation when it’s above."],
  ["Changes and their cost", "Stale quotes, contract fees and amounts over budget are flagged in the thread. The booking stays as it is until the venue confirms a change."],
  ["Company console", "The event manager sees every request, what’s blocking it, the plan next to what’s approved and booked, and the full history. Admins manage people, roles and rules."],
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
          <h1 className="mt-6 text-[26px] font-semibold tracking-[-0.02em]">About ccPlannie</h1>
          <p className="mt-2 text-[17px] leading-relaxed text-foreground">
            An email assistant for event requests, built as an extension concept for Planned. Employees CC it on an event email and keep working from their inbox. The event manager gets a structured request and a console to carry it through to a confirmed booking.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Independent prototype with fictional data. Not made by or connected to Planned.</p>

          <div className="mt-10 flex flex-col gap-9">
            <Section title="Where the idea came from">
              <p>Planned’s own website points at it. In a customer story, it describes a previous platform where <q>smaller events were falling outside the system entirely, leaving procurement with major blind spots.</q> Its adoption playbook is about reaching people who only plan now and then: <q>Find the event spenders you didn't know you had.</q></p>
              <p className="mt-3">Those occasional planners usually start in email. Someone forwards a request, someone suggests more people, someone replies “looks good”. By the time an event manager reads the thread, it’s hard to tell what was decided, what finance approved, and what the venue confirmed.</p>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <a href="https://planned.com/customers/consumer-goods" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--concept-blue)] underline-offset-2 hover:underline">Customer story<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} /></a>
                <a href="https://planned.com/adoption-playbook" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--concept-blue)] underline-offset-2 hover:underline">Adoption playbook<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} /></a>
              </p>
            </Section>

            <Section title="What ccPlannie does">
              <ul className="flex flex-col gap-2.5 text-[15px]">
                {FEATURES.map(([title, text]) => <li key={title} className="ml-5 list-disc pl-1"><span className="font-medium">{title}.</span> {text}</li>)}
              </ul>
            </Section>

            <Section title="How it connects to Planned">
              <p>ccPlannie coordinates the request and checks who can make decisions and approve spending. Planned handles venues, contracts and bookings.</p>
              <Flow />
            </Section>
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
              <p className="mt-3">A live integration would need the company’s Planned administrator to authorize access and Planned to confirm which actions its connector supports. Planned’s integrations page lists an MCP connector to “plan and manage events from the AI assistant your team already uses”.</p>
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
