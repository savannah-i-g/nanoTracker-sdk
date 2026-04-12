# v3 AudioWorklet instrument contract

v3 introduced a more structured AudioWorklet contract for instrument
plugins: richer voice lifecycle messages, a formal init handshake,
asset transfer, and **auto-wired AudioParams** for the common
per-voice control signals (pitch, gate, velocity, gain). It's a
superset of the legacy v1/v2 worklet path and coexists with it — v1/v2
plugins keep working unchanged.

**Prerequisites for this page:**
- You've read [`07-audioworklets.md`](07-audioworklets.md) (the v1/v2
  contract, basic AudioWorklet mechanics, `registerProcessor`)
- You've read [`06-instrument-graphs.md`](06-instrument-graphs.md) if
  you want the worklet to live **inside** a v3 declarative graph

**Two forms of v3 worklet:**

1. **Graph-node form** — a `worklet`-type node inside `dsp.graph.nodes`.
   The processor is one node in a larger per-voice graph; the host
   auto-wires reserved AudioParams from per-voice control sources.
   This is the more common path.
2. **Whole-instrument form** — `dsp.worklet` block at the top of the
   instrument DSP. The processor IS the entire instrument; the host
   wraps it in an AudioWorkletNode and sends the full MessagePort
   protocol. Use when you want total control of voice management and
   don't need the declarative graph engine.

The formal normative spec for this contract lives at
[`reference/worklet-protocol.md`](reference/worklet-protocol.md).
This page is the narrative introduction with worked examples.

## Graph-node form — auto-wired AudioParams

The simpler path. You write a normal `AudioWorkletProcessor` that
declares AudioParams with one or more of the **reserved names**, and
the host automatically wires per-voice control ConstantSources into
them. No modulation routes needed.

### Reserved AudioParam names

| Name | Rate | Range | Source |
|---|---|---|---|
| `pitch` | a-rate | 0..20000 Hz | per-voice frequency (derived from `note`) |
| `gate` | a-rate | 0..1 | 1 on `noteOn`, 0 on `noteOff` |
| `velocity` | k-rate | 0..1 | MIDI velocity ÷ 127 |
| `gain` | a-rate | 0..1 | host volume slides (the tracker's volume column) |

If your processor's `parameterDescriptors` contains an entry with
one of these names, the host identifies it at graph-build time and
connects a ConstantSource tracking the per-voice control signal.

### Example — minimal wavetable-ish oscillator

`plugin.json`:

```json
{
  "schemaVersion": 3,
  "manifest": { "name": "WT OSC", "version": "1.0.0", "type": "instrument" },
  "requires": ["graph", "worklet-v3"],
  "parameters": [
    { "key": "osc.pitch",    "label": "PITCH", "min": 20,  "max": 20000, "default": 440, "step": 1 },
    { "key": "osc.gate",     "label": "GATE",  "min": 0,   "max": 1,     "default": 0,   "step": 1 },
    { "key": "osc.velocity", "label": "VEL",   "min": 0,   "max": 1,     "default": 0,   "step": 0.01 },
    { "key": "filter.frequency", "label": "CUT", "min": 100, "max": 16000, "default": 4000, "step": 1 }
  ],
  "dsp": {
    "processorName": null,
    "voices": 8,
    "voiceStealing": "oldest",
    "oscillators": [],
    "samples": [],
    "envelope": { "attack": 0.001, "decay": 0.1, "sustain": 1, "release": 0.05 },
    "filter": null,
    "graph": {
      "nodes": [
        {
          "id": "osc",
          "type": "worklet",
          "parameterDescriptors": [
            { "name": "pitch",    "defaultValue": 440, "minValue": 20, "maxValue": 20000 },
            { "name": "gate",     "defaultValue": 0,   "minValue": 0,  "maxValue": 1    },
            { "name": "velocity", "defaultValue": 0,   "minValue": 0,  "maxValue": 1, "automationRate": "k-rate" }
          ]
        },
        { "id": "filter", "type": "biquad", "filterType": "lowpass", "frequency": 4000, "Q": 1 }
      ],
      "connections": [
        { "from": "osc", "to": "filter" },
        { "from": "filter", "to": "voiceOut" }
      ]
    }
  },
  "ui": {
    "layout": "flex",
    "controls": [{ "type": "knob", "parameter": "filter.frequency", "label": "CUT" }]
  }
}
```

`script.js`:

```javascript
class MyOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "pitch",    defaultValue: 440, minValue: 20, maxValue: 20000, automationRate: "a-rate" },
      { name: "gate",     defaultValue: 0,   minValue: 0,  maxValue: 1,     automationRate: "a-rate" },
      { name: "velocity", defaultValue: 0,   minValue: 0,  maxValue: 1,     automationRate: "k-rate" }
    ];
  }
  constructor() {
    super();
    this._phase = 0;
  }
  process(inputs, outputs, parameters) {
    const out = outputs[0][0];
    if (!out) return true;
    const pitch = parameters.pitch;
    const gate = parameters.gate;
    const vel = parameters.velocity[0];
    for (let i = 0; i < out.length; i++) {
      // pitch is a-rate, so it's either length-128 (per-sample) or length-1 (block)
      const freq = pitch.length > 1 ? pitch[i] : pitch[0];
      const g    = gate.length  > 1 ? gate[i]  : gate[0];
      this._phase += freq / sampleRate;
      if (this._phase >= 1) this._phase -= 1;
      // Simple saw, gated by voice gate, velocity-scaled.
      out[i] = (this._phase * 2 - 1) * g * vel * 0.4;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}
registerProcessor("osc", MyOsc);
```

The processor is the `osc` node in the graph. Every voice gets its
own instance (because `scope: "voice"` is the default for instrument
graph nodes). The host instantiates one ConstantSource per voice for
pitch/gate/velocity and connects them into this node's AudioParams
automatically — no `noteOn` messages, no `this.port.onmessage`.

### Parameter mirror rule

Any `parameterDescriptor` you declare that **isn't** a reserved name
should have a matching entry in `parameters[]` using the key
`<nodeId>.<paramName>`. So if `osc` declares a `detune` AudioParam,
`parameters[]` should contain `{ "key": "osc.detune", ... }`. The
loader warns (not errors) if this mirror is incomplete — it's a
convention, not a strict rule, but `ntvalidate` flags it.

The reserved names (`pitch`, `gate`, `velocity`, `gain`) are
**exempt** from this rule — they don't need `parameters[]` entries
because they aren't user-facing knobs.

## Whole-instrument form — `dsp.worklet`

When the declarative graph engine isn't a fit — you want to manage
your own voices, own your own scheduling, do something the graph
can't express — use the whole-instrument form.

```json
"dsp": {
  "processorName": null,
  "voices": 1,
  "voiceStealing": "oldest",
  "oscillators": [],
  "samples": [],
  "envelope": { "attack": 0.001, "decay": 0.01, "sustain": 1, "release": 0.05 },
  "filter": null,
  "worklet": {
    "processorName": "my-synth-v3",
    "numberOfInputs": 0,
    "numberOfOutputs": 1,
    "outputChannelCount": [2],
    "assets": ["samples/kick.wav", "samples/snare.wav"],
    "initMessage": { "mode": "polyphonic", "maxVoices": 16 }
  },
  "requires": ["worklet-v3"]
}
```

When `dsp.worklet` is set (and the plugin is v3), the host wraps the
processor in an AudioWorkletNode using `processorName` and sends the
full v3 MessagePort protocol. The legacy `dsp.processorName` field
is ignored.

### Lifetime

1. Host calls `AudioWorklet.addModule(scriptBlobUrl)` to register
   the processor class
2. Host creates the AudioWorkletNode with `numberOfInputs` /
   `numberOfOutputs` / `outputChannelCount` from `dsp.worklet`
3. Host sends an `init` message (see below)
4. Host sends `loadAsset` messages for every path in `assets[]` with
   decoded `AudioBuffer` channel data as `Transferable` Float32Arrays
5. Processor optionally posts back `{ type: "ready", id?: string }`
   when done initialising / loading
6. Host starts sending `noteOn` / `noteOff` / parameter messages as
   tracker events happen
7. On unload, host sends `{ type: "dispose" }` and disconnects the
   node

### Host → processor messages

| Type | Fields | Purpose |
|---|---|---|
| `init` | `{ assets, initMessage, sampleRate }` | First message after module load |
| `loadAsset` | `{ id, channels: Float32Array[], sampleRate }` | Stream decoded asset (channels are Transferable) |
| `noteOn` | `{ voiceId, note, velocity, frequency, time }` | Trigger voice |
| `noteOff` | `{ voiceId, note, time }` | Begin release |
| `allNotesOff` | `{ time }` | Silence all voices |
| `setPitch` | `{ voiceId, frequencyHz, time }` | Mid-note pitch update (portamento, vibrato) |
| `setGain` | `{ voiceId, gain, time }` | Mid-note gain update (volume slides) |
| `param` | `{ key, value, time }` | Parameter update |
| `dispose` | — | Stop processing, release resources |

### Processor → host messages

Optional. The host listens for these and dispatches them via its
internal event system.

| Type | Fields | Purpose |
|---|---|---|
| `ready` | `{ id? }` | Processor / asset ready signal |
| `voiceEnded` | `{ voiceId }` | Voice reclaimed by processor |
| `meter` | `{ level, peak }` | Level meter data for UI |
| `error` | `{ message, voiceId? }` | Recoverable error |

### `voiceId` — the key insight

The v3 contract tracks voices by `voiceId`, not by `note`. Every
`noteOn` allocates a fresh unique id; matching `noteOff` / `setPitch`
/ `setGain` carry the same id. This cleanly handles the case where
two voices play the same note — legacy (v1/v2) matching by note
number gets confused, v3 matching by voiceId doesn't.

Your processor should maintain `Map<voiceId, Voice>` and look up by
id rather than by note number.

### Asset transfer

`loadAsset` messages carry decoded sample data as `Float32Array[]`,
one per channel. These arrays are **transferable** — the host posts
them with the transfer list so ownership moves to the worklet
thread and the main thread's reference becomes null. This avoids
copying the data and scales to multi-megabyte samples without
stalling the audio thread.

Your processor's `onmessage` handler should stash the buffers:

```javascript
this.port.onmessage = (e) => {
  if (e.data.type === "loadAsset") {
    this._samples[e.data.id] = {
      channels: e.data.channels,  // Float32Array[]
      sampleRate: e.data.sampleRate
    };
    this.port.postMessage({ type: "ready", id: e.data.id });
  }
};
```

## When to pick which form

| Situation | Form |
|---|---|
| Custom voice logic inside an otherwise declarative graph (e.g., a wavetable node among built-in filters and envelopes) | graph-node form |
| "This processor IS the synth — I manage everything" | whole-instrument form |
| You want the host to handle polyphony for you | graph-node form (each voice gets its own processor instance) |
| You want to implement polyphony yourself across voices in one processor | whole-instrument form with `voices: 1` |
| Porting a standalone AudioWorklet synth to nanoTracker | whole-instrument form is the closest shape |
| Building a chip-style monosynth with global state | whole-instrument form |

## Parameter mirror rule

When the host's graph builder resolves a parameter key like
`"osc.drive"`, it looks up the `osc` node's live AudioWorkletNode
and routes the value to the matching AudioParam via the
`AudioWorkletNode.parameters` map.

This matters for you as a plugin author: **as long as you declare
AudioParams in `parameterDescriptors` and mirror them in
`parameters[]` as `<nodeId>.<paramName>`, the host will route
UI changes and automation to them correctly.** The contract is
"declare it in both places" — nothing more.

## See also

- [`07-audioworklets.md`](07-audioworklets.md) — the v1/v2 contract
  (simpler, no auto-wiring)
- [`06-instrument-graphs.md`](06-instrument-graphs.md) — how to use
  worklet nodes inside a declarative per-voice graph
- [`reference/worklet-protocol.md`](reference/worklet-protocol.md) —
  normative spec for the v3 MessagePort protocol
