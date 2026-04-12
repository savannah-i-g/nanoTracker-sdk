# V35 Showcase — every v3.5 feature in one plugin

A single instrument plugin that exercises every v3.5 feature the host
gained in this release, so you can hear / see / poke at each in one
place without jumping between four different example archives.

## What each file contributes

| File | v3.5 features it demonstrates |
|---|---|
| `plugin.json` → `ui.themeOverride` | Scoped CSS custom properties on the InstrumentWindow — deep purple chrome, text, highlights. |
| `plugin.json` → `dsp.graph` granular `playbackMode: "pingpong"` | Per-grain random-direction playback. |
| `plugin.json` → `dsp.graph` LFO `lfoSync: true, lfoSyncRate: "1/4"` | BPM-synced LFO modulating grain position. |
| `web/panel.html` + `forwardEffects: true` | Live log of MOD effect bytes received from the tracker. |
| `web/panel.html` + `acceptsAudioFrames: true` | PCM click rendered in the iframe, posted via `__nt_audio`, mixed into this instrument's output bus. |
| `web/panel.html` themeChange handler | Iframe re-paints on global theme switches while the plugin's `themeOverride` stays pinned. |

The `samples/texture.wav` is a 2-second evolving pad that gives the
granular engine something to chew through; shipped pre-rendered so the
example is drop-in.

## Capability flags declared

```json
"requires": ["graph", "granular", "webview-ui", "themeOverride"]
```

- `graph` — the per-voice declarative graph engine
- `granular` — the host-shipped granular AudioWorklet
- `webview-ui` — the sandboxed iframe UI control
- `themeOverride` — the v3.5 scoped theme-colour field

## What to listen for and how to test

1. **Build + load.** From the repo root:

   ```bash
   node plugin-sdk/tools/ntpack.mjs plugin-sdk/examples/v35-showcase
   ```

   Load the resulting `V35_Showcase.ntins` (or similar — the packer
   names it from `manifest.name`) into nanoTracker.

2. **Theme override.** Open the instrument window — chrome, knobs,
   and the webview panel are all purple regardless of your global
   theme. Switch themes in the tracker's Display tab: the
   purple-overridden keys stay; non-overridden edges like scanline
   tint follow the new theme.

3. **BPM-synced LFO.** Hold a note. The grain position slowly
   modulates at quarter-note rate. Change project BPM in the menu —
   the modulation rate tracks tempo within one quantum.

4. **Granular pingpong.** Open `plugin.json` and try changing
   `"playbackMode"` to `"forward"` / `"reverse"` / `"freeze"` then
   re-pack. You'll hear:

   - `forward` — monodirectional scan (default v3.2 behaviour)
   - `reverse` — backwards
   - `pingpong` — per-grain 50/50 direction, produces a chorus-like
     texture
   - `freeze` — `scanRate` is ignored; grains park at `position` and
     only jitter modulates

5. **forwardEffects.** Place a `4xy` (vibrato) or `7xy` (tremolo)
   effect on a channel bound to this instrument. The "TRACKER
   EFFECTS" pane shows the hex bytes and a plain-English label
   scrolling up on each row.

6. **acceptsAudioFrames.** On every `noteOn`, the webview synthesises
   a short 2.4 kHz click and posts it upstream. You hear it alongside
   the granular source. The LED next to "TRACKER EFFECTS" pulses
   whenever the click fires. Pull the instrument's VOL knob down —
   the click attenuates with the granular audio, proving it's routed
   through the same bus.

7. **themeChange.** Switch the global theme while the plugin is open.
   The right-pane "NOTE ACTIVITY" scope and the left pane's accents
   re-skin via the cascade, demonstrating that the webview's CSS
   variables update live.

## Known quirks

- The first `__nt_audio` click after a fresh load may have an extra
  few ms of latency while the sink's ring buffer primes — negligible
  and one-shot.
- Dotted / triplet sync rates (`"1/4."`, `"1/8T"`) work at the
  graph-node level but aren't wired into this example's LFO — change
  `lfoSyncRate` in `plugin.json` if you want to hear them.
- `playbackMode` is fixed at node-construction time (it rides on
  `processorOptions`). There's no runtime parameter to toggle it
  without rebuilding the graph.

## See also

- [`plugin-sdk/docs/06-instrument-graphs.md`](../../docs/06-instrument-graphs.md) — granular + wavetable + LFO sync
- [`plugin-sdk/docs/09-webview.md`](../../docs/09-webview.md) — webview control reference
- [`plugin-sdk/docs/12-webview-audio.md`](../../docs/12-webview-audio.md) — `acceptsAudioFrames` protocol
- [`plugin-sdk/docs/03-ui-controls.md`](../../docs/03-ui-controls.md) — `ui.themeOverride`
- [`plugin-sdk/docs/reference/event-bus.md`](../../docs/reference/event-bus.md) — `trackerEffect` + `themeChange`
