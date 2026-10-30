// flags.js — lightweight, honest anti-fraud / data-quality checks.
//
// These are WARNINGS printed on the certificate, not proof of fraud. They tell
// an officer "look more closely at this one". Each flag has a code (short, goes
// into the signed certificate), a severity and a plain-language reason.
//
// What a phone web app CANNOT detect (stated openly): a rooted phone with a
// fake-GPS app feeding consistent positions, or a phone carried on a different
// vibrating machine. Mitigations: the vibration–speed consistency check below,
// the satellite layer (sat/), and officer spot checks.

import { haversine } from './geo.js';
import { median } from './util.js';
import { MAX_ACC_M } from './coverage.js';
import { DEFAULT_SPEED } from './classifier.js';

export const FLAG_INFO = {
  DEMO:            { sev: 'info', en: 'Demo data (a simulated job or a replayed public recording) — not a real job.', hi: 'डेमो डेटा (सिम्युलेटेड काम या दोबारा चलाई गई सार्वजनिक रिकॉर्डिंग) — असली काम नहीं।', pa: 'ਡੈਮੋ ਡਾਟਾ (ਸਿਮੂਲੇਟਡ ਕੰਮ ਜਾਂ ਦੁਬਾਰਾ ਚਲਾਈ ਜਨਤਕ ਰਿਕਾਰਡਿੰਗ) — ਅਸਲ ਕੰਮ ਨਹੀਂ।' },
  UNCALIBRATED:    { sev: 'warn', en: 'Vibration not calibrated for this phone/tractor; default thresholds used.', hi: 'इस फ़ोन/ट्रैक्टर के लिए कैलिब्रेशन नहीं हुआ।', pa: 'ਇਸ ਫ਼ੋਨ/ਟਰੈਕਟਰ ਲਈ ਕੰਬਣੀ ਕੈਲੀਬ੍ਰੇਟ ਨਹੀਂ; ਆਮ ਸੀਮਾਵਾਂ ਵਰਤੀਆਂ।' },
  WEAK_CALIBRATION:{ sev: 'warn', en: 'Calibration could not clearly separate working from driving.', hi: 'कैलिब्रेशन में काम और ड्राइविंग अलग नहीं हुए।', pa: 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਵਿੱਚ ਕੰਮ ਅਤੇ ਚਲਾਉਣਾ ਸਾਫ਼ ਵੱਖ ਨਹੀਂ ਹੋਏ।' },
  NO_MOTION_SENSOR:{ sev: 'high', en: 'Accelerometer data missing for most of the job — work inferred from GPS speed only.', hi: 'एक्सेलेरोमीटर डेटा नहीं — केवल GPS गति से अनुमान।', pa: 'ਕੰਮ ਦੇ ਜ਼ਿਆਦਾ ਹਿੱਸੇ ਲਈ ਐਕਸੇਲੇਰੋਮੀਟਰ ਡਾਟਾ ਨਹੀਂ — ਸਿਰਫ਼ GPS ਰਫ਼ਤਾਰ ਤੋਂ ਅੰਦਾਜ਼ਾ।' },
  POOR_GPS:        { sev: 'warn', en: 'GPS accuracy was poor (median worse than 10 m or many fixes worse than 20 m).', hi: 'GPS सटीकता कमज़ोर थी।', pa: 'GPS ਸਟੀਕਤਾ ਕਮਜ਼ੋਰ ਸੀ (ਔਸਤ 10 ਮੀ. ਤੋਂ ਮਾੜੀ ਜਾਂ ਕਈ ਫ਼ਿਕਸ 20 ਮੀ. ਤੋਂ ਮਾੜੇ)।' },
  SPEED_JUMP:      { sev: 'high', en: 'Impossible position jumps (> 40 km/h for a tractor in the field).', hi: 'असंभव GPS छलांग (> 40 किमी/घं)।', pa: 'ਅਸੰਭਵ GPS ਛਾਲਾਂ (ਖੇਤ ਵਿੱਚ ਟਰੈਕਟਰ ਲਈ > 40 ਕਿ.ਮੀ./ਘੰ.)।' },
  NO_VIBRATION:    { sev: 'high', en: 'Phone was moving but almost not vibrating — may not have been on a tractor.', hi: 'फ़ोन चल रहा था पर कंपन लगभग नहीं — शायद ट्रैक्टर पर नहीं था।', pa: 'ਫ਼ੋਨ ਚੱਲ ਰਿਹਾ ਸੀ ਪਰ ਲਗਭਗ ਕੰਬ ਨਹੀਂ ਰਿਹਾ ਸੀ — ਸ਼ਾਇਦ ਟਰੈਕਟਰ ਉੱਤੇ ਨਹੀਂ ਸੀ।' },
  GPS_GAP:         { sev: 'warn', en: 'Long gaps (> 30 s) in GPS recording.', hi: 'GPS रिकॉर्डिंग में लंबे अंतराल (> 30 से.)।', pa: 'GPS ਰਿਕਾਰਡਿੰਗ ਵਿੱਚ ਲੰਮੇ ਪਾੜੇ (> 30 ਸ.)।' },
  SENSOR_GAP:      { sev: 'warn', en: 'Accelerometer stopped for > 5 s (screen locked or app in background?).', hi: 'एक्सेलेरोमीटर > 5 से. रुका (स्क्रीन लॉक?)।', pa: 'ਐਕਸੇਲੇਰੋਮੀਟਰ > 5 ਸ. ਰੁਕਿਆ (ਸਕਰੀਨ ਲੌਕ ਜਾਂ ਐਪ ਪਿੱਛੇ?)।' },
  OUTSIDE_FIELD:   { sev: 'warn', en: 'More than 10 % of worked area lies outside the field boundary.', hi: '10% से अधिक काम खेत की सीमा से बाहर।', pa: 'ਕੰਮ ਦਾ 10% ਤੋਂ ਵੱਧ ਖੇਤਰ ਖੇਤ ਦੀ ਹੱਦ ਤੋਂ ਬਾਹਰ।' },
  LOW_CONFIDENCE:  { sev: 'warn', en: 'Work/transit classification had low average confidence.', hi: 'वर्गीकरण का विश्वास स्तर कम।', pa: 'ਕੰਮ/ਰਾਹ ਦੀ ਪਛਾਣ ਦਾ ਔਸਤ ਭਰੋਸਾ ਘੱਟ ਸੀ।' },
  // added at verification time:
  HASH_MISMATCH:   { sev: 'high', en: 'Raw data does not match the certificate track hash — data edited or replaced.', hi: 'कच्चा डेटा हैश से मेल नहीं खाता — डेटा बदला गया।', pa: 'ਕੱਚਾ ਡਾਟਾ ਸਰਟੀਫਿਕੇਟ ਦੇ ਟਰੈਕ ਹੈਸ਼ ਨਾਲ ਮੇਲ ਨਹੀਂ ਖਾਂਦਾ — ਡਾਟਾ ਬਦਲਿਆ ਗਿਆ।' },
  DUPLICATE:       { sev: 'high', en: 'Same track data already used in another certificate (replay).', hi: 'यही ट्रैक डेटा दूसरे प्रमाणपत्र में पहले से है।', pa: 'ਇਹੀ ਟਰੈਕ ਡਾਟਾ ਪਹਿਲਾਂ ਦੂਜੇ ਸਰਟੀਫਿਕੇਟ ਵਿੱਚ ਵਰਤਿਆ ਗਿਆ (ਦੁਹਰਾਅ)।' },
  SAT_BURN_SUSPECTED: { sev: 'high', en: 'Satellite (Sentinel-2 / FIRMS) suggests this field was burned — check before paying.', hi: 'सैटेलाइट के अनुसार खेत जलाया गया हो सकता है — भुगतान से पहले जाँचें।', pa: 'ਸੈਟੇਲਾਈਟ ਅਨੁਸਾਰ ਖੇਤ ਸਾੜਿਆ ਗਿਆ ਹੋ ਸਕਦਾ ਹੈ — ਭੁਗਤਾਨ ਤੋਂ ਪਹਿਲਾਂ ਜਾਂਚੋ।' },
  SAT_INCONCLUSIVE: { sev: 'info', en: 'Satellite check inconclusive (no analysis for this field and date yet, or cloudy images).', hi: 'सैटेलाइट जाँच तय नहीं कर सकी (बादल या कम चित्र)।', pa: 'ਸੈਟੇਲਾਈਟ ਜਾਂਚ ਫ਼ੈਸਲਾ ਨਹੀਂ ਕਰ ਸਕੀ।' },
  UNTRUSTED_KEY:   { sev: 'high', en: 'Signature OK – device not registered – do not pay.', hi: 'हस्ताक्षर सही – डिवाइस पंजीकृत नहीं – भुगतान न करें।', pa: 'ਦਸਤਖ਼ਤ ਸਹੀ – ਡਿਵਾਈਸ ਰਜਿਸਟਰਡ ਨਹੀਂ – ਭੁਗਤਾਨ ਨਾ ਕਰੋ।' },
  WEAK_KEY:        { sev: 'warn', en: 'This phone could not store a protected key; its signing key is software-readable.', hi: 'यह फ़ोन सुरक्षित कुंजी नहीं रख सका; कुंजी पढ़ी जा सकती है।', pa: 'ਇਹ ਫ਼ੋਨ ਸੁਰੱਖਿਅਤ ਕੁੰਜੀ ਨਹੀਂ ਰੱਖ ਸਕਿਆ; ਕੁੰਜੀ ਪੜ੍ਹੀ ਜਾ ਸਕਦੀ ਹੈ।' },
  RULE_CLASSIFIER: { sev: 'info', en: 'Work detected by the phone-calibrated rule, not the fixed ML model.', hi: 'काम फ़ोन पर कैलिब्रेट नियम से पहचाना गया, स्थिर ML मॉडल से नहीं।', pa: 'ਕੰਮ ਫ਼ੋਨ ਉੱਤੇ ਕੈਲੀਬ੍ਰੇਟ ਨਿਯਮ ਨਾਲ ਪਛਾਣਿਆ, ਸਥਿਰ ML ਮਾਡਲ ਨਾਲ ਨਹੀਂ।' },
  NON_DEFAULT_LIMITS: { sev: 'warn', en: 'Speed limits for idle/transit were changed from the defaults on this phone.', hi: 'इस फ़ोन पर गति सीमाएँ डिफ़ॉल्ट से बदली गईं।', pa: 'ਇਸ ਫ਼ੋਨ ਉੱਤੇ ਰਫ਼ਤਾਰ ਸੀਮਾਵਾਂ ਡਿਫ਼ਾਲਟ ਤੋਂ ਬਦਲੀਆਂ ਗਈਆਂ।' },
  SAT_MANUAL:      { sev: 'info', en: 'Satellite result was attached by hand (checked: same parcel, overlapping dates).', hi: 'सैटेलाइट परिणाम हाथ से जोड़ा गया।', pa: 'ਸੈਟੇਲਾਈਟ ਨਤੀਜਾ ਹੱਥ ਨਾਲ ਜੋੜਿਆ ਗਿਆ।' },
  WIDTH_SELF_DECLARED: { sev: 'warn', en: 'Machine and working width were typed by hand, not read from a signed machine sticker.', hi: 'मशीन और चौड़ाई हाथ से भरी गई, हस्ताक्षरित मशीन स्टिकर से नहीं।', pa: 'ਮਸ਼ੀਨ ਅਤੇ ਚੌੜਾਈ ਹੱਥ ਨਾਲ ਭਰੀ ਗਈ, ਦਸਤਖ਼ਤੀ ਮਸ਼ੀਨ ਸਟਿੱਕਰ ਤੋਂ ਨਹੀਂ।' },
  NO_JOB_SLIP:     { sev: 'warn', en: "No farmer's job slip was scanned, so registered acres are unknown.", hi: 'किसान की जॉब स्लिप स्कैन नहीं हुई, पंजीकृत एकड़ पता नहीं।', pa: 'ਕਿਸਾਨ ਦੀ ਜੌਬ ਸਲਿੱਪ ਸਕੈਨ ਨਹੀਂ ਹੋਈ, ਰਜਿਸਟਰਡ ਏਕੜ ਪਤਾ ਨਹੀਂ।' },
  AREA_EXCEEDS_REGISTERED: { sev: 'warn', en: 'The field drawn or the area worked is more than 5 % above the registered acres; payment is capped at the registered acres.', hi: 'बनाया गया खेत या काम का क्षेत्र पंजीकृत एकड़ से 5% से ज़्यादा है; भुगतान पंजीकृत एकड़ तक सीमित।', pa: 'ਬਣਾਇਆ ਖੇਤ ਜਾਂ ਕੰਮ ਦਾ ਖੇਤਰ ਰਜਿਸਟਰਡ ਏਕੜ ਤੋਂ 5% ਤੋਂ ਵੱਧ ਹੈ; ਭੁਗਤਾਨ ਰਜਿਸਟਰਡ ਏਕੜ ਤੱਕ ਸੀਮਤ।' },
  OVERLAP:         { sev: 'high', en: 'Another certificate this season covers more than 30 % of the same field.', hi: 'इसी मौसम का दूसरा प्रमाणपत्र इसी खेत का 30% से ज़्यादा हिस्सा दिखाता है।', pa: 'ਇਸੇ ਮੌਸਮ ਦਾ ਦੂਜਾ ਸਰਟੀਫਿਕੇਟ ਇਸੇ ਖੇਤ ਦਾ 30% ਤੋਂ ਵੱਧ ਹਿੱਸਾ ਦਿਖਾਉਂਦਾ ਹੈ।' },
  // Phase 1, 29 Oct (js/crosscheck.js). hi/pa are first drafts: NEEDS NATIVE CHECK.
  SLIP_FIELD_MISMATCH: { sev: 'high', en: "The farmer's slip points away from the field that was worked (centre more than 150 m outside it, or the slip boundary covers less than half of it). Maybe the wrong slip was scanned. Please check.", hi: 'किसान की स्लिप जिस जगह की है, वह जुताई वाले खेत से दूर है। शायद गलत स्लिप स्कैन हुई। कृपया जाँचें।', pa: 'ਕਿਸਾਨ ਦੀ ਸਲਿੱਪ ਵਾਲੀ ਥਾਂ ਕੰਮ ਵਾਲੇ ਖੇਤ ਤੋਂ ਦੂਰ ਹੈ। ਸ਼ਾਇਦ ਗਲਤ ਸਲਿੱਪ ਸਕੈਨ ਹੋਈ। ਕਿਰਪਾ ਕਰਕੇ ਜਾਂਚੋ।' },
  SELF_OPERATED:   { sev: 'info', en: "Self-operated: the farmer used his own (or his family's) machine. That is allowed. This claim is in the extra-check group (higher audit rate).", hi: 'स्वयं चलाई मशीन: किसान ने अपनी (या परिवार की) मशीन चलाई। यह मान्य है। यह दावा अतिरिक्त जाँच समूह में है।', pa: 'ਆਪ ਚਲਾਈ ਮਸ਼ੀਨ: ਕਿਸਾਨ ਨੇ ਆਪਣੀ (ਜਾਂ ਪਰਿਵਾਰ ਦੀ) ਮਸ਼ੀਨ ਵਰਤੀ। ਇਹ ਮਨਜ਼ੂਰ ਹੈ। ਇਹ ਦਾਅਵਾ ਵਾਧੂ ਜਾਂਚ ਸਮੂਹ ਵਿੱਚ ਹੈ।' },
  SLIP_REUSED:     { sev: 'high', en: 'This farmer slip appears on more than one certificate. Pay at most the registered acres across all of them.', hi: 'यह किसान स्लिप एक से ज़्यादा प्रमाणपत्रों पर है। सब मिलाकर पंजीकृत एकड़ से ज़्यादा भुगतान न करें।', pa: 'ਇਹ ਕਿਸਾਨ ਸਲਿੱਪ ਇੱਕ ਤੋਂ ਵੱਧ ਸਰਟੀਫਿਕੇਟਾਂ ਉੱਤੇ ਹੈ। ਸਾਰਿਆਂ ਨੂੰ ਮਿਲਾ ਕੇ ਰਜਿਸਟਰਡ ਏਕੜ ਤੋਂ ਵੱਧ ਭੁਗਤਾਨ ਨਾ ਕਰੋ।' },
  CAPACITY:        { sev: 'high', en: 'This machine (sticker or phone) has more acres on this day than its type can work in a day (limit set in Settings). One of these jobs may not be real.', hi: 'इस मशीन के इस दिन के एकड़ उसकी एक दिन की क्षमता से ज़्यादा हैं। इनमें से कोई काम असली न हो सकता है।', pa: 'ਇਸ ਮਸ਼ੀਨ ਦੇ ਇਸ ਦਿਨ ਦੇ ਏਕੜ ਉਸ ਦੀ ਇੱਕ ਦਿਨ ਦੀ ਸਮਰੱਥਾ ਤੋਂ ਵੱਧ ਹਨ। ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੋਈ ਕੰਮ ਅਸਲ ਨਾ ਹੋ ਸਕਦਾ ਹੈ।' },
  MACHINE_TIME_CLASH: { sev: 'high', en: 'The same machine sticker or phone was recorded on two jobs at the same time. One of them may use a copied sticker.', hi: 'एक ही मशीन स्टिकर या फ़ोन एक ही समय पर दो कामों में दर्ज है। किसी एक में नकली स्टिकर हो सकता है।', pa: 'ਇੱਕੋ ਮਸ਼ੀਨ ਸਟਿੱਕਰ ਜਾਂ ਫ਼ੋਨ ਇੱਕੋ ਸਮੇਂ ਦੋ ਕੰਮਾਂ ਵਿੱਚ ਦਰਜ ਹੈ। ਕਿਸੇ ਇੱਕ ਵਿੱਚ ਨਕਲੀ ਸਟਿੱਕਰ ਹੋ ਸਕਦਾ ਹੈ।' },
  BOUNDARY_MISMATCH: { sev: 'warn', en: "The field boundary in this file does not match the certificate's signed field hash, so it was ignored (no map, no overlap check).", hi: 'इस फ़ाइल की खेत सीमा प्रमाणपत्र के हस्ताक्षरित हैश से मेल नहीं खाती, इसलिए छोड़ी गई।', pa: 'ਇਸ ਫ਼ਾਈਲ ਦੀ ਖੇਤ ਹੱਦ ਸਰਟੀਫਿਕੇਟ ਦੇ ਦਸਤਖ਼ਤੀ ਹੈਸ਼ ਨਾਲ ਮੇਲ ਨਹੀਂ ਖਾਂਦੀ, ਇਸ ਲਈ ਛੱਡੀ ਗਈ।' },
  NO_STATE_SLIP:   { sev: 'warn', en: 'No state slip: the farmer made this slip himself, so the parcel and registered acres are not from the state record. Use normal verification.', hi: 'राज्य स्लिप नहीं: स्लिप किसान ने ख़ुद बनाई; सामान्य जाँच करें।', pa: 'ਰਾਜ ਸਲਿੱਪ ਨਹੀਂ: ਸਲਿੱਪ ਕਿਸਾਨ ਨੇ ਆਪ ਬਣਾਈ; ਆਮ ਜਾਂਚ ਕਰੋ।' },
  CHAIN_BREAK:     { sev: 'info', en: 'Hash chain broken — a certificate from this device is missing or out of order.', hi: 'हैश-चेन टूटी — इस डिवाइस का कोई प्रमाणपत्र गायब है।', pa: 'ਹੈਸ਼-ਲੜੀ ਟੁੱਟੀ — ਇਸ ਡਿਵਾਈਸ ਦਾ ਕੋਈ ਸਰਟੀਫਿਕੇਟ ਗਾਇਬ ਜਾਂ ਕ੍ਰਮ ਤੋਂ ਬਾਹਰ ਹੈ।' },
};

/**
 * @param {object} job  {raw, windows, demo, calib, coverage}
 * @returns {string[]}  flag codes
 */
export function computeFlags(job) {
  const flags = [];
  const { raw, windows, coverage } = job;
  const gps = raw.gps;
  if (job.demo) flags.push('DEMO');
  if (job.classifierKind === 'rule' && !job.calib?.calibrated) flags.push('UNCALIBRATED');
  if (job.classifierKind === 'rule') flags.push('RULE_CLASSIFIER');
  if (job.limits && (job.limits.idleKmh !== DEFAULT_SPEED.idleKmh || job.limits.maxWorkKmh !== DEFAULT_SPEED.maxWorkKmh)) flags.push('NON_DEFAULT_LIMITS');
  if (job.calib?.calibrated && job.calib.separation != null && job.calib.separation < 1.0) flags.push('WEAK_CALIBRATION');

  const withVib = windows.filter((w) => w.rms != null).length;
  if (windows.length && withVib / windows.length < 0.5) flags.push('NO_MOTION_SENSOR');

  if (gps.length) {
    const accs = gps.map((g) => g[3]);
    const bad = accs.filter((a) => a > MAX_ACC_M).length;
    if (median(accs) > 10 || bad / accs.length > 0.25) flags.push('POOR_GPS');
    let jumps = 0, gaps = 0;
    for (let i = 1; i < gps.length; i++) {
      const dt = (gps[i][0] - gps[i - 1][0]) / 1000;
      const d = haversine(gps[i - 1][1], gps[i - 1][2], gps[i][1], gps[i][2]);
      if (dt > 30) gaps++;
      else if (dt > 0 && d > 15 && (d / dt) * 3.6 > 40) jumps++;
    }
    if (jumps > 0) flags.push('SPEED_JUMP');
    if (gaps > 0) flags.push('GPS_GAP');
  }

  // Vibration–speed consistency: a phone on a running tractor always vibrates.
  const moving = windows.filter((w) => w.speedKmh != null && w.speedKmh > 1.5 && w.rms != null);
  if (moving.length >= 10 && moving.filter((w) => w.rms < 0.04).length / moving.length > 0.3) flags.push('NO_VIBRATION');

  const T = raw.accT;
  if (T.length > 1) {
    let sg = 0;
    for (let i = 1; i < T.length; i++) if (T[i] - T[i - 1] > 5000) sg++;
    if (sg) flags.push('SENSOR_GAP');
  }

  if (coverage && coverage.workedM2 + coverage.outsideM2 > 0 && coverage.outsideM2 / (coverage.workedM2 + coverage.outsideM2) > 0.10) flags.push('OUTSIDE_FIELD');

  const sat = job.ext?.satellite;
  if (sat && !sat.error) {
    if (sat.source === 'manual') flags.push('SAT_MANUAL');
    if (sat.verdict === 'BURN_SUSPECTED') flags.push('SAT_BURN_SUSPECTED');
    else if (sat.verdict && sat.verdict !== 'NOT_BURNED') flags.push('SAT_INCONCLUSIVE');
  }

  // anti-cheat set (jobs from app v1.2: job.machine / job.slip are present, possibly null)
  if ('machine' in job && !(job.machine?.source === 'sticker' && job.machine?.mh)) flags.push('WIDTH_SELF_DECLARED');
  if ('slip' in job) {
    if (!job.slip?.jh) flags.push('NO_JOB_SLIP');
    else {
      if (job.slipCheck?.mismatch) flags.push('SLIP_FIELD_MISMATCH');
      if (job.slip.ss === 'F') flags.push('NO_STATE_SLIP');
      if (coverage && (coverage.fieldAcres > job.slip.ra * 1.05 || coverage.workedAcres > job.slip.ra * 1.05)) flags.push('AREA_EXCEEDS_REGISTERED');
    }
  }
  if (job.selfOp) flags.push('SELF_OPERATED'); // declared, or the slip was made on this phone (D3-A)

  const work = windows.filter((w) => w.label === 'WORKING');
  if (work.length && work.reduce((a, w) => a + w.conf, 0) / work.length < 0.6) flags.push('LOW_CONFIDENCE');
  return flags;
}
