// ============================================================
// SIMULACION.JS - Panel de simulación de buses: encender y apagar la simulación de cada bus (o de todos),
// cambiar su velocidad, volver al inicio de la ruta y ver en vivo su turno, posición y distancia.
// Usa las mismas APIs de siempre. Diseño según docs/GUIA_DE_DISENO.md: sin emojis, alert() ni confirm().
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const tarjetas = Array.from(document.querySelectorAll('.sm-tarjeta'));
    if (!tarjetas.length) return;

    function csrf() {
        const fila = document.cookie.split('; ').find(function (f) { return f.startsWith('csrftoken='); });
        return fila ? decodeURIComponent(fila.split('=')[1]) : '';
    }

    function enviar(url, datos) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: datos ? JSON.stringify(datos) : undefined,
        }).then(function (r) {
            return r.json().then(function (d) {
                if (!r.ok || d.status !== 'ok') throw new Error(d.error || 'No se pudo guardar.');
                return d;
            });
        });
    }

    // ---------- Avisos breves ----------
    const avisos = document.getElementById('smAvisos');
    function avisar(texto, error) {
        const caja = document.createElement('div');
        caja.className = 'sm-aviso-breve' + (error ? ' sm-aviso-breve--error' : '');
        caja.textContent = texto;
        avisos.appendChild(caja);
        setTimeout(function () { caja.classList.add('saliendo'); }, 3000);
        setTimeout(function () { caja.remove(); }, 3500);
    }

    // ---------- Estado de una tarjeta ----------
    function ponerSimulando(busId, simulando) {
        const tarjeta = document.getElementById('card-' + busId);
        if (!tarjeta) return;
        tarjeta.classList.toggle('sm-tarjeta--simulando', simulando);
        document.getElementById('badge-' + busId).textContent = simulando ? 'En simulación' : 'Detenido';
        document.getElementById('switch-' + busId).setAttribute('aria-checked', simulando ? 'true' : 'false');
    }

    function contar() {
        const simulando = tarjetas.filter(function (t) { return t.classList.contains('sm-tarjeta--simulando'); }).length;
        const conTurno = tarjetas.filter(function (t) { return !t.classList.contains('sm-tarjeta--sin-turno'); }).length;
        document.getElementById('statSimulando').textContent = simulando;
        document.getElementById('statDetenidos').textContent = tarjetas.length - simulando;
        document.getElementById('statConTurno').textContent = conTurno;
        filtrar();
    }

    // El turno puede empezar o terminar con el panel abierto
    function pintarTurno(busId, datos) {
        const tarjeta = document.getElementById('card-' + busId);
        const caja = document.getElementById('turno-' + busId);
        if (!tarjeta || !caja) return;
        caja.textContent = '';
        tarjeta.classList.toggle('sm-tarjeta--sin-turno', !datos);
        if (!datos) {
            tarjeta.style.setProperty('--ruta', 'var(--linea)');
            const vacio = document.createElement('span');
            vacio.className = 'sm-turno-vacio';
            vacio.textContent = 'Sin turno en curso: no se moverá aunque esté en simulación.';
            caja.appendChild(vacio);
            tarjeta.dataset.buscar = normalizar(tarjeta.dataset.placa);
            return;
        }
        tarjeta.style.setProperty('--ruta', datos.ruta_color);
        const ruta = document.createElement('span');
        ruta.className = 'sm-turno-ruta';
        const codigo = document.createElement('span');
        codigo.className = 'sm-ruta-codigo';
        codigo.textContent = datos.ruta_codigo;
        const nombre = document.createElement('span');
        nombre.textContent = datos.ruta_nombre;
        ruta.append(codigo, nombre);
        const detalle = document.createElement('span');
        detalle.className = 'sm-turno-detalle';
        detalle.textContent = datos.conductor + ' · hasta las ' + datos.hasta;
        caja.append(ruta, detalle);
        tarjeta.dataset.buscar = normalizar([tarjeta.dataset.placa, datos.conductor, datos.ruta_codigo, datos.ruta_nombre].join(' '));
    }

    // ---------- Filtros ----------
    const pestanas = Array.from(document.querySelectorAll('.sm-pestana'));
    const buscador = document.getElementById('smBuscar');
    const mensajeFiltro = document.getElementById('smFiltroMensaje');
    const filtros = { estado: 'todos', texto: '' };

    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    tarjetas.forEach(function (t) { t.dataset.buscar = normalizar(t.dataset.buscar); });

    function filtrar() {
        let visibles = 0;
        tarjetas.forEach(function (t) {
            const simulando = t.classList.contains('sm-tarjeta--simulando');
            const sinTurno = t.classList.contains('sm-tarjeta--sin-turno');
            const porEstado = filtros.estado === 'todos'
                || (filtros.estado === 'simulando' && simulando)
                || (filtros.estado === 'detenido' && !simulando)
                || (filtros.estado === 'con-turno' && !sinTurno)
                || (filtros.estado === 'sin-turno' && sinTurno);
            const porTexto = !filtros.texto || t.dataset.buscar.includes(filtros.texto);
            t.hidden = !(porEstado && porTexto);
            if (!t.hidden) visibles++;
        });
        if (visibles === 0) {
            mensajeFiltro.textContent = filtros.texto
                ? 'Ningún bus coincide con «' + buscador.value.trim() + '».'
                : 'No hay buses en este grupo.';
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
    buscador.addEventListener('input', function () {
        filtros.texto = normalizar(buscador.value.trim());
        filtrar();
    });

    // ---------- Encender o apagar un bus ----------
    document.addEventListener('click', function (e) {
        const interruptor = e.target.closest('[data-switch]');
        if (!interruptor || interruptor.getAttribute('aria-busy') === 'true') return;
        const busId = interruptor.dataset.switch;
        interruptor.setAttribute('aria-busy', 'true');
        enviar('/api/toggle-simulacion/' + busId + '/')
            .then(function (d) {
                ponerSimulando(busId, d.simulando);
                contar();
                avisar(d.placa + (d.simulando ? ' está en simulación.' : ' se detuvo.'));
            })
            .catch(function () { avisar('No se pudo cambiar la simulación. Revisa tu conexión e inténtalo de nuevo.', true); })
            .finally(function () { interruptor.removeAttribute('aria-busy'); });
    });

    // ---------- Simular o detener todos ----------
    document.querySelectorAll('[data-todos]').forEach(function (boton) {
        boton.addEventListener('click', function () {
            const simulando = boton.dataset.todos === '1';
            if (boton.getAttribute('aria-disabled') === 'true') return;
            const texto = boton.textContent;
            boton.setAttribute('aria-disabled', 'true');
            boton.classList.add('cargando');
            boton.textContent = simulando ? 'Iniciando…' : 'Deteniendo…';
            enviar('/api/toggle-todos/', { simulando: simulando })
                .then(function () {
                    tarjetas.forEach(function (t) { ponerSimulando(t.dataset.bus, simulando); });
                    contar();
                    avisar(simulando ? 'Todos los buses están en simulación.' : 'Se detuvieron todos los buses.');
                })
                .catch(function () { avisar('No se pudo cambiar la simulación de todos. Inténtalo de nuevo.', true); })
                .finally(function () {
                    boton.removeAttribute('aria-disabled');
                    boton.classList.remove('cargando');
                    boton.textContent = texto;
                });
        });
    });

    // ---------- Velocidad ----------
    const esperaVelocidad = {};
    document.querySelectorAll('[data-velocidad]').forEach(function (rango) {
        const busId = rango.dataset.velocidad;
        const salida = document.getElementById('vel-' + busId);
        rango.addEventListener('input', function () {
            salida.textContent = rango.value + ' km/h';
            // Se guarda cuando se deja de mover el control
            clearTimeout(esperaVelocidad[busId]);
            esperaVelocidad[busId] = setTimeout(function () {
                enviar('/api/cambiar-velocidad/' + busId + '/', { velocidad: parseFloat(rango.value) })
                    .then(function (d) {
                        const placa = document.getElementById('card-' + busId).dataset.placa;
                        avisar('Velocidad de ' + placa + ': ' + Math.round(d.velocidad) + ' km/h.');
                    })
                    .catch(function () { avisar('No se pudo guardar la velocidad. Inténtalo de nuevo.', true); });
            }, 400);
        });
    });

    // ---------- Volver al inicio de la ruta (con confirmación) ----------
    const modal = document.getElementById('reiniciarModal');
    const confirmar = document.getElementById('reiniciarConfirmar');
    let busReiniciar = null;
    let focoPrevio = null;

    function abrirModal(busId) {
        busReiniciar = busId;
        const placa = document.getElementById('card-' + busId).dataset.placa;
        const texto = document.getElementById('reiniciarTexto');
        texto.textContent = '';
        const fuerte = document.createElement('strong');
        fuerte.textContent = placa;
        texto.append('¿Llevar el bus ', fuerte, ' al inicio de su ruta?');
        focoPrevio = document.activeElement;
        modal.hidden = false;
        modal.classList.add('abierto');
        document.body.style.overflow = 'hidden';
        setTimeout(function () { modal.querySelector('[data-cerrar].sm-boton').focus(); }, 30);
    }

    function cerrarModal() {
        modal.classList.remove('abierto');
        modal.hidden = true;
        document.body.style.overflow = '';
        if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
    }

    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-reiniciar]');
        if (boton) abrirModal(boton.dataset.reiniciar);
    });
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) cerrarModal(); });
    modal.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrarModal); });
    document.addEventListener('keydown', function (e) {
        if (modal.hidden) return;
        if (e.key === 'Escape') cerrarModal();
        if (e.key === 'Tab') {
            const enfocables = Array.from(modal.querySelectorAll('button'));
            const primero = enfocables[0];
            const ultimo = enfocables[enfocables.length - 1];
            if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
        }
    });

    confirmar.addEventListener('click', function () {
        if (!busReiniciar || confirmar.getAttribute('aria-disabled') === 'true') return;
        const busId = busReiniciar;
        confirmar.setAttribute('aria-disabled', 'true');
        enviar('/api/resetear-bus/' + busId + '/')
            .then(function () {
                document.getElementById('pos-' + busId).textContent = '0';
                document.getElementById('dist-' + busId).textContent = '0 m';
                avisar(document.getElementById('card-' + busId).dataset.placa + ' volvió al inicio de su ruta.');
                cerrarModal();
            })
            .catch(function () { avisar('No se pudo llevar el bus al inicio. Inténtalo de nuevo.', true); })
            .finally(function () { confirmar.removeAttribute('aria-disabled'); });
    });

    // ---------- En vivo: turno, posición, distancia y estado del simulador ----------
    function actualizar() {
        fetch('/api/estado-simulacion/')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                data.configuraciones.forEach(function (c) {
                    const pos = document.getElementById('pos-' + c.bus_id);
                    if (!pos) return;
                    pos.textContent = c.posicion_actual;
                    document.getElementById('dist-' + c.bus_id).textContent = Math.round(c.distancia_recorrida) + ' m';
                    ponerSimulando(c.bus_id, c.simulando);
                    pintarTurno(c.bus_id, c.turno_datos);
                });
                contar();
                const aviso = document.getElementById('avisoSimulador');
                if (aviso) aviso.hidden = data.simulador_corriendo !== false;
            })
            .catch(function () { /* sin conexión: se reintenta en el próximo ciclo */ });
    }
    setInterval(actualizar, 5000);
});
