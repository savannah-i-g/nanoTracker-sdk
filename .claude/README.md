# `.claude/` — agent assets for the nanoTracker plugin SDK

Structured assets that AI coding assistants (Claude, Codex, Cursor,
Aider, Copilot, etc.) load when helping someone author a nanoTracker
plugin.

## Layout

```
.claude/
├── README.md                ← this file
├── skills/                  ← invocable Skills (codified workflows)
│   ├── scaffold-pedal/SKILL.md
│   ├── scaffold-instrument/SKILL.md
│   ├── scaffold-webview-pedal/SKILL.md
│   └── migrate-v3-to-v4/SKILL.md
└── commands/                ← slash commands for common tasks
    ├── validate.md
    ├── pack.md
    └── lint.md
```

## Skills

Each skill captures the "do it the right way the first time"
knowledge for a common authoring task — including the v4 hard rules
the loader enforces, sensible defaults for capability flags, and
links into the spec docs.

| Skill | Use it when… |
|---|---|
| `scaffold-pedal` | Authoring a new v4 pedal (FX plugin) from scratch |
| `scaffold-instrument` | Authoring a new instrument plugin (sample-based, oscillator, or v3 declarative graph) |
| `scaffold-webview-pedal` | Authoring a pedal whose UI is a custom HTML/JS surface (mixer faders, XY pads, oscilloscopes, …) |
| `migrate-v3-to-v4` | Upgrading a legacy `type:"fx"` plugin to a v4 pedal manifest |

Invoke a skill via the `Skill` tool with the slug, e.g.
`Skill(skill: "scaffold-pedal")`.

## Slash commands

| Command | Runs |
|---|---|
| `/validate` | `node tools/ntvalidate.mjs <plugin-dir>` |
| `/pack` | `node tools/ntpack.mjs <plugin-dir> --out <archive>` |
| `/lint` | `/validate` in `--quiet` mode (CI-friendly) |

## See also

- [`../CLAUDE.md`](../CLAUDE.md) — full Claude orientation for plugin
  authoring
- [`../AGENTS.md`](../AGENTS.md) — terse must-know rules (Codex /
  Cursor / Aider all read this filename)
- [`../.github/copilot-instructions.md`](../.github/copilot-instructions.md)
  — pointer for GitHub Copilot
- [`../docs/`](../docs/) — full spec narrative + reference

## Authoring meta

If you find a bug or doc gap while using these assets, file an issue
on the SDK repo. The skills are meant to evolve alongside the spec —
when v4.x adds a new feature (gate inputs for declarative graphs,
presetSave persistence, hostCommand dispatcher…) the relevant skill
should be updated to cover it.
