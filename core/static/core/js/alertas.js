document.addEventListener('DOMContentLoaded', function() {
    // ================= FILTROS =================
    const filterBtns = document.querySelectorAll('.filter-btn');
    const alertsGrid = document.getElementById('alertsGrid');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const filter = this.getAttribute('data-filter');
            const cards = alertsGrid.querySelectorAll('.alert-card');
            let visible = 0;

            cards.forEach(card => {
                if (filter === 'all') {
                    card.style.display = '';
                    visible++;
                } else {
                    const tipo = card.className.match(/alert-card\s+(\w+)/);
                    if (tipo && tipo[1] === filter) {
                        card.style.display = '';
                        visible++;
                    } else {
                        card.style.display = 'none';
                    }
                }
            });

            let noResults = alertsGrid.querySelector('.no-results');
            if (visible === 0 && cards.length > 0) {
                if (!noResults) {
                    noResults = document.createElement('div');
                    noResults.className = 'no-results';
                    noResults.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
                    noResults.innerHTML = '<p>No hay alertas en esta categoría</p>';
                    alertsGrid.appendChild(noResults);
                }
            } else {
                if (noResults) noResults.remove();
            }
        });
    });

    // ================= MODAL DE CREACIÓN =================
    const modalOverlay = document.getElementById('alertModal');
    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');
    const btnCreate = document.getElementById('btnCreateAlert');
    const modalTitle = document.getElementById('modalTitle');
    const modalSubmit = document.getElementById('modalSubmit');
    const alertForm = document.getElementById('alertForm');
    const alertId = document.getElementById('alertId');
    const modalAction = document.getElementById('modalAction');

    // Abrir modal de creación
    btnCreate.addEventListener('click', function() {
        modalTitle.textContent = 'Crear Nueva Alerta';
        modalSubmit.textContent = 'Crear Alerta';
        modalAction.value = 'create';
        alertId.value = '';
        alertForm.reset();
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    // Cerrar modal
    function closeModal() {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });

    // ================= MODAL DE DETALLE =================
    const detailModal = document.getElementById('detailModal');
    const detailClose = document.getElementById('detailClose');
    const detailEdit = document.getElementById('detailEdit');
    const detailDelete = document.getElementById('detailDelete');
    let currentAlertId = null;

    // Abrir detalle al hacer clic en una tarjeta
    document.querySelectorAll('.alert-card').forEach(card => {
        card.addEventListener('click', function(e) {
            // Evitar que el clic en el botón de crear dispare esto
            if (e.target.closest('.btn-create')) return;
            
            const alertId = this.dataset.id;
            const rutaId = this.dataset.rutaId;
            const tipo = this.querySelector('.alert-type-label')?.textContent.trim() || 'N/A';
            const descripcion = this.querySelector('.alert-description')?.textContent.trim() || 'Sin descripción';
            const rutaNombre = this.querySelector('.alert-title')?.textContent.trim() || 'Sin ruta';
            const ubicacion = this.querySelector('.alert-location')?.textContent.trim() || '';
            const tiempo = this.querySelector('.alert-time')?.textContent.trim() || '';

            // Llenar el modal de detalle
            document.getElementById('detailRuta').textContent = rutaNombre + (ubicacion ? ` (${ubicacion})` : '');
            document.getElementById('detailTipo').textContent = tipo;
            document.getElementById('detailDescripcion').textContent = descripcion;
            document.getElementById('detailEstado').textContent = 'Activa';
            document.getElementById('detailFecha').textContent = tiempo;

            currentAlertId = alertId;

            // Guardar datos en el botón de editar para poder cargarlos después
            detailEdit.dataset.alertId = alertId;
            detailEdit.dataset.rutaId = rutaId;
            detailEdit.dataset.descripcion = descripcion;
            detailEdit.dataset.tipo = tipo;

            // Mostrar modal
            detailModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });

    // Cerrar modal de detalle
    function closeDetailModal() {
        detailModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    detailClose.addEventListener('click', closeDetailModal);
    detailModal.addEventListener('click', function(e) {
        if (e.target === this) closeDetailModal();
    });

    // ================= EDITAR DESDE DETALLE =================
    detailEdit.addEventListener('click', function() {
        const alertId = this.dataset.alertId;
        const rutaId = this.dataset.rutaId;
        const descripcion = this.dataset.descripcion;
        const tipo = this.dataset.tipo;

        // Cerrar modal de detalle
        closeDetailModal();

        // Abrir modal de creación en modo edición
        setTimeout(() => {
            modalTitle.textContent = 'Editar Alerta';
            modalSubmit.textContent = 'Actualizar Alerta';
            modalAction.value = 'edit';
            alertId.value = alertId;
            document.getElementById('alertRuta').value = rutaId;
            document.getElementById('alertDescripcion').value = descripcion;
            
            // Mapear el tipo
            const tipoMap = {
                'DEMORA': 'delay',
                'PRÓXIMO': 'bus-arriving',
                'ADVERTENCIA': 'warning',
                'INFORMACIÓN': 'info'
            };
            document.getElementById('alertTipo').value = tipoMap[tipo] || 'info';

            modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }, 300);
    });

    // ================= ELIMINAR DESDE DETALLE =================
    detailDelete.addEventListener('click', function() {
        if (!currentAlertId) return;
        
        if (confirm('¿Estás seguro de que deseas eliminar esta alerta?')) {
            // Enviar solicitud de eliminación
            fetch(`/eliminar_alerta/${currentAlertId}/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value || '',
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Remover la tarjeta del DOM
                    const card = document.querySelector(`.alert-card[data-id="${currentAlertId}"]`);
                    if (card) card.remove();
                    
                    // Actualizar contadores
                    updateCounters();
                    
                    // Mostrar mensaje vacío si no hay alertas
                    const cards = document.querySelectorAll('.alert-card');
                    if (cards.length === 0) {
                        alertsGrid.innerHTML = `
                            <div class="no-alerts">
                                <div class="no-alerts-icon">◆</div>
                                <h3>No hay alertas registradas</h3>
                                <p>Las alertas del sistema aparecerán aquí</p>
                            </div>
                        `;
                    }
                    
                    closeDetailModal();
                    showNotification('Alerta eliminada correctamente', 'success');
                } else {
                    showNotification('Error al eliminar la alerta', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showNotification('Error al eliminar la alerta', 'error');
            });
        }
    });

    // ================= ENVÍO DEL FORMULARIO =================
    alertForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const formData = new FormData(this);
        const action = formData.get('action');

        let url = action === 'create' ? '/crear_alerta/' : '/editar_alerta/';
        
        // Convertir FormData a objeto JSON
        const data = {};
        formData.forEach((value, key) => {
            data[key] = value;
        });

        fetch(url, {
            method: 'POST',
            headers: {
                'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value || '',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                closeModal();
                showNotification(
                    action === 'create' ? 'Alerta creada correctamente' : 'Alerta actualizada correctamente',
                    'success'
                );
                // Recargar la página para ver los cambios
                setTimeout(() => window.location.reload(), 1000);
            } else {
                showNotification(data.error || 'Error al guardar la alerta', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification('Error al guardar la alerta', 'error');
        });
    });

    // ================= ACTUALIZAR CONTADORES =================
    function updateCounters() {
        const cards = document.querySelectorAll('.alert-card');
        const total = cards.length;
        document.getElementById('totalAlertsCount').textContent = total;

        let delay = 0, arriving = 0, warning = 0;
        cards.forEach(card => {
            if (card.classList.contains('delay')) delay++;
            else if (card.classList.contains('bus-arriving')) arriving++;
            else if (card.classList.contains('warning')) warning++;
        });
        document.getElementById('delayCount').textContent = delay;
        document.getElementById('arrivingCount').textContent = arriving;
        document.getElementById('warningCount').textContent = warning;
    }

    // ================= NOTIFICACIONES =================
    function showNotification(message, type = 'info') {
        const toast = document.createElement('div');
        const colors = {
            success: '#2E7D32',
            error: '#E63946',
            info: '#1D3557'
        };
        
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 500;
            font-size: 0.9rem;
            box-shadow: var(--shadow-lg);
            z-index: 10000;
            animation: fadeInUp 0.3s ease-out;
            max-width: 400px;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s ease';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    // Inicializar contadores
    updateCounters();
});