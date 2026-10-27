#!/usr/bin/env bash
#
# Aprovisiona un DPC (Device Owner o Profile Owner) por ADB.
#
#   ./provision-dpc.sh app.apk com.empresa.dpc/.AdminReceiver [device|profile]
#
# Variables de entorno:
#   ADB=adb           binario de adb
#   SERIAL=<serial>   dispositivo objetivo (por defecto, el primero conectado)
#   FORCE=1           intenta aprovisionar aunque el preflight falle
#
set -euo pipefail

ADB="${ADB:-adb}"
APK="${1:-}"
COMPONENT="${2:-}"
MODE="${3:-device}"

if [[ -z "$APK" || -z "$COMPONENT" ]]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

if [[ ! -f "$APK" ]]; then
  echo "APK no encontrado: $APK" >&2
  exit 1
fi

if [[ -z "${SERIAL:-}" ]]; then
  SERIAL="$($ADB devices | awk 'NR==2 {print $1}')"
fi

if [[ -z "$SERIAL" ]]; then
  echo "No hay dispositivos conectados. Inicia la depuracion USB o Wi-Fi." >&2
  exit 1
fi

echo "== Dispositivo =="
echo "serial: $SERIAL"
$ADB -s "$SERIAL" get-state

SDK="$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')"
USERS="$($ADB -s "$SERIAL" shell pm list users | grep -c 'UserInfo{' || true)"
OWNERS="$($ADB -s "$SERIAL" shell dpm list-owners 2>/dev/null | grep -c 'admin=' || true)"
ACCOUNTS="$($ADB -s "$SERIAL" shell dumpsys account 2>/dev/null | grep 'Account {' | grep -vc 'name=null' || true)"

echo
echo "== Preflight =="
printf 'android sdk : %s\n' "$SDK"
printf 'usuarios    : %s\n' "$USERS"
printf 'owners      : %s\n' "$OWNERS"
printf 'cuentas     : %s\n' "$ACCOUNTS"

BLOCKED=0
if [[ "$OWNERS" != "0" ]]; then
  echo "  x ya existe un Device/Profile Owner"
  BLOCKED=1
fi
if [[ "$USERS" != "1" ]]; then
  echo "  x hay usuarios extra (Secure Folder, Dual Messenger, perfil de trabajo)"
  echo "    revisa: $ADB -s $SERIAL shell pm list users"
  echo "    elimina: $ADB -s $SERIAL shell pm remove-user <id>"
  BLOCKED=1
fi
if [[ "$ACCOUNTS" != "0" ]]; then
  echo "  x hay cuentas configuradas; Android exige un dispositivo recien restaurado"
  BLOCKED=1
fi

if [[ "$BLOCKED" == "1" && "${FORCE:-0}" != "1" ]]; then
  echo
  echo "Abortado. Restaura de fabrica (o limpia usuarios y cuentas) y vuelve a intentar."
  echo "Usa FORCE=1 para intentarlo de todos modos."
  exit 2
fi

echo
echo "== Instalando APK =="
INSTALL_OUT="$($ADB -s "$SERIAL" install -r -g "$APK")"
echo "$INSTALL_OUT"
if ! grep -q "Success" <<<"$INSTALL_OUT"; then
  echo "La instalacion fallo." >&2
  exit 3
fi

echo
echo "== Aprovisionando ($MODE) =="
set -x
if [[ "$MODE" == "profile" ]]; then
  $ADB -s "$SERIAL" shell dpm set-profile-owner --user 0 "$COMPONENT"
else
  $ADB -s "$SERIAL" shell dpm set-device-owner --user 0 "$COMPONENT"
fi
set +x

echo
echo "== Verificacion =="
$ADB -s "$SERIAL" shell dpm list-owners
echo
echo "Si el owner no aparece, revisa logcat:"
echo "  $ADB -s $SERIAL logcat -d | grep -i -E 'device.?owner|DevicePolicyManager'"
