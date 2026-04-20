# Repo Map

## Main folders

- `electron/`: main-process engines, persistence, IPC, Windows collectors
- `src/`: renderer pages, views, tabs, shared UI, store
- `test/`: unit, UI, and integration coverage
- `fixtures/`: synthetic system snapshots for deterministic testing
- `benchmark/`: benchmark scripts and performance baselines
- `docs/`: high-signal product and architecture docs

## High-value files

- `README.md`
- `CHATGPT_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT_REDESIGN_BRIEF.md`
- `docs/CHATGPT_ANALYSIS_GUIDE.md`
- `electron/ipc.ts`
- `electron/types.ts`
- `src/types.ts`
- `src/features/app/AppShell.tsx`

## Product pages

- `src/features/home/`
- `src/features/cleaner/`
- `src/features/optimize/`
- `src/features/vault/`

## Heavy backend modules

- `electron/scanEngine.ts`
- `electron/cleanupEngine.ts`
- `electron/storageInsights.ts`
- `electron/driverScanService.ts`
- `electron/systemDiagnostics.ts`
- `electron/performanceMonitor.ts`
- `electron/startupAnalyzer.ts`

## Tests worth running after major changes

```bash
npm run typecheck
npm run test -- --runInBand
npm run build
```
