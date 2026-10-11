// ===========================================================================
//  batman.js  --  the player character.  Module prefix: BM_
//  Pure Canvas2D. No images, no libs. Deterministic (animTime driven).
//  Public: drawBatmanSprite(ctx,x,y,w,h,o)   drawBatSymbol(ctx,cx,cy,r,color)
//
//  ART NOTE.  The renderer runs a deferred lighting pass (normal buffer +
//  Blinn-Phong + Fresnel + bloom + ACES) over this canvas, so the art here is
//  ALBEDO ONLY: it must stay dark and flat and let the light pass supply the
//  highlights.  Every value below is chosen on that basis -- the suit is a
//  matte black composite, separated from Gotham by VALUE, not by hue, and the
//  only warm note in the whole figure is a bronze emblem, not a yellow one.
// ===========================================================================

// The jaw is the only skin on screen; kept dark and cool so it is a quiet
// break in the silhouette rather than a pink flag.
const BM_SKIN   = '#86705b';
const BM_SKIN_D = '#4a3b30';
const BM_SKIN_L = '#9d836b';
const BM_INK    = '#06070a';

// -- suit materials --------------------------------------------------------
const BM_PLATE   = '#171a21';   // armour plate, main value
const BM_PLATE_H = '#262c35';   // plate turned toward the sky
const BM_PLATE_D = '#080a0e';   // recess, under-plate, shadow side
const BM_UNDER   = '#0c0e13';   // bodysuit showing between plates
const BM_EDGE    = 'rgba(148,170,212,0.16)';   // cold plate lip -- faint on purpose
const BM_EDGE_S  = 'rgba(158,180,220,0.26)';   // the one or two edges that carry
const BM_SEAM    = 'rgba(0,0,0,0.55)';
const BM_GOLD    = '#7c6939';   // muted bronze. Under the global 0.44 saturation
const BM_GOLD_H  = '#9a8550';   // this lands as a warm grey, which is the point.
const BM_GOLD_D  = '#3b3118';

// -- deterministic pseudo random ------------------------------------------
function BM_rnd(n){ const s = Math.sin(n*127.1+311.7)*43758.5453; return s - Math.floor(s); }
function BM_clamp(v,a,b){ return v<a?a:(v>b?b:v); }

// -- rounded rect (roundRect may be missing) ------------------------------
function BM_roundRect(ctx,x,y,w,h,r){
  if(ctx.roundRect){ ctx.roundRect(x,y,w,h,r); return; }
  const rr = Math.min(r, Math.abs(w)*0.5, Math.abs(h)*0.5);
  ctx.moveTo(x+rr,y);
  ctx.lineTo(x+w-rr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
  ctx.lineTo(x+w,y+h-rr); ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
  ctx.lineTo(x+rr,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
  ctx.lineTo(x,y+rr); ctx.quadraticCurveTo(x,y,x+rr,y);
  ctx.closePath();
}

// -- gradient cache. Gradients are built in the sprite-local frame so the
//    CTM does the positioning and one object serves every frame. -----------
const BM_gcache = {};
let   BM_gctx = null;
function BM_grad(ctx, key, x0,y0,x1,y1, stops){
  if(BM_gctx !== ctx){ BM_gctx = ctx; for(const k in BM_gcache) delete BM_gcache[k]; }
  let g = BM_gcache[key];
  if(!g){
    g = ctx.createLinearGradient(x0,y0,x1,y1);
    for(let i=0;i<stops.length;i++) g.addColorStop(stops[i][0], stops[i][1]);
    BM_gcache[key] = g;
  }
  return g;
}

// -- tapered capsule between two joints -----------------------------------
function BM_bone(ctx, ax,ay,bx,by, wa, wb){
  const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy)||0.0001;
  const nx=-dy/L, ny=dx/L, a=Math.atan2(dy,dx);
  wa = Math.max(0.35, wa); wb = Math.max(0.35, wb);
  ctx.beginPath();
  ctx.arc(ax,ay,wa, a+Math.PI/2, a-Math.PI/2);
  ctx.lineTo(bx-nx*wb, by-ny*wb);
  ctx.arc(bx,by,wb, a-Math.PI/2, a+Math.PI/2);
  ctx.closePath();
}

// -- inset border: a dark lip just inside a path, which is what gives a
//    plate or a cape hem its thickness without adding another path. --------
function BM_inset(ctx, pathFn, color, width){
  ctx.save();
  pathFn(); ctx.clip();
  pathFn();
  ctx.strokeStyle = color; ctx.lineWidth = width*2; ctx.lineJoin='round';
  ctx.stroke();
  ctx.restore();
}

// ===========================================================================
//  BAT SYMBOL  --  real scalloped bat silhouette, r = half width.
//  Shared with the HUD, the title and the overlays, so the proportions here
//  are load-bearing well outside this module: leave the shape alone.
// ===========================================================================
function BM_batPath(ctx, r){
  const S = r;
  // finger tips of the lower wing edge, inner -> outer
  const tx=[0.24,0.50,0.74,1.00], ty=[0.20,0.23,0.10,-0.30];
  const notch=[0.17,0.19,0.21];
  ctx.beginPath();
  ctx.moveTo(0, 0.46*S);
  ctx.quadraticCurveTo(0.11*S, 0.36*S, tx[0]*S, ty[0]*S);
  for(let i=0;i<3;i++){
    const mx=(tx[i]+tx[i+1])*0.5, my=(ty[i]+ty[i+1])*0.5;
    ctx.quadraticCurveTo(mx*S, (my-notch[i])*S, tx[i+1]*S, ty[i+1]*S);
  }
  ctx.bezierCurveTo(0.80*S,-0.54*S, 0.44*S,-0.42*S, 0.21*S,-0.29*S);   // upper wing sweep
  ctx.quadraticCurveTo(0.16*S,-0.33*S, 0.105*S,-0.53*S);               // ear
  ctx.quadraticCurveTo(0.06*S,-0.34*S, 0,-0.27*S);                     // head dip
  ctx.quadraticCurveTo(-0.06*S,-0.34*S,-0.105*S,-0.53*S);
  ctx.quadraticCurveTo(-0.16*S,-0.33*S,-0.21*S,-0.29*S);
  ctx.bezierCurveTo(-0.44*S,-0.42*S,-0.80*S,-0.54*S, -tx[3]*S, ty[3]*S);
  for(let i=3;i>0;i--){
    const mx=(tx[i]+tx[i-1])*0.5, my=(ty[i]+ty[i-1])*0.5;
    ctx.quadraticCurveTo(-mx*S, (my-notch[i-1])*S, -tx[i-1]*S, ty[i-1]*S);
  }
  ctx.quadraticCurveTo(-0.11*S, 0.36*S, 0, 0.46*S);
  ctx.closePath();
}

function drawBatSymbol(ctx, cx, cy, r, color){
  ctx.save();
  ctx.translate(cx, cy);
  BM_batPath(ctx, r);
  ctx.fillStyle = color || PAL.batLo;
  ctx.fill();
  ctx.restore();
}

// Chest emblem variant: two heavy scallops instead of four, a thicker body,
// no head dip. The HUD bat has detail the chest cannot hold -- at 42px tall
// the four-finger version turns to mush, this one still reads as a bat.
function BM_chestBatPath(ctx, rx, ry){
  ctx.beginPath();
  ctx.moveTo(0, ry*0.98);                                    // tail point
  ctx.quadraticCurveTo(rx*0.16, ry*0.62, rx*0.38, ry*0.40);
  ctx.quadraticCurveTo(rx*0.56, ry*0.08, rx*0.70, ry*0.42);  // first scallop
  ctx.quadraticCurveTo(rx*0.86, ry*0.02, rx*1.00, ry*0.18);  // outer tip
  ctx.bezierCurveTo(rx*0.86,-ry*0.86, rx*0.44,-ry*0.74, rx*0.21,-ry*0.40);
  ctx.quadraticCurveTo(rx*0.11,-ry*0.52, 0,-ry*0.46);        // shoulder of the body
  ctx.quadraticCurveTo(-rx*0.11,-ry*0.52,-rx*0.21,-ry*0.40);
  ctx.bezierCurveTo(-rx*0.44,-ry*0.74,-rx*0.86,-ry*0.86,-rx*1.00, ry*0.18);
  ctx.quadraticCurveTo(-rx*0.86, ry*0.02,-rx*0.70, ry*0.42);
  ctx.quadraticCurveTo(-rx*0.56, ry*0.08,-rx*0.38, ry*0.40);
  ctx.quadraticCurveTo(-rx*0.16, ry*0.62, 0, ry*0.98);
  ctx.closePath();
}

// ===========================================================================
//  POSE  --  joint angles. 0 rad = forward(+x), PI/2 = straight down.
// ===========================================================================
function BM_pose(state, t, speed, big, W, H){
  const sp = BM_clamp(speed,0,260)/260;
  const P = {
    tilt:0, sx:1, sy:1, ox:0, oy:0, bob:0, lean:0,
    hipY:0.618*H, shY:0.322*H,
    legF:{a:Math.PI/2, k:0.06}, legB:{a:Math.PI/2, k:0.06},
    armF:{a:Math.PI/2+0.18, k:0.20}, armB:{a:Math.PI/2+0.26, k:0.26}
  };
  const ph = t*(4.2 + sp*11.5);
  switch(state){
    case 'run': {
      const A = 0.52 + sp*0.62;
      P.legF.a = Math.PI/2 - A*Math.sin(ph);
      P.legF.k = 0.12 + 1.05*Math.max(0,-Math.sin(ph+0.9));
      P.legB.a = Math.PI/2 + A*Math.sin(ph);
      P.legB.k = 0.12 + 1.05*Math.max(0, Math.sin(ph+0.9));
      P.armF.a = Math.PI/2 + (0.38+0.40*sp)*Math.sin(ph);
      P.armF.k = 0.55 + 0.35*Math.max(0,-Math.sin(ph));
      P.armB.a = Math.PI/2 - (0.34+0.36*sp)*Math.sin(ph);
      P.armB.k = 0.55 + 0.35*Math.max(0, Math.sin(ph));
      P.bob   = -Math.abs(Math.sin(ph))*0.022*H;
      P.lean  = -0.05 - 0.10*sp;      // lean into the run
      break;
    }
    case 'jump': {
      P.legF.a = Math.PI/2 - 0.92; P.legF.k = 1.45;
      P.legB.a = Math.PI/2 + 0.46; P.legB.k = 0.52;
      P.armF.a = Math.PI/2 - 0.85; P.armF.k = 0.55;
      P.armB.a = Math.PI/2 + 0.85; P.armB.k = 0.35;
      P.lean = -0.06;
      break;
    }
    case 'fall': {
      P.legF.a = Math.PI/2 - 0.34; P.legF.k = 0.78;
      P.legB.a = Math.PI/2 + 0.50; P.legB.k = 0.30;
      P.armF.a = Math.PI/2 - 0.42; P.armF.k = 0.30;
      P.armB.a = Math.PI/2 + 1.00; P.armB.k = 0.22;
      P.lean = 0.05;
      break;
    }
    case 'glide': {
      const fl = Math.sin(t*2.2)*0.07;
      P.legF.a = Math.PI/2 + 0.30 + fl*0.4; P.legF.k = 0.10;
      P.legB.a = Math.PI/2 + 0.44 + fl*0.4; P.legB.k = 0.16;
      P.armF.a = Math.PI/2 - 1.22 + fl;     P.armF.k = 0.05;
      P.armB.a = Math.PI/2 - 1.05 + fl;     P.armB.k = 0.08;
      P.lean = -0.14;
      P.bob = Math.sin(t*1.9)*0.012*H;
      break;
    }
    case 'duck': {
      P.sx = 1.14; P.sy = 0.60;
      P.legF.a = Math.PI/2 - 0.62; P.legF.k = 1.55;
      P.legB.a = Math.PI/2 - 0.18; P.legB.k = 1.80;
      P.armF.a = Math.PI/2 - 0.30; P.armF.k = 0.95;
      P.armB.a = Math.PI/2 + 0.20; P.armB.k = 0.85;
      P.lean = -0.10;
      break;
    }
    case 'dead': {
      P.tilt = -0.62;
      P.oy   = -0.04*H;
      P.legF.a = Math.PI/2 - 0.30; P.legF.k = 0.14;
      P.legB.a = Math.PI/2 + 0.22; P.legB.k = 0.10;
      P.armF.a = Math.PI/2 - 1.65; P.armF.k = 0.10;
      P.armB.a = Math.PI/2 + 1.55; P.armB.k = 0.12;
      break;
    }
    default: {  // idle -- breathing
      const b = Math.sin(t*2.0);
      P.bob    = b*0.010*H;
      P.legF.a = Math.PI/2 - 0.07; P.legF.k = 0.07;
      P.legB.a = Math.PI/2 + 0.10; P.legB.k = 0.12;
      P.armF.a = Math.PI/2 + 0.16 + b*0.03; P.armF.k = 0.22;
      P.armB.a = Math.PI/2 + 0.30 - b*0.03; P.armB.k = 0.30;
      P.lean   = -0.02;
    }
  }
  if(big){ P.shY -= 0.008*H; }
  return P;
}

// ===========================================================================
//  CAPE geometry + path
// ===========================================================================
function BM_capeGeo(state, t, speed, W, H){
  const sp = BM_clamp(speed,0,260)/260;
  // Heavier than it was: a longer radius and a wider base arc, so the cape
  // hangs with weight instead of fluttering like cloth.
  let lo=1.26, hi=2.30, R=0.72*H, n=4, swayAmp=0.09, flut=1;
  switch(state){
    case 'run':   lo=1.30; hi=2.28+0.58*sp; R=(0.70+0.14*sp)*H; swayAmp=0.06+0.09*sp; break;
    case 'jump':  lo=0.98; hi=2.84; R=0.86*H; swayAmp=0.13; break;
    case 'fall':  lo=1.06; hi=2.92; R=0.89*H; swayAmp=0.16; break;
    case 'glide': lo=0.26; hi=3.04; R=0.88*H; n=5; swayAmp=0.06; break;
    case 'duck':  lo=1.46; hi=2.58; R=0.54*H; swayAmp=0.04; break;
    case 'dead':  lo=1.54; hi=2.20; R=0.60*H; swayAmp=0.00; flut=0; break;
  }
  const sway = swayAmp*(Math.sin(t*2.7)*0.7 + Math.sin(t*1.63+1.1)*0.3);
  hi += sway; lo += sway*0.30;
  const ax = -0.040*W, ay = 0.288*H;
  const tips = [];
  for(let i=0;i<n;i++){
    const f = (n===1)?0:i/(n-1);
    const a = lo + (hi-lo)*f;
    // a thicker cloth swings less: damp the flutter toward the hem
    const r = R*(0.82 + 0.23*f) * (1 + 0.048*flut*Math.sin(t*5.3 + i*1.9));
    tips.push({a:a, r:r, x:ax+Math.cos(a)*r, y:ay+Math.sin(a)*r});
  }
  return {ax:ax, ay:ay, tips:tips, R:R, W:W, H:H};
}

function BM_capePath(ctx, g, k){
  k = (k==null)?1:k;
  const ax=g.ax, ay=g.ay, W=g.W, H=g.H, T=g.tips;
  const X = function(p){ return ax + (p.x-ax)*k; };
  const Y = function(p){ return ay + (p.y-ay)*k; };
  ctx.beginPath();
  ctx.moveTo(ax+0.14*W, ay-0.038*H);
  ctx.quadraticCurveTo(ax+0.19*W, ay+0.21*H*k, X(T[0]), Y(T[0]));   // leading edge
  for(let i=0;i<T.length-1;i++){
    const a=T[i], b=T[i+1];
    const ma=(a.a+b.a)*0.5, mr=(a.r+b.r)*0.5*0.76*k;                // shallower scallop = heavier cloth
    ctx.quadraticCurveTo(ax+Math.cos(ma)*mr, ay+Math.sin(ma)*mr, X(b), Y(b));
  }
  ctx.bezierCurveTo(ax-0.44*W, ay+0.17*H, ax-0.38*W, ay-0.02*H, ax-0.19*W, ay-0.082*H);
  ctx.quadraticCurveTo(ax+0.03*W, ay-0.12*H, ax+0.14*W, ay-0.038*H);
  ctx.closePath();
}

function BM_drawCape(ctx, g, W, H, u){
  const key = H.toFixed(1)+'_'+Math.round(g.R);
  ctx.save();
  // main membrane. Darker than the suit so the figure sits IN FRONT of its own
  // cape rather than dissolving into it.
  BM_capePath(ctx, g, 1);
  ctx.fillStyle = BM_grad(ctx,'cape'+key, 0, g.ay-0.12*H, 0, g.ay+g.R,
    [[0,'#1a1f27'],[0.24,'#0f1218'],[0.70,'#07080c'],[1,'#030408']]);
  ctx.fill();

  // the hem. A thick dark lip just inside the trailing edge is what sells
  // weight -- a real cape of this mass has a seam you can see.
  BM_inset(ctx, function(){ BM_capePath(ctx, g, 1); }, 'rgba(2,3,6,0.72)', 1.5*u);

  // inner fold, darker, offset toward the back
  ctx.save();
  ctx.translate(-0.05*W, 0.016*H);
  BM_capePath(ctx, g, 0.68);
  ctx.fillStyle = 'rgba(3,4,8,0.58)';
  ctx.fill();
  ctx.restore();

  // fold structure radiating from the neck: a dark crease and, just beside it,
  // a barely-there cold one. Value variation, not line work.
  for(let i=0;i<g.tips.length;i++){
    const T=g.tips[i];
    const x0=g.ax+Math.cos(T.a)*0.11*H, y0=g.ay+Math.sin(T.a)*0.11*H;
    const cx=g.ax+Math.cos(T.a-0.11)*T.r*0.62, cy=g.ay+Math.sin(T.a-0.11)*T.r*0.62;
    const x1=g.ax+(T.x-g.ax)*0.93, y1=g.ay+(T.y-g.ay)*0.93;
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 1.5*u;
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.quadraticCurveTo(cx,cy,x1,y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(132,152,196,0.055)';
    ctx.lineWidth = 0.8*u;
    ctx.beginPath();
    ctx.moveTo(x0+0.9*u,y0); ctx.quadraticCurveTo(cx+1.4*u,cy,x1+1.2*u,y1); ctx.stroke();
  }

  // a single restrained cold edge along the leading (lit) side only. The
  // deferred pass lights the rest; this just keeps the cape from vanishing
  // into the sky on a bright frame.
  ctx.strokeStyle = BM_grad(ctx,'capeRim'+key, 0, g.ay-0.05*H, 0, g.ay+g.R*0.6,
    [[0,'rgba(170,194,238,0.22)'],[0.45,'rgba(140,164,208,0.07)'],[1,'rgba(110,132,176,0)']]);
  ctx.lineWidth = 0.85*u; ctx.lineJoin='round';
  ctx.beginPath();
  ctx.moveTo(g.ax+0.14*W, g.ay-0.038*H);
  ctx.quadraticCurveTo(g.ax+0.185*W, g.ay+0.15*H,
                       g.ax+(g.tips[0].x-g.ax)*0.56, g.ay+(g.tips[0].y-g.ay)*0.56);
  ctx.stroke();
  ctx.restore();
}

// ===========================================================================
//  BODY PARTS
// ===========================================================================
// Armoured torso: a hard shoulder line, a real taper to the waist, and a
// slight flare at the hips. The shoulder corner is the single most valuable
// thing in the silhouette at this size, so it is a corner, not a curve.
function BM_torsoPath(ctx, W, H, big){
  const sw=(big?0.392:0.348)*W, sy=0.312*H,
        ww=(big?0.234:0.212)*W, wy=0.548*H,
        hw=(big?0.272:0.252)*W, hy=0.636*H,
        ny=0.278*H;
  ctx.beginPath();
  ctx.moveTo(-sw*0.38, ny+0.004*H);
  ctx.quadraticCurveTo(-sw*0.84, ny+0.004*H, -sw*1.00, sy-0.004*H);     // trapezius
  ctx.quadraticCurveTo(-sw*1.06, sy+0.052*H, -ww*1.14, wy-0.052*H);     // outer deltoid / lat
  ctx.quadraticCurveTo(-ww*1.02, wy-0.004*H, -ww*1.00, wy);
  ctx.bezierCurveTo(-hw*1.00, wy+0.030*H, -hw*1.00, hy-0.014*H, -hw*0.94, hy);
  ctx.lineTo(hw*0.94, hy);
  ctx.bezierCurveTo(hw*1.00, hy-0.014*H, hw*1.00, wy+0.030*H, ww*1.02, wy);
  ctx.quadraticCurveTo(ww*1.06, wy-0.004*H, ww*1.16, wy-0.052*H);
  ctx.quadraticCurveTo(sw*1.08, sy+0.052*H, sw*1.02, sy-0.006*H);
  ctx.quadraticCurveTo(sw*0.86, ny+0.002*H, sw*0.40, ny+0.004*H);
  ctx.quadraticCurveTo(0, ny-0.020*H, -sw*0.38, ny+0.004*H);
  ctx.closePath();
}

// A shoulder plate. side=+1 is the camera-side shoulder. Wide and FLAT, with
// a hard outer corner: an earlier pass made it tall and round and it read as
// a satchel slung on the shoulder rather than as armour.
function BM_pauldronM(W, H, side, big){
  return {
    sx: side*(big?0.272:0.244)*W, sy: 0.330*H,
    rw: (big?0.166:0.152)*W,      rh: (big?0.056:0.050)*H
  };
}

// The top plane rises at the neck end and FALLS toward the outer corner, the
// way a real spaulder follows the deltoid. Flat all the way across read as a
// plank bolted to the shoulder.
function BM_pauldronPath(ctx, W, H, side, big){
  const m = BM_pauldronM(W,H,side,big), sx=m.sx, sy=m.sy, rw=m.rw, rh=m.rh;
  ctx.beginPath();
  ctx.moveTo(sx - side*rw*1.00, sy + rh*0.30);
  ctx.quadraticCurveTo(sx - side*rw*0.84, sy - rh*0.88, sx - side*rw*0.20, sy - rh*1.00);
  ctx.quadraticCurveTo(sx + side*rw*0.48, sy - rh*1.04, sx + side*rw*0.86, sy - rh*0.22);
  ctx.lineTo(sx + side*rw*0.98, sy + rh*0.56);                       // hard outer corner
  ctx.quadraticCurveTo(sx + side*rw*0.46, sy + rh*1.30, sx - side*rw*0.40, sy + rh*1.16);
  ctx.quadraticCurveTo(sx - side*rw*0.92, sy + rh*0.96, sx - side*rw*1.00, sy + rh*0.30);
  ctx.closePath();
}

function BM_drawPauldron(ctx, W, H, side, big, u, front){
  const m = BM_pauldronM(W,H,side,big), sx=m.sx, sy=m.sy, rw=m.rw, rh=m.rh;
  ctx.save();
  BM_pauldronPath(ctx, W, H, side, big);
  ctx.fillStyle = front
    ? BM_grad(ctx,'pauF'+H.toFixed(1)+(big?'b':'s'), 0, sy-rh, 0, sy+rh*1.3,
        [[0,'#242a34'],[0.42,BM_PLATE],[1,BM_PLATE_D]])
    : '#090b10';
  ctx.fill();
  ctx.save();
  BM_pauldronPath(ctx, W, H, side, big); ctx.clip();
  // lamellar strip under the main plate -- two shallow bands, low contrast
  ctx.strokeStyle = BM_SEAM; ctx.lineWidth = 0.7*u;
  for(let i=0;i<2;i++){
    const yy = sy + rh*(0.30 + i*0.46);
    ctx.beginPath();
    ctx.moveTo(sx - side*rw*1.3, yy - rh*0.14);
    ctx.quadraticCurveTo(sx, yy + rh*0.10, sx + side*rw*1.3, yy - rh*0.08);
    ctx.stroke();
  }
  // deep shadow where the plate wraps under
  ctx.fillStyle = BM_grad(ctx,'pauSh'+H.toFixed(1)+(big?'b':'s'), 0, sy-rh*0.2, 0, sy+rh*1.4,
    [[0,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,0.64)']]);
  ctx.fillRect(sx-rw*1.4, sy-rh*0.2, rw*2.8, rh*1.8);
  ctx.restore();
  if(front){
    // one hard cold lip on the top plane. This is the shoulder line the eye
    // actually tracks; it is the only strong baked edge left on the body.
    ctx.strokeStyle = BM_EDGE_S; ctx.lineWidth = 0.7*u; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(sx - side*rw*0.92, sy - rh*0.30);
    ctx.quadraticCurveTo(sx - side*rw*0.80, sy - rh*0.86, sx - side*rw*0.20, sy - rh*0.98);
    ctx.quadraticCurveTo(sx + side*rw*0.46, sy - rh*1.02, sx + side*rw*0.84, sy - rh*0.24);
    ctx.stroke();
  }
  ctx.restore();
}

// Gorget: the collar ring under the chin. Small, but it is what stops the
// cowl reading as a head balanced on a bean.
function BM_drawGorget(ctx, W, H, big, u){
  const cx = 0.030*W, w = (big?0.218:0.196)*W, y0 = 0.250*H, hgt = (big?0.058:0.052)*H;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx-w, y0+hgt*0.22);
  ctx.quadraticCurveTo(cx-w*0.52, y0-hgt*0.30, cx+w*0.30, y0-hgt*0.26);
  ctx.quadraticCurveTo(cx+w*0.98, y0-hgt*0.04, cx+w*1.04, y0+hgt*0.46);
  ctx.quadraticCurveTo(cx+w*0.60, y0+hgt*1.18, cx-w*0.30, y0+hgt*1.10);
  ctx.quadraticCurveTo(cx-w*0.94, y0+hgt*0.86, cx-w, y0+hgt*0.22);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'gorget'+H.toFixed(1)+(big?'b':'s'), 0, y0-hgt*0.3, 0, y0+hgt*1.2,
    [[0,'#2a313b'],[0.5,BM_PLATE],[1,BM_PLATE_D]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.58)'; ctx.lineWidth = 0.6*u; ctx.stroke();
  // throat seam
  ctx.strokeStyle = BM_EDGE; ctx.lineWidth = 0.6*u;
  ctx.beginPath();
  ctx.moveTo(cx-w*0.62, y0+hgt*0.12);
  ctx.quadraticCurveTo(cx+w*0.14, y0-hgt*0.14, cx+w*0.92, y0+hgt*0.26);
  ctx.stroke();
  ctx.restore();
}

// One source of truth for the cowl's measurements: the path and the face
// detail have to agree exactly or the eyes drift off the brow.
// The head sits HIGH: a visible neck between the jaw and the shoulder plates
// is what stops the cowl ears plus the pauldron reading as the brim of a hat,
// which is exactly what happened when the two overlapped.
function BM_cowlM(W, H){
  return { cx:0.040*W, hw:0.180*W, ty:0.116*H, by:0.272*H, eh:0.134*H };
}

// The skull is a TRAPEZOID -- widest at the cheekbone, tapering up -- with the
// ears rising straight off its outer corners. An earlier pass had a domed
// skull and a pale brow band, and at 42px that silhouette read as a hat.
function BM_cowlPath(ctx, W, H){
  const m = BM_cowlM(W,H), cx=m.cx, hw=m.hw, ty=m.ty, by=m.by, eh=m.eh;
  ctx.beginPath();
  ctx.moveTo(cx-hw*1.00, ty+0.052*H);                      // back cheek
  ctx.lineTo(cx-hw*0.90, ty+0.004*H);                       // back skull corner
  ctx.lineTo(cx-hw*0.76, ty-0.004*H);
  ctx.lineTo(cx-hw*0.50, ty-eh*0.78);                       // back ear tip
  ctx.lineTo(cx-hw*0.32, ty+0.006*H);
  ctx.quadraticCurveTo(cx-hw*0.02, ty+0.020*H, cx+hw*0.30, ty+0.004*H);  // shallow dip
  ctx.lineTo(cx+hw*0.56, ty-eh*1.00);                       // front ear tip
  ctx.lineTo(cx+hw*0.80, ty+0.006*H);
  ctx.quadraticCurveTo(cx+hw*1.00, ty+0.014*H, cx+hw*1.04, ty+0.058*H);
  ctx.lineTo(cx+hw*1.00, ty+0.104*H);                       // cheekbone corner
  ctx.quadraticCurveTo(cx+hw*0.96, by-0.004*H, cx+hw*0.24, by+0.006*H);  // jaw
  ctx.quadraticCurveTo(cx-hw*0.74, by-0.030*H, cx-hw*1.00, ty+0.052*H);
  ctx.closePath();
}

function BM_drawLimb(ctx, ax,ay, ang, bend, L1, L2, w0,w1,w2, front, u, H, leg){
  const kx = ax + Math.cos(ang)*L1,        ky = ay + Math.sin(ang)*L1;
  const a2 = ang + bend;
  const ex = kx + Math.cos(a2)*L2,         ey = ky + Math.sin(a2)*L2;
  ctx.save();
  ctx.fillStyle = front
    ? BM_grad(ctx,'limbF'+H.toFixed(1), 0,0.26*H,0,H,[[0,'#232832'],[0.48,BM_PLATE],[1,'#090b10']])
    : '#080a0f';
  BM_bone(ctx, ax,ay, kx,ky, w0, w1); ctx.fill();
  BM_bone(ctx, kx,ky, ex,ey, w1, w2); ctx.fill();

  // segment the limb: a dark band where the plates meet, which is what makes
  // a tapered capsule read as armour instead of a sausage.
  const sx = Math.cos(ang), sy = Math.sin(ang);
  const nx = -sy, ny = sx;
  ctx.strokeStyle = 'rgba(0,0,0,0.50)';
  ctx.lineWidth = Math.max(0.6, 0.9*u);
  ctx.beginPath();
  ctx.moveTo(ax+sx*L1*0.52 - nx*w1*1.05, ay+sy*L1*0.52 - ny*w1*1.05);
  ctx.lineTo(ax+sx*L1*0.46 + nx*w1*1.05, ay+sy*L1*0.46 + ny*w1*1.05);
  ctx.stroke();

  if(front){
    // knee / elbow cop: a pointed plate on the outside of the joint
    const cn = ang - Math.PI/2;
    const cxp = kx + Math.cos(cn)*w1*0.30, cyp = ky + Math.sin(cn)*w1*0.30;
    const sz = w1*(leg?1.06:0.84);
    ctx.save();
    ctx.translate(cxp, cyp);
    ctx.rotate(ang - Math.PI/2);
    // flattened shield, not a ball: a round cop read as an exposed joint
    ctx.beginPath();
    ctx.moveTo( sz*0.92, -sz*0.08);
    ctx.quadraticCurveTo(sz*0.66, sz*0.56, -sz*0.26, sz*0.50);
    ctx.quadraticCurveTo(-sz*0.70, sz*0.06, -sz*0.30,-sz*0.46);
    ctx.quadraticCurveTo(sz*0.44,-sz*0.60, sz*0.92,-sz*0.08);
    ctx.closePath();
    ctx.fillStyle = BM_grad(ctx,'cop'+H.toFixed(1), 0,-sz, 0, sz,
      [[0,'#272d37'],[0.6,BM_PLATE],[1,'#0a0c12']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5*u; ctx.stroke();
    ctx.restore();
    // No cold lip down the limb. There used to be one on every segment and,
    // with the cowl rim and the gauntlet edge, the figure ended up webbed in
    // thin pale lines that read as scaffolding. The lighting pass draws this
    // edge for real; one baked copy of it is already one too many.
  }
  ctx.restore();
  return {kx:kx, ky:ky, ex:ex, ey:ey, a2:a2};
}

// Armoured boot: a flared greave cuff, a heavy foot and, on the camera side,
// the three calf fins. Local +x is the toe, +y is down the leg.
function BM_drawBoot(ctx, x, y, ang, s, front, u){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(ang - Math.PI/2);
  // calf fins, up the shin. They were down at the ankle before and read as
  // heel spurs; they belong on the calf, where the reference has them.
  if(front){
    ctx.fillStyle = '#141820';
    for(let i=0;i<3;i++){
      const yy = -s*(0.62 + i*0.50);
      const L  = s*(0.78 - i*0.08);
      ctx.beginPath();
      ctx.moveTo(-s*0.14, yy + s*0.10);
      ctx.lineTo(-s*0.14 - L, yy - s*0.08);
      ctx.lineTo(-s*0.20 - L*0.5, yy + s*0.30);
      ctx.closePath();
      ctx.fill();
    }
  }
  // foot mass
  ctx.beginPath();
  ctx.moveTo(-s*0.56,-s*0.34);
  ctx.lineTo( s*0.40,-s*0.38);
  ctx.quadraticCurveTo(s*0.94,-s*0.14, s*1.06, s*0.30);
  ctx.quadraticCurveTo(s*0.62, s*0.54, -s*0.60, s*0.48);
  ctx.quadraticCurveTo(-s*0.92, s*0.12, -s*0.56,-s*0.34);
  ctx.closePath();
  ctx.fillStyle = front
    ? BM_grad(ctx,'boot'+s.toFixed(2), 0,-s*0.4, 0, s*0.55,
        [[0,'#1f242d'],[0.55,BM_PLATE],[1,'#07080c']])
    : '#070910';
  ctx.fill();
  // greave cuff: a flared collar at the top of the boot
  ctx.beginPath();
  ctx.moveTo(-s*0.60,-s*0.34);
  ctx.lineTo( s*0.44,-s*0.40);
  ctx.lineTo( s*0.38,-s*0.18);
  ctx.lineTo(-s*0.56,-s*0.12);
  ctx.closePath();
  ctx.fillStyle = front ? '#232935' : '#0a0c13';
  ctx.fill();
  if(front){
    // toe cap seam -- dark, not cold: a pale line here just made the boot
    // look wet-painted and competed with the ground specular under it
    ctx.strokeStyle = 'rgba(0,0,0,0.48)'; ctx.lineWidth = 0.6*u;
    ctx.beginPath();
    ctx.moveTo(s*0.46,-s*0.32); ctx.quadraticCurveTo(s*0.52, s*0.10, s*0.38, s*0.48);
    ctx.stroke();
  }
  // sole
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(-s*0.60, s*0.32, s*1.64, s*0.20);
  ctx.restore();
}

// Vambrace with real fins: a plate over the forearm plus three swept blades
// that break the arm's outline. At 42px these are what say "Batman" as much
// as the ears do.
function BM_drawGauntlet(ctx, kx,ky, ex,ey, a2, u, front, w){
  const dx=ex-kx, dy=ey-ky;
  const nx = Math.cos(a2-Math.PI/2), ny = Math.sin(a2-Math.PI/2);
  const tx = Math.cos(a2), ty = Math.sin(a2);
  ctx.save();
  // vambrace shell over the forearm
  ctx.fillStyle = front ? BM_PLATE : '#0a0c12';
  BM_bone(ctx, kx+dx*0.14, ky+dy*0.14, kx+dx*0.92, ky+dy*0.92, w*1.08, w*0.92);
  ctx.fill();
  if(front){
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.5*u; ctx.stroke();
  }
  // fins
  ctx.fillStyle = front ? '#1c212a' : '#0b0d13';
  for(let i=0;i<3;i++){
    const f = 0.20 + i*0.27;
    const bx = kx+dx*f, by = ky+dy*f;
    const L = (3.5 - i*0.55)*u;
    ctx.beginPath();
    ctx.moveTo(bx - tx*1.0*u, by - ty*1.0*u);
    ctx.lineTo(bx + nx*L - tx*2.2*u, by + ny*L - ty*2.2*u);          // swept-back tip
    ctx.lineTo(bx + nx*L*0.40 + tx*0.7*u, by + ny*L*0.40 + ty*0.7*u);
    ctx.lineTo(bx + tx*1.5*u, by + ty*1.5*u);
    ctx.closePath();
    ctx.fill();
    if(front){
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.45*u; ctx.stroke();
    }
  }
  ctx.restore();
}

// The emblem. No disc: a bronze bat inlaid into the chest plate. Muted on
// purpose -- the old bright yellow medallion was the loudest thing on screen
// and read as arcade, not as armour.
function BM_drawEmblem(ctx, W, H, big, u, t){
  const cx = 0.016*W, cy = 0.392*H;
  const rx = (big?0.176:0.152)*W, ry = (big?0.082:0.070)*H;
  ctx.save();
  ctx.translate(cx, cy);
  // recess the emblem sits in -- a hair darker than the plate around it
  ctx.save();
  ctx.scale(1.16, 1.34);
  BM_chestBatPath(ctx, rx, ry);
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fill();
  ctx.restore();
  // the bat itself: bronze, and dark enough that the chest stays the chest.
  // The old bright-yellow medallion was the loudest value on screen.
  BM_chestBatPath(ctx, rx, ry);
  ctx.fillStyle = BM_grad(ctx,'emb'+H.toFixed(1)+(big?'b':'s'), 0, -ry, 0, ry,
    [[0,'#8b7644'],[0.40,'#6c5b30'],[1,'#2f2712']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(12,10,5,0.72)';
  ctx.lineWidth = 0.55*u;
  ctx.stroke();
  ctx.restore();
}

// Utility belt: gunmetal and dark leather with a single bronze buckle. The
// pouches are value, not colour.
function BM_drawBelt(ctx, W, H, big, u){
  const y = 0.558*H, hgt = (big?0.058:0.052)*H, x0 = -0.252*W, x1 = 0.262*W;
  ctx.save();
  ctx.beginPath();
  BM_roundRect(ctx, x0, y, x1-x0, hgt, hgt*0.26);
  ctx.fillStyle = BM_grad(ctx,'belt'+H.toFixed(1)+(big?'b':'s'), 0, y, 0, y+hgt,
    [[0,'#30363f'],[0.42,'#1b1f26'],[1,'#0a0c10']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 0.6*u; ctx.stroke();
  // pouches: slim, dark, with a lid line
  const px=[-0.212,-0.118, 0.096, 0.188];
  for(let i=0;i<4;i++){
    ctx.beginPath();
    BM_roundRect(ctx, px[i]*W, y+hgt*0.26, 0.066*W, hgt*1.02, hgt*0.20);
    ctx.fillStyle = BM_rnd(i)>0.5 ? '#1a1e25' : '#13161c';
    ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth = 0.5*u; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px[i]*W+0.006*W, y+hgt*0.58);
    ctx.lineTo(px[i]*W+0.060*W, y+hgt*0.58);
    ctx.strokeStyle='rgba(126,146,186,0.13)';
    ctx.stroke();
  }
  // buckle -- the only metal on the belt
  ctx.beginPath();
  BM_roundRect(ctx, -0.042*W, y-hgt*0.14, 0.088*W, hgt*1.26, hgt*0.22);
  ctx.fillStyle = BM_grad(ctx,'buck'+H.toFixed(1)+(big?'b':'s'), 0, y-hgt*0.14, 0, y+hgt*1.12,
    [[0,BM_GOLD_H],[0.5,BM_GOLD],[1,BM_GOLD_D]]);
  ctx.fill();
  ctx.strokeStyle='rgba(16,13,6,0.75)'; ctx.lineWidth = 0.5*u; ctx.stroke();
  ctx.restore();
}

function BM_drawHead(ctx, W, H, u, t, state){
  const m = BM_cowlM(W,H), cx=m.cx, hw=m.hw, ty=m.ty, by=m.by, eh=m.eh;
  ctx.save();
  // cowl silhouette. Near-black: the head must be the DARKEST mass on the
  // figure or it reads as a pale helmet floating over the shoulders.
  BM_cowlPath(ctx, W, H);
  ctx.fillStyle = BM_grad(ctx,'cowl'+H.toFixed(1), 0, ty-eh, 0, by,
    [[0,'#171b23'],[0.34,'#12151c'],[1,'#07090d']]);
  ctx.fill();

  ctx.save();
  BM_cowlPath(ctx, W, H); ctx.clip();
  // shadow down the back of the skull -- the cowl is a sphere, not a card
  ctx.fillStyle = BM_grad(ctx,'cowlSide'+W.toFixed(1), cx-hw*1.1, 0, cx+hw*0.6, 0,
    [[0,'rgba(0,0,0,0.66)'],[0.6,'rgba(0,0,0,0.16)'],[1,'rgba(0,0,0,0)']]);
  ctx.fillRect(cx-hw*1.2, ty-eh*1.2, hw*2.6, (by-ty)+eh*1.4);
  // the brow is a SHADOW the ridge casts over the eyes, not a lit band
  ctx.beginPath();
  ctx.moveTo(cx-hw*1.02, ty+0.038*H);
  ctx.quadraticCurveTo(cx+hw*0.08, ty+0.014*H, cx+hw*1.08, ty+0.050*H);
  ctx.lineTo(cx+hw*1.08, ty+0.094*H);
  ctx.quadraticCurveTo(cx+hw*0.08, ty+0.060*H, cx-hw*1.02, ty+0.086*H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.46)';
  ctx.fill();
  ctx.restore();

  // ear inner shading -- the back plane of each ear, which is what gives them
  // thickness instead of making them look like antennae
  ctx.fillStyle = 'rgba(0,0,0,0.60)';
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.56, ty-eh*1.00); ctx.lineTo(cx+hw*0.68, ty-eh*0.30);
  ctx.lineTo(cx+hw*0.80, ty+0.006*H); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.50, ty-eh*0.78); ctx.lineTo(cx-hw*0.42, ty-eh*0.24);
  ctx.lineTo(cx-hw*0.32, ty+0.006*H); ctx.closePath(); ctx.fill();

  // jaw / chin exposed skin
  const my = ty + 0.104*H;
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.48, my);
  ctx.quadraticCurveTo(cx+hw*0.50, my-0.012*H, cx+hw*0.99, my+0.002*H);
  ctx.quadraticCurveTo(cx+hw*0.94, by-0.004*H, cx+hw*0.24, by+0.004*H);
  ctx.quadraticCurveTo(cx-hw*0.40, by-0.020*H, cx-hw*0.48, my);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'skin'+H.toFixed(1), 0, my, 0, by,
    [[0,BM_SKIN_L],[0.50,BM_SKIN],[1,BM_SKIN_D]]);
  ctx.fill();
  // mouth
  ctx.strokeStyle = 'rgba(44,26,18,0.80)';
  ctx.lineWidth = Math.max(0.7, 0.85*u);
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.16, my+0.028*H);
  ctx.quadraticCurveTo(cx+hw*0.56, my+(state==='dead'?0.050:0.038)*H, cx+hw*0.86, my+0.024*H);
  ctx.stroke();
  // the cowl's lower edge casts onto the cheek
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.95*u;
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.48, my);
  ctx.quadraticCurveTo(cx+hw*0.50, my-0.012*H, cx+hw*0.99, my+0.002*H);
  ctx.stroke();

  // eyes -- the only emissive thing on the figure, and the reason a near-black
  // head reads at all against a pale city
  if(state !== 'dead'){
    // narrow, hard-slanted slits. Wide horizontal bars read as a sleep mask.
    const ey = ty+0.062*H, ehh = Math.max(0.95, 0.023*H);
    ctx.shadowColor = 'rgba(186,212,255,0.90)';
    ctx.shadowBlur  = 4.4*u;
    ctx.fillStyle   = PAL.eye;
    for(let i=0;i<2;i++){
      const ex = cx + (i===0 ? hw*0.66 : hw*0.10);
      const ew = (i===0 ? hw*0.44 : hw*0.30);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-0.34);
      ctx.beginPath();
      ctx.moveTo(-ew*0.5, -ehh*0.18);
      ctx.lineTo( ew*0.5, -ehh*0.52);
      ctx.lineTo( ew*0.5,  ehh*0.22);
      ctx.lineTo(-ew*0.5,  ehh*0.58);
      ctx.closePath();
      ctx.globalAlpha = i===0 ? 1 : 0.60;
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = 'rgba(120,130,160,0.7)';
    ctx.lineWidth = 1.1*u;
    for(let i=0;i<2;i++){
      const ex = cx + (i===0 ? hw*0.66 : hw*0.10);
      ctx.beginPath();
      ctx.moveTo(ex-hw*0.18, ty+0.050*H); ctx.lineTo(ex+hw*0.18, ty+0.076*H);
      ctx.moveTo(ex-hw*0.18, ty+0.076*H); ctx.lineTo(ex+hw*0.18, ty+0.050*H);
      ctx.stroke();
    }
  }
  // Cowl rim: two separate, short, dim strokes rather than one bright hook
  // running from the ear tip to the jaw -- that one curve was the brightest
  // thing on the whole figure and read as a horn.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(176,200,244,0.22)';            // leading edge of the ear
  ctx.lineWidth = Math.max(0.6, 0.7*u);
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.58, ty-eh*0.92);
  ctx.lineTo(cx+hw*0.78, ty+0.002*H);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(186,210,252,0.34)';            // brow corner into the cheek
  ctx.lineWidth = Math.max(0.7, 0.85*u);
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.86, ty+0.014*H);
  ctx.quadraticCurveTo(cx+hw*1.03, ty+0.024*H, cx+hw*1.01, ty+0.082*H);
  ctx.stroke();
  ctx.restore();
}

// glide membrane between the outstretched arm and the ankle
function BM_drawMembrane(ctx, hx,hy, ax,ay, sx,sy, px,py, W,H,u){
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx,sy);
  ctx.lineTo(hx,hy);
  const dx = ax-hx, dy = ay-hy;
  const n = 3;
  for(let i=0;i<n;i++){
    const t0=i/n, t1=(i+1)/n;
    const x0=hx+dx*t0, y0=hy+dy*t0, x1=hx+dx*t1, y1=hy+dy*t1;
    const mx=(x0+x1)*0.5, my=(y0+y1)*0.5;
    ctx.quadraticCurveTo(mx - dy*0.20, my + dx*0.20, x1, y1);
  }
  ctx.lineTo(px,py);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'memb'+H.toFixed(1), 0, 0.20*H, 0, 0.95*H,
    [[0,'rgba(28,32,41,0.93)'],[0.6,'rgba(14,16,21,0.93)'],[1,'rgba(6,7,11,0.93)']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126,146,196,0.20)';
  ctx.lineWidth = 0.8*u;
  ctx.stroke();
  // ribs
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  for(let i=1;i<3;i++){
    const f=i/3;
    ctx.beginPath();
    ctx.moveTo(sx+(px-sx)*f, sy+(py-sy)*f);
    ctx.lineTo(hx+dx*f, hy+dy*f);
    ctx.stroke();
  }
  ctx.restore();
}

// ===========================================================================
//  MAIN SPRITE
// ===========================================================================
function drawBatmanSprite(ctx, x, y, w, h, o){
  o = o || {};
  const state  = o.state || 'idle';
  const facing = (o.facingRight !== false);
  const t      = (typeof o.animTime === 'number' && isFinite(o.animTime)) ? o.animTime : 0;
  const big    = !!o.big;
  const star   = !!o.star;
  const speed  = BM_clamp(Math.abs(+o.speed || 0), 0, 260);
  const W = w, H = h, u = W/30;

  ctx.save();
  ctx.translate(x + W*0.5, y);
  if(!facing) ctx.scale(-1, 1);

  const P = BM_pose(state, t, speed, big, W, H);

  // root transform (crouch squash / death tip / bob)
  ctx.translate(P.ox, P.oy);
  if(P.sx !== 1 || P.sy !== 1){
    ctx.translate(0, H); ctx.scale(P.sx, P.sy); ctx.translate(0, -H);
  }
  if(P.tilt){
    ctx.translate(0, H*0.94); ctx.rotate(P.tilt); ctx.translate(0, -H*0.94);
  }
  if(P.lean){
    ctx.translate(0, H); ctx.rotate(P.lean); ctx.translate(0, -H);
  }
  ctx.translate(0, P.bob);

  const geo = BM_capeGeo(state, t, speed, W, H);

  // ---- contact shadow -------------------------------------------------
  if(state !== 'dead' && state !== 'glide' && state !== 'fall'){
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.ellipse(0, H*0.995, W*0.44, H*0.028, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // ---- star: soft golden under-glow ------------------------------------
  if(star){
    const pulse = 0.5 + 0.5*Math.sin(t*8.0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.14 + 0.16*pulse;
    ctx.shadowColor = PAL.yellow;
    ctx.shadowBlur  = (9 + 9*pulse)*u;
    ctx.fillStyle   = PAL.yellow;
    BM_capePath(ctx, geo, 1); ctx.fill();
    BM_torsoPath(ctx, W, H, big); ctx.fill();
    BM_cowlPath(ctx, W, H); ctx.fill();
    ctx.restore();
  }

  // ---- cape (behind everything) ---------------------------------------
  BM_drawCape(ctx, geo, W, H, u);

  // ---- limb metrics ----------------------------------------------------
  const hipY = P.hipY, shY = P.shY;
  const L1 = (big?0.212:0.202)*H, L2 = (big?0.192:0.188)*H;
  const A1 = (big?0.168:0.161)*H, A2 = (big?0.153:0.146)*H;
  // heavier limbs: the reference suit has no thin arms anywhere
  const legW = (big?0.062:0.057)*W*1.6;
  const armW = (big?0.055:0.050)*W*1.6;
  const hipBX = -0.058*W, hipFX = 0.062*W;
  const shBX  = -0.158*W,  shFX  = 0.156*W;

  // ---- back arm & back leg (behind torso) ------------------------------
  const bArm = BM_drawLimb(ctx, shBX, shY, P.armB.a, P.armB.k, A1, A2,
                           armW*0.64, armW*0.50, armW*0.44, false, u, H, false);
  BM_drawGauntlet(ctx, bArm.kx, bArm.ky, bArm.ex, bArm.ey, bArm.a2, u, false, armW*0.47);
  const bLeg = BM_drawLimb(ctx, hipBX, hipY, P.legB.a, P.legB.k, L1, L2,
                           legW*0.68, legW*0.50, legW*0.42, false, u, H, true);
  BM_drawBoot(ctx, bLeg.ex, bLeg.ey, bLeg.a2, W*0.120, false, u);
  BM_drawPauldron(ctx, W, H, -1, big, u, false);

  // ---- glide membrane --------------------------------------------------
  if(state === 'glide'){
    BM_drawMembrane(ctx, bArm.ex, bArm.ey, bLeg.ex, bLeg.ey, shBX, shY, hipBX, hipY, W, H, u);
  }

  // ---- front leg -------------------------------------------------------
  const fLeg = BM_drawLimb(ctx, hipFX, hipY, P.legF.a, P.legF.k, L1, L2,
                           legW*0.72, legW*0.54, legW*0.46, true, u, H, true);
  BM_drawBoot(ctx, fLeg.ex, fLeg.ey, fLeg.a2, W*0.130, true, u);

  // ---- torso -----------------------------------------------------------
  ctx.save();
  BM_torsoPath(ctx, W, H, big);
  ctx.fillStyle = BM_grad(ctx,'body'+H.toFixed(1), 0, 0.25*H, 0, 0.66*H,
    [[0,'#242a34'],[0.26,'#1b202a'],[0.68,BM_PLATE],[1,'#090b10']]);
  ctx.fill();
  // back-side shading wash
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BM_grad(ctx,'bodyside'+W.toFixed(1), -W*0.44, 0, W*0.22, 0,
    [[0,'rgba(0,0,0,0.70)'],[0.55,'rgba(0,0,0,0.18)'],[1,'rgba(0,0,0,0)']]);
  ctx.fillRect(-W*0.5, 0.24*H, W, 0.46*H);

  // --- segmented plating. All of it is value, not line: at 42px tall a
  // 1px bright stroke becomes a scratch, a 1px dark one becomes form. ---
  // pectoral plates, split by a sternum recess
  ctx.fillStyle = 'rgba(46,54,66,0.34)';
  for(let s=-1;s<=1;s+=2){
    ctx.beginPath();
    ctx.moveTo(s*0.045*W, 0.316*H);
    ctx.quadraticCurveTo(s*0.300*W, 0.312*H, s*0.318*W, 0.378*H);
    ctx.quadraticCurveTo(s*0.290*W, 0.438*H, s*0.048*W, 0.430*H);
    ctx.closePath();
    ctx.fill();
  }
  // sternum
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.moveTo(-0.022*W, 0.310*H);
  ctx.lineTo( 0.022*W, 0.310*H);
  ctx.lineTo( 0.014*W, 0.452*H);
  ctx.lineTo(-0.014*W, 0.452*H);
  ctx.closePath();
  ctx.fill();
  // abdominal bands below the emblem
  const nb = big ? 4 : 3;
  for(let i=0;i<nb;i++){
    const yy = 0.464*H + i*(big?0.026:0.028)*H;
    ctx.fillStyle = (i%2===0) ? 'rgba(42,49,60,0.30)' : 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.moveTo(-0.215*W + i*0.012*W, yy);
    ctx.quadraticCurveTo(0, yy+0.014*H, 0.215*W - i*0.012*W, yy);
    ctx.quadraticCurveTo(0, yy+(big?0.030:0.032)*H, -0.215*W + i*0.012*W, yy+(big?0.016:0.018)*H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = BM_SEAM; ctx.lineWidth = 0.5*u;
    ctx.beginPath();
    ctx.moveTo(-0.215*W + i*0.012*W, yy);
    ctx.quadraticCurveTo(0, yy+0.014*H, 0.215*W - i*0.012*W, yy);
    ctx.stroke();
  }
  // oblique wedges tucking into the belt
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  for(let s=-1;s<=1;s+=2){
    ctx.beginPath();
    ctx.moveTo(s*0.242*W, 0.452*H);
    ctx.lineTo(s*0.214*W, 0.556*H);
    ctx.lineTo(s*0.142*W, 0.556*H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // silhouette edge -- rebuild the torso path: the clipped block above left the
  // last plate as the current path, so stroking here would trace that instead
  // of the torso outline.
  BM_torsoPath(ctx, W, H, big);
  ctx.strokeStyle = 'rgba(0,0,0,0.60)';
  ctx.lineWidth = 0.7*u;
  ctx.stroke();
  ctx.restore();

  // ---- emblem + belt ---------------------------------------------------
  BM_drawEmblem(ctx, W, H, big, u, t);
  BM_drawBelt(ctx, W, H, big, u);

  // ---- gorget + front pauldron ----------------------------------------
  BM_drawGorget(ctx, W, H, big, u);
  BM_drawPauldron(ctx, W, H, 1, big, u, true);

  // ---- cape collar over the front shoulder -----------------------------
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-0.12*W, 0.262*H);
  ctx.quadraticCurveTo(0.14*W, 0.246*H, 0.27*W, 0.300*H);
  ctx.quadraticCurveTo(0.31*W, 0.362*H, 0.21*W, 0.404*H);
  ctx.quadraticCurveTo(0.21*W, 0.312*H, -0.12*W, 0.262*H);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'collar'+H.toFixed(1), 0, 0.24*H, 0, 0.41*H,
    [[0,'#1a1f27'],[1,'#0a0c11']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.6*u;
  ctx.stroke();
  ctx.restore();

  // ---- front arm -------------------------------------------------------
  const fArm = BM_drawLimb(ctx, shFX, shY, P.armF.a, P.armF.k, A1, A2,
                           armW*0.70, armW*0.54, armW*0.48, true, u, H, false);
  BM_drawGauntlet(ctx, fArm.kx, fArm.ky, fArm.ex, fArm.ey, fArm.a2, u, true, armW*0.51);
  // fist
  ctx.save();
  ctx.fillStyle = BM_PLATE;
  ctx.beginPath();
  ctx.arc(fArm.ex, fArm.ey, armW*0.54, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5*u; ctx.stroke();
  ctx.fillStyle = 'rgba(120,142,186,0.14)';
  ctx.beginPath();
  ctx.arc(fArm.ex - armW*0.12, fArm.ey - armW*0.16, armW*0.26, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // ---- head ------------------------------------------------------------
  BM_drawHead(ctx, W, H, u, t, state);

  // ---- front-edge rim light -------------------------------------------
  ctx.save();
  // The rim is what makes a near-black figure readable against a pale hazy
  // city. It used to be nearly white and 1.5px wide, which double-counted the
  // specular the lighting pass now puts on the same edge; it is dim here on
  // purpose and exists only to keep the body from going flat in a dark frame.
  ctx.strokeStyle = BM_grad(ctx,'rim'+H.toFixed(1), 0, 0.26*H, 0, H,
    [[0,'rgba(196,218,252,0.52)'],[0.55,'rgba(160,184,228,0.26)'],[1,'rgba(120,146,200,0.03)']]);
  ctx.lineWidth = Math.max(0.8, 1.05*u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  // starts BELOW the shoulder plate: routed over it, the stroke read as a
  // wire laid across the armour instead of as the edge of the body
  ctx.moveTo(0.300*W, 0.404*H);
  ctx.bezierCurveTo(0.302*W, 0.452*H, 0.278*W, 0.482*H, 0.250*W, 0.540*H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.254*W, 0.624*H);
  ctx.quadraticCurveTo(0.234*W, 0.700*H, 0.194*W, 0.760*H);
  ctx.stroke();
  ctx.restore();

  // ---- star: pulsing golden outline pass -------------------------------
  if(star){
    const pulse = 0.5 + 0.5*Math.sin(t*8.0 + 0.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32 + 0.38*pulse;
    ctx.strokeStyle = BM_grad(ctx,'starline'+H.toFixed(1), 0, 0, 0, H,
      [[0,'#fff3b0'],[0.5,PAL.yellow],[1,'#ff9c2e']]);
    ctx.lineWidth = Math.max(0.9, (1.1 + 0.6*pulse)*u);
    ctx.lineJoin = 'round';
    ctx.shadowColor = PAL.yellow;
    ctx.shadowBlur  = (5 + 7*pulse)*u;
    BM_capePath(ctx, geo, 1);  ctx.stroke();
    BM_torsoPath(ctx, W, H, big); ctx.stroke();
    BM_cowlPath(ctx, W, H);    ctx.stroke();
    // sparks orbiting the silhouette
    ctx.globalAlpha = 0.30 + 0.45*pulse;
    ctx.fillStyle = '#fff0a6';
    for(let i=0;i<6;i++){
      const a = t*2.1 + i*(Math.PI*2/6) + BM_rnd(i)*3.0;
      const rr = 0.34*W + BM_rnd(i+9)*0.16*W;
      const sx = Math.cos(a)*rr, sy = 0.46*H + Math.sin(a)*0.34*H;
      const s  = (0.9 + BM_rnd(i+3)*1.1)*u*0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, s, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}
