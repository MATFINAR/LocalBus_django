"""Envío de correos por HTTPS, para servidores sin salida SMTP.

Railway bloquea las conexiones SMTP salientes (puertos 25, 465 y 587) en sus planes Free, Trial y Hobby: con el
backend SMTP de Django la conexión a smtp.gmail.com se queda esperando hasta que gunicorn mata la petición, y el
registro y la recuperación de la contraseña nunca responden. El puerto 443 (HTTPS) sí está abierto, así que el
correo se entrega a un servicio web. Hay dos opciones, que se activan con variables de entorno (ver settings.py):

- Google Apps Script (EMAIL_SCRIPT_URL y EMAIL_SCRIPT_TOKEN): envía desde la propia cuenta de Gmail, sin dominio
  propio. Instalación en despliegue/correo_apps_script.gs. Una cuenta gratuita admite 100 destinatarios al día.
- Brevo (BREVO_API_KEY): el remitente (DEFAULT_FROM_EMAIL) debe estar verificado en Brevo > Senders.
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
                logger.exception('No se pudo enviar el correo "%s"', mensaje.subject)
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


class AppsScriptBackend(BrevoBackend):
    """EmailBackend que entrega cada mensaje a la aplicación web de Apps Script, que lo envía con Gmail."""

    def _enviar(self, mensaje):
        datos = {
            'token': settings.EMAIL_SCRIPT_TOKEN,
            'to': ','.join(mensaje.to),
            'cc': ','.join(mensaje.cc),
            'bcc': ','.join(mensaje.bcc),
            'replyTo': ','.join(mensaje.reply_to),
            'name': parseaddr(mensaje.from_email or settings.DEFAULT_FROM_EMAIL)[0] or 'LocalBus',
            'subject': mensaje.subject,
            'body': mensaje.body or ' ',
        }
        for contenido, tipo in getattr(mensaje, 'alternatives', None) or []:
            if tipo == 'text/html':
                datos['htmlBody'] = contenido

        peticion = urllib.request.Request(
            settings.EMAIL_SCRIPT_URL, data=json.dumps(datos).encode('utf-8'), method='POST',
            headers={'content-type': 'application/json'})
        # Apps Script responde con una redirección que urllib sigue sola. Tarda más que una API de correo,
        # pero el límite debe quedar por debajo de los 30 s de gunicorn.
        with urllib.request.urlopen(peticion, timeout=max(settings.EMAIL_TIMEOUT, 20)) as respuesta:
            texto = respuesta.read().decode('utf-8', 'replace')
        try:
            resultado = json.loads(texto)
        except ValueError:
            # Una página HTML significa URL equivocada o implementación sin acceso para "Cualquier usuario"
            raise RuntimeError('Apps Script no devolvió JSON: revisa EMAIL_SCRIPT_URL y el acceso '
                               'de la implementación.') from None
        if not resultado.get('ok'):
            raise RuntimeError(f'Apps Script rechazó el correo: {resultado.get("error")}')
