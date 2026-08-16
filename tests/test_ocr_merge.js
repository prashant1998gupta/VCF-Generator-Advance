// Unit tests for the dual-pass OCR line merge (js/ocr.js → OCR.mergeLineSets)
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ocr.js'), 'utf8');
const win = {};
new Function('window', 'Tesseract', src)(win, {});
const { mergeLineSets, similarity } = win.OCR;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
// helper: a line on row `row` spanning x0..x1
const L = (text, conf, row, x0, x1) => ({
  text, confidence: conf, height: 20,
  bbox: { y0: row * 30, y1: row * 30 + 20, x0, x1 }
});
const texts = ls => ls.map(l => l.text);

console.log('--- sparse pass spanning two primary blocks ---');
{
  // PSM 3 split one printed line into two blocks; PSM 11 read it whole
  const primary = [L('Rakesh', 80, 0, 0, 100), L('Sharma', 80, 0, 110, 220)];
  const sparse = [L('Rakesh Sharma', 88, 0, 0, 220)];
  const out = mergeLineSets(primary, sparse);
  check('collapses to one line', out.length === 1, texts(out));
  check('keeps the full reading', out[0] && out[0].text === 'Rakesh Sharma', texts(out));
}

console.log('--- higher-confidence sparse reading replaces primary ---');
{
  const primary = [L('Rakesh Sharrna', 60, 0, 0, 220)];
  const sparse = [L('Rakesh Sharma', 90, 0, 0, 220)];
  const out = mergeLineSets(primary, sparse);
  check('one line kept', out.length === 1, texts(out));
  check('better reading wins', out[0].text === 'Rakesh Sharma', texts(out));
}

console.log('--- lower-confidence sparse reading does not replace ---');
{
  const primary = [L('rakesh@acme.com', 92, 0, 0, 220)];
  const sparse = [L('rakesh@acrne.com', 55, 0, 0, 220)];
  const out = mergeLineSets(primary, sparse);
  check('primary retained', out.length === 1 && out[0].text === 'rakesh@acme.com', texts(out));
}

console.log('--- genuinely new sparse line is appended ---');
{
  const primary = [L('Rakesh Sharma', 88, 0, 0, 220)];
  const sparse = [L('GSTIN : 06AAFPA1234H1Z5', 70, 5, 0, 300)];
  const out = mergeLineSets(primary, sparse);
  check('both lines present', out.length === 2, texts(out));
  check('new line flagged fromSparse', out[1].fromSparse === true, out[1]);
}

console.log('--- distinct lines on different rows are not merged ---');
{
  const primary = [L('Sales Manager', 85, 1, 0, 200), L('Sales Head', 85, 4, 0, 200)];
  const sparse = [L('Sales Manager', 86, 1, 0, 200)];
  const out = mergeLineSets(primary, sparse);
  check('no accidental collapse', out.length === 2, texts(out));
}

console.log('--- two-column row: sparse half must not swallow the other column ---');
{
  const primary = [L('Bharat Patel', 85, 0, 0, 200), L('Kirit Patel', 85, 0, 600, 800)];
  const sparse = [L('Bharat Patel', 90, 0, 0, 200)];
  const out = mergeLineSets(primary, sparse);
  check('both columns survive', out.length === 2, texts(out));
  check('right column intact', texts(out).includes('Kirit Patel'), texts(out));
}

console.log('--- similarity sanity ---');
{
  check('identical = 1', similarity('Rakesh Sharma', 'Rakesh Sharma') === 1);
  check('near match high', similarity('Rakesh Sharma', 'Rakesh Sharrna') > 0.7, similarity('Rakesh Sharma', 'Rakesh Sharrna'));
  check('unrelated low', similarity('Rakesh Sharma', 'GSTIN 06AAF') < 0.3, similarity('Rakesh Sharma', 'GSTIN 06AAF'));
}

console.log('\n' + (failures === 0 ? 'ALL OCR MERGE TESTS PASSED ✅' : failures + ' FAILURES ❌'));
process.exit(failures ? 1 : 0);
