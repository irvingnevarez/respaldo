// Records ONE continuous playthrough — title card, all eight levels, both boss
// fights, the win screen — straight into ffmpeg.
//
//   node movie.js [outfile] [scale] [maxMinutes] [startLevel]
//
// Time is frozen: requestAnimationFrame becomes a manually flushed queue, so
// the game advances exactly 1/60s per captured frame however slowly the
// software renderer actually draws it. The result is smooth 60fps regardless.
//
// The run is continuous on purpose. Level-complete cards, the boss intros and
// the win screen are part of the show, and splicing separate recordings would
// lose them — and lose the running score, which is the thread that makes a
// playthrough read as one performance.

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const GROOT = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(GROOT, 'playwright'));
const FFMPEG = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg');

const OUT = process.argv[2] || path.join(__dirname, 'batman-completo.mp4');
const SCALE = parseFloat(process.argv[3] || '2');      // 2 -> 1920x1080
const MAXMIN = parseFloat(process.argv[4] || '14');
const START = parseInt(process.argv[5] || '0', 10);

const FPS = 60;
const TOTAL = Math.round(MAXMIN * 60 * FPS);
const INTRO = Math.round(3.2 * FPS);        // hold on the title card
const TAIL = Math.round(6.0 * FPS);         // linger on the win screen
const JPEG_Q = 0.95;

(async () => {
  const autopilotSrc = fs.readFileSync(path.join(__dirname, 'aprollout.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(__dirname, 'autopilot.js'), 'utf8');
  let policySrc = '';
  for (const f of ['policy-penguin.js', 'policy-joker.js']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) policySrc += '\n;\n' + fs.readFileSync(p, 'utf8');
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 760 },
    deviceScaleFactor: SCALE,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    window.__capture = true;        // readable drawing buffer + no quality watchdog
    window.__q = [];
    window.requestAnimationFrame = function (cb) { window.__q.push(cb); return window.__q.length; };
    window.cancelAnimationFrame = function () { };
    window.__flush = function (ts) {
      const q = window.__q; window.__q = [];
      for (let i = 0; i < q.length; i++) {
        try { q[i](ts); } catch (e) { if (!window.__loopErr) window.__loopErr = e.message; }
      }
    };
  });

  await page.goto('file://' + path.join(__dirname, 'game.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

  await page.evaluate(a => {
    // eslint-disable-next-line no-eval
    (0, eval)(a[0] + a[1]);
    window.__prevJump = false;
    window.__drive = function (ts, tick, freeze, jq) {
      const g = window.__game;
      let act = { L: false, R: false, run: false, jump: false };
      if (!freeze && g) { try { act = AUTOPILOT(g, tick) || act; } catch (e) { } }
      IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
      if (act.jump && !window.__prevJump) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
      IN.jumpHeld = !!act.jump;
      window.__prevJump = !!act.jump;
      window.__flush(ts);
      const p = g && g.player, b = g && g.boss;
      return {
        st: g ? g.state : '?', lvl: g ? g.lvIdx : 0,
        score: g ? g.score : 0, lives: g ? g.lives : 0, rangs: g ? g.rangs : 0,
        x: p ? Math.round(p.rect.x) : 0,
        big: !!(p && p.big), star: !!(p && p.star > 0),
        bossHp: b ? b.hp : -1, bossPhase: b ? b.phase : 0,
        // with post-processing on, the graded frame is the WebGL canvas
        jpg: document.getElementById(window.__postfxOn ? 'fx' : 'gc').toDataURL('image/jpeg', jq),
      };
    };
  }, [autopilotSrc, policySrc]);

  if (START > 0) {
    await page.evaluate(lv => {
      const g = window.__game;
      g.startRun(); g.lvIdx = lv; g.loadLevel(lv); g.state = 'play';
    }, START);
  }

  const ff = spawn(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    OUT,
  ]);
  ff.stderr.on('data', d => process.stderr.write(d));
  const ffDone = new Promise((res, rej) => {
    ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
    ff.on('error', rej);
  });
  const writeFrame = buf => (ff.stdin.write(buf) ? Promise.resolve() : new Promise(r => ff.stdin.once('drain', r)));

  const events = [];
  let prev = { score: 0, lives: 3, big: false, star: false, lvl: START, st: 'title', bossHp: -1 };
  let frames = 0, winAt = -1;
  const t0 = Date.now();

  for (let i = 0; i < TOTAL; i++) {
    const info = await page.evaluate(
      a => window.__drive(a[0], a[1], a[2], a[3]),
      [i * (1000 / FPS), i, START === 0 && i < INTRO, JPEG_Q]
    );
    await writeFrame(Buffer.from(info.jpg.slice(info.jpg.indexOf(',') + 1), 'base64'));
    frames++;

    const at = +(i / FPS).toFixed(2);
    if (info.lives < prev.lives) events.push({ t: at, k: 'MUERTE', lvl: info.lvl + 1 });
    if (info.big && !prev.big) events.push({ t: at, k: 'BATTRAJE' });
    if (info.star && !prev.star) events.push({ t: at, k: 'ESTRELLA' });
    if (info.lvl !== prev.lvl) events.push({ t: at, k: 'NIVEL', d: info.lvl + 1 });
    if (info.bossHp >= 0 && prev.bossHp >= 0 && info.bossHp < prev.bossHp)
      events.push({ t: at, k: 'GOLPE-JEFE', d: info.bossHp });
    if (info.st !== prev.st) events.push({ t: at, k: 'estado:' + info.st });
    if (info.st === 'win' && winAt < 0) winAt = i;
    prev = info;

    if (i % 600 === 0) {
      const el = (Date.now() - t0) / 1000;
      const rate = frames / Math.max(1, el);
      console.log('  f' + String(i).padStart(6) + '/' + TOTAL + '  ' + at.toFixed(1) + 's  ' +
        info.st + ' N' + (info.lvl + 1) + '  x=' + info.x + '  pts=' + info.score +
        '  vidas=' + info.lives + (info.star ? '  STAR' : '') + (info.big ? '  BIG' : '') +
        '   [' + el.toFixed(0) + 's, ' + rate.toFixed(1) + ' f/s]');
    }

    if (winAt >= 0 && i >= winAt + TAIL) { console.log('  fin: pantalla de victoria'); break; }
    if (info.st === 'over') { console.log('  ABORTADO: game over en el nivel ' + (info.lvl + 1)); break; }
  }

  ff.stdin.end();
  await ffDone;
  await browser.close();

  const dur = frames / FPS;
  fs.writeFileSync(path.join(__dirname, 'movie-events.json'),
    JSON.stringify({ frames, fps: FPS, duration: dur, events }, null, 1));
  const sz = fs.statSync(OUT).size / 1048576;
  console.log('\n' + frames + ' cuadros = ' + dur.toFixed(1) + 's -> ' + OUT + '  (' + sz.toFixed(1) + ' MB)');
  console.log('puntos ' + prev.score + ', vidas ' + prev.lives +
    ', muertes ' + events.filter(e => e.k === 'MUERTE').length);
  console.log('hitos: ' + events.filter(e => e.k !== 'estado:play').map(e => e.k + (e.d ? ' ' + e.d : '') + '@' + e.t + 's').join('  '));
  console.log('errores de página: ' + errors.length);
  errors.slice(0, 5).forEach(e => console.log('  ' + e));
})().catch(e => { console.error('MOVIE FAILED: ' + e.message); process.exit(9); });
