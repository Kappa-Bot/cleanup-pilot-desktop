# Product Redesign Brief

## Estado actual correcto

El producto visible ya funciona como un pipeline estricto:

- `Home`
- `Scan`
- `Plan`
- `Execute`
- `History`

`Settings` es secundaria.

No es correcto evaluar la UX principal como `Home / Cleaner / Optimize / Vault`. Esa estructura ya no es la IA visible.

## Tesis de producto

Cleanup Pilot debe competir por:

- claridad de decisión
- seguridad
- reversibilidad
- trust visible
- loop corto y obvio

No debe competir por enseñar más cosas a la vez.

## Fortalezas actuales

- cleanup `quarantine-first`
- optimizaciones reversibles
- `Smart Check` ya integrado en el loop visible
- historial por sesión
- trust y explainability en el plan
- postura local-first

## Debilidades actuales

- todavía existe residuo legacy en el repo y cerca del renderer activo
- el sistema visual del pipeline ya es más serio, pero todavía puede ser más coherente y distintivo
- `Plan`, `Execute` y `History` todavía tienen margen claro de industrialización
- before/after y narrativa de sesiones aún pueden ser más fuertes
- la cobertura funcional sigue siendo más profunda técnicamente que empaquetada comercialmente

## Qué debe optimizar el siguiente ciclo

1. mejorar composición y jerarquía del pipeline actual
2. reducir más residuos legacy del camino activo
3. hacer `Plan` más claro en impacto, riesgo y reversibilidad
4. hacer `Execute` más calmado y más convincente en perceived speed
5. hacer `History` más narrativo y más confiable
6. cerrar mejor el sistema visual activo

## Qué no debe hacer el siguiente ciclo

- reabrir `Cleaner`, `Optimize` o `Vault` como navegación visible
- reintroducir tablas grandes al primer render
- tratar AI como chat principal
- usar la existencia de un engine interno como argumento para añadir otra pantalla

## Preguntas correctas para revisar el producto

- ¿Qué debe hacer el usuario ahora mismo?
- ¿Por qué debería confiar en esta acción?
- ¿Qué detalle puede permanecer oculto hasta intención explícita?
- ¿Qué residuo legacy sigue filtrándose a la superficie visible?

## Foco por superficie

### Home
- recomendación principal más precisa
- hero más limpio
- score y trend más legibles

### Scan
- sensación de velocidad y control
- agrupación aún más clara
- menos copy de transición

### Plan
- mejor lectura de impacto y riesgo
- mejores affordances de detalle secundario
- relación más clara entre issues y acciones elegidas

### Execute
- progreso más tranquilo
- menos sensación de proceso interno
- más énfasis en qué está ocurriendo y qué sigue siendo seguro

### History
- mejor before/after
- mejor framing de undo / restore / purge
- sesiones más parecidas a historias de mantenimiento cerradas

## Direcciones válidas para el próximo rediseño

- industrializar el pipeline
- limpiar legado visible o cercano
- pulir microcopy y confirmaciones
- fortalecer el sistema visual con menos ruido

## Direcciones inválidas

- abrir más superficies
- volver a diseño tipo dashboard
- mezclar navegación visible con taxonomía interna del código
- añadir controles solo porque existan en settings o engines
