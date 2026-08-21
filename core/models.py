from django.db import models

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