// scan.js — one reusable "read a QR" dialog: camera (BarcodeDetector or jsQR), a photo of the QR,
// or pasted text. Resolves with the text, or null if cancelled. The text is UNTRUSTED: callers parse
// it with the strict parsers in qrformats.js / cert.js and escape anything they display.

import { openModal, closeModal, t, L, esc, toast } from './ui.js';
import { icon } from './icons.js';
import { MAX_QR_CHARS } from './qrformats.js';

export function scanQr({ title, hint = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let stream = null, live = false, done = false;
    const body = openModal(`<h3>${esc(title)}</h3>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      <div class="scan-dlg__cam" hidden><video playsinline muted></video><div class="scan-frame"></div></div>
      <div class="row wrap">
        <button type="button" class="btn btn-primary" data-a="cam">${icon('scan')}<span>${L('scanQr')}</span></button>
        <label class="btn btn-ghost file-btn">${icon('download')}<span>${L('uploadQr')}</span><input type="file" accept="image/*" hidden></label>
      </div>
      <details class="paste"><summary class="pp-section__title">${L('scan.paste')}</summary>
        <textarea class="inp mono" rows="3" maxlength="${MAX_QR_CHARS}" aria-label="${esc(t('scan.paste'))}" placeholder="${esc(placeholder)}"></textarea>
        <button type="button" class="btn btn-ghost btn-dense" data-a="use">${L('scan.use')}</button></details>
      <div class="row end"><button type="button" class="btn btn-ghost" data-a="cancel">${L('cancel')}</button></div>`);
    const finish = (text) => {
      if (done) return; done = true; live = false;
      stream?.getTracks().forEach((tr) => tr.stop());
      closeModal();
      resolve(text == null ? null : String(text).trim().slice(0, MAX_QR_CHARS));
    };
    body.querySelector('[data-a="cancel"]').addEventListener('click', () => finish(null));
    body.querySelector('[data-a="use"]').addEventListener('click', () => { const v = body.querySelector('textarea').value.trim(); if (v) finish(v); });
    body.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } });
    body.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const text = await decodeImage(f); e.target.value = '';
      if (text) finish(text); else toast(t('noQrFound'));
    });
    body.querySelector('[data-a="cam"]').addEventListener('click', async () => {
      if (!navigator.mediaDevices?.getUserMedia) { toast(t('noCamera')); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }); }
      catch (e) { toast(t('noCamera') + ': ' + e.message); return; }
      const box = body.querySelector('.scan-dlg__cam'), video = box.querySelector('video');
      box.hidden = false; video.srcObject = stream; await video.play(); live = true;
      let detector = null;
      try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {}
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const loop = async () => {
        if (!live) return;
        let text = null;
        try {
          if (detector) { const r = await detector.detect(video); if (r[0]) text = r[0].rawValue; }
          else if (video.videoWidth && globalThis.jsQR) {
            const s = Math.min(1, 800 / video.videoWidth);
            canvas.width = video.videoWidth * s; canvas.height = video.videoHeight * s;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
          }
        } catch {}
        if (text) { navigator.vibrate?.(60); finish(text); return; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    body.querySelector('[data-a="cam"]').focus();
  });
}

async function decodeImage(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  const canvas = document.createElement('canvas');
  const s = Math.min(1, 1600 / Math.max(img.width || 1, img.height || 1));
  canvas.width = img.width * s; canvas.height = img.height * s;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  if (!canvas.width) return null;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return globalThis.jsQR?.(d.data, d.width, d.height)?.data || null;
}
