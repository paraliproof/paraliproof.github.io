// illus.js — the 12 illustration slots (docs/ux/ILLUSTRATIONS.md §1, DESIGN-DIRECTION amendment of 30 Oct).
// Files come from app/img/illus/ via the generated manifest (tools/make_illus.py). The rules:
//   • a slot whose file is missing renders NOTHING: no <img>, no box, no gap, no placeholder art
//     (and if a listed file fails to load, the slot removes itself);
//   • the box keeps the image's aspect ratio before it loads (width/height attributes), so nothing jumps;
//   • never on a data, decision or verdict screen; at most one per screen (the callers below are the only ones);
//   • motion: a 150 ms fade, plus the three sets of §4.1 (recording wheels, the handover card, the setup slide);
//     everything stops under prefers-reduced-motion (css/style.css) and the wheels only turn while WORKING or
//     TRANSIT and the page is visible.
// Decorative images get alt="" (the screen's words say the same thing); the welcome, farmer, empty-fields,
// offline and judge images carry the alt text of ILLUSTRATIONS.md §5 through strings.js (illus.<name>).
import MANIFEST from '../img/illus/manifest.js';
import { t, esc } from './ui.js';

export const ILLUS = MANIFEST;
const has = (name) => Object.hasOwn(MANIFEST, name) && !!MANIFEST[name]?.src;
// welcome-trio is decorative here (the lead's call, 30 Oct): the language buttons carry the meaning
const ALT = new Set(['farmer-cert', 'empty-fields', 'offline', 'judge-intro', 'cert-handover', 'handover-people']);
const alt = (name) => (ALT.has(name) ? t('illus.' + (name === 'handover-people' ? 'cert-handover' : name)) : '');

/** <img> markup for a slot, or '' when the file is missing (callers can concatenate it safely). */
export function illusImg(name, cls = '') {
  if (!has(name)) return '';
  const f = MANIFEST[name];
  return `<img class="illus ${esc(cls)}" src="${esc(f.src)}" width="${Number(f.w) || 1}" height="${Number(f.h) || 1}" alt="${esc(alt(name))}" decoding="async" data-illus-img>`;
}

/** Fill `el` with the slot's image, or empty and hide it. Returns true when an image was placed. */
export function illusHTML(el, name, cls = '') {
  if (!el) return false;
  const html = illusImg(name, cls);
  el.innerHTML = html;
  el.hidden = !html;
  if (html) guard(el);
  return !!html;
}

/** A listed file that fails to load takes its slot with it (no broken-image icon, no gap). */
export function guard(root) {
  root.querySelectorAll?.('img[data-illus-img]').forEach((img) => {
    if (img.dataset.guarded) return; img.dataset.guarded = '1';
    img.addEventListener('error', () => { const slot = img.closest('.illus-slot'); img.remove(); if (slot && !slot.querySelector('img')) { slot.innerHTML = ''; slot.hidden = true; } }, { once: true });
  });
}

// ---------- slot 3: the recording strip (rec-working / rec-road / rec-stopped) ----------
// The three images share one crop box (tools/make_illus.py), so they swap without a jump. Each carries vector
// rims at the measured wheel centres: a perfect circle turning about its own centre never wobbles, and it
// covers only the light rim, so the drawn tyre and the stubble in front stay as drawn (ILLUSTRATIONS.md §4.4).
const REC = { WORKING: 'rec-working', TRANSIT: 'rec-road', IDLE: 'rec-stopped' };
function rims(f) {
  if (!Array.isArray(f.wheels) || f.wheels.length !== 2) return '';
  const H = (100 * f.h) / f.w; // viewBox height in "percent of width" units
  const rim = (w, cls) => {
    const x = Number(w.x), y = (Number(w.y) / 100) * H, r = Number(w.r);
    if (![x, y, r].every(Number.isFinite) || r <= 0) return '';
    const bolts = [0, 1, 2, 3, 4].map((i) => { const a = (i * 72 - 90) * Math.PI / 180; return `<circle cx="${(x + 0.47 * r * Math.cos(a)).toFixed(3)}" cy="${(y + 0.47 * r * Math.sin(a)).toFixed(3)}" r="${(0.075 * r).toFixed(3)}"/>`; }).join('');
    const ticks = [45, 135, 225, 315].map((d) => { const a = d * Math.PI / 180; return `<line x1="${(x + 0.62 * r * Math.cos(a)).toFixed(3)}" y1="${(y + 0.62 * r * Math.sin(a)).toFixed(3)}" x2="${(x + 0.86 * r * Math.cos(a)).toFixed(3)}" y2="${(y + 0.86 * r * Math.sin(a)).toFixed(3)}"/>`; }).join('');
    const col = /^#[0-9A-F]{6}$/i.test(w.color) ? w.color : '#E7F0EA';
    return `<g class="rim ${cls}"><circle class="rim__disc" cx="${x}" cy="${y.toFixed(3)}" r="${(r * 1.02).toFixed(3)}" fill="${col}" stroke-width="${(0.07 * r).toFixed(3)}"/><g class="rim__ticks" stroke-width="${(0.12 * r).toFixed(3)}">${ticks}</g><circle class="rim__hub" cx="${x}" cy="${y.toFixed(3)}" r="${(0.24 * r).toFixed(3)}" stroke-width="${(0.05 * r).toFixed(3)}"/><g class="rim__bolts">${bolts}</g></g>`;
  };
  return `<svg class="rec-illus__rims" viewBox="0 0 100 ${H.toFixed(3)}" preserveAspectRatio="none" aria-hidden="true">${rim(f.wheels[0], 'rim--rear')}${rim(f.wheels[1], 'rim--front')}</svg>`;
}
/** Build the strip once per recording. Shows nothing unless all three images exist. */
export function recIllusBuild(el) {
  if (!el) return false;
  const names = Object.values(REC);
  if (!names.every(has)) { el.innerHTML = ''; el.hidden = true; return false; }
  const f0 = MANIFEST[names[0]];
  el.style.aspectRatio = `${f0.w} / ${f0.h}`; // reserve the box: no layout shift
  el.innerHTML = names.map((n) => `<div class="rec-illus__frame" data-frame="${n}">${illusImg(n)}${rims(MANIFEST[n])}</div>`).join('');
  el.hidden = false; guard(el);
  el.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { el.innerHTML = ''; el.hidden = true; }, { once: true }));
  return true;
}
/** Show the frame for WORKING / TRANSIT / IDLE (150 ms cross-fade in CSS; none under reduced motion). */
export function recIllusState(el, label) {
  if (!el || el.hidden) return;
  const n = REC[label] || REC.IDLE;
  el.dataset.state = String(label || 'IDLE').toLowerCase();
  el.querySelectorAll('.rec-illus__frame').forEach((f) => f.classList.toggle('is-on', f.dataset.frame === n));
}
// the wheels stop when the screen is hidden (battery), and start again when it is back
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('is-hidden-page', !!document.hidden); });

// ---------- slot 4: "Certificate ready" (Set B: people + card, the card rises once) ----------
export function handoverHTML(el) {
  if (!el) return false;
  if (has('handover-people') && has('handover-card')) {
    const f = MANIFEST['handover-people'];
    el.innerHTML = `<div class="illus-stack" style="aspect-ratio:${Number(f.w) || 3} / ${Number(f.h) || 2}">${illusImg('handover-people')}${illusImg('handover-card', 'card-in')}</div>`;
    el.hidden = false;
    // either layer failing → the single image (or nothing)
    el.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => illusHTML(el, 'cert-handover'), { once: true }));
    return true;
  }
  return illusHTML(el, 'cert-handover');
}
