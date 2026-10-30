from django.db import migrations
from django.utils import timezone


def migrar_datos(apps, schema_editor):
    """Paso 2 de 3: pasa los datos existentes al nuevo modelo.

    - Todo lo que ya existe queda en una "Empresa principal" (renómbrala desde /admin/).
    - La ruta de cada bus pasa a ser una de sus rutas habilitadas.
    - Cada conductor que tenía bus queda con un turno fijo (sin fin) desde ahora.
    """
    Empresa = apps.get_model('core', 'Empresa')
    Ruta = apps.get_model('core', 'Ruta')
    Bus = apps.get_model('core', 'Bus')
    Conductor = apps.get_model('core', 'Conductor')
    Turno = apps.get_model('core', 'Turno')

    if not (Ruta.objects.exists() or Bus.objects.exists() or Conductor.objects.exists()):
        return

    empresa, _ = Empresa.objects.get_or_create(nit='000000000', defaults={'nombre': 'Empresa principal'})
    Ruta.objects.filter(empresa=None).update(empresa=empresa)
    Bus.objects.filter(empresa=None).update(empresa=empresa)
    Conductor.objects.filter(empresa=None).update(empresa=empresa)

    ahora = timezone.now()
    for bus in Bus.objects.all():
        bus.rutas.add(bus.ruta_id)
        if bus.conductor_id:
            Turno.objects.create(conductor_id=bus.conductor_id, bus=bus, ruta_id=bus.ruta_id, inicio=ahora)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_empresas_y_turnos'),
    ]

    operations = [
        migrations.RunPython(migrar_datos, migrations.RunPython.noop),
    ]
