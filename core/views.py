from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Bus, Alerta, Ruta, Conductor, Usuario, UbicacionBus
from datetime import time, datetime
import json

# ================= HOME =================

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')[:15]
    rutas = Ruta.objects.all().order_by('nombre')
    
    # Preparar datos de rutas con coordenadas desde la BD
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
            'coordenadas': ruta.get_coordenadas_ruta(),  # Desde la BD
            'paradas': ruta.get_paradas_coordenadas()    # Desde la BD
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

        print("EMAIL:", email)
        print("CONTRASEÑA ESCRITA:", contrasena)

        print("USUARIOS EN BD:")
        for u in Usuario.objects.all():
            print(
                "ID:", u.id_usuario,
                "| EMAIL:", repr(u.email),
                "| CONTRASEÑA:", repr(u.contrasena)
            )

        try:
            usuario = Usuario.objects.get(email=email)
            print("USUARIO ENCONTRADO:", usuario.email)
            print("CONTRASEÑA BD:", usuario.contrasena)

            if usuario.contrasena == contrasena:
                print("LOGIN CORRECTO")
                request.session['usuario_id'] = usuario.id_usuario
                request.session['usuario_nombre'] = usuario.nombre
                return redirect('/')

            print("CONTRASEÑA INCORRECTA")
            return render(request, 'core/login.html', {
                'error': 'La contraseña es incorrecta.',
                'email': email
            })

        except Usuario.DoesNotExist:
            print("CORREO NO EXISTE")
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
    alertas = Alerta.objects.all()
    return render(request, 'core/alertas.html', {'alertas': alertas})

# ================= RUTAS =================

def rutas(request):
    rutas = Ruta.objects.all().order_by('id_ruta')
    
    # Preparar datos para el mapa
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
    
    return render(request, "core/rutas.html", {
        'rutas': rutas,
        'rutas_json': json.dumps(rutas_json)
    })

def crearRuta(request):
    duracion_horas = request.POST.get('duracion_horas')
    duracion_minutos = request.POST.get('duracion_minutos')

    horas = int(duracion_horas or 0)
    minutos = int(duracion_minutos or 0)
    duracion = time(hour=horas, minute=minutos)
    
    frecuencia_minutos = int(request.POST.get('frecuencia') or 0)
    frecuencia_horas = frecuencia_minutos // 60
    frecuencia_resto = frecuencia_minutos % 60
    frecuencia = time(
        hour=frecuencia_horas,
        minute=frecuencia_resto
    )

    Ruta.objects.create(
        nombre=request.POST.get('nombre'),
        codigo=request.POST.get('codigo', 'R-001'),
        origen=request.POST.get('origen'),
        destino=request.POST.get('destino'),
        distancia_km=float(request.POST.get('distancia_km')),
        duracion_estimada=duracion,
        estado=request.POST.get('estado'),
        frecuencia=frecuencia,
        paradas=request.POST.get('paradas'),
    )

    return redirect("/rutas/")

def editarRuta(request, id_ruta):
    ruta = Ruta.objects.get(id_ruta=id_ruta)
    
    duracion_horas = request.POST.get('duracion_horas')
    duracion_minutos = request.POST.get('duracion_minutos')

    horas = int(duracion_horas or 0)
    minutos = int(duracion_minutos or 0)
    duracion = time(hour=horas, minute=minutos)
    
    frecuencia_minutos = int(request.POST.get('frecuencia') or 0)
    frecuencia_horas = frecuencia_minutos // 60
    frecuencia_resto = frecuencia_minutos % 60
    frecuencia = time(
        hour=frecuencia_horas,
        minute=frecuencia_resto
    )
    
    ruta.nombre = request.POST.get('nombre')
    ruta.codigo = request.POST.get('codigo', ruta.codigo)  # Campo nuevo
    ruta.origen = request.POST.get('origen')
    ruta.destino = request.POST.get('destino')
    ruta.distancia_km = float(request.POST.get('distancia_km'))  # Cambiado
    ruta.duracion_estimada = duracion
    ruta.estado = request.POST.get('estado')
    ruta.frecuencia = frecuencia
    ruta.paradas = request.POST.get('paradas')
    
    ruta.save()

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

# ================= ACERCA DE =================

def acerca_de(request):
    return render(request, 'core/acerca_de.html')


# =========================================================
# ================= API PARA APP MÓVIL =================
# =========================================================

@csrf_exempt
def login_conductor(request):
    """
    Login del conductor solo con cédula (sin contraseña)
    POST /api/login_conductor/
    {
        "cedula": "1234567890"
    }
    """
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
        
        # Buscar el bus asignado al conductor
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
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def activar_bus(request):
    """
    Activa el bus del conductor
    POST /api/activar_bus/
    {
        "conductor_id": 1
    }
    """
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
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def desactivar_bus(request):
    """
    Desactiva el bus del conductor
    POST /api/desactivar_bus/
    {
        "conductor_id": 1
    }
    """
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
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def enviar_ubicacion(request):
    """
    Envía la ubicación del bus desde la app móvil
    POST /api/enviar_ubicacion/
    {
        "conductor_id": 1,
        "latitud": 6.2442,
        "longitud": -75.5812,
        "velocidad": 45.5
    }
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        data = json.loads(request.body)
        conductor_id = data.get('conductor_id')
        latitud = data.get('latitud')
        longitud = data.get('longitud')
        velocidad = data.get('velocidad', 0)
        
        if not all([conductor_id, latitud, longitud]):
            return JsonResponse({'error': 'Faltan datos obligatorios'}, status=400)
        
        conductor = Conductor.objects.get(id_conductor=conductor_id)
        bus = Bus.objects.get(ruta=conductor.ruta)
        
        # Verificar que el bus está activo
        if not bus.activo:
            return JsonResponse({
                'status': 'inactivo',
                'message': 'El bus no está activo'
            })
        
        # Guardar ubicación
        UbicacionBus.objects.create(
            bus=bus,
            ruta=bus.ruta,
            latitud=latitud,
            longitud=longitud,
            velocidad=velocidad
        )
        
        bus.ultima_ubicacion = datetime.now()
        bus.save()
        
        return JsonResponse({
            'status': 'ok',
            'message': 'Ubicación guardada',
            'timestamp': datetime.now().isoformat()
        })
        
    except Conductor.DoesNotExist:
        return JsonResponse({'error': 'Conductor no encontrado'}, status=404)
    except Bus.DoesNotExist:
        return JsonResponse({'error': 'Bus no encontrado'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def verificar_estado_ubicacion(request, conductor_id):
    """
    Obtiene el estado del bus de un conductor
    GET /api/estado_bus/<conductor_id>/
    """
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
        return JsonResponse({'error': str(e)}, status=500)


def obtener_ubicaciones(request):
    """
    API para obtener las ubicaciones de todos los buses activos
    GET /api/ubicaciones/
    """
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