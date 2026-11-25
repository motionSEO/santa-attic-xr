// mug.js — a cup of cocoa: steam, lift to the mouth, drink, refill
// Classic script: exposes window.MugModule and window.mugReady.
//
//   new MugModule(root, scene, garden, camera);
//   PC: hold the left button on the mug -> it rises to your mouth and you drink; let go -> it goes back.
//   XR: make a fist around the mug (or grip button) and bring it to your mouth; open the hand to put it down.
//   Empty -> it fills itself again after a moment.
window.mugReady = (window.herbsReady || Promise.resolve()).then(() => import('three')).then((THREE) => {

  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

  function puffTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  class MugModule {
    constructor(root, scene, garden, camera, opts = {}) {
      this.scene = scene; this.garden = garden; this.camera = camera;
      this.mug = root.getObjectByName(opts.name || 'MugCup');
      if (!this.mug) throw new Error('MugCup not found');
      this.level = 1; this.refillT = 0; this.refilling = false; this.drinking = false;
      this.state = 'rest';                       // rest | lift (mouse) | held (xr) | return | drop
      this.mug.updateWorldMatrix(true, true);
      this.home = { parent: this.mug.parent, pos: this.mug.position.clone(), quat: this.mug.quaternion.clone() };
      this.homeWorld = this.mug.matrixWorld.clone();

      // liquid: a dark disc inside the cup, its height follows the level
      const bb = this.mug.geometry.boundingBox || (this.mug.geometry.computeBoundingBox(), this.mug.geometry.boundingBox);
      this.inner = { r: Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * 0.86, y0: bb.min.y + (bb.max.y - bb.min.y) * 0.18, y1: bb.max.y * 0.999 + 0.002 };
      this.liquid = new THREE.Mesh(new THREE.CircleGeometry(this.inner.r, 28),
        new THREE.MeshStandardMaterial({ color: 0x3a1d0e, roughness: 0.25, metalness: 0 }));
      this.liquid.rotation.x = -Math.PI / 2; this.liquid.name = 'MugCocoa';
      this.mug.add(this.liquid);
      this.foam = new THREE.Mesh(new THREE.RingGeometry(this.inner.r * 0.82, this.inner.r, 28),
        new THREE.MeshStandardMaterial({ color: 0xc89870, roughness: 0.6 }));
      this.foam.rotation.x = -Math.PI / 2; this.liquid.add(this.foam); this.foam.rotation.x = 0; this.foam.position.z = 0.001;

      // steam
      const tex = puffTexture();
      this.puffs = [];
      for (let i = 0; i < 10; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        s.userData = { t: i / 10, x: (Math.random() - 0.5), z: (Math.random() - 0.5) };
        scene.add(s); this.puffs.push(s);
      }

      this.grab = garden.addGrabbable({
        object: this.mug, modes: ['fist', 'pinch'], reach: 0.07,
        distance: (p) => { this.mug.updateWorldMatrix(true, false); return new THREE.Box3().setFromObject(this.mug).distanceToPoint(p); },
        onGrab: (anchor) => { this.state = 'held'; this.anim = null; anchor.attach(this.mug); },
        onRelease: () => this.putDown(),
        onMouseDown: () => { this.scene.attach(this.mug); this.state = 'lift'; this.anim = { t: 0, from: this.mug.matrixWorld.clone() }; },
        onMouseUp: () => this.goHome(),
        update: (dt) => this.update(dt)
      });
      this.ray = new THREE.Raycaster();
      this.colliders = garden.colliders;
    }

    // where the mouth is: a bit below and in front of the eyes
    mouth(out) {
      const cam = this.camera;   // in VR the user camera rides in the rig and is kept in sync with the headset
      cam.getWorldPosition(out);
      const fwd = cam.getWorldDirection(_v.clone()); fwd.y = 0; fwd.normalize();
      return out.addScaledVector(fwd, 0.03).add(new THREE.Vector3(0, -0.08, 0));
    }

    goHome() {
      this.scene.attach(this.mug);
      this.state = 'return'; this.anim = { t: 0, from: this.mug.matrixWorld.clone(), to: this.homeWorld.clone() };
    }
    putDown() {               // XR: open hand -> drop onto whatever is below, standing upright
      this.scene.attach(this.mug);
      const p = this.mug.getWorldPosition(new THREE.Vector3());
      this.ray.set(p.clone().add(new THREE.Vector3(0, 0.02, 0)), DOWN); this.ray.far = 3;
      const hit = this.ray.intersectObjects(this.colliders, true).find(h => { for (let q = h.object; q; q = q.parent) if (q === this.mug) return false; return h.object.visible; });
      if (!hit || hit.point.y < -0.5) return this.goHome();
      const half = (this.mug.geometry.boundingBox.max.y) * this.mug.getWorldScale(_v).y;
      const yaw = new THREE.Euler().setFromQuaternion(this.mug.getWorldQuaternion(_q), 'YXZ').y;
      const to = new THREE.Matrix4().compose(new THREE.Vector3(p.x, hit.point.y + half + 0.001, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), this.mug.getWorldScale(new THREE.Vector3()));
      this.state = 'drop'; this.anim = { t: 0, from: this.mug.matrixWorld.clone(), to };
    }

    setWorld(m) {               // mug lives in scene space while animating
      m.decompose(this.mug.position, this.mug.quaternion, this.mug.scale);
    }

    update(dt) {
      const mug = this.mug;
      // ---- motion
      if (this.state === 'lift') {             // PC: rise to the mouth, tilt toward it
        this.anim.t = Math.min(1, this.anim.t + dt * 2.2);
        const k = 1 - Math.pow(1 - this.anim.t, 3);
        const mouth = this.mouth(new THREE.Vector3());
        const cam = this.camera, fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
        const tilt = 0.35 + 0.75 * Math.min(1, (1 - this.level) * 1.2 + 0.2);    // tip further as it empties
        const s = new THREE.Vector3(); this.homeWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
        const target = new THREE.Matrix4().compose(
          mouth.clone().addScaledVector(fwd, 0.06 + 0.02 * tilt).add(new THREE.Vector3(0, -0.03, 0)),
          new THREE.Quaternion().setFromAxisAngle(right, tilt * k).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(fwd.x, fwd.z) + Math.PI / 2, 0))),
          s);
        const a = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
        const b = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
        this.anim.from.decompose(a, qa, sa); target.decompose(b, qb, sb);
        mug.position.lerpVectors(a, b, k); mug.quaternion.slerpQuaternions(qa, qb, k); mug.scale.copy(sb);
      } else if (this.state === 'return' || this.state === 'drop') {
        this.anim.t = Math.min(1, this.anim.t + dt * (this.state === 'drop' ? 4 : 2.5));
        const k = this.anim.t * this.anim.t * (3 - 2 * this.anim.t);
        const a = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
        const b = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
        this.anim.from.decompose(a, qa, sa); this.anim.to.decompose(b, qb, sb);
        mug.position.lerpVectors(a, b, k); mug.quaternion.slerpQuaternions(qa, qb, k); mug.scale.lerpVectors(sa, sb, k);
        if (this.anim.t >= 1) {
          if (this.state === 'return') { this.home.parent.add(mug); mug.position.copy(this.home.pos); mug.quaternion.copy(this.home.quat); }
          this.state = 'rest'; this.anim = null;
        }
      }

      // ---- drinking: rim near the mouth and the cup tipped
      mug.updateWorldMatrix(true, false);
      const rim = mug.localToWorld(new THREE.Vector3(0, this.inner.y1, 0));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mug.getWorldQuaternion(_q));
      const near = rim.distanceTo(this.mouth(new THREE.Vector3())) < (this.state === 'lift' ? 0.16 : 0.11);
      const tipped = up.y < 0.93;
      this.drinking = (this.state === 'lift' || this.state === 'held') && near && tipped && this.level > 0;
      if (this.drinking) {
        const was = this.level;
        this.level = Math.max(0, this.level - dt * 0.12);
        if (was > 0 && this.level === 0) this.refillT = 2.5;    // empty: refill a moment after
      }
      if (this.level === 0 && !this.drinking && this.state !== 'lift') {
        this.refillT -= dt; if (this.refillT <= 0) this.refilling = true;
      }
      if (this.refilling) { this.level = Math.min(1, this.level + dt * 0.5); if (this.level >= 1) this.refilling = false; }

      // ---- liquid surface: stays level with the world while the cup tips
      const y = this.inner.y0 + (this.inner.y1 - this.inner.y0) * this.level;
      this.liquid.visible = this.level > 0.01;
      this.liquid.position.set(0, y, 0);
      const wq = mug.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.liquid.quaternion.copy(wq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));

      // ---- steam: soft puffs rising, fewer as it cools/empties, none while at the mouth
      const top = mug.localToWorld(new THREE.Vector3(0, this.inner.y1, 0));
      const ws = mug.getWorldScale(_v).x * this.inner.r;
      const amount = this.level > 0.05 && !this.drinking ? 0.5 * Math.min(1, this.level + 0.3) : 0;
      for (const s of this.puffs) {
        const u = s.userData; u.t += dt * 0.35; if (u.t > 1) { u.t -= 1; u.x = Math.random() - 0.5; u.z = Math.random() - 0.5; }
        s.position.set(top.x + u.x * ws * 0.8 + Math.sin(u.t * 6 + u.x * 9) * 0.01, top.y + 0.01 + u.t * 0.16, top.z + u.z * ws * 0.8);
        const sc = 0.025 + u.t * 0.06; s.scale.set(sc, sc, 1);
        s.material.opacity = amount * Math.sin(u.t * Math.PI) * 0.35;
      }
    }
  }

  window.MugModule = MugModule;
});
