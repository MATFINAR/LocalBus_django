// ============================================================
// RUTAS.JS - Lista de rutas (filtros y búsqueda) y, para la empresa: crear, editar,
// inhabilitar y habilitar. Un solo mapa sirve para crear y editar.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni emojis; los errores se muestran en la ventana.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ---------- Filtros y búsqueda (pasajeros y empresa) ----------
    const filas = Array.from(document.querySelectorAll('.ru-fila'));
    const pestanas = Array.from(document.querySelectorAll('.ru-pestana'));
    const buscador = document.getElementById('ruBuscar');
    const mensajeFiltro = document.getElementById('ruFiltroMensaje');
    const filtros = { estado: 'todas', texto: '' };

    // Sin tildes ni mayúsculas: "belen" encuentra "Belén"
    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    filas.forEach(function (fila) { fila.dataset.buscar = normalizar(fila.dataset.buscar); });

    // ---------- Paginador: cuántos registros ver a la vez (5, 10, 25, 50 o todos) ----------
    // Los filtros siguen marcando con `hidden` lo que no coincide; el paginador solo reparte lo que queda.
    const paginador = LocalBusPaginador.crear({
        clave: 'rutas',
        despuesDe: document.querySelector('.ru-tabla-caja'),
        elementos: function () { return filas; },
        nombres: ['ruta', 'rutas']
    });

    function filtrar() {
        let visibles = 0;
        filas.forEach(function (fila) {
            const habilitada = fila.dataset.habilitado === '1';
            let porEstado = true;
            if (filtros.estado === 'inhabilitadas') porEstado = !habilitada;
            else if (filtros.estado !== 'todas') porEstado = habilitada && fila.dataset.estado === filtros.estado;
            const porTexto = !filtros.texto || fila.dataset.buscar.includes(filtros.texto);
            fila.hidden = !(porEstado && porTexto);
            if (!fila.hidden) visibles++;
        });
        paginador.actualizar();
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ninguna ruta coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por el código.'
                : 'No hay rutas en este estado.';
            mensajeFiltro.hidden = false;
        } else {
            mensajeFiltro.hidden = true;
        }
        refrescarMapaLista();
    }

    pestanas.forEach(function (p) {
        p.addEventListener('click', function () {
            pestanas.forEach(function (o) {
                o.classList.toggle('activa', o === p);
                o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
            });
            filtros.estado = p.dataset.filtro;
            filtrar();
        });
    });

    if (buscador) {
        buscador.addEventListener('input', function () {
            filtros.texto = normalizar(buscador.value.trim());
            filtrar();
        });
    }

    // ---------- Ver como: tabla, fichas o mapa ----------
    const seccion = document.getElementById('rutas');
    const botonesVista = Array.from(document.querySelectorAll('.ru-vista'));
    const tablaCaja = document.querySelector('.ru-tabla-caja');
    const vistaMapa = document.getElementById('ruVistaMapa');
    const mapaListaCaja = document.getElementById('ruMapaLista');
    const mapaListaCargando = document.getElementById('ruMapaListaCargando');
    const mapaNota = document.getElementById('ruMapaNota');
    const datosMapa = document.getElementById('rutasMapa');
    const rutasMapa = datosMapa ? JSON.parse(datosMapa.textContent) : [];
    let mapaLista = null;
    const lineasMapa = {};   // id de ruta -> línea en el mapa

    // Globo de cada ruta: la misma ficha de la vista "Fichas" (se copia de su fila), con Editar e Inhabilitar
    function globoRuta(r) {
        const fila = filas.find(function (f) { return f.dataset.id === String(r.id); });
        const caja = document.createElement('div');
        caja.className = 'ru-globo' + (fila && fila.classList.contains('ru-fila--inhabilitada') ? ' ru-fila--inhabilitada' : '');
        caja.style.setProperty('--ruta', r.color);
        if (!fila) return caja;
        Array.from(fila.children).forEach(function (celda) {
            const copia = document.createElement('div');
            copia.className = celda.className;
            if (celda.dataset.etiqueta) copia.dataset.etiqueta = celda.dataset.etiqueta;
            Array.from(celda.childNodes).forEach(function (n) { copia.appendChild(n.cloneNode(true)); });
            caja.appendChild(copia);
        });
        // Leaflet no deja salir los clics del globo: cada botón copiado pulsa el original de la fila
        caja.querySelectorAll('[data-accion]').forEach(function (b) {
            const accion = b.dataset.accion;
            b.removeAttribute('data-accion');
            b.addEventListener('click', function () {
                const original = fila.querySelector('[data-accion="' + accion + '"]');
                mapaLista.closePopup();
                if (original) original.click();
            });
        });
        return caja;
    }

    function crearMapaLista() {
        if (typeof L === 'undefined') {
            mapaListaCargando.textContent = 'No se pudo cargar el mapa. Revisa tu conexión y recarga la página.';
            mapaListaCargando.classList.add('error');
            return;
        }
        mapaLista = L.map(mapaListaCaja, { zoomControl: false, minZoom: 10, zoomSnap: 0.25 }).setView([6.2442, -75.5812], 12);
        L.control.zoom({ position: 'bottomright' }).addTo(mapaLista);
        const capa = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            minZoom: 10,
            referrerPolicy: 'strict-origin-when-cross-origin',
        }).addTo(mapaLista);
        capa.once('tileload', function () { mapaListaCargando.hidden = true; });

        rutasMapa.forEach(function (r) {
            if (!r.coordenadas || r.coordenadas.length < 2) return;
            const puntos = r.coordenadas.map(function (c) { return [c[1], c[0]]; });
            const linea = L.polyline(puntos, r.habilitado
                ? { color: r.color, weight: 5, opacity: 0.85 }
                : { color: '#5B646B', weight: 4, opacity: 0.7, dashArray: '6 8' });
            linea.bindPopup(function () { return globoRuta(r); }, { minWidth: 280, maxWidth: 340 });
            linea.bindTooltip(r.codigo + ' ' + r.nombre, { sticky: true });
            // Con el globo abierto la etiqueta flotante sobra (lo tapaba)
            linea.on('popupopen', function () { linea.closeTooltip(); linea.unbindTooltip(); });
            linea.on('popupclose', function () { linea.bindTooltip(r.codigo + ' ' + r.nombre, { sticky: true }); });
            linea.on('mouseover', function () { linea.setStyle({ weight: 8 }); });
            linea.on('mouseout', function () { linea.setStyle({ weight: r.habilitado ? 5 : 4 }); });
            lineasMapa[r.id] = linea;
        });
        // Se encuadra cuando la caja ya tiene su tamaño (recién mostrada todavía no lo tiene)
        requestAnimationFrame(function () { mapaLista.invalidateSize(); refrescarMapaLista(true); });
    }

    // Muestra en el mapa solo las rutas que dejan ver los filtros y la búsqueda
    function refrescarMapaLista(encuadrar) {
        if (!mapaLista) return;
        const visibles = [];
        let sinTrazado = 0;
        filas.forEach(function (fila) {
            const linea = lineasMapa[fila.dataset.id];
            if (!linea) {
                if (!fila.hidden) sinTrazado++;
                return;
            }
            if (fila.hidden) {
                mapaLista.removeLayer(linea);
            } else {
                linea.addTo(mapaLista);
                visibles.push(linea);
            }
        });
        if (visibles.length && encuadrar !== false) {
            mapaLista.fitBounds(L.featureGroup(visibles).getBounds(), { padding: [30, 30], maxZoom: 15 });
        }
        mapaNota.textContent = visibles.length
            ? (visibles.length === 1 ? '1 ruta en el mapa.' : visibles.length + ' rutas en el mapa.')
              + ' Toca una línea para ver sus datos.'
              + (sinTrazado ? ' ' + sinTrazado + (sinTrazado === 1 ? ' ruta no tiene' : ' rutas no tienen') + ' recorrido trazado.' : '')
            : 'No hay rutas para mostrar con estos filtros.';
    }

    function cambiarVista(vista) {
        botonesVista.forEach(function (b) {
            b.classList.toggle('activa', b.dataset.vista === vista);
            b.setAttribute('aria-pressed', b.dataset.vista === vista ? 'true' : 'false');
        });
        seccion.classList.toggle('ru--fichas', vista === 'fichas');
        if (tablaCaja) tablaCaja.hidden = vista === 'mapa';
        if (vistaMapa) vistaMapa.hidden = vista !== 'mapa';
        if (vista === 'mapa') {
            if (!mapaLista) crearMapaLista();
            else { mapaLista.invalidateSize(); refrescarMapaLista(); }
        }
        try { localStorage.setItem('localbus-rutas-vista', vista); } catch (e) { /* sin almacenamiento */ }
    }

    botonesVista.forEach(function (b) {
        b.addEventListener('click', function () { cambiarVista(b.dataset.vista); });
    });
    if (botonesVista.length) {
        let guardada = null;
        try { guardada = localStorage.getItem('localbus-rutas-vista'); } catch (e) { /* sin almacenamiento */ }
        if (guardada === 'fichas' || guardada === 'mapa') cambiarVista(guardada);
    }

    // Lo que sigue es solo para la empresa (el pasajero no tiene ventanas)
    const rutaModal = document.getElementById('rutaModal');
    if (!rutaModal) return;

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    const cambiosModal = document.getElementById('cambiosModal');
    const habModal = document.getElementById('habModal');
    const reporteModal = document.getElementById('reporteModal');
    const modales = [rutaModal, cambiosModal, habModal, reporteModal].filter(Boolean);
    const focoPrevio = new Map();

    function abrir(modal, foco) {
        focoPrevio.set(modal, document.activeElement);
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        if (foco) setTimeout(function () { foco.focus(); }, 30);
    }

    function cerrar(modal) {
        modal.classList.remove('abierto');
        modal.hidden = true;
        if (!document.querySelector('.ru-modal.abierto')) document.body.style.overflow = '';
        const previo = focoPrevio.get(modal);
        if (previo && document.contains(previo)) previo.focus();
        if (modal === rutaModal) salirDelEditor();
    }

    // La ventana de encima es la última abierta (la de cambios va sobre la del editor)
    function ventanaDeArriba() {
        const abiertas = modales.filter(function (m) { return m.classList.contains('abierto'); });
        return abiertas.includes(cambiosModal) ? cambiosModal : abiertas[abiertas.length - 1];
    }

    modales.forEach(function (modal) {
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
        modal.querySelectorAll('[data-cerrar]').forEach(function (b) {
            b.addEventListener('click', function () { cerrar(modal); });
        });
    });

    document.addEventListener('keydown', function (e) {
        const arriba = ventanaDeArriba();
        if (!arriba) return;
        if (e.key === 'Escape') {
            // Escape dentro del buscador de direcciones solo cierra el buscador
            if (e.target.closest && e.target.closest('.leaflet-control-geocoder')) return;
            cerrar(arriba);
            return;
        }
        if (e.key !== 'Tab') return;
        // Mantiene el foco dentro de la ventana de arriba
        const enfocables = Array.from(arriba.querySelectorAll('button, select, input:not([type="hidden"]), a[href]'))
            .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!enfocables.length) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });

    // ---------- Descargar reporte con filtros y orden ----------
    const btnReporte = document.getElementById('btnReporte');
    if (btnReporte && reporteModal) {
        const formReporte = document.getElementById('reporteForm');
        const errorReporte = document.getElementById('reporteError');
        const todasRutas = document.getElementById('reporteRutasTodas');
        const casillasRuta = Array.from(formReporte.querySelectorAll('input[name="ruta"]'));
        const orden = document.getElementById('reporteOrden');
        const sentido = document.getElementById('reporteSentido');
        const ayudaOrden = document.getElementById('reporteAyudaOrden');

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

        const EXPLICA_ORDEN = {
            codigo: { asc: 'Del código menor al mayor (R01, R02…).', desc: 'Del código mayor al menor.' },
            nombre: { asc: 'De la A a la Z.', desc: 'De la Z a la A.' },
            estado: { asc: 'Activas, sin buses activos, fuera de horario, fuera de servicio e inhabilitadas.',
                      desc: 'Inhabilitadas, fuera de servicio, fuera de horario, sin buses activos y activas.' },
            distancia: { asc: 'La más corta primero.', desc: 'La más larga primero.' },
            duracion: { asc: 'El recorrido más rápido primero.', desc: 'El recorrido más lento primero.' },
            frecuencia: { asc: 'La que pasa más seguido primero.', desc: 'La que pasa menos seguido primero.' }
        };
        function actualizarOrden() {
            let texto = EXPLICA_ORDEN[orden.value][sentido.value];
            if (orden.value !== 'codigo') texto += ' Si empatan, por código.';
            ayudaOrden.textContent = texto;
        }
        [orden, sentido].forEach(function (s) { s.addEventListener('change', actualizarOrden); });

        btnReporte.addEventListener('click', function () {
            errorReporte.hidden = true;
            actualizarOrden();
            abrir(reporteModal, reporteModal.querySelector('input'));
        });

        formReporte.addEventListener('submit', function (e) {
            // Cada grupo necesita al menos una opción marcada
            const grupos = [['estado', 'Marca al menos un estado.'], ['ruta', 'Marca al menos una ruta.']];
            for (const [nombre, mensaje] of grupos) {
                const casillas = formReporte.querySelectorAll('input[name="' + nombre + '"]');
                if (casillas.length && !formReporte.querySelector('input[name="' + nombre + '"]:checked')) {
                    e.preventDefault();
                    errorReporte.textContent = mensaje;
                    errorReporte.hidden = false;
                    casillas[0].focus();
                    return;
                }
            }
            errorReporte.hidden = true;
            // El PDF se abre en otra pestaña: se cierra la ventana y queda lista para otro reporte
            setTimeout(function () { cerrar(reporteModal); }, 50);
        });
    }

    function botonCargando(boton, texto) {
        boton.dataset.texto = boton.dataset.texto || boton.textContent;
        boton.classList.add('cargando');
        boton.textContent = texto;
        boton.setAttribute('aria-disabled', 'true');
    }

    function botonListo(boton) {
        if (!boton.dataset.texto) return;
        boton.classList.remove('cargando');
        boton.textContent = boton.dataset.texto;
        boton.removeAttribute('aria-disabled');
        delete boton.dataset.texto;
    }

    function estaCargando(boton) {
        return boton.getAttribute('aria-disabled') === 'true';
    }

    // Si se vuelve con el botón del navegador, nada debe quedar "guardando"
    window.addEventListener('pageshow', function () {
        document.querySelectorAll('.ru-boton.cargando').forEach(botonListo);
    });

    // ---------- Datos de las rutas (para editar) ----------
    let rutas = [];
    try {
        rutas = JSON.parse(document.getElementById('rutasJson').textContent);
    } catch (e) {
        rutas = [];
    }

    // ---------- Editor: elementos ----------
    const form = document.getElementById('rutaForm');
    const titulo = document.getElementById('rutaModalTitulo');
    const errorCaja = document.getElementById('rutaError');
    const btnGuardar = document.getElementById('rutaGuardar');
    const campo = {
        nombre: document.getElementById('rutaNombre'),
        codigo: document.getElementById('rutaCodigo'),
        origen: document.getElementById('rutaOrigen'),
        destino: document.getElementById('rutaDestino'),
        fin: document.getElementById('rutaFin'),
        finIgual: document.getElementById('rutaFinIgual'),
        puntoFin: document.getElementById('rutaPuntoFin'),
        indiceRetorno: document.getElementById('rutaIndiceRetorno'),
        regreso: document.getElementById('rutaRegreso'),
        estado: document.getElementById('rutaEstado'),
        motivo: document.getElementById('rutaMotivo'),
        geometria: document.getElementById('rutaGeometria'),
        distancia: document.getElementById('rutaDistancia'),
        duracion: document.getElementById('rutaDuracion'),
        puntosPaso: document.getElementById('rutaPuntosPaso'),
    };
    const btnAjustar = document.getElementById('btnAjustar');
    const ajusteBarra = document.getElementById('rutaAjuste');
    const btnQuitarPasos = document.getElementById('btnQuitarPasos');
    const btnListaPasos = document.getElementById('btnListaPasos');
    const listaCaja = document.getElementById('rutaListaPasos');
    const listaTitulo = document.getElementById('rutaListaTitulo');
    const listaItems = document.getElementById('rutaListaItems');
    const listaVacia = document.getElementById('rutaListaVacia');
    const TRAMOS = ['ida', 'vuelta', 'regreso'];
    const NOMBRES_TRAMO = { ida: 'la ida', vuelta: 'la vuelta', regreso: 'el traslado' };
    const btnOrigen = document.getElementById('btnMarcarOrigen');
    const btnDestino = document.getElementById('btnMarcarDestino');
    const btnFin = document.getElementById('btnMarcarFin');
    const finCampoCaja = document.getElementById('rutaFinCampo');
    const btnTrazar = document.getElementById('btnTrazar');
    const btnDeNuevo = document.getElementById('btnEmpezarDeNuevo');
    const mapaCaja = document.getElementById('rutaMapa');
    const mapaCargando = document.getElementById('rutaMapaCargando');
    const mapaEstado = document.getElementById('rutaMapaEstado');
    const datoDistancia = document.getElementById('rutaDatoDistancia');
    const datoPuntos = document.getElementById('rutaDatoPuntos');
    const duracionAyuda = document.getElementById('rutaDuracionAyuda');
    const btnDuracionUsar = document.getElementById('rutaDuracionUsar');
    const datoFrecuencia = document.getElementById('rutaDatoFrecuencia');
    const datoTraslado = document.getElementById('rutaDatoTraslado');
    const datoTrasladoCaja = document.getElementById('rutaDatoTrasladoCaja');

    const CENTRO = [6.2442, -75.5812]; // Medellín
    const COLOR_TRAZADO = getComputedStyle(document.documentElement).getPropertyValue('--azul').trim() || '#014CAB';
    const COLOR_TRASLADO = getComputedStyle(document.documentElement).getPropertyValue('--gris-texto').trim() || '#5B646B';

    const editor = {
        modo: 'crear',      // crear | editar
        marcando: null,     // origen | destino | fin | null
        origen: null,       // marcador de Leaflet
        destino: null,
        fin: null,          // solo existe si el fin no es el mismo origen
        linea: null,        // grupo con la ida y la vuelta
        yaTrazada: false,   // si ya se trazó, mover un punto vuelve a trazar solo
        soloIda: false,     // ruta vieja: su trazado no tiene la vuelta
        duracionManual: false, // la escribió la persona: al volver a trazar no se cambia
        ajustando: false,   // tocar el mapa agrega un punto de paso
        tramo: 'ida',       // el tramo que se está ajustando
        pasos: { ida: [], vuelta: [], regreso: [] },   // marcadores de los puntos de paso, en orden
        lineas: { ida: [], vuelta: [], regreso: [] },  // coordenadas trazadas de cada tramo
        capas: {},          // línea dibujada de cada tramo, para resaltar la que se ajusta
        listaAbierta: false,
        habiaGlobo: false,  // el toque solo cierra el globo de un punto
        trazando: false,
        rutaId: null,
        original: null,     // datos al abrir la edición, para mostrar qué cambió
        peticion: 0,        // descarta respuestas de trazados viejos
    };
    let mapa = null;

    // ---------- Mapa ----------
    function crearMapa() {
        if (typeof L === 'undefined') {
            mapaCargando.textContent = 'No se pudo cargar el mapa. Revisa tu conexión y vuelve a abrir la ventana.';
            mapaCargando.classList.add('error');
            return;
        }
        // Mismos ajustes que el mapa del home (zoom mínimo, controles abajo a la derecha)
        mapa = L.map(mapaCaja, { zoomControl: false, minZoom: 10 }).setView(CENTRO, 12);
        L.control.zoom({ position: 'bottomright' }).addTo(mapa);
        const capa = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            minZoom: 10,
            referrerPolicy: 'strict-origin-when-cross-origin',
        }).addTo(mapa);

        // El aviso de carga se va con las primeras imágenes del mapa, no con la última
        let tarde = setTimeout(function () { mapaCargando.textContent = 'El mapa está tardando más de lo normal…'; }, 6000);
        capa.once('tileload', function () { clearTimeout(tarde); mapaCargando.hidden = true; });
        capa.on('tileerror', function () {
            if (mapaCargando.hidden) return;
            clearTimeout(tarde);
            mapaCargando.textContent = 'No se pudo cargar el mapa. Revisa tu conexión y vuelve a abrir la ventana.';
            mapaCargando.classList.add('error');
        });

        if (L.Control.Geocoder) {
            L.Control.geocoder({
                position: 'topleft',
                placeholder: 'Buscar dirección',
                errorMessage: 'No encontramos esa dirección.',
                defaultMarkGeocode: false,
            }).on('markgeocode', function (e) {
                if (editor.ajustando) {
                    agregarPaso(e.geocode.center);
                    mapa.panTo(e.geocode.center);
                    return;
                }
                // Sin modo elegido, llena lo que falte: primero el origen, luego el retorno y al final el fin
                const tipo = editor.marcando || (!editor.origen ? 'origen' : (!editor.destino ? 'destino'
                    : (!campo.finIgual.checked && !editor.fin ? 'fin' : null)));
                if (tipo) ponerPunto(tipo, e.geocode.center, e.geocode.name);
                else mapa.setView(e.geocode.center, 16);
            }).addTo(mapa);
        }

        mapa.on('preclick', function () { editor.habiaGlobo = !!mapaCaja.querySelector('.leaflet-popup'); });
        mapa.on('click', function (e) {
            if (editor.marcando) ponerPunto(editor.marcando, e.latlng, '');
            else if (editor.ajustando && !editor.habiaGlobo) agregarPaso(e.latlng);
        });

        // El mapa llena el alto que sobra en la ventana: cambia de tamaño cuando aparece o se va un error
        if (window.ResizeObserver) {
            new ResizeObserver(function () { mapa.invalidateSize(); }).observe(mapaCaja);
        }
    }

    function icono(tipo) {
        return L.divIcon({
            className: 'ru-pin ru-pin--' + tipo,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
        });
    }

    // ---------- Inicio, retorno y fin ----------
    const TITULOS_PUNTO = {
        origen: 'Inicio (arrastra para moverlo)',
        destino: 'Retorno (arrastra para moverlo)',
        fin: 'Fin (arrastra para moverlo)',
    };

    // Punto del fin para el servidor (respaldo si la vuelta no llega trazada)
    function guardarPuntoFin() {
        const m = editor.fin;
        campo.puntoFin.value = m && !campo.finIgual.checked
            ? JSON.stringify([m.getLatLng().lng, m.getLatLng().lat]) : '';
    }

    // Dónde termina la vuelta: el mismo inicio o el fin marcado
    function puntoFinal() {
        return campo.finIgual.checked ? editor.origen : editor.fin;
    }

    function listoParaTrazar() {
        return !!(editor.origen && editor.destino && puntoFinal());
    }

    // Al cambiar un punto después de trazar, el recorrido se vuelve a trazar solo. Si falta un punto
    // (se quitó la casilla y aún no hay fin) se borra el trazado viejo para no guardar una vuelta que ya no vale.
    function retrazarSiHaceFalta() {
        if (!editor.yaTrazada) return actualizarEstado();
        if (listoParaTrazar()) trazar();
        else { borrarTrazado(); actualizarEstado(); }
    }

    function ponerPunto(tipo, latlng, direccion) {
        if (editor[tipo]) mapa.removeLayer(editor[tipo]);
        const marcador = L.marker(latlng, {
            icon: icono(tipo),
            draggable: true,
            zIndexOffset: 1000,
            title: TITULOS_PUNTO[tipo],
        }).addTo(mapa);

        marcador.on('dragend', function () {
            buscarDireccion(marcador.getLatLng(), campo[tipo]);
            if (tipo === 'fin') guardarPuntoFin();
            retrazarSiHaceFalta();
        });

        editor[tipo] = marcador;
        if (direccion) ponerDireccion(campo[tipo], direccion);
        else buscarDireccion(latlng, campo[tipo]);
        if (tipo === 'fin') guardarPuntoFin();

        // Se pasa al siguiente punto que falte: inicio -> retorno -> fin (si no es el mismo inicio)
        let siguiente = null;
        if (tipo === 'origen' && !editor.destino) siguiente = 'destino';
        else if (tipo !== 'fin' && editor.destino && !campo.finIgual.checked && !editor.fin) siguiente = 'fin';
        marcar(siguiente);
        ocultarError();
        retrazarSiHaceFalta();
    }

    // Con la casilla marcada el fin es el mismo inicio: se esconde su campo, su botón y su marcador
    function aplicarFin() {
        const igual = campo.finIgual.checked;
        finCampoCaja.hidden = igual;
        btnFin.hidden = igual;
        if (igual) {
            if (editor.fin && mapa) mapa.removeLayer(editor.fin);
            editor.fin = null;
            ponerDireccion(campo.fin, '');
            if (editor.marcando === 'fin') marcar(null);
        }
        guardarPuntoFin();
        if (igual) {
            // Sin traslado, sus puntos de paso ya no aplican
            quitarMarcadores('regreso');
            if (editor.tramo === 'regreso') elegirTramo('ida');
        }
        actualizarEstado();
    }

    campo.finIgual.addEventListener('change', function () {
        aplicarFin();
        if (!campo.finIgual.checked && !editor.fin) marcar('fin');
        // La vuelta cambia: ahora termina en el inicio, o hay que esperar a que se marque el fin
        retrazarSiHaceFalta();
    });

    // Cada búsqueda lleva un turno: una respuesta vieja (de otra ruta o de un punto ya movido)
    // no debe pisar lo que hay ahora en el campo
    function nuevoTurno(input) {
        input.dataset.turno = String(Number(input.dataset.turno || 0) + 1);
        return input.dataset.turno;
    }

    function ponerDireccion(input, texto) {
        nuevoTurno(input);
        input.classList.remove('buscando');
        input.placeholder = input === campo.origen ? 'Se llena al marcar el inicio en el mapa'
            : (input === campo.fin ? 'Se llena al marcar el fin en el mapa' : 'Se llena al marcar el retorno en el mapa');
        input.value = (texto || '').slice(0, input.maxLength);
        input.title = input.value; // la dirección completa, porque el campo la corta
    }

    // Dirección legible del punto (OpenStreetMap). Si falla, quedan las coordenadas.
    function buscarDireccion(latlng, input) {
        const turno = nuevoTurno(input);
        input.value = '';
        input.placeholder = 'Buscando la dirección…';
        input.classList.add('buscando');
        const coordenadas = latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6);
        const url = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=es'
            + '&lat=' + latlng.lat + '&lon=' + latlng.lng;

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (datos) { return datos.display_name || coordenadas; })
            .catch(function () { return coordenadas; })
            .then(function (texto) {
                if (input.dataset.turno !== turno) return; // llegó una búsqueda más nueva
                ponerDireccion(input, texto);
            });
    }

    function marcar(tipo) {
        editor.marcando = tipo;
        if (tipo) editor.ajustando = false;
        btnOrigen.setAttribute('aria-pressed', tipo === 'origen' ? 'true' : 'false');
        btnDestino.setAttribute('aria-pressed', tipo === 'destino' ? 'true' : 'false');
        btnFin.setAttribute('aria-pressed', tipo === 'fin' ? 'true' : 'false');
        actualizarEstado();
    }

    btnOrigen.addEventListener('click', function () { marcar(editor.marcando === 'origen' ? null : 'origen'); });
    btnDestino.addEventListener('click', function () { marcar(editor.marcando === 'destino' ? null : 'destino'); });
    btnFin.addEventListener('click', function () { marcar(editor.marcando === 'fin' ? null : 'fin'); });

    // Al ajustar, el tramo elegido se ve grueso y encima; los otros quedan tenues
    const GROSOR = { ida: 5, vuelta: 5, regreso: 4 };
    const OPACIDAD = { ida: 0.85, vuelta: 0.7, regreso: 0.8 };

    function resaltarTramo() {
        Object.keys(editor.capas).forEach(function (t) {
            const elegido = editor.ajustando && editor.tramo === t;
            editor.capas[t].setStyle({
                weight: elegido ? 7 : GROSOR[t],
                opacity: elegido ? 1 : (editor.ajustando ? 0.25 : OPACIDAD[t]),
            });
            if (elegido) editor.capas[t].bringToFront();
        });
    }

    // Mensaje que explica qué falta o qué está pasando
    function actualizarEstado() {
        let texto;
        mapaEstado.classList.remove('cargando', 'listo');
        if (editor.trazando) {
            texto = 'Trazando la ruta por las calles…';
            mapaEstado.classList.add('cargando');
        } else if (editor.marcando === 'origen') {
            texto = 'Toca el mapa donde empieza la ruta, o busca la dirección con la lupa.';
        } else if (editor.marcando === 'destino') {
            texto = 'Toca el mapa donde la ruta da la vuelta (el retorno), o busca la dirección con la lupa.';
        } else if (editor.marcando === 'fin') {
            texto = 'Toca el mapa donde termina la ruta, o busca la dirección con la lupa.';
        } else if (!campo.finIgual.checked && !editor.fin && editor.origen && editor.destino) {
            texto = 'Falta el fin: pulsa «Marcar fin» y toca el mapa, o marca que termina en el inicio.';
        } else if (editor.linea && editor.soloIda) {
            texto = 'Esta ruta solo tiene trazada la ida. Pulsa «Volver a trazar» para añadir la vuelta.';
        } else if (editor.ajustando) {
            texto = 'Toca la calle por donde debe pasar ' + NOMBRES_TRAMO[editor.tramo]
                + '. Arrastra un punto para moverlo o tócalo para quitarlo.';
        } else if (editor.linea) {
            texto = campo.regreso.value
                ? 'Trazada (la vuelta va punteada; en gris, el traslado sin pasajeros). Si el bus va por otras calles, pulsa «Ajustar recorrido».'
                : 'Ida y vuelta trazadas (la vuelta va punteada). Si el bus va por otras calles, pulsa «Ajustar recorrido».';
            mapaEstado.classList.add('listo');
        } else if (listoParaTrazar()) {
            texto = 'Puntos listos. Ahora pulsa «Trazar ruta» para trazar la ida y la vuelta.';
        } else if (editor.origen) {
            texto = 'Falta el retorno: pulsa «Marcar retorno» y toca el mapa.';
        } else if (editor.destino) {
            texto = 'Falta el inicio: pulsa «Marcar inicio» y toca el mapa.';
        } else {
            texto = 'Empieza marcando el inicio de la ruta.';
        }
        mapaEstado.textContent = texto;

        btnAjustar.disabled = !editor.linea || editor.soloIda || !listoParaTrazar();
        btnAjustar.setAttribute('aria-pressed', editor.ajustando ? 'true' : 'false');
        ajusteBarra.hidden = !editor.ajustando;
        ajusteBarra.querySelector('[data-tramo="regreso"]').hidden = campo.finIgual.checked;
        btnQuitarPasos.disabled = !editor.pasos[editor.tramo].length;
        mapaCaja.classList.toggle('marcando', !!editor.marcando || editor.ajustando);
        resaltarTramo();
        pintarLista();

        btnTrazar.disabled = !listoParaTrazar() || editor.trazando;
        if (!editor.trazando) btnTrazar.textContent = editor.linea ? 'Volver a trazar' : 'Trazar ruta';
    }

    // ---------- Trazado por las calles (OSRM) ----------
    // Un tramo por las calles entre dos puntos, pasando por sus puntos de paso. Devuelve
    // { coords: [[lng, lat], ...], km } o falla.
    function tramo(a, b, pasos) {
        const puntos = [a].concat(pasos.map(function (m) { return m.getLatLng(); }), [b]);
        const url = 'https://router.project-osrm.org/route/v1/driving/'
            + puntos.map(function (p) { return p.lng + ',' + p.lat; }).join(';') + '?overview=full&geometries=geojson';
        return fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (datos) {
                if (datos.code !== 'Ok' || !datos.routes || !datos.routes.length) throw new Error('sin-camino');
                // OSRM entrega [lng, lat], que es lo que guarda el servidor
                return { coords: datos.routes[0].geometry.coordinates, km: datos.routes[0].distance / 1000 };
            });
    }

    // Ida (inicio -> retorno) y vuelta (retorno -> fin) se trazan aparte, así la vuelta toma sus propias
    // calles (sentidos de las vías), y se guardan juntas en una línea con el índice del retorno.
    // Si el fin no es el inicio, también el traslado fin -> inicio (sin pasajeros) para empezar otra vuelta.
    function trazar(sinEncuadrar, alFallar) {
        if (!listoParaTrazar()) return;
        const a = editor.origen.getLatLng();
        const b = editor.destino.getLatLng();
        const c = puntoFinal().getLatLng();
        const peticion = ++editor.peticion;
        editor.trazando = true;
        btnTrazar.textContent = 'Trazando…';
        actualizarEstado();

        const pedidos = [tramo(a, b, editor.pasos.ida), tramo(b, c, editor.pasos.vuelta)];
        if (!campo.finIgual.checked) pedidos.push(tramo(c, a, editor.pasos.regreso));
        Promise.all(pedidos)
            .then(function (tramos) {
                if (peticion !== editor.peticion) return;
                const ida = tramos[0].coords;
                // El primer punto de la vuelta es el último de la ida: no se repite
                const coordenadas = ida.concat(tramos[1].coords.slice(1));
                dibujar(coordenadas, tramos[0].km + tramos[1].km, ida.length - 1, sinEncuadrar,
                    tramos[2] ? tramos[2].coords : null);
                ocultarError();
            })
            .catch(function (e) {
                if (peticion !== editor.peticion) return;
                if (alFallar) alFallar();
                mostrarError(e && e.message === 'sin-camino'
                    ? 'No encontramos un camino por las calles entre esos puntos. Mueve el inicio, el retorno o el fin e inténtalo de nuevo.'
                    : 'No pudimos trazar la ruta: el servicio de mapas no respondió. Revisa tu conexión e inténtalo de nuevo.');
            })
            .then(function () {
                if (peticion !== editor.peticion) return;
                editor.trazando = false;
                actualizarEstado();
            });
    }

    btnTrazar.addEventListener('click', function () { trazar(); });

    // ---------- Ajustar el recorrido: puntos de paso ----------
    function posiciones() {
        const datos = {};
        TRAMOS.forEach(function (t) {
            if (!editor.pasos[t].length) return;
            datos[t] = editor.pasos[t].map(function (m) { return [m.getLatLng().lng, m.getLatLng().lat]; });
        });
        return datos;
    }

    function quitarMarcadores(nombre) {
        editor.pasos[nombre].forEach(function (m) { if (mapa) mapa.removeLayer(m); });
        editor.pasos[nombre] = [];
    }

    function ponerPasos(datos) {
        TRAMOS.forEach(function (t) {
            quitarMarcadores(t);
            editor.pasos[t] = ((datos || {})[t] || []).map(function (p) { return crearPaso(t, L.latLng(p[1], p[0])); });
        });
    }

    // Cambia los puntos y vuelve a trazar sin mover la vista. Si no hay camino, quedan como estaban
    function cambiarPasos(cambio) {
        const antes = posiciones();
        cambio();
        ocultarError();
        trazar(true, function () { ponerPasos(antes); });
    }

    function crearPaso(nombre, latlng) {
        const marcador = L.marker(latlng, {
            icon: L.divIcon({ className: 'ru-paso ru-paso--' + nombre, html: '<span></span>', iconSize: [28, 28],
                iconAnchor: [14, 14] }),
            draggable: true,
            zIndexOffset: 900,
            title: 'Punto de paso de ' + NOMBRES_TRAMO[nombre] + ' (arrastra para moverlo, tócalo para quitarlo)',
        }).addTo(mapa);

        let antes;
        marcador.on('dragstart', function () { antes = posiciones(); });
        marcador.on('dragend', function () {
            ocultarError();
            trazar(true, function () { ponerPasos(antes); });
        });

        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'ru-boton-texto';
        quitar.textContent = 'Quitar este punto';
        quitar.addEventListener('click', function () {
            cambiarPasos(function () {
                mapa.removeLayer(marcador);
                editor.pasos[nombre] = editor.pasos[nombre].filter(function (m) { return m !== marcador; });
            });
        });
        marcador.bindPopup(quitar);
        return marcador;
    }

    // Qué parte del tramo queda más cerca: así el punto nuevo entra en orden entre los que ya hay
    function posicionEnLinea(latlng, linea) {
        let mejor = 0;
        let menor = Infinity;
        linea.forEach(function (c, i) {
            const d = mapa.distance(latlng, [c[1], c[0]]);
            if (d < menor) { menor = d; mejor = i; }
        });
        return mejor;
    }

    function agregarPaso(latlng) {
        const nombre = editor.tramo;
        if (editor.pasos[nombre].length >= 25) {
            mostrarError('Cada tramo admite máximo 25 puntos de paso.');
            return;
        }
        const linea = editor.lineas[nombre];
        const lugar = posicionEnLinea(latlng, linea);
        let indice = editor.pasos[nombre].findIndex(function (m) { return posicionEnLinea(m.getLatLng(), linea) > lugar; });
        if (indice < 0) indice = editor.pasos[nombre].length;
        cambiarPasos(function () { editor.pasos[nombre].splice(indice, 0, crearPaso(nombre, latlng)); });
    }

    // ---------- Lista de puntos: ver y cambiar el orden ----------
    // Nombre de la calle de cada punto. OpenStreetMap admite una consulta por segundo: se piden en fila
    const calles = {};
    const porNombrar = [];
    let nombrando = false;

    function claveDe(marcador) {
        const p = marcador.getLatLng();
        return p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    }

    function pedirCalle(marcador) {
        const clave = claveDe(marcador);
        if (clave in calles || porNombrar.some(function (x) { return x.clave === clave; })) return;
        porNombrar.push({ clave: clave, latlng: marcador.getLatLng() });
        nombrarSiguiente();
    }

    function nombrarSiguiente() {
        if (nombrando || !porNombrar.length) return;
        nombrando = true;
        const punto = porNombrar[0];
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&accept-language=es'
            + '&lat=' + punto.latlng.lat + '&lon=' + punto.latlng.lng)
            .then(function (r) { return r.json(); })
            .then(function (datos) {
                const d = datos.address || {};
                return [d.road, d.neighbourhood || d.suburb || d.town || d.city].filter(Boolean).join(', ') || punto.clave;
            })
            .catch(function () { return punto.clave; })
            .then(function (nombre) {
                calles[punto.clave] = nombre;
                porNombrar.shift();
                pintarLista();
                setTimeout(function () { nombrando = false; nombrarSiguiente(); }, 1100);
            });
    }

    function moverPaso(desde, hasta) {
        const puntos = editor.pasos[editor.tramo];
        if (hasta < 0 || hasta >= puntos.length || desde === hasta) return;
        const marcador = puntos[desde];
        cambiarPasos(function () {
            puntos.splice(desde, 1);
            puntos.splice(hasta, 0, marcador);
        });
        // El foco sigue al punto que se movió, para poder seguir moviéndolo con el teclado
        const fila = listaItems.children[hasta];
        if (fila) fila.querySelector('select').focus();
    }

    function botonDeFila(texto, etiqueta, accion, inactivo) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ru-lista-accion';
        b.textContent = texto;
        b.title = etiqueta;
        b.setAttribute('aria-label', etiqueta);
        b.disabled = !!inactivo;
        b.addEventListener('click', accion);
        return b;
    }

    let listaPintada = '';

    function pintarLista() {
        // Los números del mapa son los de la lista
        TRAMOS.forEach(function (t) {
            editor.pasos[t].forEach(function (m, i) {
                const numero = m.getElement() && m.getElement().querySelector('span');
                if (numero) numero.textContent = i + 1;
            });
        });

        const puntos = editor.pasos[editor.tramo];
        const abierta = editor.ajustando && editor.listaAbierta;
        listaCaja.hidden = !abierta;
        btnListaPasos.setAttribute('aria-expanded', abierta ? 'true' : 'false');
        btnListaPasos.textContent = 'Lista de puntos' + (puntos.length ? ' (' + puntos.length + ')' : '');
        if (!abierta) { listaPintada = ''; return; }

        puntos.forEach(pedirCalle);
        const nombres = puntos.map(function (m) { return calles[claveDe(m)] || 'Buscando la calle…'; });
        // Si nada cambió no se vuelve a armar, para no cerrar un desplegable que la persona tiene abierto
        const firma = JSON.stringify([editor.tramo, puntos.map(function (m) { return L.stamp(m); }), nombres]);
        if (firma === listaPintada) return;
        listaPintada = firma;

        listaTitulo.textContent = 'Puntos de ' + NOMBRES_TRAMO[editor.tramo] + ', en orden';
        listaVacia.hidden = puntos.length > 0;
        listaItems.textContent = '';
        puntos.forEach(function (marcador, i) {
            const fila = document.createElement('li');

            const orden = document.createElement('select');
            orden.setAttribute('aria-label', 'Posición del punto ' + (i + 1));
            puntos.forEach(function (_, j) { orden.add(new Option(j + 1, j, false, i === j)); });
            orden.addEventListener('change', function () { moverPaso(i, Number(orden.value)); });

            const nombre = document.createElement('button');
            nombre.type = 'button';
            nombre.className = 'ru-lista-nombre';
            nombre.textContent = nombres[i];
            nombre.title = nombres[i] + ' (ver en el mapa)';
            nombre.addEventListener('click', function () { mapa.panTo(marcador.getLatLng()); });

            fila.append(orden, nombre,
                botonDeFila('↑', 'Subir el punto ' + (i + 1), function () { moverPaso(i, i - 1); }, i === 0),
                botonDeFila('↓', 'Bajar el punto ' + (i + 1), function () { moverPaso(i, i + 1); }, i === puntos.length - 1),
                botonDeFila('×', 'Quitar el punto ' + (i + 1), function () {
                    cambiarPasos(function () {
                        mapa.removeLayer(marcador);
                        puntos.splice(i, 1);
                    });
                }));
            listaItems.appendChild(fila);
        });
    }

    btnListaPasos.addEventListener('click', function () {
        editor.listaAbierta = !editor.listaAbierta;
        pintarLista();
    });

    function elegirTramo(nombre) {
        editor.tramo = nombre;
        ajusteBarra.querySelectorAll('[data-tramo]').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.tramo === nombre ? 'true' : 'false');
        });
        actualizarEstado();
    }

    ajusteBarra.querySelectorAll('[data-tramo]').forEach(function (b) {
        b.addEventListener('click', function () { elegirTramo(b.dataset.tramo); });
    });

    btnAjustar.addEventListener('click', function () {
        const activar = !editor.ajustando;
        marcar(null);
        editor.ajustando = activar;
        elegirTramo('ida');
    });

    btnQuitarPasos.addEventListener('click', function () {
        cambiarPasos(function () { quitarMarcadores(editor.tramo); });
    });

    // Kilómetros de una línea [[lng, lat], ...] (haversine)
    function longitudKm(coords) {
        let total = 0;
        for (let i = 1; i < coords.length; i++) total += mapa.distance([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
        return total / 1000;
    }

    // ---------- Duración: se calcula con la distancia y se puede cambiar ----------
    // La misma cuenta que hace el servidor: distancia a la velocidad promedio de un bus
    function duracionCalculada(km) {
        return km > 0 ? Math.max(1, Math.round(km * 60 / Number(campo.duracion.dataset.kmh))) : 0;
    }

    function explicarDuracion() {
        const calculada = duracionCalculada(Number(campo.distancia.value));
        const otra = editor.duracionManual && calculada > 0 && Number(campo.duracion.value) !== calculada;
        duracionAyuda.textContent = otra ? 'La calculada es ' + calculada + ' min.'
            : calculada ? 'Calculada con la distancia. Puedes cambiarla.' : 'Se calcula sola al trazar la ruta.';
        btnDuracionUsar.hidden = !otra;
    }

    // Mientras no la haya escrito la persona, sigue al trazado
    function actualizarDuracion() {
        if (!editor.duracionManual) campo.duracion.value = duracionCalculada(Number(campo.distancia.value)) || '';
        explicarDuracion();
    }

    // coordenadas: [[lng, lat], ...]. indiceRetorno: dónde termina la ida (null = ruta vieja, solo la ida).
    // regreso: traslado fin -> inicio sin pasajeros (null si el fin es el inicio)
    function dibujar(coordenadas, distanciaKm, indiceRetorno, sinEncuadrar, regreso) {
        if (editor.linea) mapa.removeLayer(editor.linea);
        const puntos = coordenadas.map(function (c) { return [c[1], c[0]]; });
        const tieneVuelta = indiceRetorno != null && indiceRetorno > 0 && indiceRetorno < puntos.length - 1;
        const estilo = { color: COLOR_TRAZADO, weight: 5, opacity: 0.85 };
        editor.linea = L.featureGroup().addTo(mapa);
        editor.capas = {};
        // El traslado va debajo y en gris: no es parte del recorrido que ven los pasajeros
        const conTraslado = tieneVuelta && regreso && regreso.length >= 2 && !campo.finIgual.checked;
        if (conTraslado) {
            editor.capas.regreso = L.polyline(regreso.map(function (c) { return [c[1], c[0]]; }),
                { color: COLOR_TRASLADO, weight: 4, opacity: 0.8, dashArray: '2 7' })
                .bindTooltip('Traslado al inicio, sin pasajeros', { sticky: true })
                .addTo(editor.linea);
        }
        campo.regreso.value = conTraslado ? JSON.stringify(regreso) : '';
        editor.lineas = {
            ida: tieneVuelta ? coordenadas.slice(0, indiceRetorno + 1) : coordenadas,
            vuelta: tieneVuelta ? coordenadas.slice(indiceRetorno) : [],
            regreso: conTraslado ? regreso : [],
        };
        campo.puntosPaso.value = JSON.stringify(posiciones());
        datoTrasladoCaja.hidden = !conTraslado;
        datoTraslado.textContent = conTraslado ? longitudKm(regreso).toFixed(1) + ' km' : '0.0 km';
        if (tieneVuelta) {
            editor.capas.ida = L.polyline(puntos.slice(0, indiceRetorno + 1), estilo).addTo(editor.linea);
            // La vuelta, punteada y un poco más tenue, para distinguirla de la ida donde comparten calles
            editor.capas.vuelta = L.polyline(puntos.slice(indiceRetorno), Object.assign({}, estilo, { dashArray: '8 8', opacity: 0.7 }))
                .addTo(editor.linea);
        } else {
            L.polyline(puntos, estilo).addTo(editor.linea);
        }
        if (!sinEncuadrar) mapa.fitBounds(editor.linea.getBounds(), { padding: [40, 40] });

        editor.yaTrazada = true;
        editor.soloIda = !tieneVuelta;
        campo.geometria.value = JSON.stringify(coordenadas);
        campo.indiceRetorno.value = tieneVuelta ? String(indiceRetorno) : '';
        campo.distancia.value = Number(distanciaKm || 0).toFixed(2);
        datoDistancia.textContent = Number(distanciaKm || 0).toFixed(1) + ' km';
        datoPuntos.textContent = coordenadas.length;
        actualizarDuracion();
    }

    // Quita el trazado (no los puntos)
    function borrarTrazado() {
        editor.peticion++;
        editor.trazando = false;
        if (editor.linea && mapa) mapa.removeLayer(editor.linea);
        editor.linea = null;
        editor.capas = {};
        editor.soloIda = false;
        editor.ajustando = false;
        campo.puntosPaso.value = '';
        campo.geometria.value = '';
        campo.indiceRetorno.value = '';
        campo.regreso.value = '';
        datoTrasladoCaja.hidden = true;
        campo.distancia.value = '0';
        datoDistancia.textContent = '0.0 km';
        datoPuntos.textContent = '0';
        actualizarDuracion();
    }

    function borrarTodo() {
        borrarTrazado();
        editor.yaTrazada = false;
        TRAMOS.forEach(quitarMarcadores);
        editor.tramo = 'ida';
        editor.listaAbierta = false;
        ['origen', 'destino', 'fin'].forEach(function (k) {
            if (editor[k] && mapa) mapa.removeLayer(editor[k]);
            editor[k] = null;
        });
        ponerDireccion(campo.origen, '');
        ponerDireccion(campo.destino, '');
        ponerDireccion(campo.fin, '');
        campo.puntoFin.value = '';
    }

    btnDeNuevo.addEventListener('click', function () {
        borrarTodo();
        ocultarError();
        marcar('origen');
    });

    // ---------- Errores ----------
    function mostrarError(texto) {
        errorCaja.textContent = texto;
        errorCaja.hidden = false;
        errorCaja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function ocultarError() {
        errorCaja.hidden = true;
        errorCaja.textContent = '';
    }

    function errorEnCampo(input, texto) {
        const caja = input.closest('.ru-campo');
        caja.classList.add('con-error');
        const mensaje = caja.querySelector('.ru-campo-mensaje');
        if (mensaje) {
            mensaje.classList.remove('correcto', 'cargando');
            mensaje.textContent = texto;
            mensaje.hidden = false;
        }
    }

    // El código lleva su propio estado (formato y disponibilidad): no se limpia aquí
    function limpiarErrores() {
        ocultarError();
        form.querySelectorAll('.ru-campo.con-error').forEach(function (c) {
            if (c.contains(campo.codigo)) return;
            c.classList.remove('con-error');
            const m = c.querySelector('.ru-campo-mensaje');
            if (m) { m.hidden = true; m.textContent = ''; }
        });
    }

    // ---------- Motivo: solo cuando la ruta queda fuera de servicio ----------
    const motivoCampo = document.getElementById('rutaMotivoCampo');

    function mostrarMotivo() {
        const fuera = campo.estado.value === 'Fuera_servicio';
        motivoCampo.hidden = !fuera;
        campo.motivo.required = fuera;
    }

    campo.estado.addEventListener('change', function () {
        mostrarMotivo();
        if (!motivoCampo.hidden && !campo.motivo.value.trim()) campo.motivo.focus();
    });

    // Al corregir un campo se quita su marca
    [campo.nombre, campo.duracion, campo.estado, campo.motivo].forEach(function (input) {
        input.addEventListener('input', function () {
            const caja = input.closest('.ru-campo');
            if (!caja.classList.contains('con-error')) return;
            caja.classList.remove('con-error');
            const m = caja.querySelector('.ru-campo-mensaje');
            if (m) { m.hidden = true; m.textContent = ''; }
        });
    });

    // ---------- Código: formato y disponibilidad mientras se escribe ----------
    const codigoMensaje = document.getElementById('rutaCodigoMensaje');
    const FORMATO_CODIGO = /^[A-Za-z0-9_-]{2,20}$/;
    let codigoTemporizador = null;
    let codigoTurno = 0;

    function estadoCodigo(estado, texto) {
        campo.codigo.dataset.estado = estado;
        const caja = campo.codigo.closest('.ru-campo');
        caja.classList.toggle('con-error', estado === 'usado' || estado === 'invalido');
        codigoMensaje.classList.toggle('correcto', estado === 'libre');
        codigoMensaje.classList.toggle('cargando', estado === 'comprobando');
        codigoMensaje.textContent = texto || '';
        codigoMensaje.hidden = !texto;
    }

    function comprobarCodigo() {
        const codigo = campo.codigo.value.trim();
        clearTimeout(codigoTemporizador);
        codigoTurno++;
        if (!codigo) return estadoCodigo('', '');
        if (!FORMATO_CODIGO.test(codigo)) {
            return estadoCodigo('invalido', 'Usa de 2 a 20 letras, números o guiones, sin espacios.');
        }
        // En la edición, conservar el mismo código no hace falta comprobarlo
        if (editor.modo === 'editar' && editor.original && codigo.toLowerCase() === editor.original.codigo.toLowerCase()) {
            return estadoCodigo('libre', '');
        }
        estadoCodigo('comprobando', 'Comprobando el código…');
        const turno = codigoTurno;
        codigoTemporizador = setTimeout(function () {
            const datos = new FormData();
            datos.append('codigo', codigo);
            if (editor.rutaId) datos.append('ruta_id', editor.rutaId);
            datos.append('csrfmiddlewaretoken', form.querySelector('[name=csrfmiddlewaretoken]').value);
            fetch('/verificar_codigo_ruta/', { method: 'POST', body: datos })
                .then(function (r) { return r.json(); })
                .then(function (r) {
                    if (turno !== codigoTurno) return;
                    if (r.existe) estadoCodigo('usado', 'Ese código ya lo usa otra ruta de tu empresa. Elige otro.');
                    else estadoCodigo('libre', 'Código disponible.');
                })
                .catch(function () {
                    // Sin conexión no se bloquea: el servidor lo valida al guardar
                    if (turno === codigoTurno) estadoCodigo('', '');
                });
        }, 450);
    }

    campo.codigo.addEventListener('input', comprobarCodigo);

    campo.duracion.addEventListener('input', function () {
        editor.duracionManual = campo.duracion.value.trim() !== '';
        explicarDuracion();
    });
    // Si la borran, vuelve a la calculada (al salir del campo, para no estorbar mientras escriben otra)
    campo.duracion.addEventListener('change', actualizarDuracion);
    btnDuracionUsar.addEventListener('click', function () {
        editor.duracionManual = false;
        actualizarDuracion();
        campo.duracion.focus();
    });

    // ---------- Abrir el editor ----------
    function prepararEditor() {
        form.reset();
        editor.duracionManual = false;
        campo.distancia.value = '0';
        actualizarDuracion();
        limpiarErrores();
        estadoCodigo('', '');
        botonListo(btnGuardar);
        if (!mapa) crearMapa();
        if (mapa) borrarTodo();
        aplicarFin();
        editor.marcando = null;
        editor.original = null;
        editor.rutaId = null;
        editor.ruta = null;
        mostrarMotivo();
    }

    function mostrarEditor(foco, alAbrir) {
        abrir(rutaModal, foco);
        // El mapa necesita estar visible para medir su tamaño
        requestAnimationFrame(function () {
            if (!mapa) return;
            mapa.invalidateSize();
            if (alAbrir) alAbrir();
        });
    }

    function abrirCrear() {
        prepararEditor();
        editor.modo = 'crear';
        titulo.textContent = 'Nueva ruta';
        btnGuardar.textContent = 'Guardar ruta';
        form.action = '/crearRuta/';
        mostrarEditor(campo.nombre, function () {
            mapa.setView(CENTRO, 12);
            marcar('origen');
        });
    }

    function abrirEditar(id) {
        const ruta = rutas.find(function (r) { return r.id === id; });
        if (!ruta) return;
        prepararEditor();
        editor.modo = 'editar';
        editor.rutaId = id;
        editor.ruta = ruta;
        titulo.textContent = 'Editar ruta ' + ruta.codigo;
        btnGuardar.textContent = 'Guardar cambios';
        form.action = '/editarRuta/' + id + '/';

        campo.nombre.value = ruta.nombre;
        campo.codigo.value = ruta.codigo;
        ponerDireccion(campo.origen, ruta.origen);
        ponerDireccion(campo.destino, ruta.destino);
        campo.finIgual.checked = ruta.fin_es_origen !== false;
        aplicarFin();
        if (!campo.finIgual.checked) ponerDireccion(campo.fin, ruta.fin);
        campo.estado.value = ruta.estado;
        // Si la guardada no es la calculada, alguien la escribió: al volver a trazar se respeta
        campo.duracion.value = ruta.duracion_estimada_minutos || '';
        editor.duracionManual = !!ruta.duracion_estimada_minutos
            && ruta.duracion_estimada_minutos !== duracionCalculada(Number(ruta.distancia_km));
        campo.distancia.value = Number(ruta.distancia_km || 0).toFixed(2);
        explicarDuracion();
        campo.motivo.value = ruta.motivo || '';
        mostrarMotivo();
        datoFrecuencia.textContent = ruta.frecuencia_minutos ? 'Cada ' + ruta.frecuencia_minutos + ' min' : 'Sin turnos';

        mostrarEditor(campo.nombre, function () {
            const coords = ruta.coordenadas || [];
            const aLatLng = function (p) { return L.latLng(p[1], p[0]); };
            if (coords.length >= 2) {
                // El retorno viene aparte: con ida y vuelta, el último punto de la línea es el fin
                ponerPunto('origen', aLatLng(ruta.punto_inicio || coords[0]), ruta.origen);
                ponerPunto('destino', aLatLng(ruta.punto_retorno || coords[coords.length - 1]), ruta.destino);
                if (!campo.finIgual.checked && ruta.punto_fin) {
                    ponerPunto('fin', aLatLng(ruta.punto_fin), ruta.fin);
                }
                ponerPasos(ruta.puntos_paso);
                dibujar(coords, ruta.distancia_km, ruta.indice_retorno, false, ruta.coordenadas_regreso);
            } else {
                mapa.setView(CENTRO, 12);
            }
            marcar(null);
            editor.original = datosDelFormulario();
        });
    }

    function salirDelEditor() {
        editor.peticion++;
        editor.trazando = false;
        clearTimeout(codigoTemporizador);
    }

    const btnNueva = document.getElementById('btnNuevaRuta');
    if (btnNueva) btnNueva.addEventListener('click', abrirCrear);

    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        if (boton.dataset.accion === 'editar') abrirEditar(Number(boton.dataset.id));
        else if (boton.dataset.accion === 'habilitacion') abrirHabilitacion(boton);
    });

    // ---------- Guardar ----------
    function validar() {
        limpiarErrores();
        const errores = [];

        if (!campo.nombre.value.trim()) errores.push([campo.nombre, 'Escribe el nombre de la ruta.']);

        const codigo = campo.codigo.value.trim();
        const estadoCod = campo.codigo.dataset.estado;
        if (!codigo) {
            estadoCodigo('invalido', 'Escribe el código de la ruta, por ejemplo R-001.');
            errores.push([campo.codigo, null]);
        } else if (estadoCod === 'invalido' || estadoCod === 'usado') {
            errores.push([campo.codigo, null]);
        } else if (estadoCod === 'comprobando') {
            errores.push([campo.codigo, null, 'Espera a que terminemos de comprobar el código y vuelve a guardar.']);
        }

        if (!campo.finIgual.checked && !editor.fin) {
            errores.push([campo.finIgual, null, 'Marca el fin de la ruta en el mapa o indica que termina en el inicio.']);
        }

        const duracion = campo.duracion.value.trim();
        if (campo.duracion.validity.badInput || (duracion && (!/^\d+$/.test(duracion) || Number(duracion) > 1440))) {
            errores.push([campo.duracion, 'La duración debe ser un número entero de minutos, máximo 1440.']);
        }

        if (campo.estado.value === 'Fuera_servicio' && !campo.motivo.value.trim()) {
            errores.push([campo.motivo, 'Escribe el motivo: los pasajeros lo verán y les llegará como alerta.']);
        }

        errores.forEach(function (e) { if (e[1]) errorEnCampo(e[0], e[1]); });

        let mensaje = null;
        if (editor.trazando && campo.geometria.value) {
            mensaje = 'Espera a que termine de trazarse la ruta y vuelve a guardar.';
        } else if (!campo.geometria.value || campo.geometria.value === '[]') {
            mensaje = editor.trazando
                ? 'Espera a que termine de trazarse la ruta y vuelve a guardar.'
                : 'Falta trazar la ruta: marca el inicio y el retorno (y el fin, si no es el mismo inicio) y pulsa «Trazar ruta».';
        } else if (errores.length) {
            mensaje = errores[0][2] || 'Revisa los campos marcados en rojo.';
        }

        if (mensaje) {
            mostrarError(mensaje);
            if (errores.length) errores[0][0].focus();
            return false;
        }
        return true;
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (estaCargando(btnGuardar) || !validar()) return;
        if (editor.modo === 'editar') {
            mostrarCambios();
            return;
        }
        botonCargando(btnGuardar, 'Guardando…');
        form.submit();
    });

    // ---------- Confirmar cambios de una edición ----------
    const ETIQUETAS = {
        nombre: 'Nombre', codigo: 'Código', origen: 'Inicio', destino: 'Retorno', fin: 'Fin', estado: 'Estado',
        motivo: 'Motivo', duracion: 'Duración (min)', trazado: 'Trazado',
    };
    const NOMBRES_ESTADO = { Activa: 'Activa', Fuera_servicio: 'Fuera de servicio' };

    function datosDelFormulario() {
        return {
            nombre: campo.nombre.value.trim(),
            codigo: campo.codigo.value.trim(),
            origen: campo.origen.value.trim(),
            destino: campo.destino.value.trim(),
            fin: campo.finIgual.checked ? 'Igual al inicio' : campo.fin.value.trim(),
            estado: campo.estado.value,
            duracion: campo.duracion.value.trim(),
            // El motivo solo cuenta mientras la ruta está fuera de servicio
            motivo: campo.estado.value === 'Fuera_servicio' ? campo.motivo.value.trim() : '',
            trazado: campo.geometria.value,
        };
    }

    function textoDe(clave, valor) {
        if (clave === 'estado') return NOMBRES_ESTADO[valor] || valor;
        return valor || 'Sin dato';
    }

    const btnCambiosGuardar = document.getElementById('cambiosGuardar');

    function mostrarCambios() {
        const ahora = datosDelFormulario();
        const antes = editor.original || {};
        const lista = document.getElementById('cambiosLista');
        lista.textContent = '';

        Object.keys(ETIQUETAS).forEach(function (clave) {
            if ((antes[clave] || '') === (ahora[clave] || '')) return;
            const fila = document.createElement('div');
            const dt = document.createElement('dt');
            dt.textContent = ETIQUETAS[clave];
            fila.appendChild(dt);
            if (clave === 'trazado') {
                const dd = document.createElement('dd');
                dd.textContent = 'Se guardará el recorrido nuevo de ida y vuelta (' + datoDistancia.textContent + ').';
                fila.appendChild(dd);
            } else {
                const ddAntes = document.createElement('dd');
                ddAntes.className = 'ru-cambio-antes';
                ddAntes.textContent = textoDe(clave, antes[clave]);
                const ddAhora = document.createElement('dd');
                ddAhora.className = 'ru-cambio-ahora';
                ddAhora.textContent = textoDe(clave, ahora[clave]);
                fila.append(ddAntes, ddAhora);
            }
            lista.appendChild(fila);
        });

        const hayCambios = lista.children.length > 0;
        const texto = document.getElementById('cambiosTexto');
        texto.textContent = '';
        if (hayCambios) {
            texto.append('Revisa los cambios de la ruta ');
            const nombre = document.createElement('strong');
            nombre.textContent = ahora.codigo + ' ' + ahora.nombre;
            texto.append(nombre, ' antes de guardarlos.');
        } else {
            texto.textContent = 'No cambiaste ningún dato de la ruta. Vuelve al formulario para editarla o ciérralo.';
        }
        // Qué pasa al cambiar el estado: se dice antes de guardar, no después
        let consecuencia = '';
        if (antes.estado !== ahora.estado && ahora.estado === 'Fuera_servicio') {
            const n = (editor.ruta && editor.ruta.turnos_pendientes) || 0;
            consecuencia = 'Se publicará el motivo como alerta para los pasajeros y sus buses dejarán de verse en el mapa. '
                + (n === 0 ? 'La ruta no tiene turnos en curso ni programados.'
                    : (n === 1 ? '1 turno en curso o programado queda' : n + ' turnos en curso o programados quedan')
                      + ' en pausa: sus conductores no podrán iniciar sesión hasta que reactives la ruta.');
        } else if (antes.estado !== ahora.estado && antes.estado === 'Fuera_servicio') {
            consecuencia = 'La ruta volverá a operar: la alerta del motivo quedará resuelta y sus turnos funcionarán de nuevo.';
        } else if (ahora.estado === 'Fuera_servicio' && antes.motivo !== ahora.motivo) {
            consecuencia = 'La alerta publicada se actualizará con el motivo nuevo.';
        }
        const nota = document.getElementById('cambiosNota');
        nota.textContent = consecuencia;
        nota.hidden = !(hayCambios && consecuencia);

        btnCambiosGuardar.hidden = !hayCambios;
        botonListo(btnCambiosGuardar);
        abrir(cambiosModal, hayCambios ? btnCambiosGuardar : cambiosModal.querySelector('[data-cerrar].ru-boton'));
    }

    btnCambiosGuardar.addEventListener('click', function () {
        if (estaCargando(btnCambiosGuardar)) return;
        botonCargando(btnCambiosGuardar, 'Guardando…');
        form.submit();
    });

    // ---------- Inhabilitar / habilitar ----------
    const habForm = document.getElementById('habForm');
    const habConfirmar = document.getElementById('habConfirmar');

    const habTurnos = document.getElementById('habTurnos');
    const habMotivoCampo = document.getElementById('habMotivoCampo');
    const habMotivo = document.getElementById('habMotivo');
    const habMotivoMensaje = document.getElementById('habMotivoMensaje');
    const habClaveCampo = document.getElementById('habClaveCampo');
    const habUsuario = document.getElementById('habUsuario');
    const habClave = document.getElementById('habClave');
    const habClaveMensaje = document.getElementById('habClaveMensaje');

    function decisionTurnos() {
        const marcada = habForm.querySelector('input[name="turnos"]:checked');
        return habTurnos.hidden || !marcada ? '' : marcada.value;
    }

    // El botón y el campo del motivo siguen lo que se elija
    function actualizarDecision() {
        const decision = decisionTurnos();
        habMotivoCampo.hidden = decision !== 'pausa';
        habMotivoMensaje.hidden = true;
        habMotivoCampo.classList.remove('con-error');
        // Finalizar los turnos pide iniciar sesión de nuevo con la cuenta de la empresa
        habClaveCampo.hidden = decision !== 'finalizar';
        habClaveMensaje.hidden = true;
        if (decision !== 'finalizar') habClave.value = '';
        if (decision === 'pausa') {
            habConfirmar.textContent = 'Poner fuera de servicio';
            habConfirmar.classList.remove('ru-boton--peligro');
        } else if (decision === 'finalizar') {
            habConfirmar.textContent = 'Finalizar turnos e inhabilitar';
            habConfirmar.classList.add('ru-boton--peligro');
        }
    }
    habForm.querySelectorAll('input[name="turnos"]').forEach(function (r) {
        r.addEventListener('change', actualizarDecision);
    });
    [habUsuario, habClave].forEach(function (campo) {
        campo.addEventListener('input', function () {
            habClaveMensaje.hidden = true;
            habClaveCampo.querySelectorAll('.ru-campo').forEach(function (c) { c.classList.remove('con-error'); });
        });
    });
    habMotivo.addEventListener('input', function () {
        habMotivoMensaje.hidden = true;
        habMotivoCampo.classList.remove('con-error');
    });

    function abrirHabilitacion(boton) {
        const habilitada = boton.dataset.habilitado === '1';
        const accion = habilitada ? 'Inhabilitar' : 'Habilitar';
        const ruta = rutas.find(function (r) { return String(r.id) === String(boton.closest('tr').dataset.id); }) || {};
        const pendientes = habilitada ? (ruta.turnos_pendientes || 0) : 0;
        document.getElementById('habTitulo').textContent = accion + ' ruta';

        const texto = document.getElementById('habTexto');
        texto.textContent = '';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre;
        texto.append(habilitada ? '¿Inhabilitar la ruta ' : '¿Volver a habilitar la ruta ', nombre, '?');

        document.getElementById('habNota').textContent = habilitada
            ? 'Dejará de verse en el mapa y en la lista pública, y no se le podrán asignar turnos. '
              + 'Su historial se conserva y puedes volver a habilitarla cuando quieras.'
            : 'Volverá a verse en el mapa y se le podrán asignar turnos.';

        // Con turnos en curso o programados hay que decidir qué pasa con ellos
        habTurnos.hidden = pendientes === 0;
        habMotivo.value = '';
        habUsuario.value = '';
        habClave.value = '';
        habMotivoMensaje.hidden = true;
        habMotivoCampo.classList.remove('con-error');
        if (pendientes > 0) {
            const enCurso = ruta.turnos_en_curso || 0;
            const programados = pendientes - enCurso;
            const partes = [];
            if (enCurso) partes.push(enCurso + ' en curso');
            if (programados) partes.push(programados + (programados === 1 ? ' programado' : ' programados'));
            document.getElementById('habTurnosResumen').textContent =
                'Esta ruta tiene ' + pendientes + (pendientes === 1 ? ' turno' : ' turnos') + ' (' + partes.join(' y ') + '). ¿Qué hacemos con ellos?';

            // Si la ruta ya está fuera de servicio sus turnos ya están en pausa: solo queda finalizarlos
            const yaEnPausa = ruta.estado === 'Fuera_servicio';
            document.getElementById('habOpcionPausa').hidden = yaEnPausa;
            const pausa = habForm.querySelector('input[name="turnos"][value="pausa"]');
            const finalizar = habForm.querySelector('input[name="turnos"][value="finalizar"]');
            pausa.checked = !yaEnPausa;
            finalizar.checked = yaEnPausa;
            document.getElementById('habNota').textContent = yaEnPausa
                ? 'Sus turnos ya están en pausa porque la ruta está fuera de servicio.'
                : 'Una ruta inhabilitada no puede tener turnos, así que elige una de las dos opciones.';
        }

        habForm.action = boton.dataset.url;
        document.getElementById('habValor').value = habilitada ? '0' : '1';
        botonListo(habConfirmar);
        habConfirmar.textContent = accion;
        habConfirmar.classList.toggle('ru-boton--peligro', habilitada);
        if (pendientes > 0) actualizarDecision();
        abrir(habModal, habModal.querySelector('[data-cerrar].ru-boton'));
    }

    habForm.addEventListener('submit', function (e) {
        if (estaCargando(habConfirmar)) { e.preventDefault(); return; }
        // Fuera de servicio necesita el motivo: los pasajeros lo verán
        if (decisionTurnos() === 'pausa' && !habMotivo.value.trim()) {
            e.preventDefault();
            habMotivoMensaje.textContent = 'Escribe el motivo por el que la ruta queda fuera de servicio: los pasajeros lo verán.';
            habMotivoMensaje.hidden = false;
            habMotivoCampo.classList.add('con-error');
            habMotivo.focus();
            return;
        }
        // Finalizar: hay que volver a escribir usuario y contraseña de la empresa
        if (decisionTurnos() === 'finalizar' && (!habUsuario.value.trim() || !habClave.value)) {
            e.preventDefault();
            habClaveMensaje.textContent = 'Escribe el usuario y la contraseña de la cuenta de la empresa para confirmar.';
            habClaveMensaje.hidden = false;
            habClaveCampo.querySelectorAll('.ru-campo').forEach(function (c) { c.classList.add('con-error'); });
            (habUsuario.value.trim() ? habClave : habUsuario).focus();
            return;
        }
        botonCargando(habConfirmar, decisionTurnos() === 'pausa' ? 'Guardando…'
            : (habConfirmar.textContent === 'Habilitar' ? 'Habilitando…' : 'Inhabilitando…'));
    });
});
