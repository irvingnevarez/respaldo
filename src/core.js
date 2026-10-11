// ═══════════════════════════════════════════════════════════════════════
//  CORE ENGINE — physics, entities, state machine, audio, main loop
//  Calls into the render modules (batman/enemies/environment/tiles/fx/ui)
// ═══════════════════════════════════════════════════════════════════════

const GRAV = 2000, MAXFALL = 780;
const WALK = 190, RUN = 310;
// -680 peaked at 115.6px, just 3.61 tiles, while levels were being authored
// with platforms four and five tiles up. -760 reaches 144px (4.5 tiles), which
// is the genre-normal Mario jump and what the level geometry assumes.
const JUMP = -760, JUMP_CUT = 0.42;
const ACCEL_G = 2000, ACCEL_A = 1200, FRICTION = 2600;
const COYOTE = 0.13, BUFFER = 0.17;   // forgiveness, especially on touch
const ENEMY_SPD = 52, SHELL_SPD = 300, DRONE_SPD = 70;

// ── small utils ────────────────────────────────────────────────────────
function CO_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function CO_lerp(a, b, t) { return a + (b - a) * t; }
function CO_approach(cur, target, delta) {
  return cur < target ? Math.min(cur + delta, target) : Math.max(cur - delta, target);
}

class Rect {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get r() { return this.x + this.w; }
  get b() { return this.y + this.h; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  hits(o) { return this.x < o.r && this.r > o.x && this.y < o.b && this.b > o.y; }
}

// ── INPUT ──────────────────────────────────────────────────────────────
const IN = {
  L: false, R: false, U: false, D: false, run: false,
  jumpHeld: false, jumpBuf: 0, pausePress: false, anyPress: false, mutePress: false
};

function CO_key(e, down) {
  const k = e.key;
  let used = true;
  switch (k) {
    case 'ArrowLeft': case 'a': case 'A': IN.L = down; break;
    case 'ArrowRight': case 'd': case 'D': IN.R = down; break;
    case 'ArrowDown': case 's': case 'S': IN.D = down; break;
    case 'ArrowUp': case 'w': case 'W': case ' ': case 'z': case 'Z':
      if (down && !IN.jumpHeld) { IN.jumpBuf = BUFFER; IN.anyPress = true; }
      IN.jumpHeld = down; IN.U = down; break;
    case 'Shift': IN.run = down; break;
    case 'p': case 'P': case 'Escape': if (down) IN.pausePress = true; break;
    case 'm': case 'M': if (down) IN.mutePress = true; break;
    case 'Enter': if (down) IN.anyPress = true; break;
    default: used = false;
  }
  if (used && down) AUDIO.unlock();
  if (used && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].indexOf(k) >= 0) e.preventDefault();
}
window.addEventListener('keydown', e => CO_key(e, true), { passive: false });
window.addEventListener('keyup', e => CO_key(e, false), { passive: false });
window.addEventListener('blur', () => { IN.L = IN.R = IN.U = IN.D = IN.run = IN.jumpHeld = false; });

// ── AUDIO ──────────────────────────────────────────────────────────────
const AUDIO = {
  ac: null, master: null, musicGain: null, muted: false, started: false,
  nextStep: 0, step: 0,

  unlock() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ac.destination);
        this.musicGain = this.ac.createGain();
        this.musicGain.gain.value = 0.16;
        this.musicGain.connect(this.master);
      } catch (e) { this.ac = null; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  },
  tone(freq, type, dur, vol, when, slideTo) {
    if (!this.ac || this.muted) return;
    const t0 = (when || this.ac.currentTime);
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol, filterFreq) {
    if (!this.ac || this.muted) return;
    const t0 = this.ac.currentTime;
    const len = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1337;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / len);
    }
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const f = this.ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = this.ac.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },

  jump() { this.tone(300, 'square', 0.16, 0.14, 0, 640); },
  stomp() { this.noise(0.16, 0.26, 900); this.tone(150, 'triangle', 0.12, 0.12, 0, 70); },
  coin() { this.tone(1050, 'square', 0.07, 0.1); this.tone(1580, 'square', 0.12, 0.09, this.ac ? this.ac.currentTime + 0.07 : 0); },
  power() { [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', 0.14, 0.11, this.ac ? this.ac.currentTime + i * 0.065 : 0)); },
  block() { this.noise(0.08, 0.2, 700); this.tone(180, 'square', 0.06, 0.1); },
  brk() { this.noise(0.28, 0.32, 2200); },
  hurt() { this.tone(420, 'sawtooth', 0.3, 0.16, 0, 120); },
  die() { [523, 415, 330, 247, 165].forEach((f, i) => this.tone(f, 'triangle', 0.22, 0.15, this.ac ? this.ac.currentTime + i * 0.11 : 0)); },
  clear() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 'square', 0.25, 0.13, this.ac ? this.ac.currentTime + i * 0.13 : 0)); },
  kick() { this.tone(520, 'square', 0.1, 0.12, 0, 200); },

  // brooding 4-on-the-floor Gotham loop
  BASS: [0, 0, 3, 0, 5, 0, 3, 0, -2, 0, 3, 0, 5, 7, 5, 3],
  ARP: [12, 15, 19, 15, 12, 15, 19, 22, 12, 15, 19, 15, 17, 15, 12, 10],
  tick(playing) {
    if (!this.ac || this.muted || !playing) return;
    const now = this.ac.currentTime;
    if (this.nextStep === 0) this.nextStep = now + 0.05;
    const dur = 0.155;
    while (this.nextStep < now + 0.25) {
      const s = this.step % 16;
      const root = 55; // A1
      const bn = this.BASS[s];
      if (s % 2 === 0) {
        const f = root * Math.pow(2, bn / 12);
        const o = this.ac.createOscillator(), g = this.ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        const flt = this.ac.createBiquadFilter();
        flt.type = 'lowpass'; flt.frequency.value = 420;
        g.gain.setValueAtTime(0.0001, this.nextStep);
        g.gain.exponentialRampToValueAtTime(0.5, this.nextStep + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, this.nextStep + dur * 1.8);
        o.connect(flt); flt.connect(g); g.connect(this.musicGain);
        o.start(this.nextStep); o.stop(this.nextStep + dur * 2);
      }
      if (s % 4 === 2) {
        const f = root * 2 * Math.pow(2, this.ARP[s] / 12);
        const o = this.ac.createOscillator(), g = this.ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, this.nextStep);
        g.gain.exponentialRampToValueAtTime(0.28, this.nextStep + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, this.nextStep + dur);
        o.connect(g); g.connect(this.musicGain);
        o.start(this.nextStep); o.stop(this.nextStep + dur + 0.02);
      }
      this.nextStep += dur; this.step++;
    }
  }
};

// ── WORLD (grid-based, O(1) tile lookup) ───────────────────────────────
const SOLID = { '#': 1, 'X': 1, 'B': 1, '?': 1 };

class World {
  constructor(level) {
    this.level = level;
    this.rows = level.rows;
    this.h = this.rows.length;
    this.w = this.rows[0].length;
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
    this.cells = new Array(this.w * this.h).fill(null);
    this.decor = [];
    this.beacon = null;
    let qIdx = 0;
    for (let cy = 0; cy < this.h; cy++) {
      const row = this.rows[cy];
      for (let cx = 0; cx < this.w; cx++) {
        const ch = row[cx] || ' ';
        const i = cy * this.w + cx;
        if (ch === '#' || ch === 'X' || ch === 'B') {
          this.cells[i] = { t: ch, solid: true, bump: 0, idx: cx * 31 + cy * 17, alive: true };
        } else if (ch === '?') {
          qIdx++;
          // Every 5th block is a star, every 4th a suit. The old %9 rule meant
          // level 1-1, with only 8 blocks, could never contain a star at all,
          // so the best power-up in the game was invisible to most players.
          const item = (qIdx % 5 === 0) ? 'star' : (qIdx % 4 === 0) ? 'suit' : 'rang';
          this.cells[i] = { t: '?', solid: true, bump: 0, used: false, item: item, idx: cx * 31 + cy * 17, alive: true };
        } else if (ch === 'G') {
          this.decor.push({ t: 'G', x: cx * TILE, y: cy * TILE });
        } else if (ch === 'F') {
          this.beacon = { x: cx * TILE, y: cy * TILE, reached: false };
        }
      }
    }
    // surface flag for ground tiles
    for (let cy = 0; cy < this.h; cy++)
      for (let cx = 0; cx < this.w; cx++) {
        const c = this.cells[cy * this.w + cx];
        if (c && c.t === '#') c.top = !(cy > 0 && this.cells[(cy - 1) * this.w + cx]);
      }
  }
  at(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return null;
    const c = this.cells[cy * this.w + cx];
    return c && c.alive ? c : null;
  }
  solidAt(cx, cy) {
    if (cy >= this.h) return false;
    if (cx < 0) return true;               // invisible left wall
    const c = this.at(cx, cy);
    return !!(c && c.solid);
  }
  destroy(cx, cy) {
    const c = this.at(cx, cy);
    if (c) { c.alive = false; c.solid = false; }
  }
}

// ── ENTITIES ───────────────────────────────────────────────────────────
class Player {
  constructor(x, y) {
    this.big = false;
    this.rect = new Rect(x, y, 30, 42);
    this.vx = 0; this.vy = 0;
    this.onGround = false; this.coyote = 0;
    this.face = 1;
    this.anim = 0;
    this.state = 'idle';
    this.iframes = 0;
    this.star = 0;
    this.dead = false; this.deadT = 0;
    this.bumped = null;
    this.wasGround = false;
    this.dustT = 0;
  }
  resize(big) {
    const nh = big ? 54 : 42, nw = big ? 38 : 30;
    this.rect.x += (this.rect.w - nw) / 2;
    this.rect.y += this.rect.h - nh;
    this.rect.w = nw; this.rect.h = nh;
    this.big = big;
  }
  update(dt, world, game) {
    this.anim += dt;
    if (this.dead) {
      this.deadT += dt;
      this.vy = Math.min(this.vy + GRAV * dt, MAXFALL);
      this.rect.y += this.vy * dt;
      this.state = 'dead';
      return;
    }
    if (this.iframes > 0) this.iframes -= dt;
    if (this.star > 0) { this.star -= dt; if (this.star < 0) this.star = 0; }

    const wantRun = IN.run || IN.U;
    const maxSpd = wantRun ? RUN : WALK;
    const dir = (IN.R ? 1 : 0) - (IN.L ? 1 : 0);
    const ducking = IN.D && this.onGround && this.big;

    if (dir !== 0 && !ducking) {
      this.face = dir;
      const a = (this.onGround ? ACCEL_G : ACCEL_A) * dt;
      this.vx = CO_approach(this.vx, dir * maxSpd, a);
    } else {
      const f = (this.onGround ? FRICTION : FRICTION * 0.35) * dt;
      this.vx = CO_approach(this.vx, 0, f);
    }

    // jump w/ coyote + buffer
    if (this.onGround) this.coyote = COYOTE; else if (this.coyote > 0) this.coyote -= dt;
    if (IN.jumpBuf > 0) IN.jumpBuf -= dt;
    if (IN.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP; this.onGround = false; this.coyote = 0; IN.jumpBuf = 0;
      AUDIO.jump();
      game.fx.spawnLand(this.rect.cx, this.rect.b);
    }
    if (!IN.jumpHeld && this.vy < 0) this.vy *= Math.pow(JUMP_CUT, dt * 60);

    this.vy = Math.min(this.vy + GRAV * dt, MAXFALL);

    // ── horizontal ──
    this.rect.x += this.vx * dt;
    this.solveX(world);
    // ── vertical ──
    this.wasGround = this.onGround;
    this.rect.y += this.vy * dt;
    this.onGround = false;
    this.solveY(world, game);

    if (this.onGround && !this.wasGround && this.vy >= 0) {
      game.fx.spawnLand(this.rect.cx, this.rect.b);
      if (Math.abs(this.vy) > 400) game.shake.trigger(2.5, 0.12);
    }

    // run dust
    if (this.onGround && Math.abs(this.vx) > RUN * 0.75) {
      this.dustT -= dt;
      if (this.dustT <= 0) { game.fx.spawnRunDust(this.rect.cx - this.face * 10, this.rect.b, -this.face); this.dustT = 0.07; }
    }
    if (this.star > 0) {
      this.dustT -= dt;
      if (this.dustT <= 0) { game.fx.spawnBatTrail(this.rect.cx, this.rect.cy); this.dustT = 0.05; }
    }

    // state for sprite
    if (ducking) this.state = 'duck';
    else if (!this.onGround) this.state = this.vy < -40 ? 'jump' : (this.vy > 260 ? 'glide' : 'fall');
    else if (Math.abs(this.vx) > 12) this.state = 'run';
    else this.state = 'idle';
  }
  solveX(world) {
    const r = this.rect;
    const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.r - 0.01) / TILE);
    const r0 = Math.floor(r.y / TILE), r1 = Math.floor((r.b - 0.01) / TILE);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (!world.solidAt(cx, cy)) continue;
        if (this.vx > 0) { r.x = cx * TILE - r.w; this.vx = 0; }
        else if (this.vx < 0) { r.x = (cx + 1) * TILE; this.vx = 0; }
        return;
      }
    }
  }
  solveY(world, game) {
    const r = this.rect;
    const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.r - 0.01) / TILE);
    const r0 = Math.floor(r.y / TILE), r1 = Math.floor((r.b - 0.01) / TILE);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (!world.solidAt(cx, cy)) continue;
        if (this.vy > 0) { r.y = cy * TILE - r.h; this.vy = 0; this.onGround = true; }
        else if (this.vy < 0) {
          r.y = (cy + 1) * TILE; this.vy = 0;
          game.headbutt(cx, cy);
        }
        return;
      }
    }
  }
  hurt(game) {
    if (this.iframes > 0 || this.star > 0 || this.dead) return;
    if (this.big) { this.resize(false); this.iframes = 2.2; AUDIO.hurt(); game.shake.trigger(6, 0.25); }
    else this.kill(game);
  }
  kill(game) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0; this.vy = -520; this.vx = 0;
    AUDIO.die(); game.onPlayerDead();
  }
}

class Enemy {
  constructor(cx, cy, kind) {
    this.kind = kind;
    const sz = kind === 'joker' ? [30, 30] : kind === 'penguin' ? [30, 38] : [30, 26];
    this.rect = new Rect(cx * TILE + (TILE - sz[0]) / 2, (cy + 1) * TILE - sz[1], sz[0], sz[1]);
    if (kind === 'drone') this.rect.y = cy * TILE;
    this.baseY = this.rect.y;
    this.vx = -(kind === 'drone' ? DRONE_SPD : ENEMY_SPD);
    this.vy = 0;
    this.anim = Math.abs((cx * 37 + cy * 11) % 100) / 100;
    this.alive = true; this.dying = 0;
    this.shell = false; this.shellSpin = false;
    this.score = kind === 'penguin' ? 200 : kind === 'drone' ? 300 : 100;
    this.active = false;
  }
  update(dt, world, game) {
    if (!this.alive) return;
    this.anim += dt;
    if (this.dying > 0) { this.dying -= dt; if (this.dying <= 0) this.alive = false; return; }

    if (this.kind === 'drone') {
      this.rect.x += this.vx * dt;
      this.rect.y = this.baseY + Math.sin(this.anim * 2.2) * 22;
      const cx = Math.floor((this.vx > 0 ? this.rect.r + 4 : this.rect.x - 4) / TILE);
      const cy = Math.floor(this.rect.cy / TILE);
      if (world.solidAt(cx, cy) || this.rect.x < 0) this.vx = -this.vx;
      return;
    }

    this.vy = Math.min(this.vy + GRAV * dt, MAXFALL);
    const spd = this.shell ? (this.shellSpin ? this.vx : 0) : this.vx;

    // horizontal
    this.rect.x += spd * dt;
    {
      const r = this.rect;
      const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.r - 0.01) / TILE);
      const r0 = Math.floor(r.y / TILE), r1 = Math.floor((r.b - 0.01) / TILE);
      let bumped = false;
      for (let cy = r0; cy <= r1 && !bumped; cy++)
        for (let cx = c0; cx <= c1 && !bumped; cx++) {
          if (!world.solidAt(cx, cy)) continue;
          if (spd > 0) r.x = cx * TILE - r.w; else r.x = (cx + 1) * TILE;
          this.vx = -this.vx; bumped = true;
          if (this.shellSpin) { AUDIO.block(); game.fx.spawnStomp(r.cx, r.cy); }
        }
      if (r.x < 0) { r.x = 0; this.vx = Math.abs(this.vx); }
    }
    // vertical
    this.rect.y += this.vy * dt;
    let grounded = false;
    {
      const r = this.rect;
      const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.r - 0.01) / TILE);
      const r0 = Math.floor(r.y / TILE), r1 = Math.floor((r.b - 0.01) / TILE);
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          if (!world.solidAt(cx, cy)) continue;
          if (this.vy > 0) { r.y = cy * TILE - r.h; this.vy = 0; grounded = true; }
          else if (this.vy < 0) { r.y = (cy + 1) * TILE; this.vy = 0; }
        }
    }
    // ledge turn
    if (grounded && !this.shell) {
      const ax = Math.floor((this.vx > 0 ? this.rect.r + 2 : this.rect.x - 2) / TILE);
      const ay = Math.floor((this.rect.b + 4) / TILE);
      if (!world.solidAt(ax, ay)) this.vx = -this.vx;
    }
    if (this.rect.y > world.pxH + 200) this.alive = false;
  }
  stomped(game, fromX) {
    if (this.kind === 'joker' || this.kind === 'drone') {
      this.dying = 0.45; this.shell = true;
      return this.score;
    }
    if (!this.shell) { this.shell = true; this.shellSpin = false; this.vx = 0; return this.score; }
    if (!this.shellSpin) {
      this.shellSpin = true;
      this.vx = (fromX < this.rect.cx ? 1 : -1) * SHELL_SPD;
      AUDIO.kick();
      return 50;
    }
    this.shellSpin = false; this.vx = 0; return 50;
  }
}

class Pickup {
  constructor(x, y, kind, popped) {
    this.rect = new Rect(x, y, kind === 'rang' ? 26 : 30, kind === 'rang' ? 26 : 30);
    this.kind = kind;
    this.alive = true;
    this.anim = 0;
    this.baseY = y;
    this.vy = popped ? -230 : 0;
    this.vx = 0;
    this.popping = !!popped;
    this.grounded = !popped;
    if (kind === 'suit' && popped) this.vx = 60;
  }
  update(dt, world) {
    this.anim += dt;
    if (!this.popping) { this.rect.y = this.baseY + Math.sin(this.anim * 2.6) * 4; return; }
    this.vy = Math.min(this.vy + GRAV * 0.8 * dt, 520);
    this.rect.x += this.vx * dt;
    this.rect.y += this.vy * dt;
    const r = this.rect;
    const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.r - 0.01) / TILE);
    const r1 = Math.floor((r.b - 0.01) / TILE);
    if (this.vy > 0) {
      for (let cx = c0; cx <= c1; cx++) {
        if (world.solidAt(cx, r1)) {
          r.y = r1 * TILE - r.h; this.vy = 0;
          if (this.kind !== 'suit' && this.kind !== 'star') { this.popping = false; this.baseY = r.y; }
          this.grounded = true;
          break;
        }
      }
    }
    if (this.grounded && (this.kind === 'suit' || this.kind === 'star')) {
      // keep sliding along the ground
      const ax = Math.floor((this.vx > 0 ? r.r + 2 : r.x - 2) / TILE);
      const ay = Math.floor(r.cy / TILE);
      if (world.solidAt(ax, ay)) this.vx = -this.vx;
      if (this.kind === 'star') this.vy = -260, this.grounded = false; // star bounces
    }
    if (r.y > world.pxH + 200) this.alive = false;
  }
}

// ── CAMERA ─────────────────────────────────────────────────────────────
class Camera {
  constructor(world) { this.x = 0; this.y = 0; this.world = world; }
  snap(p) { this.x = CO_clamp(p.rect.cx - CW / 2, 0, Math.max(0, this.world.pxW - CW)); }
  follow(p, dt) {
    const look = CO_clamp(p.vx * 0.32, -110, 110);
    const target = CO_clamp(p.rect.cx - CW / 2 + look, 0, Math.max(0, this.world.pxW - CW));
    this.x = CO_lerp(this.x, target, 1 - Math.pow(0.0016, dt));
  }
}

// ── GAME ───────────────────────────────────────────────────────────────
const ST = { TITLE: 'title', PLAY: 'play', PAUSE: 'pause', DEAD: 'dead', CLEAR: 'clear', OVER: 'over', WIN: 'win' };

class Game {
  constructor(canvas) {
    this.cv = canvas;
    // Must have an alpha channel: with alpha:false, clearRect yields opaque
    // black and the depth-of-field merge can never see through to the
    // blurred backdrop, so the whole sky renders black.
    this.ctx = canvas.getContext('2d');
    this.state = ST.TITLE;
    this.time = 0; this.stateT = 0; this.blinkT = 0; this.blink = true;
    this.score = 0; this.lives = 3; this.rangs = 0; this.lvIdx = 0;
    this.best = this.loadBest();
    this.fx = new ParticleSystem();
    this.atmos = new Atmosphere();
    this.fg = new Foreground();
    this.decor = new Decor();
    this.rain = new RainSystem();
    this.bolt = new Lightning();
    this.shake = new ScreenShake();
    this.enemies = []; this.pickups = [];
    this.world = null; this.player = null; this.cam = null;
    this.acc = 0; this.last = 0;
    this.fx2 = null; this.prm = null; this.aberrPulse = 0;
    this.fxCanvas = null; this.perfAcc = 0; this.perfN = 0;
    this.boss = null; this.lastDt = 1 / 60;
    this.gfxTier = 3;
    this.gfxScale = 1;
    this.strikeSeed = 0; this.prevFlash = 0;
  }

  // Quality tiers.
  //
  // The first version of this ladder shed one effect per step, which measured
  // as almost useless: switching shadows, AO, bloom, DoF, wet, rays, streaks
  // and FXAA off one at a time each moved the framerate by under 1 fps, while
  // stubbing the whole GPU pass moved it from 6.7 to 27. The cost is not in any
  // single effect - it is in the fixed set of full-screen half-float passes the
  // chain always runs. So the lever that actually works is pixel count, and
  // every step down now drops the internal render resolution as well.
  //
  // Resolution is also the least damaging thing to give up: bloom, lighting and
  // the wet reflection are all low-frequency, so at 70% they are very hard to
  // tell apart, and the chain keeps its whole look instead of losing features.
  applyTier() {
    const p = this.prm;
    if (!p) return;
    const t = this.gfxTier;
    // 0.50 was tried and rejected: below about 0.6 the 2D scene is undersampled
    // badly enough that the rain, the fog and the lit windows smear into a pale
    // veil over the whole frame. 0.62 still holds the look.
    const s = t >= 3 ? 1.0 : (t >= 2 ? 0.78 : 0.62);
    this.gfxScale = s;
    // AO, shadows, wet and the rest stay ON at every tier. The measurement is
    // the reason: each of them individually was worth well under 1 fps, so
    // switching them off only made the game look worse for nothing. The one
    // thing that is genuinely proportional is the per-light shadow march.
    p.shadowLights = t >= 3 ? 3 : (t >= 2 ? 2 : 1);
    // Lens character has to shrink with the buffer or it stops being subtle:
    // the aberration fringe and the grain are both authored in screen pixels,
    // and upscaling a half-size buffer doubles them into obvious colour
    // fringing and chunky 2x2 noise.
    // aberration is rebuilt from scratch by postParams every frame (shake and
    // lightning drive it), so scaling the live value is safe. grain and distort
    // are not rewritten anywhere, so those come off the stored originals -
    // multiplying them in place would walk them to zero within a second.
    p.aberration *= s;
    p.grain = this.gfxBase.grain * s;
    p.distort = this.gfxBase.distort * s;
    // below tier 3 the upscale is already a bilinear smooth, so FXAA on top of
    // it only costs a pass and softens the sprite edges further
    p.fxaa = t >= 3;
  }

  degradePostFX() {
    if (!this.fx2) return;
    if (this.gfxTier > 1) {
      this.gfxTier--;
      this.applyTier();
      return;
    }
    this.fx2 = null;
    if (this.fxCanvas) this.fxCanvas.style.display = 'none';
    this.cv.style.display = 'block';
    try { window.__postfxOn = false; } catch (e) { }
  }

  // Hook up the WebGL post-processing chain. Returns false if the device
  // cannot run it, in which case the caller keeps showing the raw 2D canvas.
  attachPostFX(fxCanvas) {
    if (typeof PostFX !== 'function') return false;
    const fx = PostFX(fxCanvas);
    if (!fx) return false;
    this.fx2 = fx;
    this.fxCanvas = fxCanvas;
    this.prm = PostFX.defaults();
    this.gfxBase = { grain: this.prm.grain, distort: this.prm.distort };
    this.gfxTier = 3;
    this.gfxScale = 1;
    // Normals are low-frequency, so a half-res buffer is indistinguishable
    // and halves the per-frame texture upload.
    LT_init();
    this.ncv = document.createElement('canvas');
    this.ncv.width = Math.round(CW * 0.5);
    this.ncv.height = Math.round(CH * 0.5);
    this.nctx = this.ncv.getContext('2d');
    // Occluders only need to be coarse — shadows are soft — so quarter res.
    this.ocv = document.createElement('canvas');
    this.ocv.width = Math.round(CW * 0.25);
    this.ocv.height = Math.round(CH * 0.25);
    this.octx = this.ocv.getContext('2d');
    this.wcv = document.createElement('canvas');
    this.wcv.width = Math.round(CW * 0.5);
    this.wcv.height = Math.round(CH * 0.5);
    this.wctx = this.wcv.getContext('2d');
    // Backdrop gets its own canvas so it can be blurred in WebGL. Doing it
    // with ctx.filter measured 26fps -> 1fps; this costs one extra upload.
    this.bgcv = document.createElement('canvas');
    this.bgcv.width = this.cv.width; this.bgcv.height = this.cv.height;
    this.bgctx = this.bgcv.getContext('2d', { alpha: false });
    this.lights = [];
    return true;
  }

  // ── normal buffer ────────────────────────────────────────────────────
  // Mirrors drawWorld, but stamps baked normal sprites instead of art.
  drawNormals(camX) {
    const n = this.nctx, L = LT_cache;
    n.setTransform(0.5, 0, 0, 0.5, 0, 0);
    n.globalAlpha = 1;
    n.fillStyle = 'rgb(128,128,255)';
    n.fillRect(0, 0, CW, CH);
    if (!this.world) return;

    const w = this.world;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);
    for (let cy = 0; cy < w.h; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = w.cells[cy * w.w + cx];
        if (!c || !c.alive) continue;
        const x = cx * TILE - camX;
        const y = cy * TILE - (c.bump > 0 ? Math.sin(c.bump * Math.PI) * 9 : 0);
        // ground rows rake light across them; floating blocks get a hard chamfer
        const spr = c.t === '#' ? (c.top ? L.bevelSoft : L.ground) : L.bevel;
        n.drawImage(spr, x, y, TILE, TILE);
      }
    }
    for (const k of this.pickups) {
      if (k.rect.r < camX - 40 || k.rect.x > camX + CW + 40) continue;
      n.drawImage(L.dome, k.rect.x - camX, k.rect.y, k.rect.w, k.rect.h);
    }
    for (const e of this.enemies) {
      if (e.rect.r < camX - 60 || e.rect.x > camX + CW + 60) continue;
      n.drawImage(L.dome, e.rect.x - camX, e.rect.y, e.rect.w, e.rect.h);
    }
    const p = this.player;
    if (p && !p.dead) n.drawImage(L.domeTall, p.rect.x - camX, p.rect.y, p.rect.w, p.rect.h);
  }

  // ── occluder buffer ──────────────────────────────────────────────────
  // Solid silhouettes only. The shadow pass marches this toward each light,
  // so shape matters and shading does not.
  // ── occluder + material buffer ───────────────────────────────────────
  // Three channels, three jobs, one upload:
  //   R  solid silhouette, marched by the shadow pass and sampled for AO
  //   G  roughness      0 = mirror, 1 = fully diffuse
  //   B  specular mass  how much light the surface throws back at the viewer
  //
  // Packing the material here rather than into a fourth canvas is deliberate:
  // an extra full-screen upload per frame measured as a real cost, and
  // roughness and specular mass are low-frequency properties — the NORMAL
  // buffer supplies all the high-frequency detail the highlight needs, so a
  // quarter-resolution material map is indistinguishable from a full one.
  drawOccluders(camX) {
    const o = this.octx;
    o.setTransform(0.25, 0, 0, 0.25, 0, 0);
    o.globalAlpha = 1;
    // air: not solid, fully rough, no specular
    o.fillStyle = 'rgb(0,235,0)';
    o.fillRect(0, 0, CW, CH);
    if (!this.world) return;
    const w = this.world;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);

    // rough / spec per material, as 0-255 byte pairs
    const M = {
      '#': [184, 54],    // street stone: coarse, barely shiny
      'X': [104, 150],   // dressed stone block: part polished
      'B': [214, 28],    // brick: matte
      '?': [58, 224],    // signal block: lacquered metal
    };
    const WETTOP = [26, 242];   // rain-slicked top face: near mirror

    for (let cy = 0; cy < w.h; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = w.cells[cy * w.w + cx];
        if (!c || !c.alive || !c.solid) continue;
        const m = M[c.t] || M['#'];
        o.fillStyle = 'rgb(255,' + m[0] + ',' + m[1] + ')';
        o.fillRect(cx * TILE - camX, cy * TILE, TILE, TILE);
        // the exposed, wet upper face is the shiniest thing in the frame and
        // the reason street lamps streak across the ground
        if (c.t === '#' && c.top) {
          o.fillStyle = 'rgb(255,' + WETTOP[0] + ',' + WETTOP[1] + ')';
          o.fillRect(cx * TILE - camX, cy * TILE, TILE, 7);
        }
      }
    }

    const ell = (r, rough, spec) => {
      o.fillStyle = 'rgb(255,' + rough + ',' + spec + ')';
      o.beginPath();
      o.ellipse(r.cx - camX, r.cy, r.w * 0.42, r.h * 0.46, 0, 0, Math.PI * 2);
      o.fill();
    };
    for (const e of this.enemies) {
      if (e.rect.r < camX - 60 || e.rect.x > camX + CW + 60 || e.dying > 0) continue;
      ell(e.rect, 128, 96);
    }
    if (this.boss && !this.boss.defeated) ell(this.boss.rect, 112, 120);
    const p = this.player;
    // the suit is the one genuinely hard, dark, lacquered surface on screen
    if (p && !p.dead) ell(p.rect, 76, 186);
  }

  // ── wet surfaces ─────────────────────────────────────────────────────
  // Marks every exposed floor top and records, in the green channel, the v
  // coordinate of that surface so the shader knows what line to mirror about.
  drawWet(camX) {
    const o = this.wctx;
    o.setTransform(0.5, 0, 0, 0.5, 0, 0);
    o.globalAlpha = 1;
    o.fillStyle = '#000';
    o.fillRect(0, 0, CW, CH);
    if (!this.world) return;
    const w = this.world;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);
    for (let cy = 0; cy < w.h; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = w.cells[cy * w.w + cx];
        if (!c || !c.alive || c.t !== '#' || !c.top) continue;
        const y = cy * TILE;
        // never let the band spill past the solid mass underneath, or a thin
        // ledge would paint reflections onto the sky below it
        const deep = !!(w.cells[(cy + 1) * w.w + cx] && w.cells[(cy + 1) * w.w + cx].solid);
        const band = deep ? 44 : 28;
        const g = Math.round((1 - y / CH) * 255);
        o.fillStyle = 'rgb(255,' + g + ',0)';
        o.fillRect(cx * TILE - camX, y, TILE, band);
      }
    }

    // Blue channel carries heat haze. Drawn additively in blue only, so it
    // layers on top of the wet mask without disturbing the red/green the
    // reflection pass reads.
    o.globalCompositeOperation = 'lighter';
    const blob = (x, y, r, amt) => {
      if (x < -r || x > CW + r) return;
      const gg = o.createRadialGradient(x, y, 0, x, y, Math.max(2, r));
      gg.addColorStop(0, 'rgba(0,0,255,' + amt + ')');
      gg.addColorStop(1, 'rgba(0,0,255,0)');
      o.fillStyle = gg;
      o.beginPath(); o.arc(x, y, Math.max(2, r), 0, Math.PI * 2); o.fill();
    };
    if (this.atmos) {
      for (const q of this.atmos.p) {
        if (q.kind !== 'steam') continue;
        const k = q.age / q.life;
        blob(q.x - camX, q.y, q.r * 1.25, 0.55 * (1 - k));
      }
    }
    if (this.boss) {
      for (const pr of this.boss.proj) {
        if (pr.blast > 0) blob(pr.rect.cx - camX, pr.rect.cy, 54, 0.9);
      }
      if (this.boss.gasY < CH) {
        o.fillStyle = 'rgba(0,0,255,0.4)';
        o.fillRect(0, this.boss.gasY - 14, CW, CH - this.boss.gasY + 24);
      }
    }
    o.globalCompositeOperation = 'source-over';
  }

  // ── scene lights ─────────────────────────────────────────────────────
  // Screen-uv space, y flipped into GL convention (0 = bottom).
  collectLights(camX) {
    const out = this.lights;
    out.length = 0;
    const push = (wx, wy, r, cr, cg, cb, i, z) => {
      const sx = wx - camX;
      if (sx < -120 || sx > CW + 120 || out.length >= 24) return;
      out.push({
        x: sx / CW, y: 1 - wy / CH, z: z === undefined ? 0.10 : z,
        r: r / CH, cr: cr, cg: cg, cb: cb, i: i,
      });
    };
    if (!this.world) return out;
    const t = this.time;

    // the goal beacon is the strongest light in any level
    const bc = this.world.beacon;
    if (bc) push(bc.x + TILE / 2, bc.y - TILE * 1.5, 560, 1.0, 0.82, 0.32,
      bc.reached ? 3.0 : 1.70, 0.16);

    // street furniture: the environment is a light source, not scenery
    this.decor.addLights(push, camX, t);

    // live bat-signal blocks glow, spent ones go dark
    const w = this.world;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);
    for (let cy = 0; cy < w.h; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = w.cells[cy * w.w + cx];
        if (!c || !c.alive || c.t !== '?' || c.used) continue;
        push(cx * TILE + TILE / 2, cy * TILE + TILE / 2, 210,
          1.0, 0.78, 0.26, 1.15 + 0.20 * Math.sin(t * 4 + cx), 0.085);
      }
    }
    for (const k of this.pickups) {
      if (k.kind === 'suit') push(k.rect.cx, k.rect.cy, 230, 1.0, 0.22, 0.18, 1.45);
      else if (k.kind === 'star') push(k.rect.cx, k.rect.cy, 300, 1.0, 0.88, 0.35, 1.90);
      else push(k.rect.cx, k.rect.cy, 120, 1.0, 0.80, 0.30, 0.58, 0.07);
    }
    for (const e of this.enemies) {
      if (e.kind === 'drone' && e.alive && e.dying <= 0)
        push(e.rect.cx, e.rect.b, 165, 0.30, 1.0, 0.35, 0.88, 0.07);
    }
    const p = this.player;
    if (p && p.star > 0 && !p.dead)
      push(p.rect.cx, p.rect.cy, 300, 1.0, 0.85, 0.40,
        2.0 * Math.min(1, p.star / 1.2), 0.12);

    // Only the first few lights cast shadows, so order matters: put the ones
    // that carry the scene (big and bright) at the front.
    out.sort((a, b) => (b.i * b.r) - (a.i * a.r));
    return out;
  }

  postParams() {
    const p = this.prm, pl = this.player;
    PostFX.grade(p, this.lvIdx);
    p.time = this.time;
    // lightning washes the whole frame, exactly as it does in the 2D pass
    const fl = this.bolt.flash;
    // Exposure went from 1.30 to 1.95 when the grade was reworked, and the
    // lightning was never rescaled to match — a strike blew the whole frame to
    // flat white. A strike should read as a hard, brief wash that still leaves
    // the silhouettes readable, so every term that feeds it is now smaller.
    p.flash = fl * 0.045;
    // and drives the directional light, so a strike genuinely rakes across the
    // geometry instead of just brightening the image
    // The moon is the key light, so it has to be bright enough to model the
    // geometry: at 0.13 it was barely above the ambient and every surface came
    // out the same value, which is why the playfield merged into the skyline.
    p.sunCol[0] = 0.30 + fl * 0.17;
    p.sunCol[1] = 0.33 + fl * 0.19;
    p.sunCol[2] = 0.39 + fl * 0.23;

    // A strike is a light source, not a colour wash. Each one picks its own
    // steep angle and, while it lasts, takes over the directional shadow with
    // a long hard throw so every block and figure stamps a shadow across the
    // street. Between strikes the moon's soft angle returns.
    if (this.prevFlash < 0.08 && fl >= 0.08) this.strikeSeed += 1.7;
    this.prevFlash = fl;
    if (fl > 0.06) {
      const k = Math.sin(this.strikeSeed * 3.1) * 0.85;
      p.sunDir[0] = k;
      p.sunDir[1] = 0.62;
      p.sunDir[2] = 0.30;
      p.sunShadow = 0.85 + fl * 0.13;
      p.sunLen = 0.13 + fl * 0.22;
    } else {
      p.sunDir[0] = 0.38; p.sunDir[1] = 0.58; p.sunDir[2] = 0.72;
      p.sunShadow = 0.85;
      p.sunLen = 0.13;
    }
    // star power: everything blooms harder and the grade goes molten gold
    if (pl && pl.star > 0) {
      const s = Math.min(1, pl.star / 1.5);
      p.bloom += 0.30 * s;
      p.exposure = 1.18 + 0.12 * s;
      p.hiTint.set([1.12, 1.04, 0.88]);
    } else {
      p.exposure = 1.18;
    }
    // Impacts kick the lens. Derived from the screen shake already in flight,
    // so every stomp, landing and block break drives it without each call site
    // having to remember to.
    const sh = Math.abs(this.shake.x) + Math.abs(this.shake.y);
    // Kept deliberately small. Boss slams shake hard, and at the old gain the
    // fringing tore the HUD text apart every time one landed.
    p.aberration = 1.0 + Math.min(0.8, sh * 0.16) + this.bolt.flash * 1.1;

    // Light shafts originate at the moon, which parallaxes with the camera.
    // Matches the 0.04 factor environment.js draws it at.
    const camX = this.cam ? this.cam.x : 0;
    p.rayX = (680 - camX * 0.04) / CW;
    p.rayY = 1 - 75 / CH;
    p.rays = 0.34 + fl * 0.55;
    // Feed the two strongest on-screen lamps to the scatter pass as extra
    // centres. They are already in screen-uv space with y flipped into GL
    // convention, which is exactly what the shader wants.
    const ls = this.lights;
    if (ls && ls.length) {
      const pts = p.rayPts;
      pts.length = 0;
      for (let i = 0; i < ls.length && pts.length < 6; i++) {
        const L = ls[i];
        if (L.x < -0.1 || L.x > 1.1 || L.i < 0.5) continue;
        pts.push(L.x, L.y, Math.min(0.85, L.i * 0.38));
      }
    }
    const rainAmt = this.world && this.world.level ? (this.world.level.rain || 0.6) : 0.6;
    p.wet = 0.48 + 0.46 * rainAmt;
    p.ripple = rainAmt;              // no rain, no rings
    if (this.state === ST.DEAD) { p.vignette = 1.5; p.saturation = 0.45; }
    else if (this.state === ST.TITLE) { p.vignette = 1.0; p.bloom += 0.14; }
    else p.vignette = 0.85;
    this.applyTier();   // postParams rewrote several tier-controlled values
    return p;
  }
  loadBest() { try { return parseInt(localStorage.getItem('bat_best') || '0', 10) || 0; } catch (e) { return 0; } }
  saveBest() { try { if (this.score > this.best) { this.best = this.score; localStorage.setItem('bat_best', String(this.best)); } } catch (e) { } }

  loadLevel(i) {
    const lv = LEVELS[i];
    this.world = new World(lv);
    this.enemies = []; this.pickups = [];
    this.fx.clear();
    if (this.atmos) this.atmos.clear();
    for (let cy = 0; cy < this.world.h; cy++) {
      const row = this.world.rows[cy];
      for (let cx = 0; cx < this.world.w; cx++) {
        const ch = row[cx];
        if (ch === 'J') this.enemies.push(new Enemy(cx, cy, 'joker'));
        else if (ch === 'P') this.enemies.push(new Enemy(cx, cy, 'penguin'));
        else if (ch === 'D') this.enemies.push(new Enemy(cx, cy, 'drone'));
        else if (ch === 'o') this.pickups.push(new Pickup(cx * TILE + 3, cy * TILE + 3, 'rang', false));
      }
    }
    this.boss = lv.boss ? new Boss(lv.boss) : null;
    this.decor.build(this.world, lv.id);
    this.fg.build(this.world, lv.id);
    const wasBig = this.player ? this.player.big : false;
    this.player = new Player(lv.start.tx * TILE, (lv.start.ty + 1) * TILE - 42);
    if (wasBig) this.player.resize(true);
    this.cam = new Camera(this.world);
    this.cam.snap(this.player);
  }
  startRun() {
    this.score = 0; this.lives = 3; this.rangs = 0; this.lvIdx = 0;
    this.player = null;
    this.loadLevel(0);
    this.state = ST.PLAY; this.stateT = 0;
    AUDIO.nextStep = 0;
  }
  onPlayerDead() { this.lives--; this.state = ST.DEAD; this.stateT = 0; this.shake.trigger(8, 0.35); }
  award(v, x, y) { this.score += v; this.fx.spawnScore(x, y, v); }

  headbutt(cx, cy) {
    const c = this.world.at(cx, cy);
    if (!c) return;
    const wx = cx * TILE, wy = cy * TILE;
    if (c.t === '?') {
      if (c.used) { AUDIO.block(); return; }
      c.used = true; c.bump = 1; AUDIO.block();
      this.pickups.push(new Pickup(wx + 1, wy - TILE, c.item, true));
      this.fx.spawnPickup(wx + TILE / 2, wy, PAL.yellow);
      this.shake.trigger(2, 0.08);
    } else if (c.t === 'B') {
      if (this.player.big) {
        this.world.destroy(cx, cy);
        this.fx.spawnBlockBreak(wx + TILE / 2, wy + TILE / 2);
        AUDIO.brk(); this.shake.trigger(4, 0.15); this.award(50, wx + TILE / 2, wy);
      } else { c.bump = 1; AUDIO.block(); }
    } else { c.bump = 1; AUDIO.block(); }
  }

  update(dt) {
    this.lastDt = dt;
    this.time += dt; this.stateT += dt;
    this.blinkT += dt; if (this.blinkT > 0.5) { this.blink = !this.blink; this.blinkT = 0; }
    this.bolt.update(dt);
    this.rain.update(dt, 0.35);
    this.shake.update(dt);
    this.fx.update(dt);
    if (this.state === ST.PLAY) this.atmos.update(dt, this);

    if (IN.mutePress) { IN.mutePress = false; AUDIO.toggleMute(); }

    if (this.state === ST.TITLE) {
      if (IN.anyPress) { IN.anyPress = false; IN.jumpBuf = 0; AUDIO.unlock(); this.startRun(); }
      IN.pausePress = false; return;
    }
    if (this.state === ST.OVER || this.state === ST.WIN) {
      if (IN.anyPress && this.stateT > 0.8) { IN.anyPress = false; IN.jumpBuf = 0; this.startRun(); }
      IN.pausePress = false; return;
    }
    IN.anyPress = false;

    if (this.state === ST.CLEAR) {
      if (this.stateT > 2.6) {
        this.lvIdx++;
        if (this.lvIdx >= LEVELS.length) { this.saveBest(); this.state = ST.WIN; this.stateT = 0; }
        else { this.loadLevel(this.lvIdx); this.state = ST.PLAY; this.stateT = 0; }
      }
      return;
    }
    if (this.state === ST.DEAD) {
      this.player.update(dt, this.world, this);
      this.cam.follow(this.player, dt);
      if (this.stateT > 2.2) {
        if (this.lives <= 0) { this.saveBest(); this.state = ST.OVER; this.stateT = 0; }
        else { this.loadLevel(this.lvIdx); this.state = ST.PLAY; this.stateT = 0; }
      }
      return;
    }
    if (IN.pausePress) { IN.pausePress = false; this.state = this.state === ST.PAUSE ? ST.PLAY : ST.PAUSE; this.stateT = 0; }
    if (this.state === ST.PAUSE) return;

    // ══ PLAY ══
    const p = this.player;
    p.update(dt, this.world, this);

    if (this.boss) {
      this.boss.update(dt, this);
      if (this.boss.defeated && this.boss.deadT > 2.6) {
        this.award(5000 + this.lives * 1000, this.boss.rect.cx, this.boss.rect.y);
        this.state = ST.CLEAR; this.stateT = 0; this.saveBest();
        return;
      }
    }

    // block bump decay
    for (let i = 0; i < this.world.cells.length; i++) {
      const c = this.world.cells[i];
      if (c && c.bump > 0) c.bump = Math.max(0, c.bump - dt * 6);
    }

    // enemies: only simulate near camera
    const lo = this.cam.x - 260, hi = this.cam.x + CW + 260;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!e.active) { if (e.rect.x < hi) e.active = true; else continue; }
      if (e.rect.r < lo - 500) continue;
      e.update(dt, this.world, this);
      if (!e.alive || e.dying > 0) continue;

      // shell vs other enemies
      if (e.shellSpin) {
        for (const o of this.enemies) {
          if (o === e || !o.alive || o.dying > 0) continue;
          if (e.rect.hits(o.rect)) {
            o.dying = 0.4; o.shell = true;
            this.award(o.score, o.rect.cx, o.rect.y);
            this.fx.spawnStomp(o.rect.cx, o.rect.cy); AUDIO.stomp();
          }
        }
      }
      // vs player
      if (p.dead || !p.rect.hits(e.rect)) continue;
      const prevBottom = p.rect.b - p.vy * dt;
      const stomping = p.vy > 0 && prevBottom <= e.rect.y + 10;
      if (p.star > 0) {
        e.dying = 0.4; e.shell = true;
        this.award(e.score * 2, e.rect.cx, e.rect.y);
        this.fx.spawnStomp(e.rect.cx, e.rect.cy); AUDIO.stomp(); this.shake.trigger(3, 0.1);
      } else if (stomping) {
        const v = e.stomped(this, p.rect.cx);
        this.award(v, e.rect.cx, e.rect.y);
        p.vy = IN.jumpHeld ? JUMP * 0.82 : JUMP * 0.55;
        this.fx.spawnStomp(e.rect.cx, e.rect.y); AUDIO.stomp(); this.shake.trigger(3.5, 0.12);
      } else if (e.shell && !e.shellSpin) {
        e.stomped(this, p.rect.cx);
      } else {
        p.hurt(this);
      }
    }

    // pickups
    for (const k of this.pickups) {
      if (!k.alive) continue;
      k.update(dt, this.world);
      if (p.dead || !p.rect.hits(k.rect)) continue;
      k.alive = false;
      if (k.kind === 'rang') { this.rangs++; this.award(100, k.rect.cx, k.rect.y); AUDIO.coin(); this.fx.spawnPickup(k.rect.cx, k.rect.cy, PAL.yellow); }
      else if (k.kind === 'suit') { if (!p.big) p.resize(true); this.award(1000, k.rect.cx, k.rect.y); AUDIO.power(); this.fx.spawnPickup(k.rect.cx, k.rect.cy, PAL.danger); }
      else { p.star = 10; this.award(1000, k.rect.cx, k.rect.y); AUDIO.power(); this.fx.spawnPickup(k.rect.cx, k.rect.cy, PAL.yellow); this.shake.trigger(4, 0.2); }
      if (this.rangs > 0 && this.rangs % 50 === 0) { this.lives++; AUDIO.power(); }
    }
    this.pickups = this.pickups.filter(k => k.alive);
    this.enemies = this.enemies.filter(e => e.alive);

    // beacon (boss arenas have none: the fight is the exit)
    const bc = this.boss ? null : this.world.beacon;
    if (bc && !bc.reached && p.rect.r > bc.x + 6) {
      bc.reached = true;
      this.award(2000 + this.lives * 500, bc.x, bc.y);
      AUDIO.clear(); this.state = ST.CLEAR; this.stateT = 0;
      this.saveBest();
    }
    // pit death
    if (!p.dead && p.rect.y > this.world.pxH + 60) p.kill(this);

    this.cam.follow(this.player, dt);
    AUDIO.tick(this.state === ST.PLAY);
  }

  draw() {
    const ctx = this.ctx;
    const lightning = this.bolt.flash;
    const camX = this.cam ? this.cam.x : 0;
    const t = this.time;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // With post-processing on, the backdrop goes to its own canvas so the GPU
    // can blur it for depth of field and the playfield stays razor sharp. With
    // it off there is nothing to composite against, so it goes straight in.
    let bg = ctx;
    if (this.fx2 && this.bgctx) {
      // Half resolution on purpose. The backdrop's only destination is the
      // depth-of-field blur, which immediately downsamples it to a quarter, so
      // every pixel drawn above half is thrown away - and it was being drawn by
      // the CPU and uploaded to the GPU in full every single frame.
      const bw = Math.max(1, this.cv.width >> 1), bh = Math.max(1, this.cv.height >> 1);
      if (this.bgcv.width !== bw || this.bgcv.height !== bh) {
        this.bgcv.width = bw; this.bgcv.height = bh;
      }
      bg = this.bgctx;
      bg.setTransform(DPR * 0.5, 0, 0, DPR * 0.5, 0, 0);
      ctx.clearRect(0, 0, CW, CH);
    }
    drawGothamSky(bg, camX, t, lightning);
    drawGothamSkyline(bg, camX, t, lightning);
    if (lightning > 0.25) this.bolt.drawBolt(bg, t);
    drawCityFog(bg, camX, t);
    // atmospheric separation: push the lit skyline back so the dark playfield
    // and the darker player read clearly against it
    bg.fillStyle = 'rgba(5,7,18,0.42)';
    bg.fillRect(0, 0, CW, CH);

    ctx.save();
    ctx.translate(Math.round(this.shake.x), Math.round(this.shake.y));

    if (this.world) this.drawWorld(ctx, camX, t);
    this.fx.draw(ctx, camX);
    ctx.restore();

    const lv = this.world ? this.world.level : null;
    // Out-of-focus clutter between the camera and the playfield. It goes in
    // AFTER the world and the particles so it occludes them — occlusion is
    // half of where the eye gets depth from — but before the rain, so rain
    // still falls in front of it, and before the HUD, which must never be
    // covered.
    if (this.world) this.fg.draw(ctx, camX, t);
    this.rain.draw(ctx, camX, lv ? lv.rain : 0.6);
    drawForegroundVignette(ctx, lightning);

    const p = this.player;
    if (p && this.state === ST.PLAY && Math.abs(p.vx) > RUN * 0.9) drawSpeedLines(ctx, t, 0.5);
    if (p && p.star > 0) drawSpeedLines(ctx, t, 0.8);

    if (this.state !== ST.TITLE) {
      drawHUD(ctx, {
        lives: this.lives, score: this.score, batarangs: this.rangs,
        levelId: LEVELS[this.lvIdx].id, levelName: LEVELS[this.lvIdx].name,
        starActive: p ? p.star > 0 : false, starTimer: p ? p.star : 0,
        best: this.best, time: t
      });
    }
    if (this.boss && this.state === ST.PLAY) {
      const b = this.boss;
      drawBossHealthBar(ctx, CW / 2 - 250, 76, 500, 24, {
        name: b.name, hp: b.hp, maxHp: b.maxHp, phase: b.phase, t: t, flash: b.hurtFlash,
      });
      if (b.introT < 2.4) drawBossIntro(ctx, t, b.name, b.subtitle, b.introT / 2.4);
    }

    switch (this.state) {
      case ST.TITLE: drawTitleScreen(ctx, t, this.blink); break;
      case ST.PAUSE: drawPauseOverlay(ctx, t); break;
      case ST.DEAD: drawDeathOverlay(ctx, t, this.lives); break;
      case ST.CLEAR: drawLevelCompleteOverlay(ctx, t, this.score, LEVELS[this.lvIdx].name); break;
      case ST.OVER: drawGameOverOverlay(ctx, t, this.score, this.best, this.blink); break;
      case ST.WIN: drawWinOverlay(ctx, t, this.score, this.best, this.blink); break;
    }

    // everything above rendered into the offscreen 2D canvas; now light + grade it
    if (this.fx2) {
      this.drawNormals(camX);
      this.drawOccluders(camX);
      this.drawWet(camX);
      const lights = this.collectLights(camX);
      this.fx2.resize(this.cv.width, this.cv.height, this.gfxScale);
      this.fx2.render(this.cv, this.ncv, this.ocv, this.wcv, this.bgcv, lights, this.postParams());
    }
  }

  drawWorld(ctx, camX, t) {
    const w = this.world;
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);

    // gargoyles behind blocks
    for (const d of w.decor) {
      if (d.x + TILE * 2 < camX || d.x > camX + CW) continue;
      drawGargoyle(ctx, d.x - camX, d.y - TILE * 2, TILE, TILE * 3, t);
    }
    // beacon behind player
    if (w.beacon && w.beacon.x + 200 > camX && w.beacon.x - 200 < camX + CW)
      drawBeacon(ctx, w.beacon.x - camX, w.beacon.y, TILE, t, w.beacon.reached);

    for (let cy = 0; cy < w.h; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = w.cells[cy * w.w + cx];
        if (!c || !c.alive) continue;
        const x = cx * TILE - camX;
        const y = cy * TILE - (c.bump > 0 ? Math.sin(c.bump * Math.PI) * 9 : 0);
        if (c.t === '#') drawGroundTile(ctx, x, y, TILE, { top: !!c.top, idx: c.idx });
        else if (c.t === 'X') drawStoneBlock(ctx, x, y, TILE, c.idx);
        else if (c.t === 'B') drawBrickBlock(ctx, x, y, TILE, c.idx);
        else if (c.t === '?') drawBatSignalBlock(ctx, x, y, TILE, c.used, t);
      }
    }
    this.decor.draw(ctx, camX, t);

    for (const k of this.pickups) {
      if (k.rect.r < camX - 40 || k.rect.x > camX + CW + 40) continue;
      const x = k.rect.x - camX, y = k.rect.y;
      if (k.kind === 'rang') drawBatarang(ctx, x + k.rect.w / 2, y + k.rect.h / 2, 12, k.anim * 6);
      else if (k.kind === 'suit') drawBatSuitPickup(ctx, x, y, 30, t);
      else drawBatSignalStar(ctx, x, y, 30, t);
    }
    for (const e of this.enemies) {
      if (e.rect.r < camX - 60 || e.rect.x > camX + CW + 60) continue;
      const x = e.rect.x - camX, y = e.rect.y;
      const o = { facingRight: e.vx > 0, animTime: e.anim, squashed: e.dying > 0, dying: e.dying > 0, shell: e.shell, shellSpinning: e.shellSpin };
      if (e.kind === 'joker') drawJokerMinion(ctx, x, y, e.rect.w, e.rect.h, o);
      else if (e.kind === 'penguin') drawPenguinHenchman(ctx, x, y, e.rect.w, e.rect.h, o);
      else drawJokerDrone(ctx, x, y, e.rect.w, e.rect.h, o);
    }
    this.atmos.draw(ctx, camX);

    if (this.boss) this.boss.draw(ctx, t);

    const p = this.player;
    if (p) {
      const blinking = p.iframes > 0 && Math.floor(p.iframes * 12) % 2 === 0;
      if (!blinking) {
        const o = {
          facingRight: p.face > 0, state: p.state, animTime: p.anim,
          big: p.big, star: p.star > 0, speed: Math.abs(p.vx),
        };
        // Per-object motion blur. A camera integrates over the whole exposure,
        // so anything moving fast smears — and its absence is one of the
        // quieter reasons sprite animation reads as animation rather than as
        // footage. Echoes are drawn BEHIND the figure, stepped back along the
        // velocity, so the leading edge stays sharp and only the trail softens.
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 330) {
          const k = Math.min(1, (sp - 330) / 420);
          const stepX = -p.vx * 0.0042, stepY = -p.vy * 0.0042;
          ctx.save();
          for (let i = 3; i >= 1; i--) {
            ctx.globalAlpha = 0.20 * k * (1 - (i - 1) / 3);
            drawBatmanSprite(ctx, p.rect.x - camX + stepX * i, p.rect.y + stepY * i,
              p.rect.w, p.rect.h, o);
          }
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        drawBatmanSprite(ctx, p.rect.x - camX, p.rect.y, p.rect.w, p.rect.h, o);
      }
    }
  }

  frame(ts) {
    if (!this.last) this.last = ts;
    let dt = (ts - this.last) / 1000;
    this.last = ts;
    if (dt > 0.25) dt = 0.25;

    // sustained-low-framerate watchdog (skipped while capturing video)
    if (this.fx2 && !(typeof window !== 'undefined' && window.__capture)) {
      this.perfAcc += dt; this.perfN++;
      // 1.6s per step rather than 2.5: with three steps the old window left a
      // slow machine stuttering for seven and a half seconds before it settled.
      if (this.perfAcc > 1.6) {
        if (this.perfAcc / this.perfN > 0.026) this.degradePostFX();   // under ~38fps
        this.perfAcc = 0; this.perfN = 0;
      }
    }

    this.acc += dt;
    const STEP = 1 / 120;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 8) { this.update(STEP); this.acc -= STEP; }
    this.draw();
    requestAnimationFrame(this.frame.bind(this));
  }
  run() { requestAnimationFrame(this.frame.bind(this)); }
}


// ── high-DPI backing store ─────────────────────────────────────────────
(function(){
  var cv = document.getElementById('gc');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width  = Math.round(CW * DPR);
  cv.height = Math.round(CH * DPR);
})();
window.__postfxOn = false;

// ── touch controls ─────────────────────────────────────────────────────
(function(){
  function hold(id, on, off){
    var el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('pointerdown', function(e){
      e.preventDefault(); AUDIO.unlock();
      // Capture the pointer: without this a finger that drifts a few pixels off
      // the button fires pointerleave and silently drops the input, which is
      // what makes a touch d-pad feel like it keeps letting go mid-run.
      try { el.setPointerCapture(e.pointerId); } catch(err){}
      on();
    });
    var release = function(e){
      e.preventDefault();
      try { el.releasePointerCapture(e.pointerId); } catch(err){}
      off();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }
  // Touch movement always runs: holding a separate CORRER button while also
  // steering and jumping is one finger too many on a phone.
  hold('bL', function(){ IN.L = true; IN.run = true; },
             function(){ IN.L = false; IN.run = IN.R; });
  hold('bR', function(){ IN.R = true; IN.run = true; },
             function(){ IN.R = false; IN.run = IN.L; });
  hold('bA',
    function(){ IN.jumpBuf = BUFFER; IN.jumpHeld = true; IN.anyPress = true; },
    function(){ IN.jumpHeld = false; });

  function tap(id, fn){
    var el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('pointerdown', function(e){ e.preventDefault(); AUDIO.unlock(); fn(); });
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }
  tap('bP', function(){ IN.pausePress = true; });
  tap('bM', function(){ IN.mutePress = true; });

  // tap the stage to start / dismiss, and to give the frame keyboard focus
  document.getElementById('stage').addEventListener('pointerdown', function(){
    AUDIO.unlock();
    try { window.focus(); } catch(err){}
    IN.anyPress = true;
  });
})();

// ── boot ───────────────────────────────────────────────────────────────
function start(saved){
  var game = new Game(document.getElementById('gc'));
  window.__game = game;

  // WebGL grading pass. If the device cannot run it we simply keep showing
  // the raw 2D canvas — the game is fully playable either way.
  var fxc = document.getElementById('fx');
  if (game.attachPostFX(fxc)) {
    document.getElementById('gc').style.display = 'none';
    window.__postfxOn = true;
  } else {
    fxc.style.display = 'none';
  }
  if (saved && typeof saved.lvIdx === 'number' && saved.lvIdx < LEVELS.length && saved.playing) {
    game.score = saved.score || 0;
    game.lives = saved.lives || 3;
    game.rangs = saved.rangs || 0;
    game.lvIdx = saved.lvIdx;
    game.loadLevel(saved.lvIdx);
    game.state = 'play';
  }
  try {
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
      window.claude.hot.snapshot(function(){
        return { score: game.score, lives: game.lives, rangs: game.rangs,
                 lvIdx: game.lvIdx, playing: game.state === 'play' || game.state === 'pause' };
      });
    }
  } catch(e){}
  game.run();
}

function boot(){
  var hot = (window.claude && window.claude.hot) || null;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(boot).catch(boot);
  setTimeout(function(){ if(!window.__booted){ window.__booted = 1; boot(); } }, 1800);
  var _b = boot;
  boot = function(){ if(window.__booted) return; window.__booted = 1; _b(); };
} else {
  boot();
}
