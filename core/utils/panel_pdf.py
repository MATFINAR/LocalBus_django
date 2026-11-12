"""Reporte PDF del panel: dibuja las mismas gráficas que la empresa tiene elegidas en Personalizar.

Recibe los diccionarios que arma core.panel.DatosPanel.grafica() (los mismos con que se dibuja la página), así
que las cifras del PDF y las de la pantalla salen de un solo cálculo. Sigue la guía de diseño de los otros
reportes: fondo blanco, texto en tinta o gris, el color solo dice "qué es" y el nombre siempre va escrito.
"""
import math

from reportlab.graphics.shapes import Circle, Drawing, Line, PolyLine, Rect, String, Wedge
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

from .reportes import (ANCHO_UTIL, FUENTE, FUENTE_NEGRITA, GRIS_TEXTO, LINEA, ROJO_INTERFAZ, TINTA,
                       _canvas_con_total, _documento, _encabezado)

# Los colores del panel son variables CSS; en el PDF se usan sus valores del tema claro
COLORES_VAR = {
    'var(--verde)': '#187A45', 'var(--azul)': '#014CAB', 'var(--tinta)': '#080707',
    'var(--gris-texto)': '#5B646B', 'var(--linea)': '#D3D8DB', 'var(--rojo-interfaz)': '#D4121A',
    'var(--amarillo)': '#F7C600',
}
# Colores claros: llevan borde para verse sobre blanco
CLAROS = {'#D3D8DB', '#F7C600', '#EEF0F1'}
CONCRETO = colors.HexColor('#EEF0F1')
BLANCO = colors.HexColor('#FFFFFF')

MITAD = (ANCHO_UTIL - 0.6 * cm) / 2
FILAS_POR_TRAMO = 22          # buses por dibujo en la línea de tiempo

ESTILO_TITULO = ParagraphStyle('GrafTitulo', fontName=FUENTE_NEGRITA, fontSize=9.5, leading=12, textColor=TINTA,
                               spaceAfter=5)
ESTILO_NOTA = ParagraphStyle('GrafNota', fontName=FUENTE, fontSize=8, leading=10.5, textColor=GRIS_TEXTO,
                             spaceBefore=4)
ESTILO_VACIO = ParagraphStyle('GrafVacio', fontName=FUENTE, fontSize=9, leading=12, textColor=GRIS_TEXTO)


def _hex(color):
    return COLORES_VAR.get(color, color)


def _color(color):
    return colors.HexColor(_hex(color))


def _borde(color):
    return _hex(color).upper() in CLAROS


def _recortar(texto, ancho, fuente=FUENTE, tamano=8):
    """Corta con puntos suspensivos lo que no cabe en `ancho`."""
    if stringWidth(texto, fuente, tamano) <= ancho:
        return texto
    while texto and stringWidth(texto + '…', fuente, tamano) > ancho:
        texto = texto[:-1]
    return texto.rstrip() + '…'


def _con_titulo(g, contenido, ancho, nota=''):
    """Título de la gráfica (que baja de línea), la gráfica y una nota opcional."""
    filas = [[Paragraph(escape(g['titulo']), ESTILO_TITULO)], [contenido]]
    if nota:
        filas.append([Paragraph(escape(nota), ESTILO_NOTA)])
    tabla = Table(filas, colWidths=[ancho])
    tabla.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return tabla


def _vacio(texto, ancho):
    return Paragraph(escape(texto), ESTILO_VACIO)


# ---------- Contadores ----------
def _contadores(g, ancho):
    piezas = []
    for fila in g['filas']:
        cifras = fila['cifras']
        ancho_celda = ancho / len(cifras)
        celdas = []
        for c in cifras:
            lineas = simpleSplit(c['nombre'], FUENTE, 8, ancho_celda - 10)[:2]
            d = Drawing(ancho_celda, 1.75 * cm)
            if c['aviso']:
                d.add(Rect(0, 2, 2.5, 1.75 * cm - 4, fillColor=ROJO_INTERFAZ, strokeColor=None))
            d.add(String(8, 30, str(c['valor']), fontName=FUENTE_NEGRITA, fontSize=20,
                         fillColor=ROJO_INTERFAZ if c['aviso'] else TINTA))
            for i, linea in enumerate(lineas):
                d.add(String(8, 18 - i * 9.5, linea, fontName=FUENTE, fontSize=8, fillColor=GRIS_TEXTO))
            celdas.append(d)
        tabla = Table([celdas], colWidths=[ancho_celda] * len(celdas))
        tabla.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                                   ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
        piezas += [Paragraph(escape(fila['nombre']), ESTILO_TITULO), tabla, Spacer(1, 0.3 * cm)]
    return piezas


# ---------- Dona ----------
def _dona(g, ancho):
    if not g['total']:
        return _con_titulo(g, _vacio(g['vacio'], ancho), ancho)
    radio, hueco = 30, 18
    x_leyenda = 2 * radio + 12
    ancho_valor = 58
    ancho_nombre = ancho - x_leyenda - ancho_valor
    filas = [(simpleSplit(p['nombre'], FUENTE, 8, ancho_nombre) or [''], p) for p in g['partes']]
    alto_leyenda = sum(len(n) * 9.5 + 4 for n, _ in filas)
    alto = max(2 * radio + 4, alto_leyenda)
    d = Drawing(ancho, alto)

    cx, cy = radio + 1, alto - radio - 1 if alto <= 2 * radio + 4 else alto / 2
    acumulado = 0
    for _, p in filas:
        if not p['valor']:
            continue
        pct = p['valor'] / g['total']
        color = _color(p['color'])
        if pct >= 0.9999:
            d.add(Circle(cx, cy, radio, fillColor=color, strokeColor=None))
            d.add(Circle(cx, cy, hueco, fillColor=BLANCO, strokeColor=None))
        else:
            inicio = 90 - acumulado * 360
            d.add(Wedge(cx, cy, radio, inicio - pct * 360, inicio, radius1=hueco, fillColor=color,
                        strokeColor=BLANCO, strokeWidth=0.8))
        acumulado += pct
    d.add(String(cx, cy - 1, str(g['total']), fontName=FUENTE_NEGRITA, fontSize=13, fillColor=TINTA,
                 textAnchor='middle'))
    d.add(String(cx, cy - 9, g['etiqueta'], fontName=FUENTE, fontSize=6, fillColor=GRIS_TEXTO, textAnchor='middle'))

    y = alto - 9 if alto_leyenda >= alto else (alto + alto_leyenda) / 2 - 9
    for lineas, p in filas:
        color = _color(p['color'])
        d.add(Rect(x_leyenda, y - 1, 7, 7, fillColor=color, strokeColor=TINTA if _borde(p['color']) else None,
                   strokeWidth=0.5))
        for i, linea in enumerate(lineas):
            d.add(String(x_leyenda + 11, y - i * 9.5, linea, fontName=FUENTE, fontSize=8,
                         fillColor=GRIS_TEXTO if not p['valor'] else TINTA))
        d.add(String(ancho, y, f'{p["valor"]} · {p["pct"]} %', fontName=FUENTE_NEGRITA if p['valor'] else FUENTE,
                     fontSize=8, fillColor=TINTA if p['valor'] else GRIS_TEXTO, textAnchor='end'))
        y -= len(lineas) * 9.5 + 4

    nota = ''
    lista = g.get('lista')
    if lista:
        nota = f'{lista["titulo"]} ' + ', '.join(lista['items']) + (f' y {lista["mas"]} más' if lista['mas'] else '')
    return _con_titulo(g, d, ancho, nota)


# ---------- Barras horizontales ----------
def _barras(g, ancho):
    if not g['items']:
        return _con_titulo(g, _vacio(g['vacio'], ancho), ancho)
    alto_barra, aire = 9, 6
    ancho_etiqueta = min(max(stringWidth(i['nombre'], FUENTE, 8) for i in g['items']) + 8, ancho * 0.42)
    ancho_valor = max(stringWidth(i['texto'], FUENTE_NEGRITA, 8) for i in g['items']) + 8
    ancho_barras = ancho - ancho_etiqueta - ancho_valor
    maximo = max(i['valor'] for i in g['items']) or 1
    alto = len(g['items']) * (alto_barra + aire)
    d = Drawing(ancho, alto)
    d.add(Line(ancho_etiqueta, 0, ancho_etiqueta, alto, strokeColor=LINEA, strokeWidth=0.75))
    for n, i in enumerate(g['items']):
        y = alto - (n + 1) * (alto_barra + aire) + aire / 2
        d.add(String(0, y + 2, _recortar(i['nombre'], ancho_etiqueta - 6), fontName=FUENTE, fontSize=8,
                     fillColor=TINTA))
        largo = max(ancho_barras * i['valor'] / maximo, 1.5) if i['valor'] else 0
        if largo:
            d.add(Rect(ancho_etiqueta, y, largo, alto_barra, rx=1.5, ry=1.5, fillColor=_color(i['color']),
                       strokeColor=None))
        d.add(String(ancho_etiqueta + largo + 4, y + 2, i['texto'], fontName=FUENTE_NEGRITA, fontSize=8,
                     fillColor=ROJO_INTERFAZ if not i['valor'] else TINTA))
    return _con_titulo(g, d, ancho, g.get('nota', ''))


# ---------- Columnas ----------
def _columnas(g, ancho, dias_alertas):
    items = g['items']
    if g.get('periodos'):
        # Alertas por día: el periodo que la empresa tiene elegido en el panel (7 o 15 días)
        items = items[-dias_alertas:]
        nota = next((p['nota'] for p in g['periodos'] if p['dias'] == dias_alertas), g['total_texto'])
        titulo = {**g, 'titulo': f'{g["titulo"]}, últimos {dias_alertas} días'}
    else:
        nota, titulo = g.get('total_texto', ''), g
    if g.get('vacio') or not items:
        return _con_titulo(titulo, _vacio(g.get('vacio') or 'No hay datos para mostrar.', ancho), ancho)
    alto, base = 3.2 * cm, 14
    alto_util = alto - base - 10
    maximo = max(i['valor'] for i in items) or 1
    ancho_col = ancho / len(items)
    grosor = min(ancho_col - 2, 22)
    cada = max(1, math.ceil((max(stringWidth(i['etiqueta'], FUENTE, 7) for i in items) + 3) / ancho_col))
    d = Drawing(ancho, alto)
    d.add(Line(0, base, ancho, base, strokeColor=LINEA, strokeWidth=0.75))
    for n, i in enumerate(items):
        x = n * ancho_col + (ancho_col - grosor) / 2
        if i['valor']:
            largo = max(alto_util * i['valor'] / maximo, 1.5)
            d.add(Rect(x, base, grosor, largo, rx=1.5, ry=1.5, fillColor=_color(i['color']), strokeColor=None))
            d.add(String(x + grosor / 2, base + largo + 2, str(i['valor']), fontName=FUENTE_NEGRITA, fontSize=7,
                         fillColor=TINTA, textAnchor='middle'))
        if n % cada == 0 or n == len(items) - 1:
            d.add(String(x + grosor / 2, 3, i['etiqueta'], fontName=FUENTE_NEGRITA if i['resaltar'] else FUENTE,
                         fontSize=7, fillColor=TINTA if i['resaltar'] else GRIS_TEXTO, textAnchor='middle'))
    return _con_titulo(titulo, d, ancho, nota)


# ---------- Mapa de rutas ----------
def _mapa(g, ancho):
    rutas = g['rutas']
    if not rutas:
        return _con_titulo(g, _vacio(g['vacio'], ancho), ancho)
    alto, margen = 8.5 * cm, 10
    puntos = [(c[0], c[1]) for r in rutas for c in r['coordenadas']]
    lon0, lon1 = min(p[0] for p in puntos), max(p[0] for p in puntos)
    lat0, lat1 = min(p[1] for p in puntos), max(p[1] for p in puntos)
    factor = math.cos(math.radians((lat0 + lat1) / 2))          # un grado de longitud mide menos lejos del ecuador
    ancho_geo, alto_geo = max((lon1 - lon0) * factor, 1e-6), max(lat1 - lat0, 1e-6)
    escala = min((ancho - 2 * margen) / ancho_geo, (alto - 2 * margen) / alto_geo)
    desfase_x = (ancho - ancho_geo * escala) / 2
    desfase_y = (alto - alto_geo * escala) / 2

    def a_dibujo(lon, lat):
        return desfase_x + (lon - lon0) * factor * escala, desfase_y + (lat - lat0) * escala

    d = Drawing(ancho, alto)
    d.add(Rect(0, 0, ancho, alto, fillColor=CONCRETO, strokeColor=LINEA, strokeWidth=0.75))
    # Las inhabilitadas primero, para que las activas queden encima
    for r in sorted(rutas, key=lambda r: r['habilitado']):
        flat = [v for c in r['coordenadas'] for v in a_dibujo(c[0], c[1])]
        linea = PolyLine(flat, strokeColor=_color(r['color']) if r['habilitado'] else GRIS_TEXTO,
                         strokeWidth=2.2 if r['habilitado'] else 1.6, strokeLineCap=1, strokeLineJoin=1)
        if not r['habilitado']:
            linea.strokeDashArray = [4, 3]
        d.add(linea)
    # Leyenda: un cuadro de color y el código de cada ruta
    leyenda = Drawing(ancho, 0)
    x, y, filas = 0, 0, []
    cabida = []
    for r in sorted(rutas, key=lambda r: r['codigo']):
        texto = f'{r["codigo"]} {r["nombre"]}' + ('' if r['habilitado'] else ' (inhabilitada)')
        texto = _recortar(texto, 150, FUENTE, 7.5)
        w = stringWidth(texto, FUENTE, 7.5) + 20
        if x + w > ancho and cabida:
            filas.append(cabida)
            cabida, x = [], 0
        cabida.append((x, r, texto))
        x += w
    filas.append(cabida)
    leyenda = Drawing(ancho, len(filas) * 11 + 4)
    for n, fila in enumerate(filas):
        yy = leyenda.height - (n + 1) * 11
        for x, r, texto in fila:
            leyenda.add(Rect(x, yy, 8, 6, fillColor=_color(r['color']) if r['habilitado'] else GRIS_TEXTO,
                             strokeColor=None))
            leyenda.add(String(x + 12, yy, texto, fontName=FUENTE, fontSize=7.5, fillColor=TINTA))
    contenido = Table([[d], [Spacer(1, 4)], [leyenda]], colWidths=[ancho])
    contenido.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                                   ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    base = g['nota'].replace('Toca una línea para ver sus datos.', '').replace('  ', ' ').strip()
    nota = f'{base} En el PDF los recorridos se dibujan sin el mapa de calles.'.strip()
    return _con_titulo(g, contenido, ancho, nota)


# ---------- Línea de tiempo de turnos ----------
def _tiempo(g, ancho):
    if not g['filas']:
        return _con_titulo(g, _vacio(g['vacio'], ancho), ancho)
    x0 = 56
    ancho_pista = ancho - x0
    alto_fila, alto_escala = 16, 14

    def tramo(filas):
        alto = alto_escala + len(filas) * alto_fila
        d = Drawing(ancho, alto)
        d.add(Line(0, alto - alto_escala, ancho, alto - alto_escala, strokeColor=TINTA, strokeWidth=1))
        for m in g['escala']:
            x = x0 + float(m['x']) * ancho_pista / 100
            texto = m['texto'].replace(' a. m.', 'a').replace(' p. m.', 'p')
            d.add(String(x, alto - alto_escala + 4, texto, fontName=FUENTE, fontSize=7, fillColor=GRIS_TEXTO,
                         textAnchor='start' if float(m['x']) == 0 else 'middle'))
        for guia in g['guias']:
            x = x0 + float(guia) * ancho_pista / 100
            d.add(Line(x, 0, x, alto - alto_escala, strokeColor=LINEA, strokeWidth=0.5))
        for n, fila in enumerate(filas):
            y = alto - alto_escala - (n + 1) * alto_fila
            d.add(Line(0, y, ancho, y, strokeColor=LINEA, strokeWidth=0.5))
            d.add(String(0, y + 5.5, fila['placa'], fontName=FUENTE_NEGRITA, fontSize=8, fillColor=TINTA))
            for b in fila['barras']:
                x = x0 + float(b['x']) * ancho_pista / 100
                w = max(float(b['ancho']) * ancho_pista / 100, 2)
                ruta = colors.HexColor(b['color'])
                if b['estado'] == 'en-curso':
                    relleno, borde, tinta = ruta, ruta, BLANCO
                elif b['estado'] == 'programado':
                    relleno, borde, tinta = BLANCO, ruta, TINTA
                else:
                    relleno, borde, tinta = CONCRETO, LINEA, GRIS_TEXTO
                rect = Rect(x, y + 2.5, w, alto_fila - 5, rx=1.5, ry=1.5, fillColor=relleno, strokeColor=borde,
                            strokeWidth=1)
                if b['pausa']:
                    rect.strokeDashArray = [2, 2]
                d.add(rect)
                codigo = b['texto'].split(' · ')[0]
                for candidato in (b['texto'], codigo):
                    if stringWidth(candidato, FUENTE_NEGRITA, 7) + 5 <= w:
                        d.add(String(x + 3, y + 5.8, candidato, fontName=FUENTE_NEGRITA, fontSize=7, fillColor=tinta))
                        break
            xa = x0 + float(g['ahora']) * ancho_pista / 100
            d.add(Line(xa, y, xa, y + alto_fila, strokeColor=ROJO_INTERFAZ, strokeWidth=1.2))
        return d

    tramos = [g['filas'][i:i + FILAS_POR_TRAMO] for i in range(0, len(g['filas']), FILAS_POR_TRAMO)]
    filas = [[Paragraph(escape(g['titulo']), ESTILO_TITULO)]]
    for n, t in enumerate(tramos):
        filas.append([tramo(t)])
        if n < len(tramos) - 1:
            filas.append([Spacer(1, 8)])
    filas.append([Paragraph('Cada fila es un bus y cada barra un turno, con el color de su ruta. Llena: en curso; '
                            'con borde: programado; atenuada: finalizado; borde punteado: en pausa. La línea roja '
                            'marca la hora de la descarga.', ESTILO_NOTA)])
    tabla = Table(filas, colWidths=[ancho])
    tabla.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                               ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    return tabla


def _pieza(g, ancho, dias_alertas):
    return {'dona': lambda: _dona(g, ancho), 'barras': lambda: _barras(g, ancho),
            'columnas': lambda: _columnas(g, ancho, dias_alertas), 'mapa': lambda: _mapa(g, ancho),
            'tiempo': lambda: _tiempo(g, ancho)}[g['tipo']]()


def _par(izquierda, derecha):
    tabla = Table([[izquierda, derecha]], colWidths=[MITAD + 0.6 * cm, MITAD])
    tabla.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (0, 0), 0.6 * cm),
        ('RIGHTPADDING', (1, 0), (1, 0), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return tabla


def crear_reporte_panel(response, graficas, empresa, momento_texto, dias_alertas=7):
    """Escribe en `response` el PDF del panel. `graficas`: los dicts de DatosPanel.grafica(), en el orden elegido.
    Las anchas (resumen, mapa, línea de tiempo…) ocupan toda la página; las demás van de dos en dos."""
    doc = _documento(response, 'Panel', empresa, 'Reporte del panel')
    descripcion = (f'Gráficas de {empresa.rstrip(".")} al {momento_texto}, las mismas que tienes elegidas en '
                   f'Personalizar, en el mismo orden.')
    elementos = _encabezado('Panel', descripcion, empresa)

    pendiente = None
    for g in graficas:
        if g['tipo'] == 'cifras':
            if pendiente is not None:
                elementos += [_par(pendiente, ''), Spacer(1, 0.5 * cm)]
                pendiente = None
            elementos += _contadores(g, ANCHO_UTIL)
        elif g['ancha']:
            if pendiente is not None:
                elementos += [_par(pendiente, ''), Spacer(1, 0.5 * cm)]
                pendiente = None
            elementos += [_pieza(g, ANCHO_UTIL, dias_alertas), Spacer(1, 0.5 * cm)]
        elif pendiente is None:
            pendiente = _pieza(g, MITAD, dias_alertas)
        else:
            elementos += [_par(pendiente, _pieza(g, MITAD, dias_alertas)), Spacer(1, 0.5 * cm)]
            pendiente = None
    if pendiente is not None:
        elementos += [_par(pendiente, '')]

    doc.build(elementos, canvasmaker=_canvas_con_total())
    return response
