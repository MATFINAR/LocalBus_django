from django.db import migrations

# El formulario de alertas guardaba estados en minúscula que no son opciones del modelo
ESTADOS_VIEJOS = {
    'activa': 'Pendiente',
    'pendiente': 'Pendiente',
    'en_proceso': 'En_proceso',
    'resuelta': 'Resuelta',
    'cancelada': 'Cancelada',
}


def corregir_estados(apps, schema_editor):
    Alerta = apps.get_model('core', 'Alerta')
    for viejo, nuevo in ESTADOS_VIEJOS.items():
        Alerta.objects.filter(estado=viejo).update(estado=nuevo)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_cifrar_contrasenas_usuarios'),
    ]

    operations = [
        migrations.RunPython(corregir_estados, migrations.RunPython.noop),
    ]
