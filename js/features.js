// features.js — turn 2 seconds of accelerometer samples into a few numbers.
//
// WHY: a tractor pulling a Happy Seeder / Super Seeder / mulcher with the
// implement in the soil shakes in a different way from the same tractor
// driving on a road with the implement raised. We summarise each 2-second
// window by:
//   1. rms   — overall vibration strength (m/s²) after removing gravity and
//              slow tilting (high-pass filter).
//   2. bands — vibration strength in six frequency bands (Hz), from a
//              Discrete Fourier Transform (DFT). Soil-engaging blades/tines
//              and rotors add energy in particular bands; calibration finds
//              which band separates "working" from "driving" best on THIS
//              phone + tractor + implement.
//   3. domFreq — the single strongest frequency (for display/debugging).
//
// INPUT: magnitude |a| = sqrt(ax²+ay²+az²) of `accelerationIncludingGravity`.
// Using the magnitude makes the result independent of how the phone is
// oriented in the cab (it can lie flat, stand in a holder, etc.).

export const WINDOW_MS = 2000;
export const HP_CUTOFF_HZ = 2.0;           // removes gravity, body sway, tilting
export const BANDS = [[0.5, 3], [3, 6], [6, 10], [10, 15], [15, 20], [20, 30]];
export const MIN_SAMPLES = 8;

/**
 * @param {number[]} t  sample times in ms (ascending)
 * @param {number[]} m  |a| in m/s²
 * @returns {null | {n:number, fs:number, rms:number, bands:number[], domFreq:number}}
 */
export function vibrationFeatures(t, m) {
  const n = m.length;
  if (n < MIN_SAMPLES) return null;
  const dur = (t[n - 1] - t[0]) / 1000;
  if (dur <= 0) return null;
  const fs = (n - 1) / dur; // estimated sample rate (phones deliver 50–100 Hz)

  // Step 1: remove the mean (≈ 9.81 m/s² gravity).
  let mean = 0;
  for (let i = 0; i < n; i++) mean += m[i];
  mean /= n;

  // Step 2: first-order high-pass IIR filter, y[i] = α·(y[i−1] + x[i] − x[i−1]),
  // α = RC / (RC + dt), RC = 1 / (2π·fc). Passes vibration above ~2 Hz,
  // blocks slow changes such as the tractor tilting on a bund.
  const dt = 1 / fs, RC = 1 / (2 * Math.PI * HP_CUTOFF_HZ), alpha = RC / (RC + dt);
  const y = new Float64Array(n);
  let prevX = m[0] - mean;
  for (let i = 1; i < n; i++) {
    const x = m[i] - mean;
    y[i] = alpha * (y[i - 1] + x - prevX);
    prevX = x;
  }

  // Step 3: RMS (root-mean-square) = "average shaking strength".
  let ss = 0;
  for (let i = 0; i < n; i++) ss += y[i] * y[i];
  const rms = Math.sqrt(ss / n);

  // Step 4: spectrum with a Hann window (reduces spectral leakage).
  // power_k = 2·|X_k|² / (n·Σw²) so that Σ_k power_k ≈ rms² (Parseval).
  let sw2 = 0;
  const yw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    yw[i] = y[i] * w;
    sw2 += w * w;
  }
  const bandPow = new Array(BANDS.length).fill(0);
  let bestP = -1, domFreq = 0;
  const half = Math.floor(n / 2);
  for (let k = 1; k <= half; k++) {
    let re = 0, im = 0;
    const c = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) { re += yw[i] * Math.cos(c * i); im += yw[i] * Math.sin(c * i); }
    const p = (2 * (re * re + im * im)) / (n * sw2);
    const f = (k * fs) / n;
    if (p > bestP) { bestP = p; domFreq = f; }
    for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b][0] && f < BANDS[b][1]) bandPow[b] += p;
  }
  return { n, fs, rms, bands: bandPow.map(Math.sqrt), domFreq };
}

/** Cut a continuous recording (calibration) into 2-s windows of features. */
export function windowsOf(t, m) {
  const out = [];
  if (!t.length) return out;
  let i = 0;
  for (let start = t[0]; start + WINDOW_MS <= t[t.length - 1] + 1; start += WINDOW_MS) {
    const ts = [], ms = [];
    while (i < t.length && t[i] < start + WINDOW_MS) { if (t[i] >= start) { ts.push(t[i]); ms.push(m[i]); } i++; }
    const f = vibrationFeatures(ts, ms);
    if (f) out.push(f);
  }
  return out;
}
