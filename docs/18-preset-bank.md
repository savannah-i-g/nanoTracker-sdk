# Preset bank (v4.1 Phase C)

Plugins can now persist user-saved presets into one of two scopes
via the webview bridge — both finished in v4.1 Phase C after being
reserved (validated but not wired) in v4.0.

| Scope | Where it lives | When it's useful |
|---|---|---|
| `"project"` | Inside the `.ftrk` song file (new **PPRS** block) | Song-specific tweaks that should travel with the arrangement |
| `"library"` | Per-plugin IndexedDB bank, shared across projects | Reusable patches the user wants to carry between songs |

Factory presets (`presets[]` in `plugin.json`) remain read-only and
ship with the archive. Both user scopes are additive and gated
behind the `"presetBank-v4"` capability.

## Factory presets with sample assignments

If your plugin uses `userAssignable` zones, a factory preset can
ship a full "kit" — parameter values **and** which WAV each slot
should load:

```jsonc
{
  "schemaVersion": 4,
  "manifest": { "name": "KIT-8", "version": "1.2.0", "type": "instrument" },
  "requires": ["graph", "sampler-v41", "userSamples", "presetBank-v4"],
  "presets": [
    {
      "name": "808 Classic",
      "values": { "tune": 0.5 },
      "sampleAssignments": {
        "kick":  "samples/808-kick.wav",
        "snare": "samples/808-snare.wav"
      }
    },
    {
      "name": "909 Big Room",
      "values": { "tune": 0.7 },
      "sampleAssignments": {
        "kick":  "samples/909-kick.wav",
        "snare": "samples/909-snare.wav"
      }
    }
  ]
  // …dsp, ui, etc.
}
```

**Rules:**

- Every key in `sampleAssignments` must match a declared `slotId` on
  a `userAssignable: true` zone.
- Every value must reference a file present in the archive (shipped
  sample).
- Declaring `sampleAssignments` anywhere in `presets[]` requires
  both `"presetBank-v4"` and `"userSamples"` in `requires[]`.

`ntvalidate` enforces every rule above.

## Webview bridge — user saves

Opt a webview control into `acceptsPresetWrites` and the iframe can
save, load, and delete user presets:

```js
// Save current params + (optionally) the slots the user has filled
// into a library-scope record reusable across projects.
window.parent.postMessage({
  type: "presetSave",
  name: "My Deep Bass",
  params: { cutoff: 1800, resonance: 0.7 },
  scope: "library",                // default "project" when omitted
  includeSampleAssignments: true,  // snapshot current user slot overrides
  tags: ["bass", "deep"]
}, "*");

// Load any preset — factory ("preset-N" or its name) OR user ("user-…" id)
window.parent.postMessage({ type: "presetLoad", presetId: "user-deep-bass-k9h2ab" }, "*");

// Delete a user preset. Factory ids are silently ignored.
window.parent.postMessage({ type: "presetDelete", presetId: "user-deep-bass-k9h2ab" }, "*");
```

## Events

**Host → iframe:**

- `presetList { presets: [{ id, name, scope }] }` — fired on mount
  and after every save/delete in either scope. Entries include
  factory + project-scope + library-scope presets; use `scope` to
  group them in your UI. Scope is optional on v4.0-host payloads;
  treat a missing field as `"factory"`.
- `presetSaved { presetId, scope }` — confirmation after a successful
  save, with the assigned id so the iframe can pre-select or
  highlight it.

**iframe → host:**

- `presetSave` (extended) — payload shape above.
- `presetDelete { presetId }` — new.

## How loading sample assignments works

When a preset with `sampleAssignments` is applied:

1. Parameter values go through the standard `updateParams` path.
2. Each `slotId → hash` entry is written into the live per-instance
   override table with reason `"preset"` (so
   `pluginSampleOverrides.subscribe` listeners receive the change).
3. The sampler runtime re-resolves zone buffers on the next noteOn
   via the existing override-aware resolution path.
4. Active voices playing a previous sample finish naturally.

Hashes that aren't present in the host's blob store (e.g. a preset
references a WAV the current machine has never seen) silently
revert that slot to its `fallbackFile`. Distributing presets with
embedded blobs is the `.ntpreset` story — deferred to v4.2.

## Capability matrix

| Feature | Required flags |
|---|---|
| `sampleAssignments` on factory presets | `presetBank-v4` + `userSamples` |
| Webview `presetSave { scope: "library" }` | `presetBank-v4` + `webview-writes` (+ `acceptsPresetWrites`) |
| Webview `presetSave { scope: "project" }` | `webview-writes` + `acceptsPresetWrites` (no `presetBank-v4` required — project-only saves predate the bank) |
| `presetDelete` | `webview-writes` + `acceptsPresetWrites` |

`ntvalidate` enforces the `presetBank-v4` / `userSamples` dependency
for factory `sampleAssignments`; runtime failures on missing
capability flags surface as `__nt_error` replies to the iframe.

## Built-in slot panel (ships alongside Phase C)

Plugins that declare user slots but don't author a webview picker
get a built-in host-rendered panel under the plugin UI — one row
per slot with PICK and CLEAR. Opt out (e.g. to ship a richer
webview-authored UI) by setting `sampleBank.allowUserSwap: false`.

## Sharing presets — `.ntpreset` (v4.2)

Webview-authored pickers can export/import user presets as
`.ntpreset` archives — zip files carrying `preset.json` plus the
sample blobs the preset references. See
[`19-ntpreset.md`](19-ntpreset.md) for the format and UX.

```js
// Export a user preset the iframe knows about:
window.parent.postMessage({
  type: "hostCommand",
  command: "exportPreset",
  args: { presetId: "user-deep-bass-k9h2ab" }
}, "*");

// Open a file picker to import one. On success the host posts a
// presetImported event with missingHashes[] if the archive shipped
// without blobs for some of its slot references.
window.parent.postMessage({
  type: "hostCommand",
  command: "importPreset"
}, "*");
```

Import always lands in **library** scope; move to project scope via
a follow-up `presetSave` if desired.

## What's deferred

- **Cross-instrument performance snapshots** — one preset binding
  state across multiple plugin instances. v5.0+.
- **Preset-library cloud sync** — v5.0+.

See [`../CHANGELOG.md`](../CHANGELOG.md) for the roadmap.
