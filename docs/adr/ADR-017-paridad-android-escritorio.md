# ADR-017 — Paridad del escritorio con las features de la app Android

## Contexto

La app Android añadió capacidades que el escritorio no tenía: consola, logcat, inspector,
ajustes `global`/`secure`/`system`, Doze y energía, explorador de archivos, perfiles de apps,
debloater y diagnóstico ampliado. Portarlas exigía decidir dónde vive la lógica, cómo se
confirma cada cambio y cómo se evita duplicar semántica entre features.

## Decisión

### Frontera main / preload / renderer

Cada feature registra sus canales IPC con un `FeatureContext` común
(`desktop/src/main/features/context.ts`): el cliente ADB de la sesión, `dataDir`, `send` y
`log`. `ipc.ts` solo compone; no conoce los detalles de cada feature. El renderer sigue sin
acceso a Node y consume únicamente `window.api`.

### Confirmación por read-back

Toda operación que cambia estado se confirma leyendo el dispositivo de vuelta:

| Feature | Comando de cambio | Confirmación |
|---|---|---|
| Perfiles / debloater | `pm disable-user`, `pm enable`, `pm uninstall --user 0`, `pm install-existing` | `pm list packages [-d] [-e]` |
| Ajustes | `settings put` | `settings get` (3 intentos, 150 ms) |
| Doze | `dumpsys deviceidle force-idle/unforce` | `dumpsys deviceidle get force` |
| SystemUI | `am crash com.android.systemui` | PID nuevo en `pidof` |
| Archivos / APK | `pm install -r` | salida `Success` |

Un exit 0 no basta: Android acepta comandos que luego no conserva (claves protegidas por el
fabricante). Solo se registra historial o undo cuando el read-back coincide.

### Estado local

Perfiles (`profiles.json`), historial de ajustes (`settings-history.json`), historial de
consola (`console-history.json`), journal del debloater (`debloat-uninstalled.json`) y catálogo
UAD-NG (`debloat-catalog.json`) viven en `app.getPath('userData')` con escritura atómica
(tmp + rename). Un documento corrupto se degrada a vacío, no rompe la app.

### Debloater

La lista UAD-NG es GPL-3.0: no se empaqueta. Se descarga a pedido desde el repositorio de
UAD-NG, se cachea en `dataDir` y se descartan las entradas `unsafe` o desconocidas. El
debloater reutiliza `PackageStateService`, la misma capa que usan los perfiles.

### Seguridad y laboratorio

- Las rutas de archivos se normalizan y se citan; `rm -rf` rechaza `/`, `/sdcard`, `/system`,
  `/data`, `/vendor`, `/product`, `/apex`, `/proc` y `/sys`.
- Los paquetes de `shared/apps/protected-packages.json` nunca se tocan desde perfiles ni
  debloater.
- Todo IPC nuevo que escribe, reinicia o flashea llama `assertLabAllowed`; en modo laboratorio
  solo se permite un emulador o un serial declarado en `ADB_OPTIMIZER_LAB_SERIALS`.

## Consecuencias

- (+) Una sola semántica de paquetes para perfiles y debloater; menos comandos duplicados.
- (+) El usuario ve el resultado real, no la intención del comando.
- (+) La app Android sigue siendo la referencia: los parsers y comandos se copiaron de sus
  repositorios, sin compartir binarios ni estado en runtime.
- (−) Cada feature nueva debe declarar su read-back; un `pm` sin confirmación se considera
  fallo, aunque el dispositivo responda 0.
- (−) El diagnóstico ampliado puede tardar (SurfaceFlinger, sensores); por eso se lee a pedido
  desde la pantalla Estado y no en el refresco periódico de métricas.

## Validación

`pnpm typecheck`, `pnpm test` (279 pruebas: 5 del mirror y 274 del escritorio) y `pnpm build`
en verde. La validación física de archivos, Doze y energía queda pendiente en un equipo real o
en el laboratorio (`pnpm lab:android`).
