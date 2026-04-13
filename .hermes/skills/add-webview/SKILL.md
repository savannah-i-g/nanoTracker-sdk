---
name: add-webview
description: Add a sandboxed webview UI control to an existing nanoTracker plugin (instrument OR pedal). Covers the single-file HTML constraint, the host↔iframe message bridge, optional iframe→host write channel, theme cascade, and the v3.5 audio route-back. Composable — assumes the rest of the plugin manifest already exists.
version: 1.0.0
metadata:
  hermes:
    tags: [nanotracker, plugin, webview, html, javascript, ui]
    category: audio-plugin-authoring
    requires_toolsets: [terminal, files]
---

# Add a webview control to an existing plugin

## When to use

Use this when a plugin's audio side already exists (instrument or
pedal manifest is shaping up) and you want to add a custom HTML/JS
UI surface — a custom knob layout, an oscilloscope, a step
sequencer, a DOOM screen, anything you can draw with HTML / canvas
/ WebGL / WASM.

If you're starting a brand-new pedal from scratch with a webview UI,
use `scaffold-webview-pedal` instead — it bundles the pedal scaffold
with the webview steps in one go.

## Procedure

### 1. Declare the capability + UI control

In the existing manifest:

```jsonc
"requires": [/* ...existing flags..., */ "webview-ui"],
"ui": {
  "layout": "flex",
  "controls": [
    /* ...existing controls... */
    {
      "type": "webview",
      "source": "web/ui.html",
      "aspectRatio": "4/3"
    }
  ]
}
```

The `webview-ui` capability is mandatory whenever any `ui.controls[]`
entry has `type: "webview"`. The validator catches the omission.

### 2. Decide which host events the iframe receives

The bridge defaults to forwarding notes + params. Tighten or relax:

```jsonc
{
  "type": "webview",
  "source": "web/ui.html",
  "forwardNotes":   true,    // noteOn / noteOff / pitch / gain / allNotesOff
  "forwardParams":  true,    // param updates from elsewhere (knobs, automation)
  "forwardEffects": false    // (v3.5) raw MOD effect-column bytes
}
```

For a parameter-only visualiser, set `forwardNotes: false` to save
postMessage bandwidth.

### 3. Decide whether the iframe writes back (v4 bidirectional bridge)

If your iframe needs to drive the host (paramWrite for fader UIs,
noteOn for in-iframe keyboards, presetLoad for preset browsers):

```jsonc
"requires": [/* ..., */ "webview-ui", "webview-writes"],
"ui": {
  "controls": [
    {
      "type": "webview",
      "source": "web/ui.html",
      "acceptsParamWrites":  true,    // iframe can post paramWrite
      "acceptsPresetWrites": false,   // iframe can post presetLoad/Save (v4.0: presetLoad ✓, presetSave reserved for v4.1)
      "acceptsNotes":        false,   // iframe can post noteOn/Off
      "acceptsHostCommands": false    // iframe can post hostCommand (v4.0: validated only, dispatcher reserved for v4.1)
    }
  ]
}
```

`webview-writes` is REQUIRED whenever any `accepts*` flag is true.

### 4. Author the iframe HTML (single file)

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* Use host CSS vars so the iframe stays theme-aware */
  body {
    margin: 0;
    background: var(--color-bg, #111);
    color:      var(--color-text, #ddd);
    font:       11px monospace;
  }
</style>
</head>
<body>
<!-- your UI -->
<script>
(function(){
  // 1. Ready handshake — flushes the host's queued event stream
  window.parent.postMessage({ type: "__nt_ready" }, "*");

  // 2. Receive host events
  window.addEventListener("message", (e) => {
    const ev = e.data;
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "noteOn":      /* ev.note, ev.velocity, ev.time */ break;
      case "noteOff":     /* ev.note, ev.time */               break;
      case "param":       /* ev.key, ev.value */               break;
      case "pitch":       /* ev.frequencyHz, ev.time */        break;
      case "gain":        /* ev.gain, ev.time */               break;
      case "allNotesOff": /* ev.time */                        break;
      case "trackerEffect": /* ev.effectCode, ev.value, ev.time (v3.5, opt-in) */ break;
      case "themeChange": {
        // Re-apply host theme as CSS custom properties
        for (const [k, v] of Object.entries(ev.theme)) {
          const cssVar = "--color-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
          document.documentElement.style.setProperty(cssVar, v);
        }
        break;
      }
      case "presetList":  /* ev.presets (v4) */ break;
      case "__nt_error":  console.warn("[plugin]", ev.where, ev.message); break;
    }
  });

  // 3. (Optional) drive the host
  function setParam(key, value) {
    window.parent.postMessage({ type: "paramWrite", key, value }, "*");
  }
})();
</script>
</body>
</html>
```

### 5. Single-file constraint — no exceptions

The loader rejects HTML referencing sibling assets. Inline
EVERYTHING:

| Allowed | Rejected |
|---|---|
| Inline `<script>` / `<style>` | `<script src="./bundle.js">` |
| `data:` URIs | `<link href="style.css">` |
| `blob:` URLs created at runtime | `import "./util.js"` |
| `https://` URLs (with caveats) | `new Worker("worker.js")` |
| `#` fragment anchors | `fetch("./data.bin")` |

Bundling toolchains:

- **React/Svelte/Vue**: `vite-plugin-singlefile`
- **Pure JS**: `esbuild --bundle --minify` then manually inline
- **Binary assets**: base64 + `Uint8Array.from(atob(STR), c => c.charCodeAt(0))`

`ntvalidate` runs the single-file scan at pack time so you find
violations before shipping.

### 6. (Optional) Audio route-back

If the iframe generates audio that should ride the tracker's master
bus (channel volume / pan / FX apply):

```jsonc
{
  "type": "webview",
  "source": "web/ui.html",
  "acceptsAudioFrames": true
}
```

The host posts `__nt_audioInit` with the sample rate; the iframe
posts `__nt_audio` frames upstream. See
[`docs/12-webview-audio.md`](../../docs/12-webview-audio.md).

### 7. Re-validate

```bash
node tools/ntvalidate.mjs <plugin-dir>
```

## Pitfalls

- ❌ **Capability omission** — `webview-ui` MUST be in `requires[]`
  if ANY control is `type: "webview"`. `webview-writes` MUST be
  declared if ANY `accepts*` write flag is `true`.
- ❌ **External script tag** — single-file constraint, see step 5.
- ❌ **Forgetting the ready handshake** — events queue and flush on
  iframe `load` instead, but late. Always send
  `{type:"__nt_ready"}` early.
- ❌ **Hardcoded colours** — the iframe loses the host theme
  cascade. Use `var(--color-...)` so `themeChange` events take
  effect.
- ❌ **Trying to read parent DOM / cookies** — sandboxed; impossible
  by design.
- ❌ **Polling `requestAnimationFrame` for game-logic ticks** — rAF
  is throttled when the iframe isn't visible. Use `setInterval` for
  fixed-rate logic; rAF only for visual updates.

## Verification

1. `ntvalidate` passes (single-file scan included)
2. `ntpack` produces an archive
3. Load + add-to-workspace per the host flow
4. Iframe renders at the declared aspect ratio
5. Test events: play a note → confirm `noteOn` arrived; turn a host
   knob → confirm `param` arrived
6. (If `acceptsParamWrites`) drag a UI control in the iframe →
   confirm a host parameter changed
7. Switch the host theme → confirm `themeChange` re-styled the
   iframe

## Reference

- [`../../docs/09-webview.md`](../../docs/09-webview.md) — webview
  control + bidirectional bridge full reference
- [`../../docs/reference/event-bus.md`](../../docs/reference/event-bus.md)
  — every host → iframe event
- [`../../docs/reference/host-capabilities.md#webview-ui`](../../docs/reference/host-capabilities.md#webview-ui)
- [`../../docs/reference/host-capabilities.md#webview-writes`](../../docs/reference/host-capabilities.md#webview-writes)
- [`../../examples/doom-wasm/`](../../examples/doom-wasm/) — full
  WASM-in-iframe example
- [`../../examples/v40-mixer-pedal/web/ui.html`](../../examples/v40-mixer-pedal/web/ui.html)
  — paramWrite + theme cascade reference
- [`../../templates/webview/`](../../templates/webview/) — minimal
  starter
