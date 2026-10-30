// geo.js — geometry helpers.
//
// Field-scale maths (a few hundred metres) is easiest in a flat "local"
// coordinate system measured in metres. We use the equirectangular
// approximation around an origin (lat0, lon0):
//     x = (lon − lon0) · cos(lat0) · R · π/180      (east, metres)
//     y = (lat − lat0) · R · π/180                  (north, metres)
// For a 1 km field the error versus a true geodesic is far below GPS noise
// (< 0.01 %), so it is safe for speeds, distances and the simulator.
// Area/buffer/union/intersection on the real map use Turf.js (geodesic).

export const R_EARTH = 6371008.8; // mean Earth radius, metres
const D2R = Math.PI / 180;

export function makeProjection(lat0, lon0) {
  const kx = Math.cos(lat0 * D2R) * R_EARTH * D2R;
  const ky = R_EARTH * D2R;
  return {
    lat0, lon0,
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLatLon: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}

// Great-circle distance in metres (haversine formula).
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Field boundary helpers. A boundary is stored as an array of [lat, lon]
// corners (not closed). GeoJSON uses [lon, lat] and a closed ring.
export function ringToPolygon(latlngs) {
  const ring = latlngs.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]);
  return globalThis.turf.polygon([ring]);
}

export function polygonAreaM2(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  return globalThis.turf.area(ringToPolygon(latlngs));
}

export function isSelfIntersecting(latlngs) {
  if (latlngs.length < 4) return false;
  try { return globalThis.turf.kinks(ringToPolygon(latlngs)).features.length > 0; } catch { return false; }
}

export function centroidLatLon(latlngs) {
  const c = globalThis.turf.centroid(ringToPolygon(latlngs)).geometry.coordinates;
  return [c[1], c[0]];
}

// Simplify a walked GPS boundary (many points) into a clean polygon.
// Douglas–Peucker with ~1.5 m tolerance removes GPS jitter but keeps corners.
export function simplifyWalk(latlngs, toleranceM = 1.5) {
  if (latlngs.length < 4) return latlngs;
  const proj = makeProjection(latlngs[0][0], latlngs[0][1]);
  const xy = latlngs.map(([a, b]) => proj.toXY(a, b));
  const keep = douglasPeucker(xy, toleranceM);
  let out = keep.map(([x, y]) => proj.toLatLon(x, y));
  // drop the last point if the walker returned to the start (ring is closed later)
  if (out.length > 3) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (haversine(a[0], a[1], b[0], b[1]) < 5) out = out.slice(0, -1);
  }
  return out;
}

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  // A walked boundary is a closed loop: first ≈ last, so the chord is (nearly) zero and the
  // line distance is meaningless (it collapsed a returned-to-start walk to 2 points, QA 28 Oct).
  // For a chord shorter than the tolerance, split at the point farthest from the start instead.
  const closed = L < eps;
  let iMax = 0, dMax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = closed ? Math.hypot(pts[i][0] - x1, pts[i][1] - y1) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L;
    if (d > dMax) { dMax = d; iMax = i; }
  }
  if (dMax <= eps) return [pts[0], pts[pts.length - 1]];
  const a = douglasPeucker(pts.slice(0, iMax + 1), eps);
  const b = douglasPeucker(pts.slice(iMax), eps);
  return a.slice(0, -1).concat(b);
}
