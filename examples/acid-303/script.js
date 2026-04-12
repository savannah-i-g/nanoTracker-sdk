/*
  acid-303-processor — monophonic TB-303-style bassline synth.

  Legacy v1/v2 whole-instrument AudioWorklet. Parameter changes
  arrive as `{ type: "param", key, value }` messages on this.port
  (the host's instrument worklet adapter does not touch AudioParams
  for this form — port messages are the only live parameter path).
  Values are stored directly on `this` and read in process().

  Signal path per sample:
    polyBLEP saw or square  →  4-pole Stilson/Smith ladder filter
    →  tanh drive  →  amp VCA  →  out

  Filter envelope retriggers on each noteOn and decays exponentially
  toward 0 under user control. Accent is MIDI velocity ≥ 100 and
  boosts env-mod, resonance and gain for that note. Slides are
  legato: if a new noteOn arrives while the previous note is still
  gated, pitch glides instead of retriggering the envelope.
*/

const ACCENT_THRESHOLD = 100;

class Acid303Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Params — updated from the port and read every process block.
    this.waveform  = 0;
    this.tuning    = 0;
    this.cutoff    = 800;
    this.resonance = 0.75;
    this.envMod    = 0.6;
    this.decay     = 0.4;
    this.accent    = 0.6;
    this.slideTime = 0.08;
    this.drive     = 0.25;
    this.volume    = 0.8;

    // Voice state.
    this._phase  = 0;
    this._freq   = 220;
    this._target = 220;

    this._gate      = 0;
    this._filtEnv   = 0;
    this._ampEnv    = 0;
    this._accentEnv = 0;

    // Stilson/Smith ladder state
    this._s0 = 0; this._s1 = 0; this._s2 = 0; this._s3 = 0; this._s4 = 0;
    this._prev1 = 0; this._prev2 = 0; this._prev3 = 0;

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "noteOn": {
        const f = msg.frequency || 440;
        const vel = msg.velocity ?? 100;
        const slide = this._gate === 1;
        this._target = f;
        if (!slide) {
          this._freq = f;
          this._filtEnv = 1;
          this._ampEnv = 1;
        }
        if (vel >= ACCENT_THRESHOLD) this._accentEnv = 1;
        this._gate = 1;
        break;
      }
      case "noteOff":
        this._gate = 0;
        break;
      case "allNotesOff":
        this._gate = 0;
        this._ampEnv = 0;
        this._filtEnv = 0;
        this._accentEnv = 0;
        break;
      case "setPitch":
        if (typeof msg.frequency === "number") this._target = msg.frequency;
        break;
      case "param":
        switch (msg.key) {
          case "waveform":  this.waveform  = msg.value; break;
          case "tuning":    this.tuning    = msg.value; break;
          case "cutoff":    this.cutoff    = msg.value; break;
          case "resonance": this.resonance = msg.value; break;
          case "envMod":    this.envMod    = msg.value; break;
          case "decay":     this.decay     = msg.value; break;
          case "accent":    this.accent    = msg.value; break;
          case "slideTime": this.slideTime = msg.value; break;
          case "drive":     this.drive     = msg.value; break;
          case "volume":    this.volume    = msg.value; break;
        }
        break;
    }
  }

  _polyBlep(t, dt) {
    if (t < dt) {
      const x = t / dt;
      return x + x - x * x - 1;
    }
    if (t > 1 - dt) {
      const x = (t - 1) / dt;
      return x * x + x + x + 1;
    }
    return 0;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const chan = output[0];
    const len = chan.length;
    const sr = sampleRate;

    const waveform  = this.waveform | 0;
    const cutoffHz  = this.cutoff;
    const reso      = this.resonance;
    const envMod    = this.envMod;
    const decay     = this.decay;
    const accentAmt = this.accent;
    const slideTime = this.slideTime;
    const drive     = this.drive;
    const volume    = this.volume;

    const detuneRatio = Math.pow(2, this.tuning / 1200);

    const filtDecayK = 1 - Math.exp(-1 / (decay * sr));
    const ampRelK    = 1 - Math.exp(-1 / (0.015 * sr));
    const ampAtkK    = 1 - Math.exp(-1 / (0.003 * sr));
    const slideK     = 1 - Math.exp(-1 / (slideTime * sr));
    const accDecayK  = 1 - Math.exp(-1 / (0.18 * sr));

    for (let i = 0; i < len; i++) {
      this._freq += (this._target - this._freq) * slideK;

      if (this._gate) {
        this._ampEnv += (1 - this._ampEnv) * ampAtkK;
      } else {
        this._ampEnv += (0 - this._ampEnv) * ampRelK;
      }
      this._filtEnv   -= this._filtEnv   * filtDecayK;
      this._accentEnv -= this._accentEnv * accDecayK;

      const freq = this._freq * detuneRatio;
      const dt = freq / sr;
      this._phase += dt;
      if (this._phase >= 1) this._phase -= 1;

      let osc;
      if (waveform === 0) {
        osc = 2 * this._phase - 1 - this._polyBlep(this._phase, dt);
      } else {
        const naive = this._phase < 0.5 ? 1 : -1;
        osc = naive + this._polyBlep(this._phase, dt)
                    - this._polyBlep((this._phase + 0.5) % 1, dt);
      }

      const accentKick = this._accentEnv * accentAmt;
      const envContribution = this._filtEnv * (envMod + 0.6 * accentKick);
      const octaves = 7 * envContribution;
      let fcHz = cutoffHz * Math.pow(2, octaves);
      if (fcHz < 40) fcHz = 40;
      if (fcHz > 0.49 * sr) fcHz = 0.49 * sr;

      const res = Math.min(1.15, reso + 0.3 * accentKick);

      // Stilson/Smith 4-pole transistor ladder approximation.
      const f = (fcHz / sr) * 1.16;
      const fb = res * 4.0 * (1.0 - 0.15 * f * f);
      let x = osc - this._s4 * fb;
      x *= 0.35013 * (f * f) * (f * f);

      this._s1 = x + 0.3 * this._s0 + (1.0 - f) * this._s1;
      this._s0 = x;
      this._s2 = this._s1 + 0.3 * this._prev1 + (1.0 - f) * this._s2;
      this._prev1 = this._s1;
      this._s3 = this._s2 + 0.3 * this._prev2 + (1.0 - f) * this._s3;
      this._prev2 = this._s2;
      this._s4 = this._s3 + 0.3 * this._prev3 + (1.0 - f) * this._s4;
      this._prev3 = this._s3;

      let y = this._s4;
      y -= (y * y * y) / 6;

      const driveGain = 1 + drive * 4;
      y = Math.tanh(y * driveGain);

      const ampGain = this._ampEnv * (1 + 0.6 * accentKick);
      chan[i] = y * ampGain * volume * 0.7;
    }

    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(chan);
    }

    return true;
  }
}

registerProcessor("acid-303-processor", Acid303Processor);
