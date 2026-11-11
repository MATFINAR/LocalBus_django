"""Panel de la empresa: lo primero que ve un administrador al iniciar sesión.

Cada gráfica tiene una clave (GRAFICAS). El administrador elige cuáles ver y en qué orden (Personalizar);
la elección se guarda en Administrador.panel_graficas. Solo se calculan las gráficas elegidas, y los estados
salen de las mismas funciones que usan las listas de buses, conductores y rutas, para que las cifras coincidan.
"""
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from functools import cached_property

from django.contrib import messages
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import Alerta, Ruta, Turno
from .permisos import admin_empresa_required
from .utils.horas import hora12
from .views import (COLORES_RUTA, _estado_reporte_ruta, _marcar_estado_buses, _marcar_estado_conductores,
                    _parte_estado_conductor, _texto_del_dia)

# clave: (título, para qué sirve). El orden es el del menú Personalizar.
GRAFICAS = {
    'resumen': ('Resumen de ahora', 'Buses en servicio, conductores en turno, rutas operando, jornadas de hoy y alertas por revisar.'),
    'flota': ('Buses por estado', 'Qué parte de la flota transmite, está en turno, está libre o inhabilitada.'),
    'conductores': ('Conductores por estado', 'Quién está en turno y si su bus comparte la ubicación.'),
    'servicio_hora': ('Buses en servicio por hora, hoy', 'Cuántos buses tienen turno en cada hora del día: muestra horas pico y huecos.'),
    'rutas': ('Rutas por estado', 'Rutas operando, sin buses activos, fuera de horario o fuera de servicio.'),
    'turnos_semana': ('Jornadas de los próximos 7 días', 'Cuántas jornadas hay programadas cada día; los días en rojo no tienen ninguna.'),
    'horas_ruta': ('Horas de servicio por ruta, próximos 7 días', 'Horas de bus programadas en cada ruta habilitada.'),
    'carga_conductores': ('Horas por conductor, próximos 7 días', 'Carga de trabajo programada de cada conductor.'),
    'alertas_estado': ('Alertas por estado, últimos 30 días', 'Cuántas alertas esperan revisión, están en proceso o se resolvieron.'),
    'alertas_dias': ('Alertas recibidas, últimos 14 días', 'Alertas nuevas cada día en tus rutas.'),
    'alertas_ruta': ('Rutas con más alertas, últimos 30 días', 'Dónde se concentran los problemas que reportan los pasajeros.'),
}
# Las que ve quien aún no ha personalizado su panel
PREDETERMINADAS = ['resumen', 'flota', 'conductores', 'servicio_hora', 'turnos_semana', 'alertas_estado']
# Ocupan todo el ancho del panel
ANCHAS = {'resumen', 'servicio_hora'}

DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
VERDE, AZUL, TINTA, GRIS, LINEA, ROJO, AMARILLO = (
    'var(--verde)', 'var(--azul)', 'var(--tinta)', 'var(--gris-texto)', 'var(--linea)', 'var(--rojo-interfaz)',
    'var(--amarillo)')


def seleccion_de(administrador):
    """Claves válidas elegidas por el administrador, en su orden; las predeterminadas si nunca eligió."""
    if administrador.panel_graficas is None:
        return list(PREDETERMINADAS)
    vistas = []
    for clave in administrador.panel_graficas:
        if clave in GRAFICAS and clave not in vistas:
            vistas.append(clave)
    return vistas


def _horas(valor):
    """12.0 -> "12 h"; 7.25 -> "7,3 h"."""
    texto = f'{valor:.1f}'.rstrip('0').rstrip('.').replace('.', ',')
    return f'{texto} h'


def _dona(partes, etiqueta):
    """partes: [(nombre, valor, color)]. Arcos de una circunferencia de largo 100 (r = 15,915)."""
    total = sum(valor for _, valor, _ in partes)
    arcos, acumulado = [], 0
    for nombre, valor, color in partes:
        pct = valor * 100 / total if total else 0
        arcos.append({'nombre': nombre, 'valor': valor, 'color': color, 'pct': round(pct),
                      'largo': f'{pct:.3f}', 'resto': f'{100 - pct:.3f}', 'desfase': f'{25 - acumulado:.3f}'})
        acumulado += pct
    return {'tipo': 'dona', 'total': total, 'etiqueta': etiqueta, 'partes': arcos,
            'resumen': ', '.join(f'{p["valor"]} {p["nombre"].lower()}' for p in arcos)}


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


class DatosPanel:
    """Calcula solo lo que piden las gráficas elegidas; lo compartido (buses, jornadas…) se consulta una vez."""

    def __init__(self, empresa):
        self.empresa = empresa
        self.ahora = timezone.now()
        self.hoy = timezone.localdate()
        self.inicio_hoy = timezone.make_aware(datetime.combine(self.hoy, time.min))

    # ---------- Datos compartidos ----------
    @cached_property
    def buses(self):
        return _marcar_estado_buses(list(self.empresa.buses.prefetch_related('rutas')), self.empresa)

    @cached_property
    def conductores(self):
        conductores = list(self.empresa.conductores.all())
        _marcar_estado_conductores(conductores, self.empresa)
        return conductores

    @cached_property
    def rutas(self):
        return Ruta.marcar_operacion(self.empresa.rutas.order_by('codigo'), self.ahora)

    @cached_property
    def jornadas_semana(self):
        """[(turno, inicio, fin)] de hoy y los 6 días siguientes, recortadas a ese periodo."""
        desde, hasta = self.inicio_hoy, self.inicio_hoy + timedelta(days=7)
        turnos = (Turno.que_se_cruzan(desde, hasta).filter(bus__empresa=self.empresa)
                  .select_related('conductor', 'ruta'))
        jornadas = []
        for turno in turnos:
            for inicio, fin in turno.ventanas(desde, hasta):
                inicio, fin = max(inicio, desde), min(fin, hasta)
                if fin > inicio:
                    jornadas.append((turno, inicio, fin))
        return jornadas

    @cached_property
    def jornadas_hoy(self):
        manana = self.inicio_hoy + timedelta(days=1)
        return [(t, i, min(f, manana)) for t, i, f in self.jornadas_semana if i < manana]

    @cached_property
    def alertas_30(self):
        return list(Alerta.objects.filter(ruta__empresa=self.empresa, fecha_creacion__gte=self.ahora - timedelta(days=30))
                    .exclude(estado='Cancelada').select_related('ruta'))

    # ---------- Gráficas ----------
    def resumen(self):
        buses = [b for b in self.buses if b.habilitado]
        conductores = [c for c in self.conductores if c.habilitado]
        rutas = [r for r in self.rutas if r.habilitado]
        por_revisar = Alerta.objects.filter(ruta__empresa=self.empresa, estado='Pendiente').count()
        return {'tipo': 'cifras', 'cifras': [
            {'valor': sum(b.estado_visible == 'Transmitiendo' for b in buses), 'de': len(buses),
             'nombre': 'Buses transmitiendo ahora', 'enlace': '/buses/'},
            {'valor': sum(c.estado_visible == 'En_turno' for c in conductores), 'de': len(conductores),
             'nombre': 'Conductores en turno', 'enlace': '/conductores/'},
            {'valor': sum(r.estado_visible == 'Activa' for r in rutas), 'de': len(rutas),
             'nombre': 'Rutas operando', 'enlace': '/rutas/'},
            {'valor': len(self.jornadas_hoy), 'de': None, 'nombre': 'Jornadas programadas hoy', 'enlace': '/turnos/'},
            {'valor': por_revisar, 'de': None, 'nombre': 'Alertas por revisar', 'enlace': '/alertas/',
             'aviso': por_revisar > 0},
        ]}

    def flota(self):
        cuenta = Counter(b.estado_visible for b in self.buses)
        return _dona([('Transmitiendo', cuenta['Transmitiendo'], VERDE), ('En turno', cuenta['En_turno'], TINTA),
                      ('Sin turno', cuenta['Sin_turno'], GRIS), ('Inhabilitados', cuenta['Inhabilitado'], LINEA)],
                     'buses')

    def conductores_estado(self):
        cuenta = Counter(_parte_estado_conductor(c) for c in self.conductores)
        return _dona([('En turno, compartiendo ubicación', cuenta['Comparte'], VERDE),
                      ('En turno, sin compartir ubicación', cuenta['Sin_ubicacion'], ROJO),
                      ('Sin turno', cuenta['Sin_turno'], GRIS), ('Inhabilitados', cuenta['Inhabilitado'], LINEA)],
                     'conductores')

    def rutas_estado(self):
        cuenta = Counter(_estado_reporte_ruta(r) for r in self.rutas)
        colores = {'Activa': VERDE, 'Sin_buses': AMARILLO, 'Fuera_horario': GRIS, 'Fuera_servicio': ROJO,
                   'Inhabilitada': LINEA}
        nombres = {**Ruta.ESTADOS_VISIBLES, 'Inhabilitada': 'Inhabilitadas'}
        return _dona([(nombres[e], cuenta[e], colores[e]) for e in colores], 'rutas')

    def servicio_hora(self):
        hora_actual = timezone.localtime(self.ahora).hour
        items = []
        for hora in range(24):
            desde = timezone.make_aware(datetime.combine(self.hoy, time(hora)))
            hasta = desde + timedelta(hours=1)
            buses = {t.bus_id for t, i, f in self.jornadas_hoy if i < hasta and f > desde}
            etiqueta = f'{hora % 12 or 12}{"a" if hora < 12 else "p"}'
            items.append((etiqueta, len(buses), AZUL if hora == hora_actual else TINTA,
                          f'{len(buses)} buses con turno de {hora}:00 a {hora + 1}:00', hora == hora_actual))
        hora_pico = max(range(24), key=lambda h: items[h][1])
        maximo = items[hora_pico][1]
        texto = (f'Hora pico: {maximo} bus{"es" if maximo != 1 else ""} a las {hora_pico % 12 or 12}:00 '
                 f'{"a. m." if hora_pico < 12 else "p. m."}') if maximo else ''
        return _columnas(items, 'Hoy no hay turnos programados.', texto)

    def turnos_semana(self):
        por_dia = Counter(timezone.localtime(i).date() for _, i, _ in self.jornadas_semana)
        items = []
        for n in range(7):
            dia = self.hoy + timedelta(days=n)
            valor = por_dia[dia]
            etiqueta = 'Hoy' if n == 0 else f'{DIAS_CORTOS[dia.weekday()]} {dia.day}'
            items.append((etiqueta, valor, ROJO if not valor else TINTA,
                          f'{valor} jornadas el {dia:%d/%m}', not valor))
        return _columnas(items, 'No hay jornadas programadas en los próximos 7 días.')

    def horas_ruta(self):
        horas = defaultdict(float)
        for turno, inicio, fin in self.jornadas_semana:
            horas[turno.ruta_id] += (fin - inicio).total_seconds() / 3600
        rutas = sorted((r for r in self.rutas if r.habilitado), key=lambda r: (-horas[r.id_ruta], r.codigo))
        return _barras([(f'{r.codigo} · {r.nombre}', horas[r.id_ruta], _horas(horas[r.id_ruta]),
                         COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)]) for r in rutas],
                       'No hay rutas habilitadas.')

    def carga_conductores(self):
        horas = defaultdict(float)
        for turno, inicio, fin in self.jornadas_semana:
            horas[turno.conductor_id] += (fin - inicio).total_seconds() / 3600
        habilitados = [c for c in self.conductores if c.habilitado]
        con_horas = sorted((c for c in habilitados if horas[c.id_conductor] > 0),
                           key=lambda c: (-horas[c.id_conductor], c.nombre))
        datos = _barras([(c.nombre, horas[c.id_conductor], _horas(horas[c.id_conductor]), TINTA)
                         for c in con_horas[:10]], 'Ningún conductor tiene turnos en los próximos 7 días.')
        sin = len(habilitados) - len(con_horas)
        notas = []
        if len(con_horas) > 10:
            notas.append(f'Se muestran los 10 con más horas de {len(con_horas)}.')
        if sin and con_horas:
            notas.append(f'{sin} conductor{"es" if sin != 1 else ""} habilitado{"s" if sin != 1 else ""} sin horas programadas.')
        datos['nota'] = ' '.join(notas)
        return datos

    def alertas_estado(self):
        cuenta = Counter(a.estado for a in self.alertas_30)
        return _dona([('Por revisar', cuenta['Pendiente'], AMARILLO), ('En proceso', cuenta['En_proceso'], AZUL),
                      ('Resueltas', cuenta['Resuelta'], VERDE)], 'alertas')

    def alertas_dias(self):
        por_dia = Counter(timezone.localtime(a.fecha_creacion).date() for a in self.alertas_30)
        items = []
        for n in range(13, -1, -1):
            dia = self.hoy - timedelta(days=n)
            items.append(('Hoy' if n == 0 else f'{dia.day}/{dia.month}', por_dia[dia], ROJO,
                          f'{por_dia[dia]} alertas el {dia:%d/%m}', False))
        total = sum(v for _, v, _, _, _ in items)
        return _columnas(items, 'No llegaron alertas en los últimos 14 días.',
                         f'{total} alerta{"s" if total != 1 else ""} en 14 días.' if total else '')

    def alertas_ruta(self):
        cuenta = Counter(a.ruta for a in self.alertas_30)
        return _barras([(f'{r.codigo} · {r.nombre}', n, str(n), COLORES_RUTA[r.id_ruta % len(COLORES_RUTA)])
                        for r, n in sorted(cuenta.items(), key=lambda x: (-x[1], x[0].codigo))[:6]],
                       'No hay alertas en tus rutas en los últimos 30 días.')

    METODOS = {'resumen': 'resumen', 'flota': 'flota', 'conductores': 'conductores_estado', 'rutas': 'rutas_estado',
               'servicio_hora': 'servicio_hora', 'turnos_semana': 'turnos_semana', 'horas_ruta': 'horas_ruta',
               'carga_conductores': 'carga_conductores', 'alertas_estado': 'alertas_estado',
               'alertas_dias': 'alertas_dias', 'alertas_ruta': 'alertas_ruta'}

    def grafica(self, clave):
        datos = getattr(self, self.METODOS[clave])()
        titulo, ayuda = GRAFICAS[clave]
        datos.update({'clave': clave, 'titulo': titulo, 'ayuda': ayuda, 'ancha': clave in ANCHAS})
        return datos


@admin_empresa_required
def panel(request):
    seleccion = seleccion_de(request.user.administrador)
    datos = DatosPanel(request.empresa)
    return render(request, 'core/panel.html', {
        'graficas': [datos.grafica(clave) for clave in seleccion],
        # Para Personalizar: primero las elegidas (en su orden) y después las demás
        'opciones': [{'clave': c, 'titulo': GRAFICAS[c][0], 'ayuda': GRAFICAS[c][1], 'elegida': c in seleccion}
                     for c in seleccion + [c for c in GRAFICAS if c not in seleccion]],
        # "miércoles 11 de noviembre de 2026, 6:36 p. m." (el sitio está en inglés: el filtro date no sirve)
        'momento_texto': f'{_texto_del_dia(datos.hoy)}, {hora12(datos.ahora)}',
    })


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
