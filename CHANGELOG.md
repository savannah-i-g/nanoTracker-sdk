# Plugin spec changelog

Version history for the nanoTracker plugin format. Each row describes
what landed in that schema version. Features added to a higher version
are **additive** — a v3 host accepts v1 / v2 / v3 plugins
interchangeably, and a v1 plugin you shipped three years ago still
works today.

**v4.0 is the one exception**: it's a deliberate breaking reset that
retires the mixer-module FX plugin shape. v1/v2/v3 instrument plugins
continue to load unchanged. v1/v2/v3 FX plugins auto-migrate into the
new pedal model on project load — see the v4.0 notes below.

This is the authoring-side view. For the host-side implementation
history, see `git log` in the main repo.

---

## v4.2 — Definitive sampler + patch distribution (2026-04)

Closes every deferred caveat from the v4.1 Phase A/B/C rollout and
ships `.ntpreset` — the distributable preset archive format that
completes the patch-sharing story. No new schema fields, no new
capability flags; v4.2 is a correctness + completeness pass on top
of v4.1's Phase C surface.

**Closed caveats from Phase A:**

- **`loopCrossfade` now audible.** The forward-loop path pre-bakes
  an equal-power cos/sin seam blend into a cached per-(buffer,
  bounds, fade) AudioBuffer. Native Web Audio looping then
  transitions smoothly. Ping-pong already used its own cached
  dual-direction buffer — unchanged in v4.2.
- **`sliceMap.autoDetect: "transients"` now detects transients.**
  Shipped a spectral-energy-flux onset detector with moving-
  median normalisation and a 40 ms minimum inter-onset gap. No
  more `grid:16` fallback for realistic breakbeat input.
- **`sliceMap.autoDetect: "markers"` honours cue markers even
  when the source isn't attached to a zone.** The loader now
  exposes a path-keyed metadata map on `LoadedPlugin.sampleMeta`
  that the sampler runtime consults for slice-map sources.

**Closed caveats from Phase C:**

- **Preset-load `sampleAssigned` carries real metadata.** When a
  preset's `sampleAssignments` resolves a hash, the host looks up
  the original filename, sample rate, channel count, and duration
  from IndexedDB rather than emitting placeholder zeros.
- **Missing blobs surface as `__nt_error`.** A preset referencing
  a hash the local blob store has never seen now reports
  `{where: "presetLoad", message: "sample blob missing for slot …"}`
  back to the iframe instead of silently reverting to fallback.

**New — `.ntpreset` distribution:**

Zip archive format for sharing user presets (and the samples they
reference) between machines:

```
my-preset.ntpreset
├── preset.json          # UserPresetRecord + pluginRef
└── samples/             # optional
    └── sha256-<hex>.wav
```

`preset.json` shape:

```jsonc
{
  "format": "ntpreset",
  "formatVersion": 1,
  "pluginRef": {
    "id":   "plugin:KIT-8@1.2.0",
    "name": "KIT-8",
    "version": "1.2.0",
    "minSchemaVersion": 4
  },
  "preset": UserPresetRecord
}
```

Sample files are content-hash-addressed: filename must match the
actual SHA-256 of the bytes or the importer rejects the entry. This
makes the format robust to file tampering and dedupes automatically
when the same WAV is referenced by multiple presets.

**New — webview host commands:**

- `hostCommand: "exportPreset" { presetId }` — resolves the preset
  in project + library scope, zips up `preset.json` + every
  referenced sample blob, triggers a browser download.
- `hostCommand: "importPreset"` — opens a file picker, unpacks the
  archive, installs sample blobs into IndexedDB, writes the record
  to the per-plugin library, and fires host → iframe
  `presetImported { presetId, scope: "library", missingHashes[] }`.

**New — host → iframe event:**

- `presetImported { presetId, scope, missingHashes }` — fired after
  a successful `importPreset`. `missingHashes[]` is populated when
  the archive's `preset.sampleAssignments` references hashes that
  weren't bundled (the `.ntpreset` was exported standalone without
  blobs); iframes can warn the user that some slots will revert to
  fallback.

**Deprecations status:**

- `PluginVoiceEngine.inputs` / `.outputs` — v4.1 originally
  scheduled retirement; v4.2 defers to a future major (v5.0)
  because internal `workspaceCableGraph` / `instrumentWorkspace`
  consumers still depend on the positional arrays as a guaranteed-
  populated fallback path. No action required from plugin authors.

**Deferred to v5.0 or later:**

- Cross-instrument performance snapshots (one preset spans
  multiple plugin instances).
- Streaming decode for very large samples (>30s high-resolution
  source material).
- Preset-library cloud sync.

**Docs:**

- [`docs/19-ntpreset.md`](docs/19-ntpreset.md) — `.ntpreset`
  format spec + authoring guide.
- [`docs/16-sampler-node.md`](docs/16-sampler-node.md) — marker/
  transient caveats removed.
- [`docs/18-preset-bank.md`](docs/18-preset-bank.md) — import/
  export sections closed.
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) —
  `presetImported` event added.

---

## v4.1 — Sampler plugin primitive, Phase C (2026-04)

User preset persistence. v4.0 reserved `presetSave` as a webview
bridge surface that validated but didn't persist; Phase C finishes
the wiring. Presets can now carry parameter values AND user sample
assignments, save into either a per-plugin IndexedDB library
(cross-project) or the project itself (via a new `.ftrk` PPRS
block), and reload with every sample the user had selected at save
time.

All Phase C additions are capability-gated behind `"presetBank-v4"`
and build on `"userSamples"` from Phase B. v4.0 / v4.1-Phase-A/B
plugins load unchanged.

**New — user preset scopes:**

- `scope: "project"` (default) — the preset ships inside the .ftrk
  PPRS block. Travels with the song.
- `scope: "library"` — the preset persists in the per-plugin
  IndexedDB bank. Survives project switches; does not travel with
  the song.

Both scopes share one record shape (`UserPresetRecord`). Records
may optionally carry `sampleAssignments` — a `slotId → content-hash`
map that, on load, re-applies each override from IndexedDB onto the
live per-instance table.

**New — factory-preset sample assignments:**

Factory `presets[]` entries may now declare:

```jsonc
{
  "name": "Classic 909",
  "values": { "tune": 0.5 },
  "sampleAssignments": {
    "kick":  "samples/909-kick.wav",
    "snare": "samples/909-snare.wav"
  }
}
```

Unlike user-scope assignments (which reference content hashes),
factory assignments reference archive-relative paths. Both sides
validate via `ntvalidate`: keys must resolve to declared `slotId`s,
values must point to files that exist in the archive.

**New — webview bridge, fully wired:**

- `presetSave` payload extended with `scope?`, `includeSampleAssignments?`,
  `tags?`. Host persists into the right store and broadcasts:
  - Host → iframe `presetSaved { presetId, scope }`
  - Host → iframe `presetList` refresh with merged factory /
    project / library entries.
- `presetLoad` now resolves user ids (prefix `"user-"`) in addition
  to factory ids. Application path: parameters via the standard
  `updateParams` route + `sampleAssignments` onto the override
  table (reason: `"preset"`), so the sampler runtime picks up each
  slot change on the next noteOn.
- `presetDelete { presetId }` — new iframe → host message. Removes
  a user preset from whichever scope holds it. Factory ids are
  rejected.
- `presetList` entries gain a `scope` discriminator
  (`"factory" | "project" | "library"`) so iframe preset browsers
  can group or filter.

**New — `.ftrk` PPRS block (v13 project format):**

Per-instance `{ activePresetId?, projectPresets: UserPresetRecord[] }`.
JSON payload (preset records are small enough that the flexibility
wins over a custom binary layout). Older hosts skip the block; data
is preserved on re-save under a v4.1.2 host.

**New — host-rendered slot panel (Phase B follow-up, ships with Phase C):**

Plugins that declare user slots but don't author a webview picker
now get a built-in panel below the plugin UI: one row per slot
(label, current sample name, PICK, CLEAR). Suppressed by
`sampleBank.allowUserSwap: false` for plugins that want to render
their own picker.

**New — capability flag:**

- `"presetBank-v4"` — required for `sampleAssignments` on factory
  presets OR for library-scope preset saves via the webview bridge.

**Docs:**

- [`docs/18-preset-bank.md`](docs/18-preset-bank.md) — preset
  library authoring guide.
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md)
  — new `presetBank-v4` entry.
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) —
  `presetSaved`, `presetList.scope`, `presetDelete` iframe message.
- [`docs/09-webview.md`](docs/09-webview.md) — `presetSave` payload
  extended with scope + includeSampleAssignments + tags.

**Deferred to v4.2:**

- `.ntpreset` distribution format — zip archive for sharing presets
  between users, including sample blobs.
- Streaming decode for very large samples.
- Cross-instrument performance snapshots.

---

## v4.1 — Sampler plugin primitive, Phase B (2026-04)

User-supplied sample slots. A plugin may now mark a sample zone
`userAssignable: true` and users can drop their own WAV into it at
runtime — via the webview `openSamplePicker` hostCommand (now fully
wired, not just validated) or the host's built-in picker. Overrides
are persisted per project via a new `.ftrk` POVR block, so reopening
the song on any machine plays back with the user's samples intact.

All Phase B additions are capability-gated behind `"userSamples"`.
v4.0 / v4.1-Phase-A plugins load unchanged.

**New — zone-level `userAssignable` fields:**

- `userAssignable: true` — turns a zone into a user-swappable slot.
- `slotId` — stable unique id (required when `userAssignable: true`).
  The override table, POVR block, and `sampleAssigned` / `sampleSlots`
  events all key on this.
- `slotLabel` — human-readable label for the picker UI.
- `fallbackFile` — archive-relative default sample used until the
  user drops their own.
- `accept: string[]` — MIME whitelist for the picker.
- `maxDurationSec` — reject longer drops with a clear error.

**New — top-level `sampleBank` block:**

```jsonc
"sampleBank": {
  "userSlotCount": 16,
  "allowUserSwap": true,
  "presetsCarrySamples": "optional"  // reserved for Phase C
}
```

Declares high-level sampler metadata (currently a hint to the host
slot panel for sizing).

**New — webview bridge, fully wired:**

- `hostCommand: "openSamplePicker"` — now opens a native file picker,
  decodes + hashes the selection, stores the blob in IndexedDB, and
  updates the per-instance override table. Payload: `{ slotId }`.
- `hostCommand: "clearSampleSlot"` — reverts a slot to its
  `fallbackFile`. Payload: `{ slotId }`.
- Host → iframe `sampleAssigned { slotId, sampleId, name, duration,
  channels, sampleRate, source }` fired on every override change
  (user drop, clear, project load).
- Host → iframe `sampleSlots { slots }` — snapshot broadcast on
  iframe mount AND on every change so compact UIs can rebind a grid
  without tracking individual assigns.

**New — `.ftrk` POVR block (v12 project format):**

Per-instance, per-slot override blobs are embedded inline in the
project file, keyed by SHA-256 content hash. Same WAV referenced by
multiple slots dedupes automatically. Projects reopen on any machine
with every user drop intact. Older hosts skip the block and load the
project without overrides (no data loss — re-saving in v4.1.1+
restores fidelity).

**New — capability flag:**

- `"userSamples"` — required when any zone declares `userAssignable`
  or when `sampleBank` is present.

**Docs:**

- [`docs/17-user-samples.md`](docs/17-user-samples.md) — authoring
  guide for user-assignable slots.
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md)
  — new `userSamples` entry.
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) —
  `sampleAssigned` + `sampleSlots` iframe events.
- [`docs/09-webview.md`](docs/09-webview.md) — retire "reserved"
  notes on `openSamplePicker` + describe `clearSampleSlot`.

**Reserved for Phase C (v4.1.2):**

- User preset persistence (`presetSave` actually persists, preset
  entries carry `sampleAssignments`, `PPRS` `.ftrk` block,
  `pluginPresetBank.ts` library store).

---

## v4.1 — Sampler plugin primitive, Phase A (2026-04)

Closes the "sampler plugins are second-class" gap in v4.0 by making
sample-based instruments first-class at the schema level. Adds a
unified `type: "sampler"` graph node that covers MPC-style breakbeat
chopping, multi-sample drum kits, and single-sample pitched synths
under one declarative primitive — authors pick one schema instead of
faking it inside a custom AudioWorklet.

All Phase A changes are **additive and capability-gated**. v4.0
plugins load unchanged; a v4.1 plugin that uses any of the new
fields is rejected by a v4.0 host with a precise "requires
capability X" error so misconfiguration fails loudly rather than
silently producing wrong audio.

**New — unified sampler graph node:**

- `type: "sampler"` graph node. Exposes a single stereo audio output
  that voice connections can route like any other node. Declares
  either `zones[]` (multi-sample with key/velocity mapping) or a
  `sliceMap` (single WAV divided into triggerable slices), or both.
- Fields on the node: `zones[]`, `sliceMap`, `polyphony`,
  `samplerVoiceStealing`. See
  [`docs/16-sampler-node.md`](docs/16-sampler-node.md).

**New — extended `PluginSampleZone`:**

- `loop` accepts the string union `"none" | "forward" | "pingpong" | "release"`
  in addition to the legacy boolean form (true → `"forward"`, false
  → `"none"` — existing plugins keep working).
- `loopCrossfade` — equal-power fade over the loop seam, seconds.
- `roundRobinGroup` — zones sharing the name rotate on successive
  triggers.
- `choke` — zones sharing the name cut each other off (classic
  open/closed hi-hat behaviour).
- `trigger: "release"` — zone fires on noteOff instead of noteOn
  (piano release samples).
- `pitchTracking: false` — playback rate locked regardless of note
  (drum samples that shouldn't transpose).
- `meta: { originalTempo, originalKey, cuePoints[] }` — read from
  WAV SMPL / ACID / cue chunks at load time, author-overridable.

**New — slice map:**

- `sliceMap.source` — archive path to the WAV.
- `sliceMap.slices[]` — author-supplied `{ start, end, note?,
  velocity?, choke?, roundRobinGroup?, releaseOnGate? }`. When
  `note` is omitted the runtime assigns `36 + index` (GM kick + N).
- `sliceMap.autoDetect` — `"markers"` (read cue chunk) / `"grid:N"`
  (uniform division) / `"transients"` (onset detection, Phase A
  falls back to `"grid:16"`).
- `sliceMap.triggerMode` — `"oneShot"` (default) plays slice to end;
  `"gated"` loops the slice region while the key is held.

**New — capability flags:**

- `"sampler-v41"` — gates the sampler node and every v4.1-only zone
  field above.
- `"sliceMap-v41"` — gates the sliceMap block.
- `"sampleMeta-v41"` — gates exposing WAV-chunk metadata to the
  plugin via `zone.meta`.

**Breaking changes:**

- None. The v1 `loop: boolean` shape is still accepted. The
  `PluginVoiceEngine.inputs` / `.outputs` deprecation was scheduled
  for v4.1 but is deferred one release — they still work.

**Reserved for Phase B (v4.1.1):**

- User-supplied samples (`userAssignable` zones, `sampleBank`
  block, `"userSamples"` capability, `hostCommand: "openSamplePicker"`
  wiring, `sampleAssigned` iframe event, `POVR` `.ftrk` block).

**Reserved for Phase C (v4.1.2):**

- User preset persistence (`presetSave` actually persisting,
  `sampleAssignments` in preset entries, `PPRS` `.ftrk` block).

**Docs:**

- [`docs/16-sampler-node.md`](docs/16-sampler-node.md) — sampler
  authoring guide.
- [`docs/reference/schema.md`](docs/reference/schema.md) — zone +
  sampler node field reference.
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md)
  — three new capability flags.

---

## v4.0 — FX pedals, unified typed ports, bidirectional webview (2026-04)

The largest spec change since v3. Plugin FX leave the TrackerFxMixer
and become first-class **pedals** — floating `TrackerWindow` chrome
with labelled jacks and patch cables, multi-in / multi-out by default,
host-injected per-OUT volume knobs, and a bypass toggle. Instruments
and pedals share one typed port model (`"audio"` / `"sidechain"` /
`"cv"` / `"gate"`). Webview UIs gain a write channel so interactive
mixers and in-plugin preset browsers can drive the host.

**New:**

- `ports` top-level block with `PluginPortsDef` (`inputs[]`,
  `outputs[]`, each with `{id, label, kind, target?, index?}`). See
  [`docs/14-ports.md`](docs/14-ports.md) and
  [`docs/reference/schema.md`](docs/reference/schema.md#pluginportsdef-v4).
- Port kinds:
  - `audio` — standard Web Audio node-to-node
  - `sidechain` — electrically identical to `audio`, visually distinct
  - `cv` — audio-rate control voltage routed to an `AudioParam`
    (`target: "<nodeId>.<paramName>"`)
  - `gate` — boolean trigger (host watches for rising/falling edges)
- Pedal authoring path: `manifest.type == "fx"` with
  `ports` + `"pedal-v4"` + `"portsV4"` in `requires[]`. See
  [`docs/13-pedals.md`](docs/13-pedals.md).
- Host-injected per-audio-output volume knob on pedal / instrument
  window chrome. Manually declaring a plugin-side gain stage is no
  longer required to get a usable fader.
- Bypass toggle on pedal windows (audio IN short-circuits to audio OUT,
  DSP silenced). Applies to every pedal without any opt-in.
- Webview bidirectional bridge:
  - iframe→host messages: `paramWrite`, `presetLoad`, `presetSave`,
    `noteOn`, `noteOff`, `hostCommand`
  - Per-control opt-in flags: `acceptsParamWrites`,
    `acceptsPresetWrites`, `acceptsNotes`, `acceptsHostCommands`
  - Host-side `hostCommand` whitelist: `focusRequest`, `resizeRequest`,
    `showToast`, `openSamplePicker`
  - New host→iframe event: `presetList` (catalogue snapshot for
    in-plugin preset browsers)
- New workspace pseudo-windows (host side, but relevant for pedal
  authors): `TrackerBus` (per-channel stereo OUT jacks) and
  `MasterIn` (stereo IN jack feeding master bus). Pedals sit between
  them.
- FxPattern automation now targets pedals by `workspaceId` +
  `paramKey`. Plugins don't need to do anything — automation appears
  in the mixer's automation panel once the pedal is in the workspace.
- Capability flags: `"portsV4"`, `"pedal-v4"`, `"webview-writes"`.

**Breaking changes:**

- `type: "fx"` plugins authored against v1–v3 (mixer-module shape)
  **no longer load**. The host auto-migrates them on project load:
  each module instance becomes a pedal, pre-wired `TrackerBus.CHnn →
  pedal → MasterIn`. Param values are preserved. First save after
  migration drops the legacy mixer-module slot.
- v4 FX plugins MUST declare `ports`. The loader rejects
  `type: "fx"` plugins without a `ports.inputs[]` entry.
- `PluginVoiceEngine.inputs: AudioNode[]` / `outputs: AudioNode[]` are
  kept as deprecated getters delegating to `ports` for one release;
  retired in v4.1.

**Docs:**

- [`docs/13-pedals.md`](docs/13-pedals.md) — pedal authoring guide
- [`docs/14-ports.md`](docs/14-ports.md) — unified port model reference
- [`docs/09-webview.md`](docs/09-webview.md) — bidirectional bridge
- [`docs/reference/schema.md`](docs/reference/schema.md) — `PluginPortsDef`
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md) — three new caps
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) — `presetList` event + iframe→host message table

**Examples:**

- [`examples/v40-mixer-pedal/`](examples/v40-mixer-pedal/) — 4-in 2-out
  stereo mixer pedal with webview faders demonstrating `paramWrite`.
- [`examples/v40-compressor-sc/`](examples/v40-compressor-sc/) —
  compressor with a dedicated sidechain input.
- [`examples/v40-cv-lfo/`](examples/v40-cv-lfo/) — utility pedal with
  a CV OUT demonstrating modulation into another plugin's `cutoff`.

---

## v3.5 — QoL pass: theme overrides + finish reserved features (2026-04)

A maintenance pass that cashes in four features previously reserved-for-v2,
reconciles the granular/wavetable param docs with the shipped worklets,
and adds the headline feature: per-plugin window theme overrides.

**New:**

- `ui.themeOverride` manifest field — partial override map (subset of the
  11 theme colour keys: `primary`, `primaryDim`, `primaryGlow`, `bg`,
  `bgElevated`, `text`, `textDim`, `border`, `scanline`, `highlightBg`,
  `highlightText`) applied as scoped CSS vars on the plugin's
  InstrumentWindow. Webview iframes receive the resolved theme via a new
  `themeChange` VoiceEngineEvent, re-posted whenever the global theme
  changes.
- Capability flag: `"themeOverride"`.
- `VoiceEngineEvent` union gains `themeChange` and `trackerEffect`
  variants.

**Finished features previously reserved-for-v2:**

- `forwardEffects: true` on webview controls now works — raw MOD
  effect-column bytes are forwarded to the iframe as
  `{ type: "trackerEffect", effectCode, value, time }` events.
- `acceptsAudioFrames: true` on webview controls now works — PCM audio
  posted from the iframe via `{ type: "__nt_audio", left, right? }` is
  routed through a host-side AudioWorklet sink into the instrument's
  output chain (so channel volume / pan / FX apply). Host sends
  `{ type: "__nt_audioInit", sampleRate }` at mount.
- LFO `sync: true` + `syncRate: "1/4"` (etc.) now actually follows host
  BPM.
- Granular `playbackMode: "pingpong"` and `"freeze"` now actually work —
  previously both silently fell through to `"forward"`.

**Documentation reconciled with code:**

- `06-instrument-graphs.md` granular/wavetable param tables now match
  the shipped worklets. Previously-documented names (`grainRate`,
  `grainDur`, `spread`, `frame`) never existed in code; actual params
  (`density`, `grainSize`, `scanRate`, `pan`, the four `*Jitter` knobs,
  `framePosition` in 0..1, `gain`) are now documented.
- `playbackMode` enum explicitly lists all four supported values.

**Authoring convention (optional, recommended):**

- Plugin-authored AudioWorklet processors can now post
  `{type: "__nt_error", where, message}` from a `try`/`catch` inside
  their `port.onmessage` handler to surface handler-side exceptions to
  the host. The host's error listener logs them and dispatches a
  `fi-worklet-error` DOM event. See
  [`docs/reference/worklet-protocol.md`](docs/reference/worklet-protocol.md#6a-surfacing-portonmessage-exceptions-v35)
  §6a. Processors that don't adopt the convention keep working exactly
  as before.

**No breaking changes.** All existing plugins load unchanged.

## v3.4 — webview UI control (2026-04)

Added the `webview` UI control type and the host↔iframe `postMessage`
bridge. Plugins can now embed arbitrary HTML/JS/WASM inside a
sandboxed iframe and receive tracker events as controller input.

**New:**

- `ui.controls[].type: "webview"` with fields:
  `source`, `aspectRatio`, `sandbox`, `forwardNotes`,
  `forwardParams`, `forwardEffects`, `acceptsAudioFrames`,
  `acceptsFocus`
- `LoadedPlugin.webviewAssets` map (host-internal)
- `VoiceEngineEvent` union: `noteOn` / `noteOff` / `param` /
  `pitch` / `gain` / `allNotesOff`
- Single-file HTML constraint enforced by loader regex — no sibling
  asset references allowed
- Capability flag: `"webview-ui"`

**Docs:** [`docs/09-webview.md`](docs/09-webview.md),
[`docs/10-wasm-in-webview.md`](docs/10-wasm-in-webview.md)

**Example:** [`examples/doom-wasm/`](examples/doom-wasm/) — full
DOOM-running-inside-a-plugin walkthrough

## v3.3 — modulation matrix + tracker effects

**New:**

- Multi-target modulation routing: `modRoutes[].targets[]` with
  per-target `depth` / `transform` / `slew` / `offset` / `scale` /
  `curve`
- Modulation transforms: `"none"` / `"invert"` / `"abs"` / `"square"` /
  `"unipolar"` / `"bipolar"`
- Per-target slew smoothing (single-pole lowpass)
- Envelope-follower pipeline via `transform: "abs"` + `slew` on any
  audio source (no dedicated node type needed)
- Tracker effect-column dispatch: `PluginVoiceEngine.applyTrackerEffect(code, value, time)`
- Capability flags: `"modMatrix-v3"`, `"trackerEffects-v3"`

## v3.2 — granular + wavetable nodes

**New:**

- `type: "granular"` graph node type with `sampleFile`,
  `playbackMode` (`"forward"|"reverse"|"pingpong"|"freeze"`),
  `grainEnvelope` (`"hann"|"triangle"|"rectangular"`)
- `type: "wavetable"` graph node type with `tableFile`, `frameCount`,
  `interpolation` (`"linear"|"none"`)
- Capability flags: `"granular"`, `"wavetable"`

## v3.1 — declarative instrument graphs + v3 worklet contract

**New:**

- `dsp.graph` on instrument plugins — full declarative per-voice DSP
  graph using the same node types and connection syntax as FX plugins
- Per-node `scope: "voice" | "shared"` — voice-scoped nodes
  instantiate per active note, shared-scoped nodes instantiate once
  per plugin
- Reserved modulation sources: `"velocity"`, `"note"`, `"gate"`,
  `"pitch"` — per-voice ConstantSources auto-created by the host
- `"follower:<nodeId>"` modulation source for cheap envelope-following
- `dsp.sharedNodes[]` — convenience list of node IDs to mark as shared
- `dsp.voiceInput` / `dsp.voiceOutput` — overridable reserved stub
  names (defaults `"voiceIn"` / `"voiceOut"`)
- `dsp.releaseTail` — max release tail seconds before the host
  force-cleans a voice (default 8)
- `dsp.worklet` whole-instrument form with `PluginWorkletInstrumentDef`:
  `processorName`, `numberOfInputs`, `numberOfOutputs`,
  `outputChannelCount[]`, `assets[]`, `initMessage`
- v3 MessagePort protocol: `init` / `loadAsset` / `noteOn` / `noteOff`
  / `allNotesOff` / `setPitch` / `setGain` / `param` / `dispose`
  messages with `voiceId` and `time` fields
- Auto-wired AudioParams (`pitch` / `gate` / `velocity` / `gain`) on
  `worklet` graph nodes
- Asset transfer via `Transferable` `Float32Array` buffers
- `parameterDescriptors` field on `worklet` graph nodes for
  soft-validated mirroring into `parameters[]`
- `top-level requires[]` and `dsp.requires[]` capability gating
- Capability flags: `"graph"`, `"worklet-v3"`

**Docs:** [`docs/reference/worklet-protocol.md`](docs/reference/worklet-protocol.md)

## v2 — modulation, v2 node types, UI extensions

A significant expansion of the declarative DSP system and the UI
control palette. Most of the in-tracker shipping plugins are v2.

**New:**

- FX graph node types: `mixer`, `splitter`, `merger`, `oscillator`,
  `constant`, `analyser`, `lfo`, `envelope`
- Modulation routing (single-target v2 form): `modRoutes[]` with
  `source` / `target` / `depth` / `bipolar`
- Audio-rate modulation via `connections[].toParam`
- Channel-aware splitter/merger via `outputIndex` / `inputIndex`
- Multi-stage envelope stages: `envStages[]` on `envelope` nodes
- Additional instrument DSP fields: `envelopes[]` (named named
  multi-stage envelopes), `lfos[]` (per-voice LFOs), `modRoutes[]`,
  additional `filters[]` stages in series, `unison` voice spreading,
  `portamento` pitch glide, `noiseType` for built-in noise
- FM synthesis on oscillators: `fmTarget` + `fmDepth`
- Parameter fields: `group` (cosmetic hint), `curve` (UI value
  mapping)
- UI control types: `xy_pad`, `envelope_editor`, `meter`, `label`,
  `group` (recursive container)
- Factory presets: top-level `presets[]` with
  `name` + `values: Record<key, number>`
- `PluginUiDef`: `accentColor`, `minWidth`, `minHeight`
- Parsing of sample zone fields: `startOffset`, `duration`

## v1 — the original spec

The initial declarative plugin format.

**Core shapes:**

- `PluginManifest`: `name`, `version`, `type`, `author?`, `description?`
- `PluginParamDef`: `key`, `label`, `min`, `max`, `default`, `step`,
  `unit?`, `displayDecimals?`
- `PluginFxDsp`: `processorName`, `nodes[]`, `connections[]`
- `PluginInstrumentDsp`: `processorName`, `voices`, `voiceStealing`,
  `oscillators[]`, `samples[]`, `envelope`, `filter`
- `PluginUiDef`: `layout`, `controls[]`
- `PluginUiControl`: `type` in `knob`/`slider`/`toggle`/`select`/
  `number`/`waveform_view`
- FX graph node types: `gain`, `delay`, `biquad`, `compressor`,
  `convolver`, `panner`, `waveshaper`, `worklet`
- Sample zones with `keyRange` / `velocityRange` / `loop` fields
- AudioWorklet processor loading from `script.js` at archive root
- Standard ADSR envelopes
- Loop presets (`loopPresets[]`) for instrument sample sequencers

**AudioWorklet contract (legacy form):** `dsp.processorName` names
the worklet, `script.js` registers it via `registerProcessor`, the
host sends `noteOn` / `noteOff` / `allNotesOff` / `param` messages via
`this.port.onmessage`.

---

## Compatibility guarantees

- **Forward**: a v2 host loads v1 plugins unchanged. A v3 host loads
  v1 and v2 plugins unchanged. This is a design commitment — the
  loader has explicit code paths for each schema version and legacy
  plugins are never silently broken.
- **Backward**: a v1 host does NOT load v2 or v3 plugins — newer
  features are silently ignored and audio may be wrong. This is why
  the capability flag system exists — plugins that use newer features
  must declare them in `requires[]` so older hosts refuse to load
  the plugin rather than produce garbage output.

## Upgrading a plugin to a higher schema version

You rarely need to. The only reasons to bump:

- You want to use a new feature (e.g. the webview control → v3)
- You want to clean up from an old form (e.g. migrate a v1 instrument
  with only a fixed filter to v2 `filters[]` for a series filter chain)

Nothing forces an upgrade. A v1 plugin you shipped three years ago
still works in a v3 host and will keep working.

## See also

- [`README.md`](README.md) — SDK entry point
- [`docs/01-plugin-format.md`](docs/01-plugin-format.md) — schema
  version narrative
- [`docs/reference/schema.md`](docs/reference/schema.md) — dense
  field reference
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md) —
  capability flag reference
