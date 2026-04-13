---
name: scaffold-pedal
description: Scaffold a v4 nanoTracker pedal plugin from scratch. Pedals are FX plugins (manifest.type "fx") rendered in the workspace as floating windows with patch cables. Produces a complete working plugin.json with the right capability flags, port shape, and graph structure on the first try.
version: 1.0.0
metadata:
  hermes:
    tags: [nanotracker, plugin, audio, fx, pedal, json-manifest]
    category: audio-plugin-authoring
    requires_toolsets: [terminal, files]
---

# Scaffold a v4 nanoTracker pedal

## When to use

Use this when the user wants to author a new FX plugin for
nanoTracker — a delay, reverb, distortion, mixer pedal, sidechain
compressor, CV utility, anything that processes audio (or generates
control signals) and lives in the workspace as a floating window
with patch-cable jacks.

Do NOT use this for:

- Sample-based or synth instruments (use `scaffold-instrument`)
- Updating an existing v1–v3 FX plugin (use `migrate-v3-to-v4`)
- Pedals whose UI is a custom HTML surface (use
  `scaffold-webview-pedal` — it builds on this one)

## Procedure

### 1. Pick a folder and create the manifest

```
<your-plugin>/plugin.json
<your-plugin>/README.md            (recommended)
```

Convention is `examples/<name>/` inside the SDK repo for shipped
examples; user plugins can live wherever they like.

### 2. Start from the v4 pedal template

Copy `templates/fx-graph/plugin.json` and adapt it. The template
ships the exact v4 hard-rule shape:

- `schemaVersion: 4`
- `manifest.type: "fx"`
- `requires: ["pedal-v4", "portsV4", "graph"]`
- Non-empty `ports.inputs[]` AND `ports.outputs[]`
- Connections use `port:in` / `port:out` references

### 3. Choose ports

Single-IN / single-OUT (most pedals):

```jsonc
"ports": {
  "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
  "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
}
```

Stereo pair (L/R independent):

```jsonc
"ports": {
  "inputs":  [
    { "id": "inL", "label": "L", "kind": "audio" },
    { "id": "inR", "label": "R", "kind": "audio" }
  ],
  "outputs": [
    { "id": "outL", "label": "L", "kind": "audio" },
    { "id": "outR", "label": "R", "kind": "audio" }
  ]
}
```

Mixer (4-in / 2-out):

```jsonc
"ports": {
  "inputs": [
    { "id": "in1", "label": "1", "kind": "audio" },
    { "id": "in2", "label": "2", "kind": "audio" },
    { "id": "in3", "label": "3", "kind": "audio" },
    { "id": "in4", "label": "4", "kind": "audio" }
  ],
  "outputs": [
    { "id": "outL", "label": "L", "kind": "audio" },
    { "id": "outR", "label": "R", "kind": "audio" }
  ]
}
```

Compressor with sidechain (audio + sidechain in):

```jsonc
"ports": {
  "inputs": [
    { "id": "in", "label": "IN", "kind": "audio" },
    { "id": "sc", "label": "SC", "kind": "sidechain" }
  ],
  "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
}
```

CV out for modulating another plugin's parameter:

```jsonc
"outputs": [{ "id": "cv", "label": "CV", "kind": "cv" }]
```

(CV doesn't need a `target` on the output side; it's only required
on CV INPUT ports.)

### 4. Author the DSP graph

Use the declarative graph (`processorName: null` + `nodes[]` +
`connections[]`). Reference ports via `port:<id>`:

```jsonc
"dsp": {
  "processorName": null,
  "nodes": [
    { "id": "g", "type": "gain", "gain": 1 }
  ],
  "connections": [
    { "from": "port:in", "to": "g" },
    { "from": "g", "to": "port:out" }
  ]
}
```

Available node types are documented in
[`docs/reference/schema.md#fxnodetype`](../../docs/reference/schema.md#fxnodetype).
For complex DSP that the declarative palette can't express, drop in
a custom AudioWorklet (`processorName: "your-processor"` + a
sibling `script.js` that registers the processor) — see
[`docs/07-audioworklets.md`](../../docs/07-audioworklets.md).

### 5. Parameters

```jsonc
"parameters": [
  {
    "key": "g.gain",            // dot-paths reach AudioParams on graph nodes
    "label": "GAIN",
    "min": 0, "max": 2, "default": 1, "step": 0.01,
    "displayDecimals": 2
  }
]
```

The host wires `nodeId.paramName` keys to live AudioParams
automatically. Parameter changes from the title-bar knob, FxPattern
automation, or webview `paramWrite` all funnel through the same
path.

### 6. UI (optional but recommended)

Built-in controls if you want a knob grid:

```jsonc
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "knob", "parameter": "g.gain" }
  ]
}
```

Or skip `ui` entirely — the host auto-renders a knob per parameter.

For custom HTML/JS UIs, use `scaffold-webview-pedal` instead.

### 7. Theme override (optional)

```jsonc
"requires": ["pedal-v4", "portsV4", "graph", "themeOverride"],
"ui": {
  "themeOverride": {
    "primary": "#ff7a00",
    "bg":      "#140800"
  },
  "controls": [/* ... */]
}
```

Subset of the eleven theme keys; omitted ones cascade from the
host's active theme.

### 8. Validate + pack

```bash
node tools/ntvalidate.mjs <plugin-dir>
node tools/ntpack.mjs <plugin-dir> --out <plugin-name>.ntsfx
```

`ntvalidate` catches every loader rule before pack. `ntpack`
produces a `.ntsfx` archive ready to drop into the tracker.

## Pitfalls

- ❌ **Forgetting `pedal-v4` in `requires[]`** — loader rejects with
  a clear message but you can save a debug round-trip by including
  it from the start.
- ❌ **Empty `ports.inputs[]` or `ports.outputs[]`** — pedals MUST
  have at least one of each. Even a CV-source pedal needs at least
  one OUT (the CV jack).
- ❌ **Using `instrumentIn` / `output` shortcuts in a multi-port
  pedal** — they only resolve to the FIRST audio in/out. Use
  `port:<id>` everywhere when you have multiple ports.
- ❌ **CV input without `target`** — loader rejects. Format is
  `"<nodeId>.<paramName>"`, e.g. `"filter.frequency"`.
- ❌ **Hardcoding sample-rate values** — read `ctx.sampleRate` from
  the AudioContext if you need it.
- ❌ **Authoring a "fx" plugin in v3 shape (mixer module)** — v4
  retired this path. The host auto-migrates EXISTING v3 FX plugins
  but new authoring should be v4 from day one.

## Verification

1. `node tools/ntvalidate.mjs <plugin-dir>` exits 0
2. `node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx` succeeds
3. In the tracker host: PLUGIN MANAGER → `+ LOAD PLUGIN` → pick the
   `.ntsfx` → status bar shows
   `PLUGIN LOADED: <name> v<version> (FX)`
4. Click `+ ADD TO WS` next to the loaded plugin → a floating pedal
   window appears with your declared jacks on its edges
5. Drag a cable from `TRACKER BUS.CH01` (or a workspace synth's OUT)
   to your pedal's IN; from your pedal's OUT to `MASTER IN.MAIN`
6. Play a pattern, confirm audio flows through and parameters
   respond

## Reference

- [`../../CLAUDE.md`](../../CLAUDE.md) — top-level orientation
- [`../../docs/13-pedals.md`](../../docs/13-pedals.md) — pedal
  authoring guide (the long form of this skill)
- [`../../docs/14-ports.md`](../../docs/14-ports.md) — typed port
  model with compatibility matrix
- [`../../docs/reference/schema.md`](../../docs/reference/schema.md)
  — every manifest field
- [`../../examples/v40-mixer-pedal/`](../../examples/v40-mixer-pedal/)
  — multi-port + webview reference
- [`../../examples/v40-compressor-sc/`](../../examples/v40-compressor-sc/)
  — sidechain reference
- [`../../examples/v40-cv-lfo/`](../../examples/v40-cv-lfo/)
  — CV output reference
- [`../../templates/fx-graph/`](../../templates/fx-graph/)
  — copy-and-adapt v4 starter
