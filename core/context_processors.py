from .models import Usuario

def usuario_actual(request):
    """Hace disponible el usuario logueado en TODOS los templates"""
    usuario_id = request.session.get('usuario_id')
    if usuario_id:
        try:
            return {'usuario_perfil': Usuario.objects.get(id_usuario=usuario_id)}
        except Usuario.DoesNotExist:
            return {'usuario_perfil': None}
    return {'usuario_perfil': None}