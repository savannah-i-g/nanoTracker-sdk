# nanoTracker plugin SDK — agent orientation

The full guide is [`CLAUDE.md`](./CLAUDE.md). This file is the
Codex / Cursor / Aider / OpenAI-Codex convergent convention with the
must-know rules. Read it before scaffolding a plugin.

## You're helping someone author a plugin for nanoTracker

A browser-based MOD/XM-style music tracker. Plugins are JSON
manifests + optional WAV samples / single-file webview HTML / custom
AudioWorklets, packed into `.ntins` (instrument) or `.ntsfx`
(FX/pedal) archives.

## Hard rules (loader rejects on violation)

1. **`type: "fx"` at v4+ MUST declare `pedal-v4`** in `requires[]`
   AND populate `ports.inputs[]` AND `ports.outputs[]`.
2. **`ports` block requires the `portsV4` capability.**
3. **CV input ports MUST declare `target: "<nodeId>.<paramName>"`.**
4. **Webview controls with any `accepts*` write flag** require
   `webview-writes` in `requires[]`.
5. **Webview HTML must be single-file** — no external `<script src>`,
   `<link href>`, or ES module imports. Inline everything.
6. **Theme override requires the `themeOverride` capability.**

## Note / velocity are MIDI 0–127 (not normalized)

Every `note` and `velocity` the host sends — in worklet messages,
webview bridge events, legacy v3 entry points, and sample zones
(`rootKey`, `velocityRange`) — is a **MIDI integer 0–127**. Not 0..1.
Not Hz.

- `note: 60` = middle C; `note: 69` = A4
- `velocity: 127` = loudest; divide by 127 if you want a 0..1 gain
- `frequency` is pre-computed by the host — use it directly, don't
  treat `note` as Hz

The loader does NOT validate this — it's the most common authoring
mistake. Assuming `velocity` is already normalized makes instruments
play 127× too quiet or clip into oblivion.

## Default to v4

`schemaVersion: 4` for new plugins. v1–v3 still loads but is legacy.
v3 FX plugins get auto-migrated to v4 pedals at project load — don't
author new ones.

## Minimal v4 pedal

```jsonc
{
  "schemaVersion": 4,
  "manifest": { "name": "MY PEDAL", "version": "1.0.0", "type": "fx" },
  "requires": ["pedal-v4", "portsV4", "graph"],
  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
  },
  "parameters": [/* ... */],
  "dsp": {
    "processorName": null,
    "nodes":       [/* ... */],
    "connections": [
      { "from": "port:in",  "to": "<your-first-node>" },
      { "from": "<your-last-node>", "to": "port:out" }
    ]
  }
}
```

## Authoring loop

```bash
node tools/ntvalidate.mjs <plugin-dir>          # validate
node tools/ntpack.mjs <plugin-dir> --out <n>.ntsfx
```

## Where to look

| Topic | File |
|---|---|
| First plugin | [`docs/00-getting-started.md`](docs/00-getting-started.md) |
| Pedals (v4) | [`docs/13-pedals.md`](docs/13-pedals.md) |
| Typed ports (v4) | [`docs/14-ports.md`](docs/14-ports.md) |
| Webview UI | [`docs/09-webview.md`](docs/09-webview.md) |
| Every manifest field | [`docs/reference/schema.md`](docs/reference/schema.md) |
| Capability flags | [`docs/reference/host-capabilities.md`](docs/reference/host-capabilities.md) |
| Event bus (webview) | [`docs/reference/event-bus.md`](docs/reference/event-bus.md) |
| Worked examples | [`examples/v40-mixer-pedal/`](examples/v40-mixer-pedal/), [`examples/v40-compressor-sc/`](examples/v40-compressor-sc/), [`examples/v40-cv-lfo/`](examples/v40-cv-lfo/) |

Detailed guidance + skills for AI assistants:

- [`CLAUDE.md`](./CLAUDE.md) — full plugin authoring orientation
- [`.claude/skills/`](./.claude/skills/) — Anthropic Claude
- [`.hermes/skills/`](./.hermes/skills/) — Nous Research Hermes
  Agents
- [`.agents/skills/`](./.agents/skills/) — OpenAI Codex (and other
  agentskills.io-compatible agents)
- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md)
  — GitHub Copilot pointer

The skill bodies are identical across the three agent folders; only
frontmatter / sidecars differ. Pick the folder matching your agent.
