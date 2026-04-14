# Unified typed ports (`ports`, v4+)

> **You need this page if:** your plugin needs more than one input,
> more than one output, a sidechain input, a CV input/output, a gate
> trigger, or you just want to give your jacks friendly labels. Added
> in plugin schema v4.

Before v4, instruments exposed `inputs[]` and `outputs[]` as anonymous
position-indexed `AudioNode` arrays on their voice engine, and pedals
didn't have workspace jacks at all. v4 unifies both: every plugin,
instrument or pedal, declares a typed `ports` block at the top level
of `plugin.json`. The host reads it, renders labelled jacks on the
window edges, and handles the Web Audio plumbing according to each
port's declared `kind`.

---

## Minimum viable port block

```json
{
  "schemaVersion": 4,
  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
  }
}
```

Two jacks, one on each side, standard mono/stereo audio. This is the
default shape the host supplies when an **instrument** plugin omits
`ports` entirely, so most existing instrument plugins need no changes.
Pedals must declare the block explicitly.

---

## Port fields

```ts
{
  id:      string,
  label:   string,
  kind:    "audio" | "sidechain" | "cv" | "gate",
  target?: string,   // when kind == "cv": "<nodeId>.<paramName>"
  index?:  number,   // worklet input/output index override
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique within `inputs[]` / `outputs[]`. Stable across versions — project files reference cables by `{workspaceId, jackIndex}` and `jackIndex` resolves against `id` order. Renaming an `id` is a breaking change for existing projects. |
| `label` | yes | Display text on the jack. ALL-CAPS convention, 1–4 characters. Users see this in the UI. |
| `kind` | yes | See kind reference below. |
| `target` | only for `cv` | `"<nodeId>.<paramName>"` — the AudioParam the incoming CV is routed to. |
| `index` | no | When a single `AudioWorkletNode` exposes multiple input / output ports (`numberOfInputs > 1`), use this to pin a manifest port to a specific worklet index. Defaults to the port's position in the array. |

---

## Port kinds

### `audio`

Standard Web Audio signal. Cables wire with
`srcNode.connect(dstNode, outIdx, inIdx)`.

**Visual:** solid jack ring, theme `primary` colour. Cable body: solid
line.

**Use for:** every normal audio path — sample in, synth out, effect
dry/wet, everything.

### `sidechain`

Electrically identical to `audio` — same Web Audio connection, same
signal semantics. The distinction exists so users (and UI tooling)
understand routing *intent* at a glance: this is the compressor's
detector input, not its main signal.

**Visual:** dashed jack ring, sidechain accent colour. Cable body:
dashed line.

**Use for:** compressor keys, ducker triggers, vocoder formant inputs,
frequency-shifter carrier inputs, "modulate X with Y"-style inputs
where Y shouldn't also be audible on the output.

**Compatibility:** `audio ↔ sidechain` is allowed. Most users will
wire regular audio cables into sidechain jacks and that's fine.

### `cv`

Audio-rate control voltage destined for an `AudioParam` on one of your
graph nodes. The incoming signal is routed via `srcNode.connect(param)`
rather than `srcNode.connect(node)`.

**Visual:** solid ring, CV accent colour. Cable body: solid + CV tint.

**Required field (INPUT only):** `target: "<nodeId>.<paramName>"` —
resolves against your `dsp.graph.nodes[]` and that node's exposed
AudioParams. The host fails the plugin at load time if the target
doesn't resolve.

CV **OUTPUT** ports don't take `target` — the host instantiates a
`GainNode` for the `port:<id>` reference and any connection in
`dsp.connections` routes a graph signal into it. See the
[`v40-cv-lfo` example](../examples/v40-cv-lfo/plugin.json) for the
canonical shape: `{ "from": "lfo", "to": "port:cvOut" }` with a
`{ "id": "cvOut", "kind": "cv" }` entry under `ports.outputs`.

**Use for:** external LFO input into a filter cutoff, envelope-follower
input driving a gain, pitch CV for a pitch-tracker, anything that maps
"external signal → parameter". As an output, emit any modulation
source (LFO, envelope, sample-and-hold) for other plugins to consume.

**Scaling:** `audio → cv` connections work without transformation; the
receiving AudioParam clamps to its own `min`/`max`. If you need
per-voltage-to-per-parameter scaling, add a `gain` node in between and
expose the gain node's `gain` AudioParam via the CV port's `target`.

### `gate`

Boolean trigger. The cable graph watches the incoming signal for
threshold crossings at `0.5` and fires the destination plugin's
gate handler on rising and falling edges.

**Visual:** dotted jack ring, gate accent colour. Cable body: dotted
line.

**Use for:** "retrigger envelope on cable pulse", "reset phase on
trigger", drum-machine-style trigger buses, arpeggiator step-advance
inputs.

**v4.0 implementation status:**

- **Gate OUTPUT** ports work end-to-end in v4.0. Declarative graphs
  expose any audio source as `kind: "gate"` and the cable graph
  handles edge detection at the destination side.
- **Gate INPUT** ports require a worklet processor that registers a
  gate handler — declarative-graph plugins cannot consume gate
  inputs directly in v4.0. Workaround: declare the input as
  `kind: "audio"` and threshold inside your graph (e.g. with a
  waveshaper + envelope follower). Native gate-input handling for
  declarative graphs is reserved for v4.1.

---

## Compatibility matrix

Host validation on cable creation — mismatches are dropped silently
with a console warning:

| Source \ Dest | `audio` | `sidechain` | `cv` | `gate` |
|---|---|---|---|---|
| `audio` | ✓ | ✓ | ✓ | ✓ (edge watcher) |
| `sidechain` | ✓ | ✓ | ✓ | ✓ |
| `cv` | ✗ | ✗ | ✓ | ✗ |
| `gate` | ✗ | ✗ | ✗ | ✓ |

Rules of thumb:
- Audio and sidechain are interchangeable — users may cable them
  freely.
- CV and gate only accept their own kind (or audio, which effectively
  becomes CV / gate once threshold or param-routed).
- Outputs on any plugin can be any kind; inputs enforce the matrix.

---

## Referencing ports from the graph

Inside `dsp.graph.connections[]`, use `port:<id>` to name a port:

```json
{ "from": "port:inL", "to": "mixer" }
{ "from": "mixer",    "to": "port:outL" }
```

Legacy shortcut names still work:
- `"instrumentIn"` / `"input"` — first audio input
- `"output"` — first audio output
- `"voiceIn"` / `"voiceOut"` — per-voice input/output (instrument
  graphs only; unaffected by port renaming)

---

## Visual reference

The host gives each port kind a distinct look so users can scan
routing at a glance. Both jack rings and the cable bodies follow the
same key:

| Kind | Jack ring | Cable body | Colour token |
|---|---|---|---|
| `audio` | solid ring | solid line | `--color-primary` (out) / `--workspace-input-jack` (in) |
| `sidechain` | dashed ring | dashed line `10 5` | same as audio |
| `cv` | solid ring, accent fill | solid line | `--color-primary-glow` |
| `gate` | dotted ring | dotted line `2 4` | `--color-text` |

The cable body's tap/reroute mode still drives its base colour
(`settings.colour` / `settings.rerouteColour`); the kind only adds
the dash pattern and the optional accent hue.

Plugin-supplied `ui.themeOverride` cascades to these colours via CSS
custom properties, so a pedal with a custom palette gets matching
jacks + cables.

---

## How the host renders jacks

- Input jacks: left window edge, stacked vertically in `inputs[]` order.
- Output jacks: right window edge, stacked vertically in `outputs[]`
  order.
- Each jack shows its `label` next to the ring.
- Ring style depends on `kind` (solid / dashed / dotted + accent hue).
- Drag-create: click a jack, drag to another jack. The host hit-tests
  against the compatibility matrix and rejects mismatches.

Window height grows if the port count exceeds the default window
dimensions. Users can resize freely — the `InstrumentWindow` chrome
handles clamping and preferred-size persistence.

---

## Authoring checklist

- [ ] `schemaVersion: 4`
- [ ] `"portsV4"` in `requires[]`
- [ ] `ports.inputs[]` and/or `ports.outputs[]` declared
- [ ] Every port has a unique `id`, a `label`, and a valid `kind`
- [ ] CV ports have `target: "<nodeId>.<paramName>"` and the target
      AudioParam exists in your graph
- [ ] Graph connections use `port:<id>` references (or legacy
      shortcuts for the first audio in/out)
- [ ] `ntvalidate` passes

---

## See also

- [`13-pedals.md`](13-pedals.md) — v4 pedal authoring (the primary
  consumer of multi-port)
- [`06-instrument-graphs.md`](06-instrument-graphs.md) — graph
  connection syntax
- [`reference/schema.md`](reference/schema.md#pluginportsdef-v4) —
  every field
- [`reference/host-capabilities.md`](reference/host-capabilities.md) —
  `portsV4`, `pedal-v4`, `webview-writes` flags
