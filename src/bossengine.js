// ═══════════════════════════════════════════════════════════════════════
//  BOSS ENGINE — fight logic for the two arena levels.
//
//  Both fights are built on the same contract: the boss is invulnerable while
//  it is doing something, telegraphs clearly before the dangerous move, and
//  opens a punish window the player has to earn. Hazards are separate
//  entities so they keep hurting after the boss has moved on.
//
//  Arenas are exactly 30 columns, so the camera never scrolls and the whole
//  fight is always on screen. Ground surface sits at row 15.
// ═══════════════════════════════════════════════════════════════════════

const BE_GROUND = 15 * 32;          // y of the walkable floor surface
const BE_LEFT = 32, BE_RIGHT = 928; // inside the arena walls

function BE_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ── hazards ────────────────────────────────────────────────────────────
class BossProjectile {
  constructor(x, y, vx, vy, kind) {
    const s = kind === 'bomb' ? 26 : 20;
    this.rect = new Rect(x - s / 2, y - s / 2, s, s);
    this.vx = vx; this.vy = vy;
    this.kind = kind;                 // 'bomb' | 'card'
    this.alive = true;
    this.anim = 0;
    this.fuse = 0;
    this.blast = 0;                   // >0 while the explosion is dangerous
  }
  update(dt) {
    this.anim += dt;
    if (this.blast > 0) {
      this.blast -= dt;
      if (this.blast <= 0) this.alive = false;
      return;
    }
    this.vy += (this.kind === 'bomb' ? 900 : 520) * dt;
    this.rect.x += this.vx * dt;
    this.rect.y += this.vy * dt;
    if (this.kind === 'bomb') {
      this.fuse = BE_clamp(this.anim / 1.4, 0, 1);
      if (this.rect.b >= BE_GROUND) { this.detonate(); return; }
    }
    if (this.rect.y > CH + 60 || this.rect.r < -60 || this.rect.x > CW + 60) this.alive = false;
  }
  detonate() {
    this.blast = 0.34;
    this.rect.x = this.rect.cx - 34;
    this.rect.y = BE_GROUND - 44;
    this.rect.w = 68; this.rect.h = 44;
    this.vx = 0; this.vy = 0;
    AUDIO.brk();
  }
}

// A ridge that races along the floor. The whole point is that it is jumpable,
// so it is kept low and its speed is well under a running jump's reach.
class Shockwave {
  constructor(x, dir, speed) {
    this.rect = new Rect(x - 20, BE_GROUND - 42, 40, 42);
    this.dir = dir;
    this.speed = speed || 280;
    this.alive = true;
    this.anim = 0;
  }
  update(dt) {
    this.anim += dt;
    this.rect.x += this.dir * this.speed * dt;
    if (this.rect.r < -40 || this.rect.x > CW + 40) this.alive = false;
  }
}

// ── boss ───────────────────────────────────────────────────────────────
class Boss {
  constructor(kind) {
    this.kind = kind;
    this.maxHp = kind === 'penguin' ? 3 : 5;
    this.hp = this.maxHp;
    this.phase = 1;
    this.anim = 0;
    this.t = 0;
    this.state = 'intro';
    this.introT = 0;
    this.face = -1;
    this.hurtFlash = 0;
    this.defeated = false;
    this.deadT = 0;
    this.proj = [];
    this.waves = [];
    this.minions = [];
    this.gasY = CH + 40;        // joker phase 2: gas surface, high value = low gas
    this.gasTarget = CH + 40;
    this.bombT = 0;
    this.cardT = 0;
    this.tpIndex = 0;
    this.name = kind === 'penguin' ? 'EL PINGÜINO' : 'EL JOKER';
    this.subtitle = kind === 'penguin' ? 'MUELLE HELADO' : 'CARNAVAL DE ARKHAM';

    if (kind === 'penguin') {
      this.rect = new Rect(CW / 2 - 48, 120, 96, 110);
    } else {
      this.rect = new Rect(CW / 2 - 60, 150, 120, 140);
    }
    // platforms the Joker teleports between, in arena coords
    this.spots = [[150, 384], [CW / 2, 320], [CW - 150, 384]];
  }

  get vulnerable() {
    if (this.defeated) return false;
    if (this.kind === 'penguin') return this.state === 'dazed';
    // One tell per phase, so each is learnable on its own terms. Measured
    // across all three phases the old rule left him open 38.9% of the fight —
    // in phase 2 both 'arrive' AND 'throw' counted, which is 2 of every 2.5s.
    if (this.phase === 1) return this.state === 'taunt';      // the dip
    if (this.phase === 2) return this.state === 'arrive';     // just landed
    return this.state === 'throw';                            // arms raised
  }
  // contact only hurts while the boss is actually threatening
  get contactHurts() {
    return !this.defeated && !this.vulnerable && this.state !== 'intro' && this.state !== 'hurt';
  }

  setState(s) { this.state = s; this.t = 0; }

  hit(game) {
    if (this.defeated) return;
    this.hp--;
    this.hurtFlash = 1;
    AUDIO.stomp();
    game.shake.trigger(8, 0.3);
    game.fx.spawnStomp(this.rect.cx, this.rect.cy);
    game.award(500, this.rect.cx, this.rect.y);
    if (this.hp <= 0) {
      this.defeated = true;
      this.setState('dead');
      this.proj.length = 0;
      this.waves.length = 0;
      this.gasTarget = CH + 40;
      AUDIO.clear();
      game.shake.trigger(12, 0.6);
      return;
    }
    // phase thresholds
    if (this.kind === 'penguin') {
      this.phase = this.hp === 2 ? 2 : 3;
    } else {
      this.phase = this.hp > 3 ? 1 : (this.hp > 1 ? 2 : 3);
    }
    this.setState('hurt');
  }

  update(dt, game) {
    this.anim += dt;
    this.t += dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);

    // hazards keep living independently of the boss
    for (const p of this.proj) p.update(dt);
    for (const wv of this.waves) wv.update(dt);
    this.proj = this.proj.filter(p => p.alive);
    this.waves = this.waves.filter(w => w.alive);

    // gas eases toward its target so phase changes are not instant
    this.gasY = CO_lerp(this.gasY, this.gasTarget, 1 - Math.pow(0.25, dt));

    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT > 2.4) this.setState(this.kind === 'penguin' ? 'hover' : 'ride');
      return;
    }
    if (this.defeated) {
      this.deadT += dt;
      this.rect.y = Math.min(BE_GROUND - this.rect.h + 10, this.rect.y + 260 * dt);
      return;
    }

    const p = game.player;
    if (p) this.face = p.rect.cx < this.rect.cx ? -1 : 1;

    if (this.kind === 'penguin') this.updatePenguin(dt, game, p);
    else this.updateJoker(dt, game, p);

    this.collide(game, p);
  }

  // ── EL PINGÜINO ──────────────────────────────────────────────────────
  updatePenguin(dt, game, p) {
    const hoverY = 110;
    switch (this.state) {
      case 'hover': {
        // drift toward the player, but slowly enough to be outrun
        const target = p ? BE_clamp(p.rect.cx - this.rect.w / 2, BE_LEFT, BE_RIGHT - this.rect.w) : this.rect.x;
        this.rect.x = CO_approach(this.rect.x, target, 72 * dt);
        this.rect.y = hoverY + Math.sin(this.anim * 2.2) * 10;
        this.bombT -= dt;
        const maxBombs = this.phase === 1 ? 3 : (this.phase === 2 ? 4 : 5);
        if (this.bombT <= 0 && this.proj.length < maxBombs) {
          this.proj.push(new BossProjectile(this.rect.cx, this.rect.b - 10, this.face * 40, 40, 'bomb'));
          this.bombT = 0.55;
        }
        const hoverLen = 2.6 - (this.phase - 1) * 0.35;
        if (this.t > hoverLen) this.setState('telegraph');
        break;
      }
      case 'telegraph': {
        // rise and flash: the player gets 0.8s to clear the centre
        this.rect.y = hoverY - 22 * Math.min(1, this.t / 0.45) + Math.sin(this.anim * 26) * 2;
        if (this.t > 0.8) { this.setState('slam'); AUDIO.jump(); }
        break;
      }
      case 'slam': {
        this.rect.y += 1500 * dt;
        if (this.rect.b >= BE_GROUND + 12) {
          this.rect.y = BE_GROUND + 12 - this.rect.h;
          this.setState('dazed');
          game.shake.trigger(11, 0.4);
          AUDIO.brk();
          this.waves.push(new Shockwave(this.rect.cx - 24, -1, 280));
          this.waves.push(new Shockwave(this.rect.cx + 24, 1, 280));
          if (this.phase === 3) {
            this.waves.push(new Shockwave(this.rect.cx - 24, -1, 190));
            this.waves.push(new Shockwave(this.rect.cx + 24, 1, 190));
          }
          game.fx.spawnBlockBreak(this.rect.cx, BE_GROUND);
        }
        break;
      }
      case 'dazed': {
        if (this.t > 1.6) this.setState('recover');
        break;
      }
      case 'hurt': {
        this.rect.y -= 180 * dt;
        if (this.t > 0.55) this.setState('recover');
        break;
      }
      case 'recover': {
        this.rect.y = CO_approach(this.rect.y, hoverY, 640 * dt);
        if (Math.abs(this.rect.y - hoverY) < 4) {
          // phase 3 mixes in a ground-level charge the player must jump
          if (this.phase === 3 && (Math.floor(this.anim) % 2 === 0)) this.setState('charge');
          else this.setState('hover');
        }
        break;
      }
      case 'charge': {
        if (this.t < 0.6) {
          this.rect.y = CO_approach(this.rect.y, BE_GROUND - this.rect.h, 700 * dt);
        } else {
          this.rect.x += this.face * 430 * dt;
          if (this.rect.x < BE_LEFT || this.rect.r > BE_RIGHT) {
            this.rect.x = BE_clamp(this.rect.x, BE_LEFT, BE_RIGHT - this.rect.w);
            this.setState('recover');
          }
        }
        break;
      }
    }
  }

  // ── EL JOKER ─────────────────────────────────────────────────────────
  updateJoker(dt, game, p) {
    if (this.phase === 1) {
      this.rect.w = 120; this.rect.h = 140;
      this.gasTarget = CH + 40;
      switch (this.state) {
        case 'ride': {
          const target = p ? BE_clamp(p.rect.cx - this.rect.w / 2, BE_LEFT, BE_RIGHT - this.rect.w) : this.rect.x;
          this.rect.x = CO_approach(this.rect.x, target, 56 * dt);
          this.rect.y = 150 + Math.sin(this.anim * 1.6) * 16;
          this.cardT -= dt;
          if (this.cardT <= 0) {
            this.throwCards(4, 1.1);
            this.cardT = 1.05;
          }
          if (this.t > 4.2) { this.setState('taunt'); AUDIO.hurt(); }
          break;
        }
        case 'taunt': {
          // dips low enough to stomp from a platform, then climbs away
          const dip = 330;
          if (this.t < 0.95) this.rect.y = CO_approach(this.rect.y, dip, 420 * dt);
          else this.rect.y = CO_approach(this.rect.y, 150, 420 * dt);
          if (this.t > 1.7) this.setState('ride');
          break;
        }
        case 'hurt': {
          if (this.t > 0.6) this.setState('ride');
          break;
        }
      }
      return;
    }

    // phases 2 and 3: on foot
    this.rect.w = 72; this.rect.h = 96;
    if (this.phase === 2) {
      this.gasTarget = 460;             // floods the floor: platforms only
      switch (this.state) {
        case 'ride': case 'hurt': {
          if (this.t > 0.6) this.setState('teleport');
          break;
        }
        case 'teleport': {
          if (this.t > 0.5) {
            this.tpIndex = (this.tpIndex + 1 + (p && p.rect.cx > CW / 2 ? 1 : 0)) % this.spots.length;
            const s = this.spots[this.tpIndex];
            this.rect.x = s[0] - this.rect.w / 2;
            this.rect.y = s[1] - this.rect.h;
            this.setState('arrive');
            AUDIO.coin();
          }
          break;
        }
        case 'arrive': {
          if (this.t > 0.9) { this.throwCards(4, 1.15); this.setState('throw'); }
          break;
        }
        case 'throw': {
          if (this.t > 1.1) this.setState('teleport');
          break;
        }
        default: this.setState('teleport');
      }
      return;
    }

    // phase 3: gas drains, he holds the centre and floods the screen with cards
    this.gasTarget = CH + 40;
    switch (this.state) {
      case 'hurt': {
        if (this.t > 0.6) this.setState('ground');
        break;
      }
      case 'ground': {
        this.rect.x = CO_approach(this.rect.x, CW / 2 - this.rect.w / 2, 160 * dt);
        this.rect.y = CO_approach(this.rect.y, BE_GROUND - this.rect.h, 500 * dt);
        if (this.t > 1.0) this.setState('throw');
        break;
      }
      case 'throw': {
        if (this.t < 0.05) {
          this.throwCards(5, 1.3);
          if (game.enemies.length < 4) {
            const side = this.rect.cx > CW / 2 ? 2 : CW / TILE - 3;
            game.enemies.push(new Enemy(Math.round(side), 14, 'joker'));
          }
        }
        if (this.t > 1.3) this.setState('ground');
        break;
      }
      default: this.setState('ground');
    }
  }

  throwCards(n, spread) {
    for (let i = 0; i < n; i++) {
      const a = -0.9 + (i / Math.max(1, n - 1)) * 0.9 * spread;
      const sp = 300;
      this.proj.push(new BossProjectile(
        this.rect.cx, this.rect.cy,
        Math.cos(a) * sp * this.face, Math.sin(a) * sp - 40, 'card'));
    }
    AUDIO.kick();
  }

  // ── interactions ─────────────────────────────────────────────────────
  collide(game, p) {
    if (!p || p.dead) return;

    // stomping the boss
    if (this.vulnerable && p.rect.hits(this.rect)) {
      const prevB = p.rect.b - p.vy * game.lastDt;
      if (p.vy > 0 && prevB <= this.rect.y + 18) {
        p.vy = JUMP * 0.8;
        this.hit(game);
        return;
      }
    }
    if (this.contactHurts && p.rect.hits(this.rect)) p.hurt(game);

    // hazards
    for (const pr of this.proj) {
      if (!pr.alive) continue;
      if (pr.kind === 'bomb' && pr.blast <= 0) continue;   // only the blast hurts
      if (p.rect.hits(pr.rect)) { p.hurt(game); if (pr.kind === 'card') pr.alive = false; }
    }
    for (const wv of this.waves) {
      if (wv.alive && p.rect.hits(wv.rect)) p.hurt(game);
    }
    // laughing gas
    if (this.gasY < CH && p.rect.b > this.gasY + 6) p.hurt(game);
  }

  draw(ctx, t) {
    const o = {
      state: this.state === 'recover' || this.state === 'charge' ? 'hover' : this.state,
      animTime: this.anim, facingRight: this.face > 0,
      phase: this.phase, hurtFlash: this.hurtFlash,
    };
    if (this.kind === 'joker' && this.state === 'ride' && this.phase > 1) o.state = 'ground';
    if (this.defeated) o.state = 'dead';

    for (const wv of this.waves) drawShockwave(ctx, wv.rect.cx, BE_GROUND, wv.rect.w, wv.rect.h, wv.anim, 1);
    for (const pr of this.proj) {
      if (pr.kind === 'bomb') {
        if (pr.blast > 0) {
          game_blast(ctx, pr.rect, pr.blast);
        } else {
          drawUmbrellaBomb(ctx, pr.rect.cx, pr.rect.cy, pr.rect.w / 2, pr.anim * 2, pr.fuse);
        }
      } else {
        drawCardProjectile(ctx, pr.rect.cx, pr.rect.cy, pr.rect.w / 2, pr.anim * 9);
      }
    }
    if (this.kind === 'penguin') drawPenguinBoss(ctx, this.rect.x, this.rect.y, this.rect.w, this.rect.h, o);
    else drawJokerBoss(ctx, this.rect.x, this.rect.y, this.rect.w, this.rect.h, o);

    if (this.gasY < CH) drawGasCloud(ctx, 0, this.gasY, CW, CH - this.gasY + 10, t);
  }
}

// small shared explosion flash, kept here so bosses.js stays pure art
function game_blast(ctx, r, life) {
  ctx.save();
  const a = BE_clamp(life / 0.34, 0, 1);
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(r.cx, r.cy, 2, r.cx, r.cy, r.w * 0.75);
  g.addColorStop(0, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.45, 'rgba(255,150,40,0.55)');
  g.addColorStop(1, 'rgba(120,30,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(r.cx, r.cy, r.w * 0.75, r.h * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
