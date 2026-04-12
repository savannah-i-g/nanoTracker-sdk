# Packaging and distribution

You've written `plugin.json`. You've got your `script.js` or your
`web/index.html` or your `samples/` folder ready. Now you need to
turn it into a `.ntins` / `.ntsfx` archive a user can drag into
the tracker.

## The one-line version

```bash
node plugin-sdk/tools/ntpack.mjs my-plugin
# → my-plugin.ntins (3.2 KB)
```

That's it. `ntpack` reads `plugin.json`, runs pre-flight validation,
walks the source directory, and emits a deflate-compressed ZIP with
the right extension.

If validation passes, you have a shippable archive. If it fails,
`ntpack` prints every issue with the offending field path and exits
non-zero — fix the errors, re-run.

## Archive layout

```
my-plugin.ntins
├── plugin.json     ← required
├── script.js       ← optional, AudioWorklet source
├── samples/        ← optional, referenced by dsp.samples[].file etc.
│   ├── kick.wav
│   └── ir.flac
└── web/            ← optional, webview HTML files
    └── index.html
```

Anything else in the archive is **silently ignored** by the tracker.
You can include a `README.md`, a `LICENSE`, a `CHANGELOG.md`, a
`CREDITS.md`, whatever — it's just dead weight in the archive but
it's sometimes useful for the person who eventually unzips it to
understand where it came from. The DOOM example ships its `LICENSE`
and `CREDITS.md` alongside the runtime files for exactly this reason.

**What gets excluded by default** (via `ntpack`):

| Pattern | Reason |
|---|---|
| `node_modules/` | Build-time only |
| `.git/`, `.gitignore`, `.gitattributes` | Version control metadata |
| `.DS_Store`, `Thumbs.db` | OS cruft |
| `*.ntins`, `*.ntsfx` | Prevent archive self-inclusion |
| `*.log`, `*.swp`, `*~` | Editor droppings |
| `.ntpackignore` | The ignore file itself |

**Custom exclusions** go in a `.ntpackignore` file at the source
directory root:

```
# my-plugin/.ntpackignore
src/            # raw source, we only ship the built output
doom.wasm       # downloaded upstream binary
tests/          # test fixtures
notes.md        # personal notes
```

Syntax is intentionally simple — prefix-slash matches directories
(`src/` matches everything under `src/`), everything else is an
exact path or basename match. No glob wildcards yet.

See the DOOM example at
[`../examples/doom-wasm/.ntpackignore`](../examples/doom-wasm/.ntpackignore)
for a working one: excludes `src/` (the build-time bundler and
template) but keeps `plugin.json`, `web/doom.html`, `LICENSE`,
`CREDITS.md`, `README.md`.

## Pre-flight validation

`ntpack` runs these checks **before** touching the ZIP. Any failure
stops the pack with exit code 1:

| Check | What it catches |
|---|---|
| `schemaVersion` present and in {1, 2, 3} | Forgot to declare the schema version, or typoed the number |
| `manifest.name`, `manifest.version`, `manifest.type` | Missing/empty required fields |
| `manifest.type` is `"instrument"` or `"fx"` | Typos like `"synth"`, `"effect"` |
| Every parameter key referenced by UI controls exists in `parameters[]` | Typos in parameter keys, renamed a parameter without updating UI |
| Every `requires[]` flag is a known capability | Typoed a flag like `"webview"` instead of `"webview-ui"` |
| Plugins with `webview` controls declare `requires: ["webview-ui"]` | Used a v3 feature without the capability gate |
| Every `webview.source` path exists on disk | Renamed the HTML file and forgot to update the path |
| Every webview HTML passes the single-file check | Accidentally wrote `<script src=...>` or `<link href=...>` |

The full list lives in `tools/lib/validate.mjs`. The webview
single-file regex mirrors the same rule the host applies at load
time — both sides of the check move together, so a plugin that
passes `ntpack` also passes the host loader.

## Packing without `ntpack`

If you don't have Node or you want a zero-dependency path, `ntpack`
is entirely optional. A plain `zip` works:

```bash
cd my-plugin
zip -r ../my-plugin.ntins plugin.json script.js samples/ web/
```

You lose the validation pass, so any authoring mistakes get
discovered at the tracker's plugin-load time instead of at pack
time. Run `ntvalidate` separately to get the pre-flight without
needing `ntpack`:

```bash
node plugin-sdk/tools/ntvalidate.mjs my-plugin
```

Both tools share the same validation logic. They produce the same
errors for the same mistakes.

## `ntpack` CLI reference

```
ntpack <source-dir> [options]

  -o, --out <path>       Output archive path
                         (default: <source-dir>.<ext>)
      --type ntins|ntsfx Force archive extension
                         (default: inferred from manifest.type)
  -q, --quiet            Suppress the success banner
  -h, --help             Show help
```

**Examples:**

```bash
# Pack a plugin; ntpack picks the extension from manifest.type
node plugin-sdk/tools/ntpack.mjs my-instrument
# → my-instrument.ntins

node plugin-sdk/tools/ntpack.mjs my-effect
# → my-effect.ntsfx

# Custom output path
node plugin-sdk/tools/ntpack.mjs my-plugin --out /tmp/release-candidate.ntins

# CI-friendly (no banner, just exit code)
node plugin-sdk/tools/ntpack.mjs my-plugin --quiet && echo "shipped"
```

## Distribution

The tracker doesn't have a plugin registry, a marketplace, or a
"publish" command. You distribute `.ntins` files however you want:

- **Drop it on a user's machine** — the simplest case. The user drags
  the file into the tracker's plugins panel.
- **Host on your personal website** — one `.ntins` file, one download
  link, done.
- **GitHub release** — commit the plugin source to a repo, tag a
  release, attach the built `.ntins` as a release asset. `ntpack`
  runs as a GitHub Action step if you want.
- **Share in a Discord / Slack / mailing list** — plugins are small
  (usually under 100 KB, sometimes a few MB for sample-heavy packs
  or embedded WASM). Attach and send.
- **Embed in a `.ftrk` song** — the tracker bundles the full plugin
  archive into the song file when you save. Sending the `.ftrk`
  auto-ships the plugins the song depends on. Nothing for you to do
  as a plugin author — it's a tracker feature.

There is no signing, no trust model, no verification. Users opt in
to a plugin by deliberately loading it. Don't ship malicious code.
If you're bundling WASM binaries from upstream, make sure you have
the right to redistribute them and include attribution — see
[`../examples/doom-wasm/CREDITS.md`](../examples/doom-wasm/CREDITS.md)
for a worked example of what that looks like for GPL code.

## Licensing

Your plugin source is whatever license you want. MIT, Apache-2.0,
GPL, proprietary, CC0 — all fine. The tracker doesn't care, the
SDK doesn't care, the plugin loader doesn't care.

**One exception:** if your plugin statically links GPL code (e.g.,
you ship a GPL WASM binary in a webview plugin), your `.ntins`
archive is a derivative work and must be GPL as well. The DOOM
example walks through this in
[`10-wasm-in-webview.md`](10-wasm-in-webview.md) and
[`../examples/doom-wasm/CREDITS.md`](../examples/doom-wasm/CREDITS.md).

GPL contagion only reaches as far as the static link boundary. A
non-GPL plugin you ship in the same panel (or even in the same `.ftrk`
song) is unaffected.

## Size guidance

Plugin archives range wildly in size:

| Archive | Size | What's in it |
|---|---|---|
| A knob-only FX | ~1–3 KB | Just `plugin.json` |
| A small AudioWorklet instrument | ~2–5 KB | `plugin.json` + `script.js` |
| A sample-based drum kit | ~50–500 KB | `plugin.json` + `samples/*.wav` |
| A full multi-sampled instrument | 1–10 MB | Many sample files |
| The DOOM example | 2.35 MB | `plugin.json` + single-file HTML with inlined WASM |

**Hard upper bound:** the tracker loads the full archive into memory
at `loadPlugin()` time. Above ~50 MB you'll start seeing UI lag
during loading and the plugin panel itself may stutter. Below that,
browsers handle large archives fine.

**Soft guidance:** keep it under 10 MB if you can, under 5 MB if you
can. Big archives mean slow downloads, slow loads, and potential
memory pressure on lower-end machines. For sample packs, compress
with FLAC or OGG instead of WAV — the tracker decodes them all.

## Reproducible builds

`ntpack`'s output is **not** deterministic by default — the ZIP
timestamps in the archive come from the source files' mtimes, which
change every time you edit. Two packs of the same source will have
different SHA-256 hashes unless you also freeze timestamps.

If you need reproducibility (e.g., for supply-chain verification):

```bash
# Normalise timestamps before packing
find my-plugin -exec touch -d @0 {} \;
node plugin-sdk/tools/ntpack.mjs my-plugin
```

Or do it via Git:

```bash
# GIT_COMMITTER_DATE pins every file to the commit time
GIT_COMMITTER_DATE=$(git log -1 --format=%ct) \
  find my-plugin -exec touch -d @$GIT_COMMITTER_DATE {} \;
```

The tracker loader doesn't care about timestamps, so this is purely
for users who want "same source → same hash."

## Troubleshooting

**"`ntpack` says my plugin.json is invalid but it loads fine in the
tracker."** The validator is stricter than the loader on purpose —
it catches things the loader silently tolerates (like undeclared
capabilities). Fix the validator's complaints; you'll dodge a
future tracker version that tightens up.

**"`ntpack` rejects my webview because of a comment."** The
single-file regex matches `src=`, `href=`, and `import` in any
context — including HTML comments. Rewrite the comment to avoid
literal attribute-looking text. See the DOOM template's comment for
an example of prose-only phrasing.

**"My archive is huge and the tracker hangs on load."** Likely a
large sample file or an inlined WASM binary. Profile with the
browser's Network tab (plugin loads show up as blob URLs being
created) and the Performance tab.

**"The user loaded my plugin but nothing appears in the UI."** Open
the browser DevTools console. The tracker's plugin loader logs
parse errors on load so the offending field name is usually right
there. If your plugin has a `script.js` and nothing is playing, the
worklet may have failed to compile — check the console for
`addModule` errors on the audio worklet.

**"I want to unpack someone else's `.ntins` to see how they did
something."** Just `unzip` it. `.ntins` and `.ntsfx` are plain ZIPs:

```bash
unzip -l their-plugin.ntins  # list contents
unzip their-plugin.ntins -d their-plugin/  # extract
```

Read their `plugin.json`, read their `script.js`, learn something.
This is a core part of the SDK ethos — plugins are inspectable.

## See also

- [`../tools/README.md`](../tools/README.md) — CLI reference
- [`01-plugin-format.md`](01-plugin-format.md) — the archive layout in
  the context of the loader
- [`00-getting-started.md`](00-getting-started.md) — packaging as
  part of a first-plugin walkthrough
- [`../examples/doom-wasm/README.md`](../examples/doom-wasm/README.md) —
  packaging a large webview + WASM plugin end to end
