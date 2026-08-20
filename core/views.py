from django.shortcuts import render

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
    return render(request, 'core/buses.html')
def acerca_de(request):
    return render(request, 'core/acerca_de.html')