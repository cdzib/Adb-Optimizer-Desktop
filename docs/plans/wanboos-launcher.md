# Launcher de sistema y apps de sistema (Electron)

Estado: implementado en Electron. Flujo genérico para cualquier dispositivo con
escritura en `/system` (no solo Wanbo).

## Alcance

- Convertir un launcher (cualquier APK) en app de sistema, asignarlo como Home y
  deshabilitar el Home anterior.
- Convertir apps de usuario instaladas en apps de sistema (`/system/priv-app` o
  `/system/app`).
- Ventana **Root y sistema** con diagnóstico de acceso y acciones de root/remount.

## Requisito real

Escribir en `/system` necesita **uid 0** y partición en lectura/escritura:

1. `adb root` (builds `userdebug`/`eng` con `ro.debuggable=1`), o
2. `su` ya instalado (Magisk, KernelSU, SuperSU) y que conceda uid 0.

En TVs retail con `ro.debuggable=0` y bootloader bloqueado no hay forma de hacerlo
solo con ADB. El panel no explota el dispositivo: lo diagnostica y bloquea la
escritura con un motivo claro.

## Flujo del launcher (`SystemLauncherService.install`)

1. Diagnóstico: `probeSystemAccess()` detecta `adb root`/`su`, verity, bootloader y
   particiones dinámicas. Si `strategy === 'none'`, aborta sin escribir.
2. El paquete debe estar ya instalado como app normal (sideload) para conocer su
   `packageName`; debe vivir en `/data/app`.
3. Destino: `/system/priv-app/<paquete>/<archivo>.apk` o
   `/system/app/<paquete>/<archivo>.apk`, con respaldo en `/data/local/tmp`.
4. `ensureSystemWritable()`: `adb remount` o `mount -o rw,remount` vía `su`, y
   comprobación real escribiendo `/system/.adbopt-probe`.
5. Copia (`push` directo con adb root, o `push` a `/data/local/tmp` + `cp` con `su`),
   `chown 0:0`, `chmod 0644`, `restorecon`.
6. Registra la bitácora antes de reiniciar (rollback disponible).
7. Reinicia, espera `sys.boot_completed=1`.
8. Verifica `ls -lZ`, `pm path` con la ruta de `/system`, asigna Home
   (`set-home-activity`) y confirma con `resolve-activity`.
9. Solo entonces deshabilita el Home anterior detectado (`pm disable-user`) y
   confirma con `pm list packages -d`.

Si falla la activación, el Home anterior permanece activo y el mensaje invita a
"Restaurar cambios" o "Reintentar activación".

## Flujo de conversión de apps (`SystemAppService.convert`)

1. Lista apps de usuario con `pm list packages -3 -f`.
2. Valida que el paquete esté en `/data` y no tenga ya un APK en `/system`.
3. `pull` de todos los APKs (base + splits) a un directorio temporal.
4. `installSystemBundle`: respaldo de la carpeta destino, copia de cada APK,
   permisos y `restorecon`.
5. Bitácora con `systemApp` (carpeta destino, respaldo, archivos) para rollback.
6. Reinicia, espera el arranque y verifica `pm path` con la ruta de `/system`.

La copia de usuario se conserva: la app sigue funcionando y la copia de sistema
sobrevive a un restablecimiento de fábrica. El rollback elimina la carpeta de
sistema y reinicia.

## Verificación

- `probeSystemAccess()`: `ro.debuggable`, `id -u`, `which su`, `mount`.
- Tras reiniciar: `pm path <pkg>` debe incluir `/system/priv-app` o `/system/app`.
- `ls -lZ` no debe devolver `unlabeled`.
- Home: `cmd package resolve-activity -c android.intent.category.HOME`.
- Undo: `restoreSystemApk` / `restoreSystemBundle` + `reboot`.

## Riesgos

- Deshabilitar el Home anterior deja el equipo sin Home si el nuevo no arranca;
  por eso se verifica primero y el rollback no depende del launcher.
- Android 10+ con particiones dinámicas puede rechazar `adb remount`; en ese caso
  hace falta desactivar verity (con reinicio) u overlayfs.
- No se eliminan las actualizaciones en `/data`: la app convertida conserva su
  copia de usuario.
