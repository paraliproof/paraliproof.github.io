// crosscheck.js — checks that compare a certificate with its field, its slip and OTHER certificates
// (Phase 1 of the 29 Oct government build). NO DOM CODE HERE. Needs Turf (globalThis.turf) for polygons.
//
// Per job (operator phone, signed into the certificate's flag list f):
//   SLIP_FIELD_MISMATCH  the farmer's slip points away from the field that was worked:
//                        slip centre more than SLIP_FIELD_MAX_M (150 m) OUTSIDE the field polygon, or the
//                        slip boundary covers less than SLIP_COVER_MIN (50 %) of the field polygon.
//                        Why 150 m: the slip centre comes from the farmer's phone GPS (±5–15 m), often taken
//                        at the field edge or the farm gate; Haryana/Punjab plots are ~60–150 m across, so
//                        150 m beyond the edge is "about one field away". It is the same radius the app
//                        already uses to pick a saved field near a slip. A placeholder for the pilot to tune.
//   SELF_OPERATED        declared at Start ("my own or my family's field"), or automatic when the slip was
//                        made on this same phone. INFO only: allowed, never a rejection; raises audit weight.
//   fm (signed)          how the field boundary was made: T tapped on the map · W walked with GPS ·
//                        C stood at corners (averaged GPS) · J from the farmer's slip · I imported file ·
//                        D demo / simulated parcel · P official parcel from a state-signed slip (Phase 4).
//                        Older certificates have no fm.
//
// Across certificates (officer phone, at verification / dashboard time; only VALID certificates from
// REGISTERED phones are compared, so a self-made certificate can never flag a genuine farmer's claim):
//   SLIP_REUSED          one slip hash (jh) on more than one certificate (different tracks).
//   CAPACITY             one machine (sticker hash mh, or the phone key when no sticker) has more
//                        acres in one calendar day (IST) than CAPACITY_ACRES_PER_DAY for its type.
//   MACHINE_TIME_CLASH   one machine or one phone has two certificates whose times overlap by > 5 min.
//   OVERLAP              (services.overlapPairs) real polygon overlap > 30 % — works for certificate
//                        FILES (scanned QRs carry only the field hash), boundary checked against fh.

import { haversine, makeProjection } from './geo.js';
import { round } from './util.js';

export const SLIP_FIELD_MAX_M = 150;
export const SLIP_COVER_MIN = 0.5;
export const CLASH_TOLERANCE_S = 300;
// Acres one machine can work in one day: working width × ~5 km/h × 12 h × ~0.6 field efficiency, rounded up.
// These are generous upper bounds [ASSUMPTION, to be agreed with the DDA]; editable in Settings.
export const DEFAULT_CAPACITY = { HS: 15, SS: 14, BL: 25, MU: 15, OT: 15 };

export const FIELD_METHOD_CODE = { tap: 'T', walk: 'W', corner: 'C', slip: 'J', import: 'I', sim: 'D', track: 'D', parcel: 'P' };
export const FIELD_METHODS = ['T', 'W', 'C', 'J', 'I', 'D', 'P'];
export const fieldMethodCode = (method) => FIELD_METHOD_CODE[method] || null;

const ring = (bd) => [...bd.map(([la, lo]) => [lo, la]), [bd[0][1], bd[0][0]]];
const poly = (bd) => globalThis.turf.polygon([ring(bd)]);

/** Distance in metres from a point to a polygon (0 when inside). */
export function distanceToPolygonM(pt, boundary) {
  const T = globalThis.turf;
  if (T.booleanPointInPolygon(T.point([pt[1], pt[0]]), poly(boundary))) return 0;
  const pr = makeProjection(pt[0], pt[1]);
  const xy = boundary.map(([a, b]) => pr.toXY(a, b));
  let best = Infinity;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    const u = L2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x1 + u * dx, y1 + u * dy));
  }
  return best;
}

/**
 * Does the farmer's slip point at the field that was worked?
 * @param {{c?:number[], b?:number[][]}} slip  the slip's location (centre and/or boundary)
 * @param {number[][]} boundary              the field polygon the job used
 * @returns {{mismatch:boolean, distM?:number, cover?:number, basis:'boundary'|'centre'|'none'}}
 */
export function slipFieldCheck(slip, boundary) {
  if (!slip || !Array.isArray(boundary) || boundary.length < 3) return { mismatch: false, basis: 'none' };
  const T = globalThis.turf;
  try {
    if (Array.isArray(slip.b) && slip.b.length >= 3) {
      const f = poly(boundary), s = poly(slip.b);
      const x = T.booleanIntersects(f, s) ? T.intersect(T.featureCollection([f, s])) : null;
      const cover = x ? T.area(x) / T.area(f) : 0;
      const c = T.centroid(s).geometry.coordinates;
      return { mismatch: cover < SLIP_COVER_MIN, cover: round(cover, 3), distM: Math.round(distanceToPolygonM([c[1], c[0]], boundary)), basis: 'boundary' };
    }
    if (Array.isArray(slip.c) && slip.c.length === 2) {
      const d = distanceToPolygonM(slip.c, boundary);
      return { mismatch: d > SLIP_FIELD_MAX_M, distM: Math.round(d), basis: 'centre' };
    }
  } catch { /* malformed geometry: no verdict, never a false flag */ }
  return { mismatch: false, basis: 'none' };
}

// ---------------- across certificates ----------------
const IST_MS = 5.5 * 3600e3;
const dayOf = (tSec) => new Date(tSec * 1000 + IST_MS).toISOString().slice(0, 10);
/** Machine identity: the signed sticker hash, else the phone key ("no sticker" jobs). */
export const machineOf = (e) => (e.payload?.mh ? 'M:' + e.payload.mh : 'K:' + (e.kid || '?'));
const comparable = (e) => e.status === 'VALID' && e.payload && e.trusted !== false;

/**
 * Cross-certificate flags. `entries` = [{status, trusted, payload, kid}].
 * @returns {Map<object, string[]>} extra flag codes per entry (only entries that got one), plus details.
 */
export function crossFlags(entries, { capacity = DEFAULT_CAPACITY } = {}) {
  const v = entries.filter(comparable).slice(0, 2000);
  const out = new Map();
  const add = (e, code) => { if (!out.has(e)) out.set(e, []); if (!out.get(e).includes(code)) out.get(e).push(code); };
  // SLIP_REUSED: same jh, different tracks
  const bySlip = new Map();
  for (const e of v) if (e.payload.jh) { if (!bySlip.has(e.payload.jh)) bySlip.set(e.payload.jh, []); bySlip.get(e.payload.jh).push(e); }
  for (const list of bySlip.values()) if (new Set(list.map((e) => e.payload.th)).size > 1) for (const e of list) add(e, 'SLIP_REUSED');
  // CAPACITY: acres per machine per IST day above the type's limit
  const byDay = new Map();
  for (const e of v) {
    const k = machineOf(e) + '|' + dayOf(e.payload.t0);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  for (const list of byDay.values()) {
    const uniq = [...new Map(list.map((e) => [e.payload.th, e])).values()];
    const total = uniq.reduce((a, e) => a + (Number(e.payload.wa) || 0), 0);
    const lim = Number(capacity[uniq[0].payload.im]) || Number(capacity.OT) || 15;
    if (total > lim) for (const e of list) add(e, 'CAPACITY');
  }
  // MACHINE_TIME_CLASH: same machine (or same phone) with overlapping times
  const groups = new Map();
  for (const e of v) for (const k of [machineOf(e), 'P:' + e.kid]) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const s = [...list].sort((a, b) => a.payload.t0 - b.payload.t0);
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && s[j].payload.t0 < s[i].payload.t1 - CLASH_TOLERANCE_S; j++) {
      if (s[i].payload.th === s[j].payload.th) continue; // same track = DUPLICATE
      add(s[i], 'MACHINE_TIME_CLASH'); add(s[j], 'MACHINE_TIME_CLASH');
    }
  }
  return out;
}

/** All certificates (comparable) that share this certificate's slip, with the payable total against ra. */
export function slipGroup(entries, e, payableOf) {
  const jh = e?.payload?.jh; if (!jh) return null;
  const list = entries.filter((x) => comparable(x) && x.payload.jh === jh);
  const uniq = [...new Map(list.map((x) => [x.payload.th, x])).values()];
  const total = round(uniq.reduce((a, x) => a + payableOf(x.payload).pa, 0), 2);
  const ra = Number(e.payload.ra);
  return { n: uniq.length, total, ra, cap: Number.isFinite(ra) ? Math.min(total, ra) : total, ids: uniq.map((x) => x.payload.id) };
}

/** Acres per machine per day (for the machine-use view and the case view). */
export function machineDayTotals(entries) {
  const m = new Map();
  for (const e of entries.filter(comparable)) {
    const k = machineOf(e) + '|' + dayOf(e.payload.t0);
    m.set(k, round((m.get(k) || 0) + (Number(e.payload.wa) || 0), 2));
  }
  return m;
}
export { dayOf };
