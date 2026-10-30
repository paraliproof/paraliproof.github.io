// services.js — application logic used by the views. NO DOM CODE HERE.
//
// Views (js/views/*.js) call these functions; these call the algorithm
// modules (pipeline, coverage, flags, cert, crypto, store, sim, plugins).

import { db, kv } from './store.js';
import { APP_VERSION, randomId, round, canonical, sha256b64u, M2_PER_ACRE } from './util.js';
import { polygonAreaM2, centroidLatLon } from './geo.js';
import { computeCoverage } from './coverage.js';
import { computeFlags } from './flags.js';
import { trackHash, rawToJSON, rawFromJSON, reprocess, JobProcessor } from './pipeline.js';
import { createThresholdClassifier, DEFAULT_PARAMS, calibrate, chooseClassifier, getPluginClassifier } from './classifier.js';
import { windowsOf } from './features.js';
import { issueCertificate, verifyCert, checkChains, fieldHash, decodeCert, displaySafe } from './cert.js';
import { FLAG_INFO } from './flags.js';
import { isValidPubB64u } from './crypto.js';
import { getDeviceKey, ephemeralKey } from './crypto.js';
import { runHook, getDemoParcels, getGreenups } from './plugins.js';
import { haversine } from './geo.js';
import { sampleField, generateJob, generateCalibration, SIM_ORIGIN, fieldFromBoundary } from './sim.js';
import { mapSnapshotSVG } from './mapsnap.js';
import { verifySticker, makeSlip, slipHash, verifyStateSlip, stateSlipState } from './qrformats.js';
import { shippedProfiles } from './profile.js';
import DEMO_STICKERS from '../demo/stickers.js';
import { crossFlags, slipFieldCheck, fieldMethodCode, slipGroup, DEFAULT_CAPACITY } from './crosscheck.js';

export { APP_VERSION };

// ---------- settings ----------
export const DEFAULT_PRESETS = [
  // Working widths are ASSUMPTIONS (typical 9-tine Happy Seeder ≈ 2.2 m; 8-ft Super Seeder ≈ 2.4 m;
  // straw baler pickup ≈ 2.0 m; mulcher ≈ 2.2 m). Edit them to match the actual machine.
  { code: 'HS', en: 'Happy Seeder', hi: 'हैप्पी सीडर', pa: 'ਹੈਪੀ ਸੀਡਰ', w: 2.2 },
  { code: 'SS', en: 'Super Seeder', hi: 'सुपर सीडर', pa: 'ਸੁਪਰ ਸੀਡਰ', w: 2.4 },
  { code: 'BL', en: 'Straw baler', hi: 'स्ट्रॉ बेलर', pa: 'ਸਟ੍ਰਾ ਬੇਲਰ', w: 2.0 },
  { code: 'MU', en: 'Mulcher', hi: 'मल्चर', pa: 'ਮਲਚਰ', w: 2.2 },
  { code: 'OT', en: 'Other implement', hi: 'अन्य उपकरण', pa: 'ਹੋਰ ਸੰਦ', w: 2.0 },
];
export const DEFAULT_SETTINGS = {
  lang: 'en', second: false, demo: false, night: false, rate: 1200, replaySpeed: 120,
  presets: DEFAULT_PRESETS, idleKmh: DEFAULT_PARAMS.idleKmh, maxWorkKmh: DEFAULT_PARAMS.maxWorkKmh,
  activeFieldId: null, implement: 'HS', widthM: 2.2, trustedKeys: [],
  classifier: 'ml',            // 'ml' = plug-in model from ml/ (default) · 'threshold' = built-in calibrated rule
  placement: 'dash_holder',    // phone placement, saved with recordings for ML retraining
  capacity: { ...DEFAULT_CAPACITY }, // acres per machine per day (CAPACITY flag) [ASSUMPTION]
  auditRate: 0.05, auditRateSelf: 0.20, // random audit: base rate and the self-operated (extra-check) rate [ASSUMPTION]
};
export const PLACEMENTS = ['dash_holder', 'loose_shelf', 'seat', 'pocket', 'other'];
export const IMPLEMENT_ML_NAME = { HS: 'happy_seeder', SS: 'super_seeder', BL: 'baler', MU: 'mulcher', OT: 'other' };
export async function loadSettings() { return { ...DEFAULT_SETTINGS, ...((await kv.get('settings')) || {}) }; }
export async function saveSettings(s) { await kv.set('settings', s); }

// ---------- calibration ----------
const calibKey = (demo) => (demo ? 'calibDemo' : 'calib');
export async function getCalibration(demo) { return (await kv.get(calibKey(demo))) || null; }
export async function setCalibration(demo, params) { if (params) await kv.set(calibKey(demo), params); else await kv.del(calibKey(demo)); }
/** Build classifier params from two raw recordings {t[], m[]}. */
export function calibrateFromRecordings(working, driving, speed) {
  return { ...calibrate(windowsOf(working.t, working.m), windowsOf(driving.t, driving.m), speed), at: Date.now() };
}
export function syntheticCalibration(speed) {
  const c = generateCalibration({ tractorSeed: 7 });
  return calibrateFromRecordings(c.working, c.driving, speed);
}
/** The built-in calibrated threshold classifier with the user's speed limits. */
export function classifierFor(calib, settings) {
  const p = calib || { ...DEFAULT_PARAMS };
  return createThresholdClassifier({ ...p, idleKmh: settings.idleKmh, maxWorkKmh: settings.maxWorkKmh });
}
/** The classifier a new job uses: ML plug-in (with threshold fallback) unless Settings says 'threshold'. */
export function jobClassifier(calib, settings) { return chooseClassifier(settings.classifier, classifierFor(calib, settings)); }

// ---------- fields ----------
export async function listFields() { return (await db.all('fields')).sort((a, b) => b.createdAt - a.createdAt); }
export async function saveField({ label, boundary, method, demo = false, id }) {
  const f = { id: id || randomId('F-', 4), label: String(label).trim().slice(0, 40), boundary, areaM2: polygonAreaM2(boundary),
    centroid: centroidLatLon(boundary), method, demo, createdAt: Date.now() };
  await db.put('fields', f);
  return f;
}
export const getField = (id) => db.get('fields', id);
export const deleteField = (id) => db.del('fields', id);
export async function ensureDemoField() {
  const id = 'F-DEMO1';
  let f = await db.get('fields', id);
  const boundary = sampleField().boundary;
  const label = 'DEMO · Abhaipur parcel'; // short enough for the field select at 360 px (QA 29 Oct)
  if (!f || JSON.stringify(f.boundary) !== JSON.stringify(boundary) || f.label !== label) {
    f = await saveField({ id, label, boundary, method: 'sim', demo: true });
  }
  return f;
}

/** Field for a real public track (js/realtrack.js): its own boundary, or the track's convex hull. Marked demo. */
export async function ensureTrackField(track, boundary, hullNote = '') {
  const id = 'F-TRACK-' + (await sha256b64u(String(track.file))).slice(0, 8).replace(/[^A-Za-z0-9]/g, 'x');
  const name = String(track.dataset || 'Real track').replace(/[|<>"'`&\u0000-\u001f\u007f]/g, ' ').slice(0, 30);
  const label = 'DEMO · ' + name;
  let f = await db.get('fields', id);
  if (!f || JSON.stringify(f.boundary) !== JSON.stringify(boundary)) f = await saveField({ id, label, boundary, method: 'track', demo: true });
  if (hullNote && !f.note) { f.note = hullNote; await db.put('fields', f); }
  return f;
}

// ---------- machine sticker + farmer job slip (operator phone) ----------
export const STICKER_SEASON_DAYS = 150; // a scanned sticker is remembered for one season
/** The machine for the next job: a sticker scanned this season, or a hand-typed machine, or null. */
export function activeMachine(settings, now = Date.now()) {
  const m = settings?.machine;
  if (!m) return null;
  if (m.source === 'sticker' && !(now - (m.at || 0) <= STICKER_SEASON_DAYS * 864e5)) return null;
  return m;
}
/** Remember a VALID sticker (qrformats.verifySticker result): fixes machine type and width. */
export async function setMachineFromSticker(settings, v) {
  if (v?.status !== 'VALID') throw new Error(v?.reason || 'Not a valid machine sticker');
  const st = v.sticker;
  settings.machine = { source: 'sticker', mid: st.mid, type: st.type, w: st.w, chc: st.chc, mh: v.mh, demo: !!st.demo, at: Date.now() };
  settings.implement = st.type; settings.widthM = st.w;
  await saveSettings(settings);
  return settings.machine;
}
export async function setMachineManual(settings, type, w) {
  settings.machine = { source: 'manual', type, w: Number(w) || 2.2, at: Date.now() };
  settings.implement = type; settings.widthM = settings.machine.w;
  await saveSettings(settings);
  return settings.machine;
}
/** Keep the farmer's slip for the NEXT certificate only (cleared once it is issued). */
export async function setJobSlip(settings, parsed, jh) {
  const sl = parsed.slip;
  settings.jobSlip = { jh, ra: sl.ra, kh: sl.kh, c: sl.c || null, b: sl.b || null, demo: !!sl.demo, at: Date.now() };
  await saveSettings(settings);
  return settings.jobSlip;
}
/**
 * Verify a scanned STATE slip (PPJ2) against the slip key named in that state's VERIFIED profile, wherever
 * the profile is pinned (it does not have to be the active one). @returns verifyStateSlip() result + profile.
 */
export async function verifyAnyStateSlip(text, now = Date.now(), seen = null) {
  const st = stateSlipState(text);
  if (!st) return { status: 'INVALID', reason: 'Not a state-signed slip (PPJ2)' };
  const prof = (await shippedProfiles(seen || (await kv.get('profileSeen')) || {})).find((r) => r.ok && r.profile.id === st);
  if (!prof) return { status: 'WRONG_STATE', reason: `No verified state profile for ${st} on this phone` };
  return { ...(await verifyStateSlip(text, { slipKey: prof.profile.keys.slip, stateId: st, now })), profile: prof.profile };
}
/** Keep a VERIFIED state slip for the next certificate. The parcel id stays on this phone, never in the QR. */
export async function setStateJobSlip(settings, v) {
  if (v?.status !== 'VALID') throw new Error(v?.reason || 'Not a valid state slip');
  const sl = v.slip;
  settings.jobSlip = { jh: v.jh, ra: sl.ra, kh: null, pid: sl.pid, ph: v.ph, b: sl.b, c: null, role: sl.role, st: sl.st, exp: sl.exp, state: true, demo: !!sl.demo, at: Date.now() };
  await saveSettings(settings);
  return settings.jobSlip;
}
/**
 * UX-1 "Start next field": the Record tab starts clean for the next farmer. Clears this job's slip, the
 * chosen field (the Record view also resets the "whose field" choice); keeps the machine (a sticker holds for the season), the
 * phone placement, the language and everything else. Returns the settings (saved).
 */
export async function resetForNextField(settings) {
  settings.jobSlip = null;
  settings.activeFieldId = null;
  await saveSettings(settings);
  return settings;
}
export async function clearJobSlip(settings) { if (settings.jobSlip) { settings.jobSlip = null; await saveSettings(settings); } }
/** A field from the slip's boundary (if it has one). The label never contains the khasra or MFMB number. */
export async function ensureSlipField(jobSlip) {
  if (!jobSlip?.b) return null;
  const id = 'F-SLIP-' + jobSlip.jh.slice(0, 8).replace(/[^A-Za-z0-9]/g, 'x');
  let f = await db.get('fields', id);
  // a state slip's boundary is the official parcel (fm 'P'); the label never contains the parcel id (it goes into the QR)
  // UX-2 / OP-8: a readable name with a sequence number and the registered acres, never a hash fragment
  if (!f) {
    const n = (await listFields()).filter((x) => x.method === (jobSlip.state ? 'parcel' : 'slip')).length + 1;
    const ra = Number.isFinite(Number(jobSlip.ra)) ? Number(jobSlip.ra).toFixed(2) : '–';
    const name = (jobSlip.state ? 'State parcel ' : 'Field from slip ') + n + ' · ' + ra + ' ac';
    f = await saveField({ id, label: (jobSlip.demo ? 'DEMO · ' : '') + name, boundary: jobSlip.b, method: jobSlip.state ? 'parcel' : 'slip', demo: !!jobSlip.demo });
  }
  return f;
}
/** A saved field within 150 m of the slip's centre, if any. */
export async function fieldNearSlip(jobSlip) {
  const c = jobSlip?.c; if (!c) return null;
  return (await listFields()).find((f) => haversine(f.centroid[0], f.centroid[1], c[0], c[1]) <= 150) || null;
}

// ---------- jobs ----------
/**
 * Turn a finished JobProcessor result into a stored job record.
 * @param {object} res    JobProcessor.finalize() output
 * @param {object} meta   {field, implement, widthM, t0, t1, demo, calib}
 */
export async function buildJob(res, meta) {
  const { field, widthM } = meta;
  const coverage = computeCoverage(field.boundary, res.raw.gps, res.windows, widthM);
  const job = {
    id: randomId('J-', 5), fieldId: field.id, fieldLabel: field.label, implement: meta.implement, widthM,
    t0: meta.t0, t1: meta.t1, demo: !!meta.demo, calib: meta.calib || null,
    classifier: res.classifier, classifierKind: res.classifier.kind, meanConfidence: res.meanConfidence,
    raw: res.raw, windows: res.windows, timeMs: res.timeMs, coverage, createdAt: Date.now(),
    labels: meta.labels || [], placement: meta.placement || null,
  };
  // anti-cheat set (v1.2): machine from a signed sticker or typed by hand; the farmer's job slip as
  // {jh, ra} only (never the MFMB registration no. or khasra). Present = this job uses certificate v2.
  if ('machine' in meta) job.machine = meta.machine ? { source: meta.machine.source, mh: meta.machine.mh || null, type: meta.machine.type || null, w: meta.machine.w || null } : null;
  if ('slip' in meta) job.slip = meta.slip?.jh ? { jh: meta.slip.jh, ra: meta.slip.ra, ...(meta.slip.ss ? { ss: meta.slip.ss } : {}), ...(meta.slip.ph ? { ph: meta.slip.ph } : {}) } : null;
  if (typeof meta.sp === 'string') job.sp = meta.sp;
  // Phase 1 (29 Oct): how the field was made (signed as fm), does the slip point at this field, self-operated
  if ('machine' in meta || 'slip' in meta) {
    job.fieldMethod = fieldMethodCode(field.method);
    if (job.slip && meta.slipGeo) job.slipCheck = slipFieldCheck(meta.slipGeo, field.boundary);
    job.selfOp = meta.selfOp === 'declared' || meta.selfOp === 'same_phone' ? meta.selfOp : null;
  }
  const st = await loadSettings();
  job.limits = { idleKmh: st.idleKmh, maxWorkKmh: st.maxWorkKmh };
  job.cp = await classifierParamsHash(job);
  // optional extension modules (satellite from sat/, impact from docs/impact/)
  const ctx = { field: { label: field.label, boundary: field.boundary, areaM2: field.areaM2, centroid: field.centroid },
    job: { t0: job.t0, t1: job.t1, implement: job.implement, widthM, demo: job.demo },
    coverage: { workedAcres: coverage.workedAcres, workedHa: coverage.workedHa, coveragePct: coverage.coveragePct, fieldAcres: coverage.fieldAcres },
    rate: meta.rate ?? 1200 };
  job.ext = {
    ml: mlSection(res),
    satellite: await runHook('satellite', ctx),
    impact: await runHook('impact', ctx),
  };
  job.flags = computeFlags(job);
  job.trackHash = await trackHash(res.raw);
  await db.put('jobs', job);
  return job;
}

/**
 * SHA-256 of everything that tunes the work detector for this job: classifier id@version,
 * calibration (also used as the ML fallback) and speed limits. Signed as payload.cp (review F-18),
 * so a changed calibration or limit is visible and comparable across certificates.
 */
export async function classifierParamsHash(job) {
  return sha256b64u(canonical({ cl: `${job.classifier.id}@${job.classifier.version}`, calib: job.calib || null, limits: job.limits || null }));
}

/** ext.ml: which model classified the windows, and how sure it was. */
export function mlSection(res) {
  return { model: res.classifier.id, version: res.classifier.version, kind: res.classifier.kind,
    meanConfidence: round(res.meanConfidence, 3), meanWorkingConfidence: round(res.meanWorkingConfidence || 0, 3),
    fallbackWindows: res.fallbackWindows || 0, syntheticOnly: res.classifier.kind === 'ml' ? (getPluginClassifier()?.info?.synthetic_only ?? null) : null };
}

/**
 * Attach a precomputed satellite result (a sat/out/*.json file) to a job before its certificate
 * is issued (review F-07): the parcel must be within 150 m of the field centre AND the
 * satellite date window must overlap the job dates. The section is marked source:'manual'
 * (→ SAT_MANUAL flag) and its verdict is signed into the certificate as `sv`.
 */
export const SAT_ATTACH_MAX_M = 150;
export async function attachSatellite(job, field, satJson, summarize) {
  if (job.certId) throw new Error('Certificate already issued — the satellite result can only be attached before signing.');
  const s = summarize(satJson);
  if (!s.centroid || !field.centroid) throw new Error('The satellite result has no parcel location.');
  const d = haversine(s.centroid[0], s.centroid[1], field.centroid[0], field.centroid[1]);
  if (d > SAT_ATTACH_MAX_M) throw new Error(`This satellite result is for a parcel ${Math.round(d)} m away ("${String(s.field_name || '').replace(/[<>]/g, '')}"), not this field.`);
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const w = s.window;
  if (!w?.start || !w?.end) throw new Error('The satellite result has no date window.');
  if (!(w.start <= day(job.t1) && w.end >= day(job.t0))) throw new Error(`The satellite images (${w.start} → ${w.end}) do not cover the job date (${day(job.t0)}).`);
  job.ext = { ...job.ext, satellite: { ...s, source: 'manual' } };
  job.flags = computeFlags(job);
  await db.put('jobs', job);
  return job;
}
export const getJob = (id) => db.get('jobs', id);

/** Feed a whole synthetic job through the pipeline synchronously (fleet demo & tests). */
export function runSyntheticJob({ field, widthM, seed, calib, settings, t0 }) {
  const sim = generateJob({ field, implWidth: widthM, seed, tractorSeed: 7 });
  const p = new JobProcessor({ t0, classifier: jobClassifier(calib, settings) });
  let gi = 0;
  for (let i = 0; i < sim.accT.length; i++) {
    while (gi < sim.gps.length && sim.gps[gi].t <= sim.accT[i]) { const g = sim.gps[gi++]; p.addGps(g.t, g.lat, g.lon, g.acc, g.speed, g.heading); }
    p.addAccel(sim.accT[i], sim.accX[i], sim.accY[i], sim.accZ[i]);
  }
  return { res: p.finalize(), durationMs: sim.durationMs };
}

// ---------- certificates ----------
export async function deviceKey() { return getDeviceKey(kv); }

// ---------------- payable acres = min(C worked, B field polygon, A registered) ----------------
/** From a (verified) payload: A registered (job slip, may be null), B field polygon, C worked → payable + which one set it. */
export function payableOf(p) {
  const C = Number(p?.wa), B = Number(p?.fa), A = p?.ra != null ? Number(p.ra) : null;
  if (!Number.isFinite(C) || !Number.isFinite(B)) return { A, B, C, pa: 0, limit: null };
  let pa = C, limit = 'C';
  if (B < pa) { pa = B; limit = 'B'; }
  if (A != null && Number.isFinite(A) && A < pa) { pa = A; limit = 'A'; }
  return { A, B, C, pa: round(pa, 2), limit, exceeds: A != null && (B > A * 1.05 || C > A * 1.05) };
}

// ---------------- payment stages ----------------
// ELIGIBLE  valid + registered device + no high flags
// APPROVED  satellite says no burn on an image taken >= ~14 days (12-day minimum) after the job
// CONFIRMED wheat green-up seen 3–5 weeks after a seeder job (sat/out/greenup_<field>.json)
// Exceptions: REJECTED (changed / invalid), NOT_REGISTERED, BURN_SUSPECTED → field visit,
//   REVIEW (other high flags), INCONCLUSIVE → wait for the next pass, NO_GREENUP → audit.
// Nothing is assumed: without a later satellite image or a green-up result the stage stays where it is.
// The burn verdict decides first: a field that was burned and then sown (GREENED + BURN_SUSPECTED, e.g.
// sat/ field 1, Gujran 2025) stays BURN_SUSPECTED — green-up only confirms sowing, never clears a burn.
export const SAT_WINDOW_DAYS = 12;
export function greenupFor(e, greenups = []) {
  const p = e.payload || {}, name = e.ext?.satellite?.field_name, key = e.ext?.satellite?.key;
  if (!name && !key) return null;
  const day = Number(p.t0) * 1000;
  return greenups.find((g) => (g.field === key || g.field === name || g.field_name === name) && g.job_date && Math.abs(Date.parse(g.job_date + 'T00:00:00Z') - day) <= 3 * 864e5) || null;
}
export function paymentStage(e, { greenups = [] } = {}) {
  const p = e.payload || {};
  if (e.status !== 'VALID') return { stage: 'REJECTED', exception: true };
  if (e.verdict === 'VALID_UNTRUSTED') return { stage: 'NOT_REGISTERED', exception: true };
  const codes = [...(Array.isArray(p.f) ? p.f : []), ...(e.extra || [])];
  if (p.sv === 'B' || codes.includes('SAT_BURN_SUSPECTED')) return { stage: 'BURN_SUSPECTED', exception: true };
  if (e.verdict === 'VALID_FLAGGED') return { stage: 'REVIEW', exception: true };
  if (p.sv === 'I') return { stage: 'INCONCLUSIVE', exception: true, base: 'ELIGIBLE' };
  const after = e.ext?.satellite?.scenes?.find?.((x) => x.role === 'after')?.date;
  const afterMs = after ? Date.parse(after + 'T00:00:00Z') : NaN;
  if (!(p.sv === 'N' && afterMs >= Number(p.t1) * 1000 + SAT_WINDOW_DAYS * 864e5)) return { stage: 'ELIGIBLE', note: p.sv === 'N' ? 'SAT_WINDOW_OPEN' : 'SAT_NOT_CHECKED' };
  if (!['HS', 'SS'].includes(p.im)) return { stage: 'APPROVED', note: 'GREENUP_NOT_APPLICABLE' };
  const g = greenupFor(e, greenups);
  if (g?.verdict === 'GREENED') return { stage: 'CONFIRMED' };
  if (g?.verdict === 'NO_GREENUP') return { stage: 'NO_GREENUP', exception: true, base: 'APPROVED' };
  return { stage: 'APPROVED', note: g ? 'GREENUP_' + g.verdict : 'GREENUP_NOT_CHECKED' };
}
/** On the farmer's phone the device registry is unknown: show what the certificate alone can say. */
export function farmerStage(v) {
  if (v.status !== 'VALID') return { stage: 'REJECTED', exception: true };
  if (v.payload?.sv === 'B') return { stage: 'BURN_SUSPECTED', exception: true };
  return { stage: 'SUBMITTED' };
}

// ---------------- OVERLAP: two claims on the same land in one season ----------------
export const SEASON_DAYS = 150, OVERLAP_MIN = 0.3;
/** Share of the smaller field covered by both (needs Turf for polygons); same field hash = 1. */
export function overlapShare(a, b) {
  if (a.payload?.fh && a.payload.fh === b.payload?.fh) return 1;
  if (!a.boundary || !b.boundary || !globalThis.turf) return 0;
  const T = globalThis.turf;
  const poly = (bd) => T.polygon([[...bd.map(([la, lo]) => [lo, la]), [bd[0][1], bd[0][0]]]]);
  try {
    const pa = poly(a.boundary), pb = poly(b.boundary);
    if (!T.booleanIntersects(pa, pb)) return 0;
    const x = T.intersect(T.featureCollection([pa, pb]));
    return x ? T.area(x) / Math.min(T.area(pa), T.area(pb)) : 0;
  } catch { return 0; }
}
// Only certificates that are VALID and from REGISTERED phones are compared: an unregistered (self-made)
// certificate is never paid anyway, and must not be able to flag a genuine farmer's claim (griefing).
export function overlapPairs(entries) {
  const v = entries.filter((e) => e.status === 'VALID' && e.payload && e.trusted !== false).slice(0, 400);
  const out = [];
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const a = v[i], b = v[j];
    if (a.payload.th === b.payload.th) continue; // same track = DUPLICATE, not overlap
    if (Math.abs(a.payload.t0 - b.payload.t0) > SEASON_DAYS * 86400) continue;
    if (Math.hypot(a.payload.fc[0] - b.payload.fc[0], a.payload.fc[1] - b.payload.fc[1]) > 0.05) continue; // > ~5 km apart
    const share = overlapShare(a, b);
    if (share > OVERLAP_MIN) out.push([a, b, share]);
  }
  return out;
}

/** Officer: enrol a phone from its signed registration QR (qrformats.verifyRegistration result). */
export async function registerPhone(settings, reg) {
  if (!reg?.ok || !isValidPubB64u(reg.pub)) throw new Error('Not a valid phone registration');
  settings.trustedKeys = [...(settings.trustedKeys || []).filter((k) => k.pub !== reg.pub),
    { kid: reg.kid, pub: reg.pub, chc: String(reg.chc).replace(/[<>|"'`&]/g, ' ').slice(0, 40), addedAt: Date.now(), via: 'registration' }];
  await saveSettings(settings);
  return settings.trustedKeys.at(-1);
}
export async function unregisterPhone(settings, pub) {
  settings.trustedKeys = (settings.trustedKeys || []).filter((k) => k.pub !== pub);
  await saveSettings(settings);
}
/** Officer: certificates whose job-slip hash matches a farmer's slip. */
export function certsForSlip(entries, jh) { return entries.filter((e) => e.payload?.jh && e.payload.jh === jh); }

export async function issueForJob(job, field) {
  const key = await deviceKey();
  const chain = (await kv.get('chain')) || null;
  const flags = key.weak ? [...job.flags, 'WEAK_KEY'] : job.flags; // review F-14
  const c = await issueCertificate({ key, chain, field, job, coverage: job.coverage, flags, ext: job.ext, appVersion: APP_VERSION });
  const snapshot = mapSnapshotSVG({ boundary: field.boundary, coverageGeo: job.coverage.coverageGeo, gps: job.raw.gps, windows: job.windows });
  const rec = { id: c.id, qr: c.qr, hash: c.hash, payload: c.payload, ext: c.ext, kid: c.kid, createdAt: c.createdAt,
    jobId: job.id, fieldId: field.id, boundary: field.boundary, demo: job.demo, snapshot, source: 'device' };
  await db.put('certs', rec);
  await kv.set('chain', c.newChain);
  job.certId = c.id;
  await db.put('jobs', job);
  return rec;
}
export async function listCerts() { return (await db.all('certs')).sort((a, b) => b.createdAt - a.createdAt); }
/** A stored certificate for display. Imported/scanned records never carry a raw snapshot (review F-11). */
export async function findCert(id) {
  const own = await db.get('certs', id);
  if (own) return own;
  const r = (await db.all('registry')).find((x) => x.payload?.id === id || x.id === id);
  if (!r) return null;
  const local = r.source === 'demo-fleet'; // generated on this device
  return { ...r, snapshot: local ? r.snapshot : null, ext: sanitizeDeep(r.ext) };
}

// ---------------- trust & verdicts (review F-03 / F-10) ----------------
/** Remove < and > from every string in a JSON value (display copy of attacker-supplied data). */
export function sanitizeDeep(v, depth = 0) {
  if (v == null || depth > 6) return v ?? null;
  if (typeof v === 'string') return v.replace(/[<>\u0000-\u001f\u007f]/g, '').slice(0, 300);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 64).map((x) => sanitizeDeep(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v).slice(0, 64)) o[k.replace(/[<>]/g, '')] = sanitizeDeep(v[k], depth + 1); return o; }
  return null;
}
export const isValidPublicKey = isValidPubB64u;
/** Trusted = the FULL public key equals this device's key or one the officer enrolled. */
export function isTrustedPub(pub, settings, myPub) {
  if (!pub) return false;
  // two-person enrolment (G-2): a phone enrolled by the ADO is "pending" until the SDAO countersigns
  return pub === myPub || (settings?.trustedKeys || []).some((k) => k.pub === pub && k.status !== 'pending');
}
/**
 * Verdict sub-state for the views:
 *   VALID_TRUSTED   signature OK, enrolled device, no serious flag   → may be paid
 *   VALID_FLAGGED   signature OK, enrolled device, serious flag      → review before paying
 *   VALID_UNTRUSTED signature OK, device NOT registered               → "Signature OK – device not registered – do not pay"
 *   TAMPERED / INVALID                                                → reject
 */
export function verdictOf(status, trusted, codes = []) {
  if (status !== 'VALID') return status;
  if (!trusted) return 'VALID_UNTRUSTED';
  if (codes.some((c) => FLAG_INFO[c]?.sev === 'high')) return 'VALID_FLAGGED';
  return 'VALID_TRUSTED';
}
export const VERDICT_TEXT = {
  VALID_TRUSTED: 'Valid – registered device',
  VALID_FLAGGED: 'Valid – needs review before paying',
  VALID_UNTRUSTED: 'Signature OK – device not registered – do not pay',
  TAMPERED: 'Tampered – reject',
  INVALID: 'Not a valid certificate – reject',
};

/**
 * Verify a certificate string and record it in the officer registry.
 * Adds verification-time flags: DUPLICATE (same track hash in another certificate),
 * CHAIN_BREAK, and whether the device key is trusted.
 */
export async function verifyAndRegister(text, ext, { save = true, settings, boundary = null } = {}) {
  const v = await verifyCert(text, ext);
  const out = { ...v, extra: [], trusted: false, chain: null, verdict: v.status, payable: false };
  if (v.status === 'INVALID' && !v.kid) return out;
  const registry = await db.all('registry');
  const own = await db.all('certs');
  const p = v.payload;
  const myKey = await deviceKey();
  out.trusted = isTrustedPub(v.pub, settings, myKey.pub);
  out.ownDevice = v.pub === myKey.pub;
  // a certificate FILE may carry the field boundary: keep it only if it hashes to the signed fh (G6)
  let bd = validBoundary(boundary);
  if (bd && v.status === 'VALID' && (await fieldHash(bd)) !== p.fh) { bd = null; out.extra.push('BOUNDARY_MISMATCH'); }
  out.boundary = bd;
  if (v.status === 'VALID') {
    const others = [...registry, ...own].filter((r) => r.payload && r.payload.th === p.th && r.payload.id !== p.id && r.status === 'VALID');
    if (others.length) out.extra.push('DUPLICATE');
    const pool = [...own.map((c) => ({ payload: c.payload, kid: c.kid, hash: c.hash })),
      ...registry.filter((r) => r.status === 'VALID').map((r) => ({ payload: r.payload, kid: r.kid, hash: r.hash }))];
    const seen = new Map(); for (const c of pool) seen.set(c.hash, c);
    seen.set(v.hash, { payload: p, kid: v.kid, hash: v.hash });
    const ch = checkChains([...seen.values()]).get(v.kid);
    out.chain = ch;
    if (ch && (ch.broken.includes(p.id) || (ch.firstMissing != null && ch.firstMissing < p.n))) out.extra.push('CHAIN_BREAK');
    if (!out.trusted) out.extra.push('UNTRUSTED_KEY');
    // cross-certificate checks against what this officer device already holds (registered phones only)
    const regTrusted = (r) => (r.source === 'device' || !r.status ? true : r.status === 'VALID' && isTrustedPub(r.pub, settings, myKey.pub));
    const mine = { payload: p, status: 'VALID', kid: v.kid, trusted: out.trusted, boundary: bd };
    const peers = [...own.map((c) => ({ ...c, status: 'VALID', trusted: true })), ...registry.filter((r) => r.payload && r.hash !== v.hash).map((r) => ({ ...r, trusted: regTrusted(r), boundary: validBoundary(r.boundary) }))]
      .filter((r) => r.payload?.id !== p.id);
    if (out.trusted && others.length === 0 && peers.some((r) => r.trusted && r.payload.th !== p.th
      && Math.abs(r.payload.t0 - p.t0) <= SEASON_DAYS * 86400 && overlapShare(mine, r) > OVERLAP_MIN)) out.extra.push('OVERLAP');
    if (out.trusted) {
      const fl = crossFlags([mine, ...peers], { capacity: settings?.capacity }).get(mine) || [];
      for (const c of fl) if (!out.extra.includes(c)) out.extra.push(c);
      if (fl.includes('SLIP_REUSED')) out.slipGroup = slipGroup([mine, ...peers], mine, payableOf);
    }
  }
  out.verdict = verdictOf(v.status, out.trusted, [...(p?.f || []), ...out.extra]);
  out.payable = out.verdict === 'VALID_TRUSTED';
  if (save && v.hash) {
    const old = registry.find((r) => r.id === v.hash);
    const rec = { id: v.hash, certId: p?.id, qr: String(text).trim(), payload: p, kid: v.kid, hash: v.hash, pub: v.pub,
      status: v.status, verdict: out.verdict, extra: out.extra, ext: v.extStatus === 'MATCH' ? ext : (old?.ext ?? null),
      verifiedAt: Date.now(), demo: !!p?.demo, source: old?.source === 'demo-fleet' ? 'demo-fleet' : 'verify', boundary: bd || old?.boundary || null, snapshot: old?.source === 'demo-fleet' ? old.snapshot : undefined };
    await db.put('registry', rec);
  }
  return out;
}

/** Officer check of a job-data export against a certificate payload. */
export async function checkRawAgainstCert(exported, payload) {
  const raw = rawFromJSON(exported.raw);
  const th = await trackHash(raw);
  const res = { trackHash: th === payload.th ? 'MATCH' : 'MISMATCH' };
  if (exported.field?.boundary) res.fieldHash = (await fieldHash(exported.field.boundary)) === payload.fh ? 'MATCH' : 'MISMATCH';
  const cid = exported.job?.classifier?.id;
  const plug = getPluginClassifier();
  const thr = createThresholdClassifier({ ...(exported.job.calib || DEFAULT_PARAMS), ...(exported.job.speed || {}) });
  let clf = null;
  if (cid === 'pp-threshold') clf = thr;
  else if (plug && cid === plug.id && exported.job.classifier.version === plug.version) clf = chooseClassifier('ml', thr);
  else res.note = `Acres not recomputed: classifier ${cid} ${exported.job?.classifier?.version || ''} is not installed on this device.`;
  if (res.trackHash === 'MATCH' && clf && exported.field?.boundary) {
    const re = reprocess(raw, clf);
    const cov = computeCoverage(exported.field.boundary, raw.gps, re.windows, exported.job.widthM);
    res.recomputedAcres = round(cov.workedAcres, 2);
    res.acres = Math.abs(res.recomputedAcres - payload.wa) <= 0.011 ? 'MATCH' : 'MISMATCH';
  }
  return res;
}

export function jobExport(job, field, settings) {
  return {
    type: 'paraliproof-job', v: 1, app: APP_VERSION,
    field: { id: field.id, label: field.label, boundary: field.boundary },
    job: { id: job.id, implement: job.implement, widthM: job.widthM, t0: job.t0, t1: job.t1, demo: job.demo, calib: job.calib,
      speed: { idleKmh: settings.idleKmh, maxWorkKmh: settings.maxWorkKmh },
      classifier: job.classifier, trackHash: job.trackHash, flags: job.flags, certId: job.certId || null,
      coverage: { ...job.coverage, coverageGeo: undefined } },
    raw: rawToJSON(job.raw),
  };
}

// ---------- backup ----------
export async function backupAll() {
  const jobs = (await db.all('jobs')).map((j) => ({ ...j, raw: rawToJSON(j.raw) }));
  return { type: 'paraliproof-backup', v: 1, app: APP_VERSION, exportedAt: Date.now(),
    settings: await kv.get('settings'), chain: await kv.get('chain'), calib: await kv.get('calib'),
    fields: await db.all('fields'), jobs, certs: await db.all('certs'), registry: await db.all('registry'),
    note: 'The device private key is non-extractable and is NOT included.' };
}
// ---------------- backup import, validated (review F-11) ----------------
const isLatLon = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
function validBoundary(b) { return Array.isArray(b) && b.length >= 3 && b.length <= 500 && b.every(isLatLon) ? b.map(([a, c]) => [a, c]) : null; }
const safeId = (x, prefix) => (typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x) ? x : randomId(prefix, 4));
const safeLabel = (x) => String(x ?? '').replace(/[|<>"'`&\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'Imported field';
function importedField(f) {
  const boundary = validBoundary(f?.boundary);
  if (!boundary) return null;
  return { id: safeId(f.id, 'F-'), label: safeLabel(f.label), boundary, areaM2: polygonAreaM2(boundary), centroid: centroidLatLon(boundary), method: 'import', createdAt: Date.now() };
}
/** Re-verify an imported certificate and build a clean registry record (never trusts stored status, snapshot or HTML). */
async function importedCert(c) {
  if (typeof c?.qr !== 'string' || c.qr.length > 4000) return null;
  const ext = c.ext && typeof c.ext === 'object' ? c.ext : null;
  const v = await verifyCert(c.qr, ext);
  if (!v.hash) return null;
  let boundary = validBoundary(c.boundary);
  if (boundary && (v.status !== 'VALID' || (await fieldHash(boundary)) !== v.payload.fh)) boundary = null; // G6: must hash to the signed fh
  return { id: v.hash, certId: v.payload?.id, qr: c.qr.trim(), payload: v.payload, kid: v.kid, hash: v.hash, pub: v.pub, status: v.status,
    extra: [], ext: v.extStatus === 'MATCH' ? ext : null, verifiedAt: Date.now(), demo: !!v.payload?.demo, source: 'import',
    boundary, snapshot: null };
}
export async function importBackup(o) {
  if (!o || typeof o !== 'object') throw new Error('Not a ParaliProof file');
  if (o.type === 'paraliproof-job') {
    const f = importedField(o.field);
    if (!f) throw new Error('The job file has no valid field boundary');
    await db.put('fields', f);
    return { fields: 1 };
  }
  if (o.type !== 'paraliproof-backup') throw new Error('Not a ParaliProof backup file');
  const n = { fields: 0, jobs: 0, certs: 0, registry: 0, rejected: 0 };
  for (const f of (Array.isArray(o.fields) ? o.fields : []).slice(0, 1000)) { const ff = importedField(f); if (ff) { await db.put('fields', ff); n.fields++; } else n.rejected++; }
  for (const j of (Array.isArray(o.jobs) ? o.jobs : []).slice(0, 500)) {
    try {
      const raw = rawFromJSON(j.raw);
      const { snapshot, ...rest } = j;
      await db.put('jobs', { ...rest, raw, id: safeId(j.id, 'J-'), fieldLabel: safeLabel(rest.fieldLabel), ext: sanitizeDeep(rest.ext), certId: typeof rest.certId === 'string' ? rest.certId.slice(0, 20) : null }); n.jobs++;
    } catch { n.rejected++; }
  }
  // certificates from another device go to the registry, re-verified here
  for (const c of [...(Array.isArray(o.certs) ? o.certs : []), ...(Array.isArray(o.registry) ? o.registry : [])].slice(0, 5000)) {
    const rec = await importedCert(c);
    if (rec) { await db.put('registry', rec); n.registry++; } else n.rejected++;
  }
  return n;
}
export async function wipeAll() { for (const s of ['fields', 'jobs', 'certs', 'registry', 'kv']) await db.clear(s); }

// ---------- dashboard ----------
/**
 * All certificates known on this device (issued + verified), re-verified now.
 * Each entry gets: status (VALID/TAMPERED/INVALID), trusted (full public-key match), extra flags
 * (DUPLICATE, CHAIN_BREAK, UNTRUSTED_KEY, OVERLAP, SLIP_REUSED, CAPACITY, MACHINE_TIME_CLASH,
 * BOUNDARY_MISMATCH), verdict (see verdictOf), payable, stage and readiness (see readiness()).
 * UNTRUSTED_KEY is a high-severity flag, so untrusted certificates are left out of acres/₹ totals
 * and counted as "needs review" — use summarizeDashboard() for the totals.
 * `gov` (optional, js/gov.js) supplies officer decisions, audit picks and DLEC results per certificate id.
 */
export async function dashboardEntries(settingsArg, gov = null) {
  const settings = settingsArg || await loadSettings();
  const myKey = await deviceKey();
  const own = await db.all('certs');
  const reg = await db.all('registry');
  const byHash = new Map();
  for (const c of own) byHash.set(c.hash, { ...c, source: 'device' });
  for (const r of reg) if (!byHash.has(r.hash || r.id)) byHash.set(r.hash || r.id, { ...r });
  const out = [];
  for (const e of byHash.values()) {
    const v = await verifyCert(e.qr, e.ext && Object.keys(e.ext).length ? e.ext : undefined);
    const local = e.source === 'device' || e.source === 'demo-fleet';
    const rec = { ...e, status: v.status, reason: v.reason, payload: v.payload || displaySafe(e.payload), kid: v.kid || null, hash: v.hash || e.hash, pub: v.pub || null,
      ext: local ? e.ext : sanitizeDeep(e.ext), snapshot: local ? e.snapshot : null, boundary: validBoundary(e.boundary) };
    // G6: a boundary from a file is used for the map and OVERLAP only if it hashes to the signed fh
    rec.boundaryMismatch = !!(rec.boundary && v.status === 'VALID' && (await fieldHash(rec.boundary)) !== v.payload.fh);
    if (rec.boundaryMismatch) rec.boundary = null;
    out.push(rec);
  }
  const chains = checkChains(out.filter((e) => e.status === 'VALID'));
  const thCount = {};
  for (const e of out) if (e.status === 'VALID') thCount[e.payload.th] = (thCount[e.payload.th] || 0) + 1;
  for (const e of out) {
    e.extra = [];
    e.trusted = isTrustedPub(e.pub, settings, myKey.pub);
    if (e.status === 'VALID') {
      if (thCount[e.payload.th] > 1) e.extra.push('DUPLICATE');
      const ch = chains.get(e.kid);
      if (ch && (ch.broken.includes(e.payload.id) || (ch.firstMissing != null && ch.firstMissing < e.payload.n))) e.extra.push('CHAIN_BREAK');
      if (!e.trusted) e.extra.push('UNTRUSTED_KEY');
      if (e.boundaryMismatch) e.extra.push('BOUNDARY_MISMATCH');
    }
  }
  for (const [a, b] of overlapPairs(out)) for (const e of [a, b]) if (!e.extra.includes('OVERLAP')) e.extra.push('OVERLAP');
  for (const [e, codes] of crossFlags(out, { capacity: settings.capacity })) for (const c of codes) if (!e.extra.includes(c)) e.extra.push(c);
  if (gov?.prepare) await gov.prepare(out); // audit picks (HMAC of the committed seed)
  for (const e of out) {
    e.chain = chains.get(e.kid) || null;
    e.verdict = verdictOf(e.status, e.trusted, [...(e.payload?.f || []), ...e.extra]);
    e.payable = e.verdict === 'VALID_TRUSTED';
    e.acres = payableOf(e.payload);
    e.stage = paymentStage(e, { greenups: getGreenups() });
    if (e.extra.includes('SLIP_REUSED')) e.slipGroup = slipGroup(out, e, payableOf);
    e.gov = gov?.forCert?.(e) || null;
    e.ready = readiness(e, e.gov);
  }
  return out.sort((a, b) => (b.payload?.t1 || 0) - (a.payload?.t1 || 0));
}

// ---------------- readiness for the DLEC list (D4-A, G11, G12) ----------------
// Never auto-pay, never auto-reject: READY only means "a person may put this on the DLEC list".
//   READY       genuine + registered phone + farmer slip + satellite clear (no burn on an image ≥ 12 days
//               after the job) + no open high flag + not picked for audit — or an officer VERIFIED it
//               (with a reason) after a visit / review.
//   WAITING     genuine, but the satellite image is not in yet (or was cloudy).
//   REVIEW      a person must look: a high flag, burn suspected, audit pick, needs a visit, no slip,
//               SDM grievance open.
//   NOT_USABLE  changed after signing / not a certificate / phone not registered / returned to normal
//               verification. The claim itself goes through today's process — it is never rejected.
export const BUCKETS = ['READY', 'WAITING', 'REVIEW', 'NOT_USABLE'];
const HIGH = (codes) => codes.some((c) => FLAG_INFO[c]?.sev === 'high');
export function readiness(e, gov = null) {
  const p = e.payload || {};
  const st = (e.stage || paymentStage(e)).stage;
  const dec = gov?.decision?.code || null, verified = dec === 'VERIFIED';
  if (gov?.dlec === 'APPROVED') return { ready: false, bucket: 'APPROVED', reason: 'DLEC_APPROVED' };
  if (e.status !== 'VALID') return { ready: false, bucket: 'NOT_USABLE', reason: 'CHANGED' };
  if (e.verdict === 'VALID_UNTRUSTED') return { ready: false, bucket: 'NOT_USABLE', reason: 'NOT_REGISTERED' };
  if (dec === 'RETURNED' || gov?.dlec === 'RETURNED') return { ready: false, bucket: 'NOT_USABLE', reason: 'RETURNED' };
  if (dec === 'REFER_SDM') return { ready: false, bucket: 'REVIEW', reason: 'GRIEVANCE' };
  if (!p.jh) return { ready: false, bucket: 'REVIEW', reason: 'NO_SLIP' };
  if (p.ss === 'F') return { ready: false, bucket: 'NOT_USABLE', reason: 'NO_STATE_SLIP' }; // Phase 4: farmer-made slip under a state profile
  if (dec === 'NEEDS_VISIT') return { ready: false, bucket: 'REVIEW', reason: 'VISIT' };
  const codes = [...(Array.isArray(p.f) ? p.f : []), ...(e.extra || [])];
  if (!verified && st === 'BURN_SUSPECTED') return { ready: false, bucket: 'REVIEW', reason: 'BURN' };
  if (!verified && HIGH(codes)) return { ready: false, bucket: 'REVIEW', reason: 'HIGH_FLAG' };
  if (!verified && st === 'NO_GREENUP') return { ready: false, bucket: 'REVIEW', reason: 'NO_GREENUP' };
  if (!verified && gov?.audit) return { ready: false, bucket: 'REVIEW', reason: 'AUDIT' };
  if (st === 'APPROVED' || st === 'CONFIRMED' || (verified && ['BURN_SUSPECTED', 'REVIEW', 'NO_GREENUP'].includes(st))) return { ready: true, bucket: 'READY', reason: verified ? 'VERIFIED' : 'SAT_CLEAR' };
  return { ready: false, bucket: 'WAITING', reason: st === 'INCONCLUSIVE' ? 'SAT_UNCLEAR' : 'SAT_PENDING' };
}

/**
 * Totals for the officer dashboard. acres / inr ("Incentive due") count READY claims only (G11):
 * satellite clear, farmer slip present, no open high flag. genuineAcres = the older figure (all payable
 * = genuine, registered, unflagged), shown for context only.
 */
export function summarizeDashboard(entries, rate) {
  const pay = entries.filter((e) => e.payable);
  const ready = entries.filter((e) => (e.ready || readiness(e)).ready);
  const acres = round(ready.reduce((a, e) => a + payableOf(e.payload).pa, 0), 2);
  const b = (k) => entries.filter((e) => (e.ready || readiness(e)).bucket === k).length;
  return {
    certificates: entries.length, payable: pay.length, genuineAcres: round(pay.reduce((a, e) => a + payableOf(e.payload).pa, 0), 2),
    ready: ready.length, acres, inr: Math.round(acres * rate),
    waiting: b('WAITING'), review: b('REVIEW'), notUsable: b('NOT_USABLE'), approved: b('APPROVED'),
    needsReview: entries.filter((e) => e.verdict === 'VALID_FLAGGED' || e.verdict === 'VALID_UNTRUSTED').length,
    untrusted: entries.filter((e) => e.verdict === 'VALID_UNTRUSTED').length,
    rejected: entries.filter((e) => e.status !== 'VALID').length,
    demo: entries.filter((e) => e.payload?.demo).length,
  };
}

/** CSV export with spreadsheet formula injection neutralised (review F-13). */
export function csvCell(x) {
  let s = String(x ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
/**
 * The officer's worksheet (D4-A): every certificate on this device. HQ can match a row by cert_id,
 * slip_hash (the farmer's slip) and cert_sha256 (re-verify the exact QR). indicative_inr is filled only
 * for rows that are ready_for_list = 1. officer_decision = the latest signed decision (js/gov.js), if any.
 */
export const CSV_COLUMNS = ['verdict', 'status', 'stage', 'ready_for_list', 'readiness', 'cert_id', 'cert_sha256', 'slip_hash', 'machine_hash', 'field_method', 'field', 'start', 'end', 'implement', 'width_m', 'width_source',
  'worked_acres', 'field_acres', 'registered_acres', 'payable_acres', 'payable_limit', 'coverage_pct', 'outside_acres', 'satellite', 'flags', 'device_key', 'trusted', 'seq', 'indicative_inr', 'officer_decision', 'demo'];
function csvRow(e, rate) {
  const p = e.payload || {};
  const iso = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString() : '');
  const pa = payableOf(p), rd = e.ready || readiness(e);
  return [e.verdict, e.status, (e.stage || paymentStage(e)).stage, rd.ready ? 1 : 0, rd.reason, p.id, e.hash || '', p.jh ?? '', p.mh ?? '', p.fm ?? '', p.fl, iso(p.t0), iso(p.t1), p.im, p.w, p.ws ?? '',
    p.wa, p.fa, p.ra ?? '', pa.pa, pa.limit ?? '', p.cv, p.oa, p.sv ?? '', [...(p.f || []), ...(e.extra || [])].join(' '),
    e.kid, e.trusted ? 1 : 0, p.n, rd.ready || rd.bucket === 'APPROVED' ? Math.round(pa.pa * rate) : '', e.gov?.decision ? `${e.gov.decision.code}:${e.gov.decision.reason}` : '', p.demo ? 1 : 0];
}
export function dashboardCSV(entries, rate) {
  return [CSV_COLUMNS, ...entries.map((e) => csvRow(e, rate))].map((r) => r.map(csvCell).join(',')).join('\n');
}
/**
 * The bulk file for HQ upload — PROPOSED FORMAT (there is no public MFMB/DBT API or agreed column map;
 * Haryana pays by DBT/SFTP from HQ after DLEC approval). Ready (or DLEC-approved) claims only, one row each.
 */
export const HQ_COLUMNS = ['format', 'cert_id', 'cert_sha256', 'slip_hash', 'machine_hash', 'stage', 'flags', 'payable_acres', 'registered_acres', 'rate_inr_per_acre', 'indicative_inr', 'job_date', 'dlec_batch', 'demo'];
/** columns (from a verified state profile's export map, Phase 4): [[internal column, state label]…]; format = its name. */
export function hqCSV(entries, rate, { batchId = '', columns = null, format = 'PP-HQ-PROPOSED-1', noCash = false } = {}) {
  const cols = Array.isArray(columns) && columns.length ? columns : HQ_COLUMNS.map((c) => [c, c]);
  const rows = entries.filter((e) => { const r = e.ready || readiness(e); return r.ready || r.bucket === 'APPROVED'; }).map((e) => {
    const p = e.payload, pa = payableOf(p).pa;
    const v = { format, cert_id: p.id, cert_sha256: e.hash, slip_hash: p.jh, machine_hash: p.mh ?? '', stage: (e.stage || paymentStage(e)).stage, flags: [...(p.f || []), ...(e.extra || [])].filter((c) => c !== 'DEMO').join(' '),
      payable_acres: pa, registered_acres: p.ra ?? '', rate_inr_per_acre: noCash ? '' : rate, indicative_inr: noCash ? '' : Math.round(pa * rate), job_date: new Date(p.t0 * 1000).toISOString().slice(0, 10),
      dlec_batch: batchId || e.gov?.batchId || '', demo: p.demo ? 1 : 0, parcel_hash: p.ph ?? '', slip_source: p.ss ?? '' };
    return cols.map(([c]) => v[c] ?? '');
  });
  return [cols.map(([, label]) => label), ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/**
 * Demo fleet for the officer dashboard: a realistic, mostly healthy fleet. Three synthetic tractors
 * (each with its own throwaway device key, all enrolled with this officer) run the REAL pipeline on
 * 8 fields and sign certificates, which are verified into the registry:
 *   • 6 genuine certificates: one on a real sat/ test parcel whose Sentinel-2 check says NOT_BURNED,
 *     five on synthetic farms near Abhaipur (no satellite result);
 *   • 1 genuine signature but flagged: a real sat/ parcel whose Sentinel-2 check says BURN_SUSPECTED;
 *   • 1 tampered: its acres were inflated after signing (the last certificate of its tractor, so the
 *     other chains stay unbroken).
 * All tractor data is SYNTHETIC and marked DEMO. The dashboard still sorts flagged and tampered first.
 */
export const FLEET_TAMPERED_INDEX = 5;
export function demoFleetSpecs(parcels = getDemoParcels()) {
  const demoC = centroidLatLon(sampleField().boundary);
  const quad = (p) => p.boundary?.length === 4;
  const far = (p) => { const c = centroidLatLon(p.boundary); return haversine(c[0], c[1], demoC[0], demoC[1]) > 1000; };
  const recent = (a, b) => (String(b.name).includes('2026') ? 1 : 0) - (String(a.name).includes('2026') ? 1 : 0);
  const burn = parcels.filter((p) => quad(p) && p.verdict === 'BURN_SUSPECTED').sort(recent)[0];
  const clean = parcels.filter((p) => quad(p) && p.verdict === 'NOT_BURNED' && far(p))[0];
  const specs = [];
  for (const p of [burn, clean]) if (p) specs.push({ parcel: p, label: `DEMO · ${p.name}` });
  const offsets = [[0.006, 0.004], [-0.004, 0.009], [0.011, -0.006], [-0.009, -0.008], [0.015, 0.012], [-0.013, 0.003]];
  for (const o of offsets) { if (specs.length >= 8) break; specs.push({ origin: [SIM_ORIGIN[0] + o[0], SIM_ORIGIN[1] + o[1]] }); }
  specs.forEach((sp, i) => {
    sp.i = i; sp.impl = DEFAULT_PRESETS[i % 4]; sp.dev = i % 3;
    sp.jobDate = sp.parcel?.jobDate || null; // real parcels: the date sat/ analysed (green-up job_date)
    if (!sp.parcel) { sp.L = 60 + (i * 7) % 30; sp.W = 36 + (i * 5) % 20; sp.angle = (i * 23) % 50 - 20; sp.label = `DEMO Farm ${String.fromCharCode(65 + i)}-${10 + i * 3}`; }
  });
  return specs;
}

export async function generateDemoFleet(settings, onProgress) {
  const calib = syntheticCalibration(settings);
  const keys = [await ephemeralKey(), await ephemeralKey(), await ephemeralKey()];
  // Demo enrolment: all three tractors are registered with this officer.
  settings.trustedKeys = [...(settings.trustedKeys || []), ...keys.map((k) => ({ kid: k.kid, pub: k.pub, addedAt: Date.now(), demo: true }))];
  await saveSettings(settings);
  const chains = [null, null, null];
  const specs = demoFleetSpecs();
  let made = 0;
  const stickers = DEMO_STICKERS;
  for (const s of specs) {
    onProgress?.(made / specs.length, { i: s.i, n: specs.length });
    await new Promise((r) => setTimeout(r, 0)); // let the UI repaint
    const fieldSim = s.parcel ? fieldFromBoundary(s.parcel.boundary) : sampleField({ origin: s.origin, lengthM: s.L, widthM: s.W, angleDeg: s.angle });
    const boundary = s.parcel ? s.parcel.boundary : fieldSim.boundary;
    const field = { id: 'F-FLEET' + s.i, label: s.label, boundary, centroid: centroidLatLon(boundary), areaM2: polygonAreaM2(boundary) };
    const t0 = s.jobDate ? Date.parse(s.jobDate + 'T04:30:00Z') + s.i * 3600e3 : Date.now() - (specs.length - s.i) * 3 * 3600e3;
    // v2 anti-cheat inputs: the DEMO sticker of this machine type + a DEMO job slip a little above the field area
    const sv0 = await verifySticker(stickers.find((x) => x.type === s.impl.code)?.qr);
    const machine = sv0.status === 'VALID' ? { source: 'sticker', mh: sv0.mh, type: sv0.sticker.type, w: sv0.sticker.w } : { source: 'manual', type: s.impl.code, w: s.impl.w };
    const slipObj = makeSlip({ reg: `DEMO-PB-2026-${String(1000 + s.i * 37).padStart(4, '0')}`, kh: `${12 + s.i * 7}/${3 + s.i}`, ra: round(polygonAreaM2(boundary) / M2_PER_ACRE + 0.1, 1),
      ...(boundary.length <= 12 ? { b: boundary } : { c: centroidLatLon(boundary) }) });
    const slip = { jh: await slipHash(slipObj.slip), ra: slipObj.slip.ra };
    const { res, durationMs } = runSyntheticJob({ field: fieldSim, widthM: machine.w, seed: 500 + s.i, calib, settings, t0 });
    const coverage = computeCoverage(field.boundary, res.raw.gps, res.windows, machine.w);
    const ctx = { field: { label: field.label, boundary, areaM2: field.areaM2, centroid: field.centroid }, job: { t0, t1: t0 + durationMs, implement: s.impl.code, widthM: machine.w, demo: true },
      coverage: { workedAcres: coverage.workedAcres, workedHa: coverage.workedHa, coveragePct: coverage.coveragePct, fieldAcres: coverage.fieldAcres }, rate: settings.rate };
    const job = { implement: s.impl.code, widthM: machine.w, t0, t1: t0 + durationMs, demo: true, calib, classifier: res.classifier, classifierKind: res.classifier.kind,
      raw: res.raw, windows: res.windows, timeMs: res.timeMs, coverage, machine, slip,
      ext: { ml: mlSection(res), satellite: await runHook('satellite', ctx), impact: await runHook('impact', ctx) } };
    job.limits = { idleKmh: settings.idleKmh, maxWorkKmh: settings.maxWorkKmh };
    job.cp = await classifierParamsHash(job);
    job.flags = computeFlags(job);
    job.trackHash = await trackHash(res.raw);
    const c = await issueCertificate({ key: keys[s.dev], chain: chains[s.dev], field, job, coverage, flags: job.flags, ext: job.ext, appVersion: APP_VERSION });
    chains[s.dev] = c.newChain;
    let qr = c.qr;
    if (s.i === FLEET_TAMPERED_INDEX) qr = qr.replace(`"wa":${c.payload.wa}`, `"wa":${round(c.payload.wa + 2.5, 2)}`); // tampered: acres inflated after signing
    const v = await verifyCert(qr, c.ext);
    await db.put('registry', { id: v.hash, certId: c.id, qr, payload: v.payload, kid: v.kid, hash: v.hash, pub: keys[s.dev].pub, status: v.status,
      extra: [], ext: c.ext, verifiedAt: Date.now(), demo: true, source: 'demo-fleet', boundary,
      snapshot: mapSnapshotSVG({ boundary, coverageGeo: coverage.coverageGeo, gps: res.raw.gps, windows: res.windows }) });
    made++;
  }
  onProgress?.(1);
  return made;
}

/**
 * Load a demo fleet that tools/make_demo_fleet.mjs pre-computed with generateDemoFleet()
 * (app/demo/demo-fleet.json), so the guided tour shows the dashboard instantly on any phone.
 * Every certificate is RE-VERIFIED here (signature, canonical form, plausibility, ext hash); the
 * file is treated as untrusted input like a backup import (review F-11: no snapshots, ext sanitised).
 */
export async function importDemoFleet(settings, data) {
  if (!data || data.schema !== 'paraliproof.demo-fleet.v1' || !Array.isArray(data.certs)) throw new Error('Not a ParaliProof demo fleet file');
  const keys = (Array.isArray(data.trustedKeys) ? data.trustedKeys : []).filter((k) => isValidPubB64u(k?.pub)).slice(0, 8);
  settings.trustedKeys = [...(settings.trustedKeys || []).filter((k) => !keys.some((x) => x.pub === k.pub)),
    ...keys.map((k) => ({ kid: String(k.kid).slice(0, 24), pub: k.pub, addedAt: Date.now(), demo: true }))];
  await saveSettings(settings);
  let n = 0;
  for (const c of data.certs.slice(0, 32)) {
    if (typeof c?.qr !== 'string' || c.qr.length > 4000) continue;
    const ext = c.ext && typeof c.ext === 'object' ? sanitizeDeep(c.ext) : null;
    const v = await verifyCert(c.qr, ext || undefined);
    if (!v.hash || !v.payload?.demo) continue; // only DEMO certificates may come from this file
    await db.put('registry', { id: v.hash, certId: v.payload.id, qr: c.qr.trim(), payload: v.payload, kid: v.kid, hash: v.hash, pub: v.pub, status: v.status,
      extra: [], ext: v.extStatus === 'MATCH' ? ext : null, verifiedAt: Date.now(), demo: true, source: 'demo-fleet', boundary: validBoundary(c.boundary), snapshot: null });
    n++;
  }
  return n;
}

/**
 * DEMO DISTRICT for the DDA / State screens (Phase 3): pre-computed by tools/make_demo_district.mjs
 * (app/demo/demo-district.json). Treated as untrusted input: every certificate is RE-VERIFIED, only DEMO
 * certificates are accepted, extensions are sanitised, snapshots are never taken from the file. Phones come
 * enrolled as in the file ("active", or "pending" the SDAO countersignature). Machines/CHCs/villages are
 * a small DEMO registry for the machine-use view.
 */
export async function importDemoDistrict(settings, data) {
  if (!data || data.schema !== 'paraliproof.demo-district.v1' || !Array.isArray(data.certs)) throw new Error('Not a ParaliProof demo district file');
  const keys = (Array.isArray(data.trustedKeys) ? data.trustedKeys : []).filter((k) => isValidPubB64u(k?.pub)).slice(0, 16);
  settings.trustedKeys = [...(settings.trustedKeys || []).filter((k) => !keys.some((x) => x.pub === k.pub)),
    ...keys.map((k) => ({ kid: String(k.kid).slice(0, 24), pub: k.pub, chc: safeLabel(k.chc), addedAt: Date.now(), demo: true, via: 'registration', ...(k.status === 'pending' ? { status: 'pending' } : { status: 'active' }) }))];
  await saveSettings(settings);
  const T = ['HS', 'SS', 'BL', 'MU', 'OT'];
  const machines = (Array.isArray(data.machines) ? data.machines : []).slice(0, 64)
    .filter((m) => typeof m?.mid === 'string' && /^[A-Z0-9-]{3,24}$/.test(m.mid) && T.includes(m.type))
    .map((m) => ({ mid: m.mid, type: m.type, w: Number(m.w) || null, chc: safeLabel(m.chc), owner: m.owner === 'individual' ? 'individual' : 'chc', demo: true }));
  const villages = (Array.isArray(data.villages) ? data.villages : []).slice(0, 32).filter((v) => /^V\d{1,2}$/.test(v?.id)).map((v) => ({ id: v.id, name: safeLabel(v.name) }));
  await kv.set('demoRegistry', { machines, villages, chcs: (Array.isArray(data.chcs) ? data.chcs : []).slice(0, 16).map(safeLabel), at: Date.now() });
  let n = 0;
  for (const c of data.certs.slice(0, 64)) {
    if (typeof c?.qr !== 'string' || c.qr.length > 4000) continue;
    const ext = c.ext && typeof c.ext === 'object' ? sanitizeDeep(c.ext) : null;
    const v = await verifyCert(c.qr, ext || undefined);
    if (!v.hash || !v.payload?.demo) continue; // only DEMO certificates may come from this file
    await db.put('registry', { id: v.hash, certId: v.payload.id, qr: c.qr.trim(), payload: v.payload, kid: v.kid, hash: v.hash, pub: v.pub, status: v.status,
      extra: [], ext: v.extStatus === 'MATCH' ? ext : null, verifiedAt: Date.now(), demo: true, source: 'demo-district', boundary: validBoundary(c.boundary), snapshot: null,
      village: /^(V\d{1,2}|real)$/.test(c.village) ? c.village : null });
    n++;
  }
  return n;
}
export async function demoRegistry() { return (await kv.get('demoRegistry')) || null; }

export function certSummary(p) {
  return { id: p.id, field: p.fl, acres: p.wa, coverage: p.cv, start: p.t0 * 1000, end: p.t1 * 1000, implement: p.im, flags: p.f || [], demo: !!p.demo };
}
export { decodeCert, canonical };

// ---------- ML retraining export (schema paraliproof.recording.v1, see ml/README.md) ----------
const iso = (ms) => new Date(ms).toISOString();
/** One job → one session in the ML export schema. */
export function jobToSession(job, settings) {
  const r = job.raw, t0 = r.t0, n = r.accT.length;
  const accel = new Array(n);
  for (let i = 0; i < n; i++) accel[i] = [t0 + r.accT[i], r.accX[i] / 100, r.accY[i] / 100, r.accZ[i] / 100];
  return {
    session_id: job.id,
    implement: IMPLEMENT_ML_NAME[job.implement] || 'other',
    placement: job.placement || settings?.placement || 'other',
    device: { user_agent: globalThis.navigator?.userAgent || null },
    demo: !!job.demo,
    accel,
    gps: r.gps.map((g) => [t0 + g[0], g[1], g[2], g[3], g[4] >= 0 ? g[4] : null, g[5] >= 0 ? g[5] : null]),
    labels: (job.labels || []).filter((l) => l.end_ms > l.start_ms),
  };
}
export async function calibrationSessions() { return (await kv.get('calibSessions')) || []; }
export async function saveCalibrationSession(sess) {
  const all = await calibrationSessions();
  all.push(sess);
  await kv.set('calibSessions', all.slice(-8)); // keep the last 8
}
/** The file ml/retrain_from_field.py reads. Demo (synthetic) jobs are excluded unless asked for. */
export async function mlExport(settings, { includeDemo = false } = {}) {
  const jobs = (await db.all('jobs')).filter((j) => includeDemo || !j.demo);
  const sessions = [...(await calibrationSessions()), ...jobs.map((j) => jobToSession(j, settings))];
  return { schema: 'paraliproof.recording.v1', app_version: APP_VERSION, exported_at: iso(Date.now()), sessions };
}
