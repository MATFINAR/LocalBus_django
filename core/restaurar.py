"""Restaurar un backup de empresa (el .zip que genera core.backup).

Reglas:
- Solo se restaura un backup de la MISMA empresa (mismo NIT).
- Solo se AGREGA lo que falta: lo que ya existe se deja como está (no se pisa ni se duplica).
- "Ya existe" se decide con datos reales, no con ids (los ids cambian entre bases):
    rutas: código · buses: placa · conductores: cédula (y el correo no puede ser de otro) ·
    turnos: conductor + bus + ruta + inicio · alertas: ruta + tipo + descripción + fecha ·
    mensajes a grupos: texto + fecha · chat: conductor + quién + texto + fecha · ubicaciones: bus + fecha.
  Lo repetido dentro del mismo backup también se cuenta una sola vez.
- Lo que choca con otra empresa (placa, cédula o correo suyos) o con lo que ya hay (un turno que se cruza)
  se rechaza con el motivo, y lo que dependía de ello (sus turnos, mensajes…) también, con su motivo.
- Todo o nada: se hace en una transacción. La "revisión" es la misma restauración deshecha al final, así
  lo que muestra es exactamente lo que pasará.
- No se envían notificaciones (bulk_create no dispara señales) y no se restauran contraseñas ni cuentas
  de administrador.
"""
import json
import secrets
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, time as dtime
from uuid import UUID

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import LineString, MultiPoint, Point
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Alerta, Bus, Conductor, Difusion, Empresa, Mensaje, Ruta, Turno, UbicacionBus, Usuario

FORMATO = 'localbus-backup'
VERSIONES = {1}
MAX_ZIP = 100 * 1024 * 1024          # el .zip subido
MAX_JSON = 400 * 1024 * 1024         # datos.json descomprimido (evita "bombas zip")
MAX_MOTIVOS = 15                     # motivos de rechazo que se muestran por tabla
LOTE = 2000

TITULOS = {'rutas': 'Rutas', 'buses': 'Buses', 'conductores': 'Conductores', 'turnos': 'Turnos',
           'alertas': 'Alertas', 'difusiones': 'Mensajes a grupos', 'mensajes': 'Chat con conductores',
           'ubicaciones': 'Ubicaciones', 'administradores': 'Administradores'}


class BackupInvalido(Exception):
    """El archivo no se puede restaurar en absoluto (mensaje para la persona)."""


# ================= LEER EL ARCHIVO =================

def leer_backup(archivo):
    """Valida el .zip subido y devuelve (datos, bytes del logo o None). Lanza BackupInvalido."""
    if archivo is None:
        raise BackupInvalido('Elige el archivo .zip del backup.')
    if archivo.size > MAX_ZIP:
        raise BackupInvalido(f'El archivo pesa {archivo.size // (1024 * 1024)} MB; el máximo es {MAX_ZIP // (1024 * 1024)} MB.')
    try:
        z = zipfile.ZipFile(archivo)
    except (zipfile.BadZipFile, OSError, ValueError):
        raise BackupInvalido('El archivo no es un .zip válido. Sube el .zip tal como lo descargaste de LocalBus.')
    with z:
        try:
            info = z.getinfo('datos.json')
        except KeyError:
            raise BackupInvalido('Al .zip le falta datos.json: no es un backup de LocalBus o le quitaron archivos.')
        if info.file_size > MAX_JSON:
            raise BackupInvalido('datos.json es demasiado grande para restaurarlo desde la página.')
        try:
            datos = json.loads(z.read(info).decode('utf-8'))
        except (UnicodeDecodeError, ValueError, zipfile.BadZipFile, RuntimeError):
            raise BackupInvalido('datos.json está dañado o fue modificado y no se puede leer.')
        logo = None
        for nombre in z.namelist():
            if nombre.startswith('logo.') and '/' not in nombre:
                if z.getinfo(nombre).file_size <= 5 * 1024 * 1024:
                    logo = z.read(nombre)
                break

    if not isinstance(datos, dict) or datos.get('formato') != FORMATO:
        raise BackupInvalido('Este archivo no es un backup de LocalBus.')
    if datos.get('version') not in VERSIONES:
        raise BackupInvalido(f'El backup es de una versión ({datos.get("version")}) que esta página no sabe restaurar.')
    if not isinstance(datos.get('empresa'), dict) or not isinstance(datos.get('tablas'), dict):
        raise BackupInvalido('El backup está incompleto: le faltan los datos de la empresa o las tablas.')
    for nombre, filas in datos['tablas'].items():
        if not isinstance(filas, list) or not all(isinstance(f, dict) for f in filas):
            raise BackupInvalido(f'La tabla «{nombre}» del backup está dañada.')
    return datos, logo


# ================= INFORME =================

@dataclass
class Resultado:
    nuevos: int = 0
    existentes: int = 0
    rechazados: int = 0
    motivos: list = field(default_factory=list)
    aviso: str = ''

    def rechazar(self, motivo):
        self.rechazados += 1
        if len(self.motivos) < MAX_MOTIVOS:
            self.motivos.append(motivo)


@dataclass
class Informe:
    origen: dict
    tablas: dict = field(default_factory=dict)
    logo: str = ''
    conductores_sin_clave: list = field(default_factory=list)

    def tabla(self, nombre):
        return self.tablas.setdefault(nombre, Resultado())

    @property
    def total_nuevos(self):
        return sum(r.nuevos for r in self.tablas.values())

    @property
    def total_rechazados(self):
        return sum(r.rechazados for r in self.tablas.values())

    def filas(self):
        return [{'titulo': TITULOS.get(n, n), **r.__dict__} for n, r in self.tablas.items()]


# ================= CONVERSIONES =================

class _Invalido(Exception):
    pass


def _fecha(valor, campo, obligatoria=True):
    if valor in (None, ''):
        if obligatoria:
            raise _Invalido(f'le falta {campo}')
        return None
    try:
        momento = datetime.fromisoformat(str(valor))
    except ValueError:
        raise _Invalido(f'{campo} no es una fecha válida ({valor})')
    return momento if timezone.is_aware(momento) else timezone.make_aware(momento)


def _hora(valor):
    if valor in (None, ''):
        return None
    try:
        return dtime.fromisoformat(str(valor))
    except ValueError:
        raise _Invalido(f'la hora {valor} no es válida')


def _texto(fila, campo, maximo, obligatorio=True):
    valor = fila.get(campo)
    if valor is None:
        valor = ''
    if not isinstance(valor, str):
        valor = str(valor)
    valor = valor.strip() if campo not in ('texto',) else valor
    if obligatorio and not valor.strip():
        raise _Invalido(f'le falta {campo}')
    if len(valor) > maximo:
        raise _Invalido(f'{campo} tiene más de {maximo} caracteres')
    return valor


def _numero(valor, campo, tipo=float, defecto=0):
    if valor in (None, ''):
        return defecto
    if isinstance(valor, bool):
        raise _Invalido(f'{campo} no es un número')
    try:
        return tipo(valor)
    except (TypeError, ValueError):
        raise _Invalido(f'{campo} no es un número')


def _coordenada(c):
    if not isinstance(c, (list, tuple)) or len(c) < 2:
        raise _Invalido('una coordenada no es válida')
    lon, lat = float(c[0]), float(c[1])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise _Invalido(f'la coordenada ({lon}, {lat}) está fuera del mapa')
    return lon, lat


def _geometria(valor, tipo):
    """GeoJSON del backup -> geometría con SRID 4326 (lon, lat), o None."""
    if valor in (None, ''):
        return None
    if not isinstance(valor, dict) or valor.get('type') != tipo:
        raise _Invalido(f'la geometría no es un {tipo}')
    try:
        coords = valor.get('coordinates')
        if tipo == 'Point':
            return Point(*_coordenada(coords), srid=4326)
        puntos = [_coordenada(c) for c in coords or []]
        if tipo == 'LineString':
            if len(puntos) < 2:
                raise _Invalido('el trazado tiene menos de dos puntos')
            return LineString(puntos, srid=4326)
        return MultiPoint([Point(*p) for p in puntos], srid=4326) if puntos else None
    except (TypeError, ValueError):
        raise _Invalido('la geometría está dañada')


def _bool(valor, defecto=False):
    if isinstance(valor, bool):
        return valor
    if valor in (None, ''):
        return defecto
    return str(valor).strip().lower() in ('true', '1', 'sí', 'si', 'yes')


def _opcion(valor, opciones, defecto, campo):
    if valor in (None, ''):
        return defecto
    if valor not in opciones:
        raise _Invalido(f'{campo} «{valor}» no es válido')
    return valor


def _id(fila, campo):
    valor = fila.get(campo)
    return valor if isinstance(valor, int) and not isinstance(valor, bool) else None


def _corregir_fechas(modelo, objetos, campo, fechas):
    """bulk_create pone "ahora" en los campos auto_now_add: se vuelve a la fecha original del backup."""
    for obj, fecha in zip(objetos, fechas):
        setattr(obj, campo, fecha)
    modelo.objects.bulk_update(objetos, [campo], batch_size=LOTE)


# ================= RESTAURAR =================

def restaurar(empresa, datos, logo=None, aplicar=False, hecho_por=None):
    """Restaura `datos` (leídos con leer_backup) en `empresa`. Con aplicar=False todo se deshace al final
    (revisión). Devuelve el Informe. Lanza BackupInvalido si el backup no es de esta empresa."""
    origen = datos['empresa']
    if str(origen.get('nit', '')).strip() != empresa.nit.strip():
        raise BackupInvalido(f'Este backup es de «{origen.get("nombre", "otra empresa")}» (NIT {origen.get("nit", "?")}), '
                             f'no de {empresa.nombre} (NIT {empresa.nit}). Solo se puede restaurar un backup de tu empresa.')
    informe = Informe(origen={'nombre': origen.get('nombre', ''), 'generado': datos.get('generado', ''),
                              'generado_por': datos.get('generado_por', '')})
    tablas = datos['tablas']
    with transaction.atomic():
        # Una restauración a la vez por empresa
        Empresa.objects.select_for_update().get(pk=empresa.pk)
        r = _Restauracion(empresa, tablas, informe)
        r.ejecutar()
        if aplicar and logo and not empresa.logo:
            _restaurar_logo(empresa, logo, informe)
        elif logo and not empresa.logo:
            informe.logo = 'Se restaurará el logo del backup (tu empresa no tiene uno ahora).'
        elif logo:
            informe.logo = 'El logo no se cambia: tu empresa ya tiene uno.'
        if not aplicar:
            transaction.set_rollback(True)
    return informe


def _restaurar_logo(empresa, contenido, informe):
    from .views import _procesar_logo
    archivo = ContentFile(contenido, name='logo')
    procesado, error = _procesar_logo(archivo)
    if error:
        informe.logo = f'El logo del backup no se restauró: {error}'
        return
    empresa.logo.save(f'empresa_{empresa.pk}_{secrets.token_hex(5)}.png', procesado, save=True)
    informe.logo = 'Se restauró el logo del backup.'


class _Restauracion:
    def __init__(self, empresa, tablas, informe):
        self.empresa = empresa
        self.tablas = tablas
        self.informe = informe
        # id en el backup -> objeto actual (los rechazados no están: lo que dependa de ellos se rechaza)
        self.rutas, self.buses, self.conductores, self.alertas, self.difusiones = {}, {}, {}, {}, {}

    def filas(self, nombre):
        return self.tablas.get(nombre) or []

    def ejecutar(self):
        self.restaurar_rutas()
        self.restaurar_buses()
        self.restaurar_conductores()
        self.restaurar_turnos()
        self.restaurar_alertas()
        self.restaurar_difusiones()
        self.restaurar_mensajes()
        self.restaurar_ubicaciones()
        if self.filas('administradores'):
            res = self.informe.tabla('administradores')
            res.aviso = ('Las cuentas de administrador no se restauran por seguridad: las crea el administrador '
                         'de LocalBus.')

    # ---------- Rutas ----------
    def restaurar_rutas(self):
        res = self.informe.tabla('rutas')
        actuales = {r.codigo.lower(): r for r in self.empresa.rutas.all()}
        nuevas = []
        for fila in self.filas('rutas'):
            codigo = str(fila.get('codigo') or '').strip()
            try:
                codigo = _texto(fila, 'codigo', 20)
                existente = actuales.get(codigo.lower())
                if existente:
                    self._mapear(self.rutas, fila, 'id_ruta', existente)
                    res.existentes += 1
                    continue
                ruta = Ruta(
                    empresa=self.empresa, codigo=codigo, nombre=_texto(fila, 'nombre', 100),
                    origen=_texto(fila, 'origen', 300, False), destino=_texto(fila, 'destino', 300, False),
                    geometria_ruta=_geometria(fila.get('geometria_ruta'), 'LineString'),
                    punto_origen=_geometria(fila.get('punto_origen'), 'Point'),
                    punto_destino=_geometria(fila.get('punto_destino'), 'Point'),
                    paradas=_geometria(fila.get('paradas'), 'MultiPoint'),
                    distancia_km=_numero(fila.get('distancia_km'), 'distancia_km'),
                    duracion_estimada_minutos=_numero(fila.get('duracion_estimada_minutos'), 'duración', int),
                    frecuencia_minutos=_numero(fila.get('frecuencia_minutos'), 'frecuencia', int),
                    estado=_opcion(fila.get('estado'), {'Activa', 'Fuera_servicio'}, 'Activa', 'el estado'),
                    motivo_fuera_servicio=_texto(fila, 'motivo_fuera_servicio', 180, False),
                    habilitado=_bool(fila.get('habilitado'), True),
                )
                ruta.full_clean(exclude=['empresa', 'alerta_fuera_servicio', 'alerta_inhabilitada'])
            except _Invalido as e:
                res.rechazar(f'Ruta {codigo or "sin código"}: {e}.')
                continue
            except Exception as e:  # ValidationError de Django
                res.rechazar(f'Ruta {codigo or "sin código"}: {_mensaje(e)}.')
                continue
            ruta.save()
            actuales[codigo.lower()] = ruta
            nuevas.append((ruta, fila))
            self._mapear(self.rutas, fila, 'id_ruta', ruta)
            res.nuevos += 1
        self._rutas_nuevas = nuevas
        fechas = [(r, _fecha_o_none(f.get('fecha_creacion'))) for r, f in nuevas]
        fechas = [(r, f) for r, f in fechas if f]
        if fechas:
            _corregir_fechas(Ruta, [r for r, _ in fechas], 'fecha_creacion', [f for _, f in fechas])

    # ---------- Buses ----------
    def restaurar_buses(self):
        res = self.informe.tabla('buses')
        placas = {b.placa.upper(): b for b in Bus.objects.filter(placa__in=[
            str(f.get('placa') or '').strip() for f in self.filas('buses')])}
        # placa__in distingue mayúsculas: se completa con una búsqueda sin distinguir
        for fila in self.filas('buses'):
            placa = str(fila.get('placa') or '').strip()
            try:
                placa = _texto(fila, 'placa', 20)
                existente = placas.get(placa.upper()) or Bus.objects.filter(placa__iexact=placa).first()
                if existente and existente.empresa_id != self.empresa.pk:
                    raise _Invalido(f'la placa ya está registrada en otra empresa')
                if existente:
                    self._mapear(self.buses, fila, 'id_bus', existente)
                    placas[placa.upper()] = existente
                    res.existentes += 1
                    continue
                bus = Bus(empresa=self.empresa, placa=placa, activo=False,   # nadie lo está transmitiendo ahora
                          habilitado=_bool(fila.get('habilitado'), True),
                          ultima_ubicacion=_fecha(fila.get('ultima_ubicacion'), 'última ubicación', False))
                rutas = fila.get('rutas_ids') or []
                if not isinstance(rutas, list):
                    raise _Invalido('la lista de rutas está dañada')
            except _Invalido as e:
                res.rechazar(f'Bus {placa or "sin placa"}: {e}.')
                continue
            bus.save()
            bus.rutas.set([self.rutas[i] for i in rutas if i in self.rutas])
            placas[placa.upper()] = bus
            self._mapear(self.buses, fila, 'id_bus', bus)
            res.nuevos += 1

    # ---------- Conductores ----------
    def restaurar_conductores(self):
        res = self.informe.tabla('conductores')
        for fila in self.filas('conductores'):
            nombre = str(fila.get('nombre') or '').strip() or 'sin nombre'
            try:
                cedula = _texto(fila, 'cedula', 50)
                email = _texto(fila, 'email', 100)
                por_cedula = Conductor.objects.filter(cedula=cedula).first()
                if por_cedula and por_cedula.empresa_id != self.empresa.pk:
                    raise _Invalido(f'la cédula {cedula} ya está registrada en otra empresa')
                if por_cedula:
                    self._mapear(self.conductores, fila, 'id_conductor', por_cedula)
                    res.existentes += 1
                    continue
                if Conductor.objects.filter(email__iexact=email).exists():
                    raise _Invalido(f'el correo {email} ya lo usa otro conductor')
                conductor = Conductor(empresa=self.empresa, nombre=_texto(fila, 'nombre', 100), cedula=cedula,
                                      email=email, telefono=_texto(fila, 'telefono', 15, False),
                                      habilitado=_bool(fila.get('habilitado'), True))
                # El backup no trae contraseñas: queda una al azar que nadie conoce hasta que la empresa asigne una
                conductor.set_contrasena(secrets.token_urlsafe(24))
            except _Invalido as e:
                res.rechazar(f'Conductor {nombre}: {e}.')
                continue
            conductor.save()
            self._mapear(self.conductores, fila, 'id_conductor', conductor)
            self.informe.conductores_sin_clave.append(conductor.nombre)
            res.nuevos += 1

    # ---------- Turnos ----------
    def restaurar_turnos(self):
        res = self.informe.tabla('turnos')
        for fila in self.filas('turnos'):
            descripcion = 'Turno'
            try:
                conductor = self._de(self.conductores, fila, 'conductor_id', 'el conductor')
                bus = self._de(self.buses, fila, 'bus_id', 'el bus')
                ruta = self._de(self.rutas, fila, 'ruta_id', 'la ruta')
                inicio = _fecha(fila.get('inicio'), 'el inicio')
                descripcion = f'Turno de {conductor.nombre} en {bus.placa} ({inicio:%d/%m/%Y %H:%M})'
                if Turno.objects.filter(conductor=conductor, bus=bus, ruta=ruta, inicio=inicio).exists():
                    res.existentes += 1
                    continue
                turno = Turno(conductor=conductor, bus=bus, ruta=ruta, inicio=inicio,
                              fin=_fecha(fila.get('fin'), 'el fin', False), fijo=_bool(fila.get('fijo')),
                              hora_fin=_hora(fila.get('hora_fin')), dias=_texto(fila, 'dias', 13, False),
                              serie=_serie(fila.get('serie')))
                problema = _problema_turno(turno)
                if problema:
                    raise _Invalido(problema)
            except _Invalido as e:
                res.rechazar(f'{descripcion}: {e}.')
                continue
            turno.save()
            if not bus.rutas.filter(pk=ruta.pk).exists():
                bus.rutas.add(ruta)   # el turno dice que el bus cubrió esa ruta
            res.nuevos += 1

    # ---------- Alertas ----------
    def restaurar_alertas(self):
        res = self.informe.tabla('alertas')
        pasajeros = {}
        nuevas, filas_nuevas, vistas = [], [], set()
        for fila in self.filas('alertas'):
            try:
                ruta = self._de(self.rutas, fila, 'ruta_id', 'la ruta')
                tipo = _texto(fila, 'tipo', 200)
                descripcion = _texto(fila, 'descripcion', 200)
                creada = _fecha(fila.get('fecha_creacion'), 'la fecha')
                estado = _opcion(fila.get('estado'), {'Pendiente', 'En_proceso', 'Resuelta', 'Cancelada'}, 'Pendiente', 'el estado')
                clave = (ruta.pk, tipo, descripcion, creada)
                if clave in vistas or Alerta.objects.filter(ruta=ruta, tipo=tipo, descripcion=descripcion,
                                                             fecha_creacion=creada).exists():
                    res.existentes += 1
                    existente = Alerta.objects.filter(ruta=ruta, tipo=tipo, descripcion=descripcion, fecha_creacion=creada).first()
                    if existente:
                        self._mapear(self.alertas, fila, 'id_alerta', existente)
                    continue
                alerta = Alerta(ruta=ruta, tipo=tipo, descripcion=descripcion, estado=estado)
                if fila.get('autor_tipo') == 'pasajero':
                    nick = str(fila.get('autor') or '')
                    if nick not in pasajeros:
                        pasajeros[nick] = Usuario.objects.filter(nickName__iexact=nick).first() if nick else None
                    if pasajeros[nick] is None:
                        raise _Invalido(f'el pasajero «{nick or "?"}» que la creó ya no tiene cuenta')
                    alerta.usuario = pasajeros[nick]
                else:
                    alerta.empresa = self.empresa
            except _Invalido as e:
                res.rechazar(f'Alerta «{str(fila.get("descripcion") or "")[:40]}»: {e}.')
                continue
            vistas.add(clave)
            nuevas.append(alerta)
            filas_nuevas.append(fila)
        # bulk_create no dispara la señal de notificación push: restaurar no avisa a los pasajeros
        Alerta.objects.bulk_create(nuevas, batch_size=LOTE)
        _corregir_fechas(Alerta, nuevas, 'fecha_creacion', [_fecha(f.get('fecha_creacion'), '') for f in filas_nuevas])
        for alerta, fila in zip(nuevas, filas_nuevas):
            self._mapear(self.alertas, fila, 'id_alerta', alerta)
        res.nuevos += len(nuevas)
        # Las rutas nuevas recuperan el enlace a su alerta de "fuera de servicio" o "inhabilitada"
        for ruta, fila in getattr(self, '_rutas_nuevas', []):
            cambios = []
            for campo in ('alerta_fuera_servicio', 'alerta_inhabilitada'):
                alerta = self.alertas.get(_id(fila, campo + '_id'))
                if alerta:
                    setattr(ruta, campo, alerta)
                    cambios.append(campo)
            if cambios:
                ruta.save(update_fields=cambios)

    # ---------- Mensajes a grupos ----------
    def restaurar_difusiones(self):
        res = self.informe.tabla('difusiones')
        nuevas, fechas, filas_nuevas, vistas = [], [], [], set()
        autores = self._autores()
        for fila in self.filas('difusiones'):
            try:
                texto = _texto(fila, 'texto', 1000)
                creado = _fecha(fila.get('creado'), 'la fecha')
                existente = Difusion.objects.filter(empresa=self.empresa, texto=texto, creado=creado).first()
                if existente or (texto, creado) in vistas:
                    if existente:
                        self._mapear(self.difusiones, fila, 'id_difusion', existente)
                    res.existentes += 1
                    continue
                difusion = Difusion(empresa=self.empresa, texto=texto, destino=_texto(fila, 'destino', 200),
                                    grupo=_opcion(fila.get('grupo'), set(Difusion.GRUPOS), 'todos', 'el grupo'),
                                    enviado_por=autores.get(fila.get('enviado_por')))
            except _Invalido as e:
                res.rechazar(f'Mensaje a grupo «{str(fila.get("texto") or "")[:40]}»: {e}.')
                continue
            vistas.add((texto, creado))
            nuevas.append(difusion)
            fechas.append(creado)
            filas_nuevas.append(fila)
        Difusion.objects.bulk_create(nuevas, batch_size=LOTE)
        _corregir_fechas(Difusion, nuevas, 'creado', fechas)
        for difusion, fila in zip(nuevas, filas_nuevas):
            self._mapear(self.difusiones, fila, 'id_difusion', difusion)
        res.nuevos += len(nuevas)

    # ---------- Chat ----------
    def restaurar_mensajes(self):
        res = self.informe.tabla('mensajes')
        autores = self._autores()
        conductores = {c.pk for c in self.conductores.values()}
        existentes = set(Mensaje.objects.filter(conductor_id__in=conductores)
                         .values_list('conductor_id', 'de_empresa', 'texto', 'creado'))
        nuevos, fechas = [], []
        for fila in self.filas('mensajes'):
            try:
                conductor = self._de(self.conductores, fila, 'conductor_id', 'el conductor')
                texto = _texto(fila, 'texto', 1000)
                creado = _fecha(fila.get('creado'), 'la fecha')
                de_empresa = _bool(fila.get('de_empresa'))
                clave = (conductor.pk, de_empresa, texto, creado)
                if clave in existentes:
                    res.existentes += 1
                    continue
                difusion_id = _id(fila, 'difusion_id')
                mensaje = Mensaje(conductor=conductor, de_empresa=de_empresa, texto=texto,
                                  difusion=self.difusiones.get(difusion_id) if difusion_id else None,
                                  enviado_por=autores.get(fila.get('enviado_por')) if de_empresa else None,
                                  leido=_fecha(fila.get('leido'), 'leído', False))
            except _Invalido as e:
                res.rechazar(f'Mensaje «{str(fila.get("texto") or "")[:40]}»: {e}.')
                continue
            existentes.add(clave)
            nuevos.append(mensaje)
            fechas.append(creado)
        Mensaje.objects.bulk_create(nuevos, batch_size=LOTE)
        _corregir_fechas(Mensaje, nuevos, 'creado', fechas)
        res.nuevos += len(nuevos)

    # ---------- Ubicaciones ----------
    def restaurar_ubicaciones(self):
        res = self.informe.tabla('ubicaciones')
        buses = {b.pk for b in self.buses.values()}
        existentes = set(UbicacionBus.objects.filter(bus_id__in=buses).values_list('bus_id', 'timestamp'))
        nuevas, fechas = [], []
        for fila in self.filas('ubicaciones'):
            try:
                bus = self._de(self.buses, fila, 'bus_id', 'el bus')
                ruta = self._de(self.rutas, fila, 'ruta_id', 'la ruta')
                momento = _fecha(fila.get('timestamp'), 'la fecha')
                if (bus.pk, momento) in existentes:
                    res.existentes += 1
                    continue
                lon, lat = _coordenada([_numero(fila.get('longitud'), 'la longitud'), _numero(fila.get('latitud'), 'la latitud')])
                conductor_id = _id(fila, 'conductor_id')
                ubicacion = UbicacionBus(bus=bus, ruta=ruta, latitud=lat, longitud=lon,
                                         velocidad=_numero(fila.get('velocidad'), 'la velocidad'),
                                         conductor=self.conductores.get(conductor_id) if conductor_id else None)
            except _Invalido as e:
                res.rechazar(f'Ubicación del {str(fila.get("timestamp") or "")[:16]}: {e}.')
                continue
            existentes.add((bus.pk, momento))
            nuevas.append(ubicacion)
            fechas.append(momento)
        UbicacionBus.objects.bulk_create(nuevas, batch_size=LOTE)
        _corregir_fechas(UbicacionBus, nuevas, 'timestamp', fechas)
        res.nuevos += len(nuevas)

    # ---------- Ayudas ----------
    def _mapear(self, mapa, fila, campo, obj):
        id_backup = _id(fila, campo)
        if id_backup is not None:
            mapa[id_backup] = obj

    def _de(self, mapa, fila, campo, nombre):
        obj = mapa.get(_id(fila, campo))
        if obj is None:
            raise _Invalido(f'{nombre} no está en el backup o no se pudo restaurar')
        return obj

    def _autores(self):
        """usuario (username) -> cuenta, solo de administradores de esta empresa."""
        if not hasattr(self, '_cache_autores'):
            self._cache_autores = {u.get_username(): u for u in get_user_model().objects.filter(
                administrador__empresa=self.empresa)}
        return self._cache_autores


def _serie(valor):
    if valor in (None, ''):
        return None
    try:
        return UUID(str(valor))
    except ValueError:
        raise _Invalido('la serie del turno está dañada')


def _fecha_o_none(valor):
    try:
        return _fecha(valor, '', False)
    except _Invalido:
        return None


def _problema_turno(turno):
    """Validación de un turno restaurado. Es la de Turno.problema() SIN las reglas de "ahora" (ruta fuera de
    servicio, conductor o bus inhabilitado…): un turno del historial pudo ser válido cuando ocurrió."""
    if turno.fijo and turno.hora_fin is None:
        return 'le falta la hora de fin de la jornada'
    if not turno.fijo and turno.fin is None:
        return 'le falta la hora de fin'
    if turno.fin is not None and turno.fin <= turno.inicio:
        return 'termina antes de empezar'
    if turno.fijo and not turno.dias_semana() <= set(range(7)):
        return 'los días de la semana no son válidos'
    candidatos = Turno.objects.filter(Q(fin__isnull=True) | Q(fin__gt=turno.inicio)).select_related('conductor', 'bus', 'ruta')
    if turno.fin is not None:
        candidatos = candidatos.filter(inicio__lt=turno.fin)
    for choque in candidatos.filter(conductor_id=turno.conductor_id):
        if turno.se_cruza_con(choque):
            return f'se cruza con otro turno del conductor ({choque})'
    for choque in candidatos.filter(bus_id=turno.bus_id):
        if turno.se_cruza_con(choque):
            return f'se cruza con otro turno del bus ({choque})'
    return None


def _mensaje(error):
    if hasattr(error, 'message_dict'):
        return '; '.join(f'{k}: {" ".join(v)}' for k, v in error.message_dict.items())
    return str(error)
