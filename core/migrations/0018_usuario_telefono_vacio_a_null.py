from django.db import migrations


def vacio_a_null(apps, schema_editor):
    """Los usuarios registrados sin teléfono quedaron con '' y bloquean el
    registro de otros usuarios sin teléfono (el campo es único)."""
    Usuario = apps.get_model('core', 'Usuario')
    Usuario.objects.filter(telefono='').update(telefono=None)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_dispositivo'),
    ]

    operations = [
        migrations.RunPython(vacio_a_null, migrations.RunPython.noop),
    ]
