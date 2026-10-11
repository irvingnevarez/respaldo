// ═══════════════════════════════════════════════════════════════════════
//  DECOR — street furniture that actually lights the scene.
//
//  Until now every light in the game came from a gameplay object: blocks,
//  pickups, the beacon. The street itself emitted nothing, so Gotham was a
//  painted backdrop rather than a lit place. Lamps and neon signs are placed
//  deterministically from the level geometry, drawn into the world pass, and
//  registered as real lights - so they cast shadows, pool on the wet ground
//  and bloom like everything else.
// ═══════════════════════════════════════════════════════════════════════

function DC_hash(n) { const s = Math.sin(n * 53.77 + 19.31) * 43758.5453; return s - Math.floor(s); }

class Decor {
  constructor() { this.items = []; this.key = null; }

  // Scan once per level rather than every frame: the layout never changes.
  build(world, levelId) {
    if (this.key === levelId) return;
    this.key = levelId;
    this.items = [];
    if (!world) return;
    // Walk the street in strides rather than hashing each column: a pure hash
    // with a clear-air requirement on top produced four lamps in an entire
    // 200-column level, none of them on screen. A stride guarantees the street
    // is actually lit along its whole length.
    let cx = 5;
    while (cx < world.w - 5) {
      for (let k = 0; k < 9; k++) {
        const col = cx + k;
        if (col >= world.w - 4) break;
        let row = -1;
        for (let cy = 13; cy < world.h; cy++) {
          const c = world.cells[cy * world.w + col];
          if (c && c.alive && c.solid) { row = cy; break; }
        }
        if (row < 0) continue;
        let clear = true;
        for (let j = 1; j <= 4; j++) {
          const c = world.cells[(row - j) * world.w + col];
          if (c && c.alive && c.solid) { clear = false; break; }
        }
        if (!clear) continue;
        const neon = DC_hash(col * 7.7 + 4.4) < 0.34;
        this.items.push({
          x: col * TILE + TILE / 2,
          y: row * TILE,
          h: 66 + Math.round(DC_hash(col + 9) * 22),
          neon: neon,
          hue: neon ? DC_hash(col * 3.3) : 0,
          seed: col,
        });
        break;
      }
      cx += 14 + Math.floor(DC_hash(cx * 1.7) * 8);
    }
  }

  // amber sodium lamp, or a cold neon tube
  // Muted. Saturated pink and violet neon was the loudest colour in the frame
  // and fought the near-monochrome grade; these still read as neon against a
  // grey street without repainting it.
  colour(it) {
    if (!it.neon) return [1.0, 0.86, 0.62];        // cool sodium
    if (it.hue < 0.34) return [0.95, 0.48, 0.52];  // dull rose
    if (it.hue < 0.67) return [0.52, 0.82, 0.95];  // ice
    return [0.66, 0.60, 0.88];                     // pale violet
  }

  draw(ctx, camX, t) {
    for (const it of this.items) {
      const x = it.x - camX;
      if (x < -60 || x > CW + 60) continue;
      const c = this.colour(it);
      const rgb = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
      const flick = it.neon
        ? (DC_hash(Math.floor(t * 9) + it.seed) > 0.06 ? 1 : 0.35)   // neon stutters
        : 0.92 + 0.08 * Math.sin(t * 2.6 + it.seed);
      const topY = it.y - it.h;

      ctx.save();
      // post
      const pg = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
      pg.addColorStop(0, '#2a2636');
      pg.addColorStop(0.5, '#4a4560');
      pg.addColorStop(1, '#1a1726');
      ctx.fillStyle = pg;
      ctx.fillRect(x - 2.5, topY, 5, it.h);
      ctx.fillStyle = '#221f30';
      ctx.beginPath();
      ctx.ellipse(x, it.y, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      if (it.neon) {
        // a vertical tube bracketed off the post
        ctx.globalAlpha = flick;
        ctx.strokeStyle = rgb;
        ctx.lineWidth = 3;
        ctx.shadowColor = rgb;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(x + 9, topY + 6);
        ctx.lineTo(x + 9, topY + 30);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + 3, topY + 8);
        ctx.lineTo(x + 9, topY + 8);
        ctx.stroke();
      } else {
        // hooded lamp head
        ctx.fillStyle = '#2e2a3c';
        ctx.beginPath();
        ctx.moveTo(x - 11, topY + 8);
        ctx.lineTo(x + 11, topY + 8);
        ctx.lineTo(x + 7, topY + 1);
        ctx.lineTo(x - 7, topY + 1);
        ctx.closePath(); ctx.fill();
        // the hood's own underside catches the bulb — without it the head is a
        // flat dark wedge with a glow pasted under it
        ctx.globalAlpha = 0.5 * flick;
        ctx.fillStyle = rgb;
        ctx.fillRect(x - 9, topY + 6.5, 18, 1.8);
        ctx.globalAlpha = flick;
        ctx.fillStyle = rgb;
        ctx.shadowColor = rgb;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(x, topY + 10, 7, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // the cone it throws down the wall
        ctx.globalAlpha = 0.13 * flick;
        const cg = ctx.createLinearGradient(0, topY + 10, 0, it.y);
        cg.addColorStop(0, rgb);
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(x - 7, topY + 10);
        ctx.lineTo(x + 7, topY + 10);
        ctx.lineTo(x + 30, it.y);
        ctx.lineTo(x - 30, it.y);
        ctx.closePath(); ctx.fill();

        // Rain lit inside the cone. This is the cheapest realism cue in the
        // whole scene: you do not see rain falling at night, you see the slice
        // of it that passes through a streetlight. Clipped to the cone the
        // lamp already throws, so the two can never disagree, and seeded off
        // the lamp's own column so it stays deterministic.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x - 7, topY + 10);
        ctx.lineTo(x + 7, topY + 10);
        ctx.lineTo(x + 30, it.y);
        ctx.lineTo(x - 30, it.y);
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = rgb;
        ctx.lineWidth = 1;
        const span = it.y - topY - 10;
        for (let k = 0; k < 14; k++) {
          const ph = DC_hash(it.seed * 3.1 + k * 7.7);
          const sp = 440 + ph * 420;
          let ry = ((ph * span) + t * sp) % span;
          const ry0 = topY + 10 + ry;
          const rx = x - 34 + DC_hash(it.seed + k * 2.3) * 68;
          // brightest in the middle of the beam, gone at its edges
          ctx.globalAlpha = 0.30 * flick * (1 - Math.abs(rx - x) / 40) * (1 - ry / span * 0.5);
          if (ctx.globalAlpha <= 0.01) continue;
          ctx.beginPath();
          ctx.moveTo(rx, ry0);
          ctx.lineTo(rx - 4, ry0 + 15);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }

  // Fed into the deferred lighting pass alongside the gameplay lights.
  addLights(push, camX, t) {
    for (const it of this.items) {
      const sx = it.x - camX;
      if (sx < -140 || sx > CW + 140) continue;
      const c = this.colour(it);
      const flick = it.neon
        ? (DC_hash(Math.floor(t * 9) + it.seed) > 0.06 ? 1 : 0.3)
        : 0.92 + 0.08 * Math.sin(t * 2.6 + it.seed);
      const bulbY = it.y - it.h + (it.neon ? 18 : 10);
      push(it.x, bulbY, it.neon ? 150 : 210, c[0], c[1], c[2],
        (it.neon ? 0.48 : 0.82) * flick, 0.09);
    }
  }
}
