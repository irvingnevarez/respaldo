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
  msg: null, hint: '', uw: 0,
};
var VX_BASE = VxRenderer.defaults();
// Each district has a slightly different air: the same night, tinted. Enough to know
// where you are with your eyes shut.
var VX_AIR = {};
VX_AIR[WG_D.AZOTEAS] = { fog: [0.082, 0.082, 0.092], hor: [0.046, 0.058, 0.076] };
VX_AIR[WG_D.PUENTE] = { fog: [0.074, 0.084, 0.100], hor: [0.044, 0.060, 0.084] };
VX_AIR[WG_D.MUELLES] = { fog: [0.078, 0.092, 0.102], hor: [0.044, 0.064, 0.078] };
VX_AIR[WG_D.ARKHAM] = { fog: [0.070, 0.082, 0.098], hor: [0.040, 0.060, 0.080] };
VX_AIR[WG_D.HIELO] = { fog: [0.074, 0.096, 0.128], hor: [0.050, 0.076, 0.108] };
VX_AIR[WG_D.ALCANT] = { fog: [0.068, 0.102, 0.084], hor: [0.040, 0.072, 0.052] };
VX_AIR[WG_D.FUNDI] = { fog: [0.128, 0.082, 0.064], hor: [0.088, 0.052, 0.034] };
VX_AIR[WG_D.CARNAVAL] = { fog: [0.106, 0.074, 0.128], hor: [0.078, 0.046, 0.098] };
VX_AIR[WG_D.SEA] = VX_AIR[WG_D.AZOTEAS];
var VX_air = { fog: VX_AIR[WG_D.AZOTEAS].fog.slice(), hor: VX_AIR[WG_D.AZOTEAS].hor.slice(), want: VX_AIR[WG_D.AZOTEAS], t: 0 };

var VX_STEP = 1 / 120;

// The quality ladder. Left to itself the frame rate decides: if the picture cannot
// keep up, resolution, view distance and the costly passes (reflections, light in
// the air, temporal anti-aliasing) come down a rung at a time, and come back up if
// there is room. The player can also pin a rung from the pause screen; ULTRA is
// only ever chosen by hand. Nothing here changes how the game plays.
var VX_Q = [
  { name: 'MÍNIMA', scale: 0.55, radius: 5, rain: 1100, g: { taa: 0, ssr: 0, vol: 0, lights: 4, detail: 0, caps: 0, splash: 0, streak: 0 } },
  { name: 'BAJA', scale: 0.70, radius: 6, rain: 2200, g: { taa: 0, ssr: 0, vol: 2, lights: 8, detail: 1, caps: 1, splash: 300, streak: 0 } },
  { name: 'MEDIA', scale: 0.85, radius: 7, rain: 3600, g: { taa: 1, ssr: 14, vol: 3, lights: 8, detail: 1, caps: 1, splash: 600, streak: 1 } },
  { name: 'ALTA', scale: 1.00, radius: 8, rain: 5600, g: { taa: 1, ssr: 28, vol: 4, lights: 12, detail: 1, caps: 1, splash: 900, streak: 1 } },
  { name: 'ULTRA', scale: 1.00, radius: 8, rain: 8000, dpr: 2.0, g: { taa: 1, ssr: 44, vol: 6, lights: 12, detail: 1, caps: 1, splash: 1500, streak: 1 } },
];
var VX_GFX_KEY = 'gotham-voxel-gfx';
function VX_setQuality(q) {
  q = Math.max(0, Math.min(VX_Q.length - 1, q));
  const Q = VX_Q[q];
  VX.quality = q; VX.scale = Q.scale; VX.radius = Q.radius; VX.dprMax = Q.dpr || 1.75;
  if (VX.world) {
    VX.world.radius = Q.radius; VX.world.dirty = true;
    VX.rend.nearDist = (Q.radius - 1) * 16 + 6;
    VX.rend.P.rainCount = Q.rain;
    VX.rend.Q = Object.assign({}, Q.g);
    VX_resize();
  }
}
// AUTO -> MÍNIMA -> ... -> ULTRA -> AUTO
function VX_cycleQuality() {
  if (VX.manualQ === undefined || VX.manualQ < 0) VX.manualQ = 0;
  else if (VX.manualQ >= VX_Q.length - 1) VX.manualQ = -1;
  else VX.manualQ++;
  try { localStorage.setItem(VX_GFX_KEY, String(VX.manualQ)); } catch (e) { }
  if (VX.manualQ >= 0) VX_setQuality(VX.manualQ);
  else { VX_setQuality(Math.min(VX.quality, 3)); VX_ft.n = 0; VX_ft.t = 0; VX_ft.cool = 2; VX_ft.bad = VX_ft.good = 0; }
}
var VX_ft = { avg: 16.7, bad: 0, good: 0, cool: 3, n: 0, t: 0 };
// `dt` here is the real time the last frame took, not the clamped step the game runs on.
function VX_adapt(dt) {
  const f = VX_ft;
  f.n++; f.t += dt;
  // pinned, still loading, or still settling after a change (which costs a shader build)
  if (VX.manualQ >= 0 || VX.state === 'boot' || f.n < 6 || f.t < 1.0) return;
  f.avg += (dt * 1000 - f.avg) * (dt > 0.05 ? 0.25 : 0.05);          // slow frames are believed sooner
  f.cool -= dt;
  // Where the browser can time the GPU, that is the better signal: the frame time
  // is capped by the display, so on its own it can say "too slow" but never "room to spare".
  const g = VX.rend.gpuMs;
  let bad = f.avg > 22, good = f.avg < 14.5;
  if (g > 0) { bad = bad || g > 15; good = g < 6.5 && f.avg < 19; }
  if (bad) { f.bad += dt; f.good = 0; } else if (good) { f.good += dt; f.bad = 0; } else { f.bad = Math.max(0, f.bad - dt); f.good = Math.max(0, f.good - dt); }
  const awful = f.avg > 60;                                          // under 16 frames a second: no need to wait to be sure
  if (f.cool <= 0 && VX.quality > 0 && (f.bad > 1.6 || (awful && f.bad > 0.5))) {
    VX_setQuality(VX.quality - (f.avg > 120 && VX.quality > 1 ? 2 : 1));
    f.bad = 0; f.cool = awful ? 1.5 : 4; f.avg = 18; f.n = 0; f.t = 0.4; VX.rend.gpuMs = 0;
  } else if (f.cool <= 0 && f.good > (g > 0 ? 4 : 9) && VX.quality < 3) {
    VX_setQuality(VX.quality + 1);
    f.good = 0; f.cool = 8; f.n = 0; f.t = 0.4; VX.rend.gpuMs = 0;
  }
}

function VX_size() {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, VX.dprMax || 1.75);
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
  const coarse = VX.coarse = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  try { if (document.fonts && document.fonts.load) { document.fonts.load('600 20px Oswald'); document.fonts.load('700 20px Oswald'); document.fonts.load('700 12px "JetBrains Mono"'); } } catch (e) { }
  const cores = navigator.hardwareConcurrency || 4;
  VX.quality = coarse ? 1 : (cores <= 2 ? 1 : (cores <= 4 ? 2 : 3));
  try { const m = localStorage.getItem(VX_GFX_KEY); if (m !== null && +m >= 0 && +m < VX_Q.length) { VX.manualQ = +m; VX.quality = +m; } } catch (e) { }
  VX.scale = VX_Q[VX.quality].scale; VX.radius = VX_Q[VX.quality].radius; VX.dprMax = VX_Q[VX.quality].dpr || 1.75;
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
  // The name of the graphics chip, where the browser gives it, tempers the first
  // guess: an integrated or a phone chip does not start on the costliest rung. The
  // ladder still has the last word once real frames have been timed.
  if (!(VX.manualQ >= 0)) {
    let chip = '';
    try { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); chip = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) { }
    if (/Intel|Mali|Adreno|PowerVR|VideoCore|SwiftShader|llvmpipe|Basic Render/i.test(chip)) VX.quality = Math.min(VX.quality, coarse ? 1 : 2);
    // no GPU at all: everything is drawn by the processor (the test tools keep their rung)
    if (/SwiftShader|llvmpipe|Basic Render/i.test(chip) && !VX.capture) VX.quality = 0;
    VX.scale = VX_Q[VX.quality].scale; VX.radius = VX_Q[VX.quality].radius; VX.dprMax = VX_Q[VX.quality].dpr || 1.75;
  }
  VX.cam = new VxCamera();
  VX.world = new VxWorld(gl, { radius: VX.radius });
  VX.far = new VxFar(gl, VX.rend.farDist);
  VX.rend.nearDist = (VX.radius - 1) * 16 + 6;
  const nw = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  VX.world.startWorkers(document.getElementById('vx-worker-src').textContent, nw);

  GS.world = VX.world; GS.rend = VX.rend; GS.far = VX.far; GS.cam = VX.cam;
  VX.rend.P.rainCount = VX_Q[VX.quality].rain; VX.rend.Q = Object.assign({}, VX_Q[VX.quality].g);
  GS.fx = new VxFx(VX.rend);
  VX_buildModels(gl);
  GS.tcam = new ThirdCam();
  const sp = WG_SPAWN;
  GS.player = new Player(sp.x, sp.y, sp.z);
  GS.player.a = sp.a;
  GS.tcam.yaw = Math.PI - sp.a; GS.tcam.pitch = -0.22; GS.tcam.snap(GS.player);
  GS.player.b.vy = 0;
  VX.rend.extraGlow = function (out, n) { return GS.fx.appendGlows(out, n); };

  VX.saved = VX_saveLoad();
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

// Progress survives a reload: which beacons are lit, which bosses are down, the
// trophies, the score. Storage can be blocked or full, so every access is guarded.
var VX_SAVE_KEY = 'gotham-voxel-v1';
function VX_saveLoad() {
  try { const t = localStorage.getItem(VX_SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
function VX_saveWrite() {
  try {
    localStorage.setItem(VX_SAVE_KEY, JSON.stringify({
      beacons: GS.beacons.map(b => b.active ? 1 : 0), last: GS.lastBeacon, bosses: GS.bossDone, trophies: Array.from(GS.trophies),
      score: GS.score, kills: GS.kills, best: GS.bestCombo, bats: GS.player.bats,
    }));
  } catch (e) { }
}
function VX_saveClear() { try { localStorage.removeItem(VX_SAVE_KEY); } catch (e) { } }
function VX_saveApply(d) {
  if (!d) return false;
  try {
    d.beacons.forEach((v, i) => { if (GS.beacons[i] && v) GS.beacons[i].active = true; });
    GS.lastBeacon = Math.min(GS.beacons.length - 1, d.last | 0);
    GS.bossDone.penguin = !!(d.bosses && d.bosses.penguin); GS.bossDone.joker = !!(d.bosses && d.bosses.joker);
    GS.trophies = new Set(d.trophies || []); GS.score = d.score | 0; GS.kills = d.kills | 0; GS.bestCombo = d.best | 0;
    GS.player.bats = Math.max(8, d.bats | 0);
    return true;
  } catch (e) { return false; }
}

function VX_start() {
  if (typeof AU_resume === 'function') AU_resume();
  VX_setState('play');
  VX.fade = 1; VX.fadeTo = 0; VX.fadeSpeed = 1.5;
  if (VX.saved) {                                         // a continued game starts at the last beacon
    VX_saveApply(VX.saved);
    const b = GS.beacons[GS.lastBeacon], pl = GS.player;
    pl.b.x = b.x + (GS.lastBeacon === 0 ? 0 : 3.5); pl.b.y = b.y + 0.2; pl.b.z = b.z; pl.b.vx = pl.b.vy = pl.b.vz = 0;
    GS.tcam.snap(pl); VX.world.dirty = true;
    UI_banner(b.name, 'Partida continuada');
  } else {
    UI_banner(WG_DNAME[WG_districtAt(GS.player.b.x, GS.player.b.z)], 'Gotham te necesita');
    UI_hint('Planea con ESPACIO en el aire · Garfio con E', 7);
  }
  VX.saveT = 8;
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
  for (const e of GS.events) {
    if (typeof AU_event === 'function') AU_event(e.t, e);
    if (e.t === 'alert') UI_tip('fight', 'Clic: golpear · F: batarang · Q: esquivar cuando veas el aviso naranja', 7);
  }
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
  VX.saveT -= dt;
  if (VX.saveT <= 0 && VX.state === 'play') { VX.saveT = 10; VX_saveWrite(); }
}

function VX_update(dtReal) {
  VX.time += dtReal;
  VX.rend.time = VX.time;
  const pl = GS.player;
  VX.stateT += dtReal;
  IN_pollPad(dtReal);

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
      if (VX.saved && IN.keys.KeyB) { VX_saveClear(); VX.saved = null; }
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
  // the air of the district the camera is in
  VX_air.t -= dtReal;
  if (VX_air.t <= 0) { VX_air.t = 0.4; VX_air.want = VX_AIR[WG_districtAt(VX.cam.x, VX.cam.z)] || VX_AIR[WG_D.AZOTEAS]; }
  for (let i = 0; i < 3; i++) {
    VX_air.fog[i] += (VX_air.want.fog[i] - VX_air.fog[i]) * Math.min(1, dtReal * 0.8);
    VX_air.hor[i] += (VX_air.want.hor[i] - VX_air.hor[i]) * Math.min(1, dtReal * 0.8);
  }
  VX.rend.P.horizon = VX_air.hor;
  // under the surface the city turns to murk
  const cam = VX.cam, inWater = GS.world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)) === BK.WATER;
  VX.uw += ((inWater ? 1 : 0) - VX.uw) * Math.min(1, dtReal * 7);
  const P = VX.rend.P, B = VX_BASE;
  const F = VX_air.fog;
  P.fog = [F[0] + (0.015 - F[0]) * VX.uw, F[1] + (0.085 - F[1]) * VX.uw, F[2] + (0.12 - F[2]) * VX.uw];
  P.fogD = B.fogD + (0.15 - B.fogD) * VX.uw; P.fogK = B.fogK * (1 - VX.uw);
  // screen fade
  VX.fade += (VX.fadeTo - VX.fade) * Math.min(1, VX.fadeSpeed * dtReal * 3);
  if (Math.abs(VX.fade - VX.fadeTo) < 0.004) VX.fade = VX.fadeTo;
  VX.rend.P.fade = 1 - VX.fade;
  VX.rend.P.hurt[3] = Math.max(0, VX.rend.P.hurt[3] - dtReal * 1.6);
  UI_update(dtReal);
  if (typeof AU_update === 'function') AU_update(dtReal);
  if (IN.gfxEdge && VX.state !== 'boot') VX_cycleQuality();
  VX_adapt(VX.rawDt || dtReal);
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
  // a camera squeezed against a wall would fill the screen with the back of his head
  if ((GS.tcam.dist > 1.5 || VX.state !== 'play') && !VX.noPlayer) PL_draw(r, GS.player);
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
  MD_drawModel(r, M, PL_mA, pl.pose, { sky: pl.light.sky, moon: pl.light.moon, bl: pl.light.bl, flash: flash, rim: [0.16, 0.24, 0.42], emit: VX.eyeGlow || 1 });
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

// Every character near the camera, as an upright capsule and the one light whose
// shadow it should throw: the lamp that lights it most, or failing that the moon.
var VX_capPool = [];
function VX_caps() {
  const R = VX.rend, out = R.caps, cam = VX.cam, w = GS.world;
  out.length = 0;
  if (!R.Q.caps) return;
  const cand = [];
  const pl = GS.player;
  if (!VX.noPlayer && (GS.tcam.dist > 1.5 || VX.state !== 'play')) cand.push({ b: pl.b, h: pl.b.h, d: 0, L: pl.light });
  for (const e of GS.enemies) {
    if (e.gone || (e.dead && e.deadT > 0.6)) continue;
    const d = Math.hypot(e.b.x - cam.x, e.b.z - cam.z);
    if (d < 46) cand.push({ b: e.b, h: e.b.h, d: d + 1, L: e.light });
  }
  if (GS.boss && GS.boss.b) cand.push({ b: GS.boss.b, h: GS.boss.b.h, d: 0.5, L: GS.boss.light });
  cand.sort(function (a, b) { return a.d - b.d; });
  for (let i = 0; i < cand.length && i < 8; i++) {
    const c = cand[i], b = c.b;
    const o = VX_capPool[i] || (VX_capPool[i] = {});
    o.x = b.x; o.y = b.y; o.z = b.z; o.h = Math.max(0.8, c.h);
    // the strongest lamp at the character's chest
    let best = 0, bx = 0, by = 0, bz = 0;
    const cx = Math.floor(b.x / 16), cz = Math.floor(b.z / 16);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ch = w.chunks.get(JB_key(cx + di, cz + dj));
      if (!ch) continue;
      for (const e of ch.emitters) {
        const dx = e[0] - b.x, dy = e[1] - (b.y + c.h * 0.6), dz = e[2] - b.z, d = Math.hypot(dx, dy, dz);
        if (d >= e[7] || dy < 0.5) continue;
        const f = 1 - d / e[7], k = f * f * e[6];
        if (k > best) { best = k; bx = e[0]; by = e[1]; bz = e[2]; }
      }
    }
    if (best > 0.05) { o.lx = bx; o.ly = by; o.lz = bz; o.s = Math.min(0.85, 0.35 + best * 1.6); }
    else if (c.L && c.L.moon > 0.5) { o.lx = b.x + BX_MOON.x * 300; o.ly = b.y + BX_MOON.y * 300; o.lz = b.z + BX_MOON.z * 300; o.s = -0.8; }
    else { o.lx = b.x; o.ly = b.y + 50; o.lz = b.z; o.s = 0; }
    out.push(o);
  }
}

function VX_draw() {
  VX_caps();
  VX.rend.beams = WD_beams(); VX.rend.emblem = GS.emblem || null;
  VX.rend.render(VX.cam, VX.world, VX.far, VX_extra);
  if (VX.hideHud) VX.hudCtx.clearRect(0, 0, VX.hud.width, VX.hud.height); else UI_draw(VX.hudCtx, VX.hud.width, VX.hud.height);
}

// A bug in one frame must not freeze the whole game: the error is counted and the
// loop carries on. Only a failure that repeats every frame stops it, with a message.
function VX_loop(ts) {
  const dt = Math.min(0.1, (ts - VX.last) / 1000);
  VX.rawDt = Math.min(1.5, Math.max(0, (ts - VX.last) / 1000));
  VX.last = ts;
  try {
    VX_update(dt);
    VX_draw();
    VX.errRun = 0;
  } catch (e) {
    VX.errRun = (VX.errRun || 0) + 1; VX.errTotal = (VX.errTotal || 0) + 1;
    if (VX.errTotal <= 3 && window.console) console.error(e);
    if (VX.errRun > 90) {
      const b = document.getElementById('boot');
      if (b) { b.hidden = false; document.getElementById('bootmsg').textContent = 'Algo falló en el juego: recarga la página'; document.getElementById('bar').hidden = true; }
      return;
    }
  }
  VX.frame++;
  requestAnimationFrame(VX_loop);
}

// ── test hooks ────────────────────────────────────────────────────────────
window.__vx = {
  ready: function () { return VX.booted && VX.world.loadedFraction() > 0.985 && VX.world.uploadQ.length === 0 && VX.world.pending.size === 0 && VX.far.done(); },
  fraction: function () { return VX.world.loadedFraction(); },
  mode: function () { return VX.world.mode; },
  stats: function () { return Object.assign({ chunks: VX.world.chunks.size, mode: VX.world.mode, hdr: VX.rend.hdr, farTiles: VX.far.tiles.size, farMs: Math.round(VX.far.stats.ms) }, VX.world.stats); },
  setCam: function (x, y, z, yaw, pitch) { const c = VX.cam; c.x = x; c.y = y; c.z = z; c.yaw = yaw; c.pitch = pitch; VX.world.dirty = true; VX.freeCam = true; VX.world.update(x, z, 0); VX.far.update(x, z, 0); },
  set: function (k, v) { VX.rend.P[k] = v; },
  setBeam: function (a, b) { VX.rend.beam.p0 = a; VX.rend.beam.p1 = b; },
  // draw on demand. With temporal anti-aliasing one frame is one sample: `n` frames
  // of the same instant let a still settle the way it does in play.
  render: function (t, n) {
    if (t !== undefined) { VX.time = t; VX.rend.time = t; }
    const boot = document.getElementById('boot'); if (boot) boot.hidden = true;
    VX_resize();
    for (let i = 0; i < (n || 1); i++) VX_draw();
  },
  quality: function (q) { VX.manualQ = q; VX_setQuality(q); return VX_Q[VX.quality].name; },
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
  audioSmoke: function () {
    // every sound once, plus a few seconds of the score, to see that nothing throws
    AU_resume();
    const bad = [];
    const kinds = ['jump', 'land', 'landHard', 'glide', 'dodge', 'grapple', 'grappleMiss', 'grappleHit', 'vault', 'swing', 'whoosh', 'hit', 'throw', 'batHit', 'clink', 'hurt', 'die', 'kill', 'gun', 'enemySwing', 'tell', 'alert', 'boom', 'slamLand', 'poof', 'pickup', 'beacon', 'cleared', 'bossStart', 'bossHit', 'bossDown', 'thunder', 'burn'];
    for (const k of kinds) { try { AU.lastEvt = {}; AU_event(k, { t: k, kind: 3, x: GS.player.b.x, z: GS.player.b.z }); } catch (e) { bad.push(k + ': ' + e.message); } }
    try { for (let i = 0; i < 400; i++) AU_update(0.016); } catch (e) { bad.push('update: ' + e.message); }
    return { ctx: !!AU.ctx, state: AU.ctx && AU.ctx.state, bad: bad };
  },
  hurt: function (n) { const p = GS.player; p.inv = 0; p.hurt(n, 1, 0, false); },
  setState: function (s) { VX_setState(s); },
  glError: function () { return VX.rend.gl.getError(); },
  killBoss: function () { const b = GS.boss; if (b) { b.hp = 0.1; b.set && 0; b.state = b.id === 'penguin' ? 'dazed' : 'hunt'; b.damage(5, 1, 0, 3); } },
  travel: function (i) { WD_travel(i); },
  tips: function () { return UI.tipsSeen ? Object.keys(UI.tipsSeen) : []; },
  spawn: function (kind, x, y, z, alert) { const e = new Enemy(kind, x, y, z, null); if (alert) { e.alert = true; e.state = 'chase'; } GS.enemies.push(e); return e; },
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
