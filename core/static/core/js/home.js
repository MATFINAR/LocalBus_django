let map;
let userMarker;
let currentFilter = "all";
let currentSearchTerm = "";
let rutasData = [];
let routeLayers = [];

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

function cargarRutasDesdeBackend() {
    const rutasScript = document.getElementById('rutas-data');

    if (rutasScript && rutasScript.textContent) {
        try {
            rutasData = JSON.parse(rutasScript.textContent);
            console.log(`✅ ${rutasData.length} rutas cargadas`);

            if (rutasData.length > 0) {
                dibujarRutasEnMapa();
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

function dibujarRutasEnMapa() {
    if (!map) return;

    routeLayers.forEach(layer => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    routeLayers = [];

    let bounds = null;
    let rutasDibujadas = 0;

    rutasData.forEach(ruta => {
        if (ruta.coordenadas && ruta.coordenadas.length > 0) {
            const coords = ruta.coordenadas.map(p => [p[1], p[0]]);
            const color = ruta.estado === 'activa' ? '#28a745' : '#dc3545';

            const polyline = L.polyline(coords, {
                color: color,
                weight: 4,
                opacity: 0.7,
                smoothFactor: 1
            }).addTo(map);

            polyline.bindPopup(`
                <strong>${ruta.codigo || ruta.nombre}</strong><br>
                ${ruta.origen}<br>
                ${ruta.destino}<br>
                ${ruta.distancia_km || 0} km
            `);

            routeLayers.push(polyline);
            rutasDibujadas++;

            if (!bounds) {
                bounds = L.latLngBounds(coords);
            } else {
                bounds.extend(coords);
            }

            if (coords.length > 0) {
                const origenIcon = L.divIcon({
                    className: 'route-marker',
                    html: `<div style="background: #28a745; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>`,
                    iconSize: [18, 18],
                    popupAnchor: [0, -9]
                });

                const origenMarker = L.marker(coords[0], { icon: origenIcon })
                    .addTo(map)
                    .bindPopup(`<strong>🚏 Origen</strong><br>${ruta.origen}`);
                routeLayers.push(origenMarker);

                const destinoIcon = L.divIcon({
                    className: 'route-marker',
                    html: `<div style="background: #dc3545; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>`,
                    iconSize: [18, 18],
                    popupAnchor: [0, -9]
                });

                const destinoMarker = L.marker(coords[coords.length - 1], { icon: destinoIcon })
                    .addTo(map)
                    .bindPopup(`<strong>🏁 Destino</strong><br>${ruta.destino}`);
                routeLayers.push(destinoMarker);
            }

            if (ruta.paradas && ruta.paradas.length > 0) {
                ruta.paradas.forEach(parada => {
                    const paradaMarker = L.circleMarker([parada.lat, parada.lng], {
                        radius: 5,
                        fillColor: '#ffc107',
                        color: '#ffc107',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).addTo(map).bindPopup(`<small>🟡 Parada</small>`);
                    routeLayers.push(paradaMarker);
                });
            }
        }
    });

    if (bounds && rutasDibujadas > 0) {
        map.fitBounds(bounds.pad(0.1));
        console.log(`✅ ${rutasDibujadas} rutas dibujadas`);
    } else {
        mostrarMensajeSinRutas();
    }
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
            filterChips.forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.filter;
            filterRoutes();
        });
    });
}

function filterRoutes() {
    const cards = document.querySelectorAll('.route-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const nombre = card.dataset.nombre?.toLowerCase() || '';
        const origen = card.querySelector('.route-info-item span:last-child')?.textContent?.toLowerCase() || '';
        const destino = card.querySelectorAll('.route-info-item span:last-child')[1]?.textContent?.toLowerCase() || '';
        const estado = card.querySelector('.route-badge')?.textContent?.includes('Activa') ? 'activa' : 'inactiva';

        const matchesSearch = !currentSearchTerm ||
            nombre.includes(currentSearchTerm) ||
            origen.includes(currentSearchTerm) ||
            destino.includes(currentSearchTerm);

        const matchesFilter = currentFilter === 'all' ||
            (currentFilter === 'activa' && estado === 'activa');

        if (matchesSearch && matchesFilter) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    const noResults = document.querySelector('.no-results');
    if (visibleCount === 0 && cards.length > 0) {
        if (noResults) noResults.style.display = 'block';
    } else {
        if (noResults) noResults.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        filterRoutes();
    }, 200);
});

// ================= TIEMPO REAL =================

let busMarkers = {};
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
    fetch('/api/ubicaciones/')
        .then(response => response.json())
        .then(data => {
            console.log('📍 Buses en tiempo real:', data.count, 'buses');
            actualizarBusesEnMapa(data.buses);
        })
        .catch(error => console.error('❌ Error:', error));
}

function actualizarBusesEnMapa(buses) {
    if (!map) return;

    buses.forEach(bus => {
        const markerId = `bus-${bus.bus_id}`;
        const lat = parseFloat(bus.latitud);
        const lng = parseFloat(bus.longitud);

        const popupContent = `
            <div id="popup-bus-${bus.bus_id}" style="
                padding: 12px;
                font-family: sans-serif;
                min-width: 240px;
            ">
                <div style="text-align: center; margin-bottom: 12px;">
                    <strong style="font-size: 18px; color: #1D3557;">🚌 ${bus.placa}</strong><br>
                    <span style="color: #6C757D; font-size: 12px;">${bus.ruta || 'Sin ruta'}</span><br>
                    <span style="color: #6C757D; font-size: 12px;">👨‍✈️ ${bus.conductor || 'Sin conductor'}</span>
                </div>

                <div id="llegada-bus-${bus.bus_id}" style="
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
                        <div style="color: #1D3557; font-weight: 700;">${(bus.velocidad || 0).toFixed(1)} km/h</div>
                    </div>
                    <div style="background: #F8F9FA; padding: 8px; border-radius: 8px; text-align: center;">
                        <div style="color: #6C757D; font-size: 10px;">RUTA</div>
                        <div style="color: #1D3557; font-weight: 700; font-size: 11px;">${bus.ruta || '--'}</div>
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
                        📏 Hace ${data.distancia_km} km
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
                            ${data.tiempo_texto}
                        </div>
                        <div style="font-size: 11px; opacity: 0.85; margin-top: 6px;">
                            ${etiquetaDestino}
                        </div>
                        <div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">
                            📏 ${data.distancia_km} km
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