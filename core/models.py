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

    def __str__(self):
        return self.nombre

class Conductor(models.Model):
    id_conductor = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15, unique=True)
    email = models.EmailField(max_length=100, unique=True)
    cedula = models.CharField(max_length=50, unique=True)
    contrasena = models.CharField(max_length=40) 

    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.CASCADE,
        related_name='conductores'
    )

    def __str__(self):
        return f"{self.nombre} - {self.cedula}"

class Bus(models.Model):
    id_bus = models.AutoField(primary_key=True)
    placa = models.CharField(max_length=20, unique=True)
    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.CASCADE,
        related_name='buses'
    )

    def __str__(self):
        return self.placa

class Usuario(models.Model):
    id_usuario = models.AutoField(primary_key=True)
    email = models.CharField(max_length=100, unique=True)
    contrasena = models.CharField(max_length=100)
    nombre = models.CharField(max_length=100)
    nickName = models.CharField(max_length=100)
    telefono = models.CharField(max_length=15)

    def __str__(self):
        return self.nickName

class Alerta(models.Model):
    id_alerta = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        Usuario, 
        on_delete=models.CASCADE, 
        related_name='alertas'
    )
    ruta = models.ForeignKey(
        Ruta,
        on_delete=models.CASCADE, 
        related_name="alertas"
    )
    tipo = models.CharField(max_length=200)
    descripcion = models.CharField(max_length=200)
    estado = models.CharField(max_length=50)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.descripcion