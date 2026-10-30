// roles.js — who is using this phone, and which tabs they see (first run: language, then role).
//   Operator: Record · Fields · My certificates
//   Officer:  Scan · Dashboard · Registered phones
//   Farmer:   My certificate · My job slip
// Settings (top-bar gear) is always reachable and lets the user change the role. Routes outside the
// role's tabs still work (e.g. a shared #cert/… link). The guided tour switches role as it goes.

import { $, t, esc, openModal, closeModal } from './ui.js';
import { icon } from './icons.js';
import { levelOf, levelInfo, roleTable } from './govroles.js';

export const ROLES = ['operator', 'officer', 'farmer'];
// UX-3 / GV-1: one icon per government level (picker, level sheet)
export const LEVEL_ICON = { village: 'pin', block: 'list', sdao: 'shield', district: 'grid', dlec: 'layers', state: 'map' };
export const TABS = {
  operator: [['job', 'record', 'tabRecord'], ['field', 'field', 'tabField'], ['certs', 'certificate', 'nav.mycerts']],
  officer: [['verify', 'scan', 'nav.scan'], ['dash', 'grid', 'nav.dash'], ['phones', 'phone', 'nav.phones']],
  farmer: [['farmer', 'certificate', 'nav.mycert'], ['slip', 'list', 'nav.myslip']],
};
export const HOME = { operator: 'job', officer: 'verify', farmer: 'farmer' };
export const roleOf = (settings) => (ROLES.includes(settings?.role) ? settings.role : 'operator');

// Government levels (js/govroles.js): an officer with a level sees that level's tabs. Without a level
// (older installs, and judge mode, which must stay unchanged) the officer keeps Scan · Dashboard · Phones.
export const ROUTE_TAB = {
  verify: ['scan', 'nav.scan'], dash: ['grid', 'nav.dash'], phones: ['phone', 'nav.phones'], queue: ['list', 'nav.queue'], audit: ['search', 'nav.audit'],
  visits: ['pin', 'nav.visits'], log: ['hash', 'nav.log'], approvals: ['shield', 'nav.approvals'], district: ['grid', 'nav.district'], batch: ['layers', 'nav.batch'],
  dlec: ['certificate', 'nav.dlec'], state: ['map', 'nav.state'],
};
export function tabsFor(settings) {
  const role = roleOf(settings);
  const lv = role === 'officer' && !settings?.tour ? levelOf(settings) : null;
  if (!lv) return TABS[role];
  return levelInfo(lv).tabs.filter((r) => ROUTE_TAB[r]).map((r) => [r, ...ROUTE_TAB[r]]);
}
export const homeFor = (settings) => tabsFor(settings)[0]?.[0] || HOME[roleOf(settings)];

export function renderTabs(settings) {
  const role = roleOf(settings), tabs = tabsFor(settings);
  const nav = $('#tabbar');
  nav.style.setProperty('--tabs', String(tabs.length));
  nav.dataset.role = role;
  nav.innerHTML = tabs.map(([route, ic, key]) => `<a class="pp-tab" href="#${route}" data-tab="${route}"><svg class="pp-icon"><use href="#i-${ic}"/></svg><span>${esc(t(key))}</span></a>`).join('');
}

/** UX-3: a level chip in the top bar (officer with a level, demo mode, not in the tour) opens this sheet;
 *  one tap on a level switches to it and opens that level's home screen. */
export const showLevelChip = (settings) => roleOf(settings) === 'officer' && !!levelOf(settings) && !!settings.demo && !settings.tour;
export function levelSheet(settings, lang, onPick) {
  const cur = levelOf(settings);
  const body = openModal(`<h3>${esc(t('lvl.switch'))}</h3><p class="hint">${esc(t('lvl.switch_ctx'))}</p>
    <div class="pp-card pp-card--flush level-sheet">${roleTable().levels.map((l) => `<button type="button" class="pp-row wel-role" data-level="${esc(l.id)}"${l.id === cur ? ' aria-current="true"' : ''}>${icon(LEVEL_ICON[l.id] || 'shield')}<span class="pp-row__main"><span class="pp-row__title">${esc(l.name[lang] || l.name.en)}</span><span class="pp-row__meta">${esc(l.duty?.[lang] || l.duty?.en || '')}</span></span>${l.id === cur ? icon('check') : icon('chevron-right')}</button>`).join('')}</div>
    <button type="button" class="btn btn-ghost" id="lvlClose">${esc(t('cancel'))}</button>`);
  body.closest('.modal-card').setAttribute('aria-label', t('lvl.switch'));
  body.querySelector('#lvlClose').addEventListener('click', closeModal);
  body.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { closeModal(); onPick(b.dataset.level); }));
  (body.querySelector('[aria-current="true"]') || body.querySelector('[data-level]'))?.focus();
}
