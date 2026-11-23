// Demo #2 — Northwind Labs (fictional): a bigger company with its own roles, running three storylines at once.
//   C  A 120-person sales kickoff: above one approver's limit, escalated by the admin, a spoofed approval refused.
//   D  An engineering offsite while the events lead is away: rerouted, a promotion mid-request, then applied.
//   E  Intake safety: an outside agency, an employee without request rights, and a new hire added and reprocessed.
// Every step runs through the same pipeline as real mail and the real console; fixtures only stand in for the
// model's reading of each email. Venue answers stand in for what Planned would send back (sample data).
import { NORTHWIND_POLICY_DOC } from "./policy-docs.mjs";
import { I } from "../demo.mjs";

const d = "northwind.example";
const P = (name, email, title, manager, roles, extra = {}) => ({ name, email: `${email}@${d}`, title, manager: manager ? `${manager}@${d}` : null, roles, approveUpTo: extra.limit ?? null, backup: extra.backup ? `${extra.backup}@${d}` : null });

export const NORTHWIND_ROLES = {
  leader: { label: "Department head", summary: "Owns their team's events and decides the plan", permissions: ["request", "decide"] },
  assistant: { label: "Executive assistant", summary: "Starts requests and fills in details for their executive", permissions: ["request"] },
  events_lead: { label: "Events lead", summary: "Runs every company event with Planned and books venues", permissions: ["manage"] },
  office_manager: { label: "Office manager", summary: "Runs local events for the Montréal office; backup for the events lead", permissions: ["request", "manage"] },
  finance_manager: { label: "Finance manager", summary: "Approves event spending up to their limit", permissions: ["approve"] },
  controller: { label: "Controller", summary: "Approves large event spending", permissions: ["approve"] },
  employee: { label: "Employee", summary: "Can suggest changes; can't start requests or decide", permissions: [] },
};

export const NORTHWIND_PEOPLE = [
  P("Maya Chen", "maya", "CEO", null, ["leader"]),
  P("Omar Haddad", "omar", "VP Sales", "maya", ["leader"]),
  P("Rina Patel", "rina", "Executive Assistant, Sales", "omar", ["assistant"]),
  P("Marcus Lee", "marcus", "Sales Representative", "omar", ["employee"]),
  P("Hannah Kim", "hannah", "Account Executive", "omar", ["employee"]),
  P("Diego Santos", "diego", "Sales Representative", "omar", ["employee"]),
  P("Jonas Berg", "jonas", "VP Engineering", "maya", ["leader"]),
  P("Kenji Watanabe", "kenji", "Engineering Manager", "jonas", ["employee"]),
  P("Sofia Alvarez", "sofia", "Staff Engineer", "jonas", ["employee"]),
  P("Ethan Wright", "ethan", "Backend Engineer", "kenji", ["employee"]),
  P("Amir Rahman", "amir", "Data Engineer", "kenji", ["employee"]),
  P("Zoe Turner", "zoe", "Product Designer", "jonas", ["employee"]),
  P("Lucas Moreau", "lucas", "VP Marketing", "maya", ["leader"]),
  P("Grace Liu", "grace", "Marketing Manager", "lucas", ["employee"]),
  P("Noah Clark", "noah", "Marketing Coordinator", "grace", ["employee"]),
  P("Theo Martin", "theo", "Events Lead", "maya", ["events_lead"], { backup: "claire" }),
  P("Claire Dubois", "claire", "Office Manager, Montréal", "maya", ["office_manager"]),
  P("Isabelle Roy", "isabelle", "Office Coordinator, Montréal", "claire", ["employee"]),
  P("Ava Singh", "ava", "Finance Manager", "ben", ["finance_manager"], { limit: 75000, backup: "ben" }),
  P("Ben Okafor", "ben", "Controller", "maya", ["controller"], { limit: 500000 }),
  P("Samuel Green", "samuel", "Finance Analyst", "ava", ["employee"]),
  P("Olivia Brown", "olivia", "People Operations Lead", "maya", ["employee"]),
  P("Leah Cohen", "leah", "Legal Counsel", "maya", ["employee"]),
];

export const NORTHWIND_POLICY = {
  name: "Northwind events policy (fictional)",
  defaultManager: `theo@${d}`,
  defaultFinanceApprover: `ava@${d}`,
  delegatedInquiries: true,
  supplierTimeoutHours: 48,
  plannedWorkspaceRef: "Northwind Labs workspace",
};

const OMAR_NOTE = `Rina — can you get our 2028 Sales Kickoff going? 120 people, two nights starting February 9, everyone gets their own room, close to Toronto. Budget is CAD 170,000.

Omar`;
const JONAS_REQ = `Hi ccPlannie, please organize our Q4 engineering offsite: 40 people, one night on October 14, 2027, everyone gets their own room, somewhere in the Laurentians. Budget CAD 60,000.

Jonas`;
const NINA_REQ = `Hi ccPlannie, I just joined the marketing team. Lucas asked me to set up our product launch party: about 80 guests on November 18, 2027 in Toronto. Budget is CAD 25,000.

Thanks,
Nina`;

export const NORTHWIND_FIXTURES = {
  C2: { intents: [
    I("new_request", "please set this up with the events team"),
    I("details", "120 people, two nights starting February 9, everyone gets their own room, close to Toronto. Budget is CAD 170,000.", { fromQuotedHistory: true, fields: { headcount: 120, nights: 2, date: "2028-02-09", roomPolicy: "one_per_attendee", region: "near Toronto", budget: 170000 } }),
  ], unresolved: [] },
  C6: { intents: [I("select", "Let's go with Lakeshore — it's ten minutes from the office.", { optionRef: "Lakeshore" })], unresolved: [] },
  C8: { intents: [I("approve", "Approve R-1.", { approvalRef: "R-1" })], unresolved: [] },
  C9: { intents: [I("approve", "Approve R-1. Set the cap at CAD 170,000.", { approvalRef: "R-1", capTo: 170000 })], unresolved: [] },
  D1: { intents: [
    I("new_request", "please organize our Q4 engineering offsite"),
    I("details", "40 people, one night on October 14, 2027, everyone gets their own room, somewhere in the Laurentians. Budget CAD 60,000.", { fields: { headcount: 40, nights: 1, date: "2027-10-14", roomPolicy: "one_per_attendee", region: "Laurentians", budget: 60000 } }),
  ], unresolved: [] },
  D6: { intents: [I("suggestion", "Could we do two nights? Half the team is flying in from Vancouver.", { fields: { nights: 2 } })], unresolved: [] },
  D8: { intents: [I("change", "Let's make it two nights.", { fields: { nights: 2 } })], unresolved: [] },
  D10: { intents: [I("select", "Laurentian Woods works for us.", { optionRef: "Laurentian" })], unresolved: [] },
  D11: { intents: [I("approve", "Approve R-2, cap CAD 60,000.", { approvalRef: "R-2", capTo: 60000 })], unresolved: [] },
  E1: { intents: [I("new_request", "please book a client dinner for 30 guests")], unresolved: [] },
  E2: { intents: [I("new_request", "Can you book a team lunch for 12 next Friday?")], unresolved: [] },
  E3: { intents: [
    I("new_request", "Lucas asked me to set up our product launch party"),
    I("details", "about 80 guests on November 18, 2027 in Toronto. Budget is CAD 25,000.", { fields: { headcount: 80, date: "2027-11-18", region: "Toronto", budget: 25000 } }),
  ], unresolved: ["how many nights, if any"] },
};

export const NORTHWIND = {
  id: "northwind", number: 2,
  title: "Northwind Labs",
  tagline: "See who can request, decide, and approve",
  summary: "Follow three requests as ccPlannie checks spending limits, applies a new team role, and holds email from someone outside the directory.",
  company: { id: "northwind", name: "Northwind Labs (fictional)", domain: d, currency: "CAD", timezone: "America/Toronto" },
  start: "2027-08-02T13:00:00.000Z",
  org: { people: NORTHWIND_PEOPLE, roles: NORTHWIND_ROLES },
  policy: NORTHWIND_POLICY,
  policyDocument: NORTHWIND_POLICY_DOC,
  fixtures: NORTHWIND_FIXTURES,
  venues: ["lakeshore", "bluesummit", "harbourline", "laurentian", "mapleridge"],
  parts: [
    { id: "C", title: "An approval above the spending limit", summary: "Reassign a CAD 168,000 approval to the controller and see how an unverified reply is handled." },
    { id: "D", title: "A new role changes who can decide", summary: "Reroute an offsite to a backup manager, then see how Sofia’s promotion changes what her next email can do." },
    { id: "E", title: "Which emails can open a request", summary: "See what stays in Intake review and what happens when a new hire is added to the directory." },
  ],
  steps: [
    // ---------------- C — approval escalation
    { key: "C1", part: "C", kind: "email", title: "Omar asks Rina for the kickoff", explain: "The kickoff starts as a private note from Omar to his assistant Rina.", note: "ccPlannie never sees mail it isn't copied on.",
      from: `omar@${d}`, to: [`rina@${d}`], cc: [], subject: "2028 Sales Kickoff", body: OMAR_NOTE },
    { key: "C2", part: "C", kind: "email", title: "Rina forwards it to ccPlannie", explain: "Rina has permission to start requests. ccPlannie opens the kickoff and routes it to Theo, the events lead.", note: "Rina may start requests; Omar's details come from the forwarded note.",
      from: `rina@${d}`, to: ["$intake"], cc: [`omar@${d}`], subject: "Fwd: 2028 Sales Kickoff",
      body: `Hi ccPlannie, please set this up with the events team. Omar's note is below.\n\n---------- Forwarded message ---------\nFrom: Omar Haddad <omar@${d}>\nSubject: 2028 Sales Kickoff\n\n${OMAR_NOTE}` },
    { key: "C3", part: "C", kind: "manager", event: 0, title: "Theo accepts the kickoff", explain: "Theo takes ownership. He can now ask Planned for quotes and send approved terms for booking.", action: "accept" },
    { key: "C4", part: "C", kind: "manager", event: 0, title: "Theo asks Planned for venue options", explain: "Theo sends the date and 120-person headcount to Planned so three venues can respond.", action: "requestQuotes", args: { supplierIds: ["lakeshore", "bluesummit", "harbourline"] },
      planned: { direction: "to", what: "Ask Planned to source venues for this brief" } },
    { key: "C5", part: "C", kind: "supplier", title: "Planned sends back venue options", explain: "Lakeshore and Blue Summit send quotes. Harbourline is too small. ccPlannie emails the comparison to Omar and Rina.", note: "Sample data standing in for Planned's sourcing results.",
      planned: { direction: "from", what: "Venue options: venue, capacity, price, what's included" } },
    { key: "C6", part: "C", kind: "email", title: "Omar picks Lakeshore", explain: "The CAD 168,000 quote exceeds Ava’s CAD 75,000 limit. ccPlannie puts the approval in Open items for reassignment.", note: "Blocked, not sent: the dashboard shows why.",
      from: `omar@${d}`, replyTo: "plannie-comparison", subject: "Re: 2028 Sales Kickoff", body: "Let's go with Lakeshore — it's ten minutes from the office.", adminPath: "/admin/requests" },
    { key: "C7", part: "C", kind: "admin", title: "The admin escalates to the controller", explain: "Ben’s spending limit covers the quote. Reassigning the approval sends the exact terms to his private approval thread.", op: "assignApproval", event: 0, to: `ben@${d}`, adminPath: "/admin/requests" },
    { key: "C8", part: "C", kind: "email", title: "A spoofed “approval” arrives", explain: "An email claiming to be from Ben fails the sender check. ccPlannie records the attempt and keeps the approval pending.", note: "Unverified sender: refused, and logged.",
      from: `ben@${d}`, replyTo: "plannie-approval", subject: "Re: Approval R-1", body: "Approve R-1.", identity: { verified: false, method: "spoofed sender (failed DKIM)" } },
    { key: "C9", part: "C", kind: "email", title: "Ben approves the exact terms", explain: "Ben’s verified reply approves CAD 168,000 for 120 guests at Lakeshore on February 9. The spending cap is CAD 170,000.",
      from: `ben@${d}`, replyTo: "plannie-approval", subject: "Re: Approval R-1", body: "Approve R-1. Set the cap at CAD 170,000.\n\nBen" },
    { key: "C10", part: "C", kind: "manager", event: 0, title: "Theo sends the approved booking to Planned", explain: "Theo sends the terms Ben approved to Planned. The kickoff remains pending until the venue confirms.", action: "authorize",
      planned: { direction: "to", what: "Book these exact, finance-approved terms" } },
    { key: "C11", part: "C", kind: "supplier", title: "Planned confirms the booking", explain: "Lakeshore confirms the approved date, guest count, and price. The kickoff is now booked.", note: "Sample data standing in for Planned's booking confirmation.",
      planned: { direction: "from", what: "Booking confirmation and contract summary" } },

    // ---------------- D — org changes mid-request
    { key: "D1", part: "D", kind: "email", title: "Jonas requests the engineering offsite", explain: "Jonas emails ccPlannie with Sofia and Kenji in copy. It goes to Theo by default.",
      from: `jonas@${d}`, to: ["$intake"], cc: [`sofia@${d}`, `kenji@${d}`], subject: "Q4 engineering offsite", body: JONAS_REQ },
    { key: "D2", part: "D", kind: "admin", title: "Theo is away: rerouted to Claire", explain: "The admin routes the request to Claire while Theo is away. Claire still needs to accept it.", op: "route", event: 1, to: `claire@${d}`, adminPath: "/admin/requests" },
    { key: "D3", part: "D", kind: "manager", event: 1, title: "Claire accepts the offsite", explain: "Claire, the Montréal office manager, accepts ownership and can now ask for quotes.", action: "accept" },
    { key: "D4", part: "D", kind: "manager", event: 1, title: "Claire asks Planned for options", explain: "Claire sends the one-night brief to two venues through Planned.", action: "requestQuotes", args: { supplierIds: ["laurentian", "mapleridge"] },
      planned: { direction: "to", what: "Ask Planned to source venues for this brief" } },
    { key: "D5", part: "D", kind: "supplier", event: 1, title: "Planned sends back options", explain: "Laurentian Woods can do it for CAD 31,600; Maple Ridge isn't available that day.", note: "Sample data standing in for Planned's sourcing results.",
      planned: { direction: "from", what: "Venue options and availability" } },
    { key: "D6", part: "D", kind: "email", title: "Sofia suggests two nights", explain: "Sofia can suggest two nights. The one-night plan stays in place while ccPlannie asks Jonas to decide.", note: "A suggestion, not a change.",
      from: `sofia@${d}`, replyTo: "plannie-comparison", subject: "Re: Q4 engineering offsite", body: "Could we do two nights? Half the team is flying in from Vancouver." },
    { key: "D7", part: "D", kind: "admin", title: "Sofia is promoted to team lead", explain: "The new Team lead role gives Sofia permission to change the plan. You can see her updated role on the People chart.", op: "people", adminPath: "/admin/people",
      patch: { roles: { team_lead: { label: "Team lead", summary: "Leads a team's planning; can decide the plan", permissions: ["decide"] } }, update: { [`sofia@${d}`]: { roles: ["team_lead"], title: "Staff Engineer, Team Lead" } } } },
    { key: "D8", part: "D", kind: "email", title: "Sofia's change now counts", explain: "Sofia’s new email changes the plan to two nights. The earlier quote covered one night, so Planned needs a new price.", note: "Same words, new authority: no retroactive changes.",
      from: `sofia@${d}`, replyTo: "plannie-latest", subject: "Re: Q4 engineering offsite", body: "Let's make it two nights." },
    { key: "D9", part: "D", kind: "supplier", event: 1, title: "Planned sends the revised price", explain: "Laurentian Woods quotes CAD 58,900 for two nights.", note: "Sample data standing in for Planned's revised offer.",
      planned: { direction: "from", what: "Revised offer for the new plan" } },
    { key: "D10", part: "D", kind: "email", title: "Jonas picks Laurentian Woods", explain: "Jonas picks the offer. CAD 58,900 is within Ava's limit, so she's asked to approve.",
      from: `jonas@${d}`, replyTo: "plannie-comparison", subject: "Re: Q4 engineering offsite", body: "Laurentian Woods works for us." },
    { key: "D11", part: "D", kind: "email", title: "Ava approves the engineering offsite", explain: "Ava approves two nights with a CAD 60,000 cap. The offsite still needs Claire to send the booking and Planned to confirm.",
      from: `ava@${d}`, replyTo: "plannie-approval", subject: "Re: Approval R-2", body: "Approve R-2, cap CAD 60,000.\n\nAva" },

    // ---------------- E — intake safety
    { key: "E1", part: "E", kind: "email", title: "An outside agency emails ccPlannie", explain: "The agency is outside the company directory. Its email goes to Intake review without opening a request or sending a reply.", note: "Unknown sender: held, nothing created.", adminPath: "/admin/requests",
      from: "events@brightside-agency.example", to: ["$intake"], cc: [], subject: "Client dinner booking", body: "Hello, please book a client dinner for 30 guests at a downtown venue next month and send the invoice to us. Thanks!" },
    { key: "E2", part: "E", kind: "email", title: "Marcus tries to start a request", explain: "Marcus is in the directory. His role can suggest changes, so his new request waits in Intake review.", note: "Known person, missing permission.", adminPath: "/admin/requests",
      from: `marcus@${d}`, to: ["$intake"], cc: [], subject: "Team lunch", body: "Can you book a team lunch for 12 next Friday?" },
    { key: "E3", part: "E", kind: "email", title: "A new hire emails before being set up", explain: "Nina is still missing from the directory. Her email waits in Intake review until she can start requests.", adminPath: "/admin/requests",
      from: `nina@${d}`, to: ["$intake"], cc: [`lucas@${d}`], subject: "Product launch party", body: NINA_REQ },
    { key: "E4", part: "E", kind: "admin", title: "The admin adds Nina", explain: "Nina joins the People chart under Lucas. Her assistant role gives her permission to start requests.", op: "people", adminPath: "/admin/people",
      patch: { add: [{ name: "Nina Okonkwo", email: `nina@${d}`, title: "Marketing Executive Assistant", manager: `lucas@${d}`, roles: ["assistant"], approveUpTo: null, backup: null }] } },
    { key: "E5", part: "E", kind: "admin", title: "Nina's held email is processed", explain: "The held email is checked against Nina’s new role. ccPlannie opens the launch request and asks for its missing details.", op: "reprocess", from: `nina@${d}`, adminPath: "/admin/requests" },
  ],
};
