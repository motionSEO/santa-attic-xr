// 3D (positional) audio via Web Audio. Sounds are embedded (modules/audio.data.js, base64 mp3) and decoded to buffers, because
// a double-clicked file:// page cannot route <audio> elements through Web Audio (Chrome outputs silence). Classic script.
window.Audio3D = (() => {
  let ctx = null; const buffers = {}, bytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer;
  const get = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
  const resume = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => addEventListener(e, () => { get(); resume(); }, { passive: true }));
  const decode = async key => buffers[key] || (buffers[key] = get().decodeAudioData(bytes((key === 'drawer' || key === 'fire' || key === 'cut') ? window.AUDIO_B64[key] : window.AUDIO_B64.bgm[+key.slice(3)])));
  const panner = (ref, rolloff) => { const p = get().createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 60; return p; };
  const setPos = (p, v) => { if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z); };
  const A = {
    get ctx() { return get(); }, resume, decode, panner, setPos,
    /** call every frame with the (XR) camera: moves the listener to the player's head */
    update(camera) {
      if (!ctx) return; const l = ctx.listener, e = camera.matrixWorld.elements, t = ctx.currentTime;
      const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
      if (l.positionX) { l.positionX.value = e[12]; l.positionY.value = e[13]; l.positionZ.value = e[14]; l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz; l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz; }
      else { l.setPosition(e[12], e[13], e[14]); l.setOrientation(fx, fy, fz, ux, uy, uz); }
    },
    /** a looping sound at a fixed point */
    async loopAt(key, pos, gain = 1, ref = 0.8, rolloff = 1.4) {
      const buf = await decode(key), s = get().createBufferSource(), g = get().createGain(), p = panner(ref, rolloff);
      s.buffer = buf; s.loop = true; g.gain.value = gain; setPos(p, pos); s.connect(g); g.connect(p); p.connect(get().destination); s.start(); return s;
    },
    /** a one-shot sound at a point, a little random in pitch */
    async shot(key, pos, gain = 1, rate = 1) {
      const buf = await decode(key), s = get().createBufferSource(), g = get().createGain(), p = panner(0.5, 1.6);
      s.buffer = buf; s.playbackRate.value = rate * (0.95 + Math.random() * 0.1); g.gain.value = gain; setPos(p, pos); s.connect(g); g.connect(p); p.connect(get().destination); s.start();
    },
    drawer(pos, closing) { A.shot('drawer', pos, closing ? 0.7 : 1, closing ? 1.1 : 1); },
    /** record-player sound: band-limited, soft saturation, wow/flutter, hiss + crackle. Returns {input, output, wow(t)} */
    vinylChain(out) {
      const c = get(), mk = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
      const hp = mk('highpass', 110), lp = mk('lowpass', 6200), mid = mk('peaking', 1800, 0.8); mid.gain.value = 3;
      const sat = c.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); } sat.curve = cv;
      const music = c.createGain(); music.gain.value = 0.9; music.connect(hp); hp.connect(mid); mid.connect(sat); sat.connect(lp); lp.connect(out);
      // crackle + hiss: 6 s looping noise buffer, quiet, with random pops
      const len = c.sampleRate * 6, nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
      for (let k = 0; k < 26; k++) { const at = (Math.random() * (len - 400)) | 0, a = 0.2 + Math.random() * 0.6; for (let j = 0; j < 40 + Math.random() * 120; j++) d[at + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 18); }
      const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true; const nf = mk('highpass', 900), ng = c.createGain(); ng.gain.value = 0.55; ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start();
      return { input: music, wow: (src, t) => { if (src.detune) src.detune.value = Math.sin(t * 3.1) * 6 + Math.sin(t * 0.45) * 9; } };
    },
  };
  return A;
})();
