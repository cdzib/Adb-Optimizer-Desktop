# AGENTS.md

## Qué es

Host de escritorio (Electron + React + TypeScript) que diagnostica, optimiza, respalda y
flashea dispositivos Android vía ADB/fastboot. El catálogo de recetas es la fuente de
verdad compartida y la app Android vive en el repo hermano `../AdbOptimizer-Android`.
Sin backend, cuentas ni telemetría.

## Comandos

Requisitos: Node >= 20 (CI usa 22), pnpm 11. `adb` en PATH o `ADB_PATH`.

```bash
pnpm install
pnpm dev            # Vite + Electron, compila main y elige puerto libre
pnpm typecheck
pnpm test           # mirror (5) + desktop (115), sin dispositivo
pnpm build          # dist/main + dist/renderer
pnpm dist           # instalador electron-builder en desktop/release/
```

Orden de CI: `typecheck -> test -> build`. No lo reordenes sin actualizar
`.github/workflows/ci.yml`.

Una sola suite de pruebas:

```bash
cd desktop
pnpm --filter @adb-optimizer/mirror build   # requerido: src/main usa el paquete mirror
pnpm exec vitest run tests/parsers.test.ts   # un archivo
pnpm exec vitest run -t "nombre del test"    # un test por título
```

`pnpm test` y `pnpm typecheck` desde la raíz ya compilan `@adb-optimizer/mirror` primero.
Si ejecutas `vitest` directo sin compilarlo, desktop falla al resolver el paquete.

## Límites del workspace

- `desktop/` — app Electron. `src/main/` ejecuta ADB/fastboot y es el único proceso con
  acceso al sistema; `src/preload/index.ts` expone una API estrecha; `src/renderer/`
  solo consume `window.api` (contextIsolation, sin Node). No hay router: la pantalla
  activa es estado de `src/renderer/App.tsx`.
- `packages/mirror/` — plugin independiente de scrcpy, CommonJS con declaraciones, sin
  dependencias de runtime. `desktop/src/main/adb/scrcpy-session.ts` es solo una fachada
  que lo reexporta. Cámbialo en el paquete, no en desktop.
- `shared/` — datos de runtime (recetas, acciones, schema, i18n, blocklist), no tipos TS.
  `desktop/src/shared/types.ts` es el contrato TypeScript y no debe confundirse con él.
- `scripts/` — laboratorio de emulador y scripts de aprovisionamiento DPC.
- `docs/adr/` — decisiones de arquitectura y transporte del escritorio y del catálogo
  compartido; `docs/testing.md` — niveles de prueba; `docs/plans/` — flujos de launcher y
  Magisk. La arquitectura y los ADR de la app Android viven en
  `../AdbOptimizer-Android/docs/` (ADR-001, 004, 008, 014 y 016).

Al agregar una operación IPC hay que tocar tres sitios: handler en
`desktop/src/main/ipc.ts`, método/API en `desktop/src/preload/index.ts` y el tipo de
`DesktopApi`; después, la pantalla correspondiente.

## Catálogo compartido

`shared/` es la única fuente de verdad y **también la consume la app Android hermana**
(`app/build.gradle.kts` la monta como assets vía `../shared`). No copies el catálogo
dentro de un cliente ni cambies el schema solo para desktop.

Al añadir o modificar una receta/acción:

1. Actualiza `shared/recipes/{recipes,actions}.json` y, si aplica, `schema.json`.
2. Añade `titleKey`/`summaryKey` en **ambos** `shared/i18n/es.json` y `en.json`.
3. Declara `verify` y `undo` en cada paso; `undo: null` solo si es irreversible de forma
   explícita.
4. Mantén ids únicos y el patrón kebab-case.

`desktop/tests/catalog.test.ts` valida schema, ids, i18n y la regla de undo. Si el cambio
afecta contratos, avisa/verifica también el repo Android.

## Pruebas y entorno

- Vitest corre en `node` y solo incluye `tests/**/*.test.ts`; no hay E2E de Electron.
- Los tests de desktop usan `FakeRunner` para simular ADB; no requieren dispositivo.
  `findSharedDir()` localiza `shared/` subiendo desde el cwd, así que ejecuta Vitest desde
  `desktop/` o la raíz.
- El journal y los respaldos/flasheos viven en `app.getPath('userData')`
  (`journal.json`, `dataDir`), no en el repo.
- Para trabajo destructivo usa el laboratorio: `pnpm lab:android`, `pnpm lab:check`,
  `pnpm dev:lab`. `ADB_OPTIMIZER_LAB=1` solo permite `emulator-*`; habilita un equipo
  físico con `ADB_OPTIMIZER_LAB_SERIALS`. Cualquier IPC nuevo que escriba, reinicie o
  flashee debe llamar `assertLabAllowed` (`desktop/src/main/lab.ts`).
- Rutas configurables: `ADB_PATH`, `FASTBOOT_PATH`, `SCRCPY_PATH` y
  `ADB_OPTIMIZER_SHARED`. En desarrollo `shared/` se resuelve junto al repo; el paquete
  lo incluye vía `extraResources` en `desktop/electron-builder.yml`. Ese config **no**
  incluye `platform-tools`, así que el instalador depende de adb/fastboot del sistema o
  de rutas configuradas.
- `shared/apps/protected-packages.json` bloquea paquetes críticos; no lo debilites para
  hacer pasar una prueba o una acción.
