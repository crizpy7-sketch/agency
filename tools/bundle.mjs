// Bundles the game into one self-contained HTML file.
//
//   node tools/bundle.mjs [out.html]
//
// Concatenating the modules is not an option: several of them define their own
// `ellipse`, `fill`, `px`, and `register`, so flattening would collide. Instead each
// module is embedded as source, turned into a Blob URL at runtime, and its import
// specifiers are rewritten to point at the blobs. That keeps real ES module
// semantics — one scope per module, live bindings, working `export let` — with no
// renaming and no build step.
//
// Module references are found by scanning for relative '.js' string literals, which
// catches static imports, dynamic imports, and main.js's soft() call sites alike.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';

const ROOT = resolve('.');
const SRC = join(ROOT, 'hearth/src');
const ENTRY = join(SRC, 'main.js');
const OUT = resolve(process.argv[2] || 'guardians-of-the-hearth.html');

const REF = /(['"])(\.\.?\/[^'"]*\.js)\1/g;

const modules = new Map();   // abs path -> { code, deps: Map<specifier, absPath> }

async function collect(abs) {
  if (modules.has(abs)) return;
  let code;
  try { code = await readFile(abs, 'utf8'); }
  catch { modules.set(abs, null); return; }        // optional module, not present
  const deps = new Map();
  modules.set(abs, { code, deps });
  for (const m of code.matchAll(REF)) {
    const spec = m[2];
    const dep = resolve(dirname(abs), spec);
    deps.set(spec, dep);
    await collect(dep);
  }
}

// Depth-first post-order: a module is emitted only after everything it references,
// so every specifier already has a blob URL by the time we rewrite it.
function order() {
  const out = [], seen = new Set(), stack = new Set();
  const visit = abs => {
    if (seen.has(abs) || !modules.get(abs)) return;
    if (stack.has(abs)) return;                    // cycle: leave for the runtime
    stack.add(abs);
    for (const dep of modules.get(abs).deps.values()) visit(dep);
    stack.delete(abs);
    seen.add(abs);
    out.push(abs);
  };
  visit(ENTRY);
  return out;
}

const run = async () => {
  await collect(ENTRY);
  const list = order();
  const missing = [...modules.entries()].filter(([, v]) => !v).map(([k]) => relative(SRC, k));

  // main.js soft-imports optional modules and classifies a 404 as "not built".
  // Blob URLs cannot resolve a bare relative specifier, so leaving an absent
  // module's specifier alone turns a clean "missing" into a hard TypeError.
  // Emitting a stub that throws a 404 reproduces the served behaviour exactly.
  const absent = [...modules.entries()].filter(([, v]) => !v).map(([k]) => k);
  const idOf = abs => relative(SRC, abs).split('\\').join('/');
  const payload = [
    ...absent.map(abs => ({
      id: idOf(abs),
      code: `throw new Error(${JSON.stringify(`404 (Not Found): ${idOf(abs)} is not bundled`)});`,
      deps: {},
    })),
    ...list.map(abs => ({
      id: idOf(abs),
      code: modules.get(abs).code,
      deps: Object.fromEntries([...modules.get(abs).deps].map(([spec, d]) => [spec, idOf(d)])),
    })),
  ];

  const html = await readFile(join(ROOT, 'hearth/index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('<script type="module">'));

  const boot = `<script>
// --- inlined modules -------------------------------------------------------
// Each entry is one source file. They are realised in dependency order as Blob
// URLs, with relative specifiers rewritten to the URL of the module they name.
const MODULES = ${JSON.stringify(payload)};
const URLS = Object.create(null);
const REF = /(['"])(\\.\\.?\\/[^'"]*\\.js)\\1/g;

for (const m of MODULES) {
  const code = m.code.replace(REF, (whole, q, spec) => {
    const target = m.deps[spec];
    return target && URLS[target] ? q + URLS[target] + q : whole;
  });
  URLS[m.id] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}
window.__MODULE_URLS = URLS;
</script>
<script type="module">
  const veil = document.getElementById('veil');
  const bar = document.querySelector('#bar i');
  const hint = document.getElementById('veilHint');
  const startBtn = document.getElementById('startBtn');
  const crash = document.getElementById('crash');
  const crashBody = document.getElementById('crashBody');

  window.__boot = { step:'init', pct:0, ready:false, error:null };
  window.__setBoot = (step, pct) => {
    window.__boot.step = step; window.__boot.pct = pct;
    bar.style.width = pct + '%'; hint.textContent = step;
  };

  veil.addEventListener('transitionend', () => {
    if (veil.classList.contains('gone')) veil.classList.add('hidden');
  });

  function fail(err) {
    window.__boot.error = String(err && err.stack || err);
    crash.classList.add('on');
    crashBody.textContent = window.__boot.error;
    veil.classList.add('gone');
  }
  window.addEventListener('error', e => fail(e.error || e.message));
  window.addEventListener('unhandledrejection', e => fail(e.reason));

  if (matchMedia('(hover: none) and (pointer: coarse)').matches) document.body.classList.add('touch');

  try {
    const { boot } = await import(window.__MODULE_URLS['main.js']);
    await boot({ veil, startBtn, setBoot: window.__setBoot });
  } catch (err) { fail(err); }
</script>
</body>
</html>
`;

  await writeFile(OUT, head + boot);
  const kb = Math.round((await readFile(OUT)).length / 1024);
  console.log(`bundled ${list.length} modules → ${relative(ROOT, OUT)} (${kb} KB)`);
  if (missing.length) console.log(`  (not present, skipped: ${missing.join(', ')})`);
};

run().catch(e => { console.error(e); process.exit(1); });
