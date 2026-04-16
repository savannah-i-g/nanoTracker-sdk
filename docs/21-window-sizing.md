# Window sizing (`ui.windowSize`)

> **You need this page if:** your plugin has a specific preferred
> window size, a maximum size beyond which the UI looks silly, a
> locked aspect ratio (oscilloscope, XY pad), or you want to lock
> the window to a fixed non-resizable size.

Plugin window chrome is shared with every other floating window
in nanoTracker — draggable titlebar, corner resize handle, close
button. By default, windows open at an internal host default,
clamp to a minimum of 240×160 logical pixels, and resize up to
the viewport.

For fine-grained control, declare `ui.windowSize` on the plugin
manifest.

---

## Minimum viable `windowSize` block

```jsonc
{
  "ui": {
    "layout":  "flex",
    "controls": [],
    "windowSize": {
      "default": { "w": 480, "h": 320 },
      "min":     { "w": 360, "h": 240 },
      "max":     { "w": 720, "h": 480 }
    }
  }
}
```

When the user first opens the plugin, it appears at 480×320. They
can drag the corner to resize within 360×240 to 720×480. The
viewport-availability clamp still applies — on a narrow display
the effective maximum is whichever is smaller.

---

## Full `windowSize` schema

```ts
interface PluginWindowSizeDef {
  default?:    { w: number; h: number };  // initial size on first open
  min?:        { w: number; h: number };  // lower bound on resize
  max?:        { w: number; h: number };  // upper bound on resize
  resizable?:  boolean;                    // default true; false locks the window
  aspectRatio?: string;                    // e.g. "16/9" or "1.6"
  hideResizeHandle?: boolean;              // default false; true hides the handle but keeps resize
}
```

Every field is optional. Omitting the block entirely keeps the
legacy behaviour (host defaults + hardcoded 240×160 minimum).

### Field reference

| Field | Effect |
|---|---|
| `default` | The initial size applied the first time the user opens the plugin window. Subsequent opens restore the user's last-chosen size from `.ftrk` project state. |
| `min` | Hard lower bound. The resize handle can't drag smaller; programmatic layout shrink can't go below this either. Supersedes the legacy `ui.minWidth` / `ui.minHeight` when present. |
| `max` | Hard upper bound. The resize handle stops at this size even if the viewport would allow more. Viewport still wins when it's **smaller** than max — your plugin will fit on a laptop screen even if you declared `max: 1600`. |
| `resizable` | `false` disables resize gestures entirely and hides the handle. Useful for fixed-layout plugins. Default `true`. |
| `aspectRatio` | String expressing a locked W/H ratio. Accepts `"W/H"` syntax (e.g. `"16/9"`, `"4/3"`) or a decimal (`"1.6"`). When set, resize drags constrain width / height proportionally. Default: unconstrained. |
| `hideResizeHandle` | `true` hides the corner resize handle visually while still allowing programmatic resize. When `resizable: false`, this is implied. |

---

## Resize behaviour

### Drag bounds

The resize handle honours `min` and `max` at every pointer event.
The window's **preferred** size (the user's intended dimensions,
kept even when the viewport squishes it) updates during drag; the
**displayed** size is `clamp(preferred, min, max ∩ viewport)`.

This means that if the user resizes the plugin to 800×600, then
shrinks their browser window to 700 px wide, the plugin compresses
to 700 but remembers 800 as the preferred. Expanding the browser
back restores 800 automatically — the user's intent isn't lost.

### Aspect-ratio lock

When `aspectRatio` is set, the resize logic biases to the
dominant axis. If the pointer moved more horizontally than
vertically during drag, width drives: `height = width / ratio`.
If vertical motion dominates, height drives: `width = height *
ratio`. The dominant-axis rule prevents the corner handle from
fighting the cursor.

Edge cases:

- If the computed paired dimension falls below `min`, the whole
  resize is rejected for that frame and the window stays at its
  current size.
- If the computed paired dimension exceeds `max`, the result is
  clamped to max on both axes (rather than on one), preserving
  the ratio.

### Viewport interaction

The viewport-availability clamp in `clampWindow` still runs on
every layout. If the manifest declares `max: 1600` but the
viewport is 1280 wide, the effective max is 1280. Conversely, if
the manifest declares `min: 400` and the viewport is only 320
wide, the window still renders at 400 and overflows — the user
can minimise or close it.

---

## Lock a window (non-resizable)

```jsonc
{
  "ui": {
    "windowSize": {
      "default":   { "w": 512, "h": 384 },
      "resizable": false
    }
  }
}
```

The window opens at 512×384 and stays there. The resize handle
is hidden automatically. Useful for plugins with fixed-layout art
(pixel-art UI, hand-drawn SVG panels) that don't scale gracefully.

`resizable: false` is also the correct choice for kiosk-style UIs
(oscilloscopes, meters) whose internal rendering assumes a fixed
canvas size.

---

## Fixed aspect ratio

```jsonc
{
  "ui": {
    "windowSize": {
      "default":    { "w": 480, "h": 270 },
      "min":        { "w": 320, "h": 180 },
      "max":        { "w": 960, "h": 540 },
      "aspectRatio": "16/9"
    }
  }
}
```

The window can be any size between 320×180 and 960×540, but always
locks to 16:9. User drags stretch it proportionally on both axes.

Common ratios:

| Use case | Ratio |
|---|---|
| Oscilloscope, spectrogram | `"16/9"`, `"2/1"` |
| XY pad | `"1/1"` |
| Modulation matrix | `"3/2"`, `"4/3"` |
| Step grid (per-step columns) | `stepCount/rowCount` |

---

## Hiding the handle without locking

Occasionally you want a resizable window but don't want the
grippy handle cluttering the corner:

```jsonc
{
  "ui": {
    "windowSize": {
      "resizable":        true,
      "hideResizeHandle": true,
      "min":              { "w": 240, "h": 160 },
      "max":              { "w": 800, "h": 600 }
    }
  }
}
```

The window is still resizable programmatically (for example, a
webview that posts a `hostCommand: "resize"` message — not yet
implemented, but reserved), but the user can't drag the corner.
Currently this means the window stays at its default unless the
user has another resize mechanism.

---

## Migration from legacy `minWidth` / `minHeight`

Older plugins set `ui.minWidth` / `ui.minHeight` directly on the
UI def:

```jsonc
{
  "ui": {
    "minWidth":  400,
    "minHeight": 300
  }
}
```

These still work. The host reads them as a fallback for
`windowSize.min` when the new block is absent. There's no need to
rewrite an existing plugin unless you want to add a `max` / aspect
ratio / lock — at which point adopt the `windowSize` block and
optionally remove the legacy fields (the loader prefers
`windowSize.min` when both are present).

---

## Validator behaviour

`ntvalidate` enforces the consistency rules the host relies on:

- `min.w`, `min.h`, `max.w`, `max.h`, `default.w`, `default.h`
  must all be positive integers.
- `min ≤ default ≤ max` on both axes when the respective
  dimensions are declared. The validator flags any violation
  (`"min.w (400) > default.w (320) — default must be between min and max"`).
- `aspectRatio` must be parseable as `"W/H"` or a decimal. Non-
  parseable strings are warnings, not errors — the host silently
  ignores them.

---

## Non-breaking notes

- Plugins without a `windowSize` block load exactly as before.
  Legacy `minWidth` / `minHeight` continue to work.
- The host clamps to a hardcoded 240×160 minimum when neither
  `windowSize.min` nor legacy `minWidth` / `minHeight` is
  declared.
- The block doesn't require a capability flag — it's a loose
  UI-def extension, additive to v4's existing `ui` shape.
- Existing `.ftrk` projects load unchanged. The persisted window
  state is re-clamped against the current manifest on reload, so
  a project saved with an 800×600 window on a plugin that now
  declares `max: 600` will open at 600×600 (or similar) on next
  load.

---

## Gotchas

### "My window opens at min, not default."

The first open uses `default`. Subsequent opens restore from
`.ftrk` project state. If you've been testing with an existing
project, the saved size is remembered — delete the project or
test in a fresh one to see `default` take effect.

### "Aspect ratio lock is 'jumpy' during drag."

The dominant-axis rule computes per-frame. If the cursor moves
diagonally, the axis that crosses its min/max faster wins. For
very sensitive drags, increase the `min` gap (e.g. `min: 400`
with `default: 800`) so the axis selection stabilises before
either side bottoms out.

### "My plugin renders tiny on a 4K display."

Set `max` generously. The host caps to viewport, but without a
manifest max the default behaviour is to let the window grow up
to the viewport edge. Declaring `max: 1600` caps proportionally
regardless of viewport size.

### "`resizable: false` doesn't prevent a tracker-display-settings
resize."

That's expected — the Display-tab window-scale slider zooms every
window uniformly via CSS transform. It doesn't resize the logical
window; it scales the visual output. `resizable: false` only
disables the interactive resize handle.

---

## See also

- [`01-plugin-format.md`](01-plugin-format.md) — full manifest
  layout
- [`03-ui-controls.md`](03-ui-controls.md) — native UI controls
  that live inside the window
- [`20-graphics-assets.md`](20-graphics-assets.md) — pairing
  `windowSize` with a sprite canvas
