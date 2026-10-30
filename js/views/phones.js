// views/phones.js — OFFICER: registered phones (#phones). Scan an operator's "Register this phone"
// QR (PPR1, signed by that phone's own key) to enrol it in settings.trustedKeys; list and remove.
// The old path (trust a key from a scanned certificate, Scan tab) stays as a fallback.
// DOM contract (#v-phones): #phonesScan, #phonesList
import * as S from '../services.js';
import { $, t, esc, toast, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { verifyRegistration } from '../qrformats.js';
import { scanQr } from '../scan.js';
import { fmtDate } from '../util.js';
import { levelOf } from '../govroles.js';
import { enrolPhone } from '../gov.js';

let app;
export function init(a) {
  app = a;
  $('#phonesScan').addEventListener('click', async () => {
    const text = await scanQr({ title: t('phones.scan'), hint: t('phones.scan_hint'), placeholder: 'PPR1|{…}|…|…' });
    if (!text) return;
    const r = await enrolFromText(text);
    if (r) show();
  });
}

/** Verify a PPR1 text and, after the officer confirms, enrol the phone. Returns the key entry or null. */
export async function enrolFromText(text, { confirm = true } = {}) {
  const reg = await verifyRegistration(text);
  if (!reg.ok) { toast(t('phones.bad') + ': ' + reg.reason, 5000); return null; }
  if (confirm && !(await confirmBox(t('phones.confirm', { kid: reg.kid, chc: reg.chc }), 'phones.enrol'))) return null;
  // with an officer level: two-person enrolment (ADO signs → "pending" → SDAO countersigns → "active").
  // Without a level (older installs, judge mode) the single-officer enrolment stays as before.
  const lv = levelOf(app.settings);
  let k;
  try { k = lv && !app.settings.tour ? await enrolPhone(lv, app.settings, reg, S.saveSettings) : await S.registerPhone(app.settings, reg); } catch (e) { toast(e.message, 5000); return null; }
  toast(k.status === 'pending' ? t('phones.pending_done', { chc: reg.chc }) : t('phones.done', { chc: reg.chc }));
  return k;
}

export function show() {
  const keys = (app.settings.trustedKeys || []);
  const el = $('#phonesList');
  if (!keys.length) { el.innerHTML = `<div class="empty">${icon('phone')}<p>${esc(t('phones.empty'))}</p></div>`; return; }
  el.innerHTML = `<div class="pp-card pp-card--flush">${keys.map((k, i) => `<div class="pp-row">${icon('phone')}<span class="pp-row__main"><span class="pp-row__title">${esc(k.chc || (k.demo ? t('phones.demo') : t('phones.unnamed')))}</span>
      <span class="pp-row__meta">${k.status === 'pending' ? `<span class="pp-status pp-status--warn">${icon('clock')}${esc(t('phones.pending'))}</span> · ` : k.status === 'active' ? `<span class="pp-status pp-status--ok">${icon('circle-check')}${esc(t('phones.active'))}</span> · ` : ''}<span class="mono">${esc(k.kid)}</span> · ${esc(t(k.via === 'registration' ? 'phones.via_reg' : 'phones.via_cert'))}${k.addedAt ? ' · ' + esc(fmtDate(k.addedAt)) : ''}</span></span>
      <button type="button" class="btn btn-tertiary btn-dense btn-danger" data-i="${i}">${esc(t('phones.remove'))}</button></div>`).join('')}</div>`;
  el.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', async () => {
    const k = keys[Number(b.dataset.i)];
    if (!k || !(await confirmBox(t('phones.remove_confirm', { kid: k.kid })))) return;
    await S.unregisterPhone(app.settings, k.pub); show();
  }));
}
