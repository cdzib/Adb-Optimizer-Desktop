# ADR-018 — Tema claro, oscuro y sistema

## Contexto

ADR-012 definió la consola con una sola paleta clara ("papel frío, tinta y reglas de 1 px") y
dejó el modo oscuro como trabajo futuro. La consola se usa en sesiones largas, muchas veces en
un cuarto con poca luz o junto a una terminal oscura; una superficie de papel a brillo completo
resulta incómoda y rompe la sensación de instrumento.

Los usuarios pidieron explícitamente las tres opciones habituales: **claro**, **oscuro** y
**seguir al sistema**. El sistema operativo ya expone esa preferencia (`prefers-color-scheme`),
así que la app no necesita inventar un ajuste propio por defecto.

Restricciones: la app Electron no tiene backend ni cuentas, el renderer vive aislado
(contextIsolation, sin Node) y el resto de la app Android es independiente. El tema no puede
convertirse en estado compartido ni en una operación de disco.

## Decisión

### Preferencia

| Aspecto | Decisión |
|---|---|
| Valores | `'system' \| 'light' \| 'dark'` (`ThemePreference`) |
| Almacenamiento | `localStorage`, clave `adb-optimizer.theme` |
| Defecto | `'system'` si no hay valor o el valor guardado no es válido |
| Resolución | `resolveTheme(preference, systemDark)` → `'light' \| 'dark'` |
| Aplicación | `document.documentElement.dataset.theme = resuelto` y `style.colorScheme = resuelto` |

- **`data-theme` en `<html>`**, no en el contenedor de React: los tokens viven en
  `:root[data-theme='dark']`, así que el cambio de tema es un cambio de variables CSS y no un
  re-render de la app.
- **`color-scheme`** se sincroniza con el tema resuelto para que los controles nativos
  (scrollbars, `select`, autofill, diálogos) no queden claros dentro de una ventana oscura.
- **`matchMedia('(prefers-color-scheme: dark)')`** resuelve `system` y se escucha con
  `addEventListener('change')`; con preferencia manual el listener no se registra. El modo
  sistema sigue al SO **en vivo**, sin reiniciar la app.
- **Aplicación antes de renderizar**: `main.tsx` llama `applyTheme(readThemePreference())`
  antes de `createRoot(...).render(...)`, de modo que el primer frame ya tiene el tema final y
  no hay destello claro al arrancar en oscuro.
- **Persistencia tolerante**: leer/escribir `localStorage` está envuelto en `try/catch`
  (storage bloqueado o lleno). Si falla, el tema sigue funcionando en memoria durante la sesión.
- **Control**: `ThemeToggle` es un `role="group"` con tres botones (monitor, sol, luna),
  `aria-pressed` y `aria-label` en español. No es un desplegable: son tres estados y caben.

### Tokens

La misma estructura de ADR-012, con los valores invertidos. El tema oscuro **no** introduce
tokens nuevos: reutiliza los existentes.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--paper` | `#e8ecee` | `#0d1519` | fondo de la app |
| `--paper-2` | `#f1f4f5` | `#121d22` | rail, chrome superior, pie, consola |
| `--surface` | `#fcfdfd` | `#162228` | área de trabajo, controles |
| `--ink` | `#0c161b` | `#e7eef0` | texto principal |
| `--ink-2` | `#31454d` | `#b6c6cc` | texto secundario, filas de datos |
| `--muted` | `#5b707c` | `#8ba0a9` | metadatos, etiquetas |
| `--rule` | `#d2dde0` | `#2a3c44` | separadores entre secciones |
| `--rule-faint` | `#e3eaec` | `#213138` | divisores internos, pistas de progreso |
| `--rule-strong` | `#a6b7be` | `#3d555f` | regla de 2 px de la banda principal |
| `--teal` | `#0f4a58` | `#6fb7c4` | estructura, datos, navegación activa |
| `--orange` | `#b4430f` | `#b94b16` | única acción primaria |
| `--orange-ink` | `#fffaf6` | `#fffaf6` | texto sobre naranja |
| `--green` | `#1b6f51` | `#4fb98b` | estado correcto |
| `--amber` | `#8c5b0e` | `#d9a441` | advertencia / sin autorizar |
| `--red` | `#9e2a22` | `#e06a5f` | error / operación destructiva |
| `--focus` | `#0b6bcb` | `#6aa9ff` | anillo de foco de teclado |
| `--console-bg` / `--console-text` | `#0f1416` / `#cfe3e6` | iguales | la consola ya era oscura |

Los derivados (`--input-bg`, `--track`, `--teal-wash-*`, `--green-text`, `--amber-text`,
`--red-text`, `--selection`, `--*-border`) se redefinen en el mismo bloque oscuro para que los
lavados y bordes semánticos tengan la opacidad correcta sobre superficie oscura; los textos
semánticos se aclaran (`--green-text: #7fd7af`, `--amber-text: #e8bd6a`,
`--red-text: #ff9a91`) porque el tono de marca sobre fondo oscuro no alcanza contraste.

### Contraste medido (oscuro)

| Par | Ratio | Nota |
|---|---|---|
| `ink` sobre `paper` | 15.7:1 | AAA |
| `ink` sobre `surface` | 13.8:1 | AAA |
| `ink-2` sobre `surface` | 9.2:1 | AAA |
| `muted` sobre `surface` | 5.95:1 | AA texto normal |
| `muted` sobre `paper-2` | 6.29:1 | AA texto normal |
| `teal` sobre `surface` | 7.15:1 | AA/AAA |
| `green` / `amber` sobre `surface` | 6.68:1 / 7.22:1 | AA |
| `red` sobre `surface` | 4.94:1 | AA |
| `orange-ink` sobre `orange` | 4.96:1 | AA texto normal |

El naranja oscuro (`#b94b16`) mantiene 4.96:1 con `--orange-ink`, suficiente para AA en texto
normal. Se eligió un tono ligeramente más oscuro que el claro (`#b4430f`) para no perder
contraste sobre la superficie oscura; el hover baja a `#a84212`. El color no es la única señal
del botón primario: también lo distinguen la etiqueta, la posición y el borde.

### Excepciones deliberadas

- **QR**: `QRCodeSVG` fuerza `bgColor="#ffffff"` y `fgColor="#000000"` en ambos temas. Un QR
  invertido o con transparencia falla al escanear con muchas cámaras; el módulo blanco del QR
  no es un color de superficie y no sigue al tema.
- **Consola y tramas de terminal**: `--console-bg` / `--console-text` son iguales en ambos
  temas. La consola ya era oscura por decisión (ADR-012) y sigue siéndolo; lo que cambia es el
  marco que la rodea.
- **Códigos y métricas en mono** usan `--ink`/`--ink-2`, nunca un gris fijo: si se fijaran,
  quedarían ilegibles en uno de los dos temas.
- **Semáforo del chrome de la ventana** (los tres puntos de la barra superior) es decoración del
  mockup, no un token de la app; en el SVG oscuro se apaga a `#8a4d4f`, `#8a7340`, `#44705c`.

### Mockup

`docs/design/escritorio-04-oscuro.svg/.png` es el frame conectado con la paleta oscura. No es
un diseño nuevo: `generate.py` dibuja una sola vez la geometría y aplica el mapa de tokens
(`LIGHT` / `DARK`), así que cualquier cambio de layout se refleja en ambos temas. Los PNG se
renderizan a 2× (2880 × 1800) con `docs/design/render.cjs`.

## Consecuencias

- (+) El usuario elige claro, oscuro o sistema; el defecto sigue al SO sin configuración.
- (+) Cambiar de tema no re-renderiza la app ni recarga la ventana: es un cambio de variables
  CSS más `color-scheme`, sin parpadeo y sin costo de layout.
- (+) No hay IPC nuevo: el tema no toca `main`, el journal ni el preload. Cero superficie de
  privilegio añadida.
- (+) Los componentes no conocen el tema; cualquiera que use tokens funciona en ambos.
- (−) La preferencia vive en `localStorage` del renderer: es **por ventana y por origen**. No se
  sincroniza entre equipos ni entre instalaciones, y borrar los datos de la app la restablece a
  `system`.
- (−) Con preferencia manual, un cambio de tema del SO no afecta la app (es intencional, pero
  puede sorprender); el usuario debe volver a "Sistema" para seguir al SO.
- (−) Todo color nuevo debe declararse dos veces (claro y oscuro). Un valor fijo en CSS o en un
  componente es un defecto: se ve bien en un tema y mal en el otro.
- (−) La app Android conserva su tema Material; la paridad visual entre clientes sigue siendo
  trabajo aparte (ADR-017).

## Validación

- `desktop/tests/theme.test.ts`: resolución `system`/manual, lectura con valor inválido o sin
  storage, escritura de la clave, `data-theme` + `color-scheme` en `applyTheme`, tolerancia a
  `window`/`document` ausentes y alta/baja del listener de `matchMedia`.
- `pnpm typecheck` y `pnpm build` en verde (los tres valores de `ThemePreference` están tipados;
  el build de Electron no incluye ramas de tema en `main`).
- Revisión del mockup: `escritorio-04-oscuro.png` a 2880 × 1800 sin textos ilegibles,
  solapamientos ni restos de la paleta clara (los tokens claros no aparecen en el SVG oscuro) y
  con los botones primarios naranja conservando texto `--orange-ink`.
- El SVG se valida con `xmllint --noout` y se regenera con `python3 docs/design/generate.py`,
  que también reproduce los tres estados claros sin cambios.
