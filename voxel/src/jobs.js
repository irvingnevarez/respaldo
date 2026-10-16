// ═══════════════════════════════════════════════════════════════════════
//  JOBS — the chunk cache that feeds the baker. Shared with the worker.
//
//  A chunk's mesh depends on its eight neighbours (for face culling, AO and lamp
//  rays) and on the mass heights of chunks far beyond that (for moon shadows), so
//  whoever bakes needs those at hand. They are cached here: generated once, kept
//  while recent, and rebuilt on demand if evicted — generation is deterministic,
//  so an evicted chunk simply comes back identical.
// ═══════════════════════════════════════════════════════════════════════

var JB_gen = new Map();
var JB_mass = new Map();
var JB_GEN_CAP = 360;
var JB_MASS_CAP = 6000;

function JB_key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

function JB_getGen(cx, cz) {
  const k = JB_key(cx, cz);
  let g = JB_gen.get(k);
  if (!g) {
    g = WG_genChunk(cx, cz);
    JB_gen.set(k, g);
    if (JB_gen.size > JB_GEN_CAP) {
      // Map iterates in insertion order, so the first keys are the oldest
      let n = JB_gen.size - JB_GEN_CAP;
      for (const key of JB_gen.keys()) { if (n-- <= 0) break; JB_gen.delete(key); }
    }
  }
  return g;
}

function JB_getMass(cx, cz) {
  const k = JB_key(cx, cz);
  let m = JB_mass.get(k);
  if (!m) {
    m = WG_massChunk(cx, cz);
    JB_mass.set(k, m);
    if (JB_mass.size > JB_MASS_CAP) {
      let n = JB_mass.size - JB_MASS_CAP;
      for (const key of JB_mass.keys()) { if (n-- <= 0) break; JB_mass.delete(key); }
    }
  }
  return m;
}

var JB_env = {
  getVox: function (cx, cz) { return JB_getGen(cx, cz).vox; },
  getGen: JB_getGen,
  getMass: JB_getMass,
};

// Bake one chunk to the end and package the result for transfer.
function JB_bakeNow(cx, cz) {
  const it = BX_bake(cx, cz, JB_env);
  let r;
  do { r = it.next(); } while (!r.done);
  return JB_package(cx, cz, r.value);
}

function JB_package(cx, cz, out) {
  const g = JB_getGen(cx, cz);
  return {
    t: 'chunk', cx: cx, cz: cz,
    opaque: out.opaque, water: out.water, emitters: out.emitters,
    vox: g.vox.slice(), top: g.top.slice(), maxY: out.maxY,
  };
}

function JB_transfers(m) {
  return [m.opaque.v.buffer, m.opaque.i.buffer, m.water.v.buffer, m.water.i.buffer, m.vox.buffer, m.top.buffer];
}
