// ===========================================================================
//  ui.js  --  HUD + full-screen states.   Prefix: UI_
//  Pure Canvas2D. No images, no libraries. Deterministic (time-driven) only.
// ===========================================================================

const UI_gcache = Object.create(null);

function UI_rnd(n){ const s = Math.sin(n*127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function UI_clamp(v,a,b){ return v < a ? a : (v > b ? b : v); }
function UI_dispFont(size){ return '800 ' + size + 'px Oswald, "Arial Black", Impact, system-ui, sans-serif'; }
function UI_numFont(size){ return '700 ' + size + 'px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'; }
function UI_pad(n,len){ let s = String(Math.max(0, Math.floor(n||0))); while(s.length < len) s = '0' + s; return s; }

// --- cached gradients ------------------------------------------------------
function UI_lg(ctx, key, x0,y0,x1,y1, stops){
  let g = UI_gcache[key];
  if(!g){
    g = ctx.createLinearGradient(x0,y0,x1,y1);
    for(let i=0;i<stops.length;i++) g.addColorStop(stops[i][0], stops[i][1]);
    UI_gcache[key] = g;
  }
  return g;
}
function UI_rg(ctx, key, x0,y0,r0, x1,y1,r1, stops){
  let g = UI_gcache[key];
  if(!g){
    g = ctx.createRadialGradient(x0,y0,r0,x1,y1,r1);
    for(let i=0;i<stops.length;i++) g.addColorStop(stops[i][0], stops[i][1]);
    UI_gcache[key] = g;
  }
  return g;
}

// --- rounded rect (per-corner radii), roundRect-free ----------------------
function UI_roundRect(ctx, x, y, w, h, r){
  let tl,tr,br,bl;
  if(Array.isArray(r)){ tl=r[0]; tr=r[1]; br=r[2]; bl=r[3]; } else { tl=tr=br=bl=r||0; }
  const m = Math.min(w,h)/2;
  tl=Math.min(tl,m); tr=Math.min(tr,m); br=Math.min(br,m); bl=Math.min(bl,m);
  ctx.moveTo(x+tl, y);
  ctx.lineTo(x+w-tr, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+tr);
  ctx.lineTo(x+w, y+h-br);
  ctx.quadraticCurveTo(x+w, y+h, x+w-br, y+h);
  ctx.lineTo(x+bl, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-bl);
  ctx.lineTo(x, y+tl);
  ctx.quadraticCurveTo(x, y, x+tl, y);
}

// --- letter-spaced text (canvas has no reliable letterSpacing) ------------
function UI_measure(ctx, text, track){
  if(!track) return ctx.measureText(text).width;
  let w = 0;
  for(let i=0;i<text.length;i++) w += ctx.measureText(text[i]).width + track;
  return text.length ? w - track : 0;
}
function UI_tracked(ctx, text, x, y, track, align, stroke){
  const w = UI_measure(ctx, text, track);
  let sx = x;
  if(align === 'center') sx = x - w/2;
  else if(align === 'right') sx = x - w;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  if(!track){
    if(stroke) ctx.strokeText(text, sx, y); else ctx.fillText(text, sx, y);
  } else {
    let cx = sx;
    for(let i=0;i<text.length;i++){
      if(stroke) ctx.strokeText(text[i], cx, y); else ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + track;
    }
  }
  ctx.textAlign = prevAlign;
  return w;
}

// ===========================================================================
//  SHARED HEADING TEXT  (public)
// ===========================================================================
function drawPanelText(ctx, text, x, y, size, opts){
  opts = opts || {};
  const align = opts.align || 'center';
  const track = opts.track || 0;
  const c1    = opts.color1 || '#fff4c2';
  const c2    = opts.color2 || PAL.yellowD;
  const glow  = opts.glow == null ? 22 : opts.glow;

  ctx.save();
  ctx.font = UI_dispFont(size);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // 1. atmospheric glow behind the letters
  if(glow > 0){
    ctx.save();
    ctx.shadowColor = opts.glowColor || 'rgba(245,197,24,0.55)';
    ctx.shadowBlur = glow;
    ctx.fillStyle = 'rgba(120,90,10,0.85)';
    UI_tracked(ctx, text, x, y, track, align, false);
    ctx.shadowBlur = glow * 0.5;
    UI_tracked(ctx, text, x, y, track, align, false);
    ctx.restore();
  }

  // 2. dark bevel / cast shadow, offset down
  ctx.fillStyle = 'rgba(4,4,9,0.92)';
  UI_tracked(ctx, text, x, y + Math.max(2, size*0.055), track, align, false);

  // 3. hard dark outline
  ctx.strokeStyle = '#06060d';
  ctx.lineWidth = Math.max(2, size*0.085);
  UI_tracked(ctx, text, x, y, track, align, true);

  // 4. main gradient fill
  const top = y - size*0.80, bot = y + size*0.18;
  const key = 'pt' + size + '|' + c1 + '|' + c2 + '|' + Math.round(top);
  ctx.fillStyle = UI_lg(ctx, key, 0, top, 0, bot, [
    [0.00, c1],
    [0.34, opts.colorMid || PAL.yellow],
    [0.62, c2],
    [1.00, opts.color3 || '#6d4f05']
  ]);
  UI_tracked(ctx, text, x, y, track, align, false);

  // 5. upper specular sheen
  const sk = 'pts' + size + '|' + Math.round(top);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = UI_lg(ctx, sk, 0, top, 0, top + size*0.46, [
    [0, 'rgba(255,255,255,0.55)'], [0.7,'rgba(255,255,255,0.06)'], [1,'rgba(255,255,255,0)']
  ]);
  UI_tracked(ctx, text, x, y, track, align, false);
  ctx.restore();

  // 6. thin bright top rim
  ctx.strokeStyle = 'rgba(255,246,214,0.35)';
  ctx.lineWidth = Math.max(0.7, size*0.012);
  UI_tracked(ctx, text, x, y - Math.max(1, size*0.02), track, align, true);

  ctx.restore();
}

// small dim caption in the display stack
function UI_caption(ctx, text, x, y, size, color, track, align, alpha){
  ctx.save();
  ctx.font = UI_dispFont(size);
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.fillStyle = color || 'rgba(158,172,212,0.72)';
  UI_tracked(ctx, text, x, y, track == null ? 2.4 : track, align || 'center', false);
  ctx.restore();
}

// numeric stack, gold gradient + dark outline, tabular
function UI_num(ctx, text, x, y, size, align, c1, c2, glow){
  ctx.save();
  ctx.font = UI_numFont(size);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align || 'left';
  ctx.lineJoin = 'round';
  if(glow){ ctx.shadowColor = 'rgba(245,197,24,0.5)'; ctx.shadowBlur = glow; }
  ctx.strokeStyle = '#07070e';
  ctx.lineWidth = Math.max(2, size*0.20);
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  const top = y - size*0.82;
  ctx.fillStyle = UI_lg(ctx, 'n'+size+'|'+Math.round(top)+'|'+(c1||'a'), 0, top, 0, y + size*0.14, [
    [0, c1 || '#fff3c4'], [0.45, PAL.yellow], [1, c2 || PAL.yellowD]
  ]);
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ===========================================================================
//  SMALL ICONS
// ===========================================================================
function UI_batarangIcon(ctx, cx, cy, r, ang){
  ctx.save();
  ctx.translate(cx, cy);
  let sx = Math.cos(ang);
  if(Math.abs(sx) < 0.14) sx = sx < 0 ? -0.14 : 0.14;
  ctx.rotate(Math.sin(ang) * 0.30);
  ctx.scale(sx, 1);
  ctx.beginPath();
  ctx.moveTo(0, -r*1.05);
  ctx.quadraticCurveTo(r*0.34, -r*0.30, r*0.98, r*0.62);
  ctx.quadraticCurveTo(r*0.30, r*0.22, 0, r*0.52);
  ctx.quadraticCurveTo(-r*0.30, r*0.22, -r*0.98, r*0.62);
  ctx.quadraticCurveTo(-r*0.34, -r*0.30, 0, -r*1.05);
  ctx.closePath();
  ctx.fillStyle = UI_lg(ctx, 'bar'+Math.round(r), 0,-r, 0, r*0.7, [
    [0,'#8f9ab8'], [0.35,'#4a5170'], [0.6,'#272c42'], [1,'#12141f']
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,24,0.55)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // specular edge
  ctx.beginPath();
  ctx.moveTo(-r*0.05, -r*0.92);
  ctx.quadraticCurveTo(r*0.28, -r*0.26, r*0.80, r*0.50);
  ctx.strokeStyle = 'rgba(226,236,255,0.65)';
  ctx.lineWidth = 1.0;
  ctx.stroke();
  ctx.restore();
}

// gold hairline rule with a soft bloom and a centre diamond
function UI_rule(ctx, cx, y, w, alpha, color, diamond){
  const c = color || PAL.yellow;
  ctx.save();
  ctx.globalAlpha = alpha == null ? 0.85 : alpha;
  ctx.fillStyle = UI_lg(ctx, 'rl'+Math.round(cx)+'_'+Math.round(w)+c, cx-w/2,0, cx+w/2,0, [
    [0,'rgba(0,0,0,0)'], [0.22, c], [0.5, c], [0.78, c], [1,'rgba(0,0,0,0)']
  ]);
  ctx.shadowColor = c; ctx.shadowBlur = 14;
  ctx.fillRect(cx - w/2, y, w, 1.5);
  ctx.shadowBlur = 0;
  if(diamond){
    ctx.translate(cx, y + 0.75);
    ctx.rotate(Math.PI/4);
    ctx.fillStyle = c;
    ctx.shadowColor = c; ctx.shadowBlur = 10;
    ctx.fillRect(-3.2,-3.2, 6.4, 6.4);
  }
  ctx.restore();
}

// full-screen dark wash + coloured bloom + vignette + drifting light bar
function UI_wash(ctx, t, bloom, strength){
  ctx.save();
  ctx.fillStyle = UI_lg(ctx, 'wash', 0,0,0,CH, [
    [0,'rgba(3,4,11,0.93)'], [0.45,'rgba(6,7,17,0.86)'], [1,'rgba(2,2,6,0.95)']
  ]);
  ctx.globalAlpha = strength == null ? 1 : strength;
  ctx.fillRect(0,0,CW,CH);
  ctx.globalAlpha = 1;
  if(bloom){
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.50 + 0.10*Math.sin(t*1.1);
    ctx.fillStyle = UI_rg(ctx, 'bl'+bloom, CW/2, CH*0.40, 20, CW/2, CH*0.40, CW*0.58, [
      [0, bloom], [0.55,'rgba(0,0,0,0)'], [1,'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0,0,CW,CH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  // slow vertical sweep of haze
  const sy = ((t*26) % (CH + 320)) - 160;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = UI_lg(ctx, 'sweep', 0,0,0,160, [
    [0,'rgba(0,0,0,0)'], [0.5,'rgba(150,170,235,1)'], [1,'rgba(0,0,0,0)']
  ]);
  ctx.translate(0, sy);
  ctx.fillRect(0, 0, CW, 160);
  ctx.restore();
  // vignette
  ctx.fillStyle = UI_rg(ctx, 'vig', CW/2, CH/2, CH*0.28, CW/2, CH/2, CH*0.95, [
    [0,'rgba(0,0,0,0)'], [1,'rgba(0,0,0,0.72)']
  ]);
  ctx.fillRect(0,0,CW,CH);
  ctx.restore();
}

// deterministic drifting dust motes
function UI_motes(ctx, t, n, seed, color){
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color || 'rgba(210,220,255,0.5)';
  for(let i=0;i<n;i++){
    const a = UI_rnd(seed+i), b = UI_rnd(seed+i*3.7), c = UI_rnd(seed+i*7.3);
    const x = (a*CW + Math.sin(t*(0.18+b*0.3) + i)*26 + CW) % CW;
    const y = (b*CH - t*(7 + c*16)) % CH;
    const yy = y < 0 ? y + CH : y;
    const r = 0.6 + c*1.7;
    ctx.globalAlpha = 0.14 + 0.36*Math.abs(Math.sin(t*0.8 + i*1.7));
    ctx.beginPath(); ctx.arc(x, yy, r, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function UI_prompt(ctx, text, y, t, blink){
  const pulse = 0.55 + 0.45*Math.sin(t*4.2);
  ctx.save();
  ctx.globalAlpha = blink ? (0.80 + 0.20*pulse) : 0.16;
  ctx.font = UI_dispFont(19);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(245,197,24,0.75)';
  ctx.shadowBlur = 16 + 10*pulse;
  ctx.fillStyle = '#ffe9a3';
  UI_tracked(ctx, text, CW/2, y, 7, 'center', false);
  ctx.restore();
}

// layered bat emblem: halo, gold rim, dark body, inner sheen
function UI_emblem(ctx, cx, cy, r, t, halo){
  ctx.save();
  if(halo > 0){
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = halo * (0.82 + 0.18*Math.sin(t*1.5));
    ctx.fillStyle = UI_rg(ctx, 'hal'+Math.round(r), cx, cy, r*0.12, cx, cy, r*1.85, [
      [0,'rgba(245,197,24,0.55)'], [0.32,'rgba(200,150,40,0.20)'], [1,'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(cx - r*2, cy - r*2, r*4, r*4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  // gold rim = slightly larger emblem behind
  ctx.save();
  ctx.shadowColor = 'rgba(245,197,24,0.9)';
  ctx.shadowBlur = r*0.28;
  drawBatSymbol(ctx, cx, cy, r*1.035, PAL.yellow);
  ctx.restore();
  // body with vertical steel gradient (coords are symbol-local)
  const body = UI_lg(ctx, 'emb'+Math.round(r), 0, -r*0.55, 0, r*0.5, [
    [0, PAL.batHi], [0.42, PAL.bat], [1, PAL.batLo]
  ]);
  drawBatSymbol(ctx, cx, cy, r, body);
  // inner top sheen
  ctx.save();
  ctx.globalAlpha = 0.5;
  const sheen = UI_lg(ctx, 'embs'+Math.round(r), 0, -r*0.55, 0, -r*0.05, [
    [0,'rgba(190,205,245,0.7)'], [1,'rgba(190,205,245,0)']
  ]);
  drawBatSymbol(ctx, cx, cy, r*0.955, sheen);
  ctx.restore();
  ctx.restore();
}

// ===========================================================================
//  HUD
// ===========================================================================
function drawHUD(ctx, s){
  s = s || {};
  const t     = s.time || 0;
  const star  = !!s.starActive;
  const lives = Math.max(0, s.lives|0);
  const pulse = 0.5 + 0.5*Math.sin(t*7);

  ctx.save();

  // A scrim, not a panel. The old HUD was a glass slab with a gold border and
  // heavy letterpress type — unmistakably arcade. A modern one gets out of the
  // way: a soft darkening so text stays legible over a bright sky, and nothing
  // else. No frame, no fill, no glow.
  const scrim = UI_lg(ctx, 'hudScrim2', 0, 0, 0, 96, [
    [0, 'rgba(4,6,10,0.78)'], [0.55, 'rgba(4,6,10,0.34)'], [1, 'rgba(4,6,10,0)']
  ]);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CW, 96);

  // --- helpers -----------------------------------------------------------
  function label(txt, x, y, align){
    ctx.font = '600 9px Oswald, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(196,210,228,0.42)';
    UI_tracked(ctx, txt, x, y, 2.9, align || 'left', false);
  }
  function value(txt, x, y, size, align, alpha){
    ctx.font = '500 ' + size + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = align || 'left';
    ctx.fillStyle = 'rgba(233,240,250,' + (alpha == null ? 0.92 : alpha) + ')';
    ctx.fillText(txt, x, y);
    ctx.textAlign = 'left';
  }

  // --- lives: small glyphs, not gold medallions ---------------------------
  label('VIDAS', 24, 30, 'left');
  for(let i=0;i<Math.max(3, lives);i++){
    const ex = 30 + i*19, ey = 46;
    ctx.save();
    if(i < lives){
      ctx.globalAlpha = 0.88;
      drawBatSymbol(ctx, ex, ey, 7.4, 'rgba(226,236,248,1)');
    } else {
      ctx.globalAlpha = 0.16;
      drawBatSymbol(ctx, ex, ey, 7.4, 'rgba(200,214,232,1)');
    }
    ctx.restore();
  }

  // --- score / batarangs / time ------------------------------------------
  label('PUNTOS', 150, 30, 'left');
  value(UI_pad(s.score, 6), 150, 52, 21, 'left', 0.95);

  label('BATARANGS', 290, 30, 'left');
  ctx.save();
  ctx.globalAlpha = 0.72;
  UI_batarangIcon(ctx, 299, 44, 7.5, t*3.4);
  ctx.restore();
  value(UI_pad(Math.max(0, s.batarangs|0), 2), 314, 51, 18, 'left', 0.82);

  const secs = Math.max(0, Math.floor(t));
  label('TIEMPO', 392, 30, 'left');
  value(UI_pad(Math.floor(secs/60), 2) + ':' + UI_pad(secs%60, 2), 392, 51, 18, 'left', 0.82);

  // --- bat-power: a thin rule, not a chunky meter ------------------------
  if(star){
    const bx = 500, by = 40, bw = 172;
    const frac = UI_clamp((s.starTimer||0)/10, 0, 1);
    label('PODER MURCIÉLAGO', bx, 30, 'left');
    ctx.fillStyle = 'rgba(180,196,216,0.18)';
    ctx.fillRect(bx, by, bw, 2);
    ctx.fillStyle = 'rgba(240,246,255,' + (0.72 + 0.24*pulse).toFixed(3) + ')';
    ctx.fillRect(bx, by, bw*frac, 2);
  }

  // --- level, right aligned ----------------------------------------------
  const rx = CW - 24;
  ctx.font = '600 15px Oswald, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(236,243,252,0.90)';
  UI_tracked(ctx, String(s.levelName || 'GOTHAM').toUpperCase(), rx, 32, 3.6, 'right', false);
  label(String(s.levelId == null ? '1-1' : s.levelId), rx, 50, 'right');
  ctx.save();
  ctx.globalAlpha = 0.38;
  value('RÉCORD ' + UI_pad(s.best, 6), rx, 68, 10, 'right', 1);
  ctx.restore();

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  TITLE SCREEN
// ===========================================================================
function UI_skyline(ctx, t){
  // two parallax silhouette bands with deterministic lit windows
  const bands = [
    { y: 402, h: 150, w0: 34, w1: 78, hi: 120, col: PAL.bldgFar, a: 1.0, seed: 11, win: 0.20 },
    { y: 440, h: 130, w0: 46, w1: 96, hi: 150, col: '#090b18', a: 1.0, seed: 57, win: 0.13 }
  ];
  ctx.save();
  for(let b=0;b<bands.length;b++){
    const B = bands[b];
    let x = -30, i = 0;
    ctx.fillStyle = B.col;
    while(x < CW + 40){
      const r1 = UI_rnd(B.seed + i*1.7);
      const r2 = UI_rnd(B.seed + i*3.3);
      const w  = B.w0 + r1*(B.w1 - B.w0);
      const h  = 50 + r2*B.hi;
      const y  = B.y - h;
      ctx.fillRect(x, y, w, h + B.h);
      // roof detail
      if(r1 > 0.62) ctx.fillRect(x + w*0.35, y - 16 - r2*20, 5, 20 + r2*20);
      if(r2 > 0.78){ ctx.fillRect(x + w*0.12, y - 8, w*0.24, 8); }
      // windows
      for(let wy = y + 10; wy < B.y + 26; wy += 13){
        for(let wx = x + 6; wx < x + w - 7; wx += 12){
          const k = Math.floor(wx*0.37) * 71 + Math.floor(wy*0.53) + B.seed;
          const q = UI_rnd(k);
          if(q < B.win){
            const flick = 0.55 + 0.45*Math.sin(t*(0.7 + UI_rnd(k+4)*2.4) + q*9);
            ctx.save();
            ctx.globalAlpha = 0.20 + 0.55*flick;
            ctx.fillStyle = q < B.win*0.22 ? '#9fd0ff' : PAL.bldgWin;
            ctx.fillRect(wx, wy, 4, 6);
            ctx.restore();
          }
        }
      }
      x += w + 5 + UI_rnd(B.seed + i*5.9)*10;
      i++;
    }
  }
  ctx.restore();
}

function UI_beam(ctx, ax, ay, tx, ty, halfTop, t, seed){
  const dx = tx-ax, dy = ty-ay, L = Math.hypot(dx,dy) || 1;
  const nx = -dy/L, ny = dx/L;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.72 + 0.28*Math.sin(t*1.15 + seed);
  ctx.beginPath();
  ctx.moveTo(ax - nx*7, ay - ny*7);
  ctx.lineTo(tx - nx*halfTop, ty - ny*halfTop);
  ctx.lineTo(tx + nx*halfTop, ty + ny*halfTop);
  ctx.lineTo(ax + nx*7, ay + ny*7);
  ctx.closePath();
  const g = ctx.createLinearGradient(ax, ay, tx, ty);
  g.addColorStop(0, 'rgba(214,226,255,0.22)');
  g.addColorStop(0.40, 'rgba(158,178,240,0.11)');
  g.addColorStop(1, 'rgba(120,140,220,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function UI_rain(ctx, t, n, seed, alpha){
  ctx.save();
  ctx.strokeStyle = PAL.rain;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha == null ? 0.30 : alpha;
  ctx.beginPath();
  for(let i=0;i<n;i++){
    const a = UI_rnd(seed+i), b = UI_rnd(seed+i*2.9), c = UI_rnd(seed+i*5.1);
    const sp = 420 + c*520;
    const xx = ((a*(CW+140) + t*sp*0.18) % (CW + 140)) - 70;
    const y = ((b*CH + t*sp) % (CH + 70)) - 40;
    const len = 11 + c*20;
    ctx.moveTo(xx, y);
    ctx.lineTo(xx - len*0.18, y + len);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTitleScreen(ctx, t, blink){
  t = t || 0;
  ctx.save();

  // --- sky ---------------------------------------------------------------
  ctx.fillStyle = UI_lg(ctx, 'tSky', 0,0,0,CH, [
    [0, PAL.skyTop], [0.32, PAL.skyMid], [0.66, PAL.skyLow], [1,'#0a0713']
  ]);
  ctx.fillRect(0,0,CW,CH);

  // horizon smog glow
  ctx.fillStyle = UI_rg(ctx, 'tSmog', CW*0.5, 430, 30, CW*0.5, 430, 520, [
    [0,'rgba(90,60,140,0.42)'], [0.5,'rgba(50,32,84,0.20)'], [1,'rgba(0,0,0,0)']
  ]);
  ctx.fillRect(0, 180, CW, CH-180);

  // stars (deterministic)
  ctx.save();
  for(let i=0;i<70;i++){
    const x = UI_rnd(i*1.3)*CW, y = UI_rnd(i*2.7)*300;
    const tw = 0.35 + 0.65*Math.abs(Math.sin(t*(0.6 + UI_rnd(i*5.5)) + i));
    ctx.globalAlpha = 0.10 + 0.50*tw*(1 - y/360);
    ctx.fillStyle = '#cfd8f5';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.restore();

  // cloud bank behind the signal
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = UI_rg(ctx, 'tCloud', CW/2, 210, 20, CW/2, 210, 330, [
    [0,'rgba(120,132,190,0.34)'], [0.45,'rgba(70,78,130,0.15)'], [1,'rgba(0,0,0,0)']
  ]);
  ctx.fillRect(0,0,CW,CH);
  ctx.restore();

  // --- searchlight cones -------------------------------------------------
  const sway = Math.sin(t*0.34)*16;
  UI_beam(ctx, 250, 600, 480 + sway*0.4, 205, 165, t, 0.0);
  UI_beam(ctx, 712, 600, 480 + sway*0.4, 205, 150, t, 1.9);
  UI_beam(ctx, 480 - sway, 610, 480 + sway, 150, 90, t, 3.4);

  // --- skyline -----------------------------------------------------------
  UI_skyline(ctx, t);

  // scrim so type stays legible over the skyline
  ctx.fillStyle = UI_lg(ctx, 'tScrim', 0, 300, 0, CH, [
    [0,'rgba(4,5,12,0)'], [0.42,'rgba(4,5,12,0.78)'], [1,'rgba(2,2,7,0.95)']
  ]);
  ctx.fillRect(0, 300, CW, CH-300);

  // --- emblem ------------------------------------------------------------
  const bob = Math.sin(t*0.9)*4;
  UI_emblem(ctx, 480, 205 + bob, 132, t, 1);

  // --- wordmark ----------------------------------------------------------
  drawPanelText(ctx, 'BATMAN', CW/2, 392, 104, {
    align:'center', track: 11, glow: 34,
    color1:'#fff6d0', colorMid:'#f7cf3c', color2:'#b8860b', color3:'#5c3f05'
  });

  UI_rule(ctx, CW/2, 408, 430, 0.55, PAL.yellowD, false);
  UI_caption(ctx, 'DARK KNIGHT RETURNS', CW/2, 432, 16, 'rgba(214,222,248,0.80)', 9.5, 'center', 1);
  UI_rule(ctx, CW/2, 446, 300, 0.35, PAL.yellowD, true);

  // --- prompt + legend ---------------------------------------------------
  UI_prompt(ctx, 'PRESIONA ESPACIO', 492, t, blink);

  ctx.save();
  ctx.globalAlpha = 0.60;
  ctx.font = UI_dispFont(11);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(164,178,218,0.95)';
  UI_tracked(ctx, 'FLECHAS  MOVER     ESPACIO  SALTAR     SHIFT  CORRER     P  PAUSA     M  SONIDO', CW/2, 524, 3.4, 'center', false);
  ctx.restore();

  UI_rain(ctx, t, 90, 3, 0.26);
  UI_motes(ctx, t, 26, 41, 'rgba(245,214,140,0.6)');

  // vignette on top of everything
  ctx.fillStyle = UI_rg(ctx, 'tVig', CW/2, CH*0.45, CH*0.30, CW/2, CH*0.45, CH*1.0, [
    [0,'rgba(0,0,0,0)'], [1,'rgba(0,0,0,0.70)']
  ]);
  ctx.fillRect(0,0,CW,CH);

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  PAUSE
// ===========================================================================
function drawPauseOverlay(ctx, t){
  t = t || 0;
  ctx.save();
  UI_wash(ctx, t, 'rgba(70,86,160,0.30)', 0.86);

  // two vertical pause bars, gold, behind the word
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = PAL.yellow;
  ctx.fillRect(CW/2 - 66, 168, 42, 104);
  ctx.fillRect(CW/2 + 24, 168, 42, 104);
  ctx.restore();

  UI_rule(ctx, CW/2, 232, 520, 0.45, PAL.yellowD, false);
  drawPanelText(ctx, 'PAUSA', CW/2, 300, 82, { align:'center', track: 14, glow: 28 });
  UI_rule(ctx, CW/2, 322, 520, 0.45, PAL.yellowD, true);

  ctx.save();
  ctx.globalAlpha = 0.16;
  drawBatSymbol(ctx, CW/2, 200, 92, '#8fa0d4');
  ctx.restore();

  UI_caption(ctx, 'EL MURCIÉLAGO ESPERA EN LA OSCURIDAD', CW/2, 362, 13, 'rgba(170,184,222,0.72)', 5, 'center', 1);
  UI_prompt(ctx, 'PRESIONA P PARA CONTINUAR', 424, t, true);
  UI_caption(ctx, 'P  CONTINUAR          M  SONIDO', CW/2, 456, 11, 'rgba(150,164,206,0.55)', 3.4, 'center', 1);

  UI_motes(ctx, t, 18, 91, 'rgba(190,205,255,0.5)');
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  DEATH
// ===========================================================================
function drawDeathOverlay(ctx, t, lives){
  t = t || 0;
  const lv = Math.max(0, lives|0);
  ctx.save();
  UI_wash(ctx, t, 'rgba(150,40,40,0.34)', 0.90);

  // fallen emblem: dark, tilted, dim red rim
  ctx.save();
  ctx.translate(CW/2, 196);
  ctx.rotate(-0.16 + Math.sin(t*0.7)*0.015);
  ctx.globalAlpha = 0.95;
  ctx.shadowColor = 'rgba(224,59,59,0.55)';
  ctx.shadowBlur = 30;
  drawBatSymbol(ctx, 0, 0, 92, '#3a1620');
  ctx.shadowBlur = 0;
  drawBatSymbol(ctx, 0, -1.5, 86, UI_lg(ctx, 'deadEmb', 0,-50,0,44, [
    [0,'#2a2030'], [0.5,'#171420'], [1,'#0b0910']
  ]));
  ctx.restore();

  drawPanelText(ctx, 'BATMAN HA CAÍDO', CW/2, 320, 62, {
    align:'center', track: 7, glow: 26,
    color1:'#ffd9d0', colorMid:'#e8603f', color2:'#8f1f1f', color3:'#3d0b0b',
    glowColor:'rgba(224,59,59,0.65)'
  });
  UI_rule(ctx, CW/2, 340, 470, 0.4, PAL.danger, true);

  // remaining lives as emblems
  UI_caption(ctx, 'VIDAS RESTANTES', CW/2, 384, 12, 'rgba(180,188,216,0.75)', 5, 'center', 1);
  const slots = Math.max(3, lv);
  const step = 34, x0 = CW/2 - ((slots-1)*step)/2;
  for(let i=0;i<slots;i++){
    const x = x0 + i*step, y = 416;
    if(i < lv){
      ctx.save();
      ctx.shadowColor = 'rgba(245,197,24,0.6)';
      ctx.shadowBlur = 12;
      drawBatSymbol(ctx, x, y, 14, PAL.yellowD);
      ctx.restore();
      drawBatSymbol(ctx, x, y-1, 12.8, UI_lg(ctx, 'lifeB', 0,-8,0,7, [
        [0,'#fff2bd'], [0.5, PAL.yellow], [1,'#b9860a']
      ]));
    } else {
      ctx.save();
      ctx.globalAlpha = 0.20;
      drawBatSymbol(ctx, x, y, 12.8, '#66708f');
      ctx.restore();
    }
  }

  UI_prompt(ctx, lv > 0 ? 'PRESIONA ESPACIO PARA VOLVER' : 'LA NOCHE RECLAMA GOTHAM', 474, t, true);
  UI_motes(ctx, t, 20, 133, 'rgba(255,150,140,0.45)');
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  LEVEL COMPLETE
// ===========================================================================
function drawLevelCompleteOverlay(ctx, t, score, levelName){
  t = t || 0;
  ctx.save();
  UI_wash(ctx, t, 'rgba(245,197,24,0.26)', 0.88);

  // radiating gold shafts behind the heading
  ctx.save();
  ctx.translate(CW/2, 168);
  ctx.globalCompositeOperation = 'lighter';
  for(let i=0;i<14;i++){
    const a = (i/14)*Math.PI*2 + t*0.22;
    ctx.save();
    ctx.rotate(a);
    ctx.globalAlpha = 0.05 + 0.05*Math.abs(Math.sin(t*1.2 + i));
    ctx.fillStyle = UI_lg(ctx, 'lcShaft', 0,0, 0,-330, [
      [0,'rgba(255,214,90,0.9)'], [1,'rgba(255,214,90,0)']
    ]);
    ctx.beginPath();
    ctx.moveTo(-9, 0); ctx.lineTo(0, -330); ctx.lineTo(9, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  UI_emblem(ctx, CW/2, 172, 74, t, 0.9);

  drawPanelText(ctx, 'NIVEL COMPLETADO', CW/2, 300, 58, { align:'center', track: 6, glow: 30 });
  UI_rule(ctx, CW/2, 320, 560, 0.5, PAL.yellow, true);

  UI_caption(ctx, String(levelName || 'GOTHAM').toUpperCase(), CW/2, 352, 15, 'rgba(222,230,252,0.85)', 7, 'center', 1);

  // tally plate
  const px = CW/2 - 190, py = 372, pw = 380, ph = 74;
  ctx.save();
  ctx.beginPath(); UI_roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = UI_lg(ctx, 'lcPlate', 0, py, 0, py+ph, [
    [0,'rgba(16,18,36,0.88)'], [1,'rgba(7,8,18,0.88)']
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,24,0.34)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  UI_caption(ctx, 'PUNTUACIÓN TOTAL', px + 22, py + 28, 11, 'rgba(158,172,212,0.75)', 3.2, 'left');
  UI_num(ctx, UI_pad(score, 6), px + pw - 22, py + 58, 30, 'right', '#fff3c4', PAL.yellowD, 14);

  // sweeping highlight across the plate
  ctx.save();
  ctx.beginPath(); UI_roundRect(ctx, px, py, pw, ph, 10); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = UI_lg(ctx, 'lcSweep', 0,0,110,0, [
    [0,'rgba(255,255,255,0)'], [0.5,'rgba(255,240,200,1)'], [1,'rgba(255,255,255,0)']
  ]);
  ctx.translate(px + ((t*220) % (pw + 200)) - 130, py);
  ctx.fillRect(0, 0, 110, ph);
  ctx.restore();

  UI_prompt(ctx, 'PRESIONA ESPACIO PARA CONTINUAR', 486, t, true);
  UI_motes(ctx, t, 28, 211, 'rgba(255,226,150,0.6)');
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  GAME OVER
// ===========================================================================
function UI_cracks(ctx, cx, cy, r, seed, prog){
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for(let i=0;i<10;i++){
    const start = (i/10)*Math.PI*2 + UI_rnd(seed+i)*0.55;
    let a = start, x = 0, y = 0;
    const segs = 4 + Math.floor(UI_rnd(seed + i*3.1)*3);
    ctx.beginPath();
    ctx.moveTo(0,0);
    for(let j=0;j<segs;j++){
      const len = r*(0.13 + UI_rnd(seed + i*7.3 + j)*0.17)*prog;
      a += (UI_rnd(seed + i*11.7 + j*2.3) - 0.5)*0.95;
      x += Math.cos(a)*len; y += Math.sin(a)*len*0.8;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(245,197,24,0.42)';
    ctx.lineWidth = 2.6;
    ctx.shadowColor = 'rgba(245,197,24,0.8)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(4,4,10,0.92)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGameOverOverlay(ctx, t, score, best, blink){
  t = t || 0;
  const prog = UI_clamp(t*0.9, 0.15, 1);
  ctx.save();
  UI_wash(ctx, t, 'rgba(120,30,30,0.26)', 0.94);

  // cracked emblem
  const cx = CW/2, cy = 184, r = 92;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = 'rgba(180,40,40,0.5)';
  ctx.shadowBlur = 34;
  drawBatSymbol(ctx, cx, cy, r*1.03, '#40202c');
  ctx.shadowBlur = 0;
  drawBatSymbol(ctx, cx, cy, r, UI_lg(ctx, 'goEmb', 0,-r*0.55, 0, r*0.5, [
    [0,'#2b2436'], [0.5,'#16131f'], [1,'#09080e']
  ]));
  ctx.restore();
  UI_cracks(ctx, cx, cy - 4, r, 17, prog);
  // fallen shard drifting down
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(cx + 52, cy + 30 + Math.min(64, t*22));
  ctx.rotate(0.5 + t*0.35);
  ctx.fillStyle = '#191523';
  ctx.beginPath();
  ctx.moveTo(0,0); ctx.lineTo(20,-7); ctx.lineTo(13,13); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,24,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();

  drawPanelText(ctx, 'GAME OVER', CW/2, 320, 78, {
    align:'center', track: 10, glow: 30,
    color1:'#ffe0d2', colorMid:'#e0a53b', color2:'#8b2a1c', color3:'#340a08',
    glowColor:'rgba(224,59,59,0.55)'
  });
  UI_rule(ctx, CW/2, 342, 520, 0.45, PAL.danger, true);

  UI_caption(ctx, 'PUNTOS', CW/2 - 150, 388, 11, 'rgba(158,172,212,0.72)', 3.2, 'center');
  UI_num(ctx, UI_pad(score, 6), CW/2 - 150, 420, 26, 'center', '#fff3c4', PAL.yellowD, 10);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = PAL.yellowD;
  ctx.fillRect(CW/2 - 1, 378, 2, 48);
  ctx.restore();
  UI_caption(ctx, 'RÉCORD', CW/2 + 150, 388, 11, 'rgba(158,172,212,0.72)', 3.2, 'center');
  UI_num(ctx, UI_pad(best, 6), CW/2 + 150, 420, 26, 'center', '#d9e2ff', '#77839f', 0);

  UI_caption(ctx, 'GOTHAM CONTIENE EL ALIENTO', CW/2, 452, 12, 'rgba(168,180,216,0.6)', 4.2, 'center', 1);
  UI_prompt(ctx, 'PRESIONA ESPACIO PARA REINTENTAR', 492, t, blink);
  UI_motes(ctx, t, 22, 303, 'rgba(255,140,120,0.4)');
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================================================================
//  WIN
// ===========================================================================
function drawWinOverlay(ctx, t, score, best, blink){
  t = t || 0;
  ctx.save();
  UI_wash(ctx, t, 'rgba(245,197,24,0.30)', 0.86);

  // dawn breaking at the horizon
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.10*Math.sin(t*0.8);
  ctx.fillStyle = UI_rg(ctx, 'winDawn', CW/2, 560, 40, CW/2, 560, 460, [
    [0,'rgba(255,196,90,0.55)'], [0.45,'rgba(190,110,60,0.20)'], [1,'rgba(0,0,0,0)']
  ]);
  ctx.fillRect(0, 200, CW, CH-200);
  ctx.restore();

  // god rays from above
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(let i=0;i<9;i++){
    const base = (i/9)*CW + Math.sin(t*0.3 + i)*22;
    ctx.globalAlpha = 0.05 + 0.05*Math.abs(Math.sin(t*0.9 + i*1.3));
    ctx.fillStyle = UI_lg(ctx, 'winRay', 0,0,0,CH, [
      [0,'rgba(255,228,160,0.85)'], [0.75,'rgba(255,210,120,0.10)'], [1,'rgba(255,210,120,0)']
    ]);
    ctx.beginPath();
    ctx.moveTo(base - 16, -10);
    ctx.lineTo(base + 16, -10);
    ctx.lineTo(base + 92, CH);
    ctx.lineTo(base + 30, CH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  UI_emblem(ctx, CW/2, 178, 108, t, 1.25);

  drawPanelText(ctx, 'GOTHAM ESTÁ A SALVO', CW/2, 330, 58, { align:'center', track: 6, glow: 36 });
  UI_rule(ctx, CW/2, 350, 600, 0.55, PAL.yellow, true);

  UI_caption(ctx, 'EL CABALLERO OSCURO VELA SOBRE LA CIUDAD', CW/2, 382, 13, 'rgba(226,233,253,0.82)', 5.4, 'center', 1);

  UI_caption(ctx, 'PUNTOS', CW/2 - 150, 416, 11, 'rgba(158,172,212,0.72)', 3.2, 'center');
  UI_num(ctx, UI_pad(score, 6), CW/2 - 150, 448, 27, 'center', '#fff3c4', PAL.yellowD, 14);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = PAL.yellowD;
  ctx.fillRect(CW/2 - 1, 406, 2, 48);
  ctx.restore();
  UI_caption(ctx, 'RÉCORD', CW/2 + 150, 416, 11, 'rgba(158,172,212,0.72)', 3.2, 'center');
  UI_num(ctx, UI_pad(best, 6), CW/2 + 150, 448, 27, 'center', '#d9e2ff', '#77839f', 0);

  UI_prompt(ctx, 'PRESIONA ESPACIO PARA JUGAR DE NUEVO', 500, t, blink);

  // rising gold embers
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(let i=0;i<36;i++){
    const a = UI_rnd(i*1.9), b = UI_rnd(i*4.4), c = UI_rnd(i*8.1);
    const x = a*CW + Math.sin(t*(0.5 + b) + i)*30;
    const y = CH - (((t*(26 + c*44) + b*CH) % (CH + 60)));
    ctx.globalAlpha = 0.18 + 0.45*Math.abs(Math.sin(t*1.4 + i));
    ctx.fillStyle = c > 0.7 ? '#fff3c4' : PAL.yellow;
    ctx.beginPath();
    ctx.arc(x % CW, y, 1 + c*2.2, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
