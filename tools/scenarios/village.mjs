// Village scenarios — most importantly the transformation pair, which is the
// claim the whole village system has to earn: the same ground, at level 1 and
// after the player has built it out, from the same camera.

const SETTLE = 24;

// Puts the player on the plaza so both halves of the pair frame identically.
async function standOnPlaza(a) {
  await a.eval(async () => {
    const V = window.__village;
    const h = V.hearth();
    await window.__game.mods.world.overworld.enterMap('village', h.x + 1, h.y + 5, 'up', { fade: false });
  });
  await a.frames(SETTLE);
}

async function buildOut(a) {
  await a.eval(() => {
    const V = window.__village;
    const S = window.__game.state;
    S.coins = 99999; S.hearth = 9999;
    // Enough finished missions that the mission-gated buildings unlock too.
    S.missions.done = ['cook-together', 'set-the-table', 'bake-something', 'tidy-together',
      'read-aloud', 'walk-outside', 'thank-you-note', 'water-plants']
      .map(id => ({ id, at: Date.now() }));

    const plots = V.plotList();
    const wanted = ['cottage', 'kitchen', 'garden', 'workshop', 'library',
                    'market', 'infirmary', 'cottage', 'bathhouse', 'belltower', 'fountain'];
    let pi = 0;
    for (const type of wanted) {
      // Walk the plot list until one actually validates for this footprint.
      for (let tries = 0; tries < plots.length; tries++) {
        const p = plots[(pi + tries) % plots.length];
        if (V.validate(type, p.x, p.y, { map: null }).ok) {
          const b = V.place(type, p.x, p.y, { free: true });
          if (b) {
            const def = V.cache && null;
            // Take it up to its top tier so the roofs and trimmings all show.
            for (let k = 0; k < 3; k++) V.upgrade(b);
          }
          pi = (pi + tries + 1) % plots.length;
          break;
        }
      }
    }
    V.invalidate();
    V.recompute({ celebrate: false });
    S.village.level = V.level();
    return { level: V.level(), built: S.village.buildings.length };
  });
  await a.frames(SETTLE);
}

export const SCENARIOS = {
  // The headline comparison.
  async transformation(a) {
    await a.open('scene=overworld&save=fresh');
    await standOnPlaza(a);
    const before = await a.eval(() => ({
      level: window.__village.level(),
      built: window.__game.state.village.buildings.length,
    }));
    await a.shot('before-level-' + before.level, { note: `village level ${before.level}, ${before.built} buildings` });

    await buildOut(a);
    const after = await a.eval(() => ({
      level: window.__village.level(),
      built: window.__game.state.village.buildings.length,
    }));
    await a.shot('after-level-' + after.level, { note: `village level ${after.level}, ${after.built} buildings` });

    // And the same pair at night, when lamps and windows should be doing work.
    await a.eval(() => window.__game.setClock(21));
    await a.frames(16);
    await a.shot('after-night', { note: 'the built-out village after dark' });

    await a.eval(() => window.__game.setSeason('autumn'));
    await a.eval(() => window.__game.setClock(12));
    await a.frames(16);
    await a.shot('after-autumn', { note: 'the built-out village in autumn' });
  },

  async board(a) {
    await a.open('scene=village');
    await a.shot('build-tab', { note: 'costs, lock reasons, per-tier preview' });
    await a.press('down'); await a.press('down');
    await a.shot('build-scrolled');
    await a.press('right');
    await a.shot('upgrade-tab');
    await a.press('right');
    await a.shot('village-tab', { note: 'progress toward the next level' });
  },

  async placing(a) {
    await a.open('scene=overworld&save=fresh');
    await a.eval(() => { window.__game.state.coins = 9999; window.__game.state.hearth = 999; });
    await a.eval(() => window.__game.push('build', { type: 'cottage' }));
    await a.frames(20);
    await a.shot('ghost-valid', { note: 'green footprint, ghost of the real building' });
    await a.press('up', 3); await a.press('up', 3); await a.press('up', 3);
    await a.press('up', 3); await a.press('up', 3); await a.press('up', 3);
    await a.shot('ghost-blocked', { note: 'red where it will not fit' });
  },
};
