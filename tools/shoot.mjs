// Capture harness for the real, running game.
//
//   node tools/shoot.mjs <scenario> [--out DIR] [--scale 4] [--video] [--slowmo 0]
//   node tools/shoot.mjs list
//
// Every capture also records console errors, page errors, and fps so a "pretty" shot
// can never hide a broken build. Writes <out>/report.json.

import { chromium } from './pw.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { SCENARIOS as BASE } from './scenarios.mjs';
import { readdir } from 'node:fs/promises';

// Each piece owns tools/scenarios/<piece>.mjs so five builders never edit one file.
const SCENARIOS = { ...BASE };
try {
  const dir = new URL('./scenarios/', import.meta.url);
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.mjs')) continue;
    const m = await import(new URL(f, dir));
    Object.assign(SCENARIOS, m.SCENARIOS || {});
  }
} catch { /* no per-piece scenarios yet */ }

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? def : (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]);
};

const scenarioName = args[0] && !args[0].startsWith('--') ? args[0] : 'tour';
if (scenarioName === 'list') {
  console.log(Object.keys(SCENARIOS).join('\n'));
  process.exit(0);
}

const PORT = Number(flag('port', 8123));
const SCALE = Number(flag('scale', 4));
const OUT = resolve(String(flag('out', `shots/${scenarioName}`)));
const VIDEO = !!flag('video', false);
const SLOWMO = Number(flag('slowmo', 0));
const ROOT = resolve(flag('root', '.'));

async function ensureServer() {
  const url = `http://127.0.0.1:${PORT}/`;
  try {
    const r = await fetch(url + 'hearth/', { signal: AbortSignal.timeout(1200) });
    if (r.ok) return null;
  } catch { /* not running */ }
  const child = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT), ROOT], {
    stdio: 'ignore', detached: false,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 120));
    try { const r = await fetch(url + 'hearth/', { signal: AbortSignal.timeout(800) }); if (r.ok) return child; } catch {}
  }
  throw new Error('server did not come up');
}

const run = async () => {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`unknown scenario "${scenarioName}". try: ${Object.keys(SCENARIOS).join(', ')}`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = await ensureServer();

  const browser = await chromium.launch({
    executablePath: existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1',
           '--disable-lcd-text', '--hide-scrollbars'],
    slowMo: SLOWMO,
  });
  const ctx = await browser.newContext({
    viewport: { width: 320 * SCALE, height: 180 * SCALE },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    ...(VIDEO ? { recordVideo: { dir: join(OUT, 'video'), size: { width: 320 * SCALE, height: 180 * SCALE } } } : {}),
  });
  const page = await ctx.newPage();

  const report = { scenario: scenarioName, at: new Date().toISOString(), shots: [], errors: [], warnings: [], notBuilt: [], fps: [], boot: null };
  // Soft-imported feature modules that don't exist yet 404 by design. Those are
  // "not built" signals, not build failures — everything else is a real error.
  const isExpected404 = t => /Failed to load resource.*404/.test(t) || /404 \(Not Found\)/.test(t);
  page.on('console', m => {
    const t = m.text().slice(0, 500);
    if (m.type() === 'error') (isExpected404(t) ? report.notBuilt : report.errors).push(t);
    else if (m.type() === 'warning') report.warnings.push(t.slice(0, 300));
  });
  page.on('pageerror', e => report.errors.push('pageerror: ' + String(e.message).slice(0, 500)));

  const base = `http://127.0.0.1:${PORT}/hearth/`;

  // --- helpers handed to the scenario ---
  let shotN = 0;
  const api = {
    page, base, OUT, SCALE,
    async open(query = '') {
      const q = query ? (query.startsWith('?') ? query : '?' + query) : '?';
      await page.goto(base + q + '&autostart=1&nogate=1', { waitUntil: 'load' });
      await page.waitForFunction('window.__boot && (window.__boot.ready || window.__boot.error)', null, { timeout: 20000 });
      report.boot = await page.evaluate('window.__boot');
      if (report.boot?.error) report.errors.push('boot: ' + report.boot.error.slice(0, 600));
      await page.evaluate('window.__game && window.__game.mute()');
      await api.frames(6);
    },
    // Advance N rendered frames (deterministic; no wall-clock sleeps).
    frames: n => page.evaluate(k => window.__frames(k), n),
    press: async (btn, frames = 3) => {
      await page.evaluate(([b, f]) => window.__game.press(b, f), [btn, frames]);
      await api.frames(frames + 3);
    },
    hold: async (btn, frames) => {
      await page.evaluate(([b, f]) => window.__game.press(b, f), [btn, frames]);
      await api.frames(frames + 2);
    },
    tap: async (btn, times = 1, gap = 6) => {
      for (let i = 0; i < times; i++) { await api.press(btn, 3); await api.frames(gap); }
    },
    eval: (fn, arg) => page.evaluate(fn, arg),
    goto: async (scene, params) => {
      await page.evaluate(([s, p]) => window.__game.goto(s, p), [scene, params]);
      await api.frames(10);
    },
    async shot(name, opts = {}) {
      shotN++;
      const label = `${String(shotN).padStart(2, '0')}-${name}`;
      const el = await page.$('#screen');
      const file = join(OUT, label + '.png');
      await el.screenshot({ path: file });
      if (opts.native) {
        const data = await page.evaluate(() => document.getElementById('screen').toDataURL());
        await writeFile(join(OUT, label + '.native.png'), Buffer.from(data.split(',')[1], 'base64'));
      }
      const info = await page.evaluate(() => ({
        scene: window.__game?.scene, stack: window.__game?.stack, fps: window.__game?.fps,
        map: window.__game?.state?.player?.map,
        pos: window.__game && [window.__game.state.player.x, window.__game.state.player.y],
      }));
      report.shots.push({ name: label, file: label + '.png', note: opts.note || '', ...info });
      report.fps.push(info.fps || 0);
      console.log(`  📸 ${label}  scene=${info.scene} fps=${(info.fps || 0).toFixed(0)}`);
      return file;
    },
  };

  console.log(`▶ scenario "${scenarioName}" → ${OUT}`);
  try {
    await scenario(api);
  } catch (err) {
    report.errors.push('scenario: ' + String(err.stack || err).slice(0, 1500));
    console.error('scenario failed:', err.message);
    try { await api.shot('FAILURE'); } catch {}
  }

  await ctx.close();
  await browser.close();
  if (server) server.kill();

  report.avgFps = report.fps.length ? report.fps.reduce((a, b) => a + b, 0) / report.fps.length : 0;
  report.ok = report.errors.length === 0;
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.ok ? '✅' : '❌'} ${report.shots.length} shots, ${report.errors.length} errors, avg ${report.avgFps.toFixed(0)}fps`);
  if (report.errors.length) {
    for (const e of report.errors.slice(0, 8)) console.log('   ⚠ ' + e.split('\n')[0]);
    process.exitCode = 1;
  }
};

run().catch(err => { console.error(err); process.exit(1); });
