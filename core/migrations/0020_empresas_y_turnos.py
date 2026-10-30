import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Paso 1 de 3: crea Empresa, Administrador y Turno, y agrega los campos nuevos (aún opcionales)."""

    dependencies = [
        ('core', '0019_conductor_bus_ruta'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Empresa',
            fields=[
                ('id_empresa', models.AutoField(primary_key=True, serialize=False)),
                ('nombre', models.CharField(max_length=150)),
                ('nit', models.CharField(max_length=20, unique=True)),
                ('activa', models.BooleanField(default=True)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['nombre']},
        ),
        migrations.CreateModel(
            name='Administrador',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                              related_name='administrador', to=settings.AUTH_USER_MODEL)),
                ('empresa', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                              related_name='administradores', to='core.empresa')),
            ],
            options={'verbose_name_plural': 'Administradores'},
        ),
        migrations.AddField(
            model_name='ruta',
            name='empresa',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='rutas', to='core.empresa'),
        ),
        migrations.AddField(
            model_name='bus',
            name='empresa',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='buses', to='core.empresa'),
        ),
        migrations.AddField(
            model_name='conductor',
            name='empresa',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='conductores', to='core.empresa'),
        ),
        migrations.AddField(
            model_name='bus',
            name='rutas',
            field=models.ManyToManyField(blank=True, related_name='+', to='core.ruta'),
        ),
        migrations.AddField(
            model_name='ubicacionbus',
            name='conductor',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='ubicaciones', to='core.conductor'),
        ),
        migrations.CreateModel(
            name='Turno',
            fields=[
                ('id_turno', models.AutoField(primary_key=True, serialize=False)),
                ('inicio', models.DateTimeField()),
                ('fin', models.DateTimeField(blank=True, null=True)),
                ('bus', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                          related_name='turnos', to='core.bus')),
                ('conductor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                                related_name='turnos', to='core.conductor')),
                ('ruta', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                           related_name='turnos', to='core.ruta')),
            ],
            options={
                'ordering': ['inicio'],
                'indexes': [
                    models.Index(fields=['conductor', 'inicio'], name='core_turno_conduct_idx'),
                    models.Index(fields=['bus', 'inicio'], name='core_turno_bus_idx'),
                ],
            },
        ),
    ]
