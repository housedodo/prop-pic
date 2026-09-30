import { CLASSES, OUTCOMES, STATS, TURNS_PER_DAY, applyEffects, modifier, newCharacter, outcomeFor, rollD20 } from './rules.js';
import * as offline from './gm-offline.js';
import { todayKey } from '../src/colors.js';

const app = document.getElementById('app');
const KEY = 'dailyQuest.v1';
const MAX_LOG = 80;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- state ----------

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

let state = load();
let ui = { busy: null, error: null, lastRoll: null, menu: false, draftClass: 'fighter' };

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save', err);
  }
}

function log(entry) {
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

// Recent turns, as short lines, so the game master remembers what just happened.
function recent() {
  return state.log
    .filter((e) => e.type === 'action' || e.type === 'narration')
    .slice(-6)
    .map((e) => (e.type === 'action' ? `Player: ${e.text}` : `GM: ${e.text}`));
}

// A new calendar day refills the actions and heals a little.
function rollOverDay() {
  const today = todayKey();
  if (state.day === today) return;
  state.dayNumber = (state.dayNumber ?? 0) + 1;
  state.day = today;
  state.turnsUsed = 0;
  log({ type: 'day', text: `Day ${state.dayNumber}` });
  const c = state.character;
  if (state.dayNumber > 1) {
    if (c.hp === 0) {
      c.hp = Math.ceil(c.maxHp / 2);
      c.gold = Math.floor(c.gold / 2);
      log({ type: 'note', text: 'You wake up bruised and lighter of purse, but alive.' });
    } else {
      c.hp = Math.min(c.maxHp, c.hp + 3);
    }
  }
  save();
}

// ---------- game master ----------

let gmMode = state?.gmMode ?? 'ai';
const setMode = (m) => {
  gmMode = m;
  if (state) state.gmMode = m;
};

// Asks the AI game master; falls back to the built-in one when the AI isn't available.
async function gm(path, payload, fallback) {
  try {
    const res = await fetch(`/api/quest${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setMode('ai');
      return await res.json();
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 && !data.offline) throw Object.assign(new Error(data.error ?? 'Busy'), { retry: true });
  } catch (err) {
    if (err.retry) throw err;
  }
  setMode('offline');
  return fallback();
}

const context = () => ({
  character: state.character,
  journal: state.journal,
  scene: state.scene,
  recent: recent(),
});

async function startAdventure(name, cls) {
  const character = newCharacter(name, cls);
  state = { character, log: [], journal: '', scene: '', day: null, dayNumber: 0, turnsUsed: 0, pending: null };
  rollOverDay();
  ui.busy = 'The story is being written…';
  render();
  const out = await gm('/start', { character }, () => offline.start());
  state.scene = out.scene;
  state.journal = out.journal;
  log({ type: 'scene', text: out.scene });
  ui.busy = null;
  save();
  render();
}

async function submitAction(action) {
  action = action.trim().slice(0, 140);
  if (!action) return;
  ui.error = null;
  ui.busy = 'The game master considers…';
  render();
  try {
    const chk = await gm('/check', { ...context(), action }, () => offline.check({ action }));
    state.pending = { action, check: chk };
    save();
  } catch (err) {
    ui.error = err.message;
  }
  ui.busy = null;
  render();
}

async function roll() {
  const p = state.pending;
  if (!p.result) {
    const mod = modifier(state.character, p.check.stat);
    p.result = outcomeFor(rollD20(crypto.getRandomValues ? () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 : Math.random), mod, p.check.dc);
    save();
    ui.lastRoll = 'rolling';
    render();
    await animateDie(p.result);
    await new Promise((r) => setTimeout(r, 650));
  }
  await resolvePending();
}

async function resolvePending() {
  const p = state.pending;
  const lastOfDay = state.turnsUsed + 1 >= TURNS_PER_DAY;
  ui.error = null;
  ui.busy = 'The dice have spoken…';
  ui.lastRoll = null;
  render();
  try {
    const out = await gm('/resolve', { ...context(), action: p.action, check: p.check, result: p.result, lastOfDay }, () =>
      offline.resolve({ action: p.action, check: p.check, result: p.result, day: state.day, turn: state.turnsUsed, lastOfDay }),
    );
    const before = state.character;
    state.character = applyEffects(before, out);
    log({ type: 'action', text: p.action });
    log({ type: 'roll', stat: p.check.stat, ...p.result });
    log({ type: 'narration', text: out.narration, fx: diff(before, state.character) });
    if (state.character.hp === 0) {
      log({ type: 'note', text: 'You are knocked out. Rest until tomorrow.' });
      state.turnsUsed = TURNS_PER_DAY;
    } else {
      state.turnsUsed++;
    }
    state.scene = out.scene;
    log({ type: 'scene', text: out.scene });
    state.journal = out.journal ?? `${state.journal} ${out.journal_note ?? ''}`.trim().slice(-800);
    state.pending = null;
    save();
  } catch (err) {
    ui.error = err.message;
  }
  ui.busy = null;
  render();
}

function diff(a, b) {
  const out = [];
  if (b.hp !== a.hp) out.push(`${b.hp > a.hp ? '+' : ''}${b.hp - a.hp} HP`);
  if (b.gold !== a.gold) out.push(`${b.gold > a.gold ? '+' : ''}${b.gold - a.gold} gold`);
  if (b.xp !== a.xp) out.push(`+${b.xp - a.xp} XP`);
  if (b.level > a.level) out.push(`Level ${b.level}!`);
  for (const i of b.items.filter((x) => !a.items.includes(x))) out.push(`Found: ${i}`);
  for (const i of a.items.filter((x) => !b.items.includes(x))) out.push(`Lost: ${i}`);
  return out;
}

// ---------- dice ----------

// "rolled 14 + 3 = 17", or just "rolled 14" when there is no bonus.
const rollMath = (r) => (r.mod ? `rolled ${r.roll} ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)} = ${r.total}` : `rolled ${r.roll}`);

function d20Svg(n = 20) {
  // A flat-top hexagon silhouette with the triangular facets of a d20.
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <polygon class="face" points="50,4 90,27 90,73 50,96 10,73 10,27"/>
    <polygon class="facet" points="50,22 76,66 24,66"/>
    <path class="facet" d="M50,4 L50,22 M90,27 L76,66 M90,73 L76,66 M50,96 L76,66 M50,96 L24,66 M10,73 L24,66 M10,27 L24,66 M10,27 L50,22 M90,27 L50,22"/>
    <text class="num" x="50" y="57" text-anchor="middle" dominant-baseline="middle">${n}</text>
  </svg>`;
}

function animateDie(result) {
  return new Promise((resolve) => {
    const die = document.getElementById('die');
    if (!die) return resolve();
    const num = die.querySelector('.num');
    die.classList.add('rolling');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ticker = setInterval(() => (num.textContent = 1 + Math.floor(Math.random() * 20)), 60);
    setTimeout(() => {
      clearInterval(ticker);
      num.textContent = result.roll;
      die.classList.remove('rolling');
      die.classList.add('landed', `tier-${result.tier}`);
      const line = document.getElementById('resultLine');
      line.className = `result-line tier-${result.tier}`;
      line.textContent = `${rollMath(result)} vs DC ${result.dc}: ${OUTCOMES[result.tier].label}${result.critical ? '!' : ''}`;
      resolve();
    }, reduce ? 50 : 900);
  });
}

// ---------- views ----------

function renderCreate() {
  app.innerHTML = `
    <form class="create" id="createForm">
      <header>
        <h1>Daily Quest</h1>
        <p>A short adventure, three moves a day. Type what you do, roll the die, see what happens.</p>
      </header>
      <label class="field">
        <span class="label">Hero name</span>
        <input type="text" id="heroName" maxlength="24" placeholder="e.g. Brannoc the Bold" required autocomplete="off">
      </label>
      <div class="field">
        <span class="label">Class</span>
        <div class="classes">
          ${Object.entries(CLASSES)
            .map(
              ([id, c]) => `<button type="button" class="class-card" data-class="${id}" aria-pressed="${ui.draftClass === id}">
                <h3>${c.name}</h3>
                <p>${c.blurb}</p>
                <span class="stats">${Object.entries(c.stats).map(([s, v]) => `<span>${s} ${v >= 0 ? '+' : '−'}${Math.abs(v)}</span>`).join('')}<span>${c.hp} HP</span></span>
              </button>`,
            )
            .join('')}
        </div>
      </div>
      <button class="primary">Begin the adventure</button>
    </form>`;
  app.querySelectorAll('.class-card').forEach((btn) => {
    btn.onclick = () => {
      ui.draftClass = btn.dataset.class;
      app.querySelectorAll('.class-card').forEach((b) => b.setAttribute('aria-pressed', b === btn));
    };
  });
  document.getElementById('createForm').onsubmit = (e) => {
    e.preventDefault();
    startAdventure(document.getElementById('heroName').value, ui.draftClass);
  };
}

function renderEntry(e) {
  switch (e.type) {
    case 'day':
      return `<div class="entry day">${esc(e.text)}</div>`;
    case 'scene':
      return `<p class="entry scene">${esc(e.text)}</p>`;
    case 'action':
      return `<div class="entry action">${esc(e.text)}</div>`;
    case 'roll':
      return `<div class="roll-chip tier-${e.tier}"><span class="dot"></span><span>${STATS[e.stat] ?? e.stat} · ${rollMath(e)} vs DC ${e.dc}</span><b>${OUTCOMES[e.tier].label}${e.critical ? '!' : ''}</b></div>`;
    case 'narration':
      return `<p class="entry narration">${esc(e.text)}</p>${e.fx?.length ? `<div class="effects">${e.fx.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}`;
    case 'note':
      return `<p class="entry note">${esc(e.text)}</p>`;
    default:
      return '';
  }
}

const SUGGESTIONS = ['Look around', 'Talk to someone', 'Search for clues', 'Sneak closer', 'Attack!'];

function renderDock() {
  const turns = `<div class="turns">${Array.from({ length: TURNS_PER_DAY }, (_, i) => `<i class="${i < state.turnsUsed ? 'used' : ''}"></i>`).join('')}
    <span>${Math.max(0, TURNS_PER_DAY - state.turnsUsed)} of ${TURNS_PER_DAY} actions left today</span></div>`;
  const error = ui.error ? `<div class="error">${esc(ui.error)}</div>` : '';

  if (ui.busy) return `<div class="thinking">${esc(ui.busy)}</div>`;

  const p = state.pending;
  if (p) {
    const mod = modifier(state.character, p.check.stat);
    const need = Math.max(2, Math.min(20, p.check.dc - mod));
    const chance = Math.round(((21 - need) / 20) * 100);
    if (p.result && !ui.lastRoll) {
      return `${error}<div class="check"><div class="what">${esc(p.check.attempt)}</div><button class="primary" id="retry">Continue</button></div>`;
    }
    return `<div class="check">
      <div class="stat">${STATS[p.check.stat]} check · DC ${p.check.dc} · your bonus ${mod >= 0 ? '+' : '−'}${Math.abs(mod)}</div>
      <div class="what">${esc(p.check.attempt)}</div>
      <button class="d20" id="die" aria-label="Roll the d20">${d20Svg(20)}</button>
      <div class="odds" id="resultLine">Tap the die to roll · about ${chance}% to succeed</div>
    </div>${error}`;
  }

  if (state.turnsUsed >= TURNS_PER_DAY) {
    return `${turns}<div class="rest"><h3>The day is done</h3><p>Your story continues tomorrow with ${TURNS_PER_DAY} new actions.</p></div>`;
  }

  return `${turns}${error}
    <div class="suggest">${SUGGESTIONS.map((s) => `<button type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form class="act" id="actForm">
      <input type="text" id="action" maxlength="140" placeholder="What do you do?" autocomplete="off" enterkeyhint="send">
      <button class="primary">Act</button>
    </form>`;
}

function render() {
  if (!state?.character) return renderCreate();
  const c = state.character;
  app.innerHTML = `
    <header class="hero">
      <div class="hero-top">
        <h2>${esc(c.name)}</h2>
        <span class="cls">Level ${c.level} ${CLASSES[c.cls].name}</span>
        <button class="menu" id="menu" aria-label="Menu">•••</button>
      </div>
      <div class="meters">
        <span>${c.hp}/${c.maxHp} HP</span>
        <div class="hpbar"><span style="width:${(100 * c.hp) / c.maxHp}%"></span></div>
        <span>${c.gold} gold</span>
        <span>${c.xp % 100}/100 XP</span>
      </div>
      <div class="items">${c.items.map((i) => `<span>${esc(i)}</span>`).join('')}</div>
    </header>
    <section class="story" aria-live="polite">${state.log.map(renderEntry).join('')}</section>
    <footer class="dock">${renderDock()}
      <div class="gm">${gmMode === 'ai' ? 'Game master: Claude' : 'Game master: built-in (offline)'}</div>
    </footer>
    ${
      ui.menu
        ? `<div class="sheet" id="sheet"><div>
            <h3>Journal</h3>
            <p>${esc(state.journal || 'Nothing written yet.')}</p>
            <button class="danger" id="restart">Start a new hero</button>
            <button class="ghost" id="closeMenu">Close</button>
          </div></div>`
        : ''
    }`;

  document.getElementById('menu').onclick = () => {
    ui.menu = true;
    render();
  };
  if (ui.menu) {
    document.getElementById('closeMenu').onclick = () => {
      ui.menu = false;
      render();
    };
    document.getElementById('sheet').onclick = (e) => {
      if (e.target.id === 'sheet') {
        ui.menu = false;
        render();
      }
    };
    const restart = document.getElementById('restart');
    restart.onclick = () => {
      if (restart.dataset.confirm) {
        state = null;
        ui.menu = false;
        try {
          localStorage.removeItem(KEY);
        } catch {}
        render();
      } else {
        restart.dataset.confirm = '1';
        restart.textContent = 'Tap again to delete this hero';
      }
    };
  }
  document.getElementById('actForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAction(document.getElementById('action').value);
  });
  app.querySelectorAll('[data-suggest]').forEach((b) => (b.onclick = () => submitAction(b.dataset.suggest)));
  const die = document.getElementById('die');
  if (die) die.onclick = () => (die.disabled = true, roll());
  document.getElementById('retry')?.addEventListener('click', resolvePending);
  if (!ui.menu) window.scrollTo(0, document.body.scrollHeight);
}

if (state?.character) rollOverDay();
render();
