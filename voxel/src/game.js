// ═══════════════════════════════════════════════════════════════════════
//  GAME — boot, the frame loop, and the hooks the test tools use.
// ═══════════════════════════════════════════════════════════════════════

var VX = {
  rend: null, world: null, far: null, cam: null,
  hud: null, hudCtx: null,
  time: 0, last: 0, frame: 0,
  quality: 2, scale: 1, radius: 8,
  booted: false, capture: false,
};

function VX_size() {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  return { w: Math.max(64, Math.round(r.width * dpr)), h: Math.max(64, Math.round(r.height * dpr)), cssW: r.width, cssH: r.height, dpr: dpr };
}

function VX_resize() {
  const s = VX_size();
  VX.rend.resize(s.w, s.h, VX.scale);
  const hud = VX.hud;
  if (hud.width !== s.w || hud.height !== s.h) { hud.width = s.w; hud.height = s.h; }
}

function VX_boot() {
  VX.capture = !!window.__capture;
  const canvas = document.getElementById('gl');
  VX.hud = document.getElementById('hud');
  VX.hudCtx = VX.hud.getContext('2d');
  try {
    VX.rend = new VxRenderer(canvas);
  } catch (e) {
    document.getElementById('bootmsg').textContent = 'Tu navegador no admite WebGL2, necesario para este juego';
    document.getElementById('bar').hidden = true;
    return;
  }
  VX.cam = new VxCamera();
  VX.world = new VxWorld(VX.rend.gl, { radius: VX.radius });
  VX.far = new VxFar(VX.rend.gl, VX.rend.farDist);
  VX.rend.nearDist = (VX.radius - 1) * 16 + 6;
  const nw = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  VX.world.startWorkers(document.getElementById('vx-worker-src').textContent, nw);
  VX_resize();
  window.addEventListener('resize', VX_resize);

  // a placeholder vantage until the real game places the player
  VX.cam.x = 24; VX.cam.y = 96; VX.cam.z = 40; VX.cam.yaw = 2.52; VX.cam.pitch = -0.12;
  VX.rend.beam.p0 = [10, 80, -20]; VX.rend.beam.p1 = [60, 330, -110];

  VX.booted = true;
  if (VX.capture) {
    // tests render on demand; the world still has to stream, so keep it ticking
    setInterval(function () { VX.world.update(VX.cam.x, VX.cam.z, 10); VX.far.update(VX.cam.x, VX.cam.z, 6); }, 16);
  } else {
    VX.last = performance.now();
    requestAnimationFrame(VX_loop);
  }
}

function VX_update(dt) {
  VX.time += dt;
  VX.rend.time = VX.time;
  VX.world.update(VX.cam.x, VX.cam.z, 5);
  VX.far.update(VX.cam.x, VX.cam.z, 3);
  const f = VX.world.loadedFraction();
  const bar = document.getElementById('barfill');
  if (bar) bar.style.width = Math.round(f * 100) + '%';
  const boot = document.getElementById('boot');
  if (boot && !boot.hidden && f > 0.55) boot.hidden = true;
}

function VX_draw() { VX.rend.render(VX.cam, VX.world, VX.far, null); }

function VX_loop(ts) {
  const dt = Math.min(0.1, (ts - VX.last) / 1000);
  VX.last = ts;
  VX_update(dt);
  VX_draw();
  VX.frame++;
  requestAnimationFrame(VX_loop);
}

// ── test hooks ────────────────────────────────────────────────────────────
window.__vx = {
  ready: function () { return VX.booted && VX.world.loadedFraction() > 0.985 && VX.world.uploadQ.length === 0 && VX.world.pending.size === 0 && VX.far.done(); },
  fraction: function () { return VX.world.loadedFraction(); },
  mode: function () { return VX.world.mode; },
  stats: function () { return Object.assign({ chunks: VX.world.chunks.size, mode: VX.world.mode, hdr: VX.rend.hdr, farTiles: VX.far.tiles.size, farMs: Math.round(VX.far.stats.ms) }, VX.world.stats); },
  setCam: function (x, y, z, yaw, pitch) { const c = VX.cam; c.x = x; c.y = y; c.z = z; c.yaw = yaw; c.pitch = pitch; VX.world.dirty = true; },
  set: function (k, v) { VX.rend.P[k] = v; },
  setBeam: function (a, b) { VX.rend.beam.p0 = a; VX.rend.beam.p1 = b; },
  render: function (t) {
    if (t !== undefined) { VX.time = t; VX.rend.time = t; }
    const boot = document.getElementById('boot'); if (boot) boot.hidden = true;
    VX_resize(); VX_draw();
  },
  world: function () { return VX.world; },
  cam: function () { return VX.cam; },
  rend: function () { return VX.rend; },
};

VX_boot();
