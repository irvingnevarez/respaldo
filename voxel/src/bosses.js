// ═══════════════════════════════════════════════════════════════════════
//  BOSSES — the Penguin on his ice rink and the Joker in his funhouse ring.
//
//  Each fight is a small script of attacks with a visible tell, and a window of
//  vulnerability after it. Both bosses live in GS.enemies like anyone else, so
//  punches, batarangs and knockback need no special cases; this file only decides
//  what they do. A boss that the player outruns, or that kills the player, resets
//  to full health: the arena is always a fresh fight.
// ═══════════════════════════════════════════════════════════════════════

var BS_FLOOR = WG_GY + 2;

function BS_start(id, arena) {
  if (GS.boss) return;
  // clear the camps around the arena: this fight is between the two of them
  for (const e of GS.enemies) if (Math.hypot(e.b.x - arena.cx, e.b.z - arena.cz) < 60) e.gone = true;
  GS.camps.clear();
  const B = id === 'penguin' ? new PenguinBoss(arena) : new JokerBoss(arena);
  GS.boss = B; GS.enemies.push(B);
  GS.waves = []; GS.zones = [];
  UI_banner(B.name, id === 'penguin' ? 'Rey del hielo' : 'El príncipe payaso del crimen');
  UI_hint(id === 'penguin' ? 'Los batarangs alcanzan al Pingüino en vuelo · golpéalo cuando caiga' : 'Esquiva sus cartas · castígalo en cuanto falle', 7);
  GS.events.push({ t: 'bossStart', id: id });
}

function BS_end(reset) {
  const B = GS.boss;
  if (!B) return;
  B.gone = true;
  for (const e of GS.enemies) if (e.bossMinion) e.gone = true;
  GS.boss = null; GS.zones = []; GS.waves = [];
  WD.bossCool = reset ? 6 : 3;           // a beaten boss stays beaten (bossDone), the other one can start at once
}

function BS_update(dt) {
  const B = GS.boss, pl = GS.player;
  if (!B) return;
  // zones of gas and shockwaves belong to the fight
  BS_zones(dt);
  if (pl.dead) { BS_end(true); return; }
  const d = Math.hypot(pl.b.x - B.arena.cx, pl.b.z - B.arena.cz);
  if (d > 78 && !B.dead) { UI_banner(B.name, 'se retira'); BS_end(true); }
}

function BS_zones(dt) {
  const pl = GS.player, fx = GS.fx;
  for (let i = GS.zones.length - 1; i >= 0; i--) {
    const z = GS.zones[i];
    z.life -= dt; z.t += dt;
    if (z.life <= 0) { GS.zones.splice(i, 1); continue; }
    // a green cloud: boiling puffs, and a hurt for anyone standing in it
    if (Math.random() < dt * 26) fx.add(z.x + (Math.random() * 2 - 1) * z.r * 0.8, z.y + 0.1 + Math.random() * 1.6, z.z + (Math.random() * 2 - 1) * z.r * 0.8, 0, 0.9, 0, 0.9, 0.5 + Math.random() * 0.4, 0.22, 0.85, 0.28, 0.6, -0.2, 0.8, -0.5);
    const dx = pl.b.x - z.x, dz = pl.b.z - z.z;
    if (!pl.dead && dx * dx + dz * dz < z.r * z.r && pl.b.y < z.y + 3 && pl.b.y > z.y - 1.5) {
      z.hurt = (z.hurt || 0) - dt;
      if (z.hurt <= 0) { z.hurt = 0.9; pl.hurt(1, dx, dz, false); }
    }
  }
  for (let i = GS.waves.length - 1; i >= 0; i--) {
    const w = GS.waves[i];
    w.r += w.speed * dt;
    // the ring: a handful of shards every frame
    const n = Math.max(6, Math.floor(w.r * 1.6));
    for (let k = 0; k < n; k += 2) {
      const a = (k + Math.random()) / n * Math.PI * 2;
      if (Math.random() < 0.55) fx.add(w.x + Math.cos(a) * w.r, w.y + 0.2, w.z + Math.sin(a) * w.r, 0, 1.6 + Math.random() * 2, 0, 0.3, 0.16, w.c[0], w.c[1], w.c[2], w.c[3], 9, 1, 0.8);
    }
    const dx = pl.b.x - w.x, dz = pl.b.z - w.z, d = Math.hypot(dx, dz);
    if (!w.hit && !pl.dead && Math.abs(d - w.r) < 1.3 && pl.b.y < w.y + 1.0) { w.hit = true; pl.hurt(1, dx, dz, true); }
    if (w.r > w.maxR) GS.waves.splice(i, 1);
  }
}

// A ballistic arc from (x,y,z) to a target, flight time t, gravity g.
function BS_arc(x, y, z, tx, ty, tz, t, g) {
  return [(tx - x) / t, (ty - y) / t + 0.5 * g * t, (tz - z) / t];
}

// ═══════════════════════════════════════════════════════════════════════
class BossBase {
  constructor(arena, name, hp, T) {
    this.arena = arena; this.name = name; this.hp = hp; this.maxHp = hp; this.phases = 3; this.phase = 1;
    this.T = T; this.isBoss = true; this.reachBonus = 0.6; this.bossMinion = false;
    this.b = PH_body(arena.cx, BS_FLOOR + 0.01, arena.cz, T.hw, T.h);
    this.a = 0; this.dead = false; this.deadT = 0; this.state = 'intro'; this.stT = 0; this.flash = 0;
    this.st = AN_state(); this.pose = null; this.alert = true; this.camp = null;
    this.light = { sky: 1, moon: 1, bl: [0.2, 0.2, 0.25], t: 0 };
    this.hurtStreak = 0; this.streakT = 0; this.slot = false; this.stun = 0;
    this.hit = false;
  }
  center() { return [this.b.x, this.b.y + this.T.h * 0.55, this.b.z]; }
  get x() { return this.b.x; } get z() { return this.b.z; }
  set(state) { this.state = state; this.stT = 0; this.hit = false; }

  // clamp a boss to the arena
  keepIn(m) {
    const A = this.arena, b = this.b;
    b.x = Math.max(A.cx - m, Math.min(A.cx + m, b.x)); b.z = Math.max(A.cz - m, Math.min(A.cz + m, b.z));
  }

  damage(dmg, dx, dz, kind) {
    if (this.dead || !this.vulnerable()) { this.deflect(dx, dz); return false; }
    dmg *= this.damageMul();
    this.hp -= dmg; this.flash = 1;
    this.streakT = 3; this.hurtStreak++;
    const d = Math.hypot(dx, dz) || 1;
    this.b.vx += dx / d * (kind === 3 ? 3.5 : 1.2); this.b.vz += dz / d * (kind === 3 ? 3.5 : 1.2);
    const c = this.center();
    GS.fx.sparks(c[0], c[1] + 0.3, c[2], kind === 3 ? 18 : 10, dx / d, dz / d, true);
    GS.fx.glow(c[0], c[1], c[2], 4, 1, 0.8, 0.4, 3, 0.12);
    GS.combo++; GS.comboT = 3.2; GS.bestCombo = Math.max(GS.bestCombo, GS.combo);
    GS.events.push({ t: 'bossHit' });
    this.onHurt(dmg, kind);
    // phase boundaries
    const k = this.hp / this.maxHp, ph = k > 0.667 ? 1 : (k > 0.333 ? 2 : 3);
    if (ph > this.phase && this.hp > 0) { this.phase = ph; this.onPhase(ph); }
    if (this.hp <= 0) this.die();
    return true;
  }
  vulnerable() { return true; }
  damageMul() { return 1; }
  deflect(dx, dz) {
    // a shielded boss rings off a blow, and the player knows it
    const c = this.center();
    GS.fx.sparks(c[0], c[1], c[2], 4, 0, 0, false);
    GS.events.push({ t: 'clink', x: c[0], y: c[1], z: c[2] });
  }
  onHurt() { } onPhase() { }

  die() {
    this.dead = true; this.deadT = 0; this.set('dead');
    const c = this.center();
    GS.fx.burst(c[0], c[1], c[2], 60, [1, 0.8, 0.4], 1.6, 1.8);
    GS.fx.debris(c[0], c[1], c[2], 30, this.debrisColor, 1.6);
    GS.fx.puff(c[0], c[1], c[2], 14, 0.7, 0.3);
    GS.fx.glow(c[0], c[1], c[2], 10, 1, 0.8, 0.5, 6, 0.6);
    GS.score += 5000;
    GS.fx.text(c[0], c[1] + 2, c[2], 'JEFE DERROTADO +5000', '#ffe08a', 1.6);
    GS.slow = 0.5;
    for (const e of GS.enemies) if (e.bossMinion) e.damage(99, 0, 1, 3);
    GS.bossDone[this.id] = true;
    UI_banner(this.name, 'derrotado');
    GS.events.push({ t: 'bossDown', id: this.id });
    for (let i = 0; i < 3; i++) GS.pickups.push({ kind: 'heart', x: c[0] + (i - 1) * 1.2, y: this.b.y + 0.8, z: c[2], t: 0, vy: 6 });
    GS.pickups.push({ kind: 'ammo', x: c[0], y: this.b.y + 0.8, z: c[2] + 1.2, t: 0, vy: 6 });
    this.winT = 3.8;
  }

  baseUpdate(dt) {
    this.st.t += dt; this.stT += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.streakT -= dt; if (this.streakT <= 0) this.hurtStreak = 0;
    EN_lightProbe(this.b.x, this.b.y, this.b.z, this.light);
    this.st.hurt = this.flash;
  }

  // shared end-of-fight handling
  finishDeath(dt) {
    this.deadT += dt;
    this.st.dead = Math.min(1, this.deadT / 0.9);
    this.b.vx *= Math.exp(-4 * dt); this.b.vz *= Math.exp(-4 * dt); this.b.vy = Math.max(this.b.vy - PH_GRAV * dt, -50);
    PH_move(GS.world, this.b, dt);
    if (this.winT !== undefined) {
      this.winT -= dt;
      if (this.winT <= 0) {
        this.winT = undefined;
        BS_end(false);
        if (GS.bossDone.penguin && GS.bossDone.joker) { VX_setState('win'); VX.fadeTo = 0; }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  THE PENGUIN
// ═══════════════════════════════════════════════════════════════════════
class PenguinBoss extends BossBase {
  constructor(arena) {
    super(arena, 'EL PINGÜINO', 44, { hw: 0.95, h: 2.9, flying: false });
    this.id = 'penguin'; this.model = GS.models.penguin; this.scale = 1.75;
    this.debrisColor = [30, 32, 40];
    this.b.y = BS_FLOOR + 18; this.b.vy = -7;
    this.open = 1; this.bombsLeft = 0; this.bombT = 0; this.orbit = 0; this.cool = 2; this.target = null; this.spawned2 = false; this.spawned3 = false;
    this.anim = { open: 1, fly: 0, wob: 0 };
    this.walkPh = 0; this.nextSpecial = 4;
    this.set('intro');
    this.pose = this.model.poseNew();
  }
  vulnerable() { return this.state !== 'intro' && this.state !== 'rise' && this.state !== 'dead'; }
  damageMul() {
    if (this.state === 'dazed') return 1.6;
    if (this.state === 'walk' || this.state === 'swing' || this.state === 'shoot') return 0.55;   // the umbrella takes the blows
    return 1;
  }
  onHurt() { if (this.state === 'walk' && this.hurtStreak >= 4) { this.set('rise'); this.hurtStreak = 0; } }
  onPhase(ph) {
    GS.fx.text(this.b.x, this.b.y + 3.5, this.b.z, ph === 2 ? '¡ESBIRROS!' : '¡NO ME RENDIRÉ!', '#ff8a70', 1.3);
    if (ph === 2 && !this.spawned2) { this.spawned2 = true; this.summon(['goon', 'goon']); }
    if (ph === 3 && !this.spawned3) { this.spawned3 = true; this.summon(['drone', 'drone']); }
    if (this.state === 'walk' || this.state === 'swing') this.set('rise');
  }
  summon(kinds) {
    const A = this.arena;
    kinds.forEach((k, i) => {
      const a = (i + 0.5) * Math.PI + Math.random();
      const x = A.cx + Math.cos(a) * 14, z = A.cz + Math.sin(a) * 14;
      const e = new Enemy(k, x, BS_FLOOR + (k === 'drone' ? 5 : 0.01), z, null);
      e.alert = true; e.state = 'chase'; e.bossMinion = true; e.home = { x: x, z: z, y: e.b.y };
      GS.enemies.push(e);
      GS.fx.puff(x, BS_FLOOR + 1, z, 8, 0.6, 0.3);
    });
  }

  update(dt) {
    const b = this.b, pl = GS.player, w = GS.world, A = this.arena;
    this.baseUpdate(dt);
    this.cool = Math.max(0, this.cool - dt);
    if (this.dead) { this.finishDeath(dt); return; }
    const dx = pl.b.x - b.x, dz = pl.b.z - b.z, dist = Math.hypot(dx, dz);
    const pf = this.phase;
    const spd = [0, 3.6, 4.4, 5.2][pf];
    const face = (r) => { this.a += PL_angDiff(this.a, Math.atan2(dx, dz)) * (1 - Math.exp(-(r || 8) * dt)); };
    switch (this.state) {
      case 'intro': {
        // he drifts down under his open umbrella
        b.vy = Math.max(-7, b.vy - 4 * dt);
        b.vx *= 0.9; b.vz *= 0.9;
        this.a = Math.atan2(dx, dz);
        PH_move(w, b, dt);
        if (b.onGround || b.y <= BS_FLOOR + 0.05) { b.y = BS_FLOOR + 0.01; b.vy = 0; GS.fx.dust(b.x, b.y, b.z, 18, 2.0); GS.waves.push({ x: b.x, y: BS_FLOOR, z: b.z, r: 0.5, speed: 10, maxR: 9, hit: true, c: [0.7, 0.85, 1, 0.6] }); this.set('walk'); GS.events.push({ t: 'slamLand' }); }
        break;
      }
      case 'walk': {
        this.anim.open = Math.max(0, this.anim.open - dt * 4);
        face(8);
        if (dist > 2.4) {
          const k = Math.min(1, 14 * dt), tx = dx / dist * spd, tz = dz / dist * spd;
          b.vx += (tx - b.vx) * k; b.vz += (tz - b.vz) * k;
        } else { b.vx *= 0.8; b.vz *= 0.8; }
        this.walkPh += dt * (3 + Math.hypot(b.vx, b.vz) * 1.4);
        // melee when close, a special when the timer says so
        if (dist < 3.6 && this.cool <= 0) { this.set('swing'); GS.events.push({ t: 'tell', x: b.x, z: b.z }); }
        this.nextSpecial -= dt;
        if (this.nextSpecial <= 0) { this.nextSpecial = [0, 5.5, 4.2, 3.4][pf]; if (pf === 3 && Math.random() < 0.4 && dist > 5) this.set('shoot'); else this.set('rise'); }
        break;
      }
      case 'swing': {
        b.vx *= 0.7; b.vz *= 0.7; face(10);
        this.anim.swing = Math.min(1, this.stT / 0.75);
        if (this.stT > 0.75 && !this.hit) {
          this.hit = true;
          const d = Math.hypot(dx, dz), ang = Math.abs(PL_angDiff(this.a, Math.atan2(dx, dz)));
          b.vx += Math.sin(this.a) * 4; b.vz += Math.cos(this.a) * 4;
          if (d < 4.2 && ang < 1.1 && Math.abs(pl.b.y - b.y) < 2.5) pl.hurt(1, dx, dz, true);
          GS.fx.dust(b.x + Math.sin(this.a) * 2.4, b.y, b.z + Math.cos(this.a) * 2.4, 6, 1.0);
          GS.events.push({ t: 'enemySwing', x: b.x, z: b.z });
        }
        if (this.stT > 1.35) { this.cool = 1.4; this.anim.swing = 0; this.set('walk'); }
        break;
      }
      case 'shoot': {
        // phase 3: three umbrella shots in a fan
        b.vx *= 0.8; b.vz *= 0.8; face(14);
        this.anim.swing = 0;
        if (this.stT > 0.7 && !this.hit) {
          this.hit = true;
          const m = [b.x + Math.sin(this.a) * 1.4, b.y + 1.9, b.z + Math.cos(this.a) * 1.4];
          for (let i = -1; i <= 1; i++) {
            const a = this.a + i * 0.2, ty = pl.b.y + 1.1 - m[1], hd = Math.hypot(dx, dz) || 1;
            PJ_spawn({ kind: 'bullet', x: m[0], y: m[1], z: m[2], vx: Math.sin(a) * 24, vy: ty / hd * 24, vz: Math.cos(a) * 24, dmg: 1, life: 2.4, own: 'enemy' });
          }
          GS.fx.glow(m[0], m[1], m[2], 4, 1, 0.8, 0.4, 4, 0.1);
          GS.events.push({ t: 'gun', x: m[0], z: m[2] });
        }
        if (this.stT > 1.5) { this.cool = 1.2; this.set('walk'); }
        break;
      }
      case 'rise': {
        this.anim.open = Math.min(1, this.anim.open + dt * 5);
        b.vy += (11 - b.vy) * Math.min(1, 6 * dt);
        b.vx *= 0.9; b.vz *= 0.9; face(8);
        PH_move(w, b, dt);
        if (b.y > BS_FLOOR + 7 || this.stT > 1.2) { this.bombsLeft = [0, 4, 6, 8][pf]; this.bombT = 0.4; this.orbit = Math.atan2(b.z - A.cz, b.x - A.cx); this.set('bombs'); }
        break;
      }
      case 'bombs': {
        // circle the rink under the umbrella, dropping bombs where the player will be
        this.anim.open = 1;
        this.orbit += dt * (0.8 + pf * 0.2);
        const R = 9.5, tx = A.cx + Math.cos(this.orbit) * R, tz = A.cz + Math.sin(this.orbit) * R, ty = BS_FLOOR + 7.5 + Math.sin(this.stT * 2) * 0.5;
        b.vx += ((tx - b.x) * 3 - b.vx) * Math.min(1, 5 * dt); b.vz += ((tz - b.z) * 3 - b.vz) * Math.min(1, 5 * dt); b.vy += ((ty - b.y) * 4 - b.vy) * Math.min(1, 6 * dt);
        b.vx = Math.max(-14, Math.min(14, b.vx)); b.vz = Math.max(-14, Math.min(14, b.vz));
        PH_move(w, b, dt); face(6);
        this.bombT -= dt;
        if (this.bombT <= 0 && this.bombsLeft > 0) {
          this.bombT = [0, 0.95, 0.8, 0.65][pf]; this.bombsLeft--;
          const lead = 0.5, tpx = pl.b.x + pl.b.vx * lead, tpz = pl.b.z + pl.b.vz * lead;
          const T = 0.95, v = BS_arc(b.x, b.y - 0.6, b.z, tpx, pl.b.y + 0.4, tpz, T, 22);
          PJ_spawn({ kind: 'bomb', x: b.x, y: b.y - 0.6, z: b.z, vx: v[0], vy: v[1], vz: v[2], dmg: 1, life: 1.6, own: 'enemy', heavy: true, grav: 22 });
          GS.events.push({ t: 'throw' });
        }
        if (this.bombsLeft <= 0 && this.bombT <= 0.2) { this.set('aim'); this.target = null; }
        break;
      }
      case 'aim': {
        // hover over the player, then lock the spot he will land on
        const tx = pl.b.x + pl.b.vx * 0.2, tz = pl.b.z + pl.b.vz * 0.2, ty = BS_FLOOR + 9;
        b.vx += ((tx - b.x) * 4 - b.vx) * Math.min(1, 8 * dt); b.vz += ((tz - b.z) * 4 - b.vz) * Math.min(1, 8 * dt); b.vy += ((ty - b.y) * 4 - b.vy) * Math.min(1, 6 * dt);
        PH_move(w, b, dt);
        this.anim.open = 1; this.anim.wob = 1;
        if (this.stT < 0.8) { this.target = { x: pl.b.x, z: pl.b.z }; }
        if (this.stT >= 1.0 - (pf - 1) * 0.1) { this.set('dive'); this.anim.open = 0; b.vx = b.vz = 0; if (this.target) { b.x = this.target.x; b.z = this.target.z; } GS.events.push({ t: 'tell', x: b.x, z: b.z }); }
        break;
      }
      case 'dive': {
        b.vy = Math.max(b.vy - 80 * dt, -40); b.vx = b.vz = 0;
        PH_move(w, b, dt);
        if (b.onGround || b.y <= BS_FLOOR + 0.05) {
          b.y = BS_FLOOR + 0.01; b.vy = 0;
          GS.waves.push({ x: b.x, y: BS_FLOOR, z: b.z, r: 0.6, speed: 15, maxR: 17, hit: false, c: [0.75, 0.9, 1, 0.8] });
          GS.fx.dust(b.x, b.y, b.z, 26, 2.4); GS.fx.debris(b.x, b.y + 0.3, b.z, 16, [170, 205, 230], 1.4);
          GS.fx.glow(b.x, b.y + 0.6, b.z, 8, 0.7, 0.9, 1, 2.2, 0.3);
          GS.slow = 0.12; pl.shake = Math.max(pl.shake, 0.6);
          GS.events.push({ t: 'slamLand' });
          this.set('dazed');
        }
        break;
      }
      case 'dazed': {
        b.vx *= 0.8; b.vz *= 0.8; this.anim.open = 0;
        const D = [0, 3.6, 3.0, 2.4][pf];
        if (this.stT > D) { this.cool = 1; this.set('walk'); this.nextSpecial = [0, 4.5, 3.6, 3.0][pf]; }
        break;
      }
    }
    if (this.state !== 'dive' && this.state !== 'rise' && this.state !== 'bombs' && this.state !== 'aim' && this.state !== 'intro') {
      b.vy = b.onGround ? 0 : Math.max(b.vy - PH_GRAV * dt, -50);
      const px = b.x, pz = b.z;
      PH_move(w, b, dt);
    }
    this.keepIn(17);
  }

  draw(r) {
    const b = this.b, M = this.model, st = this.st, P = this.pose;
    EN_lightStep(this.light, 1 / 60);
    P.fill(0);
    const A = this.anim, t = st.t;
    const flying = (this.state === 'bombs' || this.state === 'rise' || this.state === 'aim' || this.state === 'intro');
    const dead = st.dead;
    // 0 body 1 head 2 flipL 3 flipR 4 footL 5 footR 6 cane 7 brolly
    const wp = this.walkPh;
    P[0 * 6 + 1] = Math.sin(wp) * 0.14; P[0 * 6 + 2] = Math.sin(wp * 1) * 0.07;     // waddle
    P[0 * 6 + 4] = Math.abs(Math.cos(wp)) * 0.4;
    P[4 * 6] = Math.sin(wp) * 0.55; P[5 * 6] = -Math.sin(wp) * 0.55;
    P[2 * 6 + 2] = 0.12 + Math.sin(wp) * 0.1; P[3 * 6 + 2] = -0.12 - Math.sin(wp) * 0.1;
    if (flying) {
      const k = 1;
      P[2 * 6 + 2] = 0.9 + Math.sin(t * 9) * 0.15; P[3 * 6 + 2] = -0.9 - Math.sin(t * 9) * 0.15;
      P[4 * 6] = -0.4; P[5 * 6] = -0.4;
      P[0 * 6 + 4] = 0;
    }
    if (this.state === 'swing') {
      const s = AN_strike(Math.min(1, A.swing || 0));
      P[3 * 6] = -2.4 * s; P[3 * 6 + 2] = -0.3;         // the cane comes round overhead
      P[0 * 6 + 1] = 0.5 * s;
    }
    if (this.state === 'shoot') { P[3 * 6] = -1.55; }
    if (this.state === 'dive') { P[4 * 6] = -0.7; P[5 * 6] = -0.7; P[2 * 6 + 2] = 1.3; P[3 * 6 + 2] = -1.3; P[0 * 6] = 0.5; }
    if (this.state === 'dazed') {
      P[1 * 6 + 1] = Math.sin(t * 9) * 0.5; P[1 * 6 + 2] = Math.sin(t * 7) * 0.25;
      P[0 * 6] = 0.25; P[0 * 6 + 2] = Math.sin(t * 5) * 0.12;
    }
    // the cane is shown when the umbrella is shut, the open one when he flies
    P[6 * 6 + 5] = A.open > 0.5 ? 999 : 0;
    P[7 * 6 + 5] = A.open > 0.5 ? 0 : 999;
    if (A.open > 0.5) P[7 * 6 + 2] = Math.sin(t * 4) * 0.05;
    if (dead) { P[0] = -1.2 * dead; P[0 * 6 + 4] = -5 * dead; }
    const scale = this.scale;
    M4_model(PK_m, b.x, b.y - (this.state === 'dead' ? 0 : 0), b.z, this.a, 0, 0, scale);
    let flash = null;
    if (this.flash > 0) flash = [1, 0.95, 0.85, this.flash * 0.7];
    else if (this.state === 'swing') { const k = 0.5 + 0.5 * Math.sin(this.stT * 30); flash = [1, 0.4, 0.1, 0.15 + 0.2 * k * Math.min(1, this.stT * 1.4)]; }
    else if (this.state === 'aim') { const k = 0.5 + 0.5 * Math.sin(this.stT * 26); flash = [1, 0.2, 0.1, 0.15 + 0.2 * k]; }
    MD_drawModel(r, M, PK_m, P, { sky: this.light.sky, moon: this.light.moon, bl: this.light.bl, flash: flash, rim: [0.30, 0.34, 0.52] });
    // a danger marker where the dive will land
    if (this.state === 'aim' && this.target) {
      GS.fx.add(this.target.x, BS_FLOOR + 0.15, this.target.z, 0, 0, 0, 0.05, 2.2 + 0.4 * Math.sin(this.stT * 20), 1, 0.2, 0.15, 1.4, 0, 0, 0);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  THE JOKER
// ═══════════════════════════════════════════════════════════════════════
class JokerBoss extends BossBase {
  constructor(arena) {
    super(arena, 'EL JOKER', 48, { hw: 0.4, h: 2.3, flying: false });
    this.id = 'joker'; this.model = GS.models.joker; this.scale = 1.25;
    this.debrisColor = [110, 50, 150];
    this.b.x = arena.cx; this.b.z = arena.cz - 11;
    this.cool = 1.5; this.hidden = 0; this.nextHit = 0; this.laugh = 0; this.minionsAlive = 0; this.lastTeleport = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.attackQ = 0; this.gasLeft = 0;
    this.set('intro');
    this.pose = this.model.poseNew();
    GS.fx.puff(this.b.x, BS_FLOOR + 1, this.b.z, 20, 0.8, 0.5);
    GS.fx.burst(this.b.x, BS_FLOOR + 1.2, this.b.z, 24, [0.6, 0.3, 0.9], 1.2, 1.0);
  }
  vulnerable() { return this.state !== 'intro' && this.state !== 'gone' && this.state !== 'dead'; }
  damageMul() { return (this.state === 'summon' || this.state === 'stunned') ? 1.5 : 1; }
  onHurt() {
    // pestered too much, he vanishes
    if (this.hurtStreak >= 3 && this.state !== 'gone' && this.state !== 'stunned') { this.set('gone'); this.hurtStreak = 0; this.vanish(); }
  }
  onPhase(ph) {
    GS.fx.text(this.b.x, this.b.y + 3.3, this.b.z, ph === 2 ? '¡JA JA JA!' : '¡SE ACABÓ EL CHISTE!', '#c58bff', 1.3);
    this.set('gone'); this.vanish();
    this.attackQ = ph === 2 ? 'summon' : 'gas';
  }
  vanish() {
    GS.fx.puff(this.b.x, this.b.y + 1, this.b.z, 16, 0.7, 0.45);
    GS.fx.burst(this.b.x, this.b.y + 1, this.b.z, 22, [0.65, 0.3, 1], 1.4, 1.2);
    GS.events.push({ t: 'poof' });
    this.hidden = 0.7;
  }
  pickSpot() {
    const A = this.arena, pl = GS.player;
    let best = null, bs = -1;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 9;
      const x = A.cx + Math.cos(a) * r, z = A.cz + Math.sin(a) * r;
      const d = Math.hypot(x - pl.b.x, z - pl.b.z);
      if (d > bs && d > 7) { bs = d; best = [x, z]; }
    }
    return best || [A.cx, A.cz - 10];
  }
  minions() { let n = 0; for (const e of GS.enemies) if (e.bossMinion && !e.dead) n++; return n; }

  update(dt) {
    const b = this.b, pl = GS.player, w = GS.world, A = this.arena;
    this.baseUpdate(dt);
    this.cool = Math.max(0, this.cool - dt);
    if (this.dead) { this.finishDeath(dt); return; }
    const dx = pl.b.x - b.x, dz = pl.b.z - b.z, dist = Math.hypot(dx, dz);
    const pf = this.phase;
    const face = (r) => { this.a += PL_angDiff(this.a, Math.atan2(dx, dz)) * (1 - Math.exp(-(r || 10) * dt)); };
    switch (this.state) {
      case 'intro': {
        face(5);
        if (this.stT > 1.8) { this.set('hunt'); this.cool = 0.8; }
        break;
      }
      case 'gone': {
        // invisible: reappear somewhere else, ready to attack
        this.hidden -= dt;
        if (this.hidden <= 0) {
          const s = this.pickSpot();
          b.x = s[0]; b.z = s[1]; b.y = BS_FLOOR + 0.01; b.vx = b.vz = 0;
          this.vanish(); this.hidden = 0;
          this.cool = 0.35;
          const q = this.attackQ; this.attackQ = 0;
          this.set(q === 'summon' ? 'summon' : (q === 'gas' ? 'gas' : 'hunt'));
        }
        break;
      }
      case 'hunt': {
        face(9);
        // keep a lecturing distance, circling
        let want = 0;
        if (dist < 7) want = -1; else if (dist > 12) want = 1;
        const a = Math.atan2(dx, dz), sp = 4.6 + pf * 0.7;
        let tvx = Math.sin(a) * want * sp + Math.cos(a) * this.strafe * sp * 0.55, tvz = Math.cos(a) * want * sp - Math.sin(a) * this.strafe * sp * 0.55;
        const k = Math.min(1, 10 * dt);
        b.vx += (tvx - b.vx) * k; b.vz += (tvz - b.vz) * k;
        if (Math.random() < dt * 0.3) this.strafe = -this.strafe;
        if (dist < 2.8 && this.cool <= 0) { this.set('melee'); GS.events.push({ t: 'tell', x: b.x, z: b.z }); break; }
        if (this.cool <= 0) {
          // choose: cards most of the time, the clever tricks from phase 2
          const r = Math.random();
          if (pf >= 2 && this.minions() < 1 && r < 0.3) this.set('summon');
          else if (pf >= 2 && r < 0.55) this.set('gas');
          else if (r < 0.80 || pf === 1) this.set('cards');
          else { this.set('gone'); this.vanish(); }
          if (this.state === 'cards') GS.events.push({ t: 'tell', x: b.x, z: b.z });
        }
        break;
      }
      case 'cards': {
        b.vx *= 0.7; b.vz *= 0.7; face(16);
        this.st.aim = Math.min(1, this.st.aim + dt * 8); this.st.aimPitch = 0;
        const T0 = 0.65 - pf * 0.06;
        if (this.stT > T0 && !this.hit) {
          this.hit = true;
          const m = [b.x + Math.sin(this.a) * 0.9, b.y + 1.5, b.z + Math.cos(this.a) * 0.9];
          const n = pf === 1 ? 3 : (pf === 2 ? 5 : 7), spread = 0.20 + pf * 0.03;
          const base = Math.atan2(dx, dz);
          const dyv = (pl.b.y + 1.1 - m[1]) / (Math.max(3, dist));
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * spread;
            PJ_spawn({ kind: 'card', x: m[0], y: m[1], z: m[2], vx: Math.sin(a) * 17, vy: dyv * 17, vz: Math.cos(a) * 17, dmg: 1, life: 2.4, own: 'enemy' });
          }
          GS.events.push({ t: 'gun', x: m[0], z: m[2] });
        }
        if (this.stT > T0 + 0.45) { this.st.aim = 0; this.cool = 1.1 - pf * 0.1; this.set('hunt'); }
        break;
      }
      case 'gas': {
        b.vx *= 0.7; b.vz *= 0.7; face(12);
        if (this.stT > 0.55 && !this.hit) {
          this.hit = true;
          const n = pf === 3 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const ang = Math.atan2(dx, dz) + (i - (n - 1) / 2) * 0.5;
            const tx = pl.b.x + Math.sin(ang - Math.atan2(dx, dz)) * 4 + (Math.random() - 0.5) * 3, tz = pl.b.z + (Math.random() - 0.5) * 4;
            const T = 0.9 + i * 0.12, v = BS_arc(b.x, b.y + 1.6, b.z, tx, BS_FLOOR + 0.3, tz, T, 22);
            const p = PJ_spawn({ kind: 'bomb', x: b.x, y: b.y + 1.6, z: b.z, vx: v[0], vy: v[1], vz: v[2], dmg: 0, life: T + 0.1, own: 'enemy', grav: 22 });
            p.gas = true;
          }
          GS.events.push({ t: 'throw' });
        }
        if (this.stT > 1.3) { this.cool = 1.0; this.set('hunt'); }
        break;
      }
      case 'summon': {
        b.vx *= 0.6; b.vz *= 0.6; this.st.t += 0; face(6);
        if (this.stT > 0.5 && !this.hit) {
          this.hit = true;
          const n = pf === 3 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + 0.6, x = A.cx + Math.cos(a) * 13, z = A.cz + Math.sin(a) * 13;
            const e = new Enemy(i === 0 && pf === 3 ? 'heavy' : (i === n - 1 && pf >= 2 ? 'goon' : 'clown'), x, BS_FLOOR + 0.01, z, null);
            e.alert = true; e.state = 'chase'; e.bossMinion = true; e.home = { x: x, z: z };
            GS.enemies.push(e);
            GS.fx.puff(x, BS_FLOOR + 1, z, 10, 0.6, 0.4); GS.fx.burst(x, BS_FLOOR + 1, z, 12, [0.6, 0.3, 0.9], 1, 1);
          }
          GS.events.push({ t: 'poof' });
          GS.fx.text(b.x, b.y + 3.2, b.z, '¡LLEGÓ LA FIESTA!', '#c58bff', 1.2);
        }
        if (this.stT > 2.1) { this.cool = 1.0; this.set('hunt'); }
        break;
      }
      case 'melee': {
        b.vx *= 0.6; b.vz *= 0.6; face(14);
        this.st.atk = 1; this.st.atkP = Math.min(0.26, this.stT / 0.55 * 0.26);
        if (this.stT > 0.55 && !this.hit) {
          this.hit = true;
          const d = Math.hypot(dx, dz), ang = Math.abs(PL_angDiff(this.a, Math.atan2(dx, dz)));
          if (d < 3.6 && ang < 1.1 && Math.abs(pl.b.y - b.y) < 2.4) pl.hurt(1, dx, dz, false);
          b.vx += Math.sin(this.a) * 5; b.vz += Math.cos(this.a) * 5;
          GS.events.push({ t: 'enemySwing', x: b.x, z: b.z });
        }
        if (this.hit) this.st.atkP = Math.min(1, 0.26 + (this.stT - 0.55) / 0.3 * 0.74);
        if (this.stT > 0.95) { this.st.atk = 0; this.cool = 0.9; this.set('hunt'); if (Math.random() < 0.5) { this.set('gone'); this.vanish(); } }
        break;
      }
      case 'stunned': break;
    }
    if (this.state !== 'stunned') {
      if (this.minions() > 0) this.minionsAlive = 1;
    }
    // gravity and movement
    if (this.state !== 'gone') {
      b.vy = b.onGround ? 0 : Math.max(b.vy - PH_GRAV * dt, -50);
      PH_move(w, b, dt);
    }
    this.keepIn(16.5);
    // walking animation
    const hs = Math.hypot(b.vx, b.vz), st = this.st;
    const ease = (v, to, rr) => v + (to - v) * (1 - Math.exp(-rr * dt));
    st.walk = ease(st.walk, b.onGround ? AN_clamp(hs / 5, 0, 1) : 0, 12); st.sprint = 0;
    st.phase += dt * (3 + hs * 1.0);
    if (this.state !== 'cards') st.aim = Math.max(0, st.aim - dt * 5);
    // a stunned Joker: when his summoned crowd is gone he staggers
    if (this.state === 'hunt' && this.minionsAlive && this.minions() === 0) { this.minionsAlive = 0; this.set('stunned'); GS.fx.text(b.x, b.y + 3, b.z, '¡MIS CHICOS!', '#c58bff', 1.2); }
    if (this.state === 'stunned') { this.st.stun = 1; b.vx *= 0.8; b.vz *= 0.8; if (this.stT > 3.0) { this.st.stun = 0; this.cool = 0.5; this.set('hunt'); } }
    else this.st.stun = Math.max(0, this.st.stun - dt * 4);
  }

  draw(r) {
    if (this.state === 'gone' && this.hidden > 0) return;
    const b = this.b, M = this.model, st = this.st;
    EN_lightStep(this.light, 1 / 60);
    AN_humanoid(M, this.pose, st);
    M4_model(PK_m, b.x, b.y, b.z, this.a, 0, 0, this.scale);
    let flash = null;
    if (this.flash > 0) flash = [1, 0.95, 0.85, this.flash * 0.7];
    else if (this.state === 'melee' || this.state === 'cards') { const k = 0.5 + 0.5 * Math.sin(this.stT * 30); flash = [0.7, 0.3, 1, 0.15 + 0.2 * k]; }
    MD_drawModel(r, M, PK_m, this.pose, { sky: this.light.sky, moon: this.light.moon, bl: this.light.bl, flash: flash, rim: [0.42, 0.22, 0.58] });
  }
}
