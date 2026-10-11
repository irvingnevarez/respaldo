// ═══════════════════════════════════════════════════════════════════════
//  FOREGROUND — out-of-focus clutter between the camera and the playfield.
//
//  A side-on game with nothing in front of the action always reads flat, no
//  matter how good the lighting behind it is: the eye gets depth from
//  OCCLUSION and from parallax, and a scene with exactly one plane offers
//  neither. Contemporary 2D games all solve it the same way — near-black
//  shapes drifting across the lens faster than the world, slightly defocused,
//  that the player's eye reads as "I am standing behind something".
//
//  Everything here is a silhouette: no detail, no colour, soft edges. It is
//  drawn after the world and before the HUD, at roughly 1.4x the camera speed,
//  and it deliberately never covers the middle band where the player lives.
//
//  The blur is faked. A real defocus would mean another full-screen canvas and
//  another upload per frame, which measured as a genuine cost; a silhouette
//  built from soft radial and linear gradients is indistinguishable at this
//  value range, because a near-black shape against a dark city has almost no
//  edge contrast to give the trick away.
// ═══════════════════════════════════════════════════════════════════════

function FG_hash(n) { const s = Math.sin(n * 41.17 + 3.77) * 43758.5453; return s - Math.floor(s); }

class Foreground {
  constructor() { this.items = []; this.key = null; }

  // Placed once per level from the level geometry, never per frame.
  build(world, levelId) {
    if (this.key === levelId) return;
    this.key = levelId;
    this.items = [];
    if (!world) return;

    const W = world.w;
    let cx = 6;
    while (cx < W - 4) {
      const h = FG_hash(cx * 2.3);
      let kind;
      if (h < 0.34) kind = 'pipe';
      else if (h < 0.60) kind = 'rail';
      else if (h < 0.82) kind = 'cable';
      else kind = 'post';
      this.items.push({
        x: cx * TILE,
        kind: kind,
        seed: cx,
        // vertical placement: pipes and cables hang from the top of frame,
        // rails and posts rise from the bottom
        span: 0.5 + FG_hash(cx * 5.1) * 0.9,
      });
      cx += 19 + Math.floor(FG_hash(cx * 1.9) * 17);
    }
  }

  // camX is the world camera; the foreground runs faster so it slides past.
  draw(ctx, camX, t) {
    if (!this.items.length) return;
    const PAR = 1.42;
    ctx.save();
    for (const it of this.items) {
      const x = it.x - camX * PAR;
      if (x < -300 || x > CW + 300) continue;
      const a = 0.62;
      switch (it.kind) {
        case 'pipe': this.pipe(ctx, x, it, a, t); break;
        case 'rail': this.rail(ctx, x, it, a); break;
        case 'cable': this.cable(ctx, x, it, a, t); break;
        default: this.post(ctx, x, it, a); break;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // A soft-edged vertical bar: the gradient across its width IS the defocus.
  soft(ctx, x, y, w, h, a) {
    // The falloff has to be WIDE. A short ramp still reads as an edge, and an
    // edge reads as a black bar laid over the picture rather than as something
    // close to the lens. Two thirds of the width is transition.
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0.00, 'rgba(2,4,7,0)');
    g.addColorStop(0.22, 'rgba(2,4,7,' + (a * 0.18).toFixed(3) + ')');
    g.addColorStop(0.40, 'rgba(2,4,7,' + (a * 0.70).toFixed(3) + ')');
    g.addColorStop(0.60, 'rgba(2,4,7,' + (a * 0.70).toFixed(3) + ')');
    g.addColorStop(0.78, 'rgba(2,4,7,' + (a * 0.18).toFixed(3) + ')');
    g.addColorStop(1.00, 'rgba(2,4,7,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w, y, w * 2, h);
  }

  // a fat drainpipe running the full height, with a joint collar
  pipe(ctx, x, it, a, t) {
    const w = 17 + FG_hash(it.seed) * 13;
    this.soft(ctx, x, -20, w, CH + 40, a);
    const cy = CH * (0.18 + FG_hash(it.seed + 3) * 0.5);
    this.soft(ctx, x, cy, w * 1.5, 16, a * 0.95);
    const cy2 = cy + 120 + FG_hash(it.seed + 9) * 160;
    if (cy2 < CH) this.soft(ctx, x, cy2, w * 1.4, 13, a * 0.9);
  }

  // a railing crossing the lower third: one top rail and a few uprights
  rail(ctx, x, it, a) {
    const y = CH * (0.62 + FG_hash(it.seed + 1) * 0.2);
    const wide = 180 + FG_hash(it.seed + 4) * 220;
    const g = ctx.createLinearGradient(0, y - 15, 0, y + 15);
    g.addColorStop(0.0, 'rgba(2,4,7,0)');
    g.addColorStop(0.32, 'rgba(2,4,7,' + (a * 0.38).toFixed(3) + ')');
    g.addColorStop(0.5, 'rgba(2,4,7,' + (a * 0.80).toFixed(3) + ')');
    g.addColorStop(0.68, 'rgba(2,4,7,' + (a * 0.38).toFixed(3) + ')');
    g.addColorStop(1.0, 'rgba(2,4,7,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - wide * 0.5, y - 15, wide, 30);
    const n = 2 + Math.floor(FG_hash(it.seed + 7) * 3);
    for (let i = 0; i <= n; i++) {
      const px = x - wide * 0.5 + (wide * i) / n;
      this.soft(ctx, px, y, 9, CH - y + 20, a * 0.8);
    }
  }

  // a slack catenary sagging across the top of frame, swaying very slightly
  cable(ctx, x, it, a, t) {
    const y0 = CH * (0.05 + FG_hash(it.seed + 2) * 0.22);
    const wide = 300 + FG_hash(it.seed + 6) * 320;
    const sag = 60 + FG_hash(it.seed + 8) * 110 + Math.sin(t * 0.5 + it.seed) * 5;
    ctx.save();
    ctx.strokeStyle = 'rgba(2,4,7,' + (a * 0.80).toFixed(3) + ')';
    ctx.lineCap = 'round';
    // three passes of decreasing width fake the soft edge of a defocused wire
    for (const [lw, al] of [[11, 0.22], [7, 0.45], [3.6, 0.85]]) {
      ctx.globalAlpha = al;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x - wide * 0.5, y0);
      ctx.quadraticCurveTo(x, y0 + sag * 2, x + wide * 0.5, y0 + FG_hash(it.seed + 11) * 30);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // a lamp post or sign pole crossing the whole frame
  post(ctx, x, it, a) {
    const w = 11 + FG_hash(it.seed + 5) * 9;
    this.soft(ctx, x, -20, w, CH + 40, a * 0.92);
    const ay = CH * (0.12 + FG_hash(it.seed + 13) * 0.22);
    const arm = 60 + FG_hash(it.seed + 17) * 90;
    const dir = FG_hash(it.seed + 19) > 0.5 ? 1 : -1;
    const g = ctx.createLinearGradient(0, ay - 8, 0, ay + 8);
    g.addColorStop(0, 'rgba(2,4,7,0)');
    g.addColorStop(0.5, 'rgba(2,4,7,' + (a * 0.86).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(2,4,7,0)');
    ctx.fillStyle = g;
    ctx.fillRect(dir > 0 ? x : x - arm, ay - 8, arm, 16);
  }
}
