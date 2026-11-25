/* =====================================================================
   santa.js — Nicholas (felt Santa) character module for Three.js
   ---------------------------------------------------------------------
   <script src="santa.js"></script>   (plain script, works by double-click)
   then in your code:
   const santa = createSanta(THREE, { scale: 1.25 });
   scene.add(santa.object);

   // every frame
   santa.update(dt, camera);

   await santa.walkTo(new THREE.Vector3(0, 0, -2), { speed: 0.6 });
   await santa.turnTo(camera.position);
   santa.wave(true);
   santa.talk(true);              // mouth flaps until talk(false)
   santa.setExpression("happy");  // neutral | happy | surprised | sad | closed

   Swapping in a real model later:
   keep this API and replace buildBody() with a GLB loader; map
   legs/arms/head to the rig bones and expressions to a face atlas.
   ===================================================================== */

function createSanta(THREE, opts = {}) {
  const { scale = 1.25, castShadow = true, sounds = true } = opts;

  /* ---------- materials ---------- */
  const felt = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
  const M = {
    red: felt(0xc8282c), pants: felt(0x8e1e22), strap: felt(0x6a1a1a), cream: felt(0xf1e4d4),
    skin: felt(0xf4a48e), boot: felt(0x6e2a20), white: felt(0xffffff), mouth: felt(0x9a3a32),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.8, roughness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }),
  };
  const geos = [];
  function part(geo, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) {
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = castShadow; parent.add(m); return m;
  }

  /* ---------- body ---------- */
  const root = new THREE.Group(); root.name = "Santa";
  const body = new THREE.Group(); root.add(body);
  const legs = [], arms = [], eyes = [], pupils = [], brows = [];

  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.13 * s, 0.32, 0); root.add(hip);
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 14), M.pants, 0, -0.08, 0, hip);
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 14), M.cream, 0, -0.18, 0, hip);
    part(new THREE.SphereGeometry(0.11, 14, 10), M.boot, 0, -0.27, 0.03, hip, 1, 0.55, 1.35);
    legs.push(hip);
  }
  part(new THREE.SphereGeometry(0.32, 24, 18), M.pants, 0, 0.5, 0, body, 1, 0.8, 0.9);
  part(new THREE.SphereGeometry(0.3, 24, 18), M.red, 0, 0.7, 0, body, 1, 0.75, 0.88);
  for (const s of [-1, 1]) {
    part(new THREE.BoxGeometry(0.05, 0.36, 0.02), M.strap, 0.15 * s, 0.68, 0.25, body).rotation.x = -0.35;
    part(new THREE.SphereGeometry(0.035, 12, 8), M.gold, 0.15 * s, 0.53, 0.29, body, 1, 1, 0.5);
  }
  const ARM_DOWN = 1.05;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.24 * s, 0.82, 0); body.add(sh);
    part(new THREE.CylinderGeometry(0.07, 0.075, 0.3, 12), M.red, 0.15 * s, 0, 0, sh).rotation.z = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 12), M.cream, 0.32 * s, 0, 0, sh).rotation.z = Math.PI / 2;
    part(new THREE.SphereGeometry(0.065, 12, 8), M.skin, 0.4 * s, 0, 0, sh, 1.3, 0.6, 1);
    sh.rotation.z = -ARM_DOWN * s;
    arms.push(sh);
  }

  // where things he holds go (root space, before scaling): between his hands when he holds them out, and his back pocket
  const handsAnchor = new THREE.Object3D(); handsAnchor.name = "SantaHands"; handsAnchor.position.set(0, 0.95, 0.4); root.add(handsAnchor);
  const pocketAnchor = new THREE.Object3D(); pocketAnchor.name = "SantaPocket"; pocketAnchor.position.set(0.2, 0.55, -0.3); root.add(pocketAnchor);

  /* ---------- head / face ---------- */
  const head = new THREE.Group(); head.position.set(0, 1.05, 0); body.add(head);
  part(new THREE.SphereGeometry(0.2, 20, 16), M.skin, 0, 0, 0, head, 1, 1.05, 0.95);
  part(new THREE.SphereGeometry(0.05, 10, 8), M.skin, -0.2, 0, 0, head, 0.6, 1, 1);
  part(new THREE.SphereGeometry(0.05, 10, 8), M.skin, 0.2, 0, 0, head, 0.6, 1, 1);
  part(new THREE.SphereGeometry(0.24, 20, 14), M.cream, 0, 0.08, -0.04, head, 1, 0.95, 0.9);
  part(new THREE.SphereGeometry(0.3, 20, 16), M.cream, 0, -0.2, 0.06, head, 1, 0.9, 0.75);
  part(new THREE.TorusGeometry(0.07, 0.04, 10, 20), M.cream, 0.06, 0.3, 0, head).rotation.y = 0.2;
  part(new THREE.SphereGeometry(0.045, 12, 10), M.cream, 0.06, 0.3, 0, head);
  part(new THREE.SphereGeometry(0.12, 16, 12), M.skin, 0, 0.04, 0.12, head, 1.15, 0.8, 0.6);
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(0.055 * s, 0.03, 0.19); head.add(eye);
    part(new THREE.SphereGeometry(0.035, 12, 10), M.white, 0, 0, 0, eye, 1, 1, 0.5);
    pupils.push(part(new THREE.SphereGeometry(0.022, 10, 8), M.black, 0, -0.01, 0.015, eye));
    eyes.push(eye);
    const brow = new THREE.Group(); brow.position.set(0.06 * s, 0.085, 0.18); head.add(brow);
    part(new THREE.SphereGeometry(0.03, 10, 6), M.cream, 0, 0, 0, brow, 1.3, 0.5, 0.6);
    brows.push(brow);
    part(new THREE.TorusGeometry(0.036, 0.004, 6, 18), M.gold, 0.055 * s, 0.02, 0.215, head);
  }
  part(new THREE.SphereGeometry(0.1, 14, 10), M.cream, -0.06, -0.04, 0.2, head, 1, 0.45, 0.6);
  part(new THREE.SphereGeometry(0.1, 14, 10), M.cream, 0.06, -0.04, 0.2, head, 1, 0.45, 0.6);
  const mouth = part(new THREE.SphereGeometry(0.02, 10, 8), M.mouth, 0, -0.08, 0.23, head, 1, 0.6, 0.5);

  root.scale.setScalar(scale);

  /* ---------- expressions (target values, eased each frame) ---------- */
  const EXPR = {
    //          eyeY  eyeS  browY  browTilt mouthW mouthH
    neutral:   [1.0, 1.0, 0.0, 0.0, 1.0, 0.6],
    happy:     [0.35, 1.0, 0.01, -0.2, 1.6, 0.5],
    surprised: [1.25, 1.2, 0.025, 0.0, 0.9, 1.6],
    sad:       [0.8, 1.0, -0.005, 0.35, 0.8, 0.4],
    closed:    [0.08, 1.0, -0.005, 0.0, 1.0, 0.6],
  };
  let expr = EXPR[opts.expression] ? opts.expression : "surprised";   // default face
  const cur = [...EXPR[expr]];

  /* ---------- state ---------- */
  const st = {
    walking: false, talking: false, waving: false, pose: null,
    walkTask: null, turnTask: null, time: 0, nextBlink: 2 + Math.random() * 3, blink: 0, lastStep: 0,
  };
  const tmp = new THREE.Vector3();

  let actx = null;
  function tone(f, d, type = "sine", v = 0.15) {
    if (!sounds) return;
    try {
      actx ??= new AudioContext();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(v, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
    } catch { /* audio blocked until a user gesture */ }
  }
  const angleTo = (p) => Math.atan2(p.x - root.position.x, p.z - root.position.z);
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /* ---------- public API ---------- */
  function walkTo(target, { speed = 0.6, via = null } = {}) {
    // optional `via` point makes a smooth curved path (quadratic bezier)
    const from = root.position.clone(), to = target.clone(), mid = via ? via.clone() : from.clone().lerp(to, 0.5);
    const len = from.distanceTo(mid) + mid.distanceTo(to);
    st.walkTask?.resolve();
    return new Promise((resolve) => {
      st.walkTask = { from, mid, to, t: 0, dur: Math.max(0.3, len / speed), resolve };
      st.walking = true;
    });
  }
  function turnTo(point, duration = 0.6) {
    const goal = angleTo(point);
    st.turnTask?.resolve();
    return new Promise((resolve) => {
      const start = root.rotation.y;
      st.turnTask = { start, delta: wrapAngle(goal - start), t: 0, dur: duration, resolve };
    });
  }
  function setExpression(name) { if (EXPR[name]) expr = name; }
  function talk(on = true, { voice = false } = {}) { st.talking = on; st.voiced = on && voice; }   // voice: a recorded voice is playing, no blips
  function wave(on = true) { st.waving = on; }
  // arm poses: "offer" = both hands held out in front (giving / taking something), "pocket" = right hand reaching into the
  // back pocket, null = arms down
  function pose(name = null) { st.pose = name; }
  function stop() { st.walkTask?.resolve(); st.walkTask = null; st.walking = false; }

  function update(dt, lookTarget = null) {
    st.time += dt; const t = st.time;
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

    // walking along path
    const w = st.walkTask;
    if (w) {
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = ease(w.t);
      const a = w.from.clone().lerp(w.mid, e), b = w.mid.clone().lerp(w.to, e), p = a.lerp(b, e);
      tmp.subVectors(p, root.position);
      if (tmp.lengthSq() > 1e-8) {
        const goal = Math.atan2(tmp.x, tmp.z);
        root.rotation.y += wrapAngle(goal - root.rotation.y) * Math.min(1, dt * 10);
      }
      root.position.copy(p);
      if (w.t >= 1) { st.walkTask = null; st.walking = false; w.resolve(); }
    }
    // turning
    const tr = st.turnTask;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      root.rotation.y = tr.start + tr.delta * ease(tr.t);
      if (tr.t >= 1) { st.turnTask = null; tr.resolve(); }
    }

    // locomotion pose
    const cyc = t * 7;
    if (st.walking) {
      legs[0].rotation.x = Math.sin(cyc) * 0.55; legs[1].rotation.x = -Math.sin(cyc) * 0.55;
      arms[0].rotation.x = -Math.sin(cyc) * 0.4;
      if (!st.waving) arms[1].rotation.x = Math.sin(cyc) * 0.4;
      body.position.y = Math.abs(Math.sin(cyc)) * 0.035;
      body.rotation.z = Math.sin(cyc) * 0.05;
      if (t - st.lastStep > Math.PI / 7) { st.lastStep = t; tone(90 + Math.random() * 20, 0.08, "triangle", 0.2); }
    } else {
      for (const l of legs) l.rotation.x *= 0.85;
      arms[0].rotation.x *= 0.85;
      body.position.y = Math.sin(t * 2) * 0.008;
      body.rotation.z *= 0.9;
    }
    // right arm: wave or relax
    // arms[0] = left (+z is down), arms[1] = right (-z is down, +z raises it)
    let armGoal = st.waving ? 0.5 + Math.sin(t * 8) * 0.35 : -ARM_DOWN, armGoal0 = ARM_DOWN, yGoal0 = 0, yGoal1 = 0;
    if (st.pose === "offer") { armGoal0 = -0.3; yGoal0 = 1.3; armGoal = 0.3; yGoal1 = -1.3; }
    else if (st.pose === "pocket") { armGoal = -0.75; yGoal1 = 1.1; }
    const ka = Math.min(1, dt * 8);
    arms[1].rotation.z += (armGoal - arms[1].rotation.z) * ka;
    arms[1].rotation.y += (yGoal1 - arms[1].rotation.y) * ka;
    if (st.waving || st.pose) arms[1].rotation.x *= 0.8;
    if (st.pose) arms[0].rotation.x *= 0.8;
    arms[0].rotation.z += (armGoal0 - arms[0].rotation.z) * ka;
    arms[0].rotation.y += (yGoal0 - arms[0].rotation.y) * ka;

    // head sway + look at target
    head.rotation.z = Math.sin(t * 1.5) * (st.talking ? 0.05 : 0.02);
    if (lookTarget) {
      root.updateMatrixWorld();
      const local = head.parent.worldToLocal(tmp.copy(lookTarget));
      const yaw = Math.max(-0.5, Math.min(0.5, Math.atan2(local.x, local.z)));
      head.rotation.y += (yaw - head.rotation.y) * Math.min(1, dt * 4);
    } else head.rotation.y *= 0.9;

    // expression easing
    const goal = EXPR[expr], k = Math.min(1, dt * 10);
    for (let i = 0; i < cur.length; i++) cur[i] += (goal[i] - cur[i]) * k;
    // auto blink
    st.nextBlink -= dt;
    if (st.nextBlink <= 0) { st.blink = 0.15; st.nextBlink = 2.5 + Math.random() * 3; }
    st.blink = Math.max(0, st.blink - dt);
    const blinkMul = st.blink > 0 ? 0.08 : 1;
    for (const e of eyes) { e.scale.set(cur[1], cur[0] * cur[1] * blinkMul, 1); }
    brows.forEach((b, i) => { b.position.y = 0.085 + cur[2]; b.rotation.z = cur[3] * (i ? -1 : 1); });
    // mouth: talking flaps on top of expression
    const flap = st.talking ? Math.abs(Math.sin(t * 18)) * 0.9 : 0;
    mouth.scale.set(cur[4], cur[5] + flap, 0.5);
    if (st.talking && !st.voiced && Math.sin(t * 18) > 0.98) tone(520 + Math.random() * 120, 0.04, "square", 0.03);
  }

  function dispose() {
    root.removeFromParent();
    geos.forEach((g) => g.dispose());
    Object.values(M).forEach((m) => m.dispose());
  }

  return {
    object: root,
    parts: { body, head, legs, arms, eyes, pupils, brows, mouth },
    expressions: Object.keys(EXPR),
    anchors: { hands: handsAnchor, pocket: pocketAnchor },
    walkTo, turnTo, talk, wave, pose, setExpression, stop, update, dispose,
    get isWalking() { return st.walking; },
  };
}

if (typeof window !== "undefined") window.createSanta = createSanta;
