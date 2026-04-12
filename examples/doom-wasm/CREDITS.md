# Credits & licensing — `doom-wasm` example

This nanoTracker plugin example embeds a third-party WebAssembly build of id
Software's DOOM. Everything below is redistributable, but the terms matter —
read this file before shipping, modifying, or repackaging this example.

## The original game

**DOOM** — id Software, 1993. The C source code of the original DOS game was
released by id Software on 1999-12-23 under the GNU General Public License
version 2. Every DOOM source port in existence descends from that release.

- Upstream: <https://github.com/id-Software/DOOM>
- License: GPL-2.0

## The WebAssembly port

**`doom.wasm`** — Jacob Enget, 2024. A compilation of DOOM targeting
WebAssembly with a minimal, well-documented import/export contract
(`initGame` / `tickGame` / `reportKeyDown` / `reportKeyUp` plus ten host
callbacks). The build used here is the published v0.1.0 release.

- Upstream: <https://github.com/jacobenget/doom.wasm>
- Release: <https://github.com/jacobenget/doom.wasm/releases/tag/v0.1.0>
- Binary: `doom-v0.1.0.wasm`
- Size: 4,559,928 bytes (~4.35 MB)
- SHA-256: `8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa`
- License: GPL-2.0 (the `LICENSE` file alongside this one is the verbatim
  text from the upstream repo)

We do **not** check the binary into this repo. The `.gitignore` alongside
this file excludes both `doom.wasm` (the downloaded binary) and
`web/doom.html` (the bundled single-file HTML built from it). To rebuild,
see `README.md` in this directory.

## The game data (WAD)

The **DOOM Shareware WAD** (`doom1.wad`, episode 1 only) is embedded
**inside** `doom-v0.1.0.wasm` itself — we do not ship or reference it
separately. When the host's `loading.wadSizes` / `loading.readWads`
imports are left as no-ops (as they are in `src/template.html`), the
WebAssembly module falls back to its bundled shareware WAD.

id Software's shareware distribution terms permit free redistribution of
the shareware WAD data. The shareware episode is the first nine levels
("Knee-Deep in the Dead") and is distinct from the registered / Ultimate
Doom commercial WADs, which are **not** covered by those terms and
**must not** be substituted into this example.

## The nanoTracker-specific host glue

The files `src/template.html` and `src/bundle.mjs` were written for this
SDK and are original work. They are released under GPL-2.0 **as a
consequence** of being statically linked against a GPL-2.0 WebAssembly
module — not as a separate policy choice. There is no way to ship a
combined archive that embeds `doom.wasm` under a more permissive license;
GPL-2.0 is contagious across the static link boundary.

The `postMessage` bridge, note-to-key mapping, and canvas render loop
draw heavily from the reference browser example in the upstream repo at
<https://github.com/jacobenget/doom.wasm/blob/master/examples/browser/doom.html>.
Differences from the reference:

- Input arrives via `window.addEventListener("message", ...)` (tracker
  bridge) instead of DOM `keydown` / `keyup` events (the DOM path is
  retained as a fallback so click-to-focus also works).
- The frame-buffer BGRA→RGBA swap uses a `Uint32Array` view for speed.
- The WASM binary is base64-inlined into the HTML so the plugin archive
  satisfies the nanoTracker webview-v3 "single-file HTML" constraint.

## What this means for you

- **If you ship `.ntins` archives built from this example or derivatives
  of it, the archive is GPL-2.0.** You must offer the source (your
  `plugin.json` + `template.html` + `bundle.mjs`) to anyone you give the
  archive to.
- **If you base a different WebAssembly plugin on this example**
  (e.g. a SNES emulator, a raycaster, a demoscene intro) using
  non-GPL WASM, your archive's license is whatever the upstream WASM's
  license permits combined with your own code. GPL-2.0 does **not**
  infect unrelated plugins — it only applies because this specific
  archive statically links DOOM.
- **The nanoTracker host (the tracker itself, its plugin loader, the
  `plugin-sdk/tools/` CLIs, and all the other plugins in `plugin-sdk/`)
  is NOT GPL-2.0.** Only this one example's shipped `.ntins` is.

If any of this is unclear, read the full `LICENSE` file next to this one,
and when in doubt consult a lawyer rather than a README.
