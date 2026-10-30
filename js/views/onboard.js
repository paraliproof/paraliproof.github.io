// views/onboard.js — FIRST RUN (#welcome): choose the language, then "Choose a demo account".
// acc-1 (30 Oct): the second step is the DEMO account picker (views/account.js: walkthrough, "In the field",
// "Government"); the three plain roles stay below it as "Your own phone, no sample data" for a real phone
// (field tests), with the officer's level step exactly as before. The judge-tour card stays on this screen.
// DOM contract (#v-welcome): #welTitle, #welCtx, #welLang [data-lang], #welAccounts, #welOwnTitle, #welRole [data-role], #welBackLang, #welTour
import * as S from '../services.js';
import { $, $$, t } from '../ui.js';
import { HOME, homeFor, LEVEL_ICON } from '../roles.js';
import { roleTable } from '../govroles.js';
import { getLang, esc } from '../ui.js';
import { illusHTML } from '../illus.js';
import { pickerHTML } from './account.js';

let app, step = 'lang';

export function init(a) {
  app = a;
  $$('#welLang [data-lang]').forEach((b) => b.addEventListener('click', async () => {
    app.settings.lang = b.dataset.lang; app.refreshChrome(); await S.saveSettings(app.settings);
    step = 'role'; render(); $('#welAccounts .wel-role')?.focus();
  }));
  // the top bar is hidden during first run, so the role step offers its own way back to the language
  $('#welBackLang').addEventListener('click', () => { step = step === 'level' ? 'role' : 'lang'; render(); (step === 'role' ? $('#welAccounts .wel-role') : $('#welLang [aria-pressed="true"]'))?.focus(); });
  $$('#welRole [data-role]').forEach((b) => b.addEventListener('click', async () => {
    app.settings.role = b.dataset.role; await S.saveSettings(app.settings); app.refreshChrome();
    if (b.dataset.role === 'officer') { step = 'level'; render(); $('#welLevel .wel-role')?.focus(); return; } // which government level?
    app.go(b.dataset.role === 'operator' ? 'opsetup' : b.dataset.role === 'farmer' ? 'slip' : HOME[b.dataset.role]);
  }));
  $('#welLevel').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-level]'); if (!b) return;
    app.settings.govLevel = b.dataset.level; await S.saveSettings(app.settings); app.refreshChrome();
    app.go(homeFor(app.settings));
  });
}

// the picker straight away once a language was chosen before (a role, or sample data on this phone: after "Sign out")
export function show(params) { step = params?.step === 'role' || app.settings.role || app.settings.demoSeedAt ? 'role' : 'lang'; render(); }

function render() {
  // slot 1 (welcome): on the language and role steps; set once, so moving between steps does not re-fade it
  const wi = $('#welIllus');
  if (step === 'level') { wi.hidden = true; } else if (!wi.querySelector('img')) illusHTML(wi, 'welcome-trio'); else wi.hidden = false;
  wi.classList.toggle('is-compact', step === 'role'); // a smaller picture above the nine accounts
  $('#welTitle').textContent = step === 'lang' ? 'Choose your language · भाषा चुनें · ਭਾਸ਼ਾ ਚੁਣੋ' : step === 'level' ? t('lvl.ask') : t('acc.title');
  $('#welCtx').textContent = step === 'lang' ? '' : step === 'level' ? t('lvl.ask_ctx') : t('acc.ctx');
  $('#welLang').hidden = step !== 'lang';
  $('#welAccounts').hidden = step !== 'role';
  if (step === 'role') $('#welAccounts').innerHTML = pickerHTML(app.settings);
  $('#welOwnTitle').hidden = step !== 'role';
  $('#welRole').hidden = step !== 'role';
  $('#welLevel').hidden = step !== 'level';
  $('#welBackLang').hidden = step === 'lang';
  $('#welBackLang').textContent = step === 'level' ? t('lvl.back') : 'Language · भाषा · ਭਾਸ਼ਾ';
  if (step === 'level') {
    const lang = getLang();
    $('#welLevel').innerHTML = roleTable().levels.map((l) => `<button type="button" class="pp-row wel-role" data-level="${esc(l.id)}"><svg class="pp-icon"><use href="#i-${LEVEL_ICON[l.id] || 'shield'}"/></svg><span class="pp-row__main"><span class="pp-row__title">${esc(l.name[lang] || l.name.en)}</span><span class="pp-row__meta">${esc(l.duty?.[lang] || l.duty?.en || '')}</span></span><svg class="pp-icon"><use href="#i-chevron-right"/></svg></button>`).join('');
  }
  $$('#welLang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === app.settings.lang)));
}
