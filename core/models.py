from django.conf import settings
from django.db import models
from django.db.models import Q
from django.contrib.gis.db import models as gis_models
from django.contrib.gis.geos import Point
from django.core.validators import RegexValidator
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


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

    estado = models.CharField(max_length=20, choices=[
        ('Activa', 'Activa'),
        ('Inactiva', 'Inactiva'),
        ('Fuera_servicio', 'Fuera de Servicio')
    ], default='Activa')

    fecha_creacion = models.DateTimeField(auto_now_add=True)
    frecuencia_minutos = models.IntegerField(default=0)

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
    bus = models.ForeignKey('Bus', on_delete=models.CASCADE, related_name='ubicaciones')
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name='ubicaciones_bus')
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


class Conductor(models.Model):
    id_conductor = models.AutoField(primary_key=True)
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='conductores')
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15) # <--- Si quieres que sea único, agrega unique=True aquí, pero primero borra el duplicado en la BD
    email = models.EmailField(max_length=100, unique=True)
    cedula = models.CharField(max_length=50, unique=True)
    contrasena = models.CharField(max_length=128)

    def __str__(self):
        return f"{self.nombre} - {self.cedula}"

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

    activo = models.BooleanField(default=False)
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
        return self.rutas.order_by('codigo').first()

    @property
    def conductor_actual(self):
        turno = self.turno_actual()
        return turno.conductor if turno else None


class Turno(models.Model):
    """Asigna un conductor a un bus y una ruta durante un periodo.

    - Asignación fija: `fin` vacío (vigente hasta que se finalice).
    - Rotación: un turno por jornada; puede cruzar la medianoche (22:00 a 06:00).
    Un conductor no puede tener dos turnos que se crucen, y un bus tampoco.
    Los turnos no se borran una vez empezados: son el historial de quién manejó qué bus.
    """
    id_turno = models.AutoField(primary_key=True)
    conductor = models.ForeignKey(Conductor, on_delete=models.PROTECT, related_name='turnos')
    bus = models.ForeignKey(Bus, on_delete=models.PROTECT, related_name='turnos')
    ruta = models.ForeignKey(Ruta, on_delete=models.PROTECT, related_name='turnos')
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['inicio']
        indexes = [
            models.Index(fields=['conductor', 'inicio'], name='core_turno_conduct_idx'),
            models.Index(fields=['bus', 'inicio'], name='core_turno_bus_idx'),
        ]

    def __str__(self):
        fin = timezone.localtime(self.fin).strftime('%d/%m %H:%M') if self.fin else 'indefinido'
        return f"{self.conductor.nombre} · {self.bus.placa} · {self.ruta.codigo} ({timezone.localtime(self.inicio):%d/%m %H:%M} - {fin})"

    @classmethod
    def vigentes(cls, momento=None):
        momento = momento or timezone.now()
        return cls.objects.filter(inicio__lte=momento).filter(Q(fin__isnull=True) | Q(fin__gt=momento))

    @classmethod
    def que_se_cruzan(cls, inicio, fin):
        """Turnos que se solapan con el periodo [inicio, fin). fin=None es indefinido."""
        qs = cls.objects.filter(Q(fin__isnull=True) | Q(fin__gt=inicio))
        if fin is not None:
            qs = qs.filter(inicio__lt=fin)
        return qs

    @property
    def estado(self):
        ahora = timezone.now()
        if self.inicio > ahora:
            return 'Programado'
        if self.fin is None or self.fin > ahora:
            return 'En curso'
        return 'Finalizado'

    def validar(self):
        """Devuelve un mensaje de error si el turno no es válido, o None."""
        if self.fin is not None and self.fin <= self.inicio:
            return 'La hora de fin debe ser posterior a la de inicio.'
        if not (self.conductor.empresa_id == self.bus.empresa_id == self.ruta.empresa_id):
            return 'El conductor, el bus y la ruta deben ser de la misma empresa.'
        if not self.bus.rutas.filter(pk=self.ruta_id).exists():
            return f'El bus {self.bus.placa} no tiene habilitada la ruta {self.ruta.codigo}.'
        if self.ruta.estado == 'Fuera_servicio':
            return f'La ruta {self.ruta.codigo} está fuera de servicio.'

        cruces = Turno.que_se_cruzan(self.inicio, self.fin).exclude(pk=self.pk)
        choque = cruces.filter(conductor_id=self.conductor_id).select_related('bus').first()
        if choque:
            return f'{self.conductor.nombre} ya tiene un turno que se cruza: {choque}.'
        choque = cruces.filter(bus_id=self.bus_id).select_related('conductor').first()
        if choque:
            return f'El bus {self.bus.placa} ya tiene un turno que se cruza: {choque}.'
        return None


class Usuario(models.Model):
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

    def __str__(self):
        return self.nickName

    def save(self, *args, **kwargs):
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
    id_alerta = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name='alertas')
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name="alertas")
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

    def __str__(self):
        return self.descripcion


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

@receiver(post_save, sender=Alerta)
def notificar_alerta_nueva(sender, instance, created, **kwargs):
    """
    Cuando se crea una alerta nueva, envía una notificación push
    a todos los dispositivos registrados en FCMDevice.
    """
    if not created:
        return

    try:
        from fcm_django.models import FCMDevice
        from firebase_admin.messaging import Message, Notification

        # Obtenemos todos los dispositivos registrados (tanto app mapa como conductor)
        dispositivos = FCMDevice.objects.filter(active=True)

        if not dispositivos.exists():
            return

        mensaje = Message(
            notification=Notification(
                title="🚨 Nueva Alerta",
                body=f"{instance.ruta.nombre}: {instance.descripcion}"
            ),
            data={
                "alerta_id": str(instance.id_alerta),
                "tipo": instance.tipo,
                "ruta": instance.ruta.nombre,
            }
        )

        # Enviamos a todos los dispositivos en un solo lote
        dispositivos.send_message(mensaje)

    except Exception as e:
        print(f"⚠️ No se pudo enviar la notificación push: {e}")