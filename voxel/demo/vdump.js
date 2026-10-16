// Dumps the renderer's view of the world for one camera: how many chunks have a
// mesh, how many were drawn, and the horizontal distances involved.
//   node voxel/demo/vdump.js '[x,y,z,yaw,pitch]'
const { execSync } = require('child_process'); const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
(async () => {
  const cam = JSON.parse(process.argv[2]);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx);
  await p.evaluate(c => __vx.setCam(c[0], c[1], c[2], c[3], c[4]), cam);
  await p.waitForFunction(() => __vx.ready(), null, { timeout: 90000, polling: 200 });
  await p.evaluate(() => __vx.render(3.0));
  const r = await p.evaluate(() => { const w = __vx.world(); return { total: w.chunks.size, drawn: w.stats.drawn, tris: Math.round(w.stats.tris), farDist: window.__vxfar }; });
  console.log(JSON.stringify(r));
  const h = await p.evaluate(a => { const w = __vx.world(); const out = {}; for (const c of w.chunks.values()) { const d = Math.round(Math.hypot(c.cx * 16 + 8 - a[0], c.cz * 16 + 8 - a[1]) / 16); out[d] = out[d] || [0, 0]; out[d][0]++; if (c.o) out[d][1]++; } return out; }, [cam[0], cam[2]]);
  console.log('chunks por anillo (distancia en chunks): total/con malla');
  for (const k of Object.keys(h).sort((a, b) => a - b)) console.log('  ' + k.padStart(2) + ': ' + h[k][0] + '/' + h[k][1]);
  await b.close();
})();
