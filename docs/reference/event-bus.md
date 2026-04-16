# VoiceEngineEvent reference

The nanoTracker host fires `VoiceEngineEvent`s after every note /
parameter / pitch / gain dispatch on a workspace instrument. These
events are the payload the host forwards to webview plugins over the
`postMessage` bridge. This page documents every event shape so
webview authors can write type-safe handlers.

## TypeScript definition

```typescript
export type VoiceEngineEvent =
  | { type: "noteOn";        note: number; velocity: number; time: number }
  | { type: "noteOff";       note: number; time: number }
  | { type: "param";         key: string;  value: number }
  | { type: "pitch";         frequencyHz: number; time: number }
  | { type: "gain";          gain: number; time: number }
  | { type: "allNotesOff";   time: number }
  // v3.5
  | { type: "trackerEffect"; effectCode: number; value: number; time: number }
  | { type: "themeChange";   theme: PluginThemeOverride }
  // v4
  | { type: "presetList";    presets: Array<{ id: string; name: string }> };
```

Every event is a plain object with a `type` discriminator. Webview
handlers should switch on `type` and narrow:

```js
window.addEventListener("message", (e) => {
  const ev = e.data;
  if (!ev || typeof ev !== "object") return;
  switch (ev.type) {
    case "noteOn":        /* ev.note, ev.velocity, ev.time */ break;
    case "noteOff":       /* ev.note, ev.time */ break;
    case "param":         /* ev.key, ev.value */ break;
    case "pitch":         /* ev.frequencyHz, ev.time */ break;
    case "gain":          /* ev.gain, ev.time */ break;
    case "allNotesOff":   /* ev.time */ break;
    case "trackerEffect": /* ev.effectCode, ev.value, ev.time (v3.5) */ break;
    case "themeChange":   /* ev.theme is a ThemeColorSet (v3.5) */ break;
  }
});
```

## Event types

### `noteOn`

Fires when the host dispatches a note-start on the instrument.

```json
{ "type": "noteOn", "note": 60, "velocity": 100, "time": 1.234 }
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `type` | string | — | Always `"noteOn"` |
| `note` | number | 0–127 | MIDI note number (60 = C4) |
| `velocity` | number | 0–127 | MIDI velocity (127 is loudest) |
| `time` | number | seconds | `AudioContext.currentTime` value at dispatch |

**Sources that fire this:**

- Tracker channel playback hits a row with a note cell
- User plays a preview note from the tracker keyboard
- Direct `workspace.noteOn(workspaceId, note, velocity)` call (e.g.,
  from MIDI input)
- `workspace.noteOnFromChannel(workspaceId, ch, note, velocity)` — the
  channel-aware variant used by tracker playback

**Not fired by:**

- Loading a plugin
- Hovering over a note in the pattern editor
- Keyboard events inside a webview iframe (those are iframe-internal)

### `noteOff`

Fires when the host dispatches a note-end.

```json
{ "type": "noteOff", "note": 60, "time": 1.456 }
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `type` | string | — | Always `"noteOff"` |
| `note` | number | 0–127 | MIDI note number |
| `time` | number | seconds | `AudioContext.currentTime` value at dispatch |

**Important:** `noteOff` events can arrive for notes that `noteOn`
hasn't been seen for (e.g., if the iframe mounted mid-playback and
the bridge's ready handshake flushed a late `noteOff`). Handle
gracefully — don't assume every `noteOff` has a matching prior
`noteOn`.

### `param`

Fires when a plugin parameter changes — either from UI interaction,
automation, or a preset load.

```json
{ "type": "param", "key": "cutoff", "value": 2400 }
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `"param"` |
| `key` | string | Matches a `parameters[].key` declared in `plugin.json` |
| `value` | number | New value in the parameter's native range |

**Note:** `param` events do NOT carry a `time` field. They're applied
immediately on the main thread — the host's audio-side work (setting
the relevant AudioParam) happens in a separate code path with its
own timestamp.

**Update frequency:** UI knob drags can fire `param` events at display
refresh rate (~60 Hz) while the user drags. Your webview handler
should be cheap — don't trigger expensive work per event. If you
need to throttle, use your own rAF-based debouncer.

### `pitch`

Fires when the host dispatches a per-voice pitch update mid-note.

```json
{ "type": "pitch", "frequencyHz": 440.5, "time": 1.234 }
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `"pitch"` |
| `frequencyHz` | number | New frequency in Hz |
| `time` | number | `AudioContext.currentTime` value |

**Sources that fire this:**

- Portamento / glide during tracker playback
- Vibrato effect (MOD effect `4xy`)
- Arpeggio effect (MOD effect `0xy`)
- Direct `workspace.setPitch(workspaceId, hz)` call

**Semantics:** this event is "change the pitch of the voice that's
currently held on this instrument." The host doesn't track which
voice it applies to in the webview bridge — if your webview plugin
is a polyphonic synth hosted in an iframe, you need to correlate
with the most recent `noteOn` yourself.

### `gain`

Fires when the host dispatches a per-voice gain update mid-note.

```json
{ "type": "gain", "gain": 0.75, "time": 1.234 }
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `type` | string | — | Always `"gain"` |
| `gain` | number | 0–1 | Linear gain (0 = silent, 1 = full) |
| `time` | number | seconds | `AudioContext.currentTime` value |

**Sources that fire this:**

- Volume slide effect (MOD effects `Axy`, `5xy`)
- Tremolo effect (MOD effect `7xy`)
- Direct `workspace.setGain(workspaceId, gain)` call
- Tracker volume column writes

### `allNotesOff`

Fires when the host silences all voices on the instrument — transport
stop, panic button, or plugin removal.

```json
{ "type": "allNotesOff", "time": 1.567 }
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `"allNotesOff"` |
| `time` | number | `AudioContext.currentTime` value |

**Semantics:** release every currently-held voice immediately. The
webview handler should mirror this by releasing whatever game /
emulator state maps to "all keys up." See the DOOM example's
`releaseAll()` function for a reference implementation.

### `trackerEffect` (v3.5)

Fires when a tracker effect-column command lands on a channel routed
to the instrument. Opt-in via the webview control's
`forwardEffects: true` flag (default `false`, so existing bridges
don't see a new traffic class).

```json
{ "type": "trackerEffect", "effectCode": 4, "value": 66, "time": 1.234 }
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `type` | string | — | Always `"trackerEffect"` |
| `effectCode` | number | 0..15, 0xE_ | Raw MOD effect nibble (e.g. `0x4` = vibrato, `0x7` = tremolo). Extended `E_` effects are passed through with the full byte. |
| `value` | number | 0–255 | Raw effect value byte — high/low nibbles are the effect's own to interpret. |
| `time` | number | seconds | `AudioContext.currentTime` at dispatch. |

**Semantics:** the host has already dispatched this effect to the
plugin's native `applyTrackerEffect` hook (if any). The webview event
is a *notification* — acting on it is purely for UI / visualisation
purposes. Don't try to drive audio from it; the plugin's voice engine
has already handled the effect.

### `themeChange` (v3.5)

Fires when the host's theme changes, either because the user picked a
different global theme or because the plugin's own `ui.themeOverride`
resolved against a changed global. The event carries the full resolved
`ThemeColorSet` (globals merged with plugin override), so the iframe
never needs to ask the host for a colour.

```json
{
  "type": "themeChange",
  "theme": {
    "primary": "#ff7a00",
    "primaryDim": "#7a3a00",
    "bg": "#140800",
    "text": "#ffddbb",
    "...": "..."
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `"themeChange"` |
| `theme` | `ThemeColorSet` | All 11 colour keys with fully-resolved CSS colour values (no `var(...)` references). |

**When it fires:**

- Once on iframe mount, shortly after the `__nt_ready` handshake
  flushes the queue. This is the initial snapshot.
- Again on every global theme change (built-in swap, custom theme
  edit, live-preview slider).

Typical iframe handler:

```js
case "themeChange":
  for (const [k, v] of Object.entries(ev.theme)) {
    document.documentElement.style.setProperty(
      "--color-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase()),
      v,
    );
  }
  break;
```

Setting the CSS vars inside the iframe lets your own stylesheet pick
them up via `var(--color-primary)` the same way the tracker's host
chrome does.

### `presetList`

Fires on iframe mount with the plugin's factory preset catalogue
(when the plugin authors at least one), and re-fires after every
`presetSave` / `presetDelete` and on project reload. Lets the iframe
render its own preset browser without polling.

```json
{
  "type": "presetList",
  "presets": [
    { "id": "preset-0", "name": "INIT" },
    { "id": "preset-1", "name": "DUSTY PAD" }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `"presetList"` |
| `presets` | array | One entry per preset known to the host. `id` is stable; `name` is user-facing and may change on rename. |

The iframe triggers a preset load by posting
`{type: "presetLoad", presetId: "preset-1"}` back — see
[`../09-webview.md`](../09-webview.md#bidirectional-bridge-v4).

## Iframe → host messages (v4)

The v4 bridge opens a write channel for webview plugins that opt in
via `"webview-writes"` capability and per-control `accepts*` flags.
The iframe posts any of the following shapes via
`window.parent.postMessage(msg, "*")`:

```typescript
export type IframeToHostMessage =
  | { type: "__nt_ready" }                                                // v3.4
  | { type: "__nt_audio"; left: Float32Array; right?: Float32Array }      // v3.5
  | { type: "__nt_error"; where: string; message: string }                // v3.5 (worklet authors)
  // v4 write channel (gated by "webview-writes" + per-control flags)
  | { type: "paramWrite";  key: string; value: number }
  | { type: "presetLoad";  presetId: string }
  | { type: "presetSave";  name: string; params: Record<string, number> }
  | { type: "noteOn";      note: number; velocity: number }
  | { type: "noteOff";     note: number }
  | { type: "hostCommand";
      command: "focusRequest" | "resizeRequest" | "showToast" | "openSamplePicker";
      args?: unknown };
```

Every v4 write is validated against the plugin's manifest:

- `paramWrite` — `key` must exist in `parameters[]`, value clamped to
  the declared `min`/`max`.
- `presetLoad` — `presetId` must match an entry in `presets[]` (or
  a runtime-saved preset id).
- `presetSave` — `name` trimmed, non-empty, ≤64 chars. Stored on the
  workspace instrument snapshot; persists through save/load.
- `noteOn` / `noteOff` — dispatched into the plugin's voice engine
  exactly as if the user played them from the tracker keyboard.
- `hostCommand` — `command` must be in the whitelist. `args` shape
  depends on the command (see table in `09-webview.md`).

Invalid writes never throw — the host drops them and posts
`{type:"__nt_error", where:"<msgType>", message:"<reason>"}` back into
the iframe so author-side consoles can see what went wrong.

## What the event bus does NOT forward

The following **do not** generate webview events in v1/v3.5:

- **Plugin load/unload** — no `init` or `dispose` event. Use the
  iframe's own `load` lifecycle.
- **Other instruments' events** — the bridge is strictly per-instrument.
  A webview on instrument A doesn't see events on instrument B.
- **Transport state** (play / stop / record) — the iframe can infer
  from `noteOn` / `allNotesOff` patterns but doesn't receive an
  explicit transport signal.
- **Tempo / BPM changes** — not forwarded as an event. Inside the host
  they drive BPM-synced LFOs (v3.5) via a separate channel. If your
  webview needs BPM, declare a `bpm` parameter and update it from your
  host code.

## Host-side filtering

The webview control has three bridge filter flags:

- `forwardNotes` (default `true`) — forwards `noteOn`, `noteOff`,
  `pitch`, `gain`, `allNotesOff`
- `forwardParams` (default `true`) — forwards `param`
- `forwardEffects` (default `false`, v3.5) — forwards `trackerEffect`

`themeChange` events are always forwarded when a bridge exists; they
are low-frequency (mount + user-initiated theme changes) so there's no
reason to throttle them.

Set flags to `false` in `plugin.json` to save postMessage bandwidth:

```json
{ "type": "webview", "source": "web/scope.html", "forwardNotes": false }
```

A parameter-only visualizer doesn't need note events; a pure game
controller doesn't need param events. Filter what you don't use.

## Timing

`time` fields come from `AudioContext.currentTime` on the host side,
translated to seconds. They're accurate to within the host's
`currentTime` precision (~sub-millisecond). Use for:

- Scheduling precise game ticks aligned to tracker beats
- Computing inter-note intervals for animation
- Correlating events with host audio playback

**Don't use for:**

- Real-world wall clock time (the audio clock drifts relative to
  `performance.now()`)
- Cross-session consistency (`currentTime` resets to 0 on every
  page load)

## See also

- [`../09-webview.md`](../09-webview.md) — webview control reference
- [`../10-wasm-in-webview.md`](../10-wasm-in-webview.md) — DOOM
  walkthrough (the biggest real-world consumer of these events)
- [`../../examples/doom-wasm/src/template.html`](../../examples/doom-wasm/src/template.html) —
  production-quality event handler covering every type in the union
