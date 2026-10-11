// ============================================================================
// fx.js -- particles, weather, lightning, camera feel.  Module prefix: FX_
// Batman / Arkham-flavoured atmospherics, 100% canvas primitives.
// ============================================================================

const FX_MAX_PARTICLES = 400;
const FX_TAU = Math.PI * 2;

// ---- deterministic pseudo-random ------------------------------------------
function FX_rnd(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function FX_rnd2(n, k) {
  const s = Math.sin(n * 269.5 + k * 183.3 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
// signed -1..1
function FX_srnd(n, k) { return FX_rnd2(n, k) * 2 - 1; }

function FX_clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function FX_lerp(a, b, t) { return a + (b - a) * t; }

// module-level gradient cache (keyed by string) -- gradients are screen-space
// radial/linear built at origin then translated, so they can be reused freely.
const FX_gradCache = Object.create(null);
function FX_radial(ctx, key, r, stops) {
  let g = FX_gradCache[key];
  if (!g) {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    FX_gradCache[key] = g;
  }
  return g;
}
function FX_linear(ctx, key, x0, y0, x1, y1, stops) {
  let g = FX_gradCache[key];
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    FX_gradCache[key] = g;
  }
  return g;
}

function FX_roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// color helpers -------------------------------------------------------------
function FX_hex2rgb(hex) {
  if (typeof hex !== 'string' || hex.charAt(0) !== '#') return [255, 255, 255];
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function FX_rgba(hex, a) {
  const c = FX_hex2rgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}
function FX_shade(hex, amt) { // amt -1..1
  const c = FX_hex2rgb(hex);
  const f = amt < 0 ? (1 + amt) : 1;
  const add = amt > 0 ? 255 * amt : 0;
  const r = FX_clamp(Math.round(c[0] * f + add), 0, 255);
  const g = FX_clamp(Math.round(c[1] * f + add), 0, 255);
  const b = FX_clamp(Math.round(c[2] * f + add), 0, 255);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ============================================================================
// ParticleSystem
// ============================================================================
class ParticleSystem {
  constructor() {
    this.parts = [];
    this.seed = 0;          // deterministic spawn counter
    this.time = 0;
  }

  clear() { this.parts.length = 0; }

  // internal: push with cap. Oldest non-score particles are evicted first.
  FX_push(p) {
    const arr = this.parts;
    if (arr.length >= FX_MAX_PARTICLES) {
      let idx = -1;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].kind !== 'score') { idx = i; break; }
      }
      if (idx < 0) idx = 0;
      arr.splice(idx, 1);
    }
    arr.push(p);
  }

  FX_mk(kind, x, y, vx, vy, life, size, color) {
    return {
      kind: kind, x: x, y: y, vx: vx, vy: vy,
      life: life, maxLife: life, size: size, size0: size,
      rot: 0, vrot: 0, grav: 260, drag: 1.6, color: color || PAL.stoneL,
      alpha: 1, spin: 0, text: null, glow: 0, seed: 0
    };
  }

  // -- stomp: dust ring + bright impact shards -------------------------------
  spawnStomp(x, y) {
    const s = ++this.seed;
    // flat expanding shock ring
    const ring = this.FX_mk('ring', x, y, 0, 0, 0.32, 6, PAL.eye);
    ring.grav = 0; ring.glow = 1;
    this.FX_push(ring);
    const ring2 = this.FX_mk('ring', x, y, 0, 0, 0.5, 2, PAL.yellow);
    ring2.grav = 0; ring2.glow = 1;
    this.FX_push(ring2);

    // dust puffs low and wide
    for (let i = 0; i < 12; i++) {
      const a = Math.PI + (i / 11) * Math.PI + FX_srnd(s, i) * 0.22;
      const sp = 60 + FX_rnd2(s, i + 40) * 130;
      const p = this.FX_mk('dust', x + FX_srnd(s, i + 7) * 6, y + FX_srnd(s, i + 9) * 3,
        Math.cos(a) * sp, Math.sin(a) * sp * 0.55 - 20,
        0.45 + FX_rnd2(s, i + 3) * 0.4, 5 + FX_rnd2(s, i + 11) * 7, PAL.stoneL);
      p.grav = 130; p.drag = 2.6;
      p.vrot = FX_srnd(s, i + 17) * 3;
      this.FX_push(p);
    }
    // hard shards flung upward
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI * 0.5 + FX_srnd(s, i + 60) * 1.25;
      const sp = 150 + FX_rnd2(s, i + 70) * 190;
      const p = this.FX_mk('shard', x, y - 2, Math.cos(a) * sp, Math.sin(a) * sp,
        0.4 + FX_rnd2(s, i + 80) * 0.35, 2 + FX_rnd2(s, i + 90) * 3.5,
        i % 3 === 0 ? PAL.yellow : PAL.eye);
      p.grav = 620; p.drag = 0.5; p.vrot = FX_srnd(s, i + 100) * 12; p.glow = 1;
      this.FX_push(p);
    }
  }

  // -- landing puff ----------------------------------------------------------
  spawnLand(x, y) {
    const s = ++this.seed;
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const sp = 40 + FX_rnd2(s, i) * 90;
      const p = this.FX_mk('dust', x + side * (2 + FX_rnd2(s, i + 5) * 5), y,
        side * sp, -18 - FX_rnd2(s, i + 12) * 34,
        0.32 + FX_rnd2(s, i + 20) * 0.3, 4 + FX_rnd2(s, i + 25) * 5, PAL.stone);
      p.grav = 90; p.drag = 3.2; p.vrot = FX_srnd(s, i + 31) * 2.4;
      this.FX_push(p);
    }
    const ring = this.FX_mk('ring', x, y, 0, 0, 0.24, 4, PAL.stoneL);
    ring.grav = 0; ring.glow = 0.5;
    this.FX_push(ring);
  }

  // -- running scuff ---------------------------------------------------------
  spawnRunDust(x, y, dir) {
    const s = ++this.seed;
    const d = dir >= 0 ? 1 : -1;
    for (let i = 0; i < 2; i++) {
      const p = this.FX_mk('dust', x - d * (2 + FX_rnd2(s, i) * 4), y - FX_rnd2(s, i + 2) * 3,
        -d * (25 + FX_rnd2(s, i + 4) * 55), -14 - FX_rnd2(s, i + 6) * 26,
        0.28 + FX_rnd2(s, i + 8) * 0.24, 2.5 + FX_rnd2(s, i + 10) * 3.5, PAL.stone);
      p.grav = 70; p.drag = 3.6; p.vrot = FX_srnd(s, i + 13) * 3;
      this.FX_push(p);
    }
  }

  // -- block break: chunky rotating stone debris -----------------------------
  spawnBlockBreak(x, y) {
    const s = ++this.seed;
    const cols = [PAL.stone, PAL.stoneD, PAL.stoneL, PAL.mortar];
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.5 + FX_srnd(s, i) * 2.2;
      const sp = 110 + FX_rnd2(s, i + 20) * 230;
      const p = this.FX_mk('chunk',
        x + FX_srnd(s, i + 3) * 12, y + FX_srnd(s, i + 4) * 12,
        Math.cos(a) * sp, Math.sin(a) * sp - 60,
        0.7 + FX_rnd2(s, i + 30) * 0.6,
        4 + FX_rnd2(s, i + 40) * 8, cols[i & 3]);
      p.grav = 760; p.drag = 0.35;
      p.vrot = FX_srnd(s, i + 50) * 11;
      p.rot = FX_rnd2(s, i + 60) * FX_TAU;
      p.seed = i + s;
      this.FX_push(p);
    }
    // fine dust cloud left behind
    for (let i = 0; i < 8; i++) {
      const a = FX_rnd2(s, i + 90) * FX_TAU;
      const sp = 20 + FX_rnd2(s, i + 95) * 60;
      const p = this.FX_mk('dust', x, y, Math.cos(a) * sp, Math.sin(a) * sp - 30,
        0.6 + FX_rnd2(s, i + 99) * 0.5, 7 + FX_rnd2(s, i + 101) * 9, PAL.stoneD);
      p.grav = 30; p.drag = 2.0;
      this.FX_push(p);
    }
    const ring = this.FX_mk('ring', x, y, 0, 0, 0.3, 8, PAL.stoneL);
    ring.grav = 0; ring.glow = 0.6;
    this.FX_push(ring);
  }

  // -- pickup sparkle burst --------------------------------------------------
  spawnPickup(x, y, color) {
    const s = ++this.seed;
    const c = color || PAL.yellow;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * FX_TAU + FX_srnd(s, i) * 0.3;
      const sp = 90 + FX_rnd2(s, i + 15) * 160;
      const p = this.FX_mk('spark', x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.4 + FX_rnd2(s, i + 25) * 0.45, 1.6 + FX_rnd2(s, i + 35) * 2.6, c);
      p.grav = 210; p.drag = 2.2; p.glow = 1; p.vrot = FX_srnd(s, i + 45) * 8;
      this.FX_push(p);
    }
    // four long cross-flares
    for (let i = 0; i < 4; i++) {
      const p = this.FX_mk('flare', x, y, 0, 0, 0.3, 16 + i * 2, c);
      p.grav = 0; p.rot = (i / 4) * Math.PI; p.glow = 1;
      this.FX_push(p);
    }
    const ring = this.FX_mk('ring', x, y, 0, 0, 0.42, 3, c);
    ring.grav = 0; ring.glow = 1;
    this.FX_push(ring);
  }

  // -- floating score text ---------------------------------------------------
  spawnScore(x, y, value) {
    const p = this.FX_mk('score', x, y, 0, -54, 1.05, 15, PAL.yellow);
    p.grav = 26; p.drag = 0.6;
    p.text = (typeof value === 'string') ? value : ('+' + value);
    this.FX_push(p);
  }

  // -- bat afterimage --------------------------------------------------------
  spawnBatTrail(x, y) {
    const s = ++this.seed;
    const p = this.FX_mk('bat', x, y, FX_srnd(s, 1) * 18, -10 - FX_rnd2(s, 2) * 24,
      0.55 + FX_rnd2(s, 3) * 0.3, 7 + FX_rnd2(s, 4) * 5, PAL.bat);
    p.grav = -14; p.drag = 1.1;
    p.rot = FX_srnd(s, 5) * 0.5;
    p.vrot = FX_srnd(s, 6) * 1.6;
    p.seed = s;
    this.FX_push(p);
  }

  // -- rain splash -----------------------------------------------------------
  spawnSplash(x, y) {
    const s = ++this.seed;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * 0.5 + FX_srnd(s, i) * 1.1;
      const sp = 30 + FX_rnd2(s, i + 4) * 55;
      const p = this.FX_mk('drop', x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.2 + FX_rnd2(s, i + 8) * 0.18, 1 + FX_rnd2(s, i + 12) * 1.2, PAL.rain);
      p.grav = 480; p.drag = 0.2; p.glow = 0.4;
      this.FX_push(p);
    }
    const ring = this.FX_mk('ring', x, y, 0, 0, 0.22, 1.5, PAL.rain);
    ring.grav = 0; ring.glow = 0.35; ring.size0 = 1.5;
    this.FX_push(ring);
  }

  // -- simulation ------------------------------------------------------------
  update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    this.time += dt;
    const arr = this.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = (p.vy + p.grav * dt) * d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const t = p.life / p.maxLife;           // 1 -> 0
      p.alpha = t < 0.35 ? t / 0.35 : 1;
      if (p.kind === 'ring') {
        p.size = p.size0 + (1 - t) * (p.size0 * 5.5 + 14);
        p.alpha *= t * 0.9;
      } else if (p.kind === 'flare') {
        p.size = p.size0 * (0.35 + (1 - t) * 1.4);
        p.alpha = t * t;
      } else if (p.kind === 'dust') {
        p.size = p.size0 * (1 + (1 - t) * 1.3);
        p.alpha *= 0.55 * t + 0.12;
      } else if (p.kind === 'score') {
        p.alpha = t > 0.7 ? (1 - t) / 0.3 : Math.min(1, t / 0.45);
      } else {
        p.size = p.size0 * (0.35 + t * 0.65);
      }
    }
  }

  // -- rendering -------------------------------------------------------------
  draw(ctx, camX) {
    const arr = this.parts;
    if (arr.length === 0) return;
    const cx = camX || 0;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const sx = p.x - cx;
      const sy = p.y;
      if (sx < -80 || sx > CW + 80 || sy < -120 || sy > CH + 120) continue;
      const a = FX_clamp(p.alpha, 0, 1);
      if (a <= 0.004) continue;
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'dust':   this.FX_drawDust(ctx, p, sx, sy); break;
        case 'shard':  this.FX_drawShard(ctx, p, sx, sy); break;
        case 'chunk':  this.FX_drawChunk(ctx, p, sx, sy); break;
        case 'spark':  this.FX_drawSpark(ctx, p, sx, sy); break;
        case 'flare':  this.FX_drawFlare(ctx, p, sx, sy); break;
        case 'ring':   this.FX_drawRing(ctx, p, sx, sy); break;
        case 'score':  this.FX_drawScore(ctx, p, sx, sy); break;
        case 'bat':    this.FX_drawBat(ctx, p, sx, sy); break;
        case 'drop':   this.FX_drawDrop(ctx, p, sx, sy); break;
        default:       this.FX_drawSpark(ctx, p, sx, sy); break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }

  FX_drawDust(ctx, p, x, y) {
    // soft volumetric puff: dark core, lit upper edge
    const r = Math.max(0.6, p.size);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot);
    ctx.scale(r, r * 0.82);
    const g = FX_radial(ctx, 'dustPuff', 1, [
      [0.0, FX_rgba(PAL.stoneL, 0.55)],
      [0.45, FX_rgba(PAL.stone, 0.32)],
      [1.0, FX_rgba(PAL.stoneD, 0.0)]
    ]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, FX_TAU);
    ctx.fill();
    // rim: a crescent of moonlight on the top-left
    ctx.globalAlpha *= 0.5;
    ctx.strokeStyle = FX_rgba(PAL.moonGlow, 0.5);
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, 0.82, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
  }

  FX_drawShard(ctx, p, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot);
    ctx.shadowBlur = 10;
    ctx.shadowColor = FX_rgba(p.color, 0.9);
    const s = Math.max(0.5, p.size);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.42, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.42, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = FX_rgba(PAL.white, 0.75);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.2, -s * 0.2);
    ctx.lineTo(-s * 0.12, -s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  FX_drawChunk(ctx, p, x, y) {
    const s = Math.max(1, p.size);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot);
    // drop shadow behind the chunk
    ctx.globalAlpha *= 0.9;
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    // irregular quad from deterministic seed
    const n = p.seed;
    const k1 = 0.55 + FX_rnd(n) * 0.6;
    const k2 = 0.55 + FX_rnd(n + 1) * 0.6;
    const k3 = 0.55 + FX_rnd(n + 2) * 0.6;
    const k4 = 0.55 + FX_rnd(n + 3) * 0.6;
    ctx.beginPath();
    ctx.moveTo(-s * k1, -s * k2);
    ctx.lineTo(s * k3, -s * k1 * 0.8);
    ctx.lineTo(s * k2 * 0.9, s * k4);
    ctx.lineTo(-s * k4 * 0.85, s * k3 * 0.8);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    // shading pass: dark gradient on lower-right
    ctx.save();
    ctx.clip();
    ctx.scale(s, s);
    const gs = FX_linear(ctx, 'chunkShade', -1, -1, 1, 1, [
      [0, 'rgba(255,255,255,0.18)'],
      [0.5, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.55)']
    ]);
    ctx.fillStyle = gs;
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
    // rim light top edge
    ctx.strokeStyle = FX_rgba(PAL.moonGlow, 0.45);
    ctx.lineWidth = Math.max(0.6, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(-s * k1, -s * k2);
    ctx.lineTo(s * k3, -s * k1 * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  FX_drawSpark(ctx, p, x, y) {
    const s = Math.max(0.4, p.size);
    ctx.save();
    ctx.translate(x, y);
    // glow halo
    ctx.save();
    ctx.scale(s * 3.2, s * 3.2);
    ctx.fillStyle = FX_radial(ctx, 'sparkGlow', 1, [
      [0, 'rgba(255,255,255,0.5)'],
      [0.35, FX_rgba(p.color, 0.32)],
      [1, FX_rgba(p.color, 0)]
    ]);
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, FX_TAU); ctx.fill();
    ctx.restore();
    // hot core, stretched along velocity
    const sp = Math.hypot(p.vx, p.vy);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    const stretch = 1 + FX_clamp(sp / 240, 0, 2.2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * stretch, s * 0.8, 0, 0, FX_TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5 * stretch, s * 0.32, 0, 0, FX_TAU);
    ctx.fill();
    ctx.restore();
  }

  FX_drawFlare(ctx, p, x, y) {
    const s = Math.max(1, p.size);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot);
    ctx.shadowBlur = 12;
    ctx.shadowColor = FX_rgba(p.color, 0.9);
    ctx.fillStyle = FX_rgba(p.color, 0.85);
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(0, -s * 0.13, s, 0);
    ctx.quadraticCurveTo(0, s * 0.13, -s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  FX_drawRing(ctx, p, x, y) {
    const r = Math.max(0.5, p.size);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.42);   // ground-hugging ellipse
    ctx.lineWidth = Math.max(0.7, 3.2 * (p.life / p.maxLife));
    if (p.glow > 0) {
      ctx.shadowBlur = 14 * p.glow;
      ctx.shadowColor = FX_rgba(p.color, 0.8);
    }
    ctx.strokeStyle = FX_rgba(p.color, 0.85);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, FX_TAU); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha *= 0.4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = FX_rgba(PAL.white, 0.6);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, FX_TAU); ctx.stroke();
    ctx.restore();
  }

  FX_drawScore(ctx, p, x, y) {
    ctx.save();
    ctx.translate(x, y);
    const t = p.life / p.maxLife;
    const pop = t > 0.85 ? 1 + (t - 0.85) * 2.6 : 1;
    ctx.scale(pop, pop);
    ctx.font = 'bold ' + p.size + 'px "Trebuchet MS", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = p.text || '+100';
    // dark outline for readability over any background
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(txt, 0, 0);
    ctx.shadowBlur = 10;
    ctx.shadowColor = FX_rgba(PAL.yellow, 0.9);
    const g = FX_linear(ctx, 'scoreGrad', 0, -10, 0, 10, [
      [0, '#fff6cf'], [0.5, PAL.yellow], [1, PAL.yellowD]
    ]);
    ctx.fillStyle = g;
    ctx.fillText(txt, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  FX_drawBat(ctx, p, x, y) {
    const s = Math.max(2, p.size);
    const flap = Math.sin(p.rot * 3 + p.seed) * 0.35;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot * 0.3);
    ctx.globalAlpha *= 0.85;
    ctx.shadowBlur = 9;
    ctx.shadowColor = FX_rgba(PAL.capeHi, 0.7);
    ctx.fillStyle = FX_rgba(PAL.bat, 0.95);
    ctx.beginPath();
    // body
    ctx.moveTo(0, -s * 0.28);
    // right wing
    ctx.bezierCurveTo(s * 0.5, -s * (0.7 + flap), s * 1.15, -s * 0.35, s * 1.5, s * 0.05);
    ctx.lineTo(s * 1.05, -s * 0.02);
    ctx.lineTo(s * 0.78, s * 0.22);
    ctx.lineTo(s * 0.5, s * 0.02);
    ctx.lineTo(s * 0.2, s * 0.34);
    ctx.lineTo(0, s * 0.12);
    // left wing (mirror)
    ctx.lineTo(-s * 0.2, s * 0.34);
    ctx.lineTo(-s * 0.5, s * 0.02);
    ctx.lineTo(-s * 0.78, s * 0.22);
    ctx.lineTo(-s * 1.05, -s * 0.02);
    ctx.lineTo(-s * 1.5, s * 0.05);
    ctx.bezierCurveTo(-s * 1.15, -s * 0.35, -s * 0.5, -s * (0.7 + flap), 0, -s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // rim highlight along the leading edge
    ctx.globalAlpha *= 0.55;
    ctx.strokeStyle = FX_rgba(PAL.capeHi, 0.9);
    ctx.lineWidth = Math.max(0.5, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(-s * 1.5, s * 0.05);
    ctx.bezierCurveTo(-s * 1.15, -s * 0.35, -s * 0.5, -s * (0.7 + flap), 0, -s * 0.28);
    ctx.bezierCurveTo(s * 0.5, -s * (0.7 + flap), s * 1.15, -s * 0.35, s * 1.5, s * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  FX_drawDrop(ctx, p, x, y) {
    const s = Math.max(0.35, p.size);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = FX_rgba(PAL.rain, 0.85);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 2.1, s * 0.7, 0, 0, FX_TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================================
// RainSystem -- 3 parallax bands of slanted streaks
// ============================================================================
class RainSystem {
  constructor() {
    this.t = 0;
    this.wind = 0;
    // band: [count, speed, len, alpha, slant, parallax, width]
    // Denser and much fainter than before. Rain reads as rain through DENSITY
    // and through variation in opacity; it was reading as scratches on the lens
    // because there were few streaks, each long, opaque and identical. The old
    // near band drew 46 strokes at 52% — plus "heavy" drops at 72px long, pure
    // white and glowing, which is what the eye was actually catching on.
    this.bands = [
      { n: 170, speed: 620, len: 11, alpha: 0.10, slant: 0.16, par: 0.06, w: 0.8, heavy: 0.0 },
      { n: 130, speed: 980, len: 20, alpha: 0.15, slant: 0.22, par: 0.16, w: 1.1, heavy: 0.05 },
      { n: 78, speed: 1520, len: 32, alpha: 0.22, slant: 0.30, par: 0.34, w: 1.4, heavy: 0.12 }
    ];
    // pre-baked per-drop offsets so nothing is random per frame
    this.cache = [];
    for (let b = 0; b < this.bands.length; b++) {
      const arr = new Float32Array(this.bands[b].n * 4);
      for (let i = 0; i < this.bands[b].n; i++) {
        arr[i * 4 + 0] = FX_rnd2(b * 91 + 5, i) * (CW + 420) - 210;   // x
        arr[i * 4 + 1] = FX_rnd2(b * 57 + 11, i) * (CH + 260);        // y phase
        arr[i * 4 + 2] = 0.72 + FX_rnd2(b * 33 + 19, i) * 0.62;       // speed jitter
        arr[i * 4 + 3] = FX_rnd2(b * 77 + 23, i);                     // misc
      }
      this.cache.push(arr);
    }
  }

  update(dt, wind) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    this.t += dt;
    const target = wind || 0;
    this.wind += (target - this.wind) * Math.min(1, dt * 3);
  }

  draw(ctx, camX, intensity) {
    let inten = intensity === undefined ? 1 : FX_clamp(intensity, 0, 1);
    if (inten <= 0.01) return;
    const cx = camX || 0;
    const t = this.t;
    const w = this.wind;
    ctx.save();
    ctx.lineCap = 'round';
    const span = CH + 260;
    const wrapX = CW + 420;
    for (let b = 0; b < this.bands.length; b++) {
      const B = this.bands[b];
      const arr = this.cache[b];
      const count = Math.max(0, Math.round(B.n * (0.35 + inten * 0.65)));
      const slant = B.slant + w * (0.35 + b * 0.25);
      const drift = -cx * B.par + w * 140 * t * (0.4 + b * 0.3);
      // Three opacity buckets per band, batched. One flat alpha for every drop
      // is the single thing that makes procedural rain look like a screen
      // overlay rather than weather — real drops sit at every distance between
      // the lens and the subject, so no two catch the light equally. Splitting
      // the existing per-drop random into buckets buys that variation for two
      // extra strokes per band instead of one path per drop.
      ctx.lineWidth = B.w;
      for (let bucket = 0; bucket < 3; bucket++) {
        const lo = bucket / 3, hi = (bucket + 1) / 3;
        ctx.strokeStyle = FX_rgba(PAL.rain, B.alpha * inten * (0.45 + bucket * 0.42));
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const r = arr[i * 4 + 3];
          if (r < lo || r >= hi) continue;
          const sp = B.speed * arr[i * 4 + 2];
          let y = (arr[i * 4 + 1] + t * sp) % span;
          if (y < 0) y += span;
          y -= 140;
          let x = (arr[i * 4 + 0] + drift + y * slant) % wrapX;
          if (x < 0) x += wrapX;
          x -= 210;
          const L = B.len * (0.75 + arr[i * 4 + 2] * 0.5);
          ctx.moveTo(x, y);
          ctx.lineTo(x - slant * L, y + L);
        }
        ctx.stroke();
      }

      // A few drops closer to the lens. Short and dim: these used to be 1.8x
      // the band length, pure white and carrying a shadowBlur glow, which is
      // exactly how you draw a scratch, not a raindrop.
      if (B.heavy > 0) {
        const hc = Math.max(1, Math.round(count * B.heavy * (0.4 + inten * 0.6)));
        ctx.lineWidth = B.w * 1.5;
        ctx.strokeStyle = FX_rgba(PAL.rain, 0.30 * inten);
        ctx.beginPath();
        for (let i = 0; i < hc; i++) {
          const j = (i * 7 + 3) % count;
          const sp = B.speed * arr[j * 4 + 2] * 1.18;
          let y = (arr[j * 4 + 1] * 1.7 + t * sp) % span;
          if (y < 0) y += span;
          y -= 140;
          let x = (arr[j * 4 + 0] * 1.31 + drift + y * slant) % wrapX;
          if (x < 0) x += wrapX;
          x -= 210;
          const L = B.len * 1.15;
          ctx.moveTo(x, y);
          ctx.lineTo(x - slant * L, y + L);
        }
        ctx.stroke();
      }
    }
    // faint sheet of mist drifting across the lower screen
    ctx.globalAlpha = 0.08 * inten;
    const mist = FX_linear(ctx, 'rainMist', 0, CH * 0.55, 0, CH, [
      [0, 'rgba(134,144,156,0)'],
      [1, 'rgba(134,144,156,0.55)']
    ]);
    ctx.fillStyle = mist;
    ctx.fillRect(0, CH * 0.55, CW, CH * 0.45);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

// ============================================================================
// Rim light -- the edge that separates a figure from the night behind it
//
// A dark character against a dark city is a hole in the picture. Every modern
// game solves it the same way: a hard, cold light rakes the figure from the
// key's side, catching the cowl, the shoulder and the leading edge of the
// cape. Without it Batman reads as a black blob; with it he reads as a solid
// object standing in weather, and nothing else in this pass comes close for
// the money.
//
// Done generically rather than inside each sprite, because there are five
// character renderers and they are all built from dozens of separate paths
// with their own transform stacks — there is no single silhouette to stroke.
// Instead the sprite is drawn once to a scratch canvas, flattened to a solid
// colour through source-in, stamped offset toward the light, and then the real
// sprite is drawn over it. What survives is a crescent along the lit edge.
//
// Two cached canvases, reused for every character, resized only when something
// bigger comes along. Costs two drawImage calls per figure.
// ============================================================================
var FX_rimA = null, FX_rimB = null, FX_rimAC = null, FX_rimBC = null;

function FX_rimmed(ctx, x, y, w, h, opt, fn) {
  const pad = 6;
  const cw = Math.ceil(w) + pad * 2, chh = Math.ceil(h) + pad * 2;
  if (!FX_rimA) {
    FX_rimA = document.createElement('canvas');
    FX_rimB = document.createElement('canvas');
    FX_rimA.width = FX_rimB.width = 8;
    FX_rimA.height = FX_rimB.height = 8;
  }
  if (FX_rimA.width < cw || FX_rimA.height < chh) {
    // grow to fit the largest figure seen; resizing also clears, and a boss is
    // several times the size of a minion, so this settles after a few frames
    FX_rimA.width = FX_rimB.width = Math.max(cw, FX_rimA.width);
    FX_rimA.height = FX_rimB.height = Math.max(chh, FX_rimA.height);
    FX_rimAC = FX_rimBC = null;
  }
  // getContext is cheap but not free, and this runs once per figure per frame
  const a = FX_rimAC || (FX_rimAC = FX_rimA.getContext('2d'));
  const b = FX_rimBC || (FX_rimBC = FX_rimB.getContext('2d'));
  a.setTransform(1, 0, 0, 1, 0, 0);
  // clear only the area this figure uses, not the whole boss-sized buffer
  a.clearRect(0, 0, cw, chh);
  a.save();
  a.translate(pad, pad);
  fn(a, 0, 0);
  a.restore();

  // flatten the sprite's alpha to a single colour
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, cw, chh);
  b.drawImage(FX_rimA, 0, 0, cw, chh, 0, 0, cw, chh);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = opt.colour || 'rgba(188,210,236,1)';
  b.fillRect(0, 0, cw, chh);
  b.globalCompositeOperation = 'source-over';

  const dx = opt.dx === undefined ? 1.6 : opt.dx;
  const dy = opt.dy === undefined ? -1.8 : opt.dy;
  // Every blit takes the explicit source rect. The buffers are sized to the
  // LARGEST figure ever drawn but only the current figure's corner is cleared,
  // so a whole-canvas drawImage would drag in whatever the boss left behind.
  const al = opt.alpha === undefined ? 0.5 : opt.alpha;
  ctx.save();
  ctx.globalAlpha = al;
  ctx.drawImage(FX_rimB, 0, 0, cw, chh, x - pad + dx, y - pad + dy, cw, chh);
  // a second, wider, fainter stamp reads as the light wrapping the form
  if (opt.wrap) {
    ctx.globalAlpha = al * 0.34;
    ctx.drawImage(FX_rimB, 0, 0, cw, chh, x - pad + dx * 2.1, y - pad + dy * 2.1, cw, chh);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.drawImage(FX_rimA, 0, 0, cw, chh, x - pad, y - pad, cw, chh);
}

// ============================================================================
// Lightning -- deterministic strike scheduler + forked bolt
// ============================================================================
class Lightning {
  constructor() {
    this.clock = 0;
    this.strikeIdx = 0;
    this.nextAt = 3.2;
    this.strikeT = -1;      // seconds since current strike began, <0 = idle
    this.duration = 0;
    this.boltSeed = 1;
    this._flash = 0;
    this.boltX = CW * 0.5;
  }

  FX_schedule() {
    const n = ++this.strikeIdx;
    // 4.5 .. 13.5 seconds between strikes
    this.nextAt = this.clock + 4.5 + FX_rnd(n * 3.1) * 9.0;
    this.boltSeed = n * 17 + 5;
    this.boltX = 60 + FX_rnd(n * 7.7) * (CW - 120);
    this.duration = 0.55 + FX_rnd(n * 5.3) * 0.4;
    this.strikeT = 0;
  }

  update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    this.clock += dt;
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      if (this.strikeT > this.duration) this.strikeT = -1;
    }
    if (this.strikeT < 0 && this.clock >= this.nextAt) this.FX_schedule();

    // double-blink envelope: fast attack, drop, second pop, long tail
    let f = 0;
    const t = this.strikeT;
    if (t >= 0) {
      const d = this.duration;
      if (t < 0.045) {
        f = t / 0.045;                              // attack
      } else if (t < 0.14) {
        f = 1 - (t - 0.045) / 0.095 * 0.82;         // drop to 0.18
      } else if (t < 0.20) {
        f = 0.18 + (t - 0.14) / 0.06 * 0.72;        // second pop to 0.9
      } else {
        const k = (t - 0.20) / Math.max(0.001, d - 0.20);
        f = 0.9 * Math.pow(1 - FX_clamp(k, 0, 1), 2.4);
      }
    }
    this._flash = FX_clamp(f, 0, 1);
  }

  get flash() { return this._flash; }

  // draws a forked bolt; t is 0..1 progress within the strike (defaults to internal)
  drawBolt(ctx, t) {
    let prog = (t === undefined || t === null)
      ? (this.strikeT >= 0 ? this.strikeT / Math.max(0.001, this.duration) : -1)
      : t;
    if (prog < 0 || prog > 1) return;
    // bolt is only visible in the first third of the strike
    const vis = prog < 0.30 ? Math.pow(1 - prog / 0.30, 0.7) : 0;
    if (vis <= 0.01) return;

    const seed = this.boltSeed;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = vis;

    // --- build main channel points
    const segs = 14;
    const endY = CH * (0.48 + FX_rnd(seed + 91) * 0.22);
    const pts = [];
    let x = this.boltX, y = -20;
    const drift = FX_srnd(seed, 3) * 90;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const jitter = FX_srnd(seed + i * 13, i) * (34 * (1 - k * 0.45));
      pts.push([
        this.boltX + drift * k + jitter,
        FX_lerp(-20, endY, k) + FX_srnd(seed + i * 5, i + 2) * 8
      ]);
    }
    pts[0][0] = this.boltX; pts[0][1] = -20;

    const strokeChain = (chain, width, color, blur) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowBlur = blur;
      ctx.shadowColor = FX_rgba(PAL.moonGlow, 0.9);
      ctx.beginPath();
      ctx.moveTo(chain[0][0], chain[0][1]);
      for (let i = 1; i < chain.length; i++) ctx.lineTo(chain[i][0], chain[i][1]);
      ctx.stroke();
    };

    // outer violet glow -> mid blue -> white core
    strokeChain(pts, 16, FX_rgba(PAL.skyGlow, 0.22), 26);
    strokeChain(pts, 7, FX_rgba(PAL.moonGlow, 0.6), 18);
    strokeChain(pts, 2.6, 'rgba(255,255,255,0.95)', 12);

    // --- forks
    ctx.shadowBlur = 10;
    for (let f = 0; f < 4; f++) {
      const at = 3 + Math.floor(FX_rnd(seed + f * 29) * (segs - 5));
      const base = pts[at];
      const dir = FX_srnd(seed + f * 41, f) >= 0 ? 1 : -1;
      const n = 4 + Math.floor(FX_rnd(seed + f * 17) * 3);
      const chain = [[base[0], base[1]]];
      let fx = base[0], fy = base[1];
      for (let i = 1; i <= n; i++) {
        fx += dir * (14 + FX_rnd2(seed + f, i) * 30);
        fy += 16 + FX_rnd2(seed + f * 3, i + 5) * 34;
        chain.push([fx, fy]);
      }
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = FX_rgba(PAL.moonGlow, 0.45);
      ctx.shadowColor = FX_rgba(PAL.moonGlow, 0.8);
      ctx.beginPath();
      ctx.moveTo(chain[0][0], chain[0][1]);
      for (let i = 1; i < chain.length; i++) ctx.lineTo(chain[i][0], chain[i][1]);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
    }

    // --- glow bloom around the strike origin
    ctx.shadowBlur = 0;
    ctx.globalAlpha = vis * 0.22;
    ctx.save();
    ctx.translate(this.boltX, 0);
    ctx.scale(190, 190);
    ctx.fillStyle = FX_radial(ctx, 'boltBloom', 1, [
      [0, 'rgba(230,238,255,0.55)'],
      [0.4, FX_rgba(PAL.skyGlow, 0.22)],
      [1, 'rgba(0,0,0,0)']
    ]);
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, FX_TAU); ctx.fill();
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }
}

// ============================================================================
// ScreenShake -- deterministic multi-frequency decay
// ============================================================================
class ScreenShake {
  constructor() {
    this.clock = 0;
    this.mag = 0;
    this.dur = 0;
    this.left = 0;
    this.phase = 0;
    this._x = 0;
    this._y = 0;
  }

  trigger(magnitude, duration) {
    const m = Math.max(0, magnitude || 0);
    const d = Math.max(0.01, duration || 0.25);
    // stacking: take the stronger impulse, extend a little
    if (m >= this.mag || this.left <= 0) {
      this.mag = m;
      this.dur = d;
      this.left = d;
      this.phase += 1.7;  // deterministic decorrelation between triggers
    } else {
      this.left = Math.max(this.left, d * 0.6);
    }
  }

  update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    this.clock += dt;
    if (this.left <= 0) { this._x = 0; this._y = 0; this.mag = 0; return; }
    this.left -= dt;
    if (this.left <= 0) { this.left = 0; this._x = 0; this._y = 0; this.mag = 0; return; }
    const k = this.left / this.dur;              // 1 -> 0
    const amp = this.mag * k * k;                // quadratic ease-out
    const t = this.clock * 1.0 + this.phase;
    this._x = amp * (
      Math.sin(t * 47.3) * 0.6 +
      Math.sin(t * 23.1 + 1.3) * 0.3 +
      Math.cos(t * 71.7 + 2.1) * 0.18
    );
    this._y = amp * (
      Math.cos(t * 41.9 + 0.7) * 0.55 +
      Math.sin(t * 29.7 + 2.9) * 0.28 +
      Math.sin(t * 83.3) * 0.14
    );
  }

  get x() { return this._x; }
  get y() { return this._y; }
}

// ============================================================================
// drawSpeedLines -- edge motion streaks
// ============================================================================
function drawSpeedLines(ctx, t, strength) {
  const s = FX_clamp(strength || 0, 0, 1);
  if (s <= 0.01) return;
  const time = t || 0;
  ctx.save();
  ctx.lineCap = 'round';

  // soft vignette-ish darkening at both edges to seat the streaks
  const gL = FX_linear(ctx, 'spdL', 0, 0, 170, 0, [
    [0, 'rgba(5,6,15,0.45)'], [1, 'rgba(5,6,15,0)']
  ]);
  ctx.globalAlpha = s * 0.7;
  ctx.fillStyle = gL;
  ctx.fillRect(0, 0, 170, CH);
  ctx.save();
  ctx.translate(CW, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = gL;
  ctx.fillRect(0, 0, 170, CH);
  ctx.restore();

  const count = 12 + Math.round(s * 14);
  for (let i = 0; i < count; i++) {
    const r0 = FX_rnd(i * 3.7 + 1.3);
    const r1 = FX_rnd2(i, 9);
    const r2 = FX_rnd2(i, 21);
    const y = 22 + r0 * (CH - 44);
    const speed = 480 + r1 * 900;
    const travel = ((time * speed + r2 * 900) % 620);
    const len = 55 + r1 * 150 * (0.4 + s);
    const thick = 0.8 + r2 * 2.1;
    const side = (i & 1) === 0 ? -1 : 1;

    // fade in/out as the streak sweeps past the edge zone
    const edgeT = travel / 620;
    const fade = Math.sin(edgeT * Math.PI);
    const a = s * fade * (0.16 + r1 * 0.34);
    if (a <= 0.01) continue;

    let x0, x1;
    if (side < 0) { x0 = -60 + travel * 0.42; x1 = x0 + len; }
    else { x0 = CW + 60 - travel * 0.42; x1 = x0 - len; }

    const grad = ctx.createLinearGradient(x0, y, x1, y);
    const col = (i % 5 === 0) ? PAL.yellow : PAL.moonGlow;
    grad.addColorStop(0, FX_rgba(col, 0));
    grad.addColorStop(0.45, FX_rgba(col, a));
    grad.addColorStop(0.72, FX_rgba(PAL.white, a * 0.9));
    grad.addColorStop(1, FX_rgba(col, 0));

    ctx.globalAlpha = 1;
    ctx.strokeStyle = grad;
    ctx.lineWidth = thick;
    ctx.shadowBlur = 6 * s;
    ctx.shadowColor = FX_rgba(col, a);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y + side * 1.5);
    ctx.stroke();
  }

  // a couple of thick foreground blurs that whip past fast
  ctx.shadowBlur = 0;
  for (let i = 0; i < 3; i++) {
    const y = 60 + FX_rnd(i * 11.1) * (CH - 120);
    const tt = ((time * (1500 + FX_rnd(i + 31) * 900) + i * 400) % 1600) / 1600;
    const a = s * Math.sin(tt * Math.PI) * 0.22;
    if (a <= 0.01) continue;
    const side = i % 2 === 0 ? 1 : -1;
    const w = 120 + FX_rnd(i + 7) * 140;
    const x = side > 0 ? -80 + tt * 300 : CW + 80 - tt * 300;
    ctx.globalAlpha = a;
    ctx.fillStyle = FX_rgba(PAL.moonGlow, 0.5);
    FX_roundRect(ctx, Math.min(x, x + side * w), y, w, 2.4 + FX_rnd(i) * 3, 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}
