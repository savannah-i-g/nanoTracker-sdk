Pack a plugin folder into a `.ntsfx` (FX/pedal) or `.ntins`
(instrument) archive ready to drop into the tracker.

```bash
node tools/ntpack.mjs $ARGUMENTS
```

If `$ARGUMENTS` is just a directory, the packer infers the output
filename + extension from `manifest.type`. To override:

```bash
node tools/ntpack.mjs <plugin-dir> --out <name>.ntsfx
```

Pre-flight: `ntpack` runs the same validation as `ntvalidate` before
zipping. A pack failure is the same as a validation failure — fix
the `plugin.json` issue first.

After packing, the user can drop the archive into the tracker via
PLUGIN MANAGER → `+ LOAD PLUGIN` → `+ ADD TO WS`.
