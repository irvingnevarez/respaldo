// ═══════════════════════════════════════════════════════════════════════
//  FAR — the distant city, at low resolution.
//
//  The detailed chunks stop at about 120 blocks. From street level that is fine:
//  the fog has long since taken everything. From a rooftop, or gliding, the
//  horizon is hundreds of blocks away, and without something out there the city
//  simply ends in a visible edge, a floating island. This builds the rest, as
//  4x4-block columns taken from the same mass heights the baker uses for shadows,
//  so it is the SAME city: the towers are where the towers are, as tall as they
//  are, with rows of lit windows picked by hash.
//
//  It costs almost nothing. A chunk's mass is about sixty microseconds and a tile
//  of sixteen chunks meshes in a couple of milliseconds, so the whole horizon is
//  built in well under a second without a worker. Tiles are 64 blocks square to
//  keep the draw-call count down; the shader discards the part of a tile that lies
//  inside the detailed chunks, so the two never fight.
// ═══════════════════════════════════════════════════════════════════════

var FR_T = 64;     // tile size in blocks
var FR_CELL = 4;   // column size in blocks
var FR_N = FR_T / FR_CELL;       // 16 columns across a tile

class VxFar {
  constructor(gl, range) {
    this.gl = gl;
    this.range = range || 416;
    this.tiles = new Map();
    this.need = [];
    this.centerKey = null;
    this.stats = { built: 0, ms: 0, drawn: 0 };
  }

  update(px, pz, budgetMs) {
    const tx = Math.floor(px / FR_T), tz = Math.floor(pz / FR_T);
    const key = tx * 100000 + tz;
    if (key !== this.centerKey) {
      this.centerKey = key;
      const R = Math.ceil(this.range / FR_T) + 1, list = [];
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        const d = Math.hypot(dx, dz) * FR_T;
        if (d > this.range + FR_T) continue;
        const k = (tx + dx) * 100000 + (tz + dz);
        if (!this.tiles.has(k)) list.push({ tx: tx + dx, tz: tz + dz, d: d, k: k });
      }
      list.sort((a, b) => a.d - b.d);
      this.need = list;
      // let go of tiles that have drifted well out of range
      for (const [k, t] of this.tiles) {
        if (Math.hypot((t.tx - tx) * FR_T, (t.tz - tz) * FR_T) > this.range + FR_T * 3) { this.free(t); this.tiles.delete(k); }
      }
    }
    const t0 = performance.now();
    while (this.need.length && performance.now() - t0 < budgetMs) {
      const n = this.need.shift();
      if (this.tiles.has(n.k)) continue;
      this.tiles.set(n.k, this.build(n.tx, n.tz));
      this.stats.built++;
    }
    this.stats.ms += performance.now() - t0;
  }

  free(t) {
    const gl = this.gl;
    for (const m of [t.o, t.w]) if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo); }
  }

  done() { return this.need.length === 0; }

  build(tx, tz) {
    const gl = this.gl;
    const x0 = tx * FR_T, z0 = tz * FR_T;
    const cx0 = (x0 >> 4) - 1, cz0 = (z0 >> 4) - 1;
    // the mass arrays of the sixteen chunks and a ring around them
    const masses = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) masses.push(JB_getMass(cx0 + i, cz0 + j));
    const mass = (x, z) => masses[((x >> 4) - cx0) * 6 + ((z >> 4) - cz0)][(x & 15) * 16 + (z & 15)];

    // height and class of every column, with a one-column margin for the side faces
    const G = FR_N + 2, hgt = new Uint8Array(G * G), cls = new Array(G * G);
    const o = { kind: 0, top: 0, b: null };
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const wx = x0 + (i - 1) * FR_CELL, wz = z0 + (j - 1) * FR_CELL;
      let h = 0;
      for (let a = 0; a < FR_CELL; a++) for (let b = 0; b < FR_CELL; b++) { const m = mass(wx + a, wz + b); if (m > h) h = m; }
      hgt[i * G + j] = h;
      WG_colInfo(wx + 2, wz + 2, o);
      cls[i * G + j] = { kind: o.kind, b: o.b };
    }

    const op = BX_mesh(), wa = BX_mesh();
    const W = WG_K;
    for (let i = 1; i <= FR_N; i++) for (let j = 1; j <= FR_N; j++) {
      const c = cls[i * G + j], h = hgt[i * G + j];
      const bx = (i - 1) * FR_CELL, bz = (j - 1) * FR_CELL;       // tile-local
      const wx = x0 + bx, wz = z0 + bz;
      if (c.kind === W.WATER) { FR_water(wa, bx, bz); continue; }
      let blk = BK.SIDEWALK, wall = BK.CONCRETE_DK, roof = BK.ROOF_TAR;
      if (c.kind === W.ROAD) blk = BK.ASPHALT;
      else if (c.kind === W.PARK) blk = BK.GRASS;
      else if (c.kind === W.BUILDING && c.b) { const st = WG_STY[c.b.st]; wall = st.wall; roof = st.roof; blk = roof; }
      const rnd = NZ_f(wx, wz, 3);
      // the top of the column
      FR_quad(op, 2, bx, h, bz, FR_CELL, 0, FR_CELL, blk, 0.93 + 0.14 * rnd, 0, 0.62);
      // side faces where the neighbour is lower
      const nb = [hgt[(i + 1) * G + j], hgt[(i - 1) * G + j], hgt[i * G + j + 1], hgt[i * G + j - 1]];
      const fc = [0, 1, 4, 5];
      for (let q = 0; q < 4; q++) {
        const lo = nb[q];
        if (lo >= h) continue;
        const f = fc[q];
        const sky = 0.08 + 0.28 * Math.max(0, (f === 0 ? 0.43 : f === 1 ? -0.43 : f === 4 ? 0.60 : -0.60));
        // water or ground below: stop at the waterline or the street
        const base = Math.max(lo, c.kind === W.BUILDING ? WG_GY + 2 : 0);
        FR_side(op, f, bx, bz, base, h, wall, sky, wx, wz, c.kind === W.BUILDING);
      }
    }
    return { tx: tx, tz: tz, o: FR_upload(gl, op), w: FR_upload(gl, wa) };
  }

  draw(prog, planes, camX, camZ, which, maxDist) {
    const gl = this.gl, org = prog.u('uOrg');
    let drawn = 0;
    const lim = maxDist + FR_T;
    for (const t of this.tiles.values()) {
      const m = t[which];
      if (!m) continue;
      const x0 = t.tx * FR_T, z0 = t.tz * FR_T;
      const dx = x0 + FR_T / 2 - camX, dz = z0 + FR_T / 2 - camZ;
      if (dx * dx + dz * dz > lim * lim) continue;
      if (!M4_boxVisible(planes, x0, 0, z0, x0 + FR_T, WG_H, z0 + FR_T)) continue;
      gl.uniform3f(org, x0, 0, z0);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.n, m.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      drawn++;
    }
    gl.bindVertexArray(null);
    this.stats.drawn = drawn;
  }
}

// One face of a box, in the terrain vertex format. For a +y face (f=2) the box is
// the cell's top plane at height y; w,d are the cell footprint.
function FR_quad(m, f, x, y, z, w, hh, d, blk, vr, emit, sky) {
  BX_ensure(m, 4);
  const F = BX_FACE[f];
  const x1 = x + w, y1 = y + hh, z1 = z + d;
  const r = BK_RGB[blk * 3] * vr, g = BK_RGB[blk * 3 + 1] * vr, b = BK_RGB[blk * 3 + 2] * vr;
  const v0 = m.nv, fl = BK_FLAGS[blk];
  const s = Math.min(255, sky * 255), em = Math.min(255, Math.round(emit / 4 * 255));
  for (let c = 0; c < 4; c++) {
    const p = F.verts[c].p, o = (v0 + c) * 16, dd = m.v;
    dd[o] = p[0] ? x1 : x; dd[o + 1] = p[1] ? y1 : y; dd[o + 2] = p[2] ? z1 : z; dd[o + 3] = 0;
    dd[o + 4] = blk; dd[o + 5] = f; dd[o + 6] = 3; dd[o + 7] = fl;
    dd[o + 8] = Math.min(255, r); dd[o + 9] = Math.min(255, g); dd[o + 10] = Math.min(255, b); dd[o + 11] = em;
    dd[o + 12] = s; dd[o + 13] = 0; dd[o + 14] = 0; dd[o + 15] = 0;
  }
  const I = m.i, ni = m.ni;
  I[ni] = v0; I[ni + 1] = v0 + 1; I[ni + 2] = v0 + 2; I[ni + 3] = v0; I[ni + 4] = v0 + 2; I[ni + 5] = v0 + 3;
  m.nv += 4; m.ni += 6;
}

// A vertical wall of a column, from `y0` to `y1`, in floors: a wall band and a
// window band, the window picked lit or dark by hash. From far away these read as
// rows of lit windows, which is the whole look of a skyline at night.
function FR_side(m, f, bx, bz, y0, y1, wall, sky, wx, wz, windows) {
  const FH = 6;
  for (let y = y0; y < y1; ) {
    const fl = Math.floor((y - WG_BASE) / FH);
    const rel = (y - WG_BASE) - fl * FH;
    let h, blk, em = 0;
    if (windows && y >= WG_BASE + FH) {
      if (rel < 3) { h = Math.min(3 - rel, y1 - y); blk = wall; }
      else {
        h = Math.min(FH - rel, y1 - y);
        const k = NZ_f(wx * 7 + f, fl, wz * 3 + 5);
        if (k < 0.34) { blk = k < 0.20 ? BK.WIN_WARM : (k < 0.30 ? BK.WIN_COOL : BK.WIN_WHITE); em = BK_EMIT[blk]; }
        else blk = BK.GLASS_BLUE;
      }
    } else { h = y1 - y; blk = wall; }
    if (h <= 0) break;
    // the face lies on the cell boundary facing the lower neighbour
    let x = bx, z = bz, w = FR_CELL, d = FR_CELL;
    if (f === 0) { x = bx + FR_CELL; w = 0; }
    else if (f === 1) { w = 0; }
    else if (f === 4) { z = bz + FR_CELL; d = 0; }
    else { d = 0; }
    FR_quad(m, f, x, y, z, w, h, d, blk, 0.92 + 0.16 * NZ_f(wx + y, wz, f), em, em ? 0 : sky);
    y += h;
  }
}

function FR_water(m, bx, bz) {
  // a +y quad at the waterline; the water shader lowers it a hair and shades it
  BX_ensure(m, 4);
  const F = BX_FACE[2], v0 = m.nv;
  for (let c = 0; c < 4; c++) {
    const p = F.verts[c].p, o = (v0 + c) * 16, dd = m.v;
    dd[o] = bx + (p[0] ? FR_CELL : 0); dd[o + 1] = WG_SEA + 1; dd[o + 2] = bz + (p[2] ? FR_CELL : 0); dd[o + 3] = 0;
    dd[o + 4] = BK.WATER; dd[o + 5] = 2; dd[o + 6] = 3; dd[o + 7] = 4;
    dd[o + 8] = 16; dd[o + 9] = 42; dd[o + 10] = 62; dd[o + 11] = 0;
    dd[o + 12] = 150; dd[o + 13] = 0; dd[o + 14] = 0; dd[o + 15] = 0;
  }
  const I = m.i, ni = m.ni;
  I[ni] = v0; I[ni + 1] = v0 + 1; I[ni + 2] = v0 + 2; I[ni + 3] = v0; I[ni + 4] = v0 + 2; I[ni + 5] = v0 + 3;
  m.nv += 4; m.ni += 6;
}

function FR_upload(gl, m) {
  if (!m.ni) return null;
  const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, m.v.subarray(0, m.nv * 16), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_BYTE, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_BYTE, 16, 4);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 16, 8);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 16, 12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  const wide = m.nv >= 65536;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wide ? m.i.subarray(0, m.ni) : new Uint16Array(m.i.subarray(0, m.ni)), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao: vao, vbo: vbo, ibo: ibo, n: m.ni, wide: wide };
}
