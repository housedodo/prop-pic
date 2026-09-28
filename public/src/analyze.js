// Pixel analysis: how much of an image (or a region of it) is a target color.
// Pure functions over RGBA arrays so they can be unit-tested in Node.
//
// Pixels are converted to OKLCh (lightness, chroma = vividness, hue angle), a
// color space where hue matches how people name colors much better than RGB.
// Each palette color is a region in that space (see `match` in colors.js),
// so "brown" can mean dark + muted and "orange" bright + vivid at a similar hue.

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// sRGB 0..255 → [L 0..1, C 0..~0.37, h 0..360)
export function rgbToOklch(r, g, b) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, bb), h];
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Signed distance from `from` to `h` going clockwise, 0..360.
const arc = (from, h) => (((h - from) % 360) + 360) % 360;

/**
 * How well one pixel fits a color's `match` region: 0 = not that color, up to 1 = textbook example.
 * @param {[number, number, number]} lch
 * @param {object} match see PALETTE in colors.js
 */
export function matchStrength([L, C, h], match) {
  if (L < match.minL || L > match.maxL || C < (match.minC ?? 0) || C > (match.maxC ?? Infinity)) return 0;

  if (match.neutral === 'light') {
    return 0.5 * ((L - match.minL) / (1 - match.minL)) + 0.5 * (1 - C / match.maxC);
  }
  if (match.neutral === 'dark') {
    return 0.5 * (1 - (L / match.maxL) ** 2) + 0.5 * (1 - C / match.maxC);
  }

  const [from, to, ideal] = match.hue;
  const span = arc(from, to);
  const pos = arc(from, h);
  if (pos > span) return 0;
  // 0 at the ideal hue, 1 at the edge of the range on that side.
  const mid = ideal == null ? span / 2 : arc(from, ideal);
  const offCentre = pos < mid ? (mid - pos) / mid : (pos - mid) / (span - mid || 1);
  // Rewards vivid pixels; 1.6× the minimum chroma or more counts as fully vivid.
  const vivid = Math.min(1, C / (match.minC * 1.6));
  // Squared, so shades near the ideal hue all score well and only the fringes drop off.
  return Math.max(0.05, 0.6 * (1 - offCentre * offCentre) + 0.4 * vivid);
}

/**
 * Classify every pixel, then drop isolated matches (fewer than 4 matching pixels in
 * its 3×3 neighbourhood, counting itself) so texture noise and edge fringes don't count.
 * @returns {{mask: Uint8Array, strength: Float32Array, valid: Uint8Array}}
 */
export function colorMask(data, width, height, match) {
  const n = width * height;
  const raw = new Uint8Array(n);
  const strength = new Float32Array(n);
  const valid = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    valid[p] = 1;
    const s = matchStrength(rgbToOklch(data[i], data[i + 1], data[i + 2]), match);
    if (s > 0) {
      raw[p] = 1;
      strength[p] = s;
    }
  }

  const mask = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!raw[p]) continue;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) count += raw[yy * width + xx];
        }
      }
      // Pixels on the image border have fewer neighbours; scale the requirement.
      if (count >= 4 || (count >= 3 && (x === 0 || y === 0 || x === width - 1 || y === height - 1))) mask[p] = 1;
    }
  }
  return { mask, strength, valid };
}

/**
 * Summarise a mask, optionally within a pixel rectangle.
 * @returns {{coverage:number, accuracy:number}} coverage = share of pixels that are the color (0..1),
 *   accuracy = how good an example of the color those pixels are on average (0..1)
 */
export function summarize({ mask, strength, valid }, width, height, region) {
  const x0 = Math.max(0, Math.floor(region?.x ?? 0));
  const y0 = Math.max(0, Math.floor(region?.y ?? 0));
  const x1 = Math.min(width, Math.ceil(region ? region.x + region.w : width));
  const y1 = Math.min(height, Math.ceil(region ? region.y + region.h : height));
  let total = 0;
  let matched = 0;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (!valid[p]) continue;
      total++;
      if (mask[p]) {
        matched++;
        sum += strength[p];
      }
    }
  }
  return { coverage: total ? matched / total : 0, accuracy: matched ? sum / matched : 0 };
}

export function analyzePixels(data, width, height, match, region) {
  return summarize(colorMask(data, width, height, match), width, height, region);
}
