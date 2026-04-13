# nanoTracker plugin SDK — Claude orientation

You're helping a user author a plugin for **nanoTracker**, a
browser-based MOD/XM-style music tracker. This file gives you the
context you need to write a correct plugin without grepping the
codebase from scratch.

## What you can build

Plugins are authored as JSON manifests (+ optional WAV samples,
single-file HTML for webview UIs, custom AudioWorklet processors)
and packed into `.ntins` (instrument) or `.ntsfx` (FX/pedal)
archives.

Three kinds, roughly:

| Kind | `manifest.type` | What it is |
|---|---|---|
| **Instrument** | `"instrument"` | Plays notes; appears as a workspace floating window OR a tracker MOD-style instrument with sample pads |
| **Pedal** (v4) | `"fx"` | Audio processor (or utility, mixer, CV source…). Floating window with patch-cable jacks; lives in the workspace |
| **(Legacy FX)** | `"fx"` (v1–v3) | Old mixer-module shape — **don't author new ones**. The host auto-migrates existing v1–v3 FX to pedals at project load |

## Spec versions in play

- **v4.0** (current) — typed ports, pedals, bidirectional webview
  bridge, capability-gated extensions
- v3.5, v3.4, v3.3, …, v1 — older versions still load. New plugins
  should target v4 unless you have a reason

`schemaVersion: 4` is the right default for new work.

## Hard rules (the loader enforces these)

1. **`type: "fx"` at v4+ MUST declare `pedal-v4` in `requires[]`** and a
   non-empty `ports.inputs[]` AND `ports.outputs[]`. The loader
   rejects v4 fx plugins missing either.
2. **`ports` block requires the `portsV4` capability.**
3. **CV input ports MUST declare a `target: "<nodeId>.<paramName>"`.**
4. **Webview controls with `accepts*` write flags require
   `webview-writes` capability** at the top-level `requires[]`.
5. **Webview HTML must be single-file** — no external `<script src>`,
   `<link href>`, or ES module imports. Inline everything (use
   `vite-plugin-singlefile`, `esbuild --bundle`, or hand-author).
6. **Theme override requires the `themeOverride` capability.**

`ntvalidate` catches every one of these at pack-time.

## v4 pedal essentials

```jsonc
{
  "schemaVersion": 4,
  "manifest": {
    "name":    "MY PEDAL",
    "version": "1.0.0",
    "type":    "fx",
    "description": "..."
  },
  "requires": ["pedal-v4", "portsV4", "graph"],
  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
  },
  "parameters": [ /* PluginParamDef[] */ ],
  "dsp": {
    "processorName": null,
    "nodes": [ /* PluginDspNode[] */ ],
    "connections": [
      { "from": "port:in", "to": "your-first-node" },
      { "from": "your-last-node", "to": "port:out" }
    ]
  }
}
```

Use `port:<id>` references in connections — the host creates one
shared `GainNode` per referenced port id and resolves the wiring
transparently. Legacy `instrumentIn` / `output` shortcuts still work
for single-port pedals.

## Port kinds

| Kind | Wire | Use for |
|---|---|---|
| `audio` | standard `srcNode.connect(dstNode)` | Normal audio signal |
| `sidechain` | electrically same as audio, dashed jack | Compressor key, vocoder formant, ducker trigger |
| `cv` | `srcNode.connect(targetParam)` | Audio-rate control of an `AudioParam`. Requires `target` |
| `gate` | host-side edge watcher around 0.5 | Boolean trigger. **v4.0 caveat:** gate INPUT only works for worklet plugins; declarative graphs should use `kind:"audio"` and threshold internally |

Compatibility matrix in [`docs/14-ports.md`](docs/14-ports.md).

## Webview UI

For custom HTML/JS UIs (mixer faders, XY pads, oscilloscopes…):

```jsonc
"requires": ["pedal-v4", "portsV4", "graph", "webview-ui", "webview-writes"],
"ui": {
  "controls": [{
    "type": "webview",
    "source": "web/ui.html",
    "aspectRatio": "4/3",
    "acceptsParamWrites": true
  }]
}
```

Bidirectional bridge messages:

```js
// host → iframe (always available)
case "noteOn":     /* ev.note, ev.velocity, ev.time */ break;
case "noteOff":    /* ev.note, ev.time */               break;
case "param":      /* ev.key, ev.value */               break;
case "themeChange":/* ev.theme — 11-key colour set */   break;
case "presetList": /* ev.presets (v4, on mount) */      break;

// iframe → host (v4, requires webview-writes + per-control accepts*)
window.parent.postMessage({ type: "__nt_ready" }, "*");
window.parent.postMessage({ type: "paramWrite", key: "cutoff", value: 2400 }, "*");
window.parent.postMessage({ type: "noteOn",     note: 60, velocity: 100 },     "*");
window.parent.postMessage({ type: "presetLoad", presetId: "preset-0" },        "*");
```

Validation is automatic — invalid writes drop with an `__nt_error`
back into the iframe. v4.0 status matrix lives in
[`docs/09-webview.md`](docs/09-webview.md#v40-implementation-status).

## Workspace topology (mental model)

Every project has two host-supplied **pseudo-instruments** users wire
your pedal between:

```
TRACKER BUS                  your pedal              MASTER IN
[CH01 OUT]●─── cable ──→[● IN  OUT ●]─── cable ──→[● MAIN]
[CH02 OUT]●                                         ─→ master bus
[...]
```

You don't author them — they exist for every project. Reference them
in your README's "wiring example" section.

## Authoring loop

```bash
# Validate (catches every spec rule)
node tools/ntvalidate.mjs <plugin-dir>

# Pack into .ntsfx (FX/pedal) or .ntins (instrument)
node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx
```

Then in the tracker: PLUGIN MANAGER → `+ LOAD PLUGIN` → pick the
archive → `+ ADD TO WS` → drag cables.

## Skills available in `.claude/skills/`

- `scaffold-pedal` — scaffold a v4 pedal with the right manifest +
  capability flags + port shape
- `scaffold-instrument` — scaffold a v3/v4 instrument plugin (sample
  zones, oscillators, or graph engine)
- `scaffold-webview-pedal` — scaffold a pedal with an interactive
  webview UI (paramWrite-driven)
- `add-webview` — add a webview UI to an existing instrument or
  pedal
- `add-theme-override` — add a per-plugin colour palette
- `migrate-v3-to-v4` — walk a legacy FX plugin through the v4 pedal
  rewrite

The same skill set is mirrored for other agents:

- [`.hermes/skills/`](.hermes/skills/) — Nous Research Hermes
  Agents (Hermes-format frontmatter)
- [`.agents/skills/`](.agents/skills/) — OpenAI Codex (and any
  agent that follows the agentskills.io standard;
  `agents/openai.yaml` sidecars supply Codex-specific UI metadata)

The SKILL.md bodies are intentionally identical across all three
folders — only frontmatter / sidecars differ.

## Slash commands

- `/validate` — `ntvalidate` the current plugin folder
- `/pack` — pack into `.ntsfx` / `.ntins`
- `/lint` — alias for `/validate --quiet`

## Reference docs

- [`docs/00-getting-started.md`](docs/00-getting-started.md) — first
  plugin walkthrough
- [`docs/01-plugin-format.md`](docs/01-plugin-format.md) — manifest
  narrative
- [`docs/13-pedals.md`](docs/13-pedals.md) — full pedal authoring
  guide
- [`docs/14-ports.md`](docs/14-ports.md) — unified typed port model
- [`docs/09-webview.md`](docs/09-webview.md) — webview control +
  bidirectional bridge
- [`docs/reference/schema.md`](docs/reference/schema.md) — every
  field of every block
- [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md)
  — every capability flag + when to declare it
- [`docs/reference/event-bus.md`](docs/reference/event-bus.md) —
  webview event reference
- [`CHANGELOG.md`](CHANGELOG.md) — schema version history

## Things to ask the user before doing

- Whether their plugin is supposed to work on older host versions
  (most aren't — defaulting to v4 is correct)
- Whether they want a webview UI vs the built-in `knob` /
  `slider` / `xy_pad` controls (built-ins are simpler)
- Whether their FX plugin should be a pedal (workspace, multi-port,
  cabled — the v4 default) or, if it really must, fall back to a
  v3 mixer-module shape (legacy compatibility only — discouraged)
