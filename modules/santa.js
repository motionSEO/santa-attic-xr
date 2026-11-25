// santa.js — a low-poly Santa (Nicolas) built from primitives, with simple procedural animation.
// Plain script: defines window.createSanta(THREE, opts). No assets, works from file:// too.
//
//   const santa = createSanta(THREE, { scale: 1.2 });
//   scene.add(santa.object);                       // faces +z, feet at y = 0
//   await santa.walkTo(target, { via, speed, ground });   // via: Vector3 or [Vector3...], ground(x, z) -> floor y (optional)
//   await santa.turnTo(point, seconds);
//   santa.wave(true / false); santa.talk(true / false);
//   santa.setExpression('happy');                  // santa.expressions = ['neutral', 'happy', 'surprised', 'wink', 'sad']
//   santa.update(dt, lookAtWorldPoint | null);     // every frame; the head turns toward the point
//
// Height at scale 1 is about 1.3 m (hat tip included).
(function () {
  function createSanta(THREE, opts = {}) {
    const scale = opts.scale ?? 1;
    const lit = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
    const M = {
      red: lit(0xc22a2e), redDark: lit(0x8e1c22), white: lit(0xf4f1ea), skin: lit(0xf0c3a0), cheek: lit(0xe88f86),
      nose: lit(0xe59a86), black: lit(0x1d1714), boot: lit(0x24160e), gold: lit(0xd8a640), glove: lit(0x2f5a34),
      eye: new THREE.MeshBasicMaterial({ color: 0x1b1410 }), shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      mouth: lit(0x5a1a1a), lid: lit(0xe8b896)
    };
    const mk = (geo, mat, x = 0, y = 0, z = 0, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; if (parent) parent.add(m); return m; };
    const grp = (x = 0, y = 0, z = 0, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; };
    const S = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
    const C = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);

    const object = new THREE.Group(); object.name = 'Santa';
    const body = grp(0, 0, 0, object);                 // bobs while walking
    body.scale.setScalar(scale);

    // ---- legs (hip pivot, knee pivot)
    const legs = [-1, 1].map((s) => {
      const hip = grp(s * 0.1, 0.5, 0, body);
      mk(C(0.075, 0.068, 0.24), M.red, 0, -0.12, 0, hip);
      const knee = grp(0, -0.24, 0, hip);
      mk(C(0.068, 0.06, 0.2), M.red, 0, -0.1, 0, knee);
      mk(new THREE.TorusGeometry(0.066, 0.025, 6, 14).rotateX(Math.PI / 2), M.white, 0, -0.17, 0, knee);   // boot cuff
      const boot = mk(new THREE.BoxGeometry(0.13, 0.09, 0.22), M.boot, 0, -0.215, 0.035, knee);
      mk(C(0.07, 0.07, 0.08), M.boot, 0, -0.18, 0, knee);
      return { hip, knee };
    });

    // ---- torso: coat, belly, belt, trim
    const torso = grp(0, 0.5, 0, body);
    const belly = mk(S(0.3, 18, 14), M.red, 0, 0.24, 0.01, torso); belly.scale.set(1, 1.05, 0.92);
    mk(C(0.25, 0.3, 0.16, 18), M.red, 0, 0.04, 0, torso);                                          // coat skirt
    mk(new THREE.TorusGeometry(0.29, 0.04, 8, 22).rotateX(Math.PI / 2), M.white, 0, -0.03, 0, torso);   // hem trim
    const belt = mk(new THREE.TorusGeometry(0.285, 0.035, 6, 24).rotateX(Math.PI / 2), M.black, 0, 0.15, 0.01, torso); belt.scale.set(1, 0.94, 1);
    mk(new THREE.BoxGeometry(0.11, 0.09, 0.03), M.gold, 0, 0.15, 0.285, torso);
    mk(new THREE.BoxGeometry(0.06, 0.045, 0.035), M.black, 0, 0.15, 0.29, torso);
    const stripe = mk(new THREE.BoxGeometry(0.07, 0.36, 0.04), M.white, 0, 0.3, 0.255, torso); stripe.rotation.x = -0.12;
    mk(S(0.2, 14, 10), M.red, 0, 0.44, -0.01, torso).scale.set(1.25, 0.6, 1.0);                     // shoulders
    mk(new THREE.TorusGeometry(0.11, 0.035, 6, 16).rotateX(Math.PI / 2), M.white, 0, 0.5, 0, torso); // collar

    // ---- arms (shoulder pivot, elbow pivot); rest pose hangs down and slightly out
    const arms = [-1, 1].map((s) => {
      const sh = grp(s * 0.28, 0.43, 0, torso);
      mk(S(0.075, 10, 8), M.red, 0, 0, 0, sh);
      mk(C(0.07, 0.062, 0.22), M.red, 0, -0.11, 0, sh);
      const el = grp(0, -0.22, 0, sh);
      mk(S(0.062, 10, 8), M.red, 0, 0, 0, el);                                                         // elbow
      mk(C(0.062, 0.055, 0.18), M.red, 0, -0.09, 0, el);
      mk(new THREE.TorusGeometry(0.058, 0.024, 6, 14).rotateX(Math.PI / 2), M.white, 0, -0.18, 0, el);   // fur cuff
      const hand = grp(0, -0.23, 0, el);
      mk(S(0.058, 12, 10), M.glove, 0, 0, 0, hand).scale.set(0.9, 1.05, 0.8);
      mk(S(0.026, 8, 6), M.glove, s * -0.045, 0.02, 0.02, hand);                                      // thumb
      return { sh, el, hand, s };
    });

    // ---- head
    const neck = grp(0, 0.5, 0, torso);                // head group pivots here (look-at)
    const head = grp(0, 0.13, 0, neck);
    mk(S(0.15, 18, 14), M.skin, 0, 0, 0, head);
    mk(S(0.152, 16, 12), M.white, 0, 0.01, -0.03, head).scale.set(1.02, 0.95, 0.95);              // hair at the back
    const nose = mk(S(0.035, 10, 8), M.nose, 0, -0.005, 0.15, head);
    for (const s of [-1, 1]) mk(S(0.032, 8, 6), M.cheek, s * 0.085, -0.025, 0.12, head).scale.set(1, 0.7, 0.5);
    // eyes: dark ovals + a lid (skin coloured) that slides down to blink / wink
    const eyes = [-1, 1].map((s) => {
      const g = grp(s * 0.056, 0.035, 0.132, head);
      const e = mk(S(0.02, 10, 8), M.eye, 0, 0, 0, g); e.scale.set(0.85, 1.15, 0.6);
      mk(S(0.006, 6, 4), M.shine, 0.006, 0.008, 0.011, g);
      const lid = grp(0, 0, 0, g);
      const lm = mk(S(0.024, 10, 8), M.lid, 0, 0.02, 0.002, lid); lm.scale.set(1, 0.05, 0.7);
      return { g, lid: lm };
    });
    const brows = [-1, 1].map((s) => {
      const b = mk(new THREE.BoxGeometry(0.06, 0.018, 0.02), M.white, s * 0.058, 0.08, 0.135, head);
      b.userData.s = s; return b;
    });
    // beard + mustache + mouth (jaw group drops a little while talking)
    const jaw = grp(0, -0.04, 0.02, head);
    const beard = mk(S(0.16, 16, 12), M.white, 0, -0.07, 0.03, jaw); beard.scale.set(1.02, 1.05, 0.8);
    mk(S(0.09, 10, 8), M.white, 0, -0.17, 0.06, jaw).scale.set(1.1, 1.1, 0.8);
    const mouth = mk(S(0.032, 12, 8), M.mouth, 0, -0.052, 0.168, head); mouth.scale.set(1, 0.15, 0.4);
    const smile = mk(new THREE.TorusGeometry(0.028, 0.008, 6, 12, Math.PI), M.mouth, 0, -0.04, 0.172, head); smile.rotation.z = Math.PI; smile.visible = false;
    for (const s of [-1, 1]) { const m = mk(S(0.05, 10, 8), M.white, s * 0.042, -0.002, 0.14, head); m.scale.set(1.1, 0.42, 0.55); m.rotation.z = s * -0.35; }
    // glasses
    for (const s of [-1, 1]) mk(new THREE.TorusGeometry(0.028, 0.004, 6, 16), M.gold, s * 0.056, 0.035, 0.146, head);
    mk(new THREE.BoxGeometry(0.03, 0.005, 0.005), M.gold, 0, 0.04, 0.152, head);
    // hat: brim, bent cone, pom-pom
    const hat = grp(0, 0.075, -0.01, head); hat.rotation.x = -0.12;
    mk(new THREE.TorusGeometry(0.14, 0.042, 8, 22).rotateX(Math.PI / 2), M.white, 0, 0, 0, hat);
    mk(C(0.06, 0.14, 0.14, 16), M.red, 0, 0.07, -0.005, hat);
    const tip = grp(0, 0.14, -0.005, hat); tip.rotation.x = -0.6;
    mk(new THREE.ConeGeometry(0.065, 0.2, 14), M.red, 0, 0.1, 0, tip);
    const pom = mk(S(0.045, 10, 8), M.white, 0, 0.2, 0, tip);

    // ---- expressions
    const EXPR = {
      neutral:   { open: [1, 1], brow: [0, 0], smile: 0, mouthW: 1 },
      happy:     { open: [0.55, 0.55], brow: [0.012, -0.15], smile: 1, mouthW: 1.2 },
      surprised: { open: [1.25, 1.25], brow: [0.03, 0.12], smile: 0, mouthW: 0.7, mouthO: 0.6 },
      wink:      { open: [1, 0.05], brow: [0.008, -0.1], smile: 1, mouthW: 1.1 },
      sad:       { open: [0.8, 0.8], brow: [-0.004, 0.3], smile: 0, mouthW: 0.8 }
    };
    let expr = EXPR.neutral;
    const cur = { open: [1, 1], browY: 0, browR: 0, smile: 0, mouthW: 1, mouthO: 0 };

    // ---- state
    let path = null, walkSpeed = 0.8, ground = null, resolveWalk = null;
    let turn = null;
    let waving = false, talking = false, waveK = 0, talkK = 0, walkK = 0;
    let phase = 0, t = 0, blinkT = 2 + Math.random() * 2, blink = 0;
    const headYP = { yaw: 0, pitch: 0 };
    const tmp = new THREE.Vector3(), inv = new THREE.Matrix4();
    const lerp = THREE.MathUtils.lerp, damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const yawTo = (p) => Math.atan2(p.x - object.position.x, p.z - object.position.z);

    function walkTo(target, o = {}) {
      resolveWalk?.();
      const via = o.via ? (Array.isArray(o.via) ? o.via : [o.via]) : [];
      path = [...via, target].map((v) => v.clone());
      walkSpeed = o.speed ?? 0.8; ground = o.ground || null; turn = null;
      return new Promise((res) => { resolveWalk = res; });
    }
    function turnTo(point, dur = 0.6) {
      const from = object.rotation.y, to = from + wrapA(yawTo(point) - from);
      return new Promise((res) => { turn = { from, to, t: 0, dur: Math.max(0.05, dur), res }; });
    }

    function update(dt, look) {
      t += dt;
      // walking along the path
      let moving = false;
      if (path) {
        const wpnt = path[0];
        tmp.set(wpnt.x - object.position.x, 0, wpnt.z - object.position.z);
        const d = tmp.length(), step = walkSpeed * dt;
        const want = Math.atan2(tmp.x, tmp.z);
        object.rotation.y += wrapA(want - object.rotation.y) * (1 - Math.exp(-8 * dt));
        if (d <= Math.max(step, 0.01)) {
          object.position.x = wpnt.x; object.position.z = wpnt.z; if (!ground) object.position.y = wpnt.y;
          path.shift();
          if (!path.length) { path = null; const r = resolveWalk; resolveWalk = null; r?.(); }
        } else {
          const y0 = object.position.y;
          object.position.addScaledVector(tmp.normalize(), step);
          if (!ground) object.position.y = y0 + (wpnt.y - y0) * Math.min(1, step / d);
          moving = true;
        }
        if (ground) { const gy = ground(object.position.x, object.position.z); if (gy != null) object.position.y = gy; }
      }
      if (turn) {
        turn.t += dt; const k = Math.min(1, turn.t / turn.dur), e = k * k * (3 - 2 * k);
        object.rotation.y = lerp(turn.from, turn.to, e);
        if (k >= 1) { const r = turn.res; turn = null; r(); }
      }
        walkK = damp(walkK, moving ? 1 : turn ? 0.45 : 0, 8, dt);
      phase += dt * (moving ? walkSpeed * 7.5 : turn ? 5 : 0);
      const sw = Math.sin(phase), sw2 = Math.sin(phase * 2);
      // legs + body bob
      legs.forEach((l, i) => {
        const s = i ? -1 : 1, a = sw * s;
        l.hip.rotation.x = a * 0.5 * walkK;
        l.knee.rotation.x = Math.max(0, -Math.cos(phase + (i ? Math.PI : 0))) * 0.7 * walkK;
      });
      body.position.y = (Math.abs(sw) * 0.035 - 0.012) * walkK * scale + Math.sin(t * 1.6) * 0.003 * scale;
      body.rotation.z = sw * 0.04 * walkK;
      torso.rotation.y = sw * 0.08 * walkK;
      torso.scale.set(1, 1 + Math.sin(t * 1.6) * 0.008, 1);                       // breathing
      // arms: swing while walking, otherwise hang. Santa faces +z, so his right arm is the -x one (s = -1)
      waveK = damp(waveK, waving ? 1 : 0, 6, dt);
      arms.forEach((a, i) => {
        const s = a.s, swing = -sw * (i ? 1 : -1) * 0.45 * walkK;
        let shX = swing, shZ = s * 0.18, elX = -0.25 - 0.2 * walkK, elZ = 0;
        if (s < 0 && waveK > 0.001) {          // Santa's right hand (-x side, since he faces +z) waves
          const w = waveK;
          shX = lerp(shX, -0.3, w); shZ = lerp(shZ, -2.5, w);
          elX = lerp(elX, 0, w); elZ = lerp(0, -0.9 + Math.sin(t * 9) * 0.45, w);
        }
        a.sh.rotation.set(shX, 0, shZ);
        a.el.rotation.set(elX, 0, elZ);
        a.hand.rotation.set(0, 0, s < 0 ? elZ * 0.3 : 0);
      });
      // expression blend
      const ex = expr;
      blinkT -= dt; if (blinkT <= 0) { blink = 0.16; blinkT = 2.5 + Math.random() * 3; }
      blink = Math.max(0, blink - dt);
      const bl = blink > 0 ? Math.sin((blink / 0.16) * Math.PI) : 0;
      for (let i = 0; i < 2; i++) {
        cur.open[i] = damp(cur.open[i], ex.open[i], 14, dt);
        const o = Math.max(0.05, cur.open[i] * (1 - bl));
        eyes[i].g.scale.y = Math.min(1.25, o);
        eyes[i].lid.scale.y = 0.05 + (1 - Math.min(1, o)) * 0.6;
      }
      cur.browY = damp(cur.browY, ex.brow[0], 10, dt); cur.browR = damp(cur.browR, ex.brow[1], 10, dt);
      brows.forEach((b) => { b.position.y = 0.08 + cur.browY; b.rotation.z = b.userData.s * cur.browR; });
      cur.smile = damp(cur.smile, ex.smile, 10, dt); cur.mouthW = damp(cur.mouthW, ex.mouthW, 10, dt);
      // talking: mouth + jaw flap with a little irregularity
      talkK = damp(talkK, talking ? 1 : 0, 12, dt);
      const flap = talkK * (0.5 + 0.5 * Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3 + 1)));
      const open = Math.max(ex.mouthO || 0, flap);
      mouth.scale.set(cur.mouthW, 0.15 + open * 0.85, 0.4);
      smile.visible = cur.smile > 0.5 && open < 0.25; mouth.visible = !smile.visible;
      jaw.position.y = -0.04 - open * 0.018;
      // head: look at a world point (clamped), plus a nod while talking
      let ty = 0, tp = 0;
      if (look) {
        object.updateMatrixWorld();
        tmp.copy(look).applyMatrix4(inv.copy(neck.matrixWorld).invert());
        ty = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.9, 0.9);
        tp = THREE.MathUtils.clamp(-Math.atan2(tmp.y - 0.13, Math.hypot(tmp.x, tmp.z)), -0.45, 0.45);
      }
      headYP.yaw = damp(headYP.yaw, ty, 5, dt); headYP.pitch = damp(headYP.pitch, tp, 5, dt);
      neck.rotation.set(headYP.pitch + Math.sin(t * 5.5) * 0.04 * talkK, headYP.yaw, Math.sin(t * 2.1) * 0.03 * talkK + sw2 * 0.02 * walkK);
      pom.position.x = Math.sin(t * 3 + phase) * 0.01; tip.rotation.z = Math.sin(phase) * 0.12 * walkK;
    }

    return {
      object, walkTo, turnTo, update,
      wave(on = true) { waving = !!on; },
      talk(on = true) { talking = !!on; },
      setExpression(name) { if (EXPR[name]) expr = EXPR[name]; },
      get expressions() { return Object.keys(EXPR); },
      get walking() { return !!path; },
      stop() { path = null; turn = null; resolveWalk?.(); resolveWalk = null; }
    };
  }
  window.createSanta = createSanta;
})();
