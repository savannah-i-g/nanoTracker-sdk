/**
 * MY CTRL SRC — starter AudioWorkletProcessor for a control-source plugin.
 *
 * What it does: fires a single note on every 8th-note boundary derived
 * from the host's transport clock (12 PPQN-24 ticks = one 8th note).
 *
 * Replace the pattern / scheduling logic to build a step sequencer,
 * an arpeggiator, a chord trigger, a virtual keyboard, etc. The
 * wire-up — `songPosition` intake + `midiOut` emission + parameter
 * updates — is all standard and stays the same.
 *
 * See `docs/23-control-source-plugins.md` for the full reference.
 */

class MyCtrlSrcProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Parameters. Start from the manifest defaults; overwritten by
    // `param` messages from the host on every knob change.
    this._note     = 60;
    this._velocity = 100;
    this._gateFrac = 0.5;

    // Scheduling state.
    this._lastTick     = -1;      // previous ppq24Counter we saw
    this._lastFiredPpq = -Infinity;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === "param") {
        if (msg.key === "note")      this._note     = msg.value | 0;
        if (msg.key === "velocity")  this._velocity = Math.max(1, Math.min(127, msg.value | 0));
        if (msg.key === "gate_frac") this._gateFrac = Math.max(0.05, Math.min(1, msg.value));
        return;
      }

      // Transport reset: the host sends ppq24Counter = 0 on start.
      // Detect the counter rewinding (e.g. after a seek or a stop/start)
      // and re-arm our own scheduling so we don't miss the first beat.
      if (msg.type === "songPosition") {
        const ppq = msg.position.ppq24Counter | 0;
        if (ppq < this._lastTick) {
          this._lastFiredPpq = -Infinity;
        }
        this._lastTick = ppq;

        // 8th note = 12 PPQN-24 ticks. Fire on every boundary crossing.
        // The PPQ counter advances monotonically while playing so we
        // can compare it against the last fire to decide whether to
        // re-trigger. 6 → 16th, 12 → 8th, 24 → quarter.
        const STEP_TICKS = 12;
        const boundary = Math.floor(ppq / STEP_TICKS) * STEP_TICKS;
        if (boundary > this._lastFiredPpq && ppq >= boundary) {
          this._lastFiredPpq = boundary;
          this.fireNote(msg.position.audioTime);
        }
      }
    };

    // Monotonic id counter — every noteOn / noteOff pair shares an id.
    // The host uses it to match releases to their triggers; a new id
    // per note also lets the bus's parentId mechanism trace expansions
    // if a downstream plugin rewrites the event (e.g. an arp).
    this._nextId = 1;
  }

  fireNote(time) {
    const id = this._nextId++;
    // Approximate 8th-note length at 120 BPM = 0.25 s. A real plugin
    // should derive this from `msg.position.bpm` if available, or from
    // the host's tick spacing. Keep it simple for the template.
    const stepSeconds = 0.25;
    const gate = Math.max(0.01, stepSeconds * this._gateFrac);

    this.port.postMessage({
      type: "midiOut",
      event: {
        kind:     "noteOn",
        note:     this._note,
        velocity: this._velocity,
        channel:  0,
        time,
        id,
      },
    });
    this.port.postMessage({
      type: "midiOut",
      event: {
        kind:    "noteOff",
        note:    this._note,
        channel: 0,
        time:    time + gate,
        id,
      },
    });
  }

  process() {
    // No audio generation — control-source plugins emit MIDI only.
    // Returning `true` keeps the processor alive so it continues to
    // receive songPosition messages.
    return true;
  }
}

registerProcessor("my-ctrl-src-processor", MyCtrlSrcProcessor);
