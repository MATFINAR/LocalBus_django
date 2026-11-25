import logging
import math
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models, transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.contrib.gis.db import models as gis_models
from django.contrib.gis.geos import Point
from django.core.validators import RegexValidator
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .utils.horas import fecha_hora12, hora12


class ContrasenaCifradaMixin:
    """Para modelos con un campo `contrasena`: se guarda cifrada, nunca en texto plano."""

    def set_contrasena(self, contrasena):
        self.contrasena = make_password(contrasena)

    def verificar_contrasena(self, contrasena):
        return bool(contrasena) and check_password(contrasena, self.contrasena)


# Ajustes de la página que comparten el perfil del usuario y el de la empresa (los dos los eligen igual)
DESPLAZAMIENTOS_MAPA = [
    ('dos_dedos', 'Con dos dedos'),
    ('barra', 'Con barra lateral'),
]
TEMAS_PAGINA = [
    ('sistema', 'Igual que el dispositivo'),
    ('claro', 'Claro'),
    ('oscuro', 'Oscuro'),
]


class Empresa(models.Model):
    """Empresa de transporte. Cada una ve y administra solo sus rutas, buses, conductores y turnos."""
    id_empresa = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=150)
    nit = models.CharField(max_length=20, unique=True)
    activa = models.BooleanField(default=True)
    # Logo que sube el administrador desde "Mi empresa". Se guarda ya procesado (PNG, máximo 512 px): ver
    # views.empresa_logo. Vacío: el sitio muestra las iniciales de la empresa.
    logo = models.ImageField(upload_to='empresas/logos/', blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre

    @property
    def iniciales(self):
        """Dos letras para cuando no hay logo: "Transportes Medellín Norte" -> "TM"."""
        palabras = [p for p in self.nombre.replace('.', ' ').split() if p[:1].isalpha() and p.lower() not in ('de', 'del', 'la', 'las', 'los', 'y', 's', 'a', 'ltda', 'sas')]
        if len(palabras) == 1:
            return palabras[0][:2].upper()          # una sola palabra: "Cootransmed" -> "CO"
        return (''.join(p[0] for p in palabras[:2]) or self.nombre[:2]).upper()


class Administrador(models.Model):
    """Cuenta de Django que administra una empresa (se crea desde /admin/)."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='administrador')
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='administradores')
    # Ajustes de la cuenta (Mi empresa > Ajustes), los mismos que tiene un usuario en su perfil
    desplazamiento_mapa = models.CharField(max_length=10, choices=DESPLAZAMIENTOS_MAPA, default='barra')
    tema = models.CharField(max_length=10, choices=TEMAS_PAGINA, default='sistema')
    # Gráficas del panel, en el orden elegido (claves de core.panel.GRAFICAS). Vacío (None) = las de siempre
    panel_graficas = models.JSONField(null=True, blank=True)

    class Meta:
        verbose_name_plural = 'Administradores'

    def __str__(self):
        return f"{self.user.get_username()} ({self.empresa})"


# Velocidad promedio de un bus urbano, contando semáforos, tráfico y subida de pasajeros. De ella sale la
# duración aproximada de las rutas.
VELOCIDAD_BUS_KMH = 20


def minutos_de_recorrido(km):
    """Minutos aproximados que tarda un bus en recorrer `km`."""
    # int(x + 0.5) redondea igual que el editor (Math.round), para que ambos den el mismo número
    return max(1, int(km * 60 / VELOCIDAD_BUS_KMH + 0.5)) if km and km > 0 else 0


def _km_de_linea(linea):
    """Kilómetros de una LineString (haversine)."""
    total = 0
    coords = linea.coords if linea else []
    for (lng1, lat1), (lng2, lat2) in zip(coords, coords[1:]):
        lat1, lng1, lat2, lng2 = map(math.radians, (lat1, lng1, lat2, lng2))
        h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
        total += 2 * 6371 * math.asin(math.sqrt(h))
    return total


MAX_PUNTOS_PASO = 25  # por tramo


def limpiar_puntos_paso(valor):
    """{"ida": [[lng, lat], ...], "vuelta": [...], "regreso": [...]} con solo lo que sea válido."""
    limpio = {}
    if not isinstance(valor, dict):
        return limpio
    for tramo in ('ida', 'vuelta', 'regreso'):
        puntos = []
        for punto in valor.get(tramo) if isinstance(valor.get(tramo), list) else []:
            try:
                lng, lat = float(punto[0]), float(punto[1])
            except (TypeError, ValueError, IndexError, KeyError):
                continue
            if -180 <= lng <= 180 and -90 <= lat <= 90:
                puntos.append([lng, lat])
        if puntos:
            limpio[tramo] = puntos[:MAX_PUNTOS_PASO]
    return limpio


class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='rutas')
    nombre = models.CharField(max_length=100)
    codigo = models.CharField(max_length=20)

    origen = models.CharField(max_length=300)
    destino = models.CharField(max_length=300)

    geometria_ruta = gis_models.LineStringField(srid=4326, null=True, blank=True)
    punto_origen = gis_models.PointField(srid=4326, null=True, blank=True)
    punto_destino = gis_models.PointField(srid=4326, null=True, blank=True)

    # Inicio = origen, retorno = destino, fin = donde termina el recorrido (casi siempre el mismo origen)
    fin_es_origen = models.BooleanField(default=True)
    fin = models.CharField(max_length=300, blank=True, default='')
    punto_fin = gis_models.PointField(srid=4326, null=True, blank=True)
    # geometria_ruta es el recorrido completo: ida (inicio -> retorno) y vuelta (retorno -> fin). Este es el
    # índice del retorno dentro de la línea. None = ruta vieja con solo la ida trazada (el bus vuelve por ella).
    indice_retorno = models.IntegerField(null=True, blank=True)
    # Solo si el fin no es el inicio: el traslado del fin al inicio, sin pasajeros, para empezar otra vuelta.
    # No es parte del recorrido (no cuenta en la distancia ni se muestra a los pasajeros).
    geometria_regreso = gis_models.LineStringField(srid=4326, null=True, blank=True)
    # Calles por las que la empresa obliga a pasar cada tramo (el trazado no siempre es el más corto, sino el
    # que recoge más pasajeros). Se guardan para poder seguir ajustándolo. Ver limpiar_puntos_paso
    puntos_paso = models.JSONField(default=dict, blank=True)

    distancia_km = models.FloatField(default=0)
    # Aproximada: la empresa la puede escribir; si queda en 0 se calcula al guardar (ver minutos_de_recorrido)
    duracion_estimada_minutos = models.IntegerField(default=0)

    # La frecuencia no se guarda: depende de los turnos del día (la anota marcar_operacion). None = sin turnos hoy
    frecuencia_minutos = None

    # El estado dice si la ruta opera; "habilitado" dice si existe para el público.
    # Fuera de servicio = suspensión temporal y visible: el pasajero ve la ruta y el motivo, no circulan buses
    # y sus turnos quedan en pausa (el conductor no puede iniciar sesión con ellos) hasta que vuelva a Activa.
    estado = models.CharField(max_length=20, choices=[
        ('Activa', 'Activa'),
        ('Fuera_servicio', 'Fuera de servicio')
    ], default='Activa')
    motivo_fuera_servicio = models.CharField(max_length=180, blank=True, default='')
    # Alerta publicada al ponerla fuera de servicio; al reactivar la ruta pasa a Resuelta
    alerta_fuera_servicio = models.ForeignKey('Alerta', on_delete=models.SET_NULL, null=True, blank=True,
                                              related_name='+')
    # Alerta publicada al inhabilita    r la ruta; al volver a habilitarla pasa a Resuelta
    alerta_inhabilitada = models.ForeignKey('Alerta', on_delete=models.SET_NULL, null=True, blank=True,
                                            related_name='+')

    fecha_creacion = models.DateTimeField(auto_now_add=True)
    # Inhabilitar en vez de borrar: la ruta deja de mostrarse y de recibir turnos, pero su historial se conserva
    habilitado = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Ruta de Autobús'
        verbose_name_plural = 'Rutas de Autobuses'
        ordering = ['codigo']
        constraints = [
            # Dos empresas pueden usar el mismo código; una empresa no puede repetirlo
            models.UniqueConstraint(fields=['empresa', 'codigo'], name='ruta_codigo_unico_por_empresa'),
        ]

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"

    @property
    def fuera_de_servicio(self):
        """Puesta fuera de servicio a mano por la empresa (con motivo): sus turnos quedan en pausa."""
        return self.estado == 'Fuera_servicio'

    # Estado que se muestra en la web, la app y los reportes. Solo "Fuera de servicio" se guarda (la pone la
    # empresa a mano); los otros se calculan al momento y no pausan nada, para que los turnos puedan empezar.
    ESTADOS_VISIBLES = {
        'Activa': 'Activa',                       # turno en curso y algún bus enviando su ubicación
        'Sin_buses': 'Sin buses activos',         # turno en curso, pero ningún bus enviando su ubicación
        'Fuera_horario': 'Fuera de horario',      # ningún turno en curso ahora
        'Fuera_servicio': 'Fuera de servicio',    # pausada por la empresa, con motivo
    }

    @staticmethod
    def marcar_operacion(rutas, momento=None, minutos_sin_senal=5):
        """Anota en cada ruta si tiene turnos en curso y si algún bus de esos turnos está enviando su ubicación
        (un punto en esa ruta en los últimos `minutos_sin_senal`), y la frecuencia según los turnos de ese día.
        Pocas consultas para toda la lista. Devuelve la misma lista, como lista."""
        rutas = list(rutas)
        momento = momento or timezone.now()
        en_curso = set(Turno.vigentes(momento).filter(ruta__in=rutas).values_list('ruta_id', 'bus_id'))
        # Solo cuenta el último punto de cada bus, y no si va en traslado al inicio (no recoge pasajeros)
        recientes = {(ruta_id, bus_id) for ruta_id, bus_id, traslado in UbicacionBus.objects
                     .filter(ruta__in=rutas, timestamp__gte=momento - timedelta(minutes=minutos_sin_senal),
                             bus__habilitado=True, bus__activo=True)
                     .order_by('bus_id', '-timestamp').distinct('bus_id')
                     .values_list('ruta_id', 'bus_id', 'en_traslado') if not traslado}
        con_turno = {ruta_id for ruta_id, _ in en_curso}
        transmitiendo = {ruta_id for ruta_id, bus_id in en_curso & recientes}
        for ruta in rutas:
            ruta.tiene_turnos_en_curso = ruta.pk in con_turno
            ruta.tiene_buses_activos = ruta.pk in transmitiendo
        Ruta._marcar_frecuencia(rutas, momento)
        return rutas

    @staticmethod
    def _marcar_frecuencia(rutas, momento):
        """Cada cuántos minutos pasa un bus hoy: lo que tarda una vuelta completa repartido entre los buses que
        en promedio hay en turno mientras la ruta tiene servicio."""
        inicio = timezone.make_aware(datetime.combine(timezone.localtime(momento).date(), time.min))
        fin = inicio + timedelta(days=1)
        jornadas = {}
        turnos = Turno.que_se_cruzan(inicio, fin).filter(ruta__in=rutas, bus__habilitado=True,
                                                         conductor__habilitado=True)
        for turno in turnos:
            for desde, hasta in turno.ventanas(inicio, fin):
                jornadas.setdefault(turno.ruta_id, []).append((max(desde, inicio), min(hasta, fin)))

        for ruta in rutas:
            ruta.frecuencia_minutos = None
            propias = sorted(jornadas.get(ruta.pk, []))
            if not propias or not ruta.habilitado or ruta.fuera_de_servicio or not ruta.minutos_de_vuelta:
                continue
            # Tiempo sumado de todos los buses, y tiempo en que hay al menos uno (las jornadas unidas)
            tiempo_buses = sum((hasta - desde for desde, hasta in propias), timedelta())
            con_servicio, cubierto = timedelta(), inicio
            for desde, hasta in propias:
                if hasta > cubierto:
                    con_servicio += hasta - max(desde, cubierto)
                    cubierto = hasta
            if con_servicio:
                ruta.frecuencia_minutos = max(1, round(ruta.minutos_de_vuelta * (con_servicio / tiempo_buses)))

    @property
    def minutos_de_vuelta(self):
        """Lo que tarda un bus en volver a pasar por el mismo punto: el recorrido más el traslado al inicio (o,
        en una ruta con solo la ida trazada, devolverse por ella)."""
        if not self.duracion_estimada_minutos:
            return 0
        if self.tiene_traslado:
            return self.duracion_estimada_minutos + minutos_de_recorrido(_km_de_linea(self.geometria_regreso))
        if self.geometria_ruta and not self.tiene_vuelta:
            return self.duracion_estimada_minutos * 2
        return self.duracion_estimada_minutos

    @property
    def estado_visible(self):
        """Requiere haber llamado antes a Ruta.marcar_operacion (sin ella, se muestra el estado guardado)."""
        if self.fuera_de_servicio:
            return 'Fuera_servicio'
        if not hasattr(self, 'tiene_turnos_en_curso'):
            return self.estado
        if not self.tiene_turnos_en_curso:
            return 'Fuera_horario'
        return 'Activa' if self.tiene_buses_activos else 'Sin_buses'

    @property
    def nombre_estado_visible(self):
        return self.ESTADOS_VISIBLES[self.estado_visible]

    @property
    def motivo_visible(self):
        """Explicación para el pasajero."""
        return {
            'Fuera_servicio': self.motivo_fuera_servicio,
            'Sin_buses': 'Hay buses programados, pero ninguno está enviando su ubicación en este momento.',
            'Fuera_horario': 'No hay buses programados en este momento.',
        }.get(self.estado_visible, '')

    @property
    def motivo_empresa(self):
        """Explicación para la empresa, que es quien puede arreglarlo."""
        return {
            'Fuera_servicio': self.motivo_fuera_servicio,
            'Sin_buses': 'Tiene turnos en curso, pero ningún bus está enviando su ubicación en el recorrido '
                         '(sin señal o en traslado al inicio).',
            'Fuera_horario': 'Sin turnos en curso: ningún bus tiene turno en esta ruta ahora.',
        }.get(self.estado_visible, '')

    def save(self, *args, **kwargs):
        if self.geometria_ruta and self.geometria_ruta.coords:
            coord_origen = self.geometria_ruta.coords[0]
            coord_destino = (self.geometria_ruta.coords[self.indice_retorno] if self.tiene_vuelta
                             else self.geometria_ruta.coords[-1])

            if not self.punto_origen:
                self.punto_origen = Point(coord_origen[0], coord_origen[1])
            if not self.punto_destino:
                self.punto_destino = Point(coord_destino[0], coord_destino[1])

        # Si el fin es el mismo origen, se copia para que siempre quede completo, y no hay traslado
        if self.fin_es_origen:
            self.fin = self.origen
            self.punto_fin = self.punto_origen
            self.geometria_regreso = None

        if not self.duracion_estimada_minutos:
            self.duracion_estimada_minutos = minutos_de_recorrido(
                self.distancia_km or _km_de_linea(self.geometria_ruta))

        super().save(*args, **kwargs)

    def get_coordenadas_ruta(self):
        if self.geometria_ruta:
            return list(self.geometria_ruta.coords)
        return []

    @property
    def fin_visible(self):
        """Dónde termina la ruta, para mostrar: el mismo inicio o el fin que se marcó."""
        return self.origen if self.fin_es_origen else (self.fin or self.origen)

    @property
    def recorrido(self):
        """Texto del recorrido completo: "Inicio → Retorno → Fin"."""
        return f'{self.origen} → {self.destino} → {self.fin_visible}'

    @property
    def tiene_vuelta(self):
        """True si el trazado incluye la vuelta; False en rutas viejas con solo la ida."""
        n = len(self.geometria_ruta.coords) if self.geometria_ruta else 0
        return self.indice_retorno is not None and 0 < self.indice_retorno < n - 1

    @property
    def tiene_traslado(self):
        """True si al terminar el recorrido el bus debe trasladarse del fin al inicio (sin pasajeros)."""
        return (not self.fin_es_origen and self.geometria_regreso is not None
                and len(self.geometria_regreso.coords) >= 2)

    def get_coordenadas_regreso(self):
        return list(self.geometria_regreso.coords) if self.tiene_traslado else []

    def puntos_clave(self):
        """Inicio, retorno y fin como [lng, lat] (para dibujar los pines), más el índice del retorno."""
        coords = self.get_coordenadas_ruta()
        if not coords:
            return {'punto_inicio': None, 'punto_retorno': None, 'punto_fin': None, 'indice_retorno': None}
        if self.tiene_vuelta:
            retorno, fin = coords[self.indice_retorno], coords[-1]
        else:
            # Solo la ida: el retorno es el final de la línea y el fin, el inicio (o el que se marcó)
            retorno = coords[-1]
            fin = [self.punto_fin.x, self.punto_fin.y] if self.punto_fin else coords[0]
        return {'punto_inicio': list(coords[0]), 'punto_retorno': list(retorno), 'punto_fin': list(fin),
                'indice_retorno': self.indice_retorno if self.tiene_vuelta else None}


class UbicacionBus(models.Model):
    # PROTECT: borrar una ruta o un bus no debe borrar su historial de ubicaciones (se inhabilitan)
    bus = models.ForeignKey('Bus', on_delete=models.PROTECT, related_name='ubicaciones')
    ruta = models.ForeignKey(Ruta, on_delete=models.PROTECT, related_name='ubicaciones_bus')
    # Quién manejaba cuando se registró el punto (None si viene del simulador)
    conductor = models.ForeignKey('Conductor', on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='ubicaciones')

    latitud = models.FloatField()
    longitud = models.FloatField()
    velocidad = models.FloatField(default=0)
    # Regresando del fin al inicio de la ruta, sin pasajeros: no se muestra a los pasajeros
    en_traslado = models.BooleanField(default=False)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Ubicación de Bus'
        verbose_name_plural = 'Ubicaciones de Buses'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['bus', 'timestamp']),
            models.Index(fields=['ruta', 'timestamp']),
        ]

    def __str__(self):
        return f"Bus {self.bus.placa} - {self.timestamp}"


class Conductor(ContrasenaCifradaMixin, models.Model):
    id_conductor = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='conductores')
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15) # <--- Si quieres que sea único, agrega unique=True aquí, pero primero borra el duplicado en la BD
    email = models.EmailField(max_length=100, unique=True)
    cedula = models.CharField(max_length=50, unique=True)
    contrasena = models.CharField(max_length=128)
    # Inhabilitado: no puede entrar a la app ni recibir turnos, pero su historial se conserva
    habilitado = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('email'), name='conductor_email_unico_sin_mayusculas'),
        ]

    def __str__(self):
        return f"{self.nombre} - {self.cedula}"

    def save(self, *args, **kwargs):
        self.email = (self.email or '').strip().lower()
        super().save(*args, **kwargs)

    def turno_actual(self, momento=None):
        """Turno que el conductor está cubriendo ahora (o en `momento`), o None."""
        return Turno.vigentes(momento).filter(conductor=self).select_related('bus', 'ruta').first()

    @property
    def bus_asignado(self):
        turno = self.turno_actual()
        return turno.bus if turno else None

    @property
    def ruta(self):
        turno = self.turno_actual()
        return turno.ruta if turno else None


class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='buses')
    placa = models.CharField(max_length=20, unique=True)
    # Rutas que este bus puede cubrir; la que cubre en cada momento la define el turno
    rutas = models.ManyToManyField(Ruta, related_name='buses', blank=True)

    activo = models.BooleanField(default=False)  # transmitiendo ubicación ahora
    # Inhabilitado: no recibe turnos ni se simula ni aparece en el mapa, pero su historial se conserva
    habilitado = models.BooleanField(default=True)
    ultima_ubicacion = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.placa

    def turno_actual(self, momento=None):
        """Turno vigente del bus ahora (o en `momento`), o None."""
        return Turno.vigentes(momento).filter(bus=self).select_related('conductor', 'ruta').first()

    @property
    def ruta_actual(self):
        """Ruta del turno vigente. Sin turno (p. ej. en el simulador) usa la primera ruta del bus."""
        turno = self.turno_actual()
        if turno:
            return turno.ruta
        return self.rutas.filter(habilitado=True).exclude(estado='Fuera_servicio').order_by('codigo').first()

    @property
    def conductor_actual(self):
        turno = self.turno_actual()
        return turno.conductor if turno else None


class Turno(models.Model):
    """Asigna un conductor a un bus y una ruta. Todo turno tiene hora de fin.

    - Rotación: un turno por jornada, de `inicio` a `fin`; puede cruzar la medianoche (22:00 a 06:00).
    - Asignación fija (`fijo`): se repite cada día (o solo los `dias` elegidos) de la hora de `inicio`
      a `hora_fin`, desde la fecha de `inicio` y sin fecha final. `fin` queda vacío hasta que se finaliza.
    Un conductor no puede tener dos turnos que se crucen, y un bus tampoco.
    Los turnos no se borran una vez empezados: son el historial de quién manejó qué bus.
    """
    NOMBRES_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    # El horario de un fijo se repite cada semana: revisar 9 días basta para encontrar cualquier cruce
    DIAS_PATRON = 9

    id_turno = models.AutoField(primary_key=True)
    conductor = models.ForeignKey(Conductor, on_delete=models.PROTECT, related_name='turnos')
    bus = models.ForeignKey(Bus, on_delete=models.PROTECT, related_name='turnos')
    ruta = models.ForeignKey(Ruta, on_delete=models.PROTECT, related_name='turnos')
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    fijo = models.BooleanField(default=False)
    # Solo para fijos: hora diaria en que termina la jornada (menor que la de inicio = nocturno)
    hora_fin = models.TimeField(null=True, blank=True)
    # Solo para fijos: días de la semana separados por coma (0 = lunes). Vacío = todos los días
    dias = models.CharField(max_length=13, blank=True, default='')
    # Agrupa los turnos programados juntos (una rotación de varios días, o los tramos de un fijo
    # que se editó "solo este día" o "desde este día"). Vacío = turno suelto.
    serie = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ['inicio']
        indexes = [
            models.Index(fields=['conductor', 'inicio'], name='core_turno_conduct_idx'),
            models.Index(fields=['bus', 'inicio'], name='core_turno_bus_idx'),
        ]
        constraints = [
            # Ningún turno queda sin hora de fin: la rotación tiene `fin` y el fijo su `hora_fin` diaria
            models.CheckConstraint(
                condition=Q(fijo=False, fin__isnull=False) | Q(fijo=True, hora_fin__isnull=False),
                name='turno_con_hora_de_fin',
            ),
        ]

    def __str__(self):
        inicio = timezone.localtime(self.inicio)
        base = f"{self.conductor.nombre} · {self.bus.placa} · {self.ruta.codigo}"
        if self.fijo:
            hasta = f" hasta {timezone.localtime(self.fin):%d/%m}" if self.fin else ''
            return f"{base} (fijo desde {inicio:%d/%m}{hasta}, {self.horario_texto})"
        return f"{base} ({fecha_hora12(inicio)} - {fecha_hora12(self.fin)})"

    # ===== HORARIO =====

    def dias_semana(self):
        return {int(d) for d in self.dias.split(',') if d.isdigit()}

    @property
    def dias_texto(self):
        dias = sorted(self.dias_semana())
        return ', '.join(self.NOMBRES_DIAS[d] for d in dias) if dias else 'todos los días'

    @property
    def horario_texto(self):
        """Ej.: "5:00 a. m. a 1:00 p. m., Lun, Mar" (solo tiene sentido para fijos)."""
        hora_fin = hora12(self.hora_fin) if self.hora_fin else 'sin hora de fin'
        return f"{hora12(self.inicio)} a {hora_fin}, {self.dias_texto}"

    def ventanas(self, desde, hasta):
        """Jornadas (inicio, fin) del turno que se cruzan con el periodo [desde, hasta)."""
        if not self.fijo:
            if self.inicio < hasta and self.fin > desde:
                yield self.inicio, self.fin
            return

        limite = min(hasta, self.fin) if self.fin else hasta
        hora_inicio = timezone.localtime(self.inicio).time()
        dias = self.dias_semana()
        # Se empieza un día antes por la jornada nocturna que viene de la víspera
        dia = max(timezone.localtime(self.inicio).date(), timezone.localtime(desde).date() - timedelta(days=1))
        while True:
            empieza = timezone.make_aware(datetime.combine(dia, hora_inicio))
            if empieza >= limite:
                return
            if not dias or dia.weekday() in dias:
                termina = timezone.make_aware(datetime.combine(dia, self.hora_fin))
                if termina <= empieza:
                    termina += timedelta(days=1)  # nocturno: termina al día siguiente
                if self.fin:
                    termina = min(termina, self.fin)  # finalizado a mitad de la jornada
                if termina > desde and termina > empieza:
                    yield empieza, termina
            dia += timedelta(days=1)

    def jornada_actual(self, momento=None):
        """(inicio, fin) de la jornada en curso, o None si el turno no está en horario."""
        momento = momento or timezone.now()
        if self.inicio > momento or (self.fin and self.fin <= momento):
            return None
        return next(self.ventanas(momento, momento + timedelta(microseconds=1)), None)

    @property
    def fin_actual(self):
        """Hora en que termina la jornada en curso (la de hoy, en un fijo)."""
        jornada = self.jornada_actual()
        return jornada[1] if jornada else self.fin

    def proximo_inicio(self, momento=None):
        """Cuándo empieza la próxima jornada después de `momento`, o None."""
        momento = momento or timezone.now()
        for empieza, _ in self.ventanas(momento, momento + timedelta(days=self.DIAS_PATRON)):
            if empieza > momento:
                return empieza
        return None

    def se_cruza_con(self, otro):
        """True si alguna jornada de este turno se solapa con una del otro."""
        desde = max(self.inicio, otro.inicio)
        hasta = min(f for f in (self.fin, otro.fin, desde + timedelta(days=self.DIAS_PATRON)) if f)
        if desde >= hasta:
            return False
        otras = list(otro.ventanas(desde, hasta))
        return any(a < d and c < b for a, b in self.ventanas(desde, hasta) for c, d in otras)

    # ===== CONSULTAS =====

    @classmethod
    def vigentes(cls, momento=None):
        """Turnos que se están cubriendo en `momento` (un fijo, solo dentro de su horario)."""
        momento = momento or timezone.now()
        en_periodo = cls.objects.filter(inicio__lte=momento).filter(Q(fin__isnull=True) | Q(fin__gt=momento))
        en_horario = [t.pk for t in en_periodo.filter(fijo=True) if t.jornada_actual(momento)]
        return en_periodo.filter(Q(fijo=False) | Q(pk__in=en_horario))

    @classmethod
    def que_se_cruzan(cls, inicio, fin):
        """Turnos con alguna jornada en el periodo [inicio, fin). fin=None es indefinido."""
        qs = cls.objects.filter(Q(fin__isnull=True) | Q(fin__gt=inicio))
        if fin is not None:
            qs = qs.filter(inicio__lt=fin)
        hasta = fin or inicio + timedelta(days=cls.DIAS_PATRON)
        con_jornada = [t.pk for t in qs.filter(fijo=True) if next(t.ventanas(inicio, hasta), None)]
        return qs.filter(Q(fijo=False) | Q(pk__in=con_jornada))

    @classmethod
    def pendientes(cls):
        """Turnos en curso o programados (los que aún no terminan)."""
        return cls.objects.filter(Q(fin__isnull=True) | Q(fin__gt=timezone.now()))

    @property
    def estado(self):
        """Programado (aún no empieza), En curso (ya empezó y no ha terminado) o Finalizado.
        Una asignación fija vigente está En curso aunque ahora no sea su jornada: sigue asignada. Si el
        conductor puede trabajar en este momento lo dicen `jornada_actual` y `Turno.vigentes`."""
        ahora = timezone.now()
        if self.inicio > ahora:
            return 'Programado'
        if self.fin is not None and self.fin <= ahora:
            return 'Finalizado'
        return 'En curso'

    @property
    def en_pausa(self):
        """La ruta está fuera de servicio: el turno sigue programado, pero el conductor no puede
        iniciar sesión ni enviar ubicación con él hasta que la ruta vuelva a Activa."""
        return self.ruta.fuera_de_servicio and self.estado != 'Finalizado'

    def validar(self):
        """Devuelve un mensaje de error si el turno no es válido, o None."""
        problema = self.problema()
        return problema[0] if problema else None

    def problema(self):
        """(mensaje, campos del formulario que lo causan) si el turno no es válido, o None.
        Los campos permiten señalar en el formulario qué hay que cambiar."""
        if self.fijo and self.hora_fin is None:
            return 'Indica la hora de fin de la jornada.', ('hora_fin',)
        if not self.fijo and self.fin is None:
            return 'Indica la hora de fin del turno.', ('hora_fin',)
        if self.fin is not None and self.fin <= self.inicio:
            return 'La hora de fin debe ser posterior a la de inicio.', ('hora_fin',)
        if self.fijo and not self.dias_semana() <= set(range(7)):
            return 'Los días de la semana no son válidos.', ('dias',)
        if not (self.conductor.empresa_id == self.bus.empresa_id == self.ruta.empresa_id):
            return 'El conductor, el bus y la ruta deben ser de la misma empresa.', ('conductor', 'bus', 'ruta')
        if not self.bus.rutas.filter(pk=self.ruta_id).exists():
            return f'El bus {self.bus.placa} no tiene habilitada la ruta {self.ruta.codigo}.', ('bus', 'ruta')
        if self.ruta.estado == 'Fuera_servicio':
            return f'La ruta {self.ruta.codigo} está fuera de servicio.', ('ruta',)
        if not self.conductor.habilitado:
            return f'{self.conductor.nombre} está inhabilitado.', ('conductor',)
        if not self.bus.habilitado:
            return f'El bus {self.bus.placa} está inhabilitado.', ('bus',)
        if not self.ruta.habilitado:
            return f'La ruta {self.ruta.codigo} está inhabilitada.', ('ruta',)

        # Un cruce se arregla eligiendo otro conductor/bus o cambiando el horario
        horario = ('desde', 'hasta', 'hora_inicio', 'hora_fin', 'dias')
        # Candidatos por periodo (en SQL); el cruce real de horarios se revisa jornada por jornada
        candidatos = (Turno.objects.filter(Q(fin__isnull=True) | Q(fin__gt=self.inicio))
                      .exclude(pk=self.pk).select_related('conductor', 'bus', 'ruta'))
        if self.fin is not None:
            candidatos = candidatos.filter(inicio__lt=self.fin)
        for choque in candidatos.filter(conductor_id=self.conductor_id):
            if self.se_cruza_con(choque):
                return f'{self.conductor.nombre} ya tiene un turno que se cruza: {choque}.', ('conductor',) + horario
        for choque in candidatos.filter(bus_id=self.bus_id):
            if self.se_cruza_con(choque):
                return f'El bus {self.bus.placa} ya tiene un turno que se cruza: {choque}.', ('bus',) + horario
        return None


class Usuario(ContrasenaCifradaMixin, models.Model):
    id_usuario = models.AutoField(primary_key=True)
    email = models.CharField(max_length=100, unique=True)
    contrasena = models.CharField(max_length=128)
    nombre = models.CharField(max_length=100)
    nickName = models.CharField(max_length=100, unique=True)

    telefono = models.CharField(
        max_length=15,
        unique=True,
        null=True,
        blank=True,
        validators=[
            RegexValidator(
                regex=r'^\d{7,15}$',
                message='El teléfono debe contener solo números (entre 7 y 15 dígitos).'
            )
        ]
    )

    color_perfil = models.CharField(max_length=7, default='#E63946')

    # Cómo se mueve el mapa en el celular. Vacío = todavía no lo eligió (se le pregunta una vez)
    DESPLAZAMIENTOS = DESPLAZAMIENTOS_MAPA
    desplazamiento_mapa = models.CharField(max_length=10, choices=DESPLAZAMIENTOS, blank=True, default='')
    # Al primer inicio de sesión se pregunta si seguir en el mapa o conocer LocalBus (Acerca de)
    vio_bienvenida = models.BooleanField(default=False)
    # Tema de la página. "sistema" = el mismo del celular o computador (claro u oscuro)
    TEMAS = TEMAS_PAGINA
    tema = models.CharField(max_length=10, choices=TEMAS, default='sistema')

    codigo_recuperacion = models.CharField(max_length=6, blank=True, null=True)
    codigo_expiracion = models.DateTimeField(blank=True, null=True)

    # Rutas de las que quiere recibir avisos de alertas en la web. Sin ninguna, recibe las de todas.
    rutas_seguidas = models.ManyToManyField(Ruta, blank=True, related_name='seguidores')

    class Meta:
        constraints = [
            # "Ana@x.com" y "ana@x.com" son el mismo correo; "Juan" y "juan", el mismo nombre de usuario.
            # Así el login (que busca sin distinguir mayúsculas) nunca encuentra dos usuarios.
            models.UniqueConstraint(Lower('email'), name='usuario_email_unico_sin_mayusculas'),
            models.UniqueConstraint(Lower('nickName'), name='usuario_nickname_unico_sin_mayusculas'),
        ]

    def __str__(self):
        return self.nickName

    def save(self, *args, **kwargs):
        # El correo se guarda en minúsculas; el nickname conserva cómo lo escribió el usuario
        self.email = (self.email or '').strip().lower()
        self.nickName = (self.nickName or '').strip()
        # El teléfono es opcional y único: sin teléfono se guarda NULL (no '')
        # para que varios usuarios puedan quedar sin teléfono.
        self.telefono = (self.telefono or '').strip() or None
        super().save(*args, **kwargs)

    @property
    def iniciales(self):
        if not self.nombre:
            return 'U'
        partes = self.nombre.strip().split()
        if len(partes) >= 2:
            return (partes[0][0] + partes[1][0]).upper()
        elif len(partes) == 1:
            return partes[0][:2].upper()
        return 'U'


class Alerta(models.Model):
    """La crea un pasajero (`usuario`, nace Pendiente) o la empresa dueña de la ruta (`empresa`, nace
    En proceso o Resuelta). Siempre tiene uno de los dos como autor."""
    id_alerta = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name='alertas', null=True, blank=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='alertas_publicadas',
                                null=True, blank=True)
    ruta = models.ForeignKey(Ruta, on_delete=models.PROTECT, related_name="alertas")
    tipo = models.CharField(max_length=200)
    descripcion = models.CharField(max_length=200)
    estado = models.CharField(
        max_length=50,
        choices=[
            ('Pendiente', 'Pendiente'),
            ('En_proceso', 'En Proceso'),
            ('Resuelta', 'Resuelta'),
            ('Cancelada', 'Cancelada'),
        ],
        default='Pendiente'
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    # Dónde estaba el pasajero al reportar (si dejó que la web viera su ubicación)
    latitud = models.FloatField(null=True, blank=True)
    longitud = models.FloatField(null=True, blank=True)
    # Si es el mismo problema que otra alerta (misma ruta y tipo, a menos de 700 m), apunta a la primera.
    # Las repetidas no salen en las listas: la empresa las ve dentro de la principal, en "Reportes relacionados".
    alerta_principal = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True,
                                         related_name='relacionadas')
    # Otras rutas que pasan a 500 m o menos de donde se reportó (la alerta es de `ruta`; sus empresas reciben un aviso)
    rutas_cercanas = models.ManyToManyField(Ruta, blank=True, related_name='alertas_cercanas')
    # Cuándo pasó a ser pública (En proceso o Resuelta). Las notificaciones de la web siguen este orden y no el
    # id: una alerta de pasajero se crea antes y se publica después, cuando ya hay otras con id mayor.
    fecha_publicacion = models.DateTimeField(null=True, blank=True, db_index=True)
    # La empresa puede publicarla con duración: al pasar esta hora deja de estar En proceso y queda Resuelta
    vence_en = models.DateTimeField(null=True, blank=True)
    # Por qué la empresa la descartó (solo alertas de pasajeros); el pasajero lo ve en "Mis reportes"
    MOTIVOS_DESCARTE = [
        ('no_aplica', 'No corresponde a la ruta'),
        ('duplicada', 'Ya estaba reportada'),
        ('resuelto', 'El problema ya se resolvió'),
        ('spam', 'Reporte no válido'),
    ]
    motivo_descarte = models.CharField(max_length=20, choices=MOTIVOS_DESCARTE, blank=True, default='')
    # Reportes que solo confirman ("Yo también lo veo"): se suman a la principal sin texto propio
    confirmacion = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(usuario__isnull=False) | Q(empresa__isnull=False),
                name='alerta_con_autor',
            ),
        ]
        indexes = [
            models.Index(fields=['estado', 'vence_en'], name='alerta_vencimiento_idx'),
            models.Index(fields=['usuario', 'fecha_creacion'], name='alerta_usuario_fecha_idx'),
        ]

    def __str__(self):
        return self.descripcion

    def save(self, *args, **kwargs):
        if self.estado in ('En_proceso', 'Resuelta') and self.fecha_publicacion is None:
            self.fecha_publicacion = timezone.now()
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = set(kwargs['update_fields']) | {'fecha_publicacion'}
        super().save(*args, **kwargs)

    @classmethod
    def cerrar_vencidas(cls):
        """Las alertas En proceso cuya duración ya pasó quedan Resueltas (también sus reportes sumados).
        Se llama al leer las alertas: no hace falta una tarea programada."""
        ahora = timezone.now()
        vencidas = list(cls.objects.filter(estado='En_proceso', vence_en__lte=ahora).values_list('pk', flat=True))
        if vencidas:
            cls.objects.filter(Q(pk__in=vencidas) | Q(alerta_principal_id__in=vencidas)).exclude(
                estado='Cancelada').update(estado='Resuelta')
        return len(vencidas)

    @property
    def descartada_por_empresa(self):
        return self.estado == 'Cancelada' and bool(self.motivo_descarte)

    @property
    def autor(self):
        """Nombre de quien la creó: el nickname del pasajero o el nombre de la empresa."""
        if self.usuario_id:
            return self.usuario.nickName
        return self.empresa.nombre if self.empresa_id else 'Anónimo'


class SuscripcionRutas(models.Model):
    """Rutas de las que un celular (app de pasajeros) quiere recibir alertas por push.
    Sin registro, o con la lista vacía, el celular recibe las alertas de todas las rutas."""
    dispositivo = models.OneToOneField('fcm_django.FCMDevice', on_delete=models.CASCADE,
                                       related_name='suscripcion_rutas')
    rutas = models.ManyToManyField(Ruta, blank=True, related_name='suscripciones_push')

    def __str__(self):
        return f'Suscripción de {self.dispositivo_id}'


class ConfiguracionBus(models.Model):
    bus = models.OneToOneField(
        Bus,
        on_delete=models.CASCADE,
        related_name='configuracion'
    )

    velocidad_kmh = models.FloatField(default=30)
    simulando = models.BooleanField(default=False)
    direccion = models.IntegerField(default=1)
    posicion_actual = models.IntegerField(default=0)
    distancia_recorrida = models.FloatField(default=0)
    metros_en_segmento = models.FloatField(default=0)
    # True mientras recorre el traslado del fin al inicio (posicion_actual es entonces un índice de
    # Ruta.geometria_regreso, no del recorrido)
    en_traslado = models.BooleanField(default=False)
    ultima_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Configuración de Bus'
        verbose_name_plural = 'Configuraciones de Buses'

    def __str__(self):
        estado = "🟢 Simulando" if self.simulando else "🔴 Detenido"
        return f"{self.bus.placa} - {self.velocidad_kmh} km/h - {estado}"


# ==================== SEÑAL: NOTIFICAR AL CREAR UNA ALERTA ====================

logger = logging.getLogger(__name__)

# Apps que reciben las alertas por push. La app del conductor solo comparte la
# ubicación, así que no recibe notificaciones aunque registre su token.
APPS_CON_NOTIFICACIONES = ('mapa',)


@receiver(post_save, sender=Alerta)
def notificar_alerta_nueva(sender, instance, created, **kwargs):
    """Notificación push a la app de pasajeros cuando la alerta nace ya publicada (En proceso).
    Las que crean los pasajeros nacen Pendiente: su push sale al publicarlas (views._publicar_si_corresponde).
    Se envía cuando la alerta ya quedó guardada, para no notificar una alerta
    que al final no se creó ni hacer esperar la petición dentro de la transacción."""
    # Un reporte que se suma a otra alerta no se notifica: la principal ya se avisó (o se avisará al publicarla)
    if created and instance.estado == 'En_proceso' and instance.alerta_principal_id is None:
        transaction.on_commit(lambda: enviar_push_alerta(instance.pk))


def enviar_push_alerta(id_alerta, titulo="🚨 Nueva Alerta"):
    if settings.FIREBASE_APP is None:
        logger.warning('Alerta %s sin notificación push: falta el archivo de credenciales de Firebase', id_alerta)
        return

    try:
        from fcm_django.models import FCMDevice
        from firebase_admin.messaging import Message, Notification

        alerta = Alerta.objects.select_related('ruta').filter(pk=id_alerta).first()
        if alerta is None:
            return
        # Un dispositivo que eligió rutas solo recibe las de esas rutas; sin elegir ninguna, recibe todas
        dispositivos = (FCMDevice.objects.filter(active=True, name__in=APPS_CON_NOTIFICACIONES)
                        .filter(Q(suscripcion_rutas__isnull=True) | Q(suscripcion_rutas__rutas__isnull=True)
                                | Q(suscripcion_rutas__rutas=alerta.ruta_id))
                        .distinct())
        if not dispositivos.exists():
            return

        mensaje = Message(
            notification=Notification(
                title=titulo,
                body=f"{alerta.ruta.nombre}: {alerta.descripcion}"
            ),
            data={
                "alerta_id": str(alerta.id_alerta),
                "tipo": alerta.tipo,
                "ruta": alerta.ruta.nombre,
                "ruta_id": str(alerta.ruta_id),
            }
        )

        # Un solo lote; fcm-django desactiva los tokens que Firebase rechaza
        dispositivos.send_message(mensaje)
    except Exception:
        logger.exception('No se pudo enviar la notificación push de la alerta %s', id_alerta)

# ================= MENSAJES ENTRE LA EMPRESA Y SUS CONDUCTORES =================

class Difusion(models.Model):
    """Un mensaje que la empresa mandó a un grupo de conductores. Cada conductor lo recibe como un Mensaje
    en su propio chat (enlazado aquí), así cada uno puede responder a la empresa en privado."""
    GRUPOS = {
        'todos': 'Todos los conductores',
        'en_curso': 'Conductores con turno en curso',
        'hoy': 'Conductores con turno hoy',
        'ruta_ahora': 'Conductores en una ruta ahora',
        'ruta_dia': 'Conductores de una ruta en un día',
    }
    id_difusion = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.CASCADE, related_name='difusiones')
    enviado_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='+')
    grupo = models.CharField(max_length=12, choices=list(GRUPOS.items()))
    # A quiénes iba, en palabras (p. ej. "R05 · Terminal del Norte, jueves 12 de noviembre"): el grupo cambia con el tiempo
    destino = models.CharField(max_length=200)
    texto = models.TextField(max_length=1000)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado']

    def __str__(self):
        return f'{self.destino}: {self.texto[:40]}'


class Mensaje(models.Model):
    """Un mensaje del chat entre la empresa y UN conductor (la conversación es el par empresa-conductor)."""
    id_mensaje = models.AutoField(primary_key=True)
    conductor = models.ForeignKey(Conductor, on_delete=models.CASCADE, related_name='mensajes')
    # True: lo escribió la empresa; False: lo escribió el conductor desde la app
    de_empresa = models.BooleanField()
    enviado_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='+')
    difusion = models.ForeignKey(Difusion, on_delete=models.SET_NULL, null=True, blank=True, related_name='mensajes')
    texto = models.TextField(max_length=1000)
    creado = models.DateTimeField(auto_now_add=True)
    # Cuándo lo leyó quien lo recibe (el conductor si es de la empresa; la empresa si es del conductor)
    leido = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['creado', 'id_mensaje']
        indexes = [models.Index(fields=['conductor', 'creado'], name='core_mensaje_conv_idx')]

    def __str__(self):
        return f'{"Empresa" if self.de_empresa else self.conductor.nombre}: {self.texto[:40]}'

    def como_dict(self):
        return {'id': self.id_mensaje, 'de_empresa': self.de_empresa, 'texto': self.texto,
                'creado': timezone.localtime(self.creado).isoformat(), 'hora': hora12(self.creado),
                'fecha': timezone.localtime(self.creado).strftime('%d/%m/%Y'),
                'grupo': self.difusion.destino if self.difusion_id else '',
                'leido': bool(self.leido)}


def enviar_push_mensajes(ids_mensajes):
    """Avisa a cada conductor, en la app del conductor, que la empresa le escribió. Los dispositivos del
    conductor se guardan con device_id "conductor-<id>" al registrar el token con la sesión iniciada."""
    if settings.FIREBASE_APP is None or not ids_mensajes:
        return
    try:
        from fcm_django.models import FCMDevice
        from firebase_admin.messaging import Message, Notification

        for mensaje in Mensaje.objects.filter(pk__in=ids_mensajes).select_related('conductor__empresa'):
            dispositivos = FCMDevice.objects.filter(active=True, name='conductor',
                                                    device_id=f'conductor-{mensaje.conductor_id}')
            if not dispositivos.exists():
                continue
            dispositivos.send_message(Message(
                notification=Notification(title=f'Mensaje de {mensaje.conductor.empresa.nombre}',
                                          body=mensaje.texto[:180]),
                data={'tipo': 'mensaje', 'mensaje_id': str(mensaje.pk)},
            ))
    except Exception:
        logger.exception('No se pudo enviar la notificación push de los mensajes %s', ids_mensajes[:5])


class Respaldo(models.Model):
    """Registro de cada backup que una empresa descargó o restauró (quién y cuándo). El archivo no se guarda
    en el servidor: se genera al momento y se entrega a quien lo pidió."""
    id_respaldo = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.CASCADE, related_name='respaldos')
    hecho_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='+')
    creado = models.DateTimeField(auto_now_add=True)
    tamano_bytes = models.BigIntegerField(default=0)
    registros = models.IntegerField(default=0)
    # "descarga": se bajó un backup; "restauracion": se cargó uno (registros = los que se agregaron);
    # "carga": se cargaron datos desde hojas de cálculo (Excel o CSV)
    tipo = models.CharField(max_length=12, choices=[('descarga', 'Descarga'), ('restauracion', 'Restauración'),
                                                    ('carga', 'Carga')],
                            default='descarga')
    archivo = models.CharField(max_length=200, blank=True, default='')   # nombre del .zip restaurado

    class Meta:
        ordering = ['-creado']
