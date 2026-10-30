from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus, Turno
from datetime import time, datetime
from .models import ConfiguracionBus
from .permisos import admin_empresa_required, empresa_del_usuario
from django.contrib.auth import views as auth_views, logout as auth_logout
from django.db.models import ProtectedError
import json
import traceback
from django.contrib import messages
import random
from datetime import datetime, timedelta
from django.core.mail import send_mail
from django.utils import timezone
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
from django.http import HttpResponse
from .utils.reportes import crear_reporte
from reportlab.lib.units import cm
import math
from fcm_django.models import FCMDevice
from django.db import IntegrityError

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
    """True si ruta_id es un ID numérico de una ruta existente."""
    return str(ruta_id or '').isdigit() and Ruta.objects.filter(id_ruta=ruta_id).exists()


def _buscar(modelo, **filtros):
    """Devuelve el objeto o None si no existe o el ID no es válido (en vez de error 500)."""
    try:
        return modelo.objects.filter(**filtros).first()
    except (ValueError, TypeError):
        return None

# ================= HOME =================

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')[:15]
    rutas = Ruta.objects.all().order_by('codigo')

    rutas_json = []
    for ruta in rutas:
        ruta_data = {
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'distancia_km': ruta.distancia_km,
            'estado': ruta.estado,
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
        'rutas_json': json.dumps(rutas_json),
        'usuario_id': usuario_id,
        'usuario_nombre': usuario_nombre,
        'usuario_perfil': usuario_perfil,
    })

# ================= LOGIN / REGISTRO (WEB) =================

def login(request):
    if request.method == 'POST':
        identificador = request.POST.get('email', '').strip()
        contrasena = request.POST.get('password', '')

        usuario = None
        try:
            usuario = Usuario.objects.get(email__iexact=identificador)
        except Usuario.DoesNotExist:
            try:
                usuario = Usuario.objects.get(nickName__iexact=identificador)
            except Usuario.DoesNotExist:
                usuario = None

        if usuario is None:
            return render(request, 'core/login.html', {
                'error': 'El correo o nombre de usuario no está registrado.',
                'email': identificador
            })

        if usuario.contrasena != contrasena:
            return render(request, 'core/login.html', {
                'error': 'La contraseña es incorrecta.',
                'email': identificador
            })

        request.session['usuario_id'] = usuario.id_usuario
        request.session['usuario_nombre'] = usuario.nombre

        messages.success(
            request,
            f'¡Bienvenido, {usuario.nombre}! Inicio de sesión exitoso.'
        )

        return redirect('/')

    return render(request, 'core/login.html')


def logout(request):
    request.session.flush()
    messages.success(request, 'Sesión cerrada correctamente. ¡Hasta pronto!')
    return redirect('/')


def registro(request):
    if request.method == 'POST':
        nombre = request.POST.get('first_name')
        apellido = request.POST.get('last_name')
        email = request.POST.get('email')
        nickName = request.POST.get('username')
        contrasena = request.POST.get('password')
        contrasena2 = request.POST.get('password2')
        telefono = (request.POST.get('telefono') or '').strip() or None

        if not all([nombre, apellido, email, nickName, contrasena]):
            return render(request, 'core/registro.html', {
                'error': 'Completa todos los campos obligatorios.'
            })

        if contrasena != contrasena2:
            return render(request, 'core/registro.html', {
                'error': 'Las contraseñas no coinciden.'
            })

        if Usuario.objects.filter(email=email).exists():
            return render(request, 'core/registro.html', {
                'error': 'El correo electrónico ya está registrado.'
            })

        if Usuario.objects.filter(nickName=nickName).exists():
            return render(request, 'core/registro.html', {
                'error': 'El nombre de usuario ya está registrado.'
            })

        if telefono:
            if not telefono.isdigit() or not 7 <= len(telefono) <= 15:
                return render(request, 'core/registro.html', {
                    'error': 'El teléfono debe contener solo números (entre 7 y 15 dígitos).'
                })
            if Usuario.objects.filter(telefono=telefono).exists():
                return render(request, 'core/registro.html', {
                    'error': 'El teléfono ya está registrado.'
                })

        codigo = str(random.randint(100000, 999999))

        request.session['registro_pendiente'] = {
            'nombre': f'{nombre.strip()} {apellido.strip()}',
            'email': email,
            'nickName': nickName,
            'contrasena': contrasena,
            'telefono': telefono,
            'codigo': codigo,
            'expira': (timezone.now() + timedelta(minutes=15)).isoformat(),
        }

        try:
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
        except Exception as e:
            return render(request, 'core/registro.html', {
                'error': f'Error al enviar el correo: {str(e)}'
            })

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

        if codigo_ingresado != codigo_correcto:
            return render(request, 'core/verificar_registro.html', {
                'email': datos.get('email'),
                'error': 'Código incorrecto. Inténtalo de nuevo.'
            })

        try:
            Usuario.objects.create(
                nombre=datos.get('nombre'),
                email=datos.get('email'),
                nickName=datos.get('nickName'),
                contrasena=datos.get('contrasena'),
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

@csrf_exempt
def verificar_email(request):
    if request.method == 'POST':
        email = request.POST.get('email', '').strip().lower()
        if not email:
            return JsonResponse({'existe': False})
        existe = Usuario.objects.filter(email__iexact=email).exists()
        return JsonResponse({'existe': existe})
    return JsonResponse({'existe': False})


@csrf_exempt
def verificar_nickname(request):
    if request.method == 'POST':
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

def alertas(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')
    rutas = Ruta.objects.all().order_by('nombre')
    total_alertas_delay = Alerta.objects.filter(tipo="delay").count()
    total_alertas_bus_arriving = alertas.filter(tipo="bus-arriving").count()
    total_alertas_warning = alertas.filter(tipo="warning").count()
    total_alertas_info = alertas.filter(tipo="info").count()

    return render(request, 'core/alertas.html', {
        'alertas': alertas,
        'rutas': rutas,
        'total_alertas_delay': total_alertas_delay,
        'total_alertas_bus_arriving': total_alertas_bus_arriving,
        'total_alertas_warning': total_alertas_warning,
        'total_alertas_info': total_alertas_info
    })


def crearAlerta(request):
    if request.method == 'POST':
        usuario_id = request.session.get('usuario_id')
        if not usuario_id:
            return redirect('/login/')

        ruta_id = request.POST.get('ruta')
        tipo = request.POST.get('tipo')
        descripcion = (request.POST.get('descripcion') or '').strip()

        if not _ruta_valida(ruta_id):
            messages.error(request, 'Selecciona una ruta válida para la alerta.')
            return redirect('/alertas/')
        if not tipo or not descripcion:
            messages.error(request, 'El tipo y la descripción de la alerta son obligatorios.')
            return redirect('/alertas/')

        Alerta.objects.create(
            usuario_id=usuario_id,
            ruta_id=ruta_id,
            tipo=tipo,
            descripcion=descripcion,
            estado=request.POST.get('estado') or 'Pendiente'
        )
    return redirect('/alertas/')


def editarAlerta(request, id_alerta):
    if request.method == 'POST':
        alerta = _buscar(Alerta, id_alerta=id_alerta)
        if alerta is None:
            messages.error(request, 'La alerta que intentas editar no existe.')
            return redirect('/alertas/')

        ruta_id = request.POST.get('ruta')
        tipo = request.POST.get('tipo')
        descripcion = (request.POST.get('descripcion') or '').strip()

        if not _ruta_valida(ruta_id):
            messages.error(request, 'Selecciona una ruta válida para la alerta.')
            return redirect('/alertas/')
        if not tipo or not descripcion:
            messages.error(request, 'El tipo y la descripción de la alerta son obligatorios.')
            return redirect('/alertas/')

        alerta.ruta_id = ruta_id
        alerta.tipo = tipo
        alerta.descripcion = descripcion
        alerta.estado = request.POST.get('estado') or alerta.estado
        alerta.save()
    return redirect('/alertas/')


def eliminarAlerta(request, id_alerta):
    if request.method == 'POST':
        alerta = _buscar(Alerta, id_alerta=id_alerta)
        if alerta is None:
            messages.error(request, 'La alerta que intentas eliminar no existe.')
        else:
            alerta.delete()
    return redirect('/alertas/')


# ================= RUTAS =================

def rutas(request):
    # Los pasajeros ven todas las rutas; el administrador ve y edita solo las de su empresa
    empresa = empresa_del_usuario(request)
    rutas = Ruta.objects.filter(empresa=empresa) if empresa else Ruta.objects.all()
    rutas = rutas.select_related('empresa').order_by('id_ruta')

    rutas_json = []
    for ruta in rutas:
        ruta_data = {
            'id': ruta.id_ruta,
            'codigo': ruta.codigo,
            'nombre': ruta.nombre,
            'origen': ruta.origen,
            'destino': ruta.destino,
            'distancia_km': ruta.distancia_km,
            'duracion_estimada_minutos': ruta.duracion_estimada_minutos,
            'estado': ruta.estado,
            'coordenadas': ruta.get_coordenadas_ruta(),
            'paradas': ruta.get_paradas_coordenadas()
        }
        rutas_json.append(ruta_data)

    return render(request, "core/rutas.html", {
        'rutas': rutas,
        'rutas_json': json.dumps(rutas_json),
        'puede_editar': empresa is not None,
    })


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
        if not codigo or not (request.POST.get('nombre') or '').strip():
            messages.error(request, 'El nombre y el código de la ruta son obligatorios.')
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
                origen=request.POST.get('origen', ''),
                destino=request.POST.get('destino', ''),
                distancia_km=distancia_km,
                duracion_estimada_minutos=duracion_minutos,
                frecuencia_minutos=frecuencia_minutos,
                estado=request.POST.get('estado') or 'Activa',
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
        if request.empresa.rutas.filter(codigo__iexact=codigo).exclude(id_ruta=ruta.id_ruta).exists():
            messages.error(request, f'Ya existe otra ruta con el código {codigo}.')
            return redirect('/rutas/')

        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')

        ruta.nombre = request.POST.get('nombre', ruta.nombre)
        ruta.codigo = codigo
        ruta.origen = request.POST.get('origen', ruta.origen)
        ruta.destino = request.POST.get('destino', ruta.destino)
        ruta.distancia_km = distancia_km
        ruta.duracion_estimada_minutos = duracion_minutos
        ruta.frecuencia_minutos = frecuencia_minutos
        ruta.estado = request.POST.get('estado', ruta.estado)

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
        return redirect("/rutas/")

    return redirect("/rutas/")


@admin_empresa_required
def eliminarRuta(request, id_ruta):
    ruta = _buscar(Ruta, id_ruta=id_ruta, empresa=request.empresa)
    if ruta is None:
        messages.error(request, 'La ruta que intentas eliminar no existe.')
    else:
        try:
            ruta.delete()
        except ProtectedError:
            messages.error(request, f'La ruta {ruta.codigo} tiene turnos registrados y no se puede eliminar. '
                                    f'Cámbiala a Inactiva o Fuera de servicio.')
    return redirect('/rutas/')
# ================= VERIFICAR CÓDIGO DE RUTA (AJAX) =================

@csrf_exempt
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


@admin_empresa_required
def conductores(request):
    conductores = request.empresa.conductores.all()
    turnos = _turnos_vigentes_por('conductor_id', request.empresa)
    for conductor in conductores:
        conductor.turno = turnos.get(conductor.id_conductor)
    rutas = request.empresa.rutas.order_by("nombre")
    return render(request, 'core/conductores.html',
                  {'conductores': conductores, 'rutas': rutas})


def _validar_conductor(datos, conductor_id=None):
    """Valida los datos del formulario de conductor. Devuelve un mensaje de error o None."""
    if not all([datos['nombre'], datos['cedula'], datos['telefono'], datos['email']]):
        return 'Nombre, cédula, teléfono y correo son obligatorios.'

    otros = Conductor.objects.exclude(id_conductor=conductor_id) if conductor_id else Conductor.objects.all()
    if otros.filter(cedula=datos['cedula']).exists():
        return f'Ya existe un conductor con la cédula {datos["cedula"]}.'
    if otros.filter(email__iexact=datos['email']).exists():
        return f'Ya existe un conductor con el correo {datos["email"]}.'
    return None


def _datos_conductor(request):
    return {
        'nombre': (request.POST.get('nombre') or '').strip(),
        'cedula': (request.POST.get('cedula') or '').strip(),
        'telefono': (request.POST.get('telefono') or '').strip(),
        'email': (request.POST.get('email') or '').strip(),
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

    try:
        Conductor.objects.create(
            empresa=request.empresa,
            nombre=datos['nombre'],
            cedula=datos['cedula'],
            telefono=datos['telefono'],
            email=datos['email'],
            contrasena=datos['contrasena'],
        )
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
        conductor.contrasena = datos['contrasena']
    try:
        conductor.save()
    except IntegrityError:
        messages.error(request, 'Ya existe un conductor con esa cédula o correo.')
    return redirect('/conductores/')


@admin_empresa_required
def eliminarConductor(request, id_conductor):
    conductor = _buscar(Conductor, id_conductor=id_conductor, empresa=request.empresa)
    if conductor is None:
        messages.error(request, 'El conductor que intentas eliminar no existe.')
    else:
        try:
            conductor.delete()
        except ProtectedError:
            messages.error(request, f'{conductor.nombre} tiene turnos registrados (historial) y no se puede eliminar.')
    return redirect('/conductores/')
# ================= VERIFICAR CÉDULA (AJAX) =================

@csrf_exempt
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

@csrf_exempt
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

@csrf_exempt
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

@admin_empresa_required
def buses(request):
    buses = request.empresa.buses.prefetch_related('rutas').order_by('placa')
    turnos = _turnos_vigentes_por('bus_id', request.empresa)
    for bus in buses:
        bus.turno = turnos.get(bus.id_bus)
    rutas = request.empresa.rutas.order_by('nombre')
    return render(request, 'core/buses.html', {'buses': buses, 'rutas': rutas})


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
    if rutas is None:
        return 'Alguna de las rutas seleccionadas no existe.'
    if not rutas:
        return 'Selecciona al menos una ruta que pueda cubrir el bus.'
    otros = Bus.objects.exclude(id_bus=bus.id_bus) if bus else Bus.objects.all()
    if otros.filter(placa__iexact=placa).exists():
        return f'Ya existe un bus con la placa {placa}.'
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
def EliminarBus(request):
    if request.method == 'POST':
        bus = _buscar(Bus, id_bus=request.POST.get('id_bus'), empresa=request.empresa)
        if bus is None:
            messages.error(request, 'El bus que intentas eliminar no existe.')
        else:
            try:
                bus.delete()
            except ProtectedError:
                messages.error(request, f'El bus {bus.placa} tiene turnos registrados (historial) y no se puede eliminar.')
    return redirect('/buses/')


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


@admin_empresa_required
def turnos(request):
    """Turnos que se cruzan con el día elegido (por defecto hoy), incluidos los nocturnos y los fijos."""
    try:
        dia = datetime.strptime(request.GET.get('fecha', ''), '%Y-%m-%d').date()
    except ValueError:
        dia = timezone.localdate()
    inicio_dia = timezone.make_aware(datetime.combine(dia, time.min))

    turnos_dia = (Turno.que_se_cruzan(inicio_dia, inicio_dia + timedelta(days=1))
                  .filter(bus__empresa=request.empresa)
                  .select_related('conductor', 'bus', 'ruta')
                  .order_by('inicio', 'bus__placa'))

    return render(request, 'core/turnos.html', {
        'turnos': turnos_dia,
        'dia': dia,
        'dia_anterior': dia - timedelta(days=1),
        'dia_siguiente': dia + timedelta(days=1),
        'conductores': request.empresa.conductores.order_by('nombre'),
        'buses': request.empresa.buses.prefetch_related('rutas').order_by('placa'),
        'rutas': request.empresa.rutas.exclude(estado='Fuera_servicio').order_by('codigo'),
        'dias_semana': ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    })


@admin_empresa_required
def crearTurno(request):
    """Programa turnos para un rango de días con el mismo horario.

    Si la hora de fin es menor o igual a la de inicio, el turno termina al día siguiente (nocturno).
    Con "asignación fija" se crea un solo turno sin fin.
    """
    destino = f"/turnos/?fecha={request.POST.get('desde', '')}"
    if request.method != 'POST':
        return redirect('/turnos/')

    conductor, bus, ruta = _recursos_del_turno(request)
    if not (conductor and bus and ruta):
        messages.error(request, 'Selecciona un conductor, un bus y una ruta de tu empresa.')
        return redirect(destino)

    desde = request.POST.get('desde')
    hora_inicio = request.POST.get('hora_inicio')

    if request.POST.get('fijo'):
        inicio = _fecha_hora(desde, hora_inicio)
        if inicio is None:
            messages.error(request, 'Indica una fecha y hora de inicio válidas.')
            return redirect(destino)
        periodos = [(inicio, None)]
    else:
        hasta = request.POST.get('hasta') or desde
        hora_fin = request.POST.get('hora_fin')
        primero, ultimo = _fecha_hora(desde, hora_inicio), _fecha_hora(hasta, hora_inicio)
        fin_primero = _fecha_hora(desde, hora_fin)
        if None in (primero, ultimo, fin_primero):
            messages.error(request, 'Indica fechas y horas válidas para el turno.')
            return redirect(destino)
        if ultimo < primero:
            messages.error(request, 'La fecha final no puede ser anterior a la inicial.')
            return redirect(destino)
        if (ultimo.date() - primero.date()).days > 62:
            messages.error(request, 'Puedes programar como máximo 2 meses a la vez.')
            return redirect(destino)

        duracion = fin_primero - primero
        if duracion <= timedelta(0):
            duracion += timedelta(days=1)  # turno nocturno: termina al día siguiente

        dias_semana = {int(d) for d in request.POST.getlist('dias') if d.isdigit()}
        periodos = []
        dia = primero.date()
        while dia <= ultimo.date():
            if not dias_semana or dia.weekday() in dias_semana:
                inicio = _fecha_hora(dia.isoformat(), hora_inicio)
                periodos.append((inicio, inicio + duracion))
            dia += timedelta(days=1)
        if not periodos:
            messages.error(request, 'Ningún día del rango coincide con los días de la semana elegidos.')
            return redirect(destino)

    # Se validan todos antes de guardar: o se crean todos o ninguno
    nuevos = []
    for inicio, fin in periodos:
        # Los periodos generados duran como máximo 24 h y empiezan en días distintos: no se cruzan entre sí
        turno = Turno(conductor=conductor, bus=bus, ruta=ruta, inicio=inicio, fin=fin)
        error = turno.validar()
        if error:
            messages.error(request, f'No se programó ningún turno. {timezone.localtime(inicio):%d/%m/%Y}: {error}')
            return redirect(destino)
        nuevos.append(turno)

    Turno.objects.bulk_create(nuevos)
    messages.success(request, f'Se programaron {len(nuevos)} turno(s) para {conductor.nombre} en el bus {bus.placa}.')
    return redirect(destino)


@admin_empresa_required
def finalizarTurno(request, id_turno):
    """Termina ahora un turno en curso (por ejemplo una asignación fija)."""
    turno = _buscar(Turno, id_turno=id_turno, bus__empresa=request.empresa)
    if request.method == 'POST' and turno:
        if turno.estado != 'En curso':
            messages.error(request, 'Solo se puede finalizar un turno en curso.')
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

class LoginEmpresa(auth_views.LoginView):
    template_name = 'core/login_empresa.html'


def logout_empresa(request):
    auth_logout(request)
    messages.success(request, 'Sesión de empresa cerrada.')
    return redirect('/')

# ================= VERIFICAR PLACA DE BUS (AJAX) =================

@csrf_exempt
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
    return render(request, 'core/acerca_de.html')


# =========================================================
# ================= API PARA APP MÓVIL =================
# =========================================================

@csrf_exempt
def login_conductor(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        cedula = data.get('cedula')

        if not cedula:
            return JsonResponse({'error': 'Cédula requerida'}, status=400)

        try:
            conductor = Conductor.objects.select_related('empresa').get(cedula=cedula)
        except Conductor.DoesNotExist:
            return JsonResponse({'error': 'Cédula no registrada'}, status=404)

        turno = conductor.turno_actual()
        if turno is None:
            proximo = conductor.turnos.filter(inicio__gt=timezone.now()).select_related('bus').order_by('inicio').first()
            mensaje = 'No tienes un turno asignado en este momento.'
            if proximo:
                mensaje += f' Tu próximo turno: {timezone.localtime(proximo.inicio):%d/%m %H:%M} en el bus {proximo.bus.placa}.'
            return JsonResponse({'error': mensaje}, status=409)

        bus = turno.bus
        return JsonResponse({
            'status': 'ok',
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
                'fin': turno.fin.isoformat() if turno.fin else None,
            }
        })

    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def activar_bus(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        conductor_id = data.get('conductor_id')

        if not conductor_id:
            return JsonResponse({'error': 'Conductor ID requerido'}, status=400)

        conductor = Conductor.objects.get(id_conductor=conductor_id)

        bus = conductor.bus_asignado
        if bus is None:
            return JsonResponse({'error': 'No tienes un turno asignado en este momento'}, status=404)

        bus.activo = True
        bus.save()

        return JsonResponse({
            'status': 'ok',
            'message': f'Bus {bus.placa} activado correctamente',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'activo': True
        })

    except Conductor.DoesNotExist:
        return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def desactivar_bus(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        conductor_id = data.get('conductor_id')

        if not conductor_id:
            return JsonResponse({'error': 'Conductor ID requerido'}, status=400)

        conductor = Conductor.objects.get(id_conductor=conductor_id)

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

    except Conductor.DoesNotExist:
        return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def enviar_ubicacion(request):
    print("=" * 60)
    print("📍 RECIBIENDO UBICACIÓN...")

    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        print(f"📦 Datos recibidos: {data}")

        conductor_id = data.get('conductor_id')
        latitud = data.get('latitud')
        longitud = data.get('longitud')
        velocidad = data.get('velocidad', 0)

        if not all([conductor_id, latitud, longitud]):
            return JsonResponse({'error': 'Faltan datos obligatorios'}, status=400)

        try:
            conductor = Conductor.objects.get(id_conductor=conductor_id)
        except Conductor.DoesNotExist:
            return JsonResponse({'error': 'Conductor no encontrado'}, status=404)

        turno = conductor.turno_actual()
        if turno is None:
            return JsonResponse({'error': 'Tu turno terminó o no tienes un turno asignado en este momento'}, status=409)
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
            latitud=float(latitud),
            longitud=float(longitud),
            velocidad=float(velocidad or 0)
        )

        bus.ultima_ubicacion = timezone.now()
        bus.save(update_fields=['ultima_ubicacion'])

        return JsonResponse({
            'status': 'ok',
            'message': 'Ubicación guardada',
            'ubicacion_id': ubicacion.id,
            'timestamp': timezone.now().isoformat()
        })

    except json.JSONDecodeError as e:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


def verificar_estado_ubicacion(request, conductor_id):
    try:
        conductor = Conductor.objects.get(id_conductor=conductor_id)
        turno = conductor.turno_actual()
        if turno is None:
            return JsonResponse({'error': 'No tienes un turno asignado en este momento'}, status=404)
        bus = turno.bus

        return JsonResponse({
            'conductor_id': conductor.id_conductor,
            'conductor_nombre': conductor.nombre,
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'ruta': turno.ruta.nombre,
            'turno_fin': turno.fin.isoformat() if turno.fin else None,
            'activo': bus.activo,
            'ultima_ubicacion': bus.ultima_ubicacion.isoformat() if bus.ultima_ubicacion else None
        })

    except Conductor.DoesNotExist:
        return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


def obtener_ubicaciones(request):
    # Último punto de cada bus activo en una sola consulta (DISTINCT ON de PostgreSQL)
    ultimas = (UbicacionBus.objects.filter(bus__activo=True)
               .select_related('bus__empresa', 'ruta', 'conductor')
               .order_by('bus_id', '-timestamp').distinct('bus_id'))
    # Los puntos simulados no traen conductor: se muestra el del turno vigente, si hay
    conductores_turno = {t.bus_id: t.conductor.nombre
                         for t in Turno.vigentes().filter(bus__activo=True).select_related('conductor')}
    ubicaciones = []

    for ultima_ubicacion in ultimas:
        bus = ultima_ubicacion.bus
        # La ruta y el conductor salen del último punto registrado: es lo que el bus está haciendo
        ubicaciones.append({
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'empresa': bus.empresa.nombre,
            'ruta': ultima_ubicacion.ruta.nombre,
            'ruta_id': ultima_ubicacion.ruta_id,
            'conductor': (ultima_ubicacion.conductor.nombre if ultima_ubicacion.conductor
                          else conductores_turno.get(bus.id_bus)),
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
        try:
            usuario = Usuario.objects.get(email__iexact=email)
        except Usuario.DoesNotExist:
            messages.success(request, 'Si el correo está registrado, recibirás un código.')
            return render(request, 'core/recuperacion.html')

        codigo = str(random.randint(100000, 999999))
        usuario.codigo_recuperacion = codigo
        usuario.codigo_expiracion = timezone.now() + timedelta(minutes=15)
        usuario.save()

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
        except Exception as e:
            messages.error(request, f'Error al enviar el correo: {str(e)}')
            return redirect('/solicitar_recuperacion/')

        request.session['email_recuperacion'] = usuario.email
        return redirect('/verificar_codigo/')

    return render(request, 'core/recuperacion.html')


def verificar_codigo(request):
    email = request.session.get('email_recuperacion')
    if not email:
        return redirect('/solicitar_recuperacion/')

    if request.method == 'POST':
        codigo_ingresado = request.POST.get('codigo', '').strip()
        try:
            usuario = Usuario.objects.get(email__iexact=email)
            if usuario.codigo_recuperacion == codigo_ingresado and usuario.codigo_expiracion > timezone.now():
                request.session['codigo_validado'] = True
                return redirect('/nueva_contrasena/')
            else:
                messages.error(request, 'Código incorrecto o expirado.')
        except Usuario.DoesNotExist:
            messages.error(request, 'Error al validar el usuario.')

    return render(request, 'core/verificar_codigo.html')


def nueva_contrasena(request):
    if not request.session.get('codigo_validado'):
        return redirect('/solicitar_recuperacion/')

    if request.method == 'POST':
        pass1 = request.POST.get('password1')
        pass2 = request.POST.get('password2')

        if pass1 and pass1 == pass2:
            email = request.session.get('email_recuperacion')
            usuario = Usuario.objects.get(email__iexact=email)
            usuario.contrasena = pass1
            usuario.codigo_recuperacion = None
            usuario.codigo_expiracion = None
            usuario.save()

            del request.session['email_recuperacion']
            del request.session['codigo_validado']

            messages.success(request, 'Contraseña actualizada. Ya puedes iniciar sesión.')
            return redirect('/login/')
        else:
            messages.error(request, 'Las contraseñas no coinciden.')

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

            if usuario.contrasena != contrasena_actual:
                messages.error(request, 'La contraseña actual es incorrecta.')
            elif contrasena_nueva != contrasena_confirmar:
                messages.error(request, 'Las contraseñas nuevas no coinciden.')
            elif len(contrasena_nueva) < 8:
                messages.error(request, 'La contraseña debe tener al menos 8 caracteres.')
            else:
                usuario.contrasena = contrasena_nueva
                usuario.save()
                messages.success(request, 'Contraseña actualizada correctamente.')

            return redirect('/')

        nombre = request.POST.get('nombre', '').strip()
        email = request.POST.get('email', '').strip()
        nickName = request.POST.get('nickName', '').strip()
        telefono = request.POST.get('telefono', '').strip()
        color_perfil = request.POST.get('color_perfil', '').strip()

        if not nombre or not email or not nickName:
            messages.error(request, 'Nombre, correo y nombre de usuario son obligatorios.')
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

        usuario.nombre = nombre
        usuario.email = email
        usuario.nickName = nickName
        usuario.telefono = telefono if telefono else None

        if color_perfil:
            usuario.color_perfil = color_perfil

        usuario.save()

        request.session['usuario_nombre'] = usuario.nombre

        messages.success(request, 'Perfil actualizado correctamente.')
        return redirect('/')

    return redirect('/')
# ================= VERIFICAR EMAIL AL EDITAR PERFIL (AJAX) =================

@csrf_exempt
def verificar_email_perfil(request):
    """Verifica si un email ya existe (excluyendo al usuario actual)"""
    if request.method == 'POST':
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

@csrf_exempt
def verificar_nickname_perfil(request):
    """Verifica si un nickname ya existe (excluyendo al usuario actual)"""
    if request.method == 'POST':
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

@csrf_exempt
def verificar_telefono_perfil(request):
    """Verifica si un teléfono ya existe (excluyendo al usuario actual)"""
    if request.method == 'POST':
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

@csrf_exempt
def verificar_telefono(request):
    """Verifica si un teléfono ya está registrado"""
    if request.method == 'POST':
        telefono = request.POST.get('telefono', '').strip()
        
        if not telefono:
            return JsonResponse({'existe': False})
        
        existe = Usuario.objects.filter(telefono=telefono).exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})


def api_rutas(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    rutas = Ruta.objects.all().order_by('codigo')
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
            'estado': ruta.estado,
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

    alertas = Alerta.objects.select_related('ruta', 'usuario').all().order_by('-fecha_creacion')[:50]
    data = []

    for alerta in alertas:
        data.append({
            'id': alerta.id_alerta,
            'tipo': alerta.tipo,
            'descripcion': alerta.descripcion,
            'estado': alerta.estado,
            'ruta': alerta.ruta.nombre,
            'ruta_id': alerta.ruta.id_ruta,
            'usuario': alerta.usuario.nickName,
            'fecha': alerta.fecha_creacion.isoformat()
        })

    return JsonResponse({
        'count': len(data),
        'alertas': data
    })


# ================= REPORTES =================

@admin_empresa_required
def reporte_rutas(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_rutas.pdf"'

    rutas = request.empresa.rutas.order_by('codigo')

    encabezados = ['Código', 'Nombre', 'Origen', 'Destino', 'Distancia', 'Duración', 'Estado']
    datos = []

    for ruta in rutas:
        datos.append([
            ruta.codigo,
            ruta.nombre[:25],
            ruta.origen[:20],
            ruta.destino[:20],
            f"{ruta.distancia_km} km",
            f"{ruta.duracion_estimada_minutos} min",
            ruta.estado,
        ])

    descripcion = (
        f"Este reporte muestra el listado completo de rutas registradas en el sistema LocalBus. "
        f"Se incluyen datos como el código único de cada ruta, nombre descriptivo, origen y destino, "
        f"distancia en kilómetros, duración estimada del recorrido y el estado actual de la ruta. "
        f"Actualmente el sistema cuenta con {rutas.count()} rutas registradas."
    )

    anchos = [1.8 * cm, 3.5 * cm, 3.2 * cm, 3.2 * cm, 1.8 * cm, 1.8 * cm, 1.7 * cm]

    return crear_reporte(response, "REPORTE DE RUTAS", encabezados, datos,
                         rutas.count(), descripcion, anchos)


@admin_empresa_required
def reporte_buses(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_buses.pdf"'

    buses = request.empresa.buses.prefetch_related('rutas').order_by('placa')
    turnos = _turnos_vigentes_por('bus_id', request.empresa)

    encabezados = ['ID', 'Placa', 'Rutas', 'Conductor ahora', 'Estado', 'Última Actualización']
    datos = []

    for bus in buses:
        estado = "Activo" if bus.activo else "Inactivo"
        ultima = (timezone.localtime(bus.ultima_ubicacion).strftime('%d/%m/%Y %H:%M')
                  if bus.ultima_ubicacion else "Sin registro")
        turno = turnos.get(bus.id_bus)
        datos.append([
            str(bus.id_bus),
            bus.placa,
            ', '.join(r.codigo for r in bus.rutas.all())[:22] or "Sin rutas",
            turno.conductor.nombre[:22] if turno else "Sin turno",
            estado,
            ultima,
        ])

    activos = buses.filter(activo=True).count()
    descripcion = (
        f"Este reporte muestra el inventario completo de buses del sistema LocalBus. "
        f"Se incluye la placa de cada bus, las rutas que puede cubrir, el conductor del turno en curso, su estado actual (activo/inactivo) "
        f"y la última vez que se registró una ubicación. Actualmente hay {buses.count()} buses "
        f"registrados, de los cuales {activos} están activos en este momento."
    )

    anchos = [1.2 * cm, 2.2 * cm, 3.8 * cm, 3.8 * cm, 2 * cm, 3.5 * cm]

    return crear_reporte(response, "REPORTE DE BUSES", encabezados, datos,
                         buses.count(), descripcion, anchos)


@admin_empresa_required
def reporte_conductores(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_conductores.pdf"'

    conductores = request.empresa.conductores.order_by('nombre')
    turnos = _turnos_vigentes_por('conductor_id', request.empresa)

    encabezados = ['ID', 'Nombre', 'Cédula', 'Teléfono', 'Email', 'Bus', 'Ruta']
    datos = []

    for c in conductores:
        turno = turnos.get(c.id_conductor)
        datos.append([
            str(c.id_conductor),
            c.nombre[:22],
            c.cedula,
            c.telefono,
            c.email[:22],
            turno.bus.placa if turno else "Sin turno",
            turno.ruta.codigo[:15] if turno else "-",
        ])

    descripcion = (
        f"Este reporte presenta el listado completo de conductores de {request.empresa.nombre}. "
        f"Se incluyen datos personales como nombre completo, número de cédula, teléfono de contacto, "
        f"correo electrónico, y el bus y la ruta del turno que cubre en este momento. Actualmente "
        f"la empresa cuenta con {conductores.count()} conductores registrados."
    )

    anchos = [1 * cm, 3.2 * cm, 2.2 * cm, 2.2 * cm, 3.6 * cm, 1.8 * cm, 2.5 * cm]

    return crear_reporte(response, "REPORTE DE CONDUCTORES", encabezados, datos,
                         conductores.count(), descripcion, anchos)


@admin_empresa_required
def reporte_alertas(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_alertas.pdf"'

    # Alertas que los pasajeros reportaron sobre las rutas de la empresa
    alertas = (Alerta.objects.filter(ruta__empresa=request.empresa)
               .select_related('ruta', 'usuario').order_by('-fecha_creacion'))

    encabezados = ['ID', 'Tipo', 'Ruta', 'Descripción', 'Usuario', 'Fecha']
    datos = []

    for a in alertas[:100]:
        datos.append([
            str(a.id_alerta),
            a.tipo.upper()[:15],
            a.ruta.nombre[:20] if a.ruta else "Sin ruta",
            a.descripcion[:40],
            a.usuario.nickName if a.usuario else "Anónimo",
            a.fecha_creacion.strftime('%d/%m/%Y'),
        ])

    descripcion = (
        f"Este reporte muestra las últimas alertas registradas en el sistema LocalBus. "
        f"Cada alerta incluye su tipo (demora, advertencia, información), la ruta afectada, "
        f"una descripción del evento, el usuario que la reportó y la fecha de creación. "
        f"Se muestran las {min(alertas.count(), 100)} alertas más recientes."
    )

    anchos = [1.2 * cm, 2 * cm, 2.5 * cm, 5 * cm, 2.5 * cm, 2.3 * cm]

    return crear_reporte(response, "REPORTE DE ALERTAS", encabezados, datos,
                         alertas.count(), descripcion, anchos)


@admin_empresa_required
def reporte_turnos(request):
    """Historial de turnos: en qué bus y ruta estuvo cada conductor entre dos fechas (por defecto, últimos 7 días)."""
    hoy = timezone.localdate()
    try:
        desde = datetime.strptime(request.GET.get('desde', ''), '%Y-%m-%d').date()
    except ValueError:
        desde = hoy - timedelta(days=6)
    try:
        hasta = datetime.strptime(request.GET.get('hasta', ''), '%Y-%m-%d').date()
    except ValueError:
        hasta = hoy

    inicio = timezone.make_aware(datetime.combine(desde, time.min))
    fin = timezone.make_aware(datetime.combine(hasta + timedelta(days=1), time.min))
    turnos_rango = (Turno.que_se_cruzan(inicio, fin).filter(bus__empresa=request.empresa)
                    .select_related('conductor', 'bus', 'ruta').order_by('inicio', 'conductor__nombre'))

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="reporte_turnos_{desde}_{hasta}.pdf"'

    encabezados = ['Conductor', 'Cédula', 'Bus', 'Ruta', 'Inicio', 'Fin', 'Estado']
    datos = [[
        t.conductor.nombre[:22],
        t.conductor.cedula,
        t.bus.placa,
        t.ruta.codigo[:12],
        timezone.localtime(t.inicio).strftime('%d/%m/%Y %H:%M'),
        timezone.localtime(t.fin).strftime('%d/%m/%Y %H:%M') if t.fin else 'Indefinido',
        t.estado,
    ] for t in turnos_rango]

    descripcion = (
        f"Este reporte muestra los turnos de {request.empresa.nombre} entre el {desde:%d/%m/%Y} y el "
        f"{hasta:%d/%m/%Y}: qué conductor manejó cada bus, en qué ruta y en qué horario. Incluye los turnos "
        f"nocturnos que cruzan la medianoche y las asignaciones fijas vigentes en el periodo."
    )

    anchos = [3.4 * cm, 2.2 * cm, 1.8 * cm, 1.8 * cm, 2.8 * cm, 2.8 * cm, 2 * cm]

    return crear_reporte(response, "REPORTE DE TURNOS", encabezados, datos,
                         len(datos), descripcion, anchos)


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


@csrf_exempt
@admin_empresa_required
def api_configurar_simulacion(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        bus_id = data.get('bus_id')
        simulando = data.get('simulando')
        velocidad = data.get('velocidad_kmh')

        if not bus_id:
            return JsonResponse({'error': 'Bus ID requerido'}, status=400)

        try:
            bus = Bus.objects.get(id_bus=bus_id, empresa=request.empresa)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'Bus no encontrado'}, status=404)

        config, created = ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

        if simulando is not None:
            config.simulando = _a_bool(simulando)
        if velocidad is not None:
            config.velocidad_kmh = max(1.0, min(float(velocidad), 120.0))

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
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@admin_empresa_required
def api_estado_simulacion(request):
    configs = ConfiguracionBus.objects.filter(bus__empresa=request.empresa).select_related('bus')

    data = []
    for config in configs:
        ruta = config.bus.ruta_actual
        data.append({
            'bus_id': config.bus.id_bus,
            'placa': config.bus.placa,
            'ruta': ruta.nombre if ruta else None,
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
        lat = float(lat)
        lng = float(lng)

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
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


# ================= PANEL DE SIMULACIÓN =================

@admin_empresa_required
def panel_simulacion(request):
    buses = request.empresa.buses.order_by('placa')

    for bus in buses:
        ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

    configs = ConfiguracionBus.objects.filter(bus__empresa=request.empresa).select_related(
        'bus'
    ).order_by('bus__placa')

    total_buses = configs.count()
    simulando = configs.filter(simulando=True).count()
    detenidos = total_buses - simulando

    return render(request, 'core/panel_simulacion.html', {
        'configuraciones': configs,
        'total_buses': total_buses,
        'simulando': simulando,
        'detenidos': detenidos,
        'simulador_corriendo': _simulador_corriendo(request.empresa),
    })


@csrf_exempt
@admin_empresa_required
def toggle_simulacion(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        config = ConfiguracionBus.objects.get(bus_id=bus_id, bus__empresa=request.empresa)
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
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@admin_empresa_required
def cambiar_velocidad(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        velocidad = float(data.get('velocidad', 30))

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
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@admin_empresa_required
def toggle_todos(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        simulando = _a_bool(data.get('simulando', False))

        configs = ConfiguracionBus.objects.filter(bus__empresa=request.empresa)
        configs.update(simulando=simulando)
        if not simulando:
            _apagar_buses_simulados(list(request.empresa.buses.all()))

        return JsonResponse({
            'status': 'ok',
            'simulando': simulando,
            'count': configs.filter(simulando=simulando).count()
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
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
        return JsonResponse({'error': str(e)}, status=500)


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

    try:
        bus = Bus.objects.get(id_bus=bus_id)
    except Bus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)

    ultima = UbicacionBus.objects.filter(bus=bus).select_related('ruta').order_by('-timestamp').first()
    if not ultima:
        return JsonResponse({'error': 'Bus sin ubicación'}, status=404)

    # La ruta es la que el bus está recorriendo según su último punto (depende del turno)
    ruta = ultima.ruta
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
        'hora_llegada': hora_llegada.strftime('%H:%M'),
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
    Body: {"token": "el_token_de_firebase", "tipo_app": "mapa" | "conductor"}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        data = json.loads(request.body)
        token = data.get('token')
        tipo_app = data.get('tipo_app', 'mapa')
        
        if not token:
            return JsonResponse({'error': 'Token requerido'}, status=400)
        
        # Guardamos o actualizamos el dispositivo
        # Usamos el campo 'name' de FCMDevice para guardar el tipo de app
        device, created = FCMDevice.objects.update_or_create(
            registration_id=token,
            defaults={
                'type': 'android', # o 'ios' dependiendo del celular
                'name': tipo_app,
                'active': True,
            }
        )
        
        return JsonResponse({
            'status': 'ok',
            'created': created,
            'message': 'Token registrado correctamente'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)