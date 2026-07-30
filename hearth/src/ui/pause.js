// The start-button menu. Its whole job is to get you somewhere else quickly and
// never crash on a piece that isn't there.

import { R, LAYER } from '../core/renderer.js';
import { Input } from '../core/input.js';
import { Scenes } from '../core/scene.js';
import { Atlas } from '../art/atlas.js';
import { Audio } from '../core/audio.js';
import { UIx, Hooks } from '../core/bridge.js';
import { Font } from '../core/font.js';
import { S, save } from '../state.js';
import { P, mix } from '../art/palette.js';
import { clockText, timeOfDay } from '../world/daynight.js';

const ITEMS = [
  { id: 'party', label: 'Guardians', scene: 'party', hint: 'Your team' },
  { id: 'village', label: 'Village', scene: 'village', hint: 'Build and upgrade' },
  { id: 'missions', label: 'Missions', scene: 'missions', hint: 'Family missions' },
  { id: 'dex', label: 'Records', scene: 'dex', hint: 'Guardians you have met' },
  { id: 'save', label: 'Save', hint: 'Keep your progress' },
  { id: 'settings', label: 'Settings', hint: 'Sound and text' },
  { id: 'close', label: 'Close', hint: '' },
];

function pauseScene() {
  let sel = 0, t = 0, busy = false;

  async function pick() {
    const it = ITEMS[sel];
    busy = true;
    try {
      Audio.sfx('confirm');
      if (it.id === 'close') { Scenes.pop(); return; }
      if (it.id === 'save') {
        save();
        UIx.toast('Progress kept', { ms: 1600 });
        return;
      }
      if (it.id === 'settings') { await settings(); return; }
      if (it.scene && Scenes.has(it.scene)) Scenes.push(it.scene);
      else await UIx.say('Not open yet.');
    } finally { busy = false; }
  }

  async function settings() {
    const i = await UIx.ask('Settings', [
      Audio.muted ? 'Sound: off' : 'Sound: on',
      `Text speed: ${['slow', 'normal', 'fast'][Math.max(0, Math.min(2, (S.settings.textSpeed || 2) - 1))]}`,
      'Back to title',
      'Back',
    ]);
    if (i === 0) { S.settings.muted = Audio.toggleMute(); await settings(); }
    else if (i === 1) { S.settings.textSpeed = ((S.settings.textSpeed || 2) % 3) + 1; await settings(); }
    else if (i === 2) {
      if (await UIx.confirm('Return to the title? Your progress is saved.')) {
        save();
        await UIx.fade('out', 14);
        Scenes.reset('title');
        await UIx.fade('in', 14);
      } else await settings();
    }
  }

  return {
    pausesBelow: true, drawsBelow: true,
    update() {
      t++;
      if (busy || UIx.busy) return;
      if (Input.pressed('b') || Input.pressed('start')) { Audio.sfx('cancel'); Scenes.pop(); return; }
      if (Input.pressed('down')) { sel = (sel + 1) % ITEMS.length; Audio.sfx('cursor'); }
      if (Input.pressed('up')) { sel = (sel + ITEMS.length - 1) % ITEMS.length; Audio.sfx('cursor'); }
      if (Input.pressed('a')) pick();
    },
    render() {
      R.layer(LAYER.UI, () => {
        R.rect(0, 0, R.W, R.H, 'rgba(10,8,14,0.35)');
        const w = 108, x = R.W - w - 6, y = 6, h = ITEMS.length * 15 + 10;
        UIx.panel(x, y, w, h, 'paper');
        ITEMS.forEach((it, i) => {
          const iy = y + 6 + i * 15;
          const on = i === sel;
          if (on) {
            R.rect(x + 4, iy - 2, w - 8, 13, mix(P.gold1, P.paper0, 0.5));
            const c = Atlas.tryGet('ui.cursor');
            if (c) R.blit(c, x - 3, iy + Math.sin(t / 8) * 0.6);
          }
          R.text(it.label, x + 12, iy, { color: on ? P.ink : P.ink3, shadow: false });
        });

        // A status card, so the menu also answers "where am I and how am I doing".
        const cy = y + h + 6, cw = w, ch = 56;
        UIx.panel(x, cy, cw, ch, 'paper');
        const rows = [
          [S.player.name, `Day ${S.clock.day}`],
          [clockText(), timeOfDay()],
          ['Coins', String(S.coins)],
          ['Hearth', String(S.hearth)],
          ['Village', `Lv ${safeLevel()}`],
        ];
        rows.forEach(([k, v], i) => {
          const ry = cy + 5 + i * 10;
          R.text(k, x + 8, ry, { color: P.ui2, shadow: false });
          R.text(v, x + cw - 8, ry, { color: P.ink2, shadow: false, align: 'right' });
        });

        const hint = ITEMS[sel]?.hint;
        if (hint) {
          R.rect(6, R.H - 14, R.W - 12, 12, 'rgba(20,16,12,0.7)');
          R.text(hint, 12, R.H - 12, { color: P.ui1 });
        }
      });
    },
  };
}

const safeLevel = () => { try { return Hooks.village.level(); } catch { return 1; } };

export function register() {
  Scenes.register('pause', () => pauseScene());
}
