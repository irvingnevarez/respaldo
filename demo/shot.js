// Screenshots a built game.html at a few representative moments.
//
//   node demo/shot.js <path/to/game.html> <output prefix> [scene...]
//
// Scenes: calle, salto, azotea, jefe, titulo  (default: all but titulo)
//
// Deterministic — the autopilot drives a fixed number of simulated frames with
// drawing disabled, then one frame is rendered and captured. The same command
// always produces the same pixels, so two runs can be compared meaningfully.
//
// Set SIN_RAYO=1 to hold the lightning off. Two separate look regressions have
// now been chased for an hour before turning out to be a frame that happened to
// land mid-strike: a strike is worth ~30 points of mean brightness and flattens
// the contrast, which reads exactly like "the haze got worse". Grade and art
// comparisons should be made with it off; keep it on to judge the strike.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const GAME = path.resolve(process.argv[2] || 'game.html');
const OUT = process.argv[3] || 'shot';
const WANT = process.argv.slice(4);

const SCENES = {
  calle:  { lv: 0, secs: 6.0 },
  salto:  { lv: 0, secs: 13.5 },
  azotea: { lv: 1, secs: 3.0 },
  jefe:   { lv: 3, secs: 9.0 },
  titulo: { lv: -1, secs: 0.6 },
};
const LIST = (WANT.length ? WANT : ['calle', 'salto', 'azotea', 'jefe'])
  .filter(k => SCENES[k]);

(async () => {
  const here = __dirname;
  const bot = fs.readFileSync(path.join(here, 'aprollout.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(here, 'autopilot.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(here, 'policy-penguin.js'), 'utf8');

  const b = await chromium.launch();
  for (const key of LIST) {
    const { lv, secs } = SCENES[key];
    const p = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => {
      window.__capture = true; window.__q = [];
      window.requestAnimationFrame = c => { window.__q.push(c); return 1; };
      window.cancelAnimationFrame = () => { };
      window.__flush = ts => {
        const q = window.__q; window.__q = [];
        for (const c of q) { try { c(ts); } catch (e) { if (!window.__err) window.__err = e.message; } }
      };
    });
    await p.goto('file://' + GAME, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
    await p.evaluate(a => {
      (0, eval)(a[0]);
      const g = window.__game;
      if (a[3]) {
        // hold the storm off. `flash` is a getter over `_flash`, so assigning
        // to it is a silent no-op — the backing field is the one to clear.
        g.bolt.update = function () { this._flash = 0; this.strikeT = -1; };
        g.bolt._flash = 0;
      }
      if (a[1] >= 0) { g.startRun(); g.lvIdx = a[1]; g.loadLevel(a[1]); g.state = 'play'; }
      window.__pj = false;
      const real = g.draw; g.draw = function () { };
      for (let i = 0; i < a[2]; i++) {
        let act = { L: 0, R: 0, run: 0, jump: 0 };
        if (a[1] >= 0) { try { act = AUTOPILOT(g, i) || act; } catch (e) { } }
        IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
        if (act.jump && !window.__pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
        IN.jumpHeld = !!act.jump; window.__pj = !!act.jump;
        window.__flush(i * (1000 / 60));
      }
      g.draw = real;
      for (let k = 0; k < 3; k++) window.__flush((a[2] + k) * (1000 / 60));
    }, [bot, lv, Math.round(secs * 60), !!process.env.SIN_RAYO]);
    await p.waitForTimeout(1400);
    const file = OUT + '-' + key + '.png';
    await p.locator('#stage').screenshot({ path: file });
    const loopErr = await p.evaluate(() => window.__err || null);
    console.log('  ' + key.padEnd(7) + ' -> ' + file +
      '   errores=' + errs.length + (loopErr ? '  BUCLE: ' + loopErr : ''));
    await p.close();
  }
  await b.close();
})().catch(e => { console.error('SHOT FAILED: ' + e.message); process.exit(9); });
