// crypto.js — device key pair and digital signatures (WebCrypto, built into every browser).
//
// ECDSA P-256 with SHA-256 (the same curve used by HTTPS certificates and
// UPI/Aadhaar-grade systems). How it works, in one paragraph for the viva:
//   On first run the phone generates a key pair. The PRIVATE key never leaves
//   the phone — we create it as "non-extractable", so even this app's own
//   JavaScript cannot read or export it; it can only ask the browser to sign.
//   The PUBLIC key is shared freely. Signing = a 64-byte number computed from
//   (certificate text, private key). Anyone with the public key can check it.
//   Change even one character of the certificate and the check fails.
//
// Limitation (honest): a signature proves the certificate was made by THIS
// device key and not changed afterwards. It does not prove the device is
// trustworthy — that is why officers keep a list of trusted (enrolled) device
// keys, and why the certificate also carries fraud flags.

import { b64u, unb64u, sha256, hex, utf8 } from './util.js';

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

/** Key id: first 8 bytes of SHA-256(public key), shown as XXXX-XXXX-XXXX-XXXX. */
export async function keyId(pubRaw) {
  const h = hex((await sha256(pubRaw)).slice(0, 8)).toUpperCase();
  return h.match(/.{4}/g).join('-');
}

/**
 * Load the device key from storage, or create one.
 * @param {{get:(k:string)=>Promise<any>, set:(k:string,v:any)=>Promise<void>}} kv
 * @param {string} name  storage key: 'deviceKey' (this phone), or 'officerKey:<account>' for a DEMO officer
 *                       account's own signing key (js/gov.js) — also generated HERE, on this phone.
 */
export async function getDeviceKey(kv, name = 'deviceKey') {
  let rec = await kv.get(name);
  if (rec) {
    if (rec.jwk) { // fallback format (see below)
      const privateKey = await crypto.subtle.importKey('jwk', rec.jwk, ALG, false, ['sign']);
      return { ...rec, privateKey };
    }
    return rec;
  }
  const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  rec = { privateKey: pair.privateKey, pub: b64u(pubRaw), kid: await keyId(pubRaw), createdAt: Date.now() };
  try {
    await kv.set(name, rec); // IndexedDB can store a CryptoKey object directly
  } catch {
    // Some older browsers cannot store CryptoKey objects. Fall back to an
    // extractable key saved as JWK (weaker: the app could read it).
    const p2 = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', p2.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', p2.privateKey);
    rec = { jwk, pub: b64u(raw2), kid: await keyId(raw2), createdAt: Date.now(), weak: true };
    await kv.set(name, rec);
    rec = { ...rec, privateKey: p2.privateKey };
  }
  return rec;
}

// ---- signature canonical form (security review F-08) ----
// An ECDSA signature (r, s) and (r, n − s) are BOTH valid for the same data. If we
// accepted both, anyone could turn one certificate into a second "different" QR
// (different hash → false CHAIN_BREAK / DUPLICATE). So we always sign with the
// low-S form (s ≤ n/2) and reject high-S signatures when verifying.
const P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
const HALF_N = P256_N >> 1n;
const toBig = (u8) => u8.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
const toBytes32 = (x) => { const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xFFn); x >>= 8n; } return out; };
export function isLowS(sig) { return sig.length === 64 && toBig(sig.subarray(32)) <= HALF_N; }
export function toLowS(sig) {
  const s = toBig(sig.subarray(32));
  if (s <= HALF_N) return sig;
  const out = new Uint8Array(64); out.set(sig.subarray(0, 32), 0); out.set(toBytes32(P256_N - s), 32);
  return out;
}

/** Only uncompressed P-256 points (65 bytes, first byte 0x04) are accepted (review F-10). */
export function isValidPubRaw(raw) { return raw instanceof Uint8Array && raw.length === 65 && raw[0] === 0x04; }
export function isValidPubB64u(pub) { try { return typeof pub === 'string' && isValidPubRaw(unb64u(pub)); } catch { return false; } }

export async function signText(privateKey, text) {
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, privateKey, utf8(text)));
  return b64u(toLowS(sig));
}

/** true only for a valid, LOW-S signature by an uncompressed P-256 key. */
export async function verifyText(pubB64u, text, sigB64u) {
  try {
    const raw = unb64u(pubB64u), sig = unb64u(sigB64u);
    if (!isValidPubRaw(raw) || sig.length !== 64 || !isLowS(sig)) return false;
    const pub = await crypto.subtle.importKey('raw', raw, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, pub, sig, utf8(text));
  } catch {
    return false;
  }
}

/** Used in tests and the simulator: a throwaway in-memory key pair. */
export async function ephemeralKey() {
  const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, pub: b64u(pubRaw), kid: await keyId(pubRaw) };
}
