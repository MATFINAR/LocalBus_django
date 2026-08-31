from django.shortcuts import render, redirect
from .models import Bus, Alerta, Ruta, Conductor
from datetime import time

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('fecha_creacion')[:15]
    return render(request, 'core/home.html', {'alertas': alertas})
def login(request):
    return render(request, 'core/login.html')
def registro(request):
    return render(request, 'core/registro.html')
def alertas(request):
    alertas = Alerta.objects.all()
    return render(request, 'core/alertas.html', {'alertas': alertas})
def rutas(request):
    rutas = Ruta.objects.all().order_by('id_ruta')    
    return render(request, "core/rutas.html", {'rutas': rutas})

def crearRuta(request):
    duracion_horas = request.POST.get('duracion_horas')
    duracion_minutos = request.POST.get('duracion_minutos')

    horas = int(duracion_horas or 0)
    minutos = int(duracion_minutos or 0)

    duracion = time(hour=horas, minute=minutos)

    Ruta.objects.create(
        nombre = request.POST.get('nombre'),
        origen = request.POST.get('origen'),
        destino = request.POST.get('destino'),
        distancia_Km = float(request.POST.get('distancia_km')),
        duracion_estimada = duracion,
        estado = request.POST.get('estado'),
        frecuencia = request.POST.get('frecuencia'),
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