from collections import Counter

import django.db.models.functions.text
from django.db import migrations, models


def _repetidos(valores):
    return sorted(v for v, n in Counter(v.lower() for v in valores if v).items() if n > 1)


def normalizar(apps, schema_editor):
    """Pasa los correos a minúsculas antes de crear las restricciones.
    Si hay correos o nicknames que solo difieren en mayúsculas se detiene y los lista,
    para que el administrador decida cuál conservar (no se borra nada automáticamente)."""
    Usuario = apps.get_model('core', 'Usuario')
    Conductor = apps.get_model('core', 'Conductor')

    problemas = []
    for modelo, campo in ((Usuario, 'email'), (Usuario, 'nickName'), (Conductor, 'email')):
        repetidos = _repetidos(modelo.objects.values_list(campo, flat=True))
        if repetidos:
            problemas.append(f'{modelo.__name__}.{campo}: {", ".join(repetidos)}')
    if problemas:
        raise RuntimeError('Hay registros que solo difieren en mayúsculas; corrígelos y vuelve a migrar:\n  '
                           + '\n  '.join(problemas))

    for modelo in (Usuario, Conductor):
        for obj in modelo.objects.all():
            limpio = (obj.email or '').strip().lower()
            if obj.email != limpio:
                modelo.objects.filter(pk=obj.pk).update(email=limpio)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0027_inhabilitar_en_vez_de_borrar'),
    ]

    operations = [
        migrations.RunPython(normalizar, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='conductor',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('email'), name='conductor_email_unico_sin_mayusculas'),
        ),
        migrations.AddConstraint(
            model_name='usuario',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('email'), name='usuario_email_unico_sin_mayusculas'),
        ),
        migrations.AddConstraint(
            model_name='usuario',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('nickName'), name='usuario_nickname_unico_sin_mayusculas'),
        ),
    ]
