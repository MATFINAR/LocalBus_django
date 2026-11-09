from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0033_ruta_fuera_de_servicio_con_motivo'),
    ]

    operations = [
        migrations.AddField(
            model_name='ruta',
            name='alerta_inhabilitada',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='+', to='core.alerta'),
        ),
    ]
