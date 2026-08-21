from django.db import models
from django.db import models

class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)
    id_ruta = models.IntegerField()