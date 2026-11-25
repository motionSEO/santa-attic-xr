/**
 * LUSH Recipe Book — drop-in three.js module
 * ------------------------------------------
 * const book = await createRecipeBook({ renderer, assetsUrl: './assets/' });
 * scene.add(book.object);
 * // every frame: book.update(dt)
 *
 * Everything is in metres (book ≈ 0.30 × 0.43 m when closed). See README.md for the full API.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* ---------- book dimensions (must match the GLB build) ---------- */
const BW = 0.30, XS = -BW / 2, CT = 0.007, HB = 0.052, HS = 0.034, PD = 0.40;

export const RECIPE_IDS = ['santa', 'tree', 'ginger', 'snowman', 'silent', 'drift'];

/**
 * @param {object} opts
 * @param {THREE.WebGLRenderer} [opts.renderer]  used for texture anisotropy / pre-upload (optional)
 * @param {string} [opts.assetsUrl='./assets/']  folder that holds models/, pages/, ui/
 */
export async function createRecipeBook({ renderer = null, assetsUrl = './assets/' } = {}) {
  const base = assetsUrl.endsWith('/') ? assetsUrl : assetsUrl + '/';
  const A = {
    closedGlb: base + 'models/recipe_book_closed.glb', openGlb: base + 'models/recipe_book_open.glb',
    paperSheet: base + 'ui/paper_sheet.webp', paperSpread: base + 'ui/paper_spread.jpg',
    pageEmotion: base + 'pages/emotion.jpg', page: k => base + 'pages/recipe_' + k + '.jpg',
    arrow: base + 'ui/arrow.png', strike: base + 'ui/strike.png', marks: base + 'ui/emotion_marks.png', marksParam: base + 'ui/emotion_marks_order.png',
  };
  const listeners = {};
  const emit = (type, data) => (listeners[type] || []).forEach(f => f(data));
  const ui = () => emit('change', snapshot());
  let warmupVisible = false;

  /* =====================================================================
     One continuous book: rounded-back page block bound to a flexible spine.
     Closed  : leaves lie flat, their roots form a convex round back inside a round spine.
     Opening : the front board swings over, the spine flattens and arches slightly,
               the leaves' roots slide down into the gutter and the pages curve up out of it.
     Nothing is swapped between states, so every motion flows into the next.
     ===================================================================== */
  const YT = CT * 2 + HB, PW2 = 0.28, LP = 0.28;          // leaf length root -> fore edge
  const WS = 0.075, XG = XS - WS / 2;                     // spine width when open, gutter x (book space)
  const HOPEN = 0.030, ARCH = 0.006, A0 = 55 * Math.PI / 180, GY = CT + ARCH + 0.002;
  const PD2 = PD / 2, BD2 = 0.215;
  const UB1 = 0.4568421052631579, US1 = 0.543859649122807;
  // profile of the open stacks as authored in the GLB (used only to read each vertex's layer)
  const profOld = x => { const t = Math.min(1, Math.abs(x) / PW2); return CT + 0.006 + (HS - 0.006) * Math.sin(Math.min(1, t / 0.35) * Math.PI / 2) - 0.003 * t ** 3; };
  const HxOld = x => profOld(x) - CT;
  const lerp = (a, b, k) => a + (b - a) * k;

  function leafClosed(e, H, l) {
    const q = 2 * Math.min(Math.max(e / H, 0), 1) - 1;
    return [XS + 0.004 - 0.012 * (1 - q * q) + l, CT + e];
  }
  function leafOpen(e, H, l) {
    const rho = 1 - e / H, rc = Math.min(Math.max(rho, 0), 1);
    const rx = XS + (XG - XS) * (1 - rc), ry = CT + (1 - rc) * Math.min(GY - CT, 0.5 * H);
    const a = A0 * (1 - rho), d = Math.max(0, CT + e - ry), droop = 0.003 * (l / LP) ** 3;
    if (a < 1e-4 || d < 1e-7) return [rx + l, ry + d - droop];
    const R = d / (1 - Math.cos(a)), arc = R * a;
    if (l <= arc) { const g = a - l / R; return [rx + R * Math.sin(a) - R * Math.sin(g), ry - R * Math.cos(a) + R * Math.cos(g) - droop]; }
    return [rx + R * Math.sin(a) + (l - arc), ry + d - droop];
  }
  function leafR(e, H, l, w) {
    if (w >= 1) return leafOpen(e, H, l);
    const c = leafClosed(e, H, l); if (w <= 0) return c;
    const o = leafOpen(e, H, l); return [lerp(c[0], o[0], w), lerp(c[1], o[1], w)];
  }
  function leafL(e, H, l) { const o = leafOpen(e, H, l); return coverXf([2 * XG - o[0], o[1]]); }
  // pages on the left lie on the front board's inner face, so they ride along with the board until it has landed
  function coverXf(q) {
    if (S.th >= Math.PI - 1e-6) return q;
    const p1 = pivotAt(S.th), p0 = pivotAt(Math.PI), a = S.th - Math.PI, c = Math.cos(a), s = Math.sin(a);
    const dx = q[0] - p0.x, dy = q[1] - p0.y;
    return [p1.x + c * dx - s * dy, p1.y + s * dx + c * dy];
  }

  /* ---------- pose state ---------- */
  const S = { th: 0, w: 0, Hr: HB, Hl: 0, gx: 0 };
  const root = new THREE.Group(); root.name = 'RecipeBook';
  const book = new THREE.Group(); root.add(book);
  const frontPivot = new THREE.Group(); frontPivot.name = 'Book_FrontCover_Hinge'; book.add(frontPivot);
  const PIV = new THREE.Vector2(XS - WS / 2, YT / 2), PF0 = new THREE.Vector2(XS, CT + HB);
  const pivotAt = th => PF0.clone().sub(PIV).rotateAround(new THREE.Vector2(), th).add(PIV);

  let stackR = [], stackL = [], pageMeshes = [], spineMat;
  function prepStack(node, side) {
    node.traverse(m => { if (!m.isMesh) return;
      m.geometry = m.geometry.clone(); const p = m.geometry.attributes.position, n = p.count;
      const L = new Float32Array(n), f = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = p.getX(i), y = p.getY(i); L[i] = Math.abs(x) / PW2 * LP; f[i] = (y - CT) / HxOld(x); }
      m.userData.L = L; m.userData.f = f; m.userData.side = side; m.frustumCulled = false; });
  }
  function deformStack(node, H, w) {
    node.traverse(m => { if (!m.isMesh || !m.userData.f) return;
      const p = m.geometry.attributes.position, f = m.userData.f, L = m.userData.L, side = m.userData.side;
      for (let i = 0; i < p.count; i++) {
        const q = side > 0 ? leafR(f[i] * H, H, L[i], w) : leafL(f[i] * H, H, L[i]);
        p.setX(i, q[0]); p.setY(i, q[1]);
      }
      p.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); m.geometry.boundingBox = null; });
  }

  /* ---------- flexible spine ---------- */
  const NA = 48;
  const spineGeo = { outer: new THREE.BufferGeometry(), inner: new THREE.BufferGeometry(), cap: new THREE.BufferGeometry() };
  const SZ = BD2 - 0.002;
  (function initSpine() {
    for (const k of ['outer', 'inner']) {
      const g = spineGeo[k]; g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NA * 2 * 3), 3));
      const uv = new Float32Array(NA * 4), idx = [];
      for (let i = 0; i < NA; i++) { const u = k === 'outer' ? UB1 + (US1 - UB1) * i / (NA - 1) : 0.40 + 0.03 * i / (NA - 1); uv.set([u, 1, u, 0], i * 4); }
      for (let i = 0; i < NA - 1; i++) { const a = i * 2; k === 'outer' ? idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    }
    const g = spineGeo.cap; g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NA * 4 * 3), 3));
    const uv = new Float32Array(NA * 8), idx = [];
    for (let i = 0; i < NA; i++) { const u = UB1 + (US1 - UB1) * i / (NA - 1); uv.set([u, 0.995, u, 0.99, u, 0.005, u, 0.01], i * 8); }
    for (let i = 0; i < NA - 1; i++) { const a = i * 4, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  })();
  const spineMeshes = [];
  function poseSpine() {
    const th = S.th, w = S.w, pf = pivotAt(th);
    const dF = [Math.cos(th), Math.sin(th)], k = lerp(0.03, WS / 3, w), a = ARCH / 0.75 * w;
    const B0 = [XS, 0], B3 = [pf.x - CT * Math.sin(th), pf.y + CT * Math.cos(th)];
    const B1 = [XS - k, a], B2 = [B3[0] - k * dF[0], B3[1] - k * dF[1] + a];
    const O = [], I = [];
    for (let i = 0; i < NA; i++) {
      const s = i / (NA - 1), m = 1 - s;
      const x = m * m * m * B0[0] + 3 * m * m * s * B1[0] + 3 * m * s * s * B2[0] + s * s * s * B3[0];
      const y = m * m * m * B0[1] + 3 * m * m * s * B1[1] + 3 * m * s * s * B2[1] + s * s * s * B3[1];
      let dx = 3 * m * m * (B1[0] - B0[0]) + 6 * m * s * (B2[0] - B1[0]) + 3 * s * s * (B3[0] - B2[0]);
      let dy = 3 * m * m * (B1[1] - B0[1]) + 6 * m * s * (B2[1] - B1[1]) + 3 * s * s * (B3[1] - B2[1]);
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      O.push([x, y]); I.push([x + dy * CT * 0.9, y - dx * CT * 0.9]);
    }
    const po = spineGeo.outer.attributes.position, pi = spineGeo.inner.attributes.position, pc = spineGeo.cap.attributes.position;
    for (let i = 0; i < NA; i++) {
      po.setXYZ(i * 2, O[i][0], O[i][1], -SZ); po.setXYZ(i * 2 + 1, O[i][0], O[i][1], SZ);
      pi.setXYZ(i * 2, I[i][0], I[i][1], -SZ); pi.setXYZ(i * 2 + 1, I[i][0], I[i][1], SZ);
      pc.setXYZ(i * 4, O[i][0], O[i][1], -SZ); pc.setXYZ(i * 4 + 1, I[i][0], I[i][1], -SZ);
      pc.setXYZ(i * 4 + 2, O[i][0], O[i][1], SZ); pc.setXYZ(i * 4 + 3, I[i][0], I[i][1], SZ);
    }
    for (const g of Object.values(spineGeo)) { g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); }
  }

  /* ---------- riffle sheets ---------- */
  const SHEETS = 9, SEG = 24, SW = 0.278, SD = 0.402;
  // aged paper texture (dark, worn edge goes into the binding)
  function dataTex(uri, flipY) { const img = new Image(); const t = new THREE.Texture(img); img.onload = () => { t.needsUpdate = true; }; img.src = uri;
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = flipY; t.anisotropy = 8; return t; }
  const sheetTex = dataTex(A.paperSheet, true), spreadTex = dataTex(A.paperSpread, false);
  const paperLook = (map, extra) => new THREE.MeshStandardMaterial(Object.assign({ map, color: 0x7a7a7a, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.62, roughness: 0.95, metalness: 0, toneMapped: false }, extra));
  const paperMat = paperLook(sheetTex, { side: THREE.DoubleSide, alphaTest: 0.5 });
  const sheets = [];
  for (let i = 0; i < SHEETS; i++) {
    const geo = new THREE.PlaneGeometry(SW, SD, SEG, 1); geo.rotateX(-Math.PI / 2); geo.translate(SW / 2, 0, 0);
    { const uv = geo.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, 1 - uv.getX(j)); }   // dark edge at the hinge (gutter), on both faces
    const m = new THREE.Mesh(geo, paperMat.clone()); m.material.emissiveIntensity += (Math.random() - .5) * 0.06; m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: sheetTex, alphaTest: 0.5 });
    m.castShadow = true; m.visible = false; m.frustumCulled = false; m.userData.base = geo.attributes.position.array.slice(); book.add(m); sheets.push(m);
  }
  // a sheet hinged at the gutter: lies on the right stack's top leaf (e=0) and lands on the left stack (e=1)
  function poseSheet(m, e, Hr, Hl, w, idx = 0, dyR = 0, dyL = 0) {
    const pf0 = pivotAt(S.th), cth = Math.cos(S.th), sth = Math.sin(S.th);
    const gap = (0.004 + 0.0035 * idx) * Math.min(1, (1 - Math.min(1, S.th / Math.PI)) * 5);   // fan spacing under the cover, closes as it lands
    const pos = m.geometry.attributes.position, b = m.userData.base, gx = XG, gy = CT + Math.min(GY - CT, 0.5 * Math.min(Hr, Math.max(Hl, 0.004))) + 0.0004;
    const curl = Math.sin(Math.PI * e);
    for (let k = 0; k < pos.count; k++) {
      const l = Math.max(1e-4, b[k * 3]) / SW * LP, z = b[k * 3 + 2];
      const pR = leafR(Hr + 0.0008 + dyR, Hr, l, w), pL = leafL(Hl + 0.0008 + dyL, Math.max(Hl, 0.001), l);
      const phR = Math.atan2(pR[1] - gy, pR[0] - gx); let phL = Math.atan2(pL[1] - gy, pL[0] - gx); if (phL < 0) phL += 2 * Math.PI;   // always swing over the top
      const rhR = Math.hypot(pR[0] - gx, pR[1] - gy), rhL = Math.hypot(pL[0] - gx, pL[1] - gy);
      let ph = phR + (phL - phR) * e - curl * (l / LP) ** 2; const rh = rhR + (rhL - rhR) * e;
      // the sheet may never swing ahead of the cover: cap its angle at the cover's inner face (same distance from the gutter)
      { const ox = pf0.x - gx, oy = pf0.y - gy, b = ox * cth + oy * sth, c = ox * ox + oy * oy - rh * rh, D = b * b - c;
        if (D >= 0) { const sQ = -b + Math.sqrt(D); let cap = Math.atan2(oy + sQ * sth, ox + sQ * cth); if (cap < -0.5) cap += 2 * Math.PI;
          cap -= gap / Math.max(rh, 0.02); if (ph > cap) ph = Math.max(phR, cap); } }
      pos.setXYZ(k, gx + rh * Math.cos(ph), gy + rh * Math.sin(ph), z);
    }
    // never poke through the front board: keep every vertex just under the board's inner face
    const pf = pivotAt(S.th), c = Math.cos(S.th), sn = Math.sin(S.th);
    for (let k = 0; k < pos.count; k++) {
      const dx = pos.getX(k) - pf.x, dy = pos.getY(k) - pf.y;
      const lx = c * dx + sn * dy, ly = -sn * dx + c * dy;          // board-local (inner face at ly = 0, board along +lx)
      if (lx > -0.02 && ly > -0.0015) { const ny = -0.0015; pos.setXY(k, pf.x + c * lx - sn * ny, pf.y + sn * lx + c * ny); }
    }
    pos.needsUpdate = true; m.geometry.computeVertexNormals();
  }

  function applyPose() {
    book.position.x = S.gx;
    const pf = pivotAt(S.th); frontPivot.position.set(pf.x, pf.y, 0); frontPivot.rotation.z = S.th;
    poseSpine();
    stackR.forEach(n => deformStack(n, S.Hr, S.w));
    const showL = S.Hl > 1e-4; stackL.forEach(n => { n.visible = showL; if (showL) deformStack(n, S.Hl, 1); });
  }


  /* =====================================================================
     Emotion page -> pick an emotion -> red-pencil underline + check -> pages riffle to the recipe.
     Picking works on the page's UV (texture pixel), so a VR fingertip ray/poke can reuse pick(u, v) later.
     ===================================================================== */
  const PGW = 2240, PGH = 1600;
  const EMOTIONS = [
    { name: 'Excitement & Joy', recipe: 'santa', label: '매지컬 산타', box: [75, 530, 1005, 800], off: [0, 0] },
    { name: 'Refreshment & Vitality', recipe: 'tree', label: '크리스마스 트리', box: [95, 880, 1000, 1135], off: [0, 350] },
    { name: 'Warmth & Support', recipe: 'ginger', label: '진저브레드 스파클', box: [90, 1195, 1005, 1450], off: [0, 665] },
    { name: 'Coziness & Relaxation', recipe: 'snowman', label: '스노우맨 드리밍', box: [1215, 535, 2140, 800], off: [1140, 0] },
    { name: 'Serenity & Comfort', recipe: 'silent', label: '사일런트 나이트', box: [1225, 880, 2145, 1130], off: [1140, 345] },
    { name: 'Freshness & Renewal', recipe: 'drift', label: '스노우드리프트', box: [1215, 1195, 2145, 1450], off: [1140, 665] },
  ];
  const MARK_X = 300, MARK_Y = 455;
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const loadImg = uri => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = uri; });
  const pageCanvas = mkCanvas(PGW, PGH), pageCtx = pageCanvas.getContext('2d');
  const emoCanvas = mkCanvas(PGW, PGH), emoCtx = emoCanvas.getContext('2d');
  const snapCanvas = mkCanvas(PGW, PGH), targetCanvas = mkCanvas(PGW, PGH);
  const canvasTex = c => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const pageTex = canvasTex(pageCanvas), snapTex = canvasTex(snapCanvas), targetTex = canvasTex(targetCanvas);
  const IMG = {}; let marksPix = null, marksParam = null, revealCanvas = null, revealCtx = null, revealData = null;
  let page = 'emotion', pageAnim = null, pickedIdx = -1;

  async function loadPageAssets() {
    [IMG.emotion, IMG.marks, IMG.param, IMG.paper, IMG.arrow, IMG.strike] = await Promise.all([loadImg(A.pageEmotion), loadImg(A.marks), loadImg(A.marksParam), loadImg(A.paperSpread), loadImg(A.arrow), loadImg(A.strike)]);
    IMG.recipes = {}; await Promise.all(Object.keys(RECIPES).map(async k => { IMG.recipes[k] = await loadImg(A.page(k)); }));
    drawSantaStatic();
    const w = IMG.marks.width, h = IMG.marks.height;
    revealCanvas = mkCanvas(w, h); revealCtx = revealCanvas.getContext('2d');
    const t = mkCanvas(w, h).getContext('2d');
    t.drawImage(IMG.marks, 0, 0); marksPix = t.getImageData(0, 0, w, h).data.slice();
    t.clearRect(0, 0, w, h); t.drawImage(IMG.param, 0, 0); const pd = t.getImageData(0, 0, w, h).data;
    marksParam = new Float32Array(w * h); for (let i = 0; i < w * h; i++) marksParam[i] = pd[i * 4] / 255;
    revealData = revealCtx.createImageData(w, h);
  }
  // emotion page with the pencil marks of emotion idx revealed up to progress p (0..1), faded by alpha
  function drawEmotion(idx, p, alpha = 1) {
    emoCtx.drawImage(IMG.emotion, 0, 0, PGW, PGH);
    if (idx < 0 || p <= 0) return;
    const d = revealData.data, n = marksParam.length;
    for (let i = 0; i < n; i++) {
      const k = Math.min(1, Math.max(0, (p - marksParam[i]) / 0.04));
      d[i * 4] = marksPix[i * 4]; d[i * 4 + 1] = marksPix[i * 4 + 1]; d[i * 4 + 2] = marksPix[i * 4 + 2]; d[i * 4 + 3] = marksPix[i * 4 + 3] * k * alpha;
    }
    revealCtx.putImageData(revealData, 0, 0);
    const o = EMOTIONS[idx].off; emoCtx.drawImage(revealCanvas, MARK_X + o[0], MARK_Y + o[1]);
  }
  function spreadOf(name) { return name === 'emotion' ? emoCanvas : name === 'recipe' ? santaCanvas : IMG[name]; }
  function drawPage(left, right) {           // left / right: canvas or image sources for each half
    pageCtx.drawImage(left, 0, 0, PGW / 2, PGH, 0, 0, PGW / 2, PGH);
    pageCtx.drawImage(right, PGW / 2, 0, PGW / 2, PGH, PGW / 2, 0, PGW / 2, PGH);
    pageTex.needsUpdate = true;
  }
  function showSpread(name) { page = name; if (name === 'emotion') drawEmotion(-1, 0); const src = name === 'recipe' ? santaBase : spreadOf(name); drawPage(src, src); ui(); }


  /* =====================================================================
     Ingredient quests on the recipe page: when an ingredient's quest is done, a red pencil strikes it out
     and the hand-drawn arrow glides on to the next ingredient (and keeps nudging it).
     Game hook: completeIngredient() / resetQuests().
     ===================================================================== */
  const RECIPES = {
    santa: { label: '매지컬 산타', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Turmeric', y0: 974, x1: 1936 }, { name: 'Rose wood', y0: 1168, x1: 1999 }, { name: 'Lemon', y0: 1368, x1: 1825 }] },
    tree: { label: '크리스마스 트리', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Bergamot', y0: 974, x1: 1962 }, { name: 'Fir Needles', y0: 1168, x1: 2027 }, { name: 'Mint', y0: 1368, x1: 1777 }] },
    ginger: { label: '진저브레드 스파클', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Ginger', y0: 974, x1: 1838 }, { name: 'Cinnamon', y0: 1168, x1: 1950 }, { name: 'Benzoin', y0: 1368, x1: 1883 }] },
    snowman: { label: '스노우맨 드리밍', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Lavender', y0: 974, x1: 1935 }, { name: 'Cedarwood', y0: 1168, x1: 2001 }, { name: 'Coconut Oil', y0: 1368, x1: 2051 }] },
    silent: { label: '사일런트 나이트', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Rose', y0: 974, x1: 1758 }, { name: 'Vanilla', y0: 1168, x1: 1880 }, { name: 'Benzoin', y0: 1368, x1: 1883 }] },
    drift: { label: '스노우드리프트', rows: [{ name: 'Fairy Sugar', y0: 345, x1: 2027 }, { name: 'Star Powder', y0: 476, x1: 2070 }, { name: 'Eucalyptus', y0: 974, x1: 2005 }, { name: 'Lemongrass', y0: 1168, x1: 2042 }, { name: 'Mint', y0: 1368, x1: 1777 }] },
  };
  let curRecipe = 'santa', ING = RECIPES.santa.rows;
  const questDoneOf = {};
  function useRecipe(k) { questDoneOf[curRecipe] = questDone; curRecipe = k; ING = RECIPES[k].rows; questDone = questDoneOf[k] || 0; questAnim = null; questAcc = 1; drawSantaStatic(); }
  const RG_X = 1560, RG_Y = 160, RG_W = 680, RG_H = 1290;            // page region the quest marks live in
  const santaCanvas = mkCanvas(PGW, PGH), santaCtx = santaCanvas.getContext('2d');      // with the arrow (used for page turns)
  const santaBase = mkCanvas(PGW, PGH), santaBaseCtx = santaBase.getContext('2d');      // clean page + finished strikes
  const ovCanvas = mkCanvas(RG_W, RG_H), ovCtx = ovCanvas.getContext('2d');             // live marks drawn over the page in the shader
  const ovTex = new THREE.CanvasTexture(ovCanvas); ovTex.flipY = false; ovTex.colorSpace = THREE.SRGBColorSpace;
  const ovUniforms = { uOv: { value: ovTex }, uOvRect: { value: new THREE.Vector4(RG_X / PGW, RG_Y / PGH, RG_W / PGW, RG_H / PGH) }, uOvOn: { value: 0 } };
  function addOverlay(mat) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, ovUniforms);
      sh.fragmentShader = 'uniform sampler2D uOv; uniform vec4 uOvRect; uniform float uOvOn;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 ovC = vec4(0.0); vec2 ovUv = (vMapUv - uOvRect.xy) / uOvRect.zw;
          if (uOvOn > 0.5 && ovUv.x >= 0.0 && ovUv.x <= 1.0 && ovUv.y >= 0.0 && ovUv.y <= 1.0) ovC = texture2D(uOv, ovUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * ovC.rgb, ovC.a);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance = mix(totalEmissiveRadiance, emissive * ovC.rgb, ovC.a);`);
    };
    mat.customProgramCacheKey = () => 'quest-overlay';
  }
  let questDone = 0, questAnim = null, questClock = 0, questAcc = 0, questWasLive = false;
  const ARROW_DIR = (() => { const x = -125, y = 107, l = Math.hypot(x, y); return [x / l, y / l]; })();   // tail -> tip (down-left)
  const ARROW_SC = 1.15, ARROW_TIP = [0, 117];                         // tip of the arrow image (px, image space)
  const arrowPos = i => [ING[i].x1 - 46, ING[i].y0 - 18];                // where the tip points: just above the end of the word
  function drawStrike(ctx, i, p, ox = 0, oy = 0) {
    if (p <= 0) return;
    const it = ING[i], w = IMG.strike.width * (it.x1 - 1615) / (2027 - 1615), h = IMG.strike.height, x = 1615 - ox, y = it.y0 - 3 - oy;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y - 4, w * p, h + 8); ctx.clip();
    ctx.drawImage(IMG.strike, x, y, w, h); ctx.restore();
  }
  function drawArrow(ctx, pos, bob, ox = 0, oy = 0) {   // bob > 0 pulls the arrow back along its direction
    const w = IMG.arrow.width * ARROW_SC, h = IMG.arrow.height * ARROW_SC;
    const x = pos[0] - ARROW_DIR[0] * bob - ARROW_TIP[0] * ARROW_SC, y = pos[1] - ARROW_DIR[1] * bob - ARROW_TIP[1] * ARROW_SC;
    ctx.drawImage(IMG.arrow, x - ox, y - oy, w, h);
  }
  // ingredient text recoloured for the blink: dark text pixels of the page become a bright highlight colour
  const fxCache = {};
  function rowFx(i) {
    const key = curRecipe + ':' + i; if (fxCache[key]) return fxCache[key];
    const it = ING[i], x0 = 1590, y0 = it.y0 - 8, w = it.x1 + 14 - x0, h = 70;
    const c = mkCanvas(w, h), g = c.getContext('2d'); g.drawImage(IMG.recipes[curRecipe], x0, y0, w, h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), p = d.data;
    for (let k = 0; k < p.length; k += 4) { const L = (p[k] + p[k + 1] + p[k + 2]) / 3, a = Math.min(1, Math.max(0, (150 - L) / 60));
      p[k] = 214; p[k + 1] = 52; p[k + 2] = 38; p[k + 3] = 255 * a; }
    g.putImageData(d, 0, 0);
    return (fxCache[key] = { c, x: x0, y: y0, w, h });
  }
  let questFx = null; const FX_DUR = 1.6;
  const BEAT = 1.25;                                                    // one slow "tap" of the arrow = one blink
  const beat = t => Math.abs(Math.sin(Math.PI * t / BEAT));               // 0 when the arrow touches the word, 1 when pulled back
  function drawEmphasis(ctx, i, glow) {        // glow 0..1: marker light + red text, in step with the arrow
    if (glow <= 0.01) return;
    const f = rowFx(i);
    ctx.save(); ctx.globalAlpha = 0.45 * glow; ctx.fillStyle = '#ffd34d';
    const r = 18, x = f.x - 10 - RG_X, y = f.y + 4 - RG_Y, w = f.w + 20, h = f.h - 8;
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.fill();
    ctx.globalAlpha = glow; ctx.drawImage(f.c, f.x - RG_X, f.y - RG_Y); ctx.restore();
  }
  function drawSantaStatic() {
    santaBaseCtx.drawImage(IMG.recipes[curRecipe], 0, 0, PGW, PGH);
    for (let i = 0; i < questDone; i++) drawStrike(santaBaseCtx, i, 1);
    santaCtx.drawImage(santaBase, 0, 0);
    if (questDone < ING.length) drawArrow(santaCtx, arrowPos(questDone), 0);
  }
  function completeIngredient() {
    if (questAnim || questDone >= ING.length) return false;
    questAnim = { t: 0, idx: questDone }; ui(); return true;
  }
  function resetQuests() { questAnim = null; questDone = 0; drawSantaStatic(); if (page === 'recipe') drawPage(santaBase, santaBase); ui(); }
  const Q_STRIKE = 0.75, Q_PAUSE = 0.2, Q_MOVE = 0.7;
  function updateQuests(dt) {
    const live = state === 'open' && page === 'recipe' && !pageAnim;
    ovUniforms.uOvOn.value = live ? 1 : 0;
    if (!live) { questWasLive = false; return; }
    if (!questWasLive) { questWasLive = true; questAcc = 1; if (questDone < ING.length) { questFx = { t: 0, idx: questDone }; questClock = 0; } }      // redraw right away + point out the current ingredient
    questClock += dt; questAcc += dt;
    if (questAnim) {
      questAnim.t += dt;
      if (questAnim.t >= Q_STRIKE + Q_PAUSE + Q_MOVE) { questDone = questAnim.idx + 1; questAnim = null; drawSantaStatic(); drawPage(santaBase, santaBase); ui();
        if (questDone < ING.length) { questFx = { t: 0, idx: questDone }; questClock = 0; } }
    }
    if (questFx) { questFx.t += dt; if (questFx.t > FX_DUR) questFx = null;
    }
    if (questAcc < 1 / 30) return; questAcc = 0;
    const c = ovCtx; c.clearRect(0, 0, RG_W, RG_H);
    let pos = null, bobAmp = 1;
    if (questAnim) {
      const i = questAnim.idx, t = questAnim.t;
      drawStrike(c, i, ease(clamp01(t / Q_STRIKE)), RG_X, RG_Y);
      const m = ease(clamp01((t - Q_STRIKE - Q_PAUSE) / Q_MOVE));
      if (i + 1 < ING.length) { const a = arrowPos(i), b = arrowPos(i + 1); pos = [lerp(a[0], b[0], m), lerp(a[1], b[1], m)]; bobAmp = 1 - Math.sin(Math.PI * m); }
      else if (m < 1) { pos = arrowPos(i); c.globalAlpha = 1 - m; }
    } else if (questDone < ING.length) pos = arrowPos(questDone);
    if (pos) {
      // one shared beat: the arrow taps toward the word and the word lights up on every tap, slowly and continuously.
      // Right after the arrow arrives the taps are bigger (settling into the idle rhythm).
      const b = beat(questClock), boost = questFx && !questAnim ? 1 - questFx.t / FX_DUR : 0;
      const bob = b * (12 + 26 * boost) * bobAmp;
      if (!questAnim && questDone < ING.length) drawEmphasis(c, questDone, Math.pow(1 - b, 1.6));
      drawArrow(c, pos, bob, RG_X, RG_Y);
    }
    c.globalAlpha = 1; ovTex.needsUpdate = true;
  }
  /* ---------- page-turn sheets (riffle between spreads) ---------- */
  const FLIPN = 5, flipSheets = [];
  const pageFaceMat = (side) => new THREE.MeshStandardMaterial({ map: snapTex, emissiveMap: snapTex, color: 0x3a3a3a, emissive: 0xffffff, emissiveIntensity: 0.84, roughness: 0.95, metalness: 0, toneMapped: false, side });
  function makeFlipMesh(side) {
    const geo = new THREE.PlaneGeometry(SW, SD, SEG, 1); geo.rotateX(-Math.PI / 2); geo.translate(SW / 2, 0, 0);
    const m = new THREE.Mesh(geo, paperMat); m.userData.base = geo.attributes.position.array.slice(); m.userData.uv0 = geo.attributes.uv.array.slice();
    m.userData.paper = paperLook(sheetTex, { side, alphaTest: 0.5 }); m.userData.page = pageFaceMat(side); m.userData.side = side;
    m.visible = false; m.frustumCulled = false; m.castShadow = true; book.add(m); return m;
  }
  for (let i = 0; i < FLIPN; i++) flipSheets.push({ f: makeFlipMesh(THREE.FrontSide), b: makeFlipMesh(THREE.BackSide) });
  // face = 'paper' or a texture showing a spread half (front face = right half, back face = left half)
  function setFace(m, tex) {
    const uv = m.geometry.attributes.uv, b = m.userData.base, u0 = m.userData.uv0;
    if (!tex) { for (let k = 0; k < uv.count; k++) uv.setXY(k, 1 - u0[k * 2], u0[k * 2 + 1]); m.material = m.userData.paper; }
    else {
      const front = m.userData.side === THREE.FrontSide;
      for (let k = 0; k < uv.count; k++) { const x = b[k * 3], z = b[k * 3 + 2]; uv.setXY(k, front ? 0.5 + 0.5 * x / SW : 0.5 - 0.5 * x / SW, (z + SD / 2) / SD); }
      m.material = m.userData.page; m.material.map = tex; m.material.emissiveMap = tex;
    }
    uv.needsUpdate = true;
  }
  function startFlip(target, dir) {           // dir +1: right -> left (forward), -1: left -> right (back)
    if (page === 'recipe') { drawSantaStatic(); drawPage(santaCanvas, santaCanvas); ovUniforms.uOvOn.value = 0; }
    snapCanvas.getContext('2d').drawImage(pageCanvas, 0, 0); snapTex.needsUpdate = true;
    const tsrc = spreadOf(target); targetCanvas.getContext('2d').drawImage(tsrc, 0, 0, PGW, PGH); targetTex.needsUpdate = true;
    if (dir > 0) drawPage(snapCanvas, targetCanvas); else drawPage(targetCanvas, snapCanvas);
    flipSheets.forEach((s, i) => {
      const first = i === 0, last = i === FLIPN - 1;
      if (dir > 0) { setFace(s.f, first ? snapTex : null); setFace(s.b, last ? targetTex : null); }
      else { setFace(s.b, first ? snapTex : null); setFace(s.f, last ? targetTex : null); }
    });
    pageAnim = { type: 'flip', t: 0, target, dir }; page = 'flipping'; ui();
    poseFlip(0, dir);
  }
  const FLIP_STEP = 0.09, FLIP_DUR = 0.8;
  function poseFlip(t, dir) {
    let done = true;
    flipSheets.forEach((s, i) => {
      const k = clamp01((t - i * FLIP_STEP) / FLIP_DUR); if (k < 1) done = false;
      const e0 = ease(k), e = dir > 0 ? e0 : 1 - e0;
      // every sheet is shown for the whole riffle, stacked in order, so the new spread is only uncovered sheet by sheet
      const top = (FLIPN - i) * 0.0004, under = (i + 1) * 0.0004;
      const dyR = dir > 0 ? top : under, dyL = dir > 0 ? under : top;
      for (const m of [s.f, s.b]) { m.visible = true; poseSheet(m, e, HOPEN, HOPEN, 1, 0, dyR, dyL); }
    });
    return done;
  }
  function hideFlips() { flipSheets.forEach(s => { s.f.visible = s.b.visible = false; }); if (typeof lastBack !== 'undefined') lastBack.visible = false; }


  // back face of the last opening sheet = left half of the emotion page (lands as the left page)
  const emoSheetTex = canvasTex(emoCanvas);
  const lastBack = makeFlipMesh(THREE.BackSide);
  sheets[SHEETS - 1].material = sheets[SHEETS - 1].material.clone(); sheets[SHEETS - 1].material.side = THREE.FrontSide;

  /* ---------- picking ---------- */
  function pick(u, v) {                        // u, v: page texture coordinates (0..1)
    if (state !== 'open' || page !== 'emotion' || pageAnim) return false;
    const x = u * PGW, y = v * PGH;
    const idx = EMOTIONS.findIndex(e => x >= e.box[0] && x <= e.box[2] && y >= e.box[1] && y <= e.box[3]);
    if (idx < 0) return false;
    pickedIdx = idx; pageAnim = { type: 'mark', t: 0, idx }; page = 'marking'; ui(); return true;
  }
  // page UV under a ray (mouse, VR controller or fingertip ray). Returns [u, v] or null.
  function pageUVFromRay(raycaster) {
    const hit = raycaster.intersectObjects(pageMeshes.filter(m => m.visible), false)[0];
    return hit && hit.uv ? [hit.uv.x, hit.uv.y] : null;
  }
  function emotionAt(u, v) { const x = u * PGW, y = v * PGH; return EMOTIONS.findIndex(e => x >= e.box[0] && x <= e.box[2] && y >= e.box[1] && y <= e.box[3]); }

  const MARK_DUR = 1.1;
  let toast = null;
  function updatePage(dt) {
    updateQuests(dt);
    if (!pageAnim) return;
    const a = pageAnim; a.t += dt;
    if (a.type === 'mark') {
      const p = clamp01(a.t / MARK_DUR); drawEmotion(a.idx, p); drawPage(emoCanvas, emoCanvas);
      if (a.t >= MARK_DUR + 0.45) {
        const r = EMOTIONS[a.idx].recipe;
        if (r) { useRecipe(r); startFlip('recipe', 1); }
        else { pageAnim = { type: 'notready', t: 0, idx: a.idx }; toast = `‘${EMOTIONS[a.idx].label}’ 레시피는 아직 준비 중이에요`; ui(); }
      }
    } else if (a.type === 'notready') {
      if (a.t > 1.6) { const f = clamp01((a.t - 1.6) / 0.5); drawEmotion(a.idx, 1, 1 - f); drawPage(emoCanvas, emoCanvas); }
      if (a.t > 2.1) { pageAnim = null; toast = null; showSpread('emotion'); }
    } else if (a.type === 'flip') {
      if (poseFlip(a.t, a.dir)) { hideFlips(); pageAnim = null; showSpread(a.target); }
    }
  }
  function backToEmotions() { if (state !== 'open' || page !== 'recipe' || pageAnim) return; drawEmotion(-1, 0); startFlip('emotion', -1); }

  /* ---------- states ---------- */
  // suggested camera placements (book space, metres) for each moment; the host decides whether to use them
  const VIEWS = { closed: 'closed', opening: 'opening', reading: 'reading' };
  let viewHint = 'closed';
  function flyTo(v) { viewHint = v; emit('view', v); }
  let state = 'closed', anim = null;
  const ease = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const blankPaper = paperLook(spreadTex, {});
  function blankPages(on) { pageMeshes.forEach(m => { m.material = m.userData.viewMat; }); if (on && IMG.paper) drawPage(IMG.paper, IMG.paper); }

  function setClosed() {
    anim = null; state = 'closed';
    Object.assign(S, { th: 0, w: 0, Hr: HB, Hl: 0, gx: 0 }); applyPose();
    sheets.forEach(s => s.visible = false); blankPages(true);
    pageAnim = null; toast = null; hideFlips(); page = 'emotion';
    flyTo(VIEWS.closed); ui();
  }
  function setOpen(view = VIEWS.opening, fromAnim = false) {
    anim = null; state = 'open';
    Object.assign(S, { th: Math.PI, w: 1, Hr: HOPEN, Hl: HOPEN, gx: -XG }); applyPose();
    sheets.forEach(s => s.visible = false); blankPages(false);
    pageAnim = null; toast = null; hideFlips(); showSpread('emotion');
    flyTo(view); ui();
  }
  function playOpen(then) {
    if (state === 'opening') return;
    setClosed(); state = 'opening'; ui();
    drawEmotion(-1, 0); emoSheetTex.needsUpdate = true; drawPage(IMG.paper, IMG.paper);
    flyTo(VIEWS.opening);
    anim = { t: 0, then }; updateAnim(0);
  }
  const T_SHIFT = [0, 0.9], T_COVER = [0.15, 1.75], T_RIF0 = 0.3, RIF_STEP = 0.045, RIF_DUR = 1.05;   // pages riffle right behind the cover
  const RIF_LAG = 0.05;   // each sheet runs the same swing as the cover, a hair behind the previous one
  const T_END = T_COVER[0] + RIF_LAG * SHEETS + (T_COVER[1] - T_COVER[0] + 0.15) + 0.02;
  function updateAnim(dt) {
    if (!anim) return;
    anim.t += dt; const t = anim.t;
    const sh = ease(clamp01((t - T_SHIFT[0]) / (T_SHIFT[1] - T_SHIFT[0])));
    const cv = ease(clamp01((t - T_COVER[0]) / (T_COVER[1] - T_COVER[0])));
    // stack heights change continuously (a sheet leaves the right stack as it lifts and joins the left as it lands)
    let lifted = 0, landedF = 0;
    const kk = sheets.map((m, i) => i === SHEETS - 1 ? (t - 1.3) / 1.1 : (t - T_COVER[0] - RIF_LAG * (i + 1)) / (T_COVER[1] - T_COVER[0] + 0.15));
    // each sheet follows the cover but never overtakes it (stays just underneath while the cover is in the air)
    const ee = kk.map(k => ease(clamp01(k)));
    // a sheet only leaves the stack once it has really lifted off
    // pages can only pile up on the left once the cover has landed there (otherwise they would poke through it)
    const gate = 1;   // the left pile now rides on the front board, so it can grow while the board is still landing
    ee.forEach(e => { lifted += ease(clamp01((e - 0.01) / 0.08)); landedF += ease(clamp01((e - 0.85) / 0.15)) * gate; });
    Object.assign(S, { th: Math.PI * cv, w: cv, Hr: lerp(HB, HOPEN, lifted / SHEETS), Hl: HOPEN * landedF / SHEETS, gx: -XG * sh });
    applyPose();
    sheets.forEach((m, i) => {
      const k = kk[i], e = ee[i];
      const last = i === SHEETS - 1;
      if (e <= 0.01 || (e >= 0.999 && gate >= 1)) {
        m.visible = false;
        if (last) { lastBack.visible = false; if (e >= 0.999 && !anim.revealL) { anim.revealL = true; drawPage(emoCanvas, emoCanvas); } }   // the landed sheet becomes the left page in the same frame
        return;
      }
      // land exactly on the pile: the pile already grows by this sheet's share as it settles
      const dyL = (HOPEN / SHEETS) * (1 - ease(clamp01((e - 0.85) / 0.15)));
      m.visible = true; poseSheet(m, e, S.Hr, S.Hl, S.w, i, 0, dyL);
      if (last) {
        lastBack.visible = true; poseSheet(lastBack, e, S.Hr, S.Hl, S.w, i, 0, dyL);
        // the emotion page appears underneath in the very frame the last blank sheet lifts off it
        if (!anim.revealR) { anim.revealR = true; drawPage(IMG.paper, emoCanvas); }
        if (e >= 0.9 && !anim.revealL) { anim.revealL = true; drawPage(emoCanvas, emoCanvas); }   // landing: the page under it already matches
      }
    });
    if (t >= T_END) { const then = anim.then; setOpen(then === 'reading' ? VIEWS.reading : VIEWS.opening, true); }
  }


  /* ---------- load ---------- */
  const loader = new GLTFLoader();
  const [c, o] = await Promise.all([loader.loadAsync(A.closedGlb), loader.loadAsync(A.openGlb)]);
  const closedRoot = c.scene, openRoot = o.scene;
  closedRoot.updateMatrixWorld(true); openRoot.updateMatrixWorld(true);
  const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  // boards from the closed model: back board stays put, front board is re-pivoted on its hinge
  const back = closedRoot.getObjectByName('Book_BackCover'); book.attach(back);
  const fc = closedRoot.getObjectByName('Book_FrontCover');
  fc.traverse(m => { if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld); g.translate(-PF0.x, -PF0.y, 0);
    const fm = new THREE.Mesh(g, m.material); fm.name = 'Book_FrontCover'; frontPivot.add(fm); });
  closedRoot.getObjectByName('Book_Spine').traverse(m => { if (m.isMesh && !spineMat) spineMat = m.material; });
  for (const k of ['outer', 'inner', 'cap']) { const sm = new THREE.Mesh(spineGeo[k], spineMat); sm.name = 'Book_Spine_' + k; spineMeshes.push(sm); book.add(sm); }
  // page stacks from the open model, re-shaped every frame by the binding model
  openRoot.children.slice().forEach(n => {
    if (/^Book_StackR/.test(n.name)) { stackR.push(n); prepStack(n, 1); book.add(n); }
    else if (/^Book_StackL/.test(n.name)) { stackL.push(n); prepStack(n, -1); book.add(n); }
  });
  [...stackR, ...stackL].forEach(n => n.traverse(m => { if (m.isMesh && /Pages/.test(m.name)) {
    const map = m.material.map; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = aniso;
    m.userData.glbMat = m.material;
    // light only adds a little shading; the artwork itself comes through unchanged (no ACES wash-out)
    m.userData.viewMat = new THREE.MeshStandardMaterial({ map: pageTex, emissiveMap: pageTex, color: 0x3a3a3a, emissive: 0xffffff, emissiveIntensity: 0.84, roughness: 0.95, metalness: 0, toneMapped: false });
    addOverlay(m.userData.viewMat);
    pageMeshes.push(m); } }));
  book.traverse(n => { if (n.isMesh) { n.castShadow = n.receiveShadow = true; const mt = n.material; if (mt.map) mt.map.anisotropy = aniso; } });
  await loadPageAssets(); drawEmotion(-1, 0); drawPage(emoCanvas, emoCanvas);
  snapCanvas.getContext('2d').drawImage(pageCanvas, 0, 0); targetCanvas.getContext('2d').drawImage(santaCanvas, 0, 0, PGW, PGH);
  [pageTex, snapTex, targetTex, sheetTex, spreadTex].forEach(t => { t.needsUpdate = true; if (renderer) renderer.initTexture(t); });
  flipSheets.forEach((sh, i) => { setFace(sh.f, i ? null : snapTex); setFace(sh.b, i ? targetTex : null); sh.f.visible = sh.b.visible = true; });
  sheets.forEach(m => m.visible = true); pageMeshes.forEach(m => { m.material = m.userData.viewMat; });
  setFace(lastBack, emoSheetTex); emoSheetTex.needsUpdate = true; if (renderer) renderer.initTexture(emoSheetTex); lastBack.visible = true;
  warmupVisible = true;   // everything is visible until warmup() (or the first update) so shaders can be compiled up front
  setClosed();

  function snapshot() {
    const ing = ING[questDone];
    const msg = toast || (state === 'open'
      ? ({ emotion: '나누고 싶은 감정을 하나 골라보세요', recipe: RECIPES[curRecipe].label + ' — ' + (ing ? '다음 재료: ' + ing.name : '모든 재료를 모았어요!') }[page] || '')
      : ({ closed: '', opening: '' }[state] || ''));
    return { state, page, view: viewHint, recipe: page === 'recipe' ? curRecipe : null, recipeLabel: page === 'recipe' ? RECIPES[curRecipe].label : null,
      ingredient: page === 'recipe' && ing ? ing.name : null, questDone, questTotal: ING.length, message: msg };
  }
  function endWarmup() { if (!warmupVisible) return; warmupVisible = false; hideFlips(); sheets.forEach(m => m.visible = false); lastBack.visible = false; }

  return {
    /** add this to your scene */
    object: root,
    /** call every frame with seconds since last frame */
    update(dt) { endWarmup(); dt = Math.min(dt, 0.05); updateAnim(dt); updatePage(dt); },
    /** optional: compile all shaders / upload textures before the first open (avoids a hitch on first interaction) */
    warmup(scene, camera) { if (renderer) renderer.compile(scene, camera); endWarmup(); },
    /** play the opening animation (view: 'opening' | 'reading' is only a camera hint emitted at the end) */
    open(view = 'opening') { endWarmup(); playOpen(view === 'reading' ? 'reading' : 'opening'); },
    /** jump straight to the open emotion page */
    openInstant() { endWarmup(); setOpen(VIEWS.reading); },
    close() { endWarmup(); setClosed(); },
    /** pick at page texture coords (0..1, v down). Returns true if an emotion was chosen. */
    pick(u, v) { return pick(u, v); },
    /** pick with any ray (mouse, controller, fingertip). Returns true if an emotion was chosen. */
    pickFromRay(raycaster) { const uv = pageUVFromRay(raycaster); return uv ? pick(uv[0], uv[1]) : false; },
    /** is an emotion card under this ray right now? (hover / cursor feedback) */
    emotionUnderRay(raycaster) {
      if (state !== 'open' || page !== 'emotion' || pageAnim) return -1;
      const uv = pageUVFromRay(raycaster); return uv ? emotionAt(uv[0], uv[1]) : -1;
    },
    /** choose an emotion by index 0..5 (Excitement, Refreshment, Warmth, Coziness, Serenity, Freshness) */
    selectEmotion(i) { const b = EMOTIONS[i] && EMOTIONS[i].box; return b ? pick((b[0] + b[2]) / 2 / PGW, (b[1] + b[3]) / 2 / PGH) : false; },
    /** the current ingredient quest is done: strike it out and move the arrow on */
    completeIngredient() { return completeIngredient(); },
    resetQuests() { resetQuests(); },
    /** turn back to the emotion page */
    backToEmotions() { backToEmotions(); },
    /** events: 'change' (snapshot), 'view' ('closed' | 'opening' | 'reading') */
    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return () => { listeners[type] = listeners[type].filter(f => f !== fn); }; },
    get snapshot() { return snapshot(); },
    /** meshes that show the page artwork (for your own raycasts) */
    get pageMeshes() { return pageMeshes.slice(); },
    EMOTIONS: EMOTIONS.map(e => ({ name: e.name, recipe: e.recipe, label: e.label })),
    RECIPES: Object.fromEntries(Object.entries(RECIPES).map(([k, r]) => [k, { label: r.label, ingredients: r.rows.map(x => x.name) }])),
  };
}
