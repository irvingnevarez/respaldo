// NOTE ON LIGHTNING: every term below that scales with L was authored when
// the post chain ran at exposure 1.30. The grade rework took it to 1.95 and a
// strike began blowing the entire frame to flat white — silhouettes and all.
// They are scaled to match; if exposure moves again, these move with it.
// =====================================================================
//  environment.js  --  Gotham backdrop  (prefix: ENV_)
//  Sky, moon, bat-signal, three parallax skyline layers, smog, vignette.
//  Everything drawn with Canvas2D primitives. Deterministic: all motion
//  is a function of the passed-in time `t`; all "randomness" is hashed.
// =====================================================================

// ---------- deterministic pseudo-random ------------------------------
function ENV_rnd(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function ENV_rnd2(n, k) {
  const s = Math.sin(n * 269.5 + k * 183.3 + 71.7) * 27183.1234;
  return s - Math.floor(s);
}

// ---------- gradient cache (keyed to the ctx that made them) ---------
let ENV_C = { ctx: null, rad: {}, lin: {} };
function ENV_cache(ctx) {
  if (ENV_C.ctx !== ctx) ENV_C = { ctx: ctx, rad: {}, lin: {} };
  return ENV_C;
}
// unit radial gradient centred on 0,0 radius 1 -- scale it with transforms
function ENV_radial(ctx, key, stops) {
  const c = ENV_cache(ctx);
  let g = c.rad[key];
  if (!g) {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    c.rad[key] = g;
  }
  return g;
}
function ENV_linear(ctx, key, x0, y0, x1, y1, stops) {
  const c = ENV_cache(ctx);
  let g = c.lin[key];
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    c.lin[key] = g;
  }
  return g;
}
// soft elliptical puff using the cached unit radial
function ENV_puff(ctx, key, x, y, rx, ry, stops, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  ctx.fillStyle = ENV_radial(ctx, key, stops);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function ENV_poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

// ---------- the bat emblem (used faintly in the sky) -----------------
function ENV_batPath(ctx, cx, cy, w) {
  const s = w / 150;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.bezierCurveTo(6, -30, 22, -34, 30, -24);
  ctx.bezierCurveTo(28, -16, 34, -12, 44, -14);
  ctx.bezierCurveTo(62, -18, 76, -8, 74, 6);
  ctx.bezierCurveTo(64, 0, 56, 2, 52, 10);
  ctx.lineTo(58, 26);
  ctx.lineTo(40, 16);
  ctx.bezierCurveTo(30, 12, 18, 16, 12, 26);
  ctx.lineTo(0, 44);
  ctx.lineTo(-12, 26);
  ctx.bezierCurveTo(-18, 16, -30, 12, -40, 16);
  ctx.lineTo(-58, 26);
  ctx.lineTo(-52, 10);
  ctx.bezierCurveTo(-56, 2, -64, 0, -74, 6);
  ctx.bezierCurveTo(-76, -8, -62, -18, -44, -14);
  ctx.bezierCurveTo(-34, -12, -28, -16, -30, -24);
  ctx.bezierCurveTo(-22, -34, -6, -30, 0, -14);
  ctx.closePath();
  ctx.restore();
}

// =====================================================================
//  SKY
// =====================================================================
function drawGothamSky(ctx, camX, t, lightning) {
  const L = lightning || 0;
  ctx.save();

  // --- base vertical gradient -----------------------------------------
  // Neutral slate, not navy. PAL was moved to cold steel a while back but the
  // sky kept its own hardcoded purples, so the palette change never reached the
  // thing that occupies two thirds of every frame — the whole picture still
  // graded blue. The ramp now runs near-black at the zenith to a desaturated
  // slate at the cloud base, which is where the city's own glow lands.
  const sky = ENV_linear(ctx, 'sky', 0, 0, 0, CH, [
    [0.00, PAL.skyTop],
    [0.24, '#1e252c'],
    [0.46, PAL.skyMid],
    [0.70, PAL.skyLow],
    [0.86, '#525c65'],
    [1.00, '#5d666e']
  ]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH);

  // --- stars (deterministic, twinkling) --------------------------------
  // Few, and faint. A city throwing this much light into low cloud washes out
  // all but the brightest handful; a full field of 150 twinkling points is the
  // single most "illustrated" thing a night sky can do.
  const starPar = camX * 0.012;
  ctx.fillStyle = PAL.white;
  for (let i = 0; i < 46; i++) {
    const sx = ((ENV_rnd(i) * 2400) - starPar) % 2400;
    const x = sx < 0 ? sx + 2400 : sx;
    if (x > CW + 4) continue;
    const y = ENV_rnd2(i, 7) * 300 + 4;
    const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + ENV_rnd2(i, 3) * 2.4) + i * 1.7);
    const a = (0.06 + 0.30 * tw) * (1 - y / 380);
    if (a <= 0.01) continue;
    const r = 0.6 + ENV_rnd2(i, 11) * 1.1;
    ctx.globalAlpha = a;
    ctx.fillRect(x, y, r, r);
    if (r > 1.4) {
      ctx.globalAlpha = a * 0.28;
      ctx.fillRect(x - 1.6, y + r * 0.5 - 0.3, 4.4, 0.7);
      ctx.fillRect(x + r * 0.5 - 0.3, y - 1.6, 0.7, 4.4);
    }
  }
  ctx.globalAlpha = 1;

  // --- the moon --------------------------------------------------------
  const mper = 3000;
  let mx = 706 - (camX * 0.02) % mper;
  if (mx < -320) mx += mper;
  const my = 104;
  const mr = 42;

  // wide atmospheric halo
  ENV_puff(ctx, 'moonHaloFar', mx, my, mr * 7.4, mr * 6.2, [
    [0, 'rgba(158,172,188,0.26)'], [0.4, 'rgba(118,130,146,0.11)'],
    [0.72, 'rgba(80,90,104,0.04)'], [1, 'rgba(70,80,94,0)']
  ], 0.85);
  ENV_puff(ctx, 'moonHalo', mx, my, mr * 2.9, mr * 2.9, [
    [0, 'rgba(228,234,240,0.50)'], [0.35, 'rgba(186,196,208,0.21)'],
    [1, 'rgba(166,178,192,0)']
  ], 0.95);

  // disc with a shaded limb
  const mg = ENV_linear(ctx, 'moonDisc', -1, -1, 1, 1, [
    [0, '#ffffff'], [0.42, PAL.moon], [0.78, '#b9c0d4'], [1, '#8c93ad']
  ]);
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale(mr, mr);
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  // craters
  ctx.fillStyle = '#000000';
  const cr = [[-0.30, -0.24, 0.22], [0.26, -0.06, 0.15], [-0.06, 0.36, 0.19],
              [0.44, 0.40, 0.11], [-0.50, 0.24, 0.10], [0.08, -0.48, 0.09]];
  for (let i = 0; i < cr.length; i++) {
    ctx.globalAlpha = 0.055 + (i % 3) * 0.022;
    ctx.beginPath();
    ctx.arc(cr[i][0], cr[i][1], cr[i][2], 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.05;
    ctx.beginPath();
    ctx.arc(cr[i][0] - cr[i][2] * 0.22, cr[i][1] - cr[i][2] * 0.22, cr[i][2] * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#000000';
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- drifting cloud deck ---------------------------------------------
  // Two-tone, and that is the whole point. A cloud lit from below by a city is
  // DARK on top and PALE underneath, and a flat puff — one colour, symmetric
  // falloff — is why the old sky read as a painted backdrop. Each band is now
  // a dark mass with a separate, lower, brighter belly stacked under it, so the
  // deck has a direction of light instead of just a shape.
  const cloudStops = [
    [0, 'rgba(50,58,68,0.60)'], [0.45, 'rgba(38,45,54,0.32)'],
    [0.8, 'rgba(28,34,41,0.09)'], [1, 'rgba(24,29,36,0)']
  ];
  const bellyStops = [
    [0, 'rgba(126,140,154,0.34)'], [0.5, 'rgba(96,110,124,0.13)'], [1, 'rgba(80,92,106,0)']
  ];
  for (let i = 0; i < 11; i++) {
    const span = 1600;
    const speed = 5 + ENV_rnd(i) * 13;
    let cx = ((ENV_rnd2(i, 5) * span) + t * speed - camX * 0.03) % span;
    if (cx < 0) cx += span;
    cx -= 220;
    if (cx > CW + 260) continue;
    const cy = 40 + ENV_rnd2(i, 9) * 250;
    const rx = 110 + ENV_rnd2(i, 13) * 170;
    const ry = 9 + ENV_rnd2(i, 17) * 14;
    const a = 0.24 + ENV_rnd2(i, 19) * 0.30;
    // underlit belly first, so the dark mass settles on top of it
    ENV_puff(ctx, 'cloudBelly', cx + rx * 0.08, cy + ry * 0.85, rx * 0.88, ry * 0.72,
      bellyStops, a * (0.5 + ENV_rnd2(i, 23) * 0.5));
    ENV_puff(ctx, 'cloud', cx, cy, rx, ry, cloudStops, a);
    ENV_puff(ctx, 'cloud', cx + rx * 0.45, cy + ry * 0.55, rx * 0.62, ry * 0.8, cloudStops, a * 0.7);
  }

  // --- bat-signal beam -------------------------------------------------
  const pulse = 0.62 + 0.38 * Math.sin(t * 0.75) + 0.05 * Math.sin(t * 3.1);
  const bx = -150 - camX * 0.03 % 40;
  const by = CH + 30;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(bx, by);
  ctx.rotate(-Math.PI * 0.345);
  const beam = ENV_linear(ctx, 'beam', 0, 0, 900, 0, [
    [0, 'rgba(245,197,24,0.30)'], [0.25, 'rgba(240,190,40,0.16)'],
    [0.62, 'rgba(220,175,60,0.07)'], [1, 'rgba(200,160,70,0)']
  ]);
  ctx.globalAlpha = 0.55 * pulse;
  ctx.fillStyle = beam;
  ENV_poly(ctx, [0, -10, 920, -190, 920, 190, 0, 10]);
  ctx.fill();
  // hot inner core
  const core = ENV_linear(ctx, 'beamCore', 0, 0, 760, 0, [
    [0, 'rgba(255,240,190,0.34)'], [0.4, 'rgba(245,205,70,0.11)'], [1, 'rgba(240,200,80,0)']
  ]);
  ctx.globalAlpha = 0.6 * pulse;
  ctx.fillStyle = core;
  ENV_poly(ctx, [0, -4, 780, -66, 780, 66, 0, 4]);
  ctx.fill();
  ctx.restore();

  // emblem burnt faintly into the cloud deck at the head of the beam
  const ex = bx + Math.cos(-Math.PI * 0.345) * 820;
  const ey = by + Math.sin(-Math.PI * 0.345) * 820;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ENV_puff(ctx, 'sigGlow', ex, ey, 150, 112, [
    [0, 'rgba(245,197,24,0.26)'], [0.5, 'rgba(220,175,50,0.10)'], [1, 'rgba(200,160,60,0)']
  ], 0.85 * pulse);
  ctx.globalAlpha = 0.30 * pulse;
  ctx.fillStyle = 'rgba(250,225,150,0.9)';
  ctx.beginPath();
  ctx.ellipse(ex, ey, 96, 72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.34 * pulse;
  ctx.fillStyle = '#12101c';
  ENV_batPath(ctx, ex, ey - 6, 150);
  ctx.fill();
  ctx.globalAlpha = 0.16 * pulse;
  ctx.strokeStyle = PAL.yellow;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // --- sodium-vapour city glow bleeding up from the horizon -------------
  // The glow runs cold high up and WARMS as it nears the rooftops. That hue
  // split is what sells an expensive night exterior: the sky is one
  // temperature, the light the city makes is another, and the eye reads the
  // difference as distance. A single blue-grey ramp — which is what this was —
  // flattens the two together and the whole frame goes monochrome navy.
  const glow = ENV_linear(ctx, 'horizon', 0, CH * 0.42, 0, CH, [
    [0, 'rgba(44,56,68,0)'],
    [0.34, 'rgba(66,80,94,0.32)'],
    [0.62, 'rgba(100,112,118,0.40)'],
    [0.84, 'rgba(140,142,132,0.44)'],
    [1, 'rgba(172,164,140,0.50)']
  ]);
  ctx.fillStyle = glow;
  ctx.fillRect(0, CH * 0.42, CW, CH * 0.58);

  // hot pools of sodium light along the horizon line
  for (let i = 0; i < 6; i++) {
    let gx = ((i * 230 + ENV_rnd(i + 40) * 160) - camX * 0.06) % 1380;
    if (gx < -260) gx += 1380;
    if (gx > CW + 260) continue;
    ENV_puff(ctx, 'sodium', gx, 452, 250, 96, [
      [0, 'rgba(206,176,122,0.26)'], [0.45, 'rgba(158,132,92,0.12)'], [1, 'rgba(120,100,72,0)']
    ], 0.55 + 0.12 * Math.sin(t * 0.5 + i));
  }

  // --- lightning wash ---------------------------------------------------
  if (L > 0.001) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(112,134,190,' + (L * 0.042).toFixed(3) + ')';
    ctx.fillRect(0, 0, CW, CH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(214,228,255,' + (L * 0.012).toFixed(3) + ')';
    ctx.fillRect(0, 0, CW, CH);
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}

// =====================================================================
//  SKYLINE
// =====================================================================

// Returns a flat [x,y,x,y,...] silhouette for building style `st`.
function ENV_silhouette(x, y0, w, h, st) {
  const T = y0 - h;
  if (st === 0) {              // art-deco stepped ziggurat
    return [x, y0, x, y0 - h * 0.55, x + w * 0.10, y0 - h * 0.55,
      x + w * 0.10, y0 - h * 0.78, x + w * 0.26, y0 - h * 0.78,
      x + w * 0.26, y0 - h * 0.93, x + w * 0.50, T,
      x + w * 0.74, y0 - h * 0.93, x + w * 0.74, y0 - h * 0.78,
      x + w * 0.90, y0 - h * 0.78, x + w * 0.90, y0 - h * 0.55,
      x + w, y0 - h * 0.55, x + w, y0];
  }
  if (st === 1) {              // gothic cathedral spire + corner needles
    return [x, y0, x, y0 - h * 0.70,
      x + w * 0.06, y0 - h * 0.70, x + w * 0.13, y0 - h * 0.87, x + w * 0.20, y0 - h * 0.70,
      x + w * 0.35, y0 - h * 0.70, x + w * 0.50, T, x + w * 0.65, y0 - h * 0.70,
      x + w * 0.80, y0 - h * 0.70, x + w * 0.87, y0 - h * 0.87, x + w * 0.94, y0 - h * 0.70,
      x + w, y0 - h * 0.70, x + w, y0];
  }
  if (st === 2) {              // slab tower with an overhanging cornice
    return [x, y0, x, y0 - h * 0.95, x - w * 0.06, y0 - h * 0.95,
      x - w * 0.06, T, x + w * 1.06, T, x + w * 1.06, y0 - h * 0.95,
      x + w, y0 - h * 0.95, x + w, y0];
  }
  if (st === 3) {              // clock tower, pitched roof with eaves
    return [x, y0, x, y0 - h * 0.78, x - w * 0.12, y0 - h * 0.78,
      x + w * 0.50, T, x + w * 1.12, y0 - h * 0.78, x + w, y0 - h * 0.78, x + w, y0];
  }
  // st === 4 : twin gothic peaks over a lower nave
  return [x, y0, x, y0 - h * 0.84, x + w * 0.16, T, x + w * 0.32, y0 - h * 0.84,
    x + w * 0.32, y0 - h * 0.60, x + w * 0.68, y0 - h * 0.60,
    x + w * 0.68, y0 - h * 0.84, x + w * 0.84, T, x + w, y0 - h * 0.84, x + w, y0];
}

// lit-window field, drawn clipped to the silhouette
function ENV_windows(ctx, i, x, y0, w, h, tier, t) {
  const cw = tier === 2 ? 5 : (tier === 1 ? 3.6 : 2.6);
  const ch = tier === 2 ? 7 : (tier === 1 ? 5 : 3.4);
  const gx = tier === 2 ? 13 : (tier === 1 ? 9.5 : 7);
  const gy = tier === 2 ? 16 : (tier === 1 ? 12 : 8.5);
  const cols = Math.max(1, Math.floor(w / gx));
  const rows = Math.max(1, Math.floor(h / gy));
  const ox = x + (w - (cols - 1) * gx - cw) * 0.5;
  const density = tier === 2 ? 0.42 : (tier === 1 ? 0.30 : 0.20);
  const baseA = tier === 2 ? 0.95 : (tier === 1 ? 0.68 : 0.40);

  ctx.fillStyle = PAL.bldgWin;
  for (let r = 0; r < rows; r++) {
    const wy = y0 - 10 - r * gy;
    if (wy < y0 - h) break;
    for (let c = 0; c < cols; c++) {
      const k = i * 911 + r * 57 + c * 7;
      const v = ENV_rnd(k);
      if (v > density) continue;
      let a = baseA * (0.55 + ENV_rnd2(k, 3) * 0.45);
      const fl = ENV_rnd2(k, 21);
      if (fl > 0.86) {          // a few bad ballasts flickering
        const s = Math.sin(t * (7 + fl * 9) + k);
        a *= s > 0.25 ? 1 : (s > -0.1 ? 0.30 : 0.06);
      }
      ctx.globalAlpha = a;
      // slight hue split: some windows cold fluorescent
      ctx.fillStyle = ENV_rnd2(k, 31) > 0.82 ? '#bfd6ff' : PAL.bldgWin;
      ctx.fillRect(ox + c * gx, wy, cw, ch);
      if (tier === 2 && a > 0.6) {
        ctx.globalAlpha = a * 0.14;
        ctx.fillRect(ox + c * gx - 2.5, wy - 2.5, cw + 5, ch + 5);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Facade structure, drawn clipped to the silhouette under the window field.
//
// A building is not a flat rectangle with lit windows scattered on it, but
// that is exactly what this skyline was, and it is why the city read as a
// backdrop painted on card. What the eye actually uses to identify masonry at
// distance is the VERTICAL RHYTHM: the piers between window bays catch the sky
// and the recesses between them fall into shadow, so a tower reads as a run of
// narrow stripes long before any individual window is resolvable. Add a
// cornice at the crown and a darker plinth at the street and the shape stops
// being a rectangle and starts being a building.
//
// All of it is a handful of fillRects against a clip that is already set, so
// it costs essentially nothing next to the window field it sits under.
function ENV_facade(ctx, i, x, y0, w, h, tier, gx) {
  const T = y0 - h;
  // piers: one per window bay, lit edge on the left, recess on the right
  const pitch = Math.max(6, gx);
  const nb = Math.floor(w / pitch);
  if (nb > 1 && tier > 0) {
    const lit = tier === 2 ? 0.075 : 0.05;
    for (let c = 0; c <= nb; c++) {
      const px = x + (w * c) / nb;
      ctx.fillStyle = 'rgba(176,192,210,' + lit.toFixed(3) + ')';
      ctx.fillRect(px - 0.9, T, 1.1, h);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(px + 0.3, T, 1.3, h);
    }
  }
  // cornice: a bright lip and the shadow it throws down the wall
  const cb = tier === 2 ? 5 : (tier === 1 ? 3.5 : 2.4);
  ctx.fillStyle = 'rgba(186,202,220,0.16)';
  ctx.fillRect(x - 2, T + 1, w + 4, cb * 0.5);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(x - 2, T + 1 + cb * 0.5, w + 4, cb);
  // a second setback band partway up on the taller forms
  if (h > 150 && ENV_rnd2(i, 61) > 0.45) {
    const sy = T + h * (0.22 + ENV_rnd2(i, 67) * 0.2);
    ctx.fillStyle = 'rgba(176,192,210,0.10)';
    ctx.fillRect(x, sy, w, 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x, sy + 1.6, w, cb * 0.8);
  }
  // plinth: the first two storeys are always darker than the shaft
  const pg = ENV_cache(ctx).lin['plinth' + tier];
  if (pg) { ctx.fillStyle = pg; ctx.fillRect(x - 2, y0 - 46, w + 4, 48); }
}

function ENV_roofDetail(ctx, i, x, y0, w, h, st, tier, t, fill, edge, L) {
  const T = y0 - h;
  ctx.fillStyle = fill;
  // antenna mast + aircraft warning light on tall slabs and spires
  if (st === 2 || st === 0) {
    const mh = 14 + ENV_rnd2(i, 41) * (tier === 2 ? 42 : 26);
    const mx = x + w * (0.25 + ENV_rnd2(i, 43) * 0.5);
    ctx.fillRect(mx - 0.9, T - mh, 1.8, mh);
    ctx.fillRect(mx - 4, T - mh * 0.55, 8, 1.2);
    ctx.fillRect(mx - 2.6, T - mh * 0.78, 5.2, 1.1);
    const blink = Math.sin(t * 2.1 + i * 1.31);
    if (blink > 0.55) {
      const bi = (blink - 0.55) / 0.45;
      ENV_puff(ctx, 'redlamp', mx, T - mh - 1, 9, 9, [
        [0, 'rgba(224,59,59,0.85)'], [0.4, 'rgba(200,40,40,0.30)'], [1, 'rgba(180,30,30,0)']
      ], bi * (tier === 0 ? 0.5 : 0.9));
      ctx.fillStyle = PAL.danger;
      ctx.globalAlpha = 0.5 + bi * 0.5;
      ctx.fillRect(mx - 1.2, T - mh - 2.4, 2.4, 2.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = fill;
    }
  }
  // water tower on the wider mid/near slabs
  if ((st === 2 || st === 0) && tier > 0 && ENV_rnd2(i, 47) > 0.55) {
    const tw = tier === 2 ? 20 : 13;
    const th = tier === 2 ? 16 : 10;
    const tx = x + w * (ENV_rnd2(i, 53) > 0.5 ? 0.68 : 0.16);
    const ty = T;
    ctx.fillRect(tx + tw * 0.12, ty - 4, 2, 4);
    ctx.fillRect(tx + tw * 0.80, ty - 4, 2, 4);
    ENV_poly(ctx, [tx, ty - 4, tx + tw * 0.10, ty - 4 - th, tx + tw * 0.90, ty - 4 - th, tx + tw, ty - 4]);
    ctx.fill();
    ENV_poly(ctx, [tx + tw * 0.10, ty - 4 - th, tx + tw * 0.5, ty - 4 - th * 1.5, tx + tw * 0.90, ty - 4 - th]);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.35 + L * 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, ty - 4 - th * 0.55);
    ctx.lineTo(tx + tw, ty - 4 - th * 0.55);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // clock face
  if (st === 3 && tier > 0) {
    const cx = x + w * 0.5, cy = y0 - h * 0.66, r = Math.min(w * 0.22, 13);
    ctx.globalAlpha = 0.9;
    ENV_puff(ctx, 'clockGlow', cx, cy, r * 3.2, r * 3.2, [
      [0, 'rgba(245,197,24,0.34)'], [0.5, 'rgba(220,170,40,0.10)'], [1, 'rgba(200,160,50,0)']
    ], 0.9);
    ctx.fillStyle = 'rgba(244,224,150,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d0b16';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.stroke();
    // hands: slow, deterministic
    const hh = t * 0.10, mm = t * 0.55;
    ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hh - Math.PI / 2) * r * 0.45, cy + Math.sin(hh - Math.PI / 2) * r * 0.45);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(mm - Math.PI / 2) * r * 0.74, cy + Math.sin(mm - Math.PI / 2) * r * 0.74);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
  }
  // flying buttresses on the cathedral / twin-peak forms
  if (st === 4 && tier === 2) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = 4;
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? x + w * 0.10 : x + w * 0.90;
      const dir = s === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, y0 - h * 0.52);
      ctx.quadraticCurveTo(sx + dir * w * 0.18, y0 - h * 0.30, sx + dir * w * 0.20, y0);
      ctx.stroke();
      ctx.strokeStyle = edge;
      ctx.globalAlpha = 0.20 + L * 0.6;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 4;
    }
  }
  ctx.globalAlpha = 1;
}

function ENV_layer(ctx, camX, t, L, tier) {
  // tier 0 = far, 1 = mid, 2 = near
  const factor = tier === 0 ? 0.08 : (tier === 1 ? 0.22 : 0.45);
  const slot = tier === 0 ? 78 : (tier === 1 ? 116 : 168);
  const baseY = tier === 0 ? 398 : (tier === 1 ? 424 : 462);
  const minH = tier === 0 ? 70 : (tier === 1 ? 110 : 150);
  const maxH = tier === 0 ? 190 : (tier === 1 ? 265 : 330);
  const seed = tier * 1000 + 17;
  const body = tier === 0 ? PAL.bldgFar : (tier === 1 ? PAL.bldgMid : PAL.bldgNear);
  // Neutral, like PAL. These three pairs were the last of the old navy palette
  // and they paint every building in the game, so they outvoted PAL outright.
  const bodyTop = tier === 0 ? '#1b232c' : (tier === 1 ? '#1e2831' : '#232d38');
  const bodyBot = tier === 0 ? '#0a0f14' : (tier === 1 ? '#0c1217' : '#10161c');
  const rimCol = tier === 0 ? 'rgba(132,148,166,' : (tier === 1 ? 'rgba(150,168,186,' : 'rgba(174,192,210,');

  const off = camX * factor;
  const i0 = Math.floor(off / slot) - 2;
  const i1 = i0 + Math.ceil(CW / slot) + 4;

  ctx.save();
  // the darker first-two-storeys band, built once per layer
  const pc = ENV_cache(ctx);
  if (!pc.lin['plinth' + tier]) {
    const g2 = ctx.createLinearGradient(0, baseY - 46, 0, baseY + 2);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(0.45, 'rgba(0,0,0,0.20)');
    g2.addColorStop(1, 'rgba(0,0,0,0.42)');
    pc.lin['plinth' + tier] = g2;
  }
  for (let i = i0; i <= i1; i++) {
    const r0 = ENV_rnd(i + seed);
    const r1 = ENV_rnd2(i + seed, 3);
    const r2 = ENV_rnd2(i + seed, 9);
    const w = slot * (0.62 + r1 * 0.42);
    const x = Math.round(i * slot - off + (slot - w) * 0.5 + (r2 - 0.5) * slot * 0.12);
    if (x > CW + 60 || x + w < -60) continue;
    // Every building drawn from one height band gives a picket fence. A real
    // skyline is mostly even with a few towers well clear of it, and those
    // outliers are what the eye uses to read the whole thing as a city.
    let h = Math.round(minH + r0 * (maxH - minH));
    if (ENV_rnd2(i + seed, 71) > 0.88) h = Math.round(h * (1.35 + ENV_rnd2(i + seed, 73) * 0.5));
    const st = Math.floor(ENV_rnd2(i + seed, 13) * 5) % 5;
    const pts = ENV_silhouette(x, baseY, w, h, st);

    // ---- body: vertical gradient (cached per tier + quantised height) --
    const hk = Math.round(h / 16) * 16;
    const gk = 'b' + tier + '_' + hk;
    const c = ENV_cache(ctx);
    let bg = c.lin[gk];
    if (!bg) {
      bg = ctx.createLinearGradient(0, baseY - hk, 0, baseY);
      bg.addColorStop(0, bodyTop);
      bg.addColorStop(0.30, body);
      bg.addColorStop(1, bodyBot);
      c.lin[gk] = bg;
    }
    ENV_poly(ctx, pts);
    ctx.fillStyle = bg;
    ctx.fill();

    // ---- interior shading + window field, clipped to the silhouette ----
    ctx.save();
    ctx.clip();
    // one side falls away into shadow
    const sk = 's' + tier + '_' + Math.round(w / 12) * 12;
    let sg = c.lin[sk];
    if (!sg) {
      sg = ctx.createLinearGradient(0, 0, Math.round(w / 12) * 12 || 12, 0);
      sg.addColorStop(0, 'rgba(136,152,170,0.11)');
      sg.addColorStop(0.22, 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(0,0,0,0.42)');
      c.lin[sk] = sg;
    }
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillStyle = sg;
    ctx.fillRect(0, baseY - h - 60, w + 2, h + 62);
    ctx.restore();

    // faint floor banding on the front layers
    if (tier > 0) {
      ctx.globalAlpha = tier === 2 ? 0.16 : 0.10;
      ctx.fillStyle = '#000000';
      const step = tier === 2 ? 16 : 12;
      for (let yy = baseY - 6; yy > baseY - h; yy -= step) ctx.fillRect(x - 4, yy, w + 8, 1);
      ctx.globalAlpha = 1;
    }
    // structure first, lit windows on top of it
    ENV_facade(ctx, i + seed, x, baseY, w, h, tier,
      tier === 2 ? 13 : (tier === 1 ? 9.5 : 7));
    ENV_windows(ctx, i + seed, x, baseY, w, h, tier, t);
    ctx.restore();

    // ---- edge rim light ------------------------------------------------
    ENV_poly(ctx, pts);
    ctx.strokeStyle = rimCol + (0.10 + L * 0.22).toFixed(3) + ')';
    ctx.lineWidth = tier === 2 ? 1.6 : 1.1;
    ctx.stroke();
    if (L > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(200,220,255,' + (L * 0.28).toFixed(3) + ')';
      ctx.lineWidth = tier === 2 ? 2.6 : 1.8;
      ctx.stroke();
      ctx.restore();
    }

    ENV_roofDetail(ctx, i + seed, x, baseY, w, h, st, tier, t, bodyBot, rimCol + '0.5)', L);
  }

  // ---- haze sitting on top of the layer, pushing it back ---------------
  // Aerial perspective, pushed hard. This is the single effect that makes a
  // frame read as "deep" rather than "flat": each layer further back is washed
  // further toward the sky's value, so the near playfield reads dark against a
  // pale, misty city instead of every layer sharing one muddy blue.
  // Eased back from 0.92/0.66/0.34. Those were set while the grade was
  // crushing the frame, so the haze had to shout to survive; at a correct
  // exposure the same numbers turn the whole city into milk and the playfield
  // loses its separation from the backdrop.
  const hz = tier === 0 ? 0.78 : (tier === 1 ? 0.52 : 0.25);
  // tall enough to cover the hero towers too: a spire poking out above the
  // haze band keeps its full contrast and instantly breaks the depth read
  const hTop = baseY - maxH * 1.9;
  const hk2 = 'haze' + tier;
  let hg = ENV_cache(ctx).lin[hk2];
  if (!hg) {
    hg = ctx.createLinearGradient(0, hTop, 0, baseY + 20);
    hg.addColorStop(0, 'rgba(80,90,102,0)');
    hg.addColorStop(0.55, 'rgba(100,110,120,' + (hz * 0.66).toFixed(3) + ')');
    // the bottom of the haze sits in the sodium band, so it warms to match
    hg.addColorStop(1, 'rgba(146,146,138,' + hz.toFixed(3) + ')');
    ENV_cache(ctx).lin[hk2] = hg;
  }
  ctx.fillStyle = hg;
  ctx.fillRect(0, hTop, CW, baseY + 20 - hTop);

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}

function drawGothamSkyline(ctx, camX, t, lightning) {
  const L = lightning || 0;
  ctx.save();
  ENV_layer(ctx, camX, t, L, 0);
  ENV_layer(ctx, camX, t, L, 1);
  ENV_layer(ctx, camX, t, L, 2);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}

// =====================================================================
//  SMOG BANDS
// =====================================================================
function drawCityFog(ctx, camX, t) {
  ctx.save();
  // Smog is grey. The old bands were frankly violet, which put a magenta cast
  // over the entire lower third of the frame — the one place the player is
  // actually looking. One band in three stays warm, because sodium light does
  // tint the smoke it passes through, but it is now dirt-amber rather than
  // traffic-cone orange.
  const stops = [
    [0, 'rgba(118,128,140,0.40)'], [0.4, 'rgba(92,101,112,0.21)'],
    [0.75, 'rgba(70,78,88,0.07)'], [1, 'rgba(62,69,79,0)']
  ];
  const warm = [
    [0, 'rgba(178,142,94,0.28)'], [0.45, 'rgba(142,112,74,0.13)'], [1, 'rgba(112,88,58,0)']
  ];
  const span = 1500;
  for (let i = 0; i < 14; i++) {
    const drift = t * (5 + ENV_rnd(i) * 16) - camX * 0.6 * (0.5 + ENV_rnd2(i, 3) * 0.6);
    let x = ((ENV_rnd2(i, 7) * span) + drift) % span;
    if (x < 0) x += span;
    x -= 270;
    if (x > CW + 300) continue;
    const y = 388 + ENV_rnd2(i, 11) * 106 + Math.sin(t * 0.4 + i * 1.7) * 5;
    const rx = 150 + ENV_rnd2(i, 13) * 210;
    const ry = 11 + ENV_rnd2(i, 17) * 20;
    const a = 0.16 + ENV_rnd2(i, 19) * 0.26;
    ENV_puff(ctx, i % 3 === 0 ? 'fogWarm' : 'fogCool', x, y, rx, ry,
      i % 3 === 0 ? warm : stops, a);
    ENV_puff(ctx, i % 3 === 0 ? 'fogWarm' : 'fogCool', x + rx * 0.5, y + ry * 0.7,
      rx * 0.6, ry * 0.75, i % 3 === 0 ? warm : stops, a * 0.62);
  }
  // a settled ground-level sheet
  const sheet = ENV_linear(ctx, 'fogSheet', 0, 400, 0, 520, [
    [0, 'rgba(112,120,132,0)'], [0.45, 'rgba(108,116,128,0.15)'], [1, 'rgba(88,96,108,0.05)']
  ]);
  ctx.fillStyle = sheet;
  ctx.fillRect(0, 400, CW, 120);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}

// =====================================================================
//  VIGNETTE
// =====================================================================
function drawForegroundVignette(ctx, lightning) {
  const L = lightning || 0;
  ctx.save();
  const c = ENV_cache(ctx);
  let vg = c.lin['vig'];
  if (!vg) {
    vg = ctx.createRadialGradient(CW * 0.5, CH * 0.46, CH * 0.24, CW * 0.5, CH * 0.5, CW * 0.74);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.52, 'rgba(4,4,12,0.14)');
    vg.addColorStop(0.80, 'rgba(3,3,10,0.42)');
    vg.addColorStop(1, 'rgba(2,2,8,0.72)');
    c.lin['vig'] = vg;
  }
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);

  const wash = ENV_linear(ctx, 'wash', 0, 0, 0, CH, [
    [0, 'rgba(136,152,170,0.12)'], [0.30, 'rgba(118,132,148,0.05)'],
    [0.68, 'rgba(18,22,27,0.06)'], [1, 'rgba(6,9,12,0.26)']
  ]);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CW, CH);

  if (L > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(150,175,230,' + (L * 0.009).toFixed(3) + ')';
    ctx.fillRect(0, 0, CW, CH);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore();
}
