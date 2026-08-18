/* ============================================================
   api/extract-card.js — server-side card extraction.

   The browser sends card images; this function calls a vision model
   with a key that lives ONLY in the server environment and returns
   structured contact JSON. The key is never sent to, or derivable
   from, the client.

   Hardening (each of these closes a hole seen in the wild):
     • Origin/Referer must be present AND match the host. A check that
       only validates when the header exists is no check at all —
       curl simply omits it.
     • Per-IP sliding-window rate limit, so a found endpoint cannot be
       replayed into an unbounded bill.
     • Declared MIME is verified against the actual magic bytes, and
       pixel dimensions are parsed before any upstream call.
     • Upstream error text is logged server-side and never returned
       verbatim, so provider messages cannot echo credentials back.
     • Providers are tried in order, so one outage is not an outage.
   ============================================================ */

'use strict';

const { availableProviders, buildPrompt, PROVIDER_TIMEOUT_MS } = require('./_providers.js');

const MAX_BODY_BYTES = 4.4 * 1024 * 1024;   // whole request — under Vercel's own 4.5MB cap
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;   // per decoded image
const MAX_IMAGES = 4;                      // front, back, 2 folded panels
const MIN_DIM = 200, MAX_DIM = 12000;
const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;                  // scans per IP per hour

/* ---------- rate limit ----------
   In-memory: correct per warm instance, best-effort across a fleet. It stops
   casual replay, which is the realistic threat here. The real backstop is a
   spend cap set with the provider — see README. Set RATE_LIMIT_PER_HOUR=0 to
   disable, or swap this for a KV store if you outgrow it.                */
// Hung off the global rather than module scope: a runtime that re-evaluates the
// module inside a live process (dev hot-reload, some bundlers) would otherwise
// hand every caller a fresh, empty counter.
const hits = global.__vcfgenRateHits || (global.__vcfgenRateHits = new Map());
function rateLimited(ip, limit) {
  if (!limit) return false;
  const now = Date.now();
  const fresh = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (fresh.length >= limit) { hits.set(ip, fresh); return true; }
  fresh.push(now);
  hits.set(ip, fresh);
  if (hits.size > 5000) {                   // bound memory on a long-lived instance
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  }
  return false;
}

/* ---------- image validation ---------- */

const MAGIC = [
  { mime: 'image/jpeg', test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { mime: 'image/png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { mime: 'image/webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' }
];

function sniffMime(buf) {
  const m = MAGIC.find(x => buf.length > 12 && x.test(buf));
  return m ? m.mime : null;
}

/** Dimensions straight from the header — no image library needed. */
function dimensions(buf, mime) {
  try {
    if (mime === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/webp') {
      const fmt = buf.slice(12, 16).toString('ascii');
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 };
      }
      if (fmt === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (buf.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

/* ---------- helpers ---------- */

/** Blank out anything shaped like an API key before it reaches a log line. */
function redact(text) {
  return String(text == null ? '' : text)
    .replace(/\b(?:Bearer\s+)?(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})/g, '[redacted]')
    .replace(/\bBearer\s+\S{8,}/gi, 'Bearer [redacted]')
    .slice(0, 500);
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
};

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return (fwd.split(',')[0] || req.socket && req.socket.remoteAddress || 'unknown').trim();
}

function sameHost(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  const src = String(req.headers.origin || req.headers.referer || '');
  if (!host || !src) return false;                       // absent header is a FAIL, not a skip
  let h = '';
  try { h = new URL(src).hostname.toLowerCase(); } catch (e) { return false; }
  return h === host;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  return await new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { tooLarge: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    // capability probe: lets the client show the right UI without exposing anything
    const list = availableProviders(process.env);
    return send(res, 200, { configured: list.length > 0, providers: list.map(p => p.id) });
  }
  if (req.method !== 'POST') { res.setHeader('allow', 'POST, GET'); return send(res, 405, { error: 'Only POST is accepted.', code: 'method_not_allowed' }); }

  if (!sameHost(req)) return send(res, 403, { error: 'This endpoint only serves its own site.', code: 'origin_rejected' });

  const providers = availableProviders(process.env);
  if (!providers.length) {
    return send(res, 503, { error: 'AI scanning is not configured on this server. Local OCR still works.', code: 'not_configured' });
  }

  const limit = process.env.RATE_LIMIT_PER_HOUR === undefined ? DEFAULT_LIMIT : parseInt(process.env.RATE_LIMIT_PER_HOUR, 10) || 0;
  if (rateLimited(clientIp(req), limit)) {
    return send(res, 429, { error: `Too many scans from this network. Try again later, or use Local OCR.`, code: 'rate_limited' });
  }

  let raw;
  try { raw = await readBody(req); }
  catch (e) { return send(res, 413, { error: 'The images are too large.', code: 'request_too_large' }); }

  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { return send(res, 400, { error: 'Request body is not valid JSON.', code: 'invalid_json' }); }

  const list = Array.isArray(payload && payload.images) ? payload.images : [];
  if (!list.length || list.length > MAX_IMAGES) {
    return send(res, 400, { error: `Send between 1 and ${MAX_IMAGES} card images.`, code: 'invalid_image_count' });
  }

  const images = [];
  for (const item of list) {
    const dataUrl = typeof item === 'string' ? item : (item && item.dataUrl);
    const m = typeof dataUrl === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) return send(res, 415, { error: 'Each image must be a JPG, PNG or WebP data URL.', code: 'invalid_image' });
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return send(res, 413, { error: 'Each image must be 3 MB or smaller.', code: 'image_too_large' });
    const actual = sniffMime(buf);
    if (!actual || actual !== m[1]) return send(res, 415, { error: 'That file is not the image type it claims to be.', code: 'mime_mismatch' });
    const dim = dimensions(buf, actual);
    if (dim && (dim.w < MIN_DIM || dim.h < MIN_DIM || dim.w > MAX_DIM || dim.h > MAX_DIM)) {
      return send(res, 422, { error: `Use an image between ${MIN_DIM}px and ${MAX_DIM}px on each side.`, code: 'invalid_dimensions' });
    }
    images.push({ mime: actual, b64: buf.toString('base64') });
  }

  const prompt = buildPrompt(images.length);
  const attempts = [];
  // Serverless platforms kill the function at maxDuration (60s here). Starting a
  // provider that cannot possibly finish just turns a useful 502 into a timeout.
  const deadline = Date.now() + 50000;
  for (const p of providers) {
    if (Date.now() + PROVIDER_TIMEOUT_MS > deadline) {
      attempts.push({ provider: p.id, status: null, skipped: 'out of time' });
      break;
    }
    const key = String(process.env[p.envKey] || '').trim();
    const model = String(process.env[p.envModel] || '').trim() || p.defaultModel;
    try {
      const data = await p.call(images, key, model, prompt);
      return send(res, 200, { extraction: data, provider: p.id, model, attempts });
    } catch (err) {
      // Never surface upstream text to the client: it can quote the request,
      // and a quoted request can contain the credential.
      const status = err && err.status;
      // Providers routinely quote the offending request back in their error text,
      // which can include the Authorization header. Logs are private, but a key
      // still has no business being written to disk.
      console.error(`[extract-card] ${p.id} (${model}) failed:`, status || '', redact(err && err.message));
      attempts.push({ provider: p.id, status: status || null });
      // Every failure mode is worth retrying elsewhere: rate limits and outages
      // obviously, but also 4xx, which is usually one vendor disliking the model
      // id, the image size, or JSON mode rather than anything about the request.
    }
  }
  return send(res, 502, {
    error: 'Every AI provider failed for this image. Local OCR still works, or try again shortly.',
    code: 'all_providers_failed', attempts
  });
};
