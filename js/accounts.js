// accounts.js — the DEMO accounts (DATA, not code). NO DOM CODE HERE.
//
// Nine made-up people, one per seat in the chain, so a mentor or judge can be handed one phone and walk
// the whole app account by account: three in the field (farmer, tractor operator, CHC owner) and the six
// government levels of js/govroles.js. Every name ends in "(demo)"; no real person, no ID number, no
// Aadhaar, no phone number. Places are the DEMO district and blocks the demo data already uses.
//
// Choosing an account only sets settings.role, settings.govLevel and settings.account, so roles.js
// (tabsFor / homeFor) keeps working unchanged. There is NO password, OTP or sign-up in the prototype:
// at pilot, officers sign in with the department's own login and farmers / operators are identified by the
// state at MFMB / Farmer ID registration (Aadhaar-seeded); ParaliProof never sees an Aadhaar number.
//
// Officer accounts sign the officer log with their OWN key, generated on this phone (js/gov.js
// useOfficerKey), so the two-person phone enrolment (ADO signs, SDAO countersigns) is a real check even on
// one phone. Field accounts use the phone's device key, as before.

import { LEVEL_IDS } from './govroles.js';

// the field accounts: the farmer's demo parcel at Abhaipur (the sat/ test parcel); the government side:
// the DEMO district of demo/demo-district.json (CHCs at Nissing, Indri, Gharaunda)
const FIELD_PLACE = { district: 'DEMO Patiala', block: 'DEMO block (Abhaipur)' };
const GOV_PLACE = { district: 'DEMO Karnal', block: 'DEMO block (Nissing)' };

export const ACCOUNT_GROUPS = ['field', 'gov'];

/**
 * id        stable account id (also the officer key name)     group   'field' | 'gov'
 * role      settings.role (roles.js ROLES)                    level   settings.govLevel (LEVEL_IDS) or null
 * icon      role icon (js/icons.js; officers = roles.js LEVEL_ICON)
 * name      an obviously made-up name with "(demo)"            roleKey string key for the role line
 * place     DEMO district and block (block: null = all blocks of the district / state)
 * home      the screen the account lands on (must be one of its tabs, or a role screen with data)
 * walkKey   the walkthrough sentence (strings-acc.js)
 */
export const DEMO_ACCOUNTS = Object.freeze([
  { id: 'farmer', group: 'field', role: 'farmer', level: null, icon: 'leaf', name: 'Gurpreet S. (demo)', roleKey: 'acc.r_farmer', place: FIELD_PLACE, home: 'farmer' },
  { id: 'operator', group: 'field', role: 'operator', level: null, icon: 'tractor', name: 'Balwinder R. (demo)', roleKey: 'acc.r_operator', place: FIELD_PLACE, home: 'job' },
  // the app has no separate fleet screen for an owner: the CHC owner is the operator role, landing on the
  // CHC register (My certificates). The demo fleet itself is on the officers' dashboard.
  { id: 'chc', group: 'field', role: 'operator', level: null, icon: 'implement', name: 'Manjit K. (demo)', roleKey: 'acc.r_chc', place: FIELD_PLACE, home: 'certs' },
  { id: 'village', group: 'gov', role: 'officer', level: 'village', icon: 'pin', name: 'Sunita D. (demo)', place: { ...GOV_PLACE, block: 'DEMO Village 1' }, home: 'visits' },
  { id: 'block', group: 'gov', role: 'officer', level: 'block', icon: 'list', name: 'Rakesh M. (demo)', place: GOV_PLACE, home: 'queue' },
  { id: 'sdao', group: 'gov', role: 'officer', level: 'sdao', icon: 'shield', name: 'Anil P. (demo)', place: { ...GOV_PLACE, block: 'DEMO sub-division (Karnal)' }, home: 'approvals' },
  { id: 'district', group: 'gov', role: 'officer', level: 'district', icon: 'grid', name: 'Kavita J. (demo)', place: { ...GOV_PLACE, block: null }, home: 'district' },
  { id: 'dlec', group: 'gov', role: 'officer', level: 'dlec', icon: 'layers', name: 'Vikram T. (demo)', place: { ...GOV_PLACE, block: null }, home: 'dlec' },
  { id: 'state', group: 'gov', role: 'officer', level: 'state', icon: 'map', name: 'Neha B. (demo)', place: { district: 'DEMO Haryana', block: null }, home: 'state' },
].map((a) => Object.freeze({ ...a, walkKey: 'walk.' + a.id })));

export const ACCOUNT_IDS = DEMO_ACCOUNTS.map((a) => a.id);
/** The walkthrough order: Farmer → Operator → CHC → Village → Block ADO → SDAO → DDA → DLEC → State. */
export const WALK_ORDER = ['farmer', 'operator', 'chc', 'village', 'block', 'sdao', 'district', 'dlec', 'state'];

export const accountInfo = (id) => DEMO_ACCOUNTS.find((a) => a.id === id) || null;
/** The chosen account, only while it still matches the role (and level) in settings; judge mode has none. */
export function accountOf(settings) {
  const a = accountInfo(settings?.account);
  if (!a || settings.tour || settings.role !== a.role) return null;
  if (a.level && settings.govLevel !== a.level) return null;
  return a;
}
export const isOfficerAccount = (a) => !!a && a.role === 'officer' && LEVEL_IDS.includes(a.level);

/** The three settings an account sets (the picker → settings mapping). Nothing else changes. */
export function accountSettings(id) {
  const a = accountInfo(id);
  if (!a) throw new Error('Unknown demo account');
  return { role: a.role, govLevel: a.level, account: a.id };
}
export function applyAccount(settings, id) { return Object.assign(settings, accountSettings(id)); }

/** After a role or level change in Settings: the account that matches it now (keep operator vs CHC), or null. */
export function matchAccount(settings) {
  const cur = accountInfo(settings?.account);
  if (!cur) return null;
  if (settings.role === cur.role && (!cur.level || settings.govLevel === cur.level)) return cur.id;
  const hit = DEMO_ACCOUNTS.find((a) => a.role === settings.role && (a.level ? a.level === settings.govLevel : !settings.govLevel || a.role !== 'officer'));
  return hit && (hit.role !== 'officer' || hit.level) ? hit.id : null;
}
