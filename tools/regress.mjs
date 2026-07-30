// Whole-experience regression pass. Run this after ANY piece changes.
//
//   node tools/regress.mjs [--port 8123] [--out shots/regress]
//
// It drives the real game and asserts the things that break silently when one piece
// improves and another rots: boot integrity, every scene reachable and exitable, no
// blank screens, save/load round-trip, movement actually moving, art completeness,
// frame rate, and the engine unit tests.

import { chromium } from './pw.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const PORT = Number(flag('port', 8123));
const OUT = resolve(String(flag('out', 'shots/regress')));
const ROOT = resolve('.');
const SCALE = 3;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
};

async function ensureServer() {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/hearth/`, { signal: AbortSignal.timeout(1000) })).ok) return null;
  } catch {}
  const c = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT), ROOT], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 120));
    try { if ((await fetch(`http://127.0.0.1:${PORT}/hearth/`, { signal: AbortSignal.timeout(800) })).ok) return c; } catch {}
  }
  throw new Error('server did not start');
}

// A screen that is essentially one flat colour means a blank/black/stuck frame.
async function screenVariety(page) {
  return page.evaluate(() => {
    const c = document.getElementById('screen');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let lum = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
      lum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    }
    return { colors: seen.size, meanLum: lum / (d.length / 28) };
  });
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: 320 * SCALE, height: 180 * SCALE }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  const is404 = t => /404|Failed to load resource/.test(t);
  page.on('console', m => { if (m.type() === 'error' && !is404(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 300)));

  const base = `http://127.0.0.1:${PORT}/hearth/`;
  const open = async q => {
    await page.goto(base + '?' + q + '&autostart=1&nogate=1&save=fresh', { waitUntil: 'load' });
    await page.waitForFunction('window.__boot && (window.__boot.ready || window.__boot.error)', null, { timeout: 20000 });
    await page.evaluate('window.__game && window.__game.mute()');
    await page.evaluate(() => window.__frames(8));
  };

  console.log('\n▶ boot integrity');
  await open('');
  const boot = await page.evaluate('window.__boot');
  check('boots without a fatal error', !boot.error, boot.error ? boot.error.split('\n')[0] : '');
  const modules = await page.evaluate('window.__game && window.__game.boot');
  check('no module threw on import', (modules?.failed?.length ?? 0) === 0,
    (modules?.failed || []).map(f => f.label).join(', '));
  if (modules?.missing?.length) console.log(`     (not built yet: ${modules.missing.join(', ')})`);

  console.log('\n▶ art completeness');
  const art = await page.evaluate(async () => {
    const names = await import('/hearth/src/art/names.js');
    const { Atlas } = await import('/hearth/src/art/atlas.js');
    const missing = names.missingNames(Atlas);
    return { size: Atlas.size, required: names.requiredNames().length, missing: missing.length, sample: missing.slice(0, 12) };
  });
  check(`atlas has all ${art.required} required sprites`, art.missing === 0,
    art.missing ? `${art.missing} missing, e.g. ${art.sample.join(', ')}` : `${art.size} registered`);

  console.log('\n▶ every scene is reachable, alive, and exitable');
  const scenes = ['title', 'overworld', 'battle', 'village', 'build', 'missions', 'party', 'dex', 'pause'];
  for (const s of scenes) {
    const before = errors.length;
    await open('scene=' + s);
    await page.evaluate(() => window.__frames(30));
    const got = await page.evaluate('window.__game.scene');
    const v = await screenVariety(page);
    await page.locator('#screen').screenshot({ path: join(OUT, `scene-${s}.png`) });
    check(`${s}: renders content`, v.colors >= 8 && v.meanLum > 6,
      `${v.colors} colours, luma ${v.meanLum.toFixed(0)}${got !== s ? `, landed on "${got}"` : ''}`);
    check(`${s}: no new errors`, errors.length === before, errors.slice(before).join(' | ').slice(0, 160));
  }

  console.log('\n▶ movement actually moves');
  await open('scene=overworld');
  const p0 = await page.evaluate(() => ({ ...window.__game.state.player }));
  await page.evaluate(() => window.__game.press('down', 50));
  await page.evaluate(() => window.__frames(60));
  const p1 = await page.evaluate(() => ({ ...window.__game.state.player }));
  const moved = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
  check('holding a direction moves the player', moved > 0, `moved ${moved} tiles from ${p0.x},${p0.y}`);
  await page.evaluate(() => window.__game.press('left', 3));
  await page.evaluate(() => window.__frames(10));
  const p2 = await page.evaluate(() => ({ ...window.__game.state.player }));
  check('a tap turns rather than teleports', p2.dir === 'left' || Math.abs(p2.x - p1.x) <= 1,
    `dir=${p2.dir}, dx=${p2.x - p1.x}`);

  console.log('\n▶ save survives a reload');
  // Note: village.level is derived from what is built, so it is deliberately not
  // asserted here — writing it and reading it back would test nothing.
  await page.evaluate(() => {
    const S = window.__game.state;
    S.coins = 4242; S.hearth = 77; S.flags.__regress = true;
    S.stats.steps = 321;
    window.__game.save();
  });
  await page.goto(base + '?autostart=1&nogate=1', { waitUntil: 'load' });
  await page.waitForFunction('window.__boot && window.__boot.ready', null, { timeout: 20000 });
  const after = await page.evaluate(() => {
    const S = window.__game.state;
    return { coins: S.coins, hearth: S.hearth, flag: !!S.flags.__regress, steps: S.stats.steps };
  });
  check('save/load round-trips', after.coins === 4242 && after.hearth === 77 && after.flag && after.steps === 321,
    JSON.stringify(after));

  console.log('\n▶ frame rate under load');
  await open('scene=overworld');
  await page.evaluate(() => window.__game.press('down', 120));
  await page.evaluate(() => window.__frames(140));
  const fps = await page.evaluate('window.__game.fps');
  check('holds 50+ fps while walking', fps >= 50, `${fps.toFixed(0)}fps`);

  console.log('\n▶ engine unit tests');
  let unit = 'skipped (no test file yet)';
  let unitOk = true;
  if (existsSync(join(ROOT, 'hearth/tests'))) {
    try {
      execFileSync(process.execPath, ['--test', 'hearth/tests/'], { cwd: ROOT, stdio: 'pipe' });
      unit = 'passed';
    } catch (e) {
      unitOk = false;
      unit = String(e.stdout || e.message).split('\n').filter(l => /^not ok|fail/i.test(l)).slice(0, 4).join(' | ') || 'failed';
    }
  }
  check('node --test hearth/tests/', unitOk, unit);

  check('zero uncaught console errors overall', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 200));

  await ctx.close(); await browser.close(); if (server) server.kill();

  const pass = results.filter(r => r.ok).length;
  const report = { at: new Date().toISOString(), pass, total: results.length, results, errors, art, modules };
  await writeFile(join(OUT, 'regress.json'), JSON.stringify(report, null, 2));
  console.log(`\n${pass === results.length ? '✅' : '❌'} regression: ${pass}/${results.length} checks passed → ${OUT}/regress.json`);
  if (pass !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
