// Juniper Works exercises the rules and recovery paths through the same email, approval, and outbox pipeline.
import { I } from "../demo.mjs";
import { DEFAULT_ROLES } from "../org.mjs";

const domain = "juniper.example";
const email = (local) => `${local}@${domain}`;
const person = (name, local, title, roles, manager = "imani", approveUpTo = null) => ({
  name, email: email(local), title, manager: manager ? email(manager) : null, roles, approveUpTo, backup: null,
});
const policy = {
  name: "Juniper Works event policy",
  defaultManager: email("dev"), defaultFinanceApprover: email("marta"),
  delegatedInquiries: false, supplierTimeoutHours: 24, plannedWorkspaceRef: "Juniper Works events",
  flow: [
    { id: "notify-operations", kind: "notify", after: "received", who: email("ravi") },
    { id: "hold-for-check", kind: "hold", after: "assigned", who: "" },
    { id: "loop-in-production", kind: "loopin", after: "sourcing", who: email("nia") },
    { id: "controller-approval", kind: "escalate", after: "chosen", who: email("elena"), over: 40000 },
    { id: "notify-booked", kind: "notify", after: "confirmed", who: email("ravi") },
  ],
};
const subject = "Spring design workshop";
const initial = "Please set up our spring design workshop. We need 40 people for one night starting March 9, 2028, one room per person, in eastern Ontario. Budget is CAD 55,000.";
const selection = "Let's go with Blue Heron Lodge.";
const alternative = "Let's use Cedar Wharf Retreat instead.";
const decline = "Decline R-1. Please find a less expensive option.";
const approve = "Approve R-2 at CAD 46,000. Set the cap at CAD 46,000.";
const fixtures = {
  F1: { intents: [I("new_request", "Please set up our spring design workshop."), I("details", initial, { fields: { headcount: 40, nights: 1, date: "2028-03-09", roomPolicy: "one_per_attendee", region: "eastern Ontario", budget: 55000 } })], unresolved: [] },
  F4: { intents: [I("status", "Where are we on the workshop?")], unresolved: [] },
  G4: { intents: [I("select", selection, { optionRef: "Blue Heron Lodge" })], unresolved: [] },
  H2: { intents: [I("decline", decline, { approvalRef: "R-1" })], unresolved: [] },
  H3: { intents: [I("select", alternative, { optionRef: "Cedar Wharf Retreat" })], unresolved: [] },
  H4: { intents: [I("approve", approve, { approvalRef: "R-2", capTo: 46000 })], unresolved: [] },
};
const manager = (key, title, explain, action, options = {}) => ({ key, part: key[0], kind: "manager", event: 0, title, explain, action, ...options });
const admin = (key, title, explain, op, options = {}) => ({ key, part: key[0], kind: "admin", event: 0, title, explain, op, ...options });
const reply = (key, title, explain, from, replyTo, body, options = {}) => ({ key, part: key[0], kind: "email", event: 0, title, explain, from: email(from), replyTo, subject: `Re: ${subject}`, body, ...options });
const supplier = (key, title, explain, what) => ({ key, part: key[0], kind: "supplier", event: 0, title, explain, planned: { direction: "from", what } });

export const JUNIPER = {
  id: "juniper", number: 3, title: "Juniper Works",
  tagline: "Change a company rule and watch it take effect",
  summary: "Shorten a venue deadline in the Rules flowchart, then follow the workshop through late replies, a failed approval email, and a lower-priced booking.",
  company: { id: "juniper", name: "Juniper Works (fictional)", domain, currency: "CAD", timezone: "America/Toronto" },
  start: "2027-11-01T14:00:00.000Z",
  org: { roles: DEFAULT_ROLES, people: [
    person("Imani Brooks", "imani", "Design Director", ["sponsor"], null),
    person("Dev Singh", "dev", "Event Manager", ["event_manager"]),
    person("Ravi Patel", "ravi", "Operations Lead", ["stakeholder"]),
    person("Nia Foster", "nia", "Production Coordinator", ["stakeholder"]),
    person("Marta Costa", "marta", "Finance Manager", ["finance"], "elena", 40000),
    person("Elena Chen", "elena", "Controller", ["finance"], "imani", 100000),
  ] },
  policy,
  policyDocument: {
    fileName: "Juniper Works event policy.md",
    text: `# Juniper Works event policy

- Imani Brooks starts workshop requests. Dev Singh owns new requests, and Ravi Patel gets an FYI when each request arrives.
- Hold each request when Dev accepts it so he can check the brief. Copy Nia Foster once sourcing starts.
- Give venues 24 hours to answer. Dev decides when to request revised quotes.
- Marta Costa handles spending up to CAD 40,000. Elena Chen handles amounts above that. Tell Ravi once Planned confirms the booking.
- Travellers book their own train tickets.`,
    reading: { defaultManager: email("dev"), defaultFinanceApprover: email("marta"), delegatedInquiries: false, supplierTimeoutHours: 24, flow: policy.flow, notCovered: ["Travellers book their own train tickets."] },
  },
  fixtures,
  venues: ["blueheron", "cedarwharf", "riverlight"],
  parts: [
    { id: "F", title: "Change the venue deadline", summary: "Edit the rule in the flowchart, clear a required check, and record a decision made on a call." },
    { id: "G", title: "Handle late or incomplete quotes", summary: "See the shorter deadline flag unanswered inquiries, then watch real quotes clear those warnings." },
    { id: "H", title: "Retry, decline, and approve a replacement", summary: "Retry one approval email, keep the decline on record, and approve the lower-priced venue separately." },
  ],
  steps: [
    { key: "F1", part: "F", kind: "email", title: "Imani requests a design workshop", explain: "Company rules send the request to Dev, the event manager, and give Ravi in Operations a separate FYI.", from: email("imani"), to: ["$intake"], subject, body: initial },
    admin("F2", "Shorten the venue reply deadline", "The Rules flowchart shows the deadline change. The workshop will use the shorter window when Dev asks for quotes.", "editTimeout", { timeoutHours: 8, adminPath: "/admin/policy#venue-reply-deadline" }),
    manager("F3", "Dev accepts and the rules pause sourcing", "Dev takes ownership. A company rule pauses the request so he can check the brief before contacting venues.", "accept"),
    reply("F4", "Imani asks for an update while paused", "Her email is recorded. ccPlannie sends no reply while the request is paused.", "imani", "plannie-latest", "Where are we on the workshop?", { keepRuleHold: true }),
    manager("F5", "Dev clears the check", "After reviewing the brief, Dev resumes ccPlannie and can start sourcing.", "resume"),
    manager("F6", "Dev records Imani’s decision from a call", "Imani changes the headcount to 44 on a call. History records Imani as the decision-maker and Dev as the person who entered it.", "manualDecision", { args: { decidedBy: email("imani"), fields: { headcount: 44 }, note: "Imani confirmed 44 guests", channel: "phone call" } }),
    manager("G1", "Dev asks Planned for three quotes", "Dev requests prices for 44 guests. A company rule copies Nia, the production coordinator, on future updates.", "requestQuotes", { planned: { direction: "to", what: "Request venue options for 44 guests" } }),
    manager("G2", "The reply deadline passes", "The new deadline has passed. Open items shows each venue that still owes a reply.", "timeouts", { waitForSupplierTimeout: true }),
    supplier("G3", "Planned sends offers after the deadline", "Two venues send prices. Riverlight confirms availability with no price. The replies clear the unanswered-inquiry warnings.", "Two priced offers and one availability-only response"),
    reply("G4", "The approval email fails to send", "The CAD 54,000 quote goes to Elena under the company’s spending rule. The delivery failure appears in Open items.", "imani", "plannie-comparison", selection, { simulateApprovalFailure: true }),
    admin("H1", "Retry the approval email", "Retry delivery sends the same approval email to Elena. One approval remains pending.", "retryApproval"),
    reply("H2", "Elena declines the first offer", "Elena declines Blue Heron at CAD 54,000. The decision stays in history and the booking never reaches Planned.", "elena", "plannie-approval", decline),
    reply("H3", "Imani picks the lower-priced option", "Cedar Wharf costs CAD 46,000. ccPlannie asks Elena for a fresh approval with the new venue and price.", "imani", "plannie-comparison", alternative),
    reply("H4", "Elena approves the replacement offer", "Finance approves Cedar Wharf for 44 guests at CAD 46,000. Dev can now authorize the booking.", "elena", "plannie-approval", approve),
    manager("H5", "Dev sends the approved booking", "Planned gets the exact approved terms. The request remains pending until Planned confirms.", "authorize", { planned: { direction: "to", what: "Book Cedar Wharf for the approved amount" } }),
    supplier("H6", "Planned confirms Cedar Wharf", "Only this confirmation creates the booking. Ravi receives a separate FYI under the company rules.", "Confirmation of the CAD 46,000 booking"),
    admin("H7", "Open the booking handoff", "Download the request from Details. It includes the decision from the call, both finance decisions, and Planned’s confirmation.", "handoff"),
  ],
};
