import logging
from datetime import datetime, timedelta

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


class ContrasenaCifradaMixin:
    """Para modelos con un campo `contrasena`: se guarda cifrada, nunca en texto plano."""

    def set_contrasena(self, contrasena):
        self.contrasena = make_password(contrasena)

    def verificar_contrasena(self, contrasena):
        return bool(contrasena) and check_password(contrasena, self.contrasena)


class Empresa(models.Model):
    """Empresa de transporte. Cada una ve y administra solo sus rutas, buses, conductores y turnos."""
    id_empresa = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=150)
    nit = models.CharField(max_length=20, unique=True)
    activa = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre


class Administrador(models.Model):
    """Cuenta de Django que administra una empresa (se crea desde /admin/)."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='administrador')
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='administradores')

    class Meta:
        verbose_name_plural = 'Administradores'

    def __str__(self):
        return f"{self.user.get_username()} ({self.empresa})"


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

    paradas = gis_models.MultiPointField(srid=4326, null=True, blank=True)
    num_paradas = models.IntegerField(default=0)

    distancia_km = models.FloatField(default=0)
    duracion_estimada_minutos = models.IntegerField(default=0)

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
    frecuencia_minutos = models.IntegerField(default=0)
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
        (un punto en esa ruta en los últimos `minutos_sin_senal`). Dos consultas para toda la lista.
        Devuelve la misma lista, como lista."""
        rutas = list(rutas)
        momento = momento or timezone.now()
        en_curso = set(Turno.vigentes(momento).filter(ruta__in=rutas).values_list('ruta_id', 'bus_id'))
        recientes = set(UbicacionBus.objects
                        .filter(ruta__in=rutas, timestamp__gte=momento - timedelta(minutes=minutos_sin_senal),
                                bus__habilitado=True, bus__activo=True)
                        .values_list('ruta_id', 'bus_id').distinct())
        con_turno = {ruta_id for ruta_id, _ in en_curso}
        transmitiendo = {ruta_id for ruta_id, bus_id in en_curso & recientes}
        for ruta in rutas:
            ruta.tiene_turnos_en_curso = ruta.pk in con_turno
            ruta.tiene_buses_activos = ruta.pk in transmitiendo
        return rutas

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
            'Sin_buses': 'Tiene turnos en curso, pero ningún bus está enviando su ubicación.',
            'Fuera_horario': 'Sin turnos en curso: ningún bus tiene turno en esta ruta ahora.',
        }.get(self.estado_visible, '')

    def save(self, *args, **kwargs):
        if self.paradas:
            self.num_paradas = len(self.paradas)

        if self.geometria_ruta and self.geometria_ruta.coords:
            coord_origen = self.geometria_ruta.coords[0]
            coord_destino = self.geometria_ruta.coords[-1]

            if not self.punto_origen:
                self.punto_origen = Point(coord_origen[0], coord_origen[1])
            if not self.punto_destino:
                self.punto_destino = Point(coord_destino[0], coord_destino[1])

        super().save(*args, **kwargs)

    def get_coordenadas_ruta(self):
        if self.geometria_ruta:
            return list(self.geometria_ruta.coords)
        return []

    def get_paradas_coordenadas(self):
        if self.paradas:
            return [{'lat': p.y, 'lng': p.x} for p in self.paradas]
        return []


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
        return f"{base} ({inicio:%d/%m %H:%M} - {timezone.localtime(self.fin):%d/%m %H:%M})"

    # ===== HORARIO =====

    def dias_semana(self):
        return {int(d) for d in self.dias.split(',') if d.isdigit()}

    @property
    def dias_texto(self):
        dias = sorted(self.dias_semana())
        return ', '.join(self.NOMBRES_DIAS[d] for d in dias) if dias else 'todos los días'

    @property
    def horario_texto(self):
        """Ej.: "05:00 a 13:00, Lun, Mar" (solo tiene sentido para fijos)."""
        hora_fin = self.hora_fin.strftime('%H:%M') if self.hora_fin else '--:--'
        return f"{timezone.localtime(self.inicio):%H:%M} a {hora_fin}, {self.dias_texto}"

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
    codigo_recuperacion = models.CharField(max_length=6, blank=True, null=True)
    codigo_expiracion = models.DateTimeField(blank=True, null=True)

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

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(usuario__isnull=False) | Q(empresa__isnull=False),
                name='alerta_con_autor',
            ),
        ]

    def __str__(self):
        return self.descripcion

    @property
    def autor(self):
        """Nombre de quien la creó: el nickname del pasajero o el nombre de la empresa."""
        if self.usuario_id:
            return self.usuario.nickName
        return self.empresa.nombre if self.empresa_id else 'Anónimo'


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
    if created and instance.estado == 'En_proceso':
        transaction.on_commit(lambda: enviar_push_alerta(instance.pk))


def enviar_push_alerta(id_alerta, titulo="🚨 Nueva Alerta"):
    if settings.FIREBASE_APP is None:
        logger.warning('Alerta %s sin notificación push: falta el archivo de credenciales de Firebase', id_alerta)
        return

    try:
        from fcm_django.models import FCMDevice
        from firebase_admin.messaging import Message, Notification

        alerta = Alerta.objects.select_related('ruta').filter(pk=id_alerta).first()
        dispositivos = FCMDevice.objects.filter(active=True, name__in=APPS_CON_NOTIFICACIONES)
        if alerta is None or not dispositivos.exists():
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