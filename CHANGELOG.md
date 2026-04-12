# Plugin spec changelog

Version history for the nanoTracker plugin format. Each row describes
what landed in that schema version. Features added to a higher version
are **additive** — a v3 host accepts v1 / v2 / v3 plugins
interchangeably, and a v1 plugin you shipped three years ago still
works today.

This is the authoring-side view. For the host-side implementation
history, see `git log` in the main repo.

---

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
