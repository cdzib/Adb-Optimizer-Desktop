#!/usr/bin/env python3
"""Genera las propuestas SVG del escritorio: sin equipo, conectado, multi-equipo y oscuro.

Los tokens y la tipografía salen de docs/adr/ADR-012-sistema-visual.md y de
docs/adr/ADR-018-temas.md. Las fuentes reales de la app se embeben en el SVG para que el
PNG conserve la identidad visual. La geometría es única: cada estado se dibuja una vez y
el tema oscuro solo sustituye la paleta (los mismos tokens de `[data-theme='dark']`).
"""
from __future__ import annotations

import base64
import os
from html import escape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT_DIR = os.path.join(ROOT, "desktop", "src", "renderer", "assets", "fonts")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- paletas
# Tokens de `desktop/src/renderer/styles.css`. Los auxiliares (tablero, semáforo del
# chrome, washes) no son tokens de la app: existen solo para el mockup y deben tener
# contraste con la paleta de su tema.
LIGHT = dict(
    PAPER="#e8ecee",
    PAPER2="#f1f4f5",
    SURFACE="#fcfdfd",
    INK="#0c161b",
    INK2="#31454d",
    MUTED="#5b707c",
    RULE="#d2dde0",
    RULE_FAINT="#e3eaec",
    RULE_STRONG="#a6b7be",
    TEAL="#0f4a58",
    ORANGE="#b4430f",
    ORANGE_INK="#fffaf6",
    GREEN="#1b6f51",
    AMBER="#8c5b0e",
    RED="#9e2a22",
    # auxiliares del mockup
    BOARD="#dfe5e7",
    DOT_CLOSE="#d9a3a3",
    DOT_MIN="#e0c58f",
    DOT_ZOOM="#a9c9b4",
    WASH_GREEN="#e4efe9",
    SHADOW="#0c161b",
    SHIMMER_A="#e3eaec",
    SHIMMER_B="#d2dde0",
)

DARK = dict(
    PAPER="#0d1519",
    PAPER2="#121d22",
    SURFACE="#162228",
    INK="#e7eef0",
    INK2="#b6c6cc",
    MUTED="#8ba0a9",
    RULE="#2a3c44",
    RULE_FAINT="#213138",
    RULE_STRONG="#3d555f",
    TEAL="#6fb7c4",
    ORANGE="#b94b16",
    ORANGE_INK="#fffaf6",
    GREEN="#4fb98b",
    AMBER="#d9a441",
    RED="#e06a5f",
    # auxiliares del mockup: el tablero baja un paso más que paper para que el marco
    # de la ventana se lea, y el semáforo del chrome se apaga a tonos de la paleta.
    BOARD="#080f12",
    DOT_CLOSE="#8a4d4f",
    DOT_MIN="#8a7340",
    DOT_ZOOM="#44705c",
    WASH_GREEN="#183229",
    SHADOW="#000000",
    SHIMMER_A="#213138",
    SHIMMER_B="#2a3c44",
)


def apply_palette(palette):
    """Publica la paleta como globales para que las primitivas la lean al dibujar."""
    globals().update(palette)


apply_palette(LIGHT)

UI = "'Archivo', Helvetica, sans-serif"
MONO = "'Plex Mono', Menlo, monospace"

RAIL = 212
TOP = 32
TOPBAR = 58
CONTENT_Y = TOP + TOPBAR


def _font(name: str, filename: str, weight: str) -> str:
    path = os.path.join(FONT_DIR, filename)
    data = base64.b64encode(open(path, "rb").read()).decode("ascii")
    return (
        "@font-face{font-family:'%s';src:url(data:font/woff2;base64,%s) "
        "format('woff2');font-weight:%s;font-style:normal;font-display:block;}"
        % (name, data, weight)
    )


def defs():
    return (
        "<defs><style>"
        + _font("Archivo", "archivo-var.woff2", "100 900")
        + _font("Plex Mono", "plex-mono-400.woff2", "400")
        + _font("Plex Mono", "plex-mono-500.woff2", "500")
        + "</style>"
        f'<filter id="overlay" x="-30%" y="-30%" width="160%" height="160%">'
        f'<feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="{SHADOW}" flood-opacity="0.13"/>'
        f'<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="{SHADOW}" flood-opacity="0.10"/>'
        "</filter>"
        '<linearGradient id="scan" x1="0" x2="1" y1="0" y2="0">'
        f'<stop offset="0" stop-color="{TEAL}" stop-opacity="0"/>'
        f'<stop offset="0.45" stop-color="{TEAL}" stop-opacity="0.55"/>'
        f'<stop offset="0.55" stop-color="{TEAL}" stop-opacity="0.55"/>'
        f'<stop offset="1" stop-color="{TEAL}" stop-opacity="0"/>'
        "</linearGradient>"
        '<linearGradient id="shimmer" x1="0" x2="1" y1="0" y2="0">'
        f'<stop offset="0" stop-color="{SHIMMER_A}" stop-opacity="0"/>'
        f'<stop offset="0.5" stop-color="{SHIMMER_B}" stop-opacity="1"/>'
        f'<stop offset="1" stop-color="{SHIMMER_A}" stop-opacity="0"/>'
        "</linearGradient>"
        "</defs>"
    )


# --------------------------------------------------------------------------- primitives
def R(x, y, w, h, fill, stroke=None, sw=1, rx=0, opacity=1, dash=None):
    extra = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    if dash:
        extra += f' stroke-dasharray="{dash}"'
    if opacity != 1:
        extra += f' opacity="{opacity}"'
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
        f'fill="{fill}"{extra}/>'
    )


def L(x1, y1, x2, y2, stroke=None, sw=1, dash=None):
    stroke = stroke or RULE
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
        f'stroke="{stroke}" stroke-width="{sw}"{extra}/>'
    )


def T(x, y, text, size=12, fill=None, weight=400, font=None, anchor="start", opacity=1, ls=0):
    fill = fill or INK
    font = font or UI
    extra = f' letter-spacing="{ls}"' if ls else ""
    if opacity != 1:
        extra += f' opacity="{opacity}"'
    return (
        f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
        f'dominant-baseline="middle"{extra}>{escape(str(text))}</text>'
    )


def Dot(cx, cy, r, fill, ring=None):
    s = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'
    if ring:
        s += f'<circle cx="{cx}" cy="{cy}" r="{r + 3}" fill="none" stroke="{ring}" stroke-width="1"/>'
    return s


def Chev(x, y, color=None, size=4):
    color = color or MUTED
    return (
        f'<path d="M{x} {y - size} l{size} {size} l-{size} {size}" fill="none" '
        f'stroke="{color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def PillWidth(label, size=10.5):
    return len(str(label)) * size * 0.60 + 18


def Pill(x, y, label, fill=None, stroke=None, color=None, size=10.5, h=22, font=None):
    fill = fill or SURFACE
    stroke = stroke or RULE
    color = color or INK2
    font = font or UI
    w = PillWidth(label, size)
    return w, (
        R(x, y - h / 2, w, h, fill, stroke, 1, h / 2)
        + T(x + w / 2, y, label, size, color, 500, font, "middle")
    )


def Button(x, y, w, h, label, kind="ghost", size=11.5, font=None):
    font = font or UI
    if kind == "primary":
        fill, stroke, color = ORANGE, ORANGE, ORANGE_INK
    elif kind == "teal":
        fill, stroke, color = SURFACE, TEAL, TEAL
    else:
        fill, stroke, color = SURFACE, RULE, INK
    return (
        R(x, y, w, h, fill, stroke, 1, 3)
        + T(x + w / 2, y + h / 2, label, size, color, 600, font, "middle")
    )


def Nav(y, label, active=False, muted=False, x=0, w=RAIL, size=12.5, indent=18):
    s = ""
    if active:
        s += R(x, y - 13, w, 26, SURFACE)
        s += R(x, y - 13, 3, 26, TEAL)
    color = INK if active else (MUTED if muted else INK2)
    weight = 600 if active else 400
    return s + T(x + indent, y, label, size, color, weight)


def Group(y, label, x=18, count=None, color=None):
    color = color or MUTED
    s = T(x, y, label, 10.5, color, 600)
    if count is not None:
        s += T(RAIL - 18, y, str(count), 9.5, MUTED, 400, MONO, "end")
    return s


def Chrome(title):
    p = [R(0, 0, 1440, 900, PAPER)]
    p.append(R(0, 0, 1440, TOP, PAPER2))
    p.append(L(0, TOP, 1440, TOP, RULE))
    for i, color in enumerate((DOT_CLOSE, DOT_MIN, DOT_ZOOM)):
        p.append(f'<circle cx="{18 + i * 16}" cy="16" r="5" fill="{color}"/>')
    p.append(T(72, 16, "ADB Optimizer", 11, MUTED, 600))
    p.append(T(166, 16, "Consola de servicio", 10.5, MUTED, 400))
    p.append(T(1416, 16, "propuesta de diseño", 10, MUTED, 400, MONO, "end"))
    return p


def RailBase():
    p = [R(0, TOP, RAIL, 900 - TOP, PAPER2)]
    p.append(L(RAIL, TOP, RAIL, 900, RULE))
    p.append(R(18, 50, 34, 34, SURFACE, TEAL, 1, 2))
    p.append(T(35, 67, "ADB", 11.5, TEAL, 700, UI, "middle"))
    p.append(T(62, 61, "Optimizer", 14, INK, 700))
    p.append(T(62, 77, "Consola de servicio", 10.2, MUTED, 400))
    p.append(L(18, 104, 194, 104, RULE_FAINT))
    return p


def Topbar(title, right):
    p = [R(RAIL, TOP, 1440 - RAIL, TOPBAR, SURFACE)]
    p.append(L(RAIL, TOP + TOPBAR, 1440, TOP + TOPBAR, RULE))
    p.append(T(240, 61, title, 20, INK, 700))
    p.extend(right)
    return p


def Content():
    return R(RAIL, CONTENT_Y, 1440 - RAIL, 900 - CONTENT_Y, SURFACE)


def FooterLog(text="log  ·  device:info  ·  24 ms", right="1 equipo activo"):
    return (
        R(RAIL, 864, 1440 - RAIL, 36, PAPER2)
        + L(RAIL, 864, 1440, 864, RULE)
        + T(240, 882, text, 10, MUTED, 400, MONO)
        + T(1416, 882, right, 10, MUTED, 400, MONO, "end")
    )


# --------------------------------------------------------------------------- frame 01
def frame_empty():
    p = Chrome("Dispositivos")
    p.extend(RailBase())

    # rail: only connection + preview of the groups that will appear
    p.append(Nav(126, "Dispositivos", active=True))
    p.append(Nav(160, "Historial", muted=True))
    p.append(Group(208, "Secciones"))
    p.append(R(12, 222, 188, 98, "none", RULE, 1, 3, 1, "3 3"))
    p.append(T(26, 246, "Equipo", 11.5, MUTED, 500))
    p.append(T(186, 246, "6", 9.5, MUTED, 400, MONO, "end"))
    p.append(T(26, 272, "Diagnóstico", 11.5, MUTED, 500))
    p.append(T(186, 272, "5", 9.5, MUTED, 400, MONO, "end"))
    p.append(T(26, 298, "Sistema", 11.5, MUTED, 500))
    p.append(T(186, 298, "4", 9.5, MUTED, 400, MONO, "end"))
    p.append(T(18, 336, "Se crean al conectar", 10, MUTED, 400))
    p.append(L(18, 826, 194, 826, RULE_FAINT))
    p.append(Dot(22, 850, 3.5, RULE_STRONG))
    p.append(T(34, 850, "Sin dispositivo", 11.5, INK2, 600))
    p.append(T(34, 868, "0 equipos conectados", 10, MUTED, 400))

    p.extend(Topbar("Dispositivos", []))
    w, pill = Pill(1170, 61, "Sin conexión", PAPER2, RULE, AMBER)
    p.append(pill)
    p.append(Button(1282, 44, 134, 34, "Historial"))

    # hero
    p.append(T(240, 146, "Conecta un equipo para empezar", 28, INK, 700))
    p.append(T(240, 178, "Elige USB, Wi‑Fi o vinculación por código. Las secciones aparecen cuando el equipo responde;", 12.5, MUTED, 400))
    p.append(T(240, 196, "nada se ejecuta antes de que elijas una.", 12.5, MUTED, 400))
    p.append(L(240, 216, 992, 216, RULE_STRONG, 2))

    # connection board
    p.append(T(240, 238, "Conexión", 14, INK, 700))
    # segmented transport
    p.append(R(760, 224, 232, 30, PAPER2, RULE, 1, 3))
    p.append(R(762, 226, 76, 26, SURFACE, None, 0, 2))
    p.append(T(800, 239, "USB", 10.5, INK, 600, UI, "middle"))
    p.append(T(876, 239, "Wi‑Fi", 10.5, MUTED, 500, UI, "middle"))
    p.append(T(950, 239, "QR", 10.5, MUTED, 500, UI, "middle"))

    p.append(T(240, 266, "Equipos detectados", 12, INK, 600))
    p.append(Button(884, 254, 108, 26, "Actualizar", size=10.5))
    p.append(L(240, 280, 992, 280, RULE))
    p.append(T(240, 294, "Equipo", 9.5, MUTED, 500))
    p.append(T(548, 294, "Vía", 9.5, MUTED, 500))
    p.append(T(638, 294, "Estado", 9.5, MUTED, 500))
    p.append(L(240, 306, 992, 306, RULE_FAINT))

    # row 1: available
    p.append(Dot(249, 332, 3.5, GREEN))
    p.append(T(262, 326, "Chromecast HD", 12.5, INK, 600))
    p.append(T(262, 344, "emulator-5554 · Android TV", 10, MUTED, 400, MONO))
    p.append(T(548, 332, "USB", 11, INK2, 400))
    p.append(Dot(641, 332, 3, GREEN))
    p.append(T(651, 332, "Listo para conectar", 10.5, GREEN, 500))
    p.append(Button(864, 318, 128, 30, "Conectar", "primary"))
    p.append(L(240, 364, 992, 364, RULE_FAINT))

    # row 2: network, needs authorization
    p.append(Dot(249, 390, 3.5, AMBER))
    p.append(T(262, 384, "TV dormitorio", 12.5, INK, 600))
    p.append(T(262, 402, "192.168.1.60:5555", 10, MUTED, 400, MONO))
    p.append(T(548, 390, "Wi‑Fi", 11, INK2, 400))
    p.append(Dot(641, 390, 3, AMBER))
    p.append(T(651, 390, "Sin autorizar", 10.5, AMBER, 500))
    p.append(Button(864, 376, 128, 30, "Reintentar"))
    p.append(L(240, 422, 992, 422, RULE_FAINT))

    # row 3: scanning
    p.append(T(249, 442, "Buscando equipos en la red local…", 10.5, MUTED, 400))
    p.append(R(240, 454, 700, 2, "url(#scan)", None, 0, 0))
    p.append(R(240, 466, 210, 6, "url(#shimmer)", None, 0, 3))
    p.append(R(458, 466, 120, 6, RULE_FAINT, None, 0, 3))
    p.append(R(586, 466, 170, 6, RULE_FAINT, None, 0, 3))

    # manual address
    p.append(T(240, 506, "Dirección manual", 10.5, MUTED, 500))
    p.append(R(240, 518, 300, 36, SURFACE, RULE, 1, 3))
    p.append(T(252, 536, "192.168.1.42", 11.5, INK2, 400, MONO))
    p.append(T(552, 536, ":", 11.5, MUTED, 400, MONO, "middle"))
    p.append(R(562, 518, 86, 36, SURFACE, RULE, 1, 3))
    p.append(T(574, 536, "5555", 11.5, INK2, 400, MONO))
    p.append(Button(660, 518, 126, 36, "Conectar", "primary"))
    p.append(T(240, 566, "Activa la depuración por red en la TV antes de conectar.", 10.5, MUTED, 400))

    # disclosures
    rows = [
        ("Vincular con código de 6 dígitos", "IP, puerto de vinculación y el código que muestra el equipo."),
        ("Vincular con QR", "El equipo escanea el QR desde Depuración inalámbrica."),
        ("Activar Wi‑Fi desde USB", "Pasa un equipo conectado por cable a modo red sin escribir IP."),
    ]
    y = 596
    for title, hint in rows:
        p.append(T(240, y, title, 11.5, INK, 600))
        p.append(T(240, y + 16, hint, 10.5, MUTED, 400))
        p.append(Chev(978, y + 8))
        p.append(L(240, y + 32, 992, y + 32, RULE_FAINT))
        y += 44

    # recent
    p.append(T(240, 744, "Recientes", 12, INK, 600))
    p.append(T(982, 744, "Ver todo", 10.5, TEAL, 500, UI, "end"))
    p.append(T(240, 770, "TV del salón", 11.5, INK, 600))
    p.append(T(360, 770, "192.168.1.42:5555", 10, MUTED, 400, MONO))
    p.append(T(634, 770, "hace 2 h", 10, MUTED, 400))
    p.append(Button(864, 758, 128, 26, "Conectar", size=10.5))
    p.append(L(240, 788, 992, 788, RULE_FAINT))
    p.append(T(240, 810, "Pixel 7", 11.5, INK, 600))
    p.append(T(360, 810, "USB · R58M31…", 10, MUTED, 400, MONO))
    p.append(T(634, 810, "ayer", 10, MUTED, 400))
    p.append(Button(864, 798, 128, 26, "Conectar", size=10.5))

    # right preview panel
    p.append(L(1020, 216, 1416, 216, RULE_STRONG, 2))
    p.append(T(1020, 242, "Lo que se habilita", 16, INK, 700))
    p.append(T(1020, 264, "15 secciones en tres grupos. Se crean al conectar.", 11, MUTED, 400))

    groups = [
        ("Equipo", ["Estado", "Optimizar", "Aplicaciones", "Perfiles", "Debloater", "Archivos"]),
        ("Diagnóstico", ["Consola", "Registro", "Inspector", "Ajustes del sistema", "Doze y energía"]),
        ("Sistema", ["Launcher", "Root y sistema", "Flasheo y Magisk", "DPC"]),
    ]
    y = 300
    for title, items in groups:
        p.append(T(1020, y, title, 10.5, TEAL, 600))
        p.append(T(1416, y, str(len(items)), 9.5, MUTED, 400, MONO, "end"))
        y += 22
        for item in items:
            p.append(R(1020, y - 3, 6, 6, RULE, None, 0, 0))
            p.append(T(1036, y, item, 11.2, MUTED, 400))
            y += 22
        y += 14

    p.append(R(1020, 764, 396, 66, PAPER2, RULE_FAINT, 1, 2))
    p.append(R(1020, 764, 3, 66, TEAL))
    p.append(T(1036, 786, "La primera sección es Estado.", 11.5, INK, 600))
    p.append(T(1036, 804, "Desde ahí puedes optimizar, revisar apps o abrir", 10.5, MUTED, 400))
    p.append(T(1036, 819, "Herramientas sin perder el equipo activo.", 10.5, MUTED, 400))

    p.append(T(1020, 856, "Sin dispositivo · 0 equipos", 10, MUTED, 400, MONO))
    p.append(FooterLog("log  ·  esperando conexión", "0 equipos"))
    return p


# --------------------------------------------------------------------------- frame 02
def rail_connected(multi=False):
    p = RailBase()
    # active device card (switcher trigger)
    p.append(R(12, 116, 188, 64, SURFACE, RULE, 1, 3))
    p.append(R(12, 116, 3, 64, TEAL))
    p.append(Dot(26, 136, 4, GREEN))
    p.append(T(40, 136, "Chromecast HD", 12.3, INK, 600))
    p.append(T(40, 152, "Android 14 · TV", 10.2, MUTED, 400))
    p.append(T(26, 168, "192.168.1.42:5555", 9.4, MUTED, 400, MONO))
    p.append(Chev(184, 148))

    p.append(Group(208, "Equipo", count=6))
    p.append(Nav(230, "Estado", active=True))
    p.append(Nav(256, "Optimizar"))
    p.append(Nav(282, "Aplicaciones"))
    p.append(Nav(308, "Perfiles"))
    p.append(Nav(334, "Debloater"))
    p.append(Nav(360, "Archivos"))

    p.append(Group(394, "Diagnóstico", count=5))
    p.append(Nav(416, "Consola"))
    p.append(Nav(442, "Registro"))
    p.append(Nav(468, "Inspector"))
    p.append(Nav(494, "Ajustes del sistema"))
    p.append(Nav(520, "Doze y energía"))

    p.append(Group(554, "Sistema", count=4))
    p.append(Nav(576, "Launcher"))
    p.append(Nav(602, "Root y sistema"))
    p.append(Nav(628, "Flasheo y Magisk"))
    p.append(Nav(654, "DPC"))

    p.append(L(18, 680, 194, 680, RULE_FAINT))
    p.append(Nav(700, "Historial"))

    p.append(L(18, 812, 194, 812, RULE_FAINT))
    p.append(Button(12, 826, 188, 34, "+  Añadir equipo", size=11))
    p.append(Dot(22, 878, 3.5, GREEN))
    p.append(T(34, 878, "2 equipos · 1 activo" if multi else "1 equipo · 2 disponibles", 10, MUTED, 400))
    return p


def topbar_connected():
    p = []
    for x, label in ((872, "Android 14"), (972, "SDK 34"), (1042, "catálogo 2026.10")):
        w, pill = Pill(x, 61, label, PAPER2, RULE, MUTED)
        p.append(pill)
    # device chip
    p.append(R(1174, 44, 144, 34, SURFACE, TEAL, 1, 3))
    p.append(Dot(1188, 61, 4, GREEN))
    p.append(T(1200, 61, "Chromecast HD", 10.5, INK, 600))
    p.append(Chev(1306, 61, TEAL, 3.5))
    p.append(Button(1330, 44, 86, 34, "+  Añadir", "primary", 11))
    return p


def dashboard_content(footer_right="1 equipo activo"):
    p = []
    # health band
    p.append(L(240, 114, 1416, 114, RULE_STRONG, 2))
    p.append(T(240, 134, "Buen estado", 11.5, MUTED, 500))
    p.append(T(240, 170, "82", 42, INK, 700))
    p.append(T(292, 184, "/100", 12, MUTED, 400))
    p.append(T(240, 204, "Chromecast HD responde en 24 ms", 11, MUTED, 400))
    # 22 segments
    for i in range(22):
        on = i < 18
        color = GREEN if on else RULE_FAINT
        p.append(R(240 + i * 14, 222, 10, 6, color, None, 0, 1))

    metrics = [
        (660, "RAM", "1.6 / 2.0 GB", "78%", 78),
        (900, "CPU", "18%", "carga 0.4", 18),
        (1140, "Almacenamiento", "3.2 / 8.0 GB", "40%", 40),
    ]
    for x, label, value, hint, ratio in metrics:
        p.append(T(x, 140, label, 10.5, MUTED, 500))
        p.append(T(x, 170, value, 22, INK, 700))
        p.append(T(x, 192, hint, 10.5, MUTED, 400))
        p.append(R(x, 210, 220, 4, RULE_FAINT, None, 0, 2))
        p.append(R(x, 210, 220 * ratio / 100, 4, TEAL, None, 0, 2))
    p.append(L(640, 136, 640, 226, RULE_FAINT, 1))
    p.append(L(880, 136, 880, 226, RULE_FAINT, 1))
    p.append(L(1120, 136, 1120, 226, RULE_FAINT, 1))

    # left column: now
    p.append(T(240, 278, "Ahora", 14, INK, 700))
    p.append(T(240, 302, "Lectura", 9.5, MUTED, 500))
    p.append(T(992, 302, "Valor", 9.5, MUTED, 500, UI, "end"))
    p.append(L(240, 312, 992, 312, RULE))
    rows = [
        ("Memoria usada", "1.6 GB de 2.0 GB", 78, GREEN),
        ("CPU ocupada", "18% · carga 0.4", 18, TEAL),
        ("Almacenamiento", "3.2 GB de 8.0 GB", 40, TEAL),
        ("Presión térmica", "0 de 6", 4, GREEN),
        ("Batería", "sin batería · TV", 0, RULE_STRONG),
        ("Tiempo encendido", "3 d 14 h", 0, RULE_STRONG),
    ]
    y = 336
    for label, value, ratio, color in rows:
        p.append(T(240, y, label, 11.5, INK2, 400))
        p.append(R(430, y - 2, 370, 4, RULE_FAINT, None, 0, 2))
        if ratio:
            p.append(R(430, y - 2, 370 * ratio / 100, 4, color, None, 0, 2))
        p.append(T(992, y, value, 10.8, INK, 500, MONO, "end"))
        p.append(L(240, y + 16, 992, y + 16, RULE_FAINT))
        y += 34

    # expanded diagnostics
    p.append(L(240, 548, 992, 548, RULE))
    p.append(T(240, 574, "Diagnóstico ampliado", 12.5, INK, 600))
    p.append(T(240, 592, "hardware · batería · CPU por núcleo · pantalla · sensores · red", 10.5, MUTED, 400))
    p.append(Button(864, 566, 128, 28, "Leer diagnóstico", size=10.5))

    # recent changes
    p.append(L(240, 620, 992, 620, RULE))
    p.append(T(240, 646, "Cambios recientes", 12.5, INK, 600))
    p.append(T(982, 646, "Ver historial", 10.5, TEAL, 500, UI, "end"))
    changes = [
        ("Restringir segundo plano", "com.google.android.youtube.tv", "hace 12 min"),
        ("Compilar AOT", "com.spotify.tv", "hace 1 h"),
    ]
    y = 674
    for title, pkg, when in changes:
        p.append(T(240, y, title, 11.5, INK, 500))
        p.append(T(240, y + 16, pkg, 9.8, MUTED, 400, MONO))
        p.append(T(748, y, when, 10, MUTED, 400, UI, "end"))
        p.append(Button(836, y - 12, 82, 24, "Deshacer", size=10))
        p.append(L(240, y + 28, 992, y + 28, RULE_FAINT))
        y += 48

    # right column: actions
    p.append(T(1020, 278, "Acciones", 14, INK, 700))
    p.append(Button(1020, 296, 396, 40, "Optimizar equipo", "primary", 12))
    p.append(Button(1020, 344, 396, 34, "Abrir espejo", size=11))
    p.append(Button(1020, 386, 396, 34, "Doze y energía", size=11))
    p.append(Button(1020, 428, 396, 34, "Registrar el sistema", size=11))

    p.append(T(1020, 494, "Equipo", 12.5, INK, 600))
    specs = [
        ("Modelo", "Chromecast HD"),
        ("Android", "14 · SDK 34"),
        ("Dirección", "192.168.1.42:5555"),
        ("Tipo", "TV · leanback"),
        ("Catálogo", "2026.10"),
        ("Sesión", "12 min"),
    ]
    y = 520
    for label, value in specs:
        p.append(T(1020, y, label, 10.5, MUTED, 400))
        p.append(T(1416, y, value, 10.5, INK2, 500, MONO, "end"))
        p.append(L(1020, y + 13, 1416, y + 13, RULE_FAINT))
        y += 26

    p.append(T(1020, 700, "Otros equipos", 12.5, INK, 600))
    p.append(L(1020, 716, 1416, 716, RULE))
    p.append(Dot(1026, 736, 3.5, GREEN))
    p.append(T(1038, 736, "Pixel 7", 11, INK, 500))
    p.append(T(1150, 736, "USB · Android 15", 9.5, MUTED, 400, MONO))
    p.append(T(1416, 736, "Cambiar", 10, TEAL, 500, UI, "end"))
    p.append(L(1020, 752, 1416, 752, RULE_FAINT))
    p.append(Dot(1026, 774, 3.5, AMBER))
    p.append(T(1038, 774, "TV dormitorio", 11, INK, 500))
    p.append(T(1150, 774, "192.168.1.60:5555", 9.5, MUTED, 400, MONO))
    p.append(T(1416, 774, "Conectar", 10, TEAL, 500, UI, "end"))
    p.append(Button(1020, 800, 396, 34, "+  Conectar otro equipo", size=11))

    p.append(FooterLog(right=footer_right))
    return p


def frame_connected():
    p = Chrome("Estado")
    p.extend(rail_connected())
    p.extend(Topbar("Estado", topbar_connected()))
    p.append(Content())
    p.extend(dashboard_content())
    return p


# --------------------------------------------------------------------------- frame 03
def frame_multi():
    p = Chrome("Estado")
    p.extend(rail_connected(multi=True))
    # focus ring on the device card and the topbar chip
    p.append(R(10, 114, 192, 68, "none", TEAL, 2, 4))
    p.extend(Topbar("Estado", topbar_connected()))
    p.append(Content())
    p.extend(dashboard_content("2 equipos · 1 activo"))

    # scrim
    p.append(R(RAIL, CONTENT_Y, 1440 - RAIL, 900 - CONTENT_Y, INK, None, 0, 0, 0.08))

    # device switcher popover
    px, py, pw, ph = 980, 98, 436, 466
    p.append(f'<g filter="url(#overlay)">')
    p.append(R(px, py, pw, ph, SURFACE, RULE, 1, 3))
    p.append(f"</g>")
    p.append(f'<path d="M1240 {py} l8 -8 l8 8 z" fill="{SURFACE}" stroke="{RULE}" stroke-width="1"/>')
    p.append(R(1174, 44, 144, 34, "none", TEAL, 2, 3))
    p.append(T(px + 18, py + 26, "Equipos", 16, INK, 700))
    p.append(T(px + pw - 18, py + 26, "2 conectados", 10, MUTED, 400, UI, "end"))
    p.append(L(px, py + 44, px + pw, py + 44, RULE))

    # active device
    p.append(R(px + 12, py + 54, pw - 24, 66, PAPER2, None, 0, 2))
    p.append(Dot(px + 28, py + 76, 4, GREEN))
    p.append(T(px + 42, py + 76, "Chromecast HD", 12.5, INK, 600))
    p.append(T(px + 42, py + 94, "192.168.1.42:5555 · Android 14 · 24 ms", 9.6, MUTED, 400, MONO))
    p.append(R(px + 294, py + 66, 64, 20, TEAL, None, 0, 10))
    p.append(T(px + 326, py + 76, "Activo", 9, ORANGE_INK, 600, UI, "middle"))
    p.append(f'<path d="M{px + 374} {py + 77} l4 4 l8 -9" fill="none" stroke="{GREEN}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')

    # second device
    p.append(Dot(px + 28, py + 146, 4, GREEN))
    p.append(T(px + 42, py + 146, "Pixel 7", 12.5, INK, 600))
    p.append(T(px + 42, py + 164, "USB · R58M31… · Android 15 · 18 ms", 9.6, MUTED, 400, MONO))
    p.append(R(px + 284, py + 136, 74, 20, WASH_GREEN, GREEN, 1, 10))
    p.append(T(px + 321, py + 146, "Conectado", 9, GREEN, 600, UI, "middle"))
    p.append(Button(px + 366, py + 136, 52, 20, "Usar", size=9))
    p.append(L(px, py + 182, px + pw, py + 182, RULE_FAINT))

    # available
    p.append(T(px + 18, py + 206, "Disponibles en la red", 10, MUTED, 600))
    p.append(Dot(px + 28, py + 232, 4, AMBER))
    p.append(T(px + 42, py + 232, "TV dormitorio", 12, INK, 600))
    p.append(T(px + 42, py + 250, "192.168.1.60:5555", 9.6, MUTED, 400, MONO))
    p.append(Button(px + 340, py + 222, 78, 24, "Conectar", size=9.5))
    p.append(L(px, py + 268, px + pw, py + 268, RULE_FAINT))

    p.append(T(px + 18, py + 292, "Solo un equipo recibe comandos a la vez.", 10.5, MUTED, 400))
    p.append(T(px + 18, py + 308, "Los demás quedan conectados y en espera.", 10.5, MUTED, 400))

    p.append(Button(px + 12, py + 328, pw - 24, 40, "+  Conectar otro equipo", "primary", 11.5))
    p.append(T(px + pw / 2, py + 386, "Gestionar dispositivos", 10.5, TEAL, 600, UI, "middle"))
    p.append(T(px + pw / 2, py + 420, "Historial de conexiones", 10, MUTED, 400, UI, "middle"))
    p.append(L(px + 40, py + 400, px + pw - 40, py + 400, RULE_FAINT))

    return p


# --------------------------------------------------------------------------- output
def document(body, width=1440, height=900, bg=None):
    bg = bg or PAPER
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{defs()}'
        f'{R(0, 0, width, height, bg)}'
        + "".join(body)
        + "</svg>"
    )


def board():
    frames = [
        ("01", "Sin equipo", "Vista previa y conexión", frame_empty()),
        ("02", "Equipo conectado", "Las secciones se agrupan por trabajo", frame_connected()),
        ("03", "Varios equipos", "Cambiar, conectar o dejar en espera", frame_multi()),
    ]
    width = 1600
    top = 58
    caption = 76
    gap = 44
    height = top + len(frames) * (caption + 900 + gap) + 56
    p = [R(0, 0, width, height, BOARD)]
    p.append(T(80, 34, "ADB Optimizer · propuesta de navegación por secciones", 13, INK, 600))
    p.append(T(width - 80, 34, "tokens ADR-012 · 1440 × 900 por estado", 10, MUTED, 400, MONO, "end"))
    y = top
    for number, title, desc, frame in frames:
        p.append(T(80, y + 12, number, 11, TEAL, 600, MONO))
        p.append(T(112, y + 12, title, 18, INK, 700))
        p.append(T(width - 80, y + 12, desc, 11, MUTED, 400, UI, "end"))
        p.append(L(80, y + 28, width - 80, y + 28, RULE_STRONG))
        fy = y + caption
        p.append(f'<g transform="translate(80,{fy})">')
        p.extend(frame)
        p.append("</g>")
        p.append(R(80, fy, 1440, 900, "none", RULE_STRONG, 1))
        y += caption + 900 + gap
    p.append(T(80, height - 28, "La navegación se construye con el equipo. Sin conexión no hay secciones vacías ni comandos en segundo plano.", 10.5, MUTED, 400))
    return document(p, width, height, BOARD)


if __name__ == "__main__":
    apply_palette(LIGHT)
    files = {
        "escritorio-01-sin-dispositivo.svg": document(frame_empty()),
        "escritorio-02-conectado.svg": document(frame_connected()),
        "escritorio-03-multidispositivo.svg": document(frame_multi()),
        "escritorio-propuesta.svg": board(),
    }
    # Misma geometría que el estado conectado; solo cambia la paleta a los tokens de
    # `:root[data-theme='dark']`.
    apply_palette(DARK)
    files["escritorio-04-oscuro.svg"] = document(frame_connected())

    for name, svg in files.items():
        path = os.path.join(OUT_DIR, name)
        open(path, "w", encoding="utf-8").write(svg)
        print(path, len(svg))
