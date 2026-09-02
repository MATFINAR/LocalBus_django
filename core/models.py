from django.db import models
from django.contrib.gis.db import models as gis_models
from django.contrib.gis.geos import Point

class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    codigo = models.CharField(max_length=20, unique=True)
    descripcion = models.TextField(blank=True)
    
    # Datos de origen y destino
    origen = models.CharField(max_length=200)
    destino = models.CharField(max_length=200)
    
    # Geometría de la ruta (el camino que sigue el bus)
    geometria_ruta = gis_models.LineStringField(srid=4326, null=True, blank=True)
    punto_origen = gis_models.PointField(srid=4326, null=True, blank=True)
    punto_destino = gis_models.PointField(srid=4326, null=True, blank=True)
    
    # Paradas de la ruta
    paradas = gis_models.MultiPointField(srid=4326, null=True, blank=True)
    num_paradas = models.IntegerField(default=0)
    
    # Métricas de la ruta
    distancia_km = models.FloatField(default=0)
    duracion_estimada_minutos = models.IntegerField(default=0)
    
    # Estado y control
    estado = models.CharField(max_length=20, choices=[
        ('activa', 'Activa'),
        ('inactiva', 'Inactiva'),
        ('fuera_servicio', 'Fuera de Servicio')
    ], default='activa')
    
    # Metadatos
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    
    # Campos para compatibilidad con tu código existente
    latitud = models.FloatField(default=0)
    longitud = models.FloatField(default=0)
    paradas = models.IntegerField(default=0)  # Mantenido por compatibilidad
    duracion_estimada = models.TimeField(default='00:00:00')
    frecuencia = models.TimeField(default='00:00:00')

    class Meta:
        verbose_name = 'Ruta de Autobús'
        verbose_name_plural = 'Rutas de Autobuses'
        ordering = ['codigo']
        indexes = [
            gis_models.GistIndex(fields=['geometria_ruta']),
            gis_models.GistIndex(fields=['paradas']),
        ]

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"

    def save(self, *args, **kwargs):
        if self.paradas:
            self.num_paradas = len(self.paradas)
        
        if self.geometria_ruta:
            # Extraer punto origen y destino
            if self.geometria_ruta.coords:
                if not self.punto_origen:
                    self.punto_origen = Point(self.geometria_ruta.coords[0])
                if not self.punto_destino:
                    self.punto_destino = Point(self.geometria_ruta.coords[-1])
        
        super().save(*args, **kwargs)

    def get_coordenadas_ruta(self):
        """Devuelve lista de coordenadas para el mapa"""
        if self.geometria_ruta:
            return list(self.geometria_ruta.coords)
        return []

    def get_paradas_coordenadas(self):
        """Devuelve las coordenadas de todas las paradas"""
        if self.paradas:
            return [{'lat': p.y, 'lng': p.x} for p in self.paradas]
        return []


class UbicacionBus(models.Model):
    """Ubicación en tiempo real de los buses (solo lo necesario)"""
    bus = models.ForeignKey('Bus', on_delete=models.CASCADE, related_name='ubicaciones')
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name='ubicaciones_bus')
    
    # Solo coordenadas y tiempo
    latitud = models.FloatField()
    longitud = models.FloatField()
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


# Mantén tus modelos existentes sin cambios
class Conductor(models.Model):
    id_conductor = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15, unique=True)
    email = models.EmailField(max_length=100, unique=True)
    cedula = models.CharField(max_length=50, unique=True)
    contrasena = models.CharField(max_length=40) 
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name='conductores')

    def __str__(self):
        return f"{self.nombre} - {self.cedula}"


class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name='buses')

    def __str__(self):
        return self.placa


class Usuario(models.Model):
    id_usuario = models.AutoField(primary_key=True)
    email = models.CharField(max_length=100, unique=True)
    contrasena = models.CharField(max_length=100)
    nombre = models.CharField(max_length=100)
    nickName = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15, unique=True)

    def __str__(self):
        return self.nickName


class Alerta(models.Model):
    id_alerta = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name='alertas')
    ruta = models.ForeignKey(Ruta, on_delete=models.CASCADE, related_name="alertas")
    tipo = models.CharField(max_length=200)
    descripcion = models.CharField(max_length=200)
    estado = models.CharField(max_length=50)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.descripcion