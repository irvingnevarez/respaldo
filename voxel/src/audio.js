// ═══════════════════════════════════════════════════════════════════════
//  AUDIO — everything you hear is synthesised: rain, the city's low drone, wind
//  under the cape, footsteps in puddles, thunder, every punch, and a dark
//  procedural score that thickens as a fight starts.
//
//  There are no sound files. Browsers keep the audio context suspended until the
//  player does something, so nothing is built until the first key or tap; if the
//  context cannot be made, the game simply plays in silence.
// ═══════════════════════════════════════════════════════════════════════

var AU = {
  ctx: null, master: null, sfx: null, music: null, amb: null, echo: null,
  muted: false, noise: null, wind: null, windF: null, rainG: null,
  mood: [1, 0, 0], step: 0, nextT: 0, bar: 0,
  thunderT: 18, flashT: -1, stepPh: 0, lastEvt: {},
};

function AU_init() {
  const go = function () { AU_resume(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  window.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
}

function AU_resume() {
  if (!AU.ctx) AU_build();
  if (AU.ctx && AU.ctx.state === 'suspended') { try { AU.ctx.resume(); } catch (e) { } }
}

function AU_toggle() {
  AU_resume();
  AU.muted = !AU.muted;
  if (AU.master) AU.master.gain.setTargetAtTime(AU.muted ? 0 : 0.7, AU.ctx.currentTime, 0.05);
  UI_hint(AU.muted ? 'Sonido desactivado' : 'Sonido activado', 1.6);
  const b = document.getElementById('tbS'); if (b) b.style.opacity = AU.muted ? '0.45' : '1';
}

function AU_build() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = AU.ctx = new C();
    const g = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
    AU.master = g(AU.muted ? 0 : 0.7, ctx.destination);
    // a gentle limiter so a pile-up of effects cannot clip
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.18;
    comp.connect(AU.master);
    AU.sfx = g(0.9, comp); AU.music = g(0.42, comp); AU.amb = g(1, comp);
    // two seconds of noise, reused everywhere
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AU.noise = nb;
    // an echo for the music: a delay with a darkening feedback
    const del = ctx.createDelay(1.0); del.delayTime.value = 0.43;
    const fb = g(0.38, del), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    del.connect(lp); lp.connect(fb); lp.connect(AU.music);
    AU.echo = g(0.5, del);
    // rain: bright hiss and a low roar under it
    const rain = (type, f, q, gain) => {
      const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
      const f1 = ctx.createBiquadFilter(); f1.type = type; f1.frequency.value = f; f1.Q.value = q;
      s.connect(f1); const gg = g(gain, AU.amb); f1.connect(gg); s.start(0, Math.random()); return gg;
    };
    AU.rainG = rain('bandpass', 3400, 0.45, 0.085);
    rain('lowpass', 520, 0.7, 0.055);
    // the city: a low chord that never quite resolves
    [[55, 'sawtooth', 0.016], [82.4, 'triangle', 0.02], [110.5, 'sine', 0.014], [165.2, 'sine', 0.008]].forEach(function (o, i) {
      const osc = ctx.createOscillator(); osc.type = o[1]; osc.frequency.value = o[0];
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03; const lg = g(60, f.frequency); lfo.connect(lg); lfo.start();
      osc.connect(f); f.connect(g(o[2], AU.amb)); osc.start();
    });
    // wind for the glide: the filter and level follow the speed
    const ws = ctx.createBufferSource(); ws.buffer = nb; ws.loop = true;
    AU.windF = ctx.createBiquadFilter(); AU.windF.type = 'bandpass'; AU.windF.frequency.value = 500; AU.windF.Q.value = 0.8;
    AU.wind = g(0, AU.amb); ws.connect(AU.windF); AU.windF.connect(AU.wind); ws.start(0, 0.5);
    AU.nextT = ctx.currentTime + 0.3;
  } catch (e) { AU.ctx = null; }
}

// ── building blocks ───────────────────────────────────────────────────────
function AU_tone(type, f0, f1, dur, gain, delay, dest, attack) {
  const c = AU.ctx; if (!c) return;
  const t = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || AU.sfx);
  o.start(t); o.stop(t + dur + 0.05);
}
function AU_noiseBurst(dur, ftype, f0, f1, q, gain, delay, dest, attack) {
  const c = AU.ctx; if (!c) return;
  const t = c.currentTime + (delay || 0);
  const s = c.createBufferSource(); s.buffer = AU.noise;
  const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q || 0.8;
  f.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || AU.sfx);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
function AU_pos(x, z) {
  // distance fade for a sound in the world; 1 near the player, 0 far
  const p = GS.player.b, d = Math.hypot(x - p.x, z - p.z);
  return Math.max(0, 1 - d / 60);
}

// ── one-shot effects ──────────────────────────────────────────────────────
function AU_event(k, e) {
  if (!AU.ctx || AU.ctx.state !== 'running' || AU.muted) return;
  // many events can fire together; the same one more than once in 40 ms is one sound
  const now = AU.ctx.currentTime;
  if (AU.lastEvt[k] && now - AU.lastEvt[k] < 0.04) return;
  AU.lastEvt[k] = now;
  const near = (e && e.x !== undefined) ? AU_pos(e.x, e.z) : 1;
  if (near <= 0.02) return;
  switch (k) {
    case 'burn': AU_noiseBurst(0.4, 'bandpass', 1800, 600, 0.9, 0.18); AU_tone('sawtooth', 160, 70, 0.3, 0.12); break;
    case 'jump': AU_noiseBurst(0.22, 'bandpass', 500, 1400, 0.9, 0.06); break;
    case 'land': AU_tone('sine', 120, 50, 0.16, 0.22); AU_noiseBurst(0.12, 'lowpass', 900, 200, 0.8, 0.12); break;
    case 'landHard': AU_tone('sine', 90, 36, 0.34, 0.4); AU_noiseBurst(0.3, 'lowpass', 1200, 120, 0.8, 0.26); break;
    case 'glide': AU_noiseBurst(0.5, 'bandpass', 300, 1800, 0.7, 0.14, 0, null, 0.06); AU_tone('triangle', 180, 320, 0.2, 0.05); break;
    case 'dodge': AU_noiseBurst(0.3, 'bandpass', 700, 300, 0.9, 0.09); break;
    case 'grapple': AU_noiseBurst(0.12, 'highpass', 2500, 5000, 0.8, 0.12); AU_tone('square', 900, 400, 0.08, 0.04); break;
    case 'grappleMiss': AU_noiseBurst(0.25, 'bandpass', 3000, 900, 0.9, 0.06); break;
    case 'grappleHit': AU_tone('square', 300, 140, 0.07, 0.12); AU_noiseBurst(0.05, 'highpass', 4000, 4000, 1, 0.12); break;
    case 'vault': AU_noiseBurst(0.32, 'bandpass', 400, 1600, 0.8, 0.1); break;
    case 'swing': case 'whoosh': AU_noiseBurst(0.18, 'bandpass', 1500, 500, 1.1, 0.10); break;
    case 'hit': {
      const heavy = e && e.kind === 3;
      AU_tone('sine', heavy ? 210 : 170, 55, heavy ? 0.22 : 0.15, heavy ? 0.5 : 0.36);
      AU_noiseBurst(0.1, 'lowpass', 2400, 400, 0.8, heavy ? 0.28 : 0.2);
      AU_tone('square', 520, 260, 0.04, 0.04);
      break;
    }
    case 'throw': AU_tone('sawtooth', 400, 1100, 0.2, 0.06); AU_noiseBurst(0.2, 'bandpass', 2200, 3200, 1.4, 0.07); break;
    case 'batHit': AU_tone('triangle', 1250, 700, 0.22, 0.18); AU_tone('sine', 190, 70, 0.14, 0.25); break;
    case 'clink': AU_tone('triangle', 2300 + Math.random() * 400, 1700, 0.09, 0.07 * near); break;
    case 'hurt': AU_tone('sawtooth', 220, 90, 0.26, 0.2); AU_noiseBurst(0.16, 'lowpass', 1800, 300, 0.8, 0.22); AU_tone('sine', 80, 40, 0.3, 0.3); break;
    case 'die': AU_tone('sawtooth', 200, 40, 0.9, 0.24); AU_tone('sine', 70, 28, 1.1, 0.35); break;
    case 'kill': AU_tone('sine', 130, 50, 0.2, 0.28 * near); AU_noiseBurst(0.12, 'lowpass', 800, 150, 0.8, 0.12 * near); break;
    case 'gun': AU_noiseBurst(0.08, 'highpass', 1800, 900, 0.6, 0.2 * near); AU_tone('sine', 220, 70, 0.09, 0.18 * near); break;
    case 'enemySwing': AU_noiseBurst(0.2, 'bandpass', 900, 350, 1.0, 0.1 * near); break;
    case 'tell': AU_tone('square', 880, 880, 0.07, 0.06 * near); AU_tone('square', 1175, 1175, 0.07, 0.05 * near, 0.08); break;
    case 'alert': AU_tone('square', 520, 780, 0.12, 0.05 * near); break;
    case 'boom': AU_tone('sine', 110, 32, 0.6, 0.55 * near); AU_noiseBurst(0.55, 'lowpass', 2400, 90, 0.7, 0.4 * near); break;
    case 'slamLand': AU_tone('sine', 80, 28, 0.8, 0.7); AU_noiseBurst(0.7, 'lowpass', 2000, 70, 0.7, 0.5); break;
    case 'poof': AU_noiseBurst(0.5, 'bandpass', 900, 200, 0.7, 0.14); AU_tone('triangle', 520, 150, 0.4, 0.06); break;
    case 'pickup': AU_tone('sine', 880, 880, 0.12, 0.12); AU_tone('sine', 1320, 1320, 0.18, 0.1, 0.07); break;
    case 'beacon': [392, 494, 587, 784].forEach(function (f, i) { AU_tone('triangle', f, f, 0.8, 0.12, i * 0.09); }); break;
    case 'cleared': [523, 659, 784].forEach(function (f, i) { AU_tone('triangle', f, f, 0.4, 0.1, i * 0.08); }); break;
    case 'bossStart': AU_tone('sawtooth', 65, 62, 1.6, 0.2, 0, null, 0.3); AU_tone('sawtooth', 98, 92, 1.6, 0.14, 0, null, 0.3); break;
    case 'bossHit': AU_tone('sine', 100, 40, 0.2, 0.3); break;
    case 'bossDown': [440, 330, 262, 196, 147].forEach(function (f, i) { AU_tone('sawtooth', f, f * 0.98, 0.9, 0.1, i * 0.18); }); AU_tone('sine', 70, 28, 1.6, 0.5); break;
    case 'thunder': AU_noiseBurst(2.8, 'lowpass', 500, 60, 0.7, 0.5, 0, null, 0.25); AU_tone('sine', 50, 28, 2.2, 0.3, 0.1, null, 0.2); break;
  }
}

// ── the score ─────────────────────────────────────────────────────────────
// D minor, 84 bpm, sixteenth-note steps. Four layers fade in and out with the mood:
// a pad and a plucked line always, drums and a driving bass when there is a fight.
var AU_CHORDS = [[146.8, 174.6, 220.0], [116.5, 146.8, 174.6], [98.0, 116.5, 146.8], [110.0, 138.6, 164.8]];
var AU_ROOTS = [73.4, 58.3, 49.0, 55.0];
var AU_LINE = [0, 3, 5, 7, 5, 3, 0, -2];             // semitones over the chord root

function AU_pad(freqs, t, dur, gain) {
  const c = AU.ctx;
  for (const f of freqs) for (const det of [-6, 7]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(900, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(300, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(AU.music); o.start(t); o.stop(t + dur + 0.1);
  }
}
function AU_bass(f, t, dur, gain) {
  const c = AU.ctx;
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = f;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(140, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(g); s.connect(g); g.connect(AU.music); o.start(t); s.start(t); o.stop(t + dur + 0.05); s.stop(t + dur + 0.05);
}
function AU_pluck(f, t, gain, send) {
  const c = AU.ctx;
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 2.003;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  const g2 = c.createGain(); g2.gain.value = 0.25;
  o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(AU.music); g.connect(AU.echo);
  o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.6);
}
function AU_drum(kind, t, gain) {
  const c = AU.ctx;
  if (kind === 'kick') {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(AU.music); o.start(t); o.stop(t + 0.32);
  } else {
    const s = c.createBufferSource(); s.buffer = AU.noise;
    const f = c.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1700; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hat' ? 0.05 : 0.17));
    s.connect(f); f.connect(g); g.connect(AU.music); s.start(t, Math.random()); s.stop(t + 0.25);
    if (kind === 'snare') { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.08); const g2 = c.createGain(); g2.gain.setValueAtTime(gain * 0.7, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(g2); g2.connect(AU.music); o.start(t); o.stop(t + 0.14); }
  }
}

function AU_musicStep(t, step, bar) {
  const m = AU.mood, chord = bar % 4, S = step % 16;
  const stepDur = 60 / 84 / 4;
  const combat = Math.min(1, m[1] + m[2]), boss = m[2];
  // the pad: a new chord every bar of four steps of four
  if (S === 0) AU_pad(AU_CHORDS[chord], t, stepDur * 16, 0.016 * (1 - 0.5 * combat));
  // a slow heartbeat in the low register when calm
  if (m[0] > 0.2 && (S === 0 || S === 10)) AU_bass(AU_ROOTS[chord] * 2, t, 0.5, 0.11 * m[0]);
  // a sparse plucked line, higher and busier as it gets tense
  if ((S % 4 === 2 && Math.random() < 0.55 + 0.3 * combat) || (boss > 0.3 && S % 2 === 1)) {
    const semis = AU_LINE[(step >> 1) % AU_LINE.length] + (chord === 1 ? -2 : 0);
    AU_pluck(AU_CHORDS[chord][0] * 2 * Math.pow(2, semis / 12), t, 0.05 + 0.03 * combat);
  }
  if (combat > 0.05) {
    if (S % 4 === 0) AU_drum('kick', t, 0.5 * combat);
    if (S === 4 || S === 12) AU_drum('snare', t, 0.22 * combat);
    if (S % 2 === 0 || boss > 0.4) AU_drum('hat', t, 0.05 * combat + (S % 4 === 2 ? 0.03 : 0));
    // a driving eighth-note bass
    if (S % 2 === 0) AU_bass(AU_ROOTS[chord] * (S % 8 === 6 ? 1.5 : 1), t, stepDur * 1.7, 0.13 * combat);
  }
  if (boss > 0.3 && (S === 0 || S === 6 || S === 10)) {
    for (const f of AU_CHORDS[chord]) { AU_tone('sawtooth', f, f * 0.995, stepDur * 2.2, 0.035 * boss, t - AU.ctx.currentTime); }
  }
}

function AU_update(dt) {
  const c = AU.ctx;
  if (!c || c.state !== 'running') return;
  const pl = GS.player, p = pl.b;
  // mood: calm, a fight nearby, a boss
  let tgt = 0;
  if (GS.boss && !GS.boss.dead) tgt = 2;
  else for (const e of GS.enemies) { if (!e.dead && e.alert && Math.hypot(e.b.x - p.x, e.b.z - p.z) < 30) { tgt = 1; break; } }
  if (VX.state === 'dead') tgt = 0;
  const want = [tgt === 0 ? 1 : 0, tgt === 1 ? 1 : 0, tgt === 2 ? 1 : 0];
  for (let i = 0; i < 3; i++) AU.mood[i] += (want[i] - AU.mood[i]) * Math.min(1, dt * 0.9);
  // schedule the music a little ahead of the clock
  const stepDur = 60 / 84 / 4;
  if (AU.nextT < c.currentTime - 0.5) AU.nextT = c.currentTime + 0.05;
  let guard = 0;
  while (AU.nextT < c.currentTime + 0.22 && guard++ < 8) {
    if (!AU.muted && VX.state !== 'boot') AU_musicStep(AU.nextT, AU.step, AU.bar);
    AU.nextT += stepDur; AU.step++;
    if (AU.step % 16 === 0) AU.bar++;
  }
  // wind under the cape
  if (AU.wind) {
    const gl = pl.mode === 'glide' ? Math.min(1, (pl.gl.v - 6) / 26) : (pl.b.onGround ? 0 : Math.min(0.3, Math.abs(pl.b.vy) / 90));
    AU.wind.gain.setTargetAtTime(gl * 0.34, c.currentTime, 0.1);
    AU.windF.frequency.setTargetAtTime(350 + gl * 2400, c.currentTime, 0.1);
  }
  // rain thins indoors... or rather, under a roof: quieter when something covers the player
  if (AU.rainG) AU.rainG.gain.setTargetAtTime(pl.light && pl.light.sky < 0.4 ? 0.04 : 0.085, c.currentTime, 0.4);
  // footsteps: one per half stride
  if (pl.b.onGround && pl.speedH > 2 && pl.mode === 'ground' && !AU.muted) {
    const ph = Math.floor(pl.st.phase / Math.PI);
    if (ph !== AU.stepPh) {
      AU.stepPh = ph;
      const v = Math.min(1, pl.speedH / 11);
      AU_noiseBurst(0.07, 'lowpass', 1400 + Math.random() * 500, 400, 0.8, 0.05 + 0.06 * v);
      AU_noiseBurst(0.12, 'bandpass', 2800, 4200, 0.7, 0.012 + 0.02 * v);     // a splash of a wet street
      if (v > 0.6) AU_tone('sine', 90, 55, 0.07, 0.08 * v);
    }
  }
  // thunder: a flash, then a rumble a moment after
  AU.thunderT -= dt;
  if (AU.thunderT <= 0) {
    AU.thunderT = 24 + Math.random() * 36;
    AU.flashT = 0; AU.rumble = 0.7 + Math.random() * 1.6;
  }
  if (AU.flashT >= 0) {
    AU.flashT += dt;
    const t = AU.flashT, f = Math.max(0, Math.exp(-t * 9) * (t < 0.12 ? 1 : 0.7)) + Math.max(0, Math.exp(-(t - 0.2) * 12)) * (t > 0.2 ? 0.8 : 0);
    VX.rend.P.flash = Math.min(1, f);
    if (AU.rumble !== undefined && t > AU.rumble) { AU.rumble = undefined; AU_event('thunder', { t: 'thunder' }); }
    if (t > 1.2 && AU.rumble === undefined) { AU.flashT = -1; VX.rend.P.flash = 0; }
  }
}
