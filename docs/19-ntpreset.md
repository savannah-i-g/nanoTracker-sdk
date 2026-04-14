# `.ntpreset` — distributable preset archive (v4.2)

The `.ntpreset` file format packages a single user-saved preset —
parameter values, optional sample assignments, and the actual sample
blobs those assignments reference — into one zip so users can share
patches between machines.

Plugins don't produce or consume `.ntpreset` files directly; the host
owns the format end-to-end. Plugin authors opt in via webview
`hostCommand` messages.

## Archive layout

```
my-preset.ntpreset            ← zip archive (application/x-ntpreset)
├── preset.json               ← manifest + UserPresetRecord
└── samples/                  ← optional, one entry per unique hash
    ├── sha256-<hex>.wav
    └── sha256-<hex>.wav
```

`preset.json` shape:

```jsonc
{
  "format": "ntpreset",
  "formatVersion": 1,
  "pluginRef": {
    "id":   "plugin:KIT-8@1.2.0",    // full id from the saving plugin
    "name": "KIT-8",                  // fuzzy-match fallback
    "version": "1.2.0",
    "minSchemaVersion": 4
  },
  "preset": {
    "presetId":  "user-deep-bass-k9h2ab",
    "name":      "Deep Bass",
    "tags":      ["bass", "deep"],
    "createdAt": 1712880000000,
    "updatedAt": 1712880000000,
    "values":    { "cutoff": 1800, "resonance": 0.7 },
    "sampleAssignments": {
      "kick":  "sha256:<hex>",
      "snare": "sha256:<hex>"
    }
  }
}
```

Sample filenames are `sha256-<hex>.wav` — the "colon" form
(`sha256:<hex>`) that appears inside JSON is replaced with a hyphen
in the filename so Windows zips are portable. The importer verifies
each entry's content hash matches its filename before storing.

## Distribution paths

### Export

From a webview:

```js
window.parent.postMessage({
  type: "hostCommand",
  command: "exportPreset",
  args: { presetId: "user-deep-bass-k9h2ab" }
}, "*");
```

The host resolves the id in project scope first, then library, zips
up the preset + every unique blob referenced by its
`sampleAssignments`, and triggers a browser download. Missing blobs
are skipped (export logs a warning) — the receiving machine will
report them as `missingHashes` on import.

### Import

```js
window.parent.postMessage({ type: "hostCommand", command: "importPreset" }, "*");
```

The host opens a `.ntpreset` file picker. On successful unpack:

1. Every `samples/*` entry's content hash is verified, then stored
   in the per-plugin blob store.
2. The preset record is written to the per-plugin IndexedDB
   library (always library scope on import — users can re-save
   into project scope afterwards).
3. Host → iframe `presetImported` event fires:

   ```js
   {
     type: "presetImported",
     presetId: "user-deep-bass-k9h2ab",
     scope: "library",
     missingHashes: []   // populated when the archive shipped
                         // without the blobs it references
   }
   ```

4. The presetList event refreshes so iframe browsers can highlight
   the new entry.

## Hash verification

The importer runs SHA-256 on every `samples/*` entry's bytes and
compares to the declared filename. A mismatch:

- Logs a warning.
- Skips that entry (does NOT install corrupted bytes against a
  legitimate hash).
- Adds the hash to `missingHashes[]` in the `presetImported` event.

This is the content-addressed model: a sample's identity is its
bytes, not its filename. Renaming a file in the zip can't smash
someone's legitimate sample under the same hash.

## What doesn't travel

`.ntpreset` carries:

- Parameter values.
- Sample assignments (slotId → hash).
- Optional sample blobs for those hashes.

It does NOT carry:

- Tracker project context (notes, patterns, mixer).
- Other instrument instances.
- Plugin binaries — the receiving host must already have the plugin
  loaded, or the `pluginRef` serves as a hint for future UX
  (plugin-store lookup, etc.).

Authors who need "sample pack with starter arrangement" pair
`.ntpreset` with the existing project bundle (`.ftrk` PLGB block
already carries plugin archives; the POVR block carries the
project's sample overrides).

## Capabilities

Export/import use the existing `webview-writes` capability plus
`acceptsHostCommands: true` on the webview control. No new
capability flag for the format itself — the receiving plugin has
already been loaded with its own `requires[]` satisfied, so preset
application goes through the normal `userSamples` / `presetBank-v4`
paths.

If the receiving plugin's `presets[]` or `userSlots` don't match
the incoming preset's shape (e.g. the user upgraded to a version
that renamed `slotId: "kick"` to `"kick-1"`), application silently
drops the unknown assignments. The host surfaces this via the
existing preset-load `__nt_error` path for missing blobs — a future
minor may add a dedicated "unknown slot" error flavour.

## MIME type

`application/x-ntpreset`. No registered extension as of writing;
browsers recognise the archive as a zip and present it inline with
a `.ntpreset` suffix in the download dialog.
