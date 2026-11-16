// ═══════════════════════════════════════════════════════════════════════
//  SHADERS — shared GLSL and the geometry programs.
//
//  The renderer is deferred. Geometry is drawn once into a G-buffer and carries
//  no lighting code at all: it writes what the surface IS (colour, normal, block
//  id) and the light the baker stored in its vertices. Everything expensive —
//  materials, lamps, reflections, fog — happens once per visible pixel in the
//  lighting pass (sh_light.js), so a wall hidden behind another costs nothing.
//
//  G-buffer, four RGBA8 targets and a depth texture:
//    0  albedo rgb (as authored, sRGB)        a  emission / 4
//    1  normal * 0.5 + 0.5                    a  block id / 255   (255 entity, 254 particle)
//    2  baked lamp rgb / 2                    a  baked sky visibility
//    3  r baked moon visibility   g facade code / 255   b corner occlusion (terrain) or
//       rim (characters)   a 1 for things that move
// ═══════════════════════════════════════════════════════════════════════

var SH_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// Shared by everything that needs the air and the sky.
var SH_COMMON = `
  const vec3 VXN[6] = vec3[6](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.));
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// interleaved gradient noise: a cheap screen-space dither that TAA averages away
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

uniform vec3 uCam;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uTime;
uniform float uCloudH;
uniform float uStorm;
uniform float uBolt;      // lightning, 0..1

// Exponential height fog, integrated along the ray from the camera to p. Fog pools
// near the street and thins with altitude, so a ray that spends its length in clean
// air high above the city is barely fogged, while one that runs along a canyon
// floor is swallowed. Closed form: od = a e^{-k h0} (1 - e^{-k dy}) / (k dy / dist).
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
  // Height fog alone leaves the EDGE of the loaded world visible from the air. This
  // term is independent of altitude and climbs steeply to nearly opaque at the load
  // distance, measured horizontally because that is what the loader limits.
  od += uFogFar * pow(clamp(length(d.xz) / uFarDist, 0.0, 1.5), 4.5);
  return 1.0 - exp(-clamp(od, 0.0, 12.0));
}
// what the fog looks like along a view direction (camera -> scene)
vec3 fogColor(vec3 rd) { return uFog * (1.0 + 0.8 * pow(max(dot(rd, uMoonDir), 0.0), 6.0)); }
// local fog density at a height, relative to street level (for light scattering)
float fogDensityAt(float y) { return exp(-uFogK * max(y - uFogBase, -8.0)); }
`;

// The sky: gradient, stars, moon and two decks of cloud lit by the moon from
// above and by the city from below. Needs noise A.
var SH_SKY = `
uniform sampler2D uNoiseA;
vec3 skyGradient(vec3 d) {
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col += vec3(0.050, 0.028, 0.012) * exp(-abs(h) * 9.0) * 0.8;      // sodium glow hugging the horizon
  return mix(col, uFog, clamp(-h * 5.0, 0.0, 1.0));
}
float cloudDensity(vec2 p, float cov) {
  float n = textureLod(uNoiseA, p * 0.00042, 0.0).r * 0.60;
  n += textureLod(uNoiseA, p * 0.00131 + vec2(0.37, 0.11), 0.0).a * 0.27;
  n += textureLod(uNoiseA, p * 0.0047 + vec2(0.71, 0.53), 0.0).r * 0.13;
  return smoothstep(cov, cov + 0.20, n);
}
// rgb premultiplied by coverage, coverage
vec4 cloudDeck(vec3 d, float height, float cov, float seed) {
  float t = (height - uCam.y) / max(d.y, 1e-3);
  if (d.y < 0.012 || t < 0.0) return vec4(0.0);
  vec2 p = uCam.xz + d.xz * t + uTime * vec2(3.6, 1.4) * (1.0 + seed) + seed * 731.0;
  float dens = cloudDensity(p, cov);
  if (dens < 0.004) return vec4(0.0);
  // how much cloud lies between this point and the moon
  float toMoon = cloudDensity(p + normalize(uMoonDir.xz) * 60.0, cov);
  float shade = exp(-toMoon * 1.7);
  float mu = max(dot(d, uMoonDir), 0.0);
  float fwd = 0.30 + 2.4 * pow(mu, 5.0) + 16.0 * pow(mu, 40.0) * (1.0 - dens * 0.55);
  vec3 c = vec3(0.48, 0.58, 0.86) * 0.075 * shade * fwd;
  // the city lights the underside, in the colour of the district's air
  c += (uFog * 1.05 + vec3(0.016, 0.010, 0.004)) * (0.50 + 0.50 * dens) * (1.0 - 0.62 * d.y);
  c *= 1.0 - 0.45 * uStorm;
  // lightning inside the deck
  float cell = textureLod(uNoiseA, p * 0.0009 + floor(uTime * 7.0) * 0.37, 0.0).a;
  c += vec3(0.70, 0.82, 1.0) * uBolt * dens * (0.6 + 5.0 * smoothstep(0.55, 0.85, cell));
  float a = dens * smoothstep(0.012, 0.15, d.y) * 0.94;
  return vec4(c * a, a);
}
vec3 skyColor(vec3 d, float stars) {
  float h = d.y;
  vec3 col = skyGradient(d);
  if (h > 0.0 && stars > 0.0) {
    vec3 q = d * 260.0, g = floor(q);
    float s = h31(g);
    float tw = 0.65 + 0.35 * sin(uTime * 2.0 + s * 40.0);
    float st = smoothstep(0.9982, 1.0, s) * tw * smoothstep(0.04, 0.3, h);
    float r = 1.0 - smoothstep(0.0, 0.40, length(fract(q) - 0.5));
    col += mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.88, 1.0), fract(s * 77.0)) * st * r * 4.0 * (1.0 - uStorm) * stars;
  }
  float md = dot(d, uMoonDir);
  float disc = smoothstep(0.99955, 0.99982, md);
  if (disc > 0.0) {
    // a little relief on the disc, so it is a moon and not a lamp
    vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), my = cross(mx, uMoonDir);
    vec2 mp = vec2(dot(d, mx), dot(d, my)) * 34.0;
    float mare = textureLod(uNoiseA, mp * 0.5 + 0.3, 0.0).r;
    col += vec3(1.0, 0.96, 0.88) * disc * (5.0 + 5.0 * smoothstep(0.35, 0.7, mare));
  }
  col += vec3(0.55, 0.65, 0.90) * pow(max(md, 0.0), 220.0) * 0.9;
  col += vec3(0.28, 0.38, 0.62) * pow(max(md, 0.0), 18.0) * 0.35;
  float cov = mix(0.50, 0.36, uStorm);
  vec4 hi = cloudDeck(d, uCloudH + 70.0, cov + 0.05, 1.0);
  vec4 lo = cloudDeck(d, uCloudH, cov, 0.0);
  // cloud hides what is behind it faster than it shows itself: a thin veil already swallows a star
  col = col * pow(1.0 - hi.a, 3.0) + hi.rgb;
  col = col * pow(1.0 - lo.a, 3.0) + lo.rgb;
  // Low in the sky you look through as much haze as the far city does, so the
  // horizon takes the colour of the fog and the skyline dissolves into it instead
  // of standing pale against dark cloud.
  return mix(col, fogColor(d), exp(-max(h, 0.0) * 6.5) * 0.94);
}
vec2 envUV(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, d.y * 0.5 + 0.5); }
`;

// ── terrain into the G-buffer ─────────────────────────────────────────────
var SH_GBUF_VS = SH_HEAD + `
layout(location = 0) in vec4 aPos;      // xyz inside the chunk, facade code
layout(location = 1) in uvec4 aIds;     // block, face, moon visibility (6 bits) and corner occlusion (2 bits), flags
layout(location = 2) in vec4 aCol;      // albedo rgb, emission
layout(location = 3) in vec4 aLit;      // baked sky visibility, baked lamp rgb
uniform mat4 uVP;
uniform vec3 uOrg;
out vec3 vW;
out vec4 vCol;
out vec4 vLit;
out float vMoon;
out float vAO;
flat out vec3 vInfo;                    // block, face, facade code
  const float AOF[4] = float[4](0.50, 0.70, 0.86, 1.0);
void main() {
  vec3 p = uOrg + aPos.xyz;
  if ((aIds.w & 4u) != 0u) p.y -= 0.14;           // a liquid's surface sits a little below the brim
  vAO = AOF[aIds.z & 3u];
  vW = p; vCol = aCol; vLit = aLit; vMoon = float(aIds.z >> 2u) / 63.0 * vAO;
  vInfo = vec3(float(aIds.x), float(aIds.y), aPos.w);
  gl_Position = uVP * vec4(p, 1.0);
}`;

function SH_gbufFS(cut) {
  return SH_HEAD + (cut ? '#define CUT 1\n' : '') + `
in vec3 vW;
in vec4 vCol;
in vec4 vLit;
in float vMoon;
in float vAO;
flat in vec3 vInfo;
uniform vec3 uCam;
uniform float uCut;       // the far pass discards everything inside this radius
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
  const vec3 VXN[6] = vec3[6](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.));
void main() {
#ifdef CUT
  vec2 dc = vW.xz - uCam.xz;
  if (dot(dc, dc) < uCut * uCut) discard;
#endif
  o0 = vCol;
  o1 = vec4(VXN[int(vInfo.y + 0.5)] * 0.5 + 0.5, vInfo.x / 255.0);
  o2 = vec4(vLit.yzw, vLit.x);
  o3 = vec4(vMoon, vInfo.z / 255.0, vAO, 0.0);
}`;
}

// ── shadow maps: the world's depth as the moon sees it ─────────────────────
// Only the faces turned AWAY from the moon are drawn (front faces are culled), so
// what is stored is the far side of every solid. A lit face then always lies in
// front of its own block's stored depth and cannot shadow itself, with no bias to
// tune; anything behind a solid, seen from the moon, is in its shadow.
var SH_SHADOW_VS = SH_HEAD + `
layout(location = 0) in vec4 aPos;
uniform mat4 uVP;
uniform vec3 uOrg;
out vec2 vXZ;
void main() {
  vec3 p = uOrg + aPos.xyz;
  vXZ = p.xz;
  gl_Position = uVP * vec4(p, 1.0);
}`;
function SH_shadowFS(cut) {
  return SH_HEAD + (cut ? '#define CUT 1\n' : '') + `
in vec2 vXZ;
uniform vec3 uCam;
uniform float uCut;
void main() {
#ifdef CUT
  vec2 d = vXZ - uCam.xz;
  if (dot(d, d) < uCut * uCut) discard;
#endif
}`;
}

// ── entities: voxel models, lit by a probe the game keeps per character ────
var SH_ENT_VS = SH_HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;          // rgb, emission
layout(location = 2) in vec4 aNrm;          // face id, ao, 0, 0 (unnormalised bytes)
uniform mat4 uVP;
uniform mat4 uModel;
out vec4 vCol;
out vec3 vN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vCol = aCol;
  int f = int(aNrm.x + 0.5);
  vec3 n = f == 0 ? vec3(1.,0.,0.) : f == 1 ? vec3(-1.,0.,0.) : f == 2 ? vec3(0.,1.,0.) : f == 3 ? vec3(0.,-1.,0.) : f == 4 ? vec3(0.,0.,1.) : vec3(0.,0.,-1.);
  vN = normalize(mat3(uModel) * n);
  vCol.rgb *= 0.55 + 0.45 * (aNrm.y / 3.0);
  gl_Position = uVP * w;
}`;

var SH_ENT_FS = SH_HEAD + `
in vec4 vCol;
in vec3 vN;
uniform vec3 uELight;                       // x: sky visibility, y: moon visibility
uniform vec3 uEBlock;                       // lamp light on this entity
uniform vec4 uFlash;                        // rgb tint, amount
uniform float uEmitMul;
uniform vec3 uRim;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec3 N = normalize(vN);
  o0 = vec4(mix(vCol.rgb, uFlash.rgb, uFlash.a * 0.75), clamp(vCol.a * uEmitMul + uFlash.a * 0.45, 0.0, 1.0));
  o1 = vec4(N * 0.5 + 0.5, 1.0);
  o2 = vec4(uEBlock * (0.45 + 0.55 * max(N.y * 0.5 + 0.5, 0.0)), uELight.x);
  o3 = vec4(uELight.y, 0.0, clamp(uRim.b * 1.6, 0.0, 1.0), 1.0);
}`;

// ── fullscreen passes ─────────────────────────────────────────────────────
// One triangle that covers the screen. vRay points from the camera to the far
// plane through each pixel, which is all a pass needs to turn depth into position.
var SH_FS_VS = SH_HEAD + `
uniform mat4 uInvVP;
uniform vec3 uCam;
out vec2 vUV;
out vec3 vRay;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  vec4 w = uInvVP * vec4(p * 2.0 - 1.0, 1.0, 1.0);
  vRay = w.xyz / w.w - uCam;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The sky as a small panorama, refreshed every few frames: what glossy surfaces
// reflect when the screen has nothing better to offer. A band of lit windows along
// the horizon stands in for the far city, so the river has a skyline to mirror.
var SH_ENV_FS = SH_HEAD + `
in vec2 vUV;
${SH_COMMON}
${SH_SKY}
layout(location = 0) out vec4 oColor;
void main() {
  float az = (vUV.x - 0.5) * 6.2831853, y = vUV.y * 2.0 - 1.0, r = sqrt(max(1.0 - y * y, 0.0));
  vec3 d = vec3(cos(az) * r, y, sin(az) * r);
  vec3 c = skyColor(d, 0.0);
  float band = smoothstep(0.10, 0.0, y) * smoothstep(-0.04, 0.0, y);
  float k = step(0.80, h21(floor(vec2(az * 150.0, y * 260.0))));
  c += vec3(1.0, 0.62, 0.30) * k * band * 0.55;
  oColor = vec4(c, 1.0);
}`;
