from django.db import models

class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    origen = models.CharField(max_length=200)
    destino = models.CharField(max_length=200)
    distancia_Km = models.FloatField(default=0)
    duracion_estimada = models.TimeField(default='00:00:00')
    estado = models.CharField(max_length=50)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    frecuencia = models.TimeField(default='00:00:00')
    paradas = models.IntegerField(default=0)

    def str(self):
        return self.nombre
    
class Conductor(models.Model):
    id_conductor = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15)
    email = models.EmailField(max_length=100)
    cedula = models.CharField(max_length=50)
    contrasena = models.CharField(max_length=40) 

    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.CASCADE,
        related_name='conductores'
    )

    def str(self):
        return f"{self.nombre} - {self.cedula}"


class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)

    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.CASCADE,
        related_name='buses'
    )

    def str(self):
        return self.placa
