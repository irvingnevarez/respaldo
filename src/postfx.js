// ═══════════════════════════════════════════════════════════════════════
//  POST-PROCESSING — WebGL2 pipeline run over the 2D scene each frame.
//
//  scene canvas -> bright pass -> 6-level mip blur chain (downsample with a
//  13-tap filter, upsample with a tent filter, accumulated additively) ->
//  composite: chromatic aberration, bloom, ACES filmic tonemap, lift/gamma/
//  gain grading, split toning, vignette, grain, and an ordered dither.
//
//  The dither matters more than it sounds: this game is almost entirely dark
//  gradients, and 8-bit output bands badly without it.
//
//  Degrades to null if WebGL2 is unavailable — the caller then shows the
//  plain 2D canvas instead.
// ═══════════════════════════════════════════════════════════════════════

var PFX_VERT = [
  '#version 300 es',
  'out vec2 vUV;',
  'void main(){',
  '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
  '  vUV = p;',
  '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
  '}'
].join('\n');

var PFX_HEAD = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'in vec2 vUV;',
  'out vec4 oColor;'
].join('\n');

// ── bright pass ─────────────────────────────────────────────────────────
var PFX_BRIGHT = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform float uThreshold;',
  'uniform float uKnee;',
  'uniform float uWarm;',
  'void main(){',
  '  vec3 c = texture(uTex, vUV).rgb;',
  '  c = pow(max(c, 0.0), vec3(2.2));',            // to rough linear
  '  float br = max(c.r, max(c.g, c.b));',
  '  float k = max(uKnee, 1e-4);',
  '  float soft = clamp(br - uThreshold + k, 0.0, 2.0 * k);',
  '  soft = soft * soft / (4.0 * k);',
  '  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);',
  // Gotham's light sources are amber: let gold bloom harder than blue-white
  '  float warm = clamp(c.r + c.g * 0.6 - c.b * 1.2, 0.0, 2.0);',
  '  contrib *= 1.0 + uWarm * warm;',
  '  oColor = vec4(c * contrib, 1.0);',
  '}'
].join('\n');

// ── deferred lighting ───────────────────────────────────────────────────
// Albedo x (ambient + sum of lights), evaluated against the normal buffer.
// Ambient is deliberately high: the 2D art already carries its own baked
// shading, so lights ADD highlights rather than being the only illumination.
// Anything the lights push above 1.0 spills into the bloom chain downstream.
var PFX_MAXL = 24;
var PFX_LIGHT = PFX_HEAD + [
  '',
  'uniform sampler2D uAlbedo;',
  'uniform sampler2D uNrm;',
  'uniform sampler2D uOcc;',
  'uniform int   uShadowCount;',
  'uniform float uShadowStrength;',
  'uniform float uSunShadow;',
  'uniform float uSunLen;',
  'uniform float uAO;',
  'uniform float uSpec;',       // global specular strength
  'uniform float uSunSpec;',    // the moon throws a hard highlight of its own
  'uniform vec3  uAmbient;',
  'uniform float uAspect;',
  'uniform float uNrmStrength;',
  'uniform int   uCount;',
  'uniform vec4  uLP[' + PFX_MAXL + '];',   // xy = uv position, z = height, w = radius
  'uniform vec4  uLC[' + PFX_MAXL + '];',   // rgb = colour, a = intensity
  'uniform vec3  uSunDir;',
  'uniform vec3  uSunCol;',
  '',
  // March from the fragment toward the light through the occluder map. The
  // first couple of steps are skipped so a surface does not shadow itself,
  // and the taps widen with distance to fake a penumbra.
  'float PFX_shadow(vec2 uv, vec2 lp){',
  '  const int ST = 9;',
  '  vec2 stepv = (lp - uv) / float(ST);',
  '  float occ = 0.0;',
  // One tap per step, offset perpendicular by a step-varying amount: it
  // softens the edge the same way three taps did, at a third of the cost.
  '  for (int i = 3; i <= ST; i++) {',
  '    float f = float(i) / float(ST);',
  '    vec2 w = vec2(stepv.y, -stepv.x) * (f - 0.5) * 0.9;',
  '    occ += texture(uOcc, uv + stepv * float(i) + w).r;',
  '  }',
  '  return clamp(1.0 - (occ / float(ST - 2)) * uShadowStrength, 0.0, 1.0);',
  '}',
  '',
  'void main(){',
  '  vec3 n = texture(uNrm, vUV).rgb * 2.0 - 1.0;',
  // The normal buffer is authored in canvas space (y grows downward) but every
  // light vector here is in UV space (y grows upward), so the vertical
  // component has to be flipped or lighting arrives upside down.
  '  n.y = -n.y;',
  '  n.xy *= uNrmStrength;',
  '  n = normalize(n + vec3(0.0, 0.0, 1e-5));',
  '  vec3 lit = uAmbient;',
  '',
  // ── material ──────────────────────────────────────────────────────────
  // Everything above this line was Lambertian: every surface in the game
  // answered light the same way, which is exactly why it read as illustrated
  // rather than rendered. The occluder buffer now carries roughness in green
  // and specular mass in blue, so wet stone, lacquered metal, brick and the
  // suit each answer differently.
  '  vec4 mat = texture(uOcc, vUV);',
  '  float rough = clamp(mat.g, 0.03, 1.0);',
  '  float shin  = mix(240.0, 3.0, rough * rough);',
  // Fresnel. Light grazing a surface reflects far more of it, which is why a
  // wet road glares at you down its length and not underfoot, and why every
  // edge in a modern frame carries a bright lip. n.z is 1 facing the camera
  // and 0 at a silhouette edge, so this falls out of the normal buffer for
  // free and lands exactly where the eye expects it.
  '  float fres  = pow(1.0 - clamp(n.z, 0.0, 1.0), 4.0);',
  '  float kspec = mat.b * uSpec * (0.22 + 1.25 * fres);',
  '  vec3  V     = vec3(0.0, 0.0, 1.0);',
  '  vec3  spec  = vec3(0.0);',
  // Contact occlusion. Only air pixels are darkened, and only by how much
  // geometry crowds them, so nooks where a wall meets the floor and the
  // undersides of ledges pick up a soft grounding shadow. Pixels inside
  // geometry are left alone - the tile art already shades its own volume.
  '  if (uAO > 0.001 && texture(uOcc, vUV).r < 0.45) {',
  '    float occ = 0.0;',
  '    for (int i = 0; i < 6; i++) {',
  '      float a = float(i) * 1.0471975;',
  '      vec2 d = vec2(cos(a) / uAspect, sin(a));',
  '      occ += texture(uOcc, vUV + d * 0.016).r;',
  '    }',
  '    lit *= 1.0 - clamp(occ / 6.0, 0.0, 1.0) * uAO;',
  '  }',
  // Directional (moon) shadow: a fixed-length march along the light direction.
  // This is what produces the long raking shadows off every block and figure -
  // the point lights are small and local, so on their own they barely read.
  '  float sunSh = 1.0;',
  '  if (uSunShadow > 0.0) {',
  '    vec2 sd = normalize(vec2(uSunDir.x / uAspect, uSunDir.y)) * uSunLen;',
  '    float socc = 0.0;',
  '    for (int i = 2; i <= 9; i++) {',
  '      socc += texture(uOcc, vUV + sd * (float(i) / 9.0)).r;',
  '    }',
  '    sunSh = clamp(1.0 - (socc / 8.0) * uSunShadow, 0.0, 1.0);',
  '  }',
  '  vec3 sdir = normalize(uSunDir);',
  '  lit += uSunCol * max(dot(n, sdir), 0.0) * sunSh;',
  // the moon is a small, hard source: a tight highlight, not a wash
  '  vec3 sh2 = normalize(sdir + V);',
  '  spec += uSunCol * (pow(max(dot(n, sh2), 0.0), shin) * kspec * uSunSpec * sunSh);',
  '  for (int i = 0; i < ' + PFX_MAXL + '; i++) {',
  '    if (i >= uCount) break;',
  '    vec4 lp = uLP[i];',
  '    vec3 L = vec3((lp.x - vUV.x) * uAspect, lp.y - vUV.y, lp.z);',
  '    float dist = length(L);',
  '    L /= max(dist, 1e-5);',
  '    float att = max(0.0, 1.0 - dist / max(lp.w, 1e-5));',
  '    att *= att;',
  // wrap the falloff slightly: surfaces angled away still catch a little,
  // which reads as bounce light and avoids hard terminator lines
  '    float ndl = max(dot(n, L), 0.0) * 0.82 + 0.18;',
  // only the strongest few lights cast: shadow marching is the expensive part
  '    float sh = (i < uShadowCount && att > 0.001) ? PFX_shadow(vUV, lp.xy) : 1.0;',
  '    lit += uLC[i].rgb * (uLC[i].a * att * ndl * sh);',
  // Specular from the same source. This is what puts a streak of the street
  // lamp on the wet road, a glint on the signal blocks and a hard edge on the
  // suit — the single largest step from "drawn" towards "lit".
  '    vec3 hv = normalize(L + V);',
  '    spec += uLC[i].rgb * (uLC[i].a * att * pow(max(dot(n, hv), 0.0), shin) * kspec * sh);',
  '  }',
  // RGB carries diffuse AND specular summed, and alpha carries the specular's
  // luminance, so the apply pass can separate them again without a second
  // buffer. Keeping them apart matters: diffuse multiplies the surface colour,
  // specular is light bounced off it and must be ADDED — folding the highlight
  // into the albedo is what washed every stone block out to flat grey.
  '  float slum = dot(spec, vec3(0.2126, 0.7152, 0.0722));',
  '  oColor = vec4(lit + spec, slum);',
  '}'
].join('\n');

// ── apply lighting ──────────────────────────────────────────────────────
// Light, shadows and AO are all low-frequency, so the pass above runs at
// half resolution and this multiplies the full-resolution albedo by the
// upscaled result. Same picture, a quarter of the fragment work.
var PFX_APPLY = PFX_HEAD + [
  '',
  'uniform sampler2D uAlbedo;',
  'uniform sampler2D uLight;',
  'void main(){',
  '  vec3 alb = texture(uAlbedo, vUV).rgb;',
  '  vec4 L   = texture(uLight, vUV);',
  // Split the sum back apart using the luminance the light pass stored in
  // alpha. Doing it by ratio rather than by a flat tint keeps the highlight's
  // COLOUR — which is the whole point of a sodium lamp streaking amber across
  // a blue-grey wet road.
  '  float lum   = max(dot(L.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);',
  '  float sfrac = clamp(L.a / lum, 0.0, 1.0);',
  '  vec3  specC = L.rgb * sfrac;',
  '  vec3  diffC = max(L.rgb - specC, vec3(0.0));',
  '  oColor = vec4(alb * diffC + specC, 1.0);',
  '}'
].join('\n');

// ── 13-tap downsample ───────────────────────────────────────────────────
var PFX_DOWN = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform vec2 uTexel;',
  'void main(){',
  '  vec2 t = uTexel;',
  '  vec3 a = texture(uTex, vUV + vec2(-2.0,  2.0) * t).rgb;',
  '  vec3 b = texture(uTex, vUV + vec2( 0.0,  2.0) * t).rgb;',
  '  vec3 c = texture(uTex, vUV + vec2( 2.0,  2.0) * t).rgb;',
  '  vec3 d = texture(uTex, vUV + vec2(-2.0,  0.0) * t).rgb;',
  '  vec3 e = texture(uTex, vUV                     ).rgb;',
  '  vec3 f = texture(uTex, vUV + vec2( 2.0,  0.0) * t).rgb;',
  '  vec3 g = texture(uTex, vUV + vec2(-2.0, -2.0) * t).rgb;',
  '  vec3 h = texture(uTex, vUV + vec2( 0.0, -2.0) * t).rgb;',
  '  vec3 i = texture(uTex, vUV + vec2( 2.0, -2.0) * t).rgb;',
  '  vec3 j = texture(uTex, vUV + vec2(-1.0,  1.0) * t).rgb;',
  '  vec3 k = texture(uTex, vUV + vec2( 1.0,  1.0) * t).rgb;',
  '  vec3 l = texture(uTex, vUV + vec2(-1.0, -1.0) * t).rgb;',
  '  vec3 m = texture(uTex, vUV + vec2( 1.0, -1.0) * t).rgb;',
  '  vec3 r = e * 0.125;',
  '  r += (a + c + g + i) * 0.03125;',
  '  r += (b + d + f + h) * 0.0625;',
  '  r += (j + k + l + m) * 0.125;',
  '  oColor = vec4(r, 1.0);',
  '}'
].join('\n');

// ── 9-tap tent upsample ─────────────────────────────────────────────────
var PFX_UP = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform vec2 uTexel;',
  'uniform float uRadius;',
  'void main(){',
  '  vec2 t = uTexel * uRadius;',
  '  vec3 r = vec3(0.0);',
  '  r += texture(uTex, vUV + vec2(-1.0,  1.0) * t).rgb * 1.0;',
  '  r += texture(uTex, vUV + vec2( 0.0,  1.0) * t).rgb * 2.0;',
  '  r += texture(uTex, vUV + vec2( 1.0,  1.0) * t).rgb * 1.0;',
  '  r += texture(uTex, vUV + vec2(-1.0,  0.0) * t).rgb * 2.0;',
  '  r += texture(uTex, vUV                      ).rgb * 4.0;',
  '  r += texture(uTex, vUV + vec2( 1.0,  0.0) * t).rgb * 2.0;',
  '  r += texture(uTex, vUV + vec2(-1.0, -1.0) * t).rgb * 1.0;',
  '  r += texture(uTex, vUV + vec2( 0.0, -1.0) * t).rgb * 2.0;',
  '  r += texture(uTex, vUV + vec2( 1.0, -1.0) * t).rgb * 1.0;',
  '  oColor = vec4(r / 16.0, 1.0);',
  '}'
].join('\n');

// ── depth of field merge ────────────────────────────────────────────────
// The backdrop arrives on its own canvas and is downsampled twice; sampling
// that small texture with hardware bilinear filtering IS the blur, for the
// cost of two quarter-res passes. The foreground canvas is transparent
// everywhere the world does not cover, so its alpha is the composite mask and
// the playfield, entities and HUD all stay perfectly sharp.
var PFX_MERGE = PFX_HEAD + [
  '',
  'uniform sampler2D uBg;',
  'uniform sampler2D uFg;',
  'uniform float uBgDim;',
  'void main(){',
  '  vec4 fg = texture(uFg, vUV);',
  '  vec3 bg = texture(uBg, vUV).rgb * uBgDim;',
  '  oColor = vec4(mix(bg, fg.rgb, clamp(fg.a, 0.0, 1.0)), 1.0);',
  '}'
].join('\n');

// ── wet ground reflections ──────────────────────────────────────────────
// Screen-space mirror: the wet buffer marks every exposed floor tile and
// stores, per pixel, the v coordinate of the surface it belongs to. Each
// pixel below that line samples the lit scene mirrored about it, rippled and
// fading with depth. Runs after lighting so reflected light sources still
// feed the bloom chain.
var PFX_WET = PFX_HEAD + [
  '',
  'uniform sampler2D uLit;',
  'uniform sampler2D uWet;',
  'uniform float uTime;',
  'uniform float uStrength;',
  'uniform float uFade;',
  'uniform float uSquash;',
  'uniform float uRipple;',
  'uniform vec3  uTint;',
  'float PFX_h1(float n){ return fract(sin(n * 17.17) * 43758.5453); }',
  '',
  'void main(){',
  '  vec3 base = texture(uLit, vUV).rgb;',
  '  vec4 w = texture(uWet, vUV);',
  '  if (w.r < 0.08) { oColor = vec4(base, 1.0); return; }',
  '  float surfV = w.g;',                       // v of the reflecting surface
  '  float d = surfV - vUV.y;',                 // how far below the surface we are
  '  if (d <= 0.0) { oColor = vec4(base, 1.0); return; }',
  // two ripple frequencies so the surface never looks like a single sine
  '  float rip = sin(vUV.x * 150.0 + uTime * 1.7 + d * 95.0) * 0.0016',
  '           + sin(vUV.x * 63.0 - uTime * 1.1) * 0.0011;',
  // A true 1:1 mirror only reaches as far above the floor as the band is
  // deep - about 34px - so it reflected almost nothing. Compressing it
  // pulls the windows, the moon and the player down into the puddle, which
  // is what actually reads as a wet street in a side-on view.
  // Rain rings. Each slot along x owns a drop on its own period; the ring
  // radius grows and fades, warping the mirror and leaving a bright crest.
  // The vertical term is squashed hard because the floor is seen edge-on, so
  // the rings read as ellipses rather than circles.
  '  float ripAmp = 0.0;',
  '  float ripPush = 0.0;',
  '  if (uRipple > 0.001) {',
  '    for (int i = 0; i < 4; i++) {',
  '      float slot = floor(vUV.x * 9.0) + float(i - 1);',
  '      float h1 = PFX_h1(slot + 3.7);',
  '      float h2 = PFX_h1(slot + 11.3);',
  '      float cu = (slot + h1) / 9.0;',
  '      float ph = fract(uTime / (1.1 + h2 * 1.4) + h2);',
  '      float rad = ph * 0.058;',
  '      float du = vUV.x - cu;',
  '      float dv = d * 3.2;',
  '      float dist = sqrt(du * du + dv * dv);',
  '      float ring = exp(-abs(dist - rad) * 250.0) * (1.0 - ph);',
  '      ripAmp += ring;',
  '      ripPush += (du > 0.0 ? 1.0 : -1.0) * ring;',
  '    }',
  '    ripAmp *= uRipple;',
  '    ripPush *= uRipple;',
  '  }',
  '  vec2 ruv = vec2(vUV.x + rip + ripPush * 0.006, surfV + d * uSquash);',
  '  vec3 refl = texture(uLit, ruv).rgb;',
  '  float fade = exp(-d * uFade);',
  '  float amt = clamp(w.r * uStrength * fade, 0.0, 0.9);',
  '  vec3 outc = mix(base, refl * uTint, amt);',
  '  outc += vec3(0.55, 0.68, 0.9) * clamp(ripAmp, 0.0, 1.6) * 0.30 * fade;',
  '  oColor = vec4(outc, 1.0);',
  '}'
].join('\n');

// ── anamorphic streak ───────────────────────────────────────────────────
// A wide horizontal-only blur of the bright pass. Real anamorphic lenses
// smear highlights sideways and tint them blue; it is the single cheapest
// thing that makes a frame read as "shot" rather than "rendered".
var PFX_STREAK = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform vec2 uTexel;',
  'uniform float uLen;',
  'void main(){',
  '  vec3 acc = vec3(0.0);',
  '  float wsum = 0.0;',
  '  for (int i = -14; i <= 14; i++) {',
  '    float fi = float(i);',
  '    float w = 1.0 - abs(fi) / 15.0;',
  '    w *= w;',
  '    acc += texture(uTex, vUV + vec2(fi * uTexel.x * uLen, 0.0)).rgb * w;',
  '    wsum += w;',
  '  }',
  '  oColor = vec4(acc / max(wsum, 1e-4), 1.0);',
  '}'
].join('\n');

// ── FXAA ────────────────────────────────────────────────────────────────
// The art is vector-drawn with hard edges and the frame is upscaled by CSS,
// so diagonals were visibly stair-stepped. Standard luma FXAA on the final
// LDR image, which is where it belongs.
var PFX_FXAA = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform vec2 uTexel;',
  'uniform float uSharp;',
  'float PFX_lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
  'void main(){',
  '  vec3 rgbM = texture(uTex, vUV).rgb;',
  '  float lM  = PFX_lum(rgbM);',
  '  float lNW = PFX_lum(texture(uTex, vUV + vec2(-1.0, -1.0) * uTexel).rgb);',
  '  float lNE = PFX_lum(texture(uTex, vUV + vec2( 1.0, -1.0) * uTexel).rgb);',
  '  float lSW = PFX_lum(texture(uTex, vUV + vec2(-1.0,  1.0) * uTexel).rgb);',
  '  float lSE = PFX_lum(texture(uTex, vUV + vec2( 1.0,  1.0) * uTexel).rgb);',
  '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
  '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
  '  if (lMax - lMin < max(0.0312, lMax * 0.125)) { oColor = vec4(rgbM, 1.0); return; }',
  '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
  '  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);',
  '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);',
  '  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;',
  '  vec3 rgbA = 0.5 * (texture(uTex, vUV + dir * (1.0 / 3.0 - 0.5)).rgb',
  '                   + texture(uTex, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);',
  '  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uTex, vUV + dir * -0.5).rgb',
  '                                 + texture(uTex, vUV + dir *  0.5).rgb);',
  '  float lB = PFX_lum(rgbB);',
  '  vec3 aa = (lB < lMin || lB > lMax) ? rgbA : rgbB;',
  // Contrast-adaptive sharpening, the same trick every current renderer ends
  // its chain with. The frame has just been antialiased and, below the top
  // quality tier, upscaled — both of which soften it. Sharpening by the LOCAL
  // contrast rather than a flat amount puts the crispness back on edges
  // without turning the grain and the rain into noise.
  '  vec3 n4 = texture(uTex, vUV + vec2(0.0, -1.0) * uTexel).rgb',
  '          + texture(uTex, vUV + vec2(0.0,  1.0) * uTexel).rgb',
  '          + texture(uTex, vUV + vec2(-1.0, 0.0) * uTexel).rgb',
  '          + texture(uTex, vUV + vec2( 1.0, 0.0) * uTexel).rgb;',
  '  vec3 blur = n4 * 0.25;',
  '  float contrast = clamp((lMax - lMin) * 3.0, 0.0, 1.0);',
  '  aa += (aa - blur) * uSharp * contrast;',
  '  oColor = vec4(clamp(aa, 0.0, 1.0), 1.0);',
  '}'
].join('\n');

// ── volumetric light shafts ─────────────────────────────────────────────
// Radial scattering march (the classic Mitchell approach): step from the
// fragment toward the light, accumulating the bright-pass buffer with a
// decaying weight. Run on a quarter-res buffer since shafts are soft.
var PFX_RAYS = PFX_HEAD + [
  '',
  'uniform sampler2D uTex;',
  'uniform vec2  uCenter;',
  'uniform float uDensity;',
  'uniform float uWeight;',
  'uniform float uDecay;',
  'uniform float uGain;',
  'void main(){',
  '  vec2 delta = (vUV - uCenter) * (uDensity / 28.0);',
  '  vec2 uv = vUV;',
  '  float illum = 1.0;',
  '  vec3 acc = vec3(0.0);',
  '  for (int i = 0; i < 28; i++) {',
  '    uv -= delta;',
  '    acc += texture(uTex, uv).rgb * illum * uWeight;',
  '    illum *= uDecay;',
  '  }',
  '  oColor = vec4(acc * uGain, 1.0);',
  '}'
].join('\n');

// ── final composite ─────────────────────────────────────────────────────
var PFX_COMP = PFX_HEAD + [
  '',
  'uniform sampler2D uScene;',
  'uniform sampler2D uBloom;',
  'uniform sampler2D uRays;',
  'uniform sampler2D uHazeTex;',
  'uniform sampler2D uStreak;',
  'uniform float uStreakAmt;',
  'uniform float uRaysAmt;',
  'uniform float uHaze;',
  'uniform vec2  uRes;',
  'uniform float uTime;',
  'uniform float uBloomAmt;',
  'uniform float uDirt;',
  'uniform float uAberr;',
  'uniform float uVignette;',
  'uniform float uGrain;',
  'uniform float uExposure;',
  'uniform float uContrast;',
  'uniform float uSat;',
  'uniform float uDistort;',
  'uniform vec3  uLift;',
  'uniform vec3  uGain;',
  'uniform vec3  uShadowTint;',
  'uniform vec3  uHiTint;',
  'uniform float uFlash;',
  'uniform float uTonemap;',
  '',
  'vec3 aces(vec3 x){',
  '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
  '}',
  'float hash12(vec2 p){',
  '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
  '  p3 += dot(p3, p3.yzx + 33.33);',
  '  return fract((p3.x + p3.y) * p3.z);',
  '}',
  '',
  // Lens dirt. Real glass is never clean, and a bloom that is perfectly even
  // is the clearest sign a frame was computed rather than photographed. These
  // are fixed smudges on the front element: they are invisible until something
  // bright blooms through them, and then they streak.
  'float PFX_dirt(vec2 uv){',
  '  const int N = 7;',
  '  vec3 blob[N];',
  '  blob[0] = vec3(0.18, 0.72, 0.26); blob[1] = vec3(0.74, 0.31, 0.19);',
  '  blob[2] = vec3(0.46, 0.14, 0.30); blob[3] = vec3(0.88, 0.66, 0.15);',
  '  blob[4] = vec3(0.31, 0.49, 0.12); blob[5] = vec3(0.62, 0.84, 0.22);',
  '  blob[6] = vec3(0.08, 0.22, 0.17);',
  '  float d = 0.0;',
  '  for (int i = 0; i < N; i++) {',
  '    vec2 q = (uv - blob[i].xy) / blob[i].z;',
  '    q.y *= 0.55;',                       // smears are wider than they are tall
  '    d += exp(-dot(q, q) * 2.2);',
  '  }',
  '  return clamp(d, 0.0, 1.6);',
  '}',
  '',
  'void main(){',
  '  vec2 uv = vUV;',
  '  vec2 cen = uv - 0.5;',
  '  float r2 = dot(cen, cen);',
  // gentle barrel distortion, like a real lens
  '  uv = 0.5 + cen * (1.0 + uDistort * r2);',
  // refraction: rising steam and blast heat bend whatever is behind them
  '  float haze = texture(uHazeTex, uv).b;',
  '  if (haze > 0.01) {',
  '    float n1 = sin(uv.y * 96.0 + uTime * 3.1) * cos(uv.x * 71.0 - uTime * 2.3);',
  '    float n2 = sin(uv.x * 58.0 + uTime * 1.7);',
  '    uv += vec2(n1, n2 * 0.55) * haze * uHaze;',
  '  }',
  '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { oColor = vec4(0.0,0.0,0.0,1.0); return; }',
  '',
  // radial chromatic aberration: zero at centre, grows to the edges
  '  float ab = uAberr * (0.35 + r2 * 2.0) / max(uRes.x, 1.0);',
  '  vec3 scene;',
  '  scene.r = texture(uScene, uv + cen * ab * 3.2).r;',
  '  scene.g = texture(uScene, uv).g;',
  '  scene.b = texture(uScene, uv - cen * ab * 3.2).b;',
  '  scene = pow(max(scene, 0.0), vec3(2.2));',
  '',
  '  vec3 bloom = texture(uBloom, uv).rgb;',
  '  vec3 col = scene + bloom * uBloomAmt * mix(1.0, 0.55 + PFX_dirt(uv), uDirt);',
  '  col += texture(uRays, uv).rgb * uRaysAmt;',
  '  col += texture(uStreak, uv).rgb * uStreakAmt * vec3(0.55, 0.76, 1.35);',
  '',
  '  col *= uExposure;',
  '  col += uFlash;',                                    // lightning wash
  // The 2D art is already authored to look right on screen, so a full filmic
  // curve just crushes it. Blend the tonemap in instead: highlights roll off,
  // midtones stay where the artist put them.
  '  col = mix(clamp(col, 0.0, 1.0), aces(col), uTonemap);',
  '',
  '  col = pow(max(col, 0.0), vec3(1.0 / 2.2));',        // back to display space
  '',
  // GRADE IN DISPLAY SPACE. This block used to sit above the gamma encode,
  // where every one of its constants meant something other than what it says.
  // The worst was the contrast pivot: 0.5 is mid-grey on a SCREEN, but in
  // linear light mid-grey is ~0.18, so pivoting at 0.5 drove everything below
  // 0.0283 linear negative and clamped it to absolute black — i.e. every pixel
  // darker than 51/255 on screen. In a night game that is nearly the whole
  // frame. Measured, a "contrast" of 1.06 was costing 4.6x the brightness of
  // the entire picture and doubling its blue ratio, because blue was the
  // channel with the most headroom and so the one that survived the crush.
  // Exposure 1.95 and the lifted stone albedo were both compensations for it.
  //
  // Tonemap in linear, grade in display-referred: now a lift of 0.02 is a
  // 5/255 lift, a contrast of 1.06 is 6% more contrast, and the split-toning
  // thresholds land where their numbers suggest.
  // lift / gain, then split toning by luminance
  '  col = clamp(col * uGain + uLift, 0.0, 1.0);',
  '  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));',
  '  col = mix(col * uShadowTint, col * uHiTint, smoothstep(0.15, 0.75, luma));',
  '  col = mix(vec3(luma), col, uSat);',
  '  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);',
  '',
  // Gotham is already near-black; a heavy vignette just eats the playfield.
  '  float vig = smoothstep(0.95, 0.18, r2 * uVignette);',
  '  col *= mix(0.82, 1.0, vig);',
  '',
  '  float n = hash12(gl_FragCoord.xy + vec2(uTime * 311.7, uTime * 173.3));',
  '  col += (n - 0.5) * uGrain;',
  // ordered dither: without it, dark gradients band hard at 8 bits
  '  float d = hash12(gl_FragCoord.xy * 1.7);',
  '  col += (d - 0.5) / 255.0;',
  '',
  '  oColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
  '}'
].join('\n');

var PFX_MIPS = 6;

function PFX_compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader: ' + log);
  }
  return s;
}

function PFX_program(gl, fragSrc) {
  var p = gl.createProgram();
  var v = PFX_compile(gl, gl.VERTEX_SHADER, PFX_VERT);
  var f = PFX_compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('link: ' + log);
  }
  // cache uniform locations
  var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < n; i++) {
    var info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p: p, u: u };
}

function PFX_target(gl, w, h, fmt, type) {
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { tex: t, fbo: f, w: w, h: h };
}

function PostFX(canvas) {
  var gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    // Keeping the drawing buffer costs a readback stall every frame and is only
    // needed when something is capturing frames, so it is opt-in.
    premultipliedAlpha: false, preserveDrawingBuffer: !!window.__capture,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  // half-float render targets keep bloom highlights above 1.0 instead of
  // clipping them, which is what makes the glow read as light not as haze
  var hf = gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float');
  if (!hf) return null;

  var self = {};
  self.gl = gl;
  self.canvas = canvas;
  // w/h is the canvas the chain presents to; iw/ih is the resolution every
  // intermediate buffer is actually rendered at. Splitting the two gives the
  // quality ladder a lever that works: measuring the frame showed the cost is
  // not in any one effect but in the fixed set of full-screen half-float passes,
  // so the only thing that buys back time is shading fewer pixels.
  self.w = 0; self.h = 0;
  self.iw = 0; self.ih = 0; self.scale = 1;
  self.ok = true;

  try {
    self.progLight = PFX_program(gl, PFX_LIGHT);
    self.progBright = PFX_program(gl, PFX_BRIGHT);
    self.progDown = PFX_program(gl, PFX_DOWN);
    self.progUp = PFX_program(gl, PFX_UP);
    self.progRays = PFX_program(gl, PFX_RAYS);
    self.progWet = PFX_program(gl, PFX_WET);
    self.progMerge = PFX_program(gl, PFX_MERGE);
    self.progStreak = PFX_program(gl, PFX_STREAK);
    self.progFxaa = PFX_program(gl, PFX_FXAA);
    self.progApply = PFX_program(gl, PFX_APPLY);
    self.progComp = PFX_program(gl, PFX_COMP);
  } catch (e) {
    self.error = e.message;
    return null;
  }

  function mkTex() {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  self.vao = gl.createVertexArray();      // empty VAO: the triangle is generated in the shader
  self.sceneTex = mkTex();
  self.normalTex = mkTex();
  self.occTex = mkTex();
  self.wetTex = mkTex();
  self.bgTex = mkTex();
  self.lit = null;
  self.rays = null;
  self.wet = null;
  self.bgHalf = null; self.bgQuarter = null; self.merged = null;
  self.streak = null; self.final = null; self.lightBuf = null;
  self.lpBuf = new Float32Array(PFX_MAXL * 4);
  self.lcBuf = new Float32Array(PFX_MAXL * 4);
  self.mips = [];

  self.resize = function (w, h, scale) {
    var s = scale === undefined ? self.scale : Math.max(0.35, Math.min(1, scale));
    var iw = Math.max(1, Math.round(w * s)), ih = Math.max(1, Math.round(h * s));
    if (w === self.w && h === self.h && iw === self.iw && ih === self.ih) return;
    self.w = w; self.h = h; self.scale = s; self.iw = iw; self.ih = ih;
    canvas.width = w; canvas.height = h;
    for (var i = 0; i < self.mips.length; i++) {
      gl.deleteTexture(self.mips[i].tex);
      gl.deleteFramebuffer(self.mips[i].fbo);
    }
    self.mips = [];
    // The mip count has to follow the internal resolution, not be fixed. Each
    // level is accumulated additively, so a chain that bottoms out at a handful
    // of pixels is adding a whole-screen average at full weight - at half scale
    // a fixed six-deep chain washed the entire frame out in pale fog. Stopping
    // around 14px keeps the widest bloom the same size on screen whatever
    // resolution the tier is rendering at.
    var mw = Math.max(1, iw >> 1), mh = Math.max(1, ih >> 1);
    for (var m = 0; m < PFX_MIPS && mw >= 12 && mh >= 8; m++) {
      self.mips.push(PFX_target(gl, mw, mh, gl.RGBA16F, gl.HALF_FLOAT));
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
    if (!self.mips.length) self.mips.push(PFX_target(gl, Math.max(1, iw >> 1), Math.max(1, ih >> 1), gl.RGBA16F, gl.HALF_FLOAT));
    for (const k of ['bgHalf', 'bgQuarter', 'merged']) {
      if (self[k]) { gl.deleteTexture(self[k].tex); gl.deleteFramebuffer(self[k].fbo); }
    }
    // Deliberately sized off the PRESENTED resolution, not the internal one.
    // The depth-of-field blur is a fixed amount of defocus in screen terms, so
    // if these shrink with the tier the backdrop gets blurred four times harder
    // at half scale - which turned Gotham's skyline into flat pale fog even
    // though the frame's average brightness was unchanged.
    self.bgHalf = PFX_target(gl, Math.max(1, w >> 1), Math.max(1, h >> 1), gl.RGBA16F, gl.HALF_FLOAT);
    self.bgQuarter = PFX_target(gl, Math.max(1, w >> 2), Math.max(1, h >> 2), gl.RGBA16F, gl.HALF_FLOAT);
    self.merged = PFX_target(gl, iw, ih, gl.RGBA16F, gl.HALF_FLOAT);
    for (const k2 of ['streak', 'final']) {
      if (self[k2]) { gl.deleteTexture(self[k2].tex); gl.deleteFramebuffer(self[k2].fbo); }
    }
    self.streak = PFX_target(gl, Math.max(1, iw >> 2), Math.max(1, ih >> 2), gl.RGBA16F, gl.HALF_FLOAT);
    self.final = PFX_target(gl, iw, ih, gl.RGBA8, gl.UNSIGNED_BYTE);
    if (self.lightBuf) { gl.deleteTexture(self.lightBuf.tex); gl.deleteFramebuffer(self.lightBuf.fbo); }
    self.lightBuf = PFX_target(gl, Math.max(1, iw >> 1), Math.max(1, ih >> 1), gl.RGBA16F, gl.HALF_FLOAT);
    if (self.wet) { gl.deleteTexture(self.wet.tex); gl.deleteFramebuffer(self.wet.fbo); }
    self.wet = PFX_target(gl, iw, ih, gl.RGBA16F, gl.HALF_FLOAT);
    if (self.rays) { gl.deleteTexture(self.rays.tex); gl.deleteFramebuffer(self.rays.fbo); }
    self.rays = PFX_target(gl, Math.max(1, iw >> 2), Math.max(1, ih >> 2), gl.RGBA16F, gl.HALF_FLOAT);
    if (self.lit) { gl.deleteTexture(self.lit.tex); gl.deleteFramebuffer(self.lit.fbo); }
    // half-float so lights can push past 1.0 and feed the bloom chain
    self.lit = PFX_target(gl, iw, ih, gl.RGBA16F, gl.HALF_FLOAT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // Five 2D canvases are handed to the GPU every frame. texImage2D throws the
  // old texture storage away and allocates new storage each time; once the size
  // has settled - which is every frame but the first, and after a resize -
  // texSubImage2D writes into the storage that is already there.
  var upSize = {};
  function upload(key, tex, src) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    var s = upSize[key];
    if (s && s.w === src.width && s.h === src.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      upSize[key] = { w: src.width, h: src.height };
    }
  }

  function blit(prog, target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : self.w, target ? target.h : self.h);
    gl.useProgram(prog.p);
    gl.bindVertexArray(self.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // params: see PostFX.defaults()
  // source       : the 2D albedo canvas
  // normalSource : the normal buffer canvas (may be null -> lighting skipped)
  // lights       : array of {x,y,z,r, cr,cg,cb, i} in screen-uv space
  self.render = function (source, normalSource, occSource, wetSource, bgSource, lights, prm) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    upload('scene', self.sceneTex, source);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    var srcTex = self.sceneTex;

    // 0a. depth of field: blur the backdrop, then put the sharp foreground on it
    if (bgSource && prm.dof > 0.001) {
      upload('bg', self.bgTex, bgSource);
      gl.useProgram(self.progDown.p);
      gl.uniform1i(self.progDown.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, self.bgTex);
      // the backdrop canvas is drawn at half resolution, so its texel is twice
      // the screen texel - reading the source's own size keeps the 13-tap
      // kernel the right width whatever the caller hands us
      gl.uniform2f(self.progDown.u.uTexel,
        1 / Math.max(1, bgSource.width), 1 / Math.max(1, bgSource.height));
      blit(self.progDown, self.bgHalf);
      gl.bindTexture(gl.TEXTURE_2D, self.bgHalf.tex);
      gl.uniform2f(self.progDown.u.uTexel, 1 / self.bgHalf.w, 1 / self.bgHalf.h);
      blit(self.progDown, self.bgQuarter);

      var mp = self.progMerge;
      gl.useProgram(mp.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, self.bgQuarter.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, self.sceneTex);
      gl.uniform1i(mp.u.uBg, 0);
      gl.uniform1i(mp.u.uFg, 1);
      gl.uniform1f(mp.u.uBgDim, prm.bgDim);
      blit(mp, self.merged);
      srcTex = self.merged.tex;
      gl.activeTexture(gl.TEXTURE0);
    }

    // 0. deferred lighting pass
    if (normalSource && prm.lighting !== false) {
      upload('nrm', self.normalTex, normalSource);
      var castShadows = !!(occSource && prm.shadows !== false);
      if (castShadows) {
        upload('occ', self.occTex, occSource);
      }

      var n = Math.min(lights ? lights.length : 0, PFX_MAXL);
      for (var li = 0; li < n; li++) {
        var L = lights[li], o4 = li * 4;
        self.lpBuf[o4] = L.x; self.lpBuf[o4 + 1] = L.y;
        self.lpBuf[o4 + 2] = L.z; self.lpBuf[o4 + 3] = L.r;
        self.lcBuf[o4] = L.cr; self.lcBuf[o4 + 1] = L.cg;
        self.lcBuf[o4 + 2] = L.cb; self.lcBuf[o4 + 3] = L.i;
      }
      var lp = self.progLight;
      gl.useProgram(lp.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, self.normalTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, self.occTex);
      gl.uniform1i(lp.u.uNrm, 1);
      gl.uniform1i(lp.u.uOcc, 2);
      gl.uniform1i(lp.u.uShadowCount, castShadows ? Math.min(prm.shadowLights, n) : 0);
      gl.uniform1f(lp.u.uShadowStrength, prm.shadowStrength);
      gl.uniform1f(lp.u.uSunShadow, castShadows ? prm.sunShadow : 0.0);
      gl.uniform1f(lp.u.uSunLen, prm.sunLen);
      gl.uniform1f(lp.u.uAO, prm.ao);
      gl.uniform1f(lp.u.uSpec, prm.specular);
      gl.uniform1f(lp.u.uSunSpec, prm.sunSpec);
      gl.uniform3fv(lp.u.uAmbient, prm.ambient);
      gl.uniform1f(lp.u.uAspect, self.w / Math.max(1, self.h));
      gl.uniform1f(lp.u.uNrmStrength, prm.normalStrength);
      gl.uniform1i(lp.u.uCount, n);
      if (lp.u['uLP[0]']) gl.uniform4fv(lp.u['uLP[0]'], self.lpBuf);
      if (lp.u['uLC[0]']) gl.uniform4fv(lp.u['uLC[0]'], self.lcBuf);
      gl.uniform3fv(lp.u.uSunDir, prm.sunDir);
      gl.uniform3fv(lp.u.uSunCol, prm.sunCol);
      blit(lp, self.lightBuf);
      var ap = self.progApply;
      gl.useProgram(ap.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, self.lightBuf.tex);
      gl.uniform1i(ap.u.uAlbedo, 0);
      gl.uniform1i(ap.u.uLight, 1);
      blit(ap, self.lit);
      srcTex = self.lit.tex;
      gl.activeTexture(gl.TEXTURE0);
    }

    // 0b. wet-ground reflections, before bloom so reflected lights glow too
    if (wetSource && prm.wet > 0.001 && srcTex === self.lit.tex) {
      upload('wet', self.wetTex, wetSource);
      var wp = self.progWet;
      gl.useProgram(wp.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, self.wetTex);
      gl.uniform1i(wp.u.uLit, 0);
      gl.uniform1i(wp.u.uWet, 1);
      gl.uniform1f(wp.u.uTime, prm.time);
      gl.uniform1f(wp.u.uStrength, prm.wet);
      gl.uniform1f(wp.u.uFade, prm.wetFade);
      gl.uniform1f(wp.u.uSquash, prm.wetSquash);
      gl.uniform1f(wp.u.uRipple, prm.ripple);
      gl.uniform3fv(wp.u.uTint, prm.wetTint);
      blit(wp, self.wet);
      srcTex = self.wet.tex;
      gl.activeTexture(gl.TEXTURE0);
    }

    // 1. bright pass into mip 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.useProgram(self.progBright.p);
    gl.uniform1i(self.progBright.u.uTex, 0);
    gl.uniform1f(self.progBright.u.uThreshold, prm.threshold);
    gl.uniform1f(self.progBright.u.uKnee, prm.knee);
    gl.uniform1f(self.progBright.u.uWarm, prm.warm);
    blit(self.progBright, self.mips[0]);

    // 2. downsample chain
    gl.useProgram(self.progDown.p);
    gl.uniform1i(self.progDown.u.uTex, 0);
    for (var i = 1; i < self.mips.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, self.mips[i - 1].tex);
      gl.uniform2f(self.progDown.u.uTexel, 1 / self.mips[i - 1].w, 1 / self.mips[i - 1].h);
      blit(self.progDown, self.mips[i]);
    }

    // 3. upsample chain, accumulating additively
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(self.progUp.p);
    gl.uniform1i(self.progUp.u.uTex, 0);
    gl.uniform1f(self.progUp.u.uRadius, prm.radius);
    for (var j = self.mips.length - 1; j > 0; j--) {
      gl.bindTexture(gl.TEXTURE_2D, self.mips[j].tex);
      gl.uniform2f(self.progUp.u.uTexel, 1 / self.mips[j].w, 1 / self.mips[j].h);
      blit(self.progUp, self.mips[j - 1]);
    }
    gl.disable(gl.BLEND);

    // 3b. light shafts, marched from the bright-pass buffer.
    //
    // Several sources now, not just the moon. A single radial scatter centred
    // on the sky gave the frame one soft wash; the thing that actually reads as
    // "light through rain" is a cone under every street lamp, and those are
    // point lights scattered across the shot. The extra centres accumulate
    // additively into the same quarter-resolution buffer, so three sources cost
    // three quarter-res passes rather than anything structural.
    var mid = self.mips[Math.min(1, self.mips.length - 1)];
    if (prm.rays > 0.0001) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mid.tex);
      var rp = self.progRays;
      gl.useProgram(rp.p);
      gl.uniform1i(rp.u.uTex, 0);
      gl.uniform1f(rp.u.uDensity, prm.rayDensity);
      gl.uniform1f(rp.u.uWeight, prm.rayWeight);
      gl.uniform1f(rp.u.uDecay, prm.rayDecay);

      gl.bindFramebuffer(gl.FRAMEBUFFER, self.rays.fbo);
      gl.viewport(0, 0, self.rays.w, self.rays.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(rp.u.uCenter, prm.rayX, prm.rayY);
      gl.uniform1f(rp.u.uGain, 1.0);
      gl.bindVertexArray(self.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      var pts = prm.rayPts;
      if (pts && pts.length) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (var rq = 0; rq + 2 < pts.length; rq += 3) {
          gl.uniform2f(rp.u.uCenter, pts[rq], pts[rq + 1]);
          gl.uniform1f(rp.u.uGain, pts[rq + 2]);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);
      }
    }

    // 3c. anamorphic streak off the bright pass
    if (prm.streak > 0.0001) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mid.tex);
      var sp = self.progStreak;
      gl.useProgram(sp.p);
      gl.uniform1i(sp.u.uTex, 0);
      gl.uniform2f(sp.u.uTexel, 1 / mid.w, 1 / mid.h);
      gl.uniform1f(sp.u.uLen, prm.streakLen);
      blit(sp, self.streak);
    }

    // 4. composite
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, self.mips[0].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, self.rays.tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, self.wetTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, self.streak.tex);
    var c = self.progComp;
    gl.useProgram(c.p);
    gl.uniform1i(c.u.uScene, 0);
    gl.uniform1i(c.u.uBloom, 1);
    gl.uniform1i(c.u.uRays, 2);
    gl.uniform1f(c.u.uRaysAmt, prm.rays);
    gl.uniform1i(c.u.uHazeTex, 3);
    gl.uniform1f(c.u.uHaze, prm.haze);
    gl.uniform1i(c.u.uStreak, 4);
    gl.uniform1f(c.u.uStreakAmt, prm.streak);
    gl.uniform2f(c.u.uRes, self.iw, self.ih);
    gl.uniform1f(c.u.uTime, prm.time);
    gl.uniform1f(c.u.uBloomAmt, prm.bloom);
    gl.uniform1f(c.u.uDirt, prm.dirt);
    gl.uniform1f(c.u.uAberr, prm.aberration);
    gl.uniform1f(c.u.uVignette, prm.vignette);
    gl.uniform1f(c.u.uGrain, prm.grain);
    gl.uniform1f(c.u.uExposure, prm.exposure);
    gl.uniform1f(c.u.uContrast, prm.contrast);
    gl.uniform1f(c.u.uSat, prm.saturation);
    gl.uniform1f(c.u.uDistort, prm.distort);
    gl.uniform1f(c.u.uFlash, prm.flash);
    gl.uniform1f(c.u.uTonemap, prm.tonemap);
    gl.uniform3fv(c.u.uLift, prm.lift);
    gl.uniform3fv(c.u.uGain, prm.gain);
    gl.uniform3fv(c.u.uShadowTint, prm.shadowTint);
    gl.uniform3fv(c.u.uHiTint, prm.hiTint);
    // 5. composite lands in an LDR buffer so FXAA has something to smooth
    blit(c, prm.fxaa ? self.final : null);
    if (prm.fxaa) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, self.final.tex);
      var fp = self.progFxaa;
      gl.useProgram(fp.p);
      gl.uniform1i(fp.u.uTex, 0);
      gl.uniform2f(fp.u.uTexel, 1 / self.iw, 1 / self.ih);
      gl.uniform1f(fp.u.uSharp, prm.sharpen);
      blit(fp, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  };

  return self;
}

// Restraint is the whole game here. The 2D art is already carefully lit and
// coloured; the post chain exists to add glow and lens character, NOT to
// re-grade the scene. An earlier, much heavier set of values turned Gotham
// electric blue and washed the foreground out — everything below is deliberately
// subtle, and readability of the player beats any amount of atmosphere.
PostFX.defaults = function () {
  return {
    // Restraint, pushed further than before. The reference look is almost
    // monochrome: colour survives only in light sources, everything else is
    // separated by value. Saturation at 0.58 is the single biggest lever, and
    // dropping the warm bloom bias from 0.25 to 0.04 is what stops every lamp
    // in the city painting the frame gold.
    threshold: 0.74, knee: 0.22, warm: 0.04, radius: 1.15,
    bloom: 0.24, aberration: 0.30, vignette: 0.72, grain: 0.018,
    // Exposure was at 1.95 to claw brightness back from a contrast pivot that
    // was crushing the frame to black (see the grade block in PFX_APPLY). With
    // that fixed, 1.95 blows the midtones out, so it comes back down and the
    // contrast goes up to where it was always meant to be. Measured across a
    // sweep, this pair gives the brightest readable frame AND the most neutral
    // channel balance — more contrast than this starts re-tinting the picture
    // blue, because blue is the channel with the most headroom in the art.
    exposure: 1.60, contrast: 1.12, saturation: 0.44, distort: 0.008,
    tonemap: 0.40, flash: 0.0, time: 0,
    // Ambient sits high on purpose: the art carries its own baked shading, so
    // the dynamic lights are a highlight layer, not the primary illumination.
    lighting: true, normalStrength: 1.5,
    specular: 0.72, sunSpec: 0.70,
    shadows: true, shadowLights: 3, shadowStrength: 0.92,
    sunShadow: 0.85, sunLen: 0.13,
    // rain-slicked stone: mirror strength, how fast it fades with depth,
    // and a cool tint because the reflection is of a night sky
    wet: 0.5, wetFade: 17.0, wetSquash: 3.6, ripple: 1.0, haze: 0.010,
    dof: 1.0, bgDim: 1.0, ao: 0.42,
    streak: 0.26, streakLen: 2.4, fxaa: true, dirt: 0.55, sharpen: 0.34,
    wetTint: new Float32Array([0.78, 0.86, 1.05]),
    // moon shafts: centre tracks the moon, updated per frame by the game
    rays: 0.34, rayX: 0.70, rayY: 0.86, rayDensity: 0.62, rayWeight: 0.055, rayDecay: 0.93,
    rayPts: [],   // extra scatter centres: x, y, gain triples, filled per frame
    // Near-neutral. A blue-tinted ambient was re-saturating everything the
    // grade had just taken out, so the picture stayed one flat blue.
    ambient: new Float32Array([0.94, 0.96, 1.00]),
    sunDir: new Float32Array([0.38, 0.58, 0.72]),    // moon, upper right (UV space, y up)
    sunCol: new Float32Array([0.30, 0.33, 0.44]),
    // A real camera never reaches pure black, and crushed blacks are the
    // clearest tell of a hobby renderer. Lift them slightly and tint the lift
    // cold; keep the gain neutral so highlights stay white rather than gold.
    // These now act in display space, where 0.013 is a ~3/255 lift rather than
    // the ~43/255 it silently amounted to in linear — the blacks were being
    // lifted into grey AND tinted blue at the same time.
    lift: new Float32Array([0.010, 0.011, 0.013]),
    gain: new Float32Array([0.99, 0.99, 1.01]),
    shadowTint: new Float32Array([0.98, 1.00, 1.03]),
    hiTint: new Float32Array([1.00, 1.00, 1.01]),
  };
};

// Per-level looks — a nudge each, not a repaint.
// Per-level looks. All three are now variations on the same cold steel — the
// old set swung from violet to sickly green to blue, which made the game feel
// like three different games rather than one city at night.
PostFX.grade = function (prm, lvl) {
  if (lvl === 1) {            // rooftops: highest and coldest
    prm.shadowTint.set([0.92, 0.98, 1.12]);
    prm.hiTint.set([0.99, 1.00, 1.04]);
    prm.bloom = 0.26; prm.contrast = 1.14;
  } else if (lvl === 2) {     // Arkham: a faint institutional green in the shadows
    prm.shadowTint.set([0.94, 1.02, 1.04]);
    prm.hiTint.set([1.00, 1.01, 1.00]);
    prm.bloom = 0.22; prm.contrast = 1.13;
  } else {                    // docks: wet and slightly warmer at the horizon
    prm.shadowTint.set([0.95, 0.99, 1.08]);
    prm.hiTint.set([1.02, 1.00, 1.00]);
    prm.bloom = 0.24; prm.contrast = 1.12;
  }
};
