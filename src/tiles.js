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

// --- quarried-stone colour ramp ---------------------------------------------
// Albedo only. The deferred pass supplies every highlight, so these stay dark
// and nearly neutral: separation is by VALUE, with a few counts of warm/cool
// drift so one sett reads as a different block of stone from its neighbour.
// Quantised into a lookup so the per-stone inner loop never builds a string.
const TL_STONEPAL = (function () {
  const a = [];
  for (let w = 0; w < 3; w++) {
    const wm = w - 1;
    for (let i = 0; i < 16; i++) {
      // 70..165, arrived at by probe rather than by argument: painting the
      // stone bright red showed the colour reaching the screen at roughly half
      // strength after the grade, so a 20..74 ramp could only ever land the
      // floor around 0.08 luminance however the lighting was tuned.
      //
      // The "wet stone is dark, let the specular put it back" reasoning was
      // right in principle and wrong here: ambient sits near 1.0, so for most
      // of the frame the albedo IS the final value, and specular only fires
      // where a light happens to strike at the right angle. The playfield has
      // to carry itself.
      const b = 70 + (i / 15) * 95;
      a.push('rgb(' + ((b + wm * 4.0) | 0) + ',' +
        ((b + wm * 1.2) | 0) + ',' + ((b - wm * 3.0 + 5) | 0) + ')');
    }
  }
  return a;
})();
const TL_PBUF = new Float64Array(16);
function TL_stone(v, w) {
  let i = (v * 15.99) | 0;
  if (i < 0) i = 0; else if (i > 15) i = 15;
  return TL_STONEPAL[w * 16 + i];
}

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
// Granite setts bedded in grime. The courses are generated in WORLD space, not
// per tile, so a run of ground reads as one paved surface instead of a row of
// 32px stamps -- that repeating grid was the single loudest tell that this was
// tile art. idx = cx*31 + cy*17 and y is the world row, so both cell
// coordinates can be recovered and used as the seed.
function drawGroundTile(ctx, x, y, s, o) {
  const top = !!(o && o.top), idx = (o && o.idx) | 0;
  const cy = Math.round(y / s), cx = Math.round((idx - cy * 17) / 31);
  const wx0 = cx * s;
  ctx.save();
  ctx.translate(x, y);

  // 1. the bed the setts sit in: wet grime, almost black, so every joint is a
  //    hole rather than a drawn line
  ctx.fillStyle = TL_grad(ctx, 'gbed' + s, 0, 0, 0, s, [
    [0, '#39414c'], [0.5, '#2a313a'], [1, '#1d232a']
  ]);
  ctx.fillRect(0, 0, s, s);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();

  const CP = s / 2;            // nominal course pitch -- quarried, not cobbled
  const SB = 64;               // world-space run the stones of a course repeat in
  const sb0 = Math.floor(wx0 / SB), sb1 = Math.floor((wx0 + s - 0.01) / SB);

  for (let r = -1; r <= 2; r++) {
    const gr = cy * 2 + r;                       // global course index
    const yT = r * CP + (TL_rnd(gr) - 0.5) * 3.4;
    const yB = (r + 1) * CP + (TL_rnd(gr + 1) - 0.5) * 3.4;
    if (yB < -0.5 || yT > s + 0.5) continue;
    const ch = yB - yT;
    // depth cue: lower courses of the mass sit further from the sky
    const depth = top ? (yT / s) * 0.13 : 0.12 + (yT / s) * 0.08;
    // every course slips sideways, so vertical joints never stack
    const ph = TL_rnd(gr * 3 + 1) * SB;

    for (let sb = sb0 - 1; sb <= sb1; sb++) {
      const org = sb * SB - wx0 + ph, end = org + SB;
      if (org > s + 1 || end < -1) continue;
      let px = org;
      for (let k = 0; k < 4 && px < end - 2; k++) {
        const h = TL_rnd2(sb * 9 + k, gr * 3 + 1);
        const h2 = TL_rnd2(sb * 17 + k, gr * 7 + 5);
        let bw = SB * (0.26 + h * 0.22);
        if (px + bw > end - 6) bw = end - px;     // last stone closes the run
        const jw = 1.1 + h2 * 1.0;                // joint width
        const bx = px + jw * 0.5, by = yT + 0.8;
        const bwi = bw - jw, bhi = ch - 1.7;
        px += bw;
        if (bwi < 1.2 || bhi < 1.2 || bx + bwi < -1 || bx > s + 1) continue;

        // chipped corner: one chamfer per stone, knocked off by a century of
        // traffic. Capped so it never eats more than a third of the face.
        const cs = TL_rnd2(sb * 5 + k, gr * 11);
        const chip = cs > 0.52 ? Math.min(bwi, bhi) * (0.12 + (cs - 0.52) * 0.44) : 0;
        const corner = (TL_rnd2(sb * 23 + k, gr) * 4) | 0;
        ctx.beginPath();
        if (chip && corner === 0) ctx.moveTo(bx + chip, by); else ctx.moveTo(bx, by);
        if (chip && corner === 1) { ctx.lineTo(bx + bwi - chip, by); ctx.lineTo(bx + bwi, by + chip); }
        else ctx.lineTo(bx + bwi, by);
        if (chip && corner === 2) { ctx.lineTo(bx + bwi, by + bhi - chip); ctx.lineTo(bx + bwi - chip, by + bhi); }
        else ctx.lineTo(bx + bwi, by + bhi);
        if (chip && corner === 3) { ctx.lineTo(bx + chip, by + bhi); ctx.lineTo(bx, by + bhi - chip); }
        else ctx.lineTo(bx, by + bhi);
        if (chip && corner === 0) ctx.lineTo(bx, by + chip);
        ctx.closePath();

        const hw = TL_rnd2(sb + k * 3, gr * 13);
        const v = 0.22 + h2 * 0.54 + (h - 0.5) * 0.09 - depth;
        ctx.fillStyle = TL_stone(v, hw < 0.26 ? 0 : (hw > 0.80 ? 2 : 1));
        ctx.fill();

        // grime wedged into the joint under and beside every stone
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.fillRect(bx, by + bhi - 1.2, bwi, 1.2);
        ctx.fillRect(bx + bwi - 1.1, by, 1.1, bhi);
        // the barest cool catch on the worn upper arris -- the lighting pass
        // does the rest, so this only has to say "there is an edge here"
        if (h2 > 0.30) {
          ctx.fillStyle = 'rgba(158,176,200,' + (0.10 + h2 * 0.15).toFixed(3) + ')';
          ctx.fillRect(bx + (chip && corner === 0 ? chip : 0), by,
            bwi - (chip && corner === 1 ? chip : 0) - 1.1, 0.9);
          ctx.fillStyle = 'rgba(142,160,186,' + (0.05 + h2 * 0.08).toFixed(3) + ')';
          ctx.fillRect(bx, by + (chip && corner === 0 ? chip : 0), 0.9,
            bhi - 1.2 - (chip && corner === 3 ? chip : 0));
        }
        // worn dish in the middle of the stone, where boots have been
        if (h > 0.55) {
          ctx.globalAlpha = 0.10 + h * 0.13;
          ctx.fillStyle = '#04060a';
          ctx.beginPath();
          ctx.ellipse(bx + bwi * (0.34 + h2 * 0.32), by + bhi * (0.46 + h * 0.2),
            bwi * 0.22, bhi * 0.20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        // tooling marks: a couple of chisel scores across the face
        if (h2 < 0.34 && bwi > 7) {
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = '#05070c';
          for (let q = 0; q < 2; q++)
            ctx.fillRect(bx + 1.5 + TL_rnd2(sb * 31 + k, gr + q) * (bwi - 4),
              by + 1.2 + q * bhi * 0.42, 0.9, bhi * 0.36);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // 2. grain: pecked granite, mostly dark so it reads as pitting not sparkle
  for (let i = 0; i < 14; i++) {
    const px = TL_rnd2(idx * 11 + i, 1) * s;
    const py = TL_rnd2(idx * 11 + i, 2) * s;
    const a = TL_rnd2(idx * 11 + i, 3);
    ctx.fillStyle = a > 0.76 ? 'rgba(160,176,198,0.10)' : 'rgba(0,0,0,0.34)';
    ctx.fillRect(px, py, 1 + (a > 0.9 ? 1 : 0), 1);
  }

  // 3. staining. Exposed tops collect standing water; buried faces weep.
  if (top) {
    // dark, not bright: a film of water DARKENS albedo. The occluder buffer
    // already tags this band as near-mirror, so the renderer puts the shine
    // back as reflection and specular instead of us painting it in.
    ctx.fillStyle = TL_grad(ctx, 'gwet' + s, 0, 0, 0, 7.5, [
      [0, 'rgba(4,7,12,0.46)'], [0.6, 'rgba(6,9,14,0.22)'], [1, 'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0, 0, s, 8);
    // standing water pooled in the low spots between setts
    for (let i = 0; i < 2; i++) {
      const pw = s * (0.18 + TL_rnd2(idx + i * 13, 21) * 0.34);
      ctx.globalAlpha = 0.30 + TL_rnd2(idx + i, 23) * 0.22;
      ctx.fillStyle = '#04060a';
      ctx.fillRect(TL_rnd2(idx + i * 7, 22) * (s - pw), 0.8, pw, 2.4 + TL_rnd2(idx + i, 24) * 2);
      ctx.globalAlpha = 1;
    }
  } else {
    // run-off weeping down the face, and the lime it leaves behind
    for (let i = 0; i < 3; i++) {
      const sx = TL_rnd2(idx * 3 + i * 29, 31) * s;
      const sw = 1.2 + TL_rnd2(idx + i, 32) * 3.4;
      ctx.globalAlpha = 0.10 + TL_rnd2(idx + i * 5, 33) * 0.16;
      ctx.fillStyle = TL_grad(ctx, 'gstain' + s, 0, 0, 0, s, [
        [0, 'rgba(0,0,0,0.9)'], [0.65, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']
      ]);
      ctx.fillRect(sx, 0, sw, s);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // 4. ambient occlusion down the mass
  ctx.fillStyle = TL_grad(ctx, 'gndao' + s, 0, s * 0.3, 0, s, [
    [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.30)']
  ]);
  ctx.fillRect(0, 0, s, s);

  if (top) {
    // one cool arris along the walked edge -- enough to carry the silhouette
    // of the playfield against the fog without being a baked highlight
    ctx.fillStyle = 'rgba(176,196,220,0.80)';
    ctx.fillRect(0, 0, s, 1.2);
    ctx.fillStyle = 'rgba(120,142,170,0.36)';
    ctx.fillRect(0, 1.2, s, 1);
    ctx.fillStyle = TL_grad(ctx, 'gndlip' + s, 0, 2.2, 0, 8, [
      [0, 'rgba(0,0,0,0.46)'], [1, 'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0, 2.2, s, 6);
  }

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// STONE BLOCK
// ============================================================================
// Rusticated ashlar: a drafted margin cut round a rough-hewn boss. That is what
// a quarried structural block actually looks like, and it gives the lighting
// pass a real recess to pool shadow in -- unlike the old cross-groove-and-rivets,
// which was a cartoon of a crate.
function drawStoneBlock(ctx, x, y, s, idx) {
  idx = idx | 0;
  ctx.save();
  ctx.translate(x, y);

  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(2.5, 3.5, s, s);

  const bev = Math.max(2.5, s * 0.115);
  // the drafted margin -- the flat chiselled border, sunk below the boss
  ctx.fillStyle = TL_grad(ctx, 'stbm' + s, 0, 0, s * 0.8, s, [
    [0, '#2b323b'], [0.45, '#1a2027'], [1, '#0b0e13']
  ]);
  ctx.fillRect(0, 0, s, s);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();

  // --- the boss: irregular, because it was never dressed flat ---
  const ins = bev + 0.8, bw = s - ins * 2;
  const j = (k) => (TL_rnd2(idx * 7 + k, 3) - 0.5) * s * 0.045;
  const P = TL_PBUF;
  P[0] = ins + j(0);                 P[1] = ins + j(1);
  P[2] = ins + bw * 0.52 + j(2);     P[3] = ins + j(3);
  P[4] = ins + bw + j(4);            P[5] = ins + j(5);
  P[6] = ins + bw + j(6);            P[7] = ins + bw * 0.48 + j(7);
  P[8] = ins + bw + j(8);            P[9] = ins + bw + j(9);
  P[10] = ins + bw * 0.46 + j(10);   P[11] = ins + bw + j(11);
  P[12] = ins + j(12);               P[13] = ins + bw + j(13);
  P[14] = ins + j(14);               P[15] = ins + bw * 0.5 + j(15);
  const boss = () => {
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 2; i < 16; i += 2) ctx.lineTo(P[i], P[i + 1]);
    ctx.closePath();
  };

  // the channel round the boss is in shade all the way round
  ctx.save();
  ctx.translate(0.9, 1.0);
  boss();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  ctx.restore();

  boss();
  ctx.fillStyle = TL_grad(ctx, 'stbb' + s, 0, 0, s * 0.75, s, [
    [0, '#4d5760'], [0.4, '#343c45'], [1, '#191e25']
  ]);
  ctx.fill();

  // rough face: pecked, with the tooling running one way
  ctx.save();
  boss(); ctx.clip();
  for (let i = 0; i < 13; i++) {
    const px = ins + TL_rnd2(idx * 5 + i, 11) * bw;
    const py = ins + TL_rnd2(idx * 5 + i, 12) * bw;
    const a = TL_rnd2(i * 3, idx);
    ctx.fillStyle = a > 0.68 ? 'rgba(170,186,208,0.09)' : 'rgba(0,0,0,0.30)';
    ctx.fillRect(px, py, 1 + (a > 0.88 ? 1.4 : 0), 1 + (a < 0.3 ? 1.2 : 0));
  }
  // short chisel runs, never edge to edge
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const py = ins + (0.22 + i * 0.28) * bw + TL_rnd2(idx + i, 41) * 2.5;
    const x0 = ins + TL_rnd2(idx * 3 + i, 42) * bw * 0.4;
    ctx.beginPath(); ctx.moveTo(x0, py);
    ctx.lineTo(x0 + bw * (0.3 + TL_rnd2(idx + i, 43) * 0.45), py + (TL_rnd2(idx, i) - 0.5) * 2.4);
    ctx.stroke();
  }
  // weeping stain down the face
  ctx.globalAlpha = 0.20 + TL_rnd(idx) * 0.16;
  ctx.fillStyle = TL_grad(ctx, 'stbst' + s, 0, 0, 0, s, [
    [0, 'rgba(0,0,0,0.85)'], [0.7, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']
  ]);
  ctx.fillRect(ins + TL_rnd2(idx, 51) * bw * 0.7, ins, 1.5 + TL_rnd(idx * 3) * 3, bw);
  ctx.globalAlpha = 1;
  ctx.restore();

  // the raised face meets the channel: lit on the up-light side, dark opposite
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(P[4], P[5]); ctx.lineTo(P[6], P[7]); ctx.lineTo(P[8], P[9]);
  ctx.lineTo(P[10], P[11]); ctx.lineTo(P[12], P[13]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(158,176,202,0.19)';
  ctx.beginPath();
  ctx.moveTo(P[12], P[13]); ctx.lineTo(P[14], P[15]); ctx.lineTo(P[0], P[1]);
  ctx.lineTo(P[2], P[3]); ctx.lineTo(P[4], P[5]);
  ctx.stroke();

  // --- a corner knocked off, exposing a fresh fracture ---
  const ck = TL_rnd(idx * 13);
  if (ck > 0.38) {
    const corner = (TL_rnd(idx * 29) * 4) | 0;
    const cl = s * (0.12 + ck * 0.16);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate((Math.PI / 2) * corner);
    ctx.translate(-s / 2, -s / 2);
    ctx.beginPath();
    ctx.moveTo(-1, -1); ctx.lineTo(cl, -1);
    ctx.lineTo(cl * 0.45, cl * 0.42); ctx.lineTo(-1, cl * 0.95);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,8,11,0.92)'; ctx.fill();
    // the break face still catches a little light
    ctx.beginPath();
    ctx.moveTo(cl, -1); ctx.lineTo(cl * 0.45, cl * 0.42); ctx.lineTo(-1, cl * 0.95);
    ctx.strokeStyle = 'rgba(150,168,194,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // overall occlusion down and right
  ctx.fillStyle = TL_grad(ctx, 'stbao' + s, 0, 0, s, s, [
    [0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0.10)'], [1, 'rgba(0,0,0,0.42)']
  ]);
  ctx.fillRect(0, 0, s, s);
  // the top arris: this block is a ledge, and ledges are wet
  ctx.fillStyle = 'rgba(158,176,202,0.34)';
  ctx.fillRect(0, 0, s, 1);
  ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

  TL_clearFx(ctx);
  ctx.restore();
}

// ============================================================================
// BRICK BLOCK
// ============================================================================
// Sooted Gotham brick. The old version was a bright pink lattice -- the single
// most saturated thing in a frame that is meant to be near-monochrome. Now it
// is a dark, weathered, mostly-grey wall: the warmth is a couple of counts of
// red, not a hue, and the interest comes from spalled faces, missing bricks and
// lime weeping out of the joints.
function drawBrickBlock(ctx, x, y, s, idx) {
  idx = idx | 0;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(2.5, 3.5, s, s);

  // mortar bed, raked back so every joint is a shadow not a line
  ctx.fillStyle = TL_grad(ctx, 'brkm' + s, 0, 0, 0, s, [
    [0, '#1d1d20'], [0.5, '#141416'], [1, '#0a0a0c']
  ]);
  ctx.fillRect(0, 0, s, s);

  const rows = 4, rh = s / rows;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();
  for (let r = 0; r < rows; r++) {
    const stagger = (r % 2) ? -s * 0.25 : 0;
    for (let c = -1; c < 3; c++) {
      const h = TL_rnd2(idx * 13 + c, r);
      const h2 = TL_rnd2(idx * 29 + c * 3, r * 5 + 1);
      const jx = (TL_rnd2(idx + c * 7, r * 11) - 0.5) * 1.4;
      const bx = c * (s / 2) + stagger + 0.9 + jx;
      const by = r * rh + 0.9;
      const bw = s / 2 - 1.9, bh = rh - 1.8;
      if (bx > s || bx + bw < 0) continue;

      // a brick fell out. The hole is the darkest thing on the block.
      if (h2 > 0.90) {
        ctx.fillStyle = '#05060a';
        ctx.fillRect(bx - 0.6, by - 0.6, bw + 1.2, bh + 1.2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx - 0.6, by - 0.6, bw + 1.2, bh * 0.45);
        // the lit lower lip of the recess
        ctx.fillStyle = 'rgba(120,134,152,0.16)';
        ctx.fillRect(bx - 0.6, by + bh - 1, bw + 1.2, 1);
        continue;
      }

      // body: value-led, 4-6 counts of warmth at most
      const v = 0.30 + h * 0.46 - r * 0.05 + (h2 - 0.5) * 0.14;
      const soot = h2 < 0.22 ? 0.45 : 0;        // some are nearly black with soot
      const b = (14 + v * 48) * (1 - soot);
      const cr = (b + 7) | 0, cg = (b + 1) | 0, cb = (b - 3) | 0;

      // spalled faces: a corner or an edge sheared off
      const nib = h > 0.66 ? bh * (0.22 + h * 0.30) : 0;
      const nib2 = h2 > 0.62 ? bh * 0.26 : 0;
      ctx.beginPath();
      ctx.moveTo(bx + nib2 * 0.6, by);
      ctx.lineTo(bx + bw - nib, by);
      if (nib) ctx.lineTo(bx + bw, by + nib); else ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + (h > 0.40 ? bh * 0.22 : 0), by + bh);
      ctx.lineTo(bx, by + bh - nib2 * 0.5);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      ctx.fill();

      // worn arris, cool because the light is cool -- not a warm brick glow
      ctx.fillStyle = 'rgba(152,166,186,' + (0.07 + h * 0.08).toFixed(3) + ')';
      ctx.fillRect(bx + nib2 * 0.6, by, bw - nib - nib2 * 0.6, 1);
      // bottom/right into the raked joint
      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.fillRect(bx, by + bh - 1.5, bw, 1.5);
      ctx.fillRect(bx + bw - 1.3, by + nib, 1.3, bh - nib);
      // pitting and frost damage
      for (let p = 0; p < 3; p++) {
        const px = bx + TL_rnd2(idx + c * 3 + p, r * 7) * (bw - 2);
        const py = by + TL_rnd2(idx + c * 5 + p, r * 3) * (bh - 2);
        ctx.fillStyle = p === 0 && h2 > 0.5 ? 'rgba(150,160,176,0.08)' : 'rgba(0,0,0,0.32)';
        ctx.fillRect(px, py, 1.3, 1.1);
      }
    }
  }

  // lime leaching out of the joints and running down the face
  for (let i = 0; i < 2; i++) {
    const sx = TL_rnd2(idx * 19 + i * 5, 61) * s;
    ctx.globalAlpha = 0.07 + TL_rnd2(idx + i, 62) * 0.07;
    ctx.fillStyle = TL_grad(ctx, 'brkeff' + s, 0, 0, 0, s, [
      [0, 'rgba(188,196,206,0)'], [0.3, 'rgba(188,196,206,0.9)'], [1, 'rgba(188,196,206,0)']
    ]);
    ctx.fillRect(sx, 0, 1.4 + TL_rnd2(idx + i * 3, 63) * 2.6, s);
    ctx.globalAlpha = 1;
  }

  // cracks step through the joints the way real brickwork fails, rather than
  // running diagonally across whole bricks
  ctx.strokeStyle = 'rgba(0,0,0,0.70)'; ctx.lineWidth = 1;
  const ncr = 1 + (TL_rnd(idx) > 0.55 ? 1 : 0);
  for (let k = 0; k < ncr; k++) {
    let cx0 = TL_rnd2(idx, k * 3) * s, cy0 = 0;
    ctx.beginPath(); ctx.moveTo(cx0, cy0);
    for (let seg = 1; seg <= 4; seg++) {
      cx0 += (TL_rnd2(idx * 2 + seg, k) - 0.5) * s * 0.30;
      ctx.lineTo(cx0, cy0);                   // run along the bed joint
      cy0 += s / 4;
      ctx.lineTo(cx0, cy0);                   // drop down a perp joint
    }
    ctx.stroke();
  }
  ctx.restore();

  // soot settles at the top, grime pools at the bottom
  ctx.fillStyle = TL_grad(ctx, 'brkao' + s, 0, 0, s, s, [
    [0, 'rgba(170,184,206,0.07)'], [0.45, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.46)']
  ]);
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(142,158,180,0.26)';
  ctx.fillRect(0, 0, s, 1);
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
  const c = s / 2, bev = Math.max(2.5, s * 0.115);
  const mr = s * 0.30;

  if (!used) {
    // the lamp spills onto the air around it. Tighter and cooler than the old
    // sodium bloom -- collectLights() already puts a real point light here, so
    // this only has to seat the housing in its own glow.
    const pulse = 0.58 + 0.42 * Math.sin(t * 2.6);
    ctx.globalAlpha = 0.22 + pulse * 0.20;
    ctx.fillStyle = TL_rgrad(ctx, 'bsglow' + s, c, c, s * 0.26, c, c, s * 1.0, [
      [0, 'rgba(226,186,96,0.75)'], [0.45, 'rgba(176,140,66,0.20)'], [1, 'rgba(150,120,60,0)']
    ]);
    ctx.fillRect(-s * 0.6, -s * 0.6, s * 2.2, s * 2.2);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.44)';
  ctx.fillRect(2.5, 3.5, s, s);

  // ---- cast-steel housing. Same material whether it is live or spent. ----
  ctx.fillStyle = TL_grad(ctx, 'bshouse' + s, 0, 0, s * 0.8, s, [
    [0, '#333a44'], [0.42, '#222831'], [1, '#0d1116']
  ]);
  ctx.fillRect(0, 0, s, s);

  // chamfer: a thin cool catch up-light, deep shade down-light
  ctx.fillStyle = 'rgba(150,168,194,0.26)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - bev, bev); ctx.lineTo(bev, bev); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(132,150,176,0.15)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bev, bev); ctx.lineTo(bev, s - bev); ctx.lineTo(0, s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.44)';
  ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s, s); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s - bev, bev); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(bev, s - bev); ctx.lineTo(s - bev, s - bev); ctx.lineTo(s, s); ctx.closePath(); ctx.fill();

  // plate texture: scuffs and a weeping stain, so the casing looks used
  ctx.save();
  ctx.beginPath(); ctx.rect(bev * 0.6, bev * 0.6, s - bev * 1.2, s - bev * 1.2); ctx.clip();
  for (let i = 0; i < 7; i++) {
    const px = TL_rnd2(i * 7 + 3, 71) * s, py = TL_rnd2(i * 11 + 5, 72) * s;
    ctx.fillStyle = TL_rnd2(i, 73) > 0.6 ? 'rgba(170,186,208,0.07)' : 'rgba(0,0,0,0.26)';
    ctx.fillRect(px, py, 1.4, 1.1);
  }
  ctx.restore();

  // four countersunk bolts holding the lens ring on
  const si = bev + s * 0.055;
  for (let i = 0; i < 4; i++) {
    const sx = (i & 1) ? s - si : si, sy = (i & 2) ? s - si : si;
    ctx.beginPath(); ctx.arc(sx, sy, s * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0d12'; ctx.fill();
    ctx.beginPath(); ctx.arc(sx - s * 0.012, sy - s * 0.014, s * 0.026, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(146,162,186,0.30)'; ctx.fill();
  }

  // ---- the lens ----
  ctx.beginPath(); ctx.arc(c, c, mr * 1.20, 0, Math.PI * 2);
  ctx.fillStyle = TL_grad(ctx, 'bsring' + s, 0, c - mr, 0, c + mr, [
    [0, '#39414c'], [0.5, '#1d222a'], [1, '#0b0e13']
  ]);
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(152,170,196,0.30)';
  ctx.beginPath(); ctx.arc(c, c, mr * 1.20, Math.PI * 0.85, Math.PI * 1.95); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.60)';
  ctx.beginPath(); ctx.arc(c, c, mr * 1.20, Math.PI * 1.95, Math.PI * 0.85); ctx.stroke();

  ctx.beginPath(); ctx.arc(c, c, mr, 0, Math.PI * 2);
  if (used) {
    // dead glass: dark, with the lamp behind it gone cold
    ctx.fillStyle = TL_rgrad(ctx, 'bslensu' + s, c - mr * 0.35, c - mr * 0.35, mr * 0.05, c, c, mr, [
      [0, '#2b313a'], [0.55, '#171b22'], [1, '#090c11']
    ]);
    ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, mr, 0, Math.PI * 2); ctx.clip();
    // the filament shattered
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const a0 = k * 2.1 + 0.6;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a0) * mr * 0.1, c + Math.sin(a0) * mr * 0.1);
      ctx.lineTo(c + Math.cos(a0 + 0.3) * mr, c + Math.sin(a0 + 0.3) * mr);
      ctx.stroke();
    }
    TL_batPath(ctx, c, c + s * 0.01, s * 0.40);
    ctx.fillStyle = 'rgba(8,10,14,0.80)'; ctx.fill();
    ctx.strokeStyle = 'rgba(140,156,180,0.18)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  } else {
    // live: an arc lamp behind a fresnel. The housing stays steel; only the
    // glass carries colour, which is the whole point of a near-monochrome frame.
    ctx.fillStyle = TL_rgrad(ctx, 'bslens' + s, c - mr * 0.3, c - mr * 0.32, mr * 0.04, c, c, mr, [
      [0, '#fff6dc'], [0.30, '#e8bf63'], [0.70, '#8a6520'], [1, '#2a1e09']
    ]);
    ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, mr, 0, Math.PI * 2); ctx.clip();
    // fresnel steps
    ctx.strokeStyle = 'rgba(28,20,6,0.30)'; ctx.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath(); ctx.arc(c, c, mr * (k / 3.4), 0, Math.PI * 2); ctx.stroke();
    }
    // the emblem is a stencil in front of the lamp, so it is a HOLE of darkness
    TL_batPath(ctx, c, c + s * 0.01, s * 0.42);
    ctx.fillStyle = 'rgba(14,11,4,0.88)'; ctx.fill();
    ctx.restore();
    // hot core bleeding round the stencil
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.30 + 0.18 * Math.sin(t * 2.6);
    ctx.fillStyle = TL_rgrad(ctx, 'bshot' + s, c, c, 0, c, c, mr * 1.5, [
      [0, 'rgba(255,232,170,0.55)'], [0.5, 'rgba(226,170,70,0.16)'], [1, 'rgba(200,150,60,0)']
    ]);
    ctx.beginPath(); ctx.arc(c, c, mr * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = 1;
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
    [0, '#3b424c'], [0.22, PAL.stoneL], [0.55, PAL.stone], [1, '#0d1116']
  ]);
  ctx.fillRect(w * 0.10, colTop, w * 0.80, ch);

  // fluting
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const fx = w * 0.10 + (w * 0.80) * (i / 4);
    ctx.beginPath(); ctx.moveTo(fx, colTop + 6); ctx.lineTo(fx, h); ctx.stroke();
    ctx.strokeStyle = 'rgba(146,162,186,0.13)';
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
      [0, 'rgba(8,10,14,0.92)'], [1, 'rgba(8,10,14,0)']
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
    [0, '#4a535e'], [0.4, PAL.stone], [1, '#12161c']
  ]);
  ctx.fillRect(lx, colTop - 6, lw, 14);
  ctx.fillStyle = 'rgba(158,176,200,0.30)';
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
      ? TL_grad(ctx, 'ggwl'+gk, 0, -bodyH, 0, 0, [[0, '#3a424c'], [1, '#0c1015']])
      : TL_grad(ctx, 'ggwr'+gk, 0, -bodyH, 0, 0, [[0, '#262c34'], [1, '#080b10']]);
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
      ctx.strokeStyle = 'rgba(154,172,198,0.30)'; ctx.lineWidth = 1.4;
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
    [0, '#474f5a'], [0.45, PAL.stone], [1, '#10141a']
  ]);
  ctx.fill();
  // a century of soot and acid rain: pitting on the stone, and the dark runnel
  // the rain has cut down the middle of the chest
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.34, 0);
  ctx.bezierCurveTo(-bodyW * 0.42, -bodyH * 0.34, -bodyW * 0.36, -bodyH * 0.58, -bodyW * 0.18, -bodyH * 0.66);
  ctx.lineTo(bodyW * 0.18, -bodyH * 0.66);
  ctx.bezierCurveTo(bodyW * 0.36, -bodyH * 0.58, bodyW * 0.42, -bodyH * 0.34, bodyW * 0.34, 0);
  ctx.closePath();
  ctx.clip();
  for (let i = 0; i < 9; i++) {
    const px = (TL_rnd(i * 13 + 2) - 0.5) * bodyW * 0.7;
    const py = -TL_rnd(i * 7 + 5) * bodyH * 0.62;
    ctx.fillStyle = TL_rnd(i * 3) > 0.66 ? 'rgba(164,180,202,0.10)' : 'rgba(0,0,0,0.30)';
    ctx.fillRect(px, py, 1.4, 1.2);
  }
  ctx.fillStyle = TL_grad(ctx, 'ggsoot' + gk, 0, -bodyH * 0.66, 0, 0, [
    [0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0.26)'], [1, 'rgba(0,0,0,0.46)']
  ]);
  ctx.fillRect(-bodyW * 0.5, -bodyH * 0.7, bodyW, bodyH * 0.72);
  ctx.restore();
  // chest shading + rim
  ctx.strokeStyle = 'rgba(158,176,200,0.24)'; ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.34, 0);
  ctx.bezierCurveTo(-bodyW * 0.42, -bodyH * 0.34, -bodyW * 0.36, -bodyH * 0.58, -bodyW * 0.18, -bodyH * 0.66);
  ctx.stroke();

  // head
  const hy = -bodyH * 0.76, hr = bodyW * 0.27;
  ctx.beginPath();
  ctx.ellipse(0, hy, hr, hr * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = TL_grad(ctx, 'gghead'+gk, -hr, hy - hr, hr, hy + hr, [
    [0, '#525b66'], [0.5, PAL.stone], [1, '#0f1318']
  ]);
  ctx.fill();
  // snout
  ctx.beginPath();
  ctx.moveTo(-hr * 0.5, hy + hr * 0.18);
  ctx.quadraticCurveTo(0, hy + hr * 1.15, hr * 0.5, hy + hr * 0.18);
  ctx.closePath();
  ctx.fillStyle = '#1a1f26'; ctx.fill();
  // fangs
  ctx.fillStyle = 'rgba(176,186,200,0.50)';
  ctx.beginPath(); ctx.moveTo(-hr * 0.22, hy + hr * 0.62); ctx.lineTo(-hr * 0.08, hy + hr * 0.60); ctx.lineTo(-hr * 0.16, hy + hr * 0.92); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hr * 0.22, hy + hr * 0.62); ctx.lineTo(hr * 0.08, hy + hr * 0.60); ctx.lineTo(hr * 0.16, hy + hr * 0.92); ctx.closePath(); ctx.fill();
  // horns
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    ctx.beginPath();
    ctx.moveTo(sgn * hr * 0.55, hy - hr * 0.45);
    ctx.quadraticCurveTo(sgn * hr * 1.25, hy - hr * 1.15, sgn * hr * 1.5, hy - hr * 2.0);
    ctx.quadraticCurveTo(sgn * hr * 0.95, hy - hr * 1.10, sgn * hr * 0.28, hy - hr * 0.78);
    ctx.closePath();
    ctx.fillStyle = sgn < 0 ? '#3f4751' : '#1d2228';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  // ember eyes -- flicker deterministically on t
  const flick = 0.62 + 0.38 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1.3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const ex = sgn * hr * 0.40, ey = hy - hr * 0.05;
    ctx.globalAlpha = 0.13 + flick * 0.20;
    ctx.fillStyle = TL_rgrad(ctx, 'ggeye', 0, 0, 0, 0, 0, 10, [
      [0, 'rgba(255,170,80,1)'], [0.4, 'rgba(214,96,34,0.45)'], [1, 'rgba(170,60,20,0)']
    ]);
    ctx.save(); ctx.translate(ex, ey); ctx.scale(hr * 0.24, hr * 0.24);
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.45 + flick * 0.30;
    ctx.fillStyle = '#e8b480';
    ctx.beginPath(); ctx.ellipse(ex, ey, hr * 0.10, hr * 0.075, 0, 0, Math.PI * 2); ctx.fill();
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
    ctx.fillStyle = sgn < 0 ? '#3c444e' : '#1b2027';
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
    ctx.globalAlpha = 0.12 / k;
    ctx.strokeStyle = k === 1 ? 'rgba(226,200,150,0.75)' : 'rgba(152,172,206,0.6)';
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

  // Gunmetal with a few counts of brass in it, not a gold coin. The pickup
  // carries its own point light, and the specular pass puts the shine back.
  const metal = TL_grad(ctx, 'btrg' + Math.round(r), -r, -r, r, r, [
    [0, '#aab0b2'], [0.18, '#7e8184'], [0.42, '#4a4e54'], [0.58, '#262a30'],
    [0.76, '#8a8578'], [1, '#14171b']
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
    [0, 'rgba(210,222,238,0.10)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.55)']
  ]);
  ctx.fill();
  ctx.restore();

  // bright leading-edge specular
  ctx.strokeStyle = 'rgba(214,224,236,0.62)';
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
  ctx.fillStyle = '#0d1014'; ctx.fill();
  ctx.beginPath(); ctx.arc(-r * 0.05, -r * 0.11, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(190,200,214,0.45)'; ctx.fill();
  ctx.restore();

  // travelling glint across the blades
  const gl = (Math.sin(angle * 2.0) + 1) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22 + gl * 0.44;
  ctx.fillStyle = TL_rgrad(ctx, 'btglint', 0, 0, 0, 0, 0, 12, [
    [0, 'rgba(255,250,232,1)'], [0.4, 'rgba(240,214,152,0.32)'], [1, 'rgba(230,196,120,0)']
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
  ctx.globalAlpha = 0.17 + pulse * 0.19;
  ctx.fillStyle = TL_rgrad(ctx, 'bsaura' + Math.round(s), 0, 0, s * 0.18, 0, 0, s * 1.05, [
    [0, 'rgba(226,110,96,0.70)'], [0.45, 'rgba(176,52,46,0.24)'], [1, 'rgba(120,18,22,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, s * 1.05, 0, Math.PI * 2); ctx.fill();
  // rising energy motes
  for (let i = 0; i < 6; i++) {
    const ph = (t * 0.55 + TL_rnd(i * 17)) % 1;
    const mx = (TL_rnd(i * 5 + 3) - 0.5) * s * 0.85;
    const my = s * 0.5 - ph * s * 1.15;
    ctx.globalAlpha = (1 - ph) * 0.38;
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
  ctx.strokeStyle = 'rgba(158,176,202,0.42)'; ctx.lineWidth = 1.5;
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
    [0, '#e8d898'], [0.5, '#c6a53c'], [1, '#6f5716']
  ]);
  ctx.shadowColor = 'rgba(224,180,64,0.55)'; ctx.shadowBlur = s * 0.14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(120,88,6,0.7)'; ctx.lineWidth = 1; ctx.stroke();

  TL_batPath(ctx, 0, -ph2 * 0.10, pw * 0.62);
  ctx.fillStyle = PAL.batLo; ctx.fill();

  // glass specular sweep over the emblem
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, -ph2 * 0.10, pw * 0.34, ph2 * 0.24, 0, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = 'rgba(214,226,240,0.7)';
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
  ctx.globalAlpha = 0.30 + pulse * 0.26;
  ctx.fillStyle = TL_rgrad(ctx, 'bsthalo' + Math.round(s), 0, 0, s * 0.10, 0, 0, s * 1.15, [
    [0, 'rgba(255,250,224,0.92)'], [0.25, 'rgba(238,202,110,0.40)'],
    [0.6, 'rgba(196,146,48,0.12)'], [1, 'rgba(210,164,60,0)']
  ]);
  ctx.beginPath(); ctx.arc(0, 0, s * 1.15, 0, Math.PI * 2); ctx.fill();

  // rotating starburst rays -- two counter-rotating sets
  for (let set = 0; set < 2; set++) {
    const n = set === 0 ? 8 : 12;
    const rot = t * (set === 0 ? 0.9 : -0.55);
    const len = s * (set === 0 ? 0.86 : 0.62) * (0.86 + pulse * 0.18);
    const wdt = set === 0 ? 0.085 : 0.045;
    ctx.globalAlpha = set === 0 ? 0.30 + pulse * 0.20 : 0.16 + pulse * 0.13;
    ctx.fillStyle = TL_grad(ctx, 'bstray' + set + Math.round(s), 0, 0, len, 0, [
      [0, 'rgba(255,250,230,0.90)'], [0.35, 'rgba(236,200,106,0.36)'], [1, 'rgba(214,166,58,0)']
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
  ctx.globalAlpha = 0.34 + pulse * 0.30;
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
