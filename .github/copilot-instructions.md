# GitHub Copilot — nanoTracker plugin SDK

When asked to write or modify a nanoTracker plugin in this repo,
read [`AGENTS.md`](../AGENTS.md) at the repo root. It contains the
must-know rules the loader enforces (capability flags, port shape,
single-file webview HTML, etc.) and a link to the full Claude
guide ([`CLAUDE.md`](../CLAUDE.md)) when you need more detail.

For task-specific scaffolding patterns, the
[`.claude/skills/`](../.claude/skills/) folder has SKILL.md files
covering common workflows (scaffold-pedal, scaffold-instrument,
scaffold-webview-pedal, add-webview, add-theme-override,
migrate-v3-to-v4). Their bodies are agent-agnostic plugin-authoring
guidance.

Spec docs:

- [`../docs/13-pedals.md`](../docs/13-pedals.md) — pedal authoring
- [`../docs/14-ports.md`](../docs/14-ports.md) — typed port model
- [`../docs/09-webview.md`](../docs/09-webview.md) — webview UI
- [`../docs/reference/schema.md`](../docs/reference/schema.md) —
  every manifest field
- [`../docs/reference/host-capabilities.md`](../docs/reference/host-capabilities.md)
  — every capability flag

Validate any change with `node tools/ntvalidate.mjs <plugin-dir>`
before suggesting it as a complete answer.
