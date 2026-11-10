"""Horas en formato de 12 horas, como se leen en Colombia: "7:05 a. m.", "12:30 p. m.".

Todo lo que se muestra al usuario (páginas, mensajes, reportes) usa estas funciones. Los valores que van a un
<input type="time"> o se guardan siguen en 24 horas: así los entiende el navegador y la base de datos.
"""
from datetime import datetime, time

from django.utils import timezone


def hora12(valor):
    """Hora de un datetime (en hora local) o de un time, en 12 horas. '' si no hay valor."""
    if valor is None or valor == '':
        return ''
    if isinstance(valor, datetime):
        if timezone.is_aware(valor):
            valor = timezone.localtime(valor)
        valor = valor.time()
    if not isinstance(valor, time):
        return str(valor)
    hora = valor.hour % 12 or 12
    return f"{hora}:{valor.minute:02d} {'a. m.' if valor.hour < 12 else 'p. m.'}"


def fecha_hora12(valor, formato_fecha='%d/%m'):
    """Fecha y hora: "09/11 7:43 p. m." (con formato_fecha='%d/%m/%Y': "09/11/2026 7:43 p. m.")."""
    if valor is None or valor == '':
        return ''
    if timezone.is_aware(valor):
        valor = timezone.localtime(valor)
    return f'{valor.strftime(formato_fecha)} {hora12(valor)}'
