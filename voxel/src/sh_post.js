// ═══════════════════════════════════════════════════════════════════════
//  SH_POST — what happens to the picture after it is lit.
//
//    TAA       every frame is drawn a fraction of a pixel off; this pass blends it
//              with the frames before, re-projected through depth, so edges, thin
//              rain-wet highlights and the noise of the reflections all settle
//    BLUR      motion blur: each pixel is smeared along the path it travelled on the
//              screen while the shutter was open, found by re-projecting its depth
//    BLOOM     a pyramid of blurs of the whole picture, no threshold: a lamp
//              glares because it is a thousand times brighter than the wall, not
//              because a shader decided it was "bright"
//    STREAK    the horizontal smear an anamorphic lens gives the brightest lights
//    EXPOSE    the eye adapting: a 1x1 texture that drifts toward what the scene needs
//    COMPOSE   exposure, tone curve, THEN the grade, in display space
//    FINAL     sharpening (or FXAA when there is no TAA), grain, dither
// ═══════════════════════════════════════════════════════════════════════

var SH_POST_VS = SH_HEAD + `
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

var SH_TAA_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uCur;
uniform sampler2D uHist;
uniform sampler2D uDepth;
uniform mat4 uInvVPj;
uniform mat4 uPrevVP;
uniform vec2 uTexel;
uniform float uBlend;
layout(location = 0) out vec4 oHist;
layout(location = 1) out vec4 oPost;
vec3 toY(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromY(vec3 c) { float t = c.x - c.z; return vec3(t + c.y, c.x + c.z, t - c.y); }
// Catmull-Rom in five bilinear taps: sharper than bilinear, which would blur the
// history a little more every frame the camera moves
vec3 history(vec2 uv) {
  vec2 pos = uv / uTexel, c = floor(pos - 0.5) + 0.5, f = pos - c, f2 = f * f, f3 = f2 * f;
  vec2 w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1.0, w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
  vec2 w12 = w1 + w2, t12 = (c + w2 / w12) * uTexel, t0 = (c - 1.0) * uTexel, t3 = (c + 2.0) * uTexel;
  vec4 s = vec4(textureLod(uHist, vec2(t12.x, t0.y), 0.0).rgb, 1.0) * (w12.x * w0.y)
         + vec4(textureLod(uHist, vec2(t0.x, t12.y), 0.0).rgb, 1.0) * (w0.x * w12.y)
         + vec4(textureLod(uHist, t12, 0.0).rgb, 1.0) * (w12.x * w12.y)
         + vec4(textureLod(uHist, vec2(t3.x, t12.y), 0.0).rgb, 1.0) * (w3.x * w12.y)
         + vec4(textureLod(uHist, vec2(t12.x, t3.y), 0.0).rgb, 1.0) * (w12.x * w3.y);
  return max(s.rgb / s.a, vec3(0.0));
}
void main() {
  // the nearest depth around the pixel, so an edge follows the surface in front
  float d = textureLod(uDepth, vUV, 0.0).r;
  d = min(d, textureLod(uDepth, vUV + vec2(uTexel.x, 0.0), 0.0).r);
  d = min(d, textureLod(uDepth, vUV - vec2(uTexel.x, 0.0), 0.0).r);
  d = min(d, textureLod(uDepth, vUV + vec2(0.0, uTexel.y), 0.0).r);
  d = min(d, textureLod(uDepth, vUV - vec2(0.0, uTexel.y), 0.0).r);
  vec4 w = uInvVPj * vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 pc = uPrevVP * vec4(w.xyz / w.w, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;

  vec3 cur = toY(textureLod(uCur, vUV, 0.0).rgb);
  vec3 m1 = cur, m2 = cur * cur;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec3 s = toY(textureLod(uCur, vUV + vec2(float(i), float(j)) * uTexel, 0.0).rgb);
    m1 += s; m2 += s * s;
  }
  vec3 mu = m1 / 9.0, sg = sqrt(max(m2 / 9.0 - mu * mu, vec3(0.0)));
  float wH = uBlend;
  if (pc.w <= 0.0 || puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) wH = 0.0;
  vec3 h = toY(history(clamp(puv, vec2(0.0), vec2(1.0))));
  // pull the history into the range its neighbourhood allows: what stops a ghost
  vec3 e = 1.25 * sg + 1e-5, v = h - mu, q = abs(v / e);
  float m = max(q.x, max(q.y, q.z));
  if (m > 1.0) h = mu + v / m;
  // weigh by brightness so one hot sample cannot flicker
  float kc = (1.0 - wH) / (1.0 + cur.x), kh = wH / (1.0 + h.x);
  vec3 r = max(fromY((cur * kc + h * kh) / (kc + kh)), vec3(0.0));
  oHist = vec4(r, 1.0);
  oPost = vec4(r, 1.0);
}`;

// Motion blur from the camera's own movement. Where a pixel was last frame comes
// from its depth and last frame's view; the picture is averaged along that path,
// for the part of the frame the shutter stays open. What moves WITH the camera —
// the character it follows, the people around him — is flagged in the G-buffer and
// stays sharp, and the blur of the street behind him never picks up his colours.
var SH_MBLUR_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform sampler2D uG3;
uniform mat4 uInvVPj;
uniform mat4 uPrevVP;
uniform vec2 uRes;
uniform float uShutter;
uniform float uMaxLen;
uniform int uN;
uniform float uFrame;
layout(location = 0) out vec4 oColor;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 c0 = texelFetch(uTex, px, 0).rgb;
  if (texelFetch(uG3, px, 0).a > 0.5) { oColor = vec4(c0, 1.0); return; }
  float d = texelFetch(uDepth, px, 0).r;
  vec4 w = uInvVPj * vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 pc = uPrevVP * vec4(w.xyz / w.w, 1.0);
  if (pc.w <= 0.0) { oColor = vec4(c0, 1.0); return; }
  vec2 v = (vUV - (pc.xy / pc.w * 0.5 + 0.5)) * uShutter;
  float L = length(v * uRes);
  if (L < 0.75) { oColor = vec4(c0, 1.0); return; }
  if (L > uMaxLen) v *= uMaxLen / L;
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588238) - 0.5;
  vec3 acc = c0;
  float ws = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uN) break;
    vec2 s = vUV + v * ((float(i) + 0.5 + jit) / float(uN) - 0.5);
    ivec2 sp = clamp(ivec2(s * uRes), ivec2(0), ivec2(uRes) - 1);
    if (texelFetch(uG3, sp, 0).a > 0.5) continue;
    acc += texelFetch(uTex, sp, 0).rgb;
    ws += 1.0;
  }
  oColor = vec4(acc / ws, 1.0);
}`;

// Downsample: 13 taps (Jimenez), with the option of weighing each group by its
// brightness on the first step so a single hot pixel cannot become a flickering blob.
var SH_DOWN_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uKaris;
layout(location = 0) out vec4 oColor;
float lw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * uKaris); }
void main() {
  vec3 a = textureLod(uTex, vUV + uTexel * vec2(-2.0, -2.0), 0.0).rgb, b = textureLod(uTex, vUV + uTexel * vec2(0.0, -2.0), 0.0).rgb;
  vec3 c = textureLod(uTex, vUV + uTexel * vec2(2.0, -2.0), 0.0).rgb, d = textureLod(uTex, vUV + uTexel * vec2(-2.0, 0.0), 0.0).rgb;
  vec3 e = textureLod(uTex, vUV, 0.0).rgb, f = textureLod(uTex, vUV + uTexel * vec2(2.0, 0.0), 0.0).rgb;
  vec3 g = textureLod(uTex, vUV + uTexel * vec2(-2.0, 2.0), 0.0).rgb, h = textureLod(uTex, vUV + uTexel * vec2(0.0, 2.0), 0.0).rgb;
  vec3 i = textureLod(uTex, vUV + uTexel * vec2(2.0, 2.0), 0.0).rgb, j = textureLod(uTex, vUV + uTexel * vec2(-1.0, -1.0), 0.0).rgb;
  vec3 k = textureLod(uTex, vUV + uTexel * vec2(1.0, -1.0), 0.0).rgb, l = textureLod(uTex, vUV + uTexel * vec2(-1.0, 1.0), 0.0).rgb;
  vec3 m = textureLod(uTex, vUV + uTexel * vec2(1.0, 1.0), 0.0).rgb;
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * lw(g0), w1 = 0.125 * lw(g1), w2 = 0.125 * lw(g2), w3 = 0.125 * lw(g3), w4 = 0.125 * lw(g4);
  oColor = vec4(min((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), vec3(48.0)), 1.0);
}`;

// Upsample with a 3x3 tent; drawn additively onto the level above.
var SH_UP_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uMix;
layout(location = 0) out vec4 oColor;
void main() {
  vec3 c = textureLod(uTex, vUV, 0.0).rgb * 4.0;
  c += (textureLod(uTex, vUV + uTexel * vec2(-1.0, 0.0), 0.0).rgb + textureLod(uTex, vUV + uTexel * vec2(1.0, 0.0), 0.0).rgb
      + textureLod(uTex, vUV + uTexel * vec2(0.0, -1.0), 0.0).rgb + textureLod(uTex, vUV + uTexel * vec2(0.0, 1.0), 0.0).rgb) * 2.0;
  c += textureLod(uTex, vUV + uTexel * vec2(-1.0, -1.0), 0.0).rgb + textureLod(uTex, vUV + uTexel * vec2(1.0, -1.0), 0.0).rgb
     + textureLod(uTex, vUV + uTexel * vec2(-1.0, 1.0), 0.0).rgb + textureLod(uTex, vUV + uTexel * vec2(1.0, 1.0), 0.0).rgb;
  oColor = vec4(c / 16.0 * uMix, 1.0);
}`;

// One-dimensional blur for the anamorphic streak; the first pass also keeps only
// what is brighter than uThr.
var SH_STREAK_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uThr;
layout(location = 0) out vec4 oColor;
void main() {
  vec3 c = vec3(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = 1.0 - abs(float(i)) / 5.0;
    vec3 s = textureLod(uTex, vUV + uDir * float(i), 0.0).rgb;
    if (uThr > 0.0) { float l = max(s.r, max(s.g, s.b)); s *= max(l - uThr, 0.0) / max(l, 1e-4); }
    c += s * w; ws += w;
  }
  oColor = vec4(c / ws, 1.0);
}`;

// The eye: where the exposure wants to be for what is on screen, approached slowly.
var SH_EXPO_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uTex;       // the smallest bloom level: the scene, averaged
uniform sampler2D uPrev;
uniform float uKey;
uniform float uRate;
uniform vec2 uRange;
layout(location = 0) out vec4 oColor;
void main() {
  float s = 0.0, ws = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 p = (vec2(float(i), float(j)) + 0.5) / 4.0;
    float w = 1.0 - 0.6 * length(p - 0.5);                    // the middle of the picture counts for more
    s += log(dot(textureLod(uTex, p, 0.0).rgb, vec3(0.2126, 0.7152, 0.0722)) + 0.004) * w; ws += w;
  }
  float want = clamp(0.5 * pow(uKey / exp(s / ws), 0.6), uRange.x, uRange.y);       // stored halved, so it fits an 8-bit target too
  float prev = texelFetch(uPrev, ivec2(0), 0).r;
  oColor = vec4(mix(prev, want, uRate));
}`;

var SH_COMP_FS = SH_HEAD + `
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uStreak;
uniform sampler2D uExpo;
uniform float uExposure;
uniform float uBloomAmt;
uniform float uStreakAmt;
uniform float uCA;
uniform float uVig;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uFade;
uniform vec4 uHurt;
layout(location = 0) out vec4 oColor;

// ACES, the fitted version with the input and output transforms (Stephen Hill):
// unlike the one-line curve it lets a saturated light bleach toward white as it
// gets brighter, which is what makes neon look hot instead of merely red.
  const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 aces(vec3 c) {
  c = ACES_IN * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537, b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACES_OUT * (a / b), 0.0, 1.0);
}
void main() {
  vec2 q = vUV * 2.0 - 1.0;
  // a lens does not bring all colours to quite the same place, least of all in the corners
  vec2 ca = q * dot(q, q) * uCA;
  vec3 c = vec3(texture(uScene, vUV - ca).r, texture(uScene, vUV).g, texture(uScene, vUV + ca).b);
  vec3 bloom = texture(uBloom, vUV).rgb;
  c = mix(c, bloom, uBloomAmt);
  c += texture(uStreak, vUV).rgb * vec3(0.55, 0.75, 1.0) * uStreakAmt;
  c *= uExposure * texelFetch(uExpo, ivec2(0), 0).r;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  c = c * uGain + uLift;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float v = 1.0 - dot(q * vec2(0.92, 1.0), q * vec2(0.92, 1.0)) * uVig;
  c *= clamp(v, 0.0, 1.0);
  c = mix(c, uHurt.rgb, uHurt.a * smoothstep(0.35, 1.45, length(q)));
  c *= uFade;
  oColor = vec4(c, 1.0);
}`;

// The last pass, in display space: with TAA a light sharpening to give back what
// the blend softened; without it, FXAA. Then film grain and an ordered dither,
// without which a dark gradient bands hard at 8 bits.
function SH_finalFS(fxaa) {
  return SH_HEAD + (fxaa ? '#define FXAA 1\n' : '') + `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGrain;
uniform float uTime;
uniform float uSharp;
layout(location = 0) out vec4 oColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 m = texture(uTex, vUV).rgb;
  vec3 n = texture(uTex, vUV + uTexel * vec2(0.0, -1.0)).rgb, s = texture(uTex, vUV + uTexel * vec2(0.0, 1.0)).rgb;
  vec3 w = texture(uTex, vUV + uTexel * vec2(-1.0, 0.0)).rgb, e = texture(uTex, vUV + uTexel * vec2(1.0, 0.0)).rgb;
  vec3 col = m;
#ifdef FXAA
  float lM = luma(m), lN = luma(n), lS = luma(s), lW = luma(w), lE = luma(e);
  float lo = min(lM, min(min(lN, lS), min(lW, lE))), hi = max(lM, max(max(lN, lS), max(lW, lE)));
  if (hi - lo > max(0.045, hi * 0.12)) {
    vec2 dir = vec2(-((lN + lE) - (lS + lW)), (lW + lN) - (lE + lS));
    float red = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((lN + lS + lW + lE) * 0.03, 0.0078));
    dir = clamp(dir * red, -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (textureLod(uTex, vUV + dir * (1.0 / 3.0 - 0.5), 0.0).rgb + textureLod(uTex, vUV + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
    vec3 b = a * 0.5 + 0.25 * (textureLod(uTex, vUV + dir * -0.5, 0.0).rgb + textureLod(uTex, vUV + dir * 0.5, 0.0).rgb);
    float lb = luma(b);
    col = (lb < lo || lb > hi) ? a : b;
  }
#else
  // sharpen, but never past what the neighbours already contain: no halos
  vec3 lo = min(m, min(min(n, s), min(w, e))), hi = max(m, max(max(n, s), max(w, e)));
  col = clamp(m + (m - (n + s + w + e) * 0.25) * uSharp, lo, hi);
#endif
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain * (1.0 - 0.6 * luma(col));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(4.1, 7.3))) * 9371.7) - 0.5) / 255.0;
  oColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
}
