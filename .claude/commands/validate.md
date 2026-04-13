Run `node tools/ntvalidate.mjs $ARGUMENTS` from the repo root and
report any issues. Exit code 0 means the plugin manifest passes every
host-side rule the loader will check at install time.

If `$ARGUMENTS` is empty, validate every plugin folder under
`examples/` and `templates/`:

```bash
for d in examples/* templates/*; do
  if [ -f "$d/plugin.json" ]; then
    echo "=== $d ==="
    node tools/ntvalidate.mjs "$d"
  fi
done
```

Common failure modes + their fixes are documented in
[`../skills/scaffold-pedal/SKILL.md`](../skills/scaffold-pedal/SKILL.md)
and [`../../docs/reference/host-capabilities.md`](../../docs/reference/host-capabilities.md).
