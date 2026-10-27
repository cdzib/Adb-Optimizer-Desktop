# Extracción del espejo a plugin

## Análisis

El espejo existente estaba en `desktop/src/main/adb/scrcpy-session.ts`, acoplado al tipo compartido de desktop. `main/index.ts` manejaba su ciclo de vida; `ipc.ts` seleccionaba el dispositivo y ofrecía tres operaciones al preload. El renderer ya consume una API estrecha: no es necesario cambiar su UI.

Se extrajo a `packages/mirror` como paquete TypeScript compilado a CommonJS con declaraciones y sin dependencias de ejecución. Esto permite consumirlo tanto desde un servicio Node como desde Electron, sin importar módulos internos del proyecto original. El adaptador IPC es opcional y usa interfaces estructurales, evitando cargar Electron en un backend Node.

La fachada original se conserva para compatibilidad. Desktop depende ahora del paquete mediante workspace y utiliza su registro IPC. La API de preload y los canales públicos se mantienen. Se notifican cambios de estado también al detener/iniciar y se detiene el espejo al desconectar ADB.

## Correcciones de ciclo de vida

- Antes de `spawn` no se retenía el proceso: dos llamadas concurrentes podían abrir dos ventanas y `stop` no cancelaba un inicio pendiente.
- Ahora se retiene la sesión pendiente, se deduplican inicios y se ignoran eventos de procesos reemplazados.
- Error o salida temprana rechazan el inicio y limpian estado. `dispose` cancela y libera suscripciones.
- El proceso se ejecuta sin shell; serial/título se validan y el binario solo se configura desde el host.

## Límites y adopción

No se encontró `back-adb-macropay-client` en `/Users/cesar.dzib/Proyectos`; no se modificó ni se presupuso Express/Nest/Electron. El README del paquete proporciona contratos, instalación por tarball y ejemplos Node/Electron para adaptarlo cuando esté disponible.

No se añade UI, vídeo embebido, servidor HTTP, descarga de binarios ni publicación npm. El espejo sigue siendo scrcpy externo y requiere entorno gráfico local. La terminación solicita SIGTERM; no garantiza cierre inmediato ni supervisa procesos que ignoren esa señal. `start` resuelve al crear el proceso, no al recibir vídeo.

## Validación

Pruebas automatizadas del paquete: concurrencia, cancelación, eventos tardíos, errores, salida temprana, validación y autorización/cleanup IPC. Se conserva además la suite existente de scrcpy en desktop. Ejecutar `pnpm test`, `pnpm typecheck` y `pnpm build`. Validación física pendiente: abrir/cerrar ventana con dispositivo, desconectar ADB y probar binarios/paquetes por plataforma.
