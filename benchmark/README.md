# Benchmark Notes

Run with:

```bash
node benchmark/runBenchmarks.cjs
```

What the script measures:

- `fixture-enumeration` - sanity check for the number of synthetic system profiles.
- `fixture-json-parse` - JSON parse cost for the bundled fixture payloads.
- `ipc-scan-payload-roundtrip` - serialization cost for a scan-like request/result payload built from local fixtures.
- `cleanup-preview-fixture` - cost of summarizing a cleanup preview from the same fixture data.
- `renderer-mount-synthetic` - synthetic React mount/unmount cost in `jsdom` without booting the full app.
- `bundle-size-report` - optional size capture from `dist/` when the renderer has already been built.

The synthetic payloads are intentionally local and deterministic so the benchmark stays useful without depending on electron, IPC, or external services.
