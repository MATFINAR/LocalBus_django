"""API JSON de la app móvil LocalBus (la misma experiencia de la web para invitados y pasajeros).

Reutiliza la lógica, las validaciones y los mensajes de las vistas web (core/views.py): la app ve y hace lo mismo
que un invitado o un pasajero en el sitio, sin la parte de empresa.

Autenticación: el login entrega un token firmado con la SECRET_KEY (como el de la app del conductor). La app lo
envía en "Authorization: Bearer <token>". No se usan cookies, así que estas vistas no necesitan CSRF: un sitio
ajeno no puede hacer que el navegador de nadie envíe esa cabecera.

Los pasos que en la web viven en la sesión (registro pendiente, recuperación de contraseña, cambio de correo)
aquí viajan en tokens firmados de corta duración. El código de 6 dígitos nunca va en el token: solo su HMAC con
la SECRET_KEY, que la app no puede revertir. Los intentos fallidos se cuentan en la caché, como en la web.
"""
import hashlib
import json
import logging
import re
import secrets
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core import signing
from django.db import IntegrityError
from django.db.models import Case, IntegerField, Prefetch, Q, When
from django.http import JsonResponse
from django.utils import timezone, translation
from django.utils.crypto import salted_hmac
from django.utils.dateparse import parse_datetime
from django.utils.timesince import timesince
from django.views.decorators.csrf import csrf_exempt

from . import seguridad
from .models import Alerta, Bus, Empresa, Ruta, RutaAfectada, UbicacionBus, Usuario, TEMAS_PAGINA
from .utils.horas import fecha_hora12, hora12
from .views import (COLORES_RUTA, DIAS_HISTORIAL, ESTADOS_PUBLICOS, FECHA_DOCUMENTOS_LEGALES, MAX_ALERTAS_LISTA,
                    MINUTOS_SIN_SENAL, TEXTO_CONFIRMACION, TIPOS_ALERTA, _alerta_misma_cercana, _leer_ubicacion,
                    _limite_reportes, _publicar_si_corresponde, _ruta_valida, _rutas_en_rango, _rutas_publicas,
                    _sumar_reporte, _texto_muy_largo, _validar_alerta, _ya_reporto, enviar_correo_html,
                    generar_sugerencias_nickname)

logger = logging.getLogger(__name__)

# Días que dura la sesión de la app (se renueva al volver a iniciar sesión)
TOKEN_DIAS = int(getattr(settings, 'PASAJERO_TOKEN_DIAS', 30))
MINUTOS_CODIGO = 15
_SAL_TOKEN = 'localbus.pasajero.token'
_SAL_REGISTRO = 'localbus.pasajero.registro'
_SAL_RECUPERACION = 'localbus.pasajero.recuperacion'
_SAL_CAMBIO_CORREO = 'localbus.pasajero.cambio_correo'


class _Invalida(Exception):
    """Datos mal formados: se responde 400 con este mensaje."""


# ================= SESIÓN DE LA APP =================

def _huella(usuario):
    """Cambia cuando cambia la contraseña: los tokens viejos dejan de servir."""
    return hashlib.sha256(usuario.contrasena.encode()).hexdigest()[:16]


def token_pasajero(usuario):
    return signing.dumps({'u': usuario.pk, 'h': _huella(usuario)}, salt=_SAL_TOKEN, compress=True)


def _pasajero_del_token(request):
    """(usuario, None), (None, None) sin token, o (None, respuesta 401) si el token no sirve."""
    cabecera = request.headers.get('Authorization', '')
    if not cabecera.startswith('Bearer '):
        return None, None
    try:
        datos = signing.loads(cabecera[7:].strip(), salt=_SAL_TOKEN, max_age=TOKEN_DIAS * 86400)
    except signing.SignatureExpired:
        return None, _error('Tu sesión expiró. Inicia sesión de nuevo.', 401, sesion=False)
    except signing.BadSignature:
        return None, _error('Tu sesión ya no es válida. Inicia sesión de nuevo.', 401, sesion=False)
    usuario = Usuario.objects.filter(pk=datos.get('u')).first()
    if usuario is None or datos.get('h') != _huella(usuario):
        return None, _error('Tu sesión ya no es válida. Inicia sesión de nuevo.', 401, sesion=False)
    return usuario, None


def _error(mensaje, status=400, **extra):
    return JsonResponse({'ok': False, 'error': mensaje, **extra}, status=status)


def _ok(**datos):
    return JsonResponse({'ok': True, **datos})


def api(metodo='GET', sesion=False):
    """Vista de la API: método, cuerpo JSON en request.datos, pasajero en request.pasajero.
    sesion=True exige un pasajero con sesión iniciada."""
    def decorador(vista):
        @csrf_exempt
        @wraps(vista)
        def envoltura(request, *args, **kwargs):
            if request.method != metodo:
                return _error('Método no permitido', 405)
            usuario, error = _pasajero_del_token(request)
            if error is not None:
                return error
            if sesion and usuario is None:
                return _error('Inicia sesión para continuar.', 401, sesion=False)
            request.pasajero = usuario
            try:
                request.datos = {}
                if metodo == 'POST':
                    try:
                        request.datos = json.loads(request.body or b'{}')
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        raise _Invalida('JSON inválido')
                    if not isinstance(request.datos, dict):
                        raise _Invalida('El cuerpo debe ser un objeto JSON')
                return vista(request, *args, **kwargs)
            except _Invalida as e:
                return _error(str(e), 400)
            except Exception:
                logger.exception('Error interno en la API móvil')
                return _error('Error interno del servidor. Inténtalo de nuevo.', 500)
        return envoltura
    return decorador


def _texto(datos, campo):
    valor = datos.get(campo)
    return valor.strip() if isinstance(valor, str) else ''


def _hmac_codigo(proposito, codigo, extra=''):
    return salted_hmac('localbus.codigo.' + proposito, f'{codigo}|{extra}').hexdigest()


def _codigo_correcto(proposito, ingresado, guardado, extra=''):
    ingresado = (ingresado or '').strip()
    return bool(ingresado and guardado) and secrets.compare_digest(_hmac_codigo(proposito, ingresado, extra), guardado)


# ================= DATOS =================

def _color(ruta_id):
    return COLORES_RUTA[abs(int(ruta_id or 0)) % len(COLORES_RUTA)]


def _ruta(r, trazado=True):
    datos = {
        'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'empresa': r.empresa.nombre,
        'origen': r.origen, 'destino': r.destino, 'fin': r.fin or r.origen,
        'fin_es_origen': r.fin_es_origen, 'distancia_km': r.distancia_km,
        'duracion_estimada_minutos': r.duracion_estimada_minutos, 'frecuencia_minutos': r.frecuencia_minutos or 0,
        'estado': r.estado_visible, 'estado_nombre': r.nombre_estado_visible,
        'motivo': r.motivo_visible, 'color': _color(r.id_ruta),
    }
    if trazado:
        datos['coordenadas'] = r.get_coordenadas_ruta()
        datos.update(r.puntos_clave())  # inicio, retorno y fin para los pines; índice del retorno
    return datos


def _ruta_opcion(r):
    return {'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'color': _color(r.id_ruta)}


def _usuario(u):
    return {'id': u.id_usuario, 'nombre': u.nombre, 'email': u.email, 'nickName': u.nickName,
            'telefono': u.telefono or '', 'color_perfil': u.color_perfil, 'iniciales': u.iniciales, 'tema': u.tema}


def _hace(fecha):
    with translation.override('es'):
        return timesince(fecha).split(',')[0]


def _puede_modificar(usuario, alerta):
    """Igual que en la web: quien creó la alerta, mientras siga Pendiente."""
    return usuario is not None and alerta.usuario_id == usuario.pk and alerta.estado == 'Pendiente'


def _alerta(a, usuario=None):
    return {
        'id': a.id_alerta, 'tipo': a.tipo, 'descripcion': a.descripcion, 'estado': a.estado,
        'ruta_id': a.ruta_id, 'ruta_codigo': a.ruta.codigo, 'ruta_nombre': a.ruta.nombre,
        'ruta_origen': a.ruta.origen, 'ruta_destino': a.ruta.destino, 'color': _color(a.ruta_id),
        'fecha': fecha_hora12(a.fecha_creacion, '%d/%m/%Y'), 'fecha_iso': a.fecha_creacion.isoformat(),
        'empresa': a.empresa.nombre if a.empresa_id else '',
        'vence': hora12(a.vence_en) if a.estado == 'En_proceso' and a.vence_en else '',
        'de_pasajero': bool(a.usuario_id), 'editable': _puede_modificar(usuario, a),
        # Rutas a las que afecta, cada una con su estado (la principal primero)
        'rutas': [{'id': r.pk, 'codigo': r.codigo, 'nombre': r.nombre, 'color': _color(r.pk), 'estado': e}
                  for r, e in a.rutas_con_estado()],
    }


def _reporte(r, usuario):
    """Una alerta en «Mis reportes»: en qué quedó (también si se sumó a otra o la descartaron)."""
    datos = _alerta(r, usuario)
    principal = r.alerta_principal if r.alerta_principal_id else None
    datos.update({
        'confirmacion': r.confirmacion,
        'sumada': principal.descripcion if principal else '',
        'sumada_empresa': principal.empresa.nombre if principal and principal.empresa_id else '',
        'descartada': r.descartada_por_empresa,
        'motivo': r.get_motivo_descarte_display() if r.descartada_por_empresa else '',
    })
    return datos


# ================= MAPA, RUTAS Y ACERCA DE (públicos) =================

@api()
def mapa(request):
    """Lo mismo que la página del mapa: rutas públicas con su estado y los avisos vigentes."""
    Alerta.cerrar_vencidas()
    rutas = Ruta.marcar_operacion(_rutas_publicas().select_related('empresa').order_by('codigo'),
                                  minutos_sin_senal=MINUTOS_SIN_SENAL)
    # También las que siguen en proceso en una ruta afectada (aunque su ruta principal ya esté resuelta)
    avisos = (Alerta.objects.filter(Alerta.vigente_en([r.pk for r in rutas]), alerta_principal__isnull=True)
              .distinct().select_related('ruta').prefetch_related(Prefetch('rutas_afectadas', queryset=RutaAfectada.objects.select_related('ruta')))
              .order_by('-fecha_creacion')[:15])
    return _ok(
        rutas=[_ruta(r) for r in rutas],
        total_activas=sum(r.estado_visible == 'Activa' for r in rutas),
        avisos=[{'id': a.id_alerta, 'tipo': a.tipo, 'descripcion': a.descripcion, 'ruta': a.nombre_rutas_vigentes,
                 'ruta_id': a.ruta_id, 'rutas_ids': [r.pk for r in a.rutas_vigentes()],
                 'hace': _hace(a.fecha_creacion)} for a in avisos],
    )


@api()
def acerca(request):
    hace_poco = timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL)
    return _ok(
        cifras={
            'empresas': Empresa.objects.filter(activa=True, rutas__habilitado=True).distinct().count(),
            'rutas': _rutas_publicas().count(),
            'buses': Bus.objects.filter(habilitado=True, empresa__activa=True).count(),
            'en_vivo': (UbicacionBus.objects.filter(timestamp__gte=hace_poco, bus__habilitado=True,
                                                    bus__empresa__activa=True).values('bus').distinct().count()),
        },
        contacto_email=settings.CONTACTO_LEGAL_EMAIL,
        fecha_documentos=FECHA_DOCUMENTOS_LEGALES,
    )


# ================= ALERTAS =================

def _dias(request):
    try:
        dias = int(request.GET.get('dias', DIAS_HISTORIAL[0]))
    except (TypeError, ValueError):
        return DIAS_HISTORIAL[0]
    return dias if dias in DIAS_HISTORIAL else DIAS_HISTORIAL[0]


@api()
def alertas(request):
    """El centro de alertas del invitado o del pasajero: publicadas, «Mis reportes» y rutas que sigue."""
    Alerta.cerrar_vencidas()
    usuario = request.pasajero
    dias = _dias(request)
    recientes = (Q(estado__in=('Pendiente', 'En_proceso'))
                 | Q(estado='Resuelta', fecha_creacion__gte=timezone.now() - timedelta(days=dias)))
    vigentes_primero = Case(When(estado='Pendiente', then=0), When(estado='En_proceso', then=1), default=2,
                            output_field=IntegerField())
    lista = list(Alerta.objects.select_related('usuario', 'empresa', 'ruta')
                 .filter(alerta_principal__isnull=True).filter(recientes).filter(estado__in=ESTADOS_PUBLICOS)
                 .order_by(vigentes_primero, '-fecha_creacion')
                 .prefetch_related(Prefetch('rutas_afectadas', queryset=RutaAfectada.objects.select_related('ruta')))[:MAX_ALERTAS_LISTA + 1])
    recortada = len(lista) > MAX_ALERTAS_LISTA
    lista = lista[:MAX_ALERTAS_LISTA]

    mis_reportes, seguidas = [], []
    if usuario:
        mis_reportes = list(Alerta.objects.filter(usuario=usuario)
                            .select_related('ruta', 'usuario', 'empresa', 'alerta_principal',
                                            'alerta_principal__empresa')
                            .prefetch_related(Prefetch('rutas_afectadas', queryset=RutaAfectada.objects.select_related('ruta')))
                            .order_by('-fecha_creacion')[:50])
        seguidas = list(Usuario.rutas_seguidas.through.objects.filter(usuario_id=usuario.pk)
                        .values_list('ruta_id', flat=True))

    return _ok(
        alertas=[_alerta(a, usuario) for a in lista],
        recortada=recortada,
        max_alertas=MAX_ALERTAS_LISTA,
        dias=dias,
        dias_opciones=list(DIAS_HISTORIAL),
        mis_reportes=[_reporte(r, usuario) for r in mis_reportes],
        rutas_seguidas=seguidas,
        rutas=[_ruta_opcion(r) for r in Ruta.objects.filter(habilitado=True).order_by('nombre')],
    )


@api(sesion=True)
def rutas_cercanas(request):
    lat, lon = _leer_ubicacion(request.GET)
    return _ok(rutas=[_ruta_opcion(r) for r in _rutas_en_rango(lat, lon)])


@api(sesion=True)
def alerta_cercana(request):
    """¿Ya hay una alerta igual cerca? No devuelve el texto de las que la empresa aún no publicó."""
    lat, lon = _leer_ubicacion(request.GET)
    tipo = request.GET.get('tipo')
    if tipo not in TIPOS_ALERTA or not _ruta_valida(request.GET.get('ruta')):
        return _ok(existe=False)
    alerta = _alerta_misma_cercana(request.GET.get('ruta'), tipo, lat, lon)
    if alerta is None:
        return _ok(existe=False)
    publica = alerta.estado in ESTADOS_PUBLICOS
    return _ok(
        existe=True, publica=publica, de_empresa=bool(alerta.empresa_id),
        descripcion=alerta.descripcion if publica else '',
        reportes=1 + alerta.relacionadas.exclude(estado='Cancelada').count(),
        ya_reportaste=_ya_reporto(request.pasajero.pk, alerta),
    )


@api('POST', sesion=True)
def crear_alerta(request):
    usuario, datos = request.pasajero, request.datos
    ruta_id = str(datos.get('ruta') or '')
    tipo = _texto(datos, 'tipo')
    descripcion = _texto(datos, 'descripcion')
    error = _validar_alerta(ruta_id, tipo, descripcion) or _limite_reportes(usuario.pk)
    if error:
        return _error(error)

    lat, lon = _leer_ubicacion(datos)
    if lat is not None and not _rutas_en_rango(lat, lon).filter(id_ruta=ruta_id).exists():
        return _error('Solo puedes reportar rutas que pasen a 500 m o menos de tu ubicación.')
    principal = _alerta_misma_cercana(ruta_id, tipo, lat, lon)
    if principal is not None:
        if _ya_reporto(usuario.pk, principal):
            return _ok(nivel='info', mensaje='Ya habías reportado este problema: tu reporte sigue contando. '
                                             'Puedes ver en qué va en «Mis reportes».')
        _sumar_reporte(usuario.pk, principal, descripcion, lat, lon)
        return _ok(nivel='success', mensaje='Ya había una alerta igual: sumamos tu reporte a ella. La empresa verá '
                                            'que más de una persona la reportó.')

    nueva = Alerta.objects.create(usuario=usuario, ruta_id=ruta_id, tipo=tipo, descripcion=descripcion,
                                  estado='Pendiente', latitud=lat, longitud=lon)
    nueva.rutas_cercanas.set(_rutas_en_rango(lat, lon).exclude(id_ruta=ruta_id))
    return _ok(nivel='success', mensaje='Enviamos tu alerta. Quedó pendiente: se publicará cuando la empresa de la '
                                        'ruta la revise. Puedes seguirla en «Mis reportes».')


@api('POST', sesion=True)
def sumarse_alerta(request):
    """«Yo también lo veo»: la alerta se busca de nuevo con la ubicación (no se confía en un id)."""
    usuario, datos = request.pasajero, request.datos
    ruta_id, tipo = str(datos.get('ruta') or ''), _texto(datos, 'tipo')
    lat, lon = _leer_ubicacion(datos)
    if not _ruta_valida(ruta_id) or tipo not in TIPOS_ALERTA:
        return _error('No pudimos identificar la alerta. Elige la ruta y el tipo de nuevo.')
    principal = _alerta_misma_cercana(ruta_id, tipo, lat, lon)
    if principal is None:
        return _error('Esa alerta ya no está abierta. Si el problema sigue, crea un reporte nuevo.')
    if _ya_reporto(usuario.pk, principal):
        return _ok(nivel='info', mensaje='Ya habías reportado este problema: tu reporte sigue contando.')
    error = _limite_reportes(usuario.pk)
    if error:
        return _error(error)
    _sumar_reporte(usuario.pk, principal, TEXTO_CONFIRMACION, lat, lon, confirmacion=True)
    return _ok(nivel='success', mensaje='Gracias: sumamos tu confirmación. Entre más personas lo confirman, antes '
                                        'lo ve la empresa.')


def _alerta_propia(usuario, id_alerta, accion):
    alerta = Alerta.objects.filter(id_alerta=id_alerta).select_related('ruta').first()
    if alerta is None:
        return None, _error(f'La alerta que intentas {accion} no existe.', 404)
    if not _puede_modificar(usuario, alerta):
        return None, _error(f'Solo puedes {accion} tu alerta mientras esté pendiente; después la gestiona la empresa '
                            f'de la ruta.', 403)
    return alerta, None


@api('POST', sesion=True)
def editar_alerta(request, id_alerta):
    alerta, error = _alerta_propia(request.pasajero, id_alerta, 'editar')
    if error:
        return error
    datos = request.datos
    ruta_id, tipo, descripcion = str(datos.get('ruta') or ''), _texto(datos, 'tipo'), _texto(datos, 'descripcion')
    mensaje = _validar_alerta(ruta_id, tipo, descripcion)
    if mensaje:
        return _error(mensaje)
    estado_anterior = alerta.estado
    if str(alerta.ruta_id) != ruta_id or alerta.tipo != tipo:
        # Ya no es el mismo problema que reportaron los demás: esos reportes quedan como alertas propias
        alerta.relacionadas.update(alerta_principal=None)
        alerta.alerta_principal = None
    alerta.ruta_id, alerta.tipo, alerta.descripcion = ruta_id, tipo, descripcion
    alerta.estado = 'Pendiente'
    alerta.confirmacion = False
    alerta.save()
    _publicar_si_corresponde(alerta, estado_anterior)
    return _ok(nivel='success', mensaje='Guardamos los cambios. La alerta vuelve a quedar pendiente hasta que la '
                                        'empresa la revise.')


@api('POST', sesion=True)
def inhabilitar_alerta(request, id_alerta):
    alerta, error = _alerta_propia(request.pasajero, id_alerta, 'inhabilitar')
    if error:
        return error
    alerta.estado = 'Cancelada'
    alerta.motivo_descarte = ''
    alerta.vence_en = None
    alerta.save(update_fields=['estado', 'motivo_descarte', 'vence_en'])
    alerta.relacionadas.exclude(estado='Cancelada').update(estado='Cancelada', motivo_descarte='')
    return _ok(nivel='success', mensaje='Alerta inhabilitada.')


@api('POST', sesion=True)
def seguir_rutas(request):
    ids = request.datos.get('rutas') or []
    if not isinstance(ids, list) or len(ids) > 500:
        raise _Invalida('rutas debe ser una lista de ids de ruta')
    rutas = Ruta.objects.filter(pk__in=[i for i in ids if str(i).isdigit()], habilitado=True)
    request.pasajero.rutas_seguidas.set(rutas)
    n = rutas.count()
    return _ok(rutas_seguidas=list(rutas.values_list('id_ruta', flat=True)), nivel='success',
               mensaje=f'Listo: te avisaremos de las alertas de {n} ruta{"s" if n != 1 else ""}.' if n
               else 'Listo: te avisaremos de las alertas de todas las rutas.')


@api()
def notificaciones(request):
    """Alertas publicadas desde `publicadas_desde` (las que avisa la app). Con sesión, solo las de las rutas
    que sigue el pasajero (si no sigue ninguna, todas). Sin `publicadas_desde`, solo marca el punto de partida."""
    Alerta.cerrar_vencidas()
    publicadas_desde = None
    if request.GET.get('publicadas_desde'):
        publicadas_desde = parse_datetime(request.GET['publicadas_desde'])
        if publicadas_desde is None:
            raise _Invalida('publicadas_desde debe ser una fecha ISO 8601')
        if timezone.is_naive(publicadas_desde):
            publicadas_desde = timezone.make_aware(publicadas_desde)
    if publicadas_desde is None:
        return _ok(alertas=[], cursor=timezone.now().isoformat())

    lista = (Alerta.objects.filter(estado__in=ESTADOS_PUBLICOS, alerta_principal__isnull=True,
                                   fecha_publicacion__gt=publicadas_desde)
             .select_related('ruta').order_by('-fecha_publicacion', '-id_alerta'))
    if request.pasajero:
        seguidas = list(Usuario.rutas_seguidas.through.objects.filter(usuario_id=request.pasajero.pk)
                        .values_list('ruta_id', flat=True))
        if seguidas:
            lista = lista.filter(Alerta.toca_rutas(seguidas)).distinct()
    lista = list(lista.prefetch_related(Prefetch('rutas_afectadas', queryset=RutaAfectada.objects.select_related('ruta')))[:20])
    fechas = [a.fecha_publicacion for a in lista if a.fecha_publicacion]
    return _ok(alertas=[{'id': a.id_alerta, 'tipo': a.tipo, 'descripcion': a.descripcion,
                         'ruta': a.nombre_rutas_vigentes if a.estado == 'En_proceso' else a.ruta.nombre}
                        for a in lista],
               cursor=(max(fechas) if fechas else publicadas_desde).isoformat())


# ================= INICIO DE SESIÓN Y REGISTRO =================

@api('POST')
def login(request):
    identificador = _texto(request.datos, 'identificador')
    contrasena = request.datos.get('contrasena') or ''
    if not identificador or not contrasena:
        return _error('Escribe tu usuario o tu correo y tu contraseña.')
    bloqueo = seguridad.login_bloqueado(request, identificador)
    if bloqueo:
        return _error(bloqueo, 429)
    usuario = (Usuario.objects.filter(email__iexact=identificador).first()
               or Usuario.objects.filter(nickName__iexact=identificador).first())
    if usuario is None:
        make_password(contrasena)  # mismo tiempo de respuesta que con una cuenta existente
    if usuario is None or not usuario.verificar_contrasena(contrasena):
        seguridad.login_fallido(request, identificador)
        return _error('Correo, nombre de usuario o contraseña incorrectos.')
    seguridad.login_exitoso(identificador)
    bienvenida = not usuario.vio_bienvenida
    if bienvenida:
        usuario.vio_bienvenida = True
        usuario.save(update_fields=['vio_bienvenida'])
    return _ok(token=token_pasajero(usuario), usuario=_usuario(usuario), mostrar_bienvenida=bienvenida,
               mensaje=f'¡Bienvenido, {usuario.nombre}! Inicio de sesión exitoso.')


@api(sesion=True)
def yo(request):
    return _ok(usuario=_usuario(request.pasajero))


@api('POST')
def disponible(request):
    """¿Ya está en uso este correo, nombre de usuario o teléfono? Con sesión no cuenta los del propio pasajero."""
    if not seguridad.consulta_permitida(request):
        return _error('Demasiadas consultas. Espera unos minutos.', 429)
    campo, valor = _texto(request.datos, 'campo'), _texto(request.datos, 'valor')
    filtros = {'email': 'email__iexact', 'nickname': 'nickName__iexact', 'telefono': 'telefono'}
    if campo not in filtros:
        raise _Invalida('campo debe ser email, nickname o telefono')
    if not valor:
        return _ok(existe=False, sugerencias=[])
    otros = Usuario.objects.filter(**{filtros[campo]: valor.lower() if campo == 'email' else valor})
    if request.pasajero:
        otros = otros.exclude(pk=request.pasajero.pk)
    existe = otros.exists()
    return _ok(existe=existe,
               sugerencias=generar_sugerencias_nickname(valor) if existe and campo == 'nickname' else [])


@api('POST')
def revisar_contrasena(request):
    """Las reglas de la contraseña mientras se escribe. En el registro llegan los datos del formulario; en la
    recuperación llega el `permiso` y se compara con los datos de esa cuenta, como al guardarla."""
    datos = request.datos
    contrasena = datos.get('password') or ''
    if datos.get('permiso'):
        try:
            permiso = signing.loads(_texto(datos, 'permiso'), salt=_SAL_RECUPERACION, max_age=MINUTOS_CODIGO * 60)
        except signing.BadSignature:
            return _ok(error=seguridad.error_contrasena(contrasena))
        usuario = Usuario.objects.filter(email__iexact=permiso.get('e', '')).first()
        if usuario is None:
            return _ok(error=seguridad.error_contrasena(contrasena))
        return _ok(error=seguridad.error_contrasena(contrasena, usuario.nombre, usuario.email, usuario.nickName))
    nombre = f"{_texto(datos, 'nombre')} {_texto(datos, 'apellido')}".strip()
    return _ok(error=seguridad.error_contrasena(contrasena, nombre, _texto(datos, 'email').lower(),
                                                _texto(datos, 'username')))


def _enviar_codigo(nombre, codigo, mensaje, destino, asunto='Código de Verificación - LocalBus'):
    enviar_correo_html(asunto=asunto, template='core/emails/codigo_verificacion.html',
                       contexto={'nombre': nombre, 'codigo': codigo, 'mensaje': mensaje}, destinatario=destino)


@api('POST')
def registro(request):
    datos = request.datos
    nombre, apellido = _texto(datos, 'nombre'), _texto(datos, 'apellido')
    email, nick = _texto(datos, 'email').lower(), _texto(datos, 'username')
    contrasena, contrasena2 = datos.get('password') or '', datos.get('password2') or ''
    telefono = _texto(datos, 'telefono') or None

    if not all([nombre, apellido, email, nick, contrasena]):
        return _error('Completa todos los campos obligatorios.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        return _error('Escribe un correo electrónico válido.')
    if not datos.get('terminos'):
        return _error('Para crear la cuenta debes aceptar los términos y condiciones y la política de privacidad.')
    if contrasena != contrasena2:
        return _error('Las contraseñas no coinciden.')
    error = seguridad.error_contrasena(contrasena, f'{nombre} {apellido}', email, nick)
    if error:
        return _error(error)
    if _texto_muy_largo(Usuario, nombre=f'{nombre} {apellido}'):
        return _error(f'El nombre y el apellido juntos admiten máximo '
                      f'{Usuario._meta.get_field("nombre").max_length} caracteres.')
    error = _texto_muy_largo(Usuario, email=email, nickName=nick, contrasena=contrasena)
    if error:
        return _error(error)
    if Usuario.objects.filter(email__iexact=email).exists():
        return _error('El correo electrónico ya está registrado.')
    if Usuario.objects.filter(nickName__iexact=nick).exists():
        return _error('El nombre de usuario ya está registrado.')
    if telefono:
        if not telefono.isdigit() or not 7 <= len(telefono) <= 15:
            return _error('El teléfono debe contener solo números (entre 7 y 15 dígitos).')
        if Usuario.objects.filter(telefono=telefono).exists():
            return _error('El teléfono ya está registrado.')
    if seguridad.envio_bloqueado(request, email):
        return _error('Ya enviamos varios códigos. Espera unos minutos antes de volver a intentarlo.', 429)

    codigo = seguridad.generar_codigo()
    try:
        seguridad.envio_registrado(request, email)
        _enviar_codigo(nombre, codigo, 'Gracias por registrarte en LocalBus. Para completar tu registro, '
                                       'ingresa el siguiente código:', email)
    except Exception:
        logger.exception('No se pudo enviar el correo de verificación del registro (app)')
        return _error('No pudimos enviar el correo de verificación. Revisa el correo e inténtalo más tarde.')
    seguridad.limpiar('codigo:registro', email)
    pendiente = signing.dumps({'n': f'{nombre} {apellido}', 'e': email, 'k': nick, 'p': make_password(contrasena),
                               't': telefono, 'c': _hmac_codigo('registro', codigo, email)},
                              salt=_SAL_REGISTRO, compress=True)
    return _ok(pendiente=pendiente, email=email, minutos=MINUTOS_CODIGO)


@api('POST')
def registro_verificar(request):
    try:
        datos = signing.loads(_texto(request.datos, 'pendiente'), salt=_SAL_REGISTRO, max_age=MINUTOS_CODIGO * 60)
    except signing.SignatureExpired:
        return _error('El código ha expirado. Vuelve a registrarte.', reiniciar=True)
    except signing.BadSignature:
        return _error('No encontramos tu registro. Vuelve a registrarte.', reiniciar=True)

    email = datos.get('e', '')
    if not _codigo_correcto('registro', _texto(request.datos, 'codigo'), datos.get('c'), email):
        fallos = seguridad.contar('codigo:registro', email, MINUTOS_CODIGO * 60)
        if fallos >= seguridad.CODIGO_FALLOS:
            return _error('Demasiados intentos con un código incorrecto. Vuelve a registrarte para recibir uno nuevo.',
                          reiniciar=True)
        restantes = seguridad.CODIGO_FALLOS - fallos
        return _error(f'Código incorrecto. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.')
    if seguridad.superado('codigo:registro', email, seguridad.CODIGO_FALLOS):
        return _error('Demasiados intentos con un código incorrecto. Vuelve a registrarte para recibir uno nuevo.',
                      reiniciar=True)

    try:
        Usuario.objects.create(nombre=datos.get('n'), email=email, nickName=datos.get('k'),
                               contrasena=datos.get('p'), telefono=datos.get('t'))
    except IntegrityError:
        return _error('El correo, nombre de usuario o teléfono ya fue registrado por otra persona. '
                      'Vuelve a registrarte con otros datos.', reiniciar=True)
    seguridad.limpiar('codigo:registro', email)
    return _ok(email=email, mensaje=f'¡Registro exitoso! Tu cuenta ha sido creada. Ya puedes iniciar sesión '
                                    f'con {email}.')


# ================= RECUPERAR LA CONTRASEÑA =================

@api('POST')
def recuperar(request):
    email = _texto(request.datos, 'email').lower()
    if not email:
        return _error('Escribe tu correo.')
    if seguridad.envio_bloqueado(request, email):
        return _error('Ya enviamos varios códigos. Espera unos minutos antes de volver a intentarlo.', 429)
    seguridad.envio_registrado(request, email)
    respuesta = _ok(email=email, mensaje='Si el correo está registrado, te enviamos un código de 6 dígitos.')

    usuario = Usuario.objects.filter(email__iexact=email).first()
    if usuario is None:
        return respuesta  # la misma respuesta exista o no el correo
    codigo = seguridad.generar_codigo()
    usuario.codigo_recuperacion = codigo
    usuario.codigo_expiracion = timezone.now() + timedelta(minutes=MINUTOS_CODIGO)
    usuario.save(update_fields=['codigo_recuperacion', 'codigo_expiracion'])
    seguridad.limpiar('codigo:recuperacion', email)
    try:
        _enviar_codigo(usuario.nombre, codigo, 'Recibimos una solicitud para restablecer tu contraseña. '
                                               'Ingresa el siguiente código:', usuario.email,
                       asunto='Recuperación de Contraseña - LocalBus')
    except Exception:
        logger.exception('No se pudo enviar el correo de recuperación de contraseña (app)')
    return respuesta


@api('POST')
def recuperar_verificar(request):
    email = _texto(request.datos, 'email').lower()
    usuario = Usuario.objects.filter(email__iexact=email).first() if email else None
    vigente = (usuario is not None and usuario.codigo_expiracion is not None
               and usuario.codigo_expiracion > timezone.now())
    if vigente and seguridad.codigos_iguales(_texto(request.datos, 'codigo'), usuario.codigo_recuperacion):
        seguridad.limpiar('codigo:recuperacion', email)
        permiso = signing.dumps({'e': usuario.email, 'h': _huella(usuario)}, salt=_SAL_RECUPERACION)
        return _ok(permiso=permiso)

    fallos = seguridad.contar('codigo:recuperacion', email, MINUTOS_CODIGO * 60)
    if fallos >= seguridad.CODIGO_FALLOS:
        if usuario is not None:
            Usuario.objects.filter(pk=usuario.pk).update(codigo_recuperacion=None, codigo_expiracion=None)
        seguridad.limpiar('codigo:recuperacion', email)
        return _error('Demasiados intentos con un código incorrecto. Solicita un código nuevo.', reiniciar=True)
    restantes = seguridad.CODIGO_FALLOS - fallos
    return _error(f'Código incorrecto o expirado. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.')


@api('POST')
def recuperar_nueva(request):
    try:
        datos = signing.loads(_texto(request.datos, 'permiso'), salt=_SAL_RECUPERACION, max_age=MINUTOS_CODIGO * 60)
    except signing.BadSignature:
        return _error('La recuperación venció. Vuelve a solicitar el código.', reiniciar=True)
    usuario = Usuario.objects.filter(email__iexact=datos.get('e', '')).first()
    if usuario is None or datos.get('h') != _huella(usuario):
        return _error('La cuenta ya no existe o la contraseña ya cambió. Vuelve a solicitar la recuperación.',
                      reiniciar=True)
    pass1, pass2 = request.datos.get('password1') or '', request.datos.get('password2') or ''
    if not pass1 or pass1 != pass2:
        return _error('Las contraseñas no coinciden.')
    error = seguridad.error_contrasena(pass1, usuario.nombre, usuario.email, usuario.nickName)
    if error:
        return _error(error)
    usuario.set_contrasena(pass1)
    usuario.codigo_recuperacion = None
    usuario.codigo_expiracion = None
    usuario.save()
    return _ok(email=usuario.email, mensaje='Contraseña actualizada. Ya puedes iniciar sesión.')


# ================= MI PERFIL =================

@api('POST', sesion=True)
def perfil(request):
    usuario, datos = request.pasajero, request.datos
    nombre, email, nick = _texto(datos, 'nombre'), _texto(datos, 'email').lower(), _texto(datos, 'nickName')
    telefono, color = _texto(datos, 'telefono'), _texto(datos, 'color_perfil')
    if not nombre or not email or not nick:
        return _error('Nombre, correo y nombre de usuario son obligatorios.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        return _error('Escribe un correo electrónico válido.')
    error = _texto_muy_largo(Usuario, nombre=nombre, email=email, nickName=nick)
    if error:
        return _error(error)
    if color and not re.fullmatch(r'#[0-9A-Fa-f]{6}', color):
        return _error('El color de perfil no es válido.')
    if Usuario.objects.filter(email__iexact=email).exclude(pk=usuario.pk).exists():
        return _error('Ese correo ya está en uso por otro usuario.')
    if Usuario.objects.filter(nickName__iexact=nick).exclude(pk=usuario.pk).exists():
        return _error('Ese nombre de usuario ya está en uso.')
    if telefono:
        if not telefono.isdigit():
            return _error('El teléfono solo debe contener números.')
        if not 7 <= len(telefono) <= 15:
            return _error('El teléfono debe tener entre 7 y 15 dígitos.')
        if Usuario.objects.filter(telefono=telefono).exclude(pk=usuario.pk).exists():
            return _error('Ese teléfono ya está registrado.')

    # El correo nuevo no se guarda todavía: primero hay que confirmar que es de quien lo escribe
    cambia_correo = email != usuario.email
    usuario.nombre, usuario.nickName, usuario.telefono = nombre, nick, telefono or None
    if color:
        usuario.color_perfil = color
    try:
        usuario.save()
    except IntegrityError:
        return _error('Ese correo, nombre de usuario o teléfono ya está en uso.')

    if not cambia_correo:
        return _ok(usuario=_usuario(usuario), nivel='success', mensaje='Perfil actualizado correctamente.')
    if seguridad.envio_bloqueado(request, email):
        return _ok(usuario=_usuario(usuario), nivel='error',
                   mensaje='Ya enviamos varios códigos. Espera unos minutos para cambiar el correo.')
    seguridad.envio_registrado(request, email)
    codigo = seguridad.generar_codigo()
    try:
        _enviar_codigo(usuario.nombre, codigo, 'Pediste usar este correo en tu cuenta de LocalBus. Para confirmarlo, '
                                               'ingresa el siguiente código:', email,
                       asunto='Confirma tu nuevo correo - LocalBus')
    except Exception:
        logger.exception('No se pudo enviar el código para cambiar el correo (app)')
        return _ok(usuario=_usuario(usuario), nivel='error',
                   mensaje='Los demás datos se guardaron, pero no pudimos enviar el código al correo nuevo. '
                           'Revisa que esté bien escrito.')
    seguridad.limpiar('codigo:cambio_correo', usuario.pk)
    cambio = signing.dumps({'u': usuario.pk, 'e': email, 'c': _hmac_codigo('cambio_correo', codigo, email)},
                           salt=_SAL_CAMBIO_CORREO, compress=True)
    return _ok(usuario=_usuario(usuario), cambio=cambio, email_nuevo=email, nivel='success',
               mensaje='Datos guardados. Para cambiar el correo, ingresa el código que enviamos a la dirección nueva.')


@api('POST', sesion=True)
def perfil_correo(request):
    usuario = request.pasajero
    try:
        datos = signing.loads(_texto(request.datos, 'cambio'), salt=_SAL_CAMBIO_CORREO, max_age=MINUTOS_CODIGO * 60)
    except signing.SignatureExpired:
        return _error('El código expiró. Vuelve a cambiar el correo desde tu perfil.', reiniciar=True)
    except signing.BadSignature:
        return _error('No encontramos el cambio de correo. Vuelve a hacerlo desde tu perfil.', reiniciar=True)
    if datos.get('u') != usuario.pk:
        return _error('Ese cambio de correo no es de esta cuenta.', 403, reiniciar=True)
    email = datos.get('e', '')
    if seguridad.superado('codigo:cambio_correo', usuario.pk, seguridad.CODIGO_FALLOS) or \
            not _codigo_correcto('cambio_correo', _texto(request.datos, 'codigo'), datos.get('c'), email):
        fallos = seguridad.contar('codigo:cambio_correo', usuario.pk, MINUTOS_CODIGO * 60)
        if fallos >= seguridad.CODIGO_FALLOS:
            return _error('Demasiados intentos con un código incorrecto. El correo no se cambió.', reiniciar=True)
        restantes = seguridad.CODIGO_FALLOS - fallos
        return _error(f'Código incorrecto. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.')

    seguridad.limpiar('codigo:cambio_correo', usuario.pk)
    anterior = usuario.email
    usuario.email = email
    try:
        usuario.save(update_fields=['email'])
    except IntegrityError:
        return _error('Ese correo ya está en uso por otro usuario.', reiniciar=True)
    try:
        _enviar_codigo(usuario.nombre, '', f'El correo de tu cuenta de LocalBus cambió a {usuario.email}. '
                                           f'Si no fuiste tú, comunícate con nosotros.', anterior,
                       asunto='Tu correo de LocalBus cambió')
    except Exception:
        logger.exception('No se pudo avisar al correo anterior del cambio de correo (app)')
    return _ok(usuario=_usuario(usuario), mensaje=f'Correo actualizado a {usuario.email}.')


@api('POST', sesion=True)
def perfil_contrasena(request):
    usuario, datos = request.pasajero, request.datos
    actual, nueva, confirmar = (datos.get('actual') or '', datos.get('nueva') or '', datos.get('confirmar') or '')
    if not usuario.verificar_contrasena(actual):
        return _error('La contraseña actual es incorrecta.')
    if nueva != confirmar:
        return _error('Las contraseñas nuevas no coinciden.')
    error = seguridad.error_contrasena(nueva, usuario.nombre, usuario.email, usuario.nickName)
    if error:
        return _error(error)
    usuario.set_contrasena(nueva)
    usuario.save()
    # La contraseña cambió: los tokens anteriores dejan de servir y esta app recibe uno nuevo
    return _ok(token=token_pasajero(usuario), mensaje='Contraseña actualizada correctamente.')


@api('POST', sesion=True)
def perfil_tema(request):
    tema = _texto(request.datos, 'tema')
    if tema not in dict(TEMAS_PAGINA):
        return _error('Esa opción no existe.')
    request.pasajero.tema = tema
    request.pasajero.save(update_fields=['tema'])
    return _ok(tema=tema)


@api('POST', sesion=True)
def eliminar_cuenta(request):
    usuario = request.pasajero
    identificador = _texto(request.datos, 'identificador')
    contrasena = request.datos.get('contrasena') or ''
    if not identificador or not contrasena:
        return _error('Escribe tu correo o nombre de usuario y tu contraseña.')
    clave = str(usuario.pk)
    bloqueo = seguridad.login_bloqueado(request, clave, tipo='eliminar_cuenta')
    if bloqueo:
        return _error(bloqueo, 429)
    es_suya = identificador.lower() in (usuario.email.lower(), usuario.nickName.lower())
    if not usuario.verificar_contrasena(contrasena) or not es_suya:
        seguridad.login_fallido(request, clave, tipo='eliminar_cuenta')
        return _error('Los datos no corresponden a esta cuenta. Revísalos e inténtalo de nuevo.')
    seguridad.login_exitoso(clave, tipo='eliminar_cuenta')
    nombre = usuario.nombre
    usuario.delete()  # también borra sus alertas (una alerta siempre necesita autor)
    return _ok(mensaje=f'Eliminamos tu cuenta, {nombre}. Gracias por usar LocalBus.')
