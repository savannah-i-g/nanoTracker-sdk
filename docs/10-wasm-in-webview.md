# Running WebAssembly inside a webview plugin — the DOOM walkthrough

> **You need this page if:** you want to embed a WebAssembly binary
> inside a nanoTracker plugin. This is the single most demanding thing
> the `webview` control can do, and the best way to explain it is to
> walk through the worked example in [`../examples/doom-wasm/`](../examples/doom-wasm/),
> where a GPL-2.0 DOOM port runs fully inside an instrument window
> and its controller is wired to tracker note events.

Prerequisites for this page:

- You've read [`09-webview.md`](09-webview.md) and understand the
  single-file HTML constraint
- You've skimmed [`../examples/doom-wasm/README.md`](../examples/doom-wasm/README.md)
  and [`../examples/doom-wasm/CREDITS.md`](../examples/doom-wasm/CREDITS.md)
- You've got Node 18+ and a nanoTracker dev server running

This walkthrough is long on purpose — WASM-in-webview is real
engineering and every section is load-bearing.

---

## 1. "Can it run DOOM?"

Yes. The entire game, running inside a nanoTracker instrument panel,
controlled by tracker note events, shipped as a single `.ntins`
archive. The punchline: a looping pattern *plays* DOOM. Hold C for
forward, A for run, F# for fire, and the little guy stomps around
E1M1 in time with the beat.

Here's why it makes a good teaching example beyond the meme:

- **It's a real binary.** 4.35 MB of Emscripten-compiled C, not a
  hello-world. Everything that's hard about WASM-in-browser shows up.
- **Clean import/export contract.** The upstream port exposes four
  exported functions (`initGame` / `tickGame` / `reportKeyDown` /
  `reportKeyUp`) and ten imports (the host implements canvas render,
  time, console logging, save game, WAD loading). No Emscripten
  runtime mess, no SharedArrayBuffer, no COOP/COEP headers.
- **Canvas rendering from WASM memory.** `drawFrame(ptr)` hands you
  a pointer to a pixel buffer in the module's linear memory. You pull
  bytes out with a `Uint32Array` view and slap them onto a 2D canvas.
  Exactly the pattern you'd use for any WASM-based pixel pusher.
- **Input via `postMessage`.** Instead of reading DOM keyboard events
  (which the tracker has taken over), the iframe receives
  `{type: "noteOn", note, velocity}` from the host bridge and calls
  `reportKeyDown` with the corresponding DOOM key constant. This is
  the core trick: **tracker events as a controller API**.
- **Legal reality.** DOOM is GPL-2.0. Any plugin that statically
  links it inherits GPL-2.0. The SDK documents this honestly rather
  than hand-waving, because real-world WASM ports are often GPL and
  you should know how to handle it.

---

## 2. Legal and credits — read this before anything else

The DOOM example is **not public domain** and **not permissive-licensed**.
It is GPL-2.0 because three things are layered on top of each other:

1. **id Software's DOOM** (1993, C source released 1999-12-23 under
   GPL-2.0). The game engine, the algorithms, the level layouts, the
   sprites, the sounds. Upstream:
   <https://github.com/id-Software/DOOM>.

2. **Jacob Enget's `doom.wasm`** (2024, GPL-2.0). A WebAssembly
   compilation with a minimal import/export contract and a reference
   browser example. We use the v0.1.0 release:
   <https://github.com/jacobenget/doom.wasm>.
   - Binary: `doom-v0.1.0.wasm`, 4,559,928 bytes
   - SHA-256: `8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa`

3. **The DOOM Shareware WAD** (1993, redistributable under id's
   original shareware terms). *Embedded inside* `doom-v0.1.0.wasm`
   itself — when our host imports for `loading.wadSizes` and
   `loading.readWads` return nothing, the module falls back to the
   built-in shareware WAD. Episode 1 only. Do **not** substitute the
   commercial Ultimate Doom / Final Doom WADs — those are not
   shareware and not redistributable.

The `.ntins` archive produced from this example statically links a
GPL-2.0 WebAssembly module, so **the `.ntins` is a derivative work and
must be distributed under GPL-2.0.** You must offer source to anyone
you give the archive to. The source in this case is the files under
[`../examples/doom-wasm/`](../examples/doom-wasm/): `plugin.json`,
`src/template.html`, `src/bundle.mjs`, `CREDITS.md`, `LICENSE`.

**This does not infect the rest of your plugin collection, nanoTracker
itself, or the plugin-sdk tooling.** GPL-2.0 only reaches as far as
the static link boundary. A separate plugin you ship in the same panel
that doesn't use GPL code is unaffected.

[`../examples/doom-wasm/CREDITS.md`](../examples/doom-wasm/CREDITS.md)
spells all of this out in detail, with the upstream links, the SHA-256
of the binary for provenance, and a plain-language "what this means for
you" section. Read it.

If you're embedding a *different* WASM binary in your plugin, read
**its** upstream license and do the same analysis. Many popular ports
are MIT or BSD (chip-8 emulators, raycasters, demoscene code) and
impose no such obligations. A few (FFmpeg, LAME, most emulator cores)
are LGPL or GPL and require careful handling.

---

## 3. The upstream contract

The `doom.wasm` v0.1.0 module exposes the following interface. This is
quoted from the upstream release notes and reproduced here with
attribution:

**Exports** (host calls into these):

| Export | Signature | Purpose |
|---|---|---|
| `initGame` | `() → ()` | Initialise. Call once after instantiation. |
| `tickGame` | `() → ()` | Advance one game frame. Call at ~35 Hz. |
| `reportKeyDown` | `(i32) → ()` | Signal a key-down event. Arg is a DOOM key code. |
| `reportKeyUp` | `(i32) → ()` | Signal a key-up event. |
| `memory` | WebAssembly.Memory | Exported linear memory — you read pixel buffers from this. |
| `KEY_LEFTARROW`, `KEY_RIGHTARROW`, `KEY_UPARROW`, `KEY_DOWNARROW`, `KEY_STRAFE_L`, `KEY_STRAFE_R`, `KEY_FIRE`, `KEY_USE`, `KEY_SHIFT`, `KEY_TAB`, `KEY_ESCAPE`, `KEY_ENTER`, `KEY_BACKSPACE`, `KEY_ALT` | `i32 global` | Well-known DOOM key constants. Read them at init time to learn what integer to pass to `reportKeyDown`. |

**Imports** (the host — you — implements these):

| Import | Signature | Purpose |
|---|---|---|
| `loading.onGameInit` | `(width: i32, height: i32) → ()` | Called once when the game starts. Gives you the framebuffer dimensions so you can size your canvas. |
| `loading.wadSizes` | `(sizePtr: i32, countPtr: i32) → ()` | Called when the game wants to know about extra WAD files. Leave as a no-op to use the built-in shareware WAD. |
| `loading.readWads` | `(bufferPtr: i32, countPtr: i32) → ()` | Called to stream WAD bytes into the module's memory. Leave as a no-op for the default. |
| `ui.drawFrame` | `(framebufferPtr: i32) → ()` | Called every frame. Read `width * height * 4` bytes from the module's memory starting at `framebufferPtr` and push them to a canvas. |
| `runtimeControl.timeInMilliseconds` | `() → i64` | Return `BigInt(Math.trunc(performance.now()))`. |
| `console.onInfoMessage` | `(ptr: i32, len: i32) → ()` | Read `len` UTF-8 bytes from the module's memory starting at `ptr` and log them. |
| `console.onErrorMessage` | `(ptr: i32, len: i32) → ()` | Same but for errors. |
| `gameSaving.sizeOfSaveGame` | `(slot: i32) → i32` | Return 0 to disable saving. |
| `gameSaving.readSaveGame` | `(slot: i32, bufPtr: i32) → i32` | Return 0. |
| `gameSaving.writeSaveGame` | `(slot: i32, bufPtr: i32, len: i32) → i32` | Return 0. |

The module does **not** output audio (TODO in the upstream repo). The
DOOM example plugin plays silently. Adding audio would require an
upstream feature or a different port.

---

## 4. Host glue — walking through `template.html`

All code below is from [`../examples/doom-wasm/src/template.html`](../examples/doom-wasm/src/template.html).
This is the file the bundler base64-inlines `doom.wasm` into to
produce the final `web/doom.html` single-file plugin HTML.

### 4a. The document shell

A minimal HTML document with a full-bleed `<canvas>`, a tiny status
badge, and an overlay for the loading state:

```html
<div id="wrap">
  <canvas id="screen" tabindex="0"></canvas>
  <div id="status">INIT</div>
  <div id="overlay">
    LOADING DOOM.WASM (4.35 MB)…<br>
    <span id="overlay-msg">instantiating…</span>
  </div>
</div>
```

The canvas has `tabindex="0"` so the user can click to focus it and
use a real keyboard (fallback path), and `image-rendering: pixelated`
so the scaled-up framebuffer stays crunchy.

### 4b. The WASM-B64 placeholder

```html
<script>
// The bundler replaces the marker line below with
// `const DOOM_WASM_B64 = "...";` containing the base64-encoded
// doom.wasm bytes inline. Must land BEFORE the main boot script so
// the module-level boot() call can reference it synchronously.
/*###DOOM_WASM_B64_MARKER###*/
</script>
```

Two things matter here:

1. **The marker is in its own `<script>` block**, before the main
   boot script. The boot script calls `base64ToBytes(DOOM_WASM_B64)`
   synchronously during its IIFE, so the constant must already exist
   by the time that line runs. Splitting into two script tags
   guarantees the first one's declarations are available to the second.
2. **The marker is unique and machine-parseable.** Early in
   development I used `%%DOOM_WASM_B64%%` as the marker, which
   collided with a descriptive comment that mentioned `%%DOOM_WASM_B64%%`
   earlier in the template. `tpl.replace(marker, js)` is a
   "first occurrence wins" operation, so the comment got the ~6 MB
   base64 blob and the real placeholder was left untouched. The fix
   was to rename the marker to `/*###DOOM_WASM_B64_MARKER###*/`,
   which cannot appear by accident in descriptive prose. **Moral:
   when doing template substitution with string literals, pick a
   marker that's machine-unique.**

### 4c. The WASM imports

```js
const imports = {
  loading: {
    onGameInit,
    wadSizes: () => {},  // no-op → module uses built-in shareware WAD
    readWads: () => {},
  },
  ui: { drawFrame },
  runtimeControl: { timeInMilliseconds },
  console: { onInfoMessage, onErrorMessage },
  gameSaving: {
    sizeOfSaveGame: () => 0,
    readSaveGame:   () => 0,
    writeSaveGame:  () => 0,
  },
};
```

Every import from §3 is implemented. The save-game functions return
zero so the game won't try to save. The WAD loading imports are no-ops,
which triggers the module's fallback to the built-in shareware WAD —
that's the "no external WAD file needed" trick.

### 4d. `onGameInit`

```js
function onGameInit(width, height) {
  frameWidth  = width;
  frameHeight = height;
  canvas.width  = width;
  canvas.height = height;
  scratchImageData = ctx2d.createImageData(width, height);
  scratch32 = new Uint32Array(scratchImageData.data.buffer);
  setStatus(`${width}×${height}`);
}
```

DOOM's internal framebuffer is 320×200. When the module calls
`onGameInit(320, 200)`, we resize the canvas to match and allocate a
scratch `ImageData` the same size. We also alias the `ImageData`'s
byte buffer as a `Uint32Array` so the render loop can do one 32-bit
write per pixel instead of four 8-bit writes — ~4× faster and
noticeable at 35 Hz.

### 4e. `drawFrame` — the pixel transfer

```js
function drawFrame(framePtr) {
  const src = new Uint32Array(moduleMemory.buffer, framePtr, frameWidth * frameHeight);
  const dst = scratch32;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const p = src[i];
    // DOOM stores pixels as ARGB, but WASM is little-endian, so in
    // memory the byte order is BB GG RR 00 — i.e. reading 32 bits
    // gives us 0x00RRGGBB. We need 0xFFBBGGRR for ImageData (RGBA
    // stored little-endian means the low byte is the R channel).
    const r = (p >> 16) & 0xff;
    const g = (p >>  8) & 0xff;
    const b =  p        & 0xff;
    dst[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
  }
  ctx2d.putImageData(scratchImageData, 0, 0);
}
```

This is the only non-trivial line of code in the whole file: the
BGRA→RGBA shuffle with alpha force-set to `0xff`. Two things worth
understanding:

1. **`Uint32Array` view over WASM memory.** The WASM module writes
   pixels directly into its linear memory; we read them in-place as a
   32-bit typed-array view. Zero-copy from the module's point of view.
2. **Byte order.** `ImageData` stores pixels as little-endian RGBA,
   which means `data[0]=R, data[1]=G, data[2]=B, data[3]=A` in byte
   order — and a 32-bit read of that gives you `0xAABBGGRR`. DOOM's
   framebuffer format and the browser's `ImageData` format disagree
   on channel order, hence the shuffle.

This is the shape of every "WASM renders pixels to a canvas" bridge
you'll ever write. Adapt the channel order for your specific port.

### 4f. `window.addEventListener("message", ...)` — the controller

```js
window.addEventListener("message", (e) => {
  const ev = e.data;
  if (!ev || typeof ev !== "object") return;
  switch (ev.type) {
    case "noteOn": {
      const k = mapNoteToDoomKey(ev.note);
      if (k != null) keyDown(k, ev.note);
      break;
    }
    case "noteOff": {
      const k = mapNoteToDoomKey(ev.note);
      if (k != null) keyUp(k, ev.note);
      break;
    }
    case "allNotesOff":
      releaseAll();
      break;
  }
});
window.parent.postMessage({ type: "__nt_ready" }, "*");
```

Events arrive from the tracker host as `VoiceEngineEvent` objects
(see [`reference/event-bus.md`](reference/event-bus.md)). We switch on
`ev.type` and translate:

- `noteOn` → `reportKeyDown(mapNoteToDoomKey(ev.note))`
- `noteOff` → `reportKeyUp(...)`
- `allNotesOff` → release every currently-held key

The ready handshake at the bottom flushes any events the host queued
while the iframe was still instantiating WASM. Because WASM
instantiation is async and ~200 ms long, without this handshake the
first few events after load would be lost.

### 4g. `mapNoteToDoomKey` — the pitch-class controller

```js
function mapNoteToDoomKey(note) {
  if (!keyConstants) return null;
  if (note >= 96) {
    // Weapon select: C-7 and up → '1' … '8'
    const slot = (note - 96) + 1;
    if (slot >= 1 && slot <= 9) return "1".charCodeAt(0) + (slot - 1);
  }
  const pc = ((note % 12) + 12) % 12;
  switch (pc) {
    case 0:  return keyConstants.KEY_UPARROW;     // C — forward
    case 1:  return keyConstants.KEY_STRAFE_L;    // C#
    case 2:  return keyConstants.KEY_DOWNARROW;   // D — back
    case 3:  return keyConstants.KEY_STRAFE_R;    // D#
    case 4:  return keyConstants.KEY_LEFTARROW;   // E — turn L
    case 5:  return keyConstants.KEY_RIGHTARROW;  // F — turn R
    case 6:  return keyConstants.KEY_FIRE;        // F# — fire
    case 7:  return keyConstants.KEY_USE;         // G — use
    case 8:  return keyConstants.KEY_ALT;         // G#
    case 9:  return keyConstants.KEY_SHIFT;       // A — run
    case 10: return keyConstants.KEY_ENTER;       // A#
    case 11: return keyConstants.KEY_ESCAPE;      // B
  }
  return null;
}
```

Bucket notes by pitch class (0–11 for C through B) so the player can
pick any comfortable octave. Top octave (C-7 and above) is the weapon
selector — note numbers 96 through 103 map to ASCII `'1'` through `'8'`,
which DOOM accepts as weapon-select keys.

### 4h. Reference-counted key gating

```js
const keyOwners = new Map(); // Map<doomKey, Set<note>>

function keyDown(doomKey, note) {
  let owners = keyOwners.get(doomKey);
  if (!owners) { owners = new Set(); keyOwners.set(doomKey, owners); }
  const wasEmpty = owners.size === 0;
  owners.add(note);
  if (wasEmpty) doomExports.reportKeyDown(doomKey);
}

function keyUp(doomKey, note) {
  const owners = keyOwners.get(doomKey);
  if (!owners) return;
  owners.delete(note);
  if (owners.size === 0) doomExports.reportKeyUp(doomKey);
}
```

If two tracker voices both map to `FIRE` (e.g., F#-4 on channel 1 and
F#-5 on channel 2 played simultaneously), we want **one** `reportKeyDown(FIRE)`
on the first trigger and **one** `reportKeyUp(FIRE)` on the last
release. Without this gating, the game would see duplicate key events
and behave erratically. The key-owner map is the standard solution for
overlapping-hold scenarios.

### 4i. Boot sequence

```js
async function boot() {
  const bytes = base64ToBytes(DOOM_WASM_B64);
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  doomExports  = instance.exports;
  moduleMemory = doomExports.memory;
  keyConstants = {
    KEY_LEFTARROW:  doomExports.KEY_LEFTARROW.value,
    KEY_RIGHTARROW: doomExports.KEY_RIGHTARROW.value,
    // ... all 14 key constants
  };
  doomExports.initGame();
  tickTimer = setInterval(() => doomExports.tickGame(), 1000 / 35);
}
boot();
```

Decode base64 → instantiate → pull exports → harvest key constants →
`initGame()` → start the 35 Hz tick timer. The exported DOOM key
constants come back as `WebAssembly.Global` objects — you read the
integer via `.value`.

---

## 5. The bundler — walking through `bundle.mjs`

Full file (about 30 lines of logic):

```js
#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE  = resolve(__dirname, "template.html");
const OUT_DIR   = resolve(__dirname, "..", "web");
const OUT_FILE  = resolve(OUT_DIR, "doom.html");

const wasmPath = process.argv[2] ?? "/tmp/doom-wasm-ref/doom.wasm";

const [tpl, wasm] = await Promise.all([
  readFile(TEMPLATE, "utf8"),
  readFile(wasmPath),
]);

const MARKER = "/*###DOOM_WASM_B64_MARKER###*/";
if (!tpl.includes(MARKER)) {
  throw new Error(`bundle.mjs: template is missing marker ${MARKER}`);
}

const b64 = wasm.toString("base64");
const js  = `const DOOM_WASM_B64 = ${JSON.stringify(b64)};`;
const out = tpl.replace(MARKER, () => js);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, out);

const mb = (out.length / 1024 / 1024).toFixed(2);
console.log(`wrote ${OUT_FILE}  (${mb} MB, wasm ${(wasm.length / 1024 / 1024).toFixed(2)} MB)`);
```

Things worth noting:

1. **Zero dependencies.** Everything is `node:fs/promises` and
   `node:path`. Runs on any Node 18+ install.
2. **The callback form of `replace`.** `tpl.replace(marker, () => js)`
   uses a function instead of a string. This matters because
   `String.prototype.replace` with a string argument interprets
   `$&`, `$1`, etc. as replacement tokens. Base64 data doesn't
   contain `$` characters, but belt-and-braces — pass a callback and
   you're immune to this class of bug forever.
3. **Missing-marker check.** If the template ever loses the marker
   (deleted by accident, renamed), we fail loud at build time rather
   than writing an unchanged template that boots with
   `ReferenceError: DOOM_WASM_B64 is not defined`.
4. **No `--watch`.** Bundle when you change the template or the WASM,
   not on every save. WASM doesn't change often.

To build:

```bash
cd plugin-sdk/examples/doom-wasm
curl -sSL -o doom.wasm \
  https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm
node src/bundle.mjs doom.wasm
# wrote .../web/doom.html  (5.81 MB, wasm 4.35 MB)
```

Then pack the plugin archive with `ntpack` (or plain `zip`) and you're
shipping.

---

## 6. Why single-file HTML (and how to scale up)

The nanoTracker plugin loader rejects webview HTML files that
reference sibling assets — `<script src="foo.js">`, `<link href="style.css">`,
`import "./module.js"`, etc. — because it only creates a blob URL for
the entry HTML, not for every supporting file. Rewriting relative URLs
at load time would require a full HTML/JS parser in the loader, with
an open-ended matrix of edge cases, and still wouldn't solve
`fetch()` or `new Worker()`. The v1 design punts that complexity to
the plugin author.

For a ~100-line HTML plugin that's trivial: write one file, done. For
DOOM the problem is a 4.35 MB WASM binary. Three approaches work:

### Approach A: hand-rolled template substitution (what DOOM does)

Write a template HTML with a unique marker, a ~20-line Node script that
reads a binary, base64-encodes it, and substitutes it in. Best for:

- Single-binary plugins (one WASM, one sample pack, one font)
- Small-to-medium total size (DOOM is at 5.9 MB and works fine;
  I wouldn't push past ~15 MB without testing how the tracker's
  plugin panel behaves during load)
- Projects that don't already have a bundler in their build pipeline

### Approach B: `vite-plugin-singlefile`

If your plugin has a React / Svelte / Vue / Solid UI, use Vite with
[`vite-plugin-singlefile`](https://www.npmjs.com/package/vite-plugin-singlefile)
to inline every `<script>`, `<link>`, and asset into a single HTML file.
Best for:

- Component-based plugin UIs
- Multi-file source projects
- Projects that already use Vite for other things

`vite-plugin-singlefile` automatically base64-encodes small assets. For
large binaries (WASM), use `?url` + a manual fetch inside an inline
script that reads from a data URL.

### Approach C: `esbuild --bundle` + manual inline

```bash
esbuild src/main.ts --bundle --minify --outfile=/tmp/bundle.js
cat > web/index.html <<HTML
<!doctype html>
<html>
<head><meta charset="utf-8"><title>my plugin</title></head>
<body>
<script>$(cat /tmp/bundle.js)</script>
</body>
</html>
HTML
```

Ugly but effective. Use for pure-JS plugins without a framework.

### Don't: loader URL rewriting

Some people will try to get clever with `URL.createObjectURL` +
`<script>` injection at runtime. This works for small cases but falls
over on ES modules and dynamic imports. The tracker's loader
deliberately doesn't support this so plugins have one supported
authoring path.

---

## 7. Generalising — the DOOM pattern for other WASM

Every section of the DOOM example generalises to any
render-to-canvas-from-WASM plugin:

- **Host glue template** → same structure, different imports. Most
  Emscripten-generated modules have an auto-generated `.js` file
  exporting a `Module` object — you can usually just include that and
  skip writing imports by hand. Dig into the example's `template.html`
  as a reference for the "from scratch" approach.
- **Canvas render from memory** → same shuffle pattern, different
  channel order. Check your module's framebuffer format.
- **Bundler** → same `bundle.mjs` template works for any single WASM
  binary; rename the marker and the variable and ship.
- **Input from postMessage** → same `mapNoteToXxx` function, different
  target keys/actions. Reference-counted gating is reusable unchanged.
- **Boot sequence** → same `boot()` async function, same 35 Hz (or
  60 Hz, or whatever) timer.

**Candidate targets** for future plugin-sdk examples that would reuse
this pattern almost unchanged:

- **Chip-8 emulator** — ~300 bytes of ROM, ~2 KB of interpreter,
  64×32 monochrome framebuffer. Entire plugin archive under 10 KB.
- **SNES / NES emulator core** — a few MB of JS/WASM plus a ROM you
  don't ship (user drags it in as a second file? or you sidestep by
  shipping a free homebrew ROM, e.g., MIT-licensed demos).
- **Wolfenstein 3D** — same contract as DOOM, roughly same size,
  also GPL-2.0.
- **A demoscene intro** — 4 KB / 64 KB size-coded ELFs recompiled to
  WASM; renders a beautiful procedural visual reacting to notes.
- **A Commodore 64 SID player** — receive `noteOn` events, play the
  corresponding C64 music bank in real-time using `reSID` compiled to
  WASM.
- **A synthesizer written in C/Rust** — port an existing synth and
  drive it from the tracker's note stream. Audio comes out of the
  iframe's own `AudioContext` in v1 (see
  [`09-webview.md`](09-webview.md) on PCM route-back).

The DOOM example is proof that the v1 webview control is capable of
hosting real software. The size and complexity are a ceiling in
theory, but practically everything interesting fits under it.

---

## 8. What's next

- [`../examples/doom-wasm/README.md`](../examples/doom-wasm/README.md) —
  the short build-and-run guide for the example itself
- [`../examples/doom-wasm/CREDITS.md`](../examples/doom-wasm/CREDITS.md) —
  full attribution and licensing detail
- [`09-webview.md`](09-webview.md) — the webview control reference
  (you've probably already read this)
- [`reference/event-bus.md`](reference/event-bus.md) — formal
  TypeScript types for every event the bridge forwards

If you build something interesting with this pattern — a new emulator
core, a visualizer, a synth — share it. The `examples/` directory is
where good worked-in-detail plugins live.
