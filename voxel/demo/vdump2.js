const { execSync } = require('child_process'); const path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file:///home/user/respaldo/voxel/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx);
  await p.evaluate(() => __vx.setCam(20, 104, 34, 2.52, -0.16));
  await p.waitForFunction(() => __vx.ready(), null, { timeout: 90000, polling: 200 });
  await p.evaluate(() => __vx.render(3.0));
  const r = await p.evaluate(() => {
    const w = __vx.world(), c = __vx.cam(), far = __vx.rend().farDist;
    const rows = [];
    for (const ch of w.chunks.values()) {
      const x0 = ch.cx * 16, z0 = ch.cz * 16;
      const d = Math.hypot(x0 + 8 - c.x, z0 + 8 - c.z);
      const vis = M4_boxVisible(c.planes, x0, 0, z0, x0 + 16, ch.maxY + 2, z0 + 16);
      rows.push({ d: Math.round(d), vis, cull: d > far, tris: ch.o ? ch.o.n / 3 : 0 });
    }
    const bins = {};
    for (const r of rows) { const k = Math.floor(r.d / 20) * 20; bins[k] = bins[k] || { n: 0, vis: 0, drawn: 0, tris: 0 }; bins[k].n++; if (r.vis) bins[k].vis++; if (r.vis && !r.cull) { bins[k].drawn++; bins[k].tris += r.tris; } }
    return { far, cam: [c.x, c.y, c.z, c.yaw, c.pitch], fov: c.fov, bins };
  });
  console.log('farDist', r.far, 'cam', r.cam.map(v => +v.toFixed(2)).join(','), 'fov', r.fov);
  console.log('distancia(bloques)  chunks  visibles  dibujados  triángulos');
  for (const k of Object.keys(r.bins).sort((a, b) => a - b)) { const q = r.bins[k]; console.log(String(k).padStart(8) + '-' + String(+k + 20).padEnd(4) + '   ' + String(q.n).padStart(5) + String(q.vis).padStart(10) + String(q.drawn).padStart(11) + String(Math.round(q.tris)).padStart(12)); }
  await b.close();
})();
