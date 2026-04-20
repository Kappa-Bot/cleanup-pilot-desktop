# Architecture Guide

This file is a higher-level map of the repository for humans and ChatGPT.

## 1. Product surface

Top-level product model:

- `Home`
- `Cleaner`
- `Optimize`
- `Vault`

This matters because older parts of the codebase still use legacy tab names internally. The intended product is the four-area model, not the legacy many-tab model.

## 2. Main process architecture

`electron/main.ts` wires the app together.

Main-process responsibilities:

- config and persistence bootstrapping
- database initialization
- cleanup, duplicate, storage, and diagnostics engine creation
- product-level summary services
- IPC registration
- browser window lifecycle

### Important backend layers

#### Engines
- `scanEngine.ts`
- `cleanupEngine.ts`
- `duplicateEngine.ts`
- `storageInsights.ts`
- `driverScanService.ts`
- `performanceMonitor.ts`
- `systemDiagnostics.ts`
- `systemDoctor.ts`
- `startupAnalyzer.ts`
- `serviceAnalyzer.ts`
- `taskSchedulerAnalyzer.ts`

#### Safety / policy
- `safetyPolicy.ts`
- `protectionResolver.ts`
- `protectionPreferences.ts`

#### Product orchestration
- `homeSummaryService.ts`
- `smartCheckService.ts`
- `issueRankingService.ts`
- `coverageCatalogService.ts`
- `trustExplainerService.ts`

#### Windows adapters
- `electron/windowsSources/`

These modules isolate PowerShell, registry, task scheduler, service, perf-counter, and capability probing logic from higher-level engines.

## 3. Renderer architecture

Entry:
- `src/App.tsx`
- `src/main.tsx`

Shell:
- `src/features/app/AppShell.tsx`

The shell handles:
- route switching
- shared overlays
- command palette
- cross-area UI state orchestration

Top-level product pages:
- `src/features/home/HomePage.tsx`
- `src/features/cleaner/CleanerPage.tsx`
- `src/features/optimize/OptimizePage.tsx`
- `src/features/vault/VaultPage.tsx`

These wrap legacy lower-level views rather than rewriting every subview from scratch.

## 4. Shared contracts

Important rule:
- `src/types.ts`
- `electron/types.ts`

These files mirror shared contracts. If one changes, the other usually must change too.

## 5. Store and slices

State lives in `src/store/` and feature slices. Large renderer changes should prefer feature-local state and selectors over pushing more into `AppShell`.

## 6. Critical product constraints

- cleanup stays quarantine-first
- no normal cleanup path should permanently delete files
- optimization changes must be reversible
- protected roots and binaries stay blocked
- installed-app-aware protection stays active
- AI should receive structured summaries, not raw logs

## 7. Where redesign work should usually land

### Product/IA redesign
- `src/features/home/`
- `src/features/cleaner/`
- `src/features/optimize/`
- `src/features/vault/`
- `src/features/shared/`
- `src/styles.css`

### Cleanup behavior
- `electron/scanEngine.ts`
- `electron/rulePack.ts`
- `electron/cleanupEngine.ts`
- `electron/quarantineManager.ts`

### Optimization behavior
- `electron/startupAnalyzer.ts`
- `electron/serviceAnalyzer.ts`
- `electron/taskSchedulerAnalyzer.ts`
- `electron/optimizationManager.ts`

### Diagnostics/performance
- `electron/performanceMonitor.ts`
- `electron/performanceSampler.ts`
- `electron/processProfiler.ts`
- `electron/systemDiagnostics.ts`
- `src/features/performance/`

## 8. Recommended analysis sequence for ChatGPT

1. `README.md`
2. `CHATGPT_CONTEXT.md`
3. this file
4. `electron/types.ts`
5. `src/types.ts`
6. `electron/ipc.ts`
7. `src/features/app/AppShell.tsx`
8. only then inspect the specific engine/page being changed
