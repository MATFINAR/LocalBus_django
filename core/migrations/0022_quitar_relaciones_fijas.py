import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Paso 3 de 3: quita Bus.ruta y Bus.conductor (ahora los define el turno) y vuelve obligatoria la empresa."""

    dependencies = [
        ('core', '0021_datos_empresas_y_turnos'),
    ]

    operations = [
        migrations.RemoveField(model_name='bus', name='conductor'),
        migrations.RemoveField(model_name='bus', name='ruta'),
        migrations.AlterField(
            model_name='bus',
            name='rutas',
            field=models.ManyToManyField(blank=True, related_name='buses', to='core.ruta'),
        ),
        migrations.AlterField(
            model_name='ruta',
            name='empresa',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='rutas',
                                    to='core.empresa'),
        ),
        migrations.AlterField(
            model_name='bus',
            name='empresa',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='buses',
                                    to='core.empresa'),
        ),
        migrations.AlterField(
            model_name='conductor',
            name='empresa',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='conductores',
                                    to='core.empresa'),
        ),
        migrations.AlterField(
            model_name='ruta',
            name='codigo',
            field=models.CharField(max_length=20),
        ),
        migrations.AddConstraint(
            model_name='ruta',
            constraint=models.UniqueConstraint(fields=('empresa', 'codigo'), name='ruta_codigo_unico_por_empresa'),
        ),
    ]
