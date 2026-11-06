/** Synthetic sources and hand-authored render specimens; never generated-answer evidence. */
export const VISIT_SOURCE = `Harbor Room workshop (fictional).
Members: Monday–Thursday 09:00–19:00; Friday 09:00–17:00; Saturday 10:00–16:00; closed Sunday.
Visitor passes: Tuesday and Thursday 13:00–17:00. Book by 17:00 the previous day; no same-day visitor bookings.
Each member may bring up to two accompanied guests. Guests may observe but cannot operate workshop tools.
Laser use requires a completed safety tour. Reservations: at most 90 minutes and two active reservations per member. Cancel at least four hours ahead. A request is not a confirmed booking.
Quiet desks: west alcove. Calls: call booth, reserved in 30-minute slots.
Desk prices, room capacity, weather policy and email/send capability are not stated.`;

export const KIT_SOURCE = `Observing kits (synthetic comparison, not a real shop).
Need: four observers, budget USD 250, carried weight at most 10 kg, setup at most 15 minutes.
Field kit: scope USD 160 + mount USD 35 + accessories USD 25; total 8 kg; setup 12 minutes; capacity four observers.
Travel kit: scope USD 190 + mount USD 45 + accessories USD 35; total 7 kg; setup 10 minutes; capacity four observers.
Pocket kit: scope USD 120 + mount USD 20 + accessories USD 20; total 5 kg; setup 8 minutes; capacity two observers.
Prices exclude unreported tax and shipping. Stock and booking are unknown. Selection makes no purchase or reservation.`;

export const CLARITY_CASES = [
  {
    id: 'visit', source: VISIT_SOURCE,
    prompt: 'Can I visit Harbor Room on Thursday at 14:30 with one guest, do quiet work and use the laser? Use the supplied workshop notes. Help me decide what to do next.',
    continuation: 'Can my guest use the laser after joining my safety tour? What deadline do I need to meet?',
    review: ['Answer and next action first; distinguish member hours from visitor windows.', 'Retain every opening time, previous-day 17:00 deadline, no same-day bookings and two accompanied guests.', 'Guests observe only; safety tour does not grant guest tool use. Retain 90-minute/two-active/four-hour limits, quiet desks and 30-minute call slots.', 'Keep unspecified facts unknown and requests distinct from confirmed bookings; no source/fixture essay.'],
  },
  {
    id: 'kit', source: KIT_SOURCE,
    prompt: 'Which observing kit fits our group and limits? Compare the supplied options and help me choose.',
    continuation: 'Why not the cheapest kit? Show me how you worked out the totals.',
    review: ['Lead with Field kit and the fit reason; USD 220/270/160 totals, capacities 4/4/2, weights 8/7/5 kg and setup 12/10/8 minutes remain available.', 'Travel is USD 20 over budget; Pocket is short two observers. Do not invent a score, stock, tax or booking.', 'One selection control; calculations and source passages on request without a default Original evidence essay. Selection is not a purchase.'],
  },
  {
    id: 'signing', source: 'Use a newly granted disposable editable agreement PDF; never a real user document.',
    prompt: 'Help me complete the attached agreement for Alex Morgan, Designer, alex@studio.example, dated October 30, 2026, and add my signature. Keep it ready for final review.',
    continuation: 'Use legal@studio.example for notices instead. Keep the agreement ready for my review before saving anything.',
    review: ['Omit the exact Review draft • Notices: legal@studio.example • No file saved. banner and the entire routine Source and signature details section.', 'Keep notices in the actual editable PDF binding, all fields/signature state and the same artifact identity; no save before approval.', 'Retain actionable missing-source, grant, render and export failures; compare original PDF bytes/hash and exact export review separately.'],
  },
] as const;

// Bound specimen inputs exercise catalog examples, not model quality or live execution.
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
