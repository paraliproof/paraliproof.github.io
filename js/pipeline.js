// pipeline.js — the ONE processing pipeline used by real recording, the demo
// replay, and the officer's "re-check raw data". Because all three go through
// the same code, the demo is an honest demonstration of the real algorithm,
// and re-processing raw data reproduces the certificate exactly.
//
// Data flow:
//   sensors / simulator ──► addGps(), addAccel()  (raw samples are stored, rounded)
//                       ──► every 2 s window: vibrationFeatures() + GPS speed
//                       ──► classifier.classify() ──► WORKING / TRANSIT / IDLE
//   finalize()          ──► 3-window majority smoothing, totals, raw data for hashing
//
// Raw data format v2 (what the track hash covers):
//   v    : 2
//   t0   : job start, epoch ms
//   gps  : [[tMs, lat, lon, accuracyM, speedMs|-1, headingDeg|-1], …]   t relative to t0
//   accT : Uint32Array of sample times (ms, relative to t0)
//   accX, accY, accZ : Int16Array of accelerationIncludingGravity in centi-m/s² (0.01 m/s² steps)
// Values are rounded ONCE when recorded, so hashing and re-processing are exact.
// The magnitude |a| used by the built-in classifier is computed from the rounded x, y, z.
//
// CLASSIFIER HOOK: if the classifier has windowFeatures(win), the pipeline calls it with
//   win = { accel: [[tEpochMs, x, y, z], …] (this 2-s window), gps: [[tEpochMs, lat, lon, acc, speed|null, heading|null], …]
//           (trailing 10 s), tEnd: epoch ms }
// and passes the result to classify() as features.ext. The ML model uses this to run its own
// feature code (plugins/ml/features.js) on exactly the same raw samples.

import { vibrationFeatures, WINDOW_MS } from './features.js';
import { median, canonical, sha256b64u, b64u, unb64u } from './util.js';
import { haversine } from './geo.js';

const GPS_LOOKBACK_MS = 1000; // a fix up to 1 s before a window still describes it
const CLOSE_DELAY_MS = 1000;  // wait 1 s after a window ends before classifying it
const GPS_CONTEXT_MS = 10000; // trailing GPS context offered to windowFeatures()
export const RAW_VERSION = 2;

class Grow {
  constructor(Type, cap = 4096) { this.Type = Type; this.a = new Type(cap); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  view() { return this.a.subarray(0, this.n); }
  copy() { return this.a.slice(0, this.n); }
}

export class JobProcessor {
  /**
   * @param {{t0:number, classifier:object, onWindow?:(w:object)=>void}} opts
   */
  constructor({ t0, classifier, onWindow }) {
    this.t0 = t0;
    this.classifier = classifier;
    this.onWindow = onWindow || (() => {});
    this.gps = [];
    this.accT = new Grow(Uint32Array);
    this.accX = new Grow(Int16Array);
    this.accY = new Grow(Int16Array);
    this.accZ = new Grow(Int16Array);
    this.windows = [];     // closed windows, in order
    this.nextK = 0;        // next window index to close
    this.accPtr = 0;       // first accel sample not yet assigned to a window
    this.gpsPtr = 0;
    this.lastT = 0;
  }

  /** GPS fix. t in ms relative to t0; speed in m/s or null; heading in degrees or null. */
  addGps(t, lat, lon, acc, speed, heading) {
    t = Math.max(0, Math.round(t));
    const ok = (v) => v != null && Number.isFinite(v) && v >= 0;
    this.gps.push([t, Math.round(lat * 1e7) / 1e7, Math.round(lon * 1e7) / 1e7,
      Math.round((acc ?? 99) * 10) / 10, ok(speed) ? Math.round(speed * 100) / 100 : -1, ok(heading) ? Math.round(heading * 10) / 10 : -1]);
    this.tick(t);
  }

  /** Accelerometer sample: accelerationIncludingGravity x, y, z in m/s². */
  addAccel(t, x, y, z) {
    t = Math.max(0, Math.round(t));
    if (this.accT.n && t < this.accT.a[this.accT.n - 1]) return; // drop out-of-order samples
    const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 100)));
    this.accT.push(t); this.accX.push(q(x)); this.accY.push(q(y)); this.accZ.push(q(z));
    this.tick(t);
  }

  /** Close every window that ended more than CLOSE_DELAY_MS before `now`. */
  tick(now) {
    if (now > this.lastT) this.lastT = now;
    while ((this.nextK + 1) * WINDOW_MS + CLOSE_DELAY_MS <= this.lastT) this._closeWindow(this.nextK++);
  }

  _closeWindow(k) {
    const start = k * WINDOW_MS, end = start + WINDOW_MS;
    // accelerometer samples in [start, end)
    const T = this.accT.a, X = this.accX.a, Y = this.accY.a, Z = this.accZ.a, N = this.accT.n;
    while (this.accPtr < N && T[this.accPtr] < start) this.accPtr++;
    let j = this.accPtr;
    const ts = [], ms = [], rows = [];
    const wantRaw = typeof this.classifier.windowFeatures === 'function';
    while (j < N && T[j] < end) {
      const x = X[j] / 100, y = Y[j] / 100, z = Z[j] / 100;
      ts.push(T[j]); ms.push(Math.sqrt(x * x + y * y + z * z));
      if (wantRaw) rows.push([this.t0 + T[j], x, y, z]);
      j++;
    }
    this.accPtr = j;
    const vib = vibrationFeatures(ts, ms);

    // GPS fixes in [start − 1 s, end)
    while (this.gpsPtr < this.gps.length && this.gps[this.gpsPtr][0] < end - GPS_CONTEXT_MS - WINDOW_MS) this.gpsPtr++;
    const fixes = [];
    for (let i = this.gpsPtr; i < this.gps.length && this.gps[i][0] < end; i++) {
      if (this.gps[i][0] >= start - GPS_LOOKBACK_MS) fixes.push(this.gps[i]);
    }
    let speedKmh = null, gpsAcc = null;
    if (fixes.length) {
      gpsAcc = median(fixes.map((f) => f[3]));
      const sp = fixes.filter((f) => f[4] >= 0).map((f) => f[4]);
      if (sp.length) speedKmh = median(sp) * 3.6;
      else if (fixes.length >= 2) {
        const a = fixes[0], b = fixes[fixes.length - 1];
        const dt = (b[0] - a[0]) / 1000;
        if (dt >= 0.9) speedKmh = (haversine(a[1], a[2], b[1], b[2]) / dt) * 3.6;
      }
    }
    const features = vib
      ? { ...vib, speedKmh, gpsAcc }
      : { n: ts.length, fs: null, rms: null, bands: null, domFreq: null, speedKmh, gpsAcc };
    if (wantRaw) {
      const ctx = [];
      for (let i = this.gpsPtr; i < this.gps.length && this.gps[i][0] <= end; i++) {
        const g = this.gps[i];
        if (g[0] > end - GPS_CONTEXT_MS) ctx.push([this.t0 + g[0], g[1], g[2], g[3], g[4] >= 0 ? g[4] : null, g[5] >= 0 ? g[5] : null]);
      }
      features.ext = this.classifier.windowFeatures({ accel: rows, gps: ctx, tEnd: this.t0 + end });
    }
    const r = this.classifier.classify(features);
    const w = {
      k, rms: features.rms, bands: features.bands, domFreq: features.domFreq, n: features.n,
      speedKmh, gpsAcc, nFix: fixes.length, raw: r.label, conf: r.confidence,
    };
    if (r.fallback) w.fb = 1; // ML could not decide (too few samples) → built-in classifier used
    // live smoothing: use the previous two windows (future ones are not known yet)
    w.label = majority(this.windows.length >= 2 ? [this.windows.at(-2).raw, this.windows.at(-1).raw, w.raw] : [w.raw]);
    this.windows.push(w);
    this.onWindow(w);
  }

  /** Copy of the raw data recorded so far (also used for crash-recovery autosave). */
  rawData() {
    return { v: RAW_VERSION, t0: this.t0, gps: this.gps, accT: this.accT.copy(), accX: this.accX.copy(), accY: this.accY.copy(), accZ: this.accZ.copy() };
  }

  /** Stop: close all remaining windows and return the job's processed data. */
  finalize(tEnd) {
    this.tick((tEnd ?? this.lastT) + WINDOW_MS + CLOSE_DELAY_MS);
    // Offline smoothing: centred 3-window majority vote (k−1, k, k+1).
    const W = this.windows;
    for (let i = 0; i < W.length; i++) {
      W[i].label = majority([W[Math.max(0, i - 1)].raw, W[i].raw, W[Math.min(W.length - 1, i + 1)].raw], W[i].raw);
    }
    const totals = { WORKING: 0, TRANSIT: 0, IDLE: 0 };
    let confSum = 0;
    for (const w of W) { totals[w.label] += WINDOW_MS; confSum += w.conf; }
    return {
      raw: this.rawData(),
      windows: W.map(({ k, rms, domFreq, n, speedKmh, gpsAcc, nFix, raw, conf, label, bands, fb }) =>
        ({ k, rms, domFreq, n, speedKmh, gpsAcc, nFix, raw, conf, label, bands, fb })),
      timeMs: totals,
      meanConfidence: W.length ? confSum / W.length : 0,
      meanWorkingConfidence: (() => { const w = W.filter((x) => x.label === 'WORKING'); return w.length ? w.reduce((a, x) => a + x.conf, 0) / w.length : 0; })(),
      fallbackWindows: W.filter((x) => x.fb).length,
      classifier: { id: this.classifier.id, version: this.classifier.version, kind: this.classifier.kind || 'ml' },
    };
  }
}

/** Majority vote; ties are broken in favour of `prefer` (default: the middle element). */
function majority(labels, prefer) {
  const c = {};
  for (const l of labels) c[l] = (c[l] || 0) + 1;
  let best = prefer ?? labels[Math.floor(labels.length / 2)] ?? labels[0], bc = c[best] || 0;
  for (const l in c) if (c[l] > bc) { best = l; bc = c[l]; }
  return best;
}

/** Re-run the whole pipeline on stored raw data (used by verification and tests). */
export function reprocess(raw, classifier) {
  const p = new JobProcessor({ t0: raw.t0, classifier });
  // Feed samples in time order, exactly as they would have arrived live.
  let i = 0, j = 0;
  const G = raw.gps, T = raw.accT;
  while (i < G.length || j < T.length) {
    if (j >= T.length || (i < G.length && G[i][0] <= T[j])) {
      const g = G[i++];
      p.gps.push(g); p.tick(g[0]); // already rounded: push as-is
    } else {
      p.accT.push(T[j]); p.accX.push(raw.accX[j]); p.accY.push(raw.accY[j]); p.accZ.push(raw.accZ[j]); p.tick(T[j]); j++;
    }
  }
  const tEnd = Math.max(G.length ? G[G.length - 1][0] : 0, T.length ? T[T.length - 1] : 0);
  return p.finalize(tEnd);
}

// ---------- track hash ----------
// SHA-256 over: canonical JSON of {v:2, t0, gps}  ‖  accT (little-endian uint32)  ‖  accX ‖ accY ‖ accZ (little-endian int16).
// Changing ANY recorded number (one GPS point, one vibration sample) changes the hash.
export async function trackHash(raw) {
  const head = new TextEncoder().encode(canonical({ v: RAW_VERSION, t0: raw.t0, gps: raw.gps }));
  const n = raw.accT.length;
  const buf = new Uint8Array(head.length + n * 10);
  buf.set(head, 0);
  const dv = new DataView(buf.buffer);
  let o = head.length;
  for (let i = 0; i < n; i++, o += 4) dv.setUint32(o, raw.accT[i], true);
  for (const A of [raw.accX, raw.accY, raw.accZ]) for (let i = 0; i < n; i++, o += 2) dv.setInt16(o, A[i], true);
  return sha256b64u(buf);
}

// ---------- (de)serialising raw data for JSON export ----------
const i16b64 = (A) => { const b = new Uint8Array(A.length * 2), d = new DataView(b.buffer); A.forEach((v, i) => d.setInt16(i * 2, v, true)); return b64u(b); };
const b64i16 = (s) => { const b = unb64u(s), d = new DataView(b.buffer), A = new Int16Array(b.length / 2); for (let i = 0; i < A.length; i++) A[i] = d.getInt16(i * 2, true); return A; };
export function rawToJSON(raw) {
  const t = new Uint8Array(raw.accT.length * 4), dt = new DataView(t.buffer);
  raw.accT.forEach((v, i) => dt.setUint32(i * 4, v, true));
  return { v: RAW_VERSION, t0: raw.t0, gps: raw.gps, accT: b64u(t), accX: i16b64(raw.accX), accY: i16b64(raw.accY), accZ: i16b64(raw.accZ) };
}
export function rawFromJSON(o) {
  if (o.v !== RAW_VERSION) throw new Error('Unsupported raw-data version ' + o.v);
  const t = unb64u(o.accT), dt = new DataView(t.buffer);
  const accT = new Uint32Array(t.length / 4);
  for (let i = 0; i < accT.length; i++) accT[i] = dt.getUint32(i * 4, true);
  return { v: o.v, t0: o.t0, gps: o.gps, accT, accX: b64i16(o.accX), accY: b64i16(o.accY), accZ: b64i16(o.accZ) };
}

/** Magnitude |a| (m/s²) of raw sample i — for code that needs the old magnitude view. */
export const rawMag = (raw, i) => Math.hypot(raw.accX[i], raw.accY[i], raw.accZ[i]) / 100;
