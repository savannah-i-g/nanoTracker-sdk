# Webview audio route-back (v3.5)

Set `acceptsAudioFrames: true` on a `webview` control and your iframe
can post PCM audio upstream. The host routes those frames through the
instrument's output bus — so channel volume, pan, and workspace FX
apply the same way they do to any other plugin.

Nothing about note / param / effect bridging changes. This is purely
an extra message type on top of the existing postMessage bridge.

---

## Manifest

```json
{
  "schemaVersion": 3,
  "requires": ["webview-ui"],
  "manifest": { "type": "instrument", "name": "My Webview Synth", "version": "1.0.0" },
  "ui": {
    "layout": "flex",
    "controls": [
      {
        "type": "webview",
        "source": "web/index.html",
        "acceptsAudioFrames": true,
        "width": 320,
        "height": 240
      }
    ]
  }
}
```

No separate capability flag — `acceptsAudioFrames` piggybacks on
`webview-ui`. Plugins built for pre-v3.5 hosts that set the flag are
unaffected; the flag is simply ignored.

---

## Host → iframe: the audio-init message

Shortly after the ready handshake, the host posts:

```js
{ type: "__nt_audioInit", sampleRate: 48000 }
```

`sampleRate` is the host's `AudioContext.sampleRate` — almost always
`48000`, but `44100`/`88200`/`96000` are possible on some user setups.
Your iframe must render audio at that rate; the host does **not**
resample.

If you need to pick a sampleRate before the init message arrives (for
example, to construct your own AudioContext), default to `48000` and
reconfigure on `__nt_audioInit` if it turns out to be different.

---

## Iframe → host: the audio frames message

```js
parent.postMessage({
  type: "__nt_audio",
  left:  float32Array,       // mono, or L channel
  right: float32ArrayOrUndef, // optional — omit for mono
}, "*");
```

**Ownership:** the host consumes the typed arrays by reference — do
not mutate them after posting. The cleanest pattern is to allocate
per-quantum and let the GC collect them; at 48 kHz and 1024-sample
chunks that's ~47 allocations per second, which is fine.

**Chunk size:** 128, 256, 512, or 1024 samples per chunk is reasonable.
Smaller chunks reduce latency but increase postMessage overhead;
larger chunks are cheap but add latency. The host's ring buffer holds
roughly 1 second per channel — if you feed faster than that, older
samples are dropped with a rate-limited console warning.

**Timing:** the host runs the sink as an AudioWorklet with an internal
ring buffer. Underrun (you stop posting for a moment) produces
silence, not a glitch; overrun (you post too fast) drops the oldest
samples. Aim to keep ~50–200 ms of audio queued on average.

---

## Minimal worked example — 440 Hz sine

```html
<!doctype html>
<html>
<body>
<script>
// Tell the host we're alive so it flushes any queued events and posts
// us the audio-init message.
parent.postMessage({ type: "__nt_ready" }, "*");

let sampleRate = 48000;
let ctx = null;
let phase = 0;
const FREQ = 440;
const CHUNK = 512;

window.addEventListener("message", (e) => {
  const ev = e.data;
  if (!ev || typeof ev !== "object") return;

  if (ev.type === "__nt_audioInit") {
    sampleRate = ev.sampleRate;
    // Local AudioContext just to drive setInterval timing — no
    // audible output from this context. (Using performance.now()
    // would work too.)
    ctx = new AudioContext({ sampleRate });
    // Post a chunk every CHUNK/sampleRate seconds. 512/48000 ≈ 10.7 ms.
    const intervalMs = (CHUNK / sampleRate) * 1000;
    setInterval(tick, intervalMs);
  }
});

function tick() {
  const buf = new Float32Array(CHUNK);
  const step = (2 * Math.PI * FREQ) / sampleRate;
  for (let i = 0; i < CHUNK; i++) {
    buf[i] = 0.2 * Math.sin(phase);
    phase += step;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
  }
  // Mono — omit `right` and the host replicates L to both outputs.
  parent.postMessage({ type: "__nt_audio", left: buf }, "*");
}
</script>
</body>
</html>
```

Pack it with `ntpack`, load the resulting `.ntins`, play a note on
the instrument's channel — you hear 440 Hz. Turning the InstrumentWindow
volume knob attenuates it; pulling the output jack through a delay
module delays it. The sine is just another audio source on the
workspace graph.

Note: this example produces a constant tone regardless of note
messages. A real synth would listen for `noteOn` / `noteOff` events on
the bridge and shape its oscillator(s) accordingly — the audio
route-back is orthogonal to the event bus, not a replacement for it.

---

## Known limitations

- **No host-side resampling.** Post frames at the host's sample rate
  or get pitched output.
- **Single-file HTML constraint still applies.** If you need an
  external JS library, inline it at bundle time (see
  `09-webview.md` for techniques).
- **No SharedArrayBuffer ring.** Cross-origin isolation isn't
  enforced on the tracker, so transferring typed arrays via
  `postMessage` is the only portable path. A SharedArrayBuffer
  upgrade may land in a future version when COOP/COEP headers are
  deployable.
- **Latency.** The ring buffer introduces 10–100 ms of delay relative
  to the iframe's own clock, depending on how fast the iframe feeds.
  If you need sample-accurate sync with tracker playback, pre-render
  offline rather than relying on route-back.
- **Mono vs stereo.** The first `__nt_audio` message with a `right`
  channel flips the sink into stereo mode for the rest of its life
  — don't send mono-then-stereo-then-mono and expect clean folding.
  Pick one at init and stick with it.

---

## See also

- [`09-webview.md`](09-webview.md) — webview control reference
- [`reference/event-bus.md`](reference/event-bus.md) — bridge event types
- [`reference/host-capabilities.md`](reference/host-capabilities.md) — capability-flag catalogue
