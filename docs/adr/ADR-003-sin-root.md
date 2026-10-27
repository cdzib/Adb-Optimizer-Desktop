# ADR-003 — Solo shell, sin root

## Decisión
La v1 ejecuta únicamente comandos disponibles para `shell` (uid 2000). El motor detecta
root (`which su`) y lo muestra, pero no habilita recetas privilegiadas.

## Motivos
- El 95% de TVs y TV Box no tienen root y el riesgo de brickeo es alto.
- `pm`, `am`, `settings`, `cmd` cubren la mayoría del valor real (animaciones, bloat,
  compilación AOT, doze, caché).

## Consecuencias
- Quedan fuera: `drop_caches`, gobernadores de CPU/GPU, thermal, `setprop` de VM,
  desinstalación de apps de sistema.
- `requiresRoot` existe en el esquema para no rediseñar nada si se habilita después.
