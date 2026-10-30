// views/account.js — DEMO ACCOUNTS (acc-1, 30 Oct): the account picker on #welcome, choosing an account
// (sample data loads the first time), the profile corner in the top bar and its sheet.
// DOM contract: #welAccounts (picker, rendered here), #acctBtn (top-bar avatar), #modal (the sheet).
// Choosing an account sets only settings.role, settings.govLevel and settings.account (js/accounts.js);
// roles.js decides the tabs and the home screen exactly as before. No password, OTP or Aadhaar anywhere:
// the sheet only SAYS where identity is checked at pilot.
import * as S from '../services.js';
import { $, t, esc, toast, getLang, openModal, closeModal } from '../ui.js';
import { icon } from '../icons.js';
import { DEMO_ACCOUNTS, ACCOUNT_GROUPS, accountInfo, accountOf, applyAccount, isOfficerAccount } from '../accounts.js';
import { levelName, levelInfo } from '../govroles.js';
import { seedDemo, isSeeded, phoneStatus, officerKeyId, DEMO_CHC } from '../demoseed.js';

let app, busy = false;
const LANG_NAME = { en: 'English', hi: 'हिन्दी', pa: 'ਪੰਜਾਬੀ' };

export function init(a) {
  app = a;
  $('#acctBtn').addEventListener('click', profileSheet);
  $('#welAccounts').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-account]'); if (b) chooseAccount(b.dataset.account);
  });
}

/** The role line: the level name for officers ("ADO / AEO (block)"), the role for the field accounts. */
export const roleLine = (a, lang = getLang()) => (a.level ? levelName(a.level, lang) : t(a.roleKey));
const placeLine = (a) => `${a.place.district} · ${a.place.block || t('acc.all_blocks')}`;
/** The avatar: the role icon on a pale green tint in a hairline circle (an illustration, not a face). */
export const avatar = (a, cls = '') => `<span class="acct-avatar${cls ? ' ' + cls : ''}" aria-hidden="true">${icon(a.icon)}</span>`;
const pill = () => `<span class="acct-pill">${esc(t('acc.demo'))}</span>`;

/** Picker HTML: the walkthrough entry, then the two hairline groups. */
export function pickerHTML(settings) {
  const cur = accountOf(settings)?.id;
  const row = (a) => `<button type="button" class="pp-row wel-role acct-row" data-account="${esc(a.id)}"${a.id === cur ? ' aria-current="true"' : ''}>${avatar(a)}
    <span class="pp-row__main"><span class="pp-row__title">${esc(a.name)}</span><span class="pp-row__meta">${esc(roleLine(a))}</span><span class="pp-row__meta acct-row__place">${esc(placeLine(a))}</span></span>${pill()}</button>`;
  return `<div class="pp-card pp-card--flush"><button type="button" class="pp-row wel-role acct-walk" data-walk="1">${icon('play')}<span class="pp-row__main"><span class="pp-row__title">${esc(t('acc.walk'))}</span><span class="pp-row__meta">${esc(t('acc.walk_sub'))}</span></span>${icon('chevron-right')}</button></div>`
    + ACCOUNT_GROUPS.map((g) => `<h2 class="pp-section__title wel-group" id="welGroup-${g}">${esc(t('acc.g_' + g))}</h2>
    <div class="pp-card pp-card--flush" role="group" aria-labelledby="welGroup-${g}">${DEMO_ACCOUNTS.filter((a) => a.group === g).map(row).join('')}</div>`).join('');
}

/** Load the sample data once (progress sheet), never in judge mode. Errors are shown, the account still opens. */
async function seedWithProgress() {
  const body = openModal(`<h3>${esc(t('acc.loading'))}</h3><p class="hint">${esc(t('acc.loading_hint'))}</p><div class="progress"><i id="seedBar"></i></div><p class="hint center" id="seedStep"></p>`);
  body.closest('.modal-card').setAttribute('aria-label', t('acc.loading'));
  try {
    await seedDemo(app.settings, { onStep: (_, i, n) => {
      const bar = body.querySelector('#seedBar'), st = body.querySelector('#seedStep');
      if (bar) bar.style.width = Math.round(((i + 1) / n) * 100) + '%';
      if (st) st.textContent = t('acc.step', { i: i + 1, n });
    } });
  } catch (e) { console.error(e); toast(e.message, 5000); }
  closeModal();
}

/**
 * Switch to a demo account: role / level / account only, sample data the first time, then its home screen.
 * @returns {Promise<boolean>} false when refused (judge mode, unknown id, already switching)
 */
export async function chooseAccount(id, { route } = {}) {
  const a = accountInfo(id);
  if (!a || busy || app.settings.tour) return false;
  busy = true;
  try {
    applyAccount(app.settings, id);
    if (!isSeeded(app.settings)) await seedWithProgress();
    await S.saveSettings(app.settings);
    app.refreshChrome();
    app.go(route || a.home);
    return true;
  } finally { busy = false; }
}

/** Back to the picker. signOut: also clears role and level; deletes no data (certificates, log and claims stay). */
export async function leaveAccount({ signOut = false } = {}) {
  closeModal();
  if (signOut) { app.settings.account = null; app.settings.role = null; app.settings.govLevel = null; await S.saveSettings(app.settings); app.refreshChrome(); }
  app.go('welcome', { step: 'role' });
}

/** The profile sheet: who this is, where, and (read-only) how identity is checked at pilot. */
export async function profileSheet() {
  const a = accountOf(app.settings);
  if (!a) return;
  const lang = getLang();
  const rows = [[t('acc.district'), esc(a.place.district)], [t('acc.block'), esc(a.place.block || t('acc.all_blocks'))], [t('acc.language'), esc(LANG_NAME[app.settings.lang] || 'English')]];
  let note = '';
  if (a.role === 'operator') {
    const ps = await phoneStatus(app.settings);
    const cls = { none: '', pending: 'pp-status--warn', active: 'pp-status--ok' }[ps.status];
    const ic = { none: 'circle-dot', pending: 'clock', active: 'circle-check' }[ps.status];
    rows.push([t('acc.chc'), esc(app.settings.chc || DEMO_CHC)],
      [t('acc.phone'), `<span class="pp-status ${cls}">${icon(ic)}${esc(t('acc.st_' + ps.status))}</span>`],
      [t('acc.key'), `<span class="mono">${esc(ps.kid)}</span>`]);
  } else if (isOfficerAccount(a)) {
    const li = levelInfo(a.level);
    rows.push([t('acc.duty'), esc(li?.duty?.[lang] || li?.duty?.en || '')], [t('acc.sign_key'), `<span class="mono">${esc(await officerKeyId(a.id))}</span>`]);
    note = `<p class="hint acct-demo-id">${icon('info', 'pp-icon pp-icon--sm')}<span>${esc(t('acc.demo_identity'))}</span></p>`;
  } else {
    const sl = app.settings.mySlip?.slip;
    if (sl) rows.push([t('acc.farmer_id'), `<span class="mono">${esc(sl.reg)}</span>`], [t('acc.khasra'), esc(sl.kh)]);
    else rows.push([t('acc.farmer_id'), esc(t('acc.no_slip'))]);
  }
  const idText = a.role === 'officer' ? t('acc.id_officer') : t('acc.id_field');
  const body = openModal(`<div class="acct-sheet">
    <div class="acct-sheet__head">${avatar(a, 'acct-avatar--lg')}<div><p class="acct-sheet__name"><span>${esc(a.name)}</span>${pill()}</p><p class="acct-sheet__role">${esc(roleLine(a, lang))}</p></div></div>
    <dl class="pp-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
      <div class="acct-identity"><dt>${icon('lock', 'pp-icon pp-icon--sm')}${esc(t('acc.identity'))}</dt><dd>${esc(idText)}</dd></div></dl>
    ${note}
    <div class="acct-actions"><button type="button" class="btn btn-ghost" id="acctSwitch">${esc(t('acc.switch'))}</button><button type="button" class="btn btn-ghost" id="acctOut">${esc(t('acc.signout'))}</button></div>
    <p class="hint acct-note">${esc(t('acc.signout_note'))}</p>
    <div class="acct-actions acct-actions--quiet"><button type="button" class="btn btn-tertiary btn-dense" id="acctSettings">${icon('settings')}<span>${esc(t('acc.settings'))}</span></button><button type="button" class="btn btn-tertiary btn-dense" data-walk="1">${icon('play')}<span>${esc(t('acc.walk'))}</span></button><button type="button" class="btn btn-tertiary btn-dense" id="acctClose">${esc(t('acc.close'))}</button></div></div>`);
  body.closest('.modal-card').setAttribute('aria-label', t('acc.profile_of', { name: a.name }));
  // close: the Close button, Escape, or a tap outside the sheet (like the satellite picture sheet)
  const backdrop = (e) => { if (e.target === $('#modal')) close(); };
  const close = () => { $('#modal').removeEventListener('click', backdrop); closeModal(); $('#acctBtn')?.focus(); };
  $('#modal').addEventListener('click', backdrop);
  body.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  body.querySelector('#acctClose').addEventListener('click', close);
  body.querySelector('[data-walk]').addEventListener('click', () => $('#modal').removeEventListener('click', backdrop));
  body.querySelector('#acctSwitch').addEventListener('click', () => { $('#modal').removeEventListener('click', backdrop); leaveAccount(); });
  body.querySelector('#acctOut').addEventListener('click', () => { $('#modal').removeEventListener('click', backdrop); leaveAccount({ signOut: true }); });
  body.querySelector('#acctSettings').addEventListener('click', () => { $('#modal').removeEventListener('click', backdrop); closeModal(); app.go('settings'); });
  body.querySelector('#acctSwitch').focus();
}

