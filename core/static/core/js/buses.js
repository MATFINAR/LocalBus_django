// ================= VARIABLES GLOBALES =================
let deleteBusId = null;

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
    // Buscar la fila del bus
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) {
        alert('Bus no encontrado');
        return;
    }
    
    // Obtener datos de la fila
    const placa = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
    const rutaNombre = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
    
    // Buscar el ID de la ruta en el select
    const select = document.getElementById('edit_id_ruta');
    let rutaId = '';
    for (let option of select.options) {
        if (option.text === rutaNombre) {
            rutaId = option.value;
            break;
        }
    }
    
    // Llenar el formulario
    document.getElementById('edit_id').value = id;
    document.getElementById('edit_placa').value = placa;
    document.getElementById('edit_id_ruta').value = rutaId;
    
    // Abrir el modal
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
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

// ================= INICIALIZACIÓN =================

document.addEventListener('DOMContentLoaded', function() {
    // Cerrar modales con tecla ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
    
    // Cerrar modales clickeando fuera del contenido
    document.querySelectorAll('.buses-modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });
});

// ================= EXPORTAR FUNCIONES GLOBALES =================

window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.closeAllModals = closeAllModals;
window.confirmDelete = openDeleteModal;