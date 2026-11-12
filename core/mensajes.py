"""Chat entre la empresa y sus conductores.

- Cada conductor tiene UNA conversación con su empresa (modelo Mensaje).
- Un mensaje a un grupo (Difusion) se copia en la conversación de cada conductor del grupo: así lo ve en su
  chat y puede responder en privado. Los grupos se calculan con los turnos en el momento de enviar.
- La web de la empresa consulta cada pocos segundos si hay mensajes nuevos; la app del conductor usa la API
  /api/conductor/mensajes/ con su token y recibe una notificación push cuando la empresa le escribe.
"""
from datetime import datetime, time, timedelta

from django.contrib import messages
from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .models import Difusion, Mensaje, Turno, enviar_push_mensajes
from .permisos import admin_empresa_required, conductor_de_la_peticion
from .utils.horas import hora12
from .views import COLORES_RUTA, _marcar_estado_conductores, _texto_del_dia

MAX_TEXTO = 1000
# Cuántos mensajes de una conversación se cargan al abrirla
ULTIMOS = 200


def _texto_limpio(valor):
    """Texto del mensaje sin espacios sobrantes; (texto, error)."""
    texto = (valor or '').strip()
    if not texto:
        return '', 'Escribe el mensaje antes de enviarlo.'
    if len(texto) > MAX_TEXTO:
        return '', f'El mensaje puede tener hasta {MAX_TEXTO} caracteres; este tiene {len(texto)}. Acórtalo.'
    return texto, None


def _quiere_json(request):
    return request.headers.get('X-Requested-With') == 'fetch' or 'application/json' in request.headers.get('Accept', '')


# ================= GRUPOS =================

def destinatarios(empresa, grupo, ruta_id=None, fecha=None):
    """(conductores habilitados del grupo, descripción del destino, error). Los turnos deciden quién está en
    cada grupo en este momento."""
    if grupo not in Difusion.GRUPOS:
        return [], '', 'Elige a quién va el mensaje.'
    base = empresa.conductores.filter(habilitado=True)
    ahora = timezone.now()
    ruta = None
    if grupo in ('ruta_ahora', 'ruta_dia'):
        ruta = empresa.rutas.filter(pk=ruta_id).first() if str(ruta_id or '').isdigit() else None
        if ruta is None:
            return [], '', 'Elige la ruta.'

    if grupo == 'todos':
        ids, destino = None, 'Todos los conductores'
    elif grupo in ('en_curso', 'ruta_ahora'):
        turnos = Turno.vigentes(ahora).filter(bus__empresa=empresa)
        if ruta:
            turnos = turnos.filter(ruta=ruta)
        ids = set(turnos.values_list('conductor_id', flat=True))
        destino = f'En turno ahora en {ruta.codigo} · {ruta.nombre}' if ruta else 'Conductores con turno en curso'
    else:
        if grupo == 'hoy':
            dia = timezone.localdate()
        else:
            try:
                dia = datetime.strptime(fecha or '', '%Y-%m-%d').date()
            except ValueError:
                return [], '', 'Elige el día.'
        inicio = timezone.make_aware(datetime.combine(dia, time.min))
        turnos = Turno.que_se_cruzan(inicio, inicio + timedelta(days=1)).filter(bus__empresa=empresa)
        if ruta:
            turnos = turnos.filter(ruta=ruta)
        ids = set(turnos.values_list('conductor_id', flat=True))
        destino = (f'{ruta.codigo} · {ruta.nombre}, {_texto_del_dia(dia)}' if ruta
                   else f'Con turno hoy, {_texto_del_dia(dia)}')
    conductores = list((base if ids is None else base.filter(pk__in=ids)).order_by('nombre'))
    return conductores, destino[:200], None


# ================= PÁGINA DE LA EMPRESA =================

def _conversaciones(empresa):
    """Todos los conductores de la empresa con su último mensaje, los no leídos y su estado de ahora."""
    ultimo = Mensaje.objects.filter(conductor=OuterRef('pk')).order_by('-creado', '-id_mensaje')
    conductores = list(empresa.conductores.annotate(
        ultimo_texto=Subquery(ultimo.values('texto')[:1]),
        ultimo_creado=Subquery(ultimo.values('creado')[:1]),
        ultimo_de_empresa=Subquery(ultimo.values('de_empresa')[:1]),
        sin_leer=Count('mensajes', filter=Q(mensajes__de_empresa=False, mensajes__leido__isnull=True)),
    ))
    _marcar_estado_conductores(conductores, empresa)
    lejano = timezone.make_aware(datetime(2000, 1, 1))
    # Primero los que tienen mensajes sin leer, luego los de conversación más reciente; inhabilitados al final
    conductores.sort(key=lambda c: (not c.habilitado, c.sin_leer == 0, -(c.ultimo_creado or lejano).timestamp(),
                                    c.nombre.lower()))
    for c in conductores:
        c.ruta_codigo = c.turno.ruta.codigo if c.turno else ''
        c.ultimo_hora = _cuando(c.ultimo_creado) if c.ultimo_creado else ''
        c.iniciales = ''.join(p[0] for p in c.nombre.split()[:2]).upper() or '?'
    return conductores


def _cuando(momento):
    """"3:05 p. m." si es de hoy, "Ayer", o "09/11"."""
    local = timezone.localtime(momento)
    hoy = timezone.localdate()
    if local.date() == hoy:
        return hora12(local)
    if local.date() == hoy - timedelta(days=1):
        return 'Ayer'
    return local.strftime('%d/%m')


def _marcar_leidos(conductor):
    """La empresa abrió la conversación: los mensajes del conductor quedan leídos."""
    return Mensaje.objects.filter(conductor=conductor, de_empresa=False, leido__isnull=True).update(leido=timezone.now())


@admin_empresa_required
def mensajes(request):
    empresa = request.empresa
    conductores = _conversaciones(empresa)
    actual = None
    hilo = []
    id_actual = request.GET.get('c', '')
    if id_actual.isdigit():
        actual = next((c for c in conductores if c.pk == int(id_actual)), None)
    if actual:
        if _marcar_leidos(actual):
            actual.sin_leer = 0
        hilo = list(Mensaje.objects.filter(conductor=actual).select_related('difusion')
                    .order_by('-creado', '-id_mensaje')[:ULTIMOS])[::-1]
        dia_anterior = None
        for m in hilo:
            dia = timezone.localtime(m.creado).date()
            m.nuevo_dia = _texto_del_dia(dia) if dia != dia_anterior else ''
            m.hora = hora12(m.creado)
            dia_anterior = dia
    rutas = list(empresa.rutas.filter(habilitado=True).order_by('codigo'))
    for r in rutas:
        r.color = COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)]
    return render(request, 'core/mensajes.html', {
        'conductores': conductores,
        'actual': actual,
        'hilo': hilo,
        'ultimo_id': hilo[-1].id_mensaje if hilo else 0,
        'rutas': rutas,
        'grupos': Difusion.GRUPOS,
        'hoy': timezone.localdate(),
        'difusiones': empresa.difusiones.annotate(total=Count('mensajes'))[:8],
        'max_texto': MAX_TEXTO,
        'total_sin_leer': sum(c.sin_leer for c in conductores),
    })


@admin_empresa_required
@require_GET
def mensajes_nuevos(request, id_conductor):
    """Para la consulta periódica de la página: mensajes de la conversación abierta después de `desde`
    y los no leídos de cada conductor (para los números de la lista)."""
    conductor = request.empresa.conductores.filter(pk=id_conductor).first() if id_conductor else None
    nuevos = []
    leidos_hasta = 0
    if conductor:
        desde = request.GET.get('desde', '0')
        desde = int(desde) if desde.isdigit() else 0
        _marcar_leidos(conductor)
        nuevos = [m.como_dict() for m in Mensaje.objects.filter(conductor=conductor, id_mensaje__gt=desde)
                  .select_related('difusion').order_by('creado', 'id_mensaje')[:ULTIMOS]]
        # El conductor lee todo de una vez: los mensajes de la empresa hasta este id ya los leyó
        leidos_hasta = (Mensaje.objects.filter(conductor=conductor, de_empresa=True, leido__isnull=False)
                        .order_by('-id_mensaje').values_list('id_mensaje', flat=True).first() or 0)
    sin_leer = dict(Mensaje.objects.filter(conductor__empresa=request.empresa, de_empresa=False, leido__isnull=True)
                    .values_list('conductor_id').annotate(n=Count('id_mensaje')))
    return JsonResponse({'mensajes': nuevos, 'leidos_hasta': leidos_hasta,
                         'sin_leer': {str(k): v for k, v in sin_leer.items()}})


@admin_empresa_required
@require_POST
def enviar_mensaje(request, id_conductor):
    conductor = request.empresa.conductores.filter(pk=id_conductor).first()
    volver = f'/mensajes/?c={id_conductor}'
    error = None
    if conductor is None:
        error, volver = 'Ese conductor no es de tu empresa.', '/mensajes/'
    elif not conductor.habilitado:
        error = f'{conductor.nombre} está inhabilitado: no puede recibir mensajes. Habilítalo en Conductores.'
    texto, problema = _texto_limpio(request.POST.get('texto'))
    error = error or problema
    if error:
        if _quiere_json(request):
            return JsonResponse({'error': error}, status=400)
        messages.error(request, error)
        return redirect(volver)

    mensaje = Mensaje.objects.create(conductor=conductor, de_empresa=True, enviado_por=request.user, texto=texto)
    transaction.on_commit(lambda: enviar_push_mensajes([mensaje.pk]))
    if _quiere_json(request):
        return JsonResponse({'mensaje': mensaje.como_dict()})
    return redirect(volver)


@admin_empresa_required
@require_GET
def ver_destinatarios(request):
    """Vista previa del grupo en la ventana "Mensaje a un grupo": cuántos y quiénes lo recibirán."""
    conductores, destino, error = destinatarios(request.empresa, request.GET.get('grupo'),
                                                request.GET.get('ruta'), request.GET.get('fecha'))
    if error:
        return JsonResponse({'error': error}, status=400)
    return JsonResponse({'total': len(conductores), 'destino': destino,
                         'nombres': [c.nombre for c in conductores]})


@admin_empresa_required
@require_POST
def enviar_a_grupo(request):
    empresa = request.empresa
    conductores, destino, error = destinatarios(empresa, request.POST.get('grupo'),
                                                request.POST.get('ruta'), request.POST.get('fecha'))
    texto, problema = _texto_limpio(request.POST.get('texto'))
    error = error or problema
    if not error and not conductores:
        error = f'Nadie recibiría este mensaje: no hay conductores habilitados en «{destino}».'
    if error:
        if _quiere_json(request):
            return JsonResponse({'error': error}, status=400)
        messages.error(request, error)
        return redirect('/mensajes/')

    with transaction.atomic():
        difusion = Difusion.objects.create(empresa=empresa, enviado_por=request.user,
                                           grupo=request.POST.get('grupo'), destino=destino, texto=texto)
        creados = Mensaje.objects.bulk_create([
            Mensaje(conductor=c, de_empresa=True, enviado_por=request.user, difusion=difusion, texto=texto)
            for c in conductores])
    ids = [m.pk for m in creados if m.pk] or list(difusion.mensajes.values_list('pk', flat=True))
    transaction.on_commit(lambda: enviar_push_mensajes(ids))
    aviso = f'Mensaje enviado a {len(conductores)} conductor{"es" if len(conductores) != 1 else ""} ({destino}).'
    if _quiere_json(request):
        return JsonResponse({'ok': True, 'aviso': aviso, 'total': len(conductores)})
    messages.success(request, aviso)
    return redirect(request.POST.get('volver') if str(request.POST.get('volver', '')).startswith('/mensajes/')
                    else '/mensajes/')


# ================= API DE LA APP DEL CONDUCTOR =================

def _conductor_con_token(request):
    """Los mensajes son privados: aquí se exige el token (no se acepta la forma antigua con conductor_id)."""
    if not request.headers.get('Authorization', '').startswith('Bearer '):
        return None, JsonResponse({'error': 'Falta el token de sesión. Vuelve a iniciar sesión.'}, status=401)
    return conductor_de_la_peticion(request)


@csrf_exempt
def api_mensajes(request):
    """GET: conversación del conductor con su empresa (?desde=<id> para traer solo los nuevos).
    POST {"texto": "..."}: el conductor responde a su empresa."""
    conductor, error = _conductor_con_token(request)
    if error:
        return error

    if request.method == 'GET':
        desde = request.GET.get('desde', '0')
        consulta = Mensaje.objects.filter(conductor=conductor).select_related('difusion')
        if desde.isdigit() and int(desde) > 0:
            lista = list(consulta.filter(id_mensaje__gt=int(desde)).order_by('creado', 'id_mensaje')[:ULTIMOS])
        else:
            lista = list(consulta.order_by('-creado', '-id_mensaje')[:ULTIMOS])[::-1]
        return JsonResponse({
            'empresa': conductor.empresa.nombre,
            'mensajes': [m.como_dict() for m in lista],
            'sin_leer': Mensaje.objects.filter(conductor=conductor, de_empresa=True, leido__isnull=True).count(),
        })

    if request.method == 'POST':
        import json
        try:
            datos = json.loads(request.body or b'{}')
        except (ValueError, UnicodeDecodeError):
            datos = None
        if not isinstance(datos, dict):
            return JsonResponse({'error': 'El cuerpo debe ser un objeto JSON, por ejemplo {"texto": "Hola"}'}, status=400)
        texto, problema = _texto_limpio(datos.get('texto') if isinstance(datos.get('texto'), str) else '')
        if problema:
            return JsonResponse({'error': problema}, status=400)
        mensaje = Mensaje.objects.create(conductor=conductor, de_empresa=False, texto=texto)
        return JsonResponse({'mensaje': mensaje.como_dict()}, status=201)

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@csrf_exempt
@require_POST
def api_mensajes_leidos(request):
    """El conductor abrió el chat en la app: los mensajes de la empresa quedan leídos."""
    conductor, error = _conductor_con_token(request)
    if error:
        return error
    total = Mensaje.objects.filter(conductor=conductor, de_empresa=True, leido__isnull=True).update(leido=timezone.now())
    return JsonResponse({'ok': True, 'marcados': total})
