from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, 
    Spacer, Image, PageBreak
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from django.conf import settings
import os
from datetime import datetime


# ========== COLORES LOCALBUS ==========
COLOR_PRIMARY = colors.HexColor('#1D3557')      # Azul oscuro
COLOR_ACCENT = colors.HexColor('#E63946')       # Rojo
COLOR_LIGHT = colors.HexColor('#F1FAEE')        # Blanco humo
COLOR_GRAY = colors.HexColor('#6C757D')         # Gris
COLOR_GREEN = colors.HexColor('#2E7D32')        # Verde
COLOR_ORANGE = colors.HexColor('#F39C12')       # Naranja


def get_logo_path():
    """Retorna la ruta del logo"""
    return os.path.join(settings.BASE_DIR, 'core', 'static', 'core', 'img', 'LocalBus-Logo.png')

def crear_reporte(response, titulo, encabezados, datos, total_registros, 
                   descripcion="", ancho_columnas=None):
    """
    Crea un reporte PDF con estilo LocalBus
    
    Parámetros:
        response: HttpResponse con content_type application/pdf
        titulo: Título del reporte
        encabezados: Lista con los nombres de las columnas
        datos: Lista de listas con los datos
        total_registros: Número total de registros
        descripcion: Texto descriptivo del reporte
        ancho_columnas: Lista con los anchos de cada columna (opcional)
    """
    
    # ===== CONFIGURACIÓN DEL DOCUMENTO =====
    doc = SimpleDocTemplate(
        response,
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=3*cm,
        bottomMargin=2*cm,
        title=titulo,
        author='LocalBus',
        subject='Reporte del Sistema de Transporte'
    )
    
    # ===== ESTILOS =====
    estilos = getSampleStyleSheet()
    
    estilo_titulo = ParagraphStyle(
        'TituloReporte',
        parent=estilos['Heading1'],
        fontSize=22,
        textColor=COLOR_PRIMARY,
        alignment=TA_CENTER,
        spaceAfter=6,
        fontName='Helvetica-Bold',
    )
    
    estilo_subtitulo = ParagraphStyle(
        'SubtituloReporte',
        parent=estilos['Normal'],
        fontSize=11,
        textColor=COLOR_GRAY,
        alignment=TA_CENTER,
        spaceAfter=20,
    )
    
    estilo_descripcion = ParagraphStyle(
        'Descripcion',
        parent=estilos['Normal'],
        fontSize=10,
        textColor=COLOR_GRAY,
        alignment=TA_LEFT,
        spaceAfter=15,
        leading=14,
    )
    
    estilo_seccion = ParagraphStyle(
        'Seccion',
        parent=estilos['Heading2'],
        fontSize=12,
        textColor=COLOR_PRIMARY,
        fontName='Helvetica-Bold',
        spaceAfter=8,
        spaceBefore=15,
    )
    
    # ===== CONTENIDO DEL PDF =====
    elementos = []
    
    # ===== ENCABEZADO CON LOGO =====
    logo_path = get_logo_path()
    
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=3*cm, height=3*cm)
        logo.hAlign = 'CENTER'
        elementos.append(logo)
        elementos.append(Spacer(1, 0.3*cm))
    else:
        # Si no hay logo, mostrar un título grande
        titulo_texto = Paragraph("🚌 LOCALBUS", estilo_titulo)
        elementos.append(titulo_texto)
        elementos.append(Spacer(1, 0.3*cm))
    
    # ===== TÍTULO DEL REPORTE =====
    elementos.append(Paragraph(titulo, estilo_titulo))
    
    # Fecha y hora
    fecha_actual = datetime.now()
    info_fecha = f"Generado el {fecha_actual.strftime('%d/%m/%Y')} a las {fecha_actual.strftime('%H:%M')}"
    elementos.append(Paragraph(info_fecha, estilo_subtitulo))
    
    # ===== DESCRIPCIÓN =====
    if descripcion:
        elementos.append(Paragraph("<b>Descripción del reporte:</b>", estilo_seccion))
        elementos.append(Paragraph(descripcion, estilo_descripcion))
    
    # ===== TABLA DE DATOS =====
    if datos and len(datos) > 0:
        
        # Preparar los datos con el encabezado
        tabla_datos = [encabezados] + datos
        
        # Anchos por defecto si no se especifican
        if ancho_columnas is None:
            ancho_disponible = A4[0] - 4*cm  # Ancho total menos márgenes
            ancho_columnas = [ancho_disponible / len(encabezados)] * len(encabezados)
        
        # Crear la tabla
        tabla = Table(tabla_datos, colWidths=ancho_columnas, repeatRows=1)
        
        # Estilo de la tabla
        estilo_tabla = TableStyle([
            # Encabezado
            ('BACKGROUND', (0, 0), (-1, 0), COLOR_PRIMARY),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            
            # Cuerpo
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLOR_PRIMARY),
            ('ALIGN', (0, 1), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
            ('TOPPADDING', (0, 1), (-1, -1), 8),
            
            # Bordes
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#DEE2E6')),
            ('LINEBELOW', (0, 0), (-1, 0), 2, COLOR_ACCENT),
            
            # Filas alternadas
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLOR_LIGHT]),
            
            # Alineación vertical
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ])
        
        tabla.setStyle(estilo_tabla)
        elementos.append(tabla)
        
        # ===== TOTAL DE REGISTROS =====
        elementos.append(Spacer(1, 0.5*cm))
        texto_total = Paragraph(
            f"<b>Total de registros:</b> {total_registros}",
            ParagraphStyle(
                'Total',
                parent=estilos['Normal'],
                fontSize=11,
                textColor=COLOR_PRIMARY,
                alignment=TA_RIGHT,
                fontName='Helvetica-Bold',
            )
        )
        elementos.append(texto_total)
    
    else:
        # Sin datos
        sin_datos = Paragraph(
            "No hay datos disponibles para este reporte.",
            ParagraphStyle(
                'SinDatos',
                parent=estilos['Normal'],
                fontSize=12,
                textColor=COLOR_GRAY,
                alignment=TA_CENTER,
                spaceAfter=20,
            )
        )
        elementos.append(Spacer(1, 2*cm))
        elementos.append(sin_datos)
    
    # ===== PIE DE PÁGINA =====
    def agregar_pie_pagina(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(COLOR_GRAY)
        
        # Línea superior del pie
        canvas.setStrokeColor(COLOR_PRIMARY)
        canvas.setLineWidth(0.5)
        canvas.line(2*cm, 1.5*cm, A4[0] - 2*cm, 1.5*cm)
        
        # Texto del pie
        canvas.drawString(2*cm, 1*cm, "LocalBus - Sistema de Transporte")
        canvas.drawRightString(A4[0] - 2*cm, 1*cm, f"Página {doc.page}")
        
        # Centro: "Confidencial" o similar
        canvas.drawCentredString(A4[0] / 2, 1*cm, "Documento generado automáticamente")
        
        canvas.restoreState()
    
    # ===== GENERAR EL PDF =====
    doc.build(elementos, onFirstPage=agregar_pie_pagina, onLaterPages=agregar_pie_pagina)
    
    return response