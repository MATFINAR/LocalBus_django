"""Envío de correos por la API HTTPS de Brevo (https://www.brevo.com), para servidores sin salida SMTP.

Railway bloquea las conexiones SMTP salientes (puertos 25, 465 y 587) en sus planes Free, Trial y Hobby: con el
backend SMTP de Django la conexión a smtp.gmail.com se queda esperando hasta que gunicorn mata la petición, y el
registro y la recuperación de la contraseña nunca responden. Brevo recibe el correo por HTTPS (puerto 443), que
sí está abierto.

Se activa poniendo BREVO_API_KEY en las variables de entorno (ver settings.py). El remitente
(DEFAULT_FROM_EMAIL) debe estar verificado en Brevo > Senders.
"""
import json
import logging
import urllib.error
import urllib.request
from email.utils import parseaddr

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

URL_BREVO = 'https://api.brevo.com/v3/smtp/email'


def _direccion(texto):
    nombre, email = parseaddr(texto)
    return {'email': email, 'name': nombre} if nombre else {'email': email}


class BrevoBackend(BaseEmailBackend):
    """EmailBackend de Django que envía cada mensaje con una petición HTTPS a Brevo."""

    def send_messages(self, email_messages):
        enviados = 0
        for mensaje in email_messages or []:
            try:
                self._enviar(mensaje)
                enviados += 1
            except Exception:
                if not self.fail_silently:
                    raise
                logger.exception('Brevo no pudo enviar el correo "%s"', mensaje.subject)
        return enviados

    def _enviar(self, mensaje):
        datos = {
            'sender': _direccion(mensaje.from_email or settings.DEFAULT_FROM_EMAIL),
            'to': [_direccion(d) for d in mensaje.to],
            'subject': mensaje.subject,
            'textContent': mensaje.body or ' ',
        }
        if mensaje.cc:
            datos['cc'] = [_direccion(d) for d in mensaje.cc]
        if mensaje.bcc:
            datos['bcc'] = [_direccion(d) for d in mensaje.bcc]
        if mensaje.reply_to:
            datos['replyTo'] = _direccion(mensaje.reply_to[0])
        for contenido, tipo in getattr(mensaje, 'alternatives', None) or []:
            if tipo == 'text/html':
                datos['htmlContent'] = contenido

        peticion = urllib.request.Request(
            URL_BREVO, data=json.dumps(datos).encode('utf-8'), method='POST',
            headers={'api-key': settings.BREVO_API_KEY, 'accept': 'application/json',
                     'content-type': 'application/json'})
        try:
            with urllib.request.urlopen(peticion, timeout=settings.EMAIL_TIMEOUT) as respuesta:
                respuesta.read()
        except urllib.error.HTTPError as e:
            detalle = e.read().decode('utf-8', 'replace')[:500]
            raise RuntimeError(f'Brevo rechazó el correo (HTTP {e.code}): {detalle}') from e
