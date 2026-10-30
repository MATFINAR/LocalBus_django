from django.db import models
from django.contrib.gis.db import models as gis_models
from django.contrib.gis.geos import Point
from django.core.validators import RegexValidator
from django.db.models.signals import post_save
from django.dispatch import receiver


class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    codigo = models.CharField(max_length=20, unique=True)

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
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15) # <--- Si quieres que sea único, agrega unique=True aquí, pero primero borra el duplicado en la BD
    email = models.EmailField(max_length=100, unique=True)
    cedula = models.CharField(max_length=50, unique=True)
    contrasena = models.CharField(max_length=128)
    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='conductores'
    )

    def __str__(self):
        return f"{self.nombre} - {self.cedula}"


class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name='buses')

    activo = models.BooleanField(default=False)
    ultima_ubicacion = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.placa


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