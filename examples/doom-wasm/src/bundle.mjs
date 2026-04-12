#!/usr/bin/env node
/*
  nt-doom bundler — reads the template HTML and the doom.wasm binary,
  base64-encodes the wasm into a JS constant, injects it into the
  template's `%%DOOM_WASM_B64%%` placeholder, and writes a
  self-contained single-file HTML to `../web/doom.html`.

  The resulting file is ~6 MB of inline base64 + ~10 KB of JS glue.
  Drop it into the .ntins archive alongside plugin.json and it runs
  offline, inside a sandboxed iframe, with no external fetches.

  Usage:
    node src/bundle.mjs <path-to-doom.wasm>

  Defaults to /tmp/doom-wasm-ref/doom.wasm if no arg is given.
*/

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

// Use a callback so $-escapes in b64 (not that base64 has them,
// but belt-and-braces) aren't interpreted as replacement tokens.
const out = tpl.replace(MARKER, () => js);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, out);

const mb = (out.length / 1024 / 1024).toFixed(2);
console.log(`wrote ${OUT_FILE}  (${mb} MB, wasm ${(wasm.length / 1024 / 1024).toFixed(2)} MB)`);
