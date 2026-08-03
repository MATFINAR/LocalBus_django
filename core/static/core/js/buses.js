// ================= DATOS DE EJEMPLO =================
// Buses del Área Metropolitana de Medellín
const busesData = [
    {
        id: 1,
        placa: "ABC123",
        capacidad: 40,
        id_ruta: 1,
        ruta_nombre: "Ruta 10 - Centro ↔ Terminal Norte",
        estado: "Activo",
        latitud: 4.7110,
        longitud: -74.0721
    },
    {
        id: 2,
        placa: "DEF456",
        capacidad: 35,
        id_ruta: 2,
        ruta_nombre: "Ruta 15 - Universidad ↔ Plaza Mayor",
        estado: "Activo",
        latitud: 4.6380,
        longitud: -74.0807
    },
    {
        id: 3,
        placa: "GHI789",
        capacidad: 50,
        id_ruta: 3,
        ruta_nombre: "Ruta 20 - Aeropuerto ↔ Centro",
        estado: "Mantenimiento",
        latitud: 4.7016,
        longitud: -74.1469
    },
    {
        id: 4,
        placa: "JKL012",
        capacidad: 30,
        id_ruta: 4,
        ruta_nombre: "Ruta 25 - Zona Rosa ↔ Estadio",
        estado: "Activo",
        latitud: 4.6683,
        longitud: -74.1066
    },
    {
        id: 5,
        placa: "MNO345",
        capacidad: 45,
        id_ruta: 5,
        ruta_nombre: "Ruta 30 - Norte ↔ Sur (Express)",
        estado: "Inactivo",
        latitud: 4.6006,
        longitud: -74.1050
    },
    {
        id: 6,
        placa: "PQR678",
        capacidad: 38,
        id_ruta: 6,
        ruta_nombre: "Ruta 35 - Centro ↔ Parque Industrial",
        estado: "Activo",
        latitud: 4.6243,
        longitud: -74.1845
    },
    {
        id: 7,
        placa: "STU901",
        capacidad: 25,
        id_ruta: 7,
        ruta_nombre: "Ruta 40 - Circular Centro",
        estado: "Activo",
        latitud: 4.6548,
        longitud: -74.0739
    },
    {
        id: 8,
        placa: "VWX234",
        capacidad: 42,
        id_ruta: 8,
        ruta_nombre: "Ruta 45 - Norte ↔ Zona Franca",
        estado: "Mantenimiento",
        latitud: 4.6893,
        longitud: -74.1432
    }
];

// Rutas disponibles para asignar
const rutasDisponibles = [
    { id: 1, nombre: "Ruta 10 - Centro ↔ Terminal Norte" },
    { id: 2, nombre: "Ruta 15 - Universidad ↔ Plaza Mayor" },
    { id: 3, nombre: "Ruta 20 - Aeropuerto ↔ Centro" },
    { id: 4, nombre: "Ruta 25 - Zona Rosa ↔ Estadio" },
    { id: 5, nombre: "Ruta 30 - Norte ↔ Sur (Express)" },
    { id: 6, nombre: "Ruta 35 - Centro ↔ Parque Industrial" },
    { id: 7, nombre: "Ruta 40 - Circular Centro" },
    { id: 8, nombre: "Ruta 45 - Norte ↔ Zona Franca" }
];

// Variable para almacenar el ID del bus a eliminar
let deleteBusId = null;
let buses = [];

// ================= INICIALIZACIÓN =================
document.addEventListener('DOMContentLoaded', function () {
    buses = [...busesData];
    renderTable();
    fillRouteSelects();
    fillFilterRoutes();

    initSearchFilter();
    initEstadoFilter();
    initRutaFilter();
    initModalEvents();
});

// ================= FUNCIONES DE RENDERIZADO =================

function fillRouteSelects() {
    const selects = ['id_ruta', 'edit_id_ruta'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const defaultOption = select.querySelector('option[value=""]');
        select.innerHTML = '';
        if (defaultOption) {
            select.appendChild(defaultOption);
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Sin asignar';
            select.appendChild(option);
        }

        rutasDisponibles.forEach(ruta => {
            const option = document.createElement('option');
            option.value = ruta.id;
            option.textContent = ruta.nombre;
            select.appendChild(option);
        });
    });
}

function fillFilterRoutes() {
    const filter = document.getElementById('rutaFilter');
    if (!filter) return;

    rutasDisponibles.forEach(ruta => {
        const option = document.createElement('option');
        option.value = ruta.id;
        option.textContent = ruta.nombre;
        filter.appendChild(option);
    });
}

function renderTable() {
    const tbody = document.getElementById('busesTableBody');
    if (!tbody) return;

    if (buses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="buses-empty">
                    <div class="buses-empty-state">
                        <span class="buses-empty-icon">🚌</span>
                        <h3>No hay buses registrados</h3>
                        <p>Comienza agregando un nuevo bus al sistema.</p>
                        <button class="buses-btn-primary" onclick="openCreateModal()" style="margin-top:0.5rem;">Agregar primer bus</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    buses.forEach(bus => {
        const estadoClass = bus.estado.toLowerCase();
        const rutaNombre = bus.ruta_nombre || 'Sin asignar';
        const ubicacion = (bus.latitud !== undefined && bus.longitud !== undefined && bus.latitud !== null && bus.longitud !== null)
            ? `${bus.latitud}, ${bus.longitud}`
            : '📍 No disponible';

        html += `
            <tr class="buses-row" data-id="${bus.id}" data-id_ruta="${bus.id_ruta || ''}" data-estado="${bus.estado}">
                <td><span class="buses-id">#${bus.id}</span></td>
                <td><span class="buses-placa">${escapeHtml(bus.placa)}</span></td>
                <td>${bus.capacidad}</td>
                <td>${escapeHtml(rutaNombre)}</td>
                <td>
                    <span class="buses-status buses-status-${estadoClass}">
                        ${bus.estado}
                    </span>
                </td>
                <td class="buses-ubicacion">${escapeHtml(ubicacion)}</td>
                <td>
                    <div class="buses-actions">
                        <button class="buses-action-btn buses-action-edit" onclick="editBus(${bus.id})" title="Editar">
                            ✏️
                        </button>
                        <button class="buses-action-btn buses-action-delete" onclick="confirmDelete(${bus.id}, '${escapeHtml(bus.placa)}')" title="Eliminar">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ================= CRUD DE BUSES =================

function saveBus() {
    if (!validateForm('createForm')) {
        return;
    }

    const placa = document.getElementById('placa').value.trim().toUpperCase();
    const capacidad = parseInt(document.getElementById('capacidad').value);
    const id_ruta = parseInt(document.getElementById('id_ruta').value) || null;
    const estado = document.getElementById('estado').value;

    let ruta_nombre = 'Sin asignar';
    if (id_ruta) {
        const ruta = rutasDisponibles.find(r => r.id === id_ruta);
        if (ruta) ruta_nombre = ruta.nombre;
    }

    // Crear nuevo bus con latitud y longitud en 0
    const newBus = {
        id: Date.now(),
        placa,
        capacidad,
        id_ruta,
        ruta_nombre,
        estado,
        latitud: 0,
        longitud: 0
    };

    buses.push(newBus);
    renderTable();
    closeCreateModal();
    showToast('✅ Bus con placa "' + placa + '" creado exitosamente', 'success');
    document.getElementById('createForm').reset();
}

function editBus(id) {
    const bus = buses.find(b => b.id === id);
    if (!bus) {
        showToast('❌ Bus no encontrado', 'error');
        return;
    }

    document.getElementById('edit_id').value = bus.id;
    document.getElementById('edit_placa').value = bus.placa;
    document.getElementById('edit_capacidad').value = bus.capacidad;
    document.getElementById('edit_id_ruta').value = bus.id_ruta || '';
    document.getElementById('edit_estado').value = bus.estado;
    document.getElementById('edit_latitud').value = bus.latitud || 0;
    document.getElementById('edit_longitud').value = bus.longitud || 0;

    document.getElementById('editModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function updateBus() {
    if (!validateForm('editForm')) {
        return;
    }

    const id = parseInt(document.getElementById('edit_id').value);
    const index = buses.findIndex(b => b.id === id);

    if (index === -1) {
        showToast('❌ Bus no encontrado', 'error');
        return;
    }

    const placa = document.getElementById('edit_placa').value.trim().toUpperCase();
    const capacidad = parseInt(document.getElementById('edit_capacidad').value);
    const id_ruta = parseInt(document.getElementById('edit_id_ruta').value) || null;
    const estado = document.getElementById('edit_estado').value;
    const latitud = parseFloat(document.getElementById('edit_latitud').value) || 0;
    const longitud = parseFloat(document.getElementById('edit_longitud').value) || 0;

    let ruta_nombre = 'Sin asignar';
    if (id_ruta) {
        const ruta = rutasDisponibles.find(r => r.id === id_ruta);
        if (ruta) ruta_nombre = ruta.nombre;
    }

    buses[index] = {
        ...buses[index],
        placa,
        capacidad,
        id_ruta,
        ruta_nombre,
        estado,
        latitud,
        longitud
    };

    renderTable();
    closeEditModal();
    showToast('✅ Bus con placa "' + placa + '" actualizado exitosamente', 'success');
}

function confirmDelete(id, placa) {
    deleteBusId = id;
    document.getElementById('deleteBusPlaca').textContent = placa;
    document.getElementById('deleteModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function deleteBus() {
    if (deleteBusId === null) return;

    const index = buses.findIndex(b => b.id === deleteBusId);
    if (index !== -1) {
        const placa = buses[index].placa;
        buses.splice(index, 1);
        renderTable();
        showToast('🗑️ Bus con placa "' + placa + '" eliminado exitosamente', 'info');
    }

    closeDeleteModal();
    deleteBusId = null;
}

// ================= UTILIDADES =================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;

    const inputs = form.querySelectorAll('.buses-form-input[required]');
    let isValid = true;

    form.querySelectorAll('.buses-form-error').forEach(el => el.remove());
    form.querySelectorAll('.buses-form-input-error').forEach(el => {
        el.classList.remove('buses-form-input-error');
    });

    inputs.forEach(input => {
        if (!input.value.trim()) {
            showFieldError(input, 'Este campo es obligatorio');
            isValid = false;
        }
    });

    // Validar placa (formato básico)
    const placa = document.getElementById(formId === 'createForm' ? 'placa' : 'edit_placa');
    if (placa && placa.value.trim()) {
        const placaRegex = /^[A-Za-z0-9]{4,10}$/;
        if (!placaRegex.test(placa.value.trim())) {
            showFieldError(placa, 'Ingresa una placa válida (4-10 caracteres alfanuméricos)');
            isValid = false;
        }
    }

    // Validar capacidad
    const capacidad = document.getElementById(formId === 'createForm' ? 'capacidad' : 'edit_capacidad');
    if (capacidad && capacidad.value && parseInt(capacidad.value) <= 0) {
        showFieldError(capacidad, 'La capacidad debe ser mayor a 0');
        isValid = false;
    }

    return isValid;
}

function showFieldError(input, message) {
    input.classList.add('buses-form-input-error');

    const error = document.createElement('div');
    error.className = 'buses-form-error';
    error.textContent = '⚠️ ' + message;

    input.parentNode.appendChild(error);
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.buses-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `buses-toast buses-toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button class="buses-toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s ease';
            setTimeout(() => toast.remove(), 500);
        }
    }, 5000);
}

// ================= FILTROS Y BÚSQUEDA =================

function initSearchFilter() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    searchInput.addEventListener('keyup', filterTable);
}

function initEstadoFilter() {
    const estadoFilter = document.getElementById('estadoFilter');
    if (!estadoFilter) return;
    estadoFilter.addEventListener('change', filterTable);
}

function initRutaFilter() {
    const rutaFilter = document.getElementById('rutaFilter');
    if (!rutaFilter) return;
    rutaFilter.addEventListener('change', filterTable);
}

function filterTable() {
    const searchInput = document.getElementById('searchInput');
    const estadoFilter = document.getElementById('estadoFilter');
    const rutaFilter = document.getElementById('rutaFilter');
    const rows = document.querySelectorAll('#busesTableBody tr');

    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const estado = estadoFilter ? estadoFilter.value : '';
    const rutaId = rutaFilter ? rutaFilter.value : '';

    let visibleCount = 0;

    rows.forEach(row => {
        if (row.classList.contains('buses-empty')) {
            return;
        }

        const placa = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
        const rowEstado = row.dataset.estado || '';
        const rowRutaId = row.dataset.id_ruta || '';

        const matchesSearch = !term || placa.includes(term);
        const matchesEstado = !estado || rowEstado === estado;
        const matchesRuta = !rutaId || rowRutaId === rutaId;

        if (matchesSearch && matchesEstado && matchesRuta) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    showNoResultsMessage(visibleCount);
}

function showNoResultsMessage(visibleCount) {
    let noResults = document.querySelector('.buses-no-results');
    const tbody = document.getElementById('busesTableBody');
    if (!tbody) return;

    if (visibleCount > 0) {
        if (noResults) noResults.remove();
        return;
    }

    if (!noResults) {
        const emptyRow = tbody.querySelector('.buses-empty');
        if (emptyRow) emptyRow.style.display = 'none';

        noResults = document.createElement('tr');
        noResults.className = 'buses-no-results';
        noResults.innerHTML = `
            <td colspan="7" style="text-align: center; padding: 3rem 1rem;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 2.5rem;">🔍</span>
                    <h3 style="margin: 0; color: var(--negro);">No se encontraron buses</h3>
                    <p style="margin: 0; color: var(--gris);">Intenta ajustar los filtros de búsqueda</p>
                </div>
            </td>
        `;
        tbody.appendChild(noResults);
    } else {
        noResults.style.display = '';
    }
}

// ================= MODALES =================

function initModalEvents() {
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });

    document.querySelectorAll('.buses-modal').forEach(modal => {
        modal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });
}

function openCreateModal() {
    const modal = document.getElementById('createModal');
    const form = document.getElementById('createForm');
    if (modal) {
        if (form) form.reset();
        document.querySelectorAll('.buses-form-error').forEach(el => el.remove());
        document.querySelectorAll('.buses-form-input-error').forEach(el => {
            el.classList.remove('buses-form-input-error');
        });
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            document.getElementById('placa')?.focus();
        }, 100);
    }
}

function closeCreateModal() {
    const modal = document.getElementById('createModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Exportar funciones globales
window.confirmDelete = confirmDelete;
window.deleteBus = deleteBus;
window.editBus = editBus;
window.saveBus = saveBus;
window.updateBus = updateBus;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.closeDeleteModal = closeDeleteModal;
window.closeEditModal = closeEditModal;