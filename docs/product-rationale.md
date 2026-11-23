# Why I built ccPlannie for Planned

ccPlannie is an independent prototype. It is not affiliated with Planned, it is not connected to Planned, and the
name is my working title. This page explains the reasoning behind it and separates what Planned publishes from
my own judgment.

## The problem I'm testing

A lot of event planning starts in an internal email thread: someone forwards a request, a stakeholder suggests
more people, a sponsor says "looks good", someone asks about another date. By the time an event manager looks at
the thread, the hard part isn't retyping the details. It's working out:

- which change is a suggestion and which one was decided by someone allowed to decide it;
- what a change does to the price, the capacity, a quote that is now stale, or a contract fee;
- whether finance approved *these exact terms* or an earlier version;
- what the venue has actually confirmed, as opposed to what people are discussing.

My hypothesis: an internal email thread can be one more place where event decisions are captured and their
consequences are shown, while the company's event manager and finance keep control of what gets approved and
booked.

## What Planned already publishes

I read these pages on November 23, 2026. Quotes are short and verbatim.

| Source | Published observation | My inference | What ccPlannie demonstrates |
| --- | --- | --- | --- |
| [Adoption playbook](https://planned.com/adoption-playbook) | "Find the event spenders you didn't know you had." "We connect Planned to the tools your team already uses." | Adoption depends on reaching occasional planners where they already work. | Occasional requesters can start and steer a request from email, without logging in to anything. |
| [Sportswear customer story](https://planned.com/customers/consumer-goods) | "Smaller events were falling outside the system entirely, leaving procurement with major blind spots." | That was the customer's *previous* workflow. It is evidence that small events escape heavy tools, not evidence that Planned has this problem. | Small, informal requests become structured requests with an owner. |
| [Program](https://planned.com/products/program) | "Approvals, budget thresholds and contract checks are built into every workflow, so policy is followed before anything is booked." | Approval and policy controls are Planned's existing baseline. An email front door has to respect them, not replace them. | Email replies never approve spending. Finance approves exact terms, within a limit, through a separate thread. |
| [Integrations](https://planned.com/products/integrations) | Slack, Microsoft Teams and MCP: "Event updates and requests in the channels your team already works in." No email integration is listed. | Email may be another such channel. Planned may already handle email in ways its public pages don't show. | One possible design for that channel, built on fictional data. |
| [Sourcing](https://planned.com/products/sourcing) | "Every proposal lands in one table … No digging through email threads and PDFs." "Contracts arrive summarized with key terms flagged for review." | Planned already removes email from *supplier* sourcing. My prototype is about the *internal* thread before and around it. | Internal decisions are tied to the offers and contract terms they affect. |

Things I did not take from these pages: the customer story's savings figures belong to Planned's customer and
are not ccPlannie results. None of the five pages mentions handling event requests or room blocks by email; that
doesn't mean Planned doesn't do it.

## What the prototype shows, and what it doesn't

It shows, on scripted fictional scenarios, that a working plan, approved terms and a supplier commitment can be
kept apart and shown side by side as people email each other (see the [demo guide](demo-guide.md)).

It does not show customer demand, better adoption, time or money saved, how accurately a model reads real email,
or that the idea is new compared with Planned's private product.

## Open questions

- Does Planned already support a mixed internal-thread workflow like this, for example through email-based
  room-block handling? I couldn't verify that from public pages.
- Would an email front door actually bring more small events into the program?
- Can consequential changes (headcount, date, "looks good") be extracted accurately from real threads? The demo
  replays recorded readings, so it can't answer this.
- Do event managers find the plan / approval / booking record useful, or is it noise?
- Partial visibility: ccPlannie only knows about emails it is copied on. A decision made in a reply that drops
  ccPlannie from the thread never reaches the record. The demo replies say so ("I only know about emails I'm
  copied on"), but it is a real limit.
