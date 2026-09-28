import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeSlots, dailySlots } from '../src/colors.js';
import { analyzePixels, hexToRgb } from '../src/analyze.js';
import { scorePhoto, SCORING } from '../src/scoring.js';

function solidImage(w, h, hex) {
  const [r, g, b] = hexToRgb(hex);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return data;
}

test('both players get the same 4 distinct colors for a code and day', () => {
  const a = challengeSlots('ABC123', '2026-09-28');
  const b = challengeSlots('ABC123', '2026-09-28');
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.equal(new Set(a.map((s) => s.color.name)).size, 4);
  assert.notDeepEqual(a, challengeSlots('ABC123', '2026-09-29'));
});

test('daily color is deterministic per date', () => {
  assert.deepEqual(dailySlots('2026-09-28'), dailySlots('2026-09-28'));
});

test('solid target color gives full coverage and accuracy', () => {
  const r = analyzePixels(solidImage(10, 10, '#d62828'), 10, 10, '#d62828');
  assert.equal(r.coverage, 1);
  assert.ok(r.accuracy > 0.99);
});

test('darker shade still matches, different hue does not', () => {
  assert.ok(analyzePixels(solidImage(4, 4, '#a01e1e'), 4, 4, '#d62828').coverage === 1);
  assert.equal(analyzePixels(solidImage(4, 4, '#1e78c8'), 4, 4, '#d62828').coverage, 0);
});

test('region restricts analysis', () => {
  const w = 10, h = 10;
  const data = solidImage(w, h, '#1e78c8');
  const [r, g, b] = hexToRgb('#ffd000');
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) data.set([r, g, b, 255], (y * w + x) * 4);
  assert.equal(analyzePixels(data, w, h, '#ffd000').coverage, 0.25);
  assert.equal(analyzePixels(data, w, h, '#ffd000', { x: 0, y: 0, w: 5, h: 5 }).coverage, 1);
});

test('scoring', () => {
  assert.equal(scorePhoto({ coverage: 0.01, accuracy: 1 }).total, 0);
  const full = scorePhoto({ coverage: 0.8, accuracy: 1, bonusFound: ['cup'] });
  assert.equal(full.total, SCORING.coveragePoints + SCORING.accuracyPoints + SCORING.bonusItemPoints);
});

test('muted real-world shades match their color, not neighbours', () => {
  const cov = (pixel, target) => analyzePixels(solidImage(2, 2, pixel), 2, 2, target).coverage;
  assert.equal(cov('#2e5f9e', '#1e78c8'), 1); // shaded blue bus paint → Blue
  assert.equal(cov('#2e5f9e', '#7b2cbf'), 0); // ...but not Purple
  assert.equal(cov('#f77f00', '#8b5a2b'), 0); // vivid orange is not Brown
});
