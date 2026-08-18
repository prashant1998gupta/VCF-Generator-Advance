/* ============================================================
   api/_providers.js — vision-model adapters.

   Every adapter takes the same input and returns the same parsed
   object, so extract-card.js can try them in order and fall back
   without knowing which vendor answered.

   Model ids are env-configurable: vendors rename models often, and a
   rename should be a dashboard edit, not a code change + redeploy.
   ============================================================ */

'use strict';

/** Shared extraction contract. Mirrors what js/ai-scan.js already maps to fields. */
const SCHEMA_HINT = `{
  "readable": true,
  "prefix": "", "firstName": "", "middleName": "", "lastName": "",
  "jobTitle": "", "company": "", "department": "",
  "phones": [{"kind": "mobile|work|fax", "number": ""}],
  "emails": [""], "websites": [""],
  "address": {"street": "", "city": "", "state": "", "zip": "", "country": ""},
  "social": [{"network": "linkedin|instagram|facebook|twitter|youtube|tiktok|github|whatsapp|telegram|other", "url": ""}],
  "other": [""]
}`;

function buildPrompt(imageCount) {
  return (imageCount > 1
    ? `These ${imageCount} images are sides or panels of the SAME business card and ONE contact. Read them together and merge into one result. `
    : 'This image is a business (visiting) card. ') +
`Extract the printed contact details.

Rules:
- Never invent anything. Anything not visibly printed stays an empty string or an empty array.
- NAME is the person only. A logo, brand, firm, studio, agency, "& Sons", Pvt Ltd, LLP, Inc or Ltd line is the COMPANY, never the name. The largest text on a card is very often the company, so do not use size alone.
- Put degrees and qualifications (MBBS, MD, CA, FCA, B.Tech, LL.B, PhD) in "other", never in the name. Keep an honorific (Mr., Dr., Er., Adv., Prop.) in "prefix".
- jobTitle is the designation. department only if separately printed.
- Copy every distinct phone exactly as printed, keeping any leading +. Classify as "mobile" (cell/mob/whatsapp, or a 10-digit Indian number starting 6-9), "fax", else "work". Never invent a country code. Deduplicate numbers repeated on both sides.
- Emails need a local part, @ and a domain. A bare domain or URL is a website, not an email.
- Social links go in "social", never in "websites".
- Split the address only where it is clear: street (everything before the city), city, state, zip/PIN, country. Never infer a missing part. If two addresses are printed, use the main/registered one and put the other in "other".
- Put GSTIN / CIN / PAN / registration numbers, taglines and slogans in "other" as "Label: value" strings.
- Preserve Unicode and non-Latin text as printed.
- Set "readable" false only if the image is too blurry, cropped or empty to yield any contact data.

Return ONLY a JSON object with exactly these keys:
${SCHEMA_HINT}`;
}

/* ---------- helpers ---------- */

// Kept well under the function's own 60s ceiling: a provider that hangs must
// still leave time for the next one to answer, or fallback is theatre.
const PROVIDER_TIMEOUT_MS = 22000;

async function postJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers),
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* keep raw */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first JSON object out of a model reply, tolerating code fences or prose. */
function parseModelJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch (e) { /* fall through */ }
  const start = s.indexOf('{');
  if (start === -1) return null;
  // walk to the matching brace so trailing prose does not break the parse
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

/* ---------- adapters ----------
   Each: { id, label, envKey, envModel, defaultModel, call(images, key, model) }
   `images` is [{ mime, b64 }]. Returns a parsed object or throws.          */

const openAiCompatible = (url, opts) => async (images, key, model, prompt) => {
  const o = opts || {};
  const content = [];
  images.forEach((img, i) => {
    if (images.length > 1) content.push({ type: 'text', text: `Image ${i + 1} of ${images.length}:` });
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } });
  });
  content.push({ type: 'text', text: prompt });

  const body = {
    model,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_object' },
    temperature: 0
  };
  // OpenAI's reasoning models only accept max_completion_tokens; Groq and the
  // chat models accept max_tokens. Pick per vendor rather than guessing once.
  body[o.tokenField || 'max_tokens'] = 2000;

  const r = await postJson(url, Object.assign({ authorization: `Bearer ${key}` }, o.headers || {}), body);
  if (!r.ok) {
    const msg = (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`;
    const err = new Error(msg); err.status = r.status; throw err;
  }
  const text = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
  const parsed = parseModelJson(text);
  if (!parsed) throw new Error('model did not return usable JSON');
  return parsed;
};

const PROVIDERS = [
  {
    id: 'groq', label: 'Groq',
    envKey: 'GROQ_API_KEY', envModel: 'GROQ_VISION_MODEL',
    defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    call: openAiCompatible('https://api.groq.com/openai/v1/chat/completions')
  },
  {
    id: 'gemini', label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY', envModel: 'GEMINI_VISION_MODEL',
    defaultModel: 'gemini-2.0-flash',
    call: async (images, key, model, prompt) => {
      const parts = images.map(img => ({ inline_data: { mime_type: img.mime, data: img.b64 } }));
      parts.push({ text: prompt });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const r = await postJson(url, { 'x-goog-api-key': key }, {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 1500 }
      });
      if (!r.ok) {
        const msg = (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`;
        const err = new Error(msg); err.status = r.status; throw err;
      }
      const cand = r.json && r.json.candidates && r.json.candidates[0];
      const text = cand && cand.content && cand.content.parts && cand.content.parts.map(p => p.text || '').join('');
      const parsed = parseModelJson(text);
      if (!parsed) throw new Error('model did not return usable JSON');
      return parsed;
    }
  },
  {
    id: 'openai', label: 'OpenAI',
    envKey: 'OPENAI_API_KEY', envModel: 'OPENAI_VISION_MODEL',
    defaultModel: 'gpt-4o-mini',
    call: openAiCompatible('https://api.openai.com/v1/chat/completions', { tokenField: 'max_completion_tokens' })
  },
  {
    id: 'anthropic', label: 'Anthropic Claude',
    envKey: 'ANTHROPIC_API_KEY', envModel: 'ANTHROPIC_VISION_MODEL',
    defaultModel: 'claude-haiku-4-5',
    call: async (images, key, model, prompt) => {
      const content = [];
      images.forEach((img, i) => {
        if (images.length > 1) content.push({ type: 'text', text: `Image ${i + 1} of ${images.length}:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      });
      content.push({ type: 'text', text: prompt });
      const r = await postJson('https://api.anthropic.com/v1/messages', {
        'x-api-key': key, 'anthropic-version': '2023-06-01'
      }, { model, max_tokens: 2000, messages: [{ role: 'user', content }] });
      if (!r.ok) {
        const msg = (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`;
        const err = new Error(msg); err.status = r.status; throw err;
      }
      if (r.json && r.json.stop_reason === 'refusal') throw new Error('the model declined this image');
      const block = r.json && Array.isArray(r.json.content) && r.json.content.find(b => b.type === 'text');
      const parsed = parseModelJson(block && block.text);
      if (!parsed) throw new Error('model did not return usable JSON');
      return parsed;
    }
  }
];

/** Providers that actually have a key configured, in fallback order. */
function availableProviders(env) {
  const order = String(env.AI_PROVIDER_ORDER || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = PROVIDERS.filter(p => String(env[p.envKey] || '').trim());
  if (!order.length) return list;
  const rank = id => { const i = order.indexOf(id); return i === -1 ? 99 : i; };
  return list.slice().sort((a, b) => rank(a.id) - rank(b.id));
}

module.exports = { PROVIDERS, availableProviders, buildPrompt, parseModelJson, PROVIDER_TIMEOUT_MS };
