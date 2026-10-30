// views/dash.js — OFFICER dashboard: all certificates known on this device
// (issued here + verified/scanned), re-verified, on a map, with totals.
//
// DOM contract (#v-dash): #rateInp, #dashKpis, #dashMap, #csvBtn, #demoFleetBtn, #dashTable
// Data: services.dashboardEntries() → [{status, payload, kid, hash, extra[], boundary?, demo, source}]

import * as S from '../services.js';
import { FLAG_INFO } from '../flags.js';
import { $, t, L, esc, toast, openModal, closeModal, makeMap, cssVar, fx, fint } from '../ui.js';
import { icon } from '../icons.js';
import { downloadText, fmtDate } from '../util.js';
import { scanQr } from '../scan.js';
import { parseSlip, slipHash, qrKind } from '../qrformats.js';
import { activeProfile, noCashScheme } from '../profile.js';

let app, mm = null, layer = null, entries = [];

export function init(a) {
  app = a;
  $('#rateInp').addEventListener('change', async () => { app.settings.rate = Math.max(0, Number($('#rateInp').value) || 0); await S.saveSettings(app.settings); render(); });
  $('#csvBtn').addEventListener('click', csv);
  $('#hqBtn').addEventListener('click', hq);
  $('#demoFleetBtn').addEventListener('click', fleet);
  $('#matchSlipBtn').addEventListener('click', matchSlip);
}

export async function show() {
  $('#rateInp').value = app.settings.rate;
  if (!mm) { mm = makeMap($('#dashMap')); layer = globalThis.L.layerGroup().addTo(mm.map); }
  setTimeout(() => mm.map.invalidateSize(), 50);
  $('#dashKpis').innerHTML = '<div class="kpi"><div class="skeleton" style="height:48px"></div></div>'.repeat(4);
  entries = await S.dashboardEntries(app.settings);
  render();
}

// Verdict and payability come from services.dashboardEntries (security review F-03):
// VALID_TRUSTED → green, VALID_FLAGGED → review, VALID_UNTRUSTED → amber "do not pay", TAMPERED/INVALID → red.
const ST_OF = { VALID_TRUSTED: 'VALID', VALID_FLAGGED: 'FLAGGED', VALID_UNTRUSTED: 'UNTRUSTED', TAMPERED: 'TAMPERED', INVALID: 'INVALID' };
const shownStatus = (e) => ST_OF[e.verdict] || (e.status === 'VALID' ? 'FLAGGED' : 'INVALID');
const payable = (e) => e.payable === true;

const ST_ICON = { VALID: ['ok', 'circle-check'], FLAGGED: ['warn', 'warning'], UNTRUSTED: ['warn', 'circle-alert'], TAMPERED: ['danger', 'circle-x'], INVALID: ['danger', 'circle-x'] };
const ST_KEY = { VALID: 'ui.st_valid', FLAGGED: 'ui.st_flagged', UNTRUSTED: 'ui.st_untrusted', TAMPERED: 'ui.st_tampered', INVALID: 'ui.st_tampered' };
const stLabel = (st) => { const [cls, ic] = ST_ICON[st] || ['', 'question']; return `<span class="pp-status pp-status--${cls}">${icon(ic)}${esc(t(ST_KEY[st] || st))}</span>`; };
const RANK = { TAMPERED: 0, INVALID: 0, UNTRUSTED: 1, FLAGGED: 1, VALID: 2 };

function render() {
  const rate = app.settings.rate;
  const sum = S.summarizeDashboard(entries, rate);
  const demoN = sum.demo;
  // 2019 Haryana order: a CHC / baler register is the evidence the village officer checks → this list is its digital form
  $('#dashCtx').textContent = (app.settings.tour ? '' : t('reg.digital') + ' · ') + t(entries.length === 1 ? 'ui.dash_ctx_1' : 'ui.dash_ctx', { n: entries.length }) + (demoN ? ' · ' + t(demoN === 1 ? 'includesDemo_1' : 'includesDemo', { n: demoN }) : '');
  // G11: acres and ₹ count only claims READY for the DLEC list (satellite clear, slip present, no open high flag)
  const nC = (n) => t(n === 1 ? 'kpi.claims_1' : 'kpi.claims', { n });
  $('#dashKpis').innerHTML = `
    <div class="kpi"><small>${L('kpi.ready')}</small><b class="kpi-accent">${esc(fx(sum.acres))}</b><span>${esc(nC(sum.ready))}</span></div>
    ${noCashScheme() ? `<div class="kpi"><small>${L('kpi.no_cash')}</small><b>${esc(fx(sum.genuineAcres))}</b><span>${esc(t('kpi.no_cash_sub'))}</span></div>`
      : `<div class="kpi"><small>${L('kpi.due')}</small><b>₹${esc(fint(sum.inr))}</b><span>@ ₹${esc(fint(rate))}/acre</span></div>`}
    <div class="kpi"><small>${icon('clock')} ${L('kpi.waiting')}</small><b>${esc(sum.waiting)}</b><span>${esc(t('kpi.genuine', { a: fx(sum.genuineAcres) }))}</span></div>
    <div class="kpi"><small>${icon('warning')} ${L('kpi.review')}</small><b>${esc(sum.review)}</b><span>${esc(t('kpi.not_usable', { n: sum.notUsable }))}</span></div>`;

  // map: outline + light fill; flagged and tampered dashed (never colour alone: the table carries icon + word)
  const Lf = globalThis.L;
  layer.clearLayers();
  const colors = { VALID: cssVar('--c-accent', '#1E5B3A'), FLAGGED: cssVar('--c-warning', '#B54708'), UNTRUSTED: cssVar('--c-warning', '#B54708'), TAMPERED: cssVar('--c-danger', '#B42318'), INVALID: cssVar('--c-danger', '#B42318') };
  const bounds = [];
  for (const e of entries) {
    const p = e.payload; if (!Array.isArray(p?.fc) || !p.fc.every(Number.isFinite)) continue;
    const st = shownStatus(e), col = colors[st] || '#8E968F';
    const html = `<b>${esc(p.fl)}</b><br><span class="mono">${esc(p.id)}</span><br>${esc(fx(p.wa))} ac · ${esc(fx(p.cv, 0))}%<br>${stLabel(st)}`;
    if (e.boundary) Lf.polygon(e.boundary, { color: col, weight: st === 'VALID' ? 1.5 : 2.5, fillOpacity: 0.22, dashArray: st === 'VALID' ? null : '5 4' }).bindPopup(html).addTo(layer);
    Lf.circleMarker(p.fc, { radius: 6, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).bindPopup(html).addTo(layer);
    bounds.push(p.fc);
  }
  if (bounds.length) mm.map.fitBounds(Lf.latLngBounds(bounds).pad(0.4), { maxZoom: 16 });

  // table: flagged and tampered first
  const tb = $('#dashTable');
  if (!entries.length) { tb.innerHTML = `<tbody><tr><td><div class="empty">${icon('certificate')}<p>${L('dashEmpty')}</p></div></td></tr></tbody>`; return; }
  const rows = [...entries].sort((a, b) => (RANK[shownStatus(a)] ?? 3) - (RANK[shownStatus(b)] ?? 3) || (b.payload?.t0 || 0) - (a.payload?.t0 || 0));
  tb.innerHTML = `<thead><tr><th>${L('status')}</th><th>${L('field')}</th><th class="is-num">${L('acres')}</th><th class="is-num">%</th><th class="is-num">₹</th><th>${L('flags')}</th><th>${L('ui.date_only')}</th></tr></thead><tbody>` +
    rows.map((e) => {
      const p = e.payload || {}, st = shownStatus(e);
      const fl = sortFlags([...(Array.isArray(p.f) ? p.f : []), ...(e.extra || [])]);
      const when = p.t0 ? Number(p.t0) * 1000 : null;
      const stg = e.stage || S.paymentStage(e);
      return `<tr data-id="${esc(p.id)}" tabindex="0" aria-label="${esc(t('ui.open_cert', { id: p.id }))}"><td>${stLabel(st)}<span class="sub stage-sub ${stg.exception ? 'is-exc' : ''}">${esc(t('stage.' + stg.stage))}</span>${e.ready ? `<span class="sub rd-sub rd-${esc(e.ready.bucket)}">${esc(t('rd.' + e.ready.bucket))}</span>` : ''}</td><td class="cell-field" title="${esc(p.fl)}"><span class="cell-field__name">${esc(p.fl)}</span><span class="sub mono">${esc(p.id)}${p.demo ? ' · ' + esc(t('ui.demo')) : ''}</span></td>
        ${e.status === 'VALID' ? `<td class="is-num cell-acres" title="${esc(t('pay.payable'))}">${esc(fx((e.acres || S.payableOf(p)).pa))}<span class="cell-unit"> ac</span>${(e.acres || S.payableOf(p)).limit !== 'C' ? `<span class="sub">${esc(t('dash.of_worked', { a: fx(p.wa) }))}</span>` : ''}</td>`
          : `<td class="is-num cell-acres is-untrusted" title="${esc(t('TAMPERED'))}">${esc(fx(p.wa))}<span class="cell-unit"> ac</span></td>`}<td class="is-num">${esc(fx(p.cv, 0))}</td>
        <td class="is-num">${e.ready?.ready || e.ready?.bucket === 'APPROVED' ? esc(fint((e.acres || S.payableOf(p)).pa * app.settings.rate)) : '—'}</td>${flagCell(fl)}<td class="cell-date" title="${when ? esc(fmtDate(when)) : ''}">${when ? esc(shortDate(when)) : ''}</td></tr>`;
    }).join('') + '</tbody>';
  tb.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => app.go('cert/' + tr.dataset.id));
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.go('cert/' + tr.dataset.id); } });
  });
}

// Officer table: one human-readable flag (the most serious) + "+N"; the full list is in the tooltip.
const SEV_RANK = { high: 0, warn: 1, info: 2 };
function sortFlags(codes) {
  const uniq = [...new Set(codes.map(String))].filter((c) => c !== 'DEMO');
  return uniq.sort((a, b) => (SEV_RANK[FLAG_INFO[a]?.sev] ?? 1) - (SEV_RANK[FLAG_INFO[b]?.sev] ?? 1));
}
const flagLabel = (c) => { const k = 'flag.' + c, s = t(k); return s === k ? c : s; };
function flagCell(fl) {
  if (!fl.length) return '<td class="cell-flags is-empty"><span class="sub">—</span></td>';
  const sev = FLAG_INFO[fl[0]]?.sev || 'warn';
  const all = fl.map(flagLabel).join(', ');
  return `<td class="cell-flags" title="${esc(all)}"><span class="cell-flags__main is-${esc(sev)}" aria-hidden="true">${esc(flagLabel(fl[0]))}</span>${fl.length > 1 ? `<span class="cell-flags__more" aria-hidden="true">+${fl.length - 1}</span>` : ''}<span class="pp-sr-only">${esc(all)}</span></td>`;
}
/** Officer: hash a farmer's job slip and list the certificates that used it. */
async function matchSlip() {
  const text = await scanQr({ title: t('match.btn'), hint: t('match.hint'), placeholder: 'PPJ1|{…}' });
  if (!text) return;
  let jh;
  try {
    if (qrKind(text) === 'slip2') { const v = await S.verifyAnyStateSlip(text); if (!v.jh) throw new Error(t('sslip.' + v.status) + (v.reason ? ' — ' + v.reason : '')); jh = v.jh; }
    else if (qrKind(text) !== 'slip') throw new Error(t('scan2.not_slip'));
    else jh = await slipHash(parseSlip(text).slip);
  } catch (e) { toast(e.message, 5000); return; }
  const hits = S.certsForSlip(entries, jh);
  const body = openModal(`<h3>${L('match.btn')}</h3><p class="hint mono">${esc(jh)}</p>${hits.length
    ? `<div class="list">${hits.map((e) => `<a class="item" href="#cert/${esc(e.payload.id)}"><span class="grow"><b>${esc(e.payload.fl)}</b><small class="mono">${esc(e.payload.id)}</small></span><b class="big">${esc(fx(S.payableOf(e.payload).pa))} ac</b></a>`).join('')}</div>`
    : `<p>${esc(t('match.none'))}</p>`}<button type="button" class="btn btn-ghost" id="mClose">${L('ok')}</button>`);
  body.querySelector('#mClose').addEventListener('click', closeModal);
  body.querySelectorAll('a.item').forEach((a) => a.addEventListener('click', closeModal));
}

const shortDate = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function hq() {
  const n = entries.filter((e) => e.ready?.ready || e.ready?.bucket === 'APPROVED').length;
  if (!n) { toast(t('hq.none')); return; }
  const ex = activeProfile()?.export; // a signed state profile supplies the column map and format name
  downloadText(`paraliproof-hq-ready-${ex?.format || 'PROPOSED-FORMAT'}-${new Date().toISOString().slice(0, 10)}.csv`, S.hqCSV(entries, app.settings.rate, ex ? { columns: ex.columns, format: ex.format, noCash: noCashScheme() } : {}), 'text/csv');
  toast(t('hq.done', { n }), 4000);
}
function csv() {
  downloadText('paraliproof-dashboard.csv', S.dashboardCSV(entries, app.settings.rate), 'text/csv'); // formula-injection safe (F-13)
}

async function fleet() {
  const body = openModal(`<h3>${L('demoFleet')}</h3><p class="hint">${L('demoFleetHint')}</p><div class="progress"><i id="fp"></i></div><p class="hint center" id="fpt"></p>`);
  try {
    const n = await S.generateDemoFleet(app.settings, (f, s) => {
      body.querySelector('#fp').style.width = Math.round(f * 100) + '%';
      if (s) body.querySelector('#fpt').textContent = `${t('simulating')} ${s.i + 1} / 8`;
    });
    closeModal();
    toast(t('fleetDone', { n }));
    show();
  } catch (e) { closeModal(); console.error(e); toast(e.message); }
}
