/** Bound specimen inputs exercise catalog examples, not model quality or live execution. */
export const VISIT_INPUTS = {
  visitAnswer: 'Thursday at 14:30 fits the visitor window with one accompanied guest. Complete your safety tour before laser use; your guest may only observe.',
  visitFacts: [
    { id: 'members', topic: 'Member hours', fact: 'Mon–Thu 09:00–19:00; Fri 09:00–17:00; Sat 10:00–16:00; Sun closed.' },
    { id: 'visitors', topic: 'Visitor hours', fact: 'Tue and Thu 13:00–17:00.' },
    { id: 'deadline', topic: 'Visitor deadline', fact: 'Book by Wednesday 17:00 for Thursday; no same-day visitor bookings.' },
    { id: 'guests', topic: 'Guests', fact: 'Up to two accompanied guests; observe only, no tool use.' },
    { id: 'laser', topic: 'Laser', fact: 'Completed safety tour; 90 minutes maximum; two active reservations; cancel at least four hours ahead.' },
    { id: 'quiet', topic: 'Quiet work', fact: 'West alcove desks; call booth in 30-minute slots.' },
    { id: 'unknown', topic: 'Not stated', fact: 'Desk prices, room capacity, weather policy and email/send capability.' },
  ],
  visitNext: 'Request the visitor pass by Wednesday 17:00, then check the tour and laser slot. A request is not a confirmed booking.',
};

export const KIT_INPUTS = {
  kitAnswer: 'Choose Field kit: four observers for USD 220, 8 kg and 12 minutes of setup fit every stated limit.',
  kits: {
    criteria: [{ id: 'cost', label: 'Total', unit: 'USD' }, { id: 'capacity', label: 'Observers' }, { id: 'weight', label: 'Weight', unit: 'kg' }, { id: 'setup', label: 'Setup', unit: 'minutes' }],
    options: [
      { id: 'field', label: 'Field kit', summary: 'Fits all limits', values: { cost: 220, capacity: 4, weight: 8, setup: 12 } },
      { id: 'travel', label: 'Travel kit', summary: 'USD 20 over budget', values: { cost: 270, capacity: 4, weight: 7, setup: 10 } },
      { id: 'pocket', label: 'Pocket kit', summary: 'Two observers short', values: { cost: 160, capacity: 2, weight: 5, setup: 8 } },
    ],
  },
  kitNext: 'Check tax, shipping and stock before purchasing. Choosing a kit does not place an order or reserve it.',
};
