/*
  my-worklet-processor — minimal monophonic instrument

  Receives noteOn / noteOff / param messages from the tracker host
  via this.port. Produces one continuous sawtooth oscillator run
  through a crude one-pole lowpass with an envelope-modulated cutoff.

  The goal of this file is to be the shortest plausible template for
  a v1/v2 AudioWorklet instrument processor. Real plugins replace
  every line here with their own DSP.

  Message protocol (host → worklet):
    { type: "noteOn", note, velocity, frequency }
    { type: "noteOff", note }
    { type: "allNotesOff" }
    { type: "param", key, value }

  Register one or more processors at the bottom of the file with
  registerProcessor("name", Class). The "name" string must match
  `dsp.processorName` in plugin.json.
*/

class MyWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    // AudioParam declarations exposed on the AudioWorkletNode side.
    // The nanoTracker host forwards param changes for matching keys
    // in plugin.json to these via setValueAtTime. Everything else
    // arrives as a generic { type: "param" } message.
    return [
      { name: "cutoff",    defaultValue: 1200, minValue: 40,  maxValue: 16000, automationRate: "k-rate" },
      { name: "resonance", defaultValue: 0.3,  minValue: 0,   maxValue: 0.95,  automationRate: "k-rate" },
      { name: "envAmt",    defaultValue: 0.6,  minValue: 0,   maxValue: 1,     automationRate: "k-rate" },
      { name: "decay",     defaultValue: 0.3,  minValue: 0.01, maxValue: 2,    automationRate: "k-rate" },
      { name: "detune",    defaultValue: 0,    minValue: -100, maxValue: 100,  automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this._phase = 0;
    this._freq = 0;
    this._gate = 0;      // 1 while a note is held
    this._env = 0;       // current envelope level
    this._lpState = 0;   // one-pole lowpass state
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "noteOn":
        // The host computes frequency from the MIDI note; use it
        // directly rather than recomputing here.
        this._freq = msg.frequency ?? 440;
        this._env  = 1;
        this._gate = 1;
        break;
      case "noteOff":
        this._gate = 0;
        break;
      case "allNotesOff":
        this._gate = 0;
        this._env  = 0;
        break;
      case "param":
        // Non-AudioParam parameter updates land here. For this
        // template all params are AudioParams (declared above), so
        // this branch is unused — but leave it so authors know the
        // shape.
        break;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const chan = output[0];
    const len = chan.length;

    const cutoff    = parameters.cutoff;
    const resonance = parameters.resonance;
    const envAmt    = parameters.envAmt;
    const decay     = parameters.decay;
    const detune    = parameters.detune;

    for (let i = 0; i < len; i++) {
      // k-rate params are length-1 arrays; a-rate would be length=len.
      const c   = cutoff[0]    ?? cutoff[i]    ?? 1200;
      const r   = resonance[0] ?? resonance[i] ?? 0.3;
      const env = envAmt[0]    ?? envAmt[i]    ?? 0.6;
      const dec = decay[0]     ?? decay[i]     ?? 0.3;
      const det = detune[0]    ?? detune[i]    ?? 0;

      // Envelope: instant attack, exponential decay toward 0 while
      // the note is held, fast release on noteOff.
      if (this._gate) {
        this._env += (0 - this._env) * (1 / (dec * sampleRate));
      } else {
        this._env += (0 - this._env) * (1 / (0.02 * sampleRate));
      }

      // Sawtooth oscillator — naive, not band-limited. For a real
      // plugin use polyBLEP or a wavetable to kill aliasing.
      const freq = this._freq * Math.pow(2, det / 1200);
      this._phase += freq / sampleRate;
      if (this._phase >= 1) this._phase -= 1;
      const saw = this._phase * 2 - 1;

      // One-pole lowpass with envelope-modulated cutoff.
      const modCut = Math.min(16000, c + this._env * envAmt[0] * 8000);
      const alpha  = Math.exp(-2 * Math.PI * modCut / sampleRate);
      this._lpState = saw * (1 - alpha) + this._lpState * alpha;

      // Soft saturation to tame the aliasing + crude resonance.
      const res = this._lpState + (this._lpState - saw) * r;
      chan[i] = Math.tanh(res) * 0.4;
    }

    // Mirror to remaining output channels (stereo → same signal).
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(chan);
    }

    return true;
  }
}

registerProcessor("my-worklet-processor", MyWorkletProcessor);
