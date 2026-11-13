// ═══════════════════════════════════════════════════════════════════════
//  TEX — the textures the renderer needs, all computed at boot. No image files.
//
//  The game has no art assets, so surface detail comes from two small tiling
//  noise textures that the material shader combines in different ways (grain,
//  blotches, pores, cracks, flakes), plus a lookup table that says, for each
//  block id, what kind of surface it is and how it behaves.
//
//   noise A   R  fractal height        G,B  its gradient (so one fetch gives a
//             A  a second, smoother         normal as well as a height)
//   noise B   R  cell distance (F1)    G  cell random    B  cell edge (F2-F1)
//             A  white noise
//   LUT       256 x 4, one column per block id:
//             row 0  class, roughness, metalness, emission boost
//             row 1  tile size u, tile size v, bond offset, groove width
//             row 2  grain, tint variation, wet response, spare
//             row 3  facade styles (column = style index): window pitch, floor
//                    height, window band start, window band rows
// ═══════════════════════════════════════════════════════════════════════

var MT_CLASS = {
  PLAIN: 0, ASPHALT: 1, PAINT: 2, PAVER: 3, CONCRETE: 4, BRICK: 5, STONE: 6, METAL: 7, RUST: 8, GLASS: 9,
  WINDOW: 10, ROOF: 11, WOOD: 12, FOLIAGE: 13, SNOW: 14, ICE: 15, GROUND: 16, CONTAINER: 17, CARPAINT: 18,
  EMISSIVE: 19, NEON: 20, LAVA: 21, WATER: 22, COPPER: 23, PAINTED: 24, SIGN: 25,
};

// class defaults: [roughness, metal, boost, tileU, tileV, bond, groove, grain, tint, wet]
var MT_DEF = {
  PLAIN:     [0.86, 0, 1, 0, 0, 0, 0, 0.55, 0.06, 0.5],
  ASPHALT:   [0.93, 0, 1, 0, 0, 0, 0, 0.95, 0.05, 1.0],
  PAINT:     [0.72, 0, 1, 0, 0, 0, 0, 0.55, 0.05, 0.9],
  PAVER:     [0.86, 0, 1, 1, 1, 0, 0.035, 0.60, 0.09, 0.85],
  CONCRETE:  [0.82, 0, 1, 4, 4, 0, 0.022, 0.50, 0.05, 0.6],
  BRICK:     [0.90, 0, 1, 0.5, 0.25, 0.5, 0.030, 0.45, 0.20, 0.3],
  STONE:     [0.84, 0, 1, 1, 0.5, 0.5, 0.028, 0.75, 0.11, 0.4],
  METAL:     [0.36, 1, 1, 2, 2, 0, 0.012, 0.16, 0.03, 0.5],
  RUST:      [0.84, 0.25, 1, 2, 1, 0, 0.012, 0.95, 0.24, 0.3],
  GLASS:     [0.05, 0, 1, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  WINDOW:    [0.05, 0, 1.7, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  ROOF:      [0.88, 0, 1, 0, 0, 0, 0, 0.80, 0.07, 1.0],
  WOOD:      [0.74, 0, 1, 4, 0.25, 0.37, 0.020, 0.50, 0.14, 0.4],
  FOLIAGE:   [0.85, 0, 1, 0, 0, 0, 0, 1.00, 0.22, 0.2],
  SNOW:      [0.70, 0, 1, 0, 0, 0, 0, 0.45, 0.03, 0.0],
  ICE:       [0.10, 0, 1, 0, 0, 0, 0, 0.20, 0.05, 0.0],
  GROUND:    [0.92, 0, 1, 0, 0, 0, 0, 0.90, 0.10, 0.7],
  CONTAINER: [0.55, 0.3, 1, 0, 0, 0, 0, 0.30, 0.06, 0.4],
  CARPAINT:  [0.20, 0.5, 1, 0, 0, 0, 0, 0.05, 0.0, 0.6],
  EMISSIVE:  [0.40, 0, 6, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  NEON:      [0.30, 0, 4, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  LAVA:      [0.60, 0, 2, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  WATER:     [0.04, 0, 1, 0, 0, 0, 0, 0.0, 0.0, 0.0],
  COPPER:    [0.50, 0.7, 1, 1, 8, 0, 0.030, 0.55, 0.16, 0.4],
  PAINTED:   [0.62, 0, 1, 0, 0, 0, 0, 0.35, 0.05, 0.4],
  SIGN:      [0.30, 0, 3, 0, 0, 0, 0, 0.0, 0.0, 0.0],
};

// block name -> class, with optional overrides { r: roughness, b: boost, tu, tv, g: grain, w: wet, m: metal }
var MT_BLOCK = {
  BEDROCK: ['STONE'], STONE: ['STONE'], DIRT: ['GROUND'], ASPHALT: ['ASPHALT'], ROADLINE: ['PAINT'],
  SIDEWALK: ['PAVER'], CURB: ['PAVER', { tu: 1, tv: 1, r: 0.80 }],
  CONCRETE: ['CONCRETE'], CONCRETE_DK: ['CONCRETE'], CONCRETE_LT: ['CONCRETE', { tu: 2, tv: 2 }],
  BRICK: ['BRICK'], BRICK_DK: ['BRICK'], GOTHIC: ['STONE'], GOTHIC_DK: ['STONE', { tu: 2, tv: 1 }],
  STEEL: ['METAL'], STEEL_DK: ['METAL', { r: 0.44 }], RUST: ['RUST'],
  GLASS: ['GLASS'], GLASS_BLUE: ['GLASS'],
  WIN_WARM: ['WINDOW'], WIN_COOL: ['WINDOW'], WIN_WHITE: ['WINDOW'],
  ROOF_TAR: ['ROOF', { r: 0.78, g: 0.45 }], ROOF_GRAVEL: ['ROOF', { g: 1.0, w: 0.5 }],
  WATER: ['WATER'], SAND: ['GROUND'], WOOD: ['WOOD'], WOOD_DK: ['WOOD'], GRASS: ['FOLIAGE'],
  ICE: ['ICE'], SNOW: ['SNOW'], LAMP_POLE: ['METAL', { r: 0.42, tu: 0, tv: 0 }], LAMP_LIGHT: ['EMISSIVE', { b: 9 }],
  NEON_PINK: ['NEON'], NEON_CYAN: ['NEON'], NEON_GREEN: ['NEON'], NEON_YELLOW: ['NEON'], NEON_RED: ['NEON'], NEON_PURPLE: ['NEON'],
  LAVA: ['LAVA', { b: 2.2 }], HOT_METAL: ['LAVA', { b: 1.6 }], COPPER: ['COPPER'],
  CARN_RED: ['PAINTED'], CARN_WHITE: ['PAINTED'], CARN_YELLOW: ['PAINTED'], CARN_PURPLE: ['PAINTED'], CARN_TEAL: ['PAINTED'],
  CONT_RED: ['CONTAINER'], CONT_BLUE: ['CONTAINER'], CONT_GREEN: ['CONTAINER'], CONT_ORANGE: ['CONTAINER'], CONT_GREY: ['CONTAINER'],
  HAZ_Y: ['PAINT', { r: 0.6 }], HAZ_K: ['PAINT', { r: 0.6 }],
  SEWER_BRICK: ['BRICK', { w: 1.0 }], SEWER_SLIME: ['LAVA', { b: 1.5 }], SEWER_WATER: ['WATER'],
  BRIDGE_DECK: ['CONCRETE', { tu: 2, tv: 2 }], CABLE: ['METAL', { tu: 0, tv: 0, r: 0.45 }], SIGNAL: ['EMISSIVE', { b: 7 }],
  WHITE: ['PAINTED'], BLACK: ['PAINTED'], RED: ['PAINTED'], PURPLE: ['PAINTED'], GREEN: ['PAINTED'],
  GARGOYLE: ['STONE'], SKYLIGHT: ['EMISSIVE', { b: 1.6, r: 0.08 }], BEACON_RED: ['EMISSIVE', { b: 6 }],
  CAR_RED: ['CARPAINT'], CAR_BLUE: ['CARPAINT'], CAR_WHITE: ['CARPAINT'], CAR_BLACK: ['CARPAINT'], CAR_YELLOW: ['CARPAINT'],
  HEADLIGHT: ['EMISSIVE', { b: 6 }], TAILLIGHT: ['EMISSIVE', { b: 4 }], HYDRANT: ['PAINTED', { r: 0.45 }],
  FROZEN_WATER: ['ICE', { r: 0.06 }], FURNACE: ['BRICK'], GAS: ['WATER'], LEAVES: ['FOLIAGE'], TRUNK: ['WOOD', { tu: 0.5, tv: 4 }],
  BENCH: ['WOOD'], CRANE: ['PAINTED', { r: 0.5, m: 0.4 }], SNOW_ICE: ['ICE', { r: 0.22 }], BOLT: ['EMISSIVE', { b: 6 }],
  SHOP_WARM: ['WINDOW', { b: 2.2 }], SHOP_COOL: ['WINDOW', { b: 2.2 }], SHOP_PINK: ['WINDOW', { b: 2.0 }], SHOP_GREEN: ['WINDOW', { b: 2.0 }],
  SIGN_PINK: ['SIGN'], SIGN_CYAN: ['SIGN'], SIGN_YELLOW: ['SIGN'], SIGN_GREEN: ['SIGN'], SIGN_RED: ['SIGN'], SIGN_WHITE: ['SIGN'],
  BILLBOARD: ['SIGN', { b: 2.4 }],
};

function TX_lut() {
  const d = new Uint8Array(256 * 4 * 4);
  const u8 = v => Math.max(0, Math.min(255, Math.round(v)));
  for (let id = 0; id < 256; id++) {
    const name = BK_NAMES[id];
    const spec = (name && MT_BLOCK[name]) || ['PLAIN'];
    const p = MT_DEF[spec[0]].slice(), o = spec[1] || {};
    if (o.r !== undefined) p[0] = o.r;
    if (o.m !== undefined) p[1] = o.m;
    if (o.b !== undefined) p[2] = o.b;
    if (o.tu !== undefined) p[3] = o.tu;
    if (o.tv !== undefined) p[4] = o.tv;
    if (o.g !== undefined) p[7] = o.g;
    if (o.w !== undefined) p[9] = o.w;
    let q = id * 4;
    d[q] = MT_CLASS[spec[0]]; d[q + 1] = u8(p[0] * 255); d[q + 2] = u8(p[1] * 255); d[q + 3] = u8(p[2] * 16);
    q = (256 + id) * 4;
    d[q] = u8(p[3] * 16); d[q + 1] = u8(p[4] * 16); d[q + 2] = u8(p[5] * 255); d[q + 3] = u8(p[6] * 1000);
    q = (512 + id) * 4;
    d[q] = u8(p[7] * 255); d[q + 1] = u8(p[8] * 255); d[q + 2] = u8(p[9] * 255); d[q + 3] = 0;
  }
  for (let s = 0; s < WG_STY.length && s < 16; s++) {
    const st = WG_STY[s], q = (768 + s) * 4;
    d[q] = st.WP; d[q + 1] = st.FH; d[q + 2] = st.wy; d[q + 3] = st.wr;
    const q2 = (768 + 16 + s) * 4;
    d[q2] = st.store ? 255 : 0;
  }
  return d;
}

// Tiling value noise on a lattice of `n` cells across the texture.
function TX_vnoise(x, y, n, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % n) + n) % n, x1 = (x0 + 1) % n, y0 = ((yi % n) + n) % n, y1 = (y0 + 1) % n;
  const a = NZ_f(x0, y0, seed), b = NZ_f(x1, y0, seed), c = NZ_f(x0, y1, seed), d = NZ_f(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function TX_noiseA(S) {
  const h = new Float32Array(S * S), a2 = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let amp = 0.5, n = 8, sum = 0, norm = 0;
    for (let o = 0; o < 5; o++) { sum += amp * TX_vnoise(x / S * n, y / S * n, n, 101 + o * 17); norm += amp; amp *= 0.55; n *= 2; }
    h[y * S + x] = sum / norm;
    a2[y * S + x] = 0.65 * TX_vnoise(x / S * 5, y / S * 5, 5, 311) + 0.35 * TX_vnoise(x / S * 11, y / S * 11, 11, 317);
  }
  // stretch the heights to use the whole byte, then take the gradient by central differences
  let lo = 1, hi = 0;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  let l2 = 1, h2 = 0;
  for (let i = 0; i < a2.length; i++) { if (a2[i] < l2) l2 = a2[i]; if (a2[i] > h2) h2 = a2[i]; }
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, xm = y * S + ((x + S - 1) % S), xp = y * S + ((x + 1) % S), ym = ((y + S - 1) % S) * S + x, yp = ((y + 1) % S) * S + x;
    const gx = (h[xp] - h[xm]) / (hi - lo), gy = (h[yp] - h[ym]) / (hi - lo);
    d[i * 4] = Math.round((h[i] - lo) / (hi - lo) * 255);
    d[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + gx * 900)));
    d[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(127.5 + gy * 900)));
    d[i * 4 + 3] = Math.round((a2[i] - l2) / (h2 - l2) * 255);
  }
  return d;
}

function TX_noiseB(S) {
  const C = 16, cs = S / C;                   // 16 x 16 cells
  const px = new Float32Array(C * C), py = new Float32Array(C * C);
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) { px[j * C + i] = (i + 0.15 + 0.7 * NZ_f(i, j, 401)) * cs; py[j * C + i] = (j + 0.15 + 0.7 * NZ_f(i, j, 409)) * cs; }
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const ii = (ci + a + C) % C, jj = (cj + b + C) % C;
      let dx = px[jj * C + ii] - x, dy = py[jj * C + ii] - y;
      if (dx > S / 2) dx -= S; else if (dx < -S / 2) dx += S;
      if (dy > S / 2) dy -= S; else if (dy < -S / 2) dy += S;
      const dd = Math.hypot(dx, dy);
      if (dd < f1) { f2 = f1; f1 = dd; id = jj * C + ii; } else if (dd < f2) f2 = dd;
    }
    const i = (y * S + x) * 4;
    d[i] = Math.min(255, Math.round(f1 / cs * 255 * 0.9));
    d[i + 1] = NZ_hash(id, 7, 419) & 255;
    d[i + 2] = Math.min(255, Math.round((f2 - f1) / cs * 255 * 1.1));
    d[i + 3] = NZ_hash(x, y, 431) & 255;
  }
  return d;
}

function TX_make(gl, w, h, data, repeat, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (mips) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  return t;
}

// The GLSL names of the material classes, generated so the shader and this table
// cannot drift apart.
function TX_classDefines() {
  let s = '';
  for (const k in MT_CLASS) s += '#define MC_' + k + ' ' + MT_CLASS[k] + '\n';
  return s;
}
