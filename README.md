# Cleanup Pilot Desktop

Windows-first Electron app for safe cleanup, storage analysis, reversible optimization, duplicate review, driver guidance, and structured AI-assisted diagnosis.

## What this project is

Cleanup Pilot Desktop is a local-first maintenance suite for Windows 11. The product is built around four top-level areas:

- `Home`: one-screen machine summary and Smart Check entry point
- `Cleaner`: cleanup, grouped review plan, storage exploration, duplicates, and contextual AI guidance
- `Optimize`: performance, startup, background load, and driver risk review
- `Vault`: quarantine, reversible optimization history, restore, purge, and advanced settings

The design goal is not to expose every engine at once. The goal is to surface the next safe action clearly and keep technical detail behind focused views.

## Current UX status

The product IA has already moved to `Home / Cleaner / Optimize / Vault`, but the current UX should still be treated as **transitional**, not final.

Important:

- the app is **not** yet at the level of a full industrial redesign
- some surfaces still feel like a legacy tool shell with calmer chrome on top
- future redesign work should be willing to **rethink flows from first principles**, not preserve current layouts by default

If you are using ChatGPT to redesign the product, read:

- `CHATGPT_CONTEXT.md`
- `docs/PRODUCT_REDESIGN_BRIEF.md`
- `docs/UX_RESET_BRIEF.md`
- `docs/CHATGPT_ANALYSIS_GUIDE.md`

## Product principles

- `Safety-first`: cleanup stays quarantine-first; system changes stay preview-first and reversible
- `Local-first`: no default telemetry; AI operates on structured local summaries
- `Windows-first`: tuned for Windows 11 and machine-local roots
- `Trust over noise`: explain why something is safe, blocked, or recommended

## Current core capabilities

### Cleaner
- Whole-machine scan with curated cleanup categories
- Container-aware findings for temp, cache, logs, crash dumps, installer residue, WSL residue, Minecraft residue, and AI/model leftovers
- Grouped cleanup preview and quarantine execution
- Duplicate scanning and duplicate-resolution preview
- Storage map with incremental caching and treemap-style exploration
- Contextual AI guidance that can feed actions directly into Cleanup Plan

### Optimize
- Performance monitoring with charts and incident summaries
- Startup analysis with reversible actions
- Service and scheduled-task analysis
- Driver guidance and driver-performance signals
- Structured diagnostics snapshots and history

### Vault
- Quarantine browsing, restore, and purge
- Reversible optimization-change history
- Advanced settings and protection profiles

## Repository layout

```text
cleanup-pilot-desktop/
  electron/                Main-process engines, IPC, Windows collectors, persistence
  src/                     Renderer app, pages, tabs, shared components, store
  test/                    Unit/integration/UI tests
  fixtures/                Synthetic system fixtures
  benchmark/               Benchmarks for engine hot paths
  CHATGPT_CONTEXT.md       High-signal context for future ChatGPT sessions
```

Key paths:

- `electron/main.ts`: main-process bootstrap
- `electron/ipc.ts`: renderer <-> Electron contract wiring
- `electron/scanEngine.ts`: cleanup scanning engine
- `electron/cleanupEngine.ts`: preview and quarantine execution
- `electron/quarantineManager.ts`: vault move/restore/purge lifecycle
- `electron/storageInsights.ts`: storage exploration and incremental caching
- `electron/systemDiagnostics.ts`: structured machine snapshot builder
- `src/App.tsx`: renderer entry wrapper
- `src/features/app/AppShell.tsx`: shell, route switching, overlays, command palette
- `src/features/home/HomePage.tsx`: `Home`
- `src/features/cleaner/CleanerPage.tsx`: `Cleaner`
- `src/features/optimize/OptimizePage.tsx`: `Optimize`
- `src/features/vault/VaultPage.tsx`: `Vault`

## Commands

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Validation

```bash
npm run typecheck
npm run test -- --runInBand
npm run build
```

### Extra

```bash
npm run test:e2e
npm run benchmark
npm run package:win
npm run release
```

## Architecture summary

### Main process

The Electron layer owns:

- cleanup and duplicate engines
- safety policy and protection resolution
- storage analysis and installed-app heuristics
- driver, startup, services, tasks, and performance analyzers
- snapshot persistence and product-level summaries
- product orchestration services like `homeSummaryService` and `smartCheckService`

### Renderer

The renderer is split by product area. `AppShell` is intentionally thinner than before and mostly handles:

- top-level navigation
- shared overlays
- command palette
- cross-area state handoff

Each product area is meant to expose summary first and detail on demand.

## Packaging and updates

Production packaging is standardized on a single Windows path:

- `electron-builder`
- `NSIS`
- `GitHub Releases`
- `electron-updater`

Operational notes:

- local packaging: `npm run package:win`
- tagged release publish: `npm run release`
- release workflow: `.github/workflows/release.yml`
- release ops guide: `docs/release-ops.md`

Code signing is currently `no especificado`. The repo now includes release plumbing and placeholders, but not a checked-in certificate or signing secret.

## Testing status

At the time of publishing, the local validation target is:

- `npm run typecheck` passes
- `npm run test -- --runInBand` passes
- `npm run build` passes
- `npm run test:e2e` passes against the local renderer with `desktopApi` stubs
- `npm run benchmark` produces synthetic renderer/IPC/bundle baselines

## What still needs improvement

Objectively, the project still has work to do before it can claim to beat CCleaner as a consumer product:

- broader curated application coverage
- stronger Smart Check productization
- software inventory / updater workflows
- more polished automated maintenance flows
- more trust messaging and before/after reporting at product level

It is already stronger in:

- reversibility
- safety guardrails
- local-first architecture
- machine diagnostics depth
- structured AI-assisted review

## For ChatGPT and future contributors

Start with these files:

- `CHATGPT_CONTEXT.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT_REDESIGN_BRIEF.md`
- `docs/CHATGPT_ANALYSIS_GUIDE.md`
- `docs/REPO_MAP.md`
- `electron/types.ts`
- `src/types.ts`
- `electron/ipc.ts`
- `src/features/app/AppShell.tsx`

Do not treat `dist/` or `dist-electron/` as source of truth.

## Collaboration files

The repository now includes collaboration and review scaffolding intended to make ChatGPT-driven analysis and redesign easier:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/workflows/ci.yml`
- `.github/ISSUE_TEMPLATE/`
- `.github/pull_request_template.md`
- `.env.example`
