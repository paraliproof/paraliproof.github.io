// plugins/sat/register.js — satellite layer (seva-geospatial, sat/).
//
// satellite-check.js is an UNMODIFIED copy of sat/web/satellite-check.js. precomputed.js
// is generated from sat/out/*.json + sat/fields/*.geojson by tools/sync_plugins.py.
//
// How a job gets its ext.satellite section:
//   • REAL jobs → sat/web's makeParaliProofHook({ precomputed }): it matches a precomputed
//     sat_check.py result by location (≤ 150 m) AND date window; if none matches it returns
//     an honest INCONCLUSIVE ("no satellite analysis available for this field yet").
//     NASA FIRMS blocks browsers (no CORS), so live FIRMS is not attempted; the precomputed
//     result already contains sat_check.py's FIRMS hits.
//   • DEMO jobs (simulated, run "today") → the same precomputed results matched by LOCATION
//     only, because the demo job's date is not the satellite date window. The section is
//     marked precomputed and keeps its real dates, so the UI and certificate show which
//     parcel and which Sentinel-2 dates the verdict belongs to.
//   • Manual: any sat/out/*.json can be attached on the result screen (summarizeSat).
// All three produce sat/web's toCertificateSection() format (+ field_name, centroid, precomputed).

import PRE from './precomputed.js';
import TILES from './img/manifest.js';
import GREENUPS from './greenup.js';
import { makeParaliProofHook, toCertificateSection, matchPrecomputed as satMatch, boundaryToGeoJSON, VERSION as SAT_WEB_VERSION } from './satellite-check.js';
import { registerSatelliteCheck, registerDemoParcels, registerGreenups } from '../../js/plugins.js';
import { haversine } from '../../js/geo.js';

export const PRECOMPUTED = PRE;
export { SAT_WEB_VERSION };

/** sat_check.py result (or satelliteCheck() section) → ext.satellite (sat/web format + names for the UI). */
export function summarizeSat(d) {
  if (!d || typeof d !== 'object' || !d.verdict) throw new Error('Not a sat_check result (no "verdict")');
  const c = d.field?.centroid; // [lon, lat]
  return {
    ...toCertificateSection(d),
    field_name: d.field?.name || null,
    centroid: Array.isArray(c) ? [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5] : null,
    precomputed: d.method !== 'none yet',
  };
}

/** Precomputed result whose parcel matches this field centroid [lat, lon] (≤ 150 m, any date), or null. */
export function matchPrecomputed(centroid) {
  for (const d of PRE) {
    const c = d.field?.centroid;
    if (c && haversine(centroid[0], centroid[1], c[1], c[0]) <= 150) return d;
  }
  return null;
}

const liveHook = makeParaliProofHook({ precomputed: PRE });

/**
 * Real Sentinel-2 tiles (img/manifest.js, made by tools/make_sat_thumbs.py) for a job's ext.satellite
 * section, or null. The parcel must match by name AND lie within 150 m, so tiles are never shown
 * for a field the images are not of.
 */
export const SAT_TILES = TILES;
export function satTilesFor(sat) {
  if (!sat || sat.error || !sat.field_name) return null;
  for (const e of Object.values(TILES || {})) {
    if (e.name !== sat.field_name || !e.tiles?.before || !e.tiles?.after || !e.tiles?.dnbr) continue;
    const a = sat.centroid, b = e.centroid;
    if (Array.isArray(a) && Array.isArray(b) && haversine(a[0], a[1], b[0], b[1]) > 150) continue;
    return e;
  }
  return null;
}

/** The app's satellite hook (exported for tests). */
export async function satelliteHook(ctx) {
  if (ctx.job?.demo) {
    const d = matchPrecomputed(ctx.field.centroid);
    return d ? { ...summarizeSat(d), source: 'demo-location-match' } : null;
  }
  const s = await liveHook(ctx);
  // makeParaliProofHook returns only the certificate section; add the parcel name when it matched
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const d = satMatch(PRE, boundaryToGeoJSON(ctx.field.boundary), day(ctx.job.t0), day(ctx.job.t1));
  return { ...s, source: d ? 'precomputed' : 'none', field_name: d?.field?.name || null, centroid: ctx.field.centroid ? ctx.field.centroid.map((x) => Math.round(x * 1e5) / 1e5) : null, precomputed: !!d };
}

registerDemoParcels(PRE.filter((d) => d.boundary).map((d) => ({ name: d.field?.name, key: d.key, boundary: d.boundary, verdict: d.verdict, jobDate: GREENUPS.find((g) => g.field === d.key)?.job_date || null })));
registerSatelliteCheck(satelliteHook);
// green-up results name the precomputed key; add the parcel name the certificate's ext.satellite carries
registerGreenups(GREENUPS.map((g) => ({ ...g, field_name: PRE.find((d) => d.key === g.field)?.field?.name || null })));
export { GREENUPS };
