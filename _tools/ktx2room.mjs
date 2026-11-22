// room.glb -> room.ktx2.glb : every texture re-encoded as KTX2 (UASTC + zstd, mipmaps), sized by how big the object that uses it is.
// usage: node ktx2room.mjs <in.glb> <out.glb>
import fs from 'fs';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
const [, , inp, outp] = process.argv;
const buf = fs.readFileSync(inp);
const jl = buf.readUInt32LE(12), json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
const binStart = 20 + jl + 8, bin = buf.slice(binStart, binStart + buf.readUInt32LE(20 + jl));

// ---- how big is the biggest object using each image? (cumulative node scale * mesh bbox)
const meshExt = json.meshes.map(m => Math.max(0, ...m.primitives.map(p => { const a = json.accessors[p.attributes.POSITION]; return Math.max(...a.max.map((v, i) => v - a.min[i])); })));
const imgDim = new Array(json.images.length).fill(0), imgRole = new Array(json.images.length).fill('data');
const texImg = t => json.textures[t].source;
const useTex = (mat, imgs) => {
  const m = json.materials[mat]; if (!m) return;
  const slots = [['color', m.pbrMetallicRoughness?.baseColorTexture], ['color', m.emissiveTexture], ['normal', m.normalTexture], ['data', m.occlusionTexture], ['data', m.pbrMetallicRoughness?.metallicRoughnessTexture]];
  for (const [role, ti] of slots) if (ti) { const im = texImg(ti.index); imgs.push([im, role]); }
};
function walk(ni, sc) {
  const n = json.nodes[ni], s = n.scale ? Math.max(...n.scale.map(Math.abs)) * sc : sc;
  if (n.mesh != null) { const ext = meshExt[n.mesh] * s; for (const p of json.meshes[n.mesh].primitives) { const imgs = []; useTex(p.material, imgs); for (const [im, role] of imgs) { imgDim[im] = Math.max(imgDim[im], ext); if (role === 'color' || imgRole[im] === 'data') imgRole[im] = role; if (role === 'normal') imgRole[im] = 'normal'; } } }
  (n.children || []).forEach(c => walk(c, s));
}
json.scenes[json.scene || 0].nodes.forEach(n => walk(n, 1));
const tier = d => d < 0.3 ? 256 : d < 0.8 ? 512 : d < 1.6 ? 1024 : 2048;

const imageDecoder = async b => { const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
const newImg = new Map(); let inB = 0, outB = 0, i = 0;
for (let k = 0; k < json.images.length; k++) {
  const im = json.images[k], bv = json.bufferViews[im.bufferView];
  const src = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const target = tier(imgDim[k] || 1), role = imgRole[k];
  const m = await sharp(src).metadata(), sc = Math.min(1, target / Math.max(m.width, m.height)), r4 = v => Math.max(4, Math.round(v * sc / 4) * 4);   // KTX2 block compression needs multiples of 4
  const png = await sharp(src).resize({ width: r4(m.width), height: r4(m.height), fit: 'fill' }).ensureAlpha().png().toBuffer();   // downsize first, then hand to the encoder
  const out = await encodeToKTX2(new Uint8Array(png), { isUASTC: role === 'normal', generateMipmap: true, needSupercompression: role === 'normal', qualityLevel: 160, isNormalMap: role === 'normal',
    isPerceptual: role === 'color', isSetKTX2SRGBTransferFunc: role === 'color', imageDecoder, enableDebug: false });
  newImg.set(im.bufferView, Buffer.from(out)); inB += src.length; outB += out.length;
  process.stdout.write(`\r${++i}/${json.images.length}  ${role.padEnd(6)} ${target}px  ${(src.length / 1024) | 0}KB -> ${(out.length / 1024) | 0}KB      `);
}
console.log('\nimages total', (inB / 1048576).toFixed(1), 'MB ->', (outB / 1048576).toFixed(1), 'MB');

// ---- rebuild the BIN chunk with the new image data, fix every bufferView offset
const parts = []; let off = 0;
json.bufferViews.forEach((bv, idx) => {
  const data = newImg.get(idx) || bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
  bv.byteOffset = off; bv.byteLength = data.length; parts.push(data); off += data.length;
});
const tail = (4 - (off % 4)) % 4; if (tail) { parts.push(Buffer.alloc(tail)); off += tail; }
json.buffers[0].byteLength = off;
json.images.forEach(im => { im.mimeType = 'image/ktx2'; });
json.textures.forEach(t => { t.extensions = Object.assign({}, t.extensions, { KHR_texture_basisu: { source: t.source } }); delete t.source; });
for (const k of ['extensionsUsed', 'extensionsRequired']) { json[k] = json[k] || []; if (!json[k].includes('KHR_texture_basisu')) json[k].push('KHR_texture_basisu'); }
let js = Buffer.from(JSON.stringify(json), 'utf8'); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const binBuf = Buffer.concat(parts), total = 12 + 8 + js.length + 8 + binBuf.length;
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(outp, Buffer.concat([head, jh, js, bh, binBuf]));
console.log('wrote', outp, (total / 1048576).toFixed(1), 'MB');
