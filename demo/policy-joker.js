// ═══════════════════════════════════════════════════════════════════════
//  BOSS POLICY — EL JOKER (level 1-8).
//
//  Defines BJ_joker(g, p, b); AP_BOSS in policy-penguin.js dispatches to it,
//  and the shared BP_emit / BP_jump machinery there is reused, so both files
//  have to be loaded together.
//
//  Three fights in one, and each needs its own answer:
//
//    PHASE 1  (hp 5,4) He rides overhead at y=150, drifting onto the player at
//                      56 px/s and fanning cards every 1.05s. Every 4.2s he
//                      DIPS to y=330 for 1.7s — that is the only opening, and
//                      the dip brings his head within reach of a jump.
//    PHASE 2  (hp 3,2) Laughing gas floods the floor to y=460, so the ground
//                      is lethal and the fight moves onto three platforms. He
//                      teleports between those same three, and is open for the
//                      0.9s after he lands.
//    PHASE 3  (hp 1)   Gas drains, he plants himself in the centre and throws
//                      five cards a second while spawning minions. Open for
//                      the 1.3s he spends with his arms up.
//
//  The one piece of real cleverness is in phase 2, and it is forced: his next
//  destination is
//      (tpIndex + 1 + (player is right of centre ? 1 : 0)) % 3
//  so he deliberately moves AWAY from the player's half. Standing anywhere and
//  waiting therefore cannot work — from the centre spot there is provably no
//  platform you can camp that he will arrive at next. The answer is to hold
//  the LEFT half, which pins the cycle to +1 (0 -> 1 -> 2 -> 0) and makes two
//  of every three arrivals land somewhere reachable. The third is skipped.
// ═══════════════════════════════════════════════════════════════════════

// Arena geometry, read off the 1-8 grid rather than guessed.
//   left   x 64..288  top 384      centre x 384..608  top 320
//   right  x 672..896 top 384      floor  x 32..928   top 480
var BJ_PLAT = [
  { x0: 64, x1: 288, y: 384, mid: 176 },
  { x0: 384, x1: 608, y: 320, mid: 496 },
  { x0: 672, x1: 896, y: 384, mid: 784 },
];
var BJ_FLOOR = 480;
var BJ_GAS_SAFE = 454;          // feet must stay above gasY+6; gas settles at 460

// Which of his three teleport spots sits on which platform.
var BJ_SPOT_PLAT = [0, 1, 2];

var BJ_dir = 1, BJ_run = true;
var BJ_why = '-';
var BJ_prevState = '';
var BJ_plan = -1;               // platform index we are committed to
// Where phase 1 is fought from, and it has to satisfy two measured constraints
// at once:
//   - D=0, i.e. his own column, the only standoff that takes zero card hits
//   - a column with NOTHING OVERHEAD, or the jump cannot reach his head
// The deck fails the first (it takes hits) and the floor under a deck fails the
// second (the ceiling caps the apex at 396 against a head at 330). The arena
// leaves exactly two clear floor columns, the gaps between the decks at
// x 288..384 and x 608..672. The left gap it is; he drifts onto whatever column
// we hold, so holding its centre brings the fight to us.
var BJ_HOLD = 336;
var BJ_GAPLO = 300, BJ_GAPHI = 372;

// A card is only a threat where it actually is. Treating every projectile as a
// floor-level no-go band (which is what the penguin policy does, because bombs
// ARE floor hazards) made the bot flinch away from cards arcing harmlessly over
// its head. Cards fly, so the test has to be in two dimensions and has to look
// a little way ahead: they are thrown at 300 px/s and cross the player's column
// in well under the time it takes to walk out of the way.
// Pick a heading by simulating it, rather than by reasoning about the fan.
//
// Two heuristics were tried and both killed the bot, in different places, for
// the same reason: the cards that connect are not the ones LANDING, they are
// the near-flat one (vx -300, vy -13) crossing the player's altitude early. It
// crosses at x≈234 if you are standing on the platform at y=384 and at x≈186
// if you are on the floor at y=458, so where the corridor is depends on your
// own height, and "run away from the nearest card" walks straight into it.
//
// So: replay each candidate heading forward against every card's real
// trajectory and keep the one that survives longest.
//
// SCORE BY TIME-TO-CONTACT, not by minimum clearance. Minimum distance was
// tried first and is actively misleading over a long horizon: a card is in the
// air for up to 1.6s, so if you look that far ahead EVERY heading eventually
// has a near miss, all three candidates saturate near zero, and the tie-break
// decides the whole fight. Measured, that is exactly what happened — the sim
// reported clearance 0.17 for the option it chose and the bot walked into the
// first volley's landing spot. How long a path stays clean is the thing that
// actually matters, and it discriminates.
//
// Card paths are integrated once and shared across the three candidates.
var BJ_HOR = 75;
var BJ_cx = [], BJ_cy = [], BJ_cn = 0;

function BJ_paths(b) {
  BJ_cn = 0;
  for (var i = 0; i < b.proj.length; i++) {
    var pr = b.proj[i];
    if (!pr.alive || pr.kind !== 'card') continue;
    var x = pr.rect.cx, y = pr.rect.cy, vx = pr.vx, vy = pr.vy;
    var xs = BJ_cx[BJ_cn] || (BJ_cx[BJ_cn] = []);
    var ys = BJ_cy[BJ_cn] || (BJ_cy[BJ_cn] = []);
    for (var s = 0; s < BJ_HOR; s++) {
      vy += 520 / 60; x += vx / 60; y += vy / 60;
      xs[s] = x; ys[s] = y > 560 ? 1e6 : y;      // off the bottom = gone
    }
    BJ_cn++;
  }
}

function BJ_pick(b, p, want) {
  BJ_paths(b);
  var best = null;
  var cands = [-1, 0, 1];
  for (var c = 0; c < cands.length; c++) {
    var dir = cands[c];
    var px = p.rect.cx, py = p.rect.cy;
    var spd = dir === 0 ? 0 : dir * 300;
    var tHit = BJ_HOR, minD = 9;
    for (var s = 0; s < BJ_HOR; s++) {
      px += spd / 60;
      if (px < 70) px = 70;
      if (px > 890) px = 890;
      for (var k = 0; k < BJ_cn; k++) {
        // normalise the axes so a card passing overhead does not read as closer
        // than one level with us but further along
        var ddx = (BJ_cx[k][s] - px) / 44, ddy = (BJ_cy[k][s] - py) / 48;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < minD) minD = d;
        if (d < 1.0 && s < tHit) tHit = s;
      }
      if (tHit < BJ_HOR) break;
    }
    var score = tHit * 12 + Math.min(minD, 3) * 25;
    if (dir === want) score += 40;
    if (dir === 0 && want !== 0) score -= 15;
    var ex = px + dir * 60;
    if (ex < 90 || ex > 870) score -= 400;       // never commit into a wall
    if (!best || score > best.score)
      best = { score: score, dir: dir, clear: minD, t: tHit };
  }
  return best;
}

function BJ_cardThreat(b, p) {
  var px = p.rect.cx, py = p.rect.cy;
  for (var i = 0; i < b.proj.length; i++) {
    var pr = b.proj[i];
    if (!pr.alive || pr.kind !== 'card') continue;
    var x = pr.rect.cx, y = pr.rect.cy, vy = pr.vy, vx = pr.vx;
    for (var s = 0; s < 22; s++) {           // ~0.37s at 60Hz
      if (Math.abs(x - px) < 42 && Math.abs(y - py) < 46) {
        return { dx: x - px, t: s };
      }
      vy += 520 / 60; x += vx / 60; y += vy / 60;
      if (y > BJ_FLOOR + 40) break;
    }
  }
  return null;
}

// Clamp a target so we never walk off the platform we are standing on.
function BJ_onPlat(p) {
  var fb = p.rect.b;
  for (var i = 0; i < BJ_PLAT.length; i++) {
    var pl = BJ_PLAT[i];
    if (Math.abs(fb - pl.y) < 10 && p.rect.cx > pl.x0 - 6 && p.rect.cx < pl.x1 + 6) return i;
  }
  return -1;
}

// Walk toward tx, but refuse to step past the edge of the platform underfoot —
// in phase 2 the floor is gas and a single walk-off costs a life.
function BJ_walk(p, tx, run, keepOn) {
  if (keepOn >= 0) {
    var pl = BJ_PLAT[keepOn];
    if (tx < pl.x0 + 20) tx = pl.x0 + 20;
    if (tx > pl.x1 - 20) tx = pl.x1 - 20;
  }
  var d = tx - p.rect.cx;
  if (Math.abs(d) <= 16) return BP_emit(false, false, false);
  BJ_dir = d < 0 ? -1 : 1;
  BJ_run = !!run && Math.abs(d) > 110;
  return BP_emit(d < 0, d > 0, BJ_run);
}

// Hop from the platform we are on to an adjacent one. The gaps are 96px and
// 64px wide and the centre deck is 64px higher, both well inside a running
// jump, but the jump has to START before the edge.
function BJ_hopTo(p, from, to) {
  var src = BJ_PLAT[from], dst = BJ_PLAT[to];
  var goRight = dst.mid > src.mid;
  var edge = goRight ? src.x1 : src.x0;
  var near = goRight ? (p.rect.cx > edge - 74) : (p.rect.cx < edge + 74);
  if (near && p.onGround) BP_jump(22);
  BJ_dir = goRight ? 1 : -1; BJ_run = true;
  return BP_emit(!goRight, goRight, true);
}

function BJ_joker(g, p, b) {
  BP_lastP = p;

  // Airborne. Holding the take-off heading is right for a dodge and wrong for a
  // stomp: on a punish the bot arrived directly over his head at x=148 against
  // bx=150, kept the heading it had built up, and sailed on across the arena to
  // x=432 and into the gas. While he is vulnerable, steer to stay on his
  // column; otherwise hold the heading, because emitting nothing here is the
  // bug that made the penguin policy hop on the spot forever.
  if (!p.onGround) {
    // Phase 2 only. In phase 1 the bot is already standing on his column when
    // he dips, so steering mid-air just adds drift; applying it there cost a
    // hit per run. In phase 2 the punish starts with a run-up along the deck,
    // and that momentum is what carries it past him.
    // In phase 2 the floor is gas, so momentum is never worth keeping: steer
    // at his column while he is open, and at the home deck otherwise. The
    // stomp bounce used to fire us off the deck still carrying the rightward
    // run-up, and every landing outside a deck is a life.
    if (b.phase === 2) {
      var ad = (b.vulnerable ? b.rect.cx : BJ_PLAT[0].mid) - p.rect.cx;
      if (Math.abs(ad) > 10) return BP_emit(ad < 0, ad > 0, Math.abs(ad) > 150);
      return BP_emit(false, false, false);
    }
    return BP_emit(BJ_dir < 0, BJ_dir > 0, BJ_run);
  }

  var entered = b.state !== BJ_prevState;
  BJ_prevState = b.state;
  var bx = b.rect.cx;
  var card = BJ_cardThreat(b, p);

  // The free opening. No cards are in the air during the intro, so just walk
  // under him and drop to the floor on the way — the player starts on the left
  // deck and the run to his column takes it off the right-hand edge anyway.
  if (b.state === 'intro') {
    BJ_why = 'entrada';
    var dI = BJ_HOLD - p.rect.cx;
    if (Math.abs(dI) <= 14) { BJ_run = false; return BP_emit(false, false, false); }
    BJ_dir = dI > 0 ? 1 : -1; BJ_run = Math.abs(dI) > 70;
    return BP_emit(dI < 0, dI > 0, BJ_run);
  }

  // GET OUT OF HIS REACH, whatever phase we are in.
  //
  // Touching him hurts at every moment he is not open, and a stomp does not
  // move him: hurt plus the next state is over a second of him standing solid
  // exactly where we just landed. This one failure accounted for the end of
  // every run — always the same frame, p(195,384) against b(150,288), a three
  // pixel overlap — first in phase 2 and then, once that was patched locally,
  // in phase 3 at the identical spot. It is a property of the fight, not of a
  // phase, so it is checked once here for all of them.
  //
  // The vertical test keeps it from firing in phase 1, where he rides 330px
  // overhead and closing on his column is the whole plan.
  // Phase 3 wants to loiter closer than the other phases (see below), so the
  // reach guard is tightened there to just clear of his hitbox.
  var reach = b.phase === 3 ? 66 : 96;
  if (!b.vulnerable && Math.abs(bx - p.rect.cx) < reach &&
      Math.abs(b.rect.cy - p.rect.cy) < 130) {
    BJ_why = 'apartarse';
    var aw = bx < p.rect.cx ? 1 : -1;
    var lim = BJ_onPlat(p);
    var tx2 = p.rect.cx + aw * 150;
    // in phase 2 the floor is gas, so the retreat must stay on the deck
    if (b.phase === 2 && lim >= 0) {
      tx2 = Math.max(BJ_PLAT[lim].x0 + 24, Math.min(BJ_PLAT[lim].x1 - 24, tx2));
    }
    var dAw = tx2 - p.rect.cx;
    if (Math.abs(dAw) > 10) {
      BJ_dir = dAw > 0 ? 1 : -1; BJ_run = true;
      return BP_emit(dAw < 0, dAw > 0, true);
    }
  }

  // ── PHASE 1: he rides overhead and dips ──────────────────────────────
  if (b.phase === 1) {
    var here = BJ_onPlat(p);
    if (b.state === 'taunt') {
      BJ_why = 'dip';
      // He is vulnerable for the whole dip, so contact is safe: line up and
      // jump. Fight this phase from the LEFT PLATFORM, not the floor. From the
      // floor our apex is 336 against a head at 330 — it does connect, but the
      // window where our feet sit between 330 and 348 while falling is about
      // three frames wide. From the platform at 384 we jump to 240 and fall
      // back through his head with room to spare.
      //
      // The clamp is deliberately NOT applied here. It exists to stop us
      // walking into phase 2's gas, and leaving it on in phase 1 pinned the bot
      // to the left platform where it could never reach him: fifty seconds, hp
      // untouched.
      var dx = bx - p.rect.cx;
      if (Math.abs(dx) > 40) return BJ_walk(p, bx, true, -1);
      if (b.rect.y > 250) BP_jump(23);
      return BP_emit(false, false, false);
    }
    // Riding: STAND UNDER HIM. This looks wrong and is the whole trick.
    //
    // Every card leaves his chest at 186-300 px/s travelling outward and
    // upward, on the side he is facing, which is always the player's side.
    // Working the arcs through, all four land about 309px away from him. So
    // the fan sweeps out an annulus and the one place it cannot reach is his
    // own column. The first version of this policy walked to the left platform
    // to wait for the dip and was killed three times in seventeen seconds,
    // because 176 is almost exactly 309px left of where he opens the fight.
    //
    // Hugging his column also means we are already lined up when he dips,
    // which is the only moment he can be hit.
    //
    // Fight this phase from the FLOOR. The platforms sit 96px higher, which
    // puts us into the flat card's corridor a full 50px sooner; dropping off
    // onto the floor is free in phase 1, since there is no gas until phase 2.
    // HOLD ONE SPOT ON THE LEFT DECK, AND LET HIM COME.
    //
    // Two measurements decide this between them. First, pinning the player at
    // fixed standoffs for 25s: D=0 takes ZERO hits and every other distance
    // takes one, because his fan always lands 290-360px away on the side he
    // faces, so his own column is the hole in it. Second, and less obvious —
    // tracing every dip showed four of five jumps topping out at 394 against a
    // head at 330. The bot was BONKING ITS HEAD on the underside of a platform.
    // At D=0 on the floor he had drifted it under the centre deck, whose
    // underside is at 352, capping the jump at 396.
    //
    // So D=0 is right and the floor is wrong. Standing on the left deck gives
    // both: he still drifts onto our column, the cards still land 294px away
    // (off the side of the arena from here), and there is nothing overhead, so
    // the jump runs its full 144px from 384 up to 240 — a hundred pixels of
    // margin over his head instead of twelve.
    BJ_why = 'under';
    var D = BJ_HOLD - p.rect.cx;
    var wantDir = Math.abs(D) < 20 ? 0 : (D > 0 ? 1 : -1);
    var pick = BJ_pick(b, p, wantDir);
    // Clear of everything and already under him: hold still and wait for the dip.
    if (pick.dir === 0) { BJ_run = false; return BP_emit(false, false, false); }
    // Never dodge off the deck: the floor below has the deck itself as a
    // ceiling, and a jump from under it tops out 60px short of his head.
    // Never dodge out of the clear column: a step either way puts a deck
    // overhead and the next dip becomes unpunishable.
    var nx = p.rect.cx + pick.dir * 40;
    if (nx < BJ_GAPLO || nx > BJ_GAPHI) {
      BJ_run = false;
      return BP_emit(false, false, false);
    }
    BJ_dir = pick.dir;
    BJ_run = Math.abs(D) > 60;
    return BP_emit(pick.dir < 0, pick.dir > 0, BJ_run);
  }

  // ── PHASE 2: gas floor, three platforms ──────────────────────────────
  if (b.phase === 2) {
    var cur = BJ_onPlat(p);
    // Off the platforms entirely (fell in the gas): climb out at once.
    if (cur < 0) {
      BJ_why = 'gas';
      var best = 0, bd = 1e9;
      for (var i = 0; i < BJ_PLAT.length; i++) {
        var d2 = Math.abs(BJ_PLAT[i].mid - p.rect.cx);
        if (d2 < bd) { bd = d2; best = i; }
      }
      var pl2 = BJ_PLAT[best];
      var toR = pl2.mid > p.rect.cx;
      if (p.onGround) BP_jump(23);
      BJ_dir = toR ? 1 : -1; BJ_run = true;
      return BP_emit(!toR, toR, true);
    }

    // CAMP THE LEFT DECK. Do not chase him around the arena.
    //
    // His next destination is (tpIndex + 1 + (player right of centre ? 1 : 0))
    // % 3, so staying left of centre pins the cycle to +1 and he walks the
    // fixed loop 0 -> 1 -> 2 -> 0. Spot 0 IS the left deck, so one arrival in
    // every three lands on top of us and is free; the other two we simply sit
    // out at maximum range.
    //
    // The previous rule tried to meet him at his next spot and sent the bot to
    // the centre deck while he was still standing on it. He throws at whoever
    // is nearest: measured, it died three times at p(601,320) against b(480),
    // 121px apart, to the same card every time. Range is the whole defence in
    // this phase.
    var spot = BJ_SPOT_PLAT[b.tpIndex];
    if (b.state === 'arrive' && spot === cur) {
      BJ_why = 'punish';
      var dx2 = bx - p.rect.cx;
      if (Math.abs(dx2) > 26) return BJ_walk(p, bx, true, cur);
      BP_jump(20);
      return BP_emit(false, false, false);
    }
    BJ_why = 'setup';
    if (cur !== 0) {
      // get back to the left deck, one hop at a time
      return BJ_hopTo(p, cur, cur - 1);
    }
    // He does not leave the moment we stomp him: hurt plus teleport is 1.1s
    // during which he is solid again and standing on our deck. Walking away
    // was not fast enough — measured, the bot was caught at x=195 against his
    // hitbox edge at 186, a three-pixel overlap, every single run. So when he
    // is close and not open, SPRINT to the far end of the deck.
    if (!b.vulnerable && Math.abs(bx - p.rect.cx) < 180) {
      BJ_why = 'apartarse';
      var tx = bx < p.rect.cx ? BJ_PLAT[0].x1 - 24 : BJ_PLAT[0].x0 + 24;
      var dAway = tx - p.rect.cx;
      if (Math.abs(dAway) > 12) {
        BJ_dir = dAway > 0 ? 1 : -1; BJ_run = true;
        return BP_emit(dAway < 0, dAway > 0, true);
      }
      return BP_emit(false, false, false);
    }
    // On station. Sit at the far end from wherever he is, and shuffle along the
    // deck if a card is actually coming.
    var hold = bx > 300 ? BJ_PLAT[0].x0 + 40 : BJ_PLAT[0].x1 - 40;
    if (card) hold = p.rect.cx + (card.dx > 0 ? -70 : 70);
    return BJ_walk(p, hold, false, 0);
  }

  // ── PHASE 3: centre of the floor, cards and minions ──────────────────
  if (b.state === 'throw') {
    BJ_why = 'punish3';
    var dx3 = bx - p.rect.cx;
    if (Math.abs(dx3) > 26) return BJ_walk(p, bx, true, -1);
    BP_jump(21);
    return BP_emit(false, false, false);
  }
  BJ_why = 'wait3';
  // This is the densest phase in the game: five cards every 1.3s and they do
  // not expire until they leave the screen, so the count reaches thirty and the
  // whole band at the player's height fills up. A "step away from the nearest
  // one" rule cannot read that, and measured it is what ended every run here.
  // Use the same forward simulation phase 1 uses — it is built for exactly this
  // and it already has the card paths integrated.
  //
  // The heading it is nudged toward loiters just outside his contact range, so
  // the next punish is a short hop rather than a sprint across the minions he
  // keeps spawning.
  // STAND CLOSE. Same annulus argument as phase 1, re-derived for him standing
  // on the floor: his cards leave at cy=432 and cross the player's height
  // (~458) between 103 and 213px away, so the ring that kills is 103-213 and
  // parking at 130 — which is what this did — is the worst spot on the floor.
  // Inside it, anywhere past his 48px hitbox is clear. So loiter at 78: close
  // enough that the fan passes overhead, far enough not to be touching him,
  // and a short hop from the punish.
  var side = p.rect.cx < bx ? -1 : 1;
  var park = bx + side * 78;
  if (park < 100) park = 100;
  if (park > 860) park = 860;
  var w3 = Math.abs(park - p.rect.cx) < 30 ? 0 : (park > p.rect.cx ? 1 : -1);
  var pk3 = BJ_pick(b, p, w3);
  if (pk3.dir === 0) { BJ_run = false; return BP_emit(false, false, false); }
  BJ_dir = pk3.dir; BJ_run = true;
  return BP_emit(pk3.dir < 0, pk3.dir > 0, true);
}
