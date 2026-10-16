// Renders the trailer's soundtrack to a WAV from one or more capture logs.
//   node voxel/demo/trailer/mkscore.js <out.wav> <capture.json> [capture.json ...]
// The logs carry every game sound with its time, the director's cues, and the
// player telemetry; the shots' timeline comes with them. The score itself is
// synthesised in the browser (score.js) with the game's own audio code.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const OUT = process.argv[2], LOGS = process.argv.slice(3);
const PAGE = path.resolve(__dirname, '..', '..', 'index.html');
(async () => {
  let ev = [], tele = [], shots = null;
  for (const f of LOGS) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    ev = ev.concat(j.ev); tele = tele.concat(j.tele); shots = shots || j.shots;
  }
  ev.sort((a, b) => a.t - b.t); tele.sort((a, b) => a[0] - b[0]);
  const last = shots[shots.length - 1], dur = last.start + last.dur;
  console.log('sonidos ' + ev.length + ' (señales ' + ev.filter(e => e.cue).length + '), telemetría ' + tele.length + ' fotogramas, duración ' + dur.toFixed(2) + ' s');
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx, null, { timeout: 30000 });
  await p.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'score.js'), 'utf8') });
  const t0 = Date.now();
  const r = await p.evaluate(o => TS_render(o), { dur, shots, ev, tele, sr: 48000 });
  fs.writeFileSync(OUT, Buffer.from(r.b64, 'base64'));
  console.log('-> ' + OUT + '  ' + (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB, pico ' + r.peak.toFixed(2) + ', efectos ' + r.events + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s' + (errs.length ? '\nERRORES: ' + errs.join(' | ') : ''));
  await b.close();
})().catch(e => { console.error('MKSCORE FALLÓ: ' + e.stack); process.exit(9); });
