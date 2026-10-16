// ═══════════════════════════════════════════════════════════════════════
//  SHADERS — every GLSL program in the game, as strings.
//
//  Lighting arrives pre-baked in the vertices (see bake.js), so the terrain
//  shader does very little: it multiplies albedo by that light, adds the few
//  things that have to be per-pixel (voxel bevel, wet sheen, emission, fog) and
//  writes linear HDR. Everything is tone-mapped and graded afterwards, in
//  display space, in the composite pass.
// ═══════════════════════════════════════════════════════════════════════

// Shared by every fragment shader that needs the sky: the sky pass itself, and
// anything that reflects it (water, wet streets, glass).
var SH_COMMON = `
const vec3 VXN[6] = vec3[6](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.));
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

uniform vec3 uCam;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uTime;
uniform float uCloudH;
uniform float uStorm;

// Exponential height fog, integrated along the ray from the camera to p. Fog pools
// near the street and thins with altitude, so a ray that spends its length in clean
// air high above the city is barely fogged, while one that runs along a canyon
// floor is swallowed. Using only the fragment's own height — which this did at
// first — fogged an aerial view as heavily as a street, and from a rooftop the city
// vanished. Closed form: od = a e^{-k h0} (1 - e^{-k dy}) / (k dy / dist).
uniform vec3 uFog;
uniform float uFogD;      // density at the baseline height
uniform float uFogK;      // how fast it thins with altitude
uniform float uFogB;      // a constant floor of haze
uniform float uFogBase;   // the baseline height (street level)
uniform float uFarDist;   // where the loaded world ends
uniform float uFogFar;    // how opaque it is by then
float fogAmt(vec3 p) {
  vec3 d = p - uCam;
  float dist = length(d);
  float base = uFogD * exp(-uFogK * (uCam.y - uFogBase));
  float kdy = uFogK * d.y;
  // a level ray has no altitude change to integrate over
  float od = abs(kdy) > 1e-3 ? base * (1.0 - exp(-kdy)) * dist / kdy : base * dist;
  od += uFogB * dist;
  // Height fog alone leaves the EDGE of the loaded world visible from the air: look
  // down from a rooftop and the city simply stops, a floating island. This term is
  // independent of altitude and climbs steeply to nearly opaque at the load
  // distance, so the world always dissolves before it ends.
  // measured on the HORIZONTAL distance, because that is what the loader limits: from
  // 150 blocks up even a street directly below is far away in 3D and would be fogged out
  od += uFogFar * pow(clamp(length(d.xz) / uFarDist, 0.0, 1.5), 3.0);
  return 1.0 - exp(-clamp(od, 0.0, 12.0));
}

vec3 skyColor(vec3 d) {
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  // sodium glow of the city hugging the horizon
  col += vec3(0.050, 0.028, 0.012) * exp(-abs(h) * 9.0) * 0.8;
  col = mix(col, uFog, clamp(-h * 5.0, 0.0, 1.0));
  if (h > 0.0) {                                     // stars
    vec3 q = d * 90.0, g = floor(q);
    float s = h31(g);
    float tw = 0.65 + 0.35 * sin(uTime * 2.0 + s * 40.0);
    float st = smoothstep(0.9965, 1.0, s) * tw * smoothstep(0.04, 0.3, h);
    float r = 1.0 - smoothstep(0.0, 0.45, length(fract(q) - 0.5));
    col += vec3(0.85, 0.9, 1.0) * st * r * 2.5 * (1.0 - uStorm);
  }
  float md = dot(d, uMoonDir);                       // the moon: disc, halo, glare
  col += vec3(1.0, 0.96, 0.88) * smoothstep(0.99962, 0.99985, md) * 7.0;
  col += vec3(0.55, 0.65, 0.90) * pow(max(md, 0.0), 220.0) * 0.9;
  col += vec3(0.28, 0.38, 0.62) * pow(max(md, 0.0), 18.0) * 0.35;
  if (h > 0.02) {                                    // blocky clouds on a plane
    float t = (uCloudH - uCam.y) / h;
    vec3 p = uCam + d * t;
    vec2 uv = p.xz * 0.012 + vec2(uTime * 0.006, uTime * 0.002);
    float n = 0.55 * h21(floor(uv * 3.0)) + 0.30 * h21(floor(uv * 7.0) + 11.0) + 0.15 * h21(floor(uv * 15.0) + 23.0);
    float cov = smoothstep(0.57, 0.74, n) * smoothstep(0.03, 0.28, h);
    float lit = 0.25 + 0.75 * pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uMoonDir.x, 0.0, uMoonDir.z))), 0.0), 3.0);
    vec3 cc = mix(vec3(0.011, 0.014, 0.020), vec3(0.075, 0.085, 0.108), lit * (0.5 + 0.5 * h21(floor(uv * 7.0) + 3.0)));
    cc += vec3(0.030, 0.018, 0.009) * (1.0 - h);
    col = mix(col, cc, cov * 0.80);
  }
  return col;
}
`;

var SH_SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vNdc = p * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 1.0, 1.0);
}`;

var SH_SKY_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vNdc;
uniform mat4 uInvVP;
${SH_COMMON}
out vec4 oColor;
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uCam);
  oColor = vec4(skyColor(d), 1.0);
}`;

// ── terrain ───────────────────────────────────────────────────────────────
var SH_TERRAIN_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 aPos;
layout(location = 1) in uvec4 aIds;     // block, face, ao, flags
layout(location = 2) in vec4 aCol;      // albedo rgb, emission
layout(location = 3) in vec4 aLit;      // baked sky, baked lamp rgb
uniform mat4 uVP;
uniform vec3 uOrg;
out vec3 vW;
out vec4 vCol;
out vec4 vLit;
flat out uvec4 vIds;
void main() {
  vec3 p = uOrg + aPos.xyz;
  vW = p; vCol = aCol; vLit = aLit; vIds = aIds;
  gl_Position = uVP * vec4(p, 1.0);
}`;

var SH_TERRAIN_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vW;
in vec4 vCol;
in vec4 vLit;
flat in uvec4 vIds;
uniform vec3 uSkyTint;
uniform float uSkyI;
uniform float uBlockI;
uniform float uFlash;
uniform float uBevel;
uniform float uWet;
uniform float uCut;       // the far pass discards everything inside this radius
${SH_COMMON}
layout(location = 0) out vec4 oColor;

void main() {
  if (uCut > 0.0 && dot(vW.xz - uCam.xz, vW.xz - uCam.xz) < uCut * uCut) discard;
  uint face = vIds.y;
  uint fl = vIds.w;
  vec3 N = VXN[face];
  vec3 albedo = pow(vCol.rgb, vec3(2.2));
  float emit = vCol.a * 4.0;
  vec3 V = uCam - vW;
  float dist = length(V);
  V /= dist;

  // The voxel bevel: each face darkens a little toward its edges, which is what
  // makes a wall of cubes read as cubes. It fades with distance, or it turns
  // into moire on far facades.
  vec2 uv = face < 2u ? fract(vW.zy) : (face < 4u ? fract(vW.xz) : fract(vW.xy));
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float bev = mix(1.0 - 0.30 * uBevel, 1.0, smoothstep(0.0, 0.17, e));
  bev = mix(bev, 1.0, smoothstep(36.0, 120.0, dist));

  vec3 light = uSkyTint * (vLit.x * uSkyI) + vLit.yzw * (2.0 * uBlockI);
  vec3 col = albedo * light * bev;

  bool wet = (fl & 1u) != 0u;
  bool gloss = (fl & 8u) != 0u;
  if ((wet || gloss) && emit == 0.0) {
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fr = pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    // puddles: wet ground is patchy, and the patches are mirrors
    float pud = smoothstep(0.35, 0.65, h21(floor(vW.xz * 0.5) + 7.0)) * 0.7 + 0.3;
    float k = wet ? (N.y > 0.5 ? 1.0 * uWet * pud : 0.15 * uWet) : 0.35;
    vec3 refl = skyColor(R);
    col += refl * (0.03 + 0.95 * fr) * k;
    // lamp light smeared along the view direction on wet ground
    col += vLit.yzw * (2.0 * uBlockI) * fr * 2.2 * k * albedo.r * 4.0;
  }

  if (emit > 0.0) {
    float fk = 1.0;
    if ((fl & 32u) != 0u) fk = 0.82 + 0.18 * sin(uTime * 26.0 + vW.x * 3.1 + vW.z * 1.7) - step(0.985, h21(vec2(floor(uTime * 9.0), vW.x + vW.z))) * 0.7;
    if ((fl & 16u) != 0u) fk = 0.78 + 0.22 * sin(uTime * 1.7 + vW.x * 0.9 + vW.z * 1.3 + vW.y * 0.5);
    col = albedo * emit * fk * mix(1.0, bev, 0.35);
  }

  col += uFlash * uSkyTint * vLit.x * albedo * 6.0;

  float fog = fogAmt(vW);
  vec3 fogc = uFog * (1.0 + 0.8 * pow(max(dot(-V, uMoonDir), 0.0), 6.0));
  col = mix(col, fogc, fog);
  oColor = vec4(col, 1.0);
}`;

// ── water ─────────────────────────────────────────────────────────────────
var SH_WATER_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 aPos;
layout(location = 3) in vec4 aLit;
uniform mat4 uVP;
uniform vec3 uOrg;
uniform float uTime;
out vec3 vW;
out float vSky;
void main() {
  vec3 p = uOrg + aPos.xyz;
  p.y -= 0.14;
  p.y += 0.05 * sin(p.x * 0.7 + uTime * 1.1) * cos(p.z * 0.6 - uTime * 0.9);
  vW = p; vSky = aLit.x;
  gl_Position = uVP * vec4(p, 1.0);
}`;

var SH_WATER_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vW;
in float vSky;
uniform float uCut;
${SH_COMMON}
layout(location = 0) out vec4 oColor;
void main() {
  if (uCut > 0.0 && dot(vW.xz - uCam.xz, vW.xz - uCam.xz) < uCut * uCut) discard;
  float t = uTime;
  vec2 g = vec2(cos(vW.x * 0.7 + t * 1.1) * 0.7, cos(vW.z * 0.6 - t * 0.9) * 0.6) * 0.07;
  g += vec2(cos((vW.x + vW.z) * 1.9 + t * 2.3), cos((vW.x - vW.z) * 1.7 - t * 2.0)) * 0.035;
  g += vec2(h21(floor(vW.xz * 2.0 + t * 0.5)) - 0.5, h21(floor(vW.xz * 2.0 - t * 0.4) + 5.0) - 0.5) * 0.025;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = uCam - vW;
  float dist = length(V);
  V /= dist;
  float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 refl = skyColor(reflect(-V, N));
  vec3 deep = vec3(0.004, 0.012, 0.020) * (0.4 + vSky);
  vec3 col = mix(deep, refl, clamp(fr * 0.92 + 0.07, 0.0, 1.0));
  col = mix(col, uFog, fogAmt(vW));
  oColor = vec4(col, mix(0.80, 0.97, fr));
}`;

// ── glow sprites: lamp heads, neon, the bat-signal lamp ───────────────────
var SH_GLOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;       // -1..1
layout(location = 1) in vec4 aPosSize;      // xyz, radius
layout(location = 2) in vec4 aColI;         // rgb, intensity
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vC;
out vec4 vColI;
out vec3 vWp;
void main() {
  vC = aCorner; vColI = aColI; vWp = aPosSize.xyz;
  vec3 p = aPosSize.xyz + (uRight * aCorner.x + uUp * aCorner.y) * aPosSize.w;
  gl_Position = uVP * vec4(p, 1.0);
}`;

var SH_GLOW_FS = `#version 300 es
precision highp float;
in vec2 vC;
in vec4 vColI;
in vec3 vWp;
${SH_COMMON}
layout(location = 0) out vec4 oColor;
void main() {
  float r2 = dot(vC, vC);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0);
  float halo = exp(-r2 * 3.2) * 0.35;
  oColor = vec4(vColI.rgb * (core * 3.0 + halo) * vColI.a * (1.0 - 0.85 * fogAmt(vWp)), 1.0);
}`;

// ── rain: a volume of streaks around the camera, animated entirely on the GPU ─
var SH_RAIN_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;       // x: -1..1 across, y: 0..1 along
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;
uniform float uCount;
uniform float uWind;
out float vA;
float hh(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float id = float(gl_InstanceID);
  float W = 70.0, Hh = 46.0;
  vec3 base = vec3(hh(id) * W, hh(id + 11.3) * Hh, hh(id + 27.7) * W);
  float speed = 26.0 + hh(id + 3.1) * 10.0;
  vec3 p;
  p.y = Hh - mod(base.y + uTime * speed, Hh);
  float slant = uWind * (0.25 + hh(id + 5.5) * 0.15);
  p.x = base.x + (Hh - p.y) * slant;
  p.z = base.z;
  // wrap into a box centred on the camera
  p.x = uCam.x + mod(p.x - uCam.x + W * 0.5, W) - W * 0.5;
  p.z = uCam.z + mod(p.z - uCam.z + W * 0.5, W) - W * 0.5;
  p.y += uCam.y - 14.0;
  float len = 1.1 + hh(id + 8.8) * 0.9;
  vec3 dir = normalize(vec3(slant, 1.0, 0.0)) * len;
  vec3 toCam = normalize(uCam - p);
  float dc = length(p - uCam);
  vec3 side = normalize(cross(dir, toCam)) * (0.012 + dc * 0.0011);
  vec3 pos = p + dir * aCorner.y + side * aCorner.x;
  // a streak a metre from the lens is as long as the screen and reads as a scratch:
  // fade it in over the first few metres, and out again at the far edge of the box
  float fade = smoothstep(2.5, 11.0, dc) * (1.0 - smoothstep(24.0, 58.0, dc));
  vA = (1.0 - aCorner.y * 0.85) * (0.35 + hh(id + 1.9) * 0.65) * fade;
  gl_Position = uVP * vec4(pos, 1.0);
}`;

var SH_RAIN_FS = `#version 300 es
precision highp float;
in float vA;
uniform float uAlpha;
layout(location = 0) out vec4 oColor;
void main() { oColor = vec4(vec3(0.52, 0.62, 0.80) * vA * uAlpha * 0.55, 1.0); }`;

// ── a light beam: the bat-signal ──────────────────────────────────────────
var SH_BEAM_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;       // x: -1..1 across, y: 0..1 along
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec2 uWidth;                        // radius at base, at tip
out vec2 vUV;
void main() {
  vec3 axis = uP1 - uP0;
  vec3 p = uP0 + axis * aCorner.y;
  vec3 toCam = normalize(uCam - p);
  vec3 side = normalize(cross(axis, toCam));
  float w = mix(uWidth.x, uWidth.y, aCorner.y);
  vUV = aCorner;
  gl_Position = uVP * vec4(p + side * aCorner.x * w, 1.0);
}`;

var SH_BEAM_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform float uPulse;
layout(location = 0) out vec4 oColor;
void main() {
  float across = 1.0 - abs(vUV.x);
  float edge = pow(across, 1.6);
  float along = pow(1.0 - vUV.y, 0.8) * smoothstep(0.0, 0.03, vUV.y);
  float a = edge * along * uPulse;
  oColor = vec4(vec3(1.0, 0.93, 0.62) * a * 0.55, 1.0);
}`;

// ── entities: voxel models with their own light ───────────────────────────
var SH_ENT_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;          // rgb, emission
layout(location = 2) in vec4 aNrm;          // face id, ao, 0, 0 (unnormalised bytes)
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vW;
out vec4 vCol;
out vec3 vN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz; vCol = aCol;
  int f = int(aNrm.x + 0.5);
  vec3 n = f == 0 ? vec3(1.,0.,0.) : f == 1 ? vec3(-1.,0.,0.) : f == 2 ? vec3(0.,1.,0.) : f == 3 ? vec3(0.,-1.,0.) : f == 4 ? vec3(0.,0.,1.) : vec3(0.,0.,-1.);
  vN = normalize(mat3(uModel) * n);
  vCol.rgb *= 0.55 + 0.45 * (aNrm.y / 3.0);
  gl_Position = uVP * w;
}`;

var SH_ENT_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vW;
in vec4 vCol;
in vec3 vN;
uniform vec3 uSkyTint;
uniform float uSkyI;
uniform float uBlockI;
uniform vec3 uELight;                       // x: ambient sky, y: moonlit, z: unused
uniform vec3 uEBlock;                       // lamp light on this entity
uniform vec4 uFlash;                        // rgb tint, amount
uniform float uEmitMul;
uniform vec3 uRim;
${SH_COMMON}
layout(location = 0) out vec4 oColor;
void main() {
  vec3 N = normalize(vN);
  vec3 albedo = pow(vCol.rgb, vec3(2.2));
  float emit = vCol.a * 4.0 * uEmitMul;
  vec3 V = uCam - vW;
  float dist = length(V);
  V /= dist;
  float hemi = 0.55 + 0.45 * N.y;
  float moon = max(dot(N, uMoonDir), 0.0);
  vec3 light = uSkyTint * uSkyI * (0.36 * uELight.x * hemi + 0.62 * uELight.y * moon) + uEBlock * (2.0 * uBlockI) * (0.45 + 0.55 * max(N.y * 0.5 + 0.5, 0.0));
  vec3 col = albedo * light;
  // a cold rim: it is what keeps a dark character readable against a dark city
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  col += uRim * rim * (0.35 + 0.65 * uELight.y) * 0.55;
  if (emit > 0.0) col = albedo * emit;
  col = mix(col, uFlash.rgb * 2.0, uFlash.a);
  col = mix(col, uFog, fogAmt(vW));
  oColor = vec4(col, 1.0);
}`;

// ── post-processing ───────────────────────────────────────────────────────
var SH_FS_VS = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Bright pass, with a soft knee so bloom fades in instead of switching on.
var SH_BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uThr;
uniform float uKnee;
layout(location = 0) out vec4 oColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp(l - uThr + uKnee, 0.0, 2.0 * uKnee);
  k = k * k / (4.0 * uKnee + 1e-4);
  float w = max(k, l - uThr) / max(l, 1e-4);
  oColor = vec4(min(c * w, vec3(24.0)), 1.0);
}`;

var SH_DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
layout(location = 0) out vec4 oColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb * 4.0;
  c += texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2( 1.0,  1.0)).rgb;
  oColor = vec4(c / 8.0, 1.0);
}`;

var SH_UP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uMix;
layout(location = 0) out vec4 oColor;
void main() {
  vec3 c = texture(uTex, vUV + uTexel * vec2(-1.0, 0.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(1.0, 0.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(0.0, -1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(0.0, 1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb * 0.5;
  c += texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb * 0.5;
  c += texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb * 0.5;
  c += texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb * 0.5;
  oColor = vec4(c / 6.0 * uMix, 1.0);
}`;

// Composite: scene + bloom, exposure, tone map, THEN the grade, in display space.
// Grading before the gamma encode is how the 2D game's contrast control ended up
// crushing everything under 51/255 to black: its pivot of 0.5 means mid-grey on a
// screen, but ~0.18 in linear light.
var SH_COMP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomAmt;
uniform float uVig;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uFade;
uniform vec4 uHurt;
layout(location = 0) out vec4 oColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * uBloomAmt;
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  c = c * uGain + uLift;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 q = vUV * 2.0 - 1.0;
  float v = 1.0 - dot(q * vec2(0.92, 1.0), q * vec2(0.92, 1.0)) * uVig;
  c *= clamp(v, 0.0, 1.0);
  c = mix(c, uHurt.rgb, uHurt.a * smoothstep(0.35, 1.45, length(q)));
  c *= uFade;
  oColor = vec4(c, 1.0);
}`;

// FXAA (lite) on the display-space image, plus film grain and an ordered dither,
// without which a dark gradient bands hard at 8 bits.
var SH_FXAA_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGrain;
uniform float uTime;
layout(location = 0) out vec4 oColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 m = texture(uTex, vUV).rgb;
  float lM = luma(m);
  float lN = luma(texture(uTex, vUV + uTexel * vec2(0.0, -1.0)).rgb);
  float lS = luma(texture(uTex, vUV + uTexel * vec2(0.0, 1.0)).rgb);
  float lW = luma(texture(uTex, vUV + uTexel * vec2(-1.0, 0.0)).rgb);
  float lE = luma(texture(uTex, vUV + uTexel * vec2(1.0, 0.0)).rgb);
  float lo = min(lM, min(min(lN, lS), min(lW, lE)));
  float hi = max(lM, max(max(lN, lS), max(lW, lE)));
  vec3 col = m;
  if (hi - lo > max(0.045, hi * 0.12)) {
    vec2 dir = vec2(-((lN + lE) - (lS + lW)), (lW + lN) - (lE + lS));
    float red = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((lN + lS + lW + lE) * 0.03, 0.0078));
    dir = clamp(dir * red, -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (texture(uTex, vUV + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture(uTex, vUV + dir * -0.5).rgb + texture(uTex, vUV + dir * 0.5).rgb);
    float lb = luma(b);
    col = (lb < lo || lb > hi) ? a : b;
  }
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uGrain;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(4.1, 7.3))) * 9371.7) - 0.5) / 255.0;
  oColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
