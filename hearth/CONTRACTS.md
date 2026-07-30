# Guardians of the Hearth — Architecture & Module Contracts

**This file is the source of truth.** Every builder must read it before writing code and must
not change another module's public API without updating this file in the same commit.

## Non-negotiables

1. **Zero build step.** Native ES modules, no bundler, no npm deps at runtime. Opens from a
   plain static server (`node tools/serve.mjs`) and from GitHub Pages at `/hearth/`.
2. **No external assets.** No image, audio, or font files. All art is generated at boot from
   compact data (palettes + pixel rows + procedural painters). All audio is WebAudio.
   Rationale: original identity by construction, tiny payload, diffable art.
3. **Original identity.** Never reference or reproduce protected names, characters, maps,
   music, or sprites. Our creatures, places, and songs are ours.
4. **60 fps, fixed timestep.** Logic runs at exactly 60 Hz; rendering interpolates.
   Never allocate per-frame in hot paths (no array/object churn inside draw loops).
5. **Pixel-perfect.** Internal resolution 320×180, integer-scaled. All blits at integer
   coordinates. `imageRendering: pixelated`.
6. **Everything is saveable.** Any new persistent state goes through `state.js` and must
   survive `save()` → reload → `load()`.
7. **Touch + keyboard + gamepad** all work. Mobile Safari is a target.

## Layout

```
hearth/
  index.html            boot page, canvas, touch controls, loading veil
  src/
    main.js             boot sequence, scene registration, top-level error net
    state.js            the single mutable game state + save/load schema
    core/
      loop.js           fixed-timestep game loop
      input.js          keyboard/gamepad/touch -> logical buttons
      renderer.js       layered pixel renderer, camera, screen effects
      scene.js          scene stack (push/pop/replace)
      audio.js          procedural music + sfx engine
      rng.js            seeded RNG
      events.js         tiny event bus
      util.js           lerp/clamp/dirs/grid helpers
    art/
      atlas.js          offscreen sprite registry (define -> build -> get)
      palette.js        named colors, biome ramps, day/night tint tables
      tiles.js          all terrain/building/decor tile painters
      sprites.js        player, NPC, and effect sprites
      creatures.js      guardian sprite painters (one per species)
    world/
      maps.js           map data (string rows + legend)
      legend.js         char -> {ground, over, collide, tag} mapping
      map.js            runtime map object: lookup, collision, autotile
      npc.js            NPC definitions, pathing, interaction
      daynight.js       clock, seasons, weather, lighting
      overworld.js      Overworld scene: movement, camera, encounters, warps
    battle/
      species.js        guardian species, stats, learnsets, evolutions
      moves.js          move data + effects
      engine.js         pure turn resolution (no rendering, unit-testable)
      scene.js          Battle scene: presentation, menus, animations
      capture.js        bonding (capture) math + animation hooks
    village/
      buildings.js      building defs, tiers, costs, unlocks, footprints
      village.js        build/upgrade logic + visible transformation
      buildui.js        build-mode overlay scene
      economy.js        currencies, ledger
    missions/
      missions.js       real-world family mission catalogue + tracking
      missionui.js      mission board scene
    ui/
      textbox.js        dialogue box, typewriter, choices
      menu.js           list/grid menus, cursor, panels
      hud.js            overworld HUD, toasts, minimap
      transition.js     scene transitions (fade, iris, battle swirl)
      party.js          party/summary/box screens
      frame.js          9-slice window frames (shared UI chrome)
  tests/
    *.spec.mjs          Playwright specs (see tools/README)
```

## Ownership (who may write which files)

| Piece | Owner files |
|---|---|
| foundation | `index.html`, `main.js`, `state.js`, `core/**`, `dev/**`, **`art/names.js`** |
| art | `art/**` except `names.js` |
| world | `world/**` |
| battle | `battle/**` |
| village | `village/**`, `missions/**` |
| ui | `ui/**` |

A builder may **read** anything but only **write** its own files. Cross-module needs are
requested by editing this file's contract section and telling the lead.

### Never import across pieces — use `core/bridge.js`

`bridge.js` holds `UIx` (dialogue, toasts, transitions, panels) and `Hooks` (village,
missions, battle, world, party) with safe no-op defaults. Each piece calls
`UIx.install({…})` / `Hooks.install('village', {…})` inside its `register()`. Callers get
a working stub until the real thing lands, so a half-built piece can never break another.

Foundation ships `dev/minimal-ui.js`, a real (if plain) typewriter box, choice prompt,
toast, and fade, installed only when `ui/textbox.js` hasn't. So `await UIx.say('hi')`
works from the first commit.

Every feature module exports `register()`. `main.js` soft-imports the module and calls it.
`register()` is where you `Scenes.register(...)`, `UIx.install(...)`, `Hooks.install(...)`,
and (for art) `Atlas.define(...)`.

## Core contracts

### `core/loop.js`
```js
startLoop({ update, render })  // update(dt=1/60 fixed, tick), render(alpha)
Loop.tick     // integer frames since boot, monotonic
Loop.paused
```

### `core/input.js`
Logical buttons: `up down left right a b start select run`.
```js
Input.held(btn) -> bool
Input.pressed(btn) -> bool   // true only on the frame it went down
Input.released(btn) -> bool
Input.axis() -> {x,y}        // -1..1, 4-way snapped for grid movement
Input.dir() -> 'up'|'down'|'left'|'right'|null  // held direction, latest wins
Input.consume(btn)           // swallow a press so two systems don't both react
Input.anyPressed() -> bool
```
`a` = confirm/interact (Z / Space / Enter / tap), `b` = cancel/run-hold (X / Shift),
`start` = menu (Enter on title, Esc), `select` = quick village view (Tab).

### `core/renderer.js`
```js
R.W = 320; R.H = 180              // internal resolution
R.ctx                             // main 2D context (do not resize)
R.clear(color?)
R.blit(canvas, x, y, opts?)       // opts: {flipX, alpha, tint, clip:{x,y,w,h}}
R.rect(x,y,w,h,color)  R.text(str,x,y,opts)   // opts: {color,shadow,align,font}
R.camera = {x, y}                 // world px of top-left; renderer floors it
R.worldToScreen(wx,wy) -> [sx,sy]
R.layer(n, fn)                    // n: 0 ground 1 mid 2 entity 3 over 4 weather 5 ui
R.shake(px, frames)   R.flash(color, frames)   R.tintScreen(color, alpha)
R.setLetterbox(on)
```
Scenes draw by calling `R.layer(...)` inside their `render`. Entity layer is y-sorted
automatically: `R.sortEntity(y, fn)`.

### `core/scene.js`
```js
Scenes.register(name, sceneFactory)
Scenes.push(name, params?)  Scenes.pop(result?)  Scenes.replace(name, params?)
Scenes.top  Scenes.stack
// A scene object: { enter(params), exit(), update(dt), render(alpha),
//                   pausesBelow?: bool (default true), drawsBelow?: bool (default false) }
```
`await Scenes.pushAsync(name, params)` resolves with the value passed to `pop()`.

### `core/audio.js`
```js
Audio.init()                       // must be called from a user gesture
Audio.play(songName, {loop:true})  Audio.stop() Audio.duck(ms)
Audio.sfx(name, {rate, gain})
Audio.defineSong(name, spec)  Audio.defineSfx(name, spec)
Audio.muted  Audio.setVolume(0..1)
```
Song spec: `{ bpm, loop:[bar…], tracks:{ lead:{wave,env,notes:"…"}, … } }`
Notes are a compact string: `c4 e4 g4 - .` (`-` sustain, `.` rest, `~` slide).

### `art/atlas.js`
```js
Atlas.define(name, w, h, painter)              // painter(ctx, w, h)
Atlas.defineAnim(name, w, h, frameCount, painter)  // painter(ctx, w, h, frame)
Atlas.get(name, frame=0) -> HTMLCanvasElement  // throws on unknown name (fail loud)
Atlas.has(name)
Atlas.build()                                  // realize every definition once
Atlas.recolor(name, mapFn) -> name'            // derived variant, cached
```
Painters run once at boot. Use `Px(ctx, rows, palette, scale=1)` from `art/palette.js`
to stamp pixel-row art. **Every tile is 16×16.** Characters are 16×24 with the origin at
the bottom-centre. Guardian battle sprites are 64×64.

### `art/palette.js`
```js
P.<name>            // hex strings, e.g. P.grass1
RAMP.grass -> [..]  // ordered light->dark ramps for shading
Px(ctx, rows, palette)          // rows: array of strings, palette: {char: color}
tintFor(hour, season, weather) -> {color, alpha, mode}
```

### `world/map.js`
```js
loadMap(id) -> Map
Map: { id, w, h, ground(x,y), over(x,y), tag(x,y), solid(x,y) -> bool,
       warpAt(x,y), npcs, encounterTable(x,y), music, indoor, bounds }
```
Maps are authored in `maps.js` as arrays of equal-length strings plus a per-map legend
override; `legend.js` holds the shared legend. Autotiling for grass/water/cliff edges is
computed in `map.js` at load, not authored by hand.

### `battle/engine.js` (pure, no DOM)
```js
newBattle({ party, foe, kind }) -> B
chooseAction(B, side, action)   // {type:'move',id} | {type:'switch',i} | {type:'item',id} | {type:'bond'} | {type:'run'}
stepTurn(B) -> Event[]          // ordered, presentation-agnostic events
// Event kinds: 'text','damage','faint','stat','status','switch','bond-try','bond-ok',
//              'bond-fail','xp','levelup','evolve','end'
```
The battle scene consumes `Event[]` and animates them. Engine must be deterministic given
`B.rng`. Unit-testable in node with no browser.

### `state.js`
```js
S                       // the live state object
save() load() resetSave() exportSave() importSave(json)
S.version               // bump + write a migration when the schema changes
```
Shape (grow it, never rename without a migration):
```js
{ version, seed, player:{name,x,y,map,dir,sprite}, party:[], box:[], bag:{},
  coins, hearth, flags:{}, seen:{}, village:{buildings:[],unlocked:[]},
  missions:{active:[],done:[],streak,lastDay}, clock:{day,hour,minute,season},
  settings:{volume,muted,speed,scale} }
```

### `art/names.js` — the canonical sprite registry (foundation-owned)

Art paints these names; world/village/battle/ui reference them. **Neither side invents a
name the other doesn't know.** It also pins the guardian roster, the character cast, and
the building footprints so all four pieces can be built in parallel. Read it first.

Autotiled families register `t.<fam>.m<0..15>`; mask bits are `1=N 2=E 4=S 8=W`, set when
the neighbour is the same family. `m15` is the enclosed centre tile.

### `ui/*` public API — consumers code against this before it exists

```js
// ui/textbox.js
say(text, opts?) -> Promise<void>      // typewriter box; A advances; opts {speaker, portrait, sfx, speed}
sayMany(lines, opts?) -> Promise<void>
ask(text, choices, opts?) -> Promise<number>    // choices: string[]; returns index, -1 on cancel
confirm(text) -> Promise<boolean>
Textbox.busy -> bool
// ui/frame.js
Frame.panel(x, y, w, h, style?)        // style: 'paper'|'dark'|'gold'; draws the 9-slice
Frame.bubble(x, y, w, h, tailX?)
Frame.bar(x, y, w, value, max, colorSet)   // hp/xp bars with the pixel end-caps
// ui/menu.js
new Menu({ items, x, y, w, cols?, onPick, onCancel, onMove, render? })
menu.update(); menu.render(); menu.index; menu.setItems(items)
// ui/hud.js
HUD.toast(text, { icon, ms })          // stacked, non-blocking
HUD.drawOverworld()                    // clock, coins, hearth, party pips, minimap
// ui/transition.js
Transition.fade(dir, frames?) -> Promise      // dir: 'out'|'in'
Transition.iris(dir, cx, cy) -> Promise
Transition.battle() -> Promise                 // the pre-battle flourish
Transition.doorway(dir) -> Promise
Transition.active -> bool
```

**Text-on-panel convention:** on light paper panels draw text with `color: P.ink2` and
`shadow: false` (or `shadow: P.paper0`). On dark panels use `color: P.ui0` with the default
dark shadow. Light-on-light is the single most common readability bug — don't ship it.

## Quality bar (what critics judge against)

Exploration & feel — Pokémon FireRed/LeafGreen: instant response to input, grid movement
that feels crisp not sluggish, world readability at a glance (you always know what is
walkable), tree canopies and roofs that overlap the player, doors that feel like doors,
NPCs that face you, text that types at a satisfying rate and never wraps badly.

Village — Littlewood: you always know what to build next, costs are legible, placing a
building is tactile, and the village *visibly* transforms — new roofs, banners, paths,
NPCs, lighting. Upgrades show a clear before/after.

Charm — the reference board: warm palette, soft outlines, expressive creatures, day/night
and seasons that change the mood, and a family-mission loop that feels kind, not naggy.
