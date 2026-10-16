// ═══════════════════════════════════════════════════════════════════════
//  NOISE — deterministic hashing and value noise. Shared: the same source runs
//  on the main thread and inside the chunk worker, so it must stay free of any
//  window/document reference. Everything is a pure function of its arguments.
// ═══════════════════════════════════════════════════════════════════════

// Three integers in, one well-mixed uint32 out. Used everywhere a "random"
// value is needed, because a world that has to be rebuilt identically in any
// order — chunk by chunk, on any worker — cannot use a stateful generator.
function NZ_hash(a, b, c) {
  let h = Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c | 0, 0x27d4eb2f);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
function NZ_f(a, b, c) { return NZ_hash(a, b, c) / 4294967296; }

// Smooth 2D value noise in [0,1).
function NZ_noise2(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = NZ_f(xi, zi, s), b = NZ_f(xi + 1, zi, s);
  const c = NZ_f(xi, zi + 1, s), d = NZ_f(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal sum, normalised back into [0,1).
function NZ_fbm2(x, z, s, oct) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * NZ_noise2(x * f, z * f, s + i * 31);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function NZ_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function NZ_smooth(a, b, x) { const t = NZ_clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
// positive modulo: the world has negative coordinates, and JS % keeps the sign
function NZ_mod(a, n) { const r = a % n; return r < 0 ? r + n : r; }
