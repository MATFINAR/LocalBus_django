from django.shortcuts import render
from .models import Ruta
from .models import Bus
from .models import Bus, Alerta, Ruta, Conductor

def home(request):
    alertas = Alerta.objects.select_related('usuario', 'ruta').all().order_by('-fecha_creacion')[:15]
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
    
def conductores(request):
    conductores = Conductor.objects.select_related('ruta').all().order_by('nombre')
    rutas = Ruta.objects.all().order_by('nombre')
    return render(request, "core/conductores.html", {'conductores': conductores,
        'rutas': rutas})
    
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