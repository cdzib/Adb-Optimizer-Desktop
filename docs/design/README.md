# Propuesta de navegación por secciones (escritorio)

Tres estados de la misma ventana, no tres diseños distintos. La app pasa de una vista de
conexión a un espacio de trabajo con secciones solo cuando hay un equipo que responde. El
cuarto archivo no es un estado nuevo: es el frame conectado en tema oscuro.

| Archivo | Estado | Qué muestra |
|---|---|---|
| `escritorio-01-sin-dispositivo.svg/.png` | Sin equipo | Vista previa, conexión USB/Wi‑Fi/QR, recientes y las secciones que se habilitarán |
| `escritorio-02-conectado.svg/.png` | Equipo conectado | Rail agrupado por trabajo, Estado con métricas, acciones y cambios recientes |
| `escritorio-03-multidispositivo.svg/.png` | Varios equipos | Selector de equipo, segundo equipo conectado, disponibles en la red y “Conectar otro” |
| `escritorio-04-oscuro.svg/.png` | Equipo conectado · oscuro | El mismo frame que `02` con los tokens de `[data-theme='dark']`: rail, métricas, acciones y cambios recientes |
| `escritorio-propuesta.svg/.png` | Secuencia | Los tres estados apilados con notas de flujo |

Los SVG embeben Archivo e IBM Plex Mono desde `desktop/src/renderer/assets/fonts/`. Los PNG
se renderizan con Electron a 2× (2880 × 1800 por estado) para revisar detalles.

`escritorio-04-oscuro.svg` no es un diseño aparte: `generate.py` dibuja una sola vez el frame
conectado y aplica la paleta oscura, que usa **exactamente** los mismos tokens que
`:root[data-theme='dark']` en `desktop/src/renderer/styles.css` (ver
`docs/adr/ADR-018-temas.md`). Los únicos valores propios del mockup son los auxiliares que no
son tokens —fondo del tablero y semáforo del chrome— y se eligen para tener contraste sobre
la paleta oscura, no sobre la clara.

## Agrupación de secciones

La app Android agrupa Herramientas en **Diagnóstico**, **Sistema** y **Apps**. El escritorio
tiene más superficie, así que añade un grupo para el trabajo diario y conserva los otros dos:

| Grupo | Secciones | Por qué |
|---|---|---|
| **Equipo** | Estado, Optimizar, Aplicaciones, Perfiles, Debloater, Archivos | Lo que se usa en cada sesión y depende del equipo activo |
| **Diagnóstico** | Consola, Registro, Inspector, Ajustes del sistema, Doze y energía | Herramientas de lectura o cambios puntuales |
| **Sistema** | Launcher, Root y sistema, Flasheo y Magisk, DPC | Operaciones avanzadas, con más riesgo y menos frecuencia |
| **Conexión** | Dispositivos, Historial | Siempre disponible; no depende de un equipo activo |

Los contadores del rail (`6`, `5`, `4`) evitan que el usuario tenga que abrir el grupo para
saber cuánto hay. No se muestran quince entradas sueltas.

## Reglas de interacción

1. **Sin equipo (`device === null`)**: el rail solo muestra Dispositivos e Historial. El área
   principal es la vista de conexión. Las secciones no se montan, no se deshabilitan una a una
   ni ejecutan lecturas en segundo plano.
2. **Primera conexión**: al confirmar un equipo se montan las secciones y se abre **Estado**.
   La selección activa se marca con una barra teal de 3 px y fondo de superficie.
3. **Más equipos**: el chip del topbar y la tarjeta del rail abren el mismo selector. “Añadir”
   y “Conectar otro equipo” llevan a la vista de conexión sin perder los equipos ya conectados.
4. **Un solo equipo activo**: los demás quedan conectados y en espera. Cambiar de equipo
   invalida métricas, plan y selección pendientes del anterior; no se mezclan datos.
5. **Desconectar el último equipo** devuelve la app al estado 01, no a un dashboard vacío.
6. **Reconexión**: la lista de recientes permite volver a un equipo sin repetir IP ni puerto.

## Implementación sugerida

`App.tsx` ya concentra el estado de navegación. La propuesta encaja sin router:

```ts
type Group = 'equipo' | 'diagnostico' | 'sistema' | 'conexion'
type Screen = 'devices' | 'dashboard' | ... // los actuales

interface NavEntry {
  id: Screen
  group: Group
  labelKey: string
  requiresDevice: boolean
}

const [devices, setDevices] = useState<DeviceInfo[]>([])
const [activeId, setActiveId] = useState<string | null>(null)
```

- `devices.length === 0` → render `DevicesScreen` como workspace de conexión; no renderizar
  el resto de pantallas.
- `devices.length > 0` → renderizar el rail agrupado y la pantalla activa.
- El selector es un `popover` con `role="menu"`, foco atrapado y `Esc` para cerrar.
- Al cambiar `activeId`, limpiar `DeviceMetrics`, plan de optimización y formularios abiertos.
- Reutilizar `DevicesScreen` para el estado 01 y para “Añadir equipo”; evitar duplicar el
  flujo de conexión.
- Los tokens, tipografía y reglas son los de `docs/adr/ADR-012-sistema-visual.md`; no se
  introduce ningún color ni radio nuevo.

## Lo que la propuesta evita

- Mostrar las quince secciones deshabilitadas antes de conectar: parece una app rota.
- Un dashboard vacío con tarjetas en cero: no explica qué hacer.
- Ocultar “Añadir equipo” dentro de un menú de ajustes: conectar otro equipo es una acción
  de primer nivel.
- Un segundo equipo activo en paralelo: los comandos y el journal dejarían de ser
  inequívocos.

## Regenerar

```bash
python3 docs/design/generate.py
cd desktop
for f in ../docs/design/escritorio-*.svg; do
  pnpm exec electron ../docs/design/render.cjs "$f"
done
```

El render usa Electron en modo offscreen y captura a 2×. Abrir cada SVG en un proceso
separado evita el fallo intermitente de GPU al encadenar capturas.

## Estado de implementación

- Implementado: shell de navegación (`App.tsx`), rail agrupado, vista de conexión alineada con
  el mockup 01, **Estado alineado con el mockup 02** (banner de salud, métricas, tabla “Ahora”,
  diagnóstico, cambios recientes, acciones, equipo y otros equipos), selector multi‑equipo,
  historial global y los tres temas.
- La auditoría del resto de pantallas está en
  [`auditoria-pantallas.md`](auditoria-pantallas.md).
- El tema oscuro del mockup (`escritorio-04-oscuro`) usa exactamente los tokens de
  `:root[data-theme='dark']`.
