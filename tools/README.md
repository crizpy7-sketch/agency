# Tooling

## Serve the game
    node tools/serve.mjs 8123 .      # http://127.0.0.1:8123/hearth/

## Capture the real game (screenshots + errors + fps)
    node tools/shoot.mjs list
    node tools/shoot.mjs tour --out shots/tour
    node tools/shoot.mjs overworld --scale 4 --video
    node tools/shoot.mjs smoke --out /tmp/x

Writes numbered PNGs plus `report.json` (shots, scene names, fps, console errors,
`notBuilt` = soft-imported modules that don't exist yet).
`--native` shots (set per-shot in the scenario) are the raw 320x180 canvas for pixel diffs.

## URL parameters (all work on the deployed build too)
| param | effect |
|---|---|
| `?scene=NAME` | boot straight into a scene (`overworld`, `battle`, `village`, `missions`, `party`, `smoke`) |
| `?dev=1` | fps / scene / position / atlas overlay |
| `?autostart=1&nogate=1` | skip the press-to-begin gate (tests use this) |
| `?save=fresh` | ignore any saved game |
| `?seed=N` | fix the RNG seed |

## Test hooks (`window.__game`)
`state`, `scene`, `stack`, `tick`, `fps`, `boot`, `atlas`, `press(btn,frames)`,
`goto(scene)`, `push/pop`, `save/load/resetSave`, `setClock(h)`, `setSeason(s)`,
`setWeather(w)`, `sprite(name)` -> dataURL, `mute()`.
Plus `window.__frames(n)` to await N rendered frames deterministically.

## Build the single-file version
    node tools/bundle.mjs guardians-of-the-hearth.html

Emits one self-contained HTML file: no server, no network, no assets. Each module
is embedded as source and realised as a Blob URL in dependency order, with import
specifiers rewritten to point at the blobs — so real ES module semantics are kept
(one scope per module, live bindings) without flattening, which would collide since
several modules define their own `ellipse`, `fill`, and `register`.

Verified to run identically from `http://` and from `file://` (double-click).
