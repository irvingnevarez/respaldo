// Renders an artifact fragment the way the platform will: inside the host's bare
// skeleton (charset, viewport, a small reset), at desktop and phone widths.
//   node demo/artifact-preview.js <fragment.html | published.html> <out-prefix> [waitMs]
// A file that already starts with <!doctype> is shown as it is (e.g. the saved copy
// of what is published today), which is how the missing-CSS defect was found.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const SKELETON_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
(async () => {
  const src = fs.readFileSync(path.resolve(process.argv[2]), 'utf8');
  const out = process.argv[3] || 'prev';
  const wait = parseInt(process.argv[4] || '3500', 10);
  const html = /^\s*<!doctype/i.test(src) ? src : SKELETON_HEAD + src + '</body></html>';
  const tmp = path.resolve(out + '.tmp.html'); fs.writeFileSync(tmp, html);
  const b = await chromium.launch();
  for (const [name, opt] of [['escritorio', { viewport: { width: 1280, height: 800 } }],
                             ['movil', { viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + tmp, { waitUntil: 'load' });
    await p.waitForTimeout(wait);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      title: document.title, bg: getComputedStyle(document.body).backgroundColor }));
    await p.screenshot({ path: out + '-' + name + '.png' });
    console.log('  ' + name.padEnd(10) + ' título="' + m.title + '" fondo=' + m.bg + ' scrollH=' + (m.sw > m.cw + 1) + ' errores=' + errs.length);
    await ctx.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})().catch(e => { console.error('PREVIEW FALLÓ: ' + e.message); process.exit(9); });
