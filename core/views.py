from django.shortcuts import render
from .models import Bus

def home(request):
    return render(request, 'core/home.html')
def login(request):
    return render(request, 'core/login.html')
def registro(request):
    return render(request, 'core/registro.html')
def alertas(request):
    return render(request, 'core/alertas.html')
def rutas(request):
    return render(request, 'core/rutas.html')
def conductores(request):
    return render(request, 'core/conductores.html')

def buses(request):
    #para listar los buses en la vista
    buses = Bus.objects.all()
    return render(request, 'core/buses.html', {'buses': buses})

def acerca_de(request):
    return render(request, 'core/acerca_de.html')