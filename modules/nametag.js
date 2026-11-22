// Paper name tag (from modules/nametag/index.html), as a classic script: window.createNameTag({text, width, color, curl}) -> Promise<Mesh>
window.createNameTag = (async () => {
const THREE = await import('three');
const FAMILY = 'Parkway Lush';
const font = new FontFace(FAMILY, 'url(' + window.NAMETAG_DATA.font + ')'); document.fonts.add(font); const fontReady = font.load();
let paperP = null;
const loadPaper = () => paperP || (paperP = new Promise((res, rej) => {                    // key the white background out to alpha, once
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const mn = Math.min(p[i], p[i + 1], p[i + 2]); p[i + 3] = Math.round(p[i + 3] * Math.max(0, Math.min(1, (248 - mn) / 30))); }
    x.putImageData(d, 0, 0); res(c); };
  img.onerror = rej; img.src = window.NAMETAG_DATA.paper; }));
return async function createNameTag({ text = 'Name', width = 0.3, color = '#3b2412', curl = 0.012 } = {}) {
  const [paper] = await Promise.all([loadPaper(), fontReady]);
  const aspect = paper.height / paper.width, height = width * aspect;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = Math.round(512 * aspect);
  const ctx = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 1;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H); ctx.drawImage(paper, 0, 0, W, H);
  let size = H * 0.42; ctx.font = size + 'px "' + FAMILY + '"'; const m = ctx.measureText(text); if (m.width > W * 0.70) size *= W * 0.70 / m.width;
  ctx.font = size + 'px "' + FAMILY + '"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.92; ctx.fillStyle = color; ctx.fillText(text, W / 2, H * 0.57); ctx.restore();
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(paper, 0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(width, height, 12, 4), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (width / 2), y = pos.getY(i) / (height / 2); pos.setZ(i, -curl * x * x + curl * 0.25 * Math.sin(y * 2 + x * 3)); }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, emissive: 0x30261a, emissiveMap: tex }));
  mesh.name = 'PaperTag'; return mesh;
};
})().then(f => { window.createNameTag = f; window.nametagReady = true; });
