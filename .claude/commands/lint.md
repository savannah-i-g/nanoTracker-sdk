Quiet validation pass for CI / pre-commit hooks. Same checks as
`/validate`, exits non-zero on any issue, no success banner.

```bash
node tools/ntvalidate.mjs $ARGUMENTS --quiet
```

Default to walking every plugin folder under `examples/` and
`templates/` if `$ARGUMENTS` is empty. Exits non-zero if ANY of
them fail.
