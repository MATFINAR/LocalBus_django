from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import User

from .models import Administrador, Bus, Conductor, Empresa, Ruta, Turno


class AdministradorInline(admin.StackedInline):
    model = Administrador
    can_delete = False
    verbose_name = 'Empresa que administra'


class UsuarioAdmin(UserAdmin):
    """Al crear o editar un usuario se elige la empresa que administra."""
    inlines = [AdministradorInline]


admin.site.unregister(User)
admin.site.register(User, UsuarioAdmin)


@admin.register(Empresa)
class EmpresaAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'nit', 'activa']
    search_fields = ['nombre', 'nit']


@admin.register(Ruta)
class RutaAdmin(admin.ModelAdmin):
    list_display = ['codigo', 'nombre', 'empresa', 'estado']
    list_filter = ['empresa', 'estado']
    search_fields = ['codigo', 'nombre']
    exclude = ['geometria_ruta', 'punto_origen', 'punto_destino', 'paradas']


@admin.register(Bus)
class BusAdmin(admin.ModelAdmin):
    list_display = ['placa', 'empresa', 'activo']
    list_filter = ['empresa']
    search_fields = ['placa']
    filter_horizontal = ['rutas']


@admin.register(Conductor)
class ConductorAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'cedula', 'empresa']
    list_filter = ['empresa']
    search_fields = ['nombre', 'cedula']
    exclude = ['contrasena']


@admin.register(Turno)
class TurnoAdmin(admin.ModelAdmin):
    list_display = ['conductor', 'bus', 'ruta', 'inicio', 'fin']
    list_filter = ['bus__empresa']
    date_hierarchy = 'inicio'
