// ============================================================
// CONDUCTORES_LISTA.JS - Lista de conductores de la empresa (filtros y búsqueda) y sus ventanas:
// crear, editar (con confirmación de cambios), inhabilitar y habilitar.
// Diseño según docs/GUIA_DE_DISENO.md: sin alert() ni emojis; los errores se muestran en la ventana.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ---------- Filtros y búsqueda ----------
    const filas = Array.from(document.querySelectorAll('.co-fila'));
    const pestanas = Array.from(document.querySelectorAll('.co-pestana'));
    const buscador = document.getElementById('coBuscar');
    const filtroRuta = document.getElementById('coRuta');
    const mensajeFiltro = document.getElementById('coFiltroMensaje');
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
            const porRuta = !filtros.ruta || fila.dataset.ruta === filtros.ruta;
            fila.hidden = !(porEstado && porTexto && porRuta);
            if (!fila.hidden) visibles++;
        });
        if (!mensajeFiltro) return;
        if (filas.length && visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ningún conductor coincide con «' + buscador.value.trim() + '». Revisa cómo lo escribiste o busca por la cédula.'
                : 'No hay conductores con esos filtros.';
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
    const condModal = document.getElementById('condModal');
    const cambiosModal = document.getElementById('cambiosModal');
    const habModal = document.getElementById('habModal');
    const modales = [condModal, cambiosModal, habModal];
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
        if (!document.querySelector('.co-modal.abierto')) document.body.style.overflow = '';
        const previo = focoPrevio.get(modal);
        if (previo && document.contains(previo)) previo.focus();
        if (modal === condModal) Object.keys(campos).forEach(function (k) { campos[k].cancelar(); });
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
        document.querySelectorAll('.co-boton.cargando').forEach(botonListo);
    });

    // ---------- Datos de los conductores (para editar) ----------
    let conductores = [];
    try {
        conductores = JSON.parse(document.getElementById('conductoresJson').textContent);
    } catch (e) {
        conductores = [];
    }

    // ---------- Formulario ----------
    const form = document.getElementById('condForm');
    const titulo = document.getElementById('condModalTitulo');
    const errorCaja = document.getElementById('condError');
    const btnGuardar = document.getElementById('condGuardar');
    const campoId = document.getElementById('condId');
    const ayudaContrasena = document.getElementById('condContrasenaAyuda');
    const token = form.querySelector('input[name="csrfmiddlewaretoken"]').value;
    const modo = { editar: false, conductor: null, original: null };

    const FORMATO = {
        cedula: /^\d{6,15}$/,
        telefono: /^\d{7,15}$/,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    };

    // Un campo: su caja, su mensaje y, si corresponde, la comprobación en el servidor mientras se escribe.
    // estado: '' | 'comprobando' | 'libre' | 'usado' | 'invalido'
    function crearCampo(nombre, opciones) {
        const input = document.getElementById(opciones.id);
        const caja = input.closest('.co-campo');
        const mensaje = caja.querySelector('.co-campo-mensaje');
        let temporizador = null;
        let peticion = 0;

        function poner(estado, texto) {
            input.dataset.estado = estado;
            caja.classList.toggle('con-error', estado === 'usado' || estado === 'invalido');
            mensaje.classList.toggle('correcto', estado === 'libre');
            mensaje.classList.toggle('cargando', estado === 'comprobando');
            mensaje.textContent = texto || '';
            mensaje.hidden = !texto;
        }

        function comprobar(valor) {
            const esta = ++peticion;
            const datos = new FormData();
            datos.append(opciones.parametro, valor);
            if (modo.editar && modo.conductor) datos.append('conductor_id', modo.conductor.id);
            datos.append('csrfmiddlewaretoken', token);
            fetch(opciones.url, { method: 'POST', body: datos, headers: { 'X-CSRFToken': token } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (esta !== peticion) return;
                    if (d.existe) poner('usado', opciones.mensajeUsado);
                    else poner('libre', opciones.mensajeLibre);
                })
                .catch(function () {
                    // Sin conexión no se bloquea: el servidor vuelve a comprobarlo al guardar
                    if (esta === peticion) poner('', '');
                });
        }

        function alEscribir() {
            clearTimeout(temporizador);
            peticion++;
            const valor = input.value.trim();
            if (!valor) { poner('', ''); return; }
            if (opciones.formato && !opciones.formato.test(valor)) {
                poner('invalido', opciones.mensajeFormato);
                return;
            }
            if (!opciones.url) { poner('', ''); return; }
            // En edición, dejar el dato como estaba no necesita comprobarse
            if (modo.editar && modo.conductor && valor.toLowerCase() === String(modo.conductor[nombre]).toLowerCase()) { poner('', ''); return; }
            poner('comprobando', 'Comprobando…');
            temporizador = setTimeout(function () { comprobar(valor); }, 450);
        }

        if (opciones.soloNumeros) {
            input.addEventListener('input', function () {
                input.value = input.value.replace(/\D/g, '').slice(0, 15);
            });
        }
        input.addEventListener('input', alEscribir);

        return {
            input: input,
            caja: caja,
            mensajeFormato: opciones.mensajeFormato,
            valor: function () { return input.value.trim(); },
            estado: function () { return input.dataset.estado || ''; },
            error: function (texto) { poner('invalido', texto); },
            limpiar: function () { clearTimeout(temporizador); peticion++; poner('', ''); },
            cancelar: function () { clearTimeout(temporizador); peticion++; },
        };
    }

    const campos = {
        nombre: crearCampo('nombre', { id: 'condNombre' }),
        cedula: crearCampo('cedula', {
            id: 'condCedula', soloNumeros: true, formato: FORMATO.cedula, url: '/verificar_cedula_conductor/',
            parametro: 'cedula', mensajeFormato: 'La cédula lleva solo números, de 6 a 15 dígitos.',
            mensajeUsado: 'Ya hay un conductor con esa cédula. Revisa el número o busca a ese conductor en la lista (si está inhabilitado, vuelve a habilitarlo).',
            mensajeLibre: 'Cédula disponible.',
        }),
        telefono: crearCampo('telefono', {
            id: 'condTelefono', soloNumeros: true, formato: FORMATO.telefono, url: '/verificar_telefono_conductor/',
            parametro: 'telefono', mensajeFormato: 'El teléfono lleva solo números, de 7 a 15 dígitos.',
            mensajeUsado: 'Ese teléfono ya está registrado en otro conductor. Revisa el número.',
            mensajeLibre: 'Teléfono disponible.',
        }),
        email: crearCampo('email', {
            id: 'condEmail', formato: FORMATO.email, url: '/verificar_email_conductor/', parametro: 'email',
            mensajeFormato: 'Escribe un correo válido, por ejemplo juan@correo.com.',
            mensajeUsado: 'Ya hay un conductor con ese correo. Revisa el correo o busca a ese conductor en la lista (si está inhabilitado, vuelve a habilitarlo).',
            mensajeLibre: 'Correo disponible.',
        }),
        contrasena: crearCampo('contrasena', { id: 'condContrasena' }),
    };

    function mostrarError(texto) {
        errorCaja.textContent = texto;
        errorCaja.hidden = false;
        errorCaja.focus();
    }

    function limpiarErrores() {
        errorCaja.hidden = true;
        errorCaja.textContent = '';
        Object.keys(campos).forEach(function (k) { campos[k].limpiar(); });
    }

    function prepararFormulario() {
        form.reset();
        limpiarErrores();
        botonListo(btnGuardar);
    }

    function abrirCrear() {
        prepararFormulario();
        modo.editar = false;
        modo.conductor = null;
        modo.original = null;
        titulo.textContent = 'Nuevo conductor';
        btnGuardar.textContent = 'Guardar conductor';
        form.action = '/CrearConductor/';
        campoId.value = '';
        ayudaContrasena.textContent = 'Mínimo 8 caracteres.';
        abrir(condModal, campos.nombre.input);
    }

    function abrirEditar(id) {
        const c = conductores.find(function (x) { return x.id === id; });
        if (!c) return;
        prepararFormulario();
        modo.editar = true;
        modo.conductor = c;
        titulo.textContent = 'Editar conductor';
        btnGuardar.textContent = 'Guardar cambios';
        form.action = '/EditarConductor/' + c.id + '/';
        campoId.value = c.id;
        campos.nombre.input.value = c.nombre;
        campos.cedula.input.value = c.cedula;
        campos.telefono.input.value = c.telefono;
        campos.email.input.value = c.email;
        ayudaContrasena.textContent = 'Déjala vacía para conservar la actual. Si la cambias, mínimo 8 caracteres.';
        modo.original = datosDelFormulario();
        abrir(condModal, campos.nombre.input);
    }

    // ---------- Guardar ----------
    function validar() {
        limpiarErroresDeCampos();
        const faltas = [];

        function falta(campo, texto) {
            campo.error(texto);
            faltas.push(campo);
        }

        if (!campos.nombre.valor()) falta(campos.nombre, 'Escribe el nombre completo del conductor.');

        ['cedula', 'telefono', 'email'].forEach(function (k) {
            const campo = campos[k];
            const nombreCampo = { cedula: 'la cédula', telefono: 'el teléfono', email: 'el correo' }[k];
            if (!campo.valor()) falta(campo, 'Escribe ' + nombreCampo + ' del conductor.');
            else if (!FORMATO[k].test(campo.valor())) falta(campo, campo.mensajeFormato);
        });

        const clave = campos.contrasena.input.value;
        if (!modo.editar && !clave) falta(campos.contrasena, 'Escribe una contraseña para la app, de 8 caracteres o más.');
        else if (clave && clave.length < 8) falta(campos.contrasena, 'La contraseña debe tener 8 caracteres o más.');

        // Lo que el servidor ya dijo que está repetido, o aún se está comprobando
        let mensaje = null;
        ['cedula', 'telefono', 'email'].forEach(function (k) {
            if (faltas.includes(campos[k])) return;
            if (campos[k].estado() === 'usado') {
                faltas.push(campos[k]);
                campos[k].caja.classList.add('con-error');
                mensaje = mensaje || 'Hay datos que ya están registrados en otro conductor. Corrígelos para poder guardar.';
            } else if (campos[k].estado() === 'comprobando') {
                faltas.push(campos[k]);
                mensaje = mensaje || 'Espera a que terminemos de comprobar los datos y vuelve a guardar.';
            }
        });

        if (faltas.length) {
            mostrarError(mensaje || 'Revisa los campos marcados en rojo.');
            faltas[0].input.focus();
            return false;
        }
        return true;
    }

    // Deja los mensajes de "disponible" como están, pero quita los errores de un intento anterior
    function limpiarErroresDeCampos() {
        errorCaja.hidden = true;
        errorCaja.textContent = '';
        Object.keys(campos).forEach(function (k) {
            const e = campos[k].estado();
            if (e === 'invalido') campos[k].limpiar();
            else campos[k].caja.classList.remove('con-error');
        });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (estaCargando(btnGuardar) || !validar()) return;
        campos.email.input.value = campos.email.valor().toLowerCase();
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
            nombre: campos.nombre.valor(),
            cedula: campos.cedula.valor(),
            telefono: campos.telefono.valor(),
            email: campos.email.valor().toLowerCase(),
            contrasena: campos.contrasena.input.value ? 'cambiar' : '',
        };
    }

    const ETIQUETAS = { nombre: 'Nombre', cedula: 'Cédula', telefono: 'Teléfono', email: 'Correo', contrasena: 'Contraseña' };
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
            fila.appendChild(dt);
            if (clave === 'contrasena') {
                const dd = document.createElement('dd');
                dd.textContent = 'Se guardará una contraseña nueva para la app.';
                fila.appendChild(dd);
            } else {
                const ddAntes = document.createElement('dd');
                ddAntes.className = 'co-cambio-antes';
                ddAntes.textContent = antes[clave] || 'Sin dato';
                const ddAhora = document.createElement('dd');
                ddAhora.className = 'co-cambio-ahora';
                ddAhora.textContent = ahora[clave] || 'Sin dato';
                fila.append(ddAntes, ddAhora);
            }
            lista.appendChild(fila);
        });

        const hayCambios = lista.children.length > 0;
        const texto = document.getElementById('cambiosTexto');
        texto.textContent = '';
        if (hayCambios) {
            texto.append('Revisa los cambios del conductor ');
            const nombre = document.createElement('strong');
            nombre.textContent = antes.nombre;
            texto.append(nombre, ' antes de guardarlos.');
        } else {
            texto.textContent = 'No cambiaste ningún dato del conductor. Vuelve al formulario para editarlo o ciérralo.';
        }

        btnCambiosGuardar.hidden = !hayCambios;
        botonListo(btnCambiosGuardar);
        abrir(cambiosModal, hayCambios ? btnCambiosGuardar : cambiosModal.querySelector('[data-cerrar].co-boton'));
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
            habClaveCampo.querySelectorAll('.co-campo').forEach(function (c) { c.classList.remove('con-error'); });
        });
    });

    function abrirHabilitacion(boton) {
        const habilitado = boton.dataset.habilitado === '1';
        const accion = habilitado ? 'Inhabilitar' : 'Habilitar';
        const c = conductores.find(function (x) { return String(x.id) === String(boton.closest('tr').dataset.id); }) || {};
        const pendientes = habilitado ? (c.turnos_pendientes || 0) : 0;
        document.getElementById('habTitulo').textContent = accion + ' conductor';

        const texto = document.getElementById('habTexto');
        texto.textContent = '';
        const nombre = document.createElement('strong');
        nombre.textContent = boton.dataset.nombre;
        texto.append(habilitado ? '¿Inhabilitar al conductor ' : '¿Volver a habilitar al conductor ', nombre, '?');

        document.getElementById('habNota').textContent = habilitado
            ? 'No podrá entrar a la app del conductor ni recibir turnos. '
              + 'Su historial se conserva y puedes volver a habilitarlo cuando quieras.'
            : 'Volverá a poder entrar a la app y recibir turnos.';

        // Con turnos en curso o programados hay que finalizarlos, y eso pide la cuenta de la empresa
        habTurnos.hidden = pendientes === 0;
        habUsuario.value = '';
        habClave.value = '';
        habClaveMensaje.hidden = true;
        habClaveCampo.querySelectorAll('.co-campo').forEach(function (x) { x.classList.remove('con-error'); });
        if (pendientes > 0) {
            const enCurso = c.turnos_en_curso || 0;
            const programados = pendientes - enCurso;
            const partes = [];
            if (enCurso) partes.push(enCurso + ' en curso');
            if (programados) partes.push(programados + (programados === 1 ? ' programado' : ' programados'));
            document.getElementById('habTurnosResumen').textContent =
                'Este conductor tiene ' + pendientes + (pendientes === 1 ? ' turno' : ' turnos') + ' (' + partes.join(' y ')
                + '). Para inhabilitarlo hay que finalizarlos.';
            document.getElementById('habNota').textContent = 'Un conductor inhabilitado no puede tener turnos.';
        }

        habForm.action = boton.dataset.url;
        document.getElementById('habValor').value = habilitado ? '0' : '1';
        botonListo(habConfirmar);
        habConfirmar.textContent = pendientes > 0 ? 'Finalizar turnos e inhabilitar' : accion;
        habConfirmar.classList.toggle('co-boton--peligro', habilitado);
        abrir(habModal, habModal.querySelector('[data-cerrar].co-boton'));
    }

    habForm.addEventListener('submit', function (e) {
        if (estaCargando(habConfirmar)) { e.preventDefault(); return; }
        // Finalizar: hay que volver a escribir usuario y contraseña de la empresa
        if (!habTurnos.hidden && (!habUsuario.value.trim() || !habClave.value)) {
            e.preventDefault();
            habClaveMensaje.textContent = 'Escribe el usuario y la contraseña de la cuenta de la empresa para confirmar.';
            habClaveMensaje.hidden = false;
            habClaveCampo.querySelectorAll('.co-campo').forEach(function (x) { x.classList.add('con-error'); });
            (habUsuario.value.trim() ? habClave : habUsuario).focus();
            return;
        }
        botonCargando(habConfirmar, habConfirmar.textContent === 'Habilitar' ? 'Habilitando…' : 'Inhabilitando…');
    });

    // ---------- Botones de la lista ----------
    const btnNuevo = document.getElementById('btnNuevoConductor');
    if (btnNuevo) btnNuevo.addEventListener('click', abrirCrear);

    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        if (boton.dataset.accion === 'editar') abrirEditar(Number(boton.dataset.id));
        else if (boton.dataset.accion === 'habilitacion') abrirHabilitacion(boton);
    });
});
