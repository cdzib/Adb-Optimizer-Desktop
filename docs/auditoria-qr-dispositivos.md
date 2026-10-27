# Auditoría — latencia del QR y pantalla de dispositivos

Revisión de solo lectura sobre `desktop/src/main/adb/*`, `desktop/src/renderer/screens/DevicesScreen.tsx`
y `desktop/src/renderer/styles.css`. Las afirmaciones de latencia son estáticas (lectura de
código + dependencia `bonjour-service@1.4.4`); las mediciones en caliente quedan pendientes de
laboratorio.

> Estado: las mejoras P0–P2 descritas aquí ya están implementadas (ver "Estado de
> implementación" al final). Lo pendiente es la medición en laboratorio.

## 1. Por qué el QR "a veces no conecta"

### Causa raíz: la caché de mDNS se vacía sola a los 20 s

`MdnsBrowser` guarda los servicios en un `Map` y solo los refresca con el evento `up`
(`desktop/src/main/adb/mdns-browser.ts:33-38`). `list()` borra toda entrada con más de
`STALE_MS = 20_000` ms sin `up` (`mdns-browser.ts:6,57-64`).

Comprobado en la dependencia: `Browser` emite `up` **solo la primera vez** que ve un servicio;
en los anuncios posteriores llama a `updateServiceSrv`/`updateServiceTxt` y **no vuelve a emitir
`up`** (`node_modules/.pnpm/bonjour-service@1.4.4/.../lib/browser.js:65-73,104-110`). Además
`browser.expire()` no se invoca desde el paquete.

Consecuencia concreta:

1. El teléfono entra en "Vincular con QR" y anuncia `_adb-tls-pairing` → la app lo ve (1 `up`).
2. A los 20 s la app lo borra de su caché y no lo vuelve a ver nunca, aunque el teléfono siga
   en esa pantalla y siga anunciándose.
3. El usuario escanea y `QrPairingSession.pollOnce()` (`qr-pairing.ts:113-118`) no encuentra
   candidato → sigue en `waiting` hasta el timeout de 120 s.

Eso explica el síntoma "no conecta rápido / a veces no conecta": funciona si el escaneo ocurre
en los primeros ~20 s desde que el servicio apareció, y falla en el resto de casos. Lo mismo
aplica al `_adb-tls-connect` posterior (`qr-pairing.ts:138-148`), que también se queda sin
publicar para la app a los 20 s.

### Segunda causa: `up` puede llegar sin IPv4 y la dirección no se corrige

`normalizeService()` toma IPv4 de `service.addresses` y, si está vacío, cae en `service.host`
(nombre `.local`) (`mdns-browser.ts:72-88`). `bonjour-service` arma el servicio con **un solo
paquete** (`browser.js:158-205`): si el registro `A` no vino en ese paquete, `addresses` queda
vacío. La dirección no se actualiza después (el `up` no se repite, y `srv-update` no se escucha).
`assertHostPort` acepta `hostname:puerto` (`desktop/src/main/validation.ts:34-47`), así que
`adb pair Pixel.local:41234` se intenta igual: en macOS resuelve por mDNSResponder, en Windows
puede fallar o tardar.

### Tercera causa: el `connect` depende de un solo canal

Tras vincular, la sesión solo conecta si ve `_adb-tls-connect` del mismo host en la caché
(`qr-pairing.ts:138-150`). No hay respaldo con `adb mdns services` (`AdbClient.mdnsServices()`
existe y ya se usa como fallback en el listado de equipos, `ipc.ts:95-99`), ni con el nombre de
instancia `adb-<serial>._adb-tls-connect._tcp`, ni un `adb connect` directo al host vinculado.
Un fallo de Bonjour = 120 s de espera sin intento.

### Cuarta causa: latencia acumulada por diseño

| Punto | Valor actual | Efecto |
|---|---|---|
| `pollMs` | 1200 ms (`qr-pairing.ts:60`) | +1.2 s por transición (pairing y connect) |
| `adb pair` | hasta 30 s (`adb-client.ts:222`) | bloquea el ciclo; no hay feedback de "vinculando" en la fila |
| `getInfo()` tras conectar | `getprop` completo + `which su` en serie (`adb-client.ts:716-730`) | +0.3–1 s antes de pintar "Conectado" |
| Espera de `_adb-tls-connect` | hasta 120 s sin fallback | timeout percibido como "no funciona" |
| Escaneo de equipos | cada 6 s (`DevicesScreen.tsx:63`) | hasta 6 s para ver un equipo recién conectado |
| Diagnóstico | `adb mdns check` cada 5 s siempre (`DevicesScreen.tsx:89-105`, `ipc.ts:101-104`) | proceso `adb` cada 5 s compitiendo con las acciones del usuario |

Con la caché arreglada, el mínimo baja de ~2.4–3.6 s extra a ~0.3–0.6 s; el `getInfo` en paralelo
quita otra ida y vuelta.

### Quinta causa: la UI no cuenta qué está pasando

- `expiresInMs` se devuelve (`qr-pairing.ts:88`) y **nunca se usa** en el renderer: no hay
  cuenta atrás, así que el QR caduca sin aviso.
- En `timeout` la tarjeta se cierra y se borran estado y bitácora (`DevicesScreen.tsx:83-85`),
  justo cuando el usuario necesita el diagnóstico.
- El QR mide 168 px (`DevicesScreen.tsx:372`) y no hay zona de silencio explícita; el panel
  lateral queda estrecho.
- `qr-trail` conserva 6 eventos y no distingue niveles; el estado no se anuncia
  (`aria-live` ausente) y el conmutador USB/Wi‑Fi no expone `aria-pressed`.
- El estado `unauthorized` se muestra en inglés crudo (`StateBadge`, línea 584), igual que
  "Clásico"/"TLS" que son jerga de ADB, no lenguaje de la tarea.

## 2. Pantalla de dispositivos: qué mejorar

Problemas observados:

1. **Jerarquía invertida.** La vía más usada sin cable (QR) vive en una tarjeta lateral pequeña
   debajo de dos bloques informativos; el tablero principal solo lista.
2. **Filas pasivas.** Modelo, serial y un badge. No hay IP, último visto, ni acciones por equipo
   (copiar dirección, reintentar, olvidar). Todo pasa por el botón "Conectar".
3. **Sin memoria.** La IP manual se reescribe en cada sesión; no hay equipos recientes.
4. **Jerga y duplicidad.** "Clásico" y "TLS" son dos botones para la misma intención (conectar a
   `ip:puerto`), y el puerto por defecto 5555 no aplica al modo inalámbrico moderno.
5. **Estados vacíos genéricos.** Un párrafo para cable, otro para red, sin distinguir causa
   (driver, cable, huella RSA, aislamiento de clientes, mDNS bloqueado por el router).
6. **Diagnóstico siempre visible y siempre sondeando**, incluso sin QR activo; compite con adb.
7. **Accesibilidad**: sin `aria-pressed` en el conmutador, sin `aria-live` en estados QR/errores,
   sin foco gestionado al conectar, contraste de `--muted` dentro de `--paper-2` justo.

Propuesta (respeta ADR-012: bandas, reglas de 1 px, sin sombras ni tarjetas flotantes):

- **Cabecera de tablero** con conteo por vía y "última búsqueda" ya existente; el escaneo pasa a
  ser información (cuántos equipos entraron desde la última pasada), no una tira decorativa.
- **Fila de equipo** en tres columnas: identidad (modelo + IP en mono), estado (badge + último
  visto), acciones (Conectar, Copiar IP, Reintentar). El detalle (SDK, ABI, transporte) en una
  línea secundaria.
- **Equipos recientes** persistidos en `localStorage` (sin tocar IPC): aparecen aunque no estén
  en la red, con acción "Reconectar" y "Olvidar".
- **Modo QR como panel principal** cuando no hay equipos: QR a 200–220 px, pasos
  (Escanear → Vincular → Conectar → Listo) con el paso activo marcado, cuenta atrás desde
  `expiresInMs`, y el panel **persiste** en timeout/error con bitácora y botón "Generar otro".
- **Conexión manual simplificada**: un campo `IP` + un campo `puerto` opcional, y un solo botón
  que detecta `5555` (clásico) o puerto TLS; la jerga queda como ayuda contextual.
- **Estados vacíos por causa**: cable no detectado / unauthorized / red sin mDNS / router aislando
  clientes, cada uno con su acción.
- **Accesibilidad**: `aria-pressed` en el conmutador, `role="status"` + `aria-live="polite"` en el
  estado QR, foco al botón primario al conectar, y `prefers-reduced-motion` ya respetado.

## 3. Prioridad sugerida

| Prioridad | Trabajo | Impacto | Esfuerzo |
|---|---|---|---|
| P0 | Caché mDNS viva + resolución de dirección | desbloquea el QR | ~120 LOC + test |
| P0 | Fallback de `connect` y sondeo rápido (300 ms) | −2 s por conexión | ~80 LOC + test |
| P0 | `getInfo` en paralelo | −0.3–1 s al conectar | ~20 LOC |
| P1 | Cuenta atrás, pasos y persistencia del panel QR | confianza y diagnóstico | ~150 LOC |
| P1 | Sondeo de diagnóstico solo con QR activo | menos carga en adb | ~30 LOC |
| P2 | Rediseño de filas, recientes y conexión manual | usabilidad diaria | ~250 LOC |
| P3 | Modo oscuro | ADR-012 lo deja como trabajo futuro | aparte |

## 4. Verificación pendiente

- Medir en laboratorio (`pnpm dev:lab`, `ADB_OPTIMIZER_LAB=1`) el tiempo real
  escanear → `connected`, antes y después.
- Confirmar si el teléfono anuncia `_adb-tls-connect` con IPv4 en el primer paquete o llega en
  paquetes separados (afecta la necesidad de resolver `.local`).
- Probar en Windows la resolución de `*.local` por parte de `adb pair`, que es el caso donde el
  fallback a hostname duele.

## 5. Estado de implementación

| Cambio | Archivo |
|---|---|
| Inventario mDNS derivado del navegador vivo, sin caducidad propia, host normalizado y fuente inyectable | `desktop/src/main/adb/mdns-browser.ts` |
| Sondeo de 300 ms y respaldo `adb mdns services` con enfriamiento de 5 s para el puerto TLS | `desktop/src/main/adb/qr-pairing.ts`, `desktop/src/main/ipc.ts` |
| `getprop` y sonda de root en paralelo | `desktop/src/main/adb/adb-client.ts` |
| Pasos, cuenta atrás, QR de 208 px, panel persistente en timeout/error y diagnóstico cada 15 s sin QR activo | `desktop/src/renderer/screens/DevicesScreen.tsx` |
| Filas con IP, copiar dirección, equipos recientes y estados vacíos por causa | `DevicesScreen.tsx` + `desktop/src/renderer/lib/recent-devices.ts` |
| Conexión manual de un solo botón, `aria-pressed`/`aria-live` y estilos del tablero | `DevicesScreen.tsx`, `desktop/src/renderer/styles.css` |

Gates ejecutados: `pnpm typecheck`, `pnpm test` (136 pruebas, 18 archivos) y `pnpm build`.
Sin medición real de latencia todavía; el laboratorio sigue pendiente.

