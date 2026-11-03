from django.contrib.auth.hashers import identify_hasher, make_password
from django.db import migrations


def cifrar(apps, schema_editor):
    """Cifra las contraseñas de conductores que estaban guardadas en texto plano.
    Las que ya están cifradas se dejan igual, así la migración se puede repetir sin daño."""
    Conductor = apps.get_model('core', 'Conductor')
    for conductor in Conductor.objects.exclude(contrasena=''):
        try:
            identify_hasher(conductor.contrasena)
        except ValueError:
            conductor.contrasena = make_password(conductor.contrasena)
            conductor.save(update_fields=['contrasena'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0023_delete_dispositivo'),
    ]

    operations = [
        # Irreversible: una contraseña cifrada no se puede volver a texto plano
        migrations.RunPython(cifrar, migrations.RunPython.noop),
    ]
