// ============================================================
// BUSES_LISTA.JS - Lista de buses de la empresa (filtros y búsqueda) y sus ventanas:
// crear, editar (con confirmación de cambios), inhabilitar y habilitar.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni emojis; los errores se muestran en la ventana.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ---------- Filtros y búsqueda ----------
    const filas = Array.from(document.querySelectorAll('.bu-fila'));
    const pestanas = Array.from(document.querySelectorAll('.bu-pestana'));
    const buscador = document.getElementById('buBuscar');
    const filtroRuta = document.getElementById('buRuta');
    const mensajeFiltro = document.getElementById('buFiltroMensaje');
    const filtros = { estado: 'todos', texto: '', ruta: '' };

    // Sin tildes ni mayúsculas: "perez" encuentra "Pérez"
    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    filas.forEach(function (fila) { fila.dataset.buscar = normalizar(fila.dataset.buscar); });

    function filtrar() {
        let visibles = 0;
        filas.forEach(function (fila) {
            const porEstado = filtros.estado === 'todos' || fila.dataset.estado === filtros.estado;
            const porTexto = !filtros.texto || fila.dataset.buscar.includes(filtros.texto);
            const porRuta = !filtros.ruta || fila.dataset.rutas.split(',').includes(filtros.ruta);
            fila.hidden = !(porEstado && porTexto && porRuta);
            if (!fila.hidden) visibles++;
        });
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ningún bus coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por la placa.'
                : 'No hay buses con esos filtros.';
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
    if (filtroRuta) {
        filtroRuta.addEventListener('change', function () {
            filtros.ruta = filtroRuta.value;
            filtrar();
        });
    }

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    const busModal = document.getElementById('busModal');
    const cambiosModal = document.getElementById('cambiosModal');
    const habModal = document.getElementById('habModal');
    const modales = [busModal, cambiosModal, habModal];
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
        if (!document.querySelector('.bu-modal.abierto')) document.body.style.overflow = '';
        const previo = focoPrevio.get(modal);
        if (previo && document.contains(previo)) previo.focus();
        if (modal === busModal) comprobacion.cancelar();
    }

    // La ventana de encima es la última abierta (la de cambios va sobre la del editor)
    function ventanaDeArriba() {
        const abiertas = modales.filter(function (m) { return m.classList.contains('abierto'); });
        return abiertas.includes(cambiosModal) ? cambiosModal : abiertas[abiertas.length - 1];
    }

    modales.forEach(function (modal) {
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
        modal.querySelectorAll('[data-cerrar]').forEach(function (b) {
            b.addEventListener('click', function () { cerrar(modal); });
        });
    });

    document.addEventListener('keydown', function (e) {
        const arriba = ventanaDeArriba();
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
        document.querySelectorAll('.bu-boton.cargando').forEach(botonListo);
    });

    // ---------- Datos de los buses (para editar) ----------
    let buses = [];
    try {
        buses = JSON.parse(document.getElementById('busesJson').textContent);
    } catch (e) {
        buses = [];
    }

    // ---------- Formulario del bus ----------
    const form = document.getElementById('busForm');
    const titulo = document.getElementById('busModalTitulo');
    const errorCaja = document.getElementById('busError');
    const btnGuardar = document.getElementById('busGuardar');
    const campoId = document.getElementById('busId');
    const campoPlaca = document.getElementById('busPlaca');
    const cajaPlaca = document.getElementById('busPlacaCampo');
    const mensajePlaca = document.getElementById('busPlacaMensaje');
    const cajaRutas = document.getElementById('busRutasCampo');
    const mensajeRutas = document.getElementById('busRutasMensaje');
    const checks = Array.from(form.querySelectorAll('input[name="rutas"]'));
    const FORMATO_PLACA = /^[A-Z0-9-]{4,20}$/;
    const modo = { editar: false, bus: null, original: null };

    function mostrarError(texto) {
        errorCaja.textContent = texto;
        errorCaja.hidden = false;
        errorCaja.focus();
    }

    function limpiarErrores() {
        errorCaja.hidden = true;
        errorCaja.textContent = '';
        cajaPlaca.classList.remove('con-error');
        cajaRutas.classList.remove('con-error');
        mensajeRutas.hidden = true;
    }

    // ---------- Placa: formato y disponibilidad mientras se escribe ----------
    // estado: '' | 'comprobando' | 'libre' | 'usada' | 'invalida'
    const comprobacion = (function () {
        let temporizador = null;
        let peticion = 0;
        const token = form.querySelector('input[name="csrfmiddlewaretoken"]').value;

        function poner(estado, texto) {
            campoPlaca.dataset.estado = estado;
            cajaPlaca.classList.toggle('con-error', estado === 'usada' || estado === 'invalida');
            mensajePlaca.classList.toggle('correcto', estado === 'libre');
            mensajePlaca.classList.toggle('cargando', estado === 'comprobando');
            mensajePlaca.textContent = texto || '';
            mensajePlaca.hidden = !texto;
        }

        function revisar(placa) {
            const esta = ++peticion;
            poner('comprobando', 'Comprobando la placa…');
            const datos = new FormData();
            datos.append('placa', placa);
            if (modo.editar && modo.bus) datos.append('bus_id', modo.bus.id);
            datos.append('csrfmiddlewaretoken', token);
            fetch('/verificar_placa_bus/', { method: 'POST', body: datos, headers: { 'X-CSRFToken': token } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (esta !== peticion) return;
                    if (d.existe) poner('usada', 'Ya hay un bus con la placa ' + placa + '. Revisa la placa o busca ese bus en la lista (si está inhabilitado, vuelve a habilitarlo).');
                    else poner('libre', 'Placa disponible.');
                })
                .catch(function () {
                    // Sin conexión no se bloquea: el servidor vuelve a comprobarla al guardar
                    if (esta === peticion) poner('', '');
                });
        }

        function alEscribir() {
            clearTimeout(temporizador);
            peticion++;
            const placa = campoPlaca.value.trim().toUpperCase();
            if (!placa) { poner('', ''); return; }
            if (!FORMATO_PLACA.test(placa)) {
                poner('invalida', 'La placa lleva solo letras, números y guiones, de 4 a 20 caracteres.');
                return;
            }
            // En edición, dejar la placa como estaba no necesita comprobarse
            if (modo.editar && modo.bus && placa === modo.bus.placa) { poner('', ''); return; }
            poner('comprobando', 'Comprobando la placa…');
            temporizador = setTimeout(function () { revisar(placa); }, 450);
        }

        campoPlaca.addEventListener('input', function () {
            // La placa siempre en mayúsculas
            const pos = campoPlaca.selectionStart;
            campoPlaca.value = campoPlaca.value.toUpperCase();
            campoPlaca.setSelectionRange(pos, pos);
            alEscribir();
        });

        return {
            cancelar: function () { clearTimeout(temporizador); peticion++; },
            reiniciar: function () { clearTimeout(temporizador); peticion++; poner('', ''); },
        };
    })();

    checks.forEach(function (c) {
        c.addEventListener('change', function () {
            cajaRutas.classList.remove('con-error');
            mensajeRutas.hidden = true;
        });
    });

    function rutasMarcadas() {
        return checks.filter(function (c) { return c.checked; });
    }

    function textoRuta(check) {
        const etiqueta = check.closest('label');
        return etiqueta.querySelector('.bu-opcion-ruta-codigo').textContent.trim() + ' · '
            + etiqueta.querySelector('.bu-opcion-ruta-nombre').textContent.trim();
    }

    function prepararFormulario() {
        limpiarErrores();
        comprobacion.reiniciar();
        botonListo(btnGuardar);
        form.reset();
    }

    function abrirCrear() {
        prepararFormulario();
        modo.editar = false;
        modo.bus = null;
        modo.original = null;
        titulo.textContent = 'Nuevo bus';
        btnGuardar.textContent = 'Guardar bus';
        form.action = '/CrearBus/';
        campoId.value = '';
        abrir(busModal, campoPlaca);
    }

    function abrirEditar(id) {
        const bus = buses.find(function (b) { return b.id === id; });
        if (!bus) return;
        prepararFormulario();
        modo.editar = true;
        modo.bus = bus;
        titulo.textContent = 'Editar bus ' + bus.placa;
        btnGuardar.textContent = 'Guardar cambios';
        form.action = '/EditarBus/';
        campoId.value = bus.id;
        campoPlaca.value = bus.placa;
        checks.forEach(function (c) { c.checked = bus.rutas.includes(Number(c.value)); });
        modo.original = datosDelFormulario();
        abrir(busModal, campoPlaca);
    }

    // ---------- Guardar ----------
    function validar() {
        limpiarErrores();
        const placa = campoPlaca.value.trim().toUpperCase();
        const estado = campoPlaca.dataset.estado;
        let primero = null;
        let mensaje = null;

        if (!placa) {
            cajaPlaca.classList.add('con-error');
            mensajePlaca.textContent = 'Escribe la placa del bus, por ejemplo ABC123.';
            mensajePlaca.hidden = false;
            primero = campoPlaca;
        } else if (!FORMATO_PLACA.test(placa)) {
            cajaPlaca.classList.add('con-error');
            mensajePlaca.textContent = 'La placa lleva solo letras, números y guiones, de 4 a 20 caracteres.';
            mensajePlaca.hidden = false;
            primero = campoPlaca;
        } else if (estado === 'usada') {
            primero = campoPlaca;
            mensaje = 'La placa ' + placa + ' ya está registrada. Cámbiala para poder guardar.';
        } else if (estado === 'comprobando') {
            primero = campoPlaca;
            mensaje = 'Espera a que terminemos de comprobar la placa y vuelve a guardar.';
        }

        if (!rutasMarcadas().length) {
            cajaRutas.classList.add('con-error');
            mensajeRutas.textContent = checks.length
                ? 'Elige al menos una ruta que pueda cubrir el bus.'
                : 'Primero crea una ruta en la sección Rutas: un bus necesita al menos una.';
            mensajeRutas.hidden = false;
            if (!primero) primero = checks[0] || null;
        }

        if (primero) {
            if (mensaje) mostrarError(mensaje);
            else if (errorCaja.hidden) mostrarError('Revisa los campos marcados en rojo.');
            primero.focus();
            return false;
        }
        return true;
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (estaCargando(btnGuardar) || !validar()) return;
        campoPlaca.value = campoPlaca.value.trim().toUpperCase();
        if (modo.editar) {
            mostrarCambios();
            return;
        }
        botonCargando(btnGuardar, 'Guardando…');
        form.submit();
    });

    // ---------- Confirmar los cambios de una edición ----------
    function datosDelFormulario() {
        return {
            placa: campoPlaca.value.trim().toUpperCase(),
            rutas: rutasMarcadas().map(textoRuta).join(', '),
        };
    }

    const ETIQUETAS = { placa: 'Placa', rutas: 'Rutas que puede cubrir' };
    const btnCambiosGuardar = document.getElementById('cambiosGuardar');

    function mostrarCambios() {
        const ahora = datosDelFormulario();
        const antes = modo.original || {};
        const lista = document.getElementById('cambiosLista');
        lista.textContent = '';

        Object.keys(ETIQUETAS).forEach(function (clave) {
            if ((antes[clave] || '') === (ahora[clave] || '')) return;
            const fila = document.createElement('div');
            const dt = document.createElement('dt');
            dt.textContent = ETIQUETAS[clave];
            const ddAntes = document.createElement('dd');
            ddAntes.className = 'bu-cambio-antes';
            ddAntes.textContent = antes[clave] || 'Sin dato';
            const ddAhora = document.createElement('dd');
            ddAhora.className = 'bu-cambio-ahora';
            ddAhora.textContent = ahora[clave] || 'Sin dato';
            fila.append(dt, ddAntes, ddAhora);
            lista.appendChild(fila);
        });

        const hayCambios = lista.children.length > 0;
        const texto = document.getElementById('cambiosTexto');
        texto.textContent = '';
        if (hayCambios) {
            texto.append('Revisa los cambios del bus ');
            const nombre = document.createElement('strong');
            nombre.textContent = antes.placa;
            texto.append(nombre, ' antes de guardarlos.');
        } else {
            texto.textContent = 'No cambiaste ningún dato del bus. Vuelve al formulario para editarlo o ciérralo.';
        }

        btnCambiosGuardar.hidden = !hayCambios;
        botonListo(btnCambiosGuardar);
        abrir(cambiosModal, hayCambios ? btnCambiosGuardar : cambiosModal.querySelector('[data-cerrar].bu-boton'));
    }

    btnCambiosGuardar.addEventListener('click', function () {
        if (estaCargando(btnCambiosGuardar)) return;
        botonCargando(btnCambiosGuardar, 'Guardando…');
        form.submit();
    });

    // ---------- Inhabilitar / habilitar ----------
    const habForm = document.getElementById('habForm');
    const habConfirmar = document.getElementById('habConfirmar');
    const habTurnos = document.getElementById('habTurnos');
    const habUsuario = document.getElementById('habUsuario');
    const habClave = document.getElementById('habClave');
    const habClaveCampo = document.getElementById('habClaveCampo');
    const habClaveMensaje = document.getElementById('habClaveMensaje');

    [habUsuario, habClave].forEach(function (campoClave) {
        campoClave.addEventListener('input', function () {
            habClaveMensaje.hidden = true;
            habClaveCampo.querySelectorAll('.bu-campo').forEach(function (c) { c.classList.remove('con-error'); });
        });
    });

    function abrirHabilitacion(boton) {
        const habilitado = boton.dataset.habilitado === '1';
        const accion = habilitado ? 'Inhabilitar' : 'Habilitar';
        const bus = buses.find(function (b) { return String(b.id) === String(boton.closest('tr').dataset.id); }) || {};
        const pendientes = habilitado ? (bus.turnos_pendientes || 0) : 0;
        document.getElementById('habTitulo').textContent = accion + ' bus';

        const texto = document.getElementById('habTexto');
        texto.textContent = '';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre;
        texto.append(habilitado ? '¿Inhabilitar el bus ' : '¿Volver a habilitar el bus ', nombre, '?');

        document.getElementById('habNota').textContent = habilitado
            ? 'No recibirá turnos y no aparecerá en el mapa. '
              + 'Su historial se conserva y puedes volver a habilitarlo cuando quieras.'
            : 'Volverá a estar disponible para asignarle turnos.';

        // Con turnos en curso o programados hay que finalizarlos, y eso pide la cuenta de la empresa
        habTurnos.hidden = pendientes === 0;
        habUsuario.value = '';
        habClave.value = '';
        habClaveMensaje.hidden = true;
        habClaveCampo.querySelectorAll('.bu-campo').forEach(function (c) { c.classList.remove('con-error'); });
        if (pendientes > 0) {
            const enCurso = bus.turnos_en_curso || 0;
            const programados = pendientes - enCurso;
            const partes = [];
            if (enCurso) partes.push(enCurso + ' en curso');
            if (programados) partes.push(programados + (programados === 1 ? ' programado' : ' programados'));
            document.getElementById('habTurnosResumen').textContent =
                'Este bus tiene ' + pendientes + (pendientes === 1 ? ' turno' : ' turnos') + ' (' + partes.join(' y ')
                + '). Para inhabilitarlo hay que finalizarlos.';
            document.getElementById('habNota').textContent = 'Un bus inhabilitado no puede tener turnos.';
        }

        habForm.action = boton.dataset.url;
        document.getElementById('habValor').value = habilitado ? '0' : '1';
        botonListo(habConfirmar);
        habConfirmar.textContent = pendientes > 0 ? 'Finalizar turnos e inhabilitar' : accion;
        habConfirmar.classList.toggle('bu-boton--peligro', habilitado);
        abrir(habModal, habModal.querySelector('[data-cerrar].bu-boton'));
    }

    habForm.addEventListener('submit', function (e) {
        if (estaCargando(habConfirmar)) { e.preventDefault(); return; }
        // Finalizar: hay que volver a escribir usuario y contraseña de la empresa
        if (!habTurnos.hidden && (!habUsuario.value.trim() || !habClave.value)) {
            e.preventDefault();
            habClaveMensaje.textContent = 'Escribe el usuario y la contraseña de la cuenta de la empresa para confirmar.';
            habClaveMensaje.hidden = false;
            habClaveCampo.querySelectorAll('.bu-campo').forEach(function (c) { c.classList.add('con-error'); });
            (habUsuario.value.trim() ? habClave : habUsuario).focus();
            return;
        }
        botonCargando(habConfirmar, habConfirmar.textContent === 'Habilitar' ? 'Habilitando…' : 'Inhabilitando…');
    });

    // ---------- Botones de la lista ----------
    const btnNuevo = document.getElementById('btnNuevoBus');
    if (btnNuevo) btnNuevo.addEventListener('click', abrirCrear);

    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        if (boton.dataset.accion === 'editar') abrirEditar(Number(boton.dataset.id));
        else if (boton.dataset.accion === 'habilitacion') abrirHabilitacion(boton);
    });
});
