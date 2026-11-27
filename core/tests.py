from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.gis.geos import LineString
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Administrador, Alerta, Empresa, Ruta, RutaAfectada, Usuario


def _linea(lon):
    """Trazado norte-sur en la longitud dada (0.001° ≈ 110 m)."""
    return LineString([(lon, 6.20), (lon, 6.21), (lon, 6.22)], srid=4326)


# Punto que marca la empresa en el mapa
PUNTO = {'latitud': 6.21, 'longitud': -75.570}


# Sin el manifiesto de collectstatic (producción usa ManifestStaticFilesStorage)
SIN_MANIFIESTO = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}


@override_settings(ALLOWED_HOSTS=['testserver'], STORAGES=SIN_MANIFIESTO)
class RutasAfectadasTests(TestCase):
    """Una alerta afecta a varias rutas de la empresa y cada ruta tiene su propio estado."""

    @classmethod
    def setUpTestData(cls):
        cls.norte = Empresa.objects.create(nombre='Norte', nit='1')
        cls.sur = Empresa.objects.create(nombre='Sur', nit='2')
        cls.r1 = Ruta.objects.create(empresa=cls.norte, nombre='Uno', codigo='N1', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.570))
        cls.r2 = Ruta.objects.create(empresa=cls.norte, nombre='Dos', codigo='N2', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.571))
        cls.r3 = Ruta.objects.create(empresa=cls.norte, nombre='Tres', codigo='N3', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.573))
        cls.lejos = Ruta.objects.create(empresa=cls.norte, nombre='Lejos', codigo='N4', origen='A', destino='B',
                                        geometria_ruta=_linea(-75.600))
        cls.s1 = Ruta.objects.create(empresa=cls.sur, nombre='Sur uno', codigo='S1', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.5705))
        cls.admin_norte = User.objects.create_user('norte')
        Administrador.objects.create(user=cls.admin_norte, empresa=cls.norte)
        cls.admin_sur = User.objects.create_user('sur')
        Administrador.objects.create(user=cls.admin_sur, empresa=cls.sur)
        cls.pasajero = Usuario.objects.create(email='p@x.co', contrasena='x', nombre='Ana Pérez', nickName='ana')

    def empresa(self, user=None):
        self.client.force_login(user or self.admin_norte)
        return self.client

    def pasajero_cliente(self):
        sesion = self.client.session
        sesion['usuario_id'] = self.pasajero.pk
        sesion.save()
        return self.client

    def crear(self, estados, tipo='delay', **extra):
        datos = {'tipo': tipo, 'descripcion': 'Choque en la vía', 'rutas': [r.pk for r in estados], **PUNTO, **extra}
        datos.update({f'estado_{r.pk}': e for r, e in estados.items()})
        return self.empresa().post('/crearAlerta/', datos)

    # ---------- Crear ----------

    def test_crear_con_varias_rutas_y_estados(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'Resuelta', self.r3: 'En_proceso'})
        alerta = Alerta.objects.get()
        self.assertEqual(alerta.estado, 'En_proceso')
        self.assertEqual(alerta.ruta, self.r1)
        self.assertEqual(dict(alerta.rutas_afectadas.values_list('ruta__codigo', 'estado')),
                         {'N1': 'En_proceso', 'N2': 'Resuelta', 'N3': 'En_proceso'})
        self.assertEqual({r.codigo for r in alerta.rutas_vigentes()}, {'N1', 'N3'})

    def test_todas_resueltas_deja_la_alerta_resuelta(self):
        self.crear({self.r1: 'Resuelta', self.r2: 'Resuelta'})
        self.assertEqual(Alerta.objects.get().estado, 'Resuelta')

    def test_principal_es_una_en_proceso_si_la_pedida_no_esta(self):
        self.crear({self.r1: 'Resuelta', self.r2: 'En_proceso'}, ruta=self.r3.pk)
        self.assertEqual(Alerta.objects.get().ruta, self.r2)

    def test_sin_rutas_o_con_rutas_ajenas_no_crea(self):
        self.empresa().post('/crearAlerta/', {'tipo': 'delay', 'descripcion': 'x'})
        self.crear({self.r1: 'En_proceso', self.s1: 'En_proceso'})
        self.assertFalse(Alerta.objects.exists())

    def test_estado_invalido_no_crea(self):
        self.crear({self.r1: 'Pendiente'})
        self.assertFalse(Alerta.objects.exists())

    # ---------- Revisar el reporte de un pasajero ----------

    def test_revisar_reporte_elige_rutas_y_absorbe_pendientes(self):
        reporte = Alerta.objects.create(usuario=self.pasajero, ruta=self.r1, tipo='delay', descripcion='Trancón',
                                        latitud=6.21, longitud=-75.570)
        otro = Alerta.objects.create(usuario=self.pasajero, ruta=self.r2, tipo='delay', descripcion='Igual',
                                     latitud=6.21, longitud=-75.571)
        self.empresa().post(f'/editarAlerta/{reporte.pk}/', {
            'ruta': self.r1.pk, 'tipo': 'delay', 'descripcion': 'Trancón', 'duracion': '',
            'rutas': [self.r1.pk, self.r2.pk], f'estado_{self.r1.pk}': 'En_proceso',
            f'estado_{self.r2.pk}': 'En_proceso'})
        reporte.refresh_from_db()
        otro.refresh_from_db()
        self.assertEqual(reporte.estado, 'En_proceso')
        self.assertEqual(reporte.rutas_afectadas.count(), 2)
        # El reporte pendiente de la otra ruta afectada se suma a la alerta publicada
        self.assertEqual((otro.alerta_principal_id, otro.estado), (reporte.pk, 'En_proceso'))

    def test_resolver_algunas_rutas_al_editar(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'En_proceso', self.r3: 'En_proceso'})
        alerta = Alerta.objects.get()
        self.empresa().post(f'/editarAlerta/{alerta.pk}/', {
            'ruta': self.r1.pk, 'tipo': 'delay', 'descripcion': 'Choque en la vía', 'duracion': 'mantener', **PUNTO,
            'rutas': [self.r1.pk, self.r2.pk, self.r3.pk], f'estado_{self.r1.pk}': 'Resuelta',
            f'estado_{self.r2.pk}': 'Resuelta', f'estado_{self.r3.pk}': 'En_proceso'})
        alerta.refresh_from_db()
        self.assertEqual(alerta.estado, 'En_proceso')
        self.assertEqual([r.codigo for r in alerta.rutas_vigentes()], ['N3'])

    def test_quitar_ruta_al_editar(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'En_proceso'})
        alerta = Alerta.objects.get()
        self.empresa().post(f'/editarAlerta/{alerta.pk}/', {
            'ruta': self.r1.pk, 'tipo': 'delay', 'descripcion': 'Choque en la vía', 'duracion': 'mantener', **PUNTO,
            'rutas': [self.r2.pk], f'estado_{self.r2.pk}': 'En_proceso'})
        alerta.refresh_from_db()
        self.assertEqual(alerta.ruta, self.r2)
        self.assertEqual(list(alerta.rutas_afectadas.values_list('ruta__codigo', flat=True)), ['N2'])

    # ---------- Cambiar el estado de toda la alerta ----------

    def test_marcar_resuelta_resuelve_todas_las_rutas(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'En_proceso'})
        alerta = Alerta.objects.get()
        self.empresa().post(f'/estadoAlerta/{alerta.pk}/', {'estado': 'Resuelta'})
        self.assertEqual(set(alerta.rutas_afectadas.values_list('estado', flat=True)), {'Resuelta'})

    def test_publicar_reporte_sin_elegir_rutas_deja_la_principal(self):
        reporte = Alerta.objects.create(usuario=self.pasajero, ruta=self.r1, tipo='warning', descripcion='x')
        self.empresa().post(f'/estadoAlerta/{reporte.pk}/', {'estado': 'En_proceso'})
        self.assertEqual(list(reporte.rutas_afectadas.values_list('ruta_id', 'estado')),
                         [(self.r1.pk, 'En_proceso')])

    def test_al_vencer_se_resuelven_todas_las_rutas(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'En_proceso'})
        alerta = Alerta.objects.get()
        Alerta.objects.filter(pk=alerta.pk).update(vence_en=timezone.now() - timedelta(minutes=1))
        Alerta.cerrar_vencidas()
        alerta.refresh_from_db()
        self.assertEqual(alerta.estado, 'Resuelta')
        self.assertEqual(set(alerta.rutas_afectadas.values_list('estado', flat=True)), {'Resuelta'})

    # ---------- Lo que ven los pasajeros ----------

    def test_aviso_del_mapa_sigue_en_las_rutas_en_proceso(self):
        self.crear({self.r1: 'Resuelta', self.r2: 'En_proceso'}, ruta=self.r1.pk)
        alerta = Alerta.objects.get()
        self.assertEqual(alerta.ruta, self.r1)  # la principal está resuelta en su ruta
        vigentes = Alerta.objects.filter(Alerta.vigente_en([self.r2.pk])).distinct()
        self.assertEqual(list(vigentes), [alerta])
        self.assertFalse(Alerta.objects.filter(Alerta.vigente_en([self.r1.pk])).exists())
        respuesta = self.client.get('/api/movil/mapa/')
        self.assertEqual([a['ruta'] for a in respuesta.json()['avisos']], ['Dos'])

    def test_pagina_publica_muestra_y_filtra_por_rutas_afectadas(self):
        self.crear({self.r1: 'En_proceso', self.r2: 'Resuelta', self.r3: 'En_proceso'})
        self.client.logout()
        html = self.client.get('/alertas/').content.decode()
        self.assertIn(f'data-rutas="{self.r1.pk},{self.r2.pk},{self.r3.pk}"', html)
        self.assertIn('al-placa--resuelta', html)
        self.assertIn('1 de 3 resuelta', html)

    def test_notificaciones_de_rutas_seguidas_incluyen_rutas_afectadas(self):
        self.pasajero.rutas_seguidas.set([self.r3])
        desde = (timezone.now() - timedelta(minutes=1)).isoformat()
        self.crear({self.r1: 'En_proceso', self.r3: 'En_proceso'})
        cliente = self.pasajero_cliente()
        datos = cliente.get('/api/alertas/', {'mias': '1', 'publicadas_desde': desde}).json()
        self.assertEqual(datos['count'], 1)
        self.assertEqual([r['codigo'] for r in datos['alertas'][0]['rutas']], ['N1', 'N3'])

    # ---------- Formulario de la empresa ----------

    def test_formulario_de_empresa_trae_la_lista_de_rutas(self):
        html = self.empresa().get('/alertas/').content.decode()
        self.assertIn('id="alertRutasTodas"', html)
        self.assertIn('id="alertRutasNinguna"', html)
        for ruta in (self.r1, self.r2, self.r3):
            self.assertIn(f'name="estado_{ruta.pk}"', html)
        self.assertNotIn(f'name="estado_{self.s1.pk}"', html)  # solo rutas propias

    # ---------- Punto en el mapa y radio de 500 m ----------

    def test_guarda_el_punto_que_marca_la_empresa(self):
        self.crear({self.r1: 'En_proceso'})
        alerta = Alerta.objects.get()
        self.assertEqual((alerta.latitud, alerta.longitud), (6.21, -75.570))
        self.assertIn(self.s1, alerta.rutas_cercanas.all())

    def test_sin_punto_o_con_ruta_a_mas_de_500_m_no_crea(self):
        self.crear({self.r1: 'En_proceso'}, latitud='', longitud='')
        self.crear({self.r1: 'En_proceso', self.lejos: 'En_proceso'})
        self.assertFalse(Alerta.objects.exists())

    def test_revisar_un_reporte_conserva_donde_se_reporto(self):
        reporte = Alerta.objects.create(usuario=self.pasajero, ruta=self.r1, tipo='delay', descripcion='x',
                                        latitud=6.21, longitud=-75.570)
        # Aunque el envío traiga otro punto, vale el del pasajero: la ruta lejana se rechaza
        self.empresa().post(f'/editarAlerta/{reporte.pk}/', {
            'ruta': self.r1.pk, 'tipo': 'delay', 'descripcion': 'x', 'duracion': '', 'rutas': [self.lejos.pk],
            f'estado_{self.lejos.pk}': 'En_proceso', 'latitud': 6.21, 'longitud': -75.600})
        reporte.refresh_from_db()
        self.assertEqual((reporte.estado, reporte.longitud), ('Pendiente', -75.570))

    def test_la_lista_de_la_empresa_solo_trae_sus_rutas_a_500_m(self):
        datos = self.empresa().get('/api/alertas/rutas-cercanas/', PUNTO).json()
        self.assertEqual({r['codigo'] for r in datos['rutas']}, {'N1', 'N2', 'N3'})

    def test_alerta_de_empresa_recibe_reportes_de_toda_la_ruta(self):
        self.crear({self.r1: 'En_proceso'})
        self.client.logout()
        self.pasajero_cliente().post('/crearAlerta/', {'ruta': self.r1.pk, 'tipo': 'delay', 'descripcion': 'lejos',
                                                       'latitud': 6.20, 'longitud': -75.570})
        self.assertEqual(Alerta.objects.get(descripcion='lejos').alerta_principal.empresa, self.norte)

    def test_pasajero_no_pasa_su_reporte_a_una_ruta_lejana(self):
        reporte = Alerta.objects.create(usuario=self.pasajero, ruta=self.r1, tipo='delay', descripcion='x',
                                        latitud=6.21, longitud=-75.570)
        self.pasajero_cliente().post(f'/editarAlerta/{reporte.pk}/', {
            'ruta': self.lejos.pk, 'tipo': 'delay', 'descripcion': 'x'})
        reporte.refresh_from_db()
        self.assertEqual(reporte.ruta, self.r1)

    # ---------- Avisos a otras empresas ----------

    def test_solo_las_demoras_se_avisan_a_otras_empresas(self):
        cliente = self.pasajero_cliente()
        for tipo, texto in (('delay', 'Demora cerca'), ('warning', 'Advertencia cerca')):
            cliente.post('/crearAlerta/', {'ruta': self.r1.pk, 'tipo': tipo, 'descripcion': texto,
                                           'latitud': 6.21, 'longitud': -75.570})
        self.assertEqual(Alerta.objects.get(descripcion='Advertencia cerca').rutas_cercanas.count(), 3)
        html = self.empresa(self.admin_sur).get('/alertas/').content.decode()
        self.assertIn('Demora cerca', html)
        self.assertNotIn('Advertencia cerca', html)


@override_settings(ALLOWED_HOSTS=['testserver'], STORAGES=SIN_MANIFIESTO)
class DemorasEnMapaTests(TestCase):
    """Al elegir una ruta en el mapa (web y app) se ven los puntos de las demoras que pueden afectarla."""

    @classmethod
    def setUpTestData(cls):
        cls.norte = Empresa.objects.create(nombre='Norte', nit='1')
        cls.sur = Empresa.objects.create(nombre='Sur', nit='2')
        cls.r1 = Ruta.objects.create(empresa=cls.norte, nombre='Uno', codigo='N1', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.570))
        cls.r2 = Ruta.objects.create(empresa=cls.norte, nombre='Dos', codigo='N2', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.573))   # a ~330 m
        cls.s1 = Ruta.objects.create(empresa=cls.sur, nombre='Sur uno', codigo='S1', origen='A', destino='B',
                                     geometria_ruta=_linea(-75.5705))
        cls.lejos = Ruta.objects.create(empresa=cls.norte, nombre='Lejos', codigo='N4', origen='A', destino='B',
                                        geometria_ruta=_linea(-75.600))  # a ~3 km
        cls.pasajero = Usuario.objects.create(email='p@x.co', contrasena='x', nombre='Ana Pérez', nickName='ana')

    def demora(self, **campos):
        datos = {'usuario': self.pasajero, 'ruta': self.r1, 'tipo': 'delay', 'descripcion': 'Trancón',
                 'estado': 'En_proceso', 'latitud': 6.2101234, 'longitud': -75.5701234, **campos}
        return Alerta.objects.create(**datos)

    def demoras(self):
        return self.client.get('/api/movil/mapa/').json()['demoras']

    def test_demora_afecta_su_ruta_y_las_que_pasan_a_500_m(self):
        self.demora()
        [punto] = self.demoras()
        self.assertEqual(set(punto['rutas']), {self.r1.pk, self.r2.pk, self.s1.pk})
        self.assertEqual(punto['directas'], [self.r1.pk])
        # El punto de un pasajero se publica redondeado (~110 m)
        self.assertEqual((punto['lat'], punto['lng']), (6.21, -75.57))

    def test_solo_demoras_publicadas_y_con_ubicacion(self):
        self.demora(tipo='warning', descripcion='Advertencia')
        self.demora(estado='Pendiente', descripcion='Sin revisar')
        self.demora(estado='Resuelta', descripcion='Ya pasó')
        self.demora(latitud=None, longitud=None, descripcion='Sin punto')
        self.assertEqual(self.demoras(), [])

    def test_reportes_sumados_son_puntos_de_la_misma_demora(self):
        principal = self.demora()
        Alerta.objects.create(usuario=self.pasajero, ruta=self.r1, tipo='delay', descripcion='Igual',
                              estado='En_proceso', alerta_principal=principal, latitud=6.218, longitud=-75.5735)
        puntos = self.demoras()
        self.assertEqual([p['alerta'] for p in puntos], [principal.pk, principal.pk])
        self.assertIn(self.r2.pk, puntos[1]['rutas'])

    def test_ruta_afectada_en_proceso_cuenta_aunque_este_lejos(self):
        alerta = self.demora(usuario=None, empresa=self.norte, descripcion='Desvío', latitud=6.21, longitud=-75.570)
        RutaAfectada.objects.create(alerta=alerta, ruta=self.r1, estado='En_proceso')
        RutaAfectada.objects.create(alerta=alerta, ruta=self.lejos, estado='En_proceso')
        [punto] = self.demoras()
        self.assertIn(self.lejos.pk, punto['rutas'])
        self.assertEqual(sorted(punto['directas']), sorted([self.r1.pk, self.lejos.pk]))
        # El punto que marca la empresa no se redondea
        self.assertEqual((punto['lat'], punto['lng']), (6.21, -75.570))

    def test_la_pagina_del_mapa_trae_las_demoras(self):
        self.demora()
        html = self.client.get('/').content.decode()
        self.assertIn('id="demoras-data"', html)
        self.assertIn('Trancón', html)
