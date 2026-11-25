from pathlib import Path
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path
from core import api_movil, backup, mensajes, panel, recorridos, views



urlpatterns = [
    # ===== SUPERADMINISTRADOR: crea empresas y sus administradores =====
    path('admin/', admin.site.urls),

    # ===== ADMINISTRADORES DE EMPRESA =====
    path('empresa/login/', views.login_empresa, name='login_empresa'),
    path('empresa/logout/', views.logout_empresa, name='logout_empresa'),
    path('empresa/logo/', views.empresa_logo, name='empresa_logo'),
    path('empresa/contrasena/', views.empresa_password, name='empresa_password'),
    path('panel/', panel.panel, name='panel'),
    path('panel/reporte/', panel.panel_reporte, name='panel_reporte'),
    path('panel/graficas/', panel.panel_graficas, name='panel_graficas'),

    path('backup/', backup.backup, name='backup'),
    path('backup/descargar/', backup.descargar_backup, name='descargar_backup'),
    path('backup/restaurar/', backup.revisar_restauracion, name='revisar_restauracion'),
    path('backup/restaurar/aplicar/', backup.aplicar_restauracion, name='aplicar_restauracion'),
    path('backup/carga/plantilla/', backup.plantilla_carga, name='plantilla_carga'),
    path('backup/carga/revisar/', backup.revisar_carga, name='revisar_carga'),

    # ===== RECORRIDOS GRABADOS POR LOS CONDUCTORES =====
    path('rutas/recorridos/', recorridos.lista, name='recorridos'),
    path('rutas/recorridos/<int:id_recorrido>/', recorridos.detalle, name='recorrido_detalle'),
    path('rutas/recorridos/<int:id_recorrido>/descartar/', recorridos.descartar, name='recorrido_descartar'),
    path('api/conductor/recorrido/', recorridos.api_recorrido, name='api_conductor_recorrido'),
    path('api/conductor/recorrido/iniciar/', recorridos.api_iniciar, name='api_conductor_recorrido_iniciar'),
    path('api/conductor/recorrido/<int:id_recorrido>/puntos/', recorridos.api_puntos,
         name='api_conductor_recorrido_puntos'),
    path('api/conductor/recorrido/<int:id_recorrido>/terminar/', recorridos.api_terminar,
         name='api_conductor_recorrido_terminar'),

    # ===== MENSAJES CON LOS CONDUCTORES =====
    path('mensajes/', mensajes.mensajes, name='mensajes'),
    path('mensajes/resumen/', mensajes.mensajes_resumen, name='mensajes_resumen'),
    path('mensajes/destinatarios/', mensajes.ver_destinatarios, name='mensajes_destinatarios'),
    path('mensajes/grupo/', mensajes.enviar_a_grupo, name='mensajes_grupo'),
    path('mensajes/<int:id_conductor>/enviar/', mensajes.enviar_mensaje, name='mensajes_enviar'),
    path('mensajes/<int:id_conductor>/nuevos/', mensajes.mensajes_nuevos, name='mensajes_nuevos'),
    path('api/conductor/mensajes/', mensajes.api_mensajes, name='api_conductor_mensajes'),
    path('api/conductor/mensajes/leidos/', mensajes.api_mensajes_leidos, name='api_conductor_mensajes_leidos'),

    path('', views.home),
    path('login/', views.login),
    path('registro/', views.registro),
    path('logout/', views.logout),
    path('verificar_telefono/', views.verificar_telefono, name='verificar_telefono'),
    path('verificar_email/', views.verificar_email, name='verificar_email'),
    path('verificar_nickname/', views.verificar_nickname, name='verificar_nickname'),
    path('verificar_contrasena/', views.verificar_contrasena, name='verificar_contrasena'),
    path('verificar_telefono_perfil/', views.verificar_telefono_perfil, name='verificar_telefono_perfil'),
    path('solicitar_recuperacion/', views.solicitar_recuperacion, name='solicitar_recuperacion'),
    path('verificar_codigo/', views.verificar_codigo, name='verificar_codigo'),
    path('nueva_contrasena/', views.nueva_contrasena, name='nueva_contrasena'),
    path('perfil/', views.perfil, name='perfil'),
    path('perfil/eliminar_cuenta/', views.eliminar_cuenta, name='eliminar_cuenta'),
    path('perfil/desplazamiento_mapa/', views.preferencia_desplazamiento, name='preferencia_desplazamiento'),
    path('perfil/tema/', views.preferencia_tema, name='preferencia_tema'),
    path('verificar_cambio_correo/', views.verificar_cambio_correo, name='verificar_cambio_correo'),
    path('verificar_registro/', views.verificar_registro, name='verificar_registro'),
    path('verificar_email_perfil/', views.verificar_email_perfil, name='verificar_email_perfil'),
    path('verificar_nickname_perfil/', views.verificar_nickname_perfil, name='verificar_nickname_perfil'),


    path('alertas/', views.alertas),
    path('api/alertas/cercana/', views.alerta_cercana, name='alerta_cercana'),
    path('api/alertas/rutas-cercanas/', views.rutas_cercanas, name='rutas_cercanas'),
    path('crearAlerta/', views.crearAlerta),
    path('editarAlerta/<int:id_alerta>/', views.editarAlerta),
    path('inhabilitarAlerta/<int:id_alerta>/', views.inhabilitarAlerta),
    path('estadoAlerta/<int:id_alerta>/', views.cambiarEstadoAlerta),
    path('sumarseAlerta/', views.sumarseAlerta),
    path('alertas/lote/', views.alertasLote),
    path('alertas/seguir/', views.seguirRutas),

    path('rutas/', views.rutas),
    path('crearRuta/', views.crearRuta),
    path('editarRuta/<id_ruta>/', views.editarRuta),
    path('rutas/<int:id_ruta>/habilitacion/', views.habilitacionRuta),
    path('verificar_codigo_ruta/', views.verificar_codigo_ruta, name='verificar_codigo_ruta'),

    path('conductores/', views.conductores),
    path('CrearConductor/', views.crearConductor),
    path('EditarConductor/<int:id_conductor>/', views.editarConductor),
    path('conductores/<int:id_conductor>/habilitacion/', views.habilitacionConductor),
    path('verificar_cedula_conductor/', views.verificar_cedula_conductor, name='verificar_cedula_conductor'),
    path('verificar_email_conductor/', views.verificar_email_conductor, name='verificar_email_conductor'),
    path('verificar_telefono_conductor/', views.verificar_telefono_conductor, name='verificar_telefono_conductor'),
     path('verificar_placa_bus/', views.verificar_placa_bus, name='verificar_placa_bus'),
    path('buses/', views.buses),
    path('CrearBus/', views.CrearBus),
    path('EditarBus/', views.EditarBus),
    path('buses/<int:id_bus>/habilitacion/', views.habilitacionBus),

    path('turnos/', views.turnos, name='turnos'),
    path('turnos/crear/', views.crearTurno, name='crear_turno'),
    path('turnos/<int:id_turno>/editar/', views.editarTurno, name='editar_turno'),
    path('turnos/<int:id_turno>/finalizar/', views.finalizarTurno, name='finalizar_turno'),
    path('turnos/<int:id_turno>/eliminar/', views.eliminarTurno, name='eliminar_turno'),

    path('acerca_de/', views.acerca_de),
    path('terminos/', views.terminos, name='terminos'),
    path('privacidad/', views.privacidad, name='privacidad'),
    
    # ===== API APP MÓVIL =====
    path('api/login_conductor/', views.login_conductor, name='login_conductor'),
    path('api/activar_bus/', views.activar_bus, name='activar_bus'),
    path('api/desactivar_bus/', views.desactivar_bus, name='desactivar_bus'),
    path('api/enviar_ubicacion/', views.enviar_ubicacion, name='enviar_ubicacion'),
    path('api/estado_bus/<int:conductor_id>/', views.verificar_estado_ubicacion, name='estado_bus'),
    path('api/ubicaciones/', views.obtener_ubicaciones, name='obtener_ubicaciones'),
    path('api/rutas/', views.api_rutas, name='api_rutas'),
    path('api/alertas/', views.api_alertas, name='api_alertas'),

    # ===== API DE LA APP MÓVIL DE PASAJEROS (core/api_movil.py) =====
    path('api/movil/mapa/', api_movil.mapa, name='movil_mapa'),
    path('api/movil/acerca/', api_movil.acerca, name='movil_acerca'),
    path('api/movil/alertas/', api_movil.alertas, name='movil_alertas'),
    path('api/movil/alertas/rutas-cercanas/', api_movil.rutas_cercanas, name='movil_rutas_cercanas'),
    path('api/movil/alertas/cercana/', api_movil.alerta_cercana, name='movil_alerta_cercana'),
    path('api/movil/alertas/crear/', api_movil.crear_alerta, name='movil_crear_alerta'),
    path('api/movil/alertas/sumarse/', api_movil.sumarse_alerta, name='movil_sumarse_alerta'),
    path('api/movil/alertas/<int:id_alerta>/editar/', api_movil.editar_alerta, name='movil_editar_alerta'),
    path('api/movil/alertas/<int:id_alerta>/inhabilitar/', api_movil.inhabilitar_alerta,
         name='movil_inhabilitar_alerta'),
    path('api/movil/alertas/seguir/', api_movil.seguir_rutas, name='movil_seguir_rutas'),
    path('api/movil/notificaciones/', api_movil.notificaciones, name='movil_notificaciones'),
    path('api/movil/login/', api_movil.login, name='movil_login'),
    path('api/movil/yo/', api_movil.yo, name='movil_yo'),
    path('api/movil/disponible/', api_movil.disponible, name='movil_disponible'),
    path('api/movil/contrasena/', api_movil.revisar_contrasena, name='movil_revisar_contrasena'),
    path('api/movil/registro/', api_movil.registro, name='movil_registro'),
    path('api/movil/registro/verificar/', api_movil.registro_verificar, name='movil_registro_verificar'),
    path('api/movil/recuperar/', api_movil.recuperar, name='movil_recuperar'),
    path('api/movil/recuperar/verificar/', api_movil.recuperar_verificar, name='movil_recuperar_verificar'),
    path('api/movil/recuperar/nueva/', api_movil.recuperar_nueva, name='movil_recuperar_nueva'),
    path('api/movil/perfil/', api_movil.perfil, name='movil_perfil'),
    path('api/movil/perfil/correo/', api_movil.perfil_correo, name='movil_perfil_correo'),
    path('api/movil/perfil/contrasena/', api_movil.perfil_contrasena, name='movil_perfil_contrasena'),
    path('api/movil/perfil/tema/', api_movil.perfil_tema, name='movil_perfil_tema'),
    path('api/movil/perfil/eliminar/', api_movil.eliminar_cuenta, name='movil_eliminar_cuenta'),

    # ===== REPORTES =====
    path('reportes/rutas/', views.reporte_rutas, name='reporte_rutas'),
    path('reportes/buses/', views.reporte_buses, name='reporte_buses'),
    path('reportes/conductores/', views.reporte_conductores, name='reporte_conductores'),
    path('reportes/alertas/', views.reporte_alertas, name='reporte_alertas'),
    path('reportes/turnos/', views.reporte_turnos, name='reporte_turnos'),
        # ===== SIMULACIÓN =====
    path('api/configurar-simulacion/', views.api_configurar_simulacion, name='api_configurar_simulacion'),
    path('api/estado-simulacion/', views.api_estado_simulacion, name='api_estado_simulacion'),
    path('api/tiempo-llegada/', views.api_tiempo_llegada, name='api_tiempo_llegada'),
    # ===== PANEL DE SIMULACIÓN =====
    path('simulacion/', views.panel_simulacion, name='panel_simulacion'),
    path('api/toggle-simulacion/<int:bus_id>/', views.toggle_simulacion, name='toggle_simulacion'),
    path('api/cambiar-velocidad/<int:bus_id>/', views.cambiar_velocidad, name='cambiar_velocidad'),
    path('api/toggle-todos/', views.toggle_todos, name='toggle_todos'),
    path('api/resetear-bus/<int:bus_id>/', views.resetear_bus, name='resetear_bus'),
    path('api/tiempo-llegada-usuario/<int:bus_id>/', views.api_tiempo_llegada_usuario, name='api_tiempo_llegada_usuario'),
    path('api/registrar-token/', views.registrar_token_notificaciones, name='registrar_token'),    
        
]

# Archivos que suben las empresas (sus logos). En desarrollo los sirve Django; en producción debe servirlos
# el servidor web (por ejemplo, Nginx apuntando a MEDIA_ROOT)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
