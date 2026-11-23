# ccPlannie

**An email intake and coordination prototype for Planned.** CC ccPlannie on an event thread to turn the conversation into a structured request. The team keeps working from email while the event manager and finance see who needs to act, what has been approved, and what the venue has confirmed.

## Why I built it for Planned

An offsite can already have a date, a headcount, a budget conversation, and a person who said “looks good” by the time an event manager sees the thread. Re-entering those details is one problem. Figuring out which decisions are current, who had authority to make them, and what the venue actually agreed to is harder.

I built ccPlannie to bring those requests into Planned’s workflow earlier. Planned already brings sourcing, proposal comparison, contracting, and program controls into one platform. Its integrations bring that workflow into tools teams already use. Email is another place to meet them. My goal was to see how much of an ordinary thread could become an actionable event brief, with a clear record of the decisions Planned would receive. [Planned Sourcing](https://planned.com/products/sourcing) · [Planned Integrations](https://planned.com/products/integrations) · [Planned Program](https://planned.com/products/program)

## See it in action

Play a scenario in the mail view and use **Admin dashboard** to open the same step’s request, email, or company setting. **Steps** lets you revisit earlier moments without moving the live demo.

| Demo | What to look for |
| --- | --- |
| **1 · Acme Robotics** | An assistant forwards an offsite request. A change from 30 to 45 guests makes the old quotes stale. Finance approves the revised quote, the manager sends it, and the venue confirms. A later date change adds a CAD 3,500 contract fee and goes through approval again while the original booking stays in place. |
| **2 · Northwind Labs** | A CAD 168,000 quote exceeds the assigned approver’s limit. The controller takes over, and an unverified reply leaves the approval pending. In a second request, a promotion lets Sofia’s next email change the plan. In Intake review, adding Nina to the directory lets the team process her held email. |
| **3 · Juniper Works** | In **step 2**, open **See the rule change**. The Rules flowchart shows the venue reply deadline moving from 24 to 8 hours. At **step 8**, the new deadline flags unanswered inquiries. Later, retry a failed approval email, see finance decline the first offer, and download the record for the confirmed replacement. |

## What I built

| Feature | Why it matters |
| --- | --- |
| **Email intake** | People can CC or forward an event brief from their normal inbox. ccPlannie ties replies to the request, captures supplied details, asks for what’s missing, and holds messages it can’t safely attach or act on for review. |
| **Company directory and roles** | The People and Roles views show who can start a request, change a plan, approve spending, or manage a booking. Reporting lines, backups, and spending limits are visible. CSV imports and in-browser edits go through validation and review before they take effect. |
| **Request ownership and triage** | The Requests inbox shows who owns the work, where it’s blocked, and the next action. Administrators can route or reassign requests and reprocess eligible held email. An event manager explicitly accepts ownership before acting. |
| **Configurable rules** | The Rules flowchart shows default routing, approval thresholds, venue deadlines, and whether to request revised quotes automatically. Teams can add a pause, an FYI, or a person to copy at a specific stage. A written policy can be read into a draft for a person to review and save. |
| **Sourcing and quote comparison** | The manager asks for quotes with the dates, headcount, and room needs. Replies surface prices, capacity, and availability. A plan change makes old offers stale. Late replies clear unanswered-inquiry warnings, and availability without a price remains visible as an unknown. |
| **Spending approval and booking** | Finance approves a specific venue, date, headcount, price, and set of terms within its limit. An eligible approver can take over a blocked approval. Verified replies are checked against the current approval. The owning manager authorizes the booking, and the supplier confirmation establishes the commitment. |
| **Changes to a booking** | The request shows the working plan, approved terms, and supplier commitment side by side. A manager can verify a contract clause against its excerpt. A revised quote and fresh approval can move the plan forward while the original booking stays confirmed. |
| **History and follow-through** | Request history links decisions to their source emails. A manager can also record a decision from a call with who made it and who entered it. Activity records routing and company changes. Failed outgoing email can be retried from the request using the original message. |
| **Planned exchanges and handoff** | The Planned view shows the brief, offers, booking request, and confirmation that cross the proposed integration boundary. The downloadable JSON record carries decisions, terms, and confirmation details. Connections shows the directory and policy sources and the status of email, interpretation, and Planned. |

## How the handoff works

ccPlannie reads the email and proposes what it means. The application checks those proposals against the recorded sender, company rules, and current request before changing state. Supplier-facing exchanges carry the event brief or booking terms. Internal discussions, approval codes, and spending caps stay with the company.

In the proposed integration, ccPlannie passes a structured request to Planned for sourcing and sends exact, authorized terms for bookings or amendments. Planned returns offers, updated pricing, confirmations, and references. The demo implements this exchange with fictional venue data. A live integration would use Planned’s supported operations, workspace authorization, and approval rules.

## Run the demo

Use Node.js 24.

```bash
npm ci
npm run demo
```

- [Demo picker](http://localhost:3000/)
- [Admin dashboard](http://localhost:3000/admin)
- [How it connects to Planned](http://localhost:3000/how-it-works)

The three scenarios run without API keys. The demo uses recorded email interpretations, a local outbox, and simulated venues and contracts. **Replay** starts the scenario fresh.

<details>
<summary>Vercel deployment and company console</summary>

The [Vercel configuration](vercel.json) builds the frontend and serves the demo API from the same origin. Import the repository root, use Node.js 24.x, and connect Upstash Redis for session storage. The API accepts the integration’s `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Set `PLANNIE_INTERPRETER=fixture`. Hosted browsers get separate demo sessions, and progress expires seven days after the last change.

The standalone company console runs with `npm run console` at [localhost:3002/admin](http://localhost:3002/admin). It starts with a separate, empty directory and requires an administrator password. Copy [the environment template](.env.example) to `.env` to configure sign-in and optional AgentMail, Gmail, or Postmark delivery. Company mode keeps venue exchanges simulated.

</details>

## Verification

Run `npm test` to exercise the scenarios, approval and identity checks, company configuration, mail adapters, and hosted session isolation. To replay a scenario in the terminal, run `npm run replay -- acme`, `npm run replay -- northwind`, or `npm run replay -- juniper`.
