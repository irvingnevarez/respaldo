// NOTE ON VALUE: nothing in here may render at paper white. The grade is
// near-monochrome and sits between 0.1 and 0.3 luminance, so a white fill is
// four stops hot, blooms, and turns a character into a glowing blob — which is
// exactly what the Penguin had become. Small specular dots and eye glints are
// the exception: those are highlights and are meant to clip.
// ═══════════════════════════════════════════════════════════════════════
//  BOSS ART — the two arena bosses, their projectiles and their UI.
//  Module prefix BS_.  All animation is driven by the passed time so frames
//  are reproducible; variation comes from hashing an index, never Math.random.
// ═══════════════════════════════════════════════════════════════════════

function BS_rnd(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function BS_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function BS_roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rr); return; }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function BS_shadow(ctx, cx, groundY, rx) {
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, Math.max(2, rx), Math.max(2, rx * 0.22), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// white-out pass used when a boss takes a hit
function BS_flash(ctx, x, y, w, h, amt) {
  if (amt <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = BS_clamp(amt, 0, 1) * 0.8;
  ctx.fillStyle = '#fff';
  BS_roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.3);
  ctx.fill();
  ctx.restore();
}

// ── EL PINGÜINO ────────────────────────────────────────────────────────
function BS_umbrellaCopter(ctx, cx, cy, w, state, t, phase) {
  const folded = state === 'telegraph' || state === 'slam' || state === 'dazed';
  const spread = folded ? 0.22 : 1;
  const spin = state === 'hover' ? t * 16 : t * 2;
  ctx.save();
  ctx.translate(cx, cy);
  // shaft
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(-3, -4, 6, 26);
  // ribs, squashed horizontally to fake rotation
  for (let i = 0; i < 6; i++) {
    const a = spin + i * Math.PI / 3;
    const sx = Math.cos(a);
    const len = w * 0.52 * spread;
    ctx.save();
    ctx.globalAlpha = state === 'hover' ? 0.55 + 0.45 * Math.abs(sx) : 1;
    const g = ctx.createLinearGradient(0, 0, sx * len, -8);
    g.addColorStop(0, '#4a4358');
    g.addColorStop(1, '#20202c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(sx * len * 0.55, -12, sx * len, -3);
    ctx.lineTo(sx * len * 0.9, 2);
    ctx.quadraticCurveTo(sx * len * 0.5, -4, 0, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // armoured hub
  const hub = ctx.createRadialGradient(-3, -4, 1, 0, 0, 13);
  hub.addColorStop(0, '#6b6480');
  hub.addColorStop(1, '#23222e');
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(0, -2, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12121a'; ctx.lineWidth = 1.5; ctx.stroke();
  if (phase >= 2) {           // damage sparks
    const f = (t * 7 + 0.3) % 1;
    if (f < 0.22) {
      ctx.globalAlpha = 1 - f / 0.22;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(6, -6, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawPenguinBoss(ctx, x, y, w, h, o) {
  o = o || {};
  const st = o.state || 'hover';
  const t = o.animTime || 0;
  const right = !!o.facingRight;
  const phase = o.phase || 1;
  const dazed = st === 'dazed';
  const dead = st === 'dead';

  ctx.save();
  BS_shadow(ctx, x + w / 2, Math.min(y + h + 6, 15 * 32 + 2), w * 0.42);

  ctx.translate(x + w / 2, y);
  if (!right) ctx.scale(-1, 1);
  const bw = w * 0.78, bh = h * 0.72;
  const bodyTop = h * 0.26;
  const bob = st === 'hover' ? Math.sin(t * 2.2) * 3 : 0;

  // dazed: buried head-first, so flip the whole body over
  ctx.save();
  if (dazed) { ctx.translate(0, h * 0.62); ctx.rotate(Math.PI); ctx.translate(0, -h * 0.38); }
  if (dead) { ctx.rotate(0.34); ctx.translate(6, 10); }

  if (!dazed && !dead) BS_umbrellaCopter(ctx, 0, bodyTop - 26 + bob, w, st, t, phase);

  // body
  const bg = ctx.createLinearGradient(-bw / 2, bodyTop, bw / 2, bodyTop + bh);
  bg.addColorStop(0, '#2e2e3c');
  bg.addColorStop(0.45, PAL.peng);
  bg.addColorStop(1, '#07070c');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(0, bodyTop + bh / 2 + bob, bw / 2, bh / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // shirt front
  const sg = ctx.createLinearGradient(0, bodyTop + bh * 0.15, 0, bodyTop + bh);
  sg.addColorStop(0, '#9aa0ab');
  sg.addColorStop(1, '#6c7280');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(0, bodyTop + bh * 0.58 + bob, bw * 0.26, bh * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // flippers
  ctx.fillStyle = '#16161e';
  for (const s of [-1, 1]) {
    const flap = st === 'slam' ? -0.5 : Math.sin(t * 3 + (s > 0 ? 0 : 1)) * 0.18;
    ctx.save();
    ctx.translate(s * bw * 0.46, bodyTop + bh * 0.42 + bob);
    ctx.rotate(s * (0.35 + flap));
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.11, bh * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // feet
  ctx.fillStyle = PAL.orange;
  for (const s of [-1, 1]) {
    const kick = dazed ? Math.sin(t * 14 + s) * 6 : 0;
    ctx.beginPath();
    ctx.ellipse(s * bw * 0.2 + kick, bodyTop + bh + 3 + bob, bw * 0.16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // head
  const hy = bodyTop + bh * 0.12 + bob;
  ctx.fillStyle = '#1a1a24';
  ctx.beginPath(); ctx.ellipse(0, hy, bw * 0.3, bh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a5a399';
  ctx.beginPath(); ctx.ellipse(bw * 0.05, hy + 3, bw * 0.2, bh * 0.13, 0, 0, Math.PI * 2); ctx.fill();

  // beak + cigarette holder
  ctx.fillStyle = PAL.orange;
  ctx.beginPath();
  ctx.moveTo(bw * 0.18, hy); ctx.lineTo(bw * 0.44, hy + 3); ctx.lineTo(bw * 0.18, hy + 8);
  ctx.closePath(); ctx.fill();
  if (!dead) {
    ctx.strokeStyle = '#b0ab9d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bw * 0.4, hy + 4); ctx.lineTo(bw * 0.62, hy - 4); ctx.stroke();
    ctx.fillStyle = '#ff7a3a';
    ctx.beginPath(); ctx.arc(bw * 0.63, hy - 5, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // eye + cracked monocle
  const eyeR = phase >= 3 ? '#ff5a4a' : '#fff';
  ctx.fillStyle = eyeR;
  ctx.beginPath(); ctx.arc(bw * 0.08, hy - 1, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#101018';
  ctx.beginPath(); ctx.arc(bw * 0.09, hy - 1, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.yellow; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(bw * 0.08, hy - 1, 7, 0, Math.PI * 2); ctx.stroke();
  if (phase >= 2) {
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bw * 0.03, hy - 7); ctx.lineTo(bw * 0.12, hy + 4); ctx.stroke();
  }
  ctx.strokeStyle = PAL.yellowD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bw * 0.14, hy + 4); ctx.quadraticCurveTo(bw * 0.22, hy + 16, bw * 0.05, hy + 22); ctx.stroke();

  // top hat
  if (!dead) {
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(-bw * 0.26, hy - bh * 0.2 - 2, bw * 0.52, 4);
    BS_roundRect(ctx, -bw * 0.18, hy - bh * 0.2 - 20, bw * 0.36, 20, 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a55';
    ctx.fillRect(-bw * 0.18, hy - bh * 0.2 - 8, bw * 0.36, 4);
  }

  // bow tie
  ctx.fillStyle = PAL.danger;
  ctx.beginPath();
  ctx.moveTo(-7, hy + bh * 0.22); ctx.lineTo(0, hy + bh * 0.26); ctx.lineTo(-7, hy + bh * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(7, hy + bh * 0.22); ctx.lineTo(0, hy + bh * 0.26); ctx.lineTo(7, hy + bh * 0.3);
  ctx.closePath(); ctx.fill();

  // rim light down the facing edge
  ctx.strokeStyle = 'rgba(190,205,255,0.5)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, bodyTop + bh / 2 + bob, bw / 2, bh / 2, 0, -1.25, 0.5);
  ctx.stroke();

  ctx.restore();

  // dazed stars
  if (dazed) {
    ctx.save();
    ctx.translate(0, h * 0.1);
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * Math.PI * 2 / 3;
      ctx.fillStyle = PAL.yellow;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 8 + i);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 26, Math.sin(a) * 9 - 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();

  BS_flash(ctx, x, y, w, h, o.hurtFlash || 0);
}

// ── EL JOKER ───────────────────────────────────────────────────────────
function BS_jokerFace(ctx, cx, cy, r, t, phase, laughing) {
  // hair goes behind the head so the strands read as a mane
  ctx.fillStyle = '#1f6b16';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 1.02 + i * (Math.PI * 1.04 / 6);
    const wob = Math.sin(t * 5 + i * 1.3) * 0.12;
    const len = 1.7 + BS_rnd(i) * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + wob) * r * len, cy + Math.sin(a + wob) * r * len,
      cx + Math.cos(a + 0.32) * r * 0.86, cy + Math.sin(a + 0.32) * r * 0.86);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = PAL.jokerGreen;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI * 0.95 + i * (Math.PI * 0.9 / 5);
    const wob = Math.sin(t * 5 + i) * 0.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + wob) * r * 1.45, cy + Math.sin(a + wob) * r * 1.45,
      cx + Math.cos(a + 0.3) * r * 0.85, cy + Math.sin(a + 0.3) * r * 0.85);
    ctx.closePath(); ctx.fill();
  }
  // chalk-white face, modelled instead of flat: lit from upper left, with a
  // greenish bounce under the jaw
  const fg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r * 1.25);
  fg.addColorStop(0, '#aaa89f');
  fg.addColorStop(0.55, PAL.face);
  fg.addColorStop(1, '#848b79');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.12, 0, 0, Math.PI * 2); ctx.fill();
  // cheekbone shadow and a pointed chin
  ctx.fillStyle = 'rgba(120,110,130,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.62, r * 0.55, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // sunken eye sockets with smeared makeup
  ctx.fillStyle = 'rgba(60,30,80,0.45)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.34, cy - r * 0.14, r * 0.3, r * 0.28, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // brow
  ctx.strokeStyle = '#2a1630';
  ctx.lineWidth = Math.max(1, r * 0.07);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.12, cy - r * 0.44);
    ctx.lineTo(cx + s * r * 0.56, cy - r * 0.3);
    ctx.stroke();
  }
  // eyes
  ctx.fillStyle = '#1b1024';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.34, cy - r * 0.15, r * 0.15, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (phase >= 3) {   // unhinged: blown pupils and a twitch
    ctx.fillStyle = '#e8e0ff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * r * 0.34 + Math.sin(t * 21) * 1.2, cy - r * 0.15, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // rictus grin
  ctx.strokeStyle = PAL.smile;
  ctx.lineWidth = Math.max(1.6, r * 0.13);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.12, r * 0.62, 0.22, Math.PI - 0.22);
  ctx.stroke();
  if (laughing) {
    ctx.fillStyle = '#3a0a12';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.42, r * 0.4, r * 0.26 * (1 + Math.sin(t * 14) * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawJokerBoss(ctx, x, y, w, h, o) {
  o = o || {};
  const st = o.state || 'ride';
  const t = o.animTime || 0;
  const right = !!o.facingRight;
  const phase = o.phase || 1;
  const riding = phase === 1 && st !== 'dead';

  ctx.save();

  if (st === 'teleport') {
    // dissolving into green smoke, cards scattering out of it
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const a = BS_rnd(i) * Math.PI * 2, d = 8 + BS_rnd(i + 40) * 34;
      ctx.globalAlpha = 0.35 * (1 - BS_rnd(i + 9));
      ctx.fillStyle = PAL.jokerGreen;
      ctx.beginPath();
      ctx.arc(x + w / 2 + Math.cos(a) * d, y + h * 0.5 + Math.sin(a) * d * 0.7,
        6 + BS_rnd(i + 3) * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  BS_shadow(ctx, x + w / 2, 15 * 32 + 2, w * 0.36);
  ctx.translate(x + w / 2, y);
  if (!right) ctx.scale(-1, 1);

  const manW = riding ? w * 0.42 : w * 0.72;
  const manTop = riding ? h * 0.62 : h * 0.06;
  const manH = riding ? h * 0.34 : h * 0.9;

  if (riding) {
    // gas bag with his own grinning face painted on it
    const bw = w * 0.9, bh = h * 0.62;
    const sway = Math.sin(t * 1.5) * 0.05;
    ctx.save();
    ctx.rotate(sway);
    const g = ctx.createRadialGradient(-bw * 0.2, bh * 0.1, 6, 0, bh * 0.3, bw * 0.6);
    g.addColorStop(0, PAL.jokerHi);
    g.addColorStop(0.6, PAL.joker);
    g.addColorStop(1, '#2c1348');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.34, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    BS_jokerFace(ctx, 0, bh * 0.3, bw * 0.24, t, phase, false);
    ctx.globalAlpha = 1;
    // ropes to the basket
    ctx.strokeStyle = '#c9b88a'; ctx.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * bw * 0.3, bh * 0.62);
      ctx.lineTo(s * w * 0.17, h * 0.66);
      ctx.stroke();
    }
    ctx.restore();
    // wicker basket
    const bg2 = ctx.createLinearGradient(0, h * 0.66, 0, h * 0.82);
    bg2.addColorStop(0, '#a97f3f');
    bg2.addColorStop(1, '#5d431d');
    ctx.fillStyle = bg2;
    BS_roundRect(ctx, -w * 0.2, h * 0.66, w * 0.4, h * 0.16, 3);
    ctx.fill();
    ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h * 0.66 + i * h * 0.04);
      ctx.lineTo(w * 0.2, h * 0.66 + i * h * 0.04);
      ctx.stroke();
    }
  }

  // the man himself
  const armUp = st === 'taunt' || st === 'throw';
  ctx.save();
  ctx.translate(0, manTop);
  // shoes first, so the coat tails fall over them
  if (!riding) {
    ctx.fillStyle = '#14101c';
    for (const s of [-1, 1]) {
      const step = Math.sin(t * 4 + (s > 0 ? 0 : Math.PI)) * manW * 0.06;
      ctx.beginPath();
      ctx.ellipse(s * manW * 0.2 + step, manH * 0.97, manW * 0.19, manH * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // trousers
    ctx.fillStyle = '#2c1548';
    ctx.fillRect(-manW * 0.3, manH * 0.72, manW * 0.6, manH * 0.24);
  }

  // tailcoat: a real silhouette with shoulders, not a rounded box
  const cg = ctx.createLinearGradient(-manW * 0.4, manH * 0.3, manW * 0.4, manH * 0.9);
  cg.addColorStop(0, '#9a67d8');
  cg.addColorStop(0.4, PAL.jokerHi);
  cg.addColorStop(0.75, PAL.joker);
  cg.addColorStop(1, '#2a1046');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-manW * 0.34, manH * 0.3);           // left shoulder
  ctx.quadraticCurveTo(-manW * 0.56, manH * 0.34, -manW * 0.5, manH * 0.46);
  ctx.lineTo(-manW * 0.42, manH * 0.84);          // waist
  ctx.lineTo(manW * 0.42, manH * 0.84);
  ctx.lineTo(manW * 0.5, manH * 0.46);
  ctx.quadraticCurveTo(manW * 0.56, manH * 0.34, manW * 0.34, manH * 0.3);
  ctx.closePath(); ctx.fill();

  if (!riding) {  // coat tails flying behind
    ctx.beginPath();
    ctx.moveTo(-manW * 0.42, manH * 0.74);
    ctx.quadraticCurveTo(-manW * 0.98, manH * (0.88 + Math.sin(t * 6) * 0.06), -manW * 0.66, manH * 1.04);
    ctx.lineTo(-manW * 0.16, manH * 0.86);
    ctx.closePath(); ctx.fill();
  }

  // waistcoat
  ctx.fillStyle = '#2a8c1e';
  ctx.beginPath();
  ctx.moveTo(-manW * 0.2, manH * 0.33);
  ctx.lineTo(manW * 0.2, manH * 0.33);
  ctx.lineTo(manW * 0.13, manH * 0.78);
  ctx.lineTo(-manW * 0.13, manH * 0.78);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.jokerGreen;
  ctx.beginPath();
  ctx.moveTo(-manW * 0.18, manH * 0.34);
  ctx.lineTo(manW * 0.05, manH * 0.34);
  ctx.lineTo(-manW * 0.05, manH * 0.7);
  ctx.lineTo(-manW * 0.12, manH * 0.7);
  ctx.closePath(); ctx.fill();

  // lapels
  ctx.fillStyle = '#5c2a94';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * manW * 0.34, manH * 0.3);
    ctx.lineTo(s * manW * 0.08, manH * 0.56);
    ctx.lineTo(s * manW * 0.2, manH * 0.32);
    ctx.closePath(); ctx.fill();
  }

  // bow tie
  ctx.fillStyle = PAL.orange;
  ctx.beginPath();
  ctx.moveTo(-manW * 0.17, manH * 0.29); ctx.lineTo(0, manH * 0.34); ctx.lineTo(-manW * 0.17, manH * 0.39);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(manW * 0.17, manH * 0.29); ctx.lineTo(0, manH * 0.34); ctx.lineTo(manW * 0.17, manH * 0.39);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c05a10';
  ctx.beginPath(); ctx.arc(0, manH * 0.34, manW * 0.05, 0, Math.PI * 2); ctx.fill();

  // rim light down the leading edge
  ctx.strokeStyle = 'rgba(210,190,255,0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(manW * 0.34, manH * 0.31);
  ctx.quadraticCurveTo(manW * 0.55, manH * 0.35, manW * 0.49, manH * 0.47);
  ctx.lineTo(manW * 0.41, manH * 0.83);
  ctx.stroke();

  // arms
  ctx.strokeStyle = PAL.joker;
  ctx.lineWidth = Math.max(3, manW * 0.13);
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const a = armUp ? -1.15 * s : (0.5 + Math.sin(t * 3 + s) * 0.16) * s;
    ctx.beginPath();
    ctx.moveTo(s * manW * 0.4, manH * 0.4);
    ctx.lineTo(s * manW * 0.4 + Math.sin(a) * manW * 0.5, manH * 0.4 + Math.cos(a) * manH * 0.3);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // fanned cards in the leading hand
  if (st === 'throw' || st === 'ground') {
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(manW * 0.62, manH * 0.16);
      ctx.rotate(-0.5 + i * 0.24);
      ctx.fillStyle = '#c0bdb2';
      ctx.fillRect(0, -7, 9, 13);
      ctx.strokeStyle = PAL.smile; ctx.lineWidth = 1; ctx.strokeRect(0, -7, 9, 13);
      ctx.restore();
    }
  }
  // head
  BS_jokerFace(ctx, 0, manH * 0.14, manW * 0.36, t, phase, armUp || st === 'taunt');
  ctx.restore();

  ctx.restore();
  BS_flash(ctx, x, y, w, h, o.hurtFlash || 0);
}

// ── projectiles ────────────────────────────────────────────────────────
function drawUmbrellaBomb(ctx, cx, cy, r, angle, fuse) {
  ctx.save();
  ctx.translate(cx, cy);
  // canopy
  ctx.fillStyle = '#2a1c3e';
  ctx.beginPath();
  ctx.arc(0, -r * 0.7, r * 1.05, Math.PI, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#1a1026'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI + i * Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.7);
    ctx.lineTo(Math.cos(a) * r * 1.05, -r * 0.7 + Math.sin(a) * r * 1.05);
    ctx.stroke();
  }
  ctx.strokeStyle = '#3a2a12'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, -r * 0.1); ctx.stroke();
  // bomb
  const g = ctx.createRadialGradient(-r * 0.3, r * 0.1, 1, 0, r * 0.35, r);
  g.addColorStop(0, '#4a4a58');
  g.addColorStop(1, '#0a0a10');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.72, 0, Math.PI * 2); ctx.fill();
  // fuse spark, ramping red as it is about to blow
  const f = BS_clamp(fuse || 0, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = f > 0.6 ? '#ff5030' : '#ffcf6a';
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(angle * 6);
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.25, 2 + f * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (f > 0.55) {
    ctx.globalAlpha = (f - 0.55) * 1.2;
    ctx.strokeStyle = PAL.danger; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawCardProjectile(ctx, cx, cy, r, angle) {
  ctx.save();
  // motion trail
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = PAL.jokerHi;
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.7, r * 0.5, angle * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const sq = Math.abs(Math.cos(angle * 0.8));      // fake the card turning edge-on
  ctx.scale(0.35 + sq * 0.65, 1);
  ctx.fillStyle = '#f7f4e8';
  BS_roundRect(ctx, -r * 0.7, -r, r * 1.4, r * 2, 2);
  ctx.fill();
  ctx.strokeStyle = '#b9b2a0'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.fillStyle = PAL.smile;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.jokerGreen;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawShockwave(ctx, cx, groundY, w, h, t, strength) {
  ctx.save();
  const s = BS_clamp(strength === undefined ? 1 : strength, 0, 1);
  // crest
  const g = ctx.createLinearGradient(0, groundY - h, 0, groundY);
  g.addColorStop(0, 'rgba(190,225,255,0.0)');
  g.addColorStop(0.45, 'rgba(170,215,255,' + (0.55 * s) + ')');
  g.addColorStop(1, 'rgba(90,130,190,' + (0.85 * s) + ')');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.75, groundY);
  ctx.quadraticCurveTo(cx - w * 0.2, groundY - h * 1.15, cx, groundY - h * 0.85);
  ctx.quadraticCurveTo(cx + w * 0.25, groundY - h * 0.5, cx + w * 0.7, groundY);
  ctx.closePath(); ctx.fill();
  // cracked shards along the leading edge
  ctx.fillStyle = 'rgba(225,240,255,' + (0.8 * s) + ')';
  for (let i = 0; i < 5; i++) {
    const px = cx - w * 0.4 + i * w * 0.2 + Math.sin(t * 10 + i) * 2;
    const ph = h * (0.3 + BS_rnd(i) * 0.5);
    ctx.beginPath();
    ctx.moveTo(px, groundY);
    ctx.lineTo(px + 3, groundY - ph);
    ctx.lineTo(px + 7, groundY);
    ctx.closePath(); ctx.fill();
  }
  // dust
  ctx.globalAlpha = 0.3 * s;
  ctx.fillStyle = '#9fb0c8';
  for (let i = 0; i < 6; i++) {
    const a = t * 3 + i;
    ctx.beginPath();
    ctx.arc(cx - w * 0.5 + i * w * 0.18, groundY - 6 - (a % 1) * 14, 3 + BS_rnd(i + 7) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGasCloud(ctx, x, y, w, h, t) {
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(120,230,90,0.42)');
  g.addColorStop(0.3, 'rgba(60,170,50,0.62)');
  g.addColorStop(1, 'rgba(14,70,20,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // churning top edge, built from overlapping lobes so it tiles with itself
  ctx.fillStyle = 'rgba(150,245,120,0.5)';
  ctx.beginPath();
  ctx.moveTo(x, y + 10);
  for (let i = 0; i <= 24; i++) {
    const px = x + (i / 24) * w;
    const py = y + 8 + Math.sin(t * 1.7 + i * 0.9) * 5 + Math.sin(t * 3.1 + i * 2.3) * 3;
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x + w, y + 22); ctx.lineTo(x, y + 22);
  ctx.closePath(); ctx.fill();
  // rising bubbles
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#b6ff9a';
  for (let i = 0; i < 16; i++) {
    const px = x + ((BS_rnd(i) * w) + t * 18 * (0.4 + BS_rnd(i + 5))) % w;
    const py = y + h - ((t * 30 * (0.5 + BS_rnd(i + 2)) + BS_rnd(i + 8) * h) % h);
    ctx.beginPath(); ctx.arc(px, py, 2 + BS_rnd(i + 11) * 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ── boss UI ────────────────────────────────────────────────────────────
function BS_disp(size) {
  return '800 ' + size + 'px Oswald, "Arial Black", Impact, system-ui, sans-serif';
}

function drawBossHealthBar(ctx, x, y, w, h, o) {
  o = o || {};
  const hp = o.hp || 0, maxHp = Math.max(1, o.maxHp || 1);
  const flash = BS_clamp(o.flash || 0, 0, 1);
  // Restyled to match the rest of the HUD: no gold frame, no glass plate, no
  // gradient pips. A framed red slab with a drop-shadowed name is the most
  // dated thing that can sit at the top of a screen.
  const bw = Math.min(w, 440), bx = x + (w - bw) / 2;
  ctx.save();
  ctx.translate(Math.sin((o.t || 0) * 60) * flash * 2.5, 0);

  ctx.font = '600 12px Oswald, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillStyle = flash > 0.2 ? 'rgba(255,255,255,0.95)' : 'rgba(228,238,250,0.78)';
  const nm = String(o.name || '');
  let spaced = '';
  for (let i = 0; i < nm.length; i++) spaced += nm[i] + (i < nm.length - 1 ? ' ' : '');
  ctx.fillText(spaced, bx + bw / 2, y - 8);
  ctx.textAlign = 'left';

  // a thin rule, segmented by hit points
  const gap = 4, seg = (bw - gap * (maxHp - 1)) / maxHp;
  for (let i = 0; i < maxHp; i++) {
    const sx = bx + i * (seg + gap);
    ctx.fillStyle = i < hp
      ? (flash > 0.2 ? 'rgba(255,255,255,0.95)' : 'rgba(206,74,68,0.92)')
      : 'rgba(150,168,190,0.16)';
    ctx.fillRect(sx, y, seg, 3);
  }

  ctx.font = '600 9px Oswald, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(196,210,228,0.40)';
  ctx.fillText('FASE ' + (o.phase || 1), bx + bw, y + 16);

  ctx.restore();
  ctx.textAlign = 'left';
}

function drawBossIntro(ctx, t, name, subtitle, progress) {
  const p = BS_clamp(progress || 0, 0, 1);
  // ease in, hold, ease out
  const a = p < 0.18 ? p / 0.18 : (p > 0.8 ? (1 - p) / 0.2 : 1);
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(4,3,10,0.72)';
  ctx.fillRect(0, 0, CW, CH);

  const slide = (1 - Math.min(1, p / 0.25));
  ctx.translate(-slide * 420, 0);

  // Letterbox bars rather than a painted red slash: the slash read as a
  // fighting-game banner, which is exactly the register we are moving away from.
  ctx.fillStyle = 'rgba(3,5,9,0.92)';
  ctx.fillRect(0, 0, CW, CH / 2 - 62);
  ctx.fillRect(0, CH / 2 + 58, CW, CH / 2 - 58);
  ctx.fillStyle = 'rgba(198,214,236,0.22)';
  ctx.fillRect(CW * 0.5 - 150, CH / 2 - 62, 300, 1);
  ctx.fillRect(CW * 0.5 - 150, CH / 2 + 58, 300, 1);

  ctx.textAlign = 'center';
  ctx.font = BS_disp(52);
  ctx.fillStyle = 'rgba(236,243,252,0.96)';
  ctx.fillText(name || '', CW / 2, CH / 2 + 6);

  ctx.font = BS_disp(13);
  ctx.fillStyle = 'rgba(190,206,228,0.62)';
  let sub = subtitle || '';
  let spaced = '';
  for (let i = 0; i < sub.length; i++) spaced += sub[i] + (i < sub.length - 1 ? ' ' : '');
  ctx.fillText(spaced, CW / 2, CH / 2 + 44);

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
