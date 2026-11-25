// Drawer module: the 6 drawers of the small cabinet ("MaterialDrawer") slide out when you hold their knob and pull.
// Hands: close the fist around a knob and pull towards you.  Mouse: left-drag on a knob.  Needs herbs.js (input hub).
// Classic script (not an ES module) so double-clicking the html (file://) works.
window.drawersReady = (async () => {
const THREE = await import('three');
await window.herbsReady;

const TRAVEL = 0.12;        // how far a drawer comes out (m)
const REACH = 0.07;         // fist/palm to knob distance that counts as holding it
const SNAP_SHUT = 0.15;     // released below this opening (0..1) -> it closes by itself
const _v = new THREE.Vector3();

class DrawerSet {
  /** @param root object that contains the node "MaterialDrawer"  @param garden HerbGarden (pinch/fist input hub) */
  constructor(root, scene, garden) {
    this.garden = garden; this.drawers = []; this.grabs = new Map(); this.dir = new THREE.Vector3(0, 0, -1); // fronts face -z (towards the player)
    const cab = this.cab = root.getObjectByName('MaterialDrawer'); if (!cab) return;
    root.updateMatrixWorld(true);
    const parts = cab.children.filter(o => o.isMesh);
    const fronts = parts.filter(o => /^Drawer\d{3}$/.test(o.name));
    const small = parts.filter(o => /^(Drawer_Knob|NameTag|Nobe_Base)/.test(o.name));
    // one local-space step = TRAVEL metres along `dir` in the world
    const w0 = cab.getWorldPosition(new THREE.Vector3());
    this.step = cab.worldToLocal(w0.clone().addScaledVector(this.dir, TRAVEL)).sub(cab.worldToLocal(w0.clone()));
    this.dirL = cab.worldToLocal(w0.clone().add(this.dir)).sub(cab.worldToLocal(w0.clone())).normalize();
    for (const f of fronts) {
      const b = new THREE.Box3().setFromObject(f), mine = [f];
      for (const s of small) {                           // knob, base and name tag that sit on this front
        const c = new THREE.Box3().setFromObject(s).getCenter(_v);
        if (c.x > b.min.x - 0.01 && c.x < b.max.x + 0.01 && c.y > b.min.y - 0.01 && c.y < b.max.y + 0.01) mine.push(s);
      }
      mine.forEach(o => { o.matrixAutoUpdate = true; o.userData.dynamic = true; });   // keep moving (index.html freezes static meshes)
      const knob = mine.find(o => /^Drawer_Knob/.test(o.name));
      const closedKnob = cab.worldToLocal(new THREE.Box3().setFromObject(knob || f).getCenter(new THREE.Vector3()));   // cabinet space: the cabinet may move later
      const slot = new THREE.Group(); slot.name = f.name + '_contents';       // put whatever lives in this drawer in here
      cab.add(slot); slot.position.copy(cab.worldToLocal(b.getCenter(new THREE.Vector3())));
      this.drawers.push({ name: f.name, parts: mine.map(o => ({ o, base: o.position.clone() })), closedKnob, slot, slotBase: slot.position.clone(), t: 0 });
    }
    garden.extras.push(this);                          // join the input hub (grab / drop / update)
  }

  // the cabinet can be moved / turned after it is made (conveyor table): positions are kept in cabinet space and turned to world here
  get box() { return new THREE.Box3().setFromObject(this.cab); }
  get center() { return this.box.getCenter(new THREE.Vector3()); }
  worldDir() { return this.dirL.clone().transformDirection(this.cab.matrixWorld); }
  knobPos(d) { return this.cab.localToWorld(d.closedKnob.clone()).addScaledVector(this.worldDir(), TRAVEL * d.t); }

  // ---- called by HerbGarden (closed fist / mouse press)
  tryGrab(s) {
    let best = null, bd = Infinity;
    for (const d of this.drawers) {
      if ([...this.grabs.values()].some(g => g.d === d)) continue;
      const k = this.knobPos(d);
      const dist = s.id === 'mouse' ? this.garden.ray.ray.distanceToPoint(k) * 2 : s.hold.distanceTo(k);   // mouse: distance to the view ray
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best || bd > (s.id === 'mouse' ? 0.07 : REACH)) return false;
    this.grabs.set(s, { d: best, t0: best.t, p0: s.hold.clone() }); return true;
  }
  drop(s) {
    const g = this.grabs.get(s); this.grabs.delete(s);
    if (g) g.d.shut = g.d.t < SNAP_SHUT;
  }

  update(dt) {
    for (const [s, g] of this.grabs) {
      g.d.t = THREE.MathUtils.clamp(g.t0 + _v.copy(s.hold).sub(g.p0).dot(this.worldDir()) / TRAVEL, 0, 1); g.d.shut = false;
    }
    for (const d of this.drawers) {
      if (d.shut) d.t = Math.max(0, d.t - dt * 0.9);
      if (window.Audio3D && (d.cool = (d.cool || 0) - dt) < 0) {          // 3D sound when a drawer starts to open / reaches shut
        if (!d.isOpen && d.t > 0.04) { d.isOpen = true; d.cool = 0.5; window.Audio3D.drawer(this.knobPos(d), false); }
        else if (d.isOpen && d.t < 0.01) { d.isOpen = false; d.cool = 0.5; window.Audio3D.drawer(this.knobPos(d), true); }
      }
      for (const p of d.parts) p.o.position.copy(p.base).addScaledVector(this.step, d.t);
      d.slot.position.copy(d.slotBase).addScaledVector(this.step, d.t);
    }
  }
}
window.DrawerSet = DrawerSet;
})();
