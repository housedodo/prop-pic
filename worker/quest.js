// AI game master for Daily Quest (public/quest/), powered by Claude.
//
//   POST /api/quest/start    { character }                                  → { scene, journal }
//   POST /api/quest/check    { character, scene, journal, action }          → { stat, dc, attempt }
//   POST /api/quest/resolve  { character, scene, journal, recent, action,
//                              check, result, lastOfDay }                   → { narration, hp_change, …, scene, journal }
//
// Needs the ANTHROPIC_API_KEY secret. Without it (or when the daily budget is
// spent) the endpoints answer 503 { offline: true } and the page falls back to
// its built-in game master.

import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';

const MODEL = 'claude-opus-5-5';
const DAILY_CALL_LIMIT = 300; // across all players, keeps the API bill bounded
const DAILY_CALLS_PER_IP = 60; // a normal day of play is ~7 calls

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const SYSTEM = `You are the game master of "Daily Quest", a light-hearted fantasy text adventure in the spirit of Dungeons & Dragons, played on a phone a few minutes a day. The player gets 3 actions per day and types short, casual commands.

Style:
- Warm, witty and vivid, like a good tabletop GM. Second person ("you").
- Keep it short: narration 2-4 sentences, scenes 2-3 sentences. It is read on a phone.
- Always leave the player something interesting to do next. Never decide the player's actions for them.
- Take the player's intent seriously and build on it, even when it is silly. Honour what they typed.
- Keep continuity with the journal, the character's items and earlier events.
- Family-friendly peril: danger and defeat are fine, gore is not.
- Write in the same language the player writes in.

Rules:
- Abilities: STR (force, fighting, climbing), DEX (stealth, agility, sleight of hand, aim), INT (knowledge, magic, searching, noticing), CHA (talking, persuading, deceiving, performing).
- Difficulty (DC): 8 easy, 12 moderate, 15 hard, 18 very hard. Class equipment and clever ideas make things easier.
- Every roll has one of three outcomes: success, success at a cost (it works but something goes wrong), or failure (it does not work and things get worse, but the story continues).`;

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    stat: { type: 'string', enum: ['STR', 'DEX', 'INT', 'CHA'] },
    dc: { type: 'integer' },
    attempt: { type: 'string', description: 'What the player attempts, 3-8 words, second person, e.g. "sneak past the sleeping guard"' },
  },
  required: ['stat', 'dc', 'attempt'],
  additionalProperties: false,
};

const RESOLVE_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string', description: 'What happens as a result of the roll, 2-4 sentences.' },
    hp_change: { type: 'integer', description: 'Between -6 and +4. Negative on failure or cost.' },
    gold_change: { type: 'integer' },
    xp_gain: { type: 'integer', description: '5 failure, 10 success at a cost, 20 success, 30 critical success.' },
    items_gained: { type: 'array', items: { type: 'string' } },
    items_lost: { type: 'array', items: { type: 'string' } },
    scene: { type: 'string', description: 'The situation the player is in now, 2-3 sentences, ending with something to act on.' },
    journal: { type: 'string', description: 'Updated running summary of the whole adventure so far, at most 700 characters. Keep names, goals, allies, enemies and open threads.' },
  },
  required: ['narration', 'hp_change', 'gold_change', 'xp_gain', 'items_gained', 'items_lost', 'scene', 'journal'],
  additionalProperties: false,
};

const START_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', description: 'The opening scene, 3-4 sentences, with a hook and something to act on.' },
    journal: { type: 'string', description: 'One-sentence summary of the premise.' },
  },
  required: ['scene', 'journal'],
  additionalProperties: false,
};

// ---------- input cleaning ----------

const str = (v, max) => String(v ?? '').slice(0, max);

function cleanCharacter(c) {
  return {
    name: str(c?.name, 24),
    cls: str(c?.cls, 12),
    level: Number(c?.level) || 1,
    hp: Number(c?.hp) || 0,
    maxHp: Number(c?.maxHp) || 0,
    gold: Number(c?.gold) || 0,
    items: Array.isArray(c?.items) ? c.items.slice(0, 12).map((i) => str(i, 40)) : [],
  };
}

function context(body) {
  return {
    character: cleanCharacter(body.character),
    journal: str(body.journal, 900),
    current_scene: str(body.scene, 700),
    recent_turns: Array.isArray(body.recent) ? body.recent.slice(-6).map((r) => str(r, 400)) : [],
  };
}

// ---------- Claude ----------

async function ask(env, instructions, data, schema) {
  // ANTHROPIC_BASE_URL is only for local testing against a stand-in server.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `${instructions}\n\n<game_state>\n${JSON.stringify(data, null, 1)}\n</game_state>` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The game master declined that turn.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`No answer (stop reason: ${response.stop_reason})`);
  return JSON.parse(text);
}

async function withinBudget(env, ip) {
  const stub = env.QUEST_BUDGET.get(env.QUEST_BUDGET.idFromName('global'));
  return stub.spend(new Date().toISOString().slice(0, 10), ip);
}

export async function handleQuest(request, env, path) {
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'The AI game master is not set up.', offline: true }, 503);

  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 20_000));
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await withinBudget(env, ip))) {
    return json({ error: 'The AI game master is resting for today.', offline: true }, 503);
  }

  try {
    if (path === '/start') {
      const character = cleanCharacter(body.character);
      const out = await ask(
        env,
        'Start a brand-new adventure for this character. Invent an original, playful premise suited to their class, and describe the opening scene.',
        { character },
        START_SCHEMA,
      );
      return json({ scene: str(out.scene, 1200), journal: str(out.journal, 900) });
    }

    if (path === '/check') {
      const out = await ask(
        env,
        `The player wants to do this: "${str(body.action, 160)}"\nDecide which ability check it needs and how hard it is. Every action gets a roll; use DC 8 for trivial things.`,
        context(body),
        CHECK_SCHEMA,
      );
      const stat = ['STR', 'DEX', 'INT', 'CHA'].includes(out.stat) ? out.stat : 'INT';
      const dc = Math.max(5, Math.min(22, Math.round(Number(out.dc) || 12)));
      return json({ stat, dc, attempt: str(out.attempt, 80) });
    }

    if (path === '/resolve') {
      const r = body.result ?? {};
      const tierText = { success: 'SUCCESS', partial: 'SUCCESS AT A COST', failure: 'FAILURE' }[r.tier] ?? 'FAILURE';
      const crit = r.roll === 20 ? ' It is a natural 20: make it spectacular.' : r.roll === 1 ? ' It is a natural 1: a memorable (but not fatal) mishap.' : '';
      const end = body.lastOfDay
        ? '\nThis was the last action of the day: after the outcome, bring the day to a close (camp, an inn, nightfall) and end the scene on a cliffhanger for tomorrow.'
        : '';
      const dying = 'If hp would reach 0, the character is knocked out, not killed; describe them passing out.';
      const out = await ask(
        env,
        `The player attempted: "${str(body.action, 160)}" (${str(body.check?.stat, 3)} check, DC ${Number(body.check?.dc) || 12}).\nThey rolled ${Number(r.roll) || 0} ${Number(r.mod) >= 0 ? '+' : '-'} ${Math.abs(Number(r.mod) || 0)} = ${Number(r.total) || 0}. Outcome: ${tierText}.${crit}\nNarrate what happens, apply fitting consequences, and describe the new situation. ${dying}${end}`,
        context(body),
        RESOLVE_SCHEMA,
      );
      return json({
        narration: str(out.narration, 1200),
        hp_change: out.hp_change,
        gold_change: out.gold_change,
        xp_gain: out.xp_gain,
        items_gained: (out.items_gained ?? []).slice(0, 3),
        items_lost: (out.items_lost ?? []).slice(0, 3),
        scene: str(out.scene, 1200),
        journal: str(out.journal, 900),
      });
    }
  } catch (err) {
    console.error('quest', path, err);
    if (err instanceof Anthropic.AuthenticationError) {
      return json({ error: 'The API key is invalid.', offline: true }, 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'The game master is busy. Try again in a minute.' }, 429);
    }
    return json({ error: 'The game master got confused. Try again.' }, 502);
  }

  return json({ error: 'Not found' }, 404);
}

// Counts AI calls per day, overall and per IP address.
export class QuestBudget extends DurableObject {
  async spend(day, ip) {
    let s = (await this.ctx.storage.get('usage')) ?? { day, total: 0, ips: {} };
    if (s.day !== day) s = { day, total: 0, ips: {} };
    if (s.total >= DAILY_CALL_LIMIT || (s.ips[ip] ?? 0) >= DAILY_CALLS_PER_IP) return false;
    s.total++;
    s.ips[ip] = (s.ips[ip] ?? 0) + 1;
    await this.ctx.storage.put('usage', s);
    return true;
  }
}
