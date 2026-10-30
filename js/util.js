// util.js — small helpers shared by every module (no dependencies).
//
// Encoding helpers (base64url, UTF-8), canonical JSON, SHA-256 hashing,
// a seeded random-number generator for the simulator, and number formatting.

export const APP_VERSION = '1.7.0';

// ---------- text / bytes ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

// base64url (RFC 4648 §5): like base64 but URL/QR friendly, no '=' padding.
export function b64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- canonical JSON ----------
// JSON.stringify does not guarantee key order, so two programs could produce
// different text (and therefore different hashes/signatures) for the same
// object. canonical() sorts object keys recursively and drops `undefined`,
// so the same data always gives exactly the same string.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// ---------- hashing ----------
export async function sha256(data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
export async function sha256b64u(data) { return b64u(await sha256(data)); }
export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

// ---------- random ----------
// mulberry32: tiny, fast, *seeded* PRNG. Seeding makes the demo and the
// simulation reproducible (same seed → same synthetic job every time).
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box–Muller transform → standard normal N(0,1)
  next.normal = () => {
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

export function randomId(prefix = '', nBytes = 6) {
  const b = crypto.getRandomValues(new Uint8Array(nBytes));
  return prefix + hex(b).toUpperCase();
}

// ---------- numbers / formatting ----------
export const round = (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; };
export const M2_PER_ACRE = 4046.8564224; // international acre
export const M2_PER_HA = 10000;
export const acres = (m2) => m2 / M2_PER_ACRE;
export const hectares = (m2) => m2 / M2_PER_HA;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}
export function fmtDate(epochMs) {
  const d = new Date(epochMs);
  return d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export const fmtINR = (x) => '₹' + Math.round(x).toLocaleString('en-IN');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function readFileText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
