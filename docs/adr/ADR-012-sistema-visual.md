# ADR-012 — Sistema visual de la consola de escritorio

## Contexto
La v1 usaba el patrón por defecto de las herramientas ADB: fondo casi negro, un acento verde
ácido, tarjetas redondeadas idénticas y emojis como iconos. Ese lenguaje no distingue el
producto y compite con cualquier editor o terminal.

## Decisión

### Concepto
Una **consola de servicio**: la app se comporta como un instrumento de banco. Superficie de
papel frío, tinta, reglas de 1 px que separan secciones reales (no tarjetas flotantes) y un
único color de acción. El dispositivo es el espécimen; cada ajuste es una operación
etiquetada y reversible.

### Tokens
| Token | Valor | Uso |
|---|---|---|
| `--paper` | `#e8ecee` | fondo de la app |
| `--paper-2` | `#f1f4f5` | rail, consola, superficies secundarias |
| `--surface` | `#fcfdfd` | área de trabajo |
| `--ink` | `#0c161b` | texto principal |
| `--muted` | `#5b707c` | metadatos (contraste 4.8:1 sobre paper-2) |
| `--rule` / `--rule-faint` | `#d2dde0` / `#e3eaec` | separadores estructurales / divisores internos |
| `--teal` | `#0f4a58` | navegación activa, datos, estructura |
| `--orange` | `#b4430f` | única acción primaria |
| `--green` / `--amber` / `--red` | `#1b6f51` / `#8c5b0e` / `#9e2a22` | estado semántico |

Escala de espaciado en tokens (`--space-1` a `--space-7`, 4–40 px) y de texto
(`--text-meta` a `--text-figure`, 10.5–32 px). Las reglas usan `--rule-faint` dentro de un
bloque y `--rule` solo entre secciones reales; la elevación se reserva para overlays (menú y
modal) con dos capas de sombra, nunca para tarjetas.

### Tipografía
- **Archivo** (variable 400–700) para interfaz: grotesca de ingeniería, no Inter ni system-ui.
- **IBM Plex Mono** (400/500) para datos: comandos, paquetes, métricas, cifras tabulares.
- Escala 11 / 11.5 / 12.5 / 14 / 20 px. Sin etiquetas en mayúsculas ni eyebrows.
- Longitud de línea limitada a 66ch en párrafos.

### Estructura
- Rail de 212 px con marca tipográfica ("ADB" en caja) y navegación de texto.
- Barra superior de 58 px con título y metadatos en pills mono.
- Contenido en bandas de ancho completo separadas por reglas; radio 0 en secciones,
  3–4 px en controles. Sin sombras salvo en overlays (menú, modal), con dos capas.
- Tablas reales para datos (apps, mediciones), no grillas de tarjetas.
- Una sola entrada por pantalla (180 ms, opacidad y 4 px) y feedback de 120 ms en controles;
  ningún bucle salvo el barrido de búsqueda y el spinner funcional.

### Elemento memorable
El **medidor de salud segmentado** (22 segmentos) en la cabecera de Estado: traduce RAM,
CPU y presión térmica a una escala 0–100 donde 100 es mejor. La cifra en mono sobre la escala
y el medidor comparten el mismo eje; es el único elemento con movimiento propio (transición
de altura al llegar datos) y respeta `prefers-reduced-motion`.

### Pantalla de dispositivos
Tablero de descubrimiento en lugar de tarjetas apiladas:

- Conmutador de transporte compacto con el conteo de equipos por vía.
- Regla superior de 2 px (más fuerte que el resto) para marcar el tablero principal.
- Regla de escaneo de 2 px con un barrido tenue mientras se busca (`prefers-reduced-motion` lo detiene).
- Filas de dispositivo con modelo, IP en mono, estado en texto y acciones por equipo.
- Divulgación progresiva: vinculación por código, QR-USB y diagnóstico quedan en acordeones;
  solo lo que se usa a diario está visible.

### Semántica de color
- Naranja: solo la acción que cambia el dispositivo.
- Verde/ámbar/rojo: riesgo (regla izquierda de 3 px en Optimizar) y estado, nunca decoración.
- Teal: estructura y datos, nunca una llamada a la acción.

## Consecuencias
- (+) La interfaz se lee como herramienta profesional y no como plantilla.
- (+) El riesgo es visible sin leer badges; el estado no depende solo del color (texto + cifra).
- (−) Tema claro únicamente: en un cuarto oscuro puede resultar brillante. El modo oscuro
  queda como trabajo futuro con los mismos tokens invertidos.
- (−) La app Android conserva su tema Material oscuro; unificarla es una tarea aparte.
