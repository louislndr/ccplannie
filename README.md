# ccPlannie

> Independent prototype, built on fictional data. Not affiliated with or connected to Planned.

**Let employees plan an event by email, while the event manager sees what each change costs, who has to approve
it, and what is actually booked.**

Event requests often start in an internal email thread. ccPlannie is copied on it, turns it into a structured
request, asks for what's missing, and keeps apart three things a thread tends to blur:
**the working plan**, **the terms finance approved**, and **what the venue confirmed**. Requesters keep using
email. The event manager works from a company console, and finance approves exact terms in a separate private
thread.

## One change, three records

In the main demo, an offsite for 45 people is already booked at Maple Ridge for September 16 (CAD 53,000,
finance cap CAD 55,000). Someone asks about September 19. The venue quotes CAD 56,500, including a CAD 3,500
date-change fee from the contract. The sponsor replies "Looks good".

![The demo mailbox at step 19 of the Acme scenario: Dana replies "Looks good — let's do it". ccPlannie answers that this is a choice, not a spending approval, that CAD 56,500 is CAD 1,500 over the approved CAD 55,000 cap, and that the booking stays on Thu, Sep 16 until finance approves and Planned confirms. A private approval email (R-2) with the exact new terms goes to Priya in finance.](docs/media/acme-date-change-email.png)

*The requester's view: the "looks good" is recorded as a choice, finance is asked separately, and the
existing booking is unchanged.*

![The company console for the same request: status Approval needed, next step Waiting for Priya's approval. The plan, approval and booking table shows the working plan at Sun, Sep 19 and CAD 56,500, the approval R-1 at Thu, Sep 16 and CAD 53,000 with a CAD 55,000 cap, and the booking MR-88412 at Thu, Sep 16 and CAD 53,000.](docs/media/acme-date-change-console.png)

*The event manager's view: three records, side by side, with the differences highlighted.*

| Reconstructing it from the thread (hypothetical manual workflow) | With ccPlannie |
| --- | --- |
| Read back through replies to find the latest headcount and date, and whether "looks good" was a decision or an approval. | The working plan updates only when someone allowed to decide changes it; suggestions are recorded but don't apply. |
| Check whether finance approved this price or an earlier one. | Approvals are bound to exact terms; a new price needs a new approval. |
| Ask the venue what is actually confirmed. | The booking changes only when the supplier confirms; until then the original stays in place. |

## Try it

```bash
npm ci
npm run demo
```

Open [localhost:3000](http://localhost:3000), start **Acme Robotics** and press **Next step** to follow the
story. The moment above is step 19. Open **Admin dashboard** to see the console, or **Steps** to revisit
earlier steps. No API keys needed; nothing is emailed.

The two other demos answer narrower questions: **Northwind Labs** (who may decide and approve, and what happens
above a spending limit) and **Juniper Works** (late venues, a failed email, a finance decline). The
[demo guide](docs/demo-guide.md) has a short script for each.

## Why I chose this for Planned

Planned already brings sourcing, approvals, budget thresholds, contract checks and reporting into one platform,
and integrates with Slack, Microsoft Teams and MCP so requests can come from the tools people already use. Its
adoption playbook is about finding "the event spenders you didn't know you had", and one of its customer stories
describes how, under that customer's previous platform, "smaller events were falling outside the system
entirely."

My hypothesis is that the internal email thread is another of those places, and that it's where the decisions
are most ambiguous. So I built a front door that captures them without taking control away from the event
manager or finance. That is my product judgment, not a claim that Planned lacks this: public pages can't show
what Planned does privately, and I couldn't verify whether its email handling (for example around room blocks)
already overlaps. Sources and reasoning: [product rationale](docs/product-rationale.md).

## How it works

- **By email.** People CC or forward ccPlannie. It asks for missing details, shares venue options, and explains
  consequences in plain replies. Only people whose role allows it can start a request or change the plan; email
  from outside the company directory is held for review.
- **In the console.** The event manager sees who owns each request and what's blocked, the plan / approval /
  booking record, offers, and a history linked to source emails. Administrators manage people, roles and rules.
- **Finance.** Approvals go to an approver whose limit covers the amount, in a private thread, and only a verified
  reply from that approver to that approval counts.

## Status

| Part | Status |
| --- | --- |
| Request state, authority checks, exact-terms approvals, history, console, rules | Implemented; same code in the demo and company mode |
| Email interpretation in the demos | Recorded readings (deterministic); proves the workflow for these inputs, not language understanding |
| Model interpretation (Gemini or Claude) | Implemented, optional; not used by the scripted demos |
| AgentMail, Gmail, Postmark delivery | Implemented and covered by mocked tests; not verified live in this repository |
| Venues, offers, contracts, booking confirmations | Simulated (fictional data) |
| Planned | **Not connected.** `src/planned.mjs` is the boundary; the download is a JSON export |

## Develop

```bash
npm test                    # unit, scenario, console, mail-adapter, hosted-session and property tests
npm run replay -- acme      # or northwind, juniper
npm run console             # the company console on localhost:3002/admin (needs .env, see .env.example)
```

Node.js 22.13 or later (I use 24). Setup, hosted deployment, architecture and what a real Planned integration
would require: [development guide](docs/development.md).

## Limits and open questions

- ccPlannie only knows about emails it is copied on. A decision made after someone drops it from the thread
  never reaches the record.
- The demo can't show whether real threads are read accurately, whether an email front door brings more events
  into the program, or whether managers find this record useful. Those are what I'd test next.
