"""Gráficas para los reportes PDF (van antes de la tabla para leer los datos de un vistazo).

Siguen la guía de diseño: fondo blanco, texto siempre en tinta o gris (nunca del color de la serie),
barras delgadas con su valor escrito al final, rejilla casi invisible y un solo eje. El color dice
qué es cada barra (tipo de alerta, ruta), pero el nombre siempre va escrito al lado, así que el
color nunca es el único aviso.
"""
from collections import Counter, OrderedDict
from datetime import timedelta

from django.utils import timezone
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Spacer, Table, TableStyle

TINTA = colors.HexColor('#080707')
GRIS_TEXTO = colors.HexColor('#5B646B')
LINEA = colors.HexColor('#D3D8DB')
AZUL = colors.HexColor('#014CAB')

FUENTE = 'Helvetica'
FUENTE_NEGRITA = 'Helvetica-Bold'

ALTO_BARRA = 9          # barras delgadas
SEPARACION = 6          # aire entre barras
MAX_BARRAS = 8          # más filas se juntan en "Otras"


def _titulo(dibujo, texto, y):
    dibujo.add(String(0, y, texto, fontName=FUENTE_NEGRITA, fontSize=9, fillColor=TINTA))


def indicadores(cifras, ancho):
    """Fila de cifras grandes: [(número, etiqueta), ...]. Para totales, mejor que una gráfica."""
    celdas = []
    for valor, etiqueta in cifras:
        d = Drawing(ancho / len(cifras), 1.35 * cm)
        d.add(String(0, 15, str(valor), fontName=FUENTE_NEGRITA, fontSize=20, fillColor=TINTA))
        d.add(String(0, 2, etiqueta, fontName=FUENTE, fontSize=8.5, fillColor=GRIS_TEXTO))
        celdas.append(d)
    tabla = Table([celdas], colWidths=[ancho / len(cifras)] * len(cifras))
    tabla.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return tabla


def barras_horizontales(titulo, filas, ancho):
    """Barras de mayor a menor. filas: [(etiqueta, valor, color, con_borde)], ya ordenadas.

    El valor se escribe al final de cada barra; la etiqueta, a la izquierda en tinta."""
    if len(filas) > MAX_BARRAS:
        resto = sum(f[1] for f in filas[MAX_BARRAS - 1:])
        filas = filas[:MAX_BARRAS - 1] + [('Otras', resto, GRIS_TEXTO, False)]

    ancho_etiqueta = max(stringWidth(f[0], FUENTE, 8.5) for f in filas) + 8
    ancho_valor = 22
    ancho_barras = ancho - ancho_etiqueta - ancho_valor
    maximo = max(f[1] for f in filas) or 1

    alto = 18 + len(filas) * (ALTO_BARRA + SEPARACION)
    d = Drawing(ancho, alto)
    _titulo(d, titulo, alto - 10)

    # Línea base: todas las barras salen del mismo punto
    d.add(Line(ancho_etiqueta, 0, ancho_etiqueta, alto - 18, strokeColor=LINEA, strokeWidth=0.75))
    for i, (etiqueta, valor, color, con_borde) in enumerate(filas):
        y = alto - 18 - (i + 1) * (ALTO_BARRA + SEPARACION) + SEPARACION / 2
        d.add(String(0, y + 2, etiqueta, fontName=FUENTE, fontSize=8.5, fillColor=TINTA))
        largo = max(ancho_barras * valor / maximo, 1.5)
        d.add(Rect(ancho_etiqueta, y, largo, ALTO_BARRA, rx=1.5, ry=1.5, fillColor=color,
                   strokeColor=TINTA if con_borde else None, strokeWidth=0.5 if con_borde else 0))
        d.add(String(ancho_etiqueta + largo + 4, y + 2, str(valor), fontName=FUENTE_NEGRITA,
                     fontSize=8.5, fillColor=TINTA))
    return d


def columnas_en_el_tiempo(titulo, fechas, ancho, alto=3.4 * cm):
    """Cuántas alertas hubo por día (o por semana si el periodo es largo). Una sola serie, en azul."""
    dias = sorted(timezone.localtime(f).date() for f in fechas)
    if not dias:
        return None
    inicio, fin = dias[0], dias[-1]
    por_semana = (fin - inicio).days > 31
    if por_semana:
        inicio -= timedelta(days=inicio.weekday())  # semanas que empiezan el lunes
    paso = 7 if por_semana else 1

    cuenta = Counter((d - timedelta(days=d.weekday())) if por_semana else d for d in dias)
    grupos = OrderedDict()
    actual = inicio
    while actual <= fin:
        grupos[actual] = cuenta.get(actual, 0)
        actual += timedelta(days=paso)
    if len(grupos) < 2:
        return None  # con un solo día no hay tendencia que mostrar

    titulo = f'{titulo} por semana' if por_semana else f'{titulo} por día'
    d = Drawing(ancho, alto)
    _titulo(d, titulo, alto - 10)

    base_y = 14                      # espacio para las fechas debajo
    alto_util = alto - 18 - base_y - 10
    maximo = max(grupos.values()) or 1
    ancho_columna = ancho / len(grupos)
    grosor = min(ancho_columna - 2, 22)  # 2 pt de aire entre columnas

    d.add(Line(0, base_y, ancho, base_y, strokeColor=LINEA, strokeWidth=0.75))
    # Se rotulan pocas fechas para que no se encimen
    cada = max(1, round(len(grupos) / 10))
    for i, (fecha, valor) in enumerate(grupos.items()):
        x = i * ancho_columna + (ancho_columna - grosor) / 2
        if valor:
            largo = max(alto_util * valor / maximo, 1.5)
            d.add(Rect(x, base_y, grosor, largo, rx=1.5, ry=1.5, fillColor=AZUL, strokeColor=None))
            d.add(String(x + grosor / 2, base_y + largo + 2, str(valor), fontName=FUENTE_NEGRITA,
                         fontSize=7.5, fillColor=TINTA, textAnchor='middle'))
        if i % cada == 0 or i == len(grupos) - 1:
            d.add(String(x + grosor / 2, 3, f'{fecha:%d/%m}', fontName=FUENTE, fontSize=7,
                         fillColor=GRIS_TEXTO, textAnchor='middle'))
    return d


def en_dos_columnas(izquierda, derecha, ancho):
    """Dos gráficas lado a lado, alineadas arriba."""
    tabla = Table([[izquierda, derecha]], colWidths=[ancho / 2, ancho / 2])
    tabla.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, 0), 0.6 * cm),
        ('RIGHTPADDING', (1, 0), (1, 0), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return tabla


def separador(alto=0.45 * cm):
    return Spacer(1, alto)
