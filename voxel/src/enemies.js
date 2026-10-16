// ═══════════════════════════════════════════════════════════════════════
//  ENEMIES — the people who live in the streets, and the camps they stand in.
//
//  Camps are decided by hash from the city grid, so the same street always holds
//  the same gang. A camp exists only while the player is near; clear it and it
//  stays cleared for the session. Each enemy is a little state machine: idle,
//  chase, wind-up (a visible, readable tell), strike, recover, stun, dead.
// ═══════════════════════════════════════════════════════════════════════

var GS = {
  world: null, rend: null, far: null, cam: null, tcam: null, player: null, fx: null, models: {},
  enemies: [], projs: [], pickups: [], camps: new Map(), cleared: new Set(), events: [],
  score: 0, combo: 0, comboT: 0, kills: 0, bestCombo: 0, time: 0, slow: 0,
  boss: null, bossDone: { penguin: false, joker: false },
  trophies: new Set(), beacons: [], lastBeacon: 0,
  texts: [],
};

var EN_TYPES = {
  clown: { model: 'clown', name: 'PAYASO', hp: 3, speed: 5.0, scale: 1.0, hw: 0.32, h: 1.8, melee: true, reach: 2.2, dmg: 1, windup: 0.55, recover: 0.80, score: 100, detect: 26 },
  goon: { model: 'goon', name: 'MATÓN', hp: 3, speed: 4.4, scale: 1.0, hw: 0.32, h: 1.8, ranged: true, dmg: 1, windup: 0.62, recover: 1.1, score: 120, detect: 34, pspeed: 26, prefer: [6, 12] },
  heavy: { model: 'clown', name: 'BRUTO', hp: 9, speed: 3.4, scale: 1.38, hw: 0.44, h: 2.5, melee: true, reach: 3.0, dmg: 2, windup: 0.9, recover: 1.1, score: 300, detect: 26, heavy: true, tint: [0.7, 0.35, 0.35] },
  drone: { model: 'drone', name: 'DRON', hp: 2, speed: 7.5, scale: 1.0, hw: 0.5, h: 0.7, flying: true, hover: 4.6, dmg: 1, windup: 0.7, recover: 1.5, score: 150, detect: 40, pspeed: 20 },
};

// ── lighting a body: cheap probes against the same voxels the terrain was lit from ──
function EN_lightProbe(x, y, z, L) {
  const w = GS.world;
  L.t -= 1;
  if (L.t > 0) return L;
  L.t = 6 + (Math.random() * 4 | 0);
  let sky = 1;
  const up = w.raycast(x, y + 1.6, z, 0, 1, 0, 36);
  if (up) sky = 0.12 + 0.18 * Math.min(1, up.t / 24);
  else {
    // open overhead; a tall wall close by still takes some of the sky
    const side = [[0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
    let o = 0;
    for (const s of side) if (w.raycast(x, y + 1.6, z, s[0], s[1], s[2], 14)) o++;
    sky = 1 - 0.14 * o;
  }
  const mh = w.raycast(x, y + 1.6, z, BX_MOON.x, BX_MOON.y, BX_MOON.z, 60);
  const moon = mh ? 0 : 1;
  let r = 0, g = 0, b = 0;
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const c = w.chunks.get(JB_key(cx + i, cz + j));
    if (!c) continue;
    for (const e of c.emitters) {
      const dx = e[0] - x, dy = e[1] - (y + 1), dz = e[2] - z, d = Math.hypot(dx, dy, dz);
      if (d > 17) continue;
      const f = (1 - d / 17), k = f * f * e[6];
      r += e[3] * k; g += e[4] * k; b += e[5] * k;
    }
  }
  L.tsky = sky; L.tmoon = moon; L.tbl = [Math.min(1.1, r), Math.min(1.1, g), Math.min(1.1, b)];
  return L;
}
function EN_lightStep(L, dt) {
  const k = 1 - Math.exp(-7 * dt);
  if (L.tsky === undefined) { L.sky = 0.6; L.moon = 0.5; L.bl = [0, 0, 0]; return; }
  L.sky += (L.tsky - L.sky) * k; L.moon += (L.tmoon - L.moon) * k;
  for (let i = 0; i < 3; i++) L.bl[i] += (L.tbl[i] - L.bl[i]) * k;
}

// ═══════════════════════════════════════════════════════════════════════
class Enemy {
  constructor(kind, x, y, z, camp) {
    const T = EN_TYPES[kind];
    this.kind = kind; this.T = T; this.camp = camp || null;
    this.b = PH_body(x, y, z, T.hw, T.h);
    this.a = Math.random() * 6.28;
    this.hp = T.hp; this.dead = false; this.deadT = 0;
    this.state = 'idle'; this.stT = 0; this.alert = false;
    this.st = AN_state(); this.st.t = Math.random() * 10; this.pose = null;
    this.flash = 0; this.stun = 0; this.cool = 1 + Math.random() * 1.5;
    this.home = { x: x, z: z }; this.wanderT = Math.random() * 3; this.wx = x; this.wz = z;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.stuck = 0; this.lost = 0;
    this.light = { sky: 0.6, moon: 0.5, bl: [0, 0, 0], t: (Math.random() * 6) | 0 };
    this.hit = false; this.model = GS.models[T.model];
    this.isEnemy = true; this.hov = Math.random() * 6.28; this.orbit = Math.random() * 6.28;
    this.slot = false;
  }
  center() { return [this.b.x, this.b.y + this.T.h * 0.55, this.b.z]; }
  get x() { return this.b.x; } get z() { return this.b.z; }

  damage(dmg, dx, dz, kind) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 1; this.alert = true; this.state = this.state === 'idle' ? 'chase' : this.state;
    if (this.camp) EN_alertCamp(this.camp);
    const heavy = this.T.heavy;
    const d = Math.hypot(dx, dz) || 1, kb = (kind === 3 ? 10 : (kind === 4 ? 4 : 5.5)) * (heavy ? 0.35 : 1);
    this.b.vx += dx / d * kb; this.b.vz += dz / d * kb;
    if (!this.T.flying) this.b.vy = Math.max(this.b.vy, kind === 3 ? 6.5 : 2.4);
    this.stun = heavy ? (kind === 3 ? 0.45 : 0.12) : (kind === 3 ? 0.7 : 0.38);
    if (this.state === 'windup' && !heavy) this.state = 'stun';
    this.stT = 0;
    const c = this.center();
    GS.fx.sparks(c[0], c[1] + 0.2, c[2], kind === 3 ? 16 : 9, dx / d, dz / d, true);
    GS.fx.glow(c[0], c[1] + 0.2, c[2], 2.6, 1, 0.8, 0.45, 1.5, 0.12);
    GS.combo++; GS.comboT = 3.2; GS.bestCombo = Math.max(GS.bestCombo, GS.combo);
    if (this.hp <= 0) this.die(dx, dz);
    return true;
  }
  die(dx, dz) {
    this.dead = true; this.deadT = 0; this.state = 'dead';
    GS.kills++;
    const T = this.T, c = this.center();
    const pts = Math.round(T.score * (1 + Math.min(GS.combo, 12) * 0.1));
    GS.score += pts;
    GS.fx.text(c[0], c[1] + 0.9, c[2], '+' + pts, '#ffe08a', 1);
    GS.fx.debris(c[0], c[1], c[2], 14, T.flying ? [70, 74, 86] : [200, 200, 210], 1.0);
    if (T.flying) { GS.fx.burst(c[0], c[1], c[2], 22, [1, 0.6, 0.25], 1.5, 1.2); GS.fx.puff(c[0], c[1], c[2], 8, 0.5, 0.2); GS.fx.glow(c[0], c[1], c[2], 6, 1, 0.6, 0.25, 4, 0.3); }
    GS.events.push({ t: 'kill', flying: !!T.flying, x: c[0], z: c[2] });
    // loot
    const pl = GS.player, r = Math.random();
    if (r < (pl.hp <= 2 ? 0.55 : 0.22)) GS.pickups.push({ kind: 'heart', x: c[0], y: this.b.y + 0.7, z: c[2], t: 0, vy: 4 });
    else if (r < 0.50) GS.pickups.push({ kind: 'ammo', x: c[0], y: this.b.y + 0.7, z: c[2], t: 0, vy: 4 });
    if (this.camp) {
      this.camp.alive--;
      if (this.camp.alive <= 0) {
        GS.cleared.add(this.camp.key);
        GS.score += 250;
        GS.fx.text(c[0], c[1] + 1.8, c[2], 'ZONA DESPEJADA +250', '#8ff0a8', 1.3);
        GS.events.push({ t: 'cleared' });
      }
    }
    if (T.flying) this.b.vy = -6;
  }

  // Walk toward (tx, tz) around whatever is in the way. Returns false if boxed in.
  steer(dt, tx, tz, speed, accel) {
    const b = this.b, w = GS.world;
    const dx = tx - b.x, dz = tz - b.z;
    const want = Math.atan2(dx, dz);
    const opts = [0, 0.55, -0.55, 1.1, -1.1, 1.75, -1.75];
    let best = null;
    for (let i = 0; i < opts.length; i++) {
      const ang = want + opts[i] * this.strafe;
      if (EN_probe(this, ang)) { best = ang; break; }
    }
    if (best === null) { b.vx *= 0.8; b.vz *= 0.8; return false; }
    const tvx = Math.sin(best) * speed, tvz = Math.cos(best) * speed;
    const k = Math.min(1, accel * dt / Math.max(0.01, Math.hypot(tvx - b.vx, tvz - b.vz)));
    b.vx += (tvx - b.vx) * k; b.vz += (tvz - b.vz) * k;
    this.a += PL_angDiff(this.a, best) * (1 - Math.exp(-11 * dt));
    return true;
  }
  face(dt, tx, tz, rate) {
    this.a += PL_angDiff(this.a, Math.atan2(tx - this.b.x, tz - this.b.z)) * (1 - Math.exp(-(rate || 12) * dt));
  }

  update(dt) {
    const b = this.b, T = this.T, st = this.st, w = GS.world, pl = GS.player;
    st.t += dt; this.stT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.stun = Math.max(0, this.stun - dt);
    this.cool = Math.max(0, this.cool - dt);
    EN_lightProbe(b.x, b.y, b.z, this.light);

    if (this.dead) {
      this.deadT += dt;
      st.dead = Math.min(1, this.deadT / 0.5);
      if (T.flying) {
        b.vy = Math.max(b.vy - PH_GRAV * dt, -40); b.vx *= 0.97; b.vz *= 0.97;
        PH_move(w, b, dt);
        if (b.onGround && this.deadT > 0.1) { this.gone = true; GS.fx.puff(b.x, b.y + 0.3, b.z, 8, 0.5, 0.2); }
      } else {
        b.vx *= Math.exp(-5 * dt); b.vz *= Math.exp(-5 * dt); b.vy = Math.max(b.vy - PH_GRAV * dt, -50);
        PH_move(w, b, dt);
        if (this.deadT > 2.4) { this.gone = true; const c = this.center(); GS.fx.puff(c[0], c[1], c[2], 7, 0.45, 0.3); }
      }
      this.animate(dt);
      return;
    }

    const dx = pl.b.x - b.x, dz = pl.b.z - b.z, dy = pl.b.y - b.y;
    const dist = Math.hypot(dx, dz);
    const aliveP = !pl.dead;

    // noticing the player
    if (!this.alert && aliveP) {
      const seeing = dist < 9 || (dist < T.detect && Math.abs(PL_angDiff(this.a, Math.atan2(dx, dz))) < 1.15 && EN_los(this, pl));
      if (seeing && Math.abs(dy) < 40) { this.alert = true; this.state = 'chase'; if (this.camp) EN_alertCamp(this.camp); GS.events.push({ t: 'alert', x: b.x, z: b.z }); }
    }
    if (this.alert && (!aliveP || dist > T.detect * 2.4)) { this.lost += dt; if (this.lost > 4) { this.alert = false; this.state = 'idle'; this.lost = 0; } } else this.lost = 0;

    if (T.flying) this.updateDrone(dt, dx, dz, dy, dist, aliveP);
    else if (this.stun > 0 || this.state === 'stun') {
      this.state = this.stun > 0 ? 'stun' : 'chase';
      b.vx *= Math.exp(-5 * dt); b.vz *= Math.exp(-5 * dt);
      st.stun = this.stun > 0 ? 1 : 0;
      if (this.stun <= 0) { this.state = 'chase'; st.stun = 0; }
    } else if (T.ranged) this.updateGoon(dt, dx, dz, dist, aliveP);
    else this.updateMelee(dt, dx, dz, dist, aliveP);

    if (!T.flying) {
      if (b.onGround) b.vy = Math.min(b.vy, 0); else b.vy = Math.max(b.vy - PH_GRAV * dt, -50);
      const px = b.x, pz = b.z, was = b.onGround;
      PH_move(w, b, dt);
      if (was && !b.onGround && b.vy <= 0) PH_stick(w, b, 1.06);
      const moved = Math.hypot(b.x - px, b.z - pz) / Math.max(dt, 1e-4);
      if (this.state === 'chase' && moved < 0.6) this.stuck += dt; else this.stuck = 0;
      if (b.y < 8) { this.gone = true; }
    }
    this.animate(dt);
  }

  updateMelee(dt, dx, dz, dist, aliveP) {
    const b = this.b, T = this.T, st = this.st;
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + Math.random() * 3.5;
          this.wx = this.home.x + (Math.random() * 2 - 1) * 5; this.wz = this.home.z + (Math.random() * 2 - 1) * 5;
          if (Math.random() < 0.4) { this.wx = b.x; this.wz = b.z; }
        }
        const d = Math.hypot(this.wx - b.x, this.wz - b.z);
        if (d > 0.8) this.steer(dt, this.wx, this.wz, 2.0, 18);
        else { b.vx *= 0.8; b.vz *= 0.8; }
        break;
      }
      case 'chase': {
        if (!aliveP) { this.state = 'idle'; break; }
        const slotOk = EN_slot(this);
        if (dist > T.reach * 0.8 || !slotOk) {
          if (slotOk) this.steer(dt, GS.player.b.x, GS.player.b.z, T.speed * (dist > 12 ? 1.35 : 1), 26);
          else {                                    // someone else is attacking: circle at a distance
            const a = Math.atan2(-dx, -dz) + this.strafe * 1.3;
            const tx = GS.player.b.x + Math.sin(a) * 4.2, tz = GS.player.b.z + Math.cos(a) * 4.2;
            this.steer(dt, tx, tz, T.speed * 0.8, 20);
            this.face(dt, GS.player.b.x, GS.player.b.z, 8);
          }
        } else { b.vx *= 0.7; b.vz *= 0.7; this.face(dt, GS.player.b.x, GS.player.b.z, 14); }
        if (slotOk && dist < T.reach && this.cool <= 0 && Math.abs(dy_(this)) < 2.2) { this.state = 'windup'; this.stT = 0; this.slot = true; GS.events.push({ t: 'tell', x: b.x, z: b.z }); }
        if (this.stuck > 2.5) { this.strafe = -this.strafe; this.stuck = 0; }
        break;
      }
      case 'windup': {
        b.vx *= 0.6; b.vz *= 0.6;
        this.face(dt, GS.player.b.x, GS.player.b.z, 10);
        st.atk = 1; st.atkP = Math.min(0.26, this.stT / T.windup * 0.26);
        if (this.stT >= T.windup) { this.state = 'strike'; this.stT = 0; this.hit = false; }
        break;
      }
      case 'strike': {
        st.atk = 1; st.atkP = Math.min(1, 0.26 + this.stT / 0.28 * 0.74);
        if (!this.hit && this.stT >= 0.07) {
          this.hit = true;
          const pl = GS.player;
          const dx = pl.b.x - b.x, dz = pl.b.z - b.z, d = Math.hypot(dx, dz);
          const ang = Math.abs(PL_angDiff(this.a, Math.atan2(dx, dz)));
          b.vx += Math.sin(this.a) * 5; b.vz += Math.cos(this.a) * 5;       // a lunge into the swing
          if (d < T.reach + 0.5 && ang < 1.0 && Math.abs(pl.b.y - b.y) < 2.2) pl.hurt(T.dmg, dx, dz, T.heavy);
          GS.events.push({ t: 'enemySwing', x: b.x, z: b.z });
        }
        if (this.stT >= 0.28) { this.state = 'recover'; this.stT = 0; }
        break;
      }
      case 'recover': {
        b.vx *= 0.85; b.vz *= 0.85; st.atk = 0; this.slot = false;
        if (this.stT >= T.recover) { this.state = 'chase'; this.cool = 0.5 + Math.random() * 0.8; }
        break;
      }
    }
    if (this.state !== 'windup' && this.state !== 'strike') { st.atk = 0; if (this.state !== 'recover') this.slot = false; }
  }

  updateGoon(dt, dx, dz, dist, aliveP) {
    const b = this.b, T = this.T, st = this.st, pl = GS.player;
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = 2.5 + Math.random() * 3; this.wx = this.home.x + (Math.random() * 2 - 1) * 4; this.wz = this.home.z + (Math.random() * 2 - 1) * 4; }
        if (Math.hypot(this.wx - b.x, this.wz - b.z) > 0.8) this.steer(dt, this.wx, this.wz, 1.8, 16); else { b.vx *= 0.8; b.vz *= 0.8; }
        break;
      }
      case 'chase': {
        if (!aliveP) { this.state = 'idle'; break; }
        const lo = T.prefer[0], hi = T.prefer[1];
        if (dist > hi) this.steer(dt, pl.b.x, pl.b.z, T.speed * 1.2, 22);
        else if (dist < lo) { this.steer(dt, b.x - dx * 2, b.z - dz * 2, T.speed * 1.1, 24); this.face(dt, pl.b.x, pl.b.z, 8); }
        else {                                       // strafe around the player at a comfortable range
          const a = Math.atan2(-dx, -dz) + this.strafe * 0.35;
          this.steer(dt, pl.b.x + Math.sin(a) * dist, pl.b.z + Math.cos(a) * dist, T.speed * 0.7, 18);
          this.face(dt, pl.b.x, pl.b.z, 9);
        }
        if (this.cool <= 0 && dist < T.detect && EN_los(this, pl)) { this.state = 'windup'; this.stT = 0; GS.events.push({ t: 'tell', x: b.x, z: b.z }); }
        if (this.stuck > 2) { this.strafe = -this.strafe; this.stuck = 0; }
        break;
      }
      case 'windup': {
        b.vx *= 0.7; b.vz *= 0.7;
        this.face(dt, pl.b.x, pl.b.z, 14);
        const ph = Math.atan2(pl.b.y + 1.1 - (b.y + 1.3), Math.max(1, dist));
        st.aim = Math.min(1, st.aim + dt * 6); st.aimPitch = ph;
        if (this.stT >= T.windup) {
          const m = this.muzzle();
          const lead = 0.18;
          const tx = pl.b.x + pl.b.vx * lead, ty = pl.b.y + 1.15 + pl.b.vy * lead * 0.3, tz = pl.b.z + pl.b.vz * lead;
          const ddx = tx - m[0], ddy = ty - m[1], ddz = tz - m[2], l = Math.hypot(ddx, ddy, ddz) || 1;
          PJ_spawn({ kind: 'bullet', x: m[0], y: m[1], z: m[2], vx: ddx / l * T.pspeed, vy: ddy / l * T.pspeed, vz: ddz / l * T.pspeed, dmg: T.dmg, life: 2.2, own: 'enemy' });
          GS.fx.glow(m[0], m[1], m[2], 3, 1, 0.8, 0.4, 3, 0.08);
          GS.fx.sparks(m[0], m[1], m[2], 4, Math.sin(this.a), Math.cos(this.a), true);
          GS.events.push({ t: 'gun', x: m[0], z: m[2] });
          this.state = 'recover'; this.stT = 0;
        }
        break;
      }
      case 'recover': {
        b.vx *= 0.85; b.vz *= 0.85;
        st.aim = Math.max(0, st.aim - dt * 2.5);
        if (this.stT >= T.recover) { this.state = 'chase'; this.cool = 0.5 + Math.random() * 1.2; }
        break;
      }
    }
    if (this.state === 'idle' || this.state === 'chase') st.aim = Math.max(0, st.aim - dt * 4);
  }

  muzzle() {
    const b = this.b;
    return [b.x + Math.sin(this.a) * 0.75 - Math.cos(this.a) * 0.3, b.y + 1.25, b.z + Math.cos(this.a) * 0.75 + Math.sin(this.a) * 0.3];
  }

  updateDrone(dt, dx, dz, dy, dist, aliveP) {
    const b = this.b, T = this.T, pl = GS.player, w = GS.world;
    this.hov += dt * 2.2; this.orbit += dt * 0.55 * this.strafe;
    let tx, ty, tz;
    if (this.alert && aliveP) {
      const R = 7.5;
      tx = pl.b.x + Math.cos(this.orbit) * R; tz = pl.b.z + Math.sin(this.orbit) * R;
      ty = pl.b.y + T.hover + Math.sin(this.hov) * 0.4;
    } else {
      tx = this.home.x + Math.cos(this.orbit) * 4; tz = this.home.z + Math.sin(this.orbit) * 4;
      ty = (this.home.y || b.y) + Math.sin(this.hov) * 0.4;
    }
    const ex = tx - b.x, ey = ty - b.y, ez = tz - b.z, d = Math.hypot(ex, ey, ez) || 1;
    const sp = Math.min(T.speed, d * 2.2);
    const k = 1 - Math.exp(-3 * dt);
    b.vx += (ex / d * sp - b.vx) * k; b.vy += (ey / d * sp - b.vy) * k; b.vz += (ez / d * sp - b.vz) * k;
    if (this.stun > 0) { b.vx *= 0.9; b.vz *= 0.9; }
    PH_move(w, b, dt);
    if (aliveP && this.alert) this.face(dt, pl.b.x, pl.b.z, 6);
    // shooting
    if (this.alert && aliveP && this.stun <= 0) {
      if (this.state !== 'windup' && this.cool <= 0 && dist < T.detect && EN_los(this, pl, true)) { this.state = 'windup'; this.stT = 0; GS.events.push({ t: 'tell', x: b.x, z: b.z }); }
      if (this.state === 'windup' && this.stT >= T.windup) {
        const ddx = pl.b.x - b.x, ddy = pl.b.y + 1.1 - b.y, ddz = pl.b.z - b.z, l = Math.hypot(ddx, ddy, ddz) || 1;
        PJ_spawn({ kind: 'bolt', x: b.x + ddx / l * 0.7, y: b.y + ddy / l * 0.7, z: b.z + ddz / l * 0.7, vx: ddx / l * T.pspeed, vy: ddy / l * T.pspeed, vz: ddz / l * T.pspeed, dmg: T.dmg, life: 2.6, own: 'enemy' });
        GS.events.push({ t: 'gun', x: b.x, z: b.z });
        this.state = 'chase'; this.cool = T.recover + Math.random();
      }
    }
    if (this.state === 'windup') { this.st.atk = 0; this.droneTell = Math.min(1, this.stT / T.windup); } else this.droneTell = 0;
  }

  animate(dt) {
    const st = this.st, b = this.b, T = this.T;
    st.hurt = Math.max(0, this.flash);
    if (T.flying) { st.phase += dt * 30; return; }
    const hs = Math.hypot(b.vx, b.vz);
    const ease = (v, to, r) => v + (to - v) * (1 - Math.exp(-r * dt));
    st.walk = ease(st.walk, b.onGround ? AN_clamp(hs / 5, 0, 1) : 0, 12);
    st.sprint = ease(st.sprint, b.onGround ? AN_clamp((hs - 5) / 3, 0, 0.6) : 0, 8);
    st.phase += dt * (3.0 + hs * 1.0);
    st.air = ease(st.air, b.onGround ? 0 : 1, 14);
    st.vy = b.vy;
    if (!this.dead) st.dead = ease(st.dead, 0, 10);
  }

  draw(r) {
    const b = this.b, T = this.T;
    EN_lightStep(this.light, 1 / 60);
    const M = this.model;
    const sc = T.scale;
    if (T.flying) {
      M4_model(EN_m, b.x, b.y + 0.35, b.z, this.a, 0.06 * Math.sin(this.hov), 0.08 * Math.sin(this.hov * 0.8), 1);
      const P = M.poseNew();
      for (let i = 0; i < 4; i++) P[(1 + i) * 6 + 1] = this.st.phase * (i & 1 ? 1 : -1);
      const flash = this.flash > 0 ? [1, 0.9, 0.8, this.flash * 0.7] : (this.droneTell > 0 ? [1, 0.2, 0.1, 0.35 * (0.5 + 0.5 * Math.sin(this.stT * 40))] : null);
      MD_drawModel(r, M, EN_m, P, { sky: this.light.sky, moon: this.light.moon, bl: this.light.bl, flash: flash, emit: 1 + (this.droneTell || 0) * 1.2, rim: [0.25, 0.1, 0.1] });
      return;
    }
    // the model's origin is at the feet; a dead body lies where it fell
    M4_model(EN_m, b.x, b.y, b.z, this.a, 0, 0, sc);
    this.pose = this.pose || M.poseNew();
    AN_humanoid(M, this.pose, this.st);
    let flash = null;
    if (this.flash > 0) flash = [1, 0.95, 0.85, this.flash * 0.75];
    else if (this.state === 'windup') { const k = 0.5 + 0.5 * Math.sin(this.stT * 34); flash = this.T.melee ? [1, 0.45, 0.1, 0.18 + 0.22 * k] : [1, 0.15, 0.1, 0.12 + 0.2 * k]; }
    const tint = T.tint;
    MD_drawModel(r, M, EN_m, this.pose, { sky: this.light.sky, moon: this.light.moon, bl: this.light.bl, flash: flash, rim: tint ? [0.45, 0.14, 0.12] : [0.28, 0.12, 0.22] });
  }
}
var EN_m = new Float32Array(16);
function dy_(e) { return GS.player.b.y - e.b.y; }

// Can the body at `e` walk one step toward `ang`? Needs free space (a step up of
// one block is allowed) and ground within two blocks below.
function EN_probe(e, ang) {
  const b = e.b, w = GS.world;
  const px = b.x + Math.sin(ang) * 0.9, pz = b.z + Math.cos(ang) * 0.9;
  const saveX = b.x, saveZ = b.z;
  let ok = false;
  if (PH_free(w, b, px, b.y + 0.02, pz)) ok = true;
  else if (b.onGround && PH_free(w, b, px, b.y + 1.06, pz) && PH_free(w, b, b.x, b.y + 1.06, b.z)) ok = true;
  if (!ok) return false;
  // not off a cliff
  const ix = Math.floor(px), iz = Math.floor(pz), y0 = Math.floor(b.y);
  for (let k = 0; k <= 3; k++) if (w.isSolid(ix, y0 - k - (b.y % 1 < 0.02 ? 1 : 0), iz)) return true;
  return false;
}

// An unobstructed line between two bodies (eyes to chest).
function EN_los(e, pl, fromCentre) {
  const a = fromCentre ? e.center() : [e.b.x, e.b.y + 1.5, e.b.z], b = pl.b;
  const dx = b.x - a[0], dy = b.y + 1.2 - a[1], dz = b.z - a[2], d = Math.hypot(dx, dy, dz);
  if (d < 1) return true;
  const h = GS.world.raycast(a[0], a[1], a[2], dx / d, dy / d, dz / d, d - 0.5);
  return !h;
}

// At most two melee enemies attack at once; the rest circle.
function EN_slot(e) {
  if (e.slot) return true;
  let n = 0;
  for (const o of GS.enemies) if (o !== e && o.slot && !o.dead) n++;
  return n < 2;
}

function EN_alertCamp(c) {
  c.alert = true;
  for (const e of c.list) if (!e.dead && !e.alert) { e.alert = true; if (e.state === 'idle') e.state = 'chase'; }
}

// ── queries the player uses ──────────────────────────────────────────────
function EN_pickTarget(x, z, dir, range, half) {
  let best = null, bs = 1e9;
  for (const e of GS.enemies) {
    if (e.dead || e.hp <= 0) continue;
    const dx = e.b.x - x, dz = e.b.z - z, d = Math.hypot(dx, dz);
    if (d > range || d < 0.01) continue;
    if (e.T && e.T.flying && e.b.y - GS.player.b.y > 3.2) continue;
    const ang = Math.abs(PL_angDiff(dir, Math.atan2(dx, dz)));
    if (ang > half) continue;
    const s = d + ang * 3.5;
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}
function EN_pickCrosshair(c, range, cone) {
  let best = null, ba = cone;
  for (const e of GS.enemies) {
    if (e.dead || e.hp <= 0) continue;
    const t = e.center();
    const dx = t[0] - c.x, dy = t[1] - c.y, dz = t[2] - c.z, d = Math.hypot(dx, dy, dz);
    if (d > range || d < 2) continue;
    const dot = (dx * c.fx + dy * c.fy + dz * c.fz) / d;
    const ang = Math.acos(AN_clamp(dot, -1, 1));
    if (ang > ba) continue;
    if (GS.world.raycast(c.x, c.y, c.z, dx / d, dy / d, dz / d, d - 1.2)) continue;
    ba = ang; best = e;
  }
  return best;
}
// Everything within reach and within `half` radians of facing `a`.
function EN_meleeHit(p, a, reach, half, dmg, kind) {
  let n = 0;
  for (const e of GS.enemies) {
    if (e.dead || e.hp <= 0) continue;
    const dx = e.b.x - p.b.x, dz = e.b.z - p.b.z, d = Math.hypot(dx, dz);
    const rr = reach + (e.T ? e.T.hw : 0.4) + (e.isBoss ? e.reachBonus : 0);
    if (d > rr) continue;
    const dy = e.b.y - p.b.y;
    if (dy > 2.2 || dy < -e.b.h) continue;
    if (d > 0.6 && Math.abs(PL_angDiff(a, Math.atan2(dx, dz))) > half) continue;
    if (e.damage(dmg, dx, dz, kind)) n++;
  }
  if (n > 0) { GS.slow = kind === 3 ? 0.11 : 0.05; p.shake = Math.max(p.shake, kind === 3 ? 0.25 : 0.1); }
  return n;
}
function EN_hitSegment(x, y, z, sx, sy, sz, r) {
  for (const e of GS.enemies) {
    if (e.dead || e.hp <= 0) continue;
    const c = e.center(), rad = Math.max(e.b.hw, e.b.h * 0.5) + r;
    if (PH_segSphere(x, y, z, sx, sy, sz, c[0], c[1], c[2], rad) >= 0) return e;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  CAMPS
// ═══════════════════════════════════════════════════════════════════════
var EN_DANGER = {};
EN_DANGER[WG_D.AZOTEAS] = { p: 0.34, n: [2, 3], mix: ['goon', 'goon', 'clown', 'drone'] };
EN_DANGER[WG_D.PUENTE] = { p: 0.30, n: [2, 3], mix: ['goon', 'clown', 'drone'] };
EN_DANGER[WG_D.MUELLES] = { p: 0.42, n: [2, 4], mix: ['goon', 'clown', 'clown', 'drone'] };
EN_DANGER[WG_D.ARKHAM] = { p: 0.44, n: [3, 4], mix: ['clown', 'clown', 'goon', 'drone', 'heavy'] };
EN_DANGER[WG_D.ALCANT] = { p: 0.44, n: [3, 4], mix: ['clown', 'clown', 'clown', 'goon'] };
EN_DANGER[WG_D.FUNDI] = { p: 0.50, n: [3, 5], mix: ['heavy', 'goon', 'clown', 'drone'] };
EN_DANGER[WG_D.HIELO] = { p: 0.46, n: [3, 4], mix: ['goon', 'goon', 'heavy', 'drone'] };
EN_DANGER[WG_D.CARNAVAL] = { p: 0.50, n: [3, 5], mix: ['clown', 'clown', 'heavy', 'drone', 'goon'] };

var EN_MAX = 22;
var EN_tmpCol = { kind: 0, top: 0, b: null };

// A walkable spot near (cx, cz): a street, sidewalk, plaza, lot or park column.
function EN_findSpot(cx, cz, rad, seed, i) {
  const w = GS.world;
  for (let t = 0; t < 14; t++) {
    const x = Math.floor(cx + ((NZ_hash(seed, i * 17 + t, 3) % 1000) / 500 - 1) * rad);
    const z = Math.floor(cz + ((NZ_hash(seed, i * 17 + t, 5) % 1000) / 500 - 1) * rad);
    if (!WG_isLand(x, z)) continue;
    const ci = WG_colInfo(x, z, EN_tmpCol);
    const k = ci.kind;
    if (k === WG_K.WATER || k === WG_K.BUILDING) continue;
    const y = k === WG_K.ROAD ? WG_GY + 1 : WG_GY + 2;
    const probe = PH_body(x + 0.5, y + 0.01, z + 0.5, 0.45, 2.0);
    if (!PH_free(w, probe, probe.x, probe.y, probe.z)) continue;
    return { x: x + 0.5, y: y, z: z + 0.5 };
  }
  return null;
}

function EN_campAt(bx, bz) {
  const info = WG_blockInfo(bx, bz);
  if (!info.full || info.kind === 'water' || info.kind === 'shore') return null;
  if (info.special) return null;
  const D = EN_DANGER[info.d];
  if (!D) return null;
  const s = NZ_hash(bx, bz, 4242);
  if ((s & 1023) / 1023 > D.p) return null;
  const n = D.n[0] + ((s >>> 10) % (D.n[1] - D.n[0] + 1));
  const open = info.kind === 'plaza' || info.kind === 'yard' || info.kind === 'park';
  // an open block holds its camp inside; otherwise it stands in the crossing at the block's corner
  const cx = open ? info.ox + 19 : bx * WG_PITCH + 5, cz = open ? info.oz + 19 : bz * WG_PITCH + 5;
  return { key: bx + ',' + bz, bx: bx, bz: bz, cx: cx, cz: cz, n: n, seed: s, D: D, rad: open ? 14 : 7 };
}

function EN_manage(dt) {
  GS.mgT = (GS.mgT || 0) - dt;
  if (GS.mgT > 0) return;
  GS.mgT = 0.45;
  const pl = GS.player, w = GS.world;
  const pbx = Math.floor(pl.b.x / WG_PITCH), pbz = Math.floor(pl.b.z / WG_PITCH);
  // despawn camps the player has left far behind
  for (const [key, c] of GS.camps) {
    const d = Math.hypot(c.cx - pl.b.x, c.cz - pl.b.z);
    if (d > 190 && !GS.boss) {
      for (const e of c.list) e.gone = true;
      GS.camps.delete(key);
    }
  }
  if (GS.enemies.length >= EN_MAX || GS.spawnOff || GS.boss) return;
  for (let r = 0; r <= 2; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
    const bx = pbx + i, bz = pbz + j, key = bx + ',' + bz;
    if (GS.camps.has(key) || GS.cleared.has(key)) continue;
    const cd = EN_campAt(bx, bz);
    if (!cd) { GS.cleared.add(key); continue; }               // never a camp: remember so it is not recomputed
    const d = Math.hypot(cd.cx - pl.b.x, cd.cz - pl.b.z);
    if (d < 38 || d > 120) continue;                            // never pop in on top of the player
    // only once the chunks it stands on are loaded
    if (w.getBlock(Math.floor(cd.cx), WG_GY, Math.floor(cd.cz)) < 0) continue;
    const camp = { key: key, cx: cd.cx, cz: cd.cz, alive: 0, alert: false, list: [] };
    for (let k = 0; k < cd.n; k++) {
      const spot = EN_findSpot(cd.cx, cd.cz, cd.rad, cd.seed, k);
      if (!spot) continue;
      const kind = cd.D.mix[NZ_hash(cd.seed, k, 9) % cd.D.mix.length];
      const e = new Enemy(kind, spot.x, spot.y, spot.z, camp);
      if (kind === 'drone') { e.b.y = spot.y + 4.5; e.home.y = e.b.y; }
      camp.list.push(e); camp.alive++;
      GS.enemies.push(e);
    }
    if (camp.alive) GS.camps.set(key, camp); else GS.cleared.add(key);
    if (GS.enemies.length >= EN_MAX) return;
  }
}

function EN_update(dt) {
  EN_manage(dt);
  const L = GS.enemies;
  for (let i = L.length - 1; i >= 0; i--) {
    const e = L[i];
    e.update(dt);
    if (e.gone) {
      if (e.camp) { const k = e.camp.list.indexOf(e); if (k >= 0) e.camp.list.splice(k, 1); if (!e.dead) e.camp.alive--; }
      L.splice(i, 1);
    }
  }
  // enemies do not stand inside each other
  for (let i = 0; i < L.length; i++) {
    const a = L[i]; if (a.dead || a.T && a.T.flying) continue;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j]; if (b.dead || b.T && b.T.flying) continue;
      const dx = b.b.x - a.b.x, dz = b.b.z - a.b.z, d = Math.hypot(dx, dz), m = a.b.hw + b.b.hw + 0.15;
      if (d < m && d > 1e-4 && Math.abs(a.b.y - b.b.y) < 1.5) {
        const push = (m - d) * 0.5, ux = dx / d, uz = dz / d;
        if (PH_free(GS.world, a.b, a.b.x - ux * push, a.b.y, a.b.z - uz * push)) { a.b.x -= ux * push; a.b.z -= uz * push; }
        if (PH_free(GS.world, b.b, b.b.x + ux * push, b.b.y, b.b.z + uz * push)) { b.b.x += ux * push; b.b.z += uz * push; }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PICKUPS
// ═══════════════════════════════════════════════════════════════════════
var PK_m = new Float32Array(16);
function PK_update(dt) {
  const pl = GS.player, L = GS.pickups;
  for (let i = L.length - 1; i >= 0; i--) {
    const p = L[i];
    p.t += dt;
    if (p.vy !== undefined) {                                  // a drop pops up and settles
      p.vy -= 18 * dt; p.y += p.vy * dt;
      const g = GS.world.groundY(p.x, p.z, p.y + 1) + 0.55;
      if (p.y < g) { p.y = g; p.vy = undefined; p.base = g; }
    }
    if (p.life !== undefined) { p.life -= dt; if (p.life <= 0) { L.splice(i, 1); continue; } }
    if (pl.dead) continue;
    const dx = pl.b.x - p.x, dy = pl.b.y + 0.9 - p.y, dz = pl.b.z - p.z, d = Math.hypot(dx, dy, dz);
    const wantsIt = p.kind === 'heart' ? pl.hp < pl.maxHp : (p.kind === 'ammo' ? pl.bats < pl.maxBats : true);
    if (wantsIt && d < 4.2 && p.vy === undefined) { const k = Math.min(1, (4.2 - d) * 5 * dt); p.x += dx * k; p.y += dy * k; p.z += dz * k; }
    if (wantsIt && d < 1.2) {
      if (p.kind === 'heart') { pl.heal(1); GS.fx.text(p.x, p.y + 0.6, p.z, '+1 ❤', '#ff8090', 1); }
      else if (p.kind === 'ammo') { pl.bats = Math.min(pl.maxBats, pl.bats + 4); GS.fx.text(p.x, p.y + 0.6, p.z, '+4 BATARANG', '#9fe8ff', 1); }
      else if (p.kind === 'trophy') { GS.trophies.add(p.id); GS.score += 300; GS.fx.text(p.x, p.y + 0.8, p.z, 'TROFEO +300', '#6ff08a', 1.2); }
      GS.fx.burst(p.x, p.y, p.z, 12, p.kind === 'heart' ? [1, 0.3, 0.4] : (p.kind === 'trophy' ? [0.3, 1, 0.5] : [0.6, 0.9, 1]), 1.5, 0.8);
      GS.events.push({ t: 'pickup', kind: p.kind });
      L.splice(i, 1);
    }
  }
}
function PK_draw(r) {
  const cam = GS.cam;
  for (const p of GS.pickups) {
    const M = GS.models[p.kind === 'heart' ? 'heart' : (p.kind === 'trophy' ? 'trophy' : 'crate')];
    const bob = Math.sin(p.t * 3 + (p.id || 0)) * 0.12;
    M4_model(PK_m, p.x, p.y + bob, p.z, p.t * 1.6, 0, 0, p.kind === 'trophy' ? 1.7 : 1.15);
    const L = p.light || (p.light = { sky: 1, moon: 1, bl: [0.3, 0.3, 0.3] });
    MD_drawModel(r, M, PK_m, M.poseNew(), { sky: 1, moon: 1, bl: [0.2, 0.2, 0.2], emit: 1, rim: [0, 0, 0] });
  }
}
