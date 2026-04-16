# Control-source plugins (`type: "control-source"`)

> **You need this page if:** you're building a step sequencer,
> virtual keyboard, drum machine, arpeggiator, chord trigger,
> euclidean sequencer, LFO-to-CC emitter, or anything else whose
> primary output is **MIDI events**, not audio.

Control-source plugins are a third top-level plugin type, alongside
`"instrument"` (plays notes, emits audio) and `"fx"` (audio in,
audio out). They have the following shape:

- Triggered by tracker rows the same way instruments are.
- Emit MIDI over cables rather than audio over the master bus.
- Declare **no** audio outputs (or only optional preview/click
  outs for monitoring).
- Get an implicit `midi-out` port injected at load time.

Think of them as MIDI instruments in the hardware sense: a device
whose patch cables carry note / CC / clock data that downstream
devices (audio instruments, MIDI effects, external gear) consume.

---

## Minimum viable manifest

```jsonc
{
  "schemaVersion": 4,
  "manifest": {
    "name":    "STEP SEQ 16",
    "version": "1.0.0",
    "type":    "control-source",
    "description": "16-step × 4-lane clock-driven sequencer"
  },
  "requires": ["portsV4"],
  "parameters": [
    { "key": "gate_length", "label": "GATE", "min": 0.05, "max": 1.0, "default": 0.5, "step": 0.01 }
  ],
  "ui": {
    "layout":  "flex",
    "controls": [
      { "type": "knob", "parameter": "gate_length", "label": "GATE" }
    ]
  }
}
```

At load time the host adds an implicit `midi-out` port to this
plugin. Users see it on the right edge of the plugin window; they
cable it to an instrument's `midi-in` or the External MIDI Out
pseudo-plugin to drive external gear.

---

## Port shape

### Implicit `midi-out`

Every control-source plugin gets:

```jsonc
{ "id": "midi-out", "label": "MIDI OUT", "kind": "midi", "direction": "out" }
```

injected automatically. No manifest changes required. The port
resolves to a `MidiPortEndpoint` the plugin drives via the
[worklet `midiOut` contract](#worklet-midiout-contract) or a
hand-built engine subscription.

There's **no opt-out** for the implicit `midi-out` — a
control-source plugin with no MIDI output is a contradiction in
terms. If you want to declare your own MIDI output with a
different id / label, do so in `ports.outputs[]` and the implicit
injection is skipped.

### No implicit `midi-in` / `midi-thru`

Unlike instruments, control-source plugins don't get the input /
thru pair automatically. They're emitters by default. If you want
a control-source that also accepts incoming MIDI (for example a
MIDI-in-driven arpeggiator that doubles as a pattern generator),
declare the input explicitly:

```jsonc
{
  "ports": {
    "inputs":  [{ "id": "midi-in",  "label": "MIDI IN",  "kind": "midi" }],
    "outputs": [{ "id": "midi-out", "label": "MIDI OUT", "kind": "midi" }]
  }
}
```

Because you've declared `midi-out` explicitly, the implicit
injection is skipped — your manifest is authoritative.

### No audio output

The host does not require `ports.outputs` to include an `audio`
entry for control-source plugins. `countAudioOutputs()` returns 0
on a control-source unless you explicitly declare audio outs, and
`engine.output` falls back to a silent `GainNode` so downstream
workspace plumbing keeps working without an actual audio signal.

**Optional preview audio:** if your plugin wants to emit a preview
click or monitoring audio (a metronome tick, a keyboard sample
feedback), declare an audio output jack:

```jsonc
{
  "ports": {
    "outputs": [
      { "id": "midi-out", "label": "MIDI OUT", "kind": "midi" },
      { "id": "preview",  "label": "PREVIEW",  "kind": "audio" }
    ]
  }
}
```

The host treats the audio output normally — volume control, cable
routing, master-bus mixing all apply.

---

## Triggering model

### From tracker rows

Control-source plugins show up in the tracker's instrument
picker. A tracker row referencing a control-source slot invokes
the plugin's voice engine's `noteOn(note, velocity, time)` hook
exactly as it would an audio instrument. Your plugin converts the
trigger into whatever MIDI it wants to emit.

Example: a chord-trigger plugin receives `noteOn(60, 100, t)` and
emits four `noteOn` events for the root, third, fifth, and octave.

### From cabled MIDI (optional)

If you declared a `midi-in` port, cabled events arrive via the
standard [MIDI cable layer](22-midi-ports.md). A common pattern:

- Arpeggiator: `midi-in` holds the chord → timing-locked arp
  pattern → `midi-out`.
- Chord trigger: `midi-in` holds the root note → `midi-out`
  emits the chord voicing.
- MIDI delay: `midi-in` → delayed echoes fan to `midi-out`.

### From the transport clock

Control-source plugins that react to song position (step
sequencers, drum machines, clock-driven euclidean generators)
declare the `consumes-song-position` capability and receive a
host-driven clock / position stream. Two ways to consume it:

1. **Via a worklet,** by handling `songPosition` messages posted
   to your processor's port.
2. **Via a webview UI,** by handling `songPosition` bridge
   events. See [`09-webview.md`](09-webview.md).

Alternatively, cable the workspace's `__clock-source` pseudo-
plugin into your `midi-in` and consume `clock` / `transport` /
`spp` events as MIDI. That's the more flexible path because the
user can route clock from external sources too (ext MIDI in →
your plugin).

---

## Worklet `midiOut` contract

The primary way for a control-source plugin to emit MIDI is from
inside its AudioWorkletProcessor:

```js
class StepSeqProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._nextId = 1;
    this._steps = [60, 64, 67, 72, 60, 64, 67, 72, /* … */];
    this._stepIdx = 0;
    this._gate = 0.5;

    this.port.onmessage = e => {
      const msg = e.data;
      if (msg.type === "param" && msg.key === "gate_length") {
        this._gate = msg.value;
      }
      if (msg.type === "songPosition") {
        // Fires on every host tick; use msg.position.ppq24Counter
        // to pace your steps. Example below fires one step per
        // 6 PPQN ticks (= 16th notes).
        if (msg.position.ppq24Counter % 6 === 0) this.fireStep(msg.position.audioTime);
      }
    };
  }

  fireStep(time) {
    const note = this._steps[this._stepIdx];
    const id = this._nextId++;
    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOn",  note, velocity: 100, channel: 0, time, id },
    });
    this.port.postMessage({
      type:  "midiOut",
      event: { kind: "noteOff", note, channel: 0, time: time + this._gate * 0.25, id },
    });
    this._stepIdx = (this._stepIdx + 1) % this._steps.length;
  }

  process() { return true; }
}

registerProcessor("com.example.step-seq", StepSeqProcessor);
```

The host listens on your processor's port for `midiOut` messages,
looks up your plugin's first `midi-out` endpoint, and dispatches
`event` through the MIDI bus. `hops` is managed by the bus; don't
touch it in your worklet.

### `id` allocation

Maintain a monotonic counter inside your processor (as shown
above). The host uses `id` to match `noteOff` to `noteOn` for
downstream tracking. If your plugin emits a `noteOff` without
reusing the original `id`, the receiver falls back to (note,
channel) matching — fine for simple cases, breaks under chained
transformation.

### Routing to a specific output port

If your plugin declares multiple MIDI outputs, specify `portId`
on the message:

```js
this.port.postMessage({
  type: "midiOut",
  portId: "arp-out",
  event: { /* … */ },
});
```

Omitting `portId` targets the first `midi-out` in the resolved
port set.

---

## Hand-built voice engines (without a worklet)

Not every control-source plugin needs a worklet. Simple pattern
generators can run entirely on the main thread inside a hand-
built `createVoiceEngine`:

```ts
createVoiceEngine(ctx, outputNode, opts) {
  const bus = opts?.midiBus;
  if (!bus) return silentEngine(ctx); // offline render path

  const midiOut = bus.createEndpoint("midi-out", "out");
  const portSet = {
    inputs: [],
    outputs: [{
      id: "midi-out", label: "MIDI OUT", kind: "midi",
      direction: "out", midi: midiOut, origin: "manifest",
    }],
  };

  const silent = ctx.createGain();
  return {
    noteOn:  (note, velocity, time) => {
      // Convert tracker trigger into MIDI output.
      const id = bus.nextId();
      midiOut.send({ kind: "noteOn", note, velocity, channel: 0, time, id });
      // Schedule the release separately; noteOff below handles it if
      // the tracker sends one, but for a fire-and-forget trigger you
      // can schedule via setTimeout too.
    },
    noteOff: (note, time) => {
      // You need to remember the id; a real plugin would track
      // (note → last id) in a map.
    },
    allNotesOff: () => { /* … */ },
    update: () => { /* … */ },
    output: silent,
    destroy: () => {
      try { bus.disconnectEndpoint(midiOut); } catch {}
      try { silent.disconnect(); } catch {}
    },
    inputs:  [],
    outputs: [silent],
    ports:   portSet,
  };
}
```

This is the same pattern the host's built-in `Clock Source`
pseudo-plugin uses. It's fine for single-plugin use cases; scale
issues only appear when you need sub-millisecond scheduling
precision, at which point a worklet is the better tool.

---

## Instrument-slot integration

Control-source plugins appear in the tracker's instrument picker
the same way instruments do. Users assign a control-source plugin
to a tracker instrument slot; tracker rows referencing that slot
trigger the plugin's `noteOn` / `noteOff`.

The workspace UI labels control-source slots distinctly so users
can tell at a glance that the slot produces MIDI rather than
audio. Your plugin's `manifest.description` is what shows up in
the picker subtitle — use it to clarify what the plugin emits.

---

## Non-breaking notes

- `manifest.type === "control-source"` is an additive value.
  Hosts that predate the feature simply fail to load the plugin
  with `"manifest.type must be 'instrument' or 'fx'"` — no silent
  mis-behaviour.
- `requires: ["portsV4"]` is still required if you want to declare
  an explicit `ports` block with inputs/outputs. The implicit
  `midi-out` injection itself doesn't need a capability flag.
- `.ftrk` project files load control-source plugins the same way
  they load instrument plugins — workspace id allocation, cable
  persistence, window state — the only thing that differs at the
  host level is the no-audio-output path inside the voice-engine
  factory.

---

## Design patterns

### Step sequencer

- Worklet processor consumes `songPosition` messages, advances
  step on every Nth PPQN tick, emits `noteOn` / `noteOff`.
- Parameters: `bpm_divisor`, `gate_length`, `step_count`.
- UI: native checkbox grid for active steps + knobs per step for
  note / velocity.

### Virtual keyboard

- Webview UI maps computer-keyboard keys to notes, emits
  `noteOn` / `noteOff` via a webview→host write channel plus the
  worklet's `midiOut` path.
- Alternatively, hand-built engine that posts from the webview
  bridge directly.

### Drum machine

- Similar to step sequencer but with channel-routed notes
  (`channel: 9` for GM drums) and a pattern-per-lane grid.

### Arpeggiator (`manifest.type === "instrument"`, not control-source)

- Declares `requires: ["midi-thru-custom"]`.
- Subscribes to its own `midi-in` via the engine port;
  transforms the note stream and emits on `midi-thru`.
- Sits in a chain: `external-kb → arp → audio-instrument`.
- See [`22-midi-ports.md#custom-thru-midi-thru-custom`](22-midi-ports.md#custom-thru-midi-thru-custom).

### LFO-to-CC

- Worklet posts `cc` events at a fixed PPQN division.
- Parameters: `lfo_shape`, `lfo_rate`, `lfo_depth`, `cc_number`.

### Chord trigger

- Single `noteOn` in → multiple `noteOn` out with `parentId`
  threaded through.
- Reference implementation of `parentId` threading — see
  [`22-midi-ports.md#id-and-parentid--logical-note-tracking`](22-midi-ports.md#id-and-parentid--logical-note-tracking).

---

## See also

- [`22-midi-ports.md`](22-midi-ports.md) — MIDI cable layer reference
- [`09-webview.md`](09-webview.md) — webview UI patterns
- [`08-worklet-v3.md`](08-worklet-v3.md) — worklet contract
- [`reference/host-capabilities.md`](reference/host-capabilities.md)
  — `midi-thru-custom` and `consumes-song-position` flags
