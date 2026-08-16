/* ============================================================
   ocr.js — Tesseract.js wrapper (local, in-browser OCR)
   Reuses a worker per language combo; language data is fetched
   from the CDN on first use and cached by the browser.
   Exposes global: OCR
   ============================================================ */
(function () {
  'use strict';

  let worker = null;
  let workerLangs = '';
  let progressCb = null;

  const STATUS_LABELS = {
    'loading tesseract core': 'Loading OCR engine…',
    'initializing tesseract': 'Starting OCR engine…',
    'loading language traineddata': 'Downloading language data (first time only)…',
    'initializing api': 'Preparing…',
    'recognizing text': 'Reading the card…'
  };

  function report(m) {
    if (!progressCb || !m) return;
    const label = STATUS_LABELS[m.status] || m.status || '';
    const pct = (m.status === 'recognizing text') ? Math.round((m.progress || 0) * 100) : null;
    progressCb(label, pct, m.progress || 0);
  }

  async function getWorker(langs) {
    if (worker && workerLangs === langs) return worker;
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
    worker = await Tesseract.createWorker(langs, 1, { logger: report });
    workerLangs = langs;
    return worker;
  }

  /**
   * Recognize text on a canvas.
   * @returns {Promise<{text:string, lines:Array<{text,confidence,bbox,height}>}>}
   */
  async function recognize(canvas, langs, onProgress) {
    progressCb = onProgress || null;
    const w = await getWorker(langs || 'eng');
    const res = await w.recognize(canvas, {}, { text: true, blocks: true });
    const data = res.data || {};
    return { text: data.text || '', lines: extractLines(data) };
  }

  function extractLines(data) {
    let rawLines = [];
    if (Array.isArray(data.lines) && data.lines.length) {
      rawLines = data.lines;                       // tesseract.js v4-style output
    } else if (Array.isArray(data.blocks)) {       // v5 blocks → paragraphs → lines
      data.blocks.forEach(b => (b.paragraphs || []).forEach(p => {
        (p.lines || []).forEach(l => rawLines.push(l));
      }));
    }
    return rawLines.map(l => {
      const bbox = l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
      return {
        text: (l.text || '').replace(/\s+/g, ' ').trim(),
        confidence: l.confidence != null ? l.confidence : 0,
        bbox,
        height: Math.max(1, (bbox.y1 - bbox.y0) || 1)
      };
    }).filter(l => l.text);
  }

  async function dispose() {
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; workerLangs = ''; }
  }

  window.OCR = { recognize, dispose };
})();
