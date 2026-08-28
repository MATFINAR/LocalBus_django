"""
URL configuration for LocalBus_django project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from pathlib import Path

from django.contrib import admin
from django.urls import path
from core import views

urlpatterns = [
    path('', views.home),
    path('login/', views.login),
    path('registro/', views.registro),

    path('alertas/', views.alertas),

    path('rutas/', views.rutas),
    path('crearRuta/', views.crearRuta),

    path('conductores/', views.conductores),

    path('buses/', views.buses),

    path('acerca_de/', views.acerca_de),
    path('CrearConductor/', views.crearConductor),
    path('EditarConductor/<int:id_conductor>/', views.editarConductor),
    path('EliminarConductor/<int:id_conductor>/', views.eliminarConductor),
]
