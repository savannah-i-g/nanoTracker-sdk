---
name: scaffold-instrument
description: Scaffold a new nanoTracker instrument plugin. Instruments play notes (noteOn / noteOff dispatch from tracker patterns or workspace MIDI). Three flavours — sample-based, oscillator-based, or v3 declarative graph — pick whichever matches the sound design.
version: 1.0.0
metadata:
  hermes:
    tags: [nanotracker, plugin, audio, instrument, synth, sampler, json-manifest]
    category: audio-plugin-authoring
    requires_toolsets: [terminal, files]
---

# Scaffold a nanoTracker instrument plugin

## When to use

Use this when the user wants to author a plugin that **plays notes**:
a sampler, a synth, a wavetable instrument, a FM patch, anything
that responds to `noteOn` / `noteOff`.

Do NOT use this for FX plugins (use `scaffold-pedal` — pedals don't
play notes).

## Procedure

### 1. Pick the engine flavour

| Flavour | When | `dsp` shape |
|---|---|---|
| **Sampler** | You have WAV samples mapped to key/velocity zones | `samples[]`, `envelope`, `filter` |
| **Oscillator** | Subtractive / FM synth from waveforms | `oscillators[]`, `envelope`, `filter` |
| **v3 graph** | Custom modular DSP: filter envelopes, LFOs, multi-stage envelopes, modulation routing, granular, wavetable | `dsp.graph` + `requires: ["graph"]` |
| **v3 worklet** | Native AudioWorklet processor for your DSP core | `dsp.worklet` + `requires: ["worklet-v3"]` |

Default to v3 graph for new synth designs — it's the most flexible
and the host's auto-rendering UI handles its parameters cleanly.

### 2. Start from a template

```bash
cp -r templates/instrument-sampler my-sampler         # WAV-driven
cp -r templates/instrument-worklet my-worklet         # AudioWorklet-driven
```

For v3 graph instruments, look at any of the example v3 plugins
(`examples/v35-showcase/`) — they show the pattern.

### 3. Manifest essentials

```jsonc
{
  "schemaVersion": 4,
  "manifest": {
    "name": "MY SYNTH",
    "version": "1.0.0",
    "type": "instrument",
    "description": "..."
  },
  "requires": ["graph"],          // adjust per the engine flavour
  "parameters": [/* PluginParamDef[] */],
  "dsp": {
    "voices": 8,
    "voiceStealing": "oldest",
    /* + the engine-specific fields */
  }
}
```

### 4. Workspace input jack (optional)

Instruments can OPTIONALLY accept audio input via the workspace
patchbay — useful for "vocoder" or "ring modulator" instruments
where the carrier is driven by external audio. Declare a v4 port:

```jsonc
"requires": ["graph", "portsV4"],
"ports": {
  "inputs":  [{ "id": "ext", "label": "EXT", "kind": "audio" }],
  "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
},
"dsp": {
  /* ... */
  "graph": {
    "nodes":       [/* ... */],
    "connections": [
      { "from": "port:ext", "to": "<your-mod-node>" },
      /* ... */
      { "from": "<your-out-node>", "to": "port:out" }
    ]
  }
}
```

If you skip the `ports` block entirely the host gives you a default
single audio OUT (the long-standing instrument behaviour) — no
workspace input jack.

### 5. Sample zones (sampler flavour)

```jsonc
"dsp": {
  "samples": [
    {
      "file": "samples/c4.wav",
      "rootKey": 60,
      "keyRange": { "lo": 0, "hi": 127 },
      "velocityRange": { "lo": 0, "hi": 127 },
      "loop": false, "loopStart": 0, "loopEnd": 0,
      "startOffset": 0, "duration": 0
    }
  ],
  "envelope": { "attack": 0.005, "decay": 0.1, "sustain": 0.8, "release": 0.3 },
  "filter": null
}
```

WAVs go in a sibling `samples/` folder. The packer bundles them
into the archive automatically.

### 6. Loop generator presets (sampler-only, optional)

For drum-machine-style "preset patterns":

```jsonc
"loopPresets": [
  {
    "name": "BASIC BEAT",
    "steps": [
      { "padIndex": 1 },
      null,
      { "padIndex": 2 },
      null
    ]
  }
]
```

### 7. UI

Skip the `ui` block for a host-auto-rendered knob grid (one knob
per parameter), or author one explicitly:

```jsonc
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "knob",   "parameter": "cutoff" },
    { "type": "slider", "parameter": "resonance" },
    { "type": "envelope_editor", "parameter": "amp.attack" }
  ]
}
```

### 8. Validate + pack

```bash
node tools/ntvalidate.mjs <plugin-dir>
node tools/ntpack.mjs <plugin-dir> --out <name>.ntins
```

Note the `.ntins` extension (vs `.ntsfx` for FX/pedals).

## Pitfalls

- ❌ **Forgetting `requires: ["graph"]` on a v3 graph instrument** —
  loader rejects.
- ❌ **`voices: 0`** — minimum is 1. Polyphony is `voices`.
- ❌ **Sample paths missing the `samples/` prefix** — they're
  archive-relative, must match what `ntpack` includes.
- ❌ **Worklet processor name colliding with built-ins** —
  `nanotracker.granular` and `nanotracker.wavetable` are reserved
  for host-shipped processors.
- ❌ **Adding `pedal-v4` to an instrument** — capability is for FX
  plugins; instruments don't need it.

## Verification

1. `node tools/ntvalidate.mjs <plugin-dir>` exits 0
2. `node tools/ntpack.mjs <plugin-dir> --out <name>.ntins` succeeds
3. In the tracker host: PLUGIN MANAGER → `+ LOAD PLUGIN` → pick the
   `.ntins` → status bar shows
   `PLUGIN LOADED: <name> v<version> (INSTRUMENT)`
4. Open the MOD menu, click your plugin name in the module list,
   confirm the parameters / pad view loads (or for v3 graph
   instruments, click `+ ADD TO WS` from the Plugin Manager to spawn
   a workspace floating window)
5. Play notes from the pattern editor or workspace MIDI input,
   confirm sound

## Reference

- [`../../docs/04-instruments.md`](../../docs/04-instruments.md) —
  v1/v2 instrument engine
- [`../../docs/06-instrument-graphs.md`](../../docs/06-instrument-graphs.md)
  — v3 declarative graph
- [`../../docs/08-worklet-v3.md`](../../docs/08-worklet-v3.md) —
  v3 worklet contract
- [`../../docs/reference/schema.md`](../../docs/reference/schema.md)
  — every manifest field
- [`../../templates/instrument-sampler/`](../../templates/instrument-sampler/)
- [`../../templates/instrument-worklet/`](../../templates/instrument-worklet/)
- [`../../examples/v35-showcase/`](../../examples/v35-showcase/) —
  v3 graph instrument example
