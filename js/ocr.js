/* ============================================================
   ocr.js — Tesseract.js wrapper (local, in-browser OCR)
   - one worker per language combo, reused across scans
   - "best" mode runs two page-segmentation passes (auto layout +
     sparse text) and merges the line sets with fuzzy dedupe, which
     recovers small/scattered text that a single pass misses
   Exposes global: OCR
   ============================================================ */
(function () {
  'use strict';

  let worker = null;
  let workerLangs = '';
  let progressCb = null;

  const PSM_AUTO = '3';     // fully automatic page segmentation
  const PSM_SPARSE = '11';  // sparse text — find as much text as possible, no order assumption

  const STATUS_LABELS = {
    'loading tesseract core': 'Loading OCR engine…',
    'initializing tesseract': 'Starting OCR engine…',
    'loading language traineddata': 'Downloading language data (first time only)…',
    'initializing api': 'Preparing…',
    'recognizing text': 'Reading the card…'
  };

  let passInfo = { current: 1, total: 1 };
  function report(m) {
    if (!progressCb || !m) return;
    let label = STATUS_LABELS[m.status] || m.status || '';
    let pct = null;
    if (m.status === 'recognizing text') {
      const p = m.progress || 0;
      pct = Math.round(((passInfo.current - 1) + p) / passInfo.total * 100);
      if (passInfo.total > 1) label += ' (pass ' + passInfo.current + '/' + passInfo.total + ')';
    }
    progressCb(label, pct);
  }

  async function getWorker(langs) {
    if (worker && workerLangs === langs) return worker;
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
    worker = await Tesseract.createWorker(langs, 1, { logger: report });
    workerLangs = langs;
    return worker;
  }

  async function runPass(w, image, psm) {
    await w.setParameters({
      tessedit_pageseg_mode: psm,
      preserve_interword_spaces: '1'
    });
    const res = await w.recognize(image, {}, { text: true, blocks: true });
    return extractLines(res.data || {});
  }

  // encode the canvas once (PNG blob) so both passes don't each pay for toBlob + transfer
  function canvasToBlob(canvas) {
    return new Promise(resolve => {
      if (canvas.toBlob) canvas.toBlob(b => resolve(b || canvas), 'image/png');
      else resolve(canvas);
    });
  }

  /**
   * Recognize text on a canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {string} langs   e.g. 'eng' or 'hin+eng'
   * @param {function} onProgress (label, pct)
   * @param {object} [opts]  { best: true }  — dual-pass merge
   * @returns {Promise<{text:string, lines:Array<{text,confidence,bbox,height}>, meanConfidence:number}>}
   */
  async function recognize(canvas, langs, onProgress, opts) {
    progressCb = onProgress || null;
    opts = Object.assign({ best: true }, opts);
    const w = await getWorker(langs || 'eng');
    const image = await canvasToBlob(canvas);

    passInfo = { current: 1, total: opts.best ? 2 : 1 };
    let lines = await runPass(w, image, PSM_AUTO);

    if (opts.best) {
      passInfo.current = 2;
      let sparse = [];
      try { sparse = await runPass(w, image, PSM_SPARSE); } catch (e) { /* keep first pass */ }
      lines = mergeLineSets(lines, sparse);
    }

    // Keep Tesseract's reading order (it already groups columns/blocks); slot lines that only the
    // sparse pass found in after the nearest primary line above them, instead of a global y-sort
    // that would interleave two-column layouts.
    const primary = lines.filter(l => !l.fromSparse);
    const extras = lines.filter(l => l.fromSparse).sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const ordered = primary.slice();
    for (const e of extras) {
      let at = -1;
      for (let i = 0; i < ordered.length; i++) {
        const p = ordered[i];
        if (p.bbox.y0 <= e.bbox.y0 && !(p.bbox.x1 < e.bbox.x0 - 40 && ordered.some(o => o.bbox.x0 >= e.bbox.x0 - 40 && o.bbox.y0 <= e.bbox.y0))) at = i;
      }
      ordered.splice(at + 1, 0, e);
    }
    lines = ordered;
    const meanConfidence = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0;
    return { text: lines.map(l => l.text).join('\n'), lines, meanConfidence };
  }

  function extractLines(data) {
    let rawLines = [];
    if (Array.isArray(data.lines) && data.lines.length) {
      rawLines = data.lines;                       // v4-style output
    } else if (Array.isArray(data.blocks)) {       // v5 blocks → paragraphs → lines
      data.blocks.forEach(b => (b.paragraphs || []).forEach(p => {
        (p.lines || []).forEach(l => rawLines.push(l));
      }));
    }
    return rawLines.map(l => {
      const bbox = l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
      const words = (l.words || []).filter(wd => (wd.text || '').trim());
      // word-level confidence is more reliable than line confidence for garbage detection
      const wconf = words.length ? words.reduce((s, wd) => s + (wd.confidence || 0), 0) / words.length : (l.confidence || 0);
      return {
        text: (l.text || '').replace(/\s+/g, ' ').trim(),
        confidence: l.confidence != null ? Math.max(l.confidence, wconf) : wconf,
        bbox,
        height: Math.max(1, (bbox.y1 - bbox.y0) || 1)
      };
    }).filter(l => l.text);
  }

  /* ---------- merge two passes ---------- */

  function normText(t) { return t.toLowerCase().replace(/[^\p{L}\p{N}@.+]+/gu, ''); }

  // Dice coefficient on character bigrams — cheap, order-tolerant similarity
  function similarity(a, b) {
    a = normText(a); b = normText(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
    const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const ga = grams(a), gb = grams(b);
    let inter = 0;
    ga.forEach((n, g) => { if (gb.has(g)) inter += Math.min(n, gb.get(g)); });
    return 2 * inter / ((a.length - 1) + (b.length - 1));
  }

  function overlapY(a, b) {
    const top = Math.max(a.bbox.y0, b.bbox.y0), bot = Math.min(a.bbox.y1, b.bbox.y1);
    const inter = Math.max(0, bot - top);
    return inter / Math.max(1, Math.min(a.height, b.height));
  }

  function mergeLineSets(primary, secondary) {
    let out = primary.map(l => ({ ...l }));
    for (const s of secondary) {
      let matched = false;
      for (let i = 0; i < out.length; i++) {
        const p = out[i];
        const sim = similarity(p.text, s.text);
        const geo = overlapY(p, s);
        // same physical line: prefer the higher-confidence reading
        if (sim >= 0.8 || (sim >= 0.55 && geo > 0.6) ||
            (geo > 0.7 && (normText(p.text).includes(normText(s.text)) || normText(s.text).includes(normText(p.text))))) {
          matched = true;
          if (s.confidence > p.confidence + 3 && s.text.length >= p.text.length * 0.8) {
            out[i] = { ...s };
            // the sparse reading may span what PSM 3 split into two blocks ("Rakesh" + "Sharma"):
            // drop other same-row lines now contained in the replacement
            const ns = normText(s.text);
            out = out.filter((o, j) => j === i || !(overlapY(o, s) > 0.6 && o.text.length < s.text.length && ns.includes(normText(o.text))));
          }
          break;
        }
      }
      if (!matched && s.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) out.push({ ...s, fromSparse: true });
    }
    return out;
  }

  async function dispose() {
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; workerLangs = ''; }
  }

  window.OCR = { recognize, dispose, similarity };
})();
