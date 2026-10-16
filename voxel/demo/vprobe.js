// Ablation probe: render ONE view several times with different renderer params and
// report the mean colour of each, so a look problem can be pinned to a cause by
// measurement instead of argued about.
//   node voxel/demo/vprobe.js '<camera json [x,y,z,yaw,pitch]>' '<json: {label: {param: value}}>' [outprefix]
const { execSync } = require('child_process');
const path = require('path'), fs = require('fs');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const cam = JSON.parse(process.argv[2]);
const variants = JSON.parse(process.argv[3]);
const out = process.argv[4];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await p.addInitScript(() => { window.__capture = true; });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'load' });
  await p.waitForFunction(() => window.__vx);
  await p.evaluate(c => __vx.setCam(c[0], c[1], c[2], c[3], c[4]), cam);
  await p.waitForFunction(() => __vx.ready(), null, { timeout: 90000, polling: 200 });
  for (const [label, params] of Object.entries(variants)) {
    await p.evaluate(a => { for (const k in a) __vx.set(k, a[k]); __vx.render(3.0); }, params);
    await p.waitForTimeout(150);
    const f = (out || '/tmp/vprobe') + '-' + label.replace(/\W+/g, '') + '.png';
    await p.locator('#stage').screenshot({ path: f });
    const m = execSync('convert "' + f + '" -resize 1x1 -format "%[fx:int(255*r)] %[fx:int(255*g)] %[fx:int(255*b)]" info:').toString().trim();
    console.log('  ' + label.padEnd(26) + 'media RGB = ' + m);
  }
  await b.close();
})().catch(e => { console.error('PROBE FALLÓ: ' + e.message); process.exit(9); });
