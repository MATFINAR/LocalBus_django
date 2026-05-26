// home.js - Corregido para deshabilitar zoom con scroll

const rutasFicticias = [
    {
        id: 1,
        numero: "Ruta 10",
        nombre: "Centro ↔ Terminal Norte",
        origen: "Centro Histórico",
        destino: "Terminal del Norte",
        horarios: ["05:30", "06:15", "07:00", "08:00", "09:00"],
        frecuencia: "15 min",
        estado: "activa",
        distancia: "12.5 km",
        duracion: "35 min",
        paradas: 18,
        lat: 4.7110,
        lng: -74.0721
    },
    {
        id: 2,
        numero: "Ruta 15",
        nombre: "Universidad ↔ Plaza Mayor",
        origen: "Universidad Nacional",
        destino: "Plaza Mayor",
        horarios: ["06:00", "06:45", "07:30", "08:15", "09:00"],
        frecuencia: "20 min",
        estado: "activa",
        distancia: "8.3 km",
        duracion: "25 min",
        paradas: 12,
        lat: 4.6380,
        lng: -74.0807
    },
    {
        id: 3,
        numero: "Ruta 20",
        nombre: "Aeropuerto ↔ Centro",
        origen: "Aeropuerto Internacional",
        destino: "Centro de la ciudad",
        horarios: ["04:30", "05:30", "06:30", "07:30", "08:30"],
        frecuencia: "30 min",
        estado: "activa",
        distancia: "15.2 km",
        duracion: "45 min",
        paradas: 22,
        lat: 4.7016,
        lng: -74.1469
    },
    {
        id: 4,
        numero: "Ruta 25",
        nombre: "Zona Rosa ↔ Estadio",
        origen: "Zona Rosa",
        destino: "Estadio Metropolitano",
        horarios: ["07:00", "08:00", "09:00", "10:00", "11:00"],
        frecuencia: "25 min",
        estado: "activa",
        distancia: "9.8 km",
        duracion: "30 min",
        paradas: 14,
        lat: 4.6683,
        lng: -74.1066
    },
    {
        id: 5,
        numero: "Ruta 30",
        nombre: "Norte ↔ Sur (Express)",
        origen: "Terminal del Norte",
        destino: "Terminal del Sur",
        horarios: ["05:00", "06:00", "07:00", "08:00", "09:00"],
        frecuencia: "15 min",
        estado: "activa",
        distancia: "18.6 km",
        duracion: "50 min",
        paradas: 8,
        lat: 4.6006,
        lng: -74.1050
    },
    {
        id: 6,
        numero: "Ruta 35",
        nombre: "Centro ↔ Parque Industrial",
        origen: "Centro",
        destino: "Parque Industrial",
        horarios: ["06:30", "07:15", "08:00", "08:45", "09:30"],
        frecuencia: "20 min",
        estado: "cercana",
        distancia: "11.4 km",
        duracion: "32 min",
        paradas: 16,
        lat: 4.6243,
        lng: -74.1845
    },
    {
        id: 7,
        numero: "Ruta 40",
        nombre: "Circular Centro",
        origen: "Plaza Central",
        destino: "Plaza Central",
        horarios: ["06:00", "07:00", "08:00", "09:00", "10:00"],
        frecuencia: "15 min",
        estado: "activa",
        distancia: "6.5 km",
        duracion: "20 min",
        paradas: 10,
        lat: 4.6548,
        lng: -74.0739
    },
    {
        id: 8,
        numero: "Ruta 45",
        nombre: "Norte ↔ Zona Franca",
        origen: "Terminal del Norte",
        destino: "Zona Franca",
        horarios: ["05:45", "06:45", "07:45", "08:45", "09:45"],
        frecuencia: "25 min",
        estado: "activa",
        distancia: "14.2 km",
        duracion: "40 min",
        paradas: 20,
        lat: 4.6893,
        lng: -74.1432
    }
];

let map;
let userMarker;
let currentFilter = "all";
let currentSearchTerm = "";

// Esperar a que el DOM y Leaflet estén listos
document.addEventListener('DOMContentLoaded', function() {
    // Pequeño retraso para asegurar que el contenedor del mapa existe
    setTimeout(function() {
        initMap();
        initSearchPanel();
        renderRoutes(rutasFicticias);
    }, 100);
    
    // Botón de ubicación
    const locateBtn = document.getElementById('locateBtn');
    if (locateBtn) {
        locateBtn.addEventListener('click', locateUser);
    }
});

// Inicializar mapa
function initMap() {
    // Verificar que el contenedor del mapa existe
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
        console.error('No se encontró el contenedor del mapa');
        return;
    }
    
    // Verificar que Leaflet está cargado
    if (typeof L === 'undefined') {
        console.error('Leaflet no está cargado');
        return;
    }
    
    try {
        // Coordenadas de Bogotá como centro por defecto
        // scrollWheelZoom: false -> deshabilita el zoom con la rueda del mouse
        map = L.map('map', {
            scrollWheelZoom: false,  // Esto evita que el scroll haga zoom
            zoomControl: true        // Mantiene los botones de zoom +/- 
        }).setView([4.7110, 74.0721], 13);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19,
            minZoom: 10
        }).addTo(map);
        
        // Forzar actualización del tamaño del mapa
        setTimeout(function() {
            if (map) {
                map.invalidateSize();
            }
        }, 200);
        
        console.log('Mapa inicializado correctamente - Scroll deshabilitado');
        
    } catch (error) {
        console.error('Error al inicializar el mapa:', error);
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
    
    // Toggle del panel
    if (searchToggle && searchBody) {
        searchToggle.addEventListener('click', function() {
            searchBody.classList.toggle('collapsed');
            searchToggle.textContent = searchBody.classList.contains('collapsed') ? '+' : '−';
        });
    }
    
    // Búsqueda en tiempo real
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            currentSearchTerm = e.target.value.toLowerCase();
            if (clearBtn) {
                clearBtn.style.display = currentSearchTerm ? 'block' : 'none';
            }
            filterAndRenderRoutes();
        });
    }
    
    // Limpiar búsqueda
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (searchInput) {
                searchInput.value = '';
            }
            currentSearchTerm = '';
            clearBtn.style.display = 'none';
            filterAndRenderRoutes();
            if (searchInput) {
                searchInput.focus();
            }
        });
    }
    
    // Filtros
    filterChips.forEach(chip => {
        chip.addEventListener('click', function() {
            filterChips.forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.filter;
            filterAndRenderRoutes();
        });
    });
}

// Filtrar y renderizar rutas
function filterAndRenderRoutes() {
    let filteredRoutes = [...rutasFicticias];
    
    // Filtrar por término de búsqueda
    if (currentSearchTerm) {
        filteredRoutes = filteredRoutes.filter(route =>
            route.numero.toLowerCase().includes(currentSearchTerm) ||
            route.nombre.toLowerCase().includes(currentSearchTerm) ||
            route.origen.toLowerCase().includes(currentSearchTerm) ||
            route.destino.toLowerCase().includes(currentSearchTerm)
        );
    }
    
    // Filtrar por estado
    if (currentFilter === 'activa') {
        filteredRoutes = filteredRoutes.filter(route => route.estado === 'activa');
    } else if (currentFilter === 'cercana') {
        filteredRoutes = filteredRoutes.filter(route => route.estado === 'cercana');
    }
    
    renderRoutes(filteredRoutes);
}

// Renderizar tarjetas de rutas
function renderRoutes(routes) {
    const routesList = document.getElementById('routesList');
    const noResults = document.getElementById('noResults');
    
    if (!routesList) return;
    
    if (routes.length === 0) {
        routesList.innerHTML = '';
        if (noResults) noResults.style.display = 'block';
        return;
    }
    
    if (noResults) noResults.style.display = 'none';
    
    // Simular próxima salida
    const getNextBus = () => {
        const now = new Date();
        const minutes = now.getMinutes();
        if (minutes < 15) return "en 5 min";
        if (minutes < 30) return "en 12 min";
        if (minutes < 45) return "en 8 min";
        return "en 3 min";
    };
    
    routesList.innerHTML = routes.map(route => `
        <div class="route-card" data-route-id="${route.id}" data-lat="${route.lat}" data-lng="${route.lng}" data-name="${route.nombre}">
            <div class="route-header">
                <span class="route-number">${route.numero}</span>
                <span class="route-badge ${route.estado}">
                    ${route.estado === 'activa' ? '🟢 Activa' : '📍 Cercana'}
                </span>
            </div>
            <div class="route-name">${route.nombre}</div>
            <div class="route-info">
                <div class="route-info-item">
                    <span>🏁</span>
                    <span>${route.origen}</span>
                </div>
                <div class="route-info-item">
                    <span>🏁</span>
                    <span>${route.destino}</span>
                </div>
            </div>
            <div class="route-info">
                <div class="route-info-item">
                    <span>⏱️</span>
                    <span>${route.duracion}</span>
                </div>
                <div class="route-info-item">
                    <span>📏</span>
                    <span>${route.distancia}</span>
                </div>
                <div class="route-info-item">
                    <span>🚏</span>
                    <span>${route.paradas} paradas</span>
                </div>
            </div>
            <div class="route-schedule">
                <div class="route-time">
                    <span>⏰</span>
                    <span>Frec: ${route.frecuencia}</span>
                </div>
                <div class="route-next-bus">
                    🚌 Próximo: ${getNextBus()}
                </div>
            </div>
        </div>
    `).join('');
    
    // Agregar evento click a las tarjetas
    document.querySelectorAll('.route-card').forEach(card => {
        card.addEventListener('click', function() {
            const lat = parseFloat(this.dataset.lat);
            const lng = parseFloat(this.dataset.lng);
            const name = this.dataset.name;
            
            if (map) {
                map.setView([lat, lng], 14);
                
                L.popup()
                    .setLatLng([lat, lng])
                    .setContent(`<strong>🚍 ${name}</strong><br>Punto de inicio de ruta`)
                    .openOn(map);
            }
        });
    });
}