import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, challengeSlots, dailySlots } from '../public/src/colors.js';
import { analyzePixels, hexToRgb, matchStrength, rgbToOklch } from '../public/src/analyze.js';
import { scorePhoto, SCORING } from '../public/src/scoring.js';

const color = (name) => PALETTE.find((p) => p.name === name).match;

function solidImage(w, h, hex) {
  const [r, g, b] = hexToRgb(hex);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return data;
}

// Which palette colors a single real-world shade counts as.
const matches = (hex) => PALETTE.filter((p) => matchStrength(rgbToOklch(...hexToRgb(hex)), p.match) > 0).map((p) => p.name);

test('both players get the same 4 distinct colors for a code and day', () => {
  const a = challengeSlots('ABC123', '2026-09-28');
  assert.deepEqual(a, challengeSlots('ABC123', '2026-09-28'));
  assert.equal(a.length, 4);
  assert.equal(new Set(a.map((s) => s.color.name)).size, 4);
  assert.notDeepEqual(a, challengeSlots('ABC123', '2026-09-29'));
});

test('daily color is deterministic per date', () => {
  assert.deepEqual(dailySlots('2026-09-28'), dailySlots('2026-09-28'));
});

test('every swatch counts as its own color', () => {
  for (const p of PALETTE) assert.ok(matches(p.hex).includes(p.name), `${p.name} swatch`);
});

test('real-world shades are named like people name them', () => {
  const cases = {
    '#800000': 'Red', // maroon
    '#dc143c': 'Red', // crimson
    '#ed9121': 'Orange', // carrot
    '#e1ad01': 'Yellow', // mustard
    '#4f7942': 'Green', // leaf
    '#40e0d0': 'Teal', // turquoise
    '#000080': 'Blue', // navy
    '#3b5b92': 'Blue', // denim
    '#2e5f9e': 'Blue', // shaded bus paint
    '#87ceeb': 'Blue', // sky blue
    '#b57edc': 'Purple', // lavender
    '#ffc0cb': 'Pink',
    '#8b4513': 'Brown', // saddle brown
    '#966f33': 'Brown', // wood
    '#e8e6e0': 'White', // paper
    '#2a2a2a': 'Black', // shadowed black
  };
  for (const [hex, name] of Object.entries(cases)) assert.ok(matches(hex).includes(name), `${hex} should be ${name}, got ${matches(hex)}`);
});

test('look-alikes are kept apart', () => {
  assert.deepEqual(matches('#ff8000'), ['Orange']); // vivid orange is not brown
  assert.deepEqual(matches('#8b4513'), ['Brown']); // brown is not orange
  assert.deepEqual(matches('#d2b48c'), []); // tan is nothing
  assert.deepEqual(matches('#808080'), []); // mid grey is nothing
  assert.ok(!matches('#2e5f9e').includes('Purple'));
});

test('solid target color gives full coverage', () => {
  const r = analyzePixels(solidImage(10, 10, '#d62828'), 10, 10, color('Red'));
  assert.equal(r.coverage, 1);
  assert.ok(r.accuracy > 0.8);
});

test('isolated speckles are ignored', () => {
  const w = 12, h = 12;
  const data = solidImage(w, h, '#808080');
  const [r, g, b] = hexToRgb('#1e78c8');
  for (const [x, y] of [[2, 2], [8, 3], [5, 9]]) data.set([r, g, b, 255], (y * w + x) * 4);
  assert.equal(analyzePixels(data, w, h, color('Blue')).coverage, 0);
});

test('region restricts analysis', () => {
  const w = 10, h = 10;
  const data = solidImage(w, h, '#1e78c8');
  const [r, g, b] = hexToRgb('#ffd000');
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) data.set([r, g, b, 255], (y * w + x) * 4);
  assert.equal(analyzePixels(data, w, h, color('Yellow')).coverage, 0.25);
  assert.equal(analyzePixels(data, w, h, color('Yellow'), { x: 0, y: 0, w: 5, h: 5 }).coverage, 1);
});

test('scoring', () => {
  assert.equal(scorePhoto({ coverage: 0.01, accuracy: 1 }).total, 0);
  const full = scorePhoto({ coverage: 0.8, accuracy: 1, bonusFound: ['cup'] });
  assert.equal(full.total, SCORING.coveragePoints + SCORING.accuracyPoints + SCORING.bonusItemPoints);
});
