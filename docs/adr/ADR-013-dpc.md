# ADR-013 — Instalación de APK y aprovisionamiento DPC

## Contexto
El flujo de enrolamiento necesita instalar un DPC y dejarlo como Device Owner (o Profile
Owner) sin root y sin tocar el dispositivo a mano.

## Decisión
La consola incorpora la pestaña **DPC** con tres pasos y un preflight real:

1. **Preflight** (`dpm list-owners`, `pm list users`, `dumpsys account`, SDK).
2. **Instalar APK** con `adb install -r -g`.
3. **Aprovisionar** con `dpm set-device-owner --user 0 <componente>` o
   `dpm set-profile-owner --user 0`.
4. **Script** equivalente en bash y PowerShell (`scripts/provision-dpc.*`).

El componente se detecta con `cmd package query-receivers -a
android.app.action.DEVICE_ADMIN_ENABLED` después de instalar, y siempre se puede escribir a
mano.

### Reglas del preflight
Android exige, para `set-device-owner`:

| Requisito | Comando de diagnóstico |
|---|---|
| Sin Device/Profile Owner previo | `dpm list-owners` |
| Un solo usuario (`UserInfo{0:...}`) | `pm list users` |
| Ninguna cuenta configurada | `dumpsys account` |
| Dispositivo recién restaurado o sin setup wizard completado | manual |

El preflight es **dependiente del modo**:

- **Device Owner**: sin owner, un solo usuario, cero cuentas.
- **Profile Owner**: exige un usuario secundario (perfil de trabajo) y no bloquea por
  cuentas, porque un perfil corporativo normalmente ya tiene cuentas.

Si algo falla, la app **no habilita** el botón de aprovisionar y explica qué limpiar. El
script aborta con código 2 salvo `FORCE=1`.

## Consecuencias
- (+) Cero root; comandos oficiales de Android.
- (+) Errores típicos de campo (Secure Folder, Dual Messenger, cuentas de Google) se
  detectan antes de intentar el cambio.
- (−) Quitar un Device Owner real requiere restauración de fábrica; el botón "Quitar owner"
  solo funciona con DPCs `android:testOnly`.
- (−) Cambiar de owner sin restaurar no está soportado por Android; la app lo dice en vez
  de simularlo.

## Verificado
Con un Samsung SM-S918B (Android 16): detecta correctamente el Profile Owner de Knox,
3 usuarios (0, 95, 150) y 45 cuentas, y bloquea el aprovisionamiento.
