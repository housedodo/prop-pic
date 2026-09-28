// Color palette, bonus items, and deterministic (seeded) daily picks.
// Both players compute the same colors from the same challenge code + date,
// so no server is needed to agree on what to photograph.

// `hex` is the swatch shown in the UI. `match` is what counts as that color in a
// photo, in OKLCh: L = lightness 0..1, C = chroma (vividness) 0..~0.37,
// hue = [from, to, ideal] degrees going clockwise (may wrap past 360).
// Ranges were calibrated on named reference colors (e.g. navy, jeans and sky
// blue all count as Blue; tan and beige count as nothing).
export const PALETTE = [
  { name: 'Red', hex: '#d62828', match: { hue: [355, 42, 27], minC: 0.1, minL: 0.28, maxL: 0.8 } },
  { name: 'Orange', hex: '#f77f00', match: { hue: [42, 78, 58], minC: 0.11, minL: 0.6, maxL: 0.95 } },
  { name: 'Yellow', hex: '#ffd000', match: { hue: [78, 118, 100], minC: 0.09, minL: 0.66, maxL: 1 } },
  { name: 'Green', hex: '#2a9d38', match: { hue: [106, 178, 142], minC: 0.05, minL: 0.22, maxL: 0.95 } },
  { name: 'Teal', hex: '#14a3a3', match: { hue: [178, 222, 192], minC: 0.05, minL: 0.3, maxL: 0.92 } },
  { name: 'Blue', hex: '#1e78c8', match: { hue: [222, 292, 262], minC: 0.05, minL: 0.18, maxL: 0.92 } },
  { name: 'Purple', hex: '#7b2cbf', match: { hue: [292, 338, 318], minC: 0.06, minL: 0.2, maxL: 0.82 } },
  { name: 'Pink', hex: '#ff5fa2', match: { hue: [335, 25, 355], minC: 0.04, minL: 0.6, maxL: 0.97 } },
  { name: 'Brown', hex: '#8b5a2b', match: { hue: [25, 95, 55], minC: 0.025, maxC: 0.15, minL: 0.18, maxL: 0.62 } },
  { name: 'White', hex: '#f5f5f5', match: { neutral: 'light', maxC: 0.04, minL: 0.84, maxL: 1 } },
  { name: 'Black', hex: '#141414', match: { neutral: 'dark', maxC: 0.07, minL: 0, maxL: 0.3 } },
];

// Object classes the in-browser detector (COCO-SSD) can recognise.
// A bonus is earned when one of these appears in the photo *in the target color*.
export const BONUS_ITEMS = [
  'car', 'bicycle', 'cup', 'bottle', 'chair', 'umbrella', 'backpack', 'book',
  'handbag', 'bench', 'potted plant', 'teddy bear', 'vase', 'couch', 'apple',
  'banana', 'orange', 'traffic light', 'tie', 'clock', 'sports ball',
  'bowl', 'suitcase', 'bus', 'truck', 'motorcycle', 'fire hydrant', 'kite',
];

function hashString(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRandom(seed) {
  // mulberry32
  let a = hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDistinct(list, count, rand) {
  const pool = [...list];
  const out = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns `count` slots, each with a distinct color and its bonus items.
export function pickSlots(seed, count, bonusPerSlot = 2) {
  const rand = seededRandom(seed);
  const colors = pickDistinct(PALETTE, count, rand);
  return colors.map((color) => ({
    color,
    bonusItems: pickDistinct(BONUS_ITEMS, bonusPerSlot, rand),
  }));
}

export function dailySlots(date) {
  return pickSlots(`daily:${date}`, 1);
}

export function challengeSlots(code, date) {
  return pickSlots(`challenge:${code}:${date}`, 4);
}

export function newChallengeCode(rand = Math.random) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(rand() * chars.length)];
  return code;
}
