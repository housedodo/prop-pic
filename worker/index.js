// Cloudflare Worker: serves the static app (public/) and a small API for live challenges.
// Each challenge code maps to one Durable Object that stores the players, their
// scores and their photos.
//
//   GET  /api/health
//   GET  /api/challenges/:code                      → { code, date, players: [...] }
//   POST /api/challenges/:code/join                 { name, date }            (auth)
//   PUT  /api/challenges/:code/slots/:i             { result, photo }         (auth)
//   GET  /api/challenges/:code/photos/:player/:i    → image/jpeg
//
// "auth" = `Authorization: Bearer <secret>`, a random per-device secret. The
// public player id is a hash of it, so others can see your id but can't post as you.

import { DurableObject } from 'cloudflare:workers';
import { handleQuest } from './quest.js';

export { QuestBudget } from './quest.js';

const MAX_PLAYERS = 8;
const SLOTS = 4;
const MAX_PHOTO_BYTES = 400_000;
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname.startsWith('/api/quest/')) return handleQuest(request, env, url.pathname.slice('/api/quest'.length));

    const m = url.pathname.match(/^\/api\/challenges\/([^/]+)(\/.*)?$/);
    if (!m) return json({ error: 'Not found' }, 404);
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'Invalid challenge code' }, 400);

    const stub = env.CHALLENGES.get(env.CHALLENGES.idFromName(code));
    return stub.handle(code, request.method, m[2] ?? '/', request.headers.get('authorization'), await readBody(request));
  },
};

async function readBody(request) {
  if (request.method !== 'POST' && request.method !== 'PUT') return null;
  const text = await request.text();
  if (text.length > MAX_PHOTO_BYTES * 1.5) return { tooLarge: true };
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function playerIdFromAuth(auth) {
  const secret = auth?.match(/^Bearer ([\w-]{16,64})$/)?.[1];
  if (!secret) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cleanName = (name) => String(name ?? '').trim().slice(0, 24) || 'Player';

function cleanResult(r) {
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  const s = r?.score ?? {};
  return {
    score: {
      coverage: num(s.coverage, 1000),
      accuracy: num(s.accuracy, 1000),
      bonus: num(s.bonus, 1000),
      total: num(s.total, 5000),
    },
    coverage: num(r?.coverage, 1),
    bonusFound: Array.isArray(r?.bonusFound) ? r.bonusFound.slice(0, 5).map((b) => String(b).slice(0, 30)) : [],
    takenAt: num(r?.takenAt, 1e14),
  };
}

export class ChallengeRoom extends DurableObject {
  async handle(code, method, path, auth, body) {
    const storage = this.ctx.storage;
    const meta = await storage.get('meta');

    if (method === 'GET' && path === '/') {
      if (!meta) return json({ error: 'Challenge not found' }, 404);
      const players = [...(await storage.list({ prefix: 'player:' })).values()];
      players.sort((a, b) => a.joinedAt - b.joinedAt);
      return json({ ...meta, players });
    }

    const photo = path.match(/^\/photos\/([0-9a-f]{16})\/([0-3])$/);
    if (method === 'GET' && photo) {
      const b64 = await storage.get(`photo:${photo[1]}:${photo[2]}`);
      if (!b64) return json({ error: 'No photo' }, 404);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
      });
    }

    const id = await playerIdFromAuth(auth);
    if (!id) return json({ error: 'Missing player secret' }, 401);
    if (body?.tooLarge) return json({ error: 'Photo too large' }, 413);

    if (method === 'POST' && path === '/join') {
      let m = meta;
      if (!m) {
        if (!DATE_RE.test(body?.date ?? '')) return json({ error: 'Invalid date' }, 400);
        m = { code, date: body.date, createdAt: Date.now() };
        await storage.put('meta', m);
      }
      const key = `player:${id}`;
      const existing = await storage.get(key);
      if (!existing) {
        const count = (await storage.list({ prefix: 'player:' })).size;
        if (count >= MAX_PLAYERS) return json({ error: 'This challenge is full' }, 409);
      }
      const player = existing ?? { id, joinedAt: Date.now(), slots: Array(SLOTS).fill(null) };
      player.name = cleanName(body?.name);
      await storage.put(key, player);
      return json({ ...m, you: id });
    }

    const slot = path.match(/^\/slots\/([0-3])$/);
    if (method === 'PUT' && slot) {
      if (!meta) return json({ error: 'Challenge not found' }, 404);
      const player = await storage.get(`player:${id}`);
      if (!player) return json({ error: 'Join the challenge first' }, 403);
      const i = Number(slot[1]);
      const b64 = String(body?.photo ?? '').replace(/^data:image\/jpeg;base64,/, '');
      if (!b64 || b64.length > MAX_PHOTO_BYTES * 1.37 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
        return json({ error: 'Invalid photo' }, 400);
      }
      player.slots[i] = cleanResult(body.result);
      await storage.put({ [`player:${id}`]: player, [`photo:${id}:${i}`]: b64 });
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  }
}
