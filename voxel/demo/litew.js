// A world with the same questions as VxWorld (getBlock / isSolid / groundY /
// raycast) but no GPU and no workers: chunks come straight from the generator, on
// demand. It is what the bot tests and the physics tests stand on, so they run in
// milliseconds under plain Node and can step the game any number of frames.
//   const { load, LiteWorld } = require('./litew');
//   const C = load(['noise','blocks','worldgen','jobs','phys','world'], 'WG_genChunk, PH_move, ...');
const loadcore = require('./loadcore');
module.exports.load = function (names, expose, extra) {
  const C = loadcore(names, expose + ', VxWorld, JB_key, BK, BK_SOLID, WG_genChunk, WG_emitters', extra);
  class LiteWorld {
    constructor() { this.chunks = new Map(); }
    chunk(cx, cz) {
      const k = C.JB_key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) { c = C.WG_genChunk(cx, cz); c.cx = cx; c.cz = cz; c.emitters = C.WG_emitters(cx * 16, cz * 16, cx * 16 + 16, cz * 16 + 16); this.chunks.set(k, c); }
      return c;
    }
    getBlock(x, y, z) {
      if (y < 0) return C.BK.BEDROCK;
      if (y >= 128) return 0;
      return this.chunk(x >> 4, z >> 4).vox[((x & 15) * 16 + (z & 15)) * 128 + y];
    }
    isSolid(x, y, z) { return C.BK_SOLID[this.getBlock(x, y, z)] === 1; }
    chunkAt(x, z) { return this.chunk(x >> 4, z >> 4); }
  }
  LiteWorld.prototype.groundY = C.VxWorld.prototype.groundY;
  LiteWorld.prototype.raycast = C.VxWorld.prototype.raycast;
  return { C, LiteWorld };
};
