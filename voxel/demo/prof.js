const P = require('./loadcore')(['noise', 'blocks', 'worldgen', 'bake', 'jobs'],
  'gen:WG_genChunk,mass:WG_massChunk,col:WG_colInfo,land:WG_isLand,getGen:JB_getGen,bake:BX_bake,env:JB_env,noise:NZ_fbm2,emit:WG_emitters,bakeNow:JB_bakeNow');
function time(label, n, f) { f(0); const t0 = performance.now(); for (let i = 0; i < n; i++) f(i); const dt = (performance.now() - t0) / n; console.log(label.padEnd(34) + (dt < 0.1 ? (dt * 1000).toFixed(2) + ' µs' : dt.toFixed(2) + ' ms')); return dt; }
const o = { kind: 0, top: 0, b: null };
time('fbm2 (3 octavas)', 200000, i => P.noise(i * 0.37, i * 0.11, 7, 3));
time('WG_isLand', 200000, i => P.land(i * 3 - 500, (i % 97) * 7));
time('WG_colInfo (columna)', 50000, i => P.col(100 + (i % 200), -300 + (i % 150), o));
time('WG_genChunk', 60, i => P.gen(10 + i, -8 + (i % 5)));
time('WG_massChunk', 200, i => P.mass(50 + i, 3));
time('WG_emitters (64x64)', 2000, i => P.emit(i, i, i + 64, i + 64));
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) P.getGen(200 + a, 200 + b);
let it = P.bake(200, 200, P.env); let r; do { r = it.next(); } while (!r.done);
time('BX_bake (todo en caché)', 30, i => { const it = P.bake(200, 200, P.env); let r; do { r = it.next(); } while (!r.done); });
// a realistic stream: a fresh chunk each time, neighbours mostly cached
let k = 0;
time('bake de chunk NUEVO (en racha)', 40, i => { P.bakeNow(300 + (k++ % 40), -5 + (k % 3)); });
