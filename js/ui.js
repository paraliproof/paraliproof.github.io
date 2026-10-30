// ui.js — shared UI helpers: translations, toasts, modal dialogs, maps.

import { STRINGS } from './strings.js';
import { escapeHtml } from './util.js';
import { icon } from './icons.js';

// ---------- i18n ----------
let lang = 'en';
let showSecond = false;
// One language at a time (docs/ux/DESIGN-DIRECTION.md). `second` is kept for compatibility but ignored.
export function setLang(l, second) { lang = STRINGS._langs.includes(l) ? l : 'en'; showSecond = false; document.documentElement.lang = lang; }
export const getLang = () => lang;
const secondLang = () => (lang === 'en' ? 'hi' : 'en');

function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s; }
function raw(key, l) { const e = STRINGS[key]; if (!e) return null; return e[l] || e.en; }

/** Plain text in the primary language. */
export function t(key, vars) { return fill(raw(key, lang) ?? key, vars); }
/** HTML: primary language + small second-language line (if enabled and different). */
export function L(key, vars) {
  const a = t(key, vars);
  if (!showSecond) return escapeHtml(a);
  const b = fill(raw(key, secondLang()) ?? '', vars);
  return escapeHtml(a) + (b && b !== a ? `<span class="l2">${escapeHtml(b)}</span>` : '');
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = L(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = escapeHtml;

let toastTimer = null;
/**
 * UX-3: where a toast may sit without covering a primary action. Pure (viewport px), so it is unit-tested.
 * bars: bottom-anchored bars on screen (tab bar, sticky action/stop bar, tour bar) → the toast goes above the
 * highest one. buttons: visible primary buttons → if the toast would cover one, it moves to the top instead,
 * just under the top bar. Returns { edge: 'bottom' | 'top', px } (px = distance from that edge).
 */
export function placeToast({ vh, h, gap = 12, bars = [], buttons = [], topLimit = 0 }) {
  // bars stack from the bottom edge up (tab bar, then a sticky action bar resting on it, …)
  let barTop = vh;
  for (let moved = true; moved;) {
    moved = false;
    for (const b of bars) if (b.bottom > b.top && b.bottom >= barTop - 2 && b.top < barTop) { barTop = b.top; moved = true; }
  }
  const bottomPx = Math.round(vh - barTop + gap);
  const band = { top: vh - bottomPx - h, bottom: vh - bottomPx };
  const hits = (a, b) => a.top < b.bottom && a.bottom > b.top;
  if (band.top > topLimit + gap && !buttons.some((r) => hits(band, r))) return { edge: 'bottom', px: bottomPx };
  return { edge: 'top', px: Math.round(topLimit + gap) };
}
const BOTTOM_BARS = '.pp-tabbar, .pp-actionbar, .rec-stopbar, #tourBar, #walkBar';
const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden'; };
export function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  try {
    const vh = innerHeight;
    const bars = $$(BOTTOM_BARS).filter(shown).map((n) => n.getBoundingClientRect());
    const buttons = $$('.btn-primary, .btn-stop, .pp-btn--primary').filter((n) => shown(n) && !n.closest(BOTTOM_BARS) && !n.closest('#modal')).map((n) => n.getBoundingClientRect()).filter((r) => r.bottom > 0 && r.top < vh);
    const top = $('.pp-topbar'); const topLimit = top && shown(top) ? Math.max(0, top.getBoundingClientRect().bottom) : 0;
    const pos = placeToast({ vh, h: el.offsetHeight || 56, bars, buttons, topLimit });
    el.style.top = pos.edge === 'top' ? pos.px + 'px' : 'auto';
    el.style.bottom = pos.edge === 'bottom' ? pos.px + 'px' : 'auto';
    el.dataset.edge = pos.edge;
  } catch { /* keep the CSS default position */ }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** UX-3 / M-10: confirm a signed action ON its button ("Signed ✓"), instead of a toast. Resolves after a beat. */
export async function signedInline(btn, text) {
  haptic(30);
  if (btn && btn.isConnected) {
    btn.innerHTML = `${icon('check')}<span>${esc(text || t('gov.signed_ok'))}</span>`;
    btn.classList.add('is-signed'); btn.setAttribute('aria-disabled', 'true');
    const live = $('#toast'); if (live) { live.hidden = true; }
    const sr = $('#srStatus'); if (sr) sr.textContent = text || t('gov.signed_ok');
  }
  await new Promise((r) => setTimeout(r, prefersReducedMotion() ? 500 : 1200));
}

// ---------- the Genuine tick (30 Oct): an animated check for the "Genuine certificate" verdict only ----------
// Inline SVG, drawn with stroke-dashoffset in CSS (css/style.css "Genuine tick"): circle 420 ms → check 260 ms →
// one soft ring 600 ms, and the title fades up 6 px; under 1.2 s, once. It plays the FIRST time a certificate's
// Genuine verdict appears on this page; a re-render (language switch, coming back) shows the final state at once.
// Reduced motion and print: the final state, no motion. Same 32 px box and stroke as the static icon.
const tickSeen = new Set();
export function genuineTick(key) {
  const k = String(key ?? '');
  const play = !!k && !tickSeen.has(k);
  if (k) tickSeen.add(k);
  return { play, html: `<svg class="pp-icon pp-tick${play ? ' pp-tick--play' : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-tick>
    <circle class="pp-tick__ripple" cx="12" cy="12" r="10"/><circle class="pp-tick__circle" cx="12" cy="12" r="10" pathLength="100"/><path class="pp-tick__check" d="m8.5 12.2 2.4 2.4 4.6-4.8" pathLength="100"/></svg>` };
}

// ---------- haptics (UX-1, micro-interactions M-2 / M-3 / M-4 / M-8) ----------
// Guarded: only where navigator.vibrate exists, only after the user has touched the page (browsers
// refuse it before), never throws, and off when Settings → "Vibrate on key moments" is off.
let hapticsOn = true;
export function setHaptics(on) { hapticsOn = on !== false; }
export function haptic(pattern) {
  try {
    if (!hapticsOn || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
    return navigator.vibrate(pattern) !== false;
  } catch { return false; }
}
export const prefersReducedMotion = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  return $('#modalBody');
}
export function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }

export function confirmBox(message, okKey = 'ok', cancelKey = 'cancel') {
  return new Promise((resolve) => {
    const body = openModal(`<p style="font-size:1.05rem">${esc(message)}</p>
      <div class="row end"><button class="btn btn-ghost" data-r="0">${L(cancelKey)}</button><button class="btn btn-primary" data-r="1">${L(okKey)}</button></div>`);
    body.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { closeModal(); resolve(b.dataset.r === '1'); }));
  });
}

// ---------- maps ----------
export function makeMap(el, { center = [30.2, 76.3], zoom = 8, zoomControl = true } = {}) {
  const Lf = globalThis.L;
  // zoomControl: false while recording (UX-1: no +/− buttons to mis-tap with gloves; pinch still works)
  const map = Lf.map(el, { zoomControl, attributionControl: true, tap: true }).setView(center, zoom);
  const osm = Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  // Optional aerial imagery: field edges are visible, which helps when tapping corners.
  const sat = Lf.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, maxNativeZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  });
  let satOn = false;
  // lay-1: the map's box changes with the layout (laptop grids, a view shown again); keep Leaflet in step.
  // A hidden map (0 × 0) is skipped, so its centre never drifts.
  if (typeof ResizeObserver === 'function') {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (el.clientWidth && el.clientHeight) map.invalidateSize(); }); }).observe(el);
  }
  return {
    map,
    toggleSatellite() {
      satOn = !satOn;
      if (satOn) { map.removeLayer(osm); sat.addTo(map); } else { map.removeLayer(sat); osm.addTo(map); }
      return satOn;
    },
  };
}

/** Map colours come from tokens.css so light/dark themes switch the map too. */
export const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
export const STATE_COLORS = {
  get WORKING() { return cssVar('--map-worked', '#1E5B3A'); },
  get TRANSIT() { return cssVar('--c-warning', '#B54708'); },
  get IDLE() { return cssVar('--c-ink-faint', '#8E968F'); },
  get BOUNDARY() { return cssVar('--map-boundary', '#101410'); },
};

// ---------- safe formatting for untrusted payload values (security review F-02) ----------
/** Number → fixed decimals, or '–' if the value is not a finite number. Safe to put in innerHTML. */
export const fx = (v, d = 2) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '–'; };
/** Integer with Indian grouping, or '–'. */
export const fint = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '–'; };
/** Render an SVG string as an <img> (scripts and external loads cannot run inside an image). */
export const svgImg = (svg, alt = '') => `<img class="svg-img" alt="${escapeHtml(alt)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg))}">`;
