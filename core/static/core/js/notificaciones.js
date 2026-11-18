// notificaciones.js - Avisa en la web cuando se crea una alerta nueva y, a la empresa, cuando un conductor
// le escribe (además de mantener al día el contador de mensajes sin leer del menú).
// Consulta /api/alertas/?publicadas_desde=<última publicación vista> cada cierto tiempo y muestra un aviso en
// la página; si el usuario lo permite, también una notificación del navegador (aparece aunque la pestaña de
// LocalBus esté en segundo plano). Se sigue la fecha de publicación y no el id: la alerta de un pasajero se
// publica cuando la empresa la revisa, después de otras con id mayor. Con ?mias=1 el pasajero solo recibe las
// de las rutas que sigue.
(function () {
    const INTERVALO_MS = 20000;
    const CLAVE_CURSOR = 'localbus_alertas_cursor';
    const CLAVE_AVISADAS = 'localbus_alertas_avisadas';
    const ICONOS = { 'delay': '⏰', 'warning': '⚠️', 'info': 'ℹ️' };
    const soportaNotificaciones = 'Notification' in window;

    function leer(clave) {
        try { return localStorage.getItem(clave); } catch (e) { return null; }
    }
    function guardar(clave, valor) {
        try { localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento: solo se pierde entre páginas */ }
    }
    // Ids ya avisados (varias pestañas comparten la lista): ninguna alerta se avisa dos veces
    function leerAvisadas() {
        try { return JSON.parse(leer(CLAVE_AVISADAS) || '[]'); } catch (e) { return []; }
    }

    // Sin cursor guardado, la primera consulta solo marca el punto de partida, sin avisar
    let cursor = leer(CLAVE_CURSOR);

    function contenedor() {
        let caja = document.getElementById('notifAlertas');
        if (!caja) {
            caja = document.createElement('div');
            caja.id = 'notifAlertas';
            caja.className = 'notif-alertas-container';
            caja.setAttribute('aria-live', 'polite');
            document.body.appendChild(caja);
        }
        return caja;
    }

    function cerrarAviso(aviso) {
        aviso.classList.add('saliendo');
        setTimeout(function () { aviso.remove(); }, 400);
    }

    function mostrarAviso(alerta) {
        const aviso = document.createElement('div');
        aviso.className = 'base-message base-message-warning notif-alerta';

        const enlace = document.createElement('a');
        enlace.href = '/alertas/';
        const titulo = document.createElement('strong');
        titulo.textContent = (ICONOS[alerta.tipo] || '🚨') + ' Nueva alerta · ' + alerta.ruta;
        const texto = document.createElement('span');
        texto.textContent = alerta.descripcion;
        enlace.append(titulo, texto);

        const cerrar = document.createElement('button');
        cerrar.type = 'button';
        cerrar.textContent = '×';
        cerrar.setAttribute('aria-label', 'Cerrar');
        cerrar.addEventListener('click', function () { cerrarAviso(aviso); });

        aviso.append(enlace, cerrar);
        contenedor().appendChild(aviso);
        setTimeout(function () { if (aviso.isConnected) cerrarAviso(aviso); }, 10000);
    }

    function notificarNavegador(alerta) {
        if (!soportaNotificaciones || Notification.permission !== 'granted' || !document.hidden) return;
        const notificacion = new Notification('🚨 Nueva alerta · ' + alerta.ruta, {
            body: alerta.descripcion,
            tag: 'alerta-' + alerta.id,  // varias pestañas abiertas muestran una sola
        });
        notificacion.onclick = function () {
            window.focus();
            window.location.href = '/alertas/';
            notificacion.close();
        };
    }

    function revisar() {
        // Otra pestaña pudo avanzar el cursor
        const guardado = leer(CLAVE_CURSOR);
        if (guardado && (!cursor || guardado > cursor)) cursor = guardado;
        const q = new URLSearchParams({ mias: '1' });
        if (cursor) q.set('publicadas_desde', cursor); else q.set('limite', '1');
        fetch('/api/alertas/?' + q.toString(), { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (datos) {
                if (!datos) return;
                const inicial = !cursor;
                const avisadas = leerAvisadas();
                const nuevas = inicial ? [] : datos.alertas.filter(function (a) { return avisadas.indexOf(a.id) === -1; });
                if (datos.cursor && (!cursor || datos.cursor > cursor)) cursor = datos.cursor;
                guardar(CLAVE_CURSOR, cursor || '');
                guardar(CLAVE_AVISADAS, JSON.stringify(avisadas.concat(nuevas.map(function (a) { return a.id; })).slice(-100)));

                // Las más antiguas primero; como mucho 3 avisos a la vez
                nuevas.reverse().slice(-3).forEach(function (alerta) {
                    mostrarAviso(alerta);
                    notificarNavegador(alerta);
                });
            })
            .catch(function () { /* sin conexión: se reintenta en la próxima vuelta */ });
    }

    // ----- Mensajes de los conductores (solo la empresa) -----
    // El menú la deja en data-mensajes (la dirección del resumen) y data-empresa. Cada cierto tiempo se actualiza
    // el contador de "Mensajes" y, si llegó un mensaje nuevo, se avisa en la página (y en una notificación del
    // navegador si la pestaña está en segundo plano).
    const origen = document.currentScript;
    const URL_MENSAJES = origen && origen.dataset.mensajes;
    const CLAVE_MENSAJE = 'localbus_ultimo_mensaje_' + (origen && origen.dataset.empresa || '');

    function leerUltimoMensaje() {
        try {
            const id = parseInt(localStorage.getItem(CLAVE_MENSAJE), 10);
            return Number.isNaN(id) ? null : id;
        } catch (e) { return null; }
    }

    let mensajesInicializado = leerUltimoMensaje() !== null;
    let ultimoMensajeVisto = leerUltimoMensaje() || 0;

    // El número junto a "Mensajes" en el menú y el punto del botón ☰ del celular
    function ponerContadorMensajes(total) {
        const enlace = document.querySelector('a.base-nav-link[href="/mensajes/"]');
        let numero = document.getElementById('navMensajesSinLeer');
        if (enlace && total && !numero) {
            numero = document.createElement('span');
            numero.className = 'base-nav-contador';
            numero.id = 'navMensajesSinLeer';
            numero.appendChild(document.createTextNode(''));
            const oculto = document.createElement('span');
            oculto.className = 'base-oculto';
            oculto.textContent = ' sin leer';
            numero.appendChild(oculto);
            enlace.append(' ', numero);
        }
        if (numero && total) numero.firstChild.nodeValue = String(total);
        if (numero && !total) numero.remove();

        const boton = document.getElementById('menuFabBtn');
        if (boton) {
            let punto = boton.querySelector('.base-menu-fab-punto');
            if (total && !punto) {
                punto = document.createElement('span');
                punto.className = 'base-menu-fab-punto';
                punto.setAttribute('aria-hidden', 'true');
                boton.appendChild(punto);
            }
            if (!total && punto) punto.remove();
            boton.setAttribute('aria-label', 'Abrir el menú' + (total ? ' (' + total + ' mensaje' + (total === 1 ? '' : 's') + ' sin leer)' : ''));
        }
    }

    function mostrarAvisoMensaje(m) {
        const aviso = document.createElement('div');
        aviso.className = 'base-message base-message-info notif-alerta';
        const enlace = document.createElement('a');
        enlace.href = '/mensajes/?c=' + m.conductor_id;
        const titulo = document.createElement('strong');
        titulo.textContent = '💬 Mensaje de ' + m.conductor;
        const texto = document.createElement('span');
        texto.textContent = m.texto;
        enlace.append(titulo, texto);
        const cerrar = document.createElement('button');
        cerrar.type = 'button';
        cerrar.textContent = '×';
        cerrar.setAttribute('aria-label', 'Cerrar');
        cerrar.addEventListener('click', function () { cerrarAviso(aviso); });
        aviso.append(enlace, cerrar);
        contenedor().appendChild(aviso);
        setTimeout(function () { if (aviso.isConnected) cerrarAviso(aviso); }, 10000);
    }

    function notificarNavegadorMensaje(m) {
        if (!soportaNotificaciones || Notification.permission !== 'granted' || !document.hidden) return;
        const notificacion = new Notification('💬 Mensaje de ' + m.conductor, {
            body: m.texto,
            tag: 'mensaje-' + m.id,  // varias pestañas abiertas muestran una sola
        });
        notificacion.onclick = function () {
            window.focus();
            window.location.href = '/mensajes/?c=' + m.conductor_id;
            notificacion.close();
        };
    }

    function revisarMensajes() {
        if (!URL_MENSAJES) return;
        const url = mensajesInicializado ? URL_MENSAJES + '?desde=' + ultimoMensajeVisto : URL_MENSAJES;
        fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (datos) {
                if (!datos) return;
                ponerContadorMensajes(datos.sin_leer);
                // Otra pestaña pudo avisar ya de algunos de estos mensajes
                const base = Math.max(ultimoMensajeVisto, leerUltimoMensaje() || 0);
                // Con la conversación de ese conductor abierta, la propia página ya lo muestra
                const abierta = window.location.pathname.indexOf('/mensajes') === 0
                    ? new URLSearchParams(window.location.search).get('c') : null;
                const nuevos = mensajesInicializado
                    ? datos.mensajes.filter(function (m) { return m.id > base && String(m.conductor_id) !== abierta; })
                    : [];
                ultimoMensajeVisto = Math.max(base, datos.ultimo);
                try { localStorage.setItem(CLAVE_MENSAJE, String(ultimoMensajeVisto)); } catch (e) { /* solo se pierde entre páginas */ }
                mensajesInicializado = true;
                // Como mucho 3 avisos a la vez
                nuevos.slice(-3).forEach(function (m) {
                    mostrarAvisoMensaje(m);
                    notificarNavegadorMensaje(m);
                });
            })
            .catch(function () { /* sin conexión: se reintenta en la próxima vuelta */ });
    }

    // ----- Botón del menú para activar las notificaciones del navegador -----
    function actualizarBoton(boton) {
        if (!soportaNotificaciones) {
            boton.hidden = true;
            return;
        }
        boton.hidden = false;
        boton.dataset.permiso = Notification.permission;
        const textos = {
            granted: 'Notificaciones activadas',
            denied: 'Notificaciones bloqueadas',
            default: 'Activar notificaciones',
        };
        boton.textContent = textos[Notification.permission] || textos.default;
        boton.title = Notification.permission === 'denied'
            ? 'Permítelas desde la configuración del sitio en tu navegador'
            : '';
    }

    document.addEventListener('DOMContentLoaded', function () {
        const boton = document.getElementById('btnNotificaciones');
        if (boton) {
            actualizarBoton(boton);
            boton.addEventListener('click', function (e) {
                e.preventDefault();
                if (soportaNotificaciones && Notification.permission === 'default') {
                    // Mientras el navegador espera la respuesta de la persona, el botón lo indica
                    boton.dataset.esperando = '1';
                    boton.textContent = 'Esperando tu respuesta…';
                    Promise.resolve(Notification.requestPermission()).catch(function () {}).then(function () {
                        delete boton.dataset.esperando;
                        actualizarBoton(boton);
                    });
                }
            });
        }
        revisar();
        setInterval(revisar, INTERVALO_MS);
        revisarMensajes();
        setInterval(revisarMensajes, INTERVALO_MS);
    });
})();
