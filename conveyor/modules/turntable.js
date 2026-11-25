// Turntable module: the vintage turntable (modules/turntable.glb) with a spinning platter + LP, and a BGM "jukebox" that
// plays the tracks in turns. Classic script (not an ES module) so double-clicking the html (file://) works.
// Needs modules/turntable.glb.js (base64 of the glb) loaded first.
window.turntableReady = (async () => {
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

const RPM = 33.333;                                   // LP speed
const OMEGA = RPM / 60 * Math.PI * 2;                 // rad/s

/** Plays the tracks one after another, forever, through a vinyl filter and out of the turntable's position (3D sound).
 *  Browsers only allow audio after a user gesture: call start() from one. */
class Jukebox {
  constructor(count = 3, volume = 0.35) {
    this.n = count; this.i = 0; this.wanted = true; this.src = null; this.offset = 0; this.t0 = 0; this.token = 0; this.pos = new THREE.Vector3(0, 1, 0);
    const A = window.Audio3D, c = A.ctx;
    this.panner = A.panner(0.7, 1.3); this.out = c.createGain(); this.out.gain.value = volume; this.out.connect(this.panner); this.panner.connect(c.destination);
    this.chain = A.vinylChain(this.out);
    setInterval(() => { if (this.src) this.chain.wow(this.src, c.currentTime); }, 60);
  }
  setPosition(v) { this.pos.copy(v); window.Audio3D.setPos(this.panner, v); }
  get playing() { return !!this.src; }
  start() { window.Audio3D.resume(); if (this.wanted && !this.src) this._play(); }          // safe to call on every gesture
  async _play() {
    const my = ++this.token, A = window.Audio3D, c = A.ctx; let buf;
    try { buf = await A.decode('bgm' + this.i); } catch (e) { console.error(e); this.i = (this.i + 1) % this.n; return; }
    if (my !== this.token || !this.wanted) return;
    const s = c.createBufferSource(); s.buffer = buf; s.connect(this.chain.input);
    s.onended = () => { if (this.src === s) { this.src = null; this.offset = 0; this.i = (this.i + 1) % this.n; if (this.wanted) this._play(); } };
    this.src = s; this.t0 = c.currentTime - this.offset; s.start(0, this.offset);
  }
  toggle() {
    this.wanted = !this.wanted; const c = window.Audio3D.ctx;
    if (this.wanted) { window.Audio3D.resume(); this._play(); }
    else if (this.src) { const s = this.src; this.src = null; this.token++; this.offset = c.currentTime - this.t0; s.onended = null; try { s.stop(); } catch (e) {} }
    return this.wanted;
  }
}

class Turntable {
  /** @param opt {position:Vector3, scale:number, rotationY:number, jukebox:Jukebox} */
  constructor(scene, opt) {
    this.scene = scene; this.jukebox = opt.jukebox; this.speed = 0; this.root = new THREE.Group(); this.root.name = 'Turntable';
    this.ready = new Promise(res => new GLTFLoader().parse(Uint8Array.from(atob(window.TURNTABLE_GLB_B64), c => c.charCodeAt(0)).buffer, '', g => { this._build(g); res(this); }, e => { console.error(e); res(this); }));
    this.root.position.copy(opt.position); this.root.scale.setScalar(opt.scale); this.root.rotation.y = opt.rotationY || 0;
    scene.add(this.root);
  }

  _build(gltf) {
    let src = null; gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index.array;
    // the platter is the BIGGEST connected piece in the top-left island of the texture atlas (u < .375, v < .495). The same
    // island also holds ~45 tiny tonearm / lever parts, which must NOT spin with it, so group the island's triangles into
    // connected pieces (union-find) and take only the largest.
    const inIsland = i => uv.getX(i) < 0.375 && uv.getY(i) < 0.495;
    const par = new Int32Array(pos.count).map((_, i) => i), find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let t = 0; t < idx.length; t += 3) if (inIsland(idx[t]) && inIsland(idx[t + 1]) && inIsland(idx[t + 2])) { par[find(idx[t])] = find(idx[t + 1]); par[find(idx[t + 1])] = find(idx[t + 2]); }
    const size = new Map(); for (let t = 0; t < idx.length; t += 3) if (inIsland(idx[t]) && inIsland(idx[t + 1]) && inIsland(idx[t + 2])) { const r = find(idx[t]); size.set(r, (size.get(r) || 0) + 1); }
    let big = -1, bn = 0; for (const [r, n] of size) if (n > bn) { bn = n; big = r; }
    const plat = [], body = [];
    for (let t = 0; t < idx.length; t += 3) (big >= 0 && inIsland(idx[t]) && inIsland(idx[t + 1]) && inIsland(idx[t + 2]) && find(idx[t]) === big ? plat : body).push(idx[t], idx[t + 1], idx[t + 2]);
    const nrm = geo.attributes.normal;                                                  // zero-length normals -> NaN lighting -> black screen rectangle
    for (let i = 0; i < nrm.count; i++) if (!(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) > 1e-4)) nrm.setXYZ(i, 0, 1, 0);
    nrm.needsUpdate = true;
    const gb = geo.clone(), gp = geo.clone(); gb.setIndex(body); gp.setIndex(plat);
    // maps: base colour only (the metal-rough + normal maps are heavy and barely visible at shelf distance), 1024 px
    const mat0 = src.material, tex = mat0.map, im = tex.image;
    if (im && im.width > 1024) { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d').drawImage(im, 0, 0, 1024, 1024); tex.image = c; }
    tex.needsUpdate = true; tex.anisotropy = 1;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
    this.model = new THREE.Group(); this.model.name = 'TurntableModel'; this.root.add(this.model);
    this.model.add(new THREE.Mesh(gb, mat));

    // platter centre / radius / top height from its own vertices
    const bb = new THREE.Box3(), v = new THREE.Vector3();
    for (let t = 0; t < plat.length; t++) bb.expandByPoint(v.fromBufferAttribute(pos, plat[t]));
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, R = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    let top = bb.min.y; for (let t = 0; t < plat.length; t++) { v.fromBufferAttribute(pos, plat[t]); if (Math.hypot(v.x - cx, v.z - cz) < R * 0.6) top = Math.max(top, v.y); }
    this.spin = new THREE.Group(); this.spin.position.set(cx, 0, cz); this.model.add(this.spin);       // rotates about the platter axis
    const pm = new THREE.Mesh(gp, mat); pm.position.set(-cx, 0, -cz); this.spin.add(pm);
    this.info = { cx, cz, R, top };

    // the LP: black vinyl with fine grooves + a coloured label, resting on the platter
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, 512, 512);
    for (let r = 120; r < 250; r += 2.2) { g.strokeStyle = `rgba(${40 + (r * 7) % 30},${40 + (r * 7) % 30},${46 + (r * 5) % 24},0.55)`; g.lineWidth = 1; g.beginPath(); g.arc(256, 256, r, 0, 6.2832); g.stroke(); }
    [[165, 168], [190, 193], [212, 214]].forEach(([a, b]) => { g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = b - a; g.beginPath(); g.arc(256, 256, (a + b) / 2, 0, 6.2832); g.stroke(); });   // track gaps
    g.fillStyle = '#b8322a'; g.beginPath(); g.arc(256, 256, 100, 0, 6.2832); g.fill();                     // label
    g.fillStyle = '#f4e6c8'; g.beginPath(); g.arc(256, 256, 62, 0, 6.2832); g.fill();
    g.fillStyle = '#b8322a'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('XMAS', 256, 258); g.font = '22px sans-serif'; g.fillText('33⅓ RPM', 256, 290);
    g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(256, 256, 7, 0, 6.2832); g.fill();                        // spindle hole
    const lt = new THREE.CanvasTexture(c); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 1;
    const lr = R * 0.93, th = R * 0.012;
    const side = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.35, metalness: 0.1 });
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(lr, lr, th, 48), [side, new THREE.MeshStandardMaterial({ map: lt, roughness: 0.3, metalness: 0.15 }), side]);
    lp.position.set(0, top + th / 2 + R * 0.004, 0); this.spin.add(lp);
    this.lp = lp;
  }

  update(dt) {
    if (!this.spin) return;
    const target = this.jukebox && this.jukebox.playing ? OMEGA : 0;           // the LP only turns while music plays
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (target ? 1.6 : 0.9)));   // spin up / coast down
    this.spin.rotation.y -= this.speed * dt;
  }
}
Object.assign(window, { Turntable, Jukebox });
})();
