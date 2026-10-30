// views/verify.js — VERIFY tab: scan / upload / paste a certificate, check the
// signature, show VALID or TAMPERED, optionally check raw job data.
//
// DOM contract (#v-verify): #scanBtn, #qrFile, #scanBox, #scanVideo, #scanStop, #certText, #verifyBtn, #tamperBtn, #verifyResult
// Data: services.verifyAndRegister, services.checkRawAgainstCert; jsQR (global) or the native BarcodeDetector.

import * as S from '../services.js';
import { FLAG_INFO } from '../flags.js';
import { $, t, L, esc, toast, fx, fint, confirmBox, genuineTick } from '../ui.js';
import { ICONS, icon } from '../icons.js';
import { flagsHTML, payNote } from './record.js';
import { renderCert } from './certs.js';
import { noCashScheme } from '../profile.js';
import { readFileText, fmtDate, round } from '../util.js';

let app, stream = null, scanning = false, lastText = null, lastExt = null, lastResult = null, lastBoundary = null;

export function init(a) {
  app = a;
  $('#verifyBtn').addEventListener('click', () => verify($('#certText').value));
  $('#scanBtn').addEventListener('click', startScan);
  $('#scanStop').addEventListener('click', stopScan);
  $('#qrFile').addEventListener('change', fromImage);
  $('#tamperBtn').addEventListener('click', tamperDemo);
  $('#certFile').addEventListener('change', fromCertFile);
}

/** A certificate FILE (the JSON from "Download certificate file"): QR text + extensions + field boundary. */
async function fromCertFile(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 2e6) { toast(t('verify.not_file')); return; }
  let o;
  try { o = JSON.parse(await readFileText(f)); } catch { toast(t('verify.not_file')); return; }
  if (typeof o?.qr !== 'string' || o.qr.length > 4000) { toast(t('verify.not_file')); return; }
  $('#certText').value = o.qr.trim();
  lastText = o.qr.trim(); lastExt = o.ext && typeof o.ext === 'object' ? S.sanitizeDeep(o.ext) : null; lastBoundary = Array.isArray(o.boundary) ? o.boundary : null;
  await verify(o.qr, lastExt);
}

export function show(params) {
  // UX-4: the tamper test is a demo tool; real officers never see it (demo mode and judge mode only)
  $('#tamperBtn').hidden = !(app.settings.demo || app.settings.tour);
  if (params?.text) { $('#certText').value = params.text; lastExt = params.ext || null; verify(params.text, params.ext); }
}
export function hide() { stopScan(); }

async function verify(text, ext) {
  text = String(text || '').trim();
  if (!text) { toast(t('pasteFirst')); return; }
  if (ext === undefined) ext = text === lastText ? lastExt : null; // keep extensions only for the same certificate
  if (text !== lastText) lastBoundary = null;
  lastText = text; lastExt = ext || null;
  const r = await S.verifyAndRegister(text, lastExt, { settings: app.settings, boundary: lastBoundary });
  lastResult = r;
  render(r);
}

function render(r) {
  const el = $('#verifyResult');
  if (r.status === 'INVALID') {
    el.innerHTML = `<div class="pp-verdict" data-verdict="unknown"><h2 class="pp-verdict__line">${icon('question')}<span>${esc(t('INVALID'))}</span></h2><p class="pp-head__context">${esc(r.reason)}</p></div>`;
    return;
  }
  const p = r.payload;
  const ok = r.status === 'VALID';
  const allFlags = [...(Array.isArray(p.f) ? p.f : []), ...r.extra].map(String);
  // Verdict + payability come from services.verifyAndRegister (security review F-03).
  const V = r.verdict || (ok ? 'VALID_FLAGGED' : r.status);
  const verdict = { VALID_TRUSTED: 'valid', VALID_FLAGGED: 'warn', VALID_UNTRUSTED: 'warn' }[V] || 'tampered';
  const title = { VALID_TRUSTED: t('VALID'), VALID_FLAGGED: t('ui.verdict_warn'), VALID_UNTRUSTED: t('ui.verdict_untrusted') }[V] || t('TAMPERED');
  const vicon = { valid: 'circle-check', warn: 'circle-alert', tampered: 'circle-x', unknown: 'question' }[verdict];
  // Genuine (and only Genuine) gets the animated tick, once per certificate on this page
  const tick = verdict === 'valid' ? genuineTick('verify|' + (r.hash || p.id)) : null;
  const payable = r.payable === true;
  const hasSat = r.extStatus === 'MATCH' && !!(lastExt && lastExt.satellite);
  const SV = { N: 'sat_NOT_BURNED', B: 'sat_BURN_SUSPECTED', I: 'sat_INCONCLUSIVE' };
  const svText = SV[p.sv] ? `${t(SV[p.sv])} (${t('ui.sv_signed')})` : t('ui.sat_not_in_qr');
  const reason = (good, text) => `<li class="${good ? 'is-ok' : ''}">${icon(good ? 'check' : 'cross')}<span>${esc(text)}</span></li>`;
  const chainOk = !r.extra.includes('CHAIN_BREAK');
  const pay = S.payableOf(p);
  const stg = S.paymentStage({ status: r.status, verdict: V, payload: p, extra: r.extra, ext: r.extStatus === 'MATCH' ? lastExt : null });
  const rd = S.readiness({ status: r.status, verdict: V, payload: p, extra: r.extra, stage: stg });
  const sg = r.slipGroup;
  el.innerHTML = `
    <div class="pp-verdict" data-verdict="${verdict}">
      <h2 class="pp-verdict__line${tick?.play ? ' is-tick-play' : ''}">${tick ? tick.html : icon(vicon)}<span>${esc(title)}</span></h2>
      <p class="pp-head__context">${esc(V === 'VALID_UNTRUSTED' ? t('ui.untrusted_body') : ok ? t('validMsg') : t('tamperedMsg'))}</p>
      <ul class="pp-verdict__reasons" style="margin-top:16px">
        ${reason(ok, ok ? t('ui.reason_same') : t('ui.sig_mismatch'))}
        ${ok ? reason(r.trusted, t(r.ownDevice ? 'ui.reason_own' : r.trusted ? 'ui.reason_registered' : 'ui.reason_unregistered')) : reason(false, t('ui.untrusted'))}
        ${ok ? reason(chainOk, t(chainOk ? 'ui.reason_chain_ok' : 'ui.reason_chain_bad')) : ''}
        ${r.extStatus === 'MATCH' ? reason(true, t('ui.reason_ext')) : ''}
        ${ok && !hasSat ? `<li class="${SV[p.sv] ? (p.sv === 'N' ? 'is-ok' : '') : 'is-info'}">${icon(p.sv === 'N' ? 'check' : SV[p.sv] ? 'warning' : 'info')}<span>${esc(t('satCheck'))}: ${esc(svText)}</span></li>` : ''}
      </ul>
    </div>
    <dl class="pp-dl">
      <div><dt>${esc(t('certNo'))}</dt><dd class="mono">${esc(p.id)}</dd></div>
      <div><dt>${esc(t('field'))}</dt><dd>${esc(p.fl)}<small>${esc(fx(p.fa))} ac</small></dd></div>
      <div><dt>${esc(t('workedArea'))}</dt><dd class="pp-num ${ok ? '' : 'is-untrusted'}">${esc(fx(p.wa))} ac · ${esc(fx(p.cv, 0))}%</dd></div>
      ${ok ? `<div><dt>${esc(t('pay.payable'))}</dt><dd class="pp-num">${esc(fx(pay.pa))} ac<small>${esc(payNote(pay))}</small></dd></div>
      <div><dt>${esc(t('stage.title'))}</dt><dd>${esc(t('stage.' + stg.stage))}<small>${esc(t('stage.' + stg.stage + '_sub'))}${stg.note ? ' · ' + esc(t('stage.note_' + stg.note)) : ''}</small></dd></div>
      <div><dt>${esc(t('rd.title'))}</dt><dd>${esc(t('rd.' + rd.bucket))}<small>${esc(t('rdr.' + rd.reason))}</small></dd></div>
      ${sg ? `<div><dt>${esc(t('flag.SLIP_REUSED'))}</dt><dd>${esc(t('slipgroup.text', { n: sg.n, total: fx(sg.total), ra: fx(sg.ra), cap: fx(sg.cap) }))}</dd></div>` : ''}
      <div><dt>${esc(t('fm.title'))}</dt><dd>${esc(t(p.fm ? 'fm.' + p.fm : 'fm.none'))}</dd></div>
      ${p.jh ? `<div><dt>${esc(t('sslip.source'))}</dt><dd>${esc(t(p.ss === 'S' ? 'sslip.src_S' : p.ss === 'F' ? 'sslip.src_F' : 'sslip.src_none'))}${p.sp ? `<small class="mono">${esc(p.sp)}</small>` : ''}</dd></div>` : ''}
      <div><dt>${esc(t('farmer.machine_src'))}</dt><dd>${esc(p.ws === 'S' ? t('farmer.ws_S') : p.ws === 'M' ? t('farmer.ws_M') : t('farmer.ws_none'))}</dd></div>` : ''}
      <div><dt>${esc(t('date'))}</dt><dd>${esc(fmtDate(Number(p.t0) * 1000))}</dd></div>
      <div><dt>${esc(t('incentiveEst'))}</dt><dd class="pp-num">${noCashScheme() ? `—<small>${esc(t('prof.no_cash'))}</small>` : rd.ready ? `₹${esc(fint(pay.pa * app.settings.rate))}` : payable ? `—<small>${esc(t('rd.' + rd.bucket))}</small>` : ok ? `—<small>${esc(t('ui.no_pay'))}</small>` : '—'}</dd></div>
      <div><dt>${esc(t('ver.made_on'))}</dt><dd class="mono">${esc(r.kid)}</dd></div>
      <div><dt>${esc(t('ver.seq'))}</dt><dd>${esc(t('ver.seq_val', { n: p.n }))}<small>${esc(t(chainOk ? 'ui.reason_chain_ok' : 'ui.reason_chain_bad'))}</small></dd></div>
    </dl>
    ${V === 'VALID_UNTRUSTED' ? `<button class="btn btn-ghost" id="trustBtn">${L('trustKey')}</button>` : ''}
    <section class="pp-section"><h2 class="pp-section__title">${L('integrityFlags')}</h2><div>${flagsHTML(allFlags, { withCodes: true })}</div></section>
    <details class="card"><summary class="pp-section__title">${L('rawCheck')}</summary><p class="hint">${L('rawCheckHint')}</p>
      <label class="btn btn-ghost btn-dense file-btn"><span>${L('uploadJob')}</span><input type="file" accept="application/json,.json" id="rawFile" hidden></label>
      <div id="rawResult"></div></details>
    <details class="card"><summary class="pp-section__title">${L('viewCert')}</summary><article class="pp-doc" data-theme="light">${renderCert({ qr: lastText, payload: p, ext: lastExt || {}, kid: r.kid, source: 'verify' }, r, app.settings, { scanned: true, trusted: r.trusted })}</article></details>
    <p class="hint center">${esc(t('ui.offline_ok'))}</p>`;
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ok ? 30 : [80, 60, 80]);
  $('#trustBtn')?.addEventListener('click', async () => {
    if (!(await confirmBox(t('ui.trust_confirm', { kid: r.kid }), 'trustKey'))) return; // F-03: officer compares with the enrolment sheet
    if (!S.isValidPublicKey(r.pub)) { toast(t('badKey')); return; }
    app.settings.trustedKeys = [...(app.settings.trustedKeys || []).filter((k) => k.pub !== r.pub), { kid: r.kid, pub: r.pub, addedAt: Date.now() }];
    await S.saveSettings(app.settings);
    toast(t('keyTrusted')); verify(lastText);
  });
  $('#rawFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#rawResult').innerHTML = `<p class="hint">${esc(t('processing'))}…</p>`;
    try {
      const o = JSON.parse(await readFileText(f));
      if (o.type !== 'paraliproof-job') throw new Error(t('notJobFile'));
      const res = await S.checkRawAgainstCert(o, p);
      const chip = (s) => (s === 'MATCH' ? `<span class="pp-status pp-status--ok">${icon('circle-check')}MATCH</span>` : s ? `<span class="pp-status pp-status--danger">${icon('circle-x')}MISMATCH</span>` : '–');
      $('#rawResult').innerHTML = `<table class="kv"><tr><th>${L('trackHash')}</th><td>${chip(res.trackHash)}</td></tr>
        <tr><th>${L('fieldHash')}</th><td>${chip(res.fieldHash)}</td></tr>
        ${res.recomputedAcres != null ? `<tr><th>${L('recomputed')}</th><td>${esc(fx(res.recomputedAcres))} ac ${chip(res.acres)}</td></tr>` : ''}</table>
        ${res.trackHash !== 'MATCH' ? flagsHTML(['HASH_MISMATCH']) : ''}`;
    } catch (err) { $('#rawResult').innerHTML = `<p class="warn">${esc(err.message)}</p>`; }
  });
  el.querySelector('.pp-verdict')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

/** Judge mode step 6: the same tamper demo, with the pasted text visible. */
export function tourTamper() { const d = document.querySelector('details.paste'); if (d) d.open = true; return tamperDemo(); }

/** For the video: take the latest certificate, inflate its acres, and show that verification fails. */
async function tamperDemo() {
  let text = $('#certText').value.trim();
  if (!text) { const c = (await S.listCerts())[0]; if (!c) { toast(t('noCertToTamper')); return; } text = c.qr; }
  const m = text.match(/"wa":([0-9.]+)/);
  if (!m) { toast(t('pasteFirst')); return; }
  const fake = round(Number(m[1]) + 2.5, 2);
  const forged = text.replace(`"wa":${m[1]}`, `"wa":${fake}`);
  $('#certText').value = forged;
  toast(t('tamperedAcres', { a: m[1], b: fake }), 3500);
  await verify(forged, null);
}

// ---------------- QR scanning ----------------
async function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) { toast(t('noCamera')); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { toast(t('noCamera') + ': ' + e.message); return; }
  const video = $('#scanVideo');
  video.srcObject = stream;
  await video.play();
  $('#scanBox').hidden = false;
  scanning = true;
  let detector = null;
  try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {}
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loop = async () => {
    if (!scanning) return;
    let text = null;
    try {
      if (detector) { const r = await detector.detect(video); if (r[0]) text = r[0].rawValue; }
      else if (video.videoWidth && globalThis.jsQR) {
        const s = Math.min(1, 800 / video.videoWidth);
        canvas.width = video.videoWidth * s; canvas.height = video.videoHeight * s;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code) text = code.data;
      }
    } catch {}
    if (text) { navigator.vibrate?.(60); stopScan(); $('#certText').value = text; lastExt = null; verify(text, null); return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function stopScan() {
  scanning = false;
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  if ($('#scanBox')) $('#scanBox').hidden = true;
}

async function fromImage(e) {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode().catch(() => {});
  const canvas = document.createElement('canvas');
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  canvas.width = img.width * s; canvas.height = img.height * s;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = globalThis.jsQR?.(d.data, d.width, d.height);
  URL.revokeObjectURL(img.src);
  e.target.value = '';
  if (!code) { toast(t('noQrFound')); return; }
  $('#certText').value = code.data; lastExt = null;
  verify(code.data, null);
}
