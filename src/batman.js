// ===========================================================================
//  batman.js  --  the player character.  Module prefix: BM_
//  Pure Canvas2D. No images, no libs. Deterministic (animTime driven).
//  Public: drawBatmanSprite(ctx,x,y,w,h,o)   drawBatSymbol(ctx,cx,cy,r,color)
// ===========================================================================

const BM_SKIN   = '#c8a888';
const BM_SKIN_D = '#8f6d53';
const BM_SKIN_L = '#e6c8a8';
const BM_INK    = '#080a12';

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

// ===========================================================================
//  BAT SYMBOL  --  real scalloped bat silhouette, r = half width
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

// ===========================================================================
//  POSE  --  joint angles. 0 rad = forward(+x), PI/2 = straight down.
// ===========================================================================
function BM_pose(state, t, speed, big, W, H){
  const sp = BM_clamp(speed,0,260)/260;
  const P = {
    tilt:0, sx:1, sy:1, ox:0, oy:0, bob:0, lean:0,
    hipY:0.615*H, shY:0.315*H,
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
  let lo=1.30, hi=2.26, R=0.66*H, n=4, swayAmp=0.10, flut=1;
  switch(state){
    case 'run':   lo=1.34; hi=2.24+0.60*sp; R=(0.64+0.13*sp)*H; swayAmp=0.07+0.10*sp; break;
    case 'jump':  lo=1.02; hi=2.80; R=0.80*H; swayAmp=0.14; break;
    case 'fall':  lo=1.10; hi=2.88; R=0.83*H; swayAmp=0.17; break;
    case 'glide': lo=0.30; hi=3.02; R=0.82*H; n=5; swayAmp=0.06; break;
    case 'duck':  lo=1.50; hi=2.56; R=0.50*H; swayAmp=0.04; break;
    case 'dead':  lo=1.58; hi=2.18; R=0.56*H; swayAmp=0.00; flut=0; break;
  }
  const sway = swayAmp*(Math.sin(t*2.7)*0.7 + Math.sin(t*1.63+1.1)*0.3);
  hi += sway; lo += sway*0.30;
  const ax = -0.035*W, ay = 0.285*H;
  const tips = [];
  for(let i=0;i<n;i++){
    const f = (n===1)?0:i/(n-1);
    const a = lo + (hi-lo)*f;
    const r = R*(0.80 + 0.24*f) * (1 + 0.065*flut*Math.sin(t*5.3 + i*1.9));
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
  ctx.moveTo(ax+0.11*W, ay-0.025*H);
  ctx.quadraticCurveTo(ax+0.16*W, ay+0.20*H*k, X(T[0]), Y(T[0]));   // leading edge
  for(let i=0;i<T.length-1;i++){
    const a=T[i], b=T[i+1];
    const ma=(a.a+b.a)*0.5, mr=(a.r+b.r)*0.5*0.73*k;
    ctx.quadraticCurveTo(ax+Math.cos(ma)*mr, ay+Math.sin(ma)*mr, X(b), Y(b));
  }
  ctx.bezierCurveTo(ax-0.40*W, ay+0.16*H, ax-0.34*W, ay-0.01*H, ax-0.17*W, ay-0.065*H);
  ctx.quadraticCurveTo(ax+0.02*W, ay-0.10*H, ax+0.11*W, ay-0.025*H);
  ctx.closePath();
}

function BM_drawCape(ctx, g, W, H, u){
  ctx.save();
  // main membrane
  BM_capePath(ctx, g, 1);
  // key must include R: the cape's vertical extent changes with state/speed, and a
  // key of H alone made every state reuse whichever state was drawn first.
  ctx.fillStyle = BM_grad(ctx,'cape'+H.toFixed(1)+'_'+Math.round(g.R), 0, g.ay-0.10*H, 0, g.ay+g.R,
    [[0,PAL.capeHi],[0.28,PAL.cape],[0.75,'#0a0b13'],[1,'#06070c']]);
  ctx.fill();
  // inner fold, darker, offset toward the back
  ctx.save();
  ctx.translate(-0.04*W, 0.012*H);
  BM_capePath(ctx, g, 0.70);
  ctx.fillStyle = 'rgba(4,5,10,0.55)';
  ctx.fill();
  ctx.restore();
  // fold creases radiating from the neck
  ctx.strokeStyle = 'rgba(150,168,220,0.10)';
  ctx.lineWidth = 0.9*u;
  for(let i=0;i<g.tips.length;i++){
    const T=g.tips[i];
    ctx.beginPath();
    ctx.moveTo(g.ax+Math.cos(T.a)*0.10*H, g.ay+Math.sin(T.a)*0.10*H);
    ctx.quadraticCurveTo(g.ax+Math.cos(T.a-0.10)*T.r*0.62, g.ay+Math.sin(T.a-0.10)*T.r*0.62,
                         g.ax+(T.x-g.ax)*0.93, g.ay+(T.y-g.ay)*0.93);
    ctx.stroke();
  }
  // rim light along the trailing edge
  BM_capePath(ctx, g, 1);
  ctx.strokeStyle = 'rgba(158,182,228,0.46)';
  ctx.lineWidth = 1.15*u; ctx.lineJoin='round';
  ctx.stroke();
  ctx.restore();
}

// ===========================================================================
//  BODY PARTS
// ===========================================================================
function BM_torsoPath(ctx, W, H, big){
  const sw=(big?0.400:0.352)*W, sy=0.300*H, ww=(big?0.245:0.222)*W,
        wy=0.545*H, hw=(big?0.268:0.248)*W, hy=0.632*H;
  ctx.beginPath();
  ctx.moveTo(-sw*0.76, sy-0.022*H);
  ctx.bezierCurveTo(-sw*1.06, sy+0.012*H, -sw*0.98, sy+0.115*H, -ww*1.04, wy);
  ctx.bezierCurveTo(-hw*1.02, wy+0.030*H, -hw, hy-0.012*H, -hw*0.92, hy);
  ctx.lineTo(hw*0.92, hy);
  ctx.bezierCurveTo(hw, hy-0.012*H, hw*1.02, wy+0.030*H, ww*1.06, wy);
  ctx.bezierCurveTo(sw*1.00, sy+0.115*H, sw*1.08, sy+0.012*H, sw*0.80, sy-0.024*H);
  ctx.quadraticCurveTo(0, sy-0.070*H, -sw*0.76, sy-0.022*H);
  ctx.closePath();
}

function BM_cowlPath(ctx, W, H){
  const cx=0.045*W, hw=0.170*W, ty=0.115*H, by=0.282*H;
  ctx.beginPath();
  ctx.moveTo(cx-hw*1.00, ty+0.030*H);
  ctx.quadraticCurveTo(cx-hw*1.06, ty-0.018*H, cx-hw*0.56, ty-0.014*H);
  ctx.lineTo(cx-hw*0.30, ty-0.098*H);            // back ear
  ctx.lineTo(cx-hw*0.08, ty-0.004*H);
  ctx.quadraticCurveTo(cx+hw*0.16, ty+0.014*H, cx+hw*0.36, ty-0.010*H);
  ctx.lineTo(cx+hw*0.60, ty-0.112*H);            // front ear
  ctx.lineTo(cx+hw*0.88, ty+0.006*H);
  ctx.quadraticCurveTo(cx+hw*1.10, ty+0.034*H, cx+hw*1.02, ty+0.082*H);
  ctx.quadraticCurveTo(cx+hw*0.98, by-0.006*H, cx+hw*0.24, by+0.006*H);
  ctx.quadraticCurveTo(cx-hw*0.72, by-0.024*H, cx-hw*1.00, ty+0.030*H);
  ctx.closePath();
}

function BM_drawLimb(ctx, ax,ay, ang, bend, L1, L2, w0,w1,w2, front, u, H){
  const kx = ax + Math.cos(ang)*L1,        ky = ay + Math.sin(ang)*L1;
  const a2 = ang + bend;
  const ex = kx + Math.cos(a2)*L2,         ey = ky + Math.sin(a2)*L2;
  ctx.save();
  ctx.fillStyle = front
    ? BM_grad(ctx,'limbF'+H.toFixed(1), 0,0,0,H,[[0,PAL.batHi],[0.55,PAL.bat],[1,PAL.batLo]])
    : '#0b0d18';
  BM_bone(ctx, ax,ay, kx,ky, w0, w1); ctx.fill();
  BM_bone(ctx, kx,ky, ex,ey, w1, w2); ctx.fill();
  if(front){
    ctx.strokeStyle = 'rgba(150,172,230,0.30)';
    ctx.lineWidth = 0.85*u;
    ctx.beginPath();
    ctx.moveTo(ax+Math.cos(ang-1.35)*w0*0.75, ay+Math.sin(ang-1.35)*w0*0.75);
    ctx.lineTo(kx+Math.cos(ang-1.35)*w1*0.75, ky+Math.sin(ang-1.35)*w1*0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(kx+Math.cos(a2-1.35)*w1*0.7, ky+Math.sin(a2-1.35)*w1*0.7);
    ctx.lineTo(ex+Math.cos(a2-1.35)*w2*0.7, ey+Math.sin(a2-1.35)*w2*0.7);
    ctx.stroke();
  }
  ctx.restore();
  return {kx:kx, ky:ky, ex:ex, ey:ey, a2:a2};
}

function BM_drawBoot(ctx, x, y, ang, s, front, u){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(ang - Math.PI/2);
  ctx.beginPath();
  ctx.moveTo(-s*0.52,-s*0.30);
  ctx.lineTo( s*0.46,-s*0.34);
  ctx.quadraticCurveTo(s*0.92,-s*0.10, s*1.02, s*0.34);
  ctx.quadraticCurveTo(s*0.60, s*0.56, -s*0.56, s*0.50);
  ctx.quadraticCurveTo(-s*0.86, s*0.16, -s*0.52,-s*0.30);
  ctx.closePath();
  ctx.fillStyle = front ? PAL.bat : '#090b14';
  ctx.fill();
  if(front){
    ctx.fillStyle = 'rgba(160,182,240,0.22)';
    ctx.beginPath();
    ctx.moveTo(-s*0.46,-s*0.26); ctx.lineTo(s*0.42,-s*0.30);
    ctx.lineTo(s*0.50,-s*0.10); ctx.lineTo(-s*0.44,-s*0.04);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-s*0.56, s*0.34, s*1.56, s*0.20);
  ctx.restore();
}

function BM_drawGauntlet(ctx, kx,ky, ex,ey, a2, u, front){
  // three swept fins along the outside of the forearm
  ctx.save();
  ctx.fillStyle = front ? PAL.batHi : '#131726';
  const nx = Math.cos(a2-Math.PI/2), ny = Math.sin(a2-Math.PI/2);
  for(let i=0;i<3;i++){
    const f = 0.30 + i*0.26;
    const bx = kx+(ex-kx)*f, by = ky+(ey-ky)*f;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx+nx*2.4*u - Math.cos(a2)*1.1*u, by+ny*2.4*u - Math.sin(a2)*1.1*u);
    ctx.lineTo(bx+nx*0.6*u + Math.cos(a2)*1.5*u, by+ny*0.6*u + Math.sin(a2)*1.5*u);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function BM_drawEmblem(ctx, W, H, big, u, t){
  const cx = 0.020*W, cy = 0.408*H;
  const rx = (big?0.208:0.166)*W, ry = (big?0.138:0.112)*H;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
  ctx.fillStyle = BM_grad(ctx,'emb'+H.toFixed(1)+(big?'b':'s'), 0, cy-ry, 0, cy+ry,
    [[0,'#ffe98a'],[0.35,PAL.yellow],[1,PAL.yellowD]]);
  ctx.shadowColor = 'rgba(245,197,24,0.55)';
  ctx.shadowBlur  = 4*u;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(120,88,6,0.65)';
  ctx.lineWidth = 0.8*u;
  ctx.stroke();
  drawBatSymbol(ctx, cx, cy+ry*0.04, rx*0.80, BM_INK);
  // glossy top sliver
  ctx.beginPath();
  ctx.ellipse(cx, cy-ry*0.42, rx*0.72, ry*0.28, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  ctx.restore();
}

function BM_drawBelt(ctx, W, H, big, u){
  const y = 0.560*H, hgt = (big?0.062:0.056)*H, x0 = -0.250*W, x1 = 0.258*W;
  ctx.save();
  ctx.beginPath();
  BM_roundRect(ctx, x0, y, x1-x0, hgt, hgt*0.30);
  ctx.fillStyle = BM_grad(ctx,'belt'+H.toFixed(1)+(big?'b':'s'), 0, y, 0, y+hgt,
    [[0,'#ffdf72'],[0.45,PAL.yellow],[1,PAL.yellowD]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,66,4,0.75)'; ctx.lineWidth = 0.7*u; ctx.stroke();
  // buckle
  ctx.beginPath();
  BM_roundRect(ctx, -0.045*W, y-hgt*0.18, 0.095*W, hgt*1.36, hgt*0.25);
  ctx.fillStyle = '#ffe98f'; ctx.fill();
  ctx.strokeStyle='rgba(90,66,4,0.8)'; ctx.stroke();
  // pouches
  const px=[-0.205,-0.108, 0.098, 0.186];
  for(let i=0;i<4;i++){
    ctx.beginPath();
    BM_roundRect(ctx, px[i]*W, y+hgt*0.12, 0.072*W, hgt*1.05, hgt*0.22);
    ctx.fillStyle = BM_rnd(i)>0.5 ? PAL.yellowD : '#d9ab14';
    ctx.fill();
    ctx.strokeStyle='rgba(70,50,2,0.7)'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px[i]*W+0.008*W, y+hgt*0.42);
    ctx.lineTo(px[i]*W+0.064*W, y+hgt*0.42);
    ctx.strokeStyle='rgba(60,42,2,0.55)';
    ctx.stroke();
  }
  ctx.restore();
}

function BM_drawHead(ctx, W, H, u, t, state){
  const cx=0.045*W, hw=0.170*W, ty=0.115*H, by=0.282*H;
  ctx.save();
  // cowl silhouette
  BM_cowlPath(ctx, W, H);
  ctx.fillStyle = BM_grad(ctx,'cowl'+H.toFixed(1), 0, ty-0.11*H, 0, by,
    [[0,'#353c55'],[0.42,PAL.batHi],[1,PAL.batLo]]);
  ctx.fill();
  // jaw / chin exposed skin
  const my = ty + 0.108*H;
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.52, my);
  ctx.quadraticCurveTo(cx+hw*0.50, my-0.016*H, cx+hw*0.97, my+0.004*H);
  ctx.quadraticCurveTo(cx+hw*0.93, by-0.004*H, cx+hw*0.22, by+0.004*H);
  ctx.quadraticCurveTo(cx-hw*0.42, by-0.020*H, cx-hw*0.52, my);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'skin'+H.toFixed(1), 0, my, 0, by,
    [[0,BM_SKIN_L],[0.55,BM_SKIN],[1,BM_SKIN_D]]);
  ctx.fill();
  // mouth
  ctx.strokeStyle = 'rgba(60,34,22,0.80)';
  ctx.lineWidth = Math.max(0.7, 0.85*u);
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.14, my+0.030*H);
  ctx.quadraticCurveTo(cx+hw*0.56, my+(state==='dead'?0.052:0.040)*H, cx+hw*0.88, my+0.026*H);
  ctx.stroke();
  // cowl lower edge shadow across the cheek
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.9*u;
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.52, my);
  ctx.quadraticCurveTo(cx+hw*0.50, my-0.016*H, cx+hw*0.97, my+0.004*H);
  ctx.stroke();
  // brow ridge
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.70, ty+0.046*H);
  ctx.quadraticCurveTo(cx+hw*0.10, ty+0.026*H, cx+hw*0.98, ty+0.052*H);
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';
  ctx.lineWidth = 1.1*u;
  ctx.stroke();
  // ear inner shading
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.46, ty-0.006*H); ctx.lineTo(cx+hw*0.60, ty-0.112*H);
  ctx.lineTo(cx+hw*0.64, ty-0.004*H); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx-hw*0.44, ty-0.010*H); ctx.lineTo(cx-hw*0.30, ty-0.098*H);
  ctx.lineTo(cx-hw*0.20, ty-0.006*H); ctx.closePath(); ctx.fill();
  // eyes
  if(state !== 'dead'){
    const ey = ty+0.062*H, eh = Math.max(1.05, 0.030*H);
    ctx.shadowColor = 'rgba(190,215,255,0.95)';
    ctx.shadowBlur  = 5.5*u;
    ctx.fillStyle   = PAL.eye;
    for(let i=0;i<2;i++){
      const ex = cx + (i===0 ? hw*0.70 : hw*0.14);
      const ew = (i===0 ? hw*0.52 : hw*0.38);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-0.22);
      ctx.beginPath();
      ctx.moveTo(-ew*0.5, -eh*0.5);
      ctx.lineTo( ew*0.5, -eh*0.18);
      ctx.lineTo( ew*0.5,  eh*0.46);
      ctx.lineTo(-ew*0.5,  eh*0.52);
      ctx.closePath();
      ctx.globalAlpha = i===0 ? 1 : 0.72;
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = 'rgba(120,130,160,0.7)';
    ctx.lineWidth = 1.1*u;
    for(let i=0;i<2;i++){
      const ex = cx + (i===0 ? hw*0.70 : hw*0.14);
      ctx.beginPath();
      ctx.moveTo(ex-hw*0.20, ty+0.050*H); ctx.lineTo(ex+hw*0.20, ty+0.076*H);
      ctx.moveTo(ex-hw*0.20, ty+0.076*H); ctx.lineTo(ex+hw*0.20, ty+0.050*H);
      ctx.stroke();
    }
  }
  // cowl rim light down the face front
  ctx.strokeStyle = 'rgba(198,220,255,0.82)';
  ctx.lineWidth = Math.max(0.8, 1.15*u);
  ctx.beginPath();
  ctx.moveTo(cx+hw*0.60, ty-0.108*H);
  ctx.lineTo(cx+hw*0.87, ty+0.008*H);
  ctx.quadraticCurveTo(cx+hw*1.08, ty+0.036*H, cx+hw*1.00, ty+0.084*H);
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
    [[0,'rgba(36,40,64,0.92)'],[0.6,'rgba(18,20,31,0.92)'],[1,'rgba(8,9,15,0.92)']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(132,154,215,0.28)';
  ctx.lineWidth = 0.9*u;
  ctx.stroke();
  // ribs
  ctx.strokeStyle = 'rgba(120,140,200,0.13)';
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
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.ellipse(0, H*0.995, W*0.42, H*0.028, 0, 0, Math.PI*2);
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
  const L1 = (big?0.215:0.205)*H, L2 = (big?0.195:0.190)*H;
  const A1 = (big?0.170:0.163)*H, A2 = (big?0.155:0.148)*H;
  const legW = (big?0.058:0.052)*W*1.6;
  const armW = (big?0.050:0.045)*W*1.6;
  const hipBX = -0.055*W, hipFX = 0.060*W;
  const shBX  = -0.150*W,  shFX  = 0.150*W;

  // ---- back arm & back leg (behind torso) ------------------------------
  const bArm = BM_drawLimb(ctx, shBX, shY, P.armB.a, P.armB.k, A1, A2,
                           armW*0.62, armW*0.48, armW*0.42, false, u, H);
  const bLeg = BM_drawLimb(ctx, hipBX, hipY, P.legB.a, P.legB.k, L1, L2,
                           legW*0.66, legW*0.48, legW*0.40, false, u, H);
  BM_drawBoot(ctx, bLeg.ex, bLeg.ey, bLeg.a2, W*0.115, false, u);

  // ---- glide membrane --------------------------------------------------
  if(state === 'glide'){
    BM_drawMembrane(ctx, bArm.ex, bArm.ey, bLeg.ex, bLeg.ey, shBX, shY, hipBX, hipY, W, H, u);
  }

  // ---- front leg -------------------------------------------------------
  const fLeg = BM_drawLimb(ctx, hipFX, hipY, P.legF.a, P.legF.k, L1, L2,
                           legW*0.70, legW*0.52, legW*0.44, true, u, H);
  BM_drawBoot(ctx, fLeg.ex, fLeg.ey, fLeg.a2, W*0.125, true, u);

  // ---- torso -----------------------------------------------------------
  ctx.save();
  BM_torsoPath(ctx, W, H, big);
  ctx.fillStyle = BM_grad(ctx,'body'+H.toFixed(1), 0, 0.24*H, 0, 0.66*H,
    [[0,PAL.batHi],[0.30,'#22273a'],[0.72,PAL.bat],[1,PAL.batLo]]);
  ctx.fill();
  // back-side shading wash
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BM_grad(ctx,'bodyside'+W.toFixed(1), -W*0.42, 0, W*0.20, 0,
    [[0,'rgba(0,0,0,0.62)'],[0.55,'rgba(0,0,0,0.14)'],[1,'rgba(0,0,0,0)']]);
  ctx.fillRect(-W*0.5, 0.24*H, W, 0.46*H);
  // pectoral / abdominal sculpting
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.0*u;
  ctx.beginPath();
  ctx.moveTo(-0.20*W, 0.345*H);
  ctx.quadraticCurveTo(0.0, 0.395*H, 0.22*W, 0.345*H);
  ctx.stroke();
  if(big){
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    for(let i=0;i<3;i++){
      const yy = 0.455*H + i*0.032*H;
      ctx.beginPath();
      ctx.moveTo(-0.19*W + i*0.012*W, yy);
      ctx.quadraticCurveTo(0, yy+0.012*H, 0.19*W - i*0.012*W, yy);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(150,172,230,0.16)';
    ctx.beginPath();
    ctx.moveTo(-0.26*W, 0.320*H); ctx.lineTo(-0.10*W, 0.302*H);
    ctx.moveTo( 0.26*W, 0.320*H); ctx.lineTo( 0.10*W, 0.302*H);
    ctx.stroke();
  }
  // shoulder top highlight
  ctx.fillStyle = 'rgba(158,180,240,0.15)';
  ctx.beginPath();
  ctx.ellipse(0.19*W, 0.312*H, 0.13*W, 0.030*H, -0.22, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
  // silhouette edge -- rebuild the torso path: the clipped block above left the
  // shoulder-highlight ellipse as the current path, so stroking here traced that
  // ellipse instead of the torso outline.
  BM_torsoPath(ctx, W, H, big);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.7*u;
  ctx.stroke();
  ctx.restore();

  // ---- emblem + belt ---------------------------------------------------
  BM_drawEmblem(ctx, W, H, big, u, t);
  BM_drawBelt(ctx, W, H, big, u);

  // ---- cape collar over the front shoulder -----------------------------
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-0.10*W, 0.268*H);
  ctx.quadraticCurveTo(0.14*W, 0.250*H, 0.26*W, 0.300*H);
  ctx.quadraticCurveTo(0.30*W, 0.356*H, 0.20*W, 0.392*H);
  ctx.quadraticCurveTo(0.20*W, 0.310*H, -0.10*W, 0.268*H);
  ctx.closePath();
  ctx.fillStyle = BM_grad(ctx,'collar'+H.toFixed(1), 0, 0.24*H, 0, 0.40*H,
    [[0,PAL.capeHi],[1,PAL.cape]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,172,230,0.22)';
  ctx.lineWidth = 0.8*u;
  ctx.stroke();
  ctx.restore();

  // ---- front arm -------------------------------------------------------
  const fArm = BM_drawLimb(ctx, shFX, shY, P.armF.a, P.armF.k, A1, A2,
                           armW*0.68, armW*0.52, armW*0.46, true, u, H);
  BM_drawGauntlet(ctx, fArm.kx, fArm.ky, fArm.ex, fArm.ey, fArm.a2, u, true);
  // fist
  ctx.save();
  ctx.fillStyle = PAL.batHi;
  ctx.beginPath();
  ctx.arc(fArm.ex, fArm.ey, armW*0.50, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,172,230,0.20)';
  ctx.beginPath();
  ctx.arc(fArm.ex - armW*0.10, fArm.ey - armW*0.14, armW*0.26, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // ---- head ------------------------------------------------------------
  BM_drawHead(ctx, W, H, u, t, state);

  // ---- front-edge rim light -------------------------------------------
  ctx.save();
  // The rim is what makes a near-black figure readable against a dark city,
  // and it is the single most recognisable thing about the reference look:
  // a cold hard edge down the lit side, falling off to nothing in shadow.
  ctx.strokeStyle = BM_grad(ctx,'rim'+H.toFixed(1), 0, 0.26*H, 0, H,
    [[0,'rgba(214,232,255,0.98)'],[0.55,'rgba(176,200,246,0.62)'],[1,'rgba(130,156,214,0.08)']]);
  ctx.lineWidth = Math.max(0.9, 1.5*u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0.255*W, 0.292*H);
  ctx.bezierCurveTo(0.315*W, 0.320*H, 0.300*W, 0.420*H, 0.252*W, 0.532*H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.250*W, 0.622*H);
  ctx.quadraticCurveTo(0.230*W, 0.700*H, 0.190*W, 0.760*H);
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
