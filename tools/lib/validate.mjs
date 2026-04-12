/*
 * Shared validation helpers for ntpack / ntvalidate.
 *
 * The webview single-file check mirrors the rule the nanoTracker
 * plugin host applies at load time. The regex and allow-list below
 * are the exact behaviour an author can rely on — if a plugin
 * passes this check at pack time, it passes the host check at load
 * time.
 *
 * The plugin.json pre-flight checks cover the authoring mistakes
 * that matter: missing required fields, unresolved UI → parameter
 * references, unknown capability flags, missing webview sources,
 * sibling-asset references inside webview HTML.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { existsSync, statSync } from "node:fs";

// ── Webview HTML single-file check ──────────────────────────────────────
//
// The plugin archive format forbids webview HTML files from referencing
// sibling assets (script src, link href, ES-module imports). Authors
// must inline everything via base64 or absolute data:/blob:/https: URLs.
// This regex rejects the forbidden patterns.

const WEBVIEW_REF_RE = /(?:\bsrc\s*=\s*|\bhref\s*=\s*|\bimport\s+(?:[^"']*\s+from\s+)?)(["'])([^"']+)\1/gi;

/** Returns null on success, or a {path, ref} object describing the
 *  first disallowed sibling-asset reference. */
export function findWebviewSiblingRef(htmlPath, html) {
  WEBVIEW_REF_RE.lastIndex = 0;
  let m;
  while ((m = WEBVIEW_REF_RE.exec(html)) !== null) {
    const ref = m[2].trim();
    if (!ref) continue;
    if (ref.startsWith("data:"))        continue;
    if (ref.startsWith("blob:"))        continue;
    if (ref.startsWith("http://"))      continue;
    if (ref.startsWith("https://"))     continue;
    if (ref.startsWith("//"))           continue;
    if (ref.startsWith("#"))            continue;
    if (ref.startsWith("javascript:"))  continue;
    if (ref.startsWith("about:"))       continue;
    return { path: htmlPath, ref };
  }
  return null;
}

// ── plugin.json loading + shallow shape check ───────────────────────────

/** Resolve a source argument (file or directory) to the plugin.json path. */
export function resolvePluginJsonPath(source) {
  if (!existsSync(source)) {
    throw new Error(`not found: ${source}`);
  }
  const st = statSync(source);
  if (st.isDirectory()) {
    const p = join(source, "plugin.json");
    if (!existsSync(p)) {
      throw new Error(`no plugin.json in ${source}`);
    }
    return { pluginJsonPath: p, sourceDir: source };
  }
  if (st.isFile()) {
    return { pluginJsonPath: source, sourceDir: dirname(source) };
  }
  throw new Error(`not a file or directory: ${source}`);
}

/** Read + JSON.parse a plugin.json, wrapping errors with a clear message. */
export async function loadPluginJson(pluginJsonPath) {
  let raw;
  try {
    raw = await readFile(pluginJsonPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${pluginJsonPath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${pluginJsonPath}: invalid JSON — ${err.message}`);
  }
}

// ── Pre-flight checks ───────────────────────────────────────────────────
//
// These run from both ntpack (before zipping) and ntvalidate (as the
// custom-rules pass after JSON Schema validation). They catch the
// high-value authoring mistakes that JSON Schema alone would miss.

/**
 * Walk the UI control tree looking for webview controls.
 * Returns an array of {source, forwardNotes, forwardParams, ...} objects.
 */
export function collectWebviewControls(uiDef) {
  const out = [];
  if (!uiDef || !Array.isArray(uiDef.controls)) return out;
  const walk = (controls) => {
    for (const c of controls) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "webview") out.push(c);
      if (Array.isArray(c.children)) walk(c.children);
    }
  };
  walk(uiDef.controls);
  return out;
}

/**
 * Walk the UI control tree collecting every parameter key referenced
 * by a control (parameter, parameterX, parameterY). Used to detect
 * UI references to parameters that don't exist in parameters[].
 */
export function collectReferencedParams(uiDef) {
  const out = new Set();
  if (!uiDef || !Array.isArray(uiDef.controls)) return out;
  const walk = (controls) => {
    for (const c of controls) {
      if (!c || typeof c !== "object") continue;
      if (typeof c.parameter  === "string") out.add(c.parameter);
      if (typeof c.parameterX === "string") out.add(c.parameterX);
      if (typeof c.parameterY === "string") out.add(c.parameterY);
      if (Array.isArray(c.children)) walk(c.children);
    }
  };
  walk(uiDef.controls);
  return out;
}

/**
 * Cheap pre-flight check on a parsed plugin.json. Returns an array
 * of issue strings — empty means everything passed. Does NOT do full
 * JSON Schema validation (that's ntvalidate's job with ajv); only the
 * checks that are both important and expressible in ~50 lines.
 *
 * sourceDir is used for filesystem-touching checks like reading
 * webview source files. Pass null to skip those.
 */
export async function preflightPlugin(pluginJson, sourceDir) {
  const issues = [];

  // ── manifest ────────────────────────────────────────────────
  if (typeof pluginJson.schemaVersion !== "number") {
    issues.push(`plugin.json: schemaVersion is required (number)`);
  } else if (![1, 2, 3].includes(pluginJson.schemaVersion)) {
    issues.push(`plugin.json: unsupported schemaVersion ${pluginJson.schemaVersion} (supported: 1, 2, 3)`);
  }
  const m = pluginJson.manifest;
  if (!m || typeof m !== "object") {
    issues.push(`plugin.json: manifest block is required`);
  } else {
    if (typeof m.name !== "string"    || !m.name.trim())    issues.push(`manifest.name is required (non-empty string)`);
    if (typeof m.version !== "string" || !m.version.trim()) issues.push(`manifest.version is required (non-empty string)`);
    if (m.type !== "instrument" && m.type !== "fx") {
      issues.push(`manifest.type must be "instrument" or "fx" (got ${JSON.stringify(m.type)})`);
    }
  }

  // ── parameters ──────────────────────────────────────────────
  const paramKeys = new Set();
  if (Array.isArray(pluginJson.parameters)) {
    for (const [i, p] of pluginJson.parameters.entries()) {
      if (!p || typeof p !== "object") {
        issues.push(`parameters[${i}] must be an object`);
        continue;
      }
      if (typeof p.key !== "string" || !p.key.trim()) {
        issues.push(`parameters[${i}].key is required (non-empty string)`);
      } else {
        paramKeys.add(p.key);
      }
      if (typeof p.label !== "string") {
        issues.push(`parameters[${i}].label is required (string)`);
      }
    }
  }

  // ── UI refs → parameters[] cross-check ─────────────────────
  const referenced = collectReferencedParams(pluginJson.ui);
  for (const ref of referenced) {
    if (!paramKeys.has(ref)) {
      issues.push(`ui.controls references parameter "${ref}" but no such entry in parameters[]`);
    }
  }

  // ── Webview controls ───────────────────────────────────────
  const webviews = collectWebviewControls(pluginJson.ui);
  if (webviews.length > 0) {
    const requires = Array.isArray(pluginJson.requires) ? pluginJson.requires : [];
    if (!requires.includes("webview-ui")) {
      issues.push(`webview controls require 'requires: ["webview-ui"]' at the top level of plugin.json`);
    }
    for (const [i, wv] of webviews.entries()) {
      if (typeof wv.source !== "string" || !wv.source.trim()) {
        issues.push(`webview control #${i}: missing required "source" field`);
        continue;
      }
      if (sourceDir) {
        const abs = isAbsolute(wv.source) ? wv.source : resolve(sourceDir, wv.source);
        if (!existsSync(abs)) {
          issues.push(`webview control #${i}: source "${wv.source}" not found at ${abs}`);
          continue;
        }
        try {
          const html = await readFile(abs, "utf8");
          const bad = findWebviewSiblingRef(wv.source, html);
          if (bad) {
            issues.push(
              `webview source "${bad.path}" references sibling asset "${bad.ref}" — ` +
              `v1 webview controls only support single-file HTML. Inline JS/WASM/assets via base64 ` +
              `(e.g. vite-plugin-singlefile) or use absolute data:/blob:/https: URLs.`,
            );
          }
        } catch (err) {
          issues.push(`webview control #${i}: cannot read source "${wv.source}" — ${err.message}`);
        }
      }
    }
  }

  // ── requires[] capability sanity ───────────────────────────
  // The set below is the current nanoTracker host capability list.
  // When a new flag ships, update this set and docs/reference/host-capabilities.md.
  const KNOWN_CAPABILITIES = new Set([
    "graph",
    "worklet-v3",
    "granular",
    "wavetable",
    "modMatrix-v3",
    "trackerEffects-v3",
    "webview-ui",
  ]);
  if (Array.isArray(pluginJson.requires)) {
    for (const cap of pluginJson.requires) {
      if (typeof cap !== "string") {
        issues.push(`requires[]: every entry must be a string`);
        continue;
      }
      if (!KNOWN_CAPABILITIES.has(cap)) {
        issues.push(`requires[]: unknown capability "${cap}" — supported: ${[...KNOWN_CAPABILITIES].join(", ")}`);
      }
    }
  }

  return issues;
}
