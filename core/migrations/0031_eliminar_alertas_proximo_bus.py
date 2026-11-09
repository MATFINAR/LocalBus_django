from django.db import migrations


def eliminar_alertas_proximo_bus(apps, schema_editor):
    """El tipo "Próximo bus" ya no existe: se borran las alertas que quedaban de ese tipo."""
    Alerta = apps.get_model('core', 'Alerta')
    Alerta.objects.filter(tipo='bus-arriving').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0030_turno_serie'),
    ]

    operations = [
        # No se puede deshacer: las alertas borradas no se recuperan
        migrations.RunPython(eliminar_alertas_proximo_bus, migrations.RunPython.noop),
    ]
