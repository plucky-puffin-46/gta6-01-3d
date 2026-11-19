// Puffin Vice 3D — all sound is synthesised with WebAudio, no audio files.
// Short one-shots (gunshot, punch, crash, pickup, jingles) are built from
// oscillators and filtered noise; the engine hum and the police siren are
// looping nodes whose gain the game drives each frame.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;   // { osc, gain } while driving
    this.siren = null;    // { osc, gain, lfo } while police are close
  }

  // Must be called from a user gesture at least once (the Start button).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone(freq, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, { vol = 0.25, freq = 1200, q = 0.8, delay = 0, sweep = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.now() + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  shot() {
    this.noise(0.14, { vol: 0.5, freq: 2600, q: 0.4, sweep: -2200 });
    this.tone(160, 0.09, { type: 'sawtooth', vol: 0.22, slide: -110 });
  }

  punch() {
    this.noise(0.08, { vol: 0.3, freq: 500, q: 1.2 });
    this.tone(95, 0.08, { type: 'sine', vol: 0.3, slide: -40 });
  }

  crash(intensity = 1) {
    this.noise(0.28, { vol: 0.28 + 0.3 * intensity, freq: 900, q: 0.5, sweep: -650 });
    this.tone(70, 0.22, { type: 'triangle', vol: 0.25 * intensity, slide: -30 });
  }

  carjack() {
    this.tone(220, 0.07, { type: 'square', vol: 0.16 });
    this.tone(330, 0.09, { type: 'square', vol: 0.16, delay: 0.07 });
    this.noise(0.12, { vol: 0.12, freq: 700, delay: 0.02 });
  }

  door() {
    this.noise(0.06, { vol: 0.14, freq: 380, q: 2 });
  }

  pickup() {
    this.tone(880, 0.09, { type: 'sine', vol: 0.22 });
    this.tone(1318, 0.14, { type: 'sine', vol: 0.22, delay: 0.08 });
  }

  cash() {
    this.tone(1567, 0.07, { type: 'square', vol: 0.1 });
    this.tone(2093, 0.12, { type: 'square', vol: 0.1, delay: 0.06 });
  }

  missionDone() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.22, delay: i * 0.11 }));
  }

  missionFail() {
    const notes = [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', vol: 0.2, delay: i * 0.13 }));
  }

  bustedJingle() {
    this.tone(660, 0.14, { type: 'square', vol: 0.14 });
    this.tone(660, 0.14, { type: 'square', vol: 0.14, delay: 0.2 });
    this.tone(440, 0.3, { type: 'square', vol: 0.14, delay: 0.4 });
  }

  // --- Loops ---------------------------------------------------------------

  engineStart() {
    if (!this.ctx || this.engine) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.engine = { osc, gain, filter };
  }

  engineSet(level, rpm) {
    if (!this.engine) return;
    const t = this.now();
    this.engine.gain.gain.setTargetAtTime(0.05 + 0.1 * level, t, 0.08);
    this.engine.osc.frequency.setTargetAtTime(50 + 130 * rpm, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(280 + 700 * rpm, t, 0.06);
  }

  engineStop() {
    if (!this.engine) return;
    const { osc, gain } = this.engine;
    gain.gain.setTargetAtTime(0, this.now(), 0.05);
    setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 220);
    this.engine = null;
  }

  sirenStart() {
    if (!this.ctx || this.siren) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 830;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    this.siren = { osc, lfo, gain };
  }

  sirenSet(level) {
    if (!this.siren) return;
    this.siren.gain.gain.setTargetAtTime(0.055 * level, this.now(), 0.15);
  }

  sirenStop() {
    if (!this.siren) return;
    const { osc, lfo, gain } = this.siren;
    gain.gain.setTargetAtTime(0, this.now(), 0.05);
    setTimeout(() => {
      try { osc.stop(); lfo.stop(); } catch { /* already stopped */ }
    }, 220);
    this.siren = null;
  }
}
