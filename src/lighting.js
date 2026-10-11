// ═══════════════════════════════════════════════════════════════════════
//  NORMAL BUFFER — the geometry half of the dynamic lighting.
//
//  The scene art is 6000 lines of procedural Canvas 2D. Re-drawing all of it
//  a second time as normals is not realistic, so instead we bake a small set
//  of normal SPRITES once at startup (a bevelled tile face, a dome, a capsule)
//  and stamp them at the positions we already track: tiles, blocks, pickups,
//  the player, enemies.
//
//  That gives real per-object surface direction — bevelled blocks catch light
//  on the edge facing the source, characters read as rounded volumes — without
//  touching the art modules at all.
//
//  Encoding is the usual tangent-space one: rgb = normal * 0.5 + 0.5, so flat
//  (facing the viewer) is (128, 128, 255).
// ═══════════════════════════════════════════════════════════════════════

var LT_cache = null;

function LT_canvas(w, h) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Bevelled square: flat in the middle, edges sloping outward like a chamfer.
// Matches the upper-left light convention the tile art is already drawn with.
function LT_makeBevel(size, bevel) {
  var c = LT_canvas(size, size), ctx = c.getContext('2d');
  var img = ctx.createImageData(size, size), d = img.data;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      // signed distance to each edge, in bevel units
      var dl = x / bevel, dr = (size - 1 - x) / bevel;
      var dt = y / bevel, db = (size - 1 - y) / bevel;
      var nx = 0, ny = 0;
      if (dl < 1) nx -= (1 - dl);
      if (dr < 1) nx += (1 - dr);
      if (dt < 1) ny -= (1 - dt);
      if (db < 1) ny += (1 - db);
      // soften the ramp so edges are rounded rather than faceted
      nx = Math.sign(nx) * Math.pow(Math.abs(nx), 0.75) * 0.85;
      ny = Math.sign(ny) * Math.pow(Math.abs(ny), 0.75) * 0.85;
      var nz = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      var i = (y * size + x) * 4;
      d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Elliptical dome — characters and pickups read as rounded volumes.
// `flat` keeps the centre from being too spherical on tall thin sprites.
function LT_makeDome(w, h, flat) {
  var c = LT_canvas(w, h), ctx = c.getContext('2d');
  var img = ctx.createImageData(w, h), d = img.data;
  var cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var u = (x - cx) / cx, v = (y - cy) / cy;
      var r = Math.sqrt(u * u + v * v);
      var i = (y * w + x) * 4;
      if (r > 1) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 255; d[i + 3] = 0; continue; }
      var s = Math.pow(r, flat);
      var nx = u * s, ny = v * s;
      var nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      // feather the rim so sprites do not show a hard normal edge
      d[i + 3] = Math.round(255 * Math.min(1, (1 - r) * 6));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Horizontal cylinder — good for ground rows: light rakes across them.
function LT_makeCylinder(w, h) {
  var c = LT_canvas(w, h), ctx = c.getContext('2d');
  var img = ctx.createImageData(w, h), d = img.data;
  var cy = (h - 1) / 2;
  for (var y = 0; y < h; y++) {
    var v = (y - cy) / cy;
    var ny = v * 0.7;
    var nz = Math.sqrt(Math.max(0.05, 1 - ny * ny));
    var len = Math.sqrt(ny * ny + nz * nz) || 1;
    var g = Math.round((ny / len * 0.5 + 0.5) * 255);
    var bl = Math.round((nz / len * 0.5 + 0.5) * 255);
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      d[i] = 128; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function LT_init() {
  if (LT_cache) return LT_cache;
  LT_cache = {
    bevel: LT_makeBevel(32, 7),      // floating blocks: strong chamfer
    bevelSoft: LT_makeBevel(32, 11), // ground masonry: broader, softer
    ground: LT_makeCylinder(32, 32),
    dome: LT_makeDome(64, 64, 1.35),
    domeTall: LT_makeDome(48, 72, 1.5),
  };
  return LT_cache;
}

// flat normal, pointing straight at the viewer
function LT_clear(ctx, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, w, h);
}
