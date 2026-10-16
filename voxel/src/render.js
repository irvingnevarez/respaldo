// ═══════════════════════════════════════════════════════════════════════
//  RENDER — the camera, the frame, and the post-processing chain.
//
//  One frame, in order:  sky -> terrain -> entities -> glow -> water -> rain ->
//  beam, all into a linear-HDR target at a fraction of the screen resolution;
//  then bright-pass, a mip chain of blurs, and a composite that tone-maps and
//  grades in DISPLAY space; then FXAA, grain and dither onto the canvas.
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

class VxRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 no está disponible en este navegador');
    this.gl = gl; this.canvas = canvas;
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('OES_texture_float_linear');

    this.prog = {
      sky: GL_prog(gl, SH_SKY_VS, SH_SKY_FS, 'sky'),
      terrain: GL_prog(gl, SH_TERRAIN_VS, SH_TERRAIN_FS, 'terrain'),
      water: GL_prog(gl, SH_WATER_VS, SH_WATER_FS, 'water'),
      glow: GL_prog(gl, SH_GLOW_VS, SH_GLOW_FS, 'glow'),
      rain: GL_prog(gl, SH_RAIN_VS, SH_RAIN_FS, 'rain'),
      beam: GL_prog(gl, SH_BEAM_VS, SH_BEAM_FS, 'beam'),
      emblem: GL_prog(gl, SH_EMB_VS, SH_EMB_FS, 'emblem'),
      ent: GL_prog(gl, SH_ENT_VS, SH_ENT_FS, 'ent'),
      bright: GL_prog(gl, SH_FS_VS, SH_BRIGHT_FS, 'bright'),
      down: GL_prog(gl, SH_FS_VS, SH_DOWN_FS, 'down'),
      up: GL_prog(gl, SH_FS_VS, SH_UP_FS, 'up'),
      comp: GL_prog(gl, SH_FS_VS, SH_COMP_FS, 'comp'),
      fxaa: GL_prog(gl, SH_FS_VS, SH_FXAA_FS, 'fxaa'),
    };
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
    this.w = 0; this.h = 0; this.scale = 1;
    this.scene = null; this.ldr = null; this.bloom = [];
    this.time = 0;
    this.farDist = 416;        // where the far city ends (fog is opaque by then)
    this.nearDist = 118;       // where the detailed chunks end
    this.rain = true;
    this.beam = { on: true, p0: [0, 0, 0], p1: [0, 0, 0] };
    this.P = VxRenderer.defaults();
  }

  static defaults() {
    return {
      skyTint: [0.60, 0.70, 0.90], skyI: 2.1, blockI: 1.0,
      fog: [0.082, 0.082, 0.092], fogD: 0.020, fogK: 0.045, fogB: 0.0018, fogBase: 22, fogFar: 4.6,
      horizon: [0.046, 0.058, 0.076], zenith: [0.005, 0.009, 0.019],
      cloudH: 175, storm: 0, flash: 0,
      bevel: 1.0, wet: 1.0,
      exposure: 1.45, bloom: 0.50, bloomThr: 0.95, bloomKnee: 0.55,
      vig: 0.30, sat: 0.94, contrast: 1.06, lift: [0.003, 0.005, 0.009], gain: [1.0, 1.0, 1.02],
      grain: 0.016, rainAlpha: 0.85, rainCount: 5600, wind: 0.5, fade: 1,
      hurt: [0.6, 0.0, 0.0, 0.0],
    };
  }

  // w,h are the canvas drawing-buffer size; the scene renders at scale*size.
  resize(w, h, scale) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(h * scale));
    if (this.scene && this.scene.w === sw && this.scene.h === sh && this.w === w && this.h === h) return;
    GL_freeFbo(gl, this.scene); GL_freeFbo(gl, this.ldr);
    for (const b of this.bloom) GL_freeFbo(gl, b);
    this.w = w; this.h = h; this.scale = scale;
    const fmt = this.hdr ? 'f16' : 'u8';
    this.scene = GL_fbo(gl, sw, sh, fmt, true);
    if (!this.scene.ok && this.hdr) { this.hdr = false; GL_freeFbo(gl, this.scene); this.scene = GL_fbo(gl, sw, sh, 'u8', true); }
    this.ldr = GL_fbo(gl, w, h, 'u8', false);
    this.bloom = [];
    let bw = sw >> 1, bh = sh >> 1;
    for (let i = 0; i < 5; i++) {
      this.bloom.push(GL_fbo(gl, Math.max(2, bw), Math.max(2, bh), this.hdr ? 'f16' : 'u8', false));
      bw >>= 1; bh >>= 1;
    }
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
    gl.uniform3f(p.u('uFog'), P.fog[0], P.fog[1], P.fog[2]);
    gl.uniform1f(p.u('uFogD'), P.fogD);
    gl.uniform1f(p.u('uFogK'), P.fogK);
    gl.uniform1f(p.u('uFogB'), P.fogB);
    gl.uniform1f(p.u('uFogBase'), P.fogBase);
    gl.uniform1f(p.u('uFarDist'), this.farDist);
    gl.uniform1f(p.u('uFogFar'), P.fogFar);
  }
  fogUniforms(p) { }

  fullscreen() { const gl = this.gl; gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  // `extra(r, cam)` draws entities and anything else the game owns, inside the
  // scene pass, after the terrain and before the transparent things.
  render(cam, world, far, extra) {
    const gl = this.gl, P = this.P, S = this.scene;
    cam.aspect = this.w / this.h;
    cam.far = this.farDist + 80;
    cam.update();

    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    gl.viewport(0, 0, S.w, S.h);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    let p = this.prog.sky;
    gl.useProgram(p.id);
    gl.uniformMatrix4fv(p.u('uInvVP'), false, cam.inv);
    this.common(p, cam);
    this.fullscreen();

    // terrain
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    p = this.prog.terrain;
    gl.useProgram(p.id);
    gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
    this.common(p, cam); this.fogUniforms(p);
    gl.uniform3f(p.u('uSkyTint'), P.skyTint[0], P.skyTint[1], P.skyTint[2]);
    gl.uniform1f(p.u('uSkyI'), P.skyI);
    gl.uniform1f(p.u('uBlockI'), P.blockI);
    gl.uniform1f(p.u('uFlash'), P.flash);
    gl.uniform1f(p.u('uBevel'), P.bevel);
    gl.uniform1f(p.u('uWet'), P.wet);
    // the far city first, minus the part the detailed chunks cover
    if (far) {
      gl.uniform1f(p.u('uCut'), this.nearDist - 12);
      far.draw(p, cam.planes, cam.x, cam.z, 'o', this.farDist);
    }
    gl.uniform1f(p.u('uCut'), 0);
    world.draw(p, cam.planes, cam.x, cam.z, 'o', this.nearDist);

    if (extra) extra(this, cam);

    // lamp and neon glow
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false); gl.disable(gl.CULL_FACE);
    let n = world.collectGlow(cam.x, cam.y, cam.z, 150, this.glowData);
    if (this.extraGlow) n = this.extraGlow(this.glowData, n);
    if (n > 0) {
      p = this.prog.glow;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uRight'), cam.rx, cam.ry, cam.rz);
      gl.uniform3f(p.u('uUp'), cam.ux, cam.uy, cam.uz);
      this.common(p, cam);
      gl.bindVertexArray(this.glowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.glowData, 0, n * 8);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }

    // water: translucent, so after everything opaque
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    p = this.prog.water;
    gl.useProgram(p.id);
    gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
    this.common(p, cam); this.fogUniforms(p);
    if (far) {
      gl.uniform1f(p.u('uCut'), this.nearDist - 12);
      far.draw(p, cam.planes, cam.x, cam.z, 'w', this.farDist);
    }
    gl.uniform1f(p.u('uCut'), 0);
    world.draw(p, cam.planes, cam.x, cam.z, 'w', this.nearDist);

    // light beams: the bat-signal and the columns over lit beacons
    const beams = this.beams || (this.beam.on ? [{ p0: this.beam.p0, p1: this.beam.p1, tint: [1, 0.93, 0.62], w: 1.4, w1: 16 }] : []);
    if (beams.length) {
      gl.blendFunc(gl.ONE, gl.ONE);
      p = this.prog.beam;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCam'), cam.x, cam.y, cam.z);
      gl.uniform1f(p.u('uTime'), this.time);
      gl.uniform1f(p.u('uPulse'), 0.85 + 0.15 * Math.sin(this.time * 1.7));
      gl.bindVertexArray(this.stripVao);
      for (const bm of beams) {
        gl.uniform3f(p.u('uP0'), bm.p0[0], bm.p0[1], bm.p0[2]);
        gl.uniform3f(p.u('uP1'), bm.p1[0], bm.p1[1], bm.p1[2]);
        gl.uniform2f(p.u('uWidth'), bm.w, bm.w1);
        gl.uniform3f(p.u('uTint'), bm.tint[0], bm.tint[1], bm.tint[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // the emblem on the clouds, when the signal is up
    if (this.emblem) {
      const e = this.emblem;
      gl.blendFunc(gl.ONE, gl.ONE);
      p = this.prog.emblem;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCenter'), e.x, e.y, e.z);
      gl.uniform1f(p.u('uHalf'), e.half);
      gl.uniform1f(p.u('uPulse'), 0.85 + 0.15 * Math.sin(this.time * 1.7));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.batTex); gl.uniform1i(p.u('uBat'), 0);
      gl.bindVertexArray(this.stripVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // rain
    if (this.rain && P.rainAlpha > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      p = this.prog.rain;
      gl.useProgram(p.id);
      gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
      gl.uniform3f(p.u('uCam'), cam.x, cam.y, cam.z);
      gl.uniform1f(p.u('uTime'), this.time);
      gl.uniform1f(p.u('uCount'), P.rainCount);
      gl.uniform1f(p.u('uWind'), P.wind);
      // no rain above the cloud deck: it has nowhere to fall from
      gl.uniform1f(p.u('uAlpha'), P.rainAlpha * Math.max(0, Math.min(1, (P.cloudH + 4 - cam.y) / 45)));
      gl.bindVertexArray(this.stripVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, P.rainCount | 0);
    }
    gl.disable(gl.BLEND); gl.depthMask(true); gl.bindVertexArray(null);

    this.post();
  }

  post() {
    const gl = this.gl, P = this.P, S = this.scene, B = this.bloom;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    const bindTex = (t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };

    // bright pass into the first (half-resolution) bloom level
    let p = this.prog.bright;
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, B[0].fb); gl.viewport(0, 0, B[0].w, B[0].h);
    bindTex(S.tex, 0); gl.uniform1i(p.u('uTex'), 0);
    gl.uniform1f(p.u('uThr'), P.bloomThr); gl.uniform1f(p.u('uKnee'), P.bloomKnee);
    this.fullscreen();

    // down the chain
    p = this.prog.down;
    gl.useProgram(p.id);
    for (let i = 1; i < B.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[i].fb); gl.viewport(0, 0, B[i].w, B[i].h);
      bindTex(B[i - 1].tex, 0); gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uTexel'), 1 / B[i - 1].w, 1 / B[i - 1].h);
      this.fullscreen();
    }
    // back up, adding each level onto the one above it
    p = this.prog.up;
    gl.useProgram(p.id);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = B.length - 1; i >= 1; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[i - 1].fb); gl.viewport(0, 0, B[i - 1].w, B[i - 1].h);
      bindTex(B[i].tex, 0); gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uTexel'), 1 / B[i].w, 1 / B[i].h);
      gl.uniform1f(p.u('uMix'), 1.0);
      this.fullscreen();
    }
    gl.disable(gl.BLEND);

    // composite into an 8-bit target at canvas resolution
    p = this.prog.comp;
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldr.fb); gl.viewport(0, 0, this.w, this.h);
    bindTex(S.tex, 0); gl.uniform1i(p.u('uScene'), 0);
    bindTex(B[0].tex, 1); gl.uniform1i(p.u('uBloom'), 1);
    gl.uniform1f(p.u('uExposure'), P.exposure); gl.uniform1f(p.u('uBloomAmt'), P.bloom);
    gl.uniform1f(p.u('uVig'), P.vig); gl.uniform1f(p.u('uSat'), P.sat); gl.uniform1f(p.u('uContrast'), P.contrast);
    gl.uniform3f(p.u('uLift'), P.lift[0], P.lift[1], P.lift[2]);
    gl.uniform3f(p.u('uGain'), P.gain[0], P.gain[1], P.gain[2]);
    gl.uniform1f(p.u('uFade'), P.fade);
    gl.uniform4f(p.u('uHurt'), P.hurt[0], P.hurt[1], P.hurt[2], P.hurt[3]);
    this.fullscreen();

    // FXAA + grain onto the screen
    p = this.prog.fxaa;
    gl.useProgram(p.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    bindTex(this.ldr.tex, 0); gl.uniform1i(p.u('uTex'), 0);
    gl.uniform2f(p.u('uTexel'), 1 / this.w, 1 / this.h);
    gl.uniform1f(p.u('uGrain'), P.grain);
    gl.uniform1f(p.u('uTime'), this.time);
    this.fullscreen();
    gl.bindVertexArray(null);
  }
}
