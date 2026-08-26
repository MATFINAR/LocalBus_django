from django.db import models

class Ruta(models.Model):
    id_ruta = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    origen = models.CharField(max_length=200)
    destino = models.CharField(max_length=200)
    distancia_Km = models.FloatField()
    duracion_estimada = models.TimeField()
    estado = models.CharField(max_length=50)
    fecha_creacion = models.DateTimeField()
    frecuencia = models.TimeField()
    paradas = models.IntegerField()

    def __str__(self):
        return self.nombre
    
class Conductor(models.Model):
    id_conductor = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15)
    email = models.EmailField(max_length=100)
    cedula = models.CharField(max_length=50)
    contrasena =models.CharField(max_length=40) 

    id_ruta = models.ForeignKey( 'Ruta',on_delete=models.CASCADE, related_name='conductores')

    def __str__(self):
        return self.nombre

class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)
    id_ruta = models.IntegerField()
