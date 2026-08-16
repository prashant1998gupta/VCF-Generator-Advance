/* ============================================================
   qr.js — vCard QR code generation (canvas + SVG download)
   Uses the `qrcode` (node-qrcode) browser build → global QRCode
   Exposes global: QR
   ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  // byte-mode capacity of a version-40 QR per EC level
  const CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  let currentText = '';

  function buildText() {
    const model = FormUI.getModel();
    const version = App.getVersion();
    const includePhoto = $('#qr-include-photo').checked;
    // logo always excluded from QR — logos blow past QR capacity fast
    return VCard.generate(model, version, { includePhoto, includeLogo: false });
  }

  function opts(width) {
    return {
      errorCorrectionLevel: $('#qr-ec').value,
      width: width || 480,
      margin: 2,
      color: { dark: $('#qr-dark').value, light: $('#qr-light').value }
    };
  }

  function render() {
    currentText = buildText();
    const bytes = new TextEncoder().encode(currentText).length;
    const cap = CAPACITY[$('#qr-ec').value] || 2331;
    const note = $('#qr-note');
    const canvas = $('#qr-canvas');

    QRCode.toCanvas(canvas, currentText, opts(480), err => {
      if (err) {
        note.textContent = '❌ Too much data for a QR code (' + bytes + ' bytes, max ~' + cap +
          '). Untick “Include photo”, shorten notes, or lower error correction.';
        note.style.color = 'var(--danger)';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        note.style.color = '';
        note.textContent = 'Scan with any phone camera to add this contact. ' +
          bytes + ' bytes of ' + cap + ' (' + Math.round(bytes / cap * 100) + '% of capacity).';
      }
    });
  }

  function fileBase() {
    return VCard.suggestFileName(FormUI.getModel()).replace(/\.vcf$/, '') + '_qr';
  }

  function downloadPNG() {
    if (!currentText) return;
    const size = parseInt($('#qr-size').value, 10) || 512;
    const off = document.createElement('canvas');
    QRCode.toCanvas(off, currentText, opts(size), err => {
      if (err) { App.toast('QR too large — reduce data first', 'err'); return; }
      off.toBlob(blob => App.downloadBlob(blob, fileBase() + '.png'));
    });
  }

  function downloadSVG() {
    if (!currentText) return;
    QRCode.toString(currentText, Object.assign(opts(), { type: 'svg' }), (err, svg) => {
      if (err) { App.toast('QR too large — reduce data first', 'err'); return; }
      App.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
    });
  }

  function open() {
    App.openModal('modal-qr');
    render();
  }

  function init() {
    $('#btn-qr').addEventListener('click', open);
    ['#qr-size', '#qr-ec', '#qr-dark', '#qr-light', '#qr-include-photo'].forEach(sel => {
      $(sel).addEventListener('change', render);
    });
    $('#qr-dl-png').addEventListener('click', downloadPNG);
    $('#qr-dl-svg').addEventListener('click', downloadSVG);
  }

  window.QR = { init, open };
})();
