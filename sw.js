// sw.js — service worker: makes ParaliProof work offline after the first visit.
//
// Strategy:
//   • App shell (our HTML/CSS/JS/icons) — precached per VERSION on install (cache: 'reload', so never
//     from a stale HTTP cache) and served from that version's cache only. Every deploy must bump
//     VERSION: the browser sees the changed sw.js, installs the new version in the background, and
//     phones get it on the NEXT launch.
//   • Updates never take over a running page (29 Oct fix): NO skipWaiting() and NO clients.claim().
//     A new version installs, then WAITS until no page uses the old one, so one launch is always
//     entirely one version (the old HTML can never load the new JS), and no cache ever holds files
//     of two versions. The page shows a quiet "Update ready – close and reopen the app" note (js/app.js).
//   • Pinned CDN libraries and Google Fonts — cache-first (exact versions never change). The fonts are
//     precached at install (UX-4, 30 Oct): the first page load is not yet controlled by the worker, so the
//     font stylesheet and files never reached the cache and an offline reload fell back to system fonts.
//   • Map tiles — network-first, cached as you view them (max ~600 tiles) so a
//     field you looked at once still shows offline.
const VERSION = 'pp-v1.10.1-lay1';
const SHELL = `shell-${VERSION}`, LIBS = 'libs-v1', TILES = 'tiles-v1';
// Real Sentinel-2 tiles for the result screen (tools/make_sat_thumbs.py; tests/sat-tour.test.mjs checks this list).
const SAT_TILE_FILES = [
  './plugins/sat/img/field1_gujran_sangrur_2025_after.webp',
  './plugins/sat/img/field1_gujran_sangrur_2025_before.webp',
  './plugins/sat/img/field1_gujran_sangrur_2025_dnbr.webp',
  './plugins/sat/img/field2_mohala_malerkotla_2026_after.webp',
  './plugins/sat/img/field2_mohala_malerkotla_2026_before.webp',
  './plugins/sat/img/field2_mohala_malerkotla_2026_dnbr.webp',
  './plugins/sat/img/field3_abhaipur_patiala_2026_after.webp',
  './plugins/sat/img/field3_abhaipur_patiala_2026_before.webp',
  './plugins/sat/img/field3_abhaipur_patiala_2026_dnbr.webp',
  './plugins/sat/img/field4_haryana_kurukshetra_hotspot_2026_after.webp',
  './plugins/sat/img/field4_haryana_kurukshetra_hotspot_2026_before.webp',
  './plugins/sat/img/field4_haryana_kurukshetra_hotspot_2026_dnbr.webp',
  './plugins/sat/img/field5_haryana_karnal_nofire_2026_after.webp',
  './plugins/sat/img/field5_haryana_karnal_nofire_2026_before.webp',
  './plugins/sat/img/field5_haryana_karnal_nofire_2026_dnbr.webp',
  './plugins/sat/img/manifest.js',
];
// ILLUS_FILES:start (written by tools/make_illus.py)
const ILLUS_FILES = [
  './img/illus/cert-handover.webp',
  './img/illus/empty-certs.webp',
  './img/illus/empty-fields.webp',
  './img/illus/farmer-cert.webp',
  './img/illus/handover-card.webp',
  './img/illus/handover-people.webp',
  './img/illus/judge-intro.webp',
  './img/illus/offline.webp',
  './img/illus/rec-road.webp',
  './img/illus/rec-stopped.webp',
  './img/illus/rec-working.webp',
  './img/illus/setup-tractor.webp',
  './img/illus/welcome-trio.webp',
];
// ILLUS_FILES:end
const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './css/tokens.css', './css/components.css', './css/style.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './js/app.js', './js/ui.js', './js/strings.js', './js/icons.js', './js/util.js', './js/geo.js', './js/features.js',
  './js/classifier.js', './js/pipeline.js', './js/coverage.js', './js/flags.js', './js/crypto.js', './js/cert.js',
  './js/plugins.js', './js/sim.js', './js/sensors.js', './js/store.js', './js/mapsnap.js', './js/services.js',
  './js/views/record.js', './js/views/fields.js', './js/views/certs.js', './js/views/verify.js', './js/views/dash.js', './js/views/settings.js',
  './plugins/index.js', './plugins/ml/register.js', './plugins/ml/features.js', './plugins/ml/classifier.js', './plugins/ml/model.js',
  './plugins/impact/register.js', './plugins/impact/impact.js', './plugins/sat/register.js', './plugins/sat/precomputed.js', './plugins/sat/satellite-check.js',
  './js/tour.js', './js/tour-data.js', './js/realtrack.js',
  './js/roles.js', './js/scan.js', './js/qrformats.js', './js/authority.js', './demo/stickers.js', './plugins/sat/greenup.js',
  './js/crosscheck.js', './js/strings-gov.js', './js/gov.js', './js/govroles.js', './js/views/gov.js', './js/views/district.js', './demo/demo-district.json', './js/profile.js', './js/stateroots.js', './profiles/state-profiles.js', './demo/state-slips.js',
  './js/illus.js', './img/illus/manifest.js',
  './js/views/onboard.js', './js/views/opsetup.js', './js/views/phones.js', './js/views/farmer.js', './js/views/slip.js', './demo/index.js', './demo/demo-fleet.json', './demo/real-track-cau-tractor.json',
  './js/accounts.js', './js/demoseed.js', './js/strings-acc.js', './js/views/account.js', './js/walkthrough.js',
  ...SAT_TILE_FILES, ...ILLUS_FILES,
];
// Must equal the stylesheet href in index.html (tests/ux.test.mjs checks it).
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Noto+Sans+Gurmukhi:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap';
/** Cache the font stylesheet and every font file it names (best effort: never blocks the install). */
async function precacheFonts(libs) {
  try {
    let res = await libs.match(FONT_CSS);
    if (!res) { res = await fetch(FONT_CSS, { mode: 'cors' }); if (!res.ok) return; await libs.put(FONT_CSS, res.clone()); }
    const css = await res.text();
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/g)].map((m) => m[1]))];
    await Promise.all(urls.map(async (u) => { try { if (!(await libs.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await libs.put(u, r); } } catch {} }));
  } catch { /* offline install: the fonts arrive later through the cache-first fetch below */ }
}
const LIB_FILES = [
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // cache: 'reload' skips the browser's HTTP cache, so a new VERSION never precaches stale copies
    await (await caches.open(SHELL)).addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })));
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(async (u) => { if (!(await libs.match(u))) { try { await libs.add(new Request(u, { mode: 'cors' })); } catch {} } }));
    await precacheFonts(libs);
    // no skipWaiting(): this version activates only when no page runs the old one
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    // no clients.claim(): pages opened before this version keep the worker they started with
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 600; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isTile = /tile\.openstreetmap\.org|arcgisonline\.com/.test(url.host);
  const isLib = /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (isTile) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { const c = await caches.open(TILES); c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch { return (await caches.match(req)) || Response.error(); }
    })());
    return;
  }
  if (isLib) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(LIBS)).put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    // Version-atomic shell (29 Oct fix): answer from THIS version's precache only. A file this version did
    // not precache comes from the network (cache: 'no-cache' = revalidated with the server) and is NOT
    // written into the cache — background revalidation used to copy the next version's files into this
    // version's cache, so a later launch could still mix old HTML with new JS. Offline: index.html.
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(req.url, { cache: 'no-cache' }); }
      catch { return (req.mode === 'navigate' && (await cache.match('./index.html'))) || Response.error(); }
    })());
  }
});
