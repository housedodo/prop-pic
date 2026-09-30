// Game rules for Daily Quest: classes, dice, outcomes, and applying effects.
// Pure functions so they can be unit-tested in Node.

export const TURNS_PER_DAY = 3;

export const STATS = {
  STR: 'Strength',
  DEX: 'Dexterity',
  INT: 'Intelligence',
  CHA: 'Charisma',
};

export const CLASSES = {
  fighter: {
    name: 'Fighter',
    blurb: 'Strong and hard to kill. Solves problems head-on.',
    stats: { STR: 3, DEX: 1, INT: -1, CHA: 0 },
    hp: 14,
    items: ['Longsword', 'Dented shield', 'Rations'],
  },
  rogue: {
    name: 'Rogue',
    blurb: 'Quick hands, quiet feet, questionable morals.',
    stats: { STR: 0, DEX: 3, INT: 1, CHA: 0 },
    hp: 10,
    items: ['Twin daggers', 'Lockpicks', 'Dark cloak'],
  },
  wizard: {
    name: 'Wizard',
    blurb: 'Knows things. Some of them explode.',
    stats: { STR: -1, DEX: 0, INT: 3, CHA: 1 },
    hp: 8,
    items: ['Oak staff', 'Spellbook', 'Bag of chalk'],
  },
  bard: {
    name: 'Bard',
    blurb: 'Talks their way in, sings their way out.',
    stats: { STR: 0, DEX: 1, INT: 0, CHA: 3 },
    hp: 10,
    items: ['Lute', 'Rapier', 'Very fancy hat'],
  },
};

// The three outcomes every roll can land on.
export const OUTCOMES = {
  success: { label: 'Success', blurb: 'You pull it off.' },
  partial: { label: 'Success at a cost', blurb: 'It works, but something goes wrong.' },
  failure: { label: 'Failure', blurb: 'It does not go your way.' },
};

export const levelFor = (xp) => 1 + Math.floor(xp / 100);
export const maxHpFor = (cls, level) => CLASSES[cls].hp + (level - 1) * 3;

export function newCharacter(name, cls) {
  const c = CLASSES[cls];
  return {
    name: String(name).trim().slice(0, 24) || 'Nameless',
    cls,
    level: 1,
    xp: 0,
    hp: c.hp,
    maxHp: c.hp,
    gold: 5,
    items: [...c.items],
  };
}

export const modifier = (character, stat) => CLASSES[character.cls].stats[stat] ?? 0;

export const rollD20 = (rand = Math.random) => 1 + Math.floor(rand() * 20);

/**
 * Natural 20 always succeeds and natural 1 always fails. Otherwise:
 * total ≥ DC → success, within 4 below DC → success at a cost, else failure.
 */
export function outcomeFor(roll, mod, dc) {
  const total = roll + mod;
  let tier;
  if (roll === 20) tier = 'success';
  else if (roll === 1) tier = 'failure';
  else if (total >= dc) tier = 'success';
  else if (total >= dc - 4) tier = 'partial';
  else tier = 'failure';
  return { roll, mod, total, dc, tier, critical: roll === 20 || roll === 1 };
}

const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

/** Applies a game master's effects to a copy of the character. Limits keep a bad response from breaking the game. */
export function applyEffects(character, fx = {}) {
  const c = { ...character, items: [...character.items] };
  c.xp += clampInt(fx.xp_gain, 0, 50);
  const level = levelFor(c.xp);
  if (level > c.level) {
    c.maxHp = maxHpFor(c.cls, level);
    c.hp += (level - c.level) * 3;
    c.level = level;
  }
  c.hp = clampInt(c.hp + clampInt(fx.hp_change, -8, 6), 0, c.maxHp);
  c.gold = Math.max(0, c.gold + clampInt(fx.gold_change, -50, 50));
  for (const item of fx.items_lost ?? []) {
    const i = c.items.findIndex((x) => x.toLowerCase() === String(item).toLowerCase());
    if (i >= 0) c.items.splice(i, 1);
  }
  for (const item of fx.items_gained ?? []) {
    const name = String(item).trim().slice(0, 40);
    if (name && c.items.length < 12) c.items.push(name);
  }
  return c;
}
