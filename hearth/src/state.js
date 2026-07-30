// The single mutable game state, plus save/load.
//
// Rules: anything persistent lives here. Add fields with a default in defaults() and,
// if you rename or restructure, bump VERSION and add a migration. Saves must survive.

import { Bus, EV } from './core/events.js';

export const VERSION = 3;
const KEY = 'hearth.save.v1';

export function defaults() {
  return {
    version: VERSION,
    seed: (Math.random() * 0x7fffffff) | 0,
    createdAt: Date.now(),
    playtime: 0,                       // logical frames

    player: { name: 'Wren', x: 22, y: 24, map: 'village', dir: 'down', sprite: 'hero' },

    party: [],                         // [{id, species, nick, lvl, xp, hp, maxhp, moves:[], stats:{}, bond}]
    box: [],
    bag: { charm: 5, salve: 2 },
    seen: {},                          // species id -> 'seen'|'bonded'
    dex: {},

    coins: 120,
    hearth: 0,                         // village currency earned from missions & bonds

    village: {
      level: 1,
      buildings: [],                   // [{id, type, x, y, tier, builtAt}]
      unlocked: ['hearthstone'],
      paths: [],
      decor: [],
    },

    missions: {
      active: [],                      // [{id, progress, need, acceptedAt}]
      done: [],                        // [{id, at}]
      streak: 0,
      lastDay: null,
      dailyPool: [],
      poolDay: null,
    },

    clock: { day: 1, hour: 8, minute: 0, season: 'spring', weather: 'clear' },

    flags: {},
    settings: { volume: 0.7, muted: false, textSpeed: 2, showGrid: false },

    stats: { steps: 0, battles: 0, wins: 0, bonded: 0, built: 0, missionsDone: 0 },
  };
}

export let S = defaults();

export function setFlag(name, value = true) {
  S.flags[name] = value;
  Bus.emit(EV.FLAG_SET, { name, value });
}
export const flag = name => !!S.flags[name];

export function addCoins(n) {
  S.coins = Math.max(0, S.coins + n);
  Bus.emit(EV.COINS_CHANGED, { coins: S.coins, delta: n });
  return S.coins;
}
export function addHearth(n) {
  S.hearth = Math.max(0, S.hearth + n);
  Bus.emit(EV.HEARTH_CHANGED, { hearth: S.hearth, delta: n });
  return S.hearth;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    return true;
  } catch (err) { console.warn('[save] failed', err); return false; }
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = migrate(JSON.parse(raw));
    S = deepMerge(defaults(), data);
    return true;
  } catch (err) { console.warn('[load] failed', err); return false; }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch {}
  S = defaults();
  return S;
}

export function exportSave() { return JSON.stringify(S); }
export function importSave(json) {
  const data = migrate(typeof json === 'string' ? JSON.parse(json) : json);
  S = deepMerge(defaults(), data);
  return S;
}

// Replace the live object's contents without breaking imported references to S.
export function adopt(next) {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, next);
  return S;
}

function migrate(data) {
  if (!data || typeof data !== 'object') return defaults();
  let v = data.version || 1;
  if (v < 2) { data.stats ||= defaults().stats; v = 2; }
  if (v < 3) { data.clock ||= defaults().clock; data.clock.weather ||= 'clear'; v = 3; }
  data.version = VERSION;
  return data;
}

// Fills in newly-added defaults without clobbering saved values.
function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) {
      out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over === undefined ? base : over;
}
