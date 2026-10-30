// demoseed.js — sample data for the DEMO accounts (js/accounts.js). NO DOM CODE HERE.
//
// So that no screen is empty when the phone is handed over, the first account choice loads the demo data
// the app already knows how to make, through the SAME functions the buttons use:
//   1. the DEMO district (demo/demo-district.json, 39 claims, 4 villages): services.importDemoDistrict,
//      every signature re-checked — the "Load demo district" button;
//   2. the demo fleet (demo/demo-fleet.json, 8 certificates, 3 tractors): services.importDemoFleet;
//   3. the operator's phone: the DEMO Abhaipur parcel, the DEMO Happy Seeder sticker, the synthetic
//      calibration and a DEMO job slip (the same values judge mode uses, js/tour-data.js), plus ONE finished
//      job run through the real pipeline and signed by this phone's key — so the farmer and the operator have
//      a real certificate to open;
//   4. the two-person enrolment of this phone: the DEMO ADO account signs it ("Pending: ADO signed") so the
//      DEMO SDAO account can countersign it with its own key; the district's pending phone gets the same
//      ADO enrolment entry;
//   5. the DLEC batch: the DEMO DDA account freezes the ready claims — the "Load demo district and batch"
//      button.
// Every record stays DEMO (certificates carry demo: 1; labels start with DEMO). Each step checks first, so
// running it again adds nothing (idempotent). It refuses to run in the judge-mode database (TOUR_DB).

import * as S from './services.js';
import * as G from './gov.js';
import { db, currentDatabase, REAL_DB } from './store.js';
import { verifySticker, makeSlip, slipHash, makeRegistration, verifyRegistration } from './qrformats.js';
import { sampleField } from './sim.js';
import { round, M2_PER_ACRE } from './util.js';
import STICKERS from '../demo/stickers.js';

export const SEED_STEPS = ['district', 'fleet', 'operator', 'job', 'enrol', 'batch'];
export const DEMO_CHC = 'DEMO CHC Abhaipur';
// the DEMO slip the judge-mode tour and the farmer's "Use the demo parcel" button already use (no real ID)
export const DEMO_SLIP = { reg: 'DEMO-PB-2026-0457', kh: '45/12' };

const fetchDemo = (file) => async () => (await fetch(new URL('../demo/' + file, import.meta.url))).json();

/** True once every step has run on this phone (settings.demoSeedAt). */
export const isSeeded = (settings) => !!settings?.demoSeedAt;

/**
 * Load all sample data into the REAL database (never the tour's). Mutates and saves `settings`.
 * @param {object} settings  app.settings
 * @param {{district?:()=>Promise<object>, fleet?:()=>Promise<object>, onStep?:(id:string,i:number,n:number)=>void, now?:number}} opts
 * @returns {Promise<{added:object}>}  how many records each step added (0 when it had already run)
 */
export async function seedDemo(settings, { district = fetchDemo('demo-district.json'), fleet = fetchDemo('demo-fleet.json'), onStep, now = Date.now() } = {}) {
  if (settings?.tour || currentDatabase() !== REAL_DB) throw new Error('Sample data is never loaded into judge mode.');
  const added = {};
  const step = async (id, fn) => { onStep?.(id, SEED_STEPS.indexOf(id), SEED_STEPS.length); added[id] = await fn(); };
  settings.demo = true; // sample data = demo mode (the DEMO badge and the Tamper test show)

  await step('district', async () => {
    if (settings.demoDistrictAt) return 0;
    const n = await S.importDemoDistrict(settings, await district());
    settings.demoDistrictAt = now; await S.saveSettings(settings);
    return n;
  });
  await step('fleet', async () => {
    if (settings.demoFleetAt) return 0;
    const n = await S.importDemoFleet(settings, await fleet());
    settings.demoFleetAt = now; await S.saveSettings(settings);
    return n;
  });
  await step('operator', () => seedOperator(settings));
  await step('job', () => seedJob(settings, now));
  await step('enrol', () => seedEnrolment(settings));
  await step('batch', () => seedBatch(settings));
  settings.demoSeedAt = settings.demoSeedAt || now;
  await S.saveSettings(settings);
  return { added };
}

/** The operator's phone, as judge mode prepares it: CHC name, DEMO sticker, demo parcel, calibration, farmer slip. */
async function seedOperator(settings) {
  let n = 0;
  const f = await S.ensureDemoField();
  if (!settings.chc) { settings.chc = DEMO_CHC; n++; }
  if (!settings.activeFieldId) { settings.activeFieldId = f.id; n++; }
  if (S.activeMachine(settings)?.source !== 'sticker') {
    const v = await verifySticker(STICKERS.find((x) => x.type === 'HS')?.qr);
    if (v.status === 'VALID') { await S.setMachineFromSticker(settings, v); n++; }
  }
  if (!(await S.getCalibration(true))) { await S.setCalibration(true, S.syntheticCalibration(settings)); n++; }
  // the farmer's own slip (My job slip): the demo parcel, its registered acres a little above the field area
  if (!settings.mySlip) {
    const r = makeSlip({ ...DEMO_SLIP, ra: round(f.areaM2 / M2_PER_ACRE + 0.05, 1), b: f.boundary });
    settings.mySlip = { ...r, jh: await slipHash(r.slip), at: Date.now() };
    n++;
  }
  await S.saveSettings(settings);
  return n;
}

/** One finished DEMO job on the demo parcel, through the real pipeline, signed by this phone (once). */
async function seedJob(settings, now) {
  if ((await S.listCerts()).some((c) => c.demo && c.seed)) return 0;
  const f = await S.ensureDemoField();
  const calib = await S.getCalibration(true);
  const m = S.activeMachine(settings);
  const widthM = m?.w || 2.2;
  const t0 = now - 5 * 3600e3; // the ~1 h 40 min job finished earlier today
  const { res, durationMs } = S.runSyntheticJob({ field: sampleField(), widthM, seed: 42, calib, settings, t0 });
  const jh = settings.mySlip?.jh;
  const job = await S.buildJob(res, { field: f, implement: m?.type || 'HS', widthM, t0, t1: t0 + durationMs, demo: true, calib, rate: settings.rate,
    machine: m ? { source: m.source, mh: m.mh, type: m.type, w: m.w } : null,
    slip: jh ? { jh, ra: settings.mySlip.slip.ra } : null, slipGeo: jh ? { c: null, b: settings.mySlip.slip.b || null } : null, selfOp: null });
  const rec = await S.issueForJob(job, f);
  await db.put('certs', { ...rec, seed: true }); // marks the sample certificate, so a second run makes no other
  return 1;
}

/** Two-person enrolment, first half: the DEMO ADO account enrols this phone and the district's pending phone. */
async function seedEnrolment(settings) {
  let n = 0;
  await G.withOfficerKey('block', async () => {
    const me = await S.deviceKey();
    if (!(settings.trustedKeys || []).some((k) => k.pub === me.pub)) {
      const reg = await verifyRegistration(await makeRegistration(me, settings.chc || DEMO_CHC));
      if (reg.ok) {
        await G.enrolPhone('block', settings, reg, S.saveSettings); n++;
        // list this phone first, so the SDAO's Approvals screen (and the walkthrough) start with it
        settings.trustedKeys = [settings.trustedKeys.find((k) => k.pub === me.pub), ...settings.trustedKeys.filter((k) => k.pub !== me.pub)];
      }
    }
    // the demo district ships one phone "pending" with no enrolment entry on this phone: sign it as the ADO
    for (const k of (settings.trustedKeys || []).filter((x) => x.status === 'pending' && !x.enrolledBy && x.demo)) {
      const rec = await G.appendLog('enrol', 'block', { kid: k.kid, pub: k.pub, chc: k.chc || '' });
      k.enrolledBy = rec.h; k.enrolKid = rec.kid; n++;
    }
    await S.saveSettings(settings);
  });
  return n;
}

/** The DEMO DDA account freezes the ready claims into the DLEC batch (once). */
async function seedBatch(settings) {
  const gov = await G.loadGov();
  if (gov.batches.length) return 0;
  const entries = await S.dashboardEntries(settings, gov);
  const ready = entries.filter((e) => e.ready?.ready && !e.gov?.batchId);
  if (!ready.length) return 0;
  await G.withOfficerKey('district', () => G.buildBatch('district', ready, S.payableOf));
  return 1;
}

/** This phone's registration as the officers see it: 'none' | 'pending' | 'active'. */
export async function phoneStatus(settings) {
  const me = await S.deviceKey();
  const k = (settings.trustedKeys || []).find((x) => x.pub === me.pub);
  if (!k) return { status: 'none', kid: me.kid };
  return { status: k.status === 'pending' ? 'pending' : 'active', kid: me.kid };
}

/** Officer account: its own signing key (made on this phone the first time it is needed). */
export const officerKeyId = async (accountId) => (await G.withOfficerKey(accountId, () => G.signerKey())).kid;
