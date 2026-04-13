# plugin-sdk tools

Tiny Node CLIs for building and validating nanoTracker plugin archives.
Zero global installs, zero build step, Node 18+ only.

## Install

```bash
cd plugin-sdk/tools
npm install
```

One-time. Pulls `jszip` (the main app already uses the same version,
but we keep a separate `node_modules` here so the SDK is self-contained
and authors don't need to clone the whole tracker to build plugins).

## `ntpack`

Zip a plugin source directory into a `.ntins` or `.ntsfx` archive,
running pre-flight validation first.

```
ntpack <source-dir> [options]

  -o, --out <path>       output archive path (default: <source-dir>.<ext>)
      --type ntins|ntsfx force archive extension
                         (default: inferred from manifest.type)
  -q, --quiet            suppress the success banner
  -h, --help             show help
```

**Examples:**

```bash
# Pack a plugin next to its source folder (my-plugin.ntins)
node plugin-sdk/tools/ntpack.mjs my-plugin

# Pack with an explicit output path
node plugin-sdk/tools/ntpack.mjs my-plugin --out /tmp/my-plugin.ntins

# Pack quietly (for shell scripts)
node plugin-sdk/tools/ntpack.mjs my-plugin --quiet
echo $?  # 0 on success, 1 on failure
```

**Pre-flight checks** (from `lib/validate.mjs`):

- `schemaVersion` is present and one of 1, 2, 3, or 4
- `manifest.name`, `manifest.version`, `manifest.type` are valid
- Every parameter key referenced by a UI control exists in `parameters[]`
- Every entry in `requires[]` is a known capability flag
- Plugins using `webview` controls declare `requires: ["webview-ui"]`
- Every webview control's `source` path exists in the source tree
- Every webview HTML file passes the single-file check (no sibling
  `<script src=...>`, `<link href=...>`, or relative ES-module imports)
- **v4 pedal rules:** `type:"fx"` at v4+ requires `"pedal-v4"` and
  non-empty `ports.inputs[]` AND `ports.outputs[]`
- **v4 ports rules:** `ports` block requires `"portsV4"`; CV input
  ports require `target: "<nodeId>.<paramName>"`; port ids are
  unique within `inputs[]` / `outputs[]`
- **v4 webview-writes:** any webview control with an `accepts*`
  write flag set requires `"webview-writes"` in `requires[]`

If any check fails, `ntpack` prints every issue with the exact field
name and exits 1 before touching the archive. Fix, re-run.

**Default exclusions** (never shipped in the archive):

| Pattern | Why |
|---|---|
| `node_modules/` | Build-time only |
| `.git/` | Version control |
| `.DS_Store`, `Thumbs.db` | OS cruft |
| `*.ntins`, `*.ntsfx` | Archive self-inclusion |
| `*.log`, `*.swp`, `*~` | Editor droppings |

**Custom exclusions:** drop a `.ntpackignore` file at the root of your
plugin source directory:

```
# my-plugin/.ntpackignore
src/          # raw source files, we only ship the built output
doom.wasm     # downloaded binary, fetched from upstream
tests/
notes.md
```

Supports prefix-slash directory matches (`src/`) and exact file/path
matches (`notes.md`, `web/dev.html`). No glob patterns yet — keep it
simple.

## `ntvalidate`

Lint a `plugin.json` without packaging anything. Runs the same
pre-flight checks as `ntpack` — use it when you want to gate a
commit, a CI job, or a pre-release script on "does my plugin.json
parse without complaints."

```
ntvalidate <plugin.json | source-dir> [options]

  -q, --quiet     suppress the success banner
  -h, --help      show help
```

**Examples:**

```bash
# Validate a source directory
node plugin-sdk/tools/ntvalidate.mjs my-plugin

# Or a direct plugin.json path
node plugin-sdk/tools/ntvalidate.mjs my-plugin/plugin.json

# Pre-commit hook style
node plugin-sdk/tools/ntvalidate.mjs my-plugin --quiet && echo "ok"
```

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | all checks passed |
| 1 | validation errors (bad plugin.json, missing webview source, etc.) |
| 2 | CLI argument error (wrong number of args, missing file) |

**Pre-commit hook example:**

```bash
#!/bin/sh
# .git/hooks/pre-commit
set -e
for plugin in plugins/my-*; do
  node plugin-sdk/tools/ntvalidate.mjs "$plugin" --quiet
done
```

**Scope:** `ntvalidate` runs the same `preflightPlugin` function as
`ntpack` — see `lib/validate.mjs` for the full rule set. A deeper
JSON Schema-based type validation pass (using `ajv`) is planned for
a future release if anyone needs stricter checking; for now the
preflight catches every realistic authoring mistake.

## What the tools are not

- **Not a scaffolder.** To start a new plugin, copy a template:
  `cp -r plugin-sdk/templates/webview my-plugin`.
- **Not a watcher.** Changing `web/index.html` requires re-packing the
  archive. Write tests in a standalone HTML file you can open directly
  in the browser; only pack into `.ntins` when you're close to shipping.
- **Not a publisher.** There's no `ntpublish` — you distribute plugins
  however you want (personal website, GitHub release, a Git repo,
  drag-and-drop on a friend's laptop). The tracker loads any
  `.ntins` / `.ntsfx` file the user drops into its plugin panel.

## Hacking on the tools

The validation logic lives in `lib/validate.mjs`. The webview
single-file regex mirrors the rule the tracker's plugin loader
applies at load time — both sides move together, so a plugin that
passes `ntpack` also passes the host loader.

The tools themselves are plain ESM scripts, no build step, no
transpiling. Edit in place, run `node ntpack.mjs ...`, see the change.

## See also

- [`../README.md`](../README.md) — SDK entry point
- [`../docs/11-packaging.md`](../docs/11-packaging.md) — packaging
  workflow narrative
- [`../docs/reference/schema.md`](../docs/reference/schema.md) —
  dense field-by-field reference for every `plugin.json` field the
  validator checks
