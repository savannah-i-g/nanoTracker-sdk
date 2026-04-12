# Getting started: your first nanoTracker plugin

By the end of this page you'll have a working `.ntins` plugin loaded
into the tracker. It'll be a tiny instrument — a single silent
parameter wired to a `webview` control that echoes tracker events —
but the scaffold is identical for anything more ambitious.

Total time: about 5 minutes, most of it typing.

---

## 1. Prerequisites

- **nanoTracker running locally** — either `npm run dev` from the
  repo root, or a deployed build you control
- **Node.js 18 or later** — required by the SDK tools
- **The SDK tools' dependencies** — run once:

  ```bash
  cd plugin-sdk/tools
  npm install
  cd ../..
  ```

  This pulls `jszip` (for archive building) and `ajv` (for schema
  validation). No global installs, no build step.

---

## 2. Copy the webview starter

```bash
cp -r plugin-sdk/templates/webview hello-plugin
cd hello-plugin
ls
# plugin.json
# web/
#   index.html
```

Two files. That's a complete plugin.

Open `plugin.json` — it's about 30 lines and declares:

- **`schemaVersion: 3`** — required for any plugin using webview controls
- **`manifest`** — name, version, type (`instrument` or `fx`), author
- **`requires: ["webview-ui"]`** — capability gate; the host refuses to
  load this plugin if it doesn't support webview controls
- **`parameters`** — one dummy knob so the plugin has something to
  automate
- **`dsp`** — a minimal silent instrument definition (required even if
  the plugin makes no sound)
- **`ui.controls`** — a `webview` control pointing at `web/index.html`
  and a `knob` bound to the dummy parameter

Open `web/index.html`. This is a single self-contained HTML document —
no external `<script src=...>`, no `<link href=...>`, no fetches. The
nanoTracker plugin loader enforces this constraint (see
[`09-webview.md`](09-webview.md) for why). Everything the webview
needs — CSS, JS, images — has to be inlined into this one file.

The starter's JS does three things:

```js
// 1. Tell the host we're ready (flushes any queued events)
window.parent.postMessage({ type: "__nt_ready" }, "*");

// 2. Listen for events from the tracker
window.addEventListener("message", (e) => {
  const ev = e.data;
  if (!ev || typeof ev !== "object") return;
  // ev is a VoiceEngineEvent: noteOn / noteOff / param / pitch / gain / allNotesOff
  logToPage(ev);
});

// 3. (Optional) post replies back to the host — unused in this template
```

That's the whole bridge contract. The tracker takes care of
instantiating the iframe, forwarding events, and tearing things down
on unload.

---

## 3. Validate before you ship

```bash
node ../plugin-sdk/tools/ntvalidate.mjs .
```

Expected output:

```
✓ plugin.json: schemaVersion 3, manifest OK
✓ parameters: 1 param, all keys referenced by UI OK
✓ capabilities: webview-ui OK
✓ webview controls: 1 control, web/index.html passes single-file check
ok
```

If you broke something — renamed a parameter key and forgot to update
the UI reference, added a `requires` flag that doesn't exist,
accidentally wrote `<script src="foo.js">` in `web/index.html` — the
validator tells you exactly which field and why.

Most common trip-ups:

| Error | Cause |
|---|---|
| `parameter "xyz" referenced in ui.controls[0].parameter but not declared in parameters[]` | Typo in a parameter key |
| `webview source "web/foo.html" references sibling asset "bar.js"` | Your HTML has `<script src="bar.js">` — inline it instead |
| `unknown capability "webview"` | You wrote `webview` in `requires[]`; should be `webview-ui` |
| `webview controls require requires: ["webview-ui"]` | Forgot the capability gate entirely |

---

## 4. Package into a `.ntins`

```bash
node ../plugin-sdk/tools/ntpack.mjs . --out hello-plugin.ntins
# wrote hello-plugin.ntins (1.2 KB)
```

`ntpack` re-runs the validation pass (so you can skip step 3 in quick
iteration), then zips every file in the source directory except a few
obvious exclusions (`node_modules/`, `.git/`, `*.log`, the `.ntins`
file itself). Pass `--out` to control the archive path; without it
`ntpack` writes `<source-dir>.ntins` next to the source.

Archive layout:

```
hello-plugin.ntins
├── plugin.json
└── web/
    └── index.html
```

You can inspect with any ZIP tool:

```bash
unzip -l hello-plugin.ntins
```

---

## 5. Load it in the tracker

1. Launch nanoTracker (`npm run dev`, navigate to `/tracker`)
2. Open the **PLUGINS** panel from the menu bar
3. Click **+ LOAD PLUGIN (.ntins / .ntsfx)**
4. Pick `hello-plugin.ntins`
5. The plugin appears in the **INSTRUMENTS** list
6. Drag it into the workspace (or assign it to a tracker instrument slot)
7. Open the instrument window — you'll see the webview panel with
   "waiting for tracker events…" and a dummy knob

Now play a note on the tracker keyboard (Q/W/E/R/... while a pattern
cell is selected). The webview panel logs the `noteOn` / `noteOff`
events in real time. Drag the dummy knob — you get `param` events.

If you play a pattern with the plugin bound to a channel, every row
hit fires its own event. Every tracker effect that touches pitch or
gain emits `pitch` / `gain` events.

That's the bridge. Everything else — drawing pixels, running
WebAssembly, playing games, showing visualizers — is just "what do you
do with those events inside `web/index.html`."

---

## 6. Where to next

**I want my plugin to make sound**
→ [`04-instruments.md`](04-instruments.md) for declarative
  sample/oscillator instruments, or [`07-audioworklets.md`](07-audioworklets.md)
  for custom DSP in a `script.js` AudioWorklet.

**I want to build an FX processor**
→ [`05-fx-graphs.md`](05-fx-graphs.md) for the declarative FX graph
  (no code needed for a lot of simple effects), or
  [`07-audioworklets.md`](07-audioworklets.md) for custom processors.

**I want to embed WebAssembly (an emulator, a raycaster, a game engine)**
→ [`10-wasm-in-webview.md`](10-wasm-in-webview.md) — the DOOM walkthrough.
  It's the biggest example in the SDK and hits every non-trivial case.

**I want the full reference for every field in `plugin.json`**
→ [`reference/schema.md`](reference/schema.md)

**I want to understand the full UI control palette**
→ [`03-ui-controls.md`](03-ui-controls.md) — knob, slider, toggle,
  select, number, waveform_view, xy_pad, envelope_editor, meter, label,
  group, webview.

**I want to know what events the webview bridge forwards**
→ [`reference/event-bus.md`](reference/event-bus.md) for the
  `VoiceEngineEvent` type definitions.

---

## Troubleshooting

**The plugin loads but the iframe is blank.**
Open the browser DevTools console. If you see `Content-Security-Policy`
errors, the tracker build you're running has a CSP that blocks
`blob:` iframes or inline scripts — check that the host's CSP
includes both `frame-src 'self' blob:` and `script-src ... 'unsafe-inline'`.
Both are required for webview plugins to mount and execute inside
the iframe.

**The plugin loads but no events reach the iframe.**
Check that `web/index.html` posts `{ type: "__nt_ready" }` to the
parent frame on load. Without this, the host doesn't know the iframe
is listening and events may be dropped before the handshake completes.

**`ntvalidate` fails with "plugin.json not found".**
The tool expects either a path to a `plugin.json` file, or a path to a
directory containing one. Run it from the repo root with the source
directory as the argument: `node plugin-sdk/tools/ntvalidate.mjs hello-plugin`.

**The `webview` control renders but notes don't trigger Doom-style
input in a WASM plugin.**
Make sure `forwardNotes: true` is set on the webview control
(it's the default — only a problem if you set `forwardNotes: false`).
