// Can the bot stomp the Penguin's slam, and from where?
//
//   node planpeng.js [phase]
//
// Same method that cracked the Joker's last hit: replay OPEN-LOOP plans against
// the real engine instead of reasoning about it. A plan is "stand D pixels from
// him, press jump tj seconds into the telegraph, hold it, optionally steer
// onto his column in the air". Phase 3 has one hit point left, so a stomp
// anywhere in the dazed window ends the fight; a plan wins if he falls and the
// player was never touched.
//
// Why this is the interesting case: the slam spawns shockwaves at his feet the
// instant he lands, so a player standing next to him is hit within 0.04s, and
// one standing far away cannot reach his head inside the 1.6s window. The
// answer has to be airborne-at-impact, and where that lands is a number to be
// measured, not argued.
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const PHASE = parseInt(process.argv[2] || '3', 10);
const XB = [240, 480, 720];                    // where he slams
const DS = []; for (let d = 40; d <= 220; d += 10) DS.push(d);
const TJ = []; for (let t = 0.45; t <= 1.0501; t += 0.025) TJ.push(+t.toFixed(3));
const HOLD = [22, 12];
const STEER = [0, 1];

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
    let TS = 1000;                      // monotonic across trials (see plan3.js)

    function trial(xb, side, D, tj, hold, steer) {
      g.startRun(); g.lvIdx = 3; g.loadLevel(3); g.state = 'play'; g.lives = 9999;
      const bo = g.boss, pl = g.player;
      bo.hp = cfg.phase === 3 ? 1 : (cfg.phase === 2 ? 2 : 3);
      bo.phase = cfg.phase; bo.introT = 99; bo.proj.length = 0; bo.waves.length = 0;
      bo.rect.x = xb - bo.rect.w / 2; bo.rect.y = 110 - 22;
      bo.setState('telegraph');
      g.enemies.length = 0;
      pl.rect.x = Math.max(40, Math.min(890, xb + side * D)) - pl.rect.w / 2;
      pl.rect.y = 480 - pl.rect.h; pl.vx = 0; pl.vy = 0;

      let hurt = 0;
      const rh = pl.hurt.bind(pl);
      pl.hurt = function (gg) { hurt++; return rh(gg); };

      let jf = 0, jumped = false, pj = false, tTel = 0, stompT = -1, minD = 1e9;
      for (let i = 0; i < 60 * 4; i++) {
        const dx = bo.rect.cx - pl.rect.cx;
        if (bo.state === 'telegraph') tTel = bo.t;
        else if (bo.state === 'slam') tTel = 0.8 + bo.t;
        else tTel = 9;
        let L = 0, R = 0, jump = 0;
        if (!jumped && tTel >= tj) { jumped = true; jf = hold; }
        if (jf > 0) { jump = 1; jf--; }
        if (steer && !pl.onGround) { R = dx > 6 ? 1 : 0; L = dx < -6 ? 1 : 0; }
        IN.L = !!L; IN.R = !!R; IN.run = false;
        if (jump && !pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
        IN.jumpHeld = !!jump; pj = !!jump;
        window.__flush(TS); TS += 1000 / 60;
        if (bo.state === 'dazed' || bo.state === 'slam') minD = Math.min(minD, Math.abs(bo.rect.cx - pl.rect.cx));
        if (bo.defeated || bo.hp < (cfg.phase === 3 ? 1 : (cfg.phase === 2 ? 2 : 3))) {
          return { win: hurt === 0, hurt, t: +(i / 60).toFixed(2) };
        }
        if (hurt > 0) return { win: false, hurt, t: +(i / 60).toFixed(2), st: bo.state, minD: Math.round(minD) };
      }
      return { win: false, hurt: 0, t: 4, st: 'sin-golpe', minD: Math.round(minD) };
    }

    const wins = [], tally = {};
    let n = 0;
    for (const xb of cfg.XB) for (const side of [-1, 1]) for (const D of cfg.DS)
      for (const tj of cfg.TJ) for (const hold of cfg.HOLD) for (const steer of cfg.STEER) {
        n++;
        const r = trial(xb, side, D, tj, hold, steer);
        const key = r.win ? 'GANA' : (r.hurt ? 'golpe@' + r.st : r.st);
        tally[key] = (tally[key] || 0) + 1;
        if (r.win) wins.push({ xb, side, D, tj, hold, steer, t: r.t });
      }
    return { n, wins, tally, err: window.__err || null };
  }, { phase: PHASE, XB, DS, TJ, HOLD, STEER });

  console.log('fase=' + PHASE + '  planes=' + res.n + '  GANADORES=' + res.wins.length);
  console.log('  desenlaces: ' + Object.entries(res.tally).map(([k, v]) => k + '=' + v).join('  '));
  if (res.err) console.log('ERROR bucle: ' + res.err);

  // robustness map: for each (xb, side, D) how many of the (tj, hold, steer)
  // combinations win, and over which jump times
  const by = {};
  for (const w of res.wins) {
    const k = w.xb + (w.side < 0 ? 'L' : 'R') + String(w.D).padStart(3);
    const o = by[k] || (by[k] = { n: 0, tj: [], steer: new Set(), hold: new Set() });
    o.n++; o.tj.push(w.tj); o.steer.add(w.steer); o.hold.add(w.hold);
  }
  const perCell = TJ.length * HOLD.length * STEER.length;
  for (const xb of XB) {
    for (const side of [-1, 1]) {
      const row = [];
      for (const D of DS) {
        const o = by[xb + (side < 0 ? 'L' : 'R') + String(D).padStart(3)];
        row.push(String(D).padStart(3) + ':' + (o ? String(Math.round(100 * o.n / perCell)).padStart(2) : ' .'));
      }
      console.log('  xb=' + String(xb).padStart(3) + (side < 0 ? ' izq' : ' der') + '  D:%ganan  ' + row.join(' '));
    }
  }
  // the most forgiving single cell, in detail
  let best = null;
  for (const [k, o] of Object.entries(by)) if (!best || o.n > best.o.n) best = { k, o };
  if (best) {
    console.log('  mejor celda ' + best.k + ': ' + best.o.n + '/' + perCell + ' planes,  tj=[' +
      Math.min(...best.o.tj).toFixed(3) + '..' + Math.max(...best.o.tj).toFixed(3) + ']  hold={' +
      [...best.o.hold].join(',') + '}  dirigir={' + [...best.o.steer].join(',') + '}');
  }
  if (errs.length) console.log('errores de página: ' + errs.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('PLANPENG FALLÓ: ' + e.message); process.exit(9); });
