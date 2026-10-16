// The whole game simulation under plain Node: the real Player, enemies, projectiles,
// physics and camera, standing on the real generated city, with no GPU and no clock.
// A test sets IN.* like a keyboard would and calls step(); it reads the results from
// the same objects the renderer reads. Deterministic for a given seed of Math.random.
//   const { make } = require('./sim');  const S = make();  S.step(60);
const { load } = require('./litew');
const NAMES = ['math', 'noise', 'blocks', 'worldgen', 'landmarks', 'bake', 'jobs', 'shaders', 'world', 'phys', 'models', 'anim', 'fx', 'enemies', 'player', 'bosses', 'props', 'input'];
const STUB = `
var VX = { state: 'play', time: 0, fadeTo: 0, fadeSpeed: 1, fade: 0 };
function VX_setState(s) { VX.state = s; }
var UI = { mapMsg: '', mapMsgT: 0 };
function UI_banner() { } function UI_hint() { }
var FXS = { sparks() {}, debris() {}, puff() {}, dust() {}, burst() {}, glow() {}, text() {}, add() {}, texts: [], glows: [] };
`;
const EXPOSE = 'GS, Player, ThirdCam, Enemy, EN_update, PJ_update, PK_update, WD_init, WD_update, IN, IN_clearEdges, IN_move, PH_body, PH_move, PH_free, ' +
  'AN_state, AN_humanoid, MD_batman, MD_thug, MD_drone, MD_penguin, MD_joker, BS_start, BS_update, BS_end, WD, WG_GY, WG_SEA, WG_PITCH, WG_BASE, WG_H, LM, LM_init, BK, VX, FXS, EN_TYPES, EN_manage, PL_angDiff, UI';

module.exports.make = function (opts) {
  opts = opts || {};
  const { C, LiteWorld } = load(NAMES, EXPOSE, STUB);
  const G = C.GS;
  const world = new LiteWorld();
  G.world = world; G.fx = C.FXS;
  G.models = { batman: C.MD_batman(), clown: C.MD_thug('clown'), goon: C.MD_thug('goon'), drone: C.MD_drone(), penguin: C.MD_penguin(), joker: C.MD_joker() };
  G.rend = { gl: null };
  // WD_init wants the renderer; the parts the sim needs are the beacons and trophies
  G.beacons = C.LM.beacons.map((b, i) => ({ name: b.name, x: b.x, y: b.y, z: b.z, active: i === 0, i: i, spin: 0 }));
  G.bossInfo = [];
  G.zones = []; G.waves = [];
  G.trophyTotal = 0;
  const sp = C.LM.spawn;
  const pl = new C.Player(sp.x, sp.y, sp.z);
  pl.a = sp.a;
  G.player = pl;
  const tcam = new C.ThirdCam();
  tcam.yaw = Math.PI - sp.a; tcam.pitch = -0.2; tcam.snap(pl);
  G.tcam = tcam;
  const cam = { x: 0, y: 0, z: 0, yaw: tcam.yaw, pitch: tcam.pitch, fov: 1.1, fx: 0, fy: 0, fz: -1 };
  G.cam = cam;
  const DT = 1 / 120;
  const S = {
    C, G, world, pl, tcam, cam, IN: C.IN, t: 0,
    camVec() {
      const cp = Math.cos(cam.pitch), sp2 = Math.sin(cam.pitch);
      cam.fx = Math.sin(cam.yaw) * cp; cam.fy = sp2; cam.fz = -Math.cos(cam.yaw) * cp;
    },
    look(yaw, pitch) { tcam.yaw = yaw; tcam.pitch = pitch; },
    step(n) {
      for (let i = 0; i < n; i++) {
        G.time += DT; S.t += DT;
        pl.update(DT, cam, world, true);
        for (const e of pl.events) { S.events.push(typeof e === 'string' ? e : e.t); }
        pl.events.length = 0;
        for (const e of G.events) S.events.push(e.t);
        G.events.length = 0;
        if (!opts.noEnemies) C.EN_update(DT);
        if (G.boss) C.BS_update(DT);
        C.PJ_update(DT); C.PK_update(DT);
        if (G.comboT > 0) { G.comboT -= DT; if (G.comboT <= 0) G.combo = 0; }
        tcam.update(DT, cam, pl, world, { x: 0, y: 0 });
        S.camVec();
        C.IN_clearEdges();
      }
    },
    events: [],
    press(code, down) { const I = C.IN; I.keys[code] = down; if (code.startsWith('Shift')) I.sprint = down; if (code === 'Space') { I.jump = down; if (down) I.jumpEdge = true; } },
    tap(code) { const I = C.IN; if (code === 'Space') { I.jumpEdge = true; } else if (code === 'KeyE') I.grappleEdge = true; else if (code === 'KeyJ') I.attackEdge = true; else if (code === 'KeyF') I.batEdge = true; else if (code === 'KeyQ') I.dodgeEdge = true; },
    place(x, y, z, a) { const b = pl.b; b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0; pl.mode = 'air'; if (a !== undefined) pl.a = a; tcam.snap(pl); },
    settle() { S.step(60); },
  };
  S.camVec();
  return S;
};
