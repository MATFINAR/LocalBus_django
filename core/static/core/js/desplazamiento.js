// desplazamiento.js: cómo se mueve el mapa en el celular ("barra" lateral o "dos_dedos").
// La preferencia vive en <html data-desplazamiento>; el mapa escucha el evento "desplazamiento-cambiado".
(function () {
    const raiz = document.documentElement;
    const celular = window.matchMedia('(max-width: 768px) and (pointer: coarse)');

    function csrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function guardar(modo) {
        return fetch('/perfil/desplazamiento_mapa/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'modo=' + encodeURIComponent(modo),
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
                if (!r.ok || !d.ok) throw new Error(d.error || 'No pudimos guardar tu elección. Revisa tu conexión e inténtalo de nuevo.');
                return d;
            });
        });
    }

    function aplicar(modo) {
        raiz.dataset.desplazamiento = modo;
        document.querySelectorAll('input[name="desplazamiento_mapa"]').forEach(function (r) { r.checked = r.value === modo; });
        document.dispatchEvent(new CustomEvent('desplazamiento-cambiado', { detail: { modo: modo } }));
    }

    // ---------- Ventanas de la primera vez (solo en el mapa) ----------
    function mostrarVentana(ventana) {
        ventana.hidden = false;
        requestAnimationFrame(function () { ventana.classList.add('abierto'); });
        document.body.style.overflow = 'hidden';
        const primera = ventana.querySelector('.dz-opcion');
        if (primera) primera.focus();
    }

    function quitarVentana(ventana) {
        ventana.classList.remove('abierto');
        document.body.style.overflow = '';
        setTimeout(function () { ventana.remove(); }, 250);
    }

    // Tab no sale de la ventana mientras está abierta
    function atraparFoco(ventana) {
        ventana.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            const opciones = Array.from(ventana.querySelectorAll('.dz-opcion'));
            const i = opciones.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); opciones[opciones.length - 1].focus(); }
            else if (!e.shiftKey && i === opciones.length - 1) { e.preventDefault(); opciones[0].focus(); }
        });
    }

    // Orden en el primer inicio de sesión:
    // 1) Cómo mover el mapa: barra lateral o dos dedos (se guarda en la cuenta)
    // 2) Bienvenida: seguir en el mapa o conocer LocalBus (Acerca de)
    const pregunta = document.getElementById('dzPregunta');
    const bienvenida = document.getElementById('bvPregunta');

    function abrirBienvenida() {
        if (bienvenida && bienvenida.hidden && bienvenida.isConnected) mostrarVentana(bienvenida);
    }

    function abrirPregunta() {
        if (!pregunta || !pregunta.hidden || !pregunta.isConnected) return;
        // En el primer inicio de sesión se pregunta en cualquier dispositivo; después, solo en el celular
        if (!bienvenida && !celular.matches) return;
        mostrarVentana(pregunta);
    }

    if (pregunta) {
        const opciones = Array.from(pregunta.querySelectorAll('.dz-opcion'));
        const error = document.getElementById('dzError');
        atraparFoco(pregunta);

        opciones.forEach(function (boton) {
            boton.addEventListener('click', function () {
                const modo = boton.dataset.modo;
                opciones.forEach(function (b) { b.disabled = true; });
                boton.classList.add('elegida');
                error.hidden = true;
                guardar(modo).then(function () {
                    aplicar(modo);
                    quitarVentana(pregunta);
                    setTimeout(abrirBienvenida, 300);
                }).catch(function (e) {
                    error.textContent = e.message;
                    error.hidden = false;
                    boton.classList.remove('elegida');
                    opciones.forEach(function (b) { b.disabled = false; });
                    boton.focus();
                });
            });
        });

        // Si nunca respondió (p. ej. inició sesión antes de existir la pregunta), sale al abrir el mapa en el celular
        if (celular.addEventListener) celular.addEventListener('change', abrirPregunta);
    }

    if (bienvenida) {
        atraparFoco(bienvenida);
        function seguirEnElMapa() {
            quitarVentana(bienvenida);
        }
        bienvenida.querySelector('[data-bienvenida="mapa"]').addEventListener('click', seguirEnElMapa);
        // Escape también deja en el mapa; "Conocer LocalBus" es un enlace normal a Acerca de
        bienvenida.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') seguirEnElMapa();
        });
    }

    // Primero la pregunta del mapa; si ya estaba respondida (o no aplica), directo a la bienvenida
    if (pregunta && (bienvenida || celular.matches)) abrirPregunta();
    else abrirBienvenida();

    // ---------- Ajustes en Mi perfil ----------
    const estado = document.getElementById('dzAjusteEstado');
    document.querySelectorAll('input[name="desplazamiento_mapa"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            if (!radio.checked) return;
            const anterior = raiz.dataset.desplazamiento;
            const radios = document.querySelectorAll('input[name="desplazamiento_mapa"]');
            radios.forEach(function (r) { r.disabled = true; });
            if (estado) { estado.className = 'dz-ajuste-estado'; estado.textContent = 'Guardando…'; }
            guardar(radio.value).then(function () {
                aplicar(radio.value);
                // Si cambió el ajuste antes de responder la pregunta, ya no hace falta preguntar
                if (pregunta && pregunta.isConnected) pregunta.remove();
                if (estado) { estado.className = 'dz-ajuste-estado ok'; estado.textContent = 'Guardado.'; }
            }).catch(function (e) {
                aplicar(anterior);
                if (estado) { estado.className = 'dz-ajuste-estado error'; estado.textContent = e.message; }
            }).finally(function () {
                radios.forEach(function (r) { r.disabled = false; });
            });
        });
    });
})();
