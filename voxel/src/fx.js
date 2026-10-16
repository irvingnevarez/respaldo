// ═══════════════════════════════════════════════════════════════════════
//  FX — particles, projectiles, the grapple rope and floating text.
//
//  Particles and the rope are tiny cubes drawn in one instanced call; there is no
//  texture anywhere. Projectiles are small voxel models. Everything here is
//  simulated on the CPU in fixed-size arrays, so a firefight allocates nothing.
// ═══════════════════════════════════════════════════════════════════════

var FX_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aCorner;        // cube corner, -0.5..0.5
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec4 aPosSize;       // centre, size
layout(location = 3) in vec4 aColE;          // rgb, emission
uniform mat4 uVP;
out vec3 vW;
out vec4 vCol;
out vec3 vN;
void main() {
  vec3 p = aPosSize.xyz + aCorner * aPosSize.w;
  vW = p; vCol = aColE; vN = aNrm;
  gl_Position = uVP * vec4(p, 1.0);
}`;

var FX_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec4 vCol;
in vec3 vN;
uniform vec3 uSkyTint;
uniform float uSkyI;
${SH_COMMON}
layout(location = 0) out vec4 oColor;
void main() {
  vec3 albedo = pow(vCol.rgb, vec3(2.2));
  float shade = 0.55 + 0.45 * vN.y * 0.5 + 0.25 * max(dot(vN, uMoonDir), 0.0);
  vec3 col = albedo * uSkyTint * uSkyI * 0.45 * shade;
  col += albedo * vCol.a * 4.0;
  col = mix(col, uFog, fogAmt(vW) * (1.0 - min(vCol.a, 1.0)));
  oColor = vec4(col, 1.0);
}`;

var FX_MAX = 900;

class VxFx {
  constructor(r) {
    this.r = r;
    const gl = r.gl;
    // a unit cube as 36 vertices with flat normals
    const V = [], N = [];
    for (let f = 0; f < 6; f++) {
      const F = MD_FACES[f];
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (ab) {
        return [F.b[0] + F.u[0] * ab[0] + F.v[0] * ab[1] - 0.5, F.b[1] + F.u[1] * ab[0] + F.v[1] * ab[1] - 0.5, F.b[2] + F.u[2] * ab[0] + F.v[2] * ab[1] - 0.5];
      });
      for (const i of [0, 1, 2, 0, 2, 3]) { V.push(q[i][0], q[i][1], q[i][2]); N.push(F.n[0], F.n[1], F.n[2]); }
    }
    this.prog = GL_prog(gl, FX_VS, FX_FS, 'fx');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 0);
    this.inst = new Float32Array(FX_MAX * 8);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.ib); gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    // particle store: x y z  vx vy vz  life max  size  r g b  emit  grav  drag  shrink
    this.P = new Float32Array(FX_MAX * 16); this.n = 0;
    this.glows = [];           // short-lived light sprites: x y z radius r g b intensity life max
    this.texts = [];           // floating text: world position, string, colour, life
    this.rope = null;
  }

  // ── spawning ──
  add(x, y, z, vx, vy, vz, life, size, r, g, b, emit, grav, drag, shrink) {
    if (this.n >= FX_MAX) return;
    const o = this.n++ * 16, P = this.P;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = vx; P[o + 4] = vy; P[o + 5] = vz;
    P[o + 6] = life; P[o + 7] = life; P[o + 8] = size; P[o + 9] = r; P[o + 10] = g; P[o + 11] = b;
    P[o + 12] = emit; P[o + 13] = grav; P[o + 14] = drag; P[o + 15] = shrink;
  }
  rnd() { return Math.random() * 2 - 1; }

  sparks(x, y, z, n, dirx, dirz, hot) {
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 7;
      this.add(x, y, z, this.rnd() * sp + (dirx || 0) * 2, Math.random() * sp * 0.8 + 1, this.rnd() * sp + (dirz || 0) * 2,
        0.22 + Math.random() * 0.25, 0.07 + Math.random() * 0.06, 1.0, hot ? 0.55 : 0.85, hot ? 0.25 : 0.45, 1.6, 14, 1.5, 1);
    }
  }
  debris(x, y, z, n, rgb, power) {
    power = power || 1;
    for (let i = 0; i < n; i++) {
      const sp = (2 + Math.random() * 6) * power;
      const k = 0.8 + Math.random() * 0.4;
      this.add(x + this.rnd() * 0.25, y + this.rnd() * 0.2, z + this.rnd() * 0.25, this.rnd() * sp, Math.random() * sp + 2, this.rnd() * sp,
        0.55 + Math.random() * 0.5, 0.10 + Math.random() * 0.10, rgb[0] / 255 * k, rgb[1] / 255 * k, rgb[2] / 255 * k, 0, 24, 0.4, 0.7);
    }
  }
  puff(x, y, z, n, size, shade) {
    for (let i = 0; i < n; i++) {
      const s = shade === undefined ? 0.28 : shade;
      this.add(x + this.rnd() * 0.3, y + this.rnd() * 0.2, z + this.rnd() * 0.3, this.rnd() * 1.4, 0.8 + Math.random() * 1.6, this.rnd() * 1.4,
        0.6 + Math.random() * 0.5, size * (0.7 + Math.random() * 0.6), s, s, s * 1.1, 0, -1.2, 1.8, -0.9);
    }
  }
  dust(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.random() * 0.4, sp = (2.5 + Math.random() * 3) * (power || 1);
      this.add(x + Math.cos(a) * 0.3, y + 0.08, z + Math.sin(a) * 0.3, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp,
        0.35 + Math.random() * 0.25, 0.10 + Math.random() * 0.08, 0.34, 0.36, 0.40, 0, 2, 4, 0.8);
    }
  }
  burst(x, y, z, n, rgb, emit, power) {
    for (let i = 0; i < n; i++) {
      const sp = (3 + Math.random() * 8) * (power || 1);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1, c = Math.sqrt(1 - e * e);
      this.add(x, y, z, Math.cos(a) * c * sp, e * sp, Math.sin(a) * c * sp, 0.3 + Math.random() * 0.4, 0.09 + Math.random() * 0.08,
        rgb[0], rgb[1], rgb[2], emit, 6, 2.2, 1);
    }
  }
  glow(x, y, z, radius, r, g, b, intensity, life) { this.glows.push({ x: x, y: y, z: z, rad: radius, r: r, g: g, b: b, i: intensity, life: life, max: life }); }
  text(x, y, z, str, color, size) { this.texts.push({ x: x, y: y, z: z, s: str, c: color || '#ffe08a', life: 1.05, max: 1.05, size: size || 1 }); }

  // ── simulation ──
  update(dt) {
    const P = this.P;
    let i = 0;
    while (i < this.n) {
      const o = i * 16;
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) {                                  // swap-remove
        const l = (this.n - 1) * 16;
        if (o !== l) for (let k = 0; k < 16; k++) P[o + k] = P[l + k];
        this.n--; continue;
      }
      const d = Math.exp(-P[o + 14] * dt);
      P[o + 3] *= d; P[o + 5] *= d;
      P[o + 4] = P[o + 4] * (P[o + 14] > 3 ? d : 1) - P[o + 13] * dt;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      // debris that reaches the ground stops there instead of sinking through it
      if (P[o + 13] > 10 && P[o + 1] < WG_GY + 1.05 && P[o + 1] > WG_GY - 1) { P[o + 1] = WG_GY + 1.05; P[o + 4] = Math.abs(P[o + 4]) * 0.25; P[o + 3] *= 0.6; P[o + 5] *= 0.6; }
      i++;
    }
    for (let g = this.glows.length - 1; g >= 0; g--) { this.glows[g].life -= dt; if (this.glows[g].life <= 0) this.glows.splice(g, 1); }
    for (let g = this.texts.length - 1; g >= 0; g--) { const t = this.texts[g]; t.life -= dt; t.y += dt * 1.1; if (t.life <= 0) this.texts.splice(g, 1); }
  }

  // Dynamic lights handed to the glow-sprite pass: appended after the world's own.
  appendGlows(out, n) {
    const cap = out.length / 8;
    for (const g of this.glows) {
      if (n >= cap) break;
      const k = g.life / g.max, o = n * 8;
      out[o] = g.x; out[o + 1] = g.y; out[o + 2] = g.z; out[o + 3] = g.rad;
      out[o + 4] = g.r; out[o + 5] = g.g; out[o + 6] = g.b; out[o + 7] = g.i * k;
      n++;
    }
    return n;
  }

  // ── drawing ──
  // Called inside the scene pass. Rope points are added here so it is one draw.
  draw(r, cam, ropes) {
    const gl = r.gl, P = this.P, I = this.inst;
    let m = 0;
    for (let i = 0; i < this.n && m < FX_MAX; i++) {
      const o = i * 16, k = P[o + 6] / P[o + 7];
      const sz = P[o + 8] * (P[o + 15] >= 0 ? (1 - (1 - k) * P[o + 15]) : (1 + (1 - k) * -P[o + 15]));
      const q = m++ * 8;
      I[q] = P[o]; I[q + 1] = P[o + 1]; I[q + 2] = P[o + 2]; I[q + 3] = sz;
      I[q + 4] = P[o + 9]; I[q + 5] = P[o + 10]; I[q + 6] = P[o + 11]; I[q + 7] = P[o + 12] * (0.4 + 0.6 * k);
    }
    // ropes: a dotted line of small dark cubes
    if (ropes) for (const rp of ropes) {
      const dx = rp.bx - rp.ax, dy = rp.by - rp.ay, dz = rp.bz - rp.az, L = Math.hypot(dx, dy, dz);
      const n = Math.min(260, Math.max(2, Math.ceil(L / 0.16)));
      for (let k = 0; k <= n && m < FX_MAX; k++) {
        const t = k / n, q = m++ * 8;
        // a slight sag that vanishes as the rope pulls taut
        const sag = Math.sin(t * Math.PI) * (rp.sag || 0);
        I[q] = rp.ax + dx * t; I[q + 1] = rp.ay + dy * t - sag; I[q + 2] = rp.az + dz * t; I[q + 3] = 0.075;
        I[q + 4] = 0.22; I[q + 5] = 0.23; I[q + 6] = 0.27; I[q + 7] = 0.0;
      }
    }
    if (!m) return;
    const p = this.prog;
    gl.useProgram(p.id);
    gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
    r.common(p, cam);
    gl.uniform3f(p.u('uSkyTint'), r.P.skyTint[0], r.P.skyTint[1], r.P.skyTint[2]);
    gl.uniform1f(p.u('uSkyI'), r.P.skyI);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, I, 0, m * 8);
    gl.enable(gl.CULL_FACE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, m);
    gl.bindVertexArray(null);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PROJECTILES — batarangs, bullets, bolts, cards, bombs.
//  They fly in short steps tested against the voxels and against the bodies they
//  can hurt, so nothing at 44 blocks a second passes through a thin target.
// ═══════════════════════════════════════════════════════════════════════
var PJ_KIND = {
  batarang: { model: 'batarang', spin: 18, r: 0.55, grav: 0, trail: [0.4, 0.8, 1.0] },
  bullet: { model: 'bullet', spin: 0, r: 0.4, grav: 0, trail: [1.0, 0.8, 0.3] },
  bolt: { model: 'bolt', spin: 0, r: 0.5, grav: 0, trail: [1.0, 0.4, 0.2] },
  card: { model: 'card', spin: 14, r: 0.55, grav: 0, trail: [1.0, 0.3, 0.4] },
  bomb: { model: 'bomb', spin: 3, r: 0.5, grav: 22, trail: [1.0, 0.4, 0.2], explode: 3.4 },
};

function PJ_spawn(o) {
  const k = PJ_KIND[o.kind];
  const p = { kind: o.kind, K: k, x: o.x, y: o.y, z: o.z, vx: o.vx, vy: o.vy, vz: o.vz, dmg: o.dmg || 1, life: o.life || 2, own: o.own || 'enemy',
    target: o.target || null, age: 0, spin: Math.random() * 6, heavy: !!o.heavy, grav: o.grav !== undefined ? o.grav : k.grav, fuse: o.fuse || 0, dead: false };
  GS.projs.push(p);
  return p;
}

function PJ_explode(p) {
  const K = p.K, R = K.explode || 0;
  if (p.gas) {                                   // a gas canister: a lingering cloud instead of a blast
    GS.zones.push({ x: p.x, y: Math.max(p.y - 0.4, WG_GY + 1.9), z: p.z, r: 4.2, life: 7, t: 0, hurt: 0.3 });
    GS.fx.puff(p.x, p.y + 0.4, p.z, 12, 0.7, 0.3);
    GS.events.push({ t: 'poof' });
    return;
  }
  GS.fx.burst(p.x, p.y, p.z, 26, [1, 0.6, 0.2], 1.6, 1.3);
  GS.fx.puff(p.x, p.y, p.z, 10, 0.55, 0.22);
  GS.fx.glow(p.x, p.y + 0.3, p.z, 7, 1.0, 0.55, 0.2, 5.0, 0.35);
  GS.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z });
  if (R > 0) {
    const pl = GS.player;
    const d = Math.hypot(pl.b.x - p.x, pl.b.y + 0.9 - p.y, pl.b.z - p.z);
    if (d < R && p.own !== 'player' && p.dmg > 0) pl.hurt(p.dmg, pl.b.x - p.x, pl.b.z - p.z, true);
  }
}

function PJ_update(dt) {
  const w = GS.world, pl = GS.player, L = GS.projs;
  for (let i = L.length - 1; i >= 0; i--) {
    const p = L[i], K = p.K;
    p.age += dt; p.life -= dt; p.spin += K.spin * dt;
    if (p.fuse > 0) { p.fuse -= dt; if (p.fuse <= 0) { PJ_explode(p); p.dead = true; } }
    if (p.life <= 0 && !p.dead) { if (K.explode) PJ_explode(p); p.dead = true; }
    if (!p.dead) {
      // homing for the player's batarang: steer toward a living target, but never turn sharply
      if (p.target && p.own === 'player') {
        const t = p.target;
        if (t.dead || t.hp <= 0) p.target = null;
        else {
          const c = t.center(), dx = c[0] - p.x, dy = c[1] - p.y, dz = c[2] - p.z, d = Math.hypot(dx, dy, dz) || 1;
          const sp = Math.hypot(p.vx, p.vy, p.vz) || 1, k = Math.min(1, 7 * dt);
          p.vx += (dx / d * sp - p.vx) * k; p.vy += (dy / d * sp - p.vy) * k; p.vz += (dz / d * sp - p.vz) * k;
          const s2 = Math.hypot(p.vx, p.vy, p.vz) || 1; p.vx *= sp / s2; p.vy *= sp / s2; p.vz *= sp / s2;
        }
      }
      p.vy -= p.grav * dt;
      const sp = Math.hypot(p.vx, p.vy, p.vz), n = Math.max(1, Math.ceil(sp * dt / 0.7));
      for (let s = 0; s < n && !p.dead; s++) {
        const sx = p.vx * dt / n, sy = p.vy * dt / n, sz = p.vz * dt / n;
        // the world: a voxel at the new point ends the flight
        const nx = p.x + sx, ny = p.y + sy, nz = p.z + sz;
        if (w.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
          GS.fx.sparks(p.x, p.y, p.z, 7, -p.vx * 0.05, -p.vz * 0.05, false);
          GS.fx.debris(p.x, p.y, p.z, 3, [90, 94, 104], 0.5);
          if (K.explode) PJ_explode(p);
          GS.events.push({ t: 'clink', x: p.x, y: p.y, z: p.z });
          p.dead = true; break;
        }
        // bodies
        if (p.own === 'player') {
          const e = EN_hitSegment(p.x, p.y, p.z, sx, sy, sz, K.r);
          if (e) {
            e.damage(p.dmg, p.vx, p.vz, 4);
            GS.fx.sparks(nx, ny, nz, 10, 0, 0, true);
            GS.events.push({ t: 'batHit' });
            p.dead = true; break;
          }
        } else {
          const cx = pl.b.x, cy = pl.b.y + 1.0, cz = pl.b.z;
          const t = PH_segSphere(p.x, p.y, p.z, sx, sy, sz, cx, cy, cz, 0.62 + K.r * 0.5);
          if (t >= 0) {
            if (pl.hurt(p.dmg, p.vx, p.vz, p.heavy)) { GS.fx.sparks(nx, ny, nz, 8, 0, 0, true); }
            if (K.explode) PJ_explode(p);
            p.dead = true; break;
          }
        }
        p.x = nx; p.y = ny; p.z = nz;
      }
    }
    if (!p.dead && K.trail && Math.random() < 0.7) GS.fx.add(p.x, p.y, p.z, 0, 0, 0, 0.22, 0.07, K.trail[0], K.trail[1], K.trail[2], 1.2, 0, 3, 1);
    if (p.dead) { L.splice(i, 1); }
  }
}

function PJ_draw(r) {
  for (const p of GS.projs) {
    const model = GS.models[p.K.model];
    M4_model(PJ_m, p.x, p.y, p.z, Math.atan2(p.vx, p.vz) + (p.K.spin ? 0 : 0), 0, 0, 1);
    if (p.K.spin) { M4_model(PJ_m, p.x, p.y, p.z, p.spin, 0, 0, 1); }
    else {
      const h = Math.hypot(p.vx, p.vz), pitch = -Math.atan2(p.vy, h || 1);
      M4_model(PJ_m, p.x, p.y, p.z, Math.atan2(p.vx, p.vz), pitch, 0, 1);
    }
    MD_drawModel(r, model, PJ_m, model.poseNew(), { sky: 1, moon: 1, bl: [0, 0, 0], emit: 1.0, rim: [0, 0, 0] });
  }
}
var PJ_m = new Float32Array(16);
