---
name: scaffold-webview-pedal
description: Scaffold a v4 nanoTracker pedal whose UI is a custom HTML/JS surface (mixer fader strip, XY pad, oscilloscope, step sequencer, …). Builds on scaffold-pedal, adds the webview control + bidirectional bridge wiring + single-file HTML constraints so the iframe loads without errors.
---

# Scaffold a webview-UI v4 pedal

## When to use

Use this when the user wants a pedal whose control surface can't be
built from the host's standard knob / slider / XY-pad / envelope
controls — a custom mixer fader strip, an interactive scope, a step
sequencer, a piano-roll, a DOOM screen.

If a few knobs would do the job, use `scaffold-pedal` instead — the
host's auto-rendered knob grid is simpler and theme-aware out of
the box.

## Procedure

### 1. Run scaffold-pedal first

The webview is layered ON TOP of a pedal manifest. Do
`scaffold-pedal` for the audio side (ports, DSP, parameters), then
come back here for the UI surface.

### 2. Add webview capability + control

```jsonc
"requires": ["pedal-v4", "portsV4", "graph", "webview-ui", "webview-writes"],
"ui": {
  "layout": "flex",
  "controls": [
    {
      "type": "webview",
      "source": "web/ui.html",
      "aspectRatio": "4/3",
      "acceptsParamWrites":  true
    }
  ]
}
```

Per-control accept flags (`acceptsParamWrites`, `acceptsPresetWrites`,
`acceptsNotes`, `acceptsHostCommands`) gate which iframe → host
message classes the bridge will accept. Only declare what you use —
the validator catches the mismatch with `requires[]`.

### 3. Author the iframe HTML

`web/ui.html` MUST be a single self-contained file:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* Theme-aware: pick up host CSS vars cascaded through themeChange */
  body {
    margin: 0;
    background: var(--color-bg, #111);
    color:      var(--color-text, #ddd);
    font: 11px "Kode Mono", monospace;
  }
  /* ... your styles ... */
</style>
</head>
<body>
<!-- your UI markup -->
<script>
(function(){
  // Ready handshake — flush the host's queued event stream
  window.parent.postMessage({ type: "__nt_ready" }, "*");

  // Send paramWrite messages when your UI changes a value
  function setParam(key, value) {
    window.parent.postMessage({ type: "paramWrite", key, value }, "*");
  }

  // Receive events from the host
  window.addEventListener("message", (e) => {
    const ev = e.data;
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "themeChange":
        // Re-apply the host's theme palette as CSS custom properties
        for (const [k, v] of Object.entries(ev.theme)) {
          const cssVar = "--color-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
          document.documentElement.style.setProperty(cssVar, v);
        }
        break;
      case "param":
        // Host -> iframe param update (knob driven elsewhere, automation, etc)
        // Update your UI to match.
        break;
      case "presetList":
        // Factory preset catalogue (v4) — render a preset browser
        break;
      case "noteOn":
      case "noteOff":
      case "trackerEffect":
        // Tracker activity for visualisers
        break;
      case "__nt_error":
        console.warn("[plugin]", ev.where, ev.message);
        break;
    }
  });
})();
</script>
</body>
</html>
```

### 4. Single-file constraint — no exceptions

The loader REJECTS webview HTML that references sibling assets:

- ❌ `<script src="./bundle.js">`
- ❌ `<link rel="stylesheet" href="style.css">`
- ❌ `import "./util.js"` inside an inline script
- ❌ `new Worker("worker.js")` (use a blob URL instead)
- ❌ `fetch("./data.bin")` (base64-inline as a const)

Allowed: inline `<script>` / `<style>`, `data:` URIs, `blob:` URLs
created at runtime, `https://` URLs, fragment anchors,
`javascript:` URLs.

For React / Svelte / Vue projects, use `vite-plugin-singlefile`. For
pure JS, `esbuild --bundle --minify` + manual inline. For binary
assets, base64 the bytes:

```js
const MY_WASM = "AGFzbQEAAAAB...";   // base64
const bytes = Uint8Array.from(atob(MY_WASM), c => c.charCodeAt(0));
const { instance } = await WebAssembly.instantiate(bytes, imports);
```

### 5. Theme override (recommended)

```jsonc
"requires": ["pedal-v4", "portsV4", "graph", "webview-ui", "webview-writes", "themeOverride"],
"ui": {
  "themeOverride": {
    "primary": "#ff7a00",
    "bg":      "#140800"
  },
  "controls": [
    { "type": "webview", "source": "web/ui.html", "acceptsParamWrites": true }
  ]
}
```

The override cascades to the pedal window chrome AND is re-posted to
the iframe as a `themeChange` event after the ready handshake — your
iframe stays in sync.

### 6. Audio route-back (optional, advanced)

If your iframe generates its own audio (e.g. a JS synth or a WASM
emulator like the DOOM example), route it back into the tracker's
output chain instead of the iframe's own AudioContext:

```jsonc
{
  "type": "webview",
  "source": "web/ui.html",
  "acceptsAudioFrames": true
}
```

Then in the iframe, after receiving `__nt_audioInit`:

```js
window.parent.postMessage({
  type:  "__nt_audio",
  left:  /* Float32Array */,
  right: /* Float32Array, optional */
}, "*");
```

See [`docs/12-webview-audio.md`](../../docs/12-webview-audio.md) for
the protocol.

### 7. Validate + pack

```bash
node tools/ntvalidate.mjs <plugin-dir>
node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx
```

`ntvalidate` runs the single-file scan on your HTML and catches
sibling-asset references at pack time.

## Pitfalls

- ❌ **Posting paramWrite without `acceptsParamWrites: true`** —
  the host validator drops the message. Set both the per-control
  flag AND the top-level `webview-writes` capability.
- ❌ **Skipping the `__nt_ready` handshake** — the host queues
  events until ready; if your script never sends ready, events flush
  on the iframe's `load` event (works but is later than ideal).
- ❌ **Reading the parent's DOM, cookies, or localStorage** — the
  iframe is sandboxed (`allow-scripts allow-same-origin`, but the
  src is a `blob:` URL with an opaque origin). It can't reach the
  parent — by design.
- ❌ **External `<script src>`** — single-file constraint, see step
  4. Inline everything.
- ❌ **Posting `paramWrite` for a non-existent parameter** — host
  drops with `__nt_error` back. Listen for `__nt_error` during
  development to catch typos fast.
- ❌ **Hardcoding theme colours instead of using `var(--color-...)`**
  — the iframe loses theme cascade and looks broken under
  user-applied themes.

## Verification

1. `node tools/ntvalidate.mjs <plugin-dir>` — single-file check
   passes
2. `node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx` succeeds
3. Load + add to workspace per scaffold-pedal verification
4. Pedal window shows your iframe rendered at the declared aspect
   ratio
5. Drag a UI control in the iframe → confirm the host's parameter
   actually changes (visible if you also have a host-rendered knob,
   or check the console for `__nt_error` if it doesn't)
6. Switch the host theme — confirm the iframe re-styles via the
   `themeChange` event

## Reference

- [`../../docs/09-webview.md`](../../docs/09-webview.md) — webview
  control + bidirectional bridge full reference
- [`../../docs/10-wasm-in-webview.md`](../../docs/10-wasm-in-webview.md)
  — DOOM-running-inside-a-plugin walkthrough
- [`../../docs/12-webview-audio.md`](../../docs/12-webview-audio.md)
  — `acceptsAudioFrames` protocol
- [`../../docs/reference/event-bus.md`](../../docs/reference/event-bus.md)
  — every host → iframe event
- [`../../examples/v40-mixer-pedal/web/ui.html`](../../examples/v40-mixer-pedal/web/ui.html)
  — production-quality fader strip with `paramWrite` + theme
  cascade
- [`../../templates/webview/`](../../templates/webview/) — minimal
  starter
