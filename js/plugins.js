// plugins.js — drop-in extension points for other team members' modules.
//
// ┌──────────────────────────── PLUG-IN CONTRACT ───────────────────────────────┐
// │ Load your module with a <script type="module"> tag after js/app.js (or      │
// │ import it from plugins/index.js). Then call, e.g.:                          │
// │   window.ParaliProof.registerSatelliteCheck(async (ctx) => ({...}))          │
// │   window.ParaliProof.registerImpactCalculator(async (ctx) => ({...}))        │
// │   window.ParaliProof.registerClassifier({ id, version, kind:'ml', classify })│
// │ ctx = { field: {label, boundary:[[lat,lon]…], areaM2},                       │
// │         job:   {t0, t1, implement, widthM, demo},                            │
// │         coverage: {workedAcres, workedHa, coveragePct, …} }                  │
// │ Return a SMALL plain-JSON object (it is hashed into the signed certificate │
// │ as ext.satellite / ext.impact). Suggested shapes:                            │
// │   satellite: { source:'Sentinel-2 L2A', dNBR:0.03, ndviChange:-0.1,          │
// │                firmsHits:0, verdict:'NO_BURN'|'BURN'|'UNKNOWN', checkedAt }   │
// │   impact:    { co2eT:1.9, pm25Kg:3.1, method:'…', source:'…' }               │
// │ Throwing or timing out (10 s) is safe: the certificate is issued without it. │
// └─────────────────────────────────────────────────────────────────────────────┘

import { registerClassifier, unregisterClassifier, getClassifier } from './classifier.js';

const hooks = { satellite: null, impact: null };
let demoParcels = [];
/** Real test parcels (with names) that the demo fleet may use — registered by plugins/sat. */
export function registerDemoParcels(list) { demoParcels = Array.isArray(list) ? list : []; }
export const getDemoParcels = () => demoParcels;
let greenups = [];
/** Wheat green-up results (sat/out/greenup_<field>.json via tools/sync_plugins.py) — registered by plugins/sat. */
export function registerGreenups(list) { greenups = Array.isArray(list) ? list : []; }
export const getGreenups = () => greenups;

export function registerSatelliteCheck(fn) { hooks.satellite = fn; }
export function registerImpactCalculator(fn) { hooks.impact = fn; }
export const hasHook = (name) => typeof hooks[name] === 'function';

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Run an optional hook; returns its JSON result, or null if absent/failed. */
export async function runHook(name, ctx) {
  if (!hasHook(name)) return null;
  try {
    const r = await withTimeout(Promise.resolve(hooks[name](ctx)), 10000);
    return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : null;
  } catch (e) {
    console.warn(`[ParaliProof] ${name} plug-in failed:`, e);
    return { error: String(e.message || e) };
  }
}

// Make the API available as soon as this module loads (plug-ins may run before the app finishes booting).
queueMicrotask(() => exposeGlobalApi());

export function exposeGlobalApi(extra = {}) {
  globalThis.ParaliProof = Object.assign(globalThis.ParaliProof || {}, {
    registerSatelliteCheck, registerImpactCalculator, registerClassifier, unregisterClassifier, getClassifier,
  }, extra);
}
