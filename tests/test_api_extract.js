/* Exercises api/extract-card.js end to end against a stubbed provider.
   Verifies the security gates without calling any real AI service.      */
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

process.env.GROQ_API_KEY = 'test-key-not-real';
process.env.RATE_LIMIT_PER_HOUR = '5';

// the rate limiter deliberately survives module re-evaluation, so tests must
// clear it explicitly between phases
function resetLimit() { if (global.__vcfgenRateHits) global.__vcfgenRateHits.clear(); }

// stub fetch so no network call leaves the machine
let lastRequest = null;
const okFetch = async (url, opts) => {
  lastRequest = { url, opts };
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      readable: true, firstName: 'Kavita', lastName: 'Mehta', company: 'Mehta Jewellers',
      phones: [{ kind: 'mobile', number: '+91 99887 76655' }], emails: ['kavita@mehta.com'],
      websites: [], address: { street: '', city: 'Mumbai', state: '', zip: '', country: '' },
      social: [], other: [], jobTitle: 'Director', department: ''
    }) } }] })
  };
};
global.fetch = okFetch;

// capture server-side logging so the redaction can be asserted, not assumed
const logged = [];
const realError = console.error;
console.error = (...a) => { logged.push(a.map(String).join(' ')); };

const handler = require(path.join(__dirname, '..', 'api', 'extract-card.js'));

// smallest valid PNG that still passes the 200px minimum: build a 300x200 IHDR
function pngDataUrl(w, h) {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  const pad = Buffer.alloc(64);
  return 'data:image/png;base64,' + Buffer.concat([sig, ihdr, pad]).toString('base64');
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

function call(headers, body, method) {
  return new Promise(resolve => {
    const req = new http.IncomingMessage(null);
    req.method = method || 'POST';
    req.headers = Object.assign({ host: 'example.com', origin: 'https://example.com' }, headers);
    req.body = body === undefined ? undefined : JSON.stringify(body);
    const res = { statusCode: 200, _h: {}, setHeader(k, v) { this._h[k] = v; },
      end(payload) { let j = null; try { j = JSON.parse(payload); } catch (e) {} resolve({ status: this.statusCode, body: j }); } };
    handler(req, res);
  });
}

(async () => {
  const good = { images: [{ dataUrl: pngDataUrl(600, 350) }] };

  console.log('--- security gates ---');
  let r = await call({ origin: undefined, referer: undefined }, good);
  check('missing Origin AND Referer is rejected (the curl bypass)', r.status === 403, r);

  r = await call({ origin: 'https://evil.example.net' }, good);
  check('cross-origin is rejected', r.status === 403, r);

  r = await call({}, good, 'PUT');
  check('non-POST rejected', r.status === 405, r);

  r = await call({}, { images: [] });
  check('zero images rejected', r.status === 400, r);

  r = await call({}, { images: new Array(9).fill({ dataUrl: pngDataUrl(600, 350) }) });
  check('too many images rejected', r.status === 400, r);

  r = await call({}, { images: [{ dataUrl: 'data:image/png;base64,' + Buffer.from('not a png at all really').toString('base64') }] });
  check('mime that lies about its content rejected', r.status === 415, r);

  r = await call({}, { images: [{ dataUrl: pngDataUrl(50, 40) }] });
  check('too-small image rejected', r.status === 422, r);

  console.log('--- happy path ---');
  r = await call({}, good);
  check('valid request succeeds', r.status === 200, r);
  check('returns parsed extraction', r.body && r.body.extraction && r.body.extraction.firstName === 'Kavita', r.body);
  check('reports which provider answered', r.body && r.body.provider === 'groq', r.body);
  check('never leaks the key', JSON.stringify(r.body).indexOf('test-key-not-real') === -1, 'KEY LEAKED');
  check('sent image to provider as data url', /image_url|inline_data|"type":"image"/.test(JSON.stringify(lastRequest.opts.body)));

  console.log('--- capability probe ---');
  r = await call({}, undefined, 'GET');
  check('GET reports configured providers', r.status === 200 && r.body.configured === true, r.body);
  check('probe does not expose key names/values', JSON.stringify(r.body).indexOf('test-key-not-real') === -1, r.body);

  console.log('--- provider fallback ---');
  resetLimit();
  process.env.GEMINI_API_KEY = 'gemini-key-not-real';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(String(url));
    if (String(url).indexOf('groq.com') !== -1) {
      // an upstream error that quotes the request back — exactly the shape that
      // must never reach the browser
      return { ok: false, status: 500, text: async () => JSON.stringify({
        error: { message: 'upstream exploded while processing Bearer test-key-not-real' } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text:
      '```json\n' + JSON.stringify({ firstName: 'Vikram', lastName: 'Shah', company: 'Shah Exports',
        phones: [], emails: [], websites: [], address: {}, social: [], other: [] }) + '\n```' }] } }] }) };
  };
  r = await call({}, good);
  check('falls through a dead provider to the next', r.status === 200 && r.body.provider === 'gemini', r.body);
  check('tried groq first', calls.some(u => u.indexOf('groq.com') !== -1));
  check('records the failed attempt', r.body.attempts && r.body.attempts.length === 1 && r.body.attempts[0].provider === 'groq', r.body.attempts);
  check('parses JSON wrapped in a code fence', r.body.extraction.firstName === 'Vikram', r.body.extraction);
  check('upstream error text never reaches the client', JSON.stringify(r.body).indexOf('upstream exploded') === -1, r.body);
  check('key from the upstream error never reaches the client', JSON.stringify(r.body).indexOf('test-key-not-real') === -1, 'KEY LEAKED');
  check('key from the upstream error never reaches the server log', logged.join('|').indexOf('test-key-not-real') === -1, logged);

  console.log('--- every provider down ---');
  resetLimit();
  global.fetch = async () => ({ ok: false, status: 503, text: async () => 'service unavailable' });
  r = await call({}, good);
  check('returns 502 when all providers fail', r.status === 502 && r.body.code === 'all_providers_failed', r);
  check('reports both attempts', r.body.attempts && r.body.attempts.length === 2, r.body.attempts);
  delete process.env.GEMINI_API_KEY;

  console.log('--- rate limit ---');
  resetLimit();
  global.fetch = okFetch;
  let limited = false;
  for (let i = 0; i < 12; i++) { const x = await call({}, good); if (x.status === 429) { limited = true; break; } }
  check('per-IP rate limit engages', limited);

  console.error = realError;
  console.log('\n' + (failures === 0 ? 'ALL API TESTS PASSED ✅' : failures + ' FAILURES ❌'));
  process.exit(failures ? 1 : 0);
})();
