// app.js — app shell: boot, settings, hash router, language, service worker.
//
// Routes:  #job (Record, default) · #field · #certs · #cert/<id> · #verify · #dash · #settings
// ?tour=1 starts judge mode (js/tour.js) on boot.
// Each view module exports init(app) once and show(params) on every visit.

import * as S from './services.js';
import { setThresholdParams } from './classifier.js';
import { exposeGlobalApi } from './plugins.js';
import { requestPersistence } from './store.js';
import { $, $$, t, esc, setLang, applyI18n, toast, setHaptics, openModal, closeModal } from './ui.js';
import { illusHTML } from './illus.js';
import { injectSprite } from './icons.js';
import * as record from './views/record.js';
import * as fields from './views/fields.js';
import * as certs from './views/certs.js';
import * as verify from './views/verify.js';
import * as dash from './views/dash.js';
import * as settingsView from './views/settings.js';
import * as tour from './tour.js';
import * as onboard from './views/onboard.js';
import * as opsetup from './views/opsetup.js';
import * as phones from './views/phones.js';
import * as farmer from './views/farmer.js';
import * as slip from './views/slip.js';
import { renderTabs, homeFor, showLevelChip, levelSheet } from './roles.js';
import { levelOf } from './govroles.js';
import * as govViews from './views/gov.js';
import * as distViews from './views/district.js';
import { activate as activateProfile } from './profile.js';
import { kv } from './store.js';
import { cleanupStaleTour } from './tour-data.js';
import * as account from './views/account.js';
import * as walk from './walkthrough.js';
import { accountOf, isOfficerAccount } from './accounts.js';
import { useOfficerKey } from './gov.js';

const app = {
  settings: null,
  current: null,
  go(route, params) { app.pendingParams = params || null; if (location.hash === '#' + route) route_(); else location.hash = route; },
  refreshChrome() {
    setLang(app.settings.lang, app.settings.second);
    setHaptics(app.settings.vibrate !== false);
    document.documentElement.dataset.theme = app.settings.night ? 'dark' : 'light';
    applyI18n();
    $('#langBtn').textContent = { en: 'EN', hi: 'हिं', pa: 'ਪੰ' }[app.settings.lang];
    // acc-1: a chosen DEMO account shows its avatar in the level chip's slot (never in judge mode: accountOf → null),
    // and an officer account signs the officer log with its own key (js/gov.js)
    const acct = accountOf(app.settings);
    useOfficerKey(isOfficerAccount(acct) ? acct.id : null);
    if (app.settings.tour && walk.isWalking()) walk.exit();
    const av = $('#acctBtn'); av.hidden = !acct;
    if (acct) { av.innerHTML = account.avatar(acct); av.setAttribute('aria-label', t('acc.profile_of', { name: acct.name })); }
    const badge = $('#demoBadge'); badge.dataset.i18n = acct ? 'ui.demo_short' : 'ui.demo'; badge.textContent = t(badge.dataset.i18n); // "Demo" fits beside the avatar at 360 px
    const chip = $('#levelChip'); chip.hidden = !showLevelChip(app.settings) || !!acct;
    // with the level chip, "Demo data" moves into the chip ("Demo · Block"), so the top bar fits at 360 px
    $('#demoBadge').hidden = !app.settings.demo || !chip.hidden;
    if (!chip.hidden) { chip.textContent = t('ui.demo_short') + ' · ' + t('lvl.short.' + levelOf(app.settings)); chip.setAttribute('aria-label', t('lvl.switch') + ' (' + t('ui.demo') + '): ' + t('lvl.short.' + levelOf(app.settings))); }
    renderTabs(app.settings);
    markTab();
  },
};

const VIEWS = {
  job: { el: 'v-job', tab: 'job', show: () => record.show() },
  field: { el: 'v-field', tab: 'field', show: () => fields.show() },
  certs: { el: 'v-certs', tab: 'certs', show: () => certs.showList() },
  cert: { el: 'v-cert', tab: 'certs', show: (id, p) => certs.showCert(id, p) },
  verify: { el: 'v-verify', tab: 'verify', show: (_, p) => verify.show(p) },
  dash: { el: 'v-dash', tab: 'dash', show: () => dash.show() },
  settings: { el: 'v-settings', tab: null, show: () => settingsView.show() },
  welcome: { el: 'v-welcome', tab: null, show: (_, p) => onboard.show(p) },
  opsetup: { el: 'v-opsetup', tab: null, show: () => opsetup.show() },
  phones: { el: 'v-phones', tab: 'phones', show: () => phones.show() },
  farmer: { el: 'v-farmer', tab: 'farmer', show: (_, p) => farmer.show(p) },
  slip: { el: 'v-slip', tab: 'slip', show: () => slip.show() },
  // government levels (js/views/gov.js)
  queue: { el: 'v-queue', tab: 'queue', show: () => govViews.showQueue() },
  case: { el: 'v-case', tab: 'queue', show: (id) => govViews.showCase(id) },
  audit: { el: 'v-audit', tab: 'audit', show: () => govViews.showAudit() },
  visits: { el: 'v-visits', tab: 'visits', show: () => govViews.showVisits() },
  visit: { el: 'v-visit', tab: 'visits', show: (id) => govViews.showVisit(id) },
  approvals: { el: 'v-approvals', tab: 'approvals', show: () => govViews.showApprovals() },
  log: { el: 'v-log', tab: 'log', show: () => govViews.showLog() },
  district: { el: 'v-district', tab: 'district', show: () => distViews.showDistrict() },
  state: { el: 'v-state', tab: 'state', show: () => distViews.showState() },
  batch: { el: 'v-batch', tab: 'batch', show: () => distViews.showBatch() },
  dlec: { el: 'v-dlec', tab: 'dlec', show: () => distViews.showDlec() },
};
function markTab() {
  const v = VIEWS[app.current] || VIEWS.job;
  $$('.tabbar a').forEach((a) => { if (a.dataset.tab === v.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
app.home = () => homeFor(app.settings);

async function route_() {
  // first run (no role chosen yet, no deep link): language, then "Who are you?"
  let [name, arg] = (location.hash.slice(1) || (app.settings.role ? app.home() : 'welcome')).split('/');
  // settings and the role-only screens need a role; shared links (#verify, #cert/…, ?tour=1) still work
  if (!app.settings.role && ['settings', 'job', 'field', 'dash', 'phones', 'opsetup', 'queue', 'case', 'audit', 'visits', 'visit', 'approvals', 'log', 'batch', 'dlec', 'district', 'state'].includes(name)) name = 'welcome';
  const v = VIEWS[name] || VIEWS.job;
  if (app.current === 'verify' && name !== 'verify') verify.hide();
  app.current = name;
  $$('.view').forEach((s) => { s.hidden = s.id !== v.el; });
  document.body.classList.toggle('is-welcome', name === 'welcome');
  document.body.classList.toggle('is-setup', name === 'opsetup'); // UX-4: no tab bar during operator setup
  markTab();
  window.scrollTo(0, 0);
  const params = app.pendingParams; app.pendingParams = null;
  try { await v.show(arg && decodeURIComponent(arg), params); } catch (e) { console.error(e); toast(e.message); }
}

/** UX-4: a quiet "Offline · everything still works" line while there is no signal; a tap explains. */
function offlineNote() {
  const n = $('#offlineNote');
  const upd = () => { n.hidden = navigator.onLine !== false; };
  addEventListener('online', upd); addEventListener('offline', upd); upd();
  n.addEventListener('click', () => {
    const body = openModal(`<div class="illus-slot illus-slot--empty" data-illus="offline"></div><h3>${esc(t('off.title'))}</h3><p>${esc(t('off.body'))}</p><button type="button" class="btn btn-primary" id="offOk">${esc(t('off.ok'))}</button>`);
    illusHTML(body.querySelector('[data-illus]'), 'offline');
    body.querySelector('#offOk').addEventListener('click', closeModal); body.querySelector('#offOk').focus();
  });
}

async function boot() {
  injectSprite();
  if (!globalThis.L || !globalThis.turf) {
    // first visit without internet: the libraries never reached this phone (once they have, the service worker serves them)
    const b = $('#banner'); b.hidden = false; b.classList.add('first-offline');
    b.innerHTML = '<div class="illus-slot" data-illus="offline"></div><p></p>';
    try { setLang((await S.loadSettings()).lang); } catch { /* English */ }
    b.querySelector('p').textContent = t('off.first');
    illusHTML(b.querySelector('[data-illus]'), 'offline');
    return;
  }
  await cleanupStaleTour(); // a tour database left behind by a closed tab
  app.settings = await S.loadSettings();
  // Phase 4: the signed DEMO state profile chosen in Settings (none = the built-in Haryana defaults, as before)
  if (app.settings.stateProfile && !app.settings.tour) {
    try { await activateProfile(app.settings, app.settings.stateProfile, { kv }); }
    catch (e) { console.warn('state profile', e); app.settings.stateProfile = null; await S.saveSettings(app.settings); setTimeout(() => toast(e.message, 6000), 800); }
  }
  const cal = await S.getCalibration(app.settings.demo);
  if (cal) setThresholdParams(cal);
  app.refreshChrome();
  offlineNote();
  $('#langBtn').addEventListener('click', async () => {
    const order = ['en', 'hi', 'pa'];
    app.settings.lang = order[(order.indexOf(app.settings.lang) + 1) % 3];
    app.refreshChrome(); route_(); await S.saveSettings(app.settings); // language first, then the (slow) save
  });
  $('#demoBadge').addEventListener('click', () => app.go('settings'));
  $('#levelChip').addEventListener('click', () => levelSheet(app.settings, app.settings.lang, async (lv) => {
    app.settings.govLevel = lv; await S.saveSettings(app.settings); app.refreshChrome(); app.go(app.home());
  }));
  for (const m of [record, fields, certs, verify, dash, settingsView, tour, onboard, opsetup, phones, farmer, slip, govViews, distViews, account, walk]) m.init(app);
  exposeGlobalApi({ app, services: S, version: S.APP_VERSION });
  window.addEventListener('hashchange', route_);
  if (tour.tourRequested()) await tour.start({ focus: false }); // judge mode: everything below then uses the tour database
  else await route_();
  S.deviceKey().catch((e) => console.warn('device key', e)); // create the key early
  requestPersistence();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').then(watchUpdate).catch((e) => console.warn('SW', e));
  }
  window.addEventListener('beforeunload', (e) => { if (record.isRecording()) { e.preventDefault(); e.returnValue = t('recordingLeave'); } });
}

// A new version waits until every page of the old one is closed (sw.js: no skipWaiting / claim). Say so
// quietly; never reload by force, and never interrupt a recording (the note waits until it ends).
function watchUpdate(reg) {
  if (!navigator.serviceWorker.controller) return; // first install: nothing to replace
  const note = () => {
    if (record.isRecording()) { setTimeout(note, 30000); return; }
    const b = $('#updateNote'); if (b) b.hidden = false;
  };
  if (reg.waiting) note();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') note(); });
  });
}

boot();
