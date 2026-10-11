// ============================================================================
// MODULE: enemies  (prefix EN_)
// Batman-themed Mario-style platformer enemy renderers.
// Pure Canvas2D primitives -- no images, no libraries.
// ============================================================================

// ---- deterministic pseudo-random ------------------------------------------
function EN_rnd(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---- tiny gradient cache ---------------------------------------------------
// NOTE: `key` MUST encode every value that varies the *color stops* (alpha,
// glow pulse, ...). The cache only hashes geometry, so a key that ignores a
// varying stop value silently freezes that animation on its first frame.
const EN_gcache = Object.create(null);
let EN_gcacheN = 0;
// quantise a continuously-varying stop value into a small bounded set of
// key buckets, so animated gradients still cache instead of churning.
function EN_qz(v, steps) { return Math.round((v || 0) * steps) / steps; }
function EN_linGrad(ctx, key, x0, y0, x1, y1, stops) {
  // NOTE: canvas gradients are position-bound, so we cache per rounded geometry.
  const k = key + '|' + (x0 | 0) + ',' + (y0 | 0) + ',' + (x1 | 0) + ',' + (y1 | 0);
  let g = EN_gcache[k];
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    EN_gcache[k] = g;
    // keep the cache from growing without bound
    if (++EN_gcacheN > 400) { EN_gcacheClear(); }
  }
  return g;
}
function EN_gcacheClear() {
  for (const k in EN_gcache) delete EN_gcache[k];
  EN_gcacheN = 0;
}

function EN_radGrad(ctx, key, x0, y0, r0, x1, y1, r1, stops) {
  const k = key + '|' + (x0 | 0) + ',' + (y0 | 0) + ',' + (r0 | 0) + ',' + (x1 | 0) + ',' + (y1 | 0) + ',' + (r1 | 0);
  let g = EN_gcache[k];
  if (!g) {
    g = ctx.createRadialGradient(x0, y0, Math.max(0.01, r0), x1, y1, Math.max(0.02, r1));
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    EN_gcache[k] = g;
    if (++EN_gcacheN > 400) { EN_gcacheClear(); }
  }
  return g;
}

// ---- small geometry helpers ------------------------------------------------
function EN_roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  if (ctx.roundRect) {
    try { ctx.roundRect(x, y, w, h, rr); return; } catch (e) { /* fall through */ }
  }
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

function EN_ellipse(ctx, cx, cy, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, Math.PI * 2);
}

// soft elliptical ground-contact shadow
function EN_groundShadow(ctx, cx, cy, rx, ry, alpha) {
  ctx.save();
  const a = EN_qz(alpha, 20);
  const R = Math.max(0.01, rx, ry);            // never 0 -> no 0/0 in the squash below
  // alpha is part of the key: two call sites with matching geometry but
  // different darkness would otherwise share one (wrong) cached gradient.
  const g = EN_radGrad(ctx, 'gsh' + a, cx, cy, 0, cx, cy, R, [
    [0, 'rgba(0,0,0,' + a.toFixed(2) + ')'],
    [0.55, 'rgba(0,0,0,' + (a * 0.45).toFixed(2) + ')'],
    [1, 'rgba(0,0,0,0)']
  ]);
  ctx.translate(cx, cy);
  ctx.scale(1, Math.max(0.06, ry / R));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// rim light stroke along one side of an already-built path
function EN_rimStroke(ctx, color, width, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// JOKER MINION  (Goomba analogue) -- box ~30x30
// ============================================================================
function drawJokerMinion(ctx, x, y, w, h, o) {
  o = o || {};
  const t = o.animTime || 0;
  const face = o.facingRight === false ? -1 : 1;
  const squashed = !!o.squashed;
  const dying = !!o.dying;

  ctx.save();
  // Draw in entity-local space: makes every cached gradient key position-independent
  // (cache hits instead of rebuilding ~20 gradients per enemy per frame).
  ctx.translate(Math.round(x), Math.round(y));
  x = 0; y = 0;

  if (dying) ctx.globalAlpha = Math.max(0, Math.min(1, 0.85));

  const cx = x + w * 0.5;
  const baseY = y + h;

  if (squashed || dying) {
    EN_minionSquashed(ctx, cx, baseY, w, h, t, face, dying);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  // ---- waddle cycle -------------------------------------------------------
  const cyc = t * 6.2;
  const waddle = Math.sin(cyc);            // -1..1 body tilt
  const bob = Math.abs(Math.sin(cyc)) * h * 0.045;
  const tilt = waddle * 0.13;

  // ground contact shadow (stays put -- does not tilt)
  EN_groundShadow(ctx, cx + waddle * w * 0.06, baseY + 1.5, w * 0.46, w * 0.14, 0.5);

  // ---- legs (drawn before body so body overlaps hips) ---------------------
  const legSwing = Math.sin(cyc) * w * 0.10;
  const hipY = baseY - h * 0.20;
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1;
    const lx = cx + dir * w * 0.17 + (dir === 1 ? legSwing : -legSwing) * 0.5;
    const lh = h * 0.22 - Math.abs(dir === 1 ? legSwing : -legSwing) * 0.35;
    const lg = EN_linGrad(ctx, 'mlg', lx - 4, hipY, lx + 4, hipY, [
      [0, '#1a0f2b'], [0.5, '#3b2358'], [1, '#160d24']
    ]);
    ctx.fillStyle = lg;
    EN_roundRect(ctx, lx - w * 0.085, hipY, w * 0.17, lh + h * 0.02, w * 0.05);
    ctx.fill();
    // shoe
    const sh = EN_linGrad(ctx, 'msh', lx - 6, hipY + lh, lx + 6, hipY + lh + 6, [
      [0, '#2b2b36'], [0.6, '#101018'], [1, '#05050a']
    ]);
    ctx.fillStyle = sh;
    EN_roundRect(ctx, lx - w * 0.12 + face * w * 0.02, hipY + lh - 1, w * 0.22, h * 0.085, w * 0.045);
    ctx.fill();
    // shoe rim highlight
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = PAL.capeHi;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- body (tilted) ------------------------------------------------------
  ctx.save();
  ctx.translate(cx, baseY - h * 0.30);
  ctx.rotate(tilt);
  ctx.translate(-cx, -(baseY - h * 0.30) - bob);

  const bodyTop = y + h * 0.46;
  const bodyBot = baseY - h * 0.16;
  const bw = w * 0.72;

  // jacket silhouette
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.5, bodyBot);
  ctx.quadraticCurveTo(cx - bw * 0.62, bodyTop + (bodyBot - bodyTop) * 0.35, cx - bw * 0.40, bodyTop);
  ctx.lineTo(cx + bw * 0.40, bodyTop);
  ctx.quadraticCurveTo(cx + bw * 0.62, bodyTop + (bodyBot - bodyTop) * 0.35, cx + bw * 0.5, bodyBot);
  ctx.closePath();
  const jg = EN_linGrad(ctx, 'mjk', cx - bw * 0.5, bodyTop, cx + bw * 0.5, bodyBot, [
    [0, '#2a1244'], [0.35, PAL.joker], [0.7, PAL.jokerHi], [1, '#38195c']
  ]);
  ctx.fillStyle = jg;
  ctx.fill();

  // pinstripes (clipped to jacket)
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.30;
  ctx.strokeStyle = '#cbb3ec';
  ctx.lineWidth = 0.7;
  for (let i = -4; i <= 4; i++) {
    const sx = cx + i * (bw * 0.13);
    ctx.beginPath();
    ctx.moveTo(sx - 2, bodyTop - 2);
    ctx.lineTo(sx + 2.5, bodyBot + 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // inner shadow on trailing side
  const sg = EN_linGrad(ctx, 'mjs', cx - face * bw * 0.5, 0, cx + face * bw * 0.5, 0, [
    [0, 'rgba(0,0,0,0.55)'], [0.45, 'rgba(0,0,0,0.0)'], [1, 'rgba(0,0,0,0.28)']
  ]);
  ctx.fillStyle = sg;
  ctx.fillRect(cx - bw, bodyTop - 4, bw * 2, (bodyBot - bodyTop) + 8);
  ctx.restore();

  // green vest triangle
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.22, bodyTop + 0.5);
  ctx.lineTo(cx + bw * 0.22, bodyTop + 0.5);
  ctx.lineTo(cx, bodyBot - (bodyBot - bodyTop) * 0.12);
  ctx.closePath();
  const vg = EN_linGrad(ctx, 'mvs', cx, bodyTop, cx, bodyBot, [
    [0, '#66d14a'], [0.5, PAL.jokerGreen], [1, '#1d5c14']
  ]);
  ctx.fillStyle = vg;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9cf07d';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // lapels
  ctx.fillStyle = 'rgba(12,4,24,0.75)';
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.40, bodyTop);
  ctx.lineTo(cx - bw * 0.10, bodyTop + (bodyBot - bodyTop) * 0.34);
  ctx.lineTo(cx - bw * 0.26, bodyTop + (bodyBot - bodyTop) * 0.40);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.40, bodyTop);
  ctx.lineTo(cx + bw * 0.10, bodyTop + (bodyBot - bodyTop) * 0.34);
  ctx.lineTo(cx + bw * 0.26, bodyTop + (bodyBot - bodyTop) * 0.40);
  ctx.closePath();
  ctx.fill();

  // rim light down the facing edge of the jacket
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + face * bw * 0.40, bodyTop + 1);
  ctx.quadraticCurveTo(cx + face * bw * 0.60, bodyTop + (bodyBot - bodyTop) * 0.4, cx + face * bw * 0.48, bodyBot - 1);
  EN_rimStroke(ctx, '#d9c6ff', 1.3, 0.5);
  ctx.restore();

  // bow tie
  const btY = bodyTop + 1.5;
  ctx.save();
  ctx.translate(cx, btY);
  ctx.rotate(Math.sin(cyc * 0.5) * 0.08);
  const btg = EN_linGrad(ctx, 'mbt', -5, -3, 5, 3, [
    [0, '#ff6a6a'], [0.5, PAL.danger], [1, '#7a1616']
  ]);
  ctx.fillStyle = btg;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-w * 0.13, -h * 0.045); ctx.lineTo(-w * 0.13, h * 0.045); ctx.closePath();
  ctx.moveTo(0, 0); ctx.lineTo(w * 0.13, -h * 0.045); ctx.lineTo(w * 0.13, h * 0.045); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3d0d0d';
  EN_ellipse(ctx, 0, 0, w * 0.032, w * 0.032, 0);
  ctx.fill();
  ctx.restore();

  // ---- head ---------------------------------------------------------------
  const hy = y + h * 0.28;
  const hr = w * 0.30;
  EN_minionHead(ctx, cx, hy, hr, face, t, false);

  ctx.restore(); // body tilt

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}

// Head: hair, chalk face, makeup, sockets, rictus grin
function EN_minionHead(ctx, cx, cy, hr, face, t, flat) {
  ctx.save();

  // --- wild green hair tufts (behind head) --------------------------------
  const tufts = 5;
  for (let i = 0; i < tufts; i++) {
    const base = -1 + (i / (tufts - 1)) * 2;      // -1..1
    const jig = Math.sin(t * 7.5 + i * 1.7) * 0.22 + Math.sin(t * 3.1 + i) * 0.10;
    const ax = cx + base * hr * 0.95;
    const ay = cy - Math.cos(base * 1.2) * hr * 0.55;
    const len = hr * (1.0 + EN_rnd(i * 3 + 1) * 0.6);
    const ang = base * 1.05 + jig;
    const tipX = ax + Math.sin(ang) * len;
    const tipY = ay - Math.cos(ang * 0.65) * len * 0.95;
    ctx.beginPath();
    ctx.moveTo(ax - hr * 0.20, ay + hr * 0.12);
    ctx.bezierCurveTo(
      ax + Math.sin(ang) * len * 0.35 - hr * 0.25, ay - len * 0.45,
      tipX - hr * 0.30, tipY + len * 0.12,
      tipX, tipY
    );
    ctx.bezierCurveTo(
      tipX + hr * 0.22, tipY + len * 0.16,
      ax + Math.sin(ang) * len * 0.30 + hr * 0.26, ay - len * 0.40,
      ax + hr * 0.22, ay + hr * 0.12
    );
    ctx.closePath();
    const hg = EN_linGrad(ctx, 'mhr' + i, ax, ay + hr * 0.2, tipX, tipY, [
      [0, '#123b0c'], [0.45, PAL.jokerGreen], [1, '#8ef06a']
    ]);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#b6ff97';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- face base ------------------------------------------------------------
  const fg = EN_radGrad(ctx, 'mfc', cx - hr * 0.35, cy - hr * 0.45, hr * 0.1, cx, cy, hr * 1.25, [
    [0, '#ffffff'], [0.45, PAL.face], [0.85, '#bfb2a2'], [1, '#8d8274']
  ]);
  EN_ellipse(ctx, cx, cy, hr, hr * (flat ? 0.72 : 1.02), 0);
  ctx.fillStyle = fg;
  ctx.fill();

  // jaw shadow
  ctx.save();
  EN_ellipse(ctx, cx, cy, hr, hr * (flat ? 0.72 : 1.02), 0);
  ctx.clip();
  const jsh = EN_linGrad(ctx, 'mjsh', cx, cy + hr * 0.1, cx, cy + hr * 1.1, [
    [0, 'rgba(40,25,60,0)'], [1, 'rgba(40,25,60,0.55)']
  ]);
  ctx.fillStyle = jsh;
  ctx.fillRect(cx - hr * 1.2, cy - hr * 0.2, hr * 2.4, hr * 2);
  // smeared purple-green eye makeup band
  const mg = EN_linGrad(ctx, 'mmk', cx - hr, cy - hr * 0.35, cx + hr, cy - hr * 0.05, [
    [0, 'rgba(138,92,196,0.0)'], [0.18, 'rgba(138,92,196,0.72)'],
    [0.5, 'rgba(63,160,44,0.45)'], [0.82, 'rgba(138,92,196,0.72)'], [1, 'rgba(138,92,196,0.0)']
  ]);
  ctx.fillStyle = mg;
  ctx.fillRect(cx - hr, cy - hr * 0.48, hr * 2, hr * 0.55);
  // smear drips
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PAL.joker;
  for (let i = 0; i < 3; i++) {
    const dx = cx + (EN_rnd(i * 5 + 2) - 0.5) * hr * 1.4;
    EN_ellipse(ctx, dx, cy - hr * 0.02 + EN_rnd(i * 9) * hr * 0.3, hr * 0.07, hr * 0.22, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- sunken eye sockets ---------------------------------------------------
  const eyeDX = hr * 0.40, eyeY = cy - hr * 0.20;
  for (let i = 0; i < 2; i++) {
    const ex = cx + (i ? eyeDX : -eyeDX) + face * hr * 0.05;
    const sg = EN_radGrad(ctx, 'msk', ex, eyeY, hr * 0.02, ex, eyeY, hr * 0.30, [
      [0, '#000000'], [0.6, '#160c22'], [1, 'rgba(22,12,34,0)']
    ]);
    ctx.fillStyle = sg;
    EN_ellipse(ctx, ex, eyeY, hr * 0.30, hr * 0.26, 0);
    ctx.fill();
    // tiny glinting pupil
    const blink = Math.sin(t * 2.3 + i * 0.4);
    const pr = hr * (0.085 + 0.02 * Math.max(0, blink));
    ctx.fillStyle = PAL.eye;
    EN_ellipse(ctx, ex + face * hr * 0.05, eyeY, pr, pr, 0);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ffffff';
    EN_ellipse(ctx, ex + face * hr * 0.07, eyeY - hr * 0.03, pr * 0.42, pr * 0.42, 0);
    ctx.fill();
    ctx.restore();
    // brow
    ctx.strokeStyle = 'rgba(20,10,30,0.7)';
    ctx.lineWidth = hr * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - hr * 0.26, eyeY - hr * 0.30 + (i ? hr * 0.08 : 0));
    ctx.lineTo(ex + hr * 0.26, eyeY - hr * 0.34 + (i ? 0 : hr * 0.08));
    ctx.stroke();
  }

  // --- rictus grin ----------------------------------------------------------
  EN_minionGrin(ctx, cx, cy + hr * 0.34, hr, t, flat);

  // face rim light on facing edge
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, hr, hr * (flat ? 0.72 : 1.02), 0,
    face > 0 ? -Math.PI * 0.55 : Math.PI * 0.45,
    face > 0 ? Math.PI * 0.45 : Math.PI * 1.45);
  EN_rimStroke(ctx, '#dCEAff', 1.3, 0.72);
  ctx.restore();

  ctx.restore();
}

function EN_minionGrin(ctx, cx, my, hr, t, flat) {
  ctx.save();
  const gw = hr * 1.22;            // grin extends past the mouth
  const gh = hr * (flat ? 0.30 : 0.42);
  // red smeared rictus
  ctx.beginPath();
  ctx.moveTo(cx - gw, my - gh * 0.55);
  ctx.quadraticCurveTo(cx, my + gh * 1.15, cx + gw, my - gh * 0.55);
  ctx.quadraticCurveTo(cx, my + gh * 0.30, cx - gw, my - gh * 0.55);
  ctx.closePath();
  const rg = EN_linGrad(ctx, 'mgr', cx, my - gh, cx, my + gh, [
    [0, '#e8584f'], [0.5, PAL.smile], [1, '#6d1010']
  ]);
  ctx.fillStyle = rg;
  ctx.fill();

  // mouth cavity
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.62, my - gh * 0.10);
  ctx.quadraticCurveTo(cx, my + gh * 0.85, cx + hr * 0.62, my - gh * 0.10);
  ctx.quadraticCurveTo(cx, my + gh * 0.18, cx - hr * 0.62, my - gh * 0.10);
  ctx.closePath();
  ctx.fillStyle = '#2a0508';
  ctx.fill();
  ctx.clip();
  // teeth
  ctx.fillStyle = '#f3efe2';
  const n = 5;
  for (let i = 0; i < n; i++) {
    const tx = cx - hr * 0.56 + (i / n) * hr * 1.12;
    ctx.fillRect(tx, my - gh * 0.18, hr * 0.18, gh * 0.42);
  }
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#7a5a2a';
  ctx.fillRect(cx - hr * 0.7, my + gh * 0.12, hr * 1.4, gh * 0.3);
  ctx.globalAlpha = 1;
  ctx.restore();

  // lipstick smear streaks up the cheeks
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#8e1f1f';
  ctx.lineWidth = hr * 0.07;
  ctx.lineCap = 'round';
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.moveTo(cx + s * gw * 0.92, my - gh * 0.5);
    ctx.quadraticCurveTo(cx + s * gw * 1.10, my - gh * 1.1, cx + s * gw * 0.98, my - gh * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // wet highlight on the lower lip
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#ff9c93';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - gw * 0.65, my + gh * 0.42);
  ctx.quadraticCurveTo(cx, my + gh * 0.95, cx + gw * 0.65, my + gh * 0.42);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function EN_minionSquashed(ctx, cx, baseY, w, h, t, face, dying) {
  ctx.save();
  if (dying) {
    const f = Math.max(0, 1 - (Math.sin(t * 9) * 0.15 + 0.55));
    ctx.globalAlpha = 0.35 + f * 0.5;
  }
  const ph = h * 0.30;
  const py = baseY - ph;

  EN_groundShadow(ctx, cx, baseY + 1, w * 0.62, w * 0.16, 0.55);

  // pancake jacket
  EN_ellipse(ctx, cx, py + ph * 0.72, w * 0.56, ph * 0.40, 0);
  const jg = EN_linGrad(ctx, 'msqj', cx, py + ph * 0.3, cx, py + ph * 1.1, [
    [0, PAL.jokerHi], [0.6, PAL.joker], [1, '#20103a']
  ]);
  ctx.fillStyle = jg;
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#d5bcff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // flattened green hair sprays sideways
  for (let i = 0; i < 6; i++) {
    const s = i < 3 ? -1 : 1;
    const k = (i % 3);
    const hx = cx + s * (w * 0.42 + k * w * 0.07);
    const hy2 = py + ph * 0.32 + (EN_rnd(i * 7) - 0.5) * ph * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.30, py + ph * 0.35);
    ctx.quadraticCurveTo(cx + s * w * 0.42, hy2 - ph * 0.22, hx, hy2);
    ctx.quadraticCurveTo(cx + s * w * 0.40, hy2 + ph * 0.12, cx + s * w * 0.28, py + ph * 0.48);
    ctx.closePath();
    ctx.fillStyle = EN_linGrad(ctx, 'msqh' + i, cx, py, hx, hy2, [
      [0, '#17470f'], [1, '#7ce058']
    ]);
    ctx.fill();
  }

  // flattened face
  const fg = EN_radGrad(ctx, 'msqf', cx - w * 0.12, py + ph * 0.05, 1, cx, py + ph * 0.30, w * 0.5, [
    [0, '#ffffff'], [0.5, PAL.face], [1, '#a2978a']
  ]);
  EN_ellipse(ctx, cx, py + ph * 0.30, w * 0.42, ph * 0.34, 0);
  ctx.fillStyle = fg;
  ctx.fill();

  // X-ed out eyes
  ctx.strokeStyle = '#160c22';
  ctx.lineWidth = Math.max(1.2, w * 0.045);
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const ex = cx + (i ? 1 : -1) * w * 0.16;
    const ey = py + ph * 0.22;
    const r = w * 0.075;
    ctx.beginPath();
    ctx.moveTo(ex - r, ey - r * 0.75); ctx.lineTo(ex + r, ey + r * 0.75);
    ctx.moveTo(ex + r, ey - r * 0.75); ctx.lineTo(ex - r, ey + r * 0.75);
    ctx.stroke();
  }

  // grin still visible, squashed wide
  ctx.save();
  ctx.translate(cx, py + ph * 0.46);
  ctx.scale(1.18, 0.62);
  ctx.translate(-cx, -(py + ph * 0.46));
  EN_minionGrin(ctx, cx, py + ph * 0.48, w * 0.30, t, true);
  ctx.restore();

  // rim light across the top of the pancake
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, py + ph * 0.30, w * 0.42, ph * 0.34, 0, Math.PI * 1.05, Math.PI * 1.95);
  EN_rimStroke(ctx, '#e9f0ff', 1.2, 0.5);
  ctx.restore();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ============================================================================
// PENGUIN HENCHMAN (Koopa analogue) -- box ~30x38
// ============================================================================
function drawPenguinHenchman(ctx, x, y, w, h, o) {
  o = o || {};
  const t = o.animTime || 0;
  const face = o.facingRight === false ? -1 : 1;
  const shell = !!o.shell || !!o.shellSpinning;
  const spinning = !!o.shellSpinning;

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));   // entity-local space (gradient cache)
  x = 0; y = 0;
  const cx = x + w * 0.5;
  const baseY = y + h;

  if (shell) {
    EN_penguinShell(ctx, cx, baseY, w, h, t, face, spinning);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  const cyc = t * 5.4;
  const waddle = Math.sin(cyc);
  const tilt = waddle * 0.10;
  const bob = Math.abs(Math.sin(cyc)) * h * 0.03;

  EN_groundShadow(ctx, cx + waddle * w * 0.08, baseY + 1.5, w * 0.50, w * 0.14, 0.5);

  // ---- webbed feet --------------------------------------------------------
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1;
    const lift = Math.max(0, (dir > 0 ? waddle : -waddle)) * h * 0.05;
    const fx = cx + dir * w * 0.19 + face * w * 0.05;
    const fy = baseY - lift;
    const fgd = EN_linGrad(ctx, 'pft', fx, fy - 4, fx, fy + 3, [
      [0, '#ffb45e'], [0.5, PAL.orange], [1, '#8a4410']
    ]);
    ctx.fillStyle = fgd;
    ctx.beginPath();
    ctx.moveTo(fx - w * 0.11, fy - h * 0.035);
    ctx.lineTo(fx + face * w * 0.18, fy - h * 0.025);
    ctx.quadraticCurveTo(fx + face * w * 0.19, fy, fx + face * w * 0.13, fy);
    ctx.lineTo(fx - w * 0.10, fy);
    ctx.quadraticCurveTo(fx - w * 0.14, fy - h * 0.01, fx - w * 0.11, fy - h * 0.035);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffd9a8';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // toe grooves
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#6b3208';
    for (let k = 1; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(fx + face * w * 0.02 * k, fy - h * 0.03);
      ctx.lineTo(fx + face * (w * 0.06 * k), fy - 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(tilt);
  ctx.translate(-cx, -baseY - bob);

  // ---- body: glossy black tuxedo egg --------------------------------------
  const bTop = y + h * 0.26;
  const bBot = baseY - h * 0.015;
  const brx = w * 0.40;
  ctx.beginPath();
  ctx.moveTo(cx, bTop);
  ctx.bezierCurveTo(cx + brx * 1.10, bTop + (bBot - bTop) * 0.08, cx + brx * 1.05, bBot - (bBot - bTop) * 0.18, cx, bBot);
  ctx.bezierCurveTo(cx - brx * 1.05, bBot - (bBot - bTop) * 0.18, cx - brx * 1.10, bTop + (bBot - bTop) * 0.08, cx, bTop);
  ctx.closePath();
  const bg = EN_linGrad(ctx, 'pbd', cx - brx, bTop, cx + brx, bBot, [
    [0, '#05050a'], [0.30, PAL.peng], [0.62, PAL.pengHi], [0.85, '#191924'], [1, '#07070d']
  ]);
  ctx.fillStyle = bg;
  ctx.fill();

  // soft top sheen
  ctx.save();
  ctx.clip();
  const sheen = EN_radGrad(ctx, 'pshn', cx - face * brx * 0.35, bTop + (bBot - bTop) * 0.18, 1,
    cx - face * brx * 0.35, bTop + (bBot - bTop) * 0.18, brx * 1.2, [
      [0, 'rgba(150,165,210,0.32)'], [0.5, 'rgba(90,105,150,0.10)'], [1, 'rgba(0,0,0,0)']
    ]);
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - brx * 1.4, bTop - 4, brx * 2.8, (bBot - bTop) + 8);
  ctx.restore();

  // white shirt-front oval
  const shx = cx + face * w * 0.02;
  const shy = bTop + (bBot - bTop) * 0.52;
  EN_ellipse(ctx, shx, shy, w * 0.245, (bBot - bTop) * 0.40, 0);
  const wg = EN_radGrad(ctx, 'pws', shx - w * 0.08, shy - (bBot - bTop) * 0.20, 1, shx, shy, w * 0.34, [
    [0, '#ffffff'], [0.55, PAL.pengW], [1, '#9fa3b8']
  ]);
  ctx.fillStyle = wg;
  ctx.fill();
  // shirt shading from tux edge
  ctx.save();
  ctx.clip();
  const wsh = EN_linGrad(ctx, 'pwsh', shx - w * 0.25, 0, shx + w * 0.25, 0, [
    [0, 'rgba(30,32,50,0.40)'], [0.45, 'rgba(30,32,50,0)'], [1, 'rgba(30,32,50,0.32)']
  ]);
  ctx.fillStyle = wsh;
  ctx.fillRect(shx - w * 0.3, shy - h, w * 0.6, h * 2);
  // shirt buttons
  ctx.fillStyle = 'rgba(40,42,60,0.75)';
  for (let i = 0; i < 3; i++) {
    EN_ellipse(ctx, shx, shy - (bBot - bTop) * 0.10 + i * (bBot - bTop) * 0.14, w * 0.018, w * 0.018, 0);
    ctx.fill();
  }
  ctx.restore();

  // tux lapels over the shirt
  ctx.fillStyle = 'rgba(6,6,12,0.9)';
  ctx.beginPath();
  ctx.moveTo(shx - w * 0.24, shy - (bBot - bTop) * 0.40);
  ctx.quadraticCurveTo(shx - w * 0.14, shy - (bBot - bTop) * 0.10, shx - w * 0.03, shy - (bBot - bTop) * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(shx + w * 0.24, shy - (bBot - bTop) * 0.40);
  ctx.quadraticCurveTo(shx + w * 0.14, shy - (bBot - bTop) * 0.10, shx + w * 0.03, shy - (bBot - bTop) * 0.36);
  ctx.closePath();
  ctx.fill();

  // ---- umbrella tucked under the trailing wing ----------------------------
  EN_penguinUmbrella(ctx, cx - face * w * 0.30, bTop + (bBot - bTop) * 0.38, w, h, -face, t);

  // ---- flipper wing (facing side) -----------------------------------------
  const wingSw = Math.sin(cyc) * 0.22;
  ctx.save();
  ctx.translate(cx + face * brx * 0.80, bTop + (bBot - bTop) * 0.28);
  ctx.rotate(face * (0.25 + wingSw));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(face * w * 0.16, h * 0.10, face * w * 0.07, h * 0.30);
  ctx.quadraticCurveTo(face * w * 0.01, h * 0.16, 0, 0);
  ctx.closePath();
  ctx.fillStyle = EN_linGrad(ctx, 'pwg', 0, 0, face * w * 0.14, h * 0.3, [
    [0, PAL.pengHi], [0.6, PAL.peng], [1, '#04040a']
  ]);
  ctx.fill();
  EN_rimStroke(ctx, '#8fa0d0', 1.0, 0.45);
  ctx.restore();

  // ---- head ---------------------------------------------------------------
  const hcx = cx + face * w * 0.02;
  const hcy = y + h * 0.215;
  const hrx = w * 0.30, hry = h * 0.155;

  EN_ellipse(ctx, hcx, hcy, hrx, hry, 0);
  const hg = EN_linGrad(ctx, 'phd', hcx - hrx, hcy - hry, hcx + hrx, hcy + hry, [
    [0, '#05050a'], [0.4, PAL.peng], [0.75, PAL.pengHi], [1, '#0a0a12']
  ]);
  ctx.fillStyle = hg;
  ctx.fill();

  // white face patch
  ctx.save();
  EN_ellipse(ctx, hcx, hcy, hrx, hry, 0);
  ctx.clip();
  ctx.fillStyle = EN_radGrad(ctx, 'pfp', hcx + face * hrx * 0.25, hcy + hry * 0.20, 1,
    hcx + face * hrx * 0.25, hcy + hry * 0.20, hrx * 0.95, [
      [0, '#ffffff'], [0.6, PAL.pengW], [1, 'rgba(200,203,220,0)']
    ]);
  EN_ellipse(ctx, hcx + face * hrx * 0.28, hcy + hry * 0.25, hrx * 0.62, hry * 0.78, 0);
  ctx.fill();
  ctx.restore();

  // beak
  const bkx = hcx + face * hrx * 0.72;
  const bky = hcy + hry * 0.16;
  ctx.beginPath();
  ctx.moveTo(bkx - face * w * 0.04, bky - h * 0.030);
  ctx.lineTo(bkx + face * w * 0.155, bky + h * 0.004);
  ctx.lineTo(bkx - face * w * 0.04, bky + h * 0.034);
  ctx.closePath();
  ctx.fillStyle = EN_linGrad(ctx, 'pbk', bkx, bky - 5, bkx, bky + 5, [
    [0, '#ffcf8a'], [0.5, PAL.orange], [1, '#7d3c0c']
  ]);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#ffe0b0';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(bkx - face * w * 0.04, bky - h * 0.030);
  ctx.lineTo(bkx + face * w * 0.155, bky + h * 0.004);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // beak split line
  ctx.strokeStyle = 'rgba(70,30,5,0.7)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(bkx - face * w * 0.035, bky + h * 0.004);
  ctx.lineTo(bkx + face * w * 0.145, bky + h * 0.004);
  ctx.stroke();

  // eyes
  for (let i = 0; i < 2; i++) {
    const ex = hcx + face * hrx * 0.18 + (i ? hrx * 0.30 : -hrx * 0.10) * face;
    const ey = hcy - hry * 0.18;
    ctx.fillStyle = '#e9ecf6';
    EN_ellipse(ctx, ex, ey, hrx * 0.16, hry * 0.24, 0);
    ctx.fill();
    ctx.fillStyle = '#0a0a14';
    EN_ellipse(ctx, ex + face * hrx * 0.04, ey + hry * 0.02, hrx * 0.075, hry * 0.13, 0);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    EN_ellipse(ctx, ex + face * hrx * 0.07, ey - hry * 0.07, hrx * 0.035, hry * 0.05, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // gold monocle on the facing eye + chain
  EN_penguinMonocle(ctx, hcx + face * hrx * 0.48, hcy - hry * 0.16, hrx * 0.30, face, w, h, cx, bTop + (bBot - bTop) * 0.35);

  // ---- top hat ------------------------------------------------------------
  EN_penguinTopHat(ctx, hcx, hcy - hry * 0.86, w, h, face, t);

  // head rim light
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hcx, hcy, hrx, hry, 0,
    face > 0 ? -Math.PI * 0.45 : Math.PI * 0.55,
    face > 0 ? Math.PI * 0.35 : Math.PI * 1.35);
  EN_rimStroke(ctx, '#bed2f6', 1.4, 0.78);
  ctx.restore();

  ctx.restore(); // tilt

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}

function EN_penguinTopHat(ctx, cx, brimY, w, h, face, t) {
  ctx.save();
  ctx.translate(cx, brimY);
  ctx.rotate(face * -0.06 + Math.sin(t * 5.4) * 0.02);

  const bw = w * 0.42, ch = h * 0.16, cw = w * 0.26;

  // crown
  ctx.beginPath();
  ctx.moveTo(-cw, 2);
  ctx.lineTo(-cw * 0.94, -ch);
  ctx.quadraticCurveTo(0, -ch - h * 0.022, cw * 0.94, -ch);
  ctx.lineTo(cw, 2);
  ctx.closePath();
  ctx.fillStyle = EN_linGrad(ctx, 'pht', -cw, -ch, cw, 2, [
    [0, '#03030a'], [0.35, '#15151f'], [0.62, '#2b2b3c'], [0.8, '#141420'], [1, '#04040a']
  ]);
  ctx.fill();

  // purple band
  ctx.fillStyle = EN_linGrad(ctx, 'phb', -cw, -ch * 0.34, cw, -ch * 0.10, [
    [0, '#3b1f63'], [0.45, PAL.joker], [0.7, PAL.jokerHi], [1, '#2a1247']
  ]);
  ctx.beginPath();
  ctx.moveTo(-cw * 0.985, -ch * 0.36);
  ctx.lineTo(cw * 0.985, -ch * 0.36);
  ctx.lineTo(cw, -ch * 0.06);
  ctx.lineTo(-cw, -ch * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#c8a8f0';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // brim
  EN_ellipse(ctx, 0, 2, bw, h * 0.025, 0);
  ctx.fillStyle = EN_linGrad(ctx, 'phbr', -bw, 0, bw, 4, [
    [0, '#04040a'], [0.5, '#23232f'], [1, '#04040a']
  ]);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#7b88b4';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // crown rim light
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(face * cw * 0.94, -ch + 1);
  ctx.lineTo(face * cw * 0.99, 1);
  EN_rimStroke(ctx, '#aab8e4', 1.2, 0.55);
  ctx.restore();

  ctx.restore();
}

function EN_penguinMonocle(ctx, ex, ey, r, face, w, h, chainX, chainY) {
  ctx.save();
  // lens glass
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.fillStyle = EN_radGrad(ctx, 'pmg', ex - r * 0.4, ey - r * 0.4, 0.1, ex, ey, r, [
    [0, 'rgba(230,245,255,0.42)'], [0.55, 'rgba(120,160,210,0.14)'], [1, 'rgba(60,80,130,0.22)']
  ]);
  ctx.fill();
  // gold rim
  ctx.strokeStyle = EN_linGrad(ctx, 'pmr', ex - r, ey - r, ex + r, ey + r, [
    [0, '#fff0a8'], [0.4, PAL.yellow], [0.75, PAL.yellowD], [1, '#6d5205']
  ]);
  ctx.lineWidth = Math.max(1, r * 0.28);
  ctx.stroke();
  // specular streak on glass
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ex, ey, r * 0.68, Math.PI * 0.95, Math.PI * 1.45);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // chain
  ctx.strokeStyle = PAL.yellowD;
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(ex + face * r * 0.9, ey + r * 0.5);
  ctx.quadraticCurveTo(ex + face * r * 1.6, ey + r * 3.0, chainX + face * w * 0.16, chainY);
  ctx.stroke();
  // chain glints
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = PAL.yellow;
  for (let i = 1; i <= 3; i++) {
    const u = i / 4;
    const px = (1 - u) * (1 - u) * (ex + face * r * 0.9) + 2 * (1 - u) * u * (ex + face * r * 1.6) + u * u * (chainX + face * w * 0.16);
    const py = (1 - u) * (1 - u) * (ey + r * 0.5) + 2 * (1 - u) * u * (ey + r * 3.0) + u * u * chainY;
    ctx.beginPath();
    ctx.arc(px, py, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function EN_penguinUmbrella(ctx, ax, ay, w, h, dir, t) {
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(dir * 0.55 + Math.sin(t * 5.4) * 0.05);

  const L = h * 0.42;
  // shaft
  ctx.strokeStyle = EN_linGrad(ctx, 'pum', 0, -L * 0.5, 0, L * 0.5, [
    [0, '#5c4a33'], [0.5, '#8a6f4c'], [1, '#3a2d1e']
  ]);
  ctx.lineWidth = Math.max(1.2, w * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -L * 0.45);
  ctx.lineTo(0, L * 0.45);
  ctx.stroke();

  // furled canopy
  ctx.beginPath();
  ctx.moveTo(0, -L * 0.42);
  ctx.quadraticCurveTo(w * 0.085, -L * 0.10, w * 0.045, L * 0.20);
  ctx.quadraticCurveTo(0, L * 0.30, -w * 0.045, L * 0.20);
  ctx.quadraticCurveTo(-w * 0.085, -L * 0.10, 0, -L * 0.42);
  ctx.closePath();
  ctx.fillStyle = EN_linGrad(ctx, 'pumc', -w * 0.09, -L * 0.4, w * 0.09, L * 0.25, [
    [0, '#1d1030'], [0.45, PAL.joker], [0.8, PAL.jokerHi], [1, '#221040']
  ]);
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#cbb0f2';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // ribs
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#0d0618';
  ctx.lineWidth = 0.6;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w * 0.02, -L * 0.38);
    ctx.quadraticCurveTo(i * w * 0.05, 0, i * w * 0.028, L * 0.20);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // crook handle
  ctx.strokeStyle = '#7d6344';
  ctx.lineWidth = Math.max(1.2, w * 0.045);
  ctx.beginPath();
  ctx.arc(-w * 0.055, L * 0.44, w * 0.055, -Math.PI * 0.1, Math.PI * 0.95);
  ctx.stroke();
  // tip
  ctx.fillStyle = PAL.yellow;
  ctx.beginPath();
  ctx.arc(0, -L * 0.46, Math.max(1, w * 0.028), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function EN_penguinShell(ctx, cx, baseY, w, h, t, face, spinning) {
  ctx.save();
  const R = Math.min(w * 0.48, h * 0.40);
  const cy = baseY - R * 0.84;
  const spin = spinning ? t * 14 * (face >= 0 ? 1 : -1) : 0;

  EN_groundShadow(ctx, cx, baseY + 1, R * 1.05, R * 0.30, spinning ? 0.62 : 0.5);

  // --- motion blur arcs + spark trail (behind dome) -----------------------
  if (spinning) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const rr = R * (1.06 + i * 0.12);
      const a0 = spin * 0.35 + i * 0.5;
      ctx.strokeStyle = i % 2 ? 'rgba(160,180,230,0.55)' : 'rgba(90,110,170,0.45)';
      ctx.lineWidth = 1.6 - i * 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a0, a0 + 1.1 + i * 0.12);
      ctx.stroke();
    }
    // spark trail streaming opposite to travel
    for (let i = 0; i < 9; i++) {
      const ph = (t * 5 + i * 0.31) % 1;
      const sx = cx - face * (R * 0.9 + ph * R * 2.3);
      const sy = baseY - 1 - Math.sin(ph * Math.PI) * R * (0.25 + EN_rnd(i) * 0.5);
      ctx.globalAlpha = (1 - ph) * 0.75;
      ctx.fillStyle = i % 3 === 0 ? PAL.white : PAL.yellow;
      ctx.beginPath();
      ctx.arc(sx, sy, (1 - ph) * 1.7 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- dark-steel dome -----------------------------------------------------
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
  ctx.lineTo(cx + R, baseY - R * 0.06);
  ctx.quadraticCurveTo(cx, baseY + R * 0.10, cx - R, baseY - R * 0.06);
  ctx.closePath();
  const dg = EN_linGrad(ctx, 'psd', cx - R * 0.6, cy - R, cx + R * 0.8, baseY, [
    [0, '#454b60'], [0.22, '#2a2e3e'], [0.5, '#171a26'], [0.78, '#242938'], [1, '#0a0b12']
  ]);
  ctx.fillStyle = dg;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // riveted bands (rotate with spin)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin * 0.25);
  ctx.translate(-cx, -cy);
  for (let b = 0; b < 3; b++) {
    const ry = cy - R * 0.55 + b * R * 0.52;
    ctx.fillStyle = EN_linGrad(ctx, 'psb' + b, cx, ry - R * 0.10, cx, ry + R * 0.10, [
      [0, '#5a627c'], [0.45, '#333a4d'], [1, '#14161f']
    ]);
    ctx.fillRect(cx - R * 1.1, ry - R * 0.11, R * 2.2, R * 0.22);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#8f9ac2';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.1, ry - R * 0.11);
    ctx.lineTo(cx + R * 1.1, ry - R * 0.11);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // rivets around the dome, spinning
  const rivets = 10;
  for (let i = 0; i < rivets; i++) {
    const a = spin + (i / rivets) * Math.PI * 2;
    const rr = R * 0.66;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * 0.86;
    const depth = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos(a - Math.PI * 0.75));
    // drawn at the origin so the cached gradient key stays constant while spinning
    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = depth;
    ctx.fillStyle = EN_radGrad(ctx, 'psrv' + (R | 0), -1, -1, 0.1, 0, 0, R * 0.11, [
      [0, '#c3cbe4'], [0.45, '#6d768f'], [1, '#1a1d28']
    ]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.085, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = depth * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-R * 0.03, -R * 0.03, R * 0.026, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // hat-brim ridge cast onto the dome (he is in there somewhere)
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#05050c';
  EN_ellipse(ctx, cx, cy + R * 0.86, R * 1.0, R * 0.18, 0);
  ctx.fill();
  ctx.globalAlpha = 1;

  // glossy specular highlight
  const spx = cx - R * 0.34, spy = cy - R * 0.44;
  ctx.fillStyle = EN_radGrad(ctx, 'pssp', spx, spy, 0.1, spx, spy, R * 0.62, [
    [0, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(190,205,240,0.20)'], [1, 'rgba(255,255,255,0)']
  ]);
  EN_ellipse(ctx, spx, spy, R * 0.48, R * 0.30, -0.5);
  ctx.fill();

  // purple band echo of the top hat
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = PAL.jokerHi;
  ctx.lineWidth = Math.max(1.2, R * 0.10);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.86, Math.PI * 1.06, Math.PI * 1.94);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore(); // clip

  // dome outline + rim light on the facing edge
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI * 0.98, Math.PI * 2.02);
  ctx.strokeStyle = 'rgba(5,6,12,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.1, R - 0.6), face > 0 ? -Math.PI * 0.62 : Math.PI * 1.06,
    face > 0 ? -Math.PI * 0.02 : Math.PI * 1.66);
  EN_rimStroke(ctx, '#b9c8f2', 1.5, 0.7);
  ctx.restore();

  // gold monocle glint stuck on the shell rim (character tell)
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = PAL.yellow;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx + face * R * 0.46, cy + R * 0.30, R * 0.17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowColor = PAL.yellow;
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ============================================================================
// JOKER DRONE (flying) -- box ~30x26
// ============================================================================
function drawJokerDrone(ctx, x, y, w, h, o) {
  o = o || {};
  const t = o.animTime || 0;
  const face = o.facingRight === false ? -1 : 1;

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));   // entity-local space (gradient cache)
  x = 0; y = 0;

  const sway = Math.sin(t * 2.4) * w * 0.10;
  const hover = Math.sin(t * 3.3) * h * 0.07;
  const cx = x + w * 0.5;
  const cy = y + h * 0.52 + hover;
  const bodyRx = w * 0.26, bodyRy = h * 0.34;

  // --- sway-offset ground shadow (far below, soft & faint) -----------------
  EN_groundShadow(ctx, cx + sway * 1.6, y + h + h * 0.75, w * 0.34, w * 0.10, 0.34);

  // --- green underglow -----------------------------------------------------
  // quantised so the pulse can be part of the gradient cache key (see EN_linGrad)
  const gl = EN_qz(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5.1)), 12);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = EN_radGrad(ctx, 'dgl' + gl, cx, cy + bodyRy * 0.78, 0.1, cx, cy + bodyRy * 0.78, w * 0.62, [
    [0, 'rgba(110,255,110,' + (0.40 * gl).toFixed(3) + ')'],
    [0.35, 'rgba(63,160,44,' + (0.24 * gl).toFixed(3) + ')'],
    [1, 'rgba(63,160,44,0)']
  ]);
  ctx.beginPath();
  ctx.arc(cx, cy + bodyRy * 0.78, w * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- wings (behind body) --------------------------------------------------
  const flap = Math.sin(t * 11.5);
  for (let s = -1; s <= 1; s += 2) {
    EN_droneWing(ctx, cx, cy - bodyRy * 0.12, w, h, s, flap, t);
  }

  // --- propeller blur on top -----------------------------------------------
  EN_droneProp(ctx, cx, cy - bodyRy * 1.05, w, h, t);

  // --- balloon/mech body ----------------------------------------------------
  EN_ellipse(ctx, cx, cy, bodyRx, bodyRy, 0);
  const bgd = EN_radGrad(ctx, 'dbd', cx - bodyRx * 0.45, cy - bodyRy * 0.5, 0.1, cx, cy, bodyRx * 1.7, [
    [0, '#b48be0'], [0.30, PAL.jokerHi], [0.62, PAL.joker], [0.88, '#2c1450'], [1, '#140829']
  ]);
  ctx.fillStyle = bgd;
  ctx.fill();

  ctx.save();
  EN_ellipse(ctx, cx, cy, bodyRx, bodyRy, 0);
  ctx.clip();

  // plated seam bands
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#1a0c30';
  ctx.lineWidth = 1.1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * bodyRx * 0.55, cy - bodyRy);
    ctx.quadraticCurveTo(cx + i * bodyRx * 0.78, cy, cx + i * bodyRx * 0.55, cy + bodyRy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // green glowing belly vent
  const vg = EN_linGrad(ctx, 'dvn' + gl, cx, cy + bodyRy * 0.20, cx, cy + bodyRy, [
    [0, 'rgba(63,160,44,0)'], [0.5, 'rgba(90,220,70,' + (0.55 * gl).toFixed(3) + ')'], [1, 'rgba(160,255,140,' + (0.85 * gl).toFixed(3) + ')']
  ]);
  ctx.fillStyle = vg;
  ctx.fillRect(cx - bodyRx, cy + bodyRy * 0.15, bodyRx * 2, bodyRy);
  // vent slats
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#0d2a08';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const vy = cy + bodyRy * (0.45 + i * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx - bodyRx * 0.55, vy);
    ctx.lineTo(cx + bodyRx * 0.55, vy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // trailing-side shading
  ctx.fillStyle = EN_linGrad(ctx, 'dsh', cx - face * bodyRx, 0, cx + face * bodyRx, 0, [
    [0, 'rgba(0,0,0,0.5)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.12)']
  ]);
  ctx.fillRect(cx - bodyRx * 1.2, cy - bodyRy * 1.2, bodyRx * 2.4, bodyRy * 2.4);
  ctx.restore();

  // --- grinning face plate ---------------------------------------------------
  const fy = cy - bodyRy * 0.12;
  // sunken plate
  EN_ellipse(ctx, cx + face * bodyRx * 0.10, fy, bodyRx * 0.78, bodyRy * 0.52, 0);
  ctx.fillStyle = EN_linGrad(ctx, 'dfp', cx, fy - bodyRy * 0.5, cx, fy + bodyRy * 0.5, [
    [0, '#2b1450'], [0.6, '#180a30'], [1, '#0c0420']
  ]);
  ctx.fill();

  // glowing green eye slits
  for (let i = 0; i < 2; i++) {
    const ex = cx + face * bodyRx * 0.10 + (i ? bodyRx * 0.33 : -bodyRx * 0.33);
    const ey = fy - bodyRy * 0.13;
    ctx.save();
    ctx.shadowColor = 'rgba(120,255,110,0.95)';
    ctx.shadowBlur = 8 * gl;
    ctx.fillStyle = EN_linGrad(ctx, 'dey', ex, ey - 3, ex, ey + 3, [
      [0, '#e6ffd9'], [0.5, '#7bff5e'], [1, '#1d7a12']
    ]);
    ctx.beginPath();
    ctx.moveTo(ex - bodyRx * 0.22, ey - bodyRy * 0.10);
    ctx.lineTo(ex + bodyRx * 0.22, ey - bodyRy * 0.02);
    ctx.lineTo(ex + bodyRx * 0.16, ey + bodyRy * 0.11);
    ctx.lineTo(ex - bodyRx * 0.20, ey + bodyRy * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // metal rictus grin
  const my = fy + bodyRy * 0.24;
  const gw = bodyRx * 0.62;
  ctx.beginPath();
  ctx.moveTo(cx + face * bodyRx * 0.10 - gw, my - bodyRy * 0.06);
  ctx.quadraticCurveTo(cx + face * bodyRx * 0.10, my + bodyRy * 0.26, cx + face * bodyRx * 0.10 + gw, my - bodyRy * 0.06);
  ctx.quadraticCurveTo(cx + face * bodyRx * 0.10, my + bodyRy * 0.10, cx + face * bodyRx * 0.10 - gw, my - bodyRy * 0.06);
  ctx.closePath();
  ctx.fillStyle = EN_linGrad(ctx, 'dgn', cx, my - 4, cx, my + 6, [
    [0, '#f0efe4'], [0.55, '#b9b3a4'], [1, '#4d4840']
  ]);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#20101c';
  ctx.lineWidth = 0.6;
  for (let i = 1; i < 5; i++) {
    const tx = cx + face * bodyRx * 0.10 - gw + (i / 5) * gw * 2;
    ctx.beginPath();
    ctx.moveTo(tx, my - bodyRy * 0.03);
    ctx.lineTo(tx, my + bodyRy * 0.17);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- rim light on the facing edge of the body ----------------------------
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, bodyRx, bodyRy, 0,
    face > 0 ? -Math.PI * 0.58 : Math.PI * 0.42,
    face > 0 ? Math.PI * 0.42 : Math.PI * 1.42);
  EN_rimStroke(ctx, '#d7c2ff', 1.5, 0.65);
  ctx.restore();

  // top specular
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = EN_radGrad(ctx, 'dsp', cx - bodyRx * 0.4, cy - bodyRy * 0.6, 0.1, cx - bodyRx * 0.4, cy - bodyRy * 0.6, bodyRx * 0.8, [
    [0, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']
  ]);
  EN_ellipse(ctx, cx - bodyRx * 0.38, cy - bodyRy * 0.58, bodyRx * 0.30, bodyRy * 0.16, -0.4);
  ctx.fill();
  ctx.globalAlpha = 1;

  // --- laughing-gas puffs drifting below ------------------------------------
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.9 + i * 0.25) % 1;
    const px = cx + sway * 0.5 + Math.sin(t * 2 + i * 2.1) * w * 0.16;
    const py = cy + bodyRy * 0.9 + ph * h * 0.55;
    const pr = (2 + ph * 5) * (0.7 + EN_rnd(i * 11) * 0.6);
    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = (1 - ph) * 0.30;
    ctx.fillStyle = EN_radGrad(ctx, 'dpf', 0, 0, 0.1, 0, 0, pr, [
      [0, 'rgba(150,255,130,0.7)'], [1, 'rgba(63,160,44,0)']
    ]);
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}

function EN_droneWing(ctx, ax, ay, w, h, side, flap, t) {
  ctx.save();
  ctx.translate(ax + side * w * 0.20, ay);
  const a = side * (0.18 + flap * 0.62);
  ctx.rotate(a);
  ctx.scale(side, 1);

  const L = w * 0.42, H = h * 0.46;
  // membrane: scalloped bat wing
  ctx.beginPath();
  ctx.moveTo(0, -H * 0.18);
  ctx.quadraticCurveTo(L * 0.55, -H * 0.60, L, -H * 0.20);
  ctx.quadraticCurveTo(L * 0.80, -H * 0.02, L * 0.72, H * 0.12);
  ctx.quadraticCurveTo(L * 0.60, -H * 0.04, L * 0.48, H * 0.26);
  ctx.quadraticCurveTo(L * 0.38, H * 0.06, L * 0.26, H * 0.34);
  ctx.quadraticCurveTo(L * 0.16, H * 0.12, 0, H * 0.24);
  ctx.closePath();
  const mg = EN_linGrad(ctx, 'dwm', 0, -H * 0.6, L, H * 0.34, [
    [0, 'rgba(120,70,180,0.92)'], [0.4, 'rgba(70,35,115,0.88)'],
    [0.75, 'rgba(45,20,80,0.90)'], [1, 'rgba(25,10,45,0.95)']
  ]);
  ctx.fillStyle = mg;
  ctx.fill();

  // translucent green backlight through the membrane
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25 + 0.15 * (0.5 + 0.5 * Math.sin(t * 5.1));
  ctx.fillStyle = EN_radGrad(ctx, 'dwg', L * 0.15, H * 0.2, 0.1, L * 0.15, H * 0.2, L * 0.9, [
    [0, 'rgba(110,240,100,0.8)'], [1, 'rgba(63,160,44,0)']
  ]);
  ctx.fillRect(-2, -H, L + 4, H * 2);
  ctx.restore();

  // ribs / struts
  ctx.strokeStyle = 'rgba(200,180,255,0.55)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -H * 0.16); ctx.quadraticCurveTo(L * 0.55, -H * 0.55, L, -H * 0.20);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#c9aef0';
  ctx.lineWidth = 0.8;
  const tips = [[L * 0.72, H * 0.12], [L * 0.48, H * 0.26], [L * 0.26, H * 0.34]];
  for (let i = 0; i < tips.length; i++) {
    ctx.beginPath();
    ctx.moveTo(L * 0.06, -H * 0.10);
    ctx.quadraticCurveTo(tips[i][0] * 0.6, -H * 0.18, tips[i][0], tips[i][1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // leading-edge rim light
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, -H * 0.18);
  ctx.quadraticCurveTo(L * 0.55, -H * 0.62, L, -H * 0.20);
  EN_rimStroke(ctx, '#eadcff', 1.2, 0.6);
  ctx.restore();

  ctx.restore();
}

function EN_droneProp(ctx, cx, cy, w, h, t) {
  ctx.save();
  // mast
  ctx.strokeStyle = '#2a2038';
  ctx.lineWidth = Math.max(1, w * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.06);
  ctx.lineTo(cx, cy - h * 0.02);
  ctx.stroke();

  const pr = w * 0.30;
  const spin = t * 26;
  // blur disc
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = EN_radGrad(ctx, 'dpr', cx, cy, 0.1, cx, cy, pr, [
    [0, 'rgba(180,200,255,0.0)'], [0.55, 'rgba(170,190,250,0.55)'], [1, 'rgba(120,140,210,0)']
  ]);
  EN_ellipse(ctx, cx, cy - h * 0.02, pr, pr * 0.26, 0);
  ctx.fill();
  ctx.globalAlpha = 1;

  // three streaked blades
  for (let i = 0; i < 3; i++) {
    const a = spin + i * (Math.PI * 2 / 3);
    ctx.globalAlpha = 0.30 + 0.30 * Math.abs(Math.cos(a));
    ctx.strokeStyle = '#cfd8ff';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, cy - h * 0.02, pr, pr * 0.26, 0, a, a + 0.9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // hub
  ctx.fillStyle = EN_radGrad(ctx, 'dhb', cx - 1, cy - h * 0.03, 0.1, cx, cy - h * 0.02, w * 0.06, [
    [0, '#d8dcf0'], [0.5, '#6d7490'], [1, '#171a26']
  ]);
  ctx.beginPath();
  ctx.arc(cx, cy - h * 0.02, w * 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}
