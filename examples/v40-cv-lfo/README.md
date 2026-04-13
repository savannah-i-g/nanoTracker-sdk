# CV LFO — v4.0 utility pedal with CV output

A free-running LFO pedal with a `kind: "cv"` output jack. Patch the
CV jack into any other plugin's CV input (e.g. a filter cutoff or a
compressor threshold) to modulate that parameter at audio rate.

## What this demonstrates

- **CV output port** — outputs an audio-rate signal intended for an
  AudioParam destination, not a speaker. Visually distinct (accent
  hue) from audio outputs.
- **Mixed-kind output list** — the pedal exposes both an `audio` OUT
  (optional passthru from IN, so you can route the LFO's modulation
  target through the pedal in one cable run) and a `cv` OUT.

## Wiring example

- `SYNTH.OUT` → `CV LFO.IN` → `CV LFO.OUT` → `MASTER IN.MAIN`
  (passes signal through unchanged)
- `CV LFO.CV` → `FILTER.cvCutoff`
  (modulates another plugin's cutoff AudioParam)

## Build + install

```bash
ntvalidate .
ntpack . --out ../cv-lfo.ntsfx
```

Drop the resulting `.ntsfx` into PLUGIN MANAGER → `+ LOAD PLUGIN`,
then `+ ADD TO WS`. To exercise the CV output you'll also need a
plugin with a CV input port — see [`docs/14-ports.md`](../../docs/14-ports.md)
for the unified port model.
