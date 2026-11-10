"""Filtros para mostrar horas en formato de 12 horas. Uso: {% load horas %} y luego
{{ valor|hora12 }} -> "7:43 p. m."   ·   {{ valor|fecha_hora12 }} -> "09/11 7:43 p. m."
{{ valor|fecha_hora12:"%d/%m/%Y" }} -> "09/11/2026 7:43 p. m."
"""
from django import template

from core.utils import horas

register = template.Library()


@register.filter
def hora12(valor):
    return horas.hora12(valor)


@register.filter
def fecha_hora12(valor, formato_fecha='%d/%m'):
    return horas.fecha_hora12(valor, formato_fecha)
