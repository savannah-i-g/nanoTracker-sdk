# Webview patch-cable ports

If your plugin's webview UI hosts multiple internal sub-modules that
each want their own cable endpoint on the workspace (think: a mini-rack
of three LFO modules inside one plugin window, each with its own CV-out
jack), declare them as **webview-exposable ports** and let the iframe
toggle their visibility at runtime.

The port set is still **manifest-declared** — the webview can only show
or hide ports that the author wrote into `plugin.json`. The host keeps
every AudioNode / AudioParam reference static at load time; the iframe
never invents audio endpoints.

## Capability + manifest

```jsonc
{
  "schemaVersion": 4,
  "requires": ["pedal-v4", "portsV4", "graph", "webview-ui", "webview-ports"],

  "ports": {
    "inputs":  [{ "id": "in",  "label": "IN",  "kind": "audio" }],
    "outputs": [{ "id": "out", "label": "OUT", "kind": "audio" }],

    "webviewExposable": [
      {
        "id":         "mod.lfo1.out",
        "label":      "LFO1",
        "kind":       "cv",
        "direction":  "out",
        "source":     "lfo1",           // node id inside dsp.nodes[]
        "defaultVisible": false
      },
      {
        "id":         "mod.lfo1.rate",
        "label":      "LFO1 RATE",
        "kind":       "cv",
        "direction":  "in",
        "target":     "lfo1.frequency", // <nodeId>.<paramName>
        "defaultVisible": false
      }
    ]
  }
}
```

Field reference (same as regular ports plus two extras):

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Stable id the iframe addresses. `port:<id>` is reserved by the host graph builder — do not reuse node ids. |
| `label` | yes | Default jack label. Iframe may override per-placement. |
| `kind` | yes | `"audio" \| "sidechain" \| "cv" \| "gate"` — same union as manifest ports. |
| `direction` | yes | `"in"` or `"out"`. Required for webview-exposable entries; regular `inputs[]` / `outputs[]` entries infer direction from their bucket. |
| `target` | CV input | `<nodeId>.<paramName>` AudioParam path. Validated at load. |
| `source` | CV/gate/audio output | Node id whose output drives the jack. Same graph scope as `connections[]` references. |
| `defaultVisible` | no | `true` surfaces the jack before the iframe boots. Default `false` (jack hidden until the iframe announces it). |

## Protocol

### Host → iframe (on `__nt_ready`)

```js
{
  type: "subPortsAvailable",
  ports: [
    { id: "mod.lfo1.out",  label: "LFO1",      kind: "cv", direction: "out", defaultVisible: false },
    { id: "mod.lfo1.rate", label: "LFO1 RATE", kind: "cv", direction: "in",  defaultVisible: false }
  ]
}
```

The iframe receives this once per mount. Store it; don't expect another
`subPortsAvailable` without a reload.

### Iframe → host (any time after ready)

Declarative replace — post the **complete** visible set, not a diff:

```js
window.parent.postMessage({
  type: "subPortsUpdate",
  visible: [
    { id: "mod.lfo1.out" },
    { id: "mod.lfo1.rate", label: "RATE" }   // optional per-placement label
  ]
}, "*");
```

- Every id must be in the `subPortsAvailable` whitelist. Unknown ids
  trigger an `__nt_error` reply and are dropped.
- Ports omitted from `visible` become hidden.
- The host throttles reconciliation to one reconcile per `rAF`, so
  bursts of updates while the user drags a UI collapse safely.

## Cables, snapshots, and hidden ports

- Cables into currently-hidden ports are **rejected** when the user
  drags one in — the cable graph warns and discards the attempt.
- Cables that already exist on a port that goes hidden **remain in
  memory** and re-materialise (same source + destination) when the
  iframe shows the port again. Saved snapshots preserve the cable.
- `CableEndpoint` now carries an optional `portId` field the writer
  always emits. Older snapshots with only `jackIndex` still load;
  the resolver prefers `portId` when present.

## What to use webview ports for

- A rack/drawer UI whose "slots" each need their own modulation output
  (multi-LFO, multi-envelope, step-sequencer row outs).
- A patch-bay UI inside a single plugin window where the iframe picks
  which internal taps are exposed to the workspace.
- Optional inputs that the user enables from the webview (e.g. a
  compressor that exposes its sidechain detector tap on demand).

Avoid for single fixed ports — declare those in regular `inputs` /
`outputs` arrays so every user sees the jack without clicking into the
webview.

## Reserved partitioning

The host's `endpointScope()` classifies `port:<id>` as a **shared**
endpoint — important because voice engines partition their graph into
per-voice and shared scopes. Webview-exposable ports use the same
`port:<id>` namespace as regular ports, so they inherit the shared
classification automatically. Authoring implication: never use a node
id that starts with `port:` inside your `dsp.nodes[]`.
