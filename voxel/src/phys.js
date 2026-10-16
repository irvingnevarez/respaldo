// ═══════════════════════════════════════════════════════════════════════
//  PHYS — a body is an axis-aligned box standing on its feet.
//
//  Movement is resolved one axis at a time, in steps shorter than a block, so a
//  fast body can never tunnel through a wall. A body that walks into a ledge no
//  taller than a block steps up onto it (the kerb, the sidewalk, a stair). The
//  world answers `isSolid(x, y, z)` and treats unloaded chunks as solid, so a body
//  that outruns the loader stops at the edge of the known world.
//
//  Nothing here touches the GPU: the same code runs under Node for the bot tests.
// ═══════════════════════════════════════════════════════════════════════

var PH_GRAV = 29;          // blocks / s^2
var PH_STEP = 1.06;        // tallest ledge a walking body climbs without jumping
var PH_E = 1e-3;

function PH_body(x, y, z, hw, h) {
  return { x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, hw: hw, h: h, onGround: false, inWater: false, headWater: false, hitX: false, hitZ: false, hitUp: false, groundBlock: 0 };
}

// Does the box [x0,x1) x [y0,y1) x [z0,z1) overlap any solid voxel?
function PH_overlaps(world, x0, y0, z0, x1, y1, z1) {
  const ax = Math.floor(x0), bx = Math.floor(x1 - 1e-6);
  const ay = Math.floor(y0), by = Math.floor(y1 - 1e-6);
  const az = Math.floor(z0), bz = Math.floor(z1 - 1e-6);
  for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) {
    if (world.isSolid(x, y, z)) return true;
  }
  return false;
}
function PH_free(world, b, x, y, z) { return !PH_overlaps(world, x - b.hw, y, z - b.hw, x + b.hw, y + b.h, z + b.hw); }

// Move along one axis; snap flush against whatever blocks it. Returns true if blocked.
function PH_axis(world, b, axis, d) {
  if (d === 0) return false;
  const hw = b.hw, h = b.h;
  let nx = b.x, ny = b.y, nz = b.z;
  if (axis === 0) nx += d; else if (axis === 1) ny += d; else nz += d;
  if (!PH_overlaps(world, nx - hw, ny, nz - hw, nx + hw, ny + h, nz + hw)) { b.x = nx; b.y = ny; b.z = nz; return false; }
  if (axis === 0) b.x = d > 0 ? Math.floor(nx + hw) - hw - PH_E : Math.floor(nx - hw) + 1 + hw + PH_E;
  else if (axis === 1) b.y = d > 0 ? Math.floor(ny + h) - h - PH_E : Math.floor(ny) + 1 + PH_E;
  else b.z = d > 0 ? Math.floor(nz + hw) - hw - PH_E : Math.floor(nz - hw) + 1 + hw + PH_E;
  return true;
}

// One horizontal sub-step with step-up. `canStep` is false in the air.
function PH_horiz(world, b, dx, dz, canStep) {
  const x0 = b.x, z0 = b.z;
  let hitX = false, hitZ = false;
  if (dx !== 0 && PH_axis(world, b, 0, dx)) hitX = true;
  if (dz !== 0 && PH_axis(world, b, 2, dz)) hitZ = true;
  if ((hitX || hitZ) && canStep) {
    // try to climb: find the smallest lift that frees the intended move
    const wantX = x0 + dx, wantZ = z0 + dz;
    for (let lift = 0.25; lift <= PH_STEP + 1e-6; lift += 0.2) {
      const ty = b.y + lift;
      // room above the body for the lift itself
      if (!PH_free(world, b, b.x, ty, b.z)) break;
      // the move, taken on whichever axes were blocked, must now be clear
      const nx = hitX ? wantX : b.x, nz = hitZ ? wantZ : b.z;
      if (PH_free(world, b, nx, ty, nz)) {
        b.x = nx; b.z = nz; b.y = ty;
        // settle back down onto the ledge so the climb is not a hop
        PH_axis(world, b, 1, -lift);
        hitX = hitZ = false;
        break;
      }
    }
  }
  if (hitX) b.hitX = true;
  if (hitZ) b.hitZ = true;
}

// Advance a body by dt using its own velocity. Gravity is NOT applied here: the
// controller decides that (a glide, a grapple and a swim all differ).
function PH_move(world, b, dt) {
  b.hitX = b.hitZ = b.hitUp = false;
  const was = b.onGround;
  const dist = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
  const n = Math.max(1, Math.ceil(dist / 0.4));
  const sx = b.vx * dt / n, sz = b.vz * dt / n;
  let sy = b.vy * dt / n, landed = false;
  for (let i = 0; i < n; i++) {
    if (sy !== 0) {
      if (PH_axis(world, b, 1, sy)) {
        // a floor ends the fall, a ceiling ends the rise; either way the sideways
        // part of the move carries on for the rest of the frame
        if (sy < 0) landed = true; else b.hitUp = true;
        b.vy = 0; sy = 0;
      }
    }
    PH_horiz(world, b, sx, sz, was || landed);
  }
  // ground test: is there a solid voxel just under the feet?
  b.onGround = false; b.groundBlock = 0;
  if (b.vy <= 0.01) {
    const gy = b.y - 0.04;
    const ax = Math.floor(b.x - b.hw + 1e-3), bx = Math.floor(b.x + b.hw - 1e-3);
    const az = Math.floor(b.z - b.hw + 1e-3), bz = Math.floor(b.z + b.hw - 1e-3);
    const cy = Math.floor(gy);
    for (let x = ax; x <= bx && !b.onGround; x++) for (let z = az; z <= bz; z++) {
      if (world.isSolid(x, cy, z)) { b.onGround = true; b.groundBlock = world.getBlock(x, cy, z); break; }
    }
  }
  // water: a block of it at the waist, and another at the eyes
  b.inWater = world.getBlock(Math.floor(b.x), Math.floor(b.y + b.h * 0.45), Math.floor(b.z)) === BK.WATER;
  b.headWater = world.getBlock(Math.floor(b.x), Math.floor(b.y + b.h * 0.92), Math.floor(b.z)) === BK.WATER;
  return landed;
}

// Walking off a kerb should be a step down, not a fall: when the floor is within
// `maxDrop` below a grounded body, glue it to that floor. Returns true if it moved.
function PH_stick(world, b, maxDrop) {
  if (PH_free(world, b, b.x, b.y - maxDrop, b.z)) return false;     // nothing to land on that close
  const y0 = b.y;
  PH_axis(world, b, 1, -maxDrop);
  b.vy = 0; b.onGround = true;
  return b.y < y0 - 1e-4;
}

// The box of a body, as [x0,y0,z0,x1,y1,z1] for hit tests.
function PH_aabbHit(a, b) {
  return Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.z - b.z) < a.hw + b.hw && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Segment-vs-sphere: where along the segment p -> p + d (length 1 in t) does it
// first come within r of c? Returns t in [0,1] or -1.
function PH_segSphere(px, py, pz, dx, dy, dz, cx, cy, cz, r) {
  const mx = px - cx, my = py - cy, mz = pz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return (mx * mx + my * my + mz * mz) <= r * r ? 0 : -1;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return (t >= 0 && t <= 1) ? t : -1;
}
