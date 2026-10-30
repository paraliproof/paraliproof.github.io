// satellite-check.js — ParaliProof satellite layer, browser side (ES module, no dependencies).
// Owner: seva-geospatial (sat/).  Drop-in for seva-software; nothing here touches app/.
//
// WHY THIS IS NOT A FULL CLIENT-SIDE CHECK
//   * NASA FIRMS CSVs send NO `Access-Control-Allow-Origin` header (tested 27 Oct 2026 with
//     curl -I/-X OPTIONS and a real browser fetch), so a web page cannot read them.
//     -> firmsProximity() works on CSV text you already have (from a server job or a file).
//   * Earth Search STAC and the Sentinel-2 COG bucket DO allow CORS (`*`), so the browser can
//     list scenes live (listScenes). Reading the pixels in-browser would need a GeoTIFF decoder
//     (e.g. geotiff.js) and is left to the production server job, which runs sat/sat_check.py.
//   -> For the prototype, satelliteCheck() returns a PRE-COMPUTED `satellite` section produced
//      by sat_check.py (pass it in, or a URL to it), optionally re-checking FIRMS proximity
//      client-side and adding a live scene list.
//
// Main API
//   satelliteCheck(fieldGeoJSON, startDate, endDate, opts?)  -> Promise<SatelliteSection>
//   toCertificateSection(section)                           -> small object for ext.satellite
//   makeParaliProofHook({precomputed:[...], liveScenes})    -> fn(ctx) for registerSatelliteCheck
//   firmsProximity(fieldGeoJSON, csvText, start, end, opts)  -> [{...hit, distance_m}]
//   listScenes(fieldGeoJSON, start, end, opts)               -> Promise<[{id,date,cloud_pct,tile}]>
//   fetchFirmsCsv(url)                                       -> Promise<{ok, text?, blocked?, error?}>

export const VERSION = 'sat-web 0.2.0';
export const EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1';
export const FIRMS_NRT = {
  VIIRS_SNPP: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_7d.csv',
  VIIRS_NOAA20: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_7d.csv',
  VIIRS_NOAA21: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_Asia_7d.csv',
  MODIS: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_Asia_7d.csv',
};
export const BUFFER_M = { VIIRS: 500, MODIS: 1000 };
export const VERDICTS = ['NOT_BURNED', 'BURN_SUSPECTED', 'INCONCLUSIVE'];

// ---------------------------------------------------------------- geometry helpers
/** Outer ring of the first polygon as [[lon,lat],...] from Feature / FeatureCollection / geometry. */
export function ringOf(gj) {
  if (!gj) throw new Error('no field geometry');
  if (gj.type === 'FeatureCollection') gj = gj.features[0];
  if (gj.type === 'Feature') gj = gj.geometry;
  if (gj.type === 'Polygon') return gj.coordinates[0];
  if (gj.type === 'MultiPolygon') return gj.coordinates[0][0];
  throw new Error('field must be a Polygon');
}

/** ParaliProof app boundary [[lat,lon],...] -> GeoJSON Polygon. */
export function boundaryToGeoJSON(boundary) {
  const ring = boundary.map(([lat, lon]) => [lon, lat]);
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
  return { type: 'Polygon', coordinates: [ring] };
}

export function centroidOf(gj) {
  const r = ringOf(gj);
  const n = r.length - (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; }
  return [x / n, y / n]; // [lon, lat]
}

// local equirectangular projection around the field (metres) — fine at field scale (< 10 km)
function projector(lon0, lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Distance in metres from [lon,lat] to the field polygon (0 inside). */
export function distanceToField(gj, lonlat) {
  const ring = ringOf(gj), [lon0, lat0] = centroidOf(gj), P = projector(lon0, lat0);
  const r = ring.map(P), p = P(lonlat);
  if (pointInRing(p, r)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(p, r[i], r[i + 1]));
  return d;
}

// ---------------------------------------------------------------- FIRMS
/** Parse a FIRMS CSV (NRT or archive format). */
export function parseFirmsCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  return lines.map((l) => { const v = l.split(','); const o = {}; head.forEach((h, i) => (o[h] = v[i])); return o; });
}

/**
 * Fire detections near the field between start and end (YYYY-MM-DD, UTC, inclusive).
 * sensor: 'VIIRS' (500 m buffer) or 'MODIS' (1000 m) unless opts.bufferM is given.
 */
export function firmsProximity(fieldGeoJSON, csvText, start, end, opts = {}) {
  const sensor = opts.sensor || 'VIIRS';
  const buf = opts.bufferM ?? (sensor.startsWith('MODIS') ? BUFFER_M.MODIS : BUFFER_M.VIIRS);
  const [lon0, lat0] = centroidOf(fieldGeoJSON);
  const dLat = (buf + 2000) / 110574, dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
  const out = [];
  for (const r of parseFirmsCsv(csvText)) {
    const lat = +r.latitude, lon = +r.longitude, d = r.acq_date;
    if (!(d >= start && d <= end) || Math.abs(lat - lat0) > dLat || Math.abs(lon - lon0) > dLon) continue;
    const dist = distanceToField(fieldGeoJSON, [lon, lat]);
    if (dist <= buf) {
      out.push({ sensor, satellite: r.satellite, date: d, time_utc: r.acq_time, lat, lon,
        distance_m: Math.round(dist), confidence: r.confidence, frp_mw: r.frp ? +r.frp : null });
    }
  }
  return out.sort((a, b) => (a.date + a.time_utc).localeCompare(b.date + b.time_utc));
}

/** Try to fetch a FIRMS CSV from the browser. FIRMS has no CORS header -> {blocked:true}. */
export async function fetchFirmsCsv(url) {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, text: await r.text() };
  } catch (e) {
    // A CORS rejection surfaces as an opaque TypeError ("Failed to fetch").
    return { ok: false, blocked: true, error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------- STAC (CORS-enabled)
/** Sentinel-2 L2A scenes covering the field (live, from Earth Search). */
export async function listScenes(fieldGeoJSON, start, end, opts = {}) {
  const geom = { type: 'Polygon', coordinates: [ringOf(fieldGeoJSON)] };
  const body = { collections: [opts.collection || 'sentinel-2-l2a'], intersects: geom,
    datetime: `${start}T00:00:00Z/${end}T23:59:59Z`, limit: opts.limit || 50,
    fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'properties.grid:code'] } };
  const r = await fetch(`${opts.stac || EARTH_SEARCH}/search`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`STAC HTTP ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f) => ({ id: f.id, date: (f.properties.datetime || '').slice(0, 10),
    cloud_pct: Math.round((f.properties['eo:cloud_cover'] ?? NaN) * 10) / 10,
    tile: (f.properties['grid:code'] || '').replace('MGRS-', '') }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- main entry
/**
 * satelliteCheck(fieldGeoJSON, startDate, endDate, opts)
 *   opts.precomputed : a sat_check.py result object, OR an array of them (matched by centroid
 *                      <= 150 m and overlapping window), OR a URL to one JSON file.
 *   opts.firmsCsv    : {VIIRS_SNPP: csvText, ...} — re-run FIRMS proximity client-side
 *                      (e.g. CSVs fetched by your own server/proxy).
 *   opts.tryDirectFirms : true -> attempt browser fetch of FIRMS (documents the CORS block).
 *   opts.liveScenes  : true -> add live Sentinel-2 scene list from Earth Search.
 * Resolves to the `satellite` section (sat_check.py schema). If nothing precomputed matches,
 * verdict is INCONCLUSIVE with reason "no satellite analysis available for this field yet".
 */
export async function satelliteCheck(fieldGeoJSON, startDate, endDate, opts = {}) {
  const notes = [];
  let base = null;
  let pre = opts.precomputed;
  if (typeof pre === 'string') {
    const r = await fetch(pre);
    if (!r.ok) throw new Error(`precomputed fetch HTTP ${r.status}`);
    pre = await r.json();
  }
  if (Array.isArray(pre)) base = matchPrecomputed(pre, fieldGeoJSON, startDate, endDate);
  else if (pre && pre.verdict) base = pre;

  const c = centroidOf(fieldGeoJSON);
  const section = base ? JSON.parse(JSON.stringify(base)) : {
    method: 'none yet', version: VERSION, window: { start: startDate, end: endDate },
    field: { centroid: c }, scenes: [], firms_hits: [], valid_pct: 0,
    verdict: 'INCONCLUSIVE', confidence: 'low', primary_signal: 'sentinel2_burn_scar',
    reasons: ['no satellite analysis available for this field yet (run sat/sat_check.py as a server job)'],
    generated_at: new Date().toISOString(),
  };
  if (base) notes.push('satellite analysis pre-computed by sat_check.py');

  // FIRMS: client-side re-check when CSV text is available
  let csvs = opts.firmsCsv || null;
  if (!csvs && opts.tryDirectFirms) {
    csvs = {};
    for (const [k, url] of Object.entries(FIRMS_NRT)) {
      const res = await fetchFirmsCsv(url);
      if (res.ok) csvs[k] = res.text;
      else notes.push(`FIRMS ${k}: ${res.blocked ? 'blocked by CORS (no Access-Control-Allow-Origin)' : res.error}`);
    }
  }
  if (csvs && Object.keys(csvs).length) {
    const hits = [];
    for (const [k, text] of Object.entries(csvs)) {
      hits.push(...firmsProximity(fieldGeoJSON, text, startDate, endDate, { sensor: k }));
    }
    section.firms_hits_client = hits;
    notes.push(`FIRMS re-checked in browser: ${hits.length} hotspot(s) within buffer`);
  }
  if (opts.liveScenes) {
    try {
      section.scenes_available = await listScenes(fieldGeoJSON, startDate, endDate);
      notes.push(`${section.scenes_available.length} Sentinel-2 scenes listed live from Earth Search`);
    } catch (e) { notes.push(`live scene list failed: ${e.message || e}`); }
  }
  section.web = { version: VERSION, notes };
  return section;
}

/** Pick the precomputed result whose field centroid is within maxM of this field's. */
export function matchPrecomputed(list, fieldGeoJSON, start, end, maxM = 150) {
  const c = centroidOf(fieldGeoJSON);
  let best = null, bestD = Infinity;
  for (const d of list) {
    const fc = d?.field?.centroid;
    if (!fc) continue;
    const m = Math.hypot((fc[0] - c[0]) * 111320 * Math.cos((c[1] * Math.PI) / 180), (fc[1] - c[1]) * 110574);
    const overlaps = !start || !d.window || (d.window.start <= end && d.window.end >= start);
    if (m <= maxM && overlaps && m < bestD) { best = d; bestD = m; }
  }
  return best;
}

/** Small, stable object for the signed certificate (ext.satellite). */
export function toCertificateSection(s) {
  if (!s || !s.verdict) throw new Error('not a satellite section');
  const hits = Array.isArray(s.firms_hits) ? s.firms_hits : [];
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    source: 'Sentinel-2 L2A burn scar (primary) + NASA FIRMS hotspots (supporting)',
    tool: s.version || null,
    verdict: s.verdict,
    confidence: s.confidence ?? null,
    primary_signal: s.primary_signal || 'sentinel2_burn_scar',
    nbr_before: r3(s.nbr_before), nbr_after: r3(s.nbr_after), dnbr_mean: r3(s.dnbr_mean),
    ndvi_before: r3(s.ndvi_before), ndvi_after: r3(s.ndvi_after),
    burnlike_pct: s.burnlike_pct ?? null, ambiguous_pct: s.ambiguous_pct ?? null, valid_pct: s.valid_pct ?? null,
    firms_hits: hits.length,
    firms_nearest_m: hits.length ? Math.min(...hits.map((h) => h.distance_m)) : null,
    scenes: (s.scenes || []).map((x) => ({ role: x.role, date: x.date, id: x.id, cloud_pct: x.cloud_pct })),
    window: s.window || null,
    generated_at: s.generated_at || null,
    attribution: s.attribution || 'Contains modified Copernicus Sentinel data; NASA FIRMS',
    caveat: 'burn-like signature, not ground-verified; never an automatic penalty',
  };
}

/**
 * Hook for the ParaliProof app:  registerSatelliteCheck(makeParaliProofHook({precomputed: LIST}))
 * ctx = { field: {boundary:[[lat,lon],...]}, job: {t0, t1} }  (t0/t1 ms epoch or ISO)
 */
export function makeParaliProofHook(opts = {}) {
  return async (ctx) => {
    const gj = boundaryToGeoJSON(ctx.field.boundary);
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const s = await satelliteCheck(gj, day(ctx.job.t0), day(ctx.job.t1), opts);
    return toCertificateSection(s);
  };
}

/** Human label for UI badges. */
export function verdictLabel(v) {
  return { NOT_BURNED: 'Not burned', BURN_SUSPECTED: 'Burn-like signature (not ground-verified)', INCONCLUSIVE: 'Inconclusive (cloud / no data)' }[v] || v;
}
