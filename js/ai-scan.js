/* ============================================================
   ai-scan.js — optional AI card reading via the Anthropic API.
   The user's own API key (stored ONLY in this browser) is used to
   call Claude vision directly from the browser. Structured outputs
   guarantee valid JSON.
   Exposes global: AIScan
   ============================================================ */
(function () {
  'use strict';

  const KEY_STORAGE = 'vcfgen.apikey';
  const MODEL_STORAGE = 'vcfgen.aimodel';
  const API_URL = 'https://api.anthropic.com/v1/messages';

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

  const PROMPT =
    'This image is a business / visiting card. Extract the contact details exactly as printed ' +
    '(fix obvious OCR-style artifacts, keep original spelling of names). ' +
    'Use empty strings / empty arrays for anything not present. ' +
    'Phone numbers: keep the printed formatting including country code; classify as mobile, work (landline/office/tel), or fax. ' +
    'Websites: bare domains are fine. Social: only include explicit social media handles/links. ' +
    'If the card is not a business card, still extract any contact info you can see.';

  function getKey() { return (localStorage.getItem(KEY_STORAGE) || '').trim(); }
  function setKey(k) {
    if (k && k.trim()) localStorage.setItem(KEY_STORAGE, k.trim());
    else localStorage.removeItem(KEY_STORAGE);
  }
  function hasKey() { return !!getKey(); }
  function getModel() { return localStorage.getItem(MODEL_STORAGE) || 'claude-haiku-4-5'; }
  function setModel(m) { localStorage.setItem(MODEL_STORAGE, m); }

  function canvasToJpegBase64(canvas, maxSide) {
    const M = maxSide || 1568;
    let c = canvas;
    if (Math.max(canvas.width, canvas.height) > M) {
      const sc = M / Math.max(canvas.width, canvas.height);
      c = document.createElement('canvas');
      c.width = Math.round(canvas.width * sc);
      c.height = Math.round(canvas.height * sc);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, c.width, c.height);
    }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }

  async function request(body) {
    const res = await fetch(API_URL, {
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

  /** Scan a card canvas with Claude vision → review-UI fields. */
  async function scan(canvas) {
    if (!hasKey()) throw new Error('No API key set');
    const b64 = canvasToJpegBase64(canvas);

    const data = await request({
      model: getModel(),
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: PROMPT }
        ]
      }]
    });

    if (data.stop_reason === 'refusal') {
      throw new Error('The AI declined to process this image');
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
    return { ...toFields(parsed), raw: textBlock.text };
  }

  function toFields(x) {
    const fields = [];
    const push = (category, value, data) => {
      if (value && String(value).trim()) fields.push({ category, value: String(value).trim(), confidence: 'high', data });
    };

    const nameParts = [x.prefix, x.firstName, x.middleName, x.lastName].map(s => (s || '').trim()).filter(Boolean);
    push('name', nameParts.join(' '));
    push('title', x.jobTitle);
    push('company', x.company);
    if ((x.department || '').trim()) push('notes', 'Department: ' + x.department.trim());

    (x.phones || []).forEach(p => {
      const cat = p.kind === 'fax' ? 'fax' : (p.kind === 'work' ? 'work-phone' : 'mobile');
      push(cat, p.number);
    });
    (x.emails || []).forEach(e => push('email', e.toLowerCase()));
    (x.websites || []).forEach(w => {
      let u = w.trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
      push('website', u);
    });
    (x.social || []).forEach(s => {
      let u = (s.url || '').trim();
      if (u && !/^https?:\/\//i.test(u) && u.includes('.')) u = 'https://' + u;
      push('social', u, { network: s.network === 'other' ? 'custom' : s.network });
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

  window.AIScan = { scan, testKey, hasKey, getKey, setKey, getModel, setModel };
})();
