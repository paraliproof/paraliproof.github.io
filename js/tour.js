// tour.js — judge mode: a guided ~2-minute tour of the whole flow. The 6-step core (Record → replay →
// result with satellite pictures → certificate → verify Genuine → tamper test) continues into the
// government chain (UX-4, 30 Oct): claim queue (burn alert first) → a signed decision → DLEC batch approved,
// with the HQ file ready. An intro sheet (judge-intro illustration slot) comes before step 1.
//
// Entry: the quiet card on the Record tab (#tourCard), or the URL ?tour=1 (QR on the slides), which
// starts the tour on boot. A caption bar (#tourBar) shows "n / 9", one sentence, Next and Exit.
// Next is the only way forward, except that step 2 moves on by itself when the replay finishes.
// Data isolation: js/tour-data.js runs the whole tour in a separate database and deletes it on Exit;
// the page then reloads on the user's real data.

import { $, t, esc, toast, openModal, closeModal } from './ui.js';
import * as record from './views/record.js';
import { tourTamper } from './views/verify.js';
import { enterTourData, exitTourData, loadTourDistrict, TOUR_SPEED } from './tour-data.js';
import * as S from './services.js';
import * as G from './gov.js';
import { FLAG_INFO } from './flags.js';
import { illusHTML } from './illus.js';

export const TOUR_STEPS = 9;
/** Today as YYYY-MM-DD in the phone's own time zone (toISOString() is UTC: before 05:30 IST it said yesterday). */
const localDay = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
let app = null, st = null; // st = { step, busy, cert, fleet: Promise }

export const isTouring = () => !!st;
export const tourRequested = () => new URLSearchParams(location.search).get('tour') === '1';

export function init(a) {
  app = a;
  $('#tourCard').addEventListener('click', (e) => { e.preventDefault(); start(); });
  $('#tourNext').addEventListener('click', next);
  $('#tourExit').addEventListener('click', exit);
  document.addEventListener('keydown', (e) => { if (st && e.key === 'Escape' && !e.defaultPrevented && $('#modal').hidden) { e.preventDefault(); exit(); } });
  new ResizeObserver(() => document.documentElement.style.setProperty('--tour-h', $('#tourBar').offsetHeight + 'px')).observe($('#tourBar'));
}

export async function start({ focus = true } = {}) {
  if (st) return;
  if (record.isRecording()) { toast(t('tour.busy')); return; }
  st = { step: 0, busy: true };
  app.settings = await enterTourData(app.settings); // from here on, every read/write goes to the tour database
  document.body.classList.add('is-touring');
  $('#tourBar').hidden = false;
  app.refreshChrome();
  await go(1);
  await intro(); // the judge-intro sheet: what the next 2 minutes show (Exit leaves at once)
  if (st && focus) $('#tourNext').focus({ preventScroll: true }); // keyboard / screen-reader users land on Next
}

/** J-1: one sheet before step 1 — one illustration (slot 12, only if the file exists), one sentence, Start. */
function intro() {
  return new Promise((resolve) => {
    const body = openModal(`<div class="tour-intro"><div class="illus-slot illus-slot--wide" data-illus="judge-intro"></div>
      <p class="pp-head__eyebrow">${esc(t('tour.intro_eyebrow'))}</p><h3 class="tour-intro__title">${esc(t('tour.intro_title'))}</h3><p class="tour-intro__body">${esc(t('tour.intro_body'))}</p>
      <button type="button" class="btn btn-primary btn-xxl" id="tourStart">${esc(t('tour.start'))}</button><button type="button" class="btn btn-ghost btn-xxl" id="tourIntroExit">${esc(t('tour.not_now'))}</button></div>`);
    body.closest('.modal-card').setAttribute('aria-label', t('tour.intro_title'));
    illusHTML(body.querySelector('[data-illus]'), 'judge-intro');
    body.querySelector('#tourStart').addEventListener('click', () => { closeModal(); resolve(); });
    body.querySelector('#tourIntroExit').addEventListener('click', () => { closeModal(); resolve(); exit(); });
    body.querySelector('#tourStart').focus();
  });
}

// steps 1–4 are the operator's phone, 5–9 the officers'
const ROLE_OF_STEP = (n) => (n <= 4 ? 'operator' : 'officer');
function caption() {
  const n = st.step;
  const role = ROLE_OF_STEP(n);
  if (app.settings.role !== role) { app.settings.role = role; app.refreshChrome(); }
  $('#tourRole').textContent = t('tour.role_' + role);
  $('#tourBar').setAttribute('aria-label', t('tour.label'));
  $('#tourCount').textContent = t('tour.count', { n, total: TOUR_STEPS });
  $('#tourText').textContent = t('tour.s' + n);
  $('#tourBar').style.setProperty('--p', String(n / TOUR_STEPS));
  $('#tourNext').textContent = n === TOUR_STEPS ? t('tour.finish') : t('tour.next');
  $('#tourExit').textContent = t('tour.exit');
  $('#tourExit').setAttribute('aria-label', t('tour.exit_label'));
  busy(st.busy);
}
// aria-disabled (not disabled) so keyboard focus stays on Next between steps
function busy(b) {
  st.busy = b;
  $('#tourNext').setAttribute('aria-disabled', b ? 'true' : 'false');
  $('#tourNext').setAttribute('aria-busy', b ? 'true' : 'false');
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Scroll so `bottomEl` ends just above the sticky action bar and tour bar, without pushing `topEl` under the top bar. */
function scrollIntoBand(topEl, bottomEl) {
  if (!topEl) return;
  const head = ($('.pp-topbar')?.offsetHeight || 0) + 12;
  const foot = ($('#tourBar')?.offsetHeight || 0) + ($('#jobResult .pp-actionbar')?.offsetHeight || 0) + 12;
  const top = topEl.getBoundingClientRect().top + scrollY, bottom = (bottomEl || topEl).getBoundingClientRect().bottom + scrollY;
  const y = Math.min(top - head, bottom - (innerHeight - foot));
  scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'auto' : 'smooth' });
}

async function go(n) {
  if (!st) return;
  st.step = n;
  busy(true);
  caption();
  const tt = $('#toast'); if (tt) tt.hidden = true; // a message from the last step never covers the next one
  try {
    if (n === 1) {
      app.go('job');
      await later(300);
    } else if (n === 2) {
      // the replay itself is the step; it moves on to step 3 when it finishes (or on Next)
      st.replay = record.tourReplay(TOUR_SPEED).then(() => { if (st?.step === 2) go(3); }, (e) => { console.error(e); toast(e.message); });
      await later(400);
      if (st?.step === 2) busy(false);
      return;
    } else if (n === 3) {
      if (app.current !== 'job') app.go('job');
      await later(1800); // acres first, then the satellite card
      if (st?.step === 3) scrollIntoBand($('#slotSatPics .sat-tiles') || $('#resChecks'), $('#slotSatPics .sat-caption') || $('#resChecks'));
    } else if (n === 4) {
      const rec = await record.tourIssue();
      if (!rec) throw new Error('certificate not issued');
      st.cert = rec;
      st.district = loadTourDistrict(app.settings).catch((e) => { console.warn('tour district', e); return 0; }); // ready by step 7
      await later(400);
    } else if (n === 5) {
      app.go('verify', { text: st.cert.qr, ext: st.cert.ext });
      await later(600);
    } else if (n === 6) {
      if (app.current !== 'verify') { app.go('verify', { text: st.cert.qr, ext: st.cert.ext }); await later(600); }
      await tourTamper();
      await later(400);
    } else if (n === 7) {
      // the block officer's claim queue: the burn alert comes first, nothing is paid or rejected automatically
      $('#tourCount').textContent = t('tour.count', { n, total: TOUR_STEPS }) + ' · ' + t('tour.preparing');
      await st.district;
      if (!st) return;
      app.settings.govLevel = 'block';
      caption();
      app.go('queue');
      await later(700);
    } else if (n === 8) {
      // a person decides: "Needs visit" on the burn alert, signed into the append-only officer log
      const entries = await S.dashboardEntries(app.settings, await G.loadGov());
      const top = G.claimQueue(entries, FLAG_INFO).open[0];
      if (top && !top.e.gov?.decision) await G.decide('block', top.e.payload.id, 'NEEDS_VISIT', top.pr === 0 ? 'SAT_BURN' : 'HIGH_FLAG', '');
      if (!st) return;
      if (top) app.go('case/' + top.e.payload.id);
      await later(800);
      if (st?.step === 8) scrollIntoBand($('#caseBody .case-latest') || $('#caseBody'), $('#caseBody .case-latest'));
    } else if (n === 9) {
      // the DDA builds the batch from READY claims only; the committee approves it and signs the minutes
      const entries = await S.dashboardEntries(app.settings, await G.loadGov());
      const gov0 = await G.loadGov();
      if (!gov0.batches.length) {
        const ready = entries.filter((e) => e.ready?.ready && !e.gov?.batchId);
        if (ready.length) {
          const b = await G.buildBatch('district', ready, S.payableOf);
          await G.dlecDecide('dlec', b.body.id, ready.map((e) => e.payload.id), 'APPROVED', 'EVIDENCE_OK');
          await G.signMinutes('dlec', b.body.id, { date: localDay(), members: 'DC (chair)\nDDA (member secretary)\nCHC representative' });
        }
      }
      if (!st) return;
      app.settings.govLevel = 'dlec';
      app.go('dlec');
      await later(700);
    }
  } catch (e) { console.error(e); toast(e.message); }
  if (st?.step === n) busy(false);
}

function next() {
  if (!st || st.busy) return;
  if (st.step === 2) { busy(true); if (!record.finishReplayNow()) busy(false); return; } // auto-advances when processed
  if (st.step >= TOUR_STEPS) { exit(); return; }
  go(st.step + 1);
}

/** Exit: stop any replay, delete the tour database, reload the app on the real data (without ?tour=1). */
export async function exit() {
  if (!st) return;
  st = null;
  record.abortRun();
  closeModal();
  $('#tourNext').setAttribute('aria-disabled', 'true'); $('#tourExit').disabled = true;
  await exitTourData();
  history.replaceState(null, '', location.pathname + '#job');
  location.reload();
}
