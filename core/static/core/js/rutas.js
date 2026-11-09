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
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ninguna ruta coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por el código.'
                : 'No hay rutas en este estado.';
            mensajeFiltro.hidden = false;
        } else {
            mensajeFiltro.hidden = true;
        }
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

    // Lo que sigue es solo para la empresa (el pasajero no tiene ventanas)
    const rutaModal = document.getElementById('rutaModal');
    if (!rutaModal) return;

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    const cambiosModal = document.getElementById('cambiosModal');
    const habModal = document.getElementById('habModal');
    const modales = [rutaModal, cambiosModal, habModal];
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
        estado: document.getElementById('rutaEstado'),
        motivo: document.getElementById('rutaMotivo'),
        duracion: document.getElementById('rutaDuracion'),
        frecuencia: document.getElementById('rutaFrecuencia'),
        geometria: document.getElementById('rutaGeometria'),
        paradas: document.getElementById('rutaParadas'),
        distancia: document.getElementById('rutaDistancia'),
    };
    const btnOrigen = document.getElementById('btnMarcarOrigen');
    const btnDestino = document.getElementById('btnMarcarDestino');
    const btnTrazar = document.getElementById('btnTrazar');
    const btnDeNuevo = document.getElementById('btnEmpezarDeNuevo');
    const mapaCaja = document.getElementById('rutaMapa');
    const mapaCargando = document.getElementById('rutaMapaCargando');
    const mapaEstado = document.getElementById('rutaMapaEstado');
    const datoDistancia = document.getElementById('rutaDatoDistancia');
    const datoPuntos = document.getElementById('rutaDatoPuntos');

    const CENTRO = [6.2442, -75.5812]; // Medellín
    const COLOR_TRAZADO = getComputedStyle(document.documentElement).getPropertyValue('--azul').trim() || '#014CAB';

    const editor = {
        modo: 'crear',      // crear | editar
        marcando: null,     // origen | destino | null
        origen: null,       // marcador de Leaflet
        destino: null,
        linea: null,
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
        mapa = L.map(mapaCaja, { zoomControl: true }).setView(CENTRO, 12);
        const capa = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
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
                // Sin modo elegido, llena lo que falte: primero el origen, luego el destino
                const tipo = editor.marcando || (!editor.origen ? 'origen' : (!editor.destino ? 'destino' : null));
                if (tipo) ponerPunto(tipo, e.geocode.center, e.geocode.name);
                else mapa.setView(e.geocode.center, 16);
            }).addTo(mapa);
        }

        mapa.on('click', function (e) {
            if (editor.marcando) ponerPunto(editor.marcando, e.latlng, '');
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

    // ---------- Origen y destino ----------
    function ponerPunto(tipo, latlng, direccion) {
        if (editor[tipo]) mapa.removeLayer(editor[tipo]);
        const marcador = L.marker(latlng, {
            icon: icono(tipo),
            draggable: true,
            zIndexOffset: 1000,
            title: tipo === 'origen' ? 'Origen (arrastra para moverlo)' : 'Destino (arrastra para moverlo)',
        }).addTo(mapa);

        marcador.on('dragend', function () {
            buscarDireccion(marcador.getLatLng(), campo[tipo]);
            // Si ya había un trazado, se vuelve a trazar con el punto nuevo
            if (editor.linea) trazar();
            else actualizarEstado();
        });

        editor[tipo] = marcador;
        if (direccion) ponerDireccion(campo[tipo], direccion);
        else buscarDireccion(latlng, campo[tipo]);

        // Al poner el origen se pasa a elegir el destino, si falta
        marcar(tipo === 'origen' && !editor.destino ? 'destino' : null);
        ocultarError();
    }

    // Cada búsqueda lleva un turno: una respuesta vieja (de otra ruta o de un punto ya movido)
    // no debe pisar lo que hay ahora en el campo
    function nuevoTurno(input) {
        input.dataset.turno = String(Number(input.dataset.turno || 0) + 1);
        return input.dataset.turno;
    }

    function ponerDireccion(input, texto) {
        nuevoTurno(input);
        input.classList.remove('buscando');
        input.placeholder = input === campo.origen
            ? 'Se llena al marcar el origen en el mapa' : 'Se llena al marcar el destino en el mapa';
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
        btnOrigen.setAttribute('aria-pressed', tipo === 'origen' ? 'true' : 'false');
        btnDestino.setAttribute('aria-pressed', tipo === 'destino' ? 'true' : 'false');
        mapaCaja.classList.toggle('marcando', !!tipo);
        actualizarEstado();
    }

    btnOrigen.addEventListener('click', function () { marcar(editor.marcando === 'origen' ? null : 'origen'); });
    btnDestino.addEventListener('click', function () { marcar(editor.marcando === 'destino' ? null : 'destino'); });

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
            texto = 'Toca el mapa donde termina la ruta, o busca la dirección con la lupa.';
        } else if (editor.linea) {
            texto = 'Ruta trazada. Arrastra el origen o el destino si quieres ajustarla.';
            mapaEstado.classList.add('listo');
        } else if (editor.origen && editor.destino) {
            texto = 'Origen y destino listos. Ahora pulsa «Trazar ruta».';
        } else if (editor.origen) {
            texto = 'Falta el destino: pulsa «Marcar destino» y toca el mapa.';
        } else if (editor.destino) {
            texto = 'Falta el origen: pulsa «Marcar origen» y toca el mapa.';
        } else {
            texto = 'Empieza marcando el origen de la ruta.';
        }
        mapaEstado.textContent = texto;

        btnTrazar.disabled = !(editor.origen && editor.destino) || editor.trazando;
        if (!editor.trazando) btnTrazar.textContent = editor.linea ? 'Volver a trazar' : 'Trazar ruta';
    }

    // ---------- Trazado por las calles (OSRM) ----------
    function trazar() {
        if (!editor.origen || !editor.destino) return;
        const a = editor.origen.getLatLng();
        const b = editor.destino.getLatLng();
        const peticion = ++editor.peticion;
        editor.trazando = true;
        btnTrazar.textContent = 'Trazando…';
        actualizarEstado();

        const url = 'https://router.project-osrm.org/route/v1/driving/'
            + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (datos) {
                if (peticion !== editor.peticion) return;
                if (datos.code !== 'Ok' || !datos.routes || !datos.routes.length) {
                    mostrarError('No encontramos un camino por las calles entre esos dos puntos. Mueve el origen o el destino e inténtalo de nuevo.');
                    return;
                }
                const ruta = datos.routes[0];
                // OSRM entrega [lng, lat], que es lo que guarda el servidor
                dibujar(ruta.geometry.coordinates, ruta.distance / 1000);
                ocultarError();
            })
            .catch(function () {
                if (peticion !== editor.peticion) return;
                mostrarError('No pudimos trazar la ruta: el servicio de mapas no respondió. Revisa tu conexión e inténtalo de nuevo.');
            })
            .then(function () {
                if (peticion !== editor.peticion) return;
                editor.trazando = false;
                actualizarEstado();
            });
    }

    btnTrazar.addEventListener('click', trazar);

    // coordenadas: [[lng, lat], ...]
    function dibujar(coordenadas, distanciaKm, sinEncuadrar) {
        if (editor.linea) mapa.removeLayer(editor.linea);
        const puntos = coordenadas.map(function (c) { return [c[1], c[0]]; });
        editor.linea = L.polyline(puntos, { color: COLOR_TRAZADO, weight: 5, opacity: 0.85 }).addTo(mapa);
        if (!sinEncuadrar) mapa.fitBounds(editor.linea.getBounds(), { padding: [40, 40] });

        campo.geometria.value = JSON.stringify(coordenadas);
        campo.distancia.value = Number(distanciaKm || 0).toFixed(2);
        datoDistancia.textContent = Number(distanciaKm || 0).toFixed(1) + ' km';
        datoPuntos.textContent = coordenadas.length;
    }

    function borrarTodo() {
        editor.peticion++;
        editor.trazando = false;
        ['origen', 'destino', 'linea'].forEach(function (k) {
            if (editor[k] && mapa) mapa.removeLayer(editor[k]);
            editor[k] = null;
        });
        ponerDireccion(campo.origen, '');
        ponerDireccion(campo.destino, '');
        campo.geometria.value = '';
        campo.paradas.value = '';
        campo.distancia.value = '0';
        datoDistancia.textContent = '0.0 km';
        datoPuntos.textContent = '0';
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
    [campo.nombre, campo.duracion, campo.frecuencia, campo.estado, campo.motivo].forEach(function (input) {
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

    // ---------- Abrir el editor ----------
    function prepararEditor() {
        form.reset();
        limpiarErrores();
        estadoCodigo('', '');
        botonListo(btnGuardar);
        if (!mapa) crearMapa();
        if (mapa) borrarTodo();
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
        campo.estado.value = ruta.estado;
        campo.motivo.value = ruta.motivo || '';
        mostrarMotivo();
        campo.duracion.value = ruta.duracion_estimada_minutos || '';
        campo.frecuencia.value = ruta.frecuencia_minutos || '';

        mostrarEditor(campo.nombre, function () {
            const coords = ruta.coordenadas || [];
            if (coords.length >= 2) {
                ponerPunto('origen', L.latLng(coords[0][1], coords[0][0]), ruta.origen);
                ponerPunto('destino', L.latLng(coords[coords.length - 1][1], coords[coords.length - 1][0]), ruta.destino);
                dibujar(coords, ruta.distancia_km);
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

        if (campo.estado.value === 'Fuera_servicio' && !campo.motivo.value.trim()) {
            errores.push([campo.motivo, 'Escribe el motivo: los pasajeros lo verán y les llegará como alerta.']);
        }

        [[campo.duracion, 'La duración'], [campo.frecuencia, 'La frecuencia']].forEach(function (par) {
            const valor = par[0].value.trim();
            if (valor && !(/^\d+$/.test(valor))) errores.push([par[0], par[1] + ' debe ser un número entero de minutos, sin decimales.']);
        });

        errores.forEach(function (e) { if (e[1]) errorEnCampo(e[0], e[1]); });

        let mensaje = null;
        if (!campo.geometria.value || campo.geometria.value === '[]') {
            mensaje = editor.trazando
                ? 'Espera a que termine de trazarse la ruta y vuelve a guardar.'
                : 'Falta trazar la ruta: marca el origen y el destino en el mapa y pulsa «Trazar ruta».';
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
        nombre: 'Nombre', codigo: 'Código', origen: 'Origen', destino: 'Destino', estado: 'Estado',
        motivo: 'Motivo', duracion: 'Duración (min)', frecuencia: 'Frecuencia (min)', trazado: 'Trazado',
    };
    const NOMBRES_ESTADO = { Activa: 'Activa', Fuera_servicio: 'Fuera de servicio' };

    function datosDelFormulario() {
        return {
            nombre: campo.nombre.value.trim(),
            codigo: campo.codigo.value.trim(),
            origen: campo.origen.value.trim(),
            destino: campo.destino.value.trim(),
            estado: campo.estado.value,
            // El motivo solo cuenta mientras la ruta está fuera de servicio
            motivo: campo.estado.value === 'Fuera_servicio' ? campo.motivo.value.trim() : '',
            duracion: campo.duracion.value.trim(),
            frecuencia: campo.frecuencia.value.trim(),
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
                dd.textContent = 'Se guardará el recorrido nuevo (' + datoDistancia.textContent + ').';
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

    function abrirHabilitacion(boton) {
        const habilitada = boton.dataset.habilitado === '1';
        const accion = habilitada ? 'Inhabilitar' : 'Habilitar';
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

        habForm.action = boton.dataset.url;
        document.getElementById('habValor').value = habilitada ? '0' : '1';
        botonListo(habConfirmar);
        habConfirmar.textContent = accion;
        habConfirmar.classList.toggle('ru-boton--peligro', habilitada);
        abrir(habModal, habModal.querySelector('[data-cerrar].ru-boton'));
    }

    habForm.addEventListener('submit', function (e) {
        if (estaCargando(habConfirmar)) { e.preventDefault(); return; }
        botonCargando(habConfirmar, habConfirmar.textContent === 'Inhabilitar' ? 'Inhabilitando…' : 'Habilitando…');
    });
});
