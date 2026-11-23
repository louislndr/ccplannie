// The mandatory demonstration, as data. Every email step goes through the normal mail/ingest pipeline;
// manager steps call the same domain operations as the dashboard; supplier steps run the labeled simulator.
// Fixture interpretations below are used ONLY in fixture mode (offline replay) and are labeled as such in the UI.

export const DEMO_START = "2027-06-01T13:00:00.000Z"; // fixed demo clock (09:00 America/Toronto)

export const N = { headcount: null, date: null, nights: null, roomPolicy: null, region: null, budget: null };
export const I = (kind, quote, extra = {}) => ({ kind, fields: extra.fields ? { ...N, ...extra.fields } : null, optionRef: extra.optionRef ?? null, approvalRef: extra.approvalRef ?? null, capTo: extra.capTo ?? null, revisionNote: extra.revisionNote ?? null, quote, fromQuotedHistory: !!extra.fromQuotedHistory });

const DANA_FIRST = `Sam — can you set up our fall team offsite? About 30 people, one night, everyone gets their own room. Somewhere within a couple of hours of Toronto, mid-September. Budget is CAD 50,000.

Thanks,
Dana`;

export const FIXTURE_INTERPRETATIONS = {
  A2: {
    intents: [
      I("new_request", "please get this organized with the event team"),
      I("details", "About 30 people, one night, everyone gets their own room. Somewhere within a couple of hours of Toronto", { fields: { headcount: 30, nights: 1, roomPolicy: "one_per_attendee", region: "within ~2h of Toronto" }, fromQuotedHistory: true }),
      I("details", "Budget is CAD 50,000.", { fields: { budget: 50000 }, fromQuotedHistory: true }),
    ],
    unresolved: ["'mid-September' — no specific date"],
  },
  A3: { intents: [I("details", "Thursday, September 16, 2027", { fields: { date: "2027-09-16" } })], unresolved: [] },
  A7: { intents: [I("suggestion", "Could we make it 45? Ops wants to join.", { fields: { headcount: 45 } })], unresolved: [] },
  A8: { intents: [I("confirm", "Yes — let's plan for 45. Everyone still gets their own room.", { fields: { headcount: 45 } })], unresolved: [] },
  A10: { intents: [I("select", "Let's go with Maple Ridge.", { optionRef: "Maple Ridge" })], unresolved: [] },
  A11: { intents: [I("approve", "Approve R-1. Raise the cap to CAD 55,000.", { approvalRef: "R-1", capTo: 55000 })], unresolved: [] },
  A13: { intents: [I("fyi", "Great, thank you!")], unresolved: [] },
  B1: { intents: [I("scenario", "Would September 19 work instead?", { fields: { date: "2027-09-19" } })], unresolved: [] },
  B2: { intents: [I("confirm", "Yes, let's try to move it to the 19th.", { fields: { date: "2027-09-19" } })], unresolved: [] },
  B4: { intents: [I("select", "Looks good — let's do it.", { optionRef: "Maple Ridge" })], unresolved: [] },
  B5: { intents: [I("approve", "Approved R-2. Revise the cap to CAD 60,000.", { approvalRef: "R-2", capTo: 60000 })], unresolved: [] },
  B8: { intents: [I("status", "Where are we on the offsite?")], unresolved: [] },
};

// replyTo: which earlier message this email answers (resolved by the runner from real stored messages).
export const DEMO_STEPS = [
  // ---------------- Part A — request to confirmed arrangement
  { key: "A1", part: "A", kind: "email", title: "Dana asks Sam for an offsite", explain: "Dana gives Sam the brief for a 30-person offsite. ccPlannie will see it when Sam forwards the email.",
    from: "dana@acme.example", to: ["sam@acme.example"], cc: [], subject: "Fall team offsite", body: DANA_FIRST },
  { key: "A2", explain: "ccPlannie opens the request from Sam’s forwarded email and asks for the one missing detail: the date.", part: "A", kind: "email", title: "Sam forwards it to ccPlannie", note: "ccPlannie sees only what Sam includes: the forwarded note.",
    from: "sam@acme.example", to: ["$intake"], cc: ["dana@acme.example", "leo@acme.example"], subject: "Fwd: Fall team offsite",
    body: `Hi ccPlannie — please get this organized with the event team. Dana's note is below; Leo is coordinating ops.

---------- Forwarded message ---------
From: Dana Ruiz <dana@acme.example>
Subject: Fall team offsite

${DANA_FIRST}` },
  { key: "A3", explain: "ccPlannie records September 16 from Dana’s reply. The request now has the details needed to ask for quotes.", part: "A", kind: "email", title: "Dana answers the one blocking question", note: "A clear, permitted detail: applied quietly, no reply.",
    from: "dana@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Thursday, September 16, 2027." },
  { key: "A4", explain: "Alex takes ownership. He can now ask for venue quotes and later send approved terms for booking.", part: "A", kind: "manager", title: "Alex accepts ownership", action: "accept" },
  { key: "A5", explain: "The three venues get the date, headcount, and room requirements so they can quote.", part: "A", kind: "manager", title: "Alex asks Planned for options from three venues", action: "requestQuotes", args: { supplierIds: ["lakeview", "harbourline", "mapleridge"] } },
  { key: "A6", explain: "ccPlannie shares a comparison of the returned prices and venue capacities in the email thread.", part: "A", kind: "supplier", title: "Planned sends back venue options", note: "Sample data standing in for Planned's sourcing results." },
  { key: "A7", explain: "Leo can suggest changes. The plan stays at 30 guests while ccPlannie asks Dana to decide.", part: "A", kind: "email", title: "Leo suggests 45 people", note: "Leo can suggest but not change scope.",
    from: "leo@acme.example", replyTo: "plannie-comparison", subject: "Re: Fall team offsite", body: "Could we make it 45? Ops wants to join." },
  { key: "A8", explain: "Dana changes the plan to 45 guests. ccPlannie sets aside the old quotes and asks Maple Ridge for a new price.", part: "A", kind: "email", title: "Dana confirms 45", note: "Working plan changes; quotes for 30 go stale; ccPlannie asks Planned for a revised offer from the one venue that fits (non-binding).",
    from: "dana@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Yes — let's plan for 45. Everyone still gets their own room." },
  { key: "A9", explain: "Maple Ridge's new price for 45 people arrives from Planned: CAD 53,000.", part: "A", kind: "supplier", title: "Planned sends Maple Ridge's revised offer", note: "Sample data standing in for Planned's revised offer: CAD 53,000 for 45." },
  { key: "A10", explain: "Dana’s choice starts a private approval email to Priya with the venue, date, headcount, and price.", part: "A", kind: "email", title: "Dana picks Maple Ridge", note: "Selecting is not approving: finance gets an exact-terms request.",
    from: "dana@acme.example", replyTo: "plannie-comparison", subject: "Re: Fall team offsite", body: "Let's go with Maple Ridge." },
  { key: "A11", explain: "Priya approves Maple Ridge for 45 guests at CAD 53,000 and sets a spending cap of CAD 55,000.", part: "A", kind: "email", title: "Priya approves the exact terms", note: "Separate approval thread; approval bound to exact terms.",
    from: "priya@acme.example", replyTo: "plannie-approval", subject: "Re: Approval R-1", body: "Approve R-1. Raise the cap to CAD 55,000.\n\nPriya" },
  { key: "A12", explain: "Alex sends the approved terms to Planned. The request waits for a booking confirmation.", part: "A", kind: "manager", title: "Alex sends the approved booking to Planned", action: "authorize" },
  { key: "A13s", explain: "Maple Ridge is booked for September 16. The confirmed terms and contract are on the request.", part: "A", kind: "supplier", title: "Planned confirms the booking", note: "Only the confirmation creates the booking. Sample data standing in for Planned's confirmation." },
  { key: "A14", explain: "Alex checks clause 9.2 against the contract and verifies the CAD 3,500 date-change fee.", part: "A", kind: "manager", title: "Alex reviews contract clause 9.2", action: "reviewClause", args: { ruleRef: "9.2" } },
  { key: "A13", explain: "Sam says thanks. ccPlannie stays quiet: nothing to do.", part: "A", kind: "email", title: "Sam says thanks", note: "Routine FYI: no assistant reply.",
    from: "sam@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Great, thank you!" },
  // ---------------- Part B — a later change with consequences
  { key: "B1", explain: "ccPlannie finds a CAD 3,500 date-change fee in the contract. Planned still needs to check whether September 19 is available.", part: "B", kind: "email", title: "Sam asks about September 19", note: "A scenario, not a change. Fee is shown; availability stays unknown.",
    from: "sam@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Would September 19 work instead? Half the NYC team has a conference on the 16th." },
  { key: "B2", explain: "The working plan moves to September 19 and Planned checks availability. The confirmed booking stays on September 16.", part: "B", kind: "email", title: "Dana wants the change", note: "Working plan moves; approved plan and booking stay on Sep 16. ccPlannie sends a non-binding inquiry.",
    from: "dana@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Yes, let's try to move it to the 19th." },
  { key: "B3", explain: "The 19th works: CAD 56,500 including the contract's CAD 3,500 date-change fee.", part: "B", kind: "supplier", title: "Planned quotes the change", note: "Sample data standing in for Planned's change quote." },
  { key: "B4", explain: "Dana chooses the September 19 offer. ccPlannie sends its higher price to Priya for fresh approval.", part: "B", kind: "email", title: "Dana: \"Looks good\"", note: "Recorded as Dana's choice. It does not substitute for finance approval.",
    from: "dana@acme.example", replyTo: "plannie-comparison", subject: "Re: Fall team offsite", body: "Looks good — let's do it." },
  { key: "B5", explain: "Priya approves the new date at CAD 56,500, including the change fee, and raises the spending cap to CAD 60,000.", part: "B", kind: "email", title: "Priya approves the date change", note: "CAD 1,500 over the old cap; Priya explicitly sets CAD 60,000.",
    from: "priya@acme.example", replyTo: "plannie-approval", subject: "Re: Approval R-2", body: "Approved R-2. Revise the cap to CAD 60,000." },
  { key: "B6", explain: "The approved change goes to Planned. September 16 stays confirmed while the change is pending.", part: "B", kind: "manager", title: "Alex sends the approved change to Planned", action: "authorize", note: "The booking stays on Sep 16 until the venue confirms." },
  { key: "B7", explain: "Planned confirms September 19 for 45 guests at CAD 56,500. The new terms replace the original booking.", part: "B", kind: "supplier", title: "Planned confirms the change", note: "Working plan, approval and booking now align." },
  { key: "B8", explain: "ccPlannie replies with the confirmed date, venue, price, and booking reference from the request record.", part: "B", kind: "email", title: "Dana asks where things stand", note: "A grounded status answer from the record.",
    from: "dana@acme.example", replyTo: "plannie-latest", subject: "Re: Fall team offsite", body: "Where are we on the offsite?" },
];

// Console fixtures: labeled, pre-recorded interpretations used ONLY by the console walkthrough, the
// multi-request fixture (scripts/console-fixture.mjs) and tests. Like the demo fixtures, they only PROPOSE
// intents; the domain still decides what each sender is allowed to do.
export const CONSOLE_FIXTURES = {
  "CX-leo-45": { intents: [I("change", "Make it 45 — Ops is joining.", { fields: { headcount: 45 } })], unresolved: [] },
  "CX-leo-45-again": { intents: [I("change", "Let's make it 45 people.", { fields: { headcount: 45 } })], unresolved: [] },
  "CX-dana-looks-good": { intents: [I("select", "Looks good, let's go with Maple Ridge.", { optionRef: "Maple Ridge" })], unresolved: [] },
  "CX-dana-approve": { intents: [I("approve", "Approved, go ahead.", { approvalRef: null })], unresolved: [] },
  "CX-priya-approve-R1": { intents: [I("approve", "Approve R-1. Cap CAD 55,000.", { approvalRef: "R-1", capTo: 55000 })], unresolved: [] },
  "CX-kickoff": {
    intents: [I("new_request", "Can the event team set up our Q1 sales kickoff?"), I("details", "60 people, two nights, March 9, 2028, everyone gets their own room. Budget CAD 140,000.", { fields: { headcount: 60, nights: 2, date: "2028-03-09", roomPolicy: "one_per_attendee", budget: 140000 } })],
    unresolved: [],
  },
  "CX-kickoff-70": { intents: [I("change", "Let's plan for 70.", { fields: { headcount: 70 } })], unresolved: [] },
  "CX-board": { intents: [I("new_request", "Please organize the spring board dinner."), I("details", "About 12 people, one night, everyone gets a room.", { fields: { headcount: 12, nights: 1, roomPolicy: "one_per_attendee" } })], unresolved: ["no date given"] },
  "CX-retreat": { intents: [I("new_request", "Leadership retreat in May, please."), I("details", "20 people, one night, own rooms, May 18, 2028.", { fields: { headcount: 20, nights: 1, roomPolicy: "one_per_attendee", date: "2028-05-18" } })], unresolved: [] },
};
Object.assign(FIXTURE_INTERPRETATIONS, CONSOLE_FIXTURES);
