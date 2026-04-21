# Cleanup Pilot Desktop

Aplicación Electron para Windows enfocada en mantenimiento seguro, reversible y local-first.

## Estado real del producto

La UX visible actual ya no es `Home / Cleaner / Optimize / Vault`.

La aplicación visible funciona como un pipeline estricto de 5 superficies:

1. `Home`
2. `Scan`
3. `Plan`
4. `Execute`
5. `History`

`Settings` vive fuera de la navegación principal como drawer secundario.

## Qué significa esto

La app ya no se presenta como una colección de herramientas. Ahora se presenta como un loop de decisión y ejecución:

- `Home`: resume el estado y propone la siguiente acción
- `Scan`: ejecuta `Smart Check` y agrupa hallazgos en lenguaje de decisión
- `Plan`: muestra qué se va a limpiar y optimizar, con impacto, riesgo y reversibilidad
- `Execute`: aplica el plan con progreso agrupado y sin logs crudos por defecto
- `History`: agrupa sesiones, before/after, undo, restore y purge

## Motores que siguen existiendo

El cambio es de producto y UX, no de engines.

Siguen existiendo como capacidades internas:

- cleanup scan y quarantine execution
- duplicate analysis
- storage insights
- startup / services / tasks / diagnostics
- driver guidance
- AI diagnosis
- optimization history y quarantine vault

Pero esas capacidades ya no justifican tabs visibles propias.

## Entrada activa del renderer

La fuente de verdad visible del producto es:

- `src/App.tsx`
- `src/features/pipeline/ProductShell.tsx`

El pipeline está modularizado en:

- `src/features/pipeline/HomeSurface.tsx`
- `src/features/pipeline/ScanSurface.tsx`
- `src/features/pipeline/PlanSurface.tsx`
- `src/features/pipeline/ExecuteSurface.tsx`
- `src/features/pipeline/HistorySurface.tsx`
- `src/features/pipeline/PipelineRail.tsx`
- `src/features/pipeline/SettingsDrawer.tsx`
- `src/features/pipeline/pipelineShared.ts`
- `src/features/pipeline/pipeline.css`

## Legado importante

El repo todavía contiene shell y features legacy, por ejemplo:

- `src/features/app/AppShell.tsx`
- `src/features/home/`
- `src/features/cleaner/`
- `src/features/optimize/`
- `src/features/vault/`
- `src/features/performance/`
- `src/features/ai/`

Eso debe tratarse como implementación interna, material de migración o deuda de limpieza. No es la IA visible actual.

## Backend relevante

Puntos de entrada y orquestación:

- `electron/main.ts`
- `electron/ipc.ts`
- `electron/preload.ts`
- `electron/decisionFlowService.ts`
- `electron/homeSummaryService.ts`
- `electron/smartCheckService.ts`
- `electron/issueRankingService.ts`
- `electron/trustExplainerService.ts`

Persistencia y reversibilidad:

- `electron/db.ts`
- `electron/quarantineManager.ts`
- `electron/optimizationManager.ts`

## Reglas no negociables

- cleanup sigue siendo `quarantine-first`
- optimizaciones siguen siendo `preview-first` y reversibles
- no se envían logs crudos a AI por defecto
- `src/types.ts` y `electron/types.ts` deben permanecer alineados
- no reabrir tabs legacy como navegación principal por inercia

## Validación principal

```bash
npm run typecheck
npm run test -- --runInBand
npm run build
npm run benchmark
npm run test:e2e
```

## Qué debe hacer ChatGPT en el siguiente ciclo

La siguiente iteración seria no debe reconstruir otra IA.

Debe:

- refinar visualmente el pipeline actual
- eliminar más residuo legacy del path activo
- profundizar `Plan`, `Execute` y `History`
- mejorar before/after y trust copy
- endurecer la coherencia visual y de spacing

No debe:

- volver a abrir `Cleaner`, `Optimize` o `Vault` como secciones visibles
- convertir la app en dashboard
- enseñar más telemetría solo porque existe

## Archivos para leer primero

1. `README.md`
2. `CHATGPT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT_REDESIGN_BRIEF.md`
5. `docs/UX_RESET_BRIEF.md`
6. `docs/REPO_MAP.md`
7. `src/features/pipeline/ProductShell.tsx`
8. `electron/decisionFlowService.ts`
9. `electron/ipc.ts`
10. `electron/types.ts`
11. `src/types.ts`
