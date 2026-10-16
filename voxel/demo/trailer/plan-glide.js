// Plans the trailer's glide: Batman leaps from the police tower and glides for
// fifteen seconds. The glide steers by the camera, so the plan is a schedule of
// camera yaw and pitch. Hundreds of schedules are flown on the real simulation
// under Node; the one kept never touches a wall, stays in the air, and spends
// the most time threading between towers instead of high above them.
//   node voxel/demo/trailer/plan-glide.js [tries=400] [seed=7]
const { make } = require('../sim');
const fs = require('fs'), path = require('path');
const TPsrc = fs.readFileSync(path.join(__dirname, 'pilot.js'), 'utf8');
const TP = new Function(TPsrc + '; return { TP_glide, TP_sample };')();
const TRIES = +(process.argv[2] || 400), SEED = +(process.argv[3] || 7);
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const KT = [1.2, 3, 5, 7, 9, 11, 13, 15.5];          // keyframe times (s from the start of the leap shot)
const DUR = 15.2;

function sample(keys, t) {
  if (t <= KT[0]) return keys[0];
  for (let i = 1; i < KT.length; i++) if (t <= KT[i]) {
    const u = (t - KT[i - 1]) / (KT[i] - KT[i - 1]), e = u * u * (3 - 2 * u);
    return keys[i - 1] + (keys[i] - keys[i - 1]) * e;
  }
  return keys[keys.length - 1];
}

function fly(plan, trace) {
  const S = make({ noEnemies: true });
  const { pl, world } = S;
  S.place(36.5, 93.01, -16.5, Math.PI / 2);
  S.look(Math.PI / 2, -0.2);
  S.press('KeyW', true); S.press('ShiftLeft', true);
  let jumped = false, glid = false, fail = '', score = 0, minY = 999, maxV = 0, tGlide = 0;
  const pst = { yaw: Math.PI / 2, pitch: -0.2 };
  const dirs = []; for (let k = 0; k < 8; k++) dirs.push([Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);
  const steps = Math.round(DUR * 120);
  for (let i = 0; i < steps; i++) {
    const t = i / 120;
    if (!jumped && pl.b.x > 37.4) { S.press('Space', true); jumped = true; }
    if (jumped && !glid) S.press('Space', pl.airT < 0.05);
    if (jumped && !glid && pl.airT > 0.45) { S.press('Space', false); S.tap('Space'); glid = true; tGlide = t; S.press('KeyW', false); S.press('ShiftLeft', false); }
    if (glid) { TP.TP_glide(pst, pl, world, t, plan, 1 / 120); S.look(pst.yaw, pst.pitch); }
    else S.look(Math.PI / 2, -0.2);
    S.step(1);
    if (glid && t > tGlide + 0.2) {
      if (pl.mode !== 'glide') { fail = 'dejó de planear a ' + t.toFixed(1) + 's (' + pl.mode + ')'; break; }
      if (pl.b.hitX || pl.b.hitZ || pl.b.hitUp) { fail = 'chocó a ' + t.toFixed(1) + 's'; break; }
      minY = Math.min(minY, pl.b.y); maxV = Math.max(maxV, pl.gl.v);
      if (i % 12 === 0) {
        // threading: walls near on the sides, none dangerously close
        let near = 0, tooClose = false;
        for (const d of dirs) {
          const h = world.raycast(pl.b.x, pl.b.y + 0.9, pl.b.z, d[0], 0, d[1], 16);
          if (h) { if (h.t < 2.8) tooClose = true; else if (h.t < 13) near++; }
        }
        const down = world.raycast(pl.b.x, pl.b.y, pl.b.z, 0, -1, 0, 60);
        if (tooClose) score -= 6;
        else score += Math.min(near, 3) * 1.0 + (down && down.t < 14 ? 0.6 : 0);
        if (trace) trace.push([+t.toFixed(2), +pl.b.x.toFixed(1), +pl.b.y.toFixed(1), +pl.b.z.toFixed(1), +pl.gl.v.toFixed(1), near]);
      }
    }
  }
  if (!fail && pl.b.y < 30) fail = 'demasiado bajo al final';
  if (!fail && minY < 34) fail = 'bajó a ' + minY.toFixed(0);
  // a dive is more fun than a float: reward speed
  return { fail, score: score + maxV * 1.5, minY, maxV, end: [pl.b.x, pl.b.y, pl.b.z], tGlide };
}

let best = null;
const t0 = Date.now();
let ok = 0; const fails = {};
for (let n = 0; n < TRIES; n++) {
  const plan = { yaw: [], pitch: [] };
  let y = 0;
  for (let k = 0; k < KT.length; k++) {
    y += (rnd() - 0.5) * 1.0; y = Math.max(-1.3, Math.min(1.3, y));
    plan.yaw.push(k === 0 ? 0 : +y.toFixed(3));
    plan.pitch.push(+(k === 0 ? -0.25 : -0.55 + rnd() * 0.75).toFixed(3));
  }
  const r = fly(plan);
  if (r.fail) { fails[r.fail.replace(/[0-9.]+/g, '#')] = (fails[r.fail.replace(/[0-9.]+/g, '#')] || 0) + 1; if (n < 3) console.log('  #' + n + ' ' + r.fail + ' tGlide=' + r.tGlide); continue; }
  ok++;
  if (!best || r.score > best.r.score) { best = { plan, r }; console.log('  mejor hasta ahora #' + n + ': puntuación ' + r.score.toFixed(1) + ' minY ' + r.minY.toFixed(0) + ' vmax ' + r.maxV.toFixed(1) + ' fin ' + r.end.map(v => v.toFixed(0)).join(',')); }
}
console.log('fallos: ' + JSON.stringify(fails));
console.log('probados ' + TRIES + ', válidos ' + ok + ', ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
if (best) {
  const trace = []; fly(best.plan, trace);
  console.log('PLAN ' + JSON.stringify(best.plan));
  console.log('trayectoria (t,x,y,z,v,muros cerca): ' + trace.filter((_, i) => i % 5 === 0).map(a => a.join(' ')).join(' | '));
}
