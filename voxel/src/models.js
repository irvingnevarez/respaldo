// ═══════════════════════════════════════════════════════════════════════
//  MODELS — characters and props built out of small voxels.
//
//  A model is a tree of PARTS. Each part is a little voxel grid that hangs from a
//  joint; a pose is, per part, three rotations and an offset about that joint. The
//  walk cycle, the punch and the swing of the cape are all just numbers fed to
//  `pose`. Meshing hides every face between two voxels of the same part and bakes
//  a corner ambient-occlusion value into the rest, so a model reads as solid
//  carved blocks without a texture.
//
//  Units: a model is authored in voxels; `vs` is the size of one voxel in world
//  blocks. +y is up and +z is the front of the character.
// ═══════════════════════════════════════════════════════════════════════

var MD_hexCache = {};
function MD_hex(s) {
  let c = MD_hexCache[s];
  if (!c) {
    const n = parseInt(s.slice(1), 16);
    c = MD_hexCache[s] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return c;
}

// The six faces: normal, the two in-plane axes (u x v = normal, so the quad is
// counter-clockwise seen from outside) and the corner it starts from.
var MD_FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], b: [1, 0, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], b: [0, 0, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], b: [0, 0, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], b: [0, 0, 1] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], b: [0, 0, 0] },
];

// Sparse voxel grid for one part.
class VxPartData {
  constructor(name) {
    this.name = name; this.v = new Map();
    this.parent = -1; this.jx = 0; this.jy = 0; this.jz = 0;
    this.seed = 1;
    this.oy = 0;             // a head is authored relative to the neck: added to every y given to at/box/erase
  }
  key(x, y, z) { return (x + 128) + (y + 128) * 256 + (z + 128) * 65536; }
  at(x, y, z, hex, emit) {
    const c = MD_hex(hex);
    y += this.oy;
    this.v.set(this.key(x, y, z), { r: c[0], g: c[1], b: c[2], e: emit || 0, x: x, y: y, z: z });
    return this;
  }
  // half-open box [x0,x1) x [y0,y1) x [z0,z1)
  box(x0, y0, z0, x1, y1, z1, hex, emit) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.at(x, y, z, hex, emit);
    return this;
  }
  erase(x0, y0, z0, x1, y1, z1) {
    for (let x = x0; x < x1; x++) for (let y = y0 + this.oy; y < y1 + this.oy; y++) for (let z = z0; z < z1; z++) this.v.delete(this.key(x, y, z));
    return this;
  }
  has(x, y, z) { return this.v.has(this.key(x, y, z)); }

  // Build interleaved vertices (pos f32x3 | rgb + emit u8x4 | face, ao, 0, 0 u8x4) and
  // 16-bit indices. Positions are relative to the joint, in blocks.
  mesh(vs) {
    const verts = [], idx = [];
    for (const c of this.v.values()) {
      const h = NZ_hash(c.x + 31, c.y + 17, c.z + this.seed * 7);
      const shade = c.e > 0 ? 1 : 0.93 + ((h & 255) / 255) * 0.14;
      const cr = Math.min(255, Math.round(c.r * shade)), cg = Math.min(255, Math.round(c.g * shade)), cb = Math.min(255, Math.round(c.b * shade));
      const em = Math.min(255, Math.round(c.e * 255));
      for (let f = 0; f < 6; f++) {
        const F = MD_FACES[f];
        if (this.has(c.x + F.n[0], c.y + F.n[1], c.z + F.n[2])) continue;
        const ao = [0, 0, 0, 0];
        for (let q = 0; q < 4; q++) {
          const a = (q === 1 || q === 2) ? 1 : -1, b = (q === 2 || q === 3) ? 1 : -1;
          const s1 = this.has(c.x + F.n[0] + F.u[0] * a, c.y + F.n[1] + F.u[1] * a, c.z + F.n[2] + F.u[2] * a) ? 1 : 0;
          const s2 = this.has(c.x + F.n[0] + F.v[0] * b, c.y + F.n[1] + F.v[1] * b, c.z + F.n[2] + F.v[2] * b) ? 1 : 0;
          const cc = this.has(c.x + F.n[0] + F.u[0] * a + F.v[0] * b, c.y + F.n[1] + F.u[1] * a + F.v[1] * b, c.z + F.n[2] + F.u[2] * a + F.v[2] * b) ? 1 : 0;
          ao[q] = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
        }
        const base = verts.length / 5;
        for (let q = 0; q < 4; q++) {
          const a = (q === 1 || q === 2) ? 1 : 0, b = (q === 2 || q === 3) ? 1 : 0;
          const px = c.x + F.b[0] + F.u[0] * a + F.v[0] * b - this.jx;
          const py = c.y + F.b[1] + F.u[1] * a + F.v[1] * b - this.jy;
          const pz = c.z + F.b[2] + F.u[2] * a + F.v[2] * b - this.jz;
          verts.push(px * vs, py * vs, pz * vs, (cr | (cg << 8) | (cb << 16) | (em << 24)) >>> 0, (f | (ao[q] << 8)) >>> 0);
        }
        // flip the diagonal so AO interpolates along the darker pair
        if (ao[0] + ao[2] < ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const n = verts.length / 5;
    const buf = new ArrayBuffer(n * 20), f32 = new Float32Array(buf), u32 = new Uint32Array(buf);
    for (let i = 0; i < n; i++) {
      f32[i * 5] = verts[i * 5]; f32[i * 5 + 1] = verts[i * 5 + 1]; f32[i * 5 + 2] = verts[i * 5 + 2];
      u32[i * 5 + 3] = verts[i * 5 + 3]; u32[i * 5 + 4] = verts[i * 5 + 4];
    }
    return { vbuf: buf, ibuf: new Uint16Array(idx), n: idx.length, nv: n };
  }
}

// A skeleton of parts with their meshes. Parents must come before children.
class VxModel {
  constructor(name, vs) {
    this.name = name; this.vs = vs; this.parts = []; this.byName = {};
    this.uploaded = false; this.mats = [];
    this.radius = 2;                 // cull radius in blocks, about the model origin
  }
  part(name, parentName, jx, jy, jz) {
    const p = new VxPartData(name);
    p.parent = parentName ? this.byName[parentName] : -1;
    p.jx = jx; p.jy = jy; p.jz = jz; p.seed = this.parts.length + 1;
    if (name === 'head') p.oy = jy;
    this.byName[name] = this.parts.length;
    this.parts.push(p);
    this.mats.push(M4_new());
    return p;
  }
  poseNew() { return new Float32Array(this.parts.length * 6); }

  upload(gl) {
    for (const p of this.parts) {
      const m = p.mesh(this.vs);
      p.gpu = null;
      if (!m.n) continue;
      const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, m.vbuf, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 20, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 20, 16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.ibuf, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      p.gpu = { vao: vao, vbo: vbo, ibo: ibo, n: m.n };
    }
    this.uploaded = true;
  }

  // World matrices of every part: base * (joint offset, then the pose rotation).
  solve(base, pose) {
    const vs = this.vs, tmp = MD_tmp;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i], o = i * 6;
      const par = p.parent >= 0 ? this.parts[p.parent] : null;
      const ox = (p.jx - (par ? par.jx : 0) + pose[o + 3]) * vs;
      const oy = (p.jy - (par ? par.jy : 0) + pose[o + 4]) * vs;
      const oz = (p.jz - (par ? par.jz : 0) + pose[o + 5]) * vs;
      M4_model(tmp, ox, oy, oz, pose[o + 1], pose[o], pose[o + 2], 1);
      M4_mul(this.mats[i], par ? this.mats[p.parent] : base, tmp);
    }
    return this.mats;
  }

  // The world position of a point given in voxel units on a part (a hand, a muzzle).
  attach(i, x, y, z, out) {
    const m = this.mats[i], p = this.parts[i], vs = this.vs;
    const lx = (x - p.jx) * vs, ly = (y - p.jy) * vs, lz = (z - p.jz) * vs;
    out[0] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
    out[1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
    out[2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
    return out;
  }
}
var MD_tmp = new Float32Array(16);

// ── drawing models ─────────────────────────────────────────────────────────
// One draw call per part. `s` carries the per-instance lighting and tint:
//   { sky, moon, bl:[r,g,b], flash:[r,g,b,a], emit, rim:[r,g,b] }
function MD_drawModel(r, model, base, pose, s) {
  const gl = r.gl, p = r.prog.ent;
  const mats = model.solve(base, pose);
  gl.uniform3f(p.u('uELight'), s.sky, s.moon, 0);
  gl.uniform3f(p.u('uEBlock'), s.bl[0], s.bl[1], s.bl[2]);
  const f = s.flash || MD_NOFLASH;
  gl.uniform4f(p.u('uFlash'), f[0], f[1], f[2], f[3]);
  gl.uniform1f(p.u('uEmitMul'), s.emit === undefined ? 1 : s.emit);
  const rim = s.rim || MD_RIM;
  gl.uniform3f(p.u('uRim'), rim[0], rim[1], rim[2]);
  const uM = p.u('uModel');
  for (let i = 0; i < model.parts.length; i++) {
    const g = model.parts[i].gpu;
    if (!g || (pose[i * 6 + 5] > 900)) continue;           // a part parked far away is hidden
    gl.uniformMatrix4fv(uM, false, mats[i]);
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
  }
}
var MD_NOFLASH = [0, 0, 0, 0];
var MD_RIM = [0.10, 0.16, 0.30];

// ═══════════════════════════════════════════════════════════════════════
//  The humanoid skeleton shared by Batman and every thug.
//   0 torso  1 head  2 armL (+x)  3 armR (-x)  4 legL (+x)  5 legR (-x)  6.. cape / extras
// ═══════════════════════════════════════════════════════════════════════
var MD_TORSO = 0, MD_HEAD = 1, MD_ARML = 2, MD_ARMR = 3, MD_LEGL = 4, MD_LEGR = 5, MD_CAPE0 = 6;

// Lays out the bare skeleton and fills it with the colours in `c`. Returns the
// model so the caller can add details and extra parts.
function MD_humanoid(name, vs, c) {
  const M = new VxModel(name, vs);
  const T = M.part('torso', null, 0, 10, 0);
  const H = M.part('head', 'torso', 0, 19, 0);
  const AL = M.part('armL', 'torso', 5, 18, 0);
  const AR = M.part('armR', 'torso', -5, 18, 0);
  const LL = M.part('legL', 'torso', 2, 10, 0);
  const LR = M.part('legR', 'torso', -2, 10, 0);

  // torso: suit, with the lower two rows left for the belt
  T.box(-4, 12, -2, 4, 19, 2, c.suit);
  T.box(-4, 10, -2, 4, 12, 2, c.belt);
  T.box(-4, 18, -2, 4, 19, 2, c.suitTop || c.suit);        // shoulder line
  // arms: sleeve above, glove below
  for (const [P, x0] of [[AL, 4], [AR, -7]]) {
    P.box(x0, 13, -2, x0 + 3, 19, 2, c.sleeve || c.suit);
    P.box(x0, 9, -2, x0 + 3, 13, 2, c.glove);
  }
  // legs: trousers, boots
  for (const [P, x0] of [[LL, 0], [LR, -4]]) {
    P.box(x0, 4, -2, x0 + 4, 10, 2, c.pants);
    P.box(x0, 0, -2, x0 + 4, 4, 2, c.boot);
    P.box(x0, 0, 2, x0 + 4, 1, 3, c.boot);                   // toe cap: boots stick out a voxel
    P.box(x0, 1, 2, x0 + 4, 2, 3, c.boot);
  }
  // head
  H.box(-3, 0, -3, 3, 7, 3, c.head);
  M.radius = 2.6;
  return M;
}

// ── Batman ────────────────────────────────────────────────────────────────
function MD_batman() {
  const SUIT = '#454e5f', BLACK = '#13141a', GRAY2 = '#343c4b', YEL = '#dcae2e', YEL2 = '#a98220', SKIN = '#d0987a', SKIN2 = '#94644e';
  const M = MD_humanoid('batman', 1 / 16, { suit: SUIT, suitTop: GRAY2, belt: YEL, sleeve: SUIT, glove: BLACK, pants: SUIT, boot: BLACK, head: BLACK });
  const T = M.parts[MD_TORSO], H = M.parts[MD_HEAD];
  // shorts: the top of the legs is black, as on the comic suit
  for (const [P, x0] of [[M.parts[MD_LEGL], 0], [M.parts[MD_LEGR], -4]]) {
    P.box(x0, 8, -2, x0 + 4, 10, 2, BLACK);
    P.box(x0, 4, -2, x0 + 4, 5, 2, GRAY2);                   // boot-top band
  }
  // chest emblem on the front layer: a yellow oval with a black bat in it
  const front = 1;
  for (const [y, x0, x1] of [[17, -2, 2], [16, -3, 3], [15, -2, 2]]) for (let x = x0; x < x1; x++) T.at(x, y, front, YEL);
  for (const x of [-2, 1]) T.at(x, 17, front, BLACK);
  for (let x = -3; x < 3; x++) T.at(x, 16, front, BLACK);
  for (const x of [-1, 0]) T.at(x, 15, front, BLACK);
  T.at(-1, 14, front, BLACK); T.at(0, 14, front, BLACK);
  // belt: buckle and two pouches that stand proud of the front
  T.box(-1, 10, 1, 1, 12, 2, YEL2);
  T.box(-3, 10, 2, -1, 12, 3, YEL2); T.box(1, 10, 2, 3, 12, 3, YEL2);
  T.box(-4, 12, -2, 4, 13, -1, GRAY2);                       // lower back ridge, breaks up the flat torso
  // gauntlets: black forearm with a fin on the outer side
  for (const [P, x0, fx] of [[M.parts[MD_ARML], 4, 7], [M.parts[MD_ARMR], -7, -8]]) {
    P.box(x0, 12, -2, x0 + 3, 14, 2, BLACK);
    P.box(fx, 11, -1, fx + 1, 14, 1, BLACK);
    P.box(fx, 10, -1, fx + 1, 11, 1, BLACK);
  }
  // cowl: the face opening, a mouth line, the white eyes, the ears
  H.box(-2, 0, 2, 2, 2, 3, SKIN); H.box(-3, 2, 2, 3, 3, 3, SKIN);
  H.box(-1, 1, 2, 1, 2, 3, SKIN2);                           // mouth line
  H.box(-1, 3, 2, 1, 4, 3, SKIN);                            // nose
  H.at(-2, 4, 2, '#f4f7ff', 0.42); H.at(-2, 5, 2, '#f4f7ff', 0.42);
  H.at(1, 4, 2, '#f4f7ff', 0.42); H.at(1, 5, 2, '#f4f7ff', 0.42);
  H.at(-3, 5, 2, '#f4f7ff', 0.28); H.at(2, 5, 2, '#f4f7ff', 0.28);
  H.box(-3, 7, -1, -1, 9, 1, BLACK); H.box(1, 7, -1, 3, 9, 1, BLACK);
  H.at(-3, 9, 0, BLACK); H.at(2, 9, 0, BLACK);
  // cape: four hinged strips; the bottom one is scalloped like bat wings
  let prevY = 19;
  for (let i = 0; i < 4; i++) {
    const top = 19 - i * 4;
    const P = M.part('cape' + i, i ? 'cape' + (i - 1) : 'torso', 0, top, -2);
    const w = i === 0 ? 5 : (i === 1 ? 6 : 6);
    P.box(-w, top - 4, -3, w, top, -2, i % 2 ? '#181a24' : '#1d2030');
    if (i === 3) {
      P.erase(-w, top - 4, -3, -4, top - 3, -2); P.erase(-3, top - 4, -3, -1, top - 3, -2);
      P.erase(1, top - 4, -3, 3, top - 3, -2); P.erase(4, top - 4, -3, w, top - 3, -2);
    }
    prevY = top;
  }
  // glide wings: the cape opens along the arms. They hang hidden until a glide starts;
  // in the torso's frame they lie in the x-y plane, which is exactly the horizontal
  // plane once the body pitches forward.
  for (const s of [1, -1]) {
    const W = M.part(s > 0 ? 'wingL' : 'wingR', 'torso', s * 4, 18, -1);
    for (let k = 0; k < 13; k++) {
      const xv = s > 0 ? 4 + k : -5 - k;
      const len = 15 - Math.floor(k * 0.8) - ((k % 3 === 2) ? 3 : 0);       // scalloped trailing edge
      W.box(xv, 18 - len, -1, xv + 1, 18, 0, k % 4 === 3 ? '#252a3f' : '#181b27');
      W.box(xv, 17, -1, xv + 1, 18, 0, '#2d3450');                          // the leading rib
    }
  }
  M.radius = 3.4; M.caped = true;
  return M;
}

// ── a generic bad guy (colours decide who) ────────────────────────────────
// kind 'clown' for the Joker's people, 'goon' for the Penguin's.
function MD_thug(kind) {
  if (kind === 'clown') {
    const PURP = '#6a2d93', PURP2 = '#4c1f6b', GRN = '#4aa83c', WHT = '#ece9ee', RED = '#cc2430', YEL = '#e8a620';
    const M = MD_humanoid('clown', 1 / 16, { suit: PURP, belt: PURP2, sleeve: PURP, glove: WHT, pants: '#3d3158', boot: YEL, head: WHT });
    const T = M.parts[MD_TORSO], H = M.parts[MD_HEAD];
    T.box(-2, 13, 1, 2, 19, 2, YEL);                          // the loud shirt under the jacket
    T.box(-1, 14, 1, 1, 19, 2, '#e86a20');
    T.box(-1, 13, 1, 1, 14, 2, GRN);                          // tie
    // head: white paint, green hair, red grin and nose
    H.box(-3, 6, -3, 3, 8, 3, GRN); H.box(-3, 4, -3, 3, 6, -2, GRN); H.box(-3, 5, -3, -2, 6, 3, GRN); H.box(2, 5, -3, 3, 6, 3, GRN);
    H.box(-1, 7, 3, 1, 8, 4, GRN);                            // a tuft
    H.box(-2, 1, 2, 2, 2, 3, RED); H.at(-3, 2, 2, RED); H.at(2, 2, 2, RED);
    H.box(-1, 3, 2, 1, 4, 4, RED);                            // nose
    H.at(-2, 4, 2, '#14141a'); H.at(1, 4, 2, '#14141a'); H.at(-2, 5, 2, '#14141a'); H.at(1, 5, 2, '#14141a');
    // a crowbar in the right hand
    const W = M.part('weapon', 'armR', -5.5, 10, 1.5);
    W.box(-7, 8, 1, -5, 10, 11, '#8a8d96');
    W.box(-7, 8, 9, -5, 10, 12, '#6a6d76');
    M.radius = 2.4;
    return M;
  }
  // goon: dark suit, bowler hat, a long umbrella
  const SUIT = '#272a33', SHIRT = '#d8d8de', SKIN = '#c89878';
  const M = MD_humanoid('goon', 1 / 16, { suit: SUIT, suitTop: '#1c1e25', belt: '#14151a', sleeve: SUIT, glove: '#111216', pants: '#1e2028', boot: '#101116', head: SKIN });
  const T = M.parts[MD_TORSO], H = M.parts[MD_HEAD];
  T.box(-1, 12, 1, 1, 19, 2, SHIRT); T.box(-1, 12, 1, 1, 17, 2, '#a02830');   // shirt front, red tie
  T.box(-1, 17, 1, 1, 19, 2, SHIRT);
  H.box(-3, 5, -3, 3, 7, 3, '#17181d'); H.box(-2, 7, -2, 2, 9, 2, '#17181d');  // bowler: brim then crown
  H.box(-3, 4, -3, 3, 5, 3, '#241f1c');                                        // hair under the brim
  H.at(-2, 3, 2, '#111216'); H.at(1, 3, 2, '#111216');                         // eyes
  H.box(-1, 1, 2, 1, 2, 3, '#7a4a3a');
  const W = M.part('weapon', 'armR', -5.5, 10, 1.5);
  W.box(-7, 7, 1, -5, 9, 10, '#18191f'); W.box(-7, 8, 9, -5, 10, 12, '#555a66');
  M.radius = 2.4;
  return M;
}

// ── drone: a flying camera-gun ───────────────────────────────────────────
function MD_drone() {
  const M = new VxModel('drone', 1 / 12);
  const B = M.part('body', null, 0, 0, 0);
  B.box(-3, -1, -3, 3, 1, 3, '#2a2f3a'); B.box(-2, 1, -2, 2, 2, 2, '#3a4150'); B.box(-2, -2, -2, 2, -1, 2, '#1d2129');
  B.box(-1, -1, 3, 1, 1, 4, '#ff3030', 1.0);                  // the eye
  for (const [x, z] of [[-5, -5], [4, -5], [-5, 4], [4, 4]]) {
    B.box(x, 0, z, x + 1, 1, z + 1, '#2a2f3a');
  }
  B.box(-5, 0, -5, 5, 1, -4, '#252a35'); B.box(-5, 0, 4, 5, 1, 5, '#252a35');
  B.box(-5, 0, -5, -4, 1, 5, '#252a35'); B.box(4, 0, -5, 5, 1, 5, '#252a35');
  const rotors = [[-5, -5], [4, -5], [-5, 4], [4, 4]];
  for (let i = 0; i < 4; i++) {
    const R = M.part('rotor' + i, 'body', rotors[i][0] + 0.5, 1.5, rotors[i][1] + 0.5);
    R.box(rotors[i][0] - 2, 1, rotors[i][1] + 0, rotors[i][0] + 3, 2, rotors[i][1] + 1, '#8892a4');
    R.box(rotors[i][0] + 0, 1, rotors[i][1] - 2, rotors[i][0] + 1, 2, rotors[i][1] + 3, '#8892a4');
  }
  M.radius = 1.4;
  return M;
}

// ── Penguin (boss): round, top-hatted, with an umbrella ───────────────────
function MD_penguin() {
  const BLK = '#17181e', WHT = '#e8e8ee', ORG = '#e6962a', GRY = '#2c2f38';
  const M = new VxModel('penguin', 1 / 14);
  const B = M.part('body', null, 0, 9, 0);
  // an egg of a body: a stack of rounded slabs, white belly on the front
  const rows = [[7, 5, 5], [8, 6, 5], [9, 7, 6], [10, 7, 6], [11, 7, 6], [12, 6, 5], [13, 6, 5], [14, 5, 4], [15, 4, 4]];
  rows.forEach(function (r, i) {
    const y = 6 + i, hw = r[1], hd = r[2];
    B.box(-hw, y, -hd, hw, y + 1, hd, BLK);
    B.box(-hw + 2, y, hd - 1, hw - 2, y + 1, hd, WHT);        // belly
  });
  B.box(-2, 17, 3, 2, 18, 4, '#d9a233');                       // gold chain at the collar
  for (const x of [-1, 0]) for (let y = 8; y < 15; y += 2) B.at(x, y, 6, '#d9a233');   // buttons
  const H = M.part('head', 'body', 0, 21, 0);
  H.box(-4, 0, -4, 4, 6, 4, BLK); H.box(-3, 0, 3, 3, 4, 4, '#d8d8de');
  H.box(-1, 2, 4, 1, 4, 8, ORG);                                // the beak
  H.box(-1, 4, 4, 1, 5, 6, ORG);
  H.at(-2, 4, 4, '#f4f4ff', 1.0); H.at(1, 4, 4, '#f4f4ff', 1.0);   // eyes
  H.box(1, 3, 4, 3, 5, 5, '#d9a233');                            // the monocle's rim
  H.box(-4, 6, -4, 4, 7, 4, '#0f1015');                          // hat brim
  H.box(-3, 7, -3, 3, 13, 3, '#0f1015'); H.box(-3, 8, -3, 3, 9, 3, '#7a1620');   // top hat with a red band
  const FL = M.part('flipL', 'body', 7, 17, 0), FR = M.part('flipR', 'body', -7, 17, 0);
  FL.box(7, 8, -2, 9, 17, 2, BLK); FR.box(-9, 8, -2, -7, 17, 2, BLK);
  const LL = M.part('footL', 'body', 3, 6, 0), LR = M.part('footR', 'body', -3, 6, 0);
  LL.box(1, 0, -4, 6, 6, 4, ORG); LL.box(1, 0, 4, 6, 2, 8, ORG);
  LR.box(-6, 0, -4, -1, 6, 4, ORG); LR.box(-6, 0, 4, -1, 2, 8, ORG);
  // the umbrella, shut: a cane in the right flipper
  const U = M.part('cane', 'flipR', -8, 12, 3);
  U.box(-9, 2, 2, -8, 26, 3, '#2a2a30');
  U.box(-10, 26, 1, -7, 30, 4, '#c8322c');
  U.box(-9, 0, 2, -8, 2, 3, '#555a66');
  // the umbrella, open: held up over the hat while he flies
  const C = M.part('brolly', 'body', 0, 34, 0);
  C.box(0, 34, 0, 1, 44, 1, '#2a2a30');
  const R = 10;
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, z);
    if (d > R) continue;
    const h = Math.round((1 - (d / R) * (d / R)) * 4);
    const col = (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 4)) & 1) ? '#c8322c' : '#17181e';
    C.at(x, 42 + h, z, col);
    if (d > 3 && h <= 2) C.at(x, 42 + h - 1, z, '#101116');
  }
  C.at(0, 47, 0, '#d9a233');
  M.radius = 5;
  return M;
}

// ── Joker (boss): tall, purple, a grin you can see from across the street ──
function MD_joker() {
  const PURP = '#6f2ba0', PURP2 = '#4b1c70', GRN = '#4cc040', WHT = '#f2eff4', RED = '#d4202e', ORG = '#e9741c';
  const M = MD_humanoid('joker', 1 / 15, { suit: PURP, belt: PURP2, sleeve: PURP, glove: GRN, pants: '#3b2f6a', boot: '#d8b020', head: WHT });
  const T = M.parts[MD_TORSO], H = M.parts[MD_HEAD];
  T.box(-1, 12, 1, 1, 19, 2, ORG); T.box(-1, 17, 1, 1, 19, 2, GRN);
  T.box(-4, 5, -2, 4, 10, -1, PURP);                           // coat tails hang over the hips
  T.box(-3, 3, -2, 3, 5, -1, PURP2);
  T.box(-4, 17, 2, -2, 19, 3, GRN); T.box(2, 17, 2, 4, 19, 3, GRN);   // lapels in a flower
  H.box(-3, 5, -3, 3, 8, 3, GRN); H.box(-3, 3, -3, 3, 5, -2, GRN); H.box(-4, 4, -2, -3, 8, 2, GRN); H.box(3, 4, -2, 4, 8, 2, GRN);
  H.box(-2, 8, -2, 2, 10, 2, GRN); H.at(-1, 10, 0, GRN); H.at(0, 10, 0, GRN);
  H.box(-2, 1, 2, 2, 2, 3, RED); H.at(-3, 2, 2, RED); H.at(2, 2, 2, RED); H.at(-3, 3, 2, RED); H.at(2, 3, 2, RED);
  H.box(-1, 3, 2, 1, 4, 4, RED);
  H.at(-2, 4, 2, '#18101c'); H.at(1, 4, 2, '#18101c'); H.at(-2, 5, 2, '#18101c'); H.at(1, 5, 2, '#18101c');
  H.at(-2, 6, 2, GRN); H.at(1, 6, 2, GRN);
  const W = M.part('weapon', 'armR', -5.5, 10, 1.5);
  W.box(-7, 8, 1, -5, 10, 7, '#2a2a30'); W.box(-7, 10, 1, -5, 12, 3, '#2a2a30');     // a big pistol
  W.box(-7, 8, 7, -5, 9, 9, '#6a6e7a');
  M.radius = 3;
  return M;
}

// ═══════════════════════════════════════════════════════════════════════
//  Small things: projectiles and pickups. One part each.
// ═══════════════════════════════════════════════════════════════════════
function MD_single(name, vs, fn) {
  const M = new VxModel(name, vs);
  const P = M.part('main', null, 0, 0, 0);
  fn(P);
  let r = 0;
  for (const c of P.v.values()) r = Math.max(r, Math.hypot(c.x, c.y, c.z));
  M.radius = r * vs + 0.5;
  return M;
}

function MD_batarang() {
  return MD_single('batarang', 1 / 9, P => {
    const K = '#262833', E = '#5a6a88';
    P.box(-1, 0, 1, 2, 1, 2, K);                       // body
    P.box(-4, 0, 0, -1, 1, 1, K); P.box(2, 0, 0, 5, 1, 1, K);       // wings
    P.box(-3, 0, 1, -1, 1, 2, K); P.box(2, 0, 1, 4, 1, 2, K);
    P.at(-1, 0, 2, K); P.at(1, 0, 2, K); P.at(-4, 0, -1, K); P.at(4, 0, -1, K);
    P.at(0, 0, 1, '#9fe8ff', 0.9); P.at(0, 0, 0, E);
  });
}
function MD_bolt() { return MD_single('bolt', 1 / 10, P => { P.box(-1, -1, -3, 1, 1, 3, '#ff5a2a', 1.4); P.box(-1, -1, 3, 1, 1, 4, '#ffd070', 1.6); }); }
function MD_bullet() { return MD_single('bullet', 1 / 12, P => { P.box(0, 0, -2, 1, 1, 3, '#ffd060', 1.5); }); }
function MD_bomb() {
  return MD_single('bomb', 1 / 8, P => {
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) {
      if (x * x + y * y + z * z <= 10) P.at(x, y, z, (x + y + z) & 1 ? '#17181e' : '#22242c');
    }
    P.box(0, 3, 0, 1, 5, 1, '#6a5a3a'); P.at(0, 5, 0, '#ff5030', 1.8);
  });
}
function MD_card() {
  return MD_single('card', 1 / 10, P => {
    P.box(-2, 0, -3, 2, 1, 3, '#f1eef2', 0.30);
    P.box(-1, 0, -1, 1, 1, 1, '#d02030', 0.6);
    P.at(-2, 0, -3, '#d02030', 0.5); P.at(1, 0, 2, '#d02030', 0.5);
  });
}
function MD_heart() {
  return MD_single('heart', 1 / 8, P => {
    const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
    rows.forEach((r, i) => { for (let x = 0; x < 7; x++) if (r[x] === 'X') { P.box(x - 3, 5 - i, -1, x - 2, 6 - i, 1, i === 1 && x < 3 ? '#ff7a8a' : '#ee2f48', 0.85); } });
  });
}
function MD_crate() {
  return MD_single('crate', 1 / 9, P => {
    P.box(-3, 0, -3, 4, 5, 4, '#dcae2e', 0.28);
    P.box(-3, 0, -3, 4, 1, 4, '#8a6a1c'); P.box(-3, 4, -3, 4, 5, 4, '#b98c20');
    for (const x of [-3, 3]) P.box(x, 1, -3, x + 1, 4, 4, '#2a2a30');
    P.box(-1, 5, -1, 2, 6, 2, '#1a1b22');                // a bat on the lid
    P.at(-2, 5, 0, '#1a1b22'); P.at(2, 5, 0, '#1a1b22');
    P.at(0, 5, 0, '#9fe8ff', 1.0);
  });
}
function MD_trophy() {
  return MD_single('trophy', 1 / 8, P => {
    // a green question mark, the Riddler's calling card
    const rows = ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'];
    rows.forEach((r, i) => { for (let x = 0; x < 5; x++) if (r[x] === 'X') P.box(x - 2, 6 - i, -1, x - 1, 7 - i, 1, '#46e870', 1.3); });
  });
}
