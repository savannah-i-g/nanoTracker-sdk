# `plugin.json` schema reference

Every field of every block, with type, version, and a one-line
description. This page is the dense per-field lookup; the narrative
docs in `../01-plugin-format.md` and its neighbours explain how to
actually use them.

**Version markers**: <sup>v1</sup> / <sup>v2</sup> / <sup>v3</sup> /
<sup>v4</sup> next to a field means it was introduced in that schema
version. Unmarked fields are v1.

---

## Top level

```ts
{
  schemaVersion: 1 | 2 | 3 | 4,
  manifest:      PluginManifest,
  parameters?:   PluginParamDef[],
  dsp:           PluginFxDsp | PluginInstrumentDsp,
  ui?:           PluginUiDef,
  presets?:      PluginPreset[],        // v2+
  loopPresets?:  PluginLoopPreset[],    // instruments only
  ports?:        PluginPortsDef,        // v4 — unified typed port list
  requires?:     string[],              // v3+ capability flags
}
```

| Field | v | Required | Notes |
|---|---|---|---|
| `schemaVersion` | — | yes | Integer 1, 2, 3, or 4 |
| `manifest` | — | yes | Plugin identity (see below) |
| `parameters` | — | no | Array of `PluginParamDef` |
| `dsp` | — | yes | `PluginFxDsp` or `PluginInstrumentDsp`; branches on `manifest.type` |
| `ui` | — | no | Optional UI definition; auto-generated when missing |
| `presets` | v2 | no | Factory parameter snapshots |
| `loopPresets` | — | no | Instrument-only step sequences |
| `ports` | v4 | see below | Typed input/output port list. Required for `type: "fx"` (pedals). Optional for instruments (defaults to `{outputs:[{id:"out",label:"OUT",kind:"audio"}]}`). See [`../14-ports.md`](../14-ports.md). |
| `requires` | v3 | no | Capability flag gating |

Unknown top-level fields are silently ignored by the loader.

---

## `PluginManifest`

```ts
{
  name:         string,
  version:      string,
  type:         "instrument" | "fx",
  author?:      string,
  description?: string,
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Display name; forms part of plugin id `"plugin:<name>@<version>"` |
| `version` | yes | Free-form string, convention is semver |
| `type` | yes | Routes to correct DSP block schema. From v4 onwards, `"fx"` means **pedal** (floating window + patch cables). Legacy mixer-module FX is retired. |
| `author` | no | Attribution shown in UI |
| `description` | no | One-line summary shown in UI |

---

## `PluginPortsDef` (v4)

```ts
{
  inputs?:  PluginPortDef[],
  outputs?: PluginPortDef[],
}
```

Port list for the plugin's workspace jacks. Applies to both
instruments and pedals — unified port model. When omitted on an
instrument plugin, the host supplies a default
`{outputs: [{id:"out", label:"OUT", kind:"audio"}]}`. **Required**
for `type: "fx"` (pedal) plugins — the loader rejects pedals that
omit `ports`.

Narrative: [`../14-ports.md`](../14-ports.md).

### `PluginPortDef`

```ts
{
  id:     string,
  label:  string,
  kind:   "audio" | "sidechain" | "cv" | "gate",
  target?: string,   // required when kind == "cv": "<nodeId>.<paramName>"
  index?:  number,   // v4: override worklet input/output index for multi-port nodes
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique within `inputs[]` / `outputs[]`. Referenced from cable snapshots. Use short stable strings (`inL`, `inR`, `outL`, `sc`, `cvCutoff`). |
| `label` | yes | Display text on the jack in the UI. ALL-CAPS convention, 1–4 chars. |
| `kind` | yes | See port-kind table below. |
| `target` | when `kind: "cv"` | Names the target AudioParam inside the plugin's graph. Format: `"<nodeId>.<paramName>"`, e.g. `"filter.frequency"`. The host wires the incoming cable with `.connect(param)`. |
| `index` | no | Worklet input/output index when a single AudioWorkletNode exposes multiple ports. Defaults to port's position in the `inputs[]` / `outputs[]` array. |

### Port kinds

| Kind | Wire | Visual | Use |
|---|---|---|---|
| `audio` | `srcNode.connect(dstNode, outIdx, inIdx)` | solid jack ring | Standard mono/stereo audio signal. |
| `sidechain` | same as `audio` | dashed jack ring, sidechain accent | Electrically identical to `audio`, marked separately so users understand intent (compressor key input, ducker trigger, vocoder formant bus, etc.). |
| `cv` | `srcNode.connect(param)` | cv accent ring | Audio-rate control voltage routed to an `AudioParam`. The `target` field names the parameter. |
| `gate` | host-mediated edge watcher | dotted jack ring | Boolean trigger. Host watches the source for rising/falling edges above `0.5` and fires the plugin's gate handler. |

### Compatibility matrix

| Source \ Dest | audio | sidechain | cv | gate |
|---|---|---|---|---|
| `audio` | ✓ | ✓ | ✓ (scaled) | ✓ (edge) |
| `sidechain` | ✓ | ✓ | ✓ | ✓ |
| `cv` | ✗ | ✗ | ✓ | ✗ |
| `gate` | ✗ | ✗ | ✗ | ✓ |

Cross-kind mismatches are dropped silently with a console warning.

---

## `PluginParamDef`

```ts
{
  key:               string,
  label:             string,
  min:               number,
  max:               number,
  default:           number,
  step:              number,
  unit?:             string,
  displayDecimals?:  number,
  group?:            string,      // v2
  curve?:            "linear" | "exponential" | "logarithmic",  // v2
}
```

| Field | v | Required | Notes |
|---|---|---|---|
| `key` | — | yes | Unique identifier; referenced from UI, mod routes, presets |
| `label` | — | yes | ALL-CAPS display label |
| `min` | — | yes | Lower bound inclusive |
| `max` | — | yes | Upper bound inclusive |
| `default` | — | yes | Initial value |
| `step` | — | yes | Quantisation step |
| `unit` | — | no | Display suffix (e.g. `"Hz"`, `"s"`) |
| `displayDecimals` | — | no | Precision digits |
| `group` | v2 | no | Cosmetic grouping hint |
| `curve` | v2 | no | Non-linear UI value mapping |

Narrative: [`../02-parameters.md`](../02-parameters.md)

---

## `PluginPreset` (factory presets, v2+)

```ts
{
  name:   string,
  values: Record<string, number>,  // parameter key → value
}
```

Applying a preset writes every key/value pair to the plugin's
parameters at once.

---

## `PluginLoopPreset` (instruments only)

```ts
{
  name:  string,
  steps: PluginPresetStep[],
}
```

### `PluginPresetStep`

```ts
{
  padIndex: number,      // 1-based, 0 = silent
  pitch?:   number,      // semitones, default 0
  volume?:  number,      // 0-100, default 100
  reverse?: boolean,     // default false
  active?:  boolean,     // default true
}
```

---

## `PluginFxDsp`

```ts
{
  processorName: string | null,
  nodes:         PluginDspNode[],
  connections:   PluginDspConnection[],
  modRoutes?:    PluginModRoute[],    // v2
}
```

| Field | v | Required | Notes |
|---|---|---|---|
| `processorName` | — | yes | AudioWorklet processor name, or `null` for pure declarative graph |
| `nodes` | — | yes | Node definitions |
| `connections` | — | yes | Edges between nodes |
| `modRoutes` | v2 | no | Modulation routing |

Reserved node IDs: `"input"`, `"output"` (pre-created by the host).

Narrative: [`../05-fx-graphs.md`](../05-fx-graphs.md)

---

## `PluginInstrumentDsp`

```ts
{
  processorName:  string | null,
  voices:         number,
  voiceStealing:  "oldest" | "quietest" | "none",
  oscillators:    PluginOscillatorDef[],
  samples:        PluginSampleZone[],
  envelope:       PluginEnvelope,
  filter:         PluginFilterDef | null,

  envelopes?:     PluginEnvelopeDef[],    // v2
  lfos?:          PluginLfoDef[],         // v2
  modRoutes?:     PluginModRoute[],       // v2
  filters?:       PluginFilterDef[],      // v2
  unison?:        PluginUnisonDef,        // v2
  portamento?:    PluginPortamentoDef,    // v2
  noiseType?:     "white" | "pink" | "brown",  // v2

  graph?:         PluginGraph,            // v3
  sharedNodes?:   string[],               // v3
  voiceInput?:    string,                 // v3, default "voiceIn"
  voiceOutput?:   string,                 // v3, default "voiceOut"
  requires?:      string[],               // v3
  releaseTail?:   number,                 // v3, default 8 seconds
  worklet?:       PluginWorkletInstrumentDef,  // v3
}
```

Narrative:
- [`../04-instruments.md`](../04-instruments.md) — v1/v2 engine
- [`../06-instrument-graphs.md`](../06-instrument-graphs.md) — v3 graph
- [`../08-worklet-v3.md`](../08-worklet-v3.md) — v3 worklet form

---

## `PluginDspNode`

```ts
{
  id:                      string,
  type:                    FxNodeType,
  scope?:                  "voice" | "shared",   // v3
  // v1 node-type-specific fields:
  gain?:                   number,
  maxDelay?:               number,
  delayTime?:              number,
  impulse?:                string,
  normalize?:              boolean,
  frequency?:              number,
  Q?:                      number,
  filterType?:             BiquadFilterType,
  threshold?:              number,
  ratio?:                  number,
  attack?:                 number,
  release?:                number,
  knee?:                   number,
  pan?:                    number,
  curve?:                  "sigmoid" | "clip" | "fold",
  drive?:                  number,
  // v2 additions:
  channelCount?:           number,
  oscType?:                OscillatorType,
  oscFrequency?:           number,
  lfoShape?:               LfoShape,
  lfoRate?:                number,
  lfoDepth?:               number,
  envStages?:              PluginEnvelopeStage[],
  fftSize?:                number,
  // v3 additions:
  sampleFile?:             string,
  playbackMode?:           "forward" | "reverse" | "pingpong" | "freeze",
  grainEnvelope?:          "hann" | "triangle" | "rectangular",
  tableFile?:              string,
  frameCount?:             number,
  interpolation?:          "linear" | "none",
  parameterDescriptors?:   PluginWorkletParamDescriptor[],
}
```

### `FxNodeType`

| Type | v | Purpose |
|---|---|---|
| `gain` | — | Amplification / mixing point |
| `delay` | — | Time-based delay line |
| `biquad` | — | 2nd-order filter (lowpass, highpass, bandpass, peaking, etc.) |
| `compressor` | — | Dynamics compressor |
| `convolver` | — | Impulse-response reverb |
| `panner` | — | Stereo positioning |
| `waveshaper` | — | Non-linear saturation / distortion |
| `worklet` | — | Custom AudioWorkletNode from `script.js` |
| `mixer` | v2 | Summing GainNode (semantic alias) |
| `splitter` | v2 | ChannelSplitterNode |
| `merger` | v2 | ChannelMergerNode |
| `oscillator` | v2 | OscillatorNode (audio-rate) |
| `constant` | v2 | ConstantSourceNode (DC bias) |
| `analyser` | v2 | AnalyserNode (FFT pass-through) |
| `lfo` | v2 | LFO (Osc + Gain pair) |
| `envelope` | v2 | Multi-stage envelope generator |
| `granular` | v3 | Host-shipped granular synth (requires `"granular"` capability) |
| `wavetable` | v3 | Host-shipped wavetable synth (requires `"wavetable"` capability) |
| `sampler` | v4.1 | Unified sampler primitive — zones + slice map + round-robin + choke + release-triggered + pitch-tracking. Requires `"sampler-v41"`; `sliceMap` additionally requires `"sliceMap-v41"`. See [`../16-sampler-node.md`](../16-sampler-node.md) |

### Per-type fields

Which fields apply to which node type:

| Field | Applies to |
|---|---|
| `gain` (field) | `gain`, `mixer` |
| `maxDelay`, `delayTime` | `delay` |
| `impulse`, `normalize` | `convolver` |
| `frequency`, `Q`, `filterType` | `biquad` |
| `threshold`, `ratio`, `attack`, `release`, `knee` | `compressor` |
| `pan` | `panner` |
| `curve`, `drive` | `waveshaper` |
| `channelCount` | `splitter`, `merger` (default 2) |
| `oscType`, `oscFrequency` | `oscillator` |
| `lfoShape`, `lfoRate`, `lfoDepth` | `lfo` |
| `envStages` | `envelope` |
| `fftSize` | `analyser` (default 256) |
| `sampleFile`, `playbackMode`, `grainEnvelope` | `granular` |
| `tableFile`, `frameCount`, `interpolation` | `wavetable` |
| `zones[]`, `sliceMap`, `polyphony`, `samplerVoiceStealing` | `sampler` (v4.1) |
| `parameterDescriptors` | `worklet` |

### Scope (v3, instrument graphs only)

- `scope: "voice"` — instantiated per active note (default for
  instrument graph nodes)
- `scope: "shared"` — instantiated once per plugin (default for FX
  graph nodes)

---

## `PluginDspConnection`

```ts
{
  from:          string,    // node id, "input", "instrumentIn", or "port:<id>" (v4)
  to:            string,    // node id, "output", or "port:<id>" (v4)
  toParam?:      string,    // v2: target AudioParam instead of input
  outputIndex?:  number,    // v2: ChannelSplitterNode output channel
  inputIndex?:   number,    // v2: ChannelMergerNode input channel
}
```

**v4 port references.** When the plugin declares a top-level
`ports` block, connections may name any manifest port via
`"port:<id>"` where `<id>` matches an entry in `ports.inputs[].id`
or `ports.outputs[].id`. The host creates one shared GainNode per
referenced port id and resolves the connection through it. Legacy
shortcuts `"instrumentIn"` (first audio input) and `"output"`
(first audio output) continue to work alongside `port:<id>`. See
[`../14-ports.md`](../14-ports.md) for the full reference.

---

## `PluginModRoute`

v2 form (single target):

```ts
{
  source:   string,    // node id or reserved ("velocity"/"note"/"gate"/"pitch"/"follower:<id>")
  target:   string,    // "nodeId.paramName"
  depth:    number,
  bipolar?: boolean,
}
```

v3 form (multi target):

```ts
{
  source:  string,
  targets: PluginModRouteTarget[],
}
```

### `PluginModRouteTarget` (v3)

```ts
{
  target:    string,    // "nodeId.paramName"
  depth:     number,
  bipolar?:  boolean,
  curve?:    "linear" | "exponential" | "logarithmic",
  transform?: "none" | "invert" | "abs" | "square" | "unipolar" | "bipolar",
  offset?:   number,
  scale?:    number,
  slew?:     number,    // seconds (single-pole lowpass smoother)
}
```

### Reserved source names

| Source | Type | Emits |
|---|---|---|
| `velocity` | ConstantSource | 0..1, velocity / 127 |
| `note` | ConstantSource | MIDI note number |
| `gate` | ConstantSource | 1 on noteOn, 0 on noteOff |
| `pitch` | ConstantSource | Note frequency in Hz |
| `follower:<nodeId>` | follower pipeline | `abs`+`slew` over the named node's output |

---

## `PluginOscillatorDef`

```ts
{
  type:       OscillatorType | "noise",
  detune:     number,        // cents
  mix:        number,        // 0..1
  fmTarget?:  string,        // v2: oscillator id to modulate
  fmDepth?:   number,        // v2: FM modulation index in Hz
}
```

`OscillatorType` is the Web Audio type: `"sine"` / `"square"` /
`"sawtooth"` / `"triangle"`. `"noise"` selects the built-in noise
generator whose colour is set by the instrument's top-level
`noiseType`.

---

## `PluginSampleZone`

```ts
{
  file:          string,
  rootKey:       number,     // MIDI note at original pitch
  keyRange:      { lo: number, hi: number },
  velocityRange: { lo: number, hi: number },
  // loop mode — boolean (v1) or union string (v4.1, requires "sampler-v41")
  loop:          boolean | "none" | "forward" | "pingpong" | "release",
  loopStart:     number,     // seconds
  loopEnd:       number,     // seconds, 0 = end of buffer
  loopCrossfade?: number,    // v4.1 — equal-power seam fade, seconds
  startOffset:   number,     // seconds into buffer
  duration:      number,     // max playback duration, 0 = play to end
  // ── v4.1 additions — require "sampler-v41" ──
  roundRobinGroup?: string,  // same group rotates across triggers
  choke?:           string,  // same group cuts each other off
  trigger?:         "attack" | "release",   // "release" fires on noteOff
  pitchTracking?:   boolean, // false = fixed rate regardless of note
  // ── v4.1 — require "sampleMeta-v41" when authored manually ──
  meta?: {
    originalTempo?: number,  // BPM — from ACID chunk at load time
    originalKey?:   number,  // MIDI note — from SMPL chunk
    cuePoints?: Array<{ id: string, time: number, label?: string }>,
  },
}
```

Fields under the "v4.1 additions" section are silently ignored by
pre-v4.1 hosts, so declaring `"sampler-v41"` in `requires[]` is the
only way to guarantee correct playback. The loader also auto-fills
`meta` from WAV SMPL/ACID/cue chunks when the source WAV carries
them; author-supplied values win over auto-extracted ones.

---

## Sampler node

```ts
// One entry in dsp.graph.nodes[] (or FX dsp.nodes[])
{
  id:   string,
  type: "sampler",
  scope?: "voice" | "shared",  // default "voice" for instrument graphs

  // At least one of zones[] or sliceMap is required.
  zones?:    PluginSampleZone[],
  sliceMap?: PluginSliceMap,

  polyphony?: number,                          // 1..64, default 16
  samplerVoiceStealing?: "oldest" | "quietest" | "none",
}
```

### `PluginSliceMap` (v4.1, requires `"sliceMap-v41"`)

```ts
{
  source: string,           // archive-relative WAV path (Phase B: "slotId:<id>")
  slices?: Array<{
    start:    number,       // seconds into source
    end:      number,       // must be > start
    note?:    number,       // default: 36 + index
    velocity?: number,      // min velocity, default 1
    choke?:            string,
    roundRobinGroup?:  string,
    releaseOnGate?:    boolean,
  }>,
  autoDetect?: "markers" | "transients" | "grid:<N>" | null,
  triggerMode?: "oneShot" | "gated",    // default "oneShot"
}
```

`autoDetect` fills in `slices[]` at load time:

- `"markers"` — read the source WAV's `cue ` chunk and derive
  slice boundaries from consecutive cue points.
- `"grid:N"` — divide the source uniformly into `N` equal slices.
  Literal form: `"grid:16"` for 16 slices.
- `"transients"` — onset detection. Phase A falls back to
  `"grid:16"` until the transient detector ships; authors can
  target the final form now and the behaviour upgrades transparently.

`triggerMode: "gated"` loops the slice region at audio rate while
the key is held (classic sampler / rompler behaviour); the default
`"oneShot"` plays each slice through to its end regardless of note
duration.

---

## `PluginEnvelope`

```ts
{
  attack:  number,    // seconds
  decay:   number,    // seconds
  sustain: number,    // 0..1
  release: number,    // seconds
}
```

---

## `PluginEnvelopeDef` (v2, named envelopes)

```ts
{
  id:     string,
  stages: PluginEnvelopeStage[],
  loop?:  boolean,
}
```

### `PluginEnvelopeStage`

```ts
{
  target: number,      // level (0..1 typical)
  time:   number,      // seconds to reach target
  curve?: "linear" | "exponential",
}
```

---

## `PluginFilterDef`

```ts
{
  type:      BiquadFilterType,    // "lowpass" | "highpass" | "bandpass" | ...
  frequency: number,
  Q:         number,
}
```

---

## `PluginLfoDef` (v2, extended v3.5)

```ts
{
  id:        string,
  shape:     "sine" | "triangle" | "square" | "sawtooth" | "sample-and-hold",
  rate:      number,     // Hz (used when sync is false/absent)
  depth:     number,
  sync?:     boolean,    // v3.5: slave rate to host BPM
  syncRate?: string,     // v3.5: musical division — "1/1" | "1/2" | "1/2." | "1/2T"
                         //                         | "1/4" | "1/4." | "1/4T"
                         //                         | "1/8" | "1/8." | "1/8T"
                         //                         | "1/16" | "1/32"
                         //                         | "<n>" for whole bars (4/4 assumed)
                         //       Default "1/4".
}
```

When `sync` is true, `rate` (Hz) is ignored — the host computes
cycles/second from the current BPM and `syncRate`. LFOs follow live BPM
changes automatically. OscillatorNode shapes update phase-continuously;
the `"sample-and-hold"` shape picks up the new rate within ~4s (its
scheduling horizon).

---

## `PluginUnisonDef` (v2)

```ts
{
  count:        number,    // 1-8
  detune:       number,    // cents spread
  stereoSpread: number,    // 0-1
}
```

---

## `PluginPortamentoDef` (v2)

```ts
{
  time: number,                    // seconds
  mode: "always" | "legato",
}
```

---

## `PluginGraph` (v3)

```ts
{
  nodes:       PluginDspNode[],
  connections: PluginDspConnection[],
  modRoutes?:  PluginModRoute[],
}
```

Same shape as `PluginFxDsp` minus `processorName`. Used both inside
`PluginInstrumentDsp.graph` and (conceptually) as the type the graph
builder materialises from.

Reserved stub nodes: `"voiceIn"` and `"voiceOut"` (per-voice) plus any
`sharedNodes[]` the author declares.

---

## `PluginWorkletInstrumentDef` (v3)

```ts
{
  processorName:        string,
  numberOfInputs?:      number,
  numberOfOutputs?:     number,
  outputChannelCount?:  number[],
  assets?:              string[],
  initMessage?:         Record<string, unknown>,
}
```

Narrative: [`../08-worklet-v3.md`](../08-worklet-v3.md)  
Protocol: [`worklet-protocol.md`](worklet-protocol.md)

---

## `PluginWorkletParamDescriptor` (v3)

```ts
{
  name:             string,
  defaultValue?:    number,
  minValue?:        number,
  maxValue?:        number,
  automationRate?:  "a-rate" | "k-rate",
}
```

Advisory mirror of the processor's own `parameterDescriptors`. Used by
the loader to validate that every declared parameter has a matching
`<nodeId>.<paramName>` entry in `parameters[]`.

---

## `PluginUiDef`

```ts
{
  layout:         "grid" | "flex",
  controls:       PluginUiControl[],
  accentColor?:   string,                // v2
  minWidth?:      number,                // v2
  minHeight?:     number,                // v2
  themeOverride?: PluginThemeOverride,   // v3.5
}
```

### `PluginThemeOverride` (v3.5)

```ts
Partial<{
  primary:       string,   // CSS colour — maps to --color-primary
  primaryDim:    string,   //              --color-primary-dim
  primaryGlow:   string,   //              --color-primary-glow
  bg:            string,   //              --color-bg
  bgElevated:    string,   //              --color-bg-elevated
  text:          string,   //              --color-text
  textDim:       string,   //              --color-text-dim
  border:        string,   //              --color-border
  scanline:      string,   //              --color-scanline
  highlightBg:   string,   //              --color-highlight-bg
  highlightText: string,   //              --color-highlight-text
}>
```

Any subset of the 11 keys. Omitted keys fall through to the currently-
active global theme via the CSS cascade — so a plugin that overrides
only `primary` and `bg` keeps in sync with the user's chosen `text` /
`border` / etc. when they switch themes.

**Requires** the `"themeOverride"` capability in `requires[]`. The host
loader throws at load time if the capability is missing. Webview iframes
receive the resolved theme (globals merged with override) as a
`themeChange` [`VoiceEngineEvent`](event-bus.md) on mount and on every
global theme change.

---

## `PluginUiControl`

```ts
{
  type:         PluginControlType,
  parameter?:   string,
  label?:       string,
  sampleIndex?: number,
  // v2
  parameterX?:  string,
  parameterY?:  string,
  analyserNode?: string,
  options?:     string[],
  children?:    PluginUiControl[],
  style?:       "row" | "column",
  width?:       number,
  height?:      number,
  // v3 webview
  source?:              string,
  aspectRatio?:         string,
  sandbox?:             string,
  forwardNotes?:        boolean,
  forwardParams?:       boolean,
  forwardEffects?:      boolean,
  acceptsAudioFrames?:  boolean,
  acceptsFocus?:        boolean,
  // v4 webview bidirectional bridge
  acceptsParamWrites?:  boolean,
  acceptsPresetWrites?: boolean,
  acceptsNotes?:        boolean,
  acceptsHostCommands?: boolean,
}
```

### `PluginControlType`

| Type | v | Purpose |
|---|---|---|
| `knob` | — | Rotary dial |
| `slider` | — | Horizontal fader |
| `toggle` | — | On/off switch |
| `select` | — | Dropdown |
| `number` | — | Numeric input |
| `waveform_view` | — | Canvas waveform (sample or live) |
| `xy_pad` | v2 | 2D parameter control |
| `envelope_editor` | v2 | ADSR breakpoint editor |
| `meter` | v2 | Level bar from analyser |
| `label` | v2 | Static text |
| `group` | v2 | Nested container |
| `webview` | v3 | Sandboxed iframe with postMessage bridge |

### Field applicability

| Field | Applies to |
|---|---|
| `parameter` | `knob`, `slider`, `toggle`, `select`, `number` |
| `sampleIndex` | `waveform_view` (static mode) |
| `parameterX`, `parameterY` | `xy_pad` |
| `analyserNode` | `meter`, `waveform_view` (live mode) |
| `options` | `select` |
| `children`, `style` | `group` |
| `width`, `height` | `waveform_view`, `meter`, `xy_pad`, `envelope_editor`, `webview` |
| `source`, `aspectRatio`, `sandbox`, `forward*`, `accepts*` | `webview` |
| `acceptsParamWrites`, `acceptsPresetWrites`, `acceptsNotes`, `acceptsHostCommands` | `webview` (v4 — gates iframe→host write channel per class). See [`../09-webview.md`](../09-webview.md#bidirectional-bridge-v4). |

Narrative: [`../03-ui-controls.md`](../03-ui-controls.md),
[`../09-webview.md`](../09-webview.md)

---

## Capability flags

Declared in top-level `requires: string[]` (and optionally
`dsp.requires: string[]` for instrument plugins).

See [`host-capabilities.md`](host-capabilities.md) for the
authoritative per-flag reference.

---

## Voice engine events

Not part of `plugin.json` proper — these are the event shapes posted
to webview iframes at runtime. See [`event-bus.md`](event-bus.md).

---

If a field is missing from this page or behaves differently than
described, that's a spec bug — please file an issue.
