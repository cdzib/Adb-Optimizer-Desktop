# ADR-002 — Un solo catálogo compartido

## Contexto
Dos clientes (Kotlin y TypeScript) que deben ejecutar exactamente los mismos comandos.

## Decisión
`shared/recipes/*.json` es la única fuente de verdad. La app Android lo consume como
asset vía `sourceSets["main"].assets.srcDir("../shared")`; el escritorio lo lee del
sistema de archivos y lo empaqueta en `extraResources`. Ningún comando se escribe en la UI.

## Consecuencias
- (+) Un cambio de receta impacta a ambos clientes sin duplicar código.
- (+) El esquema se valida en build (Ajv en TS, `kotlinx.serialization` estricto en Kotlin).
- (−) Requiere disciplina de esquema: un campo nuevo debe agregarse primero al schema.
