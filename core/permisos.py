from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.http import JsonResponse


def empresa_del_usuario(request):
    """Empresa que administra el usuario de Django que inició sesión, o None."""
    user = getattr(request, 'user', None)
    if not user or not user.is_authenticated:
        return None
    administrador = getattr(user, 'administrador', None)
    if administrador is None or not administrador.empresa.activa:
        return None
    return administrador.empresa


def admin_empresa_required(vista):
    """Exige un administrador de empresa y deja la empresa en `request.empresa`.

    A las peticiones de API (JSON) les responde 403 en vez de redirigir al login.
    """
    @wraps(vista)
    def envoltura(request, *args, **kwargs):
        empresa = empresa_del_usuario(request)
        if empresa is None:
            if request.path.startswith('/api/') or request.content_type == 'application/json':
                return JsonResponse({'error': 'Debes iniciar sesión como administrador de empresa.'}, status=403)
            return redirect_to_login(request.get_full_path())
        request.empresa = empresa
        return vista(request, *args, **kwargs)
    return envoltura
