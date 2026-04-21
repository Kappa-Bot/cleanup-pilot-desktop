# Cleanup Pilot Desktop: ChatGPT Context

Last updated: 2026-04-20

This document exists so future ChatGPT sessions can understand the project quickly, avoid stale assumptions, and improve the app from the right architectural level.

## 1. Project identity

`cleanup-pilot-desktop` is a Windows-first Electron desktop app for safe cleanup, storage analysis, reversible optimization, duplicate management, driver guidance, and structured AI-assisted diagnosis.

This repo is the cleanup app itself. It is separate from older local Electron projects in the same parent folder.

## 2. Product direction

The product was redesigned around four top-level areas:

- `Home`
- `Cleaner`
- `Optimize`
- `Vault`

This is a product decision, not just a visual one.

## 2.1 Important correction: the current UX is still transitional

Do **not** treat the current renderer UX as a completed redesign.

The current state is better than the older many-tab shell, but it is still not the desired end-state. In practice, the app still behaves too much like a powerful tool suite with calmer wrappers instead of a truly product-grade maintenance assistant.

This means future redesign work should:

- be willing to rethink page structure from first principles
- remove or relocate UI that only exists because of legacy tab structure
- challenge the current shell instead of preserving it by default
- optimize for calm, trust, and decisiveness over feature exposure

If a future ChatGPT session is asked to “redesign the UX”, the correct default interpretation is:

- **industrial-grade UX reset**
- **not** incremental polish
- **not** “keep the current layout but prettier”

Goals:

- show less at once
- surface the next safe action clearly
- keep technical depth accessible but secondary
- compete on trust, reversibility, and clarity before chasing breadth

### Product meaning of each area

#### Home
One-screen machine summary.

Should answer:

- What is the state of this PC?
- How much can be safely recovered?
- What is the main performance issue?
- What should the user do next?

#### Cleaner
Unified cleanup product area.

Includes:

- scan
- cleanup plan
- storage exploration
- duplicates
- contextual AI cleanup hints
- safety review for blocked cleanup items

#### Optimize
Unified optimization product area.

Includes:

- performance monitoring
- startup analysis
- service and task review
- driver performance/risk review

#### Vault
Unified reversibility product area.

Includes:

- quarantine
- reversible optimization history
- restore and purge
- advanced settings / protection profiles

## 3. Source of truth

Use source files, not build outputs.

### Edit these
- `electron/`
- `src/`
- `test/`
- `fixtures/`
- `benchmark/`

### Do not edit generated output unless debugging a build artifact
- `dist/`
- `dist-electron/`

### Shared-contract rule
`src/types.ts` and `electron/types.ts` must stay aligned.

## 4. Tech stack

- Electron 25
- React 18
- TypeScript
- Vite
- Zustand
- sql.js
- electron-store
- uPlot
- Jest + Testing Library
- Playwright

## 5. Main scripts

- `npm run dev`
- `npm run typecheck`
- `npm run test -- --runInBand`
- `npm run build`
- `npm run test:e2e`
- `npm run benchmark`

## 6. Current architecture

### Main process

Entry point:
- `electron/main.ts`

Important modules:
- `electron/ipc.ts`
- `electron/configStore.ts`
- `electron/db.ts`
- `electron/scanEngine.ts`
- `electron/cleanupEngine.ts`
- `electron/quarantineManager.ts`
- `electron/duplicateEngine.ts`
- `electron/storageInsights.ts`
- `electron/driverScanService.ts`
- `electron/performanceMonitor.ts`
- `electron/systemDiagnostics.ts`
- `electron/systemDoctor.ts`
- `electron/startupAnalyzer.ts`
- `electron/serviceAnalyzer.ts`
- `electron/taskSchedulerAnalyzer.ts`
- `electron/optimizationManager.ts`

### Product orchestration services added for the redesign
- `electron/homeSummaryService.ts`
- `electron/smartCheckService.ts`
- `electron/issueRankingService.ts`
- `electron/coverageCatalogService.ts`
- `electron/trustExplainerService.ts`

Purpose:

- aggregate machine state into ranked product-level issues
- expose a `Home` summary without dropping the user into raw tools
- run `Smart Check`
- explain why something is safe, blocked, or recommended

## 7. Renderer structure

Renderer entry:
- `src/App.tsx`

Shell:
- `src/features/app/AppShell.tsx`

Top-level product pages:
- `src/features/home/HomePage.tsx`
- `src/features/cleaner/CleanerPage.tsx`
- `src/features/optimize/OptimizePage.tsx`
- `src/features/vault/VaultPage.tsx`

Shared UI primitives added for the redesign:
- `src/features/shared/IssueCard.tsx`
- `src/features/shared/DecisionPanel.tsx`
- `src/features/shared/TrustBadge.tsx`
- `src/features/shared/SideInspector.tsx`
- `src/features/shared/SmartActionBar.tsx`
- `src/features/shared/MetricStrip.tsx`
- `src/features/shared/EmptyState.tsx`

Legacy/secondary views still exist behind those pages:
- overview
- scan
- cleanup
- safety
- ai
- duplicates
- drivers
- performance
- quarantine
- settings

Those legacy views are still used internally, but they are now grouped under the four product areas.

## 8. IPC surface added by the redesign

New product-level IPC:

- `home.snapshot`
- `smartcheck.run`
- `smartcheck.current`
- `smartcheck.preview`
- `smartcheck.execute`
- `coverage.catalog`
- `trust.explainFinding`

The old IPC surface remains intact for compatibility.

## 8.1 Current Smart Check / Home state

The product now exposes richer Home and Smart Check contracts:

- health subscores for `storage`, `startup`, `background`, and `safety`
- health trend state
- trust summary copy
- recommended action summary
- before/after maintenance summary when recent snapshots exist

These fields are intentionally additive and mostly optional so older call sites do not break.

## 9. Safety model

These rules are non-negotiable:

- cleanup remains quarantine-first
- no permanent delete flow in normal cleanup
- cleanup preview is required before execution
- protected roots and binary protections remain enforced
- installed-app-aware protections remain enforced
- optimization changes are reversible and preview-first
- drivers remain recommendation-only
- AI consumes structured local summaries, not raw logs

## 10. Cleanup engine notes

Files:
- `electron/scanEngine.ts`
- `electron/rulePack.ts`
- `electron/protectionResolver.ts`
- `electron/safetyPolicy.ts`

Behavior:

- whole-machine scope is the default in product flows
- explicit scan roots must be respected when a focused scan is intentionally requested
- disposable containers such as cache/temp/log folders can collapse into directory findings
- WSL residue is included, but distro VHD/VHDX files must not be treated as disposable
- `Downloads` is not auto-selected by default

## 11. Cleanup execution notes

Files:
- `electron/cleanupEngine.ts`
- `electron/quarantineManager.ts`
- `electron/windowsSources/elevation.ts`

Behavior:

- preview first
- quarantine mode only
- single-elevation strategy where possible, not repeated per-file UAC prompts
- fast paths exist for whole-folder bulk quarantine
- restore and purge are part of the product, not edge tooling

## 12. Storage / duplicates / AI notes

### Storage
- `electron/storageInsights.ts`
- supports incremental caching and treemap-oriented data
- whole-machine storage exploration is expected by default

### Duplicates
- `electron/duplicateEngine.ts`
- should remain quarantined and reviewable

### AI
- `electron/aiAdvisorService.ts`
- `electron/ai/`

Rules:
- AI is integrated, not top-level product navigation
- AI output should be structured and actionable
- prefer minimal token usage
- fallback heuristics are important when provider quota or rate limits fail

## 13. Performance / startup / drivers notes

### Performance
- `electron/performanceMonitor.ts`
- `electron/performanceSampler.ts`
- `electron/processProfiler.ts`
- `src/features/performance/`

Charts should help decision-making, not expose raw telemetry for its own sake.

### Startup / services / tasks
- `electron/startupAnalyzer.ts`
- `electron/serviceAnalyzer.ts`
- `electron/taskSchedulerAnalyzer.ts`
- `electron/optimizationManager.ts`

All actions remain reversible.

### Drivers
- `electron/driverScanService.ts`

Drivers are still recommendation-only. Official sources and risk summaries matter more than raw class listings.

## 14. Testing and quality gates

Current expectation before claiming work is done:

- `npm run typecheck`
- `npm run test -- --runInBand`
- `npm run build`

The repo also includes:

- `test/harness`
- `fixtures/systems`
- `benchmark/`

Current benchmark coverage is still synthetic, but it is no longer trivial smoke only. It now includes:

- IPC-style payload roundtrip
- cleanup preview fixture summarization
- synthetic renderer mount cost
- bundle size reporting

Use them instead of inventing fake assumptions when changing analyzers.

## 15.1 Packaging and release

Release readiness is now oriented around one path only:

- `electron-builder`
- `NSIS`
- `electron-updater`
- `GitHub Releases`

Supporting files:

- `.github/workflows/release.yml`
- `docs/release-ops.md`

Code signing remains `no especificado`.

## 15.2 Electron hardening status

The Electron shell now explicitly expects:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- blocked `window.open`
- blocked arbitrary navigation / redirects
- denied runtime permission prompts

If future work weakens any of those, treat it as a security regression unless there is a documented exception.

## 15. Current product assessment vs CCleaner

Objective view:

The app does not yet beat CCleaner as a complete consumer product.

It is already stronger in:
- reversibility
- trust and safety model
- local-first architecture
- machine diagnostics depth
- structured AI-assisted review

It still needs work in:
- breadth of curated app coverage
- productized Smart Check experience
- software updater / inventory workflows
- maintenance automation polish
- simpler before/after reporting

## 16. Good next steps

High-value next work:

1. make `Smart Check` the central end-to-end flow
2. expand curated coverage catalog by app family
3. strengthen trust explanations and before/after deltas in `Home` and `Vault`
4. keep reducing noise in top-level screens
5. preserve the rule that advanced tables are secondary, not first-load content

## 17. Practical guidance for future ChatGPT sessions

If asked to improve the project:

1. read `README.md`
2. read this file
3. inspect `electron/types.ts` and `src/types.ts`
4. inspect `electron/ipc.ts`
5. inspect `src/features/app/AppShell.tsx`
6. only then drill into the specific engine or page being changed

Do not assume the old tab-first architecture is still the intended product direction. The intended product direction is the four-area model.
