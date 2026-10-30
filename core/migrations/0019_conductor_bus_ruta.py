import django.db.models.deletion
from django.db import migrations, models


def ruta_a_bus(apps, schema_editor):
    """Conserva la asignación que antes se deducía por la ruta: si una ruta
    tenía un único conductor, ese conductor queda asignado a un bus libre
    de esa ruta. Los demás conductores quedan sin bus y se asignan a mano."""
    Conductor = apps.get_model('core', 'Conductor')
    Bus = apps.get_model('core', 'Bus')
    for conductor in Conductor.objects.exclude(ruta=None):
        if Conductor.objects.filter(ruta_id=conductor.ruta_id).count() != 1:
            continue
        bus = Bus.objects.filter(ruta_id=conductor.ruta_id, conductor=None).order_by('id_bus').first()
        if bus:
            bus.conductor = conductor
            bus.save(update_fields=['conductor'])


def bus_a_ruta(apps, schema_editor):
    Bus = apps.get_model('core', 'Bus')
    for bus in Bus.objects.exclude(conductor=None):
        bus.conductor.ruta_id = bus.ruta_id
        bus.conductor.save(update_fields=['ruta'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0018_usuario_telefono_vacio_a_null'),
    ]

    operations = [
        migrations.AddField(
            model_name='bus',
            name='conductor',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                       related_name='bus', to='core.conductor'),
        ),
        migrations.RunPython(ruta_a_bus, bus_a_ruta),
        migrations.RemoveField(
            model_name='conductor',
            name='ruta',
        ),
    ]
