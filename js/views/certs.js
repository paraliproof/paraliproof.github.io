// views/certs.js — CERTIFICATES tab (list) and the printable certificate (#cert/<id>).
//
// DOM contract: #v-certs → #certList ; #v-cert → #certDoc, #printBtn, #shareBtn, #certJsonBtn, #certVerifyBtn
// Data: services.listCerts/findCert; cert record = {id, qr, hash, payload, ext, kid, snapshot?, demo, source}
// The payload field names are documented in js/cert.js.

import * as S from '../services.js';
import { verifyCert } from '../cert.js';
import { qrSVG } from '../mapsnap.js';
import { $, t, L, esc, toast, fx, fint, svgImg, openModal, closeModal } from '../ui.js';
import { startNextField } from './record.js';
import { illusImg, illusHTML, handoverHTML, guard } from '../illus.js';
import { ICONS, icon } from '../icons.js';
import { downloadText, fmtDate } from '../util.js';

let app, current = null;

export function init(a) {
  app = a;
  $('#printBtn').addEventListener('click', () => window.print());  // print CSS keeps only #certDoc, A4
  $('#shareBtn').addEventListener('click', share);
  $('#certJsonBtn').addEventListener('click', () => {
    if (!current) return;
    const { snapshot, ...rest } = current;
    downloadText(`paraliproof-cert-${current.payload.id}.json`, JSON.stringify(rest, null, 2));
  });
  $('#certVerifyBtn').addEventListener('click', () => { if (current) app.go('verify', { text: current.qr, ext: current.ext }); });
  $('#certShowQr').addEventListener('click', showQrToFarmer);
  $('#certNextField').addEventListener('click', () => startNextField());
}

/** UX-1: the QR large, for the farmer to scan with "My certificate" (280 px, quiet zone, high contrast). */
export function showQrToFarmer() {
  if (!current) return;
  const body = openModal(`<h3>${L('next.show_qr')}</h3>
    <div class="reg-qr farmer-qr">${qrSVG(current.qr, { ecc: 'M' })}</div>
    <p class="hint center">${esc(t('next.qr_hint'))}</p>
    <div class="row wrap end"><button type="button" class="btn btn-ghost" id="fqShare">${icon('share')}<span>${esc(t('share'))}</span></button><button type="button" class="btn btn-primary" id="fqDone">${esc(t('next.done'))}</button></div>`);
  body.closest('.modal-card').setAttribute('aria-label', t('next.show_qr'));
  body.querySelector('#fqShare').addEventListener('click', share);
  body.querySelector('#fqDone').addEventListener('click', closeModal);
  body.querySelector('#fqDone').focus();
}

export async function showList() {
  const el = $('#certList');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const own = await S.listCerts();
  $('#certsCtx').textContent = own.length ? t(own.length === 1 ? 'ui.certs_ctx_1' : 'ui.certs_ctx', { n: own.length, a: fx(own.reduce((x, c) => x + (Number(c.payload.wa) || 0), 0)) }) : '';
  if (!own.length) {
    const pic = illusImg('empty-certs'); // slot 7: a calm "nothing yet" (the icon stays when there is no file)
    el.innerHTML = `<div class="empty">${pic ? `<div class="illus-slot illus-slot--empty">${pic}</div>` : ICONS.cert}<p>${L('noCerts')}</p><a class="btn btn-ghost btn-dense" href="#job">${L('runDemo')}</a></div>`;
    guard(el);
    return;
  }
  el.innerHTML = own.map((c) => {
    const p = c.payload;
    const nf = (Array.isArray(p.f) ? p.f : []).filter((x) => x !== 'DEMO').length;
    return `<a class="item" href="#cert/${esc(c.id)}"><span class="ic">${ICONS.cert}</span><span class="grow"><b>${esc(p.fl)}</b>
      <small>${esc(fmtDate(p.t0 * 1000))} · <span class="mono">${esc(p.id)}</span>${p.demo ? ' · ' + esc(t('ui.demo')) : ''}${nf ? ` · ${esc(t('ui.n_notes', { n: nf }))}` : ''}</small></span>
      <b class="big">${fx(p.wa)} ac</b>${icon('chevron-right')}</a>`;
  }).join('');
}

export async function showCert(id, params) {
  const rec = await S.findCert(id);
  if (!rec) { $('#certNext').hidden = true; $('#certDoc').innerHTML = `<div class="pp-doc__in"><div class="empty">${ICONS.warn}<p>${L('certNotFound')}</p></div></div>`; current = null; return; }
  current = rec;
  // UX-1: on the operator's own certificate, the next moves come first. Right after Issue the block says
  // "Certificate ready" and offers "Start next field"; later visits keep only "Show QR to farmer".
  const own = rec.source === 'device' && (app.settings.role || 'operator') === 'operator';
  const fresh = !!params?.justIssued;
  $('#certNext').hidden = !own;
  $('#certNext').classList.toggle('is-fresh', fresh);
  $('#certNextTitle').hidden = !fresh; $('#certNextHint').hidden = !fresh; $('#certNextField').hidden = !fresh;
  // slot 4: only the moment right after Issue (never a certificate opened later, never on the printed document)
  if (fresh && own) handoverHTML($('#certNextIllus')); else illusHTML($('#certNextIllus'), null);
  $('#shareBtn').classList.toggle('btn-primary', !own); $('#shareBtn').classList.toggle('btn-ghost', own);
  const v = await verifyCert(rec.qr, rec.ext && Object.keys(rec.ext).length ? rec.ext : undefined);
  $('#certDoc').innerHTML = renderCert(rec, v, app.settings);
}

function satLine(sat, scanned, sv) {
  const SV = { N: 'sat_NOT_BURNED', B: 'sat_BURN_SUSPECTED', I: 'sat_INCONCLUSIVE' };
  if (!sat && SV[sv]) return `<li class="${sv === 'N' ? '' : 'is-warn'}">${icon(sv === 'N' ? 'check' : 'warning')}<span><b>${esc(t('satCheck'))}: ${esc(t(SV[sv]))}</b> · ${esc(t('ui.sv_signed'))}</span></li>`;
  if (!sat) return `<li class="is-info">${icon('info')}<span>${esc(t('satCheck'))}: ${esc(t(scanned ? 'ui.sat_not_in_qr' : 'pending'))}</span></li>`;
  if (sat.error) return `<li class="is-info">${icon('clock')}<span>${esc(t('satCheck'))}: ${esc(t('pending'))}</span></li>`;
  const before = sat.scenes?.find?.((x) => x.role === 'before')?.date, after = sat.scenes?.find?.((x) => x.role === 'after')?.date;
  const ok = sat.verdict === 'NOT_BURNED';
  if (sat.synthetic || sat.source === 'synthetic-demo') return `<li class="is-info">${icon('info')}<span><b>${esc(t('satCheck'))}: ${esc(t('sat_' + sat.verdict))}</b> · ${esc(t('gov.sat_synthetic'))}</span></li>`;
  return `<li class="${ok ? '' : 'is-warn'}">${icon(ok ? 'check' : 'warning')}<span><b>${esc(t('satCheck'))}: ${esc(t('sat_' + sat.verdict))}</b> · ${esc(t('cert.sat_pics', { a: before || '?', b: after || '?' }))}</span></li>`;
}

/** Pure render: certificate record + verification result → inner HTML of <article class="pp-doc">.
 *  Editorial document (docs/ux/DESIGN-DIRECTION.md): no seal, no border pattern, no ribbon. */
export function renderCert(rec, v, settings, opts = {}) {
  // Every payload value is untrusted (it may come from a scanned QR): escape all of it (security review F-02).
  const p = v.payload || rec.payload;
  const ext = rec.ext || {};
  const imp = settings.presets.find((x) => x.code === p.im);
  const lang = settings.lang || 'en';
  const short = (h) => { h = String(h ?? ''); return h.length > 18 ? h.slice(0, 10) + '…' + h.slice(-6) : h; };
  const valid = v.status === 'VALID';
  const trusted = opts.trusted ?? true;
  const sat = ext.satellite, impact = ext.impact;
  const end = new Date(Number(p.t1) * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const flags = (Array.isArray(p.f) ? p.f : []).filter((c) => c !== 'DEMO');
  const dd = (k, val, sub) => `<div><dt>${esc(t(k))}</dt><dd>${val}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  const status = !valid ? `<span class="pp-status pp-status--danger">${icon('circle-x')}${esc(t(v.status))}</span>`
    : trusted ? `<span class="pp-status pp-status--ok">${icon('circle-check')}${esc(t('ui.signed_ok'))}</span>`
    : `<span class="pp-status pp-status--warn">${icon('circle-alert')}${esc(t('ui.verdict_untrusted'))}</span>`;
  const pa = S.payableOf(p);
  const pay = valid && trusted ? `₹${esc(fint(pa.pa * settings.rate))}` : '—';
  // The map snapshot is an SVG string stored with the record. Shown only for certificates made on this device,
  // and always as an <img> so nothing inside it can run (F-02 / F-11).
  const snap = rec.snapshot && rec.source === 'device' ? `<div class="pp-doc__map pp-doc__snap">${svgImg(rec.snapshot, t('map'))}</div>` : '';
  return `<div class="pp-doc__in">
  <div class="pp-doc__top"><span class="pp-wordmark"><span class="pp-wordmark__glyph"></span>ParaliProof</span>
    <div class="pp-doc__meta"><b>${esc(p.id)}</b><br>${esc(fmtDate(rec.createdAt || Number(p.t1) * 1000))}</div></div>
  <p class="pp-doc__eyebrow">${status}${p.demo ? `<span class="pp-doc__demo">${esc(t('ui.demo_cert'))}</span>` : ''}</p>
  <h2 class="pp-doc__title">${esc(t('certTitle'))}</h2>
  <div class="pp-doc__body">
    <div>
      <div class="pp-numeral pp-doc__numeral"><span class="pp-numeral__value">${esc(fx(p.wa))}</span><span class="pp-numeral__unit">${esc(t('ui.acres_unit'))}</span></div>
      <p class="pp-doc__sub">${esc(t('ui.worked_inside'))} · ${esc(fx(p.cv, 0))}% / ${esc(fx(p.fa))} ac · ${esc(fx(Number(p.wa) * 0.404686))} ha</p>
    </div>
    <dl class="pp-dl pp-dl--grid">
      ${dd('field', esc(p.fl))}
      ${dd('implement', esc(imp ? (imp[lang] || imp.en) : p.im), `${esc(fx(p.w, 1))} m${p.ws ? ' · ' + esc(t(p.ws === 'S' ? 'farmer.ws_S' : 'farmer.ws_M')) : ''}`)}
      ${dd('date', esc(fmtDate(Number(p.t0) * 1000)), `– ${esc(end)}`)}
      ${dd('workingTime', `${esc(fx(p.wm, 0))} min`)}
      ${dd('outsideField', `${esc(fx(p.oa))} ac`)}
      ${dd('pay.payable', `${esc(fx(pa.pa))} ac`, esc(pa.A != null ? t('cert.pay_sub', { a: fx(pa.A) }) : t('pay.no_A')))}
      ${dd('incentiveEst', pay, valid && trusted ? `${esc(fx(pa.pa))} × ₹${esc(fint(settings.rate))}` : esc(t('ui.no_pay')))}
    </dl>
  </div>
  ${snap}
  <ul class="pp-doc__checks">
    <li>${icon('check')}<span><b>${esc(t('checkPhone'))}</b> · ${esc(t('res.gps_meta'))}</span></li>
    ${satLine(sat, opts.scanned, p.sv)}
    <li class="${impact && !impact.error ? '' : 'is-info'}">${icon(impact && !impact.error ? 'check' : 'clock')}<span>${esc(t('emissionsAvoided'))}: ${impact && !impact.error
      ? esc(`${fint(impact.co2e_kg?.central)} kg CO₂e (${fint(impact.co2e_kg?.low)}–${fint(impact.co2e_kg?.high)}) · PM2.5 ${fx(impact.pm25_kg)} kg · ${t('indicativeNotCredit')}`)
      : esc(t(opts.scanned ? 'ui.not_in_qr' : 'pending'))}</span></li>
    ${flags.length ? `<li class="is-warn">${icon('warning')}<span><b>${esc(t('cert.notes'))}</b>: ${esc(flags.map(flagWord).join(' · '))}</span></li>` : ''}
  </ul>
  <div class="pp-doc__foot">
    <div class="pp-doc__hash"><b>${esc(t('cert.signed_here'))}</b>: ${esc(t('cert.signed_sub'))}<br><b>${esc(t('cert.phone'))}</b> ${esc(v.kid || rec.kid)} · ${esc(t('cert.seq', { n: p.n }))}<br><b>${esc(t('cert.track_code'))}</b> ${esc(short(p.th))}<br><b>${esc(t('cert.field_code'))}</b> ${esc(short(p.fh))}<br>app ${esc(p.av)}</div>
    <div class="pp-doc__qr">${qrSVG(rec.qr, { ecc: 'M' })}<span>${esc(t('scanToVerify'))}</span></div>
  </div>
  <p class="pp-doc__notice">${esc(t('prototypeNotice'))} ${esc(t('qrNoPersonal'))}</p>
  </div>`;
}

/** A flag code from the payload → its short plain label (unknown codes stay as escaped text). */
const flagWord = (c) => { c = String(c); const k = 'flag.' + c, s = t(k); return s === k ? c : s; };

async function share() {
  if (!current) return;
  const text = current.qr;
  try {
    if (navigator.share) await navigator.share({ title: 'ParaliProof ' + current.payload.id, text });
    else { await navigator.clipboard.writeText(text); toast(t('copied')); }
  } catch { /* user cancelled */ }
}
