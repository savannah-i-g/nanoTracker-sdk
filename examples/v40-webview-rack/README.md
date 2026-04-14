# v40-webview-rack

A minimal v4.1 pedal demonstrating **webview-exposable ports**: three
LFO sub-modules inside a single plugin window, each with its own pair
of workspace jacks (a CV output and a CV input for modulating the
LFO's rate) that the **webview iframe decides to show or hide** at
runtime via `subPortsUpdate`.

## What to try

1. Pack and load the plugin:

   ```bash
   node tools/ntvalidate.mjs examples/v40-webview-rack
   node tools/ntpack.mjs     examples/v40-webview-rack --out v40-webview-rack.ntsfx
   ```

   Then in nanoTracker: `PLUGIN MANAGER` → `+ LOAD PLUGIN` → pick the
   archive → `+ ADD TO WS`.

2. Open the plugin window. Inside the webview, each LFO has two buttons:
   `CV OUT` and `RATE IN`. Click them to toggle the matching jacks on
   the plugin's workspace window.

3. Cable a revealed `CV OUT` to another plugin's audio-rate
   parameter input (e.g. the cutoff-CV input on `v40-compressor-sc`'s
   sidechain, or a filter pedal's cutoff).

4. Cable something into `RATE IN` to modulate the LFO's own rate from
   another source.

5. Save the project with cables connected, then reload. The cables
   come back even though the iframe hasn't booted yet — the host uses
   the stable `portId` field on each `CableEndpoint` to re-resolve
   endpoints the moment the webview re-announces the visible set.

## How the manifest declares it

```jsonc
{
  "requires": ["pedal-v4", "portsV4", "graph", "webview-ui", "webview-writes", "webview-ports"],
  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }],
    "webviewExposable": [
      { "id": "lfo1.out",  "kind": "cv", "direction": "out", "source": "lfo1" },
      { "id": "lfo1.rate", "kind": "cv", "direction": "in",  "target": "lfo1.frequency" },
      /* ...repeat for lfo2, lfo3 */
    ]
  }
}
```

Every id the iframe can reference must appear in
`ports.webviewExposable[]`. The loader validates `source` / `target`
against the DSP graph, so typos are caught before the plugin ships.

## How the iframe toggles visibility

```js
function sendVisible() {
  window.parent.postMessage({
    type: "subPortsUpdate",
    visible: [...visible].map(id => ({ id })),
  }, "*");
}
```

The payload is a **complete** declarative replacement — not a diff. The
host validates every id against the manifest whitelist, throttles
reconciliation to one batch per animation frame, and drops unknown ids
with an `__nt_error` reply into the iframe.

## Boundary conditions

- **The webview can never invent audio endpoints.** Every jack id must
  live in `ports.webviewExposable[]`. If a future version wants a new
  LFO, bump the plugin version and redeclare the ports.
- **Hidden ports reject live cable drops.** Users can't drag a cable
  onto a jack that isn't currently visible.
- **Existing cables survive a hide.** A cable whose endpoint goes
  hidden stays in the graph — it re-appears (audibly and visually)
  the moment the port comes back.
- **Don't reuse `port:<id>` in node ids.** The graph builder reserves
  that prefix as a shared-scope endpoint marker.

## Reference

- [`docs/15-webview-ports.md`](../../docs/15-webview-ports.md) —
  full protocol reference.
- [`docs/14-ports.md`](../../docs/14-ports.md) — port kinds + the
  compatibility matrix cables are validated against.
- [`docs/09-webview.md`](../../docs/09-webview.md) — bidirectional
  bridge that carries `subPortsAvailable` + `subPortsUpdate`.
