// Local persistence (localStorage) and shareable challenge links.
// Links carry the challenge code plus the sender's scores, so friends can
// compare results without a server. Photos stay on each device.

import { todayKey } from './colors.js';

const KEY = 'propPic.v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { name: '', games: {} };
  } catch {
    return { name: '', games: {} };
  }
}

let state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Usually quota: drop photos from past days and retry once.
    for (const game of Object.values(state.games)) {
      if (game.date !== todayKey()) game.slots?.forEach((s) => s && delete s.photo);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      console.warn('Could not save', err);
    }
  }
}

export function getState() {
  return state;
}

export function setName(name) {
  state.name = name.trim().slice(0, 24);
  save();
}

export function getGame(id) {
  return state.games[id];
}

export function putGame(game) {
  state.games[game.id] = game;
  save();
}

export function listGames() {
  return Object.values(state.games).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}

function toBase64Url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export function shareLink(game, myName) {
  const payload = {
    c: game.code,
    d: game.date,
    n: myName,
    s: game.slots.map((s) => s?.score.total ?? null),
  };
  const base = location.href.split('#')[0];
  return `${base}#join=${toBase64Url(payload)}`;
}

export function parseShareLink(hash) {
  const m = hash.match(/join=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const p = fromBase64Url(m[1]);
    if (typeof p.c !== 'string' || typeof p.d !== 'string') return null;
    return {
      code: p.c.slice(0, 12),
      date: p.d.slice(0, 10),
      name: String(p.n ?? 'Friend').slice(0, 24),
      scores: Array.isArray(p.s) ? p.s.slice(0, 4).map((x) => (typeof x === 'number' ? x : null)) : [],
    };
  } catch {
    return null;
  }
}
