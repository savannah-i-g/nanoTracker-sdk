# Sampler node

The `type: "sampler"` graph node is the canonical way to author a
plugin that uses samples as its sound source. One schema covers:

- **Multi-sample kits** — many WAVs mapped across key/velocity
  zones, with round-robin and choke behaviour.
- **Breakbeat choppers** — a single WAV divided into slices that
  fire on consecutive MIDI notes.
- **Single-sample pitched synths** — one WAV played across the
  keyboard with loop + pitch tracking.

A sampler node has a single stereo audio output. Voice-graph
connections route it like any other node. The runtime owns
per-voice `AudioBufferSourceNode` playback; the graph builder just
hands out the output GainNode.

```jsonc
{
  "schemaVersion": 4,
  "manifest": { "name": "KIT-8", "version": "1.0.0", "type": "instrument" },
  "requires": ["graph", "sampler-v41"],
  "parameters": [],
  "dsp": {
    "processorName": null,
    "voices": 16, "voiceStealing": "oldest",
    "oscillators": [], "samples": [],
    "envelope": { "attack": 0.001, "decay": 0.1, "sustain": 0.8, "release": 0.3 },
    "filter": null,
    "graph": {
      "nodes": [
        { "id": "kit", "type": "sampler",
          "zones": [
            { "file": "samples/kick.wav",  "rootKey": 36,
              "keyRange": { "lo": 36, "hi": 36 },
              "velocityRange": { "lo": 1, "hi": 127 },
              "loop": "none", "loopStart": 0, "loopEnd": 0,
              "startOffset": 0, "duration": 0,
              "pitchTracking": false },
            { "file": "samples/snare.wav", "rootKey": 38,
              "keyRange": { "lo": 38, "hi": 38 },
              "velocityRange": { "lo": 1, "hi": 127 },
              "loop": "none", "loopStart": 0, "loopEnd": 0,
              "startOffset": 0, "duration": 0,
              "pitchTracking": false }
          ]
        }
      ],
      "connections": [ { "from": "kit", "to": "voiceOut" } ]
    }
  },
  "ui": { "layout": "flex", "controls": [] }
}
```

## Zones

Sampler zones share their shape with instrument-level
`dsp.samples[]` and support the following fields:

- **`pitchTracking: false`** — fixed playback rate regardless of
  note. Every drum zone should set this; pitched instrument zones
  leave it out (default true).
- **`loop: "pingpong"`** — alternates forward/reverse across the
  loop region. The runtime builds the reversed buffer once per
  (source, bounds) pair and caches it per engine.
- **`loop: "release"`** — the zone is a one-shot that fires on
  `noteOff` instead of `noteOn`. Use for piano / Rhodes release
  samples that ring the hammer settling on the string.
- **`loopCrossfade`** — equal-power fade across the loop seam,
  seconds. Set to ~2–10 ms to hide clicks on sustained loops. The
  host pre-bakes the cos/sin blend into a cached buffer so native
  Web Audio looping produces a smooth seam with no runtime scheduling.
- **`roundRobinGroup`** — zones sharing a group name rotate on
  successive triggers. Puts three recorded snare hits on the same
  pad so they don't feel mechanical.
- **`choke`** — zones sharing a group cut each other off on the
  next trigger (open/closed hi-hat, snare roll into snare stop).
  Cross-voice: the runtime stops the previous group member's
  `BufferSource` with a short release fade when a new one fires.
- **`trigger`** — `"attack"` (default) or `"release"`. Release-
  triggered zones live past the voice's release tail; they own
  their own lifetime until the sample ends naturally.

See [`reference/schema.md#pluginsamplezone`](reference/schema.md#pluginsamplezone)
for the full field list.

## Slice maps

For MPC-style choppers, use `sliceMap` instead of (or alongside)
`zones[]`:

```jsonc
{
  "id": "chop", "type": "sampler",
  "sliceMap": {
    "source": "samples/amen.wav",
    "autoDetect": "grid:16"
  }
}
```

With no explicit `slices[]`, `autoDetect: "grid:16"` divides the
source evenly and assigns consecutive slices to MIDI notes
`36..51`. Author explicit slices with per-slice notes when you
want deliberate mapping:

```jsonc
"sliceMap": {
  "source": "samples/amen.wav",
  "slices": [
    { "start": 0.000, "end": 0.180, "note": 36, "choke": "kick" },
    { "start": 0.180, "end": 0.360, "note": 37, "choke": "snare" },
    { "start": 0.360, "end": 0.520, "note": 38, "choke": "hat" }
  ],
  "triggerMode": "oneShot"
}
```

`triggerMode: "gated"` loops the slice region at audio rate while
the key is held; the default one-shot plays each slice to its end.
Declaring a `sliceMap` requires the `sliceMap-v41` capability in
addition to `sampler-v41`.

Auto-detect modes:

- `"grid:N"` — uniform division into N slices.
- `"markers"` — read the source WAV's `cue ` chunk. Honoured even
  when the source isn't attached to a zone (the loader surfaces a
  path-keyed metadata map on `LoadedPlugin` that the sampler runtime
  consults).
- `"transients"` — spectral-energy-flux onset detection with
  moving-median normalisation and a 40 ms minimum inter-onset gap.

## WAV metadata

The loader parses SMPL / ACID / cue chunks at decode time and fills
in each zone's `meta` block:

```jsonc
{
  "file": "samples/amen-174.wav",
  // loaded as { originalTempo: 174, originalKey: 60, cuePoints: [...] }
  // authors can override any field in plugin.json
}
```

Exposing `meta` to the plugin (reading `originalTempo` from a custom
worklet, say) requires the `sampleMeta-v41` capability. Manifest-
level overrides win when both auto-extracted and author-supplied
values exist for the same field.

## Combining zones and slices

A sampler node can carry **both** `zones[]` and `sliceMap` at once.
The runtime triggers them independently on each noteOn:

- The zone matcher picks one zone by key/velocity and spawns its
  `BufferSource`.
- The slice matcher picks one slice by note and spawns its own
  `BufferSource`.

This lets a drum-kit plugin fit full zones (kick, snare, hat) on
one set of keys AND a chopped break on another key range — one
node, one graph connection, no per-plugin hand-rolled routing.

## Capability matrix

| Feature | Required flag |
|---|---|
| `type: "sampler"` node | `sampler-v41` |
| `loop: "pingpong"` / `"release"` | `sampler-v41` |
| `loopCrossfade`, `roundRobinGroup`, `choke`, `trigger: "release"`, `pitchTracking: false` | `sampler-v41` |
| `sliceMap` block | `sliceMap-v41` |
| Reading `meta` manually in plugin.json | `sampleMeta-v41` |

`ntvalidate` enforces every rule above — run it before packing.

## Worklet-based samplers

Authors who want per-sample DSP beyond what the declarative node
offers (time-stretching, formant-correct pitching, custom grain
engines) can still drop to `type: "worklet"` and receive samples
through the v3 `loadAsset` port message. The declarative sampler
primitive is the default; worklets are for the unusual case.

## Related docs

- [`17-user-samples.md`](../17-user-samples.md) — user-assignable
  sample slots (`userAssignable` zones, `sampleBank` block, webview
  picker bridge)
- [`18-preset-bank.md`](../18-preset-bank.md) — factory presets with
  `sampleAssignments`, user preset persistence, `.ntpreset` sharing
