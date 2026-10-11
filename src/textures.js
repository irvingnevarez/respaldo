// ═══════════════════════════════════════════════════════════════════════
//  TEXTURES — the one place the game stops being purely procedural.
//
//  Everything else here is drawn from strokes and gradients, and that rule
//  earned its keep: it is why the whole game is one small file with no asset
//  pipeline. But procedural stone has a ceiling. Canvas gradients can give a
//  surface a VALUE and a SHAPE; they cannot give it the fine irregular grain
//  that makes the eye read "this is a real material" rather than "this is a
//  shaded polygon". Three small tiling maps buy exactly that, and nothing else
//  in the renderer can.
//
//  What is here, and why each one:
//
//    det  surface detail, zero-centred. Modulates the albedo the tiles already
//         paint, so the stone keeps its authored colour and only gains grain.
//    nrm  a normal map derived from that same height field. This is the one
//         that genuinely changes the lighting: the deferred pass already
//         consumes a normal buffer, so the moon and the street lamps now rake
//         across actual surface relief instead of a flat plane.
//    grm  grime and vertical rain-runoff, at a much larger scale, so that one
//         block does not look like the block next to it.
//
//  They total about 85 KB of base64 — a fifth of the file, for the single
//  largest step in material realism available. They are deliberately small and
//  monochrome: colour comes from the art, these only carry detail.
//
//  All three are seamless by construction (see demo/mktex.py) and are locked
//  to WORLD space, not screen space. A screen-locked pattern slides across the
//  ground as the camera moves, which reads as the texture swimming and is far
//  worse than having no texture at all.
// ═══════════════════════════════════════════════════════════════════════

const TEX = { ready: false, img: {}, pat: {}, pend: 0, failed: false };

function TEX_load() {
  const keys = Object.keys(TEX_SRC);
  TEX.pend = keys.length;
  for (const k of keys) {
    const im = new Image();
    im.onload = function () {
      TEX.img[k] = im;
      if (--TEX.pend === 0) TEX.ready = Object.keys(TEX.img).length === keys.length;
    };
    // A missing texture must degrade to the old procedural look, never to a
    // broken frame: every caller checks TEX.ready and skips the whole pass.
    im.onerror = function () {
      TEX.failed = true;
      if (--TEX.pend === 0) TEX.ready = false;
    };
    im.src = TEX_SRC[k];
  }
}

// `repeat` is how many WORLD pixels one tile of the map covers. Bigger means
// coarser; the detail map wants to be fine and the grime map wants to be broad
// enough that neighbouring blocks differ.
function TEX_pat(ctx, key, repeat, camX, camY) {
  const im = TEX.img[key];
  if (!im) return null;
  const ck = key + '@' + repeat;
  let rec = TEX.pat[ck];
  if (!rec || rec.ctx !== ctx) {
    const p = ctx.createPattern(im, 'repeat');
    if (!p) return null;
    rec = TEX.pat[ck] = { ctx: ctx, pat: p, ok: typeof DOMMatrix !== 'undefined' && !!p.setTransform };
  }
  if (rec.ok) {
    const s = repeat / im.width;
    // modulo by the repeat length keeps the translation small; a camera 20000
    // pixels into a level otherwise hands the matrix a number big enough to
    // lose sub-pixel precision, and the texture visibly jitters
    const ox = -(camX % repeat), oy = -((camY || 0) % repeat);
    try {
      rec.pat.setTransform(new DOMMatrix([s, 0, 0, s, ox, oy]));
    } catch (e) { rec.ok = false; }
  }
  return rec.pat;
}

// Lays the detail and grime maps over a path of already-painted tiles.
// One fill per map for the whole screen's worth of stone, not one per tile.
function TEX_surface(ctx, path, camX) {
  if (!TEX.ready) return;
  const det = TEX_pat(ctx, 'det', 192, camX);
  const grm = TEX_pat(ctx, 'grm', 384, camX);
  if (!det || !grm) return;
  ctx.save();
  // 'overlay' keeps the tile's own value and pushes contrast into it, which is
  // what a detail map is for. 'multiply' for the grime, because dirt only ever
  // subtracts light.
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = det;
  ctx.fill(path);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = grm;
  ctx.fill(path);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Perturbs the baked normals with the real surface relief. The normal buffer
// is half resolution, so the map is 128px and covers 256 world pixels — that
// lands it at 1:1 in the buffer, with no minification to alias.
//
// Straight alpha blending of two normals is not a correct rotation, but the
// lighting shader normalizes what it reads, so the result is a well-formed
// unit vector pointing between the two. At this strength the difference from a
// proper slerp is not visible.
function TEX_normals(ctx, path, camX) {
  if (!TEX.ready) return;
  const p = TEX_pat(ctx, 'nrm', 256, camX);
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = p;
  ctx.fill(path);
  ctx.restore();
  ctx.globalAlpha = 1;
}
