// views/district.js — Phase 3: DDA district dashboard, State dashboard, DLEC batch builder (DDA) and
// DLEC batch review + signed minutes. Charts are plain inline SVG (no library): a backlog/ageing bar chart
// (days pending by stage) and machine use (acres per machine, idle machines, capacity flags).
// DOM contract: #v-district #districtBody · #v-state #stateBody · #v-batch #batchBody · #v-dlec #dlecBody.
// Nothing here pays anyone: the DLEC approves, HQ pays by DBT/SFTP after the (proposed-format) upload.

import * as S from '../services.js';
import * as G from '../gov.js';
import { levelOf, levelName, hasPower } from '../govroles.js';
import { $, t, esc, toast, fx, fint, getLang, openModal, closeModal, confirmBox, signedInline } from '../ui.js';
import { icon } from '../icons.js';
import { downloadText, fmtDate, round } from '../util.js';
import { machineOf, dayOf, DEFAULT_CAPACITY } from '../crosscheck.js';
import { machineHash } from '../qrformats.js';
import { activeProfile, noCashScheme } from '../profile.js';
import { illusImg } from '../illus.js';

/** Today as YYYY-MM-DD in the phone's own time zone (toISOString() is UTC: before 05:30 IST it said yesterday). */
const localDay = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
let app, justLoaded = 0;
export function init(a) {
  app = a;
  // UX-3: "Load demo district" sits on every empty government screen (one delegated handler)
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-demo-district]'); if (!b) return;
    loadDemoDistrict({ batch: b.dataset.demoDistrict === 'batch' });
  });
}

/** Offer the demo district on an empty screen (in demo mode, or on a phone that holds no claim at all), until it is loaded. */
export const offerDemo = (a, entries) => !a.settings.tour && !a.settings.demoDistrictAt && (a.settings.demo || !entries.length);
export const demoCta = (batch = false) => `<button type="button" class="btn btn-primary btn-dense" data-demo-district="${batch ? 'batch' : '1'}">${icon('layers')}<span>${esc(t(batch ? 'dist.demo_load_batch' : 'dist.demo_load'))}</span></button><p class="hint">${esc(t('dist.demo_sub'))}</p>`;
/** One-time inline confirmation after loading (instead of a toast over the buttons). */
export function demoLoadedNote() { if (!justLoaded) return ''; const n = justLoaded; justLoaded = 0; return `<p class="pp-status pp-status--ok demo-loaded">${icon('circle-check')}${esc(t('dist.demo_loaded', { n }))}</p>`; }
/** Load the signed DEMO district (every signature re-checked), switch demo mode on, re-open the same screen.
 *  batch: also build the DDA's DLEC batch, so an empty DLEC screen has something to review (demo shortcut). */
export async function loadDemoDistrict({ batch = false } = {}) {
  openModal(`<h3>${esc(t('dist.demo_load'))}</h3><p class="hint">${esc(t('dist.demo_hint'))}</p><div class="progress indeterminate"><i></i></div>`);
  try {
    const data = await (await fetch(new URL('../../demo/demo-district.json', import.meta.url))).json();
    const n = await S.importDemoDistrict(app.settings, data);
    app.settings.demo = true; app.settings.demoDistrictAt = Date.now(); await S.saveSettings(app.settings);
    if (batch) {
      const { entries, gov } = await claims();
      const cand = entries.filter((e) => e.ready?.ready && !e.gov?.batchId);
      if (!gov.batches.length && cand.length) await G.buildBatch('district', cand, S.payableOf);
    }
    justLoaded = n;
    closeModal(); app.refreshChrome();
    app.go(location.hash.slice(1) || app.home());
  } catch (err) { closeModal(); toast(err.message, 5000); }
}

const lvl = () => levelOf(app.settings);
const can = (p) => hasPower(lvl(), p);
const head = (title, ctx, action = '') => `<div class="pp-head"><p class="pp-head__eyebrow">${esc(lvl() ? levelName(lvl(), getLang()) : t('role.officer'))}</p><h1 class="pp-head__title">${esc(title)}</h1>
  ${ctx ? `<p class="pp-head__context">${esc(ctx)}</p>` : ''}${action ? `<div class="pp-head__action">${action}</div>` : ''}</div>`;
const sk = '<div class="skeleton"></div><div class="skeleton"></div>';
async function claims() { const gov = await G.loadGov(); return { gov, entries: await S.dashboardEntries(app.settings, gov) }; }
const daysPending = (e) => Math.max(0, Math.floor((Date.now() - Number(e.payload?.t1 || 0) * 1000) / 864e5));
const isSynthSat = (e) => !!(e.ext?.satellite?.synthetic || e.ext?.satellite?.source === 'synthetic-demo');

// ---------------- KPI row (same rules as the officer dashboard: ₹ counts READY claims only) ----------------
/** UX-3: the accent goes on the one figure that matters most and is not zero: ready acres, else approved claims. */
export function accentKpi(sum) { return sum.acres > 0 ? 'ready' : sum.approved > 0 ? 'approved' : null; }
function kpis(entries) {
  const sum = S.summarizeDashboard(entries, app.settings.rate);
  const nC = (n) => t(n === 1 ? 'kpi.claims_1' : 'kpi.claims', { n });
  const acc = accentKpi(sum);
  return `<div class="kpis kpis-4">
    <div class="kpi"><small>${esc(t('kpi.ready'))}</small><b class="${acc === 'ready' ? 'kpi-accent' : ''}">${esc(t('kpi.ready_ac', { a: fx(sum.acres) }))}</b><span>${esc(nC(sum.ready))}${noCashScheme() ? '' : ` · ₹${esc(fint(sum.inr))}`}</span></div>
    <div class="kpi"><small>${esc(t('rd.APPROVED'))}</small><b class="${acc === 'approved' ? 'kpi-accent' : ''}">${esc(nC(sum.approved))}</b><span>${esc(t(noCashScheme() ? 'kpi.no_cash_sub' : 'dist.hq_after'))}</span></div>
    <div class="kpi"><small>${icon('clock')} ${esc(t('kpi.waiting'))}</small><b>${esc(nC(sum.waiting))}</b><span>${esc(t('kpi.genuine', { a: fx(sum.genuineAcres) }))}</span></div>
    <div class="kpi"><small>${icon('warning')} ${esc(t('kpi.review'))}</small><b>${esc(nC(sum.review))}</b><span>${esc(t('kpi.not_usable', { n: sum.notUsable }))}</span></div></div>`;
}

// ---------------- backlog / ageing chart (days pending by stage) ----------------
export const AGE_BANDS = [[0, 7], [8, 14], [15, 21], [22, Infinity]];
export const AGE_ROWS = ['WAITING', 'REVIEW', 'READY', 'APPROVED', 'NOT_USABLE'];
/** counts[row][band] — exported for tests. */
export function ageing(entries) {
  const out = Object.fromEntries(AGE_ROWS.map((r) => [r, AGE_BANDS.map(() => 0)]));
  for (const e of entries) {
    const r = e.ready?.bucket; if (!out[r]) continue;
    const d = daysPending(e), i = AGE_BANDS.findIndex(([a, b]) => d >= a && d <= b);
    out[r][i]++;
  }
  return out;
}
function ageingSVG(entries) {
  const A = ageing(entries);
  const rows = AGE_ROWS.filter((r) => A[r].some((x) => x));
  if (!rows.length) return `<p class="hint">${esc(t('dist.no_data'))}</p>`;
  const max = Math.max(...rows.map((r) => A[r].reduce((a, b) => a + b, 0)));
  const shade = ['var(--age-1)', 'var(--age-2)', 'var(--age-3)', 'var(--age-4)'];
  // one row per stage: label + total as text (scales with the font), the stacked bar as inline SVG
  const bars = rows.map((r) => {
    const tot = A[r].reduce((a, b) => a + b, 0);
    let x = 0;
    const seg = A[r].map((n, bi) => { if (!n) return ''; const w = (100 * n) / max; const out = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0.4, w - 0.4).toFixed(2)}" height="10" fill="${shade[bi]}"><title>${esc(t('rd.' + r))}: ${n} · ${esc(bandLabel(bi))}</title></rect>`; x += w; return out; }).join('');
    return `<div class="age__row"><div class="age__lbl"><span>${esc(t('rd.' + r))}</span><b class="pp-num">${tot}</b></div><svg class="age__bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">${seg}</svg></div>`;
  }).join('');
  const legend = AGE_BANDS.map((_, i) => `<span class="ch-key"><i style="background:${shade[i]}"></i>${esc(bandLabel(i))}</span>`).join('');
  const table = `<div class="pp-sr-only"><table><caption>${esc(t('dist.ageing'))}</caption><tr><th></th>${AGE_BANDS.map((_, i) => `<th>${esc(bandLabel(i))}</th>`).join('')}</tr>${rows.map((r) => `<tr><th>${esc(t('rd.' + r))}</th>${A[r].map((n) => `<td>${n}</td>`).join('')}</tr>`).join('')}</table></div>`;
  return `<figure class="chart" aria-label="${esc(t('dist.ageing'))}"><div class="age">${bars}</div><figcaption class="ch-legend">${legend}</figcaption>${table}</figure>`;
}
const bandLabel = (i) => { const [a, b] = AGE_BANDS[i]; return b === Infinity ? t('dist.days_plus', { a }) : t('dist.days', { a, b }); };

// ---------------- machine use ----------------
export async function machineUse(entries, reg, capacity = DEFAULT_CAPACITY) {
  const names = new Map(), keyOf = new Map();
  for (const m of reg?.machines || []) { const k = 'M:' + (await machineHash(m.mid)); names.set(k, m); keyOf.set(m, k); }
  const rows = new Map();
  for (const e of entries) {
    if (e.status !== 'VALID' || !e.payload) continue;
    const k = machineOf(e);
    if (!rows.has(k)) rows.set(k, { key: k, m: names.get(k) || null, acres: 0, jobs: 0, days: new Map(), cap: 0, im: e.payload.im });
    const r = rows.get(k);
    r.acres += Number(e.payload.wa) || 0; r.jobs++;
    const d = dayOf(e.payload.t0); r.days.set(d, (r.days.get(d) || 0) + (Number(e.payload.wa) || 0));
    if ((e.extra || []).includes('CAPACITY')) r.cap++;
  }
  const used = [...rows.values()].map((r) => ({ ...r, acres: round(r.acres, 2), maxDay: round(Math.max(...r.days.values()), 2), limit: Number(capacity[r.im]) || 15 }));
  const idle = (reg?.machines || []).filter((m) => !rows.has(keyOf.get(m)));
  return { used: used.sort((a, b) => b.acres - a.acres), idle };
}
function machineHTML(mu) {
  if (!mu.used.length) return `<p class="hint">${esc(t('dist.no_data'))}</p>`;
  const max = Math.max(...mu.used.map((r) => r.acres));
  return `<div class="mach">${mu.used.slice(0, 16).map((r) => {
    const name = r.m ? r.m.mid : (r.key.startsWith('M:') ? t('dist.sticker') : t('dist.phone_only'));
    const mname = (c) => { const k = 'mach.' + c, v = t(k); return v === k ? String(c ?? '') : v; }; // full names, not HS/SS/BL/MU
    const sub = r.m ? `${r.m.chc} · ${mname(r.m.type)}` : mname(r.im);
    return `<div class="mach__row"><div class="mach__name"><b>${esc(name)}</b><small>${esc(sub)} · ${esc(t('dist.jobs', { n: r.jobs }))}</small></div>
      <svg class="mach__bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="1" width="${(100 * r.acres / max).toFixed(1)}" height="8" rx="1.5" class="${r.cap ? 'is-cap' : ''}"/></svg>
      <div class="mach__num"><b class="pp-num">${esc(fx(r.acres, 1))} ac</b><small class="${r.maxDay > r.limit ? 'is-warn' : ''}">${esc(t('dist.maxday', { a: fx(r.maxDay, 1), l: r.limit }))}</small></div></div>`;
  }).join('')}</div>
  ${mu.idle.length ? `<p class="hint">${icon('info')} ${esc(t('dist.idle', { n: mu.idle.length, list: mu.idle.map((m) => `${m.mid} (${m.chc})`).join(', ') }))}</p>` : ''}`;
}

// ---------------- DDA district dashboard ----------------
export async function showDistrict() { return dashboard('district'); }
export async function showState() { return dashboard('state'); }
async function dashboard(kind) {
  const el = $(kind === 'district' ? '#districtBody' : '#stateBody');
  const title = t(kind === 'district' ? 'dist.title' : 'state.title');
  el.innerHTML = head(title, t(kind === 'district' ? 'dist.ctx' : 'state.ctx')) + sk;
  const { entries, gov } = await claims();
  const reg = await S.demoRegistry();
  const mu = await machineUse(entries, reg, app.settings.capacity);
  const demoN = entries.filter((e) => e.payload?.demo).length;
  const synthN = entries.filter(isSynthSat).length;
  const villages = new Map();
  for (const e of entries) { const v = e.village || '—'; if (!villages.has(v)) villages.set(v, []); villages.get(v).push(e); }
  const vname = (id) => (id === 'real' ? t('dist.real_parcels') : reg?.villages?.find((v) => v.id === id)?.name || (id === '—' ? t('dist.other') : id));
  // UX-3: every number carries its label (the phone layout used to drop the table head: "0 0", "0 2")
  const cell = (k, n) => `<span class="roll__n${n ? '' : ' is-zero'}"><b class="pp-num">${esc(n)}</b> ${esc(t(k))}</span>`;
  const stateExtra = kind === 'state' ? `<section class="pp-section"><h2 class="pp-section__title">${esc(t('state.rollup'))}</h2><div class="roll">
      ${[...villages.entries()].map(([v, es]) => { const s = S.summarizeDashboard(es, app.settings.rate); return `<div class="roll__row"><span class="roll__name">${esc(vname(v))}</span><span class="roll__nums">${cell('kpi.ready', s.ready)}${cell('rd.APPROVED', s.approved)}${cell('kpi.waiting', s.waiting)}${cell('kpi.review', s.review)}</span></div>`; }).join('')}</div>
      <p class="hint">${esc(t('state.log', { n: gov.log.length, b: t(gov.batches.length === 1 ? 'state.batches_1' : 'state.batches', { n: gov.batches.length }) }))}</p></section>` : '';
  el.innerHTML = head(title, entries.length ? t('dist.ctx_n', { n: entries.length }) + (demoN ? ' · ' + t('dist.demo_n', { n: demoN }) : '') : t(kind === 'district' ? 'dist.ctx' : 'state.ctx')) + demoLoadedNote() +
    (entries.length ? kpis(entries) + `
    ${synthN ? `<p class="hint">${icon('info')} ${esc(t('dist.synth_note', { n: synthN }))}</p>` : ''}
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('dist.ageing'))}</h2><p class="hint">${esc(t('dist.ageing_ctx'))}</p>${ageingSVG(entries)}</section>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('dist.machines'))}</h2><p class="hint">${esc(t('dist.machines_ctx'))}</p>${machineHTML(mu)}</section>${stateExtra}`
    : `<div class="empty">${icon('grid')}<p>${esc(t('dist.empty'))}</p>${offerDemo(app, entries) ? demoCta() : ''}</div>`);
}

// ---------------- DDA: DLEC batch builder ----------------
export async function showBatch() {
  const el = $('#batchBody');
  el.innerHTML = head(t('batch.title'), t('batch.ctx')) + sk;
  const { entries, gov } = await claims();
  const cand = entries.filter((e) => e.ready?.ready && !e.gov?.batchId);
  const acres = round(cand.reduce((a, e) => a + S.payableOf(e.payload).pa, 0), 2);
  el.innerHTML = head(t('batch.title'), t('batch.ctx2', { n: cand.length, a: fx(acres) }),
    can('batch') && cand.length ? `<button type="button" class="btn btn-primary btn-dense" id="batchBuild">${icon('lock')}<span>${esc(t('batch.build', { n: cand.length }))}</span></button>` : '') +
    (can('batch') ? '' : `<p class="hint">${esc(t('batch.dda_only'))}</p>`) +
    demoLoadedNote() +
    `<section class="pp-section"><h2 class="pp-section__title">${esc(t('batch.ready'))}</h2>${cand.length ? evidenceTable(cand) : `<div class="empty">${icon('layers')}<p>${esc(t('hq.none'))}</p>${offerDemo(app, entries) ? demoCta() : ''}</div>`}</section>` +
    `<section class="pp-section"><h2 class="pp-section__title">${esc(t('batch.built'))}</h2>${gov.batches.length ? `<div class="list">${gov.batches.slice().reverse().map((b) => batchRow(b, gov)).join('')}</div>` : `<p class="hint">${esc(t('batch.none'))}</p>`}</section>`;
  $('#batchBuild')?.addEventListener('click', async () => {
    if (!(await confirmBox(t('batch.confirm', { n: cand.length, a: fx(acres) }), 'batch.build_short'))) return;
    try { await G.buildBatch(lvl(), cand, S.payableOf); await signedInline($('#batchBuild')); showBatch(); } catch (err) { toast(err.message, 5000); }
  });
}
function batchRow(b, gov) {
  const min = gov.log.filter((x) => x.type === 'minutes' && x.body.batchId === b.body.id).at(-1);
  return `<a class="item" href="#dlec"><span class="ic">${icon('layers')}</span><span class="grow"><b class="mono">${esc(b.body.id)}</b><small>${esc(t('batch.row', { n: b.body.n, a: fx(b.body.acres) }))} · ${esc(fmtDate(b.t))}</small>
    <small>${esc(min ? t('batch.minuted', { d: min.body.date, ap: min.body.approved.length, rt: min.body.returned.length }) : t('batch.open'))}</small></span>${icon('chevron-right')}</a>`;
}
const SV = { N: 'sat_NOT_BURNED', B: 'sat_BURN_SUSPECTED', I: 'sat_INCONCLUSIVE' };
function evidenceTable(list, { select = false } = {}) {
  return `<div class="table-wrap"><table class="tbl ev"><thead><tr>${select ? `<th><span class="pp-sr-only">${esc(t('dlec.select'))}</span></th>` : ''}<th>${esc(t('field'))}</th><th class="is-num">${esc(t('pay.payable'))}</th><th>${esc(t('dlec.evidence'))}</th></tr></thead><tbody>
    ${list.map((e) => {
      const p = e.payload, g = e.gov || {}, lastVisit = g.visits?.at?.(-1);
      const bits = [t(SV[p.sv] || 'ui.sat_not_in_qr') + (isSynthSat(e) ? ' (' + t('dlec.synthetic') + ')' : ''), t('stage.' + e.stage.stage),
        g.decision ? `${t('dec.' + g.decision.code)}: ${t('rsn.' + g.decision.reason)}` : t('dlec.no_decision'), lastVisit ? t('vo.' + lastVisit.body.outcome) : null,
        (p.f || []).includes('SELF_OPERATED') ? t('flag.SELF_OPERATED') : null, g.dlec ? `DLEC: ${t('dlec.' + g.dlec)}` : null].filter(Boolean);
      // UX-3: nothing is pre-ticked (no rubber stamp); the 44×44 label around the box is the tap target
      return `<tr>${select ? `<td class="ev-pick"><label class="dlec-hit"><input type="checkbox" class="dlec-pick" value="${esc(p.id)}" aria-label="${esc(t('dlec.select_one', { f: p.fl }))}"></label></td>` : ''}<td class="ev-field"><a href="#case/${esc(p.id)}" class="cell-field__name">${esc(p.fl)}</a><span class="sub mono">${esc(p.id)}</span></td>
        <td class="is-num ev-acres">${esc(fx(S.payableOf(p).pa))}<span class="sub">${esc(t('dlec.of_ra', { a: p.ra == null ? '–' : fx(p.ra) }))}</span></td><td class="ev-ev"><span class="ev-bits">${bits.map((x) => esc(x)).join(' · ')}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ---------------- DLEC: batch review, decisions, signed minutes, HQ export ----------------
export async function showDlec() {
  const el = $('#dlecBody');
  el.innerHTML = head(t('dlec.title'), t('dlec.ctx')) + sk;
  const { entries, gov } = await claims();
  const batch = gov.batches.at(-1);
  if (!batch) { el.innerHTML = head(t('dlec.title'), t('dlec.ctx')) + `<div class="empty">${icon('layers')}<p>${esc(t('dlec.no_batch'))}</p>${offerDemo(app, entries) ? demoCta(true) : ''}</div>`; return; }
  const ids = new Set(batch.body.items.map((x) => x.certId));
  const list = entries.filter((e) => ids.has(e.payload?.id));
  const minutes = gov.log.filter((x) => x.type === 'minutes' && x.body.batchId === batch.body.id).at(-1);
  const approved = list.filter((e) => e.gov?.dlec === 'APPROVED');
  const canD = can('dlec');
  const loaded = demoLoadedNote();
  el.innerHTML = head(t('dlec.title'), t('dlec.ctx_b', { id: batch.body.id, n: list.length, a: fx(batch.body.acres) }),
    approved.length ? `<button type="button" class="btn btn-ghost btn-dense" id="dlecExport">${icon('download')}<span>${esc(t('dlec.export', { n: approved.length }))}</span></button>` : '') + `
    ${loaded ? loaded + `<p class="hint">${esc(t('dist.demo_batch_note'))}</p>` : ''}
    ${minutes ? `<div class="done-state">${illusImg('dlec-approved') ? `<div class="illus-slot illus-slot--card">${illusImg('dlec-approved')}</div>` : ''}<p class="pp-status pp-status--ok">${icon('circle-check')}<b>${esc(t('dlec.done_title'))}</b></p><p class="hint">${esc(t('dlec.done_body', { ap: minutes.body.approved.length, rt: minutes.body.returned.length }))}</p></div>` : ''}
    <p class="hint">${esc(t('dlec.principle'))}</p>
    ${evidenceTable(list, { select: canD && !minutes })}
    ${canD && !minutes ? `<div class="row wrap dlec-actions"><button type="button" class="btn btn-primary btn-dense" id="dlecApprove">${esc(t('dlec.approve_sel'))}</button><button type="button" class="btn btn-ghost btn-dense" id="dlecApproveAll">${esc(t('dlec.approve_all'))}</button>
      <select id="dlecReturnReason" class="inp dlec-reason" aria-label="${esc(t('dec.reason'))}">${G.DLEC_CODES.RETURNED.map((r) => `<option value="${r}">${esc(t('dlecr.' + r))}</option>`).join('')}</select><button type="button" class="btn btn-ghost btn-dense" id="dlecReturn">${esc(t('dlec.return_sel'))}</button></div>` : ''}
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('min.title'))}</h2>${minutes ? `<dl class="pp-dl">
        <div><dt>${esc(t('min.date'))}</dt><dd>${esc(minutes.body.date)}</dd></div><div><dt>${esc(t('min.members'))}</dt><dd>${minutes.body.members.map((m) => esc(m)).join('<br>')}</dd></div>
        <div><dt>${esc(t('min.decisions'))}</dt><dd>${esc(t('min.counts', { ap: minutes.body.approved.length, rt: minutes.body.returned.length }))}</dd></div>
        ${minutes.body.note ? `<div><dt>${esc(t('min.note'))}</dt><dd>${esc(minutes.body.note)}</dd></div>` : ''}<div><dt>${esc(t('min.signed'))}</dt><dd class="mono">${esc(minutes.kid)}<small>${esc(String(minutes.h).slice(0, 16))} · ${esc(fmtDate(minutes.t))}</small></dd></div></dl>`
      : canD ? `<div class="pp-field"><label class="pp-label" for="minDate">${esc(t('min.date'))}</label><input id="minDate" class="inp" type="date" value="${localDay()}"></div>
        <div class="pp-field"><label class="pp-label" for="minMembers">${esc(t('min.members'))}</label><textarea id="minMembers" class="inp" rows="3" maxlength="600" placeholder="${esc(t('min.members_ph'))}"></textarea><p class="hint">${esc(t('min.members_hint'))}</p></div>
        <div class="pp-field"><label class="pp-label" for="minNote">${esc(t('min.note'))}</label><textarea id="minNote" class="inp" rows="2" maxlength="280"></textarea></div>
        <button type="button" class="btn btn-primary btn-xxl" id="minSign">${icon('lock')}<span>${esc(t('min.sign'))}</span></button>` : `<p class="hint">${esc(t('dlec.only'))}</p>`}</section>`;
  const picked = () => [...el.querySelectorAll('.dlec-pick:checked')].map((x) => x.value);
  const act = async (codes, code, reason) => {
    if (!codes.length) { toast(t('dlec.select')); return; }
    if (!(await confirmBox(t(code === 'APPROVED' ? 'dlec.confirm_ap' : 'dlec.confirm_rt', { n: codes.length }), code === 'APPROVED' ? 'dlec.approve_sel' : 'dlec.return_sel'))) return;
    try { await G.dlecDecide(lvl(), batch.body.id, codes, code, reason); await signedInline(btn); showDlec(); } catch (err) { toast(err.message, 5000); }
  };
  let btn = null;
  $('#dlecApprove')?.addEventListener('click', (e) => { btn = e.currentTarget; act(picked(), 'APPROVED', 'EVIDENCE_OK'); });
  $('#dlecApproveAll')?.addEventListener('click', (e) => { btn = e.currentTarget; act(list.filter((x) => !x.gov?.dlec).map((x) => x.payload.id), 'APPROVED', 'EVIDENCE_OK'); });
  $('#dlecReturn')?.addEventListener('click', (e) => { btn = e.currentTarget; act(picked(), 'RETURNED', $('#dlecReturnReason').value); });
  // live count on the approve button, so it is clear what will be signed
  const count = () => { const n = picked().length; const a = $('#dlecApprove'); if (a) a.textContent = n ? t('dlec.approve_n', { n }) : t('dlec.approve_sel'); };
  el.querySelectorAll('.dlec-pick').forEach((x) => x.addEventListener('change', count));
  $('#minSign')?.addEventListener('click', async () => {
    try { await G.signMinutes(lvl(), batch.body.id, { date: $('#minDate').value, members: $('#minMembers').value, note: $('#minNote').value }); await signedInline($('#minSign')); showDlec(); } catch (err) { toast(err.message, 5000); }
  });
  $('#dlecExport')?.addEventListener('click', () => {
    const ex = activeProfile()?.export;
    downloadText(`paraliproof-HQ-upload-${batch.body.id}-${ex?.format || 'PROPOSED-FORMAT'}.csv`, S.hqCSV(approved, app.settings.rate, { batchId: batch.body.id, ...(ex ? { columns: ex.columns, format: ex.format, noCash: noCashScheme() } : {}) }), 'text/csv');
    toast(t('hq.done', { n: approved.length }), 4000);
  });
}
