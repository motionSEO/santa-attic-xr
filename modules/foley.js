// foley.js — small synthesized sounds for handling the ingredients and tools (no sound files needed).
// Each sound is made with Web Audio (noise bursts, filters, short tones) and placed in 3D at the thing that makes it
// (window.Audio3D's panner when it is there, so it uses the same listener as the drawers and the fire).
//   glass(p)   a glass bottle picked up: a little clink + the liquid sloshing inside
//   gurgle(p)  liquid / powder running out of a bottle (call it while pouring)
//   rustle(p)  leaves, herbs, petals: a dry brushing rustle
//   wood(p)    a twig / bark / stick picked up: a dry wooden knock
//   snap(p)    a twig broken in two: a sharp crack with a splintering tail
//   tear(p)    a leafy sprig torn: a short ripping sound
//   fruit(p)   a lemon / bergamot picked up: a soft, firm thud
//   squish(p)  a fruit half squeezed: a juicy squelch and drips
//   stone(p)   the stone mortar / pestle handled or pounded
//   metal(p)   the knife picked up: a light metallic ring
//   powder(p)  something dropped into the mortar: a soft powdery puff
let ctx = null;
const ac = () => {
  if (window.Audio3D?.ctx) ctx = window.Audio3D.ctx;
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
};
const noiseBuf = {};
function noise(c, secs = 1) {        // white noise, cached
  const k = c.sampleRate + ':' + secs; if (noiseBuf[k]) return noiseBuf[k];
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf[k] = b);
}
// where the sound goes: a 3D panner at p (or straight out)
function out(c, p, gain = 1) {
  const g = c.createGain(); g.gain.value = gain;
  if (p && window.Audio3D?.panner) { const pn = window.Audio3D.panner(0.5, 1.4); window.Audio3D.setPos(pn, p); g.connect(pn); pn.connect(c.destination); }
  else g.connect(c.destination);
  return g;
}
const filt = (c, type, f, q = 0.8) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
// a noise burst through a filter with an envelope [[t, level], ...]
function burst(c, dst, t0, env, type, f, q, f2) {
  const s = c.createBufferSource(); s.buffer = noise(c, 2); const fl = filt(c, type, f, q), g = c.createGain();
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + env[env.length - 1][0]);
  g.gain.setValueAtTime(0.0001, t0); for (const [t, v] of env) g.gain.linearRampToValueAtTime(Math.max(0.0001, v), t0 + t);
  s.connect(fl); fl.connect(g); g.connect(dst); s.start(t0, Math.random() * 1.2); s.stop(t0 + env[env.length - 1][0] + 0.05);
}
function tone(c, dst, t0, f, dur, v, type = 'sine', f2 = 0) {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dst); o.start(t0); o.stop(t0 + dur + 0.02);
}
const R = (a, b) => a + Math.random() * (b - a);
const last = {};
// one call per kind at most every `gap` seconds (a grab can arrive as two events)
function play(kind, gap, fn) { const now = performance.now() / 1000; if (now - (last[kind] || 0) < gap) return; last[kind] = now; try { fn(ac()); } catch (e) { console.warn("foley", kind, e.message); } }

export const Foley = {
  glass(p) { play('glass', 0.12, c => {
    const d = out(c, p, 0.9), t = c.currentTime;
    for (const f of [R(2400, 2700), R(3900, 4300), R(6100, 6600)]) tone(c, d, t, f, R(0.25, 0.4), 0.05);   // clink
    // slosh: band-passed noise swaying, then a couple of liquid blips
    burst(c, d, t + 0.03, [[0.08, 0.35], [0.22, 0.12], [0.34, 0.28], [0.55, 0.0001]], 'bandpass', R(500, 700), 2.5, R(900, 1300));
    for (let i = 0; i < 3; i++) tone(c, d, t + R(0.08, 0.45), R(380, 620), R(0.05, 0.09), 0.08, 'sine', R(800, 1200));
  }); },
  gurgle(p) { play('gurgle', 0.09, c => {
    const d = out(c, p, 0.8), t = c.currentTime;
    tone(c, d, t, R(260, 520), R(0.05, 0.1), 0.09, 'sine', R(700, 1300));
    burst(c, d, t, [[0.04, 0.12], [0.14, 0.0001]], 'bandpass', R(1500, 2500), 1.2);
  }); },
  rustle(p) { play('rustle', 0.15, c => {
    const d = out(c, p, 0.9), t = c.currentTime;
    for (let i = 0; i < 6; i++) { const t1 = t + R(0, 0.32); burst(c, d, t1, [[0.01, R(0.15, 0.35)], [R(0.04, 0.09), 0.0001]], 'highpass', R(2500, 4500), 0.7); }
    burst(c, d, t, [[0.05, 0.12], [0.3, 0.06], [0.42, 0.0001]], 'bandpass', 3200, 0.6);
  }); },
  wood(p) { play('wood', 0.12, c => {
    const d = out(c, p, 0.9), t = c.currentTime;
    tone(c, d, t, R(520, 680), 0.09, 0.22, 'triangle', R(380, 460));
    burst(c, d, t, [[0.003, 0.5], [0.05, 0.0001]], 'bandpass', R(1400, 1900), 3);
    tone(c, d, t + 0.07, R(820, 980), 0.06, 0.08, 'triangle');
  }); },
  snap(p) { play('snap', 0.2, c => {
    const d = out(c, p, 1.1), t = c.currentTime;
    burst(c, d, t, [[0.002, 1], [0.03, 0.0001]], 'highpass', 1800, 0.7);                  // the crack
    tone(c, d, t, R(900, 1100), 0.05, 0.25, 'square', 300);
    for (let i = 0; i < 7; i++) { const t1 = t + 0.02 + R(0, 0.22); burst(c, d, t1, [[0.002, R(0.2, 0.5)], [0.015, 0.0001]], 'bandpass', R(2000, 5000), 2); }   // splinters
  }); },
  tear(p) { play('tear', 0.2, c => {
    const d = out(c, p, 1), t = c.currentTime, n = 14;
    for (let i = 0; i < n; i++) burst(c, d, t + i * 0.022 + R(0, 0.01), [[0.003, R(0.25, 0.5)], [0.02, 0.0001]], 'bandpass', R(2200, 3800), 1.5);
    this.rustle?.(p);
  }); },
  fruit(p) { play('fruit', 0.12, c => {
    const d = out(c, p, 1), t = c.currentTime;
    tone(c, d, t, R(150, 190), 0.12, 0.35, 'sine', 90);
    burst(c, d, t, [[0.005, 0.25], [0.07, 0.0001]], 'lowpass', 900, 0.7);
  }); },
  squish(p) { play('squish', 0.2, c => {
    const d = out(c, p, 1), t = c.currentTime;
    burst(c, d, t, [[0.03, 0.55], [0.18, 0.3], [0.32, 0.0001]], 'bandpass', 1400, 3, 450);   // squelch
    burst(c, d, t + 0.05, [[0.02, 0.25], [0.2, 0.0001]], 'lowpass', 700, 1);
    for (let i = 0; i < 4; i++) tone(c, d, t + 0.25 + i * R(0.12, 0.2), R(900, 1400), 0.06, 0.07, 'sine', R(1800, 2600));   // drips
  }); },
  stone(p, hard = false) { play('stone' + hard, 0.1, c => {
    const d = out(c, p, hard ? 1.2 : 0.8), t = c.currentTime;
    tone(c, d, t, hard ? R(110, 140) : R(220, 260), hard ? 0.18 : 0.1, hard ? 0.5 : 0.25, 'sine', hard ? 60 : 160);
    burst(c, d, t, [[0.003, hard ? 0.6 : 0.3], [hard ? 0.09 : 0.05, 0.0001]], 'bandpass', hard ? 900 : 1600, 1.5);
  }); },
  metal(p) { play('metal', 0.15, c => {
    const d = out(c, p, 0.7), t = c.currentTime;
    for (const f of [R(3100, 3300), R(5200, 5600), R(7400, 7900)]) tone(c, d, t, f, R(0.3, 0.5), 0.035);
    burst(c, d, t, [[0.004, 0.2], [0.06, 0.0001]], 'highpass', 4000, 0.7);
  }); },
  // a quick swish of the hand when something is picked up
  whoosh(p) { play('whoosh', 0.15, c => {
    const d = out(c, p, 0.8), t = c.currentTime;
    burst(c, d, t, [[0.07, 0.4], [0.2, 0.0001]], 'bandpass', 600, 1.2, 2600);
  }); },
  // a sparkly rising chime (뾰로로옹) when an ingredient goes in / a step is done
  chime(p) { play('chime', 0.25, c => {
    const d = out(c, p, 0.8), t = c.currentTime, notes = [1047, 1319, 1568, 2093, 2637];
    notes.forEach((f, i) => { tone(c, d, t + i * 0.06, f, 0.5, 0.09, 'sine', f * 1.02); tone(c, d, t + i * 0.06, f * 2, 0.25, 0.025, 'triangle'); });
    tone(c, d, t + 0.3, 2093, 0.9, 0.05, 'sine', 2160);
  }); },
  // a leaf / petal plucked off (푝): a tiny pop that bends up, with a short leafy tick
  pluck(p) { play('pluck', 0.08, c => {
    const d = out(c, p, 1), t = c.currentTime;
    tone(c, d, t, R(420, 560), 0.07, 0.35, 'sine', R(1100, 1500));
    burst(c, d, t, [[0.002, 0.35], [0.025, 0.0001]], 'highpass', 3000, 0.7);
  }); },
  // pounding in the stone mortar: a thud and the grinding scrape of the pestle
  grind(p) { play('grind', 0.15, c => {
    const d = out(c, p, 1.1), t = c.currentTime;
    tone(c, d, t, R(105, 130), 0.2, 0.5, 'sine', 55);
    burst(c, d, t, [[0.003, 0.55], [0.08, 0.0001]], 'bandpass', 800, 1.5);
    burst(c, d, t + 0.05, [[0.05, 0.22], [0.25, 0.15], [0.4, 0.0001]], 'bandpass', R(1800, 2400), 4, R(1200, 1500));
  }); },
  // powder running out of a bottle / the mortar: a fine sandy hiss
  sand(p) { play('sand', 0.12, c => {
    const d = out(c, p, 0.7), t = c.currentTime;
    burst(c, d, t, [[0.03, 0.2], [0.12, 0.16], [0.2, 0.0001]], 'bandpass', R(3500, 5000), 0.9);
    for (let i = 0; i < 4; i++) burst(c, d, t + R(0, 0.15), [[0.002, 0.15], [0.01, 0.0001]], 'highpass', 5000, 0.7);
  }); },
  // the mold lid pressed down firmly (꾸욱): a squeezing creak that settles into a soft thump
  press(p) { play('press', 0.4, c => {
    const d = out(c, p, 1.1), t = c.currentTime;
    burst(c, d, t, [[0.1, 0.25], [0.35, 0.3], [0.45, 0.0001]], 'bandpass', 380, 4, 220);
    tone(c, d, t, 140, 0.45, 0.15, 'triangle', 90);
    tone(c, d, t + 0.42, 95, 0.2, 0.45, 'sine', 50);
    burst(c, d, t + 0.42, [[0.004, 0.4], [0.08, 0.0001]], 'lowpass', 600, 0.7);
  }); },
  // a hand slapping / swishing the basin water (찰박): a wet slap and a few bubbly drops
  splash(p, k = 1) { play('splash', 0.09, c => {
    const d = out(c, p, 0.6 + 0.6 * k), t = c.currentTime;
    burst(c, d, t, [[0.004, 0.6], [0.05, 0.25], [0.18, 0.0001]], 'bandpass', R(900, 1400), 1.1, R(500, 700));
    burst(c, d, t + 0.01, [[0.01, 0.3], [0.12, 0.0001]], 'highpass', 3000, 0.7);
    for (let i = 0; i < 3 + Math.round(k * 3); i++) tone(c, d, t + R(0.03, 0.3), R(500, 1100), R(0.04, 0.08), 0.07, 'sine', R(1200, 2200));
  }); },
  powder(p) { play('powder', 0.1, c => {
    const d = out(c, p, 0.8), t = c.currentTime;
    burst(c, d, t, [[0.04, 0.3], [0.25, 0.0001]], 'lowpass', 1800, 0.6, 500);
  }); }
};
// which sound an ingredient makes when it is picked up / handled
export function grabSound(id, kind) {
  const ING_SND = { fairySugar: 'glass', starDust: 'glass', benzoin: 'glass', turmeric: 'glass', coconutOil: 'glass',
    bergamot: 'fruit', lemon: 'fruit', ginger: 'wood', rosewood: 'wood', cedarwood: 'wood', cinnamon: 'wood', vanilla: 'wood',
    eucalyptus: 'rustle', mint: 'rustle', lemongrass: 'rustle', fir: 'rustle', rose: 'rustle', lavender: 'rustle' };
  return kind || ING_SND[id] || null;
}
window.Foley = Foley;
