// ═══════════════════════════════════════════════════════════════════════
//  The trailer's director. Injected into the game page in capture mode, it runs
//  the real game frame by frame: it stages each shot (places Batman, enemies and
//  bosses), plays the inputs a player would, moves a film camera along designed
//  paths, and paints title cards over the picture. Every sound the game would
//  make is logged with its time so the score can be built to match.
//
//  Two cameras: TR.ctrl is the one the player is steered by (the game's own
//  third-person camera), TR.view is the one the film is shot with. In gameplay
//  shots they are the same; in cinematic shots the film camera is free.
// ═══════════════════════════════════════════════════════════════════════

var TR = {
  W: 1280, H: 720, FPS: 30,
  shots: [], si: -1, shot: null, t: 0, vt: 0, acc: 0,
  ctrl: null, view: null, ov: null, ovx: null,
  ev: [], tele: [], lb: 0, kills: 0, slowUntil: -1, flashQ: [],
  pst: { yaw: Math.PI / 2, pitch: -0.2 }, glideT0: 0, jumped: false, glid: false,
  plan: { yaw: [0, -0.75, -1.216, -0.897, -1.201, -1.3, -1.3, -1.3], pitch: [-0.25, -0.027, -0.353, 0.102, -0.197, 0.036, -0.272, -0.462] },
};

// ── small helpers ──────────────────────────────────────────────────────────
function TR_ease(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }
function TR_ease2(u) { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function TR_mix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
function TR_cr(p0, p1, p2, p3, u) {          // Catmull-Rom between p1 and p2
  const u2 = u * u, u3 = u2 * u, o = [];
  for (let i = 0; i < 3; i++) o.push(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3));
  return o;
}
function TR_path(P, u) {                      // a smooth path through the points, u in 0..1
  u = Math.max(0, Math.min(1, u));
  const n = P.length - 1, f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  return TR_cr(P[Math.max(0, i - 1)], P[i], P[i + 1], P[Math.min(n, i + 2)], k);
}
function TR_look(cam, p, at, fov) {
  const dx = at[0] - p[0], dy = at[1] - p[1], dz = at[2] - p[2];
  cam.x = p[0]; cam.y = p[1]; cam.z = p[2];
  cam.yaw = Math.atan2(dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  if (fov) cam.fov = fov;
}
function TR_noHurt() { return false; }
function TR_once(key, cond) { if (!cond || TR.done[key]) return false; TR.done[key] = true; return true; }
function TR_cue(k, x) { TR.ev.push({ t: TR.vt, k: k, near: 1, cue: true, v: x || 0 }); }
function TR_flash(at, power) { TR.flashQ.push({ t: at, p: power || 1 }); }
function TR_keys(o) {
  const k = IN.keys;
  for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) k[c] = !!(o && o[c]);
  IN.sprint = !!(o && o.sprint); IN.jump = !!(o && o.jump);
  IN.stickX = (o && o.sx) || 0; IN.stickY = (o && o.sy) || 0;
}
function TR_center(sp) { return [sp.bx * WG_PITCH + WG_ST + 19, sp.bz * WG_PITCH + WG_ST + 19]; }
function TR_special(type, n) { let i = 0; for (const v of LM.special.values()) if (v.type === type) { if (i === (n || 0)) return v; i++; } return null; }

function TR_resetPlayer(x, y, z, a) {
  const pl = GS.player, b = pl.b;
  b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0;
  pl.a = a; pl.mode = 'air'; pl.grap = null; pl.dead = false; pl.hp = pl.maxHp; pl.inv = 0;
  pl.atkT = 0; pl.batT = 0; pl.dodgeT = 0; pl.combo = 0; pl.st.atk = 0; pl.st.glide = 0; pl.st.air = 0; pl.st.dead = 0;
  pl.gl.v = 0; pl.events.length = 0; pl.kbx = pl.kbz = 0; pl.fallV = 0;
  GS.tcam.snap(pl);
}
function TR_clearWorld() {
  for (const e of GS.enemies) e.gone = true;
  GS.enemies.length = 0; GS.projs.length = 0; GS.pickups.length = 0;
  if (GS.boss) { GS.boss = null; }
  GS.zones = []; GS.waves = [];
}

// ═══════════════════════════════════════════════════════════════════════
//  THE SHOTS
// ═══════════════════════════════════════════════════════════════════════
function TR_build() {
  const g = LM.gcpd, B = LM.bridge;
  const fer = TR_center(TR_special('ferris')), fou = TR_center(TR_special('foundry'));
  const cra = TR_center(TR_special('crane')), spi = TR_center(TR_special('spire'));
  const pen = LM.arenas.find(a => a.style === 'penguin'), jok = LM.arenas.find(a => a.style === 'joker');
  const S = [];

  // 1 ── a storm over the rooftops; lightning shows the city
  S.push({
    id: 'storm', dur: 5, lb: 1, hud: false, sim: true, fadeIn: 1.8,
    setup() { TR_resetPlayer(38.5, 94.01, -16.5, Math.PI / 2); AN_WIND = 8; TR_flash(0.85, 1.0); TR_flash(1.08, 0.7); TR_cue('thunderFar', 2.0); },
    cam(t) { const u = TR_ease(t / 5); return { p: TR_mix([-46, 70, 78], [-30, 75, 58], u), at: TR_mix([33, 92, -24], [33, 99, -26], u), fov: 1.0 }; },
  });
  // 2 ── up the police tower to the signal
  S.push({
    id: 'signal', dur: 5, lb: 1, hud: false, sim: true,
    setup() { TR_cue('braam', 3.3); },
    cam(t) {
      const u = TR_ease2(t / 5);
      return { p: TR_path([[44, 34, 6], [42, 58, 6], [40, 88, 5], [38, 112, 4]], u), at: TR_mix([30, 62, -8], [32, 104, -30], TR_ease(t / 4.6)), fov: 1.05 };
    },
  });
  // 3 ── the hero on the parapet, cape in the gale, the beam behind him
  S.push({
    id: 'hero', dur: 5, lb: 1, hud: false, sim: true,
    setup() { TR_resetPlayer(38.5, 94.01, -16.5, Math.PI / 2); AN_WIND = 9; },
    cam(t) {
      const u = TR_ease(t / 5), th = 0.95 - 0.55 * u, R = 3.1 - 0.4 * u;
      const c = [38.5, 95.0, -16.5];
      return { p: [c[0] + Math.cos(th) * R, c[1] - 0.55 + 0.15 * u, c[2] + Math.sin(th) * R], at: [c[0] - 0.05, c[1] + 1.2, c[2] - 0.32], fov: 0.86 };
    },
    text: [{ a: 1.3, b: 4.7, kind: 'tag', s: 'UNA CIUDAD QUE NUNCA DUERME', y: 0.24 }],
  });
  // 4 ── the run, the leap, and the title over the fall
  S.push({
    id: 'leap', dur: 5, lb: 1, hud: false, sim: true,
    setup() {
      TR_resetPlayer(36.5, 93.01, -16.5, Math.PI / 2); AN_WIND = 0;
      GS.tcam.yaw = Math.PI / 2; GS.tcam.pitch = -0.16; GS.tcam.want = 4.4; GS.tcam.dist = 4.4; GS.tcam.snap(GS.player);
      TR.pst = { yaw: Math.PI / 2, pitch: -0.2 }; TR.simT = 0; TR.glideT0 = 0; TR.jumped = false; TR.glid = false;
      TR_cue('riser', 2.45);
    },
    sub() { TR_glideInput(); },
    cam: 'third',
    text: [{ a: 2.5, b: 5.0, kind: 'logo', s: 'GOTHAM' }],
  });
  // 5 ── the glide between the towers (gameplay, with the HUD)
  S.push({
    id: 'glide', dur: 10, lb: 0, hud: true, sim: true,
    sub() { TR_glideInput(); },
    cam: 'third',
    text: [{ a: 1.0, b: 4.2, kind: 'tag', s: 'PLANEA ENTRE LOS RASCACIELOS' }],
  });
  // 6 ── the grapple up the police tower, seen from the street beside him
  S.push({
    id: 'grapple', dur: 5, lb: 0, hud: true, sim: true,
    setup() {
      TR_clearWorld();
      TR_resetPlayer(6.5, 26.01, -15.5, Math.PI / 2); GS.player.mode = 'ground';
      GS.tcam.yaw = Math.PI / 2; GS.tcam.pitch = 0.46; GS.tcam.want = 4.2; GS.tcam.dist = 4.2; GS.tcam.snap(GS.player);
      TR.fc = null; TR.fy = undefined;
    },
    input(t) {
      TR_keys(t < 0.3 ? { KeyW: true } : null);
      if (TR_once('grap', t >= 0.36)) IN.grappleEdge = true;
    },
    cam(t) {
      const pl = GS.player.b, u = TR_ease(t / 5);
      const want = [pl.x + 0.5, pl.y + 1.4, pl.z];
      TR.fc = TR.fc ? TR_mix(TR.fc, want, 0.2) : want;
      TR.fy = TR.fy === undefined || t < 0.05 ? 27.8 : TR.fy + (Math.max(27.8, pl.y - 4.5) - TR.fy) * 0.09;
      return { p: [6.2 - 1.6 * u, TR.fy, -9.0 - 1.5 * u], at: TR.fc, fov: 0.92 };
    },
    text: [{ a: 1.4, b: 4.4, kind: 'tag', s: 'TREPA CON EL GARFIO' }],
  });
  // 7..12 ── the districts
  S.push({
    id: 'bridge', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'EL PUENTE DE GOTHAM',
    setup() { TR_cue('whoosh'); TR_cue('stab'); },
    cam(t) { const u = TR_ease(t / 2.5); return { p: [-34 + 6 * u, 38 + 5 * u, B.cz - 14 - 14 * u], at: [5, 52, B.cz - B.tz + 4], fov: 1.08 }; },
  });
  S.push({
    id: 'ferris', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'CARNAVAL DE ARKHAM',
    setup() { TR_cue('whoosh'); TR_cue('stab'); },
    cam(t) { const a = 0.25 + 0.30 * (t / 2.5), R = 52; return { p: [fer[0] + Math.cos(a) * R, 44 + 3 * (t / 2.5), fer[1] + Math.sin(a) * R], at: [fer[0], 50, fer[1]], fov: 1.0 }; },
  });
  S.push({
    id: 'foundry', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'FUNDICIÓN DE ACERO',
    setup() { TR_cue('whoosh'); TR_cue('stab'); },
    cam(t) { const u = TR_ease(t / 2.5); return { p: TR_mix([fou[0] + 36, 66, fou[1] + 30], [fou[0] + 24, 50, fou[1] + 22], u), at: [fou[0] - 2, 34, fou[1] - 2], fov: 1.05 }; },
  });
  S.push({
    id: 'docks', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'MUELLES DE GOTHAM',
    setup() { TR_cue('whoosh'); TR_cue('stab'); },
    cam(t) { const u = TR_ease(t / 2.5); return { p: [cra[0] + 46 - 8 * u, 44 + 3 * u, cra[1] + 40 - 8 * u], at: [cra[0] - 2, 36, cra[1] - 2], fov: 1.05 }; },
  });
  S.push({
    id: 'spire', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'TORRE DE ARKHAM',
    setup() { TR_cue('whoosh'); TR_cue('stab'); TR_flash(0.9, 1.1); TR_cue('thunderNear', 1.05); },
    cam(t) { const u = TR_ease(t / 2.5); return { p: [spi[0] - 62 + 6 * u, 58 + 4 * u, spi[1] + 70 - 6 * u], at: [spi[0], 78 + 22 * u, spi[1]], fov: 0.95 }; },
  });
  S.push({
    id: 'ice', dur: 2.5, lb: 1, hud: false, sim: false, stamp: 'MUELLE HELADO',
    setup() { TR_cue('whoosh'); TR_cue('stab'); },
    cam(t) { const a = -0.9 + 0.35 * (t / 2.5), R = 34; return { p: [pen.cx + Math.cos(a) * R, 46 - 4 * (t / 2.5), pen.cz + Math.sin(a) * R + 8], at: [pen.cx, 30, pen.cz], fov: 1.05 }; },
  });
  // 13 ── a street brawl
  S.push({
    id: 'brawl', dur: 12.5, shield: true, lb: 0, hud: true, sim: true,
    setup() { TR_brawlSetup(); },
    input(t) { TR_brawlInput(t); },
    speed(t) { return TR.vt < TR.slowUntil ? 0.3 : 1; },
    cam(t) { return TR_fightCam(t); },
    text: [{ a: 1.6, b: 4.4, kind: 'tag', s: 'COMBOS · BATARANGS · ESQUIVAS' }],
  });
  // 14 ── lighting a beacon
  S.push({
    id: 'beacon', dur: 2.5, shield: true, lb: 0, hud: true, sim: true,
    setup() {
      TR_clearWorld();
      const b = GS.beacons[2]; b.active = false;
      TR_resetPlayer(b.x, b.y + 0.01, b.z + 7.5, Math.PI); GS.player.mode = 'ground';
      GS.tcam.yaw = 0.35; GS.tcam.pitch = 0.20; GS.tcam.want = 6.2; GS.tcam.dist = 6.2; GS.tcam.snap(GS.player);
    },
    input(t) { TR_keys(t < 1.1 ? { KeyW: true } : null); },
    cam(t) {
      const b = GS.beacons[2], u = TR_ease((t - 0.6) / 1.9);
      return { p: [b.x + 9.5, b.y + 1.0 + 1.5 * u, b.z + 10.5], at: [b.x + 0.5, b.y + 3.5 + 16 * u, b.z + 1.5], fov: 1.12 };
    },
  });
  // 15 ── the Penguin arrives, and bombs fall
  S.push({
    id: 'penguin', dur: 5, shield: true, lb: 0, hud: true, sim: true,
    setup() {
      TR_clearWorld(); GS.bossDone.penguin = false;
      TR_resetPlayer(pen.cx + 1.5, BS_FLOOR + 0.01, pen.cz + 12.5, Math.PI); GS.player.mode = 'ground';
      GS.tcam.yaw = 0.06; GS.tcam.pitch = 0.32; GS.tcam.want = 5.6; GS.tcam.dist = 5.6; GS.tcam.snap(GS.player);
      BS_start('penguin', pen);
    },
    input(t) {
      const B = GS.boss;
      if (B && B.state === 'walk' && t > 2.4) { B.set('rise'); B.phase = 2; }
      if (B && B.state === 'bombs' && !TR.bombsSet) { B.bombsLeft = 6; B.bombT = 0.15; TR.bombsSet = true; }
      if (B && B.state === 'bombs') TR_keys({ KeyD: t > 3.3 && t < 4.0, KeyA: t > 4.2 }); else TR_keys(null);
    },
    cam(t) {
      const B = GS.boss, pl = GS.player.b;
      if (!B) return 'third';
      if (t < 2.7) {                                // from behind Batman, looking up at the umbrella
        return { p: [pl.x + 2.2, pl.y + 0.9, pl.z + 4.2], at: [B.b.x, B.b.y + 2.6, B.b.z], fov: 0.95 };
      }
      const u = TR_ease((t - 2.7) / 2.3);
      return { p: [pen.cx + 12 - 3 * u, 31 + 2 * u, pen.cz + 14], at: [pen.cx + 0.5, 30 + 1.5 * u, pen.cz + 2], fov: 1.12 };
    },
  });
  // 16 ── the dive and the shockwave, in slow motion
  S.push({
    id: 'slam', dur: 3.75, shield: true, lb: 0, hud: true, sim: true,
    setup() { const B = GS.boss; if (B) { B.set('aim'); B.bombsLeft = 0; } TR.jumpWave = false; },
    input(t) {
      TR_keys(null);
      const pl = GS.player;
      if (TR_once('roll', t >= 0.82)) { TR_stickTo(-1, -0.25); IN.dodgeEdge = true; }
      for (const w of GS.waves) {
        const d = Math.hypot(pl.b.x - w.x, pl.b.z - w.z);
        if (!TR.jumpWave && d - w.r < 2.4 && d > w.r && pl.b.onGround) { IN.jump = true; IN.jumpEdge = true; TR.jumpWave = true; }
      }
    },
    speed(t) { return (t > 0.95 && t < 2.6) ? 0.3 : 1; },
    cam(t) { const u = TR_ease(t / 3.75), v = TR_ease((t - 0.6) / 1.4); return { p: TR_mix([pen.cx + 9.5, 30.6, pen.cz + 15.6], [pen.cx + 8.2, 29.6, pen.cz + 15.2], u), at: [pen.cx - 0.5, 35 - 5.4 * v, pen.cz + 10.5], fov: 1.12 }; },
  });
  // 17 ── the Joker steps out of the smoke
  S.push({
    id: 'joker', dur: 5, shield: true, lb: 0, hud: true, sim: true,
    setup() {
      TR_clearWorld(); GS.bossDone.joker = false;
      TR_resetPlayer(jok.cx + 1, BS_FLOOR + 0.01, jok.cz + 6, Math.PI); GS.player.mode = 'ground';
      GS.tcam.yaw = -0.12; GS.tcam.pitch = -0.02; GS.tcam.want = 4.6; GS.tcam.dist = 4.6; GS.tcam.snap(GS.player);
      BS_start('joker', jok);
      GS.boss.b.z = jok.cz - 7;
    },
    input(t) {
      const B = GS.boss;
      if (B && t > 2.0 && B.state === 'hunt' && !TR.cardsDone) { B.set('cards'); TR.cardsDone = true; }
      TR_keys(null);
      if (TR_once('dodge', t >= 3.55)) { IN.stickX = 1; IN.dodgeEdge = true; }
    },
    speed(t) { return (t > 2.95 && t < 4.5) ? 0.33 : 1; },
    cam(t) {
      const B = GS.boss;
      if (t < 2.0 && B) {                               // a close-up of the grin
        const h = B.b.y + 2.05, u = TR_ease(t / 2);
        return { p: [B.b.x + 1.4 - 0.5 * u, h + 0.15, B.b.z + 4.4 - 1.2 * u], at: [B.b.x, h, B.b.z], fov: 0.72 };
      }
      const pl = GS.player.b, J = B ? B.b : pl;
      const dx = J.x - pl.x, dz = J.z - pl.z, d = Math.hypot(dx, dz) || 1;
      return { p: [pl.x - dx / d * 2.4 - dz / d * 0.9, pl.y + 1.9, pl.z - dz / d * 2.4 + dx / d * 0.9], at: [J.x, J.y + 1.6, J.z], fov: 0.78 };
    },
  });
  // 18 ── gas, laughter, gone
  S.push({
    id: 'gas', dur: 2.5, shield: true, lb: 0, hud: true, sim: true,
    setup() { const B = GS.boss; if (B) { B.set('gas'); B.hit = false; } GS.tcam.want = 7; },
    input(t) {
      const B = GS.boss;
      TR_keys(t > 0.4 && t < 1.2 ? { KeyS: true } : null);
      if (B && TR_once('phase', t >= 1.5) && !B.dead) { B.hp = B.maxHp * 0.6; B.phase = 1; B.damage(0.01, 0, 1, 1); }
    },
    cam: 'third',
  });
  // 19 ── back on the tower; the camera lifts away over the city
  S.push({
    id: 'finale', dur: 7.5, lb: 1, hud: false, sim: true,
    setup() { TR_clearWorld(); TR_resetPlayer(38.5, 94.01, -16.5, Math.PI / 2); AN_WIND = 9; TR_flash(4.3, 1.2); TR_cue('thunderNear', 4.6); TR_cue('swell'); },
    cam(t) {
      const u = TR_ease2(t / 7.5);
      const p = TR_path([[33.5, 95.6, -15.2], [30, 100, -12], [16, 122, 6], [-12, 152, 34]], u);
      const at = TR_mix([45, 95, -17], [72, 92, -40], TR_ease(t / 7.5));
      return { p: p, at: at, fov: 1.0 + 0.1 * u };
    },
    text: [{ a: 1.4, b: 5.6, kind: 'tag', s: 'GOTHAM TE NECESITA' }],
  });
  // 20 ── the end card
  S.push({
    id: 'end', dur: 6.25, lb: 1, hud: false, sim: false, dark: 0.55, fadeOut: 1.7,
    setup() { TR_cue('final'); },
    cam(t) { const u = t / 6.25; return { p: [-12 - 10 * u, 152 + 4 * u, 34 + 10 * u], at: [72 - 6 * u, 92, -40], fov: 1.1 }; },
    text: [{ a: 0.25, b: 99, kind: 'endlogo', s: 'GOTHAM', s2: 'MUNDO ABIERTO DE VÓXELES', s3: 'JUEGA AHORA EN TU NAVEGADOR' }],
  });
  TR.shots = S;
  let t = 0; for (const s of S) { s.start = t; t += s.dur; }
  TR.total = t;
  return S.map(s => ({ id: s.id, start: s.start, dur: s.dur }));
}

// ── the leap and the glide ─────────────────────────────────────────────────
function TR_glideInput() {
  const pl = GS.player, t = TR.simT - TR.glideT0;
  if (!TR.jumped) {
    TR_keys({ KeyW: true, sprint: true });
    if (pl.b.x > 37.4) { IN.jump = true; IN.jumpEdge = true; TR.jumped = true; }
    return;
  }
  if (!TR.glid) {
    TR_keys({ KeyW: true, sprint: true, jump: pl.airT < 0.05 });
    if (pl.airT > 0.45) { IN.jumpEdge = true; TR.glid = true; TR_keys(null); }
    GS.tcam.yaw = Math.PI / 2; GS.tcam.pitch = -0.2;
    return;
  }
  TR_keys(null);
  TP_glide(TR.pst, pl, GS.world, t, TR.plan, VX_STEP);
  GS.tcam.yaw = TR.pst.yaw; GS.tcam.pitch = TR.pst.pitch;
}

// ── the brawl: a small fighter that a person would be proud of ────────────
function TR_brawlSetup() {
  TR_clearWorld();
  const mk = (k, x, y, z, hp) => { const e = new Enemy(k, x, y, z, null); if (hp) e.hp = hp; e.a = 0; GS.enemies.push(e); return e; };
  TR.foes = [
    mk('clown', 4.2, 26.01, 52.5), mk('clown', 7.3, 26.01, 50.8), mk('heavy', 5.4, 26.01, 46.5, 8),
    mk('clown', 2.6, 27.01, 44.5), mk('drone', 6.2, 31.2, 47.5),
  ];
  for (const e of TR.foes) { e.home = { x: e.b.x, z: e.b.z, y: e.b.y }; e.a = Math.PI * 0; }
  TR_resetPlayer(5.6, 37, 63.5, Math.PI);
  GS.player.mode = 'air'; GS.player.b.vz = -6.5;
  GS.tcam.yaw = 0.0; GS.tcam.pitch = -0.22; GS.tcam.want = 5.2; GS.tcam.dist = 5.2; GS.tcam.snap(GS.player);
  TR.reinf = false; TR.kills = GS.kills; TR.slowUntil = -1; TR.batDone = false; TR.alerted = false; TR.lastSwing = -9; TR.camYaw = 0; TR.fp = null; TR.fl = null; TR.tgt = null;
}
function drone0() { return GS.enemies.find(e => !e.dead && e.T && e.T.flying) || null; }
function TR_brawlInput(t) {
  const pl = GS.player, pb = pl.b;
  TR_keys(null);
  if (!TR.alerted && pb.onGround) { TR.alerted = true; for (const e of TR.foes) { e.alert = true; e.state = 'chase'; e.cool = 0.6 + Math.random() * 0.9; } }
  // a kill by any blow: slow the world for a beat
  if (GS.kills > TR.kills) { TR.kills = GS.kills; TR.slowUntil = TR.vt + 0.75; }
  // reinforcements run in from the far end of the street
  if (!TR.reinf && t > 6.2) {
    TR.reinf = true;
    for (const [x, z] of [[3.5, 36], [7, 34.5]]) {
      const e = new Enemy('clown', x, 26.01, z, null); e.alert = true; e.state = 'chase'; e.cool = 0.8; e.home = { x: x, z: z };
      GS.enemies.push(e); TR.foes.push(e);
    }
  }
  // a batarang already in the air finds the drone
  if (TR.batDone && drone0()) for (const p of GS.projs) if (p.own === 'player' && !p.target) p.target = drone0();
  const live = GS.enemies.filter(e => !e.dead && !(e.T && e.T.flying));
  const drone = GS.enemies.find(e => !e.dead && e.T && e.T.flying);
  // the batarang at the drone, once it is in front of us
  if (drone && !TR.batDone && t > 5.4) {
    TR.tgt = drone;
    const c = drone.center(), cam = TR.ctrl;
    const dx = c[0] - cam.x, dy = c[1] - cam.y, dz = c[2] - cam.z, d = Math.hypot(dx, dz);
    GS.tcam.yaw += (Math.atan2(dx, -dz) - GS.tcam.yaw) * 0.35; GS.tcam.pitch += (Math.atan2(dy, d) - GS.tcam.pitch) * 0.35;
    if (t > 5.75 && pl.batT <= 0 && pl.atkT <= 0.05) { IN.batEdge = true; TR.batDone = true; }
    return;
  }
  // dodge a swing that is about to land
  for (const e of live) {
    const d = Math.hypot(e.b.x - pb.x, e.b.z - pb.z);
    if (e.state === 'windup' && d < 3.4 && e.stT > e.T.windup * 0.45 && pl.dodgeT <= 0 && pl.dodgeCd <= 0 && pl.atkT <= 0.1) {
      const ax = -(e.b.z - pb.z) / d, az = (e.b.x - pb.x) / d;      // sideways
      TR_stickTo(ax, az); IN.dodgeEdge = true; return;
    }
  }
  if (!live.length) { GS.tcam.yaw += (Math.PI - pl.a + 0.0 - GS.tcam.yaw) * 0; return; }
  let tgt = null, bd = 1e9;
  for (const e of live) { const d = Math.hypot(e.b.x - pb.x, e.b.z - pb.z) + (e.T.heavy ? 2.5 : 0); if (d < bd) { bd = d; tgt = e; } }
  TR.tgt = tgt;
  const dx = tgt.b.x - pb.x, dz = tgt.b.z - pb.z, d = Math.hypot(dx, dz);
  if (d > 2.3) TR_stickTo(dx / d, dz / d, 0.85);
  else if (pl.atkT <= 0.12 || pl.atkQueue === false) { if (TR.vt - TR.lastSwing > 0.14) { TR_stickTo(dx / d, dz / d, 0.3); IN.attackEdge = true; TR.lastSwing = TR.vt; } }
  // the camera trails behind his shoulder, a little to the side
  const behind = Math.atan2(Math.sin(pl.a), -Math.cos(pl.a)) * 0 + (Math.PI - pl.a);
  let dy = behind - GS.tcam.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  GS.tcam.yaw += dy * 0.025;
  GS.tcam.pitch += (-0.16 - GS.tcam.pitch) * 0.05;
}
// A camera for a fight: over his shoulder, turned toward whoever he is fighting,
// low enough to make the thugs look big. Smoothed so it never jerks.
function TR_fightCam(t) {
  const pl = GS.player.b, w = GS.world;
  let tx = pl.x + Math.sin(GS.player.a) * 3, tz = pl.z + Math.cos(GS.player.a) * 3, ty = pl.y + 1.2;
  const tgt = TR.tgt && !TR.tgt.dead ? TR.tgt : null;
  if (tgt) { tx = tgt.b.x; tz = tgt.b.z; ty = tgt.b.y + 1.2; }
  let dx = tx - pl.x, dz = tz - pl.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const sx = -dz, sz = dx;
  const want = [pl.x - dx * 4.3 + sx * 1.5, pl.y + 2.15, pl.z - dz * 4.3 + sz * 1.5];
  const look = [pl.x + (tx - pl.x) * 0.38, pl.y + 1.25 + (ty - pl.y - 1.2) * 0.3, pl.z + (tz - pl.z) * 0.38];
  // keep out of walls
  const hx = pl.x, hy = pl.y + 1.6, hz = pl.z, vx = want[0] - hx, vy = want[1] - hy, vz = want[2] - hz, L = Math.hypot(vx, vy, vz);
  const h = w.raycast(hx, hy, hz, vx / L, vy / L, vz / L, L + 0.3);
  if (h) { const k = Math.max(0.3, (h.t - 0.4) / L); want[0] = hx + vx * k; want[1] = hy + vy * k; want[2] = hz + vz * k; }
  const k = t < 0.05 ? 1 : 0.12;
  TR.fp = TR.fp ? TR_mix(TR.fp, want, k) : want;
  TR.fl = TR.fl ? TR_mix(TR.fl, look, k * 1.2) : look;
  return { p: TR.fp, at: TR.fl, fov: 1.06 };
}

// steer the analog stick so the body walks along world direction (dx, dz)
function TR_stickTo(dx, dz, mag) {
  const yaw = TR.ctrl.yaw, fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
  const m = mag === undefined ? 1 : mag;
  IN.stickX = (dx * rx + dz * rz) * m; IN.stickY = (dx * fx + dz * fz) * m;
}

// ═══════════════════════════════════════════════════════════════════════
//  RUNNING
// ═══════════════════════════════════════════════════════════════════════
function TR_init(o) {
  TR.W = o.W; TR.H = o.H; TR.FPS = o.FPS;
  TR.ctrl = VX.cam; TR.view = new VxCamera(); VX.cam = TR.view;
  UI.compassT = 1e9;                      // no district banners: the film has its own titles
  VX.freeCam = true; GS.spawnOff = true; VX.eyeGlow = 0.5;
  VX_setQuality(3);
  VX.rend.P.rainCount = o.rain || 4000; VX.rend.P.bloom = 0.56; VX.rend.P.grain = 0.012; VX.rend.P.sat = 1.03; VX.rend.P.contrast = 1.09;
  VX_setState('play'); VX.fade = 0; VX.fadeTo = 0; VX.rend.P.fade = 1;
  // the sound log: every effect the game plays, with its time and how near it was
  window.AU_event = function (k, e) {
    let near = 1;
    if (e && e.x !== undefined) near = Math.max(0, 1 - Math.hypot(e.x - TR.view.x, e.z - TR.view.z) / 70);
    TR.ev.push({ t: TR.vt, k: k, near: +near.toFixed(2), kind: e && e.kind });
  };
  TR.ov = document.createElement('canvas'); TR.ov.width = TR.W; TR.ov.height = TR.H; TR.ovx = TR.ov.getContext('2d');
  UI.mapReady = true;           // the minimap needs no cached map for a film
  return TR_build();
}

function TR_seed(n) {
  let st = (n * 2654435761 + 12345) >>> 0;
  Math.random = function () { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function TR_begin(i, vt) {
  TR_seed(1000 + i);
  TR.si = i; TR.shot = TR.shots[i]; TR.t = 0; TR.acc = 0; TR.vt = vt === undefined ? TR.shot.start : vt;
  TR.flashQ = []; TR.cardsDone = false; TR.bombsSet = false; TR.done = {};
  if (TR.shot.setup) TR.shot.setup();
  VX.noPlayer = false;
  TR_camera(0);
  return { id: TR.shot.id, frames: Math.round(TR.shot.dur * TR.FPS) };
}

function TR_camera(dt) {
  const sh = TR.shot;
  let c = typeof sh.cam === 'function' ? sh.cam(TR.t) : sh.cam;
  if (c === 'third' || !c) {
    const v = TR.view, k = TR.ctrl;
    v.x = k.x; v.y = k.y; v.z = k.z; v.yaw = k.yaw; v.pitch = k.pitch; v.fov = k.fov || 1.12;
  } else TR_look(TR.view, c.p, c.at, c.fov);
  VX.world.update(TR.view.x, TR.view.z, 0); VX.far.update(TR.view.x, TR.view.z, 0);
}

// One video frame of time: inputs, simulation, cameras. Rendering is separate so
// the recorder can wait for the world to finish loading in between.
function TR_advance() {
  const sh = TR.shot, dt = 1 / TR.FPS;
  const speed = sh.speed ? sh.speed(TR.t) : 1;
  VX.time += dt * speed; VX.rend.time = VX.time;
  if (sh.sim !== false) {
    GS.player.hurt = sh.shield ? TR_noHurt : Player.prototype.hurt;
    if (sh.noLoot !== false && sh.shield) { for (let i = GS.pickups.length - 1; i >= 0; i--) if (GS.pickups[i].kind !== 'trophy') GS.pickups.splice(i, 1); }
    if (sh.input) sh.input(TR.t);
    TR.acc += dt * speed;
    while (TR.acc >= VX_STEP - 1e-9) {
      if (sh.sub) sh.sub();
      VX.cam = TR.ctrl;                    // the player steers by his own camera...
      VX_simStep(VX_STEP);
      VX.cam = TR.view;                    // ...but the world streams around the film camera
      GS.tcam.update(VX_STEP, TR.ctrl, GS.player, GS.world, { x: 0, y: 0 });
      IN_clearEdges();
      TR.acc -= VX_STEP;
      TR.simT = (TR.simT || 0) + VX_STEP;
    }
  }
  // lightning: a bright double pulse, the exposure kicked up with it
  let fl = 0;
  for (const f of TR.flashQ) { const d = TR.t - f.t; if (d >= 0 && d < 0.5) fl = Math.max(fl, f.p * Math.exp(-d * 11)); }
  VX.rend.P.flash = Math.min(1, fl); VX.rend.P.exposure = 1.45 + fl * 1.6;
  TR_camera(dt);
  UI.hintT = 0;
  if (sh.hud) UI_update(dt);
  VX.rend.P.hurt[3] = Math.max(0, VX.rend.P.hurt[3] - dt * 1.6);
  const pl = GS.player;
  TR.tele.push([+TR.vt.toFixed(3), pl.mode === 'glide' ? +pl.gl.v.toFixed(1) : 0, pl.b.onGround ? 1 : 0, +pl.speedH.toFixed(1), +pl.st.phase.toFixed(2), speed, sh.sim === false ? 0 : 1]);
  TR.t += dt; TR.vt += dt;
  return { t: TR.t, vt: TR.vt };
}

// Draw the frame and the cards over it; return it as JPEG.
function TR_render(q) {
  const sh = TR.shot, W = TR.W, H = TR.H, x = TR.ovx;
  VX.cam = TR.view; VX.hideHud = !sh.hud;
  VX_resize(); VX_draw();
  x.drawImage(document.getElementById('gl'), 0, 0, W, H);
  if (sh.hud) x.drawImage(document.getElementById('hud'), 0, 0, W, H);
  TR_overlay(x, W, H);
  return TR.ov.toDataURL('image/jpeg', q || 0.92);
}

// ── the cards ──────────────────────────────────────────────────────────────
function TR_spaced(x, str, cx, y, size, color, spacing, weight, alpha) {
  x.font = (weight || 600) + ' ' + Math.round(size) + 'px Oswald, "Helvetica Neue", sans-serif';
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  let w = 0; for (const ch of str) w += x.measureText(ch).width + spacing; w -= spacing;
  let px = cx - w / 2;
  x.globalAlpha = alpha === undefined ? 1 : alpha;
  for (const ch of str) {
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillText(ch, px + size * 0.04, y + size * 0.05);
    x.fillStyle = color; x.fillText(ch, px, y);
    px += x.measureText(ch).width + spacing;
  }
  x.globalAlpha = 1;
  return w;
}
function TR_overlay(x, W, H) {
  const sh = TR.shot, t = TR.t, u = H / 1080;
  // letterbox bars ease in and out between shots
  TR.lb += ((sh.lb ? 1 : 0) - TR.lb) * 0.22;
  if (sh.dark) { x.fillStyle = 'rgba(2,3,8,' + (sh.dark * TR_ease(t / 1.2)) + ')'; x.fillRect(0, 0, W, H); }
  for (const c of (sh.text || [])) {
    if (t < c.a || t > c.b) continue;
    const k = Math.min(1, (t - c.a) / 0.45, (c.b - t) / 0.45);
    if (c.kind === 'tag') {
      const sp = 9 * u + 7 * u * (t - c.a) / (c.b - c.a);
      TR_spaced(x, c.s, W / 2, H * (c.y || 0.80), 40 * u, '#e8c34a', sp, 600, k);
    } else if (c.kind === 'logo') {
      const s = 1 + 0.06 * (1 - TR_ease((t - c.a) / 1.2));
      const a = Math.min(1, (t - c.a) / 0.12, (c.b - t) / 0.5);
      TR_spaced(x, c.s, W / 2, H * 0.56, 190 * u * s, '#e8c34a', 46 * u * s, 700, a);
      TR_spaced(x, 'MUNDO ABIERTO DE VÓXELES', W / 2, H * 0.56 + 66 * u, 30 * u, '#d8e2f0', 14 * u, 500, a * TR_ease((t - c.a - 0.35) / 0.5));
    } else if (c.kind === 'endlogo') {
      const a1 = TR_ease((t - c.a) / 0.9), a2 = TR_ease((t - c.a - 0.8) / 0.8), a3 = TR_ease((t - c.a - 1.9) / 0.8);
      const s = 1 + 0.04 * (1 - a1);
      TR_spaced(x, c.s, W / 2, H * 0.50, 210 * u * s, '#e8c34a', 54 * u, 700, a1);
      TR_spaced(x, c.s2, W / 2, H * 0.50 + 76 * u, 34 * u, '#d8e2f0', 16 * u, 500, a2);
      x.globalAlpha = a3; x.fillStyle = '#e8c34a'; x.fillRect(W / 2 - 140 * u, H * 0.50 + 118 * u, 280 * u, 2 * u); x.globalAlpha = 1;
      TR_spaced(x, c.s3, W / 2, H * 0.50 + 168 * u, 26 * u, '#e8c34a', 10 * u, 600, a3);
    }
  }
  if (sh.stamp) {
    const a = Math.min(1, t / 0.25, (sh.dur - t) / 0.25);
    const y = H - (TR.lb > 0.5 ? H * 0.12 + 46 * u : 70 * u);
    x.globalAlpha = a; x.fillStyle = '#e8c34a'; x.fillRect(64 * u, y - 30 * u, 5 * u, 38 * u); x.globalAlpha = 1;
    x.font = '600 ' + Math.round(34 * u) + 'px Oswald, sans-serif'; x.textAlign = 'left';
    x.globalAlpha = a; x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillText(sh.stamp, 86 * u + 2, y + 2); x.fillStyle = '#f0f3f8'; x.fillText(sh.stamp, 86 * u, y); x.globalAlpha = 1;
  }
  const bar = H * 0.12 * TR.lb;
  if (bar > 0.5) { x.fillStyle = '#000'; x.fillRect(0, 0, W, bar); x.fillRect(0, H - bar, W, bar); }
  // fades to and from black
  let f = 0;
  if (sh.fadeIn) f = Math.max(f, 1 - TR_ease(t / sh.fadeIn));
  if (sh.fadeOut) f = Math.max(f, TR_ease((t - (sh.dur - sh.fadeOut)) / sh.fadeOut));
  if (f > 0.002) { x.fillStyle = 'rgba(0,0,0,' + f + ')'; x.fillRect(0, 0, W, H); }
}
