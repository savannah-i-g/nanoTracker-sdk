# v3 instrument graphs

v3 added `dsp.graph` to the instrument DSP block — a declarative
per-voice DSP graph with the **same node types and connection syntax
as FX plugins**, but instantiated once per active note. When you use
this, the built-in sampler/oscillator/envelope engine is replaced
entirely and you're in full control of the signal chain.

**Prerequisites for this page:**
- You've read [`04-instruments.md`](04-instruments.md) (instrument
  basics and the legacy v1/v2 engine)
- You've read [`05-fx-graphs.md`](05-fx-graphs.md) (node types,
  connection syntax, mod routes are the same)

**When to use v3 graphs:**

- Your synth needs more than one filter stage
- You want multiple envelopes / LFOs with independent routing
- You want a proper mod matrix (one source driving many targets)
- You want to use `granular` or `wavetable` nodes
- You want the built-in oscillator/sample pipeline to be fully
  replaceable with your own topology

**When to skip v3 graphs** and stick with the legacy v1/v2 engine:

- Your synth fits cleanly into "oscillators → filter → ADSR → out"
- You just need sample playback with velocity layers and key ranges
- You're building a drum machine or instrument sampler

## Minimum viable v3 graph instrument

```json
{
  "schemaVersion": 3,
  "manifest": { "name": "GRAPH SAW", "version": "1.0.0", "type": "instrument" },
  "requires": ["graph"],
  "parameters": [
    { "key": "filter.frequency", "label": "CUT", "min": 100, "max": 16000, "default": 2000, "step": 1, "curve": "exponential" },
    { "key": "filter.Q",         "label": "RES", "min": 0.5, "max": 20,    "default": 1,    "step": 0.1 }
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
        { "id": "osc",    "type": "oscillator", "oscType": "sawtooth" },
        { "id": "filter", "type": "biquad", "filterType": "lowpass", "frequency": 2000, "Q": 1 },
        { "id": "amp",    "type": "gain",   "gain": 0.3 }
      ],
      "connections": [
        { "from": "osc",    "to": "filter" },
        { "from": "filter", "to": "amp" },
        { "from": "amp",    "to": "voiceOut" }
      ],
      "modRoutes": [
        { "source": "pitch",    "target": "osc.frequency", "depth": 1 },
        { "source": "velocity", "targets": [
          { "target": "amp.gain", "depth": 0.7, "curve": "exponential" }
        ]}
      ]
    }
  },
  "ui": {
    "layout": "flex",
    "controls": [
      { "type": "knob", "parameter": "filter.frequency", "label": "CUT" },
      { "type": "knob", "parameter": "filter.Q",         "label": "RES" }
    ]
  }
}
```

This is a one-oscillator monosynth with velocity-sensitive amp. Every
note instantiates its own copy of the `osc`/`filter`/`amp` chain.

## How it differs from FX graphs

Same node types. Same `connections[]` syntax. Same `modRoutes[]`
shape. The differences are all about **instantiation and wiring to
the voice-lifecycle machinery**:

- **Scope**: nodes default to `scope: "voice"` (instantiated once
  per note) instead of `scope: "shared"` (FX default)
- **Reserved stubs**: `"voiceIn"` / `"voiceOut"` replace the FX
  `"input"` / `"output"` stubs
- **Reserved modulation sources**: `velocity`, `note`, `gate`, `pitch`
  are auto-wired ConstantSources available per voice
- **Voice lifecycle**: `gate` is raised on `noteOn` and lowered on
  `noteOff`; envelopes route from `gate` and drive the amp
- **Shared nodes**: some things (global reverbs, master LFOs, the
  output bus) should be `scope: "shared"` so there's one instance
  across all voices

### Reserved stub nodes

| Stub | Purpose |
|---|---|
| `"voiceIn"` | Per-voice input (rarely used; present for feedback topologies that need a voice-local input point) |
| `"voiceOut"` | Per-voice output. Everything that should reach the instrument bus connects TO this. |
| `"output"` | Engine-level output mix node (shared scope). Equivalent to `"port:<first audio out id>"` for v4 plugins. |
| `"instrumentIn"` | Legacy single audio input jack (shared scope). Equivalent to `"port:<first audio in id>"` for v4 plugins. |
| `"port:<id>"` | <sup>v4</sup> Manifest-declared multi-port jack reference. The `<id>` matches an entry in `ports.inputs[]` / `ports.outputs[]`. Use these when your plugin has more than one audio input or output. See [`14-ports.md`](14-ports.md). |

You can override the names via `voiceInput` / `voiceOutput` fields
on `PluginInstrumentDsp` but there's almost never a reason to.

For v4 multi-port plugins the host creates one `GainNode` per
referenced `port:<id>` automatically — only ports that appear in
the connections list get a node, so unreferenced manifest ports
cost no audio-graph state.

### Reserved modulation sources

| Source | Type | Emits |
|---|---|---|
| `"velocity"` | ConstantSource, 0..1 | `noteOn` velocity ÷ 127 |
| `"note"` | ConstantSource, MIDI note number | raw note value |
| `"gate"` | ConstantSource, 0 or 1 | 1 while held, 0 after release |
| `"pitch"` | ConstantSource, Hz | frequency corresponding to `note` |

These are created automatically per voice and aren't declared in
`graph.nodes`. You reference them from `modRoutes[]` by name:

```json
"modRoutes": [
  { "source": "velocity", "target": "amp.gain", "depth": 1 },
  { "source": "gate",     "target": "env1.level", "depth": 1 },
  { "source": "pitch",    "target": "osc1.frequency", "depth": 1 },
  { "source": "note",     "target": "filter.frequency", "depth": 120, "transform": "square" }
]
```

**Follower sources** — for every audio-rate node in your graph you
can route its envelope-follower extract via `source: "follower:<nodeId>"`:

```json
{ "source": "follower:osc1", "target": "filter.Q", "depth": 5, "transform": "abs", "slew": 0.05 }
```

The host builds an abs-then-slew follower pipeline and feeds it into
the target. Classic "filter Q tracks the oscillator amplitude" in
one line.

## Node scope

By default every node in a v3 instrument graph is `scope: "voice"` —
instantiated per active note. Override individual nodes with
`scope: "shared"` to instantiate once per plugin instance:

```json
"nodes": [
  { "id": "osc",   "type": "oscillator", "oscType": "sawtooth" },
  { "id": "verb",  "type": "convolver", "impulse": "samples/hall.wav", "scope": "shared" }
]
```

Or declare a list of shared node IDs at the instrument DSP level:

```json
"dsp": {
  "sharedNodes": ["verb", "masterEq"],
  "graph": { ... }
}
```

Both forms do the same thing; use whichever is clearer for your plugin.

**Why it matters:** a convolver node with an 8-second impulse
response is expensive. If you make it voice-scope, you pay that cost
for every note — on a synth with 16-note polyphony, that's 16 copies
of the reverb running simultaneously. Marking it `"shared"` means
one global reverb, fed by every voice's output, matching how a real
synth rig would be wired.

**Typical shared-scope nodes:**

- Convolvers (reverb tails)
- Master compressors / limiters
- Global LFOs that should be in-phase across voices
- Master EQ
- Output bus GainNodes for mastering

**Typical voice-scope nodes** (the default, no annotation needed):

- Oscillators, noise sources
- Per-voice filters
- Envelopes (the gate is per-voice, so envelopes must be too)
- Per-voice amp gains
- Per-voice LFOs (for vibrato where you want different phase per note)

## Multi-stage envelopes

v2 introduced `envelopes[]` — named envelopes with multi-stage
breakpoints instead of fixed ADSR:

```json
"envelopes": [
  {
    "id": "ampEnv",
    "stages": [
      { "target": 1.0, "time": 0.005, "curve": "linear"      },
      { "target": 0.8, "time": 0.1,   "curve": "exponential" },
      { "target": 0.6, "time": 0.2,   "curve": "exponential" },
      { "target": 0,   "time": 0.5,   "curve": "exponential" }
    ]
  }
]
```

Each stage ramps from the current level toward `target` over `time`
seconds. You reference envelopes as modulation sources by their `id`:

```json
"modRoutes": [
  { "source": "ampEnv", "target": "amp.gain", "depth": 1 }
]
```

Envelopes are gated by `"gate"` automatically — on `noteOn`, the
envelope plays forward through its stages; on `noteOff`, the host
inserts a release ramp toward zero with the duration of the final
stage.

**Ordering**: the last stage's `target` is treated as the release
target, so always set it to `0` (or near-zero) for amp envelopes.

**Curves**: `"linear"` for the classic ramp, `"exponential"` for a
natural-sounding decay/release.

**Multiple envelopes**: declare as many as you need — one for the
amp, one for the filter, one for pitch, one for whatever. Each one
can be routed to a different target.

## Granular and wavetable nodes (v3)

For more specialised synthesis, v3 ships two host-implemented
AudioWorklet nodes as graph node types.

### `granular`

```json
{
  "id": "grain",
  "type": "granular",
  "sampleFile": "samples/pad.wav",
  "playbackMode": "pingpong",
  "grainEnvelope": "hann"
}
```

Granular resynthesis of a sample file. The sample is decoded once at
load time; the worklet generates overlapping grains from it at
positions driven by modulation.

`playbackMode` (default `"forward"`) controls how grains traverse the
source buffer:

| Mode | Behaviour |
|---|---|
| `"forward"` | Grains play at the natural forward rate. |
| `"reverse"` | Grains play backwards through the source. |
| `"pingpong"` | Each spawned grain independently picks forward or reverse (50/50). Produces a characteristic chorus-like texture without a shared phase state. |
| `"freeze"` | Ignores `scanRate` and position drift — grains freeze at whatever `position` reads at spawn. Jitter still applies, giving a "frozen cloud" sound. |

`grainEnvelope` (default `"hann"`) controls the per-grain window shape:
`"hann"` (clean tonal grains), `"triangle"` (cheap, crunchy), or
`"rectangular"` (no window — only use when you really mean it).

**Automatable parameters** (exposed as `<nodeId>.<paramName>`):

| Param | Range | Purpose |
|---|---|---|
| `position` | 0..1 | Source playhead, normalised over the sample. |
| `density` | 0.1..200 | Grains per second. |
| `grainSize` | 0.005..1.0 | Per-grain duration in seconds. |
| `pitch` | -48..48 | Semitone offset applied to each grain's playback rate (independent of position). |
| `scanRate` | -10..10 | Auto-scan rate over the source, in cycles per second. `0` holds the playhead. Ignored in `freeze` mode. |
| `pan` | -1..+1 | Base stereo pan position (equal-power). |
| `gate` | 0..1 | Spawn enable. Below 0.5, no new grains spawn; already-live grains age out naturally (soft release tail). |
| `positionJitter` | 0..1 | Random spread applied to `position` at spawn. |
| `pitchJitter` | 0..200 | Cents of random pitch spread per grain. |
| `sizeJitter` | 0..1 | Multiplicative randomisation of `grainSize`. |
| `panJitter` | 0..1 | Random pan spread around the base `pan`. |

Internally the grain pool is capped at 128 active grains; at high
density settings new grains are dropped (never allocated) rather than
stealing — audible as a density ceiling, not a glitch.

Requires `"granular"` in `requires[]`.

### `wavetable`

```json
{
  "id": "wt",
  "type": "wavetable",
  "tableFile": "samples/wavetable.wav",
  "frameCount": 64,
  "interpolation": "linear"
}
```

Wavetable oscillator reading from a concatenation of single-cycle
waveforms. `frameCount` tells the host how many cycles are in the
file. `interpolation` controls intra-frame smoothing:
`"linear"` (default) or `"none"` (chip-like zipper artefacts).

**Automatable parameters**:

| Param | Range | Purpose |
|---|---|---|
| `frequency` | 0..20000 Hz | Oscillator frequency. When your graph feeds the voice's `pitch` ConstantSource into this param, you get note-tracking for free. |
| `framePosition` | 0..1 | Interpolated position through the table. `0` = first frame, `1` = last frame. The processor blends linearly between adjacent frames. |
| `detune` | -1200..+1200 cents | Fine-tune on top of `frequency`. |
| `gain` | 0..1 | Output level. |

**Note on `framePosition`:** the parameter is normalised to `0..1` —
not `0..frameCount-1`. Scale your LFOs / envelopes accordingly. Output
is always stereo (mono table replicated to both channels).

Requires `"wavetable"` in `requires[]`.

Both nodes behave as audio sources — connect their output downstream
in your graph the same way you'd use a built-in `oscillator` node.

## Worklet nodes as graph nodes

Any `worklet`-type node in your graph has its processor
**auto-wired** to the per-voice control sources if it declares
matching AudioParams. Specifically:

| AudioParam name | Auto-wired to |
|---|---|
| `pitch` | Per-voice pitch ConstantSource (Hz) |
| `gate` | Per-voice gate ConstantSource (0/1) |
| `velocity` | Per-voice velocity ConstantSource (0..1) |
| `gain` | Per-voice gain ConstantSource (host volume slides) |

So a custom worklet processor that declares
`parameterDescriptors: [{name: "pitch"}, {name: "gate"}]` will see
those values automatically update per-voice — you don't need to
write any modulation routes.

Full details in [`08-worklet-v3.md`](08-worklet-v3.md).

## Complete example — dual-LFO pad

```json
{
  "schemaVersion": 3,
  "manifest": { "name": "PAD", "version": "1.0.0", "type": "instrument" },
  "requires": ["graph"],
  "parameters": [
    { "key": "filter.frequency", "label": "CUT", "min": 100, "max": 16000, "default": 1800, "step": 1, "curve": "exponential" },
    { "key": "lfo1.lfoRate",     "label": "LFO1", "min": 0.1, "max": 10, "default": 0.5, "step": 0.01 },
    { "key": "lfo2.lfoRate",     "label": "LFO2", "min": 0.1, "max": 10, "default": 3,   "step": 0.01 }
  ],
  "dsp": {
    "processorName": null,
    "voices": 8,
    "voiceStealing": "quietest",
    "oscillators": [],
    "samples": [],
    "envelope": { "attack": 1.0, "decay": 0.5, "sustain": 0.8, "release": 2.5 },
    "filter": null,
    "envelopes": [
      {
        "id": "ampEnv",
        "stages": [
          { "target": 1, "time": 1.0,  "curve": "exponential" },
          { "target": 0.8, "time": 0.5, "curve": "exponential" },
          { "target": 0, "time": 2.5, "curve": "exponential" }
        ]
      }
    ],
    "graph": {
      "nodes": [
        { "id": "osc1",   "type": "oscillator", "oscType": "sawtooth" },
        { "id": "osc2",   "type": "oscillator", "oscType": "sawtooth" },
        { "id": "lfo1",   "type": "lfo", "lfoShape": "sine",     "lfoRate": 0.5, "lfoDepth": 20 },
        { "id": "lfo2",   "type": "lfo", "lfoShape": "triangle", "lfoRate": 3,   "lfoDepth": 10 },
        { "id": "filter", "type": "biquad", "filterType": "lowpass", "frequency": 1800, "Q": 1.5 },
        { "id": "amp",    "type": "gain", "gain": 0 },
        { "id": "verb",   "type": "convolver", "impulse": "samples/hall.wav", "scope": "shared" }
      ],
      "connections": [
        { "from": "osc1", "to": "filter" },
        { "from": "osc2", "to": "filter" },
        { "from": "filter", "to": "amp" },
        { "from": "amp", "to": "verb" },
        { "from": "verb", "to": "voiceOut" }
      ],
      "modRoutes": [
        { "source": "pitch", "target": "osc1.frequency", "depth": 1 },
        { "source": "pitch", "target": "osc2.frequency", "depth": 1 },
        { "source": "lfo1",  "target": "osc2.detune", "depth": 1 },
        { "source": "lfo2",  "target": "filter.frequency", "depth": 500 },
        { "source": "ampEnv", "targets": [
          { "target": "amp.gain", "depth": 0.4, "curve": "exponential" }
        ]}
      ]
    }
  },
  "ui": {
    "layout": "flex",
    "controls": [
      { "type": "knob", "parameter": "filter.frequency", "label": "CUT" },
      { "type": "knob", "parameter": "lfo1.lfoRate",     "label": "LFO1" },
      { "type": "knob", "parameter": "lfo2.lfoRate",     "label": "LFO2" }
    ]
  }
}
```

Two detuned sawtooths → lowpass filter → envelope amp → shared
convolver reverb → voice out. LFO1 slowly detunes the second
oscillator for chorus; LFO2 wobbles the filter. Amp envelope gives a
long attack and release for a classic pad.

## Common pitfalls

**"My graph compiles but there's no sound."** Check that at least one
connection terminates at `"voiceOut"`. Just like FX graphs need to
reach `"output"`, instrument graphs need to reach `"voiceOut"`.

**"The envelope doesn't gate."** Envelopes auto-gate on the per-voice
`gate` signal, but only if routed as a modulation source (not directly
wired as an audio signal). Make sure you have `{ "source": "ampEnv",
"target": "amp.gain", "depth": 1 }` in `modRoutes[]`.

**"The reverb is per-voice and expensive."** Mark it `scope: "shared"`
in the node declaration, or add its id to `sharedNodes[]`.

**"Two notes at the same pitch double up."** That's correct — each
note instantiates a fresh voice. If you want only one note per pitch,
use `voiceStealing: "oldest"` and `voices: 1` (monosynth), or
implement custom voice management in a worklet processor.

**"The pitch doesn't track the note."** You forgot the
`{ "source": "pitch", "target": "osc.frequency", "depth": 1 }`
modulation route. Reserved sources aren't auto-wired to anything —
you declare the routes explicitly.

## See also

- [`04-instruments.md`](04-instruments.md) — built-in instrument engine
- [`05-fx-graphs.md`](05-fx-graphs.md) — same node types, same syntax
- [`07-audioworklets.md`](07-audioworklets.md) — v1/v2 worklet contract
- [`08-worklet-v3.md`](08-worklet-v3.md) — v3 worklet instrument contract,
  auto-wired AudioParams
- [`reference/schema.md`](reference/schema.md) — `PluginGraph`,
  `PluginDspNode`, `PluginModRoute` reference
