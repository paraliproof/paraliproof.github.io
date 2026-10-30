// views/opsetup.js — OPERATOR SETUP (#opsetup), once: CHC / owner name (this phone only, never in
// a certificate QR), the machine (signed sticker, or typed by hand → WIDTH_SELF_DECLARED), and the
// "Register this phone" QR for the officer.
// DOM contract (#v-opsetup): #chcName, #opMachine, #opScanSticker, #opManual, #opManualBox, #opImpl, #opWidth, #opManualSave, #opRegister, #opDone
import * as S from '../services.js';
import { $, t, esc, toast, getLang, openModal, closeModal, L } from '../ui.js';
import { verifySticker, makeRegistration } from '../qrformats.js';
import { qrSVG } from '../mapsnap.js';
import { scanQr } from '../scan.js';
import { illusHTML } from '../illus.js';

let app;
export function init(a) {
  app = a;
  $('#chcName').addEventListener('change', async () => { app.settings.chc = $('#chcName').value.replace(/[|<>"'`&\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40); await S.saveSettings(app.settings); });
  $('#opScanSticker').addEventListener('click', async () => {
    const text = await scanQr({ title: t('scan2.scan_sticker'), hint: t('scan2.sticker_hint'), placeholder: 'PPM1|{…}|…' });
    if (!text) return;
    const v = await verifySticker(text);
    if (v.status !== 'VALID') { toast(t('scan2.sticker_' + v.status.toLowerCase()), 5000); return; }
    await S.setMachineFromSticker(app.settings, v); toast(t('scan2.sticker_ok', { mid: v.sticker.mid })); show();
  });
  $('#opManual').addEventListener('click', () => { $('#opManualBox').hidden = false; $('#opImpl').focus(); });
  $('#opImpl').addEventListener('change', () => { const p = app.settings.presets.find((x) => x.code === $('#opImpl').value); if (p) $('#opWidth').value = p.w; });
  $('#opManualSave').addEventListener('click', async () => {
    const w = Number($('#opWidth').value);
    if (!(w >= 0.5 && w <= 12)) { toast(t('op.bad_width')); return; }
    await S.setMachineManual(app.settings, $('#opImpl').value, w); $('#opManualBox').hidden = true; show();
  });
  $('#opRegister').addEventListener('click', () => showRegistration(app));
  $('#opDone').addEventListener('click', () => app.go('job'));
}

export function show() {
  if (!$('#opIllus img')) illusHTML($('#opIllus'), 'setup-tractor', 'illus--slide'); // slot 2: slides in once
  $('#chcName').value = app.settings.chc || '';
  const lang = getLang();
  $('#opImpl').innerHTML = app.settings.presets.map((p) => `<option value="${esc(p.code)}">${esc(p[lang] || p.en)} (${p.w} m)</option>`).join('');
  $('#opImpl').value = app.settings.implement; $('#opWidth').value = app.settings.widthM;
  const m = S.activeMachine(app.settings);
  const impl = (c) => { const p = app.settings.presets.find((x) => x.code === c); return p ? (p[lang] || p.en) : c; };
  $('#opMachine').textContent = m?.source === 'sticker' ? t('scan2.machine_sticker', { mid: m.mid, impl: impl(m.type), w: m.w })
    : m ? t('scan2.machine_manual', { impl: impl(m.type), w: m.w }) : t('scan2.machine_none');
  $('#opMachine').classList.toggle('is-warn', m?.source !== 'sticker');
  $('#opScanSticker').classList.toggle('btn-primary', m?.source !== 'sticker'); // one primary action: Done, once a sticker is set
  $('#opScanSticker').classList.toggle('btn-ghost', m?.source === 'sticker');
}

/** "Register this phone": device public key + key id + CHC label, signed by this phone's key. */
export async function showRegistration(a) {
  const key = await S.deviceKey();
  const chc = a.settings.chc || t('op.chc_unnamed');
  const qr = await makeRegistration(key, chc);
  const body = openModal(`<h3>${L('reg.title')}</h3><p class="hint">${esc(t('reg.modal_hint'))}</p>
    <div class="reg-qr">${qrSVG(qr, { ecc: 'M' })}</div>
    <dl class="pp-dl"><div><dt>${esc(t('deviceKey'))}</dt><dd class="mono">${esc(key.kid)}</dd></div><div><dt>${esc(t('op.chc'))}</dt><dd>${esc(chc)}</dd></div></dl>
    <details class="paste"><summary class="pp-section__title">${L('reg.text')}</summary><textarea class="inp mono" rows="4" readonly aria-label="${esc(t('reg.text'))}">${esc(qr)}</textarea></details>
    <button type="button" class="btn btn-primary" id="regClose">${L('ok')}</button>`);
  body.querySelector('#regClose').addEventListener('click', closeModal);
  body.querySelector('#regClose').focus();
  return qr;
}
