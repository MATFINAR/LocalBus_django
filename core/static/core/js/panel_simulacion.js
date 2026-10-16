// ==================== TOGGLE SIMULACIÓN ====================
function toggleSimulacion(busId) {
    fetch(`/api/toggle-simulacion/${busId}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        }
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'ok') {
            const switch_el = document.getElementById(`switch-${busId}`);
            const card = document.getElementById(`card-${busId}`);
            const badge = document.getElementById(`badge-${busId}`);
            
            if (data.simulando) {
                switch_el.classList.add('active');
                card.classList.remove('detenido');
                card.classList.add('simulando');
                badge.textContent = 'ACTIVO';
                mostrarToast(`▶️ ${data.placa} iniciado`, 'success');
            } else {
                switch_el.classList.remove('active');
                card.classList.remove('simulando');
                card.classList.add('detenido');
                badge.textContent = 'DETENIDO';
                mostrarToast(`⏸️ ${data.placa} detenido`, 'info');
            }
            
            actualizarEstadisticas();
        }
    })
    .catch(e => mostrarToast('❌ Error al cambiar estado', 'error'));
}

// ==================== CAMBIAR VELOCIDAD ====================
let timeoutVelocidad = {};

function cambiarVelocidad(busId, valor) {
    // Actualizar UI inmediatamente
    document.getElementById(`vel-${busId}`).innerHTML = `${valor}<span> km/h</span>`;
    
    // Debounce: enviar al servidor 300ms después del último cambio
    clearTimeout(timeoutVelocidad[busId]);
    timeoutVelocidad[busId] = setTimeout(() => {
        fetch(`/api/cambiar-velocidad/${busId}/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ velocidad: parseFloat(valor) })
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === 'ok') {
                mostrarToast(`⚡ Velocidad: ${data.velocidad} km/h`, 'success');
            }
        })
        .catch(e => mostrarToast('❌ Error al cambiar velocidad', 'error'));
    }, 300);
}

// ==================== TOGGLE TODOS ====================
function toggleTodos(simulando) {
    fetch('/api/toggle-todos/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        },
        body: JSON.stringify({ simulando: simulando })
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'ok') {
            mostrarToast(
                simulando ? '▶️ Todos los buses iniciados' : '⏸️ Todos los buses detenidos',
                simulando ? 'success' : 'info'
            );
            setTimeout(() => location.reload(), 800);
        }
    });
}

// ==================== RESETEAR BUS ====================
function resetearBus(busId) {
    if (!confirm('¿Reiniciar la posición de este bus al inicio de la ruta?')) return;
    
    fetch(`/api/resetear-bus/${busId}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        }
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'ok') {
            document.getElementById(`pos-${busId}`).textContent = '0';
            document.getElementById(`dist-${busId}`).textContent = '0 m';
            mostrarToast('🔄 Bus reiniciado', 'success');
        }
    });
}

// ==================== ACTUALIZAR ESTADÍSTICAS ====================
function actualizarEstadisticas() {
    fetch('/api/estado-simulacion/')
        .then(r => r.json())
        .then(data => {
            const simulando = data.configuraciones.filter(c => c.simulando).length;
            const total = data.configuraciones.length;
            
            document.getElementById('statSimulando').textContent = simulando;
            document.getElementById('statDetenidos').textContent = total - simulando;
        });
}

// ==================== UTILIDADES ====================
function getCSRFToken() {
    const cookie = document.cookie.split('; ').find(row => row.startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : '';
}

function mostrarToast(mensaje, tipo = 'success') {
    const toast = document.createElement('div');
    toast.className = `sim-toast ${tipo}`;
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// ==================== AUTO-REFRESH ====================
setInterval(actualizarEstadisticas, 10000);