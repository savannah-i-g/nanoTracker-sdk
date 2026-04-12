<p align="center">
  <img src="resources/nanoTrackerToolsIcon-512.png" alt="nanoTracker Plugin SDK" width="180">
</p>

<h1 align="center">nanoTracker Plugin SDK</h1>

Everything you need to author, package, validate, and ship plugins for
**nanoTracker** — a MOD-style canvas-based tracker built around a
first-class plugin system.

Plugins come in two flavours:

- **Instruments** (`.ntins`) — synths, samplers, drum machines,
  whatever-else-runs-DOOM. Play them from tracker channels.
- **FX** (`.ntsfx`) — effects processors that sit on the mixer chain.

Both are ZIP archives containing a `plugin.json` manifest plus (optional)
`script.js` AudioWorklet code, `samples/*.wav` files, and — new in v3 —
`web/*.html` files embedded as sandboxed iframes via the `webview`
control. The tracker loads them at runtime via drag-and-drop.

---

## 5-minute quickstart

```bash
# 1. Copy a template
cp -r plugin-sdk/templates/webview my-plugin
cd my-plugin

# 2. Edit plugin.json and web/index.html however you want

# 3. Validate (catches schema errors before you ship)
node ../plugin-sdk/tools/ntvalidate.mjs .

# 4. Package into a .ntins archive
node ../plugin-sdk/tools/ntpack.mjs . --out my-plugin.ntins

# 5. Drag my-plugin.ntins into the tracker's PLUGINS panel
```

That's the whole loop. Everything else in this SDK is details.

---

## Where to go next

**New to the SDK?** Start here:

1. [`docs/00-getting-started.md`](docs/00-getting-started.md) —
   your first plugin, end to end, in about 5 minutes
2. [`docs/01-plugin-format.md`](docs/01-plugin-format.md) —
   the archive layout, schema versions (v1/v2/v3), capability flags

**Building an instrument?**

- [`docs/02-parameters.md`](docs/02-parameters.md) —
  knobs, sliders, curves, groups, presets
- [`docs/03-ui-controls.md`](docs/03-ui-controls.md) —
  every UI control type (`knob`, `slider`, `xy_pad`, `envelope_editor`,
  `meter`, `group`, `webview`, …)
- [`docs/04-instruments.md`](docs/04-instruments.md) —
  samples, oscillators, envelopes, LFOs, unison, portamento,
  voice stealing
- [`docs/06-instrument-graphs.md`](docs/06-instrument-graphs.md) —
  v3 per-voice declarative DSP graphs, reserved modulation sources

**Building an FX?**

- [`docs/05-fx-graphs.md`](docs/05-fx-graphs.md) —
  declarative FX: nodes, connections, modulation routing

**Writing AudioWorklet code?**

- [`docs/07-audioworklets.md`](docs/07-audioworklets.md) —
  v1/v2 FX + instrument processor contracts
- [`docs/08-worklet-v3.md`](docs/08-worklet-v3.md) —
  v3 MessagePort protocol, auto-wired AudioParams, asset transfer

**Embedding HTML or WebAssembly?**

- [`docs/09-webview.md`](docs/09-webview.md) —
  the `webview` control: `postMessage` bridge, sandbox rules,
  the single-file HTML constraint
- [`docs/10-wasm-in-webview.md`](docs/10-wasm-in-webview.md) —
  ★ the DOOM walkthrough: how to embed a WebAssembly binary inside
  a webview plugin, with a fully-worked example at
  [`examples/doom-wasm/`](examples/doom-wasm/)

**Shipping a plugin?**

- [`docs/11-packaging.md`](docs/11-packaging.md) —
  what goes in a `.ntins`, how to use `ntpack` and `ntvalidate`
- [`tools/README.md`](tools/README.md) —
  CLI reference for the build tools

**Looking up a specific field?**

- [`docs/reference/schema.md`](docs/reference/schema.md) —
  dense every-field reference for `plugin.json`
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) —
  `VoiceEngineEvent` shapes posted to webview iframes
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md) —
  every flag in `HOST_CAPABILITIES` and what it gates
- [`docs/reference/worklet-protocol.md`](docs/reference/worklet-protocol.md) —
  v3 MessagePort host↔processor message types

---

## Folder map

```
plugin-sdk/
├── README.md              you are here
├── CHANGELOG.md           plugin spec version history (v1 → v2 → v3)
│
├── docs/                  narrative documentation (hand-written)
│   ├── 00-getting-started.md
│   ├── 01-plugin-format.md
│   ├── 02-parameters.md
│   ├── 03-ui-controls.md
│   ├── 04-instruments.md
│   ├── 05-fx-graphs.md
│   ├── 06-instrument-graphs.md
│   ├── 07-audioworklets.md
│   ├── 08-worklet-v3.md
│   ├── 09-webview.md
│   ├── 10-wasm-in-webview.md     ★ DOOM walkthrough
│   ├── 11-packaging.md
│   └── reference/                dense field-by-field reference
│       ├── schema.md
│       ├── event-bus.md
│       ├── host-capabilities.md
│       └── worklet-protocol.md
│
├── tools/                 zero-dependency Node CLIs
│   ├── package.json
│   ├── ntpack.mjs                zip a source dir into .ntins
│   ├── ntvalidate.mjs            lint a plugin.json
│   ├── lib/
│   │   ├── schema.json           hand-written JSON Schema
│   │   └── validate.mjs          shared helpers, webview pre-flight
│   └── README.md
│
├── templates/             copy-to-start starter plugins
│   ├── instrument-sampler/       sample-based instrument
│   ├── instrument-worklet/       AudioWorklet voice processor
│   ├── fx-graph/                 declarative FX
│   └── webview/                  minimal webview control
│
└── examples/              fully-worked larger examples
    └── doom-wasm/                ★ DOOM as a plugin (GPL-2.0)
        ├── plugin.json
        ├── src/template.html
        ├── src/bundle.mjs
        ├── CREDITS.md
        ├── LICENSE
        └── README.md
```

---

## What this SDK is, and isn't

This is the **authoring spec and toolchain** for nanoTracker plugins.
It contains everything you need to design, package, validate, and
ship a `.ntins` / `.ntsfx` archive that the tracker will load at
runtime:

- a complete narrative reference for the plugin format
- four copy-to-start templates (sampler, worklet, declarative FX,
  webview)
- two Node CLIs (`ntpack`, `ntvalidate`) with zero ceremony
- a fully worked large-scale example (DOOM as a webview plugin)

It is **not** the tracker itself. You don't need to build or run the
tracker to build a plugin — this repository stands alone. Clone it,
install the tool dependencies, and you're done.

The docs in `docs/` are the authoritative specification of what a
valid plugin looks like. When something behaves differently than
these docs describe, that's a bug — please file an issue.

---

## Prerequisites

- Node.js 18 or later (we use ESM, `fs/promises`, `node:path`)
- `npm install` once inside `plugin-sdk/tools/` to pull `jszip` + `ajv`
- Any text editor — the SDK has no IDE-specific tooling

You do **not** need the full tracker app cloned to build plugins with
this SDK — just this folder. The tracker is only required for the final
"drag the .ntins in and play it" step.

---

## Licensing

This SDK's documentation, CLIs, and templates are released under the
same terms as the parent nanoTracker project (see the repository root
for the license file).

**Individual examples may have their own licenses.** In particular,
[`examples/doom-wasm/`](examples/doom-wasm/) is GPL-2.0 because it
statically links id Software's Doom via Jacob Enget's
[`doom.wasm`](https://github.com/jacobenget/doom.wasm) port. See
[`examples/doom-wasm/CREDITS.md`](examples/doom-wasm/CREDITS.md) for
the full attribution and licensing story.

Plugins *you* build with this SDK can be any license you want —
GPL contagion only applies if you actually link against GPL code
(as the DOOM example does). A plugin that only uses templates and
the built-in nanoTracker DSP nodes inherits nothing.
