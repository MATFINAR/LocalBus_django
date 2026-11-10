"""Reportes PDF de LocalBus.

Siguen la guía de diseño (docs/GUIA_DE_DISENO.md): fondo blanco, texto negro, rojo solo para la marca,
cada ruta con su color de placa y las alertas con las mismas etiquetas de color que en la página.
La letra es Helvetica, la tipografía institucional de la señalización de transporte, que todo
lector de PDF trae sin incrustar archivos.
"""
import os
from datetime import datetime
from xml.sax.saxutils import escape

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .horas import hora12


# ========== COLORES (los mismos tokens del sitio, tema claro) ==========
TINTA = colors.HexColor('#080707')
BLANCO = colors.HexColor('#FFFFFF')
GRIS_TEXTO = colors.HexColor('#5B646B')
LINEA = colors.HexColor('#D3D8DB')
ROJO_INTERFAZ = colors.HexColor('#D4121A')
AZUL = colors.HexColor('#014CAB')
AMARILLO = colors.HexColor('#F7C600')

# Colores de ruta: los mismos de la página, asignados con id_ruta % 7
PALETA_RUTAS = ['#087F8C', '#6B3FA0', '#B85C00', '#A82A7B', '#5C6B1E', '#7A4A2B', '#3F5B7A']

# Etiqueta de cada tipo de alerta: (texto, fondo, color del texto), como en /alertas/
TIPOS_ALERTA = {
    'delay': ('Demora', ROJO_INTERFAZ, BLANCO),
    'warning': ('Advertencia', AMARILLO, TINTA),
    'info': ('Información', AZUL, BLANCO),
}

MARGEN = 2 * cm
# El marco de reportlab deja 6 pt de relleno por lado: se descuentan para que tablas y textos
# empiecen justo en el margen, alineados con el pie
RELLENO_MARCO = 6
ANCHO_UTIL = A4[0] - 2 * MARGEN

FUENTE = 'Helvetica'
FUENTE_NEGRITA = 'Helvetica-Bold'

ESTILO_CELDA = ParagraphStyle('Celda', fontName=FUENTE, fontSize=9, leading=11.5, textColor=TINTA)
ESTILO_ENCABEZADO = ParagraphStyle('Encabezado', fontName=FUENTE_NEGRITA, fontSize=8.5, leading=10.5,
                                   textColor=TINTA)


def nombre_archivo(modulo):
    """Nombre del PDF descargado: reporte_(módulo)_(fecha)_(hora), en hora de Colombia y 12 horas.

    Ejemplo: "reporte_alertas_10-11-2026_4-54pm.pdf". Usa guiones porque "/" y ":" no se permiten
    en nombres de archivo.
    """
    from django.utils import timezone
    ahora = timezone.localtime()
    hora = ahora.hour % 12 or 12
    sufijo = 'am' if ahora.hour < 12 else 'pm'
    return f'reporte_{modulo}_{ahora:%d-%m-%Y}_{hora}-{ahora.minute:02d}{sufijo}.pdf'


def get_logo_path():
    """Ruta del logo de LocalBus."""
    return os.path.join(settings.BASE_DIR, 'core', 'static', 'core', 'img', 'LocalBus-Logo.png')


# ========== PIEZAS PARA LAS CELDAS ==========

def _insignia(texto, fondo, tinta, negrita=True, tamano=8.5):
    """Recuadro de color ajustado al texto (placa de ruta o etiqueta de tipo)."""
    tabla = Table([[texto]], hAlign='LEFT')
    tabla.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), fondo),
        ('TEXTCOLOR', (0, 0), (-1, -1), tinta),
        ('FONTNAME', (0, 0), (-1, -1), FUENTE_NEGRITA if negrita else FUENTE),
        ('FONTSIZE', (0, 0), (-1, -1), tamano),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return tabla


def color_ruta(ruta):
    """Color de la ruta, el mismo de su placa en el mapa (id_ruta % 7)."""
    return colors.HexColor(PALETA_RUTAS[ruta.id_ruta % len(PALETA_RUTAS)])


def placa_ruta(ruta):
    """Código de la ruta en su placa de color, igual que en el mapa y las listas."""
    if ruta is None:
        return texto_celda('Sin ruta', secundario=True)
    return _insignia(ruta.codigo, color_ruta(ruta), BLANCO)


def etiqueta_tipo_alerta(tipo):
    """Etiqueta de color del tipo de alerta (Demora, Advertencia o Información)."""
    texto, fondo, tinta = TIPOS_ALERTA.get(tipo, (tipo.capitalize(), GRIS_TEXTO, BLANCO))
    return _insignia(texto, fondo, tinta)


def texto_celda(texto, secundario=False):
    """Texto que baja de línea dentro de la celda en vez de salirse o cortarse."""
    estilo = ESTILO_CELDA if not secundario else ParagraphStyle('CeldaSec', parent=ESTILO_CELDA,
                                                                 textColor=GRIS_TEXTO)
    return Paragraph(escape(str(texto)).replace('\n', '<br/>'), estilo)


def fecha_celda(valor):
    """Fecha arriba y hora debajo, para que la columna sea angosta: "09/11/2026" / "4:10 p. m."."""
    if not valor:
        return texto_celda('Sin registro', secundario=True)
    from django.utils import timezone
    if timezone.is_aware(valor):
        valor = timezone.localtime(valor)
    return Paragraph(f"{valor:%d/%m/%Y}<br/><font color='#5B646B'>{escape(hora12(valor))}</font>",
                     ESTILO_CELDA)


# ========== NUMERACIÓN "PÁGINA X DE Y" ==========

def _canvas_con_total():
    """Canvas que guarda las páginas y, al final, escribe el pie con el total de páginas."""

    class CanvasNumerado(pdfcanvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._paginas = []

        def showPage(self):
            self._paginas.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._paginas)
            for estado in self._paginas:
                self.__dict__.update(estado)
                self._pie(total)
                super().showPage()
            super().save()

        def _pie(self, total):
            self.saveState()
            self.setStrokeColor(LINEA)
            self.setLineWidth(0.75)
            self.line(MARGEN, 1.6 * cm, A4[0] - MARGEN, 1.6 * cm)
            self.setFont(FUENTE, 8)
            self.setFillColor(GRIS_TEXTO)
            self.drawString(MARGEN, 1.1 * cm, 'LocalBus, seguimiento de buses en Medellín')
            self.drawRightString(A4[0] - MARGEN, 1.1 * cm, f'Página {self._pageNumber} de {total}')
            self.restoreState()

    return CanvasNumerado


# ========== REPORTE ==========

def crear_reporte(response, titulo, encabezados, datos, total_registros,
                  descripcion="", ancho_columnas=None, empresa=None,
                  unidad=('registro', 'registros'), graficas=None):
    """
    Escribe en `response` un reporte PDF con el diseño de LocalBus.

    Parámetros:
        response: HttpResponse con content_type application/pdf
        titulo: nombre corto de lo que lista el reporte ("Alertas", "Turnos"...)
        encabezados: nombres de las columnas
        datos: filas; cada celda puede ser texto o una pieza de este módulo (placa_ruta, etiqueta_tipo_alerta...)
        total_registros: cuántas filas lista el reporte
        descripcion: texto que explica qué contiene el reporte
        ancho_columnas: ancho de cada columna (opcional; si falta se reparte igual)
        empresa: nombre de la empresa dueña de los datos (va en la cabecera)
        unidad: palabra para el total, en singular y plural: ('alerta', 'alertas')
        graficas: piezas (gráficas, cifras) que van entre la descripción y la tabla (opcional)
    """
    doc = SimpleDocTemplate(
        response,
        pagesize=A4,
        leftMargin=MARGEN - RELLENO_MARCO, rightMargin=MARGEN - RELLENO_MARCO,
        topMargin=1.6 * cm, bottomMargin=2.2 * cm,
        title=f'Reporte de {titulo.lower()}',
        author=empresa or 'LocalBus',
        subject='Reporte de LocalBus',
    )

    estilo_meta = ParagraphStyle('Meta', fontName=FUENTE, fontSize=8.5, leading=11.5,
                                 textColor=GRIS_TEXTO, alignment=TA_RIGHT)
    estilo_etiqueta = ParagraphStyle('Etiqueta', fontName=FUENTE_NEGRITA, fontSize=9, leading=11,
                                     textColor=ROJO_INTERFAZ, spaceAfter=3)
    estilo_titulo = ParagraphStyle('Titulo', fontName=FUENTE_NEGRITA, fontSize=24, leading=28,
                                   textColor=TINTA, alignment=TA_LEFT, spaceAfter=6)
    estilo_descripcion = ParagraphStyle('Descripcion', fontName=FUENTE, fontSize=9.5, leading=13.5,
                                        textColor=GRIS_TEXTO)
    estilo_total = ParagraphStyle('Total', fontName=FUENTE_NEGRITA, fontSize=9.5, leading=12,
                                  textColor=TINTA)
    estilo_vacio = ParagraphStyle('Vacio', fontName=FUENTE, fontSize=10, leading=14, textColor=GRIS_TEXTO)

    elementos = []

    # ===== CABECERA: logo a la izquierda; empresa y fecha a la derecha =====
    ahora = datetime.now()
    meta = f'Generado el {ahora:%d/%m/%Y} a las {escape(hora12(ahora))}'
    if empresa:
        meta = f'<font name="{FUENTE_NEGRITA}" color="#080707">{escape(empresa)}</font><br/>{meta}'
    logo_path = get_logo_path()
    logo = Image(logo_path, width=2.1 * cm, height=2.1 * cm) if os.path.exists(logo_path) else ''
    # El logo va sobre un recuadro negro, como en el sitio (la palabra "Local" es clara)
    cabecera = Table([[logo, Paragraph(meta, estilo_meta)]], colWidths=[2.7 * cm, ANCHO_UTIL - 2.7 * cm])
    cabecera.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('BACKGROUND', (0, 0), (0, 0), TINTA),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
        ('TOPPADDING', (0, 0), (0, 0), 0.3 * cm),
        ('BOTTOMPADDING', (0, 0), (0, 0), 0.3 * cm),
    ]))
    elementos += [cabecera, Spacer(1, 0.5 * cm)]

    # ===== TÍTULO Y DESCRIPCIÓN, cerrados por la línea negra de las cabeceras del sitio =====
    bloque = [Paragraph('Reporte', estilo_etiqueta), Paragraph(escape(titulo), estilo_titulo)]
    if descripcion:
        bloque.append(Paragraph(escape(descripcion), estilo_descripcion))
    titulo_tabla = Table([[b] for b in bloque], colWidths=[ANCHO_UTIL])
    titulo_tabla.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 8),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 12),
        ('LINEBELOW', (0, -1), (-1, -1), 2, TINTA),
    ]))
    elementos += [titulo_tabla, Spacer(1, 0.45 * cm)]

    # ===== GRÁFICAS: ayudan a leer la tabla de un vistazo =====
    if graficas and datos:
        elementos += list(graficas) + [Spacer(1, 0.5 * cm)]

    # ===== TABLA =====
    if datos:
        if ancho_columnas is None:
            ancho_columnas = [ANCHO_UTIL / len(encabezados)] * len(encabezados)

        filas = [[Paragraph(escape(e), ESTILO_ENCABEZADO) for e in encabezados]]
        for fila in datos:
            filas.append([texto_celda(c) if isinstance(c, (str, int, float)) else c for c in fila])

        tabla = Table(filas, colWidths=ancho_columnas, repeatRows=1)
        tabla.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (0, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, 0), 0),
            ('VALIGN', (0, 0), (-1, 0), 'BOTTOM'),
            # Encabezado separado por una línea negra; las filas, por líneas grises de 1 px
            ('LINEBELOW', (0, 0), (-1, 0), 1.25, TINTA),
            ('LINEBELOW', (0, 1), (-1, -1), 0.5, LINEA),
        ]))
        elementos.append(tabla)

        elementos.append(Spacer(1, 0.35 * cm))
        nombre = unidad[0] if total_registros == 1 else unidad[1]
        elementos.append(Paragraph(f'{total_registros} {escape(nombre)} en total', estilo_total))
    else:
        elementos.append(Paragraph(f'No hay {escape(unidad[1])} para mostrar en este reporte.', estilo_vacio))

    doc.build(elementos, canvasmaker=_canvas_con_total())
    return response
