---
name: add-theme-override
description: Add a per-plugin theme colour override to a nanoTracker plugin (instrument or pedal) via ui.themeOverride. Eleven canonical colour keys cascade to the plugin's window chrome and (for webview controls) re-post to the iframe as a themeChange event. Composable add-on; the plugin manifest already exists.
version: 1.0.0
metadata:
  hermes:
    tags: [nanotracker, plugin, theme, css, ui]
    category: audio-plugin-authoring
    requires_toolsets: [terminal, files]
---

# Add a theme override to a plugin

## When to use

Use this when a plugin's audio side already exists and you want it to
look distinct from the user's active host theme — a custom palette
that brands the plugin (orange-on-black, neon, pastel, etc.) while
still respecting any colours the user didn't override.

You can override any subset of the eleven canonical colour keys.
Omitted keys cascade from the host's currently-active theme via the
CSS custom-property cascade, so a partial override stays in sync with
the user's theme switches.

## Procedure

### 1. Declare the capability

```jsonc
"requires": [/* ...existing flags..., */ "themeOverride"]
```

The loader rejects plugins that set `ui.themeOverride` without this
capability flag.

### 2. Add `ui.themeOverride`

```jsonc
"ui": {
  /* ...layout / controls... */,
  "themeOverride": {
    "primary":       "#ff7a00",
    "primaryDim":    "#7a3a00",
    "primaryGlow":   "rgba(255,122,0,0.18)",
    "bg":            "#140800",
    "bgElevated":    "#1e0d2a",
    "text":          "#ffddbb",
    "textDim":       "#8a7a60",
    "border":        "#664422",
    "scanline":      "rgba(255,122,0,0.05)",
    "highlightBg":   "#ff7a00",
    "highlightText": "#140800"
  }
}
```

Subset is fine — only declare the keys you want to override:

```jsonc
"ui": {
  "themeOverride": {
    "primary": "#ff7a00",
    "bg":      "#140800"
    /* the other 9 keys cascade from the host theme */
  },
  "controls": [/* ... */]
}
```

### 3. The eleven canonical keys

| Key | Maps to CSS var | Used for |
|---|---|---|
| `primary` | `--color-primary` | Headlines, accents, output jacks, primary buttons |
| `primaryDim` | `--color-primary-dim` | Subdued accent (faded states) |
| `primaryGlow` | `--color-primary-glow` | Highlights, glows, CV port colour |
| `bg` | `--color-bg` | Window body background |
| `bgElevated` | `--color-bg-elevated` | Title bars, input controls |
| `text` | `--color-text` | Default text |
| `textDim` | `--color-text-dim` | Labels, inactive text |
| `border` | `--color-border` | Window borders, separators |
| `scanline` | `--color-scanline` | Optional CRT-effect overlay |
| `highlightBg` | `--color-highlight-bg` | Selection / active state background |
| `highlightText` | `--color-highlight-text` | Selection / active state text |

Use any valid CSS colour value — hex (`"#ff7a00"`), rgb/rgba
(`"rgb(255,122,0)"`, `"rgba(255,122,0,0.18)"`), hsl, named colours,
etc.

### 4. Webview cascade (automatic)

If the plugin has a `webview` UI control AND uses CSS custom
properties internally:

```css
body {
  background: var(--color-bg, #111);
  color:      var(--color-text, #ddd);
  border:     1px solid var(--color-border, #333);
}
```

…then the override automatically reaches the iframe via the host's
`themeChange` event:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "themeChange") {
    for (const [k, v] of Object.entries(e.data.theme)) {
      const cssVar = "--color-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
      document.documentElement.style.setProperty(cssVar, v);
    }
  }
});
```

The host fires `themeChange` shortly after the iframe's ready
handshake (with the resolved palette already merged) and again on
any host theme switch.

### 5. Re-validate

```bash
node tools/ntvalidate.mjs <plugin-dir>
```

The validator checks that every key in `themeOverride` is one of
the eleven canonical keys (typo-catching) and that the
`themeOverride` capability is declared.

## Pitfalls

- ❌ **Forgetting the `themeOverride` capability** — loader rejects
  with a clear message.
- ❌ **Typo in a key name** — `"backgroundd": "#000"` won't error
  loud, but the key is silently ignored at runtime. `ntvalidate`
  catches typos at pack time, so always run it.
- ❌ **Hardcoded `#xxx` in iframe stylesheets** — the override
  cascades via CSS variables; literal hex defeats it. Use
  `var(--color-foo, "<fallback>")` everywhere.
- ❌ **Setting all eleven keys when you only want to change one or
  two** — partial overrides are intentional. The fewer keys you
  override, the better the plugin looks under user theme switches.
- ❌ **Using `var()` references in override values** — the override
  values are passed straight to CSS; `var(--something)` would create
  a circular reference. Use literal colour values.
- ❌ **Treating `scanline` like a colour token** — it's actually a
  per-pixel rgba overlay applied via CSS. Use a low-alpha rgba
  (e.g. `"rgba(0,0,0,0.05)"`) rather than an opaque hex.

## Verification

1. `ntvalidate` passes
2. `ntpack` succeeds
3. Load the plugin in the host, open its window
4. Confirm the chrome (title bar, border, jack rings) shows your
   palette
5. Switch the host theme — confirm any KEYS YOU DIDN'T OVERRIDE
   change while the keys you did override stay
6. (If the plugin has a webview) confirm the iframe also picks up
   your colours via the `themeChange` event

## Reference

- [`../../docs/reference/schema.md#pluginthemeoverride-v35`](../../docs/reference/schema.md#pluginthemeoverride-v35)
  — every key + type signature
- [`../../docs/reference/host-capabilities.md#themeoverride`](../../docs/reference/host-capabilities.md#themeoverride)
  — capability flag detail
- [`../../docs/reference/event-bus.md#themechange-v35`](../../docs/reference/event-bus.md#themechange-v35)
  — webview event payload
- [`../../docs/09-webview.md#picking-up-theme-colours-inside-the-iframe-v35`](../../docs/09-webview.md#picking-up-theme-colours-inside-the-iframe-v35)
  — iframe-side handler pattern
- [`../../examples/v40-mixer-pedal/`](../../examples/v40-mixer-pedal/)
  — orange/black palette example
