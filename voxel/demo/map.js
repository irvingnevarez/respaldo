// Top-down map of the generated world, rendered from Node with no browser: the
// fastest way to check that districts, the channel, streets and building heights
// land where they were designed to.
//   node demo/map.js out.png [step] [x0 z0 x1 z1]
const vm = require('vm'), fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..', 'src');
const src = ['noise', 'blocks', 'worldgen'].map(n => fs.readFileSync(path.join(root, n + '.js'), 'utf8')).join('\n;\n');
const ctx = { console, Math }; vm.createContext(ctx);
vm.runInContext(src + ';this.G={colInfo:WG_colInfo,K:WG_K,districtAt:WG_districtAt,isLand:WG_isLand,names:WG_DNAME,channelZ:WG_channelZ};', ctx);
const G = ctx.G;

const out = process.argv[2] || 'map.png';
const step = parseInt(process.argv[3] || '3', 10);
const [X0, Z0, X1, Z1] = process.argv.length >= 8 ? process.argv.slice(4, 8).map(Number) : [-800, -800, 800, 800];
const W = Math.floor((X1 - X0) / step), Hh = Math.floor((Z1 - Z0) / step);
const buf = Buffer.alloc(W * Hh * 3);
// one hue per district, so borders are visible at a glance
const DC = [[20, 40, 70], [150, 150, 170], [170, 120, 70], [120, 90, 150], [150, 200, 230], [90, 140, 100], [200, 90, 50], [220, 200, 80], [220, 70, 160]];
const o = { kind: 0, top: 0, b: null };
const t0 = Date.now();
for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
  const x = X0 + i * step, z = Z0 + j * step;
  G.colInfo(x, z, o);
  let c;
  if (o.kind === G.K.WATER) c = [14, 38, 62];
  else {
    const d = G.districtAt(x, z), dc = DC[d];
    const h = Math.min(1, (o.top - 26) / 90);
    if (o.kind === G.K.ROAD) c = [40, 42, 48];
    else if (o.kind === G.K.SIDEWALK) c = [70, 72, 78];
    else if (o.kind === G.K.PARK) c = [40, 90, 50];
    else if (o.kind === G.K.BUILDING) { const k = 0.35 + 0.65 * h; c = [dc[0] * k, dc[1] * k, dc[2] * k]; }
    else c = [dc[0] * 0.35, dc[1] * 0.35, dc[2] * 0.35];
  }
  const p = (j * W + i) * 3; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2];
}
fs.writeFileSync(out + '.ppm', Buffer.concat([Buffer.from('P6\n' + W + ' ' + Hh + '\n255\n'), buf]));
cp.execSync('convert ' + out + '.ppm ' + out + ' && rm ' + out + '.ppm');
console.log('mapa ' + W + 'x' + Hh + ' en ' + (Date.now() - t0) + ' ms -> ' + out);
