from django.shortcuts import render, redirect
from .models import Bus, Alerta, Ruta, Conductor, Usuario
from datetime import time

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')[:15]
    rutas = Ruta.objects.all().order_by('nombre')
    return render(request, 'core/home.html', {
        'alertas': alertas,
        'rutas': rutas
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
    alertas = Alerta.objects.all().order_by('-fecha_creacion')
    return render(request, 'core/alertas.html', {'alertas': alertas})

def crearAlerta(request):

    Alerta.objects.create(
        ruta_id=request.POST.get('id_ruta'),
        tipo=request.POST.get('tipo'),
        descripcion=request.POST.get('descripcion'),
        estado=request.POST.get('estado')
    )

    return redirect('/alertas/')

def editarAlerta(request, id_alerta):

    alerta = Alerta.objects.get(id_alerta=id_alerta)


    alerta.ruta_id = request.POST.get('id_ruta')
    alerta.tipo = request.POST.get('tipo')
    alerta.descripcion = request.POST.get('descripcion')
    alerta.estado = request.POST.get('estado')

    alerta.save()

    return redirect('/alertas/')

def eliminarAlerta(request, id_alerta):

    alerta = Alerta.objects.get(id_alerta=id_alerta)

    alerta.delete()

    return redirect('/alertas/')

def rutas(request):
    rutas = Ruta.objects.all().order_by('id_ruta')    
    return render(request, "core/rutas.html", {'rutas': rutas})

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
        nombre = request.POST.get('nombre'),
        origen = request.POST.get('origen'),
        destino = request.POST.get('destino'),
        distancia_Km = float(request.POST.get('distancia_km')),
        duracion_estimada = duracion,
        estado = request.POST.get('estado'),
        frecuencia = frecuencia,
        paradas = request.POST.get('paradas'),
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
    ruta.origen = request.POST.get('origen')
    ruta.destino = request.POST.get('destino')
    ruta.distancia_Km = float(request.POST.get('distancia_km'))
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