"""Carga dos empresas de ejemplo con datos en todas las tablas.

Las rutas van por las calles reales entre Caldas y Bello (se trazan con OSRM, como en el editor): ida, vuelta y,
si el fin no es el inicio, el traslado sin pasajeros. Todo se crea en una sola transacción.

    python manage.py cargar_demo
    python manage.py cargar_demo --contrasena OtraClave123
"""
import json
import math
import random
import time
import urllib.request
import uuid
from datetime import datetime, timedelta, time as hora

from django.contrib.auth.models import User
from django.contrib.gis.geos import LineString, Point
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models.signals import post_save
from django.utils import timezone

from core.mensajes import destinatarios
from core.models import (Administrador, Alerta, Bus, Conductor, ConfiguracionBus, Difusion, Empresa, Mensaje,
                         Respaldo, Ruta, SuscripcionRutas, Turno, UbicacionBus, Usuario, notificar_alerta_nueva)
from core.views import TEXTO_CONFIRMACION, _rutas_en_rango

OSRM = 'https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson'

# (lat, lng, nombre) de lugares repartidos por el Valle de Aburrá, de sur a norte
LUGARES = {
    'caldas_parque': (6.0917, -75.6357, 'Parque principal de Caldas'),
    'caldas_valeria': (6.0790, -75.6330, 'Carrera 48, Caldas'),
    'estrella_parque': (6.1580, -75.6430, 'Parque principal de La Estrella'),
    'sabaneta_regional': (6.1525, -75.6265, 'Avenida Regional, Sabaneta'),
    'sabaneta_parque': (6.1515, -75.6166, 'Parque principal de Sabaneta'),
    'sabaneta_lomitas': (6.1600, -75.6040, 'Las Lomitas, Sabaneta'),
    'itagui_parque': (6.1719, -75.6114, 'Parque principal de Itagüí'),
    'itagui_ditaires': (6.1770, -75.6190, 'Ditaires, Itagüí'),
    'envigado_parque': (6.1710, -75.5866, 'Parque principal de Envigado'),
    'envigado_oriente': (6.1640, -75.5730, 'Calle 36D, Envigado'),
    'prado_parque': (6.1840, -75.6540, 'Parque de San Antonio de Prado'),
    'poblado_parque': (6.2096, -75.5677, 'Parque de El Poblado'),
    'aguacatala': (6.1935, -75.5780, 'Santa María de los Ángeles, El Poblado'),
    'olaya': (6.2200, -75.5900, 'Sector Aeropuerto Olaya Herrera'),
    'guayabal': (6.2120, -75.5850, 'Campo Amor, Guayabal'),
    'belen': (6.2311, -75.6040, 'Los Alpes, Belén'),
    'estadio': (6.2566, -75.5905, 'Estadio Atanasio Girardot'),
    'calasanz': (6.2560, -75.6080, 'Santa Lucía, La América'),
    'san_javier': (6.2563, -75.6136, 'San Javier'),
    'berrio': (6.2502, -75.5685, 'Parque Berrío, Centro de Medellín'),
    'udea': (6.2675, -75.5685, 'Universidad de Antioquia'),
    'terminal_norte': (6.2785, -75.5705, 'Terminal del Norte'),
    'robledo': (6.2780, -75.5900, 'Villa Flora, Robledo'),
    'castilla': (6.2930, -75.5700, 'Tricentenario, Castilla'),
    'aranjuez': (6.2800, -75.5560, 'La Piñuela, Aranjuez'),
    'manrique': (6.2690, -75.5500, 'El Pomar, Manrique'),
    'buenos_aires': (6.2400, -75.5500, 'Miraflores, Buenos Aires'),
    'santo_domingo': (6.2930, -75.5420, 'Santo Domingo Savio'),
    'bello_parque': (6.3373, -75.5580, 'Parque principal de Bello'),
    'bello_niquia': (6.3378, -75.5450, 'Glorieta de Niquía, Bello'),
    'bello_gran_avenida': (6.3235, -75.5640, 'La Gran Avenida, Bello'),
    'bello_gabriela': (6.3290, -75.5530, 'La Gabriela, Bello'),
}

MOTIVO_FUERA = 'Obras de la vía en el corredor: suspendida hasta que terminen los trabajos.'

EMPRESAS = [
    {
        'nombre': 'Expreso Sur del Aburrá S.A.S.', 'nit': '901458123-4', 'prefijo_usuario': 'sur',
        'dominio': 'expresosur.example', 'placa': 'ESA',
        # (código, nombre, inicio, retorno, fin si no es el inicio, frecuencia en minutos)
        'rutas': [
            ('ES-01', 'Caldas - Centro', 'caldas_parque', 'berrio', None, 12),
            ('ES-02', 'La Estrella - El Poblado', 'estrella_parque', 'poblado_parque', None, 15),
            ('ES-03', 'Sabaneta - Universidad de Antioquia', 'sabaneta_parque', 'udea', None, 10),
            ('ES-04', 'Itagüí - Estadio', 'itagui_parque', 'estadio', None, 12),
            ('ES-05', 'Envigado - Buenos Aires', 'envigado_parque', 'buenos_aires', None, 15),
            ('ES-06', 'San Antonio de Prado - Itagüí', 'prado_parque', 'itagui_parque', None, 8),
            ('ES-07', 'Bello - Centro', 'bello_parque', 'berrio', 'terminal_norte', 10),
            ('ES-08', 'Caldas - Sabaneta', 'caldas_valeria', 'sabaneta_lomitas', None, 20),
            ('ES-09', 'Robledo - Aranjuez', 'robledo', 'aranjuez', None, 15),
            ('ES-10', 'Guayabal - Envigado', 'guayabal', 'envigado_oriente', 'olaya', 18),
            ('ES-11', 'Belén - Ditaires', 'belen', 'itagui_ditaires', None, 20),
        ],
    },
    {
        'nombre': 'Transportes Norte Aburrá S.A.S.', 'nit': '900872456-1', 'prefijo_usuario': 'norte',
        'dominio': 'transnorte.example', 'placa': 'TNA',
        'rutas': [
            ('TN-01', 'Niquía - Centro', 'bello_niquia', 'berrio', None, 8),
            ('TN-02', 'Bello - Robledo', 'bello_gran_avenida', 'robledo', None, 15),
            ('TN-03', 'Santo Domingo - Centro', 'santo_domingo', 'berrio', None, 10),
            ('TN-04', 'Manrique - Laureles', 'manrique', 'estadio', None, 12),
            ('TN-05', 'Bello - Itagüí', 'bello_gabriela', 'itagui_parque', 'terminal_norte', 15),
            ('TN-06', 'Castilla - El Poblado', 'castilla', 'poblado_parque', None, 12),
            ('TN-07', 'San Javier - Envigado', 'san_javier', 'envigado_parque', None, 15),
            ('TN-08', 'Caldas - Itagüí', 'caldas_parque', 'itagui_parque', 'estrella_parque', 20),
            ('TN-09', 'Sabaneta - Aguacatala', 'sabaneta_regional', 'aguacatala', None, 15),
            ('TN-10', 'Bello - Caldas', 'bello_parque', 'caldas_parque', None, 30),
            ('TN-11', 'La América - Guayabal', 'calasanz', 'guayabal', None, 15),
        ],
    },
]

ADMINISTRADORES = [('gerencia', 'Gerencia'), ('operaciones', 'Operaciones'), ('despacho', 'Despacho'),
                   ('rutas', 'Planeación de rutas'), ('flota', 'Flota'), ('turnos', 'Programación de turnos'),
                   ('atencion', 'Atención al usuario'), ('soporte', 'Soporte')]

NOMBRES = ['Carlos', 'Andrés', 'Juan David', 'Luis Fernando', 'Jorge', 'Sebastián', 'Diego', 'Alejandro', 'Mauricio',
           'Camilo', 'Santiago', 'Óscar', 'Wilson', 'Fabián', 'Hernán', 'Julián', 'Natalia', 'Paula', 'Diana',
           'Marcela', 'Laura', 'Catalina', 'Sandra', 'Valentina', 'Daniela', 'Alejandra']
APELLIDOS = ['Restrepo', 'Gómez', 'Zapata', 'Arango', 'Montoya', 'Ochoa', 'Cardona', 'Hincapié', 'Vélez', 'Londoño',
             'Mejía', 'Agudelo', 'Gaviria', 'Muñoz', 'Correa', 'Echeverri', 'Quintero', 'Henao', 'Betancur',
             'Posada', 'Uribe', 'Osorio', 'Giraldo', 'Álvarez', 'Ramírez', 'Castaño']
COLORES_PERFIL = ['#E63946', '#2A9D8F', '#264653', '#E9C46A', '#F4A261', '#6A4C93', '#1982C4', '#8AC926']

# (índice de la ruta, tipo, descripción, estado, horas atrás, motivo de descarte)
REPORTES = [
    (0, 'delay', 'Llevo 25 minutos esperando y el bus no ha pasado.', 'Pendiente', 1, ''),
    (1, 'warning', 'Trancón fuerte por un choque en la vía principal.', 'Pendiente', 0.5, ''),
    (2, 'info', 'El bus no tiene el letrero de la ruta y cuesta reconocerlo.', 'Pendiente', 3, ''),
    (3, 'warning', 'Hay un árbol caído que cierra un carril.', 'En_proceso', 2, ''),
    (4, 'delay', 'Los buses pasan llenos y no recogen pasajeros.', 'En_proceso', 5, ''),
    (5, 'warning', 'Semáforo dañado en el cruce, el tránsito va muy lento.', 'Resuelta', 26, ''),
    (6, 'delay', 'Demora de casi 40 minutos en la hora pico de la tarde.', 'Resuelta', 50, ''),
    (7, 'info', 'El conductor no me entregó el cambio completo.', 'Cancelada', 30, 'no_aplica'),
    (0, 'delay', 'El bus no ha pasado, ya van 20 minutos.', 'Cancelada', 6, 'duplicada'),
    (8, 'warning', 'Manifestación en la vía, los buses toman un desvío.', 'Resuelta', 72, ''),
    (9, 'info', 'El bus va con las ventanas dañadas y entra agua cuando llueve.', 'Pendiente', 8, ''),
]
# (índice de la ruta, tipo, descripción, estado, horas atrás, horas que dura publicada o None)
AVISOS_EMPRESA = [
    (1, 'info', 'Desde hoy la ruta sale 10 minutos más temprano en las mañanas.', 'En_proceso', 3, 24),
    (2, 'delay', 'Retrasos de hasta 15 minutos por obras en la vía.', 'Resuelta', 48, None),
    (5, 'warning', 'Desvío temporal por un evento en la zona: el bus no pasa por el parque.', 'Resuelta', 96, None),
]

DIFUSIONES = [
    ('todos', 'Recuerden revisar llantas, frenos y luces antes de salir a la ruta.', 9),
    ('todos', 'El lunes es festivo: los turnos fijos se mantienen en el mismo horario.', 6),
    ('ruta_dia', 'Mañana hay obras en el recorrido: tomen el desvío señalizado y avisen cualquier novedad.', 4),
    ('todos', 'Ya está disponible la nueva versión de la app del conductor, actualícenla hoy.', 3),
    ('ruta_dia', 'Por favor no se adelanten: respeten la frecuencia de la ruta.', 2),
    ('todos', 'Recuerden llevar la licencia y la tarjeta de operación en el bus.', 1),
    ('hoy', 'Lluvia fuerte en la tarde: manejen con precaución y reduzcan la velocidad.', 0),
    ('hoy', 'Hay control de tránsito en la Avenida Regional, lleven los documentos al día.', 0),
]
CONVERSACIONES = [
    [(True, 'Buenos días, ¿cómo va la ruta?'), (False, 'Bien, voy con unos 5 minutos de retraso por el tráfico.'),
     (True, 'Listo, gracias por avisar.')],
    [(False, 'El bus está haciendo un ruido raro en los frenos.'),
     (True, 'Termina la vuelta y pásalo por el taller, ya les avisé.'), (False, 'Perfecto, voy para allá.')],
    [(True, 'Mañana te toca el turno de la tarde, no el de la mañana.'), (False, 'Entendido, gracias.')],
    [(False, 'Hay un trancón muy grande en el centro, ¿tomo el desvío?'),
     (True, 'Sí, toma el desvío y avisa cuando vuelvas al recorrido.')],
    [(False, '¿Me pueden cambiar el turno del sábado?')],
    [(False, 'Ya llegué al inicio de la ruta, salgo en 5 minutos.')],
]


def _metros(a, b):
    """Distancia en metros entre dos [lng, lat]."""
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def _cada(coords, metros):
    """Puntos de la línea separados más o menos `metros` (el primero y el último incluidos)."""
    puntos, acumulado = [coords[0]], 0
    for a, b in zip(coords, coords[1:]):
        acumulado += _metros(a, b)
        if acumulado >= metros:
            puntos.append(b)
            acumulado = 0
    if puntos[-1] != coords[-1]:
        puntos.append(coords[-1])
    return puntos


def _hace(horas):
    return timezone.now() - timedelta(hours=horas)


def _a_las(dia, h, m=0):
    return timezone.make_aware(datetime.combine(dia, hora(h, m)))


class Command(BaseCommand):
    help = 'Crea dos empresas de ejemplo con rutas entre Caldas y Bello y datos en todas las tablas.'

    def add_arguments(self, parser):
        parser.add_argument('--contrasena', default='LocalBus2026',
                            help='Contraseña de todos los administradores, conductores y pasajeros creados.')

    def handle(self, *args, **opciones):
        nits = [e['nit'] for e in EMPRESAS]
        if Empresa.objects.filter(nit__in=nits).exists():
            raise CommandError('Las empresas de ejemplo ya están cargadas (sus NIT ya existen).')
        placas = [f"{e['placa']}{n}" for e in EMPRESAS for n in range(101, 117)]
        if Bus.objects.filter(placa__in=placas).exists():
            raise CommandError('Ya existen buses con las placas de ejemplo.')

        self.contrasena = opciones['contrasena']
        self.azar = random.Random(2026)
        self.telefonos = set(Conductor.objects.values_list('telefono', flat=True)) | set(
            Usuario.objects.exclude(telefono=None).values_list('telefono', flat=True))
        self.cedulas = set(Conductor.objects.values_list('cedula', flat=True))

        # La red va antes de la transacción: si OSRM falla, no se crea nada
        self.stdout.write('Trazando las rutas por las calles (OSRM)...')
        trazados = {}
        for empresa in EMPRESAS:
            for codigo, nombre, inicio, retorno, fin, _ in empresa['rutas']:
                trazados[codigo] = self.trazar(inicio, retorno, fin)
                ida_vuelta = trazados[codigo]
                self.stdout.write(f'  {codigo} {nombre}: {ida_vuelta["km"]:.1f} km'
                                  f'{" + traslado" if ida_vuelta["regreso"] else ""}')

        # Trazar toma minutos: la conexión que quedó quieta puede haberla cerrado el servidor, se abre otra
        connection.close()
        # Las alertas creadas aquí no se notifican por push: son de ejemplo
        post_save.disconnect(notificar_alerta_nueva, sender=Alerta)
        try:
            with transaction.atomic():
                usuarios = self.crear_usuarios()
                for datos in EMPRESAS:
                    self.crear_empresa(datos, trazados, usuarios)
                self.crear_suscripciones(usuarios)
        finally:
            post_save.connect(notificar_alerta_nueva, sender=Alerta)

        self.stdout.write(self.style.SUCCESS(
            f'Listo. Contraseña de todas las cuentas creadas: {self.contrasena}. '
            f'Administradores: {", ".join(e["prefijo_usuario"] + ".gerencia" for e in EMPRESAS)} (y los demás).'))

    # ===== RUTAS =====

    def tramo(self, a, b):
        lat1, lng1, _ = LUGARES[a]
        lat2, lng2, _ = LUGARES[b]
        url = OSRM.format(lng1, lat1, lng2, lat2)
        pedido = urllib.request.Request(url, headers={'User-Agent': 'LocalBus-prototipo/1.0 (datos de ejemplo)'})
        for intento in range(3):
            try:
                respuesta = json.load(urllib.request.urlopen(pedido, timeout=30))
                ruta = respuesta['routes'][0]
                time.sleep(0.4)
                return ruta['geometry']['coordinates'], ruta['distance'] / 1000, ruta['duration'] / 60
            except Exception as error:
                if intento == 2:
                    raise CommandError(f'OSRM no trazó el tramo {a} -> {b}: {error}')
                time.sleep(2)

    def trazar(self, inicio, retorno, fin):
        """Ida (inicio -> retorno) y vuelta (retorno -> fin) en una sola línea, como el editor; más el traslado
        fin -> inicio si el fin es otro punto."""
        ida, km_ida, min_ida = self.tramo(inicio, retorno)
        vuelta, km_vuelta, min_vuelta = self.tramo(retorno, fin or inicio)
        regreso = self.tramo(fin, inicio)[0] if fin else None
        return {'coords': ida + vuelta[1:], 'indice': len(ida) - 1, 'km': km_ida + km_vuelta,
                # Un bus con paradas tarda bastante más que un carro
                'minutos': int(round((min_ida + min_vuelta) * 1.8 / 5) * 5), 'regreso': regreso}

    def crear_rutas(self, empresa, datos, trazados):
        rutas = []
        for codigo, nombre, inicio, retorno, fin, frecuencia in datos['rutas']:
            t = trazados[codigo]
            ruta = Ruta(empresa=empresa, codigo=codigo, nombre=nombre,
                        origen=LUGARES[inicio][2], destino=LUGARES[retorno][2],
                        fin_es_origen=fin is None, fin=LUGARES[fin][2] if fin else '',
                        geometria_ruta=LineString(t['coords'], srid=4326), indice_retorno=t['indice'],
                        distancia_km=round(t['km'], 2), duracion_estimada_minutos=t['minutos'],
                        frecuencia_minutos=frecuencia)
            ruta.punto_origen = Point(*t['coords'][0], srid=4326)
            ruta.punto_destino = Point(*t['coords'][t['indice']], srid=4326)
            if fin:
                ruta.punto_fin = Point(*t['coords'][-1], srid=4326)
                ruta.geometria_regreso = LineString(t['regreso'], srid=4326)
            ruta.save()
            rutas.append(ruta)
        return rutas

    # ===== PERSONAS =====

    def nombre(self):
        return f'{self.azar.choice(NOMBRES)} {self.azar.choice(APELLIDOS)} {self.azar.choice(APELLIDOS)}'

    def telefono(self):
        while True:
            numero = f'3{self.azar.choice("0125")}{self.azar.randint(10000000, 99999999)}'
            if numero not in self.telefonos:
                self.telefonos.add(numero)
                return numero

    def cedula(self):
        while True:
            numero = str(self.azar.randint(1000000000, 1299999999))
            if numero not in self.cedulas:
                self.cedulas.add(numero)
                return numero

    def correo(self, nombre, dominio, usados):
        base = '.'.join(nombre.lower().split()[:2])
        for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('ñ', 'n')):
            base = base.replace(a, b)
        correo, n = f'{base}@{dominio}', 2
        while correo in usados:
            correo, n = f'{base}{n}@{dominio}', n + 1
        usados.add(correo)
        return correo

    def crear_usuarios(self):
        usados = set(Usuario.objects.values_list('email', flat=True))
        apodos = set(Usuario.objects.values_list('nickName', flat=True))
        usuarios = []
        for i in range(16):
            nombre = self.nombre()
            apodo = f'{nombre.split()[0].lower()}{self.azar.randint(10, 99)}'.replace('ó', 'o').replace('é', 'e').replace('á', 'a').replace(' ', '')
            while apodo in apodos:
                apodo += str(self.azar.randint(0, 9))
            apodos.add(apodo)
            usuario = Usuario(nombre=nombre, nickName=apodo, email=self.correo(nombre, 'correo.example', usados),
                              telefono=self.telefono() if i % 3 else None, color_perfil=COLORES_PERFIL[i % 8],
                              desplazamiento_mapa=self.azar.choice(['barra', 'dos_dedos']), vio_bienvenida=True,
                              tema=self.azar.choice(['sistema', 'sistema', 'claro', 'oscuro']))
            usuario.set_contrasena(self.contrasena)
            usuario.save()
            usuarios.append(usuario)
        return usuarios

    # ===== EMPRESA =====

    def crear_empresa(self, datos, trazados, usuarios):
        empresa = Empresa.objects.create(nombre=datos['nombre'], nit=datos['nit'])
        admins = []
        for clave, cargo in ADMINISTRADORES:
            nombre = self.nombre().split()
            user = User.objects.create_user(f"{datos['prefijo_usuario']}.{clave}", email=f"{clave}@{datos['dominio']}",
                                            password=self.contrasena, first_name=nombre[0], last_name=nombre[-2])
            admins.append(user)
            Administrador.objects.create(user=user, empresa=empresa)

        rutas = self.crear_rutas(empresa, datos, trazados)
        activas, cerrada = rutas[:10], rutas[10]
        # Las rutas con traslado primero, para que tengan turnos de día y se vea el traslado en el simulador
        orden = [r for r in activas if r.tiene_traslado] + [r for r in activas if not r.tiene_traslado]

        buses = []
        for i in range(16):
            bus = Bus.objects.create(empresa=empresa, placa=f"{datos['placa']}{101 + i}")
            bus.rutas.set({orden[i % 10], orden[(i + 4) % 10]} | ({cerrada} if i == 14 else set()))
            ConfiguracionBus.objects.create(bus=bus, velocidad_kmh=self.azar.choice([25, 30, 30, 35, 40]),
                                            simulando=i < 7)
            buses.append(bus)

        usados = set(Conductor.objects.values_list('email', flat=True))
        conductores = []
        for _ in range(16):
            nombre = self.nombre()
            conductor = Conductor(empresa=empresa, nombre=nombre, telefono=self.telefono(), cedula=self.cedula(),
                                  email=self.correo(nombre, datos['dominio'], usados))
            conductor.set_contrasena(self.contrasena)
            conductor.save()
            conductores.append(conductor)

        turnos = self.crear_turnos(buses, conductores, orden, cerrada)
        self.crear_ubicaciones(turnos)

        # Estados que no se pueden crear de entrada: una ruta fuera de servicio, un bus y un conductor inhabilitados
        cerrada.estado, cerrada.motivo_fuera_servicio = 'Fuera_servicio', MOTIVO_FUERA
        cerrada.alerta_fuera_servicio = self.alerta(empresa=empresa, ruta=cerrada, tipo='warning',
                                                    descripcion=f'Fuera de servicio: {MOTIVO_FUERA}',
                                                    estado='En_proceso', horas=20)
        cerrada.save()
        Bus.objects.filter(pk=buses[15].pk).update(habilitado=False)
        ConfiguracionBus.objects.filter(bus=buses[15]).update(simulando=False)
        Conductor.objects.filter(pk=conductores[15].pk).update(habilitado=False)

        self.crear_alertas(empresa, activas, usuarios)
        self.crear_mensajes(empresa, conductores, orden, admins)
        self.crear_respaldos(empresa, admins)

        for usuario in usuarios:
            usuario.rutas_seguidas.add(*self.azar.sample(activas, self.azar.randint(0, 2)))

        self.stdout.write(f'{empresa.nombre}: {len(rutas)} rutas, {len(buses)} buses, {len(conductores)} conductores, '
                          f'{len(turnos)} turnos')

    def crear_turnos(self, buses, conductores, orden, cerrada):
        hoy = timezone.localdate()
        turnos = []

        def turno(**campos):
            nuevo = Turno(**campos)
            problema = nuevo.validar()
            if problema:
                raise CommandError(f'Turno de ejemplo no válido: {problema}')
            nuevo.save()
            turnos.append(nuevo)
            return nuevo

        inicio_fijos = hoy - timedelta(days=20)
        # Seis buses con dos fijos cada uno: mañana todos los días y tarde de lunes a sábado
        for i in range(6):
            bus, ruta = buses[i], orden[i]
            turno(conductor=conductores[2 * i], bus=bus, ruta=ruta, fijo=True,
                  inicio=_a_las(inicio_fijos, 5), hora_fin=hora(13))
            turno(conductor=conductores[2 * i + 1], bus=bus, ruta=ruta, fijo=True,
                  inicio=_a_las(inicio_fijos, 13), hora_fin=hora(21), dias='0,1,2,3,4,5')
        # Un nocturno de lunes a viernes
        turno(conductor=conductores[12], bus=buses[6], ruta=orden[6], fijo=True,
              inicio=_a_las(inicio_fijos, 21), hora_fin=hora(5), dias='0,1,2,3,4')
        # Rotación de tres días que ya terminó, y otra que empieza mañana
        serie = uuid.uuid4()
        for d in (3, 2, 1):
            dia = hoy - timedelta(days=d)
            turno(conductor=conductores[13], bus=buses[7], ruta=orden[7], serie=serie,
                  inicio=_a_las(dia, 6), fin=_a_las(dia, 14))
        serie = uuid.uuid4()
        for d in (1, 2):
            dia = hoy + timedelta(days=d)
            turno(conductor=conductores[14], bus=buses[8], ruta=orden[8], serie=serie,
                  inicio=_a_las(dia, 6), fin=_a_las(dia, 14))
        manana = hoy + timedelta(days=1)
        turno(conductor=conductores[13], bus=buses[7], ruta=orden[7], inicio=_a_las(manana, 14), fin=_a_las(manana, 22))
        # Historial de quien luego queda inhabilitado
        hace_diez = hoy - timedelta(days=10)
        turno(conductor=conductores[15], bus=buses[9], ruta=orden[9], inicio=_a_las(hace_diez, 6),
              fin=_a_las(hace_diez, 14))
        # Fijo de la ruta que queda fuera de servicio: queda en pausa
        turno(conductor=conductores[14], bus=buses[14], ruta=cerrada, fijo=True,
              inicio=_a_las(hoy - timedelta(days=5), 15), hora_fin=hora(20), dias='0,1,2,3,4')
        return turnos

    def crear_ubicaciones(self, turnos):
        """Recorridos de días pasados, como si los hubiera enviado el GPS del conductor (el simulador solo
        borra los puntos simulados, no estos)."""
        ayer = timezone.localdate() - timedelta(days=1)
        for turno in turnos:
            if turno.fijo and turno.hora_fin == hora(13):
                dia = ayer
            elif not turno.fijo and turno.fin < timezone.now() and turno.conductor_id:
                dia = timezone.localtime(turno.inicio).date()
            else:
                continue
            ruta = turno.ruta
            puntos = _cada(ruta.get_coordenadas_ruta(), 1500)[:10]
            momento = _a_las(dia, 7, self.azar.randint(0, 40))
            filas = [(p, False) for p in puntos]
            if ruta.tiene_traslado:
                filas += [(p, True) for p in _cada(ruta.get_coordenadas_regreso(), 1500)[:3]]
            for (lng, lat), traslado in filas:
                momento += timedelta(minutes=3)
                punto = UbicacionBus.objects.create(bus=turno.bus, ruta=ruta, conductor=turno.conductor, latitud=lat,
                                                    longitud=lng, velocidad=self.azar.randint(12, 45),
                                                    en_traslado=traslado)
                UbicacionBus.objects.filter(pk=punto.pk).update(timestamp=momento)
            Bus.objects.filter(pk=turno.bus_id, ultima_ubicacion__isnull=True).update(ultima_ubicacion=momento)
            Bus.objects.filter(pk=turno.bus_id, ultima_ubicacion__lt=momento).update(ultima_ubicacion=momento)

    # ===== ALERTAS =====

    def alerta(self, horas, publicada_en=None, cercanas=False, **campos):
        alerta = Alerta.objects.create(**campos)
        creada = _hace(horas)
        cambios = {'fecha_creacion': creada}
        if alerta.fecha_publicacion:
            cambios['fecha_publicacion'] = publicada_en or creada + timedelta(minutes=self.azar.randint(5, 40))
        Alerta.objects.filter(pk=alerta.pk).update(**cambios)
        if cercanas and alerta.latitud is not None:
            alerta.rutas_cercanas.set(_rutas_en_rango(alerta.latitud, alerta.longitud).exclude(id_ruta=alerta.ruta_id))
        return alerta

    def punto_de(self, ruta):
        coords = ruta.get_coordenadas_ruta()
        lng, lat = coords[self.azar.randint(len(coords) // 10, len(coords) * 9 // 10)]
        return lat, lng

    def crear_alertas(self, empresa, rutas, usuarios):
        principales = []
        for indice, tipo, descripcion, estado, horas, motivo in REPORTES:
            lat, lng = self.punto_de(rutas[indice])
            principales.append(self.alerta(horas, cercanas=True, usuario=self.azar.choice(usuarios),
                                           ruta=rutas[indice], tipo=tipo, descripcion=descripcion, estado=estado,
                                           motivo_descarte=motivo, latitud=lat, longitud=lng))
        # Reportes que se sumaron a otros: uno con texto y dos confirmaciones ("Yo también lo veo")
        for principal, texto, confirma in ((principales[3], 'Confirmo, el carril sigue cerrado.', False),
                                           (principales[3], TEXTO_CONFIRMACION, True),
                                           (principales[1], TEXTO_CONFIRMACION, True)):
            otro = self.azar.choice([u for u in usuarios if u.pk != principal.usuario_id])
            self.alerta(0.2, usuario=otro, ruta=principal.ruta, tipo=principal.tipo, descripcion=texto,
                        estado=principal.estado, alerta_principal=principal, confirmacion=confirma,
                        latitud=principal.latitud + 0.0008, longitud=principal.longitud + 0.0005)
        for indice, tipo, descripcion, estado, horas, duracion in AVISOS_EMPRESA:
            vence = _hace(horas) + timedelta(hours=duracion) if duracion else None
            self.alerta(horas, publicada_en=_hace(horas), empresa=empresa, ruta=rutas[indice], tipo=tipo,
                        descripcion=descripcion, estado=estado, vence_en=vence)

    # ===== MENSAJES Y BACKUPS =====

    def crear_mensajes(self, empresa, conductores, orden, admins):
        hoy = timezone.localdate()
        for n, (grupo, texto, dias) in enumerate(DIFUSIONES):
            ruta = orden[n % 6]
            dia = hoy - timedelta(days=dias)
            receptores, destino, error = destinatarios(empresa, grupo, ruta.pk, dia.isoformat())
            if error or not receptores:
                receptores, destino = destinatarios(empresa, 'todos')[:2]
                grupo = 'todos'
            creado = _a_las(dia, 6, 10) - timedelta(hours=self.azar.randint(0, 10)) if dias else _hace(2 + n)
            enviado_por = self.azar.choice(admins[:3])
            difusion = Difusion.objects.create(empresa=empresa, enviado_por=enviado_por, grupo=grupo,
                                               destino=destino, texto=texto)
            Difusion.objects.filter(pk=difusion.pk).update(creado=creado)
            for c in receptores:
                leido = creado + timedelta(minutes=self.azar.randint(2, 90)) if dias or self.azar.random() < .5 else None
                m = Mensaje.objects.create(conductor=c, de_empresa=True, enviado_por=enviado_por, difusion=difusion,
                                           texto=texto)
                Mensaje.objects.filter(pk=m.pk).update(creado=creado, leido=leido)

        for conductor, conversacion in zip(conductores[:len(CONVERSACIONES)], CONVERSACIONES):
            momento = _hace(self.azar.randint(1, 30))
            for i, (de_empresa, texto) in enumerate(conversacion):
                momento += timedelta(minutes=self.azar.randint(1, 15))
                ultimo = i == len(conversacion) - 1
                # El último mensaje del conductor queda sin leer: la empresa lo ve como nuevo
                leido = None if ultimo and not de_empresa else momento + timedelta(minutes=1)
                m = Mensaje.objects.create(conductor=conductor, de_empresa=de_empresa, texto=texto,
                                           enviado_por=admins[1] if de_empresa else None)
                Mensaje.objects.filter(pk=m.pk).update(creado=momento, leido=leido)

    def crear_respaldos(self, empresa, admins):
        from core.backup import _nombre_archivo
        for dias, tipo in ((40, 'descarga'), (32, 'carga'), (25, 'descarga'), (18, 'restauracion'),
                           (12, 'descarga'), (7, 'carga'), (3, 'descarga'), (1, 'descarga')):
            creado = _hace(24 * dias + self.azar.randint(0, 8))
            archivo = {'carga': 'carga_rutas_buses.xlsx',
                       'restauracion': _nombre_archivo(empresa, creado - timedelta(days=7))}.get(tipo, '')
            r = Respaldo.objects.create(empresa=empresa, hecho_por=self.azar.choice(admins[:2]), tipo=tipo,
                                        archivo=archivo, registros=self.azar.randint(40, 400),
                                        tamano_bytes=self.azar.randint(180_000, 2_400_000) if tipo == 'descarga' else 0)
            Respaldo.objects.filter(pk=r.pk).update(creado=creado)

    def crear_suscripciones(self, usuarios):
        """Celulares de ejemplo con la app de pasajeros. Quedan inactivos (active=False): sus tokens no son
        reales y no deben recibir notificaciones push."""
        from fcm_django.models import FCMDevice
        rutas = list(Ruta.objects.filter(empresa__nit__in=[e['nit'] for e in EMPRESAS], estado='Activa'))
        for i, _ in enumerate(usuarios):
            dispositivo = FCMDevice.objects.create(name='mapa', active=False, type='android',
                                                   device_id=f'demo-pasajero-{i + 1}',
                                                   registration_id=f'demo-token-{uuid.uuid4().hex}')
            suscripcion = SuscripcionRutas.objects.create(dispositivo=dispositivo)
            suscripcion.rutas.set(self.azar.sample(rutas, self.azar.randint(1, 4)))
