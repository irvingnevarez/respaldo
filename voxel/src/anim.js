// ═══════════════════════════════════════════════════════════════════════
//  ANIM — turns a few smoothed numbers into the pose of a humanoid.
//
//  The controller never sets an angle. It keeps blend weights (how much is this
//  body walking, airborne, gliding, punching) and this file turns them into joint
//  rotations. Because every input is a weight that eases in and out, no pose ever
//  pops. Rotation conventions, for a part hanging BELOW its joint:
//     rx < 0 swings it forward, rx > 0 swings it back; rz > 0 swings the +x limb out.
//  and for the torso (which stands ABOVE its joint) rx > 0 leans it forward.
// ═══════════════════════════════════════════════════════════════════════

function AN_state() {
  return {
    t: 0, phase: 0, walk: 0, sprint: 0, air: 0, vy: 0, glide: 0, gth: 0.2, swim: 0, land: 0,
    atk: 0, atkP: 0, grap: 0, grapPitch: 0, hurt: 0, dead: 0, aim: 0, aimPitch: 0, stun: 0,
    dodge: 0, dodgeAng: 0, wingFlap: 0, crouch: 0,
    cape: new Float32Array(8),
  };
}

function AN_lerp(a, b, t) { return a + (b - a) * t; }
function AN_clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// 0..1 extension of a strike over its progress: a short wind-up (a little negative),
// a fast strike, a slower recovery.
function AN_strike(p) {
  if (p < 0.26) return -0.28 * (p / 0.26);
  if (p < 0.46) { const q = (p - 0.26) / 0.20; return -0.28 + 1.28 * q * (2 - q); }
  const q = (p - 0.46) / 0.54;
  return 1 - q * q * (3 - 2 * q);
}

// Spring chain for the four cape strips. `fwd` is the speed the body moves along its
// facing, `vy` the vertical speed, `g` the glide blend.
function AN_capeStep(st, dt, fwd, vy, g) {
  const C = st.cape;
  dt = Math.min(dt, 1 / 30);
  const run = AN_clamp(fwd * 0.050, -0.2, 0.85);
  const fall = AN_clamp(-vy * 0.045, -0.35, 1.1);
  const total = 0.10 + run * (1 - g) + fall * (1 - g * 0.6) + g * 0.30;
  let lag = 0;
  for (let i = 0; i < 4; i++) {
    const wave = Math.sin(st.t * (2.0 + 2.4 * g) + i * 0.9) * (0.05 + 0.10 * g + 0.04 * run);
    const target = total / 4 * (0.85 + 0.1 * i) + wave + lag * 0.35;
    const k = 70, d = 9;
    const acc = k * (target - C[i]) - d * C[4 + i];
    C[4 + i] += acc * dt;
    C[i] += C[4 + i] * dt;
    C[i] = AN_clamp(C[i], -0.9, 1.35);
    lag = C[i] - target;
  }
}

// Fill `P` (6 numbers per part) for a humanoid model. Works for Batman (which has a
// cape and wings) and for the thugs (which do not): parts that are missing are
// skipped by index.
function AN_humanoid(M, P, st) {
  P.fill(0);
  const o = i => i * 6;
  const T = o(MD_TORSO), H = o(MD_HEAD), AL = o(MD_ARML), AR = o(MD_ARMR), LL = o(MD_LEGL), LR = o(MD_LEGR);
  const w = st.walk, sp = st.sprint, s = Math.sin(st.phase), c = Math.cos(st.phase);
  const A = w * (0.58 + 0.42 * sp);

  // ── walking / idle ──
  P[LL] = -s * A; P[LR] = s * A;
  P[AL] = s * A * 0.85; P[AR] = -s * A * 0.85;
  P[AL + 2] = 0.07; P[AR + 2] = -0.07;
  P[T] = 0.05 * w + 0.26 * sp * w;                               // lean into the run
  P[T + 1] = s * 0.12 * A;
  P[T + 4] = (Math.abs(c) - 0.6) * 0.8 * w;                      // bob, in voxels
  P[H] = -P[T] * 0.7; P[H + 1] = -P[T + 1] * 1.2;
  const br = Math.sin(st.t * 2.2) * (1 - w);
  P[T + 4] += br * 0.16; P[AL + 2] += br * 0.03; P[AR + 2] -= br * 0.03;

  // ── airborne: a rising pose that opens into a falling one ──
  const a = st.air * (1 - st.glide);
  if (a > 0.001) {
    const f = AN_clamp(-st.vy / 12, 0, 1);
    const lL = AN_lerp(-0.85, -0.25, f), lR = AN_lerp(0.45, 0.20, f);
    const aL = AN_lerp(-1.15, -0.2, f), aR = AN_lerp(-0.55, -0.2, f);
    P[LL] = AN_lerp(P[LL], lL, a); P[LR] = AN_lerp(P[LR], lR, a);
    P[AL] = AN_lerp(P[AL], aL, a); P[AR] = AN_lerp(P[AR], aR, a);
    P[AL + 2] = AN_lerp(P[AL + 2], AN_lerp(0.35, 1.0, f), a); P[AR + 2] = AN_lerp(P[AR + 2], -AN_lerp(0.35, 1.0, f), a);
    P[LL + 2] = 0.10 * a * f; P[LR + 2] = -0.10 * a * f;
    P[T] = AN_lerp(P[T], 0.10, a); P[H] = AN_lerp(P[H], -0.05, a);
  }

  // ── swimming: prone, kicking ──
  if (st.swim > 0.001) {
    const k = st.swim, sw = Math.sin(st.phase * 0.7);
    P[T] = AN_lerp(P[T], 1.2, k); P[H] = AN_lerp(P[H], -0.9, k);
    P[LL] = AN_lerp(P[LL], sw * 0.4, k); P[LR] = AN_lerp(P[LR], -sw * 0.4, k);
    P[AL] = AN_lerp(P[AL], -2.2 + sw * 0.5, k); P[AR] = AN_lerp(P[AR], -2.2 - sw * 0.5, k);
  }

  // ── gliding: horizontal, arms along the leading edge of the opened cape ──
  const g = st.glide;
  const caped = !!M.caped;
  if (caped) { P[o(MD_CAPE0 + 4) + 5] = 999; P[o(MD_CAPE0 + 5) + 5] = 999; }     // wings parked until needed
  if (g > 0.001) {
    P[T] = AN_lerp(P[T], 1.34 + st.gth * 0.8, g);
    P[H] = AN_lerp(P[H], -(1.0 + st.gth * 0.6), g);
    P[T + 4] = AN_lerp(P[T + 4], 0, g);
    P[AL] = AN_lerp(P[AL], 0, g); P[AR] = AN_lerp(P[AR], 0, g);
    P[AL + 2] = AN_lerp(P[AL + 2], 1.22, g); P[AR + 2] = AN_lerp(P[AR + 2], -1.22, g);
    P[LL] = AN_lerp(P[LL], 0.10, g); P[LR] = AN_lerp(P[LR], 0.02, g);
    P[LL + 2] = 0.05 * g; P[LR + 2] = -0.05 * g;
    const fl = Math.sin(st.t * 13) * 0.025 * g;
    const WL = o(MD_CAPE0 + 4), WR = o(MD_CAPE0 + 5);
    if (caped && g > 0.15) {
      P[WL + 5] = 0; P[WR + 5] = 0;
      const open = AN_clamp((g - 0.15) / 0.5, 0, 1);
      P[WL + 2] = -0.38 * open + fl - (1 - open) * 1.2; P[WR + 2] = 0.38 * open - fl + (1 - open) * 1.2;
    }
  }

  // ── landing crouch ──
  if (st.land > 0.001) {
    P[T + 4] -= 3.4 * st.land;
    P[LL] += -0.55 * st.land; P[LR] += 0.65 * st.land;
    P[T] += 0.25 * st.land;
  }

  // ── attacks ──
  if (st.atk) {
    const e = AN_strike(st.atkP);
    switch (st.atk) {
      case 1:                                                      // jab, right arm
        P[AR] = -1.58 * e; P[T + 1] = 0.40 * e; P[LL] += -0.55 * e; P[LR] += 0.45 * e; P[AL] = 0.5 * e; P[AL + 2] = 0.2;
        break;
      case 2:                                                      // hook, left arm
        P[AL] = -1.45 * e; P[AL + 2] = 0.55 * e + 0.07; P[T + 1] = -0.55 * e; P[LR] += -0.55 * e; P[LL] += 0.45 * e; P[AR] = 0.4 * e;
        break;
      case 3:                                                      // kick
        P[LR] = -1.65 * e; P[T] -= 0.30 * e; P[LL] += 0.20 * e;
        P[AL + 2] += 0.65 * e; P[AR + 2] -= 0.65 * e;
        break;
      case 4:                                                      // throw over the shoulder
        P[AR] = -2.1 * e; P[T + 1] = 0.30 * e; P[AR + 2] = -0.25 * e; P[AL] = 0.4 * e;
        break;
      case 5:                                                      // both fists down (slam)
        P[AL] = -3.0 + 2.6 * e; P[AR] = -3.0 + 2.6 * e; P[T] += 0.5 * e;
        break;
    }
  }

  // ── grapple: the right arm points at the anchor ──
  if (st.grap > 0.001) {
    const k = st.grap;
    P[AR] = AN_lerp(P[AR], -(1.5708 + AN_clamp(st.grapPitch, -0.5, 1.1)), k);
    P[AR + 2] = AN_lerp(P[AR + 2], -0.1, k);
    P[T] = AN_lerp(P[T], 0.30, k);
  }

  // ── ranged stance: gun arm forward ──
  if (st.aim > 0.001) {
    P[AR] = AN_lerp(P[AR], -1.45 - st.aimPitch, st.aim);
    P[T + 1] = AN_lerp(P[T + 1], 0.35, st.aim);
  }

  // ── dodge roll: tucked, pitched all the way over ──
  if (st.dodge > 0.001) {
    P[T] = st.dodgeAng; P[T + 4] = -2.0;
    P[LL] = -1.75; P[LR] = -1.75; P[AL] = -1.6; P[AR] = -1.6; P[H] = -0.2;
  }

  // ── hurt, dazed ──
  if (st.hurt > 0.001) { P[T] -= 0.55 * st.hurt; P[H] -= 0.35 * st.hurt; P[AL + 2] += 0.5 * st.hurt; P[AR + 2] -= 0.5 * st.hurt; }
  if (st.stun > 0.001) { P[H + 1] = Math.sin(st.t * 17) * 0.45 * st.stun; P[T] += 0.25 * st.stun; P[AL] = 0; P[AR] = 0; }

  // ── cape ──
  if (caped) for (let i = 0; i < 4; i++) P[o(MD_CAPE0 + i)] = st.cape[i];

  // ── dead: topples backwards and lies on the ground ──
  if (st.dead > 0.001) {
    const d = st.dead;
    P[T] = AN_lerp(P[T], -1.50, d); P[T + 4] = AN_lerp(P[T + 4], -7.6, d);
    P[AL + 2] = AN_lerp(P[AL + 2], 0.7, d); P[AR + 2] = AN_lerp(P[AR + 2], -0.7, d);
    P[LL] = AN_lerp(P[LL], 0, d); P[LR] = AN_lerp(P[LR], 0, d);
  }
  return P;
}
