// The demo scenarios the standalone demo can run. Each brings its own fictional company (people, roles,
// policy), a scripted story and the recorded readings of its emails. Switching scenarios resets the demo.
import { ACME_POLICY_DOC } from "./policy-docs.mjs";
import { DEMO_STEPS, DEMO_START, FIXTURE_INTERPRETATIONS } from "../demo.mjs";
import { SAMPLE_ORG, SAMPLE_POLICY } from "../config.mjs";
import { DEFAULT_ROLES } from "../org.mjs";
import { NORTHWIND } from "./northwind.mjs";
import { JUNIPER } from "./juniper.mjs";

// In Demo #1, steps that exchange information with Planned (the brief out, venue options and bookings back).
const ACME_PLANNED = {
  A5: { direction: "to", what: "Ask Planned to source venues for this brief" },
  A6: { direction: "from", what: "Venue options: venue, capacity, price, what's included" },
  A8: { direction: "to", what: "Ask Planned for a revised offer for 45 people" },
  A9: { direction: "from", what: "Revised offer for the new plan" },
  A12: { direction: "to", what: "Book these exact, finance-approved terms" },
  A13s: { direction: "from", what: "Booking confirmation and contract summary" },
  B2: { direction: "to", what: "Ask Planned whether the 19th is available, and at what price" },
  B3: { direction: "from", what: "Change quote, including the contract's date-change fee" },
  B6: { direction: "to", what: "Change the booking to these exact, finance-approved terms" },
  B7: { direction: "from", what: "Change confirmed" },
};

export const ACME = {
  id: "acme", number: 1,
  title: "Acme Robotics",
  tagline: "Book an offsite, then change the date",
  summary: "See how an email turns into a request, how finance approves the exact price, and when Planned confirms the booking.",
  company: { id: "acme", name: "Acme Robotics (fictional)", domain: "acme.example", currency: "CAD", timezone: "America/Toronto" },
  start: DEMO_START,
  org: { people: SAMPLE_ORG, roles: DEFAULT_ROLES },
  policy: SAMPLE_POLICY,
  policyDocument: ACME_POLICY_DOC,
  fixtures: {},
  venues: ["lakeview", "harbourline", "mapleridge"],
  parts: [
    { id: "A", title: "From request to confirmed booking", summary: "An assistant forwards a request. ccPlannie collects details, shares Planned's options, gets finance approval of exact terms, and the booking is confirmed." },
    { id: "B", title: "Change a confirmed booking", summary: "Check the contract fee, get fresh finance approval, and keep the original date until Planned confirms the new one." },
  ],
  steps: DEMO_STEPS.map((s) => (ACME_PLANNED[s.key] ? { ...s, planned: ACME_PLANNED[s.key] } : s)),
};

export const SCENARIOS = { acme: ACME, northwind: NORTHWIND, juniper: JUNIPER };
export const scenario = (id) => SCENARIOS[id] || ACME;
for (const s of Object.values(SCENARIOS)) Object.assign(FIXTURE_INTERPRETATIONS, s.fixtures);
