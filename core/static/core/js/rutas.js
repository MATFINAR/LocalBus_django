// Variables globales
let createMap = null;
let editMap = null;
let createDrawnItems = null;
let editDrawnItems = null;
let createOriginMarker = null;
let createDestinyMarker = null;
let editOriginMarker = null;
let editDestinyMarker = null;
let createRouteLine = null;
let editRouteLine = null;
let createMode = 'view';
let editMode = 'view';
let editId = null;
let isGenerating = false;

document.addEventListener('DOMContentLoaded', function () {
    // ================= FILTROS =================
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');

    function filterTable() {
        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const status = statusFilter ? statusFilter.value : '';
        const rows = document.querySelectorAll('#rutasTableBody tr');
        let visibleCount = 0;

        rows.forEach(row => {
            if (row.classList.contains('rutas-empty')) return;

            const nombre = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
            const origen = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
            const destino = row.querySelector('td:nth-child(5)')?.textContent?.toLowerCase() || '';
            const rowStatus = row.dataset.status || '';

            const matchesSearch = !term || nombre.includes(term) || origen.includes(term) || destino.includes(term);
            const matchesStatus = !status || rowStatus === status;

            if (matchesSearch && matchesStatus) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        });

        showNoResultsMessage(visibleCount);
    }

    function showNoResultsMessage(visibleCount) {
        let noResults = document.querySelector('.rutas-no-results');
        const tbody = document.getElementById('rutasTableBody');
        if (!tbody) return;

        if (visibleCount > 0) {
            if (noResults) noResults.remove();
            return;
        }

        if (!noResults) {
            noResults = document.createElement('tr');
            noResults.className = 'rutas-no-results';
            noResults.innerHTML = `
                <td colspan="11" style="text-align: center; padding: 3rem 1rem; color: #999;">
                    <p>🔍 No se encontraron rutas</p>
                </td>
            `;
            tbody.appendChild(noResults);
        }
    }

    if (searchInput) searchInput.addEventListener('keyup', filterTable);
    if (statusFilter) statusFilter.addEventListener('change', filterTable);

    // ================= INICIALIZAR MAPAS =================
    function initCreateMap() {
        const container = document.getElementById('createMap');
        if (!container) return;

        createMap = L.map('createMap').setView([4.5709, -74.2973], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(createMap);

        createDrawnItems = new L.FeatureGroup();
        createMap.addLayer(createDrawnItems);

        // Control de geocodificación
        L.Control.geocoder({
            position: 'topleft',
            placeholder: 'Buscar dirección...',
            defaultMarkGeocode: false
        }).on('markgeocode', function(e) {
            const latlng = e.geocode.center;
            if (createMode === 'origin') {
                setOriginPoint('create', latlng, e.geocode.name);
            } else if (createMode === 'destiny') {
                setDestinyPoint('create', latlng, e.geocode.name);
            }
        }).addTo(createMap);

        // Click en el mapa
        createMap.on('click', function(e) {
            if (createMode === 'origin') {
                setOriginPoint('create', e.latlng, '');
            } else if (createMode === 'destiny') {
                setDestinyPoint('create', e.latlng, '');
            }
        });
    }

    function initEditMap() {
        const container = document.getElementById('editMap');
        if (!container) return;

        editMap = L.map('editMap').setView([4.5709, -74.2973], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(editMap);

        editDrawnItems = new L.FeatureGroup();
        editMap.addLayer(editDrawnItems);

        // Control de geocodificación
        L.Control.geocoder({
            position: 'topleft',
            placeholder: 'Buscar dirección...',
            defaultMarkGeocode: false
        }).on('markgeocode', function(e) {
            const latlng = e.geocode.center;
            if (editMode === 'origin') {
                setOriginPoint('edit', latlng, e.geocode.name);
            } else if (editMode === 'destiny') {
                setDestinyPoint('edit', latlng, e.geocode.name);
            }
        }).addTo(editMap);

        editMap.on('click', function(e) {
            if (editMode === 'origin') {
                setOriginPoint('edit', e.latlng, '');
            } else if (editMode === 'destiny') {
                setDestinyPoint('edit', e.latlng, '');
            }
        });
    }

    // ================= FUNCIONES DE PUNTOS =================
    function setOriginPoint(type, latlng, address) {
        const map = type === 'create' ? createMap : editMap;
        const inputId = type === 'create' ? 'create_origen' : 'edit_origen';
        const btnId = type === 'create' ? 'createGenerateBtn' : 'editGenerateBtn';

        console.log('Setting origin point:', latlng);

        // Eliminar marcador anterior
        if (type === 'create') {
            if (createOriginMarker) {
                map.removeLayer(createOriginMarker);
                createOriginMarker = null;
            }
        } else {
            if (editOriginMarker) {
                map.removeLayer(editOriginMarker);
                editOriginMarker = null;
            }
        }

        // Crear nuevo marcador
        const marker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'origin-marker',
                html: '🟢',
                iconSize: [30, 30],
                iconAnchor: [15, 30]
            }),
            draggable: true,
            zIndexOffset: 1000
        }).addTo(map);

        // Evento de arrastre
        marker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            getAddress(pos, function(addr) {
                const input = document.getElementById(inputId);
                if (input) input.value = addr;
                // Actualizar geometría si hay ruta
                if (type === 'create' && createRouteLine) {
                    // Regenerar ruta con las nuevas posiciones
                    generateRoute(type);
                } else if (type === 'edit' && editRouteLine) {
                    generateRoute(type);
                }
            });
        });

        // Guardar referencia
        if (type === 'create') {
            createOriginMarker = marker;
        } else {
            editOriginMarker = marker;
        }

        console.log('Origin marker saved:', type === 'create' ? createOriginMarker : editOriginMarker);

        // Actualizar campo de texto
        const input = document.getElementById(inputId);
        if (address) {
            input.value = address;
        } else {
            getAddress(latlng, function(addr) {
                if (input) input.value = addr;
            });
        }

        // Resetear modo
        setMode(type, 'view');
        
        // Habilitar botón de generar si ambos puntos existen
        checkAndEnableGenerate(type);
    }

    function setDestinyPoint(type, latlng, address) {
        const map = type === 'create' ? createMap : editMap;
        const inputId = type === 'create' ? 'create_destino' : 'edit_destino';
        const btnId = type === 'create' ? 'createGenerateBtn' : 'editGenerateBtn';

        console.log('Setting destiny point:', latlng);

        // Eliminar marcador anterior
        if (type === 'create') {
            if (createDestinyMarker) {
                map.removeLayer(createDestinyMarker);
                createDestinyMarker = null;
            }
        } else {
            if (editDestinyMarker) {
                map.removeLayer(editDestinyMarker);
                editDestinyMarker = null;
            }
        }

        // Crear nuevo marcador
        const marker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'destiny-marker',
                html: '🔴',
                iconSize: [30, 30],
                iconAnchor: [15, 30]
            }),
            draggable: true,
            zIndexOffset: 1000
        }).addTo(map);

        // Evento de arrastre
        marker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            getAddress(pos, function(addr) {
                const input = document.getElementById(inputId);
                if (input) input.value = addr;
                if (type === 'create' && createRouteLine) {
                    generateRoute(type);
                } else if (type === 'edit' && editRouteLine) {
                    generateRoute(type);
                }
            });
        });

        // Guardar referencia
        if (type === 'create') {
            createDestinyMarker = marker;
        } else {
            editDestinyMarker = marker;
        }

        console.log('Destiny marker saved:', type === 'create' ? createDestinyMarker : editDestinyMarker);

        // Actualizar campo de texto
        const input = document.getElementById(inputId);
        if (address) {
            input.value = address;
        } else {
            getAddress(latlng, function(addr) {
                if (input) input.value = addr;
            });
        }

        // Resetear modo
        setMode(type, 'view');
        
        // Habilitar botón de generar si ambos puntos existen
        checkAndEnableGenerate(type);
    }

    function checkAndEnableGenerate(type) {
        let originMarker, destinyMarker;
        
        if (type === 'create') {
            originMarker = createOriginMarker;
            destinyMarker = createDestinyMarker;
        } else {
            originMarker = editOriginMarker;
            destinyMarker = editDestinyMarker;
        }
        
        const btnId = type === 'create' ? 'createGenerateBtn' : 'editGenerateBtn';
        const btn = document.getElementById(btnId);
        
        console.log('Checking markers:', {origin: !!originMarker, destiny: !!destinyMarker});
        
        if (originMarker && destinyMarker) {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
            console.log('✅ Both markers set, enabling generate button');
        } else {
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
            console.log('⏳ Markers not both set');
        }
        
        updateInfoMessage(type);
    }

    function setMode(type, mode) {
        if (type === 'create') {
            createMode = mode;
            const map = createMap;
            if (map) {
                map.getContainer().style.cursor = mode === 'view' ? 'grab' : 'crosshair';
            }
        } else {
            editMode = mode;
            const map = editMap;
            if (map) {
                map.getContainer().style.cursor = mode === 'view' ? 'grab' : 'crosshair';
            }
        }
        
        // Actualizar mensaje de información
        updateInfoMessage(type);
    }

    function updateInfoMessage(type) {
        const infoDiv = document.getElementById(type === 'create' ? 'createRouteInfo' : 'editRouteInfo');
        if (!infoDiv) return;
        
        const mode = type === 'create' ? createMode : editMode;
        let originMarker, destinyMarker;
        
        if (type === 'create') {
            originMarker = createOriginMarker;
            destinyMarker = createDestinyMarker;
        } else {
            originMarker = editOriginMarker;
            destinyMarker = editDestinyMarker;
        }
        
        // Obtener los elementos de puntos y distancia de forma segura
        const pointsId = type === 'create' ? 'createPointsCount' : 'editPointsCount';
        const distanceId = type === 'create' ? 'createDistance' : 'editDistance';
        const stopsId = type === 'create' ? 'createStopsCount' : 'editStopsCount';
        
        const pointsEl = document.getElementById(pointsId);
        const distanceEl = document.getElementById(distanceId);
        const stopsEl = document.getElementById(stopsId);
        
        const pointsText = pointsEl ? pointsEl.textContent : '0';
        const distanceText = distanceEl ? distanceEl.textContent : '0.0';
        const stopsText = stopsEl ? stopsEl.textContent : '0';
        
        if (mode === 'origin') {
            infoDiv.innerHTML = `
                <span style="color: #4CAF50;">🟢</span> 
                <strong>Modo Origen:</strong> Haz clic en el mapa o busca una dirección para establecer el punto de origen.
            `;
        } else if (mode === 'destiny') {
            infoDiv.innerHTML = `
                <span style="color: #f44336;">🔴</span> 
                <strong>Modo Destino:</strong> Haz clic en el mapa o busca una dirección para establecer el punto de destino.
            `;
        } else {
            const hasOrigin = !!originMarker;
            const hasDestiny = !!destinyMarker;
            const bothSelected = hasOrigin && hasDestiny;
            
            let statusText = '';
            let statusIcon = '';
            
            if (bothSelected) {
                statusIcon = '✅';
                statusText = 'Origen y destino seleccionados. ¡Genera la ruta!';
            } else if (hasOrigin) {
                statusIcon = '⏳';
                statusText = 'Origen seleccionado, selecciona el destino';
            } else if (hasDestiny) {
                statusIcon = '⏳';
                statusText = 'Destino seleccionado, selecciona el origen';
            } else {
                statusIcon = '📍';
                statusText = 'Selecciona origen y destino en el mapa';
            }
            
            infoDiv.innerHTML = `
                <span>${statusIcon}</span> 
                <strong>${statusText}</strong> | 
                <span>${pointsText} puntos</span> | 
                <span>${stopsText} paradas</span> | 
                <span>${distanceText} km</span>
            `;
        }
    }

    // ================= FUNCIONES DE RUTA =================
    function generateRoute(type) {
        if (isGenerating) return;
        
        let originMarker, destinyMarker;
        
        if (type === 'create') {
            originMarker = createOriginMarker;
            destinyMarker = createDestinyMarker;
        } else {
            originMarker = editOriginMarker;
            destinyMarker = editDestinyMarker;
        }

        console.log('Generating route:', {origin: !!originMarker, destiny: !!destinyMarker});

        if (!originMarker || !destinyMarker) {
            alert('⚠️ Por favor selecciona el origen y el destino primero.');
            return;
        }

        const origin = originMarker.getLatLng();
        const destiny = destinyMarker.getLatLng();

        console.log('Route from', origin, 'to', destiny);

        // Mostrar loading
        const btnId = type === 'create' ? 'createGenerateBtn' : 'editGenerateBtn';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Generando...';
        }
        isGenerating = true;

        // Llamar a OSRM para obtener la ruta
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destiny.lng},${destiny.lat}?overview=full&geometries=geojson`;

        console.log('Fetching route from:', url);

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (btn) {
                    btn.textContent = '🗺️ Generar Ruta';
                    btn.disabled = false;
                }
                isGenerating = false;
                
                console.log('OSRM Response:', data);
                
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    
                    drawRoute(type, coordinates);
                    updateRouteInfo(type, coordinates);
                    
                    // Calcular distancia
                    const distanceKm = route.distance / 1000;
                    const distanceInput = document.getElementById(type === 'create' ? 'create_distancia_km' : 'edit_distancia_km');
                    const distanceDisplay = document.getElementById(type === 'create' ? 'createDistance' : 'editDistance');
                    
                    if (distanceInput) distanceInput.value = distanceKm.toFixed(1);
                    if (distanceDisplay) distanceDisplay.textContent = distanceKm.toFixed(1);
                    
                    // Guardar geometría
                    const geoData = coordinates.map(coord => [coord[1], coord[0]]);
                    const geoInput = document.getElementById(type === 'create' ? 'create_geometria_ruta' : 'edit_geometria_ruta');
                    if (geoInput) geoInput.value = JSON.stringify(geoData);
                    
                    // Actualizar número de puntos
                    const pointsDisplay = document.getElementById(type === 'create' ? 'createPointsCount' : 'editPointsCount');
                    if (pointsDisplay) pointsDisplay.textContent = coordinates.length;
                    
                    console.log('✅ Route generated successfully with', coordinates.length, 'points');
                    updateInfoMessage(type);
                } else {
                    alert('⚠️ No se pudo generar la ruta. Verifica que el origen y destino sean válidos.');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                if (btn) {
                    btn.textContent = '🗺️ Generar Ruta';
                    btn.disabled = false;
                }
                isGenerating = false;
                alert('⚠️ Error al generar la ruta. Intenta nuevamente.');
            });
    }

    function drawRoute(type, coordinates) {
        const items = type === 'create' ? createDrawnItems : editDrawnItems;
        const lineKey = type === 'create' ? 'createRouteLine' : 'editRouteLine';

        // Eliminar línea anterior
        if (type === 'create') {
            if (createRouteLine) {
                items.removeLayer(createRouteLine);
                createRouteLine = null;
            }
        } else {
            if (editRouteLine) {
                items.removeLayer(editRouteLine);
                editRouteLine = null;
            }
        }

        // Crear nueva línea
        const latlngs = coordinates.map(coord => L.latLng(coord[0], coord[1]));
        const line = L.polyline(latlngs, {
            color: type === 'create' ? '#4CAF50' : '#2196F3',
            weight: 5,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(items);

        if (type === 'create') {
            createRouteLine = line;
        } else {
            editRouteLine = line;
        }

        // Ajustar zoom
        const map = type === 'create' ? createMap : editMap;
        if (map) {
            const bounds = L.latLngBounds(latlngs);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    function clearRoute(type) {
        const items = type === 'create' ? createDrawnItems : editDrawnItems;
        
        // Limpiar solo la línea, no los marcadores
        if (type === 'create') {
            if (createRouteLine) {
                items.removeLayer(createRouteLine);
                createRouteLine = null;
            }
        } else {
            if (editRouteLine) {
                items.removeLayer(editRouteLine);
                editRouteLine = null;
            }
        }

        // Actualizar información
        const geoInput = document.getElementById(type === 'create' ? 'create_geometria_ruta' : 'edit_geometria_ruta');
        const pointsDisplay = document.getElementById(type === 'create' ? 'createPointsCount' : 'editPointsCount');
        const distanceDisplay = document.getElementById(type === 'create' ? 'createDistance' : 'editDistance');
        const distanceInput = document.getElementById(type === 'create' ? 'create_distancia_km' : 'edit_distancia_km');
        
        if (geoInput) geoInput.value = '';
        if (pointsDisplay) pointsDisplay.textContent = '0';
        if (distanceDisplay) distanceDisplay.textContent = '0.0';
        if (distanceInput) distanceInput.value = '0';
        
        updateInfoMessage(type);
    }

    function updateRouteInfo(type, coordinates) {
        const pointsDisplay = document.getElementById(type === 'create' ? 'createPointsCount' : 'editPointsCount');
        if (pointsDisplay) pointsDisplay.textContent = coordinates.length;
        updateInfoMessage(type);
    }

    // ================= FUNCIONES DE AUTOCOMPLETADO =================
    function getAddress(latlng, callback) {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1`;
        
        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.display_name) {
                    callback(data.display_name);
                } else {
                    callback(`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);
                }
            })
            .catch(() => {
                callback(`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);
            });
    }

    // ================= FUNCIONES DE MODO =================
    function setOriginMode(type) {
        setMode(type, 'origin');
        
        // Resetear estilos de botones
        const btns = type === 'create' ? 
            document.querySelectorAll('#createModal .map-tools .btn-info') :
            document.querySelectorAll('#editModal .map-tools .btn-info');
        
        btns.forEach(btn => {
            btn.style.opacity = '0.6';
            btn.style.transform = 'scale(1)';
        });
        
        if (btns.length > 0) {
            btns[0].style.opacity = '1';
            btns[0].style.transform = 'scale(1.05)';
        }
    }

    function setDestinyMode(type) {
        setMode(type, 'destiny');
        
        const btns = type === 'create' ? 
            document.querySelectorAll('#createModal .map-tools .btn-info') :
            document.querySelectorAll('#editModal .map-tools .btn-info');
        
        btns.forEach(btn => {
            btn.style.opacity = '0.6';
            btn.style.transform = 'scale(1)';
        });
        
        if (btns.length > 1) {
            btns[1].style.opacity = '1';
            btns[1].style.transform = 'scale(1.05)';
        }
    }

    // ================= PREPARAR FORMULARIO =================
    function prepareFormData(type) {
        const geoInput = document.getElementById(type === 'create' ? 'create_geometria_ruta' : 'edit_geometria_ruta');
        if (!geoInput || !geoInput.value || geoInput.value === '[]' || geoInput.value === '') {
            alert('⚠️ Por favor genera la ruta en el mapa antes de guardar.');
            return false;
        }
        
        // Verificar que los campos requeridos estén llenos
        const nombre = document.getElementById(type === 'create' ? 'create_nombre' : 'edit_nombre');
        const codigo = document.getElementById(type === 'create' ? 'create_codigo' : 'edit_codigo');
        const origen = document.getElementById(type === 'create' ? 'create_origen' : 'edit_origen');
        const destino = document.getElementById(type === 'create' ? 'create_destino' : 'edit_destino');
        
        if (!nombre || !nombre.value.trim() || !codigo || !codigo.value.trim() || 
            !origen || !origen.value.trim() || !destino || !destino.value.trim()) {
            alert('⚠️ Por favor completa todos los campos obligatorios.');
            return false;
        }
        
        return true;
    }

    // ================= MODALES =================
    function openCreateModal() {
        const modal = document.getElementById('createModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            
            // Resetear variables
            createOriginMarker = null;
            createDestinyMarker = null;
            createRouteLine = null;
            createMode = 'view';
            
            setTimeout(() => {
                if (!createMap) {
                    initCreateMap();
                } else {
                    createMap.invalidateSize();
                }
                const btn = document.getElementById('createGenerateBtn');
                if (btn) {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                }
                updateInfoMessage('create');
            }, 300);
        }
    }

    function closeCreateModal() {
        const modal = document.getElementById('createModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            
            // Limpiar todo
            if (createDrawnItems) {
                createDrawnItems.clearLayers();
            }
            if (createOriginMarker && createMap) {
                createMap.removeLayer(createOriginMarker);
                createOriginMarker = null;
            }
            if (createDestinyMarker && createMap) {
                createMap.removeLayer(createDestinyMarker);
                createDestinyMarker = null;
            }
            createRouteLine = null;
            createMode = 'view';
            
            // Resetear campos
            const fields = ['create_origen', 'create_destino', 'create_geometria_ruta', 'create_paradas'];
            fields.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            
            const distInput = document.getElementById('create_distancia_km');
            if (distInput) distInput.value = '0';
            
            const pointsDisplay = document.getElementById('createPointsCount');
            if (pointsDisplay) pointsDisplay.textContent = '0';
            
            const stopsDisplay = document.getElementById('createStopsCount');
            if (stopsDisplay) stopsDisplay.textContent = '0';
            
            const distanceDisplay = document.getElementById('createDistance');
            if (distanceDisplay) distanceDisplay.textContent = '0.0';
            
            const btn = document.getElementById('createGenerateBtn');
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
            }
            
            // Resetear info
            const infoDiv = document.getElementById('createRouteInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `
                    <span>📍</span> 
                    <strong>Selecciona origen y destino en el mapa</strong> | 
                    <span>0 puntos</span> | 
                    <span>0 paradas</span> | 
                    <span>0.0 km</span>
                `;
            }
            
            // Resetear botones
            document.querySelectorAll('#createModal .map-tools .btn-info').forEach(btn => {
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1)';
            });
        }
    }

    function editRuta(id) {
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (!row) return;

        editId = id;

        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
        const codigo = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
        const origen = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '';
        const destino = row.querySelector('td:nth-child(5)')?.textContent?.trim() || '';
        const distancia = row.querySelector('td:nth-child(6)')?.textContent?.replace('km', '').trim() || '0';
        const duracionTexto = row.querySelector('td:nth-child(7)')?.textContent?.trim() || '';
        const frecuenciaTexto = row.querySelector('td:nth-child(8)')?.textContent?.trim() || '';
        const paradas = row.querySelector('td:nth-child(9)')?.textContent?.trim() || '0';
        const estado = row.querySelector('td:nth-child(10)')?.textContent?.trim() || '';

        let duracion_horas = 0;
        let duracion_minutos = 0;
        const horasDuracion = duracionTexto.match(/(\d+)\s*h/);
        const minutosDuracion = duracionTexto.match(/(\d+)\s*m/);
        if (horasDuracion) duracion_horas = parseInt(horasDuracion[1]);
        if (minutosDuracion) duracion_minutos = parseInt(minutosDuracion[1]);

        let frecuencia = 0;
        const horasFrecuencia = frecuenciaTexto.match(/(\d+)\s*h/);
        const minutosFrecuencia = frecuenciaTexto.match(/(\d+)\s*m/);
        if (horasFrecuencia) frecuencia += parseInt(horasFrecuencia[1]) * 60;
        if (minutosFrecuencia) frecuencia += parseInt(minutosFrecuencia[1]);

        const editIdField = document.getElementById('edit_id');
        const editNombre = document.getElementById('edit_nombre');
        const editCodigo = document.getElementById('edit_codigo');
        const editOrigen = document.getElementById('edit_origen');
        const editDestino = document.getElementById('edit_destino');
        const editDuracionH = document.getElementById('edit_duracion_horas');
        const editDuracionM = document.getElementById('edit_duracion_minutos');
        const editEstado = document.getElementById('edit_estado');
        const editFrecuencia = document.getElementById('edit_frecuencia');
        const editDistancia = document.getElementById('edit_distancia_km');
        const editForm = document.getElementById('editForm');

        if (editIdField) editIdField.value = id;
        if (editNombre) editNombre.value = nombre;
        if (editCodigo) editCodigo.value = codigo;
        if (editOrigen) editOrigen.value = origen;
        if (editDestino) editDestino.value = destino;
        if (editDuracionH) editDuracionH.value = duracion_horas;
        if (editDuracionM) editDuracionM.value = duracion_minutos;
        if (editEstado) editEstado.value = estado.toLowerCase();
        if (editFrecuencia) editFrecuencia.value = frecuencia;
        if (editDistancia) editDistancia.value = distancia;
        if (editForm) editForm.action = '/editarRuta/' + id + '/';

        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            
            // Resetear variables
            editOriginMarker = null;
            editDestinyMarker = null;
            editRouteLine = null;
            editMode = 'view';
            
            setTimeout(() => {
                if (!editMap) {
                    initEditMap();
                } else {
                    editMap.invalidateSize();
                }
                loadExistingGeometry(id);
            }, 300);
        }
    }

    function loadExistingGeometry(id) {
        const rutasJson = document.getElementById('rutasJson')?.textContent;
        if (rutasJson) {
            try {
                const rutas = JSON.parse(rutasJson);
                const ruta = rutas.find(r => r.id === id);
                if (ruta && ruta.coordenadas && ruta.coordenadas.length > 0) {
                    // Dibujar la ruta
                    const latlngs = ruta.coordenadas.map(coord => [coord[1], coord[0]]);
                    editRouteLine = L.polyline(latlngs, {
                        color: '#2196F3',
                        weight: 5,
                        opacity: 0.8,
                        smoothFactor: 1
                    });
                    editDrawnItems.addLayer(editRouteLine);
                    
                    // Guardar geometría
                    const geoInput = document.getElementById('edit_geometria_ruta');
                    if (geoInput) geoInput.value = JSON.stringify(ruta.coordenadas);
                    
                    const distInput = document.getElementById('edit_distancia_km');
                    if (distInput) distInput.value = ruta.distancia_km || '0';
                    
                    const pointsDisplay = document.getElementById('editPointsCount');
                    if (pointsDisplay) pointsDisplay.textContent = ruta.coordenadas.length;
                    
                    const distanceDisplay = document.getElementById('editDistance');
                    if (distanceDisplay) distanceDisplay.textContent = ruta.distancia_km || '0.0';
                    
                    // Poner marcadores de origen y destino
                    if (ruta.coordenadas.length > 0) {
                        const origin = L.latLng(ruta.coordenadas[0][1], ruta.coordenadas[0][0]);
                        const destiny = L.latLng(ruta.coordenadas[ruta.coordenadas.length-1][1], ruta.coordenadas[ruta.coordenadas.length-1][0]);
                        
                        // Crear marcador de origen
                        editOriginMarker = L.marker(origin, {
                            icon: L.divIcon({
                                className: 'origin-marker',
                                html: '🟢',
                                iconSize: [30, 30],
                                iconAnchor: [15, 30]
                            }),
                            draggable: true,
                            zIndexOffset: 1000
                        }).addTo(editMap);
                        
                        editOriginMarker.on('dragend', function(e) {
                            const pos = e.target.getLatLng();
                            getAddress(pos, function(addr) {
                                const input = document.getElementById('edit_origen');
                                if (input) input.value = addr;
                            });
                            generateRoute('edit');
                        });
                        
                        // Crear marcador de destino
                        editDestinyMarker = L.marker(destiny, {
                            icon: L.divIcon({
                                className: 'destiny-marker',
                                html: '🔴',
                                iconSize: [30, 30],
                                iconAnchor: [15, 30]
                            }),
                            draggable: true,
                            zIndexOffset: 1000
                        }).addTo(editMap);
                        
                        editDestinyMarker.on('dragend', function(e) {
                            const pos = e.target.getLatLng();
                            getAddress(pos, function(addr) {
                                const input = document.getElementById('edit_destino');
                                if (input) input.value = addr;
                            });
                            generateRoute('edit');
                        });
                    }
                    
                    // Ajustar zoom
                    const bounds = L.latLngBounds(latlngs);
                    if (editMap) editMap.fitBounds(bounds, { padding: [50, 50] });
                    
                    // Habilitar botón de generar
                    const btn = document.getElementById('editGenerateBtn');
                    if (btn) {
                        btn.disabled = false;
                        btn.style.opacity = '1';
                    }
                    
                    updateInfoMessage('edit');
                }
            } catch (e) {
                console.error('Error loading geometry:', e);
            }
        }
    }

    function closeEditModal() {
        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            
            if (editDrawnItems) {
                editDrawnItems.clearLayers();
            }
            if (editOriginMarker && editMap) {
                editMap.removeLayer(editOriginMarker);
                editOriginMarker = null;
            }
            if (editDestinyMarker && editMap) {
                editMap.removeLayer(editDestinyMarker);
                editDestinyMarker = null;
            }
            editRouteLine = null;
            editId = null;
            editMode = 'view';
            
            // Resetear info
            const infoDiv = document.getElementById('editRouteInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `
                    <span>📍</span> 
                    <strong>Selecciona origen y destino en el mapa</strong> | 
                    <span>0 puntos</span> | 
                    <span>0 paradas</span> | 
                    <span>0.0 km</span>
                `;
            }
            
            document.querySelectorAll('#editModal .map-tools .btn-info').forEach(btn => {
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1)';
            });
        }
    }

    function submitEditForm() {
        const geoInput = document.getElementById('edit_geometria_ruta');
        if (!geoInput || !geoInput.value || geoInput.value === '[]' || geoInput.value === '') {
            alert('⚠️ La ruta no tiene puntos. Genera la ruta en el mapa.');
            return;
        }
        const form = document.getElementById('editForm');
        if (form) form.submit();
    }

    // ================= ELIMINAR =================
    let rutaIdToDelete = null;

    function confirmDelete(id, nombre) {
        rutaIdToDelete = id;
        const nameSpan = document.getElementById('deleteRutaNombre');
        if (nameSpan) nameSpan.textContent = nombre;
        
        const modal = document.getElementById('deleteModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeDeleteModal() {
        const modal = document.getElementById('deleteModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        rutaIdToDelete = null;
    }

    function deleteRuta() {
        if (!rutaIdToDelete) return;
        window.location.href = '/deleteRuta/' + rutaIdToDelete + '/';
        closeDeleteModal();
    }

    // ================= EVENTOS GLOBALES =================
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });

    document.querySelectorAll('.rutas-modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    // ================= EXPORTAR FUNCIONES =================
    window.openCreateModal = openCreateModal;
    window.closeCreateModal = closeCreateModal;
    window.editRuta = editRuta;
    window.closeEditModal = closeEditModal;
    window.confirmDelete = confirmDelete;
    window.closeDeleteModal = closeDeleteModal;
    window.deleteRuta = deleteRuta;
    window.submitEditForm = submitEditForm;
    window.prepareFormData = prepareFormData;
    window.setOriginMode = setOriginMode;
    window.setDestinyMode = setDestinyMode;
    window.generateRoute = generateRoute;
    window.clearRoute = clearRoute;
});