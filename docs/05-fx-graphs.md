# FX declarative graphs

An FX plugin is a `.ntsfx` archive whose `manifest.type` is `"fx"`.
FX sit on the tracker's mixer chain — they take audio input from a
channel strip and write audio output back. Unlike instruments they
don't have voices or note-gated envelopes; they run continuously as
long as the FX chain is active.

The core idea: **you describe the DSP topology as a JSON graph**
(nodes + connections + optional modulation routes) and the host
materialises it at plugin-load time into real Web Audio nodes. For
a lot of useful effects (delays, filters, shapers, multi-band EQ,
reverbs, compressors) this is enough — **no AudioWorklet code
required**. For anything too weird to express in Web Audio primitives,
you drop down to `script.js` and do it yourself.

## Minimal example — stereo delay

```json
{
  "schemaVersion": 2,
  "manifest": { "name": "DELAY", "version": "1.0.0", "type": "fx" },
  "parameters": [
    { "key": "d1.delayTime", "label": "TIME", "min": 0.01, "max": 1.5, "default": 0.375, "step": 0.01 },
    { "key": "fb.gain",      "label": "FBK",  "min": 0,    "max": 0.9, "default": 0.5,   "step": 0.01 }
  ],
  "dsp": {
    "processorName": null,
    "nodes": [
      { "id": "d1", "type": "delay", "maxDelay": 2, "delayTime": 0.375 },
      { "id": "fb", "type": "gain",  "gain": 0.5 }
    ],
    "connections": [
      { "from": "input", "to": "d1" },
      { "from": "d1", "to": "fb" },
      { "from": "fb", "to": "d1" },
      { "from": "d1", "to": "output" },
      { "from": "input", "to": "output" }
    ]
  },
  "ui": {
    "layout": "flex",
    "controls": [
      { "type": "knob", "parameter": "d1.delayTime", "label": "TIME" },
      { "type": "knob", "parameter": "fb.gain",      "label": "FBK"  }
    ]
  }
}
```

That's a complete echo effect. Zero JS, zero AudioWorklet, ~30 lines
of JSON. See [`../templates/fx-graph/`](../templates/fx-graph/) for
a slightly larger ready-to-copy version with wet/dry mix and a tone
filter.

## `PluginFxDsp` fields

| Field | Type | Purpose |
|---|---|---|
| `processorName` | `string \| null` | AudioWorklet processor name, or `null` for a pure declarative graph |
| `nodes` | `PluginDspNode[]` | The DSP node definitions |
| `connections` | `PluginDspConnection[]` | Edges between nodes |
| `modRoutes` | `PluginModRoute[]` | v2: modulation routing |

When `processorName` is `null`, the host materialises the graph
from `nodes` + `connections` into live Web Audio nodes. When
`processorName` is set, the host creates an AudioWorkletNode with
that name AND still parses the graph (so you can have a worklet-based
FX with declarative surrounding topology).

## Reserved node IDs

The host pre-creates two nodes you connect to:

- **`"input"`** — a GainNode that receives audio from the channel
  strip. Connect your nodes FROM this to get the dry signal.
- **`"output"`** — a GainNode that sends audio to the channel output.
  Connect your nodes TO this to commit the wet signal.

These names are reserved — don't declare your own nodes with those IDs.

## Node types

### `gain` — amplification

```json
{ "id": "trim", "type": "gain", "gain": 0.5 }
```

Web Audio `GainNode`. `gain` field sets initial value; parameter
automation targets `trim.gain` via the dot-path convention.

Use for: volume control, wet/dry mix, feedback scaling, any point
where you want to multiply a signal.

### `delay` — time-based delay

```json
{ "id": "d1", "type": "delay", "maxDelay": 2, "delayTime": 0.375 }
```

Web Audio `DelayNode`. `maxDelay` is the max buffer size in seconds
(fixed at creation; can't be automated). `delayTime` is the current
delay in seconds (automatable via `d1.delayTime`).

Use for: echoes, chorus, flanger, tape stop, any time-domain effect.

### `biquad` — 2nd-order filter

```json
{
  "id": "lpf", "type": "biquad",
  "filterType": "lowpass",
  "frequency": 4000,
  "Q": 1.2
}
```

Web Audio `BiquadFilterNode`. `filterType` supports every standard
filter mode:

- `"lowpass"` / `"highpass"` / `"bandpass"`
- `"lowshelf"` / `"highshelf"` / `"peaking"`
- `"notch"` / `"allpass"`

Automatable parameters: `lpf.frequency`, `lpf.Q`, `lpf.gain`
(for shelving and peaking types), `lpf.detune`.

### `compressor` — dynamic range

```json
{
  "id": "comp", "type": "compressor",
  "threshold": -24,
  "ratio": 4,
  "attack": 0.003,
  "release": 0.25,
  "knee": 30
}
```

Web Audio `DynamicsCompressorNode`. Threshold in dB, ratio in dB:dB,
knee in dB, attack and release in seconds.

Automatable: `comp.threshold`, `comp.ratio`, `comp.attack`,
`comp.release`, `comp.knee`.

### `convolver` — impulse-response reverb

```json
{
  "id": "verb",
  "type": "convolver",
  "impulse": "samples/hall.wav",
  "normalize": true
}
```

Web Audio `ConvolverNode`. `impulse` points at an audio file in the
archive (typically a WAV of an acoustic space recording). `normalize`
controls whether the IR is amplitude-normalised on load (default
`true`; set to `false` if you want to preserve the IR's original
gain).

The host decodes `impulse` at load time alongside the instrument
sample pipeline.

### `panner` — stereo positioning

```json
{ "id": "pan", "type": "panner", "pan": 0 }
```

Web Audio `StereoPannerNode`. `pan` field sets initial value (−1 =
hard left, 0 = centre, +1 = hard right). Automatable via `pan.pan`.

### `waveshaper` — non-linear distortion

```json
{ "id": "sat", "type": "waveshaper", "curve": "sigmoid", "drive": 2 }
```

Web Audio `WaveShaperNode` with a built-in curve generator. `curve`
selects the shape:

- `"sigmoid"` — smooth `tanh`-like saturation
- `"clip"` — hard clipping at ±1
- `"fold"` — symmetric wavefolding

`drive` multiplies the input before it hits the shaper. Automatable.

### `worklet` — custom AudioWorklet node

```json
{ "id": "bitcrush", "type": "worklet", "parameterDescriptors": [
  { "name": "bits", "defaultValue": 8, "minValue": 1, "maxValue": 16 },
  { "name": "sampleRate", "defaultValue": 22050, "minValue": 1000, "maxValue": 48000 }
]}
```

An `AudioWorkletNode` instantiated from your `script.js` processor.
The processor name is taken from the node's **id** (so in this
example, `script.js` must `registerProcessor("bitcrush", ...)`).

`parameterDescriptors` is a convenience mirror of the processor's
own `parameterDescriptors` — used by the loader to validate that
every declared AudioParam has a matching `<nodeId>.<paramName>` entry
in `parameters[]`. See [`07-audioworklets.md`](07-audioworklets.md)
and [`08-worklet-v3.md`](08-worklet-v3.md).

### v2 node types — virtual routing and modulation

| Type | Web Audio node | Purpose |
|---|---|---|
| `mixer` | `GainNode` | Summing bus (identical to `gain` but clearer intent) |
| `splitter` | `ChannelSplitterNode` | Stereo → L/R mono |
| `merger` | `ChannelMergerNode` | Individual channels → stereo |
| `oscillator` | `OscillatorNode` | Audio-rate sine/square/saw/triangle |
| `constant` | `ConstantSourceNode` | DC bias, modulation baseline |
| `analyser` | `AnalyserNode` | FFT pass-through, drives waveform_view / meter UI |
| `lfo` | Osc + Gain pair | LFO with configurable shape / rate / depth |
| `envelope` | `ConstantSourceNode` + ramps | Multi-stage envelope |

Example: drive a filter from an LFO.

```json
"nodes": [
  { "id": "lfo1", "type": "lfo", "lfoShape": "triangle", "lfoRate": 2, "lfoDepth": 1 },
  { "id": "lpf",  "type": "biquad", "filterType": "lowpass", "frequency": 2000, "Q": 1 }
],
"connections": [
  { "from": "input", "to": "lpf" },
  { "from": "lpf",   "to": "output" }
],
"modRoutes": [
  { "source": "lfo1", "target": "lpf.frequency", "depth": 1500 }
]
```

The LFO modulates the filter cutoff by ±1500 Hz at 2 Hz.

### v3 node types — synthesis primitives

- **`granular`** — host-shipped granular AudioWorklet. Fields:
  `sampleFile` (archive path), `playbackMode`
  (`"forward"|"reverse"|"pingpong"|"freeze"`),
  `grainEnvelope` (`"hann"|"triangle"|"rectangular"`).
- **`wavetable`** — host-shipped wavetable AudioWorklet. Fields:
  `tableFile` (archive path), `frameCount`, `interpolation`
  (`"linear"|"none"`).

Both require the matching capability flag (`"granular"` /
`"wavetable"`) in `requires[]`. See
[`06-instrument-graphs.md`](06-instrument-graphs.md) for the deeper
story — these are mostly used in instrument graphs rather than FX.

## Connections

```json
"connections": [
  { "from": "input", "to": "d1" },
  { "from": "d1", "to": "output" }
]
```

Each connection is a directed edge between node outputs and node
inputs. `"input"` and `"output"` are the reserved stubs; otherwise
use the IDs from `nodes[]`.

**Multiple connections TO the same node** are summed (that's how
the `mixer` type works, but it's true for any node). **Multiple
connections FROM the same node** are tapped — Web Audio natively
fans out, so you can send one signal to many places.

### AudioParam connections (v2)

A connection can target an AudioParam instead of a node input,
enabling audio-rate modulation:

```json
{ "from": "lfo1", "to": "lpf", "toParam": "frequency" }
```

This is equivalent to connecting the LFO's output directly to the
filter's `frequency` AudioParam (Web Audio's native modulation
mechanism). Use when you want sample-accurate modulation without
going through the `modRoutes` smoother machinery.

### Channel splitter/merger (v2)

`splitter` and `merger` nodes need per-channel connection indexing:

```json
"nodes": [
  { "id": "split", "type": "splitter", "channelCount": 2 },
  { "id": "merge", "type": "merger",   "channelCount": 2 }
],
"connections": [
  { "from": "input",  "to": "split" },
  { "from": "split",  "to": "merge", "outputIndex": 0, "inputIndex": 1 },
  { "from": "split",  "to": "merge", "outputIndex": 1, "inputIndex": 0 },
  { "from": "merge",  "to": "output" }
]
```

This crosses L and R channels — a stereo swap. `outputIndex` is the
splitter channel to tap; `inputIndex` is the merger channel to feed.

## Modulation routing (v2)

`modRoutes[]` is the tracker's declarative way of saying "this signal
controls that parameter, through this amount of shaping." It's
higher-level than connecting raw audio to an AudioParam — the host
wraps the chain in a `GainNode` (for depth scaling), optionally a
`WaveShaperNode` (for transforms), and a one-pole lowpass (for slew).

### v2 form — single target

```json
{ "source": "lfo1", "target": "lpf.frequency", "depth": 1500, "bipolar": true }
```

| Field | Purpose |
|---|---|
| `source` | node ID, OR reserved name (`"velocity"`, `"note"`, `"gate"`, `"pitch"`) |
| `target` | `"nodeId.paramName"` dot-path |
| `depth` | multiplier applied to the source before it hits the target |
| `bipolar` | hint only — documents whether the source oscillates ±depth or 0..depth |

### v3 form — multi target

```json
{
  "source": "lfo1",
  "targets": [
    { "target": "lpf.frequency", "depth": 1500, "transform": "none" },
    { "target": "comp.threshold", "depth": -6,   "transform": "abs", "slew": 0.05 }
  ]
}
```

Each target gets its own depth, transform, slew, offset, scale, and
curve. The v3 form is strictly more powerful — use it whenever one
source drives more than one destination.

**Transforms** (applied before depth scaling):

| Transform | Effect |
|---|---|
| `"none"` | pass-through |
| `"invert"` | `x → −x` |
| `"abs"` | `x → \|x\|` (full-wave rectification) |
| `"square"` | `x → x²` (preserves sign via `x * \|x\|`) |
| `"unipolar"` | `x → (x+1)/2` (maps [−1, 1] → [0, 1]) |
| `"bipolar"` | `x → 2x−1` (maps [0, 1] → [−1, 1]) |

**Slew** (`slew: 0.05` = 50 ms) applies a one-pole lowpass smoother to
the route, for things like "ease the envelope follower so a transient
doesn't punch the filter."

**Reserved sources** (instrument graphs only — see
[`06-instrument-graphs.md`](06-instrument-graphs.md)):

- `"velocity"` — MIDI velocity (0..1)
- `"note"` — MIDI note number
- `"gate"` — 1 on noteOn, 0 on noteOff
- `"pitch"` — note frequency in Hz
- `"follower:<nodeId>"` — envelope-follower extract from any node

Envelope-following for free: combine `"abs"` + `"slew"` in a modRoute
from any audio source. That's the standard envelope-follower
pipeline built out of declarative primitives — no dedicated node
type needed.

## Parameter binding

Parameter keys are dot-paths that drill into node fields:

```json
"parameters": [
  { "key": "d1.delayTime",  "label": "TIME", "min": 0.01, "max": 1.5, "default": 0.375, "step": 0.01 },
  { "key": "fb.gain",       "label": "FBK",  "min": 0,    "max": 0.9, "default": 0.5,   "step": 0.01 },
  { "key": "lpf.frequency", "label": "TONE", "min": 200,  "max": 18000,"default": 6000, "step": 10  }
]
```

The `d1.delayTime` key drives the `delayTime` AudioParam on the
`delay` node with id `"d1"`. The host resolves `<nodeId>.<fieldName>`
by looking up the node, then the named AudioParam, then calling
`setValueAtTime` (or `setTargetAtTime` for smooth updates).

**What's automatable:** every Web Audio AudioParam of every node type,
plus worklet `parameterDescriptors`, plus the LFO `rate`/`depth`,
envelope level targets, etc. The full list is every field the host
treats as an AudioParam — generally, anything that appears as a
`.value`-settable property in the Web Audio API is fair game.

**What's not automatable:** node type, filter type string, channel
count, anything that's baked at creation time. The parameter key
`lpf.filterType` wouldn't do anything because `filterType` is a
string, not an AudioParam.

## Where FX plugins render

Loaded FX plugins appear in the tracker's FX Mixer panel alongside
built-in FX modules. They can be added to any tracker channel's
insert chain. When added, the host:

1. Materialises the DSP graph from your `nodes` / `connections`
2. Wires `"input"` to the channel strip's pre-fade tap
3. Wires `"output"` to the channel strip's return
4. Renders the UI next to the other FX modules

Parameter changes in the UI call `AudioParam.setTargetAtTime()` with
a ~20 ms time constant so automation sounds smooth. Presets apply
all parameter changes at once.

## Common pitfalls

**"My graph has no output."** Check that at least one connection
leads to the reserved `"output"` node. Without it, the FX chain is a
dead-end.

**"Nothing plays through."** Did you connect `"input"` to something?
A pure-wet effect with no dry path needs `{ "from": "input", "to": <first node> }`
or the input signal goes nowhere.

**"I get feedback / oscillation."** Check your feedback gain. A
`gain` node with `gain > 1` in a feedback loop will eventually blow
up. Cap at 0.9 for delays, less for longer loops.

**"My parameter doesn't change anything."** The dot-path key has to
match a node ID + AudioParam name exactly. `"delay1.time"` won't
work if the node is `"d1"` or the param is `"delayTime"`.

**"The modulation route does nothing."** Check the source is emitting
signal (LFOs need non-zero `lfoDepth`; envelopes need non-zero
stages). Check the target is an automatable AudioParam. Check
`depth` is non-zero. `modMatrix-v3` capability flag is required for
the multi-target form.

## See also

- [`02-parameters.md`](02-parameters.md) — parameter keys and dot-paths
- [`03-ui-controls.md`](03-ui-controls.md) — FX UI rendering
- [`06-instrument-graphs.md`](06-instrument-graphs.md) — the same
  node types in a per-voice instrument graph
- [`07-audioworklets.md`](07-audioworklets.md) — the `worklet` node type
- [`reference/schema.md`](reference/schema.md) — `PluginFxDsp` and
  `PluginDspNode` field reference
- [`../templates/fx-graph/`](../templates/fx-graph/) — ready-to-copy
  stereo delay template
