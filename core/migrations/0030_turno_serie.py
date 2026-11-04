from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0029_turno_fijo_con_hora_fin'),
    ]

    operations = [
        # Los turnos existentes quedan sin serie: se editan uno por uno, como antes
        migrations.AddField(
            model_name='turno',
            name='serie',
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
    ]
