document.addEventListener('DOMContentLoaded', function() {
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
            const origen = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
            const destino = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
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
            const emptyRow = tbody.querySelector('.rutas-empty');
            if (emptyRow) emptyRow.style.display = 'none';

            noResults = document.createElement('tr');
            noResults.className = 'rutas-no-results';
            noResults.innerHTML = `
                <td colspan="9" style="text-align: center; padding: 3rem 1rem; color: #999;">
                    <p>🔍 No se encontraron rutas</p>
                </td>
            `;
            tbody.appendChild(noResults);
        } else {
            noResults.style.display = '';
        }
    }

    if (searchInput) searchInput.addEventListener('keyup', filterTable);
    if (statusFilter) statusFilter.addEventListener('change', filterTable);

    // ================= MODALES =================
    function openCreateModal() {
        const modal = document.getElementById('createModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCreateModal() {
        const modal = document.getElementById('createModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    function editRuta(id) {
        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeEditModal() {
        const modal = document.getElementById('editModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    function confirmDelete(id, nombre) {
        document.getElementById('deleteRutaNombre').textContent = nombre;
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
    }

    function deleteRuta() {
        if (confirm('¿Eliminar esta ruta?')) {
            closeDeleteModal();
            location.reload();
        }
    }

    function saveRuta() {
        alert('Ruta guardada correctamente');
        closeCreateModal();
        location.reload();
    }

    function updateRuta() {
        alert('Ruta actualizada correctamente');
        closeEditModal();
        location.reload();
    }

    // Cerrar modales con ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });

    // Cerrar modales clickeando fuera
    document.querySelectorAll('.rutas-modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    // Exportar funciones globales
    window.openCreateModal = openCreateModal;
    window.closeCreateModal = closeCreateModal;
    window.editRuta = editRuta;
    window.closeEditModal = closeEditModal;
    window.confirmDelete = confirmDelete;
    window.closeDeleteModal = closeDeleteModal;
    window.deleteRuta = deleteRuta;
    window.saveRuta = saveRuta;
    window.updateRuta = updateRuta;
});
