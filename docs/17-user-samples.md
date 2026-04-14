# User-assignable sample slots (v4.1 Phase B)

Plugins that want users to drop their own WAVs into a slot (drum
racks, breakbeat choppers with a replaceable break, multi-sample
rompler) declare `userAssignable: true` on the relevant zones and
add `"userSamples"` to `requires[]`. The host wires the rest —
native file picker, content-hashed IndexedDB persistence, POVR
`.ftrk` embedding so overrides travel with the song, and a
bidirectional webview bridge so plugin authors can build a custom
picker UI.

```jsonc
{
  "schemaVersion": 4,
  "manifest": { "name": "KIT-8", "version": "1.1.0", "type": "instrument" },
  "requires": ["graph", "sampler-v41", "userSamples", "webview-ui", "webview-writes"],
  "sampleBank": {
    "userSlotCount": 8,
    "allowUserSwap": true
  },
  "parameters": [],
  "dsp": {
    "processorName": null, "voices": 16, "voiceStealing": "oldest",
    "oscillators": [], "samples": [],
    "envelope": {"attack":0.001,"decay":0.1,"sustain":0.8,"release":0.3},
    "filter": null,
    "graph": {
      "nodes": [
        { "id": "kit", "type": "sampler",
          "zones": [
            {
              "file":          "samples/kick-default.wav",
              "fallbackFile":  "samples/kick-default.wav",
              "rootKey":       36,
              "keyRange":      { "lo": 36, "hi": 36 },
              "velocityRange": { "lo": 1,  "hi": 127 },
              "loop": "none", "loopStart": 0, "loopEnd": 0,
              "startOffset": 0, "duration": 0,
              "pitchTracking": false,
              "userAssignable": true,
              "slotId": "kick",
              "slotLabel": "Kick",
              "accept": ["audio/wav","audio/flac"],
              "maxDurationSec": 10
            }
          ]
        }
      ],
      "connections": [ { "from": "kit", "to": "voiceOut" } ]
    }
  },
  "ui": { "layout": "flex", "controls": [] }
}
```

## Zone fields

| Field | Meaning |
|---|---|
| `userAssignable: true` | This zone exposes a slot the user can replace at runtime. |
| `slotId` | Stable, unique identifier. Required when `userAssignable`. The override table, POVR `.ftrk` block, and iframe events all key on this string, so don't change it across plugin versions or old projects won't locate the slot. |
| `slotLabel` | Human-readable label. Defaults to `slotId`. |
| `fallbackFile` | Archive-relative path to the default sample. Used until the user drops their own. Strongly recommended; without it a fresh install plays silence in this slot. |
| `accept` | MIME whitelist for the picker UI (e.g. `["audio/wav","audio/flac"]`). Purely advisory — the decoder rejects anything it can't handle regardless. |
| `maxDurationSec` | Reject overly long user drops with a clear error. `0` or omitted = no cap. |

## `sampleBank` block

```jsonc
"sampleBank": {
  "userSlotCount": 16,
  "allowUserSwap": true,
  "presetsCarrySamples": "optional"
}
```

All fields are optional hints to the host:

- `userSlotCount` — UI sizing hint (e.g. grid columns). Declaring
  this doesn't enforce a cap — the true number of user slots is
  whatever zones are marked `userAssignable`.
- `allowUserSwap` — set `false` to suppress the built-in slot panel
  (for plugins that provide their own webview picker).
- `presetsCarrySamples` — reserved for v4.1.2 (Phase C), where
  user preset saves can include sample assignments.

Declaring a `sampleBank` block requires the `userSamples` capability.

## Runtime behaviour

**When the user drops a WAV into a slot:**

1. Host reads the file, computes its SHA-256 content hash, decodes
   for metadata, stores the original bytes in IndexedDB keyed by
   hash (dedup automatic: same WAV dropped into three slots stores
   once).
2. The per-instance override table records `slotId → hash`.
3. The sampler runtime fires every future noteOn into the new
   buffer. Active voices playing the previous sample finish
   naturally.

**When the project is saved:**

Every live override is serialised into a new `.ftrk` POVR block —
blob bytes + slotId + instance + metadata. File grows by the size
of every unique overridden sample. Users who share the project get
the exact audio.

**When the project is reloaded:**

POVR is parsed, bytes go back into IndexedDB, override table is
rebuilt, instances pick up the overrides as they come online. No
user action required.

## Webview picker (optional)

Plugins with a webview UI can surface custom slot UIs by opting the
webview into writes:

```jsonc
"ui": {
  "controls": [{
    "type": "webview",
    "source": "web/ui.html",
    "aspectRatio": "4/3",
    "acceptsHostCommands": true
  }]
}
```

```js
// iframe: ask the host to open a picker for slot "kick"
window.parent.postMessage({
  type: "hostCommand",
  command: "openSamplePicker",
  args: { slotId: "kick" }
}, "*");

// iframe: clear a slot back to fallback
window.parent.postMessage({
  type: "hostCommand",
  command: "clearSampleSlot",
  args: { slotId: "kick" }
}, "*");

// iframe: react to every slot change
window.addEventListener("message", ev => {
  const msg = ev.data;
  if (msg?.type === "sampleAssigned") {
    // msg.slotId, msg.sampleId, msg.name, msg.duration,
    // msg.channels, msg.sampleRate, msg.source ("user"|"fallback"|"preset")
  }
  if (msg?.type === "sampleSlots") {
    // msg.slots: Array<{ slotId, label, sampleId, name, userOverride }>
    // Fired once on mount AND after every change — use it to rebind a
    // grid UI without tracking individual assigns.
  }
});
```

`acceptsHostCommands: true` requires `"webview-writes"` in `requires[]`.

## Capability matrix

| Feature | Required flags |
|---|---|
| Any `userAssignable: true` zone | `userSamples` |
| Top-level `sampleBank` block | `userSamples` |
| `openSamplePicker` / `clearSampleSlot` from a webview | `userSamples` + `webview-ui` + `webview-writes` (+ `acceptsHostCommands: true` on the control) |

`ntvalidate` enforces all of the above — run it before packing.

## What's deferred

- **User presets** — saving a user's parameter + sample-assignment
  bundle as a reusable preset. Phase C (v4.1.2).
- **`.ntpreset` distribution** — sharing preset files between users.
  v4.2.
- **Host-rendered slot panel** — the built-in panel under the
  plugin window (as distinct from webview-authored pickers). Phase
  B.1 follow-up.

See [`../CHANGELOG.md`](../CHANGELOG.md) for the full roadmap.
