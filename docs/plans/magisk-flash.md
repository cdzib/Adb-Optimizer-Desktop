# Flasheo de imágenes y Magisk (Electron)

Estado: implementado en el escritorio. Requiere `fastboot` y conexión USB.

## Qué automatiza la app

- Diagnóstico de la partición de arranque (`boot` o `init_boot`), slot activo,
  esquema de particiones, estado del bootloader, `fastboot`, app de Magisk y root.
- Respaldo de `boot`/`init_boot` con `dd` (requiere `adb root` o `su`) y descarga al
  equipo host en `userData/backups`.
- Instalación del APK oficial de Magisk y apertura de la app en el dispositivo.
- Detección de imágenes `.img` en `/sdcard/Download`, descarga al host y
  selección de un `.img` local.
- Flasheo por `fastboot` de `boot`, `init_boot`, `vendor_boot`, `recovery` o
  `vbmeta`, con slot (`actual`, `a`, `b`, `all`) y opción de desactivar verity.
- Verificación posterior de Magisk (`magisk -v`).

## Qué NO puede automatizar

Magisk **no publica un parcheador headless para PC**. El parcheo oficial se hace
en la app de Magisk del dispositivo:

1. Instalar la app de Magisk.
2. Abrir Magisk → **Instalar** → **Seleccionar y parchear un archivo**.
3. Elegir el `boot.img`/`init_boot.img` (stock o respaldado).
4. El resultado queda en `/sdcard/Download/magisk_patched-*.img`.

La app detecta ese archivo, lo descarga y lo flashea. No se empaquetan binarios de
Magisk ni se intenta replicar su script de parcheo.

## Procedimiento completo

1. **Bootloader**: en equipos retail hay que desbloquearlo con las herramientas del
   fabricante (borra datos y afecta la garantía). Sin desbloquear, fastboot rechaza
   el flasheo. En builds `userdebug`/`eng` normalmente ya está desbloqueado.
2. **USB**: conectar por cable; `fastboot` no funciona sobre ADB Wi‑Fi.
3. **Respaldo**: pestaña **Flasheo y Magisk** → *Respaldar ahora*. Sin root, usa la
   imagen stock del firmware exacto.
4. **Magisk**: *Elegir APK de Magisk* → *Instalar Magisk* → *Abrir Magisk* y parchear
   el `boot`/`init_boot`.
5. **Imagen**: *Buscar imágenes* → *Usar* en `magisk_patched-*.img`.
6. **Flasheo**: elegir partición (`init_boot` en Android 13+ si existe; `boot` en el
   resto), slot y escribir el nombre del dispositivo para confirmar.
7. **Verificación**: tras reiniciar, la app ejecuta `magisk -v`. Si no responde,
   abrir Magisk y completar la configuración inicial.

## Android 13+ y `init_boot`

Desde Android 13, muchos equipos separan el ramdisk en `init_boot`; Magisk debe
parchear y flashear `init_boot`, no `boot`. El diagnóstico elige `init_boot` cuando
existe y el SDK es 33 o superior.

## `vbmeta` y verity

Desactivar verity solo aplica a `vbmeta`:

```
fastboot --disable-verity --disable-verification flash vbmeta vbmeta.img
```

Es una operación avanzada: usar la imagen `vbmeta` del firmware del equipo.

## Validaciones de seguridad

- Solo USB; se rechaza una conexión de red.
- La imagen debe existir y tener la cabecera esperada (`ANDROID!`, `VNDRBOOT`,
  `AVB0`) antes de reiniciar al bootloader.
- Hay que escribir el nombre del dispositivo (`ro.product.device`) para confirmar.
- El respaldo se guarda antes y se puede volver a flashear desde la misma pantalla.
- No se permite elegir una partición arbitraria: solo boot/init_boot/vendor_boot/
  recovery/vbmeta.

## Riesgos

- Un `boot.img` incorrecto deja el equipo sin arrancar; por eso el respaldo y la
  verificación de cabecera son obligatorios.
- El parcheo con Magisk no elimina la necesidad de desbloquear el bootloader.
- Algunos equipos con particiones dinámicas exigen `fastboot` reciente; usa el de
  platform-tools actualizado.
