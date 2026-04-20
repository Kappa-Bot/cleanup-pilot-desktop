# Contributing

Thanks for contributing to `cleanup-pilot-desktop`.

This project is a Windows-first Electron application for safe cleanup, reversible optimization, structured diagnostics, and AI-assisted machine analysis. The repo is intentionally documented for human contributors and for ChatGPT-based review/redesign work.

## First read

Before changing code, read these files in order:

1. `README.md`
2. `CHATGPT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT_REDESIGN_BRIEF.md`
5. `docs/CHATGPT_ANALYSIS_GUIDE.md`
6. `electron/types.ts`
7. `src/types.ts`
8. `electron/ipc.ts`
9. `src/features/app/AppShell.tsx`

## Product rules

These are hard constraints:

- cleanup stays quarantine-first
- no destructive cleanup without preview
- system optimization changes stay reversible
- protected roots and binary safety remain enforced
- installed-app-aware protection remains enforced
- driver actions stay recommendation-only unless intentionally expanded later
- AI operates on structured summaries, not raw logs
- Windows is the first-class target platform

## Development setup

```bash
npm install
npm run dev
```

## Required validation before opening a PR

```bash
npm run typecheck
npm run test -- --runInBand
npm run build
```

If you change performance dashboards, cleanup execution, scanning, IPC, or product-level routing, run the full set.

## Architecture guidance

- `electron/` owns engines, persistence, Windows collectors, and IPC handlers.
- `src/` owns product pages, tabs, shared UI, and store composition.
- `src/types.ts` and `electron/types.ts` must stay aligned.
- Do not treat `dist/` or `dist-electron/` as editable source.

## Product-level guidance

The top-level product model is:

- `Home`
- `Cleaner`
- `Optimize`
- `Vault`

New work should reinforce that structure instead of re-expanding the app into many first-class tabs.

## Expectations for changes

Good changes usually do at least one of these:

- improve trust and safety
- reduce visual noise
- make the next action clearer
- improve whole-machine coverage
- reduce latency or repeated work
- strengthen before/after reporting
- make the repo easier for ChatGPT to reason about

## Pull request guidance

A strong PR includes:

- a short product-level summary
- the user-visible impact
- files/modules touched
- safety implications
- validation performed
- any known limitations left intentionally unresolved

## Documentation updates

If you change architecture or product direction materially, update:

- `README.md`
- `CHATGPT_CONTEXT.md`
- relevant files in `docs/`

That is part of the deliverable, not optional polish.
