from pathlib import Path
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path
from core import views



urlpatterns = [
    path('', views.home),
    path('login/', views.login),
    path('registro/', views.registro),
    path('logout/', views.logout),
    path('verificar_email/', views.verificar_email, name='verificar_email'),
    path('verificar_nickname/', views.verificar_nickname, name='verificar_nickname'),
    path('solicitar_recuperacion/', views.solicitar_recuperacion, name='solicitar_recuperacion'),
    path('verificar_codigo/', views.verificar_codigo, name='verificar_codigo'),
    path('nueva_contrasena/', views.nueva_contrasena, name='nueva_contrasena'),
    path('perfil/', views.perfil, name='perfil'),
    path('verificar_registro/', views.verificar_registro, name='verificar_registro'),


    path('alertas/', views.alertas),
    path('crearAlerta/', views.crearAlerta),
    path('editarAlerta/<int:id_alerta>/', views.editarAlerta),
    path('eliminarAlerta/<int:id_alerta>/', views.eliminarAlerta),

    path('rutas/', views.rutas),
    path('crearRuta/', views.crearRuta),
    path('editarRuta/<id_ruta>/', views.editarRuta),
    path('deleteRuta/<id_ruta>/', views.eliminarRuta),

    path('conductores/', views.conductores),
    path('CrearConductor/', views.crearConductor),
    path('EditarConductor/<int:id_conductor>/', views.editarConductor),
    path('EliminarConductor/<int:id_conductor>/', views.eliminarConductor),

    path('buses/', views.buses),
    path('CrearBus/', views.CrearBus),
    path('EditarBus/', views.EditarBus),
    path('EliminarBus/', views.EliminarBus),

    path('acerca_de/', views.acerca_de),
    
    # ===== API APP MÓVIL =====
    path('api/login_conductor/', views.login_conductor, name='login_conductor'),
    path('api/activar_bus/', views.activar_bus, name='activar_bus'),
    path('api/desactivar_bus/', views.desactivar_bus, name='desactivar_bus'),
    path('api/enviar_ubicacion/', views.enviar_ubicacion, name='enviar_ubicacion'),
    path('api/estado_bus/<int:conductor_id>/', views.verificar_estado_ubicacion, name='estado_bus'),
    path('api/ubicaciones/', views.obtener_ubicaciones, name='obtener_ubicaciones'),
    path('api/rutas/', views.api_rutas, name='api_rutas'),
    path('api/alertas/', views.api_alertas, name='api_alertas'),
]
