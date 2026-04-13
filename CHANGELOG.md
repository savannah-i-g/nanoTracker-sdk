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
