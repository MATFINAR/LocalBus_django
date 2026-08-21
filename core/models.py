from django.db import models

class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    origen = models.CharField(max_length=200)
    destino = models.CharField(max_length=200)
    distancia_Km = models.FloatField(10,2)
    duracion_estimada = models.TimeField()
    estado = models.CharField(50)
    fecha_creacion = models.DateTimeField()
    frecuencia = models.TimeField()
    paradas = models.IntegerField(max_length=100)