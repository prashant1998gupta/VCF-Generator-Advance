// Unit tests for OCR line extraction (js/ocr.js → OCR.extractLines)
//
// Tesseract reads a two-column card ROW-WISE, so one reported "line" is often a
// left-column fragment plus an unrelated right-column fragment. The only evidence of
// the gutter is the horizontal gap between word boxes; card-parser.js consumes it as the
// "‖" segment separator. These tests pin the gap rule: a real gutter must split, and
// ordinary (even generous) word spacing must not.
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ocr.js'), 'utf8');
const win = {};
new Function('window', 'Tesseract', src)(win, {});
const { extractLines } = win.OCR;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

// build a line from [text, x0, x1] word triples
function LN(triples, height, opts) {
  const y0 = 0, y1 = height;
  const words = triples.map(([text, x0, x1]) => ({ text, confidence: 85, bbox: { x0, y0, x1, y1 } }));
  const text = (opts && opts.text != null) ? opts.text : triples.map(t => t[0]).join(' ');
  return {
    text, confidence: 85,
    words: (opts && opts.noWords) ? [] : words,
    bbox: { x0: triples.length ? triples[0][1] : 0, y0, x1: triples.length ? triples[triples.length - 1][2] : 0, y1 }
  };
}
const one = line => extractLines({ lines: [line] })[0];
const textOf = line => { const r = one(line); return r ? r.text : null; };

console.log('--- a real gutter splits ---');
{
  // "Shop No. 4" | "Mo. : 98120" — normal 6px spaces, one 60px gutter
  const t = textOf(LN([['Shop', 0, 40], ['No.', 46, 76], ['4', 82, 92], ['Mo.', 152, 182], [':', 188, 194], ['98120', 200, 260]], 20));
  check('gutter becomes a ‖ separator', t === 'Shop No. 4 ‖ Mo. : 98120', t);
  check('normal spaces stay spaces', (t.match(/‖/g) || []).length === 1, t);
}

console.log('--- two fragments of ONE word each still split ---');
{
  // regression: with a single gap the median IS that gap, so a median-only rule
  // could never fire and "Proprietor ‖ Partner" silently fused
  const t = textOf(LN([['Proprietor', 0, 70], ['Partner', 154, 203]], 14));
  check('single-gap row splits', t === 'Proprietor ‖ Partner', t);
}

console.log('--- three columns split twice ---');
{
  const t = textOf(LN([['Delhi', 0, 50], ['Mumbai', 200, 270], ['Pune', 420, 470]], 20));
  check('two separators', t === 'Delhi ‖ Mumbai ‖ Pune', t);
}

console.log('--- ordinary word spacing must NOT split ---');
{
  const t = textOf(LN([['Rakesh', 0, 60], ['Kumar', 66, 120], ['Sharma', 126, 190]], 20));
  check('name line stays intact', t === 'Rakesh Kumar Sharma', t);
}

console.log('--- a generously spaced line must NOT split ---');
{
  // 22px gaps on a 20px-tall line: wide for a space, far short of a gutter
  const t = textOf(LN([['Wholesale', 0, 90], ['&', 112, 122], ['Retail', 144, 196], ['Dealers', 218, 288]], 20));
  check('no false gutter', t === 'Wholesale & Retail Dealers', t);
}

console.log('--- letter-spaced display type must NOT split ---');
{
  // "P A T E L" set as separate words at 0.5em tracking on a 40px line
  const t = textOf(LN([['P', 0, 24], ['A', 44, 68], ['T', 88, 112], ['E', 132, 156], ['L', 176, 200]], 40));
  check('tracked caps stay one line', t === 'P A T E L', t);
}

console.log('--- degenerate geometry ---');
{
  check('single word line', textOf(LN([['PB', 0, 40]], 44)) === 'PB');
  check('touching words (gap 0)', textOf(LN([['ab', 0, 20], ['cd', 20, 40]], 20)) === 'ab cd');
  const kerned = textOf(LN([['Va', 0, 20], ['lue', 17, 50]], 20));
  check('negative/kerned gap does not split', kerned === 'Va lue', kerned);
}

console.log('--- text fallback when word boxes are unavailable ---');
{
  const t = textOf(LN([], 15, { noWords: true, text: 'Rohtak (Haryana)      E : a@b.in' }));
  check('wide run becomes ‖', t === 'Rohtak (Haryana) ‖ E : a@b.in', t);
  const t2 = textOf(LN([], 15, { noWords: true, text: '  Patel  Brothers \n' }));
  check('single/double spaces collapse, line trimmed', t2 === 'Patel Brothers', t2);
}

console.log('--- reconstruction guard ---');
{
  // word boxes that do not account for every reported character must not silently
  // drop content — fall back to the reported line text
  const t = textOf(LN([['Shop', 0, 40], ['4', 200, 210]], 20, { text: 'Shop No. 4' }));
  check('mismatched words fall back to line text', t === 'Shop No. 4', t);
}

console.log('--- record shape ---');
{
  const r = one(LN([['Acme', 0, 50], ['Ltd', 56, 90]], 26));
  check('height from bbox', r.height === 26, r.height);
  check('confidence preserved', r.confidence === 85, r.confidence);
  check('bbox passed through', r.bbox.x0 === 0 && r.bbox.x1 === 90, r.bbox);
  check('empty lines dropped', extractLines({ lines: [LN([], 20, { noWords: true, text: '   ' })] }).length === 0);
}

console.log('--- v5 blocks → paragraphs → lines shape ---');
{
  const line = LN([['GSTIN', 0, 60], [':', 66, 72], ['24AAEFP1234Q1ZR', 78, 230]], 13);
  const out = extractLines({ blocks: [{ paragraphs: [{ lines: [line] }] }] });
  check('walks the v5 nesting', out.length === 1 && out[0].text === 'GSTIN : 24AAEFP1234Q1ZR', out);
}

console.log('\n' + (failures === 0 ? 'ALL OCR LINE TESTS PASSED ✅' : failures + ' FAILURES ❌'));
process.exit(failures ? 1 : 0);
