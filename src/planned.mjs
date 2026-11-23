// ccPlannie ⇄ Planned. This is where the connection to Planned plugs in. It is NOT connected: there are no
// Planned credentials here, and Planned's connector tool names aren't public.
//
// How it would connect: Planned offers an MCP connector ("plan and manage events from the AI assistant your
// team already uses … source venues, check event status and pull spend") and a Zip integration ("once a
// request is approved, the event opens in Planned"). ccPlannie would connect the same way, authorized by the
// company's Planned administrator, and exchange exactly these things (see the demo's "How it connects" page):
//   → open the event once the event manager accepts the request (title, dates, headcount, nights, rooms,
//     area, requested budget, requester, owner)
//   → ask for venue options (the brief only)
//   → book exactly the finance-approved, authorized terms (with the approval id)
//   → ask for a revised offer / change a booking when the plan changes
//   ← venue options, revised offers (including contract fees), booking confirmations with a contract
//     summary, status and spend
// Never sent: internal email discussion, who-may-decide checks, approval codes; budget caps aren't shared with
// venues. Company roles and approvals are enforced in ccPlannie before anything is sent.
//
// In the demos, Planned's answers are sample data (src/supplier-sim.mjs) so the story runs end to end; the
// exchanges are listed on the admin dashboard's Planned page. A real integration would also need:
// idempotency keys per operation, Planned's ids stored next to ours, and periodic read-back to reconcile.

export const plannedAdapter = {
  // `demo`: true on the demo server (Planned's answers are sample data there).
  status(workspaceRef = "", { demo = false } = {}) {
    return demo
      ? {
          state: "sample", label: "Sample data (demo)",
          detail: "The demo uses sample venue offers and booking confirmations. The Planned page shows each exchange in the story.",
          workspaceRef: workspaceRef || null, verified: false,
        }
      : {
          state: "not_connected", label: "Not connected",
          detail: "Your Planned administrator needs to authorize the connection before ccPlannie can exchange venue requests and bookings with Planned.",
          workspaceRef: workspaceRef || null,
          workspaceRefNote: workspaceRef ? "Saved as a note. A reference alone doesn't connect anything." : null,
          verified: false,
        };
  },
  // Every operation fails closed until a real, authorized connection replaces this object.
  async push() {
    throw Object.assign(new Error("Planned is not connected. Use the handoff export instead."), { status: 501 });
  },
};
