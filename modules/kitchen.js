// Kitchen props: a light oil bottle, a lemon that can be cut ONCE with a knife, and the knife. All can be picked up
// (hands: close the fist on it, mouse: hold the left button); let go and they fall onto whatever is below.
// Classic script (not an ES module) so double-clicking the html (file://) works. Needs herbs.js (input hub), kitchen.data.js.
window.kitchenReady = (async () => {
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
await window.herbsReady;

const REACH = 0.06, FAR_HOME = 2.2, _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const g_minY = g => (g && g.minY !== undefined ? g.minY : -5);

/** anything with a root Group (origin = its centre), a half-height `base` below the origin and a hit box */
class Grab {
  constructor(scene, garden, root, box, base, home) {
    this.scene = scene; this.garden = garden; this.root = root; this.base = base; this.localBox = box;
    this.home = home.clone(); this.state = 'rest'; this.vel = new THREE.Vector3(); this.heldBy = null; this.prev = root.position.clone(); this.speed = 0;
    scene.add(root); garden.extras.push(this);
  }
  get center() { return this.root.localToWorld(this.localBox.getCenter(new THREE.Vector3())); }   // the mouse aims at this
  tryGrab(s) {
    if (this.heldBy) return false;
    if (this.localBox.distanceToPoint(this.root.worldToLocal(_v.copy(s.hold))) > REACH) return false;
    this.heldBy = s; this.state = 'held'; return true;
  }
  drop(s) { this.heldBy = null; this.vel.copy(s.hvel).clampLength(0, 2.5); this.state = 'fall'; }
  update(dt) {
    const r = this.root;
    if (this.state === 'held' && this.heldBy) r.position.lerp(this.heldBy.hold, 1 - Math.exp(-dt * 30));
    else if (this.state === 'fall') {
      this.vel.y -= 9.8 * dt; r.position.addScaledVector(this.vel, dt);
      if (this.vel.y < 0) {
        const g = this.garden; g.ray.set(_v.copy(r.position).setY(r.position.y + 0.1), _v2.set(0, -1, 0)); g.ray.far = 0.6;
        const hit = g.ray.intersectObjects(g.colliders, true).find(h => window.herbIsSolid(h.object));
        if (hit && r.position.y - this.base <= hit.point.y + 0.002) { r.position.y = hit.point.y + this.base; this.state = 'rest'; this.vel.set(0, 0, 0); if (r.position.distanceTo(this.home) > FAR_HOME) this.reset(); }
      }
      if (r.position.y < g_minY(this.garden) || r.position.distanceTo(this.home) > FAR_HOME * 1.6) this.reset();
    }
    this.speed = r.position.distanceTo(this.prev) / Math.max(dt, 1e-3); this.prev.copy(r.position);
    if (this.after) this.after(dt);
  }
  reset() { this.root.position.copy(this.home); this.state = 'rest'; this.vel.set(0, 0, 0); }
  remove() { this.scene.remove(this.root); const i = this.garden.extras.indexOf(this); if (i >= 0) this.garden.extras.splice(i, 1); }
}
const boxOf = (sx, sy, sz) => new THREE.Box3(new THREE.Vector3(-sx / 2, -sy / 2, -sz / 2), new THREE.Vector3(sx / 2, sy / 2, sz / 2));

// ---------------------------------------------------------------- bottles: liquid = slim glass bottle with a liquid level; powder = wide jar filled with matte grains
const BOTTLES = {   // word/word2 = label lines, sub = small line, fill = colour, kind = liquid | powder
  coconut:  { word: 'coconut', word2: 'oil',   sub: '코코넛 오일 · 액체', kind: 'liquid', fill: 0xffd488, emissive: 0x5a3a10 },
  benzoin:  { word: 'benzoin', word2: '',      sub: '벤조인 · 액체', kind: 'liquid', fill: 0xb8651e, emissive: 0x3a1c06 },
  fairy:    { word: 'fairy',   word2: 'sugar', sub: '요정설탕 · 가루', kind: 'powder', fill: 0xffc6e0, emissive: 0x4a2a3a, sparkle: '#ffffff' },
  stardust: { word: 'star',    word2: 'dust',  sub: '별가루 · 가루', kind: 'powder', fill: 0xa9c4ff, emissive: 0x1e2a58, sparkle: '#fff6c0' },
  turmeric: { word: 'turmeric', word2: '',     sub: '강황 · 가루', kind: 'powder', fill: 0xe0a014, emissive: 0x3a2804, sparkle: null },
};
function grains(hex, sparkle) {                         // speckled matte texture for powders
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), col = new THREE.Color(hex);
  x.fillStyle = '#' + col.getHexString(); x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const v = Math.random(); x.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)'; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  if (sparkle) for (let i = 0; i < 70; i++) { x.fillStyle = sparkle; x.globalAlpha = 0.5 + Math.random() * 0.5; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeBottle(key = 'coconut') {
  const P = BOTTLES[key], powder = P.kind === 'powder', S = powder ? 0.05 : 0.056, g = new THREE.Group(); g.name = 'Bottle_' + key;
  const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * S, y * S)), seg);
  const GLASS = powder ? [[0.001, -0.8], [0.75, -0.8], [0.85, -0.74], [0.88, -0.6], [0.88, 0.3], [0.82, 0.42], [0.66, 0.5], [0.6, 0.58], [0.001, 0.58]].slice(0, 8)
    : [[0.001, -1.25], [0.62, -1.25], [0.8, -1.22], [0.88, -1.12], [0.88, 0.5], [0.84, 0.68], [0.66, 0.82], [0.46, 0.93], [0.35, 1.02], [0.32, 1.18], [0.38, 1.24], [0.39, 1.33], [0.34, 1.38], [0.28, 1.36]];
  const FILL = powder ? [[0.001, -0.74], [0.8, -0.74], [0.84, -0.6], [0.84, 0.1], [0.6, 0.18], [0.001, 0.22]] : [[0.001, -1.15], [0.6, -1.15], [0.8, -1.13], [0.84, -1.04], [0.84, 0.35], [0.001, 0.35]];
  g.add(new THREE.Mesh(lathe(FILL, 24), powder ? new THREE.MeshLambertMaterial({ map: grains(P.fill, P.sparkle), emissive: P.emissive }) : new THREE.MeshLambertMaterial({ color: P.fill, emissive: P.emissive })));
  g.add(new THREE.Mesh(lathe(GLASS), new THREE.MeshLambertMaterial({ color: 0xdfe8f2, transparent: true, opacity: powder ? 0.3 : 0.38, depthWrite: false, side: THREE.DoubleSide })));
  const lw = powder ? 1.5 : 1.15, lh = powder ? 0.62 : 0.72, c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * lh / lw); const x = c.getContext('2d'), CW = c.width, CH = c.height;
  x.fillStyle = 'rgba(255,252,246,0.95)'; x.beginPath(); x.roundRect(4, 4, CW - 8, CH - 8, 16); x.fill(); x.fillStyle = '#1b2748'; x.textAlign = 'center';
  const two = !!P.word2; x.font = '300 ' + (two ? 40 : 46) + 'px Georgia, serif'; x.fillText(P.word, CW / 2, two ? CH * 0.36 : CH * 0.46); if (two) x.fillText(P.word2, CW / 2, CH * 0.62);
  x.font = '500 17px sans-serif'; x.fillStyle = '#6b6258'; x.fillText(P.sub, CW / 2, CH * 0.88);
  const lt = new THREE.CanvasTexture(c); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(lw * S, lh * S), new THREE.MeshBasicMaterial({ map: lt, transparent: true })); label.position.set(0, powder ? -0.1 * S : 0.25 * S, (powder ? 0.9 : 0.9) * S); g.add(label);
  const k = document.createElement('canvas'); k.width = k.height = 64; const kx = k.getContext('2d'); kx.fillStyle = '#d6b27e'; kx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) { kx.fillStyle = 'rgba(120,80,40,' + Math.random() * 0.4 + ')'; kx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  const kt = new THREE.CanvasTexture(k); kt.colorSpace = THREE.SRGBColorSpace;
  g.add(new THREE.Mesh(lathe(powder ? [[0.001, 0.46], [0.5, 0.46], [0.55, 0.56], [0.7, 0.58], [0.74, 0.64], [0.74, 0.8], [0.7, 0.84], [0.001, 0.84]] : [[0.001, 1.0], [0.27, 1.0], [0.31, 1.14], [0.41, 1.16], [0.43, 1.22], [0.43, 1.36], [0.39, 1.4], [0.001, 1.4]], 20), new THREE.MeshLambertMaterial({ map: kt })));
  const top = powder ? 0.84 : 1.4, bot = powder ? -0.8 : -1.25, wid = powder ? 0.88 : 0.88;
  g.userData.base = -bot * S; g.userData.box = new THREE.Box3(new THREE.Vector3(-wid * S, bot * S, -wid * S), new THREE.Vector3(wid * S, top * S, wid * S)); g.userData.kind = P.kind;
  return g;
}

// ---------------------------------------------------------------- knife
function makeKnife() {
  const g = new THREE.Group(); g.name = 'Knife';
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.026), new THREE.MeshLambertMaterial({ color: 0xcfd3d8, emissive: 0x30343a }));
  blade.position.x = -0.075; g.add(blade);                                   // blade points to -x (away from the player)
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.02), new THREE.MeshLambertMaterial({ color: 0x4a2c1a }));
  handle.position.x = 0.05; g.add(handle);
  return g;
}

// ---------------------------------------------------------------- lemon, cut once
const LEMON_LEN = 0.078;
const lemonGltf = () => new Promise((res, rej) => new GLTFLoader().parse(Uint8Array.from(atob(window.LEMON_GLB_B64), c => c.charCodeAt(0)).buffer, '', res, rej));

/** keep the part of an indexed triangle mesh on one side of the plane x = 0 (side +1 / -1) */
function clipX(geo, side) {
  const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, I = geo.index.array, pos = [], nrm = [], uv = [];
  const vert = i => ({ p: [P.getX(i), P.getY(i), P.getZ(i)], n: [N.getX(i), N.getY(i), N.getZ(i)], u: [U.getX(i), U.getY(i)] });
  const mix = (a, b, t) => ({ p: a.p.map((v, k) => v + (b.p[k] - v) * t), n: a.n.map((v, k) => v + (b.n[k] - v) * t), u: a.u.map((v, k) => v + (b.u[k] - v) * t) });
  const push = v => { pos.push(...v.p); nrm.push(...v.n); uv.push(...v.u); };
  for (let t = 0; t < I.length; t += 3) {
    const v = [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])], d = v.map(a => a.p[0] * side), out = [];
    for (let k = 0; k < 3; k++) {                                             // Sutherland-Hodgman against one plane
      const a = v[k], b = v[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const m = mix(a, b, da / (da - db)); m.p[0] = 0; out.push(m); }
    }
    for (let k = 1; k + 1 < out.length; k++) { push(out[0]); push(out[k]); push(out[k + 1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function capTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const disc = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(128, 128, r, 0, 6.2832); g.fill(); };
  disc(128, '#e9c81c'); disc(119, '#fff4c4'); disc(108, '#f4e27a');
  g.strokeStyle = '#fff4c4'; g.lineWidth = 3; for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); g.stroke(); }
  disc(9, '#fff4c4'); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const gltf = await lemonGltf(); let lemonMesh = null; gltf.scene.traverse(o => { if (o.isMesh && !lemonMesh) lemonMesh = o; });
const lemonGeo = lemonMesh.geometry.clone(); lemonGeo.scale(0.9043, 1, 1); lemonGeo.computeBoundingBox();
{ const c = lemonGeo.boundingBox.getCenter(new THREE.Vector3()); lemonGeo.translate(-c.x, -c.y, -c.z); lemonGeo.computeBoundingBox(); }
const lemonMap = lemonMesh.material.map; lemonMap.anisotropy = 1;
const lemonMat = new THREE.MeshLambertMaterial({ map: lemonMap, side: THREE.DoubleSide, color: 0xffffff, emissive: 0x4a3f08 }), capMat = new THREE.MeshLambertMaterial({ map: capTexture(), side: THREE.DoubleSide, emissive: 0x2a2208 });
const SC = LEMON_LEN / (lemonGeo.boundingBox.max.x - lemonGeo.boundingBox.min.x), RMAX = lemonGeo.boundingBox.max.y;

class Lemon extends Grab {
  constructor(scene, garden, pos) {
    const root = new THREE.Group(); root.name = 'Lemon'; const m = new THREE.Mesh(lemonGeo, lemonMat); m.scale.setScalar(SC); root.add(m); root.position.copy(pos);
    super(scene, garden, root, boxOf(LEMON_LEN, RMAX * 2 * SC, RMAX * 2 * SC), RMAX * SC, pos); this.cut = false; this.knife = null;
  }
  after() {                                                                   // the knife must be moving through it
    const k = this.knife; if (this.cut || !k || k.state !== 'held' || k.speed < 0.45) return;
    const box = this.localBox.clone().expandByScalar(0.006);
    for (const lp of [[-0.12, -0.002, 0], [-0.05, -0.002, 0]]) if (box.containsPoint(this.root.worldToLocal(k.root.localToWorld(_v.set(...lp))))) { this.doCut(); return; }
  }
  doCut() {
    this.cut = true; if (window.Audio3D) window.Audio3D.shot('cut', this.root.position, 1);
    const w = this.root.position.clone(), home = this.home.clone();
    [1, -1].forEach(side => {
      const grp = new THREE.Group(); const lm = new THREE.Mesh(clipX(lemonGeo, side), lemonMat); lm.scale.setScalar(SC); grp.add(lm);
      const cg = new THREE.BufferGeometry(), pos = [0, 0, 0], nrm = [side, 0, 0], uv = [0.5, 0.5], idx = [], n = 40;
      for (let i = 0; i <= n; i++) { const a = i / n * 6.2832; pos.push(0, Math.cos(a) * RMAX, Math.sin(a) * RMAX); nrm.push(side, 0, 0); uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); if (i) idx.push(0, i, i + 1); }
      cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); cg.setIndex(idx);
      const cm = new THREE.Mesh(cg, capMat); cm.scale.setScalar(SC); grp.add(cm);
      grp.rotation.z = -side * Math.PI / 2;                                     // cut face up, rounded end down
      const root = new THREE.Group(); root.name = 'LemonHalf'; root.add(grp); root.position.copy(w); root.rotation.y = this.root.rotation.y; const th = this.root.rotation.y, ax = Math.cos(th), az = -Math.sin(th); root.position.x += ax * side * 0.02; root.position.z += az * side * 0.02;   // halves part along the lemon's long axis
      const h = new Grab(this.scene, this.garden, root, new THREE.Box3(new THREE.Vector3(-RMAX * SC, -LEMON_LEN / 2, -RMAX * SC), new THREE.Vector3(RMAX * SC, 0.006, RMAX * SC)), LEMON_LEN / 2, home); h.state = 'fall'; h.vel.set(ax * side * 0.15, 0.3, az * side * 0.15);
    });
    if (this.heldBy) this.heldBy.heldExt = null;
    this.remove();
  }
}

return { Grab, makeBottle, makeKnife, Lemon, BOTTLES };
})();
window.Kitchen = null; window.kitchenReady.then(k => { window.Kitchen = k; });
