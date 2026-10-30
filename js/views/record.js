// views/record.js — RECORD tab: job setup → live recording (real sensors or demo replay) → results.
//
// DOM contract (index.html, section #v-job):
//   #jobSetup  : #homeDemo, #recoverBox, #jobField, #jobFieldInfo, #implSelect, #widthInp, #placementSel,
//                #calibStatus, #calibHintMl, #calibBtn, #demoCard, #replaySpeed, #startBtn
//   #jobLive   : #statusPill(.status--working|transit|idle), #statusIcon, #statusText, #statusConf,
//                #lvAcres, #lvCov, #lvTime, #lvSpeed, #lvAcc, #lvSpark, #lvVibTxt, #lvSensors, #jobMap,
//                #trainBox > #trainLabels [data-label=""|WORKING|TRANSIT|IDLE] (manual ML training labels), #stopBtn
//   #jobResult : #resKpis, #resMap, #resMethod, #resFlags, #slotSat (rendered, incl. #satFile attach input),
//                #slotImpact (rendered), #issueBtn, #exportJobBtn, #mlExportBtn, #newJobBtn
// Data used: services.* (fields, calibration, buildJob, issueForJob), pipeline.JobProcessor, sensors.SensorSession, sim.generateJob.

import * as S from '../services.js';
import { JobProcessor, reprocess } from '../pipeline.js';
import { WINDOW_MS } from '../features.js';
import { SensorSession, requestMotionPermission, recordAccel } from '../sensors.js';
import { sampleField, generateJob } from '../sim.js';
import { getPluginClassifier } from '../classifier.js';
import { summarizeSat, satTilesFor } from '../../plugins/sat/register.js';
import { listRealTracks, loadRealTrack, ASSUMED_ACC_M } from '../realtrack.js';
import { verifySticker, parseSlip, slipHash, qrKind } from '../qrformats.js';
import { activeProfile, profileTag } from '../profile.js';
import { scanQr } from '../scan.js';
import { FLAG_INFO } from '../flags.js';
import { haversine, ringToPolygon } from '../geo.js';
import { kv } from '../store.js';
import { $, t, L, esc, toast, openModal, closeModal, confirmBox, makeMap, STATE_COLORS, getLang, cssVar, fx, haptic } from '../ui.js';
import { ICONS, icon } from '../icons.js';
import { fmtDuration, round, downloadText, M2_PER_ACRE, fmtDate } from '../util.js';
import { illusHTML, recIllusBuild, recIllusState } from '../illus.js';

let app, run = null, resultJob = null, resultField = null, liveMap = null, resMap = null;

export function init(a) {
  app = a;
  $('#homeDemo').addEventListener('click', () => startDemoFlow());
  $('#firstDemoField').addEventListener('click', useDemoField);
  $('#scanSticker').addEventListener('click', scanStickerFlow);
  $('#scanSlip').addEventListener('click', scanSlipFlow);
  $('#clearSlip').addEventListener('click', async () => { await S.clearJobSlip(app.settings); twoScanInfo(); });
  $('#demoSrc').addEventListener('change', async () => { app.settings.demoSource = $('#demoSrc').value; await S.saveSettings(app.settings); demoSourceInfo(); });
  $('#implSelect').addEventListener('change', onImplChange);
  $('#widthInp').addEventListener('change', async () => { app.settings.widthM = Number($('#widthInp').value) || 2.2; await S.saveSettings(app.settings); });
  $('#jobField').addEventListener('change', async () => { app.settings.activeFieldId = $('#jobField').value; await S.saveSettings(app.settings); fieldInfo(); });
  $('#replaySpeed').addEventListener('change', async () => { app.settings.replaySpeed = Number($('#replaySpeed').value); await S.saveSettings(app.settings); });
  $('#calibBtn').addEventListener('click', runCalibration);
  $('#placementSel').addEventListener('change', async () => { app.settings.placement = $('#placementSel').value; await S.saveSettings(app.settings); });
  document.querySelectorAll('#trainLabels [data-label]').forEach((b) => b.addEventListener('click', () => setTrainLabel(b.dataset.label || null)));
  $('#mlExportBtn').addEventListener('click', async () => {
    downloadText(`paraliproof-recordings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await S.mlExport(app.settings)));
  });
  $('#startBtn').addEventListener('click', () => startJob());
  setupHoldToStop();
  // before the certificate exists the primary action issues it; afterwards it starts the next field (UX-1)
  $('#issueBtn').addEventListener('click', () => (resultJob?.certId ? startNextField() : issueCert()));
  $('#resCertLink').addEventListener('click', () => { if (resultJob?.certId) app.go('cert/' + resultJob.certId); });
  $('#exportJobBtn').addEventListener('click', () => {
    if (!resultJob) return;
    downloadText(`paraliproof-job-${resultJob.id}.json`, JSON.stringify(S.jobExport(resultJob, resultField, app.settings)));
  });
  $('#ownerSel').addEventListener('change', detailsSummary);
  $('#placementSel').addEventListener('change', detailsSummary);
  $('#implSelect').addEventListener('change', detailsSummary);
}

/** UX-1 "Start next field": clear the finished job and this farmer's slip/field, back to "Ready to record". */
export async function startNextField() {
  if (run) return false;
  resultJob = null; resultField = null;
  await S.resetForNextField(app.settings);
  $('#ownerSel').value = 'other';
  if (app.current === 'job') { await show(); window.scrollTo(0, 0); } else app.go('job');
  return true;
}

function showPanel(p) {
  $('#jobSetup').hidden = p !== 'setup';
  $('#jobLive').hidden = p !== 'live';
  $('#jobResult').hidden = p !== 'result';
  document.body.classList.toggle('is-focus', p === 'live'); // recording = focus mode: no top bar, no tab bar
  if (p !== 'setup' && typeof scrollTo === 'function') scrollTo(0, 0); // the live and result screens start at the top (Start sits mid-page)
}

export async function show() {
  if (run) { showPanel('live'); liveMap?.map.invalidateSize(); return; }
  if (resultJob) { renderResult(); return; } // re-render so a language change applies
  showPanel('setup');
  const fields = await S.listFields();
  const sel = $('#jobField');
  const chosen = fields.some((f) => f.id === app.settings.activeFieldId);
  // after "Start next field" nothing is pre-chosen: the next farmer's slip (or the operator) picks the field
  sel.innerHTML = fields.length ? (chosen ? '' : `<option value="">${esc(t('rec.pick_field'))}</option>`) + fields.map((f) => `<option value="${esc(f.id)}">${esc(f.label)} · ${round(f.areaM2 / M2_PER_ACRE, 2)} ac</option>`).join('')
    : `<option value="">${esc(t('noFieldsYet'))}</option>`;
  // first run: no saved field → a clear first step instead of a dead-end select (QA 29 Oct)
  $('#firstField').hidden = fields.length > 0;
  if (fields.length) illusHTML($('#firstFieldIllus'), null); else illusHTML($('#firstFieldIllus'), 'empty-fields'); // slot 6: only with no field at all
  $('#jobFieldWrap').hidden = fields.length === 0;
  const noStart = fields.length === 0 && !app.settings.demo; // one primary action: "Add your field" (demo mode brings its own field)
  $('#startWrap').hidden = noStart;
  // first run without a field: no form that has no button at the end (UX review OP-5)
  $('#jobDetails').hidden = noStart;
  if (chosen) sel.value = app.settings.activeFieldId;
  fieldInfo(fields);
  const lang = getLang();
  const allowed = activeProfile()?.methods; // a state profile lists the eligible methods
  $('#implSelect').innerHTML = app.settings.presets.filter((p) => !allowed || allowed.includes(p.code) || p.code === app.settings.implement).map((p) => `<option value="${esc(p.code)}">${esc(p[lang] || p.en)} (${p.w} m)</option>`).join('');
  $('#implSelect').value = app.settings.implement;
  $('#widthInp').value = app.settings.widthM;
  $('#replaySpeed').value = String(app.settings.replaySpeed);
  $('#demoCard').hidden = !app.settings.demo;
  demoSources();
  $('#placementSel').innerHTML = S.PLACEMENTS.map((p) => `<option value="${p}">${esc(t('pl_' + p))}</option>`).join('');
  $('#placementSel').value = app.settings.placement;
  twoScanInfo();
  // the details stay folded once a machine is set; open while something still needs the operator
  $('#jobDetails').open = !S.activeMachine(app.settings);
  detailsSummary();
  $('#jobEyebrow').textContent = new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + (app.settings.demo ? ' · ' + t('ui.demo') : '');
  await calibStatus();
  await recoverCheck();
}

/** One line under "Job details": machine and width · whose field · where the phone is. */
export function detailsSummary() {
  const m = S.activeMachine(app.settings);
  const impl = m ? implName(m.type) : null;
  const parts = [m ? `${impl} ${fx(m.w, 1)} m` : t('rec.sum_no_machine'), t($('#ownerSel').value === 'own' ? 'rec.sum_own' : 'rec.sum_hired'), t('pl_' + ($('#placementSel').value || app.settings.placement))];
  $('#jobDetailsSum').textContent = parts.join(' · ');
}

async function fieldInfo(fields) {
  fields = fields || await S.listFields();
  const f = fields.find((x) => x.id === $('#jobField').value);
  $('#jobFieldInfo').textContent = f ? `${t('ui.field_ctx', { name: f.label, acres: round(f.areaM2 / M2_PER_ACRE, 2) })} · ${round(f.areaM2 / 1e4, 2)} ha` : fields.length ? t('drawFieldFirst') : '';
}

async function onImplChange() {
  const p = app.settings.presets.find((x) => x.code === $('#implSelect').value);
  app.settings.implement = p.code; app.settings.widthM = p.w;
  $('#widthInp').value = p.w;
  await S.saveSettings(app.settings);
}

async function calibStatus() {
  const c = await S.getCalibration(app.settings.demo);
  const el = $('#calibStatus');
  const ml = getPluginClassifier();
  if (ml && app.settings.classifier !== 'threshold') {
    el.className = 'chip ok';
    el.textContent = t('rec.vib_auto'); // UX-2: no model ids on the operator's screen (they stay in Settings)
    $('#calibHintMl').hidden = false;
    return;
  }
  $('#calibHintMl').hidden = true;
  if (!c) { el.className = 'chip warn'; el.innerHTML = L('notCalibrated'); return; }
  el.className = c.separation >= 1 ? 'chip ok' : 'chip warn';
  el.textContent = `${t('calibrated')} · d=${round(c.separation, 1)} · ${c.bandHz[0]}–${c.bandHz[1]} Hz`;
}

// ---------------- calibration ----------------
async function runCalibration() {
  const demo = app.settings.demo;
  if (!demo) {
    const perm = await requestMotionPermission(); // must be first await (iOS needs the tap)
    if (perm !== 'granted') { toast(t('motionDenied')); return; }
  }
  const step = (n, key) => new Promise((resolve) => {
    const body = openModal(`<h3>${L('calibration')} — ${n}/2</h3><p>${L(key)}</p><div class="big-count" id="cdown">15</div>
      <div class="progress"><i id="cprog"></i></div><p class="hint center" id="cvib"></p>
      <div class="row end"><button class="btn btn-ghost" id="ccancel">${L('cancel')}</button><button class="btn btn-primary" id="cgo">${L('startRecording')}</button></div>`);
    body.querySelector('#ccancel').onclick = () => { closeModal(); resolve(null); };
    body.querySelector('#cgo').onclick = async () => {
      body.querySelector('#cgo').disabled = true;
      const secs = 15;
      const prog = (f, m) => {
        body.querySelector('#cprog').style.width = (100 * f) + '%';
        body.querySelector('#cdown').textContent = Math.ceil(secs * (1 - f));
        if (m != null) body.querySelector('#cvib').textContent = `|a| = ${m.toFixed(2)} m/s²`;
      };
      if (demo) { // synthetic: animate 3 s so the jury sees the step
        const t0 = performance.now();
        await new Promise((r) => { const iv = setInterval(() => { const f = Math.min(1, (performance.now() - t0) / 3000); prog(f, 9.81 + (Math.random() - .5) * (n === 1 ? 1.6 : 0.9)); if (f >= 1) { clearInterval(iv); r(); } }, 100); });
        resolve('synthetic');
      } else resolve(await recordAccel(secs, prog));
    };
  });
  const w = await step(1, 'calibStep1'); if (!w) return;
  const d = await step(2, 'calibStep2'); if (!d) return;
  try {
    const params = demo ? S.syntheticCalibration(app.settings) : S.calibrateFromRecordings(w, d, app.settings);
    await S.setCalibration(demo, params);
    if (!demo) {
      // keep the labelled calibration recording for ML retraining (schema paraliproof.recording.v1)
      const end = (r) => (r.xyz.length ? r.xyz[r.xyz.length - 1][0] + 1 : r.startEpoch);
      await S.saveCalibrationSession({
        session_id: 'cal-' + new Date(w.startEpoch).toISOString().slice(0, 19).replace(/[:T]/g, '-'),
        implement: S.IMPLEMENT_ML_NAME[app.settings.implement] || 'other', placement: app.settings.placement,
        device: { user_agent: navigator.userAgent },
        accel: [...w.xyz, ...d.xyz], gps: [...w.gps, ...d.gps],
        labels: [{ start_ms: w.startEpoch, end_ms: end(w), label: 'WORKING', source: 'calibration' },
          { start_ms: d.startEpoch, end_ms: end(d), label: 'TRANSIT', source: 'calibration' }],
      });
    }
    const good = params.separation >= 1;
    openModal(`<h3>${L(good ? 'calibDone' : 'calibWeak')}</h3>
      <table class="kv"><tr><th>${L('separation')}</th><td>d = ${round(params.separation, 2)}</td></tr>
      <tr><th>${L('bestBand')}</th><td>${params.bandHz[0]}–${params.bandHz[1]} Hz</td></tr>
      <tr><th>${L('windows')}</th><td>${params.nWorking} + ${params.nDriving}</td></tr></table>
      <p class="hint">${L('calibExplain')}</p><button class="btn btn-primary btn-xxl" id="cok">${L('ok')}</button>`).querySelector('#cok').onclick = closeModal;
  } catch (e) { closeModal(); toast(e.message); }
  calibStatus();
}

// ---------------- two-scan start: machine sticker (season) + farmer's job slip (this job) ----------------
function implName(code) { const p = app.settings.presets.find((x) => x.code === code); return p ? (p[getLang()] || p.en) : code; }
export function twoScanInfo() {
  const m = S.activeMachine(app.settings), sl = app.settings.jobSlip;
  $('#machineInfo').textContent = m?.source === 'sticker' ? t('scan2.machine_sticker', { mid: m.mid, impl: implName(m.type), w: m.w })
    : m ? t('scan2.machine_manual', { impl: implName(m.type), w: m.w }) : t('scan2.machine_none');
  $('#machineInfo').classList.toggle('is-warn', m?.source !== 'sticker');
  $('#slipInfo').textContent = sl?.state ? t('sslip.ok', { ra: Number(sl.ra).toFixed(2), role: t('srole.' + sl.role), d: new Date(sl.exp * 1000).toISOString().slice(0, 10) }) + ' ' + t('sslip.honesty')
    : sl ? t('scan2.slip_ok', { kh: sl.kh, ra: Number(sl.ra).toFixed(2) }) + (activeProfile() ? ' · ' + t('sslip.no_state') : '') : t('scan2.slip_none');
  $('#slipInfo').classList.toggle('is-warn', !sl);
  $('#clearSlip').hidden = !sl;
  // self-operated (D3-A): declared below, or automatic when the slip was made on this same phone
  const same = sameSlipPhone();
  $('#ownerSel').disabled = same;
  if (same) $('#ownerSel').value = 'own';
  $('#ownerNote').textContent = same ? t('own.auto') : t('own.hint');
  // a valid sticker fixes machine type and width
  const fixed = m?.source === 'sticker';
  $('#implSelect').disabled = fixed; $('#widthInp').disabled = fixed;
  if (fixed) { $('#implSelect').value = m.type; $('#widthInp').value = m.w; }
  // a signed sticker fixed the width: show it locked, without the "measure your machine" hint (OP-6)
  $('#widthLock').hidden = !fixed; $('#widthHint').hidden = fixed;
  $('#machineIcon').innerHTML = `<use href="#i-${m?.source === 'sticker' ? 'circle-check' : 'tractor'}"/>`;
  $('#slipIcon').innerHTML = `<use href="#i-${sl ? 'circle-check' : 'list'}"/>`;
  // a finished scan folds to one line: check icon, what was read, and a quiet "Scan again" (UX-1)
  const doneM = m?.source === 'sticker', doneS = !!sl;
  $('#machineIcon').closest('.scan2__row').classList.toggle('is-done', doneM);
  $('#slipIcon').closest('.scan2__row').classList.toggle('is-done', doneS);
  for (const [id, done, key] of [['#scanSticker', doneM, 'scan2.scan_sticker'], ['#scanSlip', doneS, 'scan2.scan_slip']]) {
    $(id).classList.toggle('btn-ghost', !done); $(id).classList.toggle('btn-tertiary', done);
    $(id).textContent = t(done ? 'scan2.again' : key);
  }
  if ($('#jobDetailsSum')) detailsSummary();
}
// Phase 4: S = state-signed slip; F = farmer-made slip while a state profile is active ("no state slip");
// no state profile active (older installs, judge mode) → no slip source, exactly as before.
function slipSource() {
  const sl = app.settings.jobSlip;
  if (sl?.state) return { ss: 'S', ph: sl.ph };
  return activeProfile() ? { ss: 'F' } : {};
}
const sameSlipPhone = () => !!(app.settings.jobSlip?.jh && app.settings.mySlip?.jh && app.settings.jobSlip.jh === app.settings.mySlip.jh);
function selfOpNow() { return sameSlipPhone() ? 'same_phone' : $('#ownerSel').value === 'own' ? 'declared' : null; }
async function scanStickerFlow() {
  const text = await scanQr({ title: t('scan2.scan_sticker'), hint: t('scan2.sticker_hint'), placeholder: 'PPM1|{…}|…' });
  if (!text) return;
  const v = await verifySticker(text);
  if (v.status !== 'VALID') { toast(t('scan2.sticker_' + v.status.toLowerCase()), 5000); return; }
  await S.setMachineFromSticker(app.settings, v);
  haptic(60); // M-6: the row itself turns into a check, no toast
  twoScanInfo(); detailsSummary();
}
async function scanSlipFlow() {
  const text = await scanQr({ title: t('scan2.scan_slip'), hint: t('slip.honesty'), placeholder: 'PPJ2|{…}|… or PPJ1|{…}' });
  if (!text) return;
  let js;
  if (qrKind(text) === 'slip2') {
    // Phase 4: a STATE-signed slip — verified offline with the slip key from that state's signed profile
    const v = await S.verifyAnyStateSlip(text);
    if (v.status !== 'VALID') { toast(t('sslip.' + v.status) + (v.reason ? ' — ' + v.reason : ''), 6000); return; }
    js = await S.setStateJobSlip(app.settings, v);
  } else {
    let parsed;
    try { if (qrKind(text) !== 'slip') throw new Error(t('scan2.not_slip')); parsed = parseSlip(text); } catch (e) { toast(e.message, 5000); return; }
    js = await S.setJobSlip(app.settings, parsed, await slipHash(parsed.slip));
  }
  const f = (await S.ensureSlipField(js)) || (await S.fieldNearSlip(js));
  if (f) { app.settings.activeFieldId = f.id; await S.saveSettings(app.settings); haptic(60); } // the slip row shows the check
  else toast(t('scan2.slip_no_field'), 5000);
  await show();
}

// ---------------- demo flow (Record → calibrate → replay) ----------------
/** Select the demo field (a real test parcel) and switch demo mode on, without starting a job. */
async function useDemoField() {
  const f = await S.ensureDemoField();
  app.settings.demo = true; app.settings.activeFieldId = f.id; app.settings.implement = 'HS'; app.settings.widthM = 2.2;
  await S.saveSettings(app.settings);
  app.refreshChrome();
  await show();
  if (!(await S.getCalibration(true))) await S.setCalibration(true, S.syntheticCalibration(app.settings));
  await calibStatus();
}
async function startDemoFlow(opts = {}) {
  await useDemoField();
  return startJob(opts);
}

// demo source: the synthetic job, or a real public track if tools/sync_plugins.py delivered one
function demoSources() {
  const tracks = listRealTracks();
  $('#demoSrcWrap').hidden = !tracks.length;
  if (!tracks.length) return;
  $('#demoSrc').innerHTML = `<option value="">${esc(t('demoSrcSynthetic'))}</option>` +
    tracks.map((x) => `<option value="${esc(x.file)}">${esc(t('demoSrcRealShort', { country: x.country }))}</option>`).join('');
  $('#demoSrc').value = tracks.some((x) => x.file === app.settings.demoSource) ? app.settings.demoSource : '';
  demoSourceInfo();
}
function demoSourceInfo() {
  const tr = listRealTracks().find((x) => x.file === $('#demoSrc').value);
  $('#demoSrcLic').textContent = tr ? [t('demoSrcReal', { name: tr.dataset, country: tr.country }), t('demoSrcLicence', { l: tr.licence }) + (tr.creator ? ' · ' + tr.creator : '') + (tr.url ? ' · ' + tr.url : ''),
    tr.gpsOnly ? t('realTrackGpsOnly') : '', tr.accuracyReported === false ? t('realTrackAccAssumed', { m: ASSUMED_ACC_M }) : ''].filter(Boolean).join('. ') + '.' : '';
}
const chosenTrack = () => (app.settings.demo ? listRealTracks().find((x) => x.file === app.settings.demoSource) || null : null);

// A demo parcel from a DEMO state slip (Phase 4) is the demo field itself (rounded to 6 dp), so the
// simulated job can run on it and the certificate binds to that parcel.
function sameAsDemoField(b) {
  const d = sampleField().boundary;
  return Array.isArray(b) && b.length === d.length && b.every((p, i) => Math.abs(p[0] - d[i][0]) < 2e-6 && Math.abs(p[1] - d[i][1]) < 2e-6);
}

// ---------------- recording ----------------
async function startJob(opts = {}) {
  if (run) return null;
  const demo = app.settings.demo;
  let perm = 'granted';
  if (!demo) perm = await requestMotionPermission(); // first await → still inside the tap gesture on iOS
  let field = await S.getField($('#jobField').value);
  const track = opts.synthetic ? null : chosenTrack();
  let replay = null;
  if (demo && track) {
    try { replay = await loadRealTrack(track); field = await S.ensureTrackField(track, replay.boundary, t('realTrackField')); }
    catch (e) { console.warn('real track', e); toast(t('realTrackFailed')); return null; }
  } else if (demo && (!field || !field.demo || (field.id !== 'F-DEMO1' && !sameAsDemoField(field.boundary)))) { field = await S.ensureDemoField(); toast(t('demoUsesSample')); }
  if (!field) {
    if ((await S.listFields()).length) { toast(t('rec.choose_field'), 4000); $('#jobField').focus(); return null; }
    toast(t('drawFieldFirst')); app.go('field'); return null;
  }
  const machine = S.activeMachine(app.settings);
  const widthM = machine?.source === 'sticker' ? machine.w : Number($('#widthInp').value) || 2.2;
  const calib = await S.getCalibration(demo);
  const classifier = S.jobClassifier(calib, app.settings);
  const t0 = Date.now();
  run = {
    demo, field, widthM, calib, t0, classifier, implement: machine?.source === 'sticker' ? machine.type : $('#implSelect').value,
    machine: machine || null, slip: app.settings.jobSlip ? { jh: app.settings.jobSlip.jh, ra: app.settings.jobSlip.ra, ...slipSource() } : null, sp: profileTag() || undefined,
    slipGeo: app.settings.jobSlip ? { c: app.settings.jobSlip.c || null, b: app.settings.jobSlip.b || null } : null, selfOp: selfOpNow(),
    fieldPoly: ringToPolygon(field.boundary), fieldM2: field.areaM2,
    pending: [], lastAssigned: null, liveLenM: 0, spark: [], startPerf: performance.now(),
    lines: { cur: null, line: null, all: [] }, lastFix: null, lastWin: null, sensorInfo: {},
    labels: [], openLabel: null, placement: app.settings.placement,
    speed: opts.speed ?? (Number(app.settings.replaySpeed) || 0), replay, onDone: opts.onDone || null,
  };
  setTrainLabel(null);
  $('#trainBox').hidden = demo;
  $('#recSensors').open = false;
  haptic(60); // M-4: recording started
  run.proc = new JobProcessor({ t0, classifier, onWindow: onWindow });
  showPanel('live');
  recIllusBuild($('#recIllus')); // slot 3
  setupLiveMap();
  setStatus({ label: 'IDLE', conf: null });
  if (demo) { startReplay(); return run; }
  else {
    if (perm !== 'granted') toast(t('motionDenied'));
    run.sensors = new SensorSession({
      onGps: (tt, lat, lon, acc, speed, heading) => { run.proc.addGps(tt, lat, lon, acc, speed, heading); onFix(tt, lat, lon, acc, speed); },
      onAccel: (tt, x, y, z) => run.proc.addAccel(tt, x, y, z),
      onStatus: (s) => { Object.assign(run.sensorInfo, s); sensorChips(); },
    });
    await run.sensors.start();
    run.ticker = setInterval(() => { run.proc.tick(run.sensors.now()); liveClock(); sensorChips(); }, 1000);
    run.autosave = setInterval(autosave, 15000);
  }
  return run;
}

function startReplay() {
  // a real public track (app/demo/) or the synthetic job on the demo field's geometry
  const sim = run.replay || generateJob({ field: sampleField(), implWidth: run.widthM, seed: 42, tractorSeed: 7 });
  run.sim = sim;
  let gi = 0, ai = 0, simT = 0;
  const speed = run.speed;
  const feedUntil = (T) => {
    while (ai < sim.accT.length && sim.accT[ai] <= T) {
      while (gi < sim.gps.length && sim.gps[gi].t <= sim.accT[ai]) { const g = sim.gps[gi++]; run.proc.addGps(g.t, g.lat, g.lon, g.acc, g.speed, g.heading); onFix(g.t, g.lat, g.lon, g.acc, g.speed); }
      run.proc.addAccel(sim.accT[ai], sim.accX[ai], sim.accY[ai], sim.accZ[ai]); ai++;
    }
    // GPS fixes after the last accelerometer sample (all of them for a GPS-only real track)
    while (gi < sim.gps.length && sim.gps[gi].t <= T) { const g = sim.gps[gi++]; run.proc.addGps(g.t, g.lat, g.lon, g.acc, g.speed, g.heading); onFix(g.t, g.lat, g.lon, g.acc, g.speed); }
  };
  run.simNow = () => simT;
  run.feedAll = () => { simT = sim.durationMs; feedUntil(sim.durationMs + 1); };
  if (!speed) { // instant
    openModal(`<h3>${L('processing')}</h3><div class="progress indeterminate"><i></i></div>`);
    setTimeout(async () => { feedUntil(sim.durationMs + 1); closeModal(); await stopJob(); }, 30);
    return;
  }
  run.ticker = setInterval(async () => {
    simT += 50 * speed;
    feedUntil(simT);
    liveClock();
    if (simT >= sim.durationMs) { clearInterval(run.ticker); run.ticker = null; await stopJob(); }
  }, 50);
  run.sensorInfo = { wakeLock: 'demo' };
  sensorChips();
}

function onFix(tt, lat, lon, acc, speed) {
  run.pending.push({ t: tt, lat, lon, acc, speed });
  run.lastFix = { t: tt, lat, lon, acc, speed };
  if (run.sensorInfo) run.sensorInfo.gpsError = null;
  if (run.marker) run.marker.setLatLng([lat, lon]);
  $('#lvAcc').textContent = acc != null ? Math.round(acc) : '–';
  if (run.follow && liveMap) liveMap.map.panTo([lat, lon], { animate: false });
}

// called by the pipeline when a 2-s window is classified
function onWindow(w) {
  run.lastWin = w;
  setStatus({ label: w.label, conf: w.conf });
  $('#lvSpeed').textContent = w.speedKmh != null ? w.speedKmh.toFixed(1) : '–';
  run.spark.push(w.rms ?? 0); if (run.spark.length > 90) run.spark.shift();
  spark();
  $('#lvVibTxt').textContent = w.rms != null ? w.rms.toFixed(2) + ' m/s²' : t('noSensor');
  // assign fixes of this window to the map + live acres (same distance × width idea as the final result)
  const end = (w.k + 1) * WINDOW_MS;
  const turf = globalThis.turf;
  while (run.pending.length && run.pending[0].t < end) {
    const f = run.pending.shift();
    const prev = run.lastAssigned;
    if (w.label === 'WORKING' && prev && prev.label === 'WORKING' && f.t - prev.t < 10000 && f.acc <= 20) {
      const d = f.speed != null && f.speed >= 0 && prev.speed != null && prev.speed >= 0 ? ((f.speed + prev.speed) / 2) * ((f.t - prev.t) / 1000) : haversine(prev.lat, prev.lon, f.lat, f.lon);
      if (turf.booleanPointInPolygon(turf.point([f.lon, f.lat]), run.fieldPoly)) run.liveLenM += d;
    }
    run.lastAssigned = { ...f, label: w.label };
    drawTrackPoint([f.lat, f.lon], w.label);
  }
  const ac = (run.liveLenM * run.widthM) / M2_PER_ACRE;
  $('#lvAcres').textContent = ac.toFixed(2);
  $('#lvCov').textContent = Math.min(100, (100 * run.liveLenM * run.widthM) / run.fieldM2).toFixed(0) + '%';
}

/** The status sub-line in plain words (UX-1/UX-2). The model's confidence is shown in demo mode only. */
export function statusLine(label, conf, demo) {
  if (conf == null) return t('waitingData');
  const why = label === 'WORKING' ? t('ui.machine_in_soil') : label === 'TRANSIT' ? t('ui.not_counted') : t('rec.standing');
  return demo ? `${why} · ${t('confidence')} ${Math.round(conf * 100)}%` : why;
}
function setStatus({ label, conf }) {
  const pill = $('#statusPill');
  const cls = 'status-pill status--' + label.toLowerCase();
  if (pill.className !== cls) {
    const prev = pill.className;
    pill.className = cls; $('#statusIcon').innerHTML = ICONS[label.toLowerCase()]; $('#statusText').textContent = t(label);
    // M-2: a short buzz when the work starts or stops (real recordings only: a 120× replay would buzz non-stop)
    if (run && !run.demo && prev.includes('status--')) { if (label === 'WORKING') haptic(40); else if (label === 'IDLE') haptic([30, 60, 30]); }
  }
  $('#statusConf').textContent = statusLine(label, conf, !!run?.demo);
  recIllusState($('#recIllus'), label);
}

function spark() {
  const v = run.spark, max = Math.max(1.2, ...v);
  const pts = v.map((x, i) => `${(i / 89) * 120},${28 - (x / max) * 26}`).join(' ');
  const thr = run.calib?.features?.[0] ? Math.exp(run.calib.features[0].mid) : null;
  $('#lvSpark').innerHTML = `${thr ? `<line x1="0" x2="120" y1="${28 - (thr / max) * 26}" y2="${28 - (thr / max) * 26}"/>` : ''}<polyline points="${pts}"/>`;
}

function liveClock() {
  const ms = run.demo ? run.simNow() : performance.now() - run.startPerf;
  $('#lvTime').textContent = fmtDuration(ms);
}

function sensorChips() {
  const s = run.sensorInfo, chips = [];
  if (run.demo) {
    chips.push(`<span class="chip">${esc(t('demoReplay'))} ${run.speed || '∞'}×</span>`);
    if (run.replay) chips.push(`<span class="chip">${esc(t('demoSrcReal', { name: run.replay.meta.dataset, country: run.replay.meta.country }))}</span>`);
    if (run.replay?.gpsOnly) chips.push(`<span class="chip warn">${icon('info')}${esc(t('realTrackGpsOnly'))}</span>`);
  }
  else {
    const accOk = run.sensors?.accelCount > 0;
    chips.push(`<span class="chip ${accOk ? 'ok' : 'bad'}">${icon(accOk ? 'check' : 'cross')}${esc(t('accelerometer'))}</span>`);
    const gpsOk = run.lastFix && run.lastFix.acc <= 20;
    chips.push(`<span class="chip ${gpsOk ? 'ok' : 'warn'}">${icon(gpsOk ? 'check' : 'clock')}GPS ${run.lastFix ? '±' + Math.round(run.lastFix.acc) + ' m' : ''}</span>`);
    chips.push(`<span class="chip ${s.wakeLock === true ? 'ok' : 'warn'}">${icon(s.wakeLock === true ? 'check' : 'warning')}${esc(t('screenOn'))}</span>`);
    if (s.gpsError) chips.push(`<span class="chip bad">GPS: ${esc(s.gpsError)}</span>`);
  }
  $('#lvSensors').innerHTML = chips.join('');
}

// ---------------- live map ----------------
function metersPerPixel(map) {
  const lat = map.getCenter().lat;
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
}
function swathWeight() { return Math.max(3, run.widthM / metersPerPixel(liveMap.map)); }

function setupLiveMap() {
  const Lf = globalThis.L;
  if (!liveMap) {
    liveMap = makeMap($('#jobMap'), { zoomControl: false });
    liveMap.map.on('dragstart', () => { if (run) run.follow = false; });
    liveMap.map.on('zoomend', () => { if (!run) return; for (const l of run.lines.all) if (l.options.className === 'swath') l.setStyle({ weight: swathWeight() }); });
  }
  const m = liveMap.map;
  if (run.layer) run.layer.remove();
  run.layer = Lf.layerGroup().addTo(m);
  const poly = Lf.polygon(field2ll(run.field.boundary), { color: STATE_COLORS.BOUNDARY, weight: 2, fill: true, fillColor: cssVar('--c-surface', '#fff'), fillOpacity: 0.6 }).addTo(run.layer);
  setTimeout(() => { m.invalidateSize(); m.fitBounds(poly.getBounds().pad(0.35)); }, 60);
  run.marker = Lf.circleMarker(run.field.centroid, { radius: 7, color: '#fff', weight: 2.5, fillColor: cssVar('--map-me', '#101410'), fillOpacity: 1 }).addTo(run.layer);
  run.follow = false;
}
const field2ll = (b) => b.map(([a, c]) => [a, c]);

function drawTrackPoint(ll, label) {
  const Lf = globalThis.L, ln = run.lines;
  if (ln.cur !== label || !ln.line) {
    const last = ln.line ? ln.line.getLatLngs().slice(-1) : [];
    const style = label === 'WORKING'
      ? { color: STATE_COLORS.WORKING, opacity: 0.55, weight: swathWeight(), lineCap: 'butt', lineJoin: 'round', className: 'swath' }
      : { color: label === 'TRANSIT' ? STATE_COLORS.TRANSIT : STATE_COLORS.IDLE, weight: 2.5, dashArray: '5 5', opacity: 0.9 };
    ln.line = Lf.polyline(last, style).addTo(run.layer);
    ln.all.push(ln.line);
    ln.cur = label;
  }
  ln.line.addLatLng(ll);
}

// ---------------- stop ----------------
function setupHoldToStop() {
  const b = $('#stopBtn');
  let timer = null;
  // M-3: the ring fills over the 2-s hold (CSS); a light tick when the hold starts, a firm one when it stops
  const start = (e) => { e.preventDefault(); if (!run || e.repeat || b.classList.contains('holding')) return; clearTimeout(timer); b.classList.add('holding'); haptic(15); timer = setTimeout(async () => { b.classList.remove('holding'); haptic(80); await stopJob(); }, 2000); };
  const cancel = () => { clearTimeout(timer); b.classList.remove('holding'); };
  b.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, cancel));
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') start(e); });
  b.addEventListener('keyup', cancel);
}

async function stopJob() {
  if (!run || run.stopping) return;
  run.stopping = true;
  clearInterval(run.ticker); clearInterval(run.autosave);
  run.sensors?.stop();
  const tEnd = run.demo ? run.sim.durationMs : run.sensors.now();
  openModal(`<h3>${L('processing')}</h3><p class="hint">${L('processingHint')}</p><div class="progress indeterminate"><i></i></div>`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const res = run.proc.finalize(tEnd);
    setTrainLabel(null); // close any open training label
    const job = await S.buildJob(res, { field: run.field, implement: run.implement, widthM: run.widthM, t0: run.t0, t1: run.t0 + tEnd, demo: run.demo,
      calib: run.calib, rate: app.settings.rate, labels: run.labels, placement: run.placement, machine: run.machine, slip: run.slip, slipGeo: run.slipGeo, selfOp: run.selfOp, sp: run.sp });
    if (!run.demo) await kv.del('activeJob');
    resultJob = job; resultField = run.field;
  } catch (e) {
    console.error(e); toast(t('errorProcessing') + ': ' + e.message);
  }
  closeModal();
  const onDone = run.onDone;
  run = null;
  if (resultJob) renderResult();
  else showPanel('setup');
  onDone?.(resultJob);
}

// ---------------- crash recovery ----------------
async function autosave() {
  if (!run || run.demo) return;
  const p = run.proc;
  await kv.set('activeJob', { fieldId: run.field.id, implement: run.implement, widthM: run.widthM, t0: run.t0, calib: run.calib,
    labels: run.labels, placement: run.placement, machine: run.machine, slip: run.slip, slipGeo: run.slipGeo, selfOp: run.selfOp, sp: run.sp, raw: p.rawData() });
}
async function recoverCheck() {
  const a = await kv.get('activeJob');
  const box = $('#recoverBox');
  if (!a || run) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="pp-notice pp-notice--warn">${icon('warning')}<span class="grow"><span class="pp-notice__title">${esc(t('unfinishedJob'))}</span><span class="pp-notice__body">${esc(new Date(a.t0).toLocaleString())}</span>
    <span class="row wrap" style="margin-top:8px"><button class="btn btn-ghost btn-dense" id="recFinish">${L('finishSave')}</button><button class="btn btn-tertiary btn-dense" id="recDiscard">${L('discard')}</button></span></span></div>`;
  $('#recDiscard').onclick = async () => { if (await confirmBox(t('discardConfirm'))) { await kv.del('activeJob'); recoverCheck(); } };
  $('#recFinish').onclick = async () => {
    const field = await S.getField(a.fieldId);
    if (!field) { toast(t('fieldMissing')); return; }
    const res = reprocess(a.raw, S.jobClassifier(a.calib, app.settings));
    const last = Math.max(a.raw.gps.at(-1)?.[0] || 0, a.raw.accT.at(-1) || 0);
    resultJob = await S.buildJob(res, { field, implement: a.implement, widthM: a.widthM, t0: a.t0, t1: a.t0 + last, demo: false, calib: a.calib,
      rate: app.settings.rate, labels: a.labels || [], placement: a.placement, machine: a.machine ?? null, slip: a.slip ?? null, slipGeo: a.slipGeo ?? null, selfOp: a.selfOp ?? null, sp: a.sp });
    resultField = field;
    await kv.del('activeJob');
    renderResult();
  };
}

// ---------------- results: a typeset receipt (no count-ups) ----------------
export function renderResult() {
  const j = resultJob, c = j.coverage;
  showPanel('result');
  const rate = app.settings.rate;
  const flags = (j.flags || []).filter((f) => f !== 'DEMO');
  const hi = flags.filter((f) => FLAG_INFO[f]?.sev === 'high').length;
  const t0 = j.t0 ?? j.raw?.t0, t1 = j.t1;
  const pay = S.payableOf({ wa: round(c.workedAcres, 2), fa: round(c.fieldAcres, 2), ra: j.slip?.ra ?? null });
  $('#resEyebrow').textContent = t('results') + (t0 ? ' · ' + fmtDate(t0) : '') + (j.demo ? ' · ' + t('ui.demo') : '');
  $('#resContext').textContent = `${resultField?.label || ''}${t0 && t1 ? ' · ' + new Date(t0).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + '–' + new Date(t1).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}`;
  $('#resKpis').innerHTML = `
    <div class="pp-numeral"><span class="pp-numeral__value">${c.workedAcres.toFixed(2)}</span><span class="pp-numeral__unit">${esc(t('ui.acres_unit'))}</span></div>
    <p class="hint" style="margin:6px 0 16px">${esc(t('ui.worked_inside'))} · ${c.workedHa.toFixed(2)} ha</p>
    <dl class="pp-dl">
      <div><dt>${esc(t('coverage'))}</dt><dd><span class="pp-num">${Math.round(c.coveragePct)}%</span> · ${c.fieldAcres.toFixed(2)} ac<div class="pp-bar" style="--v:${Math.min(100, c.coveragePct)};width:120px;margin:6px 0 0 auto"><i></i></div></dd></div>
      <div><dt>${esc(t('workingTime'))}</dt><dd class="pp-num">${fmtDuration(j.timeMs.WORKING)}<small>${esc(t('ui.road_idle', { a: fmtDuration(j.timeMs.TRANSIT), b: fmtDuration(j.timeMs.IDLE) }))}</small></dd></div>
      <div><dt>${esc(t('pay.payable'))}</dt><dd class="pp-num">${pay.pa.toFixed(2)} ac<small>${esc(payNote(pay))}</small></dd></div>
      <div><dt>${esc(t('res.farmer_incentive'))}</dt><dd class="pp-num">₹${Math.round(pay.pa * rate).toLocaleString('en-IN')}<small>${esc(t('res.farmer_incentive_sub', { rate: fx(rate, 0) }))}</small></dd></div>
    </dl>`;
  // three quiet checks: GPS work proof · Satellite · Integrity
  const sat = j.ext?.satellite, satOk = sat && !sat.error;
  const st = (cls, ic, word) => `<span class="pp-status pp-status--${cls}">${icon(ic)}${esc(word)}</span>`;
  const row = (ic, title, meta, status) => `<div class="pp-check">${icon(ic)}<div class="pp-check__main"><span class="pp-check__title">${esc(title)}</span><span class="pp-check__meta">${esc(meta)}</span></div>${status}</div>`;
  $('#resChecks').innerHTML =
    row('gps', t('ui.gps_proof'), t('res.gps_meta'),
      hi ? st('warn', 'warning', t('ui.n_flags', { n: hi })) : st('ok', 'circle-check', t('ui.passed'))) +
    row('satellite', t('satCheck'), satOk ? t('res.sat_meta') : t('pending'),
      satOk ? (sat.verdict === 'NOT_BURNED' ? st('ok', 'circle-check', t('sat_' + sat.verdict)) : st('warn', 'circle-alert', t('sat_' + sat.verdict))) : st('', 'clock', t('pending'))) +
    row('lock', t('ui.integrity'), t('res.sign_meta'), j.certId ? st('ok', 'circle-check', t('ui.signed')) : st('', 'clock', t('ui.ready_sign')));
  // method (collapsed)
  const ac = (m2) => (m2 / M2_PER_ACRE).toFixed(2) + ' ac';
  $('#resMethod').innerHTML = `<h2 class="pp-section__title">${L('howCalculated')}</h2><table class="kv">
    <tr class="${c.method === 'DISTANCE' ? 'used' : ''}"><th>${esc(t('mDistance'))}</th><td>${ac(c.distanceM2)}</td></tr>
    <tr class="${c.method === 'ENVELOPE_CAP' ? 'used' : ''}"><th>${esc(t('mEnvelope', { m: c.marginM.toFixed(1) }))}</th><td>${ac(c.envelopeM2)}</td></tr>
    <tr><th>${esc(t('mStrict'))}</th><td>${ac(c.strictM2)}</td></tr>
    <tr><th>${esc(t('outsideField'))}</th><td>${ac(c.outsideM2)} · ${Math.round(c.outsideLengthM)} m</td></tr>
    <tr><th>${esc(t('classifierUsed'))}</th><td>${esc(j.classifier.id)} · ${Math.round(j.meanConfidence * 100)}%</td></tr></table>
    <p class="hint">${L('methodNote')}</p>`;
  $('#resFlags').innerHTML = flagsHTML(j.flags, { withCodes: true }); // inside "Details for officers"
  slots(j.ext);
  // map
  const Lf = globalThis.L;
  if (!resMap) resMap = makeMap($('#resMap'));
  const m = resMap.map;
  if (resMap.layer) resMap.layer.remove();
  resMap.layer = Lf.layerGroup().addTo(m);
  const poly = Lf.polygon(resultField.boundary, { color: STATE_COLORS.BOUNDARY, weight: 2, fillColor: cssVar('--c-surface', '#fff'), fillOpacity: 0.6 }).addTo(resMap.layer);
  if (c.coverageGeo) Lf.geoJSON(c.coverageGeo, { style: { color: STATE_COLORS.WORKING, weight: 0, fillColor: STATE_COLORS.WORKING, fillOpacity: 0.55 } }).addTo(resMap.layer);
  trackLines(j).forEach((l) => l.addTo(resMap.layer));
  setTimeout(() => { m.invalidateSize(); m.fitBounds(poly.getBounds().pad(0.25)); }, 60);
  // once issued, the primary action starts the next field and the certificate is one tertiary tap away (UX-1)
  $('#issueBtn').disabled = false;
  $('#issueBtn').innerHTML = j.certId ? L('next.next_field') : L('issueCert');
  $('#resCertLink').hidden = !j.certId;
  $('#resTech').open = false;
}

/** "The smallest of: worked 3.27 · field 3.34 · registered 3.40" (UX-2: no min(…) on any screen) */
export function payNote(pay) {
  const parts = [`${t('pay.C')} ${fx(pay.C)}`, `${t('pay.B')} ${fx(pay.B)}`, pay.A != null ? `${t('pay.A')} ${fx(pay.A)}` : t('pay.no_A')];
  return t('pay.smallest', { parts: parts.join(' · ') });
}

export function trackLines(j) {
  const Lf = globalThis.L, out = [];
  let cur = null, pts = [];
  const push = () => { if (pts.length > 1) out.push(Lf.polyline(pts, cur === 'WORKING' ? { color: STATE_COLORS.WORKING, weight: 1, opacity: 0.6 } : { color: cur === 'TRANSIT' ? STATE_COLORS.TRANSIT : STATE_COLORS.IDLE, weight: 2, dashArray: '5 5' })); };
  for (const g of j.raw.gps) {
    if (g[3] > 20) continue;
    const lab = j.windows[Math.floor(g[0] / WINDOW_MS)]?.label || 'IDLE';
    if (lab !== cur) { const last = pts.at(-1); push(); pts = last ? [last] : []; cur = lab; }
    pts.push([g[1], g[2]]);
  }
  push();
  return out;
}

/**
 * Flags as plain sentences: short label + the explanation, with a severity icon (never colour alone).
 * withCodes (officer screens only): the raw code follows in small mono, so officers keep the precise term.
 * Codes may come from a scanned QR: unknown codes are shown escaped, as text, with a warning icon.
 */
export function flagsHTML(codes, { withCodes = false } = {}) {
  if (!codes?.length) return `<div class="flag sev-info">${icon('circle-check')}<span class="flag__text">${L('noFlags')}</span></div>`;
  const lang = getLang();
  return codes.map((c) => {
    c = String(c);
    const f = Object.hasOwn(FLAG_INFO, c) ? FLAG_INFO[c] : { sev: 'warn', en: c };
    const k = 'flag.' + c, short = Object.hasOwn(FLAG_INFO, c) && t(k) !== k ? t(k) : '';
    const sev = ['high', 'warn', 'info'].includes(f.sev) ? f.sev : 'warn';
    return `<div class="flag sev-${sev}">${icon(sev === 'high' ? 'circle-x' : sev === 'warn' ? 'warning' : 'info')}<span class="flag__text">${short ? `<b>${esc(short)}</b> ` : ''}${esc(f[lang] || f.en)}${withCodes && short ? ` <code>${esc(c)}</code>` : ''}</span></div>`;
  }).join('');
}

// ---------------- results: satellite + impact slots ----------------
function slots(ext) {
  const sat = ext?.satellite, imp = ext?.impact;
  const satOk = sat && !sat.error, impOk = imp && !imp.error;
  const box = $('#slotSat'), pics = $('#slotSatPics');
  box.className = 'pp-section';
  // real Sentinel-2 pictures of this parcel stay outside the fold, with one plain line (UX-2, judge step 3)
  const tiles = satOk ? satTiles(sat) : '';
  pics.className = tiles ? 'pp-section' : '';
  pics.innerHTML = tiles ? `<h2 class="pp-section__title">${esc(t('sat.pictures'))}</h2><p class="sat-plain">${esc(t(sat.verdict === 'NOT_BURNED' ? 'sat.plain_ok' : sat.verdict === 'BURN_SUSPECTED' ? 'sat.plain_burn' : 'sat.plain_unsure'))}</p>${tiles}` : '';
  pics.querySelectorAll('.sat-tile').forEach((b) => b.addEventListener('click', () => enlargeTile(b)));
  let h = `<h2 class="pp-section__title">${esc(t('satCheck'))}</h2>`;
  if (satOk) {
    const before = sat.scenes?.find((x) => x.role === 'before')?.date, after = sat.scenes?.find((x) => x.role === 'after')?.date;
    h += `<dl class="pp-dl">
        <div><dt>${esc(t('status'))}</dt><dd>${esc(t('sat_' + sat.verdict) || sat.verdict)}<small>${esc(t('confidence'))} ${esc(sat.confidence ?? '–')}</small></dd></div>
        <div><dt>${esc(t('satParcel'))}</dt><dd>${esc(sat.field_name || '–')}</dd></div>
        <div><dt>${esc(t('satImages'))}</dt><dd>Sentinel-2 ${esc(before || '?')} → ${esc(after || '?')}</dd></div>
        <div><dt>dNBR</dt><dd class="pp-num">${sat.dnbr_mean ?? '–'}<small>${esc(t('burnLike'))} ${sat.burnlike_pct ?? '–'}%</small></dd></div>
        <div><dt>NASA FIRMS</dt><dd class="pp-num">${sat.firms_hits ?? 0} ${esc(t('fireHits'))}</dd></div>
      </dl>
      <p class="hint">${L(sat.precomputed ? 'satPrecomputedNote' : 'satLiveNote')}</p>`;
  } else {
    h += `<p class="hint">${L(sat?.error ? 'moduleError' : 'satPending')}</p>`;
  }
  if (resultJob && !resultJob.certId && app.settings.demo) h += `<label class="btn btn-ghost btn-dense file-btn" style="align-self:flex-start"><span>${L('attachSat')}</span><input type="file" accept="application/json,.json" id="satFile" hidden></label>`;
  box.innerHTML = h;
  $('#satFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await S.attachSatellite(resultJob, resultField, JSON.parse(await f.text()), summarizeSat);
      toast(t('satAttached')); renderResult();
    } catch (err) { toast(err.message, 5000); }
  });

  const ib = $('#slotImpact');
  ib.className = 'pp-section';
  ib.innerHTML = `<h2 class="pp-section__title">${esc(t('emissionsAvoided'))}</h2>` + (impOk
    ? `<dl class="pp-dl">
        <div><dt>${esc(t('co2eAvoided'))}</dt><dd class="pp-num">${Math.round(imp.co2e_kg.central)} kg CO₂e<small>${Math.round(imp.co2e_kg.low)}–${Math.round(imp.co2e_kg.high)}</small></dd></div>
        <div><dt>${esc(t('pm25Avoided'))}</dt><dd class="pp-num">${imp.pm25_kg} kg</dd></div>
        <div><dt>${esc(t('strawManaged'))}</dt><dd class="pp-num">${imp.straw_t} t</dd></div>
      </dl><p class="hint">${L('impactNote')}</p>`
    : `<p class="hint">${L(imp?.error ? 'moduleError' : 'impactPending')}</p>`);
}

// Real Sentinel-2 crops of this parcel (plugins/sat/img). Shown only when the satellite section
// names a parcel that has tiles; otherwise nothing extra. Images are never drawn or synthesised.
const tileDate = (d) => { const x = d ? new Date(d + 'T00:00:00') : null; return x && !isNaN(x) ? x.toLocaleDateString(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }) : '?'; };
function tileList(sat) {
  const e = satTilesFor(sat);
  if (!e) return null;
  return [
    { role: 'before', tile: e.tiles.before, label: t('sat.before', { d: tileDate(e.tiles.before.date) }) },
    { role: 'after', tile: e.tiles.after, label: t('sat.after', { d: tileDate(e.tiles.after.date) }) },
    { role: 'dnbr', tile: e.tiles.dnbr, label: t('sat.change'), note: t('sat.change_note') },
  ];
}
function satTiles(sat) {
  const list = tileList(sat);
  if (!list) return '';
  return `<div class="sat-tiles">${list.map((x) => `<button type="button" class="sat-tile" data-role="${x.role}" aria-label="${esc(t('sat.enlarge', { name: x.label }))}">
      <img src="${esc(x.tile.src)}" width="${Number(x.tile.w) || 400}" height="${Number(x.tile.h) || 400}" alt="" loading="lazy" decoding="async"><span class="sat-tile__cap">${esc(x.label)}</span></button>`).join('')}</div>
    <p class="hint sat-caption">${esc(t('sat.caption'))} ${esc(t('sat.outline'))}</p>`;
}
function enlargeTile(btn) {
  const x = (tileList(resultJob?.ext?.satellite) || []).find((y) => y.role === btn.dataset.role);
  if (!x) return;
  const body = openModal(`<figure class="sat-big"><img src="${esc(x.tile.src)}" width="${Number(x.tile.w) || 400}" height="${Number(x.tile.h) || 400}" alt="${esc(x.label)}">
      <figcaption><b>${esc(x.label)}</b>${x.note ? ` · ${esc(x.note)}` : ''}<br>${esc(t('sat.caption'))} ${esc(t('sat.outline'))}</figcaption></figure>
    <button type="button" class="btn btn-ghost" id="satClose">${L('sat.close')}</button>`);
  body.closest('.modal-card').setAttribute('aria-label', x.label);
  const backdrop = (e) => { if (e.target === $('#modal')) close(); };
  const close = () => { $('#modal').removeEventListener('click', backdrop); closeModal(); btn.focus(); };
  body.querySelector('#satClose').addEventListener('click', close);
  body.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  $('#modal').addEventListener('click', backdrop);
  body.querySelector('#satClose').focus();
}

// ---------------- manual training labels (for ML retraining) ----------------
function setTrainLabel(label) {
  if (!run) return;
  const now = run.t0 + (run.demo ? run.simNow?.() || 0 : run.sensors ? run.sensors.now() : 0);
  if (run.openLabel) { run.openLabel.end_ms = Math.round(now); if (run.openLabel.end_ms > run.openLabel.start_ms) run.labels.push(run.openLabel); run.openLabel = null; }
  if (label) run.openLabel = { start_ms: Math.round(now), end_ms: null, label, source: 'manual' };
  document.querySelectorAll('#trainLabels [data-label]').forEach((b) => b.classList.toggle('on', (b.dataset.label || null) === label));
}

async function issueCert() {
  if (!resultJob) return null;
  if (resultJob.certId) { app.go('cert/' + resultJob.certId); return S.findCert(resultJob.certId); }
  $('#issueBtn').disabled = true;
  try {
    const rec = await S.issueForJob(resultJob, resultField);
    if (resultJob.slip?.jh && app.settings.jobSlip?.jh === resultJob.slip.jh) { await S.clearJobSlip(app.settings); $('#ownerSel').value = 'other'; } // one slip, one certificate
    haptic(60); // M-8
    app.go('cert/' + rec.id, { justIssued: true }); // the certificate screen confirms inline ("Certificate ready"), no toast
    return rec;
  } catch (e) { console.error(e); toast(e.message); $('#issueBtn').disabled = false; return null; }
}

export const isRecording = () => !!run;

// ---------------- judge mode (js/tour.js) ----------------
/** Tour step 2: demo field + synthetic replay at `speed`×; resolves with the job once the result screen shows. */
export function tourReplay(speed) {
  return new Promise((resolve, reject) => {
    resultJob = null;
    startDemoFlow({ speed, synthetic: true, onDone: resolve }).then((r) => { if (!r) reject(new Error('replay did not start')); }, reject);
  });
}
/** Tour: Next during the replay feeds the rest of the recording at once. */
export function finishReplayNow() {
  if (!run?.demo || run.stopping || !run.feedAll) return false;
  clearInterval(run.ticker); run.ticker = null;
  run.feedAll();
  stopJob();
  return true;
}
/** Tour step 4: sign the certificate for the job on screen (opens it); resolves with the record. */
export const tourIssue = () => issueCert();
export const tourHasResult = () => !!resultJob;
/** Tour exit: stop a running replay without saving (the page reloads right after). */
export function abortRun() {
  if (!run) return;
  clearInterval(run.ticker); clearInterval(run.autosave); run.sensors?.stop?.();
  run = null; closeModal(); showPanel('setup');
}
