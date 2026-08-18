/* ============================================================
   ai-scan.js — AI card reading, two ways:

   1. SERVER mode (preferred). The site's own /api/extract-card
      holds the provider keys. The browser never sees a key and
      the user never has to get one. Enabled automatically when
      the deployment answers the capability probe.

   2. BRING-YOUR-OWN-KEY mode (fallback). When there is no
      backend — GitHub Pages, a file:// double-click, someone's
      own fork — the user may paste an Anthropic key that is
      kept in this browser only.

   Both paths end at the same toFields(), so the review UI and
   the rest of the app never has to know which one ran.
   Exposes global: AIScan
   ============================================================ */
(function () {
  'use strict';

  const KEY_STORAGE = 'vcfgen.apikey';
  const MODEL_STORAGE = 'vcfgen.aimodel';
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const SERVER_URL = 'api/extract-card';        // relative: works under any base path

  /* ---------------- server capability probe ---------------- */

  // { configured: bool, providers: [] } once resolved; null until probed.
  let serverInfo = null;
  let probePromise = null;

  /**
   * Ask our own backend whether it has any provider keys.
   * Never throws — a missing backend is a normal, expected answer.
   */
  function probe() {
    if (probePromise) return probePromise;
    probePromise = (async () => {
      if (location.protocol === 'file:') return (serverInfo = { configured: false, providers: [] });
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(SERVER_URL, { method: 'GET', signal: ctl.signal, headers: { accept: 'application/json' } });
        clearTimeout(t);
        if (!res.ok) return (serverInfo = { configured: false, providers: [] });
        const data = await res.json();
        serverInfo = { configured: !!data.configured, providers: data.providers || [] };
      } catch (e) {
        serverInfo = { configured: false, providers: [] };
      }
      return serverInfo;
    })();
    return probePromise;
  }

  function serverReady() { return !!(serverInfo && serverInfo.configured); }
  function serverProviders() { return (serverInfo && serverInfo.providers) || []; }

  /** Which path a scan would take right now. */
  function mode() {
    if (serverReady()) return 'server';
    if (hasKey()) return 'byok';
    return 'none';
  }
  /** True when a scan can run without the user configuring anything. */
  function available() { return mode() !== 'none'; }

  /* ---------------- BYO key storage ---------------- */

  function getKey() { return (localStorage.getItem(KEY_STORAGE) || '').trim(); }
  function setKey(k) {
    if (k && k.trim()) localStorage.setItem(KEY_STORAGE, k.trim());
    else localStorage.removeItem(KEY_STORAGE);
  }
  function hasKey() { return !!getKey(); }
  function getModel() { return localStorage.getItem(MODEL_STORAGE) || 'claude-haiku-4-5'; }
  function setModel(m) { localStorage.setItem(MODEL_STORAGE, m); }

  /* ---------------- image encoding ---------------- */

  function fitCanvas(canvas, maxSide) {
    const M = maxSide || 1568;
    if (Math.max(canvas.width, canvas.height) <= M) return canvas;
    const sc = M / Math.max(canvas.width, canvas.height);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * sc);
    c.height = Math.round(canvas.height * sc);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }
  // The whole scan travels in one JSON body, and serverless hosts cap that at a
  // few MB. Scale the encoding to the number of panels so four sides of a folded
  // card cannot silently blow the limit — vision models downsample anyway.
  function encodeFor(canvas, count) {
    const side = count >= 3 ? 1280 : (count === 2 ? 1440 : 1568);
    const q = count >= 3 ? 0.78 : (count === 2 ? 0.84 : 0.9);
    return fitCanvas(canvas, side).toDataURL('image/jpeg', q);
  }
  function canvasToDataUrl(canvas, q) { return fitCanvas(canvas).toDataURL('image/jpeg', q || 0.9); }
  function canvasToBase64(canvas) { return canvasToDataUrl(canvas).split(',')[1]; }

  /* ---------------- server path ---------------- */

  // Human-readable text for every failure the endpoint can report. The server
  // deliberately never forwards upstream error bodies (they can quote the
  // request, and a quoted request can contain a credential), so the mapping
  // lives here where it can also suggest what to do next.
  const SERVER_ERRORS = {
    origin_rejected: 'Blocked — AI scanning only works from the app’s own page.',
    request_too_large: 'Those images are too large. Crop tighter, or scan fewer sides at once.',
    image_too_large: 'That image is too large. Crop tighter or use a smaller photo.',
    invalid_dimensions: 'That image is too small to read — use a larger photo of the card.',
    mime_mismatch: 'That file is not the image type it claims to be.'
  };

  async function serverScan(canvases) {
    const images = canvases.map(c => ({ dataUrl: encodeFor(c, canvases.length) }));
    let res;
    try {
      res = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ images })
      });
    } catch (e) {
      throw new Error('Could not reach the scanning service — check your connection.');
    }

    let data = {};
    try { data = await res.json(); } catch (e) {}

    if (!res.ok) {
      const err = new Error(SERVER_ERRORS[data.code] || data.error || ('Scan failed (HTTP ' + res.status + ')'));
      err.code = data.code;
      throw err;
    }
    const x = data.extraction || {};
    return { ...toFields(x), raw: JSON.stringify(x, null, 2), provider: data.provider, model: data.model };
  }

  /* ---------------- bring-your-own-key path ---------------- */

  const EXTRACT_SCHEMA = {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: 'Honorific like Mr., Dr., Er. — empty string if none' },
      firstName: { type: 'string' },
      middleName: { type: 'string' },
      lastName: { type: 'string' },
      jobTitle: { type: 'string' },
      company: { type: 'string' },
      department: { type: 'string' },
      phones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['mobile', 'work', 'fax'] },
            number: { type: 'string' }
          },
          required: ['kind', 'number'],
          additionalProperties: false
        }
      },
      emails: { type: 'array', items: { type: 'string' } },
      websites: { type: 'array', items: { type: 'string' } },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' },
          zip: { type: 'string' }, country: { type: 'string' }
        },
        required: ['street', 'city', 'state', 'zip', 'country'],
        additionalProperties: false
      },
      social: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            network: { type: 'string', enum: ['linkedin', 'instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'github', 'whatsapp', 'telegram', 'other'] },
            url: { type: 'string' }
          },
          required: ['network', 'url'],
          additionalProperties: false
        }
      },
      other: { type: 'array', items: { type: 'string' }, description: 'Any remaining useful text (taglines, services, GSTIN, registration numbers…)' }
    },
    required: ['prefix', 'firstName', 'middleName', 'lastName', 'jobTitle', 'company', 'department',
      'phones', 'emails', 'websites', 'address', 'social', 'other'],
    additionalProperties: false
  };

  function buildPrompt(n) {
    return (n > 1
      ? 'These ' + n + ' images are sides / panels of the SAME business (visiting) card — front, back, or folded panels. Combine everything into ONE contact. '
      : 'This image is a business / visiting card. ') +
    'Extract the contact details exactly as printed (fix obvious print/scan artifacts, keep the original spelling of names). ' +
    'Use empty strings / empty arrays for anything not present. ' +
    'Name: the PERSON\'s name only (never the company). Put degrees/qualifications (MBBS, CA, B.Tech…) in "other", not in the name. ' +
    'Title: their job designation. Department: only if printed. Company: the organisation/brand name. ' +
    'Phone numbers: keep the printed formatting including country code; classify as mobile (cell/mob/whatsapp/10-digit Indian numbers starting 6-9), work (tel/office/landline/board/toll-free), or fax. List each distinct number once. ' +
    'Websites: bare domains are fine. Social: only include explicit social media handles/links. ' +
    'Address: split into street (everything before city), city, state, zip/PIN, country. If two addresses are printed, use the main/registered office. ' +
    'Put GSTIN / CIN / PAN / registration numbers, taglines and services descriptions in "other" as "Label: value" strings. ' +
    'If the image is not a business card, still extract any contact info you can see.';
  }

  async function request(body) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  async function byokScan(list) {
    const content = [];
    list.forEach((c, i) => {
      if (list.length > 1) content.push({ type: 'text', text: 'Image ' + (i + 1) + ' of ' + list.length + ':' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: canvasToBase64(c) } });
    });
    content.push({ type: 'text', text: buildPrompt(list.length) });

    const data = await request({
      model: getModel(),
      // max_tokens caps reasoning + response text together, and a dense card with several
      // panels can fill 2048 before the JSON closes — which surfaced as the misleading
      // "Could not parse AI response" below instead of a truncation
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
      messages: [{ role: 'user', content }]
    });

    if (data.stop_reason === 'refusal') {
      throw new Error('The AI declined to process this image');
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('The AI response was cut short — try scanning fewer images at once');
    }
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('Empty AI response');

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (e) {
      // fallback: strip accidental code fences
      const m = /\{[\s\S]*\}/.exec(textBlock.text);
      if (!m) throw new Error('Could not parse AI response');
      parsed = JSON.parse(m[0]);
    }
    return { ...toFields(parsed), raw: textBlock.text, provider: 'anthropic', model: getModel() };
  }

  /* ---------------- entry point ---------------- */

  /**
   * Scan one card (given as one or more canvases — front/back/panels).
   * Routes to the backend when the deployment has keys, otherwise to the
   * user's own key. Falls back from server to own key if the server is
   * rate-limited or its providers are all down.
   * @param {HTMLCanvasElement|HTMLCanvasElement[]} canvases
   */
  async function scan(canvases) {
    const list = Array.isArray(canvases) ? canvases : [canvases];
    if (serverReady()) {
      try {
        return await serverScan(list);
      } catch (e) {
        // The user has their own key: a server hiccup shouldn't stop the scan.
        // A rejected image, though, will be rejected by any backend — don't
        // spend the user's own quota re-proving it.
        const clientFault = e.code === 'invalid_image' || e.code === 'mime_mismatch' ||
          e.code === 'invalid_dimensions' || e.code === 'invalid_image_count';
        if (!hasKey() || clientFault) throw e;
        return await byokScan(list);
      }
    }
    if (!hasKey()) throw new Error('AI scanning is not available here — use Local OCR, or add your own key in Settings.');
    return byokScan(list);
  }

  /* ---------------- shared: model JSON -> review-UI fields ---------------- */

  function toFields(x) {
    const fields = [];
    const push = (category, value, data) => {
      if (value && String(value).trim()) fields.push({ category, value: String(value).trim(), confidence: 'high', data });
    };

    const nameParts = [x.prefix, x.firstName, x.middleName, x.lastName].map(s => (s || '').trim()).filter(Boolean);
    push('name', nameParts.join(' '), { prefix: (x.prefix || '').trim(), first: (x.firstName || '').trim(), middle: (x.middleName || '').trim(), last: (x.lastName || '').trim() });
    push('title', x.jobTitle);
    push('department', x.department);
    push('company', x.company);

    (x.phones || []).forEach(p => {
      const cat = p.kind === 'fax' ? 'fax' : (p.kind === 'work' ? 'work-phone' : 'mobile');
      push(cat, p.number);
    });
    (x.emails || []).forEach(e => push('email', String(e).toLowerCase()));
    (x.websites || []).forEach(w => {
      let u = String(w).trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
      push('website', u);
    });
    const HOME = { linkedin: 'https://linkedin.com/in/', instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', twitter: 'https://x.com/', youtube: 'https://youtube.com/@', tiktok: 'https://tiktok.com/@', github: 'https://github.com/', whatsapp: 'https://wa.me/', telegram: 'https://t.me/' };
    (x.social || []).forEach(s => {
      let u = (s.url || '').trim();
      const net = s.network === 'other' ? 'custom' : s.network;
      if (u && !/^https?:\/\//i.test(u)) {
        if (u.includes('.')) u = 'https://' + u.replace(/^\/+/, '');
        else if (HOME[net]) u = HOME[net] + u.replace(/^@/, '').replace(/^\/+/, '');   // bare handle "@maya" → profile URL
        else return;                                                                   // unknown network + bare handle: skip
      }
      push('social', u, { network: net });
    });

    const a = x.address || {};
    if ([a.street, a.city, a.state, a.zip, a.country].some(v => (v || '').trim())) {
      const display = [a.street, a.city, a.state, a.zip, a.country].map(s => (s || '').trim()).filter(Boolean).join(', ');
      push('address', display, {
        street: a.street || '', city: a.city || '', state: a.state || '',
        zip: a.zip || '', country: a.country || ''
      });
    }

    const unassigned = (x.other || []).map(s => String(s).trim()).filter(Boolean);
    return { fields, unassigned };
  }

  /** Cheap key check — one tiny request. */
  async function testKey() {
    const data = await request({
      model: getModel(),
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Say OK' }]
    });
    return !!(data && data.id);
  }

  window.AIScan = {
    scan, testKey, toFields,
    hasKey, getKey, setKey, getModel, setModel,
    probe, serverReady, serverProviders, mode, available
  };
})();
