// Geometry tests for js/card-detect.js
//
// Everything here is pure maths, so it runs under plain `node` with no canvas.
// The pixel-level tests (warp PSNR, achieved bar pitch) need a real canvas and live
// in the browser bench.
//
// These pin the four bugs that are easy to ship and expensive to find:
//   1. homoRectToQuad's closed form disagreeing with the general solve
//   2. corner canonicalisation returning a reflected winding (transposes the warp)
//   3. measuring the aspect ratio off the imaged side lengths (keystone makes the far
//      edge shorter, so the output shape is wrong and glyphs stretch)
//   4. planOutputSize upsampling, i.e. inventing detail that is not in the photo
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'card-detect.js'), 'utf8');
const win = {};
new Function('window', 'document', src)(win, undefined);
const CD = win.CardDetect;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
// deterministic PRNG so a failure is always reproducible
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---------- synthetic pinhole camera ---------- */
// Projects a Wmm x Hmm planar rectangle, so the TRUE ratio and focal length are known.
function project(o) {
  const { wmm, hmm, tiltX = 0, tiltY = 0, rotZ = 0, dist, f, imgW, imgH } = o;
  const rad = d => d * Math.PI / 180;
  const az = rad(rotZ), ax = rad(tiltX), ay = rad(tiltY);
  const corners = [[-wmm / 2, -hmm / 2], [wmm / 2, -hmm / 2], [wmm / 2, hmm / 2], [-wmm / 2, hmm / 2]];
  return corners.map(([x0, y0]) => {
    // Rz
    let x = x0 * Math.cos(az) - y0 * Math.sin(az);
    let y = x0 * Math.sin(az) + y0 * Math.cos(az);
    let z = 0;
    // Rx
    let y1 = y * Math.cos(ax) - z * Math.sin(ax);
    let z1 = y * Math.sin(ax) + z * Math.cos(ax);
    y = y1; z = z1;
    // Ry
    let x1 = x * Math.cos(ay) + z * Math.sin(ay);
    z1 = -x * Math.sin(ay) + z * Math.cos(ay);
    x = x1; z = z1;
    z += dist;
    return [f * x / z + imgW / 2, f * y / z + imgH / 2];
  });
}

console.log('--- homoRectToQuad closed form vs general solve8 ---');
{
  const rnd = lcg(12345);
  let worstCoef = 0, worstCorner = 0, nulls = 0, n = 0;
  for (let t = 0; t < 200; t++) {
    // a convex quad: perturb a rectangle's corners by up to 15% of its size
    const w = 400 + rnd() * 1200, h = 250 + rnd() * 700;
    const j = () => (rnd() - 0.5) * 0.3;
    const quad = [[j() * w, j() * h], [w + j() * w, j() * h], [w + j() * w, h + j() * h], [j() * w, h + j() * h]];
    const q = CD.canonicalise(quad);
    if (!CD.isConvex(q)) continue;
    const outW = 1200, outH = 700;
    const rect = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
    const A = CD.homoRectToQuad(outW, outH, q);
    const B = CD.solve8(rect, q);
    if (!A || !B) { nulls++; continue; }
    n++;
    for (let i = 0; i < 8; i++) {
      const scale = Math.max(Math.abs(B[i]), 1e-6);
      worstCoef = Math.max(worstCoef, Math.abs(A[i] - B[i]) / scale);
    }
    // and it must actually land the rect corners on the quad corners
    for (let i = 0; i < 4; i++) {
      const p = CD.applyH(A, rect[i][0], rect[i][1]);
      worstCorner = Math.max(worstCorner, Math.hypot(p[0] - q[i][0], p[1] - q[i][1]));
    }
  }
  check('tested a meaningful number of quads', n > 150, n);
  check('coefficients agree to < 1e-9 relative', worstCoef < 1e-9, worstCoef);
  check('rect corners reproject onto quad corners to < 1e-9 px', worstCorner < 1e-9, worstCorner);
  check('no unexpected nulls', nulls === 0, nulls);
}

console.log('--- degenerate input returns null, never NaN ---');
{
  const collinear = [[0, 0], [100, 100], [200, 200], [300, 300]];
  check('collinear quad -> null', CD.homoRectToQuad(100, 100, collinear) === null);
  check('collinear via solve8 -> null', CD.solve8([[0, 0], [1, 1], [2, 2], [3, 3]], collinear) === null);
  check('zero-size rect -> null', CD.homoRectToQuad(0, 100, [[0, 0], [10, 0], [10, 10], [0, 10]]) === null);
  check('bad quad -> null', CD.canonicalise([[0, 0], [1, 0], [1, 1]]) === null);
  check('NaN corner -> null', CD.canonicalise([[0, 0], [NaN, 0], [1, 1], [0, 1]]) === null);
  const r = CD.recoverRatio(collinear, 1000, 1000);
  check('collinear ratio is null or finite, never NaN', r === null || isFinite(r.ratio), r);
}

console.log('--- canonicalise: TL,TR,BR,BL from any input order or winding ---');
{
  const truth = [[10, 20], [210, 25], [205, 140], [15, 135]];
  // every rotation, in both windings
  let allMatch = true;
  for (let rot = 0; rot < 4; rot++) {
    for (const rev of [false, true]) {
      let input = [0, 1, 2, 3].map(i => truth[(i + rot) % 4]);
      if (rev) input = input.slice().reverse();
      const out = CD.canonicalise(input);
      if (JSON.stringify(out) !== JSON.stringify(truth)) { allMatch = false; }
    }
  }
  check('all 8 permutations normalise to TL,TR,BR,BL', allMatch);
  const once = CD.canonicalise(truth);
  check('idempotent', JSON.stringify(CD.canonicalise(once)) === JSON.stringify(once));
  const angles = CD.cornerAngles(truth);
  check('corner angles near 90', angles.every(a => a > 80 && a < 100), angles);
  check('convex rectangle is convex', CD.isConvex(truth));
  check('bow-tie is not convex', !CD.isConvex([[0, 0], [100, 100], [100, 0], [0, 100]]));
}

console.log('--- recoverRatio on synthetic cameras with known ground truth ---');
{
  const CAMS = [
    { label: 'near fronto-parallel', wmm: 88.9, hmm: 50.8, tiltX: 1, tiltY: 1, dist: 190 },
    { label: 'mild tilt', wmm: 88.9, hmm: 50.8, tiltX: 10, tiltY: 7, dist: 190 },
    { label: 'hard tilt', wmm: 88.9, hmm: 50.8, tiltX: 25, tiltY: 18, dist: 200 },
    { label: 'extreme tilt', wmm: 88.9, hmm: 50.8, tiltX: 40, tiltY: 30, dist: 230 },
    { label: 'ID-1 85.6x53.98', wmm: 85.6, hmm: 53.98, tiltX: 20, tiltY: 12, dist: 200 },
    { label: 'EU 85x55', wmm: 85, hmm: 55, tiltX: 15, tiltY: 22, dist: 200 },
    { label: 'portrait 51x89', wmm: 51, hmm: 89, tiltX: 18, tiltY: 14, dist: 200 },
    { label: 'rotated in plane', wmm: 88.9, hmm: 50.8, tiltX: 16, tiltY: 12, rotZ: 8, dist: 200 }
  ];
  const IMG_W = 4000, IMG_H = 3000, F = 3400;
  CAMS.forEach(cam => {
    const quad = project(Object.assign({ f: F, imgW: IMG_W, imgH: IMG_H }, cam));
    const truth = cam.wmm / cam.hmm;
    const rec = CD.recoverRatio(quad, IMG_W, IMG_H);
    const err = Math.abs(rec.ratio - truth) / truth * 100;
    check(cam.label + ': ratio within 1% (got ' + rec.ratio.toFixed(4) + ' vs ' + truth.toFixed(4) + ', ' + rec.method + ')',
      err < 1, { err: err, rec: rec });
    if (rec.method === 'zhang') {
      const ferr = Math.abs(rec.focal - F) / F * 100;
      check(cam.label + ': focal within 2% (got ' + rec.focal.toFixed(0) + ' vs ' + F + ')', ferr < 2, ferr);
    }
  });
}

console.log('--- Zhang beats naive side lengths under keystone ---');
{
  const IMG_W = 4000, IMG_H = 3000, F = 3400;
  const cam = { wmm: 88.9, hmm: 50.8, tiltX: 32, tiltY: 24, dist: 210, f: F, imgW: IMG_W, imgH: IMG_H };
  const quad = project(cam);
  const truth = cam.wmm / cam.hmm;
  const zhang = CD.recoverRatio(quad, IMG_W, IMG_H);
  const naive = CD.sideRatio(CD.canonicalise(quad));
  const ez = Math.abs(zhang.ratio - truth) / truth * 100;
  const en = Math.abs(naive.ratio - truth) / truth * 100;
  check('Zhang error (' + ez.toFixed(2) + '%) beats side-length error (' + en.toFixed(2) + '%)', ez < en);
  check('side-length method is measurably wrong here', en > 1.5, en);
}

console.log('--- recoverRatio degrades gracefully under corner jitter ---');
{
  const IMG_W = 4000, IMG_H = 3000, F = 3400;
  const truth = 88.9 / 50.8;
  [2, 5, 10].forEach(px => {
    const rnd = lcg(777 + px);
    const errs = [];
    for (let t = 0; t < 200; t++) {
      const quad = project({ wmm: 88.9, hmm: 50.8, tiltX: 18, tiltY: 13, dist: 200, f: F, imgW: IMG_W, imgH: IMG_H })
        .map(p => [p[0] + (rnd() - 0.5) * 2 * px, p[1] + (rnd() - 0.5) * 2 * px]);
      const rec = CD.recoverRatio(quad, IMG_W, IMG_H);
      if (rec) errs.push(Math.abs(rec.ratio - truth) / truth * 100);
    }
    errs.sort((a, b) => a - b);
    const med = errs[errs.length >> 1];
    // snapping absorbs anything inside 8%, so the useful bound is well under that
    check('+/-' + px + 'px jitter: median error ' + med.toFixed(2) + '% stays under 6%', med < 6, med);
    check('+/-' + px + 'px jitter: all results finite', errs.length === 200, errs.length);
  });
}

console.log('--- snapRatio ---');
{
  check('1.73 snaps to 1.75', CD.snapRatio(1.73) === 1.75, CD.snapRatio(1.73));
  check('1.60 snaps to 1.586', CD.snapRatio(1.60) === 1.586, CD.snapRatio(1.60));
  check('1.55 snaps to 1.545', CD.snapRatio(1.55) === 1.545, CD.snapRatio(1.55));
  check('1.42 (between standards) is left alone', CD.snapRatio(1.42) === 1.42, CD.snapRatio(1.42));
  check('portrait 1/1.73 snaps to 1/1.75', Math.abs(CD.snapRatio(1 / 1.73) - 1 / 1.75) < 1e-12, CD.snapRatio(1 / 1.73));
  check('3.0 clamps to 2.05', CD.snapRatio(3.0) === 2.05, CD.snapRatio(3.0));
  check('1.0 clamps up to 1.35', CD.snapRatio(1.0) === 1.35, CD.snapRatio(1.0));
  check('garbage -> null', CD.snapRatio(0) === null && CD.snapRatio(NaN) === null);
}

console.log('--- planOutputSize: fixed px/mm, and never invents detail ---');
{
  // a big, sharp card: should hit the 22.5 px/mm target by downscaling
  const big = [[0, 0], [2400, 0], [2400, 1371], [0, 1371]];
  const p1 = CD.planOutputSize(1.75, big);
  check('targets ~22.5 px/mm when the pixels exist', Math.abs(p1.pxPerMm - CD.TARGET_PX_PER_MM) < 0.5, p1);
  check('respects the requested ratio', Math.abs(p1.width / p1.height - 1.75) < 0.01, p1);
  check('quality ok', p1.quality === 'ok', p1);
  check('not upsampled when the source is larger than the target', p1.upsampled === false, p1);

  // the hard invariant, across the whole plausible range of card sizes in frame
  let worstUp = 0;
  for (let srcLong = 300; srcLong <= 4000; srcLong += 20) {
    const q = [[0, 0], [srcLong, 0], [srcLong, Math.round(srcLong / 1.75)], [0, Math.round(srcLong / 1.75)]];
    const p = CD.planOutputSize(1.75, q);
    worstUp = Math.max(worstUp, Math.max(p.width, p.height) / p.srcLong);
  }
  check('never upsamples past 1.15x at any source size (worst ' + worstUp.toFixed(3) + 'x)', worstUp <= 1.15 + 1e-9, worstUp);

  // the real-world case the old frame-relative cap punished: card is small in frame
  const small = [[0, 0], [880, 0], [880, 503], [0, 503]];
  const p2 = CD.planOutputSize(1.75, small);
  check('small card is NOT upsampled past 1.15x', p2.width <= 880 * 1.15 + 1, p2);
  check('small card reports low quality honestly', p2.quality === 'low', p2);
  check('reports achieved px/mm ~' + p2.pxPerMm.toFixed(1), p2.pxPerMm > 10 && p2.pxPerMm < 14, p2);

  // hopeless: below the refusal threshold
  const tiny = [[0, 0], [600, 0], [600, 343], [0, 343]];
  const p3 = CD.planOutputSize(1.75, tiny);
  check('tiny card is flagged refuse', p3.quality === 'refuse', p3);

  // portrait
  const port = CD.planOutputSize(1 / 1.75, [[0, 0], [1086, 0], [1086, 1900], [0, 1900]]);
  check('portrait output is taller than wide', port.height > port.width, port);
  check('dpi is reported', Math.abs(port.dpi - port.pxPerMm * 25.4) < 1e-6, port);
  check('garbage ratio -> null', CD.planOutputSize(0, big) === null);
}

console.log('--- acceptRectification gates ---');
{
  const W = 4000, H = 3000;
  const good = [[500, 400], [3400, 420], [3380, 2100], [520, 2080]];
  check('a plausible card quad is accepted', CD.acceptRectification(good, W, H).accepted, CD.acceptRectification(good, W, H));

  const bowtie = [[0, 0], [1000, 1000], [1000, 0], [0, 1000]];
  check('bow-tie rejected', !CD.acceptRectification(bowtie, W, H).accepted);

  // a square region — e.g. a notebook page or a mouse mat, not a card
  const square = [[500, 500], [2500, 500], [2500, 2500], [500, 2500]];
  const sq = CD.acceptRectification(square, W, H);
  check('square region rejected as not card-shaped', !sq.accepted && /card-shaped/.test(sq.why), sq);

  // a long thin strip
  const strip = [[100, 100], [3900, 100], [3900, 600], [100, 600]];
  check('over-wide strip rejected', !CD.acceptRectification(strip, W, H).accepted);

  const speck = [[10, 10], [180, 12], [178, 110], [12, 108]];
  const sp = CD.acceptRectification(speck, W, H);
  check('a stray speck is rejected on area', !sp.accepted && /% of the frame/.test(sp.why), sp);

  // A small-but-real card must NOT be rejected on area — resolution is px/mm's job, and
  // it is the only one of the two that can tell the user to move closer.
  const distant = [[1700, 1250], [2320, 1245], [2325, 1600], [1705, 1605]];
  const d = CD.acceptRectification(distant, W, H);
  check('a distant card passes the geometry gate', d.accepted, d);
  const dp = CD.planOutputSize(1.75, distant);
  check('...and is refused on measured resolution instead (' + dp.pxPerMm.toFixed(1) + ' px/mm)',
    dp.quality === 'refuse', dp);

  // the outcome test is what catches a plausible quad around the wrong rectangle
  check('accepted when rows straighten',
    CD.acceptRectification(good, W, H, { scoreBefore: 1.0, scoreAfter: 1.4 }).accepted);
  const worse = CD.acceptRectification(good, W, H, { scoreBefore: 1.0, scoreAfter: 0.6 });
  check('rejected when rows do not straighten', !worse.accepted && /straighten/.test(worse.why), worse);
  check('a tiny dip is tolerated',
    CD.acceptRectification(good, W, H, { scoreBefore: 1.0, scoreAfter: 0.99 }).accepted);
}

console.log('--- insetQuad default ---');
{
  const q = CD.insetQuad(1000, 600);
  check('4% inset, canonical order', JSON.stringify(q) === JSON.stringify([[40, 24], [960, 24], [960, 576], [40, 576]]), q);
  check('inset quad is convex and card-ish', CD.isConvex(q));
}

console.log('\n' + (failures === 0 ? 'ALL CARD DETECT TESTS PASSED ✅' : failures + ' FAILURES ❌'));
process.exit(failures ? 1 : 0);
