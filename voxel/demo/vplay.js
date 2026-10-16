// Play-test screenshots: start the game, run scripted input, capture.
//   node voxel/demo/vplay.js <out-prefix> <scenario>
// Scenarios are small functions below; each gets { p (page), shot(name), run(frames), key(code,down) }.
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const PAGE = path.resolve(process.env.VX_PAGE || path.join(__dirname, '..', 'index.html'));
const OUT = process.argv[2] || 'vp';
const WANT = process.argv.slice(3);

const SCEN = {
  async front(c) {
    await c.waitReady();
    await c.p.evaluate(() => { __vx.start(); __vx.mapAll(); });
    await c.run(40);
    for (const [name, off, pitch, dist] of [['front', 0, -0.1, 3.4], ['side', 1.2, -0.1, 3.4], ['back', Math.PI, -0.15, 3.6], ['top', 0.6, -0.9, 4.5]]) {
      await c.p.evaluate(a => { const g = __vx.gs(), p = g.player; g.tcam.yaw = -p.a + a[0]; g.tcam.pitch = a[1]; g.tcam.want = a[2]; g.tcam.dist = a[2]; __vx.step(6); }, [off, pitch, dist]);
      await c.shot('model-' + name);
    }
  },
  async sky(c) {
    await c.waitReady();
    await c.p.evaluate(() => { __vx.start(); __vx.mapAll(); });
    await c.run(40);
    // look at the signal from the roof, then at the emblem from the street
    await c.p.evaluate(() => { const g = __vx.gs(), p = g.player; g.tcam.yaw = 0.2 + Math.PI; g.tcam.pitch = 0.22; g.tcam.want = 4.4; __vx.step(8); });
    await c.shot('sig-roof');
    await c.p.evaluate(() => { __vx.place(33.5, 27, 120, 0); const g = __vx.gs(); g.tcam.yaw = 0.25; g.tcam.pitch = 0.62; g.tcam.want = 4.4; __vx.step(10); });
    await c.waitReady();
    await c.shot('sig-street');
  },
  async roof(c) {
    await c.waitReady();
    await c.p.evaluate(() => { __vx.start(); });
    await c.run(30);
    await c.shot('roof');
    const s = await c.p.evaluate(() => { const p = __vx.gs().player; return { x: p.b.x, y: p.b.y, z: p.b.z, g: p.b.onGround, mode: p.mode }; });
    console.log('  jugador', JSON.stringify(s));
  },
  async walk(c) {
    await c.waitReady();
    await c.p.evaluate(() => { __vx.start(); });
    await c.run(30);
    await c.key('KeyW', true); await c.run(180); await c.shot('walk1');
    await c.key('ShiftLeft', true); await c.run(60); await c.shot('sprint');
    await c.key('KeyW', false); await c.key('ShiftLeft', false);
    const s = await c.p.evaluate(() => { const p = __vx.gs().player; return { x: p.b.x, y: p.b.y, z: p.b.z, g: p.b.onGround, mode: p.mode }; });
    console.log('  jugador', JSON.stringify(s));
  },
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [], logs = [];
  p.on('pageerror', e => errs.push(e.message + (e.stack ? ' @ ' + e.stack.split('\n')[1] : '')));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + PAGE, { waitUntil: 'load' });
  try { await p.waitForFunction(() => window.__vx, null, { timeout: 20000 }); } catch (e) { console.log('la página no arrancó'); }
  const c = {
    p,
    async waitReady() {
      try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 120000, polling: 200 }); }
      catch (e) { console.log('  (aviso) el mundo no terminó de cargar: ' + await p.evaluate(() => __vx.fraction().toFixed(2))); }
    },
    async run(n) { await p.evaluate(n => { __vx.step(n); }, n); },
    async key(code, down) { await p.evaluate(a => { const I = __vx.input(); I.keys[a[0]] = a[1]; if (a[0].startsWith('Shift')) I.sprint = a[1]; if (a[0] === 'Space') { I.jump = a[1]; if (a[1]) I.jumpEdge = true; } }, [code, down]); },
    async shot(name) {
      await p.evaluate(() => __vx.render());
      await p.waitForTimeout(200);
      const f = OUT + '-' + name + '.png';
      await p.locator('#stage').screenshot({ path: f });
      console.log('  ' + name + ' -> ' + f);
    },
  };
  for (const name of (WANT.length ? WANT : ['roof'])) {
    if (!SCEN[name]) { console.log('escenario desconocido: ' + name); continue; }
    console.log('escenario ' + name);
    try { await SCEN[name](c); } catch (e) { console.log('  FALLÓ: ' + e.message); }
  }
  if (errs.length) console.log('ERRORES DE PÁGINA:\n  ' + [...new Set(errs)].slice(0, 6).join('\n  '));
  if (logs.length) console.log('CONSOLA: ' + [...new Set(logs)].slice(0, 5).join(' | '));
  await b.close();
})().catch(e => { console.error('VPLAY FALLÓ: ' + e.message); process.exit(9); });
