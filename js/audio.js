// Sonidos sintetizados con WebAudio (sin archivos externos)
class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.budget = 0;
    this.noiseBuf = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.value = this.volume;
  }

  setEnabled(v) { this.enabled = v; }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  frame() { this.budget = 14; }

  env(gain, t0, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  tone(freq, type, dur, peak, t0, slideTo) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    this.env(g, t0, 0.003, dur, peak);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noise(dur, peak, t0, filterType, freq, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this.env(g, t0, 0.002, dur, peak);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random() * 0.3); s.stop(t0 + dur + 0.05);
  }

  play(type, intensity = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (this.budget <= 0 && type !== 'ui') return;
    this.budget--;
    const t = this.ctx.currentTime + 0.005;
    const k = Math.max(0.02, Math.min(1, intensity));
    switch (type) {
      case 'cue':
        this.noise(0.05, 0.5 * k + 0.08, t, 'bandpass', 2400, 0.8);
        this.tone(170, 'sine', 0.09, 0.45 * k + 0.05, t, 90);
        break;
      case 'ball':
        this.tone(2600 + Math.random() * 500, 'sine', 0.035, 0.55 * k, t);
        this.tone(1450 + Math.random() * 200, 'triangle', 0.05, 0.25 * k, t);
        this.noise(0.02, 0.3 * k, t, 'highpass', 3500);
        break;
      case 'cushion':
        this.noise(0.09, 0.45 * k, t, 'lowpass', 380, 1.2);
        this.tone(95, 'sine', 0.1, 0.35 * k, t, 70);
        break;
      case 'pocket':
        this.tone(120, 'sine', 0.22, 0.6, t, 55);
        this.noise(0.12, 0.25, t + 0.04, 'lowpass', 700);
        this.tone(1900, 'sine', 0.025, 0.12, t + 0.12);
        this.tone(1600, 'sine', 0.025, 0.09, t + 0.19);
        break;
      case 'ui':
        this.tone(880, 'sine', 0.05, 0.12, t, 660);
        break;
      case 'chat':
        this.tone(740, 'sine', 0.07, 0.14, t);
        this.tone(988, 'sine', 0.09, 0.14, t + 0.07);
        break;
      case 'turn':
        this.tone(523, 'triangle', 0.08, 0.16, t);
        this.tone(784, 'triangle', 0.12, 0.16, t + 0.08);
        break;
      case 'foul':
        this.tone(220, 'sawtooth', 0.25, 0.08, t, 120);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', 0.22, 0.18, t + i * 0.11));
        break;
      default: break;
    }
  }
}

export const sfx = new Sfx();
