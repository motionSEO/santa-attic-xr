// hand-letter.js — WebXR 손 추적 손편지 모듈 (Three.js r160+, Meta Quest 3 손 추적)
//
//   컨트롤러 없이 손으로:
//   · 편지지 옆 연필을 꼬집거나 쥐어서 집으면 → 잡은 모양 그대로 손에 붙음
//   · 연필 끝이 종이에 닿으면 써짐 (손 떨림은 One Euro 필터로 걸러 냄)
//   · [지우기] [보내기] 단추 — 연필 끝/손끝을 잠시 대고 있어야 눌림
//   · 오른쪽 [각도] 손잡이: 아래 모서리를 축으로 기울이기 / 아래 [이동] 손잡이: 위·아래·앞·뒤
//     손을 펴면 바로 놓이고, 맞춘 자리는 기기에 기억
//   · 바닥까지 내려오는 받침 + 그림자 (멀미 줄이기), 보내면 접히며 앞으로 날아감
//
//   가장 쉬운 사용법: createHandLetter({ renderer, scene, camera })  → README.md 참고
//
//   santa-attic-xr 에 넣으면서 바꾼 것 (demo.html 원본과 다른 점):
//   · ES 모듈로 export (HandLetter, createHandLetter)
//   · PC: 왼쪽 버튼만 가로챈다 (오른쪽 끌기 = 둘러보기는 게임에 그대로)
//   · 부모(리그)가 돌아가 있어도 편지지가 나를 향하게 놓음
//   · 퀘스트 컨트롤러: 손 추적이 없을 때 컨트롤러를 가상의 손으로 (트리거 = 꼬집기, 그립 = 쥐기)
//   편지는 저장·전송하지 않는다. 필요하면 getImage() 로 PNG 를 직접 받아 쓰면 된다.
import * as THREE from 'three';

const W = 0.4, H = 0.28;                // 편지지 크기(m) — VR 테스트 후 줄임 (0.66 x 0.46 → 0.5 x 0.35 → 0.4 x 0.28)
// 종이 캔버스: 시야 70°가 넘는 큰 종이라 2048px 로 그려야 퀘스트에서 글자·획이 깨지지 않는다
const S = 2;
const CW = 1024 * S, CH = Math.round(CW * H / W);
// 잉크는 따로 1024px 한 겹에 그리고, 바뀐 것을 GPU 로 올리는 건 초당 30번까지만
// (2048px 종이 전체를 획마다 다시 올리던 것이 퀘스트 렉의 큰 원인이었다)
const IK = 0.5, IW = Math.round(CW * IK), IH = Math.round(CH * IK);
const INK_UPLOAD = 1 / 30;
const TILT = THREE.MathUtils.degToRad(16);   // 수직에서 뒤로 살짝만 눕힘
// 거울(경계면) 좌표에서 편지지 자리: 눈에서 약 0.3m 아래, 나에게서 약 0.4m 앞 (손을 뻗어 쓰기 편한 거리)
// (경계면은 눈높이 −0.1m, 나에게서 0.55m 앞에 있다)
// 받침 좌표에서 편지지 자리: 눈에서 약 0.33m 아래, 나에게서 약 0.55m 앞 (팔을 편하게 뻗으면 닿는 거리)
const LOCAL_POS = new THREE.Vector3(0, -0.23, 0.0);

// 연필 끝 ↔ 종이: 닿음/떨어짐 거리(히스테리시스), 종이 뒤로 넘어가도 되는 깊이, 고리를 보여 주는 거리
// 연필 끝이 종이 면에 실제로 닿아야(0mm) 써지고, 1cm 떨어지면 멈춘다
const DOWN = 0.0, UP = 0.01, BEHIND = 0.035, HOVER = 0.05;
// 잡기 = 꼬집기(엄지 끝 ↔ 검지 끝) 또는 손 전체로 쥐기(손가락 굽힘). 켜짐/꺼짐 기준을 달리 둬서 깜빡이지 않게
// (퀘스트에서는 힘을 뺀 손도 손가락이 살짝 굽어 있어서 쥐기 기준을 높게 — 낮으면 손을 펴도 계속 쥔 걸로 읽혀 놓아지지 않았다)
const PINCH_ON = 0.025, PINCH_OFF = 0.038, CURL_ON = 0.72, CURL_OFF = 0.55, GRAB_REACH = 0.09;
// 손 추적이 잠깐 끊기거나 손가락이 살짝 벌어져도 이 시간 안에는 연필·손잡이를 놓치지 않는다
const LET_GO = 0.12;
// 손잡이: 놓은 뒤 이 시간 동안은 다시 잡히지 않음
const HANDLE_COOL = 0.9;
// 연필: 길이, 잡는 자리에서 끝까지
const PENCIL_LEN = 0.15, GRIP_TO_TIP = 0.035;
// 잡은 손에서 연필 끝까지 — 손가락이 종이에 닿기 전에 연필 끝이 먼저 닿도록 조금 길게
const PEN_REACH = 0.06;
const HOLD = { clear: 1.0, send: 0.7 };
// 손잡이로 맞출 수 있는 범위 (거울 좌표)
const TILT_MIN = 0, TILT_MAX = THREE.MathUtils.degToRad(75);
const Y_MIN = -0.55, Y_MAX = 0.05, Z_MIN = -0.25, Z_MAX = 0.3;
const HANDLE_REACH = 0.1;
const STORE_KEY_DEFAULT = 'hand-letter-pose';

const INK = '#3f3270';

const TEXT = {
  ko: { dear: '오늘의 나에게', clear: '지우기', send: '보내기', tilt: '각도', move: '이동', font: '"Noto Sans KR", "Malgun Gothic", sans-serif' },
  en: { dear: 'Dear me, today', clear: 'Clear', send: 'Send', tilt: 'Angle', move: 'Move', font: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
};

const _l = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();
const _hx = new THREE.Vector3(), _ha = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3();
const _hf = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4();
const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hs = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// One Euro 필터 — 손 추적 떨림 제거 (Casiez et al. 2012)
class OneEuro {
  constructor(minCutoff = 1.0, beta = 6.0, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null; this.dx = new THREE.Vector3();
  }
  reset() { this.x = null; this.dx.set(0, 0, 0); }
  static alpha(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(v, dt) {
    if (!this.x) { this.x = v.clone(); return this.x; }
    const d = _v.copy(v).sub(this.x).divideScalar(Math.max(dt, 1e-4));
    this.dx.lerp(d, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * this.dx.length();
    this.x.lerp(v, OneEuro.alpha(cutoff, dt));
    return this.x;
  }
}

export class HandLetter {
  /**
   * 핵심 클래스 — 손 관절 위치를 직접 넣어 주는 방식 (자세한 건 README).
   * 대부분은 아래 createHandLetter() 를 쓰면 된다.
   * @param {THREE.Object3D} zone  받침(anchor). 편지지는 이 좌표계에 놓인다 (+z 가 사용자 쪽, 원점 = 눈높이 −0.1m 정면)
   * @param {object} [opts]
   * @param {'ko'|'en'} [opts.lang]
   * @param {object} [opts.texts]       { dear, clear, send, tilt, move, font } 일부만 바꿔도 됨
   * @param {string|null} [opts.storageKey]  각도·위치를 기억할 localStorage 키 (null 이면 기억 안 함)
   */
  constructor(zone, opts = {}) {
    if (typeof opts === 'string') opts = { lang: opts };
    const lang = opts.lang ?? 'en';
    this.zone = zone;
    this.t = { ...(TEXT[lang] ?? TEXT.en), ...(opts.texts ?? {}) };
    this.lang = lang;
    this.storeKey = opts.storageKey === undefined ? STORE_KEY_DEFAULT : opts.storageKey;
    this.state = 'hidden';     // hidden | showing | writing | sending | sent
    this.alpha = 0;
    this.sendT = 0;
    this.onSend = null;        // () => void   거울에 닿는 순간
    this.onStroke = null;      // (speed) => void   쓰는 중 (소리)
    this.inked = false;
    this.pen = { down: false, last: null };
    this.held = -1;            // 연필을 쥔 손 (0/1), 없으면 -1
    this.grab = [0, 1].map(() => ({ pinch: false, fist: false, on: false, onset: false, off: 0 }));
    this.tipFilter = new OneEuro();
    this.press = { clear: 0, send: 0 };

    // 종이: 바탕(줄·머리말, 고정)과 잉크(투명, 따로 한 겹)
    this.base = document.createElement('canvas');
    this.base.width = CW; this.base.height = CH;
    this.ink = document.createElement('canvas');
    this.ink.width = IW; this.ink.height = IH;
    this.ictx = this.ink.getContext('2d');
    this.ictx.lineCap = this.ictx.lineJoin = 'round';
    this.ictx.strokeStyle = INK;
    this.drawBase();
    this.tex = new THREE.CanvasTexture(this.base);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.inkTex = new THREE.CanvasTexture(this.ink);
    this.inkTex.colorSpace = THREE.SRGBColorSpace;
    this.inkTex.anisotropy = 4;
    this.inkAge = 0;
    this.dirty = true;

    this.group = new THREE.Group();
    this.group.visible = false;
    zone.add(this.group);
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    this.paper.renderOrder = 32;
    this.group.add(this.paper);

    // 받침: 편지지 아래 모서리에서 바닥까지 가는 기둥 + 바닥의 옅은 그림자
    //   공중에 뜬 판보다 "바닥에 놓인 물건"이 훨씬 덜 어지럽다
    this.floorY = -1.4;
    const standMat = new THREE.MeshBasicMaterial({ color: '#c9bde6', transparent: true, opacity: 0 });
    this.stand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 1, 10), standMat);
    this.stand.renderOrder = 31;
    zone.add(this.stand);
    const shadowCv = document.createElement('canvas');
    shadowCv.width = shadowCv.height = 128;
    const sg = shadowCv.getContext('2d');
    const grd = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(120,100,180,0.45)');
    grd.addColorStop(1, 'rgba(120,100,180,0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCv);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.42),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 30;
    zone.add(this.shadow);
    this.inkMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.inkTex, transparent: true, opacity: 0, depthWrite: false })
    );
    this.inkMesh.position.z = 0.0008;
    this.inkMesh.renderOrder = 32.5;
    this.paper.add(this.inkMesh);

    // 단추: 편지지 아래, 종이와 떨어진 자리
    this.buttons = ['clear', 'send'].map((name) => {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 112;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.042),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })
      );
      mesh.position.set(name === 'clear' ? -W / 2 + 0.07 : W / 2 - 0.07, -H / 2 - 0.05, 0.004);
      mesh.renderOrder = 33;
      this.paper.add(mesh);
      return { name, cv, tex, mesh, drawn: -1 };
    });

    // 연필 끝 자리 고리 (종이에 닿기 전)
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.004, 0.006, 24),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    this.cursor.renderOrder = 34;
    this.cursor.visible = false;
    this.paper.add(this.cursor);

    // 연필: 연한 라벤더 몸통 + 나무 + 흑연 끝. 몸통의 +Y 가 연필 끝 방향
    this.pencil = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, PENCIL_LEN - 0.022, 6),
      new THREE.MeshStandardMaterial({ color: '#d9cdf3', roughness: 0.55 }));
    body.position.y = -0.011;
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0045, 0.018, 6),
      new THREE.MeshStandardMaterial({ color: '#f1dcc0', roughness: 0.8 }));
    wood.position.y = PENCIL_LEN / 2 - 0.013;
    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.0012, 0.004, 6),
      new THREE.MeshStandardMaterial({ color: '#3f3270', roughness: 0.4 }));
    lead.position.y = PENCIL_LEN / 2 - 0.002;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0047, 0.0047, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: '#f4b6c8', roughness: 0.6 }));
    cap.position.y = -PENCIL_LEN / 2 + 0.006;
    this.pencil.add(body, wood, lead, cap);
    this.pencil.traverse((o) => { if (o.isMesh) { o.renderOrder = 35; o.material.transparent = true; o.material.opacity = 0; } });
    this.pencil.visible = false;
    zone.add(this.pencil);
    this.pencilHome = new THREE.Vector3();
    this.pencilQuatHome = new THREE.Quaternion();
    this.tip = new THREE.Vector3();

    // 손잡이: 오른쪽 = 각도(부채꼴 그림), 아래 가운데 = 이동(상하좌우 화살표). 편지지와 함께 움직인다
    this.handles = [
      { kind: 'tilt', w: 0.075, h: 0.15, at: new THREE.Vector3(W / 2 + 0.055, 0.06, 0.004) },
      { kind: 'move', w: 0.11, h: 0.075, at: new THREE.Vector3(0, -H / 2 - 0.055, 0.004) },
    ].map((hd) => {
      const cv = document.createElement('canvas');
      const vertical = hd.h > hd.w;
      cv.width = Math.round(hd.w * 3000); cv.height = Math.round(hd.h * 3000);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hd.w, hd.h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      mesh.position.copy(hd.at);
      mesh.renderOrder = 33;
      this.group.add(mesh);
      const h = { ...hd, cv, tex, mesh, vertical, hot: 0, drawn: -1 };
      this.drawHandle(h);
      return h;
    });
    this.adjust = null;        // { hand, kind, startGrip, startPos }
    this.pose = { tilt: TILT, pos: LOCAL_POS.clone() };
    try {
      const saved = this.storeKey ? JSON.parse(localStorage.getItem(this.storeKey) || 'null') : null;
      if (saved && [saved.tilt, saved.y, saved.z].every(Number.isFinite)) {
        this.pose.tilt = THREE.MathUtils.clamp(saved.tilt, TILT_MIN, TILT_MAX);
        this.pose.pos.set(0, THREE.MathUtils.clamp(saved.y, Y_MIN, Y_MAX), THREE.MathUtils.clamp(saved.z, Z_MIN, Z_MAX));
      }
    } catch { /* 기억된 자리 없음 → 기본 자리 */ }
    this.place();
  }

  drawHandle(h) {
    const key = Math.round(h.hot * 10);
    if (key === h.drawn) return;
    h.drawn = key;
    const g = h.cv.getContext('2d');
    const { width: w, height: hh } = h.cv;
    g.clearRect(0, 0, w, hh);
    g.fillStyle = `rgba(138,116,208,${0.45 + 0.45 * h.hot})`;
    roundRect(g, 6, 6, w - 12, hh - 12, Math.min(w, hh) * 0.3); g.fill();
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineCap = g.lineJoin = 'round';
    const u = Math.min(w, hh);                       // 그림 크기 기준
    if (h.kind === 'tilt') {
      // 부채꼴: 바닥 축에서 위로 펼쳐진 각도 + 끝에 굽은 화살표 → "기울기"
      const cx = w * 0.3, cy = hh * 0.55, R = u * 0.6;
      g.globalAlpha = 0.35;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + 1.1); g.closePath(); g.fill();
      g.globalAlpha = 1;
      g.lineWidth = u * 0.07;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - R); g.stroke();                       // 세운 면
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.sin(1.1), cy - R * Math.cos(1.1)); g.stroke();   // 눕힌 면
      g.beginPath(); g.moveTo(cx - u * 0.12, cy); g.lineTo(cx + R * 0.9, cy); g.stroke();      // 바닥 축
      g.beginPath(); g.arc(cx, cy, R * 0.72, -Math.PI / 2 + 0.15, -Math.PI / 2 + 0.95); g.stroke();   // 굽은 화살
      const a = -Math.PI / 2 + 0.95, ax = cx + R * 0.72 * Math.cos(a), ay = cy + R * 0.72 * Math.sin(a);
      g.beginPath(); g.moveTo(ax - u * 0.11, ay - u * 0.02); g.lineTo(ax, ay); g.lineTo(ax - u * 0.02, ay - u * 0.12); g.stroke();
    } else {
      // 상하좌우 화살표 → "이동"
      const cx = w * 0.3, cy = hh / 2, L = u * 0.32, k = u * 0.1;
      g.lineWidth = u * 0.07;
      g.beginPath(); g.moveTo(cx - L, cy); g.lineTo(cx + L, cy); g.moveTo(cx, cy - L); g.lineTo(cx, cy + L); g.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ex = cx + dx * L, ey = cy + dy * L;
        g.beginPath();
        g.moveTo(ex - dx * k - dy * k, ey - dy * k - dx * k);
        g.lineTo(ex, ey);
        g.lineTo(ex - dx * k + dy * k, ey - dy * k + dx * k);
        g.stroke();
      }
    }
    // 글자: 그림 옆 (세로 손잡이는 아래)
    g.font = `600 ${Math.round(u * 0.26)}px ${this.t.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (h.vertical) g.fillText(this.t[h.kind], w / 2, hh * 0.86);
    else g.fillText(this.t[h.kind], w * 0.68, hh / 2 + 2);
    h.tex.needsUpdate = true;
  }

  // 손잡이 놓기: 자리 확정 → 같은 손은 손을 폈다 다시 쥐어야, 그리고 잠깐 뒤에야 다시 잡힌다
  releaseAdjust() {
    const i = this.adjust.hand;
    this.cool[i] = true;
    this.grab[i].coolT = HANDLE_COOL;
    this.adjust = null;
    this.savePose();
  }

  savePose() {
    try {
      if (this.storeKey) localStorage.setItem(this.storeKey, JSON.stringify({ tilt: this.pose.tilt, y: this.pose.pos.y, z: this.pose.pos.z }));
    } catch { /* 저장 못 해도 이번 세션에는 그대로 */ }
  }

  // 손잡이: 꼬집어 잡고 끌기
  updateAdjust(dt, hands) {
    const grips = hands.map((h, i) => (h && this.grab[i].on && i !== this.held ? this.gripPoint(h, i) : null));
    this.zone.updateMatrixWorld();
    // 놓기
    if (this.adjust && (!grips[this.adjust.hand] || !this.grab[this.adjust.hand].now)) this.releaseAdjust();
    // 한 번 놓은 손은 손을 폈다가 다시 쥐어야 또 잡힌다 (놓자마자 다시 잡히지 않게)
    this.cool ??= [false, false];
    hands.forEach((h, i) => { if (!this.grab[i].on) this.cool[i] = false; });
    // 잡기: 쥔 손(꼬집기·쥐기)이 손잡이 근처나 가장자리 띠 안에 있으면 — 미리 쥐고 다가와도 잡힌다
    //   오른쪽 가장자리·각도 손잡이 → 각도 / 아래 가운데·이동 손잡이 → 이동
    if (!this.adjust && this.state === 'writing') {
      this.paper.updateMatrixWorld();
      const inv = _m4.copy(this.paper.matrixWorld).invert();
      grips.forEach((g, i) => {
        if (this.adjust || !g || this.cool[i] || this.grab[i].coolT > 0 || !this.grab[i].onset) return;   // 새로 쥘 때만
        const q = g.clone().applyMatrix4(inv);              // 종이 좌표
        if (Math.abs(q.z) > 0.09) return;
        const nearHandle = (kind) => {
          const hd = this.handles.find((x) => x.kind === kind);
          return g.distanceTo(hd.mesh.getWorldPosition(new THREE.Vector3())) < HANDLE_REACH;
        };
        let kind = null;
        if (nearHandle('tilt') || (q.x > W / 2 - 0.02 && q.x < W / 2 + 0.12 && q.y > -H / 2 + 0.12 && q.y < H / 2 + 0.03)) kind = 'tilt';
        else if (nearHandle('move') || (Math.abs(q.x) < 0.1 && q.y < -H / 2 + 0.01 && q.y > -H / 2 - 0.12)) kind = 'move';
        if (kind) {
          const t0 = this.pose.tilt;
          // 각도: 아래 모서리(축)를 고정하고, 잡은 손이 축을 중심으로 돈 만큼 기울인다 (잡는 순간 튀지 않게 상대값)
          const hinge = new THREE.Vector3(0, this.pose.pos.y - (H / 2) * Math.cos(t0), this.pose.pos.z + (H / 2) * Math.sin(t0));
          const gl = this.zone.worldToLocal(g.clone());
          this.adjust = { hand: i, kind, startGrip: gl, startPos: this.pose.pos.clone(), startTilt: t0, hinge,
            startAngle: Math.atan2(-(gl.z - hinge.z), gl.y - hinge.y), moved: 0, still: 0, last: gl.clone(), age: 0 };
        }
      });
    }
    // 끌기
    if (this.adjust) {
      const g = this.zone.worldToLocal(grips[this.adjust.hand].clone());
      // 저절로 놓기: 2cm 넘게 움직인 뒤 0.45초 동안 거의 멈춰 있으면 (또는 6초가 지나면) 그 자리로 확정
      const A = this.adjust;
      A.age += dt;
      A.moved = Math.max(A.moved, g.distanceTo(A.startGrip));
      const speed = g.distanceTo(A.last) / Math.max(dt, 1e-3);
      A.last.copy(g);
      A.still = speed < 0.12 ? A.still + dt : 0;   // 손 추적의 미세한 떨림은 "멈춤"으로 봄
      if ((A.moved > 0.015 && A.still > 0.35) || A.age > 5) { this.releaseAdjust(); return; }
      if (this.adjust.kind === 'move') {
        const d = g.clone().sub(this.adjust.startGrip);
        this.pose.pos.set(0,
          THREE.MathUtils.clamp(this.adjust.startPos.y + d.y, Y_MIN, Y_MAX),
          THREE.MathUtils.clamp(this.adjust.startPos.z + d.z, Z_MIN, Z_MAX));
      } else {
        // 아래 모서리를 축으로, 잡은 손이 돈 각도만큼
        const { hinge } = this.adjust;
        const ang = Math.atan2(-(g.z - hinge.z), g.y - hinge.y);
        const t = THREE.MathUtils.clamp(this.adjust.startTilt + (ang - this.adjust.startAngle), TILT_MIN, TILT_MAX);
        this.pose.tilt = t;
        this.pose.pos.set(0, hinge.y + (H / 2) * Math.cos(t), hinge.z - (H / 2) * Math.sin(t));
        this.pose.pos.y = THREE.MathUtils.clamp(this.pose.pos.y, Y_MIN, Y_MAX + 0.2);
        // 많이 눕혀도 종이가 거울 면을 뚫고 들어가지 않도록, 그만큼 나에게 당겨 놓는다
        const farEdge = this.pose.pos.z - (H / 2) * Math.sin(t);
        if (farEdge < Z_MIN) this.pose.pos.z += Z_MIN - farEdge;
      }
      this.place(false);
    }
    // 손잡이 빛: 손이 가까우면 진해짐
    for (const hd of this.handles) {
      const at = hd.mesh.getWorldPosition(new THREE.Vector3());
      const near = grips.concat(hands.map((h) => h?.index ?? null)).some((g) => g && g.distanceTo(at) < HANDLE_REACH * 1.6);
      const want = this.adjust?.kind === hd.kind ? 1 : near ? 0.6 : 0;
      hd.hot += (want - hd.hot) * Math.min(1, dt * 8);
      this.drawHandle(hd);
    }
  }

  get active() { return this.state === 'showing' || this.state === 'writing'; }
  get shown() { return this.state !== 'hidden'; }
  get holding() { return this.held >= 0; }

  setFloor(y) { this.floorY = y; this.place(); }

  place(snapPencil = true) {
    const pose = this.pose ?? { tilt: TILT, pos: LOCAL_POS };
    this.group.position.copy(pose.pos);
    this.group.rotation.set(-pose.tilt, 0, 0);
    this.group.scale.set(1, 1, 1);
    // 연필 제자리: 편지지 오른쪽 아래 옆, 종이 면 바로 앞에 비스듬히 누워 있음
    this.group.updateMatrix();
    // 받침: 편지지 아래 모서리 가운데 → 바닥
    if (this.stand) {
      const bottom = new THREE.Vector3(0, -H / 2, -0.01).applyMatrix4(this.group.matrix);
      const len = Math.max(0.05, bottom.y - this.floorY);
      this.stand.position.set(0, this.floorY + len / 2, bottom.z);
      this.stand.scale.set(1, len, 1);
      this.shadow.position.set(0, this.floorY + 0.003, bottom.z);
    }
    this.pencilHome.set(W / 2 + 0.05, -H / 2 + 0.055, 0.015).applyMatrix4(this.group.matrix);
    this.pencilQuatHome.setFromEuler(new THREE.Euler(-pose.tilt, 0, Math.PI / 2 + 0.15));
    if (snapPencil) {
      this.pencil.position.copy(this.pencilHome);
      this.pencil.quaternion.copy(this.pencilQuatHome);
    }
  }

  show() {
    if (this.state !== 'hidden' && this.state !== 'sent') return;
    this.clear();
    this.place();
    this.held = -1;
    this.state = 'showing';
    this.group.visible = true;
    this.pencil.visible = true;
    this.stand.visible = this.shadow.visible = true;
  }

  hide() {
    this.state = 'hidden';
    this.alpha = 0;
    this.held = -1;
    this.group.visible = false;
    this.pencil.visible = false;
    this.stand.visible = this.shadow.visible = false;
  }

  /** 지금까지 쓴 편지를 PNG(dataURL)로 — 종이 바탕 + 글씨 */
  getImage(type = 'image/png') {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const g = cv.getContext('2d');
    g.drawImage(this.base, 0, 0);
    g.drawImage(this.ink, 0, 0, CW, CH);
    return cv.toDataURL(type);
  }

  /** 모두 지우고 정리 (장면에서 뺄 때) */
  dispose() {
    for (const o of [this.group, this.pencil, this.stand, this.shadow]) o.removeFromParent();
    this.tex.dispose(); this.inkTex.dispose();
  }

  clear() {
    this.ictx.clearRect(0, 0, IW, IH);
    this.inked = false;
    this.dirty = true;
  }

  // ── 종이 바탕 ──
  drawBase() {
    const g = this.base.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, CH);
    grd.addColorStop(0, '#fffdf9');
    grd.addColorStop(1, '#f8f3fb');
    g.fillStyle = grd;
    g.fillRect(0, 0, CW, CH);
    g.strokeStyle = 'rgba(160,140,210,0.35)';
    g.lineWidth = 6 * S;
    g.strokeRect(3 * S, 3 * S, CW - 6 * S, CH - 6 * S);
    g.fillStyle = '#7d6fae';
    g.font = `400 ${40 * S}px ${this.t.font}`;
    g.fillText(this.t.dear, 60 * S, 80 * S);
    const d = new Date();
    const date = this.lang === 'ko' ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    g.font = `400 ${24 * S}px ${this.t.font}`;
    g.fillStyle = '#a49ac2';
    g.textAlign = 'right';
    g.fillText(date, CW - 60 * S, 78 * S);
    g.textAlign = 'left';
    g.strokeStyle = 'rgba(150,130,205,0.28)';
    g.lineWidth = 2 * S;
    for (let y = 150 * S; y < CH - 40 * S; y += 66 * S) {
      g.beginPath(); g.moveTo(60 * S, y); g.lineTo(CW - 60 * S, y); g.stroke();
    }
  }

  compose() {
    this.inkTex.needsUpdate = true;
    this.dirty = false;
    this.inkAge = 0;
  }

  drawButton(b) {
    const p = Math.min(1, this.press[b.name] / HOLD[b.name]);
    const key = Math.round(p * 40) + (b.name === 'send' && this.inked ? 100 : 0);
    if (key === b.drawn) return;
    b.drawn = key;
    const g = b.cv.getContext('2d');
    const w = b.cv.width, h = b.cv.height;
    g.clearRect(0, 0, w, h);
    const send = b.name === 'send';
    g.fillStyle = send ? (this.inked ? '#8a74d0' : '#cfc6e6') : '#efe9f7';
    roundRect(g, 4, 4, w - 8, h - 8, (h - 8) / 2); g.fill();
    if (p > 0) {
      g.save(); roundRect(g, 4, 4, w - 8, h - 8, (h - 8) / 2); g.clip();
      g.fillStyle = send ? 'rgba(255,170,200,0.8)' : 'rgba(170,150,220,0.55)';
      g.fillRect(4, 4, (w - 8) * p, h - 8);
      g.restore();
    }
    g.fillStyle = send ? '#ffffff' : '#7d6fae';
    g.font = `500 40px ${this.t.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.t[b.name], w / 2, h / 2 + 2);
    b.tex.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {({thumb:THREE.Vector3, index:THREE.Vector3, knuckle:THREE.Vector3}|null)[]} hands
   *        두 손의 엄지 끝·검지 끝·검지 첫 마디 (월드). 손 추적이 아니면 null
   */
  update(dt, hands) {
    if (this.state === 'hidden') return;
    if (this.state === 'sending') return this.updateSend(dt);
    if (this.state === 'sent') {
      this.alpha = Math.max(0, this.alpha - dt * 2);
      this.setAlpha(this.alpha);
      if (this.alpha <= 0) this.hide();
      return;
    }

    this.alpha = Math.min(1, this.alpha + dt * 1.2);
    this.setAlpha(this.alpha);
    if (this.alpha >= 1) this.state = 'writing';

    this.updatePencil(dt, hands);
    this.updateAdjust(dt, hands);

    this.paper.updateMatrixWorld();
    _inv.copy(this.paper.matrixWorld).invert();

    // ── 쓰기: 연필 끝만 ──
    const pen = this.pen;
    if (this.holding && this.state === 'writing' && !this.adjust) {
      _l.copy(this.tip).applyMatrix4(_inv);           // 종이 좌표: x,y = 면 위, z = 면에서 떨어진 거리(내 쪽 +)
      const inside = Math.abs(_l.x) < W / 2 - 0.005 && Math.abs(_l.y) < H / 2 - 0.005;
      // 종이 면에 닿거나 넘어가면(얼마나 깊든) 써지고, 1cm 떼면 멈춘다
      if (!inside) pen.down = false;
      else if (!pen.down && _l.z < DOWN) pen.down = true;
      else if (pen.down && _l.z > UP) pen.down = false;

      // 연필 끝이 종이를 뚫고 들어가면 보이는 연필은 종이 면에 멈춰 선다 (아이패드처럼 단단한 면 느낌)
      if (_l.z < 0 && inside) {
        const n = new THREE.Vector3(0, 0, 1).transformDirection(this.paper.matrixWorld)
          .transformDirection(_m4.copy(this.zone.matrixWorld).invert());
        this.pencil.position.addScaledVector(n, -_l.z);
      }
      const hover = inside && _l.z < HOVER;
      this.cursor.visible = hover;
      if (hover) {
        this.cursor.position.set(_l.x, _l.y, 0.002);
        this.cursor.scale.setScalar(pen.down ? 0.6 : 1 + Math.max(0, _l.z) * 30);   // 가까워질수록 작아짐 → 닿는 순간을 알기 쉽게
        this.cursor.material.opacity = pen.down ? 0.9 : 0.35 + 0.5 * (1 - Math.max(0, _l.z) / HOVER);
      }
      if (pen.down) {
        const px = (_l.x / W + 0.5) * IW, py = (0.5 - _l.y / H) * IH;   // 잉크 캔버스 좌표
        const g = this.ictx;
        const w = (4 + 2.5 * THREE.MathUtils.clamp(-_l.z / 0.03, 0, 1)) * S;   // 깊이 누를수록 조금 굵게
        g.lineWidth = w * IK;
        if (pen.last) {
          const dist = Math.hypot(px - pen.last.x, py - pen.last.y);
          if (dist > 1.5 * S * IK) {                    // 아주 작은 흔들림은 무시
            // 직전 점과의 중점까지 곡선으로 이어 부드럽게
            const mx = (pen.last.x + px) / 2, my = (pen.last.y + py) / 2;
            g.beginPath();
            g.moveTo(pen.lastMid?.x ?? pen.last.x, pen.lastMid?.y ?? pen.last.y);
            g.quadraticCurveTo(pen.last.x, pen.last.y, mx, my);
            g.stroke();
            this.onStroke?.(dist / Math.max(dt, 1e-3) / IW);
            pen.lastMid = { x: mx, y: my };
            pen.last = { x: px, y: py };
            this.inked = true;
            this.dirty = true;
          }
        } else {
          g.beginPath(); g.arc(px, py, (w * IK) / 2, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
          pen.last = { x: px, y: py };
          pen.lastMid = null;
          this.inked = true;
          this.dirty = true;
        }
      } else { pen.last = null; pen.lastMid = null; }
    } else {
      pen.down = false; pen.last = null; pen.lastMid = null;
      this.cursor.visible = false;
    }

    // ── 단추: 연필 끝 또는 손끝을 대고 있어야 눌림 ──
    const pokes = [];
    if (this.holding) pokes.push(this.tip);
    hands.forEach((h, i) => { if (h && i !== this.held) pokes.push(h.index); });
    for (const b of this.buttons) {
      b.mesh.updateMatrixWorld();
      const inv = _inv.copy(b.mesh.matrixWorld).invert();
      const on = this.state === 'writing' && !this.adjust && pokes.some((p) => {
        _l.copy(p).applyMatrix4(inv);
        return Math.abs(_l.x) < 0.065 && Math.abs(_l.y) < 0.026 && _l.z < 0.015 && _l.z > -0.03;
      });
      const ready = b.name === 'clear' ? this.inked : this.inked;   // 쓴 게 없으면 둘 다 반응하지 않음
      this.press[b.name] = on && ready ? this.press[b.name] + dt : Math.max(0, this.press[b.name] - dt * 3);
      if (this.press[b.name] >= HOLD[b.name]) {
        this.press[b.name] = 0;
        if (b.name === 'clear') { this.clear(); this.onClear?.(); }
        else this.send();
      }
      this.drawButton(b);
    }
    this.inkAge += dt;
    if (this.dirty && this.inkAge >= INK_UPLOAD) this.compose();
  }

  // 연필: 꼬집어 집고, 놓으면 제자리로
  // 손마다 잡기 상태: 꼬집기 또는 쥐기. onset = 이번 프레임에 막 잡음
  updateGrab(dt, hands) {
    hands.forEach((h, i) => {
      const g = this.grab[i];
      const was = g.on;
      if (h) {
        const d = h.thumb.distanceTo(h.index);
        g.pinch = g.pinch ? d < PINCH_OFF : d < PINCH_ON;
        g.fist = g.fist ? h.curl > CURL_OFF : h.curl > CURL_ON;
      }
      const now = !!h && (g.pinch || g.fist);
      // 놓는 쪽은 잠깐 기다려 준다 (추적 끊김·손가락 흔들림)
      g.off = now ? 0 : g.off + dt;
      g.on = now || (was && g.off < LET_GO);
      g.onset = now && !g.prevNow;
      g.now = now;          // 지금 이 순간 실제로 쥐고 있는지 (손잡이는 이걸로 바로 놓음)
      g.prevNow = now;
      g.coolT = Math.max(0, (g.coolT ?? 0) - dt);
    });
  }

  // 바른 연필 쥐기 자세의 연필 월드 행렬 (손바닥 좌표틀 frame 기준으로 만든다)
  writingPose(h, i, frame) {
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    frame.extractBasis(x, y, z);                       // x: 손목→검지 마디(앞), y: 새끼 쪽, z: 손바닥 또는 손등 쪽
    const grip = this.gripPoint(h, i);
    // z 가 손바닥 쪽인지: 꼬집은 점은 손바닥 쪽에 있다 (컨트롤러는 z 가 아래 = 손바닥 쪽)
    // 손: 오른손이면 z 가 손바닥 쪽, 왼손이면 손등 쪽 (handedOf 로 알려 줌). 모르면 꼬집은 점이 있는 쪽. 컨트롤러는 z = 아래 = 손바닥 쪽
    const hd = h.pad ? 'pad' : this.handedOf?.(i);
    const side = hd === 'pad' || hd === 'right' ? 1 : hd === 'left' ? -1 : (grip.clone().sub(h.knuckle).dot(z) < -0.004 ? -1 : 1);
    const palm = z.clone().multiplyScalar(side);
    const tipDir = x.clone().multiplyScalar(0.55).addScaledVector(palm, 0.75).addScaledVector(y, -0.3).normalize();   // 앞·아래, 살짝 엄지 쪽
    const tip = grip.clone().addScaledVector(tipDir, GRIP_TO_TIP);
    const center = tip.addScaledVector(tipDir, -PENCIL_LEN / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(_Y, tipDir);   // 연필 +Y = 끝
    // 연필의 위치를 부모(zone) 기준이 아니라 월드 행렬로 돌려준다
    return new THREE.Matrix4().compose(center, q, this.pencil.getWorldScale(new THREE.Vector3()));
  }

  // 손바닥 좌표틀: 원점 = 검지 첫 마디, x = 손목 → 검지 마디, 손바닥 가로 = 검지 마디 → 새끼 마디
  // (손가락을 오므리거나 엄지를 움직여도 흔들리지 않는 뼈대만 쓴다)
  handFrame(h, out) {
    if (!h.pinky) return null;
    const x = _hx.copy(h.knuckle).sub(h.wrist);
    const a = _ha.copy(h.pinky).sub(h.knuckle);
    if (x.lengthSq() < 1e-6 || a.lengthSq() < 1e-6) return null;
    x.normalize();
    const z = _hz.crossVectors(x, a).normalize();
    const y = _hy.crossVectors(z, x).normalize();
    return out.makeBasis(x, y, z).setPosition(h.knuckle);
  }

  gripPoint(h, i) {
    // 꼬집기: 엄지·검지 끝 사이 / 쥐기: 엄지 끝과 검지 첫 마디 사이 (주먹 안)
    return this.grab[i].pinch || !h.curl ? h.thumb.clone().lerp(h.index, 0.5) : h.thumb.clone().lerp(h.knuckle, 0.5);
  }

  updatePencil(dt, hands) {
    this.updateGrab(dt, hands);
    // 놓기
    if (this.holding && !this.grab[this.held].on) {
      this.held = -1;
      this.tipFilter.reset();
    }
    // 집기: 연필 가까이에서 막 잡은 손 (꼬집기든 쥐기든)
    if (!this.holding && this.state === 'writing') {
      this.pencil.updateMatrixWorld();
      const center = this.pencil.getWorldPosition(_v);
      hands.forEach((h, i) => {
        if (this.holding || !h || !this.grab[i].on || this.adjust?.hand === i) return;
        if (this.gripPoint(h, i).distanceTo(center) < GRAB_REACH && this.handFrame(h, _hf)) {
          this.held = i;
          this.tipFilter.reset();
          this.frameQ = null;
          this.pencil.updateMatrixWorld();
          // 잡는 순간 바른 쓰기 자세로 손에 쥐여 준다 (잡은 위치·각도 그대로가 아니라): 엄지·검지 사이에 끼고,
          // 끝은 손가락 앞쪽 아래(손바닥 쪽)로, 윗부분은 엄지와 검지 사이 홈을 지나 손목 쪽 위로
          this.gripOffset = (this.gripOffset ?? new THREE.Matrix4()).copy(_hf).invert().multiply(h.mouse ? this.pencil.matrixWorld : this.writingPose(h, i, _hf));   // PC: the mouse hand already holds it the right way (mouseGrab)
        }
      });
    }

    if (this.holding) {
      const h = hands[this.held];
      if (!h) return;                                   // 추적이 잠깐 끊김 → 연필은 마지막 자리에
      // 잡은 모양 그대로: 잡는 순간의 "손바닥 좌표틀 ↔ 연필" 관계를 그대로 유지한다
      // (자동으로 세우지 않음 — 사람마다 편한 쥐는 법이 달라서)
      if (!this.handFrame(h, _hf)) return;
      // 손바닥 좌표틀의 떨림 걸러내기: 위치는 One Euro, 회전은 부드러운 보간
      _hf.decompose(_hp, _hq, _hs);
      const p = this.tipFilter.filter(_hp, dt);
      if (!this.frameQ) this.frameQ = _hq.clone();
      else this.frameQ.slerp(_hq, 1 - Math.exp(-dt * 14));
      _hf.compose(p, this.frameQ, _one);
      const world = _pm.multiplyMatrices(_hf, this.gripOffset);
      this.zone.updateMatrixWorld();
      _pm2.copy(this.zone.matrixWorld).invert().multiply(world).decompose(this.pencil.position, this.pencil.quaternion, _hs);
      this.pencil.updateMatrixWorld();
      this.tip.set(0, PENCIL_LEN / 2, 0).applyMatrix4(this.pencil.matrixWorld);   // 흑연 끝
    } else {
      // 제자리로 부드럽게 돌아감
      const k = Math.min(1, dt * 6);
      this.pencil.position.lerp(this.pencilHome, k);
      this.pencil.quaternion.slerp(this.pencilQuatHome, k);
    }
  }

  setAlpha(a) {
    this.paper.material.opacity = a;
    this.paper.material.depthWrite = a >= 0.99;      // 다 나타나면 불투명한 종이로 (뒤가 비치지 않게)
    this.stand.material.opacity = a * 0.9;
    this.shadow.material.opacity = a;
    this.inkMesh.material.opacity = a;
    for (const b of this.buttons) b.mesh.material.opacity = a;
    for (const hd of this.handles) hd.mesh.material.opacity = a;
    this.pencil.traverse((o) => { if (o.isMesh) o.material.opacity = a; });
  }

  send() {
    this.onBeforeSend?.(this.getImage());   // 날아가기 전 편지 이미지 (저장·전송은 사용하는 쪽이 결정)
    this.state = 'sending';
    this.sendT = 0;
    this.held = -1;
    this.adjust = null;
    this.cursor.visible = false;
    this.from = { pos: this.group.position.clone(), rx: this.group.rotation.x };
  }

  // 접히며 떠올라 → 나를 향해 세워지고 → 거울을 지나 거울 속 나의 가슴께로
  updateSend(dt) {
    this.sendT += dt;
    const t = this.sendT;
    const g = this.group;
    const e = (x) => x * x * (3 - 2 * x);
    const a = e(Math.min(1, t / 1.2));
    const b = e(THREE.MathUtils.clamp((t - 1.2) / 1.6, 0, 1));
    g.rotation.x = THREE.MathUtils.lerp(this.from.rx, 0, a);
    g.scale.set(1 - 0.45 * a, 1 - 0.55 * a, 1);
    g.position.set(0,
      THREE.MathUtils.lerp(this.from.pos.y, -0.05, a),
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.from.pos.z, 0.12, a), -0.5, b));
    g.scale.multiplyScalar(1 - 0.5 * b);
    if (b > 0.45 && !this.reached) { this.reached = true; this.onSend?.(); }
    this.paper.material.opacity = 1 - b;
    this.paper.material.depthWrite = false;
    this.inkMesh.material.opacity = 1 - b;
    this.stand.material.opacity = Math.max(0, 0.9 - a * 2);    // 받침은 편지가 떠오르면 사라짐
    this.shadow.material.opacity = Math.max(0, 1 - a * 2);
    for (const btn of this.buttons) btn.mesh.material.opacity = Math.max(0, 1 - a * 2);
    for (const hd of this.handles) hd.mesh.material.opacity = Math.max(0, 1 - a * 2);
    // 연필은 제자리로 돌아가며 사라짐
    const k = Math.min(1, dt * 6);
    this.pencil.position.lerp(this.pencilHome, k);
    this.pencil.quaternion.slerp(this.pencilQuatHome, k);
    this.pencil.traverse((o) => { if (o.isMesh) o.material.opacity = Math.max(0, 1 - a); });
    if (t > 2.8) { this.state = 'sent'; this.alpha = 0; this.reached = false; this.setAlpha(0); this.onDone?.(); }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}


// ─────────────────────────────────────────────────────────────────────────────
// 쉬운 사용: createHandLetter — 손 추적 읽기, 받침 배치(사용자 정면), 조명까지 알아서
// ─────────────────────────────────────────────────────────────────────────────
const CURL_FINGERS = ['index', 'middle', 'ring', 'pinky'];
const _w = new THREE.Vector3(), _c = new THREE.Vector3(), _hd = new THREE.Vector3(), _fw = new THREE.Vector3();

function handCurl(J, wrist) {
  const size = J['middle-finger-phalanx-proximal'].getWorldPosition(_c).distanceTo(wrist);
  if (!(size > 0.02)) return 0;
  let r = 0;
  for (const f of CURL_FINGERS) r += J[`${f}-finger-tip`].getWorldPosition(_c).distanceTo(wrist) / size;
  r /= CURL_FINGERS.length;                       // 편 손 ≈ 1.9, 주먹 ≈ 1.0
  return THREE.MathUtils.clamp((1.85 - r) / 0.75, 0, 1);
}

/**
 * 콘텐츠에 바로 넣는 손편지. 퀘스트(XR 세션 중)에서는 손 추적, PC(세션 밖)에서는 마우스로 써진다.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer   렌더러 (XR 을 쓰려면 renderer.xr.enabled = true)
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera            카메라 (리그 안에 있어도 됨)
 * @param {THREE.Object3D} [o.parent]        손·받침을 붙일 곳 (이동 리그를 쓰면 그 리그). 기본 scene
 * @param {'ko'|'en'} [o.lang]
 * @param {object} [o.texts]                 { dear, clear, send, tilt, move, font }
 * @param {string|null} [o.storageKey]
 * @param {number} [o.distance=0.55]         XR: 눈에서 받침까지 앞쪽 거리(m)
 * @param {number} [o.desktopDistance]       PC: 카메라에서 편지지까지 거리(m). 기본은 화면에 꽉 차게 자동
 * @param {number|(() => number)} [o.floorY=0]  바닥 높이(월드). 함수도 됨
 * @param {boolean} [o.addLight=true]        연필이 보이도록 약한 조명 추가
 * @param {boolean} [o.mouse=true]           XR 세션이 아닐 때 마우스·터치로 쓰기
 */
export function createHandLetter(o) {
  const { renderer, scene, camera } = o;
  const parent = o.parent ?? scene;
  const anchor = new THREE.Group();
  parent.add(anchor);
  const letter = new HandLetter(anchor, { lang: o.lang, texts: o.texts, storageKey: o.storageKey });
  if (o.addLight !== false) anchor.add(new THREE.HemisphereLight('#ffffff', '#cbbfe6', 1.6));
  const hands = [0, 1].map((i) => {
    const hand = renderer.xr.getHand(i);
    if (!hand.parent) parent.add(hand);
    return { hand, data: { thumb: new THREE.Vector3(), index: new THREE.Vector3(), knuckle: new THREE.Vector3(), wrist: new THREE.Vector3(), pinky: new THREE.Vector3(), curl: 0 } };
  });
  const input = [null, null];
  const distance = o.distance ?? 0.55;
  const floorY = () => (typeof o.floorY === 'function' ? o.floorY() : (o.floorY ?? 0));
  const xr = () => renderer.xr.isPresenting;

  function setFloor() {
    parent.updateMatrixWorld();
    const fl = parent.worldToLocal(new THREE.Vector3(0, floorY(), 0)).y;
    letter.setFloor(fl - anchor.position.y);
  }

  // 사용자 정면에 받침을 한 번 놓는다 (그다음은 공간에 고정)
  function placeInFront() {
    camera.updateMatrixWorld();
    camera.getWorldPosition(_hd);
    camera.getWorldDirection(_fw);
    const fw3 = _fw.clone();
    _fw.y = 0;
    if (_fw.lengthSq() < 1e-6) _fw.set(0, 0, -1);
    _fw.normalize();
    const world = _hd.clone().addScaledVector(_fw, distance);
    world.y = _hd.y - 0.1;
    parent.updateMatrixWorld();
    anchor.position.copy(parent.worldToLocal(world));
    // 월드 기준으로 나를 향하게 (부모가 돌아가 있어도 — 예: VR 리그의 방향)
    anchor.quaternion.setFromAxisAngle(_Y, Math.atan2(-_fw.x, -_fw.z))
      .premultiply(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    anchor.updateMatrixWorld();
    setFloor();
    if (xr()) return;
    // PC: 편지지(아래 단추·연필까지)가 화면에 다 들어오도록 카메라 시선 위로 옮긴다
    let d = o.desktopDistance;
    if (!d) {
      const vFov = THREE.MathUtils.degToRad(camera.fov ?? 50);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect ?? 1.6));
      d = Math.max(0.8 / 2 / Math.tan(vFov / 2), 0.95 / 2 / Math.tan(hFov / 2)) * 1.05;
    }
    letter.paper.updateMatrixWorld(true);
    const paperC = new THREE.Vector3(0, -0.07, 0).applyMatrix4(letter.paper.matrixWorld);
    const shift = _hd.clone().addScaledVector(fw3, d).sub(paperC);
    const wp = anchor.getWorldPosition(new THREE.Vector3()).add(shift);
    anchor.position.copy(parent.worldToLocal(wp));
    anchor.updateMatrixWorld();
    setFloor();
  }

  // 컨트롤러 → 가상의 손: 트리거 = 꼬집기(엄지·검지 끝이 붙음), 그립 = 쥐기. 손바닥 좌표틀은 컨트롤러 자세에서 만든다
  const pads = [0, 1].map((i) => {
    const c = { grip: renderer.xr.getControllerGrip(i), ctrl: renderer.xr.getController(i), trigger: false, squeeze: false,
      data: { thumb: new THREE.Vector3(), index: new THREE.Vector3(), knuckle: new THREE.Vector3(), wrist: new THREE.Vector3(), pinky: new THREE.Vector3(), curl: 0 } };
    if (!c.grip.parent) parent.add(c.grip);
    const isPad = (e) => !e.data?.hand;
    c.ctrl.addEventListener('selectstart', (e) => { if (isPad(e)) c.trigger = true; });
    c.ctrl.addEventListener('selectend', () => { c.trigger = false; });
    c.ctrl.addEventListener('squeezestart', (e) => { if (isPad(e)) c.squeeze = true; });
    c.ctrl.addEventListener('squeezeend', () => { c.squeeze = false; });
    c.ctrl.addEventListener('disconnected', () => { c.trigger = c.squeeze = false; });
    return c;
  });
  const _px = new THREE.Vector3(), _py = new THREE.Vector3(), _pz = new THREE.Vector3();
  function padHand(i) {
    const c = pads[i];
    if (!c.grip.visible) return null;
    c.grip.updateMatrixWorld();
    c.grip.matrixWorld.extractBasis(_px, _py, _pz);
    _px.normalize(); _py.normalize(); _pz.normalize();
    const d = c.data, at = _c.setFromMatrixPosition(c.grip.matrixWorld);
    d.knuckle.copy(at).addScaledVector(_pz, -0.03);
    d.wrist.copy(at).addScaledVector(_pz, 0.06);
    d.pinky.copy(d.knuckle).addScaledVector(_px, 0.05);
    d.index.copy(at).addScaledVector(_pz, -0.07);                 // 단추는 컨트롤러 앞끝으로 누른다
    d.thumb.copy(d.index).addScaledVector(_py, c.trigger ? 0 : 0.06);
    d.curl = c.squeeze ? 1 : 0; d.pad = true;
    return d;
  }

  function readHands() {
    hands.forEach(({ hand, data }, i) => {
      const J = hand.joints;
      const ok = hand.visible !== false && J?.wrist && J['thumb-tip'] && J['index-finger-tip']
        && J['index-finger-phalanx-proximal'] && J['pinky-finger-phalanx-proximal'] && J['index-finger-tip'].visible !== false;
      if (!ok) { input[i] = padHand(i); return; }
      J['thumb-tip'].getWorldPosition(data.thumb);
      J['index-finger-tip'].getWorldPosition(data.index);
      J['index-finger-phalanx-proximal'].getWorldPosition(data.knuckle);
      J['pinky-finger-phalanx-proximal'].getWorldPosition(data.pinky);
      J.wrist.getWorldPosition(data.wrist);
      data.curl = J['middle-finger-tip'] ? handCurl(J, _w.copy(data.wrist)) : 0;
      input[i] = data;
    });
  }

  // ── PC: 마우스 → 가상의 손 ──
  //   마우스가 가리키는 종이 위 지점에 연필 끝이 오도록 손을 옮긴다.
  //   누르면 연필 끝이 종이에 닿고(써짐), 떼면 2cm 떨어진다. 단추도 누르고 있으면 눌린다.
  const M = o.mouse !== false ? {
    hand: { thumb: new THREE.Vector3(), index: new THREE.Vector3(), knuckle: new THREE.Vector3(), wrist: new THREE.Vector3(), pinky: new THREE.Vector3(), curl: 0, mouse: true },
    c: new THREE.Vector3(), n: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(),
    grip: new THREE.Vector3(), tipOff: new THREE.Vector3(), target: new THREE.Vector3(), hit: new THREE.Vector3(),
    ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), plane: new THREE.Plane(),
    pointer: null, pressed: false, depth: 0.02, active: false,
  } : null;
  function paperFrame() {
    letter.paper.updateMatrixWorld(true);
    const m = letter.paper.matrixWorld;
    M.c.setFromMatrixPosition(m);
    M.n.set(0, 0, 1).transformDirection(m);
    M.up.set(0, 1, 0).transformDirection(m);
    M.right.set(1, 0, 0).transformDirection(m);
  }
  function setHand(knuckle) {
    const h = M.hand;
    h.knuckle.copy(knuckle);
    h.wrist.copy(knuckle).addScaledVector(M.up, -0.08).addScaledVector(M.n, 0.03);
    h.pinky.copy(knuckle).addScaledVector(M.right, 0.06);
    h.thumb.copy(knuckle).sub(M.grip);            // 엄지·검지 끝이 붙어 있음 = 꼬집어 쥔 채
    h.index.copy(h.thumb);
  }
  // 연필을 쓰는 자세로 세워서 가상의 손에 쥐여 준다 (끝은 종이 쪽, 윗부분은 오른쪽 위 내 쪽으로)
  function mouseGrab(at) {
    const tipDir = M.n.clone().multiplyScalar(-0.75).addScaledVector(M.up, -0.45).addScaledVector(M.right, -0.35).normalize();
    const gripPos = at.clone().addScaledVector(M.n, M.depth).addScaledVector(tipDir, -PENCIL_LEN / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(_Y, tipDir);
    anchor.updateMatrixWorld();
    const aq = anchor.getWorldQuaternion(new THREE.Quaternion());
    letter.pencil.position.copy(gripPos).applyMatrix4(_m4.copy(anchor.matrixWorld).invert());
    letter.pencil.quaternion.copy(aq.invert().multiply(q));
    letter.pencil.updateMatrixWorld();
    M.grip.copy(M.n).multiplyScalar(0.025).addScaledVector(M.up, 0.02);   // 잡은 자리 → 검지 마디
    setHand(gripPos.clone().add(M.grip));
    M.tipOff.copy(gripPos).addScaledVector(tipDir, PENCIL_LEN / 2).sub(M.hand.knuckle);
    M.target.copy(at);
  }
  function pointOnPaper() {
    if (!M.pointer) return null;
    const r = renderer.domElement.getBoundingClientRect();
    M.ndc.set(((M.pointer.x - r.left) / r.width) * 2 - 1, -((M.pointer.y - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    M.ray.setFromCamera(M.ndc, camera);
    M.plane.setFromNormalAndCoplanarPoint(M.n, M.c);
    return M.ray.ray.intersectPlane(M.plane, M.hit);
  }
  // 편지지(단추 포함) 위인지 — 그 위에서 누른 것만 가로채고, 나머지는 콘텐츠의 마우스 조작으로 그대로 보낸다
  function overPaper(e) {
    if (!letter.active || xr()) return false;
    M.pointer = { x: e.clientX, y: e.clientY };
    paperFrame();
    const p = pointOnPaper();
    if (!p) return false;
    _l.copy(p).applyMatrix4(_inv.copy(letter.paper.matrixWorld).invert());
    return Math.abs(_l.x) < W / 2 + 0.03 && _l.y < H / 2 + 0.03 && _l.y > -H / 2 - 0.09;
  }
  const onDown = (e) => {
    if (e.target !== renderer.domElement || (e.pointerType === 'mouse' && e.button !== 0) || !overPaper(e)) return;
    M.pressed = true;
    e.stopPropagation(); e.preventDefault();       // OrbitControls 같은 콘텐츠 조작이 같이 움직이지 않게
  };
  const onMove = (e) => {
    if (!M.pressed && e.target !== renderer.domElement) return;
    M.pointer = { x: e.clientX, y: e.clientY };
    if (M.pressed) e.stopPropagation();
  };
  const onUp = () => { M.pressed = false; };
  const onLeave = () => { if (!M.pressed) M.pointer = null; };
  if (M) {
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove, { capture: true });
    addEventListener('pointerup', onUp, { capture: true });
    addEventListener('pointercancel', onUp, { capture: true });
    addEventListener('blur', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    if (!renderer.domElement.style.touchAction) renderer.domElement.style.touchAction = 'none';
  }
  function mouseInput(dt) {
    input[0] = input[1] = null;
    if (letter.state !== 'writing') { M.active = false; return; }
    paperFrame();
    const p = pointOnPaper();
    if (!letter.holding) {
      M.depth = 0.02;
      mouseGrab(p ?? M.c);
      M.active = true;
    } else {
      M.depth += ((M.pressed ? -0.004 : 0.02) - M.depth) * Math.min(1, dt * 25);
      if (p) M.target.copy(p);
      setHand(_c.copy(M.target).addScaledVector(M.n, M.depth).sub(M.tipOff));
    }
    input[1] = M.hand;
  }
  // XR 에 들어가면 마우스 손이 쥔 연필을 내려놓는다 (진짜 손으로 다시 집도록)
  const onXRStart = () => {
    if (M?.active && letter.held === 1) { letter.held = -1; letter.tipFilter.reset(); }
    if (M) { M.active = false; M.pressed = false; }
    if (letter.shown) setTimeout(placeInFront, 300);   // 헤드셋 위치가 잡힌 뒤 정면에
  };
  const onXREnd = () => { if (letter.shown) { letter.held = -1; placeInFront(); } };
  renderer.xr.addEventListener('sessionstart', onXRStart);
  renderer.xr.addEventListener('sessionend', onXREnd);

  return {
    letter,
    anchor,
    /** 사용자 정면에 편지지를 띄운다 (PC 에서는 화면 가운데에 꽉 차게) */
    show() { letter.show(); placeInFront(); },
    hide() { letter.hide(); },
    /** 매 프레임 호출 (renderer.setAnimationLoop 안에서). dt = 초 */
    update(dt) {
      if (!letter.shown) return;
      dt = Math.min(dt, 0.1);
      if (!xr() && M) mouseInput(dt);
      else readHands();
      letter.update(dt, input);
    },
    /** 'xr' (손 추적) | 'mouse' (PC) */
    get mode() { return xr() || !M ? 'xr' : 'mouse'; },
    getImage: (type) => letter.getImage(type),
    get state() { return letter.state; },
    get isWriting() { return letter.active; },
    set onSend(f) { letter.onSend = f; },            // 편지가 날아가 사라지는 순간
    set onBeforeSend(f) { letter.onBeforeSend = f; }, // (dataURL) 보내기 직전 편지 이미지
    set onDone(f) { letter.onDone = f; },            // 보내기 연출이 다 끝남
    set onStroke(f) { letter.onStroke = f; },        // (speed) 쓰는 중 — 연필 소리 등
    set onClear(f) { letter.onClear = f; },
    dispose() {
      letter.dispose(); anchor.removeFromParent();
      renderer.xr.removeEventListener('sessionstart', onXRStart);
      renderer.xr.removeEventListener('sessionend', onXREnd);
      if (M) {
        removeEventListener('pointerdown', onDown, { capture: true });
        removeEventListener('pointermove', onMove, { capture: true });
        removeEventListener('pointerup', onUp, { capture: true });
        removeEventListener('pointercancel', onUp, { capture: true });
        removeEventListener('blur', onUp);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
      }
    },
  };
}
