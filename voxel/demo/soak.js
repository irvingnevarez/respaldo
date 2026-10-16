// A random-input bot plays for minutes of game time all over the city while the real
// simulation runs under Node. It finds crashes (an exception anywhere in the update),
// NaNs, and bodies stuck inside solid voxels, which no fixed script would.
//   node voxel/demo/soak.js [minutes=3] [seed=1]
const { make } = require('./sim');
const MIN = +(process.argv[2] || 3), SEED = +(process.argv[3] || 1);
let s = SEED * 2654435761 >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
Math.random = rnd;                       // deterministic enemies and effects too

const S = make();
const { pl, C, G, world } = S;
let bad = 0, nan = 0, stuck = 0, deaths = 0, maxEn = 0, maxProj = 0, kills = 0, steps = 0, grapples = 0, glides = 0, punches = 0, bosses = 0;
const t0 = Date.now();
const spots = [];
const L = C.LM;
// interesting places: spawn roof, the bridge, arenas, each beacon, and random streets
spots.push([L.spawn.x, L.spawn.y, L.spawn.z]);
for (const b of L.beacons) spots.push([b.x + 3, b.y + 0.2, b.z]);
for (const a of L.arenas) spots.push([a.cx, 27.01, a.cz + 12]);
spots.push([5.5, 26.01, L.bridge.cz - 30], [5.5, 26.01, L.bridge.cz + 10]);
for (let i = 0; i < 14; i++) { const bx = Math.floor(rnd() * 24) - 12, bz = Math.floor(rnd() * 22) - 11; spots.push([bx * 48 + 5.5, 26.01, bz * 48 + 5.5]); }

let yaw = 0, mv = { w: 0, s: 0, a: 0, d: 0 }, sprint = false;
const total = Math.floor(MIN * 60 * 120);
let spotI = 0;
try {
  for (let i = 0; i < total; i++) {
    if (i % (120 * 25) === 0) {              // every 25 s of game time: somewhere new
      const sp = spots[spotI++ % spots.length];
      // find ground at spots that are not on roofs
      S.place(sp[0], sp[1], sp[2]);
      pl.hp = pl.maxHp; pl.dead = false; pl.mode = 'air'; G.enemies.length = 0; G.camps.clear(); G.projs.length = 0;
      if (G.boss) { C.BS_end(true); }
      const a = L.arenas.find(a => Math.abs(a.cx - sp[0]) < 20 && Math.abs(a.cz - sp[2]) < 20);
      if (a) { C.BS_start(a.style, a); bosses++; }
    }
    if (i % 30 === 0) {                      // every quarter second: new intentions
      if (rnd() < 0.3) { mv = { w: rnd() < 0.7 ? 1 : 0, s: rnd() < 0.1 ? 1 : 0, a: rnd() < 0.2 ? 1 : 0, d: rnd() < 0.2 ? 1 : 0 }; sprint = rnd() < 0.55; }
      S.press('KeyW', !!mv.w); S.press('KeyS', !!mv.s); S.press('KeyA', !!mv.a); S.press('KeyD', !!mv.d); S.press('ShiftLeft', sprint);
      yaw += (rnd() - 0.5) * 1.4; S.tcam.yaw = yaw; S.tcam.pitch = Math.max(-1.2, Math.min(0.9, S.tcam.pitch + (rnd() - 0.5) * 0.5));
      const r = rnd();
      if (r < 0.14) { S.tap('Space'); }
      else if (r < 0.22) { S.tap('KeyE'); grapples++; }
      else if (r < 0.50) { S.tap('KeyJ'); punches++; }
      else if (r < 0.58) S.tap('KeyF');
      else if (r < 0.62) S.tap('KeyQ');
      if (rnd() < 0.5) S.press('Space', true); else S.press('Space', false);
    }
    try { S.step(1); steps++; } catch (e) { console.log('EXCEPCIÓN en paso ' + i + ' (t=' + S.t.toFixed(1) + 's): ' + e.stack.split('\n').slice(0, 4).join(' | ')); bad++; break; }
    const b = pl.b;
    if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.z)) { nan++; console.log('NaN en el jugador', b); break; }
    if (pl.mode === 'glide') glides++;
    if (pl.dead) { deaths++; pl.respawn(pl.lastSafe.x, pl.lastSafe.y + 0.5, pl.lastSafe.z); }
    if (i % 60 === 0) {
      if (C.PH_overlaps && world.isSolid) {
        // is the player inside something?
        let inside = false;
        const ax = Math.floor(b.x - b.hw + 0.01), bx = Math.floor(b.x + b.hw - 0.01), az = Math.floor(b.z - b.hw + 0.01), bz = Math.floor(b.z + b.hw - 0.01);
        for (let x = ax; x <= bx && !inside; x++) for (let z = az; z <= bz && !inside; z++) for (let y = Math.floor(b.y + 0.02); y <= Math.floor(b.y + b.h - 0.02); y++) if (world.isSolid(x, y, z)) { inside = true; break; }
        if (inside) stuck++;
      }
      maxEn = Math.max(maxEn, G.enemies.length); maxProj = Math.max(maxProj, G.projs.length);
      for (const e of G.enemies) if (!isFinite(e.b.x) || !isFinite(e.b.y)) { nan++; console.log('NaN en un enemigo', e.kind); }
    }
  }
} catch (e) { console.log('FALLO: ' + e.stack); bad++; }
console.log('simulado ' + (S.t / 60).toFixed(1) + ' min en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s reales | pasos ' + steps + ' | muertes ' + deaths + ' | muertes de enemigos ' + G.kills + ' | planeo ' + (glides / 120).toFixed(0) + ' s | garfios intentados ' + grapples + ' | golpes ' + punches + ' | jefes ' + bosses);
console.log('máx enemigos ' + maxEn + ', máx proyectiles ' + maxProj + ' | NaN ' + nan + ' | jugador dentro de un sólido (muestras) ' + stuck + ' | excepciones ' + bad);
process.exit(bad || nan ? 1 : 0);
