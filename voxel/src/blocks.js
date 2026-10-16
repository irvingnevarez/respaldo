// ═══════════════════════════════════════════════════════════════════════
//  BLOCKS — the palette. Shared with the worker.
//
//  Colours are sRGB bytes and deliberately dark and cold: a night city reads
//  through VALUE and a few hot accents (sodium lamps, lit windows, neon), not
//  through saturated albedo. The mesher bakes light into vertices, so these are
//  albedos, and a mid-grey here lands near black on screen under moonlight.
// ═══════════════════════════════════════════════════════════════════════

var BK_FL_WET = 1;     // rain-slicked: picks up fresnel sheen and light streaks
var BK_FL_EMIT = 2;    // self-lit: ignores baked light, feeds the bloom
var BK_FL_TRANS = 4;   // translucent (water): meshed separately
var BK_FL_GLOSS = 8;   // hard glossy surface (glass, ice, metal)
var BK_FL_ANIM = 16;   // shimmers (lava, slime)
var BK_FL_NEON = 32;   // flickers

var BK = {};
var BK_NAMES = [];
var BK_SOLID = new Uint8Array(256);    // stops movement
var BK_OPAQUE = new Uint8Array(256);   // stops light, casts AO
var BK_RGB = new Uint8Array(256 * 3);
var BK_EMIT = new Float32Array(256);   // emissive strength (HDR multiplier)
var BK_FLAGS = new Uint8Array(256);

(function () {
  let next = 0;
  function def(name, r, g, b, flags, emit) {
    const id = next++;
    BK[name] = id; BK_NAMES[id] = name;
    BK_RGB[id * 3] = r; BK_RGB[id * 3 + 1] = g; BK_RGB[id * 3 + 2] = b;
    BK_FLAGS[id] = flags | 0;
    BK_EMIT[id] = emit || 0;
    const trans = (flags & BK_FL_TRANS) !== 0;
    BK_SOLID[id] = (id === 0 || trans) ? 0 : 1;
    BK_OPAQUE[id] = (id === 0 || trans) ? 0 : 1;
    if (emit) BK_FLAGS[id] |= BK_FL_EMIT;
    return id;
  }
  const W = BK_FL_WET, G = BK_FL_GLOSS, T = BK_FL_TRANS, A = BK_FL_ANIM, N = BK_FL_NEON;

  def('AIR', 0, 0, 0, 0);
  // ground and structure
  def('BEDROCK', 18, 20, 26, 0);
  def('STONE', 56, 60, 70, 0);
  def('DIRT', 62, 50, 42, 0);
  def('ASPHALT', 32, 34, 40, W);
  def('ROADLINE', 150, 142, 98, W);
  def('SIDEWALK', 88, 92, 100, W);
  def('CURB', 114, 117, 125, W);
  def('CONCRETE', 104, 108, 116, 0);
  def('CONCRETE_DK', 62, 66, 74, 0);
  def('CONCRETE_LT', 142, 146, 154, 0);
  def('BRICK', 106, 54, 44, 0);
  def('BRICK_DK', 72, 40, 36, 0);
  def('GOTHIC', 68, 72, 84, 0);
  def('GOTHIC_DK', 42, 46, 56, 0);
  def('STEEL', 82, 90, 106, G);
  def('STEEL_DK', 46, 52, 64, G);
  def('RUST', 110, 66, 42, 0);
  def('GLASS', 22, 32, 48, G);
  def('GLASS_BLUE', 36, 58, 86, G);
  def('WIN_WARM', 255, 190, 104, 0, 1.55);
  def('WIN_COOL', 150, 200, 255, 0, 1.45);
  def('WIN_WHITE', 240, 236, 214, 0, 1.5);
  def('ROOF_TAR', 30, 32, 38, 0);
  def('ROOF_GRAVEL', 56, 56, 60, 0);
  def('WATER', 16, 42, 62, T);
  def('SAND', 118, 104, 82, 0);
  def('WOOD', 90, 62, 40, 0);
  def('WOOD_DK', 56, 38, 28, 0);
  def('GRASS', 28, 56, 36, 0);
  def('ICE', 128, 180, 210, G | W);
  def('SNOW', 178, 192, 208, 0);
  def('LAMP_POLE', 28, 32, 40, G);
  def('LAMP_LIGHT', 255, 168, 78, 0, 2.2);
  def('NEON_PINK', 255, 56, 150, N, 2.0);
  def('NEON_CYAN', 56, 220, 255, N, 2.0);
  def('NEON_GREEN', 90, 255, 120, N, 1.9);
  def('NEON_YELLOW', 255, 220, 60, N, 1.9);
  def('NEON_RED', 255, 48, 48, N, 1.9);
  def('NEON_PURPLE', 170, 80, 255, N, 1.9);
  def('LAVA', 255, 96, 24, A, 2.4);
  def('HOT_METAL', 255, 140, 54, A, 1.5);
  def('COPPER', 64, 124, 108, G);
  def('CARN_RED', 188, 30, 40, 0);
  def('CARN_WHITE', 222, 222, 226, 0);
  def('CARN_YELLOW', 232, 188, 40, 0);
  def('CARN_PURPLE', 108, 48, 148, 0);
  def('CARN_TEAL', 36, 150, 150, 0);
  def('CONT_RED', 146, 38, 34, 0);
  def('CONT_BLUE', 38, 66, 128, 0);
  def('CONT_GREEN', 38, 98, 68, 0);
  def('CONT_ORANGE', 186, 98, 38, 0);
  def('CONT_GREY', 98, 104, 112, 0);
  def('HAZ_Y', 232, 198, 30, 0);
  def('HAZ_K', 28, 28, 32, 0);
  def('SEWER_BRICK', 38, 56, 50, W);
  def('SEWER_SLIME', 60, 200, 90, A, 0.9);
  def('SEWER_WATER', 36, 96, 66, T | A);
  def('BRIDGE_DECK', 56, 60, 68, W);
  def('CABLE', 38, 42, 50, G);
  def('SIGNAL', 255, 238, 160, 0, 2.6);
  def('WHITE', 228, 230, 236, 0);
  def('BLACK', 14, 14, 18, 0);
  def('RED', 176, 28, 32, 0);
  def('PURPLE', 86, 46, 118, 0);
  def('GREEN', 58, 146, 68, 0);
  def('GARGOYLE', 52, 56, 66, 0);
  def('SKYLIGHT', 120, 170, 210, G, 0.6);
  def('BEACON_RED', 255, 40, 40, 0, 2.2);
  def('CAR_RED', 150, 28, 30, G);
  def('CAR_BLUE', 34, 60, 120, G);
  def('CAR_WHITE', 190, 192, 198, G);
  def('CAR_BLACK', 22, 24, 28, G);
  def('CAR_YELLOW', 196, 156, 30, G);
  def('HEADLIGHT', 255, 244, 200, 0, 1.6);
  def('TAILLIGHT', 255, 40, 36, 0, 1.4);
  def('HYDRANT', 170, 32, 30, 0);
  def('FROZEN_WATER', 120, 170, 204, G | W);
  def('FURNACE', 70, 40, 34, 0);
  def('GAS', 120, 220, 90, T | A);
  def('LEAVES', 24, 50, 32, 0);
  def('TRUNK', 52, 38, 30, 0);
  def('BENCH', 74, 52, 36, 0);
  def('CRANE', 170, 120, 30, 0);
  def('SNOW_ICE', 170, 196, 218, G);
  def('BOLT', 255, 255, 255, 0, 2.0);
})();

// Convenience predicates for the mesher.
function BK_isSolid(id) { return BK_SOLID[id] === 1; }
