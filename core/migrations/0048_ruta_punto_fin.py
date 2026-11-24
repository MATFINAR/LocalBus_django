import django.contrib.gis.db.models.fields
from django.db import migrations, models
from django.db.models import F


def fin_igual_al_origen(apps, schema_editor):
    """Las rutas que ya existían terminan donde empiezan."""
    Ruta = apps.get_model('core', 'Ruta')
    Ruta.objects.update(fin=F('origen'), punto_fin=F('punto_origen'))


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_alertas_publicacion_vencimiento_suscripciones'),
    ]

    operations = [
        migrations.AddField(
            model_name='ruta',
            name='fin_es_origen',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='ruta',
            name='fin',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='ruta',
            name='punto_fin',
            field=django.contrib.gis.db.models.fields.PointField(blank=True, null=True, srid=4326),
        ),
        migrations.RunPython(fin_igual_al_origen, migrations.RunPython.noop),
    ]
