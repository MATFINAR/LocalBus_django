// ============================================================
// ALERTAS.JS - Centro de alertas: filtros, detalle, crear, editar e inhabilitar
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

    // Mismos colores de placa que en el mapa (la ruta usa id % 7)
    const PALETA_RUTAS = ['#087F8C', '#6B3FA0', '#B85C00', '#A82A7B', '#5C6B1E', '#7A4A2B', '#3F5B7A'];
    const TIPOS = {
        'delay': { texto: 'Demora', color: '#D4121A', tinta: '#FEFEFE' },
        'warning': { texto: 'Advertencia', color: '#F7C600', tinta: '#080707' },
        'info': { texto: 'Información', color: '#014CAB', tinta: '#FEFEFE' }
    };
    const ESTADOS = { 'En_proceso': 'En proceso' };

    const grilla = document.getElementById('alertsGrid');
    const tarjetas = Array.from(document.querySelectorAll('.al-tarjeta'));

    // ---------- Placas de color y escalonado de entrada ----------
    document.querySelectorAll('.al-placa').forEach(function (placa) {
        placa.style.background = PALETA_RUTAS[Number(placa.dataset.rutaId) % PALETA_RUTAS.length];
    });
    tarjetas.forEach(function (t, i) {
        t.style.animationDelay = Math.min(i, 11) * 50 + 'ms';
    });

    // ---------- Hora relativa ("hace 5 min") ----------
    function tiempoRelativo(fecha) {
        const seg = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000));
        if (seg < 60) return 'hace unos segundos';
        const min = Math.floor(seg / 60);
        if (min < 60) return 'hace ' + min + ' min';
        const h = Math.floor(min / 60);
        if (h < 24) return 'hace ' + h + ' h';
        const d = Math.floor(h / 24);
        if (d < 30) return 'hace ' + d + (d === 1 ? ' día' : ' días');
        return null;
    }
    function actualizarHoras() {
        document.querySelectorAll('.al-hora').forEach(function (el) {
            const fecha = new Date(el.getAttribute('datetime'));
            if (isNaN(fecha)) return;
            const texto = tiempoRelativo(fecha);
            if (texto) {
                if (!el.title) el.title = el.textContent;
                el.textContent = texto;
            }
        });
    }
    actualizarHoras();
    setInterval(actualizarHoras, 60000);

    // ---------- Filtros ----------
    const pestanas = Array.from(document.querySelectorAll('.al-pestana'));
    const mensaje = document.getElementById('alFiltroMensaje');

    // Filtro activo de cada grupo (tipo y, para la empresa, estado)
    const filtros = { tipo: 'all', estado: 'all' };

    function filtrar() {
        let visibles = 0;
        tarjetas.forEach(function (t) {
            const ver = (filtros.tipo === 'all' || t.dataset.tipo === filtros.tipo)
                && (filtros.estado === 'all' || t.dataset.estado === filtros.estado);
            t.hidden = !ver;
            if (ver) visibles++;
        });
        if (!mensaje) return;
        if (tarjetas.length && visibles === 0) {
            mensaje.textContent = 'No hay alertas con estos filtros por ahora. Prueba con otros.';
            mensaje.hidden = false;
        } else {
            mensaje.hidden = true;
        }
    }

    pestanas.forEach(function (p) {
        const grupo = p.dataset.estado !== undefined ? 'estado' : 'tipo';
        p.addEventListener('click', function () {
            p.parentElement.querySelectorAll('.al-pestana').forEach(function (o) {
                o.classList.toggle('activa', o === p);
                o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
            });
            filtros[grupo] = grupo === 'estado' ? p.dataset.estado : p.dataset.filter;
            filtrar();
        });
    });

    // ---------- Ventanas: abrir, cerrar, foco y Escape ----------
    let ultimoFoco = null;

    function abrir(modal, foco) {
        ultimoFoco = document.activeElement;
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        if (foco) setTimeout(function () { foco.focus(); }, 30);
    }

    function cerrar(modal) {
        modal.classList.remove('abierto');
        modal.hidden = true;
        if (!document.querySelector('.al-modal.abierto')) document.body.style.overflow = '';
        if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
    }

    const alertModal = document.getElementById('alertModal');
    const detailModal = document.getElementById('detailModal');

    const reportModal = document.getElementById('reportModal');

    [alertModal, detailModal, reportModal].filter(Boolean).forEach(function (modal) {
        // Clic fuera de la caja cierra
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrar(modal); });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const abierto = document.querySelector('.al-modal.abierto');
        if (abierto) cerrar(abierto);
    });

    // Mantiene el foco dentro de la ventana abierta
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        const abierto = document.querySelector('.al-modal.abierto');
        if (!abierto) return;
        const foco = Array.from(abierto.querySelectorAll('button, select, textarea, input:not([type="hidden"]), a[href]'))
            .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!foco.length) return;
        const primero = foco[0];
        const ultimo = foco[foco.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });

    // ---------- Formulario de crear / editar ----------
    const form = document.getElementById('alertForm');
    const campoId = document.getElementById('alertId');
    const campoRuta = document.getElementById('alertRuta');
    const campoTipo = document.getElementById('alertTipo');
    const campoDescripcion = document.getElementById('alertDescripcion');
    const campoEstado = document.getElementById('alertEstado');
    const titulo = document.getElementById('modalTitle');
    const enviar = document.getElementById('modalSubmit');
    const error = document.getElementById('alertError');
    const contador = document.getElementById('alertContador');
    const textoEnviar = { crear: 'Crear alerta', editar: 'Guardar cambios' };
    let modo = 'crear';
    let enviando = false;

    function actualizarContador() {
        const n = campoDescripcion.value.length;
        const max = campoDescripcion.maxLength;
        contador.textContent = n + ' de ' + max + ' caracteres';
        contador.classList.toggle('casi', n >= max - 20);
    }
    campoDescripcion.addEventListener('input', actualizarContador);

    function limpiarErrores() {
        error.hidden = true;
        error.textContent = '';
        form.querySelectorAll('.al-campo').forEach(function (c) { c.classList.remove('con-error'); });
    }

    [campoRuta, campoTipo, campoDescripcion, campoEstado].filter(Boolean).forEach(function (c) {
        c.addEventListener('input', function () {
            c.closest('.al-campo').classList.remove('con-error');
            if (!form.querySelector('.con-error')) { error.hidden = true; error.textContent = ''; }
        });
    });

    function estadoBoton(texto) {
        if (texto) {
            enviar.classList.add('cargando');
            enviar.textContent = texto;
            enviar.setAttribute('aria-disabled', 'true');
        } else {
            enviar.classList.remove('cargando');
            enviar.textContent = textoEnviar[modo];
            enviar.removeAttribute('aria-disabled');
        }
    }

    function abrirFormulario(nuevoModo, tarjeta) {
        modo = nuevoModo;
        form.reset();
        limpiarErrores();
        enviando = false;
        if (modo === 'editar') {
            campoId.value = tarjeta.dataset.id;
            campoRuta.value = tarjeta.dataset.rutaId;
            campoTipo.value = tarjeta.dataset.tipo;
            campoDescripcion.value = tarjeta.dataset.descripcion;
            // La empresa elige entre En proceso y Resuelta; una pendiente se propone En proceso
            if (campoEstado) campoEstado.value = tarjeta.dataset.estado === 'Resuelta' ? 'Resuelta' : 'En_proceso';
            titulo.textContent = 'Editar alerta';
            form.action = '/editarAlerta/' + tarjeta.dataset.id + '/';
        } else {
            campoId.value = '';
            titulo.textContent = 'Crear alerta';
            form.action = '/crearAlerta/';
        }
        estadoBoton(null);
        actualizarContador();
        abrir(alertModal, campoRuta);
    }

    // ---------- Descargar reporte con filtros y orden ----------
    const btnReporte = document.getElementById('btnReporte');
    if (btnReporte && reportModal) {
        const formReporte = document.getElementById('reportForm');
        const errorReporte = document.getElementById('reportError');
        const modoFechas = document.getElementById('reportModoFechas');
        const bloqueFechas = document.getElementById('reportFechas');
        const campoDesde = document.getElementById('reportDesde');
        const campoHasta = document.getElementById('reportHasta');
        const cajaHasta = document.getElementById('reportHastaCampo');
        const etiquetaDesde = document.getElementById('reportDesdeEtiqueta');
        const todasRutas = document.getElementById('reportRutasTodas');
        const casillasRuta = Array.from(formReporte.querySelectorAll('input[name="ruta"]'));
        const autor = document.getElementById('reportAutor');
        const orden = document.getElementById('reportOrden');
        const ordenAutor = document.getElementById('reportOrdenAutor');
        const sentido = document.getElementById('reportSentido');
        const ayudaOrden = document.getElementById('reportAyudaOrden');

        // Solo se muestran y se envían las fechas del modo elegido
        function actualizarFechas() {
            const modo = modoFechas.value;
            bloqueFechas.hidden = modo === 'todas';
            cajaHasta.hidden = modo !== 'rango';
            campoDesde.disabled = modo === 'todas';
            campoHasta.disabled = modo !== 'rango';
            etiquetaDesde.textContent = modo === 'rango' ? 'Desde' : 'Desde esta fecha en adelante';
            errorReporte.hidden = true;
        }
        modoFechas.addEventListener('change', actualizarFechas);
        // "Desde" no puede pasar de "Hasta" ni al revés
        campoDesde.addEventListener('change', function () { campoHasta.min = campoDesde.value; });
        campoHasta.addEventListener('change', function () { campoDesde.max = campoHasta.value; });

        // "Todas las rutas" marca o desmarca todas; queda a medias si solo hay algunas marcadas
        function actualizarTodasRutas() {
            const marcadas = casillasRuta.filter(function (c) { return c.checked; }).length;
            todasRutas.checked = marcadas === casillasRuta.length;
            todasRutas.indeterminate = marcadas > 0 && marcadas < casillasRuta.length;
        }
        todasRutas.addEventListener('change', function () {
            casillasRuta.forEach(function (c) { c.checked = todasRutas.checked; });
            todasRutas.indeterminate = false;
        });
        casillasRuta.forEach(function (c) { c.addEventListener('change', actualizarTodasRutas); });

        // Ordenar por autor solo tiene sentido con todas las alertas (las de la empresa tienen un solo autor)
        const EXPLICA_ORDEN = {
            fecha: { desc: 'La más reciente primero.', asc: 'La más antigua primero.' },
            tipo: { desc: 'Información, Demora y Advertencia.', asc: 'Advertencia, Demora e Información.' },
            estado: { desc: 'Resueltas, en proceso y pendientes.', asc: 'Pendientes, en proceso y resueltas.' },
            ruta: { desc: 'Del código mayor al menor.', asc: 'Del código menor al mayor (R01, R02…).' },
            autor: { desc: 'De la Z a la A.', asc: 'De la A a la Z.' }
        };
        function actualizarOrden() {
            const soloEmpresa = autor.value === 'empresa';
            ordenAutor.disabled = soloEmpresa;
            ordenAutor.hidden = soloEmpresa;
            if (soloEmpresa && orden.value === 'autor') orden.value = 'fecha';
            let texto = EXPLICA_ORDEN[orden.value][sentido.value];
            if (orden.value !== 'fecha') texto += ' Dentro de cada grupo, la más reciente primero.';
            ayudaOrden.textContent = texto;
        }
        [autor, orden, sentido].forEach(function (s) { s.addEventListener('change', actualizarOrden); });

        btnReporte.addEventListener('click', function () {
            actualizarFechas();
            actualizarOrden();
            abrir(reportModal, reportModal.querySelector('input'));
        });
        document.getElementById('reportClose').addEventListener('click', function () { cerrar(reportModal); });
        document.getElementById('reportCancel').addEventListener('click', function () { cerrar(reportModal); });

        function falloReporte(texto, campo) {
            errorReporte.textContent = texto;
            errorReporte.hidden = false;
            campo.focus();
        }
        formReporte.addEventListener('submit', function (e) {
            // Cada grupo necesita al menos una opción marcada
            const grupos = [
                ['tipo', 'Marca al menos un tipo de alerta.'],
                ['estado', 'Marca al menos un estado.'],
                ['ruta', 'Marca al menos una ruta.']
            ];
            for (const [nombre, mensaje] of grupos) {
                const casillas = formReporte.querySelectorAll('input[name="' + nombre + '"]');
                if (casillas.length && !formReporte.querySelector('input[name="' + nombre + '"]:checked')) {
                    e.preventDefault();
                    return falloReporte(mensaje, casillas[0]);
                }
            }
            const modo = modoFechas.value;
            if (modo !== 'todas' && !campoDesde.value) {
                e.preventDefault();
                return falloReporte('Elige la fecha desde la que quieres el reporte.', campoDesde);
            }
            if (modo === 'rango') {
                if (!campoHasta.value) {
                    e.preventDefault();
                    return falloReporte('Elige la fecha hasta la que quieres el reporte.', campoHasta);
                }
                if (campoDesde.value > campoHasta.value) {
                    e.preventDefault();
                    return falloReporte('La fecha "Desde" no puede ser posterior a la fecha "Hasta".', campoDesde);
                }
            }
            errorReporte.hidden = true;
            // El PDF se abre en otra pestaña: se cierra la ventana y queda lista para otro reporte
            setTimeout(function () { cerrar(reportModal); }, 50);
        });
    }

    const btnCrear = document.getElementById('btnCreateAlert');
    if (btnCrear) btnCrear.addEventListener('click', function () { abrirFormulario('crear'); });
    document.getElementById('modalClose').addEventListener('click', function () { cerrar(alertModal); });
    document.getElementById('modalCancel').addEventListener('click', function () { cerrar(alertModal); });

    function fallo(texto, campo) {
        error.textContent = texto;
        error.hidden = false;
        campo.closest('.al-campo').classList.add('con-error');
        campo.focus();
    }

    form.addEventListener('submit', function (e) {
        if (enviando) { e.preventDefault(); return; }
        limpiarErrores();
        if (!campoRuta.value) { e.preventDefault(); return fallo('Elige la ruta a la que se refiere la alerta.', campoRuta); }
        if (!campoTipo.value) { e.preventDefault(); return fallo('Elige el tipo de alerta.', campoTipo); }
        if (!campoDescripcion.value.trim()) { e.preventDefault(); return fallo('Escribe la descripción: cuenta qué pasa y qué deben hacer los pasajeros.', campoDescripcion); }
        if (campoEstado && !campoEstado.value) { e.preventDefault(); return fallo('Elige si la alerta está en proceso o resuelta.', campoEstado); }
        enviando = true;
        estadoBoton('Guardando…');
    });

    // Si se vuelve con el botón del navegador, el botón no debe quedar "guardando"
    window.addEventListener('pageshow', function () { enviando = false; estadoBoton(null); });

    // ---------- Detalle ----------
    const detalleRuta = document.getElementById('detailRuta');
    const detalleTipo = document.getElementById('detailTipo');
    const detalleDescripcion = document.getElementById('detailDescripcion');
    const detalleEstado = document.getElementById('detailEstado');
    const detalleFecha = document.getElementById('detailFecha');
    const detalleAcciones = document.getElementById('detailAcciones');
    const btnEditar = document.getElementById('detailEdit');
    const btnInhabilitar = document.getElementById('detailDelete');
    const confirma = document.getElementById('detailConfirma');
    let seleccionada = null;

    function abrirDetalle(tarjeta) {
        seleccionada = tarjeta;
        const d = tarjeta.dataset;
        const tipo = TIPOS[d.tipo] || { texto: d.tipo, color: '#014CAB', tinta: '#FEFEFE' };

        detalleRuta.textContent = d.codigo + ' · ' + d.ruta;
        detalleTipo.textContent = tipo.texto;
        detalleTipo.style.setProperty('--tipo', tipo.color);
        detalleTipo.style.color = tipo.tinta;
        detalleDescripcion.textContent = d.descripcion;
        detalleEstado.textContent = ESTADOS[d.estado] || d.estado;
        detalleFecha.textContent = d.fecha;

        // Editar e inhabilitar solo para quien creó la alerta o la empresa dueña de la ruta (el servidor también lo valida)
        const editable = d.editable === '1';
        detalleAcciones.hidden = !editable;
        confirma.hidden = true;

        // Empresa: solo se ofrece el estado al que todavía no está la alerta
        const accionesEstado = document.getElementById('detailEstadoAcciones');
        if (accionesEstado) {
            accionesEstado.querySelectorAll('[data-nuevo-estado]').forEach(function (b) {
                b.hidden = b.dataset.nuevoEstado === d.estado;
                b.classList.remove('cargando');
                b.removeAttribute('aria-disabled');
                b.textContent = b.dataset.nuevoEstado === 'En_proceso' ? 'Marcar en proceso' : 'Marcar resuelta';
            });
        }
        const notaEditar = document.getElementById('detailNotaEditar');
        if (notaEditar) notaEditar.hidden = !editable;
        abrir(detailModal, editable ? btnEditar : document.getElementById('detailClose'));
    }

    tarjetas.forEach(function (t) {
        t.addEventListener('click', function () { abrirDetalle(t); });
        t.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalle(t); }
        });
    });

    document.getElementById('detailClose').addEventListener('click', function () { cerrar(detailModal); });

    btnEditar.addEventListener('click', function () {
        if (!seleccionada) return;
        const tarjeta = seleccionada;
        detailModal.classList.remove('abierto');
        detailModal.hidden = true;
        abrirFormulario('editar', tarjeta);
    });

    // Inhabilitar: primero se pide confirmar dentro de la misma ventana
    btnInhabilitar.addEventListener('click', function () {
        detalleAcciones.hidden = true;
        confirma.hidden = false;
        document.getElementById('detailConfirmaNo').focus();
    });

    document.getElementById('detailConfirmaNo').addEventListener('click', function () {
        confirma.hidden = true;
        detalleAcciones.hidden = false;
        btnInhabilitar.focus();
    });

    function enviarPost(accion, campos) {
        const f = document.createElement('form');
        f.method = 'POST';
        f.action = accion;
        const csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrf) campos.csrfmiddlewaretoken = csrf.value;
        Object.keys(campos).forEach(function (nombre) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = nombre;
            input.value = campos[nombre];
            f.appendChild(input);
        });
        document.body.appendChild(f);
        f.submit();
    }

    function botonCargando(boton, texto) {
        boton.classList.add('cargando');
        boton.textContent = texto;
        boton.setAttribute('aria-disabled', 'true');
    }

    document.getElementById('detailConfirmaSi').addEventListener('click', function () {
        if (!seleccionada || this.getAttribute('aria-disabled') === 'true') return;
        botonCargando(this, 'Inhabilitando…');
        enviarPost('/inhabilitarAlerta/' + seleccionada.dataset.id + '/', {});
    });

    // Empresa: marcar en proceso (se publica) o resuelta, sin pasar por el formulario
    document.querySelectorAll('#detailEstadoAcciones [data-nuevo-estado]').forEach(function (b) {
        b.addEventListener('click', function () {
            if (!seleccionada || b.getAttribute('aria-disabled') === 'true') return;
            botonCargando(b, 'Guardando…');
            enviarPost('/estadoAlerta/' + seleccionada.dataset.id + '/', { estado: b.dataset.nuevoEstado });
        });
    });
});
