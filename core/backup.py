"""Backup completo de una empresa: un .zip con toda su información.

Contenido del .zip:
- datos.json       Todo junto y con sus ids, para volver a cargarlo o pasarlo a otro sistema.
- csv/*.csv        Una tabla por archivo, para abrir en Excel (separador ";" y UTF-8).
- rutas.geojson    Los trazados y paradas de las rutas, para abrir en QGIS, geojson.io o Google My Maps.
- logo.<ext>       El logo de la empresa, si tiene.
- LEEME.txt        Qué hay en cada archivo.

No se incluyen datos que no son de la empresa ni secretos: ni contraseñas (de conductores ni de
administradores) ni el correo o teléfono de los pasajeros que crearon alertas (solo su nombre de usuario).
"""
import csv
import io
import json
import logging
import os
import re
import tempfile
import unicodedata
import zipfile
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from django.contrib import messages
from django.contrib.gis.geos import GEOSGeometry
from django.db.models.fields.files import FieldFile
from django.http import FileResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import (Administrador, Alerta, Bus, Conductor, Difusion, Mensaje, Respaldo, Ruta,
                     Turno, UbicacionBus)
from .permisos import admin_empresa_required
from .utils.horas import fecha_hora12

logger = logging.getLogger(__name__)
FORMATO = 'localbus-backup'
VERSION = 1


def _valor(v):
    """Un valor de la base convertido a algo que JSON entiende."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, datetime):
        return timezone.localtime(v).isoformat() if timezone.is_aware(v) else v.isoformat()
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, (Decimal, UUID)):
        return str(v)
    if isinstance(v, GEOSGeometry):
        # GeoJSON armado con las coordenadas (lon, lat): no depende de la instalación de PROJ del servidor
        return {'type': v.geom_type, 'coordinates': json.loads(json.dumps(v.coords))}
    if isinstance(v, FieldFile):
        return v.name or ''
    return v


def _fila(obj, excluir=()):
    """Campos guardados del objeto (las relaciones como su id), menos los de `excluir`."""
    fila = {}
    for campo in obj._meta.concrete_fields:
        if campo.name in excluir:
            continue
        nombre = campo.attname if campo.is_relation else campo.name   # "empresa_id", "bus_id"…
        fila[nombre] = _valor(getattr(obj, campo.attname))
    return fila


class Tablas:
    """Qué se exporta de una empresa, tabla por tabla. Cada tabla es (nombre, descripción, filas)."""

    def __init__(self, empresa):
        self.empresa = empresa

    def consultas(self):
        e = self.empresa
        return [
            ('rutas', 'Rutas con su trazado, paradas y estado', Ruta.objects.filter(empresa=e).order_by('codigo')),
            ('buses', 'Buses y las rutas que pueden cubrir', Bus.objects.filter(empresa=e).prefetch_related('rutas').order_by('placa')),
            ('conductores', 'Conductores (sin contraseña)', Conductor.objects.filter(empresa=e).order_by('nombre')),
            ('turnos', 'Turnos: qué conductor maneja qué bus, en qué ruta y horario', Turno.objects.filter(bus__empresa=e).order_by('inicio')),
            ('alertas', 'Alertas de las rutas (de pasajeros y de la empresa)', Alerta.objects.filter(ruta__empresa=e).select_related('usuario').order_by('fecha_creacion')),
            ('difusiones', 'Mensajes enviados a grupos de conductores', Difusion.objects.filter(empresa=e).select_related('enviado_por').order_by('creado')),
            ('mensajes', 'Chat con cada conductor', Mensaje.objects.filter(conductor__empresa=e).select_related('enviado_por').order_by('creado', 'id_mensaje')),
            ('ubicaciones', 'Historial de ubicaciones enviadas por los buses', UbicacionBus.objects.filter(bus__empresa=e).order_by('timestamp')),
            ('administradores', 'Cuentas que administran la empresa (sin contraseña)', Administrador.objects.filter(empresa=e).select_related('user')),
        ]

    def conteos(self):
        return [(nombre, descripcion, consulta.count()) for nombre, descripcion, consulta in self.consultas()]

    def filas(self, nombre, consulta):
        """Genera las filas de una tabla, quitando lo que no debe salir del sistema."""
        for obj in consulta.iterator(chunk_size=2000) if nombre == 'ubicaciones' else consulta:
            if nombre == 'conductores':
                yield _fila(obj, excluir={'contrasena'})
            elif nombre == 'buses':
                fila = _fila(obj)
                fila['rutas_ids'] = sorted(r.pk for r in obj.rutas.all())
                yield fila
            elif nombre == 'alertas':
                fila = _fila(obj, excluir={'usuario'})
                # Del pasajero solo su nombre de usuario: su correo y teléfono no son de la empresa
                fila['autor'] = obj.usuario.nickName if obj.usuario_id else (self.empresa.nombre if obj.empresa_id else '')
                fila['autor_tipo'] = 'pasajero' if obj.usuario_id else 'empresa'
                yield fila
            elif nombre in ('difusiones', 'mensajes'):
                fila = _fila(obj, excluir={'enviado_por'})
                fila['enviado_por'] = obj.enviado_por.get_username() if obj.enviado_por_id else ''
                yield fila
            elif nombre == 'administradores':
                u = obj.user
                yield {'id': obj.pk, 'usuario': u.get_username(), 'nombre': u.get_full_name(), 'correo': u.email,
                       'activo': u.is_active, 'ultimo_ingreso': _valor(u.last_login),
                       'tema': obj.tema, 'desplazamiento_mapa': obj.desplazamiento_mapa,
                       'panel_graficas': obj.panel_graficas}
            else:
                yield _fila(obj)


def _csv(filas):
    """Texto CSV para Excel en español: separador ";", BOM UTF-8 y listas/objetos como JSON."""
    salida = io.StringIO()
    salida.write('﻿')
    escritor = None
    for fila in filas:
        if escritor is None:
            escritor = csv.DictWriter(salida, fieldnames=list(fila), delimiter=';', extrasaction='ignore')
            escritor.writeheader()
        escritor.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else
                           ('sí' if v is True else 'no' if v is False else v) for k, v in fila.items()})
    return salida.getvalue()


def _geojson(rutas):
    """FeatureCollection con el trazado de cada ruta y sus paradas."""
    features = []
    for r in rutas:
        propiedades = {'id_ruta': r['id_ruta'], 'codigo': r['codigo'], 'nombre': r['nombre'],
                       'origen': r['origen'], 'destino': r['destino'], 'estado': r['estado'],
                       'habilitado': r['habilitado']}
        if r.get('geometria_ruta'):
            features.append({'type': 'Feature', 'geometry': r['geometria_ruta'], 'properties': {**propiedades, 'tipo': 'trazado'}})
        if r.get('paradas'):
            features.append({'type': 'Feature', 'geometry': r['paradas'], 'properties': {**propiedades, 'tipo': 'paradas'}})
    return {'type': 'FeatureCollection', 'features': features}


def _nombre_archivo(empresa, momento):
    sin_tildes = unicodedata.normalize('NFKD', empresa.nombre.lower()).encode('ascii', 'ignore').decode()
    base = re.sub(r'[^a-z0-9]+', '-', sin_tildes).strip('-') or 'empresa'
    return f'backup-{base}-{timezone.localtime(momento):%Y%m%d-%H%M}.zip'


def generar_zip(empresa, hecho_por, archivo):
    """Escribe el backup en `archivo` (un archivo binario abierto). Devuelve el total de registros."""
    ahora = timezone.now()
    tablas = Tablas(empresa)
    datos = {'formato': FORMATO, 'version': VERSION, 'generado': _valor(ahora), 'generado_por': hecho_por,
             'empresa': _fila(empresa), 'tablas': {}}
    conteos = []
    with zipfile.ZipFile(archivo, 'w', zipfile.ZIP_DEFLATED) as z:
        for nombre, descripcion, consulta in tablas.consultas():
            filas = list(tablas.filas(nombre, consulta))
            datos['tablas'][nombre] = filas
            conteos.append((nombre, descripcion, len(filas)))
            if filas:
                z.writestr(f'csv/{nombre}.csv', _csv(filas))
        z.writestr('csv/empresa.csv', _csv([datos['empresa']]))
        z.writestr('datos.json', json.dumps(datos, ensure_ascii=False, indent=1))
        z.writestr('rutas.geojson', json.dumps(_geojson(datos['tablas']['rutas']), ensure_ascii=False))
        if empresa.logo:
            try:
                with empresa.logo.open('rb') as logo:
                    z.writestr('logo' + os.path.splitext(empresa.logo.name)[1].lower(), logo.read())
            except OSError:
                logger.warning('Backup de %s sin logo: no se encontró el archivo %s', empresa.pk, empresa.logo.name)
        total = sum(n for _, _, n in conteos)
        z.writestr('LEEME.txt', _leeme(empresa, ahora, hecho_por, conteos, total))
    return total


def _leeme(empresa, momento, hecho_por, conteos, total):
    lineas = [
        f'Backup de {empresa.nombre} (NIT {empresa.nit})',
        f'Generado el {fecha_hora12(momento, "%d/%m/%Y")} por {hecho_por}, desde LocalBus.',
        f'Total: {total} registros.',
        '',
        'ARCHIVOS',
        '  datos.json     Toda la información junta y con sus ids (para volver a cargarla o pasarla a otro sistema).',
        '  csv/           Una tabla por archivo, para abrir en Excel (separador ";", UTF-8).',
        '  rutas.geojson  Trazados y paradas de las rutas (QGIS, geojson.io, Google My Maps).',
        '  logo.*         El logo de la empresa, si tiene.',
        '',
        'TABLAS',
    ] + [f'  {nombre:<20} {n:>7}  {descripcion}' for nombre, descripcion, n in conteos] + [
        '',
        'QUÉ NO SE INCLUYE',
        '  - Contraseñas de conductores y administradores: al restaurar hay que asignarlas de nuevo.',
        '  - Correo y teléfono de los pasajeros que crearon alertas: solo su nombre de usuario.',
        '',
        'Las fechas están en hora de Colombia (America/Bogota), en formato ISO 8601.',
        'Guarda este archivo en un lugar seguro: tiene los datos de contacto de tus conductores.',
    ]
    return '\r\n'.join(lineas) + '\r\n'


@admin_empresa_required
def backup(request):
    empresa = request.empresa
    conteos = Tablas(empresa).conteos()
    respaldos = list(empresa.respaldos.select_related('hecho_por')[:10])
    for r in respaldos:
        r.cuando = fecha_hora12(r.creado, '%d/%m/%Y')
        r.quien = (r.hecho_por.get_full_name() or r.hecho_por.get_username()) if r.hecho_por_id else 'Cuenta eliminada'
    titulos = {'rutas': 'Rutas', 'buses': 'Buses', 'conductores': 'Conductores', 'turnos': 'Turnos', 'alertas': 'Alertas', 'difusiones': 'Mensajes a grupos',
               'mensajes': 'Chat con conductores', 'ubicaciones': 'Ubicaciones', 'administradores': 'Administradores'}
    return render(request, 'core/backup.html', {
        'conteos': [{'archivo': n, 'titulo': titulos.get(n, n), 'descripcion': d, 'total': t} for n, d, t in conteos],
        'total': sum(n for _, _, n in conteos),
        'respaldos': respaldos,
        'tiene_logo': bool(empresa.logo),
    })


@admin_empresa_required
@require_POST
def descargar_backup(request):
    empresa = request.empresa
    usuario = request.user.get_username()
    # En memoria hasta 20 MB; si crece más (muchas ubicaciones), pasa a un archivo temporal
    archivo = tempfile.SpooledTemporaryFile(max_size=20 * 1024 * 1024)
    try:
        total = generar_zip(empresa, usuario, archivo)
    except Exception:
        archivo.close()
        logger.exception('No se pudo generar el backup de la empresa %s', empresa.pk)
        messages.error(request, 'No pudimos generar el backup. Inténtalo de nuevo en unos minutos; si sigue fallando, '
                                'avisa al administrador de LocalBus.')
        return redirect('/backup/')
    tamano = archivo.tell()
    archivo.seek(0)
    Respaldo.objects.create(empresa=empresa, hecho_por=request.user, tamano_bytes=tamano, registros=total)
    logger.info('Backup de la empresa %s descargado por %s (%s registros, %s bytes)', empresa.pk, usuario, total, tamano)
    return FileResponse(archivo, as_attachment=True, filename=_nombre_archivo(empresa, timezone.now()),
                        content_type='application/zip')
