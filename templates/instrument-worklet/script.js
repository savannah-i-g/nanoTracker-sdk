/*
  my-worklet-processor — minimal monophonic instrument

  Receives noteOn / noteOff / param messages from the tracker host
  via this.port. Produces one continuous sawtooth oscillator run
  through a crude one-pole lowpass with an envelope-modulated cutoff.

  The goal of this file is to be the shortest plausible template for
  a legacy v1/v2 AudioWorklet instrument processor. Real plugins
  replace every line of DSP here with their own.

  Parameter routing (important, differs from what the Web Audio
  platform may lead you to expect):

  The nanoTracker host does NOT auto-wire plugin.json parameters
  into AudioParam descriptors for the legacy whole-instrument worklet
  path. Every UI knob change arrives as a port message:

      { type: "param", key, value }

  where `key` matches a `parameters[].key` from plugin.json. Store
  the value on `this` in your `onmessage` handler and read it from
  process(). Declaring `parameterDescriptors` here would give you a
  `parameters` argument in `process()`, but the host never updates
  those AudioParams from knob moves, so they'd be stuck at their
  defaults — don't bother.

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
  constructor() {
    super();

    // Parameter state — kept in sync with plugin.json defaults.
    // Updated from port "param" messages and read in process().
    this.cutoff    = 1200;
    this.resonance = 0.3;
    this.envAmt    = 0.6;
    this.decay     = 0.3;
    this.detune    = 0;

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
        // Store UI-knob changes on instance fields for process() to
        // read. `msg.key` is whatever you declared in plugin.json.
        switch (msg.key) {
          case "cutoff":    this.cutoff    = msg.value; break;
          case "resonance": this.resonance = msg.value; break;
          case "envAmt":    this.envAmt    = msg.value; break;
          case "decay":     this.decay     = msg.value; break;
          case "detune":    this.detune    = msg.value; break;
        }
        break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const chan = output[0];
    const len = chan.length;

    const cutoff    = this.cutoff;
    const resonance = this.resonance;
    const envAmt    = this.envAmt;
    const decay     = this.decay;
    const detune    = this.detune;

    for (let i = 0; i < len; i++) {
      // Envelope: instant attack, exponential decay toward 0 while
      // the note is held, fast release on noteOff.
      if (this._gate) {
        this._env += (0 - this._env) * (1 / (decay * sampleRate));
      } else {
        this._env += (0 - this._env) * (1 / (0.02 * sampleRate));
      }

      // Sawtooth oscillator — naive, not band-limited. For a real
      // plugin use polyBLEP or a wavetable to kill aliasing.
      const freq = this._freq * Math.pow(2, detune / 1200);
      this._phase += freq / sampleRate;
      if (this._phase >= 1) this._phase -= 1;
      const saw = this._phase * 2 - 1;

      // One-pole lowpass with envelope-modulated cutoff.
      const modCut = Math.min(16000, cutoff + this._env * envAmt * 8000);
      const alpha  = Math.exp(-2 * Math.PI * modCut / sampleRate);
      this._lpState = saw * (1 - alpha) + this._lpState * alpha;

      // Soft saturation to tame the aliasing + crude resonance.
      const res = this._lpState + (this._lpState - saw) * resonance;
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
