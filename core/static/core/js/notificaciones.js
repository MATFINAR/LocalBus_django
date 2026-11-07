// notificaciones.js - Avisa en la web cuando se crea una alerta nueva.
// Consulta /api/alertas/?desde=<último id visto> cada cierto tiempo y muestra
// un aviso en la página; si el usuario lo permite, también una notificación
// del navegador (aparece aunque la pestaña de LocalBus esté en segundo plano).
(function () {
    const INTERVALO_MS = 20000;
    const CLAVE_ULTIMA = 'localbus_ultima_alerta';
    const ICONOS = { 'delay': '⏰', 'bus-arriving': '🚌', 'warning': '⚠️', 'info': 'ℹ️' };
    const soportaNotificaciones = 'Notification' in window;

    function leerUltima() {
        try {
            const id = parseInt(localStorage.getItem(CLAVE_ULTIMA), 10);
            return Number.isNaN(id) ? null : id;  // 0 es válido: aún no había alertas
        } catch (e) { return null; }
    }

    function guardarUltima(id) {
        try { localStorage.setItem(CLAVE_ULTIMA, String(id)); } catch (e) { /* sin almacenamiento: solo se pierde entre páginas */ }
    }

    // Sin un id guardado, la primera consulta solo marca el punto de partida, sin avisar
    let inicializado = leerUltima() !== null;
    let ultimaVista = leerUltima() || 0;

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
        const url = inicializado ? '/api/alertas/?desde=' + ultimaVista : '/api/alertas/?limite=1';
        fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (datos) {
                if (!datos) return;
                // Otra pestaña pudo avisar ya de algunas de estas alertas
                const base = Math.max(ultimaVista, leerUltima() || 0);
                const nuevas = inicializado ? datos.alertas.filter(function (a) { return a.id > base; }) : [];
                ultimaVista = Math.max(base, datos.alertas.length ? datos.alertas[0].id : 0);
                guardarUltima(ultimaVista);
                inicializado = true;

                // Las más antiguas primero; como mucho 3 avisos a la vez
                nuevas.reverse().slice(-3).forEach(function (alerta) {
                    mostrarAviso(alerta);
                    notificarNavegador(alerta);
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
            granted: '🔔 Notificaciones activadas',
            denied: '🔕 Notificaciones bloqueadas',
            default: '🔔 Activar notificaciones',
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
                    Notification.requestPermission().then(function () { actualizarBoton(boton); });
                }
            });
        }
        revisar();
        setInterval(revisar, INTERVALO_MS);
    });
})();
