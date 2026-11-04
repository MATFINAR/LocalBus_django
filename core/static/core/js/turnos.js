// ================= MODALES DE TURNOS =================

function abrirModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function cerrarModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function openCreateModal() { abrirModal('createModal'); }
function closeCreateModal() { cerrarModal('createModal'); }
function closeEditModal() { cerrarModal('editModal'); }


// Solo se muestran las rutas habilitadas para el bus elegido
function prepararFiltroRutas(busSelect, rutaSelect) {
    function filtrar() {
        const opcion = busSelect.options[busSelect.selectedIndex];
        const habilitadas = (opcion?.dataset.rutas || '').split(',').filter(Boolean);

        for (const option of rutaSelect.options) {
            if (!option.value) {
                option.textContent = busSelect.value ? 'Seleccione una ruta' : 'Primero elija un bus';
                continue;
            }
            if (option.dataset.temporal) continue;  // opción del turno que se está editando
            option.hidden = !habilitadas.includes(option.value);
        }
        if (rutaSelect.selectedOptions[0]?.hidden) {
            rutaSelect.value = '';
        }
        if (habilitadas.length === 1 && !rutaSelect.value) {
            rutaSelect.value = habilitadas[0];
        }
    }
    busSelect.addEventListener('change', filtrar);
    filtrar();
    return filtrar;
}


// ===== ENVÍO SIN CERRAR EL MODAL =====
// Si el servidor rechaza el turno, el modal sigue abierto con los datos, muestra el error
// y marca los campos que hay que cambiar.
function prepararEnvio(form, cajaError, botonGuardar, textoGuardando) {
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
        botonGuardar.textContent = textoGuardando;

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
            mostrarError(datos.error || 'No se pudo guardar el turno.', datos.campos);
        } catch (error) {
            mostrarError('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', []);
        } finally {
            botonGuardar.disabled = false;
            botonGuardar.textContent = textoBoton;
        }
    });

    return limpiarErrores;
}


document.addEventListener('DOMContentLoaded', () => {
    // ================= PROGRAMAR TURNOS =================
    const fijo = document.getElementById('fijo');

    // Con asignación fija no hay fecha final, pero sí hora de fin y días de la semana
    function alternarFijo() {
        document.querySelectorAll('#createModal .solo-rotacion').forEach(el => {
            el.style.display = fijo.checked ? 'none' : '';
        });
    }

    prepararFiltroRutas(document.getElementById('bus'), document.getElementById('ruta'));
    fijo.addEventListener('change', alternarFijo);
    alternarFijo();
    prepararEnvio(document.getElementById('createForm'), document.getElementById('createError'),
                  document.getElementById('createSubmit'), '⏳ Programando...');

    // ================= EDITAR UN TURNO =================
    const editForm = document.getElementById('editForm');
    if (editForm) {
        const campo = id => document.getElementById(id);
        const filtrarRutasEdicion = prepararFiltroRutas(campo('edit_bus'), campo('edit_ruta'));
        const limpiarErroresEdicion = prepararEnvio(editForm, campo('editError'), campo('editSubmit'), '⏳ Guardando...');

        // Si el valor del turno ya no está en la lista (p. ej. conductor inhabilitado) se agrega
        // una opción temporal para que el formulario muestre el valor real
        function elegir(select, valor, texto) {
            select.querySelectorAll('option[data-temporal]').forEach(o => o.remove());
            if (![...select.options].some(o => o.value === valor)) {
                const opcion = new Option(texto, valor);
                opcion.dataset.temporal = '1';
                select.add(opcion);
            }
            select.value = valor;
        }

        const alcanceCaja = campo('editAlcance');
        const radios = [...editForm.querySelectorAll('input[name="alcance"]')];
        const fijoCheck = campo('edit_fijo');
        let actual = null;  // datos del botón del turno que se está editando

        function nota(id, texto) { campo(id).textContent = texto; }

        function opcion(valor, habilitada, motivo) {
            const radio = radios.find(r => r.value === valor);
            radio.disabled = !habilitada;
            radio.closest('label').classList.toggle('deshabilitado', !habilitada);
            if (!habilitada) radio.closest('label').querySelector('small').textContent = motivo;
        }

        function mostrar(grupo, visible) {
            const el = typeof grupo === 'string' ? campo(grupo).closest('.buses-form-group') : grupo;
            el.style.display = visible ? '' : 'none';
        }

        function alcanceElegido() {
            if (actual.soloFin === '1') return 'fin';
            return radios.find(r => r.checked)?.value || (actual.variosDias === '1' ? null : 'todos');
        }

        // Mismos campos que "Programar"; según el alcance algunos se fijan u ocultan
        function aplicarAlcance() {
            const d = actual;
            const esFijo = d.fijo === '1';
            const alcance = alcanceElegido();
            editForm.classList.toggle('turnos-esperando-alcance', !alcance);
            campo('editSubmit').disabled = !alcance;
            if (!alcance) return;

            const fecha = campo('edit_fecha');
            const unDia = alcance === 'dia' || alcance === 'fin';
            fecha.disabled = alcance === 'fin' || alcance === 'siguientes' || (alcance === 'dia' && esFijo);
            campo('edit_fecha_label').textContent = unDia ? 'Fecha' : 'Desde';
            if (alcance === 'siguientes' || (alcance === 'dia' && esFijo)) {
                fecha.value = d.dia;            // parte del día que se está viendo
            } else if (alcance === 'todos') {
                fecha.value = esFijo ? d.fecha : d.serieDesde;
            } else {
                fecha.value = d.fecha;
            }

            // Un solo día no puede ser fijo, ni tener rango ni días de la semana
            mostrar('edit_fijo_grupo', !unDia);
            mostrar('edit_dias_grupo', !unDia);
            mostrar('edit_hasta', !unDia && !fijoCheck.checked);

            const aviso = campo('editAviso');
            aviso.hidden = false;
            aviso.textContent = {
                fin: 'El turno está en curso: solo puedes cambiar la hora de fin (alargarlo o acortarlo).',
                dia: esFijo ? `Solo cambia el ${d.diaTexto}; el turno fijo sigue igual los demás días.`
                            : 'Solo cambia este día.',
                siguientes: `Desde el ${d.diaTexto} se reemplaza por lo que indiques aquí; los días anteriores quedan como estaban.`,
                todos: d.variosDias === '1'
                    ? 'Se reemplaza todo lo que aún no ha empezado por lo que indiques aquí; lo que ya empezó no cambia.'
                    : 'Puedes cambiar todos los datos antes de que el turno empiece.',
            }[alcance];
        }
        radios.forEach(r => r.addEventListener('change', aplicarAlcance));
        fijoCheck.addEventListener('change', aplicarAlcance);

        document.addEventListener('click', e => {
            const boton = e.target.closest('.turnos-editar');
            if (!boton) return;
            const d = actual = boton.dataset;
            const soloFin = d.soloFin === '1';
            const esFijo = d.fijo === '1';

            limpiarErroresEdicion();
            editForm.reset();
            editForm.action = d.url;
            campo('edit_dia').value = d.dia;

            elegir(campo('edit_conductor'), d.conductor, d.conductorNombre);
            elegir(campo('edit_bus'), d.bus, d.busPlaca);
            filtrarRutasEdicion();
            elegir(campo('edit_ruta'), d.ruta, d.rutaNombre);
            campo('edit_hora_inicio').value = d.horaInicio;
            campo('edit_hora_fin').value = d.horaFin;
            fijoCheck.checked = esFijo;
            campo('edit_hasta').value = esFijo ? '' : (d.serieHasta || d.fecha);
            const dias = (d.serieDias || '').split(',').filter(Boolean);
            editForm.querySelectorAll('input[name="dias"]').forEach(c => { c.checked = dias.includes(c.value); });

            // Turno en curso: solo se cambia la hora de fin; lo demás ya es historial
            ['edit_conductor', 'edit_bus', 'edit_ruta', 'edit_hora_inicio'].forEach(id => {
                campo(id).disabled = soloFin;
            });

            // Turno de varios días: primero se pregunta a qué días aplicar el cambio
            alcanceCaja.hidden = d.variosDias !== '1';
            radios.forEach(r => { r.disabled = false; r.closest('label').classList.remove('deshabilitado'); });
            if (d.variosDias === '1') {
                if (esFijo) {
                    nota('alcanceDiaNota', `Solo el ${d.diaTexto}; los demás días siguen igual.`);
                    nota('alcanceSiguientesNota', `Desde el ${d.diaTexto}; los días anteriores quedan como estaban.`);
                    nota('alcanceTodosNota', 'Todo el turno fijo, desde que empieza.');
                    opcion('dia', d.jornadaEmpezo !== '1', 'La jornada de este día ya empezó: ábrelo en un día posterior.');
                    opcion('siguientes', d.jornadaEmpezo !== '1', 'La jornada de este día ya empezó: ábrelo en un día posterior.');
                    opcion('todos', d.turnoEmpezo !== '1', 'Ya empezó: los días trabajados no se cambian.');
                } else {
                    nota('alcanceDiaNota', `Solo el turno del ${d.diaTexto}.`);
                    nota('alcanceSiguientesNota', `${d.pendientesSiguientes} turno(s), desde el ${d.diaTexto}.`);
                    nota('alcanceTodosNota', `${d.pendientesTodos} turno(s) de esta programación que aún no empiezan.`);
                }
            }

            aplicarAlcance();
            abrirModal('editModal');
        });
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeCreateModal();
            closeEditModal();
        }
    });
});
