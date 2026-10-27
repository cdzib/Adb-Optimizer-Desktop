# Probar sin llegar a los dispositivos

Objetivo: validar cada capa en un entorno controlado antes de tocar una TV o un
teléfono real. De menor a mayor riesgo:

## Nivel 0 — Pruebas automatizadas (sin dispositivo)

```bash
pnpm test          # 91+ tests en desktop
pnpm typecheck
```

Cubren con un `CommandRunner` falso:

- Conexión, QR, scrcpy, DPC y apps.
- Launcher de sistema: copia a `/system`, reinicio, escaneo, Home y desactivación
  del Home anterior, incluyendo equipos que **no** son Wanbo.
- Conversión de apps a `/system/priv-app` y rollback.
- Flasheo: `fastboot devices`, argumentos de `flash`, slot, `--disable-verity`,
  validación de cabecera, confirmación del equipo y respaldo.
- `labGuard`: bloqueo de equipos reales en modo laboratorio.

Ventaja: rápidas, deterministas y sin riesgo. Limitación: no validan el
comportamiento real de un fabricante.

## Nivel 1 — Emulador rootable (escritura real en /system)

El emulador `android-tv` que tienes instalado es un build **user**
(`ro.debuggable=0`), así que `adb root` y `/system` en escritura no funcionan. Usa
una imagen **Google APIs** (no Play Store):

```bash
# Crea y arranca el laboratorio
pnpm lab:android

# Estado
pnpm lab:check

# App en modo laboratorio
pnpm dev:lab
```

El script `scripts/lab/android-lab.sh`:

1. Instala `system-images;android-36;google_apis;arm64-v8a`.
2. Crea el AVD `Lab_API36` (pixel_7).
3. Lo arranca con `-writable-system -no-snapshot -no-audio`.
4. Espera el arranque, ejecuta `adb root` y `adb remount`.
5. Comprueba `ro.build.type`, `ro.debuggable` y `id -u` (debe ser 0).

Con este emulador puedes probar:

- Pantalla **Root y sistema**: `adb root`, `su`, remount y diagnóstico.
- **Convertir apps** de usuario a `/system/priv-app` o `/system/app`, reinicio,
  verificación `pm path` y rollback.
- **Launcher de sistema**: instalar un APK de launcher, asignarlo como Home,
  deshabilitar el Home anterior y activar/rollback.
- **Flasheo** solo hasta donde el emulador lo permite: diagnóstico de fastboot y
  detección de imágenes. El emulador no tiene `boot`/`init_boot` de Magisk.

Variables útiles: `LAB_AVD`, `LAB_IMAGE`, `LAB_DEVICE`, `LAB_HEADLESS=1`.

## Nivel 2 — Dispositivo físico de laboratorio

Para el flujo Magisk/flasheo no hay sustituto real. Usa un equipo **desechable o
de pruebas** con bootloader desbloqueable y firmware stock:

- Ideal: Pixel, dev board o TV box con `fastboot` estándar.
- Evita equipos de producción o de clientes.
- Descarga y conserva el firmware stock exacto (`boot.img`/`init_boot.img`,
  `vbmeta.img`, etc.) y verifica su hash.
- Usa un cable y un puerto USB exclusivos; desconecta otros dispositivos.

### Modo laboratorio (protección contra errores)

Con `ADB_OPTIMIZER_LAB=1` la app solo permite escribir/flashear en emuladores:

```bash
ADB_OPTIMIZER_LAB=1 pnpm dev
```

Bloquea: instalar/activar el launcher de sistema, convertir apps, flashear,
instalar Magisk, remontar `/system`, reiniciar y sideload del launcher. Las
consultas y diagnósticos siguen disponibles. En la barra superior aparece `LAB`.

Para habilitar un equipo físico de pruebas concreto:

```bash
ADB_OPTIMIZER_LAB=1 \
ADB_OPTIMIZER_LAB_SERIALS="SERIAL_DEL_EQUIPO" \
pnpm dev
```

### Orden recomendado en el equipo físico

1. `adb devices` y `fastboot devices` manuales.
2. Pantalla **Root y sistema** en modo lectura: confirma build, verity, bootloader.
3. **Respaldo** de `boot`/`init_boot` y verifica tamaño.
4. Instala Magisk y parchea el `boot.img`/`init_boot.img` stock.
5. Flashea con slot correcto y confirma el nombre del equipo.
6. Si algo falla, vuelve a flashear el respaldo/stock.
7. Repite el ciclo restaurando el estado stock entre pruebas.

## Nivel 3 — TV/dispositivo real

Solo cuando 0–2 estén en verde y con:

- Rollback probado (backup + stock firmware).
- La misma versión de Android/ABI que el objetivo.
- Acceso físico al equipo y al botón de recuperación del bootloader.
- Registro de la bitácora y salida de la app guardados.

## Buenas prácticas

- **Aísla el host**: usuario de macOS dedicado o VM para el SDK; el journal y los
  respaldos viven en `app.getPath('userData')`.
- **Un dispositivo a la vez** durante pruebas de flasheo.
- **Nunca** pruebes por primera vez una operación destructiva en la TV del cliente.
- **Copia la imagen stock** antes de cada experimento; no confíes solo en el
  respaldo del dispositivo.
- **Emulador desechable**: si rompes `/system`, borra el AVD y vuelve a crearlo
  (`scripts/lab/android-lab.sh create`), no afecta a tu SDK.
- **Registra evidencia**: `pnpm lab:check`, salida de `fastboot getvar`, journal de
  la app y `adb logcat` si el arranque falla.
