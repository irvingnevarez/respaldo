#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  music.js — offline renderer for the Gotham platformer theme.
//
//    node music.js <seconds> <outfile>
//    defaults: 42 seconds, ./theme.wav (next to this file)
//
//  Pure Node: no npm dependencies. Math + fs Buffer only.
//  Output: RIFF/WAVE, 16-bit signed PCM, 44100 Hz, stereo.
//
//  The pitch material is lifted verbatim from AUDIO.tick() in core.js:
//    BASS / ARP tables, 0.155 s step, 16 steps per bar, root = 55 Hz (A1),
//    sawtooth bass on even steps through a lowpass, triangle arp on
//    steps where s % 4 === 2. Everything else here (percussion, sub, bell,
//    pad, reverb, limiter) is the "trailer" dressing around that skeleton.
//
//  Fully deterministic: all noise comes from a fixed-seed LCG, so re-running
//  with the same arguments produces a byte-identical file.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

// ── format ────────────────────────────────────────────────────────────────
const SR = 44100;
const CHANNELS = 2;
const BITS = 16;

// ── sequencer constants (must match core.js AUDIO.tick) ───────────────────
const BASS = [0, 0, 3, 0, 5, 0, 3, 0, -2, 0, 3, 0, 5, 7, 5, 3];
const ARP = [12, 15, 19, 15, 12, 15, 19, 22, 12, 15, 19, 15, 17, 15, 12, 10];
const STEP = 0.155;          // seconds per step
const STEPS_PER_BAR = 16;
const ROOT = 55;             // A1

// ── args ──────────────────────────────────────────────────────────────────
// Both positional args are optional. A first argument that is not a number is
// taken as the outfile, so `node music.js out.wav` writes out.wav instead of
// silently ignoring the name and clobbering the default theme.wav.
const ARG_1 = process.argv[2];
const ARG_2 = process.argv[3];
const ARG_SEC = (typeof ARG_1 === 'string' && /^[0-9]*\.?[0-9]+$/.test(ARG_1))
  ? parseFloat(ARG_1) : NaN;
const SECONDS = Number.isFinite(ARG_SEC) && ARG_SEC > 0.05 ? ARG_SEC : 42;
const OUTFILE = ARG_2 ||
  (Number.isFinite(ARG_SEC) ? null : ARG_1) ||
  path.join(__dirname, 'theme.wav');

const N = Math.floor(SECONDS * SR);           // frames
const L = new Float64Array(N);
const R = new Float64Array(N);
const SEND = new Float64Array(N);             // mono reverb send

// ── deterministic PRNG (LCG, same shape as the in-game noise buffer) ──────
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;              // [0,1)
  };
}
function makeNoise(seed) {
  const r = makeRng(seed);
  return function () { return r() * 2 - 1; };  // [-1,1)
}

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const semi = n => Math.pow(2, n / 12);
// short attack so nothing clicks, exponential-ish decay body
const env = (t, atk, dec) => (1 - Math.exp(-t / atk)) * Math.exp(-t / dec);

function add(i, l, r, send) {
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r;
  if (send) SEND[i] += send;
}

// state-variable (Chamberlin) lowpass — one instance per voice
function makeSVF(res) {
  let low = 0, band = 0;
  const q = clamp(1 / res, 0.05, 2);
  return function (x, cutoff) {
    const f = clamp(2 * Math.sin(Math.PI * clamp(cutoff, 30, SR * 0.42) / SR), 0, 0.99);
    const high = x - low - q * band;
    band += f * high;
    low += f * band;
    // gentle guard against numeric blow-up
    if (!(low > -8 && low < 8)) { low = clamp(low || 0, -8, 8); band = 0; }
    return low;
  };
}
// one-pole highpass, for hats
function makeHP(cut) {
  const a = 1 / (1 + 2 * Math.PI * cut / SR);
  let yPrev = 0, xPrev = 0;
  return function (x) {
    const y = a * (yPrev + x - xPrev);
    yPrev = y; xPrev = x;
    return y;
  };
}
// one-pole lowpass
function makeLP(cut) {
  const a = 1 - Math.exp(-2 * Math.PI * cut / SR);
  let y = 0;
  return function (x) { y += a * (x - y); return y; };
}

const sat = (x, drive) => Math.tanh(x * drive) / Math.tanh(drive);

// ═══════════════════════════════════════════════════════════════════════════
//  VOICES
// ═══════════════════════════════════════════════════════════════════════════

// Bass: sawtooth through a swept SVF lowpass + tanh weight, plus a sub sine
// one octave down. Centred in the stereo field.
function bass(t0, note, vel) {
  const f = ROOT * semi(note);
  const dur = STEP * 1.8;                      // matches core.js decay length
  const len = Math.floor((dur + 0.12) * SR);
  const start = Math.floor(t0 * SR);
  const flt = makeSVF(1.25);
  // The note is still decaying when `len` runs out (the sub tail especially),
  // so taper the last few ms instead of cutting mid-sample — that step was
  // measuring ~0.047 FS at every note-off.
  const rel = Math.max(1, Math.floor(0.012 * SR));
  let ph = 0, sph = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    const e = env(t, 0.004, dur * 0.46);
    // slow cutoff sweep across the whole piece: broods low, opens up late
    const prog = clamp((t0 + t) / SECONDS, 0, 1);
    const sweep = 300 + 760 * Math.pow(prog, 0.85);
    const cut = sweep * (0.55 + 0.85 * e);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1;
    let v = flt(saw, cut);
    v = sat(v * 1.55, 2.1);
    // sub-octave sine for depth on a real speaker
    sph += (f * 0.5) / SR; if (sph >= 1) sph -= 1;
    const sub = Math.sin(2 * Math.PI * sph) * env(t, 0.008, dur * 0.60) * 0.40;
    let s = (v * e * 0.50 + sub) * vel;
    const left = len - i;
    if (left < rel) s *= left / rel;
    add(idx, s, s, s * 0.06);
  }
}

// Arp: triangle, panned slightly left, fed to the reverb.
function arp(t0, note, vel) {
  const f = ROOT * 2 * semi(note);
  const dur = STEP;
  const len = Math.floor((dur + 0.10) * SR);
  const start = Math.floor(t0 * SR);
  const flt = makeLP(5200);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    const e = env(t, 0.005, dur * 0.55);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const tri = 4 * Math.abs(ph - 0.5) - 1;
    const s = flt(tri) * e * 0.26 * vel;
    add(idx, s * 0.68, s * 0.36, s * 0.45);     // pan left
  }
}

// Kick: pitch-dropping sine + a filtered noise thump. Dead centre.
function kick(t0, vel) {
  const len = Math.floor(0.42 * SR);
  const start = Math.floor(t0 * SR);
  const nz = makeNoise(0x4b1c ^ start);
  const lp = makeLP(900);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    const f = 45 + 105 * Math.exp(-t / 0.028);   // 150 Hz -> 45 Hz
    ph += f / SR; if (ph >= 1) ph -= 1;
    const body = Math.sin(2 * Math.PI * ph) * env(t, 0.002, 0.115);
    const click = lp(nz()) * Math.exp(-t / 0.012) * 0.30;
    const s = sat((body + click) * 1.2, 1.6) * 0.62 * vel;
    add(idx, s, s, s * 0.05);
  }
}

// Closed hat: highpassed noise, very short, alternating velocity.
function hat(t0, vel, seed) {
  const len = Math.floor(0.09 * SR);
  const start = Math.floor(t0 * SR);
  const nz = makeNoise(0x9e37 ^ seed);
  const hp = makeHP(6200);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    const e = Math.exp(-t / 0.013) * (1 - Math.exp(-t / 0.0006));
    const s = hp(nz()) * e * 0.15 * vel;
    add(idx, s * 0.46, s * 0.54, s * 0.30);
  }
}

// Low tom, used for the fill at the end of every fourth bar.
function tom(t0, f0, vel) {
  const len = Math.floor(0.35 * SR);
  const start = Math.floor(t0 * SR);
  const nz = makeNoise(0x51ab ^ (start * 7));
  const lp = makeLP(1500);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    const f = f0 * (0.72 + 0.46 * Math.exp(-t / 0.06));
    ph += f / SR; if (ph >= 1) ph -= 1;
    const body = Math.sin(2 * Math.PI * ph) * env(t, 0.002, 0.085);
    const skin = lp(nz()) * Math.exp(-t / 0.030) * 0.35;
    const s = (body + skin) * 0.34 * vel;
    add(idx, s * 0.55, s * 0.45, s * 0.40);
  }
}

// Bell shimmer: four inharmonic partials, long tail, panned right.
function bell(t0, f, vel) {
  const len = Math.floor(2.2 * SR);
  const start = Math.floor(t0 * SR);
  const parts = [[1.0, 1.00], [2.01, 0.42], [3.02, 0.20], [4.98, 0.09]];
  let ph = [0, 0, 0, 0];
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const t = i / SR;
    let v = 0;
    for (let p = 0; p < parts.length; p++) {
      ph[p] += (f * parts[p][0]) / SR; if (ph[p] >= 1) ph[p] -= 1;
      v += Math.sin(2 * Math.PI * ph[p]) * parts[p][1] * Math.exp(-t / (0.95 - p * 0.16));
    }
    const s = v * (1 - Math.exp(-t / 0.004)) * 0.055 * vel;
    add(idx, s * 0.34, s * 0.70, s * 0.85);     // pan right, heavy into reverb
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ARRANGEMENT
// ═══════════════════════════════════════════════════════════════════════════

const totalSteps = Math.ceil(SECONDS / STEP) + 1;
const rngHat = makeRng(0xBA7CAF);

for (let n = 0; n < totalSteps; n++) {
  const t0 = n * STEP;
  if (t0 >= SECONDS) break;
  const s = n % STEPS_PER_BAR;
  const bar = Math.floor(n / STEPS_PER_BAR);
  const prog = clamp(t0 / SECONDS, 0, 1);

  // ── bass on even steps (core.js rule) ──
  if (s % 2 === 0) {
    const accent = (s === 0) ? 1.0 : (s === 8 ? 0.94 : 0.82);
    bass(t0, BASS[s], accent * (0.80 + 0.20 * Math.min(1, bar / 3)));
  }

  // ── arp on steps where s % 4 === 2 (core.js rule) ──
  if (s % 4 === 2) {
    arp(t0, ARP[s], 0.85 + 0.15 * Math.sin(bar * 1.1));
  }

  // ── drums: kit enters at bar 2 so the intro broods ──
  if (bar >= 2) {
    if (s === 0) kick(t0, 1.0);
    if (s === 8) kick(t0, 0.88);
    if (bar >= 3 && s === 11) kick(t0, 0.55);     // ghost push
    if (s % 2 === 1) {
      const v = 0.55 + 0.45 * rngHat();            // deterministic velocity drift
      hat(t0, (s === 7 || s === 15) ? v * 1.25 : v, n * 2654435761 >>> 0);
    }
    // low tom fill across the last four steps of every fourth bar
    if (bar % 4 === 3 && s >= 12) {
      const pitches = [132, 116, 100, 86];
      tom(t0, pitches[s - 12], 0.75 + 0.25 * (s - 12) / 3);
    }
  }

  // ── bell shimmer enters after the first four bars, sparse ──
  if (bar >= 4) {
    if (s === 6) bell(t0, ROOT * 4 * semi(ARP[s]), 0.9 + 0.4 * prog);
    if (bar % 2 === 1 && s === 13) bell(t0, ROOT * 8 * semi(ARP[s] - 12), 0.6);
  }
}

// ── sustained high pad (A minor), fading in over bars 4-6 ──────────────────
{
  const padFreqs = [220.00, 261.63, 329.63, 440.00];   // A3 C4 E4 A4
  const phs = padFreqs.map(() => 0);
  const phs2 = padFreqs.map(() => 0.37);
  const lpL = makeLP(1800), lpR = makeLP(1800);
  const padStart = 4 * STEPS_PER_BAR * STEP;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (t < padStart) continue;
    const in_ = clamp((t - padStart) / (2 * STEPS_PER_BAR * STEP), 0, 1);
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.055 * t);
    let a = 0, b = 0;
    for (let k = 0; k < padFreqs.length; k++) {
      const f = padFreqs[k];
      phs[k] += f / SR; if (phs[k] >= 1) phs[k] -= 1;
      phs2[k] += (f * 1.0035) / SR; if (phs2[k] >= 1) phs2[k] -= 1;   // detune
      const w = k === 3 ? 0.45 : 1;
      a += (4 * Math.abs(phs[k] - 0.5) - 1) * w;
      b += (4 * Math.abs(phs2[k] - 0.5) - 1) * w;
    }
    const g = 0.030 * in_ * (0.55 + 0.45 * lfo);
    const sl = lpL(a) * g, sr = lpR(b) * g;
    add(i, sl, sr, (sl + sr) * 0.28);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  REVERB — Freeverb-style: 6 damped combs in parallel into 4 allpasses,
//  per channel, fed from the dedicated mono SEND bus.
// ═══════════════════════════════════════════════════════════════════════════
function comb(src, dst, delay, fb, damp) {
  const buf = new Float64Array(delay);
  let p = 0, store = 0;
  for (let i = 0; i < src.length; i++) {
    const y = buf[p];
    dst[i] += y;
    store = y * (1 - damp) + store * damp;
    buf[p] = src[i] + store * fb;
    if (++p === delay) p = 0;
  }
}
function allpass(io, delay, fb) {
  const buf = new Float64Array(delay);
  let p = 0;
  for (let i = 0; i < io.length; i++) {
    const bufOut = buf[p];
    const out = -io[i] + bufOut;
    buf[p] = io[i] + bufOut * fb;
    io[i] = out;
    if (++p === delay) p = 0;
  }
}

{
  // Freeverb-style tunings, already expressed in samples at 44100 Hz.
  const combsL = [1116, 1188, 1277, 1356, 1422, 1557];
  const combsR = combsL.map(d => d + 23);      // stereo spread
  const apsL = [556, 441, 341, 225];
  const apsR = apsL.map(d => d + 23);

  const wetL = new Float64Array(N);
  const wetR = new Float64Array(N);
  for (const d of combsL) comb(SEND, wetL, d, 0.79, 0.28);
  for (const d of combsR) comb(SEND, wetR, d, 0.78, 0.31);
  for (const d of apsL) allpass(wetL, d, 0.5);
  for (const d of apsR) allpass(wetR, d, 0.5);

  const MIX = 0.085;                 // mixed low, just a tail
  for (let i = 0; i < N; i++) {
    L[i] += wetL[i] * MIX;
    R[i] += wetR[i] * MIX;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DC BLOCKER + FADES + LIMITER
// ═══════════════════════════════════════════════════════════════════════════
// The pitch-dropping kick and the gated lowpassed bass each leave a small
// offset; strip it at ~8 Hz so the offset does not eat headroom.
{
  const a = 1 - 2 * Math.PI * 8 / SR;
  let xl = 0, yl = 0, xr = 0, yr = 0;
  for (let i = 0; i < N; i++) {
    const il = L[i], ir = R[i];
    yl = il - xl + a * yl; xl = il; L[i] = yl;
    yr = ir - xr + a * yr; xr = ir; R[i] = yr;
  }
}

// Clamp the fade windows to the clip length. On a short render the 0.4 s and
// 1.5 s windows would otherwise overlap and multiply together across the whole
// file — a 1 s render peaked at only 0.21 FS before this guard.
const FADE_IN = Math.max(1, Math.min(Math.floor(0.4 * SR), Math.floor(N * 0.25)));
const FADE_OUT = Math.max(1, Math.min(Math.floor(1.5 * SR), Math.floor(N * 0.5)));
for (let i = 0; i < N; i++) {
  let g = 1;
  if (i < FADE_IN) g *= i / FADE_IN;
  const tail = N - 1 - i;
  if (tail < FADE_OUT) g *= tail / FADE_OUT;
  L[i] *= g; R[i] *= g;
}

// soft-knee saturation catches stray transients, then a flat peak scale.
for (let i = 0; i < N; i++) {
  if (Math.abs(L[i]) > 0.7) L[i] = Math.sign(L[i]) * (0.7 + 0.3 * Math.tanh((Math.abs(L[i]) - 0.7) / 0.3));
  if (Math.abs(R[i]) > 0.7) R[i] = Math.sign(R[i]) * (0.7 + 0.3 * Math.tanh((Math.abs(R[i]) - 0.7) / 0.3));
}

let peak = 0;
for (let i = 0; i < N; i++) {
  const a = Math.abs(L[i]); if (a > peak) peak = a;
  const b = Math.abs(R[i]); if (b > peak) peak = b;
}
const CEIL = 0.95;
const gain = peak > CEIL ? CEIL / peak : 1;
if (gain !== 1) for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; }

let finalPeak = 0;
for (let i = 0; i < N; i++) {
  const a = Math.abs(L[i]); if (a > finalPeak) finalPeak = a;
  const b = Math.abs(R[i]); if (b > finalPeak) finalPeak = b;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WAV OUT — 44-byte header written by hand
// ═══════════════════════════════════════════════════════════════════════════
const blockAlign = CHANNELS * (BITS / 8);
const dataLen = N * blockAlign;

const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + dataLen, 4);       // RIFF chunk size
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16);                // fmt chunk size (PCM)
header.writeUInt16LE(1, 20);                 // audioFormat = PCM
header.writeUInt16LE(CHANNELS, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * blockAlign, 28);   // byte rate
header.writeUInt16LE(blockAlign, 32);
header.writeUInt16LE(BITS, 34);
header.write('data', 36, 'ascii');
header.writeUInt32LE(dataLen, 40);

const data = Buffer.alloc(dataLen);
let maxInt = 0;
for (let i = 0; i < N; i++) {
  let l = Math.round(clamp(L[i], -1, 1) * 32767);
  let r = Math.round(clamp(R[i], -1, 1) * 32767);
  l = clamp(l, -32767, 32767);
  r = clamp(r, -32767, 32767);
  if (Math.abs(l) > maxInt) maxInt = Math.abs(l);
  if (Math.abs(r) > maxInt) maxInt = Math.abs(r);
  data.writeInt16LE(l, i * 4);
  data.writeInt16LE(r, i * 4 + 2);
}

fs.writeFileSync(OUTFILE, Buffer.concat([header, data]));

const db = 20 * Math.log10(finalPeak || 1e-9);
console.log('wrote      ' + OUTFILE);
console.log('duration   ' + (N / SR).toFixed(3) + ' s  (' + N + ' frames)');
console.log('format     ' + SR + ' Hz, ' + CHANNELS + ' ch, ' + BITS + '-bit PCM, ' +
  (44 + dataLen) + ' bytes');
console.log('peak       ' + finalPeak.toFixed(4) + ' FS  (' + db.toFixed(2) + ' dBFS)  ' +
  'pre-limit ' + peak.toFixed(4) + (gain !== 1 ? '  [limited x' + gain.toFixed(4) + ']' : '  [no limiting needed]'));
console.log('max int16  ' + maxInt + ' / 32767  (no wrap)');
