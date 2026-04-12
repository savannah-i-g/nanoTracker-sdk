# `doom-wasm` — DOOM as a nanoTracker instrument plugin

> **Heads up:** this is the plugin-sdk's headline WebAssembly example. Read
> [CREDITS.md](./CREDITS.md) for attribution and licensing details before
> shipping anything derived from it. Short version: this example is
> GPL-2.0 because DOOM is.
>
> The long-form teaching walkthrough lives at
> [`../../docs/10-wasm-in-webview.md`](../../docs/10-wasm-in-webview.md) —
> this file is just "how to build and run the example locally".

## What it does

Embeds Jacob Enget's [doom.wasm](https://github.com/jacobenget/doom.wasm) v0.1.0
inside a nanoTracker v3 `webview` UI control. The tracker's host↔iframe
`postMessage` bridge forwards `noteOn` / `noteOff` events into the iframe,
which translates them into `reportKeyDown` / `reportKeyUp` calls on the
DOOM module. Holding a tracker note = holding a key. A looping pattern
*plays* DOOM.

DOOM runs silently (the v0.1.0 port has no audio yet — see the upstream
TODO list), but visual + controller integration is fully working.

## Files

```
doom-wasm/
├── plugin.json         nanoTracker plugin manifest, declares webview + dummy knob
├── src/
│   ├── template.html   hand-written host glue: WASM imports, canvas render, bridge
│   └── bundle.mjs      base64-inlines the .wasm into template.html
├── web/
│   └── doom.html       ⚠ built artifact — git-ignored, rebuild with bundle.mjs
├── doom.wasm           ⚠ downloaded binary — git-ignored, fetch from upstream
├── CREDITS.md          attributions, licenses, SHA-256 of the upstream binary
├── LICENSE             GPL-2.0 verbatim (from the upstream repo)
├── README.md           this file
└── .gitignore          excludes doom.wasm and web/doom.html
```

## Build from scratch

From this directory:

```bash
# 1. Download the upstream binary
curl -sSL -o doom.wasm \
  https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm

# 2. Verify the hash matches what CREDITS.md claims
sha256sum doom.wasm
# → 8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa  doom.wasm

# 3. Bundle — base64-inlines the wasm into template.html
node src/bundle.mjs doom.wasm
# → wrote .../web/doom.html  (5.81 MB, wasm 4.35 MB)

# 4. Package the .ntins (using plugin-sdk/tools/ntpack)
node ../../tools/ntpack.mjs . --out /tmp/nt-doom.ntins
```

Alternatively, without `ntpack`, build the archive with plain `zip`:

```bash
zip -r /tmp/nt-doom.ntins plugin.json web/doom.html LICENSE CREDITS.md
```

Both produce the same result — a ~2.5 MB `.ntins` archive ready to drop
into the nanoTracker plugins panel.

## Run it

1. Launch nanoTracker (`npm run dev`, open `/tracker`)
2. Open the **PLUGINS** panel
3. Click **+ LOAD PLUGIN (.ntins / .ntsfx)** and pick `/tmp/nt-doom.ntins`
4. Drag the **DOOM** instrument into the workspace
5. Open its window — the title screen renders
6. Click the canvas to give it keyboard focus, then use:
   - **↑ / ↓** — menu up/down
   - **Enter** — select
   - **Escape** — back out
   - **Ctrl** — fire, **Space** — use, **Shift** — run
   - **, / .** — strafe left/right
7. Once in a level, bind the DOOM instrument to a tracker channel
   (the ▣ button on its title bar) and play a pattern. Pitch-class
   mapping:

   | Pitch class | DOOM key     |
   |-------------|--------------|
   | C           | forward (↑)  |
   | C#          | strafe left  |
   | D           | back (↓)     |
   | D#          | strafe right |
   | E           | turn left (←)|
   | F           | turn right (→)|
   | F#          | fire         |
   | G           | use (space)  |
   | G#          | alt          |
   | A           | run (shift)  |
   | A#          | enter        |
   | B           | escape       |

   Notes in the top octave (C-7 and above) select weapons 1–8.

## What it demonstrates

This is the single biggest teaching example in the SDK because it hits
every non-trivial feature of the `webview` control at once:

- **Single-file HTML constraint** — everything (HTML, JS, 4.35 MB WASM)
  has to inline via base64 because the nanoTracker plugin loader
  rejects webview HTML that references sibling files. `bundle.mjs`
  shows the minimal viable bundler.
- **Host-implemented WASM imports** — the ten functions the DOOM module
  expects (`ui.drawFrame`, `loading.wadSizes`, `console.*`, etc.) are
  implemented in plain JS inside the iframe. This is the common shape
  for any WASM-in-browser project.
- **Canvas rendering from WASM memory** — `drawFrame(ptr)` reads pixels
  out of the exported WebAssembly memory using a `Uint32Array` view,
  does a BGRA→RGBA swap, and `putImageData`s to a 2D canvas.
- **Tracker events as controller input** — the `postMessage` bridge
  receives `{type: "noteOn", note, velocity, time}` events and
  synthesizes `reportKeyDown` calls with reference-counted key gating
  (holding two notes that map to the same key fires one keyDown).
- **Legal framing** — real-world GPL-2.0 handling, credits, source of
  the binary, relationship between upstream and derivative.

## See also

- The full walkthrough: [`plugin-sdk/docs/10-wasm-in-webview.md`](../../docs/10-wasm-in-webview.md)
- The webview control reference: [`plugin-sdk/docs/09-webview.md`](../../docs/09-webview.md)
- The plugin format reference: [`plugin-sdk/docs/01-plugin-format.md`](../../docs/01-plugin-format.md)
