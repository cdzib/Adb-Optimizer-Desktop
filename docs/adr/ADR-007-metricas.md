# ADR-007 — Métricas honestas

## Contexto
"Liberar RAM" es el estándar de la categoría y es engañoso: vaciar caché y matar procesos
provoca arranques en frío y empeora la experiencia.

## Decisión
El producto reporta y compara:
- arranque en frío (`am start -W`),
- frames lentos (`dumpsys gfxinfo`),
- CPU ocupada y load average (`dumpsys cpuinfo`),
- presión térmica (`dumpsys thermalservice`),
- procesos en background.

La RAM se muestra como contexto (usada/total), nunca como resultado de una optimización.

## Consecuencias
- (+) Las afirmaciones del producto son verificables.
- (−) Requiere instrumentar benchmarks en Fase 3 (aún no implementados).
