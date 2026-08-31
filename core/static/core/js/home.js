// home.js - Rutas desde la base de datos

let map;
let userMarker;
let currentFilter = "all";
let currentSearchTerm = "";

// Esperar a que el DOM y Leaflet estén listos
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        initMap();
        initSearchPanel();
    }, 100);
    
    const locateBtn = document.getElementById('locateBtn');
    if (locateBtn) {
        locateBtn.addEventListener('click', locateUser);
    }
});

// Inicializar mapa
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
            scrollWheelZoom: false,
            zoomControl: true
        }).setView([6.2518, -75.5636], 13);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            subdomains: 'abcd',
            maxZoom: 19,
            minZoom: 10
        }).addTo(map);
        
        setTimeout(function() {
            if (map) {
                map.invalidateSize();
            }
        }, 200);
        
        console.log('Mapa inicializado correctamente');
        
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
            filterRoutes();
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
            filterRoutes();
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
            filterRoutes();
        });
    });
}

// Filtrar rutas desde el DOM (las tarjetas ya están en el HTML)
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
    
    // Mostrar mensaje de no resultados
    const noResults = document.querySelector('.no-results');
    const routesList = document.getElementById('routesList');
    
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
        // Forzar un filtro inicial para que las tarjetas se muestren
        filterRoutes();
    }, 200);
});