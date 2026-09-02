let map;
let userMarker;
let currentFilter = "all";
let currentSearchTerm = "";
let rutasData = [];
let routeLayers = [];

// Esperar a que el DOM y Leaflet estén listos
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        initMap();
        initSearchPanel();
        cargarRutasDesdeBackend(); // Cargar rutas desde la BD
    }, 100);
    
    const locateBtn = document.getElementById('locateBtn');
    if (locateBtn) {
        locateBtn.addEventListener('click', locateUser);
    }
});

// Inicializar mapa con OpenStreetMap
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
        }).setView([6.2518, -75.5636], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            minZoom: 10
        }).addTo(map);
        
        setTimeout(function() {
            if (map) {
                map.invalidateSize();
            }
        }, 200);
        
        setTimeout(function() {
            if (map) {
                map.invalidateSize();
            }
        }, 500);
        
        console.log('Mapa inicializado correctamente con OpenStreetMap');
        
    } catch (error) {
        console.error('Error al inicializar el mapa:', error);
    }
}

function cargarRutasDesdeBackend() {
    const rutasScript = document.getElementById('rutas-data');
    
    if (rutasScript && rutasScript.textContent) {
        try {
            rutasData = JSON.parse(rutasScript.textContent);
            console.log(`✅ ${rutasData.length} rutas cargadas desde la base de datos`);
            
            if (rutasData.length > 0) {
                dibujarRutasEnMapa();
            } else {
                console.warn('⚠️ No hay rutas en la base de datos');
                mostrarMensajeSinRutas();
            }
        } catch (e) {
            console.error('❌ Error parseando datos de rutas:', e);
            mostrarMensajeError();
        }
    } else {
        console.warn('⚠️ No se encontraron datos de rutas en el HTML');
        mostrarMensajeSinRutas();
    }
}

// Dibujar rutas en el mapa (usando datos de la BD)
function dibujarRutasEnMapa() {
    if (!map) {
        console.warn('Mapa no inicializado');
        return;
    }
    
    // Limpiar capas anteriores
    routeLayers.forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    routeLayers = [];
    
    let bounds = null;
    let rutasDibujadas = 0;
    
    rutasData.forEach(ruta => {
        // Verificar si la ruta tiene coordenadas en la BD
        if (ruta.coordenadas && ruta.coordenadas.length > 0) {
            // Convertir coordenadas al formato de Leaflet [lat, lng]
            const coords = ruta.coordenadas.map(p => [p[1], p[0]]);
            
            // Color según estado
            const color = ruta.estado === 'activa' ? '#28a745' : '#dc3545';
            
            // Dibujar línea de la ruta
            const polyline = L.polyline(coords, {
                color: color,
                weight: 4,
                opacity: 0.7,
                smoothFactor: 1
            }).addTo(map);
            
            // Popup con información
            polyline.bindPopup(`
                <strong>${ruta.codigo || ruta.nombre}</strong><br>
                <i class="fas fa-map-marker-alt"></i> ${ruta.origen}<br>
                <i class="fas fa-map-marker-alt"></i> ${ruta.destino}<br>
                <i class="fas fa-road"></i> ${ruta.distancia_km || 0} km
            `);
            
            routeLayers.push(polyline);
            rutasDibujadas++;
            
            // Actualizar bounds
            if (!bounds) {
                bounds = L.latLngBounds(coords);
            } else {
                bounds.extend(coords);
            }
            
            // Marcar origen y destino
            if (coords.length > 0) {
                // Origen
                const origenIcon = L.divIcon({
                    className: 'route-marker',
                    html: `<div style="background: #28a745; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 2px #28a745;"></div>`,
                    iconSize: [18, 18],
                    popupAnchor: [0, -9]
                });
                
                const origenMarker = L.marker(coords[0], { icon: origenIcon })
                    .addTo(map)
                    .bindPopup(`<strong>🚏 Origen</strong><br>${ruta.origen}`);
                routeLayers.push(origenMarker);
                
                // Destino
                const destinoIcon = L.divIcon({
                    className: 'route-marker',
                    html: `<div style="background: #dc3545; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 2px #dc3545;"></div>`,
                    iconSize: [18, 18],
                    popupAnchor: [0, -9]
                });
                
                const destinoMarker = L.marker(coords[coords.length - 1], { icon: destinoIcon })
                    .addTo(map)
                    .bindPopup(`<strong>🏁 Destino</strong><br>${ruta.destino}`);
                routeLayers.push(destinoMarker);
            }
            
            // Marcar paradas desde la BD
            if (ruta.paradas && ruta.paradas.length > 0) {
                ruta.paradas.forEach(parada => {
                    const paradaMarker = L.circleMarker([parada.lat, parada.lng], {
                        radius: 5,
                        fillColor: '#ffc107',
                        color: '#ffc107',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).addTo(map)
                    .bindPopup(`<small>🟡 Parada</small>`);
                    routeLayers.push(paradaMarker);
                });
            }
        }
    });
    
    // Ajustar el mapa para mostrar todas las rutas
    if (bounds && rutasDibujadas > 0) {
        map.fitBounds(bounds.pad(0.1));
        console.log(`✅ ${rutasDibujadas} rutas dibujadas en el mapa`);
    } else {
        console.warn('⚠️ No se pudieron dibujar rutas en el mapa');
        mostrarMensajeSinRutas();
    }
}

// Mostrar mensaje cuando no hay rutas
function mostrarMensajeSinRutas() {
    // Agregar un marcador de texto en el mapa
    if (map) {
        const mensaje = L.control({ position: 'bottomright' });
        mensaje.onAdd = function() {
            const div = L.DomUtil.create('div', 'info-mensaje');
            div.innerHTML = `
                <div style="background: rgba(0,0,0,0.7); color: white; padding: 10px 15px; border-radius: 8px; font-size: 14px;">
                    🚌 No hay rutas registradas en la base de datos
                </div>
            `;
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
            div.innerHTML = `
                <div style="background: rgba(255,0,0,0.8); color: white; padding: 10px 15px; border-radius: 8px; font-size: 14px;">
                    ❌ Error cargando datos de rutas
                </div>
            `;
            return div;
        };
        mensaje.addTo(map);
    }
}

// Localizar usuario
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
            
            if (userMarker) {
                map.removeLayer(userMarker);
            }
            
            const customIcon = L.divIcon({
                className: 'user-location-marker',
                html: '<div style="background: #E63946; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #E63946;"></div>',
                iconSize: [22, 22],
                popupAnchor: [0, -11]
            });
            
            userMarker = L.marker([lat, lng], { icon: customIcon })
                .addTo(map)
                .bindPopup('<strong>📍 Tu ubicación</strong>')
                .openPopup();
            
            locateBtn.disabled = false;
            locateBtn.textContent = '📍 Mi Ubicación';
        },
        function(error) {
            console.error('Error de geolocalización:', error);
            let errorMessage = 'No se pudo obtener tu ubicación. ';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage += 'Permiso denegado.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage += 'Información no disponible.';
                    break;
                case error.TIMEOUT:
                    errorMessage += 'Tiempo de espera agotado.';
                    break;
            }
            alert(errorMessage);
            locateBtn.disabled = false;
            locateBtn.textContent = '📍 Mi Ubicación';
        }
    );
}

// Inicializar panel de búsqueda
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
            if (clearBtn) {
                clearBtn.style.display = currentSearchTerm ? 'block' : 'none';
            }
            filterRoutes();
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (searchInput) {
                searchInput.value = '';
            }
            currentSearchTerm = '';
            clearBtn.style.display = 'none';
            filterRoutes();
            if (searchInput) {
                searchInput.focus();
            }
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

// Filtrar rutas desde el DOM
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
        if (noResults) {
            noResults.style.display = 'block';
        }
    } else {
        if (noResults) {
            noResults.style.display = 'none';
        }
    }
}

// Inicializar filtros al cargar
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        filterRoutes();
    }, 200);
});