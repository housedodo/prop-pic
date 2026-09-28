// Talks to the Cloudflare Worker API (worker/index.js) for live challenges.
// When the app is hosted somewhere without the API (e.g. a plain static host),
// `online()` resolves false and the app falls back to sharing scores by link.

let onlinePromise;

export function online() {
  onlinePromise ??= fetch('/api/health', { signal: AbortSignal.timeout(4000) })
    .then((r) => r.ok)
    .catch(() => false);
  return onlinePromise;
}

function secret() {
  const KEY = 'propPic.secret';
  let s;
  try {
    s = localStorage.getItem(KEY);
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem(KEY, s);
    }
  } catch {
    s ??= crypto.randomUUID();
  }
  return s;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/challenges/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

/** Joins (or creates) a challenge. Returns { code, date, you } — `date` is the challenge's real day. */
export function join(code, date, name) {
  return api(`${code}/join`, { method: 'POST', body: { name, date } });
}

export function uploadSlot(code, i, slot) {
  const { photo, ...result } = slot;
  return api(`${code}/slots/${i}`, { method: 'PUT', body: { result, photo } });
}

/** @returns {Promise<{code, date, players: Array<{id, name, slots}>}>} */
export function fetchChallenge(code) {
  return api(code);
}

export function photoUrl(code, playerId, i, takenAt) {
  return `/api/challenges/${code}/photos/${playerId}/${i}?v=${takenAt}`;
}
