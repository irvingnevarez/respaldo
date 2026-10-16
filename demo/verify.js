// One command that answers "is the build still sound?".
//
//   node demo/verify.js [path/to/game.html]
//
// Checks, in order:
//   escritorio   boots, no page errors, post-processing attached, frame rate
//   sin WebGL    the no-WebGL fallback still shows a playable 2D canvas
//   táctil       the touch pad never overlaps the canvas, no horizontal scroll
//   jefes        both boss arenas run for 20s without throwing
//
// Exits non-zero if anything fails, so it can gate a commit.
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const GAME = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'game.html'));
let failures = 0;
const ok = (name, good, detail) => {
  console.log((good ? '  OK   ' : '  FALLA') + '  ' + name.padEnd(14) + (detail || ''));
  if (!good) failures++;
};

async function fresh(browser, opts) {
  const ctx = await browser.newContext(opts || {});
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  return { page, errs, ctx };
}

(async () => {
  const browser = await chromium.launch();

  // ── escritorio ────────────────────────────────────────────────────────
  {
    const { page, errs } = await fresh(browser, { viewport: { width: 1280, height: 800 } });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    await page.evaluate(() => { const g = window.__game; g.startRun(); g.state = 'play'; });
    const r = await page.evaluate(() => new Promise(res => {
      let n = 0; const t0 = performance.now();
      (function tick() {
        n++;
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else res({
          fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
          post: !!window.__game.fx2, tier: window.__game.gfxTier,
          levels: LEVELS.length,
        });
      })();
    }));
    ok('escritorio', errs.length === 0 && r.levels === 8,
      'fps=' + r.fps + ' nivel-gfx=' + r.tier + ' postfx=' + r.post +
      ' niveles=' + r.levels + ' errores=' + errs.length);
    if (errs.length) errs.slice(0, 3).forEach(e => console.log('         ' + e));
    await page.close();
  }

  // ── sin WebGL ─────────────────────────────────────────────────────────
  {
    const { page, errs } = await fresh(browser, { viewport: { width: 1100, height: 700 } });
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, o) {
        if (String(t).indexOf('webgl') === 0) return null;
        return real.call(this, t, o);
      };
    });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      post: !!window.__game.fx2,
      gc: getComputedStyle(document.getElementById('gc')).display,
      fx: getComputedStyle(document.getElementById('fx')).display,
    }));
    ok('sin WebGL', errs.length === 0 && !r.post && r.gc !== 'none' && r.fx === 'none',
      'postfx=' + r.post + ' lienzo2D=' + r.gc + ' lienzoFX=' + r.fx + ' errores=' + errs.length);
    await page.close();
  }

  // ── táctil, retrato y paisaje ─────────────────────────────────────────
  for (const [name, vp] of [['retrato', { width: 402, height: 820 }],
                            ['paisaje', { width: 874, height: 402 }]]) {
    const { page, errs } = await fresh(browser, {
      viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const pad = document.getElementById('pad').getBoundingClientRect();
      const st = document.getElementById('stage').getBoundingClientRect();
      return {
        shown: getComputedStyle(document.getElementById('pad')).display !== 'none',
        overlap: pad.top < st.bottom && pad.bottom > st.top,
        hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    ok('táctil ' + name, errs.length === 0 && r.shown && !r.overlap && !r.hscroll,
      'pad=' + r.shown + ' solapa=' + r.overlap + ' scrollH=' + r.hscroll + ' errores=' + errs.length);
    await page.close();
  }

  // ── pantallas finales ─────────────────────────────────────────────────
  // Beating the last boss froze the game for good: the engine bumps lvIdx before
  // switching to WIN, the HUD then read LEVELS[8].id, the exception escaped
  // draw() and the frame loop never rescheduled. Nothing had ever finished the
  // game, so nothing had ever drawn this screen. Reproduce the transition the way
  // the engine does it -- lvIdx one past the end -- and require that the loop is
  // still alive a moment later.
  for (const [name, st, bump] of [['victoria', 'win', true], ['fin de juego', 'over', false]]) {
    const { page, errs } = await fresh(browser, { viewport: { width: 1100, height: 700 } });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    const r = await page.evaluate(async a => {
      const g = window.__game;
      g.startRun(); g.lvIdx = 7; g.loadLevel(7);
      if (a[1]) g.lvIdx = LEVELS.length;
      g.state = a[0]; g.stateT = 0;
      const t0 = g.stateT;
      await new Promise(res => setTimeout(res, 1600));
      return { advanced: g.stateT > t0 + 0.15, stateT: +g.stateT.toFixed(2) };
    }, [st, bump]);
    ok(name, errs.length === 0 && r.advanced,
      'stateT=' + r.stateT + ' bucle=' + (r.advanced ? 'vivo' : 'MUERTO') + ' errores=' + errs.length);
    if (errs.length) errs.slice(0, 2).forEach(e => console.log('         ' + e));
    await page.close();
  }

  // ── dibujado de cada estado en cada nivel ─────────────────────────────
  // The boss check below stubs draw() out, because it is a physics crash test —
  // which is exactly why it could not see the victory-screen freeze, a bug that
  // lived entirely in draw(). This one calls the REAL draw for every state on
  // every level, and walks the real transitions (a cleared level loading the
  // next one, the last level turning into the victory screen) through update().
  // frame() reschedules itself only AFTER draw() returns, so a single throw here
  // is a dead game in the browser, not a console warning.
  {
    const { page, errs } = await fresh(browser, { viewport: { width: 1100, height: 700 } });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    const r = await page.evaluate(() => {
      const g = window.__game;
      const fails = []; let n = 0;
      const tryDraw = (label, k) => {
        for (let i = 0; i < (k || 2); i++) {
          n++;
          try { g.draw(); } catch (e) { fails.push(label + ': ' + e.message); return false; }
        }
        return true;
      };
      const setup = (li, st, t) => {
        g.startRun(); g.lvIdx = li; g.loadLevel(li);
        g.state = st; g.stateT = t || 0.6;
      };
      for (let li = 0; li < LEVELS.length; li++) {
        for (const st of ['play', 'pause', 'dead', 'clear']) {
          setup(li, st);
          tryDraw('nivel ' + LEVELS[li].id + ' / ' + st);
        }
      }
      for (const st of ['title', 'over']) { setup(0, st); tryDraw(st); }
      // the real transitions, through update(), not just a forced state
      setup(0, 'clear', 2.7);
      try { g.update(1 / 60); } catch (e) { fails.push('clear->siguiente update: ' + e.message); }
      if (g.state !== 'play' || g.lvIdx !== 1) fails.push('clear no cargó el nivel 2 (estado=' + g.state + ' lv=' + g.lvIdx + ')');
      tryDraw('tras clear->nivel 2');
      setup(LEVELS.length - 1, 'clear', 2.7);
      try { g.update(1 / 60); } catch (e) { fails.push('último clear->victoria update: ' + e.message); }
      if (g.state !== 'win') fails.push('el último clear no llegó a la victoria (estado=' + g.state + ')');
      tryDraw('victoria tras el último nivel', 3);
      return { n, fails };
    });
    ok('dibujado', errs.length === 0 && r.fails.length === 0,
      'dibujos=' + r.n + ' fallos=' + r.fails.length + ' errores=' + errs.length);
    r.fails.slice(0, 4).forEach(f => console.log('         ' + f));
    await page.close();
  }

  // ── los dos jefes ─────────────────────────────────────────────────────
  for (const [name, idx] of [['pingüino', 3], ['joker', 7]]) {
    const { page, errs } = await fresh(browser, { viewport: { width: 1000, height: 640 } });
    await page.addInitScript(() => {
      window.__capture = true; window.__q = [];
      window.requestAnimationFrame = c => { window.__q.push(c); return 1; };
      window.cancelAnimationFrame = () => { };
      window.__flush = ts => {
        const q = window.__q; window.__q = [];
        for (const c of q) { try { c(ts); } catch (e) { if (!window.__err) window.__err = e.message; } }
      };
    });
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    const r = await page.evaluate(lv => {
      const g = window.__game;
      g.draw = function () { };            // physics only: this is a crash test
      g.startRun(); g.lvIdx = lv; g.loadLevel(lv); g.state = 'play';
      for (let i = 0; i < 20 * 60; i++) window.__flush(i * (1000 / 60));
      return { st: g.state, hp: g.boss ? g.boss.hp : -1, err: window.__err || null };
    }, idx);
    ok('jefe ' + name, errs.length === 0 && !r.err,
      'estado=' + r.st + ' vida=' + r.hp + (r.err ? '  BUCLE: ' + r.err : '') +
      ' errores=' + errs.length);
    await page.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' FALLO(S)' : '\nTodo en verde');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(9); });
