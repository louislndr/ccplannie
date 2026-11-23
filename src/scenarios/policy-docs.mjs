// A sample written policy per demo company, for trying "Upload a policy" on the Rules page. With a model
// configured the text is read live; without one, the recorded reading below is shown (labelled as such).
export const ACME_POLICY_DOC = {
  fileName: "Acme team offsite policy.md",
  text: `# Acme Robotics: team offsite policy

1. Requests. Anyone leading a team can ask for an offsite by emailing ccPlannie. Alex Moreau, our event manager, handles every request.
2. Venues. Alex asks Planned for options. If a venue hasn't answered within 3 days (72 hours), Alex follows up personally. When a plan changes after quotes are in, ccPlannie may ask the same venues again.
3. Spending. Priya Shah (Finance) approves every offsite before anything is booked. Keep lodging under CAD 250 per person per night where possible.
4. Booking. Dana Ruiz (VP Sales) wants to hear when an offsite is confirmed.
5. Travel. Book economy train tickets where available.`,
  reading: {
    defaultManager: "alex@acme.example", defaultFinanceApprover: "priya@acme.example", delegatedInquiries: true, supplierTimeoutHours: 72,
    flow: [{ kind: "notify", after: "confirmed", who: "dana@acme.example", over: null }],
    notCovered: ["Keep lodging under CAD 250 per person per night where possible.", "Book economy train tickets where available."],
  },
};

export const NORTHWIND_POLICY_DOC = {
  fileName: "Northwind events and offsites policy.md",
  text: `# Northwind Labs: events and offsites policy

## Who does what
- Department heads and their assistants may start an event request by emailing ccPlannie.
- Theo Martin, Events Lead, owns all new requests. Claire Dubois covers when Theo is away.
- Olivia Brown (People Operations) should be told whenever a new request comes in, so she can plan headcount.

## Venues
- Venues get two business days (48 hours) to answer. After that the events team chases them.
- If the plan changes after offers arrive, the events team decides when to go back to venues; don't re-ask automatically.

## Money
- Ava Singh, Finance Manager, approves event spending up to CAD 75,000.
- Anything above CAD 75,000 must be approved by Ben Okafor, Controller.
- Budget guideline: CAD 450 per person per night, all in.

## After booking
- Maya Chen (CEO) is told once an event is confirmed.
- Prefer venues within 90 minutes of a Northwind office.`,
  reading: {
    defaultManager: "theo@northwind.example", defaultFinanceApprover: "ava@northwind.example", delegatedInquiries: false, supplierTimeoutHours: 48,
    flow: [
      { kind: "notify", after: "received", who: "olivia@northwind.example", over: null },
      { kind: "escalate", after: "chosen", who: "ben@northwind.example", over: 75000 },
      { kind: "notify", after: "confirmed", who: "maya@northwind.example", over: null },
    ],
    notCovered: ["Claire Dubois covers when Theo is away (set as his backup on People; rerouting stays a manual admin step).", "Budget guideline: CAD 450 per person per night, all in.", "Prefer venues within 90 minutes of a Northwind office."],
  },
};
