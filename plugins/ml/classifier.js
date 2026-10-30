// ParaliProof activity classifier -- zero-dependency interpreter for ml/web/model.json.
//
//   import { classify, MODEL_INFO } from './classifier.js';
//   import { computeFeatures } from './features.js';
//   const f = computeFeatures(accelRows, gpsRows);   // one 2-s window
//   const r = classify(f);   // { label: 'WORKING'|'TRANSIT'|'IDLE'|'UNKNOWN', confidence, probs }
//
// Supports the three model types train.py can export: 'gb_stumps', 'tree', 'logreg'.
// The default model is model.js (same content as model.json, as an ES module, so no fetch is needed).
// MODEL IS TRAINED ON SYNTHETIC DATA until it is retrained with field recordings (see ml/README.md).

import DEFAULT_MODEL from './model.js';

const prepared = new WeakMap();

function prepare(model) {
  let p = prepared.get(model);
  if (p) return p;
  p = { names: model.features, K: model.labels.length };
  if (model.type === 'gb_stumps') {
    // stumps: [classIndex, featureIndex, threshold, leftValue, rightValue]
    p.stumps = model.stumps;
    p.lr = model.learning_rate;
    p.init = model.init;
  } else if (model.type === 'tree') {
    p.nodes = model.nodes; // [featureIndex, threshold, left, right] or [-1, probs[]]
  } else if (model.type === 'logreg') {
    p.mean = model.mean; p.scale = model.scale; p.coef = model.coef; p.intercept = model.intercept;
  } else {
    throw new Error(`unknown model type ${model.type}`);
  }
  prepared.set(model, p);
  return p;
}

function vectorize(features, names) {
  const x = new Float64Array(names.length);
  const isArr = Array.isArray(features) || ArrayBuffer.isView(features);
  for (let i = 0; i < names.length; i++) {
    const v = isArr ? features[i] : features[names[i]];
    x[i] = Number.isFinite(v) ? v : 0;
  }
  return x;
}

function softmax(z) {
  let m = -Infinity;
  for (const v of z) if (v > m) m = v;
  let s = 0;
  const out = new Array(z.length);
  for (let i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] - m); s += out[i]; }
  for (let i = 0; i < z.length; i++) out[i] /= s;
  return out;
}

// scikit-learn trees compare float32(x) <= threshold; Math.fround reproduces that exactly.
const f32 = Math.fround;

export function predictProba(features, model = DEFAULT_MODEL) {
  const p = prepare(model);
  const x = vectorize(features, p.names);
  if (model.type === 'gb_stumps') {
    const raw = p.init.slice();
    const st = p.stumps;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      raw[s[0]] += p.lr * (f32(x[s[1]]) <= s[2] ? s[3] : s[4]);
    }
    return softmax(raw);
  }
  if (model.type === 'tree') {
    let n = p.nodes[0];
    while (n[0] !== -1) n = p.nodes[f32(x[n[0]]) <= n[1] ? n[2] : n[3]];
    return n[1].slice();
  }
  const z = new Array(p.K);
  for (let k = 0; k < p.K; k++) {
    let s = p.intercept[k];
    const c = p.coef[k];
    for (let i = 0; i < x.length; i++) s += c[i] * ((x[i] - p.mean[i]) / p.scale[i]);
    z[k] = s;
  }
  return softmax(z);
}

export function classify(features, model = DEFAULT_MODEL) {
  if (features === null || features === undefined) {
    return { label: 'UNKNOWN', confidence: 0, probs: null };
  }
  const pr = predictProba(features, model);
  let best = 0;
  for (let k = 1; k < pr.length; k++) if (pr[k] > pr[best]) best = k;
  const probs = {};
  model.labels.forEach((l, k) => { probs[l] = pr[k]; });
  return { label: model.labels[best], confidence: pr[best], probs };
}

// Optional temporal smoothing: exponential moving average of the class probabilities over
// consecutive windows (alpha = weight of the newest window). Reduces single-window flicker.
export function createSmoother(alpha = 0.4, model = DEFAULT_MODEL) {
  let state = null;
  return function next(result) {
    if (!result || !result.probs) return result;
    const labels = model.labels;
    if (!state) state = labels.map((l) => result.probs[l]);
    else state = labels.map((l, k) => alpha * result.probs[l] + (1 - alpha) * state[k]);
    let best = 0;
    for (let k = 1; k < state.length; k++) if (state[k] > state[best]) best = k;
    const probs = {};
    labels.forEach((l, k) => { probs[l] = state[k]; });
    return { label: labels[best], confidence: state[best], probs };
  };
}

// Explain one decision (gb_stumps models): how much each feature pushed the window towards the
// predicted label versus the average of the other labels (in log-odds units, sums of stump votes).
// Returns [{feature, value, push}] sorted by |push|, largest first.
export function explain(features, model = DEFAULT_MODEL, top = 5) {
  if (model.type !== 'gb_stumps' || !features) return [];
  const p = prepare(model);
  const x = vectorize(features, p.names);
  const K = p.K, F = p.names.length;
  const contrib = Array.from({ length: F }, () => new Array(K).fill(0));
  for (const s of p.stumps) contrib[s[1]][s[0]] += p.lr * (f32(x[s[1]]) <= s[2] ? s[3] : s[4]);
  const raw = p.init.slice();
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) raw[k] += contrib[f][k];
  const best = raw.indexOf(Math.max(...raw));
  const out = [];
  for (let f = 0; f < F; f++) {
    let others = 0;
    for (let k = 0; k < K; k++) if (k !== best) others += contrib[f][k];
    out.push({ feature: p.names[f], value: x[f], push: contrib[f][best] - others / (K - 1) });
  }
  out.sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
  return out.slice(0, top).map((o) => ({ ...o, label: model.labels[best] }));
}

// For the certificate's optional `ml` section.
export const MODEL_INFO = {
  model_id: DEFAULT_MODEL.model_id,
  version: DEFAULT_MODEL.version,
  type: DEFAULT_MODEL.type,
  synthetic_only: DEFAULT_MODEL.synthetic_only,
};
