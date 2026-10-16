// Numbers for how the game FEELS, measured on the real simulation under Node.
//   node voxel/demo/feel.js [walk|jump|glide|grapple|combat]
const { make } = require('./sim');
const which = process.argv.slice(2);
const run = n => !which.length || which.includes(n);
const f = (v, d) => v.toFixed(d === undefined ? 2 : d);

if (run('walk')) {
  const S = make({ noEnemies: true });
  const { pl, C } = S;
  S.place(23, S.C.LM.gcpd.y, -13, Math.PI / 2); S.look(Math.PI / 2, -0.1); S.step(60);
  S.press('KeyW', true); S.step(60);
  const x0 = pl.b.x; S.step(60); const walk = (pl.b.x - x0) * 2;
  S.press('KeyW', false); S.step(60);
  S.place(21, S.C.LM.gcpd.y, -13, Math.PI / 2); S.step(30);
  S.press('KeyW', true); S.press('ShiftLeft', true); S.step(60);
  const x1 = pl.b.x; S.step(60); const run = (pl.b.x - x1) * 2;
  console.log('andar  ' + f(walk) + ' b/s    correr ' + f(run) + ' b/s');
}
if (run('jump')) {
  const S = make({ noEnemies: true });
  const { pl } = S;
  S.step(60);
  const y0 = pl.b.y; S.press('Space', true); S.step(1); let top = y0, t = 0;
  for (let i = 0; i < 240; i++) { S.step(1); top = Math.max(top, pl.b.y); if (i > 20 && pl.b.onGround) { t = i / 120; break; } }
  S.press('Space', false);
  console.log('salto  altura ' + f(top - y0) + ' bloques, en el aire ' + f(t) + ' s');
}
if (run('glide')) {
  for (const [name, pitch, hold] of [['nivelado', 0.0, 0], ['picado', -0.55, 0], ['remonte', 0.5, 0]]) {
    const S = make({ noEnemies: true });
    const { pl } = S;
    S.place(33, S.C.LM.gcpd.y, -13, Math.PI / 2); S.look(Math.PI / 2, -0.05); S.step(60);
    S.press('KeyW', true); S.press('ShiftLeft', true);
    let jumped = false, glid = false, x0 = 0, t0 = 0, maxV = 0, minV = 99, ymin = 999, trace = [];
    for (let i = 0; i < 4000; i++) {
      if (!jumped && pl.b.x > 36.2) { S.press('Space', true); S.step(1); S.press('Space', false); jumped = true; }
      if (jumped && !glid && pl.b.x > 41 && pl.b.y < 92.5 && !pl.b.onGround) { S.tap('Space'); glid = true; S.look(Math.PI / 2, pitch); x0 = pl.b.x; t0 = S.t; }
      S.step(1);
      if (glid && pl.mode === 'glide') { maxV = Math.max(maxV, pl.gl.v); minV = Math.min(minV, pl.gl.v); if (i % 120 === 0) trace.push(f(pl.b.y, 0) + '@' + f(pl.b.x - x0, 0) + ' v' + f(pl.gl.v, 0)); }
      if (glid && pl.b.onGround) break;
    }
    const dx = Math.hypot(pl.b.x - x0, pl.b.z - -13), dt = S.t - t0;
    console.log('planeo ' + name.padEnd(9) + ' distancia ' + f(dx, 0) + ' b en ' + f(dt, 1) + ' s, v ' + f(minV, 1) + '..' + f(maxV, 1) + ' b/s  modo final ' + pl.mode + '  [' + trace.join(' ') + ']');
  }
}
if (run('grapple')) {
  const S = make({ noEnemies: true });
  const { pl, C } = S;
  const g = C.LM.gcpd;
  // a spot in the street south of the tower where nothing parked stands in the way
  let sx = g.cx;
  for (let dx = -14; dx <= 14; dx++) {
    S.place(g.cx + dx, 26, 5, 0); S.step(30); S.look(0, 0.1); S.step(2);
    const h = S.world.raycast(S.cam.x, S.cam.y, S.cam.z, S.cam.fx, S.cam.fy, S.cam.fz, 85);
    if (h && h.t > 8 && h.z < 0) { sx = g.cx + dx; break; }
  }
  for (const [pitch, label] of [[0.0, 'horizontal'], [0.35, 'hacia arriba'], [0.7, 'muy arriba'], [-0.1, 'hacia abajo']]) {
    S.place(sx, 26, 5, 0); S.step(60);
    S.look(0, pitch); S.step(2);
    const gg = pl.findGrapple(S.world, S.cam);
    S.tap('KeyE'); S.step(1);
    const started = !!pl.grap;
    let t = 0;
    for (; t < 600 && pl.grap; t++) S.step(1);
    S.step(120);
    console.log('garfio ' + label.padEnd(13) + ' objetivo=' + (gg ? gg.kind + ' a ' + f(gg.dist, 0) + ' b, ancla y=' + f(gg.ay, 0) : 'ninguno') + '  arrancó=' + started + '  tardó ' + f(t / 120) + ' s  final y=' + f(pl.b.y) + ' x=' + f(pl.b.x, 1) + ' z=' + f(pl.b.z, 1) + ' suelo=' + pl.b.onGround + ' ' + pl.mode);
  }
}
if (run('combat')) {
  const S = make();
  const { pl, C, G } = S;
  S.step(30);
  S.place(33, S.C.LM.gcpd.y, -19, Math.PI / 2); S.step(30);
  // a clown two metres away, already angry
  const e = new C.Enemy('clown', pl.b.x + 3.2, pl.b.y, pl.b.z, null); e.alert = true; e.state = 'chase'; G.enemies.push(e);
  S.look(Math.PI / 2, -0.1);
  let hp0 = pl.hp, swung = 0, killedAt = -1, hurtAt = -1;
  for (let i = 0; i < 1500; i++) {
    if (i % 40 === 0 && !e.dead) { S.tap('KeyJ'); swung++; }
    S.step(1);
    if (e.dead && killedAt < 0) killedAt = S.t;
    if (pl.hp < hp0 && hurtAt < 0) hurtAt = S.t;
    if (e.gone) break;
  }
  console.log('combate payaso: golpes lanzados ' + swung + ', muerto a los ' + (killedAt < 0 ? 'nunca' : f(killedAt) + ' s') + ', daño recibido ' + (hp0 - pl.hp) + (hurtAt >= 0 ? ' (primer golpe a ' + f(hurtAt) + ' s)' : '') + '  puntos ' + G.score + ' combo máx ' + G.bestCombo);
  // standing still against a goon: how long until the first shot lands?
  const S2 = make();
  S2.place(33, S2.C.LM.gcpd.y, -19, 0); S2.step(30);
  const g2 = new S2.C.Enemy('goon', S2.pl.b.x, S2.pl.b.y, S2.pl.b.z + 7, null); g2.alert = true; g2.state = 'chase'; S2.G.enemies.push(g2);
  let h2 = -1;
  for (let i = 0; i < 2400; i++) { S2.step(1); if (S2.pl.hp < 5 && h2 < 0) { h2 = S2.t; break; } }
  console.log('matón a 7 b: primera bala acierta a los ' + (h2 < 0 ? 'nunca' : f(h2) + ' s'));
}
