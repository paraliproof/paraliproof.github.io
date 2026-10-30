// classifier.js — decide WORKING / TRANSIT / IDLE for each 2-second window.
//
// ┌──────────────────────── CLASSIFIER INTERFACE (plug-in contract) ─────────────────────────┐
// │ A classifier is a plain object:                                                          │
// │   { id: 'my-model', version: '1.2.0', kind: 'ml' | 'rule',                               │
// │     classify(features) → { label: 'WORKING'|'TRANSIT'|'IDLE', confidence: 0..1 } }        │
// │ `features` = { rms, bands[6], domFreq, fs, n, speedKmh, gpsAcc } (rms/bands null if no    │
// │ accelerometer data; speedKmh null if no GPS fix in the window).                          │
// │ classify() must be SYNCHRONOUS (it runs live, 30 times a minute). Load any model weights │
// │ in an async init() first, then call registerClassifier(obj). The ML team (ml/) can drop │
// │ in a model this way without touching the rest of the app.                                │
// └──────────────────────────────────────────────────────────────────────────────────────────┘
//
// BUILT-IN METHOD ("calibrated nearest-centroid", a tiny version of
// Linear Discriminant Analysis). Explained for the viva:
//
//  A. Speed gate (GPS). Happy/Super Seeders, mulchers and balers work at
//     roughly 2–6 km/h. So:
//        speed < 0.8 km/h          → IDLE    (standing still)
//        speed > 8 km/h            → TRANSIT (driving on a road; too fast to be seeding)
//     Both limits are editable assumptions.
//  B. Vibration test (accelerometer), only when the speed is in the working range.
//     We use two numbers per window, both on a log scale (vibration varies by
//     orders of magnitude, logs make the clusters roughly bell-shaped):
//        x1 = ln(rms)              overall shaking
//        x2 = ln(band amplitude)   shaking in the frequency band picked by calibration
//     CALIBRATION records ~15 s "implement down, working" and ~15 s
//     "implement up, driving". For each feature we store the two class means
//     μW, μT and a pooled standard deviation σ. A new window gets
//        z_j = sign(μW−μT) · (x_j − (μW+μT)/2) / σ_j        (clamped to ±4)
//        score = average of z_j
//     score > 0 means "closer to the WORKING cluster than to the DRIVING one,
//     measured in standard deviations". confidence = logistic(1.5·|score|).
//  C. Band choice: calibration tries all six bands and keeps the one with the
//     largest separation d = |μW−μT| / σ (Cohen's d). If even the best d < 1.0
//     the app warns that the phone may not be mounted firmly.
//
// Labels are then smoothed by a 3-window majority vote in pipeline.js.

import { BANDS } from './features.js';

export const LABELS = ['WORKING', 'TRANSIT', 'IDLE'];
export const DEFAULT_SPEED = { idleKmh: 0.8, maxWorkKmh: 8.0 }; // ASSUMPTIONS — editable in Settings
const EPS = 1e-3;
const lg = (x) => Math.log(x + EPS);
const logistic = (x) => 1 / (1 + Math.exp(-x));

// Default (uncalibrated) parameters. Chosen from the synthetic vibration model
// in sim.js — NOT from real tractors. A job recorded without calibration is
// flagged UNCALIBRATED on its certificate.
export const DEFAULT_PARAMS = {
  calibrated: false,
  features: [
    { name: 'logRms', band: -1, mid: Math.log(0.55), sigma: 0.45, sign: 1 },
    { name: 'logBand', band: 3, mid: Math.log(0.30), sigma: 0.55, sign: 1 },
  ],
  separation: null,
  ...DEFAULT_SPEED,
};

function featureValue(f, spec) {
  return spec.band < 0 ? lg(f.rms) : lg(f.bands[spec.band]);
}

function stats(xs) {
  const n = xs.length;
  const mu = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, n - 1);
  return { mu, sd: Math.sqrt(v) };
}

/**
 * Build classifier parameters from calibration windows.
 * @param {object[]} working  feature objects recorded with implement DOWN, working
 * @param {object[]} driving  feature objects recorded with implement UP, driving
 */
export function calibrate(working, driving, speed = DEFAULT_SPEED) {
  const W = working.filter(Boolean), T = driving.filter(Boolean);
  if (W.length < 3 || T.length < 3) throw new Error('Not enough calibration data (need ≥ 3 windows of each).');
  const candidates = [{ band: -1 }, ...BANDS.map((_, b) => ({ band: b }))].map((c) => {
    const w = stats(W.map((f) => featureValue(f, c)));
    const t = stats(T.map((f) => featureValue(f, c)));
    const sigma = Math.max(0.05, Math.sqrt((w.sd ** 2 + t.sd ** 2) / 2));
    return { ...c, mid: (w.mu + t.mu) / 2, sigma, sign: w.mu >= t.mu ? 1 : -1, d: Math.abs(w.mu - t.mu) / sigma, muW: w.mu, muT: t.mu };
  });
  const rmsSpec = candidates[0];
  const bestBand = candidates.slice(1).reduce((a, b) => (b.d > a.d ? b : a));
  const pick = (c, name) => ({ name, band: c.band, mid: c.mid, sigma: c.sigma, sign: c.sign, d: c.d, muW: c.muW, muT: c.muT });
  return {
    calibrated: true,
    features: [pick(rmsSpec, 'logRms'), pick(bestBand, 'logBand')],
    separation: Math.max(rmsSpec.d, bestBand.d),
    bandHz: BANDS[bestBand.band],
    nWorking: W.length, nDriving: T.length,
    idleKmh: speed.idleKmh, maxWorkKmh: speed.maxWorkKmh,
  };
}

/** The built-in rule-based classifier. */
export function createThresholdClassifier(params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  return {
    id: 'pp-threshold',
    version: '1.0.0',
    kind: 'rule',
    params: p,
    vibrationScore(f) {
      if (!f || f.rms == null) return null;
      let s = 0;
      for (const spec of p.features) {
        const z = (spec.sign * (featureValue(f, spec) - spec.mid)) / spec.sigma;
        s += Math.max(-4, Math.min(4, z));
      }
      return s / p.features.length;
    },
    classify(f) {
      const v = f.speedKmh;
      if (v != null && v < p.idleKmh) return { label: 'IDLE', confidence: 0.9 };
      if (v != null && v > p.maxWorkKmh) return { label: 'TRANSIT', confidence: 0.9 };
      const s = this.vibrationScore(f);
      if (s == null) {
        // No accelerometer: we cannot prove the implement was down. We count
        // the window by speed only, with low confidence, and the job gets the
        // NO_MOTION_SENSOR flag so an officer can see it.
        if (v == null) return { label: 'IDLE', confidence: 0.2 };
        return { label: 'WORKING', confidence: 0.3 };
      }
      return s > 0
        ? { label: 'WORKING', confidence: logistic(1.5 * s), score: s }
        : { label: 'TRANSIT', confidence: logistic(-1.5 * s), score: s };
    },
  };
}

/**
 * Wrap a plug-in classifier so that any window it cannot decide (label not one of
 * WORKING/TRANSIT/IDLE, e.g. the ML model's 'UNKNOWN' when < 16 samples) is decided
 * by the built-in classifier instead. Such windows are marked fallback:true.
 */
export function withFallback(primary, fallback) {
  return {
    id: primary.id, version: primary.version, kind: primary.kind || 'ml', info: primary.info,
    windowFeatures: primary.windowFeatures ? (w) => primary.windowFeatures(w) : undefined,
    classify(f) {
      let r = null;
      try { r = primary.classify(f); } catch { r = null; }
      if (r && LABELS.includes(r.label)) return r;
      return { ...fallback.classify(f), fallback: true };
    },
  };
}

// ---------- registry: one active classifier, swappable at runtime ----------
let thresholdParams = DEFAULT_PARAMS;
let plugin = null; // an ML classifier registered by ml/

export function registerClassifier(c) {
  if (!c || typeof c.classify !== 'function' || !c.id) throw new Error('Classifier needs {id, version, classify(features)}');
  plugin = c;
}
export function unregisterClassifier() { plugin = null; }
export function setThresholdParams(params) { thresholdParams = params || DEFAULT_PARAMS; }
export function getThresholdParams() { return thresholdParams; }
/** The classifier used for new jobs: the plug-in model if one is registered, else the built-in one. */
export function getClassifier() { return plugin || createThresholdClassifier(thresholdParams); }
export function getPluginClassifier() { return plugin; }

/**
 * The classifier for a new job: the registered plug-in model (wrapped with the built-in
 * one as fallback) unless the user chose 'threshold' in Settings or no plug-in exists.
 */
export function chooseClassifier(choice, thresholdClf) {
  if (plugin && choice !== 'threshold') return withFallback(plugin, thresholdClf);
  return thresholdClf;
}
