from .models import Mensaje, Usuario
from .permisos import empresa_del_usuario

def usuario_actual(request):
    """
    Hace disponible el usuario logueado en todos los templates.
    """

    usuario_perfil = None
    usuario_id = request.session.get('usuario_id')

    if usuario_id:
        try:
            usuario_perfil = Usuario.objects.get(id_usuario=usuario_id)
        except Usuario.DoesNotExist:
            usuario_perfil = None

    empresa = empresa_del_usuario(request)
    # Ajustes de la cuenta que tiene la sesión abierta (pasajero o administrador): la página los lee de aquí
    administrador = request.user.administrador if empresa else None
    cuenta = administrador or usuario_perfil
    return {
        'ajustes': {
            'desplazamiento': (cuenta.desplazamiento_mapa if cuenta else '') or 'barra',
            'tema': cuenta.tema if cuenta else 'sistema',
        },
        'administrador_cuenta': administrador,
        # Mensajes de conductores que la empresa aún no ha leído (el número junto a "Mensajes" en el menú)
        'mensajes_sin_leer': Mensaje.objects.filter(conductor__empresa=empresa, de_empresa=False,
                                                    leido__isnull=True).count() if empresa else 0,
        'usuario_perfil': usuario_perfil,
        # Empresa del administrador que inició sesión (None para pasajeros y visitantes)
        'empresa_admin': empresa,
        # Nombre de la persona que administra (el menú lo muestra junto al logo de la empresa)
        'admin_nombre': (request.user.get_full_name() or request.user.get_username()) if empresa else '',
    }
