// flow.js — the "Dear Stranger, from Santa" experience, played inside the attic.
//
// 오프닝(니콜라스가 문을 열고 들어와 손 흔들며 인사) → 01 마음 고르기(레시피북) → 02 레시피 확인 → 03 공통 베이스 →
// 03~04 자연재료 수집·손질 → 05 빻기 → 06 틀에 붓기·누르기·열기 → 07 장식 → 08 포장 →
// 09 손편지(modules/hand-letter.js) → 마법 수반 발송 → 다른 산타의 선물 받기
//
// Every object here is a temporary placeholder made from primitives. Each one is created through
// make('<asset id>', builder) so a real model can replace it later from assets/manifest.json
// (see ASSETS.md). Input: PC mouse/keyboard, Quest hands (pinch / fist / fingertip), Quest controllers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// chalkboard UI kit (rush-xr-ui): Santa's dialogue board, the ingredient marker (ring + arrow) and the hand-motion guide
import { DialoguePanel, GuidePanel, Marker } from './rush-xr-ui.js';
// the LUSH recipe book module (modules/recipe-book, used as it came): opening animation, emotion page, recipe page + quests
import { createRecipeBook } from './recipe-book/src/RecipeBook.js';
const RB_SCALE = 0.7;
const BOOK_TILT = Math.PI / 6;      // on the desk the book leans back 30° toward the player                       // the open spread is ~0.6 m wide; 0.7 keeps it the size of the old book in front of you
const RB_RECIPE = { santa: 'magicalSanta', tree: 'christmasTree', ginger: 'gingerbread', snowman: 'snowmanDreaming', silent: 'silentNight', drift: 'snowdrift' };
import { createHandLetter } from './hand-letter.js';
// the three work tables pass in front of the player like on a conveyor belt (making -> wrapping -> basin)
import { createConveyor, LANE } from './conveyor.js';
// sounds of handling things: glass + liquid for bottles, rustling for herbs, wooden knocks / snaps for twigs, squelch for fruit
import { Foley, grabSound } from './foley.js';
const RESTART_LABEL = 'Play Again';   // the LUSH font (Parkway Lush) has Latin letters only
const END_WAIT = 3;            // seconds after the bath bomb has melted before Nicolas says goodbye and leaves

// ------------------------------------------------------------------ data (from the original game)
// opening: Santa (Nicolas, the village chief) opens the door, walks in, waves and says these lines
export const OPENING = {
  name: '니콜라스',
  // the lines exactly as the rush-xr-ui dialogue asset gives them
  lines: ['Hi, I’m Santa. This year, let’s make Christmas a little special.', 'Pick a feeling you want to send to a stranger.',
    'Grab the fairy sugar and star dust first, then gather the rest.', 'Wrap it up and drop it in the magic basin with your letter.'],
  // Nicolas's recorded voice for those lines, and where each line starts / ends in it (seconds; read from the pauses
  // in the recording). The bubble moves to the next line when the voice gets there, and closes after the last one.
  voice: 'Sound/Voice/santa_voice1.mp3',
  cues: [[0, 4.92], [5.40, 7.61], [8.05, 12.21], [12.59, 16.12]],
  hold: 1.2            // seconds the last line stays up after the voice ends
};
export const ING = {
  fairySugar: { name: '요정설탕', real: '베이킹 소다', location: 'shelf', action: 'pour', color: '#f4f1ff', base: true },
  starDust:   { name: '별가루', real: '구연산', location: 'shelf', action: 'pour', color: '#fff1a0', base: true },
  bergamot:   { name: '베르가못', location: 'basket', action: 'cutSqueeze', color: '#c9d85a' },
  lemon:      { name: '레몬', location: 'basket', action: 'cutSqueeze', color: '#f3d64a' },
  mint:       { name: '민트', location: 'pot', action: 'leaves', color: '#4f9a45' },
  lemongrass: { name: '레몬그라스', location: 'pot', action: 'leaves', color: '#8fb14a' },
  fir:        { name: '전나무 잎', location: 'pot', action: 'leaves', color: '#2f6a3c' },
  rose:       { name: '장미', location: 'pot', action: 'petals', color: '#d8475f' },
  lavender:   { name: '라벤더', location: 'pot', action: 'petals', color: '#8c74c8' },
  rosewood:   { name: '로즈우드', location: 'drawer', action: 'break', color: '#8a3f2c' },
  cedarwood:  { name: '시더우드', location: 'drawer', action: 'break', color: '#b98d5e' },
  cinnamon:   { name: '시나몬', location: 'drawer', action: 'break', color: '#7a4422' },
  vanilla:    { name: '바닐라', location: 'drawer', action: 'break', color: '#3b2516' },
  eucalyptus: { name: '유칼립투스', location: 'drawer', action: 'tear', color: '#6fa59a' },
  ginger:     { name: '진저', location: 'drawer', action: 'slice', color: '#d9b26e' },
  benzoin:    { name: '벤조인', location: 'shelf', action: 'pour', color: '#c98a3a' },
  turmeric:   { name: '강황', location: 'shelf', action: 'pour', color: '#e9a21f' },
  coconutOil: { name: '코코넛 오일', location: 'shelf', action: 'pour', color: '#f6f1e4' }
};
const LOC = { basket: '오른쪽 과일 바구니', pot: '오른쪽 화분', drawer: '왼쪽 책장 서랍', shelf: '오른쪽 병' };
const ACT = { pour: '병을 기울여 쏟기', cutSqueeze: '칼로 자르고 즙 짜기', slice: '칼로 썰어 넣기', leaves: '꺾어서 잎 떼기',
  petals: '꺾어서 꽃잎 떼기', break: '양손으로 부러뜨리기', tear: '양손으로 찢기' };
const BASE = ['fairySugar', 'starDust'];
export const EMOTIONS = [
  { id: 'fresh', label: '상쾌함 · 활력', sub: '기운 나는 하루를 선물하고 싶어요', recipe: 'christmasTree', color: '#4caf6e' },
  { id: 'excite', label: '설렘 · 즐거움', sub: '두근두근 웃음을 전하고 싶어요', recipe: 'magicalSanta', color: '#e8584f' },
  { id: 'warm', label: '따뜻함 · 응원', sub: '힘내라는 마음을 전하고 싶어요', recipe: 'gingerbread', color: '#d9893a' },
  { id: 'cool', label: '시원함 · 새로운 시작', sub: '새 출발을 응원하고 싶어요', recipe: 'snowdrift', color: '#5aa9e6' },
  { id: 'calm', label: '평온 · 위로', sub: '조용한 위로를 건네고 싶어요', recipe: 'silentNight', color: '#6b6fd1' },
  { id: 'cozy', label: '포근함 · 휴식', sub: '푹 쉬어가길 바라요', recipe: 'snowmanDreaming', color: '#c9a98c' }
];
export const RECIPES = {
  christmasTree:   { name: '크리스마스 트리', emotion: '상쾌함 · 활력', naturals: ['bergamot', 'fir', 'mint'], powder: '#5fc27a', powderDesc: '초록빛의 청량한 마법 가루', shape: 'tree', moldName: '트리 모양 틀', decor: { mode: 'place', label: '금빛 별 장식', color: '#ffd34d' } },
  magicalSanta:    { name: '매지컬 산타', emotion: '설렘 · 즐거움', naturals: ['turmeric', 'rosewood', 'lemon'], powder: '#f59aa8', powderDesc: '분홍·노란빛이 도는 마법 가루', shape: 'santa', moldName: '산타 모양 틀', decor: { mode: 'place', label: '산타의 흰 수염', color: '#ffffff' } },
  gingerbread:     { name: '진저브레드 스파클', emotion: '따뜻함 · 응원', naturals: ['ginger', 'cinnamon', 'benzoin'], powder: '#d98a3d', powderDesc: '주황·금빛 마법 가루', shape: 'gingerbread', moldName: '진저브레드 틀', decor: { mode: 'sprinkle', label: '황금빛 장식 가루', color: '#ffd34d' } },
  snowdrift:       { name: '스노우드리프트', emotion: '시원함 · 새로운 시작', naturals: ['eucalyptus', 'lemongrass', 'mint'], powder: '#e8f4ff', powderDesc: '하얀 눈가루와 파란빛 반짝임', shape: 'snowflake', moldName: '눈꽃 모양 틀', decor: { mode: 'sprinkle', label: '눈 결정 장식', color: '#bfe6ff' } },
  silentNight:     { name: '사일런트 나이트', emotion: '평온 · 위로', naturals: ['rose', 'vanilla', 'benzoin'], powder: '#6f6fd6', powderDesc: '보라·푸른빛 가루와 잔잔한 마법 연기', shape: 'round', moldName: '둥근 틀', decor: { mode: 'sprinkle', label: '장미 꽃잎 장식', color: '#f07a9a' } },
  snowmanDreaming: { name: '스노우맨 드리밍', emotion: '포근함 · 휴식', naturals: ['lavender', 'cedarwood', 'coconutOil'], powder: '#f7f1e6', powderDesc: '우윳빛 마법 가루', shape: 'snowman', moldName: '눈사람 모양 틀', decor: { mode: 'sprinkle', label: '흰색 눈송이 장식', color: '#ffffff' } }
};
const POUNDS = 5;
const LID_UP = 0.09;           // how high the mold lid hovers before the hands press it down
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28) ? a : b; };

// ------------------------------------------------------------------ layout in the attic (world metres)
// The player works standing at about (1.0, 0, 0) facing -x: the long desk is in front, the back
// shelf (bottles, basket, herb tray) on the right, the bookcase drawers on the left, the fireplace behind-right.
const DESK_Y = 0.905;          // desk top in the new space (room setup lifts the desk 0.2 m)
const L = {
  // the player stands still at STAND (index.html uses the same spot: x 1.07, z 0, facing -x) and everything is laid out within
  // arm's reach on the lifted desk (x 0.16..0.82, z -0.81..0.68, top y 0.905): left (+z) basket + fir, book, mold; centre mortar;
  // right (-z) board, knife, mug and the 2-tier bottle shelf; herb tray on the side desk to the right; drawer cabinet behind-left
  stand:   new THREE.Vector3(1.07, 0, 0),
  book:    new THREE.Vector3(0.42, DESK_Y, 0.13),
  mortar:  new THREE.Vector3(0.63, DESK_Y, 0.02),
  pestle:  new THREE.Vector3(0.72, DESK_Y + 0.012, 0.13),
  board:   new THREE.Vector3(0.55, DESK_Y, -0.20),
  knife:   new THREE.Vector3(0.40, DESK_Y + 0.006, -0.21),
  mold:    new THREE.Vector3(0.70, DESK_Y, 0.24),
  basket:  new THREE.Vector3(0.64, DESK_Y, 0.52),
  bottles: { fairySugar: [0.765, -0.62], starDust: [0.765, -0.70], benzoin: [0.765, -0.78], turmeric: [0.68, -0.66], coconutOil: [0.68, -0.75] },   // index.html puts them on the shelf
  firPot:  new THREE.Vector3(0.47, DESK_Y, 0.60),
  drawers: ['rosewood', 'cedarwood', 'cinnamon', 'vanilla', 'eucalyptus', 'ginger'],
  drawerOut: new THREE.Vector3(0.46, DESK_Y + 0.06, 0.33),    // drawer items fly over from the cabinet (back-left of the desk) and land here
  wrap:    new THREE.Vector3(0.62, DESK_Y, 0.02),
  letter:  new THREE.Vector3(0.58, DESK_Y, 0.06),
  santa:   new THREE.Vector3(-0.45, 0, -0.55),               // where Nicolas stops to greet you (across the desk, left of the door)
  santaAside: new THREE.Vector3(-0.72, 0, -1.25),            // where he stands and watches once the recipe book is open
  // CONVEYOR: the bath bomb / received gift float here while the tables change (above the passing tables, in front of the player)
  hold:    new THREE.Vector3(0.64, 1.30, 0.02),
  rolls:   new THREE.Vector3(0.30, DESK_Y, 0.02),               // the paper rolls on the wrapping table (back, middle)
  santaGive: new THREE.Vector3(1.22, 0, -1.15),               // Nicolas stands here (player's right, past the side desk) to take / give
  basin:   new THREE.Vector3(0.58, DESK_Y, -0.065),            // the basin in the middle of the basin table
  chimney: new THREE.Vector3(-0.42, 0.45, 0.50)              // index.html sets it from the fireplace logs
};

// ------------------------------------------------------------------ small helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wp = (o, off) => off ? o.localToWorld(off.clone()) : o.getWorldPosition(V());
const ease = { inOut: t => t * t * (3 - 2 * t), out: t => 1 - Math.pow(1 - t, 3), back: t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); } };
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const mesh = (geo, m, name) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; x.receiveShadow = true; if (name) x.name = name; return x; };
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ canvas panels (book pages, letters, hints, buttons)
const INK = { paper: '#fbf3e4', ink: '#3d2a1e', sub: '#8a7360', red: '#b8322c', green: '#2f7a4a', line: '#e3d3bb' };
const IMAGES = {};          // assets/manifest.json "images": panel name -> background picture
class Panel {
  constructor({ w, h, px = 1024, draw, transparent = true, name = 'Panel' }) {
    Panel.all.push(this);
    this.w = w; this.h = h; this.W = px; this.H = Math.round(px * h / w);
    this.canvas = document.createElement('canvas'); this.canvas.width = this.W; this.canvas.height = this.H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.name = name; this.mesh.userData.panel = this;
    this.drawFn = draw; this.state = {}; this.buttons = []; this.redraw();
  }
  set(s) { Object.assign(this.state, s); this.redraw(); }
  redraw() { const g = this.g; g.clearRect(0, 0, this.W, this.H); this.buttons = []; this.bg = IMAGES[this.mesh.name]; if (this.bg) g.drawImage(this.bg, 0, 0, this.W, this.H); this.drawFn(g, this); this.tex.needsUpdate = true; }
  text(str, x, y, { size = 32, weight = 400, color = INK.ink, align = 'left', maxW = 0, lineH = 0 } = {}) {
    const g = this.g; g.font = `${weight} ${size}px "Noto Sans KR", system-ui, sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'top';
    if (!maxW) { g.fillText(str, x, y); return y + (lineH || size * 1.35); }
    let line = '', yy = y;
    for (const ch of str) { if (g.measureText(line + ch).width > maxW && line) { g.fillText(line, x, yy); yy += lineH || size * 1.35; line = ch; } else line += ch; }
    if (line) { g.fillText(line, x, yy); yy += lineH || size * 1.35; }
    return yy;
  }
  round(x, y, w, h, r) { const g = this.g; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  card(bg = INK.paper, border = '#d9c4a3') { if (this.bg) return; const g = this.g; this.round(6, 6, this.W - 12, this.H - 12, 28); g.fillStyle = bg; g.fill(); g.lineWidth = 6; g.strokeStyle = border; g.stroke(); }
  button(id, x, y, w, h, label, { color = INK.red, size = 34, disabled = false, sub = '' } = {}) {
    const g = this.g; this.round(x, y, w, h, Math.min(24, h / 2)); g.fillStyle = disabled ? '#cfc4b6' : color; g.fill();
    this.text(label, x + w / 2, y + (sub ? h * 0.18 : h / 2 - size * 0.62), { size, weight: 700, color: '#fff', align: 'center' });
    if (sub) this.text(sub, x + w / 2, y + h * 0.58, { size: size * 0.62, color: 'rgba(255,255,255,.9)', align: 'center' });
    if (!disabled) this.buttons.push({ id, x, y, w, h });
  }
  hitUV(uv) { const x = uv.x * this.W, y = (1 - uv.y) * this.H; return this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id ?? null; }
}

Panel.all = [];

// bubbly foam for the basin (canvas: lots of small soft rings, white in the middle, thinner toward the edge)
function foamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 250, x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r, s = 3 + Math.random() * 12 * (1 - r / 300);
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2);
    g.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * (1 - r / 256)})`; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------ particles
class FX {
  constructor(scene, n = 900) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.014, map: dotTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -99;
  }
  emit(p, { color = '#ffe28a', count = 20, speed = 0.3, gravity = 0, life = 0.8, dir = null, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let j = 0; j < count; j++) {
      const k = this.i = (this.i + 1) % this.n;
      this.pos.set([p.x, p.y, p.z], k * 3);
      let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      if (dir) { vx = dir.x + vx * 0.3 * spread; vy = dir.y + vy * 0.3 * spread; vz = dir.z + vz * 0.3 * spread; }
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel.set([vx * s, vy * s, vz * s], k * 3); this.col.set([c.r, c.g, c.b], k * 3);
      this.life[k] = this.max[k] = life * (0.6 + Math.random() * 0.5); this.grav[k] = gravity;
    }
  }
  update(dt) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -99; continue; }
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ placeholder builders (asset ids → see ASSETS.md)
function labelPlane(text, w = 0.07, color = '#3d2a1e', bg = '#f6ead2') {
  const p = new Panel({ w, h: w * 0.36, px: 360, draw: (g, P) => { P.round(4, 4, P.W - 8, P.H - 8, 18); g.fillStyle = bg; g.fill(); P.text(text, P.W / 2, P.H / 2 - 26, { size: 40, weight: 700, color, align: 'center' }); } });
  p.mesh.material.transparent = true; return p.mesh;
}
const PH = {
  mortar() {
    const g = new THREE.Group();
    const prof = [[0.03, 0], [0.068, 0.004], [0.075, 0.03], [0.072, 0.07], [0.062, 0.07], [0.06, 0.035], [0.035, 0.018], [0, 0.018]].map(([r, y]) => new THREE.Vector2(r, y));
    g.add(mesh(new THREE.LatheGeometry(prof, 28), mat(0x9a948c, { roughness: 0.95 }), 'MortarBody'));
    return g;
  },
  pestle() {
    const g = new THREE.Group();
    const m = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.17, 14), mat(0xb6aea2, { roughness: 0.9 }));
    m.position.y = 0.085; g.add(m);
    const tip = mesh(new THREE.SphereGeometry(0.02, 14, 10), mat(0xb6aea2, { roughness: 0.9 })); tip.position.y = 0; g.add(tip);
    return g;
  },
  board() { const m = mesh(new THREE.BoxGeometry(0.22, 0.016, 0.15), mat(0xb88552)); m.position.y = 0.008; const g = new THREE.Group(); g.add(m); return g; },
  knife() {
    const g = new THREE.Group();
    const blade = mesh(new THREE.BoxGeometry(0.11, 0.002, 0.024), mat(0xd9dde2, { metalness: 0.8, roughness: 0.25 })); blade.position.x = -0.06; g.add(blade);
    const handle = mesh(new THREE.BoxGeometry(0.07, 0.012, 0.018), mat(0x4a2d1a)); handle.position.x = 0.03; g.add(handle);
    return g;
  },
  mold(shape) {
    const g = new THREE.Group();
    const tray = mesh(new THREE.CylinderGeometry(0.07, 0.072, 0.03, 32, 1, true), mat(0xc7c9cc, { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide })); tray.position.y = 0.015; g.add(tray);
    const bottom = mesh(new THREE.CircleGeometry(0.07, 32).rotateX(-Math.PI / 2), mat(0xb5b8bc, { metalness: 0.6, roughness: 0.4 })); bottom.position.y = 0.002; g.add(bottom);
    return g;
  },
  lid() {
    const g = new THREE.Group();
    const top = mesh(new THREE.CylinderGeometry(0.074, 0.074, 0.012, 32), mat(0xc7c9cc, { metalness: 0.6, roughness: 0.35 })); g.add(top);
    const knob = mesh(new THREE.SphereGeometry(0.016, 14, 10), mat(0xe0a05a)); knob.position.y = 0.018; knob.name = 'LidHandle'; g.add(knob);
    return g;
  },
  basket() {
    const g = new THREE.Group();
    const prof = [[0, 0], [0.09, 0.005], [0.11, 0.06], [0.105, 0.065], [0.085, 0.012], [0, 0.012]].map(([r, y]) => new THREE.Vector2(r, y));
    g.add(mesh(new THREE.LatheGeometry(prof, 20), mat(0x8a5a2e, { roughness: 1 })));
    return g;
  },
  fruit(id) { const g = new THREE.Group(); const m = mesh(new THREE.SphereGeometry(0.03, 18, 14), mat(ING[id].color, { roughness: 0.55 })); m.scale.set(1, 0.92, 1); m.position.y = 0.028; g.add(m); return g; },
  fruitHalf(id) {
    const g = new THREE.Group();
    const m = mesh(new THREE.SphereGeometry(0.03, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(ING[id].color, { side: THREE.DoubleSide })); g.add(m);
    const cut = mesh(new THREE.CircleGeometry(0.029, 18).rotateX(Math.PI / 2), mat(new THREE.Color(ING[id].color).lerp(new THREE.Color('#fffbe0'), 0.5))); cut.position.y = 0.0005; g.add(cut);
    g.rotation.x = Math.PI; g.position.y = 0;   // flat side down
    const w = new THREE.Group(); w.add(g); g.position.y = 0.0; return w;
  },
  bottle(id) {
    const g = new THREE.Group(); const c = ING[id].color;
    const body = mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.085, 18), mat(0xd8e6ea, { transparent: true, opacity: 0.55, roughness: 0.1 })); body.position.y = 0.0425; g.add(body);
    const fill = mesh(new THREE.CylinderGeometry(0.025, 0.027, 0.06, 16), mat(c, { roughness: 0.8 })); fill.position.y = 0.032; g.add(fill);
    const neck = mesh(new THREE.CylinderGeometry(0.013, 0.02, 0.02, 14), mat(0xd8e6ea, { transparent: true, opacity: 0.55 })); neck.position.y = 0.095; g.add(neck);
    const cork = mesh(new THREE.CylinderGeometry(0.012, 0.011, 0.016, 12), mat(0xa77a4c)); cork.position.y = 0.111; g.add(cork);
    const lab = labelPlane(ING[id].name, 0.06); lab.position.set(0, 0.045, 0.031); g.add(lab);
    return g;
  },
  stick(id) {   // drawer items
    const g = new THREE.Group(); const c = ING[id].color;
    if (id === 'eucalyptus') {
      for (let i = 0; i < 4; i++) { const l = mesh(new THREE.CircleGeometry(0.018, 12), mat(c, { side: THREE.DoubleSide })); l.position.set(-0.03 + i * 0.02, 0.006, (i % 2) * 0.012); l.rotation.set(-Math.PI / 2 + 0.2, 0, i); g.add(l); }
      const st = mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.1, 5), mat(0x5d7a52)); st.rotation.z = Math.PI / 2; st.position.y = 0.004; g.add(st);
    } else if (id === 'ginger') {
      for (let i = 0; i < 4; i++) { const b = mesh(new THREE.SphereGeometry(0.018 - i * 0.002, 12, 10), mat(c, { roughness: 0.9 })); b.position.set(-0.03 + i * 0.02, 0.016, Math.sin(i * 2) * 0.01); b.scale.set(1.2, 0.8, 0.9); g.add(b); }
    } else {
      const r = id === 'vanilla' ? 0.004 : 0.008, len = id === 'vanilla' ? 0.13 : 0.11;
      const m = mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 10), mat(c, { roughness: 0.95 })); m.rotation.z = Math.PI / 2; m.position.y = r; g.add(m);
    }
    return g;
  },
  pieces(id) {
    const g = new THREE.Group(); const c = ING[id].color;
    for (let i = 0; i < 4; i++) {
      const m = id === 'eucalyptus' ? mesh(new THREE.CircleGeometry(0.012, 8), mat(c, { side: THREE.DoubleSide }))
        : id === 'ginger' ? mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12), mat('#e9cf92'))
        : mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), mat(c));
      m.position.set((i - 1.5) * 0.018, 0.006, (i % 2) * 0.012); m.rotation.y = i; g.add(m);
    }
    return g;
  },
  firPot() {
    const g = new THREE.Group();
    const pot = mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.06, 16), mat(0xb5603a)); pot.position.y = 0.03; g.add(pot);
    const tree = mesh(new THREE.ConeGeometry(0.04, 0.13, 10), mat(0x2f6a3c, { flatShading: true }), 'Plant_Fir'); tree.position.y = 0.125; g.add(tree);
    g.userData.plant = tree; return g;
  },
  bathbomb(shape, color) {
    const g = new THREE.Group(); const m = mat(color, { roughness: 0.85 });
    const add = (geo, y = 0, s) => { const x = mesh(geo, m); x.position.y = y; if (s) x.scale.copy(s); g.add(x); return x; };
    if (shape === 'tree') add(new THREE.ConeGeometry(0.04, 0.08, 18), 0.04);
    else if (shape === 'santa') { add(new THREE.SphereGeometry(0.035, 20, 16), 0.035); const hat = mesh(new THREE.ConeGeometry(0.025, 0.04, 16), mat('#d23c3c')); hat.position.y = 0.075; g.add(hat); }
    else if (shape === 'round') add(new THREE.SphereGeometry(0.038, 22, 18), 0.038);
    else if (shape === 'snowman') { add(new THREE.SphereGeometry(0.03, 18, 14), 0.03); add(new THREE.SphereGeometry(0.021, 18, 14), 0.075); }
    else {
      const sh = new THREE.Shape();
      if (shape === 'snowflake') { for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = i % 2 ? 0.018 : 0.042; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(r, 0); } }
      else { // gingerbread person
        sh.absarc(0, 0.032, 0.015, 0, Math.PI * 2, false);
        const b = new THREE.Shape(); b.moveTo(-0.012, 0.02); b.lineTo(-0.04, 0.012); b.lineTo(-0.04, 0.0); b.lineTo(-0.014, 0.004);
        b.lineTo(-0.026, -0.04); b.lineTo(-0.012, -0.042); b.lineTo(0, -0.016); b.lineTo(0.012, -0.042); b.lineTo(0.026, -0.04);
        b.lineTo(0.014, 0.004); b.lineTo(0.04, 0.0); b.lineTo(0.04, 0.012); b.lineTo(0.012, 0.02); b.closePath();
        const geo = new THREE.ExtrudeGeometry([sh, b], { depth: 0.02, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 });
        geo.rotateX(-Math.PI / 2); geo.translate(0, 0.003, 0); add(geo); return g;
      }
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.024, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, 0.003, 0); add(geo);
    }
    return g;
  },
  decorPlace(d) {
    const g = new THREE.Group();
    if (/별/.test(d.label)) {
      const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.008 : 0.02; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const m = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false }), mat(d.color, { metalness: 0.6, roughness: 0.3, emissive: new THREE.Color(d.color).multiplyScalar(0.25) })); m.position.y = 0.02; g.add(m);
    } else {
      const m = mesh(new THREE.SphereGeometry(0.022, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), mat(d.color, { side: THREE.DoubleSide, roughness: 1 })); m.position.y = 0.022; g.add(m);
    }
    return g;
  },
  shaker(d) {
    const g = new THREE.Group();
    const b = mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.07, 16), mat(0xf2ead8)); b.position.y = 0.035; g.add(b);
    const cap = mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.018, 16), mat(d.color, { metalness: 0.4, roughness: 0.4 })); cap.position.y = 0.079; g.add(cap);
    const lab = labelPlane(d.label.replace(' 장식', ''), 0.05); lab.position.set(0, 0.035, 0.023); g.add(lab);
    return g;
  },
  wrapPaper(tex) {
    const g = new THREE.Group();
    const m = mesh(new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xc8333a, roughness: 0.8, side: THREE.DoubleSide }));
    m.position.y = 0.002; g.add(m);
    const handle = mesh(new THREE.BoxGeometry(0.06, 0.008, 0.02), mat(0xffd34d, { emissive: new THREE.Color(0x553300) }), 'WrapHandle');
    handle.position.set(0, 0.006, 0.15); g.add(handle);
    g.userData.handle = handle; return g;
  },
  giftBox(tex, ribbon = '#ffd34d') {
    const g = new THREE.Group();
    const box = mesh(new THREE.BoxGeometry(0.11, 0.09, 0.11), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xc8333a, roughness: 0.8 })); box.position.y = 0.045; g.add(box);
    const rm = mat(ribbon, { metalness: 0.3, roughness: 0.4 });
    const r1 = mesh(new THREE.BoxGeometry(0.115, 0.092, 0.018), rm); r1.position.y = 0.045; g.add(r1);
    const r2 = mesh(new THREE.BoxGeometry(0.018, 0.092, 0.115), rm); r2.position.y = 0.045; g.add(r2);
    const bow = mesh(new THREE.TorusKnotGeometry(0.012, 0.004, 40, 6, 2, 3), rm); bow.position.y = 0.097; g.add(bow);
    g.userData.lidParts = [bow]; return g;
  },
  envelope() {
    const g = new THREE.Group();
    const m = mesh(new THREE.BoxGeometry(0.12, 0.004, 0.085), mat(0xf3e6cc)); m.position.y = 0.002; g.add(m);
    const seal = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.003, 16), mat(0xb8322c)); seal.position.y = 0.0055; g.add(seal);
    return g;
  },
  basinBowl() {        // CONVEYOR: a stone basin standing on the basin table (no pedestal)
    const g = new THREE.Group();
    const prof = [[0, 0], [0.13, 0], [0.2, 0.04], [0.235, 0.12], [0.24, 0.15], [0.225, 0.15], [0.205, 0.105], [0.12, 0.05], [0, 0.05]].map(([r, y]) => new THREE.Vector2(r, y));
    g.add(mesh(new THREE.LatheGeometry(prof, 40), mat(0x8a8276, { roughness: 0.9 })));
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.212, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3fa7d6, emissive: 0x1a6aa0, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.9 }));
    water.position.y = 0.125; water.name = 'BasinWater'; g.add(water);
    g.userData.water = water; return g;
  },
  basin() {
    const g = new THREE.Group();
    const ped = mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.72, 16), mat(0x7d7468, { roughness: 1 })); ped.position.y = 0.36; g.add(ped);
    const prof = [[0, 0.72], [0.12, 0.72], [0.22, 0.8], [0.24, 0.86], [0.225, 0.86], [0.2, 0.81], [0.1, 0.76], [0, 0.76]].map(([r, y]) => new THREE.Vector2(r, y));
    g.add(mesh(new THREE.LatheGeometry(prof, 32), mat(0x8a8276, { roughness: 0.9 })));
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3fa7d6, emissive: 0x1a6aa0, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.9 }));
    water.position.y = 0.835; water.name = 'BasinWater'; g.add(water);
    g.userData.water = water; return g;
  },
  // Nicolas's speech bubble: the chalkboard DialoguePanel from rush-xr-ui (types its own text). Floats above him and
  // faces the player (works in VR). It quacks like a Panel (mesh / w / h / hitUV) so a click, a pointing pinch or a
  // fingertip anywhere on it = next line.
  talkPanel() {
    const board = new DialoguePanel();                  // the asset as it is (its own board, font, typing speed)
    const S = 1.55;                                      // only placed bigger, so it reads above Santa from the desk
    board.scale.setScalar(S);
    board.traverse(o => { if (o.isMesh) { o.material.depthTest = false; o.material.toneMapped = false; o.renderOrder = o.renderOrder < 0 ? 10 : 11; } });
    const panel = { mesh: board, w: 0.46, h: 0.46 * 661 / 1550, board, hitUV: () => 'next' };
    board.userData.panel = panel;
    return panel;
  }
};

// real models from the space package (modules/kitchen.js): bottles, knife and lemon replace the placeholders,
// everything the flow does with them (pour, cut, squeeze) stays the same. Bergamot has no model yet.
function useSpaceModels(K) {
  if (!K || PH.spaceModels) return; PH.spaceModels = true;
  const KEY = { fairySugar: 'fairy', starDust: 'stardust', benzoin: 'benzoin', turmeric: 'turmeric', coconutOil: 'coconut' };
  const bottle = PH.bottle, fruit = PH.fruit, half = PH.fruitHalf;
  const onFloor = (o, y) => { o.position.y = y; const g = new THREE.Group(); g.add(o); return g; };   // flow models stand on y = 0
  PH.bottle = (id) => KEY[id] ? (b => onFloor(b, b.userData.base))(K.makeBottle(KEY[id])) : bottle(id);
  PH.knife = () => onFloor(K.makeKnife(), 0.002);
  PH.fruit = (id) => id === 'lemon' ? onFloor(K.makeLemon(), K.LEMON_R()) : fruit(id);
  PH.fruitHalf = (id) => id === 'lemon' ? onFloor(K.lemonHalf(1), K.LEMON_LEN / 2) : half(id);
}

// which hand motion the guide board shows. Only four moments get one: pouring a bottle into the mortar (pour),
// pulling an ingredient drawer open (grab, set in naturalsHint), pounding in the mortar (pound = 'Prep') and pressing
// the filled mold (press). Every other step hides the board.
function guideFor(title = '') {
  if (title.startsWith('03 재료 수집')) return 'pour';
  if (title.startsWith('05 빻기')) return 'pound';
  if (title.startsWith('06 눌러')) return 'press';
  return null;
}

// ================================================================== the flow
export class Flow {
  constructor(ctx) {
    Object.assign(this, ctx);        // scene, root, camera, renderer, rig, garden, canvas, fire, toast, hintEl, P, cast
    this.toast = () => {};
    if (this.garden) { const h = this.garden.onHarvest; this.garden.onHarvest = (...a) => { h?.(...a); Foley.pluck(a[2]?.mesh ? wp(a[2].mesh) : null); }; }   // plucking leaves / petals (푝푝)           // no plain text notices ("…넣기 완료" etc.); only the red wrong-ingredient card is kept
    this.group = new THREE.Group(); this.group.name = 'Flow'; this.scene.add(this.group);
    this.fx = new FX(this.scene);
    this.tweens = []; this.timers = []; this.follows = []; this.floaters = []; this.markers = [];
    this.panels = []; this.grabs = []; this.zones = {};
    this.mouseObj = null; this.mouseDepth = 0.42; this.tiltKey = false; this.tiltAmt = 0;
    this.pressHold = null;
    this.s = { step: 'dark', emotion: null, recipe: null, recipeId: null, done: new Set(), pounds: 0, pourT: 0 };
    this.assets = {};
    this.wrapTex = null;
    new THREE.TextureLoader().load('giftwrap.webp', t => { t.colorSpace = THREE.SRGBColorSpace; this.wrapTex = t; }, undefined, () => {});
    useSpaceModels(window.Kitchen);
    if (this.layout) for (const [k, v] of Object.entries(this.layout)) L[k] = v?.isVector3 ? v.clone() : v;   // index.html can move stations
    this.loadManifest();
    this.build();
    this.bindInput();
    this.setHint('', '');
  }

  // ---------------------------------------------------------------- asset overrides (assets/manifest.json)
  async loadManifest() {
    try {
      const r = await fetch('assets/manifest.json', { cache: 'no-cache' }); if (!r.ok) return;
      const m = await r.json(); this.manifest = m;
      if (m.content) await this.loadContent(m.content);
      for (const [name, file] of Object.entries(m.images || {})) {
        const img = new Image(); img.onload = () => { IMAGES[name] = img; Panel.all.filter(p => p.mesh.name === name).forEach(p => p.redraw()); }; img.src = file;
      }
      const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/');
      this.gltf = new GLTFLoader().setDRACOLoader(draco);
      for (const o of this.made || []) this.applyAsset(o);
    } catch (e) { if (this.manifest) console.warn('manifest', e); /* no manifest yet: placeholders stay */ }
  }
  async loadContent(file) {      // texts: ingredient names, emotions, recipes, Nicolas's opening lines (merged by id)
    try {
      const c = await (await fetch(file, { cache: 'no-cache' })).json();
      if (c.opening) Object.assign(OPENING, c.opening);
      for (const [id, v] of Object.entries(c.ingredients || {})) ING[id] = Object.assign(ING[id] || {}, v);
      for (const [id, v] of Object.entries(c.recipes || {})) RECIPES[id] = Object.assign(RECIPES[id] || {}, v);
      for (const e of c.emotions || []) { const o = EMOTIONS.find(x => x.id === e.id); o ? Object.assign(o, e) : EMOTIONS.push(e); }
      Panel.all.forEach(p => p.redraw());
    } catch (e) { console.warn('content', e); }
  }
  // sounds: assets/manifest.json "sounds": { event: file } (missing = silent)
  sfx(name, { loop = false, volume = 1 } = {}) {
    const f = this.manifest?.sounds?.[name]; if (!f) return null;
    try { const a = new Audio(f); a.loop = loop; a.volume = volume; a.play().catch(() => {}); return a; } catch (e) { return null; }
  }
  make(id, builder) {
    const holder = new THREE.Group(); holder.name = 'Asset_' + id; holder.userData.assetId = id;
    const ph = builder(); ph.name = 'Placeholder_' + id; holder.add(ph); holder.userData.placeholder = ph;
    (this.made ||= []).push(holder);
    if (this.manifest) this.applyAsset(holder);
    return holder;
  }
  applyAsset(holder) {
    const id = holder.userData.assetId, file = this.manifest?.models?.[id]; if (!file || holder.userData.swapped) return;
    holder.userData.swapped = true;
    this.gltf.load(file, (g) => {
      const ph = holder.userData.placeholder, model = g.scene;
      const pb = new THREE.Box3().setFromObject(ph), size = pb.getSize(V()), mb = new THREE.Box3().setFromObject(model), ms = mb.getSize(V());
      const fit = this.manifest.fit?.[id] ?? 'contain';
      if (fit !== 'none') { const k = Math.min(size.x / ms.x || 1, size.y / ms.y || 1, size.z / ms.z || 1); model.scale.multiplyScalar(k); }
      model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      ph.visible = false; holder.add(model);
    }, undefined, (e) => console.warn('asset', id, e));
  }

  // ---------------------------------------------------------------- build the stations
  build() {
    const G = this.group;
    // recipe book (open book: two page panels on a cover)
    this.book = new THREE.Group(); this.book.name = 'RecipeBook';
    const cover = this.make('book', () => { const g = new THREE.Group(); const c = mesh(new THREE.BoxGeometry(0.44, 0.012, 0.29), mat(0x7a1f22)); c.position.y = -0.007; g.add(c); return g; });
    this.book.add(cover);
    this.pages = new Panel({ w: 0.42, h: 0.27, px: 1400, transparent: false, name: 'BookPages', draw: (g, P) => this.drawBook(g, P) });
    this.pages.mesh.rotation.x = -Math.PI / 2; this.pages.mesh.position.y = 0.0015; this.book.add(this.pages.mesh);
    this.book.position.copy(L.book); this.book.rotation.y = Math.PI / 2;     // reads from the player side (+x)
    this.book.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -BOOK_TILT));   // leans back so the pages face the player
    this.book.scale.setScalar(0.75);
    G.add(this.book); this.bookHome = { pos: this.book.position.clone(), quat: this.book.quaternion.clone(), scale: this.book.scale.clone() };
    // the placeholder book (cover + canvas pages) is never shown: only the LUSH recipe book module appears (loadRecipeBook)
    for (const c of this.book.children) c.visible = false;
    this.loadRecipeBook();

    // work tools
    this.mortar = this.make('mortar', PH.mortar); this.mortar.position.copy(L.mortar); G.add(this.mortar);
    this.contents = new THREE.Mesh(new THREE.CircleGeometry(0.058, 24).rotateX(-Math.PI / 2), mat(0xf4f1ff, { roughness: 1 }));
    this.contents.position.y = 0.02; this.contents.visible = false; this.mortar.add(this.contents);
    this.zones.mortar = { obj: this.mortar, off: V(0, 0.07, 0), r: 0.11, hover: 0.14 };
    this.pestle = this.make('pestle', PH.pestle); this.pestle.position.copy(L.pestle); this.pestle.rotation.z = Math.PI / 2; G.add(this.pestle);
    this.board = this.make('board', PH.board); this.board.position.copy(L.board); this.board.rotation.y = Math.PI / 2; G.add(this.board);
    this.zones.board = { obj: this.board, off: V(0, 0.02, 0), r: 0.13, hover: 0.07 };
    this.knife = this.make('knife', PH.knife); this.knife.position.copy(L.knife); this.knife.rotation.y = Math.PI / 2; G.add(this.knife);
    this.mold = null;   // made once the recipe is known
    // back shelf: bottles + fruit basket + fir pot
    this.bottles = {};
    for (const [id, [x, z, y, rot]] of Object.entries(L.bottles)) {   // [x, z] on the desk, or [x, z, floorY, yaw] (shelf of the space package)
      const b = this.make('bottle_' + id, () => PH.bottle(id)); b.position.set(x, y ?? DESK_Y, z); b.rotation.y = rot ?? Math.PI / 2; G.add(b);
      b.userData.ing = id; this.bottles[id] = b;
    }
    this.basket = this.make('basket', PH.basket); this.basket.position.copy(L.basket); G.add(this.basket);
    this.fruits = {};
    [['bergamot', -0.035], ['lemon', 0.035]].forEach(([id, dz]) => this.spawnFruit(id, dz, false));
    const fir = this.make('firPot', PH.firPot); fir.position.copy(L.firPot); G.add(fir);
    const firPlant = fir.userData.placeholder.userData.plant; if (firPlant && this.garden) this.garden.addPlant(firPlant, 'fir');
    // drawers of the bookcase: each holds one ingredient
    this.drawers = [];
    const ds = this.drawerSet;            // the painted cabinet of the space package (drawers.js) moves front + knob + name tag together
    if (ds?.drawers?.length) {
      ds.drawers.filter(x => /^Drawer00[2-7]$/.test(x.name)).sort((a, b) => a.name.localeCompare(b.name)).forEach((x, i) => {
        const id = L.drawers[i]; if (!id) return;
        const front = x.parts[0].o, plate = x.parts.find(p => /^NameTag/.test(p.o.name))?.o || front;
        const c = new THREE.Box3().setFromObject(front).getCenter(V());
        this.drawers.push({ obj: front, ds: x, id, c, tag: plate, open: false, item: null });
      });
    } else {
      const dObjs = []; this.root.traverse(o => { if (/^Drawer00[2-7]$/.test(o.name)) dObjs.push(o); });
      dObjs.sort((a, b) => a.name.localeCompare(b.name));
      dObjs.forEach((d, i) => {
        const id = L.drawers[i]; if (!id) return;
        d.updateWorldMatrix(true, true);
        const c = new THREE.Box3().setFromObject(d).getCenter(V());
        const tag = labelPlane(ING[id].name, 0.07); tag.position.set(c.x, c.y + 0.0, 0.738); tag.rotation.y = Math.PI; G.add(tag);
        const p0 = d.position.clone(), local = d.parent.worldToLocal(c.clone().add(V(0, 0, -0.11))).sub(d.parent.worldToLocal(c.clone()));
        this.drawers.push({ obj: d, id, c, tag, p0, open: false, delta: local, item: null });
      });
    }
    // CONVEYOR (modules/conveyor.js): table 1 = this desk; table 2 = wrapping (the paper rolls from the bookshelf on it);
    // table 3 = a water basin. Tables 2 and 3 wait behind the right wall. The fireplace no longer takes part: it just glows.
    this.conv = createConveyor({ scene: this.scene, root: this.root, colliders: this.colliders || [], garden: this.garden });
    this.table2 = this.conv.deskCopy('Table2_Wrapping');
    const rolls = this.root.getObjectByName('PaperRollRack');
    if (rolls) {
      rolls.visible = true; this.root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(rolls), sz = bb.getSize(V());
      const piv = new THREE.Group(); this.root.add(piv); piv.position.copy(bb.getCenter(V())).setY(bb.min.y); piv.updateMatrixWorld(true); piv.attach(rolls);
      if (sz.x > sz.z) piv.rotation.y = Math.PI / 2;                // rolls lie along the table
      piv.position.set(L.rolls.x, DESK_Y + 0.002, L.rolls.z + this.table2.position.z);   // the table waits behind the wall
      piv.updateMatrixWorld(true); this.table2.attach(rolls); piv.removeFromParent();
      this.conv.live(rolls); this.conv.clip(rolls);
    }
    this.table3 = this.conv.deskCopy('Table3_Basin');
    this.basin = this.make('basin', PH.basinBowl); this.basin.position.copy(L.basin); this.table3.add(this.basin); this.conv.clip(this.basin);
    this.zones.basin = { obj: this.basin, off: V(0, 0.13, 0), r: 0.22, hover: 0.12 };

    // floating hint panel for VR (PC uses the DOM hint)
    this.hint = new Panel({ w: 0.5, h: 0.15, px: 1000, name: 'HintPanel', draw: (g, P) => {
      const st = P.state; if (!st.title && !st.body) return;
      P.round(6, 6, P.W - 12, P.H - 12, 26); g.fillStyle = 'rgba(20,14,10,.82)'; g.fill(); g.lineWidth = 4; g.strokeStyle = st.accent || '#e0a05a'; g.stroke();
      const y = P.text(st.title || '', 34, 26, { size: 36, weight: 700, color: st.accent || '#ffd9a8' });
      P.text(st.body || '', 34, y + 4, { size: 26, color: '#f3e7d6', maxW: P.W - 68, lineH: 34 });
    } });
    this.hint.mesh.visible = false; this.scene.add(this.hint.mesh);

    // grabbables (registered with the herb garden's input hub)
    this.grab(this.pestle, { modes: ['fist', 'pinch'], reach: 0.05, tip: V(0, 0, 0) });
    this.grab(this.knife, { modes: ['pinch', 'fist'], reach: 0.05 });
    this.grab(this.mortar, { modes: ['fist', 'pinch'], reach: 0.05, enabled: false });
    for (const b of Object.values(this.bottles)) this.grab(b, { modes: ['fist', 'pinch'], reach: 0.04 });
    for (const f of Object.values(this.fruits)) this.grab(f, { modes: ['pinch', 'fist'], reach: 0.04 });
    this.fruitDz = { bergamot: -0.035, lemon: 0.035 };
    // the herb garden tells us when a picked leaf/petal is let go: into the mortar?
    if (this.garden) this.garden.onItemDrop = (it) => this.onHerbDrop(it);
    // VR: point at something out of reach and pinch -> drawers open, buttons press (herbs.js draws the hand ray)
    if (this.garden) { this.garden.rayTargets = () => this.clickables(); this.garden.onRayPick = (h, slot) => this.clickHit(h, slot); }
    if (this.garden) { this.garden.blockers.push(this.pages.mesh); }
  }

  // a whole fruit in the basket (again after one was cut: free play, the basket never runs out)
  spawnFruit(id, dz = this.fruitDz?.[id] ?? 0, grab = true) {
    const f = this.make('fruit_' + id, () => PH.fruit(id)); f.position.set(L.basket.x, DESK_Y + 0.012, L.basket.z + dz); this.group.add(f);
    f.userData.ing = id; this.fruits[id] = f;
    if (grab) { this.grab(f, { modes: ['pinch', 'fist'], reach: 0.04 }); const s0 = f.scale.clone(); f.scale.setScalar(0.01); this.tween(0.5, k => f.scale.copy(s0).multiplyScalar(Math.max(0.01, ease.back(k)))); }
    return f;
  }

  // ---------------------------------------------------------------- grabbing (XR hands/controllers + mouse)
  grab(obj, { modes = ['pinch', 'fist'], reach = 0.05, enabled = true, home = true, tip = null } = {}) {
    obj.updateWorldMatrix(true, true);
    obj.userData.home = { pos: wp(obj), quat: obj.getWorldQuaternion(new THREE.Quaternion()), scale: obj.getWorldScale(V()) };
    obj.userData.tip = tip;
    this.addHitProxy(obj);
    const g = this.garden?.addGrabbable({
      object: obj, modes, reach, enabled,
      distance: (p) => new THREE.Box3().setFromObject(obj).distanceToPoint(p),
      onGrab: (anchor, slot) => { this.stopTween(obj); this.unfloat(obj); obj.userData.holder = slot; anchor.attach(obj); this.onGrabbed(obj); },
      onRelease: () => { this.scene.attach(obj); this.group.attach(obj); const h = obj.userData.holder; obj.userData.holder = null; this.onReleased(obj, h); },
      onMouseDown: () => { this.stopTween(obj); this.unfloat(obj); this.group.attach(obj); obj.userData.holder = 'mouse'; this.mouseObj = obj; this.tiltAmt = 0; this.onGrabbed(obj); },
      onMouseUp: () => { if (this.mouseObj === obj) this.mouseObj = null; obj.userData.holder = null; this.onReleased(obj, 'mouse'); }
    });
    obj.userData.g = g; this.grabs.push(obj);
    return g;
  }
  // small things (vanilla pods, petals, pens) get an invisible, finger/mouse-sized hit box
  addHitProxy(obj, min = 0.05) {
    if (obj.userData.hitProxy) return;
    obj.updateWorldMatrix(true, true);
    const inv = obj.matrixWorld.clone().invert(), bb = new THREE.Box3(), m4 = new THREE.Matrix4();
    obj.traverse(m => { if (m.isMesh && m.geometry) { m.geometry.boundingBox || m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld))); } });
    if (bb.isEmpty()) return;
    const size = bb.getSize(V()), c = bb.getCenter(V());
    if (size.x >= min && size.y >= min && size.z >= min) return;
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, min), Math.max(size.y, min), Math.max(size.z, min)), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.copy(c); box.name = 'HitProxy'; obj.add(box); obj.userData.hitProxy = box;
  }
  ungrab(obj) { if (obj.userData.g) this.garden?.removeGrabbable(obj.userData.g); obj.userData.g = null; if (this.mouseObj === obj) this.mouseObj = null; }
  setGrabEnabled(obj, on) { if (obj.userData.g) obj.userData.g.enabled = on; }
  held(obj) { return !!obj?.userData.holder; }
  forceRelease(obj) {
    const h = obj.userData.holder; if (!h) return;
    if (h === 'mouse') { if (this.garden?.mouse) { this.garden.mouse.ext = null; } this.mouseObj = null; obj.userData.g && (obj.userData.g.held = null); }
    else { h.held = null; obj.userData.g && (obj.userData.g.held = null); }
    obj.userData.holder = null; this.group.attach(obj);
  }
  // hand a fresh object straight into the hand/mouse that held the old one
  handOver(from, to) {
    const h = from.userData.holder;
    if (h === 'mouse' && this.garden?.mouse) {
      this.forceRelease(from); to.userData.holder = 'mouse'; this.mouseObj = to;
      this.garden.mouse.ext = to.userData.g; to.userData.g.held = 'mouse';
    } else if (h && h.connected !== undefined) {
      this.forceRelease(from);
      const anchor = h.pinch ? h.pinchAnchor : h.fistAnchor; anchor.attach(to);
      to.userData.holder = h; to.userData.g.held = h; h.held = { type: 'ext', g: to.userData.g };
    }
  }
  goHome(obj, dur = 0.6) {
    const hm = obj.userData.home; if (!hm) return;
    this.group.attach(obj);
    this.tweenTo(obj, hm.pos, hm.quat, dur);
  }
  tweenTo(obj, pos, quat, dur = 0.6, done) {
    const par = obj.parent || this.group; par.updateWorldMatrix(true, false);
    const p0 = obj.position.clone(), q0 = obj.quaternion.clone(), p1 = par.worldToLocal(pos.clone());
    const q1 = quat ? par.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(quat) : null;
    this.stopTween(obj);
    this.tween(dur, k => { const e = ease.inOut(k); obj.position.lerpVectors(p0, p1, e); if (q1) obj.quaternion.slerpQuaternions(q0, q1, e); }, done, obj);
  }

  // where a held thing is "over": XR = really above it; mouse = the pointer ray passes near it
  zonePoint(z) { return wp(z.obj, z.off); }
  over(obj, z) {
    if (!z) return false;
    const c = this.zonePoint(z);
    if (obj.userData.holder === 'mouse') {
      const ray = this.mouseRay(); if (!ray) return false;
      return ray.distanceToPoint(c) < z.r * 1.25 && c.distanceTo(ray.origin) < 2.6;
    }
    const p = wp(obj), dx = p.x - c.x, dz = p.z - c.z;
    return Math.hypot(dx, dz) < z.r && p.y > c.y - 0.04 && p.y < c.y + 0.4;
  }
  tilted(obj) {
    if (obj.userData.holder === 'mouse') return this.tiltAmt > 0.7;
    const up = V(0, 1, 0).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
    return up.y < 0.45;
  }
  mouseRay() {
    if (!this.garden?.mouse) return null;
    const r = new THREE.Raycaster(); r.setFromCamera(this.garden.mouse.ndc, this.camera); return r.ray;
  }

  // ---------------------------------------------------------------- input: keys, clicks, fingertips
  bindInput() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.repeat) return;
      if (e.code === 'Space') { e.preventDefault(); this.action(); }
      if (e.code === 'KeyR') this.tiltKey = true;
      if (e.code === 'Enter' && this.s.step === 'intro') this.advanceTalk();   // the game itself starts only from the title screen's button
    });
    addEventListener('keyup', (e) => { if (e.code === 'KeyR') this.tiltKey = false; });
    c.addEventListener('pointerdown', (e) => {
      if (this.renderer.xr.isPresenting) return;
      if (this.s.step === 'dark') return;                                // waiting on the title screen
      if (e.button !== 0) return;
      if (this.s.step === 'intro') { this.advanceTalk(); return; }      // opening: a click anywhere = next line
      const r = c.getBoundingClientRect(), ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera); ray.far = 3.5;
      this.onClick(ray);
    });
    addEventListener('pointerup', (e) => {
      if (e.button === 0) this.pressHold = null;
    });
    c.addEventListener('wheel', (e) => { if (this.mouseObj) this.mouseDepth = THREE.MathUtils.clamp(this.mouseDepth - e.deltaY * 0.0006, 0.25, 1.0); }, { passive: true });
    this.renderer.xr.addEventListener('sessionstart', () => { if (this.s.step === 'dark') setTimeout(() => this.begin(), 600); });
    // VR: trigger (controller) or pinch (hand) anywhere = Nicolas's next line
    for (let i = 0; i < 2; i++) this.renderer.xr.getController(i).addEventListener('select', () => { if (this.s.step === 'intro') this.advanceTalk(); });
  }
  clickables() {
    const list = [];
    for (const p of this.panels) if (p.mesh.visible && p.mesh.parent) list.push(p.mesh);
    if (this.rb && this.s.step === 'emotion') list.push(...this.rb.pageMeshes);
    for (const d of this.drawers) list.push(d.obj, d.tag);
    if (this.lid && this.lid.visible) list.push(this.lid);
    if (this.wrapHandle && this.wrapHandle.visible) list.push(this.wrapHandle);
    if (this.recvBox && this.recvBox.visible && this.s.step === 'receive') list.push(this.recvBox);   // later it is grabbed, not clicked
    return list;
  }
  onClick(ray) {
    if (this.rb && this.s.step === 'emotion' && this.rb.pickFromRay(ray)) { this.sfx('click'); return true; }
    const hits = ray.intersectObjects(this.clickables(), true); if (!hits.length) return false;
    return this.clickHit(hits[0], 'mouse');
  }
  // a click (PC) or a pointing pinch from afar (VR hand ray) on a drawer, button, lid, handle, gift or ink pot
  clickHit(h, who = 'mouse') {
    const o = h.object;
    const owner = (x) => { for (let q = x; q; q = q.parent) { if (q.userData.panel) return { panel: q.userData.panel }; if (this.drawers.some(d => d.obj === q || d.tag === q)) return { drawer: this.drawers.find(d => d.obj === q || d.tag === q) };
      if (q === this.lid) return { lid: true }; if (q === this.wrapHandle) return { wrap: true }; if (q === this.recvBox) return { recv: true }; } return {}; };
    if (this.rb && this.rb.pageMeshes.includes(o)) {                         // VR hand ray on the book's emotion page
      if (h.uv && this.rb.pick(h.uv.x, h.uv.y)) { this.sfx('click'); return true; } return false;
    }
    const w = owner(o);
    if (w.panel) {
      const id = w.panel.hitUV(h.uv); if (id) this.press(w.panel, id); return !!id;
    } else if (w.drawer) this.toggleDrawer(w.drawer);
    else if (w.lid) this.lidClick();
    else if (w.wrap) this.coverWrap();
    else if (w.recv) this.takeGift();
    else return false;
    return true;
  }
  // XR: fingertips press panel buttons, touch drawers/lid/handles (the hand letter reads the hands itself)
  fingertips() {
    const out = [];
    for (const s of this.garden?.hands || []) {
      if (!s.connected) continue;
      const J = s.hand.joints, tip = s.isHand && J?.['index-finger-tip'];
      out.push({ slot: s, p: tip ? wp(tip) : wp(s.grip) });
    }
    return out;
  }
  updateTouch(dt) {
    for (const f of this.fingertips()) {
      if (this.rb && this.s.step === 'emotion') this.touchBook(f.p);
      const st = (f.slot._touch ||= {});
      for (const pnl of this.panels) {
        if (!pnl.mesh.visible || !pnl.mesh.parent) continue;
        const lp = pnl.mesh.worldToLocal(f.p.clone());
        const inside = Math.abs(lp.x) < pnl.w / 2 && Math.abs(lp.y) < pnl.h / 2;
        const key = pnl.mesh.uuid;
        if (inside && Math.abs(lp.z) < 0.014) {
          const uv = new THREE.Vector2(lp.x / pnl.w + 0.5, lp.y / pnl.h + 0.5);
          if (!st[key]) { st[key] = true; const id = pnl.hitUV(uv); if (id) this.press(pnl, id); }
        } else if (!inside || lp.z > 0.03 || lp.z < -0.03) { st[key] = false; }
      }
      // drawers: touch the front
      for (const d of this.drawers) {
        const near = f.p.distanceTo(wp(d.obj)) < 0.09 && f.p.x > d.c.x - 0.06;   // CONVEYOR: the cabinet faces the player (+x)
        if (near && !st['d' + d.id]) { st['d' + d.id] = true; this.toggleDrawer(d); }
        else if (!near && f.p.distanceTo(wp(d.obj)) > 0.14) st['d' + d.id] = false;
      }
      // received gift: touch it
      if (this.recvBox?.visible && this.s.step === 'receive' && f.p.distanceTo(wp(this.recvBox, V(0, 0.05, 0))) < 0.12) this.takeGift();
      // wrap handle: pinch it and lay it over the bath bomb (or just touch it)
      if (this.wrapHandle?.visible && this.s.step === 'wrapCover' && f.p.distanceTo(wp(this.wrapHandle)) < 0.05) this.coverWrap();
    }
    // pressing the mold lid: hands (palms or fingers, one or both) over the mold push the lid down; at the bottom it closes
    if (this.s.step === 'press' && this.lid && !this.held(this.lid)) {
      const m = wp(this.mold), top = m.y + LID_UP, shut = m.y + 0.036;
      let low = Infinity;
      for (const s of this.garden?.hands || []) {
        if (!s.connected) continue;
        const J = s.hand?.joints, pts = [s.palm, s.point, J?.['index-finger-tip'] && wp(J['index-finger-tip']), J?.['middle-finger-tip'] && wp(J['middle-finger-tip'])];
        for (const p of pts) if (p && Math.hypot(p.x - m.x, p.z - m.z) < 0.14 && p.y < top + 0.05) low = Math.min(low, p.y - 0.012);
      }
      const cur = wp(this.lid).y, goal = low < Infinity ? THREE.MathUtils.clamp(Math.min(cur, low), shut, top) : Math.min(top, cur + dt * 0.08);
      this.lid.position.copy(this.group.worldToLocal(V(m.x, goal, m.z)));
      if (goal <= shut + 0.005) this.closeLid();
    }
  }

  // PC: Space = the hand action for whatever you hold (cut, squeeze, break, pound, press)
  action() {
    const o = this.mouseObj, st = this.s.step;
    if (st === 'intro') return this.advanceTalk();
    if (o === this.knife) return this.tryCut();
    if (o === this.pestle) return this.pound();
    if (o?.userData.breakable) return this.breakItem(o);
    if (o?.userData.squeeze) { if (this.over(o, this.zones.mortar)) return this.addToMortar(o, o.userData.ing); return this.toast('절구 위로 가져가서 Space를 눌러주세요'); }
    if (st === 'press') return this.closeLid();
    if (st === 'open') return this.openLid();
    if (st === 'wrapCover') return this.coverWrap();
    if (st === 'receive') return this.takeGift();
    if (this.board.userData.item && !o) this.toast('칼을 먼저 집어주세요');
  }

  // ---------------------------------------------------------------- tiny engine: tweens, timers, follow, float, markers
  tween(dur, upd, done, owner) { const t = { t: 0, dur, upd, done, owner }; this.tweens.push(t); return t; }
  stopTween(owner) { this.tweens = this.tweens.filter(t => t.owner !== owner); }
  later(sec, fn) { this.timers.push({ t: sec, fn }); }
  viewTarget(dist, yOff = 0) {
    const cam = this.camera;
    const p = wp(cam), d = cam.getWorldDirection(V()); d.y = THREE.MathUtils.clamp(d.y, -0.65, 0.15); d.normalize();
    return p.addScaledVector(d, dist).add(V(0, yOff, 0));
  }
  // the view without head roll: position + straight-ahead / up / right axes
  // NB: always the user camera. In VR three keeps it (a child of the rig) in sync with the headset; renderer.xr.getCamera()
  // has no parent, so its getWorldQuaternion() would drop the rig's turn and the UI would face sideways.
  viewFrame() {
    const cam = this.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ'); e.z = 0;
    const q = new THREE.Quaternion().setFromEuler(e);
    return { head: wp(cam), q, f: V(0, 0, -1).applyQuaternion(q), u: V(0, 1, 0).applyQuaternion(q), r: V(1, 0, 0).applyQuaternion(q) };
  }
  viewFront(dist, up = 0, right = 0) { const v = this.viewFrame(); return v.head.addScaledVector(v.f, dist).addScaledVector(v.u, up).addScaledVector(v.r, right); }
  headPos() { const cam = this.camera; return wp(cam); }
  follow(obj, opts = {}) { this.unfollow(obj); this.follows.push({ obj, dist: 0.5, yOff: -0.1, speed: 4, face: true, ...opts }); }
  unfollow(obj) { this.follows = this.follows.filter(f => f.obj !== obj); }
  float(obj, base) { this.unfloat(obj); this.floaters.push({ obj, base: base.clone(), ph: Math.random() * 6 }); }
  unfloat(obj) { this.floaters = this.floaters.filter(f => f.obj !== obj); }
  // where to go next: the chalk Marker from rush-xr-ui. On the desk / shelf it is a ring around the thing with an arrow
  // bobbing above it ('down'); around something floating in the air the ring stands up and faces the player ('forward').
  // { obj, off } puts the ring at an offset from the object (a drawer's name tag, a plant's leaves).
  // Each marker is sized to its object so it never sits on it: the ring goes around the object's footprint (or, for
  // a floating thing / drawer tag, stands up around it), and the arrow floats clear above its top.
  setMarkers(targets) {
    for (const m of this.markers) m.obj.removeFromParent();
    this.markers = targets.filter(Boolean).map(t => {
      const target = t.obj || t, floating = t.mode ? t.mode === 'forward' : this.floaters.some(f => f.obj === target);
      target.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(target), size = box.getSize(V()), center = box.getCenter(V());
      if (box.isEmpty()) { size.set(0.06, 0.06, 0.06); center.copy(wp(target)); }
      const foot = Math.max(size.x, size.z) / 2;
      // ring radius ~ the kit's drawn circle (0.36 of a plane 2.8 x radius wide) clears the object by a few cm
      const radius = THREE.MathUtils.clamp((floating ? Math.max(foot, size.y / 2) : foot) * 1.15 + 0.03, 0.05, 0.35);
      const height = floating ? 0 : size.y + 0.02;                          // 'down': arrow tip just above the top (it bobs up 5 cm)
      const g = new Marker({ mode: floating ? 'forward' : 'down', radius, height, gap: 0.03 });
      g.arrow.scale.setScalar(0.32);                                         // an ~11 cm arrow instead of the demo's 34 cm
      g.traverse(o => { if (o.isMesh) { o.material.toneMapped = false; o.renderOrder = 5; } });
      this.scene.add(g);
      // anchor: footprint centre on the bottom (down) or the middle (forward), kept relative to the object as it moves
      const anchor = floating ? center : V(center.x, box.isEmpty() ? center.y : box.min.y + 0.012, center.z);   // +1 cm: rounded models dip into the desk
      return { obj: g, target, rel: anchor.sub(wp(target)), floating };
    });
  }

  // ---------------------------------------------------------------- notices (in front of the eyes, PC and VR)
  notice(title, body = '', warn = false) {
    if (!this.noticePanel) {
      this.noticePanel = new Panel({ w: 0.36, h: 0.09, px: 900, name: 'NoticePanel', draw: (g, P) => {
        const st = P.state; if (!st.title) return;
        P.round(6, 6, P.W - 12, P.H - 12, 30); g.fillStyle = st.warn ? 'rgba(150,28,28,.92)' : 'rgba(20,14,10,.85)'; g.fill();
        g.lineWidth = 5; g.strokeStyle = st.warn ? '#ffb3a8' : '#e0a05a'; g.stroke();
        P.text(st.title, P.W / 2, st.body ? 30 : P.H / 2 - 26, { size: 42, weight: 700, color: '#fff', align: 'center' });
        if (st.body) P.text(st.body, P.W / 2, 92, { size: 28, color: '#ffe9e2', align: 'center' });
      } });
      this.noticePanel.mesh.renderOrder = 10; this.noticePanel.mesh.material.depthTest = false; this.scene.add(this.noticePanel.mesh);
    }
    this.noticePanel.set({ title, body, warn }); this.noticeT = warn ? 2.6 : 1.8;
  }
  warn(title, body) { this.sfx('wrong'); if (this.renderer.xr.isPresenting) this.notice(title, body, true); else this.domWarn(title, body); }   // VR: card in front of the eyes, PC: red card on screen
  warnWrong(id) {           // a wrong ingredient at the mortar: the same red card every time (PC: on screen, VR: in front of the eyes)
    if (performance.now() - (this.wrongAt || 0) < 900) return; this.wrongAt = performance.now();   // pouring calls this every second
    this.warn('맞지 않는 재료입니다.', ING[id] ? `${ING[id].name}${josa(ING[id].name, '은', '는')} 이번 레시피에 들어가지 않아요` : '');
  }
  domWarn(title, body = '') {
    let el = document.getElementById('warnCard');
    if (!el) {
      el = document.createElement('div'); el.id = 'warnCard';
      el.style.cssText = 'position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);z-index:25;min-width:min(340px,86vw);max-width:90vw;padding:16px 22px;border-radius:14px;' +
        'background:rgba(150,28,28,.94);border:2px solid #ffb3a8;color:#fff;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s;box-shadow:0 8px 30px rgba(0,0,0,.45)';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div style="font-size:20px;font-weight:700"></div><div style="font-size:14px;margin-top:6px;color:#ffe9e2"></div>';
    el.children[0].textContent = title; el.children[1].textContent = body; el.children[1].style.display = body ? '' : 'none';
    el.style.opacity = '1'; clearTimeout(this.domWarnT); this.domWarnT = setTimeout(() => { el.style.opacity = '0'; }, 2400);
  }
  updateNotice(dt) {
    const m = this.noticePanel?.mesh; if (!m) return;
    this.noticeT = Math.max(0, (this.noticeT || 0) - dt); m.visible = this.noticeT > 0;
    if (!m.visible) return;
    const v = this.viewFrame(); m.position.copy(v.head).addScaledVector(v.f, 0.5).addScaledVector(v.u, -0.06); m.quaternion.copy(v.q);
    m.material.opacity = Math.min(1, this.noticeT * 3); m.material.transparent = true;
  }

  // ---------------------------------------------------------------- hints
  setHint(title, body) {          // no explanation UI on screen any more: the step title only picks the hand-motion guide
    this.hintTitle = title; this.hintBody = body;
    this.setGuide(guideFor(title));
    if (this.hintEl) this.hintEl.style.display = 'none';
  }

  // hand-motion guide (rush-xr-ui GuidePanel): a chalkboard with two hands looping the motion for the current step.
  // It hangs low on the right of the view (VR and PC) and hides when the step needs no special motion.
  setGuide(name) {
    if (!this.guide) {
      const g = this.guide = new GuidePanel();
      for (const l of g.children.filter(o => o.isLight)) g.remove(l);        // the kit lights its demo; our room has its own lights
      g.traverse(o => { if (o.isMesh || o.isLineSegments) o.renderOrder = 12; });
      g.visible = false; this.scene.add(g);
    }
    const g = this.guide;
    if (!name) { g.visible = false; this.guideName = null; return; }
    if (name !== this.guideName) { this.guideName = name; g.play(name); g.userData.placed = false; }
    g.visible = true;
  }
  // the thing the current motion is done with: the next bottle (or the mortar while a bottle is in hand), the next drawer,
  // the pestle (the mortar once it is in hand), the mold
  guideTarget() {
    const n = this.guideName, next = this.nextNeeded();
    if (n === 'pour') { const held = Object.values(this.bottles).find(b => this.held(b)); return held ? this.mortar : (ING[next]?.location === 'shelf' ? this.bottles[next] : null); }
    if (n === 'grab') { const d = this.drawers.find(d => d.id === next); return d ? (d.ds?.parts?.find(p => /^Drawer_Knob/.test(p.o.name))?.o || d.tag) : null; }
    if (n === 'pound') return this.held(this.pestle) ? this.mortar : this.pestle;
    if (n === 'press') return this.mold;
    return null;
  }
  updateGuide(dt) {
    const g = this.guide; if (!g?.visible) return;
    g.update(dt);
    const S = 0.6; g.scale.setScalar(S);
    const t = this.guideTarget(); if (!t || !t.parent) { g.children.forEach(c => c.visible = false); return; }
    g.children.forEach(c => c.visible = true);
    // over the target: clear of its top and of the marker arrow bobbing above it
    const box = new THREE.Box3().setFromObject(t), c = box.getCenter(V());
    const target = V(c.x, box.max.y + 0.2 + 0.27 * S / 2, c.z);
    if (!g.userData.placed || g.position.distanceTo(target) > 0.6) { g.userData.placed = true; g.position.copy(target); }
    g.position.lerp(target, 1 - Math.exp(-dt * 5));
    const head = this.headPos(); g.lookAt(head.x, g.position.y + (head.y - g.position.y) * 0.5, head.z);
  }

  // ================================================================ 00 opening: Nicolas opens the door, walks in, waves and talks
  // Santa is modules/santa.js (window.createSanta). The door is the room's 'DoorLeaf' node (index.html passes it as ctx.door).
  setupSanta() {
    if (this.santa || !window.createSanta) return;
    const S = this.santa = window.createSanta(THREE, { scale: 1.1 });       // ~1.62 m with the hat: fits under the 1.74 m door
    S.object.visible = false; this.scene.add(S.object);
    const floorY = (x, z) => {                                               // floor height under a point (room + snow outside)
      const r = new THREE.Raycaster(V(x, 1.5, z), V(0, -1, 0), 0, 2.5);
      const h = r.intersectObject(this.root || this.scene, true).find(h => h.object.visible && !h.object.isPoints);
      return h ? h.point.y : 0;
    };
    // door frame from the closed leaf: hinge = leaf origin, the thin axis of its box is the wall normal, inside = toward the player
    const stand = L.stand.clone(), door = this.door;
    let hinge, centre, n, openAngle = 1.45;
    if (door) {
      door.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(door), size = b.getSize(V());
      hinge = wp(door); centre = b.getCenter(V()); centre.y = 0;
      n = size.x < size.z ? V(Math.sign(stand.x - centre.x) || 1, 0, 0) : V(0, 0, Math.sign(stand.z - centre.z) || 1);
      const free = centre.clone().sub(V(hinge.x, 0, hinge.z));               // hinge -> free edge
      const turned = free.clone().applyAxisAngle(V(0, 1, 0), openAngle);
      if (turned.dot(n) < 0) openAngle = -openAngle;                          // swing into the room
      this.doorQ0 = door.quaternion.clone();
    } else { centre = V(-1.17, 0, -1.47); n = V(1, 0, 0); }
    this.doorOpen = openAngle;
    const at = (v) => v.setY(floorY(v.x, v.z));
    const out = at(centre.clone().addScaledVector(n, -0.9));
    this.santaPath = {
      start: out,
      via: [at(centre.clone().addScaledVector(n, -0.25)), at(centre.clone().addScaledVector(n, 0.45))],
      stop: at(L.santa.clone()),
      doorLook: centre.clone().setY(1.25)
    };
    S.object.position.copy(out); S.object.rotation.y = Math.atan2(n.x, n.z);
  }
  // sounds (a manifest file wins; otherwise a tiny synthesized one)
  tone(f, d, type = 'sine', v = 0.15, glide = 0) {
    try {
      const ac = this.actx ||= new AudioContext(); if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
    } catch (e) { /* no audio */ }
  }
  knock() { if (this.sfx('knock')) return; this.tone(140, 0.12, 'triangle', 0.4); setTimeout(() => this.tone(140, 0.12, 'triangle', 0.4), 180); setTimeout(() => this.tone(150, 0.12, 'triangle', 0.4), 520); }
  creak() { if (this.sfx('door')) return; this.tone(180, 0.9, 'sawtooth', 0.025, 1.6); }

  begin() {
    if (this.s.step !== 'dark') return;
    this.s.step = 'intro'; this.setHint('', '');
    this.setupSanta();
    if (this.renderer.xr.isPresenting) this.toast('손이 닿지 않는 것은 손으로 가리킨 뒤 집으면 돼요');
    if (!this.bgm) this.bgm = this.sfx('bgm', { loop: true, volume: 0.5 });
    this.later(1.0, () => this.sfx('fire'));
    this.fire?.setLevel(0.12);
    this.later(1.0, () => { this.tween(1.6, k => this.fire?.setLevel(0.12 + 0.88 * ease.out(k))); this.fx.emit(L.chimney, { color: '#ffb35a', count: 50, speed: 0.6, gravity: -0.4, life: 1.0 }); });
    const P = this.santaPath;
    if (!this.santa || !P) { this.later(1.0, () => this.showEmotionBook()); return; }      // no santa.js: straight to the book
    // no automatic camera here: the player turns to the door (and to Nicolas) themselves, on PC and in VR
    this.later(1.4, () => { this.knock(); this.setHint('똑똑, 누가 왔나 봐요', this.renderer.xr.isPresenting ? '오른쪽 앞의 문을 봐주세요.' : '오른쪽 앞의 문을 봐주세요. (오른쪽 버튼을 누른 채 끌어서 둘러보기)'); });
    this.later(2.6, () => this.openDoor());
  }
  openDoor() {
    const S = this.santa, P = this.santaPath, d = this.door;
    S.object.visible = true; this.creak();
    if (d) { const q0 = this.doorQ0, q1 = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), this.doorOpen));
      this.tween(1.3, k => d.quaternion.slerpQuaternions(q0, q1, ease.inOut(k))); }
    this.later(0.8, () => {
      this.setHint('산타마을 촌장 니콜라스', '');
      this.santaWalking = true;
      S.walkTo(P.via[1], { via: P.via[0], speed: 0.6 })                  // through the door (curved path via the threshold)
        .then(() => S.walkTo(P.stop, { speed: 0.6 }))
        .then(() => { this.santaWalking = false; this.closeDoor(); return S.turnTo(this.headPos(), 0.7); })
        .then(() => this.startTalk());
    });
  }
  closeDoor() {
    const d = this.door; if (!d) return;
    const q0 = d.quaternion.clone(); this.tween(1.1, k => d.quaternion.slerpQuaternions(q0, this.doorQ0, ease.inOut(k)), () => this.tone(110, 0.15, 'triangle', 0.3));
  }
  startTalk() {
    const S = this.santa;
    const panel = PH.talkPanel();
    this.scene.add(panel.mesh); this.panels.push(panel);
    this.talk = { panel, i: 0, said: -1, t0: performance.now() / 1000 };
    // the voice: its clock drives the lines (falls back to a plain clock with the same cues if it can't play)
    const file = this.manifest?.sounds?.voice || OPENING.voice;
    if (file && OPENING.cues?.length) {
      try { const a = this.talk.voice = new Audio(file); a.volume = 1; a.play().catch(() => { this.talk && (this.talk.voice = null); }); }
      catch (e) { this.talk.voice = null; }
    }
    S.setExpression('happy'); S.wave(true);
    this.setHint('니콜라스의 인사', this.renderer.xr.isPresenting ? '트리거를 당기거나 엄지와 검지로 집으면 다음 대사로 넘어가요.' : '클릭하거나 Space를 누르면 다음 대사로 넘어가요.');
  }
  advanceTalk() {
    const T = this.talk; if (!T || this.s.step !== 'intro') return;
    const now = performance.now(); if (now - (this.talkAt || 0) < 250) return; this.talkAt = now;   // one pinch can arrive as a click and a select
    const B = T.panel.board;
    if (!B.done) { B.skip(); return; }                                       // first press: finish typing the line
    this.sfx('click');
    T.i++;
    const cue = OPENING.cues?.[T.i];                                          // skipping ahead: the voice jumps to that line too
    if (cue) { if (T.voice) T.voice.currentTime = cue[0]; else T.t0 = performance.now() / 1000 - cue[0]; }
    else if (T.voice) T.voice.pause();
    if (T.i === 1) this.santa.wave(false);                                    // waves on the greeting only
    if (T.i >= OPENING.lines.length) this.endTalk();
  }
  endTalk() {
    const T = this.talk; if (!T) return; this.talk = null;
    T.voice?.pause();
    this.panels = this.panels.filter(p => p !== T.panel);
    const m = T.panel.mesh, s0 = m.scale.clone();
    this.tween(0.35, k => m.scale.set(s0.x, s0.y * Math.max(0.05, 1 - k), s0.z), () => m.removeFromParent());
    this.santa.talk(false); this.santa.wave(false); this.santa.setExpression('happy');
    this.camLook = null;                                                     // the view stays where the player left it
    this.later(0.6, () => this.showEmotionBook());
    // he stays right where he greeted you (across the desk) and keeps watching you work
  }
  updateSanta(dt) {
    const S = this.santa; if (!S) return;
    const head = this.headPos(), T = this.talk;
    // PC: the view follows the opening (door, then Nicolas); in VR the player turns their own head
    if (this.camLook && this.view && !this.renderer.xr.isPresenting) {
      const o = S.object.position, look = !S.object.visible ? this.camLook : o.clone().setY(o.y + (T ? 1.5 : this.santaWalking ? 1.2 : 1.3));
      const c = wp(this.camera), d = look.sub(c);
      const yaw = Math.atan2(-d.x, -d.z), pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.4);
      const [y0, p0] = this.view.get(), a = 1 - Math.exp(-dt * 2.5);
      this.view.set(y0 + Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0)) * a, p0 + (pitch - p0) * a);
    }
    if (!S.object.visible) return;
    if (T) {
      const B = T.panel.board;
      const cues = OPENING.cues;
      if (cues?.length) {                                                    // voiced: the recording sets the pace
        const now = performance.now() / 1000;
        if (T.voice?.ended) T.endT ??= now;                                  // after the recording ends its clock stops: keep counting
        const vt = !T.voice ? now - T.t0 : T.voice.ended ? T.voice.duration + now - T.endT : T.voice.currentTime;
        while (T.i < cues.length - 1 && vt >= cues[T.i + 1][0]) { T.i++; if (T.i === 1) S.wave(false); }
        const cue = cues[T.i];
        S.talk(!!cue && vt >= cue[0] && vt < cue[1], { voice: !!T.voice });  // mouth moves while he speaks (no blips over the voice)
        if (T.i === cues.length - 1 && vt >= cue[1] + (OPENING.hold ?? 1) && !T.closing) { T.closing = true; this.later(0, () => this.endTalk()); }
      }
      if (T.said !== T.i) { T.said = T.i; B.say(OPENING.lines[T.i] || ''); }
      B.update(dt);
      if (!cues?.length) S.talk(!B.done);                                    // no voice: santa.js makes the talking blips itself
      const m = T.panel.mesh, p = S.object.position;
      // beside his face, on the player's right: the board's near edge just clears his head (head radius ~0.25 m)
      const face = S.parts?.head ? wp(S.parts.head) : V(p.x, p.y + 1.6, p.z);
      const toHead = V(head.x - face.x, 0, head.z - face.z).normalize();
      const right = V(toHead.z, 0, -toHead.x);                               // the player's right, seen from the player
      const half = T.panel.w * m.scale.x / 2;
      m.position.copy(face).addScaledVector(right, 0.28 + half).addScaledVector(toHead, 0.15);
      m.lookAt(head);
    }
    // head follows the player once he is inside (during the walk he looks where he goes)
    S.update(dt, this.santaWalking ? null : head);
  }

  // ================================================================ 01–02 recipe book
  // The LUSH recipe book replaces the placeholder (cover + canvas pages) inside this.book, so the book still lies on the
  // desk, rises in front of you when Nicolas is done and goes back to the desk when gathering starts, exactly as before.
  async loadRecipeBook() {
    try {
      // The module reads its page images back from a canvas. When a host serves those files from another origin
      // (raw.githack.com redirects big files to raw.githubusercontent.com) the canvas would be tainted and the book
      // fails to build. So its images are requested with CORS (both hosts allow it); the module itself is untouched.
      if (!HTMLImageElement.prototype.__rbCors) {
        const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); },
          set(v) { if (typeof v === 'string' && v.includes('recipe-book/assets/') && !this.crossOrigin) this.crossOrigin = 'anonymous'; d.set.call(this, v); } });
        HTMLImageElement.prototype.__rbCors = true;
      }
      const rb = await createRecipeBook({ renderer: this.renderer, assetsUrl: 'modules/recipe-book/assets/' });
      this.rb = rb;
      rb.object.scale.setScalar(RB_SCALE);
      if (this.garden) this.garden.blockers = this.garden.blockers.filter(b => b !== this.pages.mesh);
      this.book.add(rb.object);
      rb.on('change', (st) => this.onBookChange(st));
      if (['emotion', 'recipe'].includes(this.s.step)) rb.openInstant();     // loaded late: catch up
      else { this.seatBook(); this.book.position.copy(this.bookHome.pos); }   // lying on the desk: its low edge on the top
    } catch (e) {                                                            // never the placeholder book: try again
      console.warn('recipe book module:', e);
      this.rbTries = (this.rbTries || 0) + 1;
      if (this.rbTries < 5) setTimeout(() => this.loadRecipeBook(), 2000);
      else { this.rbFailed = true; this.warn('레시피북을 불러오지 못했어요', '인터넷 연결을 확인하고 페이지를 새로고침해주세요.'); }
    }
  }
  // the tilted book on the desk: lift its home so the lowest edge of what it shows now (closed or open) rests on the desk top
  seatBook() {
    const b = this.book, hm = this.bookHome, p = b.position.clone(), q = b.quaternion.clone(), sc = b.scale.clone();
    b.position.copy(hm.pos); b.quaternion.copy(hm.quat); b.scale.copy(hm.scale); b.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.rb?.object || b);
    if (!box.isEmpty()) hm.pos.y += DESK_Y + 0.004 - box.min.y;
    b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); b.updateMatrixWorld(true);
  }
  bookNormal() { return V(0, 1, 0).applyQuaternion(this.book.getWorldQuaternion(new THREE.Quaternion())); }
  // a fingertip (VR) on the emotion page: a short ray from just above the tip down onto the page
  touchBook(p) {
    const n = this.bookNormal(), ray = new THREE.Raycaster(p.clone().addScaledVector(n, 0.012), n.negate(), 0, 0.024);
    if (this.rb.pickFromRay(ray)) this.sfx('click');
  }
  onBookChange(st) {
    // an emotion was picked, marked and the page flipped to its recipe: that is the old "choose" + "recipe" step
    if (this.s.step === 'emotion' && st.state === 'open' && st.page === 'recipe' && RB_RECIPE[st.recipe]) {
      const e = EMOTIONS.find(x => x.recipe === RB_RECIPE[st.recipe]); if (e) this.chooseEmotion(e.id);
    }
  }
  syncBookQuests() {         // strike the book's ingredients as they go into the mortar (the book strikes them in its own order)
    const rb = this.rb, r = this.s.recipe; if (!rb || !r || ['emotion', 'recipe'].includes(this.s.step)) return;
    const sn = rb.snapshot; if (sn.state !== 'open' || sn.page !== 'recipe') return;
    const want = Math.min(sn.questTotal ?? 5, this.needed().filter(id => this.s.done.has(id)).length);
    if (sn.questDone < want && performance.now() - (this.rbQuestAt || 0) > 900) { this.rbQuestAt = performance.now(); rb.completeIngredient(); }
  }
  showEmotionBook() {
    // the LUSH book (GLB models + page images, ~10 MB) can still be downloading on a slow connection: wait for it instead of
    // showing anything else (the placeholder book is never shown; if the module fails, the hint says so)
    if (!this.rb) {
      if (!this.rbFailed && !this.rbWait) { this.rbWait = true; this.setHint('레시피북을 펼치는 중…', '책을 불러오고 있어요. 잠시만 기다려주세요.'); }
      if (!this.rbFailed) this.later(0.5, () => this.showEmotionBook());
      return;
    }
    this.s.step = 'emotion';
    this.pages.set({ view: 'choose', selected: null });
    this.scene.attach(this.book);
    const s0 = this.book.scale.x; this.tween(1.0, k => this.book.scale.setScalar(s0 + (1.0 - s0) * k));
    this.follow(this.book, { dist: 0.44, yOff: -0.11, speed: 6, tiltBook: true });
    this.rb?.open();                                                          // the book's own opening animation
    this.fx.emit(wp(this.book), { color: '#ffe28a', count: 40, speed: 0.5, life: 1 });
    this.setHint('01 마음 고르기', '테이블의 레시피북이 떠올랐어요. 첫 장에서 전하고 싶은 마음을 손가락으로 눌러 골라주세요. (PC: 클릭)');
  }
  press(panel, id) {
    this.sfx('click');
    if (panel === this.pages) {
      if (this.s.step === 'emotion' && EMOTIONS.some(e => e.id === id)) return this.chooseEmotion(id);
      if (id === 'begin' && this.s.step === 'recipe') return this.beginGather();
      if (id === 'back' && this.s.step === 'recipe') { this.s.step = 'emotion'; this.pages.set({ view: 'choose', selected: null }); this.setHint('01 마음 고르기', '전하고 싶은 마음을 다시 골라주세요.'); }
    }
    if (panel === this.talk?.panel && id === 'next') return this.advanceTalk();
    if (panel && panel === this.restartPanel && id === 'restart') location.reload();
  }
  chooseEmotion(id) {
    const e = EMOTIONS.find(x => x.id === id);
    this.s.emotion = e; this.s.recipeId = e.recipe; this.s.recipe = RECIPES[e.recipe]; this.s.step = 'recipe';
    this.pages.set({ selected: id });
    this.fx.emit(wp(this.book), { color: e.color, count: 30, speed: 0.35, life: 0.8 });
    if (this.rb) {                                                           // the book shows the recipe itself; then it goes back to the desk
      this.setHint('02 레시피 확인', `'${e.label}'${josa(e.label, '을', '를')} 담은 배쓰밤 레시피예요. 재료를 확인해주세요. 잠시 뒤 책이 작업대로 내려가고 재료 모으기가 시작돼요.`);
      this.later(4.5, () => { if (this.s.step === 'recipe') this.beginGather(); });
      return;
    }
    this.later(0.6, () => { this.pages.set({ view: 'recipe' }); this.setHint('02 레시피 확인', `'${e.label}'${josa(e.label, '을', '를')} 담은 배쓰밤 레시피예요. 재료를 확인하고 오른쪽 페이지의 '제작 시작'을 눌러주세요.`); });
  }
  beginGather() {
    this.s.step = 'base';
    this.unfollow(this.book);
    this.seatBook();                                                         // the open spread is wider: rest it on its low edge
    const hm = this.bookHome, p0 = this.book.position.clone(), q0 = this.book.quaternion.clone(), s0 = this.book.scale.clone();
    this.tween(1.2, k => { const e = ease.inOut(k); this.book.position.lerpVectors(p0, hm.pos, e); this.book.quaternion.slerpQuaternions(q0, hm.quat, e); this.book.scale.lerpVectors(s0, hm.scale, e); });
    this.pages.set({ view: 'work' });
    this.makeMold();
    this.setHint('03 재료 수집 · 공통 베이스', '작업대 오른쪽의 요정설탕과 별가루 병을 들고, 절구 위에서 병을 기울여 쏟아 넣어주세요. (PC: 병을 클릭한 채 절구 위로 끌어가 R 키를 누른 채 기울이기)');
    this.setMarkers([this.bottles[this.nextNeeded()]]);                     // one at a time, in recipe order
  }
  needed() { const r = this.s.recipe; return r ? [...BASE, ...r.naturals] : []; }
  nextNeeded() { return this.needed().find(id => !this.s.done.has(id)); }

  drawBook(g, P) {
    const st = P.state, W = P.W, H = P.H, half = W / 2;
    if (!P.bg) { g.fillStyle = INK.paper; g.fillRect(0, 0, W, H); }
    const grad = g.createLinearGradient(half - 60, 0, half + 60, 0); grad.addColorStop(0, 'rgba(120,84,50,0)'); grad.addColorStop(0.5, 'rgba(120,84,50,.35)'); grad.addColorStop(1, 'rgba(120,84,50,0)');
    g.fillStyle = grad; g.fillRect(half - 60, 0, 120, H);
    if (!st.view) { P.text('LUSH SANTA', half / 2, H / 2 - 60, { size: 56, weight: 700, color: INK.red, align: 'center' }); P.text('산타의 레시피북', half / 2, H / 2 + 10, { size: 44, align: 'center' }); P.text('니콜라스의 인사가 끝나면 열려요', half + half / 2, H / 2 - 20, { size: 30, color: INK.sub, align: 'center' }); return; }
    if (st.view === 'choose') {
      P.text('LUSH SANTA · 산타의 레시피북', half / 2, 40, { size: 26, weight: 700, color: INK.red, align: 'center' });
      P.text('누구에게 어떤 마음을', half / 2, 90, { size: 42, weight: 700, align: 'center' });
      P.text('전하고 싶나요?', half / 2, 145, { size: 42, weight: 700, align: 'center' });
      P.text('마음을 하나 골라 손가락으로 눌러주세요', half + half / 2, 40, { size: 26, color: INK.sub, align: 'center' });
      EMOTIONS.forEach((e, i) => {
        const col = i < 3 ? 0 : 1, row = i % 3, x = col * half + 50, y = (col ? 110 : 230) + row * 150;
        P.button(e.id, x, y, half - 100, 128, e.label, { color: st.selected === e.id ? '#2b2b2b' : e.color, size: 38, sub: e.sub });
      });
      return;
    }
    const r = this.s.recipe, e = this.s.emotion; if (!r) return;
    // left page: the recipe
    P.text(`'${e.label}' 레시피`, 50, 34, { size: 30, weight: 700, color: e.color });
    const revealed = this.s.revealed;
    P.text(revealed ? `${r.name} · ${r.moldName}` : '이름 · 모양: ? ? ?  (틀을 열면 공개)', 50, 80, { size: revealed ? 40 : 30, weight: 700, color: revealed ? INK.green : INK.sub });
    let y = 150;
    P.text('① 공통 베이스 (가장 먼저)', 50, y, { size: 28, weight: 700, color: INK.red }); y += 44;
    const row = (id, locked) => {
      const it = ING[id], done = this.s.done.has(id), next = this.nextNeeded() === id && st.view === 'work';
      if (next) { P.round(30, y - 8, half - 80, 86, 16); g.fillStyle = '#fff0c4'; g.fill(); }
      const c = done ? INK.green : locked ? '#b9aa9b' : INK.ink;
      P.text(done ? '✓' : locked ? '·' : '○', 50, y, { size: 34, weight: 700, color: c });
      P.text(it.name + (it.real ? ` (${it.real})` : ''), 96, y, { size: 34, weight: 700, color: c });
      P.text(`${LOC[it.location]} · ${ACT[it.action]}${locked && !done ? ' · 잠김' : ''}`, 96, y + 42, { size: 24, color: done ? INK.green : INK.sub });
      y += 92;
    };
    BASE.forEach(id => row(id, false));
    y += 8; P.text('② 자연재료', 50, y, { size: 28, weight: 700, color: INK.red }); y += 44;
    const baseDone = BASE.every(id => this.s.done.has(id));
    r.naturals.forEach(id => row(id, !baseDone));
    // right page
    const x0 = half + 50;
    if (st.view === 'recipe') {
      P.text('재료를 확인했나요?', half + half / 2, 120, { size: 40, weight: 700, align: 'center' });
      P.text('준비가 되면 아래 버튼을 눌러', half + half / 2, 190, { size: 28, color: INK.sub, align: 'center' });
      P.text('재료를 모으러 가요.', half + half / 2, 230, { size: 28, color: INK.sub, align: 'center' });
      P.button('begin', half + 90, H - 260, half - 180, 110, '제작 시작', { color: INK.green, size: 44 });
      P.button('back', half + 160, H - 120, half - 320, 70, '다른 마음 고르기', { color: '#8a6f5e', size: 26 });
    } else {
      P.text('지금 할 일', x0, 50, { size: 30, weight: 700, color: INK.red });
      P.text(this.hintTitle || '', x0, 100, { size: 34, weight: 700, maxW: half - 100 });
      P.text(this.hintBody || '', x0, 160, { size: 26, color: INK.sub, maxW: half - 100, lineH: 36 });
      const left = this.needed().filter(id => !this.s.done.has(id)).length;
      P.text(left ? `남은 재료 ${left}개` : '재료 준비 완료 ✓', x0, H - 160, { size: 32, weight: 700, color: left ? INK.ink : INK.green });
      if (this.s.step === 'pound' || this.s.pounds) P.text(`빻기 ${this.s.pounds} / ${POUNDS}`, x0, H - 100, { size: 30, color: INK.sub });
    }
  }

  // ================================================================ 03–04 ingredients
  canAdd(id) {
    const st = this.s.step;
    if (!this.needed().includes(id)) { this.warnWrong(id); return false; }
    if (this.s.done.has(id)) { this.toast(`${ING[id].name}${josa(ING[id].name, '은', '는')} 이미 넣었어요`); return false; }
    if (!ING[id].base && !BASE.every(b => this.s.done.has(b))) { this.toast('먼저 공통 베이스(요정설탕, 별가루)를 넣어주세요'); return false; }
    if (!['base', 'naturals'].includes(st)) return false;
    return true;
  }
  addToMortar(obj, id, absorb = true) {
    if (!this.canAdd(id)) return false;
    this.s.done.add(id); this.sfx(ING[id].action === 'pour' ? 'pour' : 'add');
    const c = this.zonePoint(this.zones.mortar);
    { const a = ING[id].action; (a === 'cutSqueeze' ? Foley.squish : ['leaves', 'petals', 'tear'].includes(a) ? Foley.rustle : Foley.powder)(c); }
    this.later(0.25, () => Foley.chime(c));                                  // 뾰로로옹: it is in
    this.fx.emit(c, { color: ING[id].color, count: 30, speed: 0.25, gravity: 0.6, life: 0.7 });
    if (obj && absorb) this.absorb(obj, c);
    this.updateContents();
    this.toast(`${ING[id].name} 넣기 완료`);
    if (this.s.step === 'base' && BASE.every(b => this.s.done.has(b))) this.toNaturals();
    else if (this.s.step === 'naturals' && this.needed().every(x => this.s.done.has(x))) this.later(0.8, () => this.toPound());
    else if (this.s.step === 'naturals') this.naturalsHint();
    else if (this.s.step === 'base') this.setMarkers([this.bottles[this.nextNeeded()]]);
    this.pages.redraw();
    return true;
  }
  absorb(obj, c) {
    this.forceRelease(obj); this.ungrab(obj);
    const p0 = wp(obj), s0 = obj.scale.clone();
    this.tween(0.45, k => { obj.position.copy(this.group.worldToLocal(p0.clone().lerp(c, k).add(V(0, Math.sin(k * Math.PI) * 0.04, 0)))); obj.scale.copy(s0).multiplyScalar(1 - k * 0.85); }, () => obj.removeFromParent(), obj);
  }
  updateContents() {
    const ids = [...this.s.done]; if (!ids.length) return;
    const col = new THREE.Color(0, 0, 0); ids.forEach(id => col.add(new THREE.Color(ING[id].color))); col.multiplyScalar(1 / ids.length);
    this.contents.material.color.copy(col); this.contents.visible = true;
    this.contents.position.y = 0.02 + Math.min(ids.length, 5) * 0.006;
    const s = 0.75 + Math.min(ids.length, 5) * 0.05; this.contents.scale.set(s, 1, s);
  }
  toNaturals() {
    this.s.step = 'naturals';
    this.toast('자연재료 수집이 열렸어요!');
    this.naturalsHint();
  }
  naturalsHint() {
    const left = this.s.recipe.naturals.filter(id => !this.s.done.has(id));
    const lines = left.map(id => `${ING[id].name}(${LOC[ING[id].location]})`).join(', ');
    this.setHint('03~04 자연재료 수집 · 손질', `레시피북을 보며 ${lines}${josa(lines, '을', '를')} 모아 손질한 뒤 절구에 넣어주세요.${left.some(id => ING[id].location === 'drawer') ? ' 서랍은 멀리 있으니 손으로 가리킨 뒤 집으면 열려요 (PC: 클릭).' : ''}`);
    const next = this.nextNeeded();
    this.setMarkers([next && this.locationTarget(next)]);                     // only the next ingredient of the recipe
    // motion guide for that ingredient: a drawer one -> pull the drawer (grab), a bottle one -> pour
    const loc = ING[next]?.location;
    this.setGuide(loc === 'drawer' ? 'grab' : loc === 'shelf' ? 'pour' : null);
    this.pages.redraw();
  }
  locationTarget(id) {
    const loc = ING[id].location;
    if (loc === 'shelf') return this.bottles[id];
    if (loc === 'basket') return this.fruits[id] || this.basket;
    if (loc === 'pot') { const p = this.garden?.plants.find(p => p.herb === id); return p ? { obj: p.mesh, off: V(0, 0.08, 0) } : null; }
    if (loc === 'drawer') { const d = this.drawers.find(d => d.id === id); return d ? { obj: d.tag, mode: 'forward' } : null; }
  }

  onHerbDrop(it) {      // a picked leaf/petal let go: into the mortar?
    const byMouse = this.garden.mouse && this.garden.mouse.held === it;
    const z = this.zones.mortar, c = this.zonePoint(z), p = it.mesh.position;
    let over;
    if (byMouse) { const ray = this.mouseRay(); over = ray && ray.distanceToPoint(c) < z.r * 1.25; }
    else over = Math.hypot(p.x - c.x, p.z - c.z) < z.r && p.y > c.y - 0.04 && p.y < c.y + 0.4;
    if (!over) return false;
    if (!this.canAdd(it.herb)) return false;
    this.garden.items.splice(this.garden.items.indexOf(it), 1);
    const p0 = p.clone();
    this.tween(0.4, k => { it.mesh.position.copy(p0.clone().lerp(c, k)); it.mesh.scale.setScalar(1 - k * 0.8); }, () => it.mesh.removeFromParent());
    this.addToMortar(null, it.herb);                                         // (its rustle plays in addToMortar)
    return true;
  }

  // drawers
  toggleDrawer(d) {
    if (d.busy) return; d.busy = true; setTimeout(() => d.busy = false, 500);
    d.open = !d.open;
    if (d.ds) { const from = d.ds.t, to = d.open ? 1 : 0; d.ds.shut = false; this.tween(0.4, k => { d.ds.t = from + (to - from) * ease.inOut(k); }); }
    else {
      const from = d.obj.position.clone(), to = d.open ? d.p0.clone().add(d.delta) : d.p0.clone();
      this.tween(0.4, k => d.obj.position.lerpVectors(from, to, ease.inOut(k)));
    }
    if (d.open && !(d.item && d.item.parent)) this.later(0.35, () => this.spawnDrawerItem(d));   // free play: an empty drawer always has one more (also after the making steps)
  }
  spawnDrawerItem(d) {
    const id = d.id, it = this.make('ing_' + id, () => PH.stick(id));
    const p = d.c.clone().add(V(0.17, 0.03, 0));    // CONVEYOR: out of the front of the cabinet, which faces the player (+x)
    it.position.copy(this.group.worldToLocal(p.clone())); this.group.add(it);
    it.userData.ing = id; d.item = it;
    if (ING[id].action === 'break' || ING[id].action === 'tear') it.userData.breakable = true;
    this.grab(it, { modes: ['pinch', 'fist'], reach: 0.05 });
    this.fx.emit(p, { color: ING[id].color, count: 20, speed: 0.2, life: 0.6 });
    // the drawers are out of arm's reach: the ingredient flies over to float in front of the player
    const n = this.drawers.filter(x => x.item && x !== d).length, out = L.drawerOut.clone().add(V(0.07 * n, 0, 0));
    it.userData.home.pos = out.clone();
    this.tweenTo(it, out, null, 0.9, () => { if (!it.userData.holder) this.restBelow(it); });
    this.toast(`${ING[id].name}${josa(ING[id].name, '이', '가')} 나왔어요 · ${ACT[ING[id].action]}`);
  }

  // break / tear (two hands in XR, Space on PC)
  breakItem(o) {
    if (o.userData.broken) return; o.userData.broken = true; this.sfx('break');
    (ING[o.userData.ing]?.action === 'tear' ? Foley.tear : Foley.snap).call(Foley, wp(o));
    const id = o.userData.ing, pieces = this.make('pieces_' + id, () => PH.pieces(id));
    const p = wp(o); pieces.position.copy(this.group.worldToLocal(p.clone())); this.group.add(pieces);
    pieces.userData.ing = id; pieces.userData.squeeze = true;   // "Space over the mortar" also drops them in
    this.grab(pieces, { modes: ['pinch', 'fist'], reach: 0.05 });
    pieces.userData.home = { pos: p.clone(), quat: new THREE.Quaternion() };
    this.handOver(o, pieces);
    this.ungrab(o); o.removeFromParent();
    const d = this.drawers.find(x => x.id === id); if (d) d.item = pieces;
    this.fx.emit(p, { color: ING[id].color, count: 24, speed: 0.3, gravity: 0.8, life: 0.6 });
    this.toast(ING[id].action === 'tear' ? '찢었어요! 절구에 넣어주세요' : '부러뜨렸어요! 절구에 넣어주세요');
    if (!pieces.userData.holder) this.restBelow(pieces);
  }

  // knife: cut what lies on the board
  tryCut() {
    const item = this.board.userData.item;
    if (!item) return this.toast('도마 위에 재료를 먼저 올려주세요');
    const id = item.userData.ing, c = wp(this.board, V(0, 0.02, 0)); this.sfx('cut');
    try { window.Audio3D?.shot('cut', c); } catch (e) {} if (ING[id].action === 'cutSqueeze') Foley.squish(c); else Foley.wood(c);
    this.fx.emit(c, { color: ING[id].color, count: 24, speed: 0.25, gravity: 0.8, life: 0.5 });
    this.ungrab(item); item.removeFromParent(); this.board.userData.item = null;
    if (item === this.fruits[id]) this.later(1.2, () => this.spawnFruit(id));
    const making = ['base', 'naturals'].includes(this.s.step);     // after the making steps cutting still works, the step hints stay put
    if (ING[id].action === 'cutSqueeze') {
      [-1, 1].forEach((sgn, i) => {
        const h = this.make('half_' + id, () => PH.fruitHalf(id));
        const p = c.clone().add(V(0, 0.002, sgn * 0.035)); h.position.copy(this.group.worldToLocal(p.clone())); this.group.add(h);
        h.userData.ing = id; h.userData.squeeze = true; h.userData.pairId = id;
        this.grab(h, { modes: ['pinch', 'fist'], reach: 0.04 });
      });
      this.toast('반으로 잘렸어요! 반쪽을 들고 절구 위에서 즙을 짜주세요');
      if (making) this.setHint('04 손질 · 즙 짜기', '자른 반쪽을 들고 절구 위에서 손을 꽉 쥐거나 놓아 즙을 짜주세요. (PC: 반쪽을 클릭한 채 절구 위로 끌어가 Space)');
    } else {
      const s = this.make('pieces_' + id, () => PH.pieces(id));
      s.position.copy(this.group.worldToLocal(c.clone())); this.group.add(s);
      s.userData.ing = id; s.userData.squeeze = true;
      this.grab(s, { modes: ['pinch', 'fist'], reach: 0.05 });
      this.toast('썰었어요! 썬 진저를 절구에 넣어주세요');
      if (making) this.setHint('04 손질 · 썰기 완료', '썰린 진저를 집어 절구에 넣어주세요.');
    }
  }

  // ================================================================ 05 pound
  toPound() {
    this.s.step = 'pound'; this.s.pounds = 0;
    this.setHint('05 빻기', `절굿공이를 들고 절구를 ${POUNDS}번 콩콩 빻아 고운 가루로 만들어주세요. (PC: 절굿공이를 클릭한 채 Space)`);
    this.setMarkers([this.pestle]); this.pages.redraw();
  }
  pound() {
    if (this.s.step !== 'pound') return this.toast('재료를 다 넣은 뒤에 빻아요');
    this.s.pounds++; this.sfx('pound'); Foley.grind(this.zonePoint(this.zones.mortar));
    const c = this.zonePoint(this.zones.mortar);
    this.fx.emit(c, { color: this.s.recipe.powder, count: 18, speed: 0.3, gravity: 0.8, life: 0.5, dir: V(0, 1, 0) });
    this.toast(`콩! ${this.s.pounds} / ${POUNDS}`);
    if (this.mouseObj === this.pestle) this.pestleDip = 1;
    this.contents.material.color.lerp(new THREE.Color(this.s.recipe.powder), 1 / (POUNDS - this.s.pounds + 1));
    this.pages.redraw();
    if (this.s.pounds >= POUNDS) {
      this.s.step = 'powder'; this.later(0.2, () => Foley.chime(c));
      this.toast('가루 완성!');
      this.setHint('가루 완성!', `${this.s.recipe.powderDesc}가 만들어졌어요.`);
      this.later(1.2, () => this.toPour());
    }
  }

  // ================================================================ 06 mold
  makeMold() {
    if (this.mold) return;
    this.mold = this.make('mold_' + this.s.recipe.shape, () => PH.mold(this.s.recipe.shape)); this.mold.position.copy(L.mold); this.group.add(this.mold);
    const tag = labelPlane('틀', 0.05); tag.position.set(0.075, 0.03, 0); tag.rotation.y = Math.PI / 2; this.mold.add(tag);
    this.zones.mold = { obj: this.mold, off: V(0, 0.03, 0), r: 0.1, hover: 0.13 };
  }
  toPour() {
    this.s.step = 'pour';
    this.setGrabEnabled(this.mortar, true); this.forceRelease(this.pestle); this.goHome(this.pestle);
    this.setHint('06 틀에 붓기', '절구를 들고 왼쪽의 틀 위에서 기울여 가루를 부어주세요. (PC: 절구를 클릭한 채 틀 위로 끌어가 R 키를 누른 채)');
    this.setMarkers([this.mortar]);
  }
  moldFilled() {
    this.s.step = 'press';
    this.forceRelease(this.mortar); this.setGrabEnabled(this.mortar, false); this.goHome(this.mortar);
    this.contents.visible = false;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(0.068, 28).rotateX(-Math.PI / 2), mat(this.s.recipe.powder, { roughness: 1 }));
    this.fill.position.y = 0.022; this.mold.add(this.fill);
    this.lid = this.make('moldLid', PH.lid); this.lid.position.copy(this.group.worldToLocal(wp(this.mold, V(0, LID_UP, 0)))); this.group.add(this.lid);
    this.lidPressT = 0;
    this.setHint('06 눌러 뭉치기', '틀 위에 손을 올리고 꾹 눌러 뚜껑을 닫아주세요. (PC: 뚜껑을 클릭하거나 Space)');
    this.setMarkers([this.lid]);
  }
  lidClick() { if (this.s.step === 'press') this.closeLid(); else if (this.s.step === 'open') this.openLid(); }
  closeLid() {
    if (this.s.step !== 'press') return;
    this.s.step = 'closing'; Foley.press(wp(this.mold));                     // 꾸욱
    const p0 = this.lid.position.clone(), p1 = this.group.worldToLocal(wp(this.mold, V(0, 0.036, 0)));
    this.tween(0.5, k => this.lid.position.lerpVectors(p0, p1, ease.inOut(k)), () => {
      this.fx.emit(wp(this.mold, V(0, 0.04, 0)), { color: '#ffffff', count: 30, speed: 0.4, life: 0.5 });
      this.s.step = 'open';
      this.grab(this.lid, { modes: ['pinch', 'fist'], reach: 0.05 });
      this.setHint('06 틀 열기', '뚜껑 손잡이를 잡고 위로 들어 올려 틀을 열어보세요. 어떤 배쓰밤일까요? (PC: 뚜껑 클릭)');
    });
  }
  openLid() {
    if (this.s.step !== 'open') return;
    this.s.step = 'reveal'; this.sfx('reveal');
    this.forceRelease(this.lid); this.ungrab(this.lid);
    const lid = this.lid, p0 = lid.position.clone(), p1 = p0.clone().add(V(0.05, 0.18, 0.1));
    this.tween(0.6, k => { lid.position.lerpVectors(p0, p1, ease.out(k)); lid.scale.setScalar(1 - k); }, () => lid.removeFromParent());
    this.fill.visible = false;
    const r = this.s.recipe;
    this.bomb = this.make('bathbomb_' + r.shape, () => PH.bathbomb(r.shape, r.powder));
    this.bomb.position.copy(this.group.worldToLocal(wp(this.mold, V(0, 0.004, 0)))); this.bomb.scale.setScalar(0.01); this.group.add(this.bomb);
    this.tween(0.7, k => this.bomb.scale.setScalar(Math.max(0.01, ease.back(k))));
    this.fx.emit(wp(this.mold, V(0, 0.05, 0)), { color: '#fff3b0', count: 60, speed: 0.5, life: 1.0 });
    this.s.revealed = true; this.pages.redraw();
    this.toast(`${r.name}!`);
    this.later(1.0, () => this.toDecor());
  }

  // ================================================================ 07 decoration
  toDecor() {
    this.s.step = 'decor';
    const d = this.s.recipe.decor;
    this.zones.bomb = { obj: this.bomb, off: V(0, 0.06, 0), r: 0.09, hover: 0.12 };
    if (d.mode === 'place') {
      this.decorObj = this.make('decor_' + this.s.recipeId, () => PH.decorPlace(d));
      this.decorObj.position.copy(this.group.worldToLocal(wp(this.mold).add(V(0.12, 0.0, 0.06)))); this.group.add(this.decorObj);
      this.grab(this.decorObj, { modes: ['pinch', 'fist'], reach: 0.04 });
      this.setHint('07 최종 장식', `${d.label}${josa(d.label, '을', '를')} 집어 배쓰밤 위에 올려주세요. (PC: 클릭한 채 배쓰밤 위로 끌어가 놓기)`);
    } else {
      this.decorObj = this.make('shaker_' + this.s.recipeId, () => PH.shaker(d));
      this.decorObj.position.copy(this.group.worldToLocal(wp(this.mold).add(V(0.12, 0.0, 0.06)))); this.group.add(this.decorObj);
      this.grab(this.decorObj, { modes: ['fist', 'pinch'], reach: 0.04 });
      this.sprinkleT = 0;
      this.setHint('07 최종 장식', `장식통을 들고 배쓰밤 위에서 기울여 ${d.label}${josa(d.label, '을', '를')} 뿌려주세요. (PC: R 키를 누른 채)`);
    }
    this.setMarkers([this.decorObj]);
  }
  decorDone() {
    this.s.step = 'decorated';
    this.forceRelease(this.decorObj); this.ungrab(this.decorObj);
    if (this.s.recipe.decor.mode === 'sprinkle') this.goHome(this.decorObj);
    this.fx.emit(wp(this.bomb, V(0, 0.05, 0)), { color: '#fff3b0', count: 50, speed: 0.4, life: 1.0 });
    this.setHint('배쓰밤 완성!', '이제 선물을 포장하러 가볼까요?');
    this.setMarkers([]);
    this.later(1.8, () => this.toWrap());
  }
  sprinkleOn(n) {
    const d = this.s.recipe.decor;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 5, 4), mat(d.color, { emissive: new THREE.Color(d.color).multiplyScalar(0.2) }));
      const a = Math.random() * 6.28, r = Math.random() * 0.03;
      s.position.set(Math.cos(a) * r, 0.04 + Math.random() * 0.04, Math.sin(a) * r);
      this.bomb.add(s);
    }
  }

  // ================================================================ conveyor: one table out to the left, the next one in from the right
  // modules/conveyor.js. Table 1 is the room's desk: when the bath bomb is done, the desk and everything still standing on it ride out.
  t1Objects() {
    const keep = new Set([this.bomb, this.hint?.mesh]);
    const onT1 = (o) => { const p = wp(o); return p.x > LANE.x0 - 0.12 && p.x < LANE.x1 + 0.06 && p.z > -0.95 && p.z < 0.9 && p.y > 0.6 && p.y < 1.6; };
    const flowObjs = this.group.children.filter(o => !keep.has(o) && o.visible !== false && onT1(o));
    const room = ['Desk', 'Cube008', 'Cube010', 'Cube023', 'Cube009', 'Cube026', 'HerbTray', 'HerbTray002', 'MugCup', 'MaterialDrawer'].map(n => this.root.getObjectByName(n));
    const loose = (this.garden?.items || []).map(it => it.mesh || it.obj).filter(o => o && o.parent && onT1(o));   // picked herbs left lying on the desk
    this.unfollow(this.book);
    return [...room, this.book, ...flowObjs, ...loose];
  }
  beltSound(dur) {
    try {
      const ac = this.actx ||= new AudioContext(); if (ac.state === 'suspended') ac.resume();
      const n = ac.sampleRate * dur, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / ac.sampleRate * 40));
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
      f.type = 'lowpass'; f.frequency.value = 220; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.8);
      g.gain.setValueAtTime(0.05, t + dur - 1); g.gain.linearRampToValueAtTime(0, t + dur);
      src.buffer = buf; src.connect(f).connect(g).connect(ac.destination); src.start(t);
    } catch (e) { /* no audio */ }
  }
  runBelt(outgoing, incoming, dur = 6.5) { this.beltSound(dur); return this.conv.step(outgoing, incoming, dur); }

  // ================================================================ 08 wrapping (table 2)
  toWrap() {
    this.s.step = 'wrapPrep';
    this.setHint('08 포장 준비', '작업대가 왼쪽 벽 너머로 넘어가고, 포장 테이블이 오른쪽에서 들어와요.');
    this.setMarkers([]); this.setGuide(null);
    for (const o of [...this.grabs]) { if (o === this.bomb) continue; this.forceRelease(o); this.ungrab(o); }
    // the bath bomb floats up in front of the player (above the passing tables) and waits there
    const bomb = this.bomb; this.forceRelease(bomb); this.ungrab(bomb); this.group.attach(bomb);
    this.tweenTo(bomb, L.hold.clone(), new THREE.Quaternion(), 0.9, () => this.float(bomb, L.hold));
    this.later(1.0, () => {
      this.conv.adopt(this.conv.t1, this.t1Objects());
      this.runBelt(this.conv.t1, this.table2).then(() => this.unrollWrap());
    });
  }
  // the paper is pulled off the roll on the wrapping table and spreads out in the middle of it
  unrollWrap() {
    this.wrap = this.make('wrapPaper', () => PH.wrapPaper(this.wrapTex)); this.wrap.rotation.y = Math.PI / 2; this.group.add(this.wrap);
    const from = L.rolls.clone().setY(DESK_Y), to = L.wrap.clone();
    this.wrap.position.copy(from); this.wrap.scale.set(1, 1, 0.05);
    this.sfx('wrap');
    this.tween(0.9, k => { const e = ease.out(k); this.wrap.position.lerpVectors(from, to, e); this.wrap.scale.set(1, 1, 0.05 + 0.95 * e); });
    this.wrapHandle = this.wrap.userData.placeholder.userData.handle;
    this.wrapHandle.visible = false;
    this.zones.wrap = { obj: this.wrap, off: V(0, 0.01, 0), r: 0.14, hover: 0.1 };
    this.later(1.0, () => {
      this.s.step = 'wrap';
      const bomb = this.bomb;
      this.grab(bomb, { modes: ['pinch', 'fist'], reach: 0.05 }); bomb.userData.home = { pos: L.hold.clone(), quat: new THREE.Quaternion() };
      this.setHint('08 포장', '떠 있는 배쓰밤을 잡아 포장 테이블의 포장지 위에 올려주세요.');
      this.setMarkers([bomb]);
    });
  }
  wrapPlaced() {
    this.s.step = 'wrapCover';
    this.forceRelease(this.bomb); this.ungrab(this.bomb); this.unfloat(this.bomb);
    this.tweenTo(this.bomb, wp(this.wrap, V(0, 0.003, 0)), new THREE.Quaternion(), 0.3);
    this.wrapHandle.visible = true;
    this.setHint('08 포장 · 감싸기', '포장지 앞쪽 끝(노란 손잡이)을 잡고 배쓰밤 위로 덮어주세요. 리본은 자동으로 묶여요. (PC: 노란 손잡이 클릭)');
    this.setMarkers([this.wrapHandle]);
  }
  coverWrap() {
    if (this.s.step !== 'wrapCover') return;
    this.s.step = 'wrapped'; this.sfx('wrap');
    const c = wp(this.wrap);
    this.fx.emit(c.clone().add(V(0, 0.06, 0)), { color: '#ffd34d', count: 50, speed: 0.4, life: 0.9 });
    this.wrap.visible = false; this.bomb.visible = false; this.wrapHandle.visible = false;
    this.gift = this.make('giftBox', () => PH.giftBox(this.wrapTex));
    this.gift.position.copy(this.group.worldToLocal(c.clone())); this.gift.scale.setScalar(0.01); this.group.add(this.gift);
    this.tween(0.6, k => this.gift.scale.setScalar(Math.max(0.01, ease.back(k))));
    this.setHint('포장 완료!', '리본까지 예쁘게 묶였어요.');
    this.setMarkers([]);
    this.later(1.6, () => this.toLetter());
  }

  // ================================================================ 09 hand letter (modules/hand-letter.js), on the wrapping table
  // A big letter paper stands in front of the player (its stand goes down to the wrapping table). Pick up the pencil next to it
  // and write with the pencil tip (Quest hands: pinch / fist, controllers: trigger / grip, PC: hold the left button and drag).
  // [지우기] 1 s / [보내기] 0.7 s held down. Sending folds the letter and it flies away, then it becomes the envelope.
  toLetter() {
    this.s.step = 'letter';
    const gp = wp(this.gift).add(V(0.06, 0, 0.3)); this.tweenTo(this.gift, gp, null, 0.8, () => this.restBelow(this.gift));
    if (!this.handLetter) {
      const hl = this.handLetter = createHandLetter({
        renderer: this.renderer, scene: this.scene, camera: this.camera, parent: this.rig || this.scene,
        lang: 'ko', texts: { dear: '이름 모를 산타에게' }, storageKey: 'santa-attic-hand-letter-pose',
        addLight: false,                                   // the attic has its own lights (a hemisphere light would light the whole room)
        floorY: () => DESK_Y,                              // the stand rests on the wrapping table
      });
      // the room renders with AgX tone mapping: keep the paper, buttons and handles at the colours of the design
      for (const o of [hl.letter.group, hl.letter.stand, hl.letter.shadow]) o.traverse((m) => { if (m.isMesh && m.material.isMeshBasicMaterial) m.material.toneMapped = false; });
      hl.onBeforeSend = (png) => { this.letterImage = png; };
      hl.onSend = () => this.sfx('letter');
      hl.onDone = () => this.finishLetter();
    }
    this.letterImage = null;
    this.handLetter.show();
    this.setHint('09 손편지', '편지지 옆의 연필을 집어(꼬집거나 쥐어서) 이름 모를 산타에게 편지를 써보세요. 다 쓰면 [보내기]를 잠시 누르고 있어요. 오른쪽 [각도], 아래 [이동] 손잡이로 편지지를 맞출 수 있어요. (PC: 종이 위에서 왼쪽 버튼을 누른 채 끌어서 쓰기)');
    this.setMarkers([]);
  }
  finishLetter() {
    if (this.s.step !== 'letter') return;
    this.s.step = 'givePrep';
    this.toast('편지 완성');
    this.handLetter?.hide();
    this.env = this.make('envelope', PH.envelope); this.env.position.copy(this.group.worldToLocal(L.letter.clone().add(V(0, 0.01, 0)))); this.group.add(this.env);
    this.later(0.7, () => this.toGive());
  }

  // ================================================================ 10 hand the gift and the letter to Nicolas
  // He comes over to the player's right (across the empty side desk) and holds out his hands. Each thing let go over his hands goes
  // into his hands, then into his back pocket.
  santaSay(text, secs = 4) {
    const S = this.santa; if (!S) return;
    if (!this.bubble) { const p = PH.talkPanel(); this.scene.add(p.mesh); this.bubble = { panel: p }; }
    const B = this.bubble; B.panel.mesh.visible = true; B.until = secs; B.panel.board.say(text);
    S.talk(true); S.setExpression('happy');
  }
  updateBubble(dt) {
    const B = this.bubble, S = this.santa; if (!B || !S || !B.panel.mesh.visible) return;
    B.panel.board.update(dt);
    if (B.panel.board.done) S.talk(false);
    B.until -= dt; if (B.until <= 0) { B.panel.mesh.visible = false; S.talk(false); return; }
    const head = this.headPos(), m = B.panel.mesh, p = S.object.position;
    const face = S.parts?.head ? wp(S.parts.head) : V(p.x, p.y + 1.6, p.z);
    const toHead = V(head.x - face.x, 0, head.z - face.z).normalize(), right = V(toHead.z, 0, -toHead.x);
    m.position.copy(face).addScaledVector(right, 0.28 + B.panel.w / 2).addScaledVector(toHead, 0.15); m.lookAt(head);
  }
  santaWalk(to, opts = {}) {
    this.santaWalking = true;
    return this.santa.walkTo(to, { speed: 0.6, ...opts }).then(() => { this.santaWalking = false; return this.santa.turnTo(this.headPos(), 0.6); });
  }
  toGive() {
    this.s.step = 'give'; this.given = 0;
    const a = wp(this.gift), b = L.letter.clone().add(V(0.2, 0.28, 0.12));
    this.tweenTo(this.env, b, null, 0.8, () => this.restBelow(this.env));
    for (const o of [this.gift, this.env]) this.grab(o, { modes: ['pinch', 'fist'], reach: 0.06 });
    this.gift.userData.home = { pos: a, quat: new THREE.Quaternion() }; this.env.userData.home = { pos: b, quat: new THREE.Quaternion() };
    this.zones.santa = { obj: this.santa ? this.santa.anchors.hands : this.gift, off: V(0, 0, 0), r: 0.3, hover: 0.04 };
    this.setHint('10 니콜라스에게 전달', '니콜라스가 오고 있어요.');
    const ready = () => {
      this.santa?.pose('offer');
      this.santaSay('포장한 선물과 편지는 내가 전해줄게요. 이리 주세요!', 5);
      this.setHint('10 니콜라스에게 전달', '선물과 편지를 하나씩 잡아 니콜라스가 내민 손 위에서 놓아주세요. (PC: 클릭한 채 니콜라스의 손 위로 끌어가 놓기)');
      this.setMarkers([this.gift, this.env, { obj: this.santa.anchors.hands, off: V(0, 0, 0) }]);
    };
    if (this.santa) this.santaWalk(L.santaGive).then(ready); else ready();
  }
  giveToSanta(o) {
    this.forceRelease(o); this.ungrab(o); this.unfloat(o); this.sfx('click');
    const S = this.santa, hands = wp(S.anchors.hands);
    this.tweenTo(o, hands, null, 0.35, () => {
      // into the back pocket
      S.pose('pocket');
      this.later(0.45, () => {
        const s0 = o.scale.clone(), p0 = wp(o);
        this.tween(0.6, k => { o.position.copy(this.group.worldToLocal(p0.clone().lerp(wp(S.anchors.pocket), ease.inOut(k)))); o.scale.copy(s0).multiplyScalar(1 - 0.85 * k); },
          () => { o.visible = false; if (this.given < 2 || this.s.step === 'give') S.pose('offer'); });
      });
    });
    this.given++;
    if (this.given === 1) this.toast('하나 더! 남은 것도 니콜라스에게 건네주세요.');
    if (this.given >= 2) { this.s.step = 'given'; this.setMarkers([]); this.later(1.6, () => this.receive()); }
  }

  // ================================================================ 11 Nicolas takes another Santa's gift out of his back pocket
  receive() {
    this.s.step = 'receivePrep';
    const S = this.santa;
    const others = Object.keys(RECIPES).filter(k => k !== this.s.recipeId);
    this.recvId = others[Math.floor(Math.random() * others.length)];
    this.santaSay('고마워요! 그럼… 이건 다른 산타가 당신에게 보낸 선물이에요.', 5);
    this.setHint('다른 산타의 선물', '니콜라스가 뒷주머니에서 무언가를 꺼내요.');
    S.pose('pocket');
    this.later(0.9, () => {
      this.recvBox = this.make('giftBox', () => PH.giftBox(this.wrapTex, '#bfe6ff'));
      this.recvBox.position.copy(this.group.worldToLocal(wp(S.anchors.pocket))); this.recvBox.scale.setScalar(0.3); this.group.add(this.recvBox);
      S.pose('offer');
      const p0 = wp(this.recvBox);
      this.tween(0.8, k => { const e = ease.inOut(k); this.recvBox.position.copy(this.group.worldToLocal(p0.clone().lerp(wp(S.anchors.hands, V(0, -0.03, 0)), e))); this.recvBox.scale.setScalar(0.3 + 0.7 * e); },
        () => {
          this.s.step = 'receive'; this.sfx('arrive');
          this.setHint('다른 산타의 선물이 도착했어요!', '니콜라스가 내민 선물 상자를 손으로 만지거나 잡아서 받아주세요. (PC: 클릭)');
          this.setMarkers([this.recvBox]);
        });
    });
  }
  // the box comes over and floats in front of the player; Nicolas steps back; the wrapping table leaves and the basin table comes in
  takeGift() {
    if (this.s.step !== 'receive' || !this.recvBox) return;
    this.s.step = 'toBasin';
    const box = this.recvBox; this.stopTween(box);
    this.setMarkers([]);
    this.tweenTo(box, L.hold.clone(), new THREE.Quaternion(), 0.8, () => this.float(box, L.hold));
    this.santa?.pose(null);
    if (this.santa) this.later(0.6, () => this.santaWalk(L.santa));        // back to his place across the desk
    this.setHint('수반 테이블', '포장 테이블이 넘어가고, 수반이 있는 테이블이 들어와요.');
    const rest = this.group.children.filter(o => o !== box && o !== this.hint?.mesh && (() => { const p = wp(o); return p.x > LANE.x0 - 0.1 && p.x < LANE.x1 + 0.05 && p.y > 0.8 && p.y < 1.3 && Math.abs(p.z - LANE.stopZ) < 0.9; })());
    this.later(1.2, () => {
      this.conv.adopt(this.table2, rest);
      this.runBelt(this.table2, this.table3).then(() => {
        this.s.step = 'basin';
        this.grab(box, { modes: ['pinch', 'fist'], reach: 0.06 }); box.userData.home = { pos: L.hold.clone(), quat: new THREE.Quaternion() };
        this.setHint('12 수반', '선물 상자를 잡아 수반 위에서 놓아주세요. 포장이 풀리고 배쓰밤이 물에 녹아요.');
        this.setMarkers([box, { obj: this.basin, off: V(0, 0.16, 0) }]);
      });
    });
  }

  // ================================================================ 12 the gift on the basin: the paper tears open, the bath bomb fizzes and melts away
  unwrapInBasin(box) {
    this.s.step = 'melting';
    this.forceRelease(box); this.ungrab(box); this.unfloat(box); this.setMarkers([]);
    const water = this.basin.userData.placeholder.userData.water, wc = wp(water);
    this.tweenTo(box, wc.clone().add(V(0, 0.01, 0)), new THREE.Quaternion(), 0.4, () => this.later(0.35, () => this.tearOpen(box, wc)));
    this.setHint('포장을 여는 중…', '');
  }
  tearOpen(box, wc) {
    this.sfx('wrap'); this.tone(900, 0.25, 'sawtooth', 0.03, 0.3);
    const c = wp(box, V(0, 0.045, 0));
    box.visible = false;
    // the paper tears into pieces that flap off the box and fall around the basin
    const tex = this.wrapTex, pm = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xc8333a, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 22; i++) {
      const s = 0.03 + Math.random() * 0.035, g = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(s, Math.random() * s * 0.4), new THREE.Vector2(s * (0.6 + Math.random() * 0.5), s), new THREE.Vector2(-s * 0.2, s * 0.8)]));
      const m = new THREE.Mesh(g, i % 5 === 0 ? mat('#bfe6ff', { metalness: 0.3, roughness: 0.4 }) : pm);
      m.position.copy(c).add(V((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08)); m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(m); this.conv.clip(m);
      const dir = m.position.clone().sub(c).setY(0).normalize(), v = dir.multiplyScalar(0.35 + Math.random() * 0.4).setY(0.5 + Math.random() * 0.5), spin = V(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      let life = 0;
      this.tween(1.6, k => {
        const dt = 1 / 60; life += dt; v.y -= 1.6 * dt;
        if (m.position.y > DESK_Y + 0.004 || v.y > 0) { m.position.addScaledVector(v, dt); m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt; m.rotation.z += spin.z * dt; }
        if (k > 0.7) m.scale.setScalar(Math.max(0.01, (1 - k) / 0.3));
      }, () => { m.removeFromParent(); g.dispose(); });
    }
    this.fx.emit(c, { color: '#fff3b0', count: 40, speed: 0.5, life: 0.9 });
    // the bath bomb inside drops into the water
    const r = RECIPES[this.recvId];
    const bomb = this.recvBomb = this.make('bathbomb_' + r.shape, () => PH.bathbomb(r.shape, r.powder));
    bomb.position.copy(this.group.worldToLocal(c.clone())); bomb.scale.setScalar(1.3); this.group.add(bomb);
    const surf = wc.clone().add(V(0, -0.012, 0));
    this.tween(0.5, k => bomb.position.copy(this.group.worldToLocal(c.clone().lerp(surf, k * k))), () => { this.sfx('splash'); this.tone(300, 0.3, 'sine', 0.08, 0.5);
      this.fx.emit(wc, { color: '#d8f3ff', count: 40, speed: 0.35, gravity: 1.2, life: 0.7, dir: V(0, 1, 0) }); this.dissolve(bomb, wc, r); });
    this.setHint(`${r.name}`, '배쓰밤이 거품을 내며 물에 녹고 있어요…');
  }
  dissolve(bomb, wc, r) {
    const water = this.basin.userData.placeholder.userData.water, wm = water.material;
    const c0 = wm.color.clone(), e0 = wm.emissive.clone(), tint = new THREE.Color(r.powder);
    // foam: a bubbly disc that spreads over the water from the bath bomb
    const ft = foamTexture();
    const foam = this.foam = new THREE.Mesh(new THREE.CircleGeometry(0.19, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: ft, color: new THREE.Color('#ffffff').lerp(tint, 0.25), emissive: new THREE.Color('#ffffff').lerp(tint, 0.3).multiplyScalar(0.55), emissiveMap: ft,
        transparent: true, opacity: 0, roughness: 0.9, depthWrite: false }));
    foam.position.copy(water.position).add(V(0, 0.003, 0)); water.parent.add(foam); foam.scale.setScalar(0.08); this.conv.clip(foam);
    const s0 = bomb.scale.x, DUR = 9;
    let fizz = 0;
    this.tween(DUR, k => {
      const e = ease.inOut(k);
      bomb.scale.setScalar(Math.max(0.001, s0 * (1 - Math.pow(k, 0.8))));
      bomb.rotation.y += 0.025; bomb.position.y += Math.sin(k * 40) * 0.0004;
      foam.scale.setScalar(0.08 + 0.92 * Math.min(1, k * 1.6)); foam.material.opacity = Math.min(0.9, k * 3) * (k > 0.85 ? 1 - (k - 0.85) * 2 : 1);
      foam.rotation.y += 0.004;
      wm.color.copy(c0).lerp(tint, e * 0.7); wm.emissive.copy(e0).lerp(tint.clone().multiplyScalar(0.5), e * 0.7);
      if ((fizz += 1) % 2 === 0 && k < 0.95) {
        const b = wp(bomb), a = Math.random() * 6.28, rr = Math.random() * 0.05 * (1 - k * 0.5);
        this.fx.emit(b.add(V(Math.cos(a) * rr, 0.01, Math.sin(a) * rr)), { color: Math.random() < 0.6 ? '#ffffff' : r.powder, count: 4, speed: 0.12, gravity: -0.25, life: 0.9, dir: V(0, 1, 0), spread: 0.6 });
        // bubbles popping up all over the spreading foam
        const fr = 0.19 * foam.scale.x * Math.sqrt(Math.random()), fa = Math.random() * 6.28;
        this.fx.emit(wc.clone().add(V(Math.cos(fa) * fr, 0.005, Math.sin(fa) * fr)), { color: '#ffffff', count: 1, speed: 0.05, gravity: -0.1, life: 0.6, dir: V(0, 1, 0), spread: 0.3 });
      }
      if (fizz % 9 === 0) this.tone(1800 + Math.random() * 1600, 0.03, 'sine', 0.012);
    }, () => { bomb.visible = false; this.s.step = 'end'; this.later(END_WAIT, () => this.farewell()); });
  }

  // ================================================================ ending: Nicolas says goodbye and leaves through the door, fade out,
  // then a 'Play Again' button in the LUSH font in the middle of the black screen (PC: on the page, VR: in front of the eyes)
  farewell() {
    if (this.s.step !== 'end') return;
    this.s.step = 'farewell';
    const S = this.santa;
    if (!S) return this.fadeOut();
    S.turnTo(this.headPos(), 0.5);
    S.wave(true);
    this.santaSay('잘 있어요! 이제 선물을 나눠주러 가야 해요. 메리 크리스마스!', 5);
    const P = this.santaPath;
    this.later(1.6, () => {
      S.wave(false);
      this.santaWalking = true;
      S.walkTo(P.via[1], { speed: 0.6 }).then(() => {
        this.creak();
        const d = this.door;
        if (d) { const q0 = this.doorQ0, q1 = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), this.doorOpen));
          this.tween(1.1, k => d.quaternion.slerpQuaternions(q0, q1, ease.inOut(k))); }
        return new Promise(res => this.later(0.9, res));
      }).then(() => S.walkTo(P.start, { via: P.via[0], speed: 0.6 }))
        .then(() => { S.object.visible = false; this.santaWalking = false; this.closeDoor(); this.later(1.4, () => this.fadeOut()); });
    });
  }
  // fade to black (PC: a full-screen layer; VR: a black shell around the head), then the restart button
  fadeOut(dur = 3) {
    this.s.step = 'fin';
    this.setHint('', ''); this.setMarkers([]);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9998;transition:opacity ' + dur + 's ease';
    document.body.appendChild(el); requestAnimationFrame(() => requestAnimationFrame(() => el.style.opacity = '1'));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    shell.renderOrder = 9999; this.camera.add(shell);
    this.tween(dur, k => shell.material.opacity = k);
    this.later(dur, () => { if (this.bgm) this.tween(1.5, k => this.bgm.volume = 0.5 * (1 - k)); try { window.jukebox?.stop?.(); } catch (e) {} });
    this.later(dur + 0.4, () => this.showRestart());
  }
  async showRestart() {
    const FONT = '"Parkway Lush"', LABEL = RESTART_LABEL;
    try { await document.fonts.load(`96px ${FONT}`); } catch (e) { /* falls back to the system font */ }
    // PC: a button in the middle of the screen
    const b = document.createElement('button'); b.id = 'restartBtn'; b.type = 'button'; b.textContent = LABEL;
    b.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;font-family:${FONT},system-ui,sans-serif;font-size:clamp(34px,6vw,56px);` +
      'padding:14px 48px;color:#fff;background:transparent;border:2px solid rgba(255,255,255,.85);border-radius:999px;cursor:pointer;letter-spacing:.02em;opacity:0;transition:opacity 1s ease';
    b.onmouseenter = () => b.style.background = 'rgba(255,255,255,.12)'; b.onmouseleave = () => b.style.background = 'transparent';
    b.onclick = () => location.reload();
    document.body.appendChild(b); requestAnimationFrame(() => requestAnimationFrame(() => b.style.opacity = '1'));
    // VR: the same button floating in front of the eyes, drawn over the black shell; press it with a finger or point and pinch
    const pnl = this.restartPanel = new Panel({ w: 0.36, h: 0.12, px: 900, name: 'RestartPanel', draw: (g, P) => {
      P.round(8, 8, P.W - 16, P.H - 16, (P.H - 16) / 2); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
      g.font = `110px ${FONT}, system-ui, sans-serif`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(LABEL, P.W / 2, P.H / 2 + 6);
      P.buttons.push({ id: 'restart', x: 0, y: 0, w: P.W, h: P.H });
    } });
    const m = pnl.mesh; m.material.depthTest = false; m.renderOrder = 10000;
    m.position.copy(this.viewFront(0.7)); m.quaternion.copy(this.viewFrame().q); this.scene.add(m);
    this.follow(m, { dist: 0.7, yOff: 0, speed: 3 });
    this.panels.push(pnl); this.garden?.blockers.push(m);
    for (const s of this.garden?.hands || []) for (const r of [s.rayLine, s.rayDot]) if (r) { r.renderOrder = 10001; [].concat(r.material).forEach(x => { x.depthTest = false; }); }
  }

  // ---------------------------------------------------------------- grab / release rules
  onGrabbed(o) {
    this.grabSound(o);
    if (this.s.step === 'naturals' && ING[o.userData.ing]?.action === 'pour' && this.bottles[o.userData.ing] === o) this.setGuide('pour');   // a bottle in hand: pour it
    if (o === this.fruits.bergamot || o === this.fruits.lemon) { if (this.board.userData.item === o) this.board.userData.item = null; }
    if (o.userData.onBoard) { o.userData.onBoard = false; if (this.board.userData.item === o) this.board.userData.item = null; }
    const d = this.drawers.find(x => x.item === o); if (d) this.unfloat(o);
  }
  // the sound of picking it up: glass + liquid, rustle, wood, fruit, stone, metal
  grabSound(o) {
    const p = wp(o), id = o.userData.ing, a = ING[id]?.action;
    Foley.whoosh(p);                                                         // every pick-up: a quick swish
    if (o === this.knife) return Foley.metal(p);
    if (o === this.pestle || o === this.mortar || o === this.lid) return Foley.stone(p);
    if (!id) return;
    if (o.userData.squeeze) return (a === 'cutSqueeze' ? Foley.fruit : ['tear', 'leaves', 'petals'].includes(a) ? Foley.rustle : Foley.wood)(p);
    const k = grabSound(id); if (k) Foley[k](p);
  }
  onReleased(o, holder) {
    const st = this.s.step, id = o.userData.ing;
    // ingredients that go to the board first
    if ((ING[id]?.action === 'cutSqueeze' && (o === this.fruits[id])) || (id === 'ginger' && !o.userData.squeeze)) {
      if (this.over(o, this.zones.board)) {
        if (!this.needed().includes(id)) { this.warnWrong(id); return this.homeOrFloat(o); }
        if (this.board.userData.item && this.board.userData.item !== o) { this.toast('도마 위에 이미 재료가 있어요'); return this.homeOrFloat(o); }
        this.board.userData.item = o; o.userData.onBoard = true;
        this.tweenTo(o, wp(this.board, V(0, 0.016, 0)), new THREE.Quaternion(), 0.3);
        this.setHint('04 손질 · 자르기', `칼을 집어 ${ING[id].name} 위로 한 번 내려주세요. (PC: 칼을 클릭한 채 Space)`);
        this.setMarkers([this.knife]);
        return;
      }
      if (this.over(o, this.zones.mortar)) { if (!this.needed().includes(id)) this.warnWrong(id); else this.toast('먼저 도마 위에서 칼로 손질해주세요'); }
      return this.homeOrFloat(o);
    }
    // things that go into the mortar
    if (o.userData.squeeze || (ING[id]?.action === 'pour') || o.userData.breakable) {
      if (o.userData.breakable && !o.userData.broken) { if (this.over(o, this.zones.mortar) && !this.needed().includes(id)) { this.warnWrong(id); return this.homeOrFloat(o); } if (this.over(o, this.zones.mortar)) this.toast(ING[id].action === 'tear' ? '양손으로 찢어서 넣어주세요 (PC: Space)' : '양손으로 부러뜨려서 넣어주세요 (PC: Space)'); return this.homeOrFloat(o); }
      if (o.userData.squeeze && this.over(o, this.zones.mortar)) { if (this.addToMortar(o, id)) { this.cleanupPair(o); return; } }
      return this.homeOrFloat(o);
    }
    if (o === this.decorObj && st === 'decor' && this.s.recipe.decor.mode === 'place' && this.over(o, this.zones.bomb)) {
      this.ungrab(o); this.bomb.attach(o); this.tweenTo(o, wp(this.bomb, V(0, this.s.recipe.shape === 'tree' ? 0.075 : 0.07, 0)), new THREE.Quaternion(), 0.25);
      return this.decorDone();
    }
    if (o === this.bomb && st === 'wrap' && this.over(o, this.zones.wrap)) return this.wrapPlaced();
    if ((o === this.gift || o === this.env) && st === 'give' && this.zones.santa && this.over(o, this.zones.santa)) return this.giveToSanta(o);
    if (o === this.recvBox && st === 'basin' && this.over(o, this.zones.basin)) return this.unwrapInBasin(o);
    if (o === this.recvBox && (st === 'basin' || st === 'toBasin')) { this.tweenTo(o, L.hold.clone(), new THREE.Quaternion(), 0.5, () => this.float(o, L.hold)); return; }
    if (o === this.lid && st === 'open') return this.openLid();
    return this.homeOrFloat(o);
  }
  homeOrFloat(o) {      // let go somewhere else: it drops onto the desk / shelf right below (only the floor sends it back)
    if (this.restBelow(o)) return;
    if (o.userData.home) this.goHome(o);
  }
  // put a thing down on the furniture surface under it, upright (keeps its turn), with a short drop
  restBelow(o, dur = 0.35) {
    if (!o.parent) return false;
    this.unfloat(o); this.group.attach(o); o.updateWorldMatrix(true, true);
    const proxy = o.userData.hitProxy; if (proxy) o.remove(proxy);      // the invisible hit box is not part of the shape
    const p = wp(o), bb = new THREE.Box3().setFromObject(o); if (proxy) o.add(proxy);
    const bottom = p.y - bb.min.y;
    const r = new THREE.Raycaster(p.clone().setY(Math.max(p.y, bb.max.y) + 0.25), V(0, -1, 0), 0, 4);
    const own = (x) => { for (let q = x; q; q = q.parent) if (q === this.group) return true; return false; };
    const hit = r.intersectObject(this.root, true).find(h => h.object.visible && !own(h.object) && h.face && h.face.normal.y > -0.2);
    if (!hit) return false;
    if (hit.point.y < 0.35 && Math.hypot(hit.point.x - L.stand.x, hit.point.z - L.stand.z) > 1.4) return false;   // far away on the floor: back to its place
    const yaw = new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    o.userData.restAt = hit.point.clone().add(V(0, bottom + 0.001, 0));
    this.tweenTo(o, o.userData.restAt, q, dur);
    return true;
  }

  // VR: a tool or ingredient that fell on the floor comes back into the hand on a pinch, no bending down. A pinch that took
  // nothing else (no grab within reach, no ray target) pulls the dropped thing nearest to where the hand points.
  pullFromFloor() {
    if (!this.garden || !this.renderer.xr.isPresenting) return;
    for (const s of this.garden.hands) {
      const aim = !!(s.connected && s.pinchAim && !s.held);
      if (aim && !s._floorAim) {
        const o0 = new THREE.Vector3(), d = new THREE.Vector3(); this.garden.pointerRay?.(s, o0, d);
        let best = null, bs = Infinity;
        for (const o of this.grabs) {
          const g = o.userData.g;
          if (!g || g.held || g.enabled === false || !o.parent || o.visible === false || o.userData.holder) continue;
          const p = wp(o); if (p.y > 0.4) continue;                           // only things lying on the floor
          const v = p.clone().sub(o0), score = d.lengthSq() ? v.angleTo(d) : p.distanceTo(s.point);
          if (score < bs) { bs = score; best = o; }
        }
        if (best) {
          const g = best.userData.g, anchor = s.pinchAnchor;
          g.held = s; g.onGrab?.(anchor, s); s.held = { type: 'ext', g }; this.garden.pullIn?.(anchor, best);
          s.pinchAim = false; if (s.rayLine) s.rayLine.visible = s.rayDot.visible = false;
          this.sfx('click');
        }
      }
      s._floorAim = !!(s.connected && s.pinchAim && !s.held);
    }
  }

  cleanupPair(o) {
    if (o.userData.pairId) for (const x of [...this.grabs]) if (x !== o && x.userData.pairId === o.userData.pairId && x.parent) { this.ungrab(x); const s0 = x.scale.clone(); this.tween(0.4, k => x.scale.copy(s0).multiplyScalar(1 - k), () => x.removeFromParent()); }
    const d = this.drawers.find(x => x.item === o); if (d) d.item = null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, t) {
    dt = Math.min(dt, 0.05) * (window.__timeScale || 1);   // __timeScale: test hook (fast-forward the flow)
    // timers & tweens
    for (const x of [...this.timers]) { x.t -= dt; if (x.t <= 0) { this.timers.splice(this.timers.indexOf(x), 1); x.fn(); } }
    for (const x of [...this.tweens]) { x.t += dt; const k = Math.min(1, x.t / x.dur); x.upd(k); if (k >= 1) { this.tweens.splice(this.tweens.indexOf(x), 1); x.done?.(); } }
    this.conv?.update(dt);
    this.updateSanta(dt);
    this.updateBubble(dt);
    // follow the view
    const head = this.headPos();
    // UI that follows the view (letter, recipe book): straight in front of the eyes, square to the view, no roll
    const vcam = this.camera;
    const ve = new THREE.Euler().setFromQuaternion(vcam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ'); ve.z = 0;
    const vq = new THREE.Quaternion().setFromEuler(ve), vf = V(0, 0, -1).applyQuaternion(vq), vu = V(0, 1, 0).applyQuaternion(vq);
    for (const f of this.follows) {
      const a = 1 - Math.exp(-dt * f.speed);
      const target = f.face === false ? this.viewTarget(f.dist, f.yOff) : head.clone().addScaledVector(vf, f.dist).addScaledVector(vu, f.yOff);
      const cur = wp(f.obj); cur.lerp(target, a); f.obj.position.copy(f.obj.parent.worldToLocal(cur));
      if (f.face !== false) {
        const q1 = vq.clone();
        if (f.tiltBook) q1.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));   // book: pages (local +Y) face the reader
        q1.premultiply(f.obj.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        f.obj.quaternion.slerp(q1, a);
      }
    }
    for (const f of this.floaters) {
      if (f.obj.userData.holder || !f.obj.parent) continue;
      const p = f.base.clone(); p.y += Math.sin(t * 2 + f.ph) * 0.012;
      f.obj.position.copy(f.obj.parent.worldToLocal(p)); f.obj.rotation.y += dt * 0.5;
    }
    for (const m of this.markers) {
      if (!m.target.parent || m.target.visible === false) { m.obj.visible = false; continue; }
      if (m.target.userData.holder) { m.obj.visible = false; continue; }    // in a hand: the job is done
      m.obj.visible = true; m.obj.position.copy(wp(m.target)).add(m.rel); m.obj.update(dt, this.camera);
    }
    this.updateGuide(dt);
    if (this.rb) { this.rb.update(dt); this.syncBookQuests(); }
    this.hint.mesh.visible = false;                                       // the old floating explanation panel is not shown
    this.pullFromFloor();

    // mouse-held object: in front of the camera, drawn toward the station it is aimed at
    if (this.mouseObj) {
      const o = this.mouseObj, ray = this.mouseRay();
      if (ray) {
        let p = ray.origin.clone().addScaledVector(ray.direction, this.mouseDepth);
        // follow the surface under the cursor (desk, shelf, floor) so a release puts it right there; the fixed depth used
        // to leave it hanging over the gap in front of the desk, and a drop there sent it back to where it came from
        const h = this.cast?.(ray.origin, ray.direction, 2.2);
        if (h && h.distance > 0.2) {
          const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V(0, 1, 0);
          p = h.point.clone().addScaledVector(n, 0.03).add(V(0, 0.05, 0));
        }
        for (const z of Object.values(this.zones)) if (z.obj?.visible !== false && this.over(o, z) && o !== z.obj) { p = this.zonePoint(z).add(V(0, z.hover || 0.12, 0)); break; }
        if (o === this.pestle && this.pestleDip) { this.pestleDip = Math.max(0, this.pestleDip - dt * 5); p.y -= Math.sin(this.pestleDip * Math.PI) * 0.08; }
        const cur = wp(o); cur.lerp(p, 1 - Math.exp(-dt * 14)); o.position.copy(this.group.worldToLocal(cur));
        this.tiltAmt += ((this.tiltKey ? 1 : 0) - this.tiltAmt) * Math.min(1, dt * 6);
        const camYaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y;
        const right = V(Math.cos(camYaw), 0, -Math.sin(camYaw));
        const q = new THREE.Quaternion().setFromAxisAngle(right, -this.tiltAmt * 2.0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, camYaw, 0)));
        if (o === this.knife) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, -0.4)));
        if (o === this.pestle) q.identity();
        o.quaternion.slerp(q, 1 - Math.exp(-dt * 12));
      }
    }

    // continuous checks: pouring, sprinkling, knife, pestle, two-hand break, mortar into mold
    this.continuous(dt);
    if (this.renderer.xr.isPresenting) this.updateTouch(dt);
    this.updateNotice(dt);
    this.fx.update(dt);
  }
  continuous(dt) {
    const st = this.s.step;
    // bottles pour into the mortar
    for (const b of Object.values(this.bottles)) {
      if (!this.held(b)) continue;
      const id = b.userData.ing;
      if (this.tilted(b) && this.over(b, this.zones.mortar)) {
        b.userData.pourT = (b.userData.pourT || 0) + dt; (id === 'coconutOil' ? Foley.gurgle : Foley.sand)(wp(b, V(0, 0.11, 0)));   // oil gurgles, powders hiss
        if (Math.random() < 0.7) this.fx.emit(wp(b, V(0, 0.11, 0)), { color: ING[id].color, count: 2, speed: 0.15, gravity: 1.5, life: 0.5, dir: V(0, -1, 0), spread: 0.4 });
        if (b.userData.pourT > 1.0) { b.userData.pourT = 0; if (this.addToMortar(null, id)) { /* bottle stays in hand */ } }
      } else b.userData.pourT = 0;
    }
    // knife touching what lies on the board (XR)
    if (this.held(this.knife) && this.knife.userData.holder !== 'mouse' && this.board.userData.item) {
      if (wp(this.knife).distanceTo(wp(this.board.userData.item)) < 0.07) this.tryCut();
    }
    // XR: squeeze = make a fist over the mortar while holding a half / pieces
    for (const o of this.grabs) {
      const h = o.userData.holder;
      if (h && h !== 'mouse' && o.userData.squeeze && h.isHand && h.fist && h.held?.g === o.userData.g && h._fistWasPinch === false && this.over(o, this.zones.mortar)) this.addToMortar(o, o.userData.ing);
      if (h && h !== 'mouse') h._fistWasPinch = !h.fist;
    }
    // XR: break / tear with the other hand
    for (const o of this.grabs) {
      const h = o.userData.holder; if (!h || h === 'mouse' || !o.userData.breakable || o.userData.broken) continue;
      for (const s of this.garden.hands) if (s !== h && s.connected && (s.pinch || s.fist) && s.point.distanceTo(wp(o)) < 0.1) { this.breakItem(o); break; }
    }
    // XR: pestle tip strikes into the mortar
    if (st === 'pound' && this.held(this.pestle) && this.pestle.userData.holder !== 'mouse') {
      const tip = wp(this.pestle), c = this.zonePoint(this.zones.mortar), last = this.pestle.userData.lastTip || tip.clone();
      const vy = (tip.y - last.y) / Math.max(dt, 1e-3);
      const inBowl = Math.hypot(tip.x - c.x, tip.z - c.z) < 0.07 && tip.y < c.y - 0.01;
      if (inBowl && vy < -0.25 && !this.pestle.userData.down) { this.pestle.userData.down = true; this.pound(); }
      if (tip.y > c.y + 0.03) this.pestle.userData.down = false;
      this.pestle.userData.lastTip = tip;
    }
    // mortar tipped over the mold
    if (st === 'pour' && this.held(this.mortar)) {
      if (this.tilted(this.mortar) && this.over(this.mortar, this.zones.mold)) {
        this.s.pourT += dt; Foley.sand(wp(this.mortar, V(0, 0.07, 0)));
        if (Math.random() < 0.8) this.fx.emit(wp(this.mortar, V(0, 0.07, 0)), { color: this.s.recipe.powder, count: 3, speed: 0.15, gravity: 1.5, life: 0.5, dir: V(0, -1, 0), spread: 0.5 });
        if (this.s.pourT > 1.2) this.moldFilled();
      } else this.s.pourT = Math.max(0, this.s.pourT - dt * 0.5);
    }
    // lid lifted (XR)
    if (st === 'open' && this.held(this.lid) && this.lid.userData.holder !== 'mouse' && wp(this.lid).y > wp(this.mold).y + 0.13) this.openLid();
    // sprinkle
    if (st === 'decor' && this.s.recipe.decor.mode === 'sprinkle' && this.held(this.decorObj)) {
      if (this.tilted(this.decorObj) && this.over(this.decorObj, this.zones.bomb)) {
        this.sprinkleT += dt;
        if (Math.random() < 0.8) this.fx.emit(wp(this.decorObj, V(0, 0.08, 0)), { color: this.s.recipe.decor.color, count: 3, speed: 0.12, gravity: 1.4, life: 0.5, dir: V(0, -1, 0), spread: 0.5 });
        if (Math.random() < 0.3) this.sprinkleOn(1);
        if (this.sprinkleT > 1.4) { this.sprinkleOn(20); this.decorDone(); }
      }
    }
    // wrap handle (XR): pinched handle moved over the bath bomb
    if (st === 'wrapCover' && this.wrapHandle?.visible) {
      for (const s of this.garden?.hands || []) if (s.connected && s.pinch && s.point.distanceTo(wp(this.wrapHandle)) < 0.06) { this.wrapGrab = s; }
      if (this.wrapGrab) { if (!this.wrapGrab.pinch) this.wrapGrab = null; else if (this.wrapGrab.point.distanceTo(wp(this.bomb)) < 0.1) this.coverWrap(); }
    }
    // hand letter (09): its own pencil, hands / controllers / mouse
    if (this.handLetter) {
      // PC: the view looks down at the workbench, so the paper would sink into the desk. Draw it over the room like UI.
      // VR: normal depth, so your own hands stay in front of the paper.
      const overlay = !this.renderer.xr.isPresenting, L2 = this.handLetter.letter;
      if (L2.overlay !== overlay) {
        L2.overlay = overlay;
        for (const o of [L2.paper, L2.pencil]) o.traverse((m) => { if (m.isMesh && m !== L2.cursor) { m.material.depthTest = !overlay; m.material.needsUpdate = true; } });
        for (const h of L2.handles) h.mesh.material.depthTest = !overlay;
      }
      this.handLetter.update(dt);
    }
  }
}

export function startFlow(ctx) { return new Flow(ctx); }
