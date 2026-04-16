---
name: scaffold-control-source
description: Scaffold a nanoTracker control-source plugin — a MIDI emitter triggered by tracker rows. Step sequencers, virtual keyboards, drum machines, arpeggiators, chord triggers, LFO-to-CC. Plugins with manifest.type "control-source" emit TrackerMidiEvents over cables instead of producing audio.
---


# Scaffold a nanoTracker control-source plugin

## When to use

Use this when the user wants to author a plugin whose primary
output is **MIDI events**, not audio:

- Step sequencers (16-step × N-lane grids)
- Virtual keyboards (on-screen keys → MIDI notes)
- Drum machines (per-track step patterns → channel-routed notes)
- Arpeggiators / chord triggers / scale quantisers (transform
  incoming MIDI and emit downstream)
- Euclidean sequencers, LFO-to-CC emitters, random generators

Do NOT use this for audio instruments (use `scaffold-instrument`
— those respond to `noteOn` and produce audio). Do NOT use this
for audio effects (use `scaffold-pedal`).

If the plugin transforms incoming MIDI (arp, chord trigger) AND
also plays audio, prefer `scaffold-instrument` with the
`midi-thru-custom` capability — instruments can own their thru
emission too.

## Procedure

### 1. Confirm the shape with the user

Control-source plugins:

- Get an implicit `midi-out` port (no manifest work needed).
- Get NO implicit `midi-in` or `midi-thru` — declare one
  explicitly if the plugin needs to receive cabled MIDI.
- Do NOT need an audio output (`engine.output` falls back to a
  silent GainNode).
- Are triggered by tracker rows via the voice engine's `noteOn` /
  `noteOff` — the plugin converts those triggers into whatever
  MIDI it wants to emit.

Ask the user:

- "How is the plugin clocked? Off its own `noteOn` triggers, the
  transport clock (via `consumes-song-position`), or a cabled
  MIDI input?"
- "What MIDI events does it emit? Just notes, or also CC /
  pitch bend / clock / transport?"
- "Does it have a webview UI (step grid, XY pad) or native
  controls (knobs, sliders)?"

### 2. Start from the template

```bash
cp -r templates/control-source my-ctrl-src
```

The template is a minimal 8th-note MIDI pulse generator clocked by
the host transport. Replace the worklet's scheduling logic with
whatever pattern / arp / keyboard / chord behaviour the plugin
needs; the `songPosition` intake and `midiOut` emission stay the
same.

### 3. Manifest essentials

```jsonc
{
  "schemaVersion": 4,
  "manifest": {
    "name":    "STEP SEQ 16",
    "version": "1.0.0",
    "type":    "control-source",
    "description": "16-step × 4-lane clock-driven sequencer"
  },
  "requires": [
    "portsV4",
    "worklet-v3",               // if you have a worklet processor
    "consumes-song-position"    // if you want host songPosition messages
  ],
  "parameters": [
    { "key": "gate_length", "label": "GATE", "min": 0.05, "max": 1.0, "default": 0.5, "step": 0.01 },
    { "key": "step_count",  "label": "STEPS","min": 1,    "max": 16,  "default": 16,  "step": 1    }
  ],
  "ui": {
    "layout":   "flex",
    "controls": [
      { "type": "knob",  "parameter": "gate_length", "label": "GATE" },
      { "type": "knob",  "parameter": "step_count",  "label": "STEPS" }
    ]
  },
  "dsp": {
    "voices": 1,
    "voiceStealing": "none",
    "worklet": {
      "processorName": "com.example.step-seq",
      "voiceParams":   ["gate_length", "step_count"]
    }
  }
}
```

Key points:

- **No `ports` block needed** if the implicit `midi-out` is your
  only output. Declare one if you want a different id / label
  or additional ports (e.g. a `midi-in` for live-play override).
- **`voices: 1`** and **`voiceStealing: "none"`** is the usual
  shape. Control-source plugins don't have per-voice state; the
  single "voice" is really the plugin's event emission engine.
- **`consumes-song-position`** opts into host `songPosition`
  messages on the worklet port — essential for clock-driven
  sequencers.

### 4. Worklet emission

Control-source worklets post `midiOut` messages. The host picks
up the event and dispatches through the MIDI bus:

```js
class StepSeqProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._steps   = [60, 64, 67, 72, 60, 64, 67, 72,
                     65, 69, 72, 77, 65, 69, 72, 77];
    this._stepIdx = 0;
    this._gate    = 0.5;
    this._stepN   = 16;
    this._nextId  = 1_000_000;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "param") {
        if (m.key === "gate_length") this._gate  = m.value;
        if (m.key === "step_count")  this._stepN = Math.max(1, Math.min(16, m.value | 0));
      }
      if (m.type === "songPosition") {
        // 24 PPQN → 16th note = every 6 ticks.
        if (m.position.ppq24Counter % 6 === 0) {
          this.fireStep(m.position.audioTime);
        }
      }
    };
  }

  fireStep(time) {
    const note = this._steps[this._stepIdx % this._stepN];
    const id = this._nextId++;
    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOn", note, velocity: 100, channel: 0, time, id },
    });
    // Schedule the release at the gate length (quarter note * gate).
    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOff", note, channel: 0, time: time + this._gate * 0.25, id },
    });
    this._stepIdx = (this._stepIdx + 1) % this._stepN;
  }

  process() { return true; }
}

registerProcessor("com.example.step-seq", StepSeqProcessor);
```

The `id` field is essential — `noteOff` matches `noteOn` by id,
not by (note, channel). Maintain a monotonic counter in your
processor.

### 5. Tracker-row triggering (optional)

If you want the plugin to ALSO react to tracker row notes (so the
user can trigger the sequencer from the pattern), implement the
voice engine's `noteOn` / `noteOff` as normal. The tracker row's
`noteOn(note, velocity, time)` can be mapped to "start the
sequence on this root", "restart from step 0", or whatever the
plugin's semantic is.

### 6. Validate and pack

```bash
node tools/ntvalidate.mjs my-step-seq
node tools/ntpack.mjs    my-step-seq --out my-step-seq.ntins
```

## Common gotchas

### "Nothing plays when I cable midi-out to a synth."

- Check you're posting `midiOut` messages from the worklet.
- Check the destination's `midi-in` is actually connected (drag
  a cable in the workspace).
- Open the browser console; un-dispatched events often log
  warnings about missing endpoints.

### "My step sequencer drifts out of time."

- Your clocking is likely in `setTimeout`-land. Use the worklet's
  `songPosition` messages (opt in with `consumes-song-position`)
  or cable `__clock-source.clock-out` into your `midi-in`.

### "Tracker row triggers produce no audio."

Correct — control-source plugins don't emit audio by default.
If you want preview audio (a metronome click or a keyboard
feedback), declare an audio output in `ports.outputs[]`:

```jsonc
"ports": {
  "outputs": [
    { "id": "midi-out", "label": "MIDI OUT", "kind": "midi" },
    { "id": "preview",  "label": "PREVIEW",  "kind": "audio" }
  ]
}
```

Once declared, the host creates a per-audio-output gain and
routes through the normal master mix.

### "My `noteOff` doesn't release on the receiver."

You're probably allocating a fresh id for the `noteOff`.
**Reuse the same id** you used on the `noteOn`. The bus matches by
id; a mismatched id falls back to (note, channel) which breaks
under transposition / chord expansion.

## See also

- [`docs/23-control-source-plugins.md`](../../docs/23-control-source-plugins.md)
  — full reference
- [`docs/22-midi-ports.md`](../../docs/22-midi-ports.md) — MIDI
  cable layer
- [`docs/08-worklet-v3.md`](../../docs/08-worklet-v3.md) —
  worklet contract
- [`examples/step-sequencer/`](../../examples/step-sequencer/) —
  canonical reference plugin
