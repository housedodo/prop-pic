import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, applyEffects, newCharacter, outcomeFor, modifier } from '../public/quest/rules.js';
import * as offline from '../public/quest/gm-offline.js';

test('every roll lands on one of three outcomes', () => {
  assert.equal(outcomeFor(15, 0, 12).tier, 'success');
  assert.equal(outcomeFor(9, 0, 12).tier, 'partial'); // within 4 below the DC
  assert.equal(outcomeFor(8, 0, 12).tier, 'partial');
  assert.equal(outcomeFor(7, 0, 12).tier, 'failure');
  assert.equal(outcomeFor(10, 2, 12).tier, 'success'); // modifier counts
});

test('natural 20 always succeeds, natural 1 always fails', () => {
  assert.deepEqual([outcomeFor(20, -1, 30).tier, outcomeFor(20, -1, 30).critical], ['success', true]);
  assert.equal(outcomeFor(1, 10, 5).tier, 'failure');
});

test('classes favour their main ability', () => {
  assert.equal(modifier(newCharacter('A', 'fighter'), 'STR'), 3);
  assert.equal(modifier(newCharacter('A', 'rogue'), 'DEX'), 3);
  assert.equal(modifier(newCharacter('A', 'wizard'), 'INT'), 3);
  assert.equal(modifier(newCharacter('A', 'bard'), 'CHA'), 3);
});

test('effects are applied within limits', () => {
  const c = newCharacter('Brannoc', 'fighter');
  const after = applyEffects(c, { hp_change: -999, gold_change: 3, xp_gain: 20, items_gained: ['Rope'], items_lost: ['rations'] });
  assert.equal(after.hp, CLASSES.fighter.hp - 8); // damage capped at 8 per turn
  assert.equal(after.gold, 8);
  assert.ok(after.items.includes('Rope'));
  assert.ok(!after.items.includes('Rations'));
  assert.equal(c.items.length, 3, 'original is not mutated');
  assert.equal(applyEffects({ ...c, hp: 2 }, { hp_change: -5 }).hp, 0); // never below 0
});

test('levelling up raises max HP', () => {
  const c = applyEffects({ ...newCharacter('A', 'rogue'), xp: 90 }, { xp_gain: 20 });
  assert.equal(c.level, 2);
  assert.equal(c.maxHp, CLASSES.rogue.hp + 3);
});

test('offline game master picks a sensible ability', () => {
  assert.equal(offline.check({ action: 'I sneak past the guard' }).stat, 'DEX');
  assert.equal(offline.check({ action: 'smash the door' }).stat, 'STR');
  assert.equal(offline.check({ action: 'persuade the goblin to talk' }).stat, 'CHA');
  assert.equal(offline.check({ action: 'read the old map' }).stat, 'INT');
  assert.ok(offline.check({ action: 'fight the dragon' }).dc > offline.check({ action: 'fight the rat' }).dc);
});

test('offline game master narrates using the player\'s words', () => {
  const chk = offline.check({ action: 'I climb the tower' });
  const out = offline.resolve({ action: 'I climb the tower', check: chk, result: outcomeFor(15, 3, chk.dc), day: '2026-09-30', turn: 0 });
  assert.match(out.narration, /climb the tower/);
  assert.ok(out.xp_gain >= 20);
  assert.ok(out.scene.length > 20);
});
