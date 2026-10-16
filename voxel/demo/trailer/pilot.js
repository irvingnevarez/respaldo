// The trailer's glide pilot. It flies Batman through the city the way a good
// player would: it wants to go where the route says, but it looks ahead along
// several headings and banks toward open air before a wall arrives. It reads only
// the world and the player, so the same file steers the Node planner and the
// browser recording, and both fly the same line.
var TP_KT = [1.2, 3, 5, 7, 9, 11, 13, 15.5];

function TP_sample(keys, t) {
  if (t <= TP_KT[0]) return keys[0];
  for (let i = 1; i < TP_KT.length; i++) if (t <= TP_KT[i]) {
    const u = (t - TP_KT[i - 1]) / (TP_KT[i] - TP_KT[i - 1]), e = u * u * (3 - 2 * u);
    return keys[i - 1] + (keys[i] - keys[i - 1]) * e;
  }
  return keys[keys.length - 1];
}

// st: { yaw, pitch } carried between calls; returns it updated.
function TP_glide(st, pl, world, t, plan, dt) {
  const want = Math.PI / 2 + TP_sample(plan.yaw, t);
  let pitch = TP_sample(plan.pitch, t);
  const th = pl.mode === 'glide' ? pl.gl.th : 0.2;
  const ox = pl.b.x, oy = pl.b.y + 0.9, oz = pl.b.z;
  let best = st.yaw, bs = -1e9, bestClear = 0;
  for (let k = -6; k <= 6; k++) {
    const yaw = st.yaw + k * 0.16;
    let clear = 60;
    for (const off of [-0.13, 0, 0.13]) {
      const a = yaw + off, ch = Math.cos(th);
      const dx = Math.sin(a) * ch, dy = -Math.sin(th), dz = -Math.cos(a) * ch;
      const h = world.raycast(ox, oy, oz, dx, dy, dz, 60);
      if (h) clear = Math.min(clear, h.t);
    }
    let dWant = yaw - want; while (dWant > Math.PI) dWant -= 2 * Math.PI; while (dWant < -Math.PI) dWant += 2 * Math.PI;
    const sc = Math.min(clear, 45) * 1.0 - Math.abs(dWant) * 9 - Math.abs(k) * 0.4 - (clear < 14 ? 40 : 0);
    if (sc > bs) { bs = sc; best = yaw; bestClear = clear; }
  }
  // turn toward it smoothly, never faster than a person would swing the mouse
  const rate = bestClear < 18 ? 1.6 : 0.9;
  const d = best - st.yaw;
  st.yaw += Math.max(-rate * dt, Math.min(rate * dt, d * Math.min(1, dt * 6)));
  // pull up when the street comes too close, dive when there is room
  const down = world.raycast(ox, oy, oz, 0, -1, 0, 40);
  if (down && down.t < 11) pitch = Math.max(pitch, 0.18);
  if (bestClear < 14) pitch = Math.max(pitch, 0.05);
  st.pitch += (pitch - st.pitch) * Math.min(1, dt * 2.5);
  return st;
}
