# ADR-005 — Suite de conformidad entre Kotlin y TypeScript

## Contexto
Los parsers de `dumpsys` son el punto más frágil del producto: un formato distinto por
fabricante rompe las métricas y, peor, las verificaciones de las recetas.

## Decisión
`shared/conformance/cases/*.json` contiene pares (comando, salida cruda, resultado esperado).
Ambos clientes los ejecutan en sus tests. Si divergen, el CI falla.

## Consecuencias
- (+) Los parsers evolucionan juntos y con evidencia.
- (+) Un bug de fabricante se convierte en fixture, no en un `if` escondido.
- (−) Los fixtures actuales son sintéticos (`"synthetic": true`) y deben reemplazarse por
  capturas reales en Fase 0 antes de publicar.
