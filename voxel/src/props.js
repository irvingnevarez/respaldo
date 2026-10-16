// ═══════════════════════════════════════════════════════════════════════
//  PROPS — the game's relationship with the places the generator made: beacons
//  that save your progress and let you travel, trophies on the rooftops, the
//  Bat-Signal, the objectives, and the triggers that start the boss fights.
// ═══════════════════════════════════════════════════════════════════════

var WD = { lamp: null, signalOn: true, trophyPool: new Map(), nearBeacon: -1, bossCool: 0, arenaIn: null, travelTo: -1, travelT: 0, objs: [] };

// A round bat-signal on a stick: a yellow disc with the bat cut out of it, two-sided.
function MD_lamp() {
  const M = new VxModel('lamp', 1 / 4);
  const P = M.part('main', null, 0, 0, 0);
  const bat = ['..X.....X..', '.XXX...XXX.', 'XXXXXXXXXXX', 'XX.XXXXX.XX', '...XXXXX...', '....X.X....'];
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    if (Math.hypot(x, y) > 5.6) continue;
    for (const z of [-1, 0]) {
      let c = '#ffe9a0', e = 1.5;
      const bx = x + 5, by = 4 - y;
      if (by >= 0 && by < bat.length && bx >= 0 && bx < 11 && bat[by][bx] === 'X') { c = '#14151c'; e = 0; }
      P.at(x, y + 6, z, c, e);
    }
  }
  M.radius = 2;
  return M;
}

function WD_init() {
  LM_init();
  GS.models.lamp = MD_lamp(); GS.models.lamp.upload(GS.rend.gl);
  GS.beacons = LM.beacons.map(function (b, i) { return { name: b.name, x: b.x, y: b.y, z: b.z, active: i === 0, i: i, spin: Math.random() * 6 }; });
  GS.lastBeacon = 0;
  // trophies: one on the flat roof of roughly every sixth block's tallest building
  LM.trophies = [];
  for (let bx = -18; bx <= 17; bx++) for (let bz = -17; bz <= 16; bz++) {
    const info = WG_blockInfo(bx, bz);
    if (!info.full || info.kind !== 'bld' || info.special || !info.bld.length) continue;
    if (NZ_hash(bx, bz, 5150) % 6 !== 0) continue;
    let best = null, bt = 0;
    for (const b of info.bld) {
      if (b.roof !== 0) continue;
      const t = WG_bTop(b, Math.floor((b.x0 + b.x1) / 2), Math.floor((b.z0 + b.z1) / 2));
      if (t > bt) { bt = t; best = b; }
    }
    if (!best || bt < WG_BASE + 22 || bt > WG_H - 14) continue;
    const x = Math.floor((best.x0 + best.x1) / 2) + 0.5 + 3, z = Math.floor((best.z0 + best.z1) / 2) + 0.5 - 3;
    const top = WG_bTop(best, Math.floor(x), Math.floor(z));
    LM.trophies.push({ id: bx + ',' + bz, x: x, y: top + 1.1, z: z });
  }
  // and a few that only a real climb reaches: the bridge towers, the Ferris wheel, a chimney, the crane
  const B = LM.bridge;
  LM.trophies.push({ id: 'tw0', x: 1.0, y: B.ty + 3.2, z: B.cz - B.tz }, { id: 'tw1', x: 9.0, y: B.ty + 3.2, z: B.cz + B.tz });
  for (const sp of LM.special.values()) {
    const cx = sp.bx * WG_PITCH + WG_ST + 19, cz = sp.bz * WG_PITCH + WG_ST + 19;
    if (sp.type === 'ferris') LM.trophies.push({ id: 'fe', x: cx - 2 + 0.5, y: WG_GY + 2 + 22 + 17 + 3.2, z: cz + 0.5 });
    if (sp.type === 'foundry') LM.trophies.push({ id: 'fo' + sp.bx, x: cx - 12 + 0.5, y: WG_GY + 2 + 46 + 2.4, z: cz - 12 + 0.5 });
    if (sp.type === 'crane') LM.trophies.push({ id: 'cr' + sp.bx, x: cx - 13 + 0.5, y: WG_GY + 2 + 31 + 2.2, z: cz - 13 + 0.5 });
  }
  GS.trophyTotal = LM.trophies.length;
  GS.bossInfo = [
    { id: 'penguin', name: 'EL PINGÜINO', arena: LM.arenas.find(a => a.style === 'penguin'), label: 'PINGÜINO' },
    { id: 'joker', name: 'EL JOKER', arena: LM.arenas.find(a => a.style === 'joker'), label: 'JOKER' },
  ];
  // the signal beam: from the lens straight up into the cloud deck
  const g = LM.gcpd;
  GS.beams = [{ p0: [g.cx + 0.5, g.y + 5.2, g.cz + 0.5], p1: [g.cx + 0.5 + 38, 178, g.cz + 0.5 - 70], tint: [1, 0.93, 0.62], w: 1.5, w1: 11, big: true }];
  GS.emblem = { x: g.cx + 0.5 + 38, y: 176, z: g.cz + 0.5 - 70, half: 46 };
  for (let i = 1; i < GS.beacons.length; i++) GS.beacons[i].beamIdx = -1;
}

// What the compass, minimap and map should point at.
function WD_objectives() {
  const out = WD.objs; out.length = 0;
  for (const bi of GS.bossInfo) {
    if (GS.bossDone[bi.id] || !bi.arena) continue;
    out.push({ x: bi.arena.cx, z: bi.arena.cz, icon: '☠', color: '#ff6a5a', label: bi.label, kind: 'boss' });
  }
  const pl = GS.player;
  let best = null, bd = 1e9;
  for (const b of GS.beacons) {
    if (b.active) { out.push({ x: b.x, z: b.z, icon: '', color: '#e8c34a', label: '', kind: 'beaconOn', quiet: true }); continue; }
    const d = Math.hypot(b.x - pl.b.x, b.z - pl.b.z);
    if (d < bd) { bd = d; best = b; }
    out.push({ x: b.x, z: b.z, icon: '', color: '#6c7a92', label: '', kind: 'beaconOff', quiet: true });
  }
  if (best && bd < 700) out.push({ x: best.x, z: best.z, icon: '▲', color: '#e8c34a', label: 'BALIZA', kind: 'beacon' });
  // compass markers skip the quiet ones
  return out.filter(o => !o.quiet || UI.state === 'map' || true);
}

function WD_travel(i) {
  const pl = GS.player;
  for (const e of GS.enemies) {
    if (!e.dead && e.alert && Math.hypot(e.b.x - pl.b.x, e.b.z - pl.b.z) < 40) { UI.mapMsg = 'HAY ENEMIGOS CERCA, NO PUEDES VIAJAR AHORA'; UI.mapMsgT = 2.2; return; }
  }
  if (GS.boss) { UI.mapMsg = 'NO PUEDES HUIR DE UN JEFE'; UI.mapMsgT = 2.2; return; }
  WD.travelTo = i; WD.travelT = 0;
  VX_setState('play');
  VX.fadeTo = 1; VX.fadeSpeed = 1.6;
}

// Contextual advice, each shown once, when the situation first calls for it.
function WD_tips(dt) {
  const pl = GS.player;
  WD.play = (WD.play || 0) + dt;
  if (pl.mode === 'swim') UI_tip('water', 'Apunta a la orilla y pulsa E: el garfio te saca del agua', 7);
  if (pl.hp <= 2 && !pl.dead) UI_tip('hurt', 'Poca vida: recoge corazones o pisa una baliza para curarte', 7);
  if (WD.play > 14 && !GS.glided && !pl.dead) UI_tip('glide', 'Salta desde un borde y pulsa ESPACIO otra vez: Batman planea', 7);
  if (WD.play > 45) UI_tip('goal', 'Activa balizas, busca trofeos y derrota al Pingüino y al Joker', 8);
  if (WD.play > 80) UI_tip('map', 'Pulsa M para ver el mapa y viajar entre balizas', 6);
  if (pl.mode === 'glide') GS.glided = true;
}

function WD_update(dt) {
  const pl = GS.player, w = GS.world;
  WD_tips(dt);
  // fast travel: fade out, move, fade in
  if (WD.travelTo >= 0) {
    WD.travelT += dt;
    if (WD.travelT > 0.5) {
      const b = GS.beacons[WD.travelTo];
      pl.respawn(b.x + (WD.travelTo === 0 ? 0 : 3.5), b.y + 0.2, b.z); pl.inv = 1;
      GS.tcam.snap(pl); GS.projs.length = 0;
      for (const e of GS.enemies) e.gone = true;
      GS.camps.clear();
      w.dirty = true;
      VX.fadeTo = 0; VX.fadeSpeed = 1.4;
      UI_banner(b.name, 'Viaje rápido');
      WD.travelTo = -1;
    }
    return;
  }
  // beacons
  for (const b of GS.beacons) {
    b.spin += dt * 1.4;
    if (b.i === 0) continue;
    const dx = pl.b.x - b.x, dz = pl.b.z - b.z;
    if (!b.active && Math.abs(dx) < 4.8 && Math.abs(dz) < 4.8 && Math.abs(pl.b.y - b.y) < 5) {
      b.active = true; GS.lastBeacon = b.i;
      pl.hp = pl.maxHp; pl.bats = Math.max(pl.bats, 10);
      GS.score += 500;
      GS.fx.burst(b.x, b.y + 12, b.z, 40, [1, 0.85, 0.4], 1.6, 1.4);
      GS.fx.glow(b.x, b.y + 11, b.z, 14, 1, 0.85, 0.45, 5, 1.2);
      UI_banner('BALIZA ACTIVADA', b.name);
      GS.events.push({ t: 'beacon' });
    } else if (b.active && Math.abs(dx) < 5 && Math.abs(dz) < 5 && Math.abs(pl.b.y - b.y) < 5 && GS.lastBeacon !== b.i) {
      GS.lastBeacon = b.i; UI_hint('Punto de reaparición actualizado', 3);
    }
    // standing on an active beacon slowly restores health
    if (b.active && Math.abs(dx) < 4.5 && Math.abs(dz) < 4.5 && Math.abs(pl.b.y - b.y) < 3 && pl.hp < pl.maxHp && !pl.dead) {
      b.heal = (b.heal || 0) + dt;
      if (b.heal > 1.2) { b.heal = 0; pl.heal(1); GS.fx.text(pl.b.x, pl.b.y + 2.2, pl.b.z, '+1 ❤', '#ff8090', 1); }
    }
  }
  // trophies near the player appear as pickups; far ones are dropped again
  WD.tT = (WD.tT || 0) - dt;
  if (WD.tT <= 0) {
    WD.tT = 0.5;
    for (const t of LM.trophies) {
      if (GS.trophies.has(t.id)) continue;
      const d = Math.hypot(t.x - pl.b.x, t.z - pl.b.z);
      const has = WD.trophyPool.has(t.id);
      if (d < 130 && !has) {
        const p = { kind: 'trophy', id: t.id, x: t.x, y: t.y, z: t.z, t: Math.random() * 6 };
        GS.pickups.push(p); WD.trophyPool.set(t.id, p);
      } else if (d > 190 && has) {
        const k = GS.pickups.indexOf(WD.trophyPool.get(t.id)); if (k >= 0) GS.pickups.splice(k, 1);
        WD.trophyPool.delete(t.id);
      }
    }
    for (const [id, p] of WD.trophyPool) if (GS.trophies.has(id)) WD.trophyPool.delete(id);
  }
  // boss arenas
  WD.bossCool = Math.max(0, WD.bossCool - dt);
  if (!GS.boss && WD.bossCool <= 0 && !pl.dead) {
    for (const bi of GS.bossInfo) {
      if (GS.bossDone[bi.id] || !bi.arena) continue;
      const a = bi.arena;
      if (Math.abs(pl.b.x - a.cx) < 17 && Math.abs(pl.b.z - a.cz) < 17 && Math.abs(pl.b.y - (WG_GY + 2)) < 6) BS_start(bi.id, a);
    }
  }
}

function WD_draw(r, cam) {
  // beacon lamps: the bat disc turns slowly above each pedestal, gold once lit
  const M = GS.models.lamp, gl = r.gl;
  for (const b of GS.beacons) {
    if (b.i === 0) continue;
    const dx = b.x - cam.x, dz = b.z - cam.z;
    if (dx * dx + dz * dz > 260 * 260) continue;
    M4_model(PK_m, b.x, b.y + 12.2 + Math.sin(VX.time * 1.6 + b.i) * 0.15, b.z, b.spin, 0, 0, 1);
    const lit = b.active;
    MD_drawModel(r, M, PK_m, M.poseNew(), { sky: 1, moon: 1, bl: [0, 0, 0], emit: lit ? 1.0 : 0.16, rim: [0, 0, 0], flash: lit ? null : [0.35, 0.4, 0.5, 0.65] });
  }
}

// Beams for the renderer: the big signal always, and a short column over each lit beacon.
function WD_beams() {
  const out = GS.beams ? [GS.beams[0]] : [];
  for (const b of GS.beacons) {
    if (b.i === 0 || !b.active) continue;
    const dx = b.x - VX.cam.x, dz = b.z - VX.cam.z;
    if (dx * dx + dz * dz > 380 * 380) continue;
    out.push({ p0: [b.x, b.y + 12, b.z], p1: [b.x, b.y + 150, b.z], tint: [0.55, 0.8, 1.0], w: 0.7, w1: 7 });
  }
  return out;
}
