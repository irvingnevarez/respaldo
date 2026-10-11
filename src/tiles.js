// ============================================================================
// TL_ -- level tiles, blocks and pickups. Canvas2D only, no assets.
// Light direction: upper-left. Top/left faces lit, bottom/right faces shaded.
// ============================================================================

function TL_rnd(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function TL_rnd2(n, k) { const s = Math.sin(n * 269.5 + k * 183.3 + 78.233) * 43758.5453; return s - Math.floor(s); }

const TL_gcache = Object.create(null);
// key -> gradient factory result. Gradients are created at origin (0,0) and the
// caller translates, so they can be reused across every tile of the same size.
function TL_grad(ctx, key, x0, y0, x1, y1, stops) {
  let g = TL_gcache[key];
  if (g) return g;
  g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  TL_gcache[key] = g;
  return g;
}
function TL_rgrad(ctx, key, x0, y0, r0, x1, y1, r1, stops) {
  let g = TL_gcache[key];
  if (g) return g;
  g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  TL_gcache[key] = g;
  return g;
}

function TL_roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function TL_clearFx(ctx) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1; }

// --- the canonical bat emblem, drawn into a box of width w centred on (cx,cy) ---
function TL_batPath(ctx, cx, cy, w) {
  const u = w / 100, X = (a) => cx + a * u, Y = (b) => cy + b * u;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-16));
  ctx.bezierCurveTo(X(6), Y(-26), X(14), Y(-30), X(20), Y(-24));
  ctx.bezierCurveTo(X(22), Y(-14), X(30), Y(-14), X(38), Y(-20));
  ctx.bezierCurveTo(X(46), Y(-26), X(52), Y(-22), X(50), Y(-8));
  ctx.bezierCurveTo(X(49), Y(0), X(46), Y(6), X(40), Y(10));
  ctx.bezierCurveTo(X(34), Y(6), X(30), Y(10), X(31), Y(18));
  ctx.bezierCurveTo(X(24), Y(12), X(16), Y(12), X(11), Y(18));
  ctx.bezierCurveTo(X(8), Y(24), X(4), Y(28), X(0), Y(30));
  ctx.bezierCurveTo(X(-4), Y(28), X(-8), Y(24), X(-11), Y(18));
  ctx.bezierCurveTo(X(-16), Y(12), X(-24), Y(12), X(-31), Y(18));
  ctx.bezierCurveTo(X(-30), Y(10), X(-34), Y(6), X(-40), Y(10));
  ctx.bezierCurveTo(X(-46), Y(6), X(-49), Y(0), X(-50), Y(-8));
  ctx.bezierCurveTo(X(-52), Y(-22), X(-46), Y(-26), X(-38), Y(-20));
  ctx.bezierCurveTo(X(-30), Y(-14), X(-22), Y(-14), X(-20), Y(-24));
  ctx.bezierCurveTo(X(-14), Y(-30), X(-6), Y(-26), X(0), Y(-16));
  ctx.closePath();
}

// ============================================================================
// GROUND
// ============================================================================
function drawGroundTile(ctx, x, y, s, o) {
  const top = !!(o && o.top), idx = (o && o.idx) | 0;
  ctx.save();
  ctx.translate(x, y);

  // base body gradient (lit at top-left, deep at bottom-right)
  ctx.fillStyle = TL_grad(ctx, 'gnd' + s, 0, 0, s * 0.7, s, [
    [0, PAL.stoneL], [0.35, PAL.stone], [1, PAL.stoneD]
  ]);
  ctx.fillRect(0, 0, s, s);

  // mortar wash so cobbles read as inset
  ctx.fillStyle = PAL.mortar;
  ctx.globalAlpha = 0.55; ctx.fillRect(0, 0, s, s); ctx.globalAlpha = 1;

  // irregular cobble courses -- 3 rows, offset per row by hash
  const rows = 3, rh = s / rows;
  // one clip for every cobble + the grain pass (cheaper than clipping per stone)
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();
  ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    const off = TL_rnd2(idx, r) * s;
    const cols = 2 + ((TL_rnd2(idx + 7, r) * 2) | 0);
    const cw = s / cols;
    for (let c = -1; c <= cols; c++) {
      const h = TL_rnd2(idx * 3 + c, r * 5);
      let bx = c * cw + (off % cw) - cw;
      let by = r * rh;
      let bw = cw - 1.5 - h * 1.2, bh = rh - 1.6;
      if (bx + bw < 0 || bx > s) continue;
      const lum = 0.75 + h * 0.5 - (r * 0.08) - (by / s) * 0.25;
      const rr = Math.max(10, Math.min(70, 58 * lum));
      const gg = Math.max(8, Math.min(66, 52 * lum));
      const bb = Math.max(16, Math.min(96, 84 * lum));
      TL_roundRect(ctx, bx, by, bw, bh, 2.2);
      ctx.fillStyle = 'rgb(' + (rr | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';
      ctx.fill();
      // per-stone bevel: light top-left edge
      ctx.strokeStyle = 'rgba(140,150,190,' + (0.10 + h * 0.18).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(bx + 1, by + bh - 1.5); ctx.lineTo(bx + 1, by + 1.5); ctx.lineTo(bx + bw - 1.5, by + 1);
      ctx.stroke();
      // dark bottom-right
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.moveTo(bx + bw - 1, by + 1.5); ctx.lineTo(bx + bw - 1, by + bh - 1); ctx.lineTo(bx + 1.5, by + bh - 1);
      ctx.stroke();
    }
  }

  // speckled grain (same clip)
  for (let i = 0; i < 22; i++) {
    const px = TL_rnd2(idx * 11 + i, 1) * s;
    const py = TL_rnd2(idx * 11 + i, 2) * s;
    const a = TL_rnd2(idx * 11 + i, 3);
    ctx.fillStyle = a > 0.5 ? 'rgba(190,200,235,0.13)' : 'rgba(0,0,0,0.30)';
    ctx.fillRect(px, py, 1 + (a > 0.85 ? 1 : 0), 1);
  }
  ctx.restore();

  // vertical ambient occlusion toward the bottom
  ctx.fillStyle = TL_grad(ctx, 'gndao' + s, 0, s * 0.45, 0, s, [
    [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.42)']
  ]);
  ctx.fillRect(0, 0, s, s);

  if (top) {
    // damp sheen: wet reflective band along the exposed surface
    // Rain-slicked stone. The sheen and the lip are deliberately strong: a
    // bright wet edge along every walkable surface is what makes the playfield
    // read as solid geometry in front of the city, rather than one more dark
    // shape among the buildings.
    ctx.fillStyle = TL_grad(ctx, 'gndwet' + s, 0, 0, 0, s * 0.5, [
      [0, 'rgba(176,198,232,0.44)'], [0.35, 'rgba(126,148,182,0.16)'], [1, 'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0, 0, s, s * 0.5);
    // bright top lip
    ctx.fillStyle = 'rgba(226,238,255,0.82)';
    ctx.fillRect(0, 0, s, 1.6);
    ctx.fillStyle = 'rgba(158,178,208,0.44)';
    ctx.fillRect(0, 1.6, s, 1.2);
    // dark inner shadow just under the lip
    ctx.fillStyle = TL_grad(ctx, 'gndlip' + s, 0, 2.5, 0, 9, [
      [0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0, 2.5, s, 7);
    // a couple of moss/dew glints keyed to idx
    for (let i = 0; i < 3; i++) {
      const gx = TL_rnd2(idx + i * 31, 9) * s;
      ctx.globalAlpha = 0.35 + TL_rnd2(idx + i, 4) * 0.3;
      ctx.fillStyle = PAL.rain;
      ctx.fillRect(gx, 2 + TL_rnd2(idx + i, 5) * 3, 1, 1);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, s, 2);
  }

  // tile seam (right/bottom) for course separation
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(s - 1, 0, 1, s);
  ctx.fillRect(0, s - 1, s, 1);

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// STONE BLOCK
// ============================================================================
function drawStoneBlock(ctx, x, y, s, idx) {
  idx = idx | 0;
  ctx.save();
  ctx.translate(x, y);

  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(2.5, 3, s, s);

  // body
  ctx.fillStyle = TL_grad(ctx, 'stb' + s, 0, 0, s, s, [
    [0, '#5a5379'], [0.45, PAL.stone], [1, '#221d36']
  ]);
  ctx.fillRect(0, 0, s, s);

  // grain speckle
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();
  for (let i = 0; i < 16; i++) {
    const px = TL_rnd2(idx * 5 + i, 11) * s, py = TL_rnd2(idx * 5 + i, 12) * s;
    ctx.fillStyle = TL_rnd2(i, idx) > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.25)';
    ctx.fillRect(px, py, 1.5, 1.5);
  }
  ctx.restore();

  const bev = Math.max(2.5, s * 0.11);
  // lit top face
  ctx.fillStyle = 'rgba(150,160,205,0.40)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - bev, bev); ctx.lineTo(bev, bev); ctx.closePath(); ctx.fill();
  // lit left face
  ctx.fillStyle = 'rgba(120,132,180,0.28)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(bev, bev); ctx.lineTo(bev, s - bev); ctx.lineTo(0, s); ctx.closePath(); ctx.fill();
  // shaded right face
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.moveTo(s, 0); ctx.lineTo(s, s); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s - bev, bev); ctx.closePath(); ctx.fill();
  // shaded bottom face
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(0, s); ctx.lineTo(bev, s - bev); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s, s); ctx.closePath(); ctx.fill();

  // chiselled cross groove on the inner face
  const c = s / 2;
  ctx.lineWidth = Math.max(1.5, s * 0.055);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(bev + 2, c); ctx.lineTo(s - bev - 2, c);
  ctx.moveTo(c, bev + 2); ctx.lineTo(c, s - bev - 2);
  ctx.stroke();
  // groove highlight on the lower-right wall of the cut
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(160,170,215,0.30)';
  ctx.beginPath();
  ctx.moveTo(bev + 2, c + ctx.lineWidth + 1.2); ctx.lineTo(s - bev - 2, c + ctx.lineWidth + 1.2);
  ctx.moveTo(c + ctx.lineWidth + 1.2, bev + 2); ctx.lineTo(c + ctx.lineWidth + 1.2, s - bev - 2);
  ctx.stroke();

  // corner rivets
  const rr = Math.max(1.4, s * 0.055), inset = bev + rr + 0.5;
  for (let i = 0; i < 4; i++) {
    const rx = (i & 1) ? s - inset : inset;
    const ry = (i & 2) ? s - inset : inset;
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1830'; ctx.fill();
    ctx.beginPath(); ctx.arc(rx - rr * 0.28, ry - rr * 0.3, rr * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(170,180,220,0.55)'; ctx.fill();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BRICK BLOCK
// ============================================================================
function drawBrickBlock(ctx, x, y, s, idx) {
  idx = idx | 0;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(2.5, 3, s, s);

  // mortar bed
  ctx.fillStyle = TL_grad(ctx, 'brkm' + s, 0, 0, 0, s, [[0, '#2a1c2c'], [1, '#150e1a']]);
  ctx.fillRect(0, 0, s, s);

  const rows = 4, rh = s / rows;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();
  for (let r = 0; r < rows; r++) {
    const stagger = (r % 2) ? -s * 0.25 : 0;
    for (let c = -1; c < 3; c++) {
      const bx = c * (s / 2) + stagger + 0.8;
      const by = r * rh + 0.8;
      const bw = s / 2 - 1.6, bh = rh - 1.6;
      if (bx > s || bx + bw < 0) continue;
      const h = TL_rnd2(idx * 13 + c, r);
      const lum = 0.8 + h * 0.45 - r * 0.06;
      const cr = Math.min(150, 108 * lum) | 0;
      const cg = Math.min(70, 40 * lum) | 0;
      const cb = Math.min(110, 66 * lum) | 0;
      // crumbling: nibble a corner off some bricks
      ctx.beginPath();
      const nib = h > 0.72 ? bh * 0.35 : 0;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + bw - nib, by);
      if (nib) ctx.lineTo(bx + bw, by + nib); else ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + (h > 0.45 ? bh * 0.2 : 0), by + bh);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      ctx.fill();
      // top lit edge
      ctx.fillStyle = 'rgba(255,190,175,0.16)';
      ctx.fillRect(bx, by, bw - nib, 1.2);
      ctx.fillStyle = 'rgba(255,190,175,0.10)';
      ctx.fillRect(bx, by, 1.2, bh);
      // bottom/right shade
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx, by + bh - 1.4, bw, 1.4);
      ctx.fillRect(bx + bw - 1.4, by + nib, 1.4, bh - nib);
      // pitting
      for (let p = 0; p < 3; p++) {
        const px = bx + TL_rnd2(idx + c * 3 + p, r * 7) * bw;
        const py = by + TL_rnd2(idx + c * 5 + p, r * 3) * bh;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(px, py, 1.2, 1.2);
      }
    }
  }

  // hairline cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = 1;
  const ncr = 1 + (TL_rnd(idx) > 0.55 ? 1 : 0);
  for (let k = 0; k < ncr; k++) {
    let cx0 = TL_rnd2(idx, k * 3) * s, cy0 = 0;
    ctx.beginPath(); ctx.moveTo(cx0, cy0);
    for (let seg = 1; seg <= 5; seg++) {
      cx0 += (TL_rnd2(idx * 2 + seg, k) - 0.5) * s * 0.35;
      cy0 += s / 5;
      ctx.lineTo(cx0, cy0);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,170,190,0.12)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
  }
  ctx.restore();

  // overall AO + rim
  ctx.fillStyle = TL_grad(ctx, 'brkao' + s, 0, 0, s, s, [
    [0, 'rgba(255,220,200,0.10)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']
  ]);
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BAT SIGNAL BLOCK (question block)
// ============================================================================
function drawBatSignalBlock(ctx, x, y, s, used, t) {
  ctx.save();
  ctx.translate(x, y);
  const c = s / 2, bev = Math.max(2.5, s * 0.12);

  if (!used) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.6);
    // outward glow
    ctx.globalAlpha = 0.30 + pulse * 0.30;
    ctx.fillStyle = TL_rgrad(ctx, 'bsglow' + s, c, c, s * 0.34, c, c, s * 1.15, [
      [0, 'rgba(245,197,24,0.85)'], [0.5, 'rgba(220,150,20,0.25)'], [1, 'rgba(245,197,24,0)']
    ]);
    ctx.fillRect(-s * 0.7, -s * 0.7, s * 2.4, s * 2.4);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(2.5, 3, s, s);

  if (used) {
    ctx.fillStyle = TL_grad(ctx, 'bsu' + s, 0, 0, s, s, [
      [0, '#4a4363'], [0.5, '#332d4c'], [1, '#1c172e']
    ]);
    ctx.fillRect(0, 0, s, s);
  } else {
    ctx.fillStyle = TL_grad(ctx, 'bsb' + s, 0, 0, s * 0.6, s, [
      [0, '#ffe89a'], [0.28, PAL.yellow], [0.72, PAL.yellowD], [1, '#6d5205']
    ]);
    ctx.fillRect(0, 0, s, s);
  }

  // bevels
  ctx.fillStyle = used ? 'rgba(150,158,200,0.22)' : 'rgba(255,248,210,0.60)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - bev, bev); ctx.lineTo(bev, bev); ctx.closePath(); ctx.fill();
  ctx.fillStyle = used ? 'rgba(150,158,200,0.13)' : 'rgba(255,240,180,0.36)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bev, bev); ctx.lineTo(bev, s - bev); ctx.lineTo(0, s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s, s); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s - bev, bev); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(bev, s - bev); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s, s); ctx.closePath(); ctx.fill();

  // inset dark medallion
  const mr = s * 0.30;
  ctx.beginPath(); ctx.arc(c, c, mr, 0, Math.PI * 2);
  ctx.fillStyle = used
    ? TL_grad(ctx, 'bsmu' + s, 0, c - mr, 0, c + mr, [[0, '#24203a'], [1, '#3a3352']])
    : TL_grad(ctx, 'bsm' + s, 0, c - mr, 0, c + mr, [[0, '#1a1406'], [1, '#3d2e08']]);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = used ? 'rgba(120,128,168,0.35)' : 'rgba(255,236,160,0.55)';
  ctx.beginPath(); ctx.arc(c, c, mr, Math.PI * 0.85, Math.PI * 1.95); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(c, c, mr, Math.PI * 1.95, Math.PI * 0.85); ctx.stroke();

  // emblem
  if (used) {
    ctx.globalAlpha = 0.5;
    TL_batPath(ctx, c, c + s * 0.01, s * 0.44);
    ctx.fillStyle = '#2b2542'; ctx.fill();
    ctx.globalAlpha = 0.35;
    TL_batPath(ctx, c, c + s * 0.01 - 0.8, s * 0.44);
    ctx.strokeStyle = 'rgba(150,158,200,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    ctx.shadowColor = 'rgba(255,215,90,0.9)'; ctx.shadowBlur = s * 0.22;
    TL_batPath(ctx, c, c + s * 0.01, s * 0.46);
    ctx.fillStyle = TL_grad(ctx, 'bsem' + s, 0, c - s * 0.2, 0, c + s * 0.2, [
      [0, '#fff2b8'], [0.55, PAL.yellow], [1, '#b8860a']
    ]);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,230,0.55)'; ctx.lineWidth = 0.7; ctx.stroke();

    // sweeping specular glint across the whole block face
    const sw = ((t * 0.55) % 1.6) - 0.3; // 0..1.3 with pause
    if (sw > -0.05 && sw < 1.1) {
      ctx.save();
      ctx.beginPath(); ctx.rect(bev * 0.5, bev * 0.5, s - bev, s - bev); ctx.clip();
      const gx = sw * s * 1.6 - s * 0.3;
      ctx.translate(gx, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = TL_grad(ctx, 'bsgl' + s, -s * 0.22, 0, s * 0.22, 0, [
        [0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']
      ]);
      ctx.beginPath();
      ctx.moveTo(-s * 0.25, -s * 0.2); ctx.lineTo(s * 0.05, -s * 0.2);
      ctx.lineTo(s * 0.25, s * 1.2); ctx.lineTo(-s * 0.05, s * 1.2);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // corner studs
    ctx.fillStyle = 'rgba(90,66,8,0.9)';
    const si = bev + 2;
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? s - si : si, sy = (i & 2) ? s - si : si;
      ctx.beginPath(); ctx.arc(sx, sy, s * 0.035, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// GARGOYLE (the "pipe")
// ============================================================================
function drawGargoyle(ctx, x, y, w, h, t) {
  ctx.save();
  ctx.translate(x, y);

  const colTop = Math.min(h * 0.42, h - 8);
  const ch = h - colTop;

  // ---- column ----
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(w * 0.10 + 4, colTop + 5, w * 0.80, ch);

  ctx.fillStyle = TL_grad(ctx, 'ggcol' + Math.round(w), w * 0.08, 0, w * 0.95, 0, [
    [0, '#453e60'], [0.22, PAL.stoneL], [0.55, PAL.stone], [1, '#1a1530']
  ]);
  ctx.fillRect(w * 0.10, colTop, w * 0.80, ch);

  // fluting
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const fx = w * 0.10 + (w * 0.80) * (i / 4);
    ctx.beginPath(); ctx.moveTo(fx, colTop + 6); ctx.lineTo(fx, h); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,160,205,0.16)';
    ctx.beginPath(); ctx.moveTo(fx + 1.2, colTop + 6); ctx.lineTo(fx + 1.2, h); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  }
  // weathering streaks
  ctx.save();
  ctx.beginPath(); ctx.rect(w * 0.10, colTop, w * 0.80, ch); ctx.clip();
  for (let i = 0; i < 9; i++) {
    const sx = w * 0.12 + TL_rnd(i * 3 + 1) * w * 0.76;
    const sl = ch * (0.25 + TL_rnd(i * 5) * 0.7);
    ctx.globalAlpha = 0.10 + TL_rnd(i * 7) * 0.16;
    ctx.fillStyle = TL_grad(ctx, 'ggstr' + Math.round(colTop), 0, colTop, 0, colTop + ch, [
      [0, 'rgba(20,16,34,0.9)'], [1, 'rgba(20,16,34,0)']
    ]);
    ctx.fillRect(sx, colTop + 4, 1 + TL_rnd(i) * 2.5, sl);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ledge / capital
  const lw = w * 1.0, lx = (w - lw) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(lx + 3, colTop + 4, lw, 10);
  ctx.fillStyle = TL_grad(ctx, 'ggledge' + Math.round(w), 0, colTop - 6, 0, colTop + 12, [
    [0, '#5e567d'], [0.4, PAL.stone], [1, '#201a36']
  ]);
  ctx.fillRect(lx, colTop - 6, lw, 14);
  ctx.fillStyle = 'rgba(200,210,250,0.35)';
  ctx.fillRect(lx, colTop - 6, lw, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(lx, colTop + 6.5, lw, 1.5);

  // ---- body (hunched) ----
  const bx = w / 2, by = colTop - 6;
  const bodyH = colTop - 6;
  const bodyW = w * 0.62;
  const gk = Math.round(bodyW) + '_' + Math.round(bodyH);

  ctx.save();
  ctx.translate(bx, by);

  // wings behind, folded
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    ctx.save();
    ctx.scale(sgn, 1);
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.12, -bodyH * 0.72);
    ctx.bezierCurveTo(bodyW * 0.85, -bodyH * 0.95, bodyW * 1.05, -bodyH * 0.45, bodyW * 0.72, -bodyH * 0.05);
    ctx.bezierCurveTo(bodyW * 0.62, -bodyH * 0.18, bodyW * 0.52, -bodyH * 0.10, bodyW * 0.46, -bodyH * 0.22);
    ctx.bezierCurveTo(bodyW * 0.40, -bodyH * 0.12, bodyW * 0.30, -bodyH * 0.14, bodyW * 0.24, -bodyH * 0.30);
    ctx.bezierCurveTo(bodyW * 0.18, -bodyH * 0.42, bodyW * 0.14, -bodyH * 0.58, bodyW * 0.12, -bodyH * 0.72);
    ctx.closePath();
    ctx.fillStyle = sgn < 0
      ? TL_grad(ctx, 'ggwl'+gk, 0, -bodyH, 0, 0, [[0, '#4a4368'], [1, '#191430']])
      : TL_grad(ctx, 'ggwr'+gk, 0, -bodyH, 0, 0, [[0, '#332d4c'], [1, '#120e24']]);
    ctx.fill();
    // wing ribs
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(bodyW * 0.14, -bodyH * (0.66 - k * 0.04));
      ctx.quadraticCurveTo(bodyW * 0.5, -bodyH * (0.5 - k * 0.14), bodyW * (0.30 + k * 0.16), -bodyH * (0.20 - k * 0.05));
      ctx.stroke();
    }
    // rim light only on left wing
    if (sgn < 0) {
      ctx.strokeStyle = 'rgba(175,190,240,0.40)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bodyW * 0.12, -bodyH * 0.72);
      ctx.bezierCurveTo(bodyW * 0.85, -bodyH * 0.95, bodyW * 1.05, -bodyH * 0.45, bodyW * 0.72, -bodyH * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  // torso
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.34, 0);
  ctx.bezierCurveTo(-bodyW * 0.42, -bodyH * 0.34, -bodyW * 0.36, -bodyH * 0.58, -bodyW * 0.18, -bodyH * 0.66);
  ctx.lineTo(bodyW * 0.18, -bodyH * 0.66);
  ctx.bezierCurveTo(bodyW * 0.36, -bodyH * 0.58, bodyW * 0.42, -bodyH * 0.34, bodyW * 0.34, 0);
  ctx.closePath();
  ctx.fillStyle = TL_grad(ctx, 'ggtor'+gk, -bodyW * 0.4, -bodyH * 0.6, bodyW * 0.4, 0, [
    [0, '#5b5379'], [0.45, PAL.stone], [1, '#1e1936']
  ]);
  ctx.fill();
  // chest shading + rim
  ctx.strokeStyle = 'rgba(190,202,248,0.30)'; ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.34, 0);
  ctx.bezierCurveTo(-bodyW * 0.42, -bodyH * 0.34, -bodyW * 0.36, -bodyH * 0.58, -bodyW * 0.18, -bodyH * 0.66);
  ctx.stroke();

  // head
  const hy = -bodyH * 0.76, hr = bodyW * 0.27;
  ctx.beginPath();
  ctx.ellipse(0, hy, hr, hr * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = TL_grad(ctx, 'gghead'+gk, -hr, hy - hr, hr, hy + hr, [
    [0, '#6a6289'], [0.5, PAL.stone], [1, '#1c1733']
  ]);
  ctx.fill();
  // snout
  ctx.beginPath();
  ctx.moveTo(-hr * 0.5, hy + hr * 0.18);
  ctx.quadraticCurveTo(0, hy + hr * 1.15, hr * 0.5, hy + hr * 0.18);
  ctx.closePath();
  ctx.fillStyle = '#2a2442'; ctx.fill();
  // fangs
  ctx.fillStyle = 'rgba(225,230,250,0.75)';
  ctx.beginPath(); ctx.moveTo(-hr * 0.22, hy + hr * 0.62); ctx.lineTo(-hr * 0.08, hy + hr * 0.60); ctx.lineTo(-hr * 0.16, hy + hr * 0.92); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hr * 0.22, hy + hr * 0.62); ctx.lineTo(hr * 0.08, hy + hr * 0.60); ctx.lineTo(hr * 0.16, hy + hr * 0.92); ctx.closePath(); ctx.fill();
  // horns
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    ctx.beginPath();
    ctx.moveTo(sgn * hr * 0.55, hy - hr * 0.45);
    ctx.quadraticCurveTo(sgn * hr * 1.25, hy - hr * 1.15, sgn * hr * 1.5, hy - hr * 2.0);
    ctx.quadraticCurveTo(sgn * hr * 0.95, hy - hr * 1.10, sgn * hr * 0.28, hy - hr * 0.78);
    ctx.closePath();
    ctx.fillStyle = sgn < 0 ? '#514a70' : '#2c2645';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  // ember eyes -- flicker deterministically on t
  const flick = 0.62 + 0.38 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1.3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const ex = sgn * hr * 0.40, ey = hy - hr * 0.05;
    ctx.globalAlpha = 0.30 + flick * 0.45;
    ctx.fillStyle = TL_rgrad(ctx, 'ggeye', 0, 0, 0, 0, 0, 10, [
      [0, 'rgba(255,150,40,1)'], [0.4, 'rgba(230,70,20,0.5)'], [1, 'rgba(180,40,10,0)']
    ]);
    ctx.save(); ctx.translate(ex, ey); ctx.scale(hr * 0.42, hr * 0.42);
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.7 + flick * 0.3;
    ctx.fillStyle = '#ffd0a0';
    ctx.beginPath(); ctx.ellipse(ex, ey, hr * 0.15, hr * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // clawed feet gripping the ledge
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    ctx.save(); ctx.scale(sgn, 1);
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.10, -bodyH * 0.12);
    ctx.quadraticCurveTo(bodyW * 0.46, -bodyH * 0.10, bodyW * 0.50, bodyH * 0.02);
    ctx.quadraticCurveTo(bodyW * 0.30, bodyH * 0.06, bodyW * 0.10, bodyH * 0.02);
    ctx.closePath();
    ctx.fillStyle = sgn < 0 ? '#4d466b' : '#2b2543';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const cxk = bodyW * (0.18 + k * 0.13);
      ctx.beginPath();
      ctx.moveTo(cxk, bodyH * 0.01);
      ctx.quadraticCurveTo(cxk + bodyW * 0.05, bodyH * 0.10, cxk - bodyW * 0.01, bodyH * 0.13);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // body transform

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BEACON (level goal)
// ============================================================================
function drawBeacon(ctx, x, y, s, t, reached) {
  ctx.save();
  ctx.translate(x, y);
  const baseH = s * 0.55, baseW = s * 1.05;
  const dishCx = 0, dishCy = -s * 0.82, dishR = s * 0.52;
  const boost = reached ? 1 : 0;

  // ---------- volumetric cone (drawn first, behind hardware) ----------
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sweep = Math.sin(t * 0.45) * (reached ? 0.10 : 0.22);
  const spread = (reached ? 3.1 : 1.9) * s;
  const reach = CH * 1.25;
  ctx.translate(dishCx, dishCy);
  ctx.rotate(sweep);

  const coneG = TL_rgrad(ctx, 'bcone' + (reached ? 'R' : 'N'), 0, 0, 0, 0, 0, reach, [
    [0, reached ? 'rgba(255,248,220,0.95)' : 'rgba(230,238,255,0.62)'],
    [0.18, reached ? 'rgba(250,225,150,0.45)' : 'rgba(170,196,255,0.26)'],
    [0.55, reached ? 'rgba(200,170,90,0.16)' : 'rgba(110,138,210,0.09)'],
    [1, 'rgba(60,80,150,0)']
  ]);
  ctx.fillStyle = coneG;
  ctx.beginPath();
  ctx.moveTo(-s * 0.30, 0);
  ctx.lineTo(-spread, -reach);
  ctx.lineTo(spread, -reach);
  ctx.lineTo(s * 0.30, 0);
  ctx.closePath();
  ctx.fill();

  // inner hot core
  ctx.globalAlpha = 0.55 + 0.35 * boost + 0.10 * Math.sin(t * 3.1);
  ctx.fillStyle = TL_grad(ctx, 'bcore', 0, 0, 0, -reach * 0.75, [
    [0, 'rgba(255,255,255,0.75)'], [0.4, 'rgba(210,225,255,0.20)'], [1, 'rgba(200,220,255,0)']
  ]);
  ctx.beginPath();
  ctx.moveTo(-s * 0.14, 0); ctx.lineTo(-spread * 0.42, -reach); ctx.lineTo(spread * 0.42, -reach); ctx.lineTo(s * 0.14, 0);
  ctx.closePath(); ctx.fill();

  // god-ray striations
  ctx.globalAlpha = 0.16 + boost * 0.14;
  for (let i = 0; i < 7; i++) {
    const f = (i / 7) - 0.5 + Math.sin(t * 0.5 + i) * 0.03;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(160,190,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(f * s * 0.30, 0);
    ctx.lineTo(f * spread - s * 0.06, -reach);
    ctx.lineTo(f * spread + s * 0.10, -reach);
    ctx.closePath(); ctx.fill();
  }

  // projected bat emblem inside the beam
  const projY = -s * (4.0 + Math.sin(t * 0.7) * 0.25);
  const projW = s * (2.5 + boost * 0.8);
  ctx.globalAlpha = 0.34 + boost * 0.34 + 0.07 * Math.sin(t * 2.0);
  ctx.shadowColor = reached ? 'rgba(255,235,160,0.9)' : 'rgba(190,210,255,0.8)';
  ctx.shadowBlur = s * 0.7;
  TL_batPath(ctx, 0, projY, projW);
  ctx.fillStyle = reached ? 'rgba(255,246,205,0.85)' : 'rgba(225,236,255,0.75)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = reached ? 'rgba(255,255,230,0.9)' : 'rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;

  // ---------- base ----------
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 2, baseW * 0.58, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = TL_grad(ctx, 'bbase' + Math.round(s), -baseW / 2, 0, baseW / 2, 0, [
    [0, '#3b3f55'], [0.25, '#2a2d40'], [0.6, '#1a1c2b'], [1, '#0c0d16']
  ]);
  TL_roundRect(ctx, -baseW / 2, -baseH, baseW, baseH, s * 0.06);
  ctx.fill();
  // top lit lip
  ctx.fillStyle = 'rgba(160,175,225,0.30)';
  ctx.fillRect(-baseW / 2, -baseH, baseW, 2);
  // rivets
  ctx.fillStyle = '#0a0b12';
  for (let i = 0; i < 6; i++) {
    const rx = -baseW * 0.42 + (baseW * 0.84) * (i / 5);
    for (let r = 0; r < 2; r++) {
      const ry = -baseH + s * 0.10 + r * s * 0.26;
      ctx.beginPath(); ctx.arc(rx, ry, s * 0.026, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(170,185,235,0.40)';
      ctx.beginPath(); ctx.arc(rx - s * 0.008, ry - s * 0.010, s * 0.016, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0b12';
    }
  }
  // yoke arms
  ctx.strokeStyle = '#22253a'; ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-baseW * 0.30, -baseH + 2); ctx.lineTo(-dishR * 0.82, dishCy + dishR * 0.35);
  ctx.moveTo(baseW * 0.30, -baseH + 2); ctx.lineTo(dishR * 0.82, dishCy + dishR * 0.35);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,165,215,0.22)'; ctx.lineWidth = s * 0.02;
  ctx.beginPath();
  ctx.moveTo(-baseW * 0.30 - s * 0.03, -baseH + 2); ctx.lineTo(-dishR * 0.86, dishCy + dishR * 0.35);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // ---------- lens dish ----------
  ctx.save();
  ctx.translate(dishCx, dishCy);
  // housing shell
  ctx.beginPath(); ctx.arc(0, 0, dishR * 1.16, 0, Math.PI * 2);
  ctx.fillStyle = TL_grad(ctx, 'bhouse' + Math.round(s), -dishR, -dishR, dishR, dishR, [
    [0, '#454a63'], [0.4, '#262a3c'], [1, '#0d0f18']
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,185,235,0.35)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, dishR * 1.16, Math.PI * 0.8, Math.PI * 1.85); ctx.stroke();

  // lens
  ctx.beginPath(); ctx.arc(0, 0, dishR, 0, Math.PI * 2);
  ctx.fillStyle = TL_rgrad(ctx, 'blens' + (reached ? 'R' : 'N') + Math.round(s),
    -dishR * 0.3, -dishR * 0.3, dishR * 0.05, 0, 0, dishR, [
      [0, reached ? '#ffffff' : '#e9f0ff'],
      [0.35, reached ? '#ffeeb0' : '#9fb6ee'],
      [0.72, reached ? '#c79a2a' : '#41508a'],
      [1, '#131728']
    ]);
  ctx.fill();

  // lattice grille
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, dishR * 0.98, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(10,12,22,0.72)'; ctx.lineWidth = Math.max(1, s * 0.028);
  for (let i = -4; i <= 4; i++) {
    const p = i * dishR * 0.24;
    ctx.beginPath(); ctx.moveTo(p, -dishR); ctx.lineTo(p, dishR); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-dishR, p); ctx.lineTo(dishR, p); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,215,255,0.16)'; ctx.lineWidth = 1;
  for (let i = -4; i <= 4; i++) {
    const p = i * dishR * 0.24 - Math.max(1, s * 0.028) * 0.6;
    ctx.beginPath(); ctx.moveTo(p, -dishR); ctx.lineTo(p, dishR); ctx.stroke();
  }
  // bat emblem cut into the lens
  ctx.globalAlpha = 0.85;
  TL_batPath(ctx, 0, dishR * 0.04, dishR * 1.5);
  ctx.fillStyle = 'rgba(8,10,20,0.90)'; ctx.fill();
  ctx.restore();

  // lens rim + hotspot
  ctx.strokeStyle = 'rgba(20,22,36,0.9)'; ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.beginPath(); ctx.arc(0, 0, dishR, 0, Math.PI * 2); ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.45 + boost * 0.4;
  ctx.fillStyle = TL_rgrad(ctx, 'bhot' + Math.round(s), 0, 0, 0, 0, 0, dishR * 2.1, [
    [0, reached ? 'rgba(255,250,225,0.95)' : 'rgba(215,232,255,0.7)'],
    [0.45, 'rgba(150,180,255,0.18)'], [1, 'rgba(120,150,255,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, dishR * 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.restore();

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BATARANG (coin)
// ============================================================================
function drawBatarang(ctx, cx, cy, r, angle) {
  ctx.save();
  ctx.translate(cx, cy);

  // motion arc trailing the spin
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 1; k <= 3; k++) {
    ctx.globalAlpha = 0.16 / k;
    ctx.strokeStyle = k === 1 ? 'rgba(255,235,170,0.9)' : 'rgba(180,200,255,0.8)';
    ctx.lineWidth = r * (0.18 / k);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, angle - 1.5 - k * 0.35, angle - 0.12 - k * 0.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  ctx.rotate(angle);
  // foreshorten as it spins so it reads as a flat object turning
  const sx = Math.max(0.14, Math.abs(Math.cos(angle * 0.9)) * 0.82 + 0.18);
  ctx.scale(1, 1);

  const blade = (dir) => {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.12);
    ctx.bezierCurveTo(dir * r * 0.35, -r * 0.62, dir * r * 0.86, -r * 0.72, dir * r * 1.02, -r * 0.30);
    ctx.bezierCurveTo(dir * r * 0.80, -r * 0.34, dir * r * 0.58, -r * 0.16, dir * r * 0.46, r * 0.12);
    ctx.bezierCurveTo(dir * r * 0.30, r * 0.02, dir * r * 0.14, r * 0.04, 0, r * 0.30);
    ctx.closePath();
  };

  ctx.save();
  ctx.scale(sx, 1);

  // soft shadow under the metal
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = r * 0.35;
  ctx.shadowOffsetY = r * 0.12;

  const metal = TL_grad(ctx, 'btrg' + Math.round(r), -r, -r, r, r, [
    [0, '#fdf6d8'], [0.18, '#e8d089'], [0.42, '#9a8a5e'], [0.58, '#5b5540'],
    [0.76, '#c9b073'], [1, '#3c3728']
  ]);

  for (let d = -1; d <= 1; d += 2) {
    blade(d);
    ctx.fillStyle = metal;
    ctx.fill();
  }
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // darker underside wash on the lower-right of the pair
  ctx.save();
  for (let d = -1; d <= 1; d += 2) blade(d);
  ctx.fillStyle = TL_grad(ctx, 'btrgsh' + Math.round(r), -r * 0.3, -r * 0.3, r, r * 0.6, [
    [0, 'rgba(255,255,255,0.10)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']
  ]);
  ctx.fill();
  ctx.restore();

  // bright leading-edge specular
  ctx.strokeStyle = 'rgba(255,252,225,0.92)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.lineJoin = 'round';
  for (let d = -1; d <= 1; d += 2) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.12);
    ctx.bezierCurveTo(d * r * 0.35, -r * 0.62, d * r * 0.86, -r * 0.72, d * r * 1.02, -r * 0.30);
    ctx.stroke();
  }
  // shadowed trailing edge
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  for (let d = -1; d <= 1; d += 2) {
    ctx.beginPath();
    ctx.moveTo(d * r * 0.46, r * 0.12);
    ctx.bezierCurveTo(d * r * 0.30, r * 0.02, d * r * 0.14, r * 0.04, 0, r * 0.30);
    ctx.stroke();
  }

  // central hub
  ctx.beginPath(); ctx.arc(0, -r * 0.06, r * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = '#14121c'; ctx.fill();
  ctx.beginPath(); ctx.arc(-r * 0.05, -r * 0.11, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,240,190,0.6)'; ctx.fill();
  ctx.restore();

  // travelling glint across the blades
  const gl = (Math.sin(angle * 2.0) + 1) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.30 + gl * 0.55;
  ctx.fillStyle = TL_rgrad(ctx, 'btglint', 0, 0, 0, 0, 0, 12, [
    [0, 'rgba(255,255,245,1)'], [0.4, 'rgba(255,230,150,0.35)'], [1, 'rgba(255,220,120,0)']
  ]);
  ctx.save();
  ctx.translate((gl - 0.5) * r * 1.6 * sx, -r * 0.34);
  ctx.scale(r * 0.055, r * 0.055);
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BAT SUIT PICKUP
// ============================================================================
function drawBatSuitPickup(ctx, x, y, s, t) {
  ctx.save();
  const bob = Math.sin(t * 2.2) * s * 0.07;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.0);
  ctx.translate(x + s / 2, y + s / 2 + bob);

  // crimson energy aura
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.28 + pulse * 0.32;
  ctx.fillStyle = TL_rgrad(ctx, 'bsaura' + Math.round(s), 0, 0, s * 0.18, 0, 0, s * 1.05, [
    [0, 'rgba(255,120,110,0.85)'], [0.45, 'rgba(224,59,59,0.32)'], [1, 'rgba(160,20,30,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, s * 1.05, 0, Math.PI * 2); ctx.fill();
  // rising energy motes
  for (let i = 0; i < 6; i++) {
    const ph = (t * 0.55 + TL_rnd(i * 17)) % 1;
    const mx = (TL_rnd(i * 5 + 3) - 0.5) * s * 0.85;
    const my = s * 0.5 - ph * s * 1.15;
    ctx.globalAlpha = (1 - ph) * 0.55;
    ctx.fillStyle = PAL.danger;
    ctx.beginPath(); ctx.arc(mx, my, s * 0.035 * (1 - ph * 0.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // ground-contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, s * 0.62 - bob, s * 0.34, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();

  // ---- armored chest plate ----
  const pw = s * 0.72, ph2 = s * 0.78;
  ctx.beginPath();
  ctx.moveTo(-pw * 0.5, -ph2 * 0.46);
  ctx.quadraticCurveTo(-pw * 0.30, -ph2 * 0.56, 0, -ph2 * 0.50);
  ctx.quadraticCurveTo(pw * 0.30, -ph2 * 0.56, pw * 0.5, -ph2 * 0.46);
  ctx.lineTo(pw * 0.44, ph2 * 0.18);
  ctx.quadraticCurveTo(pw * 0.36, ph2 * 0.46, 0, ph2 * 0.54);
  ctx.quadraticCurveTo(-pw * 0.36, ph2 * 0.46, -pw * 0.44, ph2 * 0.18);
  ctx.closePath();
  ctx.fillStyle = TL_grad(ctx, 'bsplate' + Math.round(s), -pw * 0.5, -ph2 * 0.5, pw * 0.5, ph2 * 0.5, [
    [0, PAL.batHi], [0.35, PAL.bat], [1, PAL.batLo]
  ]);
  ctx.fill();
  // rim light upper-left
  ctx.strokeStyle = 'rgba(180,196,245,0.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-pw * 0.44, ph2 * 0.10);
  ctx.lineTo(-pw * 0.5, -ph2 * 0.46);
  ctx.quadraticCurveTo(-pw * 0.30, -ph2 * 0.56, 0, -ph2 * 0.50);
  ctx.stroke();
  // dark inner shade on the right
  ctx.fillStyle = TL_grad(ctx, 'bsplsh' + Math.round(s), 0, 0, pw * 0.5, ph2 * 0.4, [
    [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.5)']
  ]);
  ctx.fill();

  // armor plate seams
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-pw * 0.40, -ph2 * 0.16); ctx.quadraticCurveTo(0, -ph2 * 0.06, pw * 0.40, -ph2 * 0.16);
  ctx.moveTo(-pw * 0.34, ph2 * 0.12); ctx.quadraticCurveTo(0, ph2 * 0.24, pw * 0.34, ph2 * 0.12);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,165,215,0.20)';
  ctx.beginPath();
  ctx.moveTo(-pw * 0.40, -ph2 * 0.16 + 1.3); ctx.quadraticCurveTo(0, -ph2 * 0.06 + 1.3, pw * 0.40, -ph2 * 0.16 + 1.3);
  ctx.stroke();

  // yellow oval emblem
  ctx.beginPath();
  ctx.ellipse(0, -ph2 * 0.10, pw * 0.34, ph2 * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = TL_grad(ctx, 'bsoval' + Math.round(s), 0, -ph2 * 0.34, 0, ph2 * 0.14, [
    [0, '#fff0a8'], [0.5, PAL.yellow], [1, PAL.yellowD]
  ]);
  ctx.shadowColor = 'rgba(245,197,24,0.75)'; ctx.shadowBlur = s * 0.18;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(120,88,6,0.7)'; ctx.lineWidth = 1; ctx.stroke();

  TL_batPath(ctx, 0, -ph2 * 0.10, pw * 0.62);
  ctx.fillStyle = PAL.batLo; ctx.fill();

  // glass specular sweep over the emblem
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, -ph2 * 0.10, pw * 0.34, ph2 * 0.24, 0, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(-pw * 0.10, -ph2 * 0.20, pw * 0.20, ph2 * 0.07, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BAT SIGNAL STAR (invincibility)
// ============================================================================
function drawBatSignalStar(ctx, x, y, s, t) {
  ctx.save();
  const bob = Math.sin(t * 2.6) * s * 0.06;
  ctx.translate(x + s / 2, y + s / 2 + bob);
  const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);

  // additive halo
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.45 + pulse * 0.35;
  ctx.fillStyle = TL_rgrad(ctx, 'bsthalo' + Math.round(s), 0, 0, s * 0.10, 0, 0, s * 1.15, [
    [0, 'rgba(255,255,225,0.95)'], [0.25, 'rgba(255,215,90,0.50)'],
    [0.6, 'rgba(230,160,20,0.16)'], [1, 'rgba(255,190,40,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, s * 1.15, 0, Math.PI * 2); ctx.fill();

  // rotating starburst rays -- two counter-rotating sets
  for (let set = 0; set < 2; set++) {
    const n = set === 0 ? 8 : 12;
    const rot = t * (set === 0 ? 0.9 : -0.55);
    const len = s * (set === 0 ? 1.05 : 0.78) * (0.86 + pulse * 0.18);
    const wdt = set === 0 ? 0.085 : 0.045;
    ctx.globalAlpha = set === 0 ? 0.55 + pulse * 0.3 : 0.30 + pulse * 0.2;
    ctx.fillStyle = TL_grad(ctx, 'bstray' + set + Math.round(s), 0, 0, len, 0, [
      [0, 'rgba(255,255,235,0.95)'], [0.35, 'rgba(255,208,80,0.45)'], [1, 'rgba(255,180,30,0)']
    ]);
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const lm = len * (0.7 + 0.3 * TL_rnd(i + set * 31));
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(s * 0.16, 0);
      ctx.lineTo(lm, -s * wdt * 0.45);
      ctx.lineTo(lm, s * wdt * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // long lens-flare cross
  ctx.globalAlpha = 0.5 + pulse * 0.4;
  ctx.fillStyle = TL_grad(ctx, 'bstflare' + Math.round(s), -s * 1.5, 0, s * 1.5, 0, [
    [0, 'rgba(255,220,120,0)'], [0.42, 'rgba(255,245,200,0.75)'],
    [0.5, 'rgba(255,255,255,0.95)'], [0.58, 'rgba(255,245,200,0.75)'], [1, 'rgba(255,220,120,0)']
  ]);
  ctx.fillRect(-s * 1.5, -s * 0.022, s * 3, s * 0.044);
  ctx.save(); ctx.rotate(Math.PI / 2);
  ctx.fillRect(-s * 1.5, -s * 0.018, s * 3, s * 0.036);
  ctx.restore();
  ctx.restore();
  ctx.globalAlpha = 1;

  // spinning medallion
  const spin = t * 1.7;
  const sq = Math.abs(Math.cos(spin)) * 0.85 + 0.15;
  ctx.save();
  ctx.scale(sq, 1);
  const dr = s * 0.32;
  ctx.beginPath(); ctx.arc(0, 0, dr, 0, Math.PI * 2);
  ctx.fillStyle = TL_rgrad(ctx, 'bstdisc' + Math.round(s), -dr * 0.35, -dr * 0.35, dr * 0.05, 0, 0, dr, [
    [0, '#fffbe0'], [0.4, PAL.yellow], [0.8, PAL.yellowD], [1, '#5d4506']
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,250,210,0.8)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, dr, Math.PI * 0.85, Math.PI * 1.9); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,66,6,0.8)';
  ctx.beginPath(); ctx.arc(0, 0, dr, Math.PI * 1.9, Math.PI * 0.85); ctx.stroke();

  TL_batPath(ctx, 0, 0, dr * 1.35);
  ctx.fillStyle = '#16121f'; ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = 'rgba(255,235,150,0.8)'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // hot centre dot
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 + pulse * 0.5;
  ctx.fillStyle = TL_rgrad(ctx, 'bstcore' + Math.round(s), 0, 0, 0, 0, 0, s * 0.22, [
    [0, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,220,120,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  TL_clearFx(ctx);
  ctx.restore();
}
