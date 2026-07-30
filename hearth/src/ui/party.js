// Party, summary, and records.
//
// Also implements Hooks.party, which is how the battle screen asks the player to
// pick a Guardian — so this has to be fast to read and fast to answer.

import { R, LAYER } from '../core/renderer.js';
import { Input } from '../core/input.js';
import { Scenes } from '../core/scene.js';
import { Atlas } from '../art/atlas.js';
import { Audio } from '../core/audio.js';
import { UIx, Hooks } from '../core/bridge.js';
import { Font } from '../core/font.js';
import { S } from '../state.js';
import { P, TYPE_COLOR, mix, shade } from '../art/palette.js';
import { clamp } from '../core/util.js';
import { GUARDIANS } from '../art/names.js';
import { getSpecies, displayName, speciesName, makeGuardian } from '../battle/species.js';

const hpFrac = g => g && g.maxhp ? clamp(g.hp / g.maxhp, 0, 1) : 0;
const hpColor = f => f > 0.5 ? P.hpGood : f > 0.22 ? P.hpWarn : P.hpBad;

function typeChip(x, y, ty) {
  const b = Atlas.tryGet(`ui.type.${ty}`);
  if (b) R.blit(b, x, y);
  else R.rect(x, y, 22, 9, TYPE_COLOR[ty] || P.ui2);
  R.text(ty.slice(0, 3).toUpperCase(), x + 11, y + 1,
    { color: '#fffaf0', shadow: shade(TYPE_COLOR[ty] || P.ui2, -0.55), align: 'center' });
}

// ------------------------------------------------------------------ party list
function partyScene(params) {
  const picking = !!params?.picking;
  let sel = 0, t = 0, busy = false;

  const party = () => (params?.party || S.party);

  async function act() {
    const list = party();
    const g = list[sel];
    if (!g) return;
    if (picking) { Scenes.pop(sel); return; }
    busy = true;
    try {
      const i = await UIx.ask(displayName(g), ['Summary', 'Move up', 'Back']);
      if (i === 0) await Scenes.pushAsync('summary', { g });
      else if (i === 1 && sel > 0) {
        [list[sel - 1], list[sel]] = [list[sel], list[sel - 1]];
        sel--; Audio.sfx('confirm');
      }
    } finally { busy = false; }
  }

  return {
    update() {
      t++;
      if (busy || UIx.busy) return;
      const list = party();
      if (Input.pressed('b')) { Audio.sfx('cancel'); Scenes.pop(picking ? -1 : undefined); return; }
      if (list.length) {
        if (Input.pressed('down')) { sel = (sel + 1) % list.length; Audio.sfx('cursor'); }
        if (Input.pressed('up')) { sel = (sel + list.length - 1) % list.length; Audio.sfx('cursor'); }
      }
      if (Input.pressed('a')) act();
    },
    render() {
      const list = party();
      R.layer(LAYER.GROUND, () => {
        for (let y = 0; y < R.H; y++) R.rect(0, y, R.W, 1, mix('#1b2233', '#2a2036', y / R.H));
      });
      R.layer(LAYER.UI, () => {
        R.text(picking ? 'CHOOSE A GUARDIAN' : 'YOUR GUARDIANS', 8, 6, { color: P.gold1 });
        if (!list.length) {
          UIx.panel(30, 60, R.W - 60, 50, 'paper');
          R.text('No Guardians yet.', R.W / 2, 72, { color: P.ink2, shadow: false, align: 'center' });
          R.text('Gran Willow has one waiting for you.', R.W / 2, 86, { color: P.ink3, shadow: false, align: 'center' });
        }
        list.slice(0, 6).forEach((g, i) => {
          const col = i % 2, row = Math.floor(i / 2);
          const x = 8 + col * 152, y = 22 + row * 44;
          const on = i === sel;
          UIx.panel(x, y, 146, 40, 'paper');
          if (on) R.stroke(x - 1, y - 1, 148, 42, P.gold2);
          const ow = Atlas.tryGet(`g.${g.species}.ow`, Math.floor(t / 24) % 2);
          if (ow) R.blit(ow, x + 5, y + 12);
          R.text(displayName(g), x + 24, y + 4, { color: g.hp > 0 ? P.ink2 : P.ui2, shadow: false });
          R.text(`Lv ${g.lvl}`, x + 140, y + 4, { color: P.ink3, shadow: false, align: 'right' });
          (g.types || []).forEach((ty, k) => typeChip(x + 24 + k * 25, y + 15, ty));
          const f = hpFrac(g);
          R.rect(x + 24, y + 28, 88, 5, P.ui1);
          R.rect(x + 24, y + 28, Math.round(88 * f), 5, hpColor(f));
          R.text(`${g.hp}/${g.maxhp}`, x + 140, y + 27, { color: P.ink3, shadow: false, align: 'right' });
          if (on) {
            const c = Atlas.tryGet('ui.cursor');
            if (c) R.blit(c, x - 8, y + 16 + Math.sin(t / 8) * 0.6);
          }
        });
        R.rect(0, R.H - 12, R.W, 12, 'rgba(16,12,20,0.8)');
        R.text(picking ? 'A choose    B cancel' : 'A options    B back', 6, R.H - 10, { color: P.ui1 });
      });
    },
  };
}

// --------------------------------------------------------------------- summary
function summaryScene(params) {
  const g = params?.g || S.party[0] || makeGuardian('embercub', 5);
  let t = 0;
  const sp = getSpecies(g.species);

  return {
    update() {
      t++;
      if (Input.pressed('b') || Input.pressed('a')) { Audio.sfx('cancel'); Scenes.pop(); }
    },
    render() {
      R.layer(LAYER.GROUND, () => {
        for (let y = 0; y < R.H; y++) R.rect(0, y, R.W, 1, mix('#1b2233', '#2a2036', y / R.H));
      });
      R.layer(LAYER.UI, () => {
        UIx.panel(6, 6, 118, R.H - 24, 'paper');
        const img = Atlas.tryGet(`g.${g.species}.front`);
        if (img) R.blit(img, 28, 12 + Math.sin(t / 30) * 1.5);
        R.text(displayName(g), 65, 82, { color: P.ink, shadow: false, align: 'center' });
        R.text(`Lv ${g.lvl}`, 65, 94, { color: P.ink3, shadow: false, align: 'center' });
        (g.types || []).forEach((ty, k) => typeChip(42 + k * 25, 106, ty));
        const f = hpFrac(g);
        R.rect(18, 122, 94, 6, P.ui1);
        R.rect(18, 122, Math.round(94 * f), 6, hpColor(f));
        R.text(`${g.hp} / ${g.maxhp}`, 65, 132, { color: P.ink3, shadow: false, align: 'center' });
        if (sp?.flavour) {
          let y = 144;
          for (const l of Font.wrap(sp.flavour, 106).slice(0, 2)) {
            R.text(l, 12, y, { color: P.ui2, shadow: false }); y += 9;
          }
        }

        UIx.panel(130, 6, R.W - 136, 78, 'paper');
        const stats = [['HP', g.maxhp], ['Attack', g.stats?.atk], ['Defence', g.stats?.def],
                       ['Sp. Atk', g.stats?.spa], ['Sp. Def', g.stats?.spd], ['Speed', g.stats?.spe]];
        stats.forEach(([k, v], i) => {
          const y = 11 + i * 11;
          R.text(k, 137, y, { color: P.ui2, shadow: false });
          R.text(String(v ?? '—'), 176, y, { color: P.ink2, shadow: false, align: 'right' });
          const bw = Math.round(clamp((v || 0) / 160, 0, 1) * 96);
          R.rect(182, y + 2, 96, 4, P.ui1);
          R.rect(182, y + 2, bw, 4, mix(P.gold2, P.leaf2, i / 6));
        });

        UIx.panel(130, 88, R.W - 136, R.H - 106, 'paper');
        R.text('Moves', 137, 92, { color: P.ui2, shadow: false });
        (g.moves || []).slice(0, 4).forEach((m, i) => {
          const y = 104 + i * 14;
          typeChip(137, y, m.type);
          R.text(m.name, 164, y, { color: P.ink2, shadow: false });
          R.text(`${m.focus}/${m.maxFocus ?? m.focus}`, R.W - 12, y, { color: P.ink3, shadow: false, align: 'right' });
        });
        R.rect(0, R.H - 12, R.W, 12, 'rgba(16,12,20,0.8)');
        R.text('B back', 6, R.H - 10, { color: P.ui1 });
      });
    },
  };
}

// --------------------------------------------------------------------- records
function dexScene() {
  let sel = 0, t = 0;
  const rows = GUARDIANS.map(g => ({ ...g, state: S.seen?.[g.id] || null }));

  return {
    update() {
      t++;
      if (Input.pressed('b')) { Audio.sfx('cancel'); Scenes.pop(); return; }
      if (Input.pressed('down')) { sel = (sel + 1) % rows.length; Audio.sfx('cursor'); }
      if (Input.pressed('up')) { sel = (sel + rows.length - 1) % rows.length; Audio.sfx('cursor'); }
      if (Input.pressed('right')) { sel = clamp(sel + 6, 0, rows.length - 1); Audio.sfx('cursor'); }
      if (Input.pressed('left')) { sel = clamp(sel - 6, 0, rows.length - 1); Audio.sfx('cursor'); }
    },
    render() {
      R.layer(LAYER.GROUND, () => {
        for (let y = 0; y < R.H; y++) R.rect(0, y, R.W, 1, mix('#1b2233', '#2a2036', y / R.H));
      });
      R.layer(LAYER.UI, () => {
        const bonded = rows.filter(r => r.state === 'bonded').length;
        const seen = rows.filter(r => r.state).length;
        R.text('RECORDS', 8, 6, { color: P.gold1 });
        R.text(`${bonded} bonded · ${seen} met · ${rows.length} known to exist`, R.W - 8, 6,
          { color: P.ui2, align: 'right' });

        const start = Math.max(0, Math.min(rows.length - 18, Math.floor(sel / 6) * 6 - 6));
        for (let i = 0; i < 18; i++) {
          const r = rows[start + i];
          if (!r) break;
          const x = 8 + (i % 6) * 51, y = 20 + Math.floor(i / 6) * 46;
          const on = start + i === sel;
          R.rect(x, y, 47, 42, on ? mix(P.gold2, '#1b2233', 0.55) : 'rgba(255,255,255,0.05)');
          if (on) R.stroke(x, y, 47, 42, P.gold2);
          const img = Atlas.tryGet(`g.${r.id}.front`);
          if (img) {
            if (r.state) R.blit(img, x - 8, y - 10, { w: 64, h: 64 });
            else R.silhouette(img, x - 8, y - 10, '#0e1420', 0.7);
          }
          R.text(r.state ? r.name.slice(0, 8) : '???', x + 23, y + 33,
            { color: r.state === 'bonded' ? P.gold0 : r.state ? P.ui1 : P.ui2, align: 'center' });
        }
        R.rect(0, R.H - 12, R.W, 12, 'rgba(16,12,20,0.8)');
        const cur = rows[sel];
        R.text(cur?.state ? `${cur.name} — ${cur.type}` : 'Not met yet', 6, R.H - 10, { color: P.ui1 });
      });
    },
  };
}

export function register() {
  Scenes.register('party', () => partyScene(Scenes.top?.__params));
  Scenes.register('summary', () => summaryScene(Scenes.top?.__params));
  Scenes.register('dex', () => dexScene());

  Hooks.install('party', {
    async openParty(opts) { return Scenes.pushAsync('party', opts); },
    async openSummary(g) { return Scenes.pushAsync('summary', { g }); },
    async chooseGuardian(opts) {
      return Scenes.pushAsync('party', { ...opts, picking: true });
    },
  });
}
