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

// The arena has waist-high platforms at both ends. Walking into the side of
// one and holding the button is indistinguishable, from the policy's point of
// view, from walking freely — and the bot spent whole phases pinned against a
// platform edge while bombs landed on it. So the check lives here, in the one
// place every branch goes through: pressing a direction and not moving means
// jump, and if that does not help, give up on that direction.
var BP_stuck = 0, BP_flip = 0, BP_lastP = null;
var BP_dir = 1, BP_run = true;   // held through an arc
function BP_emit(L, R, run) {
  var p = BP_lastP;
  // Reset while airborne. Leaving the counter latched there was a self-feeding
  // loop: being stuck triggered a jump, the jump made us airborne, airborne
  // never cleared the counter, so it jumped again — forever, on the spot.
  if (!p || !p.onGround) BP_stuck = 0;
  else if ((L || R) && Math.abs(p.vx) < 22) BP_stuck++;
  else BP_stuck = 0;
  if (BP_stuck > 7) {
    BP_jump(21);
    if (BP_stuck > 26) { BP_flip = 40; BP_stuck = 0; }
  }
  if (BP_flip > 0) { BP_flip--; var t0 = L; L = R; R = t0; }
  var j = false;
  if (BP_jf > 0) { j = true; BP_jf--; }
  var o = { L: !!L, R: !!R, run: !!run, jump: j };
  BP_prevJump = j;
  return o;
}

// Is a floor-level hazard about to reach us? Shockwaves are 40x42 ridges that
// race along the ground; they are jumpable and that is the whole point.
function BP_waveThreat(b, p) {
  var best = null;
  for (var i = 0; i < b.waves.length; i++) {
    var w = b.waves[i];
    if (!w.alive) continue;
    var dx = w.rect.cx - p.rect.cx;
    var closing = (dx > 0 && w.dir < 0) || (dx < 0 && w.dir > 0);
    if (!closing || Math.abs(dx) > 170) continue;
    if (!best || Math.abs(dx) < Math.abs(best.dx)) best = { dx: dx, dir: w.dir };
  }
  return best;
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
function BP_dangerBands(b, liveOnly) {
  var out = [];
  for (var i = 0; i < b.proj.length; i++) {
    var pr = b.proj[i];
    if (!pr.alive) continue;
    if (pr.kind === 'bomb') {
      // A live blast blocks the floor, and so does a bomb that is about to
      // become one. Both halves matter: with only live blasts the bot ran
      // straight into a bomb and arrived on the frame it detonated; with a
      // full landing prediction it reversed away from bombs and backed into
      // the slam. The fix is in the RESPONSE, not the detection — see BP_goto.
      if (pr.blast > 0) { out.push(pr.rect.cx); continue; }
      if (liveOnly) continue;
      var t = 0, vy = pr.vy, y = pr.rect.b;
      while (y < BP_GROUND && t < 2) { vy += 900 / 60; y += vy / 60; t += 1 / 60; }
      if (t < 0.7) out.push(pr.rect.cx + pr.vx * t);
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
var BP_why = '-';
function BP_goto(p, tx, run, bands) {
  // never walk through a live or imminent blast: stop on our side of it
  if (bands) {
    var hit = BP_blocked(bands, p.rect.cx, tx);
    if (hit !== null) {
      var stop = hit > p.rect.cx ? hit - 105 : hit + 105;
      // Stop short of it — never reverse past where we already are. Reversing
      // is what walked the bot back under the boss and got it slammed; the
      // blast only lasts 0.34s, so simply waiting is both safer and faster.
      var fwd = tx > p.rect.cx;
      if ((fwd && stop < p.rect.cx) || (!fwd && stop > p.rect.cx)) {
        return BP_emit(false, false, false);
      }
      tx = stop;
    }
  }
  var d = tx - p.rect.cx;
  var moving = Math.abs(p.vx) > 24;
  if (Math.abs(d) > 26 && !moving && p.onGround) BP_blockT++; else BP_blockT = 0;
  if (BP_blockT > 8) { BP_jump(20); BP_blockT = 0; }
  if (Math.abs(d) <= 26) return BP_emit(false, false, false);
  return BP_emit(d < 0, d > 0, !!run && Math.abs(d) > 120);
}

function BP_penguin(g, p, b) {
  BP_lastP = p;
  var onG = p.onGround;
  var bands = BP_dangerBands(b, false);   // live blasts + bombs about to land
  var live = BP_dangerBands(b, true);     // live blasts only
  var wave = BP_waveThreat(b, p);

  // Airborne: hold the course chosen on take-off. Emitting no direction here is
  // the same bug that made the bot jump straight up in the starting notch.
  if (!onG) return BP_emit(BP_dir < 0, BP_dir > 0, BP_run);

  function go(dir, run) { BP_dir = dir; BP_run = run; return BP_emit(dir < 0, dir > 0, run); }

  // 1. A shockwave outranks everything: it is the one hazard that is certain to
  //    connect. Jump it, and keep running the way it is going — standing still
  //    to clear one is how the bot got caught by the second of a pair.
  if (wave) {
    BP_why = 'wave';
    if (Math.abs(wave.dx) < 118) BP_jump(21);
    var flee = wave.dx > 0 ? -1 : 1;
    if (p.rect.cx < 140) flee = 1;
    if (p.rect.cx > 820) flee = -1;
    return go(flee, true);
  }

  // 2. The punish window: 1.6s face-down in the floor.
  if (b.state === 'dazed') {
    BP_why = 'punish';
    var d2 = b.rect.cx - p.rect.cx;
    if (Math.abs(d2) > 88) { var r2 = BP_goto(p, b.rect.cx, true, null); BP_dir = d2 > 0 ? 1 : -1; BP_run = true; return r2; }
    if (p.rect.b > b.rect.y + 20) BP_jump(19);
    return go(d2 > 6 ? 1 : (d2 < -6 ? -1 : BP_dir), true);
  }

  // 3. He drops straight down onto his own column, so be anywhere else.
  if (b.state === 'telegraph' || b.state === 'slam') {
    BP_why = 'slam';
    var mirror = 40 + 920 - b.rect.cx;
    if (mirror < 150) mirror = 150;
    if (mirror > 810) mirror = 810;
    var r3 = BP_goto(p, mirror, true, bands);
    BP_dir = mirror > p.rect.cx ? 1 : -1; BP_run = true;
    return r3;
  }

  // 4. A phase-3 charge crosses the floor at 430 px/s and cannot be outrun at
  //    310, so it has to be cleared. A full jump puts our feet at 336 and his
  //    head at 370.
  if (b.state === 'charge') {
    BP_why = 'charge';
    var cdx = b.rect.cx - p.rect.cx;
    var inbound = (cdx > 0 && b.face < 0) || (cdx < 0 && b.face > 0) || Math.abs(cdx) < 120;
    if (inbound && Math.abs(cdx) < 165) BP_jump(24);
    return go(BP_dir, false);
  }

  // 5. Hovering is the long phase and standing still in it is fatal: he homes
  //    in at 72 px/s and rains bombs, so any stationary spot is eventually
  //    covered. Always move; the only question is which way. Prefer crossing
  //    UNDER him, because he throws the bombs towards the player — fleeing
  //    keeps the whole pattern falling ahead of you.
  BP_why = 'hover';
  var near = null, nd = 1e9;
  for (var i2 = 0; i2 < bands.length; i2++) {
    var d3 = bands[i2] - p.rect.cx;
    if (Math.abs(d3) < nd) { nd = Math.abs(d3); near = bands[i2]; }
  }
  var dir3;
  if (near !== null && nd < 210) dir3 = near > p.rect.cx ? -1 : 1;
  else if (Math.abs(b.rect.cx - p.rect.cx) > 230) dir3 = b.rect.cx > p.rect.cx ? 1 : -1;
  else dir3 = p.rect.cx < b.rect.cx ? 1 : -1;
  if (p.rect.cx < 150) dir3 = 1;
  if (p.rect.cx > 800) dir3 = -1;
  return go(dir3, true);
}

function AP_BOSS(g, p, b, tick) {
  if (!b || b.defeated) return null;
  if (b.state === 'intro') {
    BP_jf = 0;
    // The Joker's intro is 2.4 seconds during which he throws NOTHING, and
    // standing through it is how the bot kept losing phase 1: the ride then
    // starts with him 400px away and a volley already in the air, and from a
    // standing start the player cannot cross the danger band before the cards
    // come down. Walking into position during the intro turns an unwinnable
    // opening into a free one. The penguin has no equivalent opening, so it
    // keeps waiting.
    if (b.kind === 'joker' && typeof BJ_joker === 'function') return BJ_joker(g, p, b);
    return BP_emit(false, false, false);
  }
  if (b.kind === 'penguin') return BP_penguin(g, p, b);
  if (typeof BJ_joker === 'function') return BJ_joker(g, p, b);
  return null;
}
