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
    const modal = document.getElementById('editModal');
    if (modal) {
        // Aquí puedes cargar los datos del bus si quieres
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