# UI controls

The `ui.controls[]` array declares what the plugin panel looks like.
The tracker's plugin UI layer maps each `type` string to a concrete
widget. Every control either:

- **Binds to a parameter** — a knob/slider/etc. that reads from and
  writes to a named `parameters[]` entry
- **Reads from analysis data** — a waveform view or meter that pulls
  from an analyser node in your DSP graph
- **Hosts its own state** — an XY pad (two parameters), an envelope
  editor (four parameters), a webview (whatever it wants)
- **Is structural** — a label, a nested group, or padding

## Minimal example

```json
"ui": {
  "layout": "flex",
  "accentColor": "#ff8800",
  "controls": [
    { "type": "knob",   "parameter": "cutoff",  "label": "CUT" },
    { "type": "knob",   "parameter": "reso",    "label": "RES" },
    { "type": "slider", "parameter": "mix",     "label": "MIX" },
    { "type": "toggle", "parameter": "bypass",  "label": "BYP" }
  ]
}
```

The panel renders left-to-right or top-to-bottom depending on
`layout`, theming accents pulled from `accentColor`.

## `PluginUiDef` fields

| Field | Default | Purpose |
|---|---|---|
| `layout` | `"flex"` | `"flex"` or `"grid"`. Controls the outer container's flex direction. |
| `controls` | required | Array of `PluginUiControl`. |
| `accentColor` | CSS var | CSS colour string used for knob indicators, label highlights, etc. (v2) |
| `minWidth` | — | Minimum panel width in pixels. |
| `minHeight` | — | Minimum panel height in pixels. |
| `themeOverride` | — | *(v3.5)* Partial theme-colour override for the whole InstrumentWindow. See below. |

### `themeOverride` (v3.5)

`themeOverride` takes any subset of the 11 colour keys used by the
host's theme system and scopes them to the plugin's InstrumentWindow:

```json
"ui": {
  "layout": "flex",
  "themeOverride": {
    "primary":     "#ff7a00",
    "primaryDim":  "#7a3a00",
    "bg":          "#140800",
    "bgElevated":  "#1d1005",
    "text":        "#ffddbb",
    "border":      "#552200"
  },
  "controls": [ /* ... */ ]
}
```

Omitted keys fall through to the active global theme via the CSS
cascade — so a plugin that only overrides `primary` and `bg` keeps
`text`/`border`/etc. in sync with the user's chosen palette when they
switch themes.

Scope:

- **Chrome** (title bar, borders, jacks, resize handle) and all
  built-in controls (knob, slider, toggle, etc.) recolour.
- **Webview** iframes receive the resolved palette as a `themeChange`
  [`VoiceEngineEvent`](reference/event-bus.md#themechange-v35) on
  mount and on every global theme change.
- **Other windows** are unaffected — overrides are scoped to this
  plugin's InstrumentWindow.

**Requires** the `"themeOverride"` capability in `requires[]`. The
host loader throws a load-time error if the flag is missing; the
`ntvalidate` pre-flight catches it earlier.

All 11 keys, for reference:

| Key | CSS variable | Typical use |
|---|---|---|
| `primary` | `--color-primary` | Knob indicators, accent text, active states |
| `primaryDim` | `--color-primary-dim` | Hover / pressed accent variants |
| `primaryGlow` | `--color-primary-glow` | `rgba(...)` soft glow behind accents |
| `bg` | `--color-bg` | Window body background |
| `bgElevated` | `--color-bg-elevated` | Panel / popover backgrounds |
| `text` | `--color-text` | Body text |
| `textDim` | `--color-text-dim` | Labels, secondary text |
| `border` | `--color-border` | Window / control borders |
| `scanline` | `--color-scanline` | `rgba(...)` CRT scanline tint |
| `highlightBg` | `--color-highlight-bg` | Selection / focus backgrounds |
| `highlightText` | `--color-highlight-text` | Selection / focus text colour |

## Control types

### `knob` — rotary dial

```json
{ "type": "knob", "parameter": "cutoff", "label": "CUT" }
```

Rotary 32×32 dial. Drag vertically to change value; double-click to
reset to `default`. The curve (linear/exponential/logarithmic) comes
from the parameter definition, not the control.

Optional fields:
- `label` (overrides parameter label)
- `midiLearnable` — v3.6 per-placement override of the parameter's
  `midiLearnable` flag. Use when the same parameter is rendered by
  two controls and only one should expose the MIDI Learn context-menu
  entry. Defaults to the parameter's own flag (which defaults to
  `true`).

### `slider` — horizontal fader

```json
{ "type": "slider", "parameter": "wet", "label": "WET" }
```

Native `<input type="range">`. Takes less vertical space than a knob,
more horizontal. Good for mix amounts, crossfaders, anything where
the range feels "linear" to the eye.

### `toggle` — on/off switch

```json
{ "type": "toggle", "parameter": "bypass", "label": "BYP" }
```

Binary button. Reads `0` as OFF and any positive value as ON.
Clicking flips between `min` (off) and `max` (on). Use it for
parameters with `min: 0, max: 1, step: 1`.

### `select` — dropdown

```json
{
  "type": "select",
  "parameter": "filterType",
  "label": "TYPE",
  "options": ["LOWPASS", "HIGHPASS", "BANDPASS", "NOTCH"]
}
```

Native `<select>`. The parameter value is the zero-based index into
`options[]` — so in the example above, `filterType = 0` means
"LOWPASS". Your DSP code interprets the integer however you want.

### `number` — numeric input

```json
{ "type": "number", "parameter": "seed", "label": "SEED" }
```

Click-to-edit number input. Good for values where the user wants to
type an exact number rather than drag. Respects the parameter's `min`,
`max`, `step`.

### `waveform_view` — canvas waveform display

```json
{
  "type": "waveform_view",
  "sampleIndex": 0,
  "width": 120,
  "height": 40
}
```

Renders a waveform to a `<canvas>`. Two modes:

- **Sample mode** (`sampleIndex` set): draws a static waveform of the
  indexed entry in your `dsp.samples[]` array. Use for
  sample-previews in drum machines.
- **Live mode** (`analyserNode` set): reads live FFT time-domain data
  from a named `analyser` node in your DSP graph and redraws each
  frame. Use for oscilloscope-style visualisers.

Size defaults: 120×40.

### `meter` — level bar

```json
{
  "type": "meter",
  "analyserNode": "outputAnalyser",
  "width": 80,
  "height": 12
}
```

Reads RMS + peak from an analyser node and draws a horizontal level
bar. Requires an `analyser` node in your DSP graph (see
[`05-fx-graphs.md`](05-fx-graphs.md)). Size defaults: 80×12.

### `xy_pad` — 2D parameter control

```json
{
  "type": "xy_pad",
  "parameterX": "cutoff",
  "parameterY": "resonance",
  "label": "FILTER",
  "width": 120, "height": 120
}
```

Square pad where the X and Y axes map to two parameters. Click-drag
anywhere to set both values at once. The value range and curve come
from each parameter's own definition.

Useful when two parameters naturally combine: filter cutoff + resonance,
delay time + feedback, attack + decay.

### `envelope_editor` — ADSR breakpoint editor

```json
{
  "type": "envelope_editor",
  "parameters": ["attack", "decay", "sustain", "release"],
  "width": 160, "height": 60
}
```

Visual ADSR editor. The four listed parameters are interpreted as
attack/decay/sustain/release respectively. Dragging the breakpoints
writes back to those parameters live.

If you want a multi-stage envelope editor for v2 named envelopes, see
[`06-instrument-graphs.md`](06-instrument-graphs.md) — the current
`envelope_editor` control is ADSR-only.

### `label` — static text

```json
{ "type": "label", "label": "-- FILTER --" }
```

Non-interactive text. Use to separate visual sections. No parameter
binding.

### `group` — nested container

```json
{
  "type": "group",
  "style": "row",
  "label": "ENVELOPE",
  "children": [
    { "type": "knob", "parameter": "attack",  "label": "A" },
    { "type": "knob", "parameter": "decay",   "label": "D" },
    { "type": "knob", "parameter": "sustain", "label": "S" },
    { "type": "knob", "parameter": "release", "label": "R" }
  ]
}
```

Recursive container. `style: "row"` lays children horizontally,
`"column"` vertically. Groups nest arbitrarily deep but the renderer
doesn't enforce a limit — in practice, one level of nesting is what
most plugins use.

Optional `label` field renders a heading above the children.

### `webview` — sandboxed iframe

```json
{
  "type": "webview",
  "source": "web/index.html",
  "aspectRatio": "16/10",
  "forwardNotes": true
}
```

v3-only. Mounts an HTML file from your plugin archive inside a
sandboxed `<iframe>`, wires a `postMessage` bridge to forward tracker
events. This is the escape hatch for "I need to draw my own pixels."

See [`09-webview.md`](09-webview.md) for the full reference and
[`10-wasm-in-webview.md`](10-wasm-in-webview.md) for the DOOM
walkthrough.

## Layout patterns

### Row of knobs (the common case)

```json
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "knob", "parameter": "a", "label": "A" },
    { "type": "knob", "parameter": "b", "label": "B" },
    { "type": "knob", "parameter": "c", "label": "C" }
  ]
}
```

### Grouped sections

```json
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "group", "style": "row", "label": "ENV", "children": [
      { "type": "knob", "parameter": "attack",  "label": "A" },
      { "type": "knob", "parameter": "decay",   "label": "D" },
      { "type": "knob", "parameter": "sustain", "label": "S" },
      { "type": "knob", "parameter": "release", "label": "R" }
    ]},
    { "type": "group", "style": "row", "label": "FILTER", "children": [
      { "type": "knob",   "parameter": "cutoff", "label": "CUT" },
      { "type": "slider", "parameter": "reso",   "label": "RES" }
    ]}
  ]
}
```

### XY pad + supporting knobs

```json
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "xy_pad",
      "parameterX": "cutoff", "parameterY": "resonance",
      "width": 120, "height": 120 },
    { "type": "group", "style": "column", "children": [
      { "type": "knob", "parameter": "drive",    "label": "DRV" },
      { "type": "knob", "parameter": "envAmt",   "label": "ENV" }
    ]}
  ]
}
```

### Oscilloscope visualiser

```json
"ui": {
  "layout": "flex",
  "controls": [
    { "type": "waveform_view", "analyserNode": "masterAnalyser",
      "width": 240, "height": 60 },
    { "type": "group", "style": "row", "children": [
      { "type": "meter", "analyserNode": "masterAnalyser",
        "width": 120, "height": 12 },
      { "type": "knob",  "parameter": "outputGain", "label": "OUT" }
    ]}
  ]
}
```

(Requires an `analyser` node in your DSP graph named `"masterAnalyser"`.)

### Webview + controls

```json
"ui": {
  "layout": "flex",
  "accentColor": "#ff2200",
  "controls": [
    { "type": "webview", "source": "web/index.html", "aspectRatio": "4/3" },
    { "type": "group", "style": "row", "children": [
      { "type": "knob", "parameter": "difficulty", "label": "SKILL" },
      { "type": "knob", "parameter": "level",      "label": "LVL"   }
    ]}
  ]
}
```

The webview takes up most of the panel; a small row of knobs below
surfaces metadata (levels, difficulty, whatever the webview's doc
reads from).

## Theming

`accentColor` is a CSS colour string used for:

- knob indicator line
- active toggle state
- label underlines
- focus rings

The tracker's default theme is amber (`--color-primary: #ff6600` or
similar). Pick an accent that contrasts well with the tracker's dark
background — bright saturated colours work, pastel greys don't.

## Where controls physically render

The tracker has **two places** it shows plugin UI:

1. **FX Mixer panel** — for `.ntsfx` plugins added to the mixer chain.
   Rendered inline next to the channel strip. Usually vertically
   compact.
2. **Instrument window** — for `.ntins` plugins in the workspace.
   Rendered in a draggable, resizable floating window. Can be as
   large as the user wants to drag it.

The same `ui.controls[]` array drives both — you don't author two
layouts. Design for flexibility: don't assume a specific width; use
`group` containers to let the renderer reflow.

## Common pitfalls

**"My knob vanishes."** Check that `parameter` matches a `key` in
`parameters[]` *exactly*. The renderer silently drops unresolved
references.

**"The XY pad is stuck in the middle."** Either one of the parameters
isn't declared, or both point at the same parameter. Each axis needs
its own `PluginParamDef`.

**"The waveform view is blank."** In sample mode, check
`sampleIndex` is a valid index into `dsp.samples[]`. In live mode,
check that an `analyser` node exists with the name you put in
`analyserNode`.

**"My UI is bigger than the window."** The renderer doesn't
auto-scroll — the user can resize the instrument window, but the FX
mixer is fixed. Keep FX plugin UIs compact (one row of knobs,
ideally).

## See also

- [`02-parameters.md`](02-parameters.md) — how to declare the
  parameters that UI controls bind to
- [`09-webview.md`](09-webview.md) — the webview control in detail
- [`reference/schema.md`](reference/schema.md) — `PluginUiControl`
  field reference
