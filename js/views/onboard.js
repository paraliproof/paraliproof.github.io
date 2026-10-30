// views/onboard.js — FIRST RUN (#welcome): choose the language, then "Who are you?".
// DOM contract (#v-welcome): #welTitle, #welCtx, #welLang [data-lang], #welRole [data-role], #welBackLang, #welTour
import * as S from '../services.js';
import { $, $$, t } from '../ui.js';
import { HOME, homeFor, LEVEL_ICON } from '../roles.js';
import { roleTable } from '../govroles.js';
import { getLang, esc } from '../ui.js';
import { illusHTML } from '../illus.js';

let app, step = 'lang';

export function init(a) {
  app = a;
  $$('#welLang [data-lang]').forEach((b) => b.addEventListener('click', async () => {
    app.settings.lang = b.dataset.lang; app.refreshChrome(); await S.saveSettings(app.settings);
    step = 'role'; render(); $('#welRole .wel-role')?.focus();
  }));
  // the top bar is hidden during first run, so the role step offers its own way back to the language
  $('#welBackLang').addEventListener('click', () => { step = step === 'level' ? 'role' : 'lang'; render(); (step === 'role' ? $('#welRole .wel-role') : $('#welLang [aria-pressed="true"]'))?.focus(); });
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

export function show() { step = app.settings.role ? 'role' : 'lang'; render(); }

function render() {
  // slot 1 (welcome): on the language and role steps; set once, so moving between steps does not re-fade it
  const wi = $('#welIllus');
  if (step === 'level') { wi.hidden = true; } else if (!wi.querySelector('img')) illusHTML(wi, 'welcome-trio'); else wi.hidden = false;
  $('#welTitle').textContent = step === 'lang' ? 'Choose your language · भाषा चुनें · ਭਾਸ਼ਾ ਚੁਣੋ' : step === 'level' ? t('lvl.ask') : t('role.ask');
  $('#welCtx').textContent = step === 'lang' ? '' : step === 'level' ? t('lvl.ask_ctx') : t('role.ask_ctx');
  $('#welLang').hidden = step !== 'lang';
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
