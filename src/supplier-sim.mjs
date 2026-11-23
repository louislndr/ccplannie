// LOCAL SUPPLIER SIMULATOR — fictional venues, clearly labeled. Nothing here is a real business.
// Replies are generated only from the explicit inventory, price and term data below. It never reads
// or changes the company's event state; it only sees the emails sent to it.

export const SIM_DOMAIN = "venues.sim";

export const SUPPLIERS = {
  lakeview: {
    id: "lakeview", ref: "LV", name: "Lakeview Lodge", city: "Muskoka, ON", email: `groups@lakeview.${SIM_DOMAIN}`, contact: "Nora (group sales)",
    capacity: 40,
    available: ["2027-09-16"],
    // Fixed rate-sheet offers keyed by headcount|date|nights. No interpolation: anything else can't be quoted automatically.
    offers: { "30|2027-09-16|1": { amount: 46800, inclusions: "30 rooms × 1 night, meeting room, breakfast, lunch and dinner" } },
  },
  harbourline: {
    id: "harbourline", ref: "HL", name: "Harbourline Hotel", city: "Toronto, ON", email: `events@harbourline.${SIM_DOMAIN}`, contact: "Marco (events)",
    capacity: 36,
    available: ["2027-09-16"],
    offers: { "30|2027-09-16|1": { amount: 44200, inclusions: "30 rooms × 1 night, harbour-view meeting room, breakfast and dinner" } },
  },
  mapleridge: {
    id: "mapleridge", ref: "MR", name: "Maple Ridge Retreat", city: "Collingwood, ON", email: `sales@mapleridge.${SIM_DOMAIN}`, contact: "Jen (sales)",
    capacity: 60,
    available: ["2027-09-16", "2027-09-19"],
    offers: {
      "30|2027-09-16|1": { amount: 48900, inclusions: "30 rooms × 1 night, lodge hall, breakfast, lunch and dinner" },
      "45|2027-09-16|1": { amount: 53000, inclusions: "45 rooms × 1 night, lodge hall, breakfast, lunch and dinner" },
      "45|2027-09-19|1": { amount: 53000, inclusions: "45 rooms × 1 night, lodge hall, breakfast, lunch and dinner" },
    },
    contract: {
      id: "K-MR-20270916",
      title: "Maple Ridge Retreat — Group Sales Agreement (synthetic sample)",
      // Clause 9.2 is the one the demo relies on. Its terms are what the simulator itself applies.
      clauses: [
        { ref: "9.2", page: 3, text: "Date change. If the Group changes the Event dates more than thirty (30) days before the scheduled arrival date, a date-change fee of CAD 3,500 is payable, subject to availability on the new dates. Changes within thirty (30) days of arrival are treated as a cancellation under clause 10." },
        { ref: "10.1", page: 3, text: "Cancellation. Cancellation fees are set out in Schedule B." },
      ],
      dateChangeFee: { amount: 3500, minDaysBeforeArrival: 30 },
    },
  },
};

// Sample venue data for Demo #2 (Northwind Labs). In the product, these answers come from Planned's own
// sourcing; in the demos they are sample data so the story can run without a Planned account.
Object.assign(SUPPLIERS, {
  lakeshore: {
    id: "lakeshore", ref: "LS", name: "Lakeshore Conference Hotel", city: "Toronto, ON", email: `groups@lakeshore.${SIM_DOMAIN}`, contact: "Marisol (group sales)",
    capacity: 220,
    available: ["2028-02-09"],
    offers: { "120|2028-02-09|2": { amount: 168000, inclusions: "120 rooms × 2 nights, plenary hall for 150, four breakout rooms, all meals, AV" } },
    contract: {
      id: "K-LS-20280209",
      title: "Lakeshore Conference Hotel — Group Agreement (synthetic sample)",
      clauses: [
        { ref: "6.1", page: 2, text: "Date change. If the Group changes the Event dates more than sixty (60) days before the scheduled arrival date, a date-change fee of CAD 12,000 is payable, subject to availability on the new dates. Changes within sixty (60) days of arrival are treated as a cancellation under clause 7." },
        { ref: "7.1", page: 2, text: "Cancellation. Cancellation fees are set out in Schedule C." },
      ],
      dateChangeFee: { amount: 12000, minDaysBeforeArrival: 60 },
    },
  },
  bluesummit: {
    id: "bluesummit", ref: "BS", name: "Blue Summit Lodge", city: "Collingwood, ON", email: `events@bluesummit.${SIM_DOMAIN}`, contact: "Owen (events)",
    capacity: 160,
    available: ["2028-02-09"],
    offers: { "120|2028-02-09|2": { amount: 152400, inclusions: "120 rooms × 2 nights, main hall, all meals, shuttle from Toronto" } },
  },
  laurentian: {
    id: "laurentian", ref: "LW", name: "Laurentian Woods Retreat", city: "Mont-Tremblant, QC", email: `groupes@laurentian.${SIM_DOMAIN}`, contact: "Élodie (groupes)",
    capacity: 70,
    available: ["2027-10-14"],
    offers: {
      "40|2027-10-14|1": { amount: 31600, inclusions: "40 rooms × 1 night, workshop lodge, breakfast, lunch and dinner" },
      "40|2027-10-14|2": { amount: 58900, inclusions: "40 rooms × 2 nights, workshop lodge, all meals, guided hike" },
    },
  },
});

// Demo #3 options include two fixed offers and one venue with availability but no price.
Object.assign(SUPPLIERS, {
  blueheron: {
    id: "blueheron", ref: "BH", name: "Blue Heron Lodge", city: "Muskoka, ON", email: `groups@blueheron.${SIM_DOMAIN}`, contact: "Mira (group sales)",
    capacity: 60, available: ["2028-03-09"],
    offers: { "44|2028-03-09|1": { amount: 54000, inclusions: "44 rooms, main meeting room, AV and meals" } },
  },
  cedarwharf: {
    id: "cedarwharf", ref: "CW", name: "Cedar Wharf Retreat", city: "Kingston, ON", email: `events@cedarwharf.${SIM_DOMAIN}`, contact: "Lee (events)",
    capacity: 55, available: ["2028-03-09"],
    offers: { "44|2028-03-09|1": { amount: 46000, inclusions: "44 rooms, workshop room, breakfast and lunch" } },
  },
  riverlight: {
    id: "riverlight", ref: "RL", name: "Riverlight House", city: "Gananoque, ON", email: `groups@riverlight.${SIM_DOMAIN}`, contact: "Jamie (group sales)",
    capacity: 48, available: ["2028-03-09"], offers: {},
  },
});

export const supplierByEmail = (email) => Object.values(SUPPLIERS).find((s) => s.email === (email || "").toLowerCase()) || null;
export const isSupplierAddress = (email) => (email || "").toLowerCase().endsWith("." + SIM_DOMAIN);

// Parse the request block Plannie puts in outbound supplier mail. The simulator reads ONLY these fields.
export function parseRequestBlock(body) {
  const m = body.match(/--- Request details ---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}

const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86400000);

// Produce the supplier's reply to one request email (or null if it has nothing to say).
// `now` is the simulated clock; `bookings` is the simulator's OWN record of what it has confirmed.
export function supplierRespond(supplier, req, now, bookings) {
  const type = req.type, headcount = +req.headcount, nights = +req.nights, date = req.date;
  const key = `${headcount}|${date}|${nights}`;
  const ref = `${supplier.ref}-${req["request-ref"]}`;
  const block = (fields) => ["--- Offer details (simulated supplier system) ---", ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), "---"].join("\n");
  const sign = `\n\n${supplier.contact}\n${supplier.name} · ${supplier.city}\n(This venue is part of a local simulator. Fictional.)`;

  if (type === "quote" || type === "availability") {
    if (headcount > supplier.capacity) {
      return { text: `Thanks for thinking of us. Unfortunately we can host at most ${supplier.capacity} guests, so we can't quote ${headcount}.${sign}\n\n${block({ "request-ref": req["request-ref"], type: "cannot-quote", reason: "over-capacity", capacity: supplier.capacity })}` };
    }
    if (!supplier.available.includes(date)) {
      return { text: `We're fully committed on ${date}, sorry.${sign}\n\n${block({ "request-ref": req["request-ref"], type: "unavailable", date })}` };
    }
    const offer = supplier.offers[key];
    if (!offer) {
      return { text: `${date} is open, but this configuration isn't on our standard rate sheet. Our sales manager will follow up with pricing.${sign}\n\n${block({ "request-ref": req["request-ref"], type: "available-price-unknown", date, capacity: supplier.capacity })}` };
    }
    // Amendment quote: the venue applies its own contract terms to an existing booking.
    let fee = 0;
    const existing = req["booking-ref"] && bookings[req["booking-ref"]];
    if (existing && existing.date !== date && supplier.contract) {
      const f = supplier.contract.dateChangeFee;
      if (daysBetween(now, existing.date) > f.minDaysBeforeArrival) fee = f.amount;
    }
    const amount = offer.amount + fee;
    const feeLine = fee ? ` That total includes the CAD ${fee.toLocaleString("en-US")} date-change fee under clause 9.2 of your agreement.` : "";
    return {
      text: `Happy to help. For ${headcount} guests, ${nights} night${nights > 1 ? "s" : ""} on ${date}, our all-in price is CAD ${amount.toLocaleString("en-US")} (${offer.inclusions}).${feeLine} This is a quote, not a reservation.${sign}\n\n` +
        block({ "request-ref": req["request-ref"], type: existing ? "amendment-offer" : "offer", "offer-ref": ref, date, nights, headcount, rooms: headcount, amount, currency: "CAD", "includes-fee": fee, capacity: supplier.capacity, "booking-ref": req["booking-ref"] || "" }),
    };
  }

  if (type === "booking" || type === "amendment") {
    // The simulator re-checks its own rules before confirming.
    if (!supplier.available.includes(date) || headcount > supplier.capacity || !supplier.offers[key]) {
      return { text: `We can't confirm that request as sent.${sign}\n\n${block({ "request-ref": req["request-ref"], type: "declined" })}` };
    }
    const bookingRef = type === "booking" ? `${supplier.ref}-${88400 + Object.keys(bookings).length + 12}` : req["booking-ref"];
    const prev = bookings[bookingRef];
    let fee = 0;
    if (type === "amendment" && prev && prev.date !== date && supplier.contract && daysBetween(now, prev.date) > supplier.contract.dateChangeFee.minDaysBeforeArrival) fee = supplier.contract.dateChangeFee.amount;
    const amount = supplier.offers[key].amount + fee;
    if (req.amount && +req.amount !== amount) {
      return { text: `The amount in your request (CAD ${req.amount}) doesn't match our quote (CAD ${amount}). Please re-check.${sign}\n\n${block({ "request-ref": req["request-ref"], type: "declined", reason: "amount-mismatch" })}` };
    }
    bookings[bookingRef] = { date, headcount, nights, amount };
    const attach = type === "booking" && supplier.contract ? `\n\nAttached: ${supplier.contract.title} (${supplier.contract.id}).` : "";
    return {
      text: `Confirmed. ${type === "booking" ? "Your booking" : "The change to your booking"} ${bookingRef} is set for ${headcount} guests, ${nights} night${nights > 1 ? "s" : ""} on ${date}, CAD ${amount.toLocaleString("en-US")} all-in.${attach}${sign}\n\n` +
        block({ "request-ref": req["request-ref"], type: type === "booking" ? "booking-confirmed" : "amendment-confirmed", "booking-ref": bookingRef, date, nights, headcount, rooms: headcount, amount, currency: "CAD", "includes-fee": fee, contract: type === "booking" && supplier.contract ? supplier.contract.id : "" }),
      attachments: type === "booking" && supplier.contract ? [{ name: `${supplier.contract.id}.txt`, contentType: "text/plain", text: [supplier.contract.title, "", ...supplier.contract.clauses.map((c) => `[p.${c.page}] ${c.ref} ${c.text}`)].join("\n") }] : [],
    };
  }
  return null;
}

// Parse the offer block in a supplier reply. Anything outside the block is untrusted free text.
export function parseOfferBlock(body) {
  const m = (body || "").match(/--- Offer details \(simulated supplier system\) ---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}
