# COMP SC — v4.0 pedal with sidechain input

A compressor pedal with a dedicated sidechain (`kind: "sidechain"`)
input. The sidechain signal routes to the compressor's threshold
AudioParam — wire a kick drum tracker channel to `SC` to get classic
ducking of a sustained pad patched through `IN`.

## What this demonstrates

- **Typed sidechain port** — visually distinct (dashed ring) from
  the main audio input, so users can tell routing intent at a
  glance. Electrically identical to an `audio` port; the host
  enforces nothing about what signal users wire in.
- **`toParam` connection** — the sidechain input modulates the
  compressor's `threshold` AudioParam directly, no extra envelope
  follower or detector needed.

## Wiring example

- `TRACKER BUS.CH01` → `COMP SC.IN`    (your pad / sustained signal)
- `TRACKER BUS.CH02` → `COMP SC.SC`    (your kick drum)
- `COMP SC.OUT` → `MASTER IN.MAIN`

The SC jack renders with a dashed ring so it's visually distinct
from a regular audio input. Cables wired into it carry the same
audio signal as a regular IN — the distinction is intent, not
electrical behaviour.

## Build + install

```bash
ntvalidate .
ntpack . --out ../comp-sc.ntsfx
```

Drop the resulting `.ntsfx` into PLUGIN MANAGER → `+ LOAD PLUGIN`,
then `+ ADD TO WS`.
