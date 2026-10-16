// Physics checks on the real generated city, no browser.  node voxel/demo/phys-test.js
const { load } = require('./litew');
const { C, LiteWorld } = load(['noise', 'blocks', 'worldgen', 'jobs', 'phys', 'world'],
  'PH_body, PH_move, PH_stick, PH_overlaps, PH_free, PH_GRAV, WG_GY, WG_PITCH, WG_ST, WG_K, WG_colInfo, WG_topMass');
const w = new LiteWorld();
let bad = 0;
const ok = (name, cond, info) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + name + (info ? '   ' + info : '')); if (!cond) bad++; };
const step = (b, dt, g) => { b.vy -= (g === undefined ? C.PH_GRAV : g) * dt; C.PH_move(w, b, dt); };

// 1. fall onto the road and stand still on it
{
  const b = C.PH_body(5.5, 60, 70.5, 0.3, 1.8);
  for (let i = 0; i < 240; i++) step(b, 1 / 60);
  ok('cae a la calzada', b.onGround && Math.abs(b.y - 26) < 0.01, 'y=' + b.y.toFixed(3));
  const y0 = b.y; for (let i = 0; i < 120; i++) step(b, 1 / 60);
  ok('queda quieto', Math.abs(b.y - y0) < 1e-3 && b.onGround);
}
// 2. walk east across the street and up the kerb
{
  const b = C.PH_body(5.5, 26, 70.5, 0.3, 1.8);
  for (let i = 0; i < 20; i++) step(b, 1 / 60);
  let maxY = b.y;
  for (let i = 0; i < 60; i++) { b.vx = 6; step(b, 1 / 60); maxY = Math.max(maxY, b.y); }
  ok('sube la acera sin saltar', b.y > 26.9 && b.onGround, 'x=' + b.x.toFixed(2) + ' y=' + b.y.toFixed(3));
}
// 3. a wall stops the body and it does not enter it
{
  // the building block east of the first street: x in [58..]
  const b = C.PH_body(40.5, 27, 10.5, 0.3, 1.8);
  // find any solid wall to the east on this row
  let wx = -1; for (let x = 41; x < 120; x++) if (w.isSolid(x, 30, 10)) { wx = x; break; }
  b.y = Math.max(27, w.groundY(40.5, 10.5, 40));
  for (let i = 0; i < 20; i++) step(b, 1 / 60);
  for (let i = 0; i < 300; i++) { b.vx = 8; step(b, 1 / 60); }
  ok('el muro lo detiene', wx < 0 || (b.x + 0.3 <= wx + 0.001 && b.hitX), 'muro en x=' + wx + ' cuerpo x=' + b.x.toFixed(3));
}
// 4. jump height
{
  const b = C.PH_body(5.5, 26, 70.5, 0.3, 1.8);
  for (let i = 0; i < 20; i++) step(b, 1 / 60);
  b.vy = 10.2; let top = b.y;
  for (let i = 0; i < 120; i++) { step(b, 1 / 60); top = Math.max(top, b.y); }
  const h = top - 26;
  ok('salto de ~1.8 bloques', h > 1.6 && h < 2.0, 'altura=' + h.toFixed(2));
  ok('aterriza de nuevo', b.onGround && Math.abs(b.y - 26) < 0.01);
}
// 5. no tunnelling at terminal velocity
{
  const b = C.PH_body(5.5, 110, 70.5, 0.3, 1.8);
  b.vy = -90;
  for (let i = 0; i < 90; i++) { C.PH_move(w, b, 1 / 30); b.vy = Math.max(b.vy - 29 / 30, -90); }
  ok('no atraviesa el suelo a 90 b/s', b.y > 25.99, 'y=' + b.y.toFixed(3));
}
// 6. a sweep over many positions: a body is never left inside a solid
{
  let inside = 0, n = 0;
  for (let k = 0; k < 400; k++) {
    const x = 20 + (k * 37) % 300 + 0.5, z = -200 + (k * 53) % 300 + 0.5;
    const b = C.PH_body(x, 50, z, 0.3, 1.8);
    b.y = w.groundY(x, z, 126) + 0.01;
    for (let i = 0; i < 150; i++) {
      const a = (k * 0.7 + i * 0.02);
      b.vx = Math.cos(a) * 9; b.vz = Math.sin(a) * 9;
      if (i % 40 === 5 && b.onGround) b.vy = 10;
      step(b, 1 / 60);
      n++;
      if (C.PH_overlaps(w, b.x - b.hw, b.y, b.z - b.hw, b.x + b.hw, b.y + b.h, b.z + b.hw)) inside++;
    }
  }
  ok('nunca queda dentro de un sólido', inside === 0, inside + ' de ' + n + ' pasos');
}
console.log(bad ? '\n' + bad + ' FALLOS' : '\ntodo bien');
process.exit(bad ? 1 : 0);
