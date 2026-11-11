"""Middleware propios de LocalBus."""


class UnaSolaCuenta:
    """Una sesión no puede tener abiertas a la vez una cuenta de usuario y una de empresa.

    Al iniciar sesión ya se cierra la otra cuenta (ver views.login). Esto cubre las sesiones que quedaron con las dos
    abiertas de antes de ese cambio: se conserva la de empresa y se cierra la de usuario.
    Va después de AuthenticationMiddleware, que es el que deja `request.user`.
    """

    CLAVES_USUARIO = ('usuario_id', 'usuario_nombre', 'mostrar_bienvenida')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        usuario = getattr(request, 'user', None)
        if usuario is not None and usuario.is_authenticated and request.session.get('usuario_id'):
            for clave in self.CLAVES_USUARIO:
                request.session.pop(clave, None)
        return self.get_response(request)
