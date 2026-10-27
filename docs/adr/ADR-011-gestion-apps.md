# ADR-011 — Gestión de aplicaciones y eliminación sin root

## Contexto
El usuario necesita ver las apps instaladas separadas por sistema/usuario y poder eliminar
las que no sirven, sin root y sin arriesgar el arranque del equipo.

## Decisión

### Listado
Cuatro consultas en paralelo sobre `adb shell`:

| Comando | Uso |
|---|---|
| `pm list packages -3` | apps de usuario |
| `pm list packages -s` | apps de sistema |
| `pm list packages -d` | deshabilitadas (badge) |
| `pm list packages -u -s` | sistema incluyendo ocultas (`-u`) |

Las ocultas se calculan como `-u -s` menos `-s`: así aparecen en su propia sección y se
pueden restaurar.

### Eliminación
| Tipo | Comando | Reversible |
|---|---|---|
| Usuario | `pm uninstall <pkg>` | ❌ no |
| Sistema | `pm uninstall --user 0 <pkg>` | ✅ `cmd package install-existing <pkg>` |

La app de sistema **no se borra de la partición**: se oculta para el usuario 0, que es el
equivalente seguro a "desinstalar bloatware". El journal registra la operación con su undo.

### Protección
`shared/apps/protected-packages.json` lista paquetes que nunca se tocan (SystemUI,
launcher, settings, package installer, GMS, Play Store, telefonía, Wi‑Fi, Bluetooth, NFC).
La lista la consumen ambos clientes; el botón queda deshabilitado y el backend vuelve a
validar antes de ejecutar.

### Restaurar y habilitar
- Ocultas → `cmd package install-existing <pkg>`.
- Deshabilitadas → `pm enable <pkg>`.

## Consecuencias
- (+) Cero root; el peor caso en una app de sistema es reversible.
- (−) Una app de usuario desinstalada no se puede recuperar desde la app.
- (−) En dispositivos con varios usuarios (Secure Folder / usuario 150), `pm` escribe
  `SecurityException` en **stderr** aunque la salida válida llegue por stdout. El cliente
  solo trata como error los fallos de transporte y `error:` en stdout.

## Verificado
Con un Samsung SM‑S918B real: 482 apps de sistema, 436 de usuario, 15 protegidas
detectadas correctamente, listado estable pese al ruido de stderr del usuario 150.
