// ═══════════════════════════════════════════════════════════════════════
//  INPUT — keyboard, mouse and touch, reduced to one small state object.
//
//  The game reads IN once per frame. Held things (movement, jump, sprint) are
//  plain booleans; one-shot things (attack, grapple, map) are EDGES that the game
//  consumes, so a key held across a lag spike does not fire twice.
//
//  The mouse works two ways. When the browser grants pointer lock, movement turns
//  the camera directly. When it does not — an embedded page, a phone — dragging
//  turns the camera and a short click is an attack. Pointer lock is only ever
//  an upgrade, never a requirement.
// ═══════════════════════════════════════════════════════════════════════

var IN = {
  keys: {},
  lookX: 0, lookY: 0,                    // accumulated camera deltas, in radians
  stickX: 0, stickY: 0,                  // touch stick: x right, y up, -1..1
  jump: false, sprint: false,            // held
  jumpEdge: false, attackEdge: false, batEdge: false, grappleEdge: false,
  mapEdge: false, pauseEdge: false, anyEdge: false, dodgeEdge: false,
  locked: false, touch: false,
  grappleHeld: false,
};

var IN_MOUSE = 0.0022, IN_TOUCH = 0.0058;

function IN_init(stage, canvas) {
  const k = IN.keys;
  window.addEventListener('keydown', e => {
    if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
    k[e.code] = true;
    IN.anyEdge = true;
    switch (e.code) {
      case 'Space': IN.jump = true; IN.jumpEdge = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': IN.sprint = true; break;
      case 'KeyE': IN.grappleEdge = true; IN.grappleHeld = true; break;
      case 'KeyF': case 'KeyK': IN.batEdge = true; break;
      case 'KeyJ': case 'KeyV': IN.attackEdge = true; break;
      case 'KeyQ': case 'ControlLeft': IN.dodgeEdge = true; break;
      case 'KeyM': case 'Tab': IN.mapEdge = true; e.preventDefault(); break;
      case 'KeyP': case 'Escape': IN.pauseEdge = true; break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', e => {
    k[e.code] = false;
    if (e.code === 'Space') IN.jump = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') IN.sprint = false;
    if (e.code === 'KeyE') IN.grappleHeld = false;
  });
  window.addEventListener('blur', () => { for (const c in k) k[c] = false; IN.jump = IN.sprint = false; IN.grappleHeld = false; });

  // ── mouse ──
  let down = null;                       // { x, y, t, moved, button, id }
  const lockOk = () => document.pointerLockElement === canvas;
  document.addEventListener('pointerlockchange', () => { IN.locked = lockOk(); });
  stage.addEventListener('contextmenu', e => e.preventDefault());

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;          // touch has its own handlers below
    IN.anyEdge = true;
    if (typeof VX !== 'undefined' && VX.state === 'map') { const r = stage.getBoundingClientRect(); UI_mapClick(e.clientX - r.left, e.clientY - r.top); return; }
    if (e.target.closest && e.target.closest('#touch')) return;
    if (!lockOk() && !IN.locked && e.button === 0) {
      // a first click asks for pointer lock; if the page refuses, drag-look still works
      try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (err) { }
    }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, button: e.button, id: e.pointerId };
    if (lockOk()) { if (e.button === 0) IN.attackEdge = true; else if (e.button === 2) IN.batEdge = true; down = null; }
  });
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (lockOk()) { IN.lookX += e.movementX * IN_MOUSE; IN.lookY += e.movementY * IN_MOUSE; return; }
    if (down && e.pointerId === down.id) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved += Math.abs(dx) + Math.abs(dy);
      IN.lookX += dx * IN_MOUSE * 1.15; IN.lookY += dy * IN_MOUSE * 1.15;
      down.x = e.clientX; down.y = e.clientY;
    }
  });
  window.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') return;
    if (down && e.pointerId === down.id) {
      // a click that did not become a drag is an attack (left) or a batarang (right)
      if (down.moved < 6 && performance.now() - down.t < 350) { if (down.button === 0) IN.attackEdge = true; else if (down.button === 2) IN.batEdge = true; }
      down = null;
    }
  });

  // ── touch ──
  const stick = document.getElementById('stick'), nub = document.getElementById('nub');
  let stickId = null, lookId = null, lookLast = null;
  const R = 52;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    IN.stickX = dx / R; IN.stickY = -dy / R;
    nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    IN.sprint = Math.hypot(IN.stickX, IN.stickY) > 0.93;
  }
  if (stick) {
    stick.addEventListener('pointerdown', e => { IN.touch = true; IN.anyEdge = true; stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); e.preventDefault(); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
    const end = e => { if (e.pointerId === stickId) { stickId = null; IN.stickX = IN.stickY = 0; IN.sprint = false; nub.style.transform = ''; } };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  }
  // any finger that lands on the picture itself, away from the controls, turns the camera
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    IN.touch = true; IN.anyEdge = true;
    if (e.target.closest('#stick, #acts, #sys')) return;
    if (lookId === null) { lookId = e.pointerId; lookLast = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; }
  });
  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || e.pointerId !== lookId) return;
    const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
    lookLast.moved += Math.abs(dx) + Math.abs(dy);
    IN.lookX += dx * IN_TOUCH; IN.lookY += dy * IN_TOUCH;
    lookLast.x = e.clientX; lookLast.y = e.clientY;
  });
  const lookEnd = e => {
    if (e.pointerType !== 'touch' || e.pointerId !== lookId) return;
    // a tap on the picture, not a drag, throws a punch
    if (lookLast.moved < 8 && performance.now() - lookLast.t < 280) IN.attackEdge = true;
    lookId = null; lookLast = null;
  };
  window.addEventListener('pointerup', lookEnd); window.addEventListener('pointercancel', lookEnd);

  function bindBtn(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', e => { IN.touch = true; IN.anyEdge = true; el.setPointerCapture(e.pointerId); el.classList.add('on'); onDown(); e.preventDefault(); });
    const up = () => { el.classList.remove('on'); if (onUp) onUp(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  bindBtn('tbJ', () => { IN.jump = true; IN.jumpEdge = true; }, () => { IN.jump = false; });
  bindBtn('tbG', () => { IN.grappleEdge = true; IN.grappleHeld = true; }, () => { IN.grappleHeld = false; });
  bindBtn('tbB', () => { IN.batEdge = true; });
  bindBtn('tbP', () => { IN.attackEdge = true; });
  bindBtn('tbM', () => { IN.mapEdge = true; });
  bindBtn('tbS', () => { if (typeof AU_toggle === 'function') AU_toggle(); });
}

// The movement the player is asking for, in the camera's frame: x right, z forward.
function IN_move() {
  const k = IN.keys;
  let x = 0, z = 0;
  if (k.KeyW || k.ArrowUp) z += 1;
  if (k.KeyS || k.ArrowDown) z -= 1;
  if (k.KeyD || k.ArrowRight) x += 1;
  if (k.KeyA || k.ArrowLeft) x -= 1;
  x += IN.stickX; z += IN.stickY;
  const m = Math.hypot(x, z);
  if (m > 1) { x /= m; z /= m; }
  return { x: x, z: z, mag: Math.min(1, m) };
}

// Take the accumulated look delta (and clear it).
function IN_takeLook(out) {
  out.x = IN.lookX; out.y = IN.lookY; IN.lookX = 0; IN.lookY = 0;
  const k = IN.keys;
  return out;
}
function IN_clearEdges() {
  IN.jumpEdge = IN.attackEdge = IN.batEdge = IN.grappleEdge = IN.mapEdge = IN.pauseEdge = IN.anyEdge = IN.dodgeEdge = false;
}
