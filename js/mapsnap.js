// mapsnap.js — vector "map snapshot" for the printable certificate, and QR rendering.
//
// The certificate map is drawn as SVG from our own geometry (field boundary,
// worked zone, track) instead of screenshotting map tiles: it prints sharply,
// works offline and has no copyright/CORS issues with tile images.

import { makeProjection } from './geo.js';
import { WINDOW_MS } from './features.js';

// Restrained palette (ui/css/tokens.css): worked = the one accent, transit/idle = muted dashes.
const COLORS = { WORKING: '#1E5B3A', TRANSIT: '#B54708', IDLE: '#8E968F' };

export function mapSnapshotSVG({ boundary, coverageGeo, gps, windows, width = 640, height = 420, scaleBar = true }) {
  const proj = makeProjection(boundary[0][0], boundary[0][1]);
  const pts = boundary.map(([a, b]) => proj.toXY(a, b));
  const track = (gps || []).filter((g) => g[3] <= 20).map((g) => ({ xy: proj.toXY(g[1], g[2]), label: windows?.[Math.floor(g[0] / WINDOW_MS)]?.label || 'IDLE' }));
  // frame on the field (+ part of the track near it)
  let xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const fx0 = Math.min(...xs), fx1 = Math.max(...xs), fy0 = Math.min(...ys), fy1 = Math.max(...ys);
  const padM = Math.max(15, 0.25 * Math.max(fx1 - fx0, fy1 - fy0));
  const near = track.filter((p) => p.xy[0] > fx0 - padM && p.xy[0] < fx1 + padM && p.xy[1] > fy0 - padM && p.xy[1] < fy1 + padM);
  xs = xs.concat(near.map((p) => p.xy[0])); ys = ys.concat(near.map((p) => p.xy[1]));
  const x0 = Math.min(...xs) - 8, x1 = Math.max(...xs) + 8, y0 = Math.min(...ys) - 8, y1 = Math.max(...ys) + 8;
  const s = Math.min((width - 20) / (x1 - x0), (height - 20) / (y1 - y0));
  const ox = (width - s * (x1 - x0)) / 2, oy = (height - s * (y1 - y0)) / 2;
  const P = ([x, y]) => [(ox + (x - x0) * s).toFixed(1), (height - oy - (y - y0) * s).toFixed(1)];
  const path = (ring) => ring.map((p, i) => (i ? 'L' : 'M') + P(p).join(',')).join('') + 'Z';

  let cov = '';
  if (coverageGeo?.geometry) {
    const polys = coverageGeo.geometry.type === 'Polygon' ? [coverageGeo.geometry.coordinates] : coverageGeo.geometry.coordinates;
    const d = polys.map((poly) => poly.map((ring) => path(ring.map(([lon, lat]) => proj.toXY(lat, lon)))).join('')).join('');
    cov = `<path d="${d}" fill="#1E5B3A" fill-opacity="0.55" fill-rule="evenodd" stroke="none"/>`;
  }
  // track as polylines grouped by state
  let tr = '';
  let cur = null, buf = [];
  const flush = () => {
    if (buf.length > 1) {
      const dash = cur === 'WORKING' ? '' : ' stroke-dasharray="4 3"';
      tr += `<polyline points="${buf.map((p) => P(p).join(',')).join(' ')}" fill="none" stroke="${COLORS[cur]}" stroke-width="${cur === 'WORKING' ? 1 : 1.2}" stroke-linejoin="round"${dash} opacity="${cur === 'WORKING' ? 0.5 : 0.9}"/>`;
    }
  };
  for (const p of track) {
    if (p.label !== cur) { if (buf.length) { const last = buf[buf.length - 1]; flush(); buf = [last]; } else flush(); cur = p.label; }
    buf.push(p.xy);
  }
  flush();

  // scale bar: round length ≈ 1/4 of width
  let sb = '';
  if (scaleBar) {
    const target = (width / 4) / s;
    const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const L = nice * s;
    sb = `<g transform="translate(16,${height - 18})"><line x1="0" y1="0" x2="${L}" y2="0" stroke="#535C55" stroke-width="1.5"/><line x1="0" y1="-4" x2="0" y2="0" stroke="#535C55" stroke-width="1.5"/><line x1="${L}" y1="-4" x2="${L}" y2="0" stroke="#535C55" stroke-width="1.5"/><text x="${L + 6}" y="4" font-size="11" fill="#535C55" font-family="Plus Jakarta Sans, sans-serif">${nice} m</text></g>`;
  }
  const north = `<g transform="translate(${width - 28},30)"><path d="M0,-10 L0,8 M-4,-6 L0,-10 L4,-6" fill="none" stroke="#535C55" stroke-width="1.5" stroke-linecap="round"/><text y="22" x="-3.5" font-size="10" fill="#535C55" font-family="Plus Jakarta Sans, sans-serif">N</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Field map" class="snap">
<rect width="${width}" height="${height}" fill="#F5F6F4"/>
<path d="${path(pts)}" fill="#FFFFFF" stroke="none"/>
${cov}
${tr}
<path d="${path(pts)}" fill="none" stroke="#101410" stroke-width="2" stroke-linejoin="round"/>
${sb}${north}</svg>`;
}

/** QR code as an SVG string (qrcode-generator library, UTF-8 byte mode). */
export function qrSVG(text, { ecc = 'M', cell = 4, margin = 4 } = {}) {
  const Q = globalThis.qrcode;
  if (!Q) return '<p>QR library not loaded (offline on first run?)</p>';
  Q.stringToBytes = Q.stringToBytesFuncs['UTF-8'];
  const qr = Q(0, ecc);
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
}
export function qrVersion(text, ecc = 'M') {
  const Q = globalThis.qrcode; if (!Q) return null;
  Q.stringToBytes = Q.stringToBytesFuncs['UTF-8'];
  const qr = Q(0, ecc); qr.addData(text, 'Byte'); qr.make();
  return (qr.getModuleCount() - 17) / 4;
}
