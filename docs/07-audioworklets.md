# AudioWorklets (v1/v2 contract)

When the built-in DSP engine can't express what you want, you drop
down to an AudioWorklet processor in `script.js`. This file lives at
the root of your plugin archive, is loaded via
`AudioWorklet.addModule()` at plugin-load time, and runs on the
audio rendering thread with sample-accurate timing.

This page covers the **v1/v2 contract** — the original ad-hoc
worklet path that's been in the spec since day one. The v3 contract
(`dsp.worklet` with auto-wired AudioParams, voice lifecycle messages,
asset transfer) is covered separately in
[`08-worklet-v3.md`](08-worklet-v3.md).

**Use the v1/v2 contract when:**

- You're writing a simple FX processor
- You're writing a monosynth or lightly-polyphonic instrument
  processor that manages its own voices internally
- You don't need the v3 per-voice reserved AudioParams
- You want the smallest possible boilerplate

**Use the v3 contract when:**

- You want the host to manage voices and auto-wire
  pitch/gate/velocity/gain to your processor
- You need `init` + `loadAsset` + `voiceId` lifecycle messages
- You're building a granular, wavetable, or otherwise complex
  instrument that the host should integrate cleanly with the tracker
  effect system

## Audio-thread limitations

Before writing a single line of worklet code, internalise the
constraints:

- **No DOM.** No `document`, no `window.alert`, no event listeners
  on anything. If you need to touch the page, do it from the main
  thread and postMessage the result in.
- **No `fetch`.** No `XMLHttpRequest`, no network access. Assets
  arrive by being embedded in the worklet code (base64 constants)
  or via `port.postMessage()` from the main thread.
- **No `setTimeout` / `setInterval`.** `AudioWorkletGlobalScope`
  doesn't expose them. Do time-based work in `process()` using
  `currentFrame` and `currentTime`.
- **No `console` on some browsers.** Use `this.port.postMessage()` to
  ship diagnostic data to the main thread, which can then
  `console.log`.
- **Strict mode.** Worklet modules are strict mode by default.
- **Module scope is shared across processor instances.** Be careful
  with module-level state; prefer instance state on `this`.
- **`process()` runs in 128-sample blocks.** You don't get to choose.
- **CPU budget is small.** If `process()` takes longer than the block
  duration (~2.67 ms at 48 kHz), the audio buffer underruns and the
  user hears clicks. Profile heavy processors.

## Minimal FX processor

Two files: `plugin.json` references a worklet node, and `script.js`
provides the processor.

### `plugin.json`

```json
{
  "schemaVersion": 2,
  "manifest": { "name": "BITCRUSHER", "version": "1.0.0", "type": "fx" },
  "parameters": [
    { "key": "bits",   "label": "BITS", "min": 1, "max": 16, "default": 8, "step": 1 },
    { "key": "drive",  "label": "DRV",  "min": 1, "max": 10, "default": 1, "step": 0.1 }
  ],
  "dsp": {
    "processorName": "my-bitcrush",
    "nodes": [],
    "connections": [
      { "from": "input", "to": "output" }
    ]
  },
  "ui": {
    "layout": "flex",
    "controls": [
      { "type": "knob", "parameter": "bits",  "label": "BITS" },
      { "type": "knob", "parameter": "drive", "label": "DRV"  }
    ]
  }
}
```

Wait — if the graph just goes `input → output`, where's the
bitcrushing? This is the **legacy FX worklet form**: setting
`dsp.processorName` at the top of the DSP block creates an
AudioWorkletNode as the entire FX, and the declarative graph is
ignored (well, almost — the input/output routing still applies).

For this simple case, there are no other nodes. For more complex
plugins, you can mix a worklet with declarative nodes using the
`worklet` node type inside `nodes[]`, documented in
[`05-fx-graphs.md`](05-fx-graphs.md).

### `script.js`

```javascript
class MyBitcrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits",  defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "drive", defaultValue: 1, minValue: 1, maxValue: 10, automationRate: "k-rate" }
    ];
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    const bits  = parameters.bits[0];
    const drive = parameters.drive[0];
    const step  = 2 / Math.pow(2, bits);

    for (let ch = 0; ch < output.length; ch++) {
      const inChan  = input[ch];
      const outChan = output[ch];
      if (!inChan) {
        outChan.fill(0);
        continue;
      }
      for (let i = 0; i < outChan.length; i++) {
        const driven = Math.tanh(inChan[i] * drive);
        outChan[i] = Math.round(driven / step) * step;
      }
    }
    return true;
  }
}

registerProcessor("my-bitcrush", MyBitcrushProcessor);
```

Things to notice:

1. **`registerProcessor("my-bitcrush", ...)`** at the bottom. The
   string must match `dsp.processorName` in `plugin.json`.
2. **`parameterDescriptors` are not auto-wired in the legacy path.**
   Declaring them gives you the `parameters` argument to `process()`
   and nothing more — the host does **not** call `setValueAtTime` on
   those AudioParams from knob moves. Legacy FX and legacy
   whole-instrument worklets receive every UI parameter change as a
   `{ type: "param", key, value }` message on `this.port`; store the
   value on your processor instance and read it in `process()`. The
   `parameters` argument is still useful for signals you *do* feed
   as AudioParams from inside the host graph (reserved per-voice
   `pitch`/`gate`/`velocity`/`gain` on v3 graph-node worklets, or
   modulation routes in v3 graphs) — but plain user knobs always
   travel over the port.
3. **k-rate vs a-rate.** `"k-rate"` parameters give you one value per
   block (`parameters.bits[0]`). `"a-rate"` parameters give you one
   value per sample (`parameters.bits[i]`). k-rate is cheaper; use
   a-rate only when you need sample-accurate modulation. (Only
   relevant for the per-voice reserved params in v3 graph-node form —
   port-message params are plain instance fields, no k/a-rate.)
4. **`return true`** to keep the processor alive. Returning `false`
   terminates it — only use if you've done a one-shot and want to be
   garbage-collected.
5. **Handle missing inputs.** On the first few process calls the
   input channel array may be empty (`inputs[0]` is `[]`). Check
   and fill with silence rather than crashing.

## Minimal instrument processor

Instruments are message-driven rather than sample-stream-driven. The
host tells the processor to start and stop notes via `this.port`:

```javascript
class MySynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._voices = [];     // active voices
    this.cutoff  = 1200;   // UI param state, updated from port messages
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "noteOn":
        this._voices.push({
          note: msg.note,
          freq: msg.frequency,
          vel:  msg.velocity / 127,
          phase: 0,
          env: 1,
          releasing: false
        });
        break;
      case "noteOff":
        for (const v of this._voices) {
          if (v.note === msg.note) v.releasing = true;
        }
        break;
      case "allNotesOff":
        for (const v of this._voices) v.releasing = true;
        break;
      case "param":
        // Store knob values on `this`. This is the ONLY way
        // UI parameters reach a legacy instrument worklet —
        // do not read from the `parameters` argument.
        if (msg.key === "cutoff") this.cutoff = msg.value;
        break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const chan = output[0];
    const len  = chan.length;
    const cutoff = this.cutoff; // read instance field, not parameters

    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (const v of this._voices) {
        sum += Math.sin(2 * Math.PI * v.phase) * v.env * v.vel;
        v.phase += v.freq / sampleRate;
        if (v.phase >= 1) v.phase -= 1;
        if (v.releasing) v.env *= 0.999;
      }
      chan[i] = sum * 0.3;
    }

    // Cull dead voices
    this._voices = this._voices.filter(v => !v.releasing || v.env > 0.001);

    // Mirror to remaining channels
    for (let ch = 1; ch < output.length; ch++) output[ch].set(chan);
    return true;
  }
}

registerProcessor("my-synth", MySynthProcessor);
```

### Message protocol (host → processor)

| Message type | Fields | When sent |
|---|---|---|
| `noteOn` | `{ type, note, velocity, frequency }` | tracker row triggers a note |
| `noteOff` | `{ type, note }` | tracker row releases a note |
| `allNotesOff` | `{ type }` | transport stop or panic |
| `param` | `{ type, key, value }` | UI knob or automation changes a parameter |

**`frequency`** is pre-computed by the host from the MIDI note number
using equal temperament (`440 * 2^((note-69)/12)`). Use it directly;
don't recompute.

**`velocity`** is the MIDI 0–127 value from the tracker volume
column, scaled appropriately.

**Note matching.** The host sends `noteOn` and `noteOff` with the
same `note` number, so your voice matching logic can pair them via
the `note` field. Be careful with retriggers: if two `noteOn`s for
the same note arrive before a `noteOff`, the second one's `noteOff`
releases the first voice. Match the **oldest** voice with that note,
not all of them.

### `parameterDescriptors` for instrument processors

**Skip `parameterDescriptors` for legacy whole-instrument worklets.**
The host's legacy instrument engine forwards every UI parameter
change as a `{ type: "param", key, value }` port message and does
not touch any AudioParam on the node. Declaring
`parameterDescriptors` is legal — it just gives you a `parameters`
argument in `process()` whose values are frozen at the descriptor
defaults, since nothing updates them. Store knob state on `this`
from the port handler and read it in `process()` — this is what
every shipping legacy instrument worklet does (see the
`templates/instrument-worklet/` template for the canonical shape).

If you need AudioParam-backed per-voice signals (pitch tracking
from the host, a sample-accurate gate, velocity modulation), use
the **v3 graph-node form** instead, where `pitch`/`gate`/`velocity`/
`gain` are auto-wired from per-voice control ConstantSources — see
[`08-worklet-v3.md`](08-worklet-v3.md). v3 graph-node worklets get
dotted-key parameter routing via `AudioParam.setTargetAtTime`,
which is the only legacy-free way to get "real" AudioParams in
a nanoTracker plugin.

## Loading and error handling

When the tracker loads your plugin, it reads `script.js` out of the
archive, wraps it in a `Blob`, creates an object URL for it, and
calls `AudioWorklet.addModule(url)`. If the tracker's Content
Security Policy blocks `blob:` URLs at that point, it falls back to
a `data:` URL containing the same script text. Either path hands
your processor class off to the audio thread and registers it under
whatever name you gave `registerProcessor()`.

If both paths fail, the plugin loads without the worklet registered,
your processor never runs, and the FX or instrument is silent. Check
the browser console at load time — any syntax errors in `script.js`
show up
there.

**Common loading failures:**

- Syntax error in `script.js` — browser console shows the line
- `registerProcessor("name", Class)` name doesn't match
  `plugin.json`'s `processorName`
- Missing `this.port.onmessage =` handler (silent symptom:
  processor loads but ignores all messages)
- Strict CSP blocks both `blob:` and `data:` URIs

## The `worklet` graph node (v2)

If you want to mix declarative nodes with a custom worklet in the
same plugin, use the `worklet` node type inside `nodes[]`:

```json
"nodes": [
  { "id": "bitcrush", "type": "worklet", "parameterDescriptors": [
    { "name": "bits", "defaultValue": 8, "minValue": 1, "maxValue": 16 }
  ]},
  { "id": "lpf", "type": "biquad", "filterType": "lowpass", "frequency": 4000, "Q": 0.707 }
],
"connections": [
  { "from": "input",    "to": "bitcrush" },
  { "from": "bitcrush", "to": "lpf" },
  { "from": "lpf",      "to": "output" }
]
```

The processor is registered under the node's `id` (so
`registerProcessor("bitcrush", ...)`). The `parameterDescriptors`
in the node definition mirrors your processor's own AudioParam
declarations; it's advisory metadata the loader uses to validate
that every declared param has a matching `<nodeId>.<paramName>`
entry in `parameters[]`.

Multiple `worklet` nodes in one plugin are allowed — `script.js`
just calls `registerProcessor()` multiple times with different names.

## Debugging workflow

1. **Build your processor standalone first.** Write a tiny HTML page
   with an `AudioContext` and an AudioWorkletNode loading your
   `script.js` directly (not through the tracker). Iterate there
   until the DSP sounds right.
2. **Then wrap it in a plugin archive.** Add `plugin.json`, wire up
   parameters, test in the tracker.
3. **Use `port.postMessage()` for debug logs.** Main-thread code in
   the plugin host can't see worklet `console.log` output on some
   browsers. Ship log messages through the port and have the host
   print them — or just print them to the browser console from the
   main thread ahead of time.
4. **Profile if `process()` is slow.** Chrome DevTools Performance
   panel shows audio-thread work. A clean processor takes well
   under 1 ms per block at 48 kHz; if you see more, you're about to
   underrun.

## What's different in the v3 contract?

The v3 contract is strictly more capable but has more surface area:

- **Voice lifecycle**: v3 instruments can declare
  `dsp.worklet.processorName` (instead of the legacy
  `dsp.processorName`), and the host sends richer voice-level
  messages including `voiceId`, `time`, and `setPitch` /
  `setGain` / `allNotesOff` with timing.
- **Asset transfer**: the host can ship decoded sample buffers to
  the processor via `loadAsset` messages with `Transferable` buffers.
- **Auto-wired AudioParams**: declaring a `pitch` / `gate` / `velocity`
  / `gain` AudioParam in `parameterDescriptors` causes the host to
  wire per-voice control ConstantSources straight into those params.
- **Init message**: the processor receives an `init` message with
  `sampleRate`, plugin context, and custom `initMessage` data from
  `plugin.json`.

Full details in [`08-worklet-v3.md`](08-worklet-v3.md) and the
normative spec at
[`reference/worklet-protocol.md`](reference/worklet-protocol.md).

## See also

- [`08-worklet-v3.md`](08-worklet-v3.md) — the v3 worklet contract
- [`reference/worklet-protocol.md`](reference/worklet-protocol.md) —
  the v3 MessagePort protocol spec
- [`../templates/instrument-worklet/`](../templates/instrument-worklet/)
  — copy-to-start AudioWorklet instrument template
- [`05-fx-graphs.md`](05-fx-graphs.md) — the `worklet` node type in FX
  declarative graphs
- [MDN: AudioWorkletProcessor](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor) —
  browser API reference
- [MDN: AudioWorkletGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope) —
  what's available inside `script.js`
