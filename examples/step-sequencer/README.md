# STEP SEQ 16

A 16-step single-lane MIDI step sequencer demonstrating the
`control-source` plugin type.

## What it shows

- `manifest.type: "control-source"` — a plugin whose primary output
  is MIDI events rather than audio.
- Explicit `ports.outputs` with a `midi`-kind port (skips the
  implicit injection and names the port directly).
- `consumes-song-position` — the worklet processor receives
  `songPosition` messages and paces steps on 16th-note boundaries
  (every 6 PPQN ticks at PPQN-24).
- `midiOut` message contract — the processor posts `noteOn` /
  `noteOff` events back through the port with monotonic `id`s; the
  host dispatches them through the MIDI bus.
- 16 toggle parameters (`step_01`…`step_16`) for the step grid plus
  `gate_length` and `root_note` knobs.

## Cabling

```
STEP SEQ 16  MIDI OUT ──► INSTRUMENT  MIDI IN
```

1. Add STEP SEQ 16 to the workspace from the plugin manager.
2. Add or select an instrument plugin that has a `midi-in` jack
   (all instrument plugins get one implicitly).
3. Drag a cable from **STEP SEQ 16 → MIDI OUT** to the
   **instrument → MIDI IN**.
4. Hit play — the sequencer drives the instrument on every active
   step.

To drive external gear, cable MIDI OUT to the **EXT MIDI OUT**
workspace pseudo-plugin instead.

## Notes for authors

The `script.js` worklet uses a simplified gate-duration formula
(fixed 0.25 s per 16th note). For tempo-accurate gate length, read
`msg.position.bpm` from the `songPosition` payload and compute
`(60 / bpm) * 0.25 * gateLength` instead.

A real sequencer might expose per-step note parameters (or a
webview UI for a full-width grid), multiple lanes with per-lane MIDI
channels, or a `midi-in` port to clock from an external source. The
`docs/23-control-source-plugins.md` design-patterns section covers
those variations.
