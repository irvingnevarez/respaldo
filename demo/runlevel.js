// Runs ONE level start-to-finish under the autopilot, deterministically, and
// reports whether it was cleared and — if not — exactly where and how it died.
//
//   node runlevel.js <levelIndex 0..7> [maxSeconds] [--trace]
//
// Success for a normal level is reaching the beacon (state 'clear'); for a boss
// arena it is the boss being defeated, which also ends in 'clear'.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const LV = parseInt(process.argv[2] || '0', 10);
// --bot lets an agent iterate on its own copy of the bot without touching the
// shared one; --policy appends an extra script that may define AP_BOSS.
function flagVal(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const BOT = flagVal('--bot', 'autopilot.js');
const POLICY = flagVal('--policy', null);
const LIVES = parseInt(flagVal('--lives', '3'), 10);
const SECS = parseFloat(process.argv[3] || '75');
const TRACE = process.argv.indexOf('--trace') >= 0;
const FPS = 60, TOTAL = Math.round(SECS * FPS);

(async () => {
  let src = fs.readFileSync(path.join(__dirname, 'aprollout.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(__dirname, BOT), 'utf8');
  // --policy takes a comma-separated list: AP_BOSS lives in policy-penguin.js
  // and dispatches to the per-boss policies, so both have to be loaded.
  if (POLICY) {
    for (const f of POLICY.split(',')) {
      src += '\n;\n' + fs.readFileSync(path.join(__dirname, f.trim()), 'utf8');
    }
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.addInitScript(() => {
    window.__capture = true;             // inhibit the quality watchdog
    window.__q = [];
    window.requestAnimationFrame = function (cb) { window.__q.push(cb); return 1; };
    window.cancelAnimationFrame = function () { };
    window.__flush = function (ts) {
      const q = window.__q; window.__q = [];
      for (let i = 0; i < q.length; i++) {
        try { q[i](ts); } catch (e) { if (!window.__loopErr) window.__loopErr = e.message + ' | ' + (e.stack || '').split('\n')[1]; }
      }
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'game.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

  await page.evaluate(a => {
    // eslint-disable-next-line no-eval
    (0, eval)(a[0]);
    const g = window.__game;
    // The autopilot only ever reads simulation state, so rendering is pure
    // overhead here — and on this software renderer it is 95% of the frame
    // time. Stubbing draw() takes a 75-second level from ~5 minutes of wall
    // clock to a few seconds, which is what makes iterating on the bot viable.
    g.draw = function () { };
    g.startRun();
    g.lives = a[2];
    g.lvIdx = a[1];
    g.loadLevel(a[1]);
    g.state = 'play';
    window.__pj = false;
    window.__step = function (ts, tick) {
      const gg = window.__game;
      let act = { L: false, R: false, run: false, jump: false };
      try { act = AUTOPILOT(gg, tick) || act; } catch (e) { }
      IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
      if (act.jump && !window.__pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
      IN.jumpHeld = !!act.jump; window.__pj = !!act.jump;
      window.__flush(ts);
      const p = gg.player;
      const b = gg.boss;
      return {
        st: gg.state, lives: gg.lives, score: gg.score,
        x: p ? Math.round(p.rect.x) : -1,
        y: p ? Math.round(p.rect.y) : -1,
        vx: p ? Math.round(p.vx) : 0,
        vy: p ? Math.round(p.vy) : 0,
        onG: p ? !!p.onGround : false,
        dead: p ? !!p.dead : false,
        big: p ? !!p.big : false,
        star: p ? +(p.star || 0).toFixed(1) : 0,
        act: (act.L ? 'L' : '') + (act.R ? 'R' : '') + (act.run ? '+run' : '') + (act.jump ? '+JMP' : ''),
        boss: b ? { hp: b.hp, phase: b.phase, state: b.state, vuln: !!b.vulnerable,
                    bx: Math.round(b.rect.x), by: Math.round(b.rect.y),
                    proj: b.proj.length, waves: b.waves.length,
                    gas: Math.round(b.gasY),
                    pj: b.proj.map(q => q.kind[0] + Math.round(q.rect.cx - (p ? p.rect.cx : 0)) +
                        (q.blast > 0 ? 'BLAST' : '') + '/' + Math.round(q.rect.cy)).join(' ') } : null,
        ap: window.__ap || null,
        bp: window.__bp || null,
        near: gg.enemies.filter(e => e.alive && p && Math.abs(e.rect.cx - p.rect.cx) < 150)
          .map(e => e.kind + '@' + Math.round(e.rect.cx - p.rect.cx)),
      };
    };
    // Batch the stepping inside the page. One round-trip per frame made a
    // 75-second level take several minutes of wall clock; the autopilot has to
    // be iterated on dozens of times, so the harness has to be cheap.
    window.__runChunk = function (startTick, count, fps) {
      const out = [];
      for (let i = 0; i < count; i++) {
        const tick = startTick + i;
        const s = window.__step(tick * (1000 / fps), tick);
        s.f = tick;
        out.push(s);
        if (s.st === 'clear' || s.st === 'over') break;
      }
      return out;
    };
  }, [src, LV, LIVES]);

  const hist = [];
  let cleared = false, clearFrame = -1, deaths = 0, lastLives = LIVES;
  let maxX = 0, stalledSince = 0, stallFrame = -1, firstDeath = -1, lastHp = -1;
  const hits = [], deathAt = [];
  const CHUNK = 120;

  outer:
  for (let base = 0; base < TOTAL; base += CHUNK) {
    const batch = await page.evaluate(a => window.__runChunk(a[0], a[1], a[2]),
      [base, Math.min(CHUNK, TOTAL - base), FPS]);
    for (const s of batch) {
      hist.push(s);
      if (s.x > maxX) { maxX = s.x; stalledSince = s.f; }
      if (stallFrame < 0 && s.f - stalledSince > 60 * 12) stallFrame = s.f;
      if (s.boss && lastHp >= 0 && s.boss.hp < lastHp) hits.push(+(s.f/FPS).toFixed(1));
      if (s.boss) lastHp = s.boss.hp;
      if (s.lives < lastLives) { deaths++; deathAt.push(+(s.f/FPS).toFixed(1)); lastLives = s.lives; if (firstDeath < 0) firstDeath = s.f; }
      if (s.st === 'clear') { cleared = true; clearFrame = s.f; break outer; }
      if (s.st === 'over') break outer;
      // a boss arena never scrolls, so x-stall is not a failure there; give up
      // on a normal level that has not advanced in 12 seconds
      if (stallFrame > 0 && !s.boss) break outer;
    }
  }
  const apErr = await page.evaluate(() => window.__apErr || null);
  await browser.close();

  const loopErr = await Promise.resolve(null);
  const last = hist[hist.length - 1] || {};
  const out = {
    level: LV,
    cleared: cleared,
    seconds: +((clearFrame < 0 ? hist.length : clearFrame) / FPS).toFixed(2),
    deaths: deaths,
    finalState: last.st,
    maxX: maxX,
    stalled: stallFrame > 0,
    boss: last.boss || null,
    bossHitsAt: hits, deathsAt: deathAt,
    firstDeathAt: firstDeath < 0 ? null : +(firstDeath / FPS).toFixed(2),
    pageErrors: errs.length,
    apError: apErr,
  };
  console.log(JSON.stringify(out));

  if (TRACE) {
    // print the run-up to the first death, or the tail if it never died
    let anchor = -1, lv = 3;
    for (const h of hist) { if (h.lives < lv) { anchor = h.f; break; } lv = h.lives; }
    if (anchor < 0) anchor = hist.length - 1;
    console.log('\n   f     t      x    y   vx   vy onG  act        boss / nearby');
    hist.slice(Math.max(0, anchor - 70), anchor + 4).forEach(h => {
      console.log(
        String(h.f).padStart(4) + ' ' + (h.f / FPS).toFixed(2).padStart(5) +
        String(h.x).padStart(7) + String(h.y).padStart(5) +
        String(h.vx).padStart(5) + String(h.vy).padStart(5) +
        (h.onG ? '   Y' : '   .') + '  ' + (h.act || '-').padEnd(10) + ' ' +
        (h.boss ? 'hp' + h.boss.hp + ' p' + h.boss.phase + ' ' + h.boss.state +
          (h.boss.vuln ? ' VULN' : '') + ' pr[' + h.boss.pj + '] wv' + h.boss.waves : '') +
        ' ' + (h.ap ? 'wj' + h.ap.wj + (h.ap.gL ? ' goL' : '') + (h.ap.brk ? ' BRK' : '') +
          (h.ap.beh ? ' beh' : '') + (h.ap.thr ? ' thr' : '') + (h.ap.pn ? ' PIT' : '') +
          (h.ap.tgt >= 0 ? ' tgt' + h.ap.tgt : '') : '') +
        ' ' + (h.bp||'') + ' ' + h.near.join(' '));
    });
  }
})().catch(e => { console.error('RUNLEVEL FAILED: ' + e.message); process.exit(9); });
