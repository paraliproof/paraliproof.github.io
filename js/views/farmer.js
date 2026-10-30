// views/farmer.js — FARMER: "My certificate" (#farmer). Scan, upload or paste a certificate (or pick one
// on this phone) and see it in plain words: acres payable, date, payment stage, satellite result.
// Share sends a short summary + the certificate text through the Web Share API (WhatsApp works).
// Nothing scanned here is saved to the officer registry. Every value is escaped (review F-02).
// DOM contract (#v-farmer): #farmerOpen, #farmerView
import * as S from '../services.js';
import { verifyCert } from '../cert.js';
import { $, t, esc, toast, fx, fint, getLang, genuineTick } from '../ui.js';
import { icon } from '../icons.js';
import { scanQr } from '../scan.js';
import { qrKind } from '../qrformats.js';
import { fmtDate } from '../util.js';
import { illusHTML } from '../illus.js';

let app, current = null;
export function init(a) {
  app = a;
  $('#farmerOpen').addEventListener('click', async () => {
    const text = await scanQr({ title: t('farmer.open'), hint: t('farmer.open_hint'), placeholder: 'PP1|{…}|…|…' });
    if (text) open(text);
  });
}

export async function show(params) {
  // slot 5: above the head while no certificate is open; never next to a verdict
  if (!current && !params?.text) { if (!$('#farmerIllus img')) illusHTML($('#farmerIllus'), 'farmer-cert'); else $('#farmerIllus').hidden = false; }
  if (params?.text) { await open(params.text, params.ext); return; }
  if (current) { render(current); return; }
  const own = (await S.listCerts()).slice(0, 5);
  $('#farmerView').innerHTML = own.length ? `<section class="pp-section"><h2 class="pp-section__title">${esc(t('farmer.on_phone'))}</h2><div class="list">${own.map((c) => `<button type="button" class="item" data-id="${esc(c.id)}"><span class="grow"><b>${esc(c.payload.fl)}</b><small>${esc(fmtDate(c.payload.t0 * 1000))} · <span class="mono">${esc(c.payload.id)}</span></small></span><b class="big">${esc(fx(S.payableOf(c.payload).pa))} ac</b></button>`).join('')}</div></section>` : '';
  $('#farmerView').querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', async () => { const c = own.find((x) => x.id === b.dataset.id); if (c) open(c.qr, c.ext); }));
}

async function open(text, ext) {
  if (qrKind(text) !== 'cert') { toast(t('farmer.not_cert'), 4000); return; }
  const v = await verifyCert(text, ext && Object.keys(ext).length ? ext : undefined);
  current = { text, ext: v.extStatus === 'MATCH' ? ext : null, v };
  render(current);
}

/** FA-3: Submitted → Approved by committee → Paid, current step in accent (no DLEC / DBT words).
 *  This phone can only see that the certificate is genuine and submitted, so step 1 is always current. */
export function progressRow(current = 1) {
  return `<ol class="pp-steps" aria-label="${esc(t('farmer.steps_label'))}">${[1, 2, 3].map((n) => `<li class="${n < current ? 'is-done' : n === current ? 'is-current' : ''}"${n === current ? ' aria-current="step"' : ''}><span class="pp-steps__dot" aria-hidden="true"></span>${esc(t('farmer.step_' + n))}</li>`).join('')}</ol>`;
}

function render({ text, ext, v }) {
  const el = $('#farmerView');
  $('#farmerIllus').hidden = true;
  // one filled button per screen: once a certificate is open, "Open another" turns to outline (FA-3)
  $('#farmerOpen').classList.replace('btn-primary', 'btn-ghost');
  $('#farmerOpen').querySelector('span').textContent = t('farmer.open_another');
  if (v.status === 'INVALID' && !v.payload) { el.innerHTML = `<div class="pp-verdict" data-verdict="unknown"><h2 class="pp-verdict__line">${icon('question')}<span>${esc(t('INVALID'))}</span></h2><p class="pp-head__context">${esc(v.reason)}</p></div>`; return; }
  const p = v.payload, ok = v.status === 'VALID';
  const pay = S.payableOf(p);
  const st = S.farmerStage(v);
  const sat = ext?.satellite;
  const SV = { N: 'sat_NOT_BURNED', B: 'sat_BURN_SUSPECTED', I: 'sat_INCONCLUSIVE' };
  const satText = SV[p.sv] ? t(SV[p.sv]) : t('ui.sat_not_in_qr');
  const lang = getLang(), imp = app.settings.presets.find((x) => x.code === p.im);
  // the animated tick only on a clean Genuine verdict (never on Changed or "Genuine, but check")
  const tick = ok && !st.exception ? genuineTick('farmer|' + p.id + '|' + text.length) : null;
  el.innerHTML = `
    <div class="pp-verdict" data-verdict="${ok ? (st.exception ? 'warn' : 'valid') : 'tampered'}">
      <h2 class="pp-verdict__line${tick?.play ? ' is-tick-play' : ''}">${tick ? tick.html : icon(ok ? 'circle-alert' : 'circle-x')}<span>${esc(ok ? t('farmer.genuine') : t('TAMPERED'))}</span></h2>
      <p class="pp-head__context">${esc(ok ? (st.exception ? t('farmer.check_flag') : t('farmer.genuine_sub')) : t('farmer.not_accepted'))}</p>
    </div>
    ${ok ? progressRow() : ''}
    ${ok ? `<div class="pp-numeral"><span class="pp-numeral__value">${esc(fx(pay.pa))}</span><span class="pp-numeral__unit">${esc(t('farmer.acres_payable'))}</span></div>
    <p class="hint" style="margin:6px 0 0">${esc(t('farmer.pay_est', { inr: fint(pay.pa * app.settings.rate), rate: fint(app.settings.rate) }))}</p>` : ''}
    <dl class="pp-dl">
      <div><dt>${esc(t('date'))}</dt><dd>${esc(fmtDate(Number(p.t0) * 1000))}</dd></div>
      <div><dt>${esc(t('field'))}</dt><dd>${esc(p.fl)}<small>${esc(fx(p.fa))} ac</small></dd></div>
      <div><dt>${esc(t('implement'))}</dt><dd>${esc(imp ? (imp[lang] || imp.en) : p.im)}<small>${esc(p.ws === 'S' ? t('farmer.ws_S') : p.ws === 'M' ? t('farmer.ws_M') : '')}</small></dd></div>
      <div><dt>${esc(t('farmer.worked'))}</dt><dd class="pp-num ${ok ? '' : 'is-untrusted'}">${esc(fx(pay.C))} ac<small>${esc(pay.A != null ? t('farmer.registered', { a: fx(pay.A) }) : t('pay.no_A'))}</small></dd></div>
      <div><dt>${esc(t('satCheck'))}</dt><dd>${esc(satText)}</dd></div>
      <div><dt>${esc(t('certNo'))}</dt><dd class="mono">${esc(p.id)}</dd></div>
    </dl>
    <p class="hint">${esc(t('farmer.stage_note'))}</p>
    <button type="button" class="btn btn-primary btn-xxl" id="farmerShare">${icon('share')}<span>${esc(t('share'))}</span></button>`;
  $('#farmerShare').addEventListener('click', () => share(p, pay, ok, text));
}

async function share(p, pay, ok, text) {
  const summary = ok ? t('farmer.share_text', { id: p.id, a: fx(pay.pa), d: fmtDate(Number(p.t0) * 1000) }) : t('farmer.share_bad', { id: p.id });
  const body = `${summary}\n\n${text}`;
  try {
    if (navigator.share) await navigator.share({ title: 'ParaliProof ' + p.id, text: body });
    else { await navigator.clipboard.writeText(body); toast(t('copied')); }
  } catch { /* cancelled */ }
}
