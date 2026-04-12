# Instruments

An instrument plugin is a `.ntins` archive whose `manifest.type` is
`"instrument"`. The host creates one or more **voice engines** from
your plugin: each voice engine represents a polyphonic playback
slot, with `noteOn` / `noteOff` / `update` / `setPitch` / `setGain`
entry points.

There are four ways to build an instrument, from simplest to most
powerful:

1. **Sample-based** — drop audio files in `samples/`, declare
   `sample zones`, let the host's built-in sample engine handle
   playback. Zero DSP code.
2. **Oscillator-based** — declare a mix of built-in oscillator
   waveforms. Still zero DSP code.
3. **AudioWorklet** — write a custom processor in `script.js` for
   arbitrary DSP. v1/v2 contract, ~100 lines of boilerplate.
4. **v3 graph** — declarative per-voice DSP graph with modulation
   routing. Most flexible declarative option; no worklet needed for
   many plugins.

This doc covers options 1–2 (the built-in engine) plus the shared
fields that apply to all instrument types. For option 3 see
[`06-instrument-graphs.md`](06-instrument-graphs.md); for option 4
see [`07-audioworklets.md`](07-audioworklets.md) and
[`08-worklet-v3.md`](08-worklet-v3.md).

## Minimal sample-based instrument

```json
{
  "schemaVersion": 2,
  "manifest": {
    "name": "KICK", "version": "1.0.0", "type": "instrument"
  },
  "parameters": [
    { "key": "decay", "label": "DECAY", "min": 0.01, "max": 2, "default": 0.2, "step": 0.01 }
  ],
  "dsp": {
    "processorName": null,
    "voices": 4,
    "voiceStealing": "oldest",
    "oscillators": [],
    "samples": [
      {
        "file": "samples/kick.wav",
        "rootKey": 60,
        "keyRange":      { "lo": 0, "hi": 127 },
        "velocityRange": { "lo": 0, "hi": 127 },
        "loop": false,
        "loopStart": 0, "loopEnd": 0,
        "startOffset": 0, "duration": 0
      }
    ],
    "envelope": { "attack": 0.001, "decay": 0.2, "sustain": 1, "release": 0.05 },
    "filter": null
  },
  "ui": {
    "layout": "flex",
    "controls": [{ "type": "knob", "parameter": "decay", "label": "DECAY" }]
  }
}
```

That's a complete drum sampler. Drop a `samples/kick.wav` next to
`plugin.json`, pack with `ntpack`, load, play.

See [`../templates/instrument-sampler/`](../templates/instrument-sampler/)
for a copy-to-start version including a 440 Hz placeholder sample.

## `PluginInstrumentDsp` fields

| Field | v | Type | Purpose |
|---|---|---|---|
| `processorName` | 1 | `string \| null` | AudioWorklet processor name, or `null` for built-in engine |
| `voices` | 1 | integer | Polyphony limit (1–32 typical) |
| `voiceStealing` | 1 | `"oldest" \| "quietest" \| "none"` | What to do when `voices` is exceeded |
| `oscillators` | 1 | `PluginOscillatorDef[]` | Built-in oscillator mix |
| `samples` | 1 | `PluginSampleZone[]` | Sample zones |
| `envelope` | 1 | `PluginEnvelope` | Amp ADSR applied to every voice |
| `filter` | 1 | `PluginFilterDef \| null` | Per-voice biquad filter |
| `envelopes` | 2 | `PluginEnvelopeDef[]` | Additional named multi-stage envelopes |
| `lfos` | 2 | `PluginLfoDef[]` | Per-voice LFOs for modulation |
| `modRoutes` | 2 | `PluginModRoute[]` | Modulation routing |
| `filters` | 2 | `PluginFilterDef[]` | Additional filter stages (serial) |
| `unison` | 2 | `PluginUnisonDef` | Unison voice spreading |
| `portamento` | 2 | `PluginPortamentoDef` | Pitch glide between notes |
| `noiseType` | 2 | `"white"\|"pink"\|"brown"` | Built-in noise generator |
| `graph` | 3 | `PluginGraph` | v3 declarative per-voice DSP graph |
| `sharedNodes` | 3 | `string[]` | Node IDs to instantiate once per plugin |
| `voiceInput` | 3 | `string` | Reserved input stub id (default `"voiceIn"`) |
| `voiceOutput` | 3 | `string` | Reserved output stub id (default `"voiceOut"`) |
| `requires` | 3 | `string[]` | Instrument-specific capability gates |
| `releaseTail` | 3 | number | Max release tail seconds (default 8) |
| `worklet` | 3 | `PluginWorkletInstrumentDef` | v3 whole-instrument worklet |

## Voices and stealing

`voices` sets the polyphony limit. The host allocates voices lazily —
one voice engine per tracker channel that's actively playing your
plugin. Within a single voice engine, `voices` caps how many notes
can be in flight simultaneously.

`voiceStealing` decides what to do when a new `noteOn` arrives and
every slot is occupied:

- **`"oldest"`** (default) — kill the longest-running voice. Standard
  behaviour, matches most MIDI synths.
- **`"quietest"`** — kill the voice with the lowest current envelope
  level. Sounds smoother but costs more CPU (the host scans every
  voice on every steal).
- **`"none"`** — drop the new note. Use for very specific cases like
  "this is a solo lead, never steal."

For sample playback, `voices: 4` is usually plenty (drum hits overlap
briefly, polyphony doesn't need to be huge). For pad synths, `voices: 8`
or 16. Above 32 is almost always a mistake — the audio graph becomes
hard to reason about and the CPU cost balloons.

## Sample zones

Each entry in `samples[]` is a `PluginSampleZone`:

| Field | Purpose |
|---|---|
| `file` | archive-relative path to the audio file |
| `rootKey` | MIDI note at which the sample plays at original pitch (60 = C4) |
| `keyRange.lo / .hi` | MIDI note range this zone is selected for |
| `velocityRange.lo / .hi` | velocity (0–127) range |
| `loop` | enable looping |
| `loopStart` | loop start time in seconds |
| `loopEnd` | loop end time (0 = end of sample) |
| `startOffset` | offset into the sample before playback starts (seconds) |
| `duration` | max playback duration (0 = play to end) |

**Multi-zone sampling** works by giving each zone a non-overlapping
key range. The host picks the first zone whose `keyRange` and
`velocityRange` contain the incoming note — order matters if ranges
overlap.

**Pitch math.** When the incoming note differs from `rootKey`, the
host plays the sample back at a pitch-shifted rate using the standard
MOD-style ratio math. Semitone accuracy is good for a few octaves;
extreme shifts sound grainy (as you'd expect). For chromatic coverage
of an instrument with wide range, ship multiple zones spaced every
few semitones — "multisampling."

**Velocity layers.** If you have a soft and loud recording of the
same drum, give each one a different `velocityRange` (e.g., 0–63 for
soft, 64–127 for loud). The host picks the right one based on the
tracker row's volume column.

**Looping.** Set `loop: true` and specify `loopStart` / `loopEnd` in
seconds into the sample. Use `0` for `loopEnd` to loop to the end
of the buffer. For seamless loops, make sure your sample file has a
zero-crossing at both loop points or you'll hear clicks.

**Sample formats.** Anything the browser's `decodeAudioData` accepts:
WAV, FLAC, OGG Vorbis, MP3, AAC. Sample rate is converted automatically
to match the `AudioContext`'s rate. 16-bit PCM WAV is the safest
choice for cross-platform consistency.

## Oscillators

`oscillators[]` is a list of built-in oscillator generators that mix
together into the voice's output:

```json
"oscillators": [
  { "type": "sawtooth", "detune": 0,    "mix": 0.5 },
  { "type": "sawtooth", "detune": 7,    "mix": 0.3 },
  { "type": "square",   "detune": -12,  "mix": 0.2 }
]
```

| Field | Purpose |
|---|---|
| `type` | `"sine"\|"square"\|"sawtooth"\|"triangle"\|"noise"` |
| `detune` | cents offset from the note frequency |
| `mix` | 0–1 amplitude in the final mix |
| `fmTarget` | v2: oscillator ID to frequency-modulate (not widely used in the built-in engine) |
| `fmDepth` | v2: FM modulation index in Hz |

For the `"noise"` type, `detune` is ignored; the actual noise colour
comes from the top-level `noiseType` field.

**Oscillators and samples can coexist** — if both arrays are non-empty,
the host mixes the oscillator sum with the sample playback. Use for
"layered" instruments where a sample gives the attack character and
an oscillator provides a sustained body.

**For real synth patches** you almost certainly want to move past the
built-in oscillators and either (a) write an AudioWorklet processor
or (b) use the v3 instrument graph with worklet nodes. The built-in
oscillator path is useful for quick prototyping and for instruments
that genuinely are "sample plus one sine tone."

## Envelope

```json
"envelope": {
  "attack":  0.005,
  "decay":   0.2,
  "sustain": 0.8,
  "release": 0.3
}
```

Standard ADSR in seconds. Applied as a gain envelope to every voice:

- **Attack**: `0 → 1` over this many seconds on `noteOn`
- **Decay**: `1 → sustain` over this many seconds
- **Sustain**: hold at this level until `noteOff`
- **Release**: `sustain → 0` over this many seconds on `noteOff`

For one-shot samples (drums), use a tiny attack and zero sustain:
`{ "attack": 0.001, "decay": 0.001, "sustain": 1, "release": 0.02 }`
— the sample plays back at full volume until its natural end, then
fades out briefly on release.

For sustained instruments (pads, leads), use a slower attack and a
meaningful sustain level.

v2 plugins can declare additional named envelopes in `envelopes[]`
and route them to any parameter via modulation — see
[`06-instrument-graphs.md`](06-instrument-graphs.md).

## Filter

```json
"filter": {
  "type":      "lowpass",
  "frequency": 8000,
  "Q":         0.707
}
```

Per-voice biquad filter applied after the oscillators/samples and
before the envelope gain. `type` accepts every Web Audio
`BiquadFilterType` value:

- `"lowpass"` / `"highpass"` / `"bandpass"`
- `"lowshelf"` / `"highshelf"` / `"peaking"`
- `"notch"` / `"allpass"`

For a filter-free instrument, set `filter: null`.

For multi-stage filters (e.g., a 24 dB/octave ladder built from two
biquads), use v2's `filters[]` array:

```json
"filters": [
  { "type": "lowpass", "frequency": 4000, "Q": 1.2 },
  { "type": "lowpass", "frequency": 4000, "Q": 1.2 }
]
```

Each entry cascades in series after the previous one. The `filter`
field and `filters` array can coexist but using both is confusing —
pick one.

## LFOs (v2)

```json
"lfos": [
  { "id": "filterLfo", "shape": "triangle", "rate": 2.5, "depth": 1 }
]
```

Per-voice LFO generators. Every voice gets its own LFO instance (so
two simultaneous notes have independent, un-synced LFOs).

| Field | Purpose |
|---|---|
| `id` | unique id used as a modulation source in `modRoutes` |
| `shape` | `"sine"\|"triangle"\|"square"\|"sawtooth"\|"sample-and-hold"` |
| `rate` | frequency in Hz (used when `sync` is false/absent) |
| `depth` | output amplitude (0–1 typical) |
| `sync` | *(v3.5)* set `true` to slave the LFO rate to host BPM |
| `syncRate` | *(v3.5)* when `sync` is true, the musical division: `"1/1"`, `"1/2"`, `"1/2."` (dotted), `"1/2T"` (triplet), `"1/4"`, `"1/8"`, `"1/16"`, `"1/32"`, or a whole-number of bars like `"2"` or `"4"`. Default `"1/4"`. |

LFOs on their own do nothing — you route them to a parameter via
`modRoutes[]`:

```json
"modRoutes": [
  { "source": "filterLfo", "target": "cutoff", "depth": 2000 }
]
```

The LFO's output (amplitude `depth`) multiplied by the route `depth`
modulates the target parameter around its current value. Above is
"sweep the cutoff ±2000 Hz at 2.5 Hz." See
[`06-instrument-graphs.md`](06-instrument-graphs.md) for the full
modulation routing reference.

## Unison and portamento (v2)

```json
"unison":     { "count": 7, "detune": 12, "stereoSpread": 0.8 },
"portamento": { "time": 0.12, "mode": "legato" }
```

**Unison** spreads each voice into `count` sub-voices, detuned by up
to `detune` cents and panned across stereo by `stereoSpread`. Seven
voices with 12 cent spread is a classic supersaw.

**Portamento** glides pitch between notes. `mode: "always"` glides on
every note change; `mode: "legato"` glides only when a new note lands
before the previous one's release.

Both features apply to the built-in engine. v3 graph instruments
implement their own unison/portamento in the graph or the worklet.

## Noise

```json
"noiseType": "pink"
```

Sets the waveform for the built-in noise oscillator type. White, pink,
and brown are supported. The loader generates a 2-second noise buffer
of the appropriate colour at plugin load time and loops it as a
sample source.

To use: add `{ "type": "noise", "mix": 1.0 }` to your `oscillators[]`
and set `noiseType` at the top level.

## What to use, when

| Situation | Use |
|---|---|
| Drum machine, instrument sampler, anything played from recorded audio | sample zones, built-in engine |
| Simple analogue-style synth (saw/square/sine mix, one filter, ADSR) | built-in oscillators, built-in engine |
| FM synth, physical modelling, granular, anything unusual | AudioWorklet in `script.js`, see [`07-audioworklets.md`](07-audioworklets.md) |
| Modular synth with explicit routing, multiple envelopes/LFOs, mod matrix | v3 graph, see [`06-instrument-graphs.md`](06-instrument-graphs.md) |
| Hybrid — sample body + synth layer | built-in engine handles both |
| Non-audio thing (game, visualizer, retro console) | webview control, see [`09-webview.md`](09-webview.md) |

## See also

- [`02-parameters.md`](02-parameters.md) — parameter declarations
- [`03-ui-controls.md`](03-ui-controls.md) — UI for instrument knobs
- [`05-fx-graphs.md`](05-fx-graphs.md) — same DSP node types in FX
- [`06-instrument-graphs.md`](06-instrument-graphs.md) — v3 per-voice graphs
- [`07-audioworklets.md`](07-audioworklets.md) — custom processors
- [`reference/schema.md`](reference/schema.md) — `PluginInstrumentDsp`
  field reference
- [`../templates/instrument-sampler/`](../templates/instrument-sampler/)
  — copy-to-start sample-based template
- [`../templates/instrument-worklet/`](../templates/instrument-worklet/)
  — copy-to-start AudioWorklet template
