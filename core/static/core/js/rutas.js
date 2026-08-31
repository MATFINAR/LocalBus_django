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

        const row = document.querySelector(`tr[data-id="${id}"]`);

        if (!row) return;

        const nombre = row.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
        const origen = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
        const destino = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '';
        const distancia_km = row.querySelector('td:nth-child(5)')?.textContent
            ?.replace('km', '')
            ?.trim() || '';
        const duracionTexto = row.querySelector('td:nth-child(6)')?.textContent?.trim() || '';
        const frecuenciaTexto = row.querySelector('td:nth-child(7)')?.textContent?.trim() || '';
        const paradas = row.querySelector('td:nth-child(8)')?.textContent?.trim() || '';
        const estado = row.querySelector('td:nth-child(9)')?.textContent?.trim() || '';

        let duracion_horas = 0;
        let duracion_minutos = 0;

        const horasDuracion = duracionTexto.match(/(\d+)\s*h/);
        const minutosDuracion = duracionTexto.match(/(\d+)\s*m/);

        if (horasDuracion) {
            duracion_horas = parseInt(horasDuracion[1]);
        }

        if (minutosDuracion) {
            duracion_minutos = parseInt(minutosDuracion[1]);
        }

        let frecuencia = 0;

        const horasFrecuencia = frecuenciaTexto.match(/(\d+)\s*h/);
        const minutosFrecuencia = frecuenciaTexto.match(/(\d+)\s*m/);

        if (horasFrecuencia) {
            frecuencia += parseInt(horasFrecuencia[1]) * 60;
        }

        if (minutosFrecuencia) {
            frecuencia += parseInt(minutosFrecuencia[1]);
        }


        document.getElementById('edit_id').value = id;
        document.getElementById('edit_nombre').value = nombre;
        document.getElementById('edit_origen').value = origen;
        document.getElementById('edit_destino').value = destino;
        document.getElementById('edit_distancia_km').value = distancia_km;
        document.getElementById('edit_duracion_horas').value = duracion_horas;
        document.getElementById('edit_duracion_minutos').value = duracion_minutos;
        document.getElementById('edit_estado').value = estado;
        document.getElementById('edit_frecuencia').value = frecuencia;
        document.getElementById('edit_paradas').value = paradas;

        document.getElementById('editForm').action =
            '/editarRuta/' + id + '/';

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

        const form = document.getElementById('editForm');

        if (form) {

            const nombre = document.getElementById('edit_nombre').value.trim();
            const origen = document.getElementById('edit_origen').value.trim();
            const destino = document.getElementById('edit_destino').value.trim();
            const distancia_km = document.getElementById('edit_distancia_km').value.trim();
            const duracion_horas = document.getElementById('edit_duracion_horas').value.trim();
            const duracion_minutos = document.getElementById('edit_duracion_minutos').value.trim();
            const estado = document.getElementById('edit_estado').value.trim();
            const frecuencia = document.getElementById('edit_frecuencia').value.trim();
            const paradas = document.getElementById('edit_paradas').value.trim();

            if (!nombre || !origen || !destino || !distancia_km || !duracion_horas || !duracion_minutos || !duracion_horas
                || !estado || !frecuencia || !paradas) {

                alert('⚠️ Por favor complete todos los campos obligatorios');

                return;
            }

            form.submit();
        }
    }


    // Cerrar modales con ESC
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
            closeCreateModal();
            closeEditModal();
        }
    });

    // Cerrar modales clickeando fuera
    document.querySelectorAll('.rutas-modal').forEach(modal => {
        modal.addEventListener('click', function (e) {
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
