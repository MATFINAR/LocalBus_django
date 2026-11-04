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

    // Con asignación fija no hay fecha final, pero sí hora de fin y días de la semana
    function alternarFijo() {
        document.querySelectorAll('.solo-rotacion').forEach(el => {
            el.style.display = fijo.checked ? 'none' : '';
        });
    }

    busSelect.addEventListener('change', filtrarRutas);
    fijo.addEventListener('change', alternarFijo);
    filtrarRutas();
    alternarFijo();

    // ===== ENVÍO SIN CERRAR EL MODAL =====
    // Si el servidor rechaza el turno, el modal sigue abierto con los datos, muestra el error
    // y marca los campos que hay que cambiar.
    const form = document.getElementById('createForm');
    const cajaError = document.getElementById('createError');
    const botonGuardar = document.getElementById('createSubmit');

    function grupoDeCampo(campo) {
        const grupo = form.querySelector(`[data-campo="${campo}"]`);
        if (grupo) return grupo;
        return form.elements[campo]?.closest?.('.buses-form-group') || null;
    }

    function limpiarErrores() {
        cajaError.hidden = true;
        cajaError.textContent = '';
        form.querySelectorAll('.turnos-campo-error').forEach(g => g.classList.remove('turnos-campo-error'));
        form.querySelectorAll('.buses-form-input-error').forEach(i => i.classList.remove('buses-form-input-error'));
    }

    function mostrarError(mensaje, campos) {
        cajaError.textContent = mensaje;
        cajaError.hidden = false;

        let primero = null;
        (campos || []).forEach(campo => {
            const grupo = grupoDeCampo(campo);
            // Los campos ocultos (p. ej. "Hasta" con asignación fija) no se marcan
            if (!grupo || grupo.offsetParent === null) return;
            grupo.classList.add('turnos-campo-error');
            const input = grupo.querySelector('.buses-form-input');
            if (input) input.classList.add('buses-form-input-error');
            primero = primero || input || grupo;
        });

        cajaError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (primero && primero.focus) primero.focus({ preventScroll: true });
    }

    // Al cambiar un campo marcado se quita su marca (el mensaje queda hasta volver a guardar)
    form.addEventListener('input', e => {
        const grupo = e.target.closest('.turnos-campo-error');
        if (grupo) {
            grupo.classList.remove('turnos-campo-error');
            grupo.querySelectorAll('.buses-form-input-error').forEach(i => i.classList.remove('buses-form-input-error'));
        }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        limpiarErrores();
        botonGuardar.disabled = true;
        const textoBoton = botonGuardar.textContent;
        botonGuardar.textContent = '⏳ Programando...';

        try {
            const respuesta = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const tipo = respuesta.headers.get('content-type') || '';
            if (!tipo.includes('application/json')) {
                // Sesión vencida u otra página (p. ej. el login): se navega a ella
                window.location.href = respuesta.url;
                return;
            }
            const datos = await respuesta.json();
            if (respuesta.ok && datos.redirect) {
                window.location.href = datos.redirect;
                return;
            }
            mostrarError(datos.error || 'No se pudo programar el turno.', datos.campos);
        } catch (error) {
            mostrarError('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', []);
        } finally {
            botonGuardar.disabled = false;
            botonGuardar.textContent = textoBoton;
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeCreateModal();
    });
});
