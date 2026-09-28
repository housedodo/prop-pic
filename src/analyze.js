// Pixel analysis: how much of an image (or a region of it) matches a target color.
// Pure functions over RGBA arrays so they can be unit-tested in Node.

// Matching tolerances. Real photos vary a lot in lighting, so matching is done
// mostly on hue (CIELAB hue angle) and only loosely on lightness.
export const MATCH = {
  hueTolerance: 24, // degrees of hue angle either side of the target
  lightnessTolerance: 32, // CIELAB L* units
  grayChroma: 14, // below this chroma a pixel/target counts as neutral (white/gray/black)
  minChromaRatio: 0.45, // pixel must be at least this saturated relative to the target...
  maxChromaRatio: 1.9, // ...and at most this (keeps vivid orange from counting as brown)
};

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // D65
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * How well a pixel matches the target, from 0 (no match) to 1 (exact).
 * Both arguments are [L, a, b].
 */
export function matchStrength(pixel, target, m = MATCH) {
  const dL = Math.abs(pixel[0] - target[0]);
  const pc = Math.hypot(pixel[1], pixel[2]);
  const tc = Math.hypot(target[1], target[2]);

  if (tc < m.grayChroma) {
    // Neutral target (white/black): pixel must be neutral with similar lightness.
    const lTol = m.lightnessTolerance * 0.75;
    if (pc > m.grayChroma * 1.5 || dL > lTol) return 0;
    return 1 - 0.7 * (dL / lTol) - 0.3 * (pc / (m.grayChroma * 1.5));
  }

  if (pc < Math.max(m.grayChroma, tc * m.minChromaRatio) || pc > tc * m.maxChromaRatio) return 0;
  if (dL > m.lightnessTolerance) return 0;
  let dh = Math.abs(Math.atan2(pixel[2], pixel[1]) - Math.atan2(target[2], target[1])) * (180 / Math.PI);
  if (dh > 180) dh = 360 - dh;
  if (dh > m.hueTolerance) return 0;
  const chromaGap = Math.min(1, Math.abs(pc - tc) / tc);
  return 1 - 0.5 * (dh / m.hueTolerance) - 0.3 * (dL / m.lightnessTolerance) - 0.2 * chromaGap;
}

/**
 * @param {Uint8ClampedArray} data RGBA pixels
 * @param {number} width
 * @param {number} height
 * @param {string} targetHex
 * @param {{x:number,y:number,w:number,h:number}} [region] pixel rectangle to restrict to
 * @returns {{coverage:number, accuracy:number}} coverage = share of pixels matching (0..1),
 *   accuracy = how close matching pixels are on average (0..1)
 */
export function analyzePixels(data, width, height, targetHex, region) {
  const target = rgbToLab(...hexToRgb(targetHex));
  const x0 = Math.max(0, Math.floor(region?.x ?? 0));
  const y0 = Math.max(0, Math.floor(region?.y ?? 0));
  const x1 = Math.min(width, Math.ceil(region ? region.x + region.w : width));
  const y1 = Math.min(height, Math.ceil(region ? region.y + region.h : height));

  let total = 0;
  let matched = 0;
  let closeness = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      total++;
      const strength = matchStrength(rgbToLab(data[i], data[i + 1], data[i + 2]), target);
      if (strength > 0) {
        matched++;
        closeness += strength;
      }
    }
  }
  return {
    coverage: total ? matched / total : 0,
    accuracy: matched ? closeness / matched : 0,
  };
}
