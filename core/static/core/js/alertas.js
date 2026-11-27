// ============================================================
// ALERTAS.JS - Centro de alertas: filtros, detalle, crear, editar e inhabilitar
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

    // Mismos colores de placa que en el mapa (la ruta usa id % 7)
    const PALETA_RUTAS = ['#087F8C', '#6B3FA0', '#B85C00', '#A82A7B', '#5C6B1E', '#7A4A2B', '#3F5B7A'];
    const TIPOS = {
        'delay': { texto: 'Demora', color: '#D4121A', tinta: '#FEFEFE' },
        'warning': { texto: 'Advertencia', color: '#F7C600', tinta: '#080707' },
        'info': { texto: 'Información', color: '#014CAB', tinta: '#FEFEFE' }
    };
    const ESTADOS = { 'En_proceso': 'En proceso' };
    // Descripción que guarda el servidor en un «Yo también lo veo» (views.TEXTO_CONFIRMACION)
    const TEXTO_CONFIRMACION = 'Confirmó que también lo ve.';

    const grilla = document.getElementById('alertsGrid');
    // Solo las alertas de la lista (y de «Mis reportes»): abren el detalle y responden a los filtros. Los avisos
    // de «Cerca de tus rutas» también son .al-tarjeta, pero no tienen id: abrirían un detalle vacío y sus
    // botones llevarían a /estadoAlerta/undefined/ (404).
    const tarjetas = Array.from(document.querySelectorAll('.al-tarjeta[data-id]'));

    // ---------- Placas de color y escalonado de entrada ----------
    function colorRuta(id) {
        return PALETA_RUTAS[Number(id) % PALETA_RUTAS.length];
    }
    // Las rutas de otras empresas solo llevan el borde de su color
    function pintarPlaca(placa) {
        const color = colorRuta(placa.dataset.rutaId);
        if (placa.classList.contains('al-placa--ajena')) placa.style.setProperty('--color-ruta', color);
        else placa.style.background = color;
    }
    document.querySelectorAll('.al-placa').forEach(pintarPlaca);
    document.querySelectorAll('.al-tarjeta').forEach(function (t, i) {
        t.style.animationDelay = Math.min(i, 11) * 50 + 'ms';
    });

    // ---------- Hora relativa ("hace 5 min") ----------
    function tiempoRelativo(fecha) {
        const seg = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000));
        if (seg < 60) return 'hace unos segundos';
        const min = Math.floor(seg / 60);
        if (min < 60) return 'hace ' + min + ' min';
        const h = Math.floor(min / 60);
        if (h < 24) return 'hace ' + h + ' h';
        const d = Math.floor(h / 24);
        if (d < 30) return 'hace ' + d + (d === 1 ? ' día' : ' días');
        return null;
    }
    function actualizarHoras() {
        document.querySelectorAll('.al-hora').forEach(function (el) {
            const fecha = new Date(el.getAttribute('datetime'));
            if (isNaN(fecha)) return;
            const texto = tiempoRelativo(fecha);
            if (texto) {
                if (!el.title) el.title = el.textContent;
                el.textContent = texto;
            }
        });
    }
    actualizarHoras();
    setInterval(actualizarHoras, 60000);

    // ---------- Filtros ----------
    const pestanas = Array.from(document.querySelectorAll('.al-pestana'));
    const mensaje = document.getElementById('alFiltroMensaje');

    // Filtro activo de cada grupo (tipo, ruta y, para la empresa, estado). "vista": publicadas o mis reportes
    const filtros = { tipo: 'all', estado: 'all', ruta: 'all', vista: 'publicas' };
    const grillasVista = Array.from(document.querySelectorAll('.al-grilla[data-vista]'));

    // Paginadores: uno por lista (publicadas y mis reportes). Cada tarjeta filtrada sigue marcada con `hidden`;
    // el paginador solo reparte las que quedan. Con la barra de acciones en lote, avisa si hay elegidas en otra página.
    let alCambiarPagina = function () {};
    const paginadores = grillasVista.map(function (grilla) {
        return LocalBusPaginador.crear({
            clave: grilla.dataset.vista === 'mios' ? 'mis-reportes' : 'alertas',
            despuesDe: grilla,
            elementos: function () { return tarjetas.filter(function (t) { return t.dataset.vista === grilla.dataset.vista; }); },
            nombres: grilla.dataset.vista === 'mios' ? ['reporte', 'reportes'] : ['alerta', 'alertas'],
            alCambiar: function () { alCambiarPagina(); }
        });
    });

    function filtrar() {
        let visibles = 0;
        let enVista = 0;
        tarjetas.forEach(function (t) {
            if (t.dataset.vista && t.dataset.vista !== filtros.vista) return;
            enVista++;
            const ver = (filtros.tipo === 'all' || t.dataset.tipo === filtros.tipo)
                && (filtros.estado === 'all' || t.dataset.estado === filtros.estado)
                && (filtros.ruta === 'all' || (t.dataset.rutas || t.dataset.rutaId).split(',').indexOf(filtros.ruta) !== -1);
            t.hidden = !ver;
            if (ver) visibles++;
        });
        paginadores.forEach(function (p) { p.actualizar(); });
        if (!mensaje) return;
        if (enVista && visibles === 0) {
            mensaje.textContent = 'No hay alertas con estos filtros por ahora. Prueba con otros.';
            mensaje.hidden = false;
        } else {
            mensaje.hidden = true;
        }
    }

    function marcarPestana(p) {
        p.parentElement.querySelectorAll('.al-pestana').forEach(function (o) {
            o.classList.toggle('activa', o === p);
            o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
        });
    }

    function cambiarVista(vista) {
        filtros.vista = vista;
        grillasVista.forEach(function (g) { g.hidden = g.dataset.vista !== vista; });
        const p = document.querySelector('.al-pestana[data-vista="' + vista + '"]');
        if (p) marcarPestana(p);
        filtrar();
    }

    pestanas.forEach(function (p) {
        const grupo = p.dataset.vista !== undefined ? 'vista' : (p.dataset.estado !== undefined ? 'estado' : 'tipo');
        p.addEventListener('click', function () {
            if (grupo === 'vista') return cambiarVista(p.dataset.vista);
            marcarPestana(p);
            filtros[grupo] = grupo === 'estado' ? p.dataset.estado : p.dataset.filter;
            filtrar();
        });
    });

    const filtroRuta = document.getElementById('filtroRuta');
    if (filtroRuta) {
        filtroRuta.addEventListener('change', function () {
            filtros.ruta = filtroRuta.value;
            filtrar();
        });
    }

    // Después de enviar un reporte se vuelve a "Mis reportes" (/alertas/?vista=mios)
    const parametrosVista = new URLSearchParams(window.location.search);
    if (parametrosVista.get('vista') === 'mios' && document.getElementById('misReportesGrid')) cambiarVista('mios');

    // Días de alertas resueltas: se recarga la lista con ese periodo
    const filtroDias = document.getElementById('filtroDias');
    if (filtroDias) {
        filtroDias.addEventListener('change', function () {
            const q = new URLSearchParams({ dias: filtroDias.value });
            if (filtros.vista === 'mios') q.set('vista', 'mios');
            window.location.href = '/alertas/?' + q.toString();
        });
    }

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    let ultimoFoco = null;

    function abrir(modal, foco) {
        ultimoFoco = document.activeElement;
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        if (foco) setTimeout(function () { foco.focus(); }, 30);
    }

    function cerrar(modal) {
        modal.classList.remove('abierto');
        modal.hidden = true;
        if (!document.querySelector('.al-modal.abierto')) document.body.style.overflow = '';
        if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
    }

    const alertModal = document.getElementById('alertModal');
    const detailModal = document.getElementById('detailModal');

    const reportModal = document.getElementById('reportModal');

    const duplicateModal = document.getElementById('duplicateModal');
    const seguirModal = document.getElementById('seguirModal');

    [alertModal, detailModal, reportModal, duplicateModal, seguirModal].filter(Boolean).forEach(function (modal) {
        // Clic fuera de la caja cierra
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
    });

    // La ventana de arriba es la última abierta (el aviso se apila sobre el formulario)
    function ventanaSuperior() {
        const abiertas = document.querySelectorAll('.al-modal.abierto');
        return abiertas.length ? abiertas[abiertas.length - 1] : null;
    }

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const abierto = ventanaSuperior();
        if (abierto) cerrar(abierto);
    });

    // Mantiene el foco dentro de la ventana abierta
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        const abierto = ventanaSuperior();
        if (!abierto) return;
        const foco = Array.from(abierto.querySelectorAll('button, select, textarea, input:not([type="hidden"]), a[href]'))
            .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!foco.length) return;
        const primero = foco[0];
        const ultimo = foco[foco.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });

    // ---------- Formulario de crear / editar ----------
    const form = document.getElementById('alertForm');
    const campoId = document.getElementById('alertId');
    const campoRuta = document.getElementById('alertRuta');
    const campoTipo = document.getElementById('alertTipo');
    const campoDescripcion = document.getElementById('alertDescripcion');
    const campoEstado = document.getElementById('alertEstado');
    const titulo = document.getElementById('modalTitle');
    const enviar = document.getElementById('modalSubmit');
    const error = document.getElementById('alertError');
    const contador = document.getElementById('alertContador');
    const textoEnviar = { crear: 'Crear alerta', editar: 'Guardar cambios' };
    let modo = 'crear';
    let enviando = false;

    function actualizarContador() {
        const n = campoDescripcion.value.length;
        const max = campoDescripcion.maxLength;
        contador.textContent = n + ' de ' + max + ' caracteres';
        contador.classList.toggle('casi', n >= max - 20);
    }
    campoDescripcion.addEventListener('input', actualizarContador);

    function limpiarErrores() {
        error.hidden = true;
        error.textContent = '';
        form.querySelectorAll('.al-campo').forEach(function (c) { c.classList.remove('con-error'); });
    }

    [campoRuta, campoTipo, campoDescripcion, campoEstado].filter(Boolean).forEach(function (c) {
        c.addEventListener('input', function () {
            c.closest('.al-campo').classList.remove('con-error');
            if (!form.querySelector('.con-error')) { error.hidden = true; error.textContent = ''; }
        });
    });

    function estadoBoton(texto) {
        if (texto) {
            enviar.classList.add('cargando');
            enviar.textContent = texto;
            enviar.setAttribute('aria-disabled', 'true');
        } else {
            enviar.classList.remove('cargando');
            enviar.textContent = textoEnviar[modo];
            enviar.removeAttribute('aria-disabled');
        }
    }

    // ---------- Ubicación del pasajero y aviso de "ya hay una alerta igual cerca" ----------
    const campoLat = document.getElementById('alertLatitud');
    const campoLng = document.getElementById('alertLongitud');
    const textoUbicacion = document.getElementById('alertUbicacion');
    const avisoTexto = document.getElementById('duplicateTexto');
    const avisoDescripcion = document.getElementById('duplicateDescripcion');
    let pedidoCercana = 0;

    // Rutas del formulario: las que pasan a 500 m de quien reporta (si no hay ubicación, todas)
    const campoRutaAyuda = document.getElementById('alertRutaAyuda');
    const opcionesRutaTodas = campoRuta.innerHTML;
    let rutaFijada = null;   // ruta fijada en el mapa: aparece preseleccionada

    // Nombres de todas las rutas, guardados al cargar: el selector cambia de opciones mientras se busca la ubicación
    const nombresRuta = {};
    Array.from(campoRuta.options || []).forEach(function (o) { if (o.value) nombresRuta[o.value] = o.textContent; });
    document.querySelectorAll('#alertRutasLista input[name="rutas"]').forEach(function (c) {
        nombresRuta[c.value] = c.dataset.nombre;
    });

    function nombreDeRuta(id) {
        return nombresRuta[String(id)] || null;
    }

    // Mientras se busca la ubicación el selector queda inhabilitado: no se puede elegir una ruta que luego cambie
    function bloquearRutas() {
        campoRuta.innerHTML = '<option value="">Buscando rutas cerca de ti…</option>';
        campoRuta.disabled = true;
        if (campoRutaAyuda) campoRutaAyuda.textContent = 'Estamos buscando las rutas que pasan cerca de ti.';
    }

    function restaurarRutas() {
        campoRuta.disabled = false;
        campoRuta.innerHTML = opcionesRutaTodas;
        if (campoRutaAyuda) campoRutaAyuda.textContent = '';
        if (rutaFijada && nombreDeRuta(rutaFijada)) campoRuta.value = String(rutaFijada);
    }

    function armarRutasCercanas(lista) {
        const fijadaTexto = rutaFijada ? nombreDeRuta(rutaFijada) : null;
        campoRuta.textContent = '';
        campoRuta.disabled = false;
        function opcion(valor, texto) {
            const o = document.createElement('option');
            o.value = valor;
            o.textContent = texto;
            campoRuta.appendChild(o);
        }
        opcion('', lista.length ? 'Elige una ruta' : 'No hay rutas a 500 m de ti');
        lista.forEach(function (r) { opcion(String(r.id), r.codigo + ' · ' + r.nombre); });
        // La ruta fijada en el mapa solo se preselecciona si está dentro del rango
        const fijadaEnRango = rutaFijada && lista.some(function (r) { return r.id === Number(rutaFijada); });
        if (fijadaEnRango) campoRuta.value = String(rutaFijada);
        if (modo === 'editar') {
            campoRutaAyuda.textContent = 'Estas son las rutas que pasan a 500 metros o menos de donde hiciste el reporte.';
        } else if (!lista.length) {
            campoRutaAyuda.textContent = 'Ninguna ruta pasa a 500 m o menos de ti. Acércate al trazado de una ruta para reportarla.';
        } else if (rutaFijada && !fijadaEnRango) {
            campoRutaAyuda.textContent = 'La ruta que fijaste (' + (fijadaTexto || 'en el mapa') + ') no pasa a 500 m de ti. Elige una de las que sí.';
        } else {
            campoRutaAyuda.textContent = 'Estas son las rutas que pasan a 500 metros o menos de tu ubicación.';
        }
    }

    function cargarRutasCercanas() {
        const q = new URLSearchParams({ latitud: campoLat.value, longitud: campoLng.value });
        fetch('/api/alertas/rutas-cercanas/?' + q.toString(), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { armarRutasCercanas(d.rutas || []); buscarCercana(); })
            .catch(restaurarRutas);
    }

    function pedirUbicacion() {
        if (!campoLat) return;
        campoLat.value = '';
        campoLng.value = '';
        bloquearRutas();
        if (!navigator.geolocation) {
            textoUbicacion.textContent = 'Tu navegador no comparte la ubicación: la alerta se envía sin ella.';
            restaurarRutas();
            return;
        }
        textoUbicacion.textContent = 'Buscando tu ubicación…';
        navigator.geolocation.getCurrentPosition(function (pos) {
            campoLat.value = pos.coords.latitude.toFixed(6);
            campoLng.value = pos.coords.longitude.toFixed(6);
            textoUbicacion.textContent = 'Ubicación lista: se enviará con tu alerta y sirve para detectar si ya la reportaron cerca.';
            cargarRutasCercanas();
        }, function () {
            textoUbicacion.textContent = 'No pudimos ver tu ubicación. Puedes enviar la alerta igual, pero sin ella no sabremos si ya la reportaron cerca.';
            restaurarRutas();
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    }

    // Sin ubicación también se pregunta: las alertas de la empresa valen para toda la ruta
    function buscarCercana() {
        if (!campoLat) return;
        if (!campoRuta.value || !campoTipo.value || modo !== 'crear' || campoRuta.disabled) return;
        const id = ++pedidoCercana;
        const q = new URLSearchParams({ ruta: campoRuta.value, tipo: campoTipo.value });
        if (campoLat.value) { q.set('latitud', campoLat.value); q.set('longitud', campoLng.value); }
        fetch('/api/alertas/cercana/?' + q.toString(), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (id !== pedidoCercana) return;
                if (!d.existe || alertModal.hidden) return;
                mostrarRepetida(d);
            })
            .catch(function () { /* sin aviso: el reporte se puede enviar igual */ });
    }

    function mostrarRepetida(d) {
        const donde = d.de_empresa ? 'La empresa ya publicó una alerta de este mismo tipo para esta ruta'
            : 'Ya hay una alerta de este mismo tipo para esta ruta a menos de 700 m de ti';
        const cuantos = d.reportes > 1 ? ' La reportaron ' + d.reportes + ' personas.' : '';
        avisoTexto.textContent = donde + (d.publica ? '.' : ', y la empresa aún la está revisando.') + cuantos;
        const publica = d.publica && d.descripcion;
        avisoDescripcion.hidden = !publica;
        avisoDescripcion.textContent = publica ? '«' + d.descripcion + '»' : '';

        // Datos con los que el servidor vuelve a buscar la alerta al confirmar
        document.getElementById('duplicateRuta').value = campoRuta.value;
        document.getElementById('duplicateTipo').value = campoTipo.value;
        document.getElementById('duplicateLat').value = campoLat.value;
        document.getElementById('duplicateLng').value = campoLng.value;

        const sumarse = document.getElementById('duplicateSumarse');
        const nota = document.getElementById('duplicateNota');
        sumarse.hidden = !!d.ya_reportaste;
        nota.textContent = d.ya_reportaste
            ? 'Ya reportaste este problema: tu reporte sigue contando. No hace falta enviarlo otra vez.'
            : 'Si es el mismo problema, confírmalo con un clic: cuenta igual que un reporte y la empresa lo ve antes.';
        sumarse.classList.remove('cargando');
        sumarse.removeAttribute('aria-disabled');
        sumarse.textContent = 'Yo también lo veo';
        abrir(duplicateModal, d.ya_reportaste ? document.getElementById('duplicateCancel') : sumarse);
    }

    const duplicateForm = document.getElementById('duplicateForm');
    if (duplicateForm) {
        duplicateForm.addEventListener('submit', function (e) {
            const b = document.getElementById('duplicateSumarse');
            if (b.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
            b.classList.add('cargando');
            b.textContent = 'Enviando…';
            b.setAttribute('aria-disabled', 'true');
        });
    }

    if (duplicateModal) {
        document.getElementById('duplicateClose').addEventListener('click', function () { cerrar(duplicateModal); });
        document.getElementById('duplicateOk').addEventListener('click', function () { cerrar(duplicateModal); });
        document.getElementById('duplicateCancel').addEventListener('click', function () {
            // Se cierran los dos a la vez; el foco vuelve al botón que abrió el formulario
            const foco = ultimoFoco;
            [duplicateModal, alertModal].forEach(function (m) {
                m.classList.remove('abierto');
                m.hidden = true;
            });
            document.body.style.overflow = '';
            if (foco && document.contains(foco) && foco.offsetParent !== null) foco.focus();
        });
    }
    if (campoLat) {
        campoRuta.addEventListener('change', buscarCercana);
        campoTipo.addEventListener('change', buscarCercana);
    }

    // Empresa: la duración solo aplica a una alerta En proceso
    const campoDuracion = document.getElementById('alertDuracion');
    const cajaDuracion = document.getElementById('alertDuracionCampo');
    const opcionMantener = document.getElementById('alertDuracionMantener');
    // ---------- Empresa: rutas afectadas, cada una con su estado ----------
    const listaRutas = document.getElementById('alertRutasLista');
    const cuentaRutas = document.getElementById('alertRutasCuenta');
    const casillasRutas = listaRutas ? Array.from(listaRutas.querySelectorAll('input[name="rutas"]')) : [];

    function estadoDeFila(casilla) {
        return casilla.closest('.al-ruta-fila').querySelector('.al-ruta-estado');
    }

    function rutasMarcadas() {
        return casillasRutas.filter(function (c) { return c.checked; });
    }

    // El estado solo se elige en las rutas marcadas; el texto dice cuántas van y cuántas están resueltas
    function actualizarRutas() {
        if (!listaRutas) return;
        casillasRutas.forEach(function (c) {
            estadoDeFila(c).disabled = !c.checked;
            c.closest('.al-ruta-fila').classList.toggle('marcada', c.checked);
        });
        // Solo se ven (y se pueden marcar) las rutas a 500 m del punto del mapa
        const enRango = rutasVisibles().length;
        listaRutas.hidden = !enRango;
        document.getElementById('alertRutasTodas').disabled = !enRango;
        document.getElementById('alertRutasNinguna').disabled = !enRango;
        const marcadas = rutasMarcadas();
        const resueltas = marcadas.filter(function (c) { return estadoDeFila(c).value === 'Resuelta'; }).length;
        cuentaRutas.textContent = idsEnRango === null
            ? (buscandoRutas ? 'Buscando rutas a 500 m del punto…' : 'Marca el punto en el mapa para ver las rutas')
            : !enRango ? 'Ninguna de tus rutas pasa a 500 m de ese punto'
            : !marcadas.length ? enRango + ' a 500 m del punto, ninguna elegida'
            : marcadas.length + ' de ' + enRango + ' elegida' + (marcadas.length === 1 ? '' : 's')
              + (resueltas ? ' · ' + resueltas + ' resuelta' + (resueltas === 1 ? '' : 's') : '');
        if (marcadas.length) document.getElementById('alertRutasCampo').classList.remove('con-error');
        actualizarDuracion();
    }

    // estados: { idRuta: 'En_proceso' | 'Resuelta' }; las que no están quedan sin marcar
    function marcarRutas(estados) {
        casillasRutas.forEach(function (c) {
            const estado = estados[c.value];
            c.checked = !!estado;
            estadoDeFila(c).value = estado || 'En_proceso';
        });
        actualizarRutas();
    }

    if (listaRutas) {
        listaRutas.addEventListener('change', actualizarRutas);
        document.getElementById('alertRutasTodas').addEventListener('click', function () {
            rutasVisibles().forEach(function (c) { c.checked = true; });
            actualizarRutas();
        });
        document.getElementById('alertRutasNinguna').addEventListener('click', function () {
            casillasRutas.forEach(function (c) { c.checked = false; });
            actualizarRutas();
        });
    }

    // ---------- Empresa: punto donde ocurre y rutas a 500 m ----------
    const campoPuntoLat = document.getElementById('alertPuntoLat');
    const campoPuntoLng = document.getElementById('alertPuntoLng');
    const ayudaPunto = document.getElementById('alertPuntoAyuda');
    const botonCentro = document.getElementById('alertPuntoCentro');
    const CENTRO_MEDELLIN = [6.2442, -75.5812];
    let idsEnRango = null;      // ids (texto) de las rutas a 500 m del punto; null: aún no se sabe
    let buscandoRutas = false;
    let pedidoPunto = 0;
    let puntoFijo = false;      // el reporte de un pasajero conserva donde se reportó
    let mapaPunto = null;
    let capaPunto = null;

    function rutasVisibles() {
        return casillasRutas.filter(function (c) { return !c.closest('.al-ruta-fila').hidden; });
    }

    // ids null: se ocultan todas sin desmarcar (las marcadas se conservan si luego quedan en rango)
    function filtrarRutas(ids) {
        idsEnRango = ids;
        casillasRutas.forEach(function (c) {
            const dentro = !!ids && ids.indexOf(c.value) !== -1;
            c.closest('.al-ruta-fila').hidden = !dentro;
            if (ids && !dentro) c.checked = false;
        });
        actualizarRutas();
    }

    function pintarPunto() {
        if (!mapaPunto) return;
        if (capaPunto) { capaPunto.remove(); capaPunto = null; }
        if (!campoPuntoLat.value) { mapaPunto.setView(CENTRO_MEDELLIN, 13); return; }
        const punto = L.latLng(Number(campoPuntoLat.value), Number(campoPuntoLng.value));
        const circulo = L.circle(punto, { radius: 500, color: '#014CAB', weight: 1, fillOpacity: 0.08, interactive: false });
        const marca = L.circleMarker(punto, { radius: 8, color: '#FEFEFE', weight: 2, fillColor: '#014CAB', fillOpacity: 1, interactive: false });
        capaPunto = L.featureGroup([circulo, marca]).addTo(mapaPunto);
        mapaPunto.fitBounds(punto.toBounds(1100));
    }

    function buscarRutasDelPunto() {
        const pedido = ++pedidoPunto;
        buscandoRutas = true;
        filtrarRutas(null);
        const q = new URLSearchParams({ latitud: campoPuntoLat.value, longitud: campoPuntoLng.value });
        fetch('/api/alertas/rutas-cercanas/?' + q.toString(), { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (d) {
                if (pedido !== pedidoPunto) return;
                buscandoRutas = false;
                filtrarRutas(d.rutas.map(function (r) { return String(r.id); }));
            })
            .catch(function () {
                if (pedido !== pedidoPunto) return;
                buscandoRutas = false;
                actualizarRutas();
                ayudaPunto.textContent = 'No pudimos buscar las rutas. Revisa tu conexión y vuelve a marcar el punto.';
            });
    }

    function ponerPunto(lat, lng) {
        campoPuntoLat.value = Number(lat).toFixed(6);
        campoPuntoLng.value = Number(lng).toFixed(6);
        document.getElementById('alertPuntoCampo').classList.remove('con-error');
        ayudaPunto.textContent = puntoFijo
            ? 'Es el punto donde el pasajero hizo el reporte. Abajo salen tus rutas que pasan a 500 m.'
            : 'Punto marcado. Toca otro lugar del mapa si quieres cambiarlo.';
        pintarPunto();
        buscarRutasDelPunto();
    }

    // Al abrir el formulario: con el punto que ya tiene la alerta, o vacío para que la empresa lo marque
    function prepararPunto(lat, lng, fijo) {
        if (!campoPuntoLat) return;
        puntoFijo = !!(fijo && lat);
        botonCentro.hidden = puntoFijo;
        campoPuntoLat.value = '';
        campoPuntoLng.value = '';
        pedidoPunto++;
        buscandoRutas = false;
        if (lat) { ponerPunto(lat, lng); return; }
        ayudaPunto.textContent = 'Toca el mapa donde ocurre: verás tus rutas que pasan a 500 m de ese punto.';
        pintarPunto();
        filtrarRutas(null);
    }

    // El mapa se crea y se mide cuando la ventana ya es visible
    function mostrarMapaPunto() {
        if (!campoPuntoLat) return;
        if (typeof L === 'undefined') {
            ayudaPunto.textContent = 'No pudimos cargar el mapa. Recarga la página para crear o editar alertas.';
            return;
        }
        if (!mapaPunto) {
            mapaPunto = L.map('alertMapa').setView(CENTRO_MEDELLIN, 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19, attribution: '&copy; OpenStreetMap'
            }).addTo(mapaPunto);
            mapaPunto.on('click', function (e) {
                const p = e.latlng.wrap();
                if (!puntoFijo) ponerPunto(p.lat, p.lng);
            });
        }
        setTimeout(function () { mapaPunto.invalidateSize(); pintarPunto(); }, 60);
    }

    if (botonCentro) {
        botonCentro.addEventListener('click', function () {
            if (!mapaPunto || puntoFijo) return;
            const c = mapaPunto.getCenter().wrap();
            ponerPunto(c.lat, c.lng);
        });
    }

    // La duración solo aplica si la alerta queda en proceso en alguna ruta
    function actualizarDuracion() {
        if (!cajaDuracion) return;
        const enProceso = listaRutas
            ? !rutasMarcadas().length || rutasMarcadas().some(function (c) { return estadoDeFila(c).value === 'En_proceso'; })
            : !campoEstado || campoEstado.value === 'En_proceso';
        cajaDuracion.hidden = !enProceso;
        campoDuracion.disabled = !enProceso;
    }
    if (campoEstado) campoEstado.addEventListener('change', actualizarDuracion);

    // Rutas marcadas al abrir el formulario de una alerta existente: las que la empresa ya eligió con su
    // estado; si aún no eligió (reporte de pasajero sin revisar), la reportada y sus rutas que pasan cerca
    function estadosDeTarjeta(tarjeta) {
        let datos = null;
        try { datos = JSON.parse(tarjeta.dataset.afectadas || 'null'); } catch (e) { datos = null; }
        const estados = {};
        if (datos && datos.elegidas) {
            datos.rutas.forEach(function (r) { estados[r.id] = r.estado; });
        } else {
            estados[tarjeta.dataset.rutaId] = 'En_proceso';
            if (datos) datos.sugeridas.forEach(function (r) { estados[r.id] = 'En_proceso'; });
        }
        return estados;
    }

    function abrirFormulario(nuevoModo, tarjeta, previo) {
        modo = nuevoModo;
        rutaFijada = previo && previo.ruta ? previo.ruta : null;
        if (campoLat) { campoRuta.disabled = false; campoRuta.innerHTML = opcionesRutaTodas; }
        form.reset();
        limpiarErrores();
        enviando = false;
        if (modo === 'editar') {
            campoId.value = tarjeta.dataset.id;
            campoRuta.value = tarjeta.dataset.rutaId;
            campoTipo.value = tarjeta.dataset.tipo;
            campoDescripcion.value = tarjeta.dataset.descripcion;
            if (listaRutas) {
                marcarRutas(estadosDeTarjeta(tarjeta));
                prepararPunto(tarjeta.dataset.lat, tarjeta.dataset.lng, tarjeta.dataset.dePasajero === '1');
            }
            if (opcionMantener) {
                // Una alerta ya publicada conserva su duración salvo que la empresa elija otra
                const publicada = tarjeta.dataset.estado === 'En_proceso';
                opcionMantener.hidden = !publicada;
                opcionMantener.disabled = !publicada;
                opcionMantener.textContent = tarjeta.dataset.vence ? 'Dejarla hasta las ' + tarjeta.dataset.vence
                    : 'Dejarla hasta que la marque resuelta';
                campoDuracion.value = publicada ? 'mantener' : '';
            }
            titulo.textContent = 'Editar alerta';
            form.action = '/editarAlerta/' + tarjeta.dataset.id + '/';
        } else {
            campoId.value = '';
            if (opcionMantener) { opcionMantener.hidden = true; opcionMantener.disabled = true; campoDuracion.value = ''; }
            titulo.textContent = 'Crear alerta';
            form.action = '/crearAlerta/';
            if (listaRutas) {
                const estados = {};
                if (previo && previo.ruta) estados[previo.ruta] = 'En_proceso';
                marcarRutas(estados);
                // Desde un aviso «Cerca de tus rutas» se propone el punto donde se reportó
                prepararPunto(previo && previo.lat, previo && previo.lng, false);
            }
            if (previo) {
                // Viene del mapa (ruta fijada) o de un aviso "Cerca de tus rutas"
                if (previo.ruta && nombreDeRuta(previo.ruta)) campoRuta.value = String(previo.ruta);
                if (previo.tipo) campoTipo.value = previo.tipo;
                if (previo.descripcion) campoDescripcion.value = previo.descripcion;
            }
        }
        estadoBoton(null);
        actualizarContador();
        actualizarDuracion();
        if (campoLat) {
            // Al editar no se cambia el punto donde se reportó
            textoUbicacion.hidden = modo !== 'crear';
            if (modo === 'crear') pedirUbicacion();
        }
        // El pasajero que edita su reporte elige entre las rutas a 500 m de donde lo hizo
        if (campoLat && modo === 'editar' && tarjeta.dataset.lat) {
            campoLat.value = tarjeta.dataset.lat;
            campoLng.value = tarjeta.dataset.lng;
            rutaFijada = tarjeta.dataset.rutaId;
            bloquearRutas();
            cargarRutasCercanas();
        }
        abrir(alertModal, listaRutas ? document.getElementById('alertMapa') : campoRuta);
        mostrarMapaPunto();
    }

    // ---------- Descargar reporte con filtros y orden ----------
    const btnReporte = document.getElementById('btnReporte');
    if (btnReporte && reportModal) {
        const formReporte = document.getElementById('reportForm');
        const errorReporte = document.getElementById('reportError');
        const modoFechas = document.getElementById('reportModoFechas');
        const bloqueFechas = document.getElementById('reportFechas');
        const campoDesde = document.getElementById('reportDesde');
        const campoHasta = document.getElementById('reportHasta');
        const cajaHasta = document.getElementById('reportHastaCampo');
        const etiquetaDesde = document.getElementById('reportDesdeEtiqueta');
        const todasRutas = document.getElementById('reportRutasTodas');
        const casillasRuta = Array.from(formReporte.querySelectorAll('input[name="ruta"]'));
        const autor = document.getElementById('reportAutor');
        const orden = document.getElementById('reportOrden');
        const ordenAutor = document.getElementById('reportOrdenAutor');
        const sentido = document.getElementById('reportSentido');
        const ayudaOrden = document.getElementById('reportAyudaOrden');

        // Solo se muestran y se envían las fechas del modo elegido
        function actualizarFechas() {
            const modo = modoFechas.value;
            bloqueFechas.hidden = modo === 'todas';
            cajaHasta.hidden = modo !== 'rango';
            campoDesde.disabled = modo === 'todas';
            campoHasta.disabled = modo !== 'rango';
            etiquetaDesde.textContent = modo === 'rango' ? 'Desde' : 'Desde esta fecha en adelante';
            errorReporte.hidden = true;
        }
        modoFechas.addEventListener('change', actualizarFechas);
        // "Desde" no puede pasar de "Hasta" ni al revés
        campoDesde.addEventListener('change', function () { campoHasta.min = campoDesde.value; });
        campoHasta.addEventListener('change', function () { campoDesde.max = campoHasta.value; });

        // "Todas las rutas" marca o desmarca todas; queda a medias si solo hay algunas marcadas
        function actualizarTodasRutas() {
            const marcadas = casillasRuta.filter(function (c) { return c.checked; }).length;
            todasRutas.checked = marcadas === casillasRuta.length;
            todasRutas.indeterminate = marcadas > 0 && marcadas < casillasRuta.length;
        }
        todasRutas.addEventListener('change', function () {
            casillasRuta.forEach(function (c) { c.checked = todasRutas.checked; });
            todasRutas.indeterminate = false;
        });
        casillasRuta.forEach(function (c) { c.addEventListener('change', actualizarTodasRutas); });

        // Ordenar por autor solo tiene sentido con todas las alertas (las de la empresa tienen un solo autor)
        const EXPLICA_ORDEN = {
            fecha: { desc: 'La más reciente primero.', asc: 'La más antigua primero.' },
            tipo: { desc: 'Información, Demora y Advertencia.', asc: 'Advertencia, Demora e Información.' },
            estado: { desc: 'Resueltas, en proceso y pendientes.', asc: 'Pendientes, en proceso y resueltas.' },
            ruta: { desc: 'Del código mayor al menor.', asc: 'Del código menor al mayor (R01, R02…).' },
            autor: { desc: 'De la Z a la A.', asc: 'De la A a la Z.' }
        };
        function actualizarOrden() {
            const soloEmpresa = autor.value === 'empresa';
            ordenAutor.disabled = soloEmpresa;
            ordenAutor.hidden = soloEmpresa;
            if (soloEmpresa && orden.value === 'autor') orden.value = 'fecha';
            let texto = EXPLICA_ORDEN[orden.value][sentido.value];
            if (orden.value !== 'fecha') texto += ' Dentro de cada grupo, la más reciente primero.';
            ayudaOrden.textContent = texto;
        }
        [autor, orden, sentido].forEach(function (s) { s.addEventListener('change', actualizarOrden); });

        btnReporte.addEventListener('click', function () {
            actualizarFechas();
            actualizarOrden();
            abrir(reportModal, reportModal.querySelector('input'));
        });
        document.getElementById('reportClose').addEventListener('click', function () { cerrar(reportModal); });
        document.getElementById('reportCancel').addEventListener('click', function () { cerrar(reportModal); });

        function falloReporte(texto, campo) {
            errorReporte.textContent = texto;
            errorReporte.hidden = false;
            campo.focus();
        }
        formReporte.addEventListener('submit', function (e) {
            // Cada grupo necesita al menos una opción marcada
            const grupos = [
                ['tipo', 'Marca al menos un tipo de alerta.'],
                ['estado', 'Marca al menos un estado.'],
                ['ruta', 'Marca al menos una ruta.']
            ];
            for (const [nombre, mensaje] of grupos) {
                const casillas = formReporte.querySelectorAll('input[name="' + nombre + '"]');
                if (casillas.length && !formReporte.querySelector('input[name="' + nombre + '"]:checked')) {
                    e.preventDefault();
                    return falloReporte(mensaje, casillas[0]);
                }
            }
            const modo = modoFechas.value;
            if (modo !== 'todas' && !campoDesde.value) {
                e.preventDefault();
                return falloReporte('Elige la fecha desde la que quieres el reporte.', campoDesde);
            }
            if (modo === 'rango') {
                if (!campoHasta.value) {
                    e.preventDefault();
                    return falloReporte('Elige la fecha hasta la que quieres el reporte.', campoHasta);
                }
                if (campoDesde.value > campoHasta.value) {
                    e.preventDefault();
                    return falloReporte('La fecha "Desde" no puede ser posterior a la fecha "Hasta".', campoDesde);
                }
            }
            errorReporte.hidden = true;
            // El PDF se abre en otra pestaña: se cierra la ventana y queda lista para otro reporte
            setTimeout(function () { cerrar(reportModal); }, 50);
        });
    }

    const btnCrear = document.getElementById('btnCreateAlert');
    if (btnCrear) btnCrear.addEventListener('click', function () { abrirFormulario('crear'); });

    // Pasajero: rutas de las que quiere recibir avisos
    const btnSeguir = document.getElementById('btnSeguir');
    if (btnSeguir && seguirModal) {
        btnSeguir.addEventListener('click', function () { abrir(seguirModal, seguirModal.querySelector('input')); });
        document.getElementById('seguirClose').addEventListener('click', function () { cerrar(seguirModal); });
        document.getElementById('seguirCancel').addEventListener('click', function () { cerrar(seguirModal); });
    }

    // Empresa: crear su propia alerta a partir de un aviso "Cerca de tus rutas"
    document.querySelectorAll('.al-cercana-crear').forEach(function (b) {
        b.addEventListener('click', function () {
            abrirFormulario('crear', null, { ruta: b.dataset.rutaId, tipo: b.dataset.tipo, descripcion: b.dataset.descripcion,
                lat: b.dataset.lat, lng: b.dataset.lng });
        });
    });

    // Llega desde el botón "Reportar" del mapa: /alertas/?reportar=1&ruta=<ruta fijada>
    const parametros = new URLSearchParams(window.location.search);
    if (parametros.get('reportar') === '1' && btnCrear) {
        const fijada = /^\d+$/.test(parametros.get('ruta') || '') ? parametros.get('ruta') : null;
        history.replaceState(null, '', window.location.pathname);
        abrirFormulario('crear', null, { ruta: fijada });
    }
    document.getElementById('modalClose').addEventListener('click', function () { cerrar(alertModal); });
    document.getElementById('modalCancel').addEventListener('click', function () { cerrar(alertModal); });

    function fallo(texto, campo) {
        error.textContent = texto;
        error.hidden = false;
        campo.closest('.al-campo').classList.add('con-error');
        campo.focus();
    }

    form.addEventListener('submit', function (e) {
        if (enviando) { e.preventDefault(); return; }
        limpiarErrores();
        if (listaRutas) {
            const marcadas = rutasMarcadas();
            const mapa = document.getElementById('alertMapa');
            if (!campoPuntoLat.value) { e.preventDefault(); return fallo('Marca en el mapa el punto donde ocurre.', mapa); }
            if (idsEnRango === null) {
                e.preventDefault();
                return fallo(buscandoRutas ? 'Espera a que carguen las rutas.' : 'No cargaron las rutas: marca el punto otra vez.', mapa);
            }
            if (!marcadas.length) {
                e.preventDefault();
                const visibles = rutasVisibles();
                return visibles.length ? fallo('Marca al menos una ruta afectada.', visibles[0])
                    : fallo('Ninguna de tus rutas pasa por ahí: marca otro punto.', mapa);
            }
            const sigue = marcadas.some(function (c) { return c.value === campoRuta.value; });
            if (!sigue) {
                const enProceso = marcadas.filter(function (c) { return estadoDeFila(c).value === 'En_proceso'; });
                campoRuta.value = (enProceso[0] || marcadas[0]).value;
            }
        } else if (!campoRuta.value) { e.preventDefault(); return fallo('Elige la ruta a la que se refiere la alerta.', campoRuta); }
        if (!campoTipo.value) { e.preventDefault(); return fallo('Elige el tipo de alerta.', campoTipo); }
        if (!campoDescripcion.value.trim()) { e.preventDefault(); return fallo('Escribe la descripción: cuenta qué pasa y qué deben hacer los pasajeros.', campoDescripcion); }
        if (campoEstado && !campoEstado.value) { e.preventDefault(); return fallo('Elige si la alerta está en proceso o resuelta.', campoEstado); }
        enviando = true;
        estadoBoton('Guardando…');
    });

    // Si se vuelve con el botón del navegador, el botón no debe quedar "guardando"
    window.addEventListener('pageshow', function () { enviando = false; estadoBoton(null); });

    // ---------- Detalle ----------
    const detalleRuta = document.getElementById('detailRuta');
    const detalleTipo = document.getElementById('detailTipo');
    const detalleDescripcion = document.getElementById('detailDescripcion');
    const detalleEstado = document.getElementById('detailEstado');
    const detalleFecha = document.getElementById('detailFecha');
    const detalleAcciones = document.getElementById('detailAcciones');
    const btnEditar = document.getElementById('detailEdit');
    const btnInhabilitar = document.getElementById('detailDelete');
    const confirma = document.getElementById('detailConfirma');
    let seleccionada = null;

    const bloqueRelacionados = document.getElementById('detailRelacionados');
    const listaRelacionados = document.getElementById('detailRelacionadosLista');
    let mapa = null;
    let capaPuntos = null;

    function pintarRelacionados(tarjeta) {
        if (!bloqueRelacionados) return;
        let puntos = [];
        try { puntos = JSON.parse(tarjeta.dataset.puntos || '[]'); } catch (e) { puntos = []; }
        // Sin ningún punto con ubicación no hay nada que mostrar
        bloqueRelacionados.hidden = puntos.length === 0;
        listaRelacionados.textContent = '';
        if (!puntos.length) return;

        // El punto de una alerta que creó la empresa no es un reporte de pasajero
        const soloPunto = puntos.length === 1 && puntos[0].principal && tarjeta.dataset.dePasajero !== '1';
        bloqueRelacionados.querySelector('h3').textContent = soloPunto ? 'Dónde ocurre' : 'Reportes relacionados';
        puntos.forEach(function (p, i) {
            const li = document.createElement('li');
            li.textContent = soloPunto ? 'Marcado por ' + p.autor
                : (p.principal ? 'Reporte original · ' : 'Reporte ' + i + ' · ') + p.autor + ': ' + p.descripcion;
            const hora = document.createElement('small');
            hora.textContent = p.fecha;
            li.appendChild(hora);
            listaRelacionados.appendChild(li);
        });

        if (typeof L === 'undefined') return;
        const caja = document.getElementById('detailMapa');
        if (!mapa) {
            mapa = L.map(caja);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19, attribution: '&copy; OpenStreetMap'
            }).addTo(mapa);
        }
        if (capaPuntos) capaPuntos.remove();
        capaPuntos = L.featureGroup().addTo(mapa);
        puntos.forEach(function (p, i) {
            // Original en azul y los sumados en rojo; el texto dice cuál es cuál
            const color = p.principal ? '#014CAB' : '#D4121A';
            L.circleMarker([p.lat, p.lng], { radius: 9, color: '#FEFEFE', weight: 2, fillColor: color, fillOpacity: 1 })
                .bindTooltip((p.principal ? 'Original' : 'Reporte ' + i) + ' · ' + p.autor)
                .addTo(capaPuntos);
        });
        // El mapa se mide cuando la ventana ya es visible
        setTimeout(function () {
            mapa.invalidateSize();
            const b = capaPuntos.getBounds();
            if (puntos.length === 1) mapa.setView(b.getCenter(), 16);
            else mapa.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
        }, 60);
    }

    // Empresa: rutas que pasan a 500 m del punto del reporte (las suyas y las de otras empresas)
    const filaAfectadas = document.getElementById('detailAfectadasFila');
    let detalleEditable = false;
    const detalleAfectadas = document.getElementById('detailAfectadas');

    function placaMini(r, ajena) {
        const placa = document.createElement('span');
        placa.className = 'al-placa al-placa--mini' + (ajena ? ' al-placa--ajena' : '');
        placa.dataset.rutaId = r.id;
        placa.textContent = r.codigo;
        placa.title = r.nombre + (r.empresa ? ' · ' + r.empresa : '');
        pintarPlaca(placa);
        return placa;
    }

    function lineaRutas(texto, rutas, ajenas) {
        const p = document.createElement('p');
        p.append(texto + ' ');
        rutas.forEach(function (r) { p.append(placaMini(r, ajenas)); });
        return p;
    }

    function pintarAfectadas(json) {
        if (!filaAfectadas) return;
        let datos = null;
        try { datos = JSON.parse(json || 'null'); } catch (e) { datos = null; }
        filaAfectadas.hidden = !datos;
        if (!datos) return;
        detalleAfectadas.textContent = '';
        detalleAfectadas.className = 'al-detalle-rutas';
        // Rutas afectadas con su estado (las resueltas atenuadas)
        const enProceso = datos.rutas.filter(function (r) { return r.estado !== 'Resuelta'; });
        const resueltas = datos.rutas.filter(function (r) { return r.estado === 'Resuelta'; });
        if (!datos.elegidas) {
            detalleAfectadas.append(lineaRutas('Reportada en:', datos.rutas, false));
        } else {
            if (enProceso.length) detalleAfectadas.append(lineaRutas('En proceso:', enProceso, false));
            if (resueltas.length) {
                const linea = lineaRutas('Resueltas:', resueltas, false);
                linea.querySelectorAll('.al-placa').forEach(function (p) { p.classList.add('al-placa--resuelta'); });
                detalleAfectadas.append(linea);
            }
        }
        if (datos.sugeridas.length) detalleAfectadas.append(lineaRutas('Tus rutas que pasan cerca:', datos.sugeridas, false));
        if (datos.ajenas.length) {
            detalleAfectadas.append(lineaRutas('De otras empresas cerca:', datos.ajenas, true));
            const nota = document.createElement('p');
            nota.className = 'al-afectadas-nota';
            nota.textContent = datos.avisaOtras
                ? 'Es una demora: esas empresas reciben un aviso en «Cerca de tus rutas».'
                : 'Solo las demoras se avisan a las otras empresas.';
            detalleAfectadas.append(nota);
        }
        const ayuda = document.createElement('p');
        ayuda.className = 'al-afectadas-nota';
        ayuda.textContent = 'Con «Editar» eliges las rutas afectadas y el estado de cada una.';
        if (detalleEditable) detalleAfectadas.append(ayuda);
    }

    function abrirDetalle(tarjeta) {
        if (!tarjeta.dataset.id) return;
        seleccionada = tarjeta;
        const d = tarjeta.dataset;
        const tipo = TIPOS[d.tipo] || { texto: d.tipo, color: '#014CAB', tinta: '#FEFEFE' };

        detalleRuta.textContent = d.codigo + ' · ' + d.ruta;
        detalleTipo.textContent = tipo.texto;
        detalleTipo.style.setProperty('--tipo', tipo.color);
        detalleTipo.style.color = tipo.tinta;
        detalleDescripcion.textContent = d.sumada && d.descripcion === TEXTO_CONFIRMACION
            ? 'Confirmaste esta alerta: «' + d.sumada + '»' : d.descripcion;
        detalleEstado.textContent = d.motivo ? 'Descartada' : (d.estado === 'Cancelada' ? 'Inhabilitada' : (ESTADOS[d.estado] || d.estado));
        detalleFecha.textContent = d.fecha;

        // Hasta cuándo sigue publicada (si la empresa le puso duración)
        const vence = document.getElementById('detailVence');
        if (vence) {
            vence.hidden = !(d.vence && d.estado === 'En_proceso');
            vence.textContent = 'Vigente hasta las ' + d.vence + '. Después queda resuelta sola.';
        }

        // Editar e inhabilitar solo para quien creó la alerta (mientras esté pendiente) o la empresa dueña de
        // la ruta (el servidor también lo valida)
        const editable = d.editable === '1';
        detalleAcciones.hidden = !editable;
        confirma.hidden = true;
        // La empresa "descarta" el reporte de un pasajero (con motivo); lo demás se "inhabilita"
        const descartaReporte = !!document.getElementById('detailMotivoCampo') && d.dePasajero === '1';
        btnInhabilitar.textContent = descartaReporte ? 'Descartar reporte' : 'Inhabilitar';

        // Empresa: solo se ofrece el estado al que todavía no está la alerta
        const accionesEstado = document.getElementById('detailEstadoAcciones');
        if (accionesEstado) {
            accionesEstado.querySelectorAll('[data-nuevo-estado]').forEach(function (b) {
                b.hidden = b.dataset.nuevoEstado === d.estado;
                b.classList.remove('cargando');
                b.removeAttribute('aria-disabled');
                b.textContent = b.dataset.nuevoEstado === 'En_proceso' ? 'Marcar en proceso' : 'Marcar resuelta';
            });
            // La duración se elige al publicarla (si ya está en proceso se cambia desde "Editar")
            const duracion = document.getElementById('detailDuracionCampo');
            duracion.hidden = d.estado === 'En_proceso';
            document.getElementById('detailDuracion').value = '';
        }
        pintarRelacionados(tarjeta);
        detalleEditable = d.editable === '1';
        pintarAfectadas(d.afectadas);
        // Pasajero: qué puede hacer con su reporte y, si la empresa lo descartó, por qué
        const notaEditar = document.getElementById('detailNotaEditar');
        if (notaEditar) notaEditar.hidden = !editable;
        const notaPublicada = document.getElementById('detailNotaPublicada');
        if (notaPublicada) notaPublicada.hidden = !(d.vista === 'mios' && !editable && (d.estado === 'En_proceso' || d.estado === 'Resuelta'));
        const motivo = document.getElementById('detailMotivo');
        if (motivo) {
            motivo.hidden = !d.motivo;
            motivo.textContent = d.motivo ? 'La empresa lo descartó: ' + d.motivo + '.' : '';
        }
        abrir(detailModal, editable ? btnEditar : document.getElementById('detailClose'));
    }

    tarjetas.forEach(function (t) {
        t.addEventListener('click', function () { abrirDetalle(t); });
        t.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalle(t); }
        });
    });

    document.getElementById('detailClose').addEventListener('click', function () { cerrar(detailModal); });

    btnEditar.addEventListener('click', function () {
        if (!seleccionada) return;
        const tarjeta = seleccionada;
        detailModal.classList.remove('abierto');
        detailModal.hidden = true;
        abrirFormulario('editar', tarjeta);
    });

    // Inhabilitar: primero se pide confirmar dentro de la misma ventana. Si la empresa descarta el reporte de
    // un pasajero, además elige el motivo (el pasajero lo verá en "Mis reportes")
    const campoMotivo = document.getElementById('detailMotivoCampo');
    const selectMotivo = document.getElementById('detailMotivoDescarte');
    const textoConfirma = document.getElementById('detailConfirmaTexto');
    function pideMotivo() {
        return !!campoMotivo && !!seleccionada && seleccionada.dataset.dePasajero === '1';
    }
    btnInhabilitar.addEventListener('click', function () {
        detalleAcciones.hidden = true;
        confirma.hidden = false;
        const motivo = pideMotivo();
        if (campoMotivo) {
            campoMotivo.hidden = !motivo;
            campoMotivo.classList.remove('con-error');
            selectMotivo.value = '';
        }
        textoConfirma.textContent = motivo
            ? '¿Descartar este reporte? No se publicará y el pasajero verá el motivo.'
            : '¿Inhabilitar esta alerta? Dejará de mostrarse, pero queda guardada en el sistema.';
        (motivo ? selectMotivo : document.getElementById('detailConfirmaNo')).focus();
    });

    document.getElementById('detailConfirmaNo').addEventListener('click', function () {
        confirma.hidden = true;
        detalleAcciones.hidden = false;
        btnInhabilitar.focus();
    });

    function enviarPost(accion, campos) {
        const f = document.createElement('form');
        f.method = 'POST';
        f.action = accion;
        const csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrf) campos.csrfmiddlewaretoken = csrf.value;
        Object.keys(campos).forEach(function (nombre) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = nombre;
            input.value = campos[nombre];
            f.appendChild(input);
        });
        document.body.appendChild(f);
        f.submit();
    }

    function botonCargando(boton, texto) {
        boton.classList.add('cargando');
        boton.textContent = texto;
        boton.setAttribute('aria-disabled', 'true');
    }

    document.getElementById('detailConfirmaSi').addEventListener('click', function () {
        if (!seleccionada || this.getAttribute('aria-disabled') === 'true') return;
        const campos = {};
        if (pideMotivo()) {
            if (!selectMotivo.value) {
                campoMotivo.classList.add('con-error');
                selectMotivo.focus();
                return;
            }
            campos.motivo = selectMotivo.value;
        }
        botonCargando(this, pideMotivo() ? 'Descartando…' : 'Inhabilitando…');
        enviarPost('/inhabilitarAlerta/' + seleccionada.dataset.id + '/', campos);
    });
    if (selectMotivo) selectMotivo.addEventListener('change', function () { campoMotivo.classList.remove('con-error'); });

    // Empresa: marcar en proceso (se publica, con la duración elegida) o resuelta, sin pasar por el formulario
    document.querySelectorAll('#detailEstadoAcciones [data-nuevo-estado]').forEach(function (b) {
        b.addEventListener('click', function () {
            if (!seleccionada || b.getAttribute('aria-disabled') === 'true') return;
            botonCargando(b, 'Guardando…');
            const campos = { estado: b.dataset.nuevoEstado };
            if (b.dataset.nuevoEstado === 'En_proceso') campos.duracion = document.getElementById('detailDuracion').value;
            enviarPost('/estadoAlerta/' + seleccionada.dataset.id + '/', campos);
        });
    });

    // ---------- Empresa: acciones en lote ----------
    const barraLote = document.getElementById('barraLote');
    if (barraLote) {
        const casillas = Array.from(document.querySelectorAll('.al-elegir-casilla'));
        const cuenta = document.getElementById('loteCuenta');
        const errorLote = document.getElementById('loteError');
        const motivoLote = document.getElementById('loteMotivo');
        const idsLote = document.getElementById('loteIds');

        function elegidas() {
            // Solo cuentan las que se ven con los filtros actuales
            return casillas.filter(function (c) { return c.checked && !c.closest('.al-tarjeta').hidden; });
        }
        function actualizarLote() {
            const lista = elegidas();
            const n = lista.length;
            const enOtraPagina = lista.filter(function (c) { return c.closest('.al-tarjeta').classList.contains('pag-fuera'); }).length;
            barraLote.hidden = n === 0;
            cuenta.textContent = n + (n === 1 ? ' alerta elegida' : ' alertas elegidas')
                + (enOtraPagina ? ' (' + enOtraPagina + (enOtraPagina === 1 ? ' está en otra página)' : ' están en otras páginas)') : '');
            casillas.forEach(function (c) { c.closest('.al-tarjeta').classList.toggle('elegida', c.checked); });
            errorLote.hidden = true;
        }
        casillas.forEach(function (c) {
            // Elegir no abre el detalle de la tarjeta
            ['click', 'keydown'].forEach(function (ev) {
                c.addEventListener(ev, function (e) { e.stopPropagation(); });
            });
            c.closest('.al-elegir').addEventListener('click', function (e) { e.stopPropagation(); });
            c.addEventListener('change', actualizarLote);
        });
        // Al cambiar de filtro, la cuenta se ajusta a las que siguen a la vista
        pestanas.concat(filtroRuta ? [filtroRuta] : []).forEach(function (el) {
            el.addEventListener(el === filtroRuta ? 'change' : 'click', actualizarLote);
        });
        alCambiarPagina = actualizarLote;
        document.getElementById('loteLimpiar').addEventListener('click', function () {
            casillas.forEach(function (c) { c.checked = false; });
            actualizarLote();
        });
        barraLote.addEventListener('submit', function (e) {
            const accion = e.submitter ? e.submitter.value : '';
            const lista = elegidas();
            errorLote.hidden = true;
            if (!lista.length) { e.preventDefault(); return; }
            if (accion === 'descartar' && !motivoLote.value) {
                e.preventDefault();
                errorLote.textContent = 'Elige el motivo para descartar: los pasajeros lo verán.';
                errorLote.hidden = false;
                motivoLote.focus();
                return;
            }
            idsLote.textContent = '';
            lista.forEach(function (c) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'ids';
                input.value = c.value;
                idsLote.appendChild(input);
            });
            // El botón elegido se envía con la acción; se evita un segundo envío
            if (barraLote.dataset.enviando) { e.preventDefault(); return; }
            barraLote.dataset.enviando = '1';
        });
        window.addEventListener('pageshow', function () { delete barraLote.dataset.enviando; });
    }
});
