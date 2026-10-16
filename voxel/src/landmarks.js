// ═══════════════════════════════════════════════════════════════════════
//  LANDMARKS — the handful of places that are designed, not generated: the police
//  tower with the Bat-Signal, the suspension bridge, the two boss arenas, the
//  checkpoint beacons and one signature structure for each district.
//
//  They keep the property the rest of the world has: every one is a pure function
//  of (x, y, z). Which grid blocks they occupy is decided once, from the district
//  centres, by a search that does not depend on chunk order. Shared with the worker.
// ═══════════════════════════════════════════════════════════════════════

var LM = { ready: false, special: new Map(), beacons: [], arenas: [], gcpd: null, bridge: null };

function LM_key(bx, bz) { return bx + ',' + bz; }
function LM_origin(bx, bz) { return [bx * WG_PITCH + WG_ST, bz * WG_PITCH + WG_ST]; }

// Is the whole 38x38 lot dry land? (Independent of WG_blockInfo, which calls us.)
function LM_landFull(bx, bz) {
  const ox = bx * WG_PITCH + WG_ST, oz = bz * WG_PITCH + WG_ST, L = WG_PITCH - WG_ST;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!WG_isLand(ox + i * (L / 2), oz + j * (L / 2))) return false;
  return true;
}

// The free, fully-land block nearest to a point, preferring one in district `d`.
function LM_pick(x, z, d, taken) {
  const cbx = Math.round((x - 29) / WG_PITCH), cbz = Math.round((z - 29) / WG_PITCH);
  let best = null, bs = 1e9;
  for (let r = 0; r <= 7; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const bx = cbx + i, bz = cbz + j;
      if (taken.has(LM_key(bx, bz)) || !LM_landFull(bx, bz)) continue;
      const mx = bx * WG_PITCH + 29, mz = bz * WG_PITCH + 29;
      if (d !== null && WG_districtAt(mx, mz) !== d) continue;
      const s = Math.hypot(mx - x, mz - z);
      if (s < bs) { bs = s; best = [bx, bz]; }
    }
    if (best && r >= 2) break;
  }
  return best;
}

function LM_init() {
  if (LM.ready) return;
  LM.ready = true;
  const taken = new Set();
  const put = (bx, bz, o) => { o.bx = bx; o.bz = bz; LM.special.set(LM_key(bx, bz), o); taken.add(LM_key(bx, bz)); return o; };
  const D = WG_D;

  // the police tower, fixed beside the middle of the city
  const g = put(0, -1, { type: 'gcpd' });
  const o0 = LM_origin(0, -1);
  LM.gcpd = { bx: 0, bz: -1, cx: o0[0] + 19, cz: o0[1] + 19, roof: WG_BASE + 66 };
  // taller than the roof surface by one: the parapet is on the tier's edge, the floor is at +0
  LM.gcpd.y = LM.gcpd.roof;                  // first free y above the roof voxels

  // boss arenas
  const arena = (style, d, x, z) => {
    const p = LM_pick(x, z, d, taken);
    if (!p) return;
    const sp = put(p[0], p[1], { type: 'arena', style: style });
    const o = LM_origin(p[0], p[1]);
    LM.arenas.push({ style: style, bx: p[0], bz: p[1], cx: o[0] + 19, cz: o[1] + 19, ox: o[0], oz: o[1] });
  };
  arena('penguin', D.HIELO, 480, -360);
  arena('joker', D.CARNAVAL, -480, -330);

  // beacons: one per district, so the whole map can be reached again after a fall
  const beacon = (name, d, x, z) => {
    const p = LM_pick(x, z, d, taken);
    if (!p) return;
    put(p[0], p[1], { type: 'beacon', name: name });
    const o = LM_origin(p[0], p[1]);
    LM.beacons.push({ name: name, bx: p[0], bz: p[1], x: o[0] + 19 + 0.5, z: o[1] + 19 + 0.5, y: WG_GY + 2 });
  };
  // the roof of the police tower is beacon 0
  LM.beacons.push({ name: 'COMISARÍA', bx: 0, bz: -1, x: LM.gcpd.cx - 4.5, z: LM.gcpd.cz + 4.5, y: LM.gcpd.y });
  beacon('PUENTE DE GOTHAM', D.PUENTE, 30, 85);
  beacon('MUELLES', D.MUELLES, -460, 420);
  beacon('TORRE DE ARKHAM', D.ARKHAM, 80, -500);
  beacon('ALCANTARILLAS', D.ALCANT, 40, 420);
  beacon('FUNDICIÓN', D.FUNDI, 540, 360);
  beacon('MUELLE HELADO', D.HIELO, 560, -330);
  beacon('CARNAVAL', D.CARNAVAL, -480, -230);

  // one signature structure per district
  const lm = (type, d, x, z) => { const p = LM_pick(x, z, d, taken); if (p) put(p[0], p[1], { type: type }); };
  lm('ferris', D.CARNAVAL, -390, -330);
  lm('spire', D.ARKHAM, -20, -540);
  lm('crane', D.MUELLES, -460, 270);
  lm('foundry', D.FUNDI, 480, 420);
  lm('crane', D.MUELLES, -330, 270);

  // the bridge
  const cz = WG_channelZ(5), hw = WG_channelHW(5);
  LM.bridge = { x0: 0, x1: WG_ST, cz: cz, hw: hw, tz: hw - 10, ty: 78 };
  // spawn: on the roof, beside the signal
  LM.spawn = { x: LM.gcpd.cx - 4.5, y: LM.gcpd.y + 0.01, z: LM.gcpd.cz + 4.5, a: Math.atan2(1, -1) };
}

function LM_special(bx, bz) { LM_init(); return LM.special.get(LM_key(bx, bz)) || null; }

// ═══════════════════════════════════════════════════════════════════════
//  Blocks
// ═══════════════════════════════════════════════════════════════════════
// Rewrites a freshly made block `info` for a special block. `L` is the lot size.
function LM_block(sp, info, ox, oz, L) {
  info.special = sp.type;
  switch (sp.type) {
    case 'gcpd': {
      const s = NZ_hash(sp.bx, sp.bz, 7);
      // a stepped art-deco tower: the top tier is a 20 x 20 roof for the signal
      const b = WG_mk(ox + 2, oz + 2, ox + L - 2, oz + L - 2, 46, 2, s, { tiers: [[3, 50], [7, 66]] });
      b.special = 'gcpd'; b.props = [];
      info.kind = 'bld'; info.bld = [b]; info.d = WG_D.AZOTEAS;
      break;
    }
    case 'spire': {
      const s = NZ_hash(sp.bx, sp.bz, 8);
      info.kind = 'bld';
      info.bld = [WG_mk(ox + 9, oz + 9, ox + L - 9, oz + L - 9, 60, 4, s, { roof: 3, rh: 36 })];
      info.deco = 'spireBase';
      break;
    }
    case 'arena': info.kind = 'arena'; info.arena = sp.style; info.bld = []; break;
    case 'beacon': info.kind = 'plaza'; info.deco = 'beacon'; info.bld = []; break;
    case 'ferris': info.kind = 'plaza'; info.deco = 'ferris'; info.bld = []; break;
    case 'crane': info.kind = 'yard'; info.deco = 'crane'; info.bld = []; break;
    case 'foundry': info.kind = 'yard'; info.deco = 'foundry'; info.bld = []; break;
  }
  return info;
}

// Ordinary open lots get a fitting piece of dressing for their district.
function LM_decoFor(info) {
  if (info.deco) return;
  const D = WG_D;
  if (info.kind === 'yard') info.deco = info.d === D.FUNDI ? 'lavaYard' : 'containers';
  else if (info.kind === 'plaza') {
    if (info.d === D.HIELO) info.deco = 'ice';
    else if (info.d === D.CARNAVAL) info.deco = 'carnival';
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  The bridge
// ═══════════════════════════════════════════════════════════════════════
// Height of the first free y above the deck at column (x, z) if it is a bridge
// column (inside the channel, along the street at x 0..9), else 0.
function LM_bridgeTop(x, z) {
  if (x < 0 || x >= WG_ST) return 0;
  if (!WG_landRaw(x, z) || !WG_inChannel(x, z)) return 0;
  return (x < 2 || x > 7) ? WG_GY + 2 : WG_GY + 1;
}

// The tallest solid in a bridge column, for the light baker and the far city.
function LM_massTop(x, z) {
  const t = LM_bridgeTop(x, z);
  if (!t) return 0;
  const B = LM.bridge, dz = Math.abs(z - B.cz);
  if (dz >= B.tz - 1 && dz < B.tz + 1 && (x < 2 || x >= 8)) return B.ty + 1;
  if (dz >= B.tz - 1 && dz < B.tz + 1) return 74;
  return t;
}

function LM_cableY(dz) {                 // cable height above a point dz from the bridge centre
  const B = LM.bridge, a = Math.abs(dz);
  if (a <= B.tz) return 31 + (B.ty - 31) * (a / B.tz) * (a / B.tz);
  const side = 30;                       // the side span runs down to the road beyond the bank
  if (a <= B.tz + side) return B.ty - (B.ty - 30) * ((a - B.tz) / side);
  return -1;
}

// Writes the bridge's voxels into one column. Returns the first free y.
function LM_bridgeColumn(x, z, vox, col) {
  const B = LM.bridge, ux = x, dz = z - B.cz;
  const sidewalk = ux < 2 || ux > 7;
  // the deck: three slabs thick
  vox[col + WG_GY - 2] = BK.STEEL_DK;
  vox[col + WG_GY - 1] = BK.BRIDGE_DECK;
  vox[col + WG_GY] = sidewalk ? BK.SIDEWALK : BK.ASPHALT;
  if (sidewalk) vox[col + WG_GY + 1] = (ux === 1 || ux === 8) ? BK.CURB : BK.SIDEWALK;
  else {
    if (ux === 4 && NZ_mod(z, 6) < 3) vox[col + WG_GY] = BK.ROADLINE;
  }
  // piers under the deck, in the water
  const a = Math.abs(dz);
  const pierZ = [0, 22, -22, 66, -66];
  for (let i = 0; i < pierZ.length; i++) {
    if (Math.abs(dz - pierZ[i]) < 2 && ux >= 3 && ux < 7) { for (let y = 1; y < WG_GY - 2; y++) vox[col + y] = y === 1 ? BK.BEDROCK : BK.CONCRETE_DK; }
  }
  // towers: two legs each side and cross-beams
  if (a >= B.tz - 1 && a < B.tz + 1) {
    if (ux < 2 || ux >= 8) { for (let y = 2; y <= B.ty; y++) vox[col + y] = y > B.ty - 2 ? BK.STEEL : BK.STEEL_DK; vox[col + B.ty + 1] = BK.BEACON_RED; }
    else { for (let y = 50; y < 52; y++) vox[col + y] = BK.STEEL_DK; for (let y = 72; y < 74; y++) vox[col + y] = BK.STEEL_DK; for (let y = 61; y < 62; y++) vox[col + y] = BK.STEEL_DK; }
  }
  LM_cableColumn(x, z, vox, col);
}

// Cables and hangers live on the two outer lines of the road, x = 1 and x = 8.
function LM_cableColumn(x, z, vox, col) {
  if (x !== 1 && x !== 8) return;
  const B = LM.bridge, dz = z - B.cz, a = Math.abs(dz);
  const cy = LM_cableY(dz);
  if (cy < 0) return;
  const y = Math.round(cy);
  if (y < WG_H - 2) vox[col + y] = BK.CABLE;
  // steeper stretches need the neighbouring cell filled so the line has no gaps
  const cy2 = LM_cableY(dz + (dz >= 0 ? 1 : -1));
  if (cy2 >= 0) { const y2 = Math.round(cy2), lo = Math.min(y, y2), hi = Math.max(y, y2); for (let k = lo; k <= hi; k++) { if (Math.abs(k - y) <= Math.abs(k - y2)) vox[col + k] = BK.CABLE; } }
  // hangers: every fifth column, from the deck up to the cable (central span only)
  if (a < B.tz - 1 && NZ_mod(z, 5) === 0) { for (let k = WG_GY + 2; k < y; k++) if (!vox[col + k]) vox[col + k] = BK.CABLE; }
}

// ═══════════════════════════════════════════════════════════════════════
//  Decoration of open lots and arenas
// ═══════════════════════════════════════════════════════════════════════
// Floor override for a column (y = WG_GY and WG_GY + 1): returns [lower, upper] or null.
function LM_floor(info, x, z, ux, uz) {
  const lx = x - info.ox, lz = z - info.oz;
  if (info.kind === 'arena') {
    const d = Math.hypot(lx - 18.5, lz - 18.5);
    if (info.arena === 'penguin') {
      if (Math.abs(lx - 18.5) + Math.abs(lz - 18.5) < 4.2) return [BK.STONE, BK.NEON_CYAN];
      if (NZ_mod(Math.floor(d), 6) === 0) return [BK.STONE, BK.SNOW_ICE];
      return [BK.STONE, ((lx + lz) & 7) === 0 ? BK.FROZEN_WATER : BK.ICE];
    }
    // joker: a harlequin floor with a grin
    const checker = (((lx >> 2) + (lz >> 2)) & 1) ? BK.CARN_RED : BK.BLACK;
    if (d < 3.4) return [BK.STONE, BK.CARN_PURPLE];
    const dm = Math.hypot(lx - 18.5, lz - 15);
    if (lz > 20 && dm > 11 && dm < 13.2) return [BK.STONE, BK.NEON_GREEN];
    if (Math.hypot(lx - 11.5, lz - 12) < 2.2 || Math.hypot(lx - 25.5, lz - 12) < 2.2) return [BK.STONE, BK.NEON_YELLOW];
    return [BK.STONE, checker];
  }
  if (info.deco === 'beacon') {
    const dx = x - (info.ox + 19), dz = z - (info.oz + 19);
    if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4) return [BK.CONCRETE, BK.STEEL_DK];
  }
  if (info.deco === 'foundry') {
    const dx = x - (info.ox + 19), dz = z - (info.oz + 19);
    if (Math.abs(dx) <= 5 && Math.abs(dz) <= 5) return [BK.LAVA, BK.LAVA];
    if (Math.abs(dx) <= 6 && Math.abs(dz) <= 6) return [BK.HOT_METAL, BK.HOT_METAL];
  }
  if (info.deco === 'lavaYard') {
    const dx = lx - 12, dz = lz - 26;
    if (Math.abs(dx) <= 3 && Math.abs(dz) <= 3) return [BK.LAVA, BK.LAVA];
    if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4) return [BK.HOT_METAL, BK.HOT_METAL];
  }
  return null;
}

// Fills the voxels above the floor of a decorated lot into column `col` of `vox`.
function LM_column(info, x, z, vox, col) {
  const y0 = WG_GY + 2, lx = x - info.ox, lz = z - info.oz;
  const set = (dy, b) => { if (y0 + dy < WG_H - 1) vox[col + y0 + dy] = b; };
  const fill = (d0, d1, b) => { for (let d = d0; d <= d1; d++) set(d, b); };
  if (info.kind === 'arena') {
    const stripe = info.arena === 'joker';
    // low perimeter wall with an opening in the middle of each side
    const edge = Math.min(lx, lz, 37 - lx, 37 - lz);
    const along = (lx === 0 || lx === 1 || lx === 36 || lx === 37) ? lz : lx;
    if (edge <= 1 && Math.abs(along - 18.5) > 5.5) {
      fill(0, 1, stripe ? ((along >> 1) & 1 ? BK.CARN_PURPLE : BK.CARN_YELLOW) : BK.SNOW_ICE);
      if (edge === 0 && !stripe) set(2, BK.SNOW);
    }
    // four corner pillars
    const pc = (v) => (v >= 3 && v <= 5) ? 0 : ((v >= 32 && v <= 34) ? 1 : -1);
    if (pc(lx) >= 0 && pc(lz) >= 0) {
      if (stripe) { for (let d = 0; d <= 12; d++) set(d, (d >> 1) & 1 ? BK.CARN_WHITE : BK.CARN_RED); fill(13, 13, BK.NEON_PINK); }
      else { fill(0, 11, BK.ICE); fill(12, 12, BK.NEON_CYAN); }
    }
    // a string of lights between the pillars of the same side
    if (stripe) {
      const onLineX = (lx === 4 || lx === 33), onLineZ = (lz === 4 || lz === 33);
      const t = onLineX ? (lz - 5) / 28 : (lx - 5) / 28;
      if ((onLineX && lz > 5 && lz < 33) || (onLineZ && lx > 5 && lx < 33)) {
        const sag = Math.round(2.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))));
        const p = onLineX ? lz : lx;
        set(11 - sag, p % 3 === 0 ? BK.NEON_YELLOW : BK.CABLE);
      }
    } else {
      // ice spikes standing in the corners of the rink, outside the fighting space
      const sx = lx < 19 ? lx : 37 - lx, sz = lz < 19 ? lz : 37 - lz;
      if ((sx === 9 || sx === 10) && (sz === 9 || sz === 10) && ((x * 7 + z * 13) & 3) !== 0) {
        const h = 3 + (NZ_hash(x >> 1, z >> 1, 31) % 4);
        fill(0, h, BK.ICE);
      }
    }
    return;
  }
  const cx = info.ox + 19, cz = info.oz + 19, dx = x - cx, dz = z - cz;
  switch (info.deco) {
    case 'beacon': {
      const ad = Math.max(Math.abs(dx), Math.abs(dz));
      if (ad <= 4) {
        set(0, ((dx + dz) & 1) && ad >= 4 ? BK.HAZ_Y : (ad >= 4 ? BK.HAZ_K : BK.STEEL_DK));
        if (ad <= 1) {
          fill(1, 9, BK.STEEL_DK);
          if (ad <= 1 && !(dx === 0 && dz === 0)) { fill(4, 5, BK.SIGNAL); }
          if (dx === 0 && dz === 0) fill(4, 5, BK.STEEL);
          fill(10, 10, BK.STEEL);
        }
      }
      if (Math.abs(dx) === 4 && Math.abs(dz) === 4) { fill(1, 3, BK.LAMP_POLE); fill(4, 4, BK.LAMP_LIGHT); }
      break;
    }
    case 'ferris': {
      const hubY = 22, R = 17, ay = hubY + (y0 - 1) * 0;   // hub height above y0
      for (let dy = 0; dy < 44; dy++) {
        const yy = dy - hubY, zz = dz, r = Math.hypot(yy, zz);
        const ax = Math.abs(dx);
        // two rims, one each side of the axle
        if (ax === 2 && Math.abs(r - R) < 0.85) {
          const sector = Math.floor((Math.atan2(zz, yy) + Math.PI) / (Math.PI / 12));
          set(dy, sector & 1 ? BK.NEON_PINK : BK.NEON_CYAN);
          continue;
        }
        // spokes
        if ((ax === 2 || ax === 0) && r < R && r > 1) {
          const ang = Math.atan2(zz, yy);
          for (let k = 0; k < 12; k++) {
            const d = Math.abs(Math.sin(ang - k * Math.PI / 6)) * r;
            if (d < 0.62 && Math.cos(ang - k * Math.PI / 6) > 0) { set(dy, ax === 0 ? BK.STEEL : BK.STEEL_DK); break; }
          }
        }
        // the axle
        if (ax <= 3 && r < 1.8 && dz * dz + yy * yy < 3.3) set(dy, BK.STEEL);
        // gondolas hang below the rim at every other 15 degrees, kept level
        for (let k = 0; k < 12; k++) {
          const th = (k + 0.5) * Math.PI / 6;
          const gy = hubY + Math.cos(th) * R - 4, gz = Math.sin(th) * R;
          if (ax <= 2 && dy >= gy - 1 && dy <= gy + 1 && Math.abs(zz - gz) <= 1.5) set(dy, [BK.CARN_RED, BK.CARN_YELLOW, BK.CARN_TEAL, BK.CARN_PURPLE][k & 3]);
          if (ax === 2 && dy > gy + 1 && dy <= gy + 3 && Math.abs(zz - gz) <= 0.7) set(dy, BK.CABLE);
        }
      }
      // two A-frames
      for (const sx of [-3, 3]) if (dx === sx || dx === sx + (sx > 0 ? 1 : -1)) {
        for (let dy = 0; dy <= hubY; dy++) {
          const zc = 15 * (1 - dy / hubY);
          if (Math.abs(Math.abs(dz) - zc) < 0.9) set(dy, BK.CARN_WHITE);
        }
      }
      break;
    }
    case 'crane': {
      const a = Math.abs(lx - 6) <= 1 || Math.abs(lx - 31) <= 1;
      const legZ = (Math.abs(lz - 6) <= 1 || Math.abs(lz - 31) <= 1);
      if (a && legZ) fill(0, 30, BK.CRANE);
      // a gantry beam along x on top of the legs, and a hanging container
      if ((lz === 6 || lz === 31 || lz === 5 || lz === 32) && lx >= 5 && lx <= 32) fill(30, 31, BK.CRANE);
      if (lx >= 5 && lx <= 32 && lz >= 5 && lz <= 32 && ((lx + lz) & 3) === 0 && (lz <= 6 || lz >= 31)) set(32, BK.HAZ_Y);
      if (lx >= 14 && lx <= 25 && lz >= 17 && lz <= 20) {
        fill(10, 12, ((lx + lz) & 7) === 0 ? BK.CONT_GREY : BK.CONT_RED);
        if ((lx === 14 || lx === 25) && (lz === 17 || lz === 20)) fill(13, 29, BK.CABLE);
      }
      if (lz >= 17 && lz <= 20 && lx >= 5 && lx <= 32) { fill(30, 30, BK.CRANE); }
      LM_containers(info, x, z, vox, col, true);
      break;
    }
    case 'foundry': {
      // four stacks in the corners and a catwalk ring around the pool
      const sx = lx < 19 ? lx : 37 - lx, sz = lz < 19 ? lz : 37 - lz;
      if (sx >= 3 && sx <= 6 && sz >= 3 && sz <= 6) {
        const wall = (sx === 3 || sx === 6 || sz === 3 || sz === 6);
        for (let d = 0; d < 46; d++) {
          if (!wall && d > 0 && d < 40) continue;
          set(d, d > 41 ? ((d >> 1) & 1 ? BK.HAZ_Y : BK.HAZ_K) : (d < 3 ? BK.FURNACE : BK.BRICK_DK));
        }
        if (!wall) { set(0, BK.HOT_METAL); }
      }
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 7 && !((dx & 3) === 0 && (dz & 3) === 0)) { set(0, BK.STEEL_DK); }
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 7 && (dx & 3) === 0 && (dz & 3) === 0) fill(0, 3, BK.STEEL_DK);
      break;
    }
    case 'lavaYard': {
      const sx = lx - 28, sz = lz - 8;
      if (Math.abs(sx) <= 2 && Math.abs(sz) <= 2) {
        const wall = Math.abs(sx) === 2 || Math.abs(sz) === 2;
        for (let d = 0; d < 26; d++) { if (!wall && d > 0 && d < 22) continue; set(d, d > 22 ? ((d >> 1) & 1 ? BK.HAZ_Y : BK.HAZ_K) : BK.BRICK_DK); }
      }
      LM_containers(info, x, z, vox, col, false);
      break;
    }
    case 'containers': LM_containers(info, x, z, vox, col, false); break;
    case 'ice': {
      // frozen crystals: a hash picks which cells grow one, and how tall
      const gx = x >> 3, gz = z >> 3, h = NZ_hash(gx, gz, 61);
      if ((h & 3) === 0 && Math.abs(lx - 19) + Math.abs(lz - 19) > 6) {
        const px = (gx << 3) + 3 + (h >>> 4) % 3, pz = (gz << 3) + 3 + (h >>> 8) % 3;
        const H = 4 + (h >>> 12) % 6;
        const d = Math.max(Math.abs(x - px), Math.abs(z - pz));
        for (let k = 0; k < H; k++) if (d <= Math.floor((H - k) / 3)) set(k, k > H - 2 ? BK.SNOW_ICE : BK.ICE);
      }
      break;
    }
    case 'carnival': {
      // striped poles with a lit knob on top, on a grid, and a few balloon clusters
      if (((x - info.ox) % 12 === 6) && ((z - info.oz) % 12 === 6)) {
        const k = NZ_hash(x, z, 71) % 4;
        for (let d = 0; d < 7; d++) set(d, (d >> 1) & 1 ? BK.CARN_WHITE : [BK.CARN_RED, BK.CARN_YELLOW, BK.CARN_TEAL, BK.CARN_PURPLE][k]);
        set(7, [BK.NEON_PINK, BK.NEON_YELLOW, BK.NEON_CYAN, BK.NEON_PURPLE][k]);
      }
      break;
    }
    case 'spireBase': break;
  }
}

// Shipping containers stacked in a regular grid, 12 x 3 x 3 each.
function LM_containers(info, x, z, vox, col, sparse) {
  const y0 = WG_GY + 2, lx = x - info.ox, lz = z - info.oz;
  // cells of 14 x 7; the long axis alternates per yard
  const alongX = (NZ_hash(info.bx, info.bz, 91) & 1) === 0;
  const a = alongX ? lx : lz, b = alongX ? lz : lx;
  const cA = Math.floor((a - 1) / 14), cB = Math.floor((b - 1) / 7);
  if (a < 1 || b < 1 || cA < 0 || cB < 0 || cA > 2 || cB > 4) return;
  const ia = (a - 1) - cA * 14, ib = (b - 1) - cB * 7;
  if (ia > 11 || ib > 2) return;                                   // the aisle between cells
  const h = NZ_hash(info.bx * 8 + cA, info.bz * 8 + cB, 97);
  if ((h & 255) / 255 > (sparse ? 0.34 : 0.62)) return;
  const stack = 1 + ((h >>> 8) % 3);
  // keep the middle of the yard clear around a crane's load
  if (sparse && (lx < 9 || lx > 28 || lz < 9 || lz > 28 || (Math.abs(lx - 19) < 9 && Math.abs(lz - 19) < 5))) return;
  const cols = [BK.CONT_RED, BK.CONT_BLUE, BK.CONT_GREEN, BK.CONT_ORANGE, BK.CONT_GREY];
  const base = cols[(h >>> 12) % 5];
  for (let s = 0; s < stack; s++) {
    const c = cols[((h >>> 12) + s * 3) % 5];
    for (let d = 0; d < 3; d++) {
      const rib = (ia & 1) ? c : c;
      let blk = c;
      if (d === 0 || d === 2 || ia === 0 || ia === 11 || ib === 0 || ib === 2) blk = c;
      if ((ia === 0 || ia === 11) && ib === 1) blk = BK.CONT_GREY;           // doors
      if (ia > 0 && ia < 11 && ((ia + s) & 1) === 0 && d === 1) blk = base === c ? BK.CONT_GREY : c;
      vox[col + y0 + s * 3 + d] = blk;
    }
  }
}

// ── glue the worldgen calls ───────────────────────────────────────────────
// Applies a lot's floor override and decoration to the column at (x, z).
function LM_lot(x, z, vox, col) {
  const bx = Math.floor(x / WG_PITCH), bz = Math.floor(z / WG_PITCH);
  const info = WG_blockInfo(bx, bz);
  if (!info.deco && info.kind !== 'arena') return;
  const f = LM_floor(info, x, z, NZ_mod(x, WG_PITCH), NZ_mod(z, WG_PITCH));
  if (f) { vox[col + WG_GY] = f[0]; vox[col + WG_GY + 1] = f[1]; }
  LM_column(info, x, z, vox, col);
}

// The Bat-Signal on the police roof: a pedestal, a lamp housing, a glowing lens,
// and a hazard ring painted on the roof around it. T is the first free y above the roof.
function LM_gcpdColumn(x, z, vox, col, T) {
  if (T !== LM.gcpd.roof) return;                       // only the top tier
  const dx = x - LM.gcpd.cx, dz = z - LM.gcpd.cz, r = Math.hypot(dx + 0.5, dz + 0.5);
  if (r > 4.7 && r < 5.9) vox[col + T - 1] = ((Math.floor(Math.atan2(dz, dx) / 0.5236)) & 1) ? BK.HAZ_Y : BK.HAZ_K;
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax <= 2 && az <= 2) {
    vox[col + T] = BK.STEEL_DK; vox[col + T + 1] = BK.STEEL_DK;                    // plinth
    if (ax <= 1 && az <= 1) { vox[col + T + 2] = BK.STEEL; vox[col + T + 3] = BK.STEEL; }   // stem
    // the lamp: an inner glowing lens inside a rim, so it reads as a searchlight from above
    if (ax <= 1 && az <= 1) vox[col + T + 4] = BK.SIGNAL;
    else vox[col + T + 4] = BK.STEEL;
    if (ax === 2 || az === 2) vox[col + T + 5] = BK.STEEL_DK;
  }
}

LM_init();
var WG_SPAWN = LM.spawn;
