#!/usr/bin/env node
/*
 * ntvalidate — lint a nanoTracker plugin.json without packing it.
 *
 * Runs the same pre-flight checks as `ntpack` so you can gate on exit
 * code in a pre-commit hook or CI job without producing a .ntins
 * archive.
 *
 * Usage:
 *   ntvalidate <plugin.json | source-dir> [--quiet]
 *
 * Exit codes:
 *   0   all checks passed
 *   1   any check failed
 *   2   argument error (missing file, bad CLI usage, etc.)
 *
 * The rules enforced here live in lib/validate.mjs alongside ntpack
 * so there's a single source of truth. When the plugin format adds a
 * new check, update the shared helper and both CLIs pick it up.
 */

import {
  loadPluginJson,
  preflightPlugin,
  resolvePluginJsonPath,
} from "./lib/validate.mjs";

// ── Arg parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [], quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a === "--help"  || a === "-h") out.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

const HELP = `\
ntvalidate — validate a nanoTracker plugin.json without packing it

Usage:
  ntvalidate <plugin.json | source-dir> [options]

Options:
  -q, --quiet     Suppress the success banner (just exit 0/1)
  -h, --help      Show this help

Examples:
  ntvalidate my-plugin
  ntvalidate my-plugin/plugin.json
  ntvalidate my-plugin --quiet && echo "ok"

Exit codes:
  0   all checks passed
  1   validation errors
  2   CLI argument error
`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(`ntvalidate: ${err.message}`);
    console.error(HELP);
    process.exit(2);
  }

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args._.length !== 1) {
    console.error(`ntvalidate: expected exactly one argument (file or dir)`);
    console.error(HELP);
    process.exit(2);
  }

  const target = args._[0];
  let resolved;
  try {
    resolved = resolvePluginJsonPath(target);
  } catch (err) {
    console.error(`ntvalidate: ${err.message}`);
    process.exit(2);
  }

  const { pluginJsonPath, sourceDir } = resolved;

  let pluginJson;
  try {
    pluginJson = await loadPluginJson(pluginJsonPath);
  } catch (err) {
    console.error(`ntvalidate: ${err.message}`);
    process.exit(1);
  }

  const issues = await preflightPlugin(pluginJson, sourceDir);
  if (issues.length > 0) {
    console.error(`ntvalidate: ${pluginJsonPath} failed validation:`);
    for (const issue of issues) console.error(`  × ${issue}`);
    process.exit(1);
  }

  if (!args.quiet) {
    const m = pluginJson.manifest ?? {};
    console.log(
      `ntvalidate: ${pluginJsonPath}\n` +
      `  ✓ schemaVersion ${pluginJson.schemaVersion}, ` +
      `${m.type ?? "?"} "${m.name ?? "?"}" v${m.version ?? "?"}\n` +
      `  ✓ ${(pluginJson.parameters ?? []).length} parameters, ` +
      `${(pluginJson.ui?.controls ?? []).length} top-level UI controls\n` +
      `  ✓ ${(pluginJson.requires ?? []).length} capability flags declared\n` +
      `  ok`,
    );
  }
  process.exit(0);
}

main().catch(err => {
  console.error(`ntvalidate: unexpected error: ${err.stack ?? err}`);
  process.exit(1);
});
