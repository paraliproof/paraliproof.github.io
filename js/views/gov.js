// views/gov.js — the government screens (Phase 2): claim queue, case view + signed decision, random audit,
// village visit list + offline visit report, SDAO approvals (two-person enrolment), signed log.
// DOM contract: #v-queue #queueBody · #v-case #caseBody · #v-audit #auditBody · #v-visits #visitsBody ·
//   #v-visit #visitBody · #v-approvals #approvalsBody · #v-log #logBody (each renders its own header).
// Data: gov.loadGov() + services.dashboardEntries(settings, gov). Every value from a certificate, a file or
// the log is escaped (review F-02). Nothing here pays or rejects: each action is a person's signed decision.

import * as S from '../services.js';
import * as G from '../gov.js';
import { FLAG_INFO } from '../flags.js';
import { levelOf, levelName, hasPower, roleTable } from '../govroles.js';
import { $, t, esc, toast, fx, fint, getLang, confirmBox, signedInline } from '../ui.js';
import { offerDemo, demoCta, demoLoadedNote } from './district.js';
import { illusImg } from '../illus.js';
// slot 8 (empty queue / visits / approvals): the picture replaces the icon only when its file exists
const emptyPic = (ic) => { const p = illusImg('empty-queue'); return p ? `<div class="illus-slot illus-slot--empty">${p}</div>` : icon(ic); };
import { icon } from '../icons.js';
import { flagsHTML } from './record.js';
import { fmtDate, downloadText } from '../util.js';
import { machineDayTotals, machineOf, dayOf, DEFAULT_CAPACITY } from '../crosscheck.js';

let app;
export function init(a) { app = a; }

// ---------------- shared ----------------
const lvl = () => levelOf(app.settings);
const can = (p) => hasPower(lvl(), p);
const lname = (id = lvl()) => (id ? levelName(id, getLang()) : t('role.officer'));
const head = (title, ctx, action = '') => `<div class="pp-head"><p class="pp-head__eyebrow">${esc(lname())}</p><h1 class="pp-head__title">${esc(title)}</h1>
  ${ctx ? `<p class="pp-head__context">${esc(ctx)}</p>` : ''}${action ? `<div class="pp-head__action">${action}</div>` : ''}</div>`;
const noLevel = () => `<div class="pp-notice">${icon('info')}<span class="grow"><span class="pp-notice__title">${esc(t('gov.no_level'))}</span><a class="btn btn-ghost btn-dense" href="#settings">${esc(t('nav.more'))}</a></span></div>`;
const days = (e) => Math.max(0, Math.floor((Date.now() - Number(e.payload?.t1 || 0) * 1000) / 864e5));
const sk = () => '<div class="skeleton"></div><div class="skeleton"></div>';
let cache = null;
async function claims() {
  const gov = await G.loadGov();
  const entries = await S.dashboardEntries(app.settings, gov);
  cache = { gov, entries };
  return cache;
}
const PR_KEY = ['pr.burn', 'pr.high', 'pr.self', 'pr.audit', 'pr.other'];
const rdText = (e) => t('rdr.' + (e.ready?.reason || 'SAT_PENDING'));
const satSynthetic = (e) => !!(e.ext?.satellite?.synthetic || e.ext?.satellite?.source === 'synthetic-demo');
function claimRow(e, pr, href = '#case/' + e.payload.id) {
  const p = e.payload;
  return `<a class="item" href="${esc(href)}"><span class="ic">${icon(pr === 0 ? 'flame' : pr === 1 ? 'warning' : pr === 2 ? 'user' : pr === 3 ? 'search' : 'info')}</span>
    <span class="grow"><b>${esc(p.fl)}</b><small><span class="mono">${esc(p.id)}</span> · ${esc(t(PR_KEY[pr] || 'pr.other'))} · ${esc(t('gov.days', { n: days(e) }))}${p.demo ? ' · ' + esc(t('ui.demo')) : ''}</small><small>${esc(rdText(e))}</small></span>
    <b class="big">${esc(fx(S.payableOf(p).pa))} ac</b>${icon('chevron-right')}</a>`;
}

// ---------------- claim queue (G-4) ----------------
export async function showQueue() {
  const el = $('#queueBody');
  if (!lvl()) { el.innerHTML = head(t('gov.queue'), '') + noLevel(); return; }
  el.innerHTML = head(t('gov.queue'), t('gov.queue_ctx')) + sk();
  const { entries } = await claims();
  const q = G.claimQueue(entries, FLAG_INFO);
  const counts = [0, 1, 2, 3, 4].map((i) => q.open.filter((x) => x.pr === i).length);
  el.innerHTML = head(t('gov.queue'), t('gov.queue_ctx2', { n: q.open.length })) + demoLoadedNote() +
    `<div class="kpis kpis-4">${[0, 1, 2, 3].map((i) => `<div class="kpi"><small>${esc(t(PR_KEY[i]))}</small><b>${esc(counts[i])}</b></div>`).join('')}</div>` +
    (q.open.length ? `<section class="pp-section"><h2 class="pp-section__title">${esc(t('gov.open'))}</h2><div class="list">${q.open.map(({ e, pr }) => claimRow(e, pr)).join('')}</div></section>`
      : `<div class="empty">${entries.length ? emptyPic('circle-check') : icon('circle-check')}<p>${esc(t(entries.length ? 'gov.queue_empty' : 'gov.no_claims'))}</p>${offerDemo(app, entries) ? demoCta() : ''}</div>`) +
    (q.decided.length ? `<details class="card"><summary class="pp-section__title">${esc(t('gov.decided', { n: q.decided.length }))}</summary><div class="list">${q.decided.map(({ e, pr }) => claimRow(e, pr)).join('')}</div></details>` : '');
}

// ---------------- case view + decision (G-7) ----------------
const DEC_ICON = { VERIFIED: 'circle-check', NEEDS_VISIT: 'pin', RETURNED: 'undo', REFER_SDM: 'flag' };
export async function showCase(id) {
  const el = $('#caseBody');
  el.innerHTML = head(t('gov.case'), '') + sk();
  const { entries, gov } = await claims();
  const e = entries.find((x) => x.payload?.id === id);
  if (!e) { el.innerHTML = head(t('gov.case'), t('certNotFound')); return; }
  const p = e.payload, pa = S.payableOf(p), g = e.gov || { decisions: [], visits: [] };
  const codes = [...(Array.isArray(p.f) ? p.f : []), ...(e.extra || [])].filter((c) => c !== 'DEMO');
  const SV = { N: 'sat_NOT_BURNED', B: 'sat_BURN_SUSPECTED', I: 'sat_INCONCLUSIVE' };
  const mdt = machineDayTotals(entries).get(machineOf(e) + '|' + dayOf(p.t0));
  const cap = (app.settings.capacity || DEFAULT_CAPACITY)[p.im];
  const verdictKey = { VALID_TRUSTED: 'VALID', VALID_FLAGGED: 'ui.verdict_warn', VALID_UNTRUSTED: 'ui.verdict_untrusted' }[e.verdict] || 'TAMPERED';
  const dl = (k, v, small = '') => `<div><dt>${esc(k)}</dt><dd>${v}${small ? `<small>${small}</small>` : ''}</dd></div>`;
  const a = g.auditInfo;
  const visits = await Promise.all((g.visits || []).map(async (v) => ({ v, photo: v.body.photoHash ? await G.visitPhoto(v.body.photoHash) : null })));
  el.innerHTML = head(t('gov.case'), `${p.fl} · ${p.id}`, `<a class="btn btn-ghost btn-dense" href="#cert/${esc(p.id)}">${esc(t('viewCert'))}</a>`) + `
    <div class="pp-verdict" data-verdict="${e.ready?.ready ? 'valid' : e.status === 'VALID' ? 'warn' : 'tampered'}"><h2 class="pp-verdict__line">${icon(e.ready?.ready ? 'circle-check' : 'circle-alert')}<span>${esc(t('rd.' + (e.ready?.bucket || 'REVIEW')))}</span></h2>
      <p class="pp-head__context">${esc(rdText(e))}</p></div>
    ${latestDecision(g)}
    ${can('decide') ? decisionForm() : `<p class="hint">${esc(t('gov.cannot_decide'))}</p>`}
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('gov.evidence'))}</h2><dl class="pp-dl">
      ${dl(t('gov.signature'), esc(t(verdictKey)), esc(t(e.trusted ? 'ui.reason_registered' : 'ui.reason_unregistered')))}
      ${dl(t('pay.payable'), `<span class="pp-num">${esc(fx(pa.pa))} ac</span>`, esc(t('gov.three', { c: fx(pa.C), b: fx(pa.B), a: pa.A == null ? '–' : fx(pa.A) })))}
      ${dl(t('stage.title'), esc(t('stage.' + e.stage.stage)), esc(e.stage.note ? t('stage.note_' + e.stage.note) : t('stage.' + e.stage.stage + '_sub')))}
      ${dl(t('satCheck'), esc(SV[p.sv] ? t(SV[p.sv]) : t('ui.sat_not_in_qr')), satSynthetic(e) ? esc(t('gov.sat_synthetic')) : esc(e.ext?.satellite?.field_name || ''))}
      ${dl(t('fm.title'), esc(t(p.fm ? 'fm.' + p.fm : 'fm.none')))}
      ${p.jh ? dl(t('sslip.source'), esc(t(p.ss === 'S' ? 'sslip.src_S' : p.ss === 'F' ? 'sslip.src_F' : 'sslip.src_none')), p.sp ? esc(p.sp) : '') : ''}
      ${dl(t('farmer.machine_src'), esc(p.ws === 'S' ? t('farmer.ws_S') : p.ws === 'M' ? t('farmer.ws_M') : t('farmer.ws_none')), mdt != null ? esc(t('gov.machine_day', { a: fx(mdt), cap: fint(cap) })) : '')}
      ${dl(t('gov.self'), esc(t(codes.includes('SELF_OPERATED') ? 'gov.self_yes' : 'gov.self_no')))}
      ${e.slipGroup ? dl(t('flag.SLIP_REUSED'), esc(t('slipgroup.text', { n: e.slipGroup.n, total: fx(e.slipGroup.total), ra: fx(e.slipGroup.ra), cap: fx(e.slipGroup.cap) }))) : ''}
      ${dl(t('gov.audit'), a ? esc(t(a.picked ? 'gov.audit_picked' : 'gov.audit_not')) : esc(t('gov.audit_noseed')), a ? esc(t('gov.audit_how', { s: a.score.toFixed(4), r: Math.round(a.rate * 100) })) : '')}
      ${dl(t('date'), esc(fmtDate(Number(p.t0) * 1000)), esc(t('gov.days', { n: days(e) })))}
    </dl></section>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('integrityFlags'))}</h2><div>${flagsHTML(codes, { withCodes: true })}</div></section>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('gov.visits'))}</h2>${visits.length ? visits.map(({ v, photo }) => `<div class="pp-card gov-visit">
        <p><b>${esc(t('vo.' + v.body.outcome))}</b> · ${esc(fmtDate(v.t))} · ${esc(levelName(v.level, getLang()))}</p>
        ${v.body.notes ? `<p class="hint">${esc(v.body.notes)}</p>` : ''}
        <p class="hint">${v.body.gps ? esc(t('vis.gps_at', { lat: v.body.gps.lat, lon: v.body.gps.lon, acc: v.body.gps.acc ?? '?' })) : esc(t('vis.no_gps'))}</p>
        ${photo ? `<img class="gov-photo" alt="${esc(t('vis.photo'))}" src="${esc(photo)}">` : ''}
        <p class="hint mono">${esc(t('gov.signed_by', { kid: v.kid, h: v.h.slice(0, 12) }))}</p></div>`).join('') : `<p class="hint">${esc(t('gov.no_visits'))}</p>`}
      ${can('visit') ? `<a class="btn btn-ghost" href="#visit/${esc(p.id)}">${esc(t('vis.file'))}</a>` : ''}</section>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('gov.history'))}</h2>${(g.decisions || []).length ? `<div class="list">${g.decisions.slice().reverse().map((d) => `<div class="item">${icon(DEC_ICON[d.body.code] || 'info')}<span class="grow"><b>${esc(t('dec.' + d.body.code))} · ${esc(t('rsn.' + d.body.reason))}</b>
        <small>${esc(levelName(d.level, getLang()))} · ${esc(fmtDate(d.t))}${d.body.due ? ' · ' + esc(t('dec.sdm_due', { d: d.body.due })) : ''}</small>${d.body.note ? `<small>${esc(d.body.note)}</small>` : ''}<small class="mono">${esc(t('gov.signed_by', { kid: d.kid, h: d.h.slice(0, 12) }))}</small></span></div>`).join('')}</div>`
      : `<p class="hint">${esc(t('gov.no_decisions'))}</p>`}${g.dlec ? `<p class="hint">${esc(t('gov.dlec_result', { c: t('dlec.' + g.dlec), b: g.dlecBatch || '' }))}</p>` : ''}</section>`;
  if (can('decide')) wireDecision(p.id);
}
/** UX-3: the decision comes first on a claim; the last signed decision is one line above the form. */
function latestDecision(g) {
  const d = (g.decisions || []).at(-1);
  if (!d) return '';
  return `<p class="pp-status pp-status--ok case-latest">${icon(DEC_ICON[d.body.code] || 'info')}<span><b>${esc(t('gov.latest'))}:</b> ${esc(t('dec.' + d.body.code))} · ${esc(t('rsn.' + d.body.reason))} · ${esc(fmtDate(d.t))}</span></p>`;
}
function decisionForm() {
  return `<section class="pp-section gov-decide"><h2 class="pp-section__title">${esc(t('dec.title'))}</h2>
    <p class="hint">${esc(t('dec.hint'))}</p>
    <div class="gov-choices" role="radiogroup" aria-label="${esc(t('dec.title'))}">${Object.keys(G.DECISIONS).map((c) => `<label class="pp-row gov-choice"><input type="radio" name="decCode" value="${c}"><span class="pp-row__main"><span class="pp-row__title">${esc(t('dec.' + c))}</span><span class="pp-row__meta">${esc(t('dec.' + c + '_sub'))}</span></span></label>`).join('')}</div>
    <div class="pp-field"><label class="pp-label" for="decReason">${esc(t('dec.reason'))}</label><select id="decReason" class="inp" disabled><option value="">${esc(t('dec.pick_first'))}</option></select></div>
    <div class="pp-field"><label class="pp-label" for="decNote">${esc(t('dec.note'))}</label><textarea id="decNote" class="inp" rows="2" maxlength="280"></textarea></div>
    <button type="button" class="btn btn-primary btn-xxl" id="decSign">${icon('lock')}<span>${esc(t('dec.sign'))}</span></button></section>`;
}
function wireDecision(certId) {
  const rs = $('#decReason');
  document.querySelectorAll('input[name="decCode"]').forEach((r) => r.addEventListener('change', () => {
    rs.innerHTML = G.DECISIONS[r.value].map((x) => `<option value="${x}">${esc(t('rsn.' + x))}</option>`).join(''); rs.disabled = false;
  }));
  $('#decSign').addEventListener('click', async () => {
    const code = document.querySelector('input[name="decCode"]:checked')?.value;
    if (!code) { toast(t('dec.pick_first')); return; }
    if (!(await confirmBox(t('dec.confirm', { d: t('dec.' + code), r: t('rsn.' + rs.value) }), 'dec.sign'))) return;
    try { await G.decide(lvl(), certId, code, rs.value, $('#decNote').value); await signedInline($('#decSign')); showCase(certId); } catch (err) { toast(err.message, 5000); }
  });
}

// ---------------- provable random audit (G-8) ----------------
export async function showAudit() {
  const el = $('#auditBody');
  if (!lvl()) { el.innerHTML = head(t('gov.audit'), '') + noLevel(); return; }
  el.innerHTML = head(t('gov.audit'), t('aud.ctx')) + sk();
  const { entries, gov } = await claims();
  const seed = gov.seed;
  const valid = entries.filter((e) => e.status === 'VALID');
  const picked = valid.filter((e) => e.gov?.audit);
  const seedForm = can('seed') ? `<div class="row wrap gov-rates"><label class="lbl inline">${esc(t('aud.rate'))} <input id="audRate" class="inp small" type="number" min="0" max="100" step="1" value="${Math.round((app.settings.auditRate ?? 0.05) * 100)}"> %</label>
      <label class="lbl inline">${esc(t('aud.rate_self'))} <input id="audRateSelf" class="inp small" type="number" min="0" max="100" step="1" value="${Math.round((app.settings.auditRateSelf ?? 0.2) * 100)}"> %</label></div>
      <button type="button" class="btn ${seed ? 'btn-ghost' : 'btn-primary'}" id="audCommit">${esc(t(seed ? 'aud.recommit' : 'aud.commit'))}</button>` : `<p class="hint">${esc(t('aud.dda_only'))}</p>`;
  // UX-2 / GV-6: one plain line first; the seed, commitment, rule and re-check sit in one disclosure (body font)
  el.innerHTML = head(t('gov.audit'), t('aud.ctx')) + demoLoadedNote() + (seed ? `
    <p class="aud-summary">${esc(t('aud.summary', { n: picked.length, m: valid.length, r: Math.round(seed.rate * 100), rs: Math.round(seed.selfRate * 100) }))}</p>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('aud.list'))}</h2>${picked.length ? `<div class="list">${picked.map((e) => `<a class="item" href="#case/${esc(e.payload.id)}"><span class="ic">${icon('search')}</span><span class="grow"><b>${esc(e.payload.fl)}</b><small>${esc(t('rdr.AUDIT'))}</small>${e.gov.auditInfo.self ? `<small>${esc(t('flag.SELF_OPERATED'))}</small>` : ''}</span>${icon('chevron-right')}</a>`).join('')}</div>` : `<p class="hint">${esc(t('aud.none'))}</p>`}</section>
    <details class="card aud-proof"><summary class="pp-section__title">${esc(t('aud.proof'))}</summary>
      <dl class="pp-dl">
        <div><dt>${esc(t('aud.season'))}</dt><dd>${esc(seed.season)}<small>${esc(fmtDate(seed.setAt))}</small></dd></div>
        <div><dt>${esc(t('aud.rates'))}</dt><dd class="pp-num">${esc(Math.round(seed.rate * 100))} % · ${esc(t('flag.SELF_OPERATED'))} ${esc(Math.round(seed.selfRate * 100))} %</dd></div>
      </dl>
      <p class="aud-val"><b>${esc(t('aud.seed'))}</b><span class="mono gov-wrap">${esc(seed.seed)}</span></p>
      <p class="aud-val"><b>${esc(t('aud.commitment'))}</b><span class="mono gov-wrap">${esc(seed.commit)}</span><span class="hint">${esc(t('aud.commit_note'))}</span></p>
      <p class="hint">${esc(t('aud.formula'))}</p>
      ${picked.length ? `<ul class="aud-scores">${picked.map((e) => `<li><span class="mono">${esc(e.payload.id)}</span> · ${esc(t('aud.score', { s: e.gov.auditInfo.score.toFixed(4), r: Math.round(e.gov.auditInfo.rate * 100) }))}</li>`).join('')}</ul>` : ''}
      <div class="row wrap"><button type="button" class="btn btn-ghost btn-dense" id="audCheck">${esc(t('aud.rederive'))}</button><span class="hint" id="audCheckOut" role="status"></span></div>
    </details>
    ${seedForm}`
    : `<div class="pp-notice">${icon('info')}<span class="grow"><span class="pp-notice__title">${esc(t('aud.no_seed'))}</span></span></div>${offerDemo(app, entries) ? `<div class="empty">${demoCta()}</div>` : ''}${seedForm}<details class="card aud-proof"><summary class="pp-section__title">${esc(t('aud.proof'))}</summary><p class="hint">${esc(t('aud.formula'))}</p></details>`);
  $('#audCommit')?.addEventListener('click', async () => {
    const rate = Number($('#audRate').value) / 100, selfRate = Number($('#audRateSelf').value) / 100;
    if (seed && !(await confirmBox(t('aud.recommit_confirm'), 'aud.recommit'))) return;
    try { await G.commitSeed(lvl(), { rate, selfRate }); app.settings.auditRate = rate; app.settings.auditRateSelf = selfRate; await S.saveSettings(app.settings); await signedInline($('#audCommit')); showAudit(); } catch (err) { toast(err.message, 5000); }
  });
  $('#audCheck')?.addEventListener('click', async () => {
    // independent re-derivation from the shown seed, exactly as anyone else would do it
    let same = 0;
    for (const e of valid) { const s = await G.auditScore(seed.seed, e.payload.id); if ((s < G.auditRateFor(e, seed)) === !!e.gov?.audit) same++; }
    $('#audCheckOut').textContent = t(same === valid.length ? 'aud.match' : 'aud.nomatch', { n: same, m: valid.length }); // inline, next to the button (UX-3)
  });
}

// ---------------- village: visit list + offline report (G-6) ----------------
export async function showVisits() {
  const el = $('#visitsBody');
  if (!lvl()) { el.innerHTML = head(t('gov.visits'), '') + noLevel(); return; }
  el.innerHTML = head(t('gov.visits'), t('vis.ctx')) + sk();
  const { entries, gov } = await claims();
  const list = G.visitList(entries);
  const recent = gov.log.filter((x) => x.type === 'visit').slice(-8).reverse();
  el.innerHTML = head(t('gov.visits'), t('vis.ctx2', { n: list.length })) + demoLoadedNote() +
    (list.length ? `<div class="list">${list.map((e) => claimRow(e, G.queuePriority(e, FLAG_INFO), '#visit/' + e.payload.id)).join('')}</div>` : `<div class="empty">${entries.length ? emptyPic('circle-check') : icon('circle-check')}<p>${esc(t(entries.length ? 'vis.none' : 'gov.no_claims'))}</p>${offerDemo(app, entries) ? demoCta() : ''}</div>`) +
    (recent.length ? `<section class="pp-section"><h2 class="pp-section__title">${esc(t('vis.recent'))}</h2><div class="list">${recent.map((v) => `<a class="item" href="#case/${esc(v.body.certId)}"><span class="ic">${icon('pin')}</span><span class="grow"><b>${esc(t('vo.' + v.body.outcome))}</b><small class="mono">${esc(v.body.certId)} · ${esc(fmtDate(v.t))}</small><small>${esc(v.body.gps ? t('vis.gps_short') : t('vis.no_gps'))}</small></span></a>`).join('')}</div></section>` : '');
}

let visitGps = null, visitPhoto = null;
export async function showVisit(id) {
  const el = $('#visitBody');
  visitGps = null; visitPhoto = null;
  const { entries } = cache || await claims();
  const e = entries.find((x) => x.payload?.id === id);
  if (!e) { el.innerHTML = head(t('vis.report'), t('certNotFound')); return; }
  if (!can('visit')) { el.innerHTML = head(t('vis.report'), `${e.payload.fl} · ${e.payload.id}`) + `<p class="hint">${esc(t('vis.village_only'))}</p>`; return; }
  el.innerHTML = head(t('vis.report'), `${e.payload.fl} · ${e.payload.id}`) + `
    <p class="hint">${esc(t('vis.offline'))}</p>
    <div class="pp-field"><span class="pp-label">${esc(t('vis.outcome'))}</span><div class="gov-choices" role="radiogroup">${G.VISIT_OUTCOMES.map((o) => `<label class="pp-row gov-choice"><input type="radio" name="visOut" value="${o}"><span class="pp-row__main"><span class="pp-row__title">${esc(t('vo.' + o))}</span></span></label>`).join('')}</div></div>
    <div class="pp-field"><label class="pp-label" for="visNotes">${esc(t('vis.notes'))}</label><textarea id="visNotes" class="inp" rows="3" maxlength="500"></textarea></div>
    <div class="pp-field"><span class="pp-label">${esc(t('vis.photo'))}</span><p class="hint">${esc(t('vis.photo_hint'))}</p>
      <label class="btn btn-ghost btn-dense file-btn">${icon('plus')}<span>${esc(t('vis.photo_add'))}</span><input type="file" accept="image/*" capture="environment" id="visPhoto" hidden></label><div id="visPreview"></div></div>
    <div class="pp-field"><span class="pp-label">${esc(t('vis.location'))}</span><p class="pp-row__meta" id="visGps">${esc(t('vis.gps_wait'))}</p></div>
    <button type="button" class="btn btn-primary btn-xxl" id="visSign">${icon('lock')}<span>${esc(t('vis.sign'))}</span></button>`;
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => { visitGps = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }; $('#visGps') && ($('#visGps').textContent = t('vis.gps_at', { lat: visitGps.lat.toFixed(5), lon: visitGps.lon.toFixed(5), acc: Math.round(visitGps.acc) })); },
    () => { $('#visGps') && ($('#visGps').textContent = t('vis.no_gps')); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  else $('#visGps').textContent = t('vis.no_gps');
  $('#visPhoto').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try { visitPhoto = await downscale(f); $('#visPreview').innerHTML = `<img class="gov-photo" alt="${esc(t('vis.photo'))}" src="${esc(visitPhoto)}">`; } catch { toast(t('vis.photo_bad')); }
  });
  $('#visSign').addEventListener('click', async () => {
    const outcome = document.querySelector('input[name="visOut"]:checked')?.value;
    if (!outcome) { toast(t('vis.outcome')); return; }
    try {
      await G.fileVisit(lvl(), id, { outcome, notes: $('#visNotes').value, photo: visitPhoto, gps: visitGps }); await signedInline($('#visSign'));
      // slot 10: a success state after signing (not on the form); the picture only if its file exists
      const left = G.visitList((await claims()).entries).length;
      el.innerHTML = head(t('vis.report'), `${e.payload.fl} · ${e.payload.id}`) + `<div class="done-state">${illusImg('visit-done') ? `<div class="illus-slot illus-slot--card">${illusImg('visit-done')}</div>` : ''}
        <p class="pp-status pp-status--ok">${icon('circle-check')}<b>${esc(t('vis.done_title'))}</b></p><p class="hint">${esc(t('vis.done_body', { n: left }))}</p>
        <a class="btn btn-primary btn-xxl" href="#visits">${esc(t('vis.back'))}</a><a class="btn btn-ghost" href="#case/${esc(id)}">${esc(t('vis.see_claim'))}</a></div>`;
    } catch (err) { toast(err.message, 5000); }
  });
}
/** Photo → JPEG data URL, longest side ≤ 960 px (no EXIF/location kept: the canvas drops metadata). */
async function downscale(file) {
  if (file.size > 25e6) throw new Error('too big');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const s = Math.min(1, 960 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let q = 0.72, out = c.toDataURL('image/jpeg', q);
    while (out.length > G.MAX_PHOTO_CHARS && q > 0.3) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
    if (out.length > G.MAX_PHOTO_CHARS) throw new Error('too big');
    return out;
  } finally { URL.revokeObjectURL(url); }
}

// ---------------- SDAO: approvals (G-2) + disputed cases ----------------
export async function showApprovals() {
  const el = $('#approvalsBody');
  if (!lvl()) { el.innerHTML = head(t('gov.approvals'), '') + noLevel(); return; }
  const keys = app.settings.trustedKeys || [];
  const pending = keys.filter((k) => k.status === 'pending');
  el.innerHTML = head(t('gov.approvals'), t('appr.ctx')) + sk();
  const { entries } = await claims();
  const disputed = entries.filter((e) => ['REFER_SDM', 'RETURNED'].includes(e.gov?.decision?.code));
  el.innerHTML = head(t('gov.approvals'), t('appr.ctx')) + `
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('appr.pending', { n: pending.length }))}</h2>
    ${demoLoadedNote()}${pending.length ? `<div class="pp-card pp-card--flush">${pending.map((k) => `<div class="pp-row">${icon('phone')}<span class="pp-row__main"><span class="pp-row__title">${esc(k.chc || t('phones.unnamed'))}</span>
      <span class="pp-row__meta"><span class="mono">${esc(k.kid)}</span> · ${esc(t('appr.enrolled', { d: fmtDate(k.addedAt) }))}</span></span>
      ${can('countersign') ? `<button type="button" class="btn btn-primary btn-dense" data-pub="${esc(k.pub)}">${esc(t('appr.sign'))}</button>` : ''}</div>`).join('')}</div>` : `<div class="empty">${entries.length ? emptyPic('circle-check') : icon('circle-check')}<p>${esc(t(entries.length ? 'appr.none' : 'gov.no_claims'))}</p>${offerDemo(app, entries) ? demoCta() : ''}</div>`}
    <p class="hint">${esc(t('appr.demo_note'))}</p></section>
    <section class="pp-section"><h2 class="pp-section__title">${esc(t('appr.disputed', { n: disputed.length }))}</h2>
    ${disputed.length ? `<div class="list">${disputed.map((e) => claimRow(e, G.queuePriority(e, FLAG_INFO))).join('')}</div>` : `<p class="hint">${esc(t('appr.no_disputed'))}</p>`}</section>`;
  el.querySelectorAll('button[data-pub]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox(t('appr.confirm'), 'appr.sign'))) return;
    try { await G.countersignPhone(lvl(), app.settings, b.dataset.pub, S.saveSettings); await signedInline(b); showApprovals(); } catch (err) { toast(err.message, 5000); }
  }));
}

// ---------------- the signed log (G-16) ----------------
export async function showLog() {
  const el = $('#logBody');
  el.innerHTML = head(t('gov.log'), t('log.ctx')) + sk();
  const log = await G.readLog();
  const chk = await G.verifyLog(log);
  const sum = (x) => {
    const b = x.body || {};
    if (x.type === 'decision') return `${b.certId} · ${t('dec.' + b.code)} · ${t('rsn.' + b.reason)}`;
    if (x.type === 'visit') return `${b.certId} · ${t('vo.' + b.outcome)}${b.noGps ? ' · ' + t('vis.no_gps') : ''}`;
    if (x.type === 'enrol' || x.type === 'countersign') return `${b.kid} · ${b.chc || ''}`;
    if (x.type === 'audit-seed') return `${t('aud.commitment')} ${String(b.commit).slice(0, 16)}… · ${Math.round(b.rate * 100)} % / ${Math.round(b.selfRate * 100)} %`;
    if (x.type === 'batch') return `${b.id} · ${b.n} · ${fx(b.acres)} ac`;
    if (x.type === 'dlec-decision') return `${b.batchId} · ${t('dlec.' + b.code)} · ${(b.certIds || []).length}`;
    if (x.type === 'minutes') return `${b.batchId} · ${b.date} · ${(b.members || []).length} ${t('min.members_short')}`;
    return '';
  };
  el.innerHTML = head(t('gov.log'), t('log.ctx'), log.length ? `<button type="button" class="btn btn-ghost btn-dense" id="logExport">${icon('download')}<span>${esc(t('log.export'))}</span></button>` : '') + `
    <p class="pp-status pp-status--${chk.ok ? 'ok' : 'danger'}">${icon(chk.ok ? 'circle-check' : 'circle-x')}${esc(chk.ok ? t('log.ok', { n: chk.n }) : t('log.bad', { i: chk.badAt }))}</p>
    ${log.length ? `<div class="list">${log.slice().reverse().map((x) => `<div class="item"><span class="ic">${icon('hash')}</span><span class="grow"><b>${esc(t('lt.' + x.type))}</b><small>${esc(sum(x))}</small>
      <small>${esc(levelName(x.level, getLang()))} · ${esc(fmtDate(x.t))}</small><small class="mono">#${esc(x.i)} · ${esc(x.kid)} · ${esc(String(x.h).slice(0, 12))}</small></span></div>`).join('')}</div>` : `<div class="empty">${icon('hash')}<p>${esc(t('log.empty'))}</p></div>`}`;
  $('#logExport')?.addEventListener('click', () => downloadText(`paraliproof-officer-log-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ type: 'paraliproof-officer-log', v: 1, roleTable: roleTable().id, entries: log }, null, 1)));
}
