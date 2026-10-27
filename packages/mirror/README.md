# @adb-optimizer/mirror

Plugin independiente de Node >=20 y Electron. Abre una **ventana externa de scrcpy** con vídeo/control nativos; no inserta vídeo en HTML ni transmite a navegadores remotos. No depende de React, del catálogo, del cliente ADB ni de Electron. El host se encarga de conectar/autorizar el dispositivo.

## Distribución

Desde este workspace: `pnpm --filter @adb-optimizer/mirror build`.
Para instalar en otro repositorio, desde la raíz ejecutar `pnpm --filter @adb-optimizer/mirror pack --pack-destination ./artifacts` y después `npm install /ruta/al/artifacts/adb-optimizer-mirror-0.1.0.tgz` en el consumidor. También puede publicarse en un registro npm con acceso al scope. No se ha publicado automáticamente.

Requisitos del sistema: ADB y scrcpy instalados. `binary` y `adbPath` admiten rutas absolutas (también recursos empaquetados fuera de ASAR). Alternativamente scrcpy se resuelve por `SCRCPY_PATH`, Homebrew o PATH. El paquete no descarga ni incluye ejecutables; el distribuidor debe gestionar binarios por SO/arquitectura y sus licencias.

## Node / back-adb-macropay-client

```js
const { ScrcpySession } = require('@adb-optimizer/mirror')

const mirror = new ScrcpySession({
  adbPath: process.env.ADB_PATH || 'adb',
  binary: process.env.SCRCPY_PATH, // opcional
  onLog: console.log,
})
const unsubscribe = mirror.subscribe(status => console.log(status))
await mirror.start(serialDelDispositivoConectado, 'MacroPay · Android')
mirror.status() // { running: true, serial: '...' }
mirror.stop()
unsubscribe()
mirror.dispose() // terminal: libera suscripciones y cancela el inicio pendiente
```

Instanciar una vez por servicio, no por petición. Invocar `stop()` antes de desconectar/cambiar de dispositivo y `dispose()` en el cierre del host. Una instancia mantiene un solo proceso activo; llamadas simultáneas para el mismo serial comparten la promesa. Un cambio de serial cancela el inicio anterior y envía SIGTERM al proceso anterior. `start()` confirma creación del proceso, no disponibilidad del primer frame. `running` representa proceso iniciado, no salud del enlace ADB. SIGTERM no espera confirmación de cierre del SO.

En un backend HTTP, el espejo se abre **en la máquina del servidor**, que necesita sesión gráfica. No exponga rutas, argumentos arbitrarios ni seriales sin autorización en endpoints públicos. La selección de dispositivo debe resolverse en el servicio anfitrión. Para vídeo web remoto hace falta otra solución de streaming, fuera de este plugin.

## Adaptador Electron opcional (main)

```ts
import { ipcMain, app } from 'electron'
import { ScrcpySession, registerMirrorIpc } from '@adb-optimizer/mirror'

const mirror = new ScrcpySession({ adbPath })
const unregister = registerMirrorIpc({
  ipcMain,
  mirror,
  getDevice: () => connectedDevice
    ? { serial: connectedDevice.id, title: 'MacroPay' } : null,
  authorize: event => !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
})
const unsubscribe = mirror.subscribe(status => {
  if (!window.isDestroyed()) window.webContents.send('scrcpy:status', status)
})
app.on('will-quit', () => { unregister(); mirror.dispose(); unsubscribe() })
```

El host debe mantener esa ventana en contenido confiable: bloquear navegación externa, validar origen y no cargar contenido arbitrario. `authorize` es obligatorio. El renderer no puede seleccionar binarios ni dispositivos. Canales por defecto: `scrcpy:start`, `scrcpy:stop`, `scrcpy:status`; configurar `prefix` para evitar colisiones. Registrar una vez y ejecutar el cleanup antes de volver a registrar.

En preload, exponer solamente funciones específicas con `contextBridge`; nunca `ipcRenderer` completo:

```ts
contextBridge.exposeInMainWorld('mirror', {
  start: () => ipcRenderer.invoke('scrcpy:start'),
  stop: () => ipcRenderer.invoke('scrcpy:stop'),
  status: () => ipcRenderer.invoke('scrcpy:status'),
  subscribe: (listener: (status: ScrcpyStatus) => void) => {
    const handler = (_event: unknown, status: ScrcpyStatus) => listener(status)
    ipcRenderer.on('scrcpy:status', handler)
    return () => ipcRenderer.removeListener('scrcpy:status', handler)
  },
})
```

Los callbacks del host deben ser no-throw. `onExit` se conserva por compatibilidad para cierres espontáneos; usar `subscribe` para todos los cambios, incluidos start/stop. Los logs pueden contener identificadores del dispositivo: el host decide su redacción/retención.
