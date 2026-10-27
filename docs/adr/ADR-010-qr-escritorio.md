# ADR-010 — QR de conexión en escritorio (paridad con el proyecto de referencia)

## Contexto
`back-adb-macropay-client` vincula celulares sin cables con este flujo:

1. El backend genera `name` y `password` y devuelve `WIFI:T:ADB;S:<name>;P:<password>;;`.
2. El frontend dibuja el QR.
3. El celular lo escanea (Ajustes → Depuración inalámbrica → Vincular con QR).
4. El backend escucha `_adb-tls-pairing` con Bonjour y ejecuta `adb pair ip:puerto password`.
5. Al aparecer `_adb-tls-connect`, ejecuta `adb connect ip:puerto`.

De ese proyecto solo se requería el QR para la conexión.

## Decisión
Se implementa el mismo flujo en el escritorio con descubrimiento mDNS propio
(`bonjour-service`), igual que el proyecto de referencia.

### Por qué no `adb mdns services`
Con platform-tools 37.0.1 en macOS se comprobó que:

- `adb devices -l` lista `adb-RFCXB112P9Y._adb-tls-connect._tcp` (descubre mDNS),
- `adb mdns services` devuelve **una lista vacía** de forma consistente,
- y un browser Bonjour ve el servicio real: `adb-tls-pairing name=ADB_WIFI_AFK3T8 port=34927`.

Depender de `adb mdns services` hacía que el QR expirara siempre sin intentar el pairing.

- `MdnsBrowser` (`desktop/src/main/adb/mdns-browser.ts`) mantiene los servicios
  `_adb-tls-pairing` y `_adb-tls-connect` con expiración de 20 s y preferencia IPv4.
- `QrPairingSession` (`desktop/src/main/adb/qr-pairing.ts`) genera credenciales con el
  alfabeto sin caracteres ambiguos, crea el payload y orquesta pairing → connect.
- **No** se descartan los servicios `_adb-tls-pairing` que ya existían antes de generar el
  QR: el caso normal es que el usuario abra “Vincular con QR” en el dispositivo antes de
  pulsar Generar. El password es el que autoriza; un servicio viejo falla y se reintenta con
  backoff de 8 s hasta que el dispositivo escanee el código nuevo.
- Cada cambio de estado se registra en la consola y en el recorrido visible de la tarjeta.
- El `connect` solo se intenta contra el **mismo host** que se vinculó.
- Estado en vivo por IPC (`qr:status`): `waiting | pairing | connecting | connected | timeout | error`.
- Reintento de la misma dirección tras 8 s si el pairing falla (antes se descartaba para siempre).
- Diagnóstico visible en la UI (`qr:diagnostics`): salida de `adb mdns check` y servicios vistos.
- Timeout total 120 s, cancelable.

## Consecuencias
- (+) Paridad exacta con el flujo del proyecto web, sin backend ni Bonjour.
- (+) Un QR nuevo invalida al anterior; el botón Cancelar detiene el polling.
- (−) El QR solo lo puede escanear un dispositivo con cámara. Una TV debe usar el modo
  código o IP manual (no tiene cámara), igual que en el proyecto original.
- (−) Requiere platform-tools reciente que soporte `adb mdns services`; si el backend mDNS
  no está disponible, el flujo informa timeout en lugar de fallar en silencio.
