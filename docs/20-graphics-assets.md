# Graphics & rich assets (`assets`)

> **You need this page if:** your plugin wants to ship images,
> animated sprite sheets, SVG artwork, custom fonts, pre-baked
> wavetable data, or arbitrary JSON lookup tables inside the
> `.ntins` / `.ntsfx` archive — and use them from the native UI,
> from a webview iframe, or both.

Every plugin archive can include a top-level `assets` block in
`plugin.json`. The loader decodes every referenced file at load
time and exposes the results to the UI renderer and (via the
webview bridge) to sandboxed iframes. No runtime fetching, no
path manipulation — authors reference assets by stable ids.

---

## Minimum viable `assets` block

```jsonc
{
  "schemaVersion": 4,
  "assets": {
    "images": [
      { "id": "logo", "file": "assets/logo.png" }
    ]
  },
  "ui": {
    "layout":   "flex",
    "controls": [
      { "type": "image", "asset": "logo", "width": 120, "height": 48 }
    ]
  }
}
```

Put `logo.png` in an `assets/` folder inside the plugin source
directory, pack the plugin with `ntpack`, and the host renders a
120×48 `<img>` of your logo on the plugin window.

---

## Full `assets` schema

```ts
interface PluginAssetsDef {
  images?:     { id: string; file: string }[];
  sprites?:    {
    id: string;
    file: string;
    frames: number;
    frameW: number;
    frameH: number;
    tint?: string;              // optional theme-key tint
  }[];
  svg?:        { id: string; file: string }[];
  fonts?:      { id: string; file: string; family: string }[];
  wavetables?: { id: string; file: string }[];
  data?:       { id: string; file: string }[];
  icon?:       { file: string };
}
```

Every entry has a stable `id` used by UI controls and the webview
bridge. `file` is always archive-relative (starts from the
`.ntins` / `.ntsfx` root, not the plugin source path).

### Asset-kind table

| Kind | Decoder | Accepted file types | Runtime form |
|---|---|---|---|
| `images` | `createImageBitmap(blob)` + `URL.createObjectURL(blob)` | PNG, JPEG, WEBP, GIF (first frame), BMP | `{ bitmap: ImageBitmap, url: string, w, h }` |
| `sprites` | `createImageBitmap(blob)` + `URL.createObjectURL(blob)` | Same as images | `{ bitmap, url, frames, frameW, frameH, tint? }` |
| `svg` | `URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }))` | SVG text | `{ text: string, url: string }` |
| `fonts` | `new FontFace(family, ab).load()` + `document.fonts.add()` | WOFF2, WOFF, TTF, OTF | `FontFace` registered under `family` |
| `wavetables` | `JSON.parse` | Any JSON | Parsed value (usually `Float32Array` data) |
| `data` | `JSON.parse` | Any JSON | Parsed value (any shape) |
| `icon` | `URL.createObjectURL(blob)` | PNG, JPEG, WEBP, GIF, SVG, BMP | `{ url: string }` — surfaces in the instrument slot picker |

All decoders are **non-fatal**. If a sprite PNG fails to decode
(corrupt file, unsupported format), the host logs a console
warning and the `bitmap` field is `null`; the plugin still loads.

---

## Native UI controls

Two new `ui.controls[]` types reference asset ids:

### `image`

```jsonc
{
  "type": "image",
  "asset": "logo",      // id from assets.images[]
  "width": 120,         // optional — defaults to the natural image width
  "height": 48,         // optional — defaults to the natural image height
  "label": "logo"       // optional — used as the alt text
}
```

Renders `<img src={url} width={...} height={...} />` with
`object-fit: contain` and `image-rendering: pixelated` (suited to
pixel-art plugin UIs; override via your own CSS if you need
bilinear filtering).

### `sprite`

```jsonc
{
  "type": "sprite",
  "asset": "knob_anim",  // id from assets.sprites[]
  "width": 96,
  "height": 96
}
```

Renders a canvas that cycles through the sprite's frames at 10
fps, drawing from the atlas using the `frames` / `frameW` /
`frameH` grid declared in the manifest. For richer animation
control (named animations, one-shot triggers, chaining), use the
[`PluginSpriteAnimator`](#pluginspriteanimator) primitive
described below instead of the built-in `sprite` control.

---

## Sprite sheets

A sprite sheet is a single image atlas laid out in a grid, with
per-frame metadata declared in the manifest:

```jsonc
{
  "assets": {
    "sprites": [
      {
        "id":     "led_pulse",
        "file":   "assets/led_pulse_8f.png",
        "frames": 8,
        "frameW": 32,
        "frameH": 32
      }
    ]
  }
}
```

The atlas must be laid out left-to-right, top-to-bottom at
`frameW × frameH`. The host computes `cols = round(atlasWidth /
frameW)` and extracts frames by index:

```
cols = 4 (128px / 32px)
frame 0 → (0, 0)        frame 1 → (32, 0)   frame 2 → (64, 0)   frame 3 → (96, 0)
frame 4 → (0, 32)       frame 5 → (32, 32)  frame 6 → (64, 32)  frame 7 → (96, 32)
```

Frame count matches the manifest's `frames` field. The host doesn't
auto-detect — overcounting crops blank frames, undercounting drops
valid frames from the cycle.

### Theme tint (opt-in)

Declare `tint` on a sprite to opt into theme-driven colourisation:

```jsonc
{
  "id":     "led_pulse",
  "file":   "assets/led_pulse_8f.png",
  "frames": 8,
  "frameW": 32,
  "frameH": 32,
  "tint":   "accent"
}
```

When a `tint` key is set, the animator applies a
`globalCompositeOperation: "source-in"` tint pass at render time,
filling the sprite's silhouette with the resolved theme colour
while preserving its alpha edges. The key is looked up via the
host's theme resolver and resolves to one of the eleven canonical
theme colours (`"accent"`, `"primary"`, `"primaryGlow"`, `"text"`,
`"textDim"`, `"bg"`, `"bgElevated"`, `"border"`, `"success"`,
`"warning"`, `"error"`).

Sprites **without** a `tint` key render the atlas at its original
colours — no tint pass, no composite operation, pixels go through
untouched. That's the default. Tinting is strictly opt-in; if you
want a pixel-art sprite to keep its hand-painted colours, leave
`tint` off.

Cached frames are keyed by tint colour, so re-tinting on a theme
change only recomputes frames for the new colour — the original
atlas isn't re-decoded.

---

## `PluginSpriteAnimator`

The richer primitive behind the `sprite` control type is
`PluginSpriteAnimator` (exported from `pluginSprite`). Use it when
you need keyed named animations (idle / trigger / chain) instead
of a single looping atlas.

### Keyed animation API

```ts
import { PluginSpriteAnimator } from "@/lib/pluginSprite";

const animator = new PluginSpriteAnimator({
  fps: 10,
  resolveTint: key => themeColour(key),   // return the CSS colour for a theme key
});

// Register animations by key. `isIdle: true` marks the fallback
// loop that runs when nothing else is playing.
animator.loadFromPlugin("idle",    plugin, "led_idle",    { loop: true, isIdle: true });
animator.loadFromPlugin("trigger", plugin, "led_trigger", { loop: false });
animator.loadFromPlugin("burn",    plugin, "led_burn",    { loop: true });

// Optional: auto-transition from one-shot to loop.
animator.chain("trigger", "burn");

// On user action:
animator.trigger("trigger");   // fires once, then chains to "burn"

// Per frame (inside requestAnimationFrame):
animator.update(dt);                  // dt in seconds
animator.draw(ctx, x, y, 64, 1.0);    // x, y, maxH (optional), alpha
```

### Priority

The animator's draw priority is:

1. An active one-shot (just `triggered`).
2. A chained loop (auto-activated when the one-shot finished).
3. The registered idle loop.

If none is available, `draw()` is a no-op — you never get a blank
frame artifact.

### Frame cache

Tinted frames are cached per `(sheet, tint-colour)` pair. Changing
the theme colour midstream via `setResolveTint()` invalidates the
cache lazily on next draw — there's no manual flush step. If you
register an animator whose sprite has **no** `tint` key, the cache
stores a single `"__raw"` entry and the tint resolver is never
consulted.

---

## Webview access

Webviews get the full asset catalogue posted to them on the
`__nt_ready` handshake. Your iframe's message handler sees a
single `assetsAvailable` message:

```js
window.addEventListener("message", e => {
  const data = e.data;
  if (data?.type === "assetsAvailable") {
    // data.assets is a map: id → { kind, url, meta? }
    const logo = data.assets.logo;
    if (logo) document.getElementById("logo").src = logo.url;

    const sprite = data.assets.led_pulse;
    // sprite.meta = { frames, frameW, frameH, tint? }
    // sprite.url  = ObjectURL of the atlas
  }
});
```

The map keys are your asset ids. The `__icon` key (with leading
double underscore) is reserved for the icon shorthand.

### Font catalogue

Fonts are additionally announced via `fontsAvailable`:

```js
case "fontsAvailable":
  // data.fonts = [{ id: "lcd", family: "LCD" }, ...]
  // The FontFace is already registered in the host document.
  // Iframes must re-declare @font-face themselves via url(blob).
  break;
```

Fonts are registered in the host document's `FontFaceSet` at load
time, but iframes live in their own FontFaceSet and need their
own registration. The simplest path: inline an `@font-face` block
in your webview HTML that references the asset's URL from the
`assetsAvailable` map:

```js
case "assetsAvailable": {
  const { assets, fonts } = collect(data);   // if you got both messages
  if (fonts) {
    const style = document.createElement("style");
    style.textContent = fonts.map(f => {
      const a = assets[f.id];
      return `@font-face { font-family: "${f.family}"; src: url("${a.url}"); }`;
    }).join("\n");
    document.head.appendChild(style);
  }
  break;
}
```

(Authors generally don't write this by hand; a utility layer in
your webview boilerplate handles it. The `scaffold-webview-pedal`
skill generates the boilerplate.)

### Capability gating

Webviews that reference asset URLs at load time (e.g. inline
`<img src="...">` pointing at a blob URL from a previous boot)
must declare `"assets"` in `requires[]` so the validator can warn
if the block is missing. Webviews that only consume the posted
catalogue asynchronously — the typical pattern — can skip the
capability flag.

---

## Sprite-knob pattern (manual)

If you want a sprite-driven knob that responds to parameter
changes, wire the `PluginSpriteAnimator` to your knob's current
value:

```ts
// In your webview or a custom React control:
const knob_frames = data.assets.knob_sheet;  // { url, meta: { frames, frameW, frameH } }
const atlas = new Image();
atlas.src = knob_frames.url;

function drawKnob(ctx, currentParam /* 0..1 */) {
  const { frames, frameW, frameH } = knob_frames.meta;
  const idx = Math.floor(currentParam * (frames - 1));
  const cols = Math.round(atlas.width / frameW);
  const sx = (idx % cols) * frameW;
  const sy = Math.floor(idx / cols) * frameH;
  ctx.clearRect(0, 0, frameW, frameH);
  ctx.drawImage(atlas, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
}
```

A future SDK release may promote this into a first-class
`sprite-knob` control type; the manual pattern is what authors
should use today.

---

## Host-side `LoadedPlugin.assets`

The decoded asset bundle lives on `LoadedPlugin.assets`:

```ts
interface PluginDecodedAssets {
  images:     Map<string, { bitmap: ImageBitmap | null; url: string; w: number; h: number }>;
  sprites:    Map<string, { bitmap: ImageBitmap | null; url: string; frames: number; frameW: number; frameH: number; tint?: string }>;
  svg:        Map<string, { text: string; url: string }>;
  fonts:      Map<string, FontFace>;
  wavetables: Map<string, unknown>;
  data:       Map<string, unknown>;
  icon?:      { url: string };
}
```

The native `PluginUiRenderer` reads this bundle for the
`image` / `sprite` control types. Authors running custom React
controls inside their own `webview` HTML receive the same data
via the `assetsAvailable` bridge message.

---

## Non-breaking notes

- Plugins without an `assets` block load exactly as before —
  `LoadedPlugin.assets` is `undefined` and the UI renderer's
  `image` / `sprite` branches short-circuit to a placeholder.
- The existing `webviewAssets` map (archive-path → blob-URL for
  HTML files referenced by webview controls) is unchanged; it
  coexists with the new bundle.
- Existing plugins continue to use sample paths, oscillator
  config, etc. the way they always have — assets is additive.

---

## Gotchas

### "My sprite only plays one frame."

Check `frames`, `frameW`, `frameH` match the atlas. If the atlas
is 128×32 and you declare `frameW: 64`, the host thinks you have
2 columns; if you also declare `frames: 8`, the host walks off
the atlas looking for rows that don't exist and you get duplicate
or blank frames.

### "The tint pass is making my sprite monochrome."

That's what `source-in` composite does — it fills the sprite's
alpha with a single colour. If you want your sprite to keep its
original colours, remove the `tint` key. Tinting is opt-in
precisely so pixel-art sprites don't get accidentally wiped.

### "My webview sees `assets` but the URLs don't load."

ObjectURLs are scoped to the host document. Your iframe can
fetch them because it's same-origin with the host (the blob URL
origin matches `window.location.origin`), but if you copy a URL
across a true origin boundary (e.g. a third-party iframe, a
worker without transfer), it won't work. Use the posted URLs
directly — don't pass them through `fetch` and re-emit as a new
blob.

### "My font loads in the host but the webview doesn't see it."

Each iframe has its own `FontFaceSet`. The host registers the
font in the top document; the iframe needs to register it
separately, typically by injecting an `@font-face` style that
references the font's URL from the asset catalogue. See the
[font catalogue](#font-catalogue) section above.

### "`createImageBitmap` rejects my indexed-colour PNG."

Some browsers (Safari especially) don't accept certain colour
modes. Re-export as 24- or 32-bit RGBA. This is a browser
platform quirk, not a host issue.

---

## See also

- [`03-ui-controls.md`](03-ui-controls.md) — native UI control
  reference
- [`09-webview.md`](09-webview.md) — webview bridge (`__nt_ready`,
  `assetsAvailable`, `fontsAvailable`)
- [`21-window-sizing.md`](21-window-sizing.md) — fitting your
  window chrome around a sprite canvas
- [`reference/host-capabilities.md`](reference/host-capabilities.md)
  — the `assets` capability flag
