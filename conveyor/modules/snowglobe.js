// Snow globe module: glass dome over the model, grab it (pinch/fist/mouse) and shake it -> snow swirls, then settles.
// Classic script like mug.js (works from file://). Needs herbs.js loaded first (it owns grab input).
// Cost: 1 extra draw call for the glass, 1 for the snow (Points). Nothing allocates per frame.
window.snowGlobeReady = (async () => {
const THREE = await import('three');
await window.herbsReady;

const N = 180;                                   // snowflakes (one Points draw call)
const REACH = 0.06, FAR_HOME = 2.2;              // metres: grab distance / a dropped globe farther than this goes back
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, 6.283); g.fill();   // crisp disc, no soft glow
  return new THREE.CanvasTexture(c);
}

// cheap glass: fresnel rim + one fixed highlight, no env map / transmission (those are too heavy for Quest)
const glassMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { L: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() } },
  vertexShader: `varying vec3 vN, vV; void main(){ vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal);
    vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform vec3 L; varying vec3 vN, vV; void main(){ vec3 n = normalize(vN), v = normalize(vV);
    float f = pow(1. - max(dot(n, v), 0.), 3.), s = pow(max(dot(reflect(-L, n), v), 0.), 150.);
    gl_FragColor = vec4(mix(vec3(.75,.88,1.), vec3(1.), s), 0.04 + 0.45*f + 0.6*s); }`,
});

class SnowGlobeModule {
  /** @param root object holding the globe model  @param garden HerbGarden (grab input)  @param opt {scale, domeCenter:[x,y,z] model-space, domeRadius, floorY}  */
  constructor(root, scene, garden, opt = {}) {
    this.garden = garden;
    const S = opt.scale ?? 0.17;
    this.root = new THREE.Group(); this.root.name = 'SnowGlobeModule';
    root.updateMatrixWorld(true);
    const box0 = new THREE.Box3().setFromObject(root), c = box0.getCenter(new THREE.Vector3());
    this.root.position.set(c.x, box0.min.y, c.z); scene.add(this.root);   // origin = bottom centre
    this.root.attach(root); root.scale.multiplyScalar(S); root.position.set(0, 0, 0); this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root).translate(_v.copy(this.root.position).negate()); root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    this.H = box.max.y - box.min.y; this.W = box.max.x - box.min.x;
    root.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.localBox = new THREE.Box3(new THREE.Vector3(-this.W / 2, 0, -this.W / 2), new THREE.Vector3(this.W / 2, this.H, this.W / 2));

    // dome (model-space numbers are tuned by eye in snowglobe-test.html)
    const dc = opt.domeCenter ?? [0, 0.53, 0], dr = (opt.domeRadius ?? 0.39) * S;
    this.R = dr; this.fy = (opt.floorY ?? 0.36) * S;                          // snow floor = top of the base (model units from the bottom)
    this.dome = new THREE.Group(); this.dome.position.set(dc[0] * S, dc[1] * S, dc[2] * S); this.dome.scale.y = opt.domeStretch ?? 1.15; this.root.add(this.dome);   // taller than wide, so the tree top fits inside
    const glass = new THREE.Mesh(new THREE.SphereGeometry(dr, 24, 16, 0, 6.283, 0, Math.acos(THREE.MathUtils.clamp(this.floorLocal() / dr, -1, 1))), glassMat()); glass.renderOrder = 2; this.dome.add(glass);

    // snow: positions live in dome-local space; p = flake position, v = velocity
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.ph[i] = Math.random() * 6.283; this.spawn(i, true); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), dr * 2);
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot(), size: 0.0065, sizeAttenuation: true, transparent: true, depthWrite: false, color: 0xffffff }));
    this.snow.renderOrder = 1; this.snow.frustumCulled = false; this.dome.add(this.snow);

    this.state = 'rest'; this.heldBy = null; this.vel = new THREE.Vector3(); this.pv = new THREE.Vector3(); this.acc = new THREE.Vector3();
    this.energy = 0; this.t = 0; this.home = this.root.position.clone(); this.off = new THREE.Vector3();
    garden.extras.push(this);
  }

  // a flake inside the dome; initial=true scatters them on the floor, otherwise anywhere in the sphere
  spawn(i, rest) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * this.R * 0.8, y = this.floorLocal() + (rest ? Math.random() * 0.004 : Math.random() * this.R);
    this.p.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3); this.v.fill(0, i * 3, i * 3 + 3);
  }
  floorLocal() { return (this.fy - this.dome.position.y) / this.dome.scale.y; }   // snow floor in dome space: fy is measured from the root bottom

  get center() { return _v.copy(this.root.position).add(_v2.set(0, this.H / 2, 0).applyQuaternion(this.root.quaternion)).clone(); }

  // ---- called by HerbGarden
  tryGrab(s) {
    if (this.localBox.distanceToPoint(this.root.worldToLocal(_v.copy(s.hold))) > REACH) return false;
    this.heldBy = s; this.state = 'held'; this.back = this.root.position.clone();
    this.off.copy(this.root.position).sub(s.hold);          // keep the spot you grabbed it at
    this.pv.copy(this.root.position); return true;
  }
  drop(s) { this.heldBy = null; this.vel.copy(s.hvel).clampLength(0, 2.5); this.state = 'fall'; }

  update(dt) {
    dt = Math.min(dt, 0.05); this.t += dt; const r = this.root, prev = _v2.copy(r.position).clone();
    if (this.state === 'held') {
      r.position.lerp(_v.copy(this.heldBy.hold).add(this.off), 1 - Math.exp(-dt * 30));
      const hv = this.heldBy.hvel;                           // tilt a little into the motion so shaking reads visually
      _q.setFromEuler(new THREE.Euler(THREE.MathUtils.clamp(hv.z * 0.12, -.5, .5), 0, THREE.MathUtils.clamp(-hv.x * 0.12, -.5, .5)));
      r.quaternion.slerp(_q, 1 - Math.exp(-dt * 12));
    } else if (this.state === 'fall') {
      this.vel.y -= 9.8 * dt; r.position.addScaledVector(this.vel, dt); r.quaternion.slerp(_q.identity(), Math.min(1, dt * 8));
      if (this.vel.y < 0) {
        const g = this.garden; g.ray.set(_v.copy(r.position).setY(r.position.y + 0.1), _v2.set(0, -1, 0)); g.ray.far = 0.6;
        const hit = g.ray.intersectObjects(g.colliders, true).find(h => window.herbIsSolid(h.object));
        if (hit && r.position.y <= hit.point.y + 0.002) { r.position.y = hit.point.y; this.state = 'rest'; this.vel.set(0, 0, 0); r.quaternion.identity();
          if (r.position.distanceTo(this.home) > FAR_HOME) r.position.copy(this.home); }
      }
      if (r.position.y < this.garden.minY || r.position.distanceTo(this.home) > FAR_HOME * 1.6) { r.position.copy(this.home); r.quaternion.identity(); this.state = 'rest'; this.vel.set(0, 0, 0); }
    }

    // shake = globe acceleration (world) -> flakes feel the opposite push, in dome-local space
    const acc = this.acc.copy(r.position).sub(prev).divideScalar(dt).sub(this.pv).divideScalar(dt);   // pv is last frame's velocity here
    this.pv.copy(r.position).sub(prev).divideScalar(dt);
    const shake = this.state === 'held' ? Math.min(acc.length() / 40, 1.5) : 0;
    this.energy += (Math.max(this.energy, shake) - this.energy) * Math.min(1, dt * 20); this.energy *= Math.exp(-dt * 0.9);   // swirl lasts ~2-3 s
    const push = _v.copy(acc).multiplyScalar(-0.00045).applyQuaternion(_q.copy(r.quaternion).invert());
    const p = this.p, v = this.v, R = this.R, fl = this.floorLocal(), e = this.energy;
    for (let i = 0, k = 0; i < N; i++, k += 3) {
      const ph = this.ph[i];
      if (e > 0.02) {                                         // stirred up: the shake's push + swirling turbulence (accel in m/s^2, scaled by energy)
        const a = 0.5 * e * dt;
        v[k] += push.x + Math.sin(this.t * 5 + ph * 3) * a; v[k + 1] += push.y + Math.sin(this.t * 4 + ph * 5) * a * 1.4 + a * 0.4; v[k + 2] += push.z + Math.cos(this.t * 6 + ph * 2) * a;
      }
      const drag = Math.exp(-dt * 2.5); v[k] *= drag; v[k + 1] *= drag; v[k + 2] *= drag; v[k + 1] -= 0.03 * dt * 2.5;   // drag + gravity -> falls ~3 cm/s
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      if (p[k + 1] < fl) { p[k + 1] = fl; v[k + 1] = 0; v[k] *= 0.5; v[k + 2] *= 0.5; }     // lies on the floor
      const d = Math.hypot(p[k], p[k + 1], p[k + 2]), lim = R * 0.96;
      if (d > lim) { const s = lim / d; p[k] *= s; p[k + 1] *= s; p[k + 2] *= s; v[k] *= -0.3; v[k + 1] *= -0.3; v[k + 2] *= -0.3; }   // glass wall
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
  }
}
window.SnowGlobeModule = SnowGlobeModule;
})();
