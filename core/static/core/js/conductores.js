document.addEventListener('DOMContentLoaded', function() {

    // ================= FILTROS =================

    const searchInput = document.getElementById('searchInput');
    const rutaFilter = document.getElementById('rutaFilter');

    function filterTable() {

        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const ruta = rutaFilter ? rutaFilter.value : '';

        const rows = document.querySelectorAll('#conductoresTableBody tr');
        let visibleCount = 0;

        rows.forEach(row => {

            if (row.classList.contains('conductores-empty')) return;

            const nombre = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
            const cedula = row.querySelector('td:nth-child(3)')?.textContent?.toLowerCase() || '';
            const telefono = row.querySelector('td:nth-child(4)')?.textContent?.toLowerCase() || '';
            const email = row.querySelector('td:nth-child(5)')?.textContent?.toLowerCase() || '';

            const rowRuta = row.dataset.id_ruta || '';

            const matchesSearch =
                !term ||
                nombre.includes(term) ||
                cedula.includes(term) ||
                telefono.includes(term) ||
                email.includes(term);

            const matchesRuta = !ruta || rowRuta === ruta;

            if (matchesSearch && matchesRuta) {

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
                <td colspan="7" style="text-align: center; padding: 3rem 1rem; color: #999;">
                    <p>🔍 No se encontraron conductores</p>
                </td>
            `;

            tbody.appendChild(noResults);

        } else {

            noResults.style.display = '';

        }
    }


    if (searchInput) searchInput.addEventListener('keyup', filterTable);
    if (rutaFilter) rutaFilter.addEventListener('change', filterTable);


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


    // ================= EDITAR CONDUCTOR =================

    function editConductor(id) {

        // Obtener datos de la fila

        const row = document.querySelector(`tr[data-id="${id}"]`);

        if (!row) return;

        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
        const cedula = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
        const telefono = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '';
        const email = row.querySelector('td:nth-child(5)')?.textContent?.trim() || '';
        const ruta = row.dataset.id_ruta || '';

        // Cargar datos en el formulario

        document.getElementById('edit_id').value = id;
        document.getElementById('edit_nombre').value = nombre;
        document.getElementById('edit_cedula').value = cedula;
        document.getElementById('edit_telefono').value = telefono;
        document.getElementById('edit_email').value = email;
        document.getElementById('edit_id_ruta').value = ruta;

        // Dejar contraseña vacía

        document.getElementById('edit_contrasena').value = '';

        // Enviar el formulario al conductor correspondiente

        document.getElementById('editForm').action =
            '/EditarConductor/' + id + '/';

        // Abrir modal

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


    // ================= ELIMINAR CONDUCTOR =================

    let conductorIdToDelete = null;


    function confirmDelete(id, nombre) {

        conductorIdToDelete = id;

        document.getElementById('deleteConductorNombre').textContent = nombre;

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

        conductorIdToDelete = null;
    }


    function deleteConductor() {

        if (!conductorIdToDelete) return;

        // Redirigir a Django para eliminar el conductor

        window.location.href =
            '/EliminarConductor/' + conductorIdToDelete + '/';

        closeDeleteModal();
    }


    // ================= GUARDAR CONDUCTOR =================

    function saveConductor() {

        const form = document.getElementById('createForm');

        if (form) {

            const nombre = document.getElementById('nombre').value.trim();
            const cedula = document.getElementById('cedula').value.trim();
            const telefono = document.getElementById('telefono').value.trim();
            const email = document.getElementById('email').value.trim();
            const contrasena = document.getElementById('contrasena').value.trim();
            const ruta = document.getElementById('id_ruta').value;

            if (!nombre || !cedula || !telefono || !email || !contrasena || !ruta) {

                alert('⚠️ Por favor complete todos los campos obligatorios');

                return;
            }

            form.submit();
        }
    }


    // ================= ACTUALIZAR CONDUCTOR =================

    function updateConductor() {

        const form = document.getElementById('editForm');

        if (form) {

            const nombre = document.getElementById('edit_nombre').value.trim();
            const cedula = document.getElementById('edit_cedula').value.trim();
            const telefono = document.getElementById('edit_telefono').value.trim();
            const email = document.getElementById('edit_email').value.trim();
            const ruta = document.getElementById('edit_id_ruta').value;

            if (!nombre || !cedula || !telefono || !email || !ruta) {

                alert('⚠️ Por favor complete todos los campos obligatorios');

                return;
            }

            form.submit();
        }
    }


    // ================= CERRAR MODALES CON ESC =================

    document.addEventListener('keydown', function(e) {

        if (e.key === 'Escape') {

            closeDeleteModal();
            closeCreateModal();
            closeEditModal();

        }
    });


    // ================= CERRAR MODALES CLICKEANDO FUERA =================

    document.querySelectorAll('.conductores-modal').forEach(modal => {

        modal.addEventListener('click', function(e) {

            if (e.target === this) {

                this.classList.remove('active');
                document.body.style.overflow = '';

            }

        });

    });


    // ================= EXPORTAR FUNCIONES GLOBALES =================

    window.openCreateModal = openCreateModal;
    window.closeCreateModal = closeCreateModal;

    window.editConductor = editConductor;
    window.closeEditModal = closeEditModal;

    window.confirmDelete = confirmDelete;
    window.closeDeleteModal = closeDeleteModal;
    window.deleteConductor = deleteConductor;

    window.saveConductor = saveConductor;
    window.updateConductor = updateConductor;

});
