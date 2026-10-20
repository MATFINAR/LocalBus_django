from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus
from datetime import time, datetime
from .models import ConfiguracionBus
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
        telefono = request.POST.get('telefono')

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

        codigo = str(random.randint(100000, 999999))

        request.session['registro_pendiente'] = {
            'nombre': nombre + ' ' + apellido,
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

        Usuario.objects.create(
            nombre=datos.get('nombre'),
            email=datos.get('email'),
            nickName=datos.get('nickName'),
            contrasena=datos.get('contrasena'),
            telefono=datos.get('telefono'),
        )

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

        Alerta.objects.create(
            usuario_id=usuario_id,
            ruta_id=request.POST.get('ruta'),
            tipo=request.POST.get('tipo'),
            descripcion=request.POST.get('descripcion'),
            estado=request.POST.get('estado')
        )
    return redirect('/alertas/')


def editarAlerta(request, id_alerta):
    if request.method == 'POST':
        alerta = Alerta.objects.get(id_alerta=id_alerta)
        alerta.ruta_id = request.POST.get('ruta')
        alerta.tipo = request.POST.get('tipo')
        alerta.descripcion = request.POST.get('descripcion')
        alerta.estado = request.POST.get('estado')
        alerta.save()
    return redirect('/alertas/')


def eliminarAlerta(request, id_alerta):
    if request.method == 'POST':
        alerta = Alerta.objects.get(id_alerta=id_alerta)
        alerta.delete()
    return redirect('/alertas/')


# ================= RUTAS =================

def rutas(request):
    rutas = Ruta.objects.all().order_by('id_ruta')

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
        'rutas_json': json.dumps(rutas_json)
    })


def crearRuta(request):
    if request.method == 'POST':
        duracion_minutos = int(request.POST.get('duracion_minutos', 0) or 0)
        frecuencia_minutos = int(request.POST.get('frecuencia_minutos', 0) or 0)

        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')
        distancia_km = float(request.POST.get('distancia_km', 0) or 0)

        ruta = Ruta.objects.create(
            nombre=request.POST.get('nombre', ''),
            codigo=request.POST.get('codigo', 'R-001'),
            origen=request.POST.get('origen', ''),
            destino=request.POST.get('destino', ''),
            distancia_km=distancia_km,
            duracion_estimada_minutos=duracion_minutos,
            frecuencia_minutos=frecuencia_minutos,
            estado=request.POST.get('estado', 'activa'),
        )

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



def editarRuta(request, id_ruta):
    if request.method == 'POST':
        ruta = Ruta.objects.get(id_ruta=id_ruta)

        duracion_minutos = int(request.POST.get('duracion_minutos', 0) or 0)
        frecuencia_minutos = int(request.POST.get('frecuencia_minutos', 0) or 0)

        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')
        distancia_km = float(request.POST.get('distancia_km', 0) or 0)

        ruta.nombre = request.POST.get('nombre', ruta.nombre)
        ruta.codigo = request.POST.get('codigo', ruta.codigo)
        ruta.origen = request.POST.get('origen', ruta.origen)
        ruta.destino = request.POST.get('destino', ruta.destino)
        ruta.distancia_km = distancia_km
        ruta.duracion_estimada_minutos = duracion_minutos
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


def eliminarRuta(request, id_ruta):
    ruta = Ruta.objects.get(id_ruta=id_ruta)
    ruta.delete()
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
        
        # Buscar si existe esa ruta
        query = Ruta.objects.filter(codigo__iexact=codigo)
        
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

def conductores(request):
    conductores = Conductor.objects.all()
    rutas = Ruta.objects.all().order_by("nombre")
    return render(request, 'core/conductores.html',
                  {'conductores': conductores, 'rutas': rutas})


def crearConductor(request):
    Conductor.objects.create(
        nombre=request.POST.get('nombre'),
        cedula=request.POST.get('cedula'),
        telefono=request.POST.get('telefono'),
        email=request.POST.get('email'),
        contrasena=request.POST.get('contrasena'),
        ruta_id=request.POST.get('id_ruta')
    )
    return redirect('/conductores/')


def editarConductor(request, id_conductor):
    conductor = Conductor.objects.get(id_conductor=id_conductor)
    conductor.nombre = request.POST.get('nombre')
    conductor.cedula = request.POST.get('cedula')
    conductor.telefono = request.POST.get('telefono')
    conductor.email = request.POST.get('email')
    conductor.contrasena = request.POST.get('contrasena')
    conductor.ruta_id = request.POST.get('id_ruta')
    conductor.save()
    return redirect('/conductores/')


def eliminarConductor(request, id_conductor):
    conductor = Conductor.objects.get(id_conductor=id_conductor)
    conductor.delete()
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

def buses(request):
    buses = Bus.objects.all()
    rutas = Ruta.objects.all().order_by('nombre')
    return render(request, 'core/buses.html', {'buses': buses, 'rutas': rutas})


def CrearBus(request):
    if request.method == 'POST':
        Bus.objects.create(
            placa=request.POST.get('placa'),
            ruta_id=request.POST.get('id_ruta')
        )
    return redirect('/buses/')


def EditarBus(request):
    if request.method == 'POST':
        bus_id = request.POST.get('id_bus')
        bus = Bus.objects.get(id_bus=bus_id)
        bus.placa = request.POST.get('placa')
        bus.ruta_id = request.POST.get('id_ruta')
        bus.save()
        return redirect('/buses/')
    return redirect('/buses/')


def EliminarBus(request):
    if request.method == 'POST':
        bus_id = request.POST.get('id_bus')
        bus = Bus.objects.get(id_bus=bus_id)
        bus.delete()
        return redirect('/buses/')
    return redirect('/buses/')

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
            conductor = Conductor.objects.select_related('ruta').get(cedula=cedula)
        except Conductor.DoesNotExist:
            return JsonResponse({'error': 'Cédula no registrada'}, status=404)

        try:
            bus = Bus.objects.get(ruta=conductor.ruta)
        except Bus.DoesNotExist:
            bus = None

        return JsonResponse({
            'status': 'ok',
            'conductor': {
                'id': conductor.id_conductor,
                'nombre': conductor.nombre,
                'cedula': conductor.cedula,
                'ruta': conductor.ruta.nombre,
                'ruta_id': conductor.ruta.id_ruta
            },
            'bus': {
                'id': bus.id_bus if bus else None,
                'placa': bus.placa if bus else None,
                'activo': bus.activo if bus else False
            } if bus else None
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

        try:
            bus = Bus.objects.get(ruta=conductor.ruta)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'El conductor no tiene bus asignado'}, status=404)

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

        try:
            bus = Bus.objects.get(ruta=conductor.ruta)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'El conductor no tiene bus asignado'}, status=404)

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

        try:
            bus = Bus.objects.get(ruta=conductor.ruta)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'Bus no encontrado'}, status=404)
        except Bus.MultipleObjectsReturned:
            return JsonResponse({'error': 'Múltiples buses para esta ruta'}, status=400)

        if not bus.activo:
            return JsonResponse({
                'status': 'inactivo',
                'message': 'El bus no está activo'
            })

        ubicacion = UbicacionBus.objects.create(
            bus=bus,
            ruta=bus.ruta,
            latitud=float(latitud),
            longitud=float(longitud),
            velocidad=float(velocidad or 0)
        )

        bus.ultima_ubicacion = datetime.now()
        bus.save()

        return JsonResponse({
            'status': 'ok',
            'message': 'Ubicación guardada',
            'ubicacion_id': ubicacion.id,
            'timestamp': datetime.now().isoformat()
        })

    except json.JSONDecodeError as e:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


def verificar_estado_ubicacion(request, conductor_id):
    try:
        conductor = Conductor.objects.get(id_conductor=conductor_id)
        bus = Bus.objects.get(ruta=conductor.ruta)

        return JsonResponse({
            'conductor_id': conductor.id_conductor,
            'conductor_nombre': conductor.nombre,
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'activo': bus.activo,
            'ultima_ubicacion': bus.ultima_ubicacion.isoformat() if bus.ultima_ubicacion else None
        })

    except Conductor.DoesNotExist:
        return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
    except Bus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


def obtener_ubicaciones(request):
    buses = Bus.objects.filter(activo=True)
    ubicaciones = []

    for bus in buses:
        ultima_ubicacion = UbicacionBus.objects.filter(bus=bus).order_by('-timestamp').first()
        if ultima_ubicacion:
            ubicaciones.append({
                'bus_id': bus.id_bus,
                'placa': bus.placa,
                'ruta': bus.ruta.nombre if bus.ruta else None,
                'latitud': float(ultima_ubicacion.latitud),
                'longitud': float(ultima_ubicacion.longitud),
                'velocidad': float(ultima_ubicacion.velocidad),
                'timestamp': ultima_ubicacion.timestamp.isoformat()
            })

    return JsonResponse({
        'count': len(ubicaciones),
        'buses': ubicaciones,
        'timestamp': datetime.now().isoformat()
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

def reportes_home(request):
    return render(request, 'core/reportes.html', {
        'total_rutas': Ruta.objects.count(),
        'total_buses': Bus.objects.count(),
        'total_conductores': Conductor.objects.count(),
        'total_alertas': Alerta.objects.count(),
    })


def reporte_rutas(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_rutas.pdf"'

    rutas = Ruta.objects.all().order_by('codigo')

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


def reporte_buses(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_buses.pdf"'

    buses = Bus.objects.select_related('ruta').all().order_by('placa')

    encabezados = ['ID', 'Placa', 'Ruta', 'Estado', 'Última Actualización']
    datos = []

    for bus in buses:
        estado = "Activo" if bus.activo else "Inactivo"
        ultima = bus.ultima_ubicacion.strftime('%d/%m/%Y %H:%M') if bus.ultima_ubicacion else "Sin registro"
        datos.append([
            str(bus.id_bus),
            bus.placa,
            bus.ruta.nombre[:30] if bus.ruta else "Sin asignar",
            estado,
            ultima,
        ])

    activos = buses.filter(activo=True).count()
    descripcion = (
        f"Este reporte muestra el inventario completo de buses del sistema LocalBus. "
        f"Se incluye la placa de cada bus, la ruta asignada, su estado actual (activo/inactivo) "
        f"y la última vez que se registró una ubicación. Actualmente hay {buses.count()} buses "
        f"registrados, de los cuales {activos} están activos en este momento."
    )

    anchos = [1.5 * cm, 2.5 * cm, 5 * cm, 2.5 * cm, 4 * cm]

    return crear_reporte(response, "REPORTE DE BUSES", encabezados, datos,
                         buses.count(), descripcion, anchos)


def reporte_conductores(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_conductores.pdf"'

    conductores = Conductor.objects.select_related('ruta').all().order_by('nombre')

    encabezados = ['ID', 'Nombre', 'Cédula', 'Teléfono', 'Email', 'Ruta']
    datos = []

    for c in conductores:
        datos.append([
            str(c.id_conductor),
            c.nombre[:25],
            c.cedula,
            c.telefono,
            c.email[:25],
            c.ruta.nombre[:20] if c.ruta else "Sin ruta",
        ])

    descripcion = (
        f"Este reporte presenta el listado completo de conductores registrados en el sistema LocalBus. "
        f"Se incluyen datos personales como nombre completo, número de cédula, teléfono de contacto, "
        f"correo electrónico y la ruta asignada a cada conductor. Actualmente el sistema cuenta con "
        f"{conductores.count()} conductores registrados."
    )

    anchos = [1.2 * cm, 3.5 * cm, 2.5 * cm, 2.5 * cm, 4 * cm, 3 * cm]

    return crear_reporte(response, "REPORTE DE CONDUCTORES", encabezados, datos,
                         conductores.count(), descripcion, anchos)


def reporte_alertas(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="reporte_alertas.pdf"'

    alertas = Alerta.objects.select_related('ruta', 'usuario').all().order_by('-fecha_creacion')

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


# ================= SIMULACIÓN =================

@csrf_exempt
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
            bus = Bus.objects.get(id_bus=bus_id)
        except Bus.DoesNotExist:
            return JsonResponse({'error': 'Bus no encontrado'}, status=404)

        config, created = ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

        if simulando is not None:
            config.simulando = bool(simulando)
        if velocidad is not None:
            config.velocidad_kmh = float(velocidad)

        config.save()

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


def api_estado_simulacion(request):
    configs = ConfiguracionBus.objects.select_related('bus', 'bus__ruta').all()

    data = []
    for config in configs:
        data.append({
            'bus_id': config.bus.id_bus,
            'placa': config.bus.placa,
            'ruta': config.bus.ruta.nombre if config.bus.ruta else None,
            'simulando': config.simulando,
            'velocidad_kmh': config.velocidad_kmh,
            'direccion': config.direccion,
            'posicion_actual': config.posicion_actual,
            'distancia_recorrida': config.distancia_recorrida,
        })

    return JsonResponse({
        'count': len(data),
        'configuraciones': data
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

def panel_simulacion(request):
    buses = Bus.objects.select_related('ruta').all().order_by('placa')

    for bus in buses:
        ConfiguracionBus.objects.get_or_create(
            bus=bus,
            defaults={'velocidad_kmh': 30, 'simulando': False}
        )

    configs = ConfiguracionBus.objects.select_related(
        'bus', 'bus__ruta'
    ).all().order_by('bus__placa')

    total_buses = configs.count()
    simulando = configs.filter(simulando=True).count()
    detenidos = total_buses - simulando

    return render(request, 'core/panel_simulacion.html', {
        'configuraciones': configs,
        'total_buses': total_buses,
        'simulando': simulando,
        'detenidos': detenidos,
    })


@csrf_exempt
def toggle_simulacion(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        config = ConfiguracionBus.objects.get(bus_id=bus_id)
        config.simulando = not config.simulando
        config.save()

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

        config = ConfiguracionBus.objects.get(bus_id=bus_id)
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
def toggle_todos(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body)
        simulando = data.get('simulando', False)

        ConfiguracionBus.objects.all().update(simulando=simulando)

        return JsonResponse({
            'status': 'ok',
            'simulando': simulando,
            'count': ConfiguracionBus.objects.filter(simulando=simulando).count()
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def resetear_bus(request, bus_id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        config = ConfiguracionBus.objects.get(bus_id=bus_id)
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
        bus = Bus.objects.select_related('ruta').get(id_bus=bus_id)
    except Bus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)

    if not bus.ruta or not bus.ruta.geometria_ruta:
        return JsonResponse({'error': 'El bus no tiene ruta asignada'}, status=404)

    coords = list(bus.ruta.geometria_ruta.coords)
    if len(coords) < 2:
        return JsonResponse({'error': 'La ruta no tiene suficientes puntos'}, status=404)

    ultima = UbicacionBus.objects.filter(bus=bus).order_by('-timestamp').first()
    if not ultima:
        return JsonResponse({'error': 'Bus sin ubicación'}, status=404)

    ultimas = UbicacionBus.objects.filter(bus=bus).order_by('-timestamp')[:10]
    velocidades = [u.velocidad for u in ultimas if u.velocidad > 0]
    velocidad_kmh = (sum(velocidades) / len(velocidades)) if velocidades else 30

    if velocidad_kmh < 1:
        return JsonResponse({
            'status': 'stopped',
            'message': 'El bus está detenido',
            'bus_id': bus.id_bus,
            'placa': bus.placa,
            'ruta': bus.ruta.nombre,
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
            'ruta': bus.ruta.nombre,
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
        'ruta': bus.ruta.nombre,
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