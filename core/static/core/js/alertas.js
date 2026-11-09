// ============================================================
// ALERTAS.JS - Centro de alertas: filtros, detalle, crear, editar e inhabilitar
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

    // Mismos colores de placa que en el mapa (la ruta usa id % 7)
    const PALETA_RUTAS = ['#087F8C', '#6B3FA0', '#B85C00', '#A82A7B', '#5C6B1E', '#7A4A2B', '#3F5B7A'];
    const TIPOS = {
        'delay': { texto: 'Demora', color: '#D4121A', tinta: '#FEFEFE' },
        'bus-arriving': { texto: 'Próximo bus', color: '#187A45', tinta: '#FEFEFE' },
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

    function filtrar(filtro, nombre) {
        let visibles = 0;
        tarjetas.forEach(function (t) {
            const ver = filtro === 'all' || t.dataset.tipo === filtro;
            t.hidden = !ver;
            if (ver) visibles++;
        });
        if (!mensaje) return;
        if (tarjetas.length && visibles === 0) {
            mensaje.textContent = 'No hay alertas de tipo «' + nombre + '» por ahora. Prueba con otro filtro.';
            mensaje.hidden = false;
        } else {
            mensaje.hidden = true;
        }
    }

    pestanas.forEach(function (p) {
        p.addEventListener('click', function () {
            pestanas.forEach(function (o) {
                o.classList.toggle('activa', o === p);
                o.setAttribute('aria-pressed', o === p ? 'true' : 'false');
            });
            filtrar(p.dataset.filter, p.firstChild.textContent.trim().toLowerCase());
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

    [alertModal, detailModal].forEach(function (modal) {
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

    [campoRuta, campoTipo, campoDescripcion, campoEstado].forEach(function (c) {
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
            campoEstado.value = tarjeta.dataset.estado;
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

    document.getElementById('detailConfirmaSi').addEventListener('click', function () {
        if (!seleccionada) return;
        this.classList.add('cargando');
        this.textContent = 'Inhabilitando…';
        this.setAttribute('aria-disabled', 'true');

        const f = document.createElement('form');
        f.method = 'POST';
        f.action = '/inhabilitarAlerta/' + seleccionada.dataset.id + '/';
        const csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrf) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'csrfmiddlewaretoken';
            input.value = csrf.value;
            f.appendChild(input);
        }
        document.body.appendChild(f);
        f.submit();
    });
});
