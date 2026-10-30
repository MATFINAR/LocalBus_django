from .models import Usuario
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

    return {
        'usuario_perfil': usuario_perfil,
        # Empresa del administrador que inició sesión (None para pasajeros y visitantes)
        'empresa_admin': empresa_del_usuario(request),
    }
