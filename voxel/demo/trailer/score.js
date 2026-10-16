// ═══════════════════════════════════════════════════════════════════════
//  The trailer's score, rendered offline in the browser with the game's own
//  synthesiser (audio.js) plus a few trailer instruments: braams, impacts,
//  risers, whooshes, a heartbeat, toms, a choir pad and a crooked calliope for
//  the Joker. It is written against the edit: 96 bpm, so a bar is 2.5 s and every
//  cut falls on a bar line. The game's sound effects are played back at the times
//  the recorder logged them, the wind follows the glide speed, and footsteps
//  follow the stride.
// ═══════════════════════════════════════════════════════════════════════

var TS = { ctx: null };
var TS_BPM = 96, TS_B = 60 / 96, TS_S16 = 60 / 96 / 4, TS_BAR = 60 / 96 * 4;
function TS_hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function TS_gain(v, to) { const g = TS.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }

// A stereo hall: decaying noise, a little different in each ear.
function TS_impulse(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      lp = lp * 0.55 + x * 0.45;                    // a darker tail than white noise
      d[i] = lp * Math.pow(1 - i / n, decay) * (i < 90 ? i / 90 : 1);
    }
  }
  return b;
}

function TS_env(g, t, a, peak, hold, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
}

// ── trailer instruments ──
function TS_braam(t, root, gain) {
  const c = TS.ctx, out = TS_gain(1, TS.music); out.connect(TS.verbIn);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.setValueAtTime(140, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.35); lp.frequency.exponentialRampToValueAtTime(260, t + 3.2);
  const sh = c.createWaveShaper(); const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * 2.6); } sh.curve = cv;
  const g = c.createGain(); TS_env(g, t, 0.06, gain, 0.6, 3.0);
  sh.connect(lp); lp.connect(g); g.connect(out);
  for (const [m, det] of [[root, -9], [root, 8], [root + 7, -4], [root + 12, 5], [root - 12, 0]]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = TS_hz(m); o.detune.value = det;
    o.frequency.setValueAtTime(TS_hz(m) * 1.012, t); o.frequency.exponentialRampToValueAtTime(TS_hz(m), t + 0.25);
    const og = TS_gain(0.22, sh); o.connect(og); o.start(t); o.stop(t + 4.2);
  }
}
function TS_boom(t, gain) {
  const c = TS.ctx;
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(78, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.6);
  const g = c.createGain(); TS_env(g, t, 0.005, gain, 0.05, 2.4); o.connect(g); g.connect(TS.master); o.start(t); o.stop(t + 2.6);
  const s = c.createBufferSource(); s.buffer = TS.noise; const f = c.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.2);
  const g2 = c.createGain(); TS_env(g2, t, 0.004, gain * 0.7, 0.02, 1.6); s.connect(f); f.connect(g2); g2.connect(TS.master); g2.connect(TS.verbIn);
  s.start(t, 0.3); s.stop(t + 2.0);
}
function TS_riser(t0, t1, gain) {
  const c = TS.ctx, d = t1 - t0;
  const s = c.createBufferSource(); s.buffer = TS.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.2;
  f.frequency.setValueAtTime(250, t0); f.frequency.exponentialRampToValueAtTime(7000, t1);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.03);
  s.connect(f); f.connect(g); g.connect(TS.master); g.connect(TS.verbIn); s.start(t0); s.stop(t1 + 0.1);
  for (const det of [-12, 0, 7]) {
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(TS_hz(50 + det), t0); o.frequency.exponentialRampToValueAtTime(TS_hz(74 + det), t1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t0); lp.frequency.exponentialRampToValueAtTime(5000, t1);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(gain * 0.25, t1 - 0.02); og.gain.linearRampToValueAtTime(0.0001, t1 + 0.02);
    o.connect(lp); lp.connect(og); og.connect(TS.music); o.start(t0); o.stop(t1 + 0.1);
  }
}
function TS_whoosh(t, gain) {
  const c = TS.ctx;
  const s = c.createBufferSource(); s.buffer = TS.noise; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(400, t - 0.3); f.frequency.exponentialRampToValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.35);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t - 0.3); g.gain.exponentialRampToValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  s.connect(f); f.connect(g); g.connect(TS.sfx); s.start(Math.max(0, t - 0.3), 0.7); s.stop(t + 0.45);
}
function TS_heart(t, gain) {
  for (const [dt, k] of [[0, 1], [0.22, 0.7]]) {
    const c = TS.ctx, o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.18);
    const g = c.createGain(); TS_env(g, t + dt, 0.01, gain * k, 0.02, 0.3); o.connect(g); g.connect(TS.music); o.start(t + dt); o.stop(t + dt + 0.4);
  }
}
function TS_tom(t, f, gain) {
  const c = TS.ctx, o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const g = c.createGain(); TS_env(g, t, 0.003, gain, 0.01, 0.45); o.connect(g); g.connect(TS.music); g.connect(TS.verbIn); o.start(t); o.stop(t + 0.55);
  const s = c.createBufferSource(); s.buffer = TS.noise; const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900;
  const g2 = c.createGain(); TS_env(g2, t, 0.002, gain * 0.35, 0.0, 0.08); s.connect(fl); fl.connect(g2); g2.connect(TS.music); s.start(t, Math.random()); s.stop(t + 0.12);
}
function TS_stab(t, freqs, gain) {
  const c = TS.ctx;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(3600, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.45);
  const g = c.createGain(); TS_env(g, t, 0.006, gain, 0.05, 0.6); lp.connect(g); g.connect(TS.music); g.connect(TS.verbIn);
  for (const f of freqs) for (const det of [-10, 10]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(t + 0.8);
  }
}
function TS_choir(t, dur, freqs, gain) {
  const c = TS.ctx;
  for (const f of freqs) for (const det of [-7, 0, 6]) {
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
    const vib = c.createOscillator(); vib.frequency.value = 4.6 + Math.random(); const vg = TS_gain(f * 0.004, o.frequency); vib.connect(vg);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.linearRampToValueAtTime(gain * 0.8, t + dur * 0.85); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    o.connect(bp); bp.connect(g); g.connect(TS.music); g.connect(TS.verbIn);
    o.start(t); vib.start(t); o.stop(t + dur + 0.7); vib.stop(t + dur + 0.7);
  }
}
function TS_bell(t, f, gain) {
  const c = TS.ctx;
  for (const [mul, k, d] of [[1, 1, 1.6], [2.76, 0.35, 0.7], [5.4, 0.18, 0.4]]) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
    const g = c.createGain(); TS_env(g, t, 0.003, gain * k, 0.0, d); o.connect(g); g.connect(TS.music); g.connect(TS.verbIn); o.start(t); o.stop(t + d + 0.1);
  }
}
function TS_calliope(t, f, gain) {
  const c = TS.ctx;
  const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
  const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2.01;
  const vib = c.createOscillator(); vib.frequency.value = 7.5; const vg = TS_gain(f * 0.012, o.frequency); vib.connect(vg);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const g = c.createGain(); TS_env(g, t, 0.01, gain, 0.08, 0.16);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(TS.music); g.connect(TS.verbIn);
  for (const n of [o, o2, vib]) { n.start(t); n.stop(t + 0.35); }
}
function TS_drone(t, dur, gain) {
  const c = TS.ctx;
  for (const [m, type, k] of [[26, 'sawtooth', 1], [33, 'sawtooth', 0.7], [38, 'triangle', 0.6], [50, 'sine', 0.25]]) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = TS_hz(m);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * k, t + dur * 0.35); g.gain.linearRampToValueAtTime(gain * k * 0.8, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(TS.music); o.start(t); o.stop(t + dur + 0.1);
  }
}
function TS_thunder(t, gain) {
  const c = TS.ctx;
  for (const [dt, f0, d, k] of [[0, 900, 0.5, 0.8], [0.15, 400, 2.8, 1], [0.9, 200, 2.6, 0.7]]) {
    const s = c.createBufferSource(); s.buffer = TS.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t + dt); f.frequency.exponentialRampToValueAtTime(70, t + dt + d);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(gain * k, t + dt + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + d);
    s.connect(f); f.connect(g); g.connect(TS.amb); g.connect(TS.verbIn); s.start(t + dt, Math.random()); s.stop(t + dt + d + 0.1);
  }
}
function TS_crash(t, gain) {
  const c = TS.ctx, s = c.createBufferSource(); s.buffer = TS.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
  const g = c.createGain(); TS_env(g, t, 0.003, gain, 0.05, 2.6); s.connect(f); f.connect(g); g.connect(TS.music); g.connect(TS.verbIn); s.start(t, 0.1); s.stop(t + 2.8);
}

// ── the arrangement ──
function TS_arrange(dur, shots, cues) {
  const CH = AU_CHORDS, RT = AU_ROOTS;
  const at = id => { const s = shots.find(x => x.id === id); return s ? s.start : 0; };
  const T = { leap: at('leap'), glide: at('glide'), grapple: at('grapple'), bridge: at('bridge'), brawl: at('brawl'), beacon: at('beacon'),
    penguin: at('penguin'), slam: at('slam'), joker: at('joker'), gas: at('gas'), finale: at('finale'), end: at('end') };
  const logo = T.leap + 2.5;

  // darkness: a drone under the rain, a pad that barely moves, the braam when the signal shows
  TS_drone(0, T.leap + 3, 0.075);
  AU_pad([TS_hz(50), TS_hz(53), TS_hz(57)], 2.5, 7.5, 0.010);
  AU_pad([TS_hz(46), TS_hz(50), TS_hz(53)], 10, 5, 0.012);
  for (let t = 10; t < T.leap; t += TS_BAR / 2) TS_heart(t, 0.32);
  // a held high note for the hero
  { const c = TS.ctx, o = c.createOscillator(); o.type = 'sine'; o.frequency.value = TS_hz(81); const vib = c.createOscillator(); vib.frequency.value = 5; const vg = TS_gain(3, o.frequency); vib.connect(vg);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, 10.2); g.gain.linearRampToValueAtTime(0.03, 12); g.gain.linearRampToValueAtTime(0.0001, T.leap + 2.4); o.connect(g); g.connect(TS.music); g.connect(TS.verbIn); o.start(10.2); vib.start(10.2); o.stop(T.leap + 2.5); vib.stop(T.leap + 2.5); }
  // the logo
  TS_boom(logo, 0.9); TS_braam(logo, 38, 0.55); TS_crash(logo, 0.12);
  AU_pad([TS_hz(50), TS_hz(53), TS_hz(57)], logo, 2.6, 0.016);

  // the glide, the grapple, the districts, the fight: one groove that keeps getting heavier
  const grooveStart = T.glide, grooveEnd = T.beacon;
  for (let t = grooveStart, step = 0; t < grooveEnd - 1e-6; t += TS_S16, step++) {
    const S = step % 16, bar = Math.floor(step / 16), ch = bar % 4;
    const glide = t < T.grapple, grap = t >= T.grapple && t < T.bridge, mont = t >= T.bridge && t < T.brawl, brawl = t >= T.brawl;
    const lvl = glide ? 0.75 : (grap ? 0.85 : (mont ? 1 : 1.1));
    // drums
    if (S === 0 || S === 8 || (mont && S === 6) || (brawl && (S === 3 || S === 6 || S === 11))) AU_drum('kick', t, 0.55 * lvl);
    if (!glide && (S === 4 || S === 12)) AU_drum('snare', t, 0.30 * lvl);
    if (brawl && S === 14) AU_drum('snare', t, 0.12);
    if (S % 2 === 0 || mont || brawl) AU_drum('hat', t, (S % 4 === 2 ? 0.07 : 0.04) * lvl);
    if (grap && bar === Math.floor((T.bridge - grooveStart) / TS_BAR) - 1 && S >= 8) AU_drum('snare', t, 0.08 + 0.02 * (S - 8));   // a fill into the montage
    if (brawl && S >= 13) TS_tom(t, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 110, 90, 72][S], 0.32);
    // bass
    if (S % 2 === 0 || (brawl && S % 4 === 3)) AU_bass(RT[ch] * (S % 8 === 6 ? 2 : 1), t, TS_S16 * 1.8, (0.13 + (brawl ? 0.04 : 0)) * lvl);
    // the plucked line, higher when it gets busy
    if (S % 4 === 2 || (mont && S % 2 === 1 && Math.random() < 0.5)) {
      const tones = [CH[ch][0], CH[ch][1], CH[ch][2], CH[ch][1] * 2];
      AU_pluck(tones[(step >> 1) % 4] * 2, t, 0.06 * lvl);
    }
    // a stab on every cut of the montage, and on the downbeats of the fight
    if (S === 0 && (mont || brawl)) TS_stab(t, CH[ch].map(f => f * 2), 0.06);
    // pads underneath
    if (S === 0) AU_pad(CH[ch], t, TS_BAR, 0.010 * lvl);
  }
  // the beacon: everything drops out but a bright chord and bells climbing
  TS_choir(T.beacon, 2.6, [TS_hz(62), TS_hz(66), TS_hz(69), TS_hz(74)], 0.020);
  [74, 78, 81, 86, 90, 93].forEach((m, i) => TS_bell(T.beacon + 0.25 + i * TS_S16 * 2, TS_hz(m), 0.10));

  // the Penguin: taiko and a low, uneasy ostinato
  const ost = [0, 0, 3, 0, 0, 0, 6, 0, 0, 0, 3, 0, 1, 0, 6, 5];
  for (let t = T.penguin, step = 0; t < T.joker - 1e-6; t += TS_S16, step++) {
    const S = step % 16;
    if ([0, 3, 6, 8, 10, 12, 14].includes(S)) TS_tom(t, [62, 0, 0, 74, 0, 0, 58, 0, 66, 0, 58, 0, 52, 0, 70, 0][S] || 60, 0.42);
    if (S === 0 || S === 8) AU_drum('kick', t, 0.5);
    if (S === 12) AU_drum('snare', t, 0.3);
    AU_bass(TS_hz(38 + ost[S]), t, TS_S16 * 0.9, 0.12);
    if (S === 0 || S === 10) TS_stab(t, [TS_hz(50), TS_hz(53), TS_hz(56)], 0.07);
  }
  // the Joker: a crooked calliope over quieter toms
  const mel = [74, 73, 74, 77, 76, 74, 73, 74, 69, 68, 69, 72, 70, 69, 68, 69, 74, 73, 74, 79, 77, 76, 74, 73, 70, 69, 68, 69, 74, 73, 69, 62];
  for (let t = T.joker, i = 0; t < T.finale - 1e-6; t += TS_B / 2, i++) {
    TS_calliope(t, TS_hz(mel[i % mel.length]), 0.07);
    if (i % 2 === 0) AU_bass(TS_hz([38, 38, 45, 45, 43, 43, 44, 44][(i >> 1) % 8]), t, TS_B * 0.8, 0.13);
    if (i % 4 === 0) { TS_tom(t, 64, 0.36); AU_drum('kick', t, 0.45); }
    if (i % 4 === 2) AU_drum('snare', t, 0.24);
    AU_drum('hat', t, i % 2 ? 0.06 : 0.035);
    if (i % 8 === 0) TS_stab(t, [TS_hz(62), TS_hz(65), TS_hz(68)], 0.05);
  }
  // the finale: the drums stop, a choir rises, then the riser and the last hit
  const fin = T.finale;
  [[0, [50, 53, 57, 62]], [1, [46, 50, 53, 58]], [2, [43, 46, 50, 55]]].forEach(([k, ms]) => TS_choir(fin + k * TS_BAR, TS_BAR + 0.2, ms.map(TS_hz), 0.016));
  for (let t = fin; t < T.end - 1e-6; t += TS_BAR / 2) TS_heart(t, 0.36);
  TS_riser(T.end - 2.5, T.end - 0.02, 0.32);
  TS_boom(T.end, 1.0); TS_braam(T.end, 38, 0.6); TS_crash(T.end, 0.16);
  TS_choir(T.end, 4.5, [TS_hz(50), TS_hz(57), TS_hz(62), TS_hz(65)], 0.016);
  [74, 77, 81, 86].forEach((m, i) => TS_bell(T.end + 1.4 + i * 0.42, TS_hz(m), 0.09));

  // the cues the director left
  for (const c of cues) {
    const t = c.t + (c.v && (c.k === 'thunderFar' || c.k === 'thunderNear' || c.k === 'braam') ? c.v : 0);
    if (c.k === 'thunderFar') TS_thunder(t, 0.32);
    else if (c.k === 'thunderNear') { TS_thunder(t, 0.5); TS_boom(t, 0.25); }
    else if (c.k === 'braam') { TS_braam(t, 38, 0.42); TS_boom(t, 0.4); }
    else if (c.k === 'riser') TS_riser(c.t, c.t + c.v, 0.26);
    else if (c.k === 'whoosh') TS_whoosh(c.t, 0.22);
  }
}

// Render everything and hand back a WAV as base64.
async function TS_render(o) {
  const sr = o.sr || 48000, N = Math.ceil(o.dur * sr);
  const ctx = TS.ctx = new OfflineAudioContext(2, N, sr);
  // glue, then a limiter with make-up gain: a trailer is loud and even
  const master = TS.master = ctx.createGain(); master.gain.value = 1.0;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 2.5; comp.attack.value = 0.01; comp.release.value = 0.3;
  const makeup = ctx.createGain(); makeup.gain.value = 1.45;
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
  master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = TS_impulse(ctx, 3.4, 2.4);
  TS.verbIn = TS_gain(0.32); TS.verbIn.connect(verb); verb.connect(TS_gain(0.55, master));
  // music runs through a filter that closes in slow motion
  const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 18000; mf.Q.value = 0.7; mf.connect(master);
  TS.music = TS_gain(0.85, mf); TS.music.connect(TS.verbIn);
  TS.sfx = TS_gain(0.95, master);
  const sfxVerb = TS_gain(0.14, TS.verbIn); TS.sfx.connect(sfxVerb);
  TS.amb = TS_gain(0.62, master);
  // noise shared by everything
  const nb = ctx.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  TS.noise = nb;
  // hand the game's synth this context
  AU.ctx = ctx; AU.offline = true; AU.muted = false; AU.noise = nb; AU.lastEvt = {}; AU.tOff = 0;
  AU.music = TS.music; AU.sfx = TS.sfx; AU.amb = TS.amb;
  const del = ctx.createDelay(1.0); del.delayTime.value = TS_B * 0.75;
  const fb = TS_gain(0.34, del), dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2000;
  del.connect(dl); dl.connect(fb); dl.connect(TS.music); AU.echo = TS_gain(0.45, del);

  // rain for the whole film: a hiss and a roar, out at the end
  for (const [type, f, q, gain] of [['bandpass', 3400, 0.45, 0.065], ['lowpass', 520, 0.7, 0.045]]) {
    const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(gain, 1.5); g.gain.setValueAtTime(gain, o.dur - 3); g.gain.linearRampToValueAtTime(0.0001, o.dur);
    s.connect(fl); fl.connect(g); g.connect(TS.amb); s.start(0, Math.random()); s.stop(o.dur);
  }
  // wind under the cape, from the recorded glide speed
  { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(400, 0);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, 0);
    let last = -1;
    for (const r of o.tele) {
      const t = r[0], v = r[1];
      if (t - last < 1 / 31) continue; last = t;
      const k = v > 0 ? Math.min(1, (v - 6) / 26) : 0;
      g.gain.linearRampToValueAtTime(k * 0.30, t); bp.frequency.linearRampToValueAtTime(350 + k * 2400, t);
    }
    s.connect(bp); bp.connect(g); g.connect(TS.sfx); s.start(0); s.stop(o.dur); }
  // footsteps: one per half stride, where he was running on the ground
  { let lastPh = null;
    for (const r of o.tele) {
      const [t, gv, ground, sp, ph, speed, sim] = r;
      if (!sim || !ground || sp < 2) { lastPh = null; continue; }
      const k = Math.floor(ph / Math.PI);
      if (lastPh !== null && k !== lastPh) {
        AU.tOff = t; const v = Math.min(1, sp / 11);
        AU_noiseBurst(0.07, 'lowpass', 1500, 400, 0.8, 0.05 + 0.06 * v); AU_noiseBurst(0.12, 'bandpass', 2800, 4200, 0.7, 0.014 + 0.02 * v);
        AU.tOff = 0;
      }
      lastPh = k;
    }
  }
  // slow motion: the music closes down while the world crawls
  { let inSlow = false;
    for (const r of o.tele) {
      const t = r[0], slow = r[5] < 0.9;
      if (slow && !inSlow) { mf.frequency.setValueAtTime(18000, t); mf.frequency.exponentialRampToValueAtTime(650, t + 0.25); TS_whoosh(t + 0.05, 0.25); inSlow = true; }
      if (!slow && inSlow) { mf.frequency.setValueAtTime(650, t); mf.frequency.exponentialRampToValueAtTime(18000, t + 0.35); inSlow = false; }
    } }
  // the music and the director's cues
  const cues = o.ev.filter(e => e.cue);
  TS_arrange(o.dur, o.shots, cues);
  // every sound the game made, where and when it made it
  let n = 0;
  for (const e of o.ev) {
    if (e.cue || e.near <= 0.03) continue;
    const g = TS_gain(Math.min(1, e.near * 1.1), TS.sfx);
    AU.sfx = g; AU.tOff = e.t; AU.lastEvt = {};
    try { AU_event(e.k, { t: e.k, kind: e.kind }); n++; } catch (err) { }
    AU.sfx = TS.sfx; AU.tOff = 0;
  }
  const buf = await ctx.startRendering();
  // peak-normalise to -1 dBFS and write a 16-bit WAV
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0 ? 0.89 / peak : 1;
  const bytes = new Uint8Array(44 + L.length * 4), dv = new DataView(bytes.buffer);
  const wstr = (o2, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o2 + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + L.length * 4, true); wstr(8, 'WAVE'); wstr(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, L.length * 4, true);
  for (let i = 0, p = 44; i < L.length; i++, p += 4) {
    dv.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), true);
    dv.setInt16(p + 2, Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), true);
  }
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { b64: btoa(bin), peak: peak, events: n };
}
