# core/management/commands/simular_buses.py
import time
import math
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import ConfiguracionBus, UbicacionBus, Bus


class Command(BaseCommand):
    help = 'Simula el movimiento de los buses por sus rutas'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('🚌 Simulador iniciado'))
        self.stdout.write('   La velocidad afecta cuántos metros avanza por ciclo\n')

        while True:
            # Reconsultar SIEMPRE la BD (por si cambian velocidad, reinician, etc.)
            configs = ConfiguracionBus.objects.filter(
                simulando=True
            ).select_related('bus', 'bus__ruta')

            for config in configs:
                try:
                    config.refresh_from_db()
                    self.mover_bus(config, intervalo=3)
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(f'❌ Error {config.bus.placa}: {e}')
                    )

            time.sleep(3)

    def mover_bus(self, config, intervalo):
        """Mueve un bus por su ruta avanzando metros según velocidad"""
        bus = config.bus
        ruta = bus.ruta

        if not ruta or not ruta.geometria_ruta:
            return

        coords = list(ruta.geometria_ruta.coords)

        if len(coords) < 2:
            return

        # ===== METROS A RECORRER EN ESTE CICLO =====
        velocidad_ms = config.velocidad_kmh * 1000 / 3600
        metros_a_recorrer = velocidad_ms * intervalo

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

        # Guardar ubicación (esto es lo que lee el mapa)
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
            f'| pos {posicion}/{len(coords)} | {config.velocidad_kmh} km/h '
            f'| seg {metros_en_segmento:.0f}m | avanzó {distancia_real:.0f}m'
        )

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