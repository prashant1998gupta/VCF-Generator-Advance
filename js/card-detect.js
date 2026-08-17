/* ============================================================
   card-detect.js — card geometry: perspective rectification.

   A hand-held photo of a card is always keystoned, so a single global
   rotation cannot flatten it: under perspective the baseline angle varies
   from the top of the card to the bottom and the horizontal scale varies
   left to right. This module maps the card's four corners onto a flat
   rectangle at a FIXED physical resolution, in ONE resample, so:
     • text rows become genuinely horizontal (Tesseract stops splitting rows)
     • glyph aspect stops drifting across the card (what the LSTM tolerates least)
     • the background leaves the image, so every global statistic downstream
       (mean luma, percentile stretch, Otsu) sees card pixels only
     • resolution is spent on the card instead of the tablecloth

   Pure geometry — no DOM state. Only warpQuad/rectify touch a canvas, so
   the maths is unit-testable under plain `node` (tests/test_card_detect.js).

   Exposes global: CardDetect
   ============================================================ */
(function () {
  'use strict';

  /* Standard business-card aspect ratios, long side / short side:
       3.5 x 2 in       (US)          1.750
       89 x 51 mm       (IN / EU)     1.745   within 0.3% of US — one entry covers both
       85.60 x 53.98 mm (ID-1)        1.586
       85 x 55 mm       (EU)          1.545                                        */
  const CARD_RATIOS = [1.75, 1.586, 1.545];
  const RATIO_MIN = 1.35, RATIO_MAX = 2.05;
  const SNAP_WINDOW = 0.08;

  // 22.5 px/mm = 572 dpi. A 6 pt x-height is ~1.06 mm, so it lands at ~24 px —
  // comfortably above the ~15-20 px Tesseract's LSTM needs, with margin for blur.
  const TARGET_PX_PER_MM = 22.5;
  const CARD_LONG_MM = 86;            // 85-89 across the standards; 86 is within 3.5% of all
  const MAX_LONG_PX = 2400;
  const MIN_LONG_PX = 240;            // only to avoid degenerate canvases
  const MAX_UPSAMPLE = 1.15;          // rectifying cannot invent detail
  const PX_PER_MM_REFUSE = 10;        // below this the information is simply not there
  const PX_PER_MM_LOW = 14;           // above this, small print is safe

  /* ================= vector helpers ================= */

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const finitePt = p => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]);
  const validQuad = q => Array.isArray(q) && q.length === 4 && q.every(finitePt);

  /* ================= corner ordering ================= */

  /**
   * Canonical corner order: TL, TR, BR, BL. Accepts any rotation or winding.
   * Sorting by angle about the centroid normalises winding (in screen coords, with
   * y downward, ascending atan2 walks TL -> TR -> BR -> BL), then the corner nearest
   * the origin is rotated to the front. Omitting this returns a reflected winding,
   * which silently transposes the warp.
   */
  function canonicalise(quad) {
    if (!validQuad(quad)) return null;
    const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
    const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
    const sorted = quad.slice().sort(
      (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
    );
    let best = 0, bestSum = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = sorted[i][0] + sorted[i][1];
      if (s < bestSum) { bestSum = s; best = i; }
    }
    return [0, 1, 2, 3].map(i => {
      const p = sorted[(best + i) % 4];
      return [p[0], p[1]];
    });
  }

  /** Mean length of each opposite side pair of a TL,TR,BR,BL quad. */
  function quadSides(q) {
    return {
      w: (len(q[0], q[1]) + len(q[3], q[2])) / 2,
      h: (len(q[0], q[3]) + len(q[1], q[2])) / 2
    };
  }

  /** Interior angle at each corner, in degrees. */
  function cornerAngles(q) {
    return [0, 1, 2, 3].map(i => {
      const p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
      const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
      const a2 = Math.atan2(n[1] - c[1], n[0] - c[0]);
      let d = Math.abs(a1 - a2) * 180 / Math.PI;
      if (d > 180) d = 360 - d;
      return d;
    });
  }

  /** Shoelace area (always positive for a canonicalised quad). */
  function quadArea(q) {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(z) < 1e-9) continue;
      const s = z > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return sign !== 0;
  }

  /** Default quad: a rectangle inset by `frac` of each dimension. */
  function insetQuad(w, h, frac) {
    const f = frac == null ? 0.04 : frac;
    const dx = w * f, dy = h * f;
    return [[dx, dy], [w - dx, dy], [w - dx, h - dy], [dx, h - dy]];
  }

  /* ================= homography ================= */

  /**
   * General 8-DOF solve: the homography taking src[i] -> dst[i], as
   * [a,b,c,d,e,f,g,h,1] meaning
   *     u = (a*x + b*y + c) / (g*x + h*y + 1)
   *     v = (d*x + e*y + f) / (g*x + h*y + 1)
   * 8x9 Gauss-Jordan with partial pivoting. Kept as the reference for
   * homoRectToQuad and used to map OCR boxes back to source pixels.
   * Returns null on a degenerate configuration rather than propagating NaN.
   */
  function solve8(src, dst) {
    if (!validQuad(src) || !validQuad(dst)) return null;
    const M = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      M.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      M.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      const t = M[c]; M[c] = M[p]; M[p] = t;
      const pv = M[c][c];
      for (let k = c; k < 9; k++) M[c][k] /= pv;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (!f) continue;
        for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k];
      }
    }
    const h = M.map(r => r[8]);
    return h.every(isFinite) ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
  }

  /**
   * Closed form for the case we actually need: the rectangle (0,0)-(w,h) mapped
   * onto `quad` (TL,TR,BR,BL). This is the BACKWARD map used by the warp — output
   * pixel in, source pixel out — so the warp needs no matrix inversion.
   * Agrees with solve8 to ~1e-15 and is far cheaper.
   */
  function homoRectToQuad(w, h, quad) {
    const q = canonicalise(quad);
    if (!q || !(w > 0) || !(h > 0)) return null;
    const x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1];
    const x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    const dx1 = x1 - x2, dy1 = y1 - y2;
    const dx2 = x3 - x2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dy1 * dx2;
    if (!isFinite(den) || Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - sy * dx2) / den;
    const hp = (dx1 * sy - dy1 * sx) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + hp * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + hp * y3, f = y0;
    // unit square -> quad, then prepend diag(1/w, 1/h, 1) for rect(w,h) -> quad
    const H = [a / w, b / h, c, d / w, e / h, f, g / w, hp / h, 1];
    return H.every(isFinite) ? H : null;
  }

  /** Apply a homography to a point. */
  function applyH(H, x, y) {
    const wq = H[6] * x + H[7] * y + 1;
    if (!wq) return null;
    return [(H[0] * x + H[1] * y + H[2]) / wq, (H[3] * x + H[4] * y + H[5]) / wq];
  }

  /* ================= aspect-ratio recovery ================= */

  /** Mean-side-length ratio: correct only for a fronto-parallel shot. */
  function sideRatio(q) {
    const s = quadSides(q);
    if (!(s.w > 0) || !(s.h > 0)) return null;
    return { ratio: s.w / s.h, focal: null, method: 'sides' };
  }

  /**
   * Recover the TRUE width/height ratio of a rectangle from its perspective
   * projection (Zhang). Under keystone the imaged side lengths are wrong — the far
   * edge is shorter — so measuring the quad directly biases the output shape and
   * stretches glyphs. This recovers both the ratio and the focal length from the
   * four corners alone, assuming square pixels and no lens distortion.
   * Falls back to sideRatio() when the geometry is near-affine (f^2 <= 0), which
   * is exactly the case where the side lengths ARE right.
   */
  function recoverRatio(quad, imgW, imgH) {
    const q = canonicalise(quad);
    if (!q) return null;
    const u0 = imgW / 2, v0 = imgH / 2;
    // Zhang's labelling: m1,m2,m3,m4 <-> rect corners (0,0),(1,0),(0,1),(1,1)
    const m1 = [q[0][0] - u0, q[0][1] - v0, 1];
    const m2 = [q[1][0] - u0, q[1][1] - v0, 1];
    const m3 = [q[3][0] - u0, q[3][1] - v0, 1];
    const m4 = [q[2][0] - u0, q[2][1] - v0, 1];

    const c14 = cross(m1, m4);
    const d2 = dot(cross(m2, m4), m3);
    const d3 = dot(cross(m3, m4), m2);
    if (Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9) return sideRatio(q);

    const k2 = dot(c14, m3) / d2;
    const k3 = dot(c14, m2) / d3;
    const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
    const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
    if (Math.abs(n2[2]) < 1e-7 || Math.abs(n3[2]) < 1e-7) return sideRatio(q);

    // orthogonality of the two rectangle directions under diag(1/f^2, 1/f^2, 1)
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (!(f2 > 0)) return sideRatio(q);

    const num = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2];
    const den = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
    if (!(num > 0) || !(den > 0)) return sideRatio(q);

    const r = Math.sqrt(num / den);
    if (!isFinite(r) || r <= 0) return sideRatio(q);
    return { ratio: r, focal: Math.sqrt(f2), method: 'zhang' };
  }

  /**
   * Snap a measured ratio to the nearest standard card ratio when it is within 8%,
   * so a good-enough corner drag still produces exactly-square output. Clamped, and
   * orientation-preserving (a portrait card snaps to the reciprocal).
   */
  function snapRatio(r) {
    if (!isFinite(r) || r <= 0) return null;
    const portrait = r < 1;
    let long = portrait ? 1 / r : r;
    // NEAREST within the window, not the first: 1.586 (ID-1) and 1.545 (EU 85x55) are
    // only 2.6% apart, so their 8% windows overlap and first-match picks the wrong one
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < CARD_RATIOS.length; i++) {
      const d = Math.abs(long - CARD_RATIOS[i]) / CARD_RATIOS[i];
      if (d <= SNAP_WINDOW && d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0) long = CARD_RATIOS[bestI];
    long = Math.min(RATIO_MAX, Math.max(RATIO_MIN, long));
    return portrait ? 1 / long : long;
  }

  /* ================= output sizing ================= */

  /**
   * Choose the rectified canvas size. Targets a FIXED physical resolution rather
   * than a fraction of the frame, which is the whole point: what matters is px/mm
   * of card, not megapixels of photo. Never upsamples meaningfully, and reports the
   * achieved resolution so a hopeless photo fails visibly instead of silently.
   */
  function planOutputSize(ratio, quad) {
    if (!isFinite(ratio) || ratio <= 0) return null;
    const q = canonicalise(quad);
    if (!q) return null;
    const s = quadSides(q);
    const srcLong = Math.max(s.w, s.h);
    if (!(srcLong > 0)) return null;

    let long = Math.round(TARGET_PX_PER_MM * CARD_LONG_MM);
    long = Math.min(long, Math.round(srcLong * MAX_UPSAMPLE));   // cannot invent detail
    long = Math.max(MIN_LONG_PX, Math.min(MAX_LONG_PX, long));

    const landscape = ratio >= 1;
    const width = landscape ? long : Math.max(1, Math.round(long * ratio));
    const height = landscape ? Math.max(1, Math.round(long / ratio)) : long;
    const pxPerMm = long / CARD_LONG_MM;
    return {
      width: width, height: height,
      pxPerMm: pxPerMm, dpi: pxPerMm * 25.4,
      srcLong: srcLong,
      upsampled: long > srcLong * 1.001,
      quality: pxPerMm < PX_PER_MM_REFUSE ? 'refuse' : (pxPerMm < PX_PER_MM_LOW ? 'low' : 'ok')
    };
  }

  /* ================= warp ================= */

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /**
   * Inverse-map the quad onto an outW x outH canvas with bilinear sampling.
   * ONE resample from source pixels — it replaces today's rotate-then-crop-then-scale
   * chain, and residual skew is folded into the quad rather than costing another pass.
   */
  function warpQuad(src, quad, outW, outH) {
    const q = canonicalise(quad);
    if (!q || !(outW > 0) || !(outH > 0)) return null;
    const H = homoRectToQuad(outW, outH, q);
    if (!H) return null;

    // Minifying hard aliases badly on 6 pt type; sample from a box-filtered mip.
    // Cost is the same either way (the loop is compute-bound), so this buys quality.
    const s = quadSides(q);
    const minify = Math.max(s.w / outW, s.h / outH);
    let sample = src, k = 1;
    if (minify > 1.3) {
      const target = Math.min(minify, 8);
      const mw = Math.max(1, Math.round(src.width / target));
      const mh = Math.max(1, Math.round(src.height / target));
      const mip = makeCanvas(mw, mh);
      const mc = mip.getContext('2d');
      mc.imageSmoothingEnabled = true;
      mc.imageSmoothingQuality = 'high';
      mc.drawImage(src, 0, 0, mw, mh);
      sample = mip;
      k = src.width / mw;                      // actual achieved scale
    }

    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const sd = sctx.getImageData(0, 0, sample.width, sample.height);
    const S = sd.data, SW = sd.width, SH = sd.height;

    const out = makeCanvas(outW, outH);
    const octx = out.getContext('2d');
    const od = octx.createImageData(outW, outH);
    const D = od.data;

    const a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
    let o = 0;
    for (let y = 0; y < outH; y++) {
      const yc = y + 0.5;
      // incremental along the row: one reciprocal per pixel, no per-pixel matrix work
      let nx = a * 0.5 + b * yc + c;
      let ny = d * 0.5 + e * yc + f;
      let nw = g * 0.5 + hh * yc + 1;
      for (let x = 0; x < outW; x++, o += 4) {
        const iw = nw !== 0 ? 1 / nw : 0;
        const fx = (nx * iw) / k - 0.5;
        const fy = (ny * iw) / k - 0.5;
        nx += a; ny += d; nw += g;

        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        if (x0 < -1 || y0 < -1 || x0 > SW - 1 || y0 > SH - 1) {
          D[o] = D[o + 1] = D[o + 2] = 255; D[o + 3] = 255;   // outside the card: white
          continue;
        }
        const tx = fx - x0, ty = fy - y0;
        const xa = x0 < 0 ? 0 : x0, xb = x0 + 1 > SW - 1 ? SW - 1 : x0 + 1;
        const ya = y0 < 0 ? 0 : y0, yb = y0 + 1 > SH - 1 ? SH - 1 : y0 + 1;
        const i00 = (ya * SW + xa) * 4, i10 = (ya * SW + xb) * 4;
        const i01 = (yb * SW + xa) * 4, i11 = (yb * SW + xb) * 4;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty, w11 = tx * ty;
        D[o] = S[i00] * w00 + S[i10] * w10 + S[i01] * w01 + S[i11] * w11;
        D[o + 1] = S[i00 + 1] * w00 + S[i10 + 1] * w10 + S[i01 + 1] * w01 + S[i11 + 1] * w11;
        D[o + 2] = S[i00 + 2] * w00 + S[i10 + 2] * w10 + S[i01 + 2] * w01 + S[i11 + 2] * w11;
        D[o + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /* ================= outcome test ================= */

  function otsu(gray, n) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, maxVar = 0, best = 127;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = n - wB;
      if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; best = v; }
    }
    return best;
  }

  /**
   * How horizontal and well-separated are the text rows? Normalised variance of the
   * horizontal ink-projection profile — dividing by mean^2 makes it scale-free, so
   * two different images can be compared. This is the OUTCOME gate: a rectification
   * that does not make the rows more horizontal is not an improvement, whatever the
   * corner geometry claims.
   */
  function textRowScore(canvas, maxW) {
    if (!canvas || !canvas.width || !canvas.height) return 0;
    const W = Math.min(maxW || 500, canvas.width);
    const H = Math.max(8, Math.round(canvas.height * W / canvas.width));
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, W, H);
    const im = ctx.getImageData(0, 0, W, H).data;
    const n = W * H;
    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) gray[i] = 0.299 * im[i * 4] + 0.587 * im[i * 4 + 1] + 0.114 * im[i * 4 + 2];
    const thr = otsu(gray, n);
    let dark = 0;
    for (let i = 0; i < n; i++) if (gray[i] < thr) dark++;
    const invert = dark > n / 2;                       // light text on a dark card
    const rows = new Float64Array(H);
    let total = 0;
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = 0; x < W; x++) {
        const g = gray[y * W + x];
        if (invert ? g >= thr : g < thr) s++;
      }
      rows[y] = s; total += s;
    }
    if (!total) return 0;
    const mean = total / H;
    let v = 0;
    for (let y = 0; y < H; y++) { const d = rows[y] - mean; v += d * d; }
    return (v / H) / (mean * mean);
  }

  /**
   * Axis-aligned crop of the quad's bounding box: the same CONTENT as the rectified
   * card, minus the un-keystoning. This is the only fair baseline for the outcome test —
   * scoring the whole frame instead lets the empty background rows above and below the
   * card inflate the "before" variance, which rejects every good rectification.
   */
  function cropQuadBBox(src, quad) {
    const q = canonicalise(quad);
    if (!q || !src || !src.width) return null;
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min.apply(null, xs)));
    const y0 = Math.max(0, Math.floor(Math.min.apply(null, ys)));
    const x1 = Math.min(src.width, Math.ceil(Math.max.apply(null, xs)));
    const y1 = Math.min(src.height, Math.ceil(Math.max.apply(null, ys)));
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 1) || !(h > 1)) return null;
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(src, x0, y0, w, h, 0, 0, w, h);
    return c;
  }

  /**
   * Gate the result. Rectification must never make things worse than today, so a
   * rejection means the caller runs exactly the existing pipeline on the original
   * bytes. Geometry checks catch an implausible quad; the outcome test catches the
   * dangerous case a plausible quad cannot — a convex, correctly-proportioned
   * rectangle drawn around a laptop keyboard or a notebook page instead of the card.
   */
  function acceptRectification(quad, srcW, srcH, opts) {
    const q = canonicalise(quad);
    if (!q) return { accepted: false, why: 'no quad' };
    if (!isConvex(q)) return { accepted: false, why: 'quad is not convex' };

    const angles = cornerAngles(q);
    if (angles.some(a => a < 55 || a > 125)) return { accepted: false, why: 'corner angles out of range' };

    const s = quadSides(q);
    if (!(s.w > 0) || !(s.h > 0)) return { accepted: false, why: 'degenerate sides' };
    const long = Math.max(s.w, s.h) / Math.min(s.w, s.h);
    if (long < RATIO_MIN || long > RATIO_MAX) return { accepted: false, why: 'aspect ratio ' + long.toFixed(2) + ' is not card-shaped' };

    // Area is only a floor against a stray speck / mis-detection. It is deliberately NOT
    // the resolution test: a card at 8% of a 48 MP frame still yields ~26 px/mm, while the
    // same 8% of a 5 MP frame does not. Resolution is judged in px/mm by planOutputSize,
    // which can also tell the user the actionable thing ("move closer").
    const frac = quadArea(q) / Math.max(1, srcW * srcH);
    if (frac < 0.01) return { accepted: false, why: 'quad covers only ' + (frac * 100).toFixed(1) + '% of the frame' };
    if (frac > 1.05) return { accepted: false, why: 'quad is larger than the frame' };

    const o = opts || {};
    if (o.scoreBefore != null && o.scoreAfter != null && o.scoreAfter < o.scoreBefore * 0.98) {
      return { accepted: false, why: 'text rows did not straighten' };
    }
    return { accepted: true, why: '' };
  }

  /* ================= orchestration ================= */

  /**
   * Full pipeline: quad -> true ratio -> output size -> single warp -> gate.
   * Returns { canvas, pxPerMm, dpi, ratio, quality, accepted, why }. On rejection
   * `canvas` is null and the caller must fall back to the unrectified image.
   */
  function rectify(src, quad, opts) {
    const o = opts || {};
    const q = canonicalise(quad);
    if (!q) return { accepted: false, why: 'no quad', canvas: null };

    const pre = acceptRectification(q, src.width, src.height);
    if (!pre.accepted) return { accepted: false, why: pre.why, canvas: null };

    const rec = recoverRatio(q, src.width, src.height);
    if (!rec) return { accepted: false, why: 'could not recover aspect ratio', canvas: null };
    const ratio = o.ratio || snapRatio(rec.ratio);
    if (!ratio) return { accepted: false, why: 'invalid aspect ratio', canvas: null };

    const plan = planOutputSize(ratio, q);
    if (!plan) return { accepted: false, why: 'could not size the output', canvas: null };

    const canvas = warpQuad(src, q, plan.width, plan.height);
    if (!canvas) return { accepted: false, why: 'warp failed', canvas: null };

    // outcome gate: compare like with like — the cropped card, not the whole frame
    const post = acceptRectification(q, src.width, src.height, {
      scoreBefore: textRowScore(cropQuadBBox(src, q) || src),
      scoreAfter: textRowScore(canvas)
    });
    if (!post.accepted) return { accepted: false, why: post.why, canvas: null };

    return {
      accepted: true, why: '', canvas: canvas,
      quad: q, ratio: ratio, measuredRatio: rec.ratio, ratioMethod: rec.method, focal: rec.focal,
      pxPerMm: plan.pxPerMm, dpi: plan.dpi, quality: plan.quality, upsampled: plan.upsampled
    };
  }

  window.CardDetect = {
    // corner handling
    canonicalise, insetQuad, quadSides, cornerAngles, quadArea, isConvex,
    // homography
    solve8, homoRectToQuad, applyH,
    // shape
    recoverRatio, snapRatio, sideRatio, planOutputSize,
    // pixels
    warpQuad, textRowScore, cropQuadBBox,
    // gates + orchestration
    acceptRectification, rectify,
    // constants worth asserting against in tests / UI copy
    TARGET_PX_PER_MM, CARD_LONG_MM, PX_PER_MM_REFUSE, PX_PER_MM_LOW, CARD_RATIOS
  };
})();
