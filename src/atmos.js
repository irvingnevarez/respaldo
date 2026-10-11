// ═══════════════════════════════════════════════════════════════════════
//  ATMOSPHERE — breath and street steam.
//
//  Kept out of fx.js deliberately: those particles are impact feedback and
//  need to be punchy and short-lived, while these are slow, large and almost
//  transparent. Mixing the two tuning regimes in one system makes both worse.
//
//  Drawn into the 2D scene, so the deferred lighting pass tints them with
//  whatever light they are drifting through.
// ═══════════════════════════════════════════════════════════════════════

function AT_hash(n) { const s = Math.sin(n * 91.37 + 7.13) * 43758.5453; return s - Math.floor(s); }

class Atmosphere {
  constructor() {
    this.p = [];
    this.breathT = 0;
    this.ventT = 0;
    this.max = 180;
  }
  clear() { this.p.length = 0; this.breathT = 0; this.ventT = 0; }

  emit(x, y, kind, seed) {
    if (this.p.length >= this.max) return;
    const warm = kind === 'steam';
    this.p.push({
      x: x, y: y, kind: kind, seed: seed,
      vx: (AT_hash(seed) - 0.5) * (warm ? 14 : 26),
      vy: warm ? -14 - AT_hash(seed + 3) * 12 : -20 - AT_hash(seed + 3) * 16,
      r: warm ? 9 + AT_hash(seed + 7) * 12 : 2.5 + AT_hash(seed + 7) * 2.5,
      grow: warm ? 16 : 9,
      life: warm ? 2.6 + AT_hash(seed + 11) * 1.6 : 0.85 + AT_hash(seed + 11) * 0.4,
      age: 0,
    });
  }

  update(dt, game) {
    for (const q of this.p) {
      q.age += dt;
      q.vy += (q.kind === 'steam' ? -5 : -8) * dt;   // buoyancy
      q.vx *= 1 - 0.9 * dt;                          // drag
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.r += q.grow * dt;
    }
    this.p = this.p.filter(q => q.age < q.life);
    if (!game.world || !game.player) return;

    // ── breath: only when he is standing still in the cold ──
    const pl = game.player;
    if (!pl.dead && pl.onGround && Math.abs(pl.vx) < 45) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 1.5 + AT_hash(Math.floor(game.time * 3)) * 0.9;
        const n = 3;
        for (let i = 0; i < n; i++) {
          this.emit(pl.rect.cx + pl.face * (pl.rect.w * 0.45 + i * 4),
            pl.rect.y + 12 + i, 'breath', Math.floor(game.time * 60) + i * 13);
        }
      }
    } else this.breathT = Math.min(this.breathT, 0.5);

    // ── street vents: a sparse hashed set of ground columns ──
    this.ventT -= dt;
    if (this.ventT <= 0) {
      this.ventT = 0.55;
      const w = game.world, camX = game.cam ? game.cam.x : 0;
      const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
      const c1 = Math.min(w.w - 1, Math.floor((camX + CW) / TILE) + 1);
      for (let cx = c0; cx <= c1; cx++) {
        if (AT_hash(cx * 3.1 + 0.5) > 0.075) continue;      // ~7% of columns
        // Street level only. Scanning from the top found the first solid cell
        // in the column, which meant vents happily sprouted from the roof of a
        // floating '?' block instead of from the pavement.
        let row = -1;
        for (let cy = 14; cy < w.h; cy++) {
          const c = w.cells[cy * w.w + cx];
          if (c && c.alive && c.solid) { row = cy; break; }
        }
        if (row < 0) continue;
        const above = w.cells[(row - 1) * w.w + cx];
        if (above && above.alive && above.solid) continue;
        this.emit(cx * TILE + TILE / 2 + (AT_hash(cx) - 0.5) * 10,
          row * TILE - 2, 'steam', cx * 7 + Math.floor(game.time * 2));
      }
    }
  }

  draw(ctx, camX) {
    if (!this.p.length) return;
    ctx.save();
    for (const q of this.p) {
      const x = q.x - camX;
      if (x < -60 || x > CW + 60) continue;
      const k = q.age / q.life;
      // fade in fast, out slow, so nothing pops into existence
      const a = Math.min(1, k * 6) * (1 - k) * (q.kind === 'steam' ? 0.16 : 0.30);
      if (a <= 0.004) continue;
      const g = ctx.createRadialGradient(x, q.y, 0, x, q.y, Math.max(1, q.r));
      if (q.kind === 'steam') {
        g.addColorStop(0, 'rgba(206,214,232,' + a + ')');
        g.addColorStop(0.55, 'rgba(150,162,190,' + (a * 0.5) + ')');
        g.addColorStop(1, 'rgba(120,130,160,0)');
      } else {
        g.addColorStop(0, 'rgba(226,238,255,' + a + ')');
        g.addColorStop(0.6, 'rgba(180,200,235,' + (a * 0.45) + ')');
        g.addColorStop(1, 'rgba(160,180,220,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      // squashed slightly: rising vapour spreads wider than it is tall
      ctx.ellipse(x, q.y, q.r, q.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
