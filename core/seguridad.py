"""Piezas de seguridad del inicio de sesión y el registro.

- Códigos de verificación con `secrets` (no adivinables).
- Límite de intentos con la caché de Django (login, códigos, correos enviados, verificar_*).
- Reglas de contraseña de AUTH_PASSWORD_VALIDATORS con mensajes en español.
- Backend de autenticación que bloquea el login de Django (empresa y /admin/) tras varios fallos.
"""
import hashlib
import math
import secrets

from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import translation

# Intentos permitidos y ventana en segundos
LOGIN_FALLOS_CUENTA = (5, 15 * 60)       # 5 contraseñas malas por cuenta -> 15 min bloqueada
LOGIN_FALLOS_IP = (20, 15 * 60)          # 20 fallos desde la misma IP -> 15 min
CODIGO_FALLOS = 5                        # intentos por código de verificación
CORREOS_POR_DESTINO = (3, 15 * 60)       # códigos enviados al mismo correo
CORREOS_POR_IP = (10, 60 * 60)           # códigos enviados desde la misma IP
CONSULTAS_VERIFICAR = (60, 10 * 60)      # consultas a los verificar_* por IP


def generar_codigo():
    """Código de 6 dígitos criptográficamente seguro (random.randint es predecible)."""
    return f'{secrets.randbelow(10 ** 6):06d}'


def codigos_iguales(ingresado, correcto):
    """Compara en tiempo constante; un código vacío nunca coincide."""
    return bool(ingresado and correcto) and secrets.compare_digest(str(ingresado), str(correcto))


def ip_cliente(request):
    # REMOTE_ADDR: X-Forwarded-For lo puede inventar el cliente si no hay un proxy de confianza
    return request.META.get('REMOTE_ADDR', '') or 'desconocida'


# ================= LÍMITE DE INTENTOS =================

def _clave(tipo, valor):
    # Hash para que correos o cédulas no queden legibles en la caché y no haya caracteres raros
    return 'lb:' + tipo + ':' + hashlib.sha256(str(valor).strip().lower().encode()).hexdigest()[:32]


def contar(tipo, valor, ventana):
    """Suma 1 al contador y lo devuelve. El contador se borra solo al pasar la ventana."""
    clave = _clave(tipo, valor)
    if cache.add(clave, 1, ventana):
        return 1
    try:
        return cache.incr(clave)
    except ValueError:  # venció justo entre add e incr
        cache.add(clave, 1, ventana)
        return 1


def intentos(tipo, valor):
    return cache.get(_clave(tipo, valor), 0)


def superado(tipo, valor, maximo):
    return intentos(tipo, valor) >= maximo


def limpiar(tipo, valor):
    cache.delete(_clave(tipo, valor))


def minutos(ventana):
    return math.ceil(ventana / 60)


# ----- Login (pasajeros, conductores y cuentas de Django) -----

def login_bloqueado(request, identificador, tipo='login'):
    """Mensaje de bloqueo si la cuenta o la IP superaron los intentos, o None."""
    if superado(tipo + ':cuenta', identificador, LOGIN_FALLOS_CUENTA[0]) or \
            superado(tipo + ':ip', ip_cliente(request), LOGIN_FALLOS_IP[0]):
        return (f'Demasiados intentos fallidos. Espera {minutos(LOGIN_FALLOS_CUENTA[1])} minutos '
                f'e inténtalo de nuevo.')
    return None


def login_fallido(request, identificador, tipo='login'):
    contar(tipo + ':cuenta', identificador, LOGIN_FALLOS_CUENTA[1])
    contar(tipo + ':ip', ip_cliente(request), LOGIN_FALLOS_IP[1])


def login_exitoso(identificador, tipo='login'):
    # Solo se limpia la cuenta: la IP sigue contando para frenar a quien prueba muchas cuentas
    limpiar(tipo + ':cuenta', identificador)


# ----- Envío de códigos por correo -----

def envio_bloqueado(request, destino):
    """True si ya se enviaron demasiados códigos a ese correo o desde esa IP."""
    return superado('correo:destino', destino, CORREOS_POR_DESTINO[0]) or \
        superado('correo:ip', ip_cliente(request), CORREOS_POR_IP[0])


def envio_registrado(request, destino):
    contar('correo:destino', destino, CORREOS_POR_DESTINO[1])
    contar('correo:ip', ip_cliente(request), CORREOS_POR_IP[1])


def consulta_permitida(request):
    """Para los verificar_*: limita cuántos correos/teléfonos/cédulas se pueden consultar."""
    return contar('verificar:ip', ip_cliente(request), CONSULTAS_VERIFICAR[1]) <= CONSULTAS_VERIFICAR[0]


# ================= REGLAS DE CONTRASEÑA =================

def error_contrasena(contrasena, nombre='', email='', nickname=''):
    """Aplica AUTH_PASSWORD_VALIDATORS (largo mínimo, contraseñas comunes, solo números,
    parecida a los datos del usuario). Devuelve el mensaje en español o None."""
    partes = (nombre or '').split(' ', 1)
    # User sin guardar: solo para que el validador compare con nombre, apellido, nickname y correo
    datos = User(username=nickname or '', first_name=partes[0], last_name=partes[1] if len(partes) > 1 else '',
                 email=email or '')
    with translation.override('es'):
        try:
            validate_password(contrasena or '', user=datos)
        except ValidationError as e:
            return ' '.join(str(m) for m in e.messages)
    return None


# ================= LOGIN DE DJANGO (empresas y /admin/) =================

class BackendConBloqueo(ModelBackend):
    """ModelBackend que corta el login tras varios fallos para la misma cuenta o IP."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if request is not None and username and login_bloqueado(request, username, 'django'):
            raise PermissionDenied  # detiene la autenticación sin probar la contraseña
        usuario = super().authenticate(request, username=username, password=password, **kwargs)
        if request is not None and username:
            if usuario is None:
                login_fallido(request, username, 'django')
            else:
                login_exitoso(username, 'django')
        return usuario
