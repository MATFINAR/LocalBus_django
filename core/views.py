from django.shortcuts import render, redirect
from .models import Bus, Alerta, Ruta, Conductor, Usuario
from datetime import time
import json

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
    if request.method == 'POST':
        # Obtener datos de duración
        duracion_horas = int(request.POST.get('duracion_horas', 0))
        duracion_minutos = int(request.POST.get('duracion_minutos', 0))
        duracion = time(hour=duracion_horas, minute=duracion_minutos)
        
        # Obtener frecuencia
        frecuencia_minutos = int(request.POST.get('frecuencia', 15))
        frecuencia_horas = frecuencia_minutos // 60
        frecuencia_resto = frecuencia_minutos % 60
        frecuencia = time(hour=frecuencia_horas, minute=frecuencia_resto)
        
        # Obtener geometría
        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')
        distancia_km = float(request.POST.get('distancia_km', 0))
        
        # Crear la ruta
        ruta = Ruta.objects.create(
            nombre=request.POST.get('nombre', ''),
            codigo=request.POST.get('codigo', 'R-001'),
            descripcion=request.POST.get('descripcion', ''),
            origen=request.POST.get('origen', ''),
            destino=request.POST.get('destino', ''),
            distancia_km=distancia_km,
            duracion_estimada=duracion,
            estado=request.POST.get('estado', 'activa'),
            frecuencia=frecuencia,
            latitud=float(request.POST.get('latitud', 0)),
            longitud=float(request.POST.get('longitud', 0)),
        )
        
        # Procesar geometría de la ruta
        if geometria_data:
            try:
                import json
                coords = json.loads(geometria_data)
                if coords and len(coords) > 0:
                    from django.contrib.gis.geos import LineString, Point
                    
                    # Crear geometría de ruta
                    ruta.geometria_ruta = LineString(coords, srid=4326)
                    
                    # Crear punto origen y destino
                    ruta.punto_origen = Point(coords[0], srid=4326)
                    ruta.punto_destino = Point(coords[-1], srid=4326)
            except Exception as e:
                print(f"Error al procesar geometría: {e}")
        
        # Procesar paradas
        if paradas_data:
            try:
                import json
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
        
        # Obtener datos de duración
        duracion_horas = int(request.POST.get('duracion_horas', 0))
        duracion_minutos = int(request.POST.get('duracion_minutos', 0))
        duracion = time(hour=duracion_horas, minute=duracion_minutos)
        
        # Obtener frecuencia
        frecuencia_minutos = int(request.POST.get('frecuencia', 15))
        frecuencia_horas = frecuencia_minutos // 60
        frecuencia_resto = frecuencia_minutos % 60
        frecuencia = time(hour=frecuencia_horas, minute=frecuencia_resto)
        
        # Obtener geometría
        geometria_data = request.POST.get('geometria_ruta')
        paradas_data = request.POST.get('paradas')
        distancia_km = float(request.POST.get('distancia_km', 0))
        
        # Actualizar campos básicos
        ruta.nombre = request.POST.get('nombre', ruta.nombre)
        ruta.codigo = request.POST.get('codigo', ruta.codigo)
        ruta.descripcion = request.POST.get('descripcion', ruta.descripcion)
        ruta.origen = request.POST.get('origen', ruta.origen)
        ruta.destino = request.POST.get('destino', ruta.destino)
        ruta.distancia_km = distancia_km
        ruta.duracion_estimada = duracion
        ruta.estado = request.POST.get('estado', ruta.estado)
        ruta.frecuencia = frecuencia
        ruta.latitud = float(request.POST.get('latitud', ruta.latitud))
        ruta.longitud = float(request.POST.get('longitud', ruta.longitud))
        
        # Actualizar geometría
        if geometria_data:
            try:
                import json
                coords = json.loads(geometria_data)
                if coords and len(coords) > 0:
                    from django.contrib.gis.geos import LineString, Point
                    
                    ruta.geometria_ruta = LineString(coords, srid=4326)
                    ruta.punto_origen = Point(coords[0], srid=4326)
                    ruta.punto_destino = Point(coords[-1], srid=4326)
            except Exception as e:
                print(f"Error al procesar geometría: {e}")
        
        # Actualizar paradas
        if paradas_data:
            try:
                import json
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