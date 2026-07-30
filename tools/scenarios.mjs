// Capture scenarios. Each one drives the REAL game through the same inputs a player
// would use, then screenshots. Builders add scenarios for their piece; the `tour`
// scenario is the whole-experience regression pass every critic should run.

export const SCENARIOS = {
  // --- foundation ---
  async smoke(a) {
    await a.open('scene=smoke&dev=1');
    await a.shot('font', { native: true, note: 'pixel font + text box legibility' });
    await a.press('right'); await a.shot('palette', { note: 'palette ramps' });
    await a.press('right'); await a.shot('atlas', { note: 'every registered sprite' });
  },

  async boot(a) {
    await a.open('');
    await a.shot('title', { native: true });
  },

  // --- art ---
  async art(a) {
    await a.open('scene=smoke&dev=1');
    await a.press('right'); await a.press('right');
    await a.shot('atlas-all', { native: true, note: 'all sprites, animated frame' });
    await a.frames(20);
    await a.shot('atlas-anim', { note: 'second animation frame' });
  },

  // --- overworld ---
  async overworld(a) {
    await a.open('scene=overworld');
    await a.shot('spawn', { native: true, note: 'world readability at spawn' });
    await a.hold('down', 40); await a.shot('walk-down');
    await a.hold('right', 40); await a.shot('walk-right');
    await a.eval(() => window.__game.press('run', 60));
    await a.hold('up', 56); await a.shot('running');
    await a.press('a'); await a.shot('interact', { note: 'talking to whatever is in front' });
  },

  async daynight(a) {
    await a.open('scene=overworld');
    for (const [h, label] of [[7, 'dawn'], [12, 'noon'], [18, 'dusk'], [22, 'night']]) {
      await a.eval(hh => window.__game.setClock(hh), h);
      await a.frames(8);
      await a.shot(label, { note: `${h}:00 lighting` });
    }
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      await a.eval(ss => window.__game.setSeason(ss), s);
      await a.eval(() => window.__game.setClock(12));
      await a.frames(10);
      await a.shot('season-' + s);
    }
  },

  // --- battle ---
  async battle(a) {
    await a.open('scene=battle');
    await a.shot('open', { native: true, note: 'battle framing + HP bars' });
    await a.frames(60); await a.shot('intro-settled');
    await a.press('a'); await a.shot('menu');
    await a.press('a'); await a.shot('move-list');
    await a.press('a'); await a.frames(30); await a.shot('attack');
    await a.frames(90); await a.shot('turn-end');
  },

  // --- village ---
  async village(a) {
    await a.open('scene=village');
    await a.shot('village', { native: true, note: 'village legibility' });
    await a.press('a'); await a.shot('build-menu');
    await a.press('right', 6); await a.shot('placing');
    await a.press('a'); await a.frames(40); await a.shot('placed', { note: 'visible transformation' });
  },

  async missions(a) {
    await a.open('scene=missions');
    await a.shot('board', { native: true });
    await a.press('down'); await a.shot('second-mission');
    await a.press('a'); await a.frames(20); await a.shot('tracked');
  },

  // --- the whole experience ---
  async tour(a) {
    await a.open('');
    await a.shot('01-title', { native: true, note: 'first impression' });
    await a.press('a'); await a.frames(40);
    await a.shot('02-world', { native: true, note: 'overworld after start' });
    await a.hold('down', 30); await a.hold('right', 30);
    await a.shot('03-explore');
    await a.press('start'); await a.shot('04-menu');
    await a.press('b');
    for (const [scene, name] of [['village', '05-village'], ['missions', '06-missions'],
                                 ['party', '07-party'], ['battle', '08-battle']]) {
      await a.goto(scene);
      await a.frames(24);
      await a.shot(name, { note: scene });
    }
    await a.goto('overworld');
    await a.eval(() => window.__game.setClock(21));
    await a.frames(12);
    await a.shot('09-night', { note: 'night lighting' });
  },

  // Mobile framing check — the game must be playable on a phone.
  async phone(a) {
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.open('scene=overworld');
    await a.frames(10);
    await a.page.screenshot({ path: a.OUT + '/01-phone-portrait.png' });
    await a.page.setViewportSize({ width: 844, height: 390 });
    await a.frames(10);
    await a.page.screenshot({ path: a.OUT + '/02-phone-landscape.png' });
  },
};
