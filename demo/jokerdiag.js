// What is actually killing the bot in the Joker fight?
//
//   node jokerdiag.js [seconds]
//
// Wraps the player's hurt() and, at the instant it fires, re-runs the engine's
// own collision tests to say WHICH one would have been true: boss contact, a
// card, a shockwave or the gas. Three rounds of reasoning about card arcs
// produced two wrong answers in a row, so this stops arguing and reads it off
// the frame where it happens.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const SECS = parseFloat(process.argv[2] || '60');

(async () => {
  const src = ['aprollout.js', 'autopilot.js', 'policy-penguin.js', 'policy-joker.js']
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n;\n');

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

  const out = await page.evaluate(a => {
    (0, eval)(a[0]);
    const g = window.__game;
    g.draw = function () { };
    g.startRun(); g.lvIdx = 7; g.loadLevel(7); g.state = 'play';
    const p = g.player;
    g.lives = 99;
    let reloads = 0;
    const realLoad = g.loadLevel.bind(g);
    g.loadLevel = function (i) { reloads++; return realLoad(i); };                       // keep going so we see every hit, not just three

    const hits = [];
    let frame = 0;
    // Re-attach after every respawn. A level reload builds a NEW player object,
    // so a wrapper installed once silently stops recording after the first
    // death -- which is how "1 hit in 60 seconds" got reported for a bot that
    // was dying every four seconds.
    let wrapped = null;
    function attach() {
      const pl = g.player;
      if (!pl || pl === wrapped) return;
      wrapped = pl;
      const realHurt = pl.hurt.bind(pl);
      pl.hurt = function (game) { return onHurt(pl, realHurt, game); };
    }
    function onHurt(p, realHurt, game) {
      const b = g.boss;
      const why = [];
      if (b) {
        if (b.contactHurts && p.rect.hits(b.rect)) why.push('CONTACTO jefe');
        for (const pr of b.proj) {
          if (!pr.alive) continue;
          if (pr.kind === 'bomb' && pr.blast <= 0) continue;
          if (p.rect.hits(pr.rect)) {
            why.push(pr.kind + ' dx=' + Math.round(pr.rect.cx - p.rect.cx) +
                     ' dy=' + Math.round(pr.rect.cy - p.rect.cy) +
                     ' vx=' + Math.round(pr.vx) + ' vy=' + Math.round(pr.vy));
          }
        }
        for (const wv of b.waves) if (wv.alive && p.rect.hits(wv.rect)) why.push('onda');
        if (b.gasY < 540 && p.rect.b > b.gasY + 6) {
          why.push('GAS pies=' + Math.round(p.rect.b) + ' gas=' + Math.round(b.gasY));
        }
      }
      // enemy minions are handled by the game, not the boss
      for (const e of g.enemies) {
        if (e.alive && !e.dying && p.rect.hits(e.rect)) why.push('esbirro');
      }
      hits.push({
        t: +(frame / 60).toFixed(2),
        hp: b ? b.hp : -1, fase: b ? b.phase : -1, estado: b ? b.state : '-',
        px: Math.round(p.rect.cx), pb: Math.round(p.rect.b),
        bx: b ? Math.round(b.rect.cx) : -1, by: b ? Math.round(b.rect.y) : -1,
        porque: why.length ? why.join(' | ') : '??? ninguna prueba dio positivo',
        why: typeof BJ_why !== 'undefined' ? BJ_why : '-',
      });
      return realHurt(game);
    }
    attach();

    window.__pj = false;
    const trace = [];
    let prevState = '';
    for (let i = 0; i < a[1]; i++) {
      frame = i; attach();
      let act = { L: 0, R: 0, run: 0, jump: 0 };
      try { act = AUTOPILOT(g, i) || act; } catch (e) { if (!window.__ae) window.__ae = e.message; }
      // One line per vulnerable window: did we line up, did we jump, how high?
      const b0 = g.boss;
      if (b0 && b0.state !== prevState) {
        if (b0.vulnerable || prevState === 'taunt' || prevState === 'arrive' || prevState === 'throw') {
          trace.push({ t: +(i / 60).toFixed(2), de: prevState, a: b0.state, hp: b0.hp, f: b0.phase,
                       dx: Math.round(b0.rect.cx - p.rect.cx), pb: Math.round(p.rect.b),
                       by: Math.round(b0.rect.y), air: !p.onGround, pol: typeof BJ_why !== 'undefined' ? BJ_why : '-' });
        }
        prevState = b0.state;
      }
      IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
      if (act.jump && !window.__pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
      IN.jumpHeld = !!act.jump; window.__pj = !!act.jump;
      window.__flush(i * (1000 / 60));
      if (g.boss && g.boss.defeated) break;
    }
    const b = g.boss;
    return {
      hits: hits, trace: trace, recargas: reloads,
      hp: b ? b.hp : -1, fase: b ? b.phase : -1, vencido: b ? b.defeated : false,
      seg: +(frame / 60).toFixed(1),
      apErr: window.__ae || null, loopErr: window.__err || null,
    };
  }, [src, Math.round(SECS * 60)]);

  console.log('recargas(muertes): ' + out.recargas);
  console.log('golpes recibidos: ' + out.hits.length +
    '   jefe hp=' + out.hp + ' fase=' + out.fase + ' vencido=' + out.vencido +
    '   t=' + out.seg + 's');
  if (out.apErr) console.log('ERROR autopilot: ' + out.apErr);
  if (out.loopErr) console.log('ERROR bucle: ' + out.loopErr);
  for (const h of out.hits.slice(0, 24)) {
    console.log('  t=' + String(h.t).padStart(6) + ' f' + h.fase + ' ' + h.estado.padEnd(9) +
      ' hp' + h.hp + ' pol=' + String(h.why).padEnd(7) +
      ' p(' + h.px + ',' + h.pb + ') b(' + h.bx + ',' + h.by + ')  ' + h.porque);
  }
  console.log('--- ventanas vulnerables ---');
  for (const r of out.trace.slice(0, 26)) {
    console.log('  t=' + String(r.t).padStart(6) + ' f' + r.f + ' hp' + r.hp + ' ' +
      String(r.de).padEnd(9) + '->' + String(r.a).padEnd(9) +
      ' dx=' + String(r.dx).padStart(5) + ' pies=' + String(r.pb).padStart(4) +
      ' jefeY=' + String(r.by).padStart(4) + ' aire=' + (r.air ? 'si' : 'no') + ' pol=' + r.pol);
  }
  if (errs.length) console.log('errores de página: ' + errs.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('DIAG FAILED: ' + e.message); process.exit(9); });
