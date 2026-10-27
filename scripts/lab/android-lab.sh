#!/usr/bin/env bash
# Laboratorio Android para probar ADB Optimizer sin tocar equipos reales.
#
# Uso:
#   scripts/lab/android-lab.sh install   # descarga la imagen rootable
#   scripts/lab/android-lab.sh create    # crea el AVD
#   scripts/lab/android-lab.sh up        # arranca, adb root y remount
#   scripts/lab/android-lab.sh check     # estado del laboratorio
#   scripts/lab/android-lab.sh stop      # apaga el emulador
#
# Variables:
#   ANDROID_SDK_ROOT / ANDROID_HOME, LAB_AVD, LAB_IMAGE, LAB_DEVICE, LAB_HEADLESS=1
set -euo pipefail

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
NAME="${LAB_AVD:-Lab_API36}"
IMAGE="${LAB_IMAGE:-system-images;android-36;google_apis;arm64-v8a}"
DEVICE="${LAB_DEVICE:-pixel_7}"
HEADLESS="${LAB_HEADLESS:-0}"

usage() {
  sed -n '2,17p' "$0"
}

ensure_tools() {
  for tool in "$SDKMANAGER" "$AVDMANAGER" "$EMULATOR" "$ADB"; do
    if [ ! -x "$tool" ]; then
      echo "No encontrado: $tool" >&2
      echo "Ajusta ANDROID_SDK_ROOT o instala cmdline-tools + emulator + platform-tools." >&2
      exit 1
    fi
  done
}

avd_exists() {
  "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$NAME"
}

resolve_serial() {
  if [ -n "${LAB_SERIAL:-}" ]; then
    echo "$LAB_SERIAL"
    return
  fi
  "$ADB" devices | awk '/^emulator-[0-9]+[[:space:]]+device/{print $1; exit}'
}

wait_boot() {
  local serial="$1"
  "$ADB" -s "$serial" wait-for-device
  for _ in $(seq 1 120); do
    if [ "$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      return 0
    fi
    sleep 2
  done
  echo "El emulador no terminó de arrancar." >&2
  return 1
}

cmd="${1:-up}"

case "$cmd" in
  -h|--help|help)
    usage
    ;;
  install)
    ensure_tools
    yes | "$SDKMANAGER" --install "$IMAGE"
    ;;
  create)
    ensure_tools
    if avd_exists; then
      echo "El AVD $NAME ya existe."
      exit 0
    fi
    echo no | "$AVDMANAGER" create avd -n "$NAME" -k "$IMAGE" -d "$DEVICE" --force
    echo "AVD $NAME creado con $IMAGE"
    ;;
  up)
    ensure_tools
    if ! avd_exists; then
      yes | "$SDKMANAGER" --install "$IMAGE"
      echo no | "$AVDMANAGER" create avd -n "$NAME" -k "$IMAGE" -d "$DEVICE" --force
    fi
    ARGS=(-avd "$NAME" -writable-system -no-snapshot -no-audio -no-boot-anim)
    if [ "$HEADLESS" = "1" ]; then ARGS+=(-no-window); fi
    "$EMULATOR" "${ARGS[@]}" >/tmp/adb-optimizer-lab-emulator.log 2>&1 &
    echo "Emulador arrancando (log: /tmp/adb-optimizer-lab-emulator.log)…"
    SERIAL=""
    for _ in $(seq 1 60); do
      SERIAL="$(resolve_serial)"
      if [ -n "$SERIAL" ]; then break; fi
      sleep 2
    done
    if [ -z "$SERIAL" ]; then
      echo "No se detectó ningún emulador en adb devices." >&2
      exit 1
    fi
    wait_boot "$SERIAL"
    "$ADB" -s "$SERIAL" root || true
    sleep 2
    "$ADB" -s "$SERIAL" wait-for-device
    "$ADB" -s "$SERIAL" remount || true
    echo
    echo "Laboratorio listo ($SERIAL):"
    "$ADB" devices -l
    echo "ro.build.type = $("$ADB" -s "$SERIAL" shell getprop ro.build.type | tr -d '\r')"
    echo "ro.debuggable = $("$ADB" -s "$SERIAL" shell getprop ro.debuggable | tr -d '\r')"
    echo "uid           = $("$ADB" -s "$SERIAL" shell id -u | tr -d '\r')"
    echo
    echo "Arranca la app en modo laboratorio:"
    echo "  ADB_OPTIMIZER_LAB=1 pnpm dev"
    ;;
  check)
    ensure_tools
    "$ADB" devices -l
    SERIAL="$(resolve_serial)"
    if [ -z "$SERIAL" ]; then
      echo "No hay emulador activo. Arranca uno con: scripts/lab/android-lab.sh up" >&2
      exit 1
    fi
    echo
    echo "emulador=$SERIAL"
    echo "tipo=$(  "$ADB" -s "$SERIAL" shell getprop ro.build.type | tr -d '\r')"
    echo "debuggable=$(  "$ADB" -s "$SERIAL" shell getprop ro.debuggable | tr -d '\r')"
    echo "uid=$(  "$ADB" -s "$SERIAL" shell id -u | tr -d '\r')"
    echo "root=$( "$ADB" -s "$SERIAL" shell "mount | grep ' / '" | tr -d '\r')"
    echo "--- apps de usuario (primeras 10) ---"
    "$ADB" -s "$SERIAL" shell pm list packages -3 | head -10
    ;;
  stop)
    ensure_tools
    SERIAL="$(resolve_serial)"
    if [ -n "$SERIAL" ]; then
      "$ADB" -s "$SERIAL" emu kill || true
    else
      echo "No hay emulador activo."
    fi
    ;;
  *)
    echo "Comando no reconocido: $cmd" >&2
    usage
    exit 1
    ;;
esac
