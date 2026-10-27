# ADR-015 — Extracción de APK desde el escritorio

## Contexto
Además de instalar y desinstalar apps, hace falta sacar del dispositivo el APK de un
paquete: respaldar una versión, analizar un APK de sistema o reinstalarlo en otro equipo.
Muchas apps modernas no son un solo archivo: se reparten en un `base.apk` y varios
`splits` (ABI, densidad, idioma). Extraer solo el `base.apk` produce una instalación
incompleta.

## Decisión

### Resolución de rutas
`pm path <paquete>` devuelve una línea por APK instalado:

```
package:/data/app/~~abc==/com.example-xyz==/base.apk
package:/data/app/~~abc==/com.example-xyz==/split_config.arm64_v8a.apk
package:/data/app/~~abc==/com.example-xyz==/split_config.es.apk
```

`parsePackagePaths` acepta únicamente líneas con prefijo `package:`, exige ruta absoluta
y descarta duplicados y ruido de otros comandos. El nombre del paquete se valida con
`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$` antes de ejecutar nada: no se interpola entrada
arbitraria en el shell.

### Copia
Un `adb pull` por archivo hacia una carpeta existente:

| Paso | Comando |
|---|---|
| 1 | `adb -s <serial> shell pm path <paquete>` |
| 2 | `adb -s <serial> pull <ruta-remota> <carpeta-local>` |

Los archivos se guardan en `<carpeta elegida>/<paquete>/`; como el usuario solo elige la
carpeta raíz, cada paquete queda aislado y los nombres (`base.apk`,
`split_config.*.apk`) no colisionan entre apps.

### Sin journal
La extracción solo lee del dispositivo. No modifica configuración ni paquetes, así que no
entra en la bitácora ni necesita `undo`. Si el usuario ya no quiere los archivos, los
borra desde su sistema operativo.

### UI
La acción **Extraer APK** vive en el menú de cada app (también en las protegidas: leer no
las daña). El diálogo del sistema pide la carpeta y, al terminar, la pantalla muestra
cuántos archivos se extrajeron con un acceso directo para abrir la carpeta. El proceso
principal solo permite abrir carpetas creadas por una extracción de la sesión actual.

## Consecuencias
- (+) Respaldo completo de apps con splits, sin root.
- (+) Ningún cambio en el dispositivo: cero riesgo de dejar el equipo inutilizable.
- (−) Las apps ocultas para el usuario 0 pueden no exponer rutas con `pm path`; en ese
  caso se informa del error y no se extrae nada.
- (−) El tamaño de los archivos depende del paquete: una app grande puede tardar; el
  `adb pull` tiene timeout de 10 minutos por archivo.

## Verificado
Pruebas unitarias con un cliente ADB falso: `pm path` con base + split, deduplicación de
rutas, creación de la subcarpeta por paquete y escritura de ambos archivos. La suite del
escritorio queda en 73 tests.
