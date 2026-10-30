// views/settings.js — language, demo mode, presets, speed limits, device key,
// trusted keys, classifier/plug-in status, backup/import/wipe, about.
//
// DOM contract (#v-settings): #langSel, #clfSel, #mlExportAll, #demoToggle, #nightToggle, #presetList, #idleKmh, #maxWorkKmh,
//   #keyInfo, #pubKeyTxt, #copyPub, #trustedList, #trustInp, #trustAdd, #clfInfo, #resetCalib,
//   #exportAll, #importFile, #wipeAll, #storageInfo, #aboutTxt

import * as S from '../services.js';
import { keyId } from '../crypto.js';
import { getPluginClassifier } from '../classifier.js';
import { hasHook } from '../plugins.js';
import { $, t, L, esc, toast, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { downloadText, readFileText, unb64u, fmtDate } from '../util.js';
import { showRegistration } from './opsetup.js';
import { roleOf } from '../roles.js';
import { roleTable, levelOf, levelInfo } from '../govroles.js';
import { getLang } from '../ui.js';
import { activate, activeProfile, shippedProfiles } from '../profile.js';
import { kv } from '../store.js';

let app;

export function init(a) {
  app = a;
  // UX-4 (re-render bug, UX review 15a): apply the change to the chrome and the language FIRST, then save.
  // Saving awaits IndexedDB; a screen opened during that wait used to render in the old language under a new header.
  const save = async () => { app.refreshChrome(); await S.saveSettings(app.settings); };
  $('#roleSel').addEventListener('change', async () => { app.settings.role = $('#roleSel').value; await save(); show(); });
  $('#setRegister').addEventListener('click', () => showRegistration(app));
  $('#stateSel').addEventListener('change', async () => {
    try { await activate(app.settings, $('#stateSel').value || null, { kv, switched: true }); await save(); toast(t('prof.switched', { n: activeProfile() ? (activeProfile().name[getLang()] || activeProfile().name.en) : t('prof.none') })); }
    catch (e) { toast(e.message, 6000); app.settings.stateProfile = null; await activate(app.settings, null); await save(); }
    show();
  });
  $('#levelSel').addEventListener('change', async () => { app.settings.govLevel = $('#levelSel').value || null; await save(); show(); });
  $('#langSel').addEventListener('change', async () => { app.settings.lang = $('#langSel').value; await save(); show(); });
  $('#clfSel').addEventListener('change', async () => { app.settings.classifier = $('#clfSel').value; await save(); show(); });
  $('#mlExportAll').addEventListener('click', async () => downloadText(`paraliproof-recordings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await S.mlExport(app.settings))));
  $('#demoToggle').addEventListener('change', async () => { app.settings.demo = $('#demoToggle').checked; await save(); });
  $('#nightToggle').addEventListener('change', async () => { app.settings.night = $('#nightToggle').checked; await save(); });
  $('#vibToggle').addEventListener('change', async () => { app.settings.vibrate = $('#vibToggle').checked; await save(); });
  $('#idleKmh').addEventListener('change', async () => { app.settings.idleKmh = Number($('#idleKmh').value) || 0.8; await save(); });
  $('#maxWorkKmh').addEventListener('change', async () => { app.settings.maxWorkKmh = Number($('#maxWorkKmh').value) || 8; await save(); });
  $('#copyPub').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#pubKeyTxt').value); toast(t('copied')); } catch { $('#pubKeyTxt').select(); } });
  $('#trustAdd').addEventListener('click', addTrusted);
  $('#resetCalib').addEventListener('click', async () => { await S.setCalibration(false, null); await S.setCalibration(true, null); toast(t('calibReset')); show(); });
  $('#exportAll').addEventListener('click', async () => downloadText(`paraliproof-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await S.backupAll())));
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = await S.importBackup(JSON.parse(await readFileText(f))); toast(t('imported') + ': ' + JSON.stringify(n)); } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#wipeAll').addEventListener('click', async () => {
    if (!(await confirmBox(t('wipeConfirm'), 'wipeAll'))) return;
    await S.wipeAll(); toast(t('wiped')); setTimeout(() => location.reload(), 600);
  });
}

export async function show() {
  $('#roleSel').value = roleOf(app.settings);
  $('#roleOpLinks').hidden = roleOf(app.settings) !== 'operator';
  // state profile (Phase 4): signed DEMO profiles, verified at load
  await stateInfo();
  // officer level (demo: one phone plays every role)
  const isOff = roleOf(app.settings) === 'officer', lang = getLang();
  $('#levelWrap').hidden = !isOff || !!app.settings.tour;
  $('#levelSel').innerHTML = `<option value="">${esc(t('lvl.none'))}</option>` + roleTable().levels.map((l) => `<option value="${esc(l.id)}">${esc(l.name[lang] || l.name.en)}</option>`).join('');
  $('#levelSel').value = levelOf(app.settings) || '';
  const li = levelInfo(levelOf(app.settings));
  $('#levelDuty').textContent = li ? (li.duty?.[lang] || li.duty?.en || '') : '';
  const s = app.settings;
  $('#langSel').value = s.lang; $('#clfSel').value = s.classifier; $('#demoToggle').checked = s.demo; $('#nightToggle').checked = !!s.night; $('#vibToggle').checked = s.vibrate !== false;
  $('#idleKmh').value = s.idleKmh; $('#maxWorkKmh').value = s.maxWorkKmh;
  $('#presetList').innerHTML = s.presets.map((p, i) => `<div class="row preset"><span class="grow">${esc(p[s.lang] || p.en)}</span>
    <input class="inp small" type="number" step="0.1" min="0.5" max="12" inputmode="decimal" value="${p.w}" data-i="${i}" aria-label="${esc(p.en)} width"><span class="unit">m</span></div>`).join('');
  $('#presetList').querySelectorAll('input').forEach((inp) => inp.addEventListener('change', async () => {
    s.presets = s.presets.map((p, i) => (i === Number(inp.dataset.i) ? { ...p, w: Number(inp.value) || p.w } : p));
    await S.saveSettings(s);
  }));
  const k = await S.deviceKey();
  $('#keyInfo').textContent = `${k.kid} · ${t('created')} ${fmtDate(k.createdAt)}${k.weak ? ' · (fallback, extractable)' : ' · non-extractable'}`;
  $('#pubKeyTxt').value = k.pub;
  $('#trustedList').innerHTML = (s.trustedKeys || []).map((x, i) => `<div class="row"><span class="mono grow">${esc(x.kid)}</span><button class="btn btn-tertiary btn-dense" data-rm="${i}">${L('remove')}</button></div>`).join('') || `<p class="hint">${L('noTrusted')}</p>`;
  $('#trustedList').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { s.trustedKeys.splice(Number(b.dataset.rm), 1); await S.saveSettings(s); show(); }));
  const pl = getPluginClassifier();
  const cal = await S.getCalibration(false);
  const useMl = pl && s.classifier !== 'threshold';
  $('#clfInfo').innerHTML = `${esc(t('activeClassifier'))}: <b>${esc(useMl ? `${pl.id} v${pl.version} (ML${pl.info?.synthetic_only ? ', trained on synthetic data' : ''}) + pp-threshold fallback` : 'pp-threshold v1.0.0 (rule-based)')}</b><br>
    ${esc(t('calibration'))}: ${cal ? esc(`d=${cal.separation.toFixed(2)}, ${cal.bandHz[0]}–${cal.bandHz[1]} Hz, ${fmtDate(cal.at)}`) : esc(t('notCalibrated'))}<br>
    ${esc(t('plugins'))}: ML ${pl ? '✓' : '—'} · ${esc(t('satCheck'))} ${hasHook('satellite') ? '✓' : '—'} · ${esc(t('emissionsAvoided'))} ${hasHook('impact') ? '✓' : '—'}`;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) $('#storageInfo').textContent = `${t('storageUsed')}: ${(est.usage / 1e6).toFixed(1)} MB`;
  } catch {}
  $('#aboutTxt').innerHTML = `ParaliProof v${esc(S.APP_VERSION)} — ${esc(t('aboutText'))}<br><span class="tiny">Map data © OpenStreetMap contributors · Imagery © Esri · Leaflet 1.9.4 · Turf 7.2.0 · qrcode-generator 1.4.4 · jsQR 1.4.0</span>`;
}

async function stateInfo() {
  const lang = getLang(), ap = activeProfile();
  const list = await shippedProfiles((await kv.get('profileSeen')) || {});
  $('#stateSel').innerHTML = `<option value="">${esc(t('prof.none'))}</option>` + list.filter((r) => r.ok).map((r) => `<option value="${esc(r.profile.id)}">${esc(r.profile.name[lang] || r.profile.name.en)}</option>`).join('');
  $('#stateSel').value = ap?.id || '';
  $('#stateSel').disabled = !!app.settings.tour;
  const refused = list.filter((r) => !r.ok);
  $('#stateInfo').innerHTML = ap ? `<p class="pp-status pp-status--ok">${icon('circle-check')}${esc(t('prof.sig_ok', { k: ap.rootName }))}</p>
    <dl class="pp-dl"><div><dt>${esc(t('prof.profile'))}</dt><dd class="mono">${esc(ap.id)}@${esc(ap.version)}</dd></div>
      <div><dt>${esc(t('prof.scheme'))}</dt><dd>${esc(ap.scheme[lang] || ap.scheme.en)}</dd></div>
      <div><dt>${esc(t('rate'))}</dt><dd>${ap.rate == null ? esc(t('prof.no_cash')) : '₹' + esc(ap.rate) + '/acre'}</dd></div>
      <div><dt>${esc(t('prof.roles'))}</dt><dd>${ap.roleTable.levels.map((l) => esc(l.name[lang] || l.name.en)).join('<br>')}</dd></div>
      <div><dt>${esc(t('prof.export'))}</dt><dd class="mono">${esc(ap.export.format)}</dd></div></dl>
    <ul class="prof-notes">${ap.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : `<p>${esc(t('prof.none_hint'))}</p>`;
  if (refused.length) $('#stateInfo').innerHTML += refused.map((r) => `<p class="pp-status pp-status--danger">${icon('circle-x')}${esc(r.reason)}</p>`).join('');
}

async function addTrusted() {
  const pub = $('#trustInp').value.trim();
  if (!S.isValidPublicKey(pub)) { toast(t('badKey')); return; }
  try {
    const kid = await keyId(unb64u(pub));
    if (!(await confirmBox(t('ui.trust_confirm_paste', { kid }), 'add'))) return;
    app.settings.trustedKeys = [...(app.settings.trustedKeys || []).filter((x) => x.kid !== kid), { kid, pub, addedAt: Date.now() }];
    await S.saveSettings(app.settings);
    $('#trustInp').value = '';
    toast(t('keyTrusted')); show();
  } catch { toast(t('badKey')); }
}
