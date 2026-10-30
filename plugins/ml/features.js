// ParaliProof activity model -- feature extraction (browser / node, no dependencies).
//
// Line-for-line port of ml/features.py. Parity is checked by
//   node ml/tests/parity.test.mjs        (must agree to within 1e-6)
// If you change one file, change the other and re-run the test.
//
// accel : array of [t_ms, x, y, z]   accelerationIncludingGravity (m/s^2),
//         samples of ONE window: tStart <= t < tStart + 2000
// gps   : array of [t_ms, lat, lon, accuracy_m, speed_mps|null, heading_deg|null],
//         fixes of the trailing context: tEnd - 10000 < t <= tEnd
// Returns an object keyed by FEATURE_NAMES, or null if the window is unusable.

export const WINDOW_MS = 2000;
export const GPS_CONTEXT_MS = 10000;
export const MIN_SAMPLES = 16;
const HP_CUTOFF_HZ = 1.0;
const BANDS = [[0, 2], [2, 5], [5, 10], [10, 20], [20, Infinity]];
const BAND_NAMES = ['band_0_2', 'band_2_5', 'band_5_10', 'band_10_20', 'band_20_nyq'];
const EPS = 1e-12;
const MOVING_MPS = 0.8;
const MIN_STEP_M = 2.0;
const EARTH_R = 6371000.0;

export const FEATURE_NAMES = [
  'mag_mean', 'mag_std', 'hp_rms', 'crest', 'jerk_rms', 'zcr',
  ...BAND_NAMES, 'spec_centroid', 'vert_rms', 'horiz_rms',
  'speed_mean', 'speed_std', 'heading_rate', 'gps_ok', 'fs_est', 'n_samples',
];

function num(v) {
  if (v === null || v === undefined) return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}

function rowA(r) { return Array.isArray(r) ? r : [r.t, r.x, r.y, r.z]; }
function rowG(r) { return Array.isArray(r) ? r : [r.t, r.lat, r.lon, r.acc, r.speed, r.heading]; }

function cleanAccel(accel) {
  const out = [];
  let lastT = -Infinity;
  for (const raw of accel || []) {
    const r = rowA(raw);
    const t = num(r[0]), x = num(r[1]), y = num(r[2]), z = num(r[3]);
    if (t === null || x === null || y === null || z === null) continue;
    if (t > lastT) { out.push([t, x, y, z]); lastT = t; }
  }
  return out;
}

// np.interp semantics: linear, clamped at both ends. tq ascending.
function interp(tq, t, v) {
  const n = t.length, out = new Float64Array(tq.length);
  let j = 0;
  for (let i = 0; i < tq.length; i++) {
    const q = tq[i];
    if (q <= t[0]) { out[i] = v[0]; continue; }
    if (q >= t[n - 1]) { out[i] = v[n - 1]; continue; }
    while (j < n - 2 && t[j + 1] <= q) j++;
    // now t[j] <= q < t[j+1]
    const w = (q - t[j]) / (t[j + 1] - t[j]);
    out[i] = v[j] + w * (v[j + 1] - v[j]);
  }
  return out;
}

function dftPower(d) {
  const n = d.length, kmax = Math.floor(n / 2);
  const ctab = new Float64Array(n), stab = new Float64Array(n);
  for (let i = 0; i < n; i++) { ctab[i] = Math.cos(2 * Math.PI * i / n); stab[i] = Math.sin(2 * Math.PI * i / n); }
  const P = new Float64Array(kmax + 1);
  for (let k = 0; k <= kmax; k++) {
    let re = 0, im = 0;
    for (let j = 0; j < n; j++) {
      const m = (k * j) % n;
      re += ctab[m] * d[j];
      im -= stab[m] * d[j];
    }
    P[k] = re * re + im * im;
  }
  return P;
}

const rad = (x) => x * Math.PI / 180;

function haversine(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180 / Math.PI + 360) % 360 + 360) % 360;
}

const mod360 = (h) => ((h % 360) + 360) % 360;

function meanStd(arr) {
  let s = 0;
  for (const v of arr) s += v;
  const m = s / arr.length;
  let q = 0;
  for (const v of arr) q += (v - m) * (v - m);
  return [m, Math.sqrt(q / arr.length)];
}

export function gpsFeatures(gps) {
  const fixes = [];
  let lastT = -Infinity;
  for (const raw of gps || []) {
    const r = rowG(raw);
    const t = num(r[0]), lat = num(r[1]), lon = num(r[2]);
    if (t === null || lat === null || lon === null || t <= lastT) continue;
    let sp = r.length > 4 ? num(r[4]) : null;
    const hd = r.length > 5 ? num(r[5]) : null;
    if (sp !== null && sp < 0) sp = null;
    fixes.push([t, lat, lon, sp, hd]);
    lastT = t;
  }
  const m = fixes.length;
  const out = { speed_mean: 0, speed_std: 0, heading_rate: 0, gps_ok: 0 };
  if (m === 0) return out;
  out.gps_ok = 1;

  const sp = fixes.filter((f) => f[3] !== null).map((f) => f[3] * 3.6);
  if (sp.length > 0) {
    [out.speed_mean, out.speed_std] = meanStd(sp);
  } else if (m >= 2) {
    const dtTot = (fixes[m - 1][0] - fixes[0][0]) / 1000;
    out.speed_mean = haversine(fixes[0][1], fixes[0][2], fixes[m - 1][1], fixes[m - 1][2]) / dtTot * 3.6;
    const pair = [];
    for (let i = 1; i < m; i++) {
      const dt = (fixes[i][0] - fixes[i - 1][0]) / 1000;
      pair.push(haversine(fixes[i - 1][1], fixes[i - 1][2], fixes[i][1], fixes[i][2]) / dt * 3.6);
    }
    out.speed_std = meanStd(pair)[1];
  }

  let heads = fixes.map((f) => (f[4] !== null && (f[3] === null || f[3] >= MOVING_MPS)) ? mod360(f[4]) : null);
  const times = fixes.map((f) => f[0]);
  if (sp.length === 0 && heads.filter((h) => h !== null).length < 2 && out.speed_mean >= MOVING_MPS * 3.6) {
    // phone gives neither speed nor heading but we are clearly moving:
    // fall back to bearings from consecutive positions (step >= MIN_STEP_M)
    heads = [null];
    for (let i = 1; i < m; i++) {
      const d = haversine(fixes[i - 1][1], fixes[i - 1][2], fixes[i][1], fixes[i][2]);
      heads.push(d >= MIN_STEP_M ? bearing(fixes[i - 1][1], fixes[i - 1][2], fixes[i][1], fixes[i][2]) : null);
    }
  }
  let totDeg = 0, totDt = 0;
  for (let i = 1; i < heads.length; i++) {
    if (heads[i] === null || heads[i - 1] === null) continue;
    totDeg += Math.abs(((heads[i] - heads[i - 1]) + 540) % 360 - 180);
    totDt += (times[i] - times[i - 1]) / 1000;
  }
  if (totDt > 0) out.heading_rate = totDeg / totDt;
  return out;
}

export function computeFeatures(accel, gps) {
  const a = cleanAccel(accel);
  const n = a.length;
  if (n < MIN_SAMPLES) return null;
  const t0 = a[0][0];
  const t = new Float64Array(n), X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = (a[i][0] - t0) / 1000; X[i] = a[i][1]; Y[i] = a[i][2]; Z[i] = a[i][3]; }
  const T = t[n - 1];
  if (!(T > 0)) return null;
  const fs = (n - 1) / T;
  const u = new Float64Array(n);
  for (let k = 0; k < n; k++) u[k] = k / fs;
  const ax = interp(u, t, X), ay = interp(u, t, Y), az = interp(u, t, Z);

  const mag = new Float64Array(n);
  let s = 0;
  for (let k = 0; k < n; k++) { mag[k] = Math.sqrt(ax[k] * ax[k] + ay[k] * ay[k] + az[k] * az[k]); s += mag[k]; }
  const magMean = s / n;
  const d = new Float64Array(n);
  let q = 0;
  for (let k = 0; k < n; k++) { d[k] = mag[k] - magMean; q += d[k] * d[k]; }
  const magStd = Math.sqrt(q / n);

  const rc = 1 / (2 * Math.PI * HP_CUTOFF_HZ), dt = 1 / fs, alpha = rc / (rc + dt);
  let yPrev = 0, yy = 0, yMax = 0;
  for (let k = 1; k < n; k++) {
    const y = alpha * (yPrev + mag[k] - mag[k - 1]);
    yy += y * y;
    if (Math.abs(y) > yMax) yMax = Math.abs(y);
    yPrev = y;
  }
  const hpRms = Math.sqrt(yy / n);
  const crest = yMax / (hpRms + 1e-9);

  let jj = 0;
  for (let k = 0; k < n - 1; k++) { const j = (mag[k + 1] - mag[k]) * fs; jj += j * j; }
  const jerkRms = Math.sqrt(jj / (n - 1));

  let zc = 0;
  for (let k = 0; k < n - 1; k++) if (d[k] * d[k + 1] < 0) zc++;
  const zcr = zc / T;

  const P = dftPower(d);
  let total = 0;
  for (let k = 1; k < P.length; k++) total += P[k];
  const feats = {};
  for (let b = 0; b < BANDS.length; b++) {
    const [lo, hi] = BANDS[b];
    let e = 0;
    for (let k = 1; k < P.length; k++) { const f = k * fs / n; if (f >= lo && f < hi) e += P[k]; }
    feats[BAND_NAMES[b]] = e / (total + EPS);
  }
  let cs = 0;
  for (let k = 1; k < P.length; k++) cs += (k * fs / n) * P[k];
  const specCentroid = cs / (total + EPS);

  let gx = 0, gy = 0, gz = 0;
  for (let k = 0; k < n; k++) { gx += ax[k]; gy += ay[k]; gz += az[k]; }
  gx /= n; gy /= n; gz /= n;
  const gn = Math.sqrt(gx * gx + gy * gy + gz * gz);
  let ux = 0, uy = 0, uz = 1;
  if (gn > 1e-9) { ux = gx / gn; uy = gy / gn; uz = gz / gn; }
  const v = new Float64Array(n);
  let vs = 0;
  for (let k = 0; k < n; k++) { v[k] = ax[k] * ux + ay[k] * uy + az[k] * uz; vs += v[k]; }
  const vm = vs / n;
  let vv = 0;
  for (let k = 0; k < n; k++) vv += (v[k] - vm) * (v[k] - vm);
  const vertRms = Math.sqrt(vv / n);
  const hx = new Float64Array(n), hy = new Float64Array(n), hz = new Float64Array(n);
  let mx = 0, my = 0, mz = 0;
  for (let k = 0; k < n; k++) {
    hx[k] = ax[k] - v[k] * ux; hy[k] = ay[k] - v[k] * uy; hz[k] = az[k] - v[k] * uz;
    mx += hx[k]; my += hy[k]; mz += hz[k];
  }
  mx /= n; my /= n; mz /= n;
  let hh = 0;
  for (let k = 0; k < n; k++) {
    const a1 = hx[k] - mx, a2 = hy[k] - my, a3 = hz[k] - mz;
    hh += a1 * a1 + a2 * a2 + a3 * a3;
  }
  const horizRms = Math.sqrt(hh / n);

  const g = gpsFeatures(gps);
  const out = {
    mag_mean: magMean, mag_std: magStd, hp_rms: hpRms, crest, jerk_rms: jerkRms, zcr,
    ...feats, spec_centroid: specCentroid, vert_rms: vertRms, horiz_rms: horizRms,
    speed_mean: g.speed_mean, speed_std: g.speed_std, heading_rate: g.heading_rate, gps_ok: g.gps_ok,
    fs_est: fs, n_samples: n,
  };
  const ordered = {};
  for (const k of FEATURE_NAMES) ordered[k] = out[k];
  return ordered;
}

// Convenience for the app: pick the window out of rolling buffers and compute features.
// accelBuf / gpsBuf: arrays of rows sorted by t_ms. tEndMs: end of the window (exclusive for accel).
export function featuresAt(accelBuf, gpsBuf, tEndMs) {
  const tStart = tEndMs - WINDOW_MS;
  const acc = accelBuf.filter((r) => { const t = rowA(r)[0]; return t >= tStart && t < tEndMs; });
  const gps = (gpsBuf || []).filter((r) => { const t = rowG(r)[0]; return t > tEndMs - GPS_CONTEXT_MS && t <= tEndMs; });
  return computeFeatures(acc, gps);
}
