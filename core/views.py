from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus, Turno, DESPLAZAMIENTOS_MAPA, TEMAS_PAGINA
from datetime import time, datetime
from .models import ConfiguracionBus
from .utils.horas import fecha_hora12, hora12
from .permisos import admin_empresa_required, conductor_de_la_peticion, empresa_del_usuario, token_conductor
from . import seguridad
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.core.exceptions import PermissionDenied
from django.utils.http import url_has_allowed_host_and_scheme
from urllib.parse import urlencode
from django.contrib.auth.hashers import make_password
from django.db.models import Count
import json
import uuid
import logging
import re
from django.contrib import messages
from datetime import datetime, timedelta
from django.core.mail import send_mail
from django.utils import timezone
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
from django.http import HttpResponse
from html import escape
from reportlab.platypus import Paragraph
from .utils.reportes import (ANCHO_UTIL, ESTILO_CELDA, TIPOS_ALERTA as TIPOS_ALERTA_PDF, color_ruta, crear_reporte,
                             etiqueta_tipo_alerta, fecha_celda, nombre_archivo, placa_ruta, texto_celda)
from .utils import graficas_pdf
from collections import Counter
from reportlab.lib import colors
from reportlab.lib.units import cm
import math
from fcm_django.models import FCMDevice
from django.db import IntegrityError, transaction

logger = logging.getLogger(__name__)


# ================= VALIDACIÓN DE LAS APIs (JSON) =================

class _PeticionInvalida(Exception):
    """Datos mal formados enviados a una API: se responde 400 con este mensaje."""


def _json_objeto(request):
    """Cuerpo de la petición como diccionario. Lanza _PeticionInvalida si no es un objeto JSON."""
    try:
        data = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise _PeticionInvalida('JSON inválido')
    if not isinstance(data, dict):
        raise _PeticionInvalida('El cuerpo debe ser un objeto JSON, por ejemplo {"campo": "valor"}')
    return data


def _id_valido(valor, campo):
    """Convierte un ID a entero positivo. Lanza _PeticionInvalida si no lo es."""
    try:
        numero = int(str(valor).strip())
    except (TypeError, ValueError):
        raise _PeticionInvalida(f'{campo} debe ser un número entero')
    if numero <= 0:
        raise _PeticionInvalida(f'{campo} debe ser un número entero positivo')
    return numero


def _numero_valido(valor, campo, minimo=None, maximo=None):
    """Convierte a float finito dentro de [minimo, maximo]. Lanza _PeticionInvalida si no lo es."""
    try:
        numero = float(str(valor).strip().replace(',', '.'))
    except (TypeError, ValueError):
        raise _PeticionInvalida(f'{campo} debe ser un número')
    if not math.isfinite(numero):
        raise _PeticionInvalida(f'{campo} debe ser un número')
    if (minimo is not None and numero < minimo) or (maximo is not None and numero > maximo):
        raise _PeticionInvalida(f'{campo} debe estar entre {minimo} y {maximo}')
    return numero


def _respuesta_error(error):
    """Respuesta JSON para una excepción en una API: 400 si los datos venían mal,
    500 genérico si fue un fallo interno (el detalle queda en el log, no en la respuesta)."""
    if isinstance(error, _PeticionInvalida):
        return JsonResponse({'error': str(error)}, status=400)
    logger.exception('Error interno en una API')
    return JsonResponse({'error': 'Error interno del servidor'}, status=500)


def _a_numero(valor, tipo):
    """Convierte un valor del formulario a int/float. Acepta coma decimal.
    Devuelve 0 si viene vacío y None si no es un número válido o es negativo."""
    valor = (valor or '').strip().replace(',', '.')
    if not valor:
        return 0
    try:
        numero = tipo(float(valor)) if tipo is int else float(valor)
    except ValueError:
        return None
    return numero if numero >= 0 else None


def _ruta_valida(ruta_id):
    """True si ruta_id es un ID numérico de una ruta existente y habilitada."""
    return str(ruta_id or '').isdigit() and Ruta.objects.filter(id_ruta=ruta_id, habilitado=True).exists()


# Un bus que no envía ubicación en este tiempo se da por perdido y sale del mapa
MINUTOS_SIN_SENAL = 5


def _rutas_publicas():
    """Rutas que ven los pasajeros: habilitadas y de una empresa activa."""
    return Ruta.objects.filter(habilitado=True, empresa__activa=True)


def _ruta_publica(ruta):
    """True si la ruta está habilitada, en servicio y su empresa está activa."""
    return ruta.habilitado and ruta.estado != 'Fuera_servicio' and ruta.empresa.activa


def _buses_publicos():
    """Buses que pueden aparecer en el mapa: habilitados, transmitiendo y de una empresa activa."""
    return Bus.objects.filter(habilitado=True, activo=True, empresa__activa=True)


_NOMBRES_CAMPOS = {
    'nombre': 'nombre', 'codigo': 'código', 'origen': 'origen', 'destino': 'destino',
    'telefono': 'teléfono', 'email': 'correo', 'cedula': 'cédula', 'placa': 'placa',
    'tipo': 'tipo', 'descripcion': 'descripción', 'nickName': 'nombre de usuario',
    'contrasena': 'contraseña',
}


def _texto_muy_largo(modelo, **valores):
    """Mensaje de error si algún valor supera el max_length del campo en el modelo, o None.
    Así PostgreSQL no rechaza el texto con un error 500."""
    for campo, valor in valores.items():
        maximo = modelo._meta.get_field(campo).max_length
        if valor and maximo and len(valor) > maximo:
            return f'El campo {_NOMBRES_CAMPOS.get(campo, campo)} admite máximo {maximo} caracteres.'
    return None


def _opcion_valida(modelo, campo, valor):
    """True si valor es una de las opciones (choices) del campo."""
    return valor in dict(modelo._meta.get_field(campo).choices)


def _recortar(modelo, campo, valor):
    """Recorta al max_length del campo (para textos que llena el sistema, como direcciones del mapa)."""
    maximo = modelo._meta.get_field(campo).max_length
    return (valor or '')[:maximo]


def _buscar(modelo, **filtros):
    """Devuelve el objeto o None si no existe o el ID no es válido (en vez de error 500)."""
    try:
        return modelo.objects.filter(**filtros).first()
    except (ValueError, TypeError):
        return None

# ================= HOME =================

def home(request):
    rutas = Ruta.marcar_operacion(_rutas_publicas().order_by('codigo'), minutos_sin_senal=MINUTOS_SIN_SENAL)
    # Solo alertas publicadas y vigentes (En proceso): las pendientes aún no las revisa la empresa
    alertas = (Alerta.objects.filter(estado='En_proceso', ruta__in=rutas)
               .select_related('usuario', 'ruta').order_by('-fecha_creacion')[:15])

    rutas_json = []
    for ruta in rutas:
        ruta_data = {
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'distancia_km': ruta.distancia_km,
            'estado': ruta.estado_visible,
            'coordenadas': ruta.get_coordenadas_ruta(),
            'paradas': ruta.get_paradas_coordenadas()
        }
        rutas_json.append(ruta_data)

    usuario_id = request.session.get('usuario_id')
    usuario_nombre = request.session.get('usuario_nombre')

    usuario_perfil = None
    if usuario_id:
        try:
            usuario_perfil = Usuario.objects.get(id_usuario=usuario_id)
        except Usuario.DoesNotExist:
            pass

    return render(request, 'core/home.html', {
        'alertas': alertas,
        'rutas': rutas,
        'total_activas': sum(r.estado_visible == 'Activa' for r in rutas),
        'rutas_json': rutas_json,
        'usuario_id': usuario_id,
        'usuario_nombre': usuario_nombre,
        'usuario_perfil': usuario_perfil,
        'mostrar_bienvenida': bool(usuario_perfil) and request.session.pop('mostrar_bienvenida', False),
    })

# ================= LOGIN / REGISTRO (WEB) =================

def _sesion_actual(request):
    """('usuario', nombre), ('empresa', nombre) o None: con qué cuenta está abierta la sesión ahora."""
    empresa = empresa_del_usuario(request)
    if empresa:
        return 'empresa', empresa.nombre
    if getattr(request, 'user', None) and request.user.is_authenticated:
        return 'empresa', request.user.get_username()
    if request.session.get('usuario_id'):
        return 'usuario', request.session.get('usuario_nombre') or 'tu cuenta'
    return None


def _render_login(request, tipo, **extra):
    """Página única de inicio de sesión: arriba se elige si se entra como usuario o como empresa."""
    contexto = {'tipo': tipo, 'sesion_actual': _sesion_actual(request),
                'next': request.POST.get('next') or request.GET.get('next', '')}
    contexto.update(extra)
    return render(request, 'core/login.html', contexto)


def _destino_seguro(request, destino, por_defecto):
    """El `next` solo se sigue si apunta a este mismo sitio (evita redirecciones a otras páginas)."""
    if destino and url_has_allowed_host_and_scheme(destino, allowed_hosts={request.get_host()},
                                                   require_https=request.is_secure()):
        return destino
    return por_defecto


def _login_empresa(request):
    """Inicio de sesión de un administrador de empresa (cuenta de Django ligada a una empresa activa)."""
    usuario = request.POST.get('email', '').strip()
    clave = request.POST.get('password', '')
    if not usuario or not clave:
        return _render_login(request, 'empresa', error='Escribe el usuario de tu empresa y la contraseña.', email=usuario)

    bloqueo = seguridad.login_bloqueado(request, usuario, 'django')
    if bloqueo:
        return _render_login(request, 'empresa', error=bloqueo, email=usuario)
    try:
        # El backend cuenta los fallos y bloquea tras varios intentos (seguridad.BackendConBloqueo)
        cuenta = authenticate(request, username=usuario, password=clave)
    except PermissionDenied:
        cuenta = None
    if cuenta is None:
        return _render_login(request, 'empresa', email=usuario,
                             error=seguridad.login_bloqueado(request, usuario, 'django')
                             or 'Usuario o contraseña incorrectos.')

    administrador = getattr(cuenta, 'administrador', None)
    if administrador is None or not administrador.empresa.activa:
        return _render_login(request, 'empresa', email=usuario,
                             error=f'La cuenta {cuenta.get_username()} no administra ninguna empresa activa. '
                                   'Pide al administrador de LocalBus que te asigne una.')

    # Una sola cuenta abierta a la vez: se cierra la de usuario (y cualquier otra) antes de entrar
    request.session.flush()
    auth_login(request, cuenta)
    nombre = cuenta.get_full_name() or cuenta.get_username()
    messages.success(request, f'¡Bienvenido, {nombre}! Entraste a {administrador.empresa.nombre}.')
    return redirect(_destino_seguro(request, request.POST.get('next'), settings.LOGIN_REDIRECT_URL))


def login(request):
    """Inicio de sesión único: usuario (pasajero) o empresa, según lo que se elija arriba del formulario."""
    tipo = request.POST.get('tipo') or request.GET.get('tipo') or 'usuario'
    if tipo not in ('usuario', 'empresa'):
        tipo = 'usuario'

    if request.method == 'POST' and tipo == 'empresa':
        return _login_empresa(request)

    if request.method == 'POST':
        identificador = request.POST.get('email', '').strip()
        contrasena = request.POST.get('password', '')

        bloqueo = seguridad.login_bloqueado(request, identificador)
        if bloqueo:
            return _render_login(request, 'usuario', error=bloqueo, email=identificador)

        # Correo o nickname, sin distinguir mayúsculas. filter().first() en vez de get():
        # aunque hubiera datos viejos repetidos no se produce un error 500.
        usuario = (Usuario.objects.filter(email__iexact=identificador).first()
                   or Usuario.objects.filter(nickName__iexact=identificador).first()) if identificador else None
        if usuario is None:
            make_password(contrasena)  # mismo tiempo de respuesta que con una cuenta existente

        # Un solo mensaje: no se revela si el correo o el nombre de usuario están registrados
        if usuario is None or not usuario.verificar_contrasena(contrasena):
            seguridad.login_fallido(request, identificador)
            return _render_login(request, 'usuario', email=identificador,
                                 error='Correo, nombre de usuario o contraseña incorrectos.')

        seguridad.login_exitoso(identificador)
        # Una sola cuenta abierta a la vez: flush cierra la de empresa (y cualquier otra) y crea una sesión
        # nueva, lo que además evita la fijación de sesión
        request.session.flush()
        request.session['usuario_id'] = usuario.id_usuario
        request.session['usuario_nombre'] = usuario.nombre

        # Primer inicio de sesión: el mapa pregunta si seguir ahí o conocer LocalBus (una sola vez)
        if not usuario.vio_bienvenida:
            usuario.vio_bienvenida = True
            usuario.save(update_fields=['vio_bienvenida'])
            request.session['mostrar_bienvenida'] = True

        messages.success(
            request,
            f'¡Bienvenido, {usuario.nombre}! Inicio de sesión exitoso.'
        )

        return redirect('/')

    return _render_login(request, tipo)


def logout(request):
    request.session.flush()
    messages.success(request, 'Sesión cerrada correctamente. ¡Hasta pronto!')
    return redirect('/')


def _registro_con_error(request, error):
    """Vuelve a mostrar el registro con el error y lo que la persona ya había escrito.
    Las contraseñas nunca se devuelven: esas sí hay que escribirlas de nuevo."""
    datos = {campo: request.POST.get(campo, '') for campo in ('first_name', 'last_name', 'email', 'username', 'telefono')}
    return render(request, 'core/registro.html', {
        'error': error,
        'datos': datos,
        'newsletter': bool(request.POST.get('newsletter')),
    })


def registro(request):
    if request.method == 'POST':
        nombre = request.POST.get('first_name')
        apellido = request.POST.get('last_name')
        email = (request.POST.get('email') or '').strip().lower()
        nickName = (request.POST.get('username') or '').strip()
        contrasena = request.POST.get('password')
        contrasena2 = request.POST.get('password2')
        telefono = (request.POST.get('telefono') or '').strip() or None

        if not all([nombre, apellido, email, nickName, contrasena]):
            return _registro_con_error(request, 'Completa todos los campos obligatorios.')

        if contrasena != contrasena2:
            return _registro_con_error(request, 'Las contraseñas no coinciden.')

        error = seguridad.error_contrasena(contrasena, f'{nombre} {apellido}', email, nickName)
        if error:
            return _registro_con_error(request, error)

        # El nombre se guarda como "nombre apellido" en un solo campo
        if _texto_muy_largo(Usuario, nombre=f'{nombre.strip()} {apellido.strip()}'):
            return _registro_con_error(request, f'El nombre y el apellido juntos admiten máximo '
                         f'{Usuario._meta.get_field("nombre").max_length} caracteres.')
        error = _texto_muy_largo(Usuario, email=email, nickName=nickName, contrasena=contrasena)
        if error:
            return _registro_con_error(request, error)

        if Usuario.objects.filter(email__iexact=email).exists():
            return _registro_con_error(request, 'El correo electrónico ya está registrado.')

        if Usuario.objects.filter(nickName__iexact=nickName).exists():
            return _registro_con_error(request, 'El nombre de usuario ya está registrado.')

        if telefono:
            if not telefono.isdigit() or not 7 <= len(telefono) <= 15:
                return _registro_con_error(request, 'El teléfono debe contener solo números (entre 7 y 15 dígitos).')
            if Usuario.objects.filter(telefono=telefono).exists():
                return _registro_con_error(request, 'El teléfono ya está registrado.')

        if seguridad.envio_bloqueado(request, email):
            return _registro_con_error(request, 'Ya enviamos varios códigos. Espera unos minutos antes de volver a intentarlo.')

        codigo = seguridad.generar_codigo()

        request.session['registro_pendiente'] = {
            'nombre': f'{nombre.strip()} {apellido.strip()}',
            'email': email,
            'nickName': nickName,
            # Se cifra desde ya: la sesión nunca guarda la contraseña en texto plano
            'contrasena': make_password(contrasena),
            'telefono': telefono,
            'codigo': codigo,
            'intentos': 0,
            'expira': (timezone.now() + timedelta(minutes=15)).isoformat(),
        }

        try:
            seguridad.envio_registrado(request, email)
            enviar_correo_html(
                asunto='Código de Verificación - LocalBus',
                template='core/emails/codigo_verificacion.html',
                contexto={
                    'nombre': nombre,
                    'codigo': codigo,
                    'mensaje': 'Gracias por registrarte en LocalBus. Para completar tu registro, ingresa el siguiente código:',
                },
                destinatario=email,
            )
        except Exception:
            logger.exception('No se pudo enviar el correo de verificación del registro')
            return _registro_con_error(request, 'No pudimos enviar el correo de verificación. Revisa el correo e inténtalo más tarde.')

        return redirect('/verificar_registro/')

    return render(request, 'core/registro.html')


def enviar_correo_html(asunto, template, contexto, destinatario):
    html_content = render_to_string(template, contexto)
    text_content = strip_tags(html_content)

    email = EmailMultiAlternatives(
        subject=asunto,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[destinatario],
        body=text_content,
    )
    email.attach_alternative(html_content, "text/html")
    email.send(fail_silently=False)


def verificar_registro(request):
    datos = request.session.get('registro_pendiente')
    if not datos:
        return redirect('/registro/')

    if request.method == 'POST':
        codigo_ingresado = request.POST.get('codigo', '').strip()
        codigo_correcto = datos.get('codigo')

        try:
            expira = timezone.datetime.fromisoformat(datos.get('expira'))
        except (ValueError, TypeError):
            del request.session['registro_pendiente']
            return redirect('/registro/')

        if timezone.now() > expira:
            del request.session['registro_pendiente']
            return render(request, 'core/registro.html', {
                'error': 'El código ha expirado. Vuelve a registrarte.'
            })

        if not seguridad.codigos_iguales(codigo_ingresado, codigo_correcto):
            datos['intentos'] = datos.get('intentos', 0) + 1
            # Tras 5 intentos el código deja de servir: probar los 900.000 códigos ya no es posible
            if datos['intentos'] >= seguridad.CODIGO_FALLOS:
                del request.session['registro_pendiente']
                return render(request, 'core/registro.html', {
                    'error': 'Demasiados intentos con un código incorrecto. Vuelve a registrarte para recibir uno nuevo.'
                })
            request.session['registro_pendiente'] = datos
            restantes = seguridad.CODIGO_FALLOS - datos['intentos']
            return render(request, 'core/verificar_registro.html', {
                'email': datos.get('email'),
                'error': f'Código incorrecto. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.'
            })

        try:
            Usuario.objects.create(
                nombre=datos.get('nombre'),
                email=datos.get('email'),
                nickName=datos.get('nickName'),
                contrasena=datos.get('contrasena'),  # ya viene cifrada desde el registro
                telefono=datos.get('telefono'),
            )
        except IntegrityError:
            # Otro usuario tomó el correo, nickname o teléfono mientras se verificaba el código
            del request.session['registro_pendiente']
            return render(request, 'core/registro.html', {
                'error': 'El correo, nombre de usuario o teléfono ya fue registrado por otra persona. '
                         'Vuelve a registrarte con otros datos.'
            })

        messages.success(
            request,
            f'¡Registro exitoso! Tu cuenta ha sido creada. Ya puedes iniciar sesión con {datos.get("email")}.'
        )
        del request.session['registro_pendiente']
        return redirect('/login/')

    return render(request, 'core/verificar_registro.html', {
        'email': datos.get('email')
    })


# ================= VERIFICAR EMAIL / NICKNAME (AJAX) =================

def verificar_email(request):
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        email = request.POST.get('email', '').strip().lower()
        if not email:
            return JsonResponse({'existe': False})
        existe = Usuario.objects.filter(email__iexact=email).exists()
        return JsonResponse({'existe': existe})
    return JsonResponse({'existe': False})


def verificar_contrasena(request):
    """Para el registro: dice si la contraseña pasa las reglas (largo, común, solo números, parecida a tus datos).
    No revela nada de cuentas existentes, así que no necesita el límite de consultas."""
    if request.method != 'POST':
        return JsonResponse({'error': None})
    nombre = f"{request.POST.get('first_name', '').strip()} {request.POST.get('last_name', '').strip()}".strip()
    error = seguridad.error_contrasena(
        request.POST.get('password', ''), nombre,
        request.POST.get('email', '').strip().lower(), request.POST.get('username', '').strip())
    return JsonResponse({'error': error})


def verificar_nickname(request):
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        nickname = request.POST.get('nickname', '').strip()
        if not nickname:
            return JsonResponse({'existe': False, 'sugerencias': []})

        existe = Usuario.objects.filter(nickName__iexact=nickname).exists()
        sugerencias = []
        if existe:
            sugerencias = generar_sugerencias_nickname(nickname)

        return JsonResponse({
            'existe': existe,
            'sugerencias': sugerencias
        })
    return JsonResponse({'existe': False, 'sugerencias': []})


def generar_sugerencias_nickname(nickname, cantidad=4):
    import random
    import string

    sugerencias = []
    intentos = 0
    max_intentos = 50

    estrategias = [
        lambda n: f"{n}{random.randint(1, 99)}",
        lambda n: f"{n}{random.randint(2024, 2026)}",
        lambda n: f"{n}_{random.randint(1, 99)}",
        lambda n: f"{n}_{random.choice(['oficial', 'real', 'pro', 'dev'])}",
        lambda n: f"{n}{random.choice(string.ascii_lowercase)}{random.randint(1, 9)}",
        lambda n: f"{n}.{random.randint(1, 99)}",
    ]

    while len(sugerencias) < cantidad and intentos < max_intentos:
        intentos += 1
        estrategia = random.choice(estrategias)
        candidato = estrategia(nickname)

        if (candidato not in sugerencias and
                not Usuario.objects.filter(nickName__iexact=candidato).exists()):
            sugerencias.append(candidato)

    while len(sugerencias) < cantidad and intentos < max_intentos * 2:
        intentos += 1
        candidato = f"{nickname}{random.randint(100, 9999)}"
        if (candidato not in sugerencias and
                not Usuario.objects.filter(nickName__iexact=candidato).exists()):
            sugerencias.append(candidato)

    return sugerencias


# ================= ALERTAS =================
# Flujo: el pasajero crea la alerta y queda "Pendiente" (no se publica). La empresa dueña de la ruta la revisa
# y la pasa a "En proceso" (se publica en el mapa y llega como notificación) o a "Resuelta".
# La empresa también puede crear alertas en sus rutas: elige el estado al crearlas y no pasan por revisión.
# "Cancelada" es lo que deja "Inhabilitar": la alerta se conserva pero no se muestra.

# Tipos de alerta que se pueden crear (el tipo "bus-arriving" ya no existe)
TIPOS_ALERTA = ('delay', 'warning', 'info')
# Lo que ve quien no es la empresa: solo alertas ya revisadas
ESTADOS_PUBLICOS = ('En_proceso', 'Resuelta')
# Lo que la empresa puede elegir al revisar una alerta
ESTADOS_EMPRESA = ('En_proceso', 'Resuelta')


def alertas(request):
    empresa = empresa_del_usuario(request)
    base = Alerta.objects.select_related('usuario', 'empresa', 'ruta').order_by('-fecha_creacion')
    if empresa:
        # La empresa ve todas las alertas de sus rutas (también las pendientes, que esperan su revisión)
        alertas = base.filter(ruta__empresa=empresa).exclude(estado='Cancelada')
        rutas = Ruta.objects.filter(empresa=empresa, habilitado=True).order_by('nombre')
    else:
        # Los demás solo ven las alertas que una empresa ya revisó
        alertas = base.filter(estado__in=ESTADOS_PUBLICOS)
        rutas = Ruta.objects.filter(habilitado=True).order_by('nombre')

    # Los contadores salen del mismo conjunto que la lista
    totales = dict(alertas.order_by().values_list('tipo').annotate(total=Count('id_alerta')))
    por_estado = dict(alertas.order_by().values_list('estado').annotate(total=Count('id_alerta')))
    editables = {a.id_alerta for a in alertas if _puede_modificar_alerta(request, a)}
    # Rutas que se pueden elegir en la ventana "Descargar reporte" (solo las empresas la usan)
    rutas_reporte = empresa.rutas.order_by('codigo') if empresa else []
    # Rutas que tienen alertas en la lista, para el filtro "Ruta"
    rutas_filtro = sorted({a.ruta for a in alertas}, key=lambda r: (r.nombre.lower(), r.codigo))

    return render(request, 'core/alertas.html', {
        'alertas': alertas,
        'rutas_reporte': rutas_reporte,
        'rutas_filtro': rutas_filtro,
        'editables': editables,
        'rutas': rutas,
        'es_empresa': empresa is not None,
        'total_alertas_delay': totales.get('delay', 0),
        'total_alertas_warning': totales.get('warning', 0),
        'total_alertas_info': totales.get('info', 0),
        'total_pendientes': por_estado.get('Pendiente', 0),
        'total_en_proceso': por_estado.get('En_proceso', 0),
        'total_resueltas': por_estado.get('Resuelta', 0),
    })


def _validar_alerta(ruta_id, tipo, descripcion):
    """Valida los datos del formulario de alerta. Devuelve un mensaje de error o None."""
    if not _ruta_valida(ruta_id):
        return 'Selecciona una ruta válida para la alerta.'
    if not tipo or not descripcion:
        return 'El tipo y la descripción de la alerta son obligatorios.'
    if tipo not in TIPOS_ALERTA:
        return 'El tipo de alerta no es válido.'
    return _texto_muy_largo(Alerta, tipo=tipo, descripcion=descripcion)


def _es_empresa_de_la_alerta(request, alerta):
    empresa = empresa_del_usuario(request)
    return empresa is not None and alerta.ruta.empresa_id == empresa.pk


def _puede_modificar_alerta(request, alerta):
    """Solo quien creó la alerta, o el administrador de la empresa dueña de la ruta.
    Se exige un pasajero con sesión: una alerta de empresa no tiene usuario y None == None daría acceso."""
    usuario_id = request.session.get('usuario_id')
    return ((usuario_id is not None and alerta.usuario_id == usuario_id)
            or _es_empresa_de_la_alerta(request, alerta))


def _publicar_si_corresponde(alerta, estado_anterior):
    """Al pasar de Pendiente a En proceso la alerta se publica: se avisa por push a la app de pasajeros."""
    if estado_anterior == 'Pendiente' and alerta.estado == 'En_proceso':
        from .models import enviar_push_alerta
        id_alerta = alerta.pk
        transaction.on_commit(lambda: enviar_push_alerta(id_alerta))


def crearAlerta(request):
    if request.method == 'POST':
        ruta_id = request.POST.get('ruta')
        tipo = request.POST.get('tipo')
        descripcion = (request.POST.get('descripcion') or '').strip()

        empresa = empresa_del_usuario(request)
        if empresa:
            return _crear_alerta_empresa(request, empresa, ruta_id, tipo, descripcion)

        usuario_id = request.session.get('usuario_id')
        if not usuario_id:
            return redirect('/login/')

        error = _validar_alerta(ruta_id, tipo, descripcion)
        if error:
            messages.error(request, error)
            return redirect('/alertas/')

        # La del pasajero siempre nace pendiente: no se publica hasta que la empresa de la ruta la revise
        Alerta.objects.create(
            usuario_id=usuario_id,
            ruta_id=ruta_id,
            tipo=tipo,
            descripcion=descripcion,
            estado='Pendiente'
        )
        messages.success(request, 'Enviamos tu alerta. Quedó pendiente: se publicará cuando la empresa de la ruta la revise.')
    return redirect('/alertas/')


def _crear_alerta_empresa(request, empresa, ruta_id, tipo, descripcion):
    """La empresa publica una alerta en una de sus rutas y elige el estado (En proceso o Resuelta).
    No pasa por revisión: si nace En proceso se publica y la señal envía la notificación push."""
    error = _validar_alerta(ruta_id, tipo, descripcion)
    estado = request.POST.get('estado')
    if not error and estado not in ESTADOS_EMPRESA:
        error = 'Elige si la alerta está en proceso o resuelta.'
    if not error and not Ruta.objects.filter(id_ruta=ruta_id, empresa=empresa, habilitado=True).exists():
        error = 'Solo puedes crear alertas en las rutas de tu empresa.'
    if error:
        messages.error(request, error)
        return redirect('/alertas/')

    Alerta.objects.create(empresa=empresa, ruta_id=ruta_id, tipo=tipo, descripcion=descripcion, estado=estado)
    messages.success(request, 'Alerta publicada en el mapa.' if estado == 'En_proceso'
                     else 'Alerta creada como resuelta: queda en el historial de la ruta.')
    return redirect('/alertas/')


def editarAlerta(request, id_alerta):
    if request.method == 'POST':
        alerta = _buscar(Alerta, id_alerta=id_alerta)
        if alerta is None:
            messages.error(request, 'La alerta que intentas editar no existe.')
            return redirect('/alertas/')
        if not _puede_modificar_alerta(request, alerta):
            messages.error(request, 'Solo quien creó la alerta o la empresa de la ruta pueden editarla.')
            return redirect('/alertas/')

        ruta_id = request.POST.get('ruta')
        tipo = request.POST.get('tipo')
        descripcion = (request.POST.get('descripcion') or '').strip()

        error = _validar_alerta(ruta_id, tipo, descripcion)
        if error:
            messages.error(request, error)
            return redirect('/alertas/')

        estado_anterior = alerta.estado
        if _es_empresa_de_la_alerta(request, alerta):
            # La empresa elige entre En proceso y Resuelta, y solo puede mover la alerta a una de sus rutas
            estado = request.POST.get('estado')
            if estado not in ESTADOS_EMPRESA:
                messages.error(request, 'Elige si la alerta está en proceso o resuelta.')
                return redirect('/alertas/')
            if not Ruta.objects.filter(id_ruta=ruta_id, empresa=empresa_del_usuario(request)).exists():
                messages.error(request, 'Solo puedes asignar la alerta a una ruta de tu empresa.')
                return redirect('/alertas/')
            mensaje = 'Guardamos los cambios de la alerta.'
        else:
            # Si quien la creó la cambia, vuelve a revisión: la empresa no aprobó este texto
            estado = 'Pendiente'
            mensaje = 'Guardamos los cambios. La alerta vuelve a quedar pendiente hasta que la empresa la revise.'

        alerta.ruta_id = ruta_id
        alerta.tipo = tipo
        alerta.descripcion = descripcion
        alerta.estado = estado
        alerta.save()
        _publicar_si_corresponde(alerta, estado_anterior)
        messages.success(request, mensaje)
    return redirect('/alertas/')


def cambiarEstadoAlerta(request, id_alerta):
    """La empresa dueña de la ruta marca la alerta como En proceso o Resuelta."""
    if request.method == 'POST':
        alerta = _buscar(Alerta, id_alerta=id_alerta)
        estado = request.POST.get('estado')
        if alerta is None or alerta.estado == 'Cancelada':
            messages.error(request, 'La alerta no existe o ya fue inhabilitada.')
        elif not _es_empresa_de_la_alerta(request, alerta):
            messages.error(request, 'Solo la empresa de la ruta puede cambiar el estado de la alerta.')
        elif estado not in ESTADOS_EMPRESA:
            messages.error(request, 'Elige si la alerta está en proceso o resuelta.')
        else:
            estado_anterior = alerta.estado
            alerta.estado = estado
            alerta.save(update_fields=['estado'])
            _publicar_si_corresponde(alerta, estado_anterior)
            messages.success(request, 'Alerta marcada como en proceso.' if estado == 'En_proceso' else 'Alerta marcada como resuelta.')
    return redirect('/alertas/')


def inhabilitarAlerta(request, id_alerta):
    """En vez de borrar la alerta la marca como Cancelada: deja de mostrarse pero queda en la base."""
    if request.method == 'POST':
        alerta = _buscar(Alerta, id_alerta=id_alerta)
        if alerta is None:
            messages.error(request, 'La alerta que intentas inhabilitar no existe.')
        elif not _puede_modificar_alerta(request, alerta):
            messages.error(request, 'Solo quien creó la alerta o la empresa de la ruta pueden inhabilitarla.')
        else:
            alerta.estado = 'Cancelada'
            alerta.save(update_fields=['estado'])
            messages.success(request, 'Alerta inhabilitada.')
    return redirect('/alertas/')


# ================= RUTAS =================

# Color de cada ruta (id_ruta % 7), el mismo del mapa y las alertas. Ver docs/GUIA_DE_DISENO.md
COLORES_RUTA = ['#087F8C', '#6B3FA0', '#B85C00', '#A82A7B', '#5C6B1E', '#7A4A2B', '#3F5B7A']


def rutas(request):
    # Los pasajeros ven las rutas habilitadas de empresas activas; el administrador ve y edita las de su empresa
    empresa = empresa_del_usuario(request)
    rutas = Ruta.objects.filter(empresa=empresa) if empresa else _rutas_publicas()
    # Estado calculado: activa, sin buses activos o fuera de horario (ver Ruta.estado_visible)
    rutas = Ruta.marcar_operacion(rutas.select_related('empresa').order_by('-habilitado', 'codigo'),
                                  minutos_sin_senal=MINUTOS_SIN_SENAL)
    # Turnos en curso o programados por ruta: el editor avisa cuántos quedan en pausa si la ruta sale de servicio
    pendientes = {}
    en_curso = {}
    if empresa:
        for turno in Turno.pendientes().filter(ruta__in=rutas):
            pendientes[turno.ruta_id] = pendientes.get(turno.ruta_id, 0) + 1
            if turno.estado != 'Programado':
                en_curso[turno.ruta_id] = en_curso.get(turno.ruta_id, 0) + 1

    rutas_json = []
    rutas_mapa = []  # vista "Mapa" (pasajeros y empresa): solo lo que se dibuja
    for ruta in rutas:
        ruta.color = COLORES_RUTA[ruta.id_ruta % len(COLORES_RUTA)]
        rutas_mapa.append({
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'estado': ruta.nombre_estado_visible if ruta.habilitado else 'Inhabilitada',
            'habilitado': ruta.habilitado,
            'color': ruta.color,
            'coordenadas': ruta.get_coordenadas_ruta(),
        })
        rutas_json.append({
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'distancia_km': ruta.distancia_km,
            'duracion_estimada_minutos': ruta.duracion_estimada_minutos,
            'frecuencia_minutos': ruta.frecuencia_minutos,
            'estado': ruta.estado,  # el que eligió la empresa (el editor lo usa)
            'motivo': ruta.motivo_fuera_servicio,
            'estado_visible': ruta.estado_visible,
            'turnos_pendientes': pendientes.get(ruta.id_ruta, 0),
            'turnos_en_curso': en_curso.get(ruta.id_ruta, 0),
            'color': ruta.color,
            'coordenadas': ruta.get_coordenadas_ruta(),
            'paradas': ruta.get_paradas_coordenadas()
        })

    # Conteo para las pestañas de filtro: las inhabilitadas van aparte de los estados
    habilitadas = [r for r in rutas if r.habilitado]
    totales = {estado: sum(r.estado_visible == estado for r in habilitadas) for estado in Ruta.ESTADOS_VISIBLES}
    # Pestañas de filtro por estado, en el orden de Ruta.ESTADOS_VISIBLES
    pestanas_estado = [(estado, nombre, totales[estado]) for estado, nombre in Ruta.ESTADOS_VISIBLES.items()]

    return render(request, "core/rutas.html", {
        'rutas': rutas,
        'rutas_json': rutas_json,
        'rutas_mapa': rutas_mapa,
        # Rutas que se pueden elegir en la ventana "Descargar reporte" (solo la empresa la usa)
        'rutas_reporte': sorted(rutas, key=lambda r: r.codigo.lower()) if empresa else [],
        'estados_reporte': ESTADOS_REPORTE_RUTA,
        'puede_editar': empresa is not None,
        'pestanas_estado': pestanas_estado,
        'total_inhabilitadas': len(rutas) - len(habilitadas),
    })


def _validar_textos_ruta(nombre, codigo, estado):
    """Longitud del nombre y el código, y estado entre las opciones. Mensaje de error o None."""
    if not _opcion_valida(Ruta, 'estado', estado):
        return 'El estado de la ruta no es válido.'
    return _texto_muy_largo(Ruta, nombre=nombre, codigo=codigo)


def _motivo_del_formulario(request, estado):
    """(motivo, error). El motivo es obligatorio cuando la ruta queda fuera de servicio."""
    if estado != 'Fuera_servicio':
        return '', None
    motivo = ' '.join((request.POST.get('motivo') or '').split())
    maximo = Ruta._meta.get_field('motivo_fuera_servicio').max_length
    if not motivo:
        return '', 'Escribe el motivo por el que la ruta queda fuera de servicio: los pasajeros lo verán.'
    if len(motivo) > maximo:
        return '', f'El motivo admite máximo {maximo} caracteres.'
    return motivo, None


def _avisar_ruta_activa(ruta, descripcion=None, titulo='Ruta activa de nuevo'):
    """Avisa que la ruta volvió a operar. Se guarda como alerta de información ya Resuelta: no se queda fija en
    el aviso del mapa, pero queda en el centro de alertas y llega como notificación (la web la recoge de la API
    de alertas y la app móvil, por push)."""
    from .models import enviar_push_alerta
    aviso = Alerta.objects.create(
        empresa=ruta.empresa, ruta=ruta, tipo='info', estado='Resuelta',
        descripcion=descripcion or f'La ruta {ruta.codigo} ya está activa de nuevo.')
    transaction.on_commit(lambda: enviar_push_alerta(aviso.pk, titulo=titulo))


def _avisar_ruta_inhabilitada(ruta):
    """Al inhabilitar la ruta se publica una alerta para los pasajeros (llega por push y como notificación en la
    web). Queda En proceso mientras la ruta siga inhabilitada; al habilitarla de nuevo pasa a Resuelta."""
    ruta.alerta_inhabilitada = Alerta.objects.create(
        empresa=ruta.empresa, ruta=ruta, tipo='warning', estado='En_proceso',
        descripcion=f'La ruta {ruta.codigo} fue inhabilitada: ya no está disponible.')
    ruta.save(update_fields=['alerta_inhabilitada'])


def _avisar_ruta_habilitada(ruta):
    """Al habilitar la ruta de nuevo: la alerta de inhabilitación pasa a Resuelta y se avisa a los pasajeros."""
    alerta = ruta.alerta_inhabilitada
    if alerta is not None and alerta.estado in ('Pendiente', 'En_proceso'):
        alerta.estado = 'Resuelta'
        alerta.save(update_fields=['estado'])
    ruta.alerta_inhabilitada = None
    ruta.save(update_fields=['alerta_inhabilitada'])
    _avisar_ruta_activa(ruta, descripcion=f'La ruta {ruta.codigo} ya está disponible de nuevo.',
                        titulo='Ruta disponible de nuevo')


def _publicar_estado_ruta(request, ruta, estado_anterior):
    """Después de guardar la ruta. Fuera de servicio: publica el motivo como alerta (llega por push a los
    pasajeros) o la actualiza si cambió. De vuelta a Activa: la alerta pasa a Resuelta, se avisa a los pasajeros
    que la ruta ya está activa (otra alerta, con push y notificación en la web) y los turnos en pausa vuelven
    a servir solos."""
    alerta = ruta.alerta_fuera_servicio
    vigente = alerta is not None and alerta.estado in ('Pendiente', 'En_proceso')

    if ruta.fuera_de_servicio:
        descripcion = f'Fuera de servicio: {ruta.motivo_fuera_servicio}'
        if vigente:
            if alerta.descripcion != descripcion:
                alerta.descripcion = descripcion
                alerta.save(update_fields=['descripcion'])
        else:
            ruta.alerta_fuera_servicio = Alerta.objects.create(
                empresa=ruta.empresa, ruta=ruta, tipo='warning', descripcion=descripcion, estado='En_proceso')
            ruta.save(update_fields=['alerta_fuera_servicio'])
        if estado_anterior != 'Fuera_servicio':
            pausados = Turno.pendientes().filter(ruta=ruta).count()
            texto = f'La ruta {ruta.codigo} quedó fuera de servicio y publicamos el motivo para los pasajeros.'
            if pausados:
                texto += (f' {pausados} turno{"s" if pausados != 1 else ""} en curso o programado'
                          f'{"s" if pausados != 1 else ""} quedan en pausa hasta que la reactives.')
            messages.success(request, texto)
    elif estado_anterior == 'Fuera_servicio':
        if vigente:
            alerta.estado = 'Resuelta'
            alerta.save(update_fields=['estado'])
        ruta.alerta_fuera_servicio = None
        ruta.motivo_fuera_servicio = ''
        ruta.save(update_fields=['alerta_fuera_servicio', 'motivo_fuera_servicio'])
        _avisar_ruta_activa(ruta)
        messages.success(request, f'La ruta {ruta.codigo} volvió a operar: avisamos a los pasajeros, la alerta '
                                  f'de fuera de servicio quedó resuelta y sus turnos funcionan de nuevo.')


@admin_empresa_required
def crearRuta(request):
    if request.method == 'POST':
        duracion_minutos = _a_numero(request.POST.get('duracion_minutos'), int)
        frecuencia_minutos = _a_numero(request.POST.get('frecuencia_minutos'), int)
        distancia_km = _a_numero(request.POST.get('distancia_km'), float)
        if None in (duracion_minutos, frecuencia_minutos, distancia_km):
            messages.error(request, 'La duración, la frecuencia y la distancia deben ser números válidos.')
            return redirect('/rutas/')

        codigo = (request.POST.get('codigo') or '').strip()
        estado = request.POST.get('estado') or 'Activa'
        if not codigo or not (request.POST.get('nombre') or '').strip():
            messages.error(request, 'El nombre y el código de la ruta son obligatorios.')
            return redirect('/rutas/')
        error = _validar_textos_ruta(request.POST.get('nombre'), codigo, estado)
        motivo, error_motivo = _motivo_del_formulario(request, estado)
        if error or error_motivo:
            messages.error(request, error or error_motivo)
            return redirect('/rutas/')
        if request.empresa.rutas.filter(codigo__iexact=codigo).exists():
            messages.error(request, f'Ya existe una ruta con el código {codigo}.')
            return redirect('/rutas/')

        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')

        try:
            ruta = Ruta.objects.create(
                empresa=request.empresa,
                nombre=request.POST.get('nombre', ''),
                codigo=codigo,
                origen=_recortar(Ruta, 'origen', request.POST.get('origen')),
                destino=_recortar(Ruta, 'destino', request.POST.get('destino')),
                distancia_km=distancia_km,
                duracion_estimada_minutos=duracion_minutos,
                frecuencia_minutos=frecuencia_minutos,
                estado=estado,
                motivo_fuera_servicio=motivo,
            )
        except IntegrityError:
            # Doble envío del formulario: la otra petición ya creó la ruta
            messages.error(request, f'Ya existe una ruta con el código {codigo}.')
            return redirect('/rutas/')

        if geometria_data:
            try:
                coords = json.loads(geometria_data)
                if coords and len(coords) > 0:
                    from django.contrib.gis.geos import LineString, Point
                    ruta.geometria_ruta = LineString(coords, srid=4326)
                    ruta.punto_origen = Point(coords[0], srid=4326)
                    ruta.punto_destino = Point(coords[-1], srid=4326)
            except Exception as e:
                print(f"Error al procesar geometría: {e}")

        if paradas_data:
            try:
                paradas_coords = json.loads(paradas_data)
                if paradas_coords and len(paradas_coords) > 0:
                    from django.contrib.gis.geos import MultiPoint, Point
                    puntos = [Point(coord[0], coord[1], srid=4326) for coord in paradas_coords]
                    ruta.paradas = MultiPoint(puntos, srid=4326)
                    ruta.num_paradas = len(puntos)
            except Exception as e:
                print(f"Error al procesar paradas: {e}")

        ruta.save()
        _publicar_estado_ruta(request, ruta, None)
    return redirect("/rutas/")



@admin_empresa_required
def editarRuta(request, id_ruta):
    if request.method == 'POST':
        ruta = _buscar(Ruta, id_ruta=id_ruta, empresa=request.empresa)
        if ruta is None:
            messages.error(request, 'La ruta que intentas editar no existe.')
            return redirect('/rutas/')

        duracion_minutos = _a_numero(request.POST.get('duracion_minutos'), int)
        frecuencia_minutos = _a_numero(request.POST.get('frecuencia_minutos'), int)
        distancia_km = _a_numero(request.POST.get('distancia_km'), float)
        if None in (duracion_minutos, frecuencia_minutos, distancia_km):
            messages.error(request, 'La duración, la frecuencia y la distancia deben ser números válidos.')
            return redirect('/rutas/')

        codigo = (request.POST.get('codigo') or '').strip() or ruta.codigo
        nombre = request.POST.get('nombre', ruta.nombre)
        estado = request.POST.get('estado') or ruta.estado
        error = _validar_textos_ruta(nombre, codigo, estado)
        motivo, error_motivo = _motivo_del_formulario(request, estado)
        if error or error_motivo:
            messages.error(request, error or error_motivo)
            return redirect('/rutas/')
        if request.empresa.rutas.filter(codigo__iexact=codigo).exclude(id_ruta=ruta.id_ruta).exists():
            messages.error(request, f'Ya existe otra ruta con el código {codigo}.')
            return redirect('/rutas/')

        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')

        ruta.nombre = nombre
        ruta.codigo = codigo
        ruta.origen = _recortar(Ruta, 'origen', request.POST.get('origen', ruta.origen))
        ruta.destino = _recortar(Ruta, 'destino', request.POST.get('destino', ruta.destino))
        ruta.distancia_km = distancia_km
        ruta.duracion_estimada_minutos = duracion_minutos
        ruta.frecuencia_minutos = frecuencia_minutos
        estado_anterior = ruta.estado
        ruta.estado = estado
        if motivo:
            ruta.motivo_fuera_servicio = motivo

        if geometria_data:
            try:
                coords = json.loads(geometria_data)
                if coords and len(coords) > 0:
                    from django.contrib.gis.geos import LineString, Point
                    ruta.geometria_ruta = LineString(coords, srid=4326)
                    ruta.punto_origen = Point(coords[0], srid=4326)
                    ruta.punto_destino = Point(coords[-1], srid=4326)
            except Exception as e:
                print(f"Error al procesar geometría: {e}")

        if paradas_data:
            try:
                paradas_coords = json.loads(paradas_data)
                if paradas_coords and len(paradas_coords) > 0:
                    from django.contrib.gis.geos import MultiPoint, Point
                    puntos = [Point(coord[0], coord[1], srid=4326) for coord in paradas_coords]
                    ruta.paradas = MultiPoint(puntos, srid=4326)
                    ruta.num_paradas = len(puntos)
            except Exception as e:
                print(f"Error al procesar paradas: {e}")

        ruta.save()
        _publicar_estado_ruta(request, ruta, estado_anterior)
        return redirect("/rutas/")

    return redirect("/rutas/")


# ================= INHABILITAR (en vez de borrar) =================
# Rutas, conductores y buses no se borran: se inhabilitan para conservar su historial
# (turnos, ubicaciones, alertas). Se pueden volver a habilitar en cualquier momento.

def _cambiar_habilitacion(request, objeto, nombre, volver, turnos_de, al_inhabilitar=None, al_habilitar=None):
    """Habilita (POST habilitado=1) o inhabilita (habilitado=0) `objeto`.
    No inhabilita si tiene turnos en curso o programados, para no dejar turnos sin conductor, bus o ruta."""
    if request.method != 'POST':
        return redirect(volver)
    habilitar = request.POST.get('habilitado') == '1'
    was_enabled = objeto.habilitado
    if not habilitar:
        pendiente = Turno.pendientes().filter(**turnos_de).select_related('conductor', 'bus', 'ruta').first()
        if pendiente:
            messages.error(request, f'No puedes inhabilitar {nombre}: tiene turnos en curso o programados '
                                    f'({pendiente}). Finalízalos o elimínalos en Turnos.')
            return redirect(volver)
    objeto.habilitado = habilitar
    objeto.save(update_fields=['habilitado'])
    if not habilitar and al_inhabilitar and was_enabled:
        al_inhabilitar()
    if habilitar and al_habilitar and not was_enabled:
        al_habilitar()
    messages.success(request, f'Se {"habilitó" if habilitar else "inhabilitó"} {nombre}.')
    return redirect(volver)


def _finalizar_turnos_de_ruta(ruta):
    """Termina ahora los turnos en curso de la ruta (quedan en el historial) y borra los que aún no empiezan.
    Devuelve (finalizados, eliminados)."""
    return _finalizar_turnos(ruta=ruta)


def _finalizar_turnos(**filtro):
    """Termina ahora los turnos en curso que cumplen el filtro (ruta=..., bus=...) y borra los que aún no empiezan.
    Devuelve (finalizados, eliminados)."""
    finalizados = eliminados = 0
    ahora = timezone.now()
    with transaction.atomic():
        for turno in Turno.pendientes().filter(**filtro):
            if turno.estado == 'Programado':
                turno.delete()
                eliminados += 1
            else:
                turno.fin = ahora
                turno.save(update_fields=['fin'])
                finalizados += 1
    return finalizados, eliminados


def _habilitar_o_inhabilitar_ruta(request, ruta):
    """Cambia la habilitación de la ruta; al inhabilitarla publica una alerta y al habilitarla la resuelve."""
    return _cambiar_habilitacion(
        request, ruta, f'la ruta {ruta.codigo}', '/rutas/', {'ruta': ruta},
        al_inhabilitar=lambda: (_avisar_ruta_inhabilitada(ruta),
                                messages.info(request, 'Avisamos a los pasajeros con una alerta de que la ruta ya no está disponible.')),
        al_habilitar=lambda: (_avisar_ruta_habilitada(ruta),
                              messages.info(request, 'Avisamos a los pasajeros de que la ruta ya está disponible.')))


def _avisar_turnos_finalizados(request, finalizados, eliminados):
    partes = []
    if finalizados:
        partes.append(f'{finalizados} turno{"s" if finalizados != 1 else ""} finalizado{"s" if finalizados != 1 else ""}')
    if eliminados:
        partes.append(f'{eliminados} programado{"s" if eliminados != 1 else ""} eliminado{"s" if eliminados != 1 else ""}')
    if partes:
        messages.info(request, ' y '.join(partes).capitalize() + '.')


def _error_de_reautenticacion(request, objeto, que='la ruta'):
    """Finalizar turnos e inhabilitar es destructivo: se pide iniciar sesión de nuevo con la cuenta de la empresa
    dueña de la ruta o del bus (usuario y contraseña). No cambia la sesión actual. Devuelve un mensaje de error
    o None. Pasa por el mismo bloqueo por intentos fallidos que el login de empresa."""
    usuario = (request.POST.get('confirmar_usuario') or '').strip()
    clave = request.POST.get('confirmar_clave') or ''
    if not usuario or not clave:
        return (f'Para finalizar los turnos e inhabilitar {que}, inicia sesión de nuevo con la cuenta de la '
                'empresa: escribe tu usuario y tu contraseña.')
    bloqueo = seguridad.login_bloqueado(request, usuario, 'django')
    if bloqueo:
        return bloqueo
    cuenta = authenticate(request, username=usuario, password=clave)
    administrador = getattr(cuenta, 'administrador', None) if cuenta else None
    if administrador is None or administrador.empresa_id != objeto.empresa_id or not administrador.empresa.activa:
        # Un solo mensaje: no revela si el usuario existe ni de qué empresa es
        return (f'Usuario o contraseña incorrectos, o esa cuenta no es de la empresa dueña de {que}. '
                'No se finalizó ni se inhabilitó nada.').replace(' de el ', ' del ')
    return None


def _finalizar_turnos_para_inhabilitar(request, objeto, filtro, que, volver):
    """Para inhabilitar un bus o un conductor con turnos en curso o programados hay que finalizarlos (campo
    `turnos=finalizar`) y confirmar iniciando sesión de nuevo con la cuenta de la empresa. `filtro` dice de quién
    son los turnos (bus=... o conductor=...). Devuelve una respuesta si no se puede seguir (falta la decisión o la
    contraseña es incorrecta), o None si no había turnos o ya se finalizaron: ahí sigue el cambio normal."""
    inhabilita = request.method == 'POST' and request.POST.get('habilitado') != '1'
    pendientes = Turno.pendientes().filter(**filtro).count() if inhabilita else 0
    if not pendientes:
        return None
    if request.POST.get('turnos') != 'finalizar':
        plural = pendientes != 1
        messages.error(request, f'{que[0].upper() + que[1:]} tiene {pendientes} turno{"s" if plural else ""} en '
                                f'curso o programado{"s" if plural else ""}. Para inhabilitarlo hay que finalizarlos.')
        return redirect(volver)
    error = _error_de_reautenticacion(request, objeto, que)
    if error:
        messages.error(request, error)
        return redirect(volver)
    finalizados, eliminados = _finalizar_turnos(**filtro)
    _avisar_turnos_finalizados(request, finalizados, eliminados)
    return None


@admin_empresa_required
def habilitacionRuta(request, id_ruta):
    """Habilita o inhabilita una ruta. Si al inhabilitarla tiene turnos en curso o programados, la empresa elige
    qué pasa con ellos (campo `turnos`):
    - "pausa": la ruta no se inhabilita; queda fuera de servicio con un motivo y sus turnos quedan en pausa.
    - "finalizar": los turnos en curso terminan ahora, los programados se eliminan y la ruta se inhabilita.
      Antes hay que iniciar sesión de nuevo con la cuenta de la empresa dueña de la ruta."""
    ruta = _buscar(Ruta, id_ruta=id_ruta, empresa=request.empresa)
    if ruta is None:
        messages.error(request, 'La ruta no existe.')
        return redirect('/rutas/')

    inhabilita = request.method == 'POST' and request.POST.get('habilitado') != '1'
    pendientes = Turno.pendientes().filter(ruta=ruta).count() if inhabilita else 0
    if not pendientes:
        return _habilitar_o_inhabilitar_ruta(request, ruta)

    decision = request.POST.get('turnos')
    plural = pendientes != 1
    cuantos = f'{pendientes} turno{"s" if plural else ""} en curso o programado{"s" if plural else ""}'

    if decision == 'pausa':
        if ruta.fuera_de_servicio:
            messages.info(request, f'La ruta {ruta.codigo} ya está fuera de servicio: sus turnos ya están en pausa.')
            return redirect('/rutas/')
        motivo, error = _motivo_del_formulario(request, 'Fuera_servicio')
        if error:
            messages.error(request, error)
            return redirect('/rutas/')
        estado_anterior = ruta.estado
        ruta.estado = 'Fuera_servicio'
        ruta.motivo_fuera_servicio = motivo
        ruta.save(update_fields=['estado', 'motivo_fuera_servicio'])
        _publicar_estado_ruta(request, ruta, estado_anterior)
        return redirect('/rutas/')

    if decision == 'finalizar':
        error = _error_de_reautenticacion(request, ruta)
        if error:
            messages.error(request, error)
            return redirect('/rutas/')
        finalizados, eliminados = _finalizar_turnos_de_ruta(ruta)
        _avisar_turnos_finalizados(request, finalizados, eliminados)
        return _habilitar_o_inhabilitar_ruta(request, ruta)

    messages.error(request, f'La ruta {ruta.codigo} tiene {cuantos}. Elige qué hacer con ellos: ponerla fuera de '
                            f'servicio (quedan en pausa) o finalizarlos antes de inhabilitarla.')
    return redirect('/rutas/')


# ================= VERIFICAR CÓDIGO DE RUTA (AJAX) =================

@admin_empresa_required
def verificar_codigo_ruta(request):
    """Verifica si un código de ruta ya existe (excluyendo la ruta actual si está editando)"""
    if request.method == 'POST':
        codigo = request.POST.get('codigo', '').strip()
        ruta_id = request.POST.get('ruta_id', '').strip()
        
        if not codigo:
            return JsonResponse({'existe': False})
        
        # El código solo debe ser único dentro de la empresa
        query = Ruta.objects.filter(codigo__iexact=codigo, empresa=empresa_del_usuario(request))
        
        # Si está editando, excluir la ruta actual
        if ruta_id:
            try:
                query = query.exclude(id_ruta=int(ruta_id))
            except (ValueError, TypeError):
                pass
        
        existe = query.exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


# ================= CONDUCTORES =================

def _turnos_vigentes_por(campo, empresa):
    """{id de conductor o bus: turno vigente} de la empresa, en una sola consulta."""
    turnos = Turno.vigentes().filter(bus__empresa=empresa).select_related('conductor', 'bus', 'ruta')
    return {getattr(t, campo): t for t in turnos}


def _marcar_estado_conductores(conductores, empresa):
    """Pone a cada conductor su turno de ahora, si su bus transmite, sus turnos pendientes y su estado
    (ESTADOS_CONDUCTOR). Devuelve {id de conductor: turnos en curso}, que usa la ventana de inhabilitar."""
    turnos = _turnos_vigentes_por('conductor_id', empresa)
    # Turnos en curso o programados por conductor: inhabilitarlo obliga a finalizarlos
    pendientes = {}
    en_curso = {}
    for turno in Turno.pendientes().filter(conductor__in=conductores):
        pendientes[turno.conductor_id] = pendientes.get(turno.conductor_id, 0) + 1
        if turno.estado != 'Programado':
            en_curso[turno.conductor_id] = en_curso.get(turno.conductor_id, 0) + 1

    # Buses que enviaron su ubicación hace poco (el mismo límite que usa la lista de buses):
    # un conductor en turno cuyo bus no transmite no se ve en el mapa
    hace_poco = timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL)
    transmitiendo = set(UbicacionBus.objects.filter(bus_id__in=[t.bus_id for t in turnos.values()],
                                                    timestamp__gte=hace_poco).values_list('bus_id', flat=True))
    for conductor in conductores:
        conductor.turno = turnos.get(conductor.id_conductor)
        conductor.transmite = bool(conductor.turno and conductor.turno.bus.activo
                                   and conductor.turno.bus_id in transmitiendo)
        conductor.turnos_pendientes = pendientes.get(conductor.id_conductor, 0)
        conductor.turno_color = COLORES_RUTA[conductor.turno.ruta_id % len(COLORES_RUTA)] if conductor.turno else ''
        if not conductor.habilitado:
            conductor.estado_visible = 'Inhabilitado'
        elif conductor.turno:
            conductor.estado_visible = 'En_turno'
        else:
            conductor.estado_visible = 'Sin_turno'
    return en_curso


# Estados de un conductor en la lista y en el reporte, en este orden
ESTADOS_CONDUCTOR = {'En_turno': 'En turno', 'Sin_turno': 'Sin turno', 'Inhabilitado': 'Inhabilitado'}


@admin_empresa_required
def conductores(request):
    conductores = list(request.empresa.conductores.order_by('-habilitado', 'nombre'))
    en_curso = _marcar_estado_conductores(conductores, request.empresa)

    rutas = list(request.empresa.rutas.order_by('codigo'))
    for ruta in rutas:
        ruta.color = COLORES_RUTA[ruta.id_ruta % len(COLORES_RUTA)]
    nombres_estado = [('En_turno', 'En turno'), ('Sin_turno', 'Sin turno'), ('Inhabilitado', 'Inhabilitados')]
    pestanas_estado = [(clave, nombre, sum(c.estado_visible == clave for c in conductores))
                       for clave, nombre in nombres_estado]
    # Ventana del reporte: el inhabilitado aparece como "Inhabilitados", igual que en las pestañas
    estados_reporte = dict(nombres_estado)
    conductores_json = [{
        'id': c.id_conductor, 'nombre': c.nombre, 'cedula': c.cedula, 'telefono': c.telefono, 'email': c.email,
        'turnos_pendientes': c.turnos_pendientes, 'turnos_en_curso': en_curso.get(c.id_conductor, 0),
    } for c in conductores]
    return render(request, 'core/conductores.html', {
        'conductores': conductores, 'rutas': rutas, 'pestanas_estado': pestanas_estado,
        'conductores_json': conductores_json, 'estados_reporte': estados_reporte,
        # Vistas "Por estado" y "Gráficas": todas las rutas de la empresa con su color
        'rutas_vista': [{'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'color': r.color,
                         'habilitada': r.habilitado, 'en_servicio': r.habilitado and not r.fuera_de_servicio}
                        for r in rutas],
    })


def _validar_conductor(datos, conductor_id=None):
    """Valida los datos del formulario de conductor. Devuelve un mensaje de error o None."""
    if not all([datos['nombre'], datos['cedula'], datos['telefono'], datos['email']]):
        return 'Nombre, cédula, teléfono y correo son obligatorios.'
    error = _texto_muy_largo(Conductor, nombre=datos['nombre'], cedula=datos['cedula'], telefono=datos['telefono'],
                             email=datos['email'], contrasena=datos['contrasena'])
    if error:
        return error
    # La contraseña es opcional al editar (vacía = se conserva), pero si se escribe debe tener 8 o más
    if datos['contrasena'] and len(datos['contrasena']) < 8:
        return 'La contraseña del conductor debe tener al menos 8 caracteres.'

    otros = Conductor.objects.exclude(id_conductor=conductor_id) if conductor_id else Conductor.objects.all()
    for repetido, texto in ((otros.filter(cedula=datos['cedula']).first(), f'la cédula {datos["cedula"]}'),
                            (otros.filter(email__iexact=datos['email']).first(), f'el correo {datos["email"]}')):
        if repetido:
            pista = ' Está inhabilitado: vuelve a habilitarlo en la lista.' if not repetido.habilitado else ''
            return f'Ya existe un conductor con {texto}.{pista}'
    return None


def _datos_conductor(request):
    return {
        'nombre': (request.POST.get('nombre') or '').strip(),
        'cedula': (request.POST.get('cedula') or '').strip(),
        'telefono': (request.POST.get('telefono') or '').strip(),
        'email': (request.POST.get('email') or '').strip().lower(),
        'contrasena': request.POST.get('contrasena') or '',
    }


@admin_empresa_required
def crearConductor(request):
    if request.method != 'POST':
        return redirect('/conductores/')

    datos = _datos_conductor(request)
    error = _validar_conductor(datos)
    if not error and not datos['contrasena']:
        error = 'La contraseña es obligatoria.'
    if error:
        messages.error(request, error)
        return redirect('/conductores/')

    conductor = Conductor(
        empresa=request.empresa,
        nombre=datos['nombre'],
        cedula=datos['cedula'],
        telefono=datos['telefono'],
        email=datos['email'],
    )
    conductor.set_contrasena(datos['contrasena'])
    try:
        conductor.save()
    except IntegrityError:
        messages.error(request, 'Ya existe un conductor con esa cédula o correo.')
    return redirect('/conductores/')


@admin_empresa_required
def editarConductor(request, id_conductor):
    if request.method != 'POST':
        return redirect('/conductores/')

    conductor = _buscar(Conductor, id_conductor=id_conductor, empresa=request.empresa)
    if conductor is None:
        messages.error(request, 'El conductor que intentas editar no existe.')
        return redirect('/conductores/')

    datos = _datos_conductor(request)
    error = _validar_conductor(datos, conductor.id_conductor)
    if error:
        messages.error(request, error)
        return redirect('/conductores/')

    conductor.nombre = datos['nombre']
    conductor.cedula = datos['cedula']
    conductor.telefono = datos['telefono']
    conductor.email = datos['email']
    # En edición la contraseña es opcional: si viene vacía se conserva la actual
    if datos['contrasena']:
        conductor.set_contrasena(datos['contrasena'])
    try:
        conductor.save()
    except IntegrityError:
        messages.error(request, 'Ya existe un conductor con esa cédula o correo.')
    return redirect('/conductores/')


@admin_empresa_required
def habilitacionConductor(request, id_conductor):
    conductor = _buscar(Conductor, id_conductor=id_conductor, empresa=request.empresa)
    if conductor is None:
        messages.error(request, 'El conductor no existe.')
        return redirect('/conductores/')
    # Con turnos en curso o programados, inhabilitar obliga a finalizarlos y pide la cuenta de la empresa
    respuesta = _finalizar_turnos_para_inhabilitar(request, conductor, {'conductor': conductor},
                                                   f'el conductor {conductor.nombre}', '/conductores/')
    if respuesta:
        return respuesta
    return _cambiar_habilitacion(request, conductor, f'al conductor {conductor.nombre}', '/conductores/',
                                 {'conductor': conductor})


# ================= VERIFICAR CÉDULA (AJAX) =================

@admin_empresa_required
def verificar_cedula_conductor(request):
    """Verifica si una cédula ya está registrada (excluyendo al conductor actual si está editando)"""
    if request.method == 'POST':
        cedula = request.POST.get('cedula', '').strip()
        conductor_id = request.POST.get('conductor_id', '').strip()
        
        if not cedula:
            return JsonResponse({'existe': False})
        
        query = Conductor.objects.filter(cedula=cedula)
        
        if conductor_id:
            try:
                query = query.exclude(id_conductor=int(conductor_id))
            except (ValueError, TypeError):
                pass
        
        existe = query.exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


# ================= VERIFICAR EMAIL CONDUCTOR (AJAX) =================

@admin_empresa_required
def verificar_email_conductor(request):
    """Verifica si un email ya está registrado (excluyendo al conductor actual si está editando)"""
    if request.method == 'POST':
        email = request.POST.get('email', '').strip().lower()
        conductor_id = request.POST.get('conductor_id', '').strip()
        
        if not email:
            return JsonResponse({'existe': False})
        
        query = Conductor.objects.filter(email__iexact=email)
        
        if conductor_id:
            try:
                query = query.exclude(id_conductor=int(conductor_id))
            except (ValueError, TypeError):
                pass
        
        existe = query.exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


# ================= VERIFICAR TELÉFONO CONDUCTOR (AJAX) =================

@admin_empresa_required
def verificar_telefono_conductor(request):
    """Verifica si un teléfono ya está registrado (excluyendo al conductor actual si está editando)"""
    if request.method == 'POST':
        telefono = request.POST.get('telefono', '').strip()
        conductor_id = request.POST.get('conductor_id', '').strip()
        
        if not telefono:
            return JsonResponse({'existe': False})
        
        query = Conductor.objects.filter(telefono=telefono)
        
        if conductor_id:
            try:
                query = query.exclude(id_conductor=int(conductor_id))
            except (ValueError, TypeError):
                pass
        
        existe = query.exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})
# ================= BUSES =================

# Estados de un bus en la lista y en el reporte, en este orden
ESTADOS_BUS = {'Transmitiendo': 'Transmitiendo', 'En_turno': 'En turno', 'Sin_turno': 'Sin turno',
               'Inhabilitado': 'Inhabilitado'}


def _marcar_estado_buses(buses, empresa):
    """Pone a cada bus su turno de ahora, su estado (ESTADOS_BUS) y sus rutas ordenadas, con su color."""
    turnos = _turnos_vigentes_por('bus_id', empresa)
    # Buses que enviaron su ubicación hace poco (el mismo límite con el que salen del mapa)
    hace_poco = timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL)
    transmitiendo = set(UbicacionBus.objects.filter(bus__in=buses, timestamp__gte=hace_poco)
                        .values_list('bus_id', flat=True))
    for bus in buses:
        bus.turno = turnos.get(bus.id_bus)
        bus.turno_color = COLORES_RUTA[bus.turno.ruta_id % len(COLORES_RUTA)] if bus.turno else ''
        if not bus.habilitado:
            bus.estado_visible = 'Inhabilitado'
        elif bus.turno and bus.activo and bus.id_bus in transmitiendo:
            bus.estado_visible = 'Transmitiendo'
        elif bus.turno:
            bus.estado_visible = 'En_turno'
        else:
            bus.estado_visible = 'Sin_turno'
        bus.rutas_lista = sorted(bus.rutas.all(), key=lambda r: r.codigo)
        for ruta in bus.rutas_lista:
            ruta.color = COLORES_RUTA[ruta.id_ruta % len(COLORES_RUTA)]
    return buses


@admin_empresa_required
def buses(request):
    buses = _marcar_estado_buses(
        list(request.empresa.buses.prefetch_related('rutas').order_by('-habilitado', 'placa')), request.empresa)
    # Turnos en curso o programados por bus: inhabilitar un bus con turnos no está permitido
    pendientes = {}
    en_curso = {}
    for turno in Turno.pendientes().filter(bus__in=buses):
        pendientes[turno.bus_id] = pendientes.get(turno.bus_id, 0) + 1
        if turno.estado != 'Programado':
            en_curso[turno.bus_id] = en_curso.get(turno.bus_id, 0) + 1

    for bus in buses:
        bus.turnos_pendientes = pendientes.get(bus.id_bus, 0)

    rutas = list(request.empresa.rutas.order_by('codigo'))
    for ruta in rutas:
        ruta.color = COLORES_RUTA[ruta.id_ruta % len(COLORES_RUTA)]

    nombres_estado = [('Transmitiendo', 'Transmitiendo'), ('En_turno', 'En turno'),
                      ('Sin_turno', 'Sin turno'), ('Inhabilitado', 'Inhabilitados')]
    pestanas_estado = [(clave, nombre, sum(b.estado_visible == clave for b in buses)) for clave, nombre in nombres_estado]
    buses_json = [{
        'id': b.id_bus, 'placa': b.placa, 'rutas': [r.id_ruta for r in b.rutas_lista],
        'turnos_pendientes': b.turnos_pendientes, 'turnos_en_curso': en_curso.get(b.id_bus, 0),
        'habilitado': b.habilitado,
    } for b in buses]

    return render(request, 'core/buses.html', {
        'buses': buses, 'rutas': rutas, 'buses_json': buses_json, 'pestanas_estado': pestanas_estado,
        'estados_reporte': ESTADOS_BUS,
        # Vistas "Por ruta" y "Matriz": todas las rutas de la empresa con su color
        'rutas_vista': [{'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'color': r.color,
                         'habilitada': r.habilitado} for r in rutas],
    })


def _rutas_del_formulario(request):
    """Rutas elegidas en el formulario que pertenecen a la empresa. None si alguna no es válida."""
    ids = [i for i in request.POST.getlist('rutas') if i]
    if not all(i.isdigit() for i in ids):
        return None
    rutas = list(request.empresa.rutas.filter(id_ruta__in=ids))
    return rutas if len(rutas) == len(set(ids)) else None


def _validar_bus(placa, rutas, bus=None):
    """Valida los datos del formulario de bus. Devuelve un mensaje de error o None."""
    if not placa:
        return 'La placa es obligatoria.'
    error = _texto_muy_largo(Bus, placa=placa)
    if error:
        return error
    if rutas is None:
        return 'Alguna de las rutas seleccionadas no existe.'
    if not rutas:
        return 'Selecciona al menos una ruta que pueda cubrir el bus.'
    otros = Bus.objects.exclude(id_bus=bus.id_bus) if bus else Bus.objects.all()
    repetido = otros.filter(placa__iexact=placa).first()
    if repetido:
        pista = ' Está inhabilitado: vuelve a habilitarlo en la lista.' if not repetido.habilitado else ''
        return f'Ya existe un bus con la placa {placa}.{pista}'
    if bus:
        # No se puede quitar una ruta que tiene turnos en curso o programados con este bus
        quitadas = bus.rutas.exclude(id_ruta__in=[r.id_ruta for r in rutas])
        pendiente = Turno.que_se_cruzan(timezone.now(), None).filter(bus=bus, ruta__in=quitadas).first()
        if pendiente:
            return f'No puedes quitar la ruta {pendiente.ruta.codigo}: tiene turnos en curso o programados ({pendiente}).'
    return None


@admin_empresa_required
def CrearBus(request):
    if request.method == 'POST':
        placa = (request.POST.get('placa') or '').strip().upper()
        rutas = _rutas_del_formulario(request)

        error = _validar_bus(placa, rutas)
        if error:
            messages.error(request, error)
            return redirect('/buses/')

        try:
            bus = Bus.objects.create(empresa=request.empresa, placa=placa)
            bus.rutas.set(rutas)
        except IntegrityError:
            messages.error(request, f'Ya existe un bus con la placa {placa}.')
    return redirect('/buses/')


@admin_empresa_required
def EditarBus(request):
    if request.method == 'POST':
        bus = _buscar(Bus, id_bus=request.POST.get('id_bus'), empresa=request.empresa)
        if bus is None:
            messages.error(request, 'El bus que intentas editar no existe.')
            return redirect('/buses/')

        placa = (request.POST.get('placa') or '').strip().upper()
        rutas = _rutas_del_formulario(request)

        error = _validar_bus(placa, rutas, bus)
        if error:
            messages.error(request, error)
            return redirect('/buses/')

        bus.placa = placa
        try:
            bus.save()
            bus.rutas.set(rutas)
        except IntegrityError:
            messages.error(request, f'Ya existe un bus con la placa {placa}.')
    return redirect('/buses/')


@admin_empresa_required
def habilitacionBus(request, id_bus):
    bus = _buscar(Bus, id_bus=id_bus, empresa=request.empresa)
    if bus is None:
        messages.error(request, 'El bus no existe.')
        return redirect('/buses/')

    def detener():
        # Un bus inhabilitado deja de simularse y sale del mapa
        ConfiguracionBus.objects.filter(bus=bus).update(simulando=False)
        Bus.objects.filter(pk=bus.pk).update(activo=False)

    def cambiar():
        return _cambiar_habilitacion(request, bus, f'el bus {bus.placa}', '/buses/', {'bus': bus}, detener)

    # Con turnos en curso o programados, inhabilitar obliga a finalizarlos y pide la cuenta de la empresa
    respuesta = _finalizar_turnos_para_inhabilitar(request, bus, {'bus': bus}, f'el bus {bus.placa}', '/buses/')
    return respuesta or cambiar()


# ================= TURNOS =================

def _fecha_hora(fecha, hora):
    """Combina 'AAAA-MM-DD' y 'HH:MM' en un datetime con la zona horaria local. None si no es válido."""
    try:
        return timezone.make_aware(datetime.strptime(f'{fecha} {hora}', '%Y-%m-%d %H:%M'))
    except (ValueError, TypeError):
        return None


def _recursos_del_turno(request):
    """Conductor, bus y ruta del formulario, solo si son de la empresa del administrador."""
    return (
        _buscar(Conductor, id_conductor=request.POST.get('conductor'), empresa=request.empresa),
        _buscar(Bus, id_bus=request.POST.get('bus'), empresa=request.empresa),
        _buscar(Ruta, id_ruta=request.POST.get('ruta'), empresa=request.empresa),
    )


_DIAS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
_MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
             'noviembre', 'diciembre']


def _texto_del_dia(dia):
    """"lunes 9 de noviembre de 2026" (el idioma del sitio es inglés, así que no sirve el filtro date)."""
    return f'{_DIAS_ES[dia.weekday()]} {dia.day} de {_MESES_ES[dia.month - 1]} de {dia.year}'


@admin_empresa_required
def turnos(request):
    """Turnos que se cruzan con el día elegido (por defecto hoy), incluidos los nocturnos y los fijos."""
    try:
        dia = datetime.strptime(request.GET.get('fecha', ''), '%Y-%m-%d').date()
    except ValueError:
        dia = timezone.localdate()
    inicio_dia = timezone.make_aware(datetime.combine(dia, time.min))

    turnos_dia = list(Turno.que_se_cruzan(inicio_dia, inicio_dia + timedelta(days=1))
                      .filter(bus__empresa=request.empresa)
                      .select_related('conductor', 'bus', 'ruta')
                      .order_by('inicio', 'bus__placa'))

    # Datos para preguntar al editar si el cambio es para este día, los siguientes o todos
    ahora = timezone.now()
    series = {t.serie for t in turnos_dia if t.serie and not t.fijo}
    pendientes = {}
    for serie, inicio in (Turno.objects.filter(serie__in=series, fijo=False, inicio__gt=ahora)
                          .order_by('inicio').values_list('serie', 'inicio')):
        pendientes.setdefault(serie, []).append(inicio)
    # Días de cada rotación que ya empezaron: "Todos los días" no los cambia (son historial)
    empezados = dict(Turno.objects.filter(serie__in=series, fijo=False, inicio__lte=ahora)
                     .order_by().values_list('serie').annotate(total=Count('id_turno')))
    for t in turnos_dia:
        fechas = [timezone.localtime(i).date() for i in pendientes.get(t.serie, [])] or [timezone.localtime(t.inicio).date()]
        t.serie_desde, t.serie_hasta = fechas[0], fechas[-1]
        # Días de la semana de la rotación; vacío si cubre todos los días del rango
        semana = sorted({f.weekday() for f in fechas})
        completos = len(set(fechas)) == (fechas[-1] - fechas[0]).days + 1
        t.serie_dias = t.dias if t.fijo else ('' if completos else ','.join(map(str, semana)))
        jornada = _jornada_del_dia(t, dia)
        t.jornada_inicio = jornada[0] if jornada else t.inicio
        t.jornada_empezo = t.jornada_inicio <= ahora
        if t.fijo:
            t.varios_dias = True
            t.pendientes_siguientes = t.pendientes_todos = 0
            # "Todos los días" de un fijo que ya empezó cambia desde su próxima jornada (como una rotación)
            proximo = t.proximo_inicio(ahora) if t.estado != 'Finalizado' else None
            t.proximo_dia = timezone.localtime(proximo).date() if proximo else None
        else:
            de_la_serie = pendientes.get(t.serie, [])
            t.pendientes_todos = len(de_la_serie)
            t.pendientes_siguientes = sum(1 for i in de_la_serie if i >= t.inicio)
            t.serie_empezados = empezados.get(t.serie, 0)
            # Solo se pregunta si hay otros días de la misma rotación que aún se pueden cambiar
            t.varios_dias = t.estado == 'Programado' and t.pendientes_todos > 1
        # Estado de la jornada de ESTE día (lo que se muestra): un fijo vigente cuya jornada de hoy ya terminó
        # se ve Finalizado; la de un día que aún no llega, Programado. El estado del turno completo
        # (t.estado) sigue decidiendo qué se puede hacer con él.
        inicio_jornada, fin_jornada = jornada if jornada else (t.inicio, t.fin)
        # Fin real de la jornada de ese día: si se finalizó antes, es la fecha y hora en que se finalizó
        t.jornada_fin = fin_jornada
        if fin_jornada is not None and fin_jornada <= ahora:
            t.estado_dia = 'Finalizado'
        elif inicio_jornada > ahora:
            t.estado_dia = 'Programado'
        else:
            t.estado_dia = 'En curso'
        # Una jornada que ya terminó no se edita (es historial); los días siguientes se editan desde su día
        t.editable = t.estado_dia != 'Finalizado' and (
            t.estado == 'Programado' or (t.estado == 'En curso' and not t.fijo)
            or (t.fijo and t.estado != 'Finalizado'))
        t.estado_clave = t.estado_dia
        t.ruta_color = COLORES_RUTA[t.ruta_id % len(COLORES_RUTA)]

    estados = ['En curso', 'Programado', 'Finalizado']
    pestanas_estado = [(e, e, sum(t.estado_clave == e for t in turnos_dia)) for e in estados]

    # Vistas "Por ruta", "Línea de tiempo" y "Gráficas": las rutas habilitadas de la empresa y las que tengan
    # turnos este día, con su color; el filtro de ruta usa las mismas
    con_turno = {t.ruta_id for t in turnos_dia}
    rutas_vista = [r for r in request.empresa.rutas.order_by('codigo') if r.habilitado or r.id_ruta in con_turno]
    for ruta in rutas_vista:
        ruta.color = COLORES_RUTA[ruta.id_ruta % len(COLORES_RUTA)]

    return render(request, 'core/turnos.html', {
        'turnos': turnos_dia,
        'pestanas_estado': pestanas_estado,
        'rutas_filtro': rutas_vista,
        'estados_reporte': ESTADOS_TURNO,
        'rutas_vista': [{'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'color': r.color,
                         'en_servicio': r.habilitado and not r.fuera_de_servicio} for r in rutas_vista],
        # Límites del día que se ve (para la línea de tiempo) y el momento actual
        'dia_vista': {'inicio': inicio_dia.isoformat(),
                      'fin': (inicio_dia + timedelta(days=1)).isoformat(),
                      'ahora': ahora.isoformat()},
        'dia': dia,
        'dia_texto': _texto_del_dia(dia),
        'es_hoy': dia == timezone.localdate(),
        'dia_anterior': dia - timedelta(days=1),
        'dia_siguiente': dia + timedelta(days=1),
        'conductores': request.empresa.conductores.filter(habilitado=True).order_by('nombre'),
        'buses': request.empresa.buses.filter(habilitado=True).prefetch_related('rutas').order_by('placa'),
        'rutas': request.empresa.rutas.filter(habilitado=True).exclude(estado='Fuera_servicio').order_by('codigo'),
        'dias_semana': Turno.NOMBRES_DIAS,
    })


def _turnos_del_formulario(request):
    """Arma y valida los turnos del formulario sin guardarlos.

    Devuelve (turnos, None, ()) si todo es válido, o ([], mensaje, campos) con los
    campos del formulario que hay que corregir.
    """
    conductor, bus, ruta = _recursos_del_turno(request)
    faltan = tuple(campo for campo, valor in (('conductor', conductor), ('bus', bus), ('ruta', ruta)) if not valor)
    if faltan:
        return [], 'Selecciona un conductor, un bus y una ruta de tu empresa.', faltan

    desde = request.POST.get('desde')
    hora_inicio = request.POST.get('hora_inicio')
    hora_fin = request.POST.get('hora_fin')
    dias_semana = {int(d) for d in request.POST.getlist('dias') if d.isdigit() and int(d) < 7}

    if request.POST.get('fijo'):
        # Un solo turno que se repite cada día elegido, de hora_inicio a hora_fin, sin fecha final
        inicio = _fecha_hora(desde, hora_inicio)
        if inicio is None:
            return [], 'Indica una fecha y hora de inicio válidas.', ('desde', 'hora_inicio')
        if _fecha_hora(desde, hora_fin) is None:
            return [], 'Indica la hora en que termina la jornada.', ('hora_fin',)
        turno = Turno(conductor=conductor, bus=bus, ruta=ruta, inicio=inicio, fijo=True,
                      hora_fin=datetime.strptime(hora_fin, '%H:%M').time(),
                      dias=','.join(str(d) for d in sorted(dias_semana)))
        problema = turno.problema()
        if problema:
            return [], f'No se programó el turno fijo: {problema[0]}', problema[1]
        return [turno], None, ()
    else:
        hasta = request.POST.get('hasta') or desde
        primero, ultimo = _fecha_hora(desde, hora_inicio), _fecha_hora(hasta, hora_inicio)
        fin_primero = _fecha_hora(desde, hora_fin)
        if None in (primero, ultimo, fin_primero):
            invalidos = tuple(campo for campo, valor in (('desde', primero), ('hasta', ultimo), ('hora_fin', fin_primero))
                              if valor is None)
            return [], 'Indica fechas y horas válidas para el turno.', invalidos + ('hora_inicio',)
        if ultimo < primero:
            return [], 'La fecha final no puede ser anterior a la inicial.', ('hasta',)
        if (ultimo.date() - primero.date()).days > 62:
            return [], 'Puedes programar como máximo 2 meses a la vez.', ('hasta',)

        duracion = fin_primero - primero
        if duracion <= timedelta(0):
            duracion += timedelta(days=1)  # turno nocturno: termina al día siguiente

        periodos = []
        dia = primero.date()
        while dia <= ultimo.date():
            if not dias_semana or dia.weekday() in dias_semana:
                inicio = _fecha_hora(dia.isoformat(), hora_inicio)
                periodos.append((inicio, inicio + duracion))
            dia += timedelta(days=1)
        if not periodos:
            return [], 'Ningún día del rango coincide con los días de la semana elegidos.', ('dias', 'desde', 'hasta')

    # Se validan todos antes de guardar: o se crean todos o ninguno
    nuevos = []
    for inicio, fin in periodos:
        # Los periodos generados duran como máximo 24 h y empiezan en días distintos: no se cruzan entre sí
        turno = Turno(conductor=conductor, bus=bus, ruta=ruta, inicio=inicio, fin=fin)
        problema = turno.problema()
        if problema:
            error, campos = problema
            return [], f'No se programó ningún turno. {timezone.localtime(inicio):%d/%m/%Y}: {error}', campos
        nuevos.append(turno)
    return nuevos, None, ()


@admin_empresa_required
def crearTurno(request):
    """Programa turnos para un rango de días con el mismo horario.

    Si la hora de fin es menor o igual a la de inicio, el turno termina al día siguiente (nocturno).
    Con "asignación fija" se crea un solo turno sin fin.
    Desde el modal (fetch) responde JSON: si hay un error el modal sigue abierto y marca los campos.
    """
    destino = f"/turnos/?fecha={request.POST.get('desde', '')}"
    if request.method != 'POST':
        return redirect('/turnos/')
    desde_modal = request.headers.get('x-requested-with') == 'XMLHttpRequest'

    nuevos, error, campos = _turnos_del_formulario(request)
    if error:
        if desde_modal:
            return JsonResponse({'error': error, 'campos': list(campos)}, status=400)
        messages.error(request, error)
        return redirect(destino)

    serie = uuid.uuid4()
    for turno in nuevos:
        turno.serie = serie
    Turno.objects.bulk_create(nuevos)
    messages.success(request, f'Se programaron {len(nuevos)} turno(s) para {nuevos[0].conductor.nombre} '
                              f'en el bus {nuevos[0].bus.placa}.')
    if desde_modal:
        return JsonResponse({'status': 'ok', 'redirect': destino})
    return redirect(destino)


def _respuesta_turno(request, desde_modal, error, campos, destino):
    """Error del formulario de turnos: JSON para el modal (sigue abierto) o mensaje y redirección."""
    if desde_modal:
        return JsonResponse({'error': error, 'campos': list(campos)}, status=400)
    messages.error(request, error)
    return redirect(destino)


def _jornada_del_dia(turno, dia):
    """(inicio, fin) de la jornada del turno que corresponde al día `dia`: la que empieza ese día
    o, si no hay, la nocturna que viene de la víspera. None si ese día no tiene jornada."""
    inicio_dia = timezone.make_aware(datetime.combine(dia, time.min))
    jornadas = list(turno.ventanas(inicio_dia, inicio_dia + timedelta(days=1)))
    for jornada in jornadas:
        if timezone.localtime(jornada[0]).date() == dia:
            return jornada
    return jornadas[0] if jornadas else None


class _TurnoRechazado(Exception):
    def __init__(self, mensaje, campos=()):
        super().__init__(mensaje)
        self.mensaje, self.campos = mensaje, tuple(campos)


def _reemplazar_con_formulario(request, forzar, quitar=(), recortar=(), agregar=(), serie=None):
    """Quita los turnos `quitar`, guarda los `recortar` (fijos terminados antes) y los `agregar`
    (tramos que se conservan), y crea en su lugar los turnos del formulario, igual que "Programar".
    Todo en una transacción: si algo no es válido no cambia nada.
    `forzar` fija campos del formulario según el alcance (p. ej. la fecha "desde")."""
    datos = request.POST.copy()
    for campo, valor in forzar.items():
        if isinstance(valor, list):
            datos.setlist(campo, valor)
        else:
            datos[campo] = valor
    original, request.POST = request.POST, datos  # _turnos_del_formulario lee request.POST
    try:
        with transaction.atomic():
            for turno in quitar:
                turno.delete()
            for turno in list(recortar) + list(agregar):
                turno.save()
            primero = _fecha_hora(datos.get('desde'), datos.get('hora_inicio'))
            if primero is not None and primero <= timezone.now():
                raise _TurnoRechazado('El turno no puede empezar en el pasado.', ('desde', 'hora_inicio'))
            nuevos, error, campos = _turnos_del_formulario(request)
            if error:
                raise _TurnoRechazado(error.replace('No se programó', 'No se guardó'), campos)
            ahora = timezone.now()
            if any(t.inicio <= ahora for t in nuevos):
                raise _TurnoRechazado('El turno no puede empezar en el pasado.', ('desde', 'hora_inicio'))
            for turno in nuevos:
                turno.serie = serie
            Turno.objects.bulk_create(nuevos)
            for turno in list(recortar) + list(agregar):
                problema = turno.problema()
                if problema:
                    raise _TurnoRechazado(f'No se guardó el turno: {problema[0]}', problema[1])
            return nuevos
    finally:
        request.POST = original


@admin_empresa_required
def editarTurno(request, id_turno):
    """Edita un turno sin reescribir el historial: la parte que aún no ocurre se reemplaza por lo que
    dice el formulario (los mismos campos que "Programar": fijo, desde, hasta, horas y días).

    `alcance`: 'todos' (todo lo que no ha empezado), 'siguientes' (desde el día `dia`) o 'dia' (solo ese
    día; un día suelto no puede ser fijo ni rango). Una rotación en curso solo cambia su hora de fin.
    """
    if request.method != 'POST':
        return redirect('/turnos/')
    desde_modal = request.headers.get('x-requested-with') == 'XMLHttpRequest'
    destino = _volver_a_turnos(request)
    turno = _buscar(Turno, id_turno=id_turno, bus__empresa=request.empresa)
    if turno is None:
        return _respuesta_turno(request, desde_modal, 'El turno no existe.', (), destino)

    ahora = timezone.now()
    estado = turno.estado
    try:
        if estado == 'Finalizado':
            raise _TurnoRechazado('Un turno finalizado no se edita: es parte del historial.')

        if estado == 'En curso' and not turno.fijo:
            # Rotación en curso: solo la hora de fin (alargar o acortar, nunca a una hora pasada)
            fin = _fecha_hora(timezone.localtime(turno.inicio).date().isoformat(), request.POST.get('hora_fin'))
            if fin is None:
                raise _TurnoRechazado('Indica una hora de fin válida.', ('hora_fin',))
            if fin <= turno.inicio:
                fin += timedelta(days=1)  # nocturno
            if fin <= ahora:
                raise _TurnoRechazado('La nueva hora de fin ya pasó. Para terminar el turno ahora usa ⏹️ Finalizar.',
                                      ('hora_fin',))
            turno.fin = fin
            with transaction.atomic():
                turno.save()
                problema = turno.problema()
                if problema:
                    raise _TurnoRechazado(f'No se guardó el turno: {problema[0]}', problema[1])
            mensaje = 'Turno actualizado.'
        else:
            alcance = request.POST.get('alcance') or 'todos'
            if alcance not in ('dia', 'siguientes', 'todos'):
                raise _TurnoRechazado('Elige a qué días aplicar el cambio.', ('alcance',))
            try:
                dia = datetime.strptime(request.POST.get('dia', ''), '%Y-%m-%d').date()
            except ValueError:
                dia = timezone.localtime(turno.inicio).date()
            serie = turno.serie or uuid.uuid4()
            un_dia = {'fijo': '', 'dias': []}  # un día suelto: ni fijo ni días de la semana

            if turno.fijo:
                jornada = _jornada_del_dia(turno, dia)
                if alcance == 'todos' and turno.inicio > ahora:
                    nuevos = _reemplazar_con_formulario(request, {}, quitar=[turno], serie=serie)
                elif alcance == 'todos':
                    # Igual que en una rotación: cambian todos los días que aún no empiezan y los ya trabajados
                    # (y la jornada en curso) quedan como estaban. El fijo original termina donde empieza la
                    # próxima jornada, y desde ese día rige lo del formulario.
                    proximo = turno.proximo_inicio(ahora)
                    if proximo is None:
                        raise _TurnoRechazado('El turno fijo no tiene más días por delante para cambiar.')
                    turno.fin, turno.serie = proximo, serie
                    nuevos = _reemplazar_con_formulario(
                        request, {'desde': timezone.localtime(proximo).date().isoformat()},
                        recortar=[turno], serie=serie)
                elif jornada is None:
                    raise _TurnoRechazado('Ese día el turno fijo no tiene jornada.')
                elif jornada[0] <= ahora:
                    raise _TurnoRechazado('La jornada de este día ya empezó. Para cambiar desde otro día, '
                                          'ábrelo en ese día con las flechas ◀ ▶.')
                else:
                    es_la_primera = jornada[0] <= turno.inicio
                    proximo = turno.proximo_inicio(jornada[0]) if alcance == 'dia' else None
                    # El fijo original termina justo antes de ese día (o se quita si ese día era el primero)
                    quitar, recortar, agregar = ([turno], [], []) if es_la_primera else ([], [turno], [])
                    if not es_la_primera:
                        turno.fin, turno.serie = jornada[0], serie
                    if proximo:
                        # "Solo este día": el fijo sigue igual desde la jornada siguiente
                        agregar.append(Turno(conductor=turno.conductor, bus=turno.bus, ruta=turno.ruta, fijo=True,
                                             hora_fin=turno.hora_fin, dias=turno.dias, inicio=proximo, serie=serie))
                    forzar = {'desde': dia.isoformat()}
                    if alcance == 'dia':
                        forzar.update(un_dia, hasta=dia.isoformat())
                    nuevos = _reemplazar_con_formulario(request, forzar, quitar, recortar, agregar, serie)

            else:
                pendientes = Turno.objects.filter(fijo=False, inicio__gt=ahora, bus__empresa=request.empresa)
                pendientes = pendientes.filter(serie=turno.serie) if turno.serie else pendientes.filter(pk=turno.pk)
                if alcance == 'dia':
                    quitar, forzar = [turno], dict(un_dia, hasta=request.POST.get('desde', ''))
                elif alcance == 'siguientes':
                    inicio_dia = timezone.make_aware(datetime.combine(dia, time.min))
                    quitar, forzar = list(pendientes.filter(inicio__gte=inicio_dia)), {'desde': dia.isoformat()}
                else:
                    quitar, forzar = list(pendientes), {}
                nuevos = _reemplazar_con_formulario(request, forzar, quitar=quitar, serie=serie)

            mensaje = f'Se guardaron los cambios: {len(nuevos)} turno(s).'
            if alcance == 'todos' and not turno.fijo and turno.serie:
                ya_empezados = Turno.objects.filter(serie=turno.serie, fijo=False, inicio__lte=ahora).count()
                if ya_empezados:
                    mensaje += f' {ya_empezados} que ya habían empezado se conservan como estaban (historial).'
    except _TurnoRechazado as error:
        return _respuesta_turno(request, desde_modal, error.mensaje, error.campos, destino)

    messages.success(request, mensaje)
    if desde_modal:
        return JsonResponse({'status': 'ok', 'redirect': destino})
    return redirect(destino)


@admin_empresa_required
def finalizarTurno(request, id_turno):
    """Termina ahora un turno en curso o una asignación fija (aunque esté fuera de horario)."""
    turno = _buscar(Turno, id_turno=id_turno, bus__empresa=request.empresa)
    if request.method == 'POST' and turno:
        if turno.estado != 'En curso':
            messages.error(request, 'Solo se puede finalizar un turno en curso o una asignación fija vigente.')
        else:
            turno.fin = timezone.now()
            turno.save(update_fields=['fin'])
            messages.success(request, f'Turno de {turno.conductor.nombre} finalizado.')
    return redirect(_volver_a_turnos(request))


@admin_empresa_required
def eliminarTurno(request, id_turno):
    """Borra un turno que aún no empieza. Los que ya empezaron quedan como historial."""
    turno = _buscar(Turno, id_turno=id_turno, bus__empresa=request.empresa)
    if request.method == 'POST' and turno:
        if turno.estado != 'Programado':
            messages.error(request, 'Solo se pueden eliminar turnos que aún no empiezan; finaliza el turno en su lugar.')
        else:
            turno.delete()
            messages.success(request, 'Turno eliminado.')
    return redirect(_volver_a_turnos(request))


def _volver_a_turnos(request):
    """Página de turnos a la que se regresa (solo rutas internas de /turnos/)."""
    volver = request.POST.get('volver') or ''
    return volver if volver.startswith('/turnos/') else '/turnos/'


# ================= LOGIN DE ADMINISTRADORES DE EMPRESA =================

def login_empresa(request):
    """La dirección antigua del ingreso de empresas: lleva al inicio de sesión único con "Empresa" elegido.
    Sigue existiendo porque es LOGIN_URL (a ella redirigen las páginas de empresa) y puede estar guardada."""
    parametros = {'tipo': 'empresa'}
    if request.GET.get('next'):
        parametros['next'] = request.GET['next']
    return redirect('/login/?' + urlencode(parametros))


# Logo de la empresa: formatos que se aceptan, peso máximo y tamaño al que se reduce
FORMATOS_LOGO = {'PNG': 'PNG', 'JPEG': 'JPG', 'WEBP': 'WEBP'}
LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_LADO_MAX = 512


def _procesar_logo(archivo):
    """Comprueba que el archivo sea de verdad una imagen PNG, JPG o WEBP y la devuelve lista para guardar:
    reducida a LOGO_LADO_MAX px y vuelta a codificar como PNG (así no viaja nada más que la imagen, ni datos ocultos
    ni metadatos). Devuelve (ContentFile, None) o (None, mensaje de error para la persona)."""
    from io import BytesIO
    from django.core.files.base import ContentFile
    from PIL import Image, ImageOps, UnidentifiedImageError

    if archivo is None:
        return None, 'Elige una imagen para el logo.'
    if archivo.size > LOGO_MAX_BYTES:
        return None, 'La imagen pesa más de 2 MB. Elige una más liviana o redúcela.'
    try:
        imagen = Image.open(archivo)
        imagen.verify()                     # detecta archivos dañados o que no son imágenes
        archivo.seek(0)
        imagen = Image.open(archivo)
        formato = imagen.format
        if formato not in FORMATOS_LOGO:
            return None, 'El logo debe ser una imagen PNG, JPG o WEBP.'
        if imagen.width * imagen.height > 40_000_000:
            return None, 'La imagen es demasiado grande. Usa una de menos de 6000 × 6000 píxeles.'
        imagen = ImageOps.exif_transpose(imagen)   # respeta la orientación de las fotos del celular
        imagen = imagen.convert('RGBA')
        imagen.thumbnail((LOGO_LADO_MAX, LOGO_LADO_MAX))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None, 'No pudimos leer esa imagen. Prueba con otro archivo PNG, JPG o WEBP.'
    salida = BytesIO()
    imagen.save(salida, format='PNG', optimize=True)
    return ContentFile(salida.getvalue()), None


def _volver(request, por_defecto='/turnos/'):
    """A la página donde estaba la persona (el modal "Mi empresa" se abre en cualquiera), solo si es de este sitio."""
    origen = request.META.get('HTTP_REFERER', '')
    return redirect(_destino_seguro(request, origen, por_defecto))


@admin_empresa_required
@require_POST
def empresa_logo(request):
    """Sube, cambia o quita el logo de la empresa. Vuelve a la página donde estaba, con un mensaje."""
    empresa = request.empresa
    anterior = empresa.logo.name if empresa.logo else ''

    if request.POST.get('accion') == 'quitar':
        if anterior:
            empresa.logo = ''
            empresa.save(update_fields=['logo'])
            empresa.logo.storage.delete(anterior)
            messages.success(request, 'Quitaste el logo. Ahora se muestran las iniciales de la empresa.')
        return _volver(request)

    contenido, error = _procesar_logo(request.FILES.get('logo'))
    if error:
        messages.error(request, error)
        return _volver(request)

    # Nombre nuevo en cada cambio: el navegador no se queda con el logo anterior guardado
    empresa.logo.save(f'empresa_{empresa.id_empresa}_{uuid.uuid4().hex[:10]}.png', contenido, save=False)
    empresa.save(update_fields=['logo'])
    if anterior and anterior != empresa.logo.name:
        empresa.logo.storage.delete(anterior)
    messages.success(request, 'Logo guardado. Ya aparece en el menú.')
    return _volver(request)


@admin_empresa_required
@require_POST
def empresa_password(request):
    """Cambia la contraseña de la cuenta que administra la empresa. Pide la actual y sigue la misma regla que
    el perfil de usuario; la sesión se mantiene abierta (y las demás sesiones de la cuenta se cierran)."""
    from django.contrib.auth import update_session_auth_hash

    cuenta = request.user
    actual = request.POST.get('contrasena_actual', '')
    nueva = request.POST.get('contrasena_nueva', '')
    confirmar = request.POST.get('contrasena_confirmar', '')
    nombre = cuenta.get_full_name() or cuenta.get_username()

    # Los intentos con la contraseña actual equivocada cuentan para el bloqueo, como en el inicio de sesión
    if seguridad.login_bloqueado(request, cuenta.get_username(), 'django'):
        messages.error(request, seguridad.login_bloqueado(request, cuenta.get_username(), 'django'))
    elif not cuenta.check_password(actual):
        seguridad.login_fallido(request, cuenta.get_username(), 'django')
        messages.error(request, 'La contraseña actual es incorrecta.')
    elif nueva != confirmar:
        messages.error(request, 'Las contraseñas nuevas no coinciden.')
    elif error := seguridad.error_contrasena(nueva, nombre, cuenta.email, cuenta.get_username()):
        messages.error(request, error)
    else:
        cuenta.set_password(nueva)
        cuenta.save(update_fields=['password'])
        update_session_auth_hash(request, cuenta)   # esta sesión sigue abierta; las otras se cierran
        messages.success(request, 'Contraseña actualizada correctamente.')
    return _volver(request)


def logout_empresa(request):
    auth_logout(request)
    messages.success(request, 'Sesión de empresa cerrada.')
    return redirect('/')

# ================= VERIFICAR PLACA DE BUS (AJAX) =================

@admin_empresa_required
def verificar_placa_bus(request):
    """Verifica si una placa ya está registrada (excluyendo el bus actual si está editando)"""
    if request.method == 'POST':
        placa = request.POST.get('placa', '').strip().upper()
        bus_id = request.POST.get('bus_id', '').strip()
        
        if not placa:
            return JsonResponse({'existe': False})
        
        query = Bus.objects.filter(placa__iexact=placa)
        
        if bus_id:
            try:
                query = query.exclude(id_bus=int(bus_id))
            except (ValueError, TypeError):
                pass
        
        existe = query.exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})

def acerca_de(request):
    """Qué es LocalBus, para quién es y cifras reales de la red en este momento."""
    from .models import Empresa
    hace_poco = timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL)
    cifras = {
        'empresas': Empresa.objects.filter(activa=True, rutas__habilitado=True).distinct().count(),
        'rutas': _rutas_publicas().count(),
        'buses': Bus.objects.filter(habilitado=True, empresa__activa=True).count(),
        'en_vivo': (UbicacionBus.objects.filter(timestamp__gte=hace_poco, bus__habilitado=True,
                                                bus__empresa__activa=True)
                    .values('bus').distinct().count()),
    }
    return render(request, 'core/acerca_de.html', {
        'cifras': cifras,
        'contacto_email': settings.CONTACTO_LEGAL_EMAIL,
    })


# ================= DOCUMENTOS LEGALES =================

# Fecha de la última versión de los términos y la política (cámbiala cuando se modifiquen)
FECHA_DOCUMENTOS_LEGALES = '7 de noviembre de 2026'


def _documento_legal(request, plantilla, documento):
    return render(request, plantilla, {
        'documento': documento,
        'fecha_actualizacion': FECHA_DOCUMENTOS_LEGALES,
        'contacto_email': settings.CONTACTO_LEGAL_EMAIL,
    })


def terminos(request):
    return _documento_legal(request, 'core/terminos.html', 'terminos')


def privacidad(request):
    return _documento_legal(request, 'core/privacidad.html', 'privacidad')


# =========================================================
# ================= API PARA APP MÓVIL =================
# =========================================================

def _turno_en_pausa(turno):
    """Respuesta 409 para la app del conductor si la ruta de su turno está fuera de servicio, o None.
    El turno no se borra: vuelve a servir solo cuando la empresa reactiva la ruta."""
    if not turno.ruta.fuera_de_servicio:
        return None
    mensaje = (f'La ruta {turno.ruta.codigo} está fuera de servicio: tu turno queda en pausa '
               f'hasta que tu empresa la reactive.')
    if turno.ruta.motivo_fuera_servicio:
        mensaje += f' Motivo: {turno.ruta.motivo_fuera_servicio}'
    return JsonResponse({'error': mensaje, 'en_pausa': True}, status=409)


@csrf_exempt
def login_conductor(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        cedula = str(data.get('cedula') or '').strip()
        contrasena = str(data.get('contrasena') or data.get('password') or '')

        if not cedula or not contrasena:
            return JsonResponse({'error': 'Cédula y contraseña requeridas'}, status=400)

        bloqueo = seguridad.login_bloqueado(request, cedula, 'conductor')
        if bloqueo:
            return JsonResponse({'error': bloqueo}, status=429)

        # Mismo mensaje si la cédula no existe o la contraseña no coincide (HU-06),
        # para no revelar qué cédulas están registradas
        conductor = Conductor.objects.select_related('empresa').filter(cedula=cedula).first()
        if conductor is None:
            make_password(contrasena)  # mismo tiempo de respuesta que una contraseña incorrecta
        if conductor is None or not conductor.verificar_contrasena(contrasena):
            seguridad.login_fallido(request, cedula, 'conductor')
            return JsonResponse({'error': 'Cédula o contraseña incorrecta'}, status=401)
        seguridad.login_exitoso(cedula, 'conductor')
        if not conductor.habilitado:
            return JsonResponse({'error': 'Tu cuenta de conductor está inhabilitada. Habla con tu empresa.'}, status=403)

        turno = conductor.turno_actual()
        if turno is None:
            # La próxima jornada puede ser de un turno programado o de un fijo que hoy aún no empieza
            proximos = [(t.proximo_inicio(), t) for t in
                        Turno.pendientes().filter(conductor=conductor).select_related('bus')]
            proximos = [p for p in proximos if p[0]]
            mensaje = 'No tienes un turno asignado en este momento.'
            if proximos:
                empieza, proximo = min(proximos, key=lambda p: p[0])
                mensaje += f' Tu próximo turno: {fecha_hora12(empieza)} en el bus {proximo.bus.placa}.'
            return JsonResponse({'error': mensaje}, status=409)
        pausa = _turno_en_pausa(turno)
        if pausa:
            return pausa

        bus = turno.bus
        return JsonResponse({
            'status': 'ok',
            # La app debe enviarlo en "Authorization: Bearer <token>" en las demás peticiones
            'token': token_conductor(conductor),
            'token_vence_en_horas': settings.CONDUCTOR_TOKEN_HORAS,
            'conductor': {
                'id': conductor.id_conductor,
                'nombre': conductor.nombre,
                'cedula': conductor.cedula,
                'empresa': conductor.empresa.nombre,
                'ruta': turno.ruta.nombre,
                'ruta_id': turno.ruta.id_ruta
            },
            'bus': {
                'id': bus.id_bus,
                'placa': bus.placa,
                'activo': bus.activo
            },
            'turno': {
                'id': turno.id_turno,
                'inicio': turno.inicio.isoformat(),
                # Fin de la jornada en curso (en un fijo, la de hoy)
                'fin': turno.fin_actual.isoformat() if turno.fin_actual else None,
                'fijo': turno.fijo,
            }
        })
    except Exception as e:
        return _respuesta_error(e)


@csrf_exempt
def activar_bus(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        conductor, error = conductor_de_la_peticion(request, data.get('conductor_id'))
        if error:
            return error

        turno = conductor.turno_actual()
        if turno is None:
            return JsonResponse({'error': 'No tienes un turno asignado en este momento'}, status=404)
        pausa = _turno_en_pausa(turno)
        if pausa:
            return pausa
        bus = turno.bus

        bus.activo = True
        bus.save()

        return JsonResponse({
            'status': 'ok',
            'message': f'Bus {bus.placa} activado correctamente',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'activo': True
        })
    except Exception as e:
        return _respuesta_error(e)


@csrf_exempt
def desactivar_bus(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        conductor, error = conductor_de_la_peticion(request, data.get('conductor_id'))
        if error:
            return error

        # Si el turno ya terminó, igual se puede apagar el bus del último turno
        turno = conductor.turno_actual() or (conductor.turnos.filter(inicio__lte=timezone.now())
                                             .select_related('bus').order_by('-inicio').first())
        if turno is None:
            return JsonResponse({'error': 'No tienes un turno asignado'}, status=404)
        bus = turno.bus

        bus.activo = False
        bus.save()

        return JsonResponse({
            'status': 'ok',
            'message': f'Bus {bus.placa} desactivado correctamente',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'activo': False
        })
    except Exception as e:
        return _respuesta_error(e)


@csrf_exempt
def enviar_ubicacion(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        latitud = data.get('latitud')
        longitud = data.get('longitud')
        velocidad = data.get('velocidad', 0)

        # Se compara con None: una latitud o longitud de 0 es válida
        if latitud in (None, '') or longitud in (None, ''):
            return JsonResponse({'error': 'Faltan datos obligatorios'}, status=400)

        latitud = _numero_valido(latitud, 'latitud', -90, 90)
        longitud = _numero_valido(longitud, 'longitud', -180, 180)
        velocidad = _numero_valido(velocidad or 0, 'velocidad', 0, 300)

        conductor, error = conductor_de_la_peticion(request, data.get('conductor_id'))
        if error:
            return error

        turno = conductor.turno_actual()
        if turno is None:
            return JsonResponse({'error': 'Tu turno terminó o no tienes un turno asignado en este momento'}, status=409)
        pausa = _turno_en_pausa(turno)
        if pausa:
            return pausa
        bus = turno.bus

        if not bus.activo:
            return JsonResponse({
                'status': 'inactivo',
                'message': 'El bus no está activo'
            })

        # La ubicación queda ligada al bus, a la ruta del turno y a quien manejaba
        ubicacion = UbicacionBus.objects.create(
            bus=bus,
            ruta=turno.ruta,
            conductor=conductor,
            latitud=latitud,
            longitud=longitud,
            velocidad=velocidad
        )

        bus.ultima_ubicacion = timezone.now()
        bus.save(update_fields=['ultima_ubicacion'])

        return JsonResponse({
            'status': 'ok',
            'message': 'Ubicación guardada',
            'ubicacion_id': ubicacion.id,
            'timestamp': timezone.now().isoformat()
        })
    except Exception as e:
        return _respuesta_error(e)


def verificar_estado_ubicacion(request, conductor_id):
    try:
        conductor, error = conductor_de_la_peticion(request, conductor_id)
        if error:
            return error
        turno = conductor.turno_actual()
        if turno is None:
            return JsonResponse({'error': 'No tienes un turno asignado en este momento'}, status=404)
        pausa = _turno_en_pausa(turno)
        if pausa:
            return pausa
        bus = turno.bus

        return JsonResponse({
            'conductor_id': conductor.id_conductor,
            'conductor_nombre': conductor.nombre,
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'ruta': turno.ruta.nombre,
            'turno_fin': turno.fin_actual.isoformat() if turno.fin_actual else None,
            'activo': bus.activo,
            'ultima_ubicacion': bus.ultima_ubicacion.isoformat() if bus.ultima_ubicacion else None
        })
    except Exception as e:
        return _respuesta_error(e)


def obtener_ubicaciones(request):
    # Último punto de cada bus en una sola consulta (DISTINCT ON de PostgreSQL).
    # Solo puntos recientes: un bus que perdió la señal sin apagarse no se queda en el mapa.
    hace_poco = timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL)
    ultimas = (UbicacionBus.objects.filter(bus__in=_buses_publicos(), timestamp__gte=hace_poco)
               .select_related('bus__empresa', 'ruta__empresa', 'conductor')
               .order_by('bus_id', '-timestamp').distinct('bus_id'))
    # Solo se muestran buses con un turno en curso, y en la ruta de ese turno: un bus
    # (simulado o con GPS) sin turno, o con un punto de un turno anterior, no aparece
    turnos = {t.bus_id: t for t in Turno.vigentes().filter(bus__in=_buses_publicos()).select_related('conductor')}
    ubicaciones = []

    for ultima_ubicacion in ultimas:
        bus = ultima_ubicacion.bus
        turno = turnos.get(bus.id_bus)
        if turno is None or ultima_ubicacion.ruta_id != turno.ruta_id:
            continue
        # La ruta se revisa en el último punto (no antes del DISTINCT): si la ruta que recorre
        # ahora está inhabilitada, el bus no aparece en vez de mostrarse en un punto viejo
        if not _ruta_publica(ultima_ubicacion.ruta):
            continue
        # La ruta y el conductor salen del último punto registrado: es lo que el bus está haciendo
        ubicaciones.append({
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'empresa': bus.empresa.nombre,
            'ruta': ultima_ubicacion.ruta.nombre,
            'ruta_id': ultima_ubicacion.ruta_id,
            # Los puntos simulados no traen conductor: se muestra el del turno
            'conductor': (ultima_ubicacion.conductor.nombre if ultima_ubicacion.conductor
                          else turno.conductor.nombre),
            'latitud': float(ultima_ubicacion.latitud),
            'longitud': float(ultima_ubicacion.longitud),
            'velocidad': float(ultima_ubicacion.velocidad),
            'timestamp': ultima_ubicacion.timestamp.isoformat()
        })

    return JsonResponse({
        'count': len(ubicaciones),
        'buses': ubicaciones,
        'timestamp': timezone.now().isoformat()
    })


# ================= RECUPERACIÓN DE CONTRASEÑA =================

def solicitar_recuperacion(request):
    if request.method == 'POST':
        email = request.POST.get('email', '').strip().lower()
        if not email:
            messages.error(request, 'Escribe tu correo.')
            return render(request, 'core/recuperacion.html')
        if seguridad.envio_bloqueado(request, email):
            messages.error(request, 'Ya enviamos varios códigos. Espera unos minutos antes de volver a intentarlo.')
            return render(request, 'core/recuperacion.html')
        seguridad.envio_registrado(request, email)

        # La respuesta es la misma exista o no el correo: no se revela quién está registrado
        request.session['email_recuperacion'] = email
        request.session.pop('codigo_validado', None)
        messages.success(request, 'Si el correo está registrado, te enviamos un código de 6 dígitos.')

        usuario = Usuario.objects.filter(email__iexact=email).first()
        if usuario is None:
            return redirect('/verificar_codigo/')

        codigo = seguridad.generar_codigo()
        usuario.codigo_recuperacion = codigo
        usuario.codigo_expiracion = timezone.now() + timedelta(minutes=15)
        usuario.save(update_fields=['codigo_recuperacion', 'codigo_expiracion'])
        seguridad.limpiar('codigo:recuperacion', email)  # código nuevo, intentos desde cero

        try:
            enviar_correo_html(
                asunto='Recuperación de Contraseña - LocalBus',
                template='core/emails/codigo_verificacion.html',
                contexto={
                    'nombre': usuario.nombre,
                    'codigo': codigo,
                    'mensaje': 'Recibimos una solicitud para restablecer tu contraseña. Ingresa el siguiente código:',
                },
                destinatario=usuario.email,
            )
        except Exception:
            # No se avisa en pantalla: sería distinto a cuando el correo no existe
            logger.exception('No se pudo enviar el correo de recuperación de contraseña')

        return redirect('/verificar_codigo/')

    return render(request, 'core/recuperacion.html')


def verificar_codigo(request):
    email = request.session.get('email_recuperacion')
    if not email:
        return redirect('/solicitar_recuperacion/')

    if request.method == 'POST':
        codigo_ingresado = request.POST.get('codigo', '').strip()
        usuario = Usuario.objects.filter(email__iexact=email).first()
        vigente = (usuario is not None and usuario.codigo_expiracion is not None
                   and usuario.codigo_expiracion > timezone.now())
        if vigente and seguridad.codigos_iguales(codigo_ingresado, usuario.codigo_recuperacion):
            seguridad.limpiar('codigo:recuperacion', email)
            request.session['codigo_validado'] = True
            return redirect('/nueva_contrasena/')

        # Mismo mensaje exista o no la cuenta. Tras 5 fallos el código se anula en la base
        fallos = seguridad.contar('codigo:recuperacion', email, 15 * 60)
        if fallos >= seguridad.CODIGO_FALLOS:
            if usuario is not None:
                Usuario.objects.filter(pk=usuario.pk).update(codigo_recuperacion=None, codigo_expiracion=None)
            seguridad.limpiar('codigo:recuperacion', email)
            request.session.pop('email_recuperacion', None)
            messages.error(request, 'Demasiados intentos con un código incorrecto. Solicita un código nuevo.')
            return redirect('/solicitar_recuperacion/')
        restantes = seguridad.CODIGO_FALLOS - fallos
        messages.error(request, f'Código incorrecto o expirado. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.')

    return render(request, 'core/verificar_codigo.html')


def nueva_contrasena(request):
    if not request.session.get('codigo_validado'):
        return redirect('/solicitar_recuperacion/')

    if request.method == 'POST':
        pass1 = request.POST.get('password1')
        pass2 = request.POST.get('password2')

        email = request.session.get('email_recuperacion')
        usuario = Usuario.objects.filter(email__iexact=email).first() if email else None
        error = (seguridad.error_contrasena(pass1, usuario.nombre, usuario.email, usuario.nickName)
                 if usuario and pass1 and pass1 == pass2 else None)

        if not pass1 or pass1 != pass2:
            messages.error(request, 'Las contraseñas no coinciden.')
        elif error:
            messages.error(request, error)
        else:
            # La recuperación termina aquí, salga bien o no: el código validado no se reutiliza
            request.session.pop('email_recuperacion', None)
            request.session.pop('codigo_validado', None)

            if usuario is None:
                # La cuenta se borró o cambió de correo mientras se recuperaba la contraseña
                messages.error(request, 'La cuenta ya no existe. Vuelve a solicitar la recuperación.')
                return redirect('/solicitar_recuperacion/')

            usuario.set_contrasena(pass1)
            usuario.codigo_recuperacion = None
            usuario.codigo_expiracion = None
            usuario.save()

            messages.success(request, 'Contraseña actualizada. Ya puedes iniciar sesión.')
            return redirect('/login/')

    return render(request, 'core/nueva_contrasena.html')


def perfil(request):
    usuario_id = request.session.get('usuario_id')
    if not usuario_id:
        return redirect('/login/')

    try:
        usuario = Usuario.objects.get(id_usuario=usuario_id)
    except Usuario.DoesNotExist:
        request.session.flush()
        return redirect('/login/')

    if request.method == 'POST':
        accion = request.POST.get('accion', 'editar')

        if accion == 'cambiar_password':
            contrasena_actual = request.POST.get('contrasena_actual', '')
            contrasena_nueva = request.POST.get('contrasena_nueva', '')
            contrasena_confirmar = request.POST.get('contrasena_confirmar', '')

            if not usuario.verificar_contrasena(contrasena_actual):
                messages.error(request, 'La contraseña actual es incorrecta.')
            elif contrasena_nueva != contrasena_confirmar:
                messages.error(request, 'Las contraseñas nuevas no coinciden.')
            elif error := seguridad.error_contrasena(contrasena_nueva, usuario.nombre, usuario.email, usuario.nickName):
                messages.error(request, error)
            else:
                usuario.set_contrasena(contrasena_nueva)
                usuario.save()
                messages.success(request, 'Contraseña actualizada correctamente.')

            return redirect('/')

        nombre = request.POST.get('nombre', '').strip()
        email = request.POST.get('email', '').strip().lower()
        nickName = request.POST.get('nickName', '').strip()
        telefono = request.POST.get('telefono', '').strip()
        color_perfil = request.POST.get('color_perfil', '').strip()

        if not nombre or not email or not nickName:
            messages.error(request, 'Nombre, correo y nombre de usuario son obligatorios.')
            return redirect('/')

        error = _texto_muy_largo(Usuario, nombre=nombre, email=email, nickName=nickName)
        if error:
            messages.error(request, error)
            return redirect('/')

        # El color se inserta en el atributo style de la página: solo se acepta #RRGGBB
        if color_perfil and not re.fullmatch(r'#[0-9A-Fa-f]{6}', color_perfil):
            messages.error(request, 'El color de perfil no es válido.')
            return redirect('/')

        if Usuario.objects.filter(email__iexact=email).exclude(id_usuario=usuario.id_usuario).exists():
            messages.error(request, 'Ese correo ya está en uso por otro usuario.')
            return redirect('/')

        if Usuario.objects.filter(nickName__iexact=nickName).exclude(id_usuario=usuario.id_usuario).exists():
            messages.error(request, 'Ese nombre de usuario ya está en uso.')
            return redirect('/')

        if telefono:
            if not telefono.isdigit():
                messages.error(request, 'El teléfono solo debe contener números.')
                return redirect('/')
            if len(telefono) < 7 or len(telefono) > 15:
                messages.error(request, 'El teléfono debe tener entre 7 y 15 dígitos.')
                return redirect('/')
            if Usuario.objects.filter(telefono=telefono).exclude(id_usuario=usuario.id_usuario).exists():
                messages.error(request, 'Ese teléfono ya está registrado.')
                return redirect('/')

        # El correo nuevo no se guarda todavía: primero hay que confirmar que es de quien lo escribe.
        # Si no, alguien con la sesión abierta podría poner su correo y recuperar la contraseña.
        cambia_correo = email != usuario.email

        usuario.nombre = nombre
        usuario.nickName = nickName
        usuario.telefono = telefono if telefono else None

        if color_perfil:
            usuario.color_perfil = color_perfil

        try:
            usuario.save()
        except IntegrityError:
            # Otro usuario tomó el correo, nickname o teléfono justo ahora
            messages.error(request, 'Ese correo, nombre de usuario o teléfono ya está en uso.')
            return redirect('/')

        request.session['usuario_nombre'] = usuario.nombre

        if cambia_correo:
            return _enviar_codigo_cambio_correo(request, usuario, email)

        messages.success(request, 'Perfil actualizado correctamente.')
        return redirect('/')

    return redirect('/')


@require_POST
def eliminar_cuenta(request):
    """Borra la cuenta del pasajero con sesión abierta. Pide de nuevo su correo o nombre de usuario
    y su contraseña: así nadie la borra con una sesión que quedó abierta en otro dispositivo."""
    usuario = Usuario.objects.filter(id_usuario=request.session.get('usuario_id')).first()
    if usuario is None:
        return JsonResponse({'ok': False, 'error': 'Tu sesión terminó. Inicia sesión de nuevo.'}, status=401)

    identificador = request.POST.get('identificador', '').strip()
    contrasena = request.POST.get('contrasena', '')
    if not identificador or not contrasena:
        return JsonResponse({'ok': False, 'error': 'Escribe tu correo o nombre de usuario y tu contraseña.'}, status=400)

    # Mismo límite de intentos que el inicio de sesión, contado por cuenta y por IP
    clave = str(usuario.id_usuario)
    bloqueo = seguridad.login_bloqueado(request, clave, tipo='eliminar_cuenta')
    if bloqueo:
        return JsonResponse({'ok': False, 'error': bloqueo}, status=429)

    es_suya = identificador.lower() in (usuario.email.lower(), usuario.nickName.lower())
    if not usuario.verificar_contrasena(contrasena) or not es_suya:
        seguridad.login_fallido(request, clave, tipo='eliminar_cuenta')
        return JsonResponse({'ok': False, 'error': 'Los datos no corresponden a esta cuenta. Revísalos e inténtalo de nuevo.'},
                            status=400)

    seguridad.login_exitoso(clave, tipo='eliminar_cuenta')
    nombre = usuario.nombre
    usuario.delete()  # también borra sus alertas (una alerta siempre necesita autor)
    request.session.flush()
    messages.success(request, f'Eliminamos tu cuenta, {nombre}. Gracias por usar LocalBus.')
    return JsonResponse({'ok': True, 'redirigir': '/'})


def _cuenta_de_ajustes(request):
    """Quien guarda los ajustes de la página: el pasajero con sesión o el administrador de empresa. None si no hay
    ninguna de las dos. Las dos cuentas tienen los mismos campos (`tema` y `desplazamiento_mapa`)."""
    administrador = getattr(request.user, 'administrador', None) if request.user.is_authenticated else None
    if administrador is not None and empresa_del_usuario(request):
        return administrador
    return Usuario.objects.filter(id_usuario=request.session.get('usuario_id')).first()


@require_POST
def preferencia_desplazamiento(request):
    """Guarda cómo quiere mover el mapa en el celular: con dos dedos o con la barra lateral."""
    cuenta = _cuenta_de_ajustes(request)
    if cuenta is None:
        return JsonResponse({'ok': False, 'error': 'Inicia sesión para guardar tus ajustes.'}, status=401)
    modo = request.POST.get('modo', '')
    if modo not in dict(DESPLAZAMIENTOS_MAPA):
        return JsonResponse({'ok': False, 'error': 'Esa opción no existe.'}, status=400)
    cuenta.desplazamiento_mapa = modo
    cuenta.save(update_fields=['desplazamiento_mapa'])
    return JsonResponse({'ok': True, 'modo': modo})


@require_POST
def preferencia_tema(request):
    """Guarda el tema de la página en la cuenta: igual que el dispositivo, claro u oscuro."""
    cuenta = _cuenta_de_ajustes(request)
    if cuenta is None:
        return JsonResponse({'ok': False, 'error': 'Inicia sesión para guardar tus ajustes.'}, status=401)
    tema = request.POST.get('tema', '')
    if tema not in dict(TEMAS_PAGINA):
        return JsonResponse({'ok': False, 'error': 'Esa opción no existe.'}, status=400)
    cuenta.tema = tema
    cuenta.save(update_fields=['tema'])
    return JsonResponse({'ok': True, 'tema': tema})


def _enviar_codigo_cambio_correo(request, usuario, email_nuevo):
    if seguridad.envio_bloqueado(request, email_nuevo):
        messages.error(request, 'Ya enviamos varios códigos. Espera unos minutos para cambiar el correo.')
        return redirect('/')
    seguridad.envio_registrado(request, email_nuevo)
    codigo = seguridad.generar_codigo()
    try:
        enviar_correo_html(
            asunto='Confirma tu nuevo correo - LocalBus',
            template='core/emails/codigo_verificacion.html',
            contexto={
                'nombre': usuario.nombre,
                'codigo': codigo,
                'mensaje': 'Pediste usar este correo en tu cuenta de LocalBus. Para confirmarlo, ingresa el siguiente código:',
            },
            destinatario=email_nuevo,
        )
    except Exception:
        logger.exception('No se pudo enviar el código para cambiar el correo')
        messages.error(request, 'Los demás datos se guardaron, pero no pudimos enviar el código al correo nuevo. '
                                'Revisa que esté bien escrito.')
        return redirect('/')

    request.session['cambio_correo'] = {
        'usuario_id': usuario.id_usuario,
        'email': email_nuevo,
        'codigo': codigo,
        'intentos': 0,
        'expira': (timezone.now() + timedelta(minutes=15)).isoformat(),
    }
    messages.success(request, 'Datos guardados. Para cambiar el correo, ingresa el código que enviamos a la dirección nueva.')
    return redirect('/verificar_cambio_correo/')


def verificar_cambio_correo(request):
    pendiente = request.session.get('cambio_correo')
    if not pendiente or pendiente.get('usuario_id') != request.session.get('usuario_id'):
        request.session.pop('cambio_correo', None)
        return redirect('/')

    try:
        vencido = timezone.now() > datetime.fromisoformat(pendiente['expira'])
    except (KeyError, TypeError, ValueError):
        vencido = True
    if vencido:
        request.session.pop('cambio_correo', None)
        messages.error(request, 'El código expiró. Vuelve a cambiar el correo desde tu perfil.')
        return redirect('/')

    if request.method == 'POST':
        if not seguridad.codigos_iguales(request.POST.get('codigo', '').strip(), pendiente['codigo']):
            pendiente['intentos'] = pendiente.get('intentos', 0) + 1
            if pendiente['intentos'] >= seguridad.CODIGO_FALLOS:
                request.session.pop('cambio_correo', None)
                messages.error(request, 'Demasiados intentos con un código incorrecto. El correo no se cambió.')
                return redirect('/')
            request.session['cambio_correo'] = pendiente
            restantes = seguridad.CODIGO_FALLOS - pendiente['intentos']
            return render(request, 'core/verificar_cambio_correo.html', {
                'email': pendiente['email'],
                'error': f'Código incorrecto. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.',
            })

        request.session.pop('cambio_correo', None)
        usuario = Usuario.objects.filter(id_usuario=pendiente['usuario_id']).first()
        if usuario is None:
            return redirect('/login/')
        anterior = usuario.email
        usuario.email = pendiente['email']
        try:
            usuario.save(update_fields=['email'])
        except IntegrityError:
            messages.error(request, 'Ese correo ya está en uso por otro usuario.')
            return redirect('/')
        try:
            # Aviso al correo anterior, por si el cambio no lo hizo el dueño de la cuenta
            enviar_correo_html(
                asunto='Tu correo de LocalBus cambió',
                template='core/emails/codigo_verificacion.html',
                contexto={'nombre': usuario.nombre, 'codigo': '',
                          'mensaje': f'El correo de tu cuenta de LocalBus cambió a {usuario.email}. '
                                     f'Si no fuiste tú, comunícate con nosotros.'},
                destinatario=anterior,
            )
        except Exception:
            logger.exception('No se pudo avisar al correo anterior del cambio de correo')
        messages.success(request, f'Correo actualizado a {usuario.email}.')
        return redirect('/')

    return render(request, 'core/verificar_cambio_correo.html', {'email': pendiente['email']})
# ================= VERIFICAR EMAIL AL EDITAR PERFIL (AJAX) =================

def verificar_email_perfil(request):
    """Verifica si un email ya existe (excluyendo al usuario actual)"""
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        email = request.POST.get('email', '').strip().lower()
        usuario_id = request.session.get('usuario_id')
        
        if not email:
            return JsonResponse({'existe': False})
        
        if not usuario_id:
            return JsonResponse({'existe': False, 'error': 'No autenticado'})
        
        # Buscar si existe OTRO usuario con ese email
        existe = Usuario.objects.filter(
            email__iexact=email
        ).exclude(
            id_usuario=usuario_id
        ).exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


# ================= VERIFICAR NICKNAME AL EDITAR PERFIL (AJAX) =================

def verificar_nickname_perfil(request):
    """Verifica si un nickname ya existe (excluyendo al usuario actual)"""
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        nickname = request.POST.get('nickname', '').strip()
        usuario_id = request.session.get('usuario_id')
        
        if not nickname:
            return JsonResponse({'existe': False, 'sugerencias': []})
        
        if not usuario_id:
            return JsonResponse({'existe': False, 'sugerencias': [], 'error': 'No autenticado'})
        
        # Buscar si existe OTRO usuario con ese nickname
        existe = Usuario.objects.filter(
            nickName__iexact=nickname
        ).exclude(
            id_usuario=usuario_id
        ).exists()
        
        sugerencias = []
        if existe:
            sugerencias = generar_sugerencias_nickname(nickname)
        
        return JsonResponse({
            'existe': existe,
            'sugerencias': sugerencias
        })
    
    return JsonResponse({'existe': False, 'sugerencias': []})
# ================= VERIFICAR TELÉFONO AL EDITAR PERFIL (AJAX) =================

def verificar_telefono_perfil(request):
    """Verifica si un teléfono ya existe (excluyendo al usuario actual)"""
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        telefono = request.POST.get('telefono', '').strip()
        usuario_id = request.session.get('usuario_id')
        
        if not telefono or not usuario_id:
            return JsonResponse({'existe': False})
        
        # Buscar si existe OTRO usuario con ese teléfono
        existe = Usuario.objects.filter(
            telefono=telefono
        ).exclude(
            id_usuario=usuario_id
        ).exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})
# ================= VERIFICAR TELÉFONO (AJAX) =================

def verificar_telefono(request):
    """Verifica si un teléfono ya está registrado"""
    # Con token CSRF y límite por IP: no sirve para comprobar datos de forma masiva
    if request.method == 'POST':
        if not seguridad.consulta_permitida(request):
            return JsonResponse({'error': 'Demasiadas consultas. Espera unos minutos.'}, status=429)
        telefono = request.POST.get('telefono', '').strip()
        
        if not telefono:
            return JsonResponse({'existe': False})
        
        existe = Usuario.objects.filter(telefono=telefono).exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


def api_rutas(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    rutas = Ruta.marcar_operacion(Ruta.objects.filter(habilitado=True).order_by('codigo'),
                                  minutos_sin_senal=MINUTOS_SIN_SENAL)
    data = []

    for ruta in rutas:
        data.append({
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'distancia_km': ruta.distancia_km,
            'duracion_estimada_minutos': ruta.duracion_estimada_minutos,
            'num_paradas': ruta.num_paradas,
            # Activa, Sin_buses, Fuera_horario o Fuera_servicio (ver Ruta.ESTADOS_VISIBLES)
            'estado': ruta.estado_visible,
            'estado_nombre': ruta.nombre_estado_visible,
            'motivo': ruta.motivo_visible,
            'coordenadas': ruta.get_coordenadas_ruta(),
            'paradas': ruta.get_paradas_coordenadas()
        })

    return JsonResponse({
        'count': len(data),
        'rutas': data
    })


def api_alertas(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    # ?desde=<id> devuelve solo las alertas más nuevas que ese id (lo usan las notificaciones de la web)
    # ?limite=<n> limita la cantidad (máximo 50)
    try:
        desde = _id_valido(request.GET['desde'], 'desde') if request.GET.get('desde') not in (None, '', '0') else None
        limite = min(_id_valido(request.GET.get('limite', 50), 'limite'), 50)
    except _PeticionInvalida as e:
        return _respuesta_error(e)

    # Solo alertas publicadas (las pendientes aún no las revisa la empresa; las canceladas están inhabilitadas)
    alertas = (Alerta.objects.filter(estado__in=ESTADOS_PUBLICOS)
               .select_related('ruta', 'usuario', 'empresa').order_by('-id_alerta'))
    if desde is not None:
        alertas = alertas.filter(id_alerta__gt=desde)
    alertas = alertas[:limite]
    data = []

    for alerta in alertas:
        data.append({
            'id': alerta.id_alerta,
            'tipo': alerta.tipo,
            'descripcion': alerta.descripcion,
            'estado': alerta.estado,
            'ruta': alerta.ruta.nombre,
            'ruta_id': alerta.ruta.id_ruta,
            'usuario': alerta.autor,
            'fecha': alerta.fecha_creacion.isoformat()
        })

    return JsonResponse({
        'count': len(data),
        'alertas': data
    })


# ================= REPORTES =================

# Estados que puede tener una ruta en el reporte (los de Ruta.ESTADOS_VISIBLES más "Inhabilitada")
ESTADOS_REPORTE_RUTA = {**Ruta.ESTADOS_VISIBLES, 'Inhabilitada': 'Inhabilitada'}
# Color de cada estado en las gráficas, el mismo de sus insignias en el sitio
COLORES_ESTADO_RUTA = {
    'Activa': ('#187A45', False),
    'Sin_buses': ('#F7C600', True),        # amarillo: con borde para verse sobre blanco
    'Fuera_horario': ('#5B646B', False),
    'Fuera_servicio': ('#D4121A', False),
    'Inhabilitada': ('#D3D8DB', True),
}


def _estado_reporte_ruta(ruta):
    return ruta.estado_visible if ruta.habilitado else 'Inhabilitada'


def _graficas_rutas(rutas):
    """Cifras y gráficas del reporte de rutas: totales, por estado y las medidas de cada ruta."""
    ancho = ANCHO_UTIL
    mitad = (ancho - 0.6 * cm) / 2
    distancias = [r.distancia_km for r in rutas if r.distancia_km]
    duraciones = [r.duracion_estimada_minutos for r in rutas if r.duracion_estimada_minutos]
    frecuencias = [r.frecuencia_minutos for r in rutas if r.frecuencia_minutos]
    piezas = [graficas_pdf.indicadores([
        (len(rutas), 'Rutas en total'),
        (f'{sum(distancias):.1f} km', 'De recorrido en total'),
        (f'{round(sum(duraciones) / len(duraciones))} min' if duraciones else '-', 'Duración promedio'),
        (f'{round(sum(frecuencias) / len(frecuencias))} min' if frecuencias else '-', 'Frecuencia promedio'),
    ], ancho), graficas_pdf.separador()]

    por_estado = Counter(_estado_reporte_ruta(r) for r in rutas)
    filas_estado = [(ESTADOS_REPORTE_RUTA[e], n, colors.HexColor(COLORES_ESTADO_RUTA[e][0]), COLORES_ESTADO_RUTA[e][1])
                    for e, n in por_estado.most_common()]

    def por_ruta(medida):
        filas = [(r.codigo, medida(r), color_ruta(r), False) for r in rutas if medida(r)]
        return sorted(filas, key=lambda f: (-f[1], f[0]))

    filas_distancia = por_ruta(lambda r: float(r.distancia_km or 0))
    filas_duracion = por_ruta(lambda r: r.duracion_estimada_minutos or 0)
    filas_frecuencia = por_ruta(lambda r: r.frecuencia_minutos or 0)

    if filas_estado and filas_distancia:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Por estado', filas_estado, mitad),
            graficas_pdf.barras_horizontales('Distancia de cada ruta (km)', filas_distancia, mitad,
                                             juntar_resto=False), ancho),
            graficas_pdf.separador()]
    if filas_duracion and filas_frecuencia:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Duración del recorrido (min)', filas_duracion, mitad,
                                             juntar_resto=False),
            graficas_pdf.barras_horizontales('Cada cuánto pasa un bus (min)', filas_frecuencia, mitad,
                                             juntar_resto=False), ancho)]
    elif filas_duracion:
        piezas.append(graficas_pdf.barras_horizontales('Duración del recorrido (min)', filas_duracion, mitad,
                                                       juntar_resto=False))
    return piezas


@admin_empresa_required
def reporte_rutas(request):
    """Rutas de la empresa con los filtros que llegan por la URL: estado y ruta (varios valores cada uno).
    Sin filtros, trae todas. `orden` (codigo, nombre, estado, distancia, duracion, frecuencia o paradas) y
    `sentido` (asc o desc) deciden cómo se ordena; por defecto, por código de menor a mayor."""
    rutas = list(Ruta.marcar_operacion(request.empresa.rutas.order_by('codigo'), minutos_sin_senal=MINUTOS_SIN_SENAL))
    filtros = []  # frases para decir en el PDF qué se filtró

    # Si se marcan todas las opciones de un grupo no hay nada que filtrar
    estados = [e for e in request.GET.getlist('estado') if e in ESTADOS_REPORTE_RUTA]
    if estados and len(set(estados)) < len(ESTADOS_REPORTE_RUTA):
        rutas = [r for r in rutas if _estado_reporte_ruta(r) in estados]
        filtros.append('estado: ' + ', '.join(n for e, n in ESTADOS_REPORTE_RUTA.items() if e in estados))

    ids_ruta = {int(r) for r in request.GET.getlist('ruta') if r.isdigit()}
    if ids_ruta:
        total = request.empresa.rutas.count()
        elegidas = [r for r in rutas if r.id_ruta in ids_ruta]
        if len(ids_ruta) < total:
            filtros.append('rutas: ' + ', '.join(r.codigo for r in elegidas) if elegidas else 'rutas: ninguna')
            rutas = elegidas

    # Orden: primero por código y luego, si se pidió, por otro criterio (el ordenamiento es estable)
    sentido = 'desc' if request.GET.get('sentido') == 'desc' else 'asc'
    orden = request.GET.get('orden', 'codigo')
    posicion_estado = {e: i for i, e in enumerate(ESTADOS_REPORTE_RUTA)}
    claves = {
        'codigo': lambda r: r.codigo.lower(),
        'nombre': lambda r: r.nombre.lower(),
        'estado': lambda r: posicion_estado[_estado_reporte_ruta(r)],
        'distancia': lambda r: r.distancia_km or 0,
        'duracion': lambda r: r.duracion_estimada_minutos or 0,
        'frecuencia': lambda r: r.frecuencia_minutos or 0,
        'paradas': lambda r: r.num_paradas,
    }
    if orden not in claves:
        orden = 'codigo'
    rutas.sort(key=claves['codigo'])
    rutas.sort(key=claves[orden], reverse=(sentido == 'desc'))
    texto_orden = {'codigo': 'código', 'nombre': 'nombre', 'estado': 'estado', 'distancia': 'distancia',
                   'duracion': 'duración', 'frecuencia': 'frecuencia', 'paradas': 'paradas'}[orden]
    texto_sentido = 'descendente' if sentido == 'desc' else 'ascendente'

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("rutas")}"'

    def minutos(valor, prefijo=''):
        return f'{prefijo}{valor} min' if valor else texto_celda('Sin dato', secundario=True)

    encabezados = ['Código', 'Nombre', 'Origen', 'Destino', 'Distancia', 'Duración', 'Frecuencia', 'Estado']
    datos = []
    for ruta in rutas:
        datos.append([
            placa_ruta(ruta),
            ruta.nombre,
            ruta.origen,
            ruta.destino,
            f"{ruta.distancia_km:.1f} km" if ruta.distancia_km else texto_celda('Sin dato', secundario=True),
            minutos(ruta.duracion_estimada_minutos),
            minutos(ruta.frecuencia_minutos, 'Cada '),
            ESTADOS_REPORTE_RUTA[_estado_reporte_ruta(ruta)],
        ])

    descripcion = (
        f"Rutas de {request.empresa.nombre.rstrip('.')}. "
        f"Ordenadas por {texto_orden}, de forma {texto_sentido}."
    )
    if filtros:
        descripcion += ' Filtros aplicados: ' + '; '.join(filtros) + '.'
    else:
        descripcion += ' Sin filtros: están todas.'

    anchos = [1.5 * cm, 3.0 * cm, 2.3 * cm, 2.3 * cm, 1.85 * cm, 1.85 * cm, 1.95 * cm, 2.25 * cm]

    return crear_reporte(response, "Rutas", encabezados, datos, len(datos), descripcion, anchos,
                         empresa=request.empresa.nombre, unidad=('ruta', 'rutas'),
                         graficas=_graficas_rutas(rutas))


# Color de cada estado de bus en las gráficas, el mismo de sus insignias en el sitio
COLORES_ESTADO_BUS = {
    'Transmitiendo': ('#187A45', False),
    'En_turno': ('#080707', False),
    'Sin_turno': ('#5B646B', False),
    'Inhabilitado': ('#D3D8DB', True),     # gris claro: con borde para verse sobre blanco
}


def _ultima_vez(bus, ahora):
    """En qué grupo cae la última ubicación del bus (para la gráfica y el orden)."""
    if not bus.ultima_ubicacion:
        return 'Nunca'
    dias = (ahora - bus.ultima_ubicacion).days
    if timezone.localtime(bus.ultima_ubicacion).date() == timezone.localtime(ahora).date():
        return 'Hoy'
    return 'En los últimos 7 días' if dias < 7 else 'Hace más de 7 días'


def _graficas_buses(buses, rutas):
    """Cifras y gráficas del reporte de buses: por estado, cuándo se vieron, buses por ruta y rutas por bus."""
    ancho = ANCHO_UTIL
    mitad = (ancho - 0.6 * cm) / 2
    ahora = timezone.now()
    por_estado = Counter(b.estado_visible for b in buses)
    piezas = [graficas_pdf.indicadores([
        (len(buses), 'Buses en total'),
        (por_estado.get('Transmitiendo', 0), 'Transmitiendo'),
        (por_estado.get('En_turno', 0), 'En turno'),
        (por_estado.get('Sin_turno', 0) + por_estado.get('Inhabilitado', 0), 'Sin turno o inhabilitados'),
    ], ancho), graficas_pdf.separador()]

    filas_estado = [(ESTADOS_BUS[e], por_estado[e], colors.HexColor(COLORES_ESTADO_BUS[e][0]), COLORES_ESTADO_BUS[e][1])
                    for e in ESTADOS_BUS if por_estado.get(e)]
    filas_estado.sort(key=lambda f: -f[1])
    grupos_vez = ['Hoy', 'En los últimos 7 días', 'Hace más de 7 días', 'Nunca']
    colores_vez = ['#187A45', '#014CAB', '#5B646B', '#D3D8DB']
    por_vez = Counter(_ultima_vez(b, ahora) for b in buses)
    filas_vez = [(g, por_vez[g], colors.HexColor(c), g == 'Nunca') for g, c in zip(grupos_vez, colores_vez) if por_vez.get(g)]
    if filas_estado and filas_vez:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Por estado', filas_estado, mitad),
            graficas_pdf.barras_horizontales('Última vez que envió su ubicación', filas_vez, mitad), ancho),
            graficas_pdf.separador()]

    # Cuántos buses pueden cubrir cada ruta (las que no tienen ninguno también salen: es un aviso)
    por_ruta = Counter(r.id_ruta for b in buses for r in b.rutas_lista)
    filas_ruta = sorted([(r.codigo, por_ruta.get(r.id_ruta, 0), color_ruta(r), False) for r in rutas],
                        key=lambda f: (-f[1], f[0]))
    filas_bus = sorted([(b.placa, len(b.rutas_lista), colors.HexColor('#080707'), False) for b in buses],
                       key=lambda f: (-f[1], f[0]))
    if filas_ruta and filas_bus:
        piezas.append(graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Buses que pueden cubrir cada ruta', filas_ruta, mitad, juntar_resto=False),
            graficas_pdf.barras_horizontales('Rutas que puede cubrir cada bus', filas_bus, mitad, juntar_resto=False),
            ancho))
    return piezas


@admin_empresa_required
def reporte_buses(request):
    """Buses de la empresa con los filtros que llegan por la URL: estado y ruta (varios valores cada uno;
    `ruta=sin` son los buses sin rutas). Sin filtros, trae todos. `orden` (placa, estado, rutas, ubicacion
    o conductor) y `sentido` (asc o desc) deciden cómo se ordena; por defecto, por placa de la A a la Z."""
    buses = _marcar_estado_buses(list(request.empresa.buses.prefetch_related('rutas').order_by('placa')),
                                 request.empresa)
    rutas_empresa = list(request.empresa.rutas.order_by('codigo'))
    filtros = []  # frases para decir en el PDF qué se filtró

    # Si se marcan todas las opciones de un grupo no hay nada que filtrar
    estados = [e for e in request.GET.getlist('estado') if e in ESTADOS_BUS]
    if estados and len(set(estados)) < len(ESTADOS_BUS):
        buses = [b for b in buses if b.estado_visible in estados]
        filtros.append('estado: ' + ', '.join(n for e, n in ESTADOS_BUS.items() if e in estados))

    valores_ruta = request.GET.getlist('ruta')
    if valores_ruta:
        ids_ruta = {int(r) for r in valores_ruta if r.isdigit()}
        sin_rutas = 'sin' in valores_ruta
        elegidas = [r for r in rutas_empresa if r.id_ruta in ids_ruta]
        if len(elegidas) < len(rutas_empresa) or not sin_rutas:
            buses = [b for b in buses
                     if any(r.id_ruta in ids_ruta for r in b.rutas_lista) or (sin_rutas and not b.rutas_lista)]
            if len(elegidas) == len(rutas_empresa):
                filtros.append('solo buses con rutas asignadas')
            else:
                partes = [r.codigo for r in elegidas] + (['buses sin rutas'] if sin_rutas else [])
                filtros.append('pueden cubrir: ' + (', '.join(partes) or 'ninguna'))
        # Las gráficas de rutas solo muestran las rutas elegidas
        rutas_empresa = elegidas

    # Orden: primero por placa y luego, si se pidió, por otro criterio (el ordenamiento es estable)
    sentido = 'desc' if request.GET.get('sentido') == 'desc' else 'asc'
    orden = request.GET.get('orden', 'placa')
    posicion_estado = {e: i for i, e in enumerate(ESTADOS_BUS)}
    nunca = timezone.make_aware(datetime(1970, 1, 1))
    claves = {
        'placa': lambda b: b.placa.lower(),
        'estado': lambda b: posicion_estado[b.estado_visible],
        'rutas': lambda b: len(b.rutas_lista),
        'ubicacion': lambda b: b.ultima_ubicacion or nunca,
        'conductor': lambda b: (0, b.turno.conductor.nombre.lower()) if b.turno else (1, ''),
    }
    if orden not in claves:
        orden = 'placa'
    buses.sort(key=claves['placa'])
    buses.sort(key=claves[orden], reverse=(sentido == 'desc'))
    texto_orden = {'placa': 'placa', 'estado': 'estado', 'rutas': 'cantidad de rutas',
                   'ubicacion': 'última ubicación', 'conductor': 'conductor de turno'}[orden]
    texto_sentido = 'descendente' if sentido == 'desc' else 'ascendente'

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("buses")}"'

    encabezados = ['Placa', 'Rutas que puede cubrir', 'Turno ahora', 'Estado', 'Última ubicación']
    datos = []
    for bus in buses:
        if bus.rutas_lista:
            # Cada código con el color de su placa, como en el sitio
            rutas = Paragraph(', '.join(f'<font color="{r.color}"><b>{r.codigo}</b></font>' for r in bus.rutas_lista),
                              ESTILO_CELDA)
        else:
            rutas = texto_celda('Sin rutas', secundario=True)
        if bus.turno:
            turno = Paragraph(f'{escape(bus.turno.conductor.nombre)}<br/><font color="#5B646B" size="8">en la ruta '
                              f'{escape(bus.turno.ruta.codigo)}</font>', ESTILO_CELDA)
        else:
            turno = texto_celda('Sin turno', secundario=True)
        datos.append([
            Paragraph(f'<b>{escape(bus.placa)}</b>', ESTILO_CELDA),
            rutas,
            turno,
            ESTADOS_BUS[bus.estado_visible],
            fecha_celda(bus.ultima_ubicacion) if bus.ultima_ubicacion else texto_celda('Nunca', secundario=True),
        ])

    descripcion = (
        f"Buses de {request.empresa.nombre.rstrip('.')}. "
        f"Ordenados por {texto_orden}, de forma {texto_sentido}."
    )
    if filtros:
        descripcion += ' Filtros aplicados: ' + '; '.join(filtros) + '.'
    else:
        descripcion += ' Sin filtros: están todos.'

    anchos = [2.2 * cm, 5.0 * cm, 4.0 * cm, 2.6 * cm, 3.2 * cm]

    return crear_reporte(response, "Buses", encabezados, datos, len(datos), descripcion, anchos,
                         empresa=request.empresa.nombre, unidad=('bus', 'buses'),
                         graficas=_graficas_buses(buses, rutas_empresa))


# Color de cada parte de la gráfica de estados, el mismo de la dona en el sitio
COLORES_ESTADO_CONDUCTOR = {
    'Comparte': ('En turno, compartiendo ubicación', '#187A45', False),
    'Sin_ubicacion': ('En turno, sin compartir ubicación', '#D4121A', False),
    'Sin_turno': ('Sin turno', '#5B646B', False),
    'Inhabilitado': ('Inhabilitados', '#D3D8DB', True),     # gris claro: con borde para verse sobre blanco
}


def _parte_estado_conductor(conductor):
    """Parte de la gráfica de estados: "En turno" se divide según si el bus comparte su ubicación."""
    if conductor.estado_visible == 'En_turno':
        return 'Comparte' if conductor.transmite else 'Sin_ubicacion'
    return conductor.estado_visible


def _graficas_conductores(conductores, rutas):
    """Cifras y gráficas del reporte de conductores: por estado, en turno por ruta y turnos asignados."""
    ancho = ANCHO_UTIL
    mitad = (ancho - 0.6 * cm) / 2
    por_parte = Counter(_parte_estado_conductor(c) for c in conductores)
    en_turno = por_parte.get('Comparte', 0) + por_parte.get('Sin_ubicacion', 0)
    piezas = [graficas_pdf.indicadores([
        (len(conductores), 'Conductores en total'),
        (en_turno, 'En turno'),
        (por_parte.get('Sin_ubicacion', 0), 'Sin compartir ubicación'),
        (por_parte.get('Sin_turno', 0) + por_parte.get('Inhabilitado', 0), 'Sin turno o inhabilitados'),
    ], ancho), graficas_pdf.separador()]

    filas_estado = [(nombre, por_parte[clave], colors.HexColor(color), borde)
                    for clave, (nombre, color, borde) in COLORES_ESTADO_CONDUCTOR.items() if por_parte.get(clave)]
    filas_estado.sort(key=lambda f: -f[1])
    # Conductores en turno ahora en cada ruta (las que no tienen ninguno también salen: es un aviso)
    por_ruta = Counter(c.turno.ruta_id for c in conductores if c.turno)
    filas_ruta = sorted([(r.codigo, por_ruta.get(r.id_ruta, 0), color_ruta(r), False) for r in rutas],
                        key=lambda f: (-f[1], f[0]))
    if filas_estado and filas_ruta:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Por estado', filas_estado, mitad),
            graficas_pdf.barras_horizontales('En turno ahora en cada ruta', filas_ruta, mitad, juntar_resto=False),
            ancho), graficas_pdf.separador()]
    elif filas_estado:
        piezas += [graficas_pdf.barras_horizontales('Por estado', filas_estado, ancho), graficas_pdf.separador()]

    # Turnos en curso o programados de cada conductor
    filas_turnos = sorted([(c.nombre, c.turnos_pendientes, colors.HexColor('#080707'), False) for c in conductores],
                          key=lambda f: (-f[1], f[0].lower()))
    if filas_turnos:
        piezas.append(graficas_pdf.barras_horizontales('Turnos asignados (en curso o programados)', filas_turnos,
                                                       ancho, juntar_resto=False))
    return piezas


@admin_empresa_required
def reporte_conductores(request):
    """Conductores de la empresa filtrados por estado (`estado`, varios valores; sin filtro, trae todos).
    `orden` (nombre, cedula, telefono o email) y `sentido` (asc o desc) deciden cómo se ordena; por defecto,
    por nombre de la A a la Z."""
    conductores = list(request.empresa.conductores.order_by('nombre'))
    _marcar_estado_conductores(conductores, request.empresa)
    rutas_empresa = list(request.empresa.rutas.order_by('codigo'))
    filtros = []  # frases para decir en el PDF qué se filtró

    # Si se marcan todas las opciones de un grupo no hay nada que filtrar
    estados = [e for e in request.GET.getlist('estado') if e in ESTADOS_CONDUCTOR]
    if estados and len(set(estados)) < len(ESTADOS_CONDUCTOR):
        conductores = [c for c in conductores if c.estado_visible in estados]
        filtros.append('estado: ' + ', '.join(n for e, n in ESTADOS_CONDUCTOR.items() if e in estados))

    # Orden: primero por nombre y luego, si se pidió, por otro criterio (el ordenamiento es estable)
    sentido = 'desc' if request.GET.get('sentido') == 'desc' else 'asc'
    orden = request.GET.get('orden', 'nombre')
    # Cédula y teléfono son números: se comparan como números (si tienen otra cosa, van al final)
    def como_numero(texto):
        return (0, int(texto), '') if texto.isdigit() else (1, 0, texto)
    claves = {
        'nombre': lambda c: c.nombre.lower(),
        'cedula': lambda c: como_numero(c.cedula),
        'telefono': lambda c: como_numero(c.telefono),
        'email': lambda c: c.email.lower(),
    }
    if orden not in claves:
        orden = 'nombre'
    conductores.sort(key=claves['nombre'])
    conductores.sort(key=claves[orden], reverse=(sentido == 'desc'))
    texto_orden = {'nombre': 'nombre', 'cedula': 'cédula', 'telefono': 'teléfono', 'email': 'correo'}[orden]
    texto_sentido = 'descendente' if sentido == 'desc' else 'ascendente'

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("conductores")}"'

    encabezados = ['Conductor', 'Contacto', 'Turno ahora', 'Estado', 'Turnos']
    datos = []
    for c in conductores:
        if c.turno:
            detalle = f'hasta {fecha_hora12(c.turno.fin_actual)}' if c.turno.fin_actual else 'sin hora de fin'
            if c.turno.en_pausa:
                detalle += ' · en pausa'
            elif not c.transmite:
                detalle += ' · sin compartir ubicación'
            turno = Paragraph(
                f'<b>{escape(c.turno.bus.placa)}</b> · <font color="{c.turno_color}"><b>{escape(c.turno.ruta.codigo)}'
                f'</b></font><br/><font color="#5B646B" size="8">{escape(detalle)}</font>', ESTILO_CELDA)
        else:
            turno = texto_celda('Sin turno', secundario=True)
        datos.append([
            Paragraph(f'<b>{escape(c.nombre)}</b><br/><font color="#5B646B" size="8">Cédula {escape(c.cedula)}</font>',
                      ESTILO_CELDA),
            Paragraph(f'{escape(c.telefono)}<br/><font color="#5B646B" size="8">{escape(c.email)}</font>', ESTILO_CELDA),
            turno,
            ESTADOS_CONDUCTOR[c.estado_visible],
            str(c.turnos_pendientes),
        ])

    descripcion = (
        f"Conductores de {request.empresa.nombre.rstrip('.')}. "
        f"Ordenados por {texto_orden}, de forma {texto_sentido}."
    )
    if filtros:
        descripcion += ' Filtros aplicados: ' + '; '.join(filtros) + '.'
    else:
        descripcion += ' Sin filtros: están todos.'
    descripcion += ' "Turnos" cuenta los turnos en curso o programados de cada conductor.'

    anchos = [4.0 * cm, 4.6 * cm, 4.4 * cm, 2.2 * cm, 1.8 * cm]

    return crear_reporte(response, "Conductores", encabezados, datos, len(datos), descripcion, anchos,
                         empresa=request.empresa.nombre, unidad=('conductor', 'conductores'),
                         graficas=_graficas_conductores(conductores, rutas_empresa))


def _graficas_alertas(alertas, por_estado):
    """Cifras y gráficas del reporte de alertas: totales por estado, por tipo, por ruta y en el tiempo."""
    ancho = ANCHO_UTIL
    mitad = (ancho - 0.6 * cm) / 2
    piezas = [graficas_pdf.indicadores([
        (len(alertas), 'Alertas en total'),
        (por_estado.get('Pendiente', 0), 'Pendientes'),
        (por_estado.get('En_proceso', 0), 'En proceso'),
        (por_estado.get('Resuelta', 0), 'Resueltas'),
    ], ancho), graficas_pdf.separador()]

    # Por tipo, con el color de su etiqueta; el amarillo lleva borde para verse sobre blanco
    por_tipo = Counter(a.tipo for a in alertas)
    filas_tipo = [(TIPOS_ALERTA_PDF[t][0], n, TIPOS_ALERTA_PDF[t][1], t == 'warning')
                  for t, n in por_tipo.most_common() if t in TIPOS_ALERTA_PDF]
    # Por ruta, cada una con su color de placa
    por_ruta = Counter(a.ruta for a in alertas)
    filas_ruta = [(r.codigo, n, color_ruta(r), False)
                  for r, n in sorted(por_ruta.items(), key=lambda x: (-x[1], x[0].codigo))]
    if filas_tipo and filas_ruta:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Por tipo', filas_tipo, mitad),
            graficas_pdf.barras_horizontales('Por ruta afectada', filas_ruta, mitad), ancho),
            graficas_pdf.separador()]

    en_el_tiempo = graficas_pdf.columnas_en_el_tiempo('Alertas', [a.fecha_creacion for a in alertas], ancho)
    if en_el_tiempo:
        piezas.append(en_el_tiempo)
    return piezas


@admin_empresa_required
def reporte_alertas(request):
    """Alertas de las rutas de la empresa (sin las canceladas), con los filtros que llegan por la URL:
    tipo, estado y ruta (varios valores cada uno), autor (todas o solo las de la empresa) y
    fechas (desde, hasta o un rango). Sin filtros, trae todas. `orden` (fecha, tipo, estado, ruta o
    autor) y `sentido` (asc o desc) deciden cómo se ordena; por defecto, la más reciente primero."""
    nombres_tipo = {'delay': 'Demora', 'warning': 'Advertencia', 'info': 'Información'}
    nombres_estado = {'Pendiente': 'Pendiente', 'En_proceso': 'En proceso', 'Resuelta': 'Resuelta'}
    alertas = (Alerta.objects.filter(ruta__empresa=request.empresa).exclude(estado='Cancelada')
               .select_related('ruta', 'usuario', 'empresa').order_by('-fecha_creacion'))
    filtros = []  # frases para decir en el PDF qué se filtró

    # Si se marcan todas las opciones de un grupo no hay nada que filtrar
    tipos = [t for t in request.GET.getlist('tipo') if t in nombres_tipo]
    if tipos and len(set(tipos)) < len(nombres_tipo):
        alertas = alertas.filter(tipo__in=tipos)
        filtros.append('tipo: ' + ', '.join(nombres_tipo[t] for t in nombres_tipo if t in tipos))

    estados = [e for e in request.GET.getlist('estado') if e in nombres_estado]
    if estados and len(set(estados)) < len(nombres_estado):
        alertas = alertas.filter(estado__in=estados)
        filtros.append('estado: ' + ', '.join(nombres_estado[e] for e in nombres_estado if e in estados))

    ids_ruta = {int(r) for r in request.GET.getlist('ruta') if r.isdigit()}
    if ids_ruta:
        todas = list(request.empresa.rutas.order_by('codigo'))
        elegidas = [r for r in todas if r.id_ruta in ids_ruta]
        if elegidas and len(elegidas) < len(todas):
            alertas = alertas.filter(ruta__in=elegidas)
            filtros.append('ruta afectada: ' + ', '.join(r.codigo for r in elegidas))

    if request.GET.get('autor') == 'empresa':
        # Solo las que publicó la empresa; las de pasajeros quedan fuera
        alertas = alertas.filter(usuario__isnull=True)
        filtros.append('autor: solo las de la empresa')

    def _fecha(nombre):
        try:
            return datetime.strptime(request.GET.get(nombre, ''), '%Y-%m-%d').date()
        except ValueError:
            return None

    desde, hasta = _fecha('desde'), _fecha('hasta')
    if desde and hasta and desde > hasta:
        desde, hasta = hasta, desde
    if desde:
        alertas = alertas.filter(fecha_creacion__gte=timezone.make_aware(datetime.combine(desde, time.min)))
    if hasta:
        alertas = alertas.filter(
            fecha_creacion__lt=timezone.make_aware(datetime.combine(hasta + timedelta(days=1), time.min)))
    if desde and hasta:
        filtros.append(f'fechas del {desde:%d/%m/%Y} al {hasta:%d/%m/%Y}')
    elif desde:
        filtros.append(f'fechas desde el {desde:%d/%m/%Y}')
    elif hasta:
        filtros.append(f'fechas hasta el {hasta:%d/%m/%Y}')

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("alertas")}"'

    # Orden del PDF: primero por fecha (la más reciente arriba) y luego, si se pidió, por otro criterio;
    # el ordenamiento de Python es estable, así que dentro de cada grupo sigue mandando la fecha
    sentido = 'asc' if request.GET.get('sentido') == 'asc' else 'desc'
    orden = request.GET.get('orden', 'fecha')
    if orden == 'autor' and request.GET.get('autor') == 'empresa':
        orden = 'fecha'  # con un solo autor no hay nada que ordenar
    posicion_estado = {'Pendiente': 0, 'En_proceso': 1, 'Resuelta': 2}
    claves = {
        'tipo': lambda a: nombres_tipo.get(a.tipo, a.tipo),
        'estado': lambda a: posicion_estado.get(a.estado, 9),
        'ruta': lambda a: a.ruta.codigo,
        'autor': lambda a: a.autor.lower(),
    }
    alertas = list(alertas)
    if orden in claves:
        alertas.sort(key=claves[orden], reverse=(sentido == 'desc'))
    else:
        orden = 'fecha'
        alertas.sort(key=lambda a: a.fecha_creacion, reverse=(sentido == 'desc'))
    texto_orden = {'fecha': 'fecha', 'tipo': 'tipo', 'estado': 'estado', 'ruta': 'ruta', 'autor': 'autor'}[orden]
    texto_sentido = 'descendente' if sentido == 'desc' else 'ascendente'


    encabezados = ['Tipo', 'Ruta', 'Descripción', 'Estado', 'Autor', 'Fecha']
    datos = []
    por_estado = {}
    for a in alertas:
        por_estado[a.estado] = por_estado.get(a.estado, 0) + 1
        datos.append([
            etiqueta_tipo_alerta(a.tipo),
            placa_ruta(a.ruta),
            a.descripcion,
            nombres_estado.get(a.estado, a.estado),
            a.autor,
            fecha_celda(a.fecha_creacion),
        ])

    descripcion = (
        f"Alertas de las rutas de {request.empresa.nombre.rstrip('.')}. "
        f"Ordenadas por {texto_orden}, de forma {texto_sentido}."
    )
    if filtros:
        descripcion += ' Filtros aplicados: ' + '; '.join(filtros) + '.'
    else:
        descripcion += ' Sin filtros: están todas.'

    anchos = [2.5 * cm, 1.6 * cm, 4.9 * cm, 2.2 * cm, 3.5 * cm, 2.3 * cm]

    return crear_reporte(response, "Alertas", encabezados, datos, len(datos), descripcion, anchos,
                         empresa=request.empresa.nombre, unidad=('alerta', 'alertas'),
                         graficas=_graficas_alertas(alertas, por_estado))


# Estados de un turno en el reporte, en este orden, y su color en las gráficas (el de sus insignias en el sitio)
ESTADOS_TURNO = {'En curso': 'En curso', 'Programado': 'Programados', 'Finalizado': 'Finalizados'}
COLORES_ESTADO_TURNO = {
    'En curso': ('#187A45', False),
    'Programado': ('#014CAB', False),
    'Finalizado': ('#D3D8DB', True),     # gris claro: con borde para verse sobre blanco
}
# Periodo más largo que se puede pedir en un reporte de turnos
MAX_DIAS_REPORTE_TURNOS = 366


def _graficas_turnos(turnos, rutas, inicio, fin):
    """Cifras y gráficas del reporte de turnos: por estado, por ruta, por conductor y jornadas por día."""
    ancho = ANCHO_UTIL
    mitad = (ancho - 0.6 * cm) / 2
    por_estado = Counter(t.estado for t in turnos)
    piezas = [graficas_pdf.indicadores([
        (len(turnos), 'Turnos en total'),
        (por_estado.get('En curso', 0), 'En curso'),
        (por_estado.get('Programado', 0), 'Programados'),
        (por_estado.get('Finalizado', 0), 'Finalizados'),
    ], ancho), graficas_pdf.separador()]

    filas_estado = [(ESTADOS_TURNO[e], por_estado[e], colors.HexColor(COLORES_ESTADO_TURNO[e][0]),
                     COLORES_ESTADO_TURNO[e][1]) for e in ESTADOS_TURNO if por_estado.get(e)]
    # Turnos de cada ruta (las rutas sin ninguno también salen: es un aviso)
    por_ruta = Counter(t.ruta_id for t in turnos)
    filas_ruta = sorted([(r.codigo, por_ruta.get(r.id_ruta, 0), color_ruta(r), False) for r in rutas],
                        key=lambda f: (-f[1], f[0]))
    if filas_estado and filas_ruta:
        piezas += [graficas_pdf.en_dos_columnas(
            graficas_pdf.barras_horizontales('Por estado', filas_estado, mitad),
            graficas_pdf.barras_horizontales('Turnos por ruta', filas_ruta, mitad, juntar_resto=False), ancho),
            graficas_pdf.separador()]

    # Turnos de cada conductor en el periodo
    por_conductor = Counter(t.conductor.nombre for t in turnos)
    filas_conductor = [(nombre, n, colors.HexColor('#080707'), False)
                       for nombre, n in sorted(por_conductor.items(), key=lambda x: (-x[1], x[0].lower()))]
    if filas_conductor:
        piezas += [graficas_pdf.barras_horizontales('Turnos por conductor', filas_conductor, ancho,
                                                    juntar_resto=False), graficas_pdf.separador()]

    # Jornadas trabajadas o por trabajar en cada día del periodo (una asignación fija cuenta cada día que le toca)
    jornadas = [empieza for t in turnos for empieza, _ in t.ventanas(inicio, fin) if inicio <= empieza < fin]
    en_el_tiempo = graficas_pdf.columnas_en_el_tiempo('Jornadas', jornadas, ancho)
    if en_el_tiempo:
        piezas.append(en_el_tiempo)
    return piezas


@admin_empresa_required
def reporte_turnos(request):
    """Turnos que se cruzan con un periodo (`desde` y `hasta`; por defecto, hoy), con los filtros que llegan por
    la URL: estado y ruta (varios valores cada uno). `orden` (inicio, fin, conductor, placa, ruta o estado) y
    `sentido` (asc o desc) deciden cómo se ordena; por defecto, por hora de inicio."""
    hoy = timezone.localdate()
    try:
        desde = datetime.strptime(request.GET.get('desde', ''), '%Y-%m-%d').date()
    except ValueError:
        desde = hoy
    try:
        hasta = datetime.strptime(request.GET.get('hasta', ''), '%Y-%m-%d').date()
    except ValueError:
        hasta = desde
    if hasta < desde:
        desde, hasta = hasta, desde
    recortado = (hasta - desde).days + 1 > MAX_DIAS_REPORTE_TURNOS
    if recortado:
        hasta = desde + timedelta(days=MAX_DIAS_REPORTE_TURNOS - 1)

    inicio = timezone.make_aware(datetime.combine(desde, time.min))
    fin = timezone.make_aware(datetime.combine(hasta + timedelta(days=1), time.min))
    turnos_rango = list(Turno.que_se_cruzan(inicio, fin).filter(bus__empresa=request.empresa)
                        .select_related('conductor', 'bus', 'ruta').order_by('inicio', 'conductor__nombre'))
    rutas_empresa = list(request.empresa.rutas.order_by('codigo'))
    filtros = []  # frases para decir en el PDF qué se filtró

    # Si se marcan todas las opciones de un grupo no hay nada que filtrar
    estados = [e for e in request.GET.getlist('estado') if e in ESTADOS_TURNO]
    if estados and len(set(estados)) < len(ESTADOS_TURNO):
        turnos_rango = [t for t in turnos_rango if t.estado in estados]
        filtros.append('estado: ' + ', '.join(n.lower() for e, n in ESTADOS_TURNO.items() if e in estados))

    valores_ruta = request.GET.getlist('ruta')
    if valores_ruta:
        ids_ruta = {int(r) for r in valores_ruta if r.isdigit()}
        elegidas = [r for r in rutas_empresa if r.id_ruta in ids_ruta]
        if len(elegidas) < len(rutas_empresa):
            turnos_rango = [t for t in turnos_rango if t.ruta_id in ids_ruta]
            filtros.append('rutas: ' + (', '.join(r.codigo for r in elegidas) or 'ninguna'))
        # La gráfica de rutas solo muestra las rutas elegidas
        rutas_empresa = elegidas
    else:
        # Sin filtro, la gráfica muestra las rutas habilitadas y las que tuvieron turnos
        con_turno = {t.ruta_id for t in turnos_rango}
        rutas_empresa = [r for r in rutas_empresa if r.habilitado or r.id_ruta in con_turno]

    # Orden: primero por hora de inicio y luego, si se pidió, por otro criterio (el ordenamiento es estable)
    sentido = 'desc' if request.GET.get('sentido') == 'desc' else 'asc'
    orden = request.GET.get('orden', 'inicio')
    posicion_estado = {e: i for i, e in enumerate(ESTADOS_TURNO)}
    sin_fin = timezone.make_aware(datetime(9999, 1, 1))
    claves = {
        'inicio': lambda t: t.inicio,
        'fin': lambda t: t.fin or sin_fin,
        'conductor': lambda t: t.conductor.nombre.lower(),
        'placa': lambda t: t.bus.placa.lower(),
        'ruta': lambda t: t.ruta.codigo.lower(),
        'estado': lambda t: posicion_estado[t.estado],
    }
    if orden not in claves:
        orden = 'inicio'
    turnos_rango.sort(key=claves['inicio'])
    turnos_rango.sort(key=claves[orden], reverse=(sentido == 'desc'))
    texto_orden = {'inicio': 'hora de inicio', 'fin': 'hora de fin', 'conductor': 'conductor', 'placa': 'placa del bus',
                   'ruta': 'ruta', 'estado': 'estado'}[orden]
    texto_sentido = 'descendente' if sentido == 'desc' else 'ascendente'

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("turnos")}"'

    encabezados = ['Conductor', 'Bus', 'Ruta', 'Horario', 'Estado']
    datos = []
    for t in turnos_rango:
        if t.fijo:
            # Un fijo muestra su horario diario y desde cuándo rige
            horario = (f'<b>Fijo</b> · {hora12(t.inicio)} a {hora12(t.hora_fin)}<br/>'
                       f'<font color="#5B646B" size="8">{escape(t.dias_texto)}, desde el {t.inicio:%d/%m/%Y}'
                       + (f' hasta el {timezone.localtime(t.fin):%d/%m/%Y}' if t.fin else '') + '</font>')
        else:
            horario = (f'{fecha_hora12(t.inicio)}<br/><font color="#5B646B" size="8">a '
                       f'{fecha_hora12(t.fin) if t.fin else "sin hora de fin"}</font>')
        estado = escape(t.estado)
        if t.en_pausa:
            estado += '<br/><font color="#D4121A" size="8">En pausa: ruta fuera de servicio</font>'
        datos.append([
            Paragraph(f'<b>{escape(t.conductor.nombre)}</b><br/><font color="#5B646B" size="8">Cédula '
                      f'{escape(t.conductor.cedula)}</font>', ESTILO_CELDA),
            Paragraph(f'<b>{escape(t.bus.placa)}</b>', ESTILO_CELDA),
            placa_ruta(t.ruta),
            Paragraph(horario, ESTILO_CELDA),
            Paragraph(estado, ESTILO_CELDA),
        ])

    periodo = (f'el {desde:%d/%m/%Y}' if desde == hasta else f'entre el {desde:%d/%m/%Y} y el {hasta:%d/%m/%Y}')
    descripcion = (
        f"Turnos de {request.empresa.nombre.rstrip('.')} {periodo}: qué conductor manejó cada bus, en qué ruta y "
        f"en qué horario. Incluye los turnos nocturnos que cruzan la medianoche y las asignaciones fijas vigentes. "
        f"Ordenados por {texto_orden}, de forma {texto_sentido}."
    )
    if filtros:
        descripcion += ' Filtros aplicados: ' + '; '.join(filtros) + '.'
    if recortado:
        descripcion += f' El periodo pedido era más largo: se muestran los primeros {MAX_DIAS_REPORTE_TURNOS} días.'

    anchos = [4.2 * cm, 2.2 * cm, 2.0 * cm, 5.4 * cm, 3.2 * cm]

    return crear_reporte(response, "Turnos", encabezados, datos, len(datos), descripcion, anchos,
                         empresa=request.empresa.nombre, unidad=('turno', 'turnos'),
                         graficas=_graficas_turnos(turnos_rango, rutas_empresa, inicio, fin))


# ================= SIMULACIÓN =================

def _a_bool(valor):
    """Interpreta true/false que llegan como bool, número o texto ("false" es falso)."""
    if isinstance(valor, str):
        return valor.strip().lower() in ('1', 'true', 'si', 'sí', 'on')
    return bool(valor)


def _apagar_buses_simulados(buses):
    """Al detener la simulación, saca del mapa los buses que no tienen GPS real reciente."""
    hace_poco = timezone.now() - timedelta(seconds=60)
    con_gps_real = UbicacionBus.objects.filter(
        bus__in=buses, conductor__isnull=False, timestamp__gte=hace_poco
    ).values('bus')
    Bus.objects.filter(id_bus__in=[b.id_bus for b in buses]).exclude(id_bus__in=con_gps_real).update(activo=False)


def _simulador_corriendo(empresa):
    """True/False según si el comando simular_buses está moviendo buses de la empresa;
    None si no hay ningún bus simulándose (no se puede saber)."""
    if not ConfiguracionBus.objects.filter(bus__empresa=empresa, simulando=True).exists():
        return None
    hace_poco = timezone.now() - timedelta(seconds=15)
    return UbicacionBus.objects.filter(
        bus__empresa=empresa, conductor__isnull=True, timestamp__gte=hace_poco
    ).exists()

@admin_empresa_required
def api_configurar_simulacion(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        bus_id = data.get('bus_id')
        simulando = data.get('simulando')
        velocidad = data.get('velocidad_kmh')

        if not bus_id:
            return JsonResponse({'error': 'Bus ID requerido'}, status=400)

        try:
            bus = Bus.objects.get(id_bus=_id_valido(bus_id, 'bus_id'), empresa=request.empresa, habilitado=True)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'Bus no encontrado'}, status=404)

        config, created = ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

        if simulando is not None:
            config.simulando = _a_bool(simulando)
        if velocidad is not None:
            config.velocidad_kmh = max(1.0, min(_numero_valido(velocidad, 'velocidad_kmh'), 120.0))

        config.save()
        if not config.simulando:
            _apagar_buses_simulados([bus])

        return JsonResponse({
            'status': 'ok',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'simulando': config.simulando,
            'velocidad_kmh': config.velocidad_kmh,
            'direccion': config.direccion
        })

    except Exception as e:
        return _respuesta_error(e)


def _texto_turno_panel(turno):
    if turno is None:
        return 'Sin turno en curso: no se moverá'
    return f'{turno.conductor.nombre} · {turno.ruta.nombre} · hasta las {hora12(turno.fin_actual)}'


def _datos_turno_panel(turno):
    """Datos del turno en curso para la tarjeta del panel de simulación (None si no tiene)."""
    if turno is None:
        return None
    return {
        'conductor': turno.conductor.nombre,
        'ruta_codigo': turno.ruta.codigo,
        'ruta_nombre': turno.ruta.nombre,
        'ruta_color': COLORES_RUTA[turno.ruta_id % len(COLORES_RUTA)],
        'hasta': hora12(turno.fin_actual),
    }


@admin_empresa_required
def api_estado_simulacion(request):
    configs = ConfiguracionBus.objects.filter(bus__empresa=request.empresa, bus__habilitado=True).select_related('bus')

    turnos = _turnos_vigentes_por('bus_id', request.empresa)
    data = []
    for config in configs:
        turno = turnos.get(config.bus.id_bus)
        data.append({
            'bus_id': config.bus.id_bus,
            'placa': config.bus.placa,
            'ruta': turno.ruta.nombre if turno else None,
            'turno': _texto_turno_panel(turno),
            'con_turno': turno is not None,
            'turno_datos': _datos_turno_panel(turno),
            'simulando': config.simulando,
            'velocidad_kmh': config.velocidad_kmh,
            'direccion': config.direccion,
            'posicion_actual': config.posicion_actual,
            'distancia_recorrida': config.distancia_recorrida,
        })

    return JsonResponse({
        'count': len(data),
        'configuraciones': data,
        'simulador_corriendo': _simulador_corriendo(request.empresa),
    })


def api_tiempo_llegada(request):
    bus_id = request.GET.get('bus_id')
    lat = request.GET.get('lat')
    lng = request.GET.get('lng')

    if not all([bus_id, lat, lng]):
        return JsonResponse({'error': 'Faltan parámetros'}, status=400)

    try:
        bus_id = _id_valido(bus_id, 'bus_id')
        lat = _numero_valido(lat, 'lat', -90, 90)
        lng = _numero_valido(lng, 'lng', -180, 180)

        ultima = UbicacionBus.objects.filter(bus_id=bus_id).order_by('-timestamp').first()
        if not ultima:
            return JsonResponse({'error': 'Sin ubicación registrada'}, status=404)

        distancia_m = _haversine(ultima.latitud, ultima.longitud, lat, lng)
        velocidad_kmh = ultima.velocidad if ultima.velocidad > 0 else 30
        velocidad_ms = velocidad_kmh * 1000 / 3600
        tiempo_segundos = distancia_m / velocidad_ms
        tiempo_minutos = tiempo_segundos / 60

        return JsonResponse({
            'status': 'ok',
            'bus_id': int(bus_id),
            'distancia_m': round(distancia_m, 2),
            'distancia_km': round(distancia_m / 1000, 2),
            'velocidad_kmh': round(velocidad_kmh, 1),
            'tiempo_segundos': round(tiempo_segundos, 0),
            'tiempo_minutos': round(tiempo_minutos, 1),
            'tiempo_texto': f"{int(tiempo_minutos)} min" if tiempo_minutos < 60 else f"{int(tiempo_minutos / 60)}h {int(tiempo_minutos % 60)}min"
        })

    except Exception as e:
        return _respuesta_error(e)


# ================= PANEL DE SIMULACIÓN =================

@admin_empresa_required
def panel_simulacion(request):
    buses = request.empresa.buses.filter(habilitado=True).order_by('placa')

    for bus in buses:
        ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

    configs = list(ConfiguracionBus.objects.filter(bus__empresa=request.empresa, bus__habilitado=True).select_related(
        'bus'
    ).order_by('bus__placa'))
    # Turno en curso de cada bus: sin turno la simulación no lo mueve
    turnos = _turnos_vigentes_por('bus_id', request.empresa)
    for config in configs:
        config.turno = turnos.get(config.bus.id_bus)
        config.turno_color = COLORES_RUTA[config.turno.ruta_id % len(COLORES_RUTA)] if config.turno else ''

    total_buses = len(configs)
    simulando = sum(1 for c in configs if c.simulando)
    detenidos = total_buses - simulando

    return render(request, 'core/panel_simulacion.html', {
        'configuraciones': configs,
        'total_buses': total_buses,
        'simulando': simulando,
        'detenidos': detenidos,
        'con_turno': sum(1 for c in configs if c.turno),
        'simulador_corriendo': _simulador_corriendo(request.empresa),
    })

@admin_empresa_required
def toggle_simulacion(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        config = ConfiguracionBus.objects.get(bus_id=bus_id, bus__empresa=request.empresa, bus__habilitado=True)
        config.simulando = not config.simulando
        config.save()
        if not config.simulando:
            _apagar_buses_simulados([config.bus])

        return JsonResponse({
            'status': 'ok',
            'simulando': config.simulando,
            'bus_id': bus_id,
            'placa': config.bus.placa
        })
    except ConfiguracionBus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)
    except Exception as e:
        return _respuesta_error(e)

@admin_empresa_required
def cambiar_velocidad(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        velocidad = _numero_valido(data.get('velocidad', 30), 'velocidad')

        if velocidad < 1:
            velocidad = 1
        elif velocidad > 120:
            velocidad = 120

        config = ConfiguracionBus.objects.get(bus_id=bus_id, bus__empresa=request.empresa)
        config.velocidad_kmh = velocidad
        config.save()

        return JsonResponse({
            'status': 'ok',
            'velocidad': config.velocidad_kmh,
            'bus_id': bus_id
        })
    except ConfiguracionBus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)
    except Exception as e:
        return _respuesta_error(e)

@admin_empresa_required
def toggle_todos(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = _json_objeto(request)
        simulando = _a_bool(data.get('simulando', False))

        configs = ConfiguracionBus.objects.filter(bus__empresa=request.empresa)
        # Encender solo los habilitados; apagar, todos
        (configs.filter(bus__habilitado=True) if simulando else configs).update(simulando=simulando)
        if not simulando:
            _apagar_buses_simulados(list(request.empresa.buses.all()))

        return JsonResponse({
            'status': 'ok',
            'simulando': simulando,
            'count': configs.filter(simulando=simulando).count()
        })
    except Exception as e:
        return _respuesta_error(e)


@admin_empresa_required
def resetear_bus(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        config = ConfiguracionBus.objects.get(bus_id=bus_id, bus__empresa=request.empresa)
        config.posicion_actual = 0
        config.direccion = 1
        config.distancia_recorrida = 0
        config.metros_en_segmento = 0
        config.save()

        return JsonResponse({
            'status': 'ok',
            'message': f'Bus {config.bus.placa} reseteado'
        })
    except ConfiguracionBus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)
    except Exception as e:
        return _respuesta_error(e)


# ================= TIEMPO DE LLEGADA A USUARIO / RUTA =================

def _haversine(lat1, lng1, lat2, lng2):
    """Distancia en metros entre dos puntos (Haversine)."""
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _punto_mas_cercano_en_ruta(coords, lat_ref, lng_ref):
    """Devuelve (indice, distancia_metros) del punto más cercano en coords a (lat_ref, lng_ref)."""
    mejor_idx = 0
    mejor_dist = float('inf')
    for i, (lng, lat) in enumerate(coords):
        d = _haversine(lat_ref, lng_ref, lat, lng)
        if d < mejor_dist:
            mejor_dist = d
            mejor_idx = i
    return mejor_idx, mejor_dist


def _distancia_sobre_ruta(coords, idx_a, idx_b):
    """Suma de distancias entre coords[idx_a] y coords[idx_b] (en metros)."""
    if idx_a == idx_b:
        return 0.0
    paso = 1 if idx_b > idx_a else -1
    total = 0.0
    for i in range(idx_a, idx_b, paso):
        lng1, lat1 = coords[i]
        lng2, lat2 = coords[i + paso]
        total += _haversine(lat1, lng1, lat2, lng2)
    return total


@csrf_exempt
def api_tiempo_llegada_usuario(request, bus_id):
    """
    Calcula el tiempo estimado de llegada del bus a la posición del usuario
    o al punto más cercano de la ruta (si el usuario está lejos o sin ubicación).
    Rutas de SOLO IDA: cuando el bus pasa el destino, se reporta "passed".
    """
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    lat_usuario = request.GET.get('lat')
    lng_usuario = request.GET.get('lng')
    tiene_ubicacion = bool(lat_usuario and lng_usuario)

    if tiene_ubicacion:
        try:
            lat_usuario = float(lat_usuario)
            lng_usuario = float(lng_usuario)
        except ValueError:
            tiene_ubicacion = False

    # Mismas reglas que el mapa: un bus inhabilitado, apagado o de una empresa inactiva no se consulta
    bus = _buses_publicos().filter(id_bus=bus_id).first()
    if bus is None:
        return JsonResponse({'error': 'Bus no disponible'}, status=404)

    ultima = UbicacionBus.objects.filter(bus=bus).select_related('ruta__empresa').order_by('-timestamp').first()
    if not ultima or ultima.timestamp < timezone.now() - timedelta(minutes=MINUTOS_SIN_SENAL):
        return JsonResponse({'error': 'Bus sin ubicación reciente'}, status=404)

    # La ruta es la que el bus está recorriendo según su último punto (depende del turno)
    ruta = ultima.ruta
    if not _ruta_publica(ruta):
        return JsonResponse({'error': 'La ruta del bus no está disponible'}, status=404)
    if not ruta.geometria_ruta:
        return JsonResponse({'error': 'La ruta del bus no tiene trazado'}, status=404)

    coords = list(ruta.geometria_ruta.coords)
    if len(coords) < 2:
        return JsonResponse({'error': 'La ruta no tiene suficientes puntos'}, status=404)

    ultimas = UbicacionBus.objects.filter(bus=bus).order_by('-timestamp')[:10]
    velocidades = [u.velocidad for u in ultimas if u.velocidad > 0]
    velocidad_kmh = (sum(velocidades) / len(velocidades)) if velocidades else 30

    if velocidad_kmh < 1:
        return JsonResponse({
            'status': 'stopped',
            'message': 'El bus está detenido',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'ruta': ruta.nombre,
            'velocidad_kmh': 0,
            'tiempo_texto': 'Detenido',
            'distancia_km': None,
            'tiene_ubicacion': tiene_ubicacion,
        })

    try:
        config = ConfiguracionBus.objects.get(bus=bus)
        idx_bus = max(0, min(config.posicion_actual, len(coords) - 1))
        direccion_bus = config.direccion if config.direccion in (1, -1) else 1
    except ConfiguracionBus.DoesNotExist:
        idx_bus, _ = _punto_mas_cercano_en_ruta(coords, ultima.latitud, ultima.longitud)
        direccion_bus = 1

    # ===== DETERMINAR DESTINO =====
    destino_origen = None
    idx_destino = None
    distancia_recta_usuario_a_ruta = None

    if tiene_ubicacion:
        idx_cercano_usuario, distancia_recta_usuario_a_ruta = _punto_mas_cercano_en_ruta(
            coords, lat_usuario, lng_usuario
        )
        idx_destino = idx_cercano_usuario
        destino_origen = 'usuario' if distancia_recta_usuario_a_ruta <= 500 else 'ruta_cercana'
    else:
        idx_destino = idx_bus
        destino_origen = 'ruta_cercana'

    # ===== DETECTAR SI EL BUS YA PASÓ EL DESTINO (ruta de solo ida) =====
    if direccion_bus == 1:
        bus_ya_paso = idx_destino < idx_bus
    else:
        bus_ya_paso = idx_destino > idx_bus

    if bus_ya_paso:
        # Distancia recta entre el bus actual y el destino
        distancia_recta = _haversine(
            ultima.latitud, ultima.longitud,
            coords[idx_destino][1], coords[idx_destino][0]
        )
        return JsonResponse({
            'status': 'passed',
            'message': 'El bus ya pasó por tu punto',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'ruta': ruta.nombre,
            'velocidad_kmh': round(velocidad_kmh, 1),
            'tiempo_texto': 'Ya pasó',
            'distancia_km': round(distancia_recta / 1000, 2),
            'destino_origen': destino_origen,
            'tiene_ubicacion': tiene_ubicacion,
            'posicion_bus': {
                'lat': ultima.latitud,
                'lng': ultima.longitud,
                'idx': idx_bus,
            },
            'posicion_destino': {
                'lat': coords[idx_destino][1],
                'lng': coords[idx_destino][0],
                'idx': idx_destino,
            },
        })

    # ===== DISTANCIA SOBRE LA RUTA =====
    distancia_ruta = _distancia_sobre_ruta(coords, idx_bus, idx_destino)
    distancia_real = distancia_ruta * 1.2

    velocidad_ms = velocidad_kmh * 1000 / 3600
    tiempo_segundos = distancia_real / velocidad_ms if velocidad_ms > 0 else 0
    tiempo_minutos = tiempo_segundos / 60

    if tiempo_minutos < 1:
        tiempo_texto = "Llegando"
    elif tiempo_minutos < 60:
        tiempo_texto = f"{int(tiempo_minutos)} min"
    else:
        horas = int(tiempo_minutos // 60)
        mins = int(tiempo_minutos % 60)
        tiempo_texto = f"{horas}h {mins}min"

    hora_llegada = timezone.now() + timedelta(minutes=tiempo_minutos)
    lng_dest, lat_dest = coords[idx_destino]

    return JsonResponse({
        'status': 'ok',
        'bus_id': bus.id_bus,
        'placa': bus.placa,
        'ruta': ruta.nombre,
        'velocidad_kmh': round(velocidad_kmh, 1),
        'destino_origen': destino_origen,
        'distancia_metros': round(distancia_ruta, 0),
        'distancia_km': round(distancia_ruta / 1000, 2),
        'tiempo_segundos': round(tiempo_segundos, 0),
        'tiempo_minutos': round(tiempo_minutos, 1),
        'tiempo_texto': tiempo_texto,
        'hora_llegada': hora12(hora_llegada),  # hora local, en 12 horas
        'tiene_ubicacion': tiene_ubicacion,
        'distancia_usuario_a_ruta_m': round(distancia_recta_usuario_a_ruta, 0) if distancia_recta_usuario_a_ruta is not None else None,
        'posicion_bus': {
            'lat': ultima.latitud,
            'lng': ultima.longitud,
            'idx': idx_bus,
        },
        'posicion_destino': {
            'lat': lat_dest,
            'lng': lng_dest,
            'idx': idx_destino,
        },
        'posicion_usuario': {
            'lat': lat_usuario,
            'lng': lng_usuario,
        } if tiene_ubicacion else None,
    })


def calcular_distancia_metros(lat1, lng1, lat2, lng2):
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


@csrf_exempt
def registrar_token_notificaciones(request):
    """
    Endpoint para que las apps Flutter registren su token FCM.
    POST /api/registrar-token/
    Body: {"token": "el_token_de_firebase", "tipo_app": "mapa" | "conductor",
           "plataforma": "android" | "ios"}
    Solo los dispositivos "mapa" reciben las alertas; los del conductor se aceptan pero no se notifican.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        data = _json_objeto(request)
        token = data.get('token')
        tipo_app = data.get('tipo_app', 'mapa')
        plataforma = data.get('plataforma', 'android')

        if not token or not isinstance(token, str):
            return JsonResponse({'error': 'Token requerido'}, status=400)
        if tipo_app not in ('mapa', 'conductor'):
            return JsonResponse({'error': 'tipo_app debe ser "mapa" o "conductor"'}, status=400)
        if plataforma not in ('android', 'ios'):
            return JsonResponse({'error': 'plataforma debe ser "android" o "ios"'}, status=400)

        # Guardamos o actualizamos el dispositivo
        # Usamos el campo 'name' de FCMDevice para guardar el tipo de app
        device, created = FCMDevice.objects.update_or_create(
            registration_id=token,
            defaults={
                'type': plataforma,
                'name': tipo_app,
                'active': True,
            }
        )
        
        return JsonResponse({
            'status': 'ok',
            'created': created,
            'message': 'Token registrado correctamente'
        })
    except Exception as e:
        return _respuesta_error(e)