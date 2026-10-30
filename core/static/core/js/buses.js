// ================= VARIABLES GLOBALES =================
let deleteBusId = null;

// ================= VARIABLES PARA CONFIRMACIÓN DE CAMBIOS =================
let datosOriginalesBus = {};
let formPendienteBus = null;

// ================= FUNCIONES PARA ABRIR Y CERRAR MODALES =================

// Abrir modal de crear
function openCreateModal() {
    const modal = document.getElementById('createModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Cerrar modal de crear
function closeCreateModal() {
    const modal = document.getElementById('createModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Abrir modal de editar
function openEditModal(id) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) {
        alert('Bus no encontrado');
        return;
    }

    const placa = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
    const rutas = (row.dataset.rutas || '').split(',').filter(Boolean);

    document.getElementById('edit_id').value = id;
    document.getElementById('edit_placa').value = placa;
    document.querySelectorAll('#edit_rutas input[name="rutas"]').forEach(check => {
        check.checked = rutas.includes(check.value);
    });

    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // ✅ Guardar datos originales para comparar después
        setTimeout(() => {
            guardarDatosOriginalesBus();
        }, 100);
    }
}

// Cerrar modal de editar
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Abrir modal de eliminar
function openDeleteModal(id, placa) {
    deleteBusId = id;
    document.getElementById('deleteBusPlaca').textContent = placa;
    document.getElementById('delete_id').value = id;
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Cerrar modal de eliminar
function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        deleteBusId = null;
    }
}

// Cerrar todos los modales
function closeAllModals() {
    closeCreateModal();
    closeEditModal();
    closeDeleteModal();
}

// ================= FUNCIÓN PARA FILTRAR =================

function filterTable() {
    const searchInput = document.getElementById('searchInput');
    const rutaFilter = document.getElementById('rutaFilter');
    const rows = document.querySelectorAll('#busesTableBody tr');

    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const rutaId = rutaFilter ? rutaFilter.value : '';

    let visibleCount = 0;

    rows.forEach(row => {
        // Saltar filas vacías o de "no hay buses"
        if (row.classList.contains('buses-empty')) {
            return;
        }

        const placa = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
        const rutaText = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
        const conductorText = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
        const rowRutas = (row.dataset.rutas || '').split(',');

        const matchesSearch = !term || placa.includes(term) || rutaText.includes(term) || conductorText.includes(term);
        const matchesRuta = !rutaId || rowRutas.includes(rutaId);

        if (matchesSearch && matchesRuta) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    // Mostrar mensaje si no hay resultados
    let noResults = document.querySelector('.buses-no-results');
    const tbody = document.getElementById('busesTableBody');
    if (!tbody) return;

    if (visibleCount > 0) {
        if (noResults) noResults.remove();
        return;
    }

    // Si no hay resultados y hay filas (no vacías)
    const hasRows = rows.length > 0 && !rows[0].classList.contains('buses-empty');
    if (hasRows) {
        if (!noResults) {
            noResults = document.createElement('tr');
            noResults.className = 'buses-no-results';
            noResults.innerHTML = `
                <td colspan="5" style="text-align: center; padding: 3rem 1rem; color: #999;">
                    <p>🔍 No se encontraron buses con esos filtros</p>
                </td>
            `;
            tbody.appendChild(noResults);
        } else {
            noResults.style.display = '';
        }
    }
}

// ================= CONFIRMACIÓN DE CAMBIOS =================

// Nombres de las rutas marcadas en el formulario de edición, separados por coma
function rutasMarcadasBus() {
    return Array.from(document.querySelectorAll('#edit_rutas input[name="rutas"]:checked'))
        .map(check => check.parentElement.textContent.trim())
        .join(', ');
}

function guardarDatosOriginalesBus() {
    datosOriginalesBus = {
        placa: document.getElementById('edit_placa')?.value || '',
        rutas: rutasMarcadasBus(),
    };
}

function obtenerDatosActualesBus() {
    return {
        placa: document.getElementById('edit_placa')?.value || '',
        rutas: rutasMarcadasBus(),
    };
}

function detectarCambiosBus() {
    const actuales = obtenerDatosActualesBus();
    const cambios = [];
    const etiquetas = {
        placa: 'Placa',
        rutas: 'Rutas habilitadas',
    };

    for (const campo in datosOriginalesBus) {
        const anterior = datosOriginalesBus[campo];
        const nuevo = actuales[campo];

        if (anterior !== nuevo) {
            cambios.push({
                campo: etiquetas[campo] || campo,
                anterior: anterior || '(vacío)',
                nuevo: nuevo || '(vacío)',
            });
        }
    }

    return cambios;
}

function escapeHtmlBus(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function mostrarConfirmacionCambiosBus() {
    const cambios = detectarCambiosBus();
    const lista = document.getElementById('changesList');
    const nombreBus = document.getElementById('changesBusPlaca');

    if (!lista) return false;

    if (cambios.length === 0) {
        lista.innerHTML = `
            <div class="no-changes">
                <span class="no-changes-icon">📝</span>
                <p>No detectamos cambios en el bus.</p>
            </div>
        `;
    } else {
        lista.innerHTML = cambios.map(cambio => `
            <div class="change-item">
                <span class="change-field-label">${cambio.campo}</span>
                <div class="change-values">
                    <div class="change-old">
                        <span class="change-icon">−</span>
                        <span class="change-text">${escapeHtmlBus(cambio.anterior)}</span>
                    </div>
                    <div class="change-new">
                        <span class="change-icon">+</span>
                        <span class="change-text">${escapeHtmlBus(cambio.nuevo)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    if (nombreBus) {
        nombreBus.textContent = document.getElementById('edit_placa')?.value || 'sin placa';
    }

    const modal = document.getElementById('confirmChangesModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    return cambios.length > 0;
}

function closeConfirmChangesModal() {
    const modal = document.getElementById('confirmChangesModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    formPendienteBus = null;
}

function confirmarCambios() {
    const form = formPendienteBus;
    closeConfirmChangesModal();
    if (form) {
        form.submit();
    }
}

function submitEditBus() {
    // Validar placa
    const placaInput = document.getElementById('edit_placa');
    if (placaInput && placaInput.classList.contains('buses-input-error')) {
        alert('Corrige la placa antes de guardar.');
        placaInput.focus();
        return;
    }

    // Cerrar modal de editar
    const modalEdit = document.getElementById('editModal');
    if (modalEdit) {
        modalEdit.classList.remove('active');
    }

    // Mostrar modal de confirmación
    formPendienteBus = document.getElementById('editForm');
    mostrarConfirmacionCambiosBus();
}

// ================= INICIALIZACIÓN =================

document.addEventListener('DOMContentLoaded', function () {
    // Cerrar modales con tecla ESC
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeAllModals();
            closeConfirmChangesModal();
        }
    });

    // Cerrar modales clickeando fuera del contenido
    document.querySelectorAll('.buses-modal').forEach(modal => {
        modal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    // ================= FILTROS =================
    const searchInput = document.getElementById('searchInput');
    const rutaFilter = document.getElementById('rutaFilter');

    if (searchInput) {
        searchInput.addEventListener('keyup', filterTable);
    }

    if (rutaFilter) {
        rutaFilter.addEventListener('change', filterTable);
    }
});

// ================= EXPORTAR FUNCIONES GLOBALES =================

window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.closeAllModals = closeAllModals;
window.filterTable = filterTable;

window.guardarDatosOriginalesBus = guardarDatosOriginalesBus;
window.closeConfirmChangesModal = closeConfirmChangesModal;
window.confirmarCambios = confirmarCambios;
window.submitEditBus = submitEditBus;


// ============================================================
// ================= VALIDACIÓN DE PLACA EN TIEMPO REAL =================
// ============================================================

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

    // ============ FUNCIÓN GENÉRICA DE VALIDACIÓN ============
    function setupValidacionPlaca(options) {
        const {
            inputId,
            feedbackId,
            busIdInputId,
            mensajeExiste,
            mensajeDisponible
        } = options;

        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const busIdInput = busIdInputId ? document.getElementById(busIdInputId) : null;

        if (!input || !feedback) return null;

        let debounceTimer = null;
        let ultimoVerificado = '';

        function limpiarEstados() {
            input.classList.remove('buses-input-error', 'buses-input-success', 'buses-input-loading');
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');
        }

        function mostrarError(mensaje) {
            input.classList.add('buses-input-error');
            input.classList.remove('buses-input-success', 'buses-input-loading');
            feedback.textContent = mensaje;
            feedback.classList.add('error');
            feedback.classList.remove('success');
        }

        function mostrarExito(mensaje) {
            input.classList.add('buses-input-success');
            input.classList.remove('buses-input-error', 'buses-input-loading');
            feedback.textContent = mensaje;
            feedback.classList.add('success');
            feedback.classList.remove('error');
        }

        function verificar(placa) {
            if (placa === ultimoVerificado) return;
            ultimoVerificado = placa;

            input.classList.remove('buses-input-error', 'buses-input-success');
            input.classList.add('buses-input-loading');
            feedback.textContent = '';
            feedback.classList.remove('error', 'success');

            const formData = new FormData();
            formData.append('placa', placa);
            if (busIdInput && busIdInput.value) {
                formData.append('bus_id', busIdInput.value);
            }
            formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

            fetch('/verificar_placa_bus/', {
                method: 'POST',
                body: formData,
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            })
                .then(response => response.json())
                .then(data => {
                    input.classList.remove('buses-input-loading');
                    if (data.existe) {
                        mostrarError(mensajeExiste);
                    } else {
                        mostrarExito(mensajeDisponible);
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    input.classList.remove('buses-input-loading');
                    ultimoVerificado = '';
                });
        }

        input.addEventListener('input', function () {
            const placa = this.value.trim().toUpperCase();
            this.value = placa;  // Forzar mayúsculas
            clearTimeout(debounceTimer);

            if (placa === '') {
                limpiarEstados();
                ultimoVerificado = '';
                return;
            }

            // Validar formato: letras, números y guiones, 4-20 caracteres
            if (!/^[A-Z0-9\-]{4,20}$/.test(placa)) {
                mostrarError('⚠️ Solo letras, números y guiones (4-20 caracteres)');
                ultimoVerificado = '';
                return;
            }

            debounceTimer = setTimeout(function () {
                verificar(placa);
            }, 500);
        });

        input.addEventListener('blur', function () {
            const placa = this.value.trim().toUpperCase();
            if (placa !== '' && /^[A-Z0-9\-]{4,20}$/.test(placa)) {
                clearTimeout(debounceTimer);
                verificar(placa);
            }
        });

        return {
            limpiar: function () {
                limpiarEstados();
                ultimoVerificado = '';
            }
        };
    }

    // ============ VALIDACIÓN MODAL CREAR ============
    const valPlacaCrear = setupValidacionPlaca({
        inputId: 'placa',
        feedbackId: 'placaFeedback',
        busIdInputId: null,
        mensajeExiste: '❌ Esta placa ya está registrada',
        mensajeDisponible: '✓ Placa disponible'
    });

    // ============ VALIDACIÓN MODAL EDITAR ============
    const valPlacaEditar = setupValidacionPlaca({
        inputId: 'edit_placa',
        feedbackId: 'editPlacaFeedback',
        busIdInputId: 'edit_id',
        mensajeExiste: '❌ Esta placa ya está en uso',
        mensajeDisponible: '✓ Placa disponible'
    });

    // ============ LIMPIAR AL ABRIR MODALES ============
    // Cuando se abre el modal de crear
    const btnNuevoBus = document.querySelector('.buses-btn-primary[onclick="openCreateModal()"]');
    if (btnNuevoBus) {
        btnNuevoBus.addEventListener('click', function () {
            if (valPlacaCrear) valPlacaCrear.limpiar();
        });
    }

    // Cuando se abre el modal de editar
    document.querySelectorAll('.buses-action-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (valPlacaEditar) valPlacaEditar.limpiar();
        });
    });

    // ============ BLOQUEAR ENVÍO SI HAY ERRORES ============
    // Formulario crear
    const forms = document.querySelectorAll('form');
    forms.forEach(function (form) {
        form.addEventListener('submit', function (e) {
            // Si es el form de crear bus
            const placaCrear = document.getElementById('placa');
            if (placaCrear && placaCrear.classList.contains('buses-input-error')) {
                e.preventDefault();
                alert('Corrige la placa antes de guardar.');
                placaCrear.focus();
                return false;
            }

            // Si es el form de editar bus
            const placaEditar = document.getElementById('edit_placa');
            if (placaEditar && placaEditar.classList.contains('buses-input-error')) {
                e.preventDefault();
                alert('Corrige la placa antes de guardar.');
                placaEditar.focus();
                return false;
            }
        });
    });

});