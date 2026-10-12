// Is the Joker's phase 3 winnable by the bot at all, and if so, how?
//
//   node plan3.js [steady|transition] [--minions]
//
// Three rounds of reasoning about card arcs produced three wrong answers, so
// this stops reasoning and searches. It scans OPEN-LOOP plans against the real
// engine -- no feedback at all, just "wait at x0, start running at t_go, jump
// when the boss is within dj" -- and reports which ones put the player on his
// head without the player being touched first.
//
//   transition  the exact state the fight is in when phase 3 begins: he has
//               just been stomped, is standing at x=150 and is about to walk
//               to the centre. This is the case that kills the bot every run.
//   steady      a later cycle: he is already at the centre, 'ground' t=0.
//
// Minions are off by default so the cards are isolated; --minions puts them
// back, to validate a plan found without them.
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const MODE = process.argv[2] === 'steady' ? 'steady' : 'transition';
const MINIONS = process.argv.includes('--minions');

// Start states: x, the feet height, and how far into 'hurt' the boss already is.
// The deck-0 starts are the REAL case -- after the fourth stomp the player
// bounces and lands on the left deck about a third of a second later.
const STARTS = [];
for (const x of [300, 320, 340, 360, 380, 400, 420, 560, 700]) STARTS.push({ x, feet: 480, t0: 0 });
for (const x of [100, 150, 200, 250, 280]) STARTS.push({ x, feet: 384, t0: 0.35 });
// the right deck and the centre deck matter for the steady-state cycles
for (const x of [700, 750, 800, 850]) STARTS.push({ x, feet: 384, t0: 0 });
for (const x of [420, 480, 540]) STARTS.push({ x, feet: 320, t0: 0 });
const TGO = []; for (let t = 0; t <= 1.8001; t += 0.1) TGO.push(+t.toFixed(2));
const DJ = [60, 100, 140, 180, 220, 260];
const HOLD = [22];
const STEER = [false];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    window.__capture = true; window.__q = [];
    window.requestAnimationFrame = c => { window.__q.push(c); return 1; };
    window.cancelAnimationFrame = () => { };
    window.__flush = ts => {
      const q = window.__q; window.__q = [];
      for (const c of q) { try { c(ts); } catch (e) { if (!window.__err) window.__err = e.message; } }
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'game.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });

  const res = await page.evaluate(cfg => {
    const g = window.__game;
    g.draw = function () { };
    g.startRun(); g.lvIdx = 7; g.loadLevel(7); g.state = 'play'; g.lives = 9999;

    let TS = 1000;
    function trial(st, tgo, dj, hold, steer) {
      const x0 = st.x;
      // A full restart per trial, not just loadLevel. Calling loadLevel alone
      // left the game frozen after the first hit (a pending death survives the
      // reload), so 8628 of 8640 trials "ended" without the boss ever reaching
      // 'throw' -- and the whole scan finished in four seconds, which is not
      // physically possible for 4.6M frames. The giveaway was the tally.
      g.startRun(); g.lvIdx = 7; g.loadLevel(7); g.state = 'play'; g.lives = 9999;
      const bo = g.boss, pl = g.player;
      bo.hp = 1; bo.phase = 3; bo.introT = 99; bo.proj.length = 0; bo.waves.length = 0;
      if (cfg.mode === 'steady') {
        bo.rect.x = 444; bo.rect.y = 384; bo.setState('ground');
      } else {
        bo.rect.x = 114; bo.rect.y = 288; bo.setState('hurt'); bo.t = st.t0;   // as traced at the stomp
      }
      bo.gasY = 540 + 40; bo.gasTarget = 540 + 40;
      pl.rect.x = x0 - pl.rect.w / 2; pl.rect.y = st.feet - pl.rect.h; pl.vx = 0; pl.vy = 0;

      let hurt = 0;
      const rh = pl.hurt.bind(pl);
      pl.hurt = function (gg) { hurt++; return rh(gg); };

      let jf = 0, jumped = false, pj = false, minD = 1e9, tThrowMin = -1, why = '';
      const N = 60 * 9;
      for (let i = 0; i < N; i++) {
        const t = i / 60;
        if (!cfg.minions) g.enemies.length = 0;
        const dx = bo.rect.cx - pl.rect.cx;
        let L = 0, R = 0, run = 0, jump = 0;
        if (t >= tgo) {
          if (pl.onGround) { R = dx > 0 ? 1 : 0; L = dx < 0 ? 1 : 0; run = 1; }
          else if (steer) { R = dx > 8 ? 1 : 0; L = dx < -8 ? 1 : 0; run = 1; }
          else { R = dx > 0 ? 1 : 0; L = dx < 0 ? 1 : 0; run = 1; }
          if (!jumped && pl.onGround && Math.abs(dx) <= dj) { jumped = true; jf = hold; }
        }
        if (jf > 0) { jump = 1; jf--; }
        IN.L = !!L; IN.R = !!R; IN.run = !!run;
        if (jump && !pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
        IN.jumpHeld = !!jump; pj = !!jump;
        // MONOTONIC time across trials. The game computes dt = ts - last, and
        // restarting ts at 0 for each trial made dt negative until it caught up
        // with the previous trial's final timestamp: the whole trial sat frozen.
        // That is why 8628 of 8640 trials "ended" with the boss never reaching
        // 'throw', in four seconds, for what should be 4.6M frames of physics.
        window.__flush(TS); TS += 1000 / 60;
        if (bo.state === 'throw' && Math.abs(bo.rect.cx - pl.rect.cx) < minD) {
          minD = Math.abs(bo.rect.cx - pl.rect.cx); tThrowMin = t;
        }
        if (bo.defeated) return { win: hurt === 0, hurt: hurt, t: +t.toFixed(2), minD: Math.round(minD) };
        if (hurt > 0) return { win: false, hurt: hurt, t: +t.toFixed(2), minD: Math.round(minD),
                               st: bo.state, bt: +bo.t.toFixed(2) };
      }
      return { win: false, hurt: 0, t: 9, minD: Math.round(minD), st: 'sin-fin' };
    }

    const wins = [], near = [], sample = [];
    const tally = {};
    let n = 0;
    for (const st of cfg.STARTS) for (const tgo of cfg.TGO) for (const dj of cfg.DJ)
      for (const hold of cfg.HOLD) for (const steer of cfg.STEER) {
        n++;
        const r = trial(st, tgo, dj, hold, steer);
        const x0 = st.x, feet = st.feet;
        const key = r.win ? 'GANA' : (r.hurt ? 'golpe@' + (r.st || '?') : r.st);
        tally[key] = (tally[key] || 0) + 1;
        if (sample.length < 6 && n % 997 === 1) sample.push({ x0, tgo, dj, hold, steer, r });
        if (r.win) wins.push({ x0, feet, tgo, dj, hold, steer, t: r.t });
        else if (r.minD < 60) near.push({ x0, tgo, dj, hold, steer, t: r.t, minD: r.minD, st: r.st, hurt: r.hurt });
      }
    return { n, wins, near: near.slice(0, 12), sample, tally, err: window.__err || null };
  }, { mode: MODE, minions: MINIONS, STARTS, TGO, DJ, HOLD, STEER });

  console.log('modo=' + MODE + (MINIONS ? ' +esbirros' : '') + '  planes probados=' + res.n +
    '  GANADORES=' + res.wins.length);
  if (res.err) console.log('ERROR bucle: ' + res.err);
  console.log('  desenlaces: ' + Object.entries(res.tally).map(([k, v]) => k + '=' + v).join('  '));
  for (const s of res.sample) console.log('  muestra ' + JSON.stringify(s));
  // robustness by start state: how many plans win, over which timings
  const by = {};
  for (const w of res.wins) {
    const k = w.x0 + '@' + w.feet;
    const o = by[k] || (by[k] = { n: 0, tgo: [], dj: new Set(), t: [] });
    o.n++; o.tgo.push(w.tgo); o.dj.add(w.dj); o.t.push(w.t);
  }
  const total = res.n / STARTS.length;
  for (const st of STARTS) {
    const k = st.x + '@' + st.feet, o = by[k];
    if (!o) { console.log('  x=' + String(st.x).padStart(3) + ' pies=' + st.feet + '   sin planes ganadores'); continue; }
    console.log('  x=' + String(st.x).padStart(3) + ' pies=' + st.feet + '  gana ' + String(o.n).padStart(3) + '/' + total +
      '  tgo=[' + Math.min(...o.tgo).toFixed(1) + '..' + Math.max(...o.tgo).toFixed(1) + ']' +
      '  dj={' + [...o.dj].sort((a, b) => a - b).join(',') + '}' +
      '  t=[' + Math.min(...o.t).toFixed(2) + '..' + Math.max(...o.t).toFixed(2) + ']');
  }
  if (!res.wins.length) {
    console.log('  ningún plan gana. los que llegaron a <60px del jefe:');
    for (const w of res.near) {
      console.log('   x0=' + String(w.x0).padStart(3) + ' tgo=' + w.tgo.toFixed(1) +
        ' dj=' + String(w.dj).padStart(3) + ' hold=' + w.hold + ' dir=' + (w.steer ? 's' : 'n') +
        '  minD=' + w.minD + ' golpes=' + w.hurt + ' estado=' + w.st + ' t=' + w.t);
    }
  }
  if (errs.length) console.log('errores de página: ' + errs.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('PLAN3 FALLÓ: ' + e.message); process.exit(9); });
