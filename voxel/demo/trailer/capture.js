// Records shots of the trailer from the real game, frame by frame.
//   node voxel/demo/trailer/capture.js <from> <to> <out-prefix> [W H FPS] [--stills N]
// Shots [from, to) are played in order in one page (so a shot can continue the
// one before it). Video goes to <out>.mp4 through ffmpeg, the sound log and the
// player telemetry to <out>.json. With --stills N it renders only N frames per
// shot, as JPEGs, for a quick storyboard; the simulation still runs every frame.
const { execSync, spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const args = process.argv.slice(2);
const stillsI = args.indexOf('--stills'); const STILLS = stillsI >= 0 ? +args[stillsI + 1] : 0;
if (stillsI >= 0) args.splice(stillsI, 2);
const FROM = +args[0], TO = +args[1], OUT = args[2];
const W = +(args[3] || 1920), H = +(args[4] || 1080), FPS = +(args[5] || 30);
const PAGE = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = ['pilot.js', 'director.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n;\n');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message + (e.stack ? ' @ ' + e.stack.split('\n')[1] : '')));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__capture = true; });
  await page.goto('file://' + PAGE, { waitUntil: 'load' });
  await page.addStyleTag({ content: 'html,body{padding:0!important;margin:0!important;display:block!important;background:#000!important}#stage{width:' + W + 'px!important;height:' + H + 'px!important;max-width:none!important;aspect-ratio:auto!important;border-radius:0!important;box-shadow:none!important}#rail,#touch,#boot{display:none!important}' });
  await page.waitForFunction(() => window.__vx, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.addScriptTag({ content: SRC });
  const shots = await page.evaluate(o => TR_init(o), { W, H, FPS });
  const ready = async () => { try { await page.waitForFunction(() => __vx.ready(), null, { timeout: 180000, polling: 60 }); } catch (e) { console.log('   (aviso) el mundo no terminó de cargar'); } };

  let ff = null, write = null, done = null;
  if (!STILLS) {
    ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT + '.mp4']);
    ff.stderr.on('data', d => process.stderr.write(d));
    done = new Promise((res, rej) => { ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))); ff.on('error', rej); });
    write = b => (ff.stdin.write(b) ? Promise.resolve() : new Promise(r => ff.stdin.once('drain', r)));
  }
  const t0 = Date.now();
  let frames = 0;
  for (let i = FROM; i < TO; i++) {
    const b = await page.evaluate(i => TR_begin(i), i);
    await ready();
    const pick = new Set();
    if (STILLS) for (let k = 0; k < STILLS; k++) pick.add(Math.min(b.frames - 1, Math.round((k + 0.5) * b.frames / STILLS)));
    for (let f = 0; f < b.frames; f++) {
      await page.evaluate(() => TR_advance());
      if (STILLS && !pick.has(f)) continue;
      const fresh = await page.evaluate(() => __vx.ready());
      if (!fresh) await ready();
      const url = await page.evaluate(q => TR_render(q), STILLS ? 0.85 : 0.93);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (STILLS) fs.writeFileSync(OUT + '-' + String(i).padStart(2, '0') + '-' + b.id + '-' + String(f).padStart(3, '0') + '.jpg', buf);
      else await write(buf);
      frames++;
      if (!STILLS && frames % 60 === 0) console.log('   ' + path.basename(OUT) + ' toma ' + b.id + ' ' + f + '/' + b.frames + '  [' + ((Date.now() - t0) / 1000).toFixed(0) + 's, ' + ((Date.now() - t0) / frames / 1000).toFixed(2) + ' s/fotograma]');
    }
    const st = await page.evaluate(() => { const p = __vx.gs().player; const B = __vx.gs().boss; return { x: +p.b.x.toFixed(1), y: +p.b.y.toFixed(1), z: +p.b.z.toFixed(1), mode: p.mode, hp: p.hp, kills: __vx.gs().kills, boss: B ? B.state + ' ' + B.hp.toFixed(0) : '-', foes: __vx.gs().enemies.filter(e => !e.dead).length }; });
    console.log(' toma ' + i + ' ' + b.id + ' (' + b.frames + ' fotogramas) -> ' + JSON.stringify(st));
  }
  const log = await page.evaluate(() => ({ ev: TR.ev, tele: TR.tele, shots: TR.shots.map(s => ({ id: s.id, start: s.start, dur: s.dur })) }));
  fs.writeFileSync(OUT + '.json', JSON.stringify(log));
  if (ff) { ff.stdin.end(); await done; }
  await browser.close();
  console.log('listo: ' + frames + ' fotogramas en ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s' + (errs.length ? '\nERRORES:\n  ' + [...new Set(errs)].slice(0, 8).join('\n  ') : ''));
})().catch(e => { console.error('CAPTURE FALLÓ: ' + e.stack); process.exit(9); });
