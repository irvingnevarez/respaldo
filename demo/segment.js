// Records ONE segment of the highlight reel.
//
//   node segment.js <levelIdx> <seconds> <outfile> [scale] [title] [skipSec] [lives]
//
//     levelIdx  0-7, or -1 for the title card on its own
//     seconds   how much gameplay to capture
//     scale     deviceScaleFactor: 4/3 -> 1280x720, 2 -> 1920x1080
//     title     "1" to hold on the title screen first (only meaningful for 0)
//     skipSec   fast-forward this many seconds of simulation BEFORE recording,
//               so a segment can start at the interesting part of a level
//     lives     starting lives, so one slip does not end a segment early
//
// Time is frozen the same way the full recorder does it: rAF becomes a manually
// flushed queue, so the game advances exactly 1/60s per captured frame however
// slowly the software renderer actually draws it.

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const GROOT = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(GROOT, 'playwright'));
// Prefer the pinned ffmpeg-static if the project has it, otherwise fall back to
// whatever ffmpeg the machine provides. A container rebuild once took
// node_modules with it and every recording tool died on ENOENT.
const FFMPEG = (function () {
  const local = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(local)) return local;
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no encuentro ffmpeg');
})();

const LV = parseInt(process.argv[2], 10);
const SECS = parseFloat(process.argv[3]);
const OUT = process.argv[4];
const SCALE = parseFloat(process.argv[5] || (4 / 3).toString());
const TITLE = process.argv[6] === '1';
const SKIP = parseFloat(process.argv[7] || '0');
const LIVES = parseInt(process.argv[8] || '3', 10);

const FPS = 60, JPEG_Q = 0.95;
const TOTAL = Math.round(SECS * FPS);

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'aprollout.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(__dirname, 'autopilot.js'), 'utf8') + '\n;\n' +
    // policy-penguin.js defines AP_BOSS and the shared emit machinery, and
    // dispatches to BJ_joker; the Joker's policy has to be loaded after it. Until
    // this line existed the reel could not record the final boss at all.
    ['policy-penguin.js', 'policy-joker.js']
      .map(f => fs.existsSync(path.join(__dirname, f))
        ? fs.readFileSync(path.join(__dirname, f), 'utf8') : '')
      .join('\n;\n');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 760 }, deviceScaleFactor: SCALE,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    window.__capture = true;
    window.__q = [];
    window.requestAnimationFrame = function (cb) { window.__q.push(cb); return window.__q.length; };
    window.cancelAnimationFrame = function () { };
    window.__flush = function (ts) {
      const q = window.__q; window.__q = [];
      for (let i = 0; i < q.length; i++) { try { q[i](ts); } catch (e) { } }
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'game.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

  await page.evaluate(a => {
    // eslint-disable-next-line no-eval
    (0, eval)(a[0]);
    window.__pj = false;
    window.__tick = function (ts, tick, freeze) {
      const g = window.__game;
      let act = { L: false, R: false, run: false, jump: false };
      if (!freeze && g) { try { act = AUTOPILOT(g, tick) || act; } catch (e) { } }
      IN.L = !!act.L; IN.R = !!act.R; IN.run = !!act.run;
      if (act.jump && !window.__pj) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
      IN.jumpHeld = !!act.jump; window.__pj = !!act.jump;
      window.__flush(ts);
    };
    // Fast-forward without drawing: the renderer is the slow part, and a
    // skipped second must not cost a second of wall clock.
    window.__ff = function (frames, fps) {
      const g = window.__game, real = g.draw;
      g.draw = function () { };
      for (let i = 0; i < frames; i++) window.__tick(i * (1000 / fps), i, false);
      g.draw = real;
      return frames;
    };
    window.__grab = function (ts, tick, freeze, jq) {
      window.__tick(ts, tick, freeze);
      const g = window.__game, p = g && g.player, b = g && g.boss;
      return {
        st: g.state, lvl: g.lvIdx, score: g.score, lives: g.lives,
        x: p ? Math.round(p.rect.x) : 0, bossHp: b ? b.hp : -1,
        jpg: document.getElementById(window.__postfxOn ? 'fx' : 'gc').toDataURL('image/jpeg', jq),
      };
    };
  }, [src]);

  // With a title card we must NOT start the run: the autopilot's own title
  // branch pulses the jump button, so the game starts itself the moment the
  // freeze lifts. Forcing state='play' up front recorded a frozen level 1
  // instead of the title screen.
  if (LV >= 0 && !TITLE) {
    await page.evaluate(a => {
      const g = window.__game;
      g.startRun(); g.lives = a[1]; g.lvIdx = a[0]; g.loadLevel(a[0]); g.state = 'play';
    }, [LV, LIVES]);
    if (SKIP > 0) await page.evaluate(n => window.__ff(n, 60), Math.round(SKIP * FPS));
  }

  const ff = spawn(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
  ]);
  ff.stderr.on('data', d => process.stderr.write(d));
  const done = new Promise((res, rej) => {
    ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    ff.on('error', rej);
  });
  const write = b => (ff.stdin.write(b) ? Promise.resolve() : new Promise(r => ff.stdin.once('drain', r)));

  const base = Math.round(SKIP * FPS);
  const t0 = Date.now();
  let last = null;
  for (let i = 0; i < TOTAL; i++) {
    const info = await page.evaluate(
      a => window.__grab(a[0], a[1], a[2], a[3]),
      [(base + i) * (1000 / FPS), base + i, LV < 0 || (TITLE && i < Math.round(3.4 * FPS)), JPEG_Q]
    );
    await write(Buffer.from(info.jpg.slice(info.jpg.indexOf(',') + 1), 'base64'));
    last = info;
    if (i % 300 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log('   ' + path.basename(OUT) + ' ' + i + '/' + TOTAL +
        '  ' + info.st + ' x=' + info.x + ' pts=' + info.score +
        ' vidas=' + info.lives + (info.bossHp >= 0 ? ' jefe=' + info.bossHp : '') +
        '  [' + el.toFixed(0) + 's]');
    }
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log('  -> ' + path.basename(OUT) + '  ' + (TOTAL / FPS).toFixed(1) + 's  ' +
    (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB  final: ' +
    (last ? last.st + ' pts=' + last.score + ' vidas=' + last.lives : '?') +
    '  errores=' + errors.length);
})().catch(e => { console.error('SEGMENT FAILED: ' + e.message); process.exit(9); });
