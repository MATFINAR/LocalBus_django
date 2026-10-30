# core/management/commands/simular_buses.py
import time
import math
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import close_old_connections, DatabaseError
from django.utils import timezone
from core.models import ConfiguracionBus, UbicacionBus

# Si el conductor envió GPS real hace menos de esto, el simulador no mueve ese bus
SEGUNDOS_GPS_REAL = 60
# Cada cuánto se borran los puntos simulados viejos
SEGUNDOS_ENTRE_LIMPIEZAS = 600


class Command(BaseCommand):
    help = 'Simula el movimiento de los buses por sus rutas'

    def add_arguments(self, parser):
        parser.add_argument('--intervalo', type=float, default=3,
                            help='Segundos entre cada movimiento (por defecto 3)')
        parser.add_argument('--conservar-horas', type=float, default=6,
                            help='Horas de puntos simulados que se conservan (por defecto 6)')

    def handle(self, *args, **options):
        intervalo = options['intervalo']
        conservar = timedelta(hours=options['conservar_horas'])

        # Estado en memoria por bus: última ruta simulada, último movimiento y avisos ya mostrados
        self.ruta_simulada = {}
        self.ultimo_movimiento = {}
        self.avisos = set()
        ultima_limpieza = 0

        self.stdout.write(self.style.SUCCESS('🚌 Simulador iniciado (Ctrl+C para detener)'))
        self.stdout.write('   La velocidad afecta cuántos metros avanza por ciclo\n')

        try:
            while True:
                inicio_ciclo = time.monotonic()
                try:
                    # Reconsultar SIEMPRE la BD (por si cambian velocidad, reinician, etc.)
                    configs = list(ConfiguracionBus.objects.filter(simulando=True).select_related('bus'))

                    for config in configs:
                        try:
                            self.mover_bus(config, intervalo)
                        except DatabaseError:
                            raise
                        except Exception as e:
                            self.stdout.write(self.style.ERROR(f'❌ Error {config.bus.placa}: {e}'))

                    if time.monotonic() - ultima_limpieza > SEGUNDOS_ENTRE_LIMPIEZAS:
                        self.limpiar_puntos_simulados(conservar)
                        ultima_limpieza = time.monotonic()

                except DatabaseError as e:
                    # Conexión caída o base reiniciada: se reconecta en el siguiente ciclo
                    self.stdout.write(self.style.ERROR(f'⚠️ Error de base de datos, reintentando en 5 s: {e}'))
                    close_old_connections()
                    time.sleep(5)
                    continue

                time.sleep(max(0.0, intervalo - (time.monotonic() - inicio_ciclo)))
        except KeyboardInterrupt:
            self.stdout.write(self.style.SUCCESS('\n🛑 Simulador detenido'))

    def avisar_una_vez(self, clave, mensaje):
        """Evita repetir el mismo aviso en cada ciclo."""
        if clave not in self.avisos:
            self.avisos.add(clave)
            self.stdout.write(self.style.WARNING(mensaje))

    def mover_bus(self, config, intervalo):
        """Mueve un bus por su ruta avanzando metros según velocidad"""
        config.refresh_from_db()
        bus = config.bus

        # Si el conductor está enviando su GPS real, ese manda: no se simula encima
        hace_poco = timezone.now() - timedelta(seconds=SEGUNDOS_GPS_REAL)
        if UbicacionBus.objects.filter(bus=bus, conductor__isnull=False, timestamp__gte=hace_poco).exists():
            self.avisar_una_vez(('gps', bus.pk), f'📡 {bus.placa}: tiene GPS real del conductor, no se simula')
            self.ultimo_movimiento.pop(bus.pk, None)
            return
        self.avisos.discard(('gps', bus.pk))

        # Ruta del turno vigente o, si el bus no tiene turno, la primera ruta habilitada
        ruta = bus.ruta_actual
        if not ruta or not ruta.geometria_ruta or len(ruta.geometria_ruta.coords) < 2:
            self.avisar_una_vez(('ruta', bus.pk), f'⚠️ {bus.placa}: sin ruta con trazado, no se puede simular')
            return
        if ruta.estado == 'Fuera_servicio':
            self.avisar_una_vez(('fuera', bus.pk), f'⚠️ {bus.placa}: la ruta {ruta.codigo} está fuera de servicio')
            return
        self.avisos -= {('ruta', bus.pk), ('fuera', bus.pk)}

        coords = list(ruta.geometria_ruta.coords)

        # Si el turno cambió la ruta del bus, empieza desde el inicio de la nueva ruta
        if self.ruta_simulada.get(bus.pk, ruta.pk) != ruta.pk:
            self.stdout.write(f'🔀 {bus.placa}: cambió a la ruta {ruta.codigo}, reinicia desde el origen')
            config.posicion_actual = 0
            config.direccion = 1
            config.metros_en_segmento = 0
        self.ruta_simulada[bus.pk] = ruta.pk

        # ===== METROS A RECORRER EN ESTE CICLO =====
        # Se usa el tiempo real transcurrido (máx. 3 ciclos) para que la velocidad sea correcta
        # aunque un ciclo tarde más de lo previsto
        ahora = time.monotonic()
        transcurrido = ahora - self.ultimo_movimiento.get(bus.pk, ahora - intervalo)
        self.ultimo_movimiento[bus.pk] = ahora
        transcurrido = min(transcurrido, intervalo * 3)

        velocidad_ms = config.velocidad_kmh * 1000 / 3600
        metros_a_recorrer = velocidad_ms * transcurrido

        posicion = max(0, min(config.posicion_actual, len(coords) - 1))
        direccion = config.direccion if config.direccion in (1, -1) else 1

        # ✅ Metros ya recorridos dentro del segmento actual
        metros_en_segmento = getattr(config, 'metros_en_segmento', 0) or 0

        metros_restantes = metros_a_recorrer
        max_iteraciones = 2000
        iteraciones = 0

        # Coordenadas de partida
        lat_final = coords[posicion][1]
        lng_final = coords[posicion][0]

        while metros_restantes > 0 and iteraciones < max_iteraciones:
            iteraciones += 1

            # Rebotar en los extremos
            if posicion >= len(coords) - 1:
                direccion = -1
                metros_en_segmento = 0
            elif posicion <= 0:
                direccion = 1
                metros_en_segmento = 0

            siguiente = posicion + direccion

            if siguiente < 0 or siguiente >= len(coords):
                break

            p_actual = coords[posicion]
            p_siguiente = coords[siguiente]
            dist_segmento = self.calcular_distancia(p_actual, p_siguiente)

            # Segmento con puntos duplicados: saltar sin consumir metros
            if dist_segmento < 0.5:
                posicion = siguiente
                lat_final = p_siguiente[1]
                lng_final = p_siguiente[0]
                metros_en_segmento = 0
                continue

            # Cuánto falta para llegar al siguiente punto
            falta_segmento = dist_segmento - metros_en_segmento

            if metros_restantes >= falta_segmento:
                # ✅ Avanzamos al siguiente punto COMPLETO
                metros_restantes -= falta_segmento
                posicion = siguiente
                metros_en_segmento = 0
                lat_final = p_siguiente[1]
                lng_final = p_siguiente[0]
            else:
                # ✅ Nos quedamos DENTRO del segmento, pero avanzamos
                metros_en_segmento += metros_restantes
                factor = metros_en_segmento / dist_segmento

                lng1, lat1 = p_actual
                lng2, lat2 = p_siguiente
                lng_final = lng1 + (lng2 - lng1) * factor
                lat_final = lat1 + (lat2 - lat1) * factor
                metros_restantes = 0

        # Asegurar límites
        posicion = max(0, min(posicion, len(coords) - 1))

        # Distancia real avanzada
        distancia_real = metros_a_recorrer - metros_restantes

        # Guardar ubicación (esto es lo que lee el mapa). Sin conductor = punto simulado
        UbicacionBus.objects.create(
            bus=bus,
            ruta=ruta,
            latitud=lat_final,
            longitud=lng_final,
            velocidad=config.velocidad_kmh
        )

        # Actualizar bus
        bus.ultima_ubicacion = timezone.now()
        bus.activo = True
        bus.save(update_fields=['ultima_ubicacion', 'activo'])

        # Guardar estado de la config
        config.posicion_actual = posicion
        config.direccion = direccion
        config.metros_en_segmento = metros_en_segmento
        config.distancia_recorrida += distancia_real
        config.save(update_fields=[
            'posicion_actual', 'direccion', 'metros_en_segmento',
            'distancia_recorrida', 'ultima_actualizacion'
        ])

        direccion_txt = "→" if direccion == 1 else "←"
        self.stdout.write(
            f'📍 {bus.placa} {direccion_txt} [{lat_final:.5f}, {lng_final:.5f}] '
            f'| {ruta.codigo} pos {posicion}/{len(coords)} | {config.velocidad_kmh} km/h '
            f'| seg {metros_en_segmento:.0f}m | avanzó {distancia_real:.0f}m'
        )

    def limpiar_puntos_simulados(self, conservar):
        """Borra puntos simulados viejos (los del GPS real se conservan como historial)."""
        borrados, _ = UbicacionBus.objects.filter(
            conductor__isnull=True, timestamp__lt=timezone.now() - conservar
        ).delete()
        if borrados:
            self.stdout.write(f'🧹 {borrados} puntos simulados antiguos eliminados')

    def calcular_distancia(self, p1, p2):
        """Haversine - devuelve metros"""
        lng1, lat1 = p1
        lng2, lat2 = p2

        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lng2 - lng1)

        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        return R * c
