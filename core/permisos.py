import hashlib
import logging
from functools import wraps

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.core import signing
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def empresa_del_usuario(request):
    """Empresa que administra el usuario de Django que inició sesión, o None."""
    user = getattr(request, 'user', None)
    if not user or not user.is_authenticated:
        return None
    administrador = getattr(user, 'administrador', None)
    if administrador is None or not administrador.empresa.activa:
        return None
    return administrador.empresa


def admin_empresa_required(vista):
    """Exige un administrador de empresa y deja la empresa en `request.empresa`.

    A las peticiones de API (JSON) les responde 403 en vez de redirigir al login.
    """
    @wraps(vista)
    def envoltura(request, *args, **kwargs):
        empresa = empresa_del_usuario(request)
        if empresa is None:
            if request.path.startswith('/api/') or request.content_type == 'application/json':
                return JsonResponse({'error': 'Debes iniciar sesión como administrador de empresa.'}, status=403)
            return redirect_to_login(request.get_full_path())
        request.empresa = empresa
        return vista(request, *args, **kwargs)
    return envoltura


# ================= TOKEN DE LA APP DEL CONDUCTOR =================
# El login del conductor entrega un token firmado con la SECRET_KEY. La app lo envía en
# la cabecera "Authorization: Bearer <token>" y el servidor saca de ahí quién es el
# conductor, en vez de confiar en el conductor_id que venga en la petición.
# No necesita tabla: vence solo (CONDUCTOR_TOKEN_HORAS) y deja de servir si cambia la contraseña.

_SAL_TOKEN = 'localbus.conductor.token'


def _huella_contrasena(conductor):
    """Cambia cuando cambia la contraseña: así un token viejo deja de servir."""
    return hashlib.sha256(conductor.contrasena.encode()).hexdigest()[:16]

def token_conductor(conductor):
    return signing.dumps({'c': conductor.pk, 'h': _huella_contrasena(conductor)}, salt=_SAL_TOKEN, compress=True)

def _error(mensaje, status):
    return None, JsonResponse({'error': mensaje}, status=status)

def conductor_de_la_peticion(request, conductor_id=None):
    """Devuelve (conductor, None) o (None, respuesta de error).

    Con token: el conductor sale del token; si además llega un conductor_id distinto, se rechaza.
    Sin token: se acepta el conductor_id (forma antigua) mientras CONDUCTOR_TOKEN_OBLIGATORIO
    sea False, para no romper la app mientras se actualiza.
    """
    from .models import Conductor

    cabecera = request.headers.get('Authorization', '')
    if cabecera.startswith('Bearer '):
        try:
            datos = signing.loads(cabecera[7:].strip(), salt=_SAL_TOKEN,
                                  max_age=settings.CONDUCTOR_TOKEN_HORAS * 3600)
        except signing.SignatureExpired:
            return _error('Tu sesión expiró. Vuelve a iniciar sesión.', 401)
        except signing.BadSignature:
            return _error('Sesión no válida. Vuelve a iniciar sesión.', 401)

        conductor = Conductor.objects.filter(pk=datos.get('c')).first()
        if conductor is None or datos.get('h') != _huella_contrasena(conductor):
            return _error('Sesión no válida. Vuelve a iniciar sesión.', 401)
        if conductor_id not in (None, '') and str(conductor_id) != str(conductor.pk):
            return _error('El token no corresponde a ese conductor.', 403)
    else:
        if settings.CONDUCTOR_TOKEN_OBLIGATORIO:
            return _error('Falta el token de sesión. Vuelve a iniciar sesión.', 401)
        if conductor_id in (None, ''):
            return _error('Conductor ID requerido', 400)
        if not str(conductor_id).strip().isdigit() or int(conductor_id) <= 0:
            return _error('conductor_id debe ser un número entero positivo', 400)
        conductor = Conductor.objects.filter(pk=int(conductor_id)).first()
        if conductor is None:
            return _error('Conductor no encontrado', 404)
        logger.info('Petición de la app del conductor %s sin token (forma antigua)', conductor.pk)

    if not conductor.habilitado:
        return _error('Tu cuenta de conductor está inhabilitada. Habla con tu empresa.', 403)
    return conductor, None