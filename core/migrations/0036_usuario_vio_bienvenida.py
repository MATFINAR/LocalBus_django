from django.db import migrations, models


class Migration(migrations.Migration):
    """Las cuentas que ya existen ya iniciaron sesión antes: no se les muestra la bienvenida.
    Por eso se crea con True y luego el valor por defecto pasa a False (cuentas nuevas)."""

    dependencies = [
        ('core', '0035_usuario_desplazamiento_mapa'),
    ]

    operations = [
        migrations.AddField(
            model_name='usuario',
            name='vio_bienvenida',
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name='usuario',
            name='vio_bienvenida',
            field=models.BooleanField(default=False),
        ),
    ]
