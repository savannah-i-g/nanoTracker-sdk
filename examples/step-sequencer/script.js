/**
 * STEP SEQ 16 — AudioWorkletProcessor
 *
 * A 16-step single-lane MIDI step sequencer.
 *
 * Clock source: the host posts `songPosition` messages to the processor's
 * port whenever the transport is running. Each message carries a
 * `position.ppq24Counter` integer that increments once per PPQN tick at
 * PPQN-24. One 16th note = 6 ticks.
 *
 * MIDI output: the processor posts `midiOut` messages with noteOn /
 * noteOff events back through the port. The host reads them, looks up the
 * plugin's first `midi-out` endpoint, and dispatches events through the
 * MIDI bus to whatever downstream instruments or devices are cabled in.
 *
 * Parameters arrive as `{ type: "param", key, value }` messages and are
 * applied immediately (no sample-accurate scheduling needed for
 * sequencer state).
 */

class StepSeq16Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    // ── Sequencer state ──────────────────────────────────────
    this._steps = new Array(16).fill(0);
    this._steps[0]  = 1;
    this._steps[3]  = 1;
    this._steps[6]  = 1;
    this._steps[9]  = 1;
    this._steps[12] = 1;
    this._steps[15] = 1;

    this._gateLength = 0.5;   // seconds fraction of a 16th note
    this._rootNote   = 60;    // MIDI note number for all active steps

    // Monotonic id counter — the host uses this to match noteOff to noteOn.
    this._nextId = 1;

    // Track which step index we last fired so we don't re-fire on the
    // same tick if the host sends multiple songPosition messages per block.
    this._lastFiredStep = -1;

    // Remember the last ppq24Counter we saw so we can detect transport
    // restarts (counter resets) and reset our own step position.
    this._lastTick = -1;

    // Current step cursor, independent of ppq24Counter so the pattern
    // loops correctly even when the transport loops.
    this._cursor = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      // ── Parameter updates ────────────────────────────────────
      if (msg.type === "param") {
        if (msg.key === "gate_length") {
          this._gateLength = Math.max(0.05, Math.min(1.0, msg.value));
          return;
        }
        if (msg.key === "root_note") {
          this._rootNote = Math.round(Math.max(0, Math.min(127, msg.value)));
          return;
        }
        // step_01 … step_16
        const m = msg.key.match(/^step_(\d{2})$/);
        if (m) {
          const idx = parseInt(m[1], 10) - 1;
          if (idx >= 0 && idx < 16) {
            this._steps[idx] = msg.value >= 0.5 ? 1 : 0;
          }
          return;
        }
      }

      // ── Song-position clock ─────────────────────────────────
      if (msg.type === "songPosition") {
        const pos = msg.position;
        if (!pos) return;

        const tick = pos.ppq24Counter;

        // Detect transport restart: if the counter went backwards, reset.
        if (tick < this._lastTick) {
          this._cursor = 0;
          this._lastFiredStep = -1;
        }
        this._lastTick = tick;

        // Fire on every 6th tick (= one 16th note at PPQN-24).
        const stepIdx = Math.floor(tick / 6) % 16;

        if (stepIdx !== this._lastFiredStep) {
          this._lastFiredStep = stepIdx;
          this._cursor = stepIdx;

          if (this._steps[stepIdx]) {
            this._fireStep(pos.audioTime);
          }
        }
      }
    };
  }

  /**
   * Emit a noteOn + scheduled noteOff for the current root note.
   *
   * Gate length is expressed as a proportion of one 16th note at whatever
   * the current tempo is. The host converts `audioTime` (seconds from
   * AudioContext start) to a sample-accurate schedule position; we just
   * need to keep it monotonically increasing.
   *
   * A simplification used here: gate duration is expressed in seconds
   * using a fixed approximation of 0.25 s per 16th note at 60 BPM.
   * For tempo-accurate gate length, multiply by (60 / bpm * 0.25) using
   * the `bpm` field from the `songPosition` payload.
   */
  _fireStep(audioTime) {
    const note     = this._rootNote;
    const id       = this._nextId++;
    const gateSec  = this._gateLength * 0.25; // 0.25 s = 16th at 60 BPM

    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOn",  note, velocity: 100, channel: 0, time: audioTime, id },
    });

    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOff", note, channel: 0, time: audioTime + gateSec, id },
    });
  }

  // The processor must stay alive indefinitely while the transport runs.
  process() {
    return true;
  }
}

registerProcessor("com.nanotracker-sdk.step-seq-16", StepSeq16Processor);
