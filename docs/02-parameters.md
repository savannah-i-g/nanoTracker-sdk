# Parameters

Every knob, slider, toggle, or XY pad on a plugin's UI is backed by an
entry in the top-level `parameters[]` array. Parameters are how the
host, the tracker's automation system, and your DSP code agree on a
named value and its range.

Typical block:

```json
"parameters": [
  { "key": "cutoff",    "label": "CUTOFF",
    "min": 40, "max": 16000, "default": 1200, "step": 1,
    "unit": "Hz", "displayDecimals": 0, "curve": "exponential" },
  { "key": "resonance", "label": "RES",
    "min": 0, "max": 0.95, "default": 0.3, "step": 0.01,
    "displayDecimals": 2, "group": "filter" }
]
```

## Fields

| Field | Required | Type | Purpose |
|---|---|---|---|
| `key` | yes | string | Unique identifier. Referenced from `ui.controls[].parameter`, `modRoute` targets, preset values, and worklet messages. |
| `label` | yes | string | ALL-CAPS display label shown next to the control. |
| `min` | yes | number | Lower bound (inclusive). |
| `max` | yes | number | Upper bound (inclusive). |
| `default` | yes | number | Initial value on plugin load or reset. |
| `step` | yes | number | Quantisation step for UI nudging and automation. Use 0.01 for continuous, 1 for integer. |
| `unit` | no | string | Display suffix (e.g. `"Hz"`, `"s"`, `"%"`, `"dB"`). Cosmetic. |
| `displayDecimals` | no | number | Precision shown in the readout. Defaults to auto. |
| `group` | no | string | v2: optional grouping label. Cosmetic organisation hint for UI renderers. |
| `curve` | no | `"linear" \| "exponential" \| "logarithmic"` | v2: non-linear value mapping. See below. |
| `midiLearnable` | no | boolean | v3.6: whether the host shows a "MIDI LEARN" entry in this parameter's right-click menu. Defaults to `true`. Set `false` for display-only or structural parameters (e.g. an oscillator-type selector). Does not prevent the host from reading or writing the parameter — only hides it from the MIDI Learn UX. |

## Keys

The `key` is a dot-path. Simple keys like `"cutoff"` work for most
plugins. For v3 graph-based plugins, keys typically look like
`"nodeId.paramName"` (e.g., `"filter1.frequency"`) so one parameter
drives an AudioParam on a specific node.

**Rules:**

- Must be a non-empty string
- Must be unique within a plugin — two parameters with the same key
  is an authoring bug
- Referenced from UI controls (`parameter`, `parameterX`, `parameterY`
  fields), modulation route targets (`target: "foo.bar"`), factory
  preset `values` maps, and worklet message payloads
- Case-sensitive

`ntvalidate` flags unresolved UI references (a UI control pointing at
a parameter key that isn't declared).

## Curves

`curve` controls how a UI knob's 0..1 position maps onto `[min, max]`.

- **`"linear"`** (default) — position 0.5 → exactly
  `min + (max - min) * 0.5`. Good for pan, mix, anything where "middle
  of the knob = middle of the range" is what the user expects.
- **`"exponential"`** — position 0.5 → a value much closer to `min`
  than `max`. Use for frequencies, times (release, delay), anything
  with a perceptually logarithmic response. A cutoff knob with
  `min=40, max=16000` on an exponential curve feels natural;
  linear feels like "nothing happens below 3 o'clock."
- **`"logarithmic"`** — inverse of exponential. Rare; use for values
  where the interesting range is at the top.

The tracker host applies the curve in the UI layer, then stores and
forwards the **linear** value to your DSP. Your processor always sees
values in the literal `[min, max]` range — you don't have to
un-curve anything.

## Units and display

`unit` is a cosmetic suffix shown next to the value in the UI. Common
conventions:

| Unit | Used for |
|---|---|
| `"Hz"` | frequencies |
| `"s"` / `"ms"` | times (envelope stages, delays) |
| `"dB"` | gains, thresholds |
| `"%"` | normalised ratios |
| `"c"` | cents (pitch offsets) |
| `"st"` | semitones |
| `""` | dimensionless |

`displayDecimals` controls the precision. `0` for integers, `2` for
most continuous values, `3` for millisecond-sensitive knobs.

## Groups

`group` is a free-form string label that UI renderers **may** use to
visually cluster related parameters. It's purely advisory — the
current tracker UI renderer ignores `group` and lays controls out in
declaration order. Future renderers or plugin panels may sort by
group.

In practice, if you want visual grouping today, use the `group` UI
control type (see [`03-ui-controls.md`](03-ui-controls.md)) which
actually renders a nested container. The `group` field on parameters
is a hint, the `group` UI control is a command.

## Factory presets

`presets[]` is a sibling to `parameters[]` — a list of named parameter
snapshots exposed in the UI as a dropdown:

```json
"presets": [
  { "name": "CLASSIC",  "values": { "cutoff": 1200, "resonance": 0.3 } },
  { "name": "SCREAMER", "values": { "cutoff": 4000, "resonance": 0.85 } }
]
```

Each preset's `values` is a `Record<key, number>` — any keys you
don't mention stay at their current values. Clicking a preset in the
UI applies every key/value pair at once and triggers the normal
parameter-change dispatch so any live audio updates.

Rules:

- Every key in `values` **must** match an existing entry in
  `parameters[]` (the loader silently drops unknown keys, but
  `ntvalidate` catches them)
- `name` is free-form; uppercase 1–3 word names render best
- Unlimited number of presets, but ~10–20 is the comfortable UI max

Presets are v2+. See [`../examples/doom-wasm/plugin.json`](../examples/doom-wasm/plugin.json)
for a no-preset plugin and any shipping instrument in the main
plugins folder for a plugin with presets.

## Loop presets (instrument-only)

Completely separate from factory presets — these are **step sequences**,
not parameter snapshots. Live under `loopPresets[]` at the top level:

```json
"loopPresets": [
  {
    "name": "4/4 HOUSE",
    "steps": [
      { "padIndex": 1, "volume": 100 },
      { "padIndex": 0 },
      { "padIndex": 2, "volume": 80 },
      { "padIndex": 0 }
    ]
  }
]
```

Loop presets appear as buttons in the sample-pad view for instrument
plugins that have sample zones. Clicking a preset replaces the current
step sequence. Each step has:

| Field | Default | Purpose |
|---|---|---|
| `padIndex` | required | 1-based index into `dsp.samples[]` (0 = silent / rest) |
| `pitch` | 0 | semitone offset from the sample's root key |
| `volume` | 100 | 0–100 velocity scale |
| `reverse` | false | play the sample backwards |
| `active` | true | set to `false` to mark a step skipped |

See any shipping sample-based instrument plugin for examples. The
feature only applies to instruments with sample zones; FX plugins
and synth-only instruments should omit `loopPresets` entirely.

## Common pitfalls

**"My knob does nothing."** Check that the UI control's `parameter`
field matches a `key` in `parameters[]` exactly — it's case-sensitive.

**"My default is out of range."** `min <= default <= max` is a soft
requirement — the host clamps at load time if you violate it, but
`ntvalidate` doesn't catch this yet. Double-check when setting tight
ranges.

**"The display shows too many decimals."** Set `displayDecimals` on
the parameter. The UI falls back to auto-formatting otherwise, which
gives you six decimal places for an integer millisecond time.

**"I want the knob to feel more musical."** Switch to
`curve: "exponential"` for anything with a perceptually logarithmic
response (frequency, time, dB). Linear is almost never the right
choice for audio parameters.

**"I want two parameters to move together."** Use modulation routing
(see [`05-fx-graphs.md`](05-fx-graphs.md) or
[`06-instrument-graphs.md`](06-instrument-graphs.md)) instead of
trying to mirror parameter values. Mod routes are the tracker's
built-in "when this changes, that changes" mechanism.

## See also

- [`03-ui-controls.md`](03-ui-controls.md) — how to render parameters
  as knobs, sliders, pads, etc.
- [`05-fx-graphs.md`](05-fx-graphs.md) — how parameter keys drive
  audio-graph node fields via dot-path (`"nodeId.paramName"`)
- [`07-audioworklets.md`](07-audioworklets.md) — how parameters are
  forwarded to an AudioWorklet processor
- [`reference/schema.md`](reference/schema.md) — `PluginParamDef`
  field-by-field reference
