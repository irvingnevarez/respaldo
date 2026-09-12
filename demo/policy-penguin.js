// ═══════════════════════════════════════════════════════════════════════
//  BOSS POLICY — EL PINGÜINO (level 1-4) and EL JOKER (level 1-8).
//
//  AP_BOSS(g, p, b, tick) -> {L, R, run, jump}, called instead of the normal
//  traversal logic whenever a boss arena is live. A boss arena is 30 columns
//  with no beacon, so "run right" has nothing to aim at — the fight IS the
//  level.
//
//  Both fights are built the same way in bossengine.js: the boss is invulnerable
//  while it is doing something, telegraphs the dangerous move, and opens one
//  punish window. So both policies are the same shape: read the state machine,
//  stay out of the hazards, and be standing on its head during the window.
// ═══════════════════════════════════════════════════════════════════════

var BP_GROUND = 15 * 32;        // walkable floor surface, matches BE_GROUND
var BP_LEFT = 40, BP_RIGHT = 920;
var BP_prevJump = false;
var BP_jf = 0;                  // frames of jump still to hold

function BP_act(L, R, run, jump) {
  // one released frame between jumps so the engine sees a rising edge
  var j = jump && !BP_prevJump ? true : (jump && BP_jf > 0);
  return { L: !!L, R: !!R, run: !!run, jump: !!jump };
}

// Hold a jump for n frames, starting it only on a clean edge.
function BP_jump(n) {
  if (BP_jf <= 0 && !BP_prevJump) BP_jf = n;
}

function BP_emit(L, R, run) {
  var j = false;
  if (BP_jf > 0) { j = true; BP_jf--; }
  var o = { L: !!L, R: !!R, run: !!run, jump: j };
  BP_prevJump = j;
  return o;
}

// Is a floor-level hazard about to reach us? Shockwaves are 40x42 ridges that
// race along the ground; they are jumpable and that is the whole point.
function BP_waveThreat(b, p) {
  for (var i = 0; i < b.waves.length; i++) {
    var w = b.waves[i];
    if (!w.alive) continue;
    var dx = w.rect.cx - p.rect.cx;
    var closing = (dx > 0 && w.dir < 0) || (dx < 0 && w.dir > 0);
    if (closing && Math.abs(dx) < 130) return Math.abs(dx);
  }
  return -1;
}

// A bomb only hurts while its blast is live, and the blast sits on the floor.
function BP_blastNear(b, p) {
  for (var i = 0; i < b.proj.length; i++) {
    var pr = b.proj[i];
    if (!pr.alive) continue;
    if (pr.kind === 'bomb') {
      if (pr.blast > 0 && Math.abs(pr.rect.cx - p.rect.cx) < 78) return true;
      // about to land right on us
      if (pr.blast <= 0 && pr.fuse > 0.55 && Math.abs(pr.rect.cx - p.rect.cx) < 60
        && pr.rect.b > BP_GROUND - 120) return true;
    } else if (Math.abs(pr.rect.cx - p.rect.cx) < 46 &&
      Math.abs(pr.rect.cy - p.rect.cy) < 46) {
      return true;
    }
  }
  return false;
}

// Where the floor is about to be lethal. A bomb's blast is 68px wide, sits on
// the ground and lasts 0.34s — longer than a hop, which is why jumping over one
// does not work: the bot lands back inside it. The only answer is not to be
// there, so blasts (and bombs about to become blasts) become no-go bands that
// the walk logic refuses to cross.
function BP_dangerBands(b) {
  var out = [];
  for (var i = 0; i < b.proj.length; i++) {
    var pr = b.proj[i];
    if (!pr.alive) continue;
    if (pr.kind === 'bomb') {
      if (pr.blast > 0) { out.push(pr.rect.cx); continue; }
      // predict where it lands: vy grows at 900, and it blows on contact
      var t = 0, vy = pr.vy, y = pr.rect.b;
      while (y < BP_GROUND && t < 3) { vy += 900 / 60; y += vy / 60; t += 1 / 60; }
      if (t < 0.85) out.push(pr.rect.cx + pr.vx * t);
    } else {
      out.push(pr.rect.cx);
    }
  }
  return out;
}

function BP_blocked(bands, from, to) {
  var lo = Math.min(from, to) - 26, hi = Math.max(from, to) + 26;
  for (var i = 0; i < bands.length; i++) {
    if (bands[i] > lo && bands[i] < hi) return bands[i];
  }
  return null;
}

// Walk towards an absolute x in the arena. Returns the action, and hops when
// it is being blocked — backing away by "the opposite of wherever the boss is"
// walked straight into the side of a platform and stood there pressing left
// for ten seconds while the fight went on without it.
var BP_blockT = 0;
function BP_goto(p, tx, run, bands) {
  // never walk through a live or imminent blast: stop on our side of it
  if (bands) {
    var hit = BP_blocked(bands, p.rect.cx, tx);
    if (hit !== null) tx = hit > p.rect.cx ? hit - 105 : hit + 105;
  }
  var d = tx - p.rect.cx;
  var moving = Math.abs(p.vx) > 24;
  if (Math.abs(d) > 26 && !moving && p.onGround) BP_blockT++; else BP_blockT = 0;
  if (BP_blockT > 8) { BP_jump(20); BP_blockT = 0; }
  if (Math.abs(d) <= 26) return BP_emit(false, false, false);
  return BP_emit(d < 0, d > 0, !!run && Math.abs(d) > 120);
}

function BP_penguin(g, p, b) {
  var onG = p.onGround;
  var wave = BP_waveThreat(b, p);
  var bands = BP_dangerBands(b);

  // standing inside a band is the emergency: walk out of it, either way
  var here = BP_blocked(bands, p.rect.cx, p.rect.cx);
  if (here !== null && b.state !== 'dazed') {
    var away2 = here > p.rect.cx ? -1 : 1;
    if (p.rect.cx < 150) away2 = 1;
    if (p.rect.cx > 810) away2 = -1;
    return BP_emit(away2 < 0, away2 > 0, true);
  }

  // 1. A shockwave beats everything: it is the only hazard here that is certain
  //    to connect, and clearing it is one well-timed jump.
  if (wave >= 0) {
    if (wave < 100 && onG) BP_jump(20);
    return BP_emit(false, false, false);
  }

  // 2. The punish window: face-down in the floor for 1.6s, long enough to cross
  //    half the arena, so commit hard.
  if (b.state === 'dazed') {
    var d2 = b.rect.cx - p.rect.cx;
    if (Math.abs(d2) > 62) return BP_goto(p, b.rect.cx, true, null);
    if (onG && p.rect.b > b.rect.y + 20) BP_jump(18);
    return BP_emit(d2 < -8, d2 > 8, false);
  }

  // 3. He slams straight down on wherever he is hovering, so the safe place is
  //    simply "not under him" — expressed as an absolute spot in the arena
  //    rather than a direction, so it cannot walk into a wall.
  var mirror = BP_LEFT + BP_RIGHT - b.rect.cx;
  if (mirror < 150) mirror = 150;
  if (mirror > 810) mirror = 810;

  if (b.state === 'telegraph' || b.state === 'slam') {
    return BP_goto(p, mirror, true, bands);
  }
  if (b.state === 'charge') {
    // a phase-3 ground charge has to be jumped, not outrun
    if (Math.abs(b.rect.cx - p.rect.cx) < 210 && onG && b.rect.b > BP_GROUND - 50) BP_jump(22);
    return BP_emit(false, false, false);
  }

  // 4. Hovering: he drifts towards us dropping bombs. Sit at a working distance
  //    — near enough to punish the instant he is dazed, far enough that the
  //    slam does not land on our head — and hop live blasts.
  var stand = b.rect.cx + (b.rect.cx > 480 ? -210 : 210);
  if (stand < 150) stand = 150;
  if (stand > 810) stand = 810;
  return BP_goto(p, stand, false, bands);
}

function AP_BOSS(g, p, b, tick) {
  if (!b || b.defeated) return null;
  if (b.state === 'intro') { BP_jf = 0; return BP_emit(false, false, false); }
  if (b.kind === 'penguin') return BP_penguin(g, p, b);
  if (typeof BJ_joker === 'function') return BJ_joker(g, p, b);
  return null;
}
