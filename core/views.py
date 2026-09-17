from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus
from datetime import time, datetime
import json
import traceback
from django.contrib import messages
import random
from datetime import datetime, timedelta
from django.core.mail import send_mail
from django.utils import timezone

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
    
    # ✅ ÚNICO CAMBIO: obtener usuario_perfil para el nickname
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
        'usuario_perfil': usuario_perfil,   # ✅ ÚNICO AGREGADO
    })

# ================= LOGIN / REGISTRO (WEB) =================

# ================= LOGIN / REGISTRO (WEB) =================

def login(request):
    if request.method == 'POST':
        identificador = request.POST.get('email', '').strip()  # Puede ser email o nickname
        contrasena = request.POST.get('password', '')

        # Buscar por email O por nickname
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

        # Login exitoso
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

    messages.success(
        request,
        'Sesión cerrada correctamente. ¡Hasta pronto!'
    )

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

        Usuario.objects.create(
            nombre=nombre + ' ' + apellido,
            email=email,
            nickName=nickName,
            contrasena=contrasena,
            telefono=telefono
        )

        return redirect('/login/')

    return render(request, 'core/registro.html')
# ================= VERIFICAR EMAIL (AJAX) =================

@csrf_exempt
def verificar_email(request):
    """Vista AJAX para verificar si un email ya está registrado"""
    if request.method == 'POST':
        email = request.POST.get('email', '').strip().lower()
        
        if not email:
            return JsonResponse({'existe': False})
        
        existe = Usuario.objects.filter(email__iexact=email).exists()
        
        return JsonResponse({'existe': existe})
    
    return JsonResponse({'existe': False})
# ================= VERIFICAR NICKNAME (AJAX) =================

@csrf_exempt
def verificar_nickname(request):
    """Vista AJAX para verificar si un nickname ya está registrado y sugerir alternativas"""
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
    """Genera sugerencias de nicknames disponibles basadas en uno existente"""
    import random
    import string
    
    sugerencias = []
    intentos = 0
    max_intentos = 50  # Evitar bucle infinito
    
    # Estrategias de generación (en orden de prioridad)
    estrategias = [
        # 1. Agregar números al final
        lambda n: f"{n}{random.randint(1, 99)}",
        # 2. Agregar año
        lambda n: f"{n}{random.randint(2024, 2026)}",
        # 3. Agregar guión bajo + números
        lambda n: f"{n}_{random.randint(1, 99)}",
        # 4. Agregar sufijo "oficial" o "real"
        lambda n: f"{n}_{random.choice(['oficial', 'real', 'pro', 'dev'])}",
        # 5. Agregar letras aleatorias
        lambda n: f"{n}{random.choice(string.ascii_lowercase)}{random.randint(1, 9)}",
        # 6. Agregar punto + números
        lambda n: f"{n}.{random.randint(1, 99)}",
    ]
    
    while len(sugerencias) < cantidad and intentos < max_intentos:
        intentos += 1
        
        # Elegir estrategia aleatoria
        estrategia = random.choice(estrategias)
        candidato = estrategia(nickname)
        
        # Verificar que no exista y no esté repetido en la lista
        if (candidato not in sugerencias and 
            not Usuario.objects.filter(nickName__iexact=candidato).exists()):
            sugerencias.append(candidato)
    
    # Si aún faltan, generar con números aleatorios únicos
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

# ================= CONDUCTORES =================

def conductores(request):
    conductores = Conductor.objects.all()
    rutas = Ruta.objects.all().order_by("nombre")
    return render(
        request,
        'core/conductores.html',
        {'conductores': conductores, 'rutas': rutas}
    )

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
    """
    Envía la ubicación del bus desde la app móvil
    POST /api/enviar_ubicacion/
    """
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
        
        print(f"👤 Conductor ID: {conductor_id}")
        print(f"📍 Latitud: {latitud}")
        print(f"📍 Longitud: {longitud}")
        print(f"⚡ Velocidad: {velocidad}")
        
        if not all([conductor_id, latitud, longitud]):
            print("❌ Faltan datos obligatorios")
            return JsonResponse({'error': 'Faltan datos obligatorios'}, status=400)
        
        # Buscar conductor
        try:
            conductor = Conductor.objects.get(id_conductor=conductor_id)
            print(f"✅ Conductor encontrado: {conductor.nombre}")
        except Conductor.DoesNotExist:
            print(f"❌ Conductor con ID {conductor_id} no existe")
            return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
        
        # Buscar bus
        try:
            bus = Bus.objects.get(ruta=conductor.ruta)
            print(f"✅ Bus encontrado: {bus.placa}")
        except Bus.DoesNotExist:
            print(f"❌ No hay bus para la ruta {conductor.ruta.nombre}")
            return JsonResponse({'error': 'Bus no encontrado'}, status=404)
        except Bus.MultipleObjectsReturned:
            print(f"❌ Hay múltiples buses para la ruta {conductor.ruta.nombre}")
            return JsonResponse({'error': 'Múltiples buses para esta ruta'}, status=400)
        
        # Verificar activo
        if not bus.activo:
            print(f"⚠️ El bus {bus.placa} no está activo")
            return JsonResponse({
                'status': 'inactivo',
                'message': 'El bus no está activo'
            })
        
        # Guardar ubicación
        print(f"💾 Guardando ubicación...")
        ubicacion = UbicacionBus.objects.create(
            bus=bus,
            ruta=bus.ruta,
            latitud=float(latitud),
            longitud=float(longitud),
            velocidad=float(velocidad or 0)
        )
        print(f"✅ Ubicación guardada: ID={ubicacion.id}")
        
        bus.ultima_ubicacion = datetime.now()
        bus.save()
        
        return JsonResponse({
            'status': 'ok',
            'message': 'Ubicación guardada',
            'ubicacion_id': ubicacion.id,
            'timestamp': datetime.now().isoformat()
        })
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON inválido: {e}")
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        print("=" * 60)
        print(f"❌❌❌ ERROR EN enviar_ubicacion:")
        print(f"Tipo: {type(e).__name__}")
        print(f"Mensaje: {e}")
        traceback.print_exc()
        print("=" * 60)
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
        ultima_ubicacion = UbicacionBus.objects.filter(bus=bus).first()
        if ultima_ubicacion:
            ubicaciones.append({
                'bus_id': bus.id_bus,
                'placa': bus.placa,
                'ruta': bus.ruta.nombre if bus.ruta else None,
                'latitud': ultima_ubicacion.latitud,
                'longitud': ultima_ubicacion.longitud,
                'velocidad': ultima_ubicacion.velocidad,
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
            # Por seguridad, no revelamos si el correo existe.
            messages.success(request, 'Si el correo está registrado, recibirás un código.')
            return render(request, 'core/recuperacion.html')
        
        # Generar código de 6 dígitos
        codigo = str(random.randint(100000, 999999))
        usuario.codigo_recuperacion = codigo
        usuario.codigo_expiracion = timezone.now() + timedelta(minutes=15)
        usuario.save()
        
        # Enviar el correo
        asunto = 'Código de Recuperación - LocalBus'
        mensaje = f'Tu código para restablecer la contraseña es: {codigo}\nEste código expira en 15 minutos.'
        send_mail(asunto, mensaje, None, [usuario.email], fail_silently=False)
        
        # Guardar el email en la sesión para saber a quién validar en el siguiente paso
        request.session['email_recuperacion'] = usuario.email
        return redirect('/verificar_codigo/')
    
    return render(request, 'core/recuperacion.html')

def verificar_codigo(request):
    email = request.session.get('email_recuperacion')
    if not email:
        return redirect('/solicitar_recuperacion/') # Si no hay sesión, redirigir
    
    if request.method == 'POST':
        codigo_ingresado = request.POST.get('codigo', '').strip()
        try:
            usuario = Usuario.objects.get(email__iexact=email)
            # Verificar que el código coincida y no haya expirado
            if usuario.codigo_recuperacion == codigo_ingresado and usuario.codigo_expiracion > timezone.now():
                # Código correcto: dar acceso al formulario de nueva contraseña
                request.session['codigo_validado'] = True
                return redirect('/nueva_contrasena/')
            else:
                messages.error(request, 'Código incorrecto o expirado.')
        except Usuario.DoesNotExist:
            messages.error(request, 'Error al validar el usuario.')
    
    return render(request, 'core/verificar_codigo.html')

def nueva_contrasena(request):
    # Verificar que el usuario haya pasado por la validación del código
    if not request.session.get('codigo_validado'):
        return redirect('/solicitar_recuperacion/')
    
    if request.method == 'POST':
        pass1 = request.POST.get('password1')
        pass2 = request.POST.get('password2')
        
        if pass1 and pass1 == pass2:
            email = request.session.get('email_recuperacion')
            usuario = Usuario.objects.get(email__iexact=email)
            usuario.contrasena = pass1 # Recuerda: en producción deberías encriptar esto.
            # Limpiar tokens y datos de sesión
            usuario.codigo_recuperacion = None
            usuario.codigo_expiracion = None
            usuario.save()
            
            # Limpiar la sesión
            del request.session['email_recuperacion']
            del request.session['codigo_validado']
            
            messages.success(request, 'Contraseña actualizada. Ya puedes iniciar sesión.')
            return redirect('/login/')
        else:
            messages.error(request, 'Las contraseñas no coinciden.')
    
    return render(request, 'core/nueva_contrasena.html')

def perfil(request):
    """Vista para ver y editar el perfil del usuario logueado"""
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
        
        # ============ CAMBIAR CONTRASEÑA ============
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
        
        # ============ EDITAR DATOS DEL PERFIL ============
        nombre = request.POST.get('nombre', '').strip()
        email = request.POST.get('email', '').strip()
        nickName = request.POST.get('nickName', '').strip()
        telefono = request.POST.get('telefono', '').strip()
        color_perfil = request.POST.get('color_perfil', '').strip()
        
        # Validaciones
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
        
        # Guardar cambios básicos
        usuario.nombre = nombre
        usuario.email = email
        usuario.nickName = nickName
        usuario.telefono = telefono if telefono else None
        
        # ✅ GUARDAR COLOR DE PERFIL
        if color_perfil:
            usuario.color_perfil = color_perfil
        
        usuario.save()
        
        # Actualizar el nombre en la sesión
        request.session['usuario_nombre'] = usuario.nombre
        
        messages.success(request, 'Perfil actualizado correctamente.')
        return redirect('/')
    
    return redirect('/')

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
