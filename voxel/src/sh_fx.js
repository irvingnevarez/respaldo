// ═══════════════════════════════════════════════════════════════════════
//  SH_FX — everything drawn over the lit scene: light in the air, rain, beams.
//
//  None of these write depth. They read the scene's depth texture and test
//  against it themselves, which is also what lets a glow know how much air lies
//  between the eye and the wall behind it.
// ═══════════════════════════════════════════════════════════════════════

// ── light scattered by the wet air around a lamp ──────────────────────────
// A lamp in fog is not a sprite: what you see is every point along your line of
// sight that the lamp lights, added up. For a point light that sum has a closed
// form in the angle the lamp sees the ray under, which is what `(th1 - th0) / h`
// is; the few samples only weigh in the things that have no closed form (the
// hood that throws the light downward, the way mist scatters forward, the fog
// thinning with height). The scene depth cuts the ray short, so a lamp behind a
// wall glows only where the wall lets it.
var SH_VOL_VS = SH_HEAD + `
layout(location = 0) in vec2 aCorner;       // -1..1
layout(location = 1) in vec4 aPosR;         // light xyz, reach of its glow
layout(location = 2) in vec4 aColK;         // rgb * intensity, kind (0 hooded lamp, 1 all round)
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uRight;
uniform vec3 uUp;
out vec4 vPosR;
out vec4 vColK;
void main() {
  vPosR = aPosR; vColK = aColK;
  vec3 toL = aPosR.xyz - uCam;
  float dl = length(toL), R = aPosR.w;
  if (dl < R * 1.25) gl_Position = vec4(aCorner, 0.0, 1.0);         // the camera is inside the glow: it fills the screen
  else {
    float k = R * dl / sqrt(dl * dl - R * R);                        // a quad that just covers the sphere's outline
    gl_Position = uVP * vec4(aPosR.xyz + (uRight * aCorner.x + uUp * aCorner.y) * k, 1.0);
  }
}`;

function SH_volFS(defs) {
  return SH_HEAD + defs + `
in vec4 vPosR;
in vec4 vColK;
${SH_COMMON}
uniform sampler2D uDepth;
uniform mat4 uInvVP;
uniform vec2 uInvRes;
uniform vec2 uNF;
uniform float uFrame;
uniform float uVolK;
layout(location = 0) out vec4 oColor;
float linZ(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
void main() {
  vec4 w = uInvVP * vec4(gl_FragCoord.xy * uInvRes * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = w.xyz / w.w - uCam;
  float rl = length(ray);
  vec3 rd = ray / rl;
  float tMax = rl * linZ(texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r) / uNF.y;
  vec3 L = vPosR.xyz - uCam;
  float R = vPosR.w;
  float tc = dot(L, rd);
  float h2 = dot(L, L) - tc * tc;
  if (h2 >= R * R) discard;
  float hw = sqrt(R * R - h2);
  float t0 = max(tc - hw, 0.0), t1 = min(tc + hw, tMax);
  if (t1 <= t0) discard;
  float h = sqrt(max(h2, 0.0)) + 0.14;                  // the lamp has a size: no singularity on its axis
  float th0 = atan((t0 - tc) / h), th1 = atan((t1 - tc) / h);
#ifdef Q_JIT
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588238);
#else
  float jit = 0.5;
#endif
  float acc = 0.0;
  for (int i = 0; i < Q_VOL; i++) {
    float s = tc + h * tan(mix(th0, th1, (float(i) + jit) / float(Q_VOL)));
    vec3 p = rd * s - L;                                // lamp -> sample
    float d = max(length(p), 1e-3);
    float fall = max(1.0 - d / R, 0.0);
    float cone = vColK.a < 0.5 ? mix(0.16, 1.0, smoothstep(-0.30, 0.70, -p.y / d)) : 1.0;
    float fwd = 0.60 + 1.1 * pow(max(dot(p, -rd) / d, 0.0), 3.0);
    acc += fall * fall * cone * fwd * fogDensityAt(uCam.y + rd.y * s);
  }
  vec3 col = vColK.rgb * ((th1 - th0) / h * acc / float(Q_VOL) * uVolK);
  col *= 1.0 - 0.8 * fogAmt(vPosR.xyz);
  oColor = vec4(col, 1.0);
}`;
}

// ── rain: a volume of streaks around the camera, animated entirely on the GPU ─
// Each streak looks up the roof over its head (nothing falls indoors or under the
// bridge) and the lamps around it, so the rain is nearly invisible in the dark and
// lights up where it crosses a lamp's cone — which is how rain looks at night.
var SH_RAINLIT = `
uniform sampler2D uTop;
uniform sampler2D uLights;
uniform sampler2D uGrid;
uniform vec3 uAmb;
uniform float uRainLit;
uniform vec4 uDyn[8];
uniform vec4 uDynC[8];
uniform int uDynN;
vec3 rainLight(vec3 p, vec3 cam) {
  vec3 lit = uAmb;
  vec3 vd = normalize(p - cam);
  ivec2 cell = ivec2(floor(p.xz / 16.0)) & 31;
  bool done = false;
  for (int k = 0; k < 2; k++) {
    if (done) break;
    vec4 idx = texelFetch(uGrid, ivec2(cell.x * 3 + k, cell.y), 0);
    for (int j = 0; j < 4; j++) {
      if (idx[j] < 0.0) { done = true; break; }
      int li = int(idx[j]);
      vec4 L0 = texelFetch(uLights, ivec2(li, 0), 0), L1 = texelFetch(uLights, ivec2(li, 1), 0);
      vec3 Lv = L0.xyz - p;
      float d = length(Lv), R = L0.w * 1.1;
      if (d >= R) continue;
      float f = 1.0 - d / R;
      float hood = L1.a < 0.5 ? mix(0.2, 1.0, smoothstep(-0.3, 0.7, Lv.y / max(d, 1e-3))) : 1.0;
      lit += L1.rgb * (f * f * hood * (1.0 + 2.5 * pow(max(dot(vd, Lv) / max(d, 1e-3), 0.0), 3.0)) * uRainLit);
    }
  }
  for (int i = 0; i < 8; i++) {
    if (i >= uDynN) break;
    float d = distance(uDyn[i].xyz, p), R = uDyn[i].w;
    if (d < R) { float f = 1.0 - d / R; lit += uDynC[i].rgb * f * f * uRainLit * 0.6; }
  }
  return lit;
}
`;

var SH_RAIN_VS = SH_HEAD + `
layout(location = 0) in vec2 aCorner;       // x: -1..1 across, y: 0..1 along
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;
uniform float uWind;
${SH_RAINLIT}
out vec3 vCol;
out vec2 vC;
float hh(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float id = float(gl_InstanceID);
  float W = 70.0, Hh = 46.0;
  vec3 base = vec3(hh(id) * W, hh(id + 11.3) * Hh, hh(id + 27.7) * W);
  float speed = 27.0 + hh(id + 3.1) * 11.0;
  vec3 p;
  p.y = Hh - mod(base.y + uTime * speed, Hh);
  float slant = uWind * (0.25 + hh(id + 5.5) * 0.15);
  p.x = base.x + (Hh - p.y) * slant;
  p.z = base.z;
  // wrap into a box centred on the camera
  p.x = uCam.x + mod(p.x - uCam.x + W * 0.5, W) - W * 0.5;
  p.z = uCam.z + mod(p.z - uCam.z + W * 0.5, W) - W * 0.5;
  p.y += uCam.y - 14.0;
  float len = 1.3 + hh(id + 8.8) * 1.1;
  vec3 dir = normalize(vec3(slant, 1.0, 0.0)) * len;
  vec3 toCam = normalize(uCam - p);
  float dc = length(p - uCam);
  vec3 side = normalize(cross(dir, toCam)) * (0.009 + dc * 0.00095);
  vec3 pos = p + dir * aCorner.y + side * aCorner.x;
  // a streak a metre from the lens is as long as the screen and reads as a scratch:
  // fade it in over the first few metres, and out again at the far edge of the box
  float fade = smoothstep(2.0, 9.0, dc) * (1.0 - smoothstep(24.0, 58.0, dc));
  float top = texelFetch(uTop, ivec2(floor(p.xz)) & 255, 0).r * 255.0;
  fade *= step(top, p.y + 0.6);
  vCol = rainLight(p + dir * 0.5, uCam) * ((0.40 + hh(id + 1.9) * 0.60) * fade);
  vC = aCorner;
  gl_Position = uVP * vec4(pos, 1.0);
}`;

var SH_RAIN_FS = SH_HEAD + `
in vec3 vCol;
in vec2 vC;
uniform sampler2D uDepth;
uniform float uAlpha;
layout(location = 0) out vec4 oColor;
void main() {
  if (gl_FragCoord.z > texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r) discard;
  float a = (1.0 - abs(vC.x)) * (1.0 - vC.y * 0.8) * smoothstep(0.0, 0.08, vC.y);
  oColor = vec4(vCol * a * uAlpha, 1.0);
}`;

// Where the drops land: a little crown of spray on whatever the rain reaches first.
var SH_SPLASH_VS = SH_HEAD + `
layout(location = 0) in vec2 aCorner;       // -1..1
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uRight;
uniform float uTime;
${SH_RAINLIT}
out vec3 vCol;
out vec2 vC;
float hh(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float id = float(gl_InstanceID);
  float T = uTime * (2.6 + hh(id) * 1.2) + hh(id + 4.1) * 10.0;
  float n = floor(T), ph = fract(T);
  vec2 xz = uCam.xz + (vec2(hh(id * 1.31 + n * 7.7), hh(id * 2.17 + n * 3.3)) - 0.5) * 46.0;
  float y = texelFetch(uTop, ivec2(floor(xz)) & 255, 0).r * 255.0;
  vec3 c = vec3(xz.x, y, xz.y);
  float dc = distance(c, uCam);
  float size = (0.035 + 0.085 * ph) * (0.7 + 0.6 * hh(id + 9.9));
  vec3 pos = c + uRight * (aCorner.x * size * 1.3) + vec3(0.0, (aCorner.y * 0.5 + 0.5) * size * 1.5, 0.0);
  float fade = (1.0 - ph) * (1.0 - ph) * (1.0 - smoothstep(26.0, 44.0, dc)) * step(abs(y - uCam.y), 60.0);
  vCol = rainLight(c + vec3(0.0, 0.2, 0.0), uCam) * fade;
  vC = aCorner;
  gl_Position = uVP * vec4(pos, 1.0);
}`;

var SH_SPLASH_FS = SH_HEAD + `
in vec3 vCol;
in vec2 vC;
uniform sampler2D uDepth;
uniform float uAlpha;
layout(location = 0) out vec4 oColor;
void main() {
  if (gl_FragCoord.z > texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r + 0.00002) discard;
  // a speck of spray: bright at the foot, thrown up and outward
  float a = smoothstep(1.0, 0.2, length(vec2(vC.x * (1.0 + vC.y), vC.y * 0.8 + 0.3))) * (0.6 + 0.4 * abs(vC.x));
  oColor = vec4(vCol * a * uAlpha * 1.3, 1.0);
}`;

// ── a light beam: the bat-signal, the columns over lit beacons ─────────────
var SH_BEAM_VS = SH_HEAD + `
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

var SH_BEAM_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uDepth;
uniform sampler2D uNoiseA;
uniform vec2 uNF;
uniform float uTime;
uniform float uPulse;
uniform vec3 uTint;
layout(location = 0) out vec4 oColor;
float linZ(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
void main() {
  float sd = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (gl_FragCoord.z > sd) discard;
  // the path of the eye through a cylinder of lit air is longest through its middle
  float body = sqrt(max(1.0 - vUV.x * vUV.x, 0.0));
  float along = pow(1.0 - vUV.y, 0.8) * smoothstep(0.0, 0.03, vUV.y);
  float dust = 0.70 + 0.60 * textureLod(uNoiseA, vec2(vUV.x * 0.11 + uTime * 0.004, vUV.y * 1.7 - uTime * 0.02), 0.0).r;
  float soft = clamp((linZ(sd) - linZ(gl_FragCoord.z)) * 0.35, 0.0, 1.0);
  oColor = vec4(uTint * (body * body * along * uPulse * dust * soft * 0.50), 1.0);
}`;

// ── the bat emblem the signal throws on the clouds ─────────────────────────
var SH_EMB_VS = SH_HEAD + `
layout(location = 0) in vec2 aCorner;
uniform mat4 uVP;
uniform vec3 uCenter;
uniform float uHalf;
out vec2 vUV;
void main() {
  vec2 q = vec2(aCorner.x, aCorner.y * 2.0 - 1.0);
  vUV = q;
  // lies flat in the cloud deck; "up" on the emblem is north (-z)
  gl_Position = uVP * vec4(uCenter + vec3(q.x * uHalf, 0.0, q.y * uHalf * 0.52), 1.0);
}`;
var SH_EMB_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uBat;
uniform sampler2D uDepth;
uniform float uPulse;
layout(location = 0) out vec4 oColor;
void main() {
  if (gl_FragCoord.z > texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r) discard;
  float r = length(vUV);
  float disc = smoothstep(1.0, 0.72, r);
  float bat = texture(uBat, vec2(vUV.x * 0.5 + 0.5, 0.5 - vUV.y * 0.5)).r;
  float a = disc * (1.0 - bat * 0.97) * 0.55 * uPulse;
  // a faint ring of halo outside the disc
  a += smoothstep(1.0, 0.8, r) * smoothstep(0.55, 1.0, r) * 0.18 * uPulse;
  oColor = vec4(vec3(1.0, 0.92, 0.6) * a * 1.5, 1.0);
}`;
