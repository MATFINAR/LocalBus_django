from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus
from datetime import time, datetime
import json
import traceback

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
    
    return render(request, 'core/home.html', {
        'alertas': alertas,
        'rutas': rutas,
        'rutas_json': json.dumps(rutas_json) 
    })

# ================= LOGIN / REGISTRO (WEB) =================

def login(request):
    if request.method == 'POST':
        email = request.POST.get('email', '').strip()
        contrasena = request.POST.get('password', '')

        try:
            usuario = Usuario.objects.get(email=email)
            if usuario.contrasena == contrasena:
                request.session['usuario_id'] = usuario.id_usuario
                request.session['usuario_nombre'] = usuario.nombre
                return redirect('/')
            return render(request, 'core/login.html', {
                'error': 'La contraseña es incorrecta.',
                'email': email
            })
        except Usuario.DoesNotExist:
            return render(request, 'core/login.html', {
                'error': 'El correo no está registrado.',
                'email': email
            })

    return render(request, 'core/login.html')

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