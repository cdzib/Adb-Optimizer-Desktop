export interface ProvisionScriptInput {
  serial: string
  apkPath: string
  component: string
  mode: 'device' | 'profile'
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Script bash equivalente a lo que hace la app, para integraciones o soporte.
 * No toca el dispositivo si el preflight falla (salvo FORCE=1).
 */
export function buildProvisionScript(input: ProvisionScriptInput): string {
  const command =
    input.mode === 'device'
      ? 'dpm set-device-owner --user 0'
      : 'dpm set-profile-owner --user 0'

  return `#!/usr/bin/env bash
# Aprovisionamiento DPC por ADB
# Uso: ./provision-dpc.sh [APK] [COMPONENTE] [device|profile]
set -euo pipefail

ADB="\${ADB:-adb}"
SERIAL="\${SERIAL:-${input.serial}}"
APK="\${1:-${input.apkPath}}"
COMPONENT="\${2:-${input.component}}"
MODE="\${3:-${input.mode}}"

if [[ ! -f "$APK" ]]; then
  echo "APK no encontrado: $APK" >&2
  exit 1
fi
if [[ -z "$COMPONENT" ]]; then
  echo "Falta el componente DeviceAdminReceiver (paquete/.Receiver)" >&2
  exit 1
fi

echo "== Dispositivo =="
$ADB -s "$SERIAL" get-state

echo "== Preflight =="
USERS=$($ADB -s "$SERIAL" shell pm list users | grep -c "UserInfo{" || true)
OWNERS=$($ADB -s "$SERIAL" shell dpm list-owners | grep -c "admin=" || true)
ACCOUNTS=$($ADB -s "$SERIAL" shell dumpsys account | grep -c "Account {" || true)

echo "usuarios:   $USERS"
echo "owners:     $OWNERS"
echo "cuentas:    $ACCOUNTS"

if [[ "$OWNERS" != "0" || "$USERS" != "1" || "$ACCOUNTS" != "0" ]]; then
  echo
  echo "El dispositivo no cumple los requisitos de Android para Device Owner:"
  echo " - debe tener un solo usuario (sin Secure Folder ni Dual Messenger)"
  echo " - ninguna cuenta configurada"
  echo " - ningun Device/Profile Owner previo"
  echo "Restaura de fabrica o elimina usuarios (@pm remove-user <id>) y cuentas."
  if [[ "\${FORCE:-0}" != "1" ]]; then
    echo "Abortado. Usa FORCE=1 para intentarlo igual."
    exit 2
  fi
fi

echo "== Instalando APK =="
$ADB -s "$SERIAL" install -r -g "$APK"

echo "== Aprovisionando: $COMPONENT =="
$ADB -s "$SERIAL" shell ${command} "$COMPONENT"

echo "== Verificacion =="
$ADB -s "$SERIAL" shell dpm list-owners
`
}
