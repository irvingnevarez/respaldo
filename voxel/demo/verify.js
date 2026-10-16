// The checks the voxel game must pass before it is published.  node voxel/demo/verify.js
// Everything runs in a real (software-rendered) browser against voxel/index.html and
// voxel/artifact.html: boot, the real frame loop, every game state, the fallbacks,
// and the touch layouts.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const PAGE = path.resolve(process.env.VX_PAGE || path.join(__dirname, '..', 'index.html'));
const SHOTS = process.env.VX_SHOTS || '';
let bad = 0;
const ok = (name, cond, info) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + name + (info ? '   ' + info : '')); if (!cond) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, opts, init) {
  const ctx = await browser.newContext(opts || { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message + (e.stack ? ' @ ' + e.stack.split('\n')[1] : '')));
  if (init) await p.addInitScript(init);
  await p.goto('file://' + PAGE, { waitUntil: 'load' });
  return { p, errs, ctx };
}
const state = p => p.evaluate(() => __vx.vx().state);
const pos = p => p.evaluate(() => { const b = __vx.gs().player.b; return { x: b.x, y: b.y, z: b.z }; });
const waitState = async (p, s, ms) => { try { await p.waitForFunction(s => __vx.vx().state === s, s, { timeout: ms || 60000, polling: 100 }); return true; } catch (e) { return false; } };

(async () => {
  const browser = await chromium.launch();

  // ── 1. desktop: boot, title, play ──
  console.log('escritorio');
  {
    const { p, errs } = await open(browser);
    ok('la página expone los ganchos de prueba', await p.waitForFunction(() => window.__vx, null, { timeout: 20000 }).then(() => true, () => false));
    ok('llega al título (el mundo carga)', await waitState(p, 'title', 180000), 'fracción ' + await p.evaluate(() => __vx.fraction().toFixed(2)));
    ok('la capa de arranque se oculta', await p.evaluate(() => document.getElementById('boot').hidden));
    ok('modo de horneado: workers', await p.evaluate(() => __vx.mode()) === 'workers', await p.evaluate(() => __vx.mode()));
    await sleep(900);
    await p.keyboard.press('Space');
    ok('una tecla empieza la partida', await waitState(p, 'play', 5000));
    const p0 = await pos(p);
    await p.keyboard.down('KeyW'); await sleep(2200); await p.keyboard.up('KeyW');
    const p1 = await pos(p);
    ok('W mueve a Batman', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.0, Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) + ' bloques');
    ok('sigue vivo y sin errores', await p.evaluate(() => __vx.gs().player.hp > 0) && errs.length === 0, errs[0] || '');
    ok('sin errores de WebGL', await p.evaluate(() => __vx.glError()) === 0);
    await p.keyboard.press('Escape'); await sleep(300);
    ok('Esc pausa', await state(p) === 'pause');
    await p.keyboard.press('Escape'); await sleep(300);
    ok('Esc reanuda', await state(p) === 'play');
    await p.keyboard.press('KeyM'); await sleep(400);
    ok('M abre el mapa', await state(p) === 'map');
    await p.keyboard.press('KeyM'); await sleep(300);
    ok('M lo cierra', await state(p) === 'play');
    // death and the respawn that follows
    await p.evaluate(() => __vx.hurt(99));
    ok('morir lleva al estado dead', await waitState(p, 'dead', 4000));
    ok('y después reaparece con la vida llena', await waitState(p, 'play', 25000) && await p.evaluate(() => __vx.gs().player.hp === __vx.gs().player.maxHp));
    ok('sin errores tras morir', errs.length === 0, errs[0] || '');
    await p.context().close();
  }

  // ── 2. the whole game by hooks: beacons, travel, both bosses, victory ──
  console.log('juego');
  {
    const { p, errs } = await open(browser, null, () => { window.__capture = true; });
    await p.waitForFunction(() => window.__vx, null, { timeout: 20000 });
    await p.evaluate(() => { __vx.start(); __vx.mapAll(); });
    const bc = await p.evaluate(() => __vx.gs().beacons.map(b => [b.x, b.y, b.z]));
    ok('hay ocho balizas (azotea de la comisaría + siete)', bc.length === 8, String(bc.length));
    await p.evaluate(b => { __vx.place(b[0] + 1, b[1] + 0.3, b[2]); }, bc[2]);
    try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 120000, polling: 200 }); } catch (e) { }
    await p.evaluate(() => __vx.step(120));
    ok('pisar una baliza la activa', await p.evaluate(() => __vx.gs().beacons[2].active));
    await p.evaluate(() => { __vx.place(30, 26.01, 70); __vx.step(30); __vx.travel(2); __vx.step(200); });
    const t = await pos(p);
    ok('el viaje rápido lleva a la baliza', Math.hypot(t.x - bc[2][0], t.z - bc[2][2]) < 12, 'a ' + Math.hypot(t.x - bc[2][0], t.z - bc[2][2]).toFixed(1));
    for (const id of ['penguin', 'joker']) {
      const A = await p.evaluate(id => __vx.arena(id), id);
      await p.evaluate(a => { __vx.place(a.cx, 27.01, a.cz + 12); }, A);
      try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 120000, polling: 200 }); } catch (e) { }
      await p.evaluate(() => __vx.step(400));
      ok('entrar en la arena de ' + id + ' empieza el combate', await p.evaluate(() => !!__vx.gs().boss));
      await p.evaluate(() => { __vx.gs().player.hp = 99; __vx.step(2400); });
      ok('el combate de ' + id + ' corre sin errores durante 20 s', errs.length === 0, errs[0] || '');
      await p.evaluate(() => { __vx.killBoss(); __vx.step(900); });
      ok(id + ' puede ser derrotado', await p.evaluate(id => __vx.gs().bossDone[id], id));
    }
    await p.evaluate(() => __vx.step(700));
    ok('con los dos jefes derrotados llega la victoria', await state(p) === 'win', await state(p));
    // every state draws
    for (const s of ['title', 'play', 'pause', 'map', 'dead', 'win', 'boot']) {
      const r = await p.evaluate(s => { try { __vx.setState(s); __vx.render(); return 'ok'; } catch (e) { return e.message; } }, s);
      ok('dibuja el estado ' + s, r === 'ok', r);
    }
    const au = await p.evaluate(() => __vx.audioSmoke());
    ok('el audio no lanza errores (o no hay contexto de audio)', au.bad.length === 0, JSON.stringify(au));
    ok('sin errores de WebGL tras todo', await p.evaluate(() => __vx.glError()) === 0);
    ok('sin errores de página', errs.length === 0, errs[0] || '');
    await p.context().close();
  }

  // ── 3. fallbacks ──
  console.log('plan B');
  {
    const { p } = await open(browser, null, () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { if (t === 'webgl2' || t === 'webgl') return null; return g.apply(this, arguments); }; });
    await sleep(800);
    const msg = await p.evaluate(() => document.getElementById('bootmsg').textContent);
    ok('sin WebGL2 se explica en pantalla', /WebGL2/.test(msg), msg);
    await p.context().close();
  }
  {
    const { p, errs } = await open(browser, null, () => { window.__capture = true; delete window.Worker; window.Worker = undefined; });
    await p.waitForFunction(() => window.__vx, null, { timeout: 20000 });
    try { await p.waitForFunction(() => __vx.fraction() > 0.7, null, { timeout: 240000, polling: 300 }); } catch (e) { }
    ok('sin Workers hornea en el hilo principal', await p.evaluate(() => __vx.mode()) === 'main' && await p.evaluate(() => __vx.fraction()) > 0.7, await p.evaluate(() => __vx.mode() + ' ' + __vx.fraction().toFixed(2)));
    ok('sin Workers tampoco hay errores', errs.length === 0, errs[0] || '');
    await p.context().close();
  }

  // ── 4. touch layouts ──
  console.log('táctil');
  for (const [name, vp] of [['vertical', { width: 390, height: 844 }], ['horizontal', { width: 844, height: 390 }]]) {
    const { p, errs } = await open(browser, { viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, () => { window.__capture = true; });
    await p.waitForFunction(() => window.__vx, null, { timeout: 20000 });
    await p.evaluate(() => { __vx.start(); __vx.mapAll(); });
    try { await p.waitForFunction(() => __vx.ready(), null, { timeout: 180000, polling: 300 }); } catch (e) { }
    await p.evaluate(() => { __vx.step(30); __vx.render(); });
    const L = await p.evaluate(() => {
      const r = id => { const e = document.getElementById(id), b = e.getBoundingClientRect(); return { id: id, x: b.left, y: b.top, w: b.width, h: b.height, vis: getComputedStyle(e).display !== 'none' }; };
      return { stage: r('stage'), touch: r('touch'), stick: r('stick'), tbJ: r('tbJ'), tbG: r('tbG'), tbB: r('tbB'), tbP: r('tbP'), tbM: r('tbM'), tbS: r('tbS'),
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight, rail: getComputedStyle(document.getElementById('rail')).display };
    });
    ok(name + ': los controles táctiles se ven', L.touch.vis && L.stick.vis && L.tbJ.vis, '');
    ok(name + ': no hay desbordamiento horizontal', L.sw <= L.iw + 1, L.sw + ' vs ' + L.iw);
    ok(name + ': el escenario cabe en la pantalla', L.stage.x >= -1 && L.stage.x + L.stage.w <= L.iw + 1 && L.stage.y + L.stage.h <= L.ih + 2, JSON.stringify([L.stage.w | 0, L.stage.h | 0]));
    const boxes = ['stick', 'tbJ', 'tbG', 'tbB', 'tbP', 'tbM', 'tbS'].map(k => L[k]);
    let overlap = '';
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap += a.id + '/' + b.id + ' ';
    }
    ok(name + ': los controles no se pisan', !overlap, overlap);
    ok(name + ': todos dentro del escenario', boxes.every(b => b.x >= L.stage.x - 1 && b.y >= L.stage.y - 1 && b.x + b.w <= L.stage.x + L.stage.w + 1 && b.y + b.h <= L.stage.y + L.stage.h + 1));
    ok(name + ': el pie de teclas se oculta', L.rail === 'none');
    // a finger on the stick moves the character; a tap on a button fires it
    const before = await pos(p);
    await p.evaluate(() => {
      const st = document.getElementById('stick'), r = st.getBoundingClientRect();
      const ev = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
      ev('pointerdown', r.left + r.width / 2, r.top + r.height / 2);
      ev('pointermove', r.left + r.width / 2, r.top + 4);
      __vx.step(150);
      window.__stickEnd = () => ev('pointerup', r.left + r.width / 2, r.top + 4);
    });
    const mid = await p.evaluate(() => ({ sy: __vx.input().stickY, touch: __vx.input().touch }));
    const after = await pos(p);
    ok(name + ': el stick mueve al personaje', mid.sy > 0.5 && Math.hypot(after.x - before.x, after.z - before.z) > 0.5, 'stickY ' + mid.sy.toFixed(2) + ', ' + Math.hypot(after.x - before.x, after.z - before.z).toFixed(1) + ' b');
    await p.evaluate(() => window.__stickEnd());
    const jumped = await p.evaluate(() => { const b = document.getElementById('tbJ'); b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch', bubbles: true })); const e = __vx.input().jumpEdge; b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, pointerType: 'touch', bubbles: true })); return e; });
    ok(name + ': el botón de salto responde', jumped === true);
    if (SHOTS) { await p.evaluate(() => { __vx.render(); }); await sleep(250); await p.locator('#stage').screenshot({ path: SHOTS + '-touch-' + name + '.png' }); }
    ok(name + ': sin errores', errs.length === 0, errs[0] || '');
    await p.context().close();
  }

  await browser.close();
  console.log(bad ? '\n' + bad + ' COMPROBACIONES FALLARON' : '\ntodo bien');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('VERIFY FALLÓ: ' + e.message); process.exit(9); });
