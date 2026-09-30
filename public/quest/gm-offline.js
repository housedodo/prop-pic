// A simple built-in game master, used when the AI game master isn't available
// (no API key configured, daily budget used up, or no connection). It picks the
// ability from keywords in the player's action and tells the story from templates.
// Same interface as the AI one: start(), check(), resolve().

import { seededRandom } from '../src/colors.js';

const KEYWORDS = {
  STR: ['attack', 'fight', 'hit', 'punch', 'kick', 'smash', 'break', 'bash', 'push', 'pull', 'lift', 'carry', 'force', 'charge', 'swing', 'slash', 'stab', 'grab', 'wrestle', 'climb', 'kill', 'angreifen', 'schlagen', 'kämpfen'],
  DEX: ['sneak', 'hide', 'steal', 'pick', 'dodge', 'jump', 'run', 'flee', 'escape', 'balance', 'throw', 'shoot', 'aim', 'catch', 'quiet', 'tiptoe', 'swim', 'slip', 'schleichen', 'verstecken', 'klauen', 'rennen'],
  INT: ['search', 'look', 'examine', 'inspect', 'read', 'study', 'think', 'remember', 'cast', 'spell', 'magic', 'decipher', 'investigate', 'solve', 'map', 'track', 'listen', 'suchen', 'lesen', 'zaubern', 'untersuchen'],
  CHA: ['talk', 'ask', 'persuade', 'convince', 'lie', 'bluff', 'charm', 'flirt', 'sing', 'play', 'perform', 'bribe', 'threaten', 'intimidate', 'trade', 'buy', 'sell', 'greet', 'reden', 'fragen', 'überzeugen', 'singen', 'lügen'],
};

const HARDER = ['dragon', 'giant', 'king', 'army', 'impossible', 'everyone', 'all of', 'fly', 'drache'];
const EASIER = ['carefully', 'slowly', 'quietly', 'politely', 'gently', 'vorsichtig'];

const SCENES = [
  'You stand at the edge of Mossbridge market. A goblin in a waistcoat is selling "genuine dragon eggs" that look suspiciously like painted potatoes. A city guard is watching him closely.',
  'A narrow forest path splits in two. On the left, fresh wagon tracks and a dropped silver coin. On the right, a signpost that reads "DEFINITELY NOT A TRAP".',
  'You reach a crumbling watchtower. Candlelight flickers at the top, and someone up there is humming off-key. The door is chained shut.',
  'A rope bridge sways over a misty gorge. Halfway across, a very large goat is blocking the way and chewing on one of the ropes.',
  'In the Leaky Flagon tavern, a hooded stranger slides a map across the table toward you. The barkeep is pretending very hard not to listen.',
  'Deep in an old mine, glowing mushrooms light a cavern. Something shiny glints in a pool of black water, and something else is breathing in the dark.',
  'A travelling circus has set up in a meadow. The ringmaster is shouting that his star act, a juggling bear, has vanished along with the day\'s takings.',
  'Rain drums on the roof of an abandoned chapel. Behind the altar, a trapdoor is outlined in faint blue light.',
  'A merchant\'s cart lies overturned on the road, one wheel still spinning. Crates of apples are scattered everywhere, and the merchant is stuck underneath.',
  'At the top of a hill stands a stone circle. As you approach, the stones begin to hum, and the air smells like thunder.',
];

const OPENING =
  'Your adventure begins in the sleepy village of Mossbridge, where nothing exciting has happened in forty years. That changes this morning: the village bell has been stolen, and the only clue is a trail of muddy footprints leading out toward the forest.';

const VERBS = {
  success: [
    'You {a}, and it works better than you hoped.',
    'You {a}. For once, luck is entirely on your side.',
    'You {a} with such confidence that even you are a little impressed.',
  ],
  partial: [
    'You {a}. It works, but not cleanly.',
    'You manage to {a}, though it costs you.',
    'You {a}. Mostly a success, if you ignore the bruises.',
  ],
  failure: [
    'You try to {a}, and it goes badly wrong.',
    'You attempt to {a}. The universe politely declines.',
    'You {a}, or at least you try. It does not work.',
  ],
};

const AFTERMATH = {
  success: { STR: 'Nothing stands in your way.', DEX: 'Nobody even notices you were there.', INT: 'Suddenly everything makes sense.', CHA: 'You make a new friend, or at least a useful acquaintance.' },
  partial: { STR: 'You pull a muscle in the process.', DEX: 'You scrape your knee on the way.', INT: 'You get a splitting headache from the effort.', CHA: 'They agree, but clearly won\'t forget this.' },
  failure: { STR: 'You end up flat on your back.', DEX: 'You trip spectacularly.', INT: 'You are now more confused than before.', CHA: 'Everyone stares at you in awkward silence.' },
};

const FOUND = ['Rusty key', 'Lucky coin', 'Healing potion', 'Mysterious feather', 'Half-eaten sandwich', 'Small brass bell'];

function toSecondPerson(action) {
  let a = String(action).trim().replace(/[.!?]+$/, '');
  a = a.replace(/^(i|I)\s+(will|try to|want to|'ll)\s+/i, '').replace(/^(i|I)\s+/i, '');
  a = a.replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you').replace(/\bmyself\b/gi, 'yourself');
  return a.charAt(0).toLowerCase() + a.slice(1);
}

export function guessStat(action) {
  const text = String(action).toLowerCase();
  let best = 'INT';
  let bestHits = 0;
  for (const [stat, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits > bestHits) {
      best = stat;
      bestHits = hits;
    }
  }
  return best;
}

export function start() {
  return { scene: OPENING, journal: 'The Mossbridge village bell was stolen; muddy footprints lead to the forest.' };
}

export function check({ action }) {
  const text = String(action).toLowerCase();
  let dc = 12;
  if (HARDER.some((w) => text.includes(w))) dc += 4;
  if (EASIER.some((w) => text.includes(w))) dc -= 3;
  const stat = guessStat(action);
  return { stat, dc, attempt: toSecondPerson(action) };
}

export function resolve({ action, check: chk, result, day, turn, lastOfDay }) {
  const rand = seededRandom(`${day}:${turn}:${action}`);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const a = toSecondPerson(action);
  const fx = { hp_change: 0, gold_change: 0, xp_gain: 5, items_gained: [], items_lost: [] };
  if (result.tier === 'success') {
    fx.xp_gain = result.critical ? 30 : 20;
    fx.gold_change = Math.floor(rand() * 6);
    if (result.critical || rand() < 0.25) fx.items_gained.push(pick(FOUND));
  } else if (result.tier === 'partial') {
    fx.xp_gain = 10;
    fx.hp_change = -1 - Math.floor(rand() * 2);
  } else {
    fx.hp_change = result.critical ? -4 : -2 - Math.floor(rand() * 2);
  }
  const narration = `${pick(VERBS[result.tier]).replace('{a}', a)} ${AFTERMATH[result.tier][chk.stat] ?? ''}`.trim();
  const next = SCENES[Math.floor(seededRandom(`scene:${day}:${turn}`)() * SCENES.length)];
  const scene = lastOfDay
    ? `Night falls, and you make camp. When morning comes, ${next.charAt(0).toLowerCase()}${next.slice(1)}`
    : next;
  return { narration, ...fx, scene, journal_note: `${a} (${result.tier}).` };
}
