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

    // ================= LIMPIAR ALERTAS =================
    document.getElementById('clearAlertsBtn')?.addEventListener('click', function() {
        if (confirm('¿Eliminar todas las alertas del historial?')) {
            const grid = document.getElementById('alertsGrid');
            const cards = grid.querySelectorAll('.alert-card');
            cards.forEach(card => card.remove());
            
            const noResults = grid.querySelector('.no-results');
            if (noResults) noResults.remove();
            
            grid.innerHTML = `
                <div class="no-alerts">
                    <div class="no-alerts-icon">◆</div>
                    <h3>No hay alertas registradas</h3>
                    <p>Las alertas del sistema aparecerán aquí</p>
                </div>
            `;
            
            document.getElementById('totalAlertsCount').textContent = '0';
            document.getElementById('delayCount').textContent = '0';
            document.getElementById('arrivingCount').textContent = '0';
            document.getElementById('warningCount').textContent = '0';
        }
    });

    // ================= SIMULAR ALERTA =================
    document.getElementById('simulateAlertBtn')?.addEventListener('click', function() {
        const tipos = ['delay', 'bus-arriving', 'warning', 'info'];
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];
        
        const datos = {
            delay: {
                badge: 'Demora',
                title: 'Retraso en Autopista Sur',
                description: 'Vehículo varado en el sector de Industriales. Buses con retraso de 8 minutos.',
                route: 'Metroplús Línea 1',
                location: 'Autopista Sur → Industriales'
            },
            'bus-arriving': {
                badge: 'Próximo',
                title: 'Aproximación a Estación Bello',
                description: 'Unidad con destino Niquía a 500 metros. Llegada en 2 minutos.',
                route: 'Ruta 301',
                location: 'Estación Bello'
            },
            warning: {
                badge: 'Advertencia',
                title: 'Manifestación en La Alpujarra',
                description: 'Movilización ciudadana en el centro administrativo. Desvíos en rutas alimentadoras.',
                route: 'Rutas 301, 302, 310',
                location: 'La Alpujarra → Medellín'
            },
            info: {
                badge: 'Información',
                title: 'Nueva frecuencia en Ruta 315',
                description: 'La ruta Envigado - Sabaneta ahora pasa cada 12 minutos en horas pico.',
                route: 'Ruta 315',
                location: 'Envigado → Sabaneta'
            }
        };
        
        const data = datos[tipo];
        
        const grid = document.getElementById('alertsGrid');
        const noAlerts = grid.querySelector('.no-alerts');
        if (noAlerts) noAlerts.remove();
        
        const alertaHTML = `
            <div class="alert-card ${tipo}" data-id="${Date.now()}">
                <div class="alert-indicator"></div>
                <div class="alert-body">
                    <div class="alert-header">
                        <span class="alert-badge">${data.badge}</span>
                        <span class="alert-time">Hace unos segundos</span>
                    </div>
                    <div class="alert-title">${data.title}</div>
                    <div class="alert-description">${data.description}</div>
                    <div class="alert-footer">
                        <span class="alert-route">${data.route}</span>
                        <span class="alert-location">${data.location}</span>
                    </div>
                </div>
            </div>
        `;
        
        grid.insertAdjacentHTML('afterbegin', alertaHTML);
        
        // Actualizar contadores
        const total = document.querySelectorAll('.alert-card').length;
        document.getElementById('totalAlertsCount').textContent = total;
        
        // Mostrar notificación
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            background: var(--blue); color: white;
            padding: 12px 24px; border-radius: 8px;
            font-weight: 500; font-size: 0.9rem;
            box-shadow: var(--shadow-lg);
            z-index: 1000;
            animation: fadeInUp 0.3s ease-out;
        `;
        toast.textContent = 'Nueva alerta: ' + data.title;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s ease';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    });
});