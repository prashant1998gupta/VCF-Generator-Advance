/* ============================================================
   scanner.js — visiting-card scanning
   • multiple images per scan: front/back, folded panels, or a batch
     of different cards
   • per-image editing: rotate, crop, split, enhance, B/W, auto-deskew
   • OCR orchestration (local dual-pass or AI) and the review UI
   Exposes global: Scanner
   ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------------- state ---------------- */

  // page: { id, original: canvas, geom: canvas, enhance: bool, bw: bool, deskew: number }
  let pages = [];
  let activeId = null;
  let mode = 'merge';        // 'merge' = all images are one card | 'batch' = each image is a different card
  let engine = 'local';
  let cropMode = false, cropSel = null;
  let stream = null, facing = 'environment';
  let scanning = false;
  let batchResults = [];     // in batch mode: [{pageId, fields, unassigned, raw}]

  const active = () => pages.find(p => p.id === activeId) || null;
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------------- image loading ---------------- */

  function busy() {
    if (!scanning) return false;
    App.toast('Please wait — a scan is running', 'warn');
    return true;
  }

  async function loadFiles(fileList) {
    if (busy()) return;
    const files = [...(fileList || [])].filter(f => f && /^image\//.test(f.type));
    if (!files.length) { App.toast('Please choose image files', 'err'); return; }
    let added = 0;
    for (const f of files) {
      try {
        const src = await decodeImage(f);
        addPage(src.source, src.width, src.height, { silent: true });
        if (src.source && typeof src.source.close === 'function') src.source.close();   // free the ImageBitmap
        added++;
      } catch (e) {
        App.toast('Could not read ' + f.name, 'err');
      }
    }
    exitCropMode();
    if (added) {
      renderPageStrip();
      showActive();
      $('#scan-editor').hidden = false;
      $('#scan-controls').hidden = false;
      $('#scan-results-card').hidden = true;
      if (pages.length > 1 && added === files.length && files.length > 1) {
        App.toast(added + ' images added — set “Images are” to one card or separate cards', 'ok');
      } else {
        App.toast(added === 1 ? 'Image added — adjust if needed, then Scan' : added + ' images added', 'ok');
      }
      updateModeHint();
    }
  }

  function decodeImage(file) {
    return new Promise(async (resolve, reject) => {
      try {
        if (window.createImageBitmap) {
          let bmp;
          try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
          catch (e) { bmp = await createImageBitmap(file); }
          resolve({ source: bmp, width: bmp.width, height: bmp.height });
          return;
        }
      } catch (e) { /* fall through */ }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function addPage(src, w, h, opts) {
    // normalize size: OCR likes ~1500-2200px on the long side
    const maxSide = Math.max(w, h);
    let scale = 1;
    if (maxSide > 2200) scale = 2200 / maxSide;
    else if (maxSide < 1200) scale = Math.min(2.5, 1600 / maxSide);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);

    const page = { id: uid(), original: c, geom: null, enhance: false, bw: false, deskew: 0 };
    // auto-straighten slightly skewed photos. estimateSkew() returns the
    // rotation that makes text rows horizontal, so apply it directly.
    const angle = estimateSkew(c);
    if (Math.abs(angle) >= 0.6 && Math.abs(angle) <= 12) {
      page.geom = rotateCanvas(c, angle);
      page.deskew = angle;
    } else {
      page.geom = cloneCanvas(c);
    }
    pages.push(page);
    activeId = page.id;
    if (!(opts && opts.silent) && page.deskew) App.toast('Auto-straightened by ' + Math.abs(page.deskew).toFixed(1) + '°', 'ok');
    return page;
  }

  function cloneCanvas(c) {
    const n = document.createElement('canvas');
    n.width = c.width; n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  /* ---------------- geometry ---------------- */

  function rotateCanvas(s, deg) {
    const rad = deg * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const n = document.createElement('canvas');
    n.width = Math.round(s.width * cos + s.height * sin);
    n.height = Math.round(s.width * sin + s.height * cos);
    const ctx = n.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n.width, n.height);
    ctx.translate(n.width / 2, n.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    return n;
  }

  function rotate(deg) {
    const p = active(); if (!p) return;
    p.geom = rotateCanvas(p.geom, deg);
    exitCropMode(); render(); renderPageStrip();
  }

  /**
   * Estimate small text skew (±12°) by maximizing the variance of the
   * horizontal projection profile of a binarized, downscaled copy.
   */
  function estimateSkew(canvas) {
    const W = 360;
    const scale = W / canvas.width;
    const H = Math.max(40, Math.round(canvas.height * scale));
    const small = document.createElement('canvas');
    small.width = W; small.height = H;
    const sctx = small.getContext('2d');
    sctx.drawImage(canvas, 0, 0, W, H);
    const im = sctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = 0.299 * im[i * 4] + 0.587 * im[i * 4 + 1] + 0.114 * im[i * 4 + 2];
    const thr = otsu(gray, W * H);
    // ink = 1 where dark (assumes dark text on light card; invert if the card is dark)
    let darkCount = 0;
    for (let i = 0; i < W * H; i++) if (gray[i] < thr) darkCount++;
    const invert = darkCount > (W * H) / 2;
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) ink[i] = (invert ? gray[i] >= thr : gray[i] < thr) ? 1 : 0;

    const score = (deg) => {
      const rad = deg * Math.PI / 180, s = Math.sin(rad), c = Math.cos(rad);
      const rows = new Float64Array(H + 2 * W); // generous bounds
      const off = W;
      let count = 0;
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 2) {
        if (!ink[y * W + x]) continue;
        const ry = Math.round((x - W / 2) * s + (y - H / 2) * c + H / 2) + off;
        if (ry >= 0 && ry < rows.length) { rows[ry]++; count++; }
      }
      if (!count) return 0;
      let mean = count / H, v = 0;
      for (let i = 0; i < rows.length; i++) { const d = rows[i] - mean; v += d * d; }
      return v;
    };
    let best = 0, bestScore = -1;
    for (let a = -12; a <= 12; a += 1) { const sc = score(a); if (sc > bestScore) { bestScore = sc; best = a; } }
    // refine around best at 0.25° steps
    let fine = best;
    for (let a = best - 0.75; a <= best + 0.75; a += 0.25) { const sc = score(a); if (sc > bestScore) { bestScore = sc; fine = a; } }
    return fine;
  }

  function applyCrop() {
    const p = active();
    if (!cropSel || !p) { exitCropMode(); return; }
    const disp = $('#scan-canvas');
    const f = p.geom.width / disp.clientWidth;
    const x = Math.max(0, Math.round(cropSel.x * f));
    const y = Math.max(0, Math.round(cropSel.y * f));
    const w = Math.min(p.geom.width - x, Math.round(cropSel.w * f));
    const h = Math.min(p.geom.height - y, Math.round(cropSel.h * f));
    if (w < 20 || h < 20) { App.toast('Crop area is too small', 'warn'); return; }
    const n = document.createElement('canvas');
    n.width = w; n.height = h;
    n.getContext('2d').drawImage(p.geom, x, y, w, h, 0, 0, w, h);
    p.geom = n; p.dark = null;
    exitCropMode(); render(); renderPageStrip();
  }

  /** Split the active image into two pages (e.g. one photo of an open folded card). */
  function split(direction) {
    const p = active(); if (!p || busy()) return;
    const s = p.geom;
    const parts = [];
    if (direction === 'v') {   // left | right
      const w = Math.floor(s.width / 2);
      parts.push([0, 0, w, s.height], [w, 0, s.width - w, s.height]);
    } else {                   // top / bottom
      const h = Math.floor(s.height / 2);
      parts.push([0, 0, s.width, h], [0, h, s.width, s.height - h]);
    }
    const idx = pages.indexOf(p);
    const made = parts.map(([x, y, w, h]) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(s, x, y, w, h, 0, 0, w, h);
      return { id: uid(), original: cloneCanvas(c), geom: c, enhance: p.enhance, bw: p.bw, deskew: 0 };
    });
    pages.splice(idx, 1, ...made);
    activeId = made[0].id;
    exitCropMode(); renderPageStrip(); showActive(); updateModeHint();
    App.toast('Split into 2 images', 'ok');
  }

  function removePage(id) {
    if (busy()) return;
    const i = pages.findIndex(p => p.id === id);
    if (i === -1) return;
    pages.splice(i, 1);
    exitCropMode();
    if (!pages.length) { resetAll(); return; }
    if (activeId === id) activeId = pages[Math.max(0, i - 1)].id;
    renderPageStrip(); showActive(); updateModeHint();
  }

  function movePage(id, dir) {
    if (busy()) return;
    const i = pages.findIndex(p => p.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    renderPageStrip(); render();
  }

  function resetAll() {
    if (busy()) return;
    pages = []; activeId = null; batchResults = [];
    exitCropMode();
    $('#scan-editor').hidden = true;
    $('#scan-controls').hidden = true;
    $('#scan-results-card').hidden = true;
    $('#page-strip').innerHTML = '';
    updateModeHint();
  }

  /* ---------------- filters ---------------- */

  /** Mean luminance of a canvas (sampled) — used to spot dark-background cards. */
  function meanLuma(c) {
    const s = document.createElement('canvas');
    const W = 64, H = Math.max(8, Math.round(64 * c.height / c.width));
    s.width = W; s.height = H;
    const d = s.getContext('2d');
    d.drawImage(c, 0, 0, W, H);
    const im = d.getImageData(0, 0, W, H).data;
    let sum = 0;
    for (let i = 0; i < im.length; i += 4) sum += 0.299 * im[i] + 0.587 * im[i + 1] + 0.114 * im[i + 2];
    return sum / (im.length / 4);
  }

  /** Canvas exactly as the OCR engine should see it (geometry + filters + polarity). */
  function processedCanvas(p, forOcr) {
    const out = document.createElement('canvas');
    out.width = p.geom.width; out.height = p.geom.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(p.geom, 0, 0);
    // dark cards (light text on dark background) read far better inverted; decide once per page
    if (p.dark == null) p.dark = meanLuma(p.geom) < 95;
    const invert = forOcr && p.dark;
    if (p.enhance || p.bw || invert) {
      const im = ctx.getImageData(0, 0, out.width, out.height);
      if (invert) { const d = im.data; for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }
      if (p.enhance || p.bw) filterPixels(im.data, p.bw, out.width);
      ctx.putImageData(im, 0, 0);
    }
    return out;
  }

  function render() {
    const p = active();
    const out = $('#scan-canvas');
    if (!p) { out.width = 0; out.height = 0; return; }
    const src = processedCanvas(p, false);
    out.width = src.width; out.height = src.height;
    out.getContext('2d').drawImage(src, 0, 0);
    setToggle('#tool-enhance', p.enhance);
    setToggle('#tool-bw', p.bw);
    $('#page-meta').textContent = 'Image ' + (pages.indexOf(p) + 1) + ' of ' + pages.length +
      (p.deskew ? ' · auto-straightened ' + Math.abs(p.deskew).toFixed(1) + '°' : '') +
      (p.dark ? ' · dark card (auto-inverted for OCR)' : '') +
      ' · ' + p.geom.width + '×' + p.geom.height;
  }

  function filterPixels(d, bw, width) {
    const n = d.length / 4;
    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    // contrast stretch between 2nd and 98th percentile
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
    let lo = 0, hi = 255;
    const loT = n * 0.02, hiT = n * 0.98;
    for (let v = 0, a = 0; v < 256; v++) { a += hist[v]; if (a >= loT) { lo = v; break; } }
    for (let v = 0, a = 0; v < 256; v++) { a += hist[v]; if (a >= hiT) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) gray[i] = Math.max(0, Math.min(255, (gray[i] - lo) * 255 / range));
    if (bw && width) {
      // adaptive (Bradley) threshold: compare each pixel to the mean of its neighbourhood, so a
      // shadowed part of the card doesn't turn solid black the way a single global cut would
      const W = width, H = Math.floor(n / W);
      const win = Math.max(15, Math.round(W / 10)), half = win >> 1;
      const integ = new Float64Array((W + 1) * (H + 1));
      for (let y = 1; y <= H; y++) {
        let row = 0;
        for (let x = 1; x <= W; x++) {
          row += gray[(y - 1) * W + (x - 1)];
          integ[y * (W + 1) + x] = integ[(y - 1) * (W + 1) + x] + row;
        }
      }
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - half), y1 = Math.min(H - 1, y + half);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - half), x1 = Math.min(W - 1, x + half);
          const area = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = integ[(y1 + 1) * (W + 1) + (x1 + 1)] - integ[y0 * (W + 1) + (x1 + 1)] - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
          const i = y * W + x;
          const v = gray[i] * area < sum * 0.85 ? 0 : 255;
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        }
      }
      return;
    }
    const threshold = bw ? otsu(gray, n) : -1;
    for (let i = 0; i < n; i++) {
      let v = gray[i];
      if (threshold >= 0) v = v > threshold ? 255 : 0;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    }
  }

  function otsu(gray, n) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, maxVar = 0, best = 127;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = n - wB;
      if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; best = v; }
    }
    return best;
  }

  /* ---------------- page strip UI ---------------- */

  function renderPageStrip() {
    const strip = $('#page-strip');
    strip.innerHTML = '';
    pages.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'page-thumb' + (p.id === activeId ? ' active' : '');
      item.title = 'Image ' + (i + 1);
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Image ' + (i + 1) + (p.id === activeId ? ' (selected)' : ''));
      const c = document.createElement('canvas');
      // fit inside a 96×96 box preserving aspect ratio (portrait cards must not be squashed)
      const sc = Math.min(96 / p.geom.width, 96 / p.geom.height);
      c.width = Math.max(1, Math.round(p.geom.width * sc)); c.height = Math.max(1, Math.round(p.geom.height * sc));
      c.getContext('2d').drawImage(p.geom, 0, 0, c.width, c.height);
      item.appendChild(c);
      const num = document.createElement('span');
      num.className = 'page-num'; num.textContent = i + 1;
      item.appendChild(num);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'page-del'; del.title = 'Remove image ' + (i + 1); del.setAttribute('aria-label', 'Remove image ' + (i + 1)); del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); removePage(p.id); });
      item.appendChild(del);
      const select = () => { activeId = p.id; exitCropMode(); renderPageStrip(); showActive(); };
      item.addEventListener('click', select);
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
      strip.appendChild(item);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'page-add';
    add.setAttribute('aria-label', 'Add another image: other side, panel or card');
    add.innerHTML = '<span>＋</span><small>Add side /<br>panel / card</small>';
    add.addEventListener('click', () => $('#scan-file').click());
    strip.appendChild(add);
    $('#page-strip-wrap').hidden = false;
    $('#page-move-l').disabled = pages.indexOf(active()) <= 0;
    $('#page-move-r').disabled = pages.indexOf(active()) >= pages.length - 1;
    const activeEl = strip.querySelector('.page-thumb.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function showActive() { render(); }

  function updateModeHint() {
    const seg = $('#mode-seg');
    const hint = $('#mode-hint');
    if (pages.length <= 1) {
      seg.style.display = 'none';
      hint.textContent = pages.length === 1 ? 'Double-sided or folded card? Add the other side / panels — they’ll be read together as one contact.' : '';
      return;
    }
    seg.style.display = '';
    hint.textContent = mode === 'merge'
      ? pages.length + ' images will be read together and merged into ONE contact (front/back, folded panels).'
      : pages.length + ' images will be scanned as ' + pages.length + ' SEPARATE contacts (a batch of different cards).';
  }

  /* ---------------- crop interaction ---------------- */

  function enterCropMode() {
    if (!active()) return;
    cropMode = true; cropSel = null;
    setToggle('#tool-crop', true);
    $('#canvas-wrap').classList.add('cropping');       // touch-action:none only while cropping
    $('#crop-apply').hidden = true;
    $('#crop-rect').hidden = true;
    App.toast('Drag on the image to select the card area', 'ok');
  }
  function exitCropMode() {
    cropMode = false; cropSel = null;
    setToggle('#tool-crop', false);
    $('#canvas-wrap').classList.remove('cropping');
    $('#crop-apply').hidden = true;
    $('#crop-rect').hidden = true;
  }

  function bindCrop() {
    const wrap = $('#canvas-wrap');
    const rect = $('#crop-rect');
    let start = null;
    const pos = e => {
      const r = wrap.getBoundingClientRect();
      return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
    };
    wrap.addEventListener('pointerdown', e => {
      if (!cropMode) return;
      start = pos(e);
      wrap.setPointerCapture(e.pointerId);
      rect.hidden = false;
      Object.assign(rect.style, { left: start.x + 'px', top: start.y + 'px', width: '0px', height: '0px' });
    });
    wrap.addEventListener('pointermove', e => {
      if (!cropMode || !start) return;
      const p = pos(e);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      Object.assign(rect.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      cropSel = { x, y, w, h };
    });
    wrap.addEventListener('pointerup', () => {
      if (!cropMode || !start) return;
      start = null;
      if (cropSel && cropSel.w > 10 && cropSel.h > 10) $('#crop-apply').hidden = false;
    });
  }

  /* ---------------- camera ---------------- */

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      App.toast('Camera not available here — use “Take photo (mobile)” or upload', 'err');
      return;
    }
    App.openModal('modal-camera');
    await startStream();
  }

  async function startStream() {
    stopStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
      });
      $('#camera-video').srcObject = stream;
    } catch (e) {
      App.closeModal('modal-camera');
      App.toast('Camera blocked or unavailable: ' + e.message, 'err');
    }
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    const v = $('#camera-video'); if (v) v.srcObject = null;
  }

  function shoot(keepOpen) {
    const v = $('#camera-video');
    if (!v.videoWidth) { App.toast('Camera is still starting…', 'warn'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    addPage(c, c.width, c.height);
    exitCropMode(); renderPageStrip(); showActive();
    $('#scan-editor').hidden = false;
    $('#scan-controls').hidden = false;
    updateModeHint();
    if (keepOpen) {
      App.toast('Captured image ' + pages.length + ' — flip the card and capture the other side', 'ok');
    } else {
      stopStream();
      App.closeModal('modal-camera');
    }
  }

  /* ---------------- scanning ---------------- */

  function setProgress(label, pct) {
    $('#ocr-progress').hidden = false;
    $('#ocr-progress-text').textContent = pct != null ? label + ' ' + pct + '%' : label;
    $('#ocr-progress-fill').style.width = (pct != null ? pct : 15) + '%';
  }

  async function ocrPage(p, langs, i, n) {
    const canvas = processedCanvas(p, true);
    const prefix = n > 1 ? 'Image ' + (i + 1) + '/' + n + ' — ' : '';
    return OCR.recognize(canvas, langs, (label, pct) => {
      const overall = pct != null ? Math.round((i + pct / 100) / n * 100) : null;
      setProgress(prefix + label, overall);
    }, { best: true });
  }

  /** Merge OCR results of several pages into one line list, keeping per-page layout info. */
  function mergePageResults(results) {
    const lines = [];
    results.forEach((r, p) => {
      const n = r.lines.length;
      r.lines.forEach((l, i) => lines.push({ ...l, page: p, pos: n > 1 ? i / (n - 1) : 0 }));
    });
    return { text: results.map(r => r.text).join('\n\n'), lines, pageCount: results.length };
  }

  async function scan() {
    if (!pages.length || scanning) return;
    scanning = true;
    const btn = $('#btn-scan');
    btn.disabled = true;
    $('#scan-results-card').hidden = true;
    batchResults = [];

    // work on a snapshot so page-list edits during a long scan can't shift indices
    const snap = pages.slice();
    const isBatch = mode === 'batch' && snap.length > 1;
    try {
      if (engine === 'ai') {
        if (!AIScan.hasKey()) {
          App.toast('Add your Anthropic API key in Settings to use AI scanning', 'warn');
          App.openModal('modal-settings');
          return;
        }
        animateIndeterminate();
        if (isBatch) {
          for (let i = 0; i < snap.length; i++) {
            setProgress('Claude is reading card ' + (i + 1) + ' of ' + snap.length + '…', null);
            const r = await AIScan.scan([processedCanvas(snap[i], false)]);
            batchResults.push({ pageId: snap[i].id, ...r });
          }
          renderBatchResults();
        } else {
          setProgress('Claude is reading ' + (snap.length > 1 ? 'all ' + snap.length + ' images' : 'the card') + '…', null);
          const r = await AIScan.scan(snap.map(p => processedCanvas(p, false)));
          renderResults(r.fields, r.unassigned, r.raw);
        }
      } else {
        const lang = $('#ocr-lang').value;
        const langs = lang === 'eng' ? 'eng' : lang + '+eng';
        if (isBatch) {
          for (let i = 0; i < snap.length; i++) {
            const r = await ocrPage(snap[i], langs, i, snap.length);
            const parsed = CardParser.parse(mergePageResults([r]));
            batchResults.push({ pageId: snap[i].id, fields: parsed.fields, unassigned: parsed.unassigned, raw: r.text });
          }
          renderBatchResults();
        } else {
          const results = [];
          for (let i = 0; i < snap.length; i++) results.push(await ocrPage(snap[i], langs, i, snap.length));
          const merged = mergePageResults(results);
          if (!merged.text.trim()) {
            App.toast('No text found — try ✨ Enhance, ✂ Crop tighter, or a sharper photo', 'warn');
            return;
          }
          const { fields, unassigned } = CardParser.parse(merged);
          renderResults(fields, unassigned, merged.text);
        }
      }
    } catch (e) {
      console.error(e);
      App.toast('Scan failed: ' + (e && e.message || e), 'err');
    } finally {
      scanning = false;
      btn.disabled = false;
      $('#ocr-progress').hidden = true;
      stopIndeterminate();
    }
  }

  let indetTimer = null;
  function animateIndeterminate() {
    let p = 8;
    indetTimer = setInterval(() => {
      p = Math.min(92, p + Math.random() * 7);
      $('#ocr-progress-fill').style.width = p + '%';
    }, 400);
  }
  function stopIndeterminate() { if (indetTimer) { clearInterval(indetTimer); indetTimer = null; } }

  /* ---------------- results review UI ---------------- */

  function confChip(conf) {
    const span = document.createElement('span');
    span.className = 'conf-chip ' + (conf === 'high' ? 'conf-hi' : conf === 'medium' ? 'conf-md' : 'conf-lo');
    span.textContent = conf === 'high' ? '✓ sure' : conf === 'medium' ? '~ check' : '? guess';
    span.title = 'Detection confidence';
    return span;
  }

  function resultRow(field, isUnassigned) {
    const row = document.createElement('div');
    row.className = 'scan-row';
    if (field.data) row.dataset.extra = JSON.stringify(field.data);
    row.dataset.orig = field.value;

    const sel = document.createElement('select');
    CardParser.CATEGORIES.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    });
    sel.value = isUnassigned ? 'ignore' : field.category;
    row.appendChild(sel);

    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = field.value;
    row.appendChild(inp);

    row.appendChild(confChip(isUnassigned ? 'low' : field.confidence || 'medium'));

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'rep-del'; del.textContent = '✕'; del.title = 'Remove';
    del.addEventListener('click', () => row.remove());
    row.appendChild(del);
    return row;
  }

  function fillList(listEl, fields, isUnassigned) {
    listEl.innerHTML = '';
    fields.forEach(f => listEl.appendChild(resultRow(f, isUnassigned)));
  }

  function renderResults(fields, unassigned, rawText) {
    $('#scan-results-single').hidden = false;
    $('#scan-results-batch').hidden = true;
    fillList($('#scan-results'), fields, false);
    const uWrap = $('#scan-unassigned-wrap');
    fillList($('#scan-unassigned'), (unassigned || []).map(t => ({ category: 'ignore', value: t })), true);
    uWrap.hidden = !(unassigned && unassigned.length);
    $('#ocr-raw').textContent = rawText || '';
    $('#scan-results-card').hidden = false;
    $('#scan-results-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!fields.length) App.toast('Nothing recognized — try Enhance/B&W, a tighter crop, or the AI engine', 'warn');
    else App.toast('Found ' + fields.length + ' detail' + (fields.length > 1 ? 's' : '') + (pages.length > 1 ? ' across ' + pages.length + ' images' : '') + ' — review & apply', 'ok');
  }

  function renderBatchResults() {
    $('#scan-results-single').hidden = true;
    const wrap = $('#scan-results-batch');
    wrap.hidden = false;
    const list = $('#batch-list');
    list.innerHTML = '';
    batchResults.forEach((r, i) => {
      const page = pages.find(p => p.id === r.pageId);
      const det = document.createElement('details');
      det.className = 'batch-card';
      det.open = i === 0;
      const sum = document.createElement('summary');
      const thumb = document.createElement('canvas');
      thumb.width = 64; thumb.height = Math.max(24, Math.round(64 * (page ? page.geom.height / page.geom.width : 0.6)));
      if (page) thumb.getContext('2d').drawImage(page.geom, 0, 0, thumb.width, thumb.height);
      sum.appendChild(thumb);
      const pick = cat => { const f = r.fields.find(x => x.category === cat); return f && f.value; };
      const label = document.createElement('span');
      label.className = 'batch-title';
      label.innerHTML = '<strong>Card ' + (i + 1) + '</strong> — ' + escapeHtml(pick('name') || pick('company') || pick('email') || pick('title') || pick('mobile') || 'unrecognized') +
        ' <em class="hint-inline">' + r.fields.length + ' fields</em>';
      sum.appendChild(label);
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'batch-body';
      const rows = document.createElement('div');
      rows.className = 'scan-results';
      rows.dataset.batchIndex = i;
      fillList(rows, r.fields, false);
      body.appendChild(rows);
      if (r.unassigned && r.unassigned.length) {
        const ul = document.createElement('div');
        ul.className = 'scan-results batch-unassigned';
        ul.dataset.batchIndex = i;
        const lab = document.createElement('span'); lab.className = 'field-label'; lab.textContent = 'Unmatched lines';
        body.appendChild(lab);
        fillList(ul, r.unassigned.map(t => ({ category: 'ignore', value: t })), true);
        body.appendChild(ul);
      }
      const acts = document.createElement('div');
      acts.className = 'btn-row';
      const b1 = document.createElement('button'); b1.className = 'btn'; b1.textContent = '✎ Open in form';
      b1.addEventListener('click', () => {
        const model = CardParser.fieldsToModel(collectRows(det), FormUI.emptyModel());
        FormUI.applyModel(model); App.showTab('create');
        App.toast('Card ' + (i + 1) + ' loaded into the form', 'ok');
      });
      const b2 = document.createElement('button'); b2.className = 'btn primary'; b2.textContent = '＋ Save to contacts';
      b2.addEventListener('click', () => saveBatchCard(det, i));
      acts.appendChild(b1); acts.appendChild(b2);
      body.appendChild(acts);
      det.appendChild(body);
      list.appendChild(det);
    });
    $('#ocr-raw').textContent = batchResults.map((r, i) => '=== Card ' + (i + 1) + ' ===\n' + (r.raw || '')).join('\n\n');
    $('#scan-results-card').hidden = false;
    $('#scan-results-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const found = batchResults.filter(r => r.fields.length).length;
    App.toast(found + ' of ' + batchResults.length + ' cards recognized — review, then save', found ? 'ok' : 'warn');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function collectRows(root) {
    return [...root.querySelectorAll('.scan-row')].map(r => {
      const value = r.querySelector('input').value.trim();
      // structured data (parsed address / ID key) only stays valid while the text is unedited
      const untouched = value === (r.dataset.orig || '').trim();
      return {
        category: r.querySelector('select').value,
        value,
        data: untouched && r.dataset.extra ? JSON.parse(r.dataset.extra) : undefined
      };
    }).filter(f => f.value && f.category !== 'ignore');
  }

  function applyToForm(asNew) {
    const fields = collectRows($('#scan-results-single'));
    if (!fields.length) { App.toast('Nothing to apply — assign at least one field', 'warn'); return; }
    const base = asNew ? FormUI.emptyModel() : FormUI.getModel();
    const model = CardParser.fieldsToModel(fields, base);
    FormUI.applyModel(model);
    App.showTab('create');
    App.toast(asNew ? 'New contact filled from the card ✔' : 'Card details merged into the form ✔', 'ok');
  }

  function saveBatchCard(det, i) {
    if (det.classList.contains('saved')) { App.toast('Card ' + (i + 1) + ' is already saved', 'warn'); return; }
    const fields = collectRows(det);
    if (!fields.length) { App.toast('Nothing to save for card ' + (i + 1), 'warn'); return; }
    Contacts.add(CardParser.fieldsToModel(fields, FormUI.emptyModel()), { silent: true });
    det.classList.add('saved');
    App.toast('Card ' + (i + 1) + ' saved ✔', 'ok');
  }

  function saveAllBatch() {
    const cards = [...document.querySelectorAll('#batch-list .batch-card')];
    let n = 0;
    cards.forEach(det => {
      if (det.classList.contains('saved')) return;
      const fields = collectRows(det);
      if (!fields.length) return;
      Contacts.add(CardParser.fieldsToModel(fields, FormUI.emptyModel()), { silent: true });
      det.classList.add('saved'); n++;
    });
    if (n) { App.toast('Saved ' + n + ' contact' + (n > 1 ? 's' : '') + ' ✔', 'ok'); App.showTab('contacts'); }
    else App.toast('Nothing new to save', 'warn');
  }

  /* ---------------- init ---------------- */

  function init() {
    const dz = $('#dropzone');
    dz.addEventListener('click', () => $('#scan-file').click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('#scan-file').click(); });
    $('#scan-file').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });
    $('#scan-capture').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); loadFiles(e.dataTransfer.files); });

    document.addEventListener('paste', e => {
      if (App.currentTab() !== 'scan') return;
      const items = [...((e.clipboardData || {}).items || [])].filter(i => i.type.startsWith('image/'));
      if (items.length) { e.preventDefault(); loadFiles(items.map(i => i.getAsFile())); }
    });

    $('#rot-left').addEventListener('click', () => rotate(-90));
    $('#rot-right').addEventListener('click', () => rotate(90));
    $('#tool-enhance').addEventListener('click', () => { const p = active(); if (!p) return; p.enhance = !p.enhance; if (!p.enhance) p.bw = false; render(); });
    $('#tool-bw').addEventListener('click', () => { const p = active(); if (!p) return; p.bw = !p.bw; if (p.bw) p.enhance = true; render(); });
    $('#tool-crop').addEventListener('click', () => cropMode ? exitCropMode() : enterCropMode());
    $('#crop-apply').addEventListener('click', applyCrop);
    $('#tool-split-v').addEventListener('click', () => split('v'));
    $('#tool-split-h').addEventListener('click', () => split('h'));
    $('#tool-reset').addEventListener('click', () => {
      const p = active(); if (!p) return;
      p.geom = cloneCanvas(p.original); p.enhance = false; p.bw = false; p.deskew = 0; p.dark = null;
      exitCropMode(); render(); renderPageStrip();
    });
    $('#tool-clear-all').addEventListener('click', () => { if (pages.length && confirm('Remove all ' + pages.length + ' images?')) resetAll(); });
    $('#page-move-l').addEventListener('click', () => { const p = active(); if (p) movePage(p.id, -1); });
    $('#page-move-r').addEventListener('click', () => { const p = active(); if (p) movePage(p.id, 1); });
    bindCrop();

    $('#btn-camera').addEventListener('click', openCamera);
    $('#camera-shoot').addEventListener('click', () => shoot(false));
    $('#camera-shoot-more').addEventListener('click', () => shoot(true));
    $('#camera-flip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startStream(); });
    // stop the camera however the modal closes (✕, Escape, backdrop tap)
    new MutationObserver(() => { if ($('#modal-camera').hidden) stopStream(); })
      .observe($('#modal-camera'), { attributes: true, attributeFilter: ['hidden'] });

    $$('#engine-seg button').forEach(b => {
      b.addEventListener('click', () => {
        $$('#engine-seg button').forEach(x => x.classList.toggle('active', x === b));
        engine = b.dataset.engine;
        $('#ocr-lang-row').style.display = engine === 'ai' ? 'none' : '';
        $('#ai-hint').hidden = engine !== 'ai';
      });
    });
    $$('#mode-seg button').forEach(b => {
      b.addEventListener('click', () => {
        $$('#mode-seg button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        mode = b.dataset.mode;
        updateModeHint();
      });
    });
    $('#open-settings-link').addEventListener('click', e => { e.preventDefault(); App.openModal('modal-settings'); });

    $('#btn-scan').addEventListener('click', scan);
    $('#btn-apply-scan').addEventListener('click', () => applyToForm(false));
    $('#btn-apply-new').addEventListener('click', () => applyToForm(true));
    $('#btn-batch-save-all').addEventListener('click', saveAllBatch);
    updateModeHint();
  }

  function setToggle(sel, on) { $(sel).classList.toggle('on', !!on); }

  window.Scanner = { init };
})();
