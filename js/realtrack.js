// realtrack.js — replay a REAL public tractor recording in the demo (hook; NO DOM CODE HERE).
//
// Files live in app/demo/ and are listed in app/demo/index.js, which tools/sync_plugins.py writes
// from ml/out/real-track-*.json. A file is only listed if it names its dataset, country and licence;
// with no file the list is empty and the Record tab shows no extra option. Nothing here makes up data.
//
// File format: schema "paraliproof.recording.v1" (ml/README.md), the same as the app's ML export:
//   { schema, source: { dataset, country, licence, url? }, sessions: [ { accel: [[t_ms, x, y, z]…] (m/s²),
//     gps: [[t_ms, lat, lon, acc_m, speed_mps|null, heading|null]…], field?: { boundary: [[lat, lon]…] } } ] }
// A single session object (without `sessions`) is accepted too, as in retrain_from_field.py.
// The field boundary comes from the file when it has one; otherwise it is the convex hull of the
// fixes the dataset itself marks as in-field (reference_labels "field"), or of all fixes, labelled in
// the UI as a track area, not a surveyed boundary.
// GPS-only recordings (empty accel) are replayed WITHOUT vibration: the UI says "GPS only, no vibration
// data", the classifier falls back to GPS speed and the certificate gets NO_MOTION_SENSOR. Nothing is
// synthesised. When the dataset reports no GPS accuracy, ASSUMED_ACC_M is used and the UI says so
// (the coverage step ignores fixes worse than 20 m, so "unknown" cannot be passed through as-is).

import TRACKS from '../demo/index.js';

const MAX_SAMPLES = 2_000_000;
export const ASSUMED_ACC_M = 5;

/** Real tracks available for replay (may be empty). Each: {file, dataset, country, licence, url}. */
export function listRealTracks() {
  return (Array.isArray(TRACKS) ? TRACKS : []).filter((x) => x && typeof x.file === 'string' && x.dataset && x.country && x.licence);
}

const num = (v) => (v == null || v === '' ? null : Number(v));
const fin = (v) => Number.isFinite(v);

/**
 * paraliproof.recording.v1 JSON → replay arrays in the simulator's shape
 * { gps:[{t,lat,lon,acc,speed,heading}], accT, accX, accY, accZ, durationMs, t0Epoch, boundary|null, meta }.
 * Times are made relative to the first sample. Throws on anything that is not a usable recording.
 */
export function trackToReplay(json, meta = {}) {
  if (!json || typeof json !== 'object') throw new Error('Not a recording file');
  if (json.schema && json.schema !== 'paraliproof.recording.v1') throw new Error('Unknown recording schema: ' + String(json.schema).slice(0, 40));
  const s = Array.isArray(json.sessions) ? json.sessions[0] : json;
  if (!s || !Array.isArray(s.accel) || !Array.isArray(s.gps) || s.gps.length < 10) throw new Error('The recording has no usable GPS data');
  if (s.accel.length > MAX_SAMPLES || s.gps.length > MAX_SAMPLES / 10) throw new Error('The recording is too long for the phone');
  const row = (r, keys) => (Array.isArray(r) ? r : keys.map((k) => r?.[k]));
  const acc = s.accel.map((r) => row(r, ['t', 'x', 'y', 'z']).map(num)).filter((r) => r.slice(0, 4).every(fin)).sort((a, b) => a[0] - b[0]);
  const gps = s.gps.map((r) => row(r, ['t', 'lat', 'lon', 'acc', 'speed', 'heading']).map(num))
    .filter((r) => fin(r[0]) && fin(r[1]) && fin(r[2]) && Math.abs(r[1]) <= 90 && Math.abs(r[2]) <= 180).sort((a, b) => a[0] - b[0]);
  if (gps.length < 10 || (acc.length > 0 && acc.length < 100)) throw new Error('The recording has no usable GPS data');
  const gpsOnly = acc.length === 0;
  const accUnknown = gps.every((g) => !fin(g[3]));
  const t0 = gpsOnly ? gps[0][0] : Math.min(acc[0][0], gps[0][0]);
  const n = acc.length;
  const accT = new Float64Array(n), accX = new Float32Array(n), accY = new Float32Array(n), accZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { accT[i] = acc[i][0] - t0; accX[i] = acc[i][1]; accY[i] = acc[i][2]; accZ[i] = acc[i][3]; }
  const out = {
    gps: gps.map((g) => ({ t: g[0] - t0, lat: g[1], lon: g[2], acc: fin(g[3]) ? g[3] : accUnknown ? ASSUMED_ACC_M : 99, speed: fin(g[4]) ? g[4] : null, heading: fin(g[5]) ? g[5] : null })),
    accT, accX, accY, accZ, t0Epoch: t0, gpsOnly, accAssumed: accUnknown,
    durationMs: Math.max(n ? accT[n - 1] : 0, gps.at(-1)[0] - t0),
    boundary: null, boundaryFromFile: false,
    fieldIntervals: (Array.isArray(s.reference_labels) ? s.reference_labels : []).filter((l) => l?.label === 'field' && fin(Number(l.start_ms)) && fin(Number(l.end_ms)))
      .map((l) => [Number(l.start_ms) - t0, Number(l.end_ms) - t0]),
    meta: { dataset: String(meta.dataset || json.source?.dataset || '').slice(0, 60), country: String(meta.country || json.source?.country || '').slice(0, 40),
      licence: String(meta.licence || json.source?.licence || json.source?.license || '').slice(0, 80) },
  };
  const b = s.field?.boundary || json.field?.boundary;
  if (Array.isArray(b) && b.length >= 3 && b.length <= 500 && b.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]))) { out.boundary = b.map(([a, c]) => [a, c]); out.boundaryFromFile = true; }
  return out;
}

/** Convex hull [[lat, lon]…] of the good GPS fixes (needs Turf), used when the file has no boundary.
 *  With `intervals` (the dataset's own in-field annotation) only those fixes are used. */
export function hullBoundary(gps, intervals = []) {
  const inField = (g) => !intervals.length || intervals.some(([a, b]) => g.t >= a && g.t <= b);
  const pts = gps.filter((g) => g.acc <= 20 && inField(g)).map((g) => [g.lon, g.lat]);
  const hull = globalThis.turf.convex(globalThis.turf.featureCollection(pts.map((p) => globalThis.turf.point(p))));
  if (!hull) throw new Error('The track does not enclose an area');
  return hull.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => [Math.round(lat * 1e7) / 1e7, Math.round(lon * 1e7) / 1e7]);
}

/** Fetch one listed track (same origin, app/demo/) and convert it for replay. */
export async function loadRealTrack(entry) {
  const res = await fetch(new URL('../' + entry.file, import.meta.url));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const r = trackToReplay(await res.json(), entry);
  if (!r.boundary) r.boundary = hullBoundary(r.gps, r.fieldIntervals);
  return r;
}
