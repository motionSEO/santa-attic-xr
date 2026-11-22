// herbs.js — herb picking + the shared grab/input hub (mouse, XR hands, XR controllers)
// Classic script: exposes window.HerbGarden, window.extractHerbModule and window.herbsReady.
//
//   const garden = new HerbGarden(root, scene, { colliders: [root], onHarvest: (name, herb) => {} });
//   garden.attachHands(renderer, rig);          // XR: hand tracking (pinch / fist) + controllers (trigger / grip)
//   garden.enableMouse(canvas, camera, 0);      // PC: hold left button on a plant = pick a leaf, release = drop
//   garden.update(dt);                          // every frame
//
// Other modules (mug.js) register with garden.addGrabbable({...}).
window.herbsReady = Promise.all([
  import('three'),
  import('three/addons/webxr/XRHandModelFactory.js'),
  import('three/addons/webxr/XRControllerModelFactory.js')
]).then(([THREE, { XRHandModelFactory }, { XRControllerModelFactory }]) => {

  const HERBS = {
    mint:       { label: '민트',       kind: 'leaf',  color: 0x4f9a45 },
    lemongrass: { label: '레몬그라스', kind: 'blade', color: 0x8fb14a },
    rose:       { label: '장미',       kind: 'petal', color: 0xd8475f },
    lavender:   { label: '라벤더',     kind: 'sprig', color: 0x8c74c8 },
    fir:        { label: '전나무 잎',  kind: 'blade', color: 0x2f6a3c }
  };
  const PLANT_OF = (name) => {
    const m = /^Plant_(Mint|Lemongrass|Rose|Lavender|Fir)/.exec(name);
    return m ? m[1].toLowerCase() : null;
  };

  // ---- piece meshes (one shared geometry per kind)
  const leafShape = (w, h) => {
    const s = new THREE.Shape(); s.moveTo(0, 0);
    s.quadraticCurveTo(w, h * 0.35, 0, h); s.quadraticCurveTo(-w, h * 0.35, 0, 0); return s;
  };
  const GEO = {
    leaf:  new THREE.ShapeGeometry(leafShape(0.011, 0.032), 6),
    petal: new THREE.ShapeGeometry(leafShape(0.014, 0.022), 6),
    blade: new THREE.ShapeGeometry(leafShape(0.0035, 0.085), 4)
  };
  for (const g of Object.values(GEO)) g.translate(0, -0.012, 0);
  const sprigGeo = (() => {   // lavender: a thin stem with a column of tiny buds
    const parts = [];
    const stem = new THREE.CylinderGeometry(0.0012, 0.0012, 0.07, 4); stem.translate(0, 0.0, 0); parts.push(stem);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.SphereGeometry(0.0034, 5, 4);
      b.translate(Math.sin(i * 2.4) * 0.0025, 0.012 + i * 0.0028, Math.cos(i * 2.4) * 0.0025); parts.push(b);
    }
    let n = 0; const pos = [], idx = [];
    for (const p of parts) {
      const g = p.toNonIndexed(); const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i++) pos.push(a[i]);
      for (let i = 0; i < a.length / 3; i++) idx.push(n++);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  })();

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _box = new THREE.Box3();
  const DOWN = new THREE.Vector3(0, -1, 0);

  class HerbGarden {
    constructor(root, scene, opts = {}) {
      this.root = root; this.scene = scene;
      this.colliders = opts.colliders || [root];
      this.onHarvest = opts.onHarvest || null;
      this.onItemDrop = opts.onItemDrop || null;     // (item) => true if the page took it (e.g. into the mortar)
      this.items = [];            // harvested pieces lying around / held
      this.falling = [];
      this.grabbables = [];       // external (mug.js etc.)
      this.blockers = [];         // UI panels etc.: a click that lands on one is not ours
      this.hands = [];            // XR input slots
      this.pulls = [];            // things flying into a hand after a pointing pinch
      this.rayTargets = null;     // () => extra objects a hand ray can point at (drawers, buttons...)
      this.onRayPick = null;      // (hit, slot) => true if the page handled a pointing pinch on one of them
      this.mouse = null;
      this.ray = new THREE.Raycaster();
      this.plants = [];
      root.traverse(o => {
        const herb = o.isMesh && PLANT_OF(o.name);
        if (herb) { this.plants.push({ mesh: o, herb, wiggle: 0, base: o.scale.clone() }); o.userData.herb = herb; }
      });
      this.mats = {};
      for (const [k, h] of Object.entries(HERBS)) {
        const src = this.plants.find(p => p.herb === k && /Bloom|^Plant_(Mint|Lemongrass)$/.test(p.mesh.name))?.mesh.material;
        const m = new THREE.MeshStandardMaterial({ color: h.color, roughness: 0.65, side: THREE.DoubleSide });
        if (src && src.color && (h.kind === 'petal' || h.kind === 'sprig')) m.color.copy(src.color).lerp(new THREE.Color(h.color), 0.4);
        this.mats[k] = m;
      }
    }

    // ------------------------------------------------------------- registry
    addGrabbable(g) { this.grabbables.push(g); return g; }
    removeGrabbable(g) { this.grabbables = this.grabbables.filter(x => x !== g); }
    addPlant(mesh, herb) { mesh.userData.herb = herb; const p = { mesh, herb, wiggle: 0, base: mesh.scale.clone() }; this.plants.push(p); return p; }

    plantDistance(p, point) {
      p.mesh.updateWorldMatrix(true, false);
      _box.setFromObject(p.mesh).expandByScalar(0.012);
      return _box.distanceToPoint(point);
    }
    // nearest thing a pinch / fist at `point` would take
    pick(point, mode) {
      let best = null, bd = Infinity;
      const consider = (d, target, max) => { if (d < max && d < bd) { bd = d; best = target; } };
      if (mode === 'pinch' || mode === 'fist') {
        for (const it of this.items) if (!it.held) consider(it.mesh.getWorldPosition(_v).distanceTo(point), { type: 'item', it }, mode === 'fist' ? 0.07 : 0.045);
      }
      for (const g of this.grabbables) if (g.modes.includes(mode) && !g.held && g.enabled !== false && g.object.visible) consider(g.distance(point), { type: 'ext', g }, g.reach ?? 0.08);
      if (mode === 'pinch' && !best) for (const p of this.plants) consider(this.plantDistance(p, point), { type: 'plant', p }, 0.02);
      return best;
    }

    harvest(p, at) {
      const herb = HERBS[p.herb];
      const geo = herb.kind === 'sprig' ? sprigGeo : GEO[herb.kind];
      const mesh = new THREE.Mesh(geo, this.mats[p.herb]);
      mesh.castShadow = true; mesh.name = 'Harvest_' + p.herb;
      mesh.position.copy(at); mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(mesh);
      const it = { mesh, herb: p.herb, held: null };
      this.items.push(it);
      if (this.items.length > 60) { const old = this.items.find(i => !i.held); if (old) this.removeItem(old); }
      p.wiggle = 1;
      this.onHarvest?.(herb.label, p.herb, it);
      return it;
    }
    removeItem(it) { it.mesh.removeFromParent(); this.items.splice(this.items.indexOf(it), 1); this.falling = this.falling.filter(f => f.it !== it); }

    // drop a piece: find what is under it, then let it flutter down there
    drop(it) {
      this.scene.attach(it.mesh); it.held = null;
      if (this.onItemDrop?.(it)) return;
      const p = it.mesh.position;
      this.ray.set(_v.set(p.x, p.y + 0.01, p.z), DOWN); this.ray.far = 4;
      const hit = this.ray.intersectObjects(this.colliders, true).find(h => h.object !== it.mesh && !this.items.some(i => i.mesh === h.object) && h.object.visible);
      const y = hit ? hit.point.y + 0.002 : p.y - 3;
      this.falling.push({ it, y, vy: 0, spin: (Math.random() - 0.5) * 6 });
    }

    // ------------------------------------------------------------- generic hold (XR)
    grabStart(slot, mode) {
      const t = this.pick(slot.point, mode); if (!t) return false;
      const anchor = mode === 'pinch' ? slot.pinchAnchor : slot.fistAnchor;
      if (t.type === 'plant') {
        const it = this.harvest(t.p, slot.point); it.held = slot; anchor.attach(it.mesh); slot.held = { type: 'item', it };
      } else if (t.type === 'item') {
        this.falling = this.falling.filter(f => f.it !== t.it);
        t.it.held = slot; anchor.attach(t.it.mesh); slot.held = t;
      } else {
        t.g.held = slot; t.g.onGrab?.(anchor, slot); slot.held = t;
      }
      return true;
    }
    grabEnd(slot) {
      const h = slot.held; if (!h) return; slot.held = null;
      if (h.type === 'item') this.drop(h.it);
      else { h.g.held = null; h.g.onRelease?.(slot); }
    }

    // ------------------------------------------------------------- XR hands + controllers
    attachHands(renderer, rig) {
      this.renderer = renderer;
      const handFactory = new XRHandModelFactory(), ctrlFactory = new XRControllerModelFactory();
      for (let i = 0; i < 2; i++) {
        const hand = renderer.xr.getHand(i);
        hand.add(handFactory.createHandModel(hand, 'mesh'));
        rig.add(hand);
        const grip = renderer.xr.getControllerGrip(i);
        grip.add(ctrlFactory.createControllerModel(grip));
        rig.add(grip);
        const ctrl = renderer.xr.getController(i); rig.add(ctrl);

        const slot = { i, hand, grip, ctrl, handedness: null, isHand: false, connected: false,
          point: new THREE.Vector3(), pinch: false, fist: false, held: null,
          pinchAnchor: new THREE.Group(), fistAnchor: new THREE.Group(), pinchAim: false };
        rig.add(slot.pinchAnchor, slot.fistAnchor);
        slot.rayLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
          new THREE.LineBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.55, depthWrite: false }));
        slot.rayDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false }));
        slot.rayLine.frustumCulled = false; slot.rayLine.visible = slot.rayDot.visible = false;
        this.scene.add(slot.rayLine, slot.rayDot);
        const onConn = (e) => { slot.connected = true; slot.handedness = e.data.handedness; slot.isHand = !!e.data.hand; };
        const onDisc = () => { this.grabEnd(slot); slot.connected = false; slot.pinch = slot.fist = false; };
        hand.addEventListener('connected', onConn); hand.addEventListener('disconnected', onDisc);
        ctrl.addEventListener('connected', onConn); ctrl.addEventListener('disconnected', onDisc);
        // controllers: trigger = pinch, grip button = fist
        ctrl.addEventListener('selectstart', () => { if (slot.isHand) return; slot.pinch = true; this.grabStart(slot, 'pinch') || this.rayGrab(slot) || (slot.pinchAim = true); });
        ctrl.addEventListener('selectend',   () => { if (slot.isHand) return; slot.pinch = false; slot.pinchAim = false; this.grabEnd(slot); });
        ctrl.addEventListener('squeezestart', () => { if (slot.isHand) return; slot.fist = true; if (!slot.held) this.grabStart(slot, 'fist'); });
        ctrl.addEventListener('squeezeend',   () => { if (slot.isHand) return; slot.fist = false; if (slot.held && slot.held.type === 'ext') this.grabEnd(slot); });
        this.hands.push(slot);
      }
    }

    updateHands() {
      for (const s of this.hands) {
        if (!s.connected) continue;
        const J = s.hand.joints;
        if (s.isHand && J && J['index-finger-tip'] && J['thumb-tip'] && J['wrist']) {
          const it = J['index-finger-tip'], th = J['thumb-tip'], wr = J['wrist'];
          const pIt = it.getWorldPosition(new THREE.Vector3()), pTh = th.getWorldPosition(new THREE.Vector3()), pWr = wr.getWorldPosition(new THREE.Vector3());
          // show the hand mesh only while it is really tracked and away from the eyes (a lost / not yet tracked hand
          // keeps a stale or default pose that can end up right in front of the face)
          const headP = this.camera ? this.camera.getWorldPosition(_v2) : null;
          s.hand.visible = wr.visible !== false && it.visible !== false && !(headP && pWr.distanceTo(headP) < 0.2);
          const pinchD = pIt.distanceTo(pTh);
          let curl = 0, n = 0;
          for (const f of ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip']) if (J[f]) { curl += J[f].getWorldPosition(_v).distanceTo(pWr); n++; }
          curl /= Math.max(n, 1);
          // pinch point + anchor follow the fingers; the fist anchor follows the palm
          s.point.copy(pIt).add(pTh).multiplyScalar(0.5);
          s.pinchAnchor.parent.worldToLocal(s.pinchAnchor.position.copy(s.point));
          s.pinchAnchor.quaternion.copy(it.quaternion);
          const mid = J['middle-finger-phalanx-proximal'];
          const palm = mid ? mid.getWorldPosition(new THREE.Vector3()).lerp(pWr, 0.45) : pWr;
          s.fistAnchor.parent.worldToLocal(s.fistAnchor.position.copy(palm));
          s.fistAnchor.quaternion.copy(wr.quaternion);
          s.palm = palm;
          const wasP = s.pinch, wasF = s.fist;
          s.pinch = wasP ? pinchD < 0.035 : pinchD < 0.018;
          s.fist = wasF ? curl < 0.125 : curl < 0.095;
          if (s.fist && !wasF && !s.held) { s.point.copy(palm); if (!this.grabStart(s, 'fist')) s.point.copy(pIt).add(pTh).multiplyScalar(0.5); }
          if (s.pinch && !wasP && !s.held) { s.point.copy(pIt).add(pTh).multiplyScalar(0.5); s.pinchAim = !this.grabStart(s, 'pinch') && !this.rayGrab(s); }
          if (!s.pinch) s.pinchAim = false;
          if (s.held && !s.fist && !s.pinch) this.grabEnd(s);   // open hand = let go
        } else {
          if (s.isHand) s.hand.visible = false;     // a hand without joint data yet: nothing sensible to draw
          // controller: anchors ride on the grip
          s.grip.getWorldPosition(s.point);
          s.pinchAnchor.parent.worldToLocal(s.pinchAnchor.position.copy(s.point));
          s.pinchAnchor.quaternion.copy(s.grip.quaternion);
          s.fistAnchor.position.copy(s.pinchAnchor.position); s.fistAnchor.quaternion.copy(s.grip.quaternion);
          s.palm = s.point;
        }
        this.updatePointer(s);
      }
    }

    // ------------------------------------------------------------- hand ray: point at something out of reach, pinch to take / press it
    pointerRay(s, origin, dir) {
      if (s.isHand) {     // shoulder -> pinch point, like the system hand ray
        const cam = this.camera, head = cam.getWorldPosition(new THREE.Vector3());
        const fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x), side = s.handedness === 'left' ? -1 : 1;
        const shoulder = head.add(new THREE.Vector3(0, -0.2, 0)).addScaledVector(right, 0.16 * side);
        const J = s.hand.joints, k = J?.['index-finger-phalanx-proximal'];
        origin.copy(k ? k.getWorldPosition(_v2) : s.point);
        dir.subVectors(origin, shoulder).normalize();
      } else {
        s.ctrl.getWorldPosition(origin);
        dir.set(0, 0, -1).applyQuaternion(s.ctrl.getWorldQuaternion(new THREE.Quaternion()));
      }
    }
    pointerHit(s) {
      const o = new THREE.Vector3(), d = new THREE.Vector3(); this.pointerRay(s, o, d);
      this.ray.set(o, d); this.ray.near = 0; this.ray.far = 4;
      const plants = this.plants.filter(p => p.mesh.visible), items = this.items.filter(i => !i.held);
      const grabs = this.grabbables.filter(g => !g.held && g.enabled !== false && g.object.visible);
      const extra = this.rayTargets?.() || [];
      const hits = this.ray.intersectObjects([...plants.map(p => p.mesh), ...items.map(i => i.mesh), ...grabs.map(g => g.object), ...extra], true);
      for (const h of hits) {
        if (h.distance < 0.06) continue;
        const g = grabs.find(g => { for (let q = h.object; q; q = q.parent) if (q === g.object) return true; return false; });
        if (g) return { kind: 'ext', g, hit: h, origin: o };
        const it = items.find(i => i.mesh === h.object); if (it) return { kind: 'item', it, hit: h, origin: o };
        const p = plants.find(p => p.mesh === h.object); if (p) return { kind: 'plant', p, hit: h, origin: o };
        return { kind: 'extra', hit: h, origin: o };
      }
      // aim assist: nothing hit exactly -> the nearest thing within a few degrees of the ray
      let best = null, ba = 0.07;
      const tryC = (obj, make) => {
        const c = _box.setFromObject(obj).getCenter(new THREE.Vector3()), v = c.clone().sub(o), dist = v.length();
        if (dist < 0.15 || dist > 4) return;
        const ang = v.angleTo(d); if (ang < ba) { ba = ang; best = make({ point: c, distance: dist, object: obj }); }
      };
      for (const g of grabs) tryC(g.object, hit => ({ kind: 'ext', g, hit, origin: o }));
      for (const it of items) tryC(it.mesh, hit => ({ kind: 'item', it, hit, origin: o }));
      for (const p of plants) tryC(p.mesh, hit => ({ kind: 'plant', p, hit, origin: o }));
      return best;
    }
    updatePointer(s) {
      const show = s.connected && !s.held && !(s.isHand && s.fist);
      s.aim = show ? this.pointerHit(s) : null;
      const a = s.aim, on = !!a && a.hit.distance > 0.12;
      s.rayLine.visible = s.rayDot.visible = on;
      if (!on) return;
      s.rayLine.geometry.setFromPoints([a.origin, a.hit.point]);
      s.rayDot.position.copy(a.hit.point);
    }
    rayGrab(s) {
      const a = this.pointerHit(s); if (!a || a.hit.distance <= 0.12) return false;
      const anchor = s.pinchAnchor;
      if (a.kind === 'ext') { a.g.held = s; a.g.onGrab?.(anchor, s); s.held = { type: 'ext', g: a.g }; this.pullIn(anchor, a.g.object); }
      else if (a.kind === 'item') { this.falling = this.falling.filter(f => f.it !== a.it); a.it.held = s; anchor.attach(a.it.mesh); s.held = { type: 'item', it: a.it }; this.pullIn(anchor, a.it.mesh); }
      else if (a.kind === 'plant') { const it = this.harvest(a.p, a.hit.point); it.held = s; anchor.attach(it.mesh); s.held = { type: 'item', it }; this.pullIn(anchor, it.mesh); }
      else return !!this.onRayPick?.(a.hit, s);
      s.rayLine.visible = s.rayDot.visible = false;
      return true;
    }
    pullIn(anchor, obj) {     // fly the thing into the hand (its centre onto the pinch point)
      if (obj.parent !== anchor) return;
      obj.updateWorldMatrix(true, true);
      const c = anchor.worldToLocal(new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()));
      this.pulls = this.pulls.filter(p => p.obj !== obj);
      this.pulls.push({ obj, anchor, t: 0, from: obj.position.clone(), to: obj.position.clone().sub(c) });
    }

    // ------------------------------------------------------------- mouse (PC)
    enableMouse(canvas, camera, button = 0) {
      this.camera = camera;
      const m = this.mouse = { down: false, ndc: new THREE.Vector2(), depth: 0.4, held: null, ext: null };
      const setNdc = (e) => { const r = canvas.getBoundingClientRect(); m.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== button || this.renderer?.xr.isPresenting) return;
        setNdc(e);
        this.ray.setFromCamera(m.ndc, camera); this.ray.far = 3.5;
        const targets = [...this.plants.filter(p => p.mesh.visible).map(p => p.mesh), ...this.items.map(i => i.mesh), ...this.grabbables.filter(g => g.enabled !== false && g.object.visible).flatMap(g => g.meshes ?? [g.object]), ...this.blockers.filter(b => b.visible)];
        const hit = this.ray.intersectObjects(targets, true)[0]; if (!hit) return;
        let o = hit.object;
        for (let q = o; q; q = q.parent) if (this.blockers.includes(q)) return;
        const it = this.items.find(i => i.mesh === o);
        const g = this.grabbables.find(g => { for (let q = o; q; q = q.parent) if (q === g.object) return true; return false; });
        const p = this.plants.find(p => p.mesh === o);
        m.depth = Math.max(0.25, Math.min(hit.distance, 0.8));
        if (g) { m.ext = g; g.held = 'mouse'; g.onMouseDown?.(hit, camera); }
        else if (it) { this.falling = this.falling.filter(f => f.it !== it); it.held = 'mouse'; m.held = it; }
        else if (p) { const h = this.harvest(p, hit.point); h.held = 'mouse'; m.held = h; }
        m.down = true;
      });
      const up = (e) => {
        if (e.button !== button || !m.down) return; m.down = false;
        if (m.held) { this.drop(m.held); m.held = null; }
        if (m.ext) { m.ext.held = null; m.ext.onMouseUp?.(); m.ext = null; }
      };
      addEventListener('pointerup', up);
      canvas.addEventListener('pointermove', setNdc);
      canvas.addEventListener('wheel', (e) => { if (m.held) { m.depth = Math.max(0.2, Math.min(1.2, m.depth - e.deltaY * 0.0006)); e.preventDefault(); } }, { passive: false });
    }

    // ------------------------------------------------------------- per frame
    update(dt) {
      dt = Math.min(dt, 0.05);
      if (this.renderer?.xr.isPresenting) this.updateHands();
      for (let k = this.pulls.length - 1; k >= 0; k--) {
        const p = this.pulls[k]; p.t = Math.min(1, p.t + dt / 0.3);
        if (p.obj.parent !== p.anchor) { this.pulls.splice(k, 1); continue; }
        const e = 1 - Math.pow(1 - p.t, 3); p.obj.position.lerpVectors(p.from, p.to, e);
        if (p.t >= 1) this.pulls.splice(k, 1);
      }
      const m = this.mouse;
      if (m?.held) {     // the piece hangs in front of the camera along the pointer ray
        this.ray.setFromCamera(m.ndc, this.camera);
        m.held.mesh.position.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, m.depth);
        m.held.mesh.rotation.y += dt * 0.8;
      }
      for (let k = this.falling.length - 1; k >= 0; k--) {
        const f = this.falling[k], p = f.it.mesh.position;
        f.vy = Math.max(f.vy - 4.0 * dt, -0.9);             // light things: low terminal speed, they flutter
        p.y += f.vy * dt; p.x += Math.sin(p.y * 40) * 0.02 * dt;
        f.it.mesh.rotation.z += f.spin * dt;
        if (p.y <= f.y) {
          p.y = f.y; f.it.mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;   // lie flat
          this.falling.splice(k, 1);
          if (f.y < -2) this.removeItem(f.it);
        }
      }
      for (const p of this.plants) if (p.wiggle > 0) {    // a little shake on every pick
        p.wiggle = Math.max(0, p.wiggle - dt * 2.5);
        const s = 1 + Math.sin(p.wiggle * 30) * 0.03 * p.wiggle;
        p.mesh.scale.set(p.base.x * s, p.base.y * (2 - s), p.base.z * s);
      }
      for (const g of this.grabbables) g.update?.(dt);
    }

    // which hand is pinching at nothing (used for teleport aiming by the page)
    aimingHands() { return this.hands.filter(s => s.connected && s.pinchAim && !s.held); }
  }

  // move the herb tray (pots + plants) out of the room, for the module test page
  function extractHerbModule(root) {
    const g = new THREE.Group(); g.name = 'HerbModule';
    const tray = root.getObjectByName('HerbTray'); if (tray) g.attach(tray);
    return g;
  }

  window.HerbGarden = HerbGarden;
  window.extractHerbModule = extractHerbModule;
  window.HERBS = HERBS;
});
