# MIDI ports & MIDI cables (`kind: "midi"`)

> **You need this page if:** your plugin wants to send or receive
> MIDI over workspace patch cables, opt out of the default
> MIDI-in port, build a MIDI processor (arpeggiator, CC scaler,
> transposer), or emit MIDI from a worklet.

The workspace cable system carries five port kinds: `audio`,
`sidechain`, `cv`, `gate`, and `midi`. The first four are Web Audio
edges. `midi` is different — it's a **message-passing** transport
that delivers typed MIDI events from one plugin's output jack to
every plugin whose MIDI input is cabled to it. Events cross the
cable as structured JS objects, not as raw MIDI bytes.

Every **instrument** plugin (`manifest.type === "instrument"`)
automatically gets two MIDI ports injected by the host:

- `midi-in` on the input rail — any cable plugged in drives
  `noteOn` / `noteOff` / `cc` / `pitchBend` / … into the voice
  engine.
- `midi-thru` on the output rail — every event that arrived at
  `midi-in` is re-emitted here *before* the voice engine processes
  it, so downstream plugins in a chain receive the full stream
  regardless of voice stealing or note suppression inside this
  plugin.

You don't author these ports. They appear on every instrument
plugin's window edges unless your manifest explicitly opts out.

---

## When you need this

| Situation | Read |
|---|---|
| "I want my instrument to stay triggerable from tracker rows, plus also accept a cabled MIDI source." | Nothing — implicit `midi-in` does this. |
| "I want to hide `midi-in` / `midi-thru` on my plugin." | [Opt-out](#opt-out) below. |
| "My plugin transforms the MIDI it receives (arpeggiator, chord trigger, transposer). I want to own what comes out of `midi-thru`." | [Custom thru](#custom-thru-midi-thru-custom) below. |
| "I want to send MIDI from my worklet." | [Worklet `midiOut` contract](#worklet-midiout-contract) below. |
| "I want to declare additional MIDI ports — a second `midi-in`, a per-voice `midi-out`, etc." | [Explicit MIDI ports](#explicit-midi-ports) below. |
| "I want my FX plugin (pedal) to receive MIDI." | Declare it explicitly in `ports.inputs[]`. Pedals don't get the implicit injection. |

---

## The `TrackerMidiEvent` shape

Every event crossing a MIDI cable is one of:

```ts
type TrackerMidiEvent =
  | { kind: "noteOn";    note: number; velocity: number; channel: number; time: number; id: number; parentId?: number }
  | { kind: "noteOff";   note: number;                   channel: number; time: number; id: number }
  | { kind: "cc";        controller: number; value: number; channel: number; time: number }
  | { kind: "pitchBend"; value: number; channel: number; time: number }          // signed, -8192..8191
  | { kind: "aftertouch"; value: number; channel: number; time: number }         // channel pressure only
  | { kind: "clock";     ppq24: number; time: number }
  | { kind: "transport"; action: "start" | "stop" | "continue"; time: number }
  | { kind: "spp";       beat: number; time: number }
  | { kind: "bpm";       bpm: number; time: number };
```

Scales follow the same convention as every other host↔plugin
interface on nanoTracker:

- `note` / `velocity` / `cc.value` — MIDI integers, **0–127**.
- `channel` — 0–15.
- `pitchBend.value` — signed, **-8192..8191** (MIDI's 14-bit bend minus
  centre). Multiply by `8192` to map a -1..+1 normalised bend.
- `time` — `AudioContext.currentTime` (seconds), used to schedule
  the downstream voice.

### `id` and `parentId` — logical note tracking

`id` is a monotonic integer the bus hands out so `noteOff`
matches `noteOn` **by id, never by (note, channel)**. Transposing,
remapping, or arp-expansion plugins can rewrite `note` freely and
the chain still tracks the original note across stages.

```ts
// Source side: ALWAYS allocate a fresh id for each noteOn.
const id = bus.nextId();
midiOut.send({ kind: "noteOn", note: 60, velocity: 100, channel: 0, time: now, id });
// Later:
midiOut.send({ kind: "noteOff", note: 60, channel: 0, time: now + 0.2, id });
```

Transforming plugins (arps, chord expanders) mint **new** ids per
output event and set `parentId` to the source id so debug tools
can trace the expansion:

```ts
// Arp: one noteOn in, four noteOns out.
for (let i = 0; i < 4; i++) {
  midiOut.send({
    kind: "noteOn",
    note: sourceNote + i * 3,
    velocity: sourceVelocity,
    channel: sourceChannel,
    time: sourceTime + i * 0.1,
    id: bus.nextId(),
    parentId: sourceId,
  });
}
```

Host receivers always release by `id`. If an id isn't known (e.g.
you got a `noteOff` without ever seeing the `noteOn`), the host
falls back to releasing by note number as a safety catch.

### `hops` — cycle tolerance

The bus tags every dispatched event with an internal `hops`
counter that increments at every cable edge. Events exceeding the
per-cable max (default **32**, configurable up to 256) are dropped
without delivery. This means a MIDI-delay plugin cabling its own
output back into its own input is legal — the feedback loop
terminates naturally once the hop limit is hit.

Authors generally don't touch `hops`; it's an internal field the
bus manages. Don't pre-set it; don't read it. It exists only to
bound feedback patches.

---

## Implicit ports (instruments only)

The host injects two `midi` ports on every instrument plugin at
load time:

| Port id | Direction | Label | Role |
|---|---|---|---|
| `midi-in` | input | `MIDI IN` | Incoming cable events drive the voice engine |
| `midi-thru` | output | `MIDI THRU` | Every incoming event is re-emitted here before worklet dispatch |

The injection is **non-breaking** — no manifest change, no
capability flag, no schema version bump. Existing plugins load
exactly as they did before; the jacks just appear on the window.

### Default behaviour

For each event arriving at `midi-in`:

1. Host re-emits the event on `midi-thru` **with `hops + 1`**,
   preserving `id` (and `parentId` when present). This pass
   happens **before** the voice engine runs, so voice stealing,
   polyphony limits, and the plugin's own DSP don't affect what
   downstream plugins receive.
2. For `noteOn` / `noteOff` events, the host calls your voice
   engine's `noteOn(note, velocity, time)` / `noteOff(note, time)`
   entry points. Audio production is automatic.
3. For `cc` / `pitchBend` / `aftertouch` / `clock` / `transport` /
   `spp` / `bpm` events, no dispatch happens at the voice engine
   layer today. (`cc`-to-parameter mapping is handled by the
   MIDI Learn layer, which taps the external-device stream
   upstream of cables — existing Learn mappings survive untouched
   when a cable sits between the device and your plugin.)

### Priority: MIDI cable over tracker rows

When a cable is connected to an instrument's `midi-in`, tracker
row `noteOn`s for that same workspace instance are **suppressed**.
Tracker `noteOff` / note-cut / release rows still pass through so
a sustained note can never get stuck if the MIDI source goes
quiet mid-pattern.

The host also flushes hanging notes at the connect / disconnect
boundary:

- On cable connect → any tracker-origin hanging notes receive a
  synthetic `noteOff` at the current audio time, so the cable
  starts from a clean slate.
- On the last cable disconnect → any cable-origin hanging notes
  receive a synthetic `noteOff` for the same reason.

This means you don't need to worry about stuck voices when users
cable and uncable MIDI sources mid-play.

---

## Opt-out

Hide either implicit port via a manifest `ports` flag:

```jsonc
{
  "ports": {
    "midiIn":   false,   // no implicit midi-in jack
    "midiThru": false    // no implicit midi-thru jack
  }
}
```

A plugin that sets `midiIn: false` will not receive cabled MIDI.
A plugin that sets `midiThru: false` still receives MIDI on
`midi-in`; it just won't fan the incoming events out to a thru
jack.

You don't need `portsV4` in `requires[]` to use these flags —
they're loose fields on the top-level `ports` object. (If you
**already** declare `portsV4` for other reasons, they still go in
the same block.)

### When to opt out

- **Your plugin already has its own `midi-in` port** with
  different labelling, position, or routing. Declare that
  explicit port and set `midiIn: false` to prevent the implicit
  one from appearing alongside it.
- **Your plugin is ornamental** — a visualiser, meter, or similar
  pseudo-instrument that won't respond to MIDI meaningfully. Hide
  both ports with `midiIn: false` + `midiThru: false`.
- **You're authoring a control-source plugin** (see
  [`23-control-source-plugins.md`](23-control-source-plugins.md))
  — those get `midi-out` instead of `midi-in`/`midi-thru` by default,
  but you can combine explicit declarations with opt-outs to build
  almost any shape.

---

## Explicit MIDI ports

You can declare your own MIDI ports in `ports.inputs[]` or
`ports.outputs[]` just like any other kind:

```jsonc
{
  "schemaVersion": 4,
  "requires": ["portsV4"],
  "ports": {
    "inputs": [
      { "id": "midi-in",   "label": "MIDI IN",   "kind": "midi" },
      { "id": "trigger",   "label": "TRIG",      "kind": "midi" }
    ],
    "outputs": [
      { "id": "midi-thru", "label": "MIDI THRU", "kind": "midi" },
      { "id": "arp-out",   "label": "ARP",       "kind": "midi" }
    ]
  }
}
```

An explicit port with the same `id` as an implicit one
(`"midi-in"` / `"midi-thru"`) **overrides** the implicit version —
the host skips the implicit injection when it sees your
declaration. Use this to rename, relabel, or add multiple MIDI
jacks.

Every `kind: "midi"` port resolves to a `MidiPortEndpoint` the
voice engine can reach through `engine.ports.{inputs,outputs}[i].midi`.
For declarative-graph plugins, the host wires the endpoint
internally and exposes it to your worklet via the `midiOut`
message contract (see below). For hand-built voice engines
(legacy API), you can attach event listeners yourself:

```ts
// In your engine factory, after buildV4Ports runs:
const midiIn = engine.ports.inputs.find(p => p.kind === "midi" && p.id === "midi-in");
if (midiIn?.midi) {
  const off = (midiIn.midi as MidiPortEndpoint).subscribe(event => {
    if (event.kind === "noteOn") { /* your handler */ }
  });
  // Call `off()` in engine.destroy() to release the subscription.
}
```

---

## Custom thru (`midi-thru-custom`)

By default the host re-emits every `midi-in` event on `midi-thru`
untouched. Plugins that transform MIDI (arpeggiators, chord
triggers, MIDI delays, scale quantisers) want to suppress the
default pass-through and emit their own events instead.

Declare the capability in `requires[]`:

```jsonc
{
  "requires": ["midi-thru-custom"]
}
```

When present, the host **stops** auto-forwarding events to
`midi-thru`. Your worklet is now responsible for sending its own
events via the [worklet `midiOut` contract](#worklet-midiout-contract)
below. The host still forwards incoming `noteOn` / `noteOff` to
the voice engine (so you hear the original note if you want the
plugin to double as a playable instrument); you can opt out of
that too by overriding the engine's `noteOn` to be a no-op.

### Safety watchdog

The host tracks `(eventsInWindow, thruEventsInWindow)` per
plugin instance. If a plugin declares `midi-thru-custom` but
emits no thru events over many incoming events, the host surfaces
a visible console warning (`"{plugin} may be swallowing MIDI"`).
This is a dev-tool signal, not a kill switch — the chain isn't
broken, just possibly misconfigured.

---

## Worklet `midiOut` contract

Any plugin whose DSP is a v3 AudioWorklet can emit MIDI by
posting a `midiOut` message from the processor:

```js
// inside your AudioWorkletProcessor
this.port.postMessage({
  type:  "midiOut",
  event: {
    kind: "noteOn",
    note: 60,
    velocity: 100,
    channel: 0,
    time: currentTime,      // or a scheduled AudioContext time
    id:   this.nextMidiId++ // maintain your own monotonic counter
  },
});
```

The host listens on the worklet's port and forwards the `event`
object to the plugin's `midi-out` endpoint (the implicit one on
control-source plugins, or the first `kind: "midi"` output port
on other types). The bus handles `hops` incrementation and
downstream dispatch.

### Where the host looks for the destination endpoint

The host finds the first `kind: "midi"` output port on the
plugin's resolved port set and treats it as the target. If your
plugin declares multiple MIDI outputs and you need to route to a
specific one, include a `portId` field:

```js
this.port.postMessage({
  type:   "midiOut",
  portId: "arp-out",                // optional — defaults to first midi-out
  event:  { /* TrackerMidiEvent */ },
});
```

(Currently the host accepts `portId` but the first-port fallback
is sufficient for all single-output plugins. Multi-output
routing is an authoring convenience.)

### Maintaining your own `id` counter

The bus's `nextId()` is a host-side API; worklets run in a
separate realm and can't call it directly. Maintain your own
monotonic counter inside the processor:

```js
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Start above 1000 so ids never collide with the host's
    // own allocator in dev tools — the bus doesn't care what
    // range you use, only that your ids are unique per note
    // within your processor.
    this._nextId = 1_000_000;
  }
  allocId() { return this._nextId++; }
}
```

Matching `noteOff`s must reference the same `id` you sent on
`noteOn`. If you lose the pairing (processor restart, bank change),
send `noteOff` with a fresh id and the host will fall back to
(note, channel) matching on the receiver side.

---

## Host-side pseudo-instruments

Every workspace ships four built-in MIDI pseudo-instruments pinned
into the instrument list. You don't have to do anything to use them;
they're present in every project. Reference them in your plugin's
README wiring examples so users know where to cable:

| Workspace id | Role | Shape |
|---|---|---|
| `__clock-source` | Transport clock → cable | `clock-out: midi-out` emitting `clock` (24 PPQN), `transport` (start/stop), `spp` events derived from the tracker's transport |
| `__midi-clock-sink` | Cable → hardware MIDI clock out | `clock-in: midi-in` that forwards clock/transport/SPP events to the user's configured external MIDI outputs |
| `__ext-midi-in` | Hardware MIDI keyboard → cable | One `midi-out` port per connected `MIDIInput` device |
| `__ext-midi-out` | Cable → hardware MIDI out | One `midi-in` port per connected `MIDIOutput` device |

### TrackerBus MIDI fan-out

The existing **TrackerBus** (`__tracker-bus`) gains four additional
port families alongside its per-channel audio outs:

- `chNN.vol.cv` — `cv-out` emitting each tracker channel's linear
  gain (0..1) as a DC signal. Cable this into a pedal's CV input
  to sidechain off channel volume.
- `chNN.midi` — `midi-out` emitting row-derived events for that
  tracker channel. Volume column → CC 7, panning → CC 10, porta
  / glide → pitch bend, tempo → bpm.
- `master.midi` — `midi-out` — merged stream of all channels,
  with the originating tracker channel stamped on each event.
- `master.midi.in` — `midi-in` — cabled-in events drive tracker
  channel playback routed by `event.channel`.

---

## Pedal plugins (`manifest.type === "fx"`)

Pedals do **not** get implicit MIDI ports. If your pedal wants to
receive or emit MIDI, declare the ports explicitly:

```jsonc
{
  "manifest": { "type": "fx" },
  "requires": ["pedal-v4", "portsV4", "graph"],
  "ports": {
    "inputs": [
      { "id": "in",       "label": "IN",   "kind": "audio" },
      { "id": "midi-in",  "label": "MIDI", "kind": "midi" }
    ],
    "outputs": [
      { "id": "out", "label": "OUT", "kind": "audio" }
    ]
  }
}
```

The loader warns (but doesn't fail) if a pedal declares
`ports.midiIn: false` since the opt-out field is only meaningful
for instruments.

---

## Control-source plugins (`manifest.type === "control-source"`)

Control-source plugins are first-class MIDI emitters — step
sequencers, virtual keyboards, drum machines, arpeggiators. Their
default port shape is different:

- **No** implicit `midi-in` or `midi-thru`.
- An implicit `midi-out` port is injected (unless the manifest
  already declared one with the same id).
- Tracker rows still trigger the plugin; the plugin converts the
  trigger into MIDI and emits it.

Full reference: [`23-control-source-plugins.md`](23-control-source-plugins.md).

---

## Arbitration granularity

The "MIDI cable takes priority over tracker rows" rule operates per
**plugin instance**. Two different workspace instances of the same
plugin id can have different cable states — cabling `midi-in` on
instance A doesn't affect tracker row triggering on instance B.

Multiple cables terminating on the same `midi-in` are allowed and
fan in together. Events from every upstream source reach the
plugin; the bus doesn't attempt to prioritise one cable over
another.

---

## Compatibility matrix

Same as the audio/CV/gate matrix — different kinds don't mix:

| Src ↓  Dst → | `audio` | `sidechain` | `cv` | `gate` | `midi` |
|---|:-:|:-:|:-:|:-:|:-:|
| `audio`     | ✅ | ✅ | ❌ | ❌ | ❌ |
| `sidechain` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `cv`        | ❌ | ❌ | ✅ | ❌ | ❌ |
| `gate`      | ❌ | ❌ | ❌ | ✅ | ❌ |
| `midi`      | ❌ | ❌ | ❌ | ❌ | ✅ |

The user dragging an incompatible cable in the workspace gets a
silent drop with a console warning; the cable never commits.

---

## Non-breaking checklist

Every existing plugin keeps working after the MIDI-cable addition:

- [x] No `schemaVersion` bump required.
- [x] Plugins without any MIDI-aware manifest changes get the
      implicit `midi-in` / `midi-thru` jacks automatically.
- [x] Plugins that want to disable them set `ports.midiIn: false`
      / `ports.midiThru: false` — no capability flag, no
      cascading manifest changes.
- [x] Saved `.ftrk` projects load unchanged; MIDI cables serialise
      with the same `WorkspaceCableSnapshot` shape as audio/CV
      cables (`srcKind` / `dstKind` widen to include `"midi"`).
- [x] Old `.ntins` archives opened in a MIDI-aware host gain the
      implicit ports transparently.
- [x] Legacy tracker-row triggering continues to drive the voice
      engine when no MIDI cable is connected; the arbitration
      check is a no-op in that case.

---

## Gotchas

### "My `noteOff` doesn't match my `noteOn`."

Check you're sending the **same `id`** on both. Matching is id-based,
not (note, channel)-based. If you allocated a new id for the
`noteOff`, the receiver won't find a pairing and falls back to note
number — which is fine for simple cases but breaks under transposition
/ arp expansion.

### "My thru pass-through isn't firing."

Make sure you haven't declared `midi-thru-custom`. That capability
**disables** default thru forwarding on the assumption that your
worklet owns emission. Either drop the capability or start posting
`midiOut` messages.

### "Events arrive twice on downstream plugins."

You're probably declaring both the implicit `midi-thru` AND an
explicit `midi-out` that mirrors it. Pick one — either opt out of
the implicit thru (`ports.midiThru: false`) or rename your explicit
port.

### "I plugged my MIDI delay into itself and the app froze."

It didn't freeze — the `hops` counter silently dropped your events
after 32 iterations. If you need more headroom, set `maxHops`
per-cable at connect time (up to 256). For most patches the
default is fine.

### "My cable is rejected with 'kind mismatch'."

You're trying to cable a MIDI port to a non-MIDI port. MIDI cables
only connect `midi` ↔ `midi`. If you need to convert MIDI events
to CV or audio, use an intermediate plugin that does the
translation explicitly.

---

## See also

- [`14-ports.md`](14-ports.md) — unified typed port model overview
- [`23-control-source-plugins.md`](23-control-source-plugins.md) —
  MIDI-emitting plugin type
- [`reference/host-capabilities.md`](reference/host-capabilities.md)
  — `midi-thru-custom` flag
