# `.agents/` — agent assets for OpenAI Codex (and agentskills.io-compatible agents)

[OpenAI Codex](https://developers.openai.com/codex/skills) skill
assets for the nanoTracker plugin SDK. This folder uses the
`.agents/skills/` convention from Codex's default scan path, which
is also the loose multi-vendor convention adopted by other agents
that follow the [agentskills.io](https://agentskills.io) open
standard.

## Layout

```
.agents/
├── README.md            ← this file
└── skills/
    ├── scaffold-pedal/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    ├── scaffold-instrument/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    ├── scaffold-webview-pedal/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    ├── add-webview/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    ├── add-theme-override/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    └── migrate-v3-to-v4/
        ├── SKILL.md
        └── agents/openai.yaml
```

## How Codex finds these

Codex automatically scans `.agents/skills/` from the current working
directory upward, and at the repo root. Cloning this SDK or running
Codex inside any subfolder of it surfaces the skills with no extra
configuration.

`agents/openai.yaml` adds Codex-specific UI metadata
(display name, brand colour) and policy
(`allow_implicit_invocation: true` lets Codex match the skill's
description against user prompts and trigger it automatically).

## Skills

| Skill | Use it when… |
|---|---|
| `scaffold-pedal` | Authoring a new v4 pedal (FX plugin) from scratch |
| `scaffold-instrument` | Authoring a new instrument plugin |
| `scaffold-webview-pedal` | Pedal with a custom HTML/JS UI surface |
| `add-webview` | Adding a webview to an existing instrument or pedal |
| `add-theme-override` | Adding a per-plugin colour palette to an existing manifest |
| `migrate-v3-to-v4` | Upgrading a legacy `type:"fx"` plugin to v4 |

## Invoking a skill in Codex

Implicit (Codex matches the user's prompt against the skill
description):

> "Help me build a v4 pedal that does sidechain compression."

Explicit:

> "Use the `scaffold-pedal` skill."

## Equivalent assets for other agents

The same skills are mirrored in:

- [`../.claude/skills/`](../.claude/skills/) — Anthropic Claude
- [`../.hermes/skills/`](../.hermes/skills/) — Nous Research Hermes
  Agents

SKILL.md bodies are intentionally identical across folders — only
the frontmatter and any agent-specific sidecars differ. Pick the
folder that matches your agent.

## See also

- [`../CLAUDE.md`](../CLAUDE.md) — full plugin authoring orientation
- [`../AGENTS.md`](../AGENTS.md) — terse multi-agent must-know rules
  (also the Codex / Cursor / Aider convergent convention filename)
- [`../docs/`](../docs/) — full SDK spec narrative + reference
