# Host capability flags

Plugins declare required capabilities via `"requires": [...]` at the
top level of `plugin.json`. The host loader checks each entry
against its supported-capability set and throws at load time if any
required flag is missing.

Instrument plugins can **also** declare capabilities under
`dsp.requires` as a convenience location — the loader checks both.

## Current flags

| Flag | Phase | Gates |
|---|---|---|
| `graph` | v3.1 | v3 declarative instrument graph engine (`dsp.graph`) |
| `worklet-v3` | v3.1 | v3 instrument worklet contract (`dsp.worklet`) |
| `granular` | v3.2 | host-shipped granular AudioWorklet node type |
| `wavetable` | v3.2 | host-shipped wavetable AudioWorklet node type |
| `modMatrix-v3` | v3.3 | v3 multi-target modulation routing (`targets[]`) |
| `trackerEffects-v3` | v3.3 | tracker effect-column dispatch to plugin voice engines |
| `webview-ui` | v3.4 | v3 `webview` UI control |
| `themeOverride` | v3.5 | per-plugin InstrumentWindow theme colour overrides (`ui.themeOverride`) |
| `portsV4` | v4.0 | unified typed `ports` block on any plugin (`PluginPortsDef`). |
| `pedal-v4` | v4.0 | `type: "fx"` plugins as workspace pedals (floating window, patch cables, multi-port). |
| `webview-writes` | v4.0 | iframe→host write channel (`paramWrite` / `presetLoad` / `presetSave` / `noteOn` / `noteOff` / `hostCommand`). |
| `midi-cc` | v3.6 | raw MIDI CC forwarding to a plugin's webview iframe (non-parameter CC handling). See [`../09-webview.md`](../09-webview.md). |
| `consumes-song-position` | v3.6 | plugin opts into host → iframe / worklet `songPosition` transport messages. See [`../09-webview.md`](../09-webview.md). |
| `webview-ports` | v4.1 | webview-exposable patch-cable ports declared in `ports.webviewExposable[]`. See [`../15-webview-ports.md`](../15-webview-ports.md). |
| `sampler-v41` | v4.1 | unified `type: "sampler"` graph node + v4.1 zone features (`pingpong` / `release` loop modes, `loopCrossfade`, `roundRobinGroup`, `choke`, `trigger: "release"`, `pitchTracking: false`). |
| `sliceMap-v41` | v4.1 | sampler-node `sliceMap` block (author slices + `autoDetect: "markers"/"grid:N"/"transients"`). |
| `sampleMeta-v41` | v4.1 | zone-level `meta` block surfaced to the plugin (original tempo / root key / cue markers extracted from WAV chunks). |
| `userSamples` | v4.1 Phase B | user-assignable sample slots (`userAssignable` / `slotId` / `fallbackFile` on zones, `sampleBank` block, `openSamplePicker` + `clearSampleSlot` host commands, `sampleAssigned` + `sampleSlots` iframe events, POVR `.ftrk` persistence). |
| `presetBank-v4` | v4.1 Phase C | user preset persistence — webview `presetSave` with `scope: "project"|"library"`, `presetDelete`, `sampleAssignments` on factory + user presets, `.ftrk` PPRS block, per-plugin IndexedDB preset library. |

## Detailed reference

### `graph`

Enables the v3 declarative per-voice instrument graph engine. Plugins
that set `dsp.graph` **must** declare this capability or the loader
refuses to process the graph block.

**Triggers failure when**: `dsp.graph` is present but `requires` is
missing or doesn't include `"graph"`.

**See**: [`../06-instrument-graphs.md`](../06-instrument-graphs.md)

### `worklet-v3`

Enables the v3 whole-instrument AudioWorklet contract
(`dsp.worklet.processorName`). Plugins using the v3 MessagePort
protocol, `voiceId` tracking, `loadAsset` messages, or auto-wired
reserved AudioParams (`pitch`/`gate`/`velocity`/`gain`) must declare
this.

**Triggers failure when**: `dsp.worklet` is set and `requires` is
missing `"worklet-v3"`.

**See**: [`../08-worklet-v3.md`](../08-worklet-v3.md),
[`worklet-protocol.md`](worklet-protocol.md)

### `granular`

Enables the `type: "granular"` graph node. The host ships a
pre-registered granular AudioWorklet that every plugin with this
capability can instantiate as a graph node.

**Triggers failure when**: any `nodes[]` entry has `type: "granular"`
and `requires` is missing `"granular"`.

**See**: [`../06-instrument-graphs.md`](../06-instrument-graphs.md)

### `wavetable`

Enables the `type: "wavetable"` graph node. The host ships a
pre-registered wavetable AudioWorklet.

**Triggers failure when**: any `nodes[]` entry has `type: "wavetable"`
and `requires` is missing `"wavetable"`.

**See**: [`../06-instrument-graphs.md`](../06-instrument-graphs.md)

### `modMatrix-v3`

Enables v3 multi-target modulation routing — `modRoutes[].targets[]`
with per-target `depth` / `transform` / `slew` / `offset` / `scale` /
`curve`. The v2 single-target form (`target` + `depth` + `bipolar`)
works without this flag.

**Triggers failure when**: any `modRoutes[]` entry has a `targets[]`
array and `requires` is missing `"modMatrix-v3"`.

**See**: [`../05-fx-graphs.md`](../05-fx-graphs.md),
[`../06-instrument-graphs.md`](../06-instrument-graphs.md)

### `trackerEffects-v3`

Enables the plugin's voice engine to receive raw tracker effect-column
bytes via `applyTrackerEffect(effectCode, value, time)`. Plugins that
implement their own native vibrato, portamento, arpeggio, etc. in
response to MOD effect commands should declare this flag.

v1/v2 plugins don't implement `applyTrackerEffect` and don't need the
flag — they transparently fall back to the host's default
pitch/volume slide behaviour.

**Triggers failure when**: (no automatic check — this is a convention;
plugins that want the feature declare it for documentation purposes)

### `webview-ui`

Enables the v3 `webview` UI control type. Plugins with any
`webview`-type UI control **must** declare this flag — `ntvalidate`
catches it and `ntpack` refuses to pack the archive otherwise.

**Triggers failure when**: any `ui.controls[]` entry has
`type: "webview"` and `requires` is missing `"webview-ui"`.

**See**: [`../09-webview.md`](../09-webview.md),
[`../10-wasm-in-webview.md`](../10-wasm-in-webview.md)

### `themeOverride`

Enables the `ui.themeOverride` manifest field. When declared, the host
reads a subset of the 11 theme colour keys from `ui.themeOverride` and
applies them as scoped CSS custom properties on the plugin's
InstrumentWindow — the override cascades to chrome, built-in UI
controls, and (for webview plugins) is re-posted to the iframe as a
`themeChange` event.

**Triggers failure when**: `ui.themeOverride` is present and `requires`
is missing `"themeOverride"`.

**See**: [`../03-ui-controls.md`](../03-ui-controls.md),
[`../09-webview.md`](../09-webview.md)

### `portsV4`

Enables the unified typed `ports` block (`PluginPortsDef`) at the top
level of `plugin.json`. When declared, the host reads `ports.inputs[]`
and `ports.outputs[]` and exposes each entry as a jack on the plugin's
InstrumentWindow (or pedal window). Ports carry a `kind` field
(`"audio"` / `"sidechain"` / `"cv"` / `"gate"`) that drives both the
jack rendering and the underlying Web Audio wiring.

For instrument plugins the capability is optional — omitting both
`ports` and `portsV4` reverts to the legacy single-output shape.

**Triggers failure when**: `ports` is present and `requires` is
missing `"portsV4"`.

**See**: [`../14-ports.md`](../14-ports.md),
[`schema.md#pluginportsdef-v4`](schema.md#pluginportsdef-v4)

### `pedal-v4`

Required for every `type: "fx"` plugin authored against v4.0 or later.
Marks the plugin as a workspace pedal — rendered in a floating
`TrackerWindow` with patch cables, a host-injected output VOL knob
(drives every audio OUT gain in lockstep), and a bypass toggle.
Pedals must also declare `ports` and therefore `portsV4`; the loader
rejects pedals missing either.

Legacy `type: "fx"` plugins targeting the v1–v3 TrackerFxMixer module
slot are **no longer accepted**. Projects that previously used them
auto-migrate on load (see CHANGELOG v4.0).

**Triggers failure when**: `manifest.type == "fx"` and `requires` is
missing `"pedal-v4"` (or `ports` is missing).

**See**: [`../13-pedals.md`](../13-pedals.md)

### `webview-writes`

Enables the iframe→host write channel on `webview` UI controls. When
declared, the iframe can post `paramWrite`, `presetLoad`, `presetSave`,
`noteOn`, `noteOff`, and `hostCommand` messages to the host.
Per-message-class acceptance is additionally gated by the webview
control's `acceptsParamWrites` / `acceptsPresetWrites` / `acceptsNotes`
/ `acceptsHostCommands` fields — capability declares "I will use this
at all", the field declares "on this specific webview control".

Every write is validated against the manifest (param min/max,
declared preset ids, `hostCommand` whitelist). Invalid writes are
dropped and reported back to the iframe as `{type:"__nt_error"}`.

**Triggers failure when**: any webview control sets any `accepts*`
write flag to `true` and `requires` is missing `"webview-writes"`.

**See**: [`../09-webview.md`](../09-webview.md#bidirectional-bridge-v4)

## When to declare

The rule of thumb: **declare every flag you use**. If your plugin
stops working because you removed a feature, you can re-test and
drop the flag later — but declaring something you don't use is
harmless, and forgetting to declare something you DO use means the
plugin loads silently on old hosts and produces garbage audio.

`ntvalidate` (and `ntpack`'s pre-flight) catches the common cases:
webview controls without `webview-ui`, graph nodes without `graph`,
etc. Run it.

### `sampler-v41`

Enables the unified `type: "sampler"` graph node and the v4.1
extensions to `PluginSampleZone`:

- Loop modes `"pingpong"` and `"release"` (the v1 boolean form keeps
  meaning one-shot vs forward-loop).
- `loopCrossfade` (equal-power fade over the loop seam, seconds).
- `roundRobinGroup` — same-group zones rotate across triggers.
- `choke` — same-group zones cut each other off.
- `trigger: "release"` — zone fires on noteOff instead of noteOn.
- `pitchTracking: false` — fixed-rate playback regardless of note.

The node unifies the three prior paths (v1/v2 `dsp.samples[]`
multi-zone kits, the v3 granular node, and custom worklet choppers)
under one declarative primitive. Zones and a `sliceMap` can coexist
on the same sampler node.

**Triggers failure when**: any `nodes[]` entry has `type: "sampler"`,
OR any zone declares a v4.1-only field, and `requires` is missing
`"sampler-v41"`.

**See**: [`../16-sampler-node.md`](../16-sampler-node.md),
[`schema.md#sampler-node`](schema.md#sampler-node)

### `sliceMap-v41`

Enables a sampler node's `sliceMap` block — breakbeat-style chopping
where a single WAV is divided into N slices and each slice plays on
a consecutive MIDI note. Supports author-supplied `slices[]` and the
auto-detect modes `"markers"` (read WAV cue chunk), `"grid:N"`
(divide uniformly), and `"transients"` (onset detection; Phase A
falls back to grid:16 if the detector isn't shipped yet).

**Triggers failure when**: a sampler node has a `sliceMap` and
`requires` is missing `"sliceMap-v41"`.

**See**: [`../16-sampler-node.md`](../16-sampler-node.md)

### `sampleMeta-v41`

Enables the zone-level `meta` block. The loader parses WAV SMPL
(root key + loop points), ACID (tempo), and cue chunks at sample-
decode time and attaches the results to each zone's `meta` field.
Authors may override any field in `plugin.json`; manual values win
over auto-extracted ones.

**Triggers failure when**: a zone authors `meta.originalTempo`,
`meta.originalKey`, or `meta.cuePoints[]` and `requires` is missing
`"sampleMeta-v41"`.

### `userSamples`

Enables user-assignable sample slots — zones the user can drop their
own WAV into at runtime. Covers:

- Zone fields: `userAssignable`, `slotId` (required, unique), `slotLabel`,
  `fallbackFile`, `accept: string[]`, `maxDurationSec`.
- Top-level `sampleBank` block: `{ userSlotCount, allowUserSwap,
  presetsCarrySamples }`.
- Fully-wired webview bridge:
  - `hostCommand: "openSamplePicker"` → opens a native picker, hashes
    the selection, stores in IndexedDB, updates the override table.
  - `hostCommand: "clearSampleSlot"` → reverts a slot to fallback.
  - Host → iframe `sampleAssigned` event (per-slot change).
  - Host → iframe `sampleSlots` snapshot (on mount + every change).
- POVR `.ftrk` block: user drops persist with the project; reopening
  on another machine replays the user's samples intact.

**Triggers failure when**: any zone declares `userAssignable: true`,
OR the top-level `sampleBank` block is present, and `requires` is
missing `"userSamples"`.

**See**: [`../17-user-samples.md`](../17-user-samples.md)

### `presetBank-v4`

Enables user preset persistence. Covers three related features:

- `presets[].sampleAssignments` on factory presets — a `slotId →
  archive-path` map so a kit preset can ship with "which WAV goes
  in which slot". Keys must match a declared `slotId`; values must
  resolve inside the archive. Both enforced by `ntvalidate`.
- Webview `presetSave` gains `scope: "project" | "library"`,
  `includeSampleAssignments?`, and `tags?`. `"project"` writes into
  the `.ftrk` PPRS block so the preset travels with the song;
  `"library"` writes into a per-plugin IndexedDB bank that
  persists across projects.
- Webview `presetDelete` removes a user preset from whichever scope
  holds it. Factory ids are read-only.

`presetList` entries gain an optional `scope` discriminator
(`"factory" | "project" | "library"`) so iframe preset browsers can
group or filter.

**Triggers failure when**: any `presets[]` entry declares
`sampleAssignments`, OR an iframe opts into library-scope
`presetSave`, and `requires` is missing `"presetBank-v4"`.
`sampleAssignments` also require `"userSamples"` (a user-slot
system is a prerequisite).

**See**: [`../18-preset-bank.md`](../18-preset-bank.md)

## How the loader checks

The host loads `plugin.json`, reads `requires[]`, and compares every
entry against its own supported set. Any unknown flag throws a load
error that names the offending capability and lists every capability
the host does support. Any flag you forgot to declare for a feature
you're actually using will silently let the feature "succeed" at
load time and then produce undefined behaviour — which is exactly
why the pre-flight check runs ahead of you shipping the archive.

The check runs twice per plugin load: once on the top-level
`requires[]` and once on `dsp.requires[]` for instrument plugins.
Both are validated; either can contain the full set.

## Future capabilities

When the host adds a new feature that plugins need to opt into, a
new flag lands in the supported set. Plan for new flags by:

- **Declaring flags defensively** — if you use a v3 feature, also
  declare `"worklet-v3"` and `"graph"` just to be explicit
- **Testing on older hosts** — if your plugin is supposed to work on
  a pre-v3 host, stick to v1/v2 features and don't use the v3
  capability flags at all
- **Not abusing unknown flags** — declaring a typoed flag on purpose
  to prevent loading is clever but brittle; prefer explicit version
  checks or error messages

Capability additions are tracked in this file and in
[`../../CHANGELOG.md`](../../CHANGELOG.md) — when a new flag lands
the SDK is the first place to update.
