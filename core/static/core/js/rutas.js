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

// Política de referencia para los mapas
L.TileLayer.prototype.options.referrerPolicy = 'strict-origin-when-cross-origin';
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

        createMap = L.map('createMap').setView([6.2442, -75.5812], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            referrerPolicy: 'strict-origin-when-cross-origin'
        }).addTo(createMap);

        createDrawnItems = new L.FeatureGroup();
        createMap.addLayer(createDrawnItems);

        L.Control.geocoder({
            position: 'topleft',
            placeholder: 'Buscar dirección...',
            defaultMarkGeocode: false
        }).on('markgeocode', function (e) {
            const latlng = e.geocode.center;
            if (createMode === 'origin') {
                setOriginPoint('create', latlng, e.geocode.name);
            } else if (createMode === 'destiny') {
                setDestinyPoint('create', latlng, e.geocode.name);
            }
        }).addTo(createMap);

        createMap.on('click', function (e) {
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

        editMap = L.map('editMap').setView([6.2442, -75.5812], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            referrerPolicy: 'strict-origin-when-cross-origin'
        }).addTo(editMap);

        editDrawnItems = new L.FeatureGroup();
        editMap.addLayer(editDrawnItems);

        L.Control.geocoder({
            position: 'topleft',
            placeholder: 'Buscar dirección...',
            defaultMarkGeocode: false
        }).on('markgeocode', function (e) {
            const latlng = e.geocode.center;
            if (editMode === 'origin') {
                setOriginPoint('edit', latlng, e.geocode.name);
            } else if (editMode === 'destiny') {
                setDestinyPoint('edit', latlng, e.geocode.name);
            }
        }).addTo(editMap);

        editMap.on('click', function (e) {
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

        marker.on('dragend', function (e) {
            const pos = e.target.getLatLng();
            getAddress(pos, function (addr) {
                const input = document.getElementById(inputId);
                if (input) input.value = addr;
                if (type === 'create' && createRouteLine) {
                    generateRoute(type);
                } else if (type === 'edit' && editRouteLine) {
                    generateRoute(type);
                }
            });
        });

        if (type === 'create') {
            createOriginMarker = marker;
        } else {
            editOriginMarker = marker;
        }

        const input = document.getElementById(inputId);
        if (address) {
            input.value = address;
        } else {
            getAddress(latlng, function (addr) {
                if (input) input.value = addr;
            });
        }

        setMode(type, 'view');
        checkAndEnableGenerate(type);
    }

    function setDestinyPoint(type, latlng, address) {
        const map = type === 'create' ? createMap : editMap;
        const inputId = type === 'create' ? 'create_destino' : 'edit_destino';

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

        marker.on('dragend', function (e) {
            const pos = e.target.getLatLng();
            getAddress(pos, function (addr) {
                const input = document.getElementById(inputId);
                if (input) input.value = addr;
                if (type === 'create' && createRouteLine) {
                    generateRoute(type);
                } else if (type === 'edit' && editRouteLine) {
                    generateRoute(type);
                }
            });
        });

        if (type === 'create') {
            createDestinyMarker = marker;
        } else {
            editDestinyMarker = marker;
        }

        const input = document.getElementById(inputId);
        if (address) {
            input.value = address;
        } else {
            getAddress(latlng, function (addr) {
                if (input) input.value = addr;
            });
        }

        setMode(type, 'view');
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

        if (originMarker && destinyMarker) {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        } else {
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
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

        if (!originMarker || !destinyMarker) {
            alert('⚠️ Por favor selecciona el origen y el destino primero.');
            return;
        }

        const origin = originMarker.getLatLng();
        const destiny = destinyMarker.getLatLng();

        const btnId = type === 'create' ? 'createGenerateBtn' : 'editGenerateBtn';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Generando...';
        }
        isGenerating = true;

        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destiny.lng},${destiny.lat}?overview=full&geometries=geojson`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (btn) {
                    btn.textContent = '🗺️ Generar Ruta';
                    btn.disabled = false;
                }
                isGenerating = false;

                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

                    drawRoute(type, coordinates);
                    updateRouteInfo(type, coordinates);

                    const distanceKm = route.distance / 1000;
                    const distanceInput = document.getElementById(type === 'create' ? 'create_distancia_km' : 'edit_distancia_km');
                    const distanceDisplay = document.getElementById(type === 'create' ? 'createDistance' : 'editDistance');

                    if (distanceInput) distanceInput.value = distanceKm.toFixed(1);
                    if (distanceDisplay) distanceDisplay.textContent = distanceKm.toFixed(1);

                    const geoData = coordinates.map(coord => [coord[1], coord[0]]);
                    const geoInput = document.getElementById(type === 'create' ? 'create_geometria_ruta' : 'edit_geometria_ruta');
                    if (geoInput) geoInput.value = JSON.stringify(geoData);

                    const pointsDisplay = document.getElementById(type === 'create' ? 'createPointsCount' : 'editPointsCount');
                    if (pointsDisplay) pointsDisplay.textContent = coordinates.length;

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

        const map = type === 'create' ? createMap : editMap;
        if (map) {
            const bounds = L.latLngBounds(latlngs);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    function clearRoute(type) {
        const items = type === 'create' ? createDrawnItems : editDrawnItems;

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

        const nombre = document.getElementById(type === 'create' ? 'create_nombre' : 'edit_nombre');
        if (!nombre || !nombre.value.trim()) {
            alert('⚠️ El nombre de la ruta es obligatorio.');
            nombre.focus();
            return false;
        }

        const codigoInput = document.getElementById(type === 'create' ? 'codigo' : 'edit_codigo');
        const codigoFeedback = document.getElementById(type === 'create' ? 'codigoRutaFeedback' : 'editCodigoRutaFeedback');

        if (!codigoInput || !codigoInput.value.trim()) {
            if (codigoInput) {
                codigoInput.classList.add('rutas-form-input-error');
                codigoInput.classList.remove('rutas-form-input-success');
                codigoInput.focus();
            }
            if (codigoFeedback) {
                codigoFeedback.textContent = '⚠️ El código es obligatorio';
                codigoFeedback.classList.add('error');
                codigoFeedback.classList.remove('success');
            }
            if (codigoInput) codigoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }

        if (codigoInput.classList.contains('rutas-form-input-error')) {
            codigoInput.focus();
            codigoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }

        const origen = document.getElementById(type === 'create' ? 'create_origen' : 'edit_origen');
        const destino = document.getElementById(type === 'create' ? 'create_destino' : 'edit_destino');

        if (!origen || !origen.value.trim() || !destino || !destino.value.trim()) {
            alert('⚠️ Por favor selecciona el origen y destino en el mapa.');
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
        const duracion = row.querySelector('td:nth-child(7)')?.textContent?.replace('min', '').trim() || '0';
        const frecuencia = row.querySelector('td:nth-child(8)')?.textContent?.replace('min', '').trim() || '0';
        const estado = row.querySelector('td:nth-child(10)')?.textContent?.trim() || '';

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        setVal('edit_id', id);
        setVal('edit_nombre', nombre);
        setVal('edit_codigo', codigo);
        setVal('edit_origen', origen);
        setVal('edit_destino', destino);
        setVal('edit_distancia_km', distancia);
        setVal('edit_duracion_minutos', duracion === 'Sin registro' ? '0' : duracion);
        setVal('edit_frecuencia_minutos', frecuencia === 'Sin registro' ? '0' : frecuencia);
        setVal('edit_estado', estado);

        setVal('edit_rutaIdActual', id);

        const editForm = document.getElementById('editForm');
        if (editForm) editForm.action = '/editarRuta/' + id + '/';

        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

            editOriginMarker = null;
            editDestinyMarker = null;
            editRouteLine = null;
            editMode = 'view';

            // ✅ NUEVO: Guardar datos originales para comparar después
            setTimeout(() => {
                guardarDatosOriginales();
            }, 100);

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
                    const latlngs = ruta.coordenadas.map(coord => [coord[1], coord[0]]);
                    editRouteLine = L.polyline(latlngs, {
                        color: '#2196F3',
                        weight: 5,
                        opacity: 0.8,
                        smoothFactor: 1
                    });
                    editDrawnItems.addLayer(editRouteLine);

                    const geoInput = document.getElementById('edit_geometria_ruta');
                    if (geoInput) geoInput.value = JSON.stringify(ruta.coordenadas);

                    const distInput = document.getElementById('edit_distancia_km');
                    if (distInput) distInput.value = ruta.distancia_km || '0';

                    const pointsDisplay = document.getElementById('editPointsCount');
                    if (pointsDisplay) pointsDisplay.textContent = ruta.coordenadas.length;

                    const distanceDisplay = document.getElementById('editDistance');
                    if (distanceDisplay) distanceDisplay.textContent = ruta.distancia_km || '0.0';

                    if (ruta.coordenadas.length > 0) {
                        const origin = L.latLng(ruta.coordenadas[0][1], ruta.coordenadas[0][0]);
                        const destiny = L.latLng(ruta.coordenadas[ruta.coordenadas.length - 1][1], ruta.coordenadas[ruta.coordenadas.length - 1][0]);

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

                        editOriginMarker.on('dragend', function (e) {
                            const pos = e.target.getLatLng();
                            getAddress(pos, function (addr) {
                                const input = document.getElementById('edit_origen');
                                if (input) input.value = addr;
                            });
                            generateRoute('edit');
                        });

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

                        editDestinyMarker.on('dragend', function (e) {
                            const pos = e.target.getLatLng();
                            getAddress(pos, function (addr) {
                                const input = document.getElementById('edit_destino');
                                if (input) input.value = addr;
                            });
                            generateRoute('edit');
                        });
                    }

                    const bounds = L.latLngBounds(latlngs);
                    if (editMap) editMap.fitBounds(bounds, { padding: [50, 50] });

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

    // ✅ MODIFICADO: Ahora muestra el modal de confirmación de cambios
    function submitEditForm() {
        // ============ VALIDAR GEOMETRÍA ============
        const geoInput = document.getElementById('edit_geometria_ruta');
        if (!geoInput || !geoInput.value || geoInput.value === '[]' || geoInput.value === '') {
            alert('⚠️ La ruta no tiene puntos. Genera la ruta en el mapa.');
            return;
        }

        // ============ EJECUTAR prepareFormData ============
        if (!prepareFormData('edit')) {
            return;
        }

        // ✅ Cerrar el modal de editar antes de abrir el de confirmación
        const modalEdit = document.getElementById('editModal');
        if (modalEdit) {
            modalEdit.classList.remove('active');
        }

        // ============ MOSTRAR MODAL DE CONFIRMACIÓN ============
        formPendiente = document.getElementById('editForm');
        mostrarConfirmacionCambios();
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

    // ================= CONFIRMACIÓN DE CAMBIOS =================
    let datosOriginales = {};
    let formPendiente = null;

    function guardarDatosOriginales() {
        datosOriginales = {
            nombre: document.getElementById('edit_nombre')?.value || '',
            codigo: document.getElementById('edit_codigo')?.value || '',
            origen: document.getElementById('edit_origen')?.value || '',
            destino: document.getElementById('edit_destino')?.value || '',
            estado: document.getElementById('edit_estado')?.value || '',
            duracion: document.getElementById('edit_duracion_minutos')?.value || '',
            frecuencia: document.getElementById('edit_frecuencia_minutos')?.value || '',
        };
    }

    function obtenerDatosActuales() {
        return {
            nombre: document.getElementById('edit_nombre')?.value || '',
            codigo: document.getElementById('edit_codigo')?.value || '',
            origen: document.getElementById('edit_origen')?.value || '',
            destino: document.getElementById('edit_destino')?.value || '',
            estado: document.getElementById('edit_estado')?.value || '',
            duracion: document.getElementById('edit_duracion_minutos')?.value || '',
            frecuencia: document.getElementById('edit_frecuencia_minutos')?.value || '',
        };
    }

    function detectarCambios() {
        const actuales = obtenerDatosActuales();
        const cambios = [];
        const etiquetas = {
            nombre: 'Nombre',
            codigo: 'Código',
            origen: 'Origen',
            destino: 'Destino',
            estado: 'Estado',
            duracion: 'Duración (min)',
            frecuencia: 'Frecuencia (min)',
        };

        for (const campo in datosOriginales) {
            if (datosOriginales[campo] !== actuales[campo]) {
                cambios.push({
                    campo: etiquetas[campo] || campo,
                    anterior: datosOriginales[campo] || '(vacío)',
                    nuevo: actuales[campo] || '(vacío)',
                });
            }
        }

        return cambios;
    }

    function mostrarConfirmacionCambios() {
        const cambios = detectarCambios();
        const lista = document.getElementById('changesList');
        const nombreRuta = document.getElementById('changesRutaNombre');

        if (!lista) return false;

        if (cambios.length === 0) {
            lista.innerHTML = `
                <div class="no-changes">
                    <span class="no-changes-icon">📝</span>
                    <p>No detectamos cambios en la ruta.</p>
                </div>
            `;
        } else {
            lista.innerHTML = cambios.map(cambio => `
                <div class="change-item">
                    <span class="change-field-label">${cambio.campo}</span>
                    <div class="change-values">
                        <div class="change-old">
                            <span class="change-icon">−</span>
                            <span class="change-text">${escapeHtml(cambio.anterior)}</span>
                        </div>
                        <div class="change-new">
                            <span class="change-icon">+</span>
                            <span class="change-text">${escapeHtml(cambio.nuevo)}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        if (nombreRuta) {
            nombreRuta.textContent = document.getElementById('edit_nombre')?.value || 'sin nombre';
        }

        const modal = document.getElementById('confirmChangesModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        return cambios.length > 0;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function closeConfirmChangesModal() {
        const modal = document.getElementById('confirmChangesModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        formPendiente = null;
    }

    function confirmarCambios() {
        // ✅ Guardar referencia ANTES de cerrar el modal
        const form = formPendiente;

        // Cerrar el modal (esto limpia formPendiente)
        closeConfirmChangesModal();

        // ✅ Enviar el formulario guardado
        if (form) {
            form.submit();
        } else {
            console.error('❌ No hay formulario pendiente');
        }
    }

    // ================= EVENTOS GLOBALES =================
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
            closeConfirmChangesModal();
        }
    });

    document.querySelectorAll('.rutas-modal').forEach(modal => {
        modal.addEventListener('click', function (e) {
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
    window.closeConfirmChangesModal = closeConfirmChangesModal;
    window.confirmarCambios = confirmarCambios;
});

// ================= VALIDACIÓN DE CÓDIGO DE RUTA EN TIEMPO REAL =================
document.addEventListener('DOMContentLoaded', function () {

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function setupValidacionCodigo(inputId, feedbackId, rutaIdInputId) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const rutaIdInput = rutaIdInputId ? document.getElementById(rutaIdInputId) : null;

        if (!input || !feedback) return;

        let debounceTimer = null;
        let ultimoCodigoVerificado = '';

        function limpiarEstados() {
            input.classList.remove(
                'rutas-form-input-error',
                'rutas-form-input-success',
                'rutas-form-input-loading'
            );
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');
        }

        function verificarCodigo(codigo) {
            if (codigo === ultimoCodigoVerificado) return;
            ultimoCodigoVerificado = codigo;

            input.classList.remove('rutas-form-input-error', 'rutas-form-input-success');
            input.classList.add('rutas-form-input-loading');
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');

            const formData = new FormData();
            formData.append('codigo', codigo);
            if (rutaIdInput && rutaIdInput.value) {
                formData.append('ruta_id', rutaIdInput.value);
            }
            formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

            fetch('/verificar_codigo_ruta/', {
                method: 'POST',
                body: formData,
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            })
                .then(response => response.json())
                .then(data => {
                    input.classList.remove('rutas-form-input-loading');

                    if (data.existe) {
                        input.classList.add('rutas-form-input-error');
                        feedback.textContent = '❌ Este código ya está en uso';
                        feedback.classList.add('error');
                    } else {
                        input.classList.add('rutas-form-input-success');
                        feedback.textContent = '✓ Código disponible';
                        feedback.classList.add('success');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    input.classList.remove('rutas-form-input-loading');
                    ultimoCodigoVerificado = '';
                });
        }

        input.addEventListener('input', function () {
            const codigo = this.value.trim();
            clearTimeout(debounceTimer);

            if (codigo === '') {
                limpiarEstados();
                ultimoCodigoVerificado = '';
                return;
            }

            if (!/^[a-zA-Z0-9\-_]{2,20}$/.test(codigo)) {
                limpiarEstados();
                input.classList.add('rutas-form-input-error');
                feedback.textContent = '⚠️ Solo letras, números y guiones (2-20 caracteres)';
                feedback.classList.add('error');
                ultimoCodigoVerificado = '';
                return;
            }

            debounceTimer = setTimeout(function () {
                verificarCodigo(codigo);
            }, 500);
        });

        input.addEventListener('blur', function () {
            const codigo = this.value.trim();
            if (codigo !== '' && /^[a-zA-Z0-9\-_]{2,20}$/.test(codigo)) {
                clearTimeout(debounceTimer);
                verificarCodigo(codigo);
            }
        });

        return {
            limpiar: function () {
                limpiarEstados();
                ultimoCodigoVerificado = '';
            }
        };
    }

    const validacionCrear = setupValidacionCodigo('codigo', 'codigoRutaFeedback', 'rutaIdActual');
    const validacionEditar = setupValidacionCodigo('edit_codigo', 'editCodigoRutaFeedback', 'edit_rutaIdActual');

    const btnNuevaRuta = document.querySelector('.rutas-btn-primary[onclick="openCreateModal()"]');
    if (btnNuevaRuta) {
        btnNuevaRuta.addEventListener('click', function () {
            if (validacionCrear) validacionCrear.limpiar();
        });
    }

    document.querySelectorAll('.rutas-action-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (validacionEditar) validacionEditar.limpiar();
        });
    });
});