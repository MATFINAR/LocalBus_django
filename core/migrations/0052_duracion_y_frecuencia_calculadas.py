from django.db import migrations


def calcular_duraciones(apps, schema_editor):
    """Las duraciones que se escribieron a mano se reemplazan por la calculada con la distancia."""
    from core.models import _km_de_linea, minutos_de_recorrido

    Ruta = apps.get_model('core', 'Ruta')
    for ruta in Ruta.objects.all():
        minutos = minutos_de_recorrido(ruta.distancia_km or _km_de_linea(ruta.geometria_ruta))
        Ruta.objects.filter(pk=ruta.pk).update(duracion_estimada_minutos=minutos)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0051_quitar_paradas'),
    ]

    operations = [
        # La frecuencia ya no se guarda: se calcula con los turnos del día
        migrations.RemoveField(model_name='ruta', name='frecuencia_minutos'),
        migrations.RunPython(calcular_duraciones, migrations.RunPython.noop),
    ]
