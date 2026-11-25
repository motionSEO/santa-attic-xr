// conveyor.js — the three work tables pass in front of the player like on a conveyor belt.
//
// Lane: the desk in front of the player (x 0.16..0.82, the player stands at x 1.07 facing -x). A table comes in through a hatch in
// the right wall (z -2.05, the player's right), stops in front of the player, and when its step is done it leaves through the hatch
// in the left wall (z 1.12) while the next one comes in behind it:
//   1 making table  (the room's own desk with every ingredient and tool on it)
//   2 wrapping table (a copy of the desk; the paper rolls from the bookshelf lie on it)
//   3 basin table   (a copy of the desk with a water basin on it)
// The tables are cut off at the two walls with clipping planes, and each hatch is a dark opening with a wooden frame, so they look
// like they slide out of / into the wall.
import * as THREE from 'three';

export const LANE = {
  x0: 0.16, x1: 0.82,          // desk front-to-back (world x)
  stopZ: -0.065,               // a table's centre (world z) when it stands in front of the player
  rightZ: -2.05, leftZ: 1.12,  // the two hatches (inner wall faces)
  travel: 2.75,                // one conveyor step: the old table is fully through the left wall, the new one fully in
  top: 0.905                   // desk top height
};
const DESK_PARTS = ['Desk', 'Cube008', 'Cube010', 'Cube023', 'Cube009', 'Cube026'];   // top, apron, four legs

export function createConveyor({ scene, root, colliders = [], garden = null }) {
  const planes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -LANE.rightZ), new THREE.Plane(new THREE.Vector3(0, 0, -1), LANE.leftZ)];
  const clipped = new Set();
  const clip = (obj) => obj.traverse(o => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    for (const m of [].concat(o.material)) if (m && !clipped.has(m)) { clipped.add(m); m.clippingPlanes = planes; m.needsUpdate = true; }
  });
  const live = (obj) => obj.traverse(o => { o.matrixAutoUpdate = true; o.updateMatrix(); });   // index.html froze the static room

  // ---- hatches in the two walls
  const hatchMat = new THREE.MeshBasicMaterial({ color: 0x070403 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a2c17, roughness: 0.85 });
  const W = LANE.x1 - LANE.x0 + 0.16, H = 1.08, cx = (LANE.x0 + LANE.x1) / 2;
  for (const [z, s] of [[LANE.rightZ, 1], [LANE.leftZ, -1]]) {
    const g = new THREE.Group(); g.name = 'ConveyorHatch';
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(W, H), hatchMat); hole.position.set(cx, H / 2, z + 0.002 * s);
    if (s < 0) hole.rotation.y = Math.PI; g.add(hole);
    const T = 0.06, D = 0.05;
    for (const [w, h, x, y] of [[T, H + T, cx - W / 2 - T / 2, (H + T) / 2], [T, H + T, cx + W / 2 + T / 2, (H + T) / 2], [W + 2 * T, T, cx, H + T / 2]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, D), frameMat); b.position.set(x, y, z + s * D / 2); g.add(b);
    }
    // a little lamp over each hatch so the opening reads as a pass-through, not a hole in the dark
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd08a }));
    lamp.position.set(cx, H + 0.12, z + s * 0.04); g.add(lamp);
    scene.add(g);
  }

  // ---- a table = a group whose children are laid out as if it stood at the stop; group.position.z = offset from the stop
  function newTable(name) {
    const t = new THREE.Group(); t.name = name; root.add(t);
    return t;
  }
  // copy of the room's desk (top, apron, legs) for tables 2 and 3
  function deskCopy(name) {
    const t = newTable(name);
    for (const n of DESK_PARTS) {
      const o = root.getObjectByName(n); if (!o) continue;
      o.updateWorldMatrix(true, false);
      const c = o.clone(false); c.name = name + '_' + n;
      c.material = [].concat(o.material).map(m => m.clone()); if (c.material.length === 1) c.material = c.material[0];
      o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      t.add(c);
    }
    live(t); clip(t);
    t.position.z = -LANE.travel; t.visible = false;
    t.userData.surfaces = t.children.filter(c => /Desk$/.test(c.name));
    return t;
  }
  // table 1: the room's own desk + everything standing on it, gathered when it has to leave
  function adopt(t, objs) {
    for (const o of objs) {
      if (!o || !o.parent || o.parent === t) continue;
      t.attach(o); live(o); clip(o);
    }
  }
  const t1 = newTable('Table1_Making');
  t1.userData.surfaces = [];

  // ---- movement: the outgoing table to the left, the incoming one from the right, both at once (one belt)
  let job = null;
  function step(outgoing, incoming, dur = 6.5) {
    for (const t of [outgoing, incoming]) if (t) { t.visible = true; t.userData.z0 = t.position.z; }
    if (incoming) {
      incoming.position.z = -LANE.travel; incoming.userData.z0 = -LANE.travel;
      for (const m of incoming.userData.surfaces || []) if (!colliders.includes(m)) { colliders.push(m); garden?.colliders?.push?.(m); }
    }
    return new Promise(resolve => { job = { outgoing, incoming, t: 0, dur, resolve }; });
  }
  const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  function update(dt) {
    if (!job) return;
    job.t = Math.min(1, job.t + dt / job.dur);
    const d = ease(job.t) * LANE.travel;
    for (const t of [job.outgoing, job.incoming]) if (t) t.position.z = t.userData.z0 + d;
    if (job.t >= 1) {
      const j = job; job = null;
      if (j.outgoing) { j.outgoing.visible = false; for (const m of j.outgoing.userData.surfaces || []) { const i = colliders.indexOf(m); if (i >= 0) colliders.splice(i, 1); } }
      j.resolve();
    }
  }
  return { LANE, t1, deskCopy, adopt, clip, live, step, update, get moving() { return !!job; } };
}
