// ═══════════════════════════════════════════════════════════════════════
//  WORLDGEN — the whole of Gotham as a pure function of (x, y, z).
//
//  Shared with the chunk worker. Nothing here keeps state that depends on the
//  ORDER chunks are requested in: any chunk can be built alone, on any worker,
//  in any order, and neighbouring chunks agree at their seams. That property is
//  what makes an infinite streamed world possible, and every design choice below
//  serves it:
//
//   - the city is a regular street grid; each block's contents are a hash of its
//     (bx, bz), so a block can be recomputed from nothing;
//   - buildings are described analytically (footprint, tiers, roof) and a column
//     asks "what is my height" instead of being stamped into the world;
//   - whether a facade voxel is a window, a pier or a ledge is decided from the
//     voxel's own coordinates and its building's seed, not from a neighbour.
// ═══════════════════════════════════════════════════════════════════════

var WG_H = 128;            // world height
var WG_GY = 25;            // y of the top road voxel; feet stand at GY + 1
var WG_SEA = 21;           // y of the top water voxel; the surface sits at 22.0
var WG_FLOOR = 8;          // sea floor
var WG_PITCH = 48;         // one city block plus its street
var WG_ST = 10;            // street width: 2 sidewalk + 6 road + 2 sidewalk
var WG_BASE = WG_GY + 2;   // y of the first building voxel (above the raised pavement)
var WG_SEED = 1939;

var WG_D = { SEA: 0, AZOTEAS: 1, MUELLES: 2, ARKHAM: 3, HIELO: 4, ALCANT: 5, FUNDI: 6, PUENTE: 7, CARNAVAL: 8 };
var WG_DNAME = ['MAR ABIERTO', 'AZOTEAS DE GOTHAM', 'MUELLES DE GOTHAM', 'TORRE DE ARKHAM', 'MUELLE HELADO',
  'ALCANTARILLAS', 'FUNDICIÓN DE ACERO', 'EL PUENTE DE GOTHAM', 'CARNAVAL DE ARKHAM'];

// ── land, channel, districts ──────────────────────────────────────────────

// A channel runs east-west through the whole island. Its centre wanders, so it
// reads as a river rather than a ruled line, and it is wide enough that the only
// ways across are the bridge, a long glide or the grapple.
function WG_channelZ(x) { return 170 + 22 * Math.sin(x / 160) + 9 * Math.sin(x / 53 + 1.3); }
function WG_channelHW(x) { return 50 + 7 * Math.sin(x / 97 + 0.6); }
function WG_inChannel(x, z) { return Math.abs(z - WG_channelZ(x)) < WG_channelHW(x); }

function WG_landRaw(x, z) {
  const r = Math.hypot(x / 770, z / 720);
  const n = NZ_fbm2(x / 120, z / 120, 7, 3) - 0.5;
  return r + n * 0.24 < 1.0;
}
function WG_isLand(x, z) { return WG_landRaw(x, z) && !WG_inChannel(x, z); }

// Voronoi-ish regions, warped so borders wander. Centres are in blocks and the
// radius is only a weight: a district with a bigger radius wins more ground.
var WG_CENTERS = [
  [WG_D.AZOTEAS, 0, -40, 300],
  [WG_D.ARKHAM, -20, -540, 240],
  [WG_D.CARNAVAL, -480, -330, 260],
  [WG_D.HIELO, 480, -360, 260],
  [WG_D.MUELLES, -460, 420, 290],
  [WG_D.ALCANT, 40, 420, 250],
  [WG_D.FUNDI, 480, 420, 260],
];
function WG_districtAt(x, z) {
  const wx = x + (NZ_fbm2(x / 150, z / 150, 3, 2) - 0.5) * 90;
  const wz = z + (NZ_fbm2(x / 150 + 40, z / 150 + 40, 5, 2) - 0.5) * 90;
  let best = 1, bd = 1e9;
  for (let i = 0; i < WG_CENTERS.length; i++) {
    const c = WG_CENTERS[i];
    const d = Math.hypot(wx - c[1], wz - c[2]) / c[3];
    if (d < bd) { bd = d; best = c[0]; }
  }
  // the bridge approaches belong to the bridge, whatever bank they are on
  if (Math.abs(x - 5) < 70 && Math.abs(z - WG_channelZ(5)) < 130) return WG_D.PUENTE;
  return best;
}

// ── building styles ───────────────────────────────────────────────────────
// A style says how a facade is dressed. Resolved to block ids once, below.
var WG_STY = [];
(function () {
  function S(o) {
    const r = {};
    for (const k in o) r[k] = (typeof o[k] === 'string' && BK[o[k]] !== undefined) ? BK[o[k]] : o[k];
    WG_STY.push(r);
  }
  // 0 office block: dark concrete, blue glass, steel piers
  S({ wall: 'CONCRETE_DK', pier: 'STEEL_DK', ledge: 'CONCRETE', win: 'GLASS_BLUE', roof: 'ROOF_TAR', WP: 3, FH: 4, lit: 0.34, wr: 2, wy: 1, store: 1 });
  // 1 glass tower: curtain wall, thin mullions
  S({ wall: 'STEEL_DK', pier: 'STEEL', ledge: 'STEEL', win: 'GLASS_BLUE', roof: 'ROOF_TAR', WP: 2, FH: 4, lit: 0.27, wr: 3, wy: 1, store: 1 });
  // 2 art deco: pale stone, tall dark window strips
  S({ wall: 'CONCRETE_LT', pier: 'CONCRETE', ledge: 'CONCRETE_LT', win: 'GLASS', roof: 'ROOF_GRAVEL', WP: 4, FH: 4, lit: 0.40, wr: 2, wy: 1, store: 1 });
  // 3 brick: small windows, red walls
  S({ wall: 'BRICK', pier: 'BRICK_DK', ledge: 'CONCRETE', win: 'GLASS', roof: 'ROOF_TAR', WP: 4, FH: 4, lit: 0.30, wr: 2, wy: 1, store: 1 });
  // 4 gothic: narrow tall windows, stone
  S({ wall: 'GOTHIC', pier: 'GOTHIC_DK', ledge: 'GOTHIC_DK', win: 'GLASS', roof: 'COPPER', WP: 4, FH: 5, lit: 0.22, wr: 3, wy: 1, store: 0 });
  // 5 warehouse: rust and concrete, few windows
  S({ wall: 'CONCRETE', pier: 'RUST', ledge: 'CONCRETE_DK', win: 'GLASS', roof: 'ROOF_GRAVEL', WP: 6, FH: 6, lit: 0.10, wr: 1, wy: 4, store: 0 });
  // 6 industrial: rust and steel
  S({ wall: 'RUST', pier: 'STEEL_DK', ledge: 'STEEL_DK', win: 'GLASS', roof: 'STEEL_DK', WP: 5, FH: 5, lit: 0.16, wr: 1, wy: 3, store: 0 });
  // 7 carnival: bright stripes
  S({ wall: 'CARN_RED', pier: 'CARN_WHITE', ledge: 'CARN_PURPLE', win: 'GLASS', roof: 'CARN_PURPLE', WP: 4, FH: 4, lit: 0.45, wr: 2, wy: 1, store: 1 });
  // 8 ice: pale blue and snow
  S({ wall: 'CONCRETE_LT', pier: 'ICE', ledge: 'SNOW', win: 'GLASS_BLUE', roof: 'SNOW', WP: 4, FH: 4, lit: 0.35, wr: 2, wy: 1, store: 1 });
})();

// ── blocks ────────────────────────────────────────────────────────────────

var WG_blockCache = new Map();

function WG_mk(x0, z0, x1, z1, h, st, seed, o) {
  const b = { x0: x0, z0: z0, x1: x1, z1: z1, h: h, st: st, seed: seed, base: WG_BASE,
    tiers: null, roof: 0, rh: 0, wo: NZ_hash(seed, 3, 5) % 7, props: null, lit: -1 };
  if (o) for (const k in o) b[k] = o[k];
  return b;
}

function WG_blockInfo(bx, bz) {
  const key = (bx + 512) * 1024 + (bz + 512);
  let b = WG_blockCache.get(key);
  if (!b) { b = WG_genBlock(bx, bz); WG_blockCache.set(key, b); }
  return b;
}

// Landmarks overwrite a handful of blocks; every other open lot gets district dressing.
function WG_genBlock(bx, bz) {
  const info = WG_genBlock0(bx, bz);
  if (!info.full) return info;
  const sp = LM_special(bx, bz);
  if (sp) LM_block(sp, info, info.ox, info.oz, WG_PITCH - WG_ST);
  LM_decoFor(info);
  return info;
}

function WG_genBlock0(bx, bz) {
  const ox = bx * WG_PITCH + WG_ST, oz = bz * WG_PITCH + WG_ST;
  const L = WG_PITCH - WG_ST;   // 38
  const info = { bx: bx, bz: bz, ox: ox, oz: oz, d: 0, full: false, kind: 'water', bld: [] };
  let land = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (WG_isLand(ox + i * (L / 2), oz + j * (L / 2))) land++;
  }
  if (land === 0) return info;
  info.d = WG_districtAt(ox + L / 2, oz + L / 2);
  if (land < 9) { info.kind = 'shore'; return info; }
  info.full = true;
  info.kind = 'bld';

  const s = NZ_hash(bx, bz, WG_SEED);
  const r = NZ_f(bx, bz, 11), r2 = NZ_f(bx, bz, 12), r3 = NZ_f(bx, bz, 13), r4 = NZ_f(bx, bz, 14);
  const cxm = ox + L / 2, czm = oz + L / 2;
  const d = info.d;

  if (d === WG_D.AZOTEAS || d === WG_D.PUENTE) {
    const cd = Math.min(1, Math.hypot(cxm, czm + 40) / 300);
    if (r < 0.10) { info.kind = 'park'; return info; }
    if (r < 0.52) {
      // one big tower, often stepped like the old art-deco skyscrapers
      const ins = Math.floor(r2 * 4);
      const hmax = 92 - 62 * cd;
      const h = Math.floor(24 + r3 * (hmax - 24));
      const st = r4 < 0.34 ? 0 : (r4 < 0.62 ? 1 : 2);
      const tiers = [];
      if (h > 44 && (st === 2 || r2 > 0.55)) {
        tiers.push([4 + ins, Math.floor(h * 0.78)]);
        if (h > 62) tiers.push([9 + ins, Math.floor(h * 0.92)]);
        if (h > 76) tiers.push([14 + ins, h]);
      }
      const hh = tiers.length ? Math.floor(h * 0.62) : h;
      const b = WG_mk(ox + ins, oz + ins, ox + L - ins, oz + L - ins, hh, st, s, { tiers: tiers.length ? tiers : null });
      info.bld.push(b);
    } else {
      // four mid-rises, with a gap so the alleys between them are walkable
      const q = [[0, 0], [20, 0], [0, 20], [20, 20]];
      for (let i = 0; i < 4; i++) {
        const rr = NZ_f(bx * 4 + i, bz, 21);
        const hh = Math.floor(12 + rr * (46 - 26 * cd));
        const st = NZ_f(bx * 4 + i, bz, 22) < 0.5 ? 0 : 3;
        info.bld.push(WG_mk(ox + q[i][0], oz + q[i][1], ox + q[i][0] + 18, oz + q[i][1] + 18, hh, st, NZ_hash(s, i, 7)));
      }
    }
    return info;
  }

  if (d === WG_D.ARKHAM) {
    if (r < 0.14) { info.kind = 'park'; return info; }
    // gothic masses with pitched roofs and the odd spire
    if (r < 0.5) {
      const h = Math.floor(14 + r2 * 22);
      info.bld.push(WG_mk(ox + 2, oz + 2, ox + L - 2, oz + L - 2, h, 4, s, { roof: r3 < 0.5 ? 1 : 2, rh: 9 }));
    } else {
      const q = [[0, 0], [20, 0], [0, 20], [20, 20]];
      for (let i = 0; i < 4; i++) {
        const rr = NZ_f(bx * 4 + i, bz, 31);
        const h = Math.floor(10 + rr * 22);
        info.bld.push(WG_mk(ox + q[i][0], oz + q[i][1], ox + q[i][0] + 18, oz + q[i][1] + 18, h, 4, NZ_hash(s, i, 9),
          { roof: rr < 0.3 ? 3 : (rr < 0.65 ? 1 : 2), rh: rr < 0.3 ? 16 : 7 }));
      }
    }
    return info;
  }

  if (d === WG_D.MUELLES) {
    if (r < 0.30) { info.kind = 'yard'; return info; }       // container yard
    // long low warehouses
    if (r2 < 0.5) {
      info.bld.push(WG_mk(ox + 1, oz + 2, ox + L - 1, oz + 17, Math.floor(8 + r3 * 7), 5, s));
      info.bld.push(WG_mk(ox + 1, oz + 21, ox + L - 1, oz + L - 2, Math.floor(8 + r4 * 8), 5, NZ_hash(s, 1, 1)));
    } else {
      info.bld.push(WG_mk(ox + 2, oz + 2, ox + L - 2, oz + L - 2, Math.floor(10 + r3 * 14), 5, s));
    }
    return info;
  }

  if (d === WG_D.ALCANT) {
    if (r < 0.08) { info.kind = 'park'; return info; }
    // dense little brick houses with pitched roofs: four to six lots per block
    const q = [[0, 0], [13, 0], [26, 0], [0, 20], [13, 20], [26, 20]];
    for (let i = 0; i < 6; i++) {
      const rr = NZ_f(bx * 8 + i, bz, 41);
      if (rr < 0.12) continue;
      const w = i % 3 === 2 ? 12 : 12;
      info.bld.push(WG_mk(ox + q[i][0], oz + q[i][1], ox + q[i][0] + w, oz + q[i][1] + 17,
        Math.floor(9 + rr * 16), 3, NZ_hash(s, i, 13), { roof: rr < 0.5 ? 1 : 2, rh: 6 }));
    }
    return info;
  }

  if (d === WG_D.FUNDI) {
    if (r < 0.2) { info.kind = 'yard'; return info; }
    info.bld.push(WG_mk(ox + 2, oz + 2, ox + L - 2, oz + L - 2, Math.floor(14 + r2 * 26), 6, s));
    return info;
  }

  if (d === WG_D.CARNAVAL) {
    if (r < 0.34) { info.kind = 'plaza'; return info; }
    const q = [[0, 0], [20, 0], [0, 20], [20, 20]];
    for (let i = 0; i < 4; i++) {
      const rr = NZ_f(bx * 4 + i, bz, 51);
      if (rr < 0.2) continue;
      info.bld.push(WG_mk(ox + q[i][0], oz + q[i][1], ox + q[i][0] + 18, oz + q[i][1] + 18,
        Math.floor(8 + rr * 18), 7, NZ_hash(s, i, 17), { roof: rr < 0.6 ? 3 : 0, rh: 10 }));
    }
    return info;
  }

  if (d === WG_D.HIELO) {
    if (r < 0.28) { info.kind = 'plaza'; return info; }
    const q = [[0, 0], [20, 0], [0, 20], [20, 20]];
    for (let i = 0; i < 4; i++) {
      const rr = NZ_f(bx * 4 + i, bz, 61);
      if (rr < 0.25) continue;
      info.bld.push(WG_mk(ox + q[i][0], oz + q[i][1], ox + q[i][0] + 18, oz + q[i][1] + 18,
        Math.floor(8 + rr * 16), 8, NZ_hash(s, i, 19)));
    }
    return info;
  }

  info.kind = 'plaza';
  return info;
}

// ── a building's height at one column ─────────────────────────────────────
// 0 means "this column is not inside the building". Includes the parapet and the
// roof profile, so it is the true solid top; props above it are not counted.
function WG_bTop(b, x, z) {
  if (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1) return 0;
  let h = b.h, ins = 0;
  const T = b.tiers;
  if (T) {
    for (let i = 0; i < T.length; i++) {
      const t = T[i], k = t[0];
      if (t[1] > h && x >= b.x0 + k && x < b.x1 - k && z >= b.z0 + k && z < b.z1 - k) { h = t[1]; ins = k; }
    }
  }
  let top = b.base + h;
  if (b.roof === 0) {
    if (x === b.x0 + ins || x === b.x1 - 1 - ins || z === b.z0 + ins || z === b.z1 - 1 - ins) top += 1;   // parapet
  } else if (b.roof === 1) {                                  // gable, ridge along x
    const mid = (b.z0 + b.z1 - 1) / 2, half = (b.z1 - b.z0) / 2;
    top += Math.max(0, Math.min(b.rh, Math.floor((half - Math.abs(z - mid)) * 0.62)));
  } else if (b.roof === 2) {                                  // gable, ridge along z
    const mid = (b.x0 + b.x1 - 1) / 2, half = (b.x1 - b.x0) / 2;
    top += Math.max(0, Math.min(b.rh, Math.floor((half - Math.abs(x - mid)) * 0.62)));
  } else if (b.roof === 3) {                                  // pyramid / spire
    const cx = (b.x0 + b.x1 - 1) / 2, cz = (b.z0 + b.z1 - 1) / 2;
    const dd = Math.max(Math.abs(x - cx), Math.abs(z - cz));
    top += Math.max(0, b.rh - Math.floor(dd * (b.rh / ((b.x1 - b.x0) / 2 + 0.5))));
  }
  return top < WG_H - 1 ? top : WG_H - 1;
}

// ── column classification ─────────────────────────────────────────────────
var WG_K = { WATER: 0, ROAD: 1, SIDEWALK: 2, LOT: 3, BUILDING: 4, PARK: 5, SHORE: 6, PLAZA: 7, YARD: 8, BRIDGE: 9, ARENA: 10 };

// Fills `o` with what stands in column (x, z): its kind, the solid top (the first
// free y above the mass), and the building if there is one.
function WG_colInfo(x, z, o) {
  o.b = null;
  if (!WG_isLand(x, z)) {
    if (x >= 0 && x < WG_ST && LM_bridgeTop(x, z)) { o.kind = WG_K.BRIDGE; o.top = LM_massTop(x, z); return o; }
    o.kind = WG_K.WATER; o.top = WG_FLOOR + 1; return o;
  }
  const ux = NZ_mod(x, WG_PITCH), uz = NZ_mod(z, WG_PITCH);
  const sx = ux < WG_ST, sz = uz < WG_ST;
  if (sx || sz) {
    // a street. The outer two voxels each side are raised pavement.
    const a = sx ? ux : 99, c = sz ? uz : 99;
    if ((sx && (ux < 2 || ux > 7)) && (!sz || (uz < 2 || uz > 7))) { o.kind = WG_K.SIDEWALK; o.top = WG_GY + 2; return o; }
    if ((sz && (uz < 2 || uz > 7)) && (!sx || (ux < 2 || ux > 7))) { o.kind = WG_K.SIDEWALK; o.top = WG_GY + 2; return o; }
    o.kind = WG_K.ROAD; o.top = WG_GY + 1; return o;
  }
  const bx = Math.floor(x / WG_PITCH), bz = Math.floor(z / WG_PITCH);
  const info = WG_blockInfo(bx, bz);
  if (info.kind === 'water') { o.kind = WG_K.WATER; o.top = WG_FLOOR + 1; return o; }
  if (info.kind === 'shore') { o.kind = WG_K.SHORE; o.top = WG_GY + 2; return o; }
  for (let i = 0; i < info.bld.length; i++) {
    const t = WG_bTop(info.bld[i], x, z);
    if (t) { o.kind = WG_K.BUILDING; o.b = info.bld[i]; o.top = t; return o; }
  }
  o.kind = info.kind === 'park' ? WG_K.PARK : (info.kind === 'plaza' ? WG_K.PLAZA : (info.kind === 'yard' ? WG_K.YARD : (info.kind === 'arena' ? WG_K.ARENA : WG_K.LOT)));
  o.top = WG_GY + 2;
  return o;
}

var WG_tmpCol = { kind: 0, top: 0, b: null };
// The solid mass at a column, ignoring small props. The light baker uses it for
// moon shadows and horizon occlusion, so it has to be cheap and consistent.
function WG_topMass(x, z) { return WG_colInfo(x, z, WG_tmpCol).top; }

function WG_massChunk(cx, cz) {
  const m = new Uint8Array(256), o = { kind: 0, top: 0, b: null };
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) m[i * 16 + j] = WG_colInfo(cx * 16 + i, cz * 16 + j, o).top;
  return m;
}

// ── facade dressing ───────────────────────────────────────────────────────
function WG_facade(b, st, x, y, z, ex) {
  // ex: which of -x,+x,-z,+z are exposed at this height (booleans)
  let n = 0, side = 0;
  for (let i = 0; i < 4; i++) if (ex[i]) { n++; side = i; }
  if (n >= 2) return st.pier;                         // a corner is always a pier
  const u = (side < 2 ? z : x) + b.wo;
  const f = Math.floor((y - b.base) / st.FH);
  const yy = (y - b.base) - f * st.FH;
  const iu = NZ_mod(u, st.WP);
  const cu = Math.floor(u / st.WP);
  if (yy === 0) {                                     // the floor slab; over an open shop, its sign
    if (f === 1 && st.store) { const sg = WG_shopSign(b, side, u, st); if (sg) return sg; }
    return st.ledge;
  }
  if (iu === 0) return st.pier;                       // the vertical pier between windows
  // ground floor of shops and offices: tall glass instead of small windows, lit if the shop is open
  if (f === 0 && st.store) return yy <= 3 ? (WG_shop(b, side, cu, st) || st.win) : st.wall;
  if (yy < st.wy || yy >= st.wy + st.wr) return st.wall;       // spandrel above/below the window band
  // a window: lit or dark, decided from the building and the window's own address
  if (NZ_f(b.seed + side * 131, f, cu) < st.lit) {
    const k = NZ_f(b.seed, f * 3 + 1, cu * 7 + side);
    return k < 0.62 ? BK.WIN_WARM : (k < 0.9 ? BK.WIN_COOL : BK.WIN_WHITE);
  }
  return st.win;
}

// ── shops, signs and billboards ───────────────────────────────────────────
var WG_SIGNS = [], WG_BLADES = [];
(function () {
  for (const c of ['PINK', 'CYAN', 'YELLOW', 'GREEN', 'RED', 'WHITE']) { WG_SIGNS.push(BK['SIGN_' + c]); WG_BLADES.push(BK['BLADE_' + c]); }
})();
var WG_SIGN_RGB = [[1.0, 0.22, 0.59], [0.22, 0.86, 1.0], [1.0, 0.82, 0.24], [0.35, 1.0, 0.47], [1.0, 0.19, 0.19], [0.92, 0.94, 1.0]];

// How many window cells one shop takes, so that shops are 8 or 9 blocks wide whatever the style.
function WG_shopCells(st) { return st.WP <= 2 ? 4 : (st.WP === 3 ? 3 : 2); }

// The shop behind window cell `cu` on one side of a building: 0 when it is shut and
// dark, else the block its lit glass is made of.
function WG_shop(b, side, cu, st) {
  if (!st.store || b.special) return 0;
  const h = NZ_hash(b.seed + side * 17, Math.floor(cu / WG_shopCells(st)), 77);
  if ((h & 255) > 122) return 0;
  const k = (h >>> 8) % 20;
  return k < 9 ? BK.SHOP_WARM : (k < 15 ? BK.SHOP_COOL : (k < 18 ? BK.SHOP_PINK : BK.SHOP_GREEN));
}

// The sign band over an open shop: 0, or the block of the band at wall coordinate u.
function WG_shopSign(b, side, u, st) {
  const n = WG_shopCells(st) * st.WP, su = Math.floor(u / n);
  if (!WG_shop(b, side, Math.floor(u / st.WP), st)) return 0;
  const h = NZ_hash(b.seed + side * 17, su, 79);
  if ((h & 255) > 175 || u - su * n < 1) return 0;
  return WG_SIGNS[(h >>> 8) % 6];
}

// A neon blade standing one voxel out from a side of a building: null, or where along
// the side it hangs (p), between which heights, and its colour index.
function WG_blade(b, side) {
  if (!b.blades) {
    b.blades = [null, null, null, null];
    if (WG_STY[b.st].store && !b.special && b.h >= 13) {
      for (let s = 0; s < 4; s++) {
        const h = NZ_hash(b.seed, 500 + s, 9), len = s < 2 ? b.z1 - b.z0 : b.x1 - b.x0;
        if ((h & 255) > 84 || len < 10) continue;
        b.blades[s] = { p: (s < 2 ? b.z0 : b.x0) + 2 + ((h >>> 8) % (len - 4)), y0: b.base + 6,
          y1: Math.min(b.base + 11 + ((h >>> 16) % 5), b.base + b.h - 1), k: (h >>> 20) % 6 };
      }
    }
  }
  return b.blades[side];
}

// A billboard along one edge of a flat roof, one voxel in from the parapet: null, or
// its axis (1: it runs along z), the coordinate across, where it starts, and its edge.
function WG_billboard(b) {
  if (b.bb === undefined) {
    b.bb = null;
    const w = b.x1 - b.x0, d = b.z1 - b.z0, h = NZ_hash(b.seed, 77, 13);
    if (b.roof === 0 && !b.tiers && !b.special && b.h >= 12 && b.h <= 70 && w >= 17 && d >= 17 && (h & 255) < 56) {
      const s = (h >>> 8) & 3, ax = s < 2 ? 1 : 0, len = ax ? d : w;
      b.bb = { ax: ax, s: s, a0: (ax ? b.z0 : b.x0) + 2 + ((h >>> 12) % (len - 15)),
        c: s === 0 ? b.x0 + 1 : s === 1 ? b.x1 - 2 : s === 2 ? b.z0 + 1 : b.z1 - 2 };
    }
  }
  return b.bb;
}

// Things standing on a flat roof: tanks, antennas, vents. Deterministic per
// building, placed away from the parapet.
function WG_roofProps(b) {
  if (b.props) return b.props;
  const p = [], w = b.x1 - b.x0, d = b.z1 - b.z0;
  const ins = (b.tiers && b.tiers.length) ? b.tiers[b.tiers.length - 1][0] : 0;
  const x0 = b.x0 + ins + 2, x1 = b.x1 - ins - 2, z0 = b.z0 + ins + 2, z1 = b.z1 - ins - 2;
  if (b.roof !== 0 || x1 - x0 < 6 || z1 - z0 < 6) { b.props = p; return p; }
  const n = 1 + (NZ_hash(b.seed, 9, 1) % 3);
  for (let i = 0; i < n; i++) {
    const k = NZ_hash(b.seed, 20 + i, 2) % 5;
    const px = x0 + (NZ_hash(b.seed, 30 + i, 3) % Math.max(1, x1 - x0 - 4));
    const pz = z0 + (NZ_hash(b.seed, 40 + i, 4) % Math.max(1, z1 - z0 - 4));
    p.push({ k: k, x: px, z: pz });
  }
  b.props = p;
  return p;
}

// Block id for a prop voxel at (x, dy, z), dy counted up from the roof surface.
function WG_propBlock(p, x, dy, z, seed) {
  const lx = x - p.x, lz = z - p.z;
  if (p.k === 0) {                                    // water tank on legs
    if (lx < 0 || lx > 4 || lz < 0 || lz > 4) return 0;
    if (dy < 3) return ((lx === 0 || lx === 4) && (lz === 0 || lz === 4)) ? BK.STEEL_DK : 0;
    if (dy < 7) return (dy === 4 || dy === 6) ? BK.STEEL_DK : BK.WOOD;
    if (dy === 7) return (lx > 0 && lx < 4 && lz > 0 && lz < 4) ? BK.WOOD_DK : 0;
    return 0;
  }
  if (p.k === 1 || p.k === 4) {                       // antenna with a red beacon
    if (lx !== 2 || lz !== 2) return (dy === 4 && (lx === 1 || lx === 3) && lz === 2) ? BK.STEEL_DK : 0;
    const h = 9 + (seed % 7);
    if (dy < h) return BK.STEEL_DK;
    if (dy === h) return BK.BEACON_RED;
    return 0;
  }
  if (p.k === 2) {                                    // ventilation box
    if (lx < 0 || lx > 2 || lz < 0 || lz > 2 || dy > 1) return 0;
    return dy === 1 ? BK.STEEL : BK.CONCRETE;
  }
  if (p.k === 3) {                                    // skylight
    if (lx < 0 || lx > 3 || lz < 0 || lz > 3 || dy > 0) return 0;
    return BK.SKYLIGHT;
  }
  return 0;
}

// ── street furniture ──────────────────────────────────────────────────────

// A street lamp: pole on the outer sidewalk voxel, an arm over the road, the lamp
// head at the arm's end. Returns {part: 1 pole | 2 arm | 3 head, dir} or null.
function WG_lampAt(x, z) {
  const ux = NZ_mod(x, WG_PITCH), uz = NZ_mod(z, WG_PITCH);
  // street running along z (the strip is x-narrow)
  if (ux < WG_ST && uz >= WG_ST) {
    const zz = NZ_mod(z, 32);
    if (ux === 0 && zz === 6) return { part: 1, dir: 1 };
    if (ux === 9 && zz === 22) return { part: 1, dir: -1 };
    if (ux === 1 && zz === 6) return { part: 2, dir: 1 };
    if (ux === 2 && zz === 6) return { part: 3, dir: 1 };
    if (ux === 8 && zz === 22) return { part: 2, dir: -1 };
    if (ux === 7 && zz === 22) return { part: 3, dir: -1 };
  }
  if (uz < WG_ST && ux >= WG_ST) {
    const xx = NZ_mod(x, 32);
    if (uz === 0 && xx === 6) return { part: 1, dir: 1 };
    if (uz === 9 && xx === 22) return { part: 1, dir: -1 };
    if (uz === 1 && xx === 6) return { part: 2, dir: 1 };
    if (uz === 2 && xx === 6) return { part: 3, dir: 1 };
    if (uz === 8 && xx === 22) return { part: 2, dir: -1 };
    if (uz === 7 && xx === 22) return { part: 3, dir: -1 };
  }
  return null;
}

// Parked cars: a 4x2x2 shape in the kerbside lanes, placed by hash. Returns the
// block at (x, dy, z) or 0.
var WG_CARCOL = [];
(function () { WG_CARCOL = [BK.CAR_RED, BK.CAR_BLUE, BK.CAR_WHITE, BK.CAR_BLACK, BK.CAR_YELLOW, BK.CAR_BLACK, BK.CAR_WHITE]; })();
function WG_carBlock(x, dy, z) {
  if (dy > 1) return 0;
  const ux = NZ_mod(x, WG_PITCH), uz = NZ_mod(z, WG_PITCH);
  let along, lane, strip;
  if (ux < WG_ST && uz >= WG_ST) {                    // street along z
    if (!((ux >= 2 && ux <= 3) || (ux >= 6 && ux <= 7))) return 0;
    lane = ux <= 3 ? 0 : 1; strip = Math.floor(x / WG_PITCH) * 2 + lane; along = z;
  } else if (uz < WG_ST && ux >= WG_ST) {             // street along x
    if (!((uz >= 2 && uz <= 3) || (uz >= 6 && uz <= 7))) return 0;
    lane = uz <= 3 ? 0 : 1; strip = Math.floor(z / WG_PITCH) * 2 + lane + 1000; along = x;
  } else return 0;
  const slot = Math.floor(along / 10), la = NZ_mod(along, 10);
  const h = NZ_hash(slot, strip, 77);
  if ((h & 255) / 255 > 0.38) return 0;
  const off = (h >>> 8) % 5;
  // The whole car must sit clear of the crossings. Deciding that per column would
  // slice a car in half at the edge of the exclusion zone, so decide it per car.
  const m0 = NZ_mod(slot * 10 + off, WG_PITCH);
  if (m0 < WG_ST + 2 || m0 + 3 > WG_PITCH - 4) return 0;
  const i = la - off;
  if (i < 0 || i > 3) return 0;
  const col = WG_CARCOL[(h >>> 16) % WG_CARCOL.length];
  if (dy === 0) return i === 0 ? BK.HEADLIGHT : (i === 3 ? BK.TAILLIGHT : col);
  return (i === 1 || i === 2) ? BK.GLASS : 0;
}

// ── filling a chunk ───────────────────────────────────────────────────────

var WG_C18 = 18;
function WG_genChunk(cx, cz) {
  const H = WG_H, vox = new Uint8Array(256 * H), top = new Uint8Array(256);
  const x0 = cx * 16, z0 = cz * 16;
  // classify an 18x18 patch: the chunk plus one column all round, so a facade
  // can see whether its neighbour column is lower
  const kind = new Uint8Array(324), tp = new Uint8Array(324), bl = new Array(324);
  const o = { kind: 0, top: 0, b: null };
  for (let i = 0; i < 18; i++) for (let j = 0; j < 18; j++) {
    WG_colInfo(x0 + i - 1, z0 + j - 1, o);
    const k = i * 18 + j;
    kind[k] = o.kind; tp[k] = o.top; bl[k] = o.b;
  }
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = x0 + i, z = z0 + j, ci = (i + 1) * 18 + (j + 1);
      const col = (i * 16 + j) * H;
      const kd = kind[ci];
      vox[col] = BK.BEDROCK;
      if (kd === WG_K.WATER || kd === WG_K.BRIDGE) {
        const bed = WG_FLOOR - (NZ_hash(x >> 2, z >> 2, 9) & 1);
        for (let y = 1; y <= bed; y++) vox[col + y] = y === bed ? BK.SAND : BK.STONE;
        for (let y = bed + 1; y <= WG_SEA; y++) vox[col + y] = BK.WATER;
        top[i * 16 + j] = bed + 1;
        if (kd === WG_K.BRIDGE) LM_bridgeColumn(x, z, vox, col);
        continue;
      }
      for (let y = 1; y < WG_GY; y++) vox[col + y] = BK.STONE;
      const ux = NZ_mod(x, WG_PITCH), uz = NZ_mod(z, WG_PITCH);
      let t = WG_GY + 1;
      if (kd === WG_K.ROAD) {
        let blk = BK.ASPHALT;
        const inX = ux < WG_ST, inZ = uz < WG_ST;
        if (inX && !inZ) {                                   // street along z
          if (ux === 4 && NZ_mod(z, 6) < 3) blk = BK.ROADLINE;
          if ((uz >= WG_ST && uz < WG_ST + 2) || uz > WG_PITCH - 3) if ((ux & 1) === 0) blk = BK.ROADLINE;   // zebra
        } else if (inZ && !inX) {
          if (uz === 4 && NZ_mod(x, 6) < 3) blk = BK.ROADLINE;
          if ((ux >= WG_ST && ux < WG_ST + 2) || ux > WG_PITCH - 3) if ((uz & 1) === 0) blk = BK.ROADLINE;
        }
        vox[col + WG_GY] = blk;
      } else if (kd === WG_K.SIDEWALK) {
        vox[col + WG_GY] = BK.SIDEWALK; vox[col + WG_GY + 1] = BK.SIDEWALK;
        // kerb: the sidewalk voxel that touches the road
        const kerbX = (ux === 1 || ux === 8) && uz >= WG_ST;
        const kerbZ = (uz === 1 || uz === 8) && ux >= WG_ST;
        if (kerbX || kerbZ) vox[col + WG_GY + 1] = BK.CURB;
        t = WG_GY + 2;
      } else if (kd === WG_K.PARK) {
        vox[col + WG_GY] = BK.DIRT; vox[col + WG_GY + 1] = BK.GRASS; t = WG_GY + 2;
      } else if (kd === WG_K.YARD) {
        vox[col + WG_GY] = BK.CONCRETE_DK; vox[col + WG_GY + 1] = BK.CONCRETE_DK; t = WG_GY + 2;
        LM_lot(x, z, vox, col);
      } else if (kd === WG_K.PLAZA) {
        vox[col + WG_GY] = BK.CONCRETE; vox[col + WG_GY + 1] = ((ux + uz) & 7) === 0 ? BK.CONCRETE_DK : BK.CONCRETE_LT; t = WG_GY + 2;
        LM_lot(x, z, vox, col);
      } else if (kd === WG_K.ARENA) {
        vox[col + WG_GY] = BK.STONE; vox[col + WG_GY + 1] = BK.CONCRETE_LT; t = WG_GY + 2;
        LM_lot(x, z, vox, col);
      } else if (kd === WG_K.BUILDING) {
        vox[col + WG_GY] = BK.SIDEWALK; vox[col + WG_GY + 1] = BK.SIDEWALK;
        const b = bl[ci], T = tp[ci], st = WG_STY[b.st];
        const nT = [tp[(i) * 18 + (j + 1)], tp[(i + 2) * 18 + (j + 1)], tp[(i + 1) * 18 + j], tp[(i + 1) * 18 + (j + 2)]];
        // a neighbour that is not part of this building counts as ground
        for (let q = 0; q < 4; q++) {
          const ni = i + (q === 0 ? 0 : q === 1 ? 2 : 1), nj = j + (q === 2 ? 0 : q === 3 ? 2 : 1);
          if (bl[ni * 18 + nj] !== b) nT[q] = WG_BASE;
        }
        const mn = Math.min(nT[0], nT[1], nT[2], nT[3]);
        const ex = [false, false, false, false];
        // a parapet is a top voxel that stands one higher than a neighbour in the same building
        let par = false;
        if (b.roof === 0) for (let q = 0; q < 4; q++) if (nT[q] === T - 1 && nT[q] > WG_BASE) par = true;
        for (let y = WG_BASE; y < T; y++) {
          let blk;
          if (y === T - 1) {
            blk = par ? st.ledge : st.roof;
          } else if (y >= mn) {
            for (let q = 0; q < 4; q++) ex[q] = nT[q] <= y;
            blk = (b.roof !== 0 && y >= b.base + b.h) ? st.roof : WG_facade(b, st, x, y, z, ex);
          } else blk = BK.CONCRETE_DK;
          vox[col + y] = blk;
        }
        // props on flat roofs
        if (b.roof === 0 && T < WG_H - 20) {
          const pr = WG_roofProps(b);
          for (let q = 0; q < pr.length; q++) {
            const p = pr[q];
            if (x < p.x || x > p.x + 4 || z < p.z || z > p.z + 4) continue;
            // only on a column whose roof is at the building's top level
            if (T !== b.base + (b.tiers && b.tiers.length ? b.tiers[b.tiers.length - 1][1] : b.h)) continue;
            for (let dy = 0; dy < 20 && T + dy < WG_H; dy++) {
              const pb = WG_propBlock(p, x, dy, z, b.seed);
              if (pb) vox[col + T + dy] = pb;
            }
          }
        }
        // a billboard: two legs and a lit panel, twelve wide and six tall
        const bb = b.roof === 0 ? WG_billboard(b) : null;
        if (bb && (bb.ax ? x : z) === bb.c && T === b.base + b.h && T + 9 < WG_H) {
          const ia = (bb.ax ? z : x) - bb.a0;
          if (ia >= 0 && ia < 12) {
            if (ia === 1 || ia === 10) { vox[col + T] = BK.STEEL_DK; vox[col + T + 1] = BK.STEEL_DK; }
            for (let dy = 2; dy < 8; dy++) vox[col + T + dy] = BK.BILLBOARD;
          }
        }
        if (b.special === 'gcpd') LM_gcpdColumn(x, z, vox, col, T);
        t = T;
      } else {                                               // plain lot or shore paving
        vox[col + WG_GY] = BK.SIDEWALK; vox[col + WG_GY + 1] = BK.SIDEWALK; t = WG_GY + 2;
      }
      // furniture on streets
      if (kd === WG_K.SIDEWALK || kd === WG_K.ROAD) {
        if (x >= 0 && x < WG_ST) LM_cableColumn(x, z, vox, col);
        const lamp = WG_lampAt(x, z);
        if (lamp) {
          const y0 = WG_GY + 2;
          if (lamp.part === 1) { for (let y = y0; y <= y0 + 6; y++) vox[col + y] = BK.LAMP_POLE; t = y0 + 7; }
          else if (lamp.part === 2) { vox[col + y0 + 6] = BK.LAMP_POLE; t = y0 + 7; }
          else { vox[col + y0 + 6] = BK.LAMP_LIGHT; vox[col + y0 + 7] = BK.LAMP_POLE; t = y0 + 8; }
        } else if (kd === WG_K.ROAD) {
          for (let dy = 0; dy < 2; dy++) {
            const cb = WG_carBlock(x, dy, z);
            if (cb) { vox[col + WG_GY + 1 + dy] = cb; t = WG_GY + 2 + dy; }
          }
        }
      }
      // neon blades: a column that touches a building may carry one of its signs
      if (kd !== WG_K.BUILDING) {
        for (let q = 0; q < 4; q++) {
          // q is the side of the neighbouring building that faces this column
          const nbb = bl[q === 0 ? (i + 2) * 18 + (j + 1) : q === 1 ? i * 18 + (j + 1) : q === 2 ? (i + 1) * 18 + (j + 2) : (i + 1) * 18 + j];
          if (!nbb) continue;
          const bd = WG_blade(nbb, q);
          if (!bd || bd.p !== (q < 2 ? z : x)) continue;
          for (let y = bd.y0; y < bd.y1; y++) if (!vox[col + y]) vox[col + y] = WG_BLADES[bd.k];
          if (bd.y1 > t) t = bd.y1;
        }
      }
      // trees and benches in parks
      if (kd === WG_K.PARK) {
        const tr = NZ_hash(x >> 2, z >> 2, 5);
        if ((tr & 15) === 0 && (x & 3) === 1 && (z & 3) === 1) {
          const h = 4 + (tr >>> 8) % 3;
          for (let y = 0; y < h; y++) vox[col + WG_GY + 2 + y] = BK.TRUNK;
          t = WG_GY + 2 + h;
        }
      }
      top[i * 16 + j] = t > 0 ? t : 1;
    }
  }
  // leaves for the trees: a second pass, because a canopy reaches into neighbours
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    const ci = (i + 1) * 18 + (j + 1);
    if (kind[ci] !== WG_K.PARK) continue;
    const x = x0 + i, z = z0 + j;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const tx = x + dx, tz = z + dz;
      if ((tx & 3) !== 1 || (tz & 3) !== 1) continue;
      const tr = NZ_hash(tx >> 2, tz >> 2, 5);
      if ((tr & 15) !== 0) continue;
      if (WG_colInfo(tx, tz, o).kind !== WG_K.PARK) continue;      // no trunk, no canopy
      const h = 4 + (tr >>> 8) % 3;
      const col = (i * 16 + j) * WG_H, y0 = WG_GY + 2 + h - 2;
      for (let dy = 0; dy < 4; dy++) {
        const r = dy === 3 ? 1 : 2;
        if (Math.abs(dx) <= r && Math.abs(dz) <= r && !(Math.abs(dx) === 2 && Math.abs(dz) === 2) && vox[col + y0 + dy] === 0) {
          vox[col + y0 + dy] = BK.LEAVES;
          if (y0 + dy + 1 > top[i * 16 + j]) top[i * 16 + j] = y0 + dy + 1;
        }
      }
    }
  }
  // True heights, props and canopies included: the first free y above the highest
  // non-air voxel. Scanned from the voxels themselves so it can never disagree
  // with them. The mesher bounds its loops with it and the game uses it to find
  // the ground.
  let maxY = 0;
  for (let c = 0; c < 256; c++) {
    let y = H - 1; const col = c * H;
    while (y > 0 && vox[col + y] === 0) y--;
    top[c] = y + 1;
    if (y + 1 > maxY) maxY = y + 1;
  }
  return { vox: vox, top: top, maxY: maxY };
}

// ── light sources ─────────────────────────────────────────────────────────
// Every emitter that can matter to the region [x0,x1) x [z0,z1), computed from the
// same rules that place the things themselves:
//   [x, y, z, r, g, b, intensity, radius, kind, glow]
// kind 0 is a hooded street lamp (its glow in the air hangs downward), 1 shines all
// round; glow is the reach of its halo in the air (0: none, undefined: the default).
// A record with radius 0 lights nothing and only glows: it marks where a sign IS,
// while the record that lights the street stands clear of the sign's own voxels.
// No radius may exceed 17: the baker only looks that far from a vertex.
function WG_emitters(x0, z0, x1, z1) {
  const out = [];
  const y = WG_GY + 2 + 6 + 0.5;
  const r = 1.0, g = 0.66, b = 0.34;
  for (let strip = 0; strip < 2; strip++) {
    // strip 0: streets running along z (x-narrow); strip 1: along x
    const a0 = strip === 0 ? x0 : z0, a1 = strip === 0 ? x1 : z1;     // across axis
    const c0 = strip === 0 ? z0 : x0, c1 = strip === 0 ? z1 : x1;     // along axis
    for (let s = Math.floor(a0 / WG_PITCH) - 1; s <= Math.floor(a1 / WG_PITCH) + 1; s++) {
      for (let side = 0; side < 2; side++) {
        const across = s * WG_PITCH + (side === 0 ? 2 : 7) + 0.5;
        if (across < a0 - 20 || across > a1 + 20) continue;
        const phase = side === 0 ? 6 : 22;
        for (let q = Math.floor((c0 - 20 - phase) / 32); q <= Math.floor((c1 + 20 - phase) / 32); q++) {
          const along = q * 32 + phase + 0.5;
          const px = strip === 0 ? across : along, pz = strip === 0 ? along : across;
          // only if the lamp really stands on land and not inside a crossing street
          const lx = Math.floor(px), lz = Math.floor(pz);
          if (!WG_isLand(lx, lz) && !(lx >= 0 && lx < WG_ST && LM_bridgeTop(lx, lz))) continue;
          const other = strip === 0 ? NZ_mod(lz, WG_PITCH) : NZ_mod(lx, WG_PITCH);
          if (other < WG_ST + 1) continue;
          out.push([px, y, pz, r, g, b, 1.0, 17]);
        }
      }
    }
  }
  WG_signEmitters(x0, z0, x1, z1, out);
  LM_emitters(x0, z0, x1, z1, out);
  return out;
}

// Open shops, neon blades and billboards near a region, as light sources.
function WG_signEmitters(x0, z0, x1, z1, out) {
  const m = 15;
  const inR = function (x, z) { return x >= x0 - m && x < x1 + m && z >= z0 - m && z < z1 + m; };
  for (let bx = Math.floor((x0 - m) / WG_PITCH); bx <= Math.floor((x1 + m) / WG_PITCH); bx++) {
    for (let bz = Math.floor((z0 - m) / WG_PITCH); bz <= Math.floor((z1 + m) / WG_PITCH); bz++) {
      const info = WG_blockInfo(bx, bz);
      for (let i = 0; i < info.bld.length; i++) {
        const b = info.bld[i], st = WG_STY[b.st];
        if (b.x1 < x0 - m || b.x0 > x1 + m || b.z1 < z0 - m || b.z0 > z1 + m) continue;
        for (let s = 0; s < 4; s++) {
          const a0 = s < 2 ? b.z0 : b.x0, a1 = s < 2 ? b.z1 : b.x1;
          // the plane of this wall, and the way out of it
          const wc = s === 0 ? b.x0 : s === 1 ? b.x1 : s === 2 ? b.z0 : b.z1, dir = (s & 1) ? 1 : -1;
          if (st.store && !b.special) {
            const nc = WG_shopCells(st), n = nc * st.WP;
            for (let su = Math.floor((a0 + b.wo) / n); su <= Math.floor((a1 - 1 + b.wo) / n); su++) {
              const blk = WG_shop(b, s, su * nc, st);
              if (!blk) continue;
              const ac = Math.max(a0 + 1.5, Math.min(a1 - 1.5, (su + 0.5) * n - b.wo + 0.5));
              const px = s < 2 ? wc + dir * 1.6 : ac, pz = s < 2 ? ac : wc + dir * 1.6;
              if (!inR(px, pz)) continue;
              const c = blk === BK.SHOP_WARM ? [1.0, 0.72, 0.40] : blk === BK.SHOP_COOL ? [0.55, 0.78, 1.0] : blk === BK.SHOP_PINK ? [1.0, 0.36, 0.66] : [0.40, 1.0, 0.58];
              out.push([px, b.base + 2.4, pz, c[0], c[1], c[2], 0.55, 9, 1, 0]);
            }
          }
          const bd = WG_blade(b, s);
          if (bd) {
            // the light stands clear of the sign so the sign itself cannot shadow it; the glow
            // in the air belongs on the sign, so it is a second record with no reach
            const c = WG_SIGN_RGB[bd.k], ym = (bd.y0 + bd.y1) / 2;
            for (const k of [1.7, 0.5]) {
              const px = s < 2 ? wc + dir * k : bd.p + 0.5, pz = s < 2 ? bd.p + 0.5 : wc + dir * k;
              if (inR(px, pz)) out.push([px, ym, pz, c[0], c[1], c[2], 0.85, k > 1 ? 13 : 0, 1, k > 1 ? 0 : 6.5]);
            }
          }
        }
        const bb = WG_billboard(b);
        if (bb) {
          // one light each side of the panel, and its glow in the air on the panel itself
          const ac = bb.a0 + 6, y = b.base + b.h + 5;
          for (const k of [2.2, -2.2, 0]) {
            const cc = bb.c + 0.5 + k;
            const px = bb.ax ? cc : ac, pz = bb.ax ? ac : cc;
            if (inR(px, pz)) out.push([px, y, pz, 0.72, 0.80, 1.0, 0.8, k ? 15 : 0, 1, k ? 0 : 9]);
          }
        }
      }
    }
  }
}
