// ═══════════════════════════════════════════════════════════════════════
//  SH_LIGHT — the deferred lighting pass: one fragment shader that turns the
//  G-buffer into the lit picture.
//
//  Per visible pixel, in order:
//    1. rebuild the world position from depth
//    2. MATERIAL  what the surface is made of, from its block id: procedural
//                 albedo detail, a perturbed normal, roughness, metalness. Tiles,
//                 mortar, grain, cracks, ribs, lit rooms behind the windows.
//    3. WET       rain makes exposed ground dark and glossy and pools in puddles,
//                 which are mirrors with ripples
//    4. LIGHT     the baked light, re-shaped by the detail normal; highlights from
//                 the nearest lamps (found through a grid of light lists); moving
//                 lights; the soft shadow each character casts
//    5. REFLECT   glossy surfaces trace a ray across the screen and pick up what
//                 the previous frame showed there, or the sky panorama
//    6. FOG
//
//  The quality ladder compiles variants of this shader: `Q_SSR n` sets the number
//  of reflection steps, `Q_LTEX n` the lamps examined per pixel (4 per n), `Q_DETAIL`
//  enables the class-specific material work and the window interiors, `Q_SHADOW`
//  the moon's shadow maps (`Q_SHB`/`Q_SHP` taps), `Q_SSAO n` screen-space
//  occlusion and `Q_SHAFT n` the moonlit air.
// ═══════════════════════════════════════════════════════════════════════

function SH_lightFS(defs) {
  return SH_HEAD + defs + TX_classDefines() + `
in vec2 vUV;
in vec3 vRay;
${SH_COMMON}
${SH_SKY}
uniform sampler2D uG0;
uniform sampler2D uG1;
uniform sampler2D uG2;
uniform sampler2D uG3;
uniform sampler2D uDepth;
uniform sampler2D uNoiseB;
uniform sampler2D uLut;
uniform sampler2D uLights;     // row 0: xyz, radius   row 1: rgb * intensity, kind
uniform sampler2D uGrid;       // 32 x 32 cells of 16 blocks, three texels (12 light indices) each
uniform sampler2D uTop;        // height below which a column is sheltered from the rain
uniform sampler2D uHist;       // last frame's picture
uniform sampler2D uEnv;        // sky panorama
uniform vec2 uNF;              // near, far
uniform float uPix;            // size of a pixel at distance 1
uniform mat4 uVPj;             // this frame's view-projection, jitter included
uniform mat4 uPrevVP;
uniform float uFrame;
uniform vec3 uSkyTint;
uniform float uSkyI;
uniform float uBlockI;
uniform float uBevel;
uniform float uWet;
uniform float uRain;
uniform float uBase;           // y of a building's first floor
uniform float uNear;           // radius of the detailed chunks
uniform float uSpec;           // strength of lamp highlights
uniform vec4 uDyn[8];          // moving lights: xyz, radius
uniform vec4 uDynC[8];         //                rgb
uniform int uDynN;
uniform vec4 uCap[8];          // characters: feet xyz, height
uniform vec4 uCapL[8];         // the light each one blocks: xyz, strength (negative: the moon)
uniform int uCapN;
uniform int uDbg;              // a diagnostic view instead of the picture (tools only)
#ifdef Q_SHADOW
uniform highp sampler2DShadow uShC;   // both cascades side by side, compared in hardware
uniform highp sampler2D uShR;         // the same texture, raw depth, for the blocker search
uniform mat4 uShVP0;
uniform mat4 uShVP1;
uniform vec4 uShK;                    // x, y: world size of a texel in each cascade; z: depth range; w: 1 / texels across a cascade
#endif
layout(location = 0) out vec4 oColor;

float linZ(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
vec4 noiseA(vec2 uv, float tile, float fw) { return textureLod(uNoiseA, uv / tile, log2(max(fw * 256.0 / tile, 1.0))); }
vec4 noiseB(vec2 uv, float tile, float fw) { return textureLod(uNoiseB, uv / tile, log2(max(fw * 256.0 / tile, 1.0))); }

float ggxD(float nh, float a) { float a2 = a * a, q = nh * nh * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * q * q + 1e-7); }
float ggxV(float nl, float nv, float a) { float k = a * 0.5; return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k) + 1e-5); }

// One light on one surface: the specular lobe only (diffuse comes from the bake).
vec3 specLobe(vec3 N, vec3 V, vec3 L, float a, vec3 F0, float nv) {
  vec3 H = normalize(V + L);
  float nl = max(dot(N, L), 0.0), nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
  return F * (ggxD(nh, a) * ggxV(nl, nv, a) * nl);
}

// Rings spreading from raindrops: each cell of a grid fires one drop on its own clock.
vec2 ripples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 1.25 : 2.05) + float(k) * 17.3;
    vec2 c = floor(q), f = q - c;
    vec2 r = h22(c + float(k) * 3.1);
    float ph = fract(t * (0.85 + r.x * 0.5) + r.y * 7.0);
    vec2 d = f - (0.3 + 0.4 * r);
    float dl = length(d), rad = ph * 0.52;
    float ring = sin((dl - rad) * 46.0) * smoothstep(0.085, 0.0, abs(dl - rad)) * (1.0 - ph) * (1.0 - ph);
    acc += d / max(dl, 1e-3) * ring;
  }
  return acc;
}

#ifdef Q_SSR
// A ray marched across the screen, in world space with a growing step. Returns
// what last frame showed where it lands, and how much to trust it.
vec4 traceSSR(vec3 wp, vec3 N0, vec3 R, float rough) {
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588238);
  vec3 rr = R;
  if (rough > 0.05) {
    vec2 h = h22(gl_FragCoord.xy + uFrame * 13.7) - 0.5;
    vec3 t1 = normalize(cross(R, vec3(0.31, 0.95, 0.07))), t2 = cross(R, t1);
    rr = normalize(R + (t1 * h.x + t2 * h.y) * rough * rough * 3.0);
    if (dot(rr, N0) < 0.02) rr = R;
  }
  vec3 p = wp + N0 * 0.04;
  float stp = 0.26, t = stp * (0.35 + jit);
  vec3 prev = p, hp = p;
  bool hit = false;
  for (int i = 0; i < Q_SSR; i++) {
    vec3 q = p + rr * t;
    vec4 c = uVPj * vec4(q, 1.0);
    if (c.w < 0.05) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float dd = c.w - linZ(textureLod(uDepth, uv, 0.0).r);
    if (dd > 0.0 && dd < stp * 1.4 + 0.9) {
      vec3 a = prev, b = q;
      for (int k = 0; k < 5; k++) {
        vec3 m = (a + b) * 0.5;
        vec4 cm = uVPj * vec4(m, 1.0);
        if (cm.w > linZ(textureLod(uDepth, cm.xy / cm.w * 0.5 + 0.5, 0.0).r)) b = m; else a = m;
      }
      hp = b; hit = true;
      break;
    }
    prev = q; stp *= 1.19; t += stp;
  }
  vec4 pc;
  if (hit) pc = uPrevVP * vec4(hp, 1.0);
  else {
    // nothing in the way: if the sky is on screen in that direction, mirror it
    vec4 c = uVPj * vec4(rr, 0.0);
    if (c.w < 0.01) return vec4(0.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    if (textureLod(uDepth, uv, 0.0).r < 1.0) return vec4(0.0);
    pc = uPrevVP * vec4(rr, 0.0);
  }
  if (pc.w < 0.01) return vec4(0.0);
  vec2 huv = pc.xy / pc.w * 0.5 + 0.5;
  float edge = min(min(huv.x, 1.0 - huv.x), min(huv.y, 1.0 - huv.y));
  if (edge <= 0.0) return vec4(0.0);
  vec3 col = min(textureLod(uHist, huv, 0.0).rgb, vec3(24.0));
  return vec4(col, smoothstep(0.0, 0.07, edge));
}
#endif

// Soft shadow of an upright capsule (feet at c, height h, radius r) on point p,
// cast by a light at lp. 1 = lit.
float capShadow(vec3 p, vec3 c, float h, float r, vec3 lp) {
  vec3 ld = lp - p;
  float ll = length(ld);
  ld /= ll;
  vec3 a = c + vec3(0.0, r, 0.0);
  float segL = max(h - 2.0 * r, 0.01);
  vec3 w0 = p - a;
  float b = ld.y, d = dot(ld, w0), e = w0.y, den = 1.0 - b * b;
  float s = den > 1e-4 ? clamp((e - b * d) / den, 0.0, segL) : 0.0;
  float t = clamp(b * s - d, 0.0, ll);
  s = clamp(e + b * t, 0.0, segL);
  t = clamp(b * s - d, 0.0, ll);
  float dist = length(w0 + ld * t - vec3(0.0, s, 0.0));
  float pen = r * (0.30 + t * 0.22);
  return smoothstep(r - pen * 0.5, r + pen, dist);
}

// The shadow of the clouds: how thick the cloud deck is where the line from this
// point to the moon crosses it. The same field, moving at the same speed, as the
// clouds drawn in the sky, so the patches of moonlight sweep over the city with them.
float cloudShade(vec3 p) {
  float t = (uCloudH - p.y) / max(uMoonDir.y, 0.05);
  vec2 c = p.xz + uMoonDir.xz * t + uTime * vec2(3.6, 1.4);
  return 1.0 - 0.58 * cloudDensity(c, mix(0.50, 0.36, uStorm));
}

#ifdef Q_SHADOW
  const vec2 SH_TAPS[8] = vec2[8](vec2(-0.613, 0.354), vec2(0.168, -0.795), vec2(0.735, 0.481), vec2(-0.316, -0.278),
  vec2(0.384, 0.069), vec2(-0.795, -0.494), vec2(-0.087, 0.861), vec2(0.909, -0.249));

// The moon's light at a point from the shadow maps: 1 lit, 0 in shadow. The
// penumbra widens with the distance to whatever casts it (the haze turns the moon
// into a broad light): a parapet throws a crisp edge, a tower across the street a
// soft one. .y is how far to trust it: 0 outside the maps, where the bake stands.
vec2 moonShadow(vec3 wp, vec3 N0, float jit) {
  int c = 0;
  vec4 q = uShVP0 * vec4(wp + N0 * uShK.x * 1.5, 1.0);
  float e = max(abs(q.x), abs(q.y));
  if (e > 0.86 + 0.10 * jit) {                       // the far cascade, behind a dithered seam
    q = uShVP1 * vec4(wp + N0 * uShK.y * 1.5, 1.0);
    e = max(abs(q.x), abs(q.y));
    if (e > 0.985) return vec2(1.0, 0.0);
    c = 1;
  }
  vec3 sp = q.xyz * 0.5 + 0.5;
  float tw = c == 0 ? uShK.x : uShK.y;              // world size of one texel
  vec2 tUV = vec2(0.5, 1.0) * uShK.w;               // one texel, in the atlas
  float u0 = float(c) * 0.5 + tUV.x, u1 = float(c) * 0.5 + 0.5 - tUV.x;
  vec2 uv = vec2((sp.x + float(c)) * 0.5, sp.y);
  float ref = sp.z;
  float ang = jit * 6.2831853;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float fade = 1.0 - smoothstep(0.88, 0.985, e) * float(c);
  // where are the blockers, and how far above the point?
  float sr = 1.3 / tw;
  float bs = 0.0, bn = 0.0;
  for (int i = 0; i < Q_SHB; i++) {
    vec2 o = rot * SH_TAPS[i] * sr * tUV;
    float d = textureLod(uShR, vec2(clamp(uv.x + o.x, u0, u1), uv.y + o.y), 0.0).r;
    if (d < ref) { bs += d; bn += 1.0; }
  }
  if (bn == 0.0) return vec2(1.0, fade);
  float gap = (ref - bs / bn) * uShK.z;
  float pen = clamp(gap * 0.020, tw * 0.9, 1.6) / tw;
  float lit = 0.0;
  for (int i = 0; i < Q_SHP; i++) {
    vec2 o = rot * SH_TAPS[7 - i] * pen * tUV;
    lit += textureLod(uShC, vec3(clamp(uv.x + o.x, u0, u1), uv.y + o.y, ref), 0.0);
  }
  return vec2(lit / float(Q_SHP), fade);
}

#ifdef Q_SHAFT
// How much of the air between the eye and the point the moon reaches. Fog glows in
// the open and goes dark in the shadow of the towers, which is what draws shafts of
// moonlight between them.
float moonAir(vec3 rd, float len, float jit) {
  float acc = 0.0, ws = 0.0;
  for (int i = 0; i < Q_SHAFT; i++) {
    vec3 p = uCam + rd * (len * (float(i) + jit) / float(Q_SHAFT));
    float w = fogDensityAt(p.y);
    vec4 q = uShVP1 * vec4(p, 1.0);
    float v = 1.0;
    if (max(abs(q.x), abs(q.y)) < 0.98) v = textureLod(uShC, vec3((q.x * 0.5 + 1.5) * 0.5, q.y * 0.5 + 0.5, q.z * 0.5 + 0.5), 0.0);
    acc += v * w; ws += w;
  }
  return acc / max(ws, 1e-4);
}
#endif
#endif

#ifdef Q_SSAO
// Occlusion from what is on the screen: points in the hemisphere over the surface,
// tested against the depth buffer. A few samples, turned every frame; the temporal
// blend does the averaging. It catches what the bake cannot see: characters, the
// gap under a car, the corner a crate makes with a wall.
float ssao(vec3 wp, vec3 N, float jit) {
  vec2 r2 = h22(gl_FragCoord.xy * 0.731 + uFrame * 1.37);
  vec3 T = normalize(cross(N, abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  float occ = 0.0;
  for (int i = 0; i < Q_SSAO; i++) {
    float fi = (float(i) + jit) / float(Q_SSAO);
    float phi = 6.2831853 * fract(r2.x + float(i) * 0.618034);
    float u = fract(r2.y + float(i) * 0.7548777);
    vec3 d = (T * cos(phi) + B * sin(phi)) * sqrt(u) + N * sqrt(1.0 - u);
    vec3 s = wp + N * 0.03 + d * (1.5 * mix(0.10, 1.0, fi * fi));
    vec4 c = uVPj * vec4(s, 1.0);
    if (c.w < 0.15) continue;
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float dd = c.w - linZ(textureLod(uDepth, suv, 0.0).r);
    occ += step(0.05, dd) * (1.0 - smoothstep(0.9, 3.0, dd));
  }
  return 1.0 - occ / float(Q_SSAO);
}
#endif

#ifdef Q_DETAIL
// Blocky lettering: a row of 3 x 5 glyphs picked by hash. p is in glyph cells.
float glyphs(vec2 p, float seed) {
  vec2 c = floor(p), f = p - c;
  if (h21(c + seed) < 0.16) return 0.0;                       // a space
  vec2 g = floor(vec2(f.x * 4.0 - 0.5, f.y * 7.0 - 1.0));
  if (g.x < 0.0 || g.x > 2.0 || g.y < 0.0 || g.y > 4.0) return 0.0;
  return step(0.42, h21(c * 7.0 + g + seed * 3.0));
}

// Everything behind a pane of glass. A window knows where it sits in its facade
// (the style's window pitch and floor height travel in the LUT, the building's
// offset in the vertex), so each opening gets a frame and, when it is lit, a room:
// a box intersected by the view ray, with a lamp on the ceiling, something against
// the back wall, and blinds or curtains by a throw of the dice.
void facade(int cls, vec3 wp, vec3 N0, vec3 T, vec3 V, float code, float fw, float fwd, float emit, float boost, float kind,
            inout vec3 alb, inout float rough, inout float f0, inout vec3 emitCol, inout float metal) {
  vec3 base = alb;
  vec3 lc = mix(base, vec3(lum(base)), 0.30);                     // the colour of the light in the room
  bool lit = cls == MC_WINDOW;
  alb = lit ? vec3(0.012) : base * 0.55;
  metal = 0.0; f0 = 0.05;
  if (code > 250.5) {
    // the far city: bands of panes, some of them lit
    float ua = abs(N0.x) > 0.5 ? wp.z : wp.x;
    vec2 q = vec2(ua * 0.5, wp.y / 3.0);
    float on = h21(floor(q) + N0.xz * 3.0);
    float pane = smoothstep(0.0, 0.12 + fw, min(fract(q.x), 1.0 - fract(q.x)));
    if (lit) emitCol = base * emit * boost * pane * step(0.30, on) * (0.85 + 0.9 * fract(on * 7.0));
    else emitCol = vec3(1.0, 0.62, 0.30) * step(0.93, on) * pane * 0.45;
    return;
  }
  if (code < 0.5 || abs(N0.y) > 0.5) { if (lit) emitCol = lc * emit * boost; return; }
  float c1 = code - 1.0, sty = mod(c1, 16.0), wo = floor(c1 / 16.0);
  vec4 st = texelFetch(uLut, ivec2(int(sty + 0.5), 3), 0) * 255.0;         // pitch, floor height, band start, band rows
  float store = texelFetch(uLut, ivec2(int(sty + 0.5) + 16, 3), 0).r;
  vec3 vox = wp - N0 * 0.5;
  bool xf = abs(N0.x) > 0.5;
  float ua = (xf ? wp.z : wp.x) + wo;
  float cu = floor((floor(xf ? vox.z : vox.x) + wo) / st.x);
  float fl = floor((floor(vox.y) - uBase) / st.y);
  bool shop = fl < 0.5 && store > 0.5;
  float wy = shop ? 1.0 : st.z, wr = shop ? 3.0 : st.w;
  float W = st.x - 1.0;
  float lu = ua - cu * st.x - 1.0, lv = wp.y - uBase - fl * st.y - wy;
  vec2 hr = h22(vec2(cu * 7.0 + fl * 131.0, floor(vox.x / 48.0) * 3.0 + floor(vox.z / 48.0) * 5.0 + N0.x * 2.0 + N0.z * 3.0));
  vec2 hr2 = h22(hr * 91.7 + 3.3);

  // the frame, and a mullion down the middle of a wide opening
  float fr = min(min(lu, W - lu), min(lv, wr - lv));
  float frame = 1.0 - smoothstep(0.045, 0.06 + fw, fr);
  if (W > 1.5) frame = max(frame, 1.0 - smoothstep(0.022, 0.035 + fw, abs(lu - W * 0.5)));
  if (wr > 2.5 && !shop) frame = max(frame, 1.0 - smoothstep(0.022, 0.035 + fw, abs(lv - wr * 0.64)));
  frame *= clamp(0.07 / (fw + 1e-4), 0.0, 1.0);

  if (lit) {
    vec3 rdw = vec3(dot(-V, T), -V.y, max(dot(V, N0), 0.02));
    rdw += vec3(1e-4);
    float D = (shop ? 4.5 : 2.8) + 2.2 * hr.x;
    vec3 ro = vec3(lu, lv, 0.0);
    vec3 lo = vec3(-0.5, -wy, 0.0), hi = vec3(W + 0.5, st.y - wy - 0.22, D);
    vec3 tm = max((lo - ro) / rdw, (hi - ro) / rdw);
    float t = min(tm.x, min(tm.y, tm.z));
    vec3 hp = ro + rdw * t;
    vec3 wc = mix(vec3(0.74, 0.68, 0.58), vec3(0.50, 0.58, 0.68), hr.y);
    vec3 col;
    float lampGlow = 0.0;
    if (t == tm.z) {
      col = wc;
      float bx = hr2.x * (W - 0.4), hgt = hp.y - lo.y;
      if (shop) {
        // shelves along the back of a shop
        float sh = step(0.5, fract(hgt * 1.6)) * step(hgt, 2.6);
        col = mix(col, vec3(hr.x, 0.45, 1.0 - hr.x) * 0.55 + 0.1, sh * step(0.3, h21(floor(vec2(hp.x * 2.0, hgt * 1.6)) + hr * 50.0)));
      } else {
        col = mix(col, wc * vec3(0.32, 0.25, 0.20), step(bx, hp.x) * step(hp.x, bx + 0.95) * step(hgt, 1.9 + hr2.y * 0.5));       // a door or a wardrobe
        col = mix(col, vec3(hr.y, 0.40, 1.0 - hr.x) * 0.7, step(abs(hp.x - (W - bx)), 0.36) * step(abs(hgt - 2.0), 0.27));      // a picture
      }
    } else if (t == tm.y) {
      if (rdw.y > 0.0) { col = wc * 1.1; lampGlow = step(abs(hp.x - W * 0.5), 0.55) * step(abs(hp.z - D * 0.45), 0.4); }
      else col = wc * vec3(0.34, 0.27, 0.21) * (0.8 + 0.4 * step(0.5, fract(hp.x * 1.5)));
    } else col = wc * 0.82;
    vec3 lp = vec3(W * 0.5, hi.y - 0.15, D * 0.45);
    float li = 1.0 / (1.0 + dot(hp - lp, hp - lp) * 0.42);
    vec3 room = (col * li * 1.55 + lampGlow * 2.6) * lc * emit * boost;
    // a television, in some of the cool-lit rooms
    if (base.b > base.r && hr.x > 0.45) room *= 0.80 + 0.20 * sin(uTime * (6.0 + hr2.x * 9.0) + hr.y * 40.0) * step(0.2, fract(uTime * 0.7 + hr.x));
    if (!shop) {
      if (hr2.x < 0.30) {
        // blinds, lowered part of the way
        float inb = step((1.0 - (0.25 + 0.75 * hr2.y)) * wr, lv);
        float slat = mix(0.55 + 0.45 * sin(lv * 31.4), 0.55, clamp(fw * 12.0, 0.0, 1.0));
        room = mix(room, lc * emit * boost * 0.40 * slat, inb);
      } else if (hr2.x < 0.56) {
        // curtains, drawn at the sides
        float cw = (0.14 + 0.24 * hr2.y) * W;
        float inc = 1.0 - smoothstep(cw - 0.03, cw, min(lu, W - lu));
        room = mix(room, lc * vec3(0.95, 0.55, 0.40) * emit * boost * 0.30 * (0.72 + 0.28 * sin(lu * 23.0)), inc);
      }
    }
    // too far to make out a room: its average
    room = mix(room, lc * emit * boost * 0.62, smoothstep(0.07, 0.30, fwd));
    emitCol = room * (1.0 - frame);
  } else {
    // an unlit window: dark glass, sometimes closed blinds, now and then a night light
    if (!shop && hr2.x < 0.24) {
      float slat = mix(0.6 + 0.4 * sin(lv * 31.4), 0.6, clamp(fw * 12.0, 0.0, 1.0));
      alb = vec3(0.11, 0.115, 0.125) * slat; rough = 0.6; f0 = 0.03;
    } else if (hr2.x > 0.955) emitCol = vec3(0.045, 0.030, 0.014) * (1.0 - frame);
    else if (shop) {
      // a closed shop: the street's light reaches a little way in
      alb = base * 0.5 + vec3(0.012) * step(0.5, h21(floor(vec2(lu * 1.5 + cu * 9.0, lv * 1.2))));
    }
  }
  alb = mix(alb, vec3(0.014, 0.016, 0.020), frame);
  rough = mix(rough, 0.45, frame);
}

// A lit sign. kind 0: the band over a shop, two glyphs to the block. kind 2: a neon
// blade, one glyph to the block. kind 1: a billboard, an LED wall running adverts;
// The code says which part of the panel this voxel is, so the picture spans it whole.
vec3 signFace(vec3 wp, vec3 N0, vec2 uv, float fw, vec3 base, float kind, float code) {
  if (kind > 0.5 && kind < 1.5) {
    float lc = max(code - 128.0, 0.0), ia = floor(lc / 6.0 + 0.01);
    vec2 p = vec2(ia + fract(uv.x), lc - ia * 6.0 + fract(uv.y)) / vec2(12.0, 6.0);
    // one advert per panel: every voxel of it agrees on where the panel starts
    vec2 sd = h22(vec2(floor(uv.x) - ia, floor(dot(wp - N0 * 0.5, abs(N0)))) + 7.0);
    float clock = uTime * 0.09 + sd.x * 9.0, ad = floor(clock);
    vec2 r = h22(vec2(ad, sd.y * 31.0) + 0.5);
    vec3 ca = 0.5 + 0.5 * cos(6.2831853 * (r.x + vec3(0.0, 0.33, 0.67)));
    vec3 cb = 0.5 + 0.5 * cos(6.2831853 * (r.y + vec3(0.55, 0.15, 0.80)));
    vec3 c = mix(ca * 0.30, cb * 0.55, smoothstep(0.0, 1.0, p.x * 0.6 + p.y * 0.4 + 0.15 * sin(uTime * 0.5 + r.x * 6.0)));
    // a mark on the left: a disc or a ring
    float dl = length((p - vec2(0.22, 0.5)) * vec2(2.0, 1.0));
    c = mix(c, vec3(1.0, 0.98, 0.92), (smoothstep(0.34, 0.31, dl) - smoothstep(0.21, 0.18, dl) * step(0.5, r.x)) * 0.9);
    // and two lines of lettering beside it
    if (p.x > 0.46 && p.x < 0.96) {
      if (p.y > 0.50 && p.y < 0.82) c = mix(c, vec3(1.0, 0.98, 0.90), glyphs(vec2((p.x - 0.46) * 14.0, (p.y - 0.50) * 3.1), ad * 3.0 + 1.0));
      else if (p.y > 0.20 && p.y < 0.38 && p.x < 0.88) c = mix(c, ca + 0.35, glyphs(vec2((p.x - 0.46) * 24.0, (p.y - 0.20) * 5.5), ad * 5.0 + 2.0) * 0.85);
    }
    // the LED grid, until it is too fine to see
    vec2 led = abs(fract(uv * 8.0) - 0.5);
    c *= mix(1.0, smoothstep(0.50, 0.28, max(led.x, led.y)) * 1.35, clamp(0.035 / (fw + 1e-4), 0.0, 1.0));
    return c * smoothstep(0.0, 0.05, fract(clock)) * 0.85;
  }
  vec2 p = kind > 1.5 ? uv : vec2(uv.x * 2.0, uv.y);
  float g = mix(glyphs(p, 7.0), 0.40, smoothstep(0.03, 0.14, fw));
  vec2 f = abs(fract(uv) - 0.5);
  float casing = kind > 1.5 ? smoothstep(0.50, 0.44, max(f.x, f.y)) : smoothstep(0.50, 0.44, f.y);
  return (base * (0.07 + 1.20 * g) + vec3(0.35) * g * g) * casing;
}
#endif

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float dz = texelFetch(uDepth, px, 0).r;
  vec3 rd = normalize(vRay);
  if (dz >= 1.0) { oColor = vec4(skyColor(rd, 1.0), 1.0); return; }
  float zv = linZ(dz);
  vec3 rel = vRay * (zv / uNF.y);
  vec3 wp = uCam + rel;
  float dist = length(rel);
  vec3 V = -rd;
  vec4 g0 = texelFetch(uG0, px, 0), g1 = texelFetch(uG1, px, 0), g2 = texelFetch(uG2, px, 0), g3 = texelFetch(uG3, px, 0);
  vec3 N0 = normalize(g1.xyz * 2.0 - 1.0);
  int id = int(g1.a * 255.0 + 0.5);
  bool ent = id >= 254;
  vec3 alb = pow(g0.rgb, vec3(2.2));
  float emit = g0.a * 4.0;
  float skyV = g2.a, moonV = g3.r;
  float aoV = ent ? 1.0 : g3.b;                       // the vertex's own corner occlusion
  vec3 lampB = g2.rgb * (2.0 * uBlockI);
  float jitS = ign(gl_FragCoord.xy + uFrame * 5.588238);

  vec3 N = N0;
  float rough = 0.5, metal = 0.0, f0 = 0.04, cavity = 1.0, pud = 0.0, wet = 0.0;
  vec3 emitCol = vec3(0.0);
  float ndv0 = max(dot(N0, V), 0.0);
  float fw = dist * uPix / max(ndv0, 0.12);

  if (ent) {
    emitCol = alb * emit * 1.6;
    rough = mix(0.62, 0.40, uWet); f0 = 0.04;
    if (id == 254) { rough = 0.7; emitCol = alb * emit * 2.2; }
  } else {
    vec4 l0 = texelFetch(uLut, ivec2(id, 0), 0), l1 = texelFetch(uLut, ivec2(id, 1), 0), l2 = texelFetch(uLut, ivec2(id, 2), 0);
    int cls = int(l0.r * 255.0 + 0.5);
    rough = l0.g; metal = l0.b;
    float boost = l0.a * 255.0 / 16.0;
    vec2 tsz = l1.rg * 255.0 / 16.0;
    float bond = l1.b, groove = l1.a * 0.255;
    float grain = l2.r, tintV = l2.g, wetR = l2.b, kind = l2.a * 255.0;
    vec3 T, B;
    if (abs(N0.y) > 0.5) { T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); }
    else if (abs(N0.x) > 0.5) { T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); }
    else { T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
    vec2 uv = vec2(dot(wp, T), dot(wp, B));
    bool upF = N0.y > 0.5;
    float nearK = 1.0 - smoothstep(70.0, 160.0, dist);

    if (cls == MC_WATER) {
      float lw = log2(max(fw * 26.0, 1.0));
      vec2 w1 = textureLod(uNoiseA, uv * 0.045 + uTime * vec2(0.011, 0.006), lw).gb - 0.5;
      vec2 w2 = textureLod(uNoiseA, uv * 0.13 - uTime * vec2(0.019, -0.012), lw + 1.5).gb - 0.5;
      vec2 w3 = textureLod(uNoiseA, uv * 0.41 + uTime * vec2(-0.03, 0.04), lw + 3.0).gb - 0.5;
      vec2 ws = w1 * 1.5 + w2 * 0.9 + w3 * 0.5;
      ws += ripples(uv, uTime) * 0.10 * uRain * clamp(0.08 / (fw + 1e-4), 0.0, 1.0);
      N = normalize(vec3(-ws.x * 0.9, 1.0, -ws.y * 0.9));
      alb *= 0.35; rough = 0.045; f0 = 0.02; pud = 1.0; wet = 1.0; metal = 0.0;
      if (emit > 0.0) emitCol = alb * emit * boost;
    } else {
      vec4 nf = noiseA(uv, 5.0, fw);
      vec4 nc = noiseA(uv + 37.0, 31.0, fw);
      vec2 slope = (nf.gb - 0.5) * 2.0;
      float joint = 0.0, trnd = 0.5, trnd2 = 0.5;
      // tiles: bricks, slabs, panels, planks
      if (tsz.x > 0.0) {
        vec2 q = uv / tsz;
        q.x += bond * floor(q.y);
        vec2 idt = floor(q), f = q - idt;
        vec2 e = min(f, 1.0 - f) * tsz;
        float dj = min(e.x, e.y);
        vec2 jd = e.x < e.y ? vec2(f.x < 0.5 ? -1.0 : 1.0, 0.0) : vec2(0.0, f.y < 0.5 ? -1.0 : 1.0);
        joint = (1.0 - smoothstep(groove * 0.35, groove + fw * 0.7, dj)) * clamp(groove / (fw * 0.9 + 1e-4), 0.0, 1.0);
        vec2 hr = h22(idt + 3.7);
        trnd = hr.x; trnd2 = hr.y;
        alb *= 1.0 + (trnd - 0.5) * 2.0 * tintV * clamp(min(tsz.x, tsz.y) / (fw * 2.0 + 1e-4), 0.0, 1.0);
        N += (T * jd.x + B * jd.y) * joint * 0.55;
        cavity *= 1.0 - joint * 0.42;
      }
      // the voxel's own edge: a hairline, so a wall still reads as blocks
      bool glassy = cls == MC_GLASS || cls == MC_WINDOW || cls == MC_SIGN;
      if (uBevel > 0.0 && !glassy && cls != MC_ASPHALT && cls != MC_PAINT && cls != MC_LAVA && !(tsz.x == 1.0 && tsz.y == 1.0)) {
        vec2 f = fract(uv), e = min(f, 1.0 - f);
        float dj = min(e.x, e.y);
        vec2 jd = e.x < e.y ? vec2(f.x < 0.5 ? -1.0 : 1.0, 0.0) : vec2(0.0, f.y < 0.5 ? -1.0 : 1.0);
        float jb = (1.0 - smoothstep(0.006, 0.022 + fw * 0.7, dj)) * clamp(0.022 / (fw * 0.9 + 1e-4), 0.0, 1.0) * uBevel;
        N += (T * jd.x + B * jd.y) * jb * 0.40;
        cavity *= 1.0 - jb * 0.28;
      }
      // grain: fine relief and coarse blotches
      alb *= 1.0 + ((nf.r - 0.5) * 0.50 + (nc.r - 0.5) * 0.45) * grain;
      N -= (T * slope.x + B * slope.y) * grain * 0.40;
      rough = clamp(rough + (nf.r - 0.5) * 0.20 * grain, 0.03, 1.0);

#ifdef Q_DETAIL
      if (cls == MC_ASPHALT) {
        vec4 cb = noiseB(uv, 2.3, fw);
        alb += vec3(0.030, 0.030, 0.032) * smoothstep(0.74, 0.95, cb.g) * smoothstep(0.50, 0.15, cb.r) * nearK;      // aggregate
        vec4 cr = noiseB(uv + 5.3, 15.0, fw);
        float crack = (1.0 - smoothstep(0.0, 0.03 + fw * 0.4, cr.b)) * step(0.50, cr.g) * nearK;
        alb *= 1.0 - 0.55 * crack; cavity *= 1.0 - 0.4 * crack;
        float tarP = smoothstep(0.60, 0.65, nc.a);                                                               // repairs
        alb *= mix(1.0, 0.70, tarP); rough = mix(rough, 0.78, tarP);
      } else if (cls == MC_PAINT) {
        float wear = smoothstep(0.42, 0.78, nf.r * 0.55 + nc.a * 0.60) * grain * 1.5;
        alb = mix(alb, vec3(0.015, 0.017, 0.021) * (0.7 + 0.6 * nf.r), clamp(wear, 0.0, 0.85));
      } else if (cls == MC_PAVER) {
        alb *= 1.0 - 0.32 * smoothstep(0.55, 0.82, nc.a);
        N += (T * (trnd - 0.5) + B * (trnd2 - 0.5)) * 0.045;                                                      // no two slabs lie quite level
      } else if (cls == MC_CONCRETE) {
        alb *= 1.0 - 0.26 * smoothstep(0.52, 0.80, nc.a);
        if (!upF) alb *= 1.0 - 0.30 * smoothstep(0.50, 0.80, noiseA(vec2(uv.x * 1.3, uv.y * 0.10), 6.0, fw).a);     // streaks where water runs down
      } else if (cls == MC_BRICK) {
        alb = mix(alb, vec3(0.105, 0.100, 0.095), joint * 0.85);
      } else if (cls == MC_METAL) {
        float br = noiseA(vec2(uv.x * 0.14, uv.y * 3.0), 4.0, fw).r;
        rough = clamp(rough + (br - 0.5) * 0.22, 0.05, 1.0);
        alb *= 0.88 + 0.24 * br;
      } else if (cls == MC_RUST) {
        float rs = smoothstep(0.34, 0.70, nc.r * 0.62 + nf.a * 0.50);
        alb = mix(alb * 0.50, alb * vec3(1.28, 0.95, 0.72), rs);
        metal *= 1.0 - rs; rough = mix(0.48, 0.93, rs);
      } else if (cls == MC_ROOF) {
        if (grain > 0.9) {
          vec4 cb = noiseB(uv, 1.3, fw);
          alb *= 0.78 + 0.44 * cb.g;
          N += (T * (cb.g - 0.5) + B * (fract(cb.g * 7.0) - 0.5)) * 0.35 * nearK;
        } else rough = mix(rough, 0.52, smoothstep(0.50, 0.72, nc.a));
      } else if (cls == MC_WOOD) {
        alb *= 0.74 + 0.52 * noiseA(vec2(uv.x * 0.12, uv.y * 2.6) + trnd * 9.0, 3.0, fw).r;
      } else if (cls == MC_FOLIAGE) {
        alb *= 0.62 + 0.86 * nf.r;
        alb = mix(alb, alb * vec3(1.32, 1.22, 0.62), smoothstep(0.60, 0.90, nc.a) * 0.35);
        N -= (T * slope.x + B * slope.y) * 0.55;
      } else if (cls == MC_SNOW) {
        N -= (T * (nc.g - 0.5) + B * (nc.b - 0.5)) * 0.7;
        float gl = smoothstep(0.955, 1.0, noiseB(uv, 0.6, fw).a) * nearK;
        emitCol += vec3(0.30, 0.36, 0.48) * gl * (0.25 + skyV) * pow(max(dot(reflect(-V, N0), uMoonDir) * 0.5 + 0.5, 0.0), 3.0);
      } else if (cls == MC_ICE) {
        vec4 cr = noiseB(uv, 3.2, fw);
        float crack = (1.0 - smoothstep(0.0, 0.028 + fw * 0.5, cr.b)) * nearK;
        float frost = smoothstep(0.50, 0.76, nc.r);
        alb = mix(alb * 0.50, vec3(0.62, 0.74, 0.82), crack * 0.7);
        alb = mix(alb, alb * 1.25 + 0.03, frost * 0.5);
        rough = mix(mix(rough, 0.50, frost * 0.6), 0.5, crack);
        f0 = 0.022; pud = max(pud, (1.0 - frost * 0.6) * (1.0 - crack) * 0.9);
      } else if (cls == MC_GROUND) {
        alb *= 0.76 + 0.48 * noiseB(uv, 1.1, fw).g;
      } else if (cls == MC_CONTAINER) {
        if (!upF) {
          float ph = uv.x * 4.0 * 6.2831853;
          float rf = clamp(0.10 / (fw + 1e-4), 0.0, 1.0);
          N += T * cos(ph) * 0.55 * rf;
          cavity *= 1.0 - 0.22 * rf * smoothstep(-0.2, -1.0, sin(ph));
        }
        float chip = smoothstep(0.64, 0.74, nf.a * 0.62 + nc.r * 0.50);
        alb = mix(alb, vec3(0.085, 0.034, 0.014), chip * 0.8);
        rough = mix(rough, 0.9, chip); metal *= 1.0 - chip;
      } else if (cls == MC_CARPAINT) {
        vec4 fk = noiseB(uv, 0.33, fw);
        N += (T * (fk.g - 0.5) + B * (fk.a - 0.5)) * 0.05 * nearK;
        f0 = 0.05;
      } else if (cls == MC_COPPER) {
        float pt = smoothstep(0.30, 0.70, nc.r * 0.70 + nf.a * 0.40);
        alb = mix(vec3(0.16, 0.07, 0.03), alb, pt);
        metal = mix(0.9, 0.15, pt); rough = mix(0.38, 0.82, pt);
      } else if (cls == MC_PAINTED) {
        alb *= 1.0 - 0.22 * smoothstep(0.55, 0.85, nc.a);
      } else if (cls == MC_GLASS || cls == MC_WINDOW) {
        facade(cls, wp, N0, T, V, g3.g * 255.0, fw, dist * uPix, emit, boost, kind, alb, rough, f0, emitCol, metal);
        N = N0; cavity = 1.0;
        // rain running down the pane
        if (!upF) rough = clamp(rough + 0.10 * uWet * smoothstep(0.55, 0.8, noiseA(vec2(uv.x * 2.2, uv.y * 0.18 + uTime * 0.05), 3.0, fw).r), 0.03, 1.0);
      } else if (cls == MC_SIGN) {
        emitCol = signFace(wp, N0, uv, fw, alb, kind, g3.g * 255.0) * emit * boost;
        alb = vec3(0.012); N = N0; rough = 0.25; cavity = 1.0;
      }
#else
      if (cls == MC_GLASS) { alb *= 0.55; f0 = 0.05; N = N0; }
      else if (cls == MC_WINDOW || cls == MC_SIGN) { emitCol = alb * emit * boost * 0.7; alb = vec3(0.012); N = N0; }
#endif
      if (cls == MC_EMISSIVE) {
        // a lens: ribbed glass with a hot middle, not a flat white square
        vec2 f = abs(fract(uv) - 0.5);
        float m = max(f.x, f.y);
        float rib = 0.82 + 0.18 * cos(fract(uv.x) * 37.7) * clamp(0.04 / (fw + 1e-4), 0.0, 1.0);
        emitCol = alb * emit * boost * (0.10 + 1.25 * smoothstep(0.50, 0.05, m) * smoothstep(0.50, 0.05, m)) * rib;
        alb *= 0.2; rough = 0.2;
      } else if (cls == MC_NEON) {
        float fk = 0.88 + 0.12 * sin(uTime * 26.0 + wp.x * 3.1 + wp.z * 1.7) - step(0.985, h21(vec2(floor(uTime * 9.0), floor(wp.x + wp.z)))) * 0.6;
        vec2 f = abs(fract(uv) - 0.5);
        float core = smoothstep(0.5, 0.12, max(f.x, f.y));
        emitCol = mix(alb, vec3(lum(alb)) * 1.3 + alb * 0.3, core * 0.35) * emit * boost * fk * (0.40 + 1.15 * core);
        alb *= 0.15;
      } else if (cls == MC_LAVA) {
        vec2 fl = uv * 0.13 + vec2(uTime * 0.011, uTime * 0.006);
        float a = textureLod(uNoiseA, fl, 0.0).r, b2 = textureLod(uNoiseA, fl * 2.7 - uTime * 0.008, 0.0).a;
        float heat = smoothstep(0.34, 0.74, a * 0.62 + b2 * 0.50);
        emitCol = alb * emit * boost * (0.10 + 2.3 * heat * heat) * vec3(1.0, 0.72 + 0.5 * heat, 0.5 + 0.9 * heat * heat);
        alb = mix(vec3(0.015), alb * 0.1, heat); rough = mix(0.9, 0.35, heat);
        N = normalize(N0 - (T * slope.x + B * slope.y) * 0.5 * (1.0 - heat));
      }

      // ── rain ──
      float exposed = 1.0;
      if (dist < uNear) {
        float top = texelFetch(uTop, ivec2(floor(wp.xz + N0.xz * 0.5)) & 255, 0).r * 255.0;
        exposed = smoothstep(top - 1.7, top - 0.5, wp.y + 0.01);
      }
      float poro = clamp(rough * 1.25 - metal - 0.1, 0.0, 1.0);
      if (upF) {
        wet = uWet * exposed * (0.55 + 0.45 * wetR);
        float pn = noiseA(uv + 19.0, 41.0, fw).a * 0.68 + nc.r * 0.34;
        float p2 = max(smoothstep(0.545, 0.60, pn), joint * 0.7) * wetR * exposed * uWet;
        pud = max(pud, p2 * step(emit, 0.01));
        alb *= mix(1.0, 0.52, wet * poro);
        // Wet ground is two surfaces: the rough thing itself and, over it, a film of
        // water that is nearly level and nearly smooth. The highlights belong to the film.
        float film = wet * poro * (0.62 + 0.38 * smoothstep(0.30, 0.62, pn));
        rough = mix(rough, 0.17, film);
        N = mix(N, N0, film * 0.72);
        f0 = mix(f0, 0.022, film);
        cavity = mix(cavity, 1.0, film * 0.5);
        N = mix(N, N0, pud * 0.94);
        rough = mix(rough, 0.035, pud);
        alb *= 1.0 - 0.3 * pud;
        metal *= 1.0 - pud;
        cavity = mix(cavity, 1.0, pud);
        if (pud > 0.01 && uRain > 0.0) {
          vec2 rp = ripples(uv, uTime) * clamp(0.07 / (fw + 1e-4), 0.0, 1.0);
          N += (T * rp.x + B * rp.y) * 0.30 * pud * uRain;
        }
      } else if (N0.y > -0.5) {
        float ws = noiseA(vec2(uv.x * 0.9, uv.y * 0.08) + 5.0, 7.0, fw).r;
        wet = uWet * exposed * smoothstep(0.40, 0.70, ws) * 0.75 * (0.3 + 0.7 * wetR);
        alb *= mix(1.0, 0.66, wet * poro);
        rough = mix(rough, 0.34, wet * poro);
      }
    }
    N = normalize(N);
  }

  vec3 F0v = mix(vec3(f0), alb, metal);
  vec3 dAlb = alb * (1.0 - metal * 0.9);
  float a = max(rough * rough, 0.0016);
  float nv = max(dot(N, V), 1e-3);

  // ── characters: the tarP of dark under each, and the shadow it throws ──
  float capAO = 1.0, capLamp = 1.0, capMoon = 1.0;
#ifdef Q_CAPS
  if (g3.a < 0.5) {
    for (int i = 0; i < 8; i++) {
      if (i >= uCapN) break;
      vec4 c = uCap[i];
      vec3 dc = c.xyz - wp;
      if (dot(dc.xz, dc.xz) > 90.0 || dc.y > 8.0 || dc.y < -c.w - 3.0) continue;
      float r = c.w * 0.19;
      vec3 sc = dc + vec3(0.0, c.w * 0.42, 0.0);
      float d2 = max(dot(sc, sc), 1e-3);
      float rs = c.w * 0.34;
      capAO *= 1.0 - clamp(max(dot(N0, sc), 0.0) * inversesqrt(d2) * rs * rs / d2 * 1.5, 0.0, 0.7);
      vec4 L = uCapL[i];
      float sh = mix(1.0, capShadow(wp + N0 * 0.02, c.xyz, c.w, r, L.xyz), abs(L.w));
      if (L.w > 0.0) capLamp *= sh; else capMoon *= sh;
    }
  }
#endif

  // ── the moon: shadow maps where there are any, the bake beyond; the clouds over both ──
  float moonL = moonV;
#ifdef Q_SHADOW
  if (dot(N0, uMoonDir) > -0.02) {
    vec2 sm = moonShadow(wp, N0, jitS);
    moonL = mix(moonV, sm.x * mix(1.0, aoV, 0.5), sm.y);
  }
#endif
  moonL *= cloudShade(wp);
  // ── what the screen says about occlusion ──
  float ao2 = 1.0;
#ifdef Q_SSAO
  if (dist < 90.0) ao2 = mix(1.0, ssao(wp, N0, jitS), 0.70 * (1.0 - smoothstep(55.0, 90.0, dist)));
#endif

  // ── light ──
  float hemi = clamp(0.67 + 0.33 * N.y + 0.11 * N.z, 0.2, 1.1);
  float flash = 1.0 + uBolt * 6.0 / max(uSkyI, 0.1);
  vec3 skyC = uSkyTint * uSkyI * flash;
  float ndm = max(dot(N, uMoonDir), 0.0);
  // The moon is the one light that throws a shadow across the whole city, so it has
  // to outweigh the sky by enough for that shadow to read: about three to one.
  vec3 light = skyC * (0.31 * hemi * skyV * capAO * ao2 + 1.0 * ndm * moonL * capMoon);
  vec3 spec = vec3(0.0);
  if (moonL > 0.01 && ndm > 0.0) spec += skyC * 1.0 * moonL * capMoon * specLobe(N, V, uMoonDir, max(a, 0.05), F0v, nv);

  // lamps: the bake gives the diffuse light and its shadows; the grid gives the
  // lamps themselves, for the detail normal and for the highlights
  float eFlat = 0.0, ePP = 0.0;
  vec3 lampS = vec3(0.0);
  float aL = clamp(a + 0.012, 0.0, 1.0);
  if (dist < 235.0) {
    ivec2 cell = ivec2(floor(wp.xz / 16.0)) & 31;
    bool done = false;
    for (int k = 0; k < Q_LTEX; k++) {
      if (done) break;
      vec4 idx = texelFetch(uGrid, ivec2(cell.x * 3 + k, cell.y), 0);
      for (int j = 0; j < 4; j++) {
        float fi = idx[j];
        if (fi < 0.0) { done = true; break; }
        int li = int(fi);
        vec4 L0 = texelFetch(uLights, ivec2(li, 0), 0), L1 = texelFetch(uLights, ivec2(li, 1), 0);
        vec3 Lv = L0.xyz - wp;
        float d = length(Lv), R = L0.w;
        vec3 Ld = Lv / max(d, 1e-3);
        if (d < R) {
          float f = 1.0 - d / R; f *= f;
          float I = lum(L1.rgb);
          eFlat += I * f * max(dot(N0, Ld), 0.0);
          ePP += I * f * max(dot(N, Ld), 0.0);
        }
        float Rs = R * 2.4;
        if (d < Rs) {
          float fs = 1.0 - d / Rs; fs *= fs;
          // a lamp is not a point: widen the lobe by the size it subtends
          float al = clamp(aL + 0.35 / max(d, 1.0) * (1.0 - aL), 0.0, 1.0);
          lampS += L1.rgb * fs * specLobe(N, V, Ld, al, F0v, nv);
        }
      }
    }
  }
  float ratio = eFlat > 0.012 ? clamp(ePP / eFlat, 0.0, 2.2) : 1.0;
  float vis = eFlat > 0.012 ? clamp(lum(lampB) / (eFlat * 0.8), 0.0, 1.0) : (N0.y > 0.5 ? 0.7 : 0.25);
  light += lampB * ratio * capLamp * mix(1.0, ao2, 0.5);
  spec += lampS * vis * capLamp * uSpec;

  // lights that move: explosions, muzzle flashes, sparks
  for (int i = 0; i < 8; i++) {
    if (i >= uDynN) break;
    vec3 Lv = uDyn[i].xyz - wp;
    float d = length(Lv), R = uDyn[i].w;
    if (d >= R) continue;
    vec3 Ld = Lv / max(d, 1e-3);
    float f = 1.0 - d / R; f *= f;
    light += uDynC[i].rgb * f * max(dot(N, Ld), 0.0);
    spec += uDynC[i].rgb * f * specLobe(N, V, Ld, clamp(aL + 0.3 / max(d, 1.0), 0.0, 1.0), F0v, nv) * uSpec;
  }

  // ── reflections of the world ──
  vec3 R = reflect(-V, N);
  R = normalize(R + N0 * max(0.0, -dot(R, N0)) * 1.1);
  vec3 Fenv = F0v + (max(vec3(1.0 - rough), F0v) - F0v) * pow(1.0 - nv, 5.0);
  float occ = (ent ? 0.5 * skyV + 0.2 : mix(skyV, 1.0, 0.12)) * ao2;
  vec3 env = textureLod(uEnv, envUV(R), rough * 5.5).rgb * occ;
#ifdef Q_SSR
  if (rough < 0.42 && max(Fenv.r, max(Fenv.g, Fenv.b)) > 0.012 && dist < 260.0) {
    vec4 s = traceSSR(wp, N0, R, rough);
    env = mix(env, s.rgb, s.a * (1.0 - smoothstep(0.30, 0.42, rough)));
  }
#endif
  spec += env * Fenv;

  vec3 col = dAlb * light * cavity + spec * mix(1.0, cavity, 0.5) + emitCol;
  // a cold rim keeps a dark character readable against a dark city
  if (ent) col += vec3(0.33, 0.53, 1.0) * g3.b * pow(1.0 - nv, 3.0) * (0.35 + 0.65 * moonL) * 0.30;
  vec3 fc = fogColor(rd);
#if defined(Q_SHADOW) && defined(Q_SHAFT)
  fc *= 0.70 + 0.62 * moonAir(rd, min(dist, 170.0), jitS);
#endif
  col = mix(col, fc, fogAmt(wp));
  if (uDbg == 1) col = vec3(moonL * 0.5, moonV * 0.5, ndm * 0.5);
  else if (uDbg == 2) col = vec3(ao2 * 0.5);
  oColor = vec4(min(col, vec3(64.0)), 1.0);
}`;
}
