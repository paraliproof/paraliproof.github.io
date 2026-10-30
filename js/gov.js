// gov.js — the department side (Phase 2–3 of the 29 Oct build). NO DOM CODE HERE.
//
// Every officer action is a SIGNED, HASH-CHAINED, APPEND-ONLY log entry (kv 'govlog'):
//   { v, i, t, type, level, kid, pub, body, prev } + sig (ECDSA P-256 by this phone's device key)
//   + h = SHA-256(canonical entry + "|" + sig). Entry i links to entry i−1 through prev = h(i−1).
//   Editing, deleting or re-ordering any entry breaks verifyLog(). There is no update or delete API.
// Types: decision · visit · enrol · countersign · audit-seed · batch · dlec-decision · minutes.
//
// Principles (trust-model §0): never auto-pay, never auto-reject. The app only queues and summarises;
// every decision is made by a person, with a reason code, signed and logged. "Returned" means "back to
// today's normal verification", never "rejected". Grievances go to the SDM (2019 order: within 3 days).
//
// Random audit (G-8): the DDA commits a random season seed (its SHA-256 is logged). A claim is picked
// when HMAC-SHA256(seed, "PP-AUDIT-1|" + certificate id) read as a number in [0, 1) is below the rate
// (base 5 %, self-operated 20 % [ASSUMPTION], from Settings). Anyone holding the seed can re-derive
// every pick (auditScore below); operators can't predict it before the seed is revealed.

import { kv } from './store.js';
import { canonical, sha256b64u, b64u, unb64u, utf8, randomId, round } from './util.js';
import { signText, verifyText, getDeviceKey, isValidPubB64u } from './crypto.js';
import { hasPower, levelInfo, LEVEL_IDS } from './govroles.js';

export const DECISIONS = {
  VERIFIED: ['EVIDENCE_OK', 'VISIT_CONFIRMED', 'FLAG_EXPLAINED', 'AUDIT_PASSED'],
  NEEDS_VISIT: ['SAT_BURN', 'HIGH_FLAG', 'AUDIT_PICK', 'SELF_OP_CHECK', 'SLIP_CHECK'],
  RETURNED: ['NORMAL_VERIFICATION', 'WRONG_SLIP', 'NOT_REGISTERED', 'CHANGED', 'VISIT_FAILED'],
  REFER_SDM: ['FARMER_DISPUTE', 'OWNER_TENANT', 'OFFICER_CONFLICT'],
};
export const VISIT_OUTCOMES = ['WORK_DONE_NO_BURN', 'SOWN', 'BURNT', 'NOT_WORKED', 'COULD_NOT_VISIT'];
export const DLEC_CODES = { APPROVED: ['EVIDENCE_OK', 'VISIT_CONFIRMED'], RETURNED: ['NEEDS_VISIT', 'DOUBTFUL_EVIDENCE', 'NORMAL_VERIFICATION'] };
export const SDM_DAYS = 3;
const CERT_ID = /^PP-[0-9A-F]{10}$/;
const cleanNote = (s, n = 280) => String(s ?? '').replace(/[<>`\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const LOG_KEY = 'govlog', SEED_KEY = 'auditSeed';
const MAX_LOG = 5000;

// ---------------- who signs: this phone's key, or a DEMO officer account's own key ----------------
// Without an account (older installs, Settings → Officer level, judge mode) every entry is signed by the
// phone's device key, as before. A DEMO officer account (js/accounts.js) signs with its OWN key, generated
// on this phone the first time it signs (kv 'officerKey:<account id>'; non-extractable like the device key).
// So on the one-phone demo the ADO and the SDAO really are two different keys, and the two-person
// enrolment check below is a real check. At pilot each officer signs on their own phone after the
// department's own login.
let signerName = null;
/** Sign later log entries as this DEMO officer account (null = this phone's device key). app.js sets it. */
export function useOfficerKey(accountId) {
  signerName = typeof accountId === 'string' && /^[a-z]{3,12}$/.test(accountId) ? 'officerKey:' + accountId : null;
}
export const officerKeyName = () => signerName;
/** The key the next log entry will be signed with. */
export const signerKey = () => getDeviceKey(kv, signerName || 'deviceKey');
/** Run fn while signing as `accountId` (demo seeding: the ADO enrols, the DDA builds the batch), then restore. */
export async function withOfficerKey(accountId, fn) {
  const before = signerName;
  useOfficerKey(accountId);
  try { return await fn(); } finally { signerName = before; }
}

// ---------------- the signed, append-only log ----------------
let queue = Promise.resolve();
export async function readLog() { return (await kv.get(LOG_KEY)) || []; }
const entryHash = async (entry, sig) => sha256b64u(canonical(entry) + '|' + sig);

/** Append one signed entry. Serialised so two quick taps can never fork the chain. */
export function appendLog(type, level, body) {
  const run = async () => {
    if (!LEVEL_IDS.includes(level)) throw new Error('Choose your officer level in Settings first.');
    const key = await signerKey();
    const log = await readLog();
    if (log.length >= MAX_LOG) throw new Error('Log is full on this phone (export it first).');
    const last = log.at(-1);
    const entry = { v: 1, i: log.length, t: Date.now(), type, level, kid: key.kid, pub: key.pub, body, prev: last ? last.h : '0' };
    const sig = await signText(key.privateKey, canonical(entry));
    const rec = { ...entry, sig, h: await entryHash(entry, sig) };
    await kv.set(LOG_KEY, [...log, rec]);
    return rec;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Re-check every signature and link. @returns {{ok, n, badAt, reason}} */
export async function verifyLog(log) {
  log = log || await readLog();
  let prev = '0';
  for (let i = 0; i < log.length; i++) {
    const { sig, h, ...entry } = log[i] || {};
    if (entry.i !== i || entry.prev !== prev) return { ok: false, n: log.length, badAt: i, reason: 'link' };
    if (!isValidPubB64u(entry.pub) || !(await verifyText(entry.pub, canonical(entry), sig))) return { ok: false, n: log.length, badAt: i, reason: 'signature' };
    if ((await entryHash(entry, sig)) !== h) return { ok: false, n: log.length, badAt: i, reason: 'hash' };
    prev = h;
  }
  return { ok: true, n: log.length, badAt: null };
}

function need(level, power) { if (!hasPower(level, power)) throw new Error(`The ${levelInfo(level)?.name?.en || 'current'} level cannot do this. Switch level in Settings (demo).`); }
function needCert(id) { if (typeof id !== 'string' || !CERT_ID.test(id)) throw new Error('bad certificate id'); }

// ---------------- decisions ----------------
/** A person's decision on one claim: code + reason code + optional note, signed. */
export async function decide(level, certId, code, reason, note = '') {
  need(level, 'decide'); needCert(certId);
  if (!DECISIONS[code]?.includes(reason)) throw new Error('Choose a decision and a reason.');
  const body = { certId, code, reason, note: cleanNote(note) };
  if (code === 'REFER_SDM') body.due = new Date(Date.now() + SDM_DAYS * 864e5).toISOString().slice(0, 10);
  return appendLog('decision', level, body);
}

// ---------------- field visit report ----------------
export const MAX_PHOTO_CHARS = 450000; // ~330 KB JPEG as a data URL (the view downsizes to ≤ 960 px)
/** Village officer's visit report. photo = a data:image/jpeg URL made by the view (or null); gps = {lat, lon, acc} or null. */
export async function fileVisit(level, certId, { outcome, notes = '', photo = null, gps = null } = {}) {
  need(level, 'visit'); needCert(certId);
  if (!VISIT_OUTCOMES.includes(outcome)) throw new Error('Choose what you found at the field.');
  let photoHash = null;
  if (photo != null) {
    if (typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > MAX_PHOTO_CHARS) throw new Error('The photo could not be used (JPEG, under ~330 KB).');
    photoHash = await sha256b64u(photo);
    await kv.set('visitPhoto:' + photoHash, photo);
  }
  const g = gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lon) && Math.abs(gps.lat) <= 90 && Math.abs(gps.lon) <= 180
    ? { lat: round(gps.lat, 5), lon: round(gps.lon, 5), acc: Number.isFinite(gps.acc) ? Math.round(gps.acc) : null } : null;
  return appendLog('visit', level, { certId, outcome, notes: cleanNote(notes, 500), photoHash, gps: g, noGps: !g });
}
export async function visitPhoto(hash) {
  const p = await kv.get('visitPhoto:' + hash);
  return typeof p === 'string' && p.startsWith('data:image/jpeg;base64,') && (await sha256b64u(p)) === hash ? p : null;
}

// ---------------- two-person enrolment (G-2) ----------------
/** ADO: enrol a phone from its verified PPR1 registration → "pending" until the SDAO countersigns. */
export async function enrolPhone(level, settings, reg, saveSettings) {
  need(level, 'enrol');
  if (!reg?.ok || !isValidPubB64u(reg.pub)) throw new Error('Not a valid phone registration');
  const chc = String(reg.chc).replace(/[<>|"'`&]/g, ' ').slice(0, 40);
  const rec = await appendLog('enrol', level, { kid: reg.kid, pub: reg.pub, chc });
  settings.trustedKeys = [...(settings.trustedKeys || []).filter((k) => k.pub !== reg.pub),
    { kid: reg.kid, pub: reg.pub, chc, addedAt: Date.now(), via: 'registration', status: 'pending', enrolledBy: rec.h, enrolKid: rec.kid }];
  await saveSettings(settings);
  return settings.trustedKeys.at(-1);
}
export const SECOND_OFFICER = 'A second officer must countersign: this key made the enrolment.';
/** SDAO: countersign a pending enrolment → "active" (now trusted for payment). Refused when the signing key
 *  is the key that made the enrolment (two-person rule: one officer can never activate a phone alone). */
export async function countersignPhone(level, settings, pub, saveSettings) {
  need(level, 'countersign');
  const k = (settings.trustedKeys || []).find((x) => x.pub === pub);
  if (!k || k.status !== 'pending') throw new Error('This phone is not waiting for a countersignature.');
  // which key made the enrolment: kept on the entry, and re-read from the signed log (the log wins)
  let enrolKid = k.enrolKid || null;
  if (k.enrolledBy) {
    const e = (await readLog()).find((x) => x.h === k.enrolledBy && x.type === 'enrol');
    if (!e) throw new Error('The enrolment is not in the signed log on this phone.');
    enrolKid = e.kid;
  }
  if (enrolKid && enrolKid === (await signerKey()).kid) throw new Error(SECOND_OFFICER);
  const rec = await appendLog('countersign', level, { kid: k.kid, pub: k.pub, enrol: k.enrolledBy || null });
  k.status = 'active'; k.countersignedBy = rec.h; k.activeAt = Date.now();
  await saveSettings(settings);
  return k;
}

// ---------------- provable random audit (G-8) ----------------
export async function auditSeed() { return (await kv.get(SEED_KEY)) || null; }
/** DDA: commit a fresh random seed for the season. The commitment (SHA-256 of the seed) is logged. */
export async function commitSeed(level, { rate = 0.05, selfRate = 0.2, season = '2026-kharif' } = {}) {
  need(level, 'seed');
  if (!(rate >= 0 && rate <= 1 && selfRate >= 0 && selfRate <= 1)) throw new Error('Audit rates must be between 0 and 100 %.');
  const seed = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const commit = await sha256b64u(seed);
  const rec = await appendLog('audit-seed', level, { commit, rate, selfRate, season: cleanNote(season, 20) });
  const s = { seed, commit, rate, selfRate, season, setAt: Date.now(), logH: rec.h };
  await kv.set(SEED_KEY, s);
  return s;
}
/** Score in [0, 1): HMAC-SHA256(seed, "PP-AUDIT-1|" + certId), first 4 bytes. Anyone with the seed gets the same number. */
export async function auditScore(seed, certId) {
  const k = await crypto.subtle.importKey('raw', unb64u(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8('PP-AUDIT-1|' + certId)));
  return (((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0) / 4294967296;
}
export const isSelfOp = (e) => (Array.isArray(e?.payload?.f) ? e.payload.f : []).includes('SELF_OPERATED');
export function auditRateFor(e, seedRec) { return isSelfOp(e) ? seedRec.selfRate : seedRec.rate; }
/** Re-derive the picks for these entries (VALID certificates only). */
export async function auditPicks(entries, seedRec) {
  if (!seedRec?.seed) return new Map();
  const out = new Map();
  for (const e of entries) {
    if (e.status !== 'VALID' || !e.payload?.id) continue;
    const score = await auditScore(seedRec.seed, e.payload.id);
    const rate = auditRateFor(e, seedRec);
    out.set(e.payload.id, { score, rate, picked: score < rate, self: isSelfOp(e) });
  }
  return out;
}

// ---------------- DLEC batch (Phase 3, G-9) ----------------
/** DDA: freeze the current ready claims into a batch with evidence summaries (hashes). */
export async function buildBatch(level, entries, payableOf) {
  need(level, 'batch');
  const ready = entries.filter((e) => e.ready?.ready);
  if (!ready.length) throw new Error('No claim is ready for the DLEC list yet.');
  const items = ready.slice(0, 500).map((e) => ({ certId: e.payload.id, h: e.hash, acres: payableOf(e.payload).pa, stage: e.stage?.stage || '', reason: e.ready.reason }));
  const id = 'B-' + randomId('', 4);
  const acres = round(items.reduce((a, x) => a + x.acres, 0), 2);
  return appendLog('batch', level, { id, items, acres, n: items.length });
}
export async function dlecDecide(level, batchId, certIds, code, reason) {
  need(level, 'dlec');
  if (!DLEC_CODES[code]?.includes(reason)) throw new Error('Choose approve or return, and a reason.');
  const ids = [...new Set(certIds)].filter((x) => CERT_ID.test(x)).slice(0, 500);
  if (!ids.length) throw new Error('Select at least one claim.');
  return appendLog('dlec-decision', level, { batchId: String(batchId).slice(0, 12), certIds: ids, code, reason });
}
/** Signed minutes: date, members present (as typed), the decisions so far (by hash). */
export async function signMinutes(level, batchId, { date, members, note = '' }, log) {
  need(level, 'dlec');
  const mem = String(members ?? '').split(/[\n,;]+/).map((m) => cleanNote(m, 60)).filter(Boolean).slice(0, 20);
  if (!mem.length) throw new Error('Enter the members present.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Enter the meeting date.');
  log = log || await readLog();
  const decs = log.filter((x) => x.type === 'dlec-decision' && x.body.batchId === batchId);
  if (!decs.length) throw new Error('Record the decisions before signing the minutes.');
  const approved = new Set(), returned = new Set();
  for (const d of decs) for (const c of d.body.certIds) { (d.body.code === 'APPROVED' ? approved : returned).add(c); (d.body.code === 'APPROVED' ? returned : approved).delete(c); }
  return appendLog('minutes', level, { batchId: String(batchId).slice(0, 12), date, members: mem, note: cleanNote(note), approved: [...approved], returned: [...returned], decisionHashes: decs.map((d) => d.h) });
}

// ---------------- the officer context for services.dashboardEntries ----------------
/**
 * Build the per-certificate government state from the log: latest decision, visits, audit pick,
 * batch and DLEC result. Pass the result as `gov` to services.dashboardEntries().
 */
export async function loadGov() {
  const log = await readLog();
  const seed = await auditSeed();
  const byCert = new Map();
  const at = (id) => { if (!byCert.has(id)) byCert.set(id, { decisions: [], visits: [], decision: null, dlec: null, batchId: null }); return byCert.get(id); };
  const batches = [];
  for (const x of log) {
    const b = x.body || {};
    if (x.type === 'decision') { const s = at(b.certId); s.decisions.push(x); s.decision = { ...b, t: x.t, level: x.level, h: x.h }; }
    else if (x.type === 'visit') at(b.certId).visits.push(x);
    else if (x.type === 'batch') { batches.push(x); for (const it of b.items || []) at(it.certId).batchId = b.id; }
    else if (x.type === 'dlec-decision') for (const c of b.certIds || []) { const s = at(c); s.dlec = b.code; s.dlecReason = b.reason; s.dlecBatch = b.batchId; }
  }
  let picks = new Map();
  return {
    log, seed, batches,
    async prepare(entries) { picks = await auditPicks(entries, seed); },
    forCert(e) {
      const id = e?.payload?.id; if (!id) return null;
      const s = byCert.get(id) || { decisions: [], visits: [], decision: null, dlec: null, batchId: null };
      const a = picks.get(id) || null;
      return { ...s, audit: !!a?.picked, auditInfo: a };
    },
  };
}

// ---------------- claim queue (G-4) ----------------
// Priority: 0 burn suspected · 1 other high flag · 2 self-operated · 3 audit pick · 4 everything else
// a person must look at (no slip, phone not registered, changed). Older first within a priority.
export function queuePriority(e, FLAG_INFO) {
  const codes = [...(e.payload?.f || []), ...(e.extra || [])];
  if (e.stage?.stage === 'BURN_SUSPECTED') return 0;
  if (e.status === 'VALID' && codes.some((c) => FLAG_INFO[c]?.sev === 'high' && c !== 'UNTRUSTED_KEY')) return 1;
  if (codes.includes('SELF_OPERATED')) return 2;
  if (e.gov?.audit) return 3;
  return 4;
}
/** Open = still needs a person (not decided VERIFIED / RETURNED; not yet on a DLEC decision). */
export function claimQueue(entries, FLAG_INFO) {
  const open = [], decided = [];
  for (const e of entries) {
    const g = e.gov || {}, code = g.decision?.code;
    const needs = e.ready?.bucket === 'REVIEW' || (e.ready?.bucket === 'NOT_USABLE' && !code) || isSelfOp(e) || g.audit;
    if (!needs && !code) continue;
    const pr = queuePriority(e, FLAG_INFO);
    if (g.dlec || code === 'VERIFIED' || code === 'RETURNED') decided.push({ e, pr }); else open.push({ e, pr });
  }
  const sort = (a, b) => a.pr - b.pr || (a.e.payload?.t1 || 0) - (b.e.payload?.t1 || 0);
  return { open: open.sort(sort), decided: decided.sort((a, b) => (b.e.gov?.decision?.t || 0) - (a.e.gov?.decision?.t || 0)) };
}
/** Visit list for the village officer: open NEEDS_VISIT decisions, audit picks and burn alerts with no visit yet. */
export function visitList(entries) {
  return entries.filter((e) => {
    const g = e.gov || {};
    if (g.decision?.code === 'VERIFIED' || g.decision?.code === 'RETURNED' || g.dlec) return false;
    const want = g.decision?.code === 'NEEDS_VISIT' || g.audit || e.stage?.stage === 'BURN_SUSPECTED';
    const lastDecT = g.decision?.t || 0;
    return want && !g.visits.some((v) => v.t > lastDecT);
  }).sort((a, b) => (a.payload?.t1 || 0) - (b.payload?.t1 || 0));
}
