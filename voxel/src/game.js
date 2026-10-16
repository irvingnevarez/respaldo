// ═══════════════════════════════════════════════════════════════════════
//  GAME — boot, the state machine, the frame loop, and the hooks the test tools use.
//
//  States:  title -> play <-> pause / map,   play -> dead -> play,   play -> win
//  The simulation runs on a fixed 1/120 s step (so a slow frame cannot tunnel a
//  fast body through a wall and the bot tests are deterministic); the camera and
//  drawing run once per displayed frame.
// ═══════════════════════════════════════════════════════════════════════

var VX = {
  rend: null, world: null, far: null, cam: null,
  hud: null, hudCtx: null,
  time: 0, last: 0, frame: 0, acc: 0,
  quality: 2, scale: 1, radius: 8,
  booted: false, capture: false,
  state: 'boot', stateT: 0,
  look: { x: 0, y: 0 },
  fade: 1, fadeTo: 0, fadeSpeed: 1.2,
  msg: null, hint: '',
};

var VX_STEP = 1 / 120;

// The quality ladder. The frame rate decides, not the player: if the picture cannot
// keep up, resolution, view distance, rain and bloom come down a rung at a time, and
// come back up if there is plenty of room. Nothing here changes how the game plays.
var VX_Q = [
  { name: 'MÍNIMA', scale: 0.55, radius: 5, rain: 1100, bloom: 0.0 },
  { name: 'BAJA', scale: 0.70, radius: 6, rain: 2200, bloom: 0.25 },
  { name: 'MEDIA', scale: 0.85, radius: 7, rain: 3600, bloom: 0.40 },
  { name: 'ALTA', scale: 1.00, radius: 8, rain: 5600, bloom: 0.50 },
];
function VX_setQuality(q) {
  q = Math.max(0, Math.min(VX_Q.length - 1, q));
  const Q = VX_Q[q];
  VX.quality = q; VX.scale = Q.scale; VX.radius = Q.radius;
  if (VX.world) {
    VX.world.radius = Q.radius; VX.world.dirty = true;
    VX.rend.nearDist = (Q.radius - 1) * 16 + 6;
    VX.rend.P.rainCount = Q.rain; VX.rend.P.bloom = Q.bloom;
    VX_resize();
  }
}
var VX_ft = { avg: 16.7, bad: 0, good: 0, cool: 3, n: 0 };
function VX_adapt(dt) {
  const f = VX_ft;
  f.n++;
  if (f.n < 90 || VX.state === 'boot') return;                // let the first seconds settle
  f.avg += (dt * 1000 - f.avg) * 0.05;
  f.cool -= dt;
  if (f.avg > 25) { f.bad += dt; f.good = 0; } else if (f.avg < 14.5) { f.good += dt; f.bad = 0; } else { f.bad = Math.max(0, f.bad - dt); f.good = Math.max(0, f.good - dt); }
  if (f.cool <= 0 && f.bad > 1.6 && VX.quality > 0) { VX_setQuality(VX.quality - 1); f.bad = 0; f.cool = 4; f.avg = 18; }
  else if (f.cool <= 0 && f.good > 9 && VX.quality < 3) { VX_setQuality(VX.quality + 1); f.good = 0; f.cool = 8; }
}

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
  VX.hudDpr = s.dpr; VX.cssW = s.cssW; VX.cssH = s.cssH;
}

function VX_buildModels(gl) {
  const M = GS.models;
  M.batman = MD_batman(); M.clown = MD_thug('clown'); M.goon = MD_thug('goon'); M.drone = MD_drone();
  M.penguin = MD_penguin(); M.joker = MD_joker();
  M.batarang = MD_batarang(); M.bolt = MD_bolt(); M.bullet = MD_bullet(); M.bomb = MD_bomb(); M.card = MD_card();
  M.heart = MD_heart(); M.crate = MD_crate(); M.trophy = MD_trophy();
  for (const k in M) M[k].upload(gl);
}

function VX_boot() {
  VX.capture = !!window.__capture;
  // a first guess from the device; the ladder corrects it from real frame times
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  VX.quality = coarse ? 1 : (cores <= 2 ? 1 : (cores <= 4 ? 2 : 3));
  VX.scale = VX_Q[VX.quality].scale; VX.radius = VX_Q[VX.quality].radius;
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
  const gl = VX.rend.gl;
  VX.cam = new VxCamera();
  VX.world = new VxWorld(gl, { radius: VX.radius });
  VX.far = new VxFar(gl, VX.rend.farDist);
  VX.rend.nearDist = (VX.radius - 1) * 16 + 6;
  const nw = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  VX.world.startWorkers(document.getElementById('vx-worker-src').textContent, nw);

  GS.world = VX.world; GS.rend = VX.rend; GS.far = VX.far; GS.cam = VX.cam;
  VX.rend.P.rainCount = VX_Q[VX.quality].rain; VX.rend.P.bloom = VX_Q[VX.quality].bloom;
  GS.fx = new VxFx(VX.rend);
  VX_buildModels(gl);
  GS.tcam = new ThirdCam();
  const sp = WG_SPAWN;
  GS.player = new Player(sp.x, sp.y, sp.z);
  GS.player.a = sp.a;
  GS.tcam.yaw = Math.PI - sp.a; GS.tcam.pitch = -0.22; GS.tcam.snap(GS.player);
  GS.player.b.vy = 0;
  VX.rend.extraGlow = function (out, n) { return GS.fx.appendGlows(out, n); };

  IN_init(document.getElementById('stage'), canvas);
  if (typeof AU_init === 'function') AU_init();
  VX_resize();
  window.addEventListener('resize', VX_resize);
  // a hidden tab or a window that lost focus must not leave the player under attack
  document.addEventListener('visibilitychange', function () { if (document.hidden && VX.state === 'play') VX_setState('pause'); });
  window.addEventListener('blur', function () { if (VX.state === 'play' && !IN.touch) VX_setState('pause'); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); VX.lost = true; const b = document.getElementById('boot'); if (b) { b.hidden = false; document.getElementById('bootmsg').textContent = 'Se perdió el contexto gráfico: recarga la página'; document.getElementById('bar').hidden = true; } });
  UI_init();
  WD_init();

  VX.booted = true;
  VX.state = 'boot'; VX.stateT = 0;
  // the title camera: a slow orbit over the roof
  VX_titleCam(0);
  if (VX.capture) {
    // tests render on demand; the world still has to stream, so keep it ticking
    setInterval(function () { const f = VX.freeCam ? VX.cam : GS.player.b; VX.world.update(f.x, f.z, 10); VX.far.update(f.x, f.z, 6); }, 16);
  } else {
    VX.last = performance.now();
    requestAnimationFrame(VX_loop);
  }
}

function VX_titleCam(t) {
  const sp = WG_SPAWN, c = VX.cam;
  const a = 0.6 + t * 0.07, R = 26;
  c.x = sp.x + Math.sin(a) * R; c.z = sp.z + Math.cos(a) * R; c.y = sp.y + 9 + Math.sin(t * 0.3) * 1.5;
  const dx = sp.x - c.x, dz = sp.z - c.z, dy = (sp.y + 6) - c.y;
  c.yaw = Math.atan2(dx, -dz); c.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + 0.05;
  c.fov = 1.0;
}

// ── state changes ─────────────────────────────────────────────────────────
function VX_setState(s) { VX.state = s; VX.stateT = 0; }

function VX_start() {
  if (typeof AU_resume === 'function') AU_resume();
  VX_setState('play');
  VX.fade = 1; VX.fadeTo = 0; VX.fadeSpeed = 1.5;
  UI_banner(WG_DNAME[WG_districtAt(GS.player.b.x, GS.player.b.z)], 'Gotham te necesita');
  UI_hint('Planea con ESPACIO en el aire · Garfio con E', 7);
}

function VX_respawn() {
  const pl = GS.player;
  const bc = GS.beacons[GS.lastBeacon] || { x: WG_SPAWN.x, y: WG_SPAWN.y, z: WG_SPAWN.z };
  pl.respawn(bc.x, bc.y + 0.2, bc.z);
  GS.tcam.snap(pl);
  GS.projs.length = 0;
  // enemies near the spawn go away, so the player is not killed again at once
  for (const e of GS.enemies) { const d = Math.hypot(e.b.x - pl.b.x, e.b.z - pl.b.z); if (d < 30 && !e.isBoss) e.gone = true; }
  GS.combo = 0;
  VX.fade = 1; VX.fadeTo = 0; VX.fadeSpeed = 1.4;
  VX_setState('play');
}

// ── the simulation step ───────────────────────────────────────────────────
function VX_events() {
  const pl = GS.player;
  for (const e of pl.events) {
    const k = typeof e === 'string' ? e : e.t;
    if (typeof AU_event === 'function') AU_event(k, e);
    if (k === 'land' || k === 'landHard' || k === 'dust') {
      GS.fx.dust(pl.b.x, pl.b.y, pl.b.z, k === 'land' ? 8 : 14, k === 'land' ? 0.8 : 1.3);
    }
    if (k === 'jump') GS.fx.dust(pl.b.x, pl.b.y, pl.b.z, 5, 0.6);
    if (k === 'dodge') GS.fx.dust(pl.b.x, pl.b.y, pl.b.z, 8, 1.0);
    if (k === 'glide') GS.fx.puff(pl.b.x, pl.b.y + 1.0, pl.b.z, 5, 0.3, 0.2);
    if (k === 'hurt') { VX.rend.P.hurt[3] = 0.7; }
  }
  pl.events.length = 0;
  for (const e of GS.events) { if (typeof AU_event === 'function') AU_event(e.t, e); }
  GS.events.length = 0;
}

function VX_simStep(dt) {
  const pl = GS.player;
  GS.time += dt;
  GS.fx.update(dt);
  pl.update(dt, VX.cam, GS.world, true);
  VX_events();
  if (VX.state === 'play' || VX.state === 'dead') {
    EN_update(dt);
    PJ_update(dt);
    PK_update(dt);
    if (GS.boss) BS_update(dt);
    WD_update(dt);
  }
  if (GS.comboT > 0) { GS.comboT -= dt; if (GS.comboT <= 0) GS.combo = 0; }
}

function VX_update(dtReal) {
  VX.time += dtReal;
  VX.rend.time = VX.time;
  const pl = GS.player;
  VX.stateT += dtReal;

  // world streaming follows the player (or the title camera)
  const fx = VX.state === 'title' || VX.state === 'boot' ? VX.cam : pl.b;
  VX.world.update(fx.x, fx.z, 5);
  VX.far.update(fx.x, fx.z, 3);
  const f = VX.world.loadedFraction();
  const bar = document.getElementById('barfill');
  if (bar) bar.style.width = Math.round(f * 100) + '%';

  switch (VX.state) {
    case 'boot': {
      VX_titleCam(VX.time);
      if (f > 0.62) {
        const boot = document.getElementById('boot'); if (boot) boot.hidden = true;
        VX_setState('title'); VX.fade = 1; VX.fadeTo = 0;
      }
      break;
    }
    case 'title': {
      VX_titleCam(VX.time);
      if (VX.stateT > 0.6 && IN.anyEdge) VX_start();
      break;
    }
    case 'play':
    case 'dead': {
      // hit-stop: a landed punch holds the world for a few frames
      let dt = dtReal;
      if (GS.slow > 0) { GS.slow -= dtReal; dt *= 0.12; }
      dt = Math.min(dt, 0.1);
      if (VX.state === 'play') {
        if (IN.pauseEdge) { VX_setState('pause'); break; }
        if (IN.mapEdge) { VX_setState('map'); UI_mapOpen(); break; }
      }
      VX.acc += dt;
      let n = 0;
      while (VX.acc >= VX_STEP && n < 12) { VX_simStep(VX_STEP); VX.acc -= VX_STEP; n++; }
      if (n === 12) VX.acc = 0;
      if (pl.dead && VX.state === 'play') { VX_setState('dead'); VX.fadeTo = 1; VX.fadeSpeed = 0.8; }
      if (VX.state === 'dead' && VX.stateT > 2.6) VX_respawn();
      // the camera
      IN_takeLook(VX.look);
      GS.tcam.update(dtReal, VX.cam, pl, GS.world, VX.look);
      break;
    }
    case 'pause': {
      IN_takeLook(VX.look);
      if (IN.pauseEdge || (IN.anyEdge && VX.stateT > 0.3 && IN.jumpEdge)) VX_setState('play');
      break;
    }
    case 'map': {
      IN_takeLook(VX.look);
      if (IN.mapEdge || IN.pauseEdge) VX_setState('play');
      break;
    }
    case 'win': {
      IN_takeLook(VX.look);
      VX_titleCam(VX.time);
      if (VX.stateT > 1.5 && IN.anyEdge) { VX_setState('play'); VX.fadeTo = 0; }
      break;
    }
  }
  // screen fade
  VX.fade += (VX.fadeTo - VX.fade) * Math.min(1, VX.fadeSpeed * dtReal * 3);
  if (Math.abs(VX.fade - VX.fadeTo) < 0.004) VX.fade = VX.fadeTo;
  VX.rend.P.fade = 1 - VX.fade;
  VX.rend.P.hurt[3] = Math.max(0, VX.rend.P.hurt[3] - dtReal * 1.6);
  UI_update(dtReal);
  if (typeof AU_update === 'function') AU_update(dtReal);
  VX_adapt(dtReal);
  IN_clearEdges();
}

// ── drawing ───────────────────────────────────────────────────────────────
function VX_extra(r, cam) {
  const gl = r.gl, P = r.P, p = r.prog.ent;
  gl.useProgram(p.id);
  gl.uniformMatrix4fv(p.u('uVP'), false, cam.vp);
  r.common(p, cam);
  gl.uniform3f(p.u('uSkyTint'), P.skyTint[0], P.skyTint[1], P.skyTint[2]);
  gl.uniform1f(p.u('uSkyI'), P.skyI);
  gl.uniform1f(p.u('uBlockI'), P.blockI);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  PL_draw(r, GS.player);
  for (const e of GS.enemies) {
    const dx = e.b.x - cam.x, dz = e.b.z - cam.z;
    if (dx * dx + dz * dz > 170 * 170) continue;
    if (!M4_boxVisible(cam.planes, e.b.x - 3, e.b.y - 1, e.b.z - 3, e.b.x + 3, e.b.y + 5, e.b.z + 3)) continue;
    e.draw(r);
  }
  PK_draw(r);
  PJ_draw(r);
  WD_draw(r, cam);
  const ropes = PL_ropes();
  GS.fx.draw(r, cam, ropes);
  gl.bindVertexArray(null);
}

var PL_mA = new Float32Array(16);
function PL_draw(r, pl) {
  const M = GS.models.batman, st = pl.st, b = pl.b;
  const hip = 0.625;
  const bank = pl.mode === 'glide' ? pl.gl.bank : 0;
  M4_model(PL_mA, b.x, b.y + hip, b.z, pl.a, 0, bank, 1);
  PL_mA[12] -= hip * PL_mA[4]; PL_mA[13] -= hip * PL_mA[5]; PL_mA[14] -= hip * PL_mA[6];
  pl.pose = pl.pose || M.poseNew();
  AN_humanoid(M, pl.pose, st);
  EN_lightProbe(b.x, b.y, b.z, pl.light);
  EN_lightStep(pl.light, 1 / 60);
  let flash = null;
  if (st.hurt > 0) flash = [1, 0.35, 0.3, st.hurt * 0.6];
  else if (pl.inv > 0 && !pl.dead && ((VX.time * 14) | 0) % 2) flash = [1, 1, 1, 0.22];
  MD_drawModel(r, M, PL_mA, pl.pose, { sky: pl.light.sky, moon: pl.light.moon, bl: pl.light.bl, flash: flash, rim: [0.16, 0.24, 0.42] });
}

// The grapple rope, from the right hand to the anchor.
var PL_rp = [{ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, sag: 0 }];
var PL_hand = [0, 0, 0];
function PL_ropes() {
  const pl = GS.player, g = pl.grap;
  if (!g && !(pl.grapMiss > 0)) return null;
  const M = GS.models.batman;
  M.attach(MD_ARMR, -5.5, 10, 0, PL_hand);
  const R = PL_rp[0];
  R.ax = PL_hand[0]; R.ay = PL_hand[1]; R.az = PL_hand[2];
  if (g) {
    const t = g.phase === 'fly' ? Math.min(1, g.t) : 1;
    R.bx = PL_hand[0] + (g.ax - PL_hand[0]) * t; R.by = PL_hand[1] + (g.ay - PL_hand[1]) * t; R.bz = PL_hand[2] + (g.az - PL_hand[2]) * t;
    R.sag = (1 - t) * 0.6;
    return PL_rp;
  }
  const k = 1 - pl.grapMiss / 0.25, L = 22 * Math.min(1, k * 1.6);
  R.bx = PL_hand[0] + pl.missDir[0] * L; R.by = PL_hand[1] + pl.missDir[1] * L; R.bz = PL_hand[2] + pl.missDir[2] * L; R.sag = 0.3;
  return PL_rp;
}

function VX_draw() {
  VX.rend.beams = WD_beams(); VX.rend.emblem = GS.emblem || null;
  VX.rend.render(VX.cam, VX.world, VX.far, VX_extra);
  if (VX.hideHud) VX.hudCtx.clearRect(0, 0, VX.hud.width, VX.hud.height); else UI_draw(VX.hudCtx, VX.hud.width, VX.hud.height);
}

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
  setCam: function (x, y, z, yaw, pitch) { const c = VX.cam; c.x = x; c.y = y; c.z = z; c.yaw = yaw; c.pitch = pitch; VX.world.dirty = true; VX.freeCam = true; },
  set: function (k, v) { VX.rend.P[k] = v; },
  setBeam: function (a, b) { VX.rend.beam.p0 = a; VX.rend.beam.p1 = b; },
  render: function (t) {
    if (t !== undefined) { VX.time = t; VX.rend.time = t; }
    const boot = document.getElementById('boot'); if (boot) boot.hidden = true;
    VX_resize(); VX_draw();
  },
  // advance the simulation by n fixed steps with the camera driven as in play
  step: function (n, dt) {
    for (let i = 0; i < n; i++) {
      VX.time += VX_STEP;
      VX_simStep(VX_STEP);
      GS.tcam.update(VX_STEP, VX.cam, GS.player, GS.world, { x: 0, y: 0 });
      IN_clearEdges();
    }
  },
  world: function () { return VX.world; },
  cam: function () { return VX.cam; },
  rend: function () { return VX.rend; },
  gs: function () { return GS; },
  vx: function () { return VX; },
  input: function () { return IN; },
  start: function () { VX_setState('play'); VX.fade = 0; VX.fadeTo = 0; },
  mapAll: function () { UI_mapStep(99999); },
  lm: function () { return LM; },
  lookAt: function (x, y, z, tx, ty, tz) {
    const c = VX.cam, dx = tx - x, dy = ty - y, dz = tz - z;
    c.x = x; c.y = y; c.z = z; c.yaw = Math.atan2(dx, -dz); c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    VX.world.dirty = true; VX.freeCam = true;
    VX.world.update(x, z, 0); VX.far.update(x, z, 0);          // so the loaded fraction is about HERE, not where we were
  },
  hideHud: function (on) { VX.hideHud = on; },
  bossStart: function (id) { const bi = GS.bossInfo.find(b => b.id === id); BS_start(id, bi.arena); },
  arena: function (id) { return GS.bossInfo.find(b => b.id === id).arena; },
  place: function (x, y, z, a) { const p = GS.player; p.b.x = x; p.b.y = y; p.b.z = z; p.b.vx = p.b.vy = p.b.vz = 0; if (a !== undefined) p.a = a; GS.tcam.snap(p); VX.world.dirty = true; },
};

VX_boot();
