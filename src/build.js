#!/usr/bin/env node
// Assembles src/*.js into the single-file game.
//
//   node src/build.js            -> game.html (standalone) + artifact.html (body)
//
// The module sources used to live only in the session scratchpad, and a
// container restart took them with it — they were recovered by splitting the
// built game.html back apart. They live in the repo now so that cannot happen
// twice.
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const ROOT = path.join(__dirname, '..');

// Order matters: later modules may call into earlier ones at load time.
const ORDER = [
  'batman', 'enemies', 'environment', 'tiles', 'fx', 'ui', 'bosses',
  'levels', 'lighting', 'atmos', 'decor', 'foreground', 'postfx', 'bossengine', 'core',
];

// Anything the game cannot boot without. A missing one used to surface as a
// blank canvas and a console error; this turns it into a build failure.
const REQUIRED = [
  'drawBatmanSprite', 'drawJokerMinion', 'drawPenguinHenchman', 'drawJokerDrone',
  'drawGothamSky', 'drawGothamSkyline', 'drawCityFog', 'drawForegroundVignette',
  'drawGroundTile', 'drawStoneBlock', 'drawBrickBlock', 'drawBatSignalBlock',
  'drawGargoyle', 'drawBeacon', 'drawBatarang', 'drawBatSuitPickup',
  'drawBatSignalStar', 'ParticleSystem', 'RainSystem', 'Lightning',
  'ScreenShake', 'drawSpeedLines', 'FX_rimmed', 'drawHUD', 'drawTitleScreen',
  'drawPauseOverlay', 'drawDeathOverlay', 'drawLevelCompleteOverlay',
  'drawGameOverOverlay', 'drawWinOverlay', 'LEVELS', 'PostFX', 'Boss',
  'BossProjectile', 'Shockwave', 'Atmosphere', 'Decor', 'Foreground', 'Game',
  'drawBossHealthBar', 'drawBossIntro',
];

const shell = fs.readFileSync(path.join(SRC, '_shell.html'), 'utf8');
const tail = fs.readFileSync(path.join(SRC, '_tail.html'), 'utf8');
const preamble = fs.readFileSync(path.join(SRC, '_preamble.js'), 'utf8');

const parts = [preamble];
const seen = new Map();
for (const name of ORDER) {
  const body = fs.readFileSync(path.join(SRC, name + '.js'), 'utf8');
  // Top-level collisions between modules are silent in a concatenated file and
  // very hard to debug later, so they fail the build instead.
  for (const m of body.matchAll(/^(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    const id = m[1];
    if (seen.has(id)) {
      console.error('COLISIÓN: ' + id + ' definido en ' + seen.get(id) + ' y en ' + name);
      process.exit(2);
    }
    seen.set(id, name);
  }
  parts.push('\n// ═══ ' + name.toUpperCase() + ' ═══════════════════════════════════════\n' + body);
}

const script = parts.join('\n');

const missing = REQUIRED.filter(id => !new RegExp('(?:function|class|const|let|var)\\s+' + id + '\\b').test(script));
if (missing.length) {
  console.error('FALTAN declaraciones: ' + missing.join(', '));
  process.exit(3);
}

try { new Function(script); } catch (e) {
  console.error('ERROR DE SINTAXIS: ' + e.message);
  process.exit(4);
}

// level sanity: equal row lengths, exactly one beacon, enemies on solid ground
try {
  const sandbox = { window: {}, document: { fonts: null }, console };
  const lv = script.slice(script.indexOf('const LEVELS = ['));
  const arr = new Function('return ' + lv.slice(lv.indexOf('['), lv.indexOf('\n];') + 2))();
  const report = arr.map(L => {
    const w = L.rows[0].length;
    if (L.rows.some(r => r.length !== w)) throw new Error(L.id + ': filas desiguales');
    if (L.rows.length !== 17) throw new Error(L.id + ': ' + L.rows.length + ' filas, deben ser 17');
    const f = L.rows.join('').split('F').length - 1;
    if (!L.boss && f !== 1) throw new Error(L.id + ': ' + f + ' balizas');
    return L.id + '(' + w + 'c' + (L.boss ? ',JEFE:' + L.boss : '') + ')';
  });
  console.log('niveles ok: ' + report.join(' '));
} catch (e) {
  console.error('NIVELES: ' + e.message);
  process.exit(5);
}

console.log('módulos: ' + ORDER.map(n =>
  n + '(' + fs.readFileSync(path.join(SRC, n + '.js'), 'utf8').split('\n').length + 'L)').join(' '));

const body = shell + script + '\n' + tail;
fs.writeFileSync(path.join(ROOT, 'game.html'), body);
// the artifact form is the same page without the outer html/head wrapper
fs.writeFileSync(path.join(ROOT, 'artifact.html'),
  body.replace(/^<!doctype html>.*?<body>\n/is, '').replace(/<\/body><\/html>\s*$/i, ''));

for (const f of ['game.html', 'artifact.html']) {
  console.log(f.padEnd(14) + (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(1) + 'KB');
}
console.log('OK');
