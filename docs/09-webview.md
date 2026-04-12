# The `webview` UI control

> **You need this page if:** you want to render something that isn't a
> knob, slider, or envelope editor — a custom visualizer, an oscilloscope,
> a chip-8 emulator, a piano roll, a tuner, a game, anything HTML+JS
> can draw. Added in plugin schema v3.

The `webview` control mounts a sandboxed `<iframe>` inside the plugin's
UI panel, loads a single self-contained HTML file from the plugin
archive, and wires a `postMessage` bridge so the hosted document
receives every tracker event the host dispatches on that instrument.
It's the escape hatch for "I need to draw my own pixels."

---

## Minimum viable example

`plugin.json` (schema v3):

```json
{
  "schemaVersion": 3,
  "manifest": {
    "name": "SCOPE",
    "version": "1.0.0",
    "type": "instrument",
    "description": "Oscilloscope visualizer"
  },
  "requires": ["webview-ui"],
  "parameters": [],
  "dsp": {
    "processorName": null,
    "voices": 1,
    "voiceStealing": "oldest",
    "oscillators": [],
    "samples": [],
    "envelope": { "attack": 0.001, "decay": 0.01, "sustain": 1, "release": 0.01 },
    "filter": null
  },
  "ui": {
    "layout": "flex",
    "controls": [
      { "type": "webview", "source": "web/index.html", "aspectRatio": "16/10" }
    ]
  }
}
```

`web/index.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><style>body{margin:0;background:#000;color:#0f0;font-family:monospace}</style></head>
<body>
<div id="log"></div>
<script>
  window.parent.postMessage({ type: "__nt_ready" }, "*");
  window.addEventListener("message", (e) => {
    const ev = e.data;
    if (!ev || typeof ev !== "object") return;
    document.getElementById("log").textContent += JSON.stringify(ev) + "\n";
  });
</script>
</body>
</html>
```

Two files, total ~50 lines. Pack with `ntpack` and drop into the tracker.
Every tracker event lands in the iframe's log.

---

## The `webview` control fields

| Field | Default | Purpose |
|---|---|---|
| `type` | — | must be `"webview"` |
| `source` | — | archive-relative path to the HTML file (required) |
| `width` | fills container | explicit pixel width |
| `height` | `360` | explicit pixel height |
| `aspectRatio` | unset | e.g. `"4/3"` or `"16/10"` — when set, overrides `width`/`height` and makes the iframe fill the container at that ratio |
| `sandbox` | `""` | extra sandbox tokens appended to the default `allow-scripts allow-same-origin` |
| `forwardNotes` | `true` | forward `noteOn` / `noteOff` / `allNotesOff` / `pitch` / `gain` events |
| `forwardParams` | `true` | forward `param` events when knobs/sliders change |
| `forwardEffects` | `false` | (reserved for v2) forward raw MOD effect bytes |
| `acceptsAudioFrames` | `false` | (reserved for v2) enable PCM route-back into tracker master bus |
| `acceptsFocus` | `true` | when `false`, disables pointer events on the iframe so the tracker keeps keyboard focus even while the cursor is over it |

Only `source` is required. Everything else has sensible defaults.

`width`, `height`, and `aspectRatio` follow CSS rules: `aspectRatio` wins
if set, otherwise explicit `width`/`height`, otherwise the iframe fills
100% of its parent's width and falls back to `360px` tall.

---

## The postMessage bridge

The host mounts the iframe, then queues every voice-engine event
dispatched on the instrument until the iframe signals it's ready to
receive. The iframe signals ready in either of two ways:

1. **Explicit handshake**: post `{ type: "__nt_ready" }` from inside the
   iframe as soon as your script runs. The host flushes its queue
   immediately. Use this if you want events to start flowing before
   the iframe's `load` event completes (e.g., if you're doing heavy
   WASM instantiation that delays `load`).
2. **Implicit handshake**: do nothing — the host flushes the queue on
   the iframe's `load` event. Simpler, but slightly later.

The starter template uses the explicit handshake. In practice, always
use the explicit handshake — it costs one line and avoids a race
condition where very early events could be dropped if your iframe
takes a while to finish loading.

### What the iframe receives

Events are posted to the iframe's `window` via standard
`postMessage(event, "*")`. The iframe reads them with:

```js
window.addEventListener("message", (e) => {
  const ev = e.data;
  if (!ev || typeof ev !== "object") return;
  switch (ev.type) {
    case "noteOn":      /* ev.note, ev.velocity, ev.time */ break;
    case "noteOff":     /* ev.note, ev.time */ break;
    case "allNotesOff": /* ev.time */ break;
    case "pitch":       /* ev.frequencyHz, ev.time */ break;
    case "gain":        /* ev.gain, ev.time */ break;
    case "param":       /* ev.key, ev.value */ break;
  }
});
```

Every event has a `type` discriminator field. See
[`reference/event-bus.md`](reference/event-bus.md) for the formal
TypeScript definitions.

**Timing:** the `time` field is an `AudioContext.currentTime` value in
seconds. If you want sample-accurate scheduling, translate with
`performance.now()` and your own drift compensation. For most use
cases, treat it as "roughly now".

**Filtering:** the `forwardNotes` / `forwardParams` flags on the control
decide which events reach the iframe. If you only care about parameter
automation (e.g., a knob visualizer), set `forwardNotes: false` to save
postMessage bandwidth.

### What the iframe can post back

Whatever you want. The host accepts messages back from the iframe
over the same channel, but v1 does not expose a two-way API to
plugin authors — iframe-to-host messages are effectively *ignored*
in v1 and reserved for future use.

The one exception is the ready handshake:
`{ type: "__nt_ready" }` is recognised by the host and flushes the
event queue.

---

## The single-file HTML constraint

The plugin loader enforces that every webview HTML file is **completely
self-contained** — no external `<script src="...">`, no `<link href="...">`
to CSS, no ES module `import "./foo.js"` statements, no `fetch()` calls
to relative URLs. A regex scan at plugin-load time rejects archives
that fail this check with an error pointing at the offending reference.
The same check runs up-front in `ntvalidate` and `ntpack`, so you get
the error at pack time rather than at load time.

**Why:** multi-file webview archives would require the loader to rewrite
every URL inside the HTML to blob URLs at load time — that's fragile,
slow, and has no safe upper bound on the rewrite rules. v1 punts the
complexity to the plugin author: bundle everything into one file and
the host's job is trivial.

**What's allowed:**

- Inline `<script>` and `<style>` tags
- `data:` URIs (good for small images, fonts, inline SVG)
- `blob:` URLs you create at runtime
- `https://` URLs and `//` protocol-relative URLs (external resources,
  if you want them and accept the privacy/CSP cost)
- `#` fragment anchors (intra-document links)
- `javascript:` URLs (don't, but they're allowed)
- `about:` URLs

**What's rejected:**

- `<script src="./foo.js">` — inline the JS instead
- `<link rel="stylesheet" href="style.css">` — inline the CSS
- `import "./module.js"` — bundle with esbuild/rollup/vite
- `new Worker("worker.js")` — create a blob URL at runtime instead
- `fetch("./data.bin")` — base64-inline as a constant

### How to bundle for the single-file constraint

Three pragmatic approaches:

1. **Write it by hand.** For small plugins (< 500 lines of JS, no
   binary assets), just put everything in one HTML file. This is what
   the `templates/webview/` starter does.

2. **Use `vite-plugin-singlefile`.** For React/Svelte/Vue projects,
   `vite-plugin-singlefile` rolls your entire build into one HTML file
   automatically. Vite does the rest.

3. **Use `esbuild --bundle`.** For pure-JS projects:
   ```bash
   esbuild src/main.ts --bundle --minify --outfile=dist/bundle.js
   # Then manually inline dist/bundle.js into your HTML template
   ```

For embedding binary assets (WASM, WADs, fonts, sample data), base64
the binary and declare it as a `const`:

```js
const MY_WASM = "AGFzbQEAAAAB..."; // base64
const bytes = Uint8Array.from(atob(MY_WASM), c => c.charCodeAt(0));
const { instance } = await WebAssembly.instantiate(bytes, imports);
```

Base64 adds ~33% overhead. For anything over a few hundred KB you'll
want to automate the bundling step — see the DOOM example's
`bundle.mjs` for a ~30-line template-replacement approach.

---

## Sandboxing

The iframe mounts with this default sandbox attribute:

```html
<iframe sandbox="allow-scripts allow-same-origin">
```

**`allow-scripts`** — required. Without it the iframe can't run
JavaScript at all, which defeats the point.

**`allow-same-origin`** — required for most useful web APIs. Note that
because the iframe's `src` is a `blob:` URL, `allow-same-origin` does
**not** grant the iframe access to the tracker's DOM, cookies, or
localStorage. Blob URLs carry their own opaque origin.

**Extra tokens** are appended via the control's `sandbox` field:

```json
{ "type": "webview", "source": "web/index.html", "sandbox": "allow-pointer-lock" }
```

Typical extras:

- `allow-pointer-lock` — for FPS-style plugins that want mouse capture
- `allow-fullscreen` — if your plugin has a "go fullscreen" button
- `allow-popups` — if your plugin opens a dialog in a new window

**What the iframe cannot do** (even with all sandbox tokens):

- Access the parent document's DOM, cookies, or localStorage
- Navigate the parent frame
- Read the clipboard (without a user gesture)
- Access cameras, microphones, or geolocation (requires a user gesture
  and the iframe's origin is opaque, so permissions don't stick)
- Send network requests to CSP-restricted origins

This is deliberate. The tracker trusts plugins less than the rest of
the UI, even user-loaded ones.

---

## Keyboard focus and the tracker

When the user clicks on the iframe, the browser gives the iframe
keyboard focus. The tracker loses key input until the user clicks
somewhere outside the iframe. This is the normal browser behaviour and
usually what you want for games / visualizers.

If your plugin should **never** capture keyboard — e.g., a passive
scope or visualizer that reacts purely to tracker events — set
`acceptsFocus: false` on the webview control. This applies
`pointer-events: none` to the iframe container, so mouse events pass
through to the tracker and the iframe can't grab focus.

Example:

```json
{ "type": "webview", "source": "web/scope.html", "acceptsFocus": false }
```

The iframe still renders and still receives `postMessage` events — it
just can't eat user input.

---

## Common patterns

### Reference-counted key gating

If multiple tracker notes map to the same "key" in your hosted
document (e.g., DOOM's `FIRE` key), you want one keyDown on the
*first* note that maps to that key, one keyUp on the *last* release —
not one keyDown per overlapping note. See `examples/doom-wasm/src/template.html`
for the pattern: `Map<key, Set<note>>`, keyDown when the set
transitions from empty, keyUp when it transitions back.

### Init handshake with WASM instantiation

```js
// Post ready AFTER installing the message listener so queued events aren't lost
window.addEventListener("message", handleEvent);
window.parent.postMessage({ type: "__nt_ready" }, "*");

// Then instantiate the WASM in the background
WebAssembly.instantiate(bytes, imports).then(({ instance }) => {
  // Game is ready — start the tick loop
});
```

Events that arrive before WASM is ready queue up in your listener,
get buffered in a JS array, and replay after instantiation. The DOOM
example uses this pattern.

### Render loop

Don't use `setInterval(tickGame, 1000/60)` naively — browsers throttle
it. Use `requestAnimationFrame` for visual updates, and `setInterval`
only for game-logic ticks that must run at a fixed rate (e.g., DOOM's
35 Hz tick). The two can run at different rates.

```js
// 35 Hz simulation
setInterval(() => instance.exports.tickGame(), 1000 / 35);

// Display-synchronised render (driven by drawFrame callback from WASM,
// not by rAF — our DOOM example uses this approach)
```

### Reacting to param changes

```js
let currentCutoff = 0.5;
window.addEventListener("message", (e) => {
  if (e.data?.type === "param" && e.data.key === "cutoff") {
    currentCutoff = e.data.value;
  }
});
// Then read currentCutoff from whatever's drawing your UI
```

---

## Gotchas

**Content Security Policy.** The nanoTracker host ships a CSP that
allows `blob:` iframes with `'unsafe-inline'` scripts so webview
plugins can run inline `<script>` tags. If you deploy the tracker
behind a stricter CSP, `frame-src 'self' blob:` and
`script-src ... 'unsafe-inline'` are both required for webview
plugins to work. Without the first, the iframe can't mount;
without the second, the inlined `<script>` tags inside the iframe
are silently blocked because `blob:` iframes with `allow-same-origin`
inherit the parent's CSP.

**No audio through tracker bus in v1.** If your webview plugin makes
sound, it plays through the iframe's own `AudioContext` — not the
tracker master bus. You can't run a dub delay FX plugin on your
webview's audio output yet. The `acceptsAudioFrames` field is reserved
for a future v2 that adds PCM route-back, but v1 ignores it. If the
gag of your plugin depends on the audio mixing with the tracker, this
is not the feature for you yet.

**5 MB is fine, 50 MB is asking for trouble.** Browsers handle large
base64 blobs, but the tracker loads the whole archive into memory when
it parses your plugin. The DOOM example is 5.9 MB and loads in
~200 ms; doubling that is probably still OK; 50 MB would make the
tracker's plugin panel laggy and eat RAM on low-end devices.

**Hot reload is manual.** Changing `web/index.html` requires re-packing
the `.ntins` and re-loading the plugin. There's no watcher. Write
tests that exercise the bridge protocol in a standalone HTML file you
can open directly in the browser, and only pack into `.ntins` when
you're close to shipping.

---

## See also

- [`00-getting-started.md`](00-getting-started.md) — the minimum-viable
  plugin walkthrough, uses a webview control
- [`10-wasm-in-webview.md`](10-wasm-in-webview.md) — the DOOM example,
  which is "everything on this page at full difficulty"
- [`reference/event-bus.md`](reference/event-bus.md) — formal
  TypeScript types for every event the bridge forwards
- [`reference/schema.md`](reference/schema.md) — every field of every
  plugin.json control type, including webview
