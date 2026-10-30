// ================= MODAL PROGRAMAR TURNOS =================

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

document.addEventListener('DOMContentLoaded', () => {
    const busSelect = document.getElementById('bus');
    const rutaSelect = document.getElementById('ruta');
    const fijo = document.getElementById('fijo');
    const horaFin = document.getElementById('hora_fin');

    // Solo se muestran las rutas habilitadas para el bus elegido
    function filtrarRutas() {
        const opcion = busSelect.options[busSelect.selectedIndex];
        const habilitadas = (opcion?.dataset.rutas || '').split(',').filter(Boolean);

        for (const option of rutaSelect.options) {
            if (!option.value) {
                option.textContent = busSelect.value ? 'Seleccione una ruta' : 'Primero elija un bus';
                continue;
            }
            option.hidden = !habilitadas.includes(option.value);
        }
        if (rutaSelect.selectedOptions[0]?.hidden) {
            rutaSelect.value = '';
        }
        if (habilitadas.length === 1) {
            rutaSelect.value = habilitadas[0];
        }
    }

    // Con asignación fija no hay fecha final, hora de fin ni días de la semana
    function alternarFijo() {
        document.querySelectorAll('.solo-rotacion').forEach(el => {
            el.style.display = fijo.checked ? 'none' : '';
        });
        horaFin.required = !fijo.checked;
    }

    busSelect.addEventListener('change', filtrarRutas);
    fijo.addEventListener('change', alternarFijo);
    filtrarRutas();
    alternarFijo();

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeCreateModal();
    });
});
