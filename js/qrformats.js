// qrformats.js — the three small QR formats around a certificate (NO DOM CODE HERE).
//
//   PPJ1|<json>               FARMER JOB SLIP (unsigned). In a rollout it comes from MFMB (Meri Fasal
//                             Mera Byora); here it is a DEMO slip the farmer makes in the app.
//                             {v:1, reg: MFMB registration no., kh: khasra / field id, ra: registered
//                              acres, c: field centre [lat, lon] and/or b: small boundary [[lat, lon]…],
//                              demo:1}
//                             The certificate keeps only jh = SHA-256(canonical slip) (22 chars) + ra,
//                             never reg or kh (privacy). The officer matches by hashing the slip.
//   PPM1|<json>|<sig>         MACHINE STICKER, signed by the sticker authority (here a DEMO key,
//                             js/authority.js). {v:1, mid: machine id, type: HS|SS|BL|MU|OT, w: width m,
//                             chc: CHC label, demo:1}. A valid sticker fixes machine type and width; the
//                             certificate carries mh = SHA-256("PPM1:" + mid) (16 chars) and ws:'S'.
//   PPR1|<json>|<sig>|<pub>   PHONE REGISTRATION, signed by the phone's own device key (proves it holds
//                             the key). {v:1, kid, chc: CHC label, t: unix s}. The officer scans it to enrol
//                             the phone (settings.trustedKeys).
//
// Every parser treats its input as hostile: length caps, JSON only, known keys only, strict
// types and ranges, canonical text for signed formats. Callers must still escape values in HTML.

import { canonical, sha256b64u, round, unb64u } from './util.js';
import { signText, verifyText, keyId, isValidPubRaw } from './crypto.js';
import { DEMO_AUTHORITY } from './authority.js';

export const MAX_QR_CHARS = 1200;
const BAD = /[|<>"'`&\u0000-\u001f\u007f]/;
const clean = (s, n = 40) => String(s ?? '').replace(/[|<>"'`&\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isLat = (x) => isNum(x) && x >= -90 && x <= 90, isLon = (x) => isNum(x) && x >= -180 && x <= 180;
export const IMPLEMENT_CODES = ['HS', 'SS', 'BL', 'MU', 'OT'];

function splitQr(str, prefix, parts) {
  const s = String(str ?? '').trim();
  if (s.length > MAX_QR_CHARS) throw new Error('QR text is too long');
  if (!s.startsWith(prefix + '|')) throw new Error(`Not a ${prefix} code`);
  const body = s.slice(prefix.length + 1);
  if (parts === 1) return [body];
  const out = [];
  let rest = body;
  for (let i = 0; i < parts - 1; i++) { const j = rest.lastIndexOf('|'); if (j < 0) throw new Error('QR code is incomplete'); out.unshift(rest.slice(j + 1)); rest = rest.slice(0, j); }
  out.unshift(rest);
  return out;
}
function parseJson(text, known) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('QR data is not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('QR data is not an object');
  for (const k of Object.keys(o)) if (!known.includes(k)) throw new Error(`unknown field "${clean(k, 12)}"`);
  return o;
}

// ---------------- PPJ1: farmer job slip ----------------
export const SLIP_PREFIX = 'PPJ1';
const SLIP_KEYS = ['v', 'reg', 'kh', 'ra', 'c', 'b', 'demo'];
/** Validate a slip object; returns a normalised copy or throws. */
export function checkSlip(o) {
  if (o.v !== 1) throw new Error('unsupported job-slip version');
  if (typeof o.reg !== 'string' || !/^[A-Za-z0-9/-]{4,24}$/.test(o.reg)) throw new Error('bad MFMB registration number');
  if (typeof o.kh !== 'string' || !/^[A-Za-z0-9/ .-]{1,20}$/.test(o.kh)) throw new Error('bad khasra / field id');
  if (!(isNum(o.ra) && o.ra > 0 && o.ra <= 100)) throw new Error('registered acres out of range (0–100)');
  if (o.c !== undefined && !(Array.isArray(o.c) && o.c.length === 2 && isLat(o.c[0]) && isLon(o.c[1]))) throw new Error('bad field centre');
  if (o.b !== undefined && !(Array.isArray(o.b) && o.b.length >= 3 && o.b.length <= 12 && o.b.every((p) => Array.isArray(p) && p.length === 2 && isLat(p[0]) && isLon(p[1])))) throw new Error('bad field boundary (3–12 corners)');
  if (o.c === undefined && o.b === undefined) throw new Error('the slip needs a field centre or boundary');
  if (o.demo !== undefined && o.demo !== 1) throw new Error('bad demo marker');
  const out = { v: 1, reg: o.reg, kh: o.kh, ra: round(o.ra, 2) };
  if (o.c) out.c = [round(o.c[0], 5), round(o.c[1], 5)];
  if (o.b) out.b = o.b.map(([a, c]) => [round(a, 6), round(c, 6)]);
  if (o.demo) out.demo = 1;
  return out;
}
export function makeSlip({ reg, kh, ra, c, b, demo = true }) {
  const slip = checkSlip({ v: 1, reg: String(reg).trim().toUpperCase(), kh: String(kh).trim(), ra: Number(ra), ...(c ? { c } : {}), ...(b ? { b } : {}), ...(demo ? { demo: 1 } : {}) });
  return { slip, qr: `${SLIP_PREFIX}|${canonical(slip)}` };
}
export function parseSlip(str) {
  const [text] = splitQr(str, SLIP_PREFIX, 1);
  const slip = checkSlip(parseJson(text, SLIP_KEYS));
  return { slip, qr: `${SLIP_PREFIX}|${canonical(slip)}` };
}
/** jh: what the certificate stores instead of the slip (22 chars of SHA-256 of the canonical slip). */
export async function slipHash(slip) { return (await sha256b64u(canonical(checkSlip(slip)))).slice(0, 22); }

// ---------------- PPM1: machine sticker (authority-signed) ----------------
export const STICKER_PREFIX = 'PPM1';
const STICKER_KEYS = ['v', 'mid', 'type', 'w', 'chc', 'demo'];
function checkSticker(o) {
  if (o.v !== 1) throw new Error('unsupported sticker version');
  if (typeof o.mid !== 'string' || !/^[A-Z0-9-]{3,24}$/.test(o.mid)) throw new Error('bad machine id');
  if (!IMPLEMENT_CODES.includes(o.type)) throw new Error('bad machine type');
  if (!(isNum(o.w) && o.w >= 0.5 && o.w <= 12)) throw new Error('working width out of range (0.5–12 m)');
  if (typeof o.chc !== 'string' || !o.chc.length || o.chc.length > 40 || BAD.test(o.chc)) throw new Error('bad CHC label');
  if (o.demo !== undefined && o.demo !== 1) throw new Error('bad demo marker');
  return o;
}
/** Sign a sticker (tools / tests only: the authority's private key is never in the app). */
export async function signSticker(privateKey, s) {
  const st = checkSticker({ v: 1, mid: s.mid, type: s.type, w: round(Number(s.w), 2), chc: clean(s.chc), ...(s.demo === false ? {} : { demo: 1 }) });
  const text = canonical(st);
  return `${STICKER_PREFIX}|${text}|${await signText(privateKey, text)}`;
}
/**
 * Verify a sticker against the authority key.
 * @returns {Promise<{status:'VALID'|'UNSIGNED'|'FORGED'|'INVALID', reason?:string, sticker?:object, mh?:string}>}
 */
export async function verifySticker(str, authorityPub = DEMO_AUTHORITY.pub) {
  let parts;
  const s = String(str ?? '').trim();
  try {
    if (s.length > MAX_QR_CHARS) throw new Error('QR text is too long');
    if (!s.startsWith(STICKER_PREFIX + '|')) throw new Error('Not a machine sticker (PPM1)');
    const body = s.slice(STICKER_PREFIX.length + 1), j = body.lastIndexOf('|');
    parts = j < 0 || body.slice(j + 1).startsWith('{') ? [body, ''] : [body.slice(0, j), body.slice(j + 1)];
  } catch (e) { return { status: 'INVALID', reason: e.message }; }
  let sticker;
  try { sticker = checkSticker(parseJson(parts[0], STICKER_KEYS)); } catch (e) { return { status: 'INVALID', reason: e.message }; }
  if (!parts[1]) return { status: 'UNSIGNED', reason: 'The sticker has no authority signature', sticker };
  if (canonical(sticker) !== parts[0] || !(await verifyText(authorityPub, parts[0], parts[1]))) return { status: 'FORGED', reason: 'The sticker signature does not match the authority key', sticker };
  return { status: 'VALID', sticker, mh: await machineHash(sticker.mid) };
}
export async function machineHash(mid) { return (await sha256b64u('PPM1:' + mid)).slice(0, 16); }

// ---------------- PPR1: phone registration (self-signed by the device key) ----------------
export const REG_PREFIX = 'PPR1';
const REG_KEYS = ['v', 'kid', 'chc', 't'];
export async function makeRegistration(key, chc, now = Date.now()) {
  const o = { v: 1, kid: key.kid, chc: clean(chc) || 'CHC', t: Math.round(now / 1000) };
  const text = canonical(o);
  return `${REG_PREFIX}|${text}|${await signText(key.privateKey, text)}|${key.pub}`;
}
/** @returns {Promise<{ok:boolean, reason?:string, kid?:string, pub?:string, chc?:string, t?:number}>} */
export async function verifyRegistration(str) {
  let text, sig, pub;
  try { [text, sig, pub] = splitQr(str, REG_PREFIX, 3); } catch (e) { return { ok: false, reason: e.message }; }
  let o;
  try { o = parseJson(text, REG_KEYS); } catch (e) { return { ok: false, reason: e.message }; }
  if (o.v !== 1 || typeof o.kid !== 'string' || !/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(o.kid) || typeof o.chc !== 'string' || !o.chc || o.chc.length > 40 || BAD.test(o.chc)
    || !Number.isInteger(o.t) || o.t < 1.5e9 || o.t > 4.1e9) return { ok: false, reason: 'The registration data is not valid' };
  let raw; try { raw = unb64u(pub); } catch { raw = null; }
  if (!raw || !isValidPubRaw(raw)) return { ok: false, reason: 'Public key must be an uncompressed P-256 point' };
  if ((await keyId(raw)) !== o.kid) return { ok: false, reason: 'The key id does not belong to this public key' };
  if (canonical(o) !== text || !(await verifyText(pub, text, sig))) return { ok: false, reason: 'The registration signature does not match' };
  return { ok: true, kid: o.kid, pub, chc: o.chc, t: o.t };
}

// ---------------- PPJ2: STATE-SIGNED job slip (trust-model D9, Phase 4b) ----------------
//   PPJ2|<json>|<sig>   signed by the state's slip key (here a DEMO key; the public key comes from the
//   verified state profile, js/profile.js). In a rollout the state portal issues it from land records.
//   {v:2, sid: random slip id (the matching key), st: state profile id, season, pid: parcel id,
//    b: official boundary (3–30 corners), ra: registered acres, role: owner | cultivator | lessee (from the
//    record, never asked of the farmer), ch: salted claimant hash (never the raw Farmer ID / MFMB no.),
//    mode?: declared method, exp: expiry (unix s), demo?: 1}
//   The certificate keeps jh (22 chars of SHA-256 of the canonical slip), ra, ss:'S' and the parcel hash
//   ph = SHA-256("PPJ2-PID|" + sid + "|" + pid) (16 chars; salted by the random sid, so a cadastral list
//   cannot be hashed to find the field behind a QR — G15). Never the parcel id itself.
export const STATE_SLIP_PREFIX = 'PPJ2';
export const MAX_STATE_SLIP_CHARS = 2000;
export const SLIP_ROLES = ['owner', 'cultivator', 'lessee'];
const SLIP2_KEYS = ['v', 'sid', 'st', 'season', 'pid', 'b', 'ra', 'role', 'ch', 'mode', 'exp', 'demo'];
function checkStateSlip(o) {
  for (const k of Object.keys(o)) if (!SLIP2_KEYS.includes(k) || o[k] === undefined && k !== 'mode') throw new Error(`unknown field "${clean(k, 12)}"`);
  if (o.v !== 2) throw new Error('unsupported state-slip version');
  if (typeof o.sid !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(o.sid)) throw new Error('bad slip id');
  if (typeof o.st !== 'string' || !/^(DEMO-)?[A-Z]{2}$/.test(o.st)) throw new Error('bad state id');
  if (typeof o.season !== 'string' || !/^\d{4}-(kharif|rabi)$/.test(o.season)) throw new Error('bad season');
  if (typeof o.pid !== 'string' || !/^[A-Za-z0-9/-]{3,32}$/.test(o.pid)) throw new Error('bad parcel id');
  if (!(Array.isArray(o.b) && o.b.length >= 3 && o.b.length <= 30 && o.b.every((p) => Array.isArray(p) && p.length === 2 && isLat(p[0]) && isLon(p[1])))) throw new Error('bad parcel boundary (3–30 corners)');
  if (!(isNum(o.ra) && o.ra > 0 && o.ra <= 100)) throw new Error('registered acres out of range (0–100)');
  if (!SLIP_ROLES.includes(o.role)) throw new Error('bad cultivator role');
  if (typeof o.ch !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(o.ch)) throw new Error('bad claimant hash');
  if (o.mode !== undefined && !IMPLEMENT_CODES.includes(o.mode)) throw new Error('bad declared method');
  if (!Number.isInteger(o.exp) || o.exp < 1.5e9 || o.exp > 4.1e9) throw new Error('bad expiry');
  if (o.demo !== undefined && o.demo !== 1) throw new Error('bad demo marker');
  return o;
}
/** Sign a state slip (tools / tests only: the state's private key is never in the app). */
export async function signStateSlip(privateKey, o) {
  const sl = checkStateSlip({ ...o, b: o.b.map(([a, c]) => [round(a, 6), round(c, 6)]), ra: round(o.ra, 2) });
  const text = canonical(sl);
  return `${STATE_SLIP_PREFIX}|${text}|${await signText(privateKey, text)}`;
}
/** Read the state id from a PPJ2 text without trusting anything else (to pick the profile's key). */
export function stateSlipState(str) {
  const s = String(str ?? '').trim();
  if (!s.startsWith(STATE_SLIP_PREFIX + '|') || s.length > MAX_STATE_SLIP_CHARS) return null;
  const body = s.slice(STATE_SLIP_PREFIX.length + 1), j = body.lastIndexOf('|');
  for (const text of j > 0 ? [body.slice(0, j), body] : [body]) {
    try { const o = JSON.parse(text); return typeof o?.st === 'string' && /^(DEMO-)?[A-Z]{2}$/.test(o.st) ? o.st : null; } catch { /* try the next split */ }
  }
  return null;
}
/**
 * Verify a state slip with the slip key from the (verified) state profile.
 * @returns {Promise<{status:'VALID'|'EXPIRED'|'FORGED'|'UNSIGNED'|'INVALID'|'WRONG_STATE', reason?, slip?, jh?, ph?}>}
 */
export async function verifyStateSlip(str, { slipKey, stateId, now = Date.now() } = {}) {
  const s = String(str ?? '').trim();
  if (s.length > MAX_STATE_SLIP_CHARS) return { status: 'INVALID', reason: 'QR text is too long' };
  if (!s.startsWith(STATE_SLIP_PREFIX + '|')) return { status: 'INVALID', reason: 'Not a state-signed slip (PPJ2)' };
  const body = s.slice(STATE_SLIP_PREFIX.length + 1), j = body.lastIndexOf('|');
  const [text, sig] = j < 0 || body.slice(j + 1).startsWith('{') || body.slice(j + 1).endsWith('}') ? [body, ''] : [body.slice(0, j), body.slice(j + 1)];
  let slip;
  try { slip = checkStateSlip(parseJson(text, SLIP2_KEYS)); } catch (e) { return { status: 'INVALID', reason: e.message }; }
  if (!sig) return { status: 'UNSIGNED', reason: 'The slip has no state signature', slip };
  if (stateId && slip.st !== stateId) return { status: 'WRONG_STATE', reason: `This slip is for ${slip.st}, not ${stateId}`, slip };
  if (!slipKey || canonical(slip) !== text || !(await verifyText(slipKey, text, sig))) return { status: 'FORGED', reason: 'The slip signature does not match the state slip key', slip };
  const jh = (await sha256b64u(STATE_SLIP_PREFIX + '|' + text)).slice(0, 22);
  const ph = (await sha256b64u('PPJ2-PID|' + slip.sid + '|' + slip.pid)).slice(0, 16);
  if (slip.exp * 1000 < now) return { status: 'EXPIRED', reason: `The slip expired on ${new Date(slip.exp * 1000).toISOString().slice(0, 10)}`, slip, jh, ph };
  return { status: 'VALID', slip, jh, ph };
}

/** Which format is this QR text? 'cert' | 'slip' | 'slip2' | 'sticker' | 'reg' | null */
export function qrKind(str) {
  const s = String(str ?? '').trim();
  return s.startsWith('PP1|') ? 'cert' : s.startsWith('PPJ1|') ? 'slip' : s.startsWith('PPJ2|') ? 'slip2' : s.startsWith('PPM1|') ? 'sticker' : s.startsWith('PPR1|') ? 'reg' : null;
}
