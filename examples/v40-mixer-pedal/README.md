# 4CH MIXER — v4.0 pedal with webview faders

A four-channel stereo mixer pedal with per-channel gain + pan,
controlled from an interactive webview fader strip.

## What this demonstrates

- **v4 manifest shape** — `schemaVersion: 4`, `type: "fx"`, required
  `pedal-v4` + `portsV4` capabilities
- **Multi-input ports** — four labelled audio inputs (`1`/`2`/`3`/`4`)
  on the left edge of the pedal window
- **Multi-output ports** — stereo `L`/`R` on the right edge
- **Declarative graph** — per-channel `gain → panner → mixer`
  summing into both outputs; uses `port:<id>` references throughout
- **Webview write channel** — iframe fader drags post
  `{type:"paramWrite", key, value}` messages; host validates + applies
  with `setTargetAtTime(0.02s)` smoothing
- **Theme override** — custom orange/black palette cascades to the
  window chrome and is re-posted to the iframe as `themeChange`
  events

## Wiring

Drag cables from `TrackerBus.CH01` → `4CH MIXER.1`,
`TrackerBus.CH02` → `4CH MIXER.2`, etc. Then wire `4CH MIXER.L` and
`4CH MIXER.R` to `MASTER IN.MAIN`. Every channel you route is now
mixable from the webview faders.

## Build + install

```bash
ntvalidate .
ntpack . ../4ch-mixer.ntins
```

Drop the resulting `.ntins` into the tracker's plugin loader.
