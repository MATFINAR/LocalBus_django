"""Panel de la empresa: lo primero que ve un administrador al iniciar sesión.

Cada gráfica tiene una clave (GRAFICAS). El administrador elige cuáles ver y en qué orden (Personalizar);
la elección se guarda en Administrador.panel_graficas. Solo se calculan las gráficas elegidas, y los estados
salen de las mismas funciones que usan las listas de buses, conductores y rutas, para que las cifras coincidan.

Las gráficas "de hoy" cuentan las jornadas del día en curso, igual que la página de Turnos: un bus, conductor o
ruta está "En curso" si alguna de sus jornadas de hoy se está cubriendo, "Programado" si todavía no empieza,
"Finalizado" si ya terminó y "Sin turno" si no tiene ninguna.
"""
from collections import Counter
from datetime import datetime, time, timedelta
from functools import cached_property

from django.contrib import messages
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import Alerta, Ruta, Turno
from .permisos import admin_empresa_required
from .utils.horas import hora12
from .utils.panel_pdf import crear_reporte_panel
from .utils.reportes import nombre_archivo
from .views import (COLORES_RUTA, _estado_reporte_ruta, _marcar_estado_buses, _marcar_estado_conductores,
                    _parte_estado_conductor, _texto_del_dia)

# clave: (título, para qué sirve, grupo). El orden es el del menú Personalizar.
# Las claves 'flota', 'conductores', 'rutas', 'servicio_hora', 'alertas_estado', 'alertas_dias' y 'alertas_ruta'
# ya existían: se mantienen para no perder lo que cada administrador eligió.
GRAFICAS = {
    'resumen': ('Resumen', 'Contadores de cada vista y de lo que necesita atención; cada uno lleva a su vista.', 'Resumen'),

    'alertas_estado': ('Alertas por estado', 'Últimos 30 días: cuántas esperan revisión, están en proceso o se resolvieron.', 'Alertas'),
    'alertas_ruta': ('Alertas por ruta', 'Últimos 30 días: dónde se concentran los problemas que reportan los pasajeros.', 'Alertas'),
    'alertas_tipo': ('Alertas por tipo', 'Últimos 30 días: cuántas son demoras, advertencias o información.', 'Alertas'),
    'alertas_dias': ('Alertas por día', 'Alertas nuevas cada día en tus rutas; tú eliges ver los últimos 7 o 15 días.', 'Alertas'),

    'rutas': ('Rutas por estado', 'Rutas operando, sin buses activos, fuera de horario o fuera de servicio.', 'Rutas'),
    'rutas_buses': ('Rutas por cantidad de buses', 'Cuántas rutas habilitadas pueden cubrir 0, 1, 2, 3 o más buses.', 'Rutas'),
    'rutas_turno': ('Rutas por estado de turno, hoy', 'Rutas con turnos en curso, programados, ya terminados o sin ningún turno hoy.', 'Rutas'),
    'rutas_mapa': ('Mapa de rutas', 'El recorrido de cada ruta, con su color y su estado, como en Rutas.', 'Rutas'),

    'flota': ('Buses por estado', 'Qué parte de la flota transmite, está en turno, está libre o inhabilitada.', 'Buses'),
    'buses_turno': ('Buses por estado de turno, hoy', 'Buses con turno en curso, programado, ya terminado o sin turno hoy.', 'Buses'),
    'buses_cant_rutas': ('Buses por cantidad de rutas', 'Cuántos buses pueden cubrir 0, 1, 2, 3 o más rutas.', 'Buses'),
    'buses_rutas': ('Buses por ruta', 'Cuántos buses pueden cubrir cada ruta; en rojo, las que no tienen ninguno.', 'Buses'),
    'buses_sin_transmitir': ('Buses con turno sin transmitir ubicación', 'De los buses con turno ahora, cuáles no están enviando su ubicación.', 'Buses'),
    'buses_sin_rutas': ('Buses sin rutas', 'Buses habilitados que aún no tienen ninguna ruta asignada.', 'Buses'),

    'conductores': ('Conductores por estado', 'Quién está en turno y si su bus comparte la ubicación.', 'Conductores'),
    'conductores_turno': ('Conductores por estado de turno, hoy', 'Conductores con turno en curso, programado, ya terminado o sin turno hoy.', 'Conductores'),
    'conductores_sin_transmitir': ('Conductores con turno sin transmitir ubicación', 'De los conductores en turno ahora, a quiénes no se les ve en el mapa.', 'Conductores'),

    'turnos_estado': ('Turnos por estado, hoy', 'Turnos de hoy en curso, programados o ya finalizados.', 'Turnos'),
    'turnos_buses': ('Turnos por bus, hoy', 'Cuántos turnos tiene hoy cada bus.', 'Turnos'),
    'turnos_rutas': ('Turnos por ruta, hoy', 'Cuántos turnos tiene hoy cada ruta; en rojo, las que nadie cubre.', 'Turnos'),
    'servicio_hora': ('Buses en servicio por hora, hoy', 'Cuántos buses tienen turno en cada hora del día: muestra horas pico y huecos.', 'Turnos'),
    'turnos_tiempo': ('Línea de tiempo de turnos, hoy', 'Una fila por bus con sus turnos sobre las 24 horas, como en Turnos.', 'Turnos'),
}
# Las que ve quien aún no ha personalizado su panel
PREDETERMINADAS = ['resumen', 'flota', 'conductores', 'rutas', 'turnos_estado', 'alertas_estado', 'alertas_dias', 'servicio_hora']
# Ocupan todo el ancho del panel
ANCHAS = {'resumen', 'servicio_hora', 'turnos_tiempo', 'rutas_mapa'}

VERDE, AZUL, TINTA, GRIS, LINEA, ROJO, AMARILLO = (
    'var(--verde)', 'var(--azul)', 'var(--tinta)', 'var(--gris-texto)', 'var(--linea)', 'var(--rojo-interfaz)',
    'var(--amarillo)')

# Estados de turno de hoy, del más importante al menos importante (si un bus tiene dos, cuenta el primero)
ORDEN_TURNO = {'En curso': 0, 'Programado': 1, 'Finalizado': 2}
COLORES_TURNO = {'En curso': VERDE, 'Programado': AZUL, 'Finalizado': GRIS, 'Sin turno': LINEA}
# Dona de "estado de turno, hoy": nombre en la leyenda de cada estado
NOMBRES_TURNO = {'En curso': 'En curso', 'Programado': 'Programado', 'Finalizado': 'Finalizado',
                 'Sin turno': 'Sin turno hoy'}
# Cuántas placas o nombres se listan debajo de una dona
MAX_LISTA = 12
MAX_BARRAS = 10
DIAS_ALERTAS = (7, 15)


def seleccion_de(administrador):
    """Claves válidas elegidas por el administrador, en su orden; las predeterminadas si nunca eligió
    (o si todo lo que eligió ya no existe)."""
    if administrador.panel_graficas is None:
        return list(PREDETERMINADAS)
    vistas = []
    for clave in administrador.panel_graficas:
        if clave in GRAFICAS and clave not in vistas:
            vistas.append(clave)
    if not vistas and administrador.panel_graficas:
        return list(PREDETERMINADAS)
    return vistas


def _plural(n, singular, plural):
    return f'{n} {singular if n == 1 else plural}'


def _dona(partes, etiqueta, vacio='', lista=None):
    """partes: [(nombre, valor, color)]. Arcos de una circunferencia de largo 100 (r = 15,915).
    lista: {'titulo', 'items', 'mas'} para nombrar debajo a quiénes cuenta un grupo (por ejemplo, las placas)."""
    total = sum(valor for _, valor, _ in partes)
    arcos, acumulado = [], 0
    for nombre, valor, color in partes:
        pct = valor * 100 / total if total else 0
        arcos.append({'nombre': nombre, 'valor': valor, 'color': color, 'pct': round(pct),
                      'largo': f'{pct:.3f}', 'resto': f'{100 - pct:.3f}', 'desfase': f'{25 - acumulado:.3f}'})
        acumulado += pct
    return {'tipo': 'dona', 'total': total, 'etiqueta': etiqueta, 'partes': arcos,
            'vacio': vacio or f'Aún no hay {etiqueta} para mostrar.', 'lista': lista,
            'resumen': ', '.join(f'{p["valor"]} {p["nombre"].lower()}' for p in arcos)}


def _lista(titulo, nombres, placas=False):
    """Grupo de nombres o placas que se muestra debajo de una dona. None si no hay a quién nombrar."""
    if not nombres:
        return None
    return {'titulo': titulo, 'items': nombres[:MAX_LISTA], 'mas': max(0, len(nombres) - MAX_LISTA), 'placas': placas}


def _barras(items, vacio):
    """items: [(nombre, valor, texto del valor, color)] en barras horizontales."""
    maximo = max((valor for _, valor, _, _ in items), default=0)
    return {'tipo': 'barras', 'vacio': vacio, 'items': [
        {'nombre': nombre, 'valor': valor, 'texto': texto, 'color': color,
         'pct': round(valor * 100 / maximo) if maximo else 0} for nombre, valor, texto, color in items]}


def _columnas(items, vacio, total_texto=''):
    """items: [(etiqueta, valor, color, título accesible, resaltar)] en columnas."""
    maximo = max((valor for _, valor, _, _, _ in items), default=0)
    return {'tipo': 'columnas', 'vacio': vacio if not maximo else '', 'total_texto': total_texto, 'items': [
        {'etiqueta': etiqueta, 'valor': valor, 'color': color, 'titulo': titulo, 'resaltar': resaltar,
         'pct': round(valor * 100 / maximo) if maximo else 0} for etiqueta, valor, color, titulo, resaltar in items]}


def _etiqueta_hora(hora):
    return f'{hora % 12 or 12} {"a. m." if hora < 12 else "p. m."}'


class DatosPanel:
    """Calcula solo lo que piden las gráficas elegidas; lo compartido (buses, jornadas…) se consulta una vez."""

    def __init__(self, empresa):
        self.empresa = empresa
        self.ahora = timezone.now()
        self.hoy = timezone.localdate()
        self.inicio_hoy = timezone.make_aware(datetime.combine(self.hoy, time.min))
        self.fin_hoy = self.inicio_hoy + timedelta(days=1)

    # ---------- Datos compartidos ----------
    @cached_property
    def buses(self):
        return _marcar_estado_buses(list(self.empresa.buses.prefetch_related('rutas').order_by('placa')), self.empresa)

    @cached_property
    def buses_habilitados(self):
        return [b for b in self.buses if b.habilitado]

    @cached_property
    def conductores_todos(self):
        conductores = list(self.empresa.conductores.order_by('nombre'))
        _marcar_estado_conductores(conductores, self.empresa)
        return conductores

    @cached_property
    def conductores_habilitados(self):
        return [c for c in self.conductores_todos if c.habilitado]

    @cached_property
    def rutas_todas(self):
        return Ruta.marcar_operacion(self.empresa.rutas.order_by('codigo'), self.ahora)

    @cached_property
    def rutas_habilitadas(self):
        return [r for r in self.rutas_todas if r.habilitado]

    @cached_property
    def jornadas_hoy(self):
        """[(turno, inicio, fin)] de las jornadas que se cruzan con hoy, sin recortar (una nocturna puede
        empezar ayer o terminar mañana), ordenadas por bus y hora."""
        turnos = (Turno.que_se_cruzan(self.inicio_hoy, self.fin_hoy).filter(bus__empresa=self.empresa)
                  .select_related('conductor', 'bus', 'ruta'))
        jornadas = [(turno, inicio, fin) for turno in turnos for inicio, fin in turno.ventanas(self.inicio_hoy, self.fin_hoy)]
        jornadas.sort(key=lambda j: (j[0].bus.placa.lower(), j[1]))
        return jornadas

    def _estado_jornada(self, inicio, fin):
        if fin <= self.ahora:
            return 'Finalizado'
        return 'Programado' if inicio > self.ahora else 'En curso'

    def _estado_por(self, clave):
        """{valor de clave(turno): estado de turno de hoy}; si tiene varias jornadas, la más importante."""
        mejores = {}
        for turno, inicio, fin in self.jornadas_hoy:
            estado, llave = self._estado_jornada(inicio, fin), clave(turno)
            if llave not in mejores or ORDEN_TURNO[estado] < ORDEN_TURNO[mejores[llave]]:
                mejores[llave] = estado
        return mejores

    @cached_property
    def turnos_hoy(self):
        """Los turnos distintos que tienen jornada hoy (la página de Turnos muestra una fila por turno)."""
        return list({turno.pk: turno for turno, _, _ in self.jornadas_hoy}.values())

    @cached_property
    def alertas_30(self):
        return list(Alerta.objects.filter(ruta__empresa=self.empresa, fecha_creacion__gte=self.ahora - timedelta(days=30))
                    .exclude(estado='Cancelada').select_related('ruta'))

    @staticmethod
    def _distribucion(cantidades, sujeto, objeto, vacio, eje):
        """Columnas: cuántos `sujeto` tienen 0, 1, 2, 3 o 4 o más `objeto`. sujeto y objeto: (singular, plural)."""
        cuenta = Counter(min(c, 4) for c in cantidades)
        items = []
        for k in range(5):
            n = cuenta[k]
            if k == 0:
                cuando = f'sin {objeto[1]}'
            elif k == 1:
                cuando = f'con 1 {objeto[0]}'
            else:
                cuando = f'con {"4 o más" if k == 4 else k} {objeto[1]}'
            items.append(('4+' if k == 4 else str(k), n, ROJO if k == 0 and n else TINTA,
                          f'{_plural(n, *sujeto)} {cuando}', k == 0 and n > 0))
        return _columnas(items, vacio, eje)

    # ---------- Resumen ----------
    def resumen(self):
        """Arriba, el contador de cada vista; debajo, lo que necesita atención. Cada uno lleva a su vista."""
        alertas = Alerta.objects.filter(ruta__empresa=self.empresa).exclude(estado='Cancelada')
        por_estado = Counter(alertas.values_list('estado', flat=True))
        rutas = Counter(_estado_reporte_ruta(r) for r in self.rutas_todas)
        sin_ubicacion = sum(1 for b in self.buses_habilitados if b.turno and b.estado_visible != 'Transmitiendo')

        def cifra(valor, nombre, enlace, aviso=False):
            return {'valor': valor, 'nombre': nombre, 'enlace': enlace, 'aviso': aviso and valor > 0}

        return {'tipo': 'cifras', 'filas': [
            {'nombre': 'Total de cada vista', 'cifras': [
                cifra(sum(por_estado.values()), 'Alertas', '/alertas/'),
                cifra(len(self.rutas_habilitadas), 'Rutas habilitadas', '/rutas/'),
                cifra(len(self.buses_habilitados), 'Buses habilitados', '/buses/'),
                cifra(len(self.conductores_habilitados), 'Conductores habilitados', '/conductores/'),
                cifra(len(self.turnos_hoy), 'Turnos de hoy', '/turnos/')]},
            {'nombre': 'Lo que necesita atención', 'cifras': [
                cifra(por_estado['Pendiente'], 'Alertas pendientes', '/alertas/', aviso=True),
                cifra(por_estado['En_proceso'], 'Alertas en proceso', '/alertas/'),
                cifra(rutas['Activa'], 'Rutas activas', '/rutas/'),
                cifra(rutas['Sin_buses'], 'Rutas sin buses activos', '/rutas/', aviso=True),
                cifra(sin_ubicacion, 'Buses con turno y sin ubicación', '/buses/', aviso=True)]},
        ]}

    # ---------- Alertas ----------
    def alertas_estado(self):
        cuenta = Counter(a.estado for a in self.alertas_30)
        return _dona([('Por revisar', cuenta['Pendiente'], AMARILLO), ('En proceso', cuenta['En_proceso'], AZUL),
                      ('Resueltas', cuenta['Resuelta'], VERDE)], 'alertas',
                     'No hay alertas en tus rutas en los últimos 30 días.')

    def alertas_ruta(self):
        cuenta = Counter(a.ruta for a in self.alertas_30)
        orden = sorted(cuenta.items(), key=lambda x: (-x[1], x[0].codigo))
        datos = _barras([(f'{r.codigo} · {r.nombre}', n, str(n), COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)])
                         for r, n in orden[:6]], 'No hay alertas en tus rutas en los últimos 30 días.')
        datos['nota'] = f'Se muestran las 6 rutas con más alertas de {len(orden)}.' if len(orden) > 6 else ''
        return datos

    def alertas_tipo(self):
        cuenta = Counter(a.tipo for a in self.alertas_30)
        return _dona([('Demora', cuenta['delay'], ROJO), ('Advertencia', cuenta['warning'], AMARILLO),
                      ('Información', cuenta['info'], AZUL)], 'alertas',
                     'No hay alertas en tus rutas en los últimos 30 días.')

    def alertas_dias(self):
        """15 columnas (una por día). El selector de la página deja ver solo las últimas 7: aquí ya salen así."""
        mayor = max(DIAS_ALERTAS)
        por_dia = Counter(timezone.localtime(a.fecha_creacion).date() for a in self.alertas_30)
        items = []
        for n in range(mayor - 1, -1, -1):
            dia = self.hoy - timedelta(days=n)
            items.append(('Hoy' if n == 0 else f'{dia.day}/{dia.month}', por_dia[dia], ROJO,
                          f'{_plural(por_dia[dia], "alerta", "alertas")} el {dia:%d/%m}', False))
        datos = _columnas(items, '')
        menor = min(DIAS_ALERTAS)
        visibles = datos['items'][-menor:]
        maximo = max((c['valor'] for c in visibles), default=0)
        for i, c in enumerate(datos['items']):
            c['oculta'] = i < len(datos['items']) - menor
            if not c['oculta']:
                c['pct'] = round(c['valor'] * 100 / maximo) if maximo else 0
        textos = {}
        for dias in DIAS_ALERTAS:
            total = sum(c['valor'] for c in datos['items'][-dias:])
            textos[dias] = (f'{_plural(total, "alerta", "alertas")} en {dias} días.' if total
                            else f'No llegaron alertas en los últimos {dias} días.')
        datos.update({
            'vacio': '', 'total_texto': textos[menor], 'columnas': menor,
            'periodos': [{'dias': d, 'texto': f'{d} días', 'activo': d == menor, 'nota': textos[d]} for d in DIAS_ALERTAS]})
        return datos

    # ---------- Rutas ----------
    def rutas(self):
        cuenta = Counter(_estado_reporte_ruta(r) for r in self.rutas_todas)
        colores = {'Activa': VERDE, 'Sin_buses': AMARILLO, 'Fuera_horario': GRIS, 'Fuera_servicio': ROJO,
                   'Inhabilitada': LINEA}
        nombres = {**Ruta.ESTADOS_VISIBLES, 'Inhabilitada': 'Inhabilitadas'}
        return _dona([(nombres[e], cuenta[e], colores[e]) for e in colores], 'rutas')

    def rutas_buses(self):
        por_ruta = Counter(r.id_ruta for b in self.buses_habilitados for r in b.rutas_lista)
        datos = self._distribucion([por_ruta[r.id_ruta] for r in self.rutas_habilitadas], ('ruta', 'rutas'),
                                   ('bus', 'buses'), 'No hay rutas habilitadas.',
                                   'Cada columna agrupa las rutas habilitadas según cuántos buses pueden cubrirlas.')
        return datos

    def rutas_turno(self):
        return self._dona_turno_de(self.rutas_habilitadas, lambda t: t.ruta_id, lambda r: r.id_ruta,
                                   'rutas', 'No hay rutas habilitadas.')

    def rutas_mapa(self):
        rutas, sin_trazado = [], 0
        for r in self.rutas_todas:
            coordenadas = r.get_coordenadas_ruta()
            if len(coordenadas) < 2:
                sin_trazado += 1
                continue
            rutas.append({
                'id': r.id_ruta, 'codigo': r.codigo, 'nombre': r.nombre, 'origen': r.origen, 'destino': r.destino,
                'estado': r.nombre_estado_visible if r.habilitado else 'Inhabilitada', 'habilitado': r.habilitado,
                'distancia_km': r.distancia_km, 'duracion_minutos': r.duracion_estimada_minutos,
                'frecuencia_minutos': r.frecuencia_minutos,
                'color': COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)], 'coordenadas': coordenadas})
        nota = ''
        if rutas:
            nota = f'{_plural(len(rutas), "ruta", "rutas")} en el mapa. Toca una línea para ver sus datos.'
        if sin_trazado:
            nota += f' {sin_trazado} {"ruta no tiene" if sin_trazado == 1 else "rutas no tienen"} recorrido trazado.'
        return {'tipo': 'mapa', 'rutas': rutas, 'nota': nota.strip(), 'vacio': '' if rutas else 'Ninguna ruta tiene recorrido trazado.'}

    # ---------- Buses ----------
    def flota(self):
        cuenta = Counter(b.estado_visible for b in self.buses)
        return _dona([('Transmitiendo', cuenta['Transmitiendo'], VERDE), ('En turno', cuenta['En_turno'], TINTA),
                      ('Sin turno', cuenta['Sin_turno'], GRIS), ('Inhabilitados', cuenta['Inhabilitado'], LINEA)],
                     'buses')

    def buses_turno(self):
        return self._dona_turno_de(self.buses_habilitados, lambda t: t.bus_id, lambda b: b.id_bus,
                                   'buses', 'No hay buses habilitados.')

    def buses_cant_rutas(self):
        return self._distribucion([len(b.rutas_lista) for b in self.buses_habilitados], ('bus', 'buses'),
                                  ('ruta', 'rutas'), 'No hay buses habilitados.',
                                  'Cada columna agrupa los buses habilitados según cuántas rutas pueden cubrir.')

    def buses_rutas(self):
        por_ruta = Counter(r.id_ruta for b in self.buses_habilitados for r in b.rutas_lista)
        orden = sorted(self.rutas_habilitadas, key=lambda r: (-por_ruta[r.id_ruta], r.codigo))
        return _barras([(f'{r.codigo} · {r.nombre}', por_ruta[r.id_ruta], str(por_ruta[r.id_ruta]),
                         COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)]) for r in orden], 'No hay rutas habilitadas.')

    def buses_sin_transmitir(self):
        con_turno = [b for b in self.buses_habilitados if b.turno]
        sin = [b for b in con_turno if b.estado_visible != 'Transmitiendo']
        return _dona([('Transmitiendo', len(con_turno) - len(sin), VERDE), ('Sin transmitir', len(sin), ROJO)],
                     'con turno', 'Ahora ningún bus tiene turno.',
                     _lista('Sin transmitir ahora:', [b.placa for b in sin], placas=True))

    def buses_sin_rutas(self):
        sin = [b for b in self.buses_habilitados if not b.rutas_lista]
        return _dona([('Con rutas', len(self.buses_habilitados) - len(sin), VERDE), ('Sin rutas', len(sin), ROJO)],
                     'buses', 'No hay buses habilitados.', _lista('Sin rutas:', [b.placa for b in sin], placas=True))

    # ---------- Conductores ----------
    def conductores(self):
        cuenta = Counter(_parte_estado_conductor(c) for c in self.conductores_todos)
        return _dona([('En turno, compartiendo ubicación', cuenta['Comparte'], VERDE),
                      ('En turno, sin compartir ubicación', cuenta['Sin_ubicacion'], ROJO),
                      ('Sin turno', cuenta['Sin_turno'], GRIS), ('Inhabilitados', cuenta['Inhabilitado'], LINEA)],
                     'conductores')

    def conductores_turno(self):
        return self._dona_turno_de(self.conductores_habilitados, lambda t: t.conductor_id, lambda c: c.id_conductor,
                                   'conductores', 'No hay conductores habilitados.')

    def conductores_sin_transmitir(self):
        con_turno = [c for c in self.conductores_habilitados if c.turno]
        sin = [c for c in con_turno if not c.transmite]
        return _dona([('Compartiendo ubicación', len(con_turno) - len(sin), VERDE),
                      ('Sin compartir ubicación', len(sin), ROJO)],
                     'en turno', 'Ahora ningún conductor tiene turno.',
                     _lista('Sin compartir ahora:', [c.nombre for c in sin]))

    # ---------- Turnos ----------
    def turnos_estado(self):
        estados = self._estado_por(lambda t: t.pk)
        cuenta = Counter(estados.values())
        return _dona([(NOMBRES_TURNO[e], cuenta[e], COLORES_TURNO[e]) for e in ORDEN_TURNO], 'turnos',
                     'Hoy no hay turnos programados.')

    def turnos_buses(self):
        por_bus, placas = Counter(), {}
        for turno in self.turnos_hoy:
            por_bus[turno.bus_id] += 1
            placas[turno.bus_id] = turno.bus.placa
        orden = sorted(por_bus, key=lambda b: (-por_bus[b], placas[b].lower()))
        datos = _barras([(placas[b], por_bus[b], _plural(por_bus[b], 'turno', 'turnos'), TINTA)
                         for b in orden[:MAX_BARRAS]], 'Hoy no hay turnos programados.')
        notas = []
        if len(orden) > MAX_BARRAS:
            notas.append(f'Se muestran los {MAX_BARRAS} buses con más turnos de {len(orden)}.')
        sin = len(self.buses_habilitados) - len(orden)
        if sin > 0 and orden:
            notas.append(f'{_plural(sin, "bus habilitado", "buses habilitados")} sin turnos hoy.')
        datos['nota'] = ' '.join(notas)
        return datos

    def turnos_rutas(self):
        por_ruta = Counter(t.ruta_id for t in self.turnos_hoy)
        con_turno = set(por_ruta)
        rutas = [r for r in self.rutas_todas if r.habilitado or r.id_ruta in con_turno]
        rutas.sort(key=lambda r: (-por_ruta[r.id_ruta], r.codigo))
        return _barras([(f'{r.codigo} · {r.nombre}', por_ruta[r.id_ruta], str(por_ruta[r.id_ruta]),
                         COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)]) for r in rutas], 'No hay rutas habilitadas.')

    def servicio_hora(self):
        hora_actual = timezone.localtime(self.ahora).hour
        items = []
        for hora in range(24):
            desde = timezone.make_aware(datetime.combine(self.hoy, time(hora)))
            hasta = desde + timedelta(hours=1)
            buses = {t.bus_id for t, i, f in self.jornadas_hoy if i < hasta and f > desde}
            etiqueta = f'{hora % 12 or 12}{"a" if hora < 12 else "p"}'
            items.append((etiqueta, len(buses), AZUL if hora == hora_actual else TINTA,
                          f'{_plural(len(buses), "bus", "buses")} con turno de {hora}:00 a {hora + 1}:00', hora == hora_actual))
        hora_pico = max(range(24), key=lambda h: items[h][1])
        maximo = items[hora_pico][1]
        texto = (f'Hora pico: {_plural(maximo, "bus", "buses")} a las {hora_pico % 12 or 12}:00 '
                 f'{"a. m." if hora_pico < 12 else "p. m."}') if maximo else ''
        return _columnas(items, 'Hoy no hay turnos programados.', texto)

    def turnos_tiempo(self):
        """Una fila por bus con sus jornadas de hoy sobre las 24 horas (la línea de tiempo de Turnos)."""
        largo = (self.fin_hoy - self.inicio_hoy).total_seconds()

        def porcentaje(momento):
            return f'{(momento - self.inicio_hoy).total_seconds() / largo * 100:.3f}'

        filas, por_bus = [], {}
        for turno, inicio, fin in self.jornadas_hoy:
            if turno.bus_id not in por_bus:
                por_bus[turno.bus_id] = {'placa': turno.bus.placa, 'barras': []}
                filas.append(por_bus[turno.bus_id])
            a, b = max(inicio, self.inicio_hoy), min(fin, self.fin_hoy)
            estado = self._estado_jornada(inicio, fin)
            pausa = turno.en_pausa
            titulo = (f'{turno.conductor.nombre} · {turno.ruta.codigo} · {hora12(inicio)} a {hora12(fin)} · {estado}'
                      + (' (en pausa)' if pausa else ''))
            por_bus[turno.bus_id]['barras'].append({
                'x': porcentaje(a), 'ancho': f'{(b - a).total_seconds() / largo * 100:.3f}',
                'color': COLORES_RUTA[turno.ruta_id % len(COLORES_RUTA)],
                'estado': estado.lower().replace(' ', '-'), 'pausa': pausa,
                'antes': inicio < self.inicio_hoy, 'despues': fin > self.fin_hoy,
                'texto': f'{turno.ruta.codigo} · {turno.conductor.nombre}', 'titulo': titulo})
        for fila in filas:
            fila['resumen'] = f'Bus {fila["placa"]}: ' + '; '.join(b['titulo'] for b in fila['barras'])
        return {
            'tipo': 'tiempo', 'filas': filas, 'vacio': '' if filas else 'Hoy no hay turnos programados.',
            'escala': [{'x': f'{h / 24 * 100:.3f}', 'texto': _etiqueta_hora(h)} for h in range(0, 24, 3)],
            'guias': [f'{h / 24 * 100:.3f}' for h in range(3, 24, 3)],
            'ahora': porcentaje(self.ahora),
        }

    # ---------- Armado ----------
    def _dona_turno_de(self, entidades, clave_turno, clave_entidad, etiqueta, vacio):
        """Dona de entidades por su estado de turno de hoy. clave_turno saca de un turno el id de la entidad."""
        estados = self._estado_por(clave_turno)
        cuenta = Counter(estados.get(clave_entidad(e), 'Sin turno') for e in entidades)
        return _dona([(NOMBRES_TURNO[e], cuenta[e], COLORES_TURNO[e]) for e in NOMBRES_TURNO], etiqueta, vacio)

    METODOS = {clave: clave for clave in GRAFICAS}

    def grafica(self, clave):
        datos = getattr(self, self.METODOS[clave])()
        titulo, ayuda, grupo = GRAFICAS[clave]
        datos.update({'clave': clave, 'titulo': titulo, 'ayuda': ayuda, 'grupo': grupo, 'ancha': clave in ANCHAS})
        return datos


def _grupos_para_personalizar(seleccion):
    grupos = {}
    for clave in seleccion + [c for c in GRAFICAS if c not in seleccion]:
        titulo, ayuda, grupo = GRAFICAS[clave]
        grupos.setdefault(grupo, []).append(
            {'clave': clave, 'titulo': titulo, 'ayuda': ayuda, 'elegida': clave in seleccion})
    # Los módulos salen en el orden de GRAFICAS, no en el de lo que se eligió
    nombres = list(dict.fromkeys(g for _, _, g in GRAFICAS.values()))
    return [{'nombre': n, 'opciones': grupos[n]} for n in nombres]


@admin_empresa_required
def panel(request):
    seleccion = seleccion_de(request.user.administrador)
    datos = DatosPanel(request.empresa)
    return render(request, 'core/panel.html', {
        'graficas': [datos.grafica(clave) for clave in seleccion],
        # Para Personalizar: un bloque por módulo, en el orden de GRAFICAS; dentro de cada uno, primero las
        # elegidas (en su orden) y después las demás
        'grupos': _grupos_para_personalizar(seleccion),
        # "miércoles 11 de noviembre de 2026, 6:36 p. m." (el sitio está en inglés: el filtro date no sirve)
        'momento_texto': f'{_texto_del_dia(datos.hoy)}, {hora12(datos.ahora)}',
    })


@admin_empresa_required
def panel_reporte(request):
    """PDF con las gráficas que la empresa tiene elegidas en este momento, en su orden. `dias` (7 o 15) es el
    periodo de «Alertas por día»; el panel lo manda según lo que esté viendo."""
    seleccion = seleccion_de(request.user.administrador)
    if not seleccion:
        messages.error(request, 'Tu panel no tiene gráficas. Elígelas en Personalizar para descargar el reporte.')
        return redirect('/panel/')
    dias = int(request.GET['dias']) if request.GET.get('dias') in {str(d) for d in DIAS_ALERTAS} else min(DIAS_ALERTAS)
    datos = DatosPanel(request.empresa)
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{nombre_archivo("panel")}"'
    return crear_reporte_panel(response, [datos.grafica(clave) for clave in seleccion], request.empresa.nombre,
                               f'{_texto_del_dia(datos.hoy)}, {hora12(datos.ahora)}', dias)


@admin_empresa_required
@require_POST
def panel_graficas(request):
    """Guarda qué gráficas ver y en qué orden. También quita una sola gráfica o vuelve a las de siempre."""
    administrador = request.user.administrador
    accion = request.POST.get('accion', 'guardar')
    if accion == 'restablecer':
        administrador.panel_graficas = None
        aviso = 'El panel volvió a mostrar las gráficas de siempre.'
    elif accion == 'quitar':
        clave = request.POST.get('grafica', '')
        administrador.panel_graficas = [c for c in seleccion_de(administrador) if c != clave]
        aviso = f'Quitaste «{GRAFICAS[clave][0]}». Puedes volver a agregarla en Personalizar.' if clave in GRAFICAS else ''
    else:
        elegidas = []
        for clave in request.POST.getlist('graficas'):
            if clave in GRAFICAS and clave not in elegidas:
                elegidas.append(clave)
        administrador.panel_graficas = elegidas
        aviso = 'Guardaste tu panel.' if elegidas else 'Guardaste tu panel sin gráficas.'
    administrador.save(update_fields=['panel_graficas'])
    if aviso:
        messages.success(request, aviso)
    return redirect('/panel/')
