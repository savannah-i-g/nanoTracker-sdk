# Pedals (`type: "fx"`, v4+)

> **You need this page if:** you're writing an FX plugin for
> nanoTracker v4.0 or later. Pedals replaced the old mixer-module FX
> shape. v1–v3 FX plugins still load via auto-migration but all **new**
> FX authoring uses the patterns on this page.

A **pedal** is an FX plugin rendered as a floating `TrackerWindow` in
the instrument workspace. It has labelled jacks on its window edges;
users drag patch cables between them. Pedals can have many inputs and
many outputs — mixer pedals, splitter pedals, multi-band effects,
cross-patched modular utilities all work out of the box.

## The workspace topology

Every nanoTracker project has two host-supplied pseudo-instruments
pinned to the workspace from boot:

```
   TRACKER BUS                   your pedal               MASTER IN
   ┌──────────────┐              ┌─────────────┐          ┌────────┐
   │  CH01  OUT ●─┼──── cable ──→│● IN  OUT ●──┼─ cable ─→│● MAIN  │
   │  CH02  OUT ●─┼──── cable ──→│● IN         │          │        │
   │  CH03  OUT ●─┤              └─────────────┘          └────────┘
   │  ...         │                                            │
   └──────────────┘                                            ▼
                                                          (master bus →
                                                           speakers)
```

- **TRACKER BUS** exposes one stereo OUT jack per tracker channel,
  carrying the live sample-playback signal. Cables from these OUTs
  are how a pedal receives audio from the tracker.
- **MASTER IN** is a single stereo IN jack that feeds the master
  bus (and the master extension chain — DC blocker, retro filter,
  bitcrush, stereo width, compressor). Cables to here are how a
  pedal's processed audio reaches the speakers.
- **Your pedal** sits in the middle. The user wires cables to fit
  their patch.

Both pseudo-windows are pinned: users can minimise them but not close
them. You don't author them — they're host-supplied for every project.

A pedal also has a default master route (its primary audio output
flows through an instrument bus → master) that runs in parallel with
any cable taps. Users can suppress the default route per-cable via
the cable's tap/reroute toggle if they want a "wet only" patch.

---

## The shortest possible pedal

`plugin.json`:

```json
{
  "schemaVersion": 4,
  "manifest": {
    "name": "SIMPLE GAIN",
    "version": "1.0.0",
    "type": "fx",
    "description": "Single-knob gain pedal"
  },
  "requires": ["pedal-v4", "portsV4", "graph"],
  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
  },
  "parameters": [
    { "key": "gain", "label": "GAIN", "min": 0, "max": 2, "default": 1, "step": 0.01 }
  ],
  "dsp": {
    "processorName": null,
    "graph": {
      "nodes": [
        { "id": "g", "type": "gain", "gain": 1 }
      ],
      "connections": [
        { "from": "instrumentIn", "to": "g" },
        { "from": "g",            "to": "output" }
      ],
      "modRoutes": []
    },
    "sharedNodes": ["g"]
  }
}
```

That's it: one IN jack, one OUT jack, one knob. Drop the pedal in the
workspace, wire `TrackerBus.CH01 → pedal.in`, wire `pedal.out →
MasterIn`, and the pedal applies gain to whatever tracker channel 1 is
playing.

---

## Required capabilities

Every v4 pedal **must** declare in `requires[]`:

- `"pedal-v4"` — you're a v4 pedal, not a legacy mixer module
- `"portsV4"` — you use the `ports` block

Plus any feature-specific flags:

- `"graph"` — declarative per-pedal graph (almost every pedal)
- `"worklet-v3"` — custom AudioWorklet processor
- `"webview-ui"` — webview control in your UI
- `"webview-writes"` — iframe writes back to host
- `"themeOverride"` — custom window colours
- `"modMatrix-v3"`, `"granular"`, `"wavetable"`, etc. as needed

The loader rejects pedals missing `pedal-v4` or `ports`.

---

## Port authoring

Pedals **must** declare at least one input and one output. Empty port
lists are rejected. Port count is effectively unbounded (tested up to
32/32); jacks stack vertically on the window edges.

```json
"ports": {
  "inputs":  [
    { "id": "inL", "label": "L",  "kind": "audio" },
    { "id": "inR", "label": "R",  "kind": "audio" },
    { "id": "sc",  "label": "SC", "kind": "sidechain" }
  ],
  "outputs": [
    { "id": "outL", "label": "L", "kind": "audio" },
    { "id": "outR", "label": "R", "kind": "audio" }
  ]
}
```

### Referencing ports from the graph

`instrumentIn` in the graph resolves to the **first audio input**.
When you have multiple inputs, reference them explicitly by port id:

```json
{
  "nodes": [
    { "id": "mixer", "type": "mixer" },
    { "id": "gainL", "type": "gain" },
    { "id": "gainR", "type": "gain" }
  ],
  "connections": [
    { "from": "port:inL", "to": "gainL" },
    { "from": "port:inR", "to": "gainR" },
    { "from": "gainL",    "to": "mixer" },
    { "from": "gainR",    "to": "mixer" },
    { "from": "mixer",    "to": "port:outL" },
    { "from": "mixer",    "to": "port:outR" }
  ]
}
```

`port:<id>` is the v4 reference form. The legacy `"output"` /
`"instrumentIn"` strings still work and map to the first audio out /
audio in respectively.

### CV ports

A CV input names its target AudioParam:

```json
{ "id": "cvCutoff", "label": "CV", "kind": "cv", "target": "filter.frequency" }
```

The host wires cables into that port via `srcNode.connect(targetParam)`
— no graph plumbing needed on your side.

### Sidechain ports

A sidechain port is an audio input that *won't appear on the output*.
Route it into your compressor's detector / ducker trigger / vocoder
analyser / etc.:

```json
{
  "nodes": [
    { "id": "comp", "type": "compressor", "threshold": -20, "ratio": 4, "attack": 0.003, "release": 0.25 },
    { "id": "detectorGain", "type": "gain" }
  ],
  "connections": [
    { "from": "port:in",  "to": "comp" },
    { "from": "port:sc",  "to": "detectorGain" },
    { "from": "detectorGain", "to": "comp", "toParam": "threshold" },
    { "from": "comp",         "to": "port:out" }
  ]
}
```

### Gate ports

Gate ports trigger something on rising edge. The cable graph watches
the source for crossing `0.5` and fires the destination's gate
handler.

```json
{ "id": "trig", "label": "TRIG", "kind": "gate" }
```

**v4.0 implementation note:** gate OUTPUT ports work directly from
any audio source in your graph — no extra wiring. Gate INPUT ports
need a worklet processor that registers a handler with the host;
declarative-graph plugins should declare such inputs as
`kind: "audio"` for v4.0 and threshold the signal inside their graph.
See [`14-ports.md`](14-ports.md#gate) for the full status note.

---

## Host-injected chrome

Every pedal gets three things from the host without any authoring:

### Pedal output volume knob

The host injects a `GainNode` per `"audio"` output and exposes a
single **VOL** knob in the title bar that drives every audio-output
gain in lockstep. You don't declare a "level" parameter — the host
handles it, persists it through save/load, and applies the same value
to every audio OUT jack so cable taps follow the user's setting.

For pedals specifically, the title-bar VOL is conceptually the
"pedal output level" and attenuates **both** the default master route
**and** any cables tapped from the pedal's audio outputs. (Workspace
instruments follow the modular convention instead — their VOL only
attenuates the default master route, leaving cable taps independent.)

### Bypass toggle (`BYP`)

A toggle in the title bar short-circuits the pedal's first audio IN
to its first audio OUT and silences the DSP. Implemented as two
host-injected gain nodes:

- `bypassMute` — sits between the plugin's raw output and the host
  output gain. Default `1.0`; set to `0.0` on bypass to silence DSP.
- `bypassDirect` — taps the first audio input straight into the host
  output gain. Default `0.0`; set to `1.0` on bypass to open the
  pass-through path.

Both transitions ramp via `setTargetAtTime(10ms)` so toggling doesn't
click. Bypass state persists through save/load via the workspace
instrument snapshot's `bypass` field.

You don't have to do anything to opt in — every pedal gets the
toggle. Pedals with no audio input port get a degenerate bypass
(DSP silenced, nothing replaces it) which is still a useful "kill
switch" for utility pedals.

### Drag / resize / minimise / theme override

Same `TrackerWindow` chrome as instruments. `ui.themeOverride` is
honoured; webview iframes receive `themeChange` events on mount and
on theme changes.

---

## Automation

FxPattern automation (the existing mixer automation lane) targets
pedals by `workspaceId` + `paramKey`. The mixer's automation editor
gains a **PEDAL** target mode (next to **MIXER**) that lists every
workspace pedal and its parameters; selecting one writes a cell with
`pedalTarget: { workspaceId, paramKey }`. You don't declare
anything — every pedal parameter shows up automatically. Row-level
writes apply via `setTargetAtTime(0.02s)` for smooth ramps.

Tracker effect-column dispatch also reaches pedals via
`"trackerEffects-v3"` (same as instruments). Webview pedals opting in
via `forwardEffects: true` receive raw effect bytes in the iframe.

Webview pedals can additionally drive their own parameters from
inside the iframe via the v4 `paramWrite` channel — useful for
custom UIs (faders, XY pads, step sequencers) that are easier to
build in HTML than as native UI controls.
See [`09-webview.md`](09-webview.md#bidirectional-bridge-v4).

---

## Multi-port examples

### Stereo widener / splitter

Mono IN, stereo OUT with a width knob:

```json
"ports": {
  "inputs":  [{ "id": "in",   "label": "IN", "kind": "audio" }],
  "outputs": [
    { "id": "outL", "label": "L", "kind": "audio" },
    { "id": "outR", "label": "R", "kind": "audio" }
  ]
}
```

### 4-in summing mixer

```json
"ports": {
  "inputs":  [
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

Each input goes through its own gain + pan into the summing mixer.
Users drag four cables in; the pedal's title-bar VOL knob attenuates
both stereo outputs in lockstep. See
[`examples/v40-mixer-pedal/`](../examples/v40-mixer-pedal/)
for the full worked example with a webview fader strip.

### Compressor with sidechain

See [`examples/v40-compressor-sc/`](../examples/v40-compressor-sc/).

### CV LFO utility

Audio IN not required — pure CV OUT feeds another plugin's AudioParam:

```json
"ports": {
  "inputs":  [],
  "outputs": [{ "id": "cvOut", "label": "CV", "kind": "cv" }]
}
```

See [`examples/v40-cv-lfo/`](../examples/v40-cv-lfo/).

---

## Migrating a v3 mixer-module FX plugin

If you have an FX plugin shipped against v1–v3:

1. Bump `schemaVersion` to `4`.
2. Add `"pedal-v4"` and `"portsV4"` to `requires[]`.
3. Add a `ports` block. Most v3 FX plugins had a single stereo chain,
   so the common shape is:
   ```json
   "ports": {
     "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
     "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
   }
   ```
4. If your plugin had an internal "level" / "output gain" param that
   mirrored what the mixer strip's fader did, consider dropping it —
   the host-injected OUT knob covers the same ground and users expect
   it in the title bar.
5. If you shipped `dsp.processorName`-style mixer-module DSP without a
   `graph`, you need to migrate to a v3 graph or a v3 worklet. The
   `buildFxChain()` contract is retired. Most old FX plugins convert
   cleanly: wrap your old input/output nodes in a tiny graph with
   `port:in → yourChain → port:out`.
6. Run `ntvalidate` — it catches every remaining v4 requirement.

End-users with your v3 plugin installed will see it auto-migrate to a
pedal on project load (tracker channel send → pedal → master), so
their existing projects keep sounding the same.

---

## See also

- [`14-ports.md`](14-ports.md) — the unified port model in detail
- [`06-instrument-graphs.md`](06-instrument-graphs.md) — graph syntax
  (same syntax pedals use)
- [`09-webview.md`](09-webview.md) — webview UI in pedals
- [`reference/schema.md`](reference/schema.md) — every field
- [`reference/host-capabilities.md`](reference/host-capabilities.md) —
  every capability flag
