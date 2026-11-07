let map;
let userMarker;
let currentFilter = "all";
let currentSearchTerm = "";
let rutasData = [];
let routeLayers = [];
let rutaSeleccionada = null;
const RADIO_CERCANAS_M = 1000;  // "Cercanas a mí": rutas cuyo recorrido pasa a 1 km o menos
let distanciaRutas = null;      // {id de ruta: metros} mientras el filtro "Cercanas a mí" está activo
let circuloCercanas = null;   // id de la ruta elegida en la lista; nada se dibuja hasta elegir una

// Un color por ruta, como las líneas del Metro: el mismo en la lista, en la línea del mapa y en los buses.
// Todos tienen contraste suficiente con texto blanco (las placas llevan el código de la ruta).
// Sin rojo, azul, amarillo ni verde: esos colores significan alerta, acción, advertencia y "en vivo" en el resto del sitio.
const PALETA_RUTAS = [
    '#087F8C',  // turquesa
    '#6B3FA0',  // violeta
    '#B85C00',  // ámbar
    '#A82A7B',  // magenta
    '#5C6B1E',  // oliva
    '#7A4A2B',  // café
    '#3F5B7A',  // pizarra
];

function colorDeRuta(id) {
    return PALETA_RUTAS[Math.abs(Number(id) || 0) % PALETA_RUTAS.length];
}

function aplicarColoresDeRutas() {
    document.querySelectorAll('.route-card').forEach((card, i) => {
        card.style.setProperty('--ruta', colorDeRuta(card.dataset.routeId));
        card.style.setProperty('--i', Math.min(i, 10));  // retraso de la entrada escalonada
    });
}

// Texto bajo los filtros: qué ruta se ve en el mapa o qué hacer para verla
function escribirAviso(texto, estado = '') {
    const aviso = document.getElementById('avisoMapa');
    if (!aviso) return;
    aviso.classList.toggle('buscando', estado === 'buscando');   // gira un indicador de espera
    aviso.classList.toggle('en-vivo', estado === 'en-vivo');     // punto verde que late
    if (aviso.textContent === texto) return;
    aviso.textContent = texto;
    aviso.classList.remove('cambia');
    void aviso.offsetWidth;  // reinicia la animación
    aviso.classList.add('cambia');
}

// Números que suben hasta su valor al cargar la página
function animarContadores() {
    document.querySelectorAll('[data-contar]').forEach(el => {
        const total = Number(el.dataset.contar);
        if (!total || prefiereMenosMovimiento()) return;
        const inicio = performance.now();
        (function paso(ahora) {
            const t = Math.min(1, (ahora - inicio) / 700);
            el.textContent = Math.round(total * (1 - Math.pow(1 - t, 3)));
            if (t < 1) requestAnimationFrame(paso);
        })(inicio);
    });
}

function prefiereMenosMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// La línea de la ruta se dibuja de origen a destino
function dibujarConAnimacion(linea) {
    const trazo = linea.getElement && linea.getElement();
    if (!trazo || !trazo.getTotalLength || prefiereMenosMovimiento()) return;
    try {
        const largo = trazo.getTotalLength();
        trazo.style.strokeDasharray = largo;
        trazo.style.strokeDashoffset = largo;
        trazo.getBoundingClientRect();  // fija el estado inicial antes de animar
        trazo.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.22, 0.61, 0.36, 1)';
        trazo.style.strokeDashoffset = 0;
        const terminar = () => {
            trazo.style.strokeDasharray = '';
            trazo.style.strokeDashoffset = '';
            trazo.style.transition = '';
        };
        trazo.addEventListener('transitionend', terminar, { once: true });
        setTimeout(terminar, 1300);  // por si el navegador no avisa
    } catch (e) { /* sin animación: la línea se ve igual */ }
}

// Los buses se deslizan hasta su nuevo punto (se consulta cada 5 s) en vez de saltar
const animacionesBus = {};
function moverSuave(marcador, clave, destino, ms) {
    cancelAnimationFrame(animacionesBus[clave]);
    const desde = marcador.getLatLng();
    if (prefiereMenosMovimiento() || (desde.lat === destino[0] && desde.lng === destino[1])) {
        marcador.setLatLng(destino);
        return;
    }
    const inicio = performance.now();
    (function paso(ahora) {
        const t = Math.min(1, (ahora - inicio) / ms);
        marcador.setLatLng([desde.lat + (destino[0] - desde.lat) * t, desde.lng + (destino[1] - desde.lng) * t]);
        if (t < 1) animacionesBus[clave] = requestAnimationFrame(paso);
    })(inicio);
}

document.addEventListener('DOMContentLoaded', function() {
    aplicarColoresDeRutas();
    animarContadores();
    // La entrada escalonada solo ocurre al cargar; después no se repite al filtrar la lista
    setTimeout(function() {
        const raiz = document.querySelector('.home-content');
        if (raiz) raiz.classList.remove('entrando');
    }, 1800);
    setTimeout(function() {
        initMap();
        initSearchPanel();
        cargarRutasDesdeBackend();
        initTiempoReal();
    }, 100);

    const locateBtn = document.getElementById('locateBtn');
    if (locateBtn) {
        locateBtn.addEventListener('click', locateUser);
    }
});

function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
        console.error('No se encontró el contenedor del mapa');
        return;
    }

    if (typeof L === 'undefined') {
        console.error('Leaflet no está cargado');
        return;
    }

    try {
        map = L.map('map', {
            scrollWheelZoom: true,
            zoomControl: false,
            zoom: 13,
            minZoom: 10,
            maxZoom: 19
        }).setView([6.2442, -75.5812], 13);

        if (L.control && L.control.zoom) L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.TileLayer.prototype.options.referrerPolicy = 'strict-origin-when-cross-origin';

        const capaMapa = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            minZoom: 10
        }).addTo(map);

        // Pantalla de carga: se desvanece cuando llegan los primeros mosaicos
        const cargando = document.getElementById('mapaCargando');
        const textoCarga = document.getElementById('mapaCargandoTexto');
        if (cargando && capaMapa.once) {
            // Se retira en cuanto llega el primer mosaico; el resto aparece con el fundido propio de Leaflet
            capaMapa.once('tileload', () => cargando.classList.add('listo'));
            capaMapa.on('tileerror', () => {
                if (textoCarga && !cargando.classList.contains('listo')) {
                    textoCarga.textContent = 'No pudimos cargar el mapa. Revisa tu conexión.';
                }
            });
            setTimeout(() => {
                if (textoCarga && !cargando.classList.contains('listo')) {
                    textoCarga.textContent = 'El mapa tarda en cargar…';
                }
            }, 6000);
        }

        // El mapa se redimensiona con la ventana y con la hoja de rutas (celular)
        if (window.ResizeObserver) {
            new ResizeObserver(function() { if (map) map.invalidateSize(); }).observe(mapContainer);
        }

        setTimeout(function() {
            if (map) map.invalidateSize();
        }, 200);

        setTimeout(function() {
            if (map) map.invalidateSize();
        }, 500);

        console.log('Mapa inicializado correctamente');

    } catch (error) {
        console.error('Error al inicializar el mapa:', error);
    }
}

// Escapa texto para insertarlo en HTML (popups de Leaflet, innerHTML).
// Nombres, direcciones, placas y conductores vienen de la base y no deben interpretarse como HTML.
function escaparHtml(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cargarRutasDesdeBackend() {
    const rutasScript = document.getElementById('rutas-data');

    if (rutasScript && rutasScript.textContent) {
        try {
            rutasData = JSON.parse(rutasScript.textContent);
            console.log(`✅ ${rutasData.length} rutas cargadas`);

            if (rutasData.length > 0) {
                prepararSeleccionDeRutas();
            } else {
                mostrarMensajeSinRutas();
            }
        } catch (e) {
            console.error('❌ Error parseando rutas:', e);
            mostrarMensajeError();
        }
    } else {
        mostrarMensajeSinRutas();
    }
}

// ================= RUTA ELEGIDA EN LA LISTA =================
// El mapa empieza vacío. Al tocar una tarjeta se dibuja solo esa ruta y se muestran solo sus buses;
// al tocarla otra vez se quita.

function prepararSeleccionDeRutas() {
    document.querySelectorAll('.route-card').forEach(card => {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-pressed', 'false');
        card.addEventListener('click', () => seleccionarRuta(Number(card.dataset.routeId)));
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                seleccionarRuta(Number(card.dataset.routeId));
            }
        });
    });
    actualizarAvisoMapa();
}

let buscandoBuses = false;   // desde que se elige una ruta hasta la primera respuesta de la API
let sinConexion = false;     // la última consulta de buses falló

function seleccionarRuta(id) {
    rutaSeleccionada = rutaSeleccionada === id ? null : id;

    document.querySelectorAll('.route-card').forEach(card => {
        const elegida = Number(card.dataset.routeId) === rutaSeleccionada;
        card.classList.toggle('seleccionada', elegida);
        card.setAttribute('aria-pressed', elegida ? 'true' : 'false');
    });

    buscandoBuses = rutaSeleccionada !== null;
    limpiarRutaDelMapa();
    const ruta = rutasData.find(r => r.id === rutaSeleccionada);
    if (ruta) dibujarRuta(ruta);

    // Los buses se filtran por la ruta elegida (sin ruta elegida no se muestra ninguno)
    actualizarBusesEnMapa(ultimosBuses);
    actualizarAvisoMapa();
    if (rutaSeleccionada !== null) obtenerUbicacionesBuses();
}

function limpiarRutaDelMapa() {
    const capas = routeLayers;
    routeLayers = [];
    capas.forEach(capa => {
        if (!map || !map.hasLayer(capa)) return;
        const elemento = capa.getElement && capa.getElement();
        if (elemento && !prefiereMenosMovimiento()) {
            elemento.style.transition = 'opacity 0.25s ease';
            elemento.style.opacity = 0;
            setTimeout(() => { if (map.hasLayer(capa)) map.removeLayer(capa); }, 260);
        } else {
            map.removeLayer(capa);
        }
    });
}

function dibujarRuta(ruta) {
    if (!map || !ruta.coordenadas || ruta.coordenadas.length === 0) return;

    const coords = ruta.coordenadas.map(p => [p[1], p[0]]);
    const color = colorDeRuta(ruta.id);
    const trazo = { lineCap: 'round', lineJoin: 'round', opacity: 1 };

    // Borde blanco bajo la línea de color, como en un plano de transporte
    const borde = L.polyline(coords, { ...trazo, color: '#FFFFFF', weight: 10 }).addTo(map);
    const linea = L.polyline(coords, { ...trazo, color: color, weight: 6, smoothFactor: 1 }).addTo(map);
    routeLayers.push(borde, linea);
    dibujarConAnimacion(borde);
    dibujarConAnimacion(linea);

    const punto = clase => L.divIcon({
        className: 'route-marker',
        html: `<div class="punto-ruta ${clase}" style="--ruta: ${color}"></div>`,
        iconSize: [22, 22],
        popupAnchor: [0, -11]
    });
    routeLayers.push(L.marker(coords[0], { icon: punto('origen') })
        .addTo(map)
        .bindPopup(`<strong>Origen</strong><br>${escaparHtml(ruta.origen)}`));
    routeLayers.push(L.marker(coords[coords.length - 1], { icon: punto('destino') })
        .addTo(map)
        .bindPopup(`<strong>Destino</strong><br>${escaparHtml(ruta.destino)}`));

    (ruta.paradas || []).forEach(parada => {
        routeLayers.push(L.circleMarker([parada.lat, parada.lng], {
            radius: 5,
            fillColor: '#FFFFFF',
            fillOpacity: 1,
            color: color,
            weight: 3
        }).addTo(map).bindPopup('<small>Parada</small>'));
    });

    map.fitBounds(L.latLngBounds(coords).pad(0.1));
}

// Texto del panel: qué hacer si no hay ruta elegida, o qué ruta se ve y cuántos buses tiene
function actualizarAvisoMapa() {
    const ruta = rutasData.find(r => r.id === rutaSeleccionada);
    if (!ruta) {
        escribirAviso('Elige una ruta para ver su recorrido y sus buses.');
        return;
    }
    const nombre = ruta.codigo || ruta.nombre;
    if (sinConexion) {
        escribirAviso(`${nombre}: sin conexión, reintentando…`, 'buscando');
        return;
    }
    if (buscandoBuses) {
        escribirAviso(`${nombre}: buscando buses…`, 'buscando');
        return;
    }
    const buses = Object.keys(busMarkers).length;
    const sinTrazado = !ruta.coordenadas || ruta.coordenadas.length === 0;
    escribirAviso(`${nombre}: ` + (sinTrazado ? 'sin recorrido trazado. ' : '') +
        (buses === 0 ? 'sin buses en vivo' : buses === 1 ? '1 bus en vivo' : buses + ' buses en vivo'),
        buses > 0 ? 'en-vivo' : '');
}

function mostrarMensajeSinRutas() {
    escribirAviso('No hay rutas registradas.');
}

function mostrarMensajeError() {
    escribirAviso('No pudimos cargar las rutas. Recarga la página.');
}

function locateUser() {
    const locateBtn = document.getElementById('locateBtn');

    if (!navigator.geolocation) {
        alert('Tu navegador no soporta geolocalización');
        return;
    }

    if (!map) {
        alert('El mapa aún no está listo');
        return;
    }

    locateBtn.disabled = true;
    locateBtn.textContent = 'Buscando…';

    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            map.setView([lat, lng], 15);

            if (userMarker) map.removeLayer(userMarker);

            const customIcon = L.divIcon({
                className: 'user-location-marker',
                html: '<div class="punto-ubicacion"></div>',
                iconSize: [22, 22],
                popupAnchor: [0, -11]
            });

            userMarker = L.marker([lat, lng], { icon: customIcon })
                .addTo(map)
                .bindPopup('<strong>Tu ubicación</strong>')
                .openPopup();

            userLocation = { lat: lat, lng: lng };

            locateBtn.disabled = false;
            locateBtn.textContent = 'Mi ubicación';
        },
        function(error) {
            alert('No se pudo obtener tu ubicación');
            locateBtn.disabled = false;
            locateBtn.textContent = 'Mi ubicación';
        }
    );
}

function initSearchPanel() {
    const searchToggle = document.getElementById('searchToggleBtn');
    const searchBody = document.getElementById('searchBody');
    const searchInput = document.getElementById('routeSearchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const filterChips = document.querySelectorAll('.filter-chip');

    if (searchToggle && searchBody) {
        searchToggle.addEventListener('click', function() {
            searchBody.classList.toggle('collapsed');
            searchToggle.textContent = searchBody.classList.contains('collapsed') ? '+' : '−';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            currentSearchTerm = e.target.value.toLowerCase();
            if (clearBtn) clearBtn.style.display = currentSearchTerm ? 'block' : 'none';
            filterRoutes();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (searchInput) searchInput.value = '';
            currentSearchTerm = '';
            clearBtn.style.display = 'none';
            filterRoutes();
            if (searchInput) searchInput.focus();
        });
    }

    filterChips.forEach(chip => {
        chip.addEventListener('click', function() {
            if (this.dataset.filter === 'cercanas') {
                activarCercanas(this);
            } else {
                marcarFiltro('all');
                filterRoutes();
            }
        });
    });
}

function marcarFiltro(filtro) {
    currentFilter = filtro;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === filtro));
    if (filtro !== 'cercanas') {
        distanciaRutas = null;
        if (circuloCercanas && map) map.removeLayer(circuloCercanas);
        circuloCercanas = null;
        mostrarMensajeFiltro('');
    }
}

function mostrarMensajeFiltro(texto) {
    const mensaje = document.getElementById('filtroMensaje');
    if (!mensaje) return;
    mensaje.textContent = texto;
    mensaje.hidden = !texto;
    mensaje.classList.toggle('cargando', texto.endsWith('…'));   // espera: gira un indicador
}

// ================= CERCANAS A MÍ =================

function obtenerMiUbicacion() {
    return new Promise((resolver, rechazar) => {
        if (!navigator.geolocation) {
            rechazar(new Error('Tu navegador no permite obtener la ubicación.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolver({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => rechazar(new Error('No pudimos obtener tu ubicación. Revisa que el navegador tenga permiso.')),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    });
}

// Distancia en metros del punto `p` al recorrido de la ruta (el tramo más cercano, no solo los vértices).
// Proyección plana alrededor del usuario: para distancias de pocos km el error es mínimo.
function distanciaARuta(p, coordenadas) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const cosLat = Math.cos(p.lat * rad);
    const xy = c => [(c[0] - p.lng) * rad * R * cosLat, (c[1] - p.lat) * rad * R];  // coordenadas [lng, lat]

    let minima = Infinity;
    for (let i = 0; i < coordenadas.length; i++) {
        const [ax, ay] = xy(coordenadas[i]);
        if (i === coordenadas.length - 1) {
            if (coordenadas.length === 1) minima = Math.min(minima, Math.hypot(ax, ay));
            break;
        }
        const [bx, by] = xy(coordenadas[i + 1]);
        const dx = bx - ax, dy = by - ay;
        const largo2 = dx * dx + dy * dy;
        const t = largo2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo2)) : 0;
        minima = Math.min(minima, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return minima;
}

function textoDistancia(metros) {
    return metros < 100 ? 'a menos de 100 m' : `a ${Math.round(metros / 10) * 10} m`;
}

async function activarCercanas(chip) {
    chip.disabled = true;
    mostrarMensajeFiltro('Obteniendo tu ubicación…');
    try {
        const yo = await obtenerMiUbicacion();
        userLocation = yo;  // también sirve para el tiempo de llegada de los buses

        distanciaRutas = {};
        rutasData.forEach(ruta => {
            if (ruta.coordenadas && ruta.coordenadas.length > 0) {
                distanciaRutas[ruta.id] = distanciaARuta(yo, ruta.coordenadas);
            }
        });
        marcarFiltro('cercanas');
        mostrarUbicacionEnMapa(yo);
        const cuantas = filterRoutes();
        mostrarMensajeFiltro(cuantas
            ? `${cuantas === 1 ? '1 ruta pasa' : cuantas + ' rutas pasan'} a 1 km o menos de ti.`
            : 'Ninguna ruta pasa a 1 km o menos de tu ubicación.');
    } catch (error) {
        marcarFiltro('all');
        filterRoutes();
        mostrarMensajeFiltro(error.message);
    } finally {
        chip.disabled = false;
    }
}

// Tu ubicación y el radio de 1 km en el mapa
function mostrarUbicacionEnMapa(yo) {
    if (!map) return;
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([yo.lat, yo.lng], {
        icon: L.divIcon({
            className: 'user-location-marker',
            html: '<div class="punto-ubicacion"></div>',
            iconSize: [22, 22],
            popupAnchor: [0, -11]
        })
    }).addTo(map).bindPopup('<strong>Tu ubicación</strong>');

    if (circuloCercanas) map.removeLayer(circuloCercanas);
    circuloCercanas = L.circle([yo.lat, yo.lng], {
        radius: RADIO_CERCANAS_M,
        color: '#014CAB',
        weight: 1,
        fillOpacity: 0.08
    }).addTo(map);
    // Si no hay una ruta elegida, se encuadra el radio de búsqueda
    if (rutaSeleccionada === null) map.fitBounds(circuloCercanas.getBounds());
}

function filterRoutes() {
    const cards = document.querySelectorAll('.route-card');
    let visibleCount = 0;

    cards.forEach((card, i) => {
        if (card.dataset.orden === undefined) card.dataset.orden = i;
        const nombre = card.dataset.nombre?.toLowerCase() || '';
        const codigo = card.dataset.codigo?.toLowerCase() || '';
        const origen = card.querySelector('.route-info-item span:last-child')?.textContent?.toLowerCase() || '';
        const destino = card.querySelectorAll('.route-info-item span:last-child')[1]?.textContent?.toLowerCase() || '';

        const matchesSearch = !currentSearchTerm ||
            nombre.includes(currentSearchTerm) ||
            codigo.includes(currentSearchTerm) ||
            origen.includes(currentSearchTerm) ||
            destino.includes(currentSearchTerm);

        const distancia = distanciaRutas ? distanciaRutas[Number(card.dataset.routeId)] : undefined;
        const matchesFilter = currentFilter === 'all' ||
            (currentFilter === 'cercanas' && distancia !== undefined && distancia <= RADIO_CERCANAS_M);

        // Distancia a la ruta en la tarjeta mientras "Cercanas a mí" está activo
        let etiqueta = card.querySelector('.route-distancia');
        if (currentFilter === 'cercanas' && matchesFilter) {
            if (!etiqueta) {
                etiqueta = document.createElement('div');
                etiqueta.className = 'route-distancia';
                (card.querySelector('.route-body') || card).appendChild(etiqueta);
            }
            etiqueta.textContent = 'Pasa ' + textoDistancia(distancia);
        } else if (etiqueta) {
            etiqueta.remove();
        }

        if (matchesSearch && matchesFilter) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    // Con "Cercanas a mí" la más cercana va primero; con "Todas", el orden original
    const lista = document.getElementById('routesList');
    if (lista) {
        const ordenadas = [...cards].sort((a, b) => {
            if (currentFilter === 'cercanas' && distanciaRutas) {
                const da = distanciaRutas[Number(a.dataset.routeId)] ?? Infinity;
                const db = distanciaRutas[Number(b.dataset.routeId)] ?? Infinity;
                if (da !== db) return da - db;
            }
            return Number(a.dataset.orden) - Number(b.dataset.orden);
        });
        ordenadas.forEach(card => lista.appendChild(card));
    }

    // Aviso de búsqueda sin resultados (solo existe si hay rutas)
    const noResults = document.getElementById('noResultsSearch');
    // (con "Cercanas a mí" y sin texto buscado, el mensaje del filtro ya lo explica)
    const explicadoPorFiltro = currentFilter === 'cercanas' && !currentSearchTerm;
    if (noResults) noResults.style.display = visibleCount === 0 && cards.length > 0 && !explicadoPorFiltro ? 'block' : 'none';
    return visibleCount;
}

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        filterRoutes();
    }, 200);
});

// ================= TIEMPO REAL =================

let busMarkers = {};
let ultimosBuses = [];          // última respuesta de la API, para refiltrar al cambiar de ruta
let userLocation = null;
let popupIntervals = {};
let ultimoPopupAbierto = null;

function initUserLocation() {
    if (!navigator.geolocation) {
        console.warn('Geolocalización no soportada');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(position) {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            console.log('📍 Ubicación del usuario obtenida:', userLocation);
        },
        function(error) {
            console.warn('No se pudo obtener ubicación:', error.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Aviso de conexión: aparece arriba del mapa si falla la consulta y se va solo al recuperarse
function marcarConexion(ok) {
    sinConexion = !ok;
    const aviso = document.getElementById('estadoConexion');
    if (aviso) aviso.hidden = ok;
    actualizarAvisoMapa();
}

function obtenerUbicacionesBuses() {
    // Sin ruta elegida no se muestra ningún bus: no hace falta consultar
    if (rutaSeleccionada === null) return;
    fetch('/api/ubicaciones/')
        .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(data => {
            console.log('📍 Buses en tiempo real:', data.count, 'buses');
            buscandoBuses = false;
            marcarConexion(true);
            actualizarBusesEnMapa(data.buses);
        })
        .catch(error => {
            console.error('❌ Error:', error);
            marcarConexion(false);
        });
}

function actualizarBusesEnMapa(todos) {
    if (!map) return;
    ultimosBuses = todos || [];
    const buses = ultimosBuses.filter(bus => rutaSeleccionada !== null && Number(bus.ruta_id) === rutaSeleccionada);

    buses.forEach(bus => {
        const busId = Number(bus.bus_id);
        const markerId = `bus-${busId}`;
        const lat = parseFloat(bus.latitud);
        const lng = parseFloat(bus.longitud);
        const placa = escaparHtml(bus.placa);
        const ruta = escaparHtml(bus.ruta || 'Sin ruta');
        const velocidad = (Number(bus.velocidad) || 0).toFixed(1);

        const infoRuta = rutasData.find(r => r.id === Number(bus.ruta_id));
        const codigo = escaparHtml(infoRuta ? infoRuta.codigo : '');
        const color = colorDeRuta(bus.ruta_id);

        const popupContent = `
            <div class="bus-ficha" id="popup-bus-${busId}" style="--ruta: ${color}">
                <div class="bus-ficha-cab">
                    <span class="bus-ficha-placa">${placa}</span>
                    <span class="route-plate">${codigo || 'Ruta'}</span>
                </div>
                <div class="llegada nivel-neutro" id="llegada-bus-${busId}">
                    <div class="llegada-etiqueta">Calculando la llegada…</div>
                    <div class="esqueleto esqueleto-valor"></div>
                    <div class="esqueleto esqueleto-nota"></div>
                </div>
                <div class="bus-ficha-datos">
                    <span>${ruta}</span>
                    <strong>${velocidad} km/h</strong>
                </div>
            </div>
        `;

        if (busMarkers[markerId]) {
            moverSuave(busMarkers[markerId], markerId, [lat, lng], 4500);
            if (ultimoPopupAbierto !== bus.bus_id) {
                busMarkers[markerId].setPopupContent(popupContent);
            }
        } else {
            const busIcon = L.divIcon({
                className: 'bus-marker',
                html: `<div class="bus-chapa" style="--ruta: ${color}">${codigo}</div>`,
                iconSize: [52, 36],
                iconAnchor: [26, 36],
                popupAnchor: [0, -36]
            });

            const marker = L.marker([lat, lng], { icon: busIcon })
                .addTo(map)
                .bindPopup(popupContent, { className: 'popup-bus', minWidth: 240, autoPanPaddingTopLeft: [10, 64], autoPanPaddingBottomRight: [10, 60] });

            marker.on('popupopen', function() {
                console.log(`🔍 Popup abierto para bus ${bus.bus_id}`);
                ultimoPopupAbierto = bus.bus_id;

                consultarTiempoLlegada(bus.bus_id);

                if (popupIntervals[bus.bus_id]) {
                    clearInterval(popupIntervals[bus.bus_id]);
                }
                popupIntervals[bus.bus_id] = setInterval(() => {
                    consultarTiempoLlegada(bus.bus_id);
                }, 5000);
            });

            marker.on('popupclose', function() {
                if (popupIntervals[bus.bus_id]) {
                    clearInterval(popupIntervals[bus.bus_id]);
                    delete popupIntervals[bus.bus_id];
                }
                if (ultimoPopupAbierto === bus.bus_id) {
                    ultimoPopupAbierto = null;
                }
            });

            busMarkers[markerId] = marker;
        }
    });

    const activeIds = buses.map(b => `bus-${b.bus_id}`);
    Object.keys(busMarkers).forEach(id => {
        if (!activeIds.includes(id)) {
            cancelAnimationFrame(animacionesBus[id]);
            const saliente = busMarkers[id];
            delete busMarkers[id];
            saliente.setOpacity(0);   // el CSS suaviza el cambio de opacidad
            setTimeout(() => map.removeLayer(saliente), 320);
        }
    });
    actualizarAvisoMapa();
}

// Llegada estimada dentro de la ventana del bus. `nivel` solo cambia el color de la franja lateral.
function pintarLlegada(div, nivel, etiqueta, valor, nota, pequeno) {
    const anterior = div.querySelector('.llegada-valor');
    const textoAnterior = anterior ? anterior.textContent : null;
    div.className = 'llegada nivel-' + nivel;
    div.innerHTML = `<div class="llegada-etiqueta">${escaparHtml(etiqueta)}</div>` +
        (valor ? `<div class="llegada-valor${pequeno ? ' pequeno' : ''}">${escaparHtml(valor)}</div>` : '') +
        (nota ? `<div class="llegada-nota">${escaparHtml(nota)}</div>` : '');
    const nuevo = div.querySelector('.llegada-valor');
    if (nuevo && textoAnterior !== null && nuevo.textContent !== textoAnterior) nuevo.classList.add('cambia');
}

function consultarTiempoLlegada(busId) {
    const divLlegada = document.getElementById(`llegada-bus-${busId}`);
    if (!divLlegada) return;

    let url = `/api/tiempo-llegada-usuario/${busId}/`;
    if (userLocation) {
        url += `?lat=${userLocation.lat}&lng=${userLocation.lng}`;
    }

    fetch(url)
        .then(r => r.json())
        .then(data => {
            if (data.status === 'stopped') {
                pintarLlegada(divLlegada, 'neutro', 'Estado', 'Detenido', 'El bus no está en movimiento.', true);

            } else if (data.status === 'passed') {
                pintarLlegada(divLlegada, 'neutro', 'Estado', 'Ya pasó',
                    `Pasó por tu punto hace ${data.distancia_km} km.`, true);

            } else if (data.status === 'ok') {
                if (data.tiempo_texto) {
                    const nivel = data.tiempo_minutos < 5 ? 'cerca' : data.tiempo_minutos < 15 ? 'medio' : 'lejos';
                    const etiqueta = data.destino_origen === 'usuario'
                        ? 'Llega a tu ubicación en'
                        : 'Llega al punto más cercano de la ruta en';
                    pintarLlegada(divLlegada, nivel, etiqueta, data.tiempo_texto, `Distancia: ${data.distancia_km} km`);
                } else {
                    pintarLlegada(divLlegada, 'medio', 'Falta tu ubicación', '',
                        'Pulsa "Mi ubicación" para ver cuándo llega.');
                }
            }
        })
        .catch(e => {
            console.error('Error al consultar tiempo:', e);
            pintarLlegada(divLlegada, 'neutro', 'Sin conexión', '',
                'No pudimos calcular la llegada. Se intenta de nuevo solo.');
            divLlegada.classList.add('reintentando');   // gira un indicador mientras reintenta
        });
}

function initTiempoReal() {
    console.log('🔄 Iniciando monitoreo en tiempo real...');

    initUserLocation();

    obtenerUbicacionesBuses();
    setInterval(obtenerUbicacionesBuses, 5000);
}
