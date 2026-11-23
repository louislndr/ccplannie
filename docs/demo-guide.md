# Demo guide

Three fictional scenarios run on recorded email interpretations, a local outbox and simulated venues. They are
deterministic: the same steps produce the same results every time (`npm run replay -- acme|northwind|juniper`).

Open the demo (`npm run demo`, then [localhost:3000](http://localhost:3000)), pick a scenario, and use **Admin
dashboard** to see the same moment in the company console. **Steps** reopens any step you have already reached;
it can't skip ahead.

## Which demo to watch

| Demo | Question it answers | Decision |
| --- | --- | --- |
| **1 · Acme Robotics** (23 steps) | A change by email: what does it cost, who approves it, and what stays booked? | **Keep, show first.** It has the clearest proof of the whole idea. |
| **2 · Northwind Labs** (27 steps) | Who is allowed to decide and approve, and what happens above a spending limit? | **Keep as the second demo.** Watch part C first; parts D and E are a deeper walkthrough. |
| **3 · Juniper Works** (17 steps) | What happens when venues reply late, an email fails, or finance says no? | **Keep as an operations walkthrough.** Its rule change is a setting, not the headline. |

## 1 · Acme Robotics: highlights

The full run goes from a forwarded request to a booking (part A), then changes the confirmed booking (part B).
The key moment is step 19.

1. **Step 2.** Sam forwards Dana's note. ccPlannie opens request E-1 for 30 people and asks the one missing
   detail, the date. Dana's requested budget is CAD 50,000.
2. **Step 7.** Leo, a stakeholder, suggests 45 people. The plan stays at 30; ccPlannie asks Dana, who can decide.
3. **Step 8.** Dana confirms 45. The quotes for 30 become stale, and ccPlannie asks Maple Ridge for a new price.
4. **Step 11.** Priya (finance) approves the exact terms: Maple Ridge, Sep 16, 45 guests, CAD 53,000, with a
   CAD 55,000 spending cap. A cap is a limit, not the price.
5. **Step 13.** Planned confirms the booking (MR-88412). Alex verifies contract clause 9.2 at step 14: a
   CAD 3,500 date-change fee. (The fee is fictional contract text, not a saving.)
6. **Step 16–18.** Sam asks about Sep 19. ccPlannie points to the fee; Dana wants the change; the venue quotes
   CAD 56,500 including the fee. That is CAD 1,500 over the approved cap.
7. **Step 19, the key moment.** Dana replies "Looks good". In email, everyone on the thread reads that this is
   *a choice, not a spending approval*, that it is CAD 1,500 over the cap, and that **the booking stays on
   Sep 16** until finance approves and Planned confirms. Priya separately gets a private approval email (R-2)
   with the exact new terms. In the console, the request says "Approval needed" and the Details tab shows three
   different records: plan Sep 19 / CAD 56,500, approved Sep 16 / CAD 53,000 (cap CAD 55,000), booked Sep 16 /
   CAD 53,000.
8. **Steps 20–22.** Priya approves CAD 56,500 and raises the cap to CAD 60,000. Alex sends the change; Sep 16
   stays confirmed until Planned confirms Sep 19. The final record: Sep 19, 45 guests, CAD 56,500, cap
   CAD 60,000, booking MR-88412.

## 2 · Northwind Labs: authority

Northwind has 23 people, custom roles and three requests, so start with part C (steps 1–11).

- **Step 6.** Omar picks Lakeshore at CAD 168,000. That is above Ava's CAD 75,000 limit, so ccPlannie doesn't
  email her an approval she can't give; it lists the blocked approval in the console.
- **Step 7.** The admin reassigns the approval to Ben, the controller, whose limit covers it. Ben gets the
  exact terms in a private thread.
- **Step 8.** An email claiming to be Ben's approval fails the sender check and is recorded, not applied.
- **Step 9–11.** The real Ben approves; Theo sends the booking; Planned confirms.

Deeper walkthrough: part D reroutes a request while the events lead is away and shows Sofia's suggestion
counting only after she is given a decision-making role. Part E holds emails from an outside agency, from an
employee whose role can't start requests, and from a new hire, then processes the new hire's email once she is
added to the directory.

End state: the kickoff (E-1) is confirmed; the engineering offsite (E-2) is approved internally but not booked;
the launch party (E-3) has just been opened and is waiting for details.

## 3 · Juniper Works: operations

Choose this after Acme if you want to see how a request recovers when things go wrong.

- Step 2 shortens the venue reply deadline from 24 to 8 hours in the Rules flowchart; step 8 shows the deadline
  passing and Open items listing the venues that owe a reply.
- Step 3 pauses the request for a required check; step 6 records a decision Imani made on a call, with who
  decided and who entered it.
- Step 9: offers arrive late, and one venue confirms availability without a price, which stays visible as
  unknown.
- Steps 10–11: the approval email fails to send and is retried from the request.
- Step 12: finance declines the CAD 54,000 offer; steps 13–16 approve and book a CAD 46,000 replacement
  separately. Step 17 downloads the request record.

## What is real in the demo, and what isn't

- **Real code paths:** request state, authority checks, approvals bound to exact terms, history, the outbox, the
  console and the Rules engine. The same domain code runs in company mode.
- **Recorded:** every scripted email's interpretation (`src/demo.mjs`, `src/scenarios/`). The demo proves the
  workflow for these inputs, not general language understanding.
- **Simulated:** Planned and the venues (`src/supplier-sim.mjs`), including the contracts and their fees.
