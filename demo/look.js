// Grabs a few representative frames at full quality so a look change can be
// judged side by side instead of described. Deterministic: same seconds in,
// same pixels out.
const { execSync } = require('child_process'); const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const TAG = process.argv[2] || 'now';
// level, seconds of simulation to fast-forward, label
const SHOTS = [[0, 6.0, 'calle'], [0, 13.5, 'salto'], [1, 3.0, 'azotea'], [3, 9.0, 'jefe']];
(async () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'aprollout.js'), 'utf8') + '\n;\n' +
    require('fs').readFileSync(path.join(__dirname, 'autopilot.js'), 'utf8') + '\n;\n' +
    require('fs').readFileSync(path.join(__dirname, 'policy-penguin.js'), 'utf8');
  const b = await chromium.launch();
  for (const [lv, secs, label] of SHOTS) {
    const p = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => {
      window.__capture = true; window.__q = [];
      window.requestAnimationFrame = c => { window.__q.push(c); return 1; };
      window.cancelAnimationFrame = () => { };
      window.__flush = ts => { const q = window.__q; window.__q = []; for (const c of q) { try { c(ts); } catch (e) { } } };
    });
    await p.goto('file://' + path.join(__dirname, 'game.html'), { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
    await p.evaluate(a => {
      (0, eval)(a[0]);
      const g = window.__game;
      g.startRun(); g.lvIdx = a[1]; g.loadLevel(a[1]); g.state = 'play';
      window.__pj = false;
      const real = g.draw; g.draw = function () { };
      for (let i = 0; i < a[2]; i++) {
        let act = { L: 0, R: 0, run: 0, jump: 0 };
        try { act = AUTOPILOT(g, i) || act; } catch (e) { }
        IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
        if (act.jump && !window.__pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
        IN.jumpHeld = !!act.jump; window.__pj = !!act.jump;
        window.__flush(i * (1000 / 60));
      }
      g.draw = real;
      for (let k = 0; k < 3; k++) window.__flush((a[2] + k) * (1000 / 60));
    }, [src, lv, Math.round(secs * 60)]);
    await p.waitForTimeout(1200);
    await p.locator('#stage').screenshot({ path: path.join(__dirname, 'look-' + TAG + '-' + label + '.png') });
    console.log('  ' + label + '  errores=' + errs.length);
    await p.close();
  }
  await b.close();
})().catch(e => { console.error('LOOK FAILED: ' + e.message); process.exit(9); });
