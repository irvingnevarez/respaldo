// AUTOPILOT(g, tick) -> {L, R, run, jump}
//
// Drives the demo recording. Priorities: never die, never stall, keep moving
// right, and take the cheap spectacle (stomps, '?' blocks, power-ups) when it
// is safe. The caller turns a false->true transition of `jump` into a buffered
// jump and holds it while `jump` stays true, so a longer hold = a higher jump.
//
// Physics this is tuned against (core.js): GRAV 2000, JUMP -760, RUN 310.
// Full jump peaks ~144px (4.5 tiles) and covers ~230px (7 tiles) at run speed.

var AP_jumpFrames = 0;     // frames left to hold jump
var AP_lastX = 0;
var AP_stuckT = 0;
var AP_backT = 0;          // frames left of the "back up" escape
var AP_lvl = -1;
var AP_menuT = 0;
var AP_target = null;      // locked '?' block: {c, r}
var AP_targetT = 0;
var AP_maxX = 0;           // furthest right reached — real progress, not raw dx
var AP_lastMax = 0;
var AP_brakeT = 0;
var AP_brakeHold = 0;   // frames the air-brake stays committed (hysteresis)
var AP_enemyCd = 0;     // cooldown between enemy-triggered hops
var AP_pitJump = false; // mid-leap over a gap: momentum is not negotiable
var AP_prevJump = false; // last frame's emitted jump, for edge detection
var AP_roDir = 1;       // direction the rollout chose this frame
var AP_yieldT = 0;      // consecutive frames spent not advancing
var AP_detourT = 0;     // frames spent chasing a power-up backwards
var AP_detourBlock = 0; // cooldown after a chase was abandoned

function AP_reset() {
  AP_jumpFrames = 0; AP_lastX = 0; AP_stuckT = 0; AP_backT = 0;
  AP_target = null; AP_targetT = 0; AP_maxX = 0; AP_lastMax = 0; AP_brakeT = 0;
  AP_brakeHold = 0; AP_enemyCd = 0; AP_pitJump = false; AP_prevJump = false;
  AP_detourT = 0; AP_detourBlock = 0; AP_roDir = 1; AP_yieldT = 0;
}

// first column at/after `from` whose floor is missing under the player's feet
function AP_scanPit(w, fromCol, footRow, maxAhead) {
  for (var d = 0; d <= maxAhead; d++) {
    var c = fromCol + d;
    if (c < 0) continue;
    var solid = false;
    for (var r = footRow; r <= footRow + 3; r++) {
      if (w.solidAt(c, r)) { solid = true; break; }
    }
    if (!solid) return c;
  }
  return -1;
}

// width of the pit starting at pitCol, in tiles (capped)
function AP_pitWidth(w, pitCol, footRow, cap) {
  for (var d = 1; d <= cap; d++) {
    var c = pitCol + d;
    for (var r = footRow; r <= footRow + 3; r++) {
      if (w.solidAt(c, r)) return d;
    }
  }
  return cap + 1;
}

// Rescaled when JUMP went -680 -> -760: the same hold now buys ~12% more
// height, so the old frame counts overshot every arc.
function AP_hold(tiles) {
  if (tiles <= 1) return 7;
  if (tiles <= 2) return 12;
  if (tiles <= 3) return 15;
  if (tiles <= 4) return 19;
  return 23;                 // full commit
}

function AUTOPILOT(g, tick) {
  var out = { L: false, R: true, run: true, jump: false };
  try {
    if (!g) return { L: false, R: false, run: false, jump: false };

    var st = g.state;

    // ── menus: pulse jump so the caller's edge detection fires ──
    if (st === 'title' || st === 'over' || st === 'win') {
      AP_menuT++;
      return { L: false, R: false, run: false, jump: (AP_menuT % 8) < 3 };
    }
    if (st === 'clear' || st === 'dead' || st === 'pause') {
      AP_reset();
      return { L: false, R: false, run: false, jump: false };
    }

    var p = g.player, w = g.world;
    if (!p || !w || p.dead) return { L: false, R: false, run: false, jump: false };

    if (g.lvIdx !== AP_lvl) { AP_lvl = g.lvIdx; AP_reset(); AP_lastX = p.rect.x; }

    // ── boss arenas ──────────────────────────────────────────────────────
    // A boss arena is 30 columns with no beacon, so the traversal logic below
    // has nothing to aim at: it runs right, hits the wall and stands there.
    // Fighting is a different problem — read the boss's state machine, stay
    // out of the hazards, and be on its head during the one window it is
    // vulnerable — so it gets its own policy.
    if (g.boss && !g.boss.defeated && typeof AP_BOSS === 'function') {
      var bo = AP_BOSS(g, p, g.boss, tick);
      if (bo) return bo;
    }

    var TS = 32;
    var onG = p.onGround;
    var footRow = Math.floor((p.rect.b + 3) / TS);
    var leadCol = Math.floor((p.rect.r + 2) / TS);
    var myCol = Math.floor(p.rect.cx / TS);
    var headRow = Math.floor((p.rect.y - 2) / TS);
    var bodyRow = Math.floor(p.rect.cy / TS);
    var kneeRow = Math.floor((p.rect.b - 6) / TS);

    if (onG) { AP_pitJump = false; AP_brakeHold = 0; }

    var wantJump = 0;          // requested hold frames, 0 = no jump
    var wantRun = true;
    var goLeft = false;
    var threat = false;        // a pit or an enemy is in play: survival only
    var invincible = p.star > 0;

    // ── 5. anti-stall ────────────────────────────────────────────────────
    // Measured against the furthest point reached, never against raw frame-to-
    // frame dx: a bot that is being pushed backwards has a very negative dx,
    // and reading that as "stuck, reverse harder" produced an endless pacing
    // loop. Progress is only ever forward progress.
    if (p.rect.x > AP_maxX) AP_maxX = p.rect.x;
    var behind = (AP_maxX - p.rect.x) > 100;   // lost ground: prioritise recovering it
    AP_stuckT++;
    var stuckKick = false;
    if (AP_stuckT >= 75) {
      // Only a HINT now, not an order. This used to fire a blind full-commit
      // jump the moment progress stalled — straight into whatever the rollout
      // was deliberately waiting out. Deadlocks are handled properly by the
      // escalating yield cost, so this is reduced to breaking ties.
      if (AP_maxX - AP_lastMax < 26 && AP_jumpFrames <= 0) stuckKick = true;
      AP_lastMax = AP_maxX;
      AP_stuckT = 0;
    }

    // ── 1. movement: one-ply rollout owns it ────────────────────────────
    // Terrain and enemies used to be three rule sets with veto flags between
    // them, and they fought: the pit rule wanted speed, the stomp rule wanted
    // to leave the ground, the air-brake wanted to shed the very momentum the
    // pit jump depended on. They are all one question — "which action leaves me
    // furthest right and unhurt" — so the rollout answers it once, with the
    // engine's own physics, and the answer is final. See aprollout.js.
    var pitNear = false;
    var ro = (typeof RO_choose === 'function') ? RO_choose(g, w, p, 80, AP_yieldT * 14) : null;
    if (ro) {
      if (ro.hold > 0) { wantJump = Math.max(wantJump, ro.hold); AP_pitJump = true; }
      wantRun = ro.run;
      goLeft = ro.dir === -1;
      if (ro.dir === 0) { wantRun = false; }
      pitNear = ro.hold > 0;
      // Commit the direction for the whole arc: it is re-decided the moment we
      // are back on the ground, and never before.
      AP_roDir = ro.dir;
      if (ro.dir === 1) AP_yieldT = 0; else AP_yieldT++;
      if (stuckKick && ro.hold === 0 && ro.dir === 1) wantJump = Math.max(wantJump, 22);
    } else if (onG) {
      AP_roDir = 1;
      // Fallback for when the rollout module is not loaded: the game itself
      // ships without it, so the bot must still be able to walk and hop.
      {
        var pit = AP_scanPit(w, leadCol, footRow, 7);
        if (pit >= 0) {
          var dist = pit * TS - p.rect.r;
          var wide = AP_pitWidth(w, pit, footRow, 8);
          if (dist <= (wide >= 4 ? 30 : 20) && dist > -TS) {
            wantJump = Math.max(wantJump, AP_hold(wide));
            AP_pitJump = true;
          }
        }
        var bK = w.solidAt(leadCol, kneeRow) || w.solidAt(leadCol + 1, kneeRow);
        var bB = w.solidAt(leadCol, bodyRow) || w.solidAt(leadCol + 1, bodyRow);
        if (wantJump === 0 && (bK || bB)) wantJump = Math.max(wantJump, bB ? 17 : 11);
      }
    }

    // ── 4. reward: lock onto a live '?' block and head-butt it ───────────
    // Popping these is the only way the demo shows the bat-suit and the
    // invincibility star, so it gets a real target lock rather than an
    // opportunistic swipe.
    if (AP_target) {
      var tt = w.at(AP_target.c, AP_target.r);
      AP_targetT++;
      // drop the lock once it is spent, gone, behind us, or taking too long
      if (!tt || tt.t !== '?' || tt.used || AP_targetT > 260 ||
        p.rect.cx > (AP_target.c + 1) * TS + 26) {
        AP_target = null; AP_targetT = 0;
      }
    }
    if (!AP_target && onG && !threat) {
      for (var c = myCol; c <= myCol + 7; c++) {
        for (var r = headRow; r >= headRow - 3 && r >= 0; r--) {
          var t0 = w.at(c, r);
          if (t0 && t0.t === '?' && !t0.used) {
            AP_target = { c: c, r: r }; AP_targetT = 0;
            c = 1e9; break;
          }
        }
      }
    }
    // Spectacle is never worth a deadlock: if the rollout decided to hold
    // position or to jump for terrain, the '?' block can wait.
    if (AP_target && !threat && !pitNear && AP_roDir === 1) {
      var bx = AP_target.c * TS + TS / 2;
      var dxb = bx - p.rect.cx;
      if (onG) wantRun = false;                 // line up, but never brake mid-jump
      if (onG && wantJump === 0) {
        if (dxb > 16) {
          // still approaching: keep walking, do not jump yet
        } else if (dxb > -22) {
          var up = headRow - AP_target.r;
          wantJump = Math.max(wantJump, up <= 1 ? 14 : up <= 2 ? 20 : 26);
        }
      }
    }

    // ── 4b. reward: take a star / suit that is ON THE WAY ────────────────
    // Forward-only, deliberately. Walking back for a power-up is the single
    // best way to deadlock this bot: the chase pulls left, the lost-ground
    // rule pushes right, and the two fight at 60Hz. Worse, a suit that pops out
    // of a block and settles on a ledge behind us is often not reachable at
    // all, so the chase never ends on its own — one run spent seventeen seconds
    // bouncing between two platforms at x=1152 and never moved again.
    // A missed power-up costs the demo a few seconds of gold; a deadlock costs
    // it the whole level.
    var picks = g.pickups || [];
    for (var k = 0; k < picks.length; k++) {
      var q = picks[k];
      if (!q || !q.alive) continue;
      if (q.kind !== 'star' && q.kind !== 'suit') continue;
      var qdx = q.rect.cx - p.rect.cx;
      var qdy = q.rect.cy - p.rect.cy;
      if (qdx < -10 || qdx > 170 || qdy > 40) continue;
      // above us and ahead: hop to meet it
      if (qdy < -20 && onG && wantJump === 0 && !pitNear && AP_roDir === 1) wantJump = Math.max(wantJump, 20);
    }

    // ── commit the jump ──────────────────────────────────────────────────
    // The engine arms a jump only on a FALSE->TRUE edge of this button, so
    // there has to be a released frame between jumps. That used to be a
    // three-frame countdown, which silently ATE decisions: the rollout would
    // plan the leap over a four-tile gap, the countdown would be mid-flight,
    // the jump never happened and the bot walked off the edge it had correctly
    // identified. One released frame is all the edge needs, so gate on the
    // previous output instead of a timer.
    if (wantJump > 0 && onG && AP_jumpFrames <= 0 && !AP_prevJump) {
      AP_jumpFrames = wantJump;
    }
    if (AP_jumpFrames > 0) { out.jump = true; AP_jumpFrames--; }

    out.run = wantRun && !goLeft;
    // Airborne, always drive forward. The direction is chosen on the ground and
    // held for the arc, but "hold position" must not survive into the air: a
    // bot that leaves the ground with no horizontal input drops straight back
    // down, which is how it spent fourteen seconds bouncing on one tile.
    out.R = onG ? (AP_roDir > 0) : true;
    out.L = onG && AP_roDir < 0;

    // The old air-brake and lost-ground recovery are gone. Both existed to
    // patch decisions the bot could not see the consequences of; the rollout
    // sees them, and having two more rules second-guessing it at 60Hz is how
    // the bot used to end up juddering on the spot.
    // during star power, sprint — it looks best at full speed
    if (invincible) { out.run = true; out.R = true; out.L = false; }

    try {
      window.__ap = { wj: wantJump, jf: AP_jumpFrames, gL: goLeft, brk: false,
        beh: behind, thr: threat, tgt: AP_target ? AP_target.c : -1,
        pn: pitNear, ecd: AP_enemyCd };
    } catch (e) { }

    AP_prevJump = out.jump;
    return out;
  } catch (err) {
    try { if (!window.__apErr) window.__apErr = err.message + ' | ' + (err.stack||'').split('\n')[1]; } catch (e) {}
    return { L: false, R: true, run: true, jump: false };
  }
}
