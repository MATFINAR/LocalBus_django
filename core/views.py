from django.http import request
from django.shortcuts import render, redirect
from .models import Bus, Alerta, Ruta, Conductor, Usuario

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')[:15]
    return render(request, 'core/home.html', {'alertas': alertas})
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
    alertas = Alerta.objects.all()
    return render(request, 'core/alertas.html', {'alertas': alertas})
def rutas(request):
    rutas = Ruta.objects.all().order_by('id_ruta')    
    return render(request, "core/rutas.html", {'rutas': rutas})
    
def conductores(request):
    conductores = Conductor.objects.all()
    rutas= Ruta.objects.all().order_by("nombre")

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
    return render(request, 'core/buses.html', {'buses': buses})

def CrearBus(request):
    if request.method == 'POST':
            placa = request.POST.get('placa')
            ruta_id = request.POST.get('ruta_id')
    
            bus = Bus(placa=placa, ruta_id=ruta_id)
            bus.save()
    return render(request, 'core/buses.html', {'buses': buses})

def acerca_de(request):
    return render(request, 'core/acerca_de.html')