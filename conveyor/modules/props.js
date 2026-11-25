// Props module: small decorative models (Meshy figurines + the hearth table) built from the compact data in props.data.js
// (positions / normals / uvs / indices + a 1K base-colour jpeg per model). Some props can be picked up and carried:
// hands = close the fist on it, mouse = hold the left button; let go and it falls onto whatever is below and stays there.
// Classic script (not an ES module) so double-clicking the html (file://) works. Needs herbs.js (input hub) loaded first.
window.propsReady = (async () => {
const THREE = await import('three');
await window.herbsReady;

const REACH = 0.06, FAR_HOME = 2.2;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

function makeGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b64(d.pos)), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b64(d.nrm)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b64(d.uv)), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(b64(d.idx)), 1));
  g.computeBoundingBox(); return g;
}

class Prop {
  /** @param key table|angel|deer|snow  @param o {scale, position (world, BASE of the model), rotationY, grab, garden} */
  constructor(scene, key, o) {
    const d = window.PROPS_DATA[key];
    const geo = makeGeometry(d), bb = geo.boundingBox, s = o.scale;
    const tex = new THREE.TextureLoader().load(d.tex); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 1;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    this.mesh.scale.setScalar(s); this.mesh.position.set(0, -bb.min.y * s, 0);          // origin of `root` = underside of the model
    this.root = new THREE.Group(); this.root.name = 'Prop_' + key; this.root.add(this.mesh);
    this.root.position.copy(o.position); this.root.rotation.y = o.rotationY || 0; scene.add(this.root);
    this.size = bb.getSize(new THREE.Vector3()).multiplyScalar(s); this.H = this.size.y;
    this.home = o.position.clone(); this.homeRot = this.root.rotation.y;
    this.garden = o.garden; this.state = 'rest'; this.vel = new THREE.Vector3(); this.heldBy = null;
    this.localBox = new THREE.Box3(new THREE.Vector3(-this.size.x / 2, 0, -this.size.z / 2), new THREE.Vector3(this.size.x / 2, this.H, this.size.z / 2));
    if (o.grab && o.garden) o.garden.extras.push(this);                                  // joins the pinch/fist input hub
  }
  get center() { return _v2.copy(this.root.position).add(_v.set(0, this.H / 2, 0)).clone(); }

  tryGrab(s) {
    if (this.heldBy) return false;
    if (this.localBox.distanceToPoint(this.root.worldToLocal(_v.copy(s.hold))) > REACH) return false;
    this.heldBy = s; this.state = 'held'; return true;
  }
  drop(s) { this.heldBy = null; this.vel.copy(s.hvel).clampLength(0, 2.5); this.state = 'fall'; }

  update(dt) {
    const r = this.root;
    if (this.state === 'held') {
      const t = this.heldBy.hold.clone().sub(_v.set(0, this.H / 2, 0));
      r.position.lerp(t, 1 - Math.exp(-dt * 30));
    } else if (this.state === 'fall') {
      this.vel.y -= 9.8 * dt; r.position.addScaledVector(this.vel, dt);
      if (this.vel.y < 0) {
        const g = this.garden; g.ray.set(_v.copy(r.position).setY(r.position.y + 0.1), _v2.set(0, -1, 0)); g.ray.far = 0.6;
        const hit = g.ray.intersectObjects(g.colliders, true).find(h => window.herbIsSolid(h.object));
        if (hit && r.position.y <= hit.point.y + 0.002) {
          r.position.y = hit.point.y; this.state = 'rest'; this.vel.set(0, 0, 0);
          if (r.position.distanceTo(this.home) > FAR_HOME) this.reset();                  // thrown too far: back where it started
        }
      }
      if (r.position.y < g_minY(this.garden) || r.position.distanceTo(this.home) > FAR_HOME * 1.6) this.reset();
    }
  }
  reset() { this.root.position.copy(this.home); this.root.rotation.y = this.homeRot; this.state = 'rest'; this.vel.set(0, 0, 0); }
}
const g_minY = g => (g && g.minY !== undefined ? g.minY : -5);

window.Prop = Prop;
})();
