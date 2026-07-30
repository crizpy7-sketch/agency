// UI scenarios: the things that are only judgeable by looking at them.

export const SCENARIOS = {
  async ui(a) {
    await a.open('scene=overworld&save=fresh');
    await a.frames(20);
    await a.shot('hud', { note: 'HUD over the world: clock, season, coins, hearth, minimap' });

    // Walk up to the Mayor and talk — real dialogue, real portrait.
    await a.eval(() => {
      const S = window.__game.state;
      S.party = [];
      return window.__game.mods.world.overworld.enterMap('village', 22, 22, 'up', { fade: false });
    });
    await a.frames(12);
    await a.press('a');
    await a.frames(30);
    await a.shot('dialogue', { note: 'speaker nameplate, portrait, typewriter mid-line' });
    await a.frames(90);
    await a.shot('dialogue-typed', { note: 'fully typed, advance chevron showing' });

    // A choice prompt.
    await a.eval(() => window.__game.mods.ui.textbox && null);
    await a.eval(async () => {
      const { UIx } = await import('/hearth/src/core/bridge.js');
      UIx.ask('Did you do it together?', ['Yes, we did', 'Not yet'], { speaker: 'Gran Willow' });
    });
    await a.frames(70);
    await a.shot('choice', { note: 'choice list with cursor' });
    await a.press('b');
    await a.frames(16);

    // The battle flourish, caught mid-way.
    await a.eval(async () => {
      const { Transition } = await import('/hearth/src/ui/transition.js');
      Transition.battle();
    });
    await a.frames(12);
    await a.shot('battle-fx-early', { note: 'ember rings rushing out' });
    await a.frames(14);
    await a.shot('battle-fx-mid', { note: 'the world burning away' });
    await a.frames(40);
  },

  async hudnight(a) {
    await a.open('scene=overworld');
    await a.eval(() => window.__game.setClock(21));
    await a.eval(() => window.__game.setWeather('rain'));
    await a.frames(30);
    await a.shot('hud-night-rain', { note: 'HUD legibility at night in rain' });
  },
};
