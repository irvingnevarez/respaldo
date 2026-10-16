// Let each boss run against a player who cannot die, and watch the script work.
//   node voxel/demo/boss-smoke.js [penguin|joker]
const { make } = require('./sim');
const which = process.argv.slice(2);
for (const id of ['penguin', 'joker']) {
  if (which.length && !which.includes(id)) continue;
  const S = make();
  const { pl, C, G } = S;
  const A = C.LM.arenas.find(a => a.style === id);
  // build the world around the arena first so there is floor to stand on
  S.place(A.cx, 27, A.cz + 12, Math.PI); S.step(60);
  C.BS_start(id, A);
  const B = G.boss;
  const seen = new Map(); let hits = 0;
  const log = [];
  let lastState = '', t = 0;
  pl.hp = 99; pl.maxHp = 99;
  let phaseSeen = new Set();
  for (let i = 0; i < 120 * 70; i++) {
    // the player circles the arena slowly so the boss has something to aim at
    const a = i * 0.0035;
    S.look(Math.PI, -0.1);
    pl.b.x = A.cx + Math.cos(a) * 8; pl.b.z = A.cz + Math.sin(a) * 8; pl.b.vx = pl.b.vy = pl.b.vz = 0; pl.b.y = 27.01;
    S.step(1);
    if (B.state !== lastState) { seen.set(B.state, (seen.get(B.state) || 0) + 1); log.push((S.t).toFixed(1) + 's:' + B.state); lastState = B.state; }
    // after 25 s start wounding the boss so the later phases are exercised
    if (i === 120 * 25 || i === 120 * 45) { B.hp = Math.min(B.hp, B.maxHp * (i === 120 * 25 ? 0.6 : 0.3)); B.damage(0.01, 1, 0, 1); }
    phaseSeen.add(B.phase);
    if (pl.hp < 99 && !hits) hits = 1;
    if (B.dead) break;
  }
  console.log(id.padEnd(8) + ' estados: ' + [...seen].map(([k, v]) => k + '×' + v).join(' ') + '   fases ' + [...phaseSeen].join(',') + '   daño al jugador ' + (99 - pl.hp) + '   enemigos ' + G.enemies.length + '   proyectiles ' + G.projs.length);
  console.log('  ' + log.slice(0, 40).join(' '));
}
