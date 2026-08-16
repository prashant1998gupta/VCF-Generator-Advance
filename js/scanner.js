/* ============================================================
   scanner.js — visiting-card scanning: image input (upload /
   drag-drop / paste / camera), preprocessing (rotate, crop,
   enhance, Otsu B/W), OCR orchestration and the review UI.
   Exposes global: Scanner
   ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  let originalCanvas = null;  // as loaded (EXIF-corrected, size-normalized)
  let geomCanvas = null;      // original + rotations/crops baked in
  let enhance = false, bw = false;
  let cropMode = false, cropSel = null; // {x,y,w,h} in display px
  let engine = 'local';
  let stream = null, facing = 'environment';
  let scanning = false;

  /* ---------------- image loading ---------------- */

  async function loadFromFile(file) {
    if (!file || !/^image\//.test(file.type)) { App.toast('That is not an image file', 'err'); return; }
    try {
      let bmp;
      if (window.createImageBitmap) {
        try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (e) { bmp = await createImageBitmap(file); }
      }
      if (bmp) { loadFromSource(bmp, bmp.width, bmp.height); return; }
    } catch (e) { /* fall through to <img> path */ }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); loadFromSource(img, img.naturalWidth, img.naturalHeight); };
    img.onerror = () => { URL.revokeObjectURL(url); App.toast('Could not read that image', 'err'); };
    img.src = url;
  }

  function loadFromSource(src, w, h) {
    // normalize size: OCR likes ~1400-2200px on the long side
    const maxSide = Math.max(w, h);
    let scale = 1;
    if (maxSide > 2200) scale = 2200 / maxSide;
    else if (maxSide < 1000) scale = Math.min(2, 1400 / maxSide);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    originalCanvas = c;
    geomCanvas = cloneCanvas(c);
    enhance = false; bw = false; cropSel = null;
    setToggle('#tool-enhance', false); setToggle('#tool-bw', false);
    exitCropMode();
    $('#scan-editor').hidden = false;
    $('#scan-controls').hidden = false;
    $('#scan-results-card').hidden = true;
    render();
    App.toast('Card loaded — adjust if needed, then press “Scan card”', 'ok');
  }

  function cloneCanvas(c) {
    const n = document.createElement('canvas');
    n.width = c.width; n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  /* ---------------- geometry ops ---------------- */

  function rotate(deg) {
    if (!geomCanvas) return;
    const s = geomCanvas;
    const n = document.createElement('canvas');
    n.width = s.height; n.height = s.width;
    const ctx = n.getContext('2d');
    ctx.translate(n.width / 2, n.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    geomCanvas = n;
    render();
  }

  function applyCrop() {
    if (!cropSel || !geomCanvas) { exitCropMode(); return; }
    const disp = $('#scan-canvas');
    const f = geomCanvas.width / disp.clientWidth;
    const x = Math.max(0, Math.round(cropSel.x * f));
    const y = Math.max(0, Math.round(cropSel.y * f));
    const w = Math.min(geomCanvas.width - x, Math.round(cropSel.w * f));
    const h = Math.min(geomCanvas.height - y, Math.round(cropSel.h * f));
    if (w < 20 || h < 20) { App.toast('Crop area is too small', 'warn'); return; }
    const n = document.createElement('canvas');
    n.width = w; n.height = h;
    n.getContext('2d').drawImage(geomCanvas, x, y, w, h, 0, 0, w, h);
    geomCanvas = n;
    exitCropMode();
    render();
  }

  /* ---------------- filters ---------------- */

  function render() {
    if (!geomCanvas) return;
    const out = $('#scan-canvas');
    out.width = geomCanvas.width; out.height = geomCanvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(geomCanvas, 0, 0);
    if (enhance || bw) {
      const im = ctx.getImageData(0, 0, out.width, out.height);
      filterPixels(im.data);
      ctx.putImageData(im, 0, 0);
    }
  }

  function filterPixels(d) {
    const n = d.length / 4;
    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    // contrast stretch between 2nd and 98th percentile
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
    let lo = 0, hi = 255, acc = 0;
    const loT = n * 0.02, hiT = n * 0.98;
    for (let v = 0, a = 0; v < 256; v++) { a += hist[v]; if (a >= loT) { lo = v; break; } }
    for (let v = 0, a = 0; v < 256; v++) { a += hist[v]; if (a >= hiT) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) gray[i] = Math.max(0, Math.min(255, (gray[i] - lo) * 255 / range));

    let threshold = -1;
    if (bw) threshold = otsu(gray, n);

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

  /* ---------------- crop interaction ---------------- */

  function enterCropMode() {
    cropMode = true; cropSel = null;
    setToggle('#tool-crop', true);
    $('#crop-apply').hidden = true;
    $('#crop-rect').hidden = true;
    App.toast('Drag on the image to select the card area', 'ok');
  }
  function exitCropMode() {
    cropMode = false; cropSel = null;
    setToggle('#tool-crop', false);
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

  function shoot() {
    const v = $('#camera-video');
    if (!v.videoWidth) { App.toast('Camera is still starting…', 'warn'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    stopStream();
    App.closeModal('modal-camera');
    loadFromSource(c, c.width, c.height);
  }

  /* ---------------- scanning ---------------- */

  function setProgress(label, pct) {
    $('#ocr-progress').hidden = false;
    $('#ocr-progress-text').textContent = pct != null ? label + ' ' + pct + '%' : label;
    $('#ocr-progress-fill').style.width = (pct != null ? pct : 15) + '%';
  }

  async function scan() {
    if (!geomCanvas || scanning) return;
    scanning = true;
    const btn = $('#btn-scan');
    btn.disabled = true;
    $('#scan-results-card').hidden = true;

    try {
      if (engine === 'ai') {
        if (!AIScan.hasKey()) {
          App.toast('Add your Anthropic API key in Settings to use AI scanning', 'warn');
          App.openModal('modal-settings');
          return;
        }
        setProgress('Asking Claude to read the card…', null);
        animateIndeterminate();
        const { fields, unassigned, raw } = await AIScan.scan(geomCanvas);
        renderResults(fields, unassigned, raw);
      } else {
        const lang = $('#ocr-lang').value;
        const langs = lang === 'eng' ? 'eng' : lang + '+eng';
        const result = await OCR.recognize($('#scan-canvas'), langs, (label, pct) => setProgress(label, pct));
        if (!result.text.trim()) {
          App.toast('No text found — try ✨ Enhance, ✂ Crop tighter, or a sharper photo', 'warn');
          return;
        }
        const { fields, unassigned } = CardParser.parse(result);
        renderResults(fields, unassigned, result.text);
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

  function renderResults(fields, unassigned, rawText) {
    const list = $('#scan-results');
    list.innerHTML = '';
    fields.forEach(f => list.appendChild(resultRow(f, false)));

    const uWrap = $('#scan-unassigned-wrap');
    const uList = $('#scan-unassigned');
    uList.innerHTML = '';
    if (unassigned && unassigned.length) {
      unassigned.forEach(t => uList.appendChild(resultRow({ category: 'ignore', value: t }, true)));
      uWrap.hidden = false;
    } else {
      uWrap.hidden = true;
    }

    $('#ocr-raw').textContent = rawText || '';
    $('#scan-results-card').hidden = false;
    $('#scan-results-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!fields.length) App.toast('Nothing recognized — try Enhance/B0W or the AI engine', 'warn');
    else App.toast('Found ' + fields.length + ' detail' + (fields.length > 1 ? 's' : '') + ' — review & apply', 'ok');
  }

  function collectReviewed() {
    const rows = [...document.querySelectorAll('#scan-results .scan-row'), ...document.querySelectorAll('#scan-unassigned .scan-row')];
    return rows.map(r => ({
      category: r.querySelector('select').value,
      value: r.querySelector('input').value.trim(),
      data: r.dataset.extra ? JSON.parse(r.dataset.extra) : undefined
    })).filter(f => f.value && f.category !== 'ignore');
  }

  function applyToForm(asNew) {
    const fields = collectReviewed();
    if (!fields.length) { App.toast('Nothing to apply — assign at least one field', 'warn'); return; }
    const base = asNew ? FormUI.emptyModel() : FormUI.getModel();
    const model = CardParser.fieldsToModel(fields, base);
    FormUI.applyModel(model);
    App.showTab('create');
    App.toast(asNew ? 'New contact filled from the card ✔' : 'Card details merged into the form ✔', 'ok');
  }

  /* ---------------- init ---------------- */

  function init() {
    const dz = $('#dropzone');
    dz.addEventListener('click', () => $('#scan-file').click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('#scan-file').click(); });
    $('#scan-file').addEventListener('change', e => loadFromFile(e.target.files[0]));
    $('#scan-capture').addEventListener('change', e => loadFromFile(e.target.files[0]));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover');
      loadFromFile(e.dataTransfer.files[0]);
    });

    document.addEventListener('paste', e => {
      if (App.currentTab() !== 'scan') return;
      const item = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); loadFromFile(item.getAsFile()); }
    });

    $('#rot-left').addEventListener('click', () => rotate(-90));
    $('#rot-right').addEventListener('click', () => rotate(90));
    $('#tool-enhance').addEventListener('click', () => { enhance = !enhance; setToggle('#tool-enhance', enhance); render(); });
    $('#tool-bw').addEventListener('click', () => { bw = !bw; if (bw) enhance = true; setToggle('#tool-bw', bw); setToggle('#tool-enhance', enhance); render(); });
    $('#tool-crop').addEventListener('click', () => cropMode ? exitCropMode() : enterCropMode());
    $('#crop-apply').addEventListener('click', applyCrop);
    $('#tool-reset').addEventListener('click', () => {
      if (!originalCanvas) return;
      geomCanvas = cloneCanvas(originalCanvas);
      enhance = false; bw = false;
      setToggle('#tool-enhance', false); setToggle('#tool-bw', false);
      exitCropMode(); render();
    });
    bindCrop();

    $('#btn-camera').addEventListener('click', openCamera);
    $('#camera-shoot').addEventListener('click', shoot);
    $('#camera-flip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startStream(); });
    document.querySelector('[data-close="modal-camera"]').addEventListener('click', stopStream);

    document.querySelectorAll('#engine-seg button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#engine-seg button').forEach(x => x.classList.toggle('active', x === b));
        engine = b.dataset.engine;
        $('#ocr-lang-row').style.display = engine === 'ai' ? 'none' : '';
        $('#ai-hint').hidden = engine !== 'ai';
      });
    });
    $('#open-settings-link').addEventListener('click', e => { e.preventDefault(); App.openModal('modal-settings'); });

    $('#btn-scan').addEventListener('click', scan);
    $('#btn-apply-scan').addEventListener('click', () => applyToForm(false));
    $('#btn-apply-new').addEventListener('click', () => applyToForm(true));
  }

  function setToggle(sel, on) { $(sel).classList.toggle('on', !!on); }

  window.Scanner = { init };
})();
