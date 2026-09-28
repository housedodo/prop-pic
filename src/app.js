import { challengeSlots, dailySlots, newChallengeCode, todayKey } from './colors.js';
import { analyzePixels } from './analyze.js';
import { SCORING, scorePhoto, totalScore } from './scoring.js';
import { detectObjects } from './detect.js';
import * as store from './store.js';

const app = document.getElementById('app');
const PHOTO_MAX = 480; // stored thumbnail size
const ANALYZE_MAX = 160; // analysis resolution

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- games ----------

function ensureDailyGame() {
  const date = todayKey();
  const id = `daily-${date}`;
  if (!store.getGame(id)) {
    store.putGame({ id, type: 'daily', date, slots: [null] });
  }
  return store.getGame(id);
}

function createChallenge() {
  const code = newChallengeCode();
  const game = { id: `ch-${code}`, type: 'challenge', code, date: todayKey(), slots: [null, null, null, null], opponent: null };
  store.putGame(game);
  return game;
}

function joinFromLink(link) {
  const id = `ch-${link.code}`;
  const game = store.getGame(id) ?? { id, type: 'challenge', code: link.code, date: link.date, slots: [null, null, null, null] };
  game.opponent = { name: link.name, scores: link.scores };
  store.putGame(game);
  return game;
}

function slotsFor(game) {
  return game.type === 'daily' ? dailySlots(game.date) : challengeSlots(game.code, game.date);
}

const isOpen = (game) => game.date === todayKey();

// ---------- photo processing ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
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

async function processPhoto(file, slot) {
  const img = await loadImage(file);
  const photoCanvas = drawScaled(img, PHOTO_MAX);
  const small = drawScaled(img, ANALYZE_MAX);
  URL.revokeObjectURL(img.src);

  const { data, width, height } = small.getContext('2d').getImageData(0, 0, small.width, small.height);
  const { coverage, accuracy } = analyzePixels(data, width, height, slot.color.hex);

  // Bonus: a wanted item was detected AND its box is mostly the target color.
  const bonusFound = [];
  const detections = await detectObjects(photoCanvas);
  if (detections) {
    const k = small.width / photoCanvas.width;
    for (const item of slot.bonusItems) {
      const hit = detections
        .filter((d) => d.class === item)
        .some((d) => {
          const [x, y, w, h] = d.bbox.map((v) => v * k);
          return analyzePixels(data, width, height, slot.color.hex, { x, y, w, h }).coverage >= SCORING.bonusItemMinCoverage;
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
  };
}

// ---------- views ----------

function renderName() {
  app.innerHTML = `
    <section class="card center">
      <h1>Prop Pic</h1>
      <p>Hunt a color. Snap it. Score points.</p>
      <form id="nameForm">
        <input name="name" placeholder="Your name" maxlength="24" required autofocus>
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
  const challenges = store.listGames().filter((g) => g.type === 'challenge');
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
      <h2>Challenge a friend</h2>
      <p class="muted">You both get the same 4 colors today. Take 4 photos before midnight — highest total wins.</p>
      <button class="primary" id="newChallenge">New challenge</button>
    </section>

    ${challenges.length ? `<h3>Your challenges</h3>` : ''}
    ${challenges
      .map((g) => {
        const mine = totalScore(g.slots.map((s) => s?.score.total));
        const theirs = g.opponent ? totalScore(g.opponent.scores) : null;
        return `<a class="card row" href="#/game/${g.id}">
          <div class="dots">${slotsFor(g).map((s) => `<span class="swatch" style="--c:${s.color.hex}"></span>`).join('')}</div>
          <div class="grow">
            <div>vs ${g.opponent ? esc(g.opponent.name) : '<span class="muted">waiting for friend</span>'}</div>
            <div class="muted">${g.date}${isOpen(g) ? '' : ' · finished'}</div>
          </div>
          <div class="score">${mine}${theirs != null ? ` – ${theirs}` : ''}</div>
        </a>`;
      })
      .join('')}`;

  document.getElementById('newChallenge').onclick = () => {
    location.hash = `#/game/${createChallenge().id}`;
  };
}

function renderGame(id) {
  const game = store.getGame(id);
  if (!game) return (location.hash = '#/');
  const slots = slotsFor(game);
  const open = isOpen(game);
  const me = store.getState().name;
  const myTotal = totalScore(game.slots.map((s) => s?.score.total));
  const opp = game.opponent;

  app.innerHTML = `
    <header class="top"><a href="#/" class="back">← Back</a><span class="muted">${game.date}${open ? '' : ' · finished'}</span></header>

    ${
      game.type === 'challenge'
        ? `<section class="card versus">
            <div><div class="muted">${esc(me)}</div><div class="big-score">${myTotal}</div></div>
            <div class="muted">vs</div>
            <div><div class="muted">${opp ? esc(opp.name) : 'Friend'}</div><div class="big-score">${opp ? totalScore(opp.scores) : '–'}</div></div>
          </section>
          <button class="primary wide" id="share">${opp ? 'Send my scores' : 'Invite friend'}</button>
          <p class="muted small center">Send the link again after each photo so your friend sees your latest score.</p>`
        : ''
    }

    <div class="slots">
      ${slots
        .map((slot, i) => {
          const taken = game.slots[i];
          const oppScore = opp?.scores?.[i];
          return `<section class="card slot" style="--c:${slot.color.hex}">
            <div class="slot-head">
              <span class="swatch"></span>
              <h2>${slot.color.name}</h2>
              ${oppScore != null ? `<span class="muted small">${esc(opp.name)}: ${oppScore}</span>` : ''}
            </div>
            <div class="muted small">Bonus: ${slot.bonusItems.map((b) => `<span class="chip ${taken?.bonusFound.includes(b) ? 'hit' : ''}">${b}</span>`).join(' ')} in ${slot.color.name.toLowerCase()}</div>
            ${
              taken
                ? `<img class="photo" src="${taken.photo}" alt="${slot.color.name} photo">
                   <div class="breakdown">
                     <span>Coverage <b>${taken.score.coverage}</b></span>
                     <span>Accuracy <b>${taken.score.accuracy}</b></span>
                     <span>Bonus <b>${taken.score.bonus}</b></span>
                     <span class="total">${taken.score.total} pts</span>
                   </div>
                   <div class="muted small">${Math.round(taken.coverage * 100)}% of the photo is ${slot.color.name.toLowerCase()}${taken.detectionAvailable ? '' : ' · bonus detection unavailable'}</div>`
                : ''
            }
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
    </div>`;

  app.querySelectorAll('input[type=file]').forEach((input) => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const i = Number(input.dataset.slot);
      const status = document.getElementById(`status-${i}`);
      status.textContent = 'Scoring…';
      app.querySelectorAll('input[type=file]').forEach((el) => (el.disabled = true));
      try {
        game.slots[i] = await processPhoto(file, slots[i]);
        store.putGame(game);
        renderGame(id);
      } catch (err) {
        console.error(err);
        status.textContent = 'Could not read that photo, try again.';
        app.querySelectorAll('input[type=file]').forEach((el) => (el.disabled = false));
      }
    };
  });

  document.getElementById('share')?.addEventListener('click', async () => {
    const url = store.shareLink(game, me);
    const text = `${me} challenges you on Prop Pic! Today's colors: ${slots.map((s) => s.color.name).join(', ')}. My score so far: ${myTotal}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Prop Pic challenge', text, url });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    await navigator.clipboard?.writeText(`${text} ${url}`);
    alert('Link copied — send it to your friend.');
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
  if (m) renderGame(decodeURIComponent(m[1]));
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
