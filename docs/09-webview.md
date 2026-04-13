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
| `forwardEffects` | `false` | *(v3.5)* forward `trackerEffect` events (raw MOD effect-column bytes). See [`reference/event-bus.md`](reference/event-bus.md#trackereffect-v35). |
| `acceptsAudioFrames` | `false` | *(v3.5)* route PCM audio posted from the iframe back into the host's per-instrument output chain. See [`12-webview-audio.md`](12-webview-audio.md). |
| `acceptsFocus` | `true` | when `false`, disables pointer events on the iframe so the tracker keeps keyboard focus even while the cursor is over it |
| `acceptsParamWrites` | `false` | *(v4)* iframe can post `{type:"paramWrite",key,value}` to set parameter values. Requires `"webview-writes"` capability. See [Bidirectional bridge (v4)](#bidirectional-bridge-v4). |
| `acceptsPresetWrites` | `false` | *(v4)* iframe can post `presetLoad` / `presetSave`. Requires `"webview-writes"`. |
| `acceptsNotes` | `false` | *(v4)* iframe can post `noteOn` / `noteOff` into the plugin's voice engine. Requires `"webview-writes"`. |
| `acceptsHostCommands` | `false` | *(v4)* iframe can post `hostCommand` messages (focus, resize, toast, sample picker). Requires `"webview-writes"`. |

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
    case "noteOn":        /* ev.note, ev.velocity, ev.time */ break;
    case "noteOff":       /* ev.note, ev.time */ break;
    case "allNotesOff":   /* ev.time */ break;
    case "pitch":         /* ev.frequencyHz, ev.time */ break;
    case "gain":          /* ev.gain, ev.time */ break;
    case "param":         /* ev.key, ev.value */ break;
    case "trackerEffect": /* ev.effectCode, ev.value, ev.time (v3.5) */ break;
    case "themeChange":   /* ev.theme (v3.5 — ThemeColorSet) */ break;
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

**Filtering:** the `forwardNotes` / `forwardParams` / `forwardEffects`
flags on the control decide which event classes reach the iframe.
`themeChange` is always delivered (low frequency — mount + theme
swaps). If you only care about parameter automation (e.g., a knob
visualizer), set `forwardNotes: false` to save postMessage bandwidth.

### Picking up theme colours inside the iframe (v3.5)

The host posts a `themeChange` event shortly after the ready handshake
with a fully-resolved 11-key `ThemeColorSet`. A tiny handler is enough
to make your iframe follow the tracker's theme:

```js
case "themeChange":
  for (const [k, v] of Object.entries(ev.theme)) {
    // camelCase → kebab-case: "primaryDim" → "--color-primary-dim"
    const cssVar = "--color-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
    document.documentElement.style.setProperty(cssVar, v);
  }
  break;
```

Now your stylesheet can use `var(--color-primary)` / `var(--color-bg)`
and your iframe stays in sync with theme changes (including per-plugin
`ui.themeOverride` — the resolved values arrive pre-merged).

### What the iframe can post back

Pre-v4 the bridge was read-only: the host mounted the iframe, forwarded
events, and ignored everything except `__nt_ready` and (v3.5)
`__nt_audio`. v4 opens a typed write channel so interactive webview UIs
— mixer pedal faders, in-plugin preset browsers, step sequencers — can
drive the host instead of just visualising it.

Always-available iframe-originated messages (all versions):

- `{ type: "__nt_ready" }` — **ready handshake.** Flushes the queued
  event stream early (otherwise the host waits for the iframe's
  `load` event). Always send this as the first line of your script.
- `{ type: "__nt_audio", left, right?, sampleRate? }` — **v3.5 PCM
  route-back.** Only active when the control declares
  `acceptsAudioFrames: true`. See [`12-webview-audio.md`](12-webview-audio.md).

### Bidirectional bridge (v4)

Opt in by declaring both:

1. `"webview-writes"` in top-level `requires[]`
2. The matching per-control flag (`acceptsParamWrites`,
   `acceptsPresetWrites`, `acceptsNotes`, `acceptsHostCommands`)

With opt-in, the iframe can post:

```js
// Drag a fader:
window.parent.postMessage({ type: "paramWrite", key: "cutoff", value: 2400 }, "*");

// Load a factory preset (see "presetList" event for the available ids):
window.parent.postMessage({ type: "presetLoad", presetId: "preset-1" }, "*");

// Save the current params as a new user preset:
window.parent.postMessage({
  type: "presetSave",
  name: "My Init",
  params: { cutoff: 2400, resonance: 0.5 }
}, "*");

// Trigger a note from an in-iframe keyboard:
window.parent.postMessage({ type: "noteOn",  note: 60, velocity: 100 }, "*");
window.parent.postMessage({ type: "noteOff", note: 60 },                 "*");

// Ask the host for generic UX services:
window.parent.postMessage({ type: "hostCommand", command: "focusRequest" },                 "*");
window.parent.postMessage({ type: "hostCommand", command: "resizeRequest", args: { w: 480, h: 320 } }, "*");
window.parent.postMessage({ type: "hostCommand", command: "showToast",     args: { text: "Saved", kind: "info" } },  "*");
window.parent.postMessage({ type: "hostCommand", command: "openSamplePicker" },             "*");
```

**Validation.** Every write runs through manifest checks on the host:

| Message | Checked against | On failure |
|---|---|---|
| `paramWrite` | `parameters[].key` exists; value clamped to `min`/`max` | dropped, `__nt_error` back |
| `presetLoad` | `presetId` resolves in current preset catalogue | dropped, `__nt_error` back |
| `presetSave` | `name` non-empty, ≤64 chars; params match known keys | dropped, `__nt_error` back |
| `noteOn` / `noteOff` | `note` 0..127, `velocity` 0..127 | clamped |
| `hostCommand` | `command` in whitelist | dropped, `__nt_error` back |

Dropped writes never throw; the host posts a diagnostic back:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "__nt_error") {
    console.warn("[nt] write rejected:", e.data.where, e.data.message);
  }
});
```

**`hostCommand` whitelist.** The four commands above are the spec
surface for v4.x. The host may ignore a command for UX reasons (e.g.
`focusRequest` fails if the user has focused another window) — failures
are silent by design. Authors should treat `hostCommand` as an
advisory hint, not an imperative.

**The `presetList` event.** The host posts the current preset catalogue
as a `{type:"presetList", presets:[{id,name},…]}` event after the
ready handshake (when the plugin authors at least one factory
preset). v4.0 fires it once on mount; v4.1 will refire after every
`presetSave` and on project reload.
See [`reference/event-bus.md`](reference/event-bus.md#presetlist-v4).

### v4.0 implementation status

| Message | v4.0 |
|---|---|
| `paramWrite` | ✅ wired into the workspace; param updates take effect immediately and persist through save/load |
| `noteOn` / `noteOff` | ✅ dispatched into the plugin's voice engine exactly as if the user played them from the tracker keyboard |
| `presetLoad` | ✅ resolves `"preset-N"` (numeric index) or a factory preset by name and applies it to the plugin |
| `presetList` (host→iframe) | ✅ fired once on iframe mount when the plugin has factory presets |
| `presetSave` | ⚠️ validated and acknowledged but the host doesn't yet persist user-saved presets — reserved for v4.1 |
| `hostCommand` | ⚠️ validated against the whitelist; the v4.0 host dispatcher is not wired so commands no-op silently — reserved for v4.1 |

Plugin authors can declare `acceptsPresetWrites` / `acceptsHostCommands`
today and the bridge stays well-typed; just don't depend on the
presetSave/hostCommand side effects landing in v4.0.

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

**Audio through tracker bus is opt-in (v3.5).** By default a webview
plugin's audio plays through the iframe's own `AudioContext`, not the
tracker's bus — set `acceptsAudioFrames: true` on the webview control
and post `{ type: "__nt_audio", left, right? }` messages up to the
host to route PCM into the instrument's output chain. Channel volume,
pan, and FX then apply the same way as any other plugin. See
[`12-webview-audio.md`](12-webview-audio.md) for the protocol and a
worked example.

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
