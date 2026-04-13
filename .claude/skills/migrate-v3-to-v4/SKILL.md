---
name: migrate-v3-to-v4
description: Walk a legacy v1–v3 nanoTracker FX plugin (mixer-module shape) through the v4 pedal rewrite. Covers the manifest changes, capability additions, port block, connection rewrites, and what host-side auto-migration does for end-users with the pre-v4 plugin already installed.
---

# Migrate a v3 FX plugin to a v4 pedal

## When to use

Use this when an existing FX plugin (`type: "fx"`,
`schemaVersion: 1` / `2` / `3`) needs to be republished as a v4
pedal — either because the author wants to ship an updated version,
or because they want to take advantage of v4 features (multi-port
routing, sidechain, CV, webview write channel, theme override).

Don't use this if the plugin is an INSTRUMENT (`type: "instrument"`)
— v1–v3 instruments continue to load unchanged on the v4 host. No
migration is needed for them.

## Background: what the host does for end-users

When a project saved with a pre-v4 FX plugin in the FX Mixer's
channel-strip module slot is loaded into the v4 host, the host
auto-migrates it: each module instance becomes a workspace pedal,
auto-wired `TRACKER BUS.CHnn → pedal → MASTER IN`, with parameters
preserved.

That means existing users keep their projects working without
republishing. This migration skill is about the AUTHOR'S side —
shipping a clean v4 release rather than relying on the host's
auto-migration.

## Procedure

### 1. Bump schemaVersion

```diff
- "schemaVersion": 2,
+ "schemaVersion": 4,
```

### 2. Add the v4 capability flags

```diff
- "requires": [],
+ "requires": ["pedal-v4", "portsV4", "graph"],
```

`pedal-v4` is mandatory for every `type: "fx"` plugin at v4. `portsV4`
is mandatory whenever the plugin declares a `ports` block (and v4
pedals MUST). `graph` is required if the plugin uses the declarative
graph engine (most v3 FX plugins do — they have `processorName: null`
and `nodes[]` / `connections[]`).

Add others as needed:

- `"webview-ui"` if the plugin already uses a webview control
- `"webview-writes"` if the plugin's webview will use the v4
  bidirectional bridge (paramWrite, etc.)
- `"themeOverride"` if `ui.themeOverride` is present

### 3. Add the `ports` block

The most common v3 FX shape — single audio in, single audio out:

```diff
+ "ports": {
+   "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
+   "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }]
+ },
```

If the plugin had separate L/R processing internally, this is the
moment to expose them as separate ports (the v3 mixer-module shape
hid this — v4 pedals can be honest about it):

```jsonc
"ports": {
  "inputs": [
    { "id": "inL", "label": "L", "kind": "audio" },
    { "id": "inR", "label": "R", "kind": "audio" }
  ],
  "outputs": [
    { "id": "outL", "label": "L", "kind": "audio" },
    { "id": "outR", "label": "R", "kind": "audio" }
  ]
}
```

### 4. Rewrite connections to reference ports

v3 uses `"input"` / `"output"` reserved names. v4 prefers
`port:<id>`:

```diff
"connections": [
-  { "from": "input",  "to": "dry" },
-  { "from": "dry",    "to": "output" },
+  { "from": "port:in", "to": "dry" },
+  { "from": "dry",     "to": "port:out" },

-  { "from": "input",  "to": "d1" },
+  { "from": "port:in", "to": "d1" },
   { "from": "d1",     "to": "lpf" },
   { "from": "lpf",    "to": "fb" },
   { "from": "fb",     "to": "d1" },

   { "from": "lpf",    "to": "wet" },
-  { "from": "wet",    "to": "output" }
+  { "from": "wet",    "to": "port:out" }
]
```

Strict port:<id> is recommended for clarity. The legacy
`"instrumentIn"` / `"output"` shortcuts still resolve (to the first
audio in/out) for back-compat, so a quick search-and-replace of
`"input"` → `"port:in"` and `"output"` → `"port:out"` works for
single-port pedals if you prefer.

### 5. Reconsider an "output level" parameter

If the v3 plugin had an internal `output.gain` or similar parameter
that mirrored what the mixer strip's fader did, drop it — the v4
host injects a VOL knob in the pedal window's title bar that
attenuates every audio output in lockstep. Users expect it there.

Keeping a duplicate "level" parameter isn't broken, but it's
redundant chrome.

### 6. (Optional) Take advantage of v4 features

A migration is a good moment to add:

- A **sidechain input** if the plugin's a compressor / ducker /
  vocoder
- **CV ports** if the plugin can be modulated externally
- A **webview UI** if the parameter set is too large or weird for
  the host's auto-knob grid
- A **theme override** to brand the plugin's window

These are pure additions — the migration doesn't require them.

### 7. Re-validate + re-pack

```bash
node tools/ntvalidate.mjs <plugin-dir>
node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx
```

Note the extension: v4 FX plugins always pack as `.ntsfx`.

### 8. Bump the version + ship

Update `manifest.version` and publish. Users with the old `.ntsfx`
in their project's `plugins/` folder will see the new one when they
re-import; existing projects continue to work via the host's
auto-migration regardless.

## Pitfalls

- ❌ **Skipping the `pedal-v4` capability** — loader rejects the v4
  plugin. Always add it when bumping `schemaVersion` to 4 on a
  `type: "fx"` plugin.
- ❌ **Empty `ports` block** — pedals MUST have at least one entry
  in BOTH `inputs[]` and `outputs[]`. Even a CV-source utility
  needs at least one OUT (the CV jack itself).
- ❌ **Forgetting the validator** — v4 pedals have more invariants
  than v3 mixer modules. Run `ntvalidate` between every step.
- ❌ **Authoring a hybrid (v4 manifest with v3-style mixer module
  expectations)** — plugin FX no longer slot into the FX Mixer at
  v4; pedals live in the workspace exclusively. If your plugin's
  contract assumes "users put me in a mixer channel strip", that
  conceptual model is obsolete.
- ❌ **Removing the plugin's old version from the SDK examples
  folder** — keep the old version around as a reference for
  migration discussions until at least v4.x is widespread. Tag the
  archive directory clearly (e.g. `legacy-v3/`).

## Verification

1. `ntvalidate` exits 0 on the v4 manifest
2. `ntpack` produces a `.ntsfx`
3. Load the new `.ntsfx` into the v4 host. PLUGIN MANAGER shows it
   as `(FX)`
4. `+ ADD TO WS` spawns a pedal window with your declared jacks
5. Wire `TRACKER BUS.CH01` → pedal IN → MASTER IN.MAIN, play a
   pattern, confirm the pedal processes audio just like the v3
   version did
6. (Cross-check) Save a project with the v4 pedal, reload, confirm
   the pedal + cables come back

## Reference

- [`../../CHANGELOG.md#v40--fx-pedals-unified-typed-ports-bidirectional-webview-2026-04`](../../CHANGELOG.md#v40--fx-pedals-unified-typed-ports-bidirectional-webview-2026-04)
  — every v4 breaking change
- [`../../docs/13-pedals.md#migrating-a-v3-mixer-module-fx-plugin`](../../docs/13-pedals.md#migrating-a-v3-mixer-module-fx-plugin)
  — narrative migration guide
- [`../../docs/14-ports.md`](../../docs/14-ports.md) — typed port
  model
- [`../../examples/v40-mixer-pedal/`](../../examples/v40-mixer-pedal/),
  [`../../examples/v40-compressor-sc/`](../../examples/v40-compressor-sc/),
  [`../../examples/v40-cv-lfo/`](../../examples/v40-cv-lfo/) — three
  reference v4 pedals
