# v3 AudioWorklet Instrument Contract

> This page is the **normative protocol reference** for the v3
> AudioWorklet instrument contract. Read it alongside
> [`../08-worklet-v3.md`](../08-worklet-v3.md), which is the narrative
> introduction with worked examples. If behaviour differs from what
> this page describes, that's a spec bug — please file an issue.

---

> **Status:** fully implemented in the v3 plugin host.
>
> Both forms below ship and are dispatched automatically at plugin
> load time:
>
>   1. **Graph-node form** (`type: "worklet"` inside `dsp.graph.nodes`)
>      — instantiated by the declarative graph engine. Reserved
>      AudioParam names (`pitch`/`gate`/`velocity`/`gain`) are
>      auto-wired from the per-voice control sources and the
>      engine-level shared gain bus.
>
>   2. **Whole-instrument form** (`dsp.worklet` block) — the host
>      wraps the processor in an AudioWorkletNode and posts the
>      normative MessagePort protocol described below: `init` with
>      bundled assets transferred via `Float32Array` ArrayBuffers,
>      voiceId-allocated noteOn/noteOff, time-stamped setPitch /
>      setGain / param, and a processor → host listener for `error`
>      messages.
>
> The legacy v1/v2 worklet path is preserved for plugins that use
> the old `dsp.processorName` field with no `dsp.worklet` block —
> those plugins continue to work unchanged.
>
> The loader validates parameterDescriptor → parameters[] mirroring
> as a soft warning (§3) and registers `script.js` from any of the
> three declaration sites.

This document is the **normative** spec for AudioWorklet processors that
ship inside a v3 nanoTracker instrument plugin. It is written to be the
single source of truth for processor authors and host implementers; if
the host code disagrees with this document, the document is correct and
the host has a bug.

---

## 1. Where the worklet lives

A v3 instrument worklet is one of two things:

1. **A graph node** of `type: "worklet"` inside `dsp.graph.nodes`. This is
   the preferred form. The processor is just another node in the modular
   graph and can be combined with declarative oscillators, filters,
   envelopes, sample sources, etc. The host wires its inputs and outputs
   via standard `dsp.graph.connections`.

2. **A whole-instrument processor** declared via `dsp.worklet` (the
   `PluginWorkletInstrumentDef` block). This form replaces the per-voice
   graph entirely — the processor is the instrument. The host wraps it
   in an `AudioWorkletNode`, connects it to the channel output, and
   forwards every note event over the MessagePort.

Both forms reference a `script.js` file at the archive root. The script
is loaded exclusively via `AudioWorklet.addModule()` from a `blob:` URL
(or `data:` URL if CSP blocks `blob:`). It never runs as general JS.

---

## 2. Required AudioParams (recommended set)

If the worklet declares any of the following `AudioParam`s in
`parameterDescriptors`, the host **MUST** auto-wire them to the
corresponding per-voice control signals:

| Name        | Rate    | Range              | Source                                                |
|-------------|---------|--------------------|-------------------------------------------------------|
| `pitch`     | a-rate  | 0..20000 (Hz)      | per-voice `pitch` ConstantSource (note frequency)     |
| `gate`      | a-rate  | 0..1               | per-voice `gate` ConstantSource (1 on noteOn, 0 off)  |
| `velocity`  | k-rate  | 0..1               | per-voice `velocity` ConstantSource (vel/127)         |
| `gain`      | a-rate  | 0..1               | per-voice `gain` ConstantSource (host volume slides)  |

A worklet that declares all four can implement a complete monophonic
voice without ever touching the MessagePort — note events are conveyed
purely as control-rate AudioParam changes.

Worklets that need polyphonic state, multi-output behavior, or
unconventional control flow may declare additional `parameterDescriptors`
(with any name) and process them however they like.

---

## 3. Parameter mirroring

For every named entry in `parameterDescriptors`, if the plugin author
also wants the host UI to expose that parameter as a knob/slider, they
**MUST** add a matching entry to the top-level `parameters[]` array
using the dot-path key `<nodeId>.<paramName>`.

Example: a worklet node with id `synth` that declares
`parameterDescriptors: [{ name: "drive", ... }]` requires a parameter
entry like:

```json
{ "key": "synth.drive", "label": "DRIVE", "min": 0, "max": 1, "default": 0.5, "step": 0.01 }
```

The host does not enforce this mirror at load time — it is convention.
`ntvalidate` warns if a `parameterDescriptor` key has no corresponding
entry in `parameters[]` and is not documented as host-internal.

---

## 4. Asset transfer

A v3 worklet **MUST NOT** fetch its own samples or impulse responses.
The host owns asset loading, decodes audio data via Web Audio's
`decodeAudioData`, and ships per-channel `Float32Array` views to the
processor over the MessagePort using transferable objects.

Asset paths are declared in `dsp.worklet.assets[]` (whole-instrument form)
or in node-local fields TBD for the graph-node form.

The host sends:

```js
worklet.port.postMessage(
  {
    type: "loadAsset",
    id: "samples/kick.wav",
    channels: [Float32Array, Float32Array],   // per-channel data
    sampleRate: 44100,
  },
  [channels[0].buffer, channels[1].buffer],   // transferable
);
```

The processor **MUST** keep its own reference to the buffers; once they
are transferred the host no longer owns them. The processor **SHOULD**
respond with `{ type: "ready", id: "samples/kick.wav" }` once each asset
has been processed, so the host can defer voice instantiation until the
processor is fully primed.

---

## 5. MessagePort protocol — host → processor

All messages are JSON-serialisable. `time` values are AudioContext time
in seconds (the value the host would pass to `AudioParam.setValueAtTime`).

| Type            | Fields                                           | Semantics                                                |
|-----------------|--------------------------------------------------|----------------------------------------------------------|
| `init`          | `assets, initMessage, sampleRate`                | Sent immediately after `addModule` resolves              |
| `loadAsset`     | `id, channels, sampleRate`                       | Stream a decoded sample to the processor (transferable)  |
| `noteOn`        | `voiceId, note, velocity, frequency, time`       | Trigger a voice                                          |
| `noteOff`       | `voiceId, note, time`                            | Begin release                                            |
| `allNotesOff`   | `time`                                           | Silence everything immediately                           |
| `setPitch`      | `voiceId, frequencyHz, time`                     | Mid-note pitch change (portamento, vibrato, arpeggio)    |
| `setGain`       | `voiceId, gain, time`                            | Mid-note gain change (volume slides)                     |
| `param`         | `key, value, time`                               | Live parameter update (mirrors host UI)                  |
| `dispose`       | (none)                                           | Tear down all internal state; the node will be removed   |

`voiceId` is host-assigned and unique across the lifetime of an engine
instance. Polyphonic processors **SHOULD** key their internal voice
state by `voiceId`. Monophonic processors **MAY** ignore it.

Where a `time` field is present, the processor **MUST** apply the change
at that AudioContext time, not at message-receive time. This is how
sample-accurate scheduling survives the main-thread → audio-thread hop.

---

## 6. MessagePort protocol — processor → host (optional)

| Type            | Fields                          | Semantics                                              |
|-----------------|---------------------------------|--------------------------------------------------------|
| `ready`         | `id?` (asset id, optional)      | Processor finished init, or finished loading an asset  |
| `voiceEnded`    | `voiceId`                       | Processor reclaimed a voice; host may release tracking |
| `meter`         | `level, peak`                   | Periodic level meter for UI display                    |
| `error`         | `message, voiceId?`             | Recoverable processor-side error; logged by host       |
| `__nt_error`    | `where, message` *(v3.5)*       | Processor-side exception report; see §6a               |

The host **MUST** ignore unknown message types (forward compatibility).

### 6a. Surfacing `port.onmessage` exceptions (v3.5)

Web Audio disconnects an `AudioWorkletNode` silently if its
`process()` throws or its `port.onmessage` handler throws — there is
no console output, no host-visible signal, and the plugin's instrument
simply stops producing audio while the rest of the tracker keeps
running. To diagnose this failure class in the field, v3.5 hosts
listen for a `__nt_error` message type on the worklet-to-host channel
and surface it through both `console.error` and a `fi-worklet-error`
DOM event.

Plugin authors writing their own processors should wrap their
`port.onmessage` body in a `try` / `catch` and post the caught error
back to the host:

```js
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      try {
        // your existing message handling — loadAsset, noteOn, etc.
        this._handle(event.data);
      } catch (err) {
        // Surface the exception to the host instead of letting it
        // disappear. `where` is a short label that identifies this
        // site in your processor; `message` is the error text.
        try {
          this.port.postMessage({
            type: "__nt_error",
            where: "my-plugin.port.onmessage",
            message: (err && err.message) ? String(err.message) : String(err),
          });
        } catch { /* port dead — nothing to do */ }
      }
    };
  }
}
```

The host's `onprocessorerror` wiring already catches hard crashes (an
unhandled throw inside `process()`, a return-false from `process()`);
the `__nt_error` convention covers the *soft* case where your message
handler fails but the processor itself is still alive and could
continue if only the host knew something was wrong.

**Fields**

| Field      | Type   | Purpose |
|------------|--------|---------|
| `type`     | string | Must be `"__nt_error"`. |
| `where`    | string | Short label identifying the site — `"my-plugin.port.onmessage"`, `"my-plugin.loadAsset"`, etc. Shown to the user / developer in the host's error log. |
| `message`  | string | Human-readable error description. Usually `err.message`. |

This convention is **optional but recommended**. Processors that omit
it still work exactly as before; hosts that don't recognise it
(pre-v3.5) simply ignore the message per the forward-compatibility
rule above.

---

## 7. Lifetime and cleanup

The host calls `port.postMessage({ type: "dispose" })` exactly once when
the plugin instance is being torn down. The processor **MUST** stop all
internal scheduling, release any held buffers, and prepare to be garbage
collected. The host then disconnects the `AudioWorkletNode` from the
graph; no further messages will arrive.

Processors **SHOULD** return `true` from `process()` until they receive
`dispose`. Returning `false` causes the AudioWorkletNode to be released
even if the host still holds a reference, which produces hard-to-debug
silent voices.

---

## 8. Multi-output worklets

A worklet may declare `numberOfOutputs > 1` in its constructor. The host
reads `dsp.worklet.outputChannelCount[]` to size each output port. In the
graph-node form, individual output ports can be referenced from a
connection via `outputIndex`:

```json
{ "from": "synth", "to": "voiceOut", "outputIndex": 0 }
{ "from": "synth", "to": "fxBus",    "outputIndex": 1 }
```

This is how a worklet can expose, for example, a dry signal and a
sidechain key signal as two separate output ports for the host's modular
graph to consume.

---

## 9. Forward-compatibility envelope

Future spec versions may add new message types and new
`parameterDescriptor` conventions. Processors **MUST** ignore unknown
message types. The host **MUST** ignore unknown processor-emitted
message types. Both sides **MUST NOT** rely on undocumented field names
appearing or disappearing — anything not in this document is unstable.

When a future spec version requires processor opt-in (e.g. a new asset
format), the plugin **MUST** declare the corresponding capability in
`requires[]` so the host can refuse to load if it does not yet support
the feature. Silent degradation is intentionally not supported.
