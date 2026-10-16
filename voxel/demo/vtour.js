// A tour of the designed places: one shot of each landmark from a good angle.
//   node voxel/demo/vtour.js <out-prefix> [name ...]
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const PAGE = path.resolve(process.env.VX_PAGE || path.join(__dirname, '..', 'index.html'));
const OUT = process.argv[2] || 'vt';
const WANT = process.argv.slice(3);

// each: name -> (LM) => [camx, camy, camz, targetx, targety, targetz]
const TOUR = {
  gcpd:    L => [L.gcpd.cx - 55, 80, L.gcpd.cz + 60, L.gcpd.cx, 78, L.gcpd.cz],
  bridge:  L => [60, 62, L.bridge.cz - 150, 5, 40, L.bridge.cz],
  bridge2: L => [5, 34, L.bridge.cz - 70, 5, 44, L.bridge.cz + 20],
  ferris:  L => { const s = [...L.special.values()].find(v => v.type === 'ferris'); const o = [s.bx * 48 + 29, s.bz * 48 + 29]; return [o[0] + 70, 52, o[1] + 40, o[0], 48, o[1]]; },
  spire:   L => { const s = [...L.special.values()].find(v => v.type === 'spire'); const o = [s.bx * 48 + 29, s.bz * 48 + 29]; return [o[0] - 60, 60, o[1] + 75, o[0], 78, o[1]]; },
  crane:   L => { const s = [...L.special.values()].find(v => v.type === 'crane'); const o = [s.bx * 48 + 29, s.bz * 48 + 29]; return [o[0] + 55, 48, o[1] + 55, o[0], 38, o[1]]; },
  foundry: L => { const s = [...L.special.values()].find(v => v.type === 'foundry'); const o = [s.bx * 48 + 29, s.bz * 48 + 29]; return [o[0] + 50, 54, o[1] + 60, o[0], 38, o[1]]; },
  beacon:  L => { const b = L.beacons[2]; return [b.x + 18, b.y + 14, b.z + 22, b.x, b.y + 8, b.z]; },
  penguin: L => { const a = L.arenas.find(v => v.style === 'penguin'); return [a.cx + 40, 60, a.cz + 46, a.cx, 28, a.cz]; },
  joker:   L => { const a = L.arenas.find(v => v.style === 'joker'); return [a.cx - 40, 60, a.cz + 46, a.cx, 28, a.cz]; },
  muelles: L => { const b = L.beacons[3]; return [b.x + 60, 60, b.z + 60, b.x, 30, b.z]; },
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx, null, { timeout: 20000 });
  await p.evaluate(() => { __vx.start(); __vx.hideHud(true); });
  for (const name of (WANT.length ? WANT : Object.keys(TOUR))) {
    const fn = TOUR[name]; if (!fn) { console.log('  no existe ' + name); continue; }
    const v = await p.evaluate(src => { const L = __vx.lm(); return eval('(' + src + ')')(L); }, fn.toString());
    await p.evaluate(a => __vx.lookAt(a[0], a[1], a[2], a[3], a[4], a[5]), v);
    try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 120000, polling: 200 }); } catch (e) { console.log('  (aviso) carga incompleta'); }
    await p.evaluate(() => __vx.render(3));
    await p.waitForTimeout(150);
    await p.evaluate(() => __vx.render(3));
    await p.waitForTimeout(250);
    const f = OUT + '-' + name + '.png';
    await p.locator('#stage').screenshot({ path: f });
    console.log('  ' + name + ' -> ' + f);
  }
  if (errs.length) console.log('ERRORES: ' + [...new Set(errs)].join(' | '));
  await b.close();
})().catch(e => { console.error('VTOUR FALLÓ: ' + e.message); process.exit(9); });
