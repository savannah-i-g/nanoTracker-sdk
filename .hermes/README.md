# `.hermes/` — agent assets for Hermes Agents

[Hermes Agents](https://hermes-agent.nousresearch.com/) skill assets
for the nanoTracker plugin SDK.

## Layout

```
.hermes/
├── README.md           ← this file
└── skills/             ← Hermes-format skills
    ├── scaffold-pedal/SKILL.md
    ├── scaffold-instrument/SKILL.md
    ├── scaffold-webview-pedal/SKILL.md
    ├── add-webview/SKILL.md
    ├── add-theme-override/SKILL.md
    └── migrate-v3-to-v4/SKILL.md
```

Each `SKILL.md` follows Hermes' frontmatter conventions
(`name`, `description`, `version`, `metadata.hermes.tags`,
`metadata.hermes.category`, `metadata.hermes.requires_toolsets`) and
the suggested body structure (When to Use → Procedure → Pitfalls →
Verification).

## Pointing Hermes at this folder

Hermes scans `~/.hermes/skills/` by default. To make it aware of
the SDK-shipped skills here, add this directory to your Hermes
`config.yaml` as an external skills source. From the
[Hermes docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills):

```yaml
# ~/.hermes/config.yaml
skill_sources:
  - name: nanotracker-sdk
    path: <absolute-path-to-this-repo>/.hermes/skills
    read_only: true
```

Once configured:

```bash
hermes chat --toolsets skills -q "What nanoTracker skills do you have?"
# → lists scaffold-pedal, scaffold-instrument, etc.

# Invoke explicitly
/scaffold-pedal "build me a stereo bitcrusher pedal"
```

## Skills

| Skill | Use it when… |
|---|---|
| `scaffold-pedal` | Authoring a new v4 pedal (FX plugin) from scratch |
| `scaffold-instrument` | Authoring a new instrument plugin |
| `scaffold-webview-pedal` | Pedal with a custom HTML/JS UI surface |
| `add-webview` | Adding a webview to an existing instrument or pedal |
| `add-theme-override` | Adding a per-plugin colour palette to an existing manifest |
| `migrate-v3-to-v4` | Upgrading a legacy `type:"fx"` plugin to v4 |

## Equivalent assets for other agents

The same skills are mirrored in:

- [`../.claude/skills/`](../.claude/skills/) — Anthropic Claude
- [`../.agents/skills/`](../.agents/skills/) — OpenAI Codex
  (and any other agent that follows the agentskills.io convention)

The SKILL.md bodies are intentionally identical across all three
folders — only the frontmatter and any agent-specific sidecars
(e.g. Codex's `agents/openai.yaml`) differ. Pick the folder that
matches your agent and ignore the others.

## See also

- [`../CLAUDE.md`](../CLAUDE.md) — full plugin authoring orientation
  (agent-agnostic body, just lives next to a Claude-named file)
- [`../AGENTS.md`](../AGENTS.md) — terse multi-agent must-know rules
- [`../docs/`](../docs/) — full SDK spec narrative + reference
