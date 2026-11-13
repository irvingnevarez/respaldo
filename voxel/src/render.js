// ═══════════════════════════════════════════════════════════════════════
//  RENDER — the camera, the frame, and everything between the voxels and the screen.
//
//  One frame:
//    lights    lamps near the camera go into two small float textures: the list,
//              and a grid that says which of them matter where
//    env       a panorama of the sky, every few frames, for glossy reflections
//    G-BUFFER  far city, chunks, characters, particles: what each pixel IS
//    LIGHT     one fullscreen pass turns that into the lit, wet, foggy picture
//    AIR       light scattered around lamps, beams — added on top, depth-aware
//    TAA       the frame is jittered by a sub-pixel; this blends it with history
//    RAIN      after TAA, so the streaks stay crisp
//    POST      bloom pyramid, anamorphic streak, eye adaptation, tone curve,
//              grade, sharpening, grain
//
//  Everything from LIGHT to the bloom works in linear HDR at a fraction of the
//  canvas resolution; the grade and what follows are in display space.
// ═══════════════════════════════════════════════════════════════════════

class VxCamera {
  constructor() {
    this.x = 0; this.y = 60; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.fov = 1.15; this.near = 0.12; this.far = 420; this.aspect = 16 / 9;
    this.view = M4_new(); this.proj = M4_new(); this.vp = M4_new(); this.inv = M4_new();
    this.planes = new Float32Array(24);
    this.fx = 0; this.fy = 0; this.fz = -1;      // forward
    this.rx = 1; this.ry = 0; this.rz = 0;       // right
    this.ux = 0; this.uy = 1; this.uz = 0;       // up
  }
  // yaw 0 looks down -z; positive yaw turns right (towards +x)
  update() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.fx = sy * cp; this.fy = sp; this.fz = -cy * cp;
    this.rx = cy; this.ry = 0; this.rz = sy;
    this.ux = this.ry * this.fz - this.rz * this.fy; this.uy = this.rz * this.fx - this.rx * this.fz; this.uz = this.rx * this.fy - this.ry * this.fx;
    // right x forward points down for a right-handed camera, so flip to get up
    this.ux = -this.ux; this.uy = -this.uy; this.uz = -this.uz;
    M4_persp(this.proj, this.fov, this.aspect, this.near, this.far);
    M4_look(this.view, this.x, this.y, this.z, this.x + this.fx, this.y + this.fy, this.z + this.fz, 0, 1, 0);
    M4_mul(this.vp, this.proj, this.view);
    M4_inv(this.inv, this.vp);
    M4_planes(this.planes, this.vp);
  }
}

var RD_MAXL = 512;            // lamps in the list
var RD_CELL = 12;             // lamps per grid cell
// sub-pixel offsets, Halton(2,3)
var RD_JIT = (function () {
  const h = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  const a = [];
  for (let i = 1; i <= 16; i++) a.push(h(i, 2) - 0.5, h(i, 3) - 0.5);
  return a;
})();

class VxRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 no está disponible en este navegador');
    this.gl = gl; this.canvas = canvas;
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('OES_texture_float_linear');

    this.prog = {
      gbuf: GL_prog(gl, SH_GBUF_VS, SH_gbufFS(false), 'gbuf'),
      gbufFar: GL_prog(gl, SH_GBUF_VS, SH_gbufFS(true), 'gbufFar'),
      ent: GL_prog(gl, SH_ENT_VS, SH_ENT_FS, 'ent'),
      env: GL_prog(gl, SH_POST_VS, SH_ENV_FS, 'env'),
      rain: GL_prog(gl, SH_RAIN_VS, SH_RAIN_FS, 'rain'),
      splash: GL_prog(gl, SH_SPLASH_VS, SH_SPLASH_FS, 'splash'),
      beam: GL_prog(gl, SH_BEAM_VS, SH_BEAM_FS, 'beam'),
      emblem: GL_prog(gl, SH_EMB_VS, SH_EMB_FS, 'emblem'),
      taa: GL_prog(gl, SH_POST_VS, SH_TAA_FS, 'taa'),
      down: GL_prog(gl, SH_POST_VS, SH_DOWN_FS, 'down'),
      up: GL_prog(gl, SH_POST_VS, SH_UP_FS, 'up'),
      streak: GL_prog(gl, SH_POST_VS, SH_STREAK_FS, 'streak'),
      expo: GL_prog(gl, SH_POST_VS, SH_EXPO_FS, 'expo'),
      comp: GL_prog(gl, SH_POST_VS, SH_COMP_FS, 'comp'),
    };
    this.variants = {};          // programs compiled per quality setting, on first use
    this.emptyVao = gl.createVertexArray();

    // unit quads: a centred one for sprites, a strip for streaks and beams
    this.quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.stripVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.glowData = new Float32Array(8 * 640);
    this.glowVbo = gl.createBuffer();
    this.glowVao = gl.createVertexArray();
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.glowData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.stripVao = gl.createVertexArray();
    gl.bindVertexArray(this.stripVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    // the bat symbol as a tiny nearest-filtered bitmap
    const BAT = [".............#...#.............", "#...........##...##...........#", "####........##...##........####", "######......#######......######", "########....#######....########", "##########..#######..##########", "###############################", "###.#######################.###", ".##.###.###.#######.###.###.##.", ".#...#...#...#####...#...#...#.", ".........#....###....#.........", "..............###..............", "...............................", "...............................", "..............................."];
    const bd = new Uint8Array(32 * 16);
    BAT.forEach(function (row, j) { for (let i = 0; i < 31; i++) if (row[i] === '#') bd[j * 32 + i] = 255; });
    this.batTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.batTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 32, 16, 0, gl.RED, gl.UNSIGNED_BYTE, bd);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // procedural textures
    this.noiseA = TX_make(gl, 256, 256, TX_noiseA(256), true, true);
    this.noiseB = TX_make(gl, 256, 256, TX_noiseB(256), true, true);
    this.lut = TX_make(gl, 256, 4, TX_lut(), false, false);
    this.blackTex = TX_make(gl, 1, 1, new Uint8Array([0, 0, 0, 255]), false, false);

    // lamps: the list and the grid
    this.lightData = new Float32Array(RD_MAXL * 2 * 4);
    this.gridData = new Float32Array(96 * 32 * 4);
    this.lightTex = this.floatTex(RD_MAXL, 2, this.lightData);
    this.gridTex = this.floatTex(96, 32, this.gridData);
    this.lightKey = '';
    this.volStatic = new Float32Array(8 * 560); this.volN = 0;
    this.dyn = new Float32Array(32); this.dynC = new Float32Array(32); this.dynN = 0;
    this.caps = [];              // filled by the game: { x, y, z, h, lx, ly, lz, s }
    this.capA = new Float32Array(32); this.capL = new Float32Array(32);

    // the sky panorama
    this.env = GL_fbo(gl, 256, 128, this.hdr ? 'f16' : 'u8', false);
    gl.bindTexture(gl.TEXTURE_2D, this.env.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.envReady = false;

    this.w = 0; this.h = 0; this.scale = 1;
    this.G = null; this.lit = null; this.post = null; this.hist = []; this.taaFb = []; this.ldr = null;
    this.bloom = []; this.streak = []; this.expo = [];
    this.hi = 0; this.ei = 0; this.histValid = false;
    this.projJ = M4_new(); this.vpj = M4_new(); this.invj = M4_new(); this.prevVp = M4_new();
    this.time = 0; this.frame = 0;
    this.farDist = 416;        // where the far city ends (fog is opaque by then)
    this.nearDist = 118;       // where the detailed chunks end
    this.rain = true;
    this.beam = { on: true, p0: [0, 0, 0], p1: [0, 0, 0] };
    this.P = VxRenderer.defaults();
    this.Q = { taa: 1, ssr: 28, vol: 4, lights: 12, detail: 1, caps: 1, splash: 900, streak: 1 };
    this.stats = { lights: 0, vol: 0 };
    // GPU time per frame, where the browser will tell us (it is what the quality
    // ladder steers by; 0 means unknown)
    this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.tqPending = []; this.tqCur = null; this.gpuMs = 0;
  }

  timeBegin() {
    const gl = this.gl, ext = this.tq;
    if (!ext) return;
    while (this.tqPending.length) {
      const q = this.tqPending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.gpuMs = this.gpuMs > 0 ? this.gpuMs * 0.9 + ms * 0.1 : ms;
      }
      gl.deleteQuery(q); this.tqPending.shift();
    }
    if (this.tqPending.length < 3) { this.tqCur = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, this.tqCur); }
  }
  timeEnd() {
    if (!this.tqCur) return;
    this.gl.endQuery(this.tq.TIME_ELAPSED_EXT);
    this.tqPending.push(this.tqCur); this.tqCur = null;
  }

  static defaults() {
    return {
      skyTint: [0.60, 0.70, 0.90], skyI: 2.1, blockI: 1.0,
      fog: [0.082, 0.082, 0.092], fogD: 0.020, fogK: 0.045, fogB: 0.0018, fogBase: 22, fogFar: 4.6,
      horizon: [0.046, 0.058, 0.076], zenith: [0.005, 0.009, 0.019],
      cloudH: 175, storm: 0, flash: 0,
      bevel: 0.6, wet: 1.0, spec: 0.55, vol: 0.034, rainLit: 0.55,
      exposure: 2.3, autoExp: 1, expKey: 0.060, bloom: 0.50, streak: 0.5, ca: 0.0011, sharp: 0.45,
      bloomThr: 0.95, bloomKnee: 0.55,
      vig: 0.30, sat: 0.96, contrast: 1.06, lift: [0.003, 0.005, 0.009], gain: [1.0, 1.0, 1.02],
      grain: 0.020, rainAlpha: 0.85, rainCount: 5600, wind: 0.5, fade: 1,
      hurt: [0.6, 0.0, 0.0, 0.0],
    };
  }

  floatTex(w, h, data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // The G-buffer: four colour targets and a depth TEXTURE, because every later
  // pass reads the depth.
  makeG(w, h) {
    const gl = this.gl, fb = gl.createFramebuffer(), tex = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (let i = 0; i < 4; i++) {
      const t = GL_tex(gl, w, h, 'u8', false);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      tex.push(t);
    }
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: fb, tex: tex, depth: depth, w: w, h: h, ok: ok };
  }

  // w,h are the canvas drawing-buffer size; the scene renders at scale*size.
  resize(w, h, scale) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(h * scale));
    if (this.G && this.G.w === sw && this.G.h === sh && this.w === w && this.h === h) return;
    if (this.G) { gl.deleteFramebuffer(this.G.fb); for (const t of this.G.tex) gl.deleteTexture(t); gl.deleteTexture(this.G.depth); }
    for (const f of [this.lit, this.post, this.ldr].concat(this.hist, this.bloom, this.streak, this.expo)) GL_freeFbo(gl, f);
    for (const f of this.taaFb) gl.deleteFramebuffer(f);
    this.w = w; this.h = h; this.scale = scale;
    let fmt = this.hdr ? 'f16' : 'u8';
    this.G = this.makeG(sw, sh);
    this.lit = GL_fbo(gl, sw, sh, fmt, false);
    if (!this.lit.ok && this.hdr) { this.hdr = false; fmt = 'u8'; GL_freeFbo(gl, this.lit); this.lit = GL_fbo(gl, sw, sh, fmt, false); }
    this.post = GL_fbo(gl, sw, sh, fmt, false);
    this.hist = [GL_fbo(gl, sw, sh, fmt, false), GL_fbo(gl, sw, sh, fmt, false)];
    // the TAA pass writes the new history and the picture that goes on to post in one go
    this.taaFb = [];
    for (let i = 0; i < 2; i++) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hist[i].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.post.tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      this.taaFb.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.ldr = GL_fbo(gl, w, h, 'u8', false);
    this.bloom = [];
    let bw = sw >> 1, bh = sh >> 1;
    for (let i = 0; i < 6; i++) {
      this.bloom.push(GL_fbo(gl, Math.max(2, bw), Math.max(2, bh), fmt, false));
      bw >>= 1; bh >>= 1;
    }
    this.streak = [GL_fbo(gl, this.bloom[1].w, this.bloom[1].h, fmt, false), GL_fbo(gl, this.bloom[1].w, this.bloom[1].h, fmt, false)];
    this.expo = [GL_fbo(gl, 1, 1, fmt, false), GL_fbo(gl, 1, 1, fmt, false)];
    for (const e of this.expo) { gl.bindFramebuffer(gl.FRAMEBUFFER, e.fb); gl.clearColor(0.5, 0.5, 0.5, 0.5); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.histValid = false; this.expoValid = false;
  }

  // Programs that depend on the quality settings, compiled when first needed.
  variant(kind) {
    const Q = this.Q, gl = this.gl;
    let key, make;
    if (kind === 'light') {
      const lt = Math.max(1, Math.min(3, Math.ceil(Q.lights / 4)));
      const ssr = (Q.ssr && Q.taa && this.hdr) ? Q.ssr : 0;
      key = 'light:' + ssr + ':' + lt + ':' + (Q.detail ? 1 : 0) + ':' + (Q.caps ? 1 : 0);
      make = () => GL_prog(gl, SH_FS_VS, SH_lightFS((ssr ? '#define Q_SSR ' + ssr + '\n' : '') + '#define Q_LTEX ' + lt + '\n' +
        (Q.detail ? '#define Q_DETAIL 1\n' : '') + (Q.caps ? '#define Q_CAPS 1\n' : '')), key);
    } else if (kind === 'vol') {
      const n = Math.max(1, Q.vol | 0), jit = Q.taa ? 1 : 0;
      key = 'vol:' + n + ':' + jit;
      make = () => GL_prog(gl, SH_VOL_VS, SH_volFS('#define Q_VOL ' + n + '\n' + (jit ? '#define Q_JIT 1\n' : '')), key);
    } else {
      const fxaa = Q.taa ? 0 : 1;
      key = 'final:' + fxaa;
      make = () => GL_prog(gl, SH_POST_VS, SH_finalFS(!!fxaa), key);
    }
    return this.variants[key] || (this.variants[key] = make());
  }

  // Set the uniforms every sky-aware program shares.
  common(p, cam) {
    const gl = this.gl, P = this.P;
    gl.uniform3f(p.u('uCam'), cam.x, cam.y, cam.z);
    gl.uniform3f(p.u('uMoonDir'), BX_MOON.x, BX_MOON.y, BX_MOON.z);
    gl.uniform3f(p.u('uHorizon'), P.horizon[0], P.horizon[1], P.horizon[2]);
    gl.uniform3f(p.u('uZenith'), P.zenith[0], P.zenith[1], P.zenith[2]);
    gl.uniform1f(p.u('uTime'), this.time);
    gl.uniform1f(p.u('uCloudH'), P.cloudH);
    gl.uniform1f(p.u('uStorm'), P.storm);
    gl.uniform1f(p.u('uBolt'), P.flash);
    gl.uniform3f(p.u('uFog'), P.fog[0], P.fog[1], P.fog[2]);
    gl.uniform1f(p.u('uFogD'), P.fogD);
    gl.uniform1f(p.u('uFogK'), P.fogK);
    gl.uniform1f(p.u('uFogB'), P.fogB);
    gl.uniform1f(p.u('uFogBase'), P.fogBase);
    gl.uniform1f(p.u('uFarDist'), this.farDist);
    gl.uniform1f(p.u('uFogFar'), P.fogFar);
  }

  tex(p, name, unit, t) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.u(name), unit); }
  fullscreen() { const gl = this.gl; gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  resetHistory() { this.histValid = false; }

  // ── lamps ───────────────────────────────────────────────────────────────
  // Rebuilt only when chunks arrive or leave, or the camera crosses into another
  // grid cell: a few hundred lamps sorted into a 32 x 32 grid is nothing.
  updateLights(world, cam) {
    const ccx = Math.floor(cam.x / 16), ccz = Math.floor(cam.z / 16);
    const key = (world.lightVer || 0) + ':' + ccx + ':' + ccz;
    if (key === this.lightKey) return;
    this.lightKey = key;
    const gl = this.gl, L = this.lightData, Gd = this.gridData;
    let list = [];
    for (const c of world.chunks.values()) {
      const e = c.emitters;
      for (let i = 0; i < e.length; i++) {
        const dx = e[i][0] - cam.x, dz = e[i][2] - cam.z, d2 = dx * dx + dz * dz;
        if (d2 < 236 * 236) list.push({ e: e[i], d2: d2 });
      }
    }
    if (list.length > RD_MAXL) { list.sort((a, b) => a.d2 - b.d2); list.length = RD_MAXL; }
    const cells = this.cells || (this.cells = Array.from({ length: 1024 }, () => []));
    for (let i = 0; i < 1024; i++) cells[i].length = 0;
    let nv = 0;
    const VS = this.volStatic;
    for (let i = 0; i < list.length; i++) {
      const e = list[i].e, I = e[6], R = e[7], kind = e[8] || 0;
      L[i * 4] = e[0]; L[i * 4 + 1] = e[1]; L[i * 4 + 2] = e[2]; L[i * 4 + 3] = R;
      const o = (RD_MAXL + i) * 4;
      L[o] = e[3] * I; L[o + 1] = e[4] * I; L[o + 2] = e[5] * I; L[o + 3] = kind;
      const Rs = R * 2.4;
      const x0 = Math.floor((e[0] - Rs) / 16), x1 = Math.floor((e[0] + Rs) / 16), z0 = Math.floor((e[2] - Rs) / 16), z1 = Math.floor((e[2] + Rs) / 16);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        if (Math.abs(cx - ccx) > 15 || Math.abs(cz - ccz) > 15) continue;
        const ddx = Math.max(cx * 16 - e[0], 0, e[0] - cx * 16 - 16), ddz = Math.max(cz * 16 - e[2], 0, e[2] - cz * 16 - 16);
        if (ddx * ddx + ddz * ddz > Rs * Rs) continue;
        cells[(cz & 31) * 32 + (cx & 31)].push(i);
      }
      // its glow in the air
      if (nv < 560 && list[i].d2 < 190 * 190 && e[9] !== 0) {
        const q = nv++ * 8, vr = e[9] || (kind === 0 ? 10 : 6.5);
        VS[q] = e[0]; VS[q + 1] = e[1]; VS[q + 2] = e[2]; VS[q + 3] = vr;
        VS[q + 4] = e[3] * I; VS[q + 5] = e[4] * I; VS[q + 6] = e[5] * I; VS[q + 7] = kind;
      }
    }
    this.volN = nv;
    for (let c = 0; c < 1024; c++) {
      const a = cells[c], cx = c & 31, cz = c >> 5;
      if (a.length > RD_CELL) {
        // keep the nearest to the cell's middle; world position of the cell follows from the camera's
        const wx = (ccx + ((cx - ccx) & 31) - (((cx - ccx) & 31) > 15 ? 32 : 0)) * 16 + 8, wz = (ccz + ((cz - ccz) & 31) - (((cz - ccz) & 31) > 15 ? 32 : 0)) * 16 + 8;
        a.sort((p, q) => (Math.hypot(L[p * 4] - wx, L[p * 4 + 2] - wz) - L[p * 4 + 3] * 0.5) - (Math.hypot(L[q * 4] - wx, L[q * 4 + 2] - wz) - L[q * 4 + 3] * 0.5));
      }
      const o = (cz * 96 + cx * 3) * 4;
      for (let k = 0; k < RD_CELL; k++) Gd[o + k] = k < a.length ? a[k] : -1;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RD_MAXL, 2, gl.RGBA, gl.FLOAT, L);
    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 96, 32, gl.RGBA, gl.FLOAT, Gd);
    this.stats.lights = list.length;
  }

  // Lights that move come from the game as glow records (x y z radius r g b
  // intensity). The strongest few light the scene; all of them glow in the air.
  updateDynamic(cam) {
    const D = this.glowData;
    let n = this.extraGlow ? this.extraGlow(D, 0) : 0;
    const pick = [];
    for (let i = 0; i < n; i++) {
      const o = i * 8, d = Math.hypot(D[o] - cam.x, D[o + 1] - cam.y, D[o + 2] - cam.z);
      pick.push({ o: o, w: D[o + 7] * D[o + 3] / (8 + d) });
    }
    pick.sort((a, b) => b.w - a.w);
    this.dynN = Math.min(8, pick.length);
    for (let i = 0; i < this.dynN; i++) {
      const o = pick[i].o, I = D[o + 7];
      this.dyn[i * 4] = D[o]; this.dyn[i * 4 + 1] = D[o + 1]; this.dyn[i * 4 + 2] = D[o + 2]; this.dyn[i * 4 + 3] = Math.max(4, D[o + 3] * 2.6);
      this.dynC[i * 4] = D[o + 4] * I * 0.9; this.dynC[i * 4 + 1] = D[o + 5] * I * 0.9; this.dynC[i * 4 + 2] = D[o + 6] * I * 0.9; this.dynC[i * 4 + 3] = 0;
    }
    // the instance buffer for the air pass: moving glows first, then the lamps
    for (let i = 0; i < n; i++) {
      const o = i * 8, I = D[o + 7] * 0.9;
      D[o + 3] = Math.max(2.5, D[o + 3] * 1.7); D[o + 4] *= I; D[o + 5] *= I; D[o + 6] *= I; D[o + 7] = 1;
    }
    const room = Math.min(this.volN, 640 - n);
    D.set(this.volStatic.subarray(0, room * 8), n * 8);
    return n + room;
  }

  updateEnv(cam) {
    if (this.envReady && this.frame % 6 !== 0 && this.P.flash < 0.01) return;
    const gl = this.gl, p = this.prog.env;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.env.fb); gl.viewport(0, 0, this.env.w, this.env.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.useProgram(p.id);
    this.common(p, cam);
    this.tex(p, 'uNoiseA', 0, this.noiseA);
    this.fullscreen();
    gl.bindTexture(gl.TEXTURE_2D, this.env.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.envReady = true;
  }

  // `extra(r, cam)` draws entities and anything else the game owns, into the
  // G-buffer, after the terrain.
  render(cam, world, far, extra) {
    const gl = this.gl, P = this.P, Q = this.Q, G = this.G, W = G.w, H = G.h;
    this.timeBegin();
    cam.aspect = this.w / this.h;
    cam.far = this.farDist + 80;
    cam.update();
    this.frame++;
    const taa = !!Q.taa;
    let jx = 0, jy = 0;
    if (taa) { const i = this.frame % 16; jx = RD_JIT[i * 2] * 2 / W; jy = RD_JIT[i * 2 + 1] * 2 / H; }
    this.projJ.set(cam.proj); this.projJ[8] -= jx; this.projJ[9] -= jy;
    M4_mul(this.vpj, this.projJ, cam.view);
    M4_inv(this.invj, this.vpj);
    if (!this.histValid) this.prevVp.set(cam.vp);
    // the game's own draw calls read cam.vp: give them the jittered one for the scene
    const vpClean = cam.vp;
    cam.vp = this.vpj;

    this.updateLights(world, cam);
    const nVol = this.updateDynamic(cam);
    this.updateEnv(cam);

    // ── G-buffer ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    let p;
    if (far) {
      // the far city, minus the part the detailed chunks cover
      p = this.prog.gbufFar;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCam'), cam.x, cam.y, cam.z);
      gl.uniform1f(p.u('uCut'), this.nearDist - 12);
      far.draw(p, cam.planes, cam.x, cam.z, 'o', this.farDist);
      far.draw(p, cam.planes, cam.x, cam.z, 'w', this.farDist);
    }
    p = this.prog.gbuf;
    gl.useProgram(p.id);
    gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
    world.draw(p, cam.planes, cam.x, cam.z, 'o', this.nearDist);
    world.draw(p, cam.planes, cam.x, cam.z, 'w', this.nearDist);
    if (extra) extra(this, cam);

    // ── light ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lit.fb);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    p = this.variant('light');
    gl.useProgram(p.id);
    this.common(p, cam);
    gl.uniformMatrix4fv(p.u('uInvVP'), false, this.invj);
    gl.uniformMatrix4fv(p.u('uVPj'), false, this.vpj);
    gl.uniformMatrix4fv(p.u('uPrevVP'), false, this.prevVp);
    this.tex(p, 'uG0', 0, G.tex[0]); this.tex(p, 'uG1', 1, G.tex[1]); this.tex(p, 'uG2', 2, G.tex[2]); this.tex(p, 'uG3', 3, G.tex[3]);
    this.tex(p, 'uDepth', 4, G.depth);
    this.tex(p, 'uNoiseA', 5, this.noiseA); this.tex(p, 'uNoiseB', 6, this.noiseB); this.tex(p, 'uLut', 7, this.lut);
    this.tex(p, 'uLights', 8, this.lightTex); this.tex(p, 'uGrid', 9, this.gridTex);
    this.tex(p, 'uTop', 10, world.topTex || this.blackTex);
    this.tex(p, 'uHist', 11, this.histValid ? this.hist[this.hi].tex : this.blackTex);
    this.tex(p, 'uEnv', 12, this.env.tex);
    gl.uniform2f(p.u('uNF'), cam.near, cam.far);
    gl.uniform1f(p.u('uPix'), 2 * Math.tan(cam.fov / 2) / H);
    gl.uniform1f(p.u('uFrame'), this.frame % 64);
    gl.uniform3f(p.u('uSkyTint'), P.skyTint[0], P.skyTint[1], P.skyTint[2]);
    gl.uniform1f(p.u('uSkyI'), P.skyI);
    gl.uniform1f(p.u('uBlockI'), P.blockI);
    gl.uniform1f(p.u('uBevel'), P.bevel);
    gl.uniform1f(p.u('uWet'), P.wet);
    gl.uniform1f(p.u('uRain'), this.rain ? Math.min(1, P.rainAlpha * 1.2) : 0);
    gl.uniform1f(p.u('uBase'), WG_BASE);
    gl.uniform1f(p.u('uNear'), this.nearDist - 14);
    gl.uniform1f(p.u('uSpec'), P.spec);
    gl.uniform4fv(p.u('uDyn[0]'), this.dyn); gl.uniform4fv(p.u('uDynC[0]'), this.dynC); gl.uniform1i(p.u('uDynN'), this.dynN);
    const nc = Math.min(8, this.caps.length);
    for (let i = 0; i < nc; i++) {
      const c = this.caps[i];
      this.capA[i * 4] = c.x; this.capA[i * 4 + 1] = c.y; this.capA[i * 4 + 2] = c.z; this.capA[i * 4 + 3] = c.h;
      this.capL[i * 4] = c.lx; this.capL[i * 4 + 1] = c.ly; this.capL[i * 4 + 2] = c.lz; this.capL[i * 4 + 3] = c.s;
    }
    gl.uniform4fv(p.u('uCap[0]'), this.capA); gl.uniform4fv(p.u('uCapL[0]'), this.capL); gl.uniform1i(p.u('uCapN'), nc);
    this.fullscreen();

    // ── light in the air, beams ──
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (nVol > 0 && Q.vol > 0 && P.vol > 0) {
      p = this.variant('vol');
      gl.useProgram(p.id);
      this.common(p, cam);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniformMatrix4fv(p.u('uInvVP'), false, this.invj);
      gl.uniform3f(p.u('uRight'), cam.rx, cam.ry, cam.rz);
      gl.uniform3f(p.u('uUp'), cam.ux, cam.uy, cam.uz);
      gl.uniform2f(p.u('uInvRes'), 1 / W, 1 / H);
      gl.uniform2f(p.u('uNF'), cam.near, cam.far);
      gl.uniform1f(p.u('uFrame'), this.frame % 64);
      gl.uniform1f(p.u('uVolK'), P.vol * (0.75 + 0.5 * Math.min(1, P.rainAlpha)));
      this.tex(p, 'uDepth', 0, G.depth);
      gl.bindVertexArray(this.glowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.glowData, 0, nVol * 8);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nVol);
      this.stats.vol = nVol;
    }
    const beams = this.beams || (this.beam.on ? [{ p0: this.beam.p0, p1: this.beam.p1, tint: [1, 0.93, 0.62], w: 1.4, w1: 16 }] : []);
    if (beams.length) {
      p = this.prog.beam;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCam'), cam.x, cam.y, cam.z);
      gl.uniform1f(p.u('uTime'), this.time);
      gl.uniform1f(p.u('uPulse'), 0.85 + 0.15 * Math.sin(this.time * 1.7));
      gl.uniform2f(p.u('uNF'), cam.near, cam.far);
      this.tex(p, 'uDepth', 0, G.depth); this.tex(p, 'uNoiseA', 1, this.noiseA);
      gl.bindVertexArray(this.stripVao);
      for (const bm of beams) {
        gl.uniform3f(p.u('uP0'), bm.p0[0], bm.p0[1], bm.p0[2]);
        gl.uniform3f(p.u('uP1'), bm.p1[0], bm.p1[1], bm.p1[2]);
        gl.uniform2f(p.u('uWidth'), bm.w, bm.w1);
        gl.uniform3f(p.u('uTint'), bm.tint[0], bm.tint[1], bm.tint[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    if (this.emblem) {
      const e = this.emblem;
      p = this.prog.emblem;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCenter'), e.x, e.y, e.z);
      gl.uniform1f(p.u('uHalf'), e.half);
      gl.uniform1f(p.u('uPulse'), 0.85 + 0.15 * Math.sin(this.time * 1.7));
      this.tex(p, 'uBat', 0, this.batTex); this.tex(p, 'uDepth', 1, G.depth);
      gl.bindVertexArray(this.stripVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    cam.vp = vpClean;

    // ── temporal anti-aliasing ──
    let scene = this.lit;
    if (taa) {
      const to = 1 - this.hi;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.taaFb[to]);
      gl.viewport(0, 0, W, H);
      p = this.prog.taa;
      gl.useProgram(p.id);
      this.tex(p, 'uCur', 0, this.lit.tex); this.tex(p, 'uHist', 1, this.hist[this.hi].tex); this.tex(p, 'uDepth', 2, G.depth);
      gl.uniformMatrix4fv(p.u('uInvVPj'), false, this.invj);
      gl.uniformMatrix4fv(p.u('uPrevVP'), false, this.prevVp);
      gl.uniform2f(p.u('uTexel'), 1 / W, 1 / H);
      gl.uniform1f(p.u('uBlend'), this.histValid ? 0.90 : 0.0);
      this.fullscreen();
      this.hi = to;
      scene = this.post;
    }
    this.prevVp.set(vpClean);
    this.histValid = taa;

    // ── rain, on top of the settled picture ──
    if (this.rain && P.rainAlpha > 0) {
      // no rain above the cloud deck: it has nowhere to fall from
      const alpha = P.rainAlpha * Math.max(0, Math.min(1, (P.cloudH + 4 - cam.y) / 45));
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const set = (q) => {
        gl.useProgram(q.id);
        gl.uniformMatrix4fv(q.u('uVP'), false, cam.vp);
        gl.uniform3f(q.u('uCam'), cam.x, cam.y, cam.z);
        gl.uniform1f(q.u('uTime'), this.time);
        gl.uniform1f(q.u('uAlpha'), alpha);
        gl.uniform3f(q.u('uAmb'), P.skyTint[0] * 0.040 * (1 + P.flash * 8), P.skyTint[1] * 0.040 * (1 + P.flash * 8), P.skyTint[2] * 0.040 * (1 + P.flash * 8));
        gl.uniform1f(q.u('uRainLit'), P.rainLit);
        gl.uniform4fv(q.u('uDyn[0]'), this.dyn); gl.uniform4fv(q.u('uDynC[0]'), this.dynC); gl.uniform1i(q.u('uDynN'), this.dynN);
        this.tex(q, 'uDepth', 0, G.depth); this.tex(q, 'uTop', 1, world.topTex || this.blackTex);
        this.tex(q, 'uLights', 2, this.lightTex); this.tex(q, 'uGrid', 3, this.gridTex);
      };
      if (alpha > 0) {
        p = this.prog.rain;
        set(p);
        gl.uniform1f(p.u('uWind'), P.wind);
        gl.bindVertexArray(this.stripVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, P.rainCount | 0);
        if (Q.splash > 0) {
          p = this.prog.splash;
          set(p);
          gl.uniform3f(p.u('uRight'), cam.rx, cam.ry, cam.rz);
          gl.bindVertexArray(this.quadVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Q.splash | 0);
        }
      }
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    this.post2(scene);
  }

  post2(S) {
    const gl = this.gl, P = this.P, Q = this.Q, B = this.bloom;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    // the pyramid: down...
    let p = this.prog.down;
    gl.useProgram(p.id);
    for (let i = 0; i < B.length; i++) {
      const src = i === 0 ? S : B[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[i].fb); gl.viewport(0, 0, B[i].w, B[i].h);
      this.tex(p, 'uTex', 0, src.tex);
      gl.uniform2f(p.u('uTexel'), 1 / src.w, 1 / src.h);
      gl.uniform1f(p.u('uKaris'), i === 0 ? 1 : 0);
      this.fullscreen();
    }
    // the eye, from the smallest level (the scene's average)
    const en = 1 - this.ei;
    p = this.prog.expo;
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.expo[en].fb); gl.viewport(0, 0, 1, 1);
    this.tex(p, 'uTex', 0, B[B.length - 1].tex); this.tex(p, 'uPrev', 1, this.expo[this.ei].tex);
    gl.uniform1f(p.u('uKey'), P.expKey);
    gl.uniform1f(p.u('uRate'), this.expoValid ? 0.05 : 1.0);
    gl.uniform2f(p.u('uRange'), P.autoExp ? 0.36 : 0.5, P.autoExp ? 0.80 : 0.5);
    this.fullscreen();
    this.ei = en; this.expoValid = true;

    // the streak: the brightest lights, smeared sideways in three widening passes
    const ST = this.streak;
    const streak = Q.streak && P.streak > 0;
    if (streak) {
      p = this.prog.streak;
      gl.useProgram(p.id);
      const steps = [[B[1], ST[0], 1.6, 3.0], [ST[0], ST[1], 4.5, 0], [ST[1], ST[0], 12.0, 0]];
      for (const s of steps) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s[1].fb); gl.viewport(0, 0, s[1].w, s[1].h);
        this.tex(p, 'uTex', 0, s[0].tex);
        gl.uniform2f(p.u('uDir'), s[2] / s[0].w, 0);
        gl.uniform1f(p.u('uThr'), s[3]);
        this.fullscreen();
      }
    }
    // ...and back up, each level added onto the one above
    p = this.prog.up;
    gl.useProgram(p.id);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = B.length - 1; i >= 1; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[i - 1].fb); gl.viewport(0, 0, B[i - 1].w, B[i - 1].h);
      this.tex(p, 'uTex', 0, B[i].tex);
      gl.uniform2f(p.u('uTexel'), 1 / B[i].w, 1 / B[i].h);
      gl.uniform1f(p.u('uMix'), 1.0);
      this.fullscreen();
    }
    gl.disable(gl.BLEND);

    // composite into an 8-bit target at canvas resolution
    p = this.prog.comp;
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldr.fb); gl.viewport(0, 0, this.w, this.h);
    this.tex(p, 'uScene', 0, S.tex); this.tex(p, 'uBloom', 1, B[0].tex);
    this.tex(p, 'uStreak', 2, streak ? ST[0].tex : this.blackTex); this.tex(p, 'uExpo', 3, this.expo[this.ei].tex);
    gl.uniform1f(p.u('uExposure'), P.exposure * 2.0);
    // the pyramid is the SUM of its levels; divide it back into an average
    gl.uniform1f(p.u('uBloomAmt'), P.bloom * 0.11 / B.length);
    gl.uniform1f(p.u('uStreakAmt'), P.streak * 0.05);
    gl.uniform1f(p.u('uCA'), P.ca);
    gl.uniform1f(p.u('uVig'), P.vig); gl.uniform1f(p.u('uSat'), P.sat); gl.uniform1f(p.u('uContrast'), P.contrast);
    gl.uniform3f(p.u('uLift'), P.lift[0], P.lift[1], P.lift[2]);
    gl.uniform3f(p.u('uGain'), P.gain[0], P.gain[1], P.gain[2]);
    gl.uniform1f(p.u('uFade'), P.fade);
    gl.uniform4f(p.u('uHurt'), P.hurt[0], P.hurt[1], P.hurt[2], P.hurt[3]);
    this.fullscreen();

    // sharpen (or FXAA), grain and dither onto the screen
    p = this.variant('final');
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    this.tex(p, 'uTex', 0, this.ldr.tex);
    gl.uniform2f(p.u('uTexel'), 1 / this.w, 1 / this.h);
    gl.uniform1f(p.u('uGrain'), P.grain);
    gl.uniform1f(p.u('uTime'), this.time);
    gl.uniform1f(p.u('uSharp'), P.sharp);
    this.fullscreen();
    gl.bindVertexArray(null);
    this.timeEnd();
  }
}
