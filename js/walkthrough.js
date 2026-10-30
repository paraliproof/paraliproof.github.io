// walkthrough.js — a guided walk through the nine DEMO accounts (acc-1, 30 Oct), for handing one phone to a
// mentor or judge: Farmer → Operator → CHC → Village → Block ADO → SDAO → DDA → DLEC → State.
// Each step switches account (views/account.js chooseAccount: role / level / account, sample data the first
// time) and opens that account's home screen; a bottom bar (#walkBar, styled like the judge tour's bar) says
// in one sentence what to show there, with Back / Next / Exit. The tabs are hidden while it runs, as in the tour.
//
// It is NOT the judge tour: js/tour.js, js/tour-data.js and their 9 steps are untouched. The walkthrough runs
// on the real database with the sample data (nothing is deleted on Exit); the tour keeps its own database.
// Entry: any [data-walk] button (the account picker, the profile sheet).

import { $, t, closeModal } from './ui.js';
import { WALK_ORDER, accountInfo } from './accounts.js';
import { chooseAccount, roleLine } from './views/account.js';

export const WALK_STEPS = WALK_ORDER.length;
let app = null, st = null; // st = { i, busy }

export const isWalking = () => !!st;

export function init(a) {
  app = a;
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-walk]')) { e.preventDefault(); start(); } });
  $('#walkNext').addEventListener('click', next);
  $('#walkBack').addEventListener('click', back);
  $('#walkExit').addEventListener('click', exit);
  new ResizeObserver(() => document.documentElement.style.setProperty('--walk-h', $('#walkBar').offsetHeight + 'px')).observe($('#walkBar'));
}

/** Start at step 0 (Farmer). Refused in judge mode. */
export async function start(i = 0) {
  if (app.settings.tour) return;
  closeModal();
  st = { i, busy: false };
  document.body.classList.add('is-walking');
  $('#walkBar').hidden = false;
  await go(i);
  if (st) $('#walkNext').focus({ preventScroll: true });
}

function caption() {
  const i = st.i, a = accountInfo(WALK_ORDER[i]);
  $('#walkBar').setAttribute('aria-label', t('walk.label'));
  $('#walkCount').textContent = t('tour.count', { n: i + 1, total: WALK_STEPS });
  $('#walkRole').textContent = roleLine(a);
  $('#walkText').textContent = t(a.walkKey);
  $('#walkBar').style.setProperty('--p', String((i + 1) / WALK_STEPS));
  $('#walkBack').textContent = t('walk.back');
  $('#walkBack').hidden = i === 0;
  $('#walkNext').textContent = i === WALK_STEPS - 1 ? t('tour.finish') : t('tour.next');
  $('#walkExit').textContent = t('walk.exit');
  $('#walkExit').setAttribute('aria-label', t('walk.exit_label'));
}
// aria-disabled (not disabled) so keyboard focus stays on Next while the account switches
function busy(b) {
  st.busy = b;
  for (const id of ['#walkNext', '#walkBack']) { $(id).setAttribute('aria-disabled', b ? 'true' : 'false'); $(id).setAttribute('aria-busy', b ? 'true' : 'false'); }
}

async function go(i) {
  if (!st) return;
  st.i = Math.max(0, Math.min(WALK_STEPS - 1, i));
  busy(true);
  caption();
  try { await chooseAccount(WALK_ORDER[st.i]); } catch (e) { console.error(e); }
  if (st) busy(false);
}

function next() {
  if (!st || st.busy) return;
  if (st.i >= WALK_STEPS - 1) { exit(); return; }
  go(st.i + 1);
}
function back() {
  if (!st || st.busy || st.i === 0) return;
  go(st.i - 1);
}

/** Exit: hide the bar and stay on the current account and screen (no data is removed). */
export function exit() {
  if (!st) return;
  st = null;
  document.body.classList.remove('is-walking');
  $('#walkBar').hidden = true;
  app.refreshChrome();
}
