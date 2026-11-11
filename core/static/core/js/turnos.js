// ============================================================
// TURNOS_LISTA.JS - Turnos del día (filtros y búsqueda) y sus ventanas: programar, editar (con alcance
// de días), finalizar y eliminar. El servidor decide qué se puede hacer; aquí solo se muestra y se envía.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni confirm() ni emojis; los errores salen en la ventana.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ---------- Día: la fecha se aplica al elegirla ----------
    const fechaDia = document.getElementById('tuFecha');
    if (fechaDia) {
        fechaDia.addEventListener('change', function () {
            if (fechaDia.value) fechaDia.form.submit();
        });
    }

    // ---------- Filtros y búsqueda ----------
    const filas = Array.from(document.querySelectorAll('.tu-fila'));
    const pestanas = Array.from(document.querySelectorAll('.tu-pestana'));
    const buscador = document.getElementById('tuBuscar');
    const mensajeFiltro = document.getElementById('tuFiltroMensaje');
    const filtros = { estado: 'todos', texto: '' };

    // Sin tildes ni mayúsculas: "ramirez" encuentra "Ramírez"
    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    filas.forEach(function (fila) { fila.dataset.buscar = normalizar(fila.dataset.buscar); });

    function filtrar() {
        let visibles = 0;
        filas.forEach(function (fila) {
            const porEstado = filtros.estado === 'todos' || fila.dataset.estado === filtros.estado;
            const porTexto = !filtros.texto || fila.dataset.buscar.includes(filtros.texto);
            fila.hidden = !(porEstado && porTexto);
            if (!fila.hidden) visibles++;
        });
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ningún turno coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por la placa.'
                : 'No hay turnos en ese estado este día.';
            mensajeFiltro.hidden = false;
        } else {
            mensajeFiltro.hidden = true;
        }
    }

    pestanas.forEach(function (p) {
        p.addEventListener('click', function () {
            pestanas.forEach(function (o) {
                o.classList.toggle('activa', o === p);
                o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
            });
            filtros.estado = p.dataset.filtro;
            filtrar();
        });
    });

    if (buscador) {
        buscador.addEventListener('input', function () {
            filtros.texto = normalizar(buscador.value.trim());
            filtrar();
        });
    }

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    const createModal = document.getElementById('createModal');
    const editModal = document.getElementById('editModal');
    const accionModal = document.getElementById('accionModal');
    const modales = [createModal, editModal, accionModal];
    const focoPrevio = new Map();

    function abrir(modal, foco) {
        focoPrevio.set(modal, document.activeElement);
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        if (foco) setTimeout(function () { foco.focus(); }, 30);
    }

    function cerrar(modal) {
        modal.classList.remove('abierto');
        modal.hidden = true;
        if (!document.querySelector('.tu-modal.abierto')) document.body.style.overflow = '';
        const previo = focoPrevio.get(modal);
        if (previo && document.contains(previo)) previo.focus();
    }

    modales.forEach(function (modal) {
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
        modal.querySelectorAll('[data-cerrar]').forEach(function (b) {
            b.addEventListener('click', function () { cerrar(modal); });
        });
    });

    document.addEventListener('keydown', function (e) {
        const abiertas = modales.filter(function (m) { return m.classList.contains('abierto'); });
        const arriba = abiertas[abiertas.length - 1];
        if (!arriba) return;
        if (e.key === 'Escape') {
            cerrar(arriba);
            return;
        }
        if (e.key !== 'Tab') return;
        // Mantiene el foco dentro de la ventana de arriba
        const enfocables = Array.from(arriba.querySelectorAll('button, select, input:not([type="hidden"]), a[href]'))
            .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!enfocables.length) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });

    function botonCargando(boton, texto) {
        boton.dataset.texto = boton.dataset.texto || boton.textContent;
        boton.classList.add('cargando');
        boton.textContent = texto;
        boton.setAttribute('aria-disabled', 'true');
    }

    function botonListo(boton) {
        if (!boton.dataset.texto) return;
        boton.classList.remove('cargando');
        boton.textContent = boton.dataset.texto;
        boton.removeAttribute('aria-disabled');
        delete boton.dataset.texto;
    }

    function estaCargando(boton) {
        return boton.getAttribute('aria-disabled') === 'true';
    }

    // Si se vuelve con el botón del navegador, nada debe quedar "guardando"
    window.addEventListener('pageshow', function () {
        document.querySelectorAll('.tu-boton.cargando').forEach(botonListo);
    });

    // ---------- Solo se muestran las rutas que el bus elegido puede cubrir ----------
    function prepararFiltroRutas(busSelect, rutaSelect) {
        function filtrarRutas() {
            const opcion = busSelect.options[busSelect.selectedIndex];
            const habilitadas = ((opcion && opcion.dataset.rutas) || '').split(',').filter(Boolean);

            Array.from(rutaSelect.options).forEach(function (option) {
                if (!option.value) {
                    option.textContent = busSelect.value ? 'Elige una ruta' : 'Primero elige un bus';
                    return;
                }
                if (option.dataset.temporal) return;  // opción del turno que se está editando
                option.hidden = !habilitadas.includes(option.value);
                option.disabled = option.hidden;
            });
            if (rutaSelect.selectedOptions[0] && rutaSelect.selectedOptions[0].hidden) rutaSelect.value = '';
            if (habilitadas.length === 1 && !rutaSelect.value) rutaSelect.value = habilitadas[0];
        }
        busSelect.addEventListener('change', filtrarRutas);
        filtrarRutas();
        return filtrarRutas;
    }

    // ---------- Envío sin cerrar la ventana ----------
    // Si el servidor rechaza el turno, la ventana sigue abierta con los datos, dice qué pasó y marca los campos
    // que hay que cambiar.
    function prepararEnvio(form, cajaError, botonGuardar, textoGuardando) {
        function grupoDeCampo(nombre) {
            const grupo = form.querySelector('[data-campo="' + nombre + '"]');
            if (grupo) return grupo;
            const el = form.elements[nombre];
            return el && el.closest ? el.closest('.tu-campo') : null;
        }

        function limpiarErrores() {
            cajaError.hidden = true;
            cajaError.textContent = '';
            form.querySelectorAll('.con-error').forEach(function (g) { g.classList.remove('con-error'); });
        }

        function mostrarError(mensaje, campos) {
            cajaError.textContent = mensaje;
            cajaError.hidden = false;

            let primero = null;
            (campos || []).forEach(function (nombre) {
                const grupo = grupoDeCampo(nombre);
                // Los campos ocultos (p. ej. "Hasta" con asignación fija) no se marcan
                if (!grupo || grupo.offsetParent === null) return;
                grupo.classList.add('con-error');
                primero = primero || grupo.querySelector('input, select') || grupo;
            });

            cajaError.scrollIntoView({ block: 'nearest' });
            if (primero && primero.focus) primero.focus({ preventScroll: true });
            else cajaError.focus();
        }

        // Al cambiar un campo marcado se quita su marca (el mensaje queda hasta volver a guardar)
        form.addEventListener('input', function (e) {
            const grupo = e.target.closest('.con-error');
            if (grupo) grupo.classList.remove('con-error');
        });
        form.addEventListener('change', function (e) {
            const grupo = e.target.closest('.con-error');
            if (grupo) grupo.classList.remove('con-error');
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (estaCargando(botonGuardar)) return;
            limpiarErrores();
            botonCargando(botonGuardar, textoGuardando);

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
                botonListo(botonGuardar);
                mostrarError(datos.error || 'No se pudo guardar el turno.', datos.campos);
            } catch (error) {
                botonListo(botonGuardar);
                mostrarError('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', []);
            }
        });

        return limpiarErrores;
    }

    // ---------- Programar turnos ----------
    const fijo = document.getElementById('fijo');

    // Con asignación fija no hay fecha final, pero sí hora de fin y días de la semana
    function alternarFijo() {
        createModal.querySelectorAll('.solo-rotacion').forEach(function (el) {
            el.style.display = fijo.checked ? 'none' : '';
        });
    }

    prepararFiltroRutas(document.getElementById('bus'), document.getElementById('ruta'));
    fijo.addEventListener('change', alternarFijo);
    alternarFijo();
    const limpiarErroresCrear = prepararEnvio(document.getElementById('createForm'),
        document.getElementById('createError'), document.getElementById('createSubmit'), 'Programando…');

    document.getElementById('btnProgramar').addEventListener('click', function () {
        limpiarErroresCrear();
        abrir(createModal, document.getElementById('conductor'));
    });

    // ---------- Editar un turno ----------
    const editForm = document.getElementById('editForm');
    const campo = function (id) { return document.getElementById(id); };
    const filtrarRutasEdicion = prepararFiltroRutas(campo('edit_bus'), campo('edit_ruta'));
    const limpiarErroresEdicion = prepararEnvio(editForm, campo('editError'), campo('editSubmit'), 'Guardando…');

    // Si el valor del turno ya no está en la lista (p. ej. conductor inhabilitado) se agrega
    // una opción temporal para que el formulario muestre el valor real
    function elegir(select, valor, texto) {
        select.querySelectorAll('option[data-temporal]').forEach(function (o) { o.remove(); });
        if (!Array.from(select.options).some(function (o) { return o.value === valor; })) {
            const opcion = new Option(texto, valor);
            opcion.dataset.temporal = '1';
            select.add(opcion);
        }
        select.value = valor;
    }

    const alcanceCaja = campo('editAlcance');
    const radios = Array.from(editForm.querySelectorAll('input[name="alcance"]'));
    const fijoCheck = campo('edit_fijo');
    let actual = null;  // datos del botón del turno que se está editando

    function nota(id, texto) { campo(id).textContent = texto; }

    // Rotación: "Todos los días" cambia solo los días que aún no empiezan; los ya trabajados quedan igual
    function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
    function textoTodos(d) {
        const faltan = Number(d.pendientesTodos) || 0;
        const pasaron = Number(d.serieEmpezados) || 0;
        let texto = 'Los ' + plural(faltan, 'día que aún no empieza', 'días que aún no empiezan') + ' de esta programación.';
        if (faltan === 1) texto = 'El día que aún no empieza de esta programación.';
        if (pasaron) {
            texto += ' ' + (pasaron === 1 ? 'El día que ya empezó no cambia: es historial.'
                : 'Los ' + pasaron + ' días que ya empezaron no cambian: son historial.');
        }
        return texto;
    }

    function opcion(valor, habilitada, motivo) {
        const radio = radios.find(function (r) { return r.value === valor; });
        radio.disabled = !habilitada;
        const etiqueta = radio.closest('label');
        etiqueta.classList.toggle('deshabilitado', !habilitada);
        if (!habilitada) etiqueta.querySelector('.tu-opcion-texto span').textContent = motivo;
    }

    function mostrar(id, visible) {
        const el = campo(id);
        const caja = el.closest('.tu-campo') || el;
        caja.style.display = visible ? '' : 'none';
    }

    function alcanceElegido() {
        if (actual.soloFin === '1') return 'fin';
        const marcado = radios.find(function (r) { return r.checked; });
        return (marcado && marcado.value) || (actual.variosDias === '1' ? null : 'todos');
    }

    // Mismos campos que "Programar"; según el alcance algunos se fijan u ocultan
    function aplicarAlcance() {
        const d = actual;
        const esFijo = d.fijo === '1';
        const alcance = alcanceElegido();
        editForm.classList.toggle('tu-esperando-alcance', !alcance);
        campo('editSubmit').disabled = !alcance;
        if (!alcance) return;

        const fecha = campo('edit_fecha');
        const unDia = alcance === 'dia' || alcance === 'fin';
        const fijoEmpezado = esFijo && d.turnoEmpezo === '1';
        fecha.disabled = alcance === 'fin' || alcance === 'siguientes' || (alcance === 'dia' && esFijo)
            || (alcance === 'todos' && fijoEmpezado);
        campo('edit_fecha_label').textContent = unDia ? 'Fecha' : 'Desde';
        if (alcance === 'siguientes' || (alcance === 'dia' && esFijo)) {
            fecha.value = d.dia;            // parte del día que se está viendo
        } else if (alcance === 'todos') {
            fecha.value = esFijo ? (fijoEmpezado ? d.proximo : d.fecha) : d.serieDesde;
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
            dia: esFijo ? 'Solo cambia el ' + d.diaTexto + '; el turno fijo sigue igual los demás días.'
                        : 'Solo cambia este día.',
            siguientes: 'Desde el ' + d.diaTexto + ' se reemplaza por lo que indiques aquí; los días anteriores quedan como estaban.',
            todos: d.variosDias === '1'
                ? (esFijo
                    ? (fijoEmpezado
                        ? 'Se cambian todos los días que aún no empiezan, desde el ' + d.proximoTexto + '. Los días ya trabajados no cambian: son historial.'
                        : 'Se cambia todo el turno fijo, desde que empieza.')
                    : 'Se cambian ' + textoTodos(d).charAt(0).toLowerCase() + textoTodos(d).slice(1))
                : 'Puedes cambiar todos los datos antes de que el turno empiece.',
        }[alcance];
    }
    radios.forEach(function (r) { r.addEventListener('change', aplicarAlcance); });
    fijoCheck.addEventListener('change', aplicarAlcance);

    function abrirEditar(boton) {
        const d = actual = boton.dataset;
        const soloFin = d.soloFin === '1';
        const esFijo = d.fijo === '1';

        limpiarErroresEdicion();
        botonListo(campo('editSubmit'));
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
        editForm.querySelectorAll('input[name="dias"]').forEach(function (c) { c.checked = dias.includes(c.value); });

        // Turno en curso: solo se cambia la hora de fin; lo demás ya es historial
        ['edit_conductor', 'edit_bus', 'edit_ruta', 'edit_hora_inicio'].forEach(function (id) {
            campo(id).disabled = soloFin;
        });

        // Turno de varios días: primero se pregunta a qué días aplicar el cambio
        alcanceCaja.hidden = d.variosDias !== '1';
        radios.forEach(function (r) {
            r.disabled = false;
            r.closest('label').classList.remove('deshabilitado');
        });
        if (d.variosDias === '1') {
            if (esFijo) {
                const yaEmpezo = 'La jornada de este día ya empezó. Usa «Todos los días» para cambiar los que aún no empiezan.';
                nota('alcanceDiaNota', 'Solo el ' + d.diaTexto + '; los demás días siguen igual.');
                nota('alcanceSiguientesNota', 'Desde el ' + d.diaTexto + '; los días anteriores quedan como estaban.');
                // Igual que una rotación: "Todos los días" cambia los que aún no empiezan
                nota('alcanceTodosNota', d.turnoEmpezo === '1'
                    ? 'Todos los días que aún no empiezan, desde el ' + d.proximoTexto + '. Los días ya trabajados no cambian: son historial.'
                    : 'Todo el turno fijo, desde que empieza.');
                opcion('dia', d.jornadaEmpezo !== '1', yaEmpezo);
                opcion('siguientes', d.jornadaEmpezo !== '1', yaEmpezo);
                opcion('todos', d.turnoEmpezo !== '1' || !!d.proximo, 'No le quedan días por delante para cambiar.');
            } else {
                nota('alcanceDiaNota', 'Solo el turno del ' + d.diaTexto + '.');
                nota('alcanceSiguientesNota', plural(Number(d.pendientesSiguientes) || 0, 'día', 'días') + ', desde el ' + d.diaTexto + '.');
                nota('alcanceTodosNota', textoTodos(d));
            }
        }

        aplicarAlcance();
        abrir(editModal, d.variosDias === '1' ? radios.find(function (r) { return !r.disabled; }) : campo('edit_conductor').disabled ? campo('edit_hora_fin') : campo('edit_conductor'));
    }

    // ---------- Finalizar o eliminar un turno ----------
    const accionForm = document.getElementById('accionForm');
    const accionConfirmar = document.getElementById('accionConfirmar');

    function abrirAccion(boton) {
        const finalizar = boton.dataset.accion === 'finalizar';
        const fijo = boton.dataset.fijo === '1';
        document.getElementById('accionTitulo').textContent = finalizar
            ? (fijo ? 'Finalizar asignación fija' : 'Finalizar turno') : 'Eliminar turno';

        const texto = document.getElementById('accionTexto');
        texto.textContent = '';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre;
        texto.append(finalizar ? (fijo ? '¿Finalizar la asignación fija de ' : '¿Finalizar ahora el turno de ')
            : '¿Eliminar el turno programado de ', nombre,
            ' en el bus ' + boton.dataset.bus + '?');

        document.getElementById('accionNota').textContent = finalizar
            ? (fijo
                ? 'La asignación termina ahora: no tendrá más jornadas, ni hoy ni los días siguientes. Las jornadas ya trabajadas quedan en el historial.'
                : 'El turno termina ahora y queda en el historial. El conductor deja de poder usar la app con este turno.')
            : 'Aún no ha empezado, así que se borra. Esto no se puede deshacer.';

        accionForm.action = boton.dataset.url;
        botonListo(accionConfirmar);
        accionConfirmar.textContent = finalizar ? (fijo ? 'Finalizar asignación' : 'Finalizar ahora') : 'Eliminar turno';
        abrir(accionModal, accionModal.querySelector('[data-cerrar].tu-boton'));
    }

    accionForm.addEventListener('submit', function (e) {
        if (estaCargando(accionConfirmar)) { e.preventDefault(); return; }
        botonCargando(accionConfirmar, accionConfirmar.textContent === 'Eliminar turno' ? 'Eliminando…' : 'Finalizando…');
    });

    // ---------- Botones de la lista ----------
    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        if (boton.dataset.accion === 'editar') abrirEditar(boton);
        else abrirAccion(boton);
    });
});
