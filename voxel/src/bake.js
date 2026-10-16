// ═══════════════════════════════════════════════════════════════════════
//  BAKE — turns a chunk of voxels into a lit mesh. Shared with the worker.
//
//  All lighting is computed here, once, and stored in the vertices, so drawing a
//  frame is just "rasterise some triangles". That is what makes a dense night
//  city affordable on a phone. The light model, in the order it is applied:
//
//   SKY       Open sky is estimated per CELL from the height of the surrounding
//             mass: for each of eight directions the tallest thing at a handful of
//             distances gives a horizon angle, and a surface under a horizon at
//             elevation e sees cos^2(e) of the sky. An alley between towers is
//             dark, a rooftop is bright, and nothing was ray-marched to find out.
//   MOON      A fixed moon, so shadows can be baked. Per COLUMN a single "shadow
//             ceiling" is found (anything below it is in shade), so each vertex
//             asks one number instead of marching a ray.
//   LAMPS     Per VERTEX, because they need the surface normal: the few nearest
//             emitters, each ray-marched through the real voxels so a lamp does
//             not light the far side of a wall.
//   AO        The classic per-corner voxel occlusion, multiplied in last.
//
//  Vertex layout, 16 bytes:
//    0  x y z .        position inside the chunk (0..16, 0..128)
//    4  block face ao flags
//    8  r g b emit     albedo, and how hard the voxel glows (emit/255*4)
//   12  sky bR bG bB   baked sky light, and baked lamp light (value/255*2)
// ═══════════════════════════════════════════════════════════════════════

var BX_H = WG_H;
var BX_SHADOW_STEPS = 96;

// The moon: a direction towards it, and the horizontal part used for shadows.
var BX_MOON = (function () {
  const az = 0.62, el = 0.74;
  const ce = Math.cos(el);
  return { x: ce * Math.sin(az), y: Math.sin(el), z: ce * Math.cos(az), hx: Math.sin(az), hz: Math.cos(az), tanE: Math.tan(el) };
})();

// Distances at which the horizon is sampled in each of eight directions.
var BX_HD = [1.5, 3, 5, 8, 12, 18, 26, 36];
var BX_HDIR = (function () {
  const a = [];
  for (let i = 0; i < 8; i++) a.push([Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  return a;
})();

// Cube faces. Corner order is counter-clockwise seen from outside; the winding
// is checked in the tests rather than trusted.
var BX_FACE = (function () {
  const corners = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],   // +x
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],   // -x
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],   // +y
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],   // -y
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],   // +z
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],   // -z
  ];
  const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const out = [];
  for (let f = 0; f < 6; f++) {
    const n = normals[f];
    const a = n[0] ? 0 : (n[1] ? 1 : 2);
    const t1 = a === 0 ? 1 : 0, t2 = a === 2 ? 1 : 2;
    const verts = [];
    for (let c = 0; c < 4; c++) {
      const p = corners[f][c];
      const d1 = p[t1] ? 1 : -1, d2 = p[t2] ? 1 : -1;
      const e1 = [0, 0, 0], e2 = [0, 0, 0];
      e1[t1] = d1; e2[t2] = d2;
      verts.push({ p: p, e1: e1, e2: e2 });
    }
    out.push({ n: n, verts: verts });
  }
  return out;
})();

// How much ambient each face direction collects, so adjacent walls differ.
var BX_HEMI = [0.70, 0.70, 1.0, 0.34, 0.80, 0.58];
var BX_AOF = [0.50, 0.70, 0.86, 1.0];

var BX_AMB = 0.36;       // ambient from an unobstructed sky
var BX_MOONK = 0.62;     // direct moonlight on a surface facing it

// ── reusable scratch, so a worker does not reallocate per chunk ───────────
var BX_cAmb = new Float32Array(324 * BX_H);
var BX_cMoon = new Float32Array(324 * BX_H);
var BX_cDone = new Uint8Array(324 * BX_H);
var BX_S = new Float32Array(324);
var BX_HB = new Uint8Array(324 * 64);
var BX_reg = new Uint8Array(48 * 48 * BX_H);

function BX_mesh() {
  return { v: new Uint8Array(16 * 8192), nv: 0, i: new Uint32Array(6 * 8192), ni: 0 };
}
function BX_ensure(m, addV) {
  if ((m.nv + addV) * 16 > m.v.length) {
    const nvv = new Uint8Array(Math.max(m.v.length * 2, (m.nv + addV) * 16)); nvv.set(m.v); m.v = nvv;
  }
  const addI = (addV >> 2) * 6;
  if (m.ni + addI > m.i.length) {
    const ni = new Uint32Array(Math.max(m.i.length * 2, m.ni + addI)); ni.set(m.i); m.i = ni;
  }
}

// Is anything opaque between two points (region-local floats)? The end cell, which
// holds the emitter itself, never blocks.
function BX_blocked(reg, ax, ay, az, bx, by, bz) {
  let ix = Math.floor(ax), iy = Math.floor(ay), iz = Math.floor(az);
  const ex = Math.floor(bx), ey = Math.floor(by), ez = Math.floor(bz);
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tDx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tDy = dy !== 0 ? Math.abs(1 / dy) : 1e30, tDz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
  let tx = dx > 0 ? (ix + 1 - ax) * tDx : (ax - ix) * tDx;
  let ty = dy > 0 ? (iy + 1 - ay) * tDy : (ay - iy) * tDy;
  let tz = dz > 0 ? (iz + 1 - az) * tDz : (az - iz) * tDz;
  for (let n = 0; n < 40; n++) {
    if (tx < ty) { if (tx < tz) { ix += sx; tx += tDx; } else { iz += sz; tz += tDz; } }
    else { if (ty < tz) { iy += sy; ty += tDy; } else { iz += sz; tz += tDz; } }
    if (ix === ex && iy === ey && iz === ez) return false;
    if (ix < 0 || ix >= 48 || iz < 0 || iz >= 48 || iy < 0 || iy >= BX_H) return false;
    if (BK_OPAQUE[reg[(ix * 48 + iz) * BX_H + iy]]) return true;
  }
  return false;
}

// One chunk, as a resumable job. `env` supplies getVox(cx, cz) -> the 16x16xH block
// array of a chunk and getMass(cx, cz) -> its 256 mass heights. The generator yields
// regularly so the main thread can run it a few milliseconds per frame when no
// worker is available; in a worker it is simply driven to the end.
function* BX_bake(cx, cz, env) {
  const H = BX_H;
  const reg = BX_reg;
  const ox = cx * 16, oz = cz * 16;

  // 1. the 3x3 neighbourhood as one array, so face culling, AO and lamp rays can
  //    read across chunk edges without any lookups
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const v = env.getVox(cx + dx, cz + dz);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      reg.set(v.subarray((i * 16 + j) * H, (i * 16 + j + 1) * H), (((dx + 1) * 16 + i) * 48 + (dz + 1) * 16 + j) * H);
    }
  }
  yield 0;
  const vox = env.getVox(cx, cz);
  const gen = env.getGen(cx, cz);
  const maxY = Math.min(H - 2, gen.maxY + 1);

  // mass height at a world column
  const massCache = new Map();
  function mass(x, z) {
    const mcx = x >> 4, mcz = z >> 4, key = mcx * 65536 + mcz;
    let m = massCache.get(key);
    if (!m) { m = env.getMass(mcx, mcz); massCache.set(key, m); }
    return m[(x & 15) * 16 + (z & 15)];
  }

  // 2. per-column terms for the chunk and a one-column margin
  const S = BX_S, HB = BX_HB;
  const mhx = BX_MOON.hx, mhz = BX_MOON.hz, tanE = BX_MOON.tanE;
  for (let i = 0; i < 18; i++) for (let j = 0; j < 18; j++) {
    const x = ox + i - 1, z = oz + j - 1, col = i * 18 + j;
    // moon shadow ceiling: the highest point of this column that is in shade
    let best = -1e9;
    for (let s = 1; s <= BX_SHADOW_STEPS; s += (s < 40 ? 1 : 2)) {
      const h = mass(Math.floor(x + 0.5 + mhx * s), Math.floor(z + 0.5 + mhz * s)) - s * tanE;
      if (h > best) best = h;
    }
    S[col] = best;
    // horizon heights
    for (let d = 0; d < 8; d++) for (let q = 0; q < 8; q++) {
      HB[col * 64 + d * 8 + q] = mass(Math.floor(x + 0.5 + BX_HDIR[d][0] * BX_HD[q]), Math.floor(z + 0.5 + BX_HDIR[d][1] * BX_HD[q]));
    }
  }
  BX_cDone.fill(0);
  yield 0;

  // lamps in range, bucketed by 8 so a vertex finds its neighbours without a scan
  const lampsRaw = WG_emitters(ox - 24, oz - 24, ox + 40, oz + 40);
  const buckets = new Array(64);
  for (let i = 0; i < 64; i++) buckets[i] = [];
  for (let i = 0; i < lampsRaw.length; i++) {
    const e = lampsRaw[i];
    const lx = e[0] - ox, lz = e[2] - oz;
    const bi = (lx + 24) >> 3, bj = (lz + 24) >> 3;
    if (bi >= 0 && bi < 8 && bj >= 0 && bj < 8) buckets[bi * 8 + bj].push([lx, e[1], lz, e[3], e[4], e[5], e[6], e[7]]);
  }

  // cell light: ambient sky and moon visibility, memoised per cell
  const cAmb = BX_cAmb, cMoon = BX_cMoon, cDone = BX_cDone;
  function cell(x, y, z) {           // chunk-local x,z in [-1,16]
    const col = (x + 1) * 18 + (z + 1), idx = col * H + y;
    if (cDone[idx]) return idx;
    const yc = y + 0.5;
    let sum = 0;
    for (let d = 0; d < 8; d++) {
      let t = 0;
      for (let q = 0; q < 8; q++) {
        const tt = (HB[col * 64 + d * 8 + q] - yc) / BX_HD[q];
        if (tt > t) t = tt;
      }
      sum += 1 / (1 + t * t);
    }
    // overhead cover: something solid right above kills the sky
    let cover = 1;
    const ri = (((x + 16) * 48) + (z + 16)) * H + y;
    for (let k = 1; k <= 8 && y + k < H; k++) {
      if (BK_OPAQUE[reg[ri + k]]) { cover = 0.12 + 0.88 * (k - 1) / 8; break; }
    }
    cAmb[idx] = (sum / 8) * cover;
    const sc = S[col];
    const u = NZ_clamp((yc - (sc - 0.5)) / 2, 0, 1);
    cMoon[idx] = u * u * (3 - 2 * u) * Math.min(1, cover * 1.6);
    cDone[idx] = 1;
    return idx;
  }

  const op = BX_mesh(), wa = BX_mesh();
  const aoV = [0, 0, 0, 0], skyV = [0, 0, 0, 0], blR = [0, 0, 0, 0], blG = [0, 0, 0, 0], blB = [0, 0, 0, 0];
  const R1 = 48 * H, R2 = H;           // region strides for x and z

  // 3. mesh
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const base = (x * 16 + z) * H;
      const rb = (((x + 16) * 48) + (z + 16)) * H;
      for (let y = 1; y <= maxY; y++) {
        const b = vox[base + y];
        if (b === 0) continue;
        const isWater = (BK_FLAGS[b] & BK_FL_TRANS) !== 0;
        for (let f = 0; f < 6; f++) {
          const F = BX_FACE[f], n = F.n;
          const nb = reg[rb + y + n[1] + n[0] * R1 + n[2] * R2];
          if (isWater) { if (f !== 2 || nb !== 0) continue; }
          else if (BK_OPAQUE[nb]) continue;
          const mesh = isWater ? wa : op;
          BX_ensure(mesh, 4);
          const fx = x + n[0], fy = y + n[1], fz = z + n[2];
          // the four cells of the layer in front of the face that every vertex averages
          for (let c = 0; c < 4; c++) {
            const V = F.verts[c];
            const sx1 = fx + V.e1[0], sy1 = fy + V.e1[1], sz1 = fz + V.e1[2];
            const sx2 = fx + V.e2[0], sy2 = fy + V.e2[1], sz2 = fz + V.e2[2];
            const cx3 = sx1 + V.e2[0], cy3 = sy1 + V.e2[1], cz3 = sz1 + V.e2[2];
            const o0 = BK_OPAQUE[reg[(((fx + 16) * 48) + (fz + 16)) * H + fy]];
            const o1 = BK_OPAQUE[reg[(((sx1 + 16) * 48) + (sz1 + 16)) * H + sy1]];
            const o2 = BK_OPAQUE[reg[(((sx2 + 16) * 48) + (sz2 + 16)) * H + sy2]];
            const o3 = BK_OPAQUE[reg[(((cx3 + 16) * 48) + (cz3 + 16)) * H + cy3]];
            aoV[c] = (o1 && o2) ? 0 : 3 - (o1 + o2 + o3);
            // smooth light: average the open cells among the four
            let a = 0, m = 0, k = 0;
            if (!o0) { const i0 = cell(fx, fy, fz); a += cAmb[i0]; m += cMoon[i0]; k++; }
            if (!o1) { const i1 = cell(sx1, sy1, sz1); a += cAmb[i1]; m += cMoon[i1]; k++; }
            if (!o2) { const i2 = cell(sx2, sy2, sz2); a += cAmb[i2]; m += cMoon[i2]; k++; }
            if (!o3 && !(o1 && o2)) { const i3 = cell(cx3, cy3, cz3); a += cAmb[i3]; m += cMoon[i3]; k++; }
            if (k === 0) { const i0 = cell(fx, fy, fz); a = cAmb[i0]; m = cMoon[i0]; k = 1; }
            a /= k; m /= k;
            const ndl = n[0] * BX_MOON.x + n[1] * BX_MOON.y + n[2] * BX_MOON.z;
            let sky = BX_AMB * BX_HEMI[f] * a + BX_MOONK * (ndl > 0 ? ndl : 0) * m;
            // lamps, ray-marched through the real voxels
            let lr = 0, lg = 0, lb = 0;
            if (!isWater) {
              const px = x + V.p[0], py = y + V.p[1], pz = z + V.p[2];
              const bi = (Math.floor(px) + 24) >> 3, bj = (Math.floor(pz) + 24) >> 3;
              // +-2 buckets of 8: the farthest covered point is never closer than 16, so
              // a lamp of radius 17 is found from anywhere in the chunk. With +-1 it was
              // only seen from 8-16 blocks, and the light would have been cut differently
              // in every chunk.
              for (let ii = bi - 2; ii <= bi + 2; ii++) for (let jj = bj - 2; jj <= bj + 2; jj++) {
                if (ii < 0 || ii > 7 || jj < 0 || jj > 7) continue;
                const bk = buckets[ii * 8 + jj];
                for (let q = 0; q < bk.length; q++) {
                  const e = bk[q];
                  const ddx = e[0] - px, ddy = e[1] - py, ddz = e[2] - pz;
                  const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                  const R = e[7];
                  if (d2 >= R * R) continue;
                  const d = Math.sqrt(d2) + 1e-4;
                  const nd = (n[0] * ddx + n[1] * ddy + n[2] * ddz) / d;
                  if (nd <= 0.02) continue;
                  const fall = 1 - d / R;
                  const str = e[6] * fall * fall * nd;
                  if (str < 0.015) continue;
                  if (BX_blocked(reg, px + 16 + n[0] * 0.03, py + n[1] * 0.03, pz + 16 + n[2] * 0.03, e[0] + 16, e[1], e[2] + 16)) continue;
                  lr += e[3] * str; lg += e[4] * str; lb += e[5] * str;
                }
              }
            }
            const aoF = BX_AOF[aoV[c]];
            skyV[c] = sky * aoF;
            const al = 0.55 + 0.45 * aoF;
            blR[c] = lr * al; blG[c] = lg * al; blB[c] = lb * al;
          }
          // write the four vertices
          const albR = BK_RGB[b * 3], albG = BK_RGB[b * 3 + 1], albB = BK_RGB[b * 3 + 2];
          const vr = 0.93 + 0.14 * NZ_f(ox + x, y, oz + z);
          const cr = Math.min(255, albR * vr), cg = Math.min(255, albG * vr), cb = Math.min(255, albB * vr);
          const em = Math.min(255, Math.round(BK_EMIT[b] / 4 * 255));
          const fl = BK_FLAGS[b];
          const v0 = mesh.nv;
          for (let c = 0; c < 4; c++) {
            const V = F.verts[c], o = (v0 + c) * 16, d = mesh.v;
            d[o] = x + V.p[0]; d[o + 1] = y + V.p[1]; d[o + 2] = z + V.p[2]; d[o + 3] = 0;
            d[o + 4] = b; d[o + 5] = f; d[o + 6] = aoV[c]; d[o + 7] = fl;
            d[o + 8] = cr; d[o + 9] = cg; d[o + 10] = cb; d[o + 11] = em;
            d[o + 12] = Math.min(255, skyV[c] * 255);
            d[o + 13] = Math.min(255, blR[c] * 127.5); d[o + 14] = Math.min(255, blG[c] * 127.5); d[o + 15] = Math.min(255, blB[c] * 127.5);
          }
          const I = mesh.i, ni = mesh.ni;
          // split the quad along the diagonal that hides the AO seam
          if (aoV[0] + aoV[2] >= aoV[1] + aoV[3]) {
            I[ni] = v0; I[ni + 1] = v0 + 1; I[ni + 2] = v0 + 2; I[ni + 3] = v0; I[ni + 4] = v0 + 2; I[ni + 5] = v0 + 3;
          } else {
            I[ni] = v0 + 1; I[ni + 1] = v0 + 2; I[ni + 2] = v0 + 3; I[ni + 3] = v0 + 1; I[ni + 4] = v0 + 3; I[ni + 5] = v0;
          }
          mesh.nv += 4; mesh.ni += 6;
        }
      }
    }
    if ((x & 3) === 3) yield 0;
  }

  function pack(m) {
    const idx = m.nv < 65536 ? new Uint16Array(m.i.subarray(0, m.ni)) : m.i.slice(0, m.ni);
    return { v: m.v.slice(0, m.nv * 16), i: idx, nv: m.nv, ni: m.ni, wide: m.nv >= 65536 };
  }
  // lamps that belong to THIS chunk, in world coordinates, for the main thread
  const own = [];
  for (let i = 0; i < lampsRaw.length; i++) {
    const e = lampsRaw[i];
    if (e[0] >= ox && e[0] < ox + 16 && e[2] >= oz && e[2] < oz + 16) own.push(e);
  }
  return { opaque: pack(op), water: pack(wa), emitters: own, maxY: gen.maxY };
}
