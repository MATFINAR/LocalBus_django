"""Recorridos grabados por los conductores, para armar el trazado de una ruta con lo que de verdad hace el bus.

- La app del conductor inicia la grabación, envía los puntos del GPS por tandas y la termina. No necesita turno
  ni ruta, y lo grabado no se muestra a los pasajeros (no son UbicacionBus).
- La empresa lo carga en el editor de rutas: aquí se limpia y se convierte en ida, retorno, vuelta y puntos de
  paso, para ajustarlo como cualquier otro trazado.
"""
import json
import math
from datetime import timedelta

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .mensajes import _conductor_con_token
from .models import RecorridoGrabado
from .permisos import admin_empresa_required
from .utils.horas import hora12

PUNTOS_POR_ENVIO = 500
MAX_PUNTOS = 20000             # unas 16 horas enviando un punto cada 3 segundos
HORAS_ABANDONADO = 12          # una grabación abierta más tiempo se da por terminada
METROS_MINIMOS_ENTRE_PUNTOS = 8
METROS_FIN_ES_INICIO = 150
# Pocos puntos de paso: con el error del GPS, cada uno puede caer en la calzada contraria y obligar a un rodeo
METROS_ENTRE_PASOS = 2500
MAX_PASOS_POR_TRAMO = 8


def _metros(a, b):
    """Distancia entre dos [lng, lat] (haversine)."""
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def _largo(coords):
    return sum(_metros(a, b) for a, b in zip(coords, coords[1:]))


def _resumen(recorrido):
    inicio = timezone.localtime(recorrido.inicio)
    return {
        'id': recorrido.pk, 'fecha': inicio.strftime('%d/%m/%Y'), 'hora': hora12(recorrido.inicio),
        'conductor': recorrido.conductor.nombre, 'bus': recorrido.bus.placa if recorrido.bus else '',
        'km': round(recorrido.distancia_km, 1), 'minutos': recorrido.minutos, 'puntos': len(recorrido.puntos),
        'en_curso': recorrido.fin is None, 'retorno_marcado': recorrido.indice_retorno is not None,
    }


def _cerrar_abandonados(conductor):
    limite = timezone.now() - timedelta(hours=HORAS_ABANDONADO)
    RecorridoGrabado.objects.filter(conductor=conductor, fin__isnull=True, inicio__lt=limite).update(
        fin=timezone.now(), habilitado=False)


def _abierto(conductor):
    return RecorridoGrabado.objects.filter(conductor=conductor, fin__isnull=True).select_related('bus').first()


# ================= API DE LA APP DEL CONDUCTOR =================

@csrf_exempt
def api_recorrido(request):
    """GET: la grabación en curso (o null), para retomarla si la app se cerró."""
    conductor, error = _conductor_con_token(request)
    if error:
        return error
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    _cerrar_abandonados(conductor)
    abierto = _abierto(conductor)
    return JsonResponse({'recorrido': _resumen(abierto) if abierto else None})


@csrf_exempt
@require_POST
def api_iniciar(request):
    """Empieza a grabar. Si ya había una grabación en curso, devuelve esa."""
    conductor, error = _conductor_con_token(request)
    if error:
        return error
    _cerrar_abandonados(conductor)
    abierto = _abierto(conductor)
    if abierto:
        return JsonResponse({'recorrido': _resumen(abierto)})
    nuevo = RecorridoGrabado.objects.create(empresa=conductor.empresa, conductor=conductor, bus=conductor.bus_asignado)
    return JsonResponse({'recorrido': _resumen(nuevo)}, status=201)


def _puntos_validos(lista):
    """[{"latitud", "longitud", "retorno"?}] -> [([lng, lat], es_retorno)], descartando lo que no sean
    coordenadas."""
    puntos = []
    for p in lista:
        try:
            lat, lng = float(p['latitud']), float(p['longitud'])
        except (TypeError, ValueError, KeyError):
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            puntos.append(([round(lng, 6), round(lat, 6)], p.get('retorno') is True))
    return puntos


@csrf_exempt
@require_POST
def api_puntos(request, id_recorrido):
    """{"puntos": [{"latitud": 6.2, "longitud": -75.5}, ...]} en el orden en que se tomaron. El punto donde el
    conductor pulsa "Marcar retorno" lleva además "retorno": true (si lo marca otra vez, vale el último)."""
    conductor, error = _conductor_con_token(request)
    if error:
        return error
    try:
        lista = json.loads(request.body or b'{}').get('puntos')
    except (ValueError, UnicodeDecodeError, AttributeError):
        lista = None
    if not isinstance(lista, list) or not lista or len(lista) > PUNTOS_POR_ENVIO:
        return JsonResponse({'error': f'Envía entre 1 y {PUNTOS_POR_ENVIO} puntos en "puntos".'}, status=400)

    with transaction.atomic():
        recorrido = (RecorridoGrabado.objects.select_for_update()
                     .filter(pk=id_recorrido, conductor=conductor).first())
        if recorrido is None:
            return JsonResponse({'error': 'Esa grabación no existe.'}, status=404)
        if recorrido.fin is not None:
            return JsonResponse({'error': 'Esa grabación ya terminó.'}, status=409)
        metros = 0
        puntos = recorrido.puntos
        for punto, es_retorno in _puntos_validos(lista):
            if len(puntos) >= MAX_PUNTOS:
                break
            avance = _metros(puntos[-1], punto) if puntos else 0
            # Detenido, el GPS "baila" alrededor del mismo sitio: esos puntos no aportan
            if not puntos or avance >= METROS_MINIMOS_ENTRE_PUNTOS:
                metros += avance
                puntos.append(punto)
            if es_retorno:
                recorrido.indice_retorno = len(puntos) - 1
        recorrido.distancia_km += metros / 1000
        recorrido.save(update_fields=['puntos', 'distancia_km', 'indice_retorno'])
    return JsonResponse({'puntos': len(puntos), 'km': round(recorrido.distancia_km, 2),
                         'retorno_marcado': recorrido.indice_retorno is not None})


@csrf_exempt
@require_POST
def api_terminar(request, id_recorrido):
    conductor, error = _conductor_con_token(request)
    if error:
        return error
    recorrido = (RecorridoGrabado.objects.filter(pk=id_recorrido, conductor=conductor)
                 .select_related('conductor', 'bus').first())
    if recorrido is None:
        return JsonResponse({'error': 'Esa grabación no existe.'}, status=404)
    if recorrido.fin is None:
        recorrido.fin = timezone.now()
        recorrido.save(update_fields=['fin'])
    return JsonResponse({'recorrido': _resumen(recorrido)})


# ================= EDITOR DE RUTAS (empresa) =================

def _sin_saltos(coords):
    """Quita los saltos del GPS: un punto muy lejos de sus vecinos, que entre sí están cerca."""
    limpio = coords[:1]
    for i in range(1, len(coords) - 1):
        ida = _metros(limpio[-1], coords[i])
        if ida > 200 and _metros(limpio[-1], coords[i + 1]) < ida / 2:
            continue
        limpio.append(coords[i])
    return limpio + coords[-1:] if len(coords) > 1 else limpio


def _pasos(tramo):
    """Puntos de paso repartidos a lo largo del tramo (sin sus extremos), para poder ajustarlo en el editor."""
    largo = _largo(tramo)
    cuantos = min(MAX_PASOS_POR_TRAMO, int(largo // METROS_ENTRE_PASOS))
    if not cuantos:
        return []
    cada, acumulado, pasos = largo / (cuantos + 1), 0, []
    for a, b in zip(tramo, tramo[1:]):
        acumulado += _metros(a, b)
        if acumulado >= cada * (len(pasos) + 1) and len(pasos) < cuantos:
            pasos.append(b)
    return pasos


def procesar(coords, marcado=None):
    """Puntos grabados -> trazado para el editor, o None si son muy pocos.

    El retorno es el que marcó el conductor (`marcado`, índice en `coords`) o, si no lo marcó, el punto más lejano
    del inicio. Si ese punto es el final, solo se grabó la ida: `indice_retorno` es None y el editor traza la
    vuelta por las calles."""
    punto_marcado = coords[marcado] if marcado is not None and 0 <= marcado < len(coords) else None
    coords = _sin_saltos(coords)
    if len(coords) < 10 or _largo(coords) < 300:
        return None
    lejos = max(range(len(coords)), key=lambda i: _metros(coords[0], coords[i]))
    retorno_marcado = False
    if punto_marcado:
        # Al quitar saltos del GPS los índices se corren: se busca el punto marcado en lo que quedó
        i = min(range(len(coords)), key=lambda k: (_metros(coords[k], punto_marcado), abs(k - marcado)))
        # Marcado pegado al inicio: fue sin querer, se calcula
        if _largo(coords[:i + 1]) >= 100:
            lejos, retorno_marcado = i, True
    solo_ida = _largo(coords[lejos:]) < (100 if retorno_marcado else 0.1 * _largo(coords))
    ida = coords if solo_ida else coords[:lejos + 1]
    vuelta = [] if solo_ida else coords[lejos:]
    puntos_paso = {nombre: p for nombre, p in (('ida', _pasos(ida)), ('vuelta', _pasos(vuelta) if vuelta else [])) if p}
    return {
        'coordenadas': coords,
        'indice_retorno': None if solo_ida else lejos,
        'fin_es_origen': solo_ida or _metros(coords[0], coords[-1]) <= METROS_FIN_ES_INICIO,
        'puntos_paso': puntos_paso,
        'retorno_marcado': retorno_marcado,
        'km': round(_largo(coords) / 1000, 2),
    }


@admin_empresa_required
@require_GET
def lista(request):
    recorridos = (request.empresa.recorridos.filter(habilitado=True)
                  .select_related('conductor', 'bus').order_by('-inicio')[:50])
    return JsonResponse({'recorridos': [_resumen(r) for r in recorridos]})


@admin_empresa_required
@require_GET
def detalle(request, id_recorrido):
    recorrido = request.empresa.recorridos.filter(pk=id_recorrido, habilitado=True).first()
    if recorrido is None:
        return JsonResponse({'error': 'Ese recorrido no existe.'}, status=404)
    if recorrido.fin is None:
        return JsonResponse({'error': 'El conductor todavía está grabando este recorrido.'}, status=409)
    datos = procesar(recorrido.puntos, recorrido.indice_retorno)
    if datos is None:
        return JsonResponse({'error': 'El recorrido es muy corto para armar una ruta (menos de 300 m o muy pocos '
                                      'puntos).'}, status=400)
    return JsonResponse({**datos, 'minutos': recorrido.minutos})


@admin_empresa_required
@require_POST
def descartar(request, id_recorrido):
    """No se borra: se inhabilita y deja de salir en la lista."""
    if not request.empresa.recorridos.filter(pk=id_recorrido).update(habilitado=False):
        return JsonResponse({'error': 'Ese recorrido no existe.'}, status=404)
    return JsonResponse({'ok': True})
