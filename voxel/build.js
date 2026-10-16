#!/usr/bin/env node
// Assembles voxel/src into one self-contained page.
//   node voxel/build.js  ->  voxel/index.html (standalone) + voxel/artifact.html (fragment)
//
// The chunk worker has no file to load from, so its source travels INSIDE the page
// as inert text and is turned into a Blob at runtime. That text is the shared
// modules again, appended with the worker entry point.
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'src'), ROOT = __dirname;

const MAIN = ['math', 'noise', 'blocks', 'worldgen', 'bake', 'jobs', 'gl', 'shaders', 'world', 'far', 'render', 'game'];
const WORKER = ['noise', 'blocks', 'worldgen', 'bake', 'jobs', 'workerboot'];
const REQUIRED = ['VxFar', 'VxWorld', 'VxRenderer', 'VxCamera', 'BX_bake', 'WG_genChunk', 'SH_TERRAIN_FS', 'JB_package'];

const read = n => fs.readFileSync(path.join(SRC, n + '.js'), 'utf8');

// Top-level names must be unique across modules: they share one scope when
// concatenated, and a collision there is silent.
const seen = new Map();
for (const n of MAIN) {
  for (const m of read(n).matchAll(/^(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) { console.error('COLISIÓN: ' + m[1] + ' en ' + seen.get(m[1]) + ' y ' + n); process.exit(2); }
    seen.set(m[1], n);
  }
}
const main = MAIN.map(n => '\n// ═══ ' + n.toUpperCase() + ' ═══\n' + read(n)).join('\n');
const worker = WORKER.map(n => '\n// ' + n + '\n' + read(n)).join('\n');

if (/<\/script/i.test(worker)) { console.error('el código del worker contiene </script'); process.exit(3); }
const missing = REQUIRED.filter(id => !new RegExp('(?:function\\*?|class|const|let|var)\\s+' + id + '\\b').test(main));
if (missing.length) { console.error('FALTAN: ' + missing.join(', ')); process.exit(4); }
try { new Function(main); } catch (e) { console.error('ERROR DE SINTAXIS (principal): ' + e.message); process.exit(5); }
try { new Function(worker); } catch (e) { console.error('ERROR DE SINTAXIS (worker): ' + e.message); process.exit(6); }

const shell = fs.readFileSync(path.join(SRC, '_shell.html'), 'utf8').replace('/*WORKER_SRC*/', () => worker);
const tail = fs.readFileSync(path.join(SRC, '_tail.html'), 'utf8');
const page = shell + main + '\n' + tail;
fs.writeFileSync(path.join(ROOT, 'index.html'), page);

// The artifact host supplies only a bare skeleton, so the head's own elements
// (title, fonts, the whole stylesheet) must travel with the fragment.
const headInner = (shell.match(/<head>([\s\S]*?)<\/head>/i) || [, ''])[1]
  .replace(/<meta\s+charset[^>]*>\s*/i, '').replace(/<meta\s+name="viewport"[^>]*>\s*/i, '').trim();
const bodyInner = page.replace(/^[\s\S]*?<body[^>]*>\n?/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
fs.writeFileSync(path.join(ROOT, 'artifact.html'), headInner + '\n' + bodyInner);

const kb = f => (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(1) + 'KB';
console.log('módulos: ' + MAIN.map(n => n + '(' + read(n).split('\n').length + 'L)').join(' '));
console.log('worker ' + (worker.length / 1024).toFixed(1) + 'KB   index.html ' + kb('index.html') + '   artifact.html ' + kb('artifact.html'));
console.log('OK');
