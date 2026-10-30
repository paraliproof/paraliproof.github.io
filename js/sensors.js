// sensors.js — real phone sensors: GPS, accelerometer, screen wake lock.
//
// All timestamps use ONE monotonic clock (performance.now) relative to the
// moment recording starts, so GPS and vibration samples line up exactly and
// a change of the phone's wall clock cannot corrupt the timeline.

/** iOS 13+ needs explicit permission for motion sensors, from a button tap. */
export async function requestMotionPermission() {
  const DME = globalThis.DeviceMotionEvent;
  if (!DME) return 'unsupported';
  if (typeof DME.requestPermission === 'function') {
    try { return await DME.requestPermission(); } catch { return 'denied'; }
  }
  return 'granted';
}

export class SensorSession {
  /**
   * @param {{onGps:(t,lat,lon,acc,speed,heading)=>void, onAccel:(t,x,y,z)=>void, onStatus?:(s)=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.watchId = null;
    this.wakeLock = null;
    this.perf0 = 0;
    this.accelCount = 0;
    this.lastGps = null;
    this._motion = this._motion.bind(this);
    this._vis = this._vis.bind(this);
  }

  now() { return performance.now() - this.perf0; }

  async start({ gps = true, motion = true } = {}) {
    this.perf0 = performance.now();
    this.startEpoch = Date.now();
    if (gps && navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (p) => {
          const c = p.coords;
          this.lastGps = { acc: c.accuracy, at: Date.now() };
          this.cb.onGps(this.now(), c.latitude, c.longitude, c.accuracy, c.speed, c.heading);
        },
        (e) => this.cb.onStatus?.({ gpsError: e.message || String(e.code) }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    }
    if (motion) window.addEventListener('devicemotion', this._motion);
    await this.acquireWakeLock();
    document.addEventListener('visibilitychange', this._vis);
  }

  _motion(e) {
    // accelerationIncludingGravity: the ML features find "down" from gravity, and |a| is
    // orientation-free for the built-in classifier. (Plain `acceleration` lacks gravity.)
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) { this.noGravity = !!e.acceleration; return; }
    // e.timeStamp is on the performance.now() clock in current browsers; very
    // old ones used epoch ms — detect that and fall back to performance.now().
    let ts = e.timeStamp;
    if (!(ts > 0) || Math.abs(ts - performance.now()) > 60000) ts = performance.now();
    this.accelCount++;
    this.cb.onAccel(ts - this.perf0, a.x, a.y, a.z);
  }

  async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.cb.onStatus?.({ wakeLock: true });
        this.wakeLock.addEventListener?.('release', () => this.cb.onStatus?.({ wakeLock: false }));
      } else this.cb.onStatus?.({ wakeLock: 'unsupported' });
    } catch { this.cb.onStatus?.({ wakeLock: false }); }
  }

  _vis() {
    // The wake lock is released whenever the page is hidden; take it again on return.
    if (document.visibilityState === 'visible' && this.watchId != null) this.acquireWakeLock();
    this.cb.onStatus?.({ visible: document.visibilityState === 'visible' });
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    window.removeEventListener('devicemotion', this._motion);
    document.removeEventListener('visibilitychange', this._vis);
    try { this.wakeLock?.release(); } catch {}
    this.wakeLock = null;
  }
}

/**
 * Record accelerometer + GPS for `seconds` (calibration step).
 * Returns {t[], m[] (|a|), xyz[[tEpochMs,x,y,z]], gps[[tEpochMs,lat,lon,acc,speed|null,heading|null]], startEpoch}.
 */
export function recordAccel(seconds, onProgress) {
  return new Promise((resolve) => {
    const t = [], m = [], xyz = [], gps = [];
    const nn = (v) => (v != null && Number.isFinite(v) && v >= 0 ? v : null);
    const s = new SensorSession({
      onGps: (tt, lat, lon, acc, speed, heading) => gps.push([s.startEpoch + tt, lat, lon, acc, nn(speed), nn(heading)]),
      onAccel: (tt, x, y, z) => { t.push(tt); m.push(Math.hypot(x, y, z)); xyz.push([s.startEpoch + tt, x, y, z]); },
    });
    s.start({ gps: true, motion: true });
    const t0 = performance.now();
    const iv = setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      onProgress?.(Math.min(1, el / seconds), m.length ? m[m.length - 1] : null);
      if (el >= seconds) { clearInterval(iv); s.stop(); resolve({ t, m, xyz, gps, startEpoch: s.startEpoch }); }
    }, 200);
  });
}

/** One-shot averaged position (for "stand at the corner" boundary mode). */
export function averagedPosition(seconds = 5, maxAcc = 25) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No GPS'));
    const fixes = [];
    const id = navigator.geolocation.watchPosition(
      (p) => { if (p.coords.accuracy <= maxAcc) fixes.push(p.coords); },
      (e) => { navigator.geolocation.clearWatch(id); reject(new Error(e.message)); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    setTimeout(() => {
      navigator.geolocation.clearWatch(id);
      if (!fixes.length) return reject(new Error('No accurate GPS fix yet — wait in the open and try again.'));
      const lat = fixes.reduce((a, c) => a + c.latitude, 0) / fixes.length;
      const lon = fixes.reduce((a, c) => a + c.longitude, 0) / fixes.length;
      const acc = Math.min(...fixes.map((c) => c.accuracy));
      resolve({ lat, lon, acc, n: fixes.length });
    }, seconds * 1000);
  });
}
