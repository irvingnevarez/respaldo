// Bakes chunks in Node and reports time, size and sanity checks. No browser.
//   node demo/bake-bench.js [cx cz] [count]
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src');
const names = ['noise', 'blocks', 'worldgen', 'bake', 'jobs'];
const src = names.map(n => fs.readFileSync(path.join(root, n + '.js'), 'utf8')).join('\n;\n');
const ctx = { console, Math, Date }; vm.createContext(ctx);
vm.runInContext(src + ';this.J={bake:JB_bakeNow,gen:JB_getGen,F:BX_FACE,BK:BK};', ctx);
const J = ctx.J;

// 1. winding: every face's first triangle must point along its normal
let bad = 0;
J.F.forEach((F, f) => {
  const v = F.verts.map(q => q.p);
  const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = c[0] * F.n[0] + c[1] * F.n[1] + c[2] * F.n[2];
  if (d <= 0) { bad++; console.log('winding MAL en cara', f); }
});
console.log('winding de las 6 caras: ' + (bad ? 'FALLA' : 'ok'));

const cx0 = parseInt(process.argv[2] || '0', 10), cz0 = parseInt(process.argv[3] || '-2', 10);
const n = parseInt(process.argv[4] || '6', 10);
let tot = 0, quads = 0;
for (let i = 0; i < n; i++) {
  const t0 = Date.now();
  const r = J.bake(cx0 + i, cz0);
  const dt = Date.now() - t0;
  tot += dt; quads += r.opaque.nv / 4;
  // light must be bounded and not all black
  let sMax = 0, sSum = 0, bMax = 0;
  for (let q = 0; q < r.opaque.nv; q++) { const s = r.opaque.v[q * 16 + 12]; sSum += s; if (s > sMax) sMax = s; const bb = r.opaque.v[q * 16 + 13]; if (bb > bMax) bMax = bb; }
  console.log('chunk (' + (cx0 + i) + ',' + cz0 + '): ' + dt + ' ms, cuadros ' + (r.opaque.nv / 4) + ', agua ' + (r.water.nv / 4) +
    ', lamparas ' + r.emitters.length + ', cielo medio ' + (sSum / Math.max(1, r.opaque.nv)).toFixed(0) + ' (máx ' + sMax + '), lámpara máx ' + bMax +
    ', bytes ' + ((r.opaque.v.length + r.opaque.i.length * (r.opaque.wide ? 4 : 2)) / 1024).toFixed(0) + ' KB');
}
console.log('media ' + (tot / n).toFixed(0) + ' ms/chunk; ' + (quads / n).toFixed(0) + ' cuadros/chunk');
