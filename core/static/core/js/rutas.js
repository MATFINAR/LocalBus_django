// ================= DATOS DE EJEMPLO =================
// Rutas del Área Metropolitana de Medellín
const rutasData = [
    {
        id: 1,
        nombre: "Ruta 10 - Centro ↔ Terminal Norte",
        origen: "Centro Histórico",
        destino: "Terminal del Norte",
        distancia_km: 12.5,
        duracion_estimada: "35 min",
        estado: "Activa",
        fecha_creacion: "2024-01-15",
        frecuencia: 15,
        paradas: 18
    },
    {
        id: 2,
        nombre: "Ruta 15 - Universidad ↔ Plaza Mayor",
        origen: "Universidad Nacional",
        destino: "Plaza Mayor",
        distancia_km: 8.3,
        duracion_estimada: "25 min",
        estado: "Activa",
        fecha_creacion: "2024-02-01",
        frecuencia: 20,
        paradas: 12
    },
    {
        id: 3,
        nombre: "Ruta 20 - Aeropuerto ↔ Centro",
        origen: "Aeropuerto Internacional",
        destino: "Centro de la ciudad",
        distancia_km: 15.2,
        duracion_estimada: "45 min",
        estado: "Activa",
        fecha_creacion: "2024-02-15",
        frecuencia: 30,
        paradas: 22
    },
    {
        id: 4,
        nombre: "Ruta 25 - Zona Rosa ↔ Estadio",
        origen: "Zona Rosa",
        destino: "Estadio Metropolitano",
        distancia_km: 9.8,
        duracion_estimada: "30 min",
        estado: "Activa",
        fecha_creacion: "2024-03-01",
        frecuencia: 25,
        paradas: 14
    },
    {
        id: 5,
        nombre: "Ruta 30 - Norte ↔ Sur (Express)",
        origen: "Terminal del Norte",
        destino: "Terminal del Sur",
        distancia_km: 18.6,
        duracion_estimada: "50 min",
        estado: "Activa",
        fecha_creacion: "2024-03-15",
        frecuencia: 15,
        paradas: 8
    },
    {
        id: 6,
        nombre: "Ruta 35 - Centro ↔ Parque Industrial",
        origen: "Centro",
        destino: "Parque Industrial",
        distancia_km: 11.4,
        duracion_estimada: "32 min",
        estado: "Mantenimiento",
        fecha_creacion: "2024-04-01",
        frecuencia: 20,
        paradas: 16
    },
    {
        id: 7,
        nombre: "Ruta 40 - Circular Centro",
        origen: "Plaza Central",
        destino: "Plaza Central",
        distancia_km: 6.5,
        duracion_estimada: "20 min",
        estado: "Activa",
        fecha_creacion: "2024-04-15",
        frecuencia: 15,
        paradas: 10
    },
    {
        id: 8,
        nombre: "Ruta 45 - Norte ↔ Zona Franca",
        origen: "Terminal del Norte",
        destino: "Zona Franca",
        distancia_km: 14.2,
        duracion_estimada: "40 min",
        estado: "Activa",
        fecha_creacion: "2024-05-01",
        frecuencia: 25,
        paradas: 20
    }
];

// Variable para almacenar el ID de la ruta a eliminar
let deleteRutaId = null;
let rutas = [];

// ================= INICIALIZACIÓN =================
document.addEventListener('DOMContentLoaded', function () {
    // Inicializar con los datos de ejemplo
    rutas = [...rutasData];
    renderTable();

    initSearchFilter();
    initStatusFilter();
    initModalEvents();
});

// ================= CRUD DE RUTAS =================

/**
 * Guarda una nueva ruta
 */
/**
 * Convierte horas y minutos a formato de texto
 */
function formatearDuracion(horas, minutos) {
    horas = parseInt(horas) || 0;
    minutos = parseInt(minutos) || 0;

    if (horas === 0 && minutos === 0) {
        return '-';
    }

    let resultado = '';
    if (horas > 0) {
        resultado += `${horas}h`;
    }
    if (minutos > 0) {
        if (resultado) resultado += ' ';
        resultado += `${minutos}min`;
    }
    return resultado;
}

/**
 * Convierte un string de duración a horas y minutos
 * Ej: "2h 30min" -> {horas: 2, minutos: 30}
 */
function parsearDuracion(duracionStr) {
    if (!duracionStr || duracionStr === '-') {
        return { horas: 0, minutos: 0 };
    }

    let horas = 0;
    let minutos = 0;

    const hMatch = duracionStr.match(/(\d+)h/);
    const mMatch = duracionStr.match(/(\d+)min/);

    if (hMatch) horas = parseInt(hMatch[1]);
    if (mMatch) minutos = parseInt(mMatch[1]);

    return { horas, minutos };
}

/**
 * Guarda una nueva ruta
 */
function saveRuta() {
    // Validar formulario
    if (!validateForm('createForm')) {
        return;
    }

    // Obtener datos del formulario
    const nombre = document.getElementById('nombre').value.trim();
    const origen = document.getElementById('origen').value.trim();
    const destino = document.getElementById('destino').value.trim();
    const distancia_km = parseFloat(document.getElementById('distancia_km').value);
    const estado = document.getElementById('estado').value;
    const frecuencia = parseInt(document.getElementById('frecuencia').value) || null;
    const paradas = parseInt(document.getElementById('paradas').value) || 0;

    // Obtener horas y minutos de duración
    const horas = parseInt(document.getElementById('duracion_horas').value) || 0;
    const minutos = parseInt(document.getElementById('duracion_minutos').value) || 0;
    const duracion_estimada = formatearDuracion(horas, minutos);

    // Crear nueva ruta
    const newRuta = {
        id: Date.now(),
        nombre,
        origen,
        destino,
        distancia_km,
        duracion_estimada,
        estado,
        fecha_creacion: new Date().toISOString().split('T')[0],
        frecuencia,
        paradas
    };

    // Agregar a la lista
    rutas.push(newRuta);

    // Renderizar tabla
    renderTable();

    // Cerrar modal
    closeCreateModal();

    // Mostrar mensaje de éxito
    showToast('✅ Ruta "' + nombre + '" creada exitosamente', 'success');

    // Resetear formulario
    document.getElementById('createForm').reset();
}

/**
 * Edita una ruta existente
 */
function editRuta(id) {
    const ruta = rutas.find(r => r.id === id);
    if (!ruta) {
        showToast('❌ Ruta no encontrada', 'error');
        return;
    }

    // Parsear duración
    const { horas, minutos } = parsearDuracion(ruta.duracion_estimada);

    // Llenar formulario de edición
    document.getElementById('edit_id').value = ruta.id;
    document.getElementById('edit_nombre').value = ruta.nombre;
    document.getElementById('edit_origen').value = ruta.origen;
    document.getElementById('edit_destino').value = ruta.destino;
    document.getElementById('edit_distancia_km').value = ruta.distancia_km;
    document.getElementById('edit_duracion_horas').value = horas;
    document.getElementById('edit_duracion_minutos').value = minutos;
    document.getElementById('edit_estado').value = ruta.estado;
    document.getElementById('edit_frecuencia').value = ruta.frecuencia || '';
    document.getElementById('edit_paradas').value = ruta.paradas || 0;

    // Abrir modal de edición
    document.getElementById('editModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Actualiza una ruta existente
 */
function updateRuta() {
    // Validar formulario
    if (!validateForm('editForm')) {
        return;
    }

    const id = parseInt(document.getElementById('edit_id').value);
    const index = rutas.findIndex(r => r.id === id);

    if (index === -1) {
        showToast('❌ Ruta no encontrada', 'error');
        return;
    }

    // Obtener datos del formulario
    const nombre = document.getElementById('edit_nombre').value.trim();
    const origen = document.getElementById('edit_origen').value.trim();
    const destino = document.getElementById('edit_destino').value.trim();
    const distancia_km = parseFloat(document.getElementById('edit_distancia_km').value);
    const estado = document.getElementById('edit_estado').value;
    const frecuencia = parseInt(document.getElementById('edit_frecuencia').value) || null;
    const paradas = parseInt(document.getElementById('edit_paradas').value) || 0;

    // Obtener horas y minutos de duración
    const horas = parseInt(document.getElementById('edit_duracion_horas').value) || 0;
    const minutos = parseInt(document.getElementById('edit_duracion_minutos').value) || 0;
    const duracion_estimada = formatearDuracion(horas, minutos);

    // Actualizar ruta
    rutas[index] = {
        ...rutas[index],
        nombre,
        origen,
        destino,
        distancia_km,
        duracion_estimada,
        estado,
        frecuencia,
        paradas
    };

    // Renderizar tabla
    renderTable();

    // Cerrar modal
    closeEditModal();

    // Mostrar mensaje de éxito
    showToast('✅ Ruta "' + nombre + '" actualizada exitosamente', 'success');
}

/**
 * Valida un formulario
 */
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;

    const inputs = form.querySelectorAll('.rutas-form-input[required]');
    let isValid = true;

    // Remover errores anteriores
    form.querySelectorAll('.rutas-form-error').forEach(el => el.remove());
    form.querySelectorAll('.rutas-form-input-error').forEach(el => {
        el.classList.remove('rutas-form-input-error');
    });

    inputs.forEach(input => {
        if (!input.value.trim()) {
            showFieldError(input, 'Este campo es obligatorio');
            isValid = false;
        }
    });

    // Validar distancia
    const distancia = document.getElementById(formId === 'createForm' ? 'distancia_km' : 'edit_distancia_km');
    if (distancia && distancia.value && parseFloat(distancia.value) <= 0) {
        showFieldError(distancia, 'La distancia debe ser mayor a 0');
        isValid = false;
    }

    // Validar que al menos una duración (horas o minutos) sea > 0 o ambos sean 0
    const horasId = formId === 'createForm' ? 'duracion_horas' : 'edit_duracion_horas';
    const minutosId = formId === 'createForm' ? 'duracion_minutos' : 'edit_duracion_minutos';
    const horas = parseInt(document.getElementById(horasId).value) || 0;
    const minutos = parseInt(document.getElementById(minutosId).value) || 0;

    if (horas < 0 || minutos < 0) {
        showFieldError(document.getElementById(horasId), 'Los valores no pueden ser negativos');
        isValid = false;
    }

    if (minutos > 59) {
        showFieldError(document.getElementById(minutosId), 'Los minutos no pueden ser mayores a 59');
        isValid = false;
    }

    return isValid;
}

// Actualizar el evento DOMContentLoaded para incluir la validación de duración
document.addEventListener('DOMContentLoaded', function () {
    // Inicializar con los datos de ejemplo
    rutas = [...rutasData];
    renderTable();

    initSearchFilter();
    initStatusFilter();
    initModalEvents();

    // Agregar validación en tiempo real para minutos
    document.querySelectorAll('.rutas-duracion-input').forEach(input => {
        input.addEventListener('input', function () {
            const value = parseInt(this.value) || 0;
            if (this.id.includes('minutos') && value > 59) {
                this.value = 59;
            }
            if (value < 0) {
                this.value = 0;
            }
        });
    });
});
/**
 * Confirma la eliminación de una ruta
 */
function confirmDelete(id, nombre) {
    deleteRutaId = id;
    document.getElementById('deleteRutaNombre').textContent = nombre;
    document.getElementById('deleteModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Elimina una ruta
 */
function deleteRuta() {
    if (deleteRutaId === null) return;

    const index = rutas.findIndex(r => r.id === deleteRutaId);
    if (index !== -1) {
        const nombre = rutas[index].nombre;
        rutas.splice(index, 1);
        renderTable();
        showToast('🗑️ Ruta "' + nombre + '" eliminada exitosamente', 'info');
    }

    closeDeleteModal();
    deleteRutaId = null;
}

// ================= RENDERIZADO =================

/**
 * Renderiza la tabla de rutas
 */
function renderTable() {
    const tbody = document.getElementById('rutasTableBody');
    if (!tbody) return;

    if (rutas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="rutas-empty">
                    <div class="rutas-empty-state">
                        <span class="rutas-empty-icon">🚌</span>
                        <h3>No hay rutas registradas</h3>
                        <p>Comienza agregando una nueva ruta al sistema.</p>
                        <button class="rutas-btn-primary" onclick="openCreateModal()" style="margin-top:0.5rem;">Agregar primera ruta</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    rutas.forEach(ruta => {
        const statusClass = ruta.estado.toLowerCase();
        html += `
            <tr class="rutas-row" data-id="${ruta.id}" data-status="${ruta.estado}">
                <td><span class="rutas-id">#${ruta.id}</span></td>
                <td><strong>${escapeHtml(ruta.nombre)}</strong></td>
                <td>${escapeHtml(ruta.origen)}</td>
                <td>${escapeHtml(ruta.destino)}</td>
                <td>${ruta.distancia_km} km</td>
                <td>${escapeHtml(ruta.duracion_estimada || '-')}</td>
                <td>
                    <span class="rutas-status rutas-status-${statusClass}">
                        ${escapeHtml(ruta.estado)}
                    </span>
                </td>
                <td>${formatDate(ruta.fecha_creacion)}</td>
                <td>
                    <div class="rutas-actions">
                        <button class="rutas-action-btn rutas-action-edit" onclick="editRuta(${ruta.id})" title="Editar">
                            ✏️
                        </button>
                        <button class="rutas-action-btn rutas-action-delete" onclick="confirmDelete(${ruta.id}, '${escapeHtml(ruta.nombre)}')" title="Eliminar">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
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
 * Formatea una fecha
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString('es-CO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Valida un formulario
 */
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;

    const inputs = form.querySelectorAll('.rutas-form-input[required]');
    let isValid = true;

    // Remover errores anteriores
    form.querySelectorAll('.rutas-form-error').forEach(el => el.remove());
    form.querySelectorAll('.rutas-form-input-error').forEach(el => {
        el.classList.remove('rutas-form-input-error');
    });

    inputs.forEach(input => {
        if (!input.value.trim()) {
            showFieldError(input, 'Este campo es obligatorio');
            isValid = false;
        }
    });

    // Validar distancia
    const distancia = document.getElementById(formId === 'createForm' ? 'distancia_km' : 'edit_distancia_km');
    if (distancia && distancia.value && parseFloat(distancia.value) <= 0) {
        showFieldError(distancia, 'La distancia debe ser mayor a 0');
        isValid = false;
    }

    return isValid;
}

/**
 * Muestra error en un campo
 */
function showFieldError(input, message) {
    input.classList.add('rutas-form-input-error');

    const error = document.createElement('div');
    error.className = 'rutas-form-error';
    error.textContent = '⚠️ ' + message;

    input.parentNode.appendChild(error);
}

/**
 * Muestra un toast de notificación
 */
function showToast(message, type = 'success') {
    const existing = document.querySelector('.rutas-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `rutas-toast rutas-toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button class="rutas-toast-close" onclick="this.parentElement.remove()">✕</button>
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

function initStatusFilter() {
    const statusFilter = document.getElementById('statusFilter');
    if (!statusFilter) return;
    statusFilter.addEventListener('change', filterTable);
}

function filterTable() {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const rows = document.querySelectorAll('#rutasTableBody tr');

    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const status = statusFilter ? statusFilter.value : '';

    let visibleCount = 0;

    rows.forEach(row => {
        if (row.classList.contains('rutas-empty')) {
            return;
        }

        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
        const origen = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
        const destino = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
        const rowStatus = row.dataset.status || '';

        const matchesSearch = !term ||
            nombre.includes(term) ||
            origen.includes(term) ||
            destino.includes(term);

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
        const emptyRow = tbody.querySelector('.rutas-empty');
        if (emptyRow) emptyRow.style.display = 'none';

        noResults = document.createElement('tr');
        noResults.className = 'rutas-no-results';
        noResults.innerHTML = `
            <td colspan="9" style="text-align: center; padding: 3rem 1rem;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 2.5rem;">🔍</span>
                    <h3 style="margin: 0; color: var(--negro);">No se encontraron rutas</h3>
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
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });

    // Cerrar modales al hacer clic en el overlay
    document.querySelectorAll('.rutas-modal').forEach(modal => {
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
        document.querySelectorAll('.rutas-form-error').forEach(el => el.remove());
        document.querySelectorAll('.rutas-form-input-error').forEach(el => {
            el.classList.remove('rutas-form-input-error');
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
window.deleteRuta = deleteRuta;
window.editRuta = editRuta;
window.saveRuta = saveRuta;
window.updateRuta = updateRuta;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.closeDeleteModal = closeDeleteModal;
window.closeEditModal = closeEditModal;