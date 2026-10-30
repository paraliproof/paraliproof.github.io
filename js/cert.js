// cert.js — build, sign, encode, decode and verify ParaliProof certificates.
//
// A certificate is a small JSON "payload" (below), signed with the device's
// ECDSA key. The QR code carries the compact string
//
//     PP1|<payload JSON>|<signature>|<public key>
//
// The JSON is readable text, so any QR scanner app shows what is claimed;
// only the ParaliProof verifier can check the signature.
//
// Payload fields (short names keep the QR small). PRIVACY: no names, phone numbers or IDs.
// The QR does show the field label, an approximate (village-level, 2-decimal ≈ 1 km)
// location, and the date and time of the work.
//   v    format version (1)            id   certificate id
//   n    sequence number on device     prev SHA-256 of the previous certificate
//                                           from this device ("0" for the first) → HASH CHAIN
//   fl   field label (not a name)      fh   SHA-256 of the field boundary coordinates
//   fc   field centre [lat, lon], rounded to 2 dp (≈ 1.1 km, village level) — review P-1
//   fa   field area, acres             im   implement code, w working width (m)
//   t0   start, t1 end (Unix seconds)  wm   minutes classified WORKING
//   wa   worked acres inside field     cv   coverage % of field
//   oa   worked acres outside field    th   track hash = SHA-256 of all raw samples
//   av   app version                   cl   classifier id@version
//   f    integrity flags               xh   SHA-256 of the optional extension sections
//   sv   satellite verdict, signed: N not burned · B burn suspected · I inconclusive · - none (review F-06)
//   cp   SHA-256 of the classifier parameters used (calibration + speed limits) (review F-18)
//   demo 1 if produced by the simulator
// Version 2 (29 Oct, anti-cheat set) adds, all inside the signature:
//   ws   width source: S = authority-signed machine sticker (PPM1) · M = typed by hand (WIDTH_SELF_DECLARED)
//   mh   machine-id hash (16 chars of SHA-256("PPM1:" + machine id)), only with ws = S
//   ra   registered acres from the farmer's job slip (PPJ1)      jh  22 chars of SHA-256 of the canonical slip
//        (the slip's MFMB registration no. and khasra are NEVER in the certificate — privacy)
//   Payable acres are not stored: payable = min(wa worked, fa field polygon, ra registered), see services.
//   fm   (optional, added 29 Oct, Phase 1) how the field boundary was made: T tapped on the map ·
//        W walked with GPS · C stood at corners · J from the farmer's slip · I imported · D demo parcel
//   ss   (optional, Phase 4) slip source: S = state-signed slip (PPJ2) · F = farmer-made slip while a state
//        profile is active ("no state slip" → normal verification)        ph  salted parcel hash (with ss = S)
//   sp   (optional, Phase 4) state profile id@version whose rules applied, e.g. DEMO-HR@2026.1
//   Version-1 certificates (no ws/mh/ra/jh) and v2 certificates without fm / ss / ph / sp still verify unchanged.
//
// VERIFICATION ORDER (verifyCert): format → public key is an uncompressed P-256 point →
// low-S ECDSA signature → canonical text → checkPayload() plausibility (types, ranges) →
// extension hash. Only then is the certificate VALID. A VALID certificate proves WHO signed
// (device key) and that nothing changed — whether that device is trusted is decided by the
// officer's registry (services.verifyAndRegister / dashboardEntries).
//
// HASH CHAIN: every certificate contains the hash of the one before it. If a
// device owner deletes or rewrites an old certificate, the chain no longer
// links up, and the dashboard reports CHAIN_BREAK.
//
// EXTENSIONS (optional, may be absent): ext.satellite, ext.ml, ext.impact.
// They live in the full certificate JSON; the signed payload carries only
// their hash `xh`, so they are tamper-evident without making the QR bigger.

import { canonical, sha256b64u, round, randomId } from './util.js';
import { signText, verifyText, keyId, isValidPubRaw, isLowS } from './crypto.js';
import { unb64u } from './util.js';
import { FIELD_METHODS } from './crosscheck.js';

export const PREFIX = 'PP1';

export async function fieldHash(boundary) {
  return sha256b64u(canonical(boundary.map(([a, b]) => [round(a, 7), round(b, 7)])));
}

// Field labels may be Hindi/Punjabi/Latin; we drop characters that could break the QR
// format or be read as markup anywhere ( | < > " ' ` & and control characters).
const BAD_LABEL = /[|<>"'`&\u0000-\u001f\u007f]/g;
const cleanLabel = (s) => String(s || '').replace(BAD_LABEL, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Signed one-letter satellite verdict (review F-06). */
export function satVerdictCode(sat) {
  if (!sat || sat.error || !sat.verdict) return '-';
  return { NOT_BURNED: 'N', BURN_SUSPECTED: 'B' }[sat.verdict] || 'I';
}

export function extHash(ext) {
  if (!ext || !Object.keys(ext).some((k) => ext[k] != null)) return null;
  const clean = {};
  for (const k of Object.keys(ext)) if (ext[k] != null) clean[k] = ext[k];
  return sha256b64u(canonical(clean));
}

/**
 * @param {object} a
 * @param {object} a.key     device key {privateKey, pub, kid}
 * @param {object} a.chain   {n, h} — last sequence number and hash on this device
 */
export async function issueCertificate({ key, chain, field, job, coverage, flags, ext, appVersion }) {
  const n = (chain?.n || 0) + 1;
  const payload = {
    v: 1,
    id: 'PP-' + randomId('', 5),
    n,
    prev: chain?.h || '0',
    fl: cleanLabel(field.label),
    fh: await fieldHash(field.boundary),
    fc: [round(field.centroid[0], 2), round(field.centroid[1], 2)],
    fa: round(coverage.fieldAcres, 2),
    im: job.implement,
    w: job.widthM,
    t0: Math.round(job.t0 / 1000),
    t1: Math.round(job.t1 / 1000),
    wm: round(job.timeMs.WORKING / 60000, 1),
    wa: round(coverage.workedAcres, 2),
    cv: round(coverage.coveragePct, 1),
    oa: round(coverage.outsideAcres, 2),
    th: job.trackHash,
    av: appVersion,
    cl: `${job.classifier.id}@${job.classifier.version}`,
    f: flags,
  };
  // version 2: machine sticker + farmer job slip (anti-cheat set)
  if (job.machine !== undefined || job.slip !== undefined) {
    payload.v = 2;
    payload.ws = job.machine?.source === 'sticker' && job.machine?.mh ? 'S' : 'M';
    if (payload.ws === 'S') payload.mh = job.machine.mh;
    if (job.slip?.jh) { payload.jh = job.slip.jh; payload.ra = round(job.slip.ra, 2); }
    if (FIELD_METHODS.includes(job.fieldMethod)) payload.fm = job.fieldMethod;
    // Phase 4: slip source (S state-signed PPJ2 · F farmer-made while a state profile is active), salted parcel hash, profile
    if (job.slip?.jh && (job.slip.ss === 'S' || job.slip.ss === 'F')) payload.ss = job.slip.ss;
    if (payload.ss === 'S' && typeof job.slip.ph === 'string') payload.ph = job.slip.ph;
    if (typeof job.sp === 'string') payload.sp = job.sp;
  }
  payload.sv = satVerdictCode(ext?.satellite);
  if (job.cp) payload.cp = job.cp;
  const xh = await extHash(ext);
  if (xh) payload.xh = xh;
  if (job.demo) payload.demo = 1;
  const bad = checkPayload(payload);
  if (bad) throw new Error('Refusing to sign an implausible certificate: ' + bad);
  const text = canonical(payload);
  const sig = await signText(key.privateKey, text);
  const qr = `${PREFIX}|${text}|${sig}|${key.pub}`;
  const hash = await sha256b64u(qr);
  return {
    id: payload.id, qr, hash, payload, ext: ext || {}, kid: key.kid,
    createdAt: Date.now(), newChain: { n, h: hash },
  };
}

/** Split a QR string into its parts. Throws on bad format. */
export function decodeCert(str) {
  const s = String(str || '').trim();
  if (!s.startsWith(PREFIX + '|')) throw new Error('Not a ParaliProof certificate (must start with PP1|)');
  const iPub = s.lastIndexOf('|'), iSig = s.lastIndexOf('|', iPub - 1);
  if (iSig <= PREFIX.length) throw new Error('Certificate is incomplete');
  const text = s.slice(PREFIX.length + 1, iSig);
  const sig = s.slice(iSig + 1, iPub), pub = s.slice(iPub + 1);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Certificate data is not valid JSON'); }
  return { text, sig, pub, payload };
}

// ---------------- payload schema / plausibility (review F-05) ----------------
const B64_43 = /^[A-Za-z0-9_-]{43}$/;
const KNOWN = new Set(['v', 'id', 'n', 'prev', 'fl', 'fh', 'fc', 'fa', 'im', 'w', 't0', 't1', 'wm', 'wa', 'cv', 'oa', 'th', 'av', 'cl', 'f', 'xh', 'demo', 'sv', 'cp', 'ws', 'mh', 'ra', 'jh', 'fm', 'ss', 'ph', 'sp']);
const V2_ONLY = ['ws', 'mh', 'ra', 'jh', 'fm', 'ss', 'ph', 'sp'];
export const MAX_SEQ = 1e6;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const inR = (x, a, b) => isNum(x) && x >= a && x <= b;
export const FLAG_RE = /^[A-Z][A-Z0-9_]{1,23}$/;

/**
 * Plausibility check of a payload's types and ranges.
 * @returns {string|null} a reason when the payload is NOT acceptable, else null.
 */
export function checkPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'payload is not an object';
  for (const k of Object.keys(p)) if (!KNOWN.has(k)) return `unknown field "${k}"`;
  if (p.v !== 1 && p.v !== 2) return 'unsupported version';
  if (p.v === 1 && V2_ONLY.some((k) => k in p)) return 'version-1 certificate with version-2 fields';
  if (p.v === 2) {
    if (!['S', 'M'].includes(p.ws)) return 'bad width source';
    if (p.ws === 'S' ? !(typeof p.mh === 'string' && /^[A-Za-z0-9_-]{16}$/.test(p.mh)) : p.mh !== undefined) return 'bad machine hash';
    if ((p.ra === undefined) !== (p.jh === undefined)) return 'job slip needs both ra and jh';
    if (p.ra !== undefined && !(isNum(p.ra) && p.ra > 0 && p.ra <= 1000)) return 'registered acres out of range';
    if (p.fm !== undefined && !FIELD_METHODS.includes(p.fm)) return 'bad field-method code';
    if (p.ss !== undefined && !(['S', 'F'].includes(p.ss) && p.jh !== undefined)) return 'bad slip source';
    if (p.ph !== undefined && !(p.ss === 'S' && typeof p.ph === 'string' && /^[A-Za-z0-9_-]{16}$/.test(p.ph))) return 'bad parcel hash';
    if (p.sp !== undefined && !(typeof p.sp === 'string' && /^[A-Z0-9-]{2,10}@\d{4}\.\d{1,3}$/.test(p.sp))) return 'bad state profile tag';
    if (p.jh !== undefined && !(typeof p.jh === 'string' && /^[A-Za-z0-9_-]{22}$/.test(p.jh))) return 'bad job-slip hash';
  }
  if (typeof p.id !== 'string' || !/^PP-[0-9A-F]{10}$/.test(p.id)) return 'bad certificate id';
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > MAX_SEQ) return `sequence number n must be an integer 1…${MAX_SEQ}`;
  if (!(p.prev === '0' || (typeof p.prev === 'string' && B64_43.test(p.prev)))) return 'bad previous-certificate hash';
  if (typeof p.fl !== 'string' || !p.fl.length || p.fl.length > 40 || /[|<>"'`&\u0000-\u001f\u007f]/.test(p.fl)) return 'bad field label';
  if (typeof p.fh !== 'string' || !B64_43.test(p.fh)) return 'bad field hash';
  if (!Array.isArray(p.fc) || p.fc.length !== 2 || !inR(p.fc[0], -90, 90) || !inR(p.fc[1], -180, 180)) return 'bad field location';
  if (!(isNum(p.fa) && p.fa > 0 && p.fa <= 1000)) return 'field area out of range';
  if (typeof p.im !== 'string' || !/^[A-Z]{2}$/.test(p.im)) return 'bad implement code';
  if (!(isNum(p.w) && p.w > 0 && p.w <= 12)) return 'working width out of range (0–12 m)';
  if (!Number.isInteger(p.t0) || !Number.isInteger(p.t1) || p.t0 < 1.5e9 || p.t0 > 4.1e9) return 'bad start time';
  if (p.t1 - p.t0 < 0 || p.t1 - p.t0 > 86400) return 'job duration out of range (0–24 h)';
  if (!inR(p.wm, 0, (p.t1 - p.t0) / 60 + 0.1)) return 'working minutes exceed the job duration';
  if (!inR(p.wa, 0, p.fa + 0.02)) return 'worked acres exceed the field area';
  if (!inR(p.cv, 0, 100.5)) return 'coverage out of range';
  const tol = (100 * 0.0051 * (1 + p.wa / p.fa)) / p.fa + 0.11; // rounding of wa, fa (2 dp) and cv (1 dp)
  if (Math.abs(p.cv - (100 * p.wa) / p.fa) > tol) return 'coverage does not match worked acres ÷ field area';
  if (!inR(p.oa, 0, 1000)) return 'outside-field acres out of range';
  if (typeof p.th !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(p.th)) return 'bad track hash';
  if (typeof p.av !== 'string' || !/^[0-9A-Za-z.+-]{1,20}$/.test(p.av)) return 'bad app version';
  if (typeof p.cl !== 'string' || !/^[A-Za-z0-9._@+-]{1,64}$/.test(p.cl)) return 'bad classifier id';
  if (!Array.isArray(p.f) || p.f.length > 24 || !p.f.every((x) => typeof x === 'string' && FLAG_RE.test(x))) return 'bad flag list';
  if (p.xh !== undefined && !(typeof p.xh === 'string' && B64_43.test(p.xh))) return 'bad extension hash';
  if (p.demo !== undefined && p.demo !== 1) return 'bad demo marker';
  if (p.sv !== undefined && !['N', 'B', 'I', '-'].includes(p.sv)) return 'bad satellite verdict code';
  if (p.cp !== undefined && !(typeof p.cp === 'string' && B64_43.test(p.cp))) return 'bad classifier-parameter hash';
  return null;
}

/**
 * A display-safe copy of a payload that did NOT pass verification (TAMPERED / INVALID):
 * only known fields, strings stripped of markup characters, numbers coerced (NaN if not numeric).
 * Views may show it to explain what was claimed, without ever rendering attacker markup.
 */
export function displaySafe(p) {
  if (!p || typeof p !== 'object') return null;
  const str = (x) => String(x ?? '').replace(/[<>"'`&\u0000-\u001f\u007f]/g, '').slice(0, 64);
  const num = (x) => (typeof x === 'number' ? x : Number.NaN);
  const out = {};
  for (const k of KNOWN) {
    if (!(k in p)) continue;
    const v = p[k];
    if (['n', 'fa', 'w', 't0', 't1', 'wm', 'wa', 'cv', 'oa', 'v', 'demo', 'ra'].includes(k)) out[k] = num(v);
    else if (k === 'fc') out[k] = Array.isArray(v) ? [num(v[0]), num(v[1])] : [Number.NaN, Number.NaN];
    else if (k === 'f') out[k] = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && FLAG_RE.test(x)).slice(0, 24) : [];
    else out[k] = str(v);
  }
  out.unverified = true;
  return out;
}

/**
 * Verify a certificate string.
 * @param {string} str   the QR text
 * @param {object} [ext] the optional extension sections (from the full certificate JSON)
 * @returns {Promise<{status:'VALID'|'TAMPERED'|'INVALID', reason?:string, payload?:object, kid?:string,
 *   hash?:string, pub?:string, extStatus?:'MATCH'|'NOT_PROVIDED'|null}>}
 *   For TAMPERED / INVALID, `payload` is a displaySafe() copy (marked unverified:true).
 */
export async function verifyCert(str, ext) {
  let d;
  try { d = decodeCert(str); } catch (e) { return { status: 'INVALID', reason: e.message }; }
  const safe = displaySafe(d.payload);
  let raw;
  try { raw = unb64u(d.pub); } catch { raw = null; }
  if (!raw || !isValidPubRaw(raw)) return { status: 'INVALID', reason: 'Public key must be an uncompressed P-256 point (65 bytes, 0x04)', payload: safe };
  const kid = await keyId(raw);
  const hash = await sha256b64u(String(str).trim());
  const base = { kid, hash, pub: d.pub };
  let sigBytes = null;
  try { sigBytes = unb64u(d.sig); } catch {}
  if (sigBytes && sigBytes.length === 64 && !isLowS(sigBytes)) return { status: 'TAMPERED', reason: 'Non-canonical (high-S) signature — this QR was altered', payload: safe, ...base };
  if (!(await verifyText(d.pub, d.text, d.sig))) return { status: 'TAMPERED', reason: 'Signature does not match the certificate data', payload: safe, ...base };
  // The text must also be canonical (prevents "same meaning, different text" tricks).
  if (canonical(d.payload) !== d.text) return { status: 'TAMPERED', reason: 'Certificate text is not canonical', payload: safe, ...base };
  const bad = checkPayload(d.payload);
  if (bad) return { status: 'INVALID', reason: 'Signed, but the data is not plausible: ' + bad, payload: safe, ...base };
  let extStatus = d.payload.xh ? 'NOT_PROVIDED' : null;
  if (ext && Object.keys(ext).some((k) => ext[k] != null)) {
    const xh = await extHash(ext);
    if (xh !== (d.payload.xh || null)) {
      return { status: 'TAMPERED', reason: 'Extension data (satellite / ML / impact) does not match the signed hash', payload: d.payload, extStatus: 'MISMATCH', ...base };
    }
    extStatus = 'MATCH';
  }
  return { status: 'VALID', payload: d.payload, extStatus, ...base };
}

/**
 * Check hash chains across many verified certificates.
 * @param {{payload:object, kid:string, hash:string}[]} certs
 * @returns {Map<string, {ok:boolean, missing:number[], broken:string[]}>} per device key.
 *   missing = sequence numbers absent BETWEEN certificates we have (deleted/hidden ones);
 *   broken  = certificates whose `prev` does not equal the hash of their predecessor.
 */
export const MAX_LISTED_GAPS = 50;
export function checkChains(certs) {
  const byKid = new Map();
  for (const c of certs) {
    const n = c?.payload?.n;
    if (!Number.isInteger(n) || n < 1 || n > MAX_SEQ) continue; // never trust n for allocation (review F-04)
    if (!byKid.has(c.kid)) byKid.set(c.kid, []);
    byKid.get(c.kid).push(c);
  }
  const out = new Map();
  for (const [kid, list] of byKid) {
    list.sort((a, b) => a.payload.n - b.payload.n);
    const missing = [], broken = [];
    let missingCount = 0;
    for (let i = 1; i < list.length; i++) {
      const c = list[i], p = list[i - 1];
      if (c.payload.n === p.payload.n) continue; // same number twice (e.g. re-imported) — not a gap
      if (c.payload.n === p.payload.n + 1) { if (c.payload.prev !== p.hash) broken.push(c.payload.id); continue; }
      // gap BETWEEN known certificates: count all, list at most MAX_LISTED_GAPS numbers
      const gap = c.payload.n - p.payload.n - 1;
      for (let m = p.payload.n + 1; m < c.payload.n && missing.length < MAX_LISTED_GAPS; m++) missing.push(m);
      missingCount += gap;
    }
    if (list[0] && list[0].payload.n === 1 && list[0].payload.prev !== '0') broken.push(list[0].payload.id);
    out.set(kid, { ok: !missingCount && !broken.length, missing, missingCount, firstMissing: missing[0] ?? null, broken, count: list.length });
  }
  return out;
}
