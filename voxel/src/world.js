// ═══════════════════════════════════════════════════════════════════════
//  WORLD — the main-thread side of the chunk system.
//
//  Decides which chunks should exist around the player, farms the baking out to
//  workers (or does it itself, a few milliseconds a frame, when workers are not
//  available), uploads the finished meshes to the GPU a few per frame so a burst
//  of arrivals never stalls a frame, and answers the questions the game asks of
//  the terrain: what block is here, what is below me, what does this ray hit.
//
//  Chunks that are not loaded count as SOLID. A player who outruns the loader
//  stops at the edge of the known world instead of falling through the floor of
//  a place that does not exist yet.
// ═══════════════════════════════════════════════════════════════════════

class VxWorld {
  constructor(gl, opts) {
    opts = opts || {};
    this.gl = gl;
    this.radius = opts.radius || 7;
    this.chunks = new Map();
    this.pending = new Set();
    this.need = [];
    this.centerKey = null;
    this.dirty = true;
    this.workers = [];
    this.mode = 'init';              // init | workers | main
    this.inflightMax = 2;
    this.uploadQ = [];
    this.job = null;                 // main-thread fallback: the chunk being baked
    this.nextId = 1;
    this.stats = { baked: 0, ms: 0, drawn: 0, tris: 0, upload: 0 };
    this.workerFailed = false;
    this.readyAt = 0;
  }

  // Try to start a pool of workers from the source text embedded in the page. Any
  // failure at all (no Worker, a blocked blob URL, a script error) drops back to
  // baking on the main thread, so the world still loads — just not off-thread.
  startWorkers(src, n) {
    if (typeof Worker === 'undefined' || !src) { this.mode = 'main'; return; }
    try {
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      let alive = 0;
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        const slot = { w: w, busy: 0, ready: false };
        w.onmessage = e => {
          const m = e.data;
          if (m.t === 'ready') { slot.ready = true; alive++; if (this.mode === 'init') this.mode = 'workers'; }
          else if (m.t === 'chunk') { slot.busy = Math.max(0, slot.busy - 1); this.uploadQ.push(m); this.stats.baked++; this.stats.ms += m.ms || 0; }
        };
        w.onerror = () => { this.workerFailed = true; };
        this.workers.push(slot);
      }
      this.readyAt = performance.now();
      this.mode = 'init';
    } catch (e) { this.mode = 'main'; this.workerFailed = true; }
  }

  // Called every frame with the player's position.
  update(px, pz, budgetMs) {
    // an init that never produced a ready worker within two seconds is a failed one
    if (this.mode === 'init' && this.workers.length && (this.workerFailed || performance.now() - this.readyAt > 2500)) {
      for (const s of this.workers) { try { s.w.terminate(); } catch (e) { } }
      this.workers = []; this.mode = 'main';
    }
    if (this.mode === 'init' && !this.workers.length) this.mode = 'main';

    this.lastX = px; this.lastZ = pz;
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    const key = JB_key(pcx, pcz);
    if (key !== this.centerKey || this.dirty) {
      this.centerKey = key; this.dirty = false;
      this.rebuildNeed(pcx, pcz);
      this.unloadFar(pcx, pcz);
    }
    if (this.mode === 'workers') this.dispatch();
    else if (this.mode === 'main') this.stepMain(budgetMs === undefined ? 5 : budgetMs);
    this.flushUploads(3);
  }

  rebuildNeed(pcx, pcz) {
    const R = this.radius, list = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const cx = pcx + dx, cz = pcz + dz, k = JB_key(cx, cz);
      if (this.chunks.has(k) || this.pending.has(k)) continue;
      list.push({ cx: cx, cz: cz, d2: d2, k: k });
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.need = list;
  }

  dispatch() {
    for (const s of this.workers) {
      if (!s.ready) continue;
      while (s.busy < this.inflightMax && this.need.length) {
        const it = this.need.shift();
        if (this.chunks.has(it.k) || this.pending.has(it.k)) continue;
        this.pending.add(it.k);
        s.busy++;
        s.w.postMessage({ t: 'bake', cx: it.cx, cz: it.cz, id: this.nextId++ });
      }
    }
  }

  // The fallback: run the bake generator for a few milliseconds a frame.
  stepMain(budgetMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!this.job) {
        let it = null;
        while (this.need.length) { const c = this.need.shift(); if (!this.chunks.has(c.k) && !this.pending.has(c.k)) { it = c; break; } }
        if (!it) return;
        this.pending.add(it.k);
        this.job = { cx: it.cx, cz: it.cz, k: it.k, gen: BX_bake(it.cx, it.cz, JB_env), t0: performance.now() };
      }
      const r = this.job.gen.next();
      if (r.done) {
        const m = JB_package(this.job.cx, this.job.cz, r.value);
        m.ms = performance.now() - this.job.t0;
        this.uploadQ.push(m); this.stats.baked++; this.stats.ms += m.ms;
        this.job = null;
      }
    }
  }

  flushUploads(max) {
    const gl = this.gl;
    let n = 0;
    while (this.uploadQ.length && n < max) {
      const m = this.uploadQ.shift(), k = JB_key(m.cx, m.cz);
      this.pending.delete(k);
      const old = this.chunks.get(k);
      if (old) this.freeChunk(old);
      const c = { cx: m.cx, cz: m.cz, key: k, vox: m.vox, top: m.top, maxY: m.maxY, emitters: m.emitters,
                  o: this.upload(m.opaque), w: this.upload(m.water) };
      this.chunks.set(k, c);
      n++; this.stats.upload++;
    }
  }

  upload(mesh) {
    if (!mesh || mesh.ni === 0) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_BYTE, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_BYTE, 16, 4);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 16, 8);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.i, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, vbo: vbo, ibo: ibo, n: mesh.ni, wide: !!mesh.wide };
  }

  freeMesh(o) {
    if (!o) return;
    const gl = this.gl;
    gl.deleteVertexArray(o.vao); gl.deleteBuffer(o.vbo); gl.deleteBuffer(o.ibo);
  }
  freeChunk(c) { this.freeMesh(c.o); this.freeMesh(c.w); }

  unloadFar(pcx, pcz) {
    const lim = (this.radius + 2) * (this.radius + 2);
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > lim) { this.freeChunk(c); this.chunks.delete(k); }
    }
  }

  // How many of the chunks the player should have are in place (0..1).
  loadedFraction() {
    const R = this.radius; let want = 0, have = 0;
    const pcx = Math.floor(this.lastX / 16) || 0, pcz = Math.floor(this.lastZ / 16) || 0;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dz * dz > R * R) continue;
      want++; if (this.chunks.has(JB_key(pcx + dx, pcz + dz))) have++;
    }
    return want ? have / want : 1;
  }

  // ── queries ─────────────────────────────────────────────────────────────
  chunkAt(x, z) { return this.chunks.get(JB_key(x >> 4, z >> 4)); }

  // Block id at integer coordinates; -1 when that chunk is not loaded.
  getBlock(x, y, z) {
    if (y < 0) return BK.BEDROCK;
    if (y >= WG_H) return 0;
    const c = this.chunks.get(JB_key(x >> 4, z >> 4));
    if (!c) return -1;
    return c.vox[((x & 15) * 16 + (z & 15)) * WG_H + y];
  }
  isSolid(x, y, z) {
    const b = this.getBlock(x, y, z);
    return b < 0 ? true : BK_SOLID[b] === 1;
  }

  // The y of the first free cell above the highest solid voxel at or below `fromY`.
  groundY(x, z, fromY) {
    const ix = Math.floor(x), iz = Math.floor(z);
    for (let y = Math.min(WG_H - 1, Math.floor(fromY)); y >= 0; y--) {
      if (this.isSolid(ix, y, iz)) return y + 1;
    }
    return 0;
  }

  // A ray through the voxels (Amanatides & Woo). Returns the first solid cell, its
  // face normal and the distance, or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let ix = Math.floor(ox), iy = Math.floor(oy), iz = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tDy = dy !== 0 ? Math.abs(1 / dy) : 1e30, tDz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
    let tx = dx > 0 ? (ix + 1 - ox) * tDx : (ox - ix) * tDx;
    let ty = dy > 0 ? (iy + 1 - oy) * tDy : (oy - iy) * tDy;
    let tz = dz > 0 ? (iz + 1 - oz) * tDz : (oz - iz) * tDz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let n = 0; n < 400; n++) {
      if (this.isSolid(ix, iy, iz)) return { x: ix, y: iy, z: iz, nx: nx, ny: ny, nz: nz, t: t };
      if (tx < ty && tx < tz) { t = tx; if (t > maxDist) return null; ix += sx; tx += tDx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { t = ty; if (t > maxDist) return null; iy += sy; ty += tDy; nx = 0; ny = -sy; nz = 0; }
      else { t = tz; if (t > maxDist) return null; iz += sz; tz += tDz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  // Draws every loaded chunk that touches the frustum with whichever mesh `which`
  // names ('o' opaque, 'w' water).
  draw(prog, planes, camX, camZ, which, maxDist) {
    const gl = this.gl, org = prog.u('uOrg');
    const lim = maxDist * maxDist;
    let drawn = 0, tris = 0;
    for (const c of this.chunks.values()) {
      const m = c[which];
      if (!m) continue;
      const x0 = c.cx * 16, z0 = c.cz * 16;
      const dx = x0 + 8 - camX, dz = z0 + 8 - camZ;
      if (dx * dx + dz * dz > lim) continue;
      if (!M4_boxVisible(planes, x0, 0, z0, x0 + 16, c.maxY + 2, z0 + 16)) continue;
      gl.uniform3f(org, x0, 0, z0);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.n, m.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      drawn++; tris += m.n / 3;
    }
    gl.bindVertexArray(null);
    if (which === 'o') { this.stats.drawn = drawn; this.stats.tris = tris; }
  }

  // Every light source near a point, packed for the glow-sprite pass:
  // x, y, z, sprite radius, r, g, b, intensity.
  collectGlow(cx, cy, cz, maxDist, out) {
    let n = 0;
    const lim = maxDist * maxDist;
    for (const c of this.chunks.values()) {
      const e = c.emitters;
      for (let i = 0; i < e.length; i++) {
        const l = e[i];
        const dx = l[0] - cx, dz = l[2] - cz;
        if (dx * dx + dz * dz > lim) continue;
        if (n >= out.length / 8) return n;
        const o = n * 8;
        out[o] = l[0]; out[o + 1] = l[1]; out[o + 2] = l[2]; out[o + 3] = 1.7;
        out[o + 4] = l[3]; out[o + 5] = l[4]; out[o + 6] = l[5]; out[o + 7] = l[6];
        n++;
      }
    }
    return n;
  }
}
