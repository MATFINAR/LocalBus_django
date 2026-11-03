from django.contrib.auth.hashers import identify_hasher, make_password
from django.db import migrations


def cifrar(apps, schema_editor):
    """Cifra las contraseñas de pasajeros que estaban guardadas en texto plano.
    Las que ya están cifradas se dejan igual, así la migración se puede repetir sin daño."""
    Usuario = apps.get_model('core', 'Usuario')
    for usuario in Usuario.objects.exclude(contrasena=''):
        try:
            identify_hasher(usuario.contrasena)
        except ValueError:
            usuario.contrasena = make_password(usuario.contrasena)
            usuario.save(update_fields=['contrasena'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_cifrar_contrasenas_conductores'),
    ]

    operations = [
        # Irreversible: una contraseña cifrada no se puede volver a texto plano
        migrations.RunPython(cifrar, migrations.RunPython.noop),
    ]
