from django.shortcuts import render , redirect
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
    rutas = Ruta.objects.all().order_by('nombre')    
    return render(request, "core/rutas.html", {'rutas': rutas})
    
def conductores(request):
    conductores = Conductor.objects.select_related('ruta').all().order_by('nombre')
    rutas = Ruta.objects.all().order_by('nombre')
    return render(request, "core/conductores.html", {'conductores': conductores,
        'rutas': rutas})
    
def buses(request):
    #para listar los buses en la vista
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