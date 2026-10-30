// coverage.js — how many acres of THIS field did the implement actually work?
//
// We compute THREE numbers and certify the most defensible one.
//
// (S) STRICT GEOMETRIC AREA — the textbook method:
//   1. Label every GPS fix with the (smoothed) state of the 2-s window it falls in.
//   2. Drop fixes whose reported accuracy is worse than MAX_ACC_M (20 m).
//   3. Cut the track into WORKING segments (runs of consecutive WORKING fixes;
//      a run is broken by a non-working fix, a gap > 10 s or a jump > 30 m).
//   4. BUFFER each segment by W/2 (W = implement working width): the strip of
//      soil the implement touched. Turf.buffer, geodesic, metres.
//   5. UNION all strips (Turf.union) — ground worked twice counts once.
//   6. INTERSECT with the field boundary (Turf.intersect); Turf.area → m².
//   PROBLEM (found in our Monte-Carlo simulation, see sim/): phone GPS error
//   (σ ≈ 3–5 m) is BIGGER than the strip width (≈ 2.2 m). Neighbouring passes
//   are drawn shifted by different amounts, so the strips overlap in some
//   places and leave false gaps in others → (S) under-reports by 20–40 %.
//
// (D) DISTANCE × WIDTH — robust to GPS drift:
//   area = W × (distance travelled while WORKING inside the field, with an
//   edge tolerance of one GPS error margin — see below).
//   Distance comes from GPS Doppler speed × time (phones measure speed far more
//   accurately than position, ~0.1 m/s), falling back to point-to-point distance
//   when speed is not reported. A slowly drifting position error hardly
//   changes the distance, so (D) stays accurate. Weakness: driving the same
//   strip again would be counted twice.
//
// (E) ENVELOPE — the anti-double-counting cap:
//   same as (S) but each strip is widened by a GPS error margin
//   m = median reported accuracy (clamped 2–8 m): "all ground the implement
//   could possibly have touched, given GPS error", ∩ field.
//
// CERTIFIED WORKED AREA = min(D, E). Honest work gives D (< E); re-driving one
// strip ten times inflates D but not E, so the claim is capped at E.
// Coverage % = certified area ÷ field area × 100.
// Also reported: worked area outside the field, working distance outside the
// field, and the overlap factor (D ÷ S).
//
// The phone sits in the cab, not exactly over the implement centre; a lateral
// offset of < 1 m is small compared with GPS error and is ignored.

import { ringToPolygon, haversine } from './geo.js';
import { acres, hectares, median } from './util.js';
import { WINDOW_MS } from './features.js';

export const MAX_ACC_M = 20;
const MAX_GAP_MS = 10000;
const MAX_JUMP_M = 30;

/** Split the track into WORKING segments: arrays of [lon, lat, tMs, speedMs|-1, accuracyM]. */
export function workingSegments(gps, windows) {
  const labelAt = (t) => windows[Math.floor(t / WINDOW_MS)]?.label ?? 'IDLE';
  const segs = [];
  let cur = [], prev = null;
  const flush = () => { if (cur.length >= 2) segs.push(cur); cur = []; };
  for (const f of gps) {
    const [t, lat, lon, acc] = f;
    if (acc > MAX_ACC_M) continue;
    const working = labelAt(t) === 'WORKING';
    if (!working) { flush(); prev = f; continue; }
    if (prev && (t - prev[0] > MAX_GAP_MS || haversine(prev[1], prev[2], lat, lon) > MAX_JUMP_M)) flush();
    cur.push([lon, lat, t, f[4], acc]);
    prev = f;
  }
  flush();
  return segs;
}

/**
 * @param {[number,number][]} boundary  field corners [[lat,lon],…]
 * @param {Array} gps                   raw.gps rows [t, lat, lon, acc, speed]
 * @param {Array} windows               processed windows (with .label)
 * @param {number} widthM               implement working width, metres
 */
export function computeCoverage(boundary, gps, windows, widthM) {
  const turf = globalThis.turf;
  const field = ringToPolygon(boundary);
  const fieldM2 = turf.area(field);
  const segs = workingSegments(gps, windows);

  // GPS error margin m = median reported accuracy of working fixes, clamped 2–8 m.
  const accs = segs.flatMap((s) => s.map((p) => p[4]));
  const marginM = Math.min(8, Math.max(2, accs.length ? median(accs) : 5));
  // A working point counts as "inside" if it lies inside the field OR within m
  // of its edge: GPS error alone pushes genuine in-field points across the
  // boundary (never the other way round, because work outside is rare), so a
  // hard edge would systematically under-count. The envelope cap (E) still
  // limits the certified area to ground inside the field.
  const fieldTol = turf.buffer(field, marginM, { units: 'meters', steps: 4 });

  // (D) distance while working, inside / outside the (tolerant) field
  let insideLenM = 0, outsideLenM = 0;
  for (const s of segs) {
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      const dt = (b[2] - a[2]) / 1000;
      const d = a[3] >= 0 && b[3] >= 0 ? ((a[3] + b[3]) / 2) * dt : haversine(a[1], a[0], b[1], b[0]);
      const mid = turf.point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      if (turf.booleanPointInPolygon(mid, fieldTol)) insideLenM += d; else outsideLenM += d;
    }
  }
  const distM2 = insideLenM * widthM;

  // (S) strict and (E) envelope geometric areas
  const geo = (radius) => {
    const strips = [];
    for (const s of segs) {
      const b = turf.buffer(turf.lineString(s.map((p) => [p[0], p[1]])), radius, { units: 'meters', steps: 4 });
      if (b) strips.push(b);
    }
    if (!strips.length) return { unionM2: 0, insideM2: 0, inside: null };
    const union = strips.length === 1 ? strips[0] : safeUnion(strips);
    const inside = union ? turf.intersect(turf.featureCollection([field, union])) : null;
    return { unionM2: union ? turf.area(union) : 0, insideM2: inside ? turf.area(inside) : 0, inside };
  };
  const S = geo(widthM / 2);
  const E = geo(widthM / 2 + marginM);

  const workedM2 = Math.min(distM2, E.insideM2);
  const outsideM2 = outsideLenM * widthM;
  return {
    method: workedM2 < distM2 ? 'ENVELOPE_CAP' : 'DISTANCE',
    fieldM2, fieldAcres: acres(fieldM2), fieldHa: hectares(fieldM2),
    workedM2, workedAcres: acres(workedM2), workedHa: hectares(workedM2),
    coveragePct: fieldM2 > 0 ? (100 * workedM2) / fieldM2 : 0,
    distanceM2: distM2, strictM2: S.insideM2, envelopeM2: E.insideM2, marginM,
    strictAcres: acres(S.insideM2),
    outsideM2, outsideAcres: acres(outsideM2),
    workLengthM: insideLenM + outsideLenM, insideLengthM: insideLenM, outsideLengthM: outsideLenM,
    overlapFactor: S.insideM2 > 0 ? distM2 / S.insideM2 : null,
    nSegments: segs.length,
    // map shading: the worked zone (envelope ∩ field), simplified & rounded to keep storage small
    coverageGeo: E.inside ? turf.truncate(turf.simplify(E.inside, { tolerance: 0.000005 }), { precision: 7 }) : null,
  };
}

/**
 * Turf's polygon clipping can throw on rare near-degenerate inputs ("Unable to complete output ring",
 * found 29 Oct with a synthetic track). Fall back to adding strips one by one, retrying a failing strip at
 * 7-decimal precision, and finally skipping it. Skipping can only make the envelope E smaller, so the
 * certified area min(D, E) can only go DOWN, never up.
 */
function safeUnion(strips) {
  const turf = globalThis.turf;
  try { return turf.union(turf.featureCollection(strips)); } catch { /* fall through */ }
  let acc = strips[0];
  for (let i = 1; i < strips.length; i++) {
    try { acc = turf.union(turf.featureCollection([acc, strips[i]])) || acc; continue; } catch { /* retry */ }
    try { acc = turf.union(turf.featureCollection([turf.truncate(acc, { precision: 7 }), turf.truncate(strips[i], { precision: 7 })])) || acc; } catch { /* skip this strip */ }
  }
  return acc;
}

/** Cheap live estimate while recording: working distance × width (overestimates overlap). */
export function liveEstimateAcres(lengthM, widthM) { return acres(lengthM * widthM); }
