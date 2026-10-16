// ═══════════════════════════════════════════════════════════════════════
//  UI — everything drawn on the 2D layer above the scene: hearts, ammunition,
//  compass, minimap, banners, the title, the pause card and the full map.
//
//  All sizes are multiples of one unit `u` (a 720-pixel-tall stage is 1.0), so
//  the layout is the same on a phone and on a monitor. The art is deliberately
//  blocky: pixel-grid hearts and a pixel map, to match the world they describe.
// ═══════════════════════════════════════════════════════════════════════

var UI = {
  banner: null, hint: null, bannerT: 0, hintT: 0,
  grapHint: false, hintCheckT: 0, hurtFlash: 0,
  mapReady: false, mapCanvas: null, mapRow: 0, mapOpenT: 0, mapSel: -1,
  hp: 5, hpAnim: 5,
  scoreShown: 0, objT: 0,
  compassT: 0, threat: [],
};

// Pixel art, one string per row.
var UI_HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
var UI_BAT = ['X.....X', 'XX.X.XX', 'XXXXXXX', '.XX.XX.', '..X.X..'];

var UI_MAP = { x0: -820, z0: -780, step: 3, w: 0, h: 0 };
var UI_DCOL = [[10, 24, 42], [92, 98, 112], [120, 88, 56], [96, 70, 120], [96, 150, 178], [64, 110, 74], [160, 70, 38], [150, 140, 70], [170, 50, 120]];

function UI_init() {
  UI_MAP.w = Math.ceil((1640) / UI_MAP.step); UI_MAP.h = Math.ceil((1560) / UI_MAP.step);
  UI.mapCanvas = document.createElement('canvas');
  UI.mapCanvas.width = UI_MAP.w; UI.mapCanvas.height = UI_MAP.h;
  UI.mapCtx = UI.mapCanvas.getContext('2d');
  UI.mapImg = UI.mapCtx.createImageData(UI_MAP.w, UI_MAP.h);
  UI.mapRow = 0;
  UI.canvasPos = { w: 0, h: 0 };
}

// The map is sampled from the generator itself a few rows a frame, so it is always
// exactly the world and costs nothing to ship.
function UI_mapStep(rows) {
  if (UI.mapReady) return;
  const M = UI_MAP, d = UI.mapImg.data, o = { kind: 0, top: 0, b: null };
  for (let n = 0; n < rows && UI.mapRow < M.h; n++, UI.mapRow++) {
    const j = UI.mapRow, z = M.z0 + j * M.step;
    for (let i = 0; i < M.w; i++) {
      const x = M.x0 + i * M.step;
      let c;
      if (!WG_isLand(x, z) && !LM_bridgeTop(x, z)) c = [8, 22, 40];
      else {
        WG_colInfo(x, z, o);
        const dc = UI_DCOL[WG_districtAt(x, z)], h = Math.min(1, (o.top - 27) / 80);
        if (o.kind === WG_K.ROAD) c = [30, 33, 42];
        else if (o.kind === WG_K.BRIDGE) c = [120, 110, 70];
        else if (o.kind === WG_K.SIDEWALK) c = [58, 62, 72];
        else if (o.kind === WG_K.PARK) c = [32, 80, 44];
        else if (o.kind === WG_K.BUILDING) { const k = 0.38 + 0.7 * h; c = [dc[0] * k, dc[1] * k, dc[2] * k]; }
        else if (o.kind === WG_K.ARENA) c = [200, 80, 90];
        else c = [dc[0] * 0.42, dc[1] * 0.42, dc[2] * 0.42];
      }
      const p = (j * M.w + i) * 4;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
  }
  if (UI.mapRow >= M.h) { UI.mapCtx.putImageData(UI.mapImg, 0, 0); UI.mapReady = true; }
}

// One-time advice, shown the first time it becomes relevant.
function UI_tip(id, text, secs) {
  UI.tipsSeen = UI.tipsSeen || {};
  if (UI.tipsSeen[id]) return;
  UI.tipsSeen[id] = true;
  UI_hint(text, secs || 6);
}
function UI_banner(title, sub) { UI.banner = { t: title, s: sub || '' }; UI.bannerT = 4.2; }
function UI_hint(text, secs) { UI.hint = text; UI.hintT = secs || 4; }
function UI_mapOpen() { UI.mapOpenT = 0; UI.mapSel = -1; }

function UI_update(dt) {
  UI.bannerT = Math.max(0, UI.bannerT - dt);
  UI.mapMsgT = Math.max(0, (UI.mapMsgT || 0) - dt);
  UI.hintT = Math.max(0, UI.hintT - dt);
  UI.hpAnim += (GS.player.hp - UI.hpAnim) * Math.min(1, dt * 8);
  UI.hurtFlash = Math.max(0, UI.hurtFlash - dt * 3);
  UI.scoreShown += (GS.score - UI.scoreShown) * Math.min(1, dt * 6);
  if (!UI.mapReady) UI_mapStep(VX.state === 'boot' ? 6 : 14);
  // is there something to grapple where the player is looking?
  UI.hintCheckT -= dt;
  if (UI.hintCheckT <= 0 && VX.state === 'play') {
    UI.hintCheckT = 0.12;
    const pl = GS.player;
    UI.grapHint = !pl.grap && !pl.dead && !!pl.findGrapple(GS.world, VX.cam);
  }
  // district banner on crossing a border
  if (VX.state === 'play') {
    UI.compassT -= dt;
    if (UI.compassT <= 0) {
      UI.compassT = 0.5;
      const pl = GS.player, d = WG_districtAt(pl.b.x, pl.b.z);
      if (pl.b.y < WG_GY + 45 || true) {
        if (UI.district !== undefined && d !== UI.district && !LM_bridgeTop(pl.b.x, pl.b.z)) UI_banner(WG_DNAME[d], '');
        UI.district = d;
      }
    }
  }
}

// ── drawing helpers ────────────────────────────────────────────────────────
function UI_px(ctx, rows, x, y, s, color, outline) {
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
    if (rows[j][i] !== 'X') continue;
    ctx.fillStyle = color; ctx.fillRect(Math.round(x + i * s), Math.round(y + j * s), Math.ceil(s), Math.ceil(s));
  }
}
function UI_text(ctx, str, x, y, size, color, align, weight, shadow, font) {
  ctx.font = (weight || 600) + ' ' + Math.round(size) + 'px ' + (font || 'Oswald, "Helvetica Neue", sans-serif');
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  if (shadow !== false) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(str, x + size * 0.06, y + size * 0.07); }
  ctx.fillStyle = color || '#e8c34a';
  ctx.fillText(str, x, y);
}
function UI_spacedText(ctx, str, x, y, size, color, spacing, align, weight) {
  ctx.font = (weight || 600) + ' ' + Math.round(size) + 'px Oswald, sans-serif';
  ctx.textBaseline = 'alphabetic';
  let w = 0; for (const ch of str) w += ctx.measureText(ch).width + spacing; w -= spacing;
  let cx = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
  ctx.textAlign = 'left';
  for (const ch of str) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(ch, cx + size * 0.05, y + size * 0.06);
    ctx.fillStyle = color; ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

// world -> screen, or null if behind the camera
function UI_project(x, y, z, w, h) {
  const m = VX.cam.vp;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0.05) return null;
  return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h, cw];
}

// ── the frame ──────────────────────────────────────────────────────────────
function UI_draw(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const u = h / 720;
  const st = VX.state, pl = GS.player;
  if (st === 'boot') return;
  if (st === 'title' || st === 'win') { UI_title(ctx, w, h, u, st === 'win'); return; }

  UI_floatText(ctx, w, h, u);
  UI_hearts(ctx, w, h, u);
  UI_crosshair(ctx, w, h, u);
  UI_compass(ctx, w, h, u);
  UI_minimap(ctx, w, h, u);
  UI_score(ctx, w, h, u);
  UI_threats(ctx, w, h, u);
  if (GS.boss) UI_bossBar(ctx, w, h, u);
  UI_banners(ctx, w, h, u);
  if (st === 'dead') UI_dead(ctx, w, h, u);
  if (st === 'pause') { UI_pause(ctx, w, h, u); UI_pauseFoot(ctx, w, h, u); }
  if (st === 'map') UI_bigMap(ctx, w, h, u);
}

function UI_hearts(ctx, w, h, u) {
  const pl = GS.player, s = 4.2 * u, gap = 7 * u, x0 = 22 * u, y0 = 20 * u;
  for (let i = 0; i < pl.maxHp; i++) {
    const x = x0 + i * (7 * s + gap);
    UI_px(ctx, UI_HEART, x - s * 0.5, y0 - s * 0.5, s, 'rgba(0,0,0,0.55)');
    const full = pl.hp > i;
    const pulse = pl.hp <= 1 && full ? 0.75 + 0.25 * Math.sin(VX.time * 8) : 1;
    UI_px(ctx, UI_HEART, x, y0, s, full ? 'rgba(' + Math.round(235 * pulse) + ',46,72,1)' : 'rgba(70,40,52,0.9)');
    if (full) { ctx.fillStyle = 'rgba(255,150,170,0.9)'; ctx.fillRect(Math.round(x + s), Math.round(y0 + s), Math.ceil(s), Math.ceil(s)); }
  }
  // batarangs
  const by = y0 + 6 * s + 14 * u;
  UI_px(ctx, UI_BAT, x0, by, 3.4 * u, '#9fb7d8');
  UI_text(ctx, '× ' + pl.bats, x0 + 7 * 3.4 * u + 10 * u, by + 5 * 3.4 * u, 20 * u, '#cfe0f5', 'left', 600);
}

function UI_crosshair(ctx, w, h, u) {
  if (VX.state !== 'play' || GS.player.dead) return;
  const cx = w / 2, cy = h / 2, hint = UI.grapHint;
  ctx.fillStyle = hint ? 'rgba(232,195,74,0.95)' : 'rgba(210,225,245,0.55)';
  const s = (hint ? 3 : 2.2) * u;
  ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  if (hint) {
    const g = 8 * u, l = 6 * u, t = 2 * u;
    ctx.fillRect(cx - g - l, cy - t / 2, l, t); ctx.fillRect(cx + g, cy - t / 2, l, t);
    ctx.fillRect(cx - t / 2, cy - g - l, t, l); ctx.fillRect(cx - t / 2, cy + g, t, l);
  }
}

function UI_score(ctx, w, h, u) {
  const touch = IN.touch;
  const top = touch ? 56 * (VX.hudDpr || 1) : 0;
  const x = w - 22 * u, y = top + 40 * u;
  UI_text(ctx, String(Math.round(UI.scoreShown)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), x, y, 30 * u, '#e8c34a', 'right', 600, true);
  UI_text(ctx, 'PUNTOS', x, y - 28 * u, 11 * u, 'rgba(157,176,200,0.8)', 'right', 500);
  if (GS.combo >= 2) {
    const k = Math.min(1, GS.comboT / 3.2);
    const pop = 1 + Math.max(0, 0.25 - (3.2 - GS.comboT) * 0.8);
    UI_text(ctx, '×' + GS.combo, x, y + 36 * u * pop, 30 * u * pop, '#ff9a3c', 'right', 700, true);
    ctx.fillStyle = 'rgba(255,154,60,0.9)'; ctx.fillRect(x - 70 * u * k, y + 46 * u, 70 * u * k, 3 * u);
  }
  // trophies and objectives
  const tx = x, ty = y + (GS.combo >= 2 ? 78 : 36) * u;
  UI_text(ctx, GS.trophies.size + ' / ' + GS.trophyTotal + ' TROFEOS', tx, ty, 12 * u, '#6ff08a', 'right', 500);
}

var UI_CARD = ['N', 'E', 'S', 'O'];
function UI_compass(ctx, w, h, u) {
  const pl = GS.player, cam = VX.cam;
  const cx = w / 2, y = 24 * u, half = Math.min(190 * u, w * 0.17);
  ctx.fillStyle = 'rgba(6,9,16,0.38)'; ctx.fillRect(cx - half, y - 14 * u, half * 2, 22 * u);
  ctx.fillStyle = 'rgba(232,195,74,0.7)'; ctx.fillRect(cx - 1 * u, y - 15 * u, 2 * u, 5 * u);
  // heading in the same convention as the camera: yaw 0 looks at -z (north)
  const yaw = cam.yaw;
  const markers = [];
  for (let i = 0; i < 4; i++) markers.push({ a: i * Math.PI / 2, t: UI_CARD[i], c: i === 0 ? '#e8c34a' : '#9db0c8', big: true });
  for (const o of WD_objectives()) markers.push({ a: Math.atan2(o.x - pl.b.x, -(o.z - pl.b.z)), t: o.icon, c: o.color, big: true, d: Math.hypot(o.x - pl.b.x, o.z - pl.b.z) });
  for (const m of markers) {
    let da = m.a - yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const px = cx + da / (Math.PI * 0.62) * half;
    if (Math.abs(px - cx) > half - 4 * u) continue;
    const fade = 1 - Math.pow(Math.abs(px - cx) / half, 3);
    ctx.globalAlpha = fade;
    UI_text(ctx, m.t, px, y + 3 * u, (m.d !== undefined ? 15 : 14) * u, m.c, 'center', 600, true);
    if (m.d !== undefined) UI_text(ctx, Math.round(m.d) + ' m', px, y + 22 * u, 9 * u, m.c, 'center', 500, true);
    ctx.globalAlpha = 1;
  }
}

function UI_minimap(ctx, w, h, u) {
  const pl = GS.player;
  const R = 62 * u, cx = 22 * u + R, cy = 112 * u + R;
  // a circular window onto the cached map, heading up
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(6,10,18,0.88)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  if (UI.mapReady) {
    const M = UI_MAP, span = 130, pxPerBlock = R / span;      // blocks from centre to edge
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    ctx.rotate(-VX.cam.yaw);
    const sc = pxPerBlock * M.step;
    ctx.drawImage(UI.mapCanvas, -(pl.b.x - M.x0) / M.step * sc, -(pl.b.z - M.z0) / M.step * sc, M.w * sc, M.h * sc);
    // markers, in the rotated frame
    for (const o of WD_objectives()) {
      const dx = (o.x - pl.b.x) * pxPerBlock, dz = (o.z - pl.b.z) * pxPerBlock;
      let d = Math.hypot(dx, dz), k = d > R - 8 * u ? (R - 8 * u) / d : 1;
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(dx * k, dz * k, (k < 1 ? 3.2 : 4.2) * u, 0, 7); ctx.fill();
    }
    for (const e of GS.enemies) {
      if (e.dead) continue;
      const dx = (e.b.x - pl.b.x) * pxPerBlock, dz = (e.b.z - pl.b.z) * pxPerBlock;
      if (dx * dx + dz * dz > (R - 3 * u) * (R - 3 * u)) continue;
      ctx.fillStyle = e.isBoss ? '#ff3030' : (e.alert ? '#ff5a4a' : '#c0504a'); ctx.fillRect(dx - 2 * u, dz - 2 * u, 4 * u, 4 * u);
    }
  }
  ctx.restore();
  ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(232,195,74,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  // the player: an arrow pointing where the character faces, relative to the camera
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(VX.cam.yaw - (Math.PI - pl.a) * 1);
  ctx.fillStyle = '#e8c34a'; ctx.beginPath(); ctx.moveTo(0, -6 * u); ctx.lineTo(4.5 * u, 5 * u); ctx.lineTo(0, 2.5 * u); ctx.lineTo(-4.5 * u, 5 * u); ctx.closePath(); ctx.fill();
  ctx.restore();
  UI_text(ctx, 'N', cx + Math.sin(VX.cam.yaw) * (R + 10 * u) * 0, cy - R - 4 * u, 10 * u, 'rgba(232,195,74,0.8)', 'center', 600);
}

function UI_threats(ctx, w, h, u) {
  // a red tick at the screen edge toward any enemy that is about to hit from out of view
  const pl = GS.player, cam = VX.cam;
  for (const e of GS.enemies) {
    if (e.dead || (e.state !== 'windup' && e.state !== 'strike')) continue;
    const dx = e.b.x - pl.b.x, dz = e.b.z - pl.b.z;
    let da = Math.atan2(dx, -dz) - cam.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) < 0.7) continue;
    const a = da - Math.PI / 2, R = Math.min(w, h) * 0.34;
    const x = w / 2 + Math.cos(a) * R, y = h / 2 + Math.sin(a) * R;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = 'rgba(255,70,50,' + (0.6 + 0.4 * Math.sin(VX.time * 20)) + ')';
    ctx.beginPath(); ctx.moveTo(0, -12 * u); ctx.lineTo(9 * u, 8 * u); ctx.lineTo(-9 * u, 8 * u); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function UI_floatText(ctx, w, h, u) {
  for (const t of GS.fx.texts) {
    const p = UI_project(t.x, t.y, t.z, w, h);
    if (!p) continue;
    const k = t.life / t.max, a = Math.min(1, k * 3);
    ctx.globalAlpha = a;
    UI_text(ctx, t.s, p[0], p[1], Math.min(46, 17 * t.size * Math.max(0.6, 26 / p[2])) * u, t.c, 'center', 700, true);
    ctx.globalAlpha = 1;
  }
}

function UI_banners(ctx, w, h, u) {
  if (UI.bannerT > 0 && UI.banner) {
    const k = UI.bannerT, a = Math.min(1, k * 1.2, (4.2 - k) * 2);
    ctx.globalAlpha = Math.max(0, a);
    UI_spacedText(ctx, UI.banner.t, w / 2, h * 0.2, 44 * u, '#e8c34a', 9 * u, 'center', 600);
    if (UI.banner.s) UI_spacedText(ctx, UI.banner.s.toUpperCase(), w / 2, h * 0.2 + 28 * u, 14 * u, '#9db0c8', 5 * u, 'center', 500);
    ctx.globalAlpha = 1;
  }
  if (UI.hintT > 0 && UI.hint && VX.state === 'play') {
    const a = Math.min(1, UI.hintT * 1.5);
    ctx.globalAlpha = a;
    UI_spacedText(ctx, UI.hint.toUpperCase(), w / 2, h - 34 * u, 13 * u, '#cfd9e8', 2.5 * u, 'center', 500);
    ctx.globalAlpha = 1;
  }
}

function UI_bossBar(ctx, w, h, u) {
  const b = GS.boss;
  if (!b || b.dead) return;
  const bw = Math.min(w * 0.5, 560 * u), x = w / 2 - bw / 2, y = h - 70 * u;
  UI_spacedText(ctx, b.name, w / 2, y - 10 * u, 18 * u, '#ff7a6a', 6 * u, 'center', 600);
  ctx.fillStyle = 'rgba(8,10,16,0.75)'; ctx.fillRect(x - 3 * u, y - 3 * u, bw + 6 * u, 16 * u);
  const k = Math.max(0, b.hp / b.maxHp);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(x, y, bw * k, 10 * u);
  ctx.fillStyle = '#ff8a70'; ctx.fillRect(x, y, bw * k, 3 * u);
  // phase notches
  ctx.fillStyle = 'rgba(8,10,16,0.9)';
  for (let i = 1; i < b.phases; i++) ctx.fillRect(x + bw * i / b.phases - u, y, 2 * u, 10 * u);
}

function UI_dead(ctx, w, h, u) {
  const k = Math.min(1, VX.stateT * 0.8);
  ctx.fillStyle = 'rgba(40,0,0,' + (0.35 * k) + ')'; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = k;
  UI_spacedText(ctx, 'GOTHAM TE NECESITA', w / 2, h * 0.46, 46 * u, '#e8c34a', 9 * u, 'center', 600);
  UI_spacedText(ctx, 'LEVÁNTATE', w / 2, h * 0.46 + 32 * u, 16 * u, '#cfd9e8', 7 * u, 'center', 500);
  ctx.globalAlpha = 1;
}

function UI_pause(ctx, w, h, u) {
  ctx.fillStyle = 'rgba(4,6,12,0.66)'; ctx.fillRect(0, 0, w, h);
  UI_spacedText(ctx, 'PAUSA', w / 2, h * 0.30, 52 * u, '#e8c34a', 12 * u, 'center', 600);
  const rows = [['WASD', 'Mover'], ['Ratón / arrastrar', 'Cámara'], ['Espacio', 'Saltar · en el aire: planear'], ['Shift', 'Correr'], ['E', 'Garfio: apunta a un muro'],
    ['Clic / J', 'Golpear (combo de 3)'], ['F / clic der.', 'Batarang'], ['Q / Ctrl', 'Esquivar'], ['M', 'Mapa y viaje rápido'], ['N', 'Sonido'], ['P / Esc', 'Reanudar']];
  const x0 = w / 2 - 230 * u;
  rows.forEach(function (r, i) {
    const y = h * 0.30 + 52 * u + i * 27 * u;
    UI_text(ctx, r[0], x0 + 160 * u, y, 15 * u, '#e8c34a', 'right', 600, false, '"JetBrains Mono", monospace');
    UI_text(ctx, r[1], x0 + 180 * u, y, 15 * u, '#b8c6d8', 'left', 500, false);
  });
}

function UI_pauseFoot(ctx, w, h, u) {
  UI_spacedText(ctx, 'CALIDAD GRÁFICA: ' + VX_Q[VX.quality].name + ' (AUTOMÁTICA)', w / 2, h - 28 * u, 11 * u, '#6c7a92', 3 * u, 'center', 500);
}
function UI_title(ctx, w, h, u, win) {
  const t = VX.stateT;
  ctx.fillStyle = 'rgba(2,3,8,' + (win ? 0.55 : 0.45) + ')';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const a = Math.min(1, t * 0.8);
  ctx.globalAlpha = a;
  if (win) {
    UI_spacedText(ctx, 'GOTHAM ESTÁ A SALVO', w / 2, h * 0.36, 54 * u, '#e8c34a', 10 * u, 'center', 600);
    UI_spacedText(ctx, 'EL PINGÜINO Y EL JOKER, DERROTADOS', w / 2, h * 0.36 + 34 * u, 15 * u, '#cfd9e8', 6 * u, 'center', 500);
    UI_spacedText(ctx, 'PUNTOS ' + GS.score + '   ·   MEJOR COMBO ×' + GS.bestCombo + '   ·   ' + GS.trophies.size + '/' + GS.trophyTotal + ' TROFEOS', w / 2, h * 0.36 + 70 * u, 14 * u, '#9db0c8', 4 * u, 'center', 500);
    if (t > 1.5 && ((t * 1.6) | 0) % 2 === 0) UI_spacedText(ctx, 'PULSA PARA SEGUIR EXPLORANDO', w / 2, h * 0.74, 14 * u, '#e8c34a', 6 * u, 'center', 500);
  } else {
    UI_spacedText(ctx, 'GOTHAM', w / 2, h * 0.40, 92 * u, '#e8c34a', 20 * u, 'center', 700);
    UI_spacedText(ctx, 'MUNDO ABIERTO DE VÓXELES', w / 2, h * 0.40 + 36 * u, 17 * u, '#cfd9e8', 9 * u, 'center', 500);
    const touchy = IN.touch || VX.coarse;
    if (t > 0.6 && ((t * 1.6) | 0) % 2 === 0) UI_spacedText(ctx, touchy ? 'TOCA LA PANTALLA PARA EMPEZAR' : 'PULSA CUALQUIER TECLA PARA EMPEZAR', w / 2, h * 0.5, 15 * u, '#e8c34a', 6 * u, 'center', 500);
    if (!touchy) UI_spacedText(ctx, 'WASD · RATÓN · ESPACIO PLANEA · E GARFIO', w / 2, h * 0.5 + 30 * u, 11 * u, '#7a8aa2', 4 * u, 'center', 500);
    if (VX.saved && !touchy) UI_spacedText(ctx, 'PARTIDA GUARDADA · PULSA B ANTES DE EMPEZAR PARA BORRARLA', w / 2, h * 0.5 + 54 * u, 10 * u, '#6ff08a', 3 * u, 'center', 500);
    if (VX.saved && touchy) UI_spacedText(ctx, 'PARTIDA GUARDADA', w / 2, h * 0.5 + 30 * u, 10 * u, '#6ff08a', 3 * u, 'center', 500);
  }
  ctx.globalAlpha = 1;
}

// ── the big map ────────────────────────────────────────────────────────────
function UI_mapGeom(w, h, u) {
  const M = UI_MAP;
  const aw = w * 0.92, ah = h * 0.84;
  const k = Math.min(aw / M.w, ah / M.h);
  return { k: k, x: (w - M.w * k) / 2, y: (h - M.h * k) / 2 + 8 * u };
}
function UI_bigMap(ctx, w, h, u) {
  ctx.fillStyle = 'rgba(3,5,10,0.9)'; ctx.fillRect(0, 0, w, h);
  const M = UI_MAP, G = UI_mapGeom(w, h, u), pl = GS.player;
  ctx.imageSmoothingEnabled = false;
  if (UI.mapReady) ctx.drawImage(UI.mapCanvas, G.x, G.y, M.w * G.k, M.h * G.k);
  else UI_text(ctx, 'Dibujando el mapa…', w / 2, h / 2, 18 * u, '#9db0c8', 'center');
  const sx = x => G.x + (x - M.x0) / M.step * G.k, sz = z => G.y + (z - M.z0) / M.step * G.k;
  // district names at their centres
  for (const c of WG_CENTERS) {
    UI_text(ctx, WG_DNAME[c[0]], sx(c[1]), sz(c[2]), 11 * u, 'rgba(220,230,245,0.75)', 'center', 500, true);
  }
  // beacons
  UI.mapHit = [];
  GS.beacons.forEach(function (b, i) {
    const x = sx(b.x), y = sz(b.z), on = b.active || i === 0;
    ctx.fillStyle = on ? '#e8c34a' : '#5d6b82';
    ctx.beginPath(); ctx.moveTo(x, y - 8 * u); ctx.lineTo(x + 6 * u, y + 5 * u); ctx.lineTo(x - 6 * u, y + 5 * u); ctx.closePath(); ctx.fill();
    UI.mapHit.push({ x: x, y: y, i: i, on: on });
  });
  for (const o of WD_objectives()) {
    const x = sx(o.x), y = sz(o.z);
    ctx.strokeStyle = o.color; ctx.lineWidth = 2.5 * u;
    ctx.beginPath(); ctx.arc(x, y, 8 * u + 2 * u * Math.sin(VX.time * 4), 0, 7); ctx.stroke();
    UI_text(ctx, o.label, x, y - 14 * u, 11 * u, o.color, 'center', 600, true);
  }
  // the player
  const px = sx(pl.b.x), py = sz(pl.b.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - pl.a + Math.PI);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -8 * u); ctx.lineTo(6 * u, 7 * u); ctx.lineTo(0, 3.5 * u); ctx.lineTo(-6 * u, 7 * u); ctx.closePath(); ctx.fill();
  ctx.restore();
  UI_spacedText(ctx, 'MAPA DE GOTHAM', w / 2, 38 * u, 26 * u, '#e8c34a', 8 * u, 'center', 600);
  UI_spacedText(ctx, 'ELIGE UNA BALIZA ACTIVA PARA VIAJAR  ·  M PARA CERRAR', w / 2, h - 22 * u, 11 * u, '#8b9bb2', 3 * u, 'center', 500);
  if (UI.mapMsg && UI.mapMsgT > 0) { UI_spacedText(ctx, UI.mapMsg, w / 2, 66 * u, 13 * u, '#ff9a8a', 3 * u, 'center', 500); }
}

// A click or tap on the big map: travel to a beacon that has been lit.
function UI_mapClick(cx, cy) {
  if (VX.state !== 'map' || !UI.mapHit) return;
  const s = VX.hud.width / (VX.cssW || VX.hud.width);
  const x = cx * s, y = cy * s, u = VX.hud.height / 720;
  let best = null, bd = 1e9;
  for (const m of UI.mapHit) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } }
  if (!best || bd > 30 * u) return;
  if (!best.on) { UI.mapMsg = 'ESA BALIZA AÚN NO ESTÁ ACTIVA'; UI.mapMsgT = 2; return; }
  WD_travel(best.i);
}
