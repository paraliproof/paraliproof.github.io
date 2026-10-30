// tour-data.js — data side of judge mode (js/tour.js). NO DOM CODE HERE.
//
// The tour never touches the user's real data: it switches js/store.js to a separate IndexedDB
// database (TOUR_DB) with its own settings, demo field, calibration, throw-away device key, hash
// chain, certificate and demo fleet. Exit closes and deletes that database; boot deletes a
// leftover one (e.g. after the tab was closed mid-tour). Every certificate made in the tour is
// a DEMO certificate (simulated job), like the normal demo mode.

import * as S from './services.js';
import { useDatabase, lockDatabase, deleteTourDatabase, currentDatabase, REAL_DB, TOUR_DB } from './store.js';
import { verifySticker, makeSlip, slipHash } from './qrformats.js';
import STICKERS from '../demo/stickers.js';

export const TOUR_SPEED = 300; // the ~1 h 40 min synthetic job replays in ~20 s

/** Switch to a fresh tour database and prepare it. Returns the tour's settings (keeps language + theme). */
export async function enterTourData(realSettings = {}) {
  await deleteTourDatabase();          // start clean (also switches back to REAL_DB if needed)
  await useDatabase(TOUR_DB);
  const s = { ...S.DEFAULT_SETTINGS, lang: realSettings.lang || 'en', night: !!realSettings.night, rate: realSettings.rate || S.DEFAULT_SETTINGS.rate,
    demo: true, tour: true, replaySpeed: TOUR_SPEED, implement: 'HS', widthM: 2.2, trustedKeys: [] };
  const f = await S.ensureDemoField();
  s.activeFieldId = f.id;
  s.role = 'operator'; s.chc = 'DEMO CHC Abhaipur';
  // two-scan start, already done for the tour: the DEMO Happy Seeder sticker + a DEMO job slip for the parcel
  const v = await verifySticker(STICKERS.find((x) => x.type === 'HS')?.qr);
  if (v.status === 'VALID') await S.setMachineFromSticker(s, v);
  const slip = makeSlip({ reg: 'DEMO-PB-2026-0457', kh: '45/12', ra: Math.round((f.areaM2 / 4046.8564224) * 10 + 0.5) / 10, b: f.boundary });
  await S.setJobSlip(s, slip, await slipHash(slip.slip));
  await S.saveSettings(s);
  await S.setCalibration(true, S.syntheticCalibration(s));
  return s;
}

/** Leave the tour: refuse further writes, delete the tour database. `reopenReal` switches back (tests). */
export async function exitTourData({ reopenReal = false } = {}) {
  await lockDatabase();
  await deleteTourDatabase();
  if (reopenReal) await useDatabase(REAL_DB);
}

/** On boot: remove a tour database left behind by a closed tab. */
export async function cleanupStaleTour() {
  if (currentDatabase() !== TOUR_DB) await deleteTourDatabase();
}

/** The demo fleet (8 certificates): pre-computed by tools/make_demo_fleet.mjs, re-verified on load.
 *  The tour used it for its old step 7 (officer dashboard); kept for the officer dashboard's "Add demo fleet". */
export async function loadTourFleet(settings, fetchJson = async () => (await fetch(new URL('../demo/demo-fleet.json', import.meta.url))).json()) {
  if (currentDatabase() !== TOUR_DB) throw new Error('not in the tour database');
  return S.importDemoFleet(settings, await fetchJson());
}

/** UX-4: the government steps (claim queue → decision → DLEC) run on the signed DEMO district, in the tour
 *  database only. Every signature is re-checked on load (services.importDemoDistrict). Returns the count. */
export async function loadTourDistrict(settings, fetchJson = async () => (await fetch(new URL('../demo/demo-district.json', import.meta.url))).json()) {
  if (currentDatabase() !== TOUR_DB) throw new Error('not in the tour database');
  return S.importDemoDistrict(settings, await fetchJson());
}
