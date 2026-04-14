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
  } else if (![1, 2, 3, 4].includes(pluginJson.schemaVersion)) {
    issues.push(`plugin.json: unsupported schemaVersion ${pluginJson.schemaVersion} (supported: 1, 2, 3, 4)`);
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

  // ── themeOverride (v3.5) ───────────────────────────────────
  // Validate shape + require the capability flag. Unknown keys are
  // pointed at so typos don't silently vanish at load time.
  const THEME_OVERRIDE_KEYS = new Set([
    "primary", "primaryDim", "primaryGlow",
    "bg", "bgElevated",
    "text", "textDim",
    "border", "scanline",
    "highlightBg", "highlightText",
  ]);
  const themeOverride = pluginJson.ui && pluginJson.ui.themeOverride;
  if (themeOverride !== undefined && themeOverride !== null) {
    if (typeof themeOverride !== "object" || Array.isArray(themeOverride)) {
      issues.push(`ui.themeOverride must be an object (got ${Array.isArray(themeOverride) ? "array" : typeof themeOverride})`);
    } else {
      for (const [k, v] of Object.entries(themeOverride)) {
        if (!THEME_OVERRIDE_KEYS.has(k)) {
          issues.push(`ui.themeOverride: unknown key "${k}" — expected one of ${[...THEME_OVERRIDE_KEYS].join(", ")}`);
        } else if (typeof v !== "string" || !v.trim()) {
          issues.push(`ui.themeOverride.${k}: must be a non-empty CSS colour string`);
        }
      }
      const req = Array.isArray(pluginJson.requires) ? pluginJson.requires : [];
      if (!req.includes("themeOverride")) {
        issues.push(`ui.themeOverride is set but "themeOverride" is missing from requires[] — add it or drop the override`);
      }
    }
  }

  // ── ports (v4) ─────────────────────────────────────────────
  const PORT_KINDS = new Set(["audio", "sidechain", "cv", "gate"]);
  const ports = pluginJson.ports;
  const requires = Array.isArray(pluginJson.requires) ? pluginJson.requires : [];
  const isV4Plus = typeof pluginJson.schemaVersion === "number" && pluginJson.schemaVersion >= 4;
  const isFx = m && m.type === "fx";

  if (ports !== undefined && ports !== null) {
    if (typeof ports !== "object" || Array.isArray(ports)) {
      issues.push(`ports must be an object with inputs[]/outputs[]`);
    } else {
      if (!requires.includes("portsV4")) {
        issues.push(`ports is present but "portsV4" is missing from requires[] — add it or drop the block`);
      }
      const validatePortList = (list, dir) => {
        if (list === undefined) return;
        if (!Array.isArray(list)) {
          issues.push(`ports.${dir} must be an array`);
          return;
        }
        const seenIds = new Set();
        for (const [i, p] of list.entries()) {
          if (!p || typeof p !== "object") {
            issues.push(`ports.${dir}[${i}] must be an object`);
            continue;
          }
          if (typeof p.id !== "string" || !p.id.trim()) {
            issues.push(`ports.${dir}[${i}].id is required (non-empty string)`);
          } else if (seenIds.has(p.id)) {
            issues.push(`ports.${dir}[${i}].id "${p.id}" is duplicated`);
          } else {
            seenIds.add(p.id);
          }
          if (typeof p.label !== "string" || !p.label.trim()) {
            issues.push(`ports.${dir}[${i}].label is required (non-empty string)`);
          }
          if (!PORT_KINDS.has(p.kind)) {
            issues.push(`ports.${dir}[${i}].kind must be one of ${[...PORT_KINDS].join(", ")} (got ${JSON.stringify(p.kind)})`);
          }
          if (p.kind === "cv" && dir === "inputs") {
            if (typeof p.target !== "string" || !p.target.includes(".")) {
              issues.push(`ports.inputs[${i}] (cv): target is required and must be "<nodeId>.<paramName>"`);
            }
          }
        }
      };
      validatePortList(ports.inputs,  "inputs");
      validatePortList(ports.outputs, "outputs");
    }
  }

  // ── v4 pedal requirements ──────────────────────────────────
  if (isV4Plus && isFx) {
    if (!requires.includes("pedal-v4")) {
      issues.push(`v4 fx plugins (pedals) must declare "pedal-v4" in requires[]`);
    }
    if (!ports || typeof ports !== "object" || !Array.isArray(ports.inputs) || ports.inputs.length === 0) {
      issues.push(`v4 fx plugins (pedals) must declare at least one entry in ports.inputs[]`);
    }
    if (!ports || typeof ports !== "object" || !Array.isArray(ports.outputs) || ports.outputs.length === 0) {
      issues.push(`v4 fx plugins (pedals) must declare at least one entry in ports.outputs[]`);
    }
  }

  // ── webview-writes (v4) gating ─────────────────────────────
  const WRITE_FLAG_KEYS = [
    "acceptsParamWrites",
    "acceptsPresetWrites",
    "acceptsNotes",
    "acceptsHostCommands",
  ];
  const anyWriteOptIn = webviews.some(wv => WRITE_FLAG_KEYS.some(k => wv[k] === true));
  if (anyWriteOptIn && !requires.includes("webview-writes")) {
    issues.push(`a webview control opts in to write-channel flags (${WRITE_FLAG_KEYS.join("/")}) but "webview-writes" is missing from requires[]`);
  }

  // ── v4.1 sampler / sliceMap / sampleMeta (Phase A) ─────────
  //
  // These rules mirror the host-side gating in pluginLoader.ts so
  // packing catches capability omissions before the plugin reaches a
  // user's tracker install. Scans every place a sample zone might
  // live: instrument-level dsp.samples[], any sampler-node zones[],
  // and sampler-node sliceMap metadata.
  {
    const V41_LOOP_MODES = new Set(["none", "forward", "pingpong", "release"]);
    const zoneFeatures = { needSampler: false, needSampleMeta: false, reasons: [] };

    const auditZone = (z, where) => {
      if (!z || typeof z !== "object") return;
      // Loop mode string form (v4.1) triggers sampler-v41; boolean form
      // (v1 legacy) does not.
      if (typeof z.loop === "string") {
        if (!V41_LOOP_MODES.has(z.loop)) {
          issues.push(`${where}.loop must be one of ${[...V41_LOOP_MODES].join(", ")} (got ${JSON.stringify(z.loop)})`);
        }
        if (z.loop === "pingpong" || z.loop === "release") {
          zoneFeatures.needSampler = true;
          zoneFeatures.reasons.push(`${where}.loop === "${z.loop}"`);
        }
      }
      if (typeof z.loopCrossfade === "number") {
        if (z.loopCrossfade < 0) {
          issues.push(`${where}.loopCrossfade must be >= 0`);
        }
        zoneFeatures.needSampler = true;
        zoneFeatures.reasons.push(`${where}.loopCrossfade is set`);
      }
      if (typeof z.roundRobinGroup === "string" || typeof z.choke === "string" ||
          z.trigger === "release" || z.pitchTracking === false) {
        zoneFeatures.needSampler = true;
        zoneFeatures.reasons.push(`${where} uses a v4.1 zone feature`);
      }
      if (z.trigger !== undefined && z.trigger !== "attack" && z.trigger !== "release") {
        issues.push(`${where}.trigger must be "attack" or "release" (got ${JSON.stringify(z.trigger)})`);
      }
      if (z.meta && typeof z.meta === "object" && (
        z.meta.originalTempo !== undefined ||
        z.meta.originalKey   !== undefined ||
        (Array.isArray(z.meta.cuePoints) && z.meta.cuePoints.length > 0)
      )) {
        zoneFeatures.needSampleMeta = true;
      }
    };

    const walkNodes = (nodes, where) => {
      if (!Array.isArray(nodes)) return;
      for (const [i, n] of nodes.entries()) {
        if (!n || typeof n !== "object") continue;
        if (n.type !== "sampler") continue;
        zoneFeatures.needSampler = true;
        zoneFeatures.reasons.push(`${where}[${i}] is type:"sampler"`);
        if (!Array.isArray(n.zones) && !n.sliceMap) {
          issues.push(`${where}[${i}] (sampler node "${n.id ?? "?"}"): must declare at least one of zones[] or sliceMap`);
        }
        if (Array.isArray(n.zones)) {
          n.zones.forEach((z, j) => auditZone(z, `${where}[${i}].zones[${j}]`));
        }
        if (n.sliceMap) {
          if (!requires.includes("sliceMap-v41")) {
            issues.push(`${where}[${i}].sliceMap is set but "sliceMap-v41" is missing from requires[]`);
          }
          if (typeof n.sliceMap.source !== "string" || !n.sliceMap.source.trim()) {
            issues.push(`${where}[${i}].sliceMap.source is required (non-empty string)`);
          }
          if (Array.isArray(n.sliceMap.slices)) {
            n.sliceMap.slices.forEach((s, k) => {
              if (!s || typeof s !== "object") {
                issues.push(`${where}[${i}].sliceMap.slices[${k}] must be an object`);
                return;
              }
              if (typeof s.start !== "number" || typeof s.end !== "number" || !(s.end > s.start)) {
                issues.push(`${where}[${i}].sliceMap.slices[${k}] must have start/end numbers with end > start`);
              }
            });
          }
          if (n.sliceMap.autoDetect !== undefined && n.sliceMap.autoDetect !== null) {
            const ad = n.sliceMap.autoDetect;
            const ok = ad === "markers" || ad === "transients" || (typeof ad === "string" && /^grid:\d+$/.test(ad));
            if (!ok) {
              issues.push(`${where}[${i}].sliceMap.autoDetect must be "markers" | "transients" | "grid:<N>" (got ${JSON.stringify(ad)})`);
            }
          }
        }
        if (n.polyphony !== undefined && (typeof n.polyphony !== "number" || n.polyphony < 1 || n.polyphony > 64)) {
          issues.push(`${where}[${i}].polyphony must be an integer in 1..64`);
        }
      }
    };

    // Instrument-level samples[]
    const dsp = pluginJson.dsp;
    if (dsp && Array.isArray(dsp.samples)) {
      dsp.samples.forEach((z, i) => auditZone(z, `dsp.samples[${i}]`));
    }
    // FX form: dsp.nodes[]
    if (dsp && Array.isArray(dsp.nodes)) walkNodes(dsp.nodes, "dsp.nodes");
    // Instrument form: dsp.graph.nodes[]
    if (dsp && dsp.graph && Array.isArray(dsp.graph.nodes)) walkNodes(dsp.graph.nodes, "dsp.graph.nodes");

    if (zoneFeatures.needSampler && !requires.includes("sampler-v41")) {
      issues.push(
        `plugin uses v4.1 sampler features (${zoneFeatures.reasons[0]}) but "sampler-v41" is missing from requires[]`,
      );
    }
    if (zoneFeatures.needSampleMeta && !requires.includes("sampleMeta-v41")) {
      issues.push(
        `plugin authors zone.meta (tempo/key/cuePoints) but "sampleMeta-v41" is missing from requires[]`,
      );
    }

    // ── v4.1 Phase B: userSamples rules ─────────────────────────
    let needUserSamples = false;
    const seenSlotIds = new Map(); // slotId → where
    const auditUserZone = (z, where) => {
      if (!z || typeof z !== "object") return;
      if (z.userAssignable === true) {
        needUserSamples = true;
        if (typeof z.slotId !== "string" || !z.slotId.trim()) {
          issues.push(`${where}.userAssignable is true but slotId is missing (required, non-empty string)`);
          return;
        }
        const prev = seenSlotIds.get(z.slotId);
        if (prev) {
          issues.push(`slotId "${z.slotId}" is declared on both ${prev} and ${where} — must be unique within the plugin`);
        } else {
          seenSlotIds.set(z.slotId, where);
        }
        if (z.fallbackFile !== undefined && typeof z.fallbackFile !== "string") {
          issues.push(`${where}.fallbackFile must be a string (archive-relative path)`);
        }
        if (z.maxDurationSec !== undefined &&
            (typeof z.maxDurationSec !== "number" || z.maxDurationSec < 0)) {
          issues.push(`${where}.maxDurationSec must be a non-negative number`);
        }
        if (z.accept !== undefined) {
          if (!Array.isArray(z.accept) || !z.accept.every(s => typeof s === "string")) {
            issues.push(`${where}.accept must be an array of MIME strings`);
          }
        }
      }
    };
    if (dsp && Array.isArray(dsp.samples)) {
      dsp.samples.forEach((z, i) => auditUserZone(z, `dsp.samples[${i}]`));
    }
    const walkUserZones = (nodes, where) => {
      if (!Array.isArray(nodes)) return;
      for (const [i, n] of nodes.entries()) {
        if (n?.type !== "sampler") continue;
        if (Array.isArray(n.zones)) {
          n.zones.forEach((z, j) => auditUserZone(z, `${where}[${i}].zones[${j}]`));
        }
      }
    };
    if (dsp && Array.isArray(dsp.nodes))           walkUserZones(dsp.nodes,      "dsp.nodes");
    if (dsp?.graph && Array.isArray(dsp.graph.nodes)) walkUserZones(dsp.graph.nodes, "dsp.graph.nodes");
    const sampleBank = pluginJson.sampleBank;
    if (sampleBank !== undefined && sampleBank !== null) {
      needUserSamples = true;
      if (typeof sampleBank !== "object" || Array.isArray(sampleBank)) {
        issues.push(`sampleBank must be an object`);
      } else {
        if (sampleBank.userSlotCount !== undefined &&
            (typeof sampleBank.userSlotCount !== "number" || sampleBank.userSlotCount < 0)) {
          issues.push(`sampleBank.userSlotCount must be a non-negative integer`);
        }
        if (sampleBank.allowUserSwap !== undefined && typeof sampleBank.allowUserSwap !== "boolean") {
          issues.push(`sampleBank.allowUserSwap must be a boolean`);
        }
        const pc = sampleBank.presetsCarrySamples;
        if (pc !== undefined && pc !== "never" && pc !== "optional" && pc !== "always") {
          issues.push(`sampleBank.presetsCarrySamples must be "never" | "optional" | "always"`);
        }
      }
    }
    if (needUserSamples && !requires.includes("userSamples")) {
      issues.push(`plugin uses v4.1 user-sample features (userAssignable zones or sampleBank) but "userSamples" is missing from requires[]`);
    }

    // ── v4.1 Phase C: preset sampleAssignments + presetBank-v4 ──
    //
    // A factory preset may declare `sampleAssignments: { slotId: file }`
    // to ship a "full kit" (parameter values + which WAV goes in which
    // user slot). Both sides of that mapping must validate: keys have
    // to match declared slotIds, values have to reference files that
    // exist in the archive. The capability `presetBank-v4` gates
    // author-side preset features that reach beyond parameter-only
    // factory presets — currently just sampleAssignments.
    if (Array.isArray(pluginJson.presets)) {
      let needPresetBank = false;
      for (const [i, p] of pluginJson.presets.entries()) {
        if (!p || typeof p !== "object") continue;
        const assignments = p.sampleAssignments;
        if (assignments === undefined) continue;
        needPresetBank = true;
        if (typeof assignments !== "object" || Array.isArray(assignments)) {
          issues.push(`presets[${i}].sampleAssignments must be an object`);
          continue;
        }
        for (const [slotId, file] of Object.entries(assignments)) {
          if (typeof file !== "string" || !file.trim()) {
            issues.push(`presets[${i}].sampleAssignments["${slotId}"] must be a non-empty string path`);
          }
          if (!seenSlotIds.has(slotId)) {
            issues.push(`presets[${i}].sampleAssignments references unknown slotId "${slotId}" — not declared by any userAssignable zone`);
          }
        }
      }
      if (needPresetBank && !requires.includes("presetBank-v4")) {
        issues.push(`presets[] declares sampleAssignments but "presetBank-v4" is missing from requires[]`);
      }
      if (needPresetBank && !requires.includes("userSamples")) {
        issues.push(`presets[] declares sampleAssignments but "userSamples" is missing from requires[] (sample assignments need a user-slot system)`);
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
    "themeOverride",
    // v4
    "portsV4",
    "pedal-v4",
    "webview-writes",
    // v4.1
    "webview-ports",
    // v4.1 Phase A — unified sampler primitive
    "sampler-v41",
    "sliceMap-v41",
    "sampleMeta-v41",
    // v4.1 Phase B — user-assignable sample slots
    "userSamples",
    // v4.1 Phase C — user preset persistence (library + project scope)
    "presetBank-v4",
    // v3.6
    "midi-cc",
    "consumes-song-position",
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
