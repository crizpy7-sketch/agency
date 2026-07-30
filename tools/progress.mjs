// Generates the live progress page from progress/state.json plus the real capture
// output in shots/. Screenshots are embedded as data URIs from the raw 320x180 canvas
// PNGs — a few KB each, and pixel-exact when scaled up.
//
//   node tools/progress.mjs            # writes progress/index.html
//
// The masthead is set in the game's own pixel font, rendered to SVG from the same
// glyph data the game draws with.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GLYPHS, FONT } from '../hearth/src/art/glyphs.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'progress', 'index.html');

// ---------- masthead: the game's pixel font as SVG rects ----------
function pixelTitle(text, { px = 1, color = 'currentColor' } = {}) {
  const rects = [];
  let x = 0, maxY = 0;
  for (const ch of text) {
    if (ch === ' ') { x += FONT.space + FONT.gap + 1; continue; }
    const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()];
    if (!g) { x += FONT.space + FONT.gap; continue; }
    g.rows.forEach((row, r) => {
      let run = 0;
      for (let c = 0; c <= row.length; c++) {
        if (row[c] === '#') { run++; continue; }
        if (run) {
          rects.push(`<rect x="${(x + c - run) * px}" y="${(g.top + r) * px}" width="${run * px}" height="${px}"/>`);
          run = 0;
        }
      }
      maxY = Math.max(maxY, g.top + r + 1);
    });
    x += g.w + FONT.gap;
  }
  const w = x * px, h = maxY * px;
  return `<svg class="pixtitle" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(text)}" fill="${color}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- gather screenshots ----------
async function gallery(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return { shots: [], report: null };
  let files = [];
  try { files = (await readdir(abs)).sort(); } catch { return { shots: [], report: null }; }
  let report = null;
  if (files.includes('report.json')) {
    try { report = JSON.parse(await readFile(join(abs, 'report.json'), 'utf8')); } catch {}
  }
  const shots = [];
  for (const f of files.filter(f => f.endsWith('.native.png'))) {
    const buf = await readFile(join(abs, f));
    const meta = report?.shots?.find(s => f.startsWith(s.name));
    shots.push({
      label: f.replace(/^\d+-/, '').replace('.native.png', '').replace(/-/g, ' '),
      src: `data:image/png;base64,${buf.toString('base64')}`,
      note: meta?.note || '', scene: meta?.scene || '', kb: Math.round(buf.length / 102.4) / 10,
    });
  }
  return { shots, report };
}

// ---------- page ----------
const STATUS = {
  done:     { label: 'shipped',   cls: 'ok' },
  critique: { label: 'in review', cls: 'review' },
  building: { label: 'building',  cls: 'work' },
  pending:  { label: 'queued',    cls: 'idle' },
  blocked:  { label: 'blocked',   cls: 'bad' },
};
const SEV = { blocker: 'bad', major: 'warn', minor: 'idle' };

function pieceRow(p) {
  const s = STATUS[p.status] || STATUS.pending;
  return `<li class="piece ${s.cls}">
    <span class="dot" aria-hidden="true"></span>
    <span class="pname">${esc(p.name)}</span>
    <span class="pill ${s.cls}">${s.label}</span>
    <span class="pnote">${esc(p.note || '')}</span>
    ${p.round ? `<span class="round">round ${p.round}</span>` : ''}
  </li>`;
}

function findingCard(f) {
  const cls = SEV[f.severity] || 'idle';
  return `<article class="find ${cls}${f.status === 'fixed' ? ' fixed' : ''}">
    <header>
      <span class="pill ${cls}">${esc(f.severity)}</span>
      <span class="fpiece">${esc(f.piece)}</span>
      ${f.status === 'fixed' ? '<span class="pill ok">fixed</span>' : ''}
    </header>
    <h4>${esc(f.title)}</h4>
    ${f.detail ? `<p>${esc(f.detail)}</p>` : ''}
  </article>`;
}

function shotFig(s) {
  return `<figure class="shot">
    <img src="${s.src}" alt="${esc(s.label)}" width="320" height="180" loading="lazy">
    <figcaption><b>${esc(s.label)}</b>${s.note ? ` — ${esc(s.note)}` : ''}</figcaption>
  </figure>`;
}

// Build identity comes from git and the newest capture report, never hand-maintained.
async function stampBuild(state) {
  const { execSync } = await import('node:child_process');
  const git = c => { try { return execSync(c, { cwd: ROOT }).toString().trim(); } catch { return ''; } };
  state.build ||= {};
  state.build.commit = git('git rev-parse --short HEAD') || state.build.commit || '—';
  state.build.at = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const tour = join(ROOT, 'shots/tour/report.json');
  if (existsSync(tour)) {
    const r = JSON.parse(await readFile(tour, 'utf8'));
    state.build.fps = Math.round(r.avgFps || 0);
    state.build.errors = (r.errors || []).length;
  }
  return state;
}

async function build() {
  const state = await stampBuild(JSON.parse(await readFile(join(ROOT, 'progress/state.json'), 'utf8')));
  const galleries = [];
  for (const g of state.galleries || []) {
    const got = await gallery(g.dir);
    if (got.shots.length) galleries.push({ ...g, ...got });
  }
  for (const c of state.comparisons || []) {
    for (const side of ['a', 'b']) {
      if (!c[side]?.dir) continue;
      const got = await gallery(c[side].dir);
      c[side].shots = got.shots.filter(s => !c[side].pick || s.label.includes(c[side].pick)).slice(0, 2);
    }
  }

  const done = (state.pieces || []).filter(p => p.status === 'done').length;
  const open = (state.findings || []).filter(f => f.status !== 'fixed').length;
  const totalShots = galleries.reduce((n, g) => n + g.shots.length, 0);

  const html = `<title>Guardians of the Hearth — build log</title>
<style>
:root {
  --gold:#f5c877; --gold-deep:#a9762a; --grass:#6ea63f; --ember:#e8563f;
  --ink:#2b2118; --paper:#f4e8cd; --paper-hi:#fdf6e3; --night:#161b26; --night-hi:#1e2534;
  --bg:var(--paper-hi); --surface:#fbf2dd; --surface-2:#f2e5c6; --line:#ddcaa2;
  --fg:#33291d; --fg-dim:#77664e; --fg-faint:#a08f74;
  --accent:var(--gold-deep); --ok:#4d7f2a; --warn:#b8791d; --bad:#b6392a; --idle:#8d8271;
  --shot-bg:#12161f;
  --sans:"Avenir Next Condensed","Roboto Condensed","Arial Narrow",system-ui,sans-serif;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,ui-serif,serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --r:3px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:var(--night); --surface:var(--night-hi); --surface-2:#252d3f; --line:#333d52;
    --fg:#e9e0cb; --fg-dim:#9aa5ba; --fg-faint:#6b768c;
    --accent:var(--gold); --ok:#8ccc5a; --warn:#e8b545; --bad:#f4796a; --idle:#7c8699;
  }
}
:root[data-theme="dark"] {
  --bg:var(--night); --surface:var(--night-hi); --surface-2:#252d3f; --line:#333d52;
  --fg:#e9e0cb; --fg-dim:#9aa5ba; --fg-faint:#6b768c;
  --accent:var(--gold); --ok:#8ccc5a; --warn:#e8b545; --bad:#f4796a; --idle:#7c8699;
}
:root[data-theme="light"] {
  --bg:var(--paper-hi); --surface:#fbf2dd; --surface-2:#f2e5c6; --line:#ddcaa2;
  --fg:#33291d; --fg-dim:#77664e; --fg-faint:#a08f74;
  --accent:var(--gold-deep); --ok:#4d7f2a; --warn:#b8791d; --bad:#b6392a; --idle:#8d8271;
}

body { background:var(--bg); color:var(--fg); font-family:var(--serif); line-height:1.6;
  padding:clamp(20px,4vw,56px) clamp(16px,4vw,40px) 80px; }
.wrap { max-width:1180px; margin:0 auto; display:flex; flex-direction:column; gap:44px; }
h1,h2,h3,h4,.label,.pill,.round,nav { font-family:var(--sans); }
h2 { font-size:1.06rem; letter-spacing:.16em; text-transform:uppercase; font-weight:700;
  color:var(--fg-dim); display:flex; align-items:baseline; gap:12px; }
h2::after { content:""; flex:1; height:1px; background:var(--line); }
h4 { font-size:1rem; font-weight:600; letter-spacing:.01em; text-wrap:balance; }
p { max-width:66ch; }
code,.mono,td.num { font-family:var(--mono); font-variant-numeric:tabular-nums; }

/* ---- masthead ---- */
header.top { display:flex; flex-direction:column; gap:14px; }
.pixtitle { width:min(100%,620px); height:auto; color:var(--accent); }
.tagline { font-size:1.05rem; color:var(--fg-dim); max-width:60ch; }
.meta { display:flex; flex-wrap:wrap; gap:8px 22px; font-family:var(--mono); font-size:.78rem;
  color:var(--fg-faint); letter-spacing:.02em; }
.meta b { color:var(--fg-dim); font-weight:500; }

/* ---- summary tiles ---- */
.tiles { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(148px,1fr)); }
.tile { background:var(--surface); border:1px solid var(--line); border-radius:var(--r);
  padding:14px 16px; display:flex; flex-direction:column; gap:2px; position:relative; overflow:hidden; }
.tile::before { content:""; position:absolute; inset:0 auto 0 0; width:3px; background:var(--idle); }
.tile.ok::before { background:var(--ok); } .tile.bad::before { background:var(--bad); }
.tile.gold::before { background:var(--accent); } .tile.warn::before { background:var(--warn); }
.tile .n { font-family:var(--mono); font-size:1.75rem; line-height:1.1; font-variant-numeric:tabular-nums; }
.tile .label { font-size:.7rem; letter-spacing:.14em; text-transform:uppercase; color:var(--fg-faint); }

/* ---- pieces ---- */
ul.pieces { list-style:none; display:flex; flex-direction:column; gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:var(--r); overflow:hidden; }
.piece { background:var(--surface); display:grid; align-items:center; gap:10px;
  grid-template-columns:10px minmax(140px,1.1fr) 84px minmax(0,2.4fr) auto; padding:11px 14px; }
.piece .dot { width:8px; height:8px; border-radius:50%; background:var(--idle); }
.piece.ok .dot { background:var(--ok); } .piece.work .dot { background:var(--accent); }
.piece.review .dot { background:var(--warn); } .piece.bad .dot { background:var(--bad); }
.piece.work .dot { animation:pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity:.28; } }
.pname { font-family:var(--sans); font-weight:600; letter-spacing:.02em; }
.pnote { color:var(--fg-dim); font-size:.9rem; }
.round { font-size:.68rem; letter-spacing:.12em; text-transform:uppercase; color:var(--fg-faint); }
.pill { font-size:.64rem; letter-spacing:.1em; text-transform:uppercase; font-weight:700;
  padding:3px 7px; border-radius:2px; background:var(--surface-2); color:var(--fg-dim);
  border:1px solid var(--line); text-align:center; }
.pill.ok { color:var(--ok); border-color:color-mix(in srgb, var(--ok) 40%, transparent); }
.pill.bad { color:var(--bad); border-color:color-mix(in srgb, var(--bad) 40%, transparent); }
.pill.warn { color:var(--warn); border-color:color-mix(in srgb, var(--warn) 40%, transparent); }
.pill.work { color:var(--accent); border-color:color-mix(in srgb, var(--accent) 45%, transparent); }

/* ---- screenshots ---- */
.strip { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(288px,1fr)); }
figure.shot { margin:0; display:flex; flex-direction:column; gap:7px; }
figure.shot img { width:100%; height:auto; image-rendering:pixelated; background:var(--shot-bg);
  border:1px solid var(--line); border-radius:2px; display:block; }
figcaption { font-family:var(--sans); font-size:.78rem; color:var(--fg-dim); letter-spacing:.02em; }
figcaption b { color:var(--fg); font-weight:600; }
.gnote { color:var(--fg-dim); font-size:.92rem; margin-bottom:4px; }

/* ---- findings ---- */
.finds { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(268px,1fr)); }
.find { background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--idle);
  border-radius:var(--r); padding:13px 15px; display:flex; flex-direction:column; gap:7px; }
.find.bad { border-left-color:var(--bad); } .find.warn { border-left-color:var(--warn); }
.find.fixed { opacity:.55; }
.find header { display:flex; align-items:center; gap:8px; }
.find .fpiece { font-family:var(--mono); font-size:.72rem; color:var(--fg-faint); letter-spacing:.04em; }
.find p { font-size:.9rem; color:var(--fg-dim); margin:0; }

/* ---- comparisons ---- */
.cmp { background:var(--surface); border:1px solid var(--line); border-radius:var(--r); padding:16px; }
.cmp h4 { margin-bottom:10px; }
.cmp .sides { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
.cmp .verdict { margin-top:12px; padding-top:12px; border-top:1px solid var(--line);
  font-size:.92rem; color:var(--fg-dim); }
.cmp .verdict b { color:var(--accent); font-family:var(--sans); letter-spacing:.06em;
  text-transform:uppercase; font-size:.72rem; }

/* ---- timeline ---- */
ol.tl { list-style:none; display:flex; flex-direction:column; gap:0; }
ol.tl li { display:grid; grid-template-columns:112px 1fr; gap:16px; padding:12px 0;
  border-top:1px solid var(--line); }
ol.tl li:first-child { border-top:0; }
ol.tl time { font-family:var(--mono); font-size:.76rem; color:var(--fg-faint);
  font-variant-numeric:tabular-nums; padding-top:2px; }
ol.tl .what { display:flex; flex-direction:column; gap:3px; }
ol.tl .what b { font-family:var(--sans); letter-spacing:.02em; }
ol.tl .what span { color:var(--fg-dim); font-size:.92rem; }

footer { color:var(--fg-faint); font-size:.8rem; font-family:var(--mono); }
a { color:var(--accent); }
@media (prefers-reduced-motion: reduce) { *,*::before { animation:none !important; transition:none !important; } }
</style>

<div class="wrap">
  <header class="top">
    ${pixelTitle('GUARDIANS OF THE HEARTH', { px: 4 })}
    <p class="tagline">${esc(state.tagline || '')}</p>
    <div class="meta">
      <span><b>build</b> ${esc(state.build?.commit || '—')}</span>
      <span><b>cycle</b> ${state.cycle ?? 0}</span>
      <span><b>updated</b> ${esc(state.build?.at || '')}</span>
      <span><b>play</b> <a href="${esc(state.playUrl || '#')}">${esc(state.playLabel || 'local build')}</a></span>
    </div>
  </header>

  <section class="tiles">
    <div class="tile ok"><span class="n">${done}/${(state.pieces || []).length}</span><span class="label">pieces shipped</span></div>
    <div class="tile gold"><span class="n">${(state.loops || []).length}</span><span class="label">loops active</span></div>
    <div class="tile ${open ? 'bad' : 'ok'}"><span class="n">${open}</span><span class="label">open findings</span></div>
    <div class="tile ${state.build?.errors ? 'bad' : 'ok'}"><span class="n">${state.build?.errors ?? 0}</span><span class="label">console errors</span></div>
    <div class="tile ${(state.build?.fps ?? 0) >= 55 ? 'ok' : 'warn'}"><span class="n">${state.build?.fps ?? '—'}</span><span class="label">avg fps</span></div>
    <div class="tile"><span class="n">${totalShots}</span><span class="label">captures</span></div>
  </section>

  <section>
    <h2>Pieces</h2>
    <ul class="pieces">${(state.pieces || []).map(pieceRow).join('')}</ul>
  </section>

  ${(state.loops || []).length ? `<section>
    <h2>Active loops</h2>
    <ul class="pieces">${state.loops.map(l => `<li class="piece work">
      <span class="dot"></span><span class="pname">${esc(l.piece)}</span>
      <span class="pill work">${esc(l.stage)}</span>
      <span class="pnote">${esc(l.note || '')}</span>
      <span class="round">round ${l.round ?? 1}</span></li>`).join('')}</ul>
  </section>` : ''}

  ${galleries.map(g => `<section>
    <h2>${esc(g.title)}</h2>
    ${g.note ? `<p class="gnote">${esc(g.note)}</p>` : ''}
    <div class="strip">${g.shots.map(shotFig).join('')}</div>
  </section>`).join('')}

  ${(state.comparisons || []).length ? `<section>
    <h2>Comparisons</h2>
    <div class="finds" style="grid-template-columns:1fr">
    ${state.comparisons.map(c => `<div class="cmp">
      <h4>${esc(c.title)}</h4>
      <div class="sides">
        ${['a', 'b'].map(k => (c[k]?.shots || []).map(s => `<figure class="shot">
          <img src="${s.src}" alt="${esc(c[k].label)}" width="320" height="180" loading="lazy">
          <figcaption><b>${esc(c[k].label)}</b></figcaption></figure>`).join('')).join('')}
      </div>
      ${c.verdict ? `<div class="verdict"><b>verdict</b> ${esc(c.verdict)}</div>` : ''}
    </div>`).join('')}
    </div>
  </section>` : ''}

  ${(state.findings || []).length ? `<section>
    <h2>Critic findings</h2>
    <div class="finds">${state.findings.map(findingCard).join('')}</div>
  </section>` : ''}

  ${(state.timeline || []).length ? `<section>
    <h2>How it is evolving</h2>
    <ol class="tl">${state.timeline.map(t => `<li>
      <time>${esc(t.at)}</time>
      <span class="what"><b>${esc(t.label)}</b><span>${esc(t.detail || '')}</span></span>
    </li>`).join('')}</ol>
  </section>` : ''}

  <footer>Generated from progress/state.json and the real capture output in shots/. Screenshots are the raw 320×180 canvas, scaled with nearest-neighbour.</footer>
</div>`;

  await mkdir(join(ROOT, 'progress'), { recursive: true });
  await writeFile(OUT, html);
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`progress page → progress/index.html  (${kb} KB, ${totalShots} shots, ${galleries.length} galleries)`);
}

build().catch(e => { console.error(e); process.exit(1); });
