// views/slip.js — FARMER: "My job slip" (#slip). Makes the PPJ1 QR the operator scans before the job:
// MFMB registration no., khasra / field id, registered acres, field centre (GPS) or the demo parcel.
// Honesty: in a rollout this slip comes from MFMB; here it is a DEMO slip made by the farmer. It stays
// on this phone; certificates keep only its hash and the registered acres.
// DOM contract (#v-slip): #slipReg, #slipKh, #slipRa, #slipWhere, #slipGps, #slipDemo, #slipMake, #slipOut
import * as S from '../services.js';
import { $, t, esc, toast } from '../ui.js';
import { makeSlip, slipHash } from '../qrformats.js';
import { qrSVG } from '../mapsnap.js';
import { round, M2_PER_ACRE } from '../util.js';

let app, where = null; // {c} or {b}
export function init(a) {
  app = a;
  $('#slipGps').addEventListener('click', () => {
    if (!navigator.geolocation) { toast(t('noGps')); return; }
    toast(t('locating'));
    navigator.geolocation.getCurrentPosition((p) => { where = { c: [round(p.coords.latitude, 5), round(p.coords.longitude, 5)] }; whereInfo(); },
      (e) => toast('GPS: ' + e.message), { enableHighAccuracy: true, timeout: 20000 });
  });
  $('#slipDemo').addEventListener('click', async () => {
    const f = await S.ensureDemoField();
    where = { b: f.boundary, demo: true };
    if (!$('#slipReg').value) $('#slipReg').value = 'DEMO-PB-2026-0457';
    if (!$('#slipKh').value) $('#slipKh').value = '45/12';
    if (!$('#slipRa').value) $('#slipRa').value = round(f.areaM2 / M2_PER_ACRE + 0.05, 1);
    whereInfo();
  });
  $('#slipMake').addEventListener('click', make);
}

function whereInfo() {
  $('#slipWhere').textContent = where?.b ? t('slip.where_b', { n: where.b.length }) : where?.c ? t('slip.where_c', { lat: where.c[0], lon: where.c[1] }) : t('slip.where_none');
}

export function show() {
  const s = app.settings.mySlip;
  if (s && !where) { where = s.slip.b ? { b: s.slip.b } : { c: s.slip.c }; $('#slipReg').value = s.slip.reg; $('#slipKh').value = s.slip.kh; $('#slipRa').value = s.slip.ra; }
  whereInfo();
  if (s) render(s);
}

async function make() {
  let r;
  try {
    if (!where) throw new Error(t('slip.where_none'));
    r = makeSlip({ reg: $('#slipReg').value, kh: $('#slipKh').value, ra: Number($('#slipRa').value), ...(where.b ? { b: where.b } : { c: where.c }) });
  } catch (e) { toast(e.message, 4000); return; }
  app.settings.mySlip = { ...r, jh: await slipHash(r.slip), at: Date.now() };
  await S.saveSettings(app.settings);
  render(app.settings.mySlip);
}

function render(s) {
  $('#slipOut').innerHTML = `<section class="pp-section slip-card">
    <h2 class="pp-section__title">${esc(t('slip.show_operator'))}</h2>
    <div class="reg-qr">${qrSVG(s.qr, { ecc: 'M' })}</div>
    <dl class="pp-dl"><div><dt>${esc(t('slip.reg'))}</dt><dd class="mono">${esc(s.slip.reg)}</dd></div><div><dt>${esc(t('slip.kh'))}</dt><dd>${esc(s.slip.kh)}</dd></div>
      <div><dt>${esc(t('slip.ra'))}</dt><dd class="pp-num">${esc(Number(s.slip.ra).toFixed(2))} ac</dd></div></dl>
    <p class="hint">${esc(t('slip.privacy'))}</p></section>`;
}
