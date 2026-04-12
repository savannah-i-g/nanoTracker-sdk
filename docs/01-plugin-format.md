# Plugin format: archives, schema versions, capability flags

A nanoTracker plugin is a ZIP archive with one required file
(`plugin.json`) and an extension that tells the host whether it's an
**instrument** (`.ntins`) or an **FX** (`.ntsfx`). That's the whole
format — no proprietary wrapper, no signed manifest, no registry. Pop
any plugin open with `unzip` and you'll see what it contains.

## Archive layout

```
my-plugin.ntins
├── plugin.json      ← required, the manifest
├── script.js        ← optional, AudioWorklet processor code
├── samples/         ← optional, audio files referenced from plugin.json
│   ├── kick.wav
│   └── ir.flac
└── web/             ← optional (v3), webview HTML files
    └── index.html
```

Extra directories and files are allowed but ignored by the host — use
them for READMEs, licensing, changelogs, whatever. The loader only
reads the paths it knows about.

- **`plugin.json`** — manifest + DSP graph + UI + parameters. Always at
  the archive root. The loader throws if it's missing.
- **`script.js`** — optional AudioWorklet processor. Required only if
  your `dsp.processorName` (or `dsp.worklet.processorName` in v3) is
  non-null. Loaded via
  [`AudioWorklet.addModule`](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet/addModule)
  at plugin-load time. See [`07-audioworklets.md`](07-audioworklets.md).
- **`samples/*`** — audio files referenced from:
  - instrument `dsp.samples[].file` (sample zones)
  - FX convolver `impulse` paths
  - v3 graph node `sampleFile` (granular) / `tableFile` (wavetable)
  - Anywhere in the archive is fine, but `samples/` is convention.
  Decoded via `AudioContext.decodeAudioData` so WAV / FLAC / OGG /
  anything else browsers decode natively works.
- **`web/*.html`** — v3 webview control source files, referenced from
  `ui.controls[type=webview].source`. Must be **single-file HTML** —
  see [`09-webview.md`](09-webview.md).

## The manifest block

`plugin.json` starts with a schema version and a manifest:

```json
{
  "schemaVersion": 3,
  "manifest": {
    "name": "SUPERSAW",
    "version": "1.2.0",
    "type": "instrument",
    "author": "you",
    "description": "7-voice unison detune pad"
  },
  "requires": ["webview-ui"],
  "parameters": [ /* ... */ ],
  "dsp":        { /* ... */ },
  "ui":         { /* ... */ }
}
```

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | yes | 1, 2, or 3. See "Schema versions" below. |
| `manifest.name` | yes | Display name. Goes into `id = "plugin:<name>@<version>"`. |
| `manifest.version` | yes | Free-form string; convention is semver. |
| `manifest.type` | yes | `"instrument"` or `"fx"`. Decides how the loader routes the DSP block. |
| `manifest.author` | no | Attribution — shows in plugin panels. |
| `manifest.description` | no | One-line summary. |
| `requires` | no | Array of capability flag strings. See "Capabilities" below. |
| `parameters` | no | Array of `PluginParamDef`. See [`02-parameters.md`](02-parameters.md). |
| `dsp` | yes | Instrument or FX DSP block. See [`04-instruments.md`](04-instruments.md) / [`05-fx-graphs.md`](05-fx-graphs.md). |
| `ui` | no | UI control definition. See [`03-ui-controls.md`](03-ui-controls.md). |
| `loopPresets` | no | Instrument-only; step sequences exposed in the instrument panel. |
| `presets` | no | Factory parameter snapshots; exposed as a dropdown. |

Unknown fields are **silently ignored** by the loader. Typos in field
names won't error — they'll just have no effect. Run
[`ntvalidate`](../tools/README.md) to catch typos before you ship.

## Schema versions

nanoTracker plugin spec versions are additive — a v3 host loads v1,
v2, and v3 plugins interchangeably. Higher versions unlock more
features; you pick the lowest version you actually need.

### v1 — the original

- Single DSP block per type: `PluginFxDsp` for FX, `PluginInstrumentDsp`
  for instruments
- FX node types: `gain`, `delay`, `biquad`, `compressor`, `convolver`,
  `panner`, `waveshaper`, `worklet`
- Instrument DSP: `voices`, `voiceStealing`, `oscillators`, `samples`,
  `envelope`, `filter`
- UI controls: `knob`, `slider`, `toggle`, `select`, `number`,
  `waveform_view`
- Factory presets exposed as `"presets": [...]`

Pick v1 only for the simplest possible FX or for back-compat testing.
v2 is a strict superset and adds a lot of useful primitives with zero
ceremony cost.

### v2 — modulation and UI additions

- **FX node types added:** `mixer`, `splitter`, `merger`, `oscillator`,
  `constant`, `analyser`, `lfo`, `envelope`
- **Modulation routing:** `modRoutes[]` with single-target `source` +
  `target` + `depth` + `bipolar`
- **Instrument additions:** named `envelopes[]`, per-voice `lfos[]`,
  `modRoutes[]`, additional filter stages, `unison`, `portamento`,
  `noiseType`
- **UI controls added:** `xy_pad`, `envelope_editor`, `meter`, `label`,
  `group`
- **Parameter additions:** `group`, `curve: "linear"|"exponential"|"logarithmic"`
- **Instrument definition:** `fmTarget` / `fmDepth` on oscillators for
  FM synthesis
- **Factory presets** (`presets[]`) formally added

Most of the shipping in-tracker plugins are v2. It's the sweet spot
for "write DSP declaratively without needing AudioWorklet code."

### v3 — graph engine, webview, worklet contract

- **v3 declarative instrument graph** (`dsp.graph`): full per-voice
  modular DSP graph instead of the fixed oscillators-samples-envelope-filter
  pipeline
- **Graph node scope:** `scope: "voice" | "shared"` decides whether a
  node is instantiated per active note or once per plugin instance
- **v3 graph node types added:** `granular`, `wavetable` (host-shipped
  AudioWorklets)
- **v3 modulation routing:** multi-target `modRoutes[].targets[]` with
  per-target `transform` (`"none"|"invert"|"abs"|"square"|"unipolar"|"bipolar"`),
  `slew`, `offset`, `scale`, `curve`
- **Reserved modulation sources:** `velocity`, `note`, `gate`, `pitch`
  are auto-wired ConstantSources available to any modRoute
- **v3 worklet contract:** `dsp.worklet.processorName` whole-instrument
  form; `parameterDescriptors` mirroring; auto-wired `pitch`/`gate`/
  `velocity`/`gain` AudioParams
- **Webview control** (`type: "webview"`): sandboxed iframe with a
  `postMessage` bridge for tracker events
- **Capability flags** (`requires[]`) for gating v3 features

Use v3 when you want a custom per-voice signal chain, need granular or
wavetable synthesis, want to embed HTML/WASM via webview, or want your
worklet processor to integrate cleanly with the tracker effect system.

### Choosing a version

The safest strategy: pick the lowest version that supports every
feature you use, then write that version into `schemaVersion`. The
loader uses `schemaVersion` to decide which fields to parse — v3-only
fields are silently ignored on a v2 plugin, for example.

If you're not sure: use v3 and declare capability flags explicitly.
v3 hosts accept every earlier version anyway, so there's no downside
to starting at the top.

## Capability flags (`requires[]`)

`requires[]` is the plugin's way of saying "I will not load if the
host is missing feature X." The loader checks each entry against
the host's supported-capability set and throws at load time if any
required flag is unsupported. Full list:

| Flag | Gates |
|---|---|
| `graph` | v3 declarative instrument graph engine (`dsp.graph`) |
| `worklet-v3` | v3 instrument worklet contract (`dsp.worklet`) |
| `granular` | host-shipped granular AudioWorklet node type |
| `wavetable` | host-shipped wavetable AudioWorklet node type |
| `modMatrix-v3` | v3 multi-target modulation routing |
| `trackerEffects-v3` | tracker effect-column dispatch to plugins |
| `webview-ui` | v3 `webview` UI control |

Declaring a flag you use is **not optional** — it's the only way the
loader knows to refuse to load your plugin on an older host that
would silently ignore the feature and play garbage. `ntvalidate`
checks this and fails if, e.g., your plugin has a `webview` control
but no `"webview-ui"` in `requires[]`.

See [`reference/host-capabilities.md`](reference/host-capabilities.md)
for the authoritative per-flag reference.

## Archive construction

Use [`ntpack`](../tools/README.md) — the SDK's CLI does the right
thing: runs pre-flight validation, walks the source directory
applying sensible exclusions, emits a deflate-compressed ZIP with the
right extension.

```bash
node plugin-sdk/tools/ntpack.mjs my-plugin
# → my-plugin.ntins (instrument)  or  my-plugin.ntsfx (FX)
```

You can also pack by hand with plain `zip`:

```bash
cd my-plugin
zip -r ../my-plugin.ntins plugin.json script.js samples/ web/
```

Both are legal. `ntpack` catches common authoring mistakes; `zip`
doesn't. Use `ntpack` as your default and fall back to `zip` only if
you need something `ntpack` doesn't support (and please file a bug).

## What the host does with your archive at load time

Rough sequence:

1. Unzip to memory (no disk writes)
2. Read `plugin.json`, check `schemaVersion`
3. Validate `requires[]` against the host's supported capabilities —
   fail loud if any flag is unsupported
4. Parse the manifest, parameters, DSP block, UI block
5. Decode every referenced sample file via `AudioContext.decodeAudioData`
   (warns, doesn't fail, if any single sample fails to decode)
6. If `processorName` is set, load `script.js` via
   `AudioWorklet.addModule` (tries `blob:` URL first, falls back to
   `data:` URI if the parent CSP blocks blob)
7. For every webview control, read the referenced HTML, run the
   single-file regex check, wrap in a `Blob`, create a `blob:` URL,
   store on `LoadedPlugin.webviewAssets`
8. Return a `LoadedPlugin` and register it in the runtime plugin
   registry

If any step fails, the whole plugin is rejected with a console error
pointing at the offending field or file path. Plugins never load
"partially" — you either get a working `LoadedPlugin` or nothing.

## See also

- [`00-getting-started.md`](00-getting-started.md) — your first plugin
- [`02-parameters.md`](02-parameters.md) — the parameters block
- [`03-ui-controls.md`](03-ui-controls.md) — UI control types
- [`04-instruments.md`](04-instruments.md) — instrument DSP
- [`05-fx-graphs.md`](05-fx-graphs.md) — FX declarative graphs
- [`11-packaging.md`](11-packaging.md) — packaging and distribution
- [`reference/schema.md`](reference/schema.md) — every `plugin.json`
  field in one place
- [`reference/host-capabilities.md`](reference/host-capabilities.md) —
  full capability flag table
