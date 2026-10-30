# Auditoría de pantallas contra el sistema visual

Revisión de las 17 pantallas del escritorio contra `docs/adr/ADR-012-sistema-visual.md` y los
mockups `escritorio-01/02/03`. Se revisó el código, los tokens y capturas en claro/oscuro de
Dispositivos, Estado y el selector multi‑equipo.

## Resultado

| Pantalla | Estado | Nota |
|---|---|---|
| **Dispositivos** | Alineada con mockup 01 | Segmented USB/Wi‑Fi/QR, tabla de equipos, dirección manual, disclosures y recientes. |
| **Estado** | Alineada con mockup 02 | Banner de salud, métricas RAM/CPU/almacenamiento, tabla “Ahora”, diagnóstico, cambios recientes, acciones, equipo y otros equipos. |
| **Selector multi‑equipo** | Alineado con mockup 03 | Equipo activo, conectados, cambiar/desconectar y “Conectar otro”. |
| Apps | Cumple el sistema | Bandas planas, badges y lista; no hay mockup específico. |
| Optimizar | Cumple el sistema | Filas de plan con barra de riesgo a la izquierda. |
| Consola | Cumple el sistema | Panel de salida oscuro en ambos temas; título de sección “Comandos”. |
| Registro | Cumple el sistema | Controles densos, filtros y tabla mono; título “Entradas”. |
| Inspector | Cumple el sistema | Tablas de permisos, AppOps y componentes. |
| Ajustes del sistema | Cumple el sistema | Tabs y tabla editable; título “Tablas”. |
| Doze y energía | Cumple el sistema | Dos bandas planas: estado y acciones. |
| Archivos | Cumple el sistema | Breadcrumb, tabla y visor de texto; título “Explorador”. |
| Perfiles | Cumple el sistema | Lista, editor y plan por pasos. |
| Debloater | Cumple el sistema | Sugerencias con riesgo, selección y restaurar. |
| DPC | Cumple el sistema | Tabla de checks y acciones. |
| Launcher | Cumple el sistema | Bandas y acciones de sistema. |
| Root y sistema | Cumple el sistema | Diagnóstico y conversión de apps. |
| Flasheo y Magisk | Cumple el sistema | Respaldo, parcheo y fastboot. |
| Historial | Cumple el sistema | Journal global; undo solo para el equipo activo. |

## Hallazgos transversales

1. **Colores hardcodeados**: solo quedan `#ffffff`/`#000000` en el QR (necesario para que se
   pueda escanear) y los tokens de consola. El resto usa variables CSS y funciona en ambos temas.
2. **Superficies**: todas usan `.card` como banda plana con regla superior, sin sombras ni
   radios de tarjeta. Las sombras solo aparecen en overlays (menú y selector).
3. **Títulos duplicados**: varias pantallas de una sola sección repetían el título del topbar
   (“Consola ADB”, “Logcat”, “Archivos”, “Debloater”…). Se cambiaron por títulos de sección
   descriptivos (`Comandos`, `Entradas`, `Explorador`, `Sugerencias`, `Tablas`, etc.).
4. **Anchos**: `.screen > *` limita a 1120 px; Estado y Dispositivos respetan la retícula del
   mockup. En ventanas < 1180 px se ocultan los pills secundarios del topbar y la tabla de
   dispositivos pierde la columna “Vía” antes de romper el layout.
5. **Estados vacíos**: todas las pantallas de dispositivo muestran un estado vacío con acción
   cuando no hay equipo; el shell ni siquiera las monta si no hay dispositivo.
6. **Movimiento**: solo la entrada de pantalla y el barrido de búsqueda; `prefers-reduced-motion`
   desactiva ambos.

## Pendiente menor (no bloqueante)

- El cuerpo de Apps sigue usando filas con badges en lugar de una tabla con cabecera; es
  coherente con ADR-012, pero una tabla haría más fácil comparar sistema/usuario/estado.
- Algunas pantallas heredadas (Root, Flasheo, Launcher) conservan títulos de sección que
  repiten el nombre del topbar; se pueden normalizar en una pasada de copy.
- El CSS de `.banner`/`.metric` quedó sin uso tras el rediseño de Estado; se puede retirar
  cuando se confirme que ninguna pantalla lo necesita.

## Validación

- `pnpm typecheck`, `pnpm test` (298) y `pnpm build` en verde.
- Capturas revisadas: Dispositivos claro/oscuro, Wi‑Fi, QR; Estado claro/oscuro; selector
  multi‑equipo claro/oscuro.
- La revisión visual de las pantallas restantes se apoya en que no tienen colores fuera de
  tokens ni componentes con sombra/radio ajenos al sistema.
