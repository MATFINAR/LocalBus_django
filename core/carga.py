"""Carga masiva desde hojas de cálculo (Excel o CSV): una empresa nueva sube sus rutas, buses, conductores y turnos
en un solo archivo, cada tabla en su hoja (se reconocen por su nombre o por sus columnas).

No tiene su propia forma de guardar: convierte las hojas al mismo formato que un backup (con ids provisionales)
y las pasa por core.restaurar.restaurar. Así heredan todas sus reglas: solo se agrega lo que falta, lo que choca
con otra empresa o con otro turno se rechaza con su motivo, todo ocurre en una transacción y la revisión previa
es la misma carga deshecha al final.

Orden de carga (lo fija restaurar): primero lo que no depende de nada (rutas, conductores) y después lo que
depende de lo ya cargado (buses: sus rutas; turnos: conductor, bus y ruta). Las referencias se hacen con datos
que la persona conoce, no con ids: el bus nombra sus rutas por código; el turno, al conductor por cédula, al bus
por placa y a la ruta por código. Pueden estar en el mismo archivo o ya existir en la empresa.
"""
import csv
import io
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date, datetime, time
from itertools import count

from django.utils import timezone

from .models import Bus, Conductor, Ruta

FORMATO = 'localbus-backup'
MAX_ARCHIVO = 10 * 1024 * 1024
MAX_ARCHIVOS = 8
MAX_FILAS = 20000                 # por hoja
MAX_VACIAS_SEGUIDAS = 500         # Excel a veces reporta un millón de filas con formato y sin datos

ORDEN = ['rutas', 'buses', 'conductores', 'turnos']
TITULOS = {'rutas': 'Rutas', 'buses': 'Buses', 'conductores': 'Conductores', 'turnos': 'Turnos'}

# (nombre de la columna, obligatoria, ejemplo, qué poner)
COLUMNAS = {
    'rutas': [
        ('codigo', True, 'R1', 'Código único de la ruta (hasta 20 caracteres). No se repite en la empresa.'),
        ('nombre', True, 'Centro - Poblado', 'Nombre de la ruta.'),
        ('origen', True, 'Parque Berrío', 'Dónde empieza el recorrido.'),
        ('destino', True, 'El Poblado', 'Dónde termina el recorrido.'),
        ('distancia_km', False, '8.5', 'Kilómetros del recorrido.'),
        ('duracion_minutos', False, '35', 'Minutos que dura el recorrido.'),
        ('frecuencia_minutos', False, '10', 'Cada cuántos minutos pasa un bus.'),
        ('habilitado', False, 'Sí', 'Sí o No. Vacío es Sí.'),
        ('trazado', False, '6.2518,-75.5636; 6.2100,-75.5700',
         'Puntos del recorrido como latitud,longitud separados por punto y coma. Se puede dejar vacío y '
         'dibujarlo después en Rutas.'),
    ],
    'buses': [
        ('placa', True, 'ABC123', 'Placa única del bus.'),
        ('rutas', False, 'R1; R2', 'Códigos de las rutas que puede cubrir, separados por punto y coma. Deben estar '
                                   'en la hoja Rutas o ya existir en tu empresa.'),
        ('habilitado', False, 'Sí', 'Sí o No. Vacío es Sí.'),
    ],
    'conductores': [
        ('nombre', True, 'Ana Gómez', 'Nombre completo.'),
        ('cedula', True, '1020304050', 'Cédula, única en todo LocalBus.'),
        ('email', True, 'ana@empresa.com', 'Correo, único en todo LocalBus.'),
        ('telefono', False, '3001234567', 'Teléfono (hasta 15 caracteres).'),
        ('habilitado', False, 'Sí', 'Sí o No. Vacío es Sí.'),
    ],
    'turnos': [
        ('conductor_cedula', True, '1020304050', 'Cédula de un conductor (de la hoja Conductores o ya existente).'),
        ('bus_placa', True, 'ABC123', 'Placa de un bus (de la hoja Buses o ya existente).'),
        ('ruta_codigo', True, 'R1', 'Código de una ruta (de la hoja Rutas o ya existente).'),
        ('inicio', True, '2026-11-16 06:00', 'Cuándo empieza, como AAAA-MM-DD HH:MM (hora de 24 horas).'),
        ('fin', False, '2026-11-16 14:00', 'Cuándo termina un turno de un solo día. Obligatorio si no es fijo.'),
        ('fijo', False, 'No', 'Sí si se repite cada día (o solo los días de la columna dias). Vacío es No.'),
        ('hora_fin', False, '14:00', 'Solo para fijos: hora diaria en que termina la jornada (HH:MM). Obligatoria '
                                     'si es fijo.'),
        ('dias', False, 'Lun, Mar, Mié', 'Solo para fijos: días de la semana (Lun, Mar, Mié, Jue, Vie, Sáb, Dom). '
                                          'Vacío son todos los días.'),
    ],
}

# Nombres alternativos de columnas (ya sin tildes ni mayúsculas)
SINONIMOS = {
    'rutas': {'duracion': 'duracion_minutos', 'frecuencia': 'frecuencia_minutos', 'distancia': 'distancia_km',
              'codigo_de_ruta': 'codigo', 'nombre_ruta': 'nombre', 'nombre_de_la_ruta': 'nombre'},
    'buses': {'rutas_codigos': 'rutas', 'codigos_de_rutas': 'rutas', 'rutas_asignadas': 'rutas',
              'placa_bus': 'placa', 'bus_placa': 'placa'},
    'conductores': {'correo': 'email', 'correo_electronico': 'email', 'documento': 'cedula',
                    'identificacion': 'cedula', 'cc': 'cedula', 'celular': 'telefono',
                    'nombre_completo': 'nombre', 'nombres': 'nombre'},
    'turnos': {'conductor': 'conductor_cedula', 'cedula': 'conductor_cedula', 'cedula_conductor': 'conductor_cedula',
               'bus': 'bus_placa', 'placa': 'bus_placa', 'placa_bus': 'bus_placa', 'ruta': 'ruta_codigo',
               'codigo_ruta': 'ruta_codigo', 'codigo_de_ruta': 'ruta_codigo', 'hasta': 'fin', 'desde': 'inicio',
               'fecha_inicio': 'inicio', 'fecha_fin': 'fin'},
}

INSTRUCCIONES = [
    'Cómo cargar los datos de tu empresa',
    '',
    '1. Llena las hojas que necesites (no hace falta llenarlas todas) y súbelas en Backup > Cargar datos.',
    '2. No cambies los nombres de las hojas ni los de las columnas de la primera fila.',
    '3. El orden lo pone LocalBus: primero carga lo que no depende de nada (rutas y conductores) y después lo que '
    'depende de lo ya cargado (buses, con sus rutas; y turnos, con su conductor, bus y ruta).',
    '4. Los buses nombran sus rutas por código; los turnos nombran al conductor por cédula, al bus por placa y a la '
    'ruta por código. Pueden estar en el mismo archivo o ya existir en tu empresa.',
    '5. Solo se agrega lo que falta: lo que ya existe se deja como está. Antes de guardar verás un resumen con lo '
    'que se agregará y lo que no se puede cargar, con su motivo. Hasta que confirmes no se cambia nada.',
    '6. Los conductores quedan sin contraseña: asígnasela a cada uno en Conductores.',
    '7. Fechas y horas: AAAA-MM-DD HH:MM (por ejemplo 2026-11-16 06:00). Un turno nocturno puede terminar al día '
    'siguiente.',
    '8. En Excel, deja las celdas de cédula, teléfono, placa y fechas como texto para no perder ceros ni formato.',
    '',
]


class CargaInvalida(Exception):
    """Los archivos no se pueden leer en absoluto (mensaje para la persona)."""


class _Error(Exception):
    """Un dato de una fila no es válido: se rechaza solo esa fila."""


# ================= PLANTILLAS =================

def plantilla_xlsx():
    """Libro de Excel con una hoja de instrucciones y una hoja vacía (solo encabezados) por tabla."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    libro = Workbook()
    guia = libro.active
    guia.title = 'Instrucciones'
    for linea in INSTRUCCIONES:
        guia.append([linea])
    guia['A1'].font = Font(bold=True, size=14)
    guia.append(['Hoja', 'Columna', 'Obligatoria', 'Ejemplo', 'Qué poner'])
    for celda in guia[guia.max_row]:
        celda.font = Font(bold=True)
    for tabla in ORDEN:
        for nombre, obligatoria, ejemplo, ayuda in COLUMNAS[tabla]:
            guia.append([TITULOS[tabla], nombre, 'Sí' if obligatoria else 'No', ejemplo, ayuda])
    for columna, ancho in zip('ABCDE', (14, 22, 12, 34, 90)):
        guia.column_dimensions[columna].width = ancho
    for fila in guia.iter_rows(min_row=len(INSTRUCCIONES) + 2):
        for celda in fila:
            celda.number_format = '@'
            celda.alignment = Alignment(vertical='top', wrap_text=True)

    relleno = PatternFill('solid', fgColor='EEF0F1')
    for tabla in ORDEN:
        hoja = libro.create_sheet(TITULOS[tabla])
        hoja.append([c[0] for c in COLUMNAS[tabla]])
        for n, (nombre, obligatoria, _, _) in enumerate(COLUMNAS[tabla], start=1):
            celda = hoja.cell(row=1, column=n)
            celda.font = Font(bold=True, color='D4121A' if obligatoria else '080707')
            celda.fill = relleno
            hoja.column_dimensions[celda.column_letter].width = max(16, len(nombre) + 4)
            # Texto: Excel no debe volver número la cédula ni quitar ceros, ni cambiar el formato de la fecha
            for fila in range(2, 502):
                hoja.cell(row=fila, column=n).number_format = '@'
        hoja.freeze_panes = 'A2'
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()


def plantilla_csv_zip():
    """.zip con un CSV vacío (solo encabezados) por tabla y un LEEME. Separador ";" y UTF-8, como el backup."""
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as z:
        for tabla in ORDEN:
            texto = io.StringIO()
            csv.writer(texto, delimiter=';', lineterminator='\r\n').writerow([c[0] for c in COLUMNAS[tabla]])
            z.writestr(f'{tabla}.csv', '﻿' + texto.getvalue())
        lineas = list(INSTRUCCIONES) + ['Un archivo por tabla, con el nombre de la tabla: rutas.csv, buses.csv, '
                                        'conductores.csv y turnos.csv. Se abren con Excel; guarda como CSV.', '']
        for tabla in ORDEN:
            lineas.append(TITULOS[tabla])
            for nombre, obligatoria, ejemplo, ayuda in COLUMNAS[tabla]:
                lineas.append(f'  {nombre}{" (obligatoria)" if obligatoria else ""}: {ayuda} Ejemplo: {ejemplo}')
            lineas.append('')
        z.writestr('LEEME.txt', '\r\n'.join(lineas))
    return salida.getvalue()


# ================= LEER LOS ARCHIVOS =================
# Basta un archivo con todas las tablas, cada una en su hoja. Cada hoja se reconoce por su nombre y, si el nombre
# no dice nada (Hoja1, Datos…), por sus columnas: la tabla cuyas columnas obligatorias aparecen en el encabezado.
# El encabezado no tiene que estar en la primera fila (puede haber un título encima) ni las columnas en orden.
# Si una tabla viene repartida en varias hojas, se juntan; las hojas que no son ninguna tabla se ignoran.

FILAS_BUSCANDO_ENCABEZADO = 10
MAX_HOJAS = 40


def _sin_tildes(texto):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(texto)) if not unicodedata.combining(c))


def _clave(texto):
    """"Cédula *" -> "cedula"; "Duración (min)" -> "duracion_min"."""
    return re.sub(r'[^a-z0-9]+', '_', _sin_tildes(texto).lower()).strip('_')


def _tabla_de(nombre):
    clave = _clave(nombre)
    if clave in ORDEN:
        return clave
    return {'ruta': 'rutas', 'bus': 'buses', 'conductor': 'conductores', 'turno': 'turnos'}.get(clave)


def _celda(valor):
    if valor is None:
        return ''
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return str(valor)
    if isinstance(valor, str):
        return valor.strip()
    return valor     # fechas, horas y booleanos de Excel


def _columnas_de(tabla, fila):
    """Encabezado -> {posición de la columna: nombre de la columna de la tabla}."""
    permitidas = {c[0] for c in COLUMNAS[tabla]}
    columnas = {}
    for i, encabezado in enumerate(fila):
        clave = _clave(encabezado) if encabezado not in (None, '') else ''
        clave = SINONIMOS[tabla].get(clave, clave)
        if clave in permitidas and clave not in columnas.values():
            columnas[i] = clave
    return columnas


def _falta(tabla, columnas):
    return [c[0] for c in COLUMNAS[tabla] if c[1] and c[0] not in columnas.values()]


def _encabezado(filas, tabla=None):
    """Busca en las primeras filas la del encabezado. Con `tabla` (el nombre de la hoja la dijo) busca esa; sin ella,
    la que mejor encaje con alguna tabla. Devuelve (tabla, posición de la fila, columnas) o None."""
    mejor = None
    candidatas = [tabla] if tabla else ORDEN
    for pos, fila in enumerate(filas[:FILAS_BUSCANDO_ENCABEZADO]):
        if not any(c not in (None, '') and str(c).strip() for c in fila):
            continue
        for t in candidatas:
            columnas = _columnas_de(t, fila)
            if _falta(t, columnas):
                continue
            puntaje = len(columnas)
            if mejor is None or puntaje > mejor[0]:
                mejor = (puntaje, t, pos, columnas)
    return mejor[1:] if mejor else None


def _filas_csv(contenido):
    try:
        texto = contenido.decode('utf-8-sig')
    except UnicodeDecodeError:
        texto = contenido.decode('latin-1')
    primera = texto.split('\n', 1)[0]
    separador = max(';', ',', '\t', key=primera.count)
    return list(csv.reader(io.StringIO(texto), delimiter=separador))


def _hojas_xlsx(contenido, nombre_archivo):
    """[(nombre de la hoja, filas)] de todas las hojas del libro."""
    from openpyxl import load_workbook
    try:
        libro = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception:
        raise CargaInvalida(f'«{nombre_archivo}» no se pudo abrir: no parece un libro de Excel (.xlsx) válido.')
    if len(libro.worksheets) > MAX_HOJAS:
        libro.close()
        raise CargaInvalida(f'«{nombre_archivo}» tiene más de {MAX_HOJAS} hojas.')
    hojas = []
    try:
        for hoja in libro.worksheets:
            filas, vacias = [], 0
            for fila in hoja.iter_rows(values_only=True):
                if all(c is None or str(c).strip() == '' for c in fila):
                    vacias += 1
                    if vacias > MAX_VACIAS_SEGUIDAS:
                        break
                    filas.append([])
                    continue
                vacias = 0
                filas.append(list(fila))
            hojas.append((hoja.title, filas))
    finally:
        libro.close()
    return hojas


def _filas_de_tabla(tabla, filas, pos, columnas, etiquetar):
    """Filas de datos bajo el encabezado -> [(dónde está la fila, {columna: valor})]."""
    resultado = []
    for n, fila in enumerate(filas[pos + 1:], start=pos + 2):
        datos = {nombre: _celda(fila[i]) if i < len(fila) else '' for i, nombre in columnas.items()}
        if all(v == '' for v in datos.values()):
            continue
        resultado.append((etiquetar(n), datos))
    return resultado


def leer_archivos(archivos):
    """Archivo(s) subido(s) (.xlsx o .csv) -> ({tabla: [(dónde está la fila, datos)]}, lectura). `lectura` cuenta qué
    se reconoció en cada hoja, para mostrárselo a la persona. Lanza CargaInvalida."""
    archivos = [a for a in archivos if a]
    if not archivos:
        raise CargaInvalida('Elige tu archivo de Excel (.xlsx) con las tablas, cada una en su hoja.')
    if len(archivos) > MAX_ARCHIVOS:
        raise CargaInvalida(f'Subiste {len(archivos)} archivos; el máximo es {MAX_ARCHIVOS}.')

    fuentes = {t: [] for t in ORDEN}          # tabla -> [(hoja, filas, posición del encabezado, columnas)]
    ignoradas = []
    for archivo in archivos:
        nombre = archivo.name.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
        extension = nombre.lower().rsplit('.', 1)[-1] if '.' in nombre else ''
        if archivo.size > MAX_ARCHIVO:
            raise CargaInvalida(f'«{nombre}» pesa {archivo.size // (1024 * 1024)} MB; el máximo es '
                                f'{MAX_ARCHIVO // (1024 * 1024)} MB.')
        contenido = archivo.read()
        if extension == 'xlsx':
            hojas = _hojas_xlsx(contenido, nombre)
        elif extension == 'csv':
            hojas = [(nombre.rsplit('.', 1)[0], _filas_csv(contenido))]
        elif extension == 'xls':
            raise CargaInvalida(f'«{nombre}» es un Excel antiguo (.xls). Guárdalo como «Libro de Excel (.xlsx)».')
        else:
            raise CargaInvalida(f'«{nombre}» no es un archivo que podamos leer. Sube un libro de Excel (.xlsx) o un .csv.')

        for hoja, filas in hojas:
            if not any(any(c not in (None, '') and str(c).strip() for c in f) for f in filas):
                continue                                     # hoja vacía
            nombrada = _tabla_de(hoja)
            encontrada = _encabezado(filas, nombrada) or (_encabezado(filas) if not nombrada else None)
            if encontrada is None and nombrada:
                # La hoja dice qué es pero le faltan columnas: se dice cuáles, para que lo arregle
                primera = next(f for f in filas if any(c not in (None, '') and str(c).strip() for c in f))
                faltan = _falta(nombrada, _columnas_de(nombrada, primera))
                raise CargaInvalida(f'A la hoja «{hoja}» le falta la columna '
                                    f'«{faltan[0]}». Descarga la plantilla para ver cómo se llama cada columna.')
            if encontrada is None:
                if extension == 'csv':
                    raise CargaInvalida(f'No pude saber qué tabla es «{nombre}». Revisa que la primera fila tenga los '
                                        f'nombres de las columnas de la plantilla.')
                ignoradas.append(hoja)
                continue
            tabla, pos, columnas = encontrada
            fuentes[tabla].append((hoja, filas, pos, columnas))

    if not any(fuentes.values()):
        raise CargaInvalida('No reconocí ninguna tabla en el archivo. Busco hojas con las columnas de Rutas (codigo, '
                            'nombre, origen, destino), Buses (placa), Conductores (nombre, cedula, email) o Turnos '
                            '(conductor_cedula, bus_placa, ruta_codigo, inicio). Descarga la plantilla para verlas.')

    hojas_tabla, lectura = {}, []
    for tabla in ORDEN:
        origen = fuentes[tabla]
        if not origen:
            continue
        varias = len(origen) > 1          # la tabla viene repartida: cada fila dice de qué hoja es
        filas_tabla = []
        for hoja, filas, pos, columnas in origen:
            etiquetar = (lambda n, h=hoja: f'hoja «{h}», fila {n}') if varias else (lambda n: f'fila {n}')
            encontradas = _filas_de_tabla(tabla, filas, pos, columnas, etiquetar)
            filas_tabla += encontradas
            lectura.append({'hoja': hoja, 'tabla': TITULOS[tabla], 'filas': len(encontradas)})
        if len(filas_tabla) > MAX_FILAS:
            raise CargaInvalida(f'«{TITULOS[tabla]}» tiene más de {MAX_FILAS} filas: divídela en varias cargas.')
        hojas_tabla[tabla] = filas_tabla
    return hojas_tabla, {'tablas': lectura, 'ignoradas': ignoradas}


# ================= CONVERTIR AL FORMATO DEL BACKUP =================

FORMATOS_FECHA = ('%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M', '%Y-%m-%dT%H:%M:%S', '%d/%m/%Y %H:%M',
                  '%d/%m/%Y %H:%M:%S', '%d-%m-%Y %H:%M', '%Y-%m-%d', '%d/%m/%Y')
FORMATOS_HORA = ('%H:%M', '%H:%M:%S', '%I:%M %p', '%I:%M:%S %p')
DIAS = {'lun': 0, 'mar': 1, 'mie': 2, 'jue': 3, 'vie': 4, 'sab': 5, 'dom': 6}


def _momento(valor, campo):
    if valor == '':
        return None
    if isinstance(valor, datetime):
        return valor
    if isinstance(valor, date):
        return datetime.combine(valor, time.min)
    texto = str(valor).strip()
    for formato in FORMATOS_FECHA:
        try:
            return datetime.strptime(texto, formato)
        except ValueError:
            continue
    raise _Error(f'{campo} «{texto}» no es una fecha y hora válida (usa AAAA-MM-DD HH:MM)')


def _hora(valor):
    if valor == '':
        return None
    if isinstance(valor, datetime):
        return valor.time()
    if isinstance(valor, time):
        return valor
    texto = str(valor).strip().lower().replace('a. m.', 'am').replace('p. m.', 'pm')
    for formato in FORMATOS_HORA:
        try:
            return datetime.strptime(texto.upper(), formato).time()
        except ValueError:
            continue
    raise _Error(f'la hora «{valor}» no es válida (usa HH:MM)')


def _dias(valor):
    if valor == '' or _clave(valor) in ('todos', 'todos_los_dias'):
        return ''
    elegidos = set()
    for trozo in re.split(r'[,;/|\s]+', str(valor).strip()):
        if not trozo:
            continue
        dia = DIAS.get(_sin_tildes(trozo).lower()[:3])
        if dia is None:
            raise _Error(f'el día «{trozo}» no es válido (usa Lun, Mar, Mié, Jue, Vie, Sáb o Dom)')
        elegidos.add(dia)
    return ','.join(str(d) for d in sorted(elegidos))


def _numero(valor, campo, entero=False):
    if valor == '':
        return ''
    try:
        n = float(str(valor).replace(',', '.'))
    except ValueError:
        raise _Error(f'{campo} no es un número')
    return int(round(n)) if entero else n


def _trazado(valor):
    """"lat,lon; lat,lon" -> LineString GeoJSON (lon, lat), o None si está vacío."""
    if valor == '':
        return None
    puntos = []
    for trozo in re.split(r'[;|\n]+', str(valor)):
        if not trozo.strip():
            continue
        partes = [p for p in re.split(r'[,\s]+', trozo.strip()) if p]
        try:
            lat, lon = float(partes[0]), float(partes[1])
        except (ValueError, IndexError):
            raise _Error(f'el punto «{trozo.strip()}» del trazado no es latitud,longitud')
        if len(partes) != 2 or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise _Error(f'el punto «{trozo.strip()}» del trazado no es una latitud,longitud válida')
        puntos.append([lon, lat])
    if len(puntos) < 2:
        raise _Error('el trazado necesita al menos dos puntos')
    return {'type': 'LineString', 'coordinates': puntos}


def _lista(valor):
    return [t.strip() for t in re.split(r'[,;|/\n]+', str(valor)) if t.strip()]


class _Referencias:
    """Resuelve código/placa/cédula -> id provisional. Primero lo que viene en el archivo; si no, lo que ya existe
    en la empresa (se anota en `previos` para que restaurar lo encuentre)."""

    def __init__(self, empresa):
        self.empresa = empresa
        self.siguiente = count(1)
        self.en_archivo = {t: {} for t in ('rutas', 'buses', 'conductores')}
        self.rechazados = {t: set() for t in ('rutas', 'buses', 'conductores')}
        self.previos = {t: {} for t in ('rutas', 'buses', 'conductores')}
        self.cache_previos = {t: {} for t in ('rutas', 'buses', 'conductores')}

    def nuevo(self, tabla, clave):
        """Id para una fila del archivo. El primero que usa la clave es el que cuenta (los repetidos los descarta
        restaurar como ya existentes)."""
        ident = next(self.siguiente)
        self.en_archivo[tabla].setdefault(clave.lower(), ident)
        return ident

    def rechazar(self, tabla, clave):
        self.rechazados[tabla].add(clave.lower())

    def _existente(self, tabla, clave):
        if tabla == 'rutas':
            return self.empresa.rutas.filter(codigo__iexact=clave).first()
        if tabla == 'buses':
            return Bus.objects.filter(empresa=self.empresa, placa__iexact=clave).first()
        return Conductor.objects.filter(empresa=self.empresa, cedula=clave).first()

    def resolver(self, tabla, clave, nombre):
        """Id provisional, o _Error con el motivo de por qué no se puede."""
        llave = clave.lower()
        if llave in self.en_archivo[tabla]:
            return self.en_archivo[tabla][llave]
        if llave in self.rechazados[tabla]:
            raise _Error(f'{nombre} {clave} está en el archivo pero no se pudo cargar (mira sus motivos)')
        if llave in self.cache_previos[tabla]:
            return self.cache_previos[tabla][llave]
        objeto = self._existente(tabla, clave)
        if objeto is None:
            raise _Error(f'{nombre} {clave} no está en el archivo ni en tu empresa')
        ident = next(self.siguiente)
        self.previos[tabla][str(ident)] = objeto.pk
        self.cache_previos[tabla][llave] = ident
        return ident


def construir_datos(empresa, hojas):
    """Convierte las hojas leídas al formato del backup. Lo que no se puede ni armar (un número mal escrito, una
    ruta que no existe) queda en `rechazos` con su motivo y restaurar lo suma al informe."""
    ref = _Referencias(empresa)
    tablas = {t: [] for t in ORDEN}
    rechazos = defaultdict(list)

    def rechazar(tabla, descripcion, fila, error):
        rechazos[tabla].append(f'{descripcion} ({fila}): {error}.')

    for n, f in hojas.get('rutas', []):
        codigo = str(f['codigo'])
        try:
            if not str(f['origen']):
                raise _Error('le falta el origen')
            if not str(f['destino']):
                raise _Error('le falta el destino')
            fila = {
                'codigo': codigo, 'nombre': f['nombre'], 'origen': f['origen'], 'destino': f['destino'],
                'distancia_km': _numero(f.get('distancia_km', ''), 'la distancia'),
                'duracion_estimada_minutos': _numero(f.get('duracion_minutos', ''), 'la duración', entero=True),
                'frecuencia_minutos': _numero(f.get('frecuencia_minutos', ''), 'la frecuencia', entero=True),
                'habilitado': f.get('habilitado', ''), 'geometria_ruta': _trazado(f.get('trazado', '')),
            }
        except _Error as e:
            ref.rechazar('rutas', codigo)
            rechazar('rutas', f'Ruta {codigo or "sin código"}', n, e)
            continue
        fila['id_ruta'] = ref.nuevo('rutas', codigo) if codigo else next(ref.siguiente)
        tablas['rutas'].append(fila)

    for n, f in hojas.get('conductores', []):
        cedula = str(f['cedula'])
        tablas['conductores'].append({
            'id_conductor': ref.nuevo('conductores', cedula) if cedula else next(ref.siguiente),
            'nombre': f['nombre'], 'cedula': cedula, 'email': f['email'], 'telefono': f.get('telefono', ''),
            'habilitado': f.get('habilitado', '')})

    for n, f in hojas.get('buses', []):
        placa = str(f['placa'])
        try:
            rutas_ids = [ref.resolver('rutas', codigo, 'la ruta') for codigo in _lista(f.get('rutas', ''))]
        except _Error as e:
            ref.rechazar('buses', placa)
            rechazar('buses', f'Bus {placa or "sin placa"}', n, e)
            continue
        tablas['buses'].append({'id_bus': ref.nuevo('buses', placa) if placa else next(ref.siguiente), 'placa': placa,
                                'rutas_ids': rutas_ids, 'habilitado': f.get('habilitado', '')})

    for n, f in hojas.get('turnos', []):
        descripcion = f'Turno de {f["conductor_cedula"] or "?"} en {f["bus_placa"] or "?"}'
        try:
            conductor = ref.resolver('conductores', str(f['conductor_cedula']), 'el conductor con cédula')
            bus = ref.resolver('buses', str(f['bus_placa']), 'el bus')
            ruta = ref.resolver('rutas', str(f['ruta_codigo']), 'la ruta')
            inicio = _momento(f['inicio'], 'el inicio')
            if inicio is None:
                raise _Error('le falta el inicio')
            fin = _momento(f.get('fin', ''), 'el fin')
            hora_fin = _hora(f.get('hora_fin', ''))
            dias = _dias(f.get('dias', ''))
        except _Error as e:
            rechazar('turnos', descripcion, n, e)
            continue
        tablas['turnos'].append({
            'conductor_id': conductor, 'bus_id': bus, 'ruta_id': ruta, 'inicio': inicio.isoformat(),
            'fin': fin.isoformat() if fin else None, 'fijo': f.get('fijo', ''),
            'hora_fin': hora_fin.isoformat() if hora_fin else None, 'dias': dias})

    ahora = timezone.localtime()
    return {
        'formato': FORMATO, 'version': 1, 'origen': 'carga', 'generado': ahora.isoformat(), 'generado_por': '',
        'empresa': {'nit': empresa.nit, 'nombre': empresa.nombre},
        'tablas': tablas, 'previos': ref.previos, 'rechazos': dict(rechazos),
    }
