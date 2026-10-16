// ═══════════════════════════════════════════════════════════════════════
//  PLAYER — Batman: walking, jumping, the cape glide, the grapple, fists and
//  batarangs, and the camera that follows him.
//
//  Everything that feels like "movement" is a few rules on top of the voxel
//  physics: the glide steers by the camera, the grapple pulls to the nearest
//  ledge of whatever wall you aim at, and the punch pulls you onto its target so
//  that it connects. The rules are tuned for a city built of towers.
// ═══════════════════════════════════════════════════════════════════════

var PL_WALK = 7.4, PL_SPRINT = 11.8, PL_JUMP = 10.7;
var PL_REACH = 3.5;                 // punch reach
var PL_GRAP_RANGE = 85;

function PL_angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

class Player {
  constructor(x, y, z) {
    this.b = PH_body(x, y, z, 0.3, 1.8);
    this.a = 0;
    this.hp = 5; this.maxHp = 5; this.bats = 8; this.maxBats = 15; this.batRegen = 0;
    this.inv = 0; this.dead = false; this.deadT = 0;
    this.mode = 'ground';
    this.coyote = 0; this.jumpBuf = 0; this.airT = 0; this.cutDone = false;
    this.gl = { v: 0, th: 0, head: 0, bank: 0 };
    this.glideCd = 0;
    this.grap = null; this.grapCd = 0; this.grapHint = 0;
    this.atkT = 0; this.atkDur = 0.4; this.atkKind = 0; this.combo = 0; this.comboWin = 0; this.atkHit = true; this.atkQueue = false;
    this.lunge = 0; this.lungeX = 0; this.lungeZ = 0;
    this.batT = 0; this.batCd = 0; this.batFired = true;
    this.dodgeT = 0; this.dodgeCd = 0; this.dodgeX = 0; this.dodgeZ = 0;
    this.kbx = 0; this.kbz = 0; this.stunT = 0;
    this.st = AN_state();
    this.pose = null;
    this.speedH = 0;
    this.fallV = 0;
    this.lastSafe = { x: x, y: y, z: z };
    this.shake = 0;
    this.light = { sky: 0.6, moon: 0.5, bl: [0, 0, 0], t: 0 };
    this.stepT = 0;
    this.events = [];                 // things the game should react to: 'land','jump','punch', ...
  }

  get x() { return this.b.x; } get y() { return this.b.y; } get z() { return this.b.z; }
  eye() { return [this.b.x, this.b.y + 1.62, this.b.z]; }
  chest() { return [this.b.x, this.b.y + 1.1, this.b.z]; }

  // ── damage ───────────────────────────────────────────────────────────────
  hurt(dmg, fx, fz, heavy) {
    if (this.dead || this.inv > 0 || this.dodgeT > 0.08) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.inv = 1.1;
    const d = Math.hypot(fx, fz) || 1;
    this.kbx = fx / d * (heavy ? 9 : 5.5); this.kbz = fz / d * (heavy ? 9 : 5.5);
    if (this.mode === 'glide') this.mode = 'air';
    if (this.grap) this.releaseGrapple(false);
    this.st.hurt = 1; this.shake = Math.max(this.shake, heavy ? 0.45 : 0.28);
    this.atkT = 0; this.batT = 0; this.combo = 0;
    this.events.push('hurt');
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; this.mode = 'dead'; this.events.push('die'); }
    return true;
  }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  respawn(x, y, z) {
    this.b.x = x; this.b.y = y; this.b.z = z; this.b.vx = this.b.vy = this.b.vz = 0;
    this.hp = this.maxHp; this.dead = false; this.mode = 'air'; this.inv = 2.0; this.st.dead = 0; this.st.hurt = 0;
    this.grap = null; this.atkT = 0; this.combo = 0; this.kbx = this.kbz = 0;
    this.bats = Math.max(this.bats, 6);
  }

  // ── the frame ────────────────────────────────────────────────────────────
  update(dt, cam, world, GSx) {
    const b = this.b, st = this.st;
    st.t += dt;
    this.inv = Math.max(0, this.inv - dt);
    this.glideCd = Math.max(0, this.glideCd - dt);
    this.grapCd = Math.max(0, this.grapCd - dt);
    this.batCd = Math.max(0, this.batCd - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    st.hurt = Math.max(0, st.hurt - dt * 5);
    this.comboWin = Math.max(0, this.comboWin - dt);
    if (this.comboWin <= 0 && this.atkT <= 0) this.combo = 0;
    this.batRegen += dt;
    if (this.batRegen > 11) { this.batRegen = 0; if (this.bats < 5) this.bats++; }

    if (this.dead) { this.updateDead(dt, world); return; }

    // ── what the player is asking for ──
    const mv = IN_move();
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    let wx = cy * mv.x + sy * mv.z, wz = sy * mv.x - cy * mv.z;
    const mag = Math.hypot(wx, wz);
    const want = IN.sprint && mag > 0.3;
    const jumpEdge = IN.jumpEdge, jumpHeld = IN.jump;
    if (jumpEdge) this.jumpBuf = 0.13;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // dodge roll
    if (IN.dodgeEdge && this.dodgeCd <= 0 && this.dodgeT <= 0 && (b.onGround || this.mode === 'ground') && this.atkT <= 0.12 && !this.grap) {
      let dx = wx, dz = wz;
      if (mag < 0.2) { dx = Math.sin(this.a); dz = Math.cos(this.a); }
      const l = Math.hypot(dx, dz) || 1;
      this.dodgeX = dx / l; this.dodgeZ = dz / l; this.dodgeT = 0.46; this.dodgeCd = 0.75;
      this.a = Math.atan2(this.dodgeX, this.dodgeZ);
      this.events.push('dodge');
    }

    // attacks
    if (IN.attackEdge) this.tryPunch(GSx, wx, wz, mag);
    if (IN.batEdge) this.tryBatarang(GSx, cam);
    if (IN.grappleEdge) { if (this.grap) { /* second press: let go */ this.releaseGrapple(true); } else this.tryGrapple(world, cam); }

    // ── mode logic ──
    const wasGround = b.onGround;
    if (b.onGround) { this.coyote = 0.11; this.airT = 0; } else { this.coyote = Math.max(0, this.coyote - dt); this.airT += dt; }

    // water takes over from everything but a grapple
    if (b.inWater && !this.grap) { if (this.mode === 'glide') this.mode = 'air'; this.mode = 'swim'; }
    else if (this.mode === 'swim') this.mode = b.onGround ? 'ground' : 'air';

    if (this.grap) this.stepGrapple(dt, world, jumpEdge);
    else if (this.mode === 'glide') this.stepGlide(dt, cam, mv, jumpEdge, world);
    else if (this.mode === 'swim') this.stepSwim(dt, wx, wz, mag, jumpHeld);
    else this.stepWalk(dt, wx, wz, mag, want, jumpEdge, jumpHeld, world);

    // punches and lunges move the body regardless of the mode (except the grapple)
    this.stepAttack(dt, GSx, world);

    // knockback
    if (this.kbx || this.kbz) {
      b.vx += this.kbx; b.vz += this.kbz; this.kbx = this.kbz = 0;
      if (b.onGround) b.vy = Math.max(b.vy, 3.2);
    }

    // dodge overrides horizontal control
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = Math.max(0, this.dodgeT / 0.46);
      const sp = 7 + 7 * k;
      b.vx = this.dodgeX * sp; b.vz = this.dodgeZ * sp;
      st.dodge = 1; st.dodgeAng = (1 - k) * Math.PI * 2;
    } else st.dodge = Math.max(0, st.dodge - dt * 8);

    // ── integrate ──
    const px = b.x, pz = b.z;
    PH_move(world, b, dt);
    if (wasGround && !b.onGround && b.vy <= 0 && this.mode === 'ground' && this.coyote > 0.05 && !this.grap) {
      // a kerb or a stair going down is a step, not a fall
      PH_stick(world, b, 1.06);
    }
    if (b.onGround && !wasGround) this.land(world);
    this.speedH = Math.hypot(b.x - px, b.z - pz) / Math.max(dt, 1e-4);
    if (b.onGround && this.mode !== 'ground' && this.mode !== 'swim' && !this.grap) { this.mode = 'ground'; this.glideCd = 0; }
    if (!b.onGround && this.mode === 'ground') this.mode = 'air';
    if (b.onGround && !b.inWater) { this.lastSafe.x = b.x; this.lastSafe.y = b.y; this.lastSafe.z = b.z; }
    if (b.y < 6) { this.respawn(this.lastSafe.x, this.lastSafe.y + 0.5, this.lastSafe.z); }   // never lost under the world

    this.animate(dt, world);
  }

  // ── walking, jumping, air control ────────────────────────────────────────
  stepWalk(dt, wx, wz, mag, sprint, jumpEdge, jumpHeld, world) {
    const b = this.b, st = this.st;
    const top = sprint ? PL_SPRINT : PL_WALK;
    let tx = wx * top, tz = wz * top;
    const accel = b.onGround ? 64 : 22;
    // in the air, keep what you have if it is more than you could build
    let dvx = tx - b.vx, dvz = tz - b.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      let step = accel * dt;
      if (mag < 0.05 && b.onGround) step = 78 * dt;                         // brake
      if (!b.onGround && mag < 0.05) step = 2.0 * dt;                       // momentum carries
      const k = Math.min(dl, step) / dl;
      b.vx += dvx * k; b.vz += dvz * k;
    }
    // facing
    if (mag > 0.15 && this.atkT <= 0) {
      const ta = Math.atan2(wx, wz);
      this.a += PL_angDiff(this.a, ta) * (1 - Math.exp(-17 * dt));
    }
    // gravity and jumping
    if (b.onGround) { b.vy = Math.min(b.vy, 0); this.cutDone = false; }
    else { b.vy = Math.max(b.vy - PH_GRAV * dt, -60); }
    if (this.jumpBuf > 0 && (b.onGround || this.coyote > 0) && this.dodgeT <= 0) {
      b.vy = PL_JUMP; b.onGround = false; this.coyote = 0; this.jumpBuf = 0; this.cutDone = false; this.mode = 'air';
      this.events.push('jump');
    } else if (jumpEdge && !b.onGround && this.mode === 'air' && this.glideCd <= 0 && this.airT > 0.12) {
      this.startGlide();
    }
    // let go of jump early for a short hop
    if (!jumpHeld && b.vy > 4.5 && !this.cutDone && this.mode === 'air') { b.vy = 4.5; this.cutDone = true; }
    this.fallV = Math.min(this.fallV, b.vy);
  }

  stepSwim(dt, wx, wz, mag, jumpHeld) {
    const b = this.b;
    const sp = (IN.sprint ? 5.6 : 3.9);
    let dvx = wx * sp - b.vx, dvz = wz * sp - b.vz;
    const k = 1 - Math.exp(-4.5 * dt);
    b.vx += dvx * k; b.vz += dvz * k;
    // buoyancy: float with the head just out, swim up when asked, sink slowly otherwise
    const surface = WG_SEA + 1.0 - 1.25;
    let ty = (b.y < surface - 0.2 ? 2.6 : (b.y > surface + 0.1 ? -2.2 : 0));
    if (jumpHeld) ty = 4.4;
    if (!b.headWater && b.y > surface + 0.05 && !jumpHeld) ty = -2.0;
    b.vy += (ty - b.vy) * (1 - Math.exp(-5 * dt));
    if (mag > 0.15) this.a += PL_angDiff(this.a, Math.atan2(wx, wz)) * (1 - Math.exp(-9 * dt));
    this.st.phase += dt * 5;
    // climb out onto a ledge: pressing against solid ground at the surface lets the step-up carry the body
    if (jumpHeld && (b.hitX || b.hitZ)) b.vy = Math.max(b.vy, 6.5);
  }

  // ── gliding ──────────────────────────────────────────────────────────────
  startGlide() {
    const b = this.b, g = this.gl;
    const hs = Math.hypot(b.vx, b.vz);
    g.v = Math.max(11.5, hs * 1.05);
    g.th = AN_clamp(Math.atan2(-b.vy, Math.max(hs, 4)), -0.1, 0.7);
    g.head = hs > 1.5 ? Math.atan2(b.vx, b.vz) : this.a;
    g.bank = 0;
    this.mode = 'glide'; this.events.push('glide');
  }
  stepGlide(dt, cam, mv, jumpEdge, world) {
    const b = this.b, g = this.gl;
    if (jumpEdge || this.glideCd > 0) { this.mode = 'air'; this.glideCd = 0.25; return; }
    // heading follows where the camera looks, at a limited turn rate; A and D add to it
    const camHead = Math.atan2(Math.sin(cam.yaw), -Math.cos(cam.yaw));
    let dh = PL_angDiff(g.head, camHead);
    const rate = 2.1 + Math.abs(mv.x) * 0.5;
    const turn = AN_clamp(dh * 3.0, -rate, rate) + mv.x * 0.7;
    g.head += turn * dt;
    g.bank += (AN_clamp(-turn * 0.34, -0.7, 0.7) - g.bank) * (1 - Math.exp(-6 * dt));
    // flight path angle follows the camera pitch (look down to dive, up to flare); W and S nudge it
    const thT = AN_clamp(-cam.pitch * 1.15 + 0.17 + mv.z * 0.16, -0.30, 1.0);
    g.th += AN_clamp(thT - g.th, -2.4 * dt, 2.4 * dt);
    // energy: a dive builds speed, a climb spends it, drag bounds both
    g.v += (22 * Math.sin(g.th) - 0.0205 * g.v * g.v) * dt;
    if (g.v < 9.6) g.th = Math.max(g.th, 0.22 + (9.6 - g.v) * 0.25);     // stall: the nose drops
    g.v = AN_clamp(g.v, 7.5, 36);
    const ch = Math.cos(g.th);
    b.vx = Math.sin(g.head) * ch * g.v; b.vz = Math.cos(g.head) * ch * g.v; b.vy = -Math.sin(g.th) * g.v;
    this.a = g.head;
    if (b.hitX || b.hitZ) g.v = Math.max(8, g.v * 0.55);
    if (b.hitUp) g.th = Math.max(g.th, 0.3);
  }

  // ── landing ──────────────────────────────────────────────────────────────
  land(world) {
    const b = this.b, st = this.st;
    const v = -this.fallV;
    this.fallV = 0;
    if (this.mode === 'glide') { this.mode = 'ground'; }
    st.land = AN_clamp((v - 8) / 30, 0.15, 1);
    if (v > 6) this.events.push(v > 22 ? 'landHard' : 'land');
    if (v > 24) this.shake = Math.max(this.shake, 0.2);
    if (v > 15 && b.groundBlock !== BK.WATER) this.events.push({ t: 'dust', v: v });
  }

  // ── the grapple ──────────────────────────────────────────────────────────
  // Aim along the camera. A wall is climbed to its nearest ledge; a top face is a
  // point to swing to.
  findGrapple(world, cam) {
    const ox = cam.x, oy = cam.y, oz = cam.z;
    // aim from the camera, but a surface behind the player must not catch the hook
    let h = world.raycast(ox + cam.fx * 1.2, oy + cam.fy * 1.2, oz + cam.fz * 1.2, cam.fx, cam.fy, cam.fz, PL_GRAP_RANGE);
    if (!h) return null;
    const px = this.b.x, pz = this.b.z, py = this.b.y + 1.2;
    const hx = ox + cam.fx * (h.t + 1.2), hy = oy + cam.fy * (h.t + 1.2), hz = oz + cam.fz * (h.t + 1.2);
    const dist = Math.hypot(hx - px, hy - py, hz - pz);
    if (dist > PL_GRAP_RANGE || dist < 2.2) return null;
    let g = null;
    if (h.ny > 0.5) {
      // a floor or roof: pull to a point just above it
      g = { kind: 'top', ax: h.x + 0.5, ay: h.y + 1, az: h.z + 0.5, px: h.x + 0.5, py: h.y + 1.05, pz: h.z + 0.5, nx: 0, nz: 0 };
    } else if (h.ny < -0.5) {
      g = { kind: 'under', ax: h.x + 0.5, ay: h.y, az: h.z + 0.5, px: h.x + 0.5, py: h.y - 2.0, pz: h.z + 0.5, nx: 0, nz: 0 };
    } else {
      // a wall: find the lip. Walk up the column from the hit until it ends, and
      // require standing room (two free cells) on top of it.
      let y = h.y, top = -1;
      for (let k = 0; k < 70 && y < WG_H - 3; k++, y++) {
        if (!world.isSolid(h.x, y + 1, h.z) && !world.isSolid(h.x, y + 2, h.z) && !world.isSolid(h.x, y + 3, h.z)) { top = y; break; }
      }
      if (top < 0) return null;
      const nx = h.nx, nz = h.nz;
      g = { kind: 'wall', ax: h.x + 0.5, ay: top + 1, az: h.z + 0.5,
            px: h.x + 0.5 + nx * 0.9, py: top + 1.15, pz: h.z + 0.5 + nz * 0.9, nx: nx, nz: nz };
      // the pull-up point must itself be open air
      const probe = PH_body(g.px, g.py, g.pz, 0.3, 1.8);
      if (!PH_free(world, probe, g.px, g.py, g.pz)) {
        g.px = h.x + 0.5 + nx * 1.4; g.pz = h.z + 0.5 + nz * 1.4;
        probe.x = g.px; probe.z = g.pz;
        if (!PH_free(world, probe, g.px, g.py, g.pz)) return null;
      }
    }
    g.dist = Math.hypot(g.px - px, g.py - py, g.pz - pz);
    return g;
  }
  tryGrapple(world, cam) {
    if (this.grapCd > 0 || this.dead || this.dodgeT > 0) return;
    const g = this.findGrapple(world, cam);
    this.grapCd = 0.3;
    if (!g) { this.events.push('grappleMiss'); this.grapMiss = 0.25; this.missDir = [cam.fx, cam.fy, cam.fz]; return; }
    g.t = 0; g.phase = 'fly'; g.age = 0; g.speed = 12; g.stuck = 0;
    this.grap = g; this.mode = 'air';
    if (this.b.onGround) { this.b.vy = Math.max(this.b.vy, 0); }
    this.events.push('grapple');
  }
  stepGrapple(dt, world, jumpEdge) {
    const b = this.b, g = this.grap, st = this.st;
    g.age += dt;
    if (g.phase === 'fly') {
      // the hook crosses the gap quickly before the pull starts
      g.t += dt / Math.max(0.10, Math.min(0.3, g.dist / 300));
      b.vy = Math.max(b.vy - PH_GRAV * dt * 0.4, -20);
      if (g.t >= 1) { g.t = 1; g.phase = 'pull'; this.events.push('grappleHit'); }
      if (jumpEdge) this.releaseGrapple(true);
      return;
    }
    // pull: accelerate toward the pull point, ease off on arrival
    const dx = g.px - b.x, dy = g.py - b.y, dz = g.pz - b.z;
    const d = Math.hypot(dx, dy, dz);
    g.speed = Math.min(40, g.speed + 150 * dt);
    const sp = Math.min(g.speed, 6 + d * 7);
    if (d > 0.01) { b.vx = dx / d * sp; b.vy = dy / d * sp; b.vz = dz / d * sp; }
    this.a += PL_angDiff(this.a, Math.atan2(dx, dz)) * (1 - Math.exp(-10 * dt));
    if (jumpEdge) { this.releaseGrapple(true); return; }
    // blocked for a while (the path is not clear): give up rather than grind
    if (b.hitX || b.hitZ || b.hitUp) g.stuck += dt; else g.stuck = Math.max(0, g.stuck - dt);
    if (g.stuck > 0.35 || g.age > 4) { this.releaseGrapple(false); return; }
    if (d < 1.1) this.arriveGrapple();
  }
  arriveGrapple() {
    const b = this.b, g = this.grap;
    if (g.kind === 'wall') {
      // over the lip: a short hop inward carries the body onto the roof
      b.vx = -g.nx * 4.6; b.vz = -g.nz * 4.6; b.vy = 7.2;
      this.a = Math.atan2(-g.nx, -g.nz);
      this.events.push('vault');
    } else if (g.kind === 'top') {
      b.vy = Math.max(b.vy * 0.5, 4.5);
      b.vx *= 0.6; b.vz *= 0.6;
    } else { b.vx *= 0.3; b.vy = 0; b.vz *= 0.3; }
    this.grap = null; this.glideCd = 0; this.grapCd = 0.2; this.cutDone = true; this.airT = 0.2;
  }
  releaseGrapple(keep) {
    const b = this.b;
    if (this.grap) {
      if (keep) { b.vx *= 0.9; b.vz *= 0.9; b.vy = Math.max(b.vy * 0.9, this.grap.phase === 'pull' ? 4 : b.vy); }
      else { b.vx *= 0.4; b.vz *= 0.4; b.vy *= 0.4; }
    }
    this.grap = null; this.grapCd = 0.25; this.mode = 'air'; this.cutDone = true; this.airT = 0.25;
  }

  // ── fists ────────────────────────────────────────────────────────────────
  tryPunch(GSx, wx, wz, mag) {
    if (this.dead || this.grap || this.dodgeT > 0) return;
    if (this.atkT > 0) {                       // already swinging: queue the next one for the end of this one
      if (this.atkT < this.atkDur * 0.62) this.atkQueue = true;
      return;
    }
    this.startPunch(GSx, wx, wz, mag);
  }
  startPunch(GSx, wx, wz, mag) {
    this.combo = this.comboWin > 0 ? (this.combo % 3) + 1 : 1;
    this.atkKind = this.combo === 3 ? 3 : (this.combo === 2 ? 2 : 1);
    this.atkDur = this.combo === 3 ? 0.50 : 0.38;
    this.atkT = this.atkDur; this.atkHit = false; this.atkQueue = false; this.comboWin = 0.9;
    // aim assist: the enemy nearest the direction of travel (or of facing) within reach
    const dir = mag > 0.25 ? Math.atan2(wx, wz) : this.a;
    const t = GSx ? EN_pickTarget(this.b.x, this.b.z, dir, 7.5, 1.15) : null;
    if (t) {
      this.a = Math.atan2(t.b.x - this.b.x, t.b.z - this.b.z);
      const d = Math.hypot(t.b.x - this.b.x, t.b.z - this.b.z);
      this.lunge = d > PL_REACH * 0.55 ? 0.14 : 0; this.lungeX = Math.sin(this.a); this.lungeZ = Math.cos(this.a);
      this.lungeSp = Math.min(22, Math.max(6, (d - 1.4) / 0.14));
    } else {
      if (mag > 0.25) this.a = dir;
      this.lunge = 0.08; this.lungeX = Math.sin(this.a); this.lungeZ = Math.cos(this.a); this.lungeSp = 4.5;
    }
    this.events.push('swing');
  }
  stepAttack(dt, GSx, world) {
    const b = this.b, st = this.st;
    if (this.atkT > 0) {
      this.atkT -= dt;
      const p = 1 - Math.max(0, this.atkT) / this.atkDur;
      st.atk = this.atkKind; st.atkP = Math.min(1, p);
      if (this.lunge > 0) {
        this.lunge -= dt;
        b.vx = this.lungeX * this.lungeSp; b.vz = this.lungeZ * this.lungeSp;
      } else if (b.onGround) { b.vx *= 0.8; b.vz *= 0.8; }
      if (!this.atkHit && p >= 0.40) {
        this.atkHit = true;
        const dmg = this.atkKind === 3 ? 2 : 1;
        const n = EN_meleeHit(this, this.a, PL_REACH, 1.05, dmg, this.atkKind);
        if (n > 0) { this.events.push({ t: 'hit', n: n, kind: this.atkKind }); }
        else this.events.push('whoosh');
      }
      if (this.atkT <= 0) {
        st.atk = 0;
        if (this.atkQueue) { this.atkQueue = false; this.startPunch(GSx, 0, 0, 0); }
      }
    } else if (this.batT > 0) {
      this.batT -= dt;
      const p = 1 - Math.max(0, this.batT) / 0.42;
      st.atk = 4; st.atkP = Math.min(1, p);
      if (!this.batFired && p >= 0.45) { this.batFired = true; this.fireBatarang(); }
      if (this.batT <= 0) st.atk = 0;
    } else st.atk = 0;
  }

  // ── batarang ─────────────────────────────────────────────────────────────
  tryBatarang(GSx, cam) {
    if (this.dead || this.bats <= 0 || this.batCd > 0 || this.batT > 0 || this.atkT > 0.15 || this.grap) return;
    this.batCd = 0.35; this.batT = 0.42; this.batFired = false; this.batCam = { x: cam.x, y: cam.y, z: cam.z, fx: cam.fx, fy: cam.fy, fz: cam.fz };
    // turn to face the throw
    this.a = Math.atan2(cam.fx, cam.fz);
  }
  fireBatarang() {
    const c = this.batCam;
    const hand = [this.b.x + Math.sin(this.a) * 0.5, this.b.y + 1.35, this.b.z + Math.cos(this.a) * 0.5];
    // the target: whatever is nearest the crosshair, within a narrow cone
    const t = EN_pickCrosshair(c, 60, 0.16);
    let dx = c.fx, dy = c.fy, dz = c.fz;
    if (t) {
      const tp = t.center();
      dx = tp[0] - hand[0]; dy = tp[1] - hand[1]; dz = tp[2] - hand[2];
    } else {
      // aim at what the crosshair rests on, so the throw lands where the player looks
      const h = GS.world.raycast(c.x + c.fx * 1.0, c.y + c.fy * 1.0, c.z + c.fz * 1.0, c.fx, c.fy, c.fz, 70);
      const R = h ? h.t + 1.0 : 60;
      dx = c.x + c.fx * R - hand[0]; dy = c.y + c.fy * R - hand[1]; dz = c.z + c.fz * R - hand[2];
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    PJ_spawn({ kind: 'batarang', x: hand[0], y: hand[1], z: hand[2], vx: dx / l * 44, vy: dy / l * 44, vz: dz / l * 44, dmg: 2, life: 1.7, own: 'player', target: t });
    this.bats--;
    this.events.push('throw');
  }

  // ── dead ─────────────────────────────────────────────────────────────────
  updateDead(dt, world) {
    const b = this.b, st = this.st;
    this.deadT += dt;
    st.dead = Math.min(1, this.deadT / 0.6);
    b.vx *= Math.exp(-4 * dt); b.vz *= Math.exp(-4 * dt);
    b.vy = Math.max(b.vy - PH_GRAV * dt, -60);
    PH_move(world, b, dt);
    st.atk = 0; st.grap = 0; st.glide = Math.max(0, st.glide - dt * 4);
    this.animate(dt, world, true);
  }

  // ── animation state ──────────────────────────────────────────────────────
  animate(dt, world, dead) {
    const st = this.st, b = this.b;
    const hs = Math.hypot(b.vx, b.vz);
    const ease = (v, to, r) => v + (to - v) * (1 - Math.exp(-r * dt));
    const onG = b.onGround && this.mode !== 'swim';
    st.walk = ease(st.walk, onG ? AN_clamp(hs / 6.5, 0, 1) : 0, 14);
    st.sprint = ease(st.sprint, onG ? AN_clamp((hs - 7.5) / 4.3, 0, 1) : 0, 8);
    st.phase += dt * (3.2 + hs * 0.95) * (onG ? 1 : 0.2);
    st.air = ease(st.air, (!b.onGround && this.mode !== 'swim' && !this.grap) ? 1 : 0, 16);
    st.vy = b.vy;
    st.glide = ease(st.glide, this.mode === 'glide' ? 1 : 0, 9);
    st.gth = this.gl.th;
    st.swim = ease(st.swim, this.mode === 'swim' ? 1 : 0, 8);
    st.land = Math.max(0, st.land - dt * 4.2);
    st.grap = ease(st.grap, this.grap ? 1 : 0, 18);
    if (this.grap) st.grapPitch = Math.atan2(this.grap.ay - (b.y + 1.3), Math.hypot(this.grap.ax - b.x, this.grap.az - b.z));
    if (!dead) st.dead = ease(st.dead, 0, 10);
    // the cape trails whatever the body does
    const fwd = b.vx * Math.sin(this.a) + b.vz * Math.cos(this.a);
    AN_capeStep(st, dt, this.mode === 'glide' ? this.gl.v * 0.6 : fwd, b.vy, st.glide);
    if (this.grapMiss > 0) this.grapMiss -= dt;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  The camera that follows him.
// ═══════════════════════════════════════════════════════════════════════
class ThirdCam {
  constructor() {
    this.yaw = 2.52; this.pitch = -0.18;
    this.dist = 4.8; this.want = 4.8;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.shakeT = 0;
    this.fov = 1.12;
  }
  snap(p) { this.tx = p.b.x; this.ty = p.b.y + 1.5; this.tz = p.b.z; }
  update(dt, cam, p, world, look) {
    this.yaw += look.x;
    this.pitch = AN_clamp(this.pitch - look.y, -1.38, 1.15);
    // the pivot trails the body a little so a run has weight, but never far
    const px = p.b.x, py = p.b.y + 1.5 + (p.mode === 'glide' ? 0.2 : 0), pz = p.b.z;
    const k = 1 - Math.exp(-(p.mode === 'glide' ? 12 : 20) * dt);
    this.tx += (px - this.tx) * k; this.ty += (py - this.ty) * (1 - Math.exp(-14 * dt)); this.tz += (pz - this.tz) * k;
    // how far back: farther when moving fast, in a glide, on a grapple
    let want = 4.6;
    if (p.mode === 'glide') want = 5.6 + Math.min(2.5, (p.gl.v - 12) * 0.12);
    else if (p.grap) want = 6.0;
    else if (p.st.sprint > 0.5) want = 5.2;
    this.want += (want - this.want) * (1 - Math.exp(-2.5 * dt));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp, fy = sp, fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const side = 0.55 * (this.want / 4.6);
    // the centre of the orbit is shifted to the right shoulder
    const ox = this.tx + rx * side, oy = this.ty, oz = this.tz + rz * side;
    // pull the camera in so it never sits inside a wall: five rays, the shortest wins
    let dmax = this.want;
    const offs = [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]];
    for (let i = 0; i < offs.length; i++) {
      const ux = rx * offs[i][0], uz = rz * offs[i][0], uy = offs[i][1];
      const sx = ox + ux, sy = oy + uy, sz = oz + uz;
      const h = world.raycast(sx, sy, sz, -fx, -fy, -fz, this.want + 0.4);
      if (h) dmax = Math.min(dmax, Math.max(0.5, h.t - 0.45));
    }
    // a collision pulls in at once, a clear path lets it ease back out
    if (dmax < this.dist) this.dist = dmax; else this.dist += (dmax - this.dist) * (1 - Math.exp(-3.2 * dt));
    cam.x = ox - fx * this.dist; cam.y = oy - fy * this.dist; cam.z = oz - fz * this.dist;
    cam.yaw = this.yaw; cam.pitch = this.pitch;
    // shake
    if (p.shake > 0) {
      const s = p.shake * 0.22;
      cam.x += (Math.random() - 0.5) * s; cam.y += (Math.random() - 0.5) * s; cam.z += (Math.random() - 0.5) * s;
    }
    // widen the view in a fast glide or a dive
    const fovT = 1.12 + (p.mode === 'glide' ? AN_clamp((p.gl.v - 12) * 0.008, 0, 0.18) : 0) + (p.grap && p.grap.phase === 'pull' ? 0.10 : 0);
    this.fov += (fovT - this.fov) * (1 - Math.exp(-4 * dt));
    cam.fov = this.fov;
  }
}
