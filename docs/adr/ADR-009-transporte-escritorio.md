# ADR-009 — Selección explícita de transporte en escritorio (USB / Wi‑Fi)

## Contexto
En escritorio, `adb` soporta dos transportes con comportamientos distintos:

- **USB**: el dispositivo aparece con un serial de hardware (sin `:`); no hace falta
  `adb connect`, pero requiere cable, depuración USB y autorización RSA.
- **Wi‑Fi**: el target es `host:puerto`; requiere `adb connect` (y en Android 11+ con
  depuración inalámbrica, `adb pair`).

Mezclarlos en una sola lista confunde: el usuario no sabe por qué "no aparece" su TV.

## Decisión
La UI de conexión tiene dos pestañas excluyentes (`USB` y `Wi‑Fi`) y el host clasifica
cada entrada de `adb devices` con `detectTransport()`:

| Patrón del id | Transporte |
|---|---|
| `emulator-*` | `emulator` |
| `a.b.c.d:puerto` o `[ipv6]:puerto` | `network` |
| contiene `_adb-tls` | `network` |
| cualquier otro serial | `usb` |

`AdbClient.connectDevice(id)` es el único punto de entrada: lista, resuelve el transporte y
solo ejecuta `adb connect` cuando corresponde (incluida una IP manual que aún no aparece
en la lista). Además se expone `tcpip` para convertir un dispositivo USB a Wi‑Fi y
`adb usb` para volver.

## Ubicacion en la UI

La conversion USB → Wi‑Fi vive en la pestana **Wi‑Fi**, no en la de USB: es una accion de
red y su resultado (IP + puerto) se usa ahi mismo. La pestana USB solo muestra los
dispositivos por cable y un acceso directo a Wi‑Fi.

## Consecuencias
- (+) El usuario elige el transporte y ve el estado real (`device`, `unauthorized`, `offline`).
- (+) "No aparece por USB" tiene una causa accionable (cable, depuración, driver OEM, RSA).
- (+) El flujo USB → `tcpip` → Wi‑Fi cubre TVs cuya depuración inalámbrica usa puertos
  aleatorios sin implementar TLS todavía (ver ADR-004 en `../AdbOptimizer-Android/docs/adr/`).
- (−) `adb tcpip` deja el dispositivo en modo red hasta reinicio; la UI lo advierte y
  ofrece volver con `adb usb`.
