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
let avisoMapa = null;           // recuadro sobre el mapa con la ruta elegida o la indicación

document.addEventListener('DOMContentLoaded', function() {
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
            zoomControl: true,
            zoom: 13,
            minZoom: 10,
            maxZoom: 19
        }).setView([6.2442, -75.5812], 13);

        L.TileLayer.prototype.options.referrerPolicy = 'strict-origin-when-cross-origin';

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            minZoom: 10
        }).addTo(map);

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

function seleccionarRuta(id) {
    rutaSeleccionada = rutaSeleccionada === id ? null : id;

    document.querySelectorAll('.route-card').forEach(card => {
        const elegida = Number(card.dataset.routeId) === rutaSeleccionada;
        card.classList.toggle('seleccionada', elegida);
        card.setAttribute('aria-pressed', elegida ? 'true' : 'false');
    });

    limpiarRutaDelMapa();
    const ruta = rutasData.find(r => r.id === rutaSeleccionada);
    if (ruta) dibujarRuta(ruta);

    // Los buses se filtran por la ruta elegida (sin ruta elegida no se muestra ninguno)
    actualizarBusesEnMapa(ultimosBuses);
    actualizarAvisoMapa();
    if (rutaSeleccionada !== null) obtenerUbicacionesBuses();
}

function limpiarRutaDelMapa() {
    routeLayers.forEach(layer => {
        if (map && map.hasLayer(layer)) map.removeLayer(layer);
    });
    routeLayers = [];
}

function dibujarRuta(ruta) {
    if (!map || !ruta.coordenadas || ruta.coordenadas.length === 0) return;

    const coords = ruta.coordenadas.map(p => [p[1], p[0]]);
    const color = (ruta.estado || '').toLowerCase() === 'activa' ? '#28a745' : '#dc3545';

    const polyline = L.polyline(coords, {
        color: color,
        weight: 5,
        opacity: 0.8,
        smoothFactor: 1
    }).addTo(map);
    routeLayers.push(polyline);

    const origenIcon = L.divIcon({
        className: 'route-marker',
        html: `<div style="background: #28a745; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>`,
        iconSize: [18, 18],
        popupAnchor: [0, -9]
    });
    routeLayers.push(L.marker(coords[0], { icon: origenIcon })
        .addTo(map)
        .bindPopup(`<strong>🚏 Origen</strong><br>${escaparHtml(ruta.origen)}`));

    const destinoIcon = L.divIcon({
        className: 'route-marker',
        html: `<div style="background: #dc3545; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>`,
        iconSize: [18, 18],
        popupAnchor: [0, -9]
    });
    routeLayers.push(L.marker(coords[coords.length - 1], { icon: destinoIcon })
        .addTo(map)
        .bindPopup(`<strong>🏁 Destino</strong><br>${escaparHtml(ruta.destino)}`));

    (ruta.paradas || []).forEach(parada => {
        routeLayers.push(L.circleMarker([parada.lat, parada.lng], {
            radius: 5,
            fillColor: '#ffc107',
            color: '#ffc107',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map).bindPopup(`<small>🟡 Parada</small>`));
    });

    map.fitBounds(L.latLngBounds(coords).pad(0.1));
}

// Recuadro sobre el mapa: qué hacer si no hay ruta elegida, o qué ruta se ve y cuántos buses tiene
function actualizarAvisoMapa() {
    if (!map) return;
    if (!avisoMapa) {
        avisoMapa = L.control({ position: 'bottomright' });
        avisoMapa.onAdd = function() {
            return L.DomUtil.create('div', 'mapa-aviso-ruta');
        };
        avisoMapa.addTo(map);
    }
    const caja = avisoMapa.getContainer();
    if (!caja) return;

    const ruta = rutasData.find(r => r.id === rutaSeleccionada);
    if (!ruta) {
        caja.textContent = '👈 Elige una ruta de la lista para ver su recorrido y sus buses';
        return;
    }
    const buses = Object.keys(busMarkers).length;
    const sinTrazado = !ruta.coordenadas || ruta.coordenadas.length === 0;
    caja.textContent = `🚍 ${ruta.codigo || ruta.nombre}` +
        (sinTrazado ? ' · sin recorrido trazado' : '') +
        ` · ${buses === 0 ? 'sin buses en vivo' : buses === 1 ? '1 bus en vivo' : buses + ' buses en vivo'}`;
}

function mostrarMensajeSinRutas() {
    if (map) {
        const mensaje = L.control({ position: 'bottomright' });
        mensaje.onAdd = function() {
            const div = L.DomUtil.create('div', 'info-mensaje');
            div.innerHTML = `<div style="background: rgba(0,0,0,0.7); color: white; padding: 10px 15px; border-radius: 8px; font-size: 14px;">🚌 No hay rutas registradas</div>`;
            return div;
        };
        mensaje.addTo(map);
    }
}

function mostrarMensajeError() {
    if (map) {
        const mensaje = L.control({ position: 'bottomright' });
        mensaje.onAdd = function() {
            const div = L.DomUtil.create('div', 'info-mensaje');
            div.innerHTML = `<div style="background: rgba(255,0,0,0.8); color: white; padding: 10px 15px; border-radius: 8px; font-size: 14px;">❌ Error cargando rutas</div>`;
            return div;
        };
        mensaje.addTo(map);
    }
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
    locateBtn.textContent = '📍 Obteniendo ubicación...';

    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            map.setView([lat, lng], 15);

            if (userMarker) map.removeLayer(userMarker);

            const customIcon = L.divIcon({
                className: 'user-location-marker',
                html: '<div style="background: #E63946; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white;"></div>',
                iconSize: [22, 22],
                popupAnchor: [0, -11]
            });

            userMarker = L.marker([lat, lng], { icon: customIcon })
                .addTo(map)
                .bindPopup('<strong>📍 Tu ubicación</strong>')
                .openPopup();

            userLocation = { lat: lat, lng: lng };

            locateBtn.disabled = false;
            locateBtn.textContent = '📍 Mi Ubicación';
        },
        function(error) {
            alert('No se pudo obtener tu ubicación');
            locateBtn.disabled = false;
            locateBtn.textContent = '📍 Mi Ubicación';
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
    mostrarMensajeFiltro('📍 Obteniendo tu ubicación...');
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
        mostrarMensajeFiltro('⚠️ ' + error.message);
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
            html: '<div style="background: #E63946; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white;"></div>',
            iconSize: [22, 22],
            popupAnchor: [0, -11]
        })
    }).addTo(map).bindPopup('<strong>📍 Tu ubicación</strong>');

    if (circuloCercanas) map.removeLayer(circuloCercanas);
    circuloCercanas = L.circle([yo.lat, yo.lng], {
        radius: RADIO_CERCANAS_M,
        color: '#457B9D',
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
                card.appendChild(etiqueta);
            }
            etiqueta.textContent = '📍 Pasa ' + textoDistancia(distancia);
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

function obtenerUbicacionesBuses() {
    // Sin ruta elegida no se muestra ningún bus: no hace falta consultar
    if (rutaSeleccionada === null) return;
    fetch('/api/ubicaciones/')
        .then(response => response.json())
        .then(data => {
            console.log('📍 Buses en tiempo real:', data.count, 'buses');
            actualizarBusesEnMapa(data.buses);
        })
        .catch(error => console.error('❌ Error:', error));
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

        const popupContent = `
            <div id="popup-bus-${busId}" style="
                padding: 12px;
                font-family: sans-serif;
                min-width: 240px;
            ">
                <div style="text-align: center; margin-bottom: 12px;">
                    <strong style="font-size: 18px; color: #1D3557;">🚌 ${placa}</strong><br>
                    <span style="color: #6C757D; font-size: 12px;">${ruta}</span><br>

                    </div>

                <div id="llegada-bus-${busId}" style="
                    background: linear-gradient(135deg, #1D3557 0%, #2A4A6E 100%);
                    border-radius: 12px;
                    padding: 14px;
                    text-align: center;
                    color: white;
                ">
                    <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">
                        CALCULANDO...
                    </div>
                    <div style="font-size: 28px; font-weight: 700;">⏳</div>
                </div>

                <div style="
                    margin-top: 10px;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    font-size: 12px;
                ">
                    <div style="background: #F8F9FA; padding: 8px; border-radius: 8px; text-align: center;">
                        <div style="color: #6C757D; font-size: 10px;">VELOCIDAD</div>
                        <div style="color: #1D3557; font-weight: 700;">${velocidad} km/h</div>
                    </div>
                    <div style="background: #F8F9FA; padding: 8px; border-radius: 8px; text-align: center;">
                        <div style="color: #6C757D; font-size: 10px;">RUTA</div>
                        <div style="color: #1D3557; font-weight: 700; font-size: 11px;">${bus.ruta ? ruta : '--'}</div>
                    </div>
                </div>
            </div>
        `;

        if (busMarkers[markerId]) {
            busMarkers[markerId].setLatLng([lat, lng]);
            if (ultimoPopupAbierto !== bus.bus_id) {
                busMarkers[markerId].setPopupContent(popupContent);
            }
        } else {
            const busIcon = L.divIcon({
                className: 'bus-marker',
                html: `
                    <div style="
                        background: #1D3557;
                        color: white;
                        border-radius: 50%;
                        width: 44px;
                        height: 44px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 3px solid #4ade80;
                        box-shadow: 0 3px 12px rgba(0,0,0,0.4);
                        font-size: 22px;
                        animation: pulse-bus 2s infinite;
                    ">🚌</div>
                `,
                iconSize: [44, 44],
                popupAnchor: [0, -22]
            });

            const marker = L.marker([lat, lng], { icon: busIcon })
                .addTo(map)
                .bindPopup(popupContent);

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
            map.removeLayer(busMarkers[id]);
            delete busMarkers[id];
        }
    });
    actualizarAvisoMapa();
}

// ✅ CONSULTAR TIEMPO DE LLEGADA
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
            if (!divLlegada) return;

            if (data.status === 'stopped') {
                divLlegada.innerHTML = `
                    <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">
                        ESTADO
                    </div>
                    <div style="font-size: 22px; font-weight: 700;">🛑 Detenido</div>
                    <div style="font-size: 11px; opacity: 0.9; margin-top: 4px;">
                        El bus no está en movimiento
                    </div>
                `;
                divLlegada.style.background = 'linear-gradient(135deg, #6C757D 0%, #495057 100%)';

            } else if (data.status === 'passed') {
                divLlegada.innerHTML = `
                    <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">
                        ESTADO
                    </div>
                    <div style="font-size: 22px; font-weight: 700;">🚏 Ya pasó</div>
                    <div style="font-size: 11px; opacity: 0.9; margin-top: 4px;">
                        El bus ya pasó por tu punto
                    </div>
                    <div style="font-size: 11px; opacity: 0.8; margin-top: 6px;">
                        📏 Hace ${escaparHtml(data.distancia_km)} km
                    </div>
                `;
                divLlegada.style.background = 'linear-gradient(135deg, #495057 0%, #212529 100%)';

            } else if (data.status === 'ok') {
                if (data.tiempo_texto) {
                    const color = data.tiempo_minutos < 5 ? '#2E7D32' :
                                  data.tiempo_minutos < 15 ? '#F39C12' : '#1D3557';

                    const etiquetaDestino = data.destino_origen === 'usuario'
                        ? '📍 Tu ubicación'
                        : '🚏 Punto más cercano de la ruta';

                    divLlegada.innerHTML = `
                        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">
                            LLEGADA ESTIMADA
                        </div>
                        <div style="font-size: 32px; font-weight: 700; line-height: 1;">
                            ${escaparHtml(data.tiempo_texto)}
                        </div>
                        <div style="font-size: 11px; opacity: 0.85; margin-top: 6px;">
                            ${etiquetaDestino}
                        </div>
                        <div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">
                            📏 ${escaparHtml(data.distancia_km)} km
                        </div>
                    `;
                    divLlegada.style.background = `linear-gradient(135deg, ${color} 0%, ${color}DD 100%)`;
                } else {
                    divLlegada.innerHTML = `
                        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">
                            UBICACIÓN REQUERIDA
                        </div>
                        <div style="font-size: 14px; font-weight: 600; margin-top: 6px;">
                            📍 Activa tu ubicación
                        </div>
                        <div style="font-size: 11px; opacity: 0.8; margin-top: 6px;">
                            para ver el tiempo de llegada
                        </div>
                    `;
                    divLlegada.style.background = 'linear-gradient(135deg, #F39C12 0%, #E67E22 100%)';
                }
            }
        })
        .catch(e => {
            console.error('Error al consultar tiempo:', e);
            if (divLlegada) {
                divLlegada.innerHTML = `
                    <div style="font-size: 11px; opacity: 0.8;">ERROR</div>
                    <div style="font-size: 14px; font-weight: 600;">❌ Sin conexión</div>
                `;
            }
        });
}

function initTiempoReal() {
    console.log('🔄 Iniciando monitoreo en tiempo real...');

    initUserLocation();

    obtenerUbicacionesBuses();
    setInterval(obtenerUbicacionesBuses, 5000);
}

// ================= ESTILOS DINÁMICOS =================

const busStyles = document.createElement('style');
busStyles.textContent = `
    @keyframes pulse-bus {
        0%, 100% {
            transform: scale(1);
            box-shadow: 0 3px 12px rgba(0,0,0,0.4);
        }
        50% {
            transform: scale(1.1);
            box-shadow: 0 3px 20px rgba(74, 222, 128, 0.6);
        }
    }

    .leaflet-popup-content-wrapper {
        border-radius: 16px !important;
        padding: 0 !important;
    }

    .leaflet-popup-content {
        margin: 0 !important;
        padding: 0 !important;
    }
`;
document.head.appendChild(busStyles);