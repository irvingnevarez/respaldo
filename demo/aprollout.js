// ═══════════════════════════════════════════════════════════════════════
//  ROLLOUT CONTROLLER — the part of the bot that decides whether to jump,
//  and for how long, by actually trying it.
//
//  The reflex rules this replaces were a pile of distance thresholds, and
//  every one of them was wrong at one of the two running speeds: a trigger
//  tuned for 310 px/s fires half an arc too late at 190, and a fixed hold that
//  clears a one-tile step at walking pace sails 200px over a staircase and
//  into the hole behind it at a sprint. Tuning them against one level kept
//  breaking another.
//
//  So instead of predicting the arc, simulate it. Every frame the bot is on
//  the ground it replays the engine's own physics — same constants, same tile
//  collision, same 1/120s step — for each candidate {hold, run} pair, about
//  three quarters of a second ahead, and keeps whichever one ends up furthest
//  right and still alive. It is a one-ply search, and it is enough: pits,
//  staircases, floating blocks and overshoot all stop being special cases.
//
//  Accuracy matters more than speed here. The constants below MUST track
//  core.js, so they are read from the live globals where possible.
// ═══════════════════════════════════════════════════════════════════════

var RO_STEP = 1 / 120;          // the engine's fixed physics step
var RO_TS = 32;

// Candidate actions. hold = frames the jump button is held at 60Hz (0 = no
// jump). Coarse on purpose: finer granularity buys nothing a 32px tile can see.
var RO_HOLDS = [0, 6, 10, 14, 18, 22, 27];

// Mirrors Player.solveX: first solid tile the box overlaps stops it dead.
function RO_solveX(w, b, vx) {
  var c0 = Math.floor(b.x / RO_TS), c1 = Math.floor((b.x + b.w - 0.01) / RO_TS);
  var r0 = Math.floor(b.y / RO_TS), r1 = Math.floor((b.y + b.h - 0.01) / RO_TS);
  for (var cy = r0; cy <= r1; cy++) {
    for (var cx = c0; cx <= c1; cx++) {
      if (!w.solidAt(cx, cy)) continue;
      if (vx > 0) { b.x = cx * RO_TS - b.w; } else if (vx < 0) { b.x = (cx + 1) * RO_TS; }
      return 0;
    }
  }
  return vx;
}

// Mirrors Player.solveY. Returns 1 when it landed on something.
function RO_solveY(w, b, vy) {
  var c0 = Math.floor(b.x / RO_TS), c1 = Math.floor((b.x + b.w - 0.01) / RO_TS);
  var r0 = Math.floor(b.y / RO_TS), r1 = Math.floor((b.y + b.h - 0.01) / RO_TS);
  for (var cy = r0; cy <= r1; cy++) {
    for (var cx = c0; cx <= c1; cx++) {
      if (!w.solidAt(cx, cy)) continue;
      if (vy > 0) { b.y = cy * RO_TS - b.h; return 1; }
      b.y = (cy + 1) * RO_TS;
      return 2;                       // head-butt: stopped rising
    }
  }
  return 0;
}

function RO_approach(cur, target, d) {
  return cur < target ? Math.min(cur + d, target) : Math.max(cur - d, target);
}

// Replay `frames` 60Hz frames of the engine from the player's current state,
// holding right, with the given jump hold and run flag.
//   -> {x, y, vy, dead, onG, minY, headHit}
function RO_sim(g, w, p, hold, run, frames, foes, dir) {
  var b = { x: p.rect.x, y: p.rect.y, w: p.rect.w, h: p.rect.h };
  var vx = p.vx, vy = p.vy;
  var onG = p.onGround;
  var coyote = onG ? 0.13 : 0;
  var buf = hold > 0 ? 0.17 : 0;      // the buffered jump the caller will arm
  var maxSpd = run ? 310 : 190;
  if (dir === undefined) dir = 1;
  var dead = false, minY = b.y, landed = onG;
  var floor = w.pxH + 60;
  var hits = 0, stomps = 0;
  var star = p.star > 0;

  for (var f = 0; f < frames && !dead; f++) {
    var held = f < hold;
    for (var s = 0; s < 2; s++) {     // the loop runs two 1/120 steps per frame
      var a = (onG ? 2000 : 1200) * RO_STEP;
      if (dir !== 0) vx = RO_approach(vx, dir * maxSpd, a);
      else vx = RO_approach(vx, 0, (onG ? 2600 : 910) * RO_STEP);
      if (onG) coyote = 0.13; else if (coyote > 0) coyote -= RO_STEP;
      if (buf > 0) buf -= RO_STEP;
      if (buf > 0 && coyote > 0) { vy = -760; onG = false; coyote = 0; buf = 0; }
      if (!held && vy < 0) vy *= Math.pow(0.42, RO_STEP * 60);
      vy = Math.min(vy + 2000 * RO_STEP, 780);

      b.x += vx * RO_STEP;
      vx = RO_solveX(w, b, vx);
      b.y += vy * RO_STEP;
      onG = false;
      var hit = RO_solveY(w, b, vy);
      if (hit === 1) { vy = 0; onG = true; landed = true; }
      else if (hit === 2) { vy = 0; }

      if (b.y < minY) minY = b.y;
      if (b.y > floor) { dead = true; break; }
    }

    // Enemies, carried forward at constant velocity. Cheap and good enough over
    // a one-second horizon, and it is what turns "furthest right" into
    // "furthest right and still alive" — the reflex rules could see an enemy
    // but had no way to know whether the arc they were about to commit to
    // would land on its head or walk into its side.
    if (foes && !star) {
      var t = (f + 1) / 60;
      for (var k = 0; k < foes.length; k++) {
        var e = foes[k];
        var ex = e.x + e.vx * t, ey = e.y;
        if (e.after !== undefined && t < e.after - 0.06) continue;   // not there yet
        if (b.x < ex + e.w && b.x + b.w > ex && b.y < ey + e.h && b.y + b.h > ey) {
          // the engine only counts a stomp when descending onto the top, and a
          // shockwave or a blast cannot be landed on at all
          if (!e.noStomp && vy > 0 && b.y + b.h < ey + 16) stomps++;
          else hits++;
          break;
        }
      }
    }
  }
  return { x: b.x, y: b.y, vy: vy, dead: dead, onG: onG, landed: landed,
           hits: hits, stomps: stomps };
}

// Cost of a rollout's outcome. Forward progress is the objective; dying is
// disqualifying; ending airborne is discounted because the arc is unfinished
// and the next decision cannot be made until it lands.
function RO_score(g, w, p, r, hold, run) {
  if (r.dead) return -1e9;
  var s = r.x;
  // Landing on solid ground is worth more than still being in flight at the
  // horizon: an unfinished arc may yet end in a pit the horizon did not reach.
  if (r.onG) s += 70;
  else if (!r.landed) s -= 40;
  // Prefer not to jump when it buys nothing: pointless hops look bad and cost
  // control. Only a clearly better outcome should earn one.
  if (hold > 0) s -= 26;
  if (!run) s -= 10;
  // Taking a hit is not fatal, but it costs the bat-suit and, at small size,
  // it IS fatal — so weight it like a near-death rather than a scratch.
  if (r.hits) s -= 2600 * r.hits;
  if (r.stomps) s += 150 * r.stomps;     // free spectacle, and it clears the path
  return s;
}

// Public: choose an action for this frame. Returns {hold, run} or null when
// the caller should fall back to its own rules (airborne, or no world).
// Snapshot the enemies once per decision instead of once per rollout.
function RO_foes(g, p) {
  var out = [], list = g.enemies || [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || !e.alive || e.dying > 0) continue;
    if (e.shell && !e.shellSpin) continue;          // parked shell is harmless
    var dx = e.rect.cx - p.rect.cx;
    if (dx < -120 || dx > 620) continue;
    out.push({ x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h,
               vx: e.kind === 'drone' ? e.vx : (e.shellSpin ? e.vx : e.vx),
               fly: e.kind === 'drone' });
  }
  return out;
}

// Direction is a candidate too. Sometimes the only safe play is to stand still
// and let a patrol walk past, or to give ground for a moment before committing
// — a bot that can only ever hold right has no way to express either.
// Forward only. Standing still was tried and removed: near a gap it is an
// unrecoverable trap a one-ply search cannot see — the bot stops to avoid a
// predicted hit, and from a standstill it can no longer build the speed the
// jump across needs, so it is stuck there for good. Every hazard here can be
// answered by jumping instead, and jumping keeps the run moving.
var RO_DIRS = [1];

function RO_choose(g, w, p, horizon, yieldPen) {
  // Grounded decisions only. Letting it re-pick a direction in mid-air meant it
  // could cancel the very momentum the jump was launched with — the bot would
  // commit to a gap, change its mind at the apex and drop straight in.
  if (!w || !p || !p.onGround) return null;
  var foes = RO_foes(g, p);
  var grounded = true;
  var best = null, bestScore = -Infinity;
  for (var i = 0; i < RO_HOLDS.length; i++) {
    var hold = RO_HOLDS[i];
    if (!grounded && hold > 0) continue;      // cannot start a jump in mid-air
    for (var d = 0; d < RO_DIRS.length; d++) {
      for (var rr = 0; rr < 2; rr++) {
        var dir = RO_DIRS[d], run = rr === 1;
        if (dir === 0 && run) continue;       // standing still has no run variant
        var r = RO_sim(g, w, p, hold, run, horizon, foes, dir);
        var sc = RO_score(g, w, p, r, hold, run);
        // Forward is the job. Yielding is allowed, but it has to get steadily
        // more expensive the longer it goes on: the first version could sit
        // still forever because "advance and take a hit" always scored worse
        // than "stand here", and a patrolling enemy never leaves.
        if (dir !== 1) sc -= 55 + (yieldPen || 0);
        if (sc > bestScore) {
          bestScore = sc; best = { hold: hold, run: run, dir: dir, out: r };
        }
      }
    }
  }
  return best;
}

// Best hold that is strictly a jump — used when something other than terrain
// (an enemy) demands one, so the arc still has to clear the terrain.
function RO_bestJump(g, w, p, horizon) {
  if (!w || !p || !p.onGround) return 0;
  var foes2 = RO_foes(g, p);
  var best = 0, bestScore = -Infinity;
  for (var i = 0; i < RO_HOLDS.length; i++) {
    var hold = RO_HOLDS[i];
    if (hold === 0) continue;
    for (var rr = 0; rr < 2; rr++) {
      var r2 = RO_sim(g, w, p, hold, rr === 1, horizon, foes2);
      var sc = RO_score(g, w, p, r2, 0, rr === 1);
      if (sc > bestScore) { bestScore = sc; best = hold; }
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════
//  BOSS ROLLOUT — the same one-ply search, pointed at a fight.
//
//  The hand-written boss policy kept failing the same way the traversal rules
//  did: every threshold was right for one hazard and wrong for the next, and a
//  rule that dodged a shockwave walked into a bomb. A fight is the same
//  question as a gap — "which action leaves me alive, and nearer to the thing
//  I want" — so it gets the same answer.
//
//  Hazards are expressed in the shape RO_sim already understands. The one
//  addition is `noStomp`: a shockwave or a blast cannot be landed on, so ANY
//  overlap with it is a hit, whereas the boss itself is a stomp target exactly
//  when the engine says it is vulnerable.
// ═══════════════════════════════════════════════════════════════════════

var RO_BOSS_HOLDS = [0, 8, 13, 18, 23, 27];

function RO_bossHazards(b, p) {
  var h = [];
  for (var i = 0; i < b.waves.length; i++) {
    var w = b.waves[i];
    if (!w.alive) continue;
    h.push({ x: w.rect.x, y: w.rect.y, w: w.rect.w, h: w.rect.h,
             vx: w.dir * w.speed, noStomp: true });
  }
  for (var j = 0; j < b.proj.length; j++) {
    var pr = b.proj[j];
    if (!pr.alive) continue;
    if (pr.kind === 'bomb' && pr.blast <= 0) {
      // predict the blast: it detonates on contact with the floor and then
      // covers a 68x44 patch of it for a third of a second
      var t = 0, vy = pr.vy, y = pr.rect.b;
      while (y < 15 * 32 && t < 2) { vy += 900 / 60; y += vy / 60; t += 1 / 60; }
      if (t < 1.1) {
        h.push({ x: pr.rect.cx + pr.vx * t - 34, y: 15 * 32 - 44, w: 68, h: 44,
                 vx: 0, noStomp: true, after: t });
      }
      continue;
    }
    h.push({ x: pr.rect.x, y: pr.rect.y, w: pr.rect.w, h: pr.rect.h,
             vx: pr.vx, noStomp: true });
  }
  return h;
}

// Score a rollout for a fight: survival first, then the objective.
function RO_bossScore(r, goalX, wantStomp) {
  if (r.dead) return -1e9;
  var s = -Math.abs(r.x + 15 - goalX);
  s -= 4000 * r.hits;
  if (wantStomp) s += 6000 * r.stomps;
  return s;
}

// Public: pick {hold, dir, run} for a boss frame.
//   goalX     where we would like to be standing
//   bossFoe   the boss itself, as a foe (stompable only when vulnerable)
function RO_bossChoose(g, w, p, b, goalX, bossFoe, horizon) {
  if (!w || !p || !p.onGround) return null;
  var haz = RO_bossHazards(b, p);
  if (bossFoe) haz.push(bossFoe);
  var best = null, bestScore = -Infinity;
  for (var i = 0; i < RO_BOSS_HOLDS.length; i++) {
    for (var d = -1; d <= 1; d++) {
      for (var rr = 0; rr < 2; rr++) {
        if (d === 0 && rr) continue;
        var hold = RO_BOSS_HOLDS[i], run = rr === 1;
        var r = RO_sim(g, w, p, hold, run, horizon || 70, haz, d);
        var sc = RO_bossScore(r, goalX, !!(bossFoe && bossFoe.stompable));
        if (hold > 0) sc -= 15;
        if (sc > bestScore) { bestScore = sc; best = { hold: hold, dir: d, run: run }; }
      }
    }
  }
  return best;
}
