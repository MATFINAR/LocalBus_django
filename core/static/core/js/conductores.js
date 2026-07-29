// ================= DATOS DE EJEMPLO =================
// Conductores de ejemplo
const conductoresData = [
    {
        id: 1,
        nombre: "Juan Carlos Pérez",
        cedula: "1234567890",
        telefono: "3001234567",
        email: "juan.perez@email.com",
        contraseña: "******",
        id_ruta: 1,
        ruta_nombre: "Ruta 10 - Centro ↔ Terminal Norte"
    },
    {
        id: 2,
        nombre: "María Elena Rodríguez",
        cedula: "0987654321",
        telefono: "3012345678",
        email: "maria.rodriguez@email.com",
        contraseña: "******",
        id_ruta: 2,
        ruta_nombre: "Ruta 15 - Universidad ↔ Plaza Mayor"
    },
    {
        id: 3,
        nombre: "Carlos Alberto Gómez",
        cedula: "9876543210",
        telefono: "3023456789",
        email: "carlos.gomez@email.com",
        contraseña: "******",
        id_ruta: 3,
        ruta_nombre: "Ruta 20 - Aeropuerto ↔ Centro"
    },
    {
        id: 4,
        nombre: "Ana María Martínez",
        cedula: "4567890123",
        telefono: "3034567890",
        email: "ana.martinez@email.com",
        contraseña: "******",
        id_ruta: 4,
        ruta_nombre: "Ruta 25 - Zona Rosa ↔ Estadio"
    },
    {
        id: 5,
        nombre: "Luis Fernando Torres",
        cedula: "5678901234",
        telefono: "3045678901",
        email: "luis.torres@email.com",
        contraseña: "******",
        id_ruta: 5,
        ruta_nombre: "Ruta 30 - Norte ↔ Sur (Express)"
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

// Variable para almacenar el ID del conductor a eliminar
let deleteConductorId = null;
let conductores = [];

// ================= INICIALIZACIÓN =================
document.addEventListener('DOMContentLoaded', function() {
    // Inicializar con los datos de ejemplo
    conductores = [...conductoresData];
    renderTable();
    fillRouteSelects();
    
    initSearchFilter();
    initRouteFilter();
    initModalEvents();
});

// ================= FUNCIONES DE RENDERIZADO =================

/**
 * Llena los selects de rutas en los modales
 */
function fillRouteSelects() {
    const selects = ['id_ruta', 'edit_id_ruta'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        // Mantener la opción "Sin asignar"
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
        
        // Agregar las rutas disponibles
        rutasDisponibles.forEach(ruta => {
            const option = document.createElement('option');
            option.value = ruta.id;
            option.textContent = ruta.nombre;
            select.appendChild(option);
        });
    });
}

/**
 * Renderiza la tabla de conductores
 */
function renderTable() {
    const tbody = document.getElementById('conductoresTableBody');
    if (!tbody) return;
    
    if (conductores.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="conductores-empty">
                    <div class="conductores-empty-state">
                        <span class="conductores-empty-icon">👨‍✈️</span>
                        <h3>No hay conductores registrados</h3>
                        <p>Comienza agregando un nuevo conductor al sistema.</p>
                        <button class="conductores-btn-primary" onclick="openCreateModal()" style="margin-top:0.5rem;">Agregar primer conductor</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    conductores.forEach(conductor => {
        const rutaNombre = conductor.ruta_nombre || 'Sin asignar';
        html += `
            <tr class="conductores-row" data-id="${conductor.id}" data-id_ruta="${conductor.id_ruta || ''}">
                <td><span class="conductores-id">#${conductor.id}</span></td>
                <td><strong>${escapeHtml(conductor.nombre)}</strong></td>
                <td><span class="conductores-cedula">${escapeHtml(conductor.cedula)}</span></td>
                <td>${escapeHtml(conductor.telefono)}</td>
                <td>${escapeHtml(conductor.email)}</td>
                <td>${escapeHtml(rutaNombre)}</td>
                <td>
                    <div class="conductores-actions">
                        <button class="conductores-action-btn conductores-action-edit" onclick="editConductor(${conductor.id})" title="Editar">
                            ✏️
                        </button>
                        <button class="conductores-action-btn conductores-action-delete" onclick="confirmDelete(${conductor.id}, '${escapeHtml(conductor.nombre)}')" title="Eliminar">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// ================= CRUD DE CONDUCTORES =================

/**
 * Guarda un nuevo conductor
 */
function saveConductor() {
    // Validar formulario
    if (!validateForm('createForm')) {
        return;
    }
    
    // Obtener datos del formulario
    const nombre = document.getElementById('nombre').value.trim();
    const cedula = document.getElementById('cedula').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const email = document.getElementById('email').value.trim();
    const contraseña = document.getElementById('contraseña').value;
    const id_ruta = parseInt(document.getElementById('id_ruta').value) || null;
    
    // Encontrar el nombre de la ruta
    let ruta_nombre = 'Sin asignar';
    if (id_ruta) {
        const ruta = rutasDisponibles.find(r => r.id === id_ruta);
        if (ruta) ruta_nombre = ruta.nombre;
    }
    
    // Crear nuevo conductor
    const newConductor = {
        id: Date.now(),
        nombre,
        cedula,
        telefono,
        email,
        contraseña: '******', // En producción se debe encriptar
        id_ruta,
        ruta_nombre
    };
    
    // Agregar a la lista
    conductores.push(newConductor);
    
    // Renderizar tabla
    renderTable();
    
    // Cerrar modal
    closeCreateModal();
    
    // Mostrar mensaje de éxito
    showToast('✅ Conductor "' + nombre + '" creado exitosamente', 'success');
    
    // Resetear formulario
    document.getElementById('createForm').reset();
}

/**
 * Edita un conductor existente
 */
function editConductor(id) {
    const conductor = conductores.find(c => c.id === id);
    if (!conductor) {
        showToast('❌ Conductor no encontrado', 'error');
        return;
    }
    
    // Llenar formulario de edición
    document.getElementById('edit_id').value = conductor.id;
    document.getElementById('edit_nombre').value = conductor.nombre;
    document.getElementById('edit_cedula').value = conductor.cedula;
    document.getElementById('edit_telefono').value = conductor.telefono;
    document.getElementById('edit_email').value = conductor.email;
    document.getElementById('edit_id_ruta').value = conductor.id_ruta || '';
    document.getElementById('edit_contraseña').value = '';
    
    // Abrir modal de edición
    document.getElementById('editModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Actualiza un conductor existente
 */
function updateConductor() {
    // Validar formulario
    if (!validateForm('editForm')) {
        return;
    }
    
    const id = parseInt(document.getElementById('edit_id').value);
    const index = conductores.findIndex(c => c.id === id);
    
    if (index === -1) {
        showToast('❌ Conductor no encontrado', 'error');
        return;
    }
    
    // Obtener datos del formulario
    const nombre = document.getElementById('edit_nombre').value.trim();
    const cedula = document.getElementById('edit_cedula').value.trim();
    const telefono = document.getElementById('edit_telefono').value.trim();
    const email = document.getElementById('edit_email').value.trim();
    const contraseña = document.getElementById('edit_contraseña').value;
    const id_ruta = parseInt(document.getElementById('edit_id_ruta').value) || null;
    
    // Encontrar el nombre de la ruta
    let ruta_nombre = 'Sin asignar';
    if (id_ruta) {
        const ruta = rutasDisponibles.find(r => r.id === id_ruta);
        if (ruta) ruta_nombre = ruta.nombre;
    }
    
    // Actualizar conductor
    conductores[index] = {
        ...conductores[index],
        nombre,
        cedula,
        telefono,
        email,
        contraseña: contraseña ? '******' : conductores[index].contraseña,
        id_ruta,
        ruta_nombre
    };
    
    // Renderizar tabla
    renderTable();
    
    // Cerrar modal
    closeEditModal();
    
    // Mostrar mensaje de éxito
    showToast('✅ Conductor "' + nombre + '" actualizado exitosamente', 'success');
}

/**
 * Confirma la eliminación de un conductor
 */
function confirmDelete(id, nombre) {
    deleteConductorId = id;
    document.getElementById('deleteConductorNombre').textContent = nombre;
    document.getElementById('deleteModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Elimina un conductor
 */
function deleteConductor() {
    if (deleteConductorId === null) return;
    
    const index = conductores.findIndex(c => c.id === deleteConductorId);
    if (index !== -1) {
        const nombre = conductores[index].nombre;
        conductores.splice(index, 1);
        renderTable();
        showToast('🗑️ Conductor "' + nombre + '" eliminado exitosamente', 'info');
    }
    
    closeDeleteModal();
    deleteConductorId = null;
}

// ================= UTILIDADES =================

/**
 * Escapa caracteres HTML para prevenir XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Valida un formulario
 */
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;
    
    const inputs = form.querySelectorAll('.conductores-form-input[required]');
    let isValid = true;
    
    // Remover errores anteriores
    form.querySelectorAll('.conductores-form-error').forEach(el => el.remove());
    form.querySelectorAll('.conductores-form-input-error').forEach(el => {
        el.classList.remove('conductores-form-input-error');
    });
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            showFieldError(input, 'Este campo es obligatorio');
            isValid = false;
        }
    });
    
    // Validar email
    const email = document.getElementById(formId === 'createForm' ? 'email' : 'edit_email');
    if (email && email.value.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.value.trim())) {
            showFieldError(email, 'Ingresa un email válido');
            isValid = false;
        }
    }
    
    // Validar teléfono (solo números)
    const telefono = document.getElementById(formId === 'createForm' ? 'telefono' : 'edit_telefono');
    if (telefono && telefono.value.trim()) {
        const phoneRegex = /^[0-9]{7,15}$/;
        if (!phoneRegex.test(telefono.value.trim())) {
            showFieldError(telefono, 'Ingresa un teléfono válido (solo números)');
            isValid = false;
        }
    }
    
    // Validar cédula (solo números)
    const cedula = document.getElementById(formId === 'createForm' ? 'cedula' : 'edit_cedula');
    if (cedula && cedula.value.trim()) {
        const cedulaRegex = /^[0-9]{6,15}$/;
        if (!cedulaRegex.test(cedula.value.trim())) {
            showFieldError(cedula, 'Ingresa una cédula válida (solo números)');
            isValid = false;
        }
    }
    
    // Validar contraseña en creación
    if (formId === 'createForm') {
        const contraseña = document.getElementById('contraseña');
        if (contraseña && contraseña.value.trim().length < 6) {
            showFieldError(contraseña, 'La contraseña debe tener al menos 6 caracteres');
            isValid = false;
        }
    }
    
    return isValid;
}

/**
 * Muestra error en un campo
 */
function showFieldError(input, message) {
    input.classList.add('conductores-form-input-error');
    
    const error = document.createElement('div');
    error.className = 'conductores-form-error';
    error.textContent = '⚠️ ' + message;
    
    input.parentNode.appendChild(error);
}

/**
 * Muestra un toast de notificación
 */
function showToast(message, type = 'success') {
    const existing = document.querySelector('.conductores-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `conductores-toast conductores-toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button class="conductores-toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.body.appendChild(toast);
    
    // Auto cerrar después de 5 segundos
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

function initRouteFilter() {
    const routeFilter = document.getElementById('rutaFilter');
    if (!routeFilter) return;
    
    // Llenar el filtro de rutas
    rutasDisponibles.forEach(ruta => {
        const option = document.createElement('option');
        option.value = ruta.id;
        option.textContent = ruta.nombre;
        routeFilter.appendChild(option);
    });
    
    routeFilter.addEventListener('change', filterTable);
}

function filterTable() {
    const searchInput = document.getElementById('searchInput');
    const routeFilter = document.getElementById('rutaFilter');
    const rows = document.querySelectorAll('#conductoresTableBody tr');
    
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const routeId = routeFilter ? routeFilter.value : '';
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        if (row.classList.contains('conductores-empty')) {
            return;
        }
        
        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
        const cedula = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
        const telefono = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
        const email = row.querySelector('td:nth-child(5)')?.textContent?.toLowerCase() || '';
        const rowRouteId = row.dataset.id_ruta || '';
        
        const matchesSearch = !term || 
            nombre.includes(term) || 
            cedula.includes(term) || 
            telefono.includes(term) || 
            email.includes(term);
        
        const matchesRoute = !routeId || rowRouteId === routeId;
        
        if (matchesSearch && matchesRoute) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    showNoResultsMessage(visibleCount);
}

function showNoResultsMessage(visibleCount) {
    let noResults = document.querySelector('.conductores-no-results');
    const tbody = document.getElementById('conductoresTableBody');
    if (!tbody) return;
    
    if (visibleCount > 0) {
        if (noResults) noResults.remove();
        return;
    }
    
    if (!noResults) {
        const emptyRow = tbody.querySelector('.conductores-empty');
        if (emptyRow) emptyRow.style.display = 'none';
        
        noResults = document.createElement('tr');
        noResults.className = 'conductores-no-results';
        noResults.innerHTML = `
            <td colspan="7" style="text-align: center; padding: 3rem 1rem;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 2.5rem;">🔍</span>
                    <h3 style="margin: 0; color: var(--negro);">No se encontraron conductores</h3>
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
    // Cerrar modales con ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });
    
    // Cerrar modales al hacer clic en el overlay
    document.querySelectorAll('.conductores-modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
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
        document.querySelectorAll('.conductores-form-error').forEach(el => el.remove());
        document.querySelectorAll('.conductores-form-input-error').forEach(el => {
            el.classList.remove('conductores-form-input-error');
        });
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            document.getElementById('nombre')?.focus();
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
window.deleteConductor = deleteConductor;
window.editConductor = editConductor;
window.saveConductor = saveConductor;
window.updateConductor = updateConductor;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.closeDeleteModal = closeDeleteModal;
window.closeEditModal = closeEditModal;