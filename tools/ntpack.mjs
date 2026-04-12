#!/usr/bin/env node
/*
 * ntpack — zip a nanoTracker plugin source directory into a .ntins
 *          (instrument) or .ntsfx (FX) archive.
 *
 * Usage:
 *   ntpack <source-dir> [--out <file>] [--type ntins|ntsfx] [--quiet]
 *
 * Behaviour:
 *   - Reads <source-dir>/plugin.json.
 *   - Runs the pre-flight checks from lib/validate.mjs (same rules
 *     ntvalidate uses). Fails loud on any issue before zipping.
 *   - Walks the source tree, skipping node_modules/, .git/, *.log,
 *     *.ntins, *.ntsfx, and anything listed in a .ntpackignore file
 *     at the source dir root.
 *   - Emits <source-dir>.ntins (or --out path). The extension default
 *     is .ntins for instrument plugins and .ntsfx for FX plugins,
 *     picked from manifest.type unless --type overrides it.
 *
 * Exits 0 on success, 1 on any failure.
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, join, basename } from "node:path";
import JSZip from "jszip";
import {
  loadPluginJson,
  preflightPlugin,
  resolvePluginJsonPath,
} from "./lib/validate.mjs";

// ── Arg parsing (tiny, no deps) ────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [], out: null, type: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") { out.out = argv[++i]; }
    else if (a === "--type")         { out.type = argv[++i]; }
    else if (a === "--quiet" || a === "-q") { out.quiet = true; }
    else if (a === "--help" || a === "-h")   { out.help = true; }
    else if (a.startsWith("-"))      { throw new Error(`unknown flag: ${a}`); }
    else                             { out._.push(a); }
  }
  return out;
}

const HELP = `\
ntpack — package a nanoTracker plugin source folder into a .ntins/.ntsfx archive

Usage:
  ntpack <source-dir> [options]

Options:
  -o, --out <path>      Output archive path (default: <source-dir>.<ext>)
      --type ntins|ntsfx  Force archive extension (default: inferred from manifest.type)
  -q, --quiet           Suppress the success banner
  -h, --help            Show this help

Examples:
  ntpack my-plugin
  ntpack my-plugin --out /tmp/my-plugin.ntins
  ntpack my-plugin --type ntins --quiet
`;

// ── File walker with exclusions ────────────────────────────────────────

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".gitignore",
  ".gitattributes",
  ".DS_Store",
  "Thumbs.db",
  ".ntpackignore",
];

const EXCLUDE_SUFFIXES = [
  ".ntins",
  ".ntsfx",
  ".log",
  ".swp",
  "~",
];

async function readNtpackIgnore(sourceDir) {
  const p = join(sourceDir, ".ntpackignore");
  if (!existsSync(p)) return [];
  const text = await readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"));
}

function shouldExclude(relPath, name, extraPatterns) {
  for (const d of DEFAULT_EXCLUDES) {
    if (name === d || relPath === d || relPath.startsWith(d + "/")) return true;
  }
  for (const s of EXCLUDE_SUFFIXES) {
    if (name.endsWith(s)) return true;
  }
  for (const p of extraPatterns) {
    // Minimal glob: support prefix match on "foo/" and exact match otherwise.
    if (p.endsWith("/") && (relPath.startsWith(p) || relPath + "/" === p)) return true;
    if (relPath === p || name === p) return true;
  }
  return false;
}

async function collectFiles(sourceDir) {
  const extraPatterns = await readNtpackIgnore(sourceDir);
  const files = [];
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const absPath = join(dir, e.name);
      const relPath = prefix ? `${prefix}/${e.name}` : e.name;
      if (shouldExclude(relPath, e.name, extraPatterns)) continue;
      if (e.isDirectory()) {
        await walk(absPath, relPath);
      } else if (e.isFile()) {
        files.push({ absPath, relPath });
      }
    }
  }
  await walk(sourceDir, "");
  return files;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(`ntpack: ${err.message}`);
    console.error(HELP);
    process.exit(1);
  }

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args._.length !== 1) {
    console.error(`ntpack: expected exactly one positional argument (source dir)`);
    console.error(HELP);
    process.exit(1);
  }

  const sourceArg = args._[0];
  let resolved;
  try {
    resolved = resolvePluginJsonPath(sourceArg);
  } catch (err) {
    console.error(`ntpack: ${err.message}`);
    process.exit(1);
  }

  const { pluginJsonPath, sourceDir } = resolved;

  // Load + pre-flight
  let pluginJson;
  try {
    pluginJson = await loadPluginJson(pluginJsonPath);
  } catch (err) {
    console.error(`ntpack: ${err.message}`);
    process.exit(1);
  }

  const issues = await preflightPlugin(pluginJson, sourceDir);
  if (issues.length > 0) {
    console.error(`ntpack: plugin.json pre-flight failed:`);
    for (const issue of issues) console.error(`  × ${issue}`);
    process.exit(1);
  }

  // Figure out the archive extension
  let ext = args.type;
  if (!ext) {
    ext = pluginJson.manifest?.type === "fx" ? "ntsfx" : "ntins";
  } else {
    if (ext !== "ntins" && ext !== "ntsfx") {
      console.error(`ntpack: --type must be "ntins" or "ntsfx" (got ${ext})`);
      process.exit(1);
    }
  }

  const outPath = args.out
    ? resolve(args.out)
    : resolve(`${sourceDir.replace(/\/$/, "")}.${ext}`);

  // Collect and zip
  const files = await collectFiles(sourceDir);
  if (files.length === 0) {
    console.error(`ntpack: no files to pack in ${sourceDir}`);
    process.exit(1);
  }
  // Sanity: plugin.json must be present in the collected set
  if (!files.some(f => f.relPath === "plugin.json")) {
    console.error(`ntpack: plugin.json not found at the top of ${sourceDir} after exclusions`);
    process.exit(1);
  }

  const zip = new JSZip();
  let totalUncompressed = 0;
  for (const { absPath, relPath } of files) {
    const bytes = await readFile(absPath);
    totalUncompressed += bytes.length;
    zip.file(relPath, bytes);
  }

  const zipped = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  await writeFile(outPath, zipped);

  if (!args.quiet) {
    const mbOut = (zipped.length / 1024 / 1024).toFixed(2);
    const mbIn  = (totalUncompressed / 1024 / 1024).toFixed(2);
    console.log(
      `ntpack: wrote ${outPath}\n` +
      `        ${files.length} files, ${mbIn} MB uncompressed → ${mbOut} MB archive`,
    );
  }
  process.exit(0);
}

main().catch(err => {
  console.error(`ntpack: unexpected error: ${err.stack ?? err}`);
  process.exit(1);
});
