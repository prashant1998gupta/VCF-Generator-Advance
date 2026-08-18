#!/usr/bin/env node
/* Local dev server: serves the static site AND runs api/ like Vercel does.
   Reads .env if present.   Usage:  node dev-server.js [port]            */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 8720;

// minimal .env loader (no dependency)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// MOCK_AI=1 answers every provider call locally, so the full server path can be
// exercised (and demoed) without a key and without spending anyone's quota.
if (process.env.MOCK_AI === '1') {
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'mock';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock';
  const MOCK = {
    readable: true, prefix: 'Dr.', firstName: 'Ananya', middleName: '', lastName: 'Raghavan',
    jobTitle: 'Consultant Cardiologist', company: 'Meridian Heart Institute', department: 'Cardiology',
    phones: [{ kind: 'mobile', number: '+91 98450 33127' }, { kind: 'work', number: '+91 80 4118 2200' }],
    emails: ['ananya.r@meridianheart.in'], websites: ['meridianheart.in'],
    address: { street: '12 Lavelle Road', city: 'Bengaluru', state: 'Karnataka', zip: '560001', country: 'India' },
    social: [{ network: 'linkedin', url: 'linkedin.com/in/ananyaraghavan' }],
    other: ['MBBS, MD, DM (Cardiology)', 'Reg. No: KMC 48120']
  };
  global.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(MOCK) } }] })
  });
  console.log('MOCK_AI=1 — provider calls are stubbed, no network, no key used');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/extract-card' || url.pathname === '/api/extract-card.js') {
    try {
      delete require.cache[require.resolve('./api/extract-card.js')];
      delete require.cache[require.resolve('./api/_providers.js')];
      return await require('./api/extract-card.js')(req, res);
    } catch (e) {
      console.error(e);
      res.statusCode = 500; res.end(JSON.stringify({ error: 'dev server error', detail: String(e && e.message) }));
      return;
    }
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(buf);
  });
}).listen(PORT, () => {
  const { availableProviders } = require('./api/_providers.js');
  const list = availableProviders(process.env).map(p => p.id);
  console.log(`dev server  http://localhost:${PORT}`);
  console.log(list.length ? `AI providers configured: ${list.join(', ')}` : 'AI providers: none (set keys in .env) — local OCR still works');
});
