// sim.js — DEMO / SIMULATION MODE: a synthetic but realistic tractor job.
//
// Everything here is SYNTHETIC. It exists so the jury demo and laptop testing
// can run the *exact same* pipeline as a real phone. The numbers below are
// modelling ASSUMPTIONS, not measurements:
//
//  Field   : rotated rectangle — by default the Abhaipur (Patiala) test parcel, ≈ 3.34 acres.
//  Track   : road approach at 14 km/h (implement up) → serpentine passes at
//            ~4 km/h (implement down, WORKING), 3 % overlap between passes →
//            headland turns at 3 km/h (implement up) → one 40-s idle stop →
//            one pass deliberately skipped (so coverage < 100 %) → exit by road.
//  GPS     : 1 Hz. Error = 2nd-order Gauss–Markov (smooth, correlated) noise,
//            σ = 3.5 m per axis, time constant 60 s, plus 0.3 m white noise.
//            Phone GPS error drifts slowly rather than jumping every second.
//  Vibration: 3-axis accelerationIncludingGravity at 60 Hz from physical sources
//            (see makeTractor), phone mounted tilted. Each simulated tractor/phone
//            gets a random overall gain (0.7–1.4×).

import { rng } from './util.js';
import { makeProjection } from './geo.js';

// Demo field = the real test parcel "Field 3 - Abhaipur (Patiala)" chosen by sat/ on open
// farmland (sat/fields/field3_abhaipur_patiala_2026.geojson), fitted as a 149.7 m × 90.3 m
// rectangle (≈ 3.34 acres). Using it lets demo mode show sat/'s REAL Sentinel-2 result for
// that parcel. The tractor job on it is still SIMULATED.
export const SIM_ORIGIN = [30.4337986, 76.0518276]; // SW corner of the parcel
export const DEMO_FIELD = { origin: SIM_ORIGIN, lengthM: 149.7, widthM: 90.3, angleDeg: -0.54 };
const G = 9.80665;

// ---------- band-limited noise via a biquad band-pass filter ----------
// RBJ "Audio EQ Cookbook" band-pass (0 dB peak). Filtering white noise gives
// random vibration concentrated around f0 — a standard way to synthesise it.
function bandNoise(rand, f0, q, fs) {
  const w0 = (2 * Math.PI * f0) / fs, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const step = () => {
    const x = rand.normal();
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
  // normalise to unit RMS (measured once on a long run)
  let ss = 0; const N = 6000;
  for (let i = 0; i < N; i++) { const v = step(); ss += v * v; }
  const k = 1 / Math.sqrt(ss / N);
  return () => step() * k;
}

/**
 * A simulated tractor + implement + phone mount: its 3-axis vibration "personality".
 * Vehicle frame: x forward, y left, z up. Sources follow the assumptions documented
 * in ml/data_synth.py (seva-ml), simplified to what a 60 Hz phone can see:
 *   engine firing (aliased to ~22 Hz; ~13 Hz at idle), PTO shaft 9/18 Hz,
 *   broadband straw/soil cutting energy 8–30 Hz, soil-engagement jolts 2–8 Hz,
 *   draft fluctuation 0.5–3 Hz (fore-aft), field roughness 0.8–3.7 Hz,
 *   road bounce 2–4 Hz growing with speed, tyre-lug excitation v/0.24 m, implement sway 1–2.5 Hz.
 * The phone is mounted tilted (pitch ≈ 55°, yaw ≈ 20°), so gravity and vibration
 * appear on all three phone axes, as in a real dash holder.
 */
export function makeTractor(seed = 7, fs = 60) {
  const r = rng(seed);
  const gain = 0.7 + 0.7 * r();
  const N = (f0, q, k) => bandNoise(rng(seed * 31 + k), f0, q, fs);
  const src = {
    broad12: N(12, 1.0, 1), broad20: N(20, 1.5, 2), jolt: N(5, 1.2, 3), draft: N(1.5, 0.8, 4),
    rough: N(2.2, 0.9, 5), bounce: N(3, 1.5, 6), sway: N(1.7, 1.5, 7), turnRough: N(2.2, 0.9, 8),
  };
  const white = rng(seed + 99);
  const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const D = { broad: unit([0.6, 0.5, 1]), jolt: unit([0.6, 0.2, 1]), rough: unit([0.4, 0.4, 1]), bounce: unit([0.5, 0.1, 1]),
    sway: unit([0.5, 1, 0.2]), lug: unit([0.3, 0.2, 1]), eng: unit([0.3, 0.2, 1]), pto: unit([0.6, 0.3, 1]) };
  // phone orientation: rotation vehicle→phone (pitch about y, then yaw about z)
  const pitch = (55 + 10 * (r() - 0.5)) * Math.PI / 180, yaw = (20 + 20 * (r() - 0.5)) * Math.PI / 180;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = ([x, y, z]) => { const x1 = cp * x + sp * z, z1 = -sp * x + cp * z; return [cy * x1 + sy * y, -sy * x1 + cy * y, z1]; };
  // per-state source amplitudes (m/s² RMS) — ASSUMPTIONS
  const AMP = {
    WORKING: { broad: 0.9, jolt: 0.45, draft: 0.25, rough: 0.35, pto: 0.25, eng: 0.25, engHz: 22, road: 0, sway: 0, lug: 0 },
    TRANSIT: { broad: 0.08, jolt: 0, draft: 0, rough: 0, pto: 0, eng: 0.25, engHz: 22, road: 1, sway: 0.25, lug: 0.25 },
    IDLE:    { broad: 0, jolt: 0, draft: 0, rough: 0, pto: 0, eng: 0.15, engHz: 13, road: 0, sway: 0, lug: 0 },
  };
  const cur = { ...AMP.IDLE };
  let ph = { eng: r() * 6.28, pto: r() * 6.28, lug: r() * 6.28 };
  return {
    gain, fs,
    /** next accelerationIncludingGravity sample [x, y, z] (phone frame) for a state and speed (m/s) */
    sampleXYZ(state, speed, dt) {
      const tgt = AMP[state];
      for (const k in tgt) cur[k] += (tgt[k] - cur[k]) * Math.min(1, dt * 2);
      ph.eng += 2 * Math.PI * cur.engHz * dt; ph.pto += 2 * Math.PI * 9 * dt;
      const lugHz = Math.min(28, speed / 0.24); ph.lug += 2 * Math.PI * lugHz * dt;
      const kmh = speed * 3.6;
      const a = [0, 0, 0];
      const add = (dir, v) => { a[0] += dir[0] * v; a[1] += dir[1] * v; a[2] += dir[2] * v; };
      add(D.broad, cur.broad * (0.75 * src.broad12() + 0.66 * src.broad20()));
      add(D.jolt, cur.jolt * src.jolt());
      a[0] += cur.draft * src.draft();
      add(D.rough, cur.rough * src.rough());
      add(D.pto, cur.pto * Math.SQRT2 * (Math.sin(ph.pto) + 0.5 * Math.sin(2 * ph.pto)));
      add(D.eng, cur.eng * Math.SQRT2 * Math.sin(ph.eng));
      // road / headland: bounce grows with speed; raised-implement sway; tyre lugs; slow turns still feel field roughness
      add(D.bounce, cur.road * Math.min(0.9, 0.04 * kmh) * src.bounce());
      add(D.rough, cur.road * (kmh < 6 ? 0.35 : 0) * src.turnRough());
      add(D.sway, cur.sway * src.sway());
      add(D.lug, cur.lug * Math.min(1.5, kmh / 20) * Math.SQRT2 * Math.sin(ph.lug));
      const g = rot([0, 0, G]);
      const v = rot(a);
      return [g[0] + gain * v[0] + 0.02 * white.normal(), g[1] + gain * v[1] + 0.02 * white.normal(), g[2] + gain * v[2] + 0.02 * white.normal()];
    },
    /** magnitude-only convenience (used by older tests) */
    sample(state, dt, speed = state === 'TRANSIT' ? 3.9 : state === 'WORKING' ? 1.1 : 0) {
      const [x, y, z] = this.sampleXYZ(state, speed, dt); return Math.hypot(x, y, z);
    },
  };
}

/**
 * Smooth correlated GPS error, one axis, 1 sample per second, standard deviation sigma.
 * Second-order Gauss–Markov: white noise → low-pass (τ) → low-pass (τ). Phone GNSS
 * chips smooth positions with Doppler velocity, so the error drifts slowly
 * (tens of cm per second) instead of jumping metres every second.
 */
export function gpsErrorProcess(rand, sigma, tauS) {
  const phi = Math.exp(-1 / tauS);
  let a = 0, b = 0;
  // stationary std of the cascade for unit input, measured numerically once
  const ref = rng(12345); let ra = 0, rb = 0, ss = 0; const N = 20000;
  for (let i = 0; i < N + 2000; i++) { ra = phi * ra + ref.normal(); rb = phi * rb + (1 - phi) * ra; if (i >= 2000) ss += rb * rb; }
  const k = sigma / Math.sqrt(ss / N);
  for (let i = 0; i < 10 * tauS; i++) { a = phi * a + rand.normal(); b = phi * b + (1 - phi) * a; } // burn-in
  return () => { a = phi * a + rand.normal(); b = phi * b + (1 - phi) * a; return k * b; };
}

/** Sample field: a rotated rectangle. Returns corners [[lat,lon]×4] and its local frame. */
export function sampleField({ origin = DEMO_FIELD.origin, lengthM = DEMO_FIELD.lengthM, widthM = DEMO_FIELD.widthM, angleDeg = DEMO_FIELD.angleDeg } = {}) {
  const proj = makeProjection(origin[0], origin[1]);
  const th = (angleDeg * Math.PI) / 180;
  const toXY = (u, v) => [u * Math.cos(th) - v * Math.sin(th), u * Math.sin(th) + v * Math.cos(th)];
  const toLL = (u, v) => { const [x, y] = toXY(u, v); return proj.toLatLon(x, y); };
  const boundary = [[0, 0], [lengthM, 0], [lengthM, widthM], [0, widthM]].map(([u, v]) => toLL(u, v));
  return { boundary, frame: { origin, lengthM, widthM, angleDeg, toLL } };
}

/** Plan the tractor route in field coordinates (u along the field, v across). */
function planRoute(frame, implWidth, { skipPass = 9, idleAfterPass = 14, overlap = 0.03 } = {}) {
  const L = frame.lengthM, Wd = frame.widthM;
  const legs = [];
  const step = implWidth * (1 - overlap);
  const vs = [];
  for (let v = implWidth / 2; v <= Wd - implWidth / 2 + 0.01; v += step) vs.push(v);
  legs.push({ pts: [[-160, -18], [-6, -18]], kmh: 14, state: 'TRANSIT' });       // road
  legs.push({ pts: [[-6, -18], [-4, -6], [1, vs[0]]], kmh: 5, state: 'TRANSIT' }); // enter, implement up
  let dir = 1, lastV = vs[0], first = true;
  for (let k = 0; k < vs.length; k++) {
    if (k === skipPass) continue;
    const v = vs[k];
    const uA = dir > 0 ? 1 : L - 1, uB = dir > 0 ? L - 1 : 1;
    if (!first) {
      // headland turn from (uA, lastV) to (uA, v), bulging outside the pass ends
      const out = dir > 0 ? -1 : 1, mid = (lastV + v) / 2, r = Math.abs(v - lastV) / 2;
      const c = [uA + out * 3, mid];
      const pts = [[uA, lastV]];
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 8;
        pts.push([c[0] + out * r * Math.cos(a) + out * 1.5 * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
      pts.push([uA, v]);
      legs.push({ pts, kmh: 3, state: 'TRANSIT' });
    }
    legs.push({ pts: [[uA, v], [uB, v]], kmh: 4, state: 'WORKING' });
    if (k === idleAfterPass) legs.push({ pts: [[uB, v]], seconds: 40, state: 'IDLE' });
    first = false; lastV = v; dir = -dir;
  }
  const uEnd = dir > 0 ? 1 : L - 1; // where the last pass ended
  legs.push({ pts: [[uEnd, lastV], [uEnd + (dir > 0 ? -5 : 5), Wd + 6], [uEnd + (dir > 0 ? -5 : 5), Wd + 60]], kmh: 12, state: 'TRANSIT' });
  return legs;
}

/**
 * Generate a full synthetic job.
 * @returns {{boundary, gps:{t,lat,lon,acc,speed,heading}[], accT:Float64Array, accX/accY/accZ/accM:Float32Array, truthAt:(t)=>string, durationMs:number, tractor}}
 */
export function generateJob({ field = sampleField(), implWidth = 2.2, seed = 42, gpsSigma = 3.5, tauS = 60, whiteM = 0.3, fs = 60, tractorSeed = 7, route = {} } = {}) {
  const r = rng(seed);
  const legs = planRoute(field.frame, implWidth, route);
  // 1) true timeline at 10 Hz: [t, u, v, state, speed m/s]
  const tl = [];
  let t = 0;
  for (const leg of legs) {
    if (leg.seconds) {
      const [u, v] = leg.pts[0];
      for (let s = 0; s < leg.seconds * 10; s++) { tl.push([t, u, v, leg.state, 0]); t += 100; }
      continue;
    }
    for (let i = 1; i < leg.pts.length; i++) {
      const [u0, v0] = leg.pts[i - 1], [u1, v1] = leg.pts[i];
      const d = Math.hypot(u1 - u0, v1 - v0);
      let s = 0;
      while (s < d) {
        const sp = (leg.kmh / 3.6) * (1 + 0.06 * Math.sin(t / 7000) + 0.02 * r.normal());
        tl.push([t, u0 + ((u1 - u0) * s) / d, v0 + ((v1 - v0) * s) / d, leg.state, sp]);
        s += sp * 0.1; t += 100;
      }
    }
  }
  const durationMs = t;
  const truthAt = (tt) => tl[Math.max(0, Math.min(tl.length - 1, Math.floor(tt / 100)))][3];

  // 2) GPS at 1 Hz with smooth, correlated error (see gpsErrorProcess)
  const ex = gpsErrorProcess(r, gpsSigma, tauS), ey = gpsErrorProcess(r, gpsSigma, tauS);
  const proj = makeProjection(field.frame.origin[0], field.frame.origin[1]);
  const gps = [];
  for (let i = 0; i < tl.length; i += 10) {
    const [tt, u, v, , sp] = tl[i];
    const [lat0, lon0] = field.frame.toLL(u, v);
    const [x, y] = proj.toXY(lat0, lon0);
    const [lat, lon] = proj.toLatLon(x + ex() + whiteM * r.normal(), y + ey() + whiteM * r.normal());
    // heading: direction of travel over the next 0.5 s, + 4° noise; null when (almost) stopped, like real phones
    const nx = tl[Math.min(tl.length - 1, i + 5)];
    const [xa, ya] = proj.toXY(...field.frame.toLL(u, v)), [xb, yb] = proj.toXY(...field.frame.toLL(nx[1], nx[2]));
    const heading = sp > 0.3 ? ((Math.atan2(xb - xa, yb - ya) * 180 / Math.PI + 4 * r.normal()) % 360 + 360) % 360 : null;
    gps.push({ t: tt + Math.round(30 * r()), lat, lon, acc: Math.max(1.5, gpsSigma * (1.1 + 0.25 * r.normal())), speed: Math.max(0, sp + 0.12 * r.normal()), heading });
  }

  // 3) accelerometer (accelerationIncludingGravity, 3 axes) at ~fs Hz with timing jitter
  const tractor = makeTractor(tractorSeed, fs);
  const n = Math.floor((durationMs / 1000) * fs);
  const accT = new Float64Array(n), accX = new Float32Array(n), accY = new Float32Array(n), accZ = new Float32Array(n), accM = new Float32Array(n);
  let ta = 0;
  for (let i = 0; i < n; i++) {
    const dt = 1 / fs * (1 + 0.04 * (r() - 0.5));
    ta += dt * 1000;
    accT[i] = ta;
    const k = Math.max(0, Math.min(tl.length - 1, Math.floor(ta / 100)));
    const [x, y, z] = tractor.sampleXYZ(tl[k][3], tl[k][4], dt);
    accX[i] = x; accY[i] = y; accZ[i] = z; accM[i] = Math.hypot(x, y, z);
  }
  return { boundary: field.boundary, field, gps, accT, accX, accY, accZ, accM, truthAt, durationMs, tractor };
}

/** Synthetic 2 × 15 s calibration recording for the same tractor (driving at work / headland speed). */
export function generateCalibration({ tractorSeed = 7, fs = 60, seconds = 15 } = {}) {
  const tractor = makeTractor(tractorSeed, fs);
  const run = (state, speed) => {
    const t = [], m = [], xyz = [];
    for (let s = 0; s < fs; s++) tractor.sampleXYZ(state, speed, 1 / fs); // settle the cross-fade
    for (let i = 0; i < seconds * fs; i++) { const a = tractor.sampleXYZ(state, speed, 1 / fs); t.push((i * 1000) / fs); xyz.push(a); m.push(Math.hypot(...a)); }
    return { t, m, xyz };
  };
  return { working: run('WORKING', 1.1), driving: run('TRANSIT', 1.4) };
}

/** Fit the simulator's rectangular frame to a 4-corner boundary [[lat,lon]×4] (any start corner, either winding). */
export function fieldFromBoundary(b) {
  const proj = makeProjection(b[0][0], b[0][1]);
  let [c1, c3] = [proj.toXY(...b[1]), proj.toXY(...b[3])];
  if (c1[0] * c3[1] - c1[1] * c3[0] < 0) [c1, c3] = [c3, c1]; // make v = u rotated +90°
  const angleDeg = (Math.atan2(c1[1], c1[0]) * 180) / Math.PI;
  return sampleField({ origin: b[0], lengthM: Math.hypot(...c1), widthM: Math.hypot(...c3), angleDeg });
}
