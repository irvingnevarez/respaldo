// Deterministic screenshots of the voxel world.
//   node voxel/demo/vshot.js <out-prefix> [scene ...]
// The camera is placed from outside, the world is waited for, one frame is drawn on
// demand and the stage is captured: the same command always gives the same pixels,
// which is what makes two looks comparable.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const PAGE = path.resolve(process.env.VX_PAGE || path.join(__dirname, '..', 'index.html'));
const OUT = process.argv[2] || 'vx';
// name -> [x, y, z, yaw, pitch, extra params]
const SCENES = {
  spawn:   [20, 104, 34, 2.52, -0.16, {}],
  alto2:   [10, 175, 150, 2.8, -0.42, {}],
  alto3:   [200, 130, -100, 0.9, -0.25, {}],
  ras:     [30, 60, 40, 3.14, 0.02, {}],
  calle:   [5, 28.6, 70, 0.0, -0.02, {}],
  calle2:  [3, 28.4, 58, 3.3, 0.0, {}],
  azotea:  [30, 92, -30, 0.5, -0.22, {}],
  alto:    [0, 150, 90, 2.9, -0.55, {}],
  rio:     [0, 40, 60, 0.0, -0.10, {}],
};
const WANT = process.argv.slice(3).length ? process.argv.slice(3) : ['spawn', 'calle', 'azotea'];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const errs = [], logs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx, null, { timeout: 20000 });
  await p.evaluate(() => { __vx.start(); __vx.hideHud(true); });
  for (const name of WANT) {
    const sc = SCENES[name];
    if (!sc) { console.log('  escena desconocida: ' + name); continue; }
    await p.evaluate(a => { __vx.setCam(a[0], a[1], a[2], a[3], a[4]); for (const k in a[5]) __vx.set(k, a[5][k]); }, sc);
    const t0 = Date.now();
    try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 90000, polling: 200 }); }
    catch (e) { console.log('  (aviso) el mundo no terminó de cargar: ' + await p.evaluate(() => __vx.fraction().toFixed(2))); }
    const ms = Date.now() - t0;
    await p.evaluate(() => __vx.render(3.0));
    await p.waitForTimeout(150);
    await p.evaluate(() => __vx.render(3.0));
    await p.waitForTimeout(250);
    const file = OUT + '-' + name + '.png';
    await p.locator('#stage').screenshot({ path: file });
    const st = await p.evaluate(() => __vx.stats());
    console.log('  ' + name.padEnd(8) + ' -> ' + file + '   carga=' + ms + 'ms chunks=' + st.chunks + ' modo=' + st.mode +
      ' hdr=' + st.hdr + ' horneado=' + st.baked + ' (' + (st.ms / Math.max(1, st.baked)).toFixed(0) + 'ms/chunk)');
  }
  if (errs.length) console.log('ERRORES DE PÁGINA: ' + errs.slice(0, 4).join(' | '));
  if (logs.length) console.log('CONSOLA: ' + [...new Set(logs)].slice(0, 4).join(' | '));
  await b.close();
})().catch(e => { console.error('VSHOT FALLÓ: ' + e.message); process.exit(9); });
