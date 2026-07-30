// The clock, the seasons, the weather, and the light they produce.
//
// One in-game minute per real second: a full day is 24 real minutes, so a play
// session sees dawn, noon, dusk, and night without anyone waiting around.

import { S } from '../state.js';
import { Bus, EV } from '../core/events.js';
import { R } from '../core/renderer.js';
import { tintFor } from '../art/palette.js';
import { Atlas } from '../art/atlas.js';
import { makeRng } from '../core/rng.js';

export const FRAMES_PER_MINUTE = 60;      // 1 in-game minute per real second
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_SEASON = 7;

let acc = 0;
const rng = makeRng(4242);
const drops = [];

export function tickClock(n = 1) {
  const c = S.clock;
  acc += n;
  while (acc >= FRAMES_PER_MINUTE) {
    acc -= FRAMES_PER_MINUTE;
    c.minute++;
    if (c.minute >= 60) {
      c.minute = 0;
      c.hour++;
      if (c.hour >= 24) {
        c.hour = 0;
        c.day++;
        Bus.emit(EV.DAY_CHANGED, { day: c.day });
        rollWeather();
        if ((c.day - 1) % DAYS_PER_SEASON === 0) {
          const i = (SEASONS.indexOf(c.season) + 1) % SEASONS.length;
          c.season = SEASONS[i];
          Bus.emit(EV.SEASON_CHANGED, c.season);
        }
      }
    }
  }
}

function rollWeather() {
  const c = S.clock;
  const r = rng.float();
  if (c.season === 'winter') c.weather = r < 0.32 ? 'snow' : 'clear';
  else if (c.season === 'autumn') c.weather = r < 0.28 ? 'rain' : r < 0.34 ? 'storm' : 'clear';
  else c.weather = r < 0.18 ? 'rain' : 'clear';
}

export const isNight = () => S.clock.hour >= 19 || S.clock.hour < 6;
export const clockText = () => `${String(S.clock.hour).padStart(2, '0')}:${String(S.clock.minute).padStart(2, '0')}`;
export const timeOfDay = () => {
  const h = S.clock.hour;
  if (h < 6) return 'night';
  if (h < 9) return 'dawn';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
};

/** Screen tint for the current moment. Drawn on LAYER.WEATHER by the overworld. */
export function drawLighting(map) {
  const c = S.clock;
  const { color, alpha, mode } = tintFor(c.hour + c.minute / 60, c.season, c.weather);
  if (map?.indoor) {
    // Interiors keep their own warm light; only the deep night reaches inside.
    const a = Math.min(alpha, 0.28);
    if (a > 0.02) R.tintScreen('#20263a', a, 'multiply');
    return;
  }
  if (alpha > 0.01) R.tintScreen(color, alpha, mode);
}

/** Falling weather particles, screen-space so they cost nothing to scroll. */
export function drawWeather() {
  const w = S.clock.weather;
  if (w === 'clear') return;
  const snow = w === 'snow';
  const want = w === 'storm' ? 90 : snow ? 60 : 70;
  while (drops.length < want) {
    drops.push({
      x: rng.float() * (R.W + 40) - 20, y: rng.float() * R.H,
      v: snow ? 0.4 + rng.float() * 0.5 : 3.2 + rng.float() * 2.2,
      d: snow ? (rng.float() - 0.5) * 0.5 : -1.1,
      p: rng.float() * 6.28, f: Math.floor(rng.float() * 4),
    });
  }
  while (drops.length > want) drops.pop();

  const img = Atlas.tryGet(snow ? 'fx.snow' : 'fx.rain', 0);
  for (const d of drops) {
    d.y += d.v;
    d.x += d.d + (snow ? Math.sin(d.p += 0.04) * 0.4 : 0);
    if (d.y > R.H) { d.y = -6; d.x = rng.float() * (R.W + 40) - 20; }
    if (d.x < -20) d.x = R.W + 10;
    if (img) R.blit(img, d.x, d.y, { alpha: snow ? 0.85 : 0.6 });
    else R.rect(d.x, d.y, 1, snow ? 1 : 4, snow ? '#eef6ff' : '#9fc9e8');
  }
  if (S.clock.weather === 'storm' && rng.float() < 0.006) R.flash('#dfe8ff', 4);
}

/** Warm pools of light under lit lamps and windows once the sun is down. */
export function drawNightGlow(map, cam) {
  if (!isNight() || map?.indoor) return;
  // Deliberately gentle. A lamp should pool warmth on the ground, not bleach
  // whatever is standing under it.
  const deep = S.clock.hour >= 21 || S.clock.hour < 5;
  const a = deep ? 0.20 : 0.13;
  for (const p of map.findTag('lamp')) {
    // Pool the light on the ground BELOW the lamp, wide and soft. Centring a tight,
    // strong glow on the fitting itself just blows the fitting out to white.
    const x = p.x * 16 + 8 - cam.x, y = p.y * 16 + 18 - cam.y;
    if (x < -50 || y < -50 || x > R.W + 50 || y > R.H + 50) continue;
    R.glow(x, y, 38, `rgba(255,204,128,${a})`, 0.5);
  }
  for (const st of map.structures || []) {
    const x = (st.x + st.w / 2) * 16 - cam.x, y = (st.y - st.overhang / 2) * 16 - cam.y;
    if (x < -60 || y < -60 || x > R.W + 60 || y > R.H + 60) continue;
    R.glow(x, y, 22, 'rgba(255,190,104,0.26)', 0.5);
  }
}

/** Which lamp art to use — the lit variant only after dark. */
export const lampTile = () => (isNight() ? 't.lamp.lit' : 't.lamp');

export function register() {
  // Weather should already match the season on a fresh save.
  if (!S.clock.weather) rollWeather();
}
