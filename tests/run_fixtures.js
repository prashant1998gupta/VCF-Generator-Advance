#!/usr/bin/env node
// Fixture bench for js/card-parser.js
// Usage: node run_fixtures.js [fixtureFileOrDir] [--verbose]
// Fixture JSON shape:
// {
//   "name": "slug",
//   "description": "what makes this card tricky",
//   "pages": [ [ {"text": "OCR line", "height": 30, "confidence": 88}, ... ] ],   // one array per image (front/back)
//   "expected": {
//     "name": "Rakesh Sharma", "title": "...", "company": "...",
//     "mobile": ["+91 98111 22334"], "work-phone": [...], "fax": [...],
//     "email": [...], "website": ["sharmaelectronics.in"],   // host compare
//     "social": ["linkedin.com/in/x"],
//     "address_zip": "110024", "address_city": "New Delhi", "address_state": "Delhi",
//     "custom": {"GSTIN": "07AAA..."}      // optional
//   }
// }
const fs = require('fs');
const path = require('path');

global.window = {};
require(require('path').join(__dirname, '..', 'js', 'vcard.js'));
// js/ocr.js is an IIFE that only touches Tesseract lazily, so it loads fine with a stub.
// Loading it for real matters: the fixture text must go through the SAME line extraction
// production uses, or the bench scores a pipeline that does not exist.
new Function('window', 'Tesseract', fs.readFileSync(require('path').join(__dirname, '..', 'js', 'ocr.js'), 'utf8'))(global.window, {});
const OCR = global.window.OCR;
global.FormUI = { emptyModel: () => ({
  name: { prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', fnOverride: '' },
  work: { company: '', department: '', title: '', role: '', websites: [], calendar: '' },
  phones: [], emails: [], addresses: [], photo: null, logo: null, social: [],
  personal: { birthday: '', anniversary: '', gender: '' },
  other: { notes: '', categories: '', timezone: '', geoLat: '', geoLon: '' },
  custom: [], uid: ''
})};
require(require('path').join(__dirname, '..', 'js', 'card-parser.js'));
const CardParser = global.window.CardParser;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const target = args.find(a => !a.startsWith('--')) || path.join(__dirname, 'fixtures');

let files = [];
if (fs.statSync(target).isDirectory()) {
  files = fs.readdirSync(target).filter(f => f.endsWith('.json')).map(f => path.join(target, f)).sort();
} else files = [target];

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = s => String(s || '').replace(/\s*(?:ext\.?|extn\.?|x)\s*\d{1,5}\s*$/i, '').replace(/\D/g, '');
const host = u => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch (e) { return String(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; } };

// Fixture line text is written the way Tesseract reports a row of a two-column card:
// column fragments separated by a wide run of spaces. Lay each line out on a synthetic
// monospace grid so those runs become real geometric gaps, then push it through the REAL
// OCR.extractLines — the same code the browser runs — so the bench measures production.
function toRawLine(l, row) {
  const height = l.height || 20;
  const adv = height * 0.5;                       // advance per character
  const conf = l.confidence != null ? l.confidence : 85;
  const y0 = row * 30, y1 = y0 + height;
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(l.text)) !== null) {
    words.push({
      text: m[0], confidence: conf,
      bbox: { x0: Math.round(m.index * adv), y0, x1: Math.round((m.index + m[0].length) * adv), y1 }
    });
  }
  const x0 = words.length ? words[0].bbox.x0 : 0;
  const x1 = words.length ? words[words.length - 1].bbox.x1 : 0;
  return { text: l.text, confidence: conf, words, bbox: { x0, y0, x1, y1 } };
}

function toOcr(pages) {
  // emulate what scanner.js hands to CardParser after multi-page merge
  const lines = [];
  pages.forEach((pg, p) => {
    const extracted = OCR.extractLines({ lines: pg.map((l, i) => toRawLine(l, i)) });
    const n = extracted.length;
    extracted.forEach((l, i) => {
      lines.push(Object.assign({}, l, { page: p, pos: n > 1 ? i / (n - 1) : 0 }));
    });
  });
  return { text: lines.map(l => l.text).join('\n'), lines, pageCount: pages.length };
}

let total = 0, passed = 0;
const perFixture = [];

for (const file of files) {
  let fx;
  try { fx = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log('!! bad fixture ' + file + ': ' + e.message); continue; }
  const pages = fx.pages || [fx.lines || []];
  const res = CardParser.parse(toOcr(pages));
  const get = cat => res.fields.filter(f => f.category === cat).map(f => f.value);
  const exp = fx.expected || {};
  const checks = [];
  const check = (label, ok, got) => { checks.push({ label, ok, got }); total++; if (ok) passed++; };

  // name: honorific prefixes are stored separately in the vCard, so compare without them
  const stripPfx = s => norm(String(s || '').replace(/^(?:mr|mrs|ms|miss|dr|prof|er|ar|adv|ca|cs|capt|col|sri|shri|smt|md|mohd|syed|sh|dipl\.?-?ing|ing|dr\.?-?ing)\.?\s+/i, ''));
  if (exp.name != null) check('name', stripPfx(get('name')[0]) === stripPfx(exp.name), get('name')[0]);
  if (exp.title != null) check('title', norm(get('title')[0]) === norm(exp.title), get('title')[0]);
  if (exp.company != null) check('company', norm(get('company')[0]) === norm(exp.company), get('company')[0]);
  if (exp.department != null) check('department', norm(get('department')[0]) === norm(exp.department), get('department')[0]);
  for (const cat of ['mobile', 'work-phone', 'fax']) {
    if (exp[cat]) {
      const got = get(cat).map(digits);
      exp[cat].forEach(want => check(cat + ':' + want, got.includes(digits(want)), got));
    }
  }
  if (exp.phone_any) {
    const gotAll = ['mobile', 'work-phone', 'home-phone', 'fax'].flatMap(get).map(digits);
    exp.phone_any.forEach(want => check('phone_any:' + want, gotAll.includes(digits(want)), gotAll));
  }
  if (exp.email) {
    const got = get('email').map(s => s.toLowerCase());
    exp.email.forEach(want => check('email:' + want, got.includes(want.toLowerCase()), got));
  }
  if (exp.website) {
    const got = get('website').map(host);
    exp.website.forEach(want => check('website:' + want, got.includes(host(want)), got));
  }
  if (exp.social) {
    const got = get('social').map(s => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''));
    exp.social.forEach(want => check('social:' + want, got.some(g => g.includes(want.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''))), got));
  }
  const addr = res.fields.find(f => f.category === 'address');
  if (exp.address_zip != null) check('address_zip', !!addr && (addr.data && addr.data.zip === exp.address_zip || (addr.value || '').includes(exp.address_zip)), addr && (addr.data ? addr.data.zip : addr.value));
  if (exp.address_city != null) check('address_city', !!addr && norm(addr.data && addr.data.city) === norm(exp.address_city), addr && addr.data && addr.data.city);
  // state: accept canonical spellings ("Tamil Nadu" == "Tamilnadu" == "TN", "M.P." == "Madhya Pradesh")
  const STATE_ALIAS = { tn: 'tamilnadu', mp: 'madhyapradesh', up: 'uttarpradesh', hp: 'himachalpradesh', ap: 'andhrapradesh', wb: 'westbengal', mh: 'maharashtra', ka: 'karnataka', kl: 'kerala', gj: 'gujarat', rj: 'rajasthan', pb: 'punjab', hr: 'haryana', ts: 'telangana', cg: 'chhattisgarh', uk: 'uttarakhand' };
  const sq = s => { const k = String(s || '').toLowerCase().replace(/[^a-z]/g, ''); return STATE_ALIAS[k] || k; };
  if (exp.address_state != null) check('address_state', !!addr && sq(addr.data && addr.data.state) === sq(exp.address_state), addr && addr.data && addr.data.state);
  if (exp.address_contains) exp.address_contains.forEach(want => check('address_contains:' + want, !!addr && norm(addr.value).includes(norm(want)), addr && addr.value));
  if (exp.custom) {
    for (const [k, v] of Object.entries(exp.custom)) {
      const got = res.fields.filter(f => f.category === 'custom').map(f => f.value);
      check('custom:' + k, got.some(g => norm(g).includes(norm(k)) && norm(g).includes(norm(v))), got);
    }
  }
  if (exp.not_name) exp.not_name.forEach(bad => check('not_name:' + bad, norm(get('name')[0]) !== norm(bad), get('name')[0]));
  if (exp.not_company) exp.not_company.forEach(bad => check('not_company:' + bad, norm(get('company')[0]) !== norm(bad), get('company')[0]));

  const fails = checks.filter(c => !c.ok);
  perFixture.push({ name: fx.name || path.basename(file), pass: checks.length - fails.length, total: checks.length, fails });
  const tag = fails.length ? '✗' : '✓';
  console.log(`${tag} ${fx.name || path.basename(file)}  ${checks.length - fails.length}/${checks.length}`);
  if (fails.length || verbose) {
    (verbose ? checks : fails).forEach(c => console.log(`    ${c.ok ? '  ok ' : 'FAIL'} ${c.label}  → got ${JSON.stringify(c.got)}`));
    if (verbose) {
      console.log('    fields: ' + JSON.stringify(res.fields.map(f => f.category + '=' + f.value)));
      console.log('    unassigned: ' + JSON.stringify(res.unassigned));
    }
  }
}
console.log(`\nTOTAL ${passed}/${total} checks passed across ${files.length} fixtures`);
process.exit(passed === total ? 0 : 1);
