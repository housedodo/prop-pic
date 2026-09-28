import { challengeSlots, dailySlots, newChallengeCode, todayKey } from './colors.js';
import { colorMask, summarize } from './analyze.js';
import { SCORING, scorePhoto, totalScore } from './scoring.js';
import { detectObjects } from './detect.js';
import * as store from './store.js';
import * as sync from './sync.js';

const app = document.getElementById('app');
const PHOTO_MAX = 480; // stored photo size
const ANALYZE_MAX = 240; // analysis resolution
const POLL_MS = 10_000;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let isOnline = false;
let current = null; // { id, timer } for the game view being shown
let busy = false; // a photo is being scored; don't re-render underneath it
const showMask = new Set(); // slot indexes with "what counted" view open

// ---------- games ----------

function ensureDailyGame() {
  const date = todayKey();
  const id = `daily-${date}`;
  if (!store.getGame(id)) store.putGame({ id, type: 'daily', date, slots: [null] });
  return store.getGame(id);
}

function createChallenge() {
  const code = newChallengeCode();
  const game = { id: `ch-${code}`, type: 'challenge', code, date: todayKey(), slots: [null, null, null, null], others: [] };
  store.putGame(game);
  return game;
}

function joinFromLink(link) {
  const id = `ch-${link.code}`;
  const game = store.getGame(id) ?? { id, type: 'challenge', code: link.code, date: link.date, slots: [null, null, null, null], others: [] };
  if (!game.me) {
    // Link mode: the link carries the sender's scores.
    const others = (game.others ?? []).filter((o) => o.name !== link.name);
    game.others = [...others, { name: link.name, scores: link.scores }];
  }
  store.putGame(game);
  return game;
}

// Games saved by the first version had a single `opponent`.
function upgrade(game) {
  if (game?.type === 'challenge' && !game.others) {
    game.others = game.opponent ? [game.opponent] : [];
    delete game.opponent;
  }
  return game;
}

function slotsFor(game) {
  return game.type === 'daily' ? dailySlots(game.date) : challengeSlots(game.code, game.date);
}

const isOpen = (game) => game.date === todayKey();
const myScores = (game) => game.slots.map((s) => s?.score.total ?? null);

// ---------- live sync ----------

async function syncGame(game) {
  if (!isOnline || game.type !== 'challenge') return false;
  const name = store.getState().name;
  if (!game.me || game.myName !== name) {
    const res = await sync.join(game.code, game.date, name);
    game.me = res.you;
    game.myName = name;
    game.date = res.date; // the creator's day wins if time zones differ
  }
  for (const [i, slot] of game.slots.entries()) {
    if (slot && !slot.synced && slot.photo) {
      await sync.uploadSlot(game.code, i, slot);
      slot.synced = true;
    }
  }
  const data = await sync.fetchChallenge(game.code);
  const before = JSON.stringify(game.others);
  game.others = data.players
    .filter((p) => p.id !== game.me)
    .map((p) => ({ id: p.id, name: p.name, scores: p.slots.map((s) => s?.score.total ?? null), slots: p.slots }));
  game.lastSync = Date.now();
  store.putGame(game);
  return JSON.stringify(game.others) !== before;
}

function startPolling(game) {
  const tick = async () => {
    if (current?.id !== game.id || document.hidden) return;
    try {
      game.syncError = null;
      const changed = await syncGame(game);
      if (changed && current?.id === game.id && !busy) renderGame(game.id);
      else updateSyncStatus(game);
    } catch (err) {
      game.syncError = err.message;
      updateSyncStatus(game);
    }
  };
  current = { id: game.id, timer: setInterval(tick, POLL_MS) };
  tick();
}

function stopPolling() {
  if (current) clearInterval(current.timer);
  current = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current) {
    const game = upgrade(store.getGame(current.id));
    if (game) syncGame(game).then((changed) => changed && !busy && renderGame(game.id)).catch(() => {});
  }
});

// ---------- photo processing ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawScaled(img, max) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function maskFor(img, color) {
  const small = drawScaled(img, ANALYZE_MAX);
  const { data, width, height } = small.getContext('2d').getImageData(0, 0, small.width, small.height);
  return { m: colorMask(data, width, height, color.match), width, height };
}

async function processPhoto(file, slot) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const photoCanvas = drawScaled(img, PHOTO_MAX);
  const { m, width, height } = maskFor(img, slot.color);
  URL.revokeObjectURL(url);
  const { coverage, accuracy } = summarize(m, width, height);

  // Bonus: a wanted item was detected AND enough of its box is the target color.
  const bonusFound = [];
  const detections = await detectObjects(photoCanvas);
  if (detections) {
    const k = width / photoCanvas.width;
    for (const item of slot.bonusItems) {
      const hit = detections
        .filter((d) => d.class === item)
        .some((d) => {
          const [x, y, w, h] = d.bbox.map((v) => v * k);
          return summarize(m, width, height, { x, y, w, h }).coverage >= SCORING.bonusItemMinCoverage;
        });
      if (hit) bonusFound.push(item);
    }
  }

  return {
    photo: photoCanvas.toDataURL('image/jpeg', 0.7),
    coverage,
    accuracy,
    bonusFound,
    detectionAvailable: !!detections,
    score: scorePhoto({ coverage, accuracy, bonusFound }),
    takenAt: Date.now(),
    synced: false,
  };
}

// Keeps matching pixels in color and fades everything else to grey.
async function drawMask(canvas, photo, color) {
  const img = await loadImage(photo);
  const { m, width } = maskFor(img, color);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const k = width / canvas.width;
  for (let y = 0; y < canvas.height; y++) {
    const my = Math.min(Math.floor(y * k), Math.floor(m.mask.length / width) - 1);
    for (let x = 0; x < canvas.width; x++) {
      if (m.mask[my * width + Math.min(Math.floor(x * k), width - 1)]) continue;
      const i = (y * canvas.width + x) * 4;
      const g = (out.data[i] * 0.3 + out.data[i + 1] * 0.59 + out.data[i + 2] * 0.11) * 0.35 + 150;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// ---------- views ----------

function renderName() {
  app.innerHTML = `
    <section class="card center">
      <h1>Prop Pic</h1>
      <p>Hunt a color. Snap it. Score points.</p>
      <form id="nameForm">
        <input id="name" name="name" placeholder="Your name" maxlength="24" required autofocus>
        <button class="primary">Let's go</button>
      </form>
    </section>`;
  document.getElementById('nameForm').onsubmit = (e) => {
    e.preventDefault();
    store.setName(new FormData(e.target).get('name'));
    route();
  };
}

function renderHome() {
  const daily = ensureDailyGame();
  const [dSlot] = slotsFor(daily);
  const challenges = store.listGames().filter((g) => g.type === 'challenge').map(upgrade);
  const name = store.getState().name;

  app.innerHTML = `
    <header class="top"><h1>Prop Pic</h1><span class="muted">Hi ${esc(name)}</span></header>

    <a class="card daily" href="#/game/${daily.id}" style="--c:${dSlot.color.hex}">
      <div class="swatch big"></div>
      <div>
        <div class="muted">Today's color</div>
        <h2>${dSlot.color.name}</h2>
        <div class="muted">${daily.slots[0] ? `${daily.slots[0].score.total} pts` : 'Not taken yet'}</div>
      </div>
    </a>

    <section class="card">
      <h2>Challenge friends</h2>
      <p class="muted">Everyone gets the same 4 colors today. Take 4 photos before midnight. Highest total wins.</p>
      <button class="primary" id="newChallenge">New challenge</button>
    </section>

    ${challenges.length ? `<h3>Your challenges</h3>` : ''}
    ${challenges
      .map((g) => {
        const mine = totalScore(myScores(g));
        const rivals = g.others.map((o) => esc(o.name)).join(', ');
        const best = Math.max(...g.others.map((o) => totalScore(o.scores)), -1);
        return `<a class="card row" href="#/game/${g.id}">
          <div class="dots">${slotsFor(g).map((s) => `<span class="swatch" style="--c:${s.color.hex}"></span>`).join('')}</div>
          <div class="grow">
            <div class="ellipsis">vs ${rivals || '<span class="muted">waiting for friends</span>'}</div>
            <div class="muted">${g.date}${isOpen(g) ? '' : ' · finished'}</div>
          </div>
          <div class="score">${mine}${best >= 0 ? ` – ${best}` : ''}</div>
        </a>`;
      })
      .join('')}`;

  document.getElementById('newChallenge').onclick = () => {
    location.hash = `#/game/${createChallenge().id}`;
  };
}

function leaderboard(game, me) {
  const rows = [{ name: me, total: totalScore(myScores(game)), you: true }, ...game.others.map((o) => ({ name: o.name, total: totalScore(o.scores) }))];
  rows.sort((a, b) => b.total - a.total);
  return `<section class="card board">
    ${rows
      .map(
        (r, i) => `<div class="board-row ${r.you ? 'you' : ''}">
          <span class="rank">${i + 1}</span>
          <span class="grow ellipsis">${esc(r.name)}${r.you ? ' <span class="muted small">(you)</span>' : ''}</span>
          <span class="big-score">${r.total}</span>
        </div>`,
      )
      .join('')}
    ${game.others.length ? '' : '<div class="muted small">Invite a friend to start the race.</div>'}
  </section>`;
}

function othersForSlot(game, i) {
  const rows = game.others.filter((o) => o.scores?.[i] != null);
  if (!rows.length) return '';
  return `<div class="others">${rows
    .map((o) => {
      const s = o.slots?.[i];
      const thumb = isOnline && o.id && s ? `<img class="thumb" src="${sync.photoUrl(game.code, o.id, i, s.takenAt)}" alt="${esc(o.name)}'s photo" data-full>` : '';
      return `<div class="other">${thumb}<span class="grow">${esc(o.name)}${s?.bonusFound?.length ? ` <span class="muted small">+${s.bonusFound.join(', ')}</span>` : ''}</span><b>${o.scores[i]}</b></div>`;
    })
    .join('')}</div>`;
}

function syncStatusText(game) {
  if (game.type !== 'challenge') return '';
  if (!isOnline) return 'Offline mode: send the link again after each photo so friends see your score.';
  if (game.syncError) return `Can't reach the server (${esc(game.syncError)}). Retrying…`;
  return game.lastSync ? 'Live: scores and photos update automatically.' : 'Connecting…';
}

function updateSyncStatus(game) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = syncStatusText(game);
}

function renderGame(id) {
  const game = upgrade(store.getGame(id));
  if (!game) return (location.hash = '#/');
  const slots = slotsFor(game);
  const open = isOpen(game);
  const me = store.getState().name;

  app.innerHTML = `
    <header class="top"><a href="#/" class="back">← Back</a><span class="muted">${game.date}${open ? '' : ' · finished'}</span></header>

    ${
      game.type === 'challenge'
        ? `${leaderboard(game, me)}
          <button class="primary wide" id="share">${isOnline ? 'Invite friends' : game.others.length ? 'Send my scores' : 'Invite friend'}</button>
          <p class="muted small center" id="syncStatus">${syncStatusText(game)}</p>`
        : ''
    }

    <div class="slots">
      ${slots
        .map((slot, i) => {
          const taken = game.slots[i];
          return `<section class="card slot" style="--c:${slot.color.hex}">
            <div class="slot-head">
              <span class="swatch"></span>
              <h2>${slot.color.name}</h2>
              ${taken ? `<span class="total">${taken.score.total} pts</span>` : ''}
            </div>
            <div class="muted small">Bonus: ${slot.bonusItems.map((b) => `<span class="chip ${taken?.bonusFound.includes(b) ? 'hit' : ''}">${b}</span>`).join(' ')} in ${slot.color.name.toLowerCase()}</div>
            ${
              taken
                ? `<div class="photo-wrap">
                     <img class="photo" src="${taken.photo}" alt="${slot.color.name} photo" ${showMask.has(i) ? 'hidden' : ''}>
                     <canvas class="photo" data-mask="${i}" ${showMask.has(i) ? '' : 'hidden'}></canvas>
                   </div>
                   <div class="breakdown">
                     <span>Coverage <b>${taken.score.coverage}</b></span>
                     <span>Accuracy <b>${taken.score.accuracy}</b></span>
                     <span>Bonus <b>${taken.score.bonus}</b></span>
                     <button class="link" data-toggle-mask="${i}">${showMask.has(i) ? 'Show photo' : 'Show what counted'}</button>
                   </div>
                   <div class="muted small">${Math.round(taken.coverage * 100)}% of the photo is ${slot.color.name.toLowerCase()}${taken.detectionAvailable ? '' : ' · bonus detection unavailable'}</div>`
                : ''
            }
            ${othersForSlot(game, i)}
            ${
              open
                ? `<label class="button ${taken ? '' : 'primary'}">
                     ${taken ? 'Retake' : 'Take photo'}
                     <input type="file" accept="image/*" capture="environment" data-slot="${i}" hidden>
                   </label>`
                : taken ? '' : '<div class="muted">Missed</div>'
            }
            <div class="status" id="status-${i}"></div>
          </section>`;
        })
        .join('')}
    </div>
    <div class="lightbox" id="lightbox" hidden><img alt=""></div>`;

  app.querySelectorAll('canvas[data-mask]:not([hidden])').forEach((c) => {
    const i = Number(c.dataset.mask);
    drawMask(c, game.slots[i].photo, slots[i].color);
  });

  app.querySelectorAll('[data-toggle-mask]').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.toggleMask);
      showMask.has(i) ? showMask.delete(i) : showMask.add(i);
      renderGame(id);
    };
  });

  const lightbox = document.getElementById('lightbox');
  app.querySelectorAll('img[data-full]').forEach((img) => {
    img.onclick = () => {
      lightbox.querySelector('img').src = img.src;
      lightbox.hidden = false;
    };
  });
  lightbox.onclick = () => (lightbox.hidden = true);

  app.querySelectorAll('input[type=file]').forEach((input) => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const i = Number(input.dataset.slot);
      const status = document.getElementById(`status-${i}`);
      status.textContent = 'Scoring…';
      busy = true;
      app.querySelectorAll('input[type=file]').forEach((el) => (el.disabled = true));
      try {
        game.slots[i] = await processPhoto(file, slots[i]);
        showMask.delete(i);
        store.putGame(game);
        busy = false;
        renderGame(id);
        syncGame(game).then(() => current?.id === id && !busy && renderGame(id)).catch((err) => {
          game.syncError = err.message;
          updateSyncStatus(game);
        });
      } catch (err) {
        console.error(err);
        busy = false;
        status.textContent = 'Could not read that photo. Try again.';
        app.querySelectorAll('input[type=file]').forEach((el) => (el.disabled = false));
      }
    };
  });

  document.getElementById('share')?.addEventListener('click', async () => {
    const url = store.shareLink(game, me);
    const colors = slots.map((s) => s.color.name).join(', ');
    const text = isOnline
      ? `${me} challenges you on Prop Pic! Today's colors: ${colors}.`
      : `${me} challenges you on Prop Pic! Today's colors: ${colors}. My score so far: ${totalScore(myScores(game))}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Prop Pic challenge', text, url });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      document.getElementById('syncStatus').textContent = 'Link copied. Send it to your friends.';
    } catch {
      prompt('Copy this link and send it to your friends:', url);
    }
  });
}

// ---------- routing ----------

function route() {
  const link = store.parseShareLink(location.hash);
  if (link) {
    const game = joinFromLink(link);
    history.replaceState(null, '', `#/game/${game.id}`);
  }
  if (!store.getState().name) return renderName();
  const m = location.hash.match(/^#\/game\/(.+)$/);
  const id = m && decodeURIComponent(m[1]);
  if (current?.id !== id) {
    stopPolling();
    showMask.clear();
  }
  if (id) {
    renderGame(id);
    const game = store.getGame(id);
    if (game?.type === 'challenge' && isOnline && current?.id !== id) startPolling(game);
  } else {
    renderHome();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
sync.online().then((ok) => {
  isOnline = ok;
  if (ok) route();
});
