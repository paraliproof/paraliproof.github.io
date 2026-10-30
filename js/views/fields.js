// views/fields.js — FIELDS tab: list saved fields; draw a new boundary by
// (a) tapping corners on the map, (b) walking the boundary with GPS, or
// (c) standing at each corner and adding the averaged GPS position.
//
// DOM contract (#v-field): #fieldSelect, #fieldDelete, #fieldLabel, #drawMode [data-mode], #drawHint,
//   #fieldMap, #areaPill, #locateBtn, #undoBtn, #clearBtn, #walkBtn, #cornerBtn, #layerBtn, #fieldWarn, #saveField
// Data: services.listFields/saveField/deleteField; geo.polygonAreaM2/isSelfIntersecting/simplifyWalk; sensors.averagedPosition.

import * as S from '../services.js';
import { polygonAreaM2, isSelfIntersecting, simplifyWalk, haversine } from '../geo.js';
import { averagedPosition } from '../sensors.js';
import { $, $$, t, L, esc, toast, makeMap, confirmBox, cssVar } from '../ui.js';
import { illusHTML } from '../illus.js';
import { acres, hectares } from '../util.js';

let app, mm = null, mode = 'tap', verts = [], layer = null, walk = null, viewing = null;

export function init(a) {
  app = a;
  $$('#drawMode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#undoBtn').addEventListener('click', () => { verts.pop(); redraw(); });
  $('#clearBtn').addEventListener('click', () => { verts = []; stopWalk(); redraw(); });
  $('#locateBtn').addEventListener('click', locate);
  $('#layerBtn').addEventListener('click', () => { const on = mm.toggleSatellite(); $('#layerBtn').innerHTML = L(on ? 'mapView' : 'satellite'); });
  $('#walkBtn').addEventListener('click', toggleWalk);
  $('#cornerBtn').addEventListener('click', addCorner);
  $('#saveField').addEventListener('click', save);
  $('#fieldSelect').addEventListener('change', () => viewField($('#fieldSelect').value));
  $('#fieldDelete').addEventListener('click', del);
}

export async function show() {
  if (!mm) {
    mm = makeMap($('#fieldMap'));
    mm.map.on('click', (e) => { if (mode === 'tap') { viewing = null; verts.push([e.latlng.lat, e.latlng.lng]); redraw(); } });
    layer = globalThis.L.layerGroup().addTo(mm.map);
  }
  setTimeout(() => mm.map.invalidateSize(), 50);
  await list();
  setMode(mode);
  redraw();
}

async function list() {
  const fields = await S.listFields();
  $('#fieldSelect').innerHTML = `<option value="">${esc(t('chooseField'))}</option>` +
    fields.map((f) => `<option value="${esc(f.id)}">${esc(f.label)} · ${acres(f.areaM2).toFixed(2)} ac</option>`).join('');
  illusHTML($('#fieldIllus'), fields.length ? null : 'empty-fields'); // slot 6: only while no field is saved
  if (app.settings.activeFieldId && fields.some((f) => f.id === app.settings.activeFieldId)) {
    $('#fieldSelect').value = app.settings.activeFieldId;
    if (!verts.length) viewField(app.settings.activeFieldId);
  }
}

async function viewField(id) {
  if (!id) return;
  const f = await S.getField(id);
  if (!f) return;
  app.settings.activeFieldId = id; await S.saveSettings(app.settings);
  viewing = f; verts = [];
  redraw();
  const poly = globalThis.L.polygon(f.boundary);
  mm.map.fitBounds(poly.getBounds().pad(0.3));
}

async function del() {
  const id = $('#fieldSelect').value;
  if (!id || !(await confirmBox(t('deleteFieldConfirm')))) return;
  await S.deleteField(id);
  if (app.settings.activeFieldId === id) { app.settings.activeFieldId = null; await S.saveSettings(app.settings); }
  viewing = null; redraw(); list();
}

function setMode(m) {
  mode = m;
  $$('#drawMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#drawHint').innerHTML = L({ tap: 'hintTap', walk: 'hintWalk', corner: 'hintCorner' }[m]);
  $('#walkBtn').hidden = m !== 'walk';
  $('#cornerBtn').hidden = m !== 'corner';
  if (m !== 'walk') stopWalk();
}

function redraw() {
  const Lf = globalThis.L;
  if (!layer) return;
  layer.clearLayers();
  const pts = viewing ? viewing.boundary : verts;
  if (pts.length >= 2) Lf.polygon(pts, { color: cssVar('--map-boundary', '#101410'), weight: 2, fillColor: cssVar('--c-accent', '#1E5B3A'), fillOpacity: viewing ? 0.18 : 0.1, dashArray: viewing ? null : '6 4' }).addTo(layer);
  if (!viewing) pts.forEach((p, i) => {
    const mk = Lf.marker(p, { draggable: mode === 'tap', icon: Lf.divIcon({ className: 'vertex-icon', iconSize: [22, 22] }), title: `${i + 1}` }).addTo(layer);
    mk.on('drag', (e) => { verts[i] = [e.latlng.lat, e.latlng.lng]; updateArea(); });
    mk.on('dragend', redraw);
  });
  if (walk?.line) walk.line.addTo(layer);
  updateArea();
}

function updateArea() {
  const pts = viewing ? viewing.boundary : verts;
  const m2 = polygonAreaM2(pts);
  $('#areaPill').textContent = `${acres(m2).toFixed(2)} ac · ${hectares(m2).toFixed(2)} ha`;
  const kink = !viewing && isSelfIntersecting(pts);
  $('#fieldWarn').hidden = !kink;
  if (kink) $('#fieldWarn').textContent = t('selfIntersect');
}

function locate() {
  if (!navigator.geolocation) { toast(t('noGps')); return; }
  toast(t('locating'));
  navigator.geolocation.getCurrentPosition((p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    mm.map.setView(ll, 18);
    globalThis.L.circle(ll, { radius: p.coords.accuracy, color: cssVar('--c-ink-soft', '#535C55'), weight: 1, fillOpacity: 0.08 }).addTo(layer);
    globalThis.L.marker(ll, { icon: globalThis.L.divIcon({ className: 'me-dot', iconSize: [20, 20] }) }).addTo(layer);
  }, (e) => toast('GPS: ' + e.message), { enableHighAccuracy: true, timeout: 20000 });
}

function toggleWalk() {
  if (walk) { stopWalk(true); return; }
  if (!navigator.geolocation) { toast(t('noGps')); return; }
  viewing = null; verts = [];
  walk = { pts: [], line: globalThis.L.polyline([], { color: cssVar('--c-accent', '#1E5B3A'), weight: 4 }) };
  walk.id = navigator.geolocation.watchPosition((p) => {
    const c = p.coords;
    if (c.accuracy > 15) { toast(t('waitBetterGps', { acc: Math.round(c.accuracy) }), 1500); return; }
    const last = walk.pts.at(-1);
    if (!last || haversine(last[0], last[1], c.latitude, c.longitude) >= 2) {
      walk.pts.push([c.latitude, c.longitude]);
      walk.line.addLatLng([c.latitude, c.longitude]);
      mm.map.panTo([c.latitude, c.longitude]);
      $('#areaPill').textContent = `${walk.pts.length} ${t('points')} · ${acres(polygonAreaM2(walk.pts)).toFixed(2)} ac`;
    }
  }, (e) => toast('GPS: ' + e.message), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  $('#walkBtn').innerHTML = L('walkStop');
  redraw();
}
function stopWalk(apply) {
  if (!walk) return;
  navigator.geolocation.clearWatch(walk.id);
  if (apply && walk.pts.length >= 3) verts = simplifyWalk(walk.pts);
  else if (apply) toast(t('walkTooShort'));
  walk = null;
  $('#walkBtn').innerHTML = L('walkStart');
  redraw();
}

async function addCorner() {
  const b = $('#cornerBtn');
  b.disabled = true; b.innerHTML = L('averaging');
  try {
    const p = await averagedPosition(5);
    viewing = null;
    verts.push([p.lat, p.lon]);
    toast(t('cornerAdded', { n: verts.length, acc: Math.round(p.acc) }));
    mm.map.setView([p.lat, p.lon], Math.max(mm.map.getZoom(), 18));
    redraw();
  } catch (e) { toast(e.message); }
  b.disabled = false; b.innerHTML = L('addCorner');
}

async function save() {
  const label = $('#fieldLabel').value.trim();
  if (!label) { toast(t('needLabel')); $('#fieldLabel').focus(); return; }
  if (verts.length < 3) { toast(t('needCorners')); return; }
  if (isSelfIntersecting(verts)) { toast(t('selfIntersect')); return; }
  const f = await S.saveField({ label, boundary: verts, method: mode });
  app.settings.activeFieldId = f.id; await S.saveSettings(app.settings);
  verts = []; $('#fieldLabel').value = '';
  toast(t('fieldSaved', { a: acres(f.areaM2).toFixed(2) }));
  app.go('job');
}

/** For automated tests / debugging only. */
export const mapInstance = () => mm?.map;
