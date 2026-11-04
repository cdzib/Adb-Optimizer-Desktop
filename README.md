# ADB Optimizer

Optimiza una TV o dispositivo Android desde el celular o la computadora, usando **ADB sobre Wi-Fi**.
Sin backend y sin telemetría: cada cambio queda registrado y se puede deshacer. La app
Android funciona sin root (uid 2000); el escritorio puede usar `adb root` o `su` para
escribir en `/system` cuando el equipo lo permita.

```
Celular / Escritorio  ──ADB sobre TCP──▶  TV, TV Box u otro Android
        (host)                              (target, uid shell 2000)
```

## Estado actual

| Pieza | Estado |
|---|---|
| Catálogo compartido (`shared/`) | ✅ 14 recetas + 7 acciones, validadas por JSON Schema |
| App de escritorio (Electron + React) | ✅ Conecta por USB o Wi‑Fi, diagnostica, aplica, verifica y deshace |
| Launcher de sistema y apps a `/system` (escritorio) | ✅ Con `adb root` o `su` (Magisk/KernelSU); diagnóstico en la pestaña **Root y sistema** |
| Flasheo / Magisk (escritorio) | ✅ Respaldo de `boot`/`init_boot`, parcheo guiado con la app de Magisk y flasheo por `fastboot` |
| App Android (Kotlin + Compose) | ✅ Misma lógica; `assembleDebug` y tests en verde |
| Paridad con la app Android (escritorio) | ✅ Consola, logcat, inspector, ajustes global/secure/system, Doze y energía, archivos, perfiles, debloater y diagnóstico ampliado |
| Temas de interfaz | ✅ Claro, oscuro y del sistema, con preferencia local y seguimiento de `prefers-color-scheme` |
| Depuración inalámbrica real (TLS + pairing) | ✅ mDNS + código de 6 dígitos + QR vía libadb |
| Firma / publicación | ⏳ Fase 4 |

## Conexión (escritorio)

Al abrir la app hay dos pestañas:

- **Cable USB** — detecta dispositivos por serial, muestra `device` / `unauthorized` /
  `offline` y permite conectarlos sin escribir ninguna IP.
- **Wi‑Fi** — descubrimiento mDNS, lista de targets de red, IP manual con puerto,
  vinculación por código (`adb pair`), **Vincular con QR** y **"Activar Wi‑Fi desde USB"**
  (`adb tcpip`), que devuelve la IP lista para conectarse sin cable.

El QR replica el flujo del proyecto `back-adb-macropay-client`: se genera
`WIFI:T:ADB;S:<nombre>;P:<password>;;`, el dispositivo lo escanea desde *Depuración
inalámbrica → Vincular con QR*, y la app detecta `_adb-tls-pairing`, ejecuta
`adb pair` y luego `adb connect` sobre `_adb-tls-connect`. Detalle en
`docs/adr/ADR-010-qr-escritorio.md`.

El transporte se resuelve en `AdbClient.connectDevice()`: los seriales USB se asocian
directamente y los targets `host:puerto` pasan por `adb connect`. Detalle en
`docs/adr/ADR-009-transporte-escritorio.md`.

### Root y apps de sistema (escritorio)

La pestaña **Root y sistema** diagnostica `adb root`, `su`, verity, bootloader y
particiones dinámicas, y permite:

- Activar `adb root`, verificar `su` y remontar `/system` en lectura/escritura.
- Convertir apps de usuario a `/system/priv-app` o `/system/app` (base + splits).
- Ver la lista de apps convertibles con su APK.

La pestaña **Launcher** instala cualquier APK como launcher de sistema en `/system`,
reinicia, verifica que Android lo escaneó, lo asigna como Home y solo entonces
deshabilita el Home anterior. En equipos retail con bootloader bloqueado y
`ro.debuggable=0` la escritura se bloquea con un motivo explícito: no se puede
"rootear" solo con ADB. Detalle en `docs/plans/wanboos-launcher.md`.

### Flasheo y Magisk (escritorio)

La pestaña **Flasheo y Magisk** cubre el camino para instalar Magisk:

- Respaldar `boot`/`init_boot` con `dd` (si hay root) y descargar la imagen al host.
- Instalar el APK oficial de Magisk y abrirlo en el dispositivo.
- Detectar el `magisk_patched-*.img` generado en `/sdcard/Download`.
- Flashear por `fastboot` `boot`, `init_boot`, `vendor_boot`, `recovery` o `vbmeta`,
  con slot y opción de desactivar verity, exigiendo confirmar el nombre del equipo.

Magisk no tiene parcheador headless para PC: el parcheo se hace en su app
(Instalar → Seleccionar y parchear un archivo). La app orquesta el resto y verifica
`magisk -v` al arrancar. Detalle en `docs/plans/magisk-flash.md`.

## Estructura

```
shared/                      # Submódulo → adb-optimizer-contract (fuente única, sin copias)
├─ recipes/recipes.json      # recetas estáticas: run + verify + undo
├─ recipes/actions.json      # acciones parametrizadas por paquete
├─ recipes/schema.json       # JSON Schema, validado en TS y en Kotlin
├─ conformance/cases/        # fixtures de dumpsys que ambos parsers deben igualar
└─ i18n/{es,en}.json

desktop/                     # Electron (main/preload/renderer)
├─ src/main/adb/             # runner, cliente ADB, parsers
├─ src/main/optimization/    # catálogo, motor de recetas, bitácora
├─ src/renderer/            # React: dispositivos, estado, optimizar, historial
└─ tests/                    # parsers + conformidad + motor (vitest)

../Adb-Optimizer-Android/    # repo aparte (no vive aquí) — Gradle multi-módulo
├─ core/model                # contrato serializable (mismo schema)
├─ core/adb                  # AdbShell + dadb + parsers
├─ core/optimization         # motor de recetas + bitácora
└─ app                       # Composition root + features por paquete (MVI ligero)
```

La estructura interna de la app y las reglas para agregar features están en
[`Adb-Optimizer-Android/docs/arquitectura-android.md`](../Adb-Optimizer-Android/docs/arquitectura-android.md).

## Conexión (app Android)

Cuatro modos en la pantalla inicial:

| Modo | Cuándo usarlo |
|---|---|
| **Red** | El equipo ya está vinculado. Descubre los puertos TLS por mDNS y conecta. |
| **Código** | TV: *Ajustes → Sistema → Depuración inalámbrica → Vincular dispositivo*. Se ingresan IP, puerto de vinculación y el código de 6 dígitos; el puerto de conexión se resuelve por mDNS. |
| **QR** | El dispositivo a optimizar tiene cámara: escanea el QR que genera la app (mismo formato `WIFI:T:ADB;S:...;P:...;;` que el proyecto web). Una TV sin cámara no puede usar este modo. |
| **IP manual** | 5555 para ADB clásico o el puerto TLS escrito a mano. Incluye escaneo de QR (`adb://host:puerto?code=123456`) con la cámara. |

Además:
- **Recientes**: los últimos dispositivos se guardan y se reconectan con un toque.
- **Apps**: lista las apps de usuario y permite ejecutar las acciones del catálogo
  (cerrar, compilar AOT, restringir standby, suspender, deshabilitar) con blocklist de
  paquetes críticos.
- **Código de salida real** del shell vía `shell,v2,raw:` para que las verificaciones de
  las recetas sean fiables.

Implementación: `libadb-android` (SPAKE2 + TLS), `NsdManager` para mDNS, `zxing` para QR.
Detalle en `../Adb-Optimizer-Android/docs/adr/ADR-004-transporte-adb.md`.

## Gestor de aplicaciones (escritorio)

Pestaña **Apps**:

- Separación en **Sistema**, **Usuario** y **Ocultas**, con contadores y búsqueda por paquete.
- Badges de `sistema`, `usuario`, `deshabilitada`, `oculta` y `protegida`.
- **Menú Acciones** por app con el mismo catálogo que la app Android: cerrar, limpiar caché,
  compilar AOT, restringir en segundo plano, suspender y deshabilitar (con confirmación para
  las destructivas).
- **Apps de usuario**: `pm uninstall` (eliminación real, irreversible).
- **Apps de sistema**: `pm uninstall --user 0` (se ocultan, reversibles con
  `cmd package install-existing` desde la pestaña "Ocultas").
- **Extraer APK** por app: guarda el `base.apk` y sus splits en
  `<carpeta elegida>/<paquete>/` sin modificar el dispositivo.
- Los paquetes críticos de `shared/apps/protected-packages.json` no se pueden tocar.
- Cada desinstalación queda en el historial con su undo cuando aplica.

```bash
# ejemplo equivalente por consola
adb shell pm list packages -3
adb shell pm uninstall --user 0 com.samsung.android.bixby.agent
adb shell cmd package install-existing com.samsung.android.bixby.agent

# extraer un paquete con splits
adb shell pm path com.example.app
adb pull /data/app/.../base.apk ./com.example.app/
adb pull /data/app/.../split_config.arm64_v8a.apk ./com.example.app/
```

Detalle en `docs/adr/ADR-011-gestion-apps.md`.

## Paridad con la app Android (escritorio)

Las pantallas nuevas reutilizan la misma sesión ADB y las reglas de la app Android:

- **Consola** — comandos con tope de 60 s, salida/código/duración e historial local.
- **Registro** — logcat en vivo con filtros por nivel/texto y exportación.
- **Inspector** — permisos, AppOps, componentes, firma y SHA-256 por app.
- **Ajustes del sistema** — tablas `global`/`secure`/`system` con read-back e historial para deshacer.
- **Doze y energía** — estado de Doze, forzar/step/unforce/motion y reinicio, apagado, recovery,
  bootloader o reinicio de SystemUI.
- **Archivos** — navegar, ver texto, crear, renombrar, borrar, instalar un APK del dispositivo y
  descargar/subir archivos.
- **Perfiles** — snapshot del estado de las apps, aviso de drift, aplicación confirmada y undo.
- **Debloater** — catálogo UAD‑NG descargado en runtime; nunca ofrece entradas `Unsafe`.

Toda escritura se confirma leyendo el dispositivo de vuelta (`pm`, `settings`, Doze). En modo
laboratorio (`ADB_OPTIMIZER_LAB=1`) las operaciones de escritura siguen pasando por
`assertLabAllowed`. Los perfiles, el historial de consola y el catálogo del debloater viven en
`app.getPath('userData')`, no en el repositorio.

## DPC (Device Owner)

Pestaña **DPC** en el escritorio:

1. **Preflight** con `dpm list-owners`, `pm list users` y `dumpsys account`.
2. **Instalar APK** (`adb install -r -g`).
3. **Detectar** el `DeviceAdminReceiver` con
   `cmd package query-receivers -a android.app.action.DEVICE_ADMIN_ENABLED`.
4. **Aprovisionar** como Device Owner o Profile Owner.
5. **Generar** el script equivalente.

También desde consola:

```bash
./scripts/provision-dpc.sh app.apk com.empresa.dpc/.AdminReceiver device
```

```powershell
.\scripts\provision-dpc.ps1 -Apk .\app.apk -Component com.empresa.dpc/.AdminReceiver
```

Android exige un dispositivo sin owner previo, con un solo usuario y sin cuentas. El
preflight lo verifica y bloquea el intento si no se cumple. Detalle en
`docs/adr/ADR-013-dpc.md`.

## Cómo correr

### Escritorio

El catálogo llega por el submódulo `shared/` (repo `adb-optimizer-contract`). Clona con
`git clone --recurse-submodules` o, si ya tenías el repo, corre `git submodule update --init`
antes de instalar.

```bash
pnpm install
pnpm dev          # Vite + Electron con hot reload (elige puerto libre si 5173 esta ocupado)
pnpm test         # 298 tests (5 mirror + 293 desktop)
pnpm build        # dist/main + dist/renderer
pnpm dist         # instalador (electron-builder)
```

Requiere `adb` en el PATH o `ADB_PATH=/ruta/adb` (y `FASTBOOT_PATH` para flasheo).
El instalador no incluye `platform-tools`: usa las rutas configuradas o ten
`adb`/`fastboot` disponibles en el sistema.

### Android

Proyecto Android en la carpeta hermana `../Adb-Optimizer-Android`:

```bash
cd ../Adb-Optimizer-Android
./gradlew assembleDebug
./gradlew testDebugUnitTest
# APK: app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` necesita `sdk.dir` (no se versiona).

### Conectar una TV

1. Ajustes → Sistema → Información → tocar "Número de compilación" 7 veces.
2. Ajustes → Sistema → Depuración por red (o `adb tcpip 5555` desde una PC si el TV no la tiene).
3. Misma red Wi-Fi. IP + puerto 5555.
4. En la TV, aceptar la huella RSA la primera vez.

## Entornos de prueba controlados

Antes de tocar una TV real:

```bash
pnpm test                 # pruebas automáticas con ADB/fastboot simulados
pnpm lab:android          # emulador Google APIs rootable con -writable-system
pnpm lab:check            # verifica adb root, remount y apps de usuario
pnpm dev:lab              # app en modo laboratorio (solo emuladores)
```

El modo laboratorio (`ADB_OPTIMIZER_LAB=1`) bloquea escrituras y flasheos en
equipos reales; para permitir uno concreto usa `ADB_OPTIMIZER_LAB_SERIALS`.
Detalle y orden recomendado en `docs/testing.md`.

## Reglas del proyecto

1. **La app Android no usa root.** Se ejecuta como `shell` (uid 2000). El escritorio
   puede elevar con `adb root` o `su` para escribir en `/system`, siempre con
   diagnóstico previo, bitácora y rollback.
2. **Todo es reversible o se declara irreversible.** `undo` es obligatorio en el esquema.
3. **Un comando nuevo entra con evidencia** en `docs/evidence/` y, si aplica, con un caso de conformidad.
4. **Nada de "RAM liberada" como métrica.** Se mide arranque en frío, frames lentos, CPU y temperatura.
5. **Offline por diseño.** Sin cuentas, sin analytics, sin red salvo el dispositivo objetivo.

## Próximo paso

Fase 0 (spike): validar emparejamiento TLS en Android 11+ y el parque real de TVs.
Ver `../Adb-Optimizer-Android/docs/fase-0-spike.md`, `../Adb-Optimizer-Android/docs/adr/` y
`docs/adr/` (decisiones de escritorio y catálogo compartido).
