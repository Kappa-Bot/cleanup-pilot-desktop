# Repo Map

## Carpetas principales

- `electron/`: engines, persistencia, IPC, orquestación de producto
- `src/`: renderer activo, pipeline visible, shared components, legado todavía presente
- `test/`: unit, UI y e2e
- `fixtures/`: datos sintéticos
- `benchmark/`: benchmarks y reportes sintéticos
- `docs/`: contexto para diseño, arquitectura y futuros agentes

## Entrada activa del producto

- `src/App.tsx`
- `src/features/pipeline/ProductShell.tsx`

## Archivos clave del pipeline

- `src/features/pipeline/ProductShell.tsx`
- `src/features/pipeline/HomeSurface.tsx`
- `src/features/pipeline/ScanSurface.tsx`
- `src/features/pipeline/PlanSurface.tsx`
- `src/features/pipeline/ExecuteSurface.tsx`
- `src/features/pipeline/HistorySurface.tsx`
- `src/features/pipeline/PipelineRail.tsx`
- `src/features/pipeline/SettingsDrawer.tsx`
- `src/features/pipeline/pipelineShared.ts`
- `src/features/pipeline/pipeline.css`

## Archivos clave del backend

- `electron/main.ts`
- `electron/ipc.ts`
- `electron/preload.ts`
- `electron/decisionFlowService.ts`
- `electron/smartCheckService.ts`
- `electron/homeSummaryService.ts`
- `electron/quarantineManager.ts`
- `electron/db.ts`
- `electron/types.ts`
- `src/types.ts`

## Contratos visibles importantes

- `home.snapshot`
- `smartcheck.run`
- `smartcheck.current`
- `decision.plan`
- `decision.execute`
- `history.sessions.list`
- `history.sessions.restore`
- `history.sessions.purge`

## Legado todavía presente

Estos paths siguen existiendo pero no son la UX principal:

- `src/features/app/AppShell.tsx`
- `src/features/app/tabs/`
- `src/features/home/`
- `src/features/cleaner/`
- `src/features/optimize/`
- `src/features/vault/`
- `src/features/performance/`
- `src/features/ai/`

Úsalos como:

- lógica a migrar
- capacidad interna todavía útil
- deuda pendiente de limpieza

No los uses como argumento para restaurar navegación tabbed.

## Lectura recomendada para futuros agentes

1. `README.md`
2. `CHATGPT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT_REDESIGN_BRIEF.md`
5. `docs/UX_RESET_BRIEF.md`
6. `docs/CHATGPT_ANALYSIS_GUIDE.md`
7. `src/features/pipeline/ProductShell.tsx`
8. `electron/decisionFlowService.ts`
9. `electron/ipc.ts`
10. `src/types.ts`
11. `electron/types.ts`

## Validación recomendada después de cambios grandes

```bash
npm run typecheck
npm run test -- --runInBand
npm run build
npm run benchmark
npm run test:e2e
```
