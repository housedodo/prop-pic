// Color palette, bonus items, and deterministic (seeded) daily picks.
// Both players compute the same colors from the same challenge code + date,
// so no server is needed to agree on what to photograph.

export const PALETTE = [
  { name: 'Red', hex: '#d62828' },
  { name: 'Orange', hex: '#f77f00' },
  { name: 'Yellow', hex: '#ffd000' },
  { name: 'Green', hex: '#2a9d38' },
  { name: 'Teal', hex: '#14a3a3' },
  { name: 'Blue', hex: '#1e78c8' },
  { name: 'Purple', hex: '#7b2cbf' },
  { name: 'Pink', hex: '#ff5fa2' },
  { name: 'Brown', hex: '#8b5a2b' },
  { name: 'White', hex: '#f5f5f5' },
  { name: 'Black', hex: '#141414' },
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
